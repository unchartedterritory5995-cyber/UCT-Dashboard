"""Assemble the user's personalization ticker sets for the Calendar:
watchlists + flagged + J2 open positions + UCT20. Each source is wrapped in
try/except so one failing source never blocks the others. Never raises."""
import logging
import sqlite3
import os

_logger = logging.getLogger(__name__)


def _auth_db_path() -> str:
    return os.path.join(os.environ.get("DATA_DIR", "/data"), "auth.db")


def _watchlist_syms(user_id: str) -> set:
    try:
        conn = sqlite3.connect(_auth_db_path())
        try:
            rows = conn.execute(
                """SELECT wi.sym FROM watchlist_items wi
                   JOIN watchlists w ON w.id = wi.watchlist_id
                   WHERE w.user_id = ?""", (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}
    except Exception as e:
        _logger.info("watchlist syms failed: %s", e)
        return set()


def _flagged_syms(user_id: str) -> set:
    # Flagged is a watchlist with is_flagged_list=1 — already covered by the
    # join above, but expose separately so the UI can slice "Flagged" alone.
    try:
        conn = sqlite3.connect(_auth_db_path())
        try:
            rows = conn.execute(
                """SELECT wi.sym FROM watchlist_items wi
                   JOIN watchlists w ON w.id = wi.watchlist_id
                   WHERE w.user_id = ? AND w.is_flagged_list = 1""", (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}
    except Exception as e:
        _logger.info("flagged syms failed: %s", e)
        return set()


def _position_syms(user_id: str) -> set:
    try:
        from api.services.journal_two import db as j2db  # noqa
        conn = sqlite3.connect(os.path.join(os.environ.get("DATA_DIR", "/data"), "auth.db"))
        try:
            rows = conn.execute(
                "SELECT DISTINCT sym FROM j2_positions WHERE user_id = ? AND status = 'open'",
                (user_id,)).fetchall()
        finally:
            conn.close()
        return {r[0].upper() for r in rows if r and r[0]}
    except Exception as e:
        _logger.info("position syms failed: %s", e)
        return set()


def _uct20_syms(user_id: str) -> set:
    try:
        from api.services.engine import _load_wire_data
        wire = _load_wire_data() or {}
        lead = wire.get("leadership") or wire.get("uct20") or []
        out = set()
        for item in lead:
            sym = item.get("sym") or item.get("ticker") if isinstance(item, dict) else item
            if sym:
                out.add(str(sym).upper())
        return out
    except Exception as e:
        _logger.info("uct20 syms failed: %s", e)
        return set()


def get_user_ticker_sets(user_id: str) -> dict:
    watchlist = _watchlist_syms(user_id)
    flagged = _flagged_syms(user_id)
    positions = _position_syms(user_id)
    uct20 = _uct20_syms(user_id)
    return {
        "watchlist": watchlist,
        "flagged": flagged,
        "positions": positions,
        "uct20": uct20,
        "all_mine": watchlist | flagged | positions | uct20,
    }


def to_payload(sets: dict) -> dict:
    return {k: sorted(v) for k, v in sets.items()}
