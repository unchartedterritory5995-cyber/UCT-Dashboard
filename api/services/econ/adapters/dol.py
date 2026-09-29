"""DOL ETA weekly unemployment-insurance claims (USICSA: initial claims, SA).

TWO official, keyless GREEN paths on ETA's own Apache host ``oui.doleta.gov``
(not the Akamai-fronted www.dol.gov, which 403s scripted clients and is never
touched). DOL content is public domain (dol.gov/general/aboutdol/copyright).

1. HISTORY -- ``POST https://oui.doleta.gov/unemploy/wkclaims/report.asp``
   (the claims.asp form: ``level=us``, ``final_yr``, ``strtdate``, ``enddate``,
   ``filetype=xml``) -> ``<r539cyNational rundate=..>`` with one ``<week>`` per
   Saturday back to 1967-01-07: ``InitialClaims``/``ContinuedClaims`` x
   ``NSA``/``SF``/``SA``/``SA4WK``. Blanks are ``&#160;``. FUTURE weeks of the
   requested years are pre-filled with seasonal factors only -> trailing weeks
   with no value are dropped (never emitted as NA); an interior blank is a
   provider-stated missing value -> None. The XML LAGS the release by ~3 weeks
   (2026-09-28: newest populated week 08/29 while the 09/24 release covered
   09/19) -- it cannot supply the current week.

2. CURRENT / ADVANCE WEEK -- the weekly news-release PDF. ``GET
   https://oui.doleta.gov/unemploy/weeklyRedirect.php`` (the "Weekly Report"
   link on DataDashboard.asp) answers ``302 Location: http://oui.doleta.gov/
   press/<YYYY>/<MMDDYY>.pdf`` for the CURRENT release; the adapter fetches the
   same path over https (host + path pattern enforced). Text via ``pypdf``
   (already in requirements.txt). Parsed from the document:

     * embargo line "EMBARGOED UNTIL 8:30 A.M. (Eastern) Thursday, September 24,
       2026" -> the release instant = ``source_published_at`` (the file's
       Last-Modified, 12:32:12Z = 08:32 ET, is only a sanity check);
     * the "UNEMPLOYMENT INSURANCE DATA FOR REGULAR STATE PROGRAMS" table:
       header dates (advance week, prior week, and the week before) and the
       ``Initial Claims (SA)`` / ``(NSA)`` rows -- first two numeric columns
       always; the third week only when the Change column is present AND equals
       col1 - col2 (pdftotext-style layouts misplace it; then it is skipped);
     * the prose "In the week ending <Month D>, the advance figure for
       seasonally adjusted initial claims was X" (+ "previous week's level was
       revised ... to Y", + "unadjusted, totaled N in the week ending ...").

   FAIL CLOSED (MalformedPayload) unless: prose advance week == table week 1
   and prose X == table SA col 1; prose Y (when stated) == SA col 2; prose N
   (when stated) == NSA col 1; weeks are consecutive Saturdays ending 3-7 days
   before the release date; the PDF file name date == the embargo date; and
   for every emitted week NSA / (SF/100) is within 0.5 % of SA using the XML's
   seasonal factor (the advance week's SF is pre-published in the XML).
   Letter-spacing artifacts ("Initia l Cla ims") are tolerated in labels.

   Flags: the advance week is ``"a"`` (it is revised the following Thursday);
   the prior weeks carry ``""``. PDF rows are emitted only for weeks NEWER than
   the XML's newest populated week (XML wins where both exist).

fetch() returns up to TWO FetchResults: the XML (``source_published_at``
None -- backfill placement by the registry lag rule) and the PDF
(``source_published_at`` = embargo instant, also set per row).

``source.params`` read: ``measure`` ('initial' | 'continued'), ``seasonal``
('SA' | 'NSA'), ``level`` ('us' only), ``press`` (optional bool, default True;
the PDF path exists only for measure='initial'), ``latest_n`` (default 8).
``report`` is informational ('r539cy').
"""
from __future__ import annotations

import email.utils
import io
import re
import xml.etree.ElementTree as ET_XML
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from urllib.parse import urljoin, urlsplit

from .. import timeutil
from ..model import EconError, MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, as_specs, register

