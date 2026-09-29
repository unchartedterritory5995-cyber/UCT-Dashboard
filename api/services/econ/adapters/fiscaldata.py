"""Treasury Fiscal Data adapter (keyless JSON, api.fiscaldata.treasury.gov).

Three dataset shapes, one paging/transport layer:

  daily field      ``v2/accounting/od/debt_to_penny``  one row per record_date,
                   value = ``params.field`` (USDEBT: ``tot_pub_debt_out_amt``, USD).

  DTS labelled row ``v1/accounting/dts/operating_cash_balance``  several rows per
                   record_date keyed by ``account_type``; the TGA closing balance
                   has had THREE labels (verified live 2026-09-28 over all 16,646
                   rows, 5,271 dates, exactly one TGA row per date, no gaps):

                     2005-10-03..2021-09-30  'Federal Reserve Account'            close_today_bal
                     2021-10-01..2022-04-15  'Treasury General Account (TGA)'     close_today_bal
                     2022-04-18..            'Treasury General Account (TGA) Closing Balance'
                                             value in open_today_bal, close_today_bal == "null"

                   Splices are exact: 2021-10-01 TGA open_today_bal 215,160 == 2021-09-30
                   FRA close 215,160; 2022-04-18 'Opening Balance' 578,473 == 2022-04-15
                   TGA close 578,473. The pre-2021 'Federal Reserve Account' IS the TGA
                   (Treasury's account at the Fed); the old 'Tax and Loan Note Accounts'
                   (commercial banks, to 2012) and 'Supplementary Financing Program'
                   rows are NOT part of the TGA and are never summed in. Units $M.
                   A record_date carrying rows but NO known TGA label is schema drift
                   -> MalformedPayload (fail closed, never a silent gap).

  MTS Table 1      ``v1/accounting/mts/mts_table_1``  one REPORT per record_date
                   (= the report month end). Each report lists the months of the
                   current fiscal year AND all 12 months of the prior fiscal year:
                   ``classification_desc`` is the month NAME, its ``parent_id`` points
                   at a level-1 row 'FY 2026'. Calendar year = FY-1 for Oct/Nov/Dec.
                   The same month is RE-STATED (revised) in later reports for up to
                   ~2 years (92 of 155 months changed at least once) -- the value
                   for a month is taken from the NEWEST report that carries it.
                   SIGN: ``current_month_dfct_sur_amt`` is DEFICIT-POSITIVE (Aug 2026
                   receipts 360.03B - outlays 526.83B = -166.80B; field = +166.80B;
                   April surplus months are negative). ``params.sign`` (default +1)
                   multiplies it; -1 gives the FRED MTSDS133FMS convention
                   (surplus +, deficit -).

``source.params`` read: ``endpoint`` (required), ``field`` (required), ``filter``
(dict of equality filters; for DTS ``account_type`` names the CURRENT label),
``labels`` (optional {account_type: value_field} overriding the built-in TGA
label history), ``row_key`` (MTS: 'classification_desc' switches to the MTS
report grammar), ``sign`` (optional, +1/-1), ``latest_days`` (optional, default
21 for daily datasets).

Paging: ``page[size]=10000``; continue while ``links.next`` is non-null; the sum
of rows must equal ``meta.total-count`` (else MalformedPayload: partial).
Missing markers ``"null"``/``""``/None -> None (never 0).

Publication metadata: Fiscal Data sends NO ETag/Last-Modified, so
``source_published_at`` is None. The release calendar
(``https://api.fiscaldata.treasury.gov/services/calendar/release``) states
times in UTC -- see :func:`release_calendar`.
"""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional

from .. import http as econ_http
from .. import timeutil
from ..model import MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, as_specs, register

BASE_URL = "https://api.fiscaldata.treasury.gov/services/api/fiscal_service/"
CALENDAR_URL = "https://api.fiscaldata.treasury.gov/services/calendar/release"
PAGE_SIZE = 10000
MAX_PAGES = 50
NA_MARKERS = frozenset({"null", "", "NULL", "None", "n/a", "N/A", "*"})

