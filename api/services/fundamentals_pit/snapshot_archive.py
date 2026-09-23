"""Append-only capture of provider SNAPSHOT metrics that SEC cannot reconstruct.

SEMANTICS (a separate dataset -- never mixed with SEC point-in-time series):
  * a row says "on session DAY, provider P reported VALUE for SYMBOL/METRIC,
    retrieved at T". History begins at the FIRST capture; there is no backfill
    and no prehistory, ever.
  * append-only: PRIMARY KEY (day, symbol, metric, provider) + INSERT OR IGNORE,
    so a re-run the same day is a no-op and nothing is ever overwritten.

RETENTION GATE -- fail closed. A provider value may be RETAINED only if its
(vendor, data_class) is in RETENTION_ALLOWED. Audit 2026-09-22 against
api/services/provider_licensing_class.py (the licensing register's "class in
force"):
    fmp / estimates        class R  "no DDLA assumed" -- and FMP's terms bar
                                    copying/storing content without approval
    fmp / analyst_grades   class R
    fmp / fundamentals     class R
    yfinance (any)         unregistered -> U
    finviz (any)           unregistered -> U
None is cleared for permanent historical retention, so RETENTION_ALLOWED is
EMPTY: the framework runs, reports every candidate as BLOCKED with its reason,
and persists nothing. Enabling a source is a one-line owner/legal decision
recorded here, not an implementation change.
"""
from __future__ import annotations

import time
from dataclasses import dataclass

from . import store as S

CAPTURE_VERSION = 1

# (vendor, data_class) pairs cleared for permanent retention. EMPTY on purpose.
RETENTION_ALLOWED: frozenset[tuple[str, str]] = frozenset()


@dataclass(frozen=True)
class SnapshotMetric:
    id: str
    label: str
    vendor: str
    data_class: str
    screener_column: str | None      # where today's value lives in screener_rows
    note: str = ""


CANDIDATES: tuple[SnapshotMetric, ...] = (
    SnapshotMetric("forward_pe", "Forward P/E", "yfinance", "fundamentals", "pe_fwd",
                   "Screener pe_fwd = yfinance forwardPE via research_ratings."),
    SnapshotMetric("peg", "PEG", "fmp", "fundamentals", "peg", "FMP priceToEarningsGrowthRatioTTM."),
    SnapshotMetric("eps_next_5y", "EPS Growth Next 5Y (est.)", "finviz", "estimates", "eps_next_5y_growth"),
    SnapshotMetric("eps_next_fy", "EPS Growth Next FY (est.)", "fmp", "estimates", "eps_next_y_growth"),
    SnapshotMetric("analyst_target", "Analyst Price Target", "fmp", "estimates", None,
                   "analyst_rows (screener analyst pass)."),
)


def retention_status(m: SnapshotMetric) -> tuple[bool, str]:
    from api.services.provider_licensing_class import entry_for
    e = entry_for(m.vendor, m.data_class)
    if (m.vendor, m.data_class) in RETENTION_ALLOWED:
        return True, f"allowed ({e.licensing_class}, {e.register_row})"
    return False, f"BLOCKED: class {e.licensing_class} ({e.register_row}) -- {e.note}"


def capture(conn, day: str, rows: dict[str, dict[str, float]], retrieved_at: float | None = None) -> dict:
    """rows: {symbol: {screener_column: value}} (today's snapshot). Writes ONLY
    allowed metrics; returns what was written and what was blocked, and why."""
    retrieved_at = time.time() if retrieved_at is None else retrieved_at
    written, blocked = 0, {}
    batch = []
    for m in CANDIDATES:
        ok, why = retention_status(m)
        if not ok:
            blocked[m.id] = why
            continue
        if not m.screener_column:
            continue
        for sym, vals in rows.items():
            v = vals.get(m.screener_column)
            if v is None:
                continue
            batch.append((day, sym.upper(), m.id, m.vendor, float(v), retrieved_at, CAPTURE_VERSION))
    if batch:
        with S.tx(conn):
            before = conn.total_changes
            conn.executemany("INSERT OR IGNORE INTO snapshot_capture VALUES (?,?,?,?,?,?,?)", batch)
            written = conn.total_changes - before
    return {"day": day, "written": written, "blocked": blocked}
