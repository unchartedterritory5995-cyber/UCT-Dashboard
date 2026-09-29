"""BEA adapter -- NIPA series from the BEA API (keyed) or the NIPA flat files (keyless).

PARAMS CONTRACT (``source.params``)
    dataset       "NIPA" (the only dataset implemented; anything else -> MalformedPayload)
    table         NIPA table id, e.g. "T10106"            (keyed mode: TableName)
    line          table line number, e.g. 1               (keyed mode: rows must match it)
    series_code   BEA series code, e.g. "A191RX"          (both modes: the row identity)
    frequency     "Q" | "M" | "A"  (default: the registry entry's frequency)
    unit_mult     optional int. Keyed mode: the BEA ``UNIT_MULT`` the registry's raw
                  units assume (6 = millions). A payload with a different UNIT_MULT is
                  REFUSED (MalformedPayload), never silently rescaled.

KEYED MODE (``BEA_API_KEY`` set)
    GET https://apps.bea.gov/api/data?UserID=<key>&method=GetData&DataSetName=NIPA
        &TableName=<table>&Frequency=<Q|M|A>&Year=<ALL|y1,y2,..>&ResultFormat=JSON
    One request per (table, frequency). A 200 with an EMPTY body is BEA's answer to a
    missing/invalid UserID -> SourceUnavailable("key"), never "no data". An ``Error``
    object naming the UserID -> SourceUnavailable; any other Error -> MalformedPayload.
    429 + Retry-After is honoured by econ.http.

KEYLESS MODE
    GET https://apps.bea.gov/national/Release/TXT/NipaData{Q,M,A}.txt  (~35 MB, lines
    ``%SeriesCode,Period,Value`` then ``A191RX,2026Q2,"24,269,613"``). One request per
    frequency file; only the requested series codes are parsed. The file's
    Last-Modified IS the release time (Phase 0: 26 Aug 2026 12:30:03 GMT for the GDP
    second estimate) -> ``FetchResult.source_published_at``. In ``latest`` mode the GET
    is conditional (ETag / If-Modified-Since); the conditional key includes the series
    set so a different batch never inherits another batch's 304. Validators are
    committed only after the payload parsed cleanly.

VALUES are returned exactly as BEA publishes them (flat-file DefaultScale / API
UNIT_MULT): current- and chained-dollar LEVELS are MILLIONS of dollars since BEA's
2023 comprehensive update; indexes and percent changes are unscaled. Missing markers
(``(NA)``, ``---``, ``(D)``, ...) become ``None`` -- never 0.

PERIODS  ``2026Q2`` -> 2026-04-01..2026-06-30; ``2026M07`` -> 2026-07-01..2026-07-31;
``2026`` -> the calendar year.
"""
from __future__ import annotations

import email.utils
import json
import re
from datetime import date, datetime, timezone
from typing import Optional

from .. import secrets, timeutil
from ..http import is_empty_body
from ..model import FetchResult, MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, as_specs, register

API_URL = "https://apps.bea.gov/api/data"
FLAT_BASE = "https://apps.bea.gov/national/Release/TXT/"
FLAT_FILES = {"Q": "NipaDataQ.txt", "M": "NipaDataM.txt", "A": "NipaDataA.txt"}
REGISTER_URL = FLAT_BASE + "SeriesRegister.txt"

# periods returned in 'latest' mode (enough to carry routine revisions)
LATEST_WINDOW = {"Q": 12, "M": 24, "A": 5}
NA_MARKERS = frozenset({"", "(na)", "na", "n.a.", "---", "--", "...", "(d)", "(x)", "(s)",
                        "(nm)", "nm", "(l)", "*"})

_Q_RE = re.compile(r"(\d{4})Q([1-4])")
_M_RE = re.compile(r"(\d{4})M(\d{2})")
_A_RE = re.compile(r"(\d{4})")


# --------------------------------------------------------------------------- helpers

def parse_period(label: str, freq: str) -> tuple[date, date]:
    """BEA period label -> (start, end). ValueError on anything unexpected."""
    s = (label or "").strip().upper()
    if freq == "Q":
        m = _Q_RE.fullmatch(s)
        if m:
            return timeutil.quarter_bounds(int(m.group(1)), int(m.group(2)))
    elif freq == "M":
        m = _M_RE.fullmatch(s)
        if m:
            return timeutil.month_bounds(int(m.group(1)), int(m.group(2)))
    elif freq == "A":
        m = _A_RE.fullmatch(s)
        if m:
            return timeutil.year_bounds(int(m.group(1)))
    raise ValueError(f"bad BEA {freq} period label")


