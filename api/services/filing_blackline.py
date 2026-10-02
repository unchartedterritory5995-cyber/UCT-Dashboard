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


class _Blocks(HTMLParser):
    """A flat list of text blocks in document order. Block-level tags end a
    block; table cells are joined inside their row; the inline-XBRL header and
    scripts/styles are not text."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks: list[str] = []
        self._buf: list[str] = []
        self._skip = 0

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


def _norm_ws(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(s).translate(_QUOTES)).strip()


def html_blocks(doc: bytes | str) -> list[str]:
    text = doc.decode("utf-8", "replace") if isinstance(doc, bytes) else doc
    p = _Blocks()
    p.feed(text)
    p.close()
    return p.blocks


# ── section location ────────────────────────────────────────────────────────

_SEP = r"[\s.:\-–—]*"
SECTIONS = (
    {
        "key": "risk_factors",
        "label": "Item 1A. Risk Factors",
        "start": re.compile(rf"^item\s*1a\b{_SEP}risk\s+factors\b", re.I),
        "end": re.compile(rf"^item\s*(1b|1c|2)\b{_SEP}[a-z]", re.I),
    },
    {
        "key": "mdna",
        "label": "Item 7. Management's Discussion and Analysis",
        "start": re.compile(rf"^item\s*7\b(?!a){_SEP}management'?s\s+discussion", re.I),
        "end": re.compile(rf"^item\s*(7a|8)\b{_SEP}[a-z]", re.I),
    },
)
_HEADING_MAX = 200         # a heading is a short block, not a sentence that mentions an item

# Running footers ("Apple Inc. | 2025 Form 10-K | 17") and bare page numbers.
_FURNITURE = (
    re.compile(r"^.{0,80}\|\s*(19|20)\d{2}\s+form\s+10-k\s*\|\s*\d{1,3}$", re.I),
    re.compile(r"^(page\s+)?\d{1,3}$", re.I),
    re.compile(r"^table\s+of\s+contents$", re.I),
)


def _is_furniture(block: str) -> bool:
    return any(rx.match(block) for rx in _FURNITURE)


def locate_section(blocks: list[str], spec: dict) -> dict:
    """The section's paragraphs, or the reason it could not be located.

    A 10-K names every item twice -- once in the table of contents and once as
    the real heading -- so EVERY heading match is a candidate and the one with
    the longest body before the next item heading wins. A start heading with no
    end heading after it is not trusted (the section would run to the end of
    the document)."""
    starts = [i for i, b in enumerate(blocks) if len(b) <= _HEADING_MAX and spec["start"].match(b)]
    if not starts:
        return {"found": False, "reason": f"no '{spec['label']}' heading in the document"}
    best = None
    for s in starts:
        end = next((j for j in range(s + 1, len(blocks))
                    if len(blocks[j]) <= _HEADING_MAX and spec["end"].match(blocks[j])), None)
        if end is None:
            continue
        body = sum(len(b) for b in blocks[s + 1:end])
        if best is None or body > best[2]:
            best = (s, end, body)
    if best is None:
        return {"found": False,
                "reason": f"'{spec['label']}' heading found but no following item heading ends it"}
    s, end, _ = best
    paras, furniture = [], 0
    for b in blocks[s + 1:end]:
        if _is_furniture(b):
            furniture += 1
        else:
            paras.append(b)
    if not paras:
        return {"found": False, "reason": f"'{spec['label']}' located but has no text"}
    return {"found": True, "heading": blocks[s], "paragraphs": paras, "furniture_dropped": furniture}


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


def blackline_sections(older_doc: bytes | str, newer_doc: bytes | str) -> list[dict]:
    """Every supported section, located in both documents and diffed -- or
    `not_found` with the side(s) and the reason. Never counts for not_found."""
    ob, nb = html_blocks(older_doc), html_blocks(newer_doc)
    out = []
    for spec in SECTIONS:
        o, n = locate_section(ob, spec), locate_section(nb, spec)
        sec = {"key": spec["key"], "label": spec["label"],
               "located": {"older": o["found"], "newer": n["found"]}}
        if not (o["found"] and n["found"]):
            reasons = []
            if not o["found"]:
                reasons.append(f"older filing: {o['reason']}")
            if not n["found"]:
                reasons.append(f"newer filing: {n['reason']}")
            sec.update({"state": "not_found", "reason": "; ".join(reasons),
                        "counts": None, "paragraphs": None})
        else:
            d = diff_paragraphs(o["paragraphs"], n["paragraphs"])
            sec.update({"state": "ok", "counts": d["counts"], "paragraphs": d["paragraphs"],
                        "furniture_dropped": {"older": o["furniture_dropped"],
                                              "newer": n["furniture_dropped"]}})
        out.append(sec)
    return out


# ── filings ─────────────────────────────────────────────────────────────────

def list_filings(submissions: dict, form: str = FORM, n: int = 2) -> dict:
    """The newest `n` ORIGINAL filings of `form` in the submissions `recent`
    block (an amendment is often a partial document -- Part III only -- so it
    is never compared against a full one). `index_short` says older pages exist
    that were not read."""
    recent = ((submissions or {}).get("filings") or {}).get("recent") or {}
    rows = []
    for i, f in enumerate(recent.get("form") or []):
        if f != form:
            continue

        def at(key):
            v = recent.get(key) or []
            return v[i] if i < len(v) else None
        rows.append({"form": f, "accession": at("accessionNumber"), "filing_date": at("filingDate"),
                     "report_date": at("reportDate"), "primary_document": at("primaryDocument")})
    rows.sort(key=lambda r: (r["filing_date"] or "", r["accession"] or ""), reverse=True)
    more_pages = bool(((submissions or {}).get("filings") or {}).get("files"))
    return {"filings": rows[:n], "index_short": more_pages and len(rows) < n}


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


def fetch_blackline(sym: str) -> dict:
    """OFF THE REQUEST PATH ONLY -- three SEC requests. Raises the
    SecEdgarBlackline* error family: NotFound (no filer / fewer than two
    10-Ks), Transient (SEC could not be read)."""
    from api.services.fundamentals_pit.sec_client import SecError

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

    listing = list_filings(submissions)
    filings = listing["filings"]
    if len(filings) < 2:
        why = ("the submissions index lists fewer than two 10-Ks in its recent block and older "
               "pages are not read in this slice") if listing["index_short"] else \
              f"{len(filings)} original 10-K on file; two are needed to compare"
        raise _ERR.not_found(why)
    newer, older = filings[0], filings[1]
    docs = {}
    for side, f in (("newer", newer), ("older", older)):
        if not f.get("accession") or not f.get("primary_document"):
            raise _ERR.transient(f"{side} 10-K has no primary document listed")
        try:
            docs[side] = _sec_get(document_url(cik, f["accession"], f["primary_document"]))
        except SecError as exc:
            raise _ERR.transient(f"{side} 10-K {f['accession']} could not be read: {exc}",
                                 status=exc.status) from exc

    sections = blackline_sections(docs["older"], docs["newer"])
    located = [s for s in sections if s["state"] == "ok"]
    return {
        "sym": sym,
        "cik": cik,
        "form": FORM,
        "state": "ok" if len(located) == len(sections) else ("partial" if located else "not_found"),
        "newer": _cite(cik, newer),
        "older": _cite(cik, older),
        "sections": sections,
        "vendor": VENDOR,
        "licensing_class": "A",
    }


# ── cache + background refresh ──────────────────────────────────────────────

_lock = threading.Lock()
_queued: set[str] = set()
_executor: Optional[ThreadPoolExecutor] = None


def _key(sym: str) -> str:
    return _CACHE_PREFIX + sym


def _refresh(sym: str) -> dict:
    """Fetch, diff and cache one ticker. Never raises."""
    import time
    try:
        snap = fetch_blackline(sym)
        ttl = _TTL_OK if snap["state"] == "ok" else _TTL_FAIL
    except _pe.ProviderNotFound as exc:
        snap = {"state": "not_found", "sym": sym, "detail": str(exc)}
        ttl = _TTL_NOT_FOUND
    except Exception as exc:  # noqa: BLE001 -- recorded as a state, never swallowed silently
        _logger.warning("filing blackline refresh failed for %s: %s", sym, exc)
        snap = {"state": "unavailable", "sym": sym, "detail": type(exc).__name__}
        ttl = _TTL_FAIL
    snap.setdefault("vendor", VENDOR)
    snap.setdefault("form", FORM)
    snap["fetched_at"] = time.time()
    cache.set(_key(sym), snap, ttl)
    return snap


def _run(sym: str) -> None:
    try:
        _refresh(sym)
    finally:
        with _lock:
            _queued.discard(sym)


def _schedule(sym: str) -> bool:
    """Queue one refresh on this module's own worker. Refuses when the flag is
    off, when the ticker is already queued, or when the queue is full."""
    global _executor
    if not is_enabled():
        return False
    with _lock:
        if sym in _queued or len(_queued) >= _MAX_QUEUED:
            return False
        _queued.add(sym)
        if _executor is None:
            _executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="filing-blackline")
        ex = _executor
    ex.submit(_run, sym)
    return True


def blackline_snapshot(sym: str) -> dict:
    """REQUEST PATH. Cache only; a miss queues a refresh and answers pending."""
    sym = (sym or "").upper().strip()
    hit = cache.get(_key(sym))
    if hit is not None:
        return hit
    queued = _schedule(sym)
    return {"state": "pending", "sym": sym, "vendor": VENDOR, "form": FORM, "queued": queued}
