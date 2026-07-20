"""Theme Membership Engine — overlay store (auth.db). Owner rows live in
theme_memberships (seeded from themes_taxonomy.json) and are NEVER touched
here. Every mutation is per-row autocommit and journaled to
engine_membership_events; rollback replays a run's events inversely."""
import contextlib
import logging
import os
import time
import uuid

from api.services.auth_db import get_connection

_logger = logging.getLogger(__name__)
_PRICES = {"claude-opus-4-8": (5.0, 25.0)}          # $/M input, $/M output
_TIERS = ("relevant", "peripheral")                  # engine may not mint core

def _dot(sym_hy: str) -> str:
    return (sym_hy or "").strip().upper().replace("-", ".")

def _hy(sym_dot: str) -> str:
    return (sym_dot or "").strip().upper().replace(".", "-")

def _conn():
    return contextlib.closing(get_connection())

def _exec_retry(sql, params=(), tries=3):
    """Single-statement autocommit with lock retry. NOTE: returns a cursor whose
    connection is CLOSED — .rowcount is valid (cached), .fetch*() is not."""
    for i in range(tries):
        try:
            with _conn() as c:
                cur = c.execute(sql, params)
                c.commit()
                return cur
        except Exception as e:  # sqlite3.OperationalError: database is locked
            if "locked" in str(e).lower() and i < tries - 1:
                time.sleep(0.25 * (i + 1))
                continue
            raise