XML_URL = "https://oui.doleta.gov/unemploy/wkclaims/report.asp"
REDIRECT_URL = "https://oui.doleta.gov/unemploy/weeklyRedirect.php"
PRESS_HOST = "oui.doleta.gov"
_PRESS_PATH = re.compile(r"^/press/(\d{4})/(\d{2})(\d{2})(\d{2})\.pdf$")
EARLIEST_YEAR = 1967
SF_TOLERANCE = 0.005
_SECTION = {"initial": "InitialClaims", "continued": "ContinuedClaims"}
MONTHS = {m: i + 1 for i, m in enumerate(
    "January February March April May June July August September October November December".split())}
_MONTH_RE = "(" + "|".join(MONTHS) + ")"


def _utcnow() -> datetime:          # monkeypatched in tests
    return datetime.now(timezone.utc)


def _int(s) -> Optional[float]:
    t = (s or "").replace("\xa0", " ").strip()
    if not t:
        return None
    if not re.fullmatch(r"[+-]?\d{1,3}(,\d{3})*(\.\d+)?|[+-]?\d+(\.\d+)?", t):
        raise MalformedPayload("dol: non-numeric value")
    return float(t.replace(",", ""))


# ─────────────────────────────── XML (history) ─────────────────────────────


def parse_xml(content: bytes) -> dict:
    """-> {week_end(date): {"initial": {"NSA","SF","SA"}, "continued": {...}}}."""
    body = (content or b"").lstrip()
    if not body:
        raise MalformedPayload("dol xml: empty body")
    if body[:1] == b"<" and body[:200].lower().find(b"<html") >= 0:
        raise MalformedPayload("dol xml: HTML instead of XML")
    try:
        root = ET_XML.fromstring(body)
    except ET_XML.ParseError:
        raise MalformedPayload("dol xml: not well-formed") from None
    if root.tag != "r539cyNational":
        raise MalformedPayload("dol xml: unexpected root element (not the national r539cy report)")
    out: dict = {}
    for wk in root.findall("week"):
        lab = (wk.findtext("weekEnded") or "").strip()
        m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", lab)
        if not m:
            raise MalformedPayload("dol xml: malformed weekEnded")
        d = date(int(m.group(3)), int(m.group(1)), int(m.group(2)))
        if d.weekday() != 5:
            raise MalformedPayload(f"dol xml: week ending {d} is not a Saturday")
        if d in out:
            raise MalformedPayload(f"dol xml: duplicate week {d}")
        rec = {}
        for key, tag in _SECTION.items():
            sec = wk.find(tag)
            rec[key] = {k: (_int(sec.findtext(k)) if sec is not None else None) for k in ("NSA", "SF", "SA")}
        out[d] = rec
    if not out:
        raise MalformedPayload("dol xml: no weeks")
    return out


def xml_observations(weeks: dict, symbol: str, measure: str, seasonal: str) -> list[RawObs]:
    ds = sorted(weeks)
    vals = [weeks[d][measure][seasonal] for d in ds]
    last = max((i for i, v in enumerate(vals) if v is not None), default=-1)
    out = []
    for d, v in zip(ds[:last + 1], vals[:last + 1]):
        ps, pe = timeutil.week_bounds(d, "SAT")
        out.append(RawObs(symbol, ps.isoformat(), pe.isoformat(), v))
    return out


# ─────────────────────────────── PDF (advance week) ────────────────────────


@dataclass
class PressRelease:
    release_date: date
    embargo_ts: int
    weeks: list                                 # [advance, prior, (week before)]
    sa: dict = field(default_factory=dict)      # week -> value
    nsa: dict = field(default_factory=dict)
    prose_sa: Optional[float] = None
    prose_prev_sa: Optional[float] = None
    prose_nsa: Optional[float] = None


def _label_re(label: str) -> str:
    """Tolerate intra-word spaces ('Initia l Cla ims') but not line breaks."""
    parts = []
    for ch in label:
        parts.append(r"[ \t]*" if ch == " " else re.escape(ch) + r"[ \t]?")
    return "".join(parts)


def _squash(s: str) -> str:
    return re.sub(r"\s+", "", s.replace("’", "'"))


def _resolve(month: str, day: int, rel: date) -> date:
    for y in (rel.year, rel.year - 1):
        try:
            d = date(y, MONTHS[month], day)
        except ValueError:
            continue
        if d <= rel:
            return d
    raise MalformedPayload("dol pdf: week date cannot be placed before the release date")


