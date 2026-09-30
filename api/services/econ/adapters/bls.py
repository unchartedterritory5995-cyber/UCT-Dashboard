"""BLS adapter -- Public Data API v2 (keyed) / v1 (keyless).

Endpoint (both versions: POST, JSON body)::

    v2  https://api.bls.gov/publicAPI/v2/timeseries/data/   registrationkey in the BODY
    v1  https://api.bls.gov/publicAPI/v1/timeseries/data/   no key

Published limits (per registration key / per IP for v1):

    version  series/query  years/query  queries/day
    v2       50            20           500
    v1       25            10           25

v1 SILENTLY TRUNCATES a longer year range (status still REQUEST_SUCCEEDED,
notice in ``message[]`` -- Phase 0 proof ``bls_v1_toomany.json``). This adapter
therefore plans its own <=10y (v1) / <=20y (v2) windows, and treats a
truncation notice it did not expect as ``MalformedPayload`` (a partial answer
must never be stored as if it were the full range).

``source.params`` contract: ``series_id`` (fallbacks: ``seriesid``, then
``source.provider_series_id``). Nothing else is read. ``history_start``
(top-level registry field, ``YYYY[-..]``) trims windows that predate the
series (see ``trim_to_history_start``).

Period grammar: ``M01..M12`` -> calendar month; ``Q01..Q04`` -> calendar
quarter; ``M13`` (annual average), ``Q05``, ``S01..S03`` (semi-annual) and
``A01`` (annual) are SKIPPED. A period that does not fit the series' registry
frequency is ``MalformedPayload``.

Values: ``-``, ``(NA)`` & friends -> ``None`` (never 0). Footnote code ``P``
(preliminary) -> flag ``"p"``. BLS publishes no timestamp, so
``source_published_at`` is always None (the scheduler places releases by the
calendar).

Failure taxonomy (all messages secret-free):
  * ``BlsQuotaExhausted`` (SourceUnavailable, ``reason == "quota"``,
    ``not_before`` = next ET day) -- REQUEST_NOT_PROCESSED / daily-threshold
    notice: back off until tomorrow, do not retry today.
  * ``BlsUnavailable`` (SourceUnavailable, ``reason`` in ``http_<code>``,
    ``redirect``, ``key_rejected``, ``not_processed``) -- transport-level.
  * ``MalformedPayload`` -- HTML/non-JSON, empty body, unknown status,
    unexpected truncation, unrequested series, unknown period code,
    non-numeric value, row outside the requested years.
"""
from __future__ import annotations

import json
import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Iterable, Optional

from .. import http as econ_http
from .. import timeutil
from ..model import FetchResult, MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, SeriesSpec, as_specs, register

V1_URL = "https://api.bls.gov/publicAPI/v1/timeseries/data/"
V2_URL = "https://api.bls.gov/publicAPI/v2/timeseries/data/"


@dataclass(frozen=True)
class Limits:
    series_per_query: int
    years_per_query: int
    queries_per_day: int


LIMITS = {"v1": Limits(25, 10, 25), "v2": Limits(50, 20, 500)}
EARLIEST_YEAR = 1913          # CPI-U NSA starts 1913-01; nothing on the API is older

# Values BLS (and its footnote conventions) use for "no number here".
NA_MARKERS = frozenset({"-", "–", "(NA)", "NA", "N/A", "(X)", "(D)", "(S)", "(C)", ""})

_SKIP_PERIODS = re.compile(r"^(M13|Q05|S0[1-3]|A01)$")
_MONTH = re.compile(r"^M(0[1-9]|1[0-2])$")
_QUARTER = re.compile(r"^Q0([1-4])$")

_TRUNCATION = re.compile(r"has been reduced|system-allowed limit|exceed", re.I)
_QUOTA = re.compile(r"threshold|daily limit|quota|too many requests|limit.*reached", re.I)
_KEY_BAD = re.compile(r"key .*(invalid|not valid|expired)|invalid .*key|registration key", re.I)
_NO_DATA = re.compile(r"^No Data Available for Series (\S+) Year: (\d{4})", re.I)
_INVALID_SERIES = re.compile(r"(Invalid Series|Series does not exist)\D*?for Series (\S+)", re.I)
_BENIGN = re.compile(r"catalog has been disabled|No Data Available|calculations? .*disabled|"
                     r"annual averages? .*disabled|aspects? .*disabled", re.I)


