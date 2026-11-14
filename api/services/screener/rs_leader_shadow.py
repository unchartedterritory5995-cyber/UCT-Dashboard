"""The shadow Leader score's storage: computed nightly, kept, shown to nobody.

Plan: ``2026-11-14-uct-rs-screens-plan-v2.md`` section 8 and owner decision D1 ("run
unseen until it passes its test"). Unit U9.

WHY A SIDE TABLE AND NOT ``screener_rows`` COLUMNS
--------------------------------------------------
A scan answers ``SELECT *`` over ``screener_rows`` and returns every column of each
row (``query.build_scan_sql`` / ``query.run_scan``), and ``snapshot_db.get_row`` does
the same for the single-ticker readers. Hiding a key from ``meta()`` therefore hides a
control, not a value: a number stored on the row is in every member's scan response
the night the flag is armed. The receipts are served too (``snapshot_db.status()``
on ``/api/screener/snapshot-status``). So everything this unit stores lives in two
tables of ``screener.db`` that no request path names, and nothing it does is written
into a receipt a member can read:

* :data:`TABLE` (``rs_leader_shadow``): one row per ticker. The build writes the two
  bar inputs (``rs_columns.SHADOW_COLUMNS``) with the row's own ``bars_asof``; the
  rating post-pass fills the score and its four parts.
* :data:`HISTORY_TABLE` (``rs_leader_score_history``): one row per stock on the RS
  liquid floor per rating session, for the comparison a later step makes.

The names are the ones a later unit would give the columns if the owner ever shows
the score (``filters.RS_SHADOW_KEYS``), so that promotion is a copy, not a rename.

DARK BY DEFAULT. ``RS_LEADER_SHADOW_ENABLED`` is read per call (only the literal ``1``
arms it). Off, nothing here opens the database: no table is created, nothing is
computed in the build and the post-pass is the one it was.
"""
from __future__ import annotations

import logging
import os
import time
from contextlib import closing

from . import rs_columns, snapshot_db

log = logging.getLogger(__name__)

FLAG = "RS_LEADER_SHADOW_ENABLED"

TABLE = "rs_leader_shadow"
#: The two bar inputs the build writes (the writer's own tuple, never retyped).
INPUT_COLUMNS = tuple(rs_columns.SHADOW_COLUMNS)

_SQL = f"""
CREATE TABLE IF NOT EXISTS {TABLE} (
    ticker TEXT PRIMARY KEY,
    bars_asof INTEGER,
    rs_steady REAL,
    rs_line_below_high_pct REAL,
    rs_leader_score REAL,
    rs_ls_strength REAL,
    rs_ls_steady REAL,
    rs_ls_high REAL,
    rs_ls_group REAL,
    score_session TEXT,
    built_at REAL
)"""


def enabled() -> bool:
    """``RS_LEADER_SHADOW_ENABLED``, read PER CALL (only the literal ``1`` arms it), so
    a flip needs no restart and a rollback is an unset. Ledger: docs/feature_flags.json.
    The name is spelled out here (not read from :data:`FLAG`) because the ledger's index
    of gates is derived from the literal (``feature_flag_index``)."""
    return os.environ.get("RS_LEADER_SHADOW_ENABLED", "0") == "1"


def _table_exists(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
                        (name,)).fetchone() is not None


def _real(v):
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


# --------------------------------------------------------------------------- #
# the build's half: the two bar inputs
# --------------------------------------------------------------------------- #

def write_inputs(rows: dict, *, now=None) -> int:
    """Store the bar inputs of the tickers one build batch just wrote.

    ``rows`` is ``{TICKER: {"bars_asof": ymd, "rs_steady": x, "rs_line_below_high_pct": y}}``
    (a value the build could not compute is ``None``). INSERT OR REPLACE, like the
    batch's own ``upsert_rows``: a rebuilt ticker's score is NULL until the post-pass at
    the end of that build recomputes it, so no score outlives the inputs it came from.
    Returns the rows written. Raises on a database error (the caller decides)."""
    if not rows:
        return 0
    at = time.time() if now is None else float(now)
    payload = [(str(t).upper(), (v or {}).get("bars_asof"),
                *[_real((v or {}).get(c)) for c in INPUT_COLUMNS], at)
               for t, v in rows.items()]
    sql = (f"INSERT OR REPLACE INTO {TABLE} (ticker, bars_asof, {', '.join(INPUT_COLUMNS)}, "
           f"built_at) VALUES (?, ?, {', '.join('?' for _ in INPUT_COLUMNS)}, ?)")
    with snapshot_db._WRITE_LOCK, closing(snapshot_db.connect()) as conn:
        conn.execute(_SQL)
        conn.executemany(sql, payload)
        conn.commit()
    return len(payload)


def read_inputs(conn) -> dict:
    """``{TICKER: {"bars_asof", "rs_steady", "rs_line_below_high_pct"}}`` as stored, or
    ``{}`` when the table does not exist. Creates nothing."""
    if not _table_exists(conn, TABLE):
        return {}
    cols = ("bars_asof",) + INPUT_COLUMNS
    return {r[0]: dict(zip(cols, r[1:])) for r in conn.execute(
        f"SELECT ticker, {', '.join(cols)} FROM {TABLE}")}
