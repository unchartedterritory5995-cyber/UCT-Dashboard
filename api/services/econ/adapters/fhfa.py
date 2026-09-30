"""FHFA House Price Index adapter (keyless CSV master file).

File: ``https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv`` (~17 MB,
every FHFA HPI flavour/level/place in one table). Header (verified live
2026-09-28): ``hpi_type,hpi_flavor,frequency,level,place_name,place_id,yr,
period,index_nsa,index_sa,rstderr,note``.

USFHFAHPI = rows with ``hpi_type='traditional'``, ``hpi_flavor='purchase-only'``,
``frequency='monthly'``, ``level='USA or Census Division'``, ``place_id='USA'``
(``place_name='United States'``) -- 426 rows 1991-01..2026-06 on 2026-09-28,
2026-06 index_sa 442.53 / index_nsa 452.26. ``yr`` + ``period`` (1..12) -> the
calendar month. (Quarterly rows use period 1..4 -> calendar quarter.)

No validators on this file (Drupal, ``Cache-Control: no-cache``, no ETag /
Last-Modified) -> ``source_published_at`` is None; the scheduler places the
release by the FHFA calendar (09:00 ET per FHFA's HPI reports). Because the
whole 17 MB file is the only keyless path, ``latest`` mode downloads it too --
poll it only around the scheduled release.

``source.params`` read: ``file`` (URL; must be https on www.fhfa.gov),
``filter`` (dict: every key must be a CSV column and every row must match all
of them), ``column`` (value column, e.g. ``index_sa``), ``latest_n``
(optional, default 24 months in latest mode without a start).
Blank value -> None (never 0). A filter matching nothing, a duplicate period,
a missing column or an HTML body -> MalformedPayload.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Optional
from urllib.parse import urlsplit

from .. import http as econ_http
from .. import timeutil
from ..model import MalformedPayload, RawObs
from .base import BaseAdapter, as_specs, register

DEFAULT_FILE = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv"
REQUIRED_COLUMNS = ("yr", "period")
NA_MARKERS = frozenset({"", ".", "NA", "N/A", "--", "-"})


def _num(s) -> Optional[float]:
    t = (s or "").strip()
    if t in NA_MARKERS:
        return None
    if not re.fullmatch(r"-?\d+(\.\d+)?", t):
        raise MalformedPayload("fhfa: non-numeric value")
    return float(t)


def parse_master(content: bytes, *, symbol: str, flt: dict, column: str, frequency: str) -> list[RawObs]:
    text = (content or b"").decode("utf-8-sig", "replace")
    if not text.strip():
        raise MalformedPayload("fhfa: empty body")
    if text.lstrip()[:1] == "<":
        raise MalformedPayload("fhfa: HTML instead of CSV")
    reader = csv.DictReader(io.StringIO(text))
    cols = reader.fieldnames or []
    missing = [c for c in (*REQUIRED_COLUMNS, column, *flt.keys()) if c not in cols]
    if missing:
        raise MalformedPayload(f"fhfa: CSV lacks column(s) {missing}")
    f = (frequency or "M").upper()
    out: dict[str, RawObs] = {}
    for row in reader:
        if any((row.get(k) or "").strip() != str(v) for k, v in flt.items()):
            continue
        try:
            yr, per = int(row["yr"]), int(row["period"])
        except (TypeError, ValueError):
            raise MalformedPayload("fhfa: bad yr/period") from None
        try:
            if f == "M":
                ps, pe = timeutil.month_bounds(yr, per)
            elif f == "Q":
                ps, pe = timeutil.quarter_bounds(yr, per)
            else:
                raise MalformedPayload(f"fhfa {symbol}: unsupported frequency {f}")
        except ValueError:
            raise MalformedPayload("fhfa: period out of range for the frequency") from None
        k = ps.isoformat()
        if k in out:
            raise MalformedPayload(f"fhfa {symbol}: duplicate period {k} for the filter")
        out[k] = RawObs(symbol, k, pe.isoformat(), _num(row.get(column)))
    if not out:
        raise MalformedPayload(f"fhfa {symbol}: filter matched no rows")
    return [out[k] for k in sorted(out)]


@register
class FhfaAdapter(BaseAdapter):
    name = "fhfa"
    key_env = None
    max_series_per_request = 1

    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None):
        if http is None:
            raise ValueError("fhfa.fetch needs an HttpClient")
        return [self._fetch_one(s, mode, start, end, http) for s in as_specs(specs)]

    def _fetch_one(self, spec, mode, start, end, http):
        p = spec.params
        url = str(p.get("file") or DEFAULT_FILE)
        u = urlsplit(url)
        if u.scheme != "https" or (u.hostname or "").lower() not in ("www.fhfa.gov", "fhfa.gov"):
            raise MalformedPayload(f"fhfa {spec.symbol}: params.file must be an https fhfa.gov URL")
        column = p.get("column")
        flt = dict(p.get("filter") or {})
        if not column or not flt:
            raise MalformedPayload(f"fhfa {spec.symbol}: params.column and params.filter are required")
        resp = http.get(url)
        soft = econ_http.soft_failure(resp)
        if soft:
            raise MalformedPayload(f"fhfa {spec.symbol}: {soft}")
        resp.raise_for_status()
        if "html" in resp.headers.get("content-type", "").lower():
            raise MalformedPayload(f"fhfa {spec.symbol}: HTML instead of CSV")
        obs = parse_master(resp.content, symbol=spec.symbol, flt=flt, column=column,
                           frequency=spec.frequency)
        if start is not None:
            obs = [o for o in obs if o.period_end >= timeutil.iso(start)]
        if end is not None:
            obs = [o for o in obs if o.period_start <= timeutil.iso(end)]
        if mode == "latest" and start is None:
            obs = obs[-int(p.get("latest_n", 24) or 24):]
        fid = "|".join(f"{k}={flt[k]}" for k in sorted(flt))
        rk = (f"fhfa:{u.path.rsplit('/', 1)[-1]}:{fid}:{column}:{mode}:"
              f"{timeutil.iso(start) if start else ''}..{timeutil.iso(end) if end else ''}")
        return self.make_result(rk, obs, resp=resp)