DTS_OCB_ENDPOINT = "v1/accounting/dts/operating_cash_balance"
# account_type -> value column, oldest first. See module docstring for evidence.
TGA_LABELS = {
    "Federal Reserve Account": "close_today_bal",
    "Treasury General Account (TGA)": "close_today_bal",
    "Treasury General Account (TGA) Closing Balance": "open_today_bal",
}
# The label whose value column is open_today_bal while close_today_bal is "null".
_TGA_OPEN_QUIRK = "Treasury General Account (TGA) Closing Balance"

MONTHS = {m: i + 1 for i, m in enumerate(
    "January February March April May June July August September October November December".split())}

# Fiscal Data calendar datasetId -> registry release.calendar_key
CALENDAR_KEYS = {
    "015-BFS-2014Q1-03": "fiscal:dts",     # Daily Treasury Statement
    "015-BFS-2014Q3-065": "fiscal:dtp",    # Debt to the Penny
    "015-BFS-2014Q1-13": "fiscal:mts",     # Monthly Treasury Statement
}


def _utcnow() -> datetime:          # monkeypatched in tests
    return datetime.now(timezone.utc)


def _num(v) -> Optional[float]:
    if v is None:
        return None
    s = str(v).strip()
    if s in NA_MARKERS:
        return None
    try:
        x = float(s.replace(",", ""))
    except ValueError:
        raise MalformedPayload("fiscaldata: non-numeric value") from None
    if x != x or x in (float("inf"), float("-inf")):
        raise MalformedPayload("fiscaldata: non-finite value")
    return x


def _iso(d) -> str:
    return timeutil.iso(d)


def _endpoint_url(endpoint: str) -> str:
    ep = str(endpoint or "").strip().strip("/")
    if not ep or ".." in ep or "://" in ep:
        raise MalformedPayload("fiscaldata: registry params.endpoint missing/invalid")
    return BASE_URL + ep


def _decode_json(resp, what: str) -> Any:
    soft = econ_http.soft_failure(resp)
    if soft:
        raise MalformedPayload(f"fiscaldata {what}: {soft}")
    resp.raise_for_status()
    ctype = resp.headers.get("content-type", "")
    body = (resp.content or b"").lstrip()
    if "html" in ctype.lower() or body[:1] == b"<":
        raise MalformedPayload(f"fiscaldata {what}: HTML instead of JSON")
    try:
        return json.loads(body)
    except ValueError:
        raise MalformedPayload(f"fiscaldata {what}: body is not JSON") from None


def fetch_all(http, endpoint: str, *, fields=None, filters=None, sort=None,
              page_size: int = PAGE_SIZE, max_pages: int = MAX_PAGES, first_page_only=False):
    """GET every page. Returns (rows, meta, raw_payload_bytes, http_status)."""
    url = _endpoint_url(endpoint)
    rows: list[dict] = []
    raws: list[bytes] = []
    meta: dict = {}
    status = None
    page = 1
    while True:
        params = []
        if fields:
            params.append(("fields", ",".join(fields)))
        if filters:
            params.append(("filter", ",".join(filters)))
        if sort:
            params.append(("sort", sort))
        params += [("page[size]", str(page_size)), ("page[number]", str(page))]
        resp = http.get(url, params=params)
        status = resp.status
        doc = _decode_json(resp, endpoint)
        if not isinstance(doc, dict) or "error" in doc and "data" not in doc:
            raise MalformedPayload(f"fiscaldata {endpoint}: error document")
        data, meta = doc.get("data"), doc.get("meta")
        if not isinstance(data, list) or not isinstance(meta, dict):
            raise MalformedPayload(f"fiscaldata {endpoint}: missing data/meta")
        if any(not isinstance(r, dict) for r in data):
            raise MalformedPayload(f"fiscaldata {endpoint}: non-object row")
        if fields:
            for r in data[:1]:
                missing = [f for f in fields if f not in r]
                if missing:
                    raise MalformedPayload(f"fiscaldata {endpoint}: row lacks field(s) {missing}")
        rows += data
        raws.append(resp.content or b"")
        links = doc.get("links") or {}
        if first_page_only or not links.get("next"):
            break
        page += 1
        if page > max_pages:
            raise MalformedPayload(f"fiscaldata {endpoint}: more than {max_pages} pages")
    total = meta.get("total-count")
    if not first_page_only and total is not None:
        try:
            total = int(total)
        except (TypeError, ValueError):
            raise MalformedPayload(f"fiscaldata {endpoint}: bad meta.total-count") from None
        if total != len(rows):
            raise MalformedPayload(
                f"fiscaldata {endpoint}: partial ({len(rows)} rows of total-count {total})")
    return rows, meta, b"\n".join(raws), status


