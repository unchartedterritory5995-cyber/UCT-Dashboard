"""UCT Terminal -- the server half of the command grammar (TERMINAL-NEXT lane T3).

Four owner-scoped stores and two composed reads, all for the `/terminal` shell:

  * COMMAND TELEMETRY (V17) -- per member, per command KEY (a function code, an alias
    name, or one of the fixed kinds ASK / ADDR / ROW), a count and a last-used time.
    ⛔ COUNTS ONLY. Never the ticker, never the typed text, never a question: the key is
    validated to a short upper-case token before it is stored, so free text cannot ride
    in. It feeds the member's OWN suggestion ranking and nothing else.
  * MEMBER ALIASES (V6b) -- `NAME -> command`. The client refuses names that are function
    codes (it owns the registry); THIS module refuses names that are real tickers (it owns
    the symbol universe). A refused name is never stored, so an alias can never shadow
    a security.
  * LAST VISIT (V15) -- per member, per security, the facts seen on the last MOVE visit,
    so the next visit can say what is NEW since then.
  * Reads: MOVE ("why is it moving": watchlist-intelligence facts + the catalyst engine's
    recent rows + the since-last-visit diff) and the sector comparison target (V18).

Tables live in auth.db (owner-scoped rows keyed by user id) and are created lazily with
CREATE TABLE IF NOT EXISTS, so nothing here edits the shared `_SCHEMA`.
"""
from __future__ import annotations

import json
import logging
import re
import threading
import time
from typing import Any, Optional

from api.services.auth_db import get_connection

log = logging.getLogger(__name__)

EVENT_KEY_RE = re.compile(r"^[A-Z][A-Z0-9_]{0,15}$")
ALIAS_NAME_RE = re.compile(r"^[A-Z][A-Z0-9_]{1,11}$")
SYM_RE = re.compile(r"^[A-Z][A-Z.\-]{0,6}$")
MAX_KEYS_PER_MEMBER = 300
MAX_ALIASES_PER_MEMBER = 100
MAX_EXPANSION_LEN = 200

_SCHEMA = """
CREATE TABLE IF NOT EXISTS terminal_command_counts (
    user_id   TEXT NOT NULL,
    cmd_key   TEXT NOT NULL,
    n         INTEGER NOT NULL DEFAULT 0,
    last_at   REAL NOT NULL,
    PRIMARY KEY (user_id, cmd_key)
);
CREATE TABLE IF NOT EXISTS terminal_aliases (
    user_id    TEXT NOT NULL,
    name       TEXT NOT NULL,
    expansion  TEXT NOT NULL,
    created_at REAL NOT NULL,
    PRIMARY KEY (user_id, name)
);
CREATE TABLE IF NOT EXISTS terminal_visits (
    user_id        TEXT NOT NULL,
    sym            TEXT NOT NULL,
    last_visit_at  REAL NOT NULL,
    seen_json      TEXT NOT NULL DEFAULT '[]',
    PRIMARY KEY (user_id, sym)
);
"""

_ensured: set[str] = set()     # auth.db paths whose tables exist (keyed by PATH: a test or
_ensure_lock = threading.Lock()  # a re-pointed volume is a different database)


def _conn():
    from api.services import auth_db
    path = str(getattr(auth_db, "_DB_PATH", ""))
    conn = get_connection()
    if path not in _ensured:
        with _ensure_lock:
            if path not in _ensured:
                conn.executescript(_SCHEMA)
                _ensured.add(path)
    return conn


class AliasRefused(ValueError):
    """A name the grammar may not take (409 at the router)."""


# ── telemetry ───────────────────────────────────────────────────────────────────

