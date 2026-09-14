"""D12 family: Morning Wire inputs that are reachable from web.

The wire payload itself is the ``wire`` dataset. This adds the inputs the wire is
BUILT from that web can read without the PC:

* Brain Pack ``leadership_snapshots`` (the latest snapshot on or before the wire
  date) and ``market_regimes`` (the five latest on or before it), read-only from
  the installed pack (``brain_sync.brain_dir()``). Present only when
  BRAIN_PACK_ENABLED installed a pack; roughly one weekday behind;
* the ``intraday_update`` cache the autonomous brain pushes (4 h TTL).

The PC-only inputs are named gaps on every run, so their absence is a recorded
fact rather than a silent hole.
"""
from __future__ import annotations

import os

from api.services.wisdom.capture.families import wire as wire_family
from api.services.wisdom.capture.families._base import (
    result, ro_connect, safe_reader, session_of, table_columns, to_date,
)

FAMILY = "wire_inputs"
SOURCE = "brain pack leadership_snapshots + market_regimes; cache intraday_update"
PC_ONLY = {
    "candidates_json": "uct-intelligence data/candidates.json lives on the PC; web sees it as wire.candidates",
    "leading_sectors_json": "uct-intelligence leading_sectors.json is PC-only (operator-edited)",
    "morning_wire_state_json": "morning-wire morning_wire_state.json is PC-only (distribution days, phase, "
                               "FTD/rally state, sentiment caches); web sees wire.breadth",
    "wire_journal_and_ledgers": "morning-wire data/{wire_journal,board_history,open_book,title_history,"
                                "flow_ledger} are PC-only",
}


def _brain_rows(day, gaps: dict) -> dict | None:
    from api.services import brain_sync

    path = os.path.join(brain_sync.brain_dir(), "data", "uct_intelligence.db")
    if not os.path.exists(path):
        gaps["brain_pack"] = f"no installed Brain Pack database at {path} (BRAIN_PACK_ENABLED off or not yet pulled)"
        return None
    conn = ro_connect(path)
    try:
        out: dict = {}
        if table_columns(conn, "leadership_snapshots"):
            out["leadership_snapshots"] = [dict(r) for r in conn.execute(
                "SELECT * FROM leadership_snapshots WHERE snapshot_date = (SELECT MAX(snapshot_date) "
                "FROM leadership_snapshots WHERE snapshot_date <= ?) ORDER BY rank, symbol",
                (day.isoformat(),))]
        else:
            gaps["leadership_snapshots"] = "table absent from the installed pack"
        if table_columns(conn, "market_regimes"):
            out["market_regimes"] = [dict(r) for r in conn.execute(
                "SELECT * FROM market_regimes WHERE regime_date <= ? ORDER BY regime_date DESC LIMIT 5",
                (day.isoformat(),))]
        else:
            gaps["market_regimes"] = "table absent from the installed pack"
        return out
    finally:
        conn.close()


@safe_reader(FAMILY, SOURCE)
def read(*, as_of=None, now_et, state=None, **_) -> dict:
    from api.services.cache import cache

    wire = wire_family.load_wire()
    day = to_date(as_of) or to_date((wire or {}).get("date")) or session_of(now_et)
    gaps: dict = dict(PC_ONLY)
    payload: dict = {}
    try:
        brain = _brain_rows(day, gaps)
    except Exception as exc:  # noqa: BLE001
        brain = None
        gaps["brain_pack"] = f"{type(exc).__name__}: {exc}"[:300]
    if brain is not None:
        payload.update(brain)
    intraday = cache.get("intraday_update")
    if intraday:
        payload["intraday_update"] = intraday
    else:
        gaps["intraday_update"] = "cache 'intraday_update' is empty (4 h TTL from the autonomous brain push)"
    if not payload:
        return result(FAMILY, as_of=day, source=SOURCE, rows=None, payload=None, gaps=gaps)
    rows = (len(payload.get("leadership_snapshots") or []) + len(payload.get("market_regimes") or [])
            + (1 if "intraday_update" in payload else 0))
    return result(FAMILY, as_of=day, source=SOURCE, rows=rows, payload=payload, gaps=gaps)