# --------------------------------------------------------------------------- errors

class BlsUnavailable(SourceUnavailable):
    """SourceUnavailable with a machine-readable ``reason``."""

    def __init__(self, message: str, reason: str = "unavailable"):
        self.reason = reason
        super().__init__(message)


class BlsQuotaExhausted(BlsUnavailable):
    """The daily query budget is spent. ``not_before`` (unix s) = next ET day 00:05."""

    def __init__(self, message: str, not_before: Optional[int] = None):
        self.not_before = not_before
        super().__init__(message, reason="quota")


def _next_et_day(now: Optional[float] = None) -> int:
    ts = now if now is not None else datetime.now(timezone.utc).timestamp()
    return timeutil.et_to_utc(timeutil.et_date(ts) + timedelta(days=1), "00:05")


# --------------------------------------------------------------------------- planning

@dataclass(frozen=True)
class Query:
    version: str                   # "v1" | "v2"
    series_ids: tuple              # BLS ids
    symbols: tuple                 # registry symbols, same order
    start_year: Optional[int]      # None -> latest:true probe
    end_year: Optional[int]
    latest: bool = False

    def request_key(self) -> str:
        span = "latest" if self.latest else f"{self.start_year}-{self.end_year}"
        return f"bls:{self.version}:{','.join(self.series_ids)}:{span}"


def series_id_of(spec: SeriesSpec) -> str:
    p = spec.params or {}
    sid = p.get("series_id") or p.get("seriesid") or spec.provider_series_id
    if not sid or not isinstance(sid, str):
        raise ValueError(f"{spec.symbol}: no BLS series id in source.params")
    return sid.strip().upper()


def _history_start_year(spec: SeriesSpec) -> Optional[int]:
    m = re.match(r"^\s*(\d{4})", str(spec.get("history_start") or ""))
    return int(m.group(1)) if m else None


def year_windows(start_year: int, end_year: int, span: int) -> list[tuple[int, int]]:
    """Split [start_year, end_year] into <= ``span``-year windows, newest window full.

    Returned oldest-first. 1913..2026 at span 10 -> 12 windows.
    """
    if end_year < start_year:
        return []
    out = []
    hi = end_year
    while hi >= start_year:
        lo = max(start_year, hi - span + 1)
        out.append((lo, hi))
        hi = lo - 1
    return out[::-1]


def _today() -> date:
    return datetime.now(timezone.utc).date()


def plan_queries(specs: Iterable, *, mode: str = "history", start: Optional[date] = None,
                 end: Optional[date] = None, keyed: bool = False,
                 trim_to_history_start: bool = True, today: Optional[date] = None) -> list[Query]:
    """The exact queries ``fetch`` would send (no network).

    history: [start.year or EARLIEST_YEAR, end.year or this year] split into windows;
             a window is only sent for series that exist in it (history_start trim).
    latest:  [start.year or this_year-1, end.year or this year] -- two calendar years,
             so routine revisions (NFP/JOLTS prior months) arrive with the new print.
    Series are packed into as few queries per window as the version allows.
    """
    version = "v2" if keyed else "v1"
    lim = LIMITS[version]
    specs = as_specs(specs)
    if not specs:
        return []
    today = today or _today()
    ey = min(end.year if end else today.year, today.year)
    if mode == "latest":
        sy = start.year if start else ey - 1
    elif mode == "history":
        sy = start.year if start else EARLIEST_YEAR
    else:
        raise ValueError(f"unknown mode {mode!r}")
    sy = max(sy, EARLIEST_YEAR)
    ids = [(s.symbol, series_id_of(s), _history_start_year(s)) for s in specs]
    queries: list[Query] = []
    for lo, hi in year_windows(sy, ey, lim.years_per_query):
        live = [(sym, sid) for sym, sid, hs in ids
                if not (trim_to_history_start and hs is not None and hi < hs)]
        for i in range(0, len(live), lim.series_per_query):
            part = live[i:i + lim.series_per_query]
            queries.append(Query(version, tuple(x[1] for x in part), tuple(x[0] for x in part), lo, hi))
    return queries


