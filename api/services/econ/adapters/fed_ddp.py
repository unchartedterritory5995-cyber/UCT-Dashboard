"""Federal Reserve Board adapter -- release-page SDMX XML (default) / DDP CSV packages.

THE ENDPOINT FAMILY IS A PARAMETER (``source.params.transport``), because the
Board is retiring the Data Download Program (DDP) -- see
``docs/economic-data/fed-ddp-retirement.md``:

  ``release_xml`` (DEFAULT, survives the retirement)
      ``https://www.federalreserve.gov/releases/<rel>/data/FRB_<rel>_xml.zip``
      The Board's July 16 2026 notice: "Historical data will remain available for
      download as XML files on statistical release pages." One zip = the whole
      release (SDMX-ML 1.0 compact, ``<frb:DataSet id=...><kf:Series
      SERIES_NAME=... UNIT=... UNIT_MULT=...><frb:Obs TIME_PERIOD OBS_VALUE
      OBS_STATUS>``). Static file: real ETag + Last-Modified -> cheap conditional
      polling (latest mode only). Sizes 1.4 MB (H.6) .. 9 MB (H.4.1) zipped.
  ``ddp_package``
      ``/datadownload/Output.aspx?rel=<REL>&series=<package hash>&type=package``
      Preformatted CSV package. 5 metadata rows (Series Description, Unit,
      Multiplier, Currency, Unique Identifier) + "Time Period" header, in
      ``layout=seriescolumn`` (series = columns) or ``seriesrow`` (series = rows;
      G.17 packages are published this way). Needs ``params.package``. The Board
      plans to remove preformatted packages "later this year and in 2027".
      Last-Modified = generation time (never a publication time); no ETag.
  ``ddp_zip``
      ``/datadownload/Output.aspx?rel=<REL>&filetype=zip`` -- the same SDMX zip
      served by the DDP application; dies with the DDP. Fallback only.

``source.params`` contract (read here, nothing else):
  release     "H15" | "H41" | "H6" | "G17" | ...            (required)
  series      DDP mnemonic, e.g. "RIFLGFCY10_N.B"           (fallback: last
              segment of source.provider_series_id)
  dataset     DDP dataset id inside the release, e.g. "H15", "H6_M2",
              "IP_MARKET_GROUPS"  (optional but checked when present: the
              Unique Identifier / DataSet id must match)
  transport   release_xml | ddp_package | ddp_zip          (default release_xml)
  fallback    list of transports tried when the primary one is GONE (404/410,
              an HTML page or empty 200 instead of data). Default: ddp_package ->
              [release_xml]; release_xml -> [ddp_zip]; ddp_zip -> [release_xml].
              [] disables fallback.
  package     DDP package hash (ddp_package only)
  layout      seriescolumn | seriesrow (ddp_package only; default seriescolumn)
  unit / multiplier / currency   optional explicit identity expectations; when
              absent they are DERIVED from the registry ``units.raw`` (see
              ``expected_identity``).
  latest_n    periods returned in latest mode (default by frequency)

IDENTITY VALIDATION (fail closed, MalformedPayload): the requested mnemonic must
be present (in the requested dataset if given); unit, multiplier and currency
must match the registry. E.g. the G.17 annual revision on 2026-11-24 re-bases IP
to 2022=100 -> "Index:_2022_100" != registry "Index 2017=100" -> refused until
the registry is updated, never silently re-scaled.

Missing markers: CSV ``ND`` / ``NC`` / ``NA`` / empty, SDMX ``OBS_STATUS`` in
{ND, NC, NA} or the ``-9999`` sentinel -> ``None`` (never 0).

``ND`` on a DAILY series is not an observation. The release zip's own code list
(``H15_struct.xml`` CL_OBS_STATUS, archived 2026-09-28) reads: A "Normal",
NA "Not available", ND "No data", NC "Not calculable". H.15 business-day
series (FREQ 9) carry ND exactly on market holidays (UST10Y: 720 ND, 0 NA/NC,
every one a federal/SIFMA holiday or closure). A holiday has no period, so
``to_obs`` DROPS ND rows of frequency-D series (``DROP_NO_DATA_FREQS``); NA/NC
(a genuinely missing value for a day that exists) and empty cells stay ``None``.
Non-daily ND rows stay ``None`` (a stated missing period). Keeping the holiday
row placed a null at the prior business day's availability time, where it won
the same-date collapse and masked the real value (481 UST10Y2Y points, 548
breaks in the 2026-09-29 harness).

Periods come from the registry frequency: D -> the day; W -> the 7-day week
ending on the stated date (H.4.1 Wednesday); M/Q/A -> the calendar period that
contains the stated label (CSV "2026-08", SDMX month-END date "2026-08-31").

``source_published_at`` is never set: DDP Last-Modified is generation time and
the release-file Last-Modified is a re-post time (H.6 2026-09-22 file stamped
20:05 ET for a 13:00 ET release; G.17 stamped 09-22 for a 09-18 release).
Publication is confirmed through ``arrivals()`` (RSS) + the scheduler.
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from datetime import date
from email.utils import parsedate_to_datetime
from typing import Any, Iterable, Optional
from xml.etree import ElementTree as ET

from .. import http as econ_http
from .. import timeutil
from ..model import FetchResult, MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, SeriesSpec, as_specs, register

BASE = "https://www.federalreserve.gov"
DDP_OUTPUT = BASE + "/datadownload/Output.aspx"
DDP_CHOOSE = BASE + "/datadownload/Choose.aspx"
FEED_ALL = BASE + "/feeds/datadownload.xml"

TRANSPORTS = ("release_xml", "ddp_package", "ddp_zip")
DEFAULT_TRANSPORT = "release_xml"
DEFAULT_FALLBACK = {"ddp_package": ["release_xml"], "release_xml": ["ddp_zip"],
                    "ddp_zip": ["release_xml"]}
LATEST_N = {"D": 10, "W": 8, "M": 13, "Q": 8, "A": 3, "IRREG": 10}

NA_TOKENS = frozenset({"ND", "NC", "NA", "N/A", ""})
NA_STATUSES = frozenset({"ND", "NC", "NA"})
NO_DATA = "ND"                        # "No data": a non-business day of a business-day series
DROP_NO_DATA_FREQS = frozenset({"D"})
SENTINEL = -9999.0

_REL_RE = re.compile(r"^[A-Za-z][A-Za-z0-9.]{0,15}$")
_HASH_RE = re.compile(r"^[0-9a-f]{32}$")


class TransportGone(SourceUnavailable):
    """The endpoint answered with 'not here any more' (404/410/HTML page/empty 200)."""


# --------------------------------------------------------------------------- identity

def release_of(spec: SeriesSpec) -> str:
    rel = str(spec.params.get("release") or "").strip()
    if not rel:
        psid = spec.provider_series_id or ""
        rel = psid.split("/")[0] if "/" in psid else ""
    if not _REL_RE.match(rel):
        raise MalformedPayload(f"{spec.symbol}: fed_ddp params.release missing/invalid")
    return rel.upper()


def mnemonic_of(spec: SeriesSpec) -> str:
    s = str(spec.params.get("series") or "").strip()
    if not s:
        psid = spec.provider_series_id or ""
        s = psid.rsplit("/", 1)[-1] if psid else ""
    if not s:
        raise MalformedPayload(f"{spec.symbol}: fed_ddp params.series missing")
    return s


def dataset_of(spec: SeriesSpec) -> Optional[str]:
    d = spec.params.get("dataset")
    return str(d).strip() if d else None


_MULT_WORDS = (("trillion", 1e12), ("billion", 1e9), ("million", 1e6), ("thousand", 1e3))


def expected_identity(spec: SeriesSpec) -> dict:
    """{unit_re, multiplier, currency} the provider metadata must satisfy.

    Explicit ``params.unit`` / ``params.multiplier`` / ``params.currency`` win;
    otherwise derived from ``units.raw``:
      "Percent..."            -> unit ~ Percent, multiplier 1
      "Index 2017=100"        -> unit == Index:_2017_100, multiplier 1
      "<Millions|Billions> USD" -> unit Currency, currency USD, multiplier 1e6|1e9
    Anything else -> no unit check (multiplier still checked when derivable).
    """
    p = spec.params
    raw = str(spec.units.get("raw") or "")
    low = raw.lower()
    out: dict[str, Any] = {"unit_re": None, "multiplier": None, "currency": None}
    if p.get("unit"):
        out["unit_re"] = re.compile(re.escape(str(p["unit"])) + r"$", re.I)
    if p.get("multiplier") is not None:
        out["multiplier"] = float(p["multiplier"])
    if p.get("currency"):
        out["currency"] = str(p["currency"]).upper()
    if out["unit_re"] is None:
        m = re.search(r"index\s*(\d{4})\s*=\s*100", low)
        if m:
            out["unit_re"] = re.compile(rf"^Index:_{m.group(1)}_100$", re.I)
        elif low.startswith("percent"):
            out["unit_re"] = re.compile(r"^Percent", re.I)
        elif "usd" in low or "dollar" in low:
            out["unit_re"] = re.compile(r"^Currency$", re.I)
    if out["currency"] is None and ("usd" in low or "dollar" in low):
        out["currency"] = "USD"
    if out["multiplier"] is None:
        mult = 1.0
        for word, m_ in _MULT_WORDS:
            if word in low:
                mult = m_
                break
        if out["unit_re"] is not None or mult != 1.0:
            out["multiplier"] = mult
    return out


def check_identity(spec: SeriesSpec, meta: dict) -> list[str]:
    """Reasons (secret-free, no raw payload text beyond short provider codes)."""
    exp = expected_identity(spec)
    bad: list[str] = []
    unit = str(meta.get("unit") or "").strip()
    if exp["unit_re"] is not None and not exp["unit_re"].search(unit):
        bad.append(f"unit {unit[:40]!r} does not match registry {spec.units.get('raw')!r}")
    if exp["multiplier"] is not None:
        try:
            got = float(str(meta.get("multiplier") or "").strip())
        except ValueError:
            got = None
        if got is None or abs(got - exp["multiplier"]) > 1e-9 * max(1.0, exp["multiplier"]):
            bad.append(f"multiplier {str(meta.get('multiplier'))[:20]!r} != {exp['multiplier']:g}")
    if exp["currency"] is not None:
        cur = str(meta.get("currency") or "").strip().upper()
        if cur != exp["currency"]:
            bad.append(f"currency {cur[:10]!r} != {exp['currency']}")
    return bad


# --------------------------------------------------------------------------- periods

def _freq(spec: SeriesSpec) -> str:
    return str(spec.frequency or "").upper()


def period_of(label: str, spec: SeriesSpec) -> tuple[str, str]:
    """Provider period label -> ISO (period_start, period_end) per registry frequency."""
    s = str(label).strip()
    f = _freq(spec)
    try:
        if f in ("M", "Q", "A"):
            m = re.fullmatch(r"(\d{4})-(\d{2})(?:-(\d{2}))?", s)
            q = re.fullmatch(r"(\d{4})\s*-?\s*Q([1-4])", s, re.I)
            if q and f == "Q":
                ps, pe = timeutil.quarter_bounds(int(q.group(1)), int(q.group(2)))
            elif re.fullmatch(r"\d{4}", s) and f == "A":
                ps, pe = timeutil.year_bounds(int(s))
            elif m:
                y, mo = int(m.group(1)), int(m.group(2))
                if f == "M":
                    ps, pe = timeutil.month_bounds(y, mo)
                elif f == "Q":
                    ps, pe = timeutil.quarter_bounds_of(date(y, mo, 1))
                else:
                    ps, pe = timeutil.year_bounds(y)
            else:
                raise ValueError("label")
        elif f == "W":
            ps, pe = timeutil.week_bounds(s, spec.week_anchor or None)
        elif f in ("D", "IRREG"):
            d = timeutil.as_date(s)
            ps, pe = d, d
        else:
            raise MalformedPayload(f"{spec.symbol}: unsupported frequency {f!r}")
    except MalformedPayload:
        raise
    except Exception:  # noqa: BLE001 -- never echo the raw label
        raise MalformedPayload(f"{spec.symbol}: unparseable period label for frequency {f}") from None
    return ps.isoformat(), pe.isoformat()


def parse_value(raw: Any, status: Optional[str] = None) -> Optional[float]:
    if status is not None and str(status).strip().upper() in NA_STATUSES:
        return None
    s = str(raw if raw is not None else "").strip().replace(",", "")
    if s.upper() in NA_TOKENS:
        return None
    try:
        v = float(s)
    except ValueError:
        raise MalformedPayload("non-numeric value in Fed payload") from None
    if v == SENTINEL:
        return None
    if v != v or v in (float("inf"), float("-inf")):
        raise MalformedPayload("non-finite value in Fed payload")
    return v


# --------------------------------------------------------------------------- parsers

def _looks_like_html(body: bytes) -> bool:
    head = body.lstrip()[:200].lower()
    return head.startswith(b"<!doctype html") or head.startswith(b"<html") or b"<html" in head


def parse_ddp_csv(body: bytes) -> dict[str, dict]:
    """DDP package CSV (either layout) -> {mnemonic: {"meta": {...}, "rows": [(label, raw)]}}.

    meta keys: description, unit, multiplier, currency, uid, dataset.
    """
    if not body or not body.strip():
        raise TransportGone("DDP package: empty body")
    if _looks_like_html(body):
        raise TransportGone("DDP package: HTML page instead of CSV")
    text = body.decode("utf-8-sig", "replace")
    rows = list(csv.reader(io.StringIO(text)))
    rows = [r for r in rows if any(c.strip() for c in r)]
    if len(rows) < 2:
        raise MalformedPayload("DDP package: too few rows")
    first = rows[0][0].strip().rstrip(":").lower() if rows[0] else ""
    if first == "series description":
        return _parse_seriescolumn(rows)
    if first == "description":
        return _parse_seriesrow(rows)
    raise MalformedPayload("DDP package: unrecognised header layout")


_META_KEYS = {"series description": "description", "description": "description", "unit": "unit",
              "multiplier": "multiplier", "currency": "currency",
              "unique identifier": "uid", "series name": "name", "time period": "name"}


def _meta_key(cell: str) -> Optional[str]:
    return _META_KEYS.get(cell.strip().rstrip(":").strip().lower())


def _finish_meta(meta: dict) -> dict:
    uid = str(meta.get("uid") or "").strip()
    parts = uid.split("/")
    meta["dataset"] = parts[1] if len(parts) == 3 else None
    meta["release"] = parts[0] if len(parts) == 3 else None
    return meta


def _parse_seriescolumn(rows: list[list[str]]) -> dict[str, dict]:
    head: dict[str, list[str]] = {}
    i = 0
    while i < len(rows) and _meta_key(rows[i][0]) is not None:
        head[_meta_key(rows[i][0])] = rows[i]
        i += 1
        if _meta_key(rows[i - 1][0]) == "name":
            break
    if "name" not in head or "uid" not in head:
        raise MalformedPayload("DDP package: missing Unique Identifier / Time Period header")
    names = head["name"]
    out: dict[str, dict] = {}
    for c in range(1, len(names)):
        mn = names[c].strip()
        if not mn:
            continue
        meta = {k: (v[c] if c < len(v) else "") for k, v in head.items() if k != "name"}
        out[mn] = {"meta": _finish_meta(meta), "rows": []}
    for r in rows[i:]:
        label = r[0].strip()
        for c in range(1, len(names)):
            mn = names[c].strip()
            if mn in out:
                out[mn]["rows"].append((label, r[c] if c < len(r) else ""))
    return out


def _parse_seriesrow(rows: list[list[str]]) -> dict[str, dict]:
    header = rows[0]
    keys = [_meta_key(h) for h in header]
    if "name" not in keys or "uid" not in keys:
        raise MalformedPayload("DDP package: seriesrow header lacks Series Name / Unique Identifier")
    first_period = next((i for i, k in enumerate(keys) if k is None), len(header))
    periods = [h.strip() for h in header[first_period:]]
    out: dict[str, dict] = {}
    for r in rows[1:]:
        meta = {k: (r[i] if i < len(r) else "") for i, k in enumerate(keys[:first_period]) if k}
        mn = str(meta.pop("name", "")).strip()
        if not mn:
            continue
        vals = r[first_period:]
        out[mn] = {"meta": _finish_meta(meta),
                   "rows": [(p, vals[j] if j < len(vals) else "") for j, p in enumerate(periods)]}
    return out


def parse_sdmx_zip(body: bytes, wanted: Iterable[str]) -> dict[tuple[str, str], dict]:
    """Release SDMX zip -> {(dataset, mnemonic): {"meta": {...}, "rows": [(label, raw, status)]}}.

    Streams the (up to 126 MB) data XML; only ``wanted`` mnemonics are kept.
    """
    if not body or not body.strip():
        raise TransportGone("release XML: empty body")
    if _looks_like_html(body):
        raise TransportGone("release XML: HTML page instead of zip")
    try:
        zf = zipfile.ZipFile(io.BytesIO(body))
    except zipfile.BadZipFile:
        raise MalformedPayload("release XML: not a zip archive") from None
    names = [n for n in zf.namelist() if n.lower().endswith("_data.xml")]
    if len(names) != 1:
        raise MalformedPayload("release XML: expected exactly one *_data.xml member")
    want = set(wanted)
    out: dict[tuple[str, str], dict] = {}
    dataset: Optional[str] = None
    try:
        with zf.open(names[0]) as fh:
            for ev, el in ET.iterparse(fh, events=("start", "end")):
                tag = el.tag.rsplit("}", 1)[-1]
                if ev == "start":
                    if tag == "DataSet":
                        dataset = el.get("id")
                    continue
                if tag == "Series":
                    mn = el.get("SERIES_NAME")
                    if mn in want:
                        rows = [(o.get("TIME_PERIOD"), o.get("OBS_VALUE"), o.get("OBS_STATUS"))
                                for o in el if o.tag.rsplit("}", 1)[-1] == "Obs"]
                        meta = {"unit": el.get("UNIT"), "multiplier": el.get("UNIT_MULT"),
                                "currency": el.get("CURRENCY"), "dataset": dataset,
                                "freq": el.get("FREQ"), "uid": f"{dataset}/{mn}"}
                        out[(dataset or "", mn)] = {"meta": meta, "rows": rows}
                    el.clear()
                elif tag == "DataSet":
                    el.clear()
    except ET.ParseError:
        raise MalformedPayload("release XML: data member is not well-formed XML") from None
    return out


def select_series(parsed: dict, spec: SeriesSpec) -> dict:
    """Pick the spec's series out of a parsed payload; identity checked. MalformedPayload if absent."""
    mn, ds = mnemonic_of(spec), dataset_of(spec)
    if not parsed:
        raise MalformedPayload(f"{spec.symbol}: payload carries no series")
    if isinstance(next(iter(parsed)), tuple):                   # SDMX: keyed (dataset, mnemonic)
        hits = {k: v for k, v in parsed.items() if k[1] == mn}
        if ds is not None:
            hits = {k: v for k, v in hits.items() if k[0] == ds}
        if not hits:
            raise MalformedPayload(f"{spec.symbol}: series not present in release payload"
                                   + (f" dataset {ds}" if ds else ""))
        series = hits[sorted(hits)[0]]
    else:                                                        # CSV: keyed mnemonic
        series = parsed.get(mn)
        if series is None:
            raise MalformedPayload(f"{spec.symbol}: series not present in DDP package")
        got_ds = series["meta"].get("dataset")
        if ds is not None and got_ds is not None and got_ds != ds:
            raise MalformedPayload(f"{spec.symbol}: identity: unique identifier dataset {got_ds!r} != {ds!r}")
    bad = check_identity(spec, series["meta"])
    if bad:
        raise MalformedPayload(f"{spec.symbol}: identity: " + "; ".join(bad))
    return series


