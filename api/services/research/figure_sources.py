"""TERM-043 -- figure-to-source link (owner ruling T-13, 2026-10-07: "link only, from the PIT store").

A quarterly statement figure on Research > Financials (FMP, /api/research/financial-history)
may carry a link to the SEC filing it can be read in, taken from the point-in-time
fundamentals store (api/services/fundamentals_pit). The DISPLAYED NUMBER STAYS FMP's: the PIT
store is never a second number source here, only the citation.

A link is attached to one cell only when ALL of these hold, else that cell carries None:
  * the PIT store has a point for the same line (revenue / net income / diluted EPS) whose
    period end is within PERIOD_TOLERANCE_DAYS of FMP's period date;
  * that point's value matches the shown figure within rounding (REL_TOL, or ABS_TOL_EPS
    for a per-share figure);
  * the point was read from exactly ONE filing. A figure the store derived from several
    (Q4 = full year minus nine months) appears in no single filing, so it gets no link.

Quarterly basis only (the store's statement series are quarterly). Never raises; any
failure is "no links", never a guessed one. No SEC request: the published PIT artifact
is read (serving.py), and it carries accessions only when the worker publishes them
(FUNDAMENTALS_PIT_PUBLISH_SOURCES).

DARK behind FIGURE_SOURCE_LINKS_ENABLED (read per call, unset = OFF): unset, the
financial-history payload is exactly what it was.
"""
from __future__ import annotations

import logging
import os
from datetime import date
from typing import Any, Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "FIGURE_SOURCE_LINKS_ENABLED"

#: financial-history line key -> the PIT stored series that states the same figure.
LINE_TO_SERIES = {"revenue": "revenue_q", "net_income": "net_income_q", "eps_diluted": "eps_diluted_q"}
PER_SHARE = {"eps_diluted"}
REL_TOL = 0.005
ABS_TOL_EPS = 0.006
PERIOD_TOLERANCE_DAYS = 7
SOURCE = "SEC EDGAR filing, matched from the point-in-time fundamentals store"


def is_enabled() -> bool:
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


def edgar_url(cik: int | str, accession: str) -> str:
    """The filing index page for one accession (the same form every EDGAR link here uses)."""
    return f"https://www.sec.gov/Archives/edgar/data/{int(cik)}/{accession.replace('-', '')}/{accession}-index.htm"


def _d(s: Any) -> Optional[date]:
    try:
        return date.fromisoformat(str(s)[:10])
    except (TypeError, ValueError):
        return None


def matches(shown: Any, pit: Any, *, per_share: bool) -> bool:
    if not isinstance(shown, (int, float)) or not isinstance(pit, (int, float)):
        return False
    gap = abs(float(shown) - float(pit))
    if per_share and gap <= ABS_TOL_EPS:
        return True
    return gap <= REL_TOL * max(abs(float(shown)), 1e-12)


def links_for(artifact: dict, dates: list, series: dict) -> dict:
    """{line: [url | None per date]} for the lines in LINE_TO_SERIES. Pure."""
    cik = artifact.get("cik")
    metrics = artifact.get("metrics") or {}
    sources = artifact.get("sources") or {}
    out: dict = {}
    if cik is None:
        return out
    for line, sid in LINE_TO_SERIES.items():
        pts, srcs = metrics.get(sid) or [], sources.get(sid) or []
        shown = series.get(line) or []
        if not pts or len(srcs) != len(pts):
            continue                       # no accession list for this series: no claim at all
        cells: list = []
        for i, d in enumerate(dates):
            want = _d(d)
            val = shown[i] if i < len(shown) else None
            url = None
            if want is not None and val is not None:
                # newest observation first: a restated figure links to the filing that restated it
                for j in sorted(range(len(pts)), key=lambda j: pts[j][0], reverse=True):
                    pe = _d(pts[j][2])
                    if pe is None or abs((pe - want).days) > PERIOD_TOLERANCE_DAYS:
                        continue
                    accns = srcs[j]
                    if len(accns) == 1 and matches(val, pts[j][1], per_share=line in PER_SHARE):
                        url = edgar_url(cik, accns[0])
                        break
            cells.append(url)
        if any(cells):
            out[line] = cells
    return out


def attach(payload: dict) -> dict:
    """Return the payload with `source_links` added when the flag is on and links exist.
    The input dict (a cached object) is never mutated. Never raises."""
    if not is_enabled() or not isinstance(payload, dict) or payload.get("period") != "quarter":
        return payload
    try:
        dates = payload.get("dates") or []
        if not dates:
            return payload
        from api.services.fundamentals_pit import serving
        src = serving.current_source()
        cik = src.cik_for(payload.get("sym") or "")
        art = src.artifact_for(cik) if cik is not None else None
        if not art:
            return payload
        links = links_for(art, dates, payload.get("series") or {})
        if not links:
            return payload
        return {**payload, "source_links": links, "source_links_source": SOURCE}
    except Exception as exc:  # noqa: BLE001 -- a citation that cannot be found is no citation
        _logger.warning("[figure_sources] %s: %s", payload.get("sym"), exc)
        return payload