def estimate_queries(specs: Iterable, start: Optional[date] = None, end: Optional[date] = None,
                     keyed: bool = False, *, mode: str = "history",
                     trim_to_history_start: bool = True) -> int:
    """How many BLS queries a fetch would spend (for daily-budget planning)."""
    return len(plan_queries(specs, mode=mode, start=start, end=end, keyed=keyed,
                            trim_to_history_start=trim_to_history_start))


# --------------------------------------------------------------------------- parsing

def parse_period(year: Any, period: str) -> Optional[tuple[str, str, str]]:
    """('2026','M08') -> ('2026-08-01','2026-08-31','M'); skip codes -> None; bad -> ValueError."""
    y = int(str(year).strip())
    p = str(period or "").strip().upper()
    if _SKIP_PERIODS.match(p):
        return None
    m = _MONTH.match(p)
    if m:
        a, b = timeutil.month_bounds(y, int(m.group(1)))
        return a.isoformat(), b.isoformat(), "M"
    m = _QUARTER.match(p)
    if m:
        a, b = timeutil.quarter_bounds(y, int(m.group(1)))
        return a.isoformat(), b.isoformat(), "Q"
    raise ValueError("unknown BLS period code")


def parse_value(raw: Any) -> Optional[float]:
    if raw is None:
        return None
    s = str(raw).strip()
    if s.upper() in NA_MARKERS:
        return None
    try:
        v = float(s.replace(",", ""))
    except ValueError:
        raise ValueError("non-numeric BLS value") from None
    if not math.isfinite(v):
        raise ValueError("non-finite BLS value")
    return v


def parse_flag(footnotes: Any) -> str:
    for fn in footnotes or []:
        if not isinstance(fn, dict):
            continue
        code = str(fn.get("code") or "").strip().upper()
        text = str(fn.get("text") or "").strip().lower()
        if code == "P" or text.startswith("preliminary"):
            return "p"
    return ""


def _freq_code(spec: SeriesSpec) -> str:
    return str(spec.frequency or "").strip().upper()[:1]


def _decode(resp) -> dict:
    """Response -> dict or raise (HTML / empty / non-JSON / non-object)."""
    body = (resp.content or b"").strip()
    if not body or econ_http.is_empty_body(resp):
        raise MalformedPayload("bls: empty body with HTTP 200")
    if body[:1] == b"<" or b"<html" in body[:512].lower():
        raise MalformedPayload("bls: HTML instead of JSON")
    try:
        doc = json.loads(body.decode("utf-8", "replace"))
    except ValueError:
        raise MalformedPayload("bls: payload is not JSON") from None
    if not isinstance(doc, dict):
        raise MalformedPayload("bls: payload is not a JSON object")
    return doc


def _check_status(doc: dict, version: str, now: Optional[float]) -> list[str]:
    status = str(doc.get("status") or "")
    msgs = [str(m) for m in (doc.get("message") or []) if m is not None]
    joined = " | ".join(msgs)
    if status == "REQUEST_SUCCEEDED":
        return msgs
    if status == "REQUEST_NOT_PROCESSED" or _QUOTA.search(joined):
        if _QUOTA.search(joined) or not msgs:
            raise BlsQuotaExhausted(
                f"quota: BLS {version} daily query threshold reached; back off until the next day",
                not_before=_next_et_day(now))
        if _KEY_BAD.search(joined):
            raise BlsUnavailable(f"bls {version}: registration key rejected", reason="key_rejected")
        raise BlsUnavailable(f"bls {version}: request not processed", reason="not_processed")
    if status.startswith("REQUEST_FAILED"):
        if _KEY_BAD.search(joined):
            raise BlsUnavailable(f"bls {version}: registration key rejected", reason="key_rejected")
        raise MalformedPayload(f"bls {version}: request failed ({status})")
    raise MalformedPayload("bls: unknown status in payload")