def is_no_data(raw: Any, status: Optional[str] = None) -> bool:
    """The provider's ND ("No data") marker: SDMX OBS_STATUS=ND, or a CSV cell 'ND'."""
    if status is not None and str(status).strip().upper() == NO_DATA:
        return True
    return status is None and str(raw if raw is not None else "").strip().upper() == NO_DATA


def to_obs(spec: SeriesSpec, series: dict) -> list[RawObs]:
    out: dict[str, RawObs] = {}
    for row in series["rows"]:
        label, raw = row[0], row[1]
        status = row[2] if len(row) > 2 else None
        if label is None or not str(label).strip():
            raise MalformedPayload(f"{spec.symbol}: row without a period label")
        ps, pe = period_of(label, spec)
        if _freq(spec) in DROP_NO_DATA_FREQS and is_no_data(raw, status):
            continue                                  # a holiday: no period exists
        v = parse_value(raw, status)
        flag = ""
        if status and str(status).upper() not in ("A",) and str(status).upper() not in NA_STATUSES:
            flag = str(status).lower()[:4]
        o = RawObs(spec.symbol, ps, pe, v, flag)
        prev = out.get(ps)
        if prev is not None and (prev.value, prev.flag) != (o.value, o.flag):
            raise MalformedPayload(f"{spec.symbol}: duplicate period with different values")
        out[ps] = o
    return [out[k] for k in sorted(out)]


