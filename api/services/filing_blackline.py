"""COV-04 (roadmap RM-L12) -- filing-to-filing blacklining from SEC EDGAR.

For one symbol: its two most recent original 10-K filings, the comparable
sections of each (Item 1A Risk Factors; Item 7 MD&A), and a paragraph-level
diff -- added, removed, changed (with word-level marks) and moved.

⛔ DARK behind `FILING_BLACKLINE_ENABLED` (read per call, unset = OFF). Unset,
nothing here is reached from a member request, no thread is started and SEC is
never called (`_schedule` refuses as well, so a stray caller cannot open the
door the flag closed).

Request path vs fetch path -- the same split as `edgar_ownership`:
  * `blackline_snapshot()` is the only thing a request calls. It reads the
    cache and NEVER touches the network: a miss answers `state: pending` and
    queues one refresh.
  * `_refresh()` runs on this module's own single worker thread. It reaches SEC
    only through `fundamentals_pit.sec_client` (the declared User-Agent, one
    process-wide limiter, bounded backoff): one submissions read and two
    documents, at most three requests per ticker.

Honesty rules:
  * every side cites its accession number and filing date;
  * a section that could not be located in either filing is `not_found` with
    the reason, and carries NO counts -- never "no changes";
  * a changed paragraph whose only differences are years, dates or figures is
    marked `boilerplate` and counted separately, but is still listed;
  * page furniture (running footers, bare page numbers) is not a paragraph of
    the section; how many such lines were dropped is reported, per side.
"""
from __future__ import annotations

import difflib
import html
import json
import logging
import os
import re
import threading
from concurrent.futures import ThreadPoolExecutor
from html.parser import HTMLParser
from typing import Optional

from api.services import provider_errors as _pe
from api.services.cache import cache

_logger = logging.getLogger(__name__)

ENABLED_ENV = "FILING_BLACKLINE_ENABLED"
VENDOR = "sec_edgar"
_ERR = _pe.make_vendor_errors(VENDOR, class_prefix="SecEdgarBlackline")

FORM = "10-K"
_SEC_TIMEOUT_S = 30
_SEC_RETRIES = 1
_TTL_OK = 12 * 3600
_TTL_FAIL = 300
_TTL_NOT_FOUND = 3600
_MAX_QUEUED = 8
_CACHE_PREFIX = "filing_blackline::"
_WWW = "https://www.sec.gov"
_DATA = "https://data.sec.gov"

PAIR_MIN_RATIO = 0.5       # two paragraphs this similar are one paragraph, changed
READABLE_STATES = ("ok", "partial")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


# ── HTML -> blocks ──────────────────────────────────────────────────────────

_BLOCK_TAGS = {"p", "div", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6", "table",
               "ul", "ol", "br", "hr", "section", "article", "blockquote", "pre", "body"}
_CELL_TAGS = {"td", "th"}
_SKIP_TAGS = {"script", "style", "head", "title", "ix:header"}
_INLINE_STYLE = re.compile(r"display\s*:\s*inline", re.I)


