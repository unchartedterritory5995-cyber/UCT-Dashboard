"""READ ONLY: one stock's estimate history (EEH) as this server already holds it.

The EEH route (`GET /api/research/estimate-history/{sym}`) answers `estimate_history.history(sym)`, which reads the local
snapshot store and, on the way, REGISTERS the stock as tracked (`track(sym, "viewed")`, a write that adds it to the daily
snapshot job). A reader that must never cause work (the UCT Agent's `estimates.history` data kind, MD-1 §4.21) reads
through `held_history()` instead: the route's own answer with registering switched off (`history(sym, register=False)`),
plus two facts the route does not carry, each read from the store with a READ-ONLY connection: whether the stock is in
the tracked population at all (and from where: the S&P 500 seed or a member's view), and the store's newest snapshot day.

It never registers a symbol, never asks the vendor and never creates the store: with no store file on disk it answers
`not_held` before anything is opened. It lives beside the service and not inside it, so the service's own calls are
unchanged. A rail drives the service over an invented store and checks this reader gives the route's own periods, and
that the store's tracked list is the same before and after.
"""
from __future__ import annotations

import os
import sqlite3
from typing import Optional


def _ro(path: str) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{path}?mode=ro", uri=True, timeout=2)


def held_history(sym: str) -> tuple[Optional[dict], str]:
    """READ ONLY: `(answer, how)` for one stock without registering it or asking the vendor. `how` is `held` (the route's
    own answer with `tracked_origin` and `store_newest` added) or `not_held` (no store on this server). Never builds."""
    from api.services import estimate_history as EH
    s = (sym or "").upper().strip()
    path = EH.db_path()
    if not s or not os.path.isfile(path):
        return None, "not_held"
    con = _ro(path)
    try:
        row = con.execute("SELECT origin FROM estimate_tracked WHERE symbol=?", (s,)).fetchone()
        newest = con.execute("SELECT MAX(snap_date) FROM estimate_snapshot").fetchone()
        count = con.execute("SELECT COUNT(*) FROM estimate_tracked").fetchone()
    finally:
        con.close()
    out = EH.history(s, register=False)
    out = dict(out) if isinstance(out, dict) else {}
    out.update({"tracked_origin": row[0] if row else None, "store_newest": newest[0] if newest else None,
                "tracked_count": int(count[0]) if count and count[0] is not None else None, "tracked_cap": EH.MAX_SYMBOLS})
    out.pop("tracked", None)        # the route's `tracked` is True whenever registering is off: replaced by the origin
    return out, "held"