def _num_tokens(rest: str) -> list[str]:
    return re.findall(r"[+-]?\d{1,3}(?:,\d{3})+|[+-]?\d+", rest)


def parse_press_text(text: str) -> PressRelease:
    if not text or len(text) < 200:
        raise MalformedPayload("dol pdf: no text layer")
    sq = _squash(text)
    m = re.search(r"EMBARGOEDUNTIL(\d{1,2}):(\d{2})A\.?M\.?\(Eastern\)[A-Za-z]+,"
                  + _MONTH_RE + r"(\d{1,2}),(\d{4})", sq)
    if not m:
        raise MalformedPayload("dol pdf: embargo line not found")
    rel = date(int(m.group(5)), MONTHS[m.group(3)], int(m.group(4)))
    embargo_ts = timeutil.et_to_utc(rel, f"{int(m.group(1)):02d}:{m.group(2)}")

    lines = text.splitlines()
    hdr_i = next((i for i, ln in enumerate(lines)
                  if re.match(r"\s*" + _label_re("WEEK ENDING"), ln)
                  and re.search(_MONTH_RE, _squash(ln))), None)
    if hdr_i is None:
        raise MalformedPayload("dol pdf: claims table header not found")
    hdr_dates = re.findall(_MONTH_RE + r"(\d{1,2})", _squash(lines[hdr_i]))
    if len(hdr_dates) < 2:
        raise MalformedPayload("dol pdf: claims table header lacks week dates")
    weeks = [_resolve(mo, int(dd), rel) for mo, dd in hdr_dates[:3]]
    w1 = weeks[0]
    if w1.weekday() != 5 or not (3 <= (rel - w1).days <= 7):
        raise MalformedPayload("dol pdf: advance week is not the Saturday 3-7 days before release")
    for k, w in enumerate(weeks):
        if w != w1 - timedelta(days=7 * k):
            raise MalformedPayload("dol pdf: table weeks are not consecutive")

    def row(label):
        rx = re.compile(r"^\s*" + _label_re(label) + r"(.*)$")
        for ln in lines[hdr_i + 1:hdr_i + 12]:
            mm = rx.match(ln)
            if mm:
                return _num_tokens(mm.group(1))
        raise MalformedPayload(f"dol pdf: row '{label}' not found")

    pr = PressRelease(release_date=rel, embargo_ts=embargo_ts, weeks=weeks[:2])
    for label, dst in (("Initial Claims (SA)", pr.sa), ("Initial Claims (NSA)", pr.nsa)):
        toks = row(label)
        if len(toks) < 2 or toks[0][0] in "+-" or toks[1][0] in "+-":
            raise MalformedPayload(f"dol pdf: row '{label}' lacks two levels")
        v1, v2 = _int(toks[0]), _int(toks[1])
        dst[weeks[0]], dst[weeks[1]] = v1, v2
        if (len(weeks) >= 3 and len(toks) >= 4 and toks[2][0] in "+-"
                and _int(toks[2]) == v1 - v2 and toks[3][0] not in "+-"):
            dst[weeks[2]] = _int(toks[3])
    if len(weeks) >= 3:
        if weeks[2] in pr.sa and weeks[2] in pr.nsa:
            pr.weeks = weeks[:3]
        else:                                   # only one row had a usable 3rd week
            pr.sa.pop(weeks[2], None)
            pr.nsa.pop(weeks[2], None)

    ma = re.search(r"Intheweekending" + _MONTH_RE + r"(\d{1,2}),theadvancefigureforseasonally"
                   r"adjustedinitialclaimswas([\d,]+)", sq)
    if not ma:
        raise MalformedPayload("dol pdf: advance-figure sentence not found")
    if _resolve(ma.group(1), int(ma.group(2)), rel) != w1:
        raise MalformedPayload("dol pdf: prose advance week != table advance week")
    pr.prose_sa = _int(ma.group(3).rstrip(","))
    mp = re.search(r"Thepreviousweek'?s?levelwas(?:revised(?:up|down)by[\d,]+from[\d,]+to([\d,]+)"
                   r"|unrevisedat([\d,]+))", sq)
    if mp:
        pr.prose_prev_sa = _int((mp.group(1) or mp.group(2)).rstrip(",").rstrip("."))
    mn = re.search(r"unadjusted,totaled([\d,]+)intheweekending" + _MONTH_RE + r"(\d{1,2})", sq)
    if mn and _resolve(mn.group(2), int(mn.group(3)), rel) == w1:
        pr.prose_nsa = _int(mn.group(1).rstrip(","))

    if pr.prose_sa != pr.sa[w1]:
        raise MalformedPayload("dol pdf: prose advance SA != table SA")
    if pr.prose_prev_sa is not None and pr.prose_prev_sa != pr.sa[weeks[1]]:
        raise MalformedPayload("dol pdf: prose revised prior-week SA != table")
    if pr.prose_nsa is not None and pr.prose_nsa != pr.nsa[w1]:
        raise MalformedPayload("dol pdf: prose advance NSA != table NSA")
    return pr