class _Blocks(HTMLParser):
    """A flat list of text blocks in document order. Block-level tags end a
    block; table cells are joined inside their row; the inline-XBRL header and
    scripts/styles are not text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self._buf: list[str] = []
        self._skip = 0
        self._divs: list[bool] = []      # per open <div>: is it inline?

    def _flush(self):
        t = "".join(self._buf)
        self._buf = []
        t = _norm_ws(t)
        if t:
            self.blocks.append(t)

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in _SKIP_TAGS:
            self._skip += 1
            return
        if self._skip:
            return
        if tag == "div":
            # A converter-made filing (CALM) spaces words with
            # <div style="display:inline-block"> -- inline, not a block.
            inline = _INLINE_STYLE.search(dict(attrs).get("style") or "") is not None
            self._divs.append(inline)
            if inline:
                return
        if tag in _BLOCK_TAGS:
            self._flush()
        elif tag in _CELL_TAGS:
            self._buf.append(" ")

    def handle_startendtag(self, tag, attrs):
        if tag.lower() in _BLOCK_TAGS and not self._skip:
            self._flush()

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in _SKIP_TAGS:
            self._skip = max(0, self._skip - 1)
            return
        if self._skip:
            return
        if tag == "div" and self._divs and self._divs.pop():
            return
        if tag in _BLOCK_TAGS:
            self._flush()
        elif tag in _CELL_TAGS:
            self._buf.append(" ")

    def handle_data(self, data):
        if not self._skip:
            self._buf.append(data)

    def close(self):
        super().close()
        self._flush()


_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"',
                         " ": " ", " ": " ", " ": " ", " ": " ", " ": " "})


_INVISIBLE = re.compile(r"[​‌‍⁠﻿]")   # zero-width spacers some filers emit


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", _INVISIBLE.sub("", html.unescape(s).translate(_QUOTES))).strip()


def html_blocks(doc: bytes | str) -> list[str]:
    text = doc.decode("utf-8", "replace") if isinstance(doc, bytes) else doc
    p = _Blocks()
    p.feed(text)
    p.close()
    return p.blocks


# ── section location ────────────────────────────────────────────────────────

_SEP = r"[\s.:\-–—]*"
_MDNA_TITLE = r"MANAGEMENT'S DISCUSSION AND ANALYSIS( OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS)?"


def _start_rx(number: str, title: str):
    """'Item 7. Management's Discussion...' in any case -- or, with the word
    'Item' missing (MRNA's 10-Q: "2. MANAGEMENT'S DISCUSSION..."), only in ALL
    CAPS: a Title Case "1A. Risk Factors." is a table-of-contents line (AAON)."""
    def caps(rx: str) -> str:       # upper-case the letters, never an escape (\s, \b)
        return re.sub(r"(\\.)|([a-z])", lambda m: m.group(1) or m.group(2).upper(), rx)
    return re.compile(rf"^(?:(?i:item\s*{number}{_SEP}{title})|{caps(number)}{_SEP}{caps(title)})")
SECTIONS = (
    {
        "key": "risk_factors",
        "label": "Item 1A. Risk Factors",
        "start": _start_rx(r"1a\b", r"risk\s+factors\b"),
        "end": re.compile(rf"^item\s*(1b|1c|2)\b{_SEP}[a-z]", re.I),
        "title": "RISK FACTORS",
    },
    {
        "key": "mdna",
        "label": "Item 7. Management's Discussion and Analysis",
        "start": _start_rx(r"7\b(?!a)", r"management'?s\s+discussion"),
        "end": re.compile(rf"^item\s*(7a|8)\b{_SEP}[a-z]", re.I),
        "title": _MDNA_TITLE,
    },
)

# A 10-Q numbers its items per PART: Part I Item 2 is MD&A, Part II Item 2 is
# "Unregistered Sales of Equity Securities". The start patterns name the title,
# so the two Item 2s cannot be confused; Item 1A exists only in Part II.
SECTIONS_10Q = (
    {
        "key": "mdna",
        "label": "Part I, Item 2. Management's Discussion and Analysis",
        "start": _start_rx(r"2\b", r"management'?s\s+discussion"),
        "end": re.compile(rf"^item\s*(3|4)\b{_SEP}[a-z]|^part\s+ii\b", re.I),
        "title": _MDNA_TITLE,
    },
    {
        "key": "risk_factors",
        "label": "Part II, Item 1A. Risk Factors",
        "start": _start_rx(r"1a\b", r"risk\s+factors\b"),
        "end": re.compile(rf"^item\s*(2|3|4|5|6)\b{_SEP}[a-z]", re.I),
        "title": "RISK FACTORS",
        # A 10-Q may leave Item 1A out (JNJ, MDT, GS) or mark it "Not applicable"
        # (GE) when the annual report's risk factors have not materially changed.
        "omissible": re.compile(rf"^(item\s*)?1a\b{_SEP}risk\s+factors\b.{{0,40}}\bnot\s+applicable", re.I),
    },
)

FORM_SECTIONS = {"10-K": SECTIONS, "10-Q": SECTIONS_10Q}
FORMS = tuple(FORM_SECTIONS)
_HEADING_MAX = 200         # a heading is a short block, not a sentence that mentions an item

# Running footers ("Apple Inc. | 2025 Form 10-K | 17", "24 2025 FORM 10-K",
# "2025 FORM 10-K 23") and bare page numbers.
_FURNITURE = (
    re.compile(r"^.{0,80}\|\s*(q[1-4]\s+)?(19|20)\d{2}\s+form\s+10-[kq]\s*\|\s*\d{1,3}$", re.I),
    re.compile(r"^(\d{1,3}\s+)?(19|20)\d{2}\s+form\s+10-[kq](\s+\d{1,3})?$", re.I),
    # "Goldman Sachs June 2026 Form 10-Q": a short block that ENDS with the form name
    re.compile(r"^.{0,50}\b(19|20)\d{2}\s+form\s+10-[kq](\s+\d{1,3})?$", re.I),
    re.compile(r"^(page\s+)?\d{1,3}$", re.I),
    re.compile(r"^table\s+of\s+contents$", re.I),
)


def _is_furniture(block: str) -> bool:
    return any(rx.match(block) for rx in _FURNITURE)


# ── heading recognition ─────────────────────────────────────────────────────
#
# Measured over 42 issuers (docs/terminal-research/10-roadmap/evidence/
# 2026-10-01-cov04-blackline-coverage), headings come in three shapes:
#   1. one block: "Item 1A. Risk Factors" (most filers);
#   2. SPLIT across blocks: "ITEM 1A." | "RISK FACTORS", or "ITEM" | "7." |
#      "MANAGEMENT'S DISCUSSION..." -- an item label with no title is joined
#      with the next one or two short blocks;
#   3. no item heading at all (a "Form 10-K Cross Reference Index" filer): the
#      section opens with an ALL-CAPS run-in title, "RISK FACTORS. The
#      following discussion...", and the next item's title ends it.
# Shape-2 documents also break SENTENCES into blocks, so a cross-reference
# ("...refer to" | "Part I. Item 1A. Risk Factors" | ".") looks like a heading.
# A candidate whose previous block leaves a sentence open, or whose next block
# continues one, is a reference, not a heading.

_ITEM_LEAD = re.compile(r"^item\s*\d", re.I)
_BARE_ITEM = re.compile(r"^item(\s*\d{1,2}[a-c]?)?\s*[.:]?$", re.I)
_PART_ONLY = re.compile(r"^(part)?\s*([ivx]+)?\s*[.,:]?$", re.I)
_CONNECTORS = {"in", "see", "to", "under", "of", "and", "or", "the", "our", "refer", "with", "at",
               "by", "from", "within", "per", "also", "including", "as", "this", "that", "for",
               "captioned", "entitled", "titled", "heading", "section"}
_JOIN_MAX = 8              # some filers emit a heading one WORD per block


def _heading_texts(blocks: list[str], i: int):
    """(text, blocks spanned) readings of a heading that starts at block i."""
    b = blocks[i]
    yield b, 1
    # "ITEM 1A." | "RISK FACTORS", or an ALL-CAPS line cut short: "ITEM 2. MANAGEMENT'S" | "DISCUSSION"
    if _BARE_ITEM.match(b) or (_ITEM_LEAD.match(b) and _CAPS_WORDS.fullmatch(b)):
        joined = b
        for k in range(1, _JOIN_MAX):
            if i + k >= len(blocks):
                return
            joined = f"{joined} {blocks[i + k]}"
            if len(joined) > _HEADING_MAX:
                return
            yield joined, k + 1


def _opens_sentence(block: str) -> bool:
    if block.endswith((",", ";", "(")):
        return True
    if block.endswith("\""):                           # '...under "Legal Proceedings."' is closed
        return not block.rstrip("\"")[-1:] in (".", "!", "?")
    words = re.findall(r"[A-Za-z]+", block)
    if not words or not block[-1:].isalpha():
        return False
    return words[-1] in _CONNECTORS or words[-1] in ("Part", "Item", "Form", "Section", "Note")


def _is_reference(blocks: list[str], i: int, span: int) -> bool:
    """True when the candidate at blocks[i:i+span] sits inside a sentence."""
    j = i - 1
    while j >= 0 and (_is_furniture(blocks[j]) or _PART_ONLY.match(blocks[j])):
        j -= 1
    if j >= 0 and _opens_sentence(blocks[j]):
        return True
    k = i + span
    if k < len(blocks):
        nxt = blocks[k]
        first = re.match(r"[A-Za-z]+", nxt)
        if nxt[:1] in (".", ",", ";", ":", ")") or (first and first.group(0) in _CONNECTORS):
            return True
    return False


def _match_at(blocks: list[str], i: int, rx) -> int:
    """Blocks spanned by a heading matching `rx` at block i, or 0."""
    for text, span in _heading_texts(blocks, i):
        if len(text) <= _HEADING_MAX and rx.match(text):
            if _is_reference(blocks, i, span):
                return 0
            # the rest of a split ALL-CAPS title ("...DISCUSSION" | "AND" | "ANALYSIS")
            while (i + span < len(blocks) and len(text) + len(blocks[i + span]) < _HEADING_MAX
                   and _CAPS_WORDS.fullmatch(blocks[i + span])):
                text = f"{text} {blocks[i + span]}"
                span += 1
            return span
    return 0


_CAPS_WORDS = re.compile(r"(?=.*[A-Z])[A-Z0-9 ,&'().\-]{1,60}")


# Shape 3: ALL-CAPS run-in titles. Case-SENSITIVE on purpose: "Risk Factors"
# in Title Case is a table-of-contents line or a sentence; "RISK FACTORS." is a
# section opening.
# The WHOLE official item title, then only an abbreviation and the run-in
# stop: "BUSINESS OVERVIEW AND ENVIRONMENT." is a subheading, not Item 1.
_TITLE_TAIL = r"(\s*\([A-Z&]{2,6}\))?(\.(\s|$)|:|$)"
_ITEM_TITLES = (r"BUSINESS|RISK FACTORS|UNRESOLVED STAFF COMMENTS|CYBERSECURITY|PROPERTIES|"
                r"LEGAL PROCEEDINGS|MINE SAFETY DISCLOSURES|"
                r"MARKET FOR (THE )?REGISTRANT'S COMMON EQUITY[A-Z ,]*|"
                r"MANAGEMENT'S DISCUSSION AND ANALYSIS( OF FINANCIAL CONDITION AND RESULTS OF OPERATIONS)?|"
                r"QUANTITATIVE AND QUALITATIVE DISCLOSURES? ABOUT MARKET RISKS?|"
                r"FINANCIAL STATEMENTS AND SUPPLEMENTARY DATA|CHANGES IN AND DISAGREEMENTS[A-Z ,]*|"
                r"CONTROLS AND PROCEDURES|OTHER INFORMATION|"
                r"DIRECTORS, EXECUTIVE OFFICERS AND CORPORATE GOVERNANCE|EXECUTIVE COMPENSATION|"
                r"UNREGISTERED SALES[A-Z ,]*|DEFAULTS UPON SENIOR SECURITIES|"
                r"EXHIBITS( AND FINANCIAL STATEMENT SCHEDULES)?")


_PROSE_MIN_WORDS = 6
_PAGE_REF = re.compile(r"\d{1,3}(\s*[-–]\s*\d{1,3})?")


def _has_prose(paras: list[str]) -> bool:
    """At least one sentence. An index or table of contents is page titles and
    page numbers, none of which ends like a sentence."""
    return any(len(p.split()) >= _PROSE_MIN_WORDS and p.rstrip("\"')").endswith((".", "!", "?"))
               for p in paras)


_TITLE_MENTION_MAX = 80    # a block this short that names the title is a heading or an index line
_TITLE_MAX_SHARE = 0.30    # GE: risk factors 2% and MD&A 16% of the filing's blocks


def _title_rx(title: str):
    return re.compile(rf"^({title}){_TITLE_TAIL}")


def _best_span(blocks: list[str], starts_at, ends_at):
    """(start, span, end, body) of the start heading with the longest body
    before the next end heading -- the TOC entry has none. `end` is None when
    a start was found but nothing after it ends the section."""
    best = None
    n = len(blocks)
    for s in range(n):
        span = starts_at(s)
        if not span:
            continue
        end = next((j for j in range(s + span, n) if ends_at(j)), None)
        if end is None:
            if best is None:
                best = (s, span, None, -1)
            continue
        body = sum(len(b) for b in blocks[s + span:end])
        if best is None or body > best[3]:
            best = (s, span, end, body)
    return best


def _continues(prev: str, cur: str) -> bool:
    """`cur` is the rest of the sentence `prev` started: a fragment that opens
    lowercase or with punctuation, or follows a block that ends mid-clause.
    (A page break, or a filer that emits one block per line, cuts a paragraph
    into pieces; diffing the pieces would report noise as changes.)"""
    if cur[:1] in (",", ";", ")") or (cur[:1] in (".", ":") and len(cur) <= 3):
        return True
    if cur[:1] in ("•", "◦", "▪", "·", "-", "–", "—", "*"):
        return False                                  # a list item is its own paragraph
    if _opens_sentence(prev) and not prev.endswith(";"):   # "a; b; and c" lists stay items
        return True
    if prev[-1:] in (".", "!", "?", ":", ";", "%", "$") or prev[-1:].isdigit():
        return False                                  # a finished sentence, or a table row
    # an all-lowercase first word: "iPhone" or "eBay" opens a new paragraph
    return bool(re.match(r"[a-z]+(?=[\s,.;:]|$)", cur))


# Share of a section's blocks that OPEN with an all-lowercase word, i.e. that
# are the middle of a sentence. Measured over 78 located 10-K sections
# (evidence dir above): ordinary filers 0.000-0.115 -- a table-heavy MD&A is
# full of short label cells, which is why "short block" is NOT the signal --
# while line-per-element filers are 0.27-0.89 (CALM 0.75/0.89, VRTX 0.69).
_FRAGMENT_SHARE = 0.25
_LOWER_WORD = re.compile(r"[a-z]+(?=[\s,.;:]|$)")


def _fragmented(raw: list[str]) -> bool:
    """A filer whose HTML puts every LINE (or word) in its own element."""
    return len(raw) >= 20 and sum(1 for b in raw if _LOWER_WORD.match(b)) / len(raw) >= _FRAGMENT_SHARE


def _joins(prev: str, cur: str) -> bool:
    """Fragmented layout: a block joins the paragraph before it unless that
    paragraph ended a sentence, or either side is a list item or heading."""
    if _continues(prev, cur):
        return True
    if prev[-1:] in (".", "!", "?", ":", ";") or cur[:1] in ("•", "◦", "▪", "·"):
        return False
    return not (_CAPS_WORDS.fullmatch(prev) or _CAPS_WORDS.fullmatch(cur))


def _collect(blocks: list[str], s: int, span: int, end: int, first: Optional[str] = None):
    heading = " ".join(blocks[s:s + span]).casefold()
    raw, furniture = ([first] if first else []), 0
    for b in blocks[s + span:end]:
        # a running page header that repeats the section's own heading (ACN)
        if _is_furniture(b) or (span and b.casefold() == heading and not first):
            furniture += 1
        else:
            raw.append(b)
    fragmented = _fragmented(raw)
    joins = _joins if fragmented else _continues
    paras: list[str] = []
    for b in raw:
        if paras and joins(paras[-1], b):
            sep = "" if b[:1] in (".", ",", ";", ":", ")") else " "
            paras[-1] = f"{paras[-1]}{sep}{b}"
        else:
            paras.append(b)
    while paras and _TRAILING_STUB.fullmatch(paras[-1]):   # "PART II" / "Item 1B, 1C" before the next item
        paras.pop()
        furniture += 1
    return paras, furniture, fragmented


_TRAILING_STUB = re.compile(r"(?i)(parts?\s+[ivx]+(\s+and\s+[ivx]+)?|items?\s*[\da-c]{1,3}(\s*[,&]\s*[\da-c]{1,3})*)\.?")


def locate_section(blocks: list[str], spec: dict) -> dict:
    """The section's paragraphs, or the reason it could not be located.

    A 10-K names every item twice -- once in the table of contents and once as
    the real heading -- so EVERY heading match is a candidate and the one with
    the longest body before the next item heading wins. A start heading with no
    end heading after it is not trusted (the section would run to the end of
    the document). Item headings (shapes 1 and 2) are tried first; a run-in
    title (shape 3) only when no item heading holds any text."""
    best = _best_span(blocks, lambda i: _match_at(blocks, i, spec["start"]),
                      lambda j: bool(_match_at(blocks, j, spec["end"])))
    if best is None:
        reason = f"no '{spec['label']}' heading in the document"
    elif best[2] is None:
        reason = f"'{spec['label']}' heading found but no following item heading ends it"
    else:
        s, span, end, _ = best
        paras, furniture, fragmented = _collect(blocks, s, span, end)
        if paras and not is_reference_only(paras) and not _has_prose(paras):
            # JPM/WFC 10-Q: the Item 2 heading exists only in a cross-reference
            # index, and what it "bounds" is a list of page titles.
            reason = (f"'{spec['label']}' heading bounds only short lines (an index of where the "
                      f"section is, not the section)")
        elif paras:
            return {"found": True, "heading": " ".join(blocks[s:s + span]), "paragraphs": paras,
                    "furniture_dropped": furniture, "reference_only": is_reference_only(paras),
                    "fragmented": fragmented}
        else:
            reason = f"'{spec['label']}' located but has no text"

    title = spec.get("title")
    if title:
        start_rx, end_rx, own = _title_rx(title), _title_rx(_ITEM_TITLES), re.compile(rf"^({title})", re.I)
        # ...or the whole title alone in its block, in any case (a bank's
        # "Management's Discussion and Analysis of Financial Condition..."
        # section whose Item 7 heading exists only in the index).
        alone = re.compile(rf"({title})(\s*\([A-Z&]{{2,6}}\))?\.?", re.I)
        def toc_line(i):            # "...Results of Operations (MD&A)" | "7": a contents entry
            return i + 1 < len(blocks) and bool(_PAGE_REF.fullmatch(blocks[i + 1]))
        t = _best_span(blocks, lambda i: 1 if (start_rx.match(blocks[i])
                                               or (alone.fullmatch(blocks[i]) and not toc_line(i))) else 0,
                       lambda j: (bool(end_rx.match(blocks[j])) and not own.match(blocks[j]))
                       or bool(_match_at(blocks, j, spec["end"])))
        if t is not None and t[2] is not None:
            s, _, end, _ = t
            m = start_rx.match(blocks[s]) or alone.fullmatch(blocks[s])
            rest = blocks[s][m.end():].strip()
            paras, furniture, fragmented = _collect(blocks, s, 1, end, first=rest or None)
            # A run-in title is only trusted when what it bounds looks like a
            # section: real prose (a table-of-contents run has none), and not
            # most of the filing (a title whose true end is not an item title,
            # e.g. a bank annual report's risk section, would run on through
            # the financial statements).
            ended_by_item = bool(_match_at(blocks, end, spec["end"]))
            if paras and not _has_prose(paras):
                reason += "; a section title for it bounds no prose"
            elif paras and not ended_by_item and (end - s) > _TITLE_MAX_SHARE * len(blocks):
                reason += ("; a section title for it was found but no item heading ends it, and the "
                           f"next item title is {end - s} of the filing's {len(blocks)} blocks later")
            elif paras:
                return {"found": True, "heading": blocks[s][:m.end()].strip(), "paragraphs": paras,
                        "furniture_dropped": furniture, "reference_only": is_reference_only(paras),
                        "fragmented": fragmented, "heading_shape": "title"}

    omissible = spec.get("omissible")
    if omissible is not None:
        marked = any(len(b) <= _HEADING_MAX and omissible.match(b) for b in blocks)
        # "Skipped" needs BOTH: the next item heading is there, and the title
        # appears in no heading-length block at all. A cross-reference-index
        # filer (USB: "2) Risk Factors (Item 1A)") HAS the section; we just
        # cannot locate it, and that is not_found, never omitted.
        titled = re.compile(spec["title"], re.I)
        skipped = (best is None
                   and not any(len(b) <= _TITLE_MENTION_MAX and titled.search(b) for b in blocks)
                   and any(_match_at(blocks, j, spec["end"]) for j in range(len(blocks))))
        if marked or skipped:
            how = "marks it 'Not applicable'" if marked else "goes straight to the next item"
            return {"found": False, "omitted": True,
                    "reason": f"the filing has no '{spec['label']}' text: it {how}, which a 10-Q may do "
                              f"when the risk factors in the last annual report have not materially changed"}
    return {"found": False, "reason": reason}


# A located section that only points elsewhere ("There have been no material
# changes to the risk factors disclosed in our Annual Report on Form 10-K").
# Common in a 10-Q's Part II Item 1A. Its text is real, but it is NOT the risk
# factors, so two such sections being identical says nothing about whether the
# risks changed.
_REFERENCE_MAX_CHARS = 1500
_REFERENCE_RX = re.compile(
    r"(no\s+material\s+changes?|not\s+materially\s+changed|"
    r"(refer|reference|see|discussed|described|disclosed|set\s+forth|found|included|incorporated|"
    r"contained|appears?|presented|located)\b[^.]{0,250}"
    r"(form\s+10-k|annual\s+report|exhibit\s+13|section|pages?\s+\d))", re.I)


def is_reference_only(paragraphs: list[str]) -> bool:
    text = " ".join(paragraphs)
    return len(text) <= _REFERENCE_MAX_CHARS and bool(_REFERENCE_RX.search(text))


# ── diff ────────────────────────────────────────────────────────────────────

_TOKEN = re.compile(r"\S+|\s+")
_FIGURE = re.compile(r"^[\(\[]?[$€£]?[\d][\d,.\-/%]*[\)\]]?[.,;:%)]*$|^[\-–—$%(),.;:]+$")
_MONTHS = {"january", "february", "march", "april", "may", "june", "july", "august",
           "september", "october", "november", "december"}


def _words(s: str) -> list[str]:
    return s.split()


def _ratio(a: str, b: str) -> float:
    return difflib.SequenceMatcher(None, _words(a), _words(b), autojunk=False).ratio()


def word_diff(old: str, new: str) -> list[dict]:
    """Word-level marks: [{op: eq|del|ins, text}], whitespace kept, runs merged."""
    a, b = _TOKEN.findall(old), _TOKEN.findall(new)
    out: list[dict] = []

    def push(op, toks):
        text = "".join(toks)
        if not text:
            return
        if out and out[-1]["op"] == op:
            out[-1]["text"] += text
        else:
            out.append({"op": op, "text": text})

    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            push("eq", a[i1:i2])
        else:
            push("del", a[i1:i2])
            push("ins", b[j1:j2])
    return out


def _is_boilerplate(segments: list[dict]) -> bool:
    """True when every changed word is a year, date or figure -- the change a
    filing makes to itself every year ('fiscal 2024' -> 'fiscal 2025')."""
    changed = [w for s in segments if s["op"] != "eq" for w in s["text"].split()]
    if not changed:
        return False
    return all(_FIGURE.match(w) or w.lower().strip(",.;:") in _MONTHS for w in changed)


def diff_paragraphs(older: list[str], newer: list[str]) -> dict:
    """Paragraph-level blackline. Unchanged paragraphs are counted, not listed."""
    items: list[dict] = []
    sm = difflib.SequenceMatcher(None, older, newer, autojunk=False)
    unchanged = 0
    for tag, i1, i2, j1, j2 in sm.get_opcodes():
        if tag == "equal":
            unchanged += i2 - i1
            continue
        olds, news = list(range(i1, i2)), list(range(j1, j2))
        ptr = 0
        for oi in olds:
            best_k, best_r = None, PAIR_MIN_RATIO
            for k in range(ptr, len(news)):
                r = _ratio(older[oi], newer[news[k]])
                if r >= best_r:
                    best_k, best_r = k, r
            if best_k is None:
                items.append({"kind": "removed", "older_index": oi, "text": older[oi]})
                continue
            for k in range(ptr, best_k):
                items.append({"kind": "added", "newer_index": news[k], "text": newer[news[k]]})
            segs = word_diff(older[oi], newer[news[best_k]])
            items.append({"kind": "changed", "older_index": oi, "newer_index": news[best_k],
                          "segments": segs, "boilerplate": _is_boilerplate(segs)})
            ptr = best_k + 1
        for k in range(ptr, len(news)):
            items.append({"kind": "added", "newer_index": news[k], "text": newer[news[k]]})

    # A paragraph removed in one place and added verbatim in another moved.
    removed_text = {}
    for it in items:
        if it["kind"] == "removed":
            removed_text.setdefault(it["text"], []).append(it)
    for it in items:
        if it["kind"] == "added" and removed_text.get(it["text"]):
            src = removed_text[it["text"]].pop(0)
            src["kind"] = "moved_from"
            it["kind"] = "moved"
            it["older_index"] = src["older_index"]
    items = [it for it in items if it["kind"] != "moved_from"]

    changed = [it for it in items if it["kind"] == "changed"]
    counts = {
        "added": sum(1 for it in items if it["kind"] == "added"),
        "removed": sum(1 for it in items if it["kind"] == "removed"),
        "changed": len(changed),
        "boilerplate_changed": sum(1 for it in changed if it["boilerplate"]),
        "moved": sum(1 for it in items if it["kind"] == "moved"),
        "unchanged": unchanged,
        "older_paragraphs": len(older),
        "newer_paragraphs": len(newer),
    }
    return {"counts": counts, "paragraphs": items}


def blackline_sections(older_doc: bytes | str, newer_doc: bytes | str, form: str = FORM) -> list[dict]:
    """Every supported section of `form`, located in both documents and diffed
    -- or `not_found` with the side(s) and the reason. Never counts for
    not_found. When BOTH sides only refer back to another filing the section
    is `reference_only`: located, but holding no content to compare, so it
    carries no counts either (identical pointers are not "no changes"). When
    BOTH filings leave an omissible section out it is `omitted`, also without
    counts."""
    ob, nb = html_blocks(older_doc), html_blocks(newer_doc)
    out = []
    for spec in FORM_SECTIONS[form]:
        o, n = locate_section(ob, spec), locate_section(nb, spec)
        sec = {"key": spec["key"], "label": spec["label"],
               "located": {"older": o["found"], "newer": n["found"]}}
        if o.get("omitted") and n.get("omitted"):
            sec.update({"state": "omitted",
                        "reason": f"neither filing includes it: {n['reason']}",
                        "counts": None, "paragraphs": None})
        elif not (o["found"] and n["found"]):
            reasons = []
            if not o["found"]:
                reasons.append(f"older filing: {o['reason']}")
            if not n["found"]:
                reasons.append(f"newer filing: {n['reason']}")
            sec.update({"state": "not_found", "reason": "; ".join(reasons),
                        "counts": None, "paragraphs": None})
        elif o["reference_only"] and n["reference_only"]:
            sec.update({"state": "reference_only",
                        "reason": "both filings only refer back to another filing for this section "
                                  "(for example 'no material changes from the Form 10-K'); "
                                  "there is no section text to compare",
                        "counts": None, "paragraphs": None,
                        "excerpt": {"older": " ".join(o["paragraphs"])[:600],
                                    "newer": " ".join(n["paragraphs"])[:600]}})
        else:
            d = diff_paragraphs(o["paragraphs"], n["paragraphs"])
            sec.update({"state": "ok", "counts": d["counts"], "paragraphs": d["paragraphs"],
                        "furniture_dropped": {"older": o["furniture_dropped"],
                                              "newer": n["furniture_dropped"]},
                        "reference_only": {"older": o["reference_only"],
                                           "newer": n["reference_only"]},
                        "reflowed": {"older": o["fragmented"], "newer": n["fragmented"]}})
        out.append(sec)
    return out


# ── filings ─────────────────────────────────────────────────────────────────

def _rows_of(block: dict, form: str) -> list[dict]:
    rows = []
    for i, f in enumerate((block or {}).get("form") or []):
        if f != form:
            continue

        def at(key):
            v = block.get(key) or []
            return v[i] if i < len(v) else None
        rows.append({"form": f, "accession": at("accessionNumber"), "filing_date": at("filingDate"),
                     "report_date": at("reportDate"), "primary_document": at("primaryDocument")})
    return rows


def list_filings(submissions: dict, form: str = FORM, n: int = 2, pages: list[dict] = ()) -> dict:
    """The newest `n` ORIGINAL filings of `form` in the submissions `recent`
    block plus any older `pages` already read (an amendment is often a partial
    document -- Part III only -- so it is never compared against a full one).
    `index_short` says older pages exist that were not read."""
    recent = ((submissions or {}).get("filings") or {}).get("recent") or {}
    rows = _rows_of(recent, form)
    for page in pages:
        rows.extend(_rows_of(page, form))
    seen, uniq = set(), []
    for r in rows:
        if r["accession"] not in seen:
            seen.add(r["accession"])
            uniq.append(r)
    uniq.sort(key=lambda r: (r["filing_date"] or "", r["accession"] or ""), reverse=True)
    files = ((submissions or {}).get("filings") or {}).get("files") or []
    unread_pages = len(files) > len(pages)
    return {"filings": uniq[:n], "index_short": unread_pages and len(uniq) < n}


# A heavy filer (a bank issuing thousands of structured notes) pushes its
# previous 10-K out of the `recent` block: JPM's older pages each hold ONE
# MONTH of filings (measured 2026-10-01). Each page lists its own date range,
# so the page that should hold the previous filing is read directly: the one
# overlapping the window where it is due, measured back from the newest one.
# At most this many pages are read.
_MAX_OLDER_PAGES = 3
_PERIOD_DAYS = {"10-K": (300, 430), "10-Q": (45, 200)}   # how far back the previous one is due
_CADENCE_DAYS = {"10-K": 365, "10-Q": 91}


def _due_pages(files: list[dict], form: str, newest: Optional[str]) -> list[dict]:
    if not newest:
        return files[:_MAX_OLDER_PAGES]
    from datetime import date, timedelta
    d = date.fromisoformat(newest)
    lo_days, hi_days = _PERIOD_DAYS.get(form, (0, 3650))
    lo, hi = (d - timedelta(days=hi_days)).isoformat(), (d - timedelta(days=lo_days)).isoformat()
    due = [f for f in files if (f.get("filingFrom") or "") <= hi and (f.get("filingTo") or "9999") >= lo]
    # nearest the usual cadence first (a year for a 10-K, a quarter for a 10-Q)
    expect = d - timedelta(days=_CADENCE_DAYS.get(form, 365))

    def miss(f):
        try:
            a, b = date.fromisoformat(f["filingFrom"]), date.fromisoformat(f["filingTo"])
        except (KeyError, TypeError, ValueError):
            return 10 ** 6
        return 0 if a <= expect <= b else min(abs((a - expect).days), abs((b - expect).days))
    return (sorted(due, key=miss) or files)[:_MAX_OLDER_PAGES]


def find_filings(submissions: dict, form: str, get, n: int = 2) -> dict:
    """`list_filings`, reading older submissions pages through `get` (the one
    SEC transport) when the `recent` block holds fewer than `n`."""
    pages: list[dict] = []
    listing = list_filings(submissions, form, n)
    if listing["index_short"]:
        files = ((submissions or {}).get("filings") or {}).get("files") or []
        newest = listing["filings"][0]["filing_date"] if listing["filings"] else None
        for f in _due_pages(files, form, newest):
            pages.append(json.loads(get(f"{_DATA}/submissions/{f['name']}")))
            listing = list_filings(submissions, form, n, pages)
            if len(listing["filings"]) >= n:
                break
    listing["pages_read"] = len(pages)
    return listing


def document_url(cik: str | int, accession: str, primary_document: str) -> str:
    return f"{_WWW}/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{primary_document}"


def index_url(cik: str | int, accession: str) -> str:
    return f"{_WWW}/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.htm"


def _sec_get(url: str) -> bytes:
    """The one SEC transport, via the repo's fair-access client. Indirection so
    tests replace it by name."""
    from api.services.fundamentals_pit import sec_client
    return sec_client.get_bytes(url, retries=_SEC_RETRIES, timeout=_SEC_TIMEOUT_S)


def _resolve_cik(sym: str) -> Optional[str]:
    from api.services.edgar import resolve_cik
    return resolve_cik(sym)


def _cite(cik: str, f: dict) -> dict:
    return {"form": f["form"], "accession": f["accession"], "filing_date": f["filing_date"],
            "report_date": f.get("report_date"),
            "url": document_url(cik, f["accession"], f["primary_document"]),
            "index_url": index_url(cik, f["accession"])}


def fetch_blackline(sym: str, form: str = FORM) -> dict:
    """OFF THE REQUEST PATH ONLY -- three SEC requests (plus at most
    `_MAX_OLDER_PAGES` submissions pages for a heavy filer). Raises the
    SecEdgarBlackline* error family: NotFound (no filer / fewer than two
    filings of `form`), Transient (SEC could not be read)."""
    from api.services.fundamentals_pit.sec_client import SecError

    if form not in FORM_SECTIONS:
        raise ValueError(f"unsupported form {form!r}")
    sym = (sym or "").upper().strip()
    cik = _resolve_cik(sym)
    if not cik:
        raise _ERR.not_found(f"no SEC filer matched {sym}")
    cik = str(cik).zfill(10)
    try:
        submissions = json.loads(_sec_get(f"{_DATA}/submissions/CIK{cik}.json"))
    except SecError as exc:
        if exc.status == 404:
            raise _ERR.not_found(f"no submissions for CIK {cik}", status=404) from exc
        raise _ERR.transient(f"submissions read failed for CIK {cik}: {exc}", status=exc.status) from exc
    except ValueError as exc:
        raise _ERR.transient(f"submissions for CIK {cik} were not JSON") from exc

    try:
        listing = find_filings(submissions, form, _sec_get)
    except SecError as exc:
        raise _ERR.transient(f"an older submissions page for CIK {cik} could not be read: {exc}",
                             status=exc.status) from exc
    except ValueError as exc:
        raise _ERR.transient(f"an older submissions page for CIK {cik} was not JSON") from exc
    filings = listing["filings"]
    if len(filings) < 2:
        why = (f"fewer than two original {form} filings in the submissions index pages read "
               f"(the recent block and {listing['pages_read']} older page(s)); further pages "
               f"are not read") if listing["index_short"] else \
              f"{len(filings)} original {form} on file; two are needed to compare"
        raise _ERR.not_found(why)
    newer, older = filings[0], filings[1]
    docs = {}
    for side, f in (("newer", newer), ("older", older)):
        if not f.get("accession") or not f.get("primary_document"):
            raise _ERR.transient(f"{side} {form} has no primary document listed")
        try:
            docs[side] = _sec_get(document_url(cik, f["accession"], f["primary_document"]))
        except SecError as exc:
            raise _ERR.transient(f"{side} {form} {f['accession']} could not be read: {exc}",
                                 status=exc.status) from exc

    sections = blackline_sections(docs["older"], docs["newer"], form)
    readable = [s for s in sections if s["state"] in ("ok", "reference_only", "omitted")]
    # R9: both filings were FOUND and read; only the sections could not be
    # located in them. That is its own state -- `not_found` is reserved for "no
    # filer / fewer than two filings", a different fact a reader must not be
    # handed in its place.
    return {
        "sym": sym,
        "cik": cik,
        "form": form,
        "state": "ok" if len(readable) == len(sections) else ("partial" if readable else "sections_unlocated"),
        "newer": _cite(cik, newer),
        "older": _cite(cik, older),
        "sections": sections,
        "vendor": VENDOR,
        "licensing_class": "A",
    }


# ── cache + background refresh ──────────────────────────────────────────────

_lock = threading.Lock()
_queued: set[tuple[str, str]] = set()
_executor: Optional[ThreadPoolExecutor] = None


def _key(sym: str, form: str = FORM) -> str:
    # The 10-K key is the slice-1 key unchanged, so a cache written before the
    # form selector existed is still read as what it is.
    return _CACHE_PREFIX + sym if form == FORM else f"{_CACHE_PREFIX}{sym}::{form}"


def _refresh(sym: str, form: str = FORM) -> dict:
    """Fetch, diff and cache one ticker's pair of `form`. Never raises."""
    import time
    try:
        snap = fetch_blackline(sym, form)
        ttl = _TTL_OK if snap["state"] == "ok" else _TTL_FAIL
    except _pe.ProviderNotFound as exc:
        snap = {"state": "not_found", "sym": sym, "detail": str(exc)}
        ttl = _TTL_NOT_FOUND
    except Exception as exc:  # noqa: BLE001 -- recorded as a state, never swallowed silently
        _logger.warning("filing blackline refresh failed for %s %s: %s", sym, form, exc)
        snap = {"state": "unavailable", "sym": sym, "detail": type(exc).__name__}
        ttl = _TTL_FAIL
    snap.setdefault("vendor", VENDOR)
    snap.setdefault("form", form)
    snap["fetched_at"] = time.time()
    cache.set(_key(sym, form), snap, ttl)
    return snap


def _run(sym: str, form: str = FORM) -> None:
    try:
        _refresh(sym, form)
    finally:
        with _lock:
            _queued.discard((sym, form))


def _schedule(sym: str, form: str = FORM) -> bool:
    """Queue one refresh on this module's own worker. Refuses when the flag is
    off, when the (ticker, form) is already queued, or when the queue is full."""
    global _executor
    if not is_enabled():
        return False
    with _lock:
        if (sym, form) in _queued or len(_queued) >= _MAX_QUEUED:
            return False
        _queued.add((sym, form))
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="filing-blackline")
        ex = _executor
    ex.submit(_run, sym, form)
    return True


def blackline_snapshot(sym: str, form: str = FORM) -> dict:
    """REQUEST PATH. Cache only; a miss queues a refresh and answers pending."""
    sym = (sym or "").upper().strip()
    if form not in FORM_SECTIONS:
        raise ValueError(f"unsupported form {form!r}")
    hit = cache.get(_key(sym, form))
    if hit is not None:
        return hit
    queued = _schedule(sym, form)
    return {"state": "pending", "sym": sym, "vendor": VENDOR, "form": form, "queued": queued}
