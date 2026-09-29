"""New York Fed Markets API adapter (keyless JSON) -- reference rates + repo/RRP operations.

Base ``https://markets.newyorkfed.org``. Spec: ``/static/docs/markets-api.yml``.
No key, no validators (``Cache-Control: no-store``), no documented rate limit.

ENDPOINT FAMILIES (chosen from ``params.path``):

  rates  ``/api/rates/{secured|unsecured}/{sofr|effr|obfr|...}``
         latest  -> ``<path>/last/<n>.json``
         history -> ``<path>/search.json?startDate=YYYY-MM-DD&endDate=YYYY-MM-DD``
                    (planned in <= 1-calendar-year windows)
         rows: ``refRates[]`` with ``effectiveDate``, the value field, and
         ``revisionIndicator`` (non-empty -> flag ``"r"``; the API uses ``"r"``,
         the docs say ``"Y"`` -- both accepted).
  rp     ``/api/rp/results/search.json`` (+ legacy ``/api/rp/reverserepo/propositions/search.json``)
         latest  -> search over the trailing ``latest_days`` (default 14) calendar days
         history -> search in <= 1-year windows
         rows: ``repo.operations[]`` with ``operationDate``, ``operationType``,
         ``term``, ``auctionStatus``, ``lastUpdated`` (ET) and the value field.
         ⚠ LIVE 2026-09-28: the server IGNORES ``operationTypes=Reverse Repo`` --
         the answer also carries the Standing Repo Facility's "Full Allotment"
         REPO operations (1,000,000 accepted on 09-28). ``params.filter`` is
         therefore ALWAYS applied client-side.
         ⚠ Two overnight RRP operations share a date on 16 days 2017-05-22 ..
         2026-05-13: a SMALL VALUE EXERCISE (operational test, 21-116 M$, closing
         10:00/10:30/11:00, MBS or Treasury collateral; the note usually -- NOT
         always, 2020-11-18 is empty -- says so) beside the regular ON RRP
         operation closing 13:15. Summing would add the test; USRRP therefore uses
         ``aggregate: "primary"`` = the operation with the LATEST closeTime.

``source.params`` contract:
  path       endpoint family root (above)                       (required)
  field      value key on the row, e.g. percentRate, targetRateTo,
             totalAmtAccepted; ``details.<key>`` reads every operation detail
             carrying <key> (e.g. details.amtAccepted, details.percentAwardRate)  (required)
  query      dict of extra query params sent to the server (e.g. {"term": "overnight"})
  filter     dict {row key: required value} applied client-side (case-insensitive)
  detail_filter  dict applied to ``details[]`` entries when field is ``details.<key>``
             (e.g. {"securityType": "Treasury"}); matching details are summed / must be
             single like operations are.
  aggregate  rp only: "sum" (default; several operations on one date are summed)
             | "single" (more than one matching value on a date -> MalformedPayload)
             | "primary" (only the operation(s) with the latest closeTime, then as single)
  min_date   ISO date floor (default: the registry ``history_start`` when it is a
             full ISO date). Rows before it are never emitted (methodology breaks).
  latest_n / latest_days   latest-mode sizing

A row that LACKS the field is skipped (the concept did not exist then -- e.g.
``targetRateTo`` before the 2008-12-16 range regime); an explicit ``null`` is a
provider NA -> ``None``. RAW units are returned untouched (RRP = US dollars).

``source_published_at``: rp rows carry ``lastUpdated`` ("YYYY-MM-DD HH:MM:SS",
ET) -> per-row unix seconds (the max over the operations used). It is a
LAST-UPDATED time (>= first publication), so it is only ever late-side. Rates
rows carry no timestamp.
"""
from __future__ import annotations

import json
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from .. import http as econ_http
from .. import timeutil
from ..model import FetchResult, MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, SeriesSpec, as_specs, register

BASE = "https://markets.newyorkfed.org"
LATEST_N = 10
LATEST_DAYS = 14
EARLIEST = date(2000, 7, 1)          # EFFR on the API starts 2000-07-03

_RATES_RE = re.compile(r"^/api/rates/(secured|unsecured)/([a-z0-9]+)$")
_RP_PATHS = ("/api/rp/results/search.json", "/api/rp/reverserepo/propositions/search.json")
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}$")
AGGREGATES = ("sum", "single", "primary")