def parse_payload(doc: dict, query: Query, specs_by_id: dict[str, SeriesSpec], *,
                  now: Optional[float] = None) -> tuple[list[RawObs], list[str], dict[str, str]]:
    """Parse one decoded response. Returns (observations, warnings, latest_marked).

    ``latest_marked`` = {symbol: period_start} of rows carrying ``latest:"true"``.
    """
    msgs = _check_status(doc, query.version, now)
    warnings: list[str] = []
    no_data: dict[str, int] = {}
    invalid: set[str] = set()
    for m in msgs:
        if _TRUNCATION.search(m):
            raise MalformedPayload(
                f"partial: BLS {query.version} truncated the request "
                f"({query.start_year}-{query.end_year}); refusing a partial range")
        nd = _NO_DATA.match(m)
        if nd:
            no_data[nd.group(1).upper()] = no_data.get(nd.group(1).upper(), 0) + 1
            continue
        inv = _INVALID_SERIES.search(m)
        if inv:
            invalid.add(inv.group(2).upper().rstrip(".,"))
            continue
        if _BENIGN.search(m):
            continue
        warnings.append("bls message: " + m[:160])
    for sid, n in sorted(no_data.items()):
        warnings.append(f"bls: no data for {sid} in {n} requested year(s)")
    for sid in sorted(invalid):
        warnings.append(f"identity: BLS says series {sid} is invalid")

    results = doc.get("Results")
    if not isinstance(results, dict) or not isinstance(results.get("series"), list):
        raise MalformedPayload("bls: payload has no Results.series list")
    requested = set(query.series_ids)
    seen: set[str] = set()
    obs: list[RawObs] = []
    latest_marked: dict[str, str] = {}
    for s in results["series"]:
        if not isinstance(s, dict):
            raise MalformedPayload("bls: series entry is not an object")
        sid = str(s.get("seriesID") or "").strip().upper()
        if sid not in requested:
            raise MalformedPayload("identity: payload carries an unrequested BLS series")
        seen.add(sid)
        spec = specs_by_id[sid]
        want = _freq_code(spec)
        data = s.get("data")
        if data is None:
            data = []
        if not isinstance(data, list):
            raise MalformedPayload(f"bls: data for {sid} is not a list")
        for row in data:
            if not isinstance(row, dict):
                raise MalformedPayload(f"bls: row for {sid} is not an object")
            try:
                parsed = parse_period(row.get("year"), row.get("period"))
            except (TypeError, ValueError):
                raise MalformedPayload(f"schema: unknown BLS period grammar in {sid}") from None
            if parsed is None:
                continue
            ps, pe, kind = parsed
            if want in ("M", "Q") and kind != want:
                raise MalformedPayload(f"schema: {sid} returned {kind} periods for a {want} series")
            yr = int(ps[:4])
            if not query.latest and not (query.start_year <= yr <= query.end_year):
                raise MalformedPayload(f"partial: {sid} row outside the requested years")
            try:
                val = parse_value(row.get("value"))
            except ValueError:
                raise MalformedPayload(f"numeric: unparseable BLS value in {sid}") from None
            obs.append(RawObs(spec.symbol, ps, pe, val, parse_flag(row.get("footnotes"))))
            if val is not None and str(row.get("latest") or "").lower() == "true":
                latest_marked[spec.symbol] = ps
    missing = requested - seen - invalid - set(no_data)
    if missing:
        raise MalformedPayload(f"partial: BLS omitted {len(missing)} requested series without notice")
    obs.sort(key=lambda o: (o.series_id, o.period_start))
    return obs, warnings, latest_marked


# --------------------------------------------------------------------------- adapter

