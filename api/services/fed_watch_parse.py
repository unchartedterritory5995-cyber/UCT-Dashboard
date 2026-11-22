"""FED, the Terminal's Fed watch: the PURE half. No network, no clock, no files, no state.

Everything here takes bytes or plain values and returns plain values, so every rule can be tested
on invented samples (`tests/test_fed_watch.py`). The readers that fetch, hold and refresh live in
`api/services/fed_watch.py`.

SHAPES (each read once from the public page on 2026-11-21 and saved privately, never into the repo):

  The Board's RSS feeds (`https://www.federalreserve.gov/feeds/press_monetary.xml`, `speeches.xml`,
  `testimony.xml`): RSS 2.0 with a UTF-8 byte order mark, fifteen <item>s, newest first. Each item
  has <title>, <link> and <guid> (CDATA), <description> (CDATA, may carry HTML entities such as
  `&iacute;`), <category> and <pubDate> (CDATA, RFC 822 in GMT).
    monetary policy   "Federal Reserve issues FOMC statement" (exactly that title for a decision),
                      "Minutes of the Federal Open Market Committee, <meeting dates>",
                      "Federal Reserve Board and Federal Open Market Committee release economic
                      projections from the <meeting dates> FOMC meeting"; links are
                      /newsevents/pressreleases/monetaryYYYYMMDD<letter>.htm
    speeches          title "<Surname>, <speech title>"; description "Speech At <venue, place>"
    testimony         title "<Surname>, <title>"; description "Testimony Before <committee>"

  A statement page: <div id="article"> holds <p class="article__time"><date></p>, then the body
  as bare <p> paragraphs (the vote line, the statement, the voting record), then a media-inquiries
  paragraph and a link "Implementation Note issued <date>"; <div id="lastUpdate"> follows.

  The projections page (`/monetarypolicy/fomcprojtablYYYYMMDD.htm`, the accessible version of the
  Summary of Economic Projections): Table 1 is a <table> whose header row names a "Median" column
  group (an id) and, under it, one column per year and "Longer run" (`headers="<median id>"`); the
  row whose stub is "Federal funds rate" carries the medians in <td headers="<median id> <year id>
  …">.

  The New York Fed Survey of Market Expectations data file (`…/survey/YYYY/<mon>-YYYY-data.xlsx`):
  one sheet in long format, a header row of column names (survey_release_date, survey_due_date,
  panel_type, subject, question_type, question_tag, top_header_value, left_header_value, horizon,
  horizon_date, bucket_range, bucket_low, bucket_high, aggregation, aggregation_value, …). Rates are
  FRACTIONS (0.0388 is 3.88 percent). The rows read here: panel_type "Combined", subject
  "fed_funds_target_range", question_type "path_of_modes" (aggregation count / pctl25 / pctl50 /
  pctl75, per meeting or quarter) and "probability_distribution" (aggregation count / avg, per
  target range bucket and horizon).

EVERY PARSER FAILS CLOSED: a body that is not the expected shape raises `Shape` with plain words,
and the caller says so on the panel with a link to the page. Nothing is guessed. XML is parsed with
the standard library and only when it carries no document type declaration, so no entity is ever
expanded.
"""
from __future__ import annotations

import difflib
import html
import io
import math
import re
import zipfile
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any, Iterable, Optional
from xml.etree import ElementTree as ET

BOARD_HOST = "www.federalreserve.gov"
BOARD_BASE = f"https://{BOARD_HOST}"
NYFED_HOST = "www.newyorkfed.org"
NYFED_BASE = f"https://{NYFED_HOST}"

#: the most a list in the answer carries
MAX_SPEECHES = 15
MAX_HEADLINES = 30
MAX_WEEK_SPEAKERS = 20
#: the most words a statement may have before the redline refuses to work on it
MAX_STATEMENT_WORDS = 6000
#: a feed or page larger than this is not the page
MAX_FEED_ITEMS = 100


class Shape(Exception):
    """A body that is not the shape this module reads. `why` is plain words for the log and the panel."""

    def __init__(self, why: str):
        super().__init__(why)
        self.why = why


# ── small helpers ─────────────────────────────────────────────────────────────────────────────

_WS = re.compile(r"\s+")
_TAG = re.compile(r"<[^>]+>")