def init_engine_tables():
    with _conn() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS engine_memberships (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          theme_id TEXT NOT NULL, sym TEXT NOT NULL,
          tier TEXT, sub_theme_id TEXT, confidence REAL, rationale TEXT,
          action TEXT NOT NULL DEFAULT 'add' CHECK(action IN ('add','suppress_proposal')),
          status TEXT NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','accepted','dismissed')),
          audit_low_count INTEGER NOT NULL DEFAULT 0, last_audit_at TEXT,
          created_at TEXT DEFAULT (datetime('now')), created_run_id TEXT,
          updated_at TEXT, updated_run_id TEXT,
          UNIQUE(theme_id, sym, action));
        CREATE INDEX IF NOT EXISTS idx_em_sym ON engine_memberships(sym);
        CREATE INDEX IF NOT EXISTS idx_em_theme ON engine_memberships(theme_id);
        CREATE TABLE IF NOT EXISTS engine_membership_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
          theme_id TEXT NOT NULL, sym TEXT NOT NULL,
          event TEXT NOT NULL CHECK(event IN ('add','retier','drop','suppress','dismiss')),
          old_tier TEXT, new_tier TEXT, at TEXT DEFAULT (datetime('now')));
        CREATE INDEX IF NOT EXISTS idx_eme_run ON engine_membership_events(run_id);
        CREATE TABLE IF NOT EXISTS engine_decisions (
          sym TEXT PRIMARY KEY,
          decision TEXT NOT NULL CHECK(decision IN ('add','none','below_gate')),
          theme_id TEXT, confidence REAL, run_id TEXT,
          decided_at TEXT DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS engine_runs (
          run_id TEXT PRIMARY KEY, kind TEXT NOT NULL,
          started_at TEXT DEFAULT (datetime('now')), finished_at TEXT,
          examined INTEGER DEFAULT 0, added INTEGER DEFAULT 0, retiered INTEGER DEFAULT 0,
          dropped INTEGER DEFAULT 0, skipped INTEGER DEFAULT 0,
          cost_usd REAL DEFAULT 0, error TEXT);
        CREATE TABLE IF NOT EXISTS engine_cost_log (
          id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT, model TEXT,
          input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
          at TEXT DEFAULT (datetime('now')));
        """)
        c.commit()

def start_run(kind: str) -> str:
    run_id = uuid.uuid4().hex[:12]
    _exec_retry("INSERT INTO engine_runs (run_id, kind) VALUES (?,?)", (run_id, kind))
    return run_id

_FINISH_COLS = {"examined", "added", "retiered", "dropped", "skipped", "cost_usd", "error"}

def finish_run(run_id: str, **counts):
    # Task-5 note (pre-approved deviation): drop None values so a caller passing
    # e.g. dropped=None can never render "dropped=?" with a NULL bind.
    counts = {k: v for k, v in counts.items() if v is not None}
    # Column allowlist (review Important #1): the f-string interpolates KEYS into
    # SQL against auth.db — keys must never be attacker-influencable, so reject
    # anything outside the fixed engine_runs count columns outright.
    bad = set(counts) - _FINISH_COLS
    if bad:
        raise ValueError(f"finish_run: disallowed columns {sorted(bad)}")
    cols = ", ".join(f"{k}=?" for k in counts)
    _exec_retry(f"UPDATE engine_runs SET finished_at=datetime('now'){', ' + cols if cols else ''} WHERE run_id=?",
                (*counts.values(), run_id))

def abort_stale_runs(max_age_hours: int = 3) -> int:
    cur = _exec_retry(
        "UPDATE engine_runs SET finished_at=datetime('now'), error='aborted' "
        "WHERE finished_at IS NULL AND started_at < datetime('now', ?)",
        (f"-{int(max_age_hours)} hours",))
    return cur.rowcount

def log_cost(run_id: str, model: str, input_tokens: int, output_tokens: int) -> float:
    pin, pout = _PRICES.get(model, _PRICES["claude-opus-4-8"])
    cost = input_tokens * pin / 1e6 + output_tokens * pout / 1e6
    _exec_retry("INSERT INTO engine_cost_log (run_id, model, input_tokens, output_tokens, cost_usd) VALUES (?,?,?,?,?)",
                (run_id, model, input_tokens, output_tokens, cost))
    return cost

def day_cost_usd() -> float:
    """Today's engine spend, with 'today' = the ET calendar day (house convention;
    review Important #2 — a UTC boundary would refresh the daily cap mid-evening
    ET, allowing ~2x the intended spend in one trading day). `at` is stored UTC,
    so we pass the UTC instant of ET midnight computed in Python."""
    from datetime import datetime, timezone
    from zoneinfo import ZoneInfo
    et_midnight = datetime.now(ZoneInfo("America/New_York")).replace(
        hour=0, minute=0, second=0, microsecond=0)
    cutoff_utc = et_midnight.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")
    with _conn() as c:
        row = c.execute("SELECT COALESCE(SUM(cost_usd),0) FROM engine_cost_log WHERE at >= ?",
                        (cutoff_utc,)).fetchone()
    return float(row[0] or 0.0)

def _event(run_id, theme_id, sym_dot, event, old_tier=None, new_tier=None):
    _exec_retry("INSERT INTO engine_membership_events (run_id, theme_id, sym, event, old_tier, new_tier) VALUES (?,?,?,?,?,?)",
                (run_id, theme_id, sym_dot, event, old_tier, new_tier))

def upsert_add(theme_id, sym_hy, tier, sub_theme_id, confidence, rationale, run_id) -> str:
    if tier not in _TIERS:
        raise ValueError(f"engine may not mint tier {tier!r}")
    sym = _dot(sym_hy)
    with _conn() as c:
        row = c.execute("SELECT tier FROM engine_memberships WHERE theme_id=? AND sym=? AND action='add'",
                        (theme_id, sym)).fetchone()
    if row is None:
        _exec_retry("INSERT INTO engine_memberships (theme_id, sym, tier, sub_theme_id, confidence, rationale, action, created_run_id) "
                    "VALUES (?,?,?,?,?,?, 'add', ?)",
                    (theme_id, sym, tier, sub_theme_id, confidence, rationale, run_id))
        _event(run_id, theme_id, sym, "add", None, tier)
        return "added"
    old = row["tier"]
    _exec_retry("UPDATE engine_memberships SET tier=?, sub_theme_id=?, confidence=?, rationale=?, "
                "updated_at=datetime('now'), updated_run_id=? WHERE theme_id=? AND sym=? AND action='add'",
                (tier, sub_theme_id, confidence, rationale, run_id, theme_id, sym))
    if old != tier:
        _event(run_id, theme_id, sym, "retier", old, tier)
        return "retiered"
    return "unchanged"

def drop(theme_id, sym_hy, run_id) -> bool:
    sym = _dot(sym_hy)
    with _conn() as c:
        row = c.execute("SELECT tier FROM engine_memberships WHERE theme_id=? AND sym=? AND action='add'",
                        (theme_id, sym)).fetchone()
    if row is None:
        return False
    _exec_retry("DELETE FROM engine_memberships WHERE theme_id=? AND sym=? AND action='add'", (theme_id, sym))
    _event(run_id, theme_id, sym, "drop", row["tier"], None)
    return True

def suppress_propose(theme_id, sym_hy, rationale, run_id):
    sym = _dot(sym_hy)
    _exec_retry("INSERT OR IGNORE INTO engine_memberships (theme_id, sym, rationale, action, created_run_id) "
                "VALUES (?,?,?, 'suppress_proposal', ?)", (theme_id, sym, rationale, run_id))
    _event(run_id, theme_id, sym, "suppress")

def set_suppress_status(theme_id, sym_hy, status):
    _exec_retry("UPDATE engine_memberships SET status=?, updated_at=datetime('now') "
                "WHERE theme_id=? AND sym=? AND action='suppress_proposal'",
                (status, theme_id, _dot(sym_hy)))

def pending_suppressions() -> list:
    with _conn() as c:
        rows = c.execute("SELECT * FROM engine_memberships WHERE action='suppress_proposal' AND status='proposed'").fetchall()
    return [dict(r) for r in rows]

def record_decision(sym_hy, decision, theme_id, confidence, run_id):
    _exec_retry("INSERT OR REPLACE INTO engine_decisions (sym, decision, theme_id, confidence, run_id, decided_at) "
                "VALUES (?,?,?,?,?, datetime('now'))", (_dot(sym_hy), decision, theme_id, confidence, run_id))

def decided_recent_syms(days: int) -> set:
    with _conn() as c:
        # Strict > (not >=): decided_at has second granularity, so a decision
        # recorded this second equals datetime('now','-0 days') — >= would keep
        # it "recent" at days=0, defeating the window-expired re-eligibility.
        rows = c.execute("SELECT sym FROM engine_decisions WHERE decided_at > datetime('now', ?)",
                         (f"-{int(days)} days",)).fetchall()
    return {_hy(r["sym"]) for r in rows}

def engine_rows(theme_id=None) -> list:
    q = "SELECT * FROM engine_memberships WHERE action='add'"
    params = []
    if theme_id:
        q += " AND theme_id=?"
        params.append(theme_id)
    with _conn() as c:
        rows = c.execute(q, params).fetchall()
    out = []
    for r in rows:
        d = dict(r)
        d["sym_hy"] = _hy(d["sym"])
        out.append(d)
    return out

def adds_older_than(days: int) -> list:
    with _conn() as c:
        rows = c.execute("SELECT * FROM engine_memberships WHERE action='add' AND created_at < datetime('now', ?)",
                         (f"-{int(days)} days",)).fetchall()
    return [dict(r) | {"sym_hy": _hy(r["sym"])} for r in rows]

def bump_audit_low(theme_id, sym_hy) -> int:
    _exec_retry("UPDATE engine_memberships SET audit_low_count=audit_low_count+1, last_audit_at=datetime('now') "
                "WHERE theme_id=? AND sym=? AND action='add'", (theme_id, _dot(sym_hy)))
    with _conn() as c:
        row = c.execute("SELECT audit_low_count FROM engine_memberships WHERE theme_id=? AND sym=? AND action='add'",
                        (theme_id, _dot(sym_hy))).fetchone()
    return int(row["audit_low_count"]) if row else 0

def reset_audit_low(theme_id, sym_hy):
    _exec_retry("UPDATE engine_memberships SET audit_low_count=0, last_audit_at=datetime('now') "
                "WHERE theme_id=? AND sym=? AND action='add'", (theme_id, _dot(sym_hy)))

def rollback_run(run_id: str) -> dict:
    """Inverse-replay the run's events, newest first. add->delete; retier->restore
    old_tier; drop->reinsert at old_tier (confidence NULL, rationale marks restore).
    Callers roll back NEWEST run first (an older-run rollback can remove rows a
    newer run re-tiered). suppress events are NOT inverted (spec scope)."""
    with _conn() as c:
        events = c.execute("SELECT * FROM engine_membership_events WHERE run_id=? ORDER BY id DESC", (run_id,)).fetchall()
    undone = {"add": 0, "retier": 0, "drop": 0}
    for ev in events:
        if ev["event"] == "add":
            _exec_retry("DELETE FROM engine_memberships WHERE theme_id=? AND sym=? AND action='add'",
                        (ev["theme_id"], ev["sym"]))
            undone["add"] += 1
        elif ev["event"] == "retier":
            _exec_retry("UPDATE engine_memberships SET tier=?, updated_at=datetime('now') "
                        "WHERE theme_id=? AND sym=? AND action='add'",
                        (ev["old_tier"], ev["theme_id"], ev["sym"]))
            undone["retier"] += 1
        elif ev["event"] == "drop":
            _exec_retry("INSERT OR IGNORE INTO engine_memberships (theme_id, sym, tier, rationale, action, created_run_id) "
                        "VALUES (?,?,?,?, 'add', ?)",
                        (ev["theme_id"], ev["sym"], ev["old_tier"], f"restored by rollback of {run_id}", run_id))
            undone["drop"] += 1
    _exec_retry("UPDATE engine_runs SET error=COALESCE(error,'') || ' rolled_back' WHERE run_id=?", (run_id,))
    return undone