def cross_validate_sf(pr: PressRelease, xml_weeks: dict) -> None:
    """NSA / (SF/100) must be within 0.5 % of SA for every table week."""
    for w in pr.weeks:
        sf = ((xml_weeks.get(w) or {}).get("initial") or {}).get("SF")
        if sf is None or sf <= 0:
            raise MalformedPayload(f"dol pdf: no XML seasonal factor for week {w}; cannot cross-validate")
        sa, nsa = pr.sa.get(w), pr.nsa.get(w)
        if sa is None or nsa is None or sa <= 0:
            raise MalformedPayload(f"dol pdf: week {w} lacks SA/NSA")
        if abs(nsa / (sf / 100.0) - sa) / sa > SF_TOLERANCE:
            raise MalformedPayload(f"dol pdf: week {w} NSA/SF disagrees with SA by more than 0.5%")


def pdf_text(content: bytes) -> str:
    try:
        from pypdf import PdfReader  # requirements.txt: pypdf>=5.0.0
    except ImportError:
        raise SourceUnavailable("dol pdf: pypdf is not installed (requirements.txt pypdf>=5.0.0)") from None
    try:
        reader = PdfReader(io.BytesIO(content))
        return "\n".join((p.extract_text() or "") for p in reader.pages[:12])
    except Exception:  # noqa: BLE001 -- any parser failure is a bad payload
        raise MalformedPayload("dol pdf: unreadable PDF") from None


def discover_press_url(http) -> str:
    r = http.get(REDIRECT_URL)
    if r.status not in (301, 302, 303, 307, 308):
        if r.status >= 500:
            raise SourceUnavailable(f"dol weeklyRedirect HTTP {r.status}")
        raise MalformedPayload(f"dol weeklyRedirect: expected a redirect, got HTTP {r.status}")
    loc = urljoin(REDIRECT_URL, (r.location or "").strip())
    parts = urlsplit(loc)
    if (parts.hostname or "").lower() != PRESS_HOST or not _PRESS_PATH.match(parts.path) \
            or parts.query:
        raise MalformedPayload("dol weeklyRedirect: target is not an oui.doleta.gov press PDF")
    return f"https://{PRESS_HOST}{parts.path}"


def _http_date(s) -> Optional[int]:
    try:
        dt = email.utils.parsedate_to_datetime(s) if s else None
    except (TypeError, ValueError, IndexError):
        return None
    return int(dt.timestamp()) if dt is not None and dt.tzinfo is not None else None


# ─────────────────────────────── adapter ──────────────────────────────────