def clean_text(raw: Any) -> str:
    """HTML text -> plain words: tags dropped, entities read, every run of white space one space."""
    s = raw if isinstance(raw, str) else ""
    s = _TAG.sub(" ", s)
    s = html.unescape(s).replace("\xa0", " ")
    return _WS.sub(" ", s).strip()


def _no_doctype(body: bytes) -> None:
    upper = body.upper()
    if b"<!DOCTYPE" in upper or b"<!ENTITY" in upper:
        raise Shape("a document type declaration, which these files never carry; not parsed")


def _local(tag: Any) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def looks_like_html(body: bytes) -> bool:
    head = body[:400].lstrip(b"\xef\xbb\xbf \t\r\n").lower()
    return head.startswith((b"<!doctype html", b"<html"))


def on_host(url: Any, host: str) -> Optional[str]:
    """`url` when it is an https address on `host` with a plain path, else None (never followed)."""
    s = url.strip() if isinstance(url, str) else ""
    m = re.fullmatch(r"https://([A-Za-z0-9.\-]+)(/[A-Za-z0-9_./\-]*)", s)
    if not m or m.group(1).lower() != host or ".." in m.group(2):
        return None
    return s


# ── the Board's RSS feeds ──────────────────────────────────────────────────────────────────────

def parse_rss(body: bytes) -> list[dict]:
    """The items of one Board RSS feed, in feed order: {title, link, description, published (ISO, UTC)
    or None, category}. A link that is not on the Board's own host is None (never fetched). Raises
    `Shape` when the body is not an RSS feed."""
    if not isinstance(body, (bytes, bytearray)) or not body.strip():
        raise Shape("an empty answer")
    body = bytes(body).lstrip(b"\xef\xbb\xbf \t\r\n")
    if looks_like_html(body):
        raise Shape("a web page where the feed was expected")
    _no_doctype(body)
    try:
        root = ET.fromstring(body)
    except ET.ParseError:
        raise Shape("XML that is not well formed") from None
    if _local(root.tag) != "rss":
        raise Shape(f"a document whose root is <{_local(root.tag)[:40]}>, not an RSS feed")
    channel = next((el for el in root if _local(el.tag) == "channel"), None)
    if channel is None:
        raise Shape("an RSS feed with no channel")
    items: list[dict] = []
    for el in channel:
        if _local(el.tag) != "item":
            continue
        found = {_local(c.tag): (c.text or "") for c in el}
        published = None
        raw_date = found.get("pubDate", "").strip()
        if raw_date:
            try:
                dt = parsedate_to_datetime(raw_date)
                if dt.tzinfo is None:
                    dt = dt.replace(tzinfo=timezone.utc)
                published = dt.astimezone(timezone.utc).isoformat(timespec="seconds")
            except (TypeError, ValueError, IndexError):
                published = None
        items.append({
            "title": clean_text(found.get("title")),
            "link": on_host(found.get("link", "").strip(), BOARD_HOST),
            "description": clean_text(found.get("description")),
            "published": published,
            "category": clean_text(found.get("category")),
        })
        if len(items) >= MAX_FEED_ITEMS:
            break
    return items


STATEMENT_TITLE = re.compile(r"Federal Reserve issues FOMC statement", re.I)
MINUTES_TITLE = re.compile(r"Minutes of the Federal Open Market Committee,\s*(.+)", re.I)
PROJECTIONS_TITLE = re.compile(r".*\brelease economic projections from the (.+?) FOMC meeting\b.*", re.I)
PRESS_LINK = re.compile(r"https://www\.federalreserve\.gov/newsevents/pressreleases/monetary(\d{8})([a-z]\d?)\.htm")


def press_day(link: Optional[str]) -> Optional[str]:
    m = PRESS_LINK.fullmatch(link or "")
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y%m%d").date().isoformat()
    except ValueError:
        return None


def statement_items(items: Iterable[dict]) -> list[dict]:
    """The FOMC decision statements in a monetary policy feed, newest first: {date, url, title,
    published}. ONLY an item titled exactly "Federal Reserve issues FOMC statement" with a press
    release link on the Board's host counts; any other wording (a statement on longer-run goals, a
    joint statement, a renamed title) is left out, so the answer falls back to the statement before
    it, whose date is always on screen, and never fetches a page it does not recognise."""
    out = []
    for it in items:
        if not STATEMENT_TITLE.fullmatch(it.get("title") or ""):
            continue
        day = press_day(it.get("link"))
        if not day:
            continue
        out.append({"date": day, "url": it["link"], "title": it["title"], "published": it.get("published")})
    out.sort(key=lambda s: s["date"], reverse=True)
    return out