def _today() -> date:
    """NY Fed dates are New York business dates -> 'today' is the ET date."""
    return timeutil.et_date(datetime.now(timezone.utc).timestamp())


def family_of(spec: SeriesSpec) -> str:
    path = str(spec.params.get("path") or "").strip().rstrip("/")
    if _RATES_RE.match(path):
        return "rates"
    if path in _RP_PATHS:
        return "rp"
    raise MalformedPayload(f"{spec.symbol}: nyfed params.path not a supported endpoint family")


def field_of(spec: SeriesSpec) -> str:
    f = str(spec.params.get("field") or "").strip()
    if not re.fullmatch(r"(details\.)?[A-Za-z][A-Za-z0-9]{0,40}", f):
        raise MalformedPayload(f"{spec.symbol}: nyfed params.field missing/invalid")
    return f


def floor_of(spec: SeriesSpec) -> Optional[date]:
    raw = spec.params.get("min_date")
    if raw is None:
        hs = str(spec.history_start or "")
        raw = hs if _ISO.match(hs) else None
    if raw is None:
        return None
    try:
        return date.fromisoformat(str(raw))
    except ValueError:
        raise MalformedPayload(f"{spec.symbol}: nyfed params.min_date invalid") from None


def year_windows(start: date, end: date) -> list[tuple[date, date]]:
    """[start, end] split into <= calendar-year windows (inclusive bounds)."""
    out = []
    cur = start
    while cur <= end:
        stop = min(end, date(cur.year, 12, 31))
        out.append((cur, stop))
        cur = stop + timedelta(days=1)
    return out


def _decode(resp) -> Any:
    reason = econ_http.soft_failure(resp)
    if reason:
        raise MalformedPayload(f"nyfed: {reason}")
    resp.raise_for_status()
    body = (resp.content or b"").lstrip()
    if body[:1] not in (b"{", b"["):
        raise MalformedPayload("nyfed: non-JSON body (HTML error page?)")
    try:
        return json.loads(body)
    except ValueError:
        raise MalformedPayload("nyfed: malformed JSON") from None


def _num(v: Any) -> Optional[float]:
    if v is None:
        return None
    if isinstance(v, bool):
        raise MalformedPayload("nyfed: boolean where a number was expected")
    if isinstance(v, (int, float)):
        f = float(v)
    else:
        s = str(v).strip()
        if s.upper() in ("", "NA", "N/A", "ND", "NULL"):
            return None
        try:
            f = float(s.replace(",", ""))
        except ValueError:
            raise MalformedPayload("nyfed: non-numeric value") from None
    if f != f or f in (float("inf"), float("-inf")):
        raise MalformedPayload("nyfed: non-finite value")
    return f


_MISSING = object()


def _field(row: dict, field: str, detail_filter: Optional[dict] = None) -> Any:
    """Row value, or for ``details.<key>`` the LIST of <key> values of the operation's
    details matching ``detail_filter`` (``_MISSING`` when none carries the key)."""
    if field.startswith("details."):
        key = field.split(".", 1)[1]
        vals = [d[key] for d in row.get("details") or []
                if isinstance(d, dict) and key in d and _matches(d, detail_filter or {})]
        return vals if vals else _MISSING
    return row.get(field, _MISSING)


def _matches(row: dict, flt: dict) -> bool:
    for k, want in (flt or {}).items():
        got = row.get(k)
        if got is None or str(got).strip().lower() != str(want).strip().lower():
            return False
    return True


def _et_ts(s: Any) -> Optional[int]:
    m = re.fullmatch(r"(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?", str(s or "").strip())
    if not m:
        return None
    return timeutil.et_to_utc(m.group(1), f"{m.group(2)}:{m.group(3)}") + int(m.group(4) or 0)


