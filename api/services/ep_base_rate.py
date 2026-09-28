"""TERM-090 (item 15 ACC-06) -- the episodic-pivot base rate, beside the flag.

How often has the engine's EP flag been followed through? Derived at request
time from the engine's own outcome record, `ep_candidates` x
`ep_follow_throughs`, read out of the installed Brain Pack
(`<brain_dir>/data/uct_intelligence.db`, a full SQLite backup the nightly
`brain_pack_export.py` ships -- so the pod already holds both tables; no new
transport).

⛔ A HIT RATE IS MEANINGLESS WITHOUT ITS BASE RATE, and a small-n percentage is
the same defect with a decimal point. So every answer carries `resolved` (n)
and the `window` those n were flagged in, and below `MIN_RESOLVED` the payload
holds NO percentage at all -- `rate_pct` is None and `thin` is True. The one
thin-sample guard lives here; the UI renders what it is given.

WHAT IS COUNTED -- the engine's definitions, read from
`uct_intelligence/api.py`, not re-invented:
  * setup key `EP` only (the key `update_setup_performance` writes the EP row
    under). `Earnings-Gap`, `Stage2`, `VCP` ... are other flags.
  * resolved = candidate status CLOSED (hold window elapsed) or STOPPED (hit
    -8%). OPEN / WORKING / RUNNER are still being tracked and are reported as
    `unresolved`, never scored -- a flag that has not finished is not a miss.
  * followed through = final `pct_change` > 0 (the engine's own win rule in
    `update_setup_performance`: "pct_change > 0 -> win, <= 0 -> loss").
  * the final row is the LAST follow-through row BY ID -- the selection the
    engine's `get_ep_win_rate` and `get_ep_tracking_context` use. ⛔ NOT
    `ORDER BY check_date DESC`, which is what `update_setup_performance` uses:
    the tracker writes several rows per day, a same-day tie is broken
    arbitrarily, and measured 2026-09-28 on the owner's engine DB that tie
    scores 110 STOPPED EP flags as wins (setup_performance EP/ALL reads
    189/448 = 42.2%; by id the same record reads 76/447 = 17.0%).

This is a historical frequency. It forecasts nothing about the next flag.
"""
from __future__ import annotations

import logging
import os
import sqlite3
from pathlib import Path

log = logging.getLogger(__name__)

#: The engine's setup key for the Episodic Pivot flag.
SETUP_KEY = "EP"
SETUP_LABEL = "Episodic Pivot"

#: Below this many RESOLVED flags no percentage is published. At n=30 a 95%
#: interval on a proportion is still up to +/-18 points wide; below it the
#: figure is closer to noise than to a rate, so the answer is "not enough
#: history" with n shown instead.
MIN_RESOLVED = 30

_RESOLVED = ("CLOSED", "STOPPED")

DEFINITION = (
    "Share of the engine's resolved Episodic Pivot flags (closed after the hold "
    "window, or stopped at -8%) whose final tracked price was above the flag-day "
    "entry. Flags still being tracked are not counted. Historical frequency, not a forecast."
)

_SQL = """
SELECT e.status AS status,
       e.date_flagged AS date_flagged,
       (SELECT ft.pct_change FROM ep_follow_throughs ft
         WHERE ft.ep_id = e.id ORDER BY ft.id DESC LIMIT 1) AS final_pct
  FROM ep_candidates e
 WHERE e.setup_type = ?
"""


def default_db_path() -> str:
    from api.services import brain_sync
    return os.path.join(brain_sync.brain_dir(), "data", "uct_intelligence.db")


def _connect_ro(path: str) -> sqlite3.Connection:
    # mode=ro: this is the engine's store; the dashboard never writes it.
    return sqlite3.connect(Path(path).resolve().as_uri() + "?mode=ro", uri=True)


def compute(db_path: str | None = None) -> dict:
    """Return the EP base rate derived from the store right now. Never raises."""
    path = db_path or default_db_path()
    if not os.path.isfile(path):
        return {"ok": False, "setup": SETUP_KEY, "reason": "brain pack not installed"}
    try:
        conn = _connect_ro(path)
        try:
            rows = conn.execute(_SQL, (SETUP_KEY,)).fetchall()
        finally:
            conn.close()
    except Exception as e:  # noqa: BLE001 -- a missing table is "unavailable", not a 500
        log.warning("ep_base_rate read failed: %s", e)
        return {"ok": False, "setup": SETUP_KEY, "reason": "outcome record unreadable"}

    resolved = [(d, p) for (s, d, p) in rows if s in _RESOLVED and p is not None]
    unresolved = sum(1 for (s, _d, _p) in rows if s not in _RESOLVED)
    n = len(resolved)
    followed = sum(1 for (_d, p) in resolved if p > 0)
    dates = sorted(d for (d, _p) in resolved if d)
    thin = n < MIN_RESOLVED
    return {
        "ok": True,
        "setup": SETUP_KEY,
        "label": SETUP_LABEL,
        "resolved": n,
        "followed_through": followed,
        "unresolved": unresolved,
        "window": {"start": dates[0] if dates else None,
                   "end": dates[-1] if dates else None},
        "min_resolved": MIN_RESOLVED,
        "thin": thin,
        "rate_pct": None if thin else round(followed / n * 100, 1),
        "definition": DEFINITION,
        "source": "ep_candidates + ep_follow_throughs (Brain Pack)",
    }