def _date_filters(start, end) -> list[str]:
    out = []
    if start is not None:
        out.append(f"record_date:gte:{_iso(start)}")
    if end is not None:
        out.append(f"record_date:lte:{_iso(end)}")
    return out


def _eq_filters(flt: dict) -> list[str]:
    out = []
    for k, v in (flt or {}).items():
        v = str(v)
        if any(c in v for c in ",:()"):
            continue          # not expressible in the filter grammar -> filtered client-side
        out.append(f"{k}:eq:{v}")
    return out


def _record_date(r: dict) -> date:
    try:
        return timeutil.as_date(str(r.get("record_date", "")).strip())
    except ValueError:
        raise MalformedPayload("fiscaldata: malformed record_date") from None


# ─────────────────────────────── shapes ───────────────────────────────────


def parse_daily(rows: list[dict], symbol: str, field: str, flt: dict, sign: float = 1.0) -> list[RawObs]:
    out: dict[str, RawObs] = {}
    for r in rows:
        if any(str(r.get(k)) != str(v) for k, v in (flt or {}).items()):
            continue
        if field not in r:
            raise MalformedPayload(f"fiscaldata: row lacks field {field}")
        d = _iso(_record_date(r))
        if d in out:
            raise MalformedPayload(f"fiscaldata: duplicate record_date {d}")
        v = _num(r.get(field))
        out[d] = RawObs(symbol, d, d, None if v is None else v * sign)
    return [out[k] for k in sorted(out)]


def tga_labels(params: dict) -> dict:
    if isinstance(params.get("labels"), dict) and params["labels"]:
        return dict(params["labels"])
    flt = params.get("filter") or {}
    cur = flt.get("account_type")
    field = params.get("field")
    labels = dict(TGA_LABELS) if (cur in TGA_LABELS or cur is None) else {}
    if cur is not None and field:
        labels[cur] = field
    return labels


def parse_labelled(rows: list[dict], symbol: str, labels: dict, sign: float = 1.0) -> list[RawObs]:
    """DTS: exactly one known label per record_date; any date without one = drift."""
    by_date: dict[str, list[dict]] = {}
    for r in rows:
        by_date.setdefault(_iso(_record_date(r)), []).append(r)
    out = []
    for d in sorted(by_date):
        hits = [r for r in by_date[d] if r.get("account_type") in labels]
        if not hits:
            raise MalformedPayload(
                f"fiscaldata: record_date {d} has no known TGA account_type (schema drift)")
        if len(hits) > 1:
            raise MalformedPayload(f"fiscaldata: record_date {d} has {len(hits)} TGA rows")
        r = hits[0]
        lab = r["account_type"]
        col = labels[lab]
        if col not in r:
            raise MalformedPayload(f"fiscaldata: TGA row lacks {col}")
        v = _num(r.get(col))
        if lab == _TGA_OPEN_QUIRK and col == "open_today_bal":
            other = _num(r.get("close_today_bal"))
            if other is not None and v is not None and other != v:
                # the quirk changed shape: which column is the close? refuse to guess
                raise MalformedPayload(f"fiscaldata: TGA closing row at {d} carries two different values")
        out.append(RawObs(symbol, d, d, None if v is None else v * sign))
    return out