# --------------------------------------------------------------------------- RSS arrivals

_DATA_TITLE = re.compile(r"data (?:for|through) .* (?:are|is) now available", re.I)


def parse_feed(body: bytes) -> list[dict]:
    """Fed RSS 1.0 (RDF) feed -> [{release, title, published_at, kind, link}] newest first.

    kind = "data" for "<REL>: ... Data for <period> are now available" items,
    else "notice". published_at = unix seconds (from dc:date / pubDate).
    """
    if not body or not body.strip():
        raise MalformedPayload("Fed feed: empty body")
    if _looks_like_html(body):
        raise MalformedPayload("Fed feed: HTML page instead of RSS")
    try:
        root = ET.fromstring(_xml_entities(body.lstrip(b"\xef\xbb\xbf").strip()))
    except ET.ParseError:
        raise MalformedPayload("Fed feed: not well-formed XML") from None
    items = []
    for el in root.iter():
        if el.tag.rsplit("}", 1)[-1] != "item":
            continue
        f = {c.tag.rsplit("}", 1)[-1]: c for c in el.iter()}
        title = (f["title"].text or "").strip() if "title" in f else ""
        kw = ""
        for c in el.iter():
            if c.tag.rsplit("}", 1)[-1] == "keyword" and c.text:
                kw = c.text.strip()
        when = None
        for k in ("date", "occurrenceDate", "pubDate"):
            if k in f and f[k].text:
                when = _parse_when(f[k].text.strip())
                if when is not None:
                    break
        rel = kw or (title.split(":", 1)[0].strip() if ":" in title else "")
        items.append({"release": rel.upper(), "title": title[:300], "published_at": when,
                      "kind": "data" if _DATA_TITLE.search(title) else "notice",
                      "link": (f["link"].text or "").strip() if "link" in f else ""})
    items.sort(key=lambda i: i["published_at"] or 0, reverse=True)
    return items