def record_event(user_id: str, key: str, now: Optional[float] = None) -> bool:
    """Count one command. Returns False (and stores nothing) for an invalid key or when
    the member already has MAX_KEYS_PER_MEMBER distinct keys and this one is new."""
    k = (key or "").strip().upper()
    if not EVENT_KEY_RE.match(k):
        return False
    ts = time.time() if now is None else float(now)
    conn = _conn()
    try:
        row = conn.execute("SELECT n FROM terminal_command_counts WHERE user_id=? AND cmd_key=?",
                           (user_id, k)).fetchone()
        if row is None:
            (count,) = conn.execute("SELECT COUNT(*) FROM terminal_command_counts WHERE user_id=?",
                                    (user_id,)).fetchone()
            if count >= MAX_KEYS_PER_MEMBER:
                return False
            conn.execute("INSERT INTO terminal_command_counts (user_id, cmd_key, n, last_at) VALUES (?,?,1,?)",
                         (user_id, k, ts))
        else:
            conn.execute("UPDATE terminal_command_counts SET n=n+1, last_at=? WHERE user_id=? AND cmd_key=?",
                         (ts, user_id, k))
        conn.commit()
        return True
    finally:
        conn.close()


def command_stats(user_id: str) -> dict[str, dict]:
    conn = _conn()
    try:
        rows = conn.execute("SELECT cmd_key, n, last_at FROM terminal_command_counts WHERE user_id=?",
                            (user_id,)).fetchall()
        return {r["cmd_key"]: {"n": int(r["n"]), "last": float(r["last_at"])} for r in rows}
    finally:
        conn.close()


def reset_stats(user_id: str) -> int:
    conn = _conn()
    try:
        cur = conn.execute("DELETE FROM terminal_command_counts WHERE user_id=?", (user_id,))
        conn.commit()
        return cur.rowcount
    finally:
        conn.close()


# ── aliases ─────────────────────────────────────────────────────────────────────

def _is_known_ticker(name: str) -> bool:
    """Exact membership in the symbol universe `/api/ticker-search` ranks over."""
    try:
        from api.routers.ticker_search import _UNIVERSE
        return name in set(_UNIVERSE)
    except Exception:  # noqa: BLE001 -- a universe that cannot load refuses nothing extra
        log.warning("[terminal_grammar] ticker universe unavailable; ticker-collision check skipped")
        return False


def list_aliases(user_id: str) -> dict[str, str]:
    conn = _conn()
    try:
        rows = conn.execute("SELECT name, expansion FROM terminal_aliases WHERE user_id=? ORDER BY name",
                            (user_id,)).fetchall()
        return {r["name"]: r["expansion"] for r in rows}
    finally:
        conn.close()


def set_alias(user_id: str, name: str, expansion: str) -> dict[str, str]:
    n = (name or "").strip().upper()
    e = " ".join((expansion or "").split())
    if not ALIAS_NAME_RE.match(n):
        raise AliasRefused(f"'{name}' is not a valid alias name")
    if not e or len(e) > MAX_EXPANSION_LEN:
        raise AliasRefused("an alias needs a command of at most 200 characters")
    if _is_known_ticker(n):
        raise AliasRefused(f"{n} is a real ticker; an alias may not shadow a security")
    conn = _conn()
    try:
        exists = conn.execute("SELECT 1 FROM terminal_aliases WHERE user_id=? AND name=?", (user_id, n)).fetchone()
        if not exists:
            (count,) = conn.execute("SELECT COUNT(*) FROM terminal_aliases WHERE user_id=?", (user_id,)).fetchone()
            if count >= MAX_ALIASES_PER_MEMBER:
                raise AliasRefused(f"at most {MAX_ALIASES_PER_MEMBER} aliases")
        conn.execute("INSERT OR REPLACE INTO terminal_aliases (user_id, name, expansion, created_at) VALUES (?,?,?,?)",
                     (user_id, n, e, time.time()))
        conn.commit()
    finally:
        conn.close()
    return {"name": n, "expansion": e}


def delete_alias(user_id: str, name: str) -> bool:
    conn = _conn()
    try:
        cur = conn.execute("DELETE FROM terminal_aliases WHERE user_id=? AND name=?",
                           (user_id, (name or "").strip().upper()))
        conn.commit()
        return cur.rowcount > 0
    finally:
        conn.close()


# ── MOVE / WIIM + since last visit ─────────────────────────────────────────────

def _fact_key(f: dict) -> str:
    return f"{f.get('kind')}|{f.get('label')}|{f.get('as_of')}"


def _catalyst_key(c: dict) -> str:
    return f"cat|{c.get('market_date')}|{c.get('tag')}"