def minutes_item(items: Iterable[dict]) -> Optional[dict]:
    """The newest minutes in a monetary policy feed: {meeting, url, date}, or None."""
    best = None
    for it in items:
        m = MINUTES_TITLE.fullmatch(it.get("title") or "")
        day = press_day(it.get("link"))
        if m and day and (best is None or day > best["date"]):
            best = {"meeting": m.group(1).strip(), "url": it["link"], "date": day}
    return best


def projections_item(items: Iterable[dict]) -> Optional[dict]:
    """The newest projections release in a monetary policy feed: {meeting, date, release_url,
    table_url}, or None. The table page's address is the Board's own pattern for the accessible
    version, keyed by the release day; a page that is not there is said as such, never guessed past."""
    best = None
    for it in items:
        m = PROJECTIONS_TITLE.fullmatch(it.get("title") or "")
        day = press_day(it.get("link"))
        if m and day and (best is None or day > best["date"]):
            best = {"meeting": m.group(1).strip(), "date": day, "release_url": it["link"],
                    "table_url": f"{BOARD_BASE}/monetarypolicy/fomcprojtabl{day.replace('-', '')}.htm"}
    return best


_SPEECH_LEAD = re.compile(r"^(?:speech|remarks|testimony)\s+(?:at|before|to|by)\s+", re.I)


def speech_items(items: Iterable[dict], kind: str) -> list[dict]:
    """Speeches or testimony from a Board feed: {kind, speaker, title, venue, published, url}. The
    speaker is the surname before the first comma of the title, as the feed writes it; an item whose
    title has no comma keeps the whole title and no speaker."""
    out = []
    for it in items:
        title = it.get("title") or ""
        speaker, _, rest = title.partition(",")
        if not rest.strip():
            speaker, rest = "", title
        desc = it.get("description") or ""
        out.append({
            "kind": kind,
            "speaker": speaker.strip() or None,
            "title": rest.strip() or title,
            "venue": desc or None,
            "where": _SPEECH_LEAD.sub("", desc).strip() or None,
            "published": it.get("published"),
            "url": it.get("link"),
        })
    return out


def merge_speeches(*lists: list[dict], limit: int = MAX_SPEECHES) -> tuple[list[dict], int]:
    """(the newest `limit` speeches and testimony across the lists, how many there were)."""
    allx = [s for lst in lists for s in lst]
    allx.sort(key=lambda s: s.get("published") or "", reverse=True)
    return allx[:limit], len(allx)


# ── a statement page ───────────────────────────────────────────────────────────────────────────

_BARE_P = re.compile(r"<p>(.*?)</p>", re.S | re.I)
_ARTICLE_TIME = re.compile(r'<p class="article__time">(.*?)</p>', re.S | re.I)
_IMPL_LINK = re.compile(r'<a href="(/newsevents/pressreleases/monetary\d{8}[a-z]\d?\.htm)"[^>]*>\s*Implementation Note', re.I)
_STOP_PARA = re.compile(r"^(?:For media inquiries|Implementation Note issued|Attachment)", re.I)


def extract_statement(body: bytes) -> dict:
    """{date_text, paragraphs, implementation_note_url} from one statement page. The paragraphs are
    the Board's own words, in order, from the article body up to the media-inquiries line. Raises
    `Shape` when the page is not a statement page as read on 2026-11-21."""
    if not isinstance(body, (bytes, bytearray)) or not body.strip():
        raise Shape("an empty page")
    text = bytes(body).decode("utf-8", "replace")
    start = text.find('id="article"')
    if start < 0:
        raise Shape("no article on the page")
    end = text.find('id="lastUpdate"', start)
    region = text[start:end if end > start else len(text)]
    when = _ARTICLE_TIME.search(region)
    paragraphs: list[str] = []
    for m in _BARE_P.finditer(region):
        p = clean_text(m.group(1))
        if not p:
            continue
        if _STOP_PARA.match(p):
            break
        paragraphs.append(p)
    if len(paragraphs) < 2 or not any("Committee" in p for p in paragraphs):
        raise Shape("no statement text in the article")
    impl = _IMPL_LINK.search(region)
    return {
        "date_text": clean_text(when.group(1)) if when else None,
        "paragraphs": paragraphs,
        "implementation_note_url": f"{BOARD_BASE}{impl.group(1)}" if impl else None,
    }


