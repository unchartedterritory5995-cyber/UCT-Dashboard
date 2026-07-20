# Theme Membership Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the fully-autonomous Theme Membership Engine — proactive orphan absorption + weekly self-improvement — per the twice-reviewed spec `docs/superpowers/specs/2026-07-19-theme-membership-engine-design.md`.

**Architecture:** Owner-curated `themes_taxonomy.json` stays the inviolable baseline; the engine writes only to an `engine_memberships` overlay (+ decisions / events / runs / cost tables) in auth.db. The merge lives INSIDE `theme_db`'s three read functions (single SQL UNION, owner precedence) and is the membership authority for Groups AND Theme Tracker. All ranking/aggregate surfaces are engine-invariant (owner rows only). Two scheduled loops (nightly orphans 11 PM ET, weekly improvement Sat 10 AM ET) with decision memory, cost caps, event-journal rollback, and DRY_RUN.

**Tech Stack:** Python/FastAPI/SQLite(WAL)/APScheduler; Anthropic `claude-opus-4-8` (pinned); pytest with ALL network mocked; thin React rider.

## Global Constraints

- Engine may NEVER: modify/delete owner rows, mint `core` tier, delete a theme, write `themes_taxonomy.json`.
- Sym forms: engine-internal canonical = **HYPHEN** (`BRK-B`); `theme_db.to_dot()`/`groups.to_taxonomy_sym()` applied **exactly once at overlay INSERT**; merged reads normalize their input to dot.
- Engine writes are per-row autocommit; a DB transaction never spans an LLM/network call; bounded retry on `sqlite3.OperationalError` (locked).
- LLM model literal: `claude-opus-4-8` (env `THEME_ENGINE_LLM_MODEL` override); prompt budget ≤ 2,500 input tokens/orphan (rosters passed as syms-only); every call cost-logged.
- Env flags + defaults (exact names): `THEME_ENGINE_ENABLED` (0), `THEME_ENGINE_DRY_RUN` (0), `THEME_ENGINE_ORPHAN_BATCH` (200), `THEME_ENGINE_CONFIDENCE_MIN` (0.75), `THEME_ENGINE_CONFIDENCE_LIQUID` (0.85), `THEME_ENGINE_REEVAL_DAYS` (35), `THEME_ENGINE_DAILY_COST_CAP` (5.0), `THEME_ENGINE_MAX_ADDS_PER_THEME_PER_RUN` (10), `THEME_ENGINE_CORR_FLOOR` (0.25).
- Crons: `_ET`-pinned (the `api/main.py` house pattern), `max_instances=1`; orphan loop Mon-Fri 23:00 ET, improvement loop Sat 10:00 ET.
- Tests: pytest, no network — Anthropic/Perplexity/Massive/industry_map refresh all monkeypatched. Frontend: vitest `--pool=threads`.
- Commits: explicit paths only (shared worktree), message prefix `feat(engine):`/`fix(engine):`, Co-Authored-By trailer per house rule.

## File Structure

```
api/services/theme_engine/__init__.py        (empty)
api/services/theme_engine/store.py           T1  schema + write layer + rollback + costs
api/services/theme_engine/orphans.py         T5  Loop 1
api/services/theme_engine/improve.py         T6  Loop 2 + co-movement audit + weekly report text
api/services/theme_engine/comovement.py      T6  60d correlation helper (bars cache only)
api/services/theme_engine/invalidate.py      T4  post-run cache invalidation hook
api/routers/theme_engine.py                  T7  require_admin status/report/rollback
api/services/theme_db.py                     T2  merged reads + reseed GC + content-hash gate
api/services/groups.py                       T3  owner-only sizes + owner-first primary + invalidate_sizes + source in rows
api/services/theme_performance.py            T4  union holdings, id-first lookup, owner-only aggregates
api/services/theme_index.py                  T4  merged resolve
api/services/engine.py                       T4  get_themes('Today') pseudo-ticker skip
api/routers/push.py                          T4  taxonomy_version handshake alert
api/main.py                                  T7  cron registration + startup abort-stale + init
app/src/pages/charts/grid/cellBadge.js + GridChartCell.jsx + ThemeTrackerPage.jsx   T8 provenance dot
tests/theme_engine/{__init__,test_store,test_merged_read,test_groups_invariance,test_propagation,test_orphans,test_improve,test_ops}.py
```

---

### Task 1: Engine store — schema, write layer, events, decisions, runs, costs, rollback

**Files:** Create `api/services/theme_engine/__init__.py` (empty), `api/services/theme_engine/store.py`, `tests/theme_engine/__init__.py` (empty), `tests/theme_engine/test_store.py`.

**Interfaces produced (later tasks rely on these exact signatures):**
`init_engine_tables()`, `start_run(kind:str)->str`, `finish_run(run_id, **counts)`, `abort_stale_runs(max_age_hours=3)->int`, `log_cost(run_id, model, input_tokens:int, output_tokens:int)->float`, `day_cost_usd()->float`, `upsert_add(theme_id, sym_hy, tier, sub_theme_id, confidence, rationale, run_id)->str('added'|'retiered'|'unchanged')`, `drop(theme_id, sym_hy, run_id)->bool`, `suppress_propose(theme_id, sym_hy, rationale, run_id)`, `set_suppress_status(theme_id, sym_hy, status)`, `record_decision(sym_hy, decision, theme_id, confidence, run_id)`, `decided_recent_syms(days:int)->set[str] (hyphen)`, `engine_rows(theme_id=None)->list[dict]`, `rollback_run(run_id)->dict`, `adds_older_than(days:int)->list[dict]`, `bump_audit_low(theme_id, sym_hy)->int`, `reset_audit_low(theme_id, sym_hy)`.

All writes: per-row autocommit via `contextlib.closing(get_connection())`; syms accepted in HYPHEN form and converted with `_dot()` once at write; reads return dot `sym` plus `sym_hy` convenience.

- [ ] **Step 1: failing tests** — `tests/theme_engine/test_store.py`:

```python
import os, tempfile, importlib
import pytest

@pytest.fixture()
def store(monkeypatch, tmp_path):
    # Point auth_db at a scratch DB (house pattern: AUTH_DB_PATH env honored by auth_db)
    monkeypatch.setenv("AUTH_DB_PATH", str(tmp_path / "auth.db"))
    import api.services.auth_db as auth_db
    importlib.reload(auth_db)
    import api.services.theme_engine.store as st
    importlib.reload(st)
    st.init_engine_tables()
    return st

def test_upsert_add_then_retier_preserves_lineage(store):
    r1 = store.start_run("orphan")
    assert store.upsert_add("ai_infrastructure", "MRVL", "peripheral", None, 0.9, "seed", r1) == "added"
    r2 = store.start_run("improve")
    assert store.upsert_add("ai_infrastructure", "MRVL", "relevant", None, 0.92, "up", r2) == "retiered"
    row = store.engine_rows("ai_infrastructure")[0]
    assert row["tier"] == "relevant"
    assert row["created_run_id"] == r1 and row["updated_run_id"] == r2   # lineage immutable

def test_rollback_retier_restores_prior_tier_add_removes_row(store):
    r1 = store.start_run("orphan"); store.upsert_add("t", "AAA", "peripheral", None, .8, "x", r1)
    r2 = store.start_run("improve"); store.upsert_add("t", "AAA", "relevant", None, .9, "y", r2)
    store.rollback_run(r2)
    assert store.engine_rows("t")[0]["tier"] == "peripheral"   # inverse-event replay, not DELETE
    store.rollback_run(r1)
    assert store.engine_rows("t") == []                        # add rolled back -> absent

def test_decision_memory_window(store):
    r = store.start_run("orphan")
    store.record_decision("ZZZQ", "none", None, 0.4, r)
    assert "ZZZQ" in store.decided_recent_syms(35)
    assert "ZZZQ" not in store.decided_recent_syms(0)          # window expired -> re-eligible

def test_cost_log_and_day_total(store):
    r = store.start_run("orphan")
    c = store.log_cost(r, "claude-opus-4-8", 2000, 250)        # $5/M in + $25/M out
    assert abs(c - (2000*5/1e6 + 250*25/1e6)) < 1e-9
    assert store.day_cost_usd() >= c

def test_dot_conversion_single_point(store):
    r = store.start_run("orphan")
    store.upsert_add("financials_broad", "BRK-B", "peripheral", None, .8, "x", r)
    row = store.engine_rows("financials_broad")[0]
    assert row["sym"] == "BRK.B" and row["sym_hy"] == "BRK-B"

def test_abort_stale_runs(store):
    r = store.start_run("orphan")
    with store._conn() as c:
        c.execute("UPDATE engine_runs SET started_at=datetime('now','-4 hours') WHERE run_id=?", (r,))
    assert store.abort_stale_runs(3) == 1

def test_suppress_lifecycle(store):
    r = store.start_run("improve")
    store.suppress_propose("space", "LMT", "off-theme", r)
    assert store.engine_rows("space") == []                    # suppress rows never merge
    store.set_suppress_status("space", "LMT", "dismissed")
    assert store.pending_suppressions() == []                  # dismissed never resurfaces
```

- [ ] **Step 2:** `python -m pytest tests/theme_engine/test_store.py -q` → FAIL (module missing).
- [ ] **Step 3: implement** `api/services/theme_engine/store.py`:

```python
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

def finish_run(run_id: str, **counts):
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
    with _conn() as c:
        row = c.execute("SELECT COALESCE(SUM(cost_usd),0) FROM engine_cost_log WHERE at >= date('now')").fetchone()
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
        rows = c.execute("SELECT sym FROM engine_decisions WHERE decided_at >= datetime('now', ?)",
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
    old_tier; drop->reinsert at old_tier (confidence NULL, rationale marks restore)."""
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
```

- [ ] **Step 4:** tests pass. NOTE: if `auth_db` has no `AUTH_DB_PATH` env override, check how existing tests fixture the DB (`grep -rn "auth.db" tests/conftest.py tests/ | head`) and mirror that pattern in the fixture instead — the store code itself only uses `get_connection()`.
- [ ] **Step 5:** `git add -- api/services/theme_engine/__init__.py api/services/theme_engine/store.py tests/theme_engine/__init__.py tests/theme_engine/test_store.py && git commit -m "feat(engine): overlay store — schema, write layer, events, decisions, runs, costs, rollback"`

---

### Task 2: Merged reads inside theme_db + reseed GC + content-hash gate

**Files:** Modify `api/services/theme_db.py`; Test `tests/theme_engine/test_merged_read.py`.

**Interfaces:** Consumes T1 `engine_memberships` table (reads it with raw SQL — no import of store needed). Produces: `get_all_themes()` / `get_themes_for_ticker(sym)` / `get_theme_holdings(theme_id, tier_filter=None)` rows now each carry `"source": "owner"|"engine"`; behavior otherwise unchanged. `seed_from_json()` gains overlay GC + content-hash fallback gate.

- [ ] **Step 1: failing tests** — `tests/theme_engine/test_merged_read.py` (fixture seeds a scratch auth.db with `init_theme_tables()` + `init_engine_tables()` + inserts):

```python
def _seed_owner(c):
    c.execute("INSERT INTO theme_sectors (id, name) VALUES ('tech','Technology')")
    c.execute("INSERT INTO themes (id, name, sector_id) VALUES ('ai','AI','tech')")
    c.execute("INSERT INTO theme_memberships (theme_id, sym, tier) VALUES ('ai','NVDA','core')")

def test_merge_owner_precedence_and_source_tags(db):
    # engine row for a sym the owner ALSO holds -> owner wins, no duplicate
    db.store.upsert_add("ai", "NVDA", "peripheral", None, .9, "dup", db.run)
    db.store.upsert_add("ai", "SMCI", "peripheral", None, .9, "new", db.run)
    holds = db.theme_db.get_theme_holdings("ai")
    syms = sorted((h["sym"], h["source"]) for h in holds)
    assert syms == [("NVDA", "owner"), ("SMCI", "engine")]

def test_suppress_rows_and_dangling_theme_filtered(db):
    db.store.suppress_propose("ai", "NVDA", "off-theme", db.run)       # never merges
    db.store.upsert_add("ghost_theme", "AAA", "peripheral", None, .9, "x", db.run)
    assert all(h["sym"] != "AAA" for t in db.theme_db.get_all_themes()["themes"] for h in t["holdings"])

def test_get_themes_for_ticker_normalizes_hyphen_input(db):
    db.store.upsert_add("ai", "BRK-B", "peripheral", None, .8, "x", db.run)
    rows = db.theme_db.get_themes_for_ticker("BRK-B")                  # hyphen in
    assert rows and rows[0]["source"] == "engine"

def test_reseed_gc_sweeps_orphaned_and_owner_dup_engine_rows(db, tmp_path):
    db.store.upsert_add("ai", "SMCI", "peripheral", None, .9, "x", db.run)      # will become owner-dup
    db.store.upsert_add("dead_theme", "BBB", "peripheral", None, .9, "x", db.run)
    tax = {"version": "9.9.9", "sectors": [{"id": "tech", "name": "T"}],
           "themes": [{"id": "ai", "name": "AI", "sector_id": "tech",
                       "holdings": [{"sym": "NVDA"}, {"sym": "SMCI"}]}]}   # owner curated SMCI
    p = tmp_path / "tax.json"; p.write_text(__import__("json").dumps(tax), encoding="utf-8")
    db.monkeypatch.setattr(db.theme_db, "_find_taxonomy_file", lambda: str(p))
    assert db.theme_db.seed_from_json() is True
    left = db.store.engine_rows()
    assert left == []                                                  # both swept

def test_content_hash_gate_reseeds_on_unbumped_edit(db, tmp_path):
    import json
    tax = {"version": "1.0.0", "sectors": [{"id": "tech", "name": "T"}],
           "themes": [{"id": "ai", "name": "AI", "sector_id": "tech", "holdings": [{"sym": "NVDA"}]}]}
    p = tmp_path / "tax.json"; p.write_text(json.dumps(tax), encoding="utf-8")
    db.monkeypatch.setattr(db.theme_db, "_find_taxonomy_file", lambda: str(p))
    db.theme_db.seed_from_json()
    tax["themes"][0]["holdings"].append({"sym": "AMD"})               # edit WITHOUT version bump
    p.write_text(json.dumps(tax), encoding="utf-8")
    db.theme_db.seed_from_json()
    syms = {h["sym"] for h in db.theme_db.get_theme_holdings("ai")}
    assert "AMD" in syms                                              # hash gate caught it
```

- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: implement in `theme_db.py`.** (a) Add at module top: `def _to_dot(s): return (s or "").strip().upper().replace("-", ".")`. (b) The merged SELECT used by all three readers (owner precedence + suppression exclusion + dangling filter, ONE statement):

```python
_MERGED_MEMBERSHIP_SQL = """
SELECT tm.theme_id, tm.sym, tm.tier, tm.sub_theme_id, tm.rationale, 'owner' AS source
  FROM theme_memberships tm
UNION ALL
SELECT em.theme_id, em.sym, em.tier, em.sub_theme_id, em.rationale, 'engine' AS source
  FROM engine_memberships em
 WHERE em.action = 'add'
   AND em.theme_id IN (SELECT id FROM themes)
   AND NOT EXISTS (SELECT 1 FROM theme_memberships t2
                   WHERE t2.theme_id = em.theme_id AND t2.sym = em.sym)
"""
```

(c) `get_all_themes()`: replace the memberships query with `conn.execute(_MERGED_MEMBERSHIP_SQL)` (wrapped in `try/except sqlite3.OperationalError` falling back to the owner-only query, so a pre-migration DB still serves). (d) `get_themes_for_ticker(sym)`: `sym = _to_dot(sym)` then the same UNION filtered `WHERE sym = ?` on both branches, JOINed to `themes`/`theme_sectors` exactly as today, `source` in the row. (e) `get_theme_holdings(theme_id, tier_filter)`: same UNION filtered by theme_id (+ tier IN filter applied to the union's rows). (f) `seed_from_json()`: content-hash — after loading `data`, compute `content_hash = hashlib.sha256(json.dumps({"sectors": data.get("sectors", []), "themes": data.get("themes", [])}, sort_keys=True).encode()).hexdigest()`; skip only when BOTH stored version AND stored `theme_seed_content_hash` match; store both prefs at the end. (g) GC inside the same transaction, after reinserting + before committing:

```python
        gc_orphans = conn.execute(
            "DELETE FROM engine_memberships WHERE theme_id NOT IN (SELECT id FROM themes)").rowcount
        gc_dups = conn.execute(
            "DELETE FROM engine_memberships WHERE action='add' AND EXISTS ("
            " SELECT 1 FROM theme_memberships t2 WHERE t2.theme_id = engine_memberships.theme_id"
            " AND t2.sym = engine_memberships.sym)").rowcount
        gc_accepted = conn.execute(
            "DELETE FROM engine_memberships WHERE action='suppress_proposal' AND status='accepted'").rowcount
        _logger.info("[themes] overlay GC: %d orphaned, %d owner-dup, %d accepted-suppress", gc_orphans, gc_dups, gc_accepted)
```

Guard the GC block with `try/except sqlite3.OperationalError` (table may not exist on a fresh DB before `init_engine_tables()` — log and continue). (h) At the end of `seed_from_json` (success path), call `invalidate_caches()` — a new no-arg function in this module that lazily imports and calls `groups.invalidate_sizes()` inside try/except (T3 provides it; the import guard makes T2 mergeable first).
- [ ] **Step 4:** tests pass, plus regression: `python -m pytest tests/theme_curation tests/test_groups.py -q` (existing suites still green — merged reads are additive).
- [ ] **Step 5:** `git add -- api/services/theme_db.py tests/theme_engine/test_merged_read.py && git commit -m "feat(engine): merged owner+engine reads in theme_db, reseed overlay GC, content-hash gate"`

---

### Task 3: groups.py invariance — owner-only sizes, owner-first primary, invalidate hook, source in rows

**Files:** Modify `api/services/groups.py`; Test `tests/theme_engine/test_groups_invariance.py` (+ update `tests/test_groups.py` only if its mocks break).

**Interfaces:** Consumes T2's `source`-tagged rows. Produces: `invalidate_sizes()`; `resolve_peers`/`top_n` rows carry `source` (T8 consumes); primary-theme resolution engine-invariant.

- [ ] **Step 1: failing tests:**

```python
from api.services import groups

def test_theme_sizes_count_owner_rows_only(monkeypatch):
    fake = {"themes": [{"id": "ai", "holdings": [
        {"sym": "NVDA", "source": "owner"}, {"sym": "SMCI", "source": "engine"}]}]}
    monkeypatch.setattr(groups, "_get_all_themes", lambda: fake)
    groups.invalidate_sizes()
    assert groups._theme_sizes() == {"ai": 1}

def test_owner_membership_always_outranks_engine(monkeypatch):
    rows = [
        {"theme_id": "eng_t", "theme_name": "Engine Theme", "tier": "relevant", "sub_theme_id": None, "source": "engine"},
        {"theme_id": "own_t", "theme_name": "Owner Theme", "tier": "peripheral", "sub_theme_id": None, "source": "owner"},
    ]
    monkeypatch.setattr(groups, "_themes_for_ticker", lambda s: rows)
    monkeypatch.setattr(groups, "_theme_size", lambda tid: 10)
    r = groups.resolve_primary_theme("RKLB")
    assert r["theme_id"] == "own_t"        # engine 'relevant' never beats owner 'peripheral'

def test_top_n_rows_carry_source(monkeypatch):
    monkeypatch.setattr(groups, "_theme_holdings",
        lambda tid: [{"sym": "NVDA", "tier": "core", "rationale": "x", "source": "owner"},
                     {"sym": "SMCI", "tier": "peripheral", "rationale": "y", "source": "engine"}])
    import api.services.theme_db as tdb
    monkeypatch.setattr(tdb, "get_theme_holdings", groups._theme_holdings)
    monkeypatch.setattr(groups, "rank_holdings",
        lambda h, by="today", seed=None, seed_sub=None, scores_out=None: ["NVDA", "SMCI"])
    out = groups.top_n("ai", 2)
    assert out["rows"][0]["source"] == "owner" and out["rows"][1]["source"] == "engine"

def test_invalidate_sizes_resets_cache(monkeypatch):
    groups._SIZES_CACHE["map"] = {"stale": 1}; groups._SIZES_CACHE["at"] = 1e18
    groups.invalidate_sizes()
    assert groups._SIZES_CACHE["map"] is None
```

- [ ] **Step 2:** FAIL. **Step 3: implement:** (a) `_theme_sizes()` count line becomes `out[t["id"]] = sum(1 for h in (t.get("holdings") or []) if h.get("source") != "engine")` (absent source = owner → counted, backward compatible). (b) `def invalidate_sizes(): _SIZES_CACHE["map"] = None; _SIZES_CACHE["at"] = 0.0`. (c) `resolve_primary_theme` sort key gains a leading source key: `rows.sort(key=lambda r: (0 if r.get("source", "owner") == "owner" else 1, _TIER_RANK.get(r.get("tier"), 99), _theme_size(r.get("theme_id")), r.get("theme_id") or ""))`. (d) `top_n`'s row dict gains `"source": h.get("source", "owner")` (find the `rows.append({...tier...rationale...gate_score...})` construction); `resolve_peers`'s returned peers stay bare syms, but its taxonomy return adds `"sources": {sym: source}` built from the ranked holdings (T8 uses it for the cell dot).
- [ ] **Step 4:** new tests + `tests/test_groups.py tests/test_groups_gates.py` all pass. **Step 5:** `git add -- api/services/groups.py tests/theme_engine/test_groups_invariance.py tests/test_groups.py && git commit -m "feat(engine): groups engine-invariance — owner-only sizes, owner-first primary, invalidate_sizes, source in rows"`

---

### Task 4: Propagation — theme_performance/theme_index/rotation/voice/push handshake + invalidation hook

**Files:** Modify `api/services/theme_performance.py`, `api/services/theme_index.py`, `api/services/engine.py` (get_themes only), `api/routers/push.py`; Create `api/services/theme_engine/invalidate.py`; Test `tests/theme_engine/test_propagation.py`.

**Interfaces:** Consumes T2 merged reads. Produces `theme_engine.invalidate.post_engine_run()` (T5/T6/T7 call it).

- [ ] **Step 1: failing tests** (all pure-function level, DB/wire mocked):

```python
def test_enrich_lookup_indexes_id_first(monkeypatch):
    import api.services.theme_performance as tp
    monkeypatch.setattr(tp.theme_db, "get_all_themes", lambda: {"themes": [
        {"id": "ai_gpu_chips", "name": "RENAMED IN DB", "etf_ticker": None, "sector_id": "tech",
         "sub_themes": [], "holdings": [{"sym": "NVDA", "tier": "core", "source": "owner"}]}], "sectors": []})
    themes = {"ai_gpu_chips": {"name": "AI / GPU Chips", "holdings": ["NVDA"], "returns": {}}}
    out = tp._enrich_with_taxonomy(themes)
    assert out["ai_gpu_chips"].get("sector_id") == "tech"     # id join hit despite name drift

def test_enrich_appends_engine_members_with_null_return(monkeypatch):
    import api.services.theme_performance as tp
    monkeypatch.setattr(tp.theme_db, "get_all_themes", lambda: {"themes": [
        {"id": "ai", "name": "AI", "etf_ticker": None, "sector_id": "tech", "sub_themes": [],
         "holdings": [{"sym": "NVDA", "tier": "core", "source": "owner"},
                      {"sym": "SMCI", "tier": "peripheral", "source": "engine"}]}], "sectors": []})
    themes = {"ai": {"name": "AI", "holdings": ["NVDA"], "returns": {}}}
    out = tp._enrich_with_taxonomy(themes)
    assert "SMCI" in out["ai"]["holdings"]                    # appended, priced next recompute

def test_group_return_uses_owner_rows_only():
    import api.services.theme_performance as tp
    # helper introduced by this task:
    vals = tp._owner_only_mean({"NVDA": 5.0, "SMCI": -40.0}, owner_syms={"NVDA"})
    assert vals == 5.0

def test_rotation_order_keys_by_wire_ticker(monkeypatch):
    from api.services import groups
    import api.services.theme_performance as tp
    sig = {"rankings": {"ai_gpu_chips": {"name": "WHATEVER", "ticker": "ai_gpu_chips", "1w_rank": 90.0}}}
    monkeypatch.setattr(tp, "compute_rotation_signals", lambda: sig)
    order = groups._rotation_order()
    assert order.get("ai_gpu_chips") == 0                     # keyed by ticker/id, not name

def test_voice_today_skips_pseudo_tickers(monkeypatch):
    import api.services.engine as eng
    captured = {}
    def fake_snap(tickers):
        captured["t"] = list(tickers); return {}
    monkeypatch.setattr(eng, "get_etf_snapshots", fake_snap, raising=False)
    # call the internal helper this task extracts:
    eng._snapshot_real_etfs(["SMH", "ai_gpu_chips", "XLE", "mortgage_reits"])
    assert captured["t"] == ["SMH", "XLE"]

def test_push_handshake_alerts_on_version_mismatch(monkeypatch):
    import api.routers.push as push
    fired = {}
    monkeypatch.setattr(push, "_taxonomy_version_stored", lambda: "4.16.0+aaa")
    monkeypatch.setattr(push.chart_health_alerts, "emit",
                        lambda kind, msg, **kw: fired.setdefault("kind", kind), raising=False)
    push._check_taxonomy_handshake({"taxonomy_version": "4.2.0"})
    assert fired.get("kind") == "taxonomy_version_mismatch"
```

- [ ] **Step 2:** FAIL. **Step 3: implement.**
  - `theme_performance._enrich_with_taxonomy`: build `theme_lookup` with `theme_lookup[t["id"]] = t` FIRST, then existing name/etf entries; after the existing per-theme decoration, append merged members missing from `theme["holdings"]` (keep holdings as the same shape it already uses — if syms-list, append syms; per-holding metadata map gains `source`), and stash `owner_syms` per theme (set of `source!='engine'` syms) on the enriched dict as `_owner_syms` for the aggregate step.
  - Add module helper `def _owner_only_mean(per_sym_returns: dict, owner_syms: set): vals=[v for s,v in per_sym_returns.items() if s in owner_syms and v is not None]; return round(sum(vals)/len(vals), 2) if vals else None` and use it at the `gr[period] = sum(vals)/len(vals)` group-aggregate sites (theme_performance.py:368-376) and the `_apply_live_returns` group aggregate — engine members keep their individual return rows but never move the theme number (spec §4b).
  - `_run_computation`: after `raw_themes = wire.get("themes", {})`, union each theme's wire holdings with the merged DB syms: lazily `from api.services import theme_db` → map theme-id → merged holdings; add DB-only syms to the holdings list handed to the bars/return computation (wrapped in try/except so a cold DB degrades to wire-only).
  - `theme_index.resolve_theme`: before falling back to wire holdings, try `theme_db.get_theme_holdings(theme_id)` and use its syms when non-empty (same try/except degrade).
  - `groups._rotation_order`: key rows by `entry.get("ticker") or nm` (ticker = wire key = etf-or-id) with the lowercased-name entry ALSO kept (two keys per row is fine — `list_groups` looks up `order.get(t.get("etf_ticker") or t["id"])` first, then name).
  - `engine.py`: extract the snapshot-ticker list in `get_themes` through `def _snapshot_real_etfs(keys): return [k for k in keys if not re.fullmatch(r"[a-z0-9_]+", k or "")]` and only snapshot those; curated-only themes get `"Today": None` (renderers already handle missing).
  - `api/routers/push.py`: add `def _taxonomy_version_stored():` (reads `user_preferences('system','theme_seed_version')` via auth_db) and `def _check_taxonomy_handshake(payload):` — if `payload.get("taxonomy_version")` present and != stored → `logger.warning` + `chart_health_alerts.emit("taxonomy_version_mismatch", f"wire taxonomy {wire_v} != dashboard {db_v}")` (import guarded). Call it inside the push handler after the payload is accepted. Also document (comment block) the one-line morning-wire change: `_wire_data["taxonomy_version"] = _TAX_VERSION` — applied to the morning-wire repo in T7's ops step.
  - `api/services/theme_engine/invalidate.py`:

```python
"""Post-engine-run cache invalidation — overlay writes take effect immediately."""
import logging
_logger = logging.getLogger(__name__)

def post_engine_run():
    for mod, fn in (("api.services.groups", "invalidate_sizes"),
                    ("api.services.theme_performance", "invalidate_memory_cache"),
                    ("api.services.theme_index", "invalidate_cache")):
        try:
            m = __import__(mod, fromlist=[fn])
            getattr(m, fn)()
        except Exception as e:
            _logger.debug("invalidate %s.%s skipped: %s", mod, fn, e)
```

  If `theme_performance`/`theme_index` lack an invalidation function, add a minimal `def invalidate_memory_cache(): ...` / `def invalidate_cache(): ...` that clears their module-level memory caches (find them: `grep -n "_CACHE\|_cache" api/services/theme_performance.py api/services/theme_index.py`).
- [ ] **Step 4:** tests pass + `python -m pytest tests/ -q -k "theme or group"` green. **Step 5:** `git add -- api/services/theme_performance.py api/services/theme_index.py api/services/engine.py api/routers/push.py api/services/theme_engine/invalidate.py tests/theme_engine/test_propagation.py && git commit -m "feat(engine): propagation — merged holdings in tracker/index, owner-only aggregates, id-first joins, voice skip, wire handshake, invalidation hook"`

---

### Task 5: Loop 1 — orphan classifier

**Files:** Create `api/services/theme_engine/orphans.py`; Test `tests/theme_engine/test_orphans.py`.

**Interfaces:** Consumes T1 store, T4 invalidate. Produces `run_orphan_batch(batch=None, dry_run=None) -> dict` (T7 schedules it) and `_adjudicate(orphan_ctx) -> dict` (mocked in tests).

- [ ] **Step 1: failing tests:**

```python
import api.services.theme_engine.orphans as orph

def _patch_env(monkeypatch, store):
    monkeypatch.setattr(orph, "store", store)
    monkeypatch.setattr(orph, "_orphan_candidates_ordered", lambda: ["LIQ1", "TAIL1", "GONE1"])
    monkeypatch.setattr(orph, "_theme_roster", lambda tid: {"PNC", "USB", "CFG"})
    monkeypatch.setattr(orph, "_industry_cohort", lambda sym: {"PNC", "USB", "ZION"})
    monkeypatch.setattr(orph, "_is_liquid", lambda sym: sym.startswith("LIQ"))
    monkeypatch.setattr(orph, "_theme_exists", lambda tid: tid == "regional_banks")
    monkeypatch.setattr(orph, "_in_cap", lambda sym: sym != "GONE1")
    monkeypatch.setattr(orph, "_industry_matches_theme", lambda sym, tid: False)

def test_liquid_orphan_needs_085_plus_corroboration(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.80, "rationale": "r"})
    res = orph.run_orphan_batch(batch=1, dry_run=False)
    assert res["added"] == 0 and res["skipped"] == 1          # 0.80 < 0.85 for liquid
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.86, "rationale": "r"})
    store2 = store  # decision memory: LIQ1 already decided below_gate -> excluded
    assert "LIQ1" in store.decided_recent_syms(35)

def test_beat_the_incumbent_requires_cohort_overlap(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_theme_roster", lambda tid: {"AAA", "BBB"})   # 0 cohort overlap
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.95, "rationale": "r"})
    res = orph.run_orphan_batch(batch=1, dry_run=False)
    assert res["added"] == 0                                   # NONE recorded, industry fill kept

def test_dry_run_records_decisions_but_writes_no_rows(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.9, "rationale": "r"})
    res = orph.run_orphan_batch(batch=2, dry_run=True)
    assert store.engine_rows() == [] and res["examined"] == 2

def test_cost_cap_halts_run(monkeypatch, store):
    _patch_env(monkeypatch, store)
    monkeypatch.setattr(orph, "_adjudicate", lambda ctx: {
        "theme_id": "regional_banks", "tier": "peripheral", "confidence": 0.9, "rationale": "r"})
    monkeypatch.setattr(orph.store, "day_cost_usd", lambda: 99.0)
    res = orph.run_orphan_batch(batch=3, dry_run=False)
    assert res["cost_capped"] is True and res["examined"] == 0
```

- [ ] **Step 2:** FAIL. **Step 3: implement `orphans.py`** (helpers are module-level for monkeypatching):

```python
"""Loop 1 — nightly orphan absorption. All helpers module-level + injectable."""
import json
import logging
import os
import re

from api.services.theme_engine import store
from api.services.theme_engine.invalidate import post_engine_run

_logger = logging.getLogger(__name__)
_MODEL = os.environ.get("THEME_ENGINE_LLM_MODEL", "claude-opus-4-8")

def _env_f(name, dflt): 
    try: return float(os.environ.get(name, dflt))
    except ValueError: return dflt

def _in_cap(sym_hy):
    from api.services.groups import cap_universe_set
    return sym_hy in cap_universe_set()

def _theme_exists(theme_id):
    from api.services import theme_db
    return any(t["id"] == theme_id for t in theme_db.get_all_themes().get("themes", []))

def _theme_roster(theme_id):
    from api.services import theme_db
    return {h["sym"].replace(".", "-") for h in theme_db.get_theme_holdings(theme_id)}

def _industry_cohort(sym_hy):
    from api.services import industry_map
    ind = (industry_map.get_industries([sym_hy]) or {}).get(sym_hy)
    if not ind:
        return set()
    return {t.upper().replace(".", "-") for t in industry_map.tickers_in_industry(ind)}

def _industry_matches_theme(sym_hy, theme_id):
    """Finviz-industry corroboration against tools/theme_curation/theme_finviz_industries.json."""
    try:
        from api.services import industry_map
        path = os.path.join(os.path.dirname(__file__), "..", "..", "..",
                            "tools", "theme_curation", "theme_finviz_industries.json")
        with open(os.path.abspath(path), encoding="utf-8") as f:
            tind = json.load(f)
        allowed = tind.get(theme_id) or []
        ind = (industry_map.get_industries([sym_hy]) or {}).get(sym_hy)
        return bool(ind and ind in allowed)
    except Exception:
        return False

def _is_liquid(sym_hy):
    """Swing-gate liquidity floor (px>=5, $vol>=20M). Missing metrics => treat as
    liquid (conservative: applies the HIGHER confidence bar)."""
    try:
        from api.services import groups_gates
        from api.services.groups import _rs_map, _today_map
        m = groups_gates.swing_metrics([sym_hy], _rs_map(), _today_map([sym_hy])).get(sym_hy) or {}
        px, dv = m.get("price"), m.get("dollar_vol")
        if px is None or dv is None:
            return True
        return px >= 5.0 and dv >= 20_000_000
    except Exception:
        return True

def _orphan_candidates_ordered():
    """cap_universe − merged-theme members − recent decisions, liquid/high-RS first."""
    from api.services import theme_db
    from api.services.groups import cap_universe_set, _rs_map
    member_hy = set()
    for t in theme_db.get_all_themes().get("themes", []):
        for h in t.get("holdings", []):
            member_hy.add((h.get("sym") or "").upper().replace(".", "-"))
    reeval = int(_env_f("THEME_ENGINE_REEVAL_DAYS", 35))
    orphans = cap_universe_set() - member_hy - store.decided_recent_syms(reeval)
    rs = _rs_map()
    def key(s):
        r = (rs.get(s) or {}).get("rs_rank")
        try: return -float(r) if r is not None else 1e9
        except (TypeError, ValueError): return 1e9
    return sorted(orphans, key=key)

def _adjudicate(ctx):
    """One grounded Anthropic call. ctx: {sym, industry, rs_rank, candidates:[{id,name,roster_syms}], narrative}.
    Returns {theme_id|None, tier, confidence, rationale}. Cost-logged. Never raises."""
    from api.services.engine import _get_anthropic_client
    cands = "\n".join(f"- {c['id']} ({c['name']}): {', '.join(sorted(c['roster_syms'])[:40])}"
                      for c in ctx["candidates"]) or "(none)"
    prompt = (
        f"You classify one US stock into the single best-fit trading THEME, or NONE.\n"
        f"Stock: {ctx['sym']} | Finviz industry: {ctx.get('industry') or 'unknown'} | RS rank: {ctx.get('rs_rank')}\n"
        f"Candidate themes with current member tickers:\n{cands}\n"
        f"Rules: pick a theme ONLY if the stock's business/market story is material to it and it fits "
        f"alongside the members shown. tier must be 'relevant' or 'peripheral' (peripheral default). "
        f"If nothing fits, theme_id null. Respond with ONLY JSON: "
        f'{{"theme_id": "..."|null, "tier": "relevant"|"peripheral", "confidence": 0.0-1.0, "rationale": "<=140 chars"}}')
    try:
        client = _get_anthropic_client().with_options(timeout=45)
        msg = client.messages.create(model=_MODEL, max_tokens=200,
                                     messages=[{"role": "user", "content": prompt}])
        u = getattr(msg, "usage", None)
        store.log_cost(ctx["run_id"], _MODEL, getattr(u, "input_tokens", 0) or 0,
                       getattr(u, "output_tokens", 0) or 0)
        text = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
        m = re.search(r"\{.*\}", text, re.S)
        return json.loads(m.group(0)) if m else {"theme_id": None, "confidence": 0.0}
    except Exception as e:
        _logger.warning("adjudicate %s failed: %s", ctx["sym"], e)
        return {"theme_id": None, "confidence": 0.0, "rationale": f"error: {e}"}

def _candidates_for(sym_hy):
    """Candidate themes: industry-mapped + themes holding >=2 of the sym's industry cohort."""
    from api.services import theme_db
    cohort = _industry_cohort(sym_hy)
    out = []
    for t in theme_db.get_all_themes().get("themes", []):
        roster = {(h.get("sym") or "").upper().replace(".", "-") for h in t.get("holdings", [])}
        if _industry_matches_theme(sym_hy, t["id"]) or len(roster & cohort) >= 2:
            out.append({"id": t["id"], "name": t["name"], "roster_syms": roster})
    return out[:6]

def run_orphan_batch(batch=None, dry_run=None) -> dict:
    batch = int(batch if batch is not None else _env_f("THEME_ENGINE_ORPHAN_BATCH", 200))
    dry = bool(int(os.environ.get("THEME_ENGINE_DRY_RUN", "0"))) if dry_run is None else bool(dry_run)
    cap = _env_f("THEME_ENGINE_DAILY_COST_CAP", 5.0)
    cmin = _env_f("THEME_ENGINE_CONFIDENCE_MIN", 0.75)
    cliq = _env_f("THEME_ENGINE_CONFIDENCE_LIQUID", 0.85)
    max_per_theme = int(_env_f("THEME_ENGINE_MAX_ADDS_PER_THEME_PER_RUN", 10))
    run_id = store.start_run("orphan_dry" if dry else "orphan")
    counts = {"examined": 0, "added": 0, "skipped": 0}
    cost_capped = False
    theme_adds = {}
    try:
        for sym in _orphan_candidates_ordered()[: batch * 2]:   # headroom for skips
            if counts["examined"] >= batch:
                break
            if store.day_cost_usd() >= cap:
                cost_capped = True
                break
            counts["examined"] += 1
            cands = _candidates_for(sym)
            verdict = _adjudicate({"sym": sym, "run_id": run_id,
                                   "industry": None, "rs_rank": None, "candidates": cands})
            tid = verdict.get("theme_id")
            conf = float(verdict.get("confidence") or 0.0)
            tier = verdict.get("tier") if verdict.get("tier") in ("relevant", "peripheral") else "peripheral"
            liquid = _is_liquid(sym)
            gate = cliq if liquid else cmin
            roster = _theme_roster(tid) if tid else set()
            cohort = _industry_cohort(sym)
            corroborated = bool(tid) and (_industry_matches_theme(sym, tid) or len(roster & cohort) >= 2)
            beats_incumbent = (not cohort) or len(roster & cohort) >= 2 or _industry_matches_theme(sym, tid or "")
            ok = (bool(tid) and _theme_exists(tid) and _in_cap(sym) and conf >= gate
                  and (corroborated if liquid else True) and beats_incumbent
                  and theme_adds.get(tid, 0) < max_per_theme
                  and sym.replace("-", ".") not in {s.replace("-", ".") for s in _theme_roster(tid)})
            if ok and not dry:
                store.upsert_add(tid, sym, tier, None, conf, verdict.get("rationale") or "", run_id)
                store.record_decision(sym, "add", tid, conf, run_id)
                theme_adds[tid] = theme_adds.get(tid, 0) + 1
                counts["added"] += 1
            else:
                store.record_decision(sym, "none" if not tid else "below_gate", tid, conf, run_id)
                counts["skipped"] += 1
    except Exception as e:
        store.finish_run(run_id, error=str(e), **counts)
        raise
    store.finish_run(run_id, cost_usd=store.day_cost_usd(),
                     error="cost_capped" if cost_capped else None, **counts)
    if counts["added"] and not dry:
        post_engine_run()
    return {**counts, "run_id": run_id, "cost_capped": cost_capped, "dry_run": dry}
```

  NOTE for implementer: `finish_run(error=None, ...)` — make `finish_run` ignore None values (`counts = {k: v for k, v in counts.items() if v is not None}`) so the SQL stays valid; adjust T1's `finish_run` accordingly (documented deviation, no re-review needed).
- [ ] **Step 4:** tests pass (the fixture reuses T1's store fixture via `conftest.py` — move the `store` fixture from `test_store.py` into `tests/theme_engine/conftest.py` and import in both). **Step 5:** `git add -- api/services/theme_engine/orphans.py tests/theme_engine/test_orphans.py tests/theme_engine/conftest.py tests/theme_engine/test_store.py && git commit -m "feat(engine): Loop 1 orphan classifier — gates, decision memory, dry-run, cost caps"`

---

### Task 6: Loop 2 — self-improvement + co-movement audit + weekly report

**Files:** Create `api/services/theme_engine/improve.py`, `api/services/theme_engine/comovement.py`; Test `tests/theme_engine/test_improve.py`.

**Interfaces:** Produces `run_improve(dry_run=None)->dict`, `comovement_audit(run_id=None)->dict`, `weekly_report_text()->str` (T7 schedules/posts).

- [ ] **Step 1: failing tests:**

```python
import api.services.theme_engine.improve as imp

def test_pick_themes_heat_ordered(monkeypatch):
    monkeypatch.setattr(imp, "_rotation_heat", lambda: ["uranium_miners", "ai_gpu_chips"])
    monkeypatch.setattr(imp, "_all_theme_ids", lambda: ["cold_a", "uranium_miners", "ai_gpu_chips", "cold_b"])
    assert imp.pick_themes(3) == ["uranium_miners", "ai_gpu_chips", "cold_a"]

def test_owner_row_concern_becomes_suppress_proposal_never_drop(monkeypatch, store):
    monkeypatch.setattr(imp, "store", store)
    r = store.start_run("improve")
    imp._apply_theme_verdict(run_id=r, theme_id="space", verdict={
        "adds": [], "retiers": [], "drops": [],
        "owner_concerns": [{"sym": "LMT", "reason": "off-theme"}]}, dry=False)
    assert store.pending_suppressions()[0]["sym"] == "LMT"
    assert store.engine_rows("space") == []                # nothing applied

def test_comovement_audit_drops_after_two_low_audits(monkeypatch, store):
    monkeypatch.setattr(imp, "store", store)
    r = store.start_run("orphan")
    store.upsert_add("ai", "WEAK", "peripheral", None, .9, "x", r)
    # age the row past 30d:
    with store._conn() as c:
        c.execute("UPDATE engine_memberships SET created_at=datetime('now','-40 days')"); c.commit()
    monkeypatch.setattr(imp, "_corr_vs_theme", lambda sym_hy, tid: 0.05)   # below floor
    a1 = imp.comovement_audit(); assert a1["dropped"] == 0                 # first strike
    a2 = imp.comovement_audit(); assert a2["dropped"] == 1                 # second strike -> drop
    assert store.engine_rows("ai") == []

def test_comovement_none_is_not_a_strike(monkeypatch, store):
    monkeypatch.setattr(imp, "store", store)
    r = store.start_run("orphan")
    store.upsert_add("ai", "COLDBARS", "peripheral", None, .9, "x", r)
    with store._conn() as c:
        c.execute("UPDATE engine_memberships SET created_at=datetime('now','-40 days')"); c.commit()
    monkeypatch.setattr(imp, "_corr_vs_theme", lambda sym_hy, tid: None)   # bars cold -> skip
    assert imp.comovement_audit()["dropped"] == 0
    assert store.engine_rows("ai")[0]["audit_low_count"] == 0
```

- [ ] **Step 2:** FAIL. **Step 3: implement.** `comovement.py`:

```python
"""60-day daily-close correlation vs an equal-weight theme basket. Bars come from
the local bars cache ONLY (api.services.bars_sqlite.get_bars) — never a network
fetch; cold bars => None (callers must treat None as 'no signal', not low)."""
import math

def _closes(sym_hy, n=60):
    try:
        from api.services import bars_sqlite
        rows = bars_sqlite.get_bars(sym_hy, "D") or []
        closes = [r["c"] for r in rows[-(n + 1):] if r.get("c")]
        return closes if len(closes) >= 30 else None
    except Exception:
        return None

def _rets(closes):
    return [closes[i] / closes[i - 1] - 1 for i in range(1, len(closes))]

def corr60(sym_hy, basket_hy):
    a = _closes(sym_hy)
    if not a:
        return None
    baskets = [c for c in (_closes(b) for b in basket_hy if b != sym_hy) if c]
    if len(baskets) < 3:
        return None
    n = min(len(a), *(len(b) for b in baskets))
    ra = _rets(a[-n:])
    rb = [sum(_rets(b[-n:])[i] for b in baskets) / len(baskets) for i in range(n - 1)]
    ma, mb = sum(ra) / len(ra), sum(rb) / len(rb)
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    va = math.sqrt(sum((x - ma) ** 2 for x in ra)); vb = math.sqrt(sum((y - mb) ** 2 for y in rb))
    return cov / (va * vb) if va and vb else None
```

  (If `bars_sqlite.get_bars` has a different name/shape, find it: `grep -n "def get_bars\|def fetch" api/services/bars_sqlite.py` and adapt — cache-read-only is the requirement.) `improve.py`: `_rotation_heat()` (rotating_in ids + top 1w_rank movers from `theme_performance.compute_rotation_signals`, mapped back to theme ids via the ticker key), `_all_theme_ids()`, `pick_themes(n=15)` (heat first, then coldest by last-reviewed — store review stamps in `engine_decisions`-style table or simply order remaining alphabetically for v1), `_review_theme(theme_id, run_id)` (one Anthropic call mirroring T5's `_adjudicate` pattern — roster + RS deltas + corr60 for candidates → JSON `{"adds":[{sym,tier,confidence,rationale}], "retiers":[{sym,new_tier}], "drops":[sym], "owner_concerns":[{sym,reason}]}`; cost-logged), `_apply_theme_verdict(run_id, theme_id, verdict, dry)` — adds go through the SAME gate helper as T5 (extract `orphans._passes_gate(sym, tid, conf)` for reuse or duplicate the checks; retiers/drops apply ONLY to syms present in `store.engine_rows(theme_id)` — owner rows can never match since they're not engine rows; owner_concerns → `store.suppress_propose`), `run_improve(dry_run=None)` (themes = pick_themes(15); per-theme review+apply; cost-cap check between themes; finish_run; `post_engine_run()`), `comovement_audit()` (for `store.adds_older_than(30)`: `corr = _corr_vs_theme(sym_hy, theme_id)` where `_corr_vs_theme` = corr60 vs the theme's OWNER roster; `None` → skip untouched; `< THEME_ENGINE_CORR_FLOOR` → `store.bump_audit_low`, and if the returned count `>= 2` → `store.drop` + counted; else `store.reset_audit_low`), `weekly_report_text()` (pending suppressions + last-7-day run stats + cost totals, plain text; Discord posting itself lives in T7).
- [ ] **Step 4:** tests pass. **Step 5:** `git add -- api/services/theme_engine/improve.py api/services/theme_engine/comovement.py tests/theme_engine/test_improve.py && git commit -m "feat(engine): Loop 2 — heat-ordered improvement, own-row lifecycle, co-movement audit, weekly report"`

---

### Task 7: Scheduler, ops endpoints, startup recovery, morning-wire handshake line

**Files:** Create `api/routers/theme_engine.py`; Modify `api/main.py`; Modify `C:/Users/Patrick/morning-wire/morning_wire_engine.py` (ONE line, separate repo commit); Test `tests/theme_engine/test_ops.py`.

- [ ] **Step 1: failing tests** — router-level with FastAPI TestClient (auth mocked the same way existing admin-router tests do — find the pattern: `grep -rn "require_admin" tests/ | head -3`):

```python
def test_status_endpoint_requires_admin(client_noauth):
    assert client_noauth.get("/api/theme-engine/status").status_code in (401, 403)

def test_rollback_endpoint_replays_and_reports(admin_client, store):
    r = store.start_run("orphan"); store.upsert_add("ai", "SMCI", "peripheral", None, .9, "x", r)
    resp = admin_client.post(f"/api/theme-engine/rollback/{r}")
    assert resp.status_code == 200 and resp.json()["undone"]["add"] == 1
    assert store.engine_rows("ai") == []
```

- [ ] **Step 2:** FAIL. **Step 3: implement.** Router `api/routers/theme_engine.py` (mirror an existing `require_admin` router import-style — `grep -n "require_admin" api/routers/*.py | head -3`): `GET /api/theme-engine/status` (recent `engine_runs` rows + `day_cost_usd` + pending-suppression count + overlay row count), `GET /api/theme-engine/report` (returns `improve.weekly_report_text()`), `POST /api/theme-engine/rollback/{run_id}` (calls `store.rollback_run`, then `invalidate.post_engine_run()`; returns `{"undone": ...}`), `POST /api/theme-engine/suppress/{theme_id}/{sym}/dismiss` (sets status). All `require_admin`. `api/main.py`: (1) lifespan init — `theme_engine.store.init_engine_tables()` + `store.abort_stale_runs(3)` next to `init_theme_tables()`; (2) `include_router(theme_engine.router)`; (3) cron registration guarded by `THEME_ENGINE_ENABLED=1` following the exact `_ET`-pinned house pattern (copy an adjacent `CronTrigger(..., timezone=_ET)` block): orphan job id `theme_engine_orphans` Mon-Fri hour=23 minute=0 → `orphans.run_orphan_batch()`; improve job id `theme_engine_improve` Sat hour=10 → `improve.run_improve()` then `improve.comovement_audit()` then post `improve.weekly_report_text()` to Discord via the existing webhook helper (`grep -n "DISCORD_WEBHOOK_URL" api/ -r | head -3` → reuse that send function, wrapped try/except); `max_instances=1` on both. Morning-wire repo: in `morning_wire_engine.py`, where `_load_taxonomy` result is available, add `_wire_data["taxonomy_version"] = <loaded data>.get("version")` (find the `_wire_data` assembly: `grep -n "_wire_data = {" morning_wire_engine.py`) — commit in that repo: `themes: push taxonomy_version for the dashboard drift handshake`.
- [ ] **Step 4:** tests pass; boot smoke: `python -c "import api.main"` clean. **Step 5:** dashboard: `git add -- api/routers/theme_engine.py api/main.py tests/theme_engine/test_ops.py && git commit -m "feat(engine): scheduler (11PM ET / Sat 10AM), startup recovery, require_admin ops endpoints, weekly Discord report"`; morning-wire: separate commit + push in that repo.

---

### Task 8: Frontend rider — provenance dot

**Files:** Modify `app/src/pages/charts/grid/cellBadge.js` (+ its test), `app/src/pages/charts/grid/MultiChartGrid.jsx` (thread `sources`), `app/src/pages/charts/grid/GridChartCell.jsx` (render dot), `app/src/pages/ThemeTrackerPage.jsx` (holdings chip tint).

- [ ] **Step 1: failing vitest** — extend `cellBadge.test.js`:

```javascript
it('marks engine-sourced cells', () => {
  const badges = buildCellBadges(
    [{ id: 'a', sym: 'SMCI' }],
    { SMCI: { tier: 'peripheral', rationale: 'x', source: 'engine' } },
    {},
  )
  expect(badges[0].engine).toBe(true)
})
```

- [ ] **Step 2:** FAIL. **Step 3:** `cellBadge.js` `buildCellBadges` passes `engine: meta.source === 'engine'` through; `MultiChartGrid.jsx` groupMeta effect already maps `fetchGroupTop` rows → include `source` in `metaBySym[r.sym] = { tier, rationale, source: r.source }`; `GridChartCell.jsx` badge span: after the tier chip, `{badge.engine && <span title="Added by the theme engine" style={{ width: 5, height: 5, borderRadius: '50%', background: 'var(--text-muted, #6b7280)', display: 'inline-block', opacity: 0.7 }} />}`. `ThemeTrackerPage.jsx`: where holding chips render, if the holding object carries `source === 'engine'`, add `opacity: 0.85` + title `"engine-added"` (find the chip render: `grep -n "holdings.map\|holding" app/src/pages/ThemeTrackerPage.jsx | head`). Note: Tracker holdings gain `source` via T4's enrichment append — if the page consumes a plain syms array, the tint applies only where per-holding metadata exists; degrade silently.
- [ ] **Step 4:** `cd app && npm run build && npx vitest run src/pages/charts/grid/ --pool=threads` all green. **Step 5:** `git add -- app/src/pages/charts/grid/cellBadge.js app/src/pages/charts/grid/cellBadge.test.js app/src/pages/charts/grid/MultiChartGrid.jsx app/src/pages/charts/grid/GridChartCell.jsx app/src/pages/ThemeTrackerPage.jsx && git commit -m "feat(engine): provenance dot on engine-sourced grid cells + tracker holdings"`

---

## Self-Review (done at write time)

- **Spec coverage:** §2→T1+T2 · §3→T2 · §4/§4b/§4c→T4+T3+T8 · §5→T3 · §6→T5 · §7→T6 · §8→T1/T5/T7 · §9 (library reuse) → satisfied by the standalone `theme_engine` package with the curation JSON reused in T5's `_industry_matches_theme` · §10 → distributed across all task tests · §11 respected (no theme creation, no taxonomy writes).
- **Known intentional deviations:** Loop 2's Perplexity narrative input is folded into the `_review_theme` prompt as optional context (cost-capped) rather than a separate stage; v1 `pick_themes` cold-fill is alphabetical rather than a persisted last-reviewed stamp (YAGNI — heat ordering is the requirement).
- **Type consistency check:** store API names used in T5/T6/T7 match T1 signatures; `source` key spelled identically across T2/T3/T4/T8.
```