def parse_mts(rows: list[dict], symbol: str, field: str, flt: dict, row_key: str,
              sign: float = 1.0) -> list[RawObs]:
    """Month rows from MTS Table 1 reports; newest report wins per month."""
    by_report: dict[date, list[dict]] = {}
    for r in rows:
        by_report.setdefault(_record_date(r), []).append(r)
    best: dict[tuple, tuple] = {}          # (y, m) -> (report_date, value)
    for rd in sorted(by_report):
        rs = by_report[rd]
        parents = {str(r.get("classification_id")): str(r.get(row_key) or "").strip()
                   for r in rs if str(r.get("sequence_level_nbr", "")).strip() == "1"}
        seen: set = set()
        for r in rs:
            if any(str(r.get(k)) != str(v) for k, v in (flt or {}).items()):
                continue
            name = str(r.get(row_key) or "").strip()
            if name not in MONTHS:
                raise MalformedPayload("fiscaldata MTS: month row with a non-month label")
            p = parents.get(str(r.get("parent_id")))
            if not p or not p.upper().startswith("FY ") or not p[3:].strip().isdigit():
                raise MalformedPayload("fiscaldata MTS: month row without an 'FY yyyy' parent")
            fy = int(p[3:].strip())
            m = MONTHS[name]
            y = fy - 1 if m >= 10 else fy
            if (y, m) in seen:
                raise MalformedPayload(f"fiscaldata MTS: {y}-{m:02d} twice in report {rd}")
            seen.add((y, m))
            if date(y, m, 1) > rd:
                raise MalformedPayload(f"fiscaldata MTS: report {rd} carries future month {y}-{m:02d}")
            if field not in r:
                raise MalformedPayload(f"fiscaldata MTS: row lacks {field}")
            v = _num(r.get(field))
            best[(y, m)] = (rd, None if v is None else v * sign)
    out = []
    for (y, m) in sorted(best):
        ps, pe = timeutil.month_bounds(y, m)
        out.append(RawObs(symbol, ps.isoformat(), pe.isoformat(), best[(y, m)][1]))
    return out


# ─────────────────────────────── adapter ──────────────────────────────────


@register
class FiscalDataAdapter(BaseAdapter):
    name = "fiscaldata"
    key_env = None
    max_series_per_request = 1

    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None):
        if http is None:
            raise ValueError("fiscaldata.fetch needs an HttpClient")
        return [self._fetch_one(s, mode, start, end, http) for s in as_specs(specs)]

    def _fetch_one(self, spec, mode, start, end, http):
        p = spec.params
        endpoint, field = p.get("endpoint"), p.get("field")
        if not endpoint or not field:
            raise MalformedPayload(f"fiscaldata {spec.symbol}: params.endpoint/field required")
        flt = dict(p.get("filter") or {})
        sign = float(p.get("sign", 1) or 1)
        if sign not in (1.0, -1.0):
            raise MalformedPayload(f"fiscaldata {spec.symbol}: params.sign must be +1 or -1")
        row_key = p.get("row_key")
        rk_mode = mode
        today = _utcnow().date()

        if row_key:                                            # ---- MTS reports
            fields = sorted({"record_date", "parent_id", "classification_id", row_key,
                             "sequence_level_nbr", field, *flt.keys()})
            if mode == "latest" and start is None:
                rows, meta, raw, status = fetch_all(http, endpoint, fields=fields,
                                                    sort="-record_date", page_size=100,
                                                    first_page_only=True)
                if rows:
                    top = max(_record_date(r) for r in rows)
                    rows = [r for r in rows if _record_date(r) == top]
                    if len(rows) >= 100:
                        raise MalformedPayload("fiscaldata MTS: latest report does not fit one page")
                win = ("latest", "")
            else:
                rows, meta, raw, status = fetch_all(http, endpoint, fields=fields,
                                                    filters=_date_filters(start, end), sort="record_date")
                win = (_iso(start) if start else "", _iso(end) if end else "")
            obs = parse_mts(rows, spec.symbol, field, flt, row_key, sign)
            if mode != "latest" or start is not None:
                obs = [o for o in obs if (start is None or o.period_end >= _iso(start))
                       and (end is None or o.period_start <= _iso(end))]
        else:                                                  # ---- daily datasets
            if mode == "latest" and start is None:
                start = today - timedelta(days=int(p.get("latest_days", 21) or 21))
            labelled = endpoint.strip("/") == DTS_OCB_ENDPOINT or "labels" in p
            if labelled:
                labels = tga_labels(p)
                fields = ["record_date", "account_type", *sorted(set(labels.values()) | {"close_today_bal"})]
                # NO server-side account_type filter: a date whose label drifted must be SEEN
                rows, meta, raw, status = fetch_all(http, endpoint, fields=fields,
                                                    filters=_date_filters(start, end), sort="record_date")
                obs = parse_labelled(rows, spec.symbol, labels, sign)
            else:
                fields = sorted({"record_date", field, *flt.keys()})
                rows, meta, raw, status = fetch_all(
                    http, endpoint, fields=fields,
                    filters=_date_filters(start, end) + _eq_filters(flt), sort="record_date")
                obs = parse_daily(rows, spec.symbol, field, flt, sign)
            win = (_iso(start) if start else "", _iso(end) if end else "")
        rk = f"fiscaldata:{endpoint.strip('/')}:{field}:{rk_mode}:{win[0]}..{win[1]}"
        warnings = []
        if not obs:
            warnings.append("no observations in window")
        return self.make_result(rk, obs, payload=raw, http_status=status, warnings=warnings)

    # optional adapter hook ------------------------------------------------------
    def calendar_events(self, horizon_days: int, http) -> list[dict]:
        now = _utcnow()
        until = (now + timedelta(days=int(horizon_days))).date()
        return [e for e in release_calendar(http)
                if e["calendar_key"] and e["sched_date"] <= until.isoformat()]