# ── the redline ────────────────────────────────────────────────────────────────────────────────

_PARA = "¶"     # a paragraph boundary, a token no statement word can be


def _tokens(paragraphs: list[str]) -> list[str]:
    out: list[str] = []
    for i, p in enumerate(paragraphs):
        if i:
            out.append(_PARA)
        out.extend(p.split())
    return out


def redline(old: list[str], new: list[str]) -> dict:
    """The word-level difference between two statements (lists of paragraphs), in the NEW
    statement's order: {state, segments, added, removed}. A segment is {op: same | added | removed |
    break, text}; `break` is a paragraph boundary of the new statement. `added` and `removed` count
    words. state: 'ok' | 'same' (not one word differs) | 'too_long'. Standard library only
    (difflib), no model and no summary: the Board's own words and the plain difference."""
    a, b = _tokens(old), _tokens(new)
    if len(a) > MAX_STATEMENT_WORDS or len(b) > MAX_STATEMENT_WORDS:
        return {"state": "too_long", "segments": [], "added": 0, "removed": 0}
    segs: list[dict] = []

    def put(op: str, words: list[str]) -> None:
        for w in words:
            if w == _PARA:
                if op in ("same", "added") and segs and segs[-1]["op"] != "break":
                    segs.append({"op": "break", "text": ""})
                continue
            if segs and segs[-1]["op"] == op:
                segs[-1]["text"] += " " + w
            else:
                segs.append({"op": op, "text": w})

    added = removed = 0
    for tag, i1, i2, j1, j2 in difflib.SequenceMatcher(None, a, b, autojunk=False).get_opcodes():
        if tag == "equal":
            put("same", b[j1:j2])
        if tag in ("delete", "replace"):
            gone = [w for w in a[i1:i2] if w != _PARA]
            removed += len(gone)
            put("removed", gone)
        if tag in ("insert", "replace"):
            came = b[j1:j2]
            added += sum(1 for w in came if w != _PARA)
            put("added", came)
    while segs and segs[-1]["op"] == "break":
        segs.pop()
    return {"state": "same" if not added and not removed else "ok", "segments": segs,
            "added": added, "removed": removed}


# ── the projections page ───────────────────────────────────────────────────────────────────────

_TABLE = re.compile(r"<table\b[^>]*>(.*?)</table>", re.S | re.I)
_TR = re.compile(r"<tr\b[^>]*>(.*?)</tr>", re.S | re.I)
_CELL = re.compile(r"<(th|td)\b([^>]*)>(.*?)</\1>", re.S | re.I)
_ATTR = re.compile(r'([A-Za-z][\w\-]*)="([^"]*)"')
_SUP = re.compile(r"<sup\b[^>]*>.*?</sup>", re.S | re.I)
_MATERIALS_DATE = re.compile(r"<h3>\s*([A-Z][a-z]+ \d{1,2}, \d{4}):\s*FOMC Projections materials", re.I)


def _cells(row_html: str) -> list[tuple[str, dict, str]]:
    out = []
    for m in _CELL.finditer(row_html):
        attrs = dict(_ATTR.findall(m.group(2)))
        out.append((m.group(1).lower(), attrs, clean_text(_SUP.sub("", m.group(3)))))
    return out


def _rate(text: str) -> Optional[float]:
    s = (text or "").strip()
    if not re.fullmatch(r"\d{1,2}(?:\.\d{1,3})?", s):
        return None
    v = float(s)
    return v if 0.0 <= v <= 25.0 else None