def why_moving(user_id: str, sym: str, *, include_catalysts: bool,
               change_pct: Optional[float] = None, now: Optional[float] = None) -> dict[str, Any]:
    """Compose the existing services for one security, diff against the member's last
    visit, then record THIS visit. Each leg reports its own status: an outage is never
    read as "nothing happened"."""
    s = (sym or "").strip().upper()
    if not SYM_RE.match(s):
        raise ValueError("invalid ticker")
    ts = time.time() if now is None else float(now)

    intel: dict = {"status": "unavailable", "notable": False, "facts": [], "context": {}}
    try:
        from api.services.watchlist_intelligence import get_intelligence_for_symbols
        changes = {s: change_pct} if isinstance(change_pct, (int, float)) else None
        intel = get_intelligence_for_symbols([s], changes).get(s) or intel
    except Exception as exc:  # noqa: BLE001
        log.warning("[terminal_grammar] intelligence failed for %s: %s", s, exc)

    catalysts: list[dict] = []
    catalyst_status = "not_entitled"
    if include_catalysts:
        try:
            from api.services.catalyst import store
            rows = store.history_for_ticker(s, limit=5)
            catalysts = [{"market_date": r.get("market_date"), "tag": r.get("tag"), "rank": r.get("rank"),
                          "thesis_text": r.get("thesis_text"), "gap_pct": r.get("gap_pct")} for r in rows]
            catalyst_status = "ok"
        except Exception as exc:  # noqa: BLE001
            log.warning("[terminal_grammar] catalyst history failed for %s: %s", s, exc)
            catalyst_status = "unavailable"

    keys_now = [_fact_key(f) for f in intel.get("facts") or []] + [_catalyst_key(c) for c in catalysts]

    conn = _conn()
    try:
        prev = conn.execute("SELECT last_visit_at, seen_json FROM terminal_visits WHERE user_id=? AND sym=?",
                            (user_id, s)).fetchone()
        seen_before = set(json.loads(prev["seen_json"])) if prev else None
        conn.execute("INSERT OR REPLACE INTO terminal_visits (user_id, sym, last_visit_at, seen_json) VALUES (?,?,?,?)",
                     (user_id, s, ts, json.dumps(sorted(set(keys_now)))))
        conn.commit()
    finally:
        conn.close()

    if seen_before is None:
        since = {"first_visit": True, "last_visit_at": None, "new": []}
    else:
        since = {"first_visit": False, "last_visit_at": float(prev["last_visit_at"]),
                 "new": [k for k in keys_now if k not in seen_before]}
    return {
        "sym": s,
        "intelligence": intel,
        "catalysts": catalysts,
        "catalyst_status": catalyst_status,
        "since_last_visit": since,
    }


# ── V18: the sector comparison target ──────────────────────────────────────────

#: yfinance's sector spellings -> the GICS names `sector_strength.SECTOR_ETFS` is keyed by.
_SECTOR_ALIASES = {
    "Financial Services": "Financials",
    "Consumer Cyclical": "Consumer Discretionary",
    "Consumer Defensive": "Consumer Staples",
    "Basic Materials": "Materials",
    "Health Care": "Healthcare",
    "Information Technology": "Technology",
}


def sector_etf_for(sector: Optional[str]) -> Optional[str]:
    from api.services.sector_strength import SECTOR_ETFS
    if not sector:
        return None
    name = _SECTOR_ALIASES.get(sector, sector)
    return SECTOR_ETFS.get(name)


def compare_target(sym: str) -> dict[str, Any]:
    s = (sym or "").strip().upper()
    if not SYM_RE.match(s):
        raise ValueError("invalid ticker")
    sector = None
    try:
        from api.services.fundamentals import get_fundamentals
        fund = get_fundamentals(s) or {}
        sector = fund.get("sector") if isinstance(fund, dict) else None
    except Exception as exc:  # noqa: BLE001
        log.warning("[terminal_grammar] fundamentals failed for %s: %s", s, exc)
    etf = sector_etf_for(sector)
    return {"sym": s, "mode": "sector", "sector": sector, "comparator": etf}