_ENTITY = re.compile(rb"&([A-Za-z][A-Za-z0-9]{1,31});")
_XML_ENTITIES = frozenset({b"amp", b"lt", b"gt", b"quot", b"apos"})


def _xml_entities(body: bytes) -> bytes:
    """The Board's feeds embed HTML named entities (``&ndash;``, live G.17 feed
    2026-06-15 item) that XML does not define -> numeric references."""
    from html.entities import name2codepoint

    def sub(m):
        name = m.group(1)
        if name in _XML_ENTITIES:
            return m.group(0)
        cp = name2codepoint.get(name.decode("ascii"))
        return f"&#{cp};".encode() if cp else b"&amp;" + name + b";"
    return _ENTITY.sub(sub, body)


def _parse_when(s: str) -> Optional[int]:
    from datetime import datetime
    try:
        return int(datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp())
    except ValueError:
        pass
    try:
        return int(parsedate_to_datetime(s).timestamp())
    except (TypeError, ValueError, IndexError):
        return None


def package_links(choose_html: str, release: str) -> list[dict]:
    """Choose.aspx HTML -> [{package, layout, lastobs}] (preformatted package links)."""
    out, seen = [], set()
    for m in re.finditer(r"rel=" + re.escape(release) + r"&(?:amp;)?series=([0-9a-f]{32})([^\"'<>]*)",
                         choose_html, re.I):
        h, rest = m.group(1), m.group(2)
        lay = re.search(r"layout=(seriescolumn|seriesrow)", rest)
        if h not in seen:
            seen.add(h)
            out.append({"package": h, "layout": lay.group(1) if lay else "seriescolumn"})
    return out