def parse_projections(body: bytes) -> dict:
    """{medians: [{label, value}], materials_date} from the projections page: the median projection
    of the federal funds rate for each year and the longer run, in the table's own order, values in
    percent as printed. Raises `Shape` when Table 1, its Median columns or its federal funds rate row
    cannot be found, or when fewer than three medians can be read."""
    if not isinstance(body, (bytes, bytearray)) or not body.strip():
        raise Shape("an empty page")
    text = bytes(body).decode("utf-8", "replace")
    for tm in _TABLE.finditer(text):
        table = tm.group(1)
        if "Federal funds rate" not in table or "Median" not in table:
            continue
        rows = [_cells(r.group(1)) for r in _TR.finditer(table)]
        median_id = None
        for cells in rows:
            for kind, attrs, label in cells:
                if kind == "th" and label.startswith("Median") and attrs.get("id"):
                    median_id = attrs["id"]
                    break
            if median_id:
                break
        if not median_id:
            continue
        columns: dict[str, str] = {}
        order: list[str] = []
        for cells in rows:
            for kind, attrs, label in cells:
                if kind == "th" and attrs.get("headers") == median_id and attrs.get("id") and label:
                    columns[attrs["id"]] = label
                    order.append(attrs["id"])
        if not columns:
            continue
        for cells in rows:
            stub = next((label for kind, attrs, label in cells if kind == "th"), None)
            if stub != "Federal funds rate":
                continue
            values: dict[str, float] = {}
            for kind, attrs, label in cells:
                if kind != "td":
                    continue
                heads = (attrs.get("headers") or "").split()
                if median_id not in heads:
                    continue
                col = next((h for h in heads if h in columns), None)
                v = _rate(label)
                if col and v is not None and col not in values:
                    values[col] = v
            medians = [{"label": columns[c], "value": values[c]} for c in order if c in values]
            if len(medians) < 3:
                raise Shape("the federal funds rate row has fewer than three medians that can be read")
            when = _MATERIALS_DATE.search(text)
            return {"medians": medians, "materials_date": when.group(1) if when else None}
    raise Shape("no table with the median projection of the federal funds rate")


# ── the New York Fed survey ────────────────────────────────────────────────────────────────────

SURVEY_PAGE_PATH = "/markets/market-intelligence/survey-of-market-expectations"
_DATA_LINK = re.compile(r'href="(/medialibrary/media/markets/survey/(\d{4})/([a-z]{3})-(\d{4})-data\.xlsx)"', re.I)
_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
               "October", "November", "December"]


def survey_data_links(body: bytes) -> list[dict]:
    """The results data files the survey page links to, newest first: {url, year, month}."""
    text = bytes(body or b"").decode("utf-8", "replace")
    seen, out = set(), []
    for m in _DATA_LINK.finditer(text):
        mon = m.group(3).lower()
        if mon not in _MONTHS or m.group(2) != m.group(4) or m.group(1) in seen:
            continue
        seen.add(m.group(1))
        out.append({"url": f"{NYFED_BASE}{m.group(1)}", "year": int(m.group(4)), "month": _MONTHS.index(mon) + 1})
    out.sort(key=lambda d: (d["year"], d["month"]), reverse=True)
    return out


_SS_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_REL_NS = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
MAX_XLSX_PART = 30_000_000
MAX_XLSX_ROWS = 60_000


def _xml_part(z: zipfile.ZipFile, name: str) -> ET.Element:
    try:
        info = z.getinfo(name)
    except KeyError:
        raise Shape(f"a workbook without {name}") from None
    if info.file_size > MAX_XLSX_PART:
        raise Shape(f"a workbook part larger than {MAX_XLSX_PART // 1_000_000} MB")
    raw = z.read(name)
    _no_doctype(raw)
    try:
        return ET.fromstring(raw)
    except ET.ParseError:
        raise Shape(f"{name} is not well formed") from None


def _col(ref: str) -> str:
    m = re.match(r"[A-Z]+", ref or "")
    return m.group(0) if m else ""


