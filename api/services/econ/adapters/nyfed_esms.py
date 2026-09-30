"""NY Fed Empire State Manufacturing Survey (ESMS) adapter -- keyless CSV files.

Files (linked from https://www.newyorkfed.org/survey/empire/empiresurvey_overview,
"Historical Tables"), under ``/medialibrary/media/survey/empire/data/``:

  esms_seasonallyadjusted_diffusion.csv       SA diffusion indexes   (alias "sa_diffusion")
  esms_notseasonallyadjusted_diffusion.csv    NSA diffusion indexes  (alias "nsa_diffusion")
  esms_seasonallyadjusted_allseries.csv       SA all series          (alias "sa_all")
  esms_notseasonallyadjusted_allseries.csv    NSA all series         (alias "nsa_all")

Layout (live 2026-09-28): header ``surveyDate,GACDISA,NOCDISA,...``; one row per
survey month, ``surveyDate`` = the month's LAST day (``2026-09-30``); ``ND`` =
not available (e.g. ASCDISA before 2021-10). Column names are defined in the
NY Fed "Data definitions" PDF (``data/diffusion_idx.pdf``): ``GACDISA`` =
"Current General Business Conditions", seasonally adjusted -- the headline index.

``source.params`` contract:
  file     alias above or one of the four file names            (required)
  column   CSV column, e.g. "GACDISA"                            (required)
  latest_n periods returned in latest mode (default 12)

Every January all SA history is re-benchmarked to new seasonal factors
(registry revision.type seasonal_factor_revision) -> history mode re-reads the
whole (36 KB) file; latest mode returns the trailing ``latest_n`` months.
No validators (``Cache-Control: no-cache, no-store``); no publication timestamp
in the file -> ``source_published_at`` None. Akamai fronts the host: a 403 is
reported as ``SourceUnavailable``, never worked around.
"""
from __future__ import annotations

import csv
import io
import re
from typing import Optional

from .. import http as econ_http
from .. import timeutil
from ..model import FetchResult, MalformedPayload, RawObs, SourceUnavailable
from .base import BaseAdapter, SeriesSpec, as_specs, register

BASE = "https://www.newyorkfed.org/medialibrary/media/survey/empire/data/"
FILES = {
    "sa_diffusion": "esms_seasonallyadjusted_diffusion.csv",
    "nsa_diffusion": "esms_notseasonallyadjusted_diffusion.csv",
    "sa_all": "esms_seasonallyadjusted_allseries.csv",
    "nsa_all": "esms_notseasonallyadjusted_allseries.csv",
}
LATEST_N = 12
NA_TOKENS = frozenset({"ND", "NA", "N/A", "", "."})
_DATE = re.compile(r"^(\d{4})-(\d{2})(?:-(\d{2}))?$")
_COL = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,31}$")


def file_of(spec: SeriesSpec) -> str:
    raw = str(spec.params.get("file") or "").strip()
    if raw in FILES:
        return FILES[raw]
    if raw in FILES.values():
        return raw
    raise MalformedPayload(f"{spec.symbol}: nyfed_esms params.file must be one of {sorted(FILES)}")


def column_of(spec: SeriesSpec) -> str:
    c = str(spec.params.get("column") or "").strip()
    if not _COL.match(c):
        raise MalformedPayload(f"{spec.symbol}: nyfed_esms params.column missing/invalid")
    return c


def parse_csv(body: bytes) -> tuple[list[str], list[list[str]]]:
    if not body or not body.strip():
        raise MalformedPayload("ESMS: empty body")
    head = body.lstrip()[:200].lower()
    if head.startswith(b"<") or b"<html" in head:
        raise MalformedPayload("ESMS: HTML page instead of CSV")
    rows = [r for r in csv.reader(io.StringIO(body.decode("utf-8-sig", "replace"))) if any(c.strip() for c in r)]
    if not rows or rows[0][0].strip() != "surveyDate":
        raise MalformedPayload("ESMS: header does not start with surveyDate")
    header = [h.strip() for h in rows[0]]
    if len(set(header)) != len(header):
        raise MalformedPayload("ESMS: duplicate column names")
    return header, rows[1:]


def _value(raw: str) -> Optional[float]:
    s = str(raw).strip()
    if s.upper() in NA_TOKENS:
        return None
    try:
        v = float(s)
    except ValueError:
        raise MalformedPayload("ESMS: non-numeric value") from None
    if v != v or v in (float("inf"), float("-inf")):
        raise MalformedPayload("ESMS: non-finite value")
    return v


def to_obs(header: list[str], rows: list[list[str]], spec: SeriesSpec) -> list[RawObs]:
    col = column_of(spec)
    if col not in header:
        raise MalformedPayload(f"{spec.symbol}: identity: column not present in ESMS file")
    j = header.index(col)
    out: dict[str, RawObs] = {}
    for r in rows:
        if len(r) != len(header):
            raise MalformedPayload(f"{spec.symbol}: ESMS row width {len(r)} != header {len(header)}")
        m = _DATE.match(r[0].strip())
        if not m:
            raise MalformedPayload(f"{spec.symbol}: ESMS row without a valid surveyDate")
        ps, pe = timeutil.month_bounds(int(m.group(1)), int(m.group(2)))
        o = RawObs(spec.symbol, ps.isoformat(), pe.isoformat(), _value(r[j]), "")
        if ps.isoformat() in out and out[ps.isoformat()].value != o.value:
            raise MalformedPayload(f"{spec.symbol}: ESMS duplicate month with different values")
        out[ps.isoformat()] = o
    return [out[k] for k in sorted(out)]


@register
class NyFedEsmsAdapter(BaseAdapter):
    name = "nyfed_esms"
    key_env = None
    max_series_per_request = 30        # one file carries every index

    def fetch(self, specs, *, mode="latest", start=None, end=None, http=None) -> list[FetchResult]:
        if mode not in ("history", "latest"):
            raise ValueError(f"mode must be history|latest, not {mode!r}")
        if http is None:
            raise ValueError("nyfed_esms.fetch needs an HttpClient")
        groups: dict[str, list[SeriesSpec]] = {}
        for s in as_specs(specs):
            column_of(s)
            groups.setdefault(file_of(s), []).append(s)
        results = []
        for fname, members in groups.items():
            resp = http.get(BASE + fname)
            if resp.status == 403:
                raise SourceUnavailable(f"HTTP 403 for {resp.url_redacted} (edge block; not circumvented)")
            reason = econ_http.soft_failure(resp)
            if reason:
                raise MalformedPayload(f"ESMS: {reason}")
            resp.raise_for_status()
            header, rows = parse_csv(resp.content)
            obs: list[RawObs] = []
            for s in members:
                series = to_obs(header, rows, s)
                if start is not None:
                    series = [o for o in series if o.period_end >= start.isoformat()]
                if end is not None:
                    series = [o for o in series if o.period_start <= end.isoformat()]
                if mode == "latest":
                    series = series[-int(s.params.get("latest_n") or LATEST_N):]
                obs.extend(series)
            cols = ",".join(sorted(column_of(s) for s in members))
            span = "latest" if mode == "latest" else f"{start or ''}..{end or ''}"
            results.append(self.make_result(f"nyfed_esms:{fname}:{cols}:{span}", obs, resp=resp))
        return results