@register
class DolAdapter(BaseAdapter):
    name = "dol"
    key_env = None
    max_series_per_request = 1

    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None):
        if http is None:
            raise ValueError("dol.fetch needs an HttpClient")
        out = []
        for s in as_specs(specs):
            out += self._fetch_one(s, mode, start, end, http)
        return out

    def _xml(self, http, y0: int, y1: int, today: date):
        data = [("level", "us"), ("final_yr", str(today.year + 1)), ("strtdate", str(y0)),
                ("enddate", str(y1)), ("filetype", "xml")]
        r = http.post_form(XML_URL, data)
        if r.is_redirect:
            raise MalformedPayload(f"dol xml: unexpected redirect {r.status}")
        r.raise_for_status()
        return r, parse_xml(r.content)

    def _fetch_one(self, spec, mode, start, end, http):
        p = spec.params
        measure = str(p.get("measure", "initial")).lower()
        seasonal = str(p.get("seasonal", "SA")).upper()
        if measure not in _SECTION or seasonal not in ("SA", "NSA"):
            raise MalformedPayload(f"dol {spec.symbol}: params.measure/seasonal invalid")
        if str(p.get("level", "us")).lower() != "us":
            raise MalformedPayload(f"dol {spec.symbol}: only level='us' is supported")
        latest_n = int(p.get("latest_n", 8) or 8)
        today = _utcnow().date()
        if mode == "latest" and start is None:
            y0, y1 = today.year - 1, today.year
        else:
            y0 = max(EARLIEST_YEAR, timeutil.as_date(start).year if start else EARLIEST_YEAR)
            y1 = min(today.year, timeutil.as_date(end).year if end else today.year)
            if y1 < y0:
                raise MalformedPayload(f"dol {spec.symbol}: empty year range")
        xr, weeks = self._xml(http, y0, y1, today)
        xml_obs = xml_observations(weeks, spec.symbol, measure, seasonal)
        if start is not None:
            xml_obs = [o for o in xml_obs if o.period_end >= timeutil.iso(start)]
        if end is not None:
            xml_obs = [o for o in xml_obs if o.period_end <= timeutil.iso(end)]
        if mode == "latest" and start is None:
            xml_obs = xml_obs[-latest_n:]
        warnings: list[str] = []
        rk = f"dol:r539cy:us:{measure}:{seasonal}:{mode}:{y0}-{y1}"
        results = []

        want_pdf = (measure == "initial" and p.get("press", True) is not False
                    and (end is None or timeutil.as_date(end) >= today - timedelta(days=14)))
        pdf_res = None
        if want_pdf:
            try:
                pdf_res = self._press(spec, http, weeks, seasonal, xml_obs, warnings)
            except SourceUnavailable as e:
                if mode == "latest":
                    raise
                warnings.append(f"advance-week PDF unavailable ({type(e).__name__}); XML only")
        results.append(self.make_result(rk, xml_obs, resp=xr, warnings=warnings))
        if pdf_res is not None:
            results.append(pdf_res)
        return results

    def _press(self, spec, http, xml_weeks, seasonal, xml_obs, warnings):
        url = discover_press_url(http)
        r = http.get(url)
        if r.status >= 500:
            raise SourceUnavailable(f"dol press PDF HTTP {r.status}")
        if not r.ok:
            raise MalformedPayload(f"dol press PDF: HTTP {r.status}")
        if not (r.content or b"").startswith(b"%PDF"):
            raise MalformedPayload("dol press PDF: body is not a PDF")
        pr = parse_press_text(pdf_text(r.content))
        mm = _PRESS_PATH.match(urlsplit(url).path)
        fname = date(2000 + int(mm.group(4)), int(mm.group(2)), int(mm.group(3)))
        if fname != pr.release_date or int(mm.group(1)) != pr.release_date.year:
            raise MalformedPayload("dol press PDF: file name date != embargo date")
        cross_validate_sf(pr, xml_weeks)
        lm = _http_date(r.headers.get("last-modified"))
        pw = []
        if lm is None:
            pw.append("press PDF has no Last-Modified")
        elif lm < pr.embargo_ts - 3600 or timeutil.et_date(lm) != pr.release_date:
            pw.append("press PDF Last-Modified is not within the release morning")
        newest_xml = max((timeutil.as_date(o.period_end) for o in xml_obs), default=None)
        if newest_xml is None:
            # the latest-mode XML window may be empty only if the XML itself is empty
            newest_xml = max((d for d, v in xml_weeks.items()
                              if v["initial"][seasonal] is not None), default=date.min)
        vals = pr.sa if seasonal == "SA" else pr.nsa
        obs = []
        for w in sorted(pr.weeks):
            if w <= newest_xml:
                continue
            ps, pe = timeutil.week_bounds(w, "SAT")
            obs.append(RawObs(spec.symbol, ps.isoformat(), pe.isoformat(), vals[w],
                              "a" if w == pr.weeks[0] else "", pr.embargo_ts))
        oldest_pdf = min(pr.weeks)
        if newest_xml != date.min and (oldest_pdf - newest_xml).days > 7:
            warnings.append(f"gap: XML ends {newest_xml}, PDF starts {oldest_pdf}")
        rk = f"dol:press:{pr.release_date.isoformat()}:initial:{seasonal}"
        return self.make_result(rk, obs, resp=r, source_published_at=pr.embargo_ts, warnings=pw)