def read_xlsx_rows(body: bytes) -> list[dict]:
    """The first sheet of a workbook as dict rows keyed by its header row (standard library only).
    Raises `Shape` when the body is not a workbook this reads."""
    try:
        z = zipfile.ZipFile(io.BytesIO(bytes(body or b"")))
    except zipfile.BadZipFile:
        raise Shape("not a workbook (not a zip file)") from None
    names = set(z.namelist())
    shared: list[str] = []
    if "xl/sharedStrings.xml" in names:
        for si in _xml_part(z, "xl/sharedStrings.xml").iter(_SS_NS + "si"):
            shared.append("".join(t.text or "" for t in si.iter(_SS_NS + "t")))
    sheet_name = "xl/worksheets/sheet1.xml"
    if "xl/workbook.xml" in names and "xl/_rels/workbook.xml.rels" in names:
        wb = _xml_part(z, "xl/workbook.xml")
        rels = {r.get("Id"): r.get("Target") for r in _xml_part(z, "xl/_rels/workbook.xml.rels")}
        first = next((s for s in wb.iter(_SS_NS + "sheet")), None)
        target = rels.get(first.get(_REL_NS + "id")) if first is not None else None
        if target:
            t = target.lstrip("/")
            sheet_name = t if t.startswith("xl/") else f"xl/{t}"
    sheet = _xml_part(z, sheet_name)
    header: Optional[dict] = None
    out: list[dict] = []
    for row in sheet.iter(_SS_NS + "row"):
        vals: dict[str, str] = {}
        for c in row.findall(_SS_NS + "c"):
            v = c.find(_SS_NS + "v")
            if c.get("t") == "inlineStr":
                txt = "".join(t.text or "" for t in c.iter(_SS_NS + "t"))
            elif v is None or v.text is None:
                continue
            elif c.get("t") == "s":
                try:
                    txt = shared[int(v.text)]
                except (ValueError, IndexError):
                    continue
            else:
                txt = v.text
            vals[_col(c.get("r") or "")] = txt
        if header is None:
            header = vals
            continue
        out.append({header[k]: v for k, v in vals.items() if k in header})
        if len(out) > MAX_XLSX_ROWS:
            raise Shape(f"a sheet with more than {MAX_XLSX_ROWS} rows")
    if not header or not out:
        raise Shape("an empty sheet")
    return out


def _frac(v: Any) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return f if math.isfinite(f) else None


def _pct(v: Any) -> Optional[float]:
    """A fraction (0.0388) as percent (3.88), rounded to 3 places; None when not a number."""
    f = _frac(v)
    return round(f * 100.0, 3) if f is not None else None


def _iso_day(v: Any) -> Optional[str]:
    s = str(v or "").strip()[:10]
    try:
        return date.fromisoformat(s).isoformat()
    except ValueError:
        return None


REQUIRED_SURVEY_COLUMNS = ("panel_type", "subject", "question_type", "aggregation", "aggregation_value")


def survey_extract(rows: list[dict]) -> dict:
    """What the panel shows from one survey's rows, every horizon kept (the answer filters by the
    day): {questions_sent, responses_due, path: [{label, date, median, p25, p75, respondents}],
    distributions: [{label, date, respondents, buckets: [{range, low, high, probability}]}]}. Rates
    and probabilities in percent. Raises `Shape` when the rows are not the survey's long format or
    carry neither question."""
    if not rows or any(k not in rows[0] for k in REQUIRED_SURVEY_COLUMNS[:3]):
        raise Shape("rows that are not the survey's long format")
    mine = [r for r in rows if r.get("panel_type") == "Combined" and r.get("subject") == "fed_funds_target_range"]
    sent = next((_iso_day(r.get("survey_release_date")) for r in rows if _iso_day(r.get("survey_release_date"))), None)
    due = next((_iso_day(r.get("survey_due_date")) for r in rows if _iso_day(r.get("survey_due_date"))), None)

    path: dict[tuple, dict] = {}
    for r in mine:
        if r.get("question_type") != "path_of_modes":
            continue
        label = (r.get("horizon") or r.get("top_header_value") or "").strip()
        if not label:
            continue
        key = (label, _iso_day(r.get("horizon_date")))
        h = path.setdefault(key, {"label": label, "date": key[1], "median": None, "p25": None, "p75": None,
                                  "respondents": None})
        agg, val = r.get("aggregation"), r.get("aggregation_value")
        if agg == "pctl50":
            h["median"] = _pct(val)
        elif agg == "pctl25":
            h["p25"] = _pct(val)
        elif agg == "pctl75":
            h["p75"] = _pct(val)
        elif agg == "count":
            n = _frac(val)
            h["respondents"] = int(n) if n is not None else None

    dists: dict[tuple, dict] = {}
    for r in mine:
        if r.get("question_type") != "probability_distribution":
            continue
        # top_header_value is the BUCKET in this question; the horizon is the left header
        # ("October 27-28", "Year-end 2026") or, for the longer run, the horizon itself
        label = (r.get("left_header_value") or r.get("horizon") or "").strip()
        rng = (r.get("bucket_range") or "").strip()
        if not label or not rng:
            continue
        key = (r.get("question_tag") or label, label, _iso_day(r.get("horizon_date")))
        d = dists.setdefault(key, {"label": label, "date": key[2], "respondents": None, "buckets": {}})
        b = d["buckets"].setdefault(rng, {"range": rng, "low": _pct(r.get("bucket_low")),
                                          "high": _pct(r.get("bucket_high")), "probability": None})
        if r.get("aggregation") == "avg":
            p = _frac(r.get("aggregation_value"))
            b["probability"] = round(p * 100.0, 1) if p is not None and 0.0 <= p <= 1.0 else None
        elif r.get("aggregation") == "count":
            n = _frac(r.get("aggregation_value"))
            if n is not None:
                d["respondents"] = max(d["respondents"] or 0, int(n))

    def bucket_order(b: dict) -> float:
        return b["low"] if b["low"] is not None else -1.0

    distributions = []
    for d in dists.values():
        buckets = sorted(d["buckets"].values(), key=bucket_order)
        if not any(b["probability"] is not None for b in buckets):
            continue
        distributions.append({**d, "buckets": buckets})
    distributions.sort(key=lambda d: (d["date"] is None, d["date"] or ""))
    path_list = sorted((h for h in path.values() if h["median"] is not None),
                       key=lambda h: (h["date"] is None, h["date"] or ""))
    if not path_list and not distributions:
        raise Shape("no federal funds target question in the survey's rows")
    return {"questions_sent": sent, "responses_due": due, "path": path_list, "distributions": distributions}


