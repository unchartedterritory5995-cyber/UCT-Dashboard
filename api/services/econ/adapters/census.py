"""Census adapter -- economic indicator time series (EITS) by program/category/data type.

PARAMS CONTRACT (``source.params``)
    program          EITS program, lower-case: "marts" | "resconst" | "m3" | "ftd" | ...
    category         category_code, e.g. "44X72", "ASTARTS", "MDM", "BOPGS"
    data_type        data_type_code, e.g. "SM", "TOTAL", "NO", "BAL"
    seasonal         "SA" (default) | "NSA"
    geo              geo level, default "US"
    advance_program  optional, e.g. "advm3": months the full program has not published
                     yet are filled from the ADVANCE program and flagged "a"
                     (USDURGOODS: full M3 lags the advance report by ~1 week)
    recent_flags     optional list, e.g. ["a", "p"]: flags applied to the newest non-NA
                     periods of the main program, newest first (position-derived from
                     the agency's published revision schedule; the payload itself has no flags)
    export_program   optional override of the keyless export program code (default: map below)

KEYED MODE (``CENSUS_API_KEY`` set)
    GET https://api.census.gov/data/timeseries/eits/<program>?get=cell_value,data_type_code,
        time_slot_id,error_data,category_code,seasonally_adj&for=us:*&time=from+YYYY
        &category_code=..&data_type_code=..&seasonally_adj=yes|no&key=<key>
    A missing/rejected key answers 302 -> missing_key.html with ``X-DataWebAPI-KeyError``;
    econ.http never follows redirects and that becomes SourceUnavailable("key").
    204 / empty -> MalformedPayload (no rows for the requested identity).

KEYLESS MODE
    GET https://www.census.gov/econ_export/?format=csv&mode=report&default=false
        &errormode=Dep&charttype=&chartmode=&chartadjn=&submit=GET+DATA
        &program=<PROGRAM>&startYear=<y0>&endYear=<y1>&categories[]=<category>
        &dataType=<data_type>&geoLevel=US&adjusted=1        (SA; NSA -> notAdjusted=1)
    This is the CSV export behind census.gov/econ/currentdata (the "Time Series /
    Trend Charts" tool) and uses the SAME program/category/data-type codes as EITS.
    ⚠ An unchecked box must be OMITTED: sending ``notAdjusted=0`` / ``errorData=0``
    silently switches the export to NSA / coefficient-of-variation. The 6-line
    header is therefore VERIFIED (SA vs NSA, no CV/standard-error series) before
    any value is trusted. Last-Modified is the extraction time, not a release time,
    so no conditional GET and no source_published_at.

VALUES are Census's published units (Millions of Dollars; housing starts in
Thousands of Units, SAAR; trade balance negative for a deficit). ``NA`` / ``(S)`` /
``(NA)`` / ``(X)`` / ``(D)`` / ``(Z)`` -> None (never 0). Placeholder NA rows the export
emits for months that have not happened / not been published yet (and leading NA
rows before a series starts) are dropped; an interior NA stays a None.

PERIODS  ``Aug-2026`` / ``2026-08`` -> 2026-08-01..2026-08-31.
"""
from __future__ import annotations

import csv
import io
import json
import re
from datetime import date, datetime, timezone
from typing import Optional

from .. import timeutil
from ..http import is_empty_body, is_error_redirect
from ..model import FetchResult, MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, as_specs, register

API_BASE = "https://api.census.gov/data/timeseries/eits/"
EXPORT_URL = "https://www.census.gov/econ_export/"

# EITS (api) program -> econ_export program code
EXPORT_PROGRAM = {
    "marts": "MARTS", "mrts": "MRTS", "mrtsadv": "MRTSADV", "resconst": "RESCONST",
    "ressales": "RESSALES", "m3": "M3", "advm3": "M3ADV", "ftd": "FTD", "ftdadv": "FTDADV",
    "mtis": "MTIS", "mwts": "MWTS", "mwtsadv": "MWTSADV", "vip": "VIP", "bfs": "BFS",
    "hv": "HV", "qfr": "QFR", "qss": "QSS",
}
NA_MARKERS = frozenset({"", "na", "(na)", "(s)", "(x)", "(d)", "(z)", "n.a.", "(nm)", "-", "--",
                        "---", "(*)", "*"})
LATEST_YEARS = 2                      # latest mode: this year + the 2 before
DEFAULT_HISTORY_START = 1992