def parse_value(raw) -> Optional[float]:
    """'24,269,613' -> 24269613.0 ; '(NA)' / '---' -> None ; garbage -> ValueError."""
    if raw is None:
        return None
    s = str(raw).strip().strip('"').strip()
    if s.lower() in NA_MARKERS:
        return None
    s = s.replace(",", "")
    v = float(s)                                   # ValueError on garbage
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError("non-finite")
    return v


def http_date_to_ts(value: Optional[str]) -> Optional[int]:
    if not value:
        return None
    try:
        dt = email.utils.parsedate_to_datetime(value)
    except (TypeError, ValueError, IndexError):
        return None
    if dt is None:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def _looks_html(body: bytes) -> bool:
    head = body.lstrip()[:200].lower()
    return head.startswith(b"<!doctype") or head.startswith(b"<html") or b"<html" in head


def _in_range(ps: date, pe: date, start: Optional[date], end: Optional[date]) -> bool:
    if start is not None and pe < start:
        return False
    if end is not None and ps > end:
        return False
    return True


# --------------------------------------------------------------------------- adapter

@register
class BeaAdapter(BaseAdapter):
    name = "bea"
    key_env = "BEA_API_KEY"
    max_series_per_request = 50          # grouped internally by file / table

    def __init__(self, today=None):
        self._today = today              # callable -> date (tests)

    def today(self) -> date:
        return self._today() if self._today else datetime.now(timezone.utc).date()

    # ------------------------------------------------------------------ spec access
    @staticmethod
    def _p(spec) -> dict:
        p = dict(spec.params or {})
        ds = str(p.get("dataset") or "NIPA").upper()
        if ds != "NIPA":
            raise MalformedPayload(f"bea: dataset {ds!r} not implemented for {spec.symbol}")
        code = str(p.get("series_code") or "").strip().upper()
        if not code:
            raise MalformedPayload(f"bea: {spec.symbol} has no params.series_code")
        freq = str(p.get("frequency") or spec.frequency or "").upper()
        if freq not in FLAT_FILES:
            raise MalformedPayload(f"bea: {spec.symbol} frequency {freq!r} unsupported")
        line = p.get("line")
        return {"code": code, "freq": freq, "table": str(p.get("table") or "").strip().upper(),
                "line": None if line in (None, "") else str(int(line)),
                "unit_mult": p.get("unit_mult")}

    # ------------------------------------------------------------------ fetch
    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None) -> list[FetchResult]:
        specs = as_specs(specs)
        if not specs:
            return []
        if http is None:
            raise ValueError("bea.fetch needs an HttpClient")
        start = timeutil.as_date(start) if start is not None else None
        end = timeutil.as_date(end) if end is not None else None
        key = self.key()
        if key:
            return self._fetch_api(specs, key, mode, start, end, http)
        return self._fetch_flat(specs, mode, start, end, http)

    # ------------------------------------------------------------------ window
    @staticmethod
    def _window(obs: list[RawObs], freq: str, mode: str) -> list[RawObs]:
        if mode != "latest":
            return obs
        n = LATEST_WINDOW[freq]
        by_sid: dict[str, list[RawObs]] = {}
        for o in obs:
            by_sid.setdefault(o.series_id, []).append(o)
        out: list[RawObs] = []
        for sid in by_sid:
            rows = sorted(by_sid[sid], key=lambda o: o.period_start)
            out.extend(rows[-n:])
        return out

    # ------------------------------------------------------------------ keyless
    def _fetch_flat(self, specs, mode, start, end, http) -> list[FetchResult]:
        groups: dict[str, list] = {}
        for s in specs:
            groups.setdefault(self._p(s)["freq"], []).append(s)
        results = []
        for freq, group in groups.items():
            results.append(self._fetch_flat_file(freq, group, mode, start, end, http))
        return results

    def _fetch_flat_file(self, freq, specs, mode, start, end, http) -> FetchResult:
        fname = FLAT_FILES[freq]
        by_code: dict[str, list[str]] = {}
        for s in specs:
            by_code.setdefault(self._p(s)["code"], []).append(s.symbol)
        codes = sorted(by_code)
        request_key = f"bea:flat:{fname}:{','.join(codes)}"
        cond = request_key if mode == "latest" else None
        resp = http.get(FLAT_BASE + fname, conditional_key=cond, defer_validators=True)
        if resp.not_modified:
            return self.make_result(request_key, [], resp=resp, payload=b"")
        if resp.is_redirect:
            raise SourceUnavailable(f"bea: {fname} redirected ({resp.status})")
        resp.raise_for_status()
        body = resp.content or b""
        if is_empty_body(resp):
            raise MalformedPayload(f"bea: {fname} returned an empty body")
        if _looks_html(body):
            raise MalformedPayload(f"bea: {fname} returned HTML, not the NIPA text file")
        rows = self.parse_flat(body, by_code, freq)
        published = http_date_to_ts(resp.headers.get("last-modified"))
        obs, warnings = self._finish(rows, by_code, freq, mode, start, end, published)
        if cond:
            http.commit_validators(cond, resp)
        return self.make_result(request_key, obs, resp=resp, payload=body,
                                source_published_at=published, warnings=warnings)

    @staticmethod
    def parse_flat(body: bytes, by_code: dict, freq: str) -> dict[str, list[tuple]]:
        """{code: [(period_start, period_end, value), ...]} for the requested codes only."""
        lines = body.splitlines()
        first = next((ln for ln in lines if ln.strip()), b"")
        if not first.lstrip(b"\xef\xbb\xbf").lstrip().startswith(b"%SeriesCode"):
            raise MalformedPayload("bea: flat file header is not '%SeriesCode,Period,Value'")
        wanted = {c.encode("ascii"): c for c in by_code}
        out: dict[str, list[tuple]] = {}
        bad = 0
        for ln in lines:
            comma = ln.find(b",")
            if comma <= 0:
                continue
            code = wanted.get(ln[:comma].strip())
            if code is None:
                continue
            rest = ln[comma + 1:].decode("utf-8", "replace")
            per, _, val = rest.partition(",")
            try:
                ps, pe = parse_period(per, freq)
                v = parse_value(val)
            except ValueError:
                bad += 1
                continue
            out.setdefault(code, []).append((ps.isoformat(), pe.isoformat(), v))
        if bad:
            raise MalformedPayload(f"bea: {bad} unparseable row(s) for the requested series")
        return out

    def _finish(self, rows, by_code, freq, mode, start, end, published):
        obs: list[RawObs] = []
        warnings: list[str] = []
        missing = [c for c in by_code if not rows.get(c)]
        if missing and len(missing) == len(by_code):
            raise MalformedPayload(f"bea: none of the requested series are in the payload ({missing[:5]})")
        for c in missing:
            warnings.append(f"missing: {c} ({','.join(by_code[c])}) absent from payload")
        today = self.today()
        for code, recs in rows.items():
            for ps, pe, v in recs:
                dps, dpe = date.fromisoformat(ps), date.fromisoformat(pe)
                if dps > today or not _in_range(dps, dpe, start, end):
                    continue
                for sym in by_code[code]:
                    obs.append(RawObs(sym, ps, pe, v, "", None))
        obs = self._window(obs, freq, mode)
        obs.sort(key=lambda o: (o.series_id, o.period_start))
        return obs, warnings

    # ------------------------------------------------------------------ keyed
    def _years(self, mode, start, end) -> str:
        y1 = (end or self.today()).year
        if mode == "latest":
            return ",".join(str(y) for y in range(y1 - 2, y1 + 1))
        if start is not None and y1 - start.year <= 20:
            return ",".join(str(y) for y in range(start.year, y1 + 1))
        return "ALL"

    def api_params(self, table: str, freq: str, years: str, key: str) -> list[tuple]:
        return [("UserID", key), ("method", "GetData"), ("DataSetName", "NIPA"),
                ("TableName", table), ("Frequency", freq), ("Year", years),
                ("ResultFormat", "JSON")]

    def _fetch_api(self, specs, key, mode, start, end, http) -> list[FetchResult]:
        groups: dict[tuple, list] = {}
        for s in specs:
            p = self._p(s)
            if not p["table"]:
                raise MalformedPayload(f"bea: {s.symbol} has no params.table (keyed mode)")
            groups.setdefault((p["table"], p["freq"]), []).append(s)
        years = self._years(mode, start, end)
        results = []
        for (table, freq), group in groups.items():
            request_key = f"bea:api:NIPA:{table}:{freq}:{years}"
            resp = http.get(API_URL, params=self.api_params(table, freq, years, key))
            if resp.is_redirect:
                raise SourceUnavailable(f"bea: API redirected ({resp.status})")
            resp.raise_for_status()
            if is_empty_body(resp):
                raise SourceUnavailable("bea: API returned 200 with an empty body "
                                        "(key missing or rejected)")
            if _looks_html(resp.content or b""):
                raise MalformedPayload("bea: API returned HTML instead of JSON")
            data = self.parse_api(resp.content, table)
            wanted = {}
            for s in group:
                p = self._p(s)
                wanted.setdefault(p["code"], []).append((s.symbol, p["line"], p["unit_mult"]))
            rows, by_code = self._select_api(data, wanted, freq)
            obs, warnings = self._finish(rows, by_code, freq, mode, start, end, None)
            results.append(self.make_result(request_key, obs, resp=resp, warnings=warnings))
        return results

    @staticmethod
    def parse_api(content: bytes, table: str) -> list[dict]:
        try:
            doc = json.loads(content)
        except (ValueError, UnicodeDecodeError):
            raise MalformedPayload("bea: API payload is not JSON") from None
        root = doc.get("BEAAPI") if isinstance(doc, dict) else None
        if not isinstance(root, dict):
            raise MalformedPayload("bea: API payload has no BEAAPI object")
        results = root.get("Results")
        if isinstance(results, list):
            results = results[0] if results else None
        err = root.get("Error") or (results.get("Error") if isinstance(results, dict) else None)
        if err:
            if isinstance(err, list):
                err = err[0] if err else {}
            code = str((err or {}).get("APIErrorCode", "")).strip()
            desc = secrets.redact(str((err or {}).get("APIErrorDescription", "")))[:200]
            low = desc.lower()
            if "userid" in low or "user id" in low or "not registered" in low or "api key" in low:
                raise SourceUnavailable(f"bea: API rejected the key (code {code})")
            if "limit" in low or "exceed" in low or "throttl" in low:
                raise SourceUnavailable(f"bea: API throttled (code {code})")
            raise MalformedPayload(f"bea: API error {code}: {desc}")
        if not isinstance(results, dict) or not isinstance(results.get("Data"), list):
            raise MalformedPayload(f"bea: API payload for {table} has no Results.Data")
        return results["Data"]

    @staticmethod
    def _select_api(data: list[dict], wanted: dict, freq: str):
        rows: dict[str, list[tuple]] = {}
        by_code: dict[str, list[str]] = {}
        for code, targets in wanted.items():
            by_code[code] = [t[0] for t in targets]
            line = targets[0][1]
            umult = targets[0][2]
            code_rows = [r for r in data if isinstance(r, dict)
                         and str(r.get("SeriesCode", "")).strip().upper() == code]
            if not code_rows:
                continue
            if line is not None:
                on_line = [r for r in code_rows if str(r.get("LineNumber", "")).strip() == line]
                if not on_line:
                    raise MalformedPayload(f"bea: {code} is not on line {line} of the table "
                                           "(identity drift)")
                code_rows = on_line
            seen: dict[str, tuple] = {}
            for r in code_rows:
                if umult is not None and str(r.get("UNIT_MULT", "")).strip() not in ("", str(umult)):
                    raise MalformedPayload(f"bea: {code} UNIT_MULT {r.get('UNIT_MULT')!r} != "
                                           f"expected {umult} (scale drift)")
                try:
                    ps, pe = parse_period(str(r.get("TimePeriod", "")), freq)
                    v = parse_value(r.get("DataValue"))
                except ValueError:
                    raise MalformedPayload(f"bea: unparseable row for {code}") from None
                k = ps.isoformat()
                if k in seen and seen[k][2] != v:
                    raise MalformedPayload(f"bea: {code} period {k} appears twice with different values")
                seen[k] = (k, pe.isoformat(), v)
            rows[code] = list(seen.values())
        return rows, by_code

    # ------------------------------------------------------------------ register
    @staticmethod
    def parse_register(body: bytes) -> dict[str, dict]:
        """SeriesRegister.txt -> {code: {label, metric, calc, scale, tables:[(table, line)]}}."""
        import csv
        import io
        text = body.decode("utf-8-sig", "replace")
        rdr = csv.reader(io.StringIO(text))
        header = next(rdr, None)
        if not header or not header[0].lstrip().startswith("%SeriesCode"):
            raise MalformedPayload("bea: SeriesRegister header not recognised")
        out = {}
        for row in rdr:
            if len(row) < 6:
                continue
            tables = []
            for t in row[5].split("|"):
                tab, _, ln = t.partition(":")
                if tab:
                    tables.append((tab.strip(), ln.strip()))
            try:
                scale = int(row[4])
            except ValueError:
                scale = None
            out[row[0].strip()] = {"label": row[1], "metric": row[2], "calc": row[3],
                                   "scale": scale, "tables": tables}
        return out
