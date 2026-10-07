"""Deterministic parser for the cover-page share statement of pre-XBRL EDGAR filings (1993-2011).

Every 10-K / 10-Q (and 20-F / 40-F) cover carries the Exchange Act statement "Indicate the number of shares
outstanding of each of the issuer's classes of common stock, as of the latest practicable date" (20-F: "as of
the close of the period covered by the annual report"). Its phrasing varies; this parser recognizes a closed set
of shapes inside that STATEMENT WINDOW and refuses everything else:

  * two different counts that are not clearly two classes -> AMBIGUOUS (false negative over false positive);
  * dollar amounts (public float), authorized / issued-only / treasury / weighted counts are never counts;
  * a count without a date inside the plausibility window -> NO_DATE;
  * a cover naming two or more share classes -> MULTI_CLASS with per-class hits (never summed here), and
    `complete` only when every named class has exactly one count;
  * a 20-F table's ADS line is a SUBSET of the ordinary shares and is never a count of its own.

Output carries the snippet, its offset in the normalized text, the rule that fired and the status.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta

MONTHS = (r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?"
          r"|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)")
DATE = (rf"(?:{MONTHS}\.?\s+[l\d]\d?(?:st|nd|rd|th)?,?\s+[l\d]\d{{3}}|\d{{1,2}}(?:st|nd|rd|th)?\s+{MONTHS}\.?,?\s+\d{{4}}"
        r"|\d{1,2}/\d{1,2}/\d{2,4})")
NUM = r"(?<![\d$_,])(\d{1,3}(?:,\d{3})+|\d{5,})(?![\d,]*_\d)(?!\s*%)"
NUM_RX = re.compile(r"\d{1,3}(?:,\d{3})+|\d{5,}")

STATEMENT = re.compile(r"latest practicable date|number of (?:the )?(?:outstanding )?shares (?:outstanding )?of each"
                       r"|indicate (?:the )?number of shares outstanding|outstanding shares of each of the"
                       r"|close of the period covered by the annual report"
                       r"|shares outstanding of the registrant's (?:common|capital) stock", re.I)
WINDOW_END = re.compile(r"documents incorporated by reference|indicate by check mark|table of contents|\bpart\s+i\b"
                        r"|securities registered pursuant to section 12", re.I)
STOP = re.compile(r"\b(?:PART\s+I\b|TABLE OF CONTENTS|FINANCIAL INFORMATION|ITEM\s+1\.)", re.I)
NEG = re.compile(r"aggregate market value|non-?affiliates|authorized|treasury|weighted|average|options? to purchase"
                 r"|warrants?|preferred|held of record|holders of record", re.I)
ABBR = re.compile(r"\b(Inc|No|Co|Corp|Ltd|Nos|Par|Val|approx|plc)\.", re.I)
COMPLEX_WORDS = re.compile(r"tracking stock|exchangeable shares|special voting|partnership units|paired|stapled", re.I)


def normalize(raw: bytes | str) -> str:
    t = raw.decode("latin-1") if isinstance(raw, bytes) else raw
    t = re.sub(r"(?is)<(script|style)[^>]*>.*?</\1>", " ", t)
    t = re.sub(r"<[^>]+>", " ", t)
    t = html.unescape(t)
    for a, b in (("\xa0", " "), ("’", "'"), ("\x92", "'"), ("—", "-"), ("–", "-"), ("\x97", "-"), ("\x96", "-")):
        t = t.replace(a, b)
    return re.sub(r"\s+", " ", t)


def for_matching(t: str) -> str:
    """Neutralize periods that do not end a sentence ($0.01, $.25, Inc., U.S.) so [^.;] spans stay in one sentence."""
    t = re.sub(r"(?<=\d)\.(?=\d)", "_", t)
    t = re.sub(r"\$\.(?=\d)", "$_", t)
    t = re.sub(r"\b([A-Z])\.(?=[A-Z]\.)", r"\1", t)
    t = re.sub(r"\b([A-Z])\.(?=\s)", r"\1", t)
    t = ABBR.sub(lambda m: m.group(1), t)
    return t


def parse_date(s: str) -> date | None:
    s = s.strip().rstrip(".,")
    s = re.sub(r"(?<=\s)l(?=\d)|(?<=\d)l|^l", "1", s)          # OCR-style 'l996'
    s = re.sub(r"(\d)(st|nd|rd|th)\b", r"\1", s)
    s = re.sub(r"^(\w{3,9})\.", r"\1", s)
    s = re.sub(r"\s*,\s*", ", ", s)
    s = re.sub(r"\s+", " ", s).title()
    s = s.replace("Sept ", "Sep ").replace("Sept, ", "Sep, ")
    for fmt in ("%B %d, %Y", "%b %d, %Y", "%B %d %Y", "%b %d %Y", "%d %B, %Y", "%d %B %Y", "%d %b %Y", "%d %b, %Y",
                "%m/%d/%Y", "%m/%d/%y"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


@dataclass
class Hit:
    count: float
    as_of: date
    rule: str
    offset: int
    snippet: str
    class_label: str | None = None


@dataclass
class Result:
    status: str                       # OK | MULTI_CLASS | AMBIGUOUS | NOT_FOUND | NO_DATE
    hits: list = field(default_factory=list)
    note: str = ""
    complete: bool = False            # MULTI_CLASS: every class named in the cover has exactly one count
    classes: tuple = ()
    complex_words: tuple = ()


RULES = [
    ("NUMBER_AS_OF_WAS", re.compile(rf"(?:number of|there were)[^.;]{{0,180}}?outstanding[^.;]{{0,120}}?(?:as of|at|on)\s+({DATE})[^.;]{{0,90}}?(?:was|were|is|:|-)\s*(?:approximately\s+)?{NUM}", re.I)),
    # "The number of shares outstanding of the Registrant's Common Stock, par value $.01, was 21,984,597 as of November 2, 2011"
    ("NUMBER_WAS_N_AS_OF", re.compile(rf"number of[^.;]{{0,120}}?outstanding[^.;]{{0,120}}?(?:was|were|is)\s+(?:approximately\s+)?{NUM}\s+(?:shares\s+)?(?:as of|at|on)\s+({DATE})", re.I)),
    # "As of August 8, 2011, the Registrant had 47,439,040 outstanding shares of common stock"
    ("AS_OF_HAD_N_OUTSTANDING", re.compile(rf"(?:as of|at|on)\s+({DATE}),?\s*(?:there were|the registrant had|the company had|[a-z ,']{{0,60}}had)\s+(?:approximately\s+)?{NUM}\s+outstanding\s+(?:shares|ordinary shares|common shares)", re.I)),
    # "As of April 12, 2012, there were outstanding 3,286,294 shares of the registrant's common stock"
    ("AS_OF_THERE_WERE_OUTSTANDING", re.compile(rf"(?:as of|at|on)\s+({DATE}),?\s*there\s+were\s+outstanding\s+(?:approximately\s+)?{NUM}\s+(?:shares|ordinary shares|common shares)", re.I)),
    # "As of February 15, 2011, there were approximately 160.1 million shares of common stock issued and outstanding"
    ("APPROX_MILLIONS", re.compile(r"(?:as of|at|on)\s+(" + DATE + r"),?\s*there\s+were\s+(?:approximately\s+)?(\d{1,4}(?:_\d{1,3})?)\s+(million|billion)\s+shares[^.;]{0,120}?outstanding", re.I)),
    # "414.5 million shares of Common Stock outstanding as of February 25, 1995" / "6,703 million shares ..." (INTC 10-K)
    ("N_MILLION_SHARES_OUTSTANDING_AS_OF", re.compile(r"(?<![\d$_.,])(\d{1,3}(?:,\d{3})*(?:_\d{1,3})?)\s+(million|billion)\s+"
                                                      r"(?:shares|common shares|ordinary shares)(?:\s+of\s+[^.;$]{0,50}?)?\s+outstanding\s+"
                                                      r"(?:as of|at|on)\s+(" + DATE + r")", re.I)),
    ("AS_OF_N_SHARES", re.compile(rf"(?:as of|at|on)\s+({DATE}),?\s*(?:there were|the registrant had|the company had|[a-z ,']{{0,60}}had)?\s*(?:approximately\s+)?{NUM}\s+(?:shares|ordinary shares|common shares)[^.;]{{0,160}}?outstanding", re.I)),
    ("N_SHARES_OUTSTANDING_AS_OF", re.compile(rf"{NUM}\s+(?:shares|ordinary shares|common shares)[^.;]{{0,160}}?outstanding[^.;\d]{{0,60}}?(?:as of|at|on)\s+({DATE})", re.I)),
    ("LPD_N_SHARES_AS_OF", re.compile(rf"latest practicable date[^\d]{{0,60}}?{NUM}\s+(?:shares|ordinary shares|common shares)[^.;]{{0,120}}?(?:as of|at|on)\s+({DATE})", re.I)),
    ("TABLE_OUTSTANDING_AT", re.compile(rf"outstanding\s+(?:at|as of)\s+({DATE})[^.;]{{0,200}}?{NUM}\s*shares", re.I)),
    ("AS_OF_COLON", re.compile(rf"outstanding[^.;]{{0,160}}?(?:as of|at|on)\s+({DATE})\s*[:\-]\s*{NUM}", re.I)),
    ("CLOSE_OF_PERIOD", re.compile(rf"close of the (?:period|fiscal year) covered by (?:the|this) annual report[^;\d]{{0,40}}?[:\-]?\s*(?:there were\s+)?{NUM}", re.I)),
    # 20-F table: "Outstanding as of March 31, 2004 ... Title of Class ... Common Stock 926,418,280 ... American Depositary Shares ..."
    ("TABLE_20F_COMMON", re.compile(rf"outstanding\s+as\s+of\s+({DATE})[^;]{{0,260}}?(?:common stock|ordinary shares|common shares|shares of common stock)\s*\**\s*{NUM}", re.I)),
]
# shapes trusted ONLY inside the cover statement window (they carry no "outstanding" word of their own)
WINDOW_RULES = [
    # "Common Stock, $0.18 par value, 85,681,911 shares as of July 31, 2010"
    ("WIN_N_SHARES_AS_OF", re.compile(rf"{NUM}\s+(?:shares|common shares|ordinary shares)(?:\s+of\s+[^.;]{{0,60}}?)?\s+(?:as of|at|on)\s+({DATE})", re.I)),
    # "October 31, 2012 - 36,166,218 Common Shares ($5 par value)"
    ("WIN_DATE_DASH_N", re.compile(rf"({DATE})\s*[-:]\s*{NUM}\s+(?:common\s+|ordinary\s+)?shares", re.I)),
    # "Class Shares Outstanding at July 23, 2010 Common Stock, $0.06 Par Value 139,959,016"
    ("WIN_TABLE_BARE", re.compile(rf"outstanding\s+(?:shares\s+)?(?:at|as of)\s+({DATE})[^.;]{{0,160}}?{NUM}", re.I)),
    # "Class  Outstanding at March 30, 1996  Common Stock, $.001 par value  822.4 million" (INTC 1995-2009 shape)
    ("WIN_TABLE_MILLIONS", re.compile(r"outstanding\s+(?:shares\s+)?(?:at|as of)\s+(" + DATE + r")[^.;]{0,160}?"
                                      r"(?<![\d$_.,])(\d{1,3}(?:,\d{3})+(?:_\d{1,3})?|\d{1,4}(?:_\d{1,3})?)\s+(million|billion)\b"
                                      r"(?!\s*(?:dollars|of\s+dollars))",
                                      re.I)),
]
# per-class shapes inside the statement window
CLASS_RULES = [
    ("PC_N_SHARES_OF_CLASS", re.compile(rf"{NUM}\s+shares(?:\s+outstanding)?\s+of\s+(?:the\s+registrant's\s+|its\s+|our\s+|the\s+company's\s+)?class\s+([a-z])\b", re.I)),
    ("PC_CLASS_THEN_N", re.compile(rf"\bclass\s+([a-z])\s+(?:common|capital|ordinary)\s+(?:stock|shares)\b[^;]{{0,90}}?{NUM}\s*shares", re.I)),
    ("PC_CLASS_COLON_N", re.compile(rf"\bclass\s+([a-z])\s+(?:common\s+stock|common\s+shares|capital\s+stock)?[^;\d]{{0,60}}?(?:outstanding)?[:\-]\s*{NUM}", re.I)),
]
CLASS_RX_ANY = re.compile(r"\bclass\s+([a-z])\b", re.I)
CLASS_NAMED = re.compile(r"\bclass\s+([a-z])\b(?=[^.;]{0,40}(?:common|ordinary|capital|stock|shares))", re.I)


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def _date_before(text: str, pos: int) -> date | None:
    last = None
    for m in re.finditer(DATE, text[:pos], re.I):
        last = m
    return parse_date(last.group(0)) if last else None


def _statement_window(region: str) -> tuple[int, str]:
    m = STATEMENT.search(region)
    if not m:
        return -1, ""
    start = max(0, m.start() - 250)
    end = min(len(region), m.end() + 900)
    e = WINDOW_END.search(region, m.end() + 40, end)
    if e:
        end = e.start()
    return start, region[start:end]


def _rule_hits(text: str, base: int, report_date: date | None, rules=None) -> list[Hit]:
    hits, seen = [], set()
    for name, rx in (rules or RULES):
        for m in rx.finditer(text):
            g = [x for x in m.groups() if x]
            if name in ("APPROX_MILLIONS", "WIN_TABLE_MILLIONS", "N_MILLION_SHARES_OUTSTANDING_AS_OF"):
                if name == "N_MILLION_SHARES_OUTSTANDING_AS_OF":
                    mant, unit, ds = m.group(1), m.group(2).lower(), m.group(3)
                else:
                    ds, mant, unit = m.group(1), m.group(2), m.group(3).lower()
                unit = unit.lower()
                n = float(mant.replace(",", "").replace("_", ".")) * (1e6 if unit == "million" else 1e9)
                d = parse_date(ds)
                key = (n, d)
                if d and key not in seen:
                    seen.add(key)
                    hits.append(Hit(n, d, name, base + m.start(), text[m.start():m.end()][:400]))
                continue
            ns = next((x for x in g if NUM_RX.fullmatch(x)), None)
            ds = next((x for x in g if not NUM_RX.fullmatch(x) and parse_date(x)), None)
            if name == "CLOSE_OF_PERIOD" and ns and report_date:
                ds = report_date.strftime("%B %d, %Y")
            if not ds or not ns:
                continue
            snippet = text[m.start():m.end()]
            if NEG.search(snippet) and not re.search(r"outstanding", snippet[-100:], re.I):
                continue
            n, d = _num(ns), parse_date(ds)
            if n < 10000 or 1900 <= n <= 2100:
                continue
            npos = text.find(ns, m.start())
            if npos > 0 and "$" in text[max(0, npos - 3):npos]:
                continue
            if _qualified_not_outstanding(text, npos, len(ns)):
                continue
            if (n, d) in seen:
                continue
            seen.add((n, d))
            hits.append(Hit(n, d, name, base + m.start(), snippet[:400]))
    return hits


QUAL_AFTER = re.compile(r"^\s*(?:shares\s+)?(?:of\s+[a-z0-9$_,.' ]{0,70}?)?(?:were|are|is|was)?\s*"
                        r"(?:authorized|issued(?!\s+and\s+outstanding))", re.I)
QUAL_BEFORE = re.compile(r"(?:authorized|issued)\s*(?:shares)?\s*[:\-]?\s*$", re.I)


def _qualified_not_outstanding(text: str, npos: int, nlen: int) -> bool:
    """The number itself is qualified as AUTHORIZED or ISSUED-only ("11,860,040 shares ... were issued and
    11,154,890 were outstanding"; "150,000,000 shares ... authorized of which ..."): never an outstanding count."""
    after = text[npos + nlen: npos + nlen + 110]
    before = text[max(0, npos - 30): npos]
    return bool(QUAL_AFTER.search(after) or QUAL_BEFORE.search(before))


def _class_hits(window: str, base: int, stmt_date: date | None) -> list[Hit]:
    out: dict[str, Hit] = {}
    conflict = set()
    for name, rx in CLASS_RULES:
        for m in rx.finditer(window):
            g = m.groups()
            ns = next((x for x in g if x and NUM_RX.fullmatch(x)), None)
            cl = next((x for x in g if x and re.fullmatch(r"[a-zA-Z]", x)), None)
            if not ns or not cl:
                continue
            n = _num(ns)
            if n < 1000 or 1900 <= n <= 2100:
                continue
            npos = window.find(ns, m.start())
            if npos > 0 and "$" in window[max(0, npos - 3):npos]:
                continue
            d = stmt_date or _date_before(window, m.start() + 1) or _date_before(window, m.end())
            if d is None:
                continue
            cl = cl.upper()
            if cl in out and out[cl].count != n:
                conflict.add(cl)
            out.setdefault(cl, Hit(n, d, name, base + m.start(), window[m.start():m.end()][:300], cl))
    return [h for c, h in sorted(out.items()) if c not in conflict]


def parse(text: str, filing_date: date, form: str, max_chars: int = 30000, report_date: date | None = None) -> Result:
    head = for_matching(text[:max_chars])
    stop = next((m.start() for m in STOP.finditer(head) if m.start() > 1500), None)
    region = head[:stop] if stop else head
    w0, window = _statement_window(region)
    hits = _rule_hits(window, w0, report_date) if window else []
    if not hits and window:
        hits = _rule_hits(window, w0, report_date, WINDOW_RULES)      # window-only shapes
    if not hits:
        hits = _rule_hits(region, 0, report_date)
    scope = window or region
    classes = sorted({c.upper() for c in CLASS_NAMED.findall(scope)})
    # a hit whose own statement names a share class ("Common Stock Class A, $.25 Par 9,609,809") is a CLASS count
    for h in hits:
        near = CLASS_RX_ANY.findall(h.snippet)
        if near:
            h.class_label = ",".join(sorted({x.upper() for x in near}))
            classes = sorted(set(classes) | {x.upper() for x in near} | ({"?"} if len(set(near)) == 1 else set()))
    cw = tuple(sorted({m.group(0).lower() for m in COMPLEX_WORDS.finditer(scope)}))
    lo = filing_date - timedelta(days=400 if form.startswith(("20-F", "40-F")) else 200)
    hi = filing_date + timedelta(days=3)
    if len(classes) >= 2:
        dates = {h.as_of for h in hits if lo <= h.as_of <= hi}
        stmt_date = next(iter(dates)) if len(dates) == 1 else None
        ch = [h for h in _class_hits(scope, max(w0, 0), stmt_date) if lo <= h.as_of <= hi]
        got = {h.class_label for h in ch}
        return Result("MULTI_CLASS", ch, f"cover names classes {classes}",
                      complete=(got == set(classes) and len(ch) == len(classes)), classes=tuple(classes), complex_words=cw)
    if not hits:
        return Result("NOT_FOUND", complex_words=cw)
    ok = [h for h in hits if lo <= h.as_of <= hi]
    if not ok:
        return Result("NO_DATE", hits, "no count dated inside the plausibility window", complex_words=cw)
    counts = {h.count for h in ok}
    if len(counts) == 1:
        return Result("OK", [sorted(ok, key=lambda h: h.offset)[0]], complex_words=cw)
    return Result("AMBIGUOUS", ok, f"{len(counts)} different counts", complex_words=cw)