_MON = {m: i for i, m in enumerate(["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug",
                                    "sep", "oct", "nov", "dec"], 1)}
_EXPORT_PERIOD_RE = re.compile(r"([A-Za-z]{3})-(\d{4})")
_API_TIME_RE = re.compile(r"(\d{4})-(\d{2})")


def parse_period(label: str) -> tuple[date, date]:
    s = (label or "").strip()
    m = _EXPORT_PERIOD_RE.fullmatch(s)
    if m and m.group(1).lower() in _MON:
        return timeutil.month_bounds(int(m.group(2)), _MON[m.group(1).lower()])
    m = _API_TIME_RE.fullmatch(s)
    if m:
        return timeutil.month_bounds(int(m.group(1)), int(m.group(2)))
    raise ValueError("unrecognised Census period label")


def parse_value(raw) -> Optional[float]:
    if raw is None:
        return None
    s = str(raw).strip().strip('"').strip()
    if s.lower() in NA_MARKERS:
        return None
    v = float(s.replace(",", ""))
    if v != v or v in (float("inf"), float("-inf")):
        raise ValueError("non-finite")
    return v


def _looks_html(body: bytes) -> bool:
    head = body.lstrip()[:300].lower()
    return head.startswith(b"<!doctype") or head.startswith(b"<html") or b"<html" in head


