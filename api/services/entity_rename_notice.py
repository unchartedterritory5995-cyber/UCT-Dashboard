"""D-11 (Entity Master PRD UC-1) -- the "formerly / now trades as" notice on Research.

A member who opens a ticker that has changed hands, or a company that has changed
ticker, is told so in words, from the Entity Master's own dated alias rows:

  * formerly    -- the entity that holds this ticker TODAY also held other tickers
                   before (META: "formerly FB, until 2022-06-09");
  * now trades  -- an entity that held this ticker BEFORE now answers to another
                   one (SQ -> XYZ), or holds no ticker at all (delisted).

⛔ READ-ONLY, LOCAL. The only input is `entity_master.db`'s `entity_aliases` and
`entities` rows, which the D5 rename producer writes only from a vendor-confirmed
ticker change (`entity_master_d5_renames.py`). Nothing here calls a vendor and
nothing here infers a rename: a closed alias on one entity and a new alias on
ANOTHER entity are never joined -- each previous holder is reported as itself.

⛔ "NOTHING TO SAY" IS NOT "COULD NOT LOOK". `state` is `ok` (the store was read;
`formerly`/`previous_holders` may legitimately be empty), `not_in_store` (no
alias row of any date names this ticker) or `store_unavailable` (the store could
not be read; the reason is returned). The client renders a notice only for `ok`
with something in it.

DARK behind ENTITY_RENAME_NOTICE_ENABLED (read per call, unset = OFF).
"""
from __future__ import annotations

import logging
import os
from typing import Optional

_logger = logging.getLogger(__name__)

ENABLED_ENV = "ENTITY_RENAME_NOTICE_ENABLED"
SOURCE = ("UCT Entity Master: dated ticker history; renames are recorded only from "
          "Massive's own ticker-change events, never inferred")


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "0").strip().lower() in ("1", "true", "yes", "on")


def _rows(conn, sql: str, args: tuple) -> list:
    return conn.execute(sql, args).fetchall()


def notice_for(sym: str, *, db_path: Optional[str] = None) -> dict:
    """`{sym, state, current, previous_holders, source, reason?}`. Never raises."""
    s = (sym or "").strip().upper()
    out: dict = {"sym": s, "state": "ok", "current": None, "previous_holders": [], "source": SOURCE}
    try:
        from api.services.entity_master import store
        conn = store._conn(db_path)
        holders = _rows(conn,
                        "SELECT entity_id, valid_from, valid_to FROM entity_aliases "
                        "WHERE alias = ? ORDER BY valid_from ASC", (s,))
        if not holders:
            out["state"] = "not_in_store"
            return out

        def _entity(eid: str) -> dict:
            row = conn.execute("SELECT lifecycle_state, lifecycle_since FROM entities WHERE entity_id = ?",
                               (eid,)).fetchone()
            return {"lifecycle_state": row[0] if row else None, "lifecycle_since": row[1] if row else None}

        def _aliases(eid: str) -> list:
            return [{"alias": a, "valid_from": f, "valid_to": t}
                    for a, f, t in _rows(conn,
                                         "SELECT alias, valid_from, valid_to FROM entity_aliases "
                                         "WHERE entity_id = ? ORDER BY valid_from ASC", (eid,))]

        open_ids = sorted({eid for eid, _f, t in holders if t is None})
        if len(open_ids) > 1:
            # A genuine collision: two entities hold this ticker open at once. Name it; key to no one.
            out["current"] = {"ambiguous": True, "entity_ids": open_ids, "formerly": []}
        elif open_ids:
            eid = open_ids[0]
            formerly = [a for a in _aliases(eid) if a["alias"] != s and a["valid_to"] is not None]
            out["current"] = {"entity_id": eid, "ambiguous": False, "formerly": formerly}

        for eid, valid_from, valid_to in holders:
            if valid_to is None or eid in open_ids:
                continue
            now = [a for a in _aliases(eid) if a["valid_to"] is None]
            out["previous_holders"].append({
                "entity_id": eid,
                "held_from": valid_from,
                "held_to": valid_to,
                "now_trades_as": [{"alias": a["alias"], "valid_from": a["valid_from"]} for a in now],
                **_entity(eid),
            })
        return out
    except Exception as exc:  # noqa: BLE001 -- a notice is an enrichment; it must never break the page
        _logger.warning("entity_rename_notice: store read failed for %s: %s", s, exc)
        return {"sym": s, "state": "store_unavailable", "current": None, "previous_holders": [],
                "source": SOURCE, "reason": f"{type(exc).__name__}: {exc}"[:200]}