_MEETING_LABEL = re.compile(r"^[A-Z][a-z]{2,3}\.?\s+\d{1,2}(?:\s*-\s*(?:[A-Z][a-z]{2,3}\.?\s+)?\d{1,2})?\s+\d{4}$")


def is_meeting_label(label: str) -> bool:
    """'Dec. 8-9 2026' names a meeting; '2027 Q3' or 'Year-end 2026' does not."""
    return bool(_MEETING_LABEL.fullmatch((label or "").strip()))


def survey_view(extract: dict, today: str, *, meetings: int = 3, horizons: int = 3) -> dict:
    """The survey as the answer carries it on `today` (ISO, New York): the meeting it was taken
    before, the median path for the next `meetings` meetings ahead, and up to `horizons`
    probability distributions whose horizon has not passed (the longer run, which has no date, is
    kept). A horizon already passed is counted in `passed`, never shown as if it were ahead."""
    path = extract.get("path") or []
    due = extract.get("responses_due") or ""
    before = next((h for h in path if is_meeting_label(h["label"]) and h["date"] and h["date"] >= due), None)
    ahead = [h for h in path if is_meeting_label(h["label"]) and h["date"] and h["date"] >= today][:meetings]
    dists = extract.get("distributions") or []
    keep = [d for d in dists if d["date"] is None or d["date"] >= today]
    return {
        "questions_sent": extract.get("questions_sent"),
        "responses_due": extract.get("responses_due"),
        "before_meeting": {"label": before["label"], "date": before["date"]} if before else None,
        "path": ahead,
        "distributions": keep[:horizons],
        "passed": len(dists) - len(keep),
        "more": max(0, len(keep) - horizons),
    }


def next_meeting_from_survey(extract: Optional[dict], today: str) -> Optional[dict]:
    """The first meeting ahead named in the survey's list of meetings: {label, date}, or None."""
    for h in (extract or {}).get("path") or []:
        if is_meeting_label(h["label"]) and h["date"] and h["date"] >= today:
            return {"label": h["label"], "date": h["date"]}
    return None


# ── Fed headlines ──────────────────────────────────────────────────────────────────────────────

#: Words that mark a headline as about the Fed. "Fed" counts only written as the institution (title
#: case or capitals), so "fed up" and "well-fed" do not; a whole word only, so FedEx, Federated and
#: Fedora do not.
_FED_WORD = re.compile(r"\b(?:Fed|FED)\b")
_FOMC = re.compile(r"\bFOMC\b", re.I)
_FED_RESERVE = re.compile(r"\bfederal\s+reserve\b", re.I)
_ROLE = r"(?:Fed\s+)?(?:Chair(?:man|woman)?|Vice\s+Chair(?:man|woman)?|Governor|Gov\.|President)"
_SAYS = r"(?:says|said|sees|saw|speaks|spoke|testifies|testified|warns|warned|expects|remarks|comments|signals|signaled|notes|noted)"
#: Surnames shared with a well-known person or company in market news (Tim Cook, Williams-Sonoma,
#: Logan airport, a barrel price). For these a speaking verb is not enough: the headline must also
#: name the role ("Governor Cook") or carry a Fed word. The builder's default list, not a ruling.
AMBIGUOUS_SURNAMES = frozenset({"cook", "williams", "logan", "barr", "daly", "jefferson"})