@register
class BlsAdapter(BaseAdapter):
    name = "bls"
    key_env = "BLS_API_KEY"
    max_series_per_request = LIMITS["v2"].series_per_query   # effective limit depends on key

    def __init__(self, *, trim_to_history_start: bool = True, clock=None):
        self.trim_to_history_start = trim_to_history_start
        self._clock = clock
        self.queries_sent = 0          # this instance's lifetime count (budget accounting)

    # ---------------------------------------------------------------- helpers
    @property
    def keyed(self) -> bool:
        return self.key() is not None

    @property
    def version(self) -> str:
        return "v2" if self.keyed else "v1"

    @property
    def limits(self) -> Limits:
        return LIMITS[self.version]

    def _now(self) -> Optional[float]:
        return self._clock() if self._clock else None

    def _today(self) -> date:
        now = self._now()
        return datetime.fromtimestamp(now, timezone.utc).date() if now is not None else _today()

    def estimate_queries(self, specs, start=None, end=None, keyed: Optional[bool] = None, *,
                         mode: str = "history") -> int:
        k = self.keyed if keyed is None else keyed
        return len(plan_queries(specs, mode=mode, start=start, end=end, keyed=k,
                                trim_to_history_start=self.trim_to_history_start,
                                today=self._today()))

    def build_body(self, q: Query) -> dict:
        """The JSON body for a query. Contains the key for v2 -- NEVER log it."""
        body: dict = {"seriesid": list(q.series_ids)}
        if q.start_year is not None:
            body["startyear"] = str(q.start_year)
            body["endyear"] = str(q.end_year)
        if q.version == "v2":
            key = self.key()
            if not key:
                raise BlsUnavailable("bls v2: key not configured", reason="key_missing")
            body["registrationkey"] = key
            body["catalog"] = False
            body["calculations"] = False
            body["annualaverage"] = False
            if q.latest:
                body["latest"] = True
        return body

    def _send(self, q: Query, http) -> Any:
        url = V2_URL if q.version == "v2" else V1_URL
        self.queries_sent += 1
        resp = http.post_json(url, self.build_body(q))
        if resp.status != 200:
            if resp.is_redirect:
                raise BlsUnavailable(f"bls {q.version}: unexpected redirect {resp.status}",
                                     reason="redirect")
            if resp.status == 403:
                raise BlsUnavailable(f"bls {q.version}: HTTP 403 (blocked)", reason="http_403")
            raise BlsUnavailable(f"bls {q.version}: HTTP {resp.status}", reason=f"http_{resp.status}")
        return resp

    def _run(self, q: Query, specs_by_id, http) -> tuple[FetchResult, dict]:
        resp = self._send(q, http)
        doc = _decode(resp)
        obs, warnings, latest_marked = parse_payload(doc, q, specs_by_id, now=self._now())
        res = self.make_result(q.request_key(), obs, resp=resp, warnings=warnings,
                               source_published_at=None)
        return res, latest_marked

    # ---------------------------------------------------------------- Adapter
    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None) -> list[FetchResult]:
        specs = as_specs(specs)
        if http is None:
            raise ValueError("bls.fetch needs an HttpClient")
        by_id = {series_id_of(s): s for s in specs}
        queries = plan_queries(specs, mode=mode, start=start, end=end, keyed=self.keyed,
                               trim_to_history_start=self.trim_to_history_start,
                               today=self._today())
        return [self._run(q, by_id, http)[0] for q in queries]

    def latest_period_probe(self, specs, http) -> dict[str, Optional[str]]:
        """{symbol: newest period_start ISO | None} in as few queries as possible.

        Day-of release verification (open item B): after a scheduled BLS release,
        a cheap call confirms the expected period is now published. v2 uses
        ``latest:true`` (one row per series); v1 has no latest mode, so it asks
        for this year and last (the December print arrives in January).
        The newest period is the max period seen (the ``latest`` marker is only
        cross-checked -- a disagreement becomes MalformedPayload).
        """
        specs = as_specs(specs)
        by_id = {series_id_of(s): s for s in specs}
        lim = self.limits
        ey = self._today().year
        out: dict[str, Optional[str]] = {s.symbol: None for s in specs}
        ids = list(by_id)
        for i in range(0, len(ids), lim.series_per_query):
            part = ids[i:i + lim.series_per_query]
            syms = tuple(by_id[x].symbol for x in part)
            if self.keyed:
                q = Query("v2", tuple(part), syms, None, None, latest=True)
            else:
                q = Query("v1", tuple(part), syms, ey - 1, ey)
            res, marked = self._run(q, by_id, http)
            for o in res.observations:
                if o.value is None:
                    continue
                if out[o.series_id] is None or o.period_start > out[o.series_id]:
                    out[o.series_id] = o.period_start
            for sym, ps in marked.items():
                if out.get(sym) is not None and ps != out[sym]:
                    raise MalformedPayload(f"bls: latest marker for {sym} is not the newest period")
        return out