def parse_rates(doc: Any, spec: SeriesSpec) -> list[RawObs]:
    if not isinstance(doc, dict) or not isinstance(doc.get("refRates"), list):
        raise MalformedPayload(f"{spec.symbol}: nyfed rates payload lacks refRates[]")
    field = field_of(spec)
    ratetype = _RATES_RE.match(str(spec.params.get("path")).rstrip("/")).group(2).upper()
    out: dict[str, RawObs] = {}
    for row in doc["refRates"]:
        if not isinstance(row, dict):
            raise MalformedPayload(f"{spec.symbol}: nyfed row is not an object")
        typ = str(row.get("type") or "").upper()
        if typ and typ != ratetype:
            continue                        # /all/ endpoints mix types
        d = str(row.get("effectiveDate") or "")
        if not _ISO.match(d):
            raise MalformedPayload(f"{spec.symbol}: nyfed row without a valid effectiveDate")
        raw = _field(row, field)
        if raw is _MISSING:
            continue
        flag = "r" if str(row.get("revisionIndicator") or "").strip() else ""
        o = RawObs(spec.symbol, d, d, _num(raw), flag)
        prev = out.get(d)
        if prev is not None and (prev.value, prev.flag) != (o.value, o.flag):
            raise MalformedPayload(f"{spec.symbol}: duplicate effectiveDate with different values")
        out[d] = o
    return [out[k] for k in sorted(out)]


_HHMM = re.compile(r"^\d{1,2}:\d{2}$")


def parse_rp(doc: Any, spec: SeriesSpec) -> list[RawObs]:
    ops = doc.get("repo", {}).get("operations") if isinstance(doc, dict) and isinstance(doc.get("repo"), dict) else None
    if not isinstance(ops, list):
        raise MalformedPayload(f"{spec.symbol}: nyfed rp payload lacks repo.operations[]")
    field = field_of(spec)
    flt = spec.params.get("filter") or {}
    dflt = spec.params.get("detail_filter") or {}
    if not isinstance(flt, dict) or not isinstance(dflt, dict):
        raise MalformedPayload(f"{spec.symbol}: nyfed params.filter/detail_filter must be objects")
    agg = str(spec.params.get("aggregate") or "sum")
    if agg not in AGGREGATES:
        raise MalformedPayload(f"{spec.symbol}: nyfed params.aggregate must be one of {AGGREGATES}")
    # date -> [(closeTime, [values], lastUpdated ts)]
    by_date: dict[str, list[tuple[str, list[Optional[float]], Optional[int]]]] = {}
    for op in ops:
        if not isinstance(op, dict):
            raise MalformedPayload(f"{spec.symbol}: nyfed operation is not an object")
        if not _matches(op, flt):
            continue
        status = op.get("auctionStatus")
        if status is not None and str(status).strip().lower() != "results":
            continue                        # announced / not yet settled -> not data
        d = str(op.get("operationDate") or "")
        if not _ISO.match(d):
            raise MalformedPayload(f"{spec.symbol}: nyfed operation without a valid operationDate")
        raw = _field(op, field, dflt)
        if raw is _MISSING:
            continue
        close = str(op.get("closeTime") or "").strip()
        vals = [_num(v) for v in (raw if isinstance(raw, list) else [raw])]
        by_date.setdefault(d, []).append((close, vals, _et_ts(op.get("lastUpdated"))))
    out = []
    for d in sorted(by_date):
        group = by_date[d]
        if agg == "primary" and len(group) > 1:
            if not all(_HHMM.match(c) for c, _, _ in group):
                raise MalformedPayload(f"{spec.symbol}: {len(group)} operations on {d} without closeTime")
            last = max(_hhmm(c) for c, _, _ in group)
            group = [g for g in group if _hhmm(g[0]) == last]
        nums = [v for _, vals, _ in group for v in vals]
        if agg in ("single", "primary") and len(nums) > 1:
            raise MalformedPayload(f"{spec.symbol}: {len(nums)} matching values on {d} (aggregate={agg})")
        value = None if any(v is None for v in nums) else float(sum(nums))
        stamps = [t for _, _, t in group if t is not None]
        out.append(RawObs(spec.symbol, d, d, value, "", max(stamps) if stamps else None))
    return out


def _hhmm(c: str) -> tuple[int, int]:
    h, m = c.split(":")
    return int(h), int(m)