@register
class CensusAdapter(BaseAdapter):
    name = "census"
    key_env = "CENSUS_API_KEY"
    max_series_per_request = 1

    def __init__(self, today=None):
        self._today = today

    def today(self) -> date:
        return self._today() if self._today else datetime.now(timezone.utc).date()

    # ------------------------------------------------------------------ spec access
    @staticmethod
    def _p(spec) -> dict:
        p = dict(spec.params or {})
        prog = str(p.get("program") or "").strip().lower()
        cat = str(p.get("category") or "").strip()
        dt = str(p.get("data_type") or "").strip()
        if not (prog and cat and dt):
            raise MalformedPayload(f"census: {spec.symbol} needs params.program/category/data_type")
        if str(spec.frequency or "M").upper() != "M":
            raise MalformedPayload(f"census: {spec.symbol} frequency {spec.frequency!r} unsupported")
        seas = str(p.get("seasonal") or "SA").upper()
        if seas not in ("SA", "NSA"):
            raise MalformedPayload(f"census: {spec.symbol} seasonal {seas!r} must be SA|NSA")
        adv = str(p.get("advance_program") or "").strip().lower() or None
        flags = [str(f) for f in (p.get("recent_flags") or [])]
        return {"program": prog, "category": cat, "data_type": dt, "seasonal": seas,
                "geo": str(p.get("geo") or "US").upper(), "advance": adv, "flags": flags,
                "export_program": str(p.get("export_program") or "").strip().upper() or None}

    def _years(self, spec, mode, start, end) -> tuple[int, int]:
        y1 = (end or self.today()).year
        if mode == "latest":
            return y1 - LATEST_YEARS, y1
        if start is not None:
            return start.year, y1
        hs = str(spec.get("history_start") or "")
        m = re.match(r"(\d{4})", hs)
        return (int(m.group(1)) if m else DEFAULT_HISTORY_START), y1

    # ------------------------------------------------------------------ fetch
    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None) -> list[FetchResult]:
        specs = as_specs(specs)
        if http is None:
            raise ValueError("census.fetch needs an HttpClient")
        start = timeutil.as_date(start) if start is not None else None
        end = timeutil.as_date(end) if end is not None else None
        key = self.key()
        return [self._fetch_one(s, key, mode, start, end, http) for s in specs]

    def _fetch_one(self, spec, key, mode, start, end, http) -> FetchResult:
        p = self._p(spec)
        y0, y1 = self._years(spec, mode, start, end)
        get = self._get_api if key else self._get_export
        rows, payload, rk = get(p["program"], p, y0, y1, key, http,
                                export_program=p["export_program"])
        rows = self._trim(rows)
        if not rows:
            raise MalformedPayload(f"census: no values for {rk}")
        flagged = self._apply_flags(rows, p["flags"])
        payloads, keys = [payload], [rk]
        if p["advance"]:
            last_full = max(ps for ps, _, v, _ in flagged if v is not None)
            ay0 = max(y0, int(last_full[:4]))
            arows, apayload, ark = get(p["advance"], p, ay0, y1, key, http, export_program=None)
            payloads.append(apayload)
            keys.append(ark)
            for ps, pe, v in self._trim(arows):
                if ps > last_full and v is not None:
                    flagged.append((ps, pe, v, "a"))
        today = self.today()
        obs = []
        for ps, pe, v, flag in sorted(flagged):
            dps, dpe = date.fromisoformat(ps), date.fromisoformat(pe)
            if dps > today:
                continue
            if start is not None and dpe < start:
                continue
            if end is not None and dps > end:
                continue
            obs.append(RawObs(spec.symbol, ps, pe, v, flag, None))
        body = b"\n".join(payloads)
        return self.make_result("+".join(keys), obs, payload=body, http_status=200)

    # ------------------------------------------------------------------ shaping
    @staticmethod
    def _trim(rows: list[tuple]) -> list[tuple]:
        """Sort by period, drop leading and trailing NA placeholders."""
        rows = sorted(rows)
        idx = [i for i, r in enumerate(rows) if r[2] is not None]
        if not idx:
            return []
        return rows[idx[0]: idx[-1] + 1]

    @staticmethod
    def _apply_flags(rows, flags) -> list[tuple]:
        out = [(ps, pe, v, "") for ps, pe, v in rows]
        live = [i for i, r in enumerate(out) if r[2] is not None]
        for f, i in zip(flags, reversed(live)):
            ps, pe, v, _ = out[i]
            out[i] = (ps, pe, v, f)
        return out

    # ------------------------------------------------------------------ keyless (econ_export)
    def export_params(self, program: str, p: dict, y0: int, y1: int,
                      export_program: Optional[str] = None) -> list[tuple]:
        prog = export_program or EXPORT_PROGRAM.get(program, program.upper())
        params = [("format", "csv"), ("mode", "report"), ("default", "false"),
                  ("errormode", "Dep"), ("charttype", ""), ("chartmode", ""), ("chartadjn", ""),
                  ("submit", "GET DATA"), ("program", prog), ("startYear", str(y0)),
                  ("endYear", str(y1)), ("categories[]", p["category"]),
                  ("dataType", p["data_type"]), ("geoLevel", p["geo"])]
        # unchecked boxes are OMITTED (notAdjusted=0 would still select NSA)
        params.append(("adjusted", "1") if p["seasonal"] == "SA" else ("notAdjusted", "1"))
        return params

    def _get_export(self, program, p, y0, y1, key, http, export_program=None):
        prog = export_program or EXPORT_PROGRAM.get(program, program.upper())
        rk = f"census:export:{prog}:{p['category']}:{p['data_type']}:{p['seasonal']}:{y0}-{y1}"
        resp = http.get(EXPORT_URL, params=self.export_params(program, p, y0, y1, export_program))
        if resp.is_redirect:
            raise SourceUnavailable(f"census: export redirected ({resp.status})")
        resp.raise_for_status()
        body = resp.content or b""
        if is_empty_body(resp):
            raise MalformedPayload(f"census: export returned an empty body ({rk})")
        if _looks_html(body):
            raise MalformedPayload(f"census: export returned HTML, not CSV ({rk})")
        return self.parse_export(body, p["seasonal"]), body, rk

    @staticmethod
    def parse_export(body: bytes, seasonal: str = "SA") -> list[tuple]:
        """econ_export CSV -> [(period_start, period_end, value)]; header verified."""
        text = body.decode("utf-8-sig", "replace")
        lines = text.splitlines()
        try:
            hdr_at = next(i for i, ln in enumerate(lines) if ln.strip().lower() == "period,value")
        except StopIteration:
            raise MalformedPayload("census: export has no 'Period,Value' header") from None
        meta = " | ".join(ln.strip() for ln in lines[:hdr_at] if ln.strip())
        if "u.s. census bureau" not in meta.lower():
            raise MalformedPayload("census: export preamble not recognised")
        low = meta.lower()
        if "cv of" in low or "coefficient of variation" in low or "standard error" in low:
            raise MalformedPayload("census: export returned a sampling-variability series")
        not_adj = "not seasonally adjusted" in low
        adj = "seasonally adjusted" in low.replace("not seasonally adjusted", "")
        if seasonal == "SA" and (not_adj or not adj):
            raise MalformedPayload("census: export is not the seasonally adjusted series")
        if seasonal == "NSA" and not not_adj:
            raise MalformedPayload("census: export is not the not-seasonally-adjusted series")
        out, bad = [], 0
        for row in csv.reader(lines[hdr_at + 1:]):
            if not row or not row[0].strip():
                continue
            if len(row) < 2:
                bad += 1
                continue
            try:
                ps, pe = parse_period(row[0])
                v = parse_value(row[1])
            except ValueError:
                bad += 1
                continue
            out.append((ps.isoformat(), pe.isoformat(), v))
        if bad:
            raise MalformedPayload(f"census: {bad} unparseable export row(s)")
        seen = {}
        for ps, pe, v in out:
            if ps in seen and seen[ps][2] != v:
                raise MalformedPayload(f"census: period {ps} appears twice with different values")
            seen[ps] = (ps, pe, v)
        return list(seen.values())

    # ------------------------------------------------------------------ keyed (EITS API)
    def api_params(self, p: dict, y0: int, key: str) -> list[tuple]:
        return [("get", "cell_value,data_type_code,time_slot_id,error_data,category_code,seasonally_adj"),
                ("for", "us:*"), ("time", f"from {y0}"),
                ("category_code", p["category"]), ("data_type_code", p["data_type"]),
                ("seasonally_adj", "yes" if p["seasonal"] == "SA" else "no"),
                ("key", key)]

    def _get_api(self, program, p, y0, y1, key, http, export_program=None):
        rk = f"census:eits:{program}:{p['category']}:{p['data_type']}:{p['seasonal']}:{y0}-{y1}"
        resp = http.get(API_BASE + program, params=self.api_params(p, y0, key))
        if resp.is_redirect:
            if is_error_redirect(resp):
                raise SourceUnavailable("census: EITS API rejected the key "
                                        "(302 to missing_key / X-DataWebAPI-KeyError)")
            raise SourceUnavailable(f"census: EITS API redirected ({resp.status})")
        if resp.status == 204:
            raise MalformedPayload(f"census: EITS returned no rows ({rk})")
        if 400 <= resp.status < 500:
            raise MalformedPayload(f"census: EITS refused the query with HTTP {resp.status} ({rk})")
        resp.raise_for_status()
        body = resp.content or b""
        if is_empty_body(resp):
            raise MalformedPayload(f"census: EITS returned an empty body ({rk})")
        if _looks_html(body):
            raise MalformedPayload(f"census: EITS returned HTML, not JSON ({rk})")
        return self.parse_api(body, p, y1), body, rk

    @staticmethod
    def parse_api(body: bytes, p: dict, y1: Optional[int] = None) -> list[tuple]:
        try:
            doc = json.loads(body)
        except (ValueError, UnicodeDecodeError):
            raise MalformedPayload("census: EITS payload is not JSON") from None
        if not isinstance(doc, list) or not doc or not isinstance(doc[0], list):
            raise MalformedPayload("census: EITS payload is not a header+rows array")
        hdr = [str(h) for h in doc[0]]
        need = ("cell_value", "time", "category_code", "data_type_code")
        if any(n not in hdr for n in need):
            raise MalformedPayload("census: EITS header lacks required columns")
        ix = {h: i for i, h in enumerate(hdr)}
        want_sa = "yes" if p["seasonal"] == "SA" else "no"
        seen: dict[str, tuple] = {}
        bad = 0
        for row in doc[1:]:
            if not isinstance(row, list) or len(row) != len(hdr):
                bad += 1
                continue
            g = lambda n: row[ix[n]] if n in ix else None  # noqa: E731
            if str(g("category_code")) != p["category"] or str(g("data_type_code")) != p["data_type"]:
                continue
            if "seasonally_adj" in ix and str(g("seasonally_adj")).lower() != want_sa:
                continue
            if "error_data" in ix and str(g("error_data")).lower() not in ("no", ""):
                continue
            try:
                ps, pe = parse_period(str(g("time")))
                v = parse_value(g("cell_value"))
            except ValueError:
                bad += 1
                continue
            k = ps.isoformat()
            if k in seen and seen[k][2] != v:
                raise MalformedPayload(f"census: period {k} appears twice with different values")
            seen[k] = (k, pe.isoformat(), v)
        if bad:
            raise MalformedPayload(f"census: {bad} malformed EITS row(s)")
        if not seen:
            raise MalformedPayload("census: EITS payload has no rows for the requested identity")
        return list(seen.values())