# ─────────────────────────────── calendar ─────────────────────────────────


def release_calendar(http, dataset_ids=None) -> list[dict]:
    """Fiscal Data release calendar (keyless JSON list of
    ``{datasetId, date, time, released}``).

    TIMEZONE = UTC (evidence, 2026-09-28 snapshot of 801 rows): Daily Treasury
    Statement rows are ``20:00`` up to 2026-10-30 and ``21:00`` from 2026-11-02;
    Debt to the Penny ``20:15`` -> ``21:15``; i.e. the clock jumps by exactly one
    hour at the US DST end (2026-11-01), which is what a FIXED Eastern wall time
    (16:00 / 16:15 ET) looks like when stored in UTC. MTS ``19:00`` in Nov/Dec
    = 14:00 EST, the MTS's documented 2:00 p.m. release. The date is the UTC
    date (identical to the ET date for all observed times, 19:00-21:15Z).

    Returns dicts: ``dataset_id``, ``calendar_key`` (registry key or None),
    ``at_utc`` (unix s), ``sched_date``/``sched_time`` (ET wall clock),
    ``tz`` 'America/New_York', ``precision`` 'exact', ``source``
    'authoritative_feed', ``released`` (bool as stated -- NOT trusted as
    evidence of data arrival: a future row was seen flagged released).
    """
    resp = http.get(CALENDAR_URL)
    doc = _decode_json(resp, "calendar")
    if not isinstance(doc, list):
        raise MalformedPayload("fiscaldata calendar: expected a JSON list")
    want = set(dataset_ids) if dataset_ids else None
    out = []
    for r in doc:
        if not isinstance(r, dict):
            raise MalformedPayload("fiscaldata calendar: non-object row")
        ds = str(r.get("datasetId") or "")
        if want is not None and ds not in want:
            continue
        try:
            d = timeutil.as_date(str(r.get("date", "")))
            hh, mm = str(r.get("time", "")).split(":")
            at = datetime(d.year, d.month, d.day, int(hh), int(mm), tzinfo=timezone.utc)
        except (ValueError, TypeError):
            raise MalformedPayload("fiscaldata calendar: malformed date/time") from None
        et = at.astimezone(timeutil.ET)
        out.append({
            "dataset_id": ds, "calendar_key": CALENDAR_KEYS.get(ds),
            "at_utc": int(at.timestamp()), "sched_date": et.date().isoformat(),
            "sched_time": et.strftime("%H:%M"), "tz": "America/New_York",
            "precision": "exact", "source": "authoritative_feed",
            "released": str(r.get("released", "")).lower() == "true",
        })
    out.sort(key=lambda e: (e["at_utc"], e["dataset_id"]))
    return out