@register
class NyFedAdapter(BaseAdapter):
    name = "nyfed"
    key_env = None
    max_series_per_request = 10        # series sharing one endpoint share one request

    def __init__(self, *, clock=None):
        self._clock = clock

    def _today(self) -> date:
        if self._clock is None:
            return _today()
        return timeutil.et_date(self._clock())

    # ---------------------------------------------------------------- planning
    @staticmethod
    def endpoint_key(spec: SeriesSpec) -> tuple:
        fam = family_of(spec)
        q = spec.params.get("query") or {}
        if not isinstance(q, dict):
            raise MalformedPayload(f"{spec.symbol}: nyfed params.query must be an object")
        return (fam, str(spec.params["path"]).rstrip("/"), tuple(sorted((str(k), str(v)) for k, v in q.items())))

    def group(self, specs) -> list[tuple[tuple, list[SeriesSpec]]]:
        groups: dict[tuple, list[SeriesSpec]] = {}
        for s in as_specs(specs):
            field_of(s)
            groups.setdefault(self.endpoint_key(s), []).append(s)
        out = []
        for key, members in groups.items():
            for i in range(0, len(members), self.max_series_per_request):
                out.append((key, members[i:i + self.max_series_per_request]))
        return out

    def plan(self, key: tuple, specs: list[SeriesSpec], *, mode: str, start: Optional[date],
             end: Optional[date]) -> list[tuple[str, dict]]:
        """[(url, params)] for one endpoint group. Pure (no I/O)."""
        fam, path, query = key
        today = self._today()
        extra = dict(query)
        if mode == "latest":
            if fam == "rates":
                n = max(int(s.params.get("latest_n") or LATEST_N) for s in specs)
                return [(f"{BASE}{path}/last/{n}.json", extra)]
            days = max(int(s.params.get("latest_days") or LATEST_DAYS) for s in specs)
            lo, hi = today - timedelta(days=days), today
            return [(f"{BASE}{path}", {**extra, "startDate": lo.isoformat(), "endDate": hi.isoformat()})]
        floors = [floor_of(s) for s in specs]
        lo = start or (min(f for f in floors if f) if all(floors) else EARLIEST)
        if all(floors):
            lo = max(lo, min(floors))
        hi = min(end or today, today)
        if lo > hi:
            return []
        url = f"{BASE}{path}/search.json" if fam == "rates" else f"{BASE}{path}"
        return [(url, {**extra, "startDate": a.isoformat(), "endDate": b.isoformat()})
                for a, b in year_windows(lo, hi)]

    @staticmethod
    def request_key(key: tuple, specs: list[SeriesSpec], mode: str, start, end) -> str:
        fam, path, query = key
        q = "&".join(f"{k}={v}" for k, v in query)
        fields = ",".join(sorted(field_of(s) for s in specs))
        span = "latest" if mode == "latest" else f"{start or ''}..{end or ''}"
        return f"nyfed:{path}{('?' + q) if q else ''}:{fields}:{span}"

    # ---------------------------------------------------------------- fetch
    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None) -> list[FetchResult]:
        if mode not in ("history", "latest"):
            raise ValueError(f"mode must be history|latest, not {mode!r}")
        if http is None:
            raise ValueError("nyfed.fetch needs an HttpClient")
        results = []
        for key, members in self.group(specs):
            results.append(self._fetch_group(key, members, mode=mode, start=start, end=end, http=http))
        return results

    def _fetch_group(self, key, specs, *, mode, start, end, http) -> FetchResult:
        fam = key[0]
        parse = parse_rates if fam == "rates" else parse_rp
        per: dict[str, dict[str, RawObs]] = {s.symbol: {} for s in specs}
        payloads: list[bytes] = []
        status = None
        rows_seen = 0
        for url, params in self.plan(key, specs, mode=mode, start=start, end=end):
            resp = http.get(url, params=params)
            doc = _decode(resp)
            status = resp.status
            payloads.append(resp.content or b"")
            container = doc.get("refRates") if fam == "rates" else (doc.get("repo") or {}).get("operations")
            rows_seen += len(container or []) if isinstance(container, list) else 0
            for s in specs:
                for o in parse(doc, s):
                    per[s.symbol][o.period_start] = o       # windows do not overlap
        if rows_seen == 0 and (mode == "latest" or (start is None and end is None)):
            raise MalformedPayload("nyfed: request answered with zero rows")
        obs: list[RawObs] = []
        for s in specs:
            rows = [per[s.symbol][k] for k in sorted(per[s.symbol])]
            fl = floor_of(s)
            if fl is not None:
                rows = [o for o in rows if o.period_start >= fl.isoformat()]
            if start is not None:
                rows = [o for o in rows if o.period_start >= start.isoformat()]
            if end is not None:
                rows = [o for o in rows if o.period_start <= end.isoformat()]
            obs.extend(rows)
        payload = b"\n".join(payloads)
        return self.make_result(self.request_key(key, specs, mode, start, end), obs,
                                payload=payload, http_status=status)
