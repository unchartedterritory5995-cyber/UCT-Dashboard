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
import os
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


def is_enabled() -> bool:
    """The dark flag for every route this module serves. Read PER CALL; unset means OFF
    (the routes answer 404 before identity is read, exactly like an unknown path)."""
    return os.getenv("TERMINAL_GRAMMAR_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


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


# R14: the seen-set is the UNION of every key shown on visits that read cleanly,
# pruned of keys whose own date is older than this. Overwriting it with only
# this visit's keys made a fact that briefly dropped out (a source blip, an
# outage) come back as NEW.
_SEEN_KEEP_DAYS = 120
_DATE_IN_KEY = re.compile(r"\b(\d{4}-\d{2}-\d{2})\b")


def _prune_seen(keys: set, now_ts: float) -> set:
    import datetime as _dt
    floor = (_dt.datetime.fromtimestamp(now_ts, tz=_dt.timezone.utc).date()
             - _dt.timedelta(days=_SEEN_KEEP_DAYS)).isoformat()
    out = set()
    for k in keys:
        m = _DATE_IN_KEY.search(k)
        if m is None or m.group(1) >= floor:
            out.add(k)
    return out


def _live_row(s: str) -> Optional[dict]:
    """The live-price row for `s`: the shared live-price cache first; on a miss, one
    batch read through the same path /api/live-prices uses, written back to that
    cache. None when nothing could be read (the caller degrades, never guesses)."""
    try:
        from api.routers import live_prices as lp
        row = lp.cache.get(lp._px_key(s))
        if row is None:
            from api.services.massive import _get_client, _detect_session
            got = lp._fetch_snapshots(_get_client(), [s], _detect_session()) or {}
            row = got.get(s)
            if row is not None:
                lp.cache.set(lp._px_key(s), row, ttl=lp._CACHE_TTL)
        return row if isinstance(row, dict) else None
    except Exception as exc:  # noqa: BLE001 -- the move fact is optional
        log.warning("[terminal_grammar] live price lookup failed for %s: %s", s, exc)
        return None


def _change_from_row(row: Optional[dict]) -> tuple[Optional[float], Optional[float]]:
    """R18: today's change % and its vendor observation time. A row that replays a
    CLOSED session's move is not "today" and is not used."""
    if not row or row.get("market_closed"):
        return None, None
    pct = row.get("change_pct")
    return (float(pct) if isinstance(pct, (int, float)) else None), row.get("observed_at")


def _live_change(s: str) -> tuple[Optional[float], Optional[float]]:
    """R18: today's change % for `s`, looked up SERVER-SIDE (no client passes
    `change_pct`, so the price-move fact never fired)."""
    return _change_from_row(_live_row(s))


def _quote_block(row: Optional[dict]) -> Optional[dict]:
    """Wave 2 (audit 2026-10-08): "why is it moving" must say HOW MUCH it moved. The
    last price and the day's change from the same live row; `session` says whether
    it is today's live move or the last completed session's (weekend / overnight)."""
    if not row:
        return None

    def num(k):
        v = row.get(k)
        return float(v) if isinstance(v, (int, float)) and v == v else None
    price = num("price")
    if price is None or price <= 0:
        return None
    return {"price": price, "change": num("change"), "change_pct": num("change_pct"),
            "session": "closed" if row.get("market_closed") else "live",
            "observed_at": row.get("observed_at")}


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
    observed = None
    row = _live_row(s)
    if not isinstance(change_pct, (int, float)):
        change_pct, observed = _change_from_row(row)
    try:
        from api.services.watchlist_intelligence import get_intelligence_for_symbols
        changes = {s: change_pct} if isinstance(change_pct, (int, float)) else None
        observed_at = {s: observed} if isinstance(observed, (int, float)) else None
        intel = get_intelligence_for_symbols([s], changes, observed_at).get(s) or intel
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
        # R14: record this visit only when every leg read cleanly. A partial or
        # failed read is not a visit the member could have seen everything on,
        # and recording it would move `last_visit_at` past facts never shown.
        clean = intel.get("status") == "ok" and catalyst_status in ("ok", "not_entitled")
        if clean:
            seen = _prune_seen((seen_before or set()) | set(keys_now), ts)
            conn.execute("INSERT OR REPLACE INTO terminal_visits (user_id, sym, last_visit_at, seen_json) "
                         "VALUES (?,?,?,?)", (user_id, s, ts, json.dumps(sorted(seen))))
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
        "quote": _quote_block(row),
        "intelligence": intel,
        "catalysts": catalysts,
        "catalyst_status": catalyst_status,
        "since_last_visit": since,
        "visit_recorded": clean,
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


# ── wave 3 lane 13 (product #7): "new since your last visit" on news, filings and catalysts ──
#
# MOVE's since-last-visit, generalised to a per-(member, CODE, ticker) seen record. It reuses
# `terminal_visits` (no new table): the row key is "<CODE>:<SYM>", which can never collide with a
# MOVE row (a ticker never contains ':'). The panel sends the keys of the items it SHOWS (each
# carrying the item's own date, so `_prune_seen` ages them out); the answer is which of them are
# new since the previous visit, and when that visit was.
#
# ⛔ THROTTLED (CLAUDE.md "Performance & Scale": the 524 outage was an unthrottled per-request write
# on a hot path). A visit is recorded at most once per SEEN_MIN_INTERVAL per (member, code, sym);
# inside that window the answer is computed from an in-process snapshot of the PRE-visit state
# with no database read or write at all, so a refresh, a remount or a re-poll costs nothing and
# the NEW marks stay put instead of vanishing on the next render.

SEEN_CODES = ("CN", "FEED", "CF", "CATS")
SEEN_MIN_INTERVAL = 60.0          # seconds between recorded visits per (member, code, sym)
MAX_SEEN_KEYS_PER_CALL = 200
MAX_SEEN_KEY_LEN = 160
MAX_SEEN_STORED = 400             # newest keys kept per (member, code, sym)
_SEEN_SNAPSHOT_CAP = 5000         # in-process snapshots before the cache is dropped wholesale
_SEEN_SNAPSHOTS: dict[tuple, tuple] = {}   # (user, code, sym) -> (recorded_at, prev_seen|None, prev_last|None)
_seen_lock = threading.Lock()


def _seen_row_key(code: str, sym: str) -> str:
    return f"{code}:{sym}"


def _cap_seen(keys: set) -> list:
    """Newest MAX_SEEN_STORED keys (by the date each carries; undated last)."""
    def date_of(k):
        m = _DATE_IN_KEY.search(k)
        return m.group(1) if m else ""
    return sorted(sorted(keys), key=date_of, reverse=True)[:MAX_SEEN_STORED]


def seen_since_last_visit(user_id: str, code: str, sym: str, keys: list,
                          now: Optional[float] = None) -> dict[str, Any]:
    c = (code or "").strip().upper()
    if c not in SEEN_CODES:
        raise ValueError("unsupported code")
    s = (sym or "").strip().upper()
    if s and not SYM_RE.match(s):
        raise ValueError("invalid ticker")
    clean = []
    for k in (keys or [])[:MAX_SEEN_KEYS_PER_CALL]:
        if isinstance(k, str) and 0 < len(k) <= MAX_SEEN_KEY_LEN:
            clean.append(k)
    ts = time.time() if now is None else float(now)
    snap_key = (str(user_id), c, s)

    with _seen_lock:
        snap = _SEEN_SNAPSHOTS.get(snap_key)
    if snap is not None and ts - snap[0] < SEEN_MIN_INTERVAL:
        _recorded_at, prev_seen, prev_last = snap
        recorded = False
    else:
        conn = _conn()
        try:
            row = conn.execute("SELECT last_visit_at, seen_json FROM terminal_visits WHERE user_id=? AND sym=?",
                               (str(user_id), _seen_row_key(c, s))).fetchone()
            prev_seen = frozenset(json.loads(row["seen_json"])) if row else None
            prev_last = float(row["last_visit_at"]) if row else None
            merged = _prune_seen(set(prev_seen or ()) | set(clean), ts)
            conn.execute("INSERT OR REPLACE INTO terminal_visits (user_id, sym, last_visit_at, seen_json) "
                         "VALUES (?,?,?,?)", (str(user_id), _seen_row_key(c, s), ts, json.dumps(_cap_seen(merged))))
            conn.commit()
        finally:
            conn.close()
        with _seen_lock:
            if len(_SEEN_SNAPSHOTS) >= _SEEN_SNAPSHOT_CAP:
                _SEEN_SNAPSHOTS.clear()
            _SEEN_SNAPSHOTS[snap_key] = (ts, prev_seen, prev_last)
        recorded = True

    if prev_seen is None:
        return {"code": c, "sym": s, "first_visit": True, "last_visit_at": None, "new": [], "recorded": recorded}
    return {"code": c, "sym": s, "first_visit": False, "last_visit_at": prev_last,
            "new": [k for k in clean if k not in prev_seen], "recorded": recorded}