def is_fed_headline(text: Any, surnames: Iterable[str] = ()) -> bool:
    """True when a news headline is about the Federal Reserve: FOMC, Federal Reserve, Fed (as the
    institution), or an official on the roster (`api/data/fed_speakers.json`) named the way wire
    headlines name them: after a role ("Governor Waller", "Fed Chair Warsh"), as the lead of a
    quote ("WALLER: …"), or with a speaking verb ("Waller says …"). A bare surname alone is not a
    mention of the official, and an ambiguous one needs its role (see AMBIGUOUS_SURNAMES)."""
    s = text if isinstance(text, str) else ""
    if not s.strip():
        return False
    if _FED_WORD.search(s) or _FOMC.search(s) or _FED_RESERVE.search(s):
        return True
    for name in surnames:
        n = str(name or "").strip()
        if not n or not n.isalpha():
            continue
        word = re.escape(n)
        if re.search(rf"\b{_ROLE}\s+{word}\b", s, re.I):
            return True
        if n.lower() in AMBIGUOUS_SURNAMES:
            continue
        if re.match(rf"\s*{word}\s*:", s, re.I) or re.search(rf"\b{word}\s+{_SAYS}\b", s, re.I):
            return True
    return False


# ── the economic calendar ──────────────────────────────────────────────────────────────────────

_FOMC_DECISION = re.compile(r"\b(?:fomc statement|interest rate decision|federal funds rate|fed funds rate)\b", re.I)
_NOT_DECISION = re.compile(r"\b(?:minutes|press conference|projections|speech|speaks|testimony|member)\b", re.I)


def is_fomc_decision(title: Any) -> bool:
    """An economic calendar row that is the FOMC's rate decision (the statement), not its minutes,
    press conference, projections or a speech."""
    t = title if isinstance(title, str) else ""
    return bool(_FOMC_DECISION.search(t)) and not _NOT_DECISION.search(t)


def calendar_days(payloads: Iterable[Optional[dict]]) -> dict[str, dict]:
    """{ISO day: that day's buckets} across the held calendar weeks (the first payload wins a day)."""
    out: dict[str, dict] = {}
    for p in payloads:
        for ds, day in ((p or {}).get("days") or {}).items():
            if isinstance(day, dict) and isinstance(ds, str) and ds not in out:
                out[ds] = day
    return out


def next_meeting_from_calendar(days: dict[str, dict], today: str) -> Optional[dict]:
    """The first FOMC decision on or after `today` in the held calendar days: {date, time, event}."""
    for ds in sorted(days):
        if ds < today:
            continue
        for row in (days[ds].get("econ") or []) + (days[ds].get("fed") or []):
            if isinstance(row, dict) and is_fomc_decision(row.get("event")):
                return {"date": ds, "time": row.get("time") or None, "event": clean_text(row.get("event"))}
    return None


def week_speakers(days: dict[str, dict], week_start: str, week_end: str, *, limit: int = MAX_WEEK_SPEAKERS) -> tuple[list[dict], int]:
    """(the Fed speaker rows the calendar flagged for this week, in day and clock order, how many)."""
    rows = []
    for ds in sorted(days):
        if not (week_start <= ds <= week_end):
            continue
        for row in days[ds].get("fed") or []:
            if isinstance(row, dict) and clean_text(row.get("event")):
                rows.append({"date": ds, "time": row.get("time") or None, "event": clean_text(row.get("event"))})

    def clock(r: dict) -> int:
        try:
            t = datetime.strptime(str(r["time"] or "").strip().upper(), "%I:%M %p")
            return t.hour * 60 + t.minute
        except ValueError:
            return 24 * 60
    rows.sort(key=lambda r: (r["date"], clock(r)))
    return rows[:limit], len(rows)


def week_bounds(today: date) -> tuple[str, str]:
    """(Monday, Friday) of the week `today` falls in, ISO."""
    monday = today - timedelta(days=today.weekday())
    return monday.isoformat(), (monday + timedelta(days=4)).isoformat()


def days_between(a: str, b: str) -> Optional[int]:
    try:
        return (date.fromisoformat(b) - date.fromisoformat(a)).days
    except (TypeError, ValueError):
        return None