# --------------------------------------------------------------------------- adapter

@register
class FedDdpAdapter(BaseAdapter):
    name = "fed_ddp"
    key_env = None                      # keyless (the Board publishes no key-based API)
    max_series_per_request = 50         # one file carries a whole release

    def __init__(self, *, default_transport: str = DEFAULT_TRANSPORT):
        if default_transport not in TRANSPORTS:
            raise ValueError(f"unknown fed_ddp transport {default_transport!r}")
        self.default_transport = default_transport

    # ---------------------------------------------------------------- planning
    def transport_of(self, spec: SeriesSpec) -> str:
        t = str(spec.params.get("transport") or self.default_transport)
        if t not in TRANSPORTS:
            raise MalformedPayload(f"{spec.symbol}: unknown fed_ddp transport {t!r}")
        return t

    def fallbacks_of(self, spec: SeriesSpec, transport: str) -> list[str]:
        fb = spec.params.get("fallback")
        if fb is None:
            fb = DEFAULT_FALLBACK[transport]
        if isinstance(fb, str):
            fb = [fb]
        out = [t for t in fb if t in TRANSPORTS and t != transport]
        if transport != "ddp_package":
            out = [t for t in out if t != "ddp_package" or spec.params.get("package")]
        return out

    def group(self, specs) -> list[tuple[tuple, list[SeriesSpec]]]:
        groups: dict[tuple, list[SeriesSpec]] = {}
        for s in as_specs(specs):
            t = self.transport_of(s)
            pkg = str(s.params.get("package") or "") if t == "ddp_package" else ""
            if t == "ddp_package" and not _HASH_RE.match(pkg):
                raise MalformedPayload(f"{s.symbol}: ddp_package transport needs params.package (32-hex)")
            lay = str(s.params.get("layout") or "seriescolumn") if t == "ddp_package" else ""
            fb = tuple(self.fallbacks_of(s, t))
            groups.setdefault((release_of(s), t, pkg, lay, fb), []).append(s)
        out = []
        for key, members in groups.items():
            for i in range(0, len(members), self.max_series_per_request):
                out.append((key, members[i:i + self.max_series_per_request]))
        return out

    @staticmethod
    def latest_n(specs: list[SeriesSpec]) -> int:
        n = 0
        for s in specs:
            n = max(n, int(s.params.get("latest_n") or LATEST_N.get(_freq(s), 13)))
        return n

    @staticmethod
    def url_for(transport: str, release: str, *, package: str = "", layout: str = "seriescolumn",
                lastobs: Optional[int] = None, start: Optional[date] = None,
                end: Optional[date] = None) -> str:
        if transport == "release_xml":
            r = release.lower()
            return f"{BASE}/releases/{r}/data/FRB_{r}_xml.zip"
        if transport == "ddp_zip":
            return f"{DDP_OUTPUT}?rel={release}&filetype=zip"
        return (f"{DDP_OUTPUT}?rel={release}&series={package}"
                f"&lastobs={lastobs if lastobs else ''}"
                f"&from={start.strftime('%m/%d/%Y') if start else ''}"
                f"&to={end.strftime('%m/%d/%Y') if end else ''}"
                f"&filetype=csv&label=include&layout={layout}&type=package")

    @staticmethod
    def request_key(transport: str, release: str, package: str, specs: list[SeriesSpec], mode: str,
                    start: Optional[date], end: Optional[date]) -> str:
        mns = ",".join(sorted(mnemonic_of(s) for s in specs))
        span = "latest" if mode == "latest" else f"{start or ''}..{end or ''}"
        return f"fed_ddp:{transport}:{release}:{package or '-'}:{mns}:{span}"

    # ---------------------------------------------------------------- fetch
    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None) -> list[FetchResult]:
        if mode not in ("history", "latest"):
            raise ValueError(f"mode must be history|latest, not {mode!r}")
        if http is None:
            raise ValueError("fed_ddp.fetch needs an HttpClient")
        results = []
        for (release, transport, pkg, layout, fb), members in self.group(specs):
            results.append(self._fetch_group(release, transport, pkg, layout, list(fb), members,
                                             mode=mode, start=start, end=end, http=http))
        return results

    def _fetch_group(self, release, transport, pkg, layout, fallbacks, specs, *, mode, start, end, http):
        warnings: list[str] = []
        chain = [transport] + fallbacks
        last_err: Optional[Exception] = None
        for i, t in enumerate(chain):
            try:
                res = self._fetch_transport(release, t, pkg, layout, specs, mode=mode, start=start,
                                            end=end, http=http)
            except TransportGone as e:
                last_err = e
                if i + 1 < len(chain):
                    warnings.append(f"transport {t} unavailable ({str(e)[:80]}); falling back to {chain[i + 1]}")
                continue
            res.warnings = warnings + res.warnings
            return res
        raise last_err if last_err else SourceUnavailable(f"fed_ddp {release}: no transport")

    def _get(self, http, url: str, conditional_key: Optional[str]):
        resp = http.get(url, conditional_key=conditional_key, defer_validators=bool(conditional_key))
        if resp.not_modified:
            return resp
        if resp.status in (404, 410):
            raise TransportGone(f"HTTP {resp.status} for {resp.url_redacted}")
        if resp.is_redirect:
            raise TransportGone(f"redirect {resp.status} (endpoint moved or retired)")
        resp.raise_for_status()
        return resp

    def _fetch_transport(self, release, transport, pkg, layout, specs, *, mode, start, end, http) -> FetchResult:
        rk = self.request_key(transport, release, pkg, specs, mode, start, end)
        n = self.latest_n(specs)
        # conditional GET only for latest polling of static release files: a history
        # request must always see the body.
        ckey = rk if (mode == "latest" and transport == "release_xml") else None
        if transport == "ddp_package":
            url = self.url_for(transport, release, package=pkg, layout=layout,
                               lastobs=n if mode == "latest" else None)
            resp = self._get(http, url, None)
            try:
                parsed = parse_ddp_csv(resp.content)
            except TransportGone:
                if mode != "latest":
                    raise
                # Observed live 2026-09-28: G.17 package + lastobs=5 -> 200 text/html, 0 bytes;
                # the same package without lastobs serves the CSV. Retry once, full.
                resp = self._get(http, self.url_for(transport, release, package=pkg, layout=layout), None)
                parsed = parse_ddp_csv(resp.content)
        else:
            resp = self._get(http, self.url_for(transport, release), ckey)
            if resp.not_modified:
                return self.make_result(rk, [], resp=resp)
            parsed = parse_sdmx_zip(resp.content, {mnemonic_of(s) for s in specs})
        obs: list[RawObs] = []
        for s in specs:
            rows = to_obs(s, select_series(parsed, s))
            obs.extend(self._window(rows, mode, start, end, n if mode == "latest" else None))
        if ckey:
            # validators are stored only AFTER the payload parsed and every requested series
            # passed identity: a bad 200 must not turn later polls into 304s.
            http.commit_validators(ckey, resp)
        return self.make_result(rk, obs, resp=resp)

    @staticmethod
    def _window(rows: list[RawObs], mode, start, end, n) -> list[RawObs]:
        if start is not None:
            rows = [o for o in rows if o.period_end >= start.isoformat()]
        if end is not None:
            rows = [o for o in rows if o.period_start <= end.isoformat()]
        if mode == "latest" and n:
            rows = rows[-n:]
        return rows

    # ---------------------------------------------------------------- arrivals
    def arrivals(self, http, *, release: Optional[str] = None, since: Optional[int] = None,
                 kinds: Iterable[str] = ("data", "notice")) -> list[dict]:
        """Release-arrival items from the Board's RSS.

        ``release=None`` -> the DDP-wide feed (``/feeds/datadownload.xml``, 1.6 MB,
        ETag'd); ``release="G17"`` -> ``/feeds/g17.xml``. NOTE (live 2026-09-28):
        only G.17 (and G.19) post "Data for <month> are now available" items; the
        H.15 / H.4.1 / H.6 feeds carry NOTICES only -- for those the arrival
        signal is the release XML file's ETag change (a 200 after 304s in
        latest-mode polling), confirmed by the scheduler against the calendar.
        """
        url = FEED_ALL if not release else f"{BASE}/feeds/{release.lower()}.xml"
        resp = http.get(url)
        reason = econ_http.soft_failure(resp)
        if reason:
            raise MalformedPayload(f"Fed feed: {reason}")
        resp.raise_for_status()
        want = set(kinds)
        out = [i for i in parse_feed(resp.content) if i["kind"] in want]
        if release:
            out = [i for i in out if release.upper() in i["release"].split(",") or not i["release"]]
        if since is not None:
            out = [i for i in out if (i["published_at"] or 0) >= since]
        return out
