# Trade Journal Implementation Plan — Phases 1-3

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the core trade journal — schema, enhanced CRUD, trade log with filtering, trade detail drawer with chart markers, execution tracking, process scoring, mistake/emotion tagging, screenshot uploads, and review status.

**Architecture:** Extend existing SQLite auth.db with new columns + tables. Replace current Journal.jsx (single-file page) with a multi-tab JournalPage shell. Trade detail opens in a right-side drawer with embedded StockChart. Backend services handle P&L computation, VWAP from executions, review status auto-computation, and screenshot storage.

**Tech Stack:** React 19, Vite, CSS Modules, FastAPI, SQLite, Pillow (WebP screenshots), Lightweight Charts v5, SWR

**Spec:** `docs/plans/2026-03-28-trade-journal-design.md`

---

## File Structure

### Backend (Python — `api/`)

```
api/services/
  journal_service.py          — MODIFY: expand CRUD, add filtering, stats, review status, VWAP
  journal_screenshots.py      — CREATE: screenshot upload/serve/delete
  journal_executions.py       — CREATE: trade execution CRUD, VWAP computation
  journal_taxonomy.py         — CREATE: mistake + emotion constants, taxonomy endpoint
  auth_db.py                  — MODIFY: add new tables + migration columns

api/routers/
  journal.py                  — MODIFY: expand endpoints (filtering, screenshots, executions, taxonomy, review queue, calendar)
```

### Frontend (React — `app/src/`)

```
app/src/pages/
  Journal.jsx                 — DELETE (replaced by journal/ directory)
  Journal.module.css          — DELETE (replaced)
  journal/
    JournalPage.jsx           — CREATE: shell with horizontal tab bar
    JournalPage.module.css    — CREATE: shell + shared journal styles
    tabs/
      TradeLog.jsx            — CREATE: filterable trade table
      TradeLog.module.css     — CREATE: trade log styles
    components/
      TradeDrawer.jsx         — CREATE: right-side detail drawer (6 tabs)
      TradeDrawer.module.css  — CREATE: drawer styles
      TradeForm.jsx           — CREATE: new/edit trade form (enhanced fields)
      TradeForm.module.css    — CREATE: form styles
      FilterBar.jsx           — CREATE: collapsible filter controls
      FilterBar.module.css    — CREATE: filter styles
      ProcessScoreCard.jsx    — CREATE: 5-dimension scoring widget
      MistakeSelector.jsx     — CREATE: multi-select mistake tags
      EmotionSelector.jsx     — CREATE: multi-select emotion tags
      ExecutionsList.jsx      — CREATE: scale-in/out event list + add form
      ScreenshotUploader.jsx  — CREATE: upload + slot management
      ReviewProgress.jsx      — CREATE: completion indicator dots
      StatCard.jsx            — CREATE: reusable KPI card
```

---

## Task 1: Database Schema Migration

**Files:**
- Modify: `api/services/auth_db.py` (lines 43-63 for existing table, add after line 91)

- [ ] **Step 1: Add new columns to journal_entries via migration**

In `auth_db.py`, add a migration function after `init_db()`. The existing pattern uses `ALTER TABLE ... ADD COLUMN` with try/except for idempotency (see lines 200+ for `full_name`, `email_verified` examples).

Add this function and call it from `init_db()`:

```python
def _migrate_journal_v2(conn):
    """Add Trade Journal v2 columns and tables."""
    new_cols = [
        ("journal_entries", "account", "TEXT DEFAULT 'default'"),
        ("journal_entries", "asset_class", "TEXT DEFAULT 'equity'"),
        ("journal_entries", "strategy", "TEXT DEFAULT ''"),
        ("journal_entries", "playbook_id", "TEXT"),
        ("journal_entries", "tags", "TEXT DEFAULT ''"),
        ("journal_entries", "mistake_tags", "TEXT DEFAULT ''"),
        ("journal_entries", "emotion_tags", "TEXT DEFAULT ''"),
        ("journal_entries", "entry_time", "TEXT"),
        ("journal_entries", "exit_time", "TEXT"),
        ("journal_entries", "fees", "REAL DEFAULT 0"),
        ("journal_entries", "shares", "REAL"),
        ("journal_entries", "risk_dollars", "REAL"),
        ("journal_entries", "planned_r", "REAL"),
        ("journal_entries", "realized_r", "REAL"),
        ("journal_entries", "thesis", "TEXT DEFAULT ''"),
        ("journal_entries", "market_context", "TEXT DEFAULT ''"),
        ("journal_entries", "confidence", "INTEGER"),
        ("journal_entries", "process_score", "INTEGER"),
        ("journal_entries", "outcome_score", "INTEGER"),
        ("journal_entries", "ps_setup", "INTEGER"),
        ("journal_entries", "ps_entry", "INTEGER"),
        ("journal_entries", "ps_exit", "INTEGER"),
        ("journal_entries", "ps_sizing", "INTEGER"),
        ("journal_entries", "ps_stop", "INTEGER"),
        ("journal_entries", "lesson", "TEXT DEFAULT ''"),
        ("journal_entries", "follow_up", "TEXT DEFAULT ''"),
        ("journal_entries", "review_status", "TEXT DEFAULT 'draft'"),
        ("journal_entries", "review_date", "TEXT"),
        ("journal_entries", "session", "TEXT DEFAULT ''"),
        ("journal_entries", "day_of_week", "TEXT"),
        ("journal_entries", "holding_minutes", "INTEGER"),
    ]
    for table, col, typedef in new_cols:
        try:
            conn.execute(f"ALTER TABLE {table} ADD COLUMN {col} {typedef}")
        except Exception:
            pass  # column already exists
```

- [ ] **Step 2: Add new tables in the same migration function**

Append to `_migrate_journal_v2`:

```python
    # Trade executions (scale-in/out)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS trade_executions (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id),
            trade_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            exec_type   TEXT NOT NULL,
            exec_date   TEXT NOT NULL,
            exec_time   TEXT,
            price       REAL NOT NULL,
            shares      REAL NOT NULL,
            fees        REAL DEFAULT 0,
            notes       TEXT DEFAULT '',
            sort_order  INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_executions_trade ON trade_executions(trade_id)")

    # Screenshots
    conn.execute("""
        CREATE TABLE IF NOT EXISTS journal_screenshots (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id),
            trade_id    TEXT NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
            slot        TEXT NOT NULL,
            filename    TEXT NOT NULL,
            label       TEXT DEFAULT '',
            sort_order  INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_screenshots_trade ON journal_screenshots(trade_id)")

    # Daily journals
    conn.execute("""
        CREATE TABLE IF NOT EXISTS daily_journals (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id),
            date            TEXT NOT NULL,
            premarket_thesis TEXT DEFAULT '',
            focus_list      TEXT DEFAULT '',
            a_plus_setups   TEXT DEFAULT '',
            risk_plan       TEXT DEFAULT '',
            market_regime   TEXT DEFAULT '',
            emotional_state TEXT DEFAULT '',
            midday_notes    TEXT DEFAULT '',
            eod_recap       TEXT DEFAULT '',
            did_well        TEXT DEFAULT '',
            did_poorly      TEXT DEFAULT '',
            learned         TEXT DEFAULT '',
            tomorrow_focus  TEXT DEFAULT '',
            energy_rating   INTEGER,
            discipline_score INTEGER,
            review_complete INTEGER DEFAULT 0,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, date)
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_daily_journals_user_date ON daily_journals(user_id, date)")

    # Weekly reviews
    conn.execute("""
        CREATE TABLE IF NOT EXISTS weekly_reviews (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id),
            week_start      TEXT NOT NULL,
            best_trade_id   TEXT,
            worst_trade_id  TEXT,
            top_setup       TEXT DEFAULT '',
            worst_mistake   TEXT DEFAULT '',
            wins            INTEGER DEFAULT 0,
            losses          INTEGER DEFAULT 0,
            net_pnl_pct     REAL,
            avg_process_score REAL,
            reflection      TEXT DEFAULT '',
            key_lessons     TEXT DEFAULT '',
            next_week_focus TEXT DEFAULT '',
            rules_to_add    TEXT DEFAULT '',
            review_complete INTEGER DEFAULT 0,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(user_id, week_start)
        )
    """)

    # Playbooks
    conn.execute("""
        CREATE TABLE IF NOT EXISTS playbooks (
            id              TEXT PRIMARY KEY,
            user_id         TEXT NOT NULL REFERENCES users(id),
            name            TEXT NOT NULL,
            description     TEXT DEFAULT '',
            market_condition TEXT DEFAULT '',
            trigger_criteria TEXT DEFAULT '',
            invalidations   TEXT DEFAULT '',
            entry_model     TEXT DEFAULT '',
            exit_model      TEXT DEFAULT '',
            sizing_rules    TEXT DEFAULT '',
            common_mistakes TEXT DEFAULT '',
            best_practices  TEXT DEFAULT '',
            ideal_time      TEXT DEFAULT '',
            ideal_volatility TEXT DEFAULT '',
            is_active       INTEGER DEFAULT 1,
            trade_count     INTEGER DEFAULT 0,
            win_rate        REAL,
            avg_r           REAL,
            created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_playbooks_user ON playbooks(user_id)")

    # Resources
    conn.execute("""
        CREATE TABLE IF NOT EXISTS journal_resources (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL REFERENCES users(id),
            category    TEXT NOT NULL,
            title       TEXT NOT NULL,
            content     TEXT DEFAULT '',
            sort_order  INTEGER DEFAULT 0,
            is_pinned   INTEGER DEFAULT 0,
            created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_resources_user ON journal_resources(user_id)")

    conn.commit()
```

- [ ] **Step 3: Wire migration into init_db()**

In `init_db()` (around line 197), after existing migrations, add:

```python
    _migrate_journal_v2(conn)
```

- [ ] **Step 4: Test migration locally**

Run: `cd /c/Users/Patrick/uct-dashboard && python -c "from api.services.auth_db import init_db; init_db(); print('OK')"`

Expected: `OK` with no errors. Run twice to verify idempotency.

- [ ] **Step 5: Commit**

```bash
git add api/services/auth_db.py
git commit -m "feat(journal): add v2 schema — 25 new columns, 6 new tables for elite trade journal"
```

---

## Task 2: Journal Taxonomy Constants

**Files:**
- Create: `api/services/journal_taxonomy.py`

- [ ] **Step 1: Create taxonomy module**

```python
"""
Journal taxonomy — mistake library, emotion tags, review statuses, and setup groups.
Constants used by journal service and exposed via API.
"""

MISTAKE_TAXONOMY = [
    {"id": "overtrading", "label": "Overtrading", "category": "discipline"},
    {"id": "fomo", "label": "FOMO Entry", "category": "psychology"},
    {"id": "chasing", "label": "Chasing Extended", "category": "entry"},
    {"id": "early_exit", "label": "Early Exit", "category": "exit"},
    {"id": "late_entry", "label": "Late Entry", "category": "entry"},
    {"id": "no_stop", "label": "No Stop Loss", "category": "risk"},
    {"id": "oversized", "label": "Oversized Position", "category": "risk"},
    {"id": "countertrend", "label": "Countertrend Impulse", "category": "strategy"},
    {"id": "revenge", "label": "Revenge Trade", "category": "psychology"},
    {"id": "ignored_thesis", "label": "Ignored Thesis", "category": "discipline"},
    {"id": "added_to_loser", "label": "Added to Loser", "category": "risk"},
    {"id": "cut_winner", "label": "Cut Winner Too Early", "category": "exit"},
    {"id": "broke_loss_rule", "label": "Broke Daily Loss Rule", "category": "discipline"},
    {"id": "broke_size_rule", "label": "Broke Max Size Rule", "category": "risk"},
    {"id": "broke_checklist", "label": "Broke Process Checklist", "category": "discipline"},
    {"id": "boredom", "label": "Entered from Boredom", "category": "psychology"},
    {"id": "hesitation", "label": "Hesitation / Missed Entry", "category": "psychology"},
]

EMOTION_TAGS = [
    "confident", "anxious", "greedy", "fearful", "calm",
    "frustrated", "euphoric", "bored", "disciplined", "impulsive",
    "patient", "rushed", "focused", "distracted", "revenge-driven",
]

REVIEW_STATUSES = ["draft", "logged", "partial", "reviewed", "flagged", "follow_up"]

VALID_DIRECTIONS = {"long", "short"}
VALID_STATUSES = {"open", "closed", "stopped"}
VALID_ASSET_CLASSES = {"equity", "options", "futures"}
VALID_SESSIONS = {"pre-market", "regular", "after-hours", "overnight"}

SCREENSHOT_SLOTS = ["pre_entry", "in_trade", "exit", "higher_tf", "lower_tf"]

SETUP_GROUPS = [
    {
        "label": "Swing",
        "setups": [
            "High Tight Flag (Powerplay)", "Classic Flag/Pullback", "VCP",
            "Flat Base Breakout", "IPO Base", "Parabolic Short", "Parabolic Long",
            "Wedge Pop", "Wedge Drop", "Episodic Pivot", "2B Reversal",
            "Kicker Candle", "Power Earnings Gap", "News Gappers",
            "4B Setup (Stan Weinstein)", "Failed H&S/Rounded Top",
            "Classic U&R", "Launchpad", "Go Signal", "HVC",
            "Wick Play", "Slingshot", "Oops Reversal", "News Failure",
            "Remount", "Red to Green",
        ],
    },
    {
        "label": "Intraday",
        "setups": [
            "Opening Range Breakout", "Opening Range Breakdown",
            "Red to Green (Intraday)", "Green to Red",
            "30min Pivot", "Mean Reversion L/S",
        ],
    },
]

MISTAKE_BY_ID = {m["id"]: m for m in MISTAKE_TAXONOMY}


def compute_review_status(entry: dict) -> str:
    """Auto-compute review status from field completeness."""
    # Has follow-up action item open?
    if entry.get("follow_up") and entry.get("review_status") != "reviewed":
        return "follow_up"

    # Manually flagged?
    if entry.get("review_status") == "flagged":
        return "flagged"

    # Missing core fields?
    if not entry.get("sym") or entry.get("entry_price") is None:
        return "draft"

    # Check review completeness
    has_process = entry.get("process_score") is not None
    has_notes = bool(entry.get("notes") or entry.get("lesson"))
    has_mistakes_reviewed = entry.get("mistake_tags") is not None  # even empty string = reviewed

    if has_process and has_notes and has_mistakes_reviewed:
        return "reviewed"
    elif has_process or has_notes or has_mistakes_reviewed:
        return "partial"
    else:
        return "logged"
```

- [ ] **Step 2: Commit**

```bash
git add api/services/journal_taxonomy.py
git commit -m "feat(journal): add taxonomy constants — mistakes, emotions, review status computation"
```

---

## Task 3: Enhanced Journal Service

**Files:**
- Modify: `api/services/journal_service.py` (full rewrite)

- [ ] **Step 1: Rewrite journal_service.py with expanded CRUD and filtering**

Replace the entire file. The new version handles all v2 columns, auto-computes review status, R-multiples, day_of_week, and holding_minutes.

```python
"""
Journal service — per-user trade journal CRUD with filtering, stats, and review tracking.
All data in auth.db, completely isolated from existing DBs.
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.journal_taxonomy import (
    VALID_DIRECTIONS, VALID_STATUSES, VALID_ASSET_CLASSES, VALID_SESSIONS,
    REVIEW_STATUSES, compute_review_status,
)

# All columns on journal_entries (for SELECT *)
_ALL_COLS = [
    "id", "user_id", "sym", "direction", "setup", "entry_price", "exit_price",
    "stop_price", "target_price", "size_pct", "status", "entry_date", "exit_date",
    "pnl_pct", "pnl_dollar", "notes", "rating", "created_at", "updated_at",
    # v2 columns
    "account", "asset_class", "strategy", "playbook_id", "tags", "mistake_tags",
    "emotion_tags", "entry_time", "exit_time", "fees", "shares", "risk_dollars",
    "planned_r", "realized_r", "thesis", "market_context", "confidence",
    "process_score", "outcome_score", "ps_setup", "ps_entry", "ps_exit",
    "ps_sizing", "ps_stop", "lesson", "follow_up", "review_status", "review_date",
    "session", "day_of_week", "holding_minutes",
]

_WRITABLE_FIELDS = {
    "sym", "direction", "setup", "entry_price", "exit_price", "stop_price",
    "target_price", "size_pct", "status", "entry_date", "exit_date", "notes",
    "rating", "account", "asset_class", "strategy", "playbook_id", "tags",
    "mistake_tags", "emotion_tags", "entry_time", "exit_time", "fees", "shares",
    "risk_dollars", "planned_r", "thesis", "market_context", "confidence",
    "process_score", "outcome_score", "ps_setup", "ps_entry", "ps_exit",
    "ps_sizing", "ps_stop", "lesson", "follow_up", "review_status", "review_date",
    "session",
}

_DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def _safe_float(val):
    if val is None:
        return None
    try:
        return float(val)
    except (TypeError, ValueError):
        return None


def _safe_int(val):
    if val is None:
        return None
    try:
        return int(val)
    except (TypeError, ValueError):
        return None


def _compute_derived(data: dict, existing: dict = None) -> dict:
    """Compute P&L, R-multiple, day_of_week, holding_minutes from fields."""
    merged = {**(existing or {}), **data}

    entry_price = _safe_float(merged.get("entry_price"))
    exit_price = _safe_float(merged.get("exit_price"))
    stop_price = _safe_float(merged.get("stop_price"))
    direction = (merged.get("direction") or "long").lower()

    # P&L
    if entry_price and entry_price > 0 and exit_price:
        if direction == "short":
            pnl_pct = ((entry_price - exit_price) / entry_price) * 100
        else:
            pnl_pct = ((exit_price - entry_price) / entry_price) * 100
        data["pnl_pct"] = round(pnl_pct, 2)

        shares = _safe_float(merged.get("shares"))
        if shares:
            if direction == "short":
                data["pnl_dollar"] = round((entry_price - exit_price) * abs(shares), 2)
            else:
                data["pnl_dollar"] = round((exit_price - entry_price) * abs(shares), 2)

    # R-multiple
    if entry_price and stop_price and exit_price and entry_price != stop_price:
        risk_per_share = abs(entry_price - stop_price)
        if direction == "short":
            reward = entry_price - exit_price
        else:
            reward = exit_price - entry_price
        data["realized_r"] = round(reward / risk_per_share, 2)

    # Planned R
    target_price = _safe_float(merged.get("target_price"))
    if entry_price and stop_price and target_price and entry_price != stop_price:
        risk = abs(entry_price - stop_price)
        if direction == "short":
            reward = entry_price - target_price
        else:
            reward = target_price - entry_price
        data["planned_r"] = round(reward / risk, 2)

    # Day of week
    entry_date = merged.get("entry_date")
    if entry_date and len(entry_date) >= 10:
        try:
            dt = datetime.strptime(entry_date[:10], "%Y-%m-%d")
            data["day_of_week"] = _DAY_NAMES[dt.weekday()]
        except ValueError:
            pass

    # Holding minutes (from entry_date+time to exit_date+time)
    ed = merged.get("entry_date", "")
    et = merged.get("entry_time", "")
    xd = merged.get("exit_date", "")
    xt = merged.get("exit_time", "")
    if ed and xd and len(ed) >= 10 and len(xd) >= 10:
        try:
            entry_dt = datetime.strptime(f"{ed[:10]} {et or '09:30'}", "%Y-%m-%d %H:%M")
            exit_dt = datetime.strptime(f"{xd[:10]} {xt or '16:00'}", "%Y-%m-%d %H:%M")
            data["holding_minutes"] = max(0, int((exit_dt - entry_dt).total_seconds() / 60))
        except ValueError:
            pass

    # Process score composite
    ps_fields = [merged.get(f"ps_{d}") for d in ("setup", "entry", "exit", "sizing", "stop")]
    ps_values = [_safe_int(v) for v in ps_fields if v is not None]
    if ps_values:
        data["process_score"] = sum(ps_values)

    # Auto-compute review status (unless manually set to flagged)
    if data.get("review_status") != "flagged":
        data["review_status"] = compute_review_status(merged)

    return data


def create_entry(user_id: str, data: dict) -> dict:
    entry_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    direction = (data.get("direction") or "long").lower()
    if direction not in VALID_DIRECTIONS:
        direction = "long"
    status = (data.get("status") or "open").lower()
    if status not in VALID_STATUSES:
        status = "open"
    sym = (data.get("sym") or "").upper().strip()
    asset_class = (data.get("asset_class") or "equity").lower()
    if asset_class not in VALID_ASSET_CLASSES:
        asset_class = "equity"

    clean = {
        "sym": sym, "direction": direction, "status": status,
        "setup": (data.get("setup") or "")[:100],
        "entry_price": _safe_float(data.get("entry_price")),
        "exit_price": _safe_float(data.get("exit_price")),
        "stop_price": _safe_float(data.get("stop_price")),
        "target_price": _safe_float(data.get("target_price")),
        "size_pct": _safe_float(data.get("size_pct")),
        "entry_date": (data.get("entry_date") or "")[:10],
        "exit_date": data.get("exit_date") or None,
        "notes": (data.get("notes") or "")[:5000],
        "rating": min(max(_safe_int(data.get("rating")) or 0, 0), 5),
        "account": (data.get("account") or "default")[:50],
        "asset_class": asset_class,
        "strategy": (data.get("strategy") or "")[:100],
        "playbook_id": data.get("playbook_id"),
        "tags": (data.get("tags") or "")[:500],
        "mistake_tags": data.get("mistake_tags"),
        "emotion_tags": data.get("emotion_tags"),
        "entry_time": (data.get("entry_time") or "")[:5] or None,
        "exit_time": (data.get("exit_time") or "")[:5] or None,
        "fees": _safe_float(data.get("fees")) or 0,
        "shares": _safe_float(data.get("shares")),
        "risk_dollars": _safe_float(data.get("risk_dollars")),
        "thesis": (data.get("thesis") or "")[:5000],
        "market_context": (data.get("market_context") or "")[:2000],
        "confidence": min(max(_safe_int(data.get("confidence")) or 0, 0), 5) or None,
        "ps_setup": _safe_int(data.get("ps_setup")),
        "ps_entry": _safe_int(data.get("ps_entry")),
        "ps_exit": _safe_int(data.get("ps_exit")),
        "ps_sizing": _safe_int(data.get("ps_sizing")),
        "ps_stop": _safe_int(data.get("ps_stop")),
        "outcome_score": _safe_int(data.get("outcome_score")),
        "lesson": (data.get("lesson") or "")[:5000],
        "follow_up": (data.get("follow_up") or "")[:2000],
        "session": (data.get("session") or "")[:20],
    }

    # Compute derived fields
    clean = _compute_derived(clean)

    cols = list(clean.keys()) + ["id", "user_id", "created_at", "updated_at"]
    vals = list(clean.values()) + [entry_id, user_id, now, now]
    placeholders = ",".join(["?"] * len(cols))
    col_names = ",".join(cols)

    conn = get_connection()
    try:
        conn.execute(f"INSERT INTO journal_entries ({col_names}) VALUES ({placeholders})", vals)
        conn.commit()
        return get_entry(user_id, entry_id)
    finally:
        conn.close()


def get_entry(user_id: str, entry_id: str) -> dict | None:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM journal_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        ).fetchone()
        return dict(row) if row else None
    finally:
        conn.close()


def list_entries(user_id: str, filters: dict = None, limit: int = 50, offset: int = 0) -> dict:
    """List trades with filtering. Returns {trades: [...], total: int}."""
    filters = filters or {}
    limit = min(limit, 500)

    where = ["user_id = ?"]
    params = [user_id]

    # Status filters
    if filters.get("status") and filters["status"] in VALID_STATUSES:
        where.append("status = ?")
        params.append(filters["status"])
    if filters.get("review_status") and filters["review_status"] in REVIEW_STATUSES:
        where.append("review_status = ?")
        params.append(filters["review_status"])

    # Text filters
    for field in ("symbol", "sym"):
        if filters.get(field):
            where.append("sym = ?")
            params.append(filters[field].upper())
            break
    if filters.get("setup"):
        where.append("setup = ?")
        params.append(filters["setup"])
    if filters.get("direction") and filters["direction"] in VALID_DIRECTIONS:
        where.append("direction = ?")
        params.append(filters["direction"])
    if filters.get("asset_class") and filters["asset_class"] in VALID_ASSET_CLASSES:
        where.append("asset_class = ?")
        params.append(filters["asset_class"])
    if filters.get("playbook_id"):
        where.append("playbook_id = ?")
        params.append(filters["playbook_id"])
    if filters.get("session"):
        where.append("session = ?")
        params.append(filters["session"])
    if filters.get("day_of_week"):
        where.append("day_of_week = ?")
        params.append(filters["day_of_week"])
    if filters.get("account"):
        where.append("account = ?")
        params.append(filters["account"])

    # Date range
    if filters.get("date_from"):
        where.append("entry_date >= ?")
        params.append(filters["date_from"])
    if filters.get("date_to"):
        where.append("entry_date <= ?")
        params.append(filters["date_to"])

    # Tag filters (LIKE for comma-separated)
    if filters.get("tag"):
        where.append("tags LIKE ?")
        params.append(f"%{filters['tag']}%")
    if filters.get("mistake_tag"):
        where.append("mistake_tags LIKE ?")
        params.append(f"%{filters['mistake_tag']}%")

    # Boolean filters
    if filters.get("has_screenshots") == "true":
        where.append("id IN (SELECT trade_id FROM journal_screenshots)")
    if filters.get("has_notes") == "true":
        where.append("(notes != '' AND notes IS NOT NULL)")
    if filters.get("has_process_score") == "true":
        where.append("process_score IS NOT NULL")

    # Numeric range filters
    if filters.get("min_r") is not None:
        where.append("realized_r >= ?")
        params.append(float(filters["min_r"]))
    if filters.get("max_r") is not None:
        where.append("realized_r <= ?")
        params.append(float(filters["max_r"]))
    if filters.get("min_pnl") is not None:
        where.append("pnl_pct >= ?")
        params.append(float(filters["min_pnl"]))
    if filters.get("max_pnl") is not None:
        where.append("pnl_pct <= ?")
        params.append(float(filters["max_pnl"]))

    where_clause = " AND ".join(where)

    # Sort
    sort_by = filters.get("sort_by", "entry_date")
    if sort_by not in _ALL_COLS:
        sort_by = "entry_date"
    sort_dir = "ASC" if filters.get("sort_dir", "desc").lower() == "asc" else "DESC"

    conn = get_connection()
    try:
        total = conn.execute(
            f"SELECT COUNT(*) as c FROM journal_entries WHERE {where_clause}", params
        ).fetchone()["c"]

        rows = conn.execute(
            f"SELECT * FROM journal_entries WHERE {where_clause} ORDER BY {sort_by} {sort_dir} LIMIT ? OFFSET ?",
            params + [limit, offset],
        ).fetchall()

        return {"trades": [dict(r) for r in rows], "total": total}
    finally:
        conn.close()


def update_entry(user_id: str, entry_id: str, data: dict) -> dict | None:
    existing = get_entry(user_id, entry_id)
    if not existing:
        return None

    updates = {k: v for k, v in data.items() if k in _WRITABLE_FIELDS}
    if not updates:
        return existing

    # Normalize
    if "direction" in updates:
        updates["direction"] = (updates["direction"] or "long").lower()
        if updates["direction"] not in VALID_DIRECTIONS:
            updates["direction"] = "long"
    if "status" in updates:
        updates["status"] = (updates["status"] or "open").lower()
        if updates["status"] not in VALID_STATUSES:
            updates["status"] = "open"
    if "sym" in updates:
        updates["sym"] = (updates["sym"] or "").upper().strip()
    if "notes" in updates:
        updates["notes"] = (updates["notes"] or "")[:5000]
    if "setup" in updates:
        updates["setup"] = (updates["setup"] or "")[:100]
    if "thesis" in updates:
        updates["thesis"] = (updates["thesis"] or "")[:5000]
    if "lesson" in updates:
        updates["lesson"] = (updates["lesson"] or "")[:5000]
    if "rating" in updates:
        updates["rating"] = min(max(_safe_int(updates["rating"]) or 0, 0), 5)

    # Compute derived fields
    updates = _compute_derived(updates, existing)
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [entry_id, user_id]

    conn = get_connection()
    try:
        conn.execute(
            f"UPDATE journal_entries SET {set_clause} WHERE id = ? AND user_id = ?",
            values,
        )
        conn.commit()
        return get_entry(user_id, entry_id)
    finally:
        conn.close()


def delete_entry(user_id: str, entry_id: str) -> bool:
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM journal_entries WHERE id = ? AND user_id = ?",
            (entry_id, user_id),
        )
        conn.commit()
        return result.rowcount > 0
    finally:
        conn.close()


def get_stats(user_id: str, date_from: str = None, date_to: str = None) -> dict:
    """Aggregate stats for a user's journal."""
    conn = get_connection()
    try:
        where = "user_id = ? AND status = 'closed'"
        params = [user_id]
        if date_from:
            where += " AND entry_date >= ?"
            params.append(date_from)
        if date_to:
            where += " AND entry_date <= ?"
            params.append(date_to)

        rows = conn.execute(f"SELECT * FROM journal_entries WHERE {where}", params).fetchall()
        entries = [dict(r) for r in rows]

        open_count = conn.execute(
            "SELECT COUNT(*) as c FROM journal_entries WHERE user_id = ? AND status = 'open'",
            (user_id,),
        ).fetchone()["c"]

        if not entries:
            return {
                "total_trades": 0, "open_trades": open_count, "wins": 0, "losses": 0,
                "win_rate": 0, "avg_win_pct": 0, "avg_loss_pct": 0,
                "profit_factor": 0, "total_pnl_pct": 0, "avg_r": 0,
                "expectancy": 0, "avg_process_score": 0,
                "best_trade": None, "worst_trade": None, "top_setups": [],
                "review_counts": _get_review_counts(conn, user_id),
            }

        with_pnl = [e for e in entries if e["pnl_pct"] is not None]
        wins = [e for e in with_pnl if e["pnl_pct"] > 0]
        losses = [e for e in with_pnl if e["pnl_pct"] <= 0]

        avg_win = sum(e["pnl_pct"] for e in wins) / len(wins) if wins else 0
        avg_loss = sum(abs(e["pnl_pct"]) for e in losses) / len(losses) if losses else 0
        total_win = sum(e["pnl_pct"] for e in wins)
        total_loss = sum(abs(e["pnl_pct"]) for e in losses)
        pf = total_win / total_loss if total_loss > 0 else 0

        # Expectancy
        wr = len(wins) / len(with_pnl) if with_pnl else 0
        expectancy = (wr * avg_win) - ((1 - wr) * avg_loss) if with_pnl else 0

        # Avg R
        with_r = [e for e in with_pnl if e.get("realized_r") is not None]
        avg_r = sum(e["realized_r"] for e in with_r) / len(with_r) if with_r else 0

        # Avg process score
        with_ps = [e for e in entries if e.get("process_score") is not None]
        avg_ps = sum(e["process_score"] for e in with_ps) / len(with_ps) if with_ps else 0

        sorted_by_pnl = sorted(with_pnl, key=lambda e: e["pnl_pct"])
        best = sorted_by_pnl[-1] if sorted_by_pnl else None
        worst = sorted_by_pnl[0] if sorted_by_pnl else None

        # Top setups
        setup_map = {}
        for e in with_pnl:
            s = e["setup"] or "Unknown"
            if s not in setup_map:
                setup_map[s] = {"setup": s, "wins": 0, "total": 0, "pnl_sum": 0, "r_sum": 0, "r_count": 0}
            setup_map[s]["total"] += 1
            setup_map[s]["pnl_sum"] += e["pnl_pct"]
            if e["pnl_pct"] > 0:
                setup_map[s]["wins"] += 1
            if e.get("realized_r") is not None:
                setup_map[s]["r_sum"] += e["realized_r"]
                setup_map[s]["r_count"] += 1

        top_setups = sorted(
            [v for v in setup_map.values() if v["total"] >= 2],
            key=lambda x: x["wins"] / x["total"],
            reverse=True,
        )[:5]
        for s in top_setups:
            s["win_rate"] = round(s["wins"] / s["total"] * 100, 1)
            s["avg_pnl"] = round(s["pnl_sum"] / s["total"], 2)
            s["avg_r"] = round(s["r_sum"] / s["r_count"], 2) if s["r_count"] else None

        return {
            "total_trades": len(entries),
            "open_trades": open_count,
            "wins": len(wins),
            "losses": len(losses),
            "win_rate": round(wr * 100, 1) if with_pnl else 0,
            "avg_win_pct": round(avg_win, 2),
            "avg_loss_pct": round(avg_loss, 2),
            "profit_factor": round(pf, 2),
            "total_pnl_pct": round(sum(e["pnl_pct"] for e in with_pnl), 2),
            "avg_r": round(avg_r, 2),
            "expectancy": round(expectancy, 2),
            "avg_process_score": round(avg_ps, 1),
            "best_trade": {"sym": best["sym"], "pnl_pct": best["pnl_pct"], "id": best["id"]} if best else None,
            "worst_trade": {"sym": worst["sym"], "pnl_pct": worst["pnl_pct"], "id": worst["id"]} if worst else None,
            "top_setups": top_setups,
            "review_counts": _get_review_counts(conn, user_id),
        }
    finally:
        conn.close()


def _get_review_counts(conn, user_id: str) -> dict:
    """Count trades by review status."""
    rows = conn.execute(
        "SELECT review_status, COUNT(*) as c FROM journal_entries WHERE user_id = ? GROUP BY review_status",
        (user_id,),
    ).fetchall()
    counts = {r["review_status"]: r["c"] for r in rows}
    # Also count special cases
    missing_screenshots = conn.execute(
        """SELECT COUNT(*) as c FROM journal_entries
           WHERE user_id = ? AND status = 'closed'
           AND id NOT IN (SELECT trade_id FROM journal_screenshots)""",
        (user_id,),
    ).fetchone()["c"]
    missing_notes = conn.execute(
        "SELECT COUNT(*) as c FROM journal_entries WHERE user_id = ? AND status = 'closed' AND (notes IS NULL OR notes = '')",
        (user_id,),
    ).fetchone()["c"]
    counts["missing_screenshots"] = missing_screenshots
    counts["missing_notes"] = missing_notes
    return counts


def get_review_queue(user_id: str, limit: int = 30) -> list[dict]:
    """Get trades needing review, ordered by priority."""
    conn = get_connection()
    try:
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        items = []

        # 1. Today's unreviewed
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status, status
               FROM journal_entries WHERE user_id = ? AND entry_date = ?
               AND review_status IN ('draft', 'logged')
               ORDER BY created_at DESC""",
            (user_id, today),
        ).fetchall()
        for r in rows:
            items.append({"type": "today_unreviewed", "priority": 1, **dict(r)})

        # 2. Follow-up needed
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status, follow_up
               FROM journal_entries WHERE user_id = ? AND review_status = 'follow_up'
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "follow_up", "priority": 2, **dict(r)})

        # 3. Missing process scores (closed trades)
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status
               FROM journal_entries WHERE user_id = ? AND status = 'closed'
               AND process_score IS NULL
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "missing_process", "priority": 3, **dict(r)})

        # 4. Flagged for deep review
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status
               FROM journal_entries WHERE user_id = ? AND review_status = 'flagged'
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "flagged", "priority": 4, **dict(r)})

        # 5. Missing screenshots (closed)
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status
               FROM journal_entries WHERE user_id = ? AND status = 'closed'
               AND id NOT IN (SELECT trade_id FROM journal_screenshots)
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "missing_screenshots", "priority": 5, **dict(r)})

        # 6. Missing notes (closed)
        rows = conn.execute(
            """SELECT id, sym, entry_date, pnl_pct, review_status
               FROM journal_entries WHERE user_id = ? AND status = 'closed'
               AND (notes IS NULL OR notes = '') AND (lesson IS NULL OR lesson = '')
               ORDER BY entry_date DESC LIMIT 10""",
            (user_id,),
        ).fetchall()
        for r in rows:
            items.append({"type": "missing_notes", "priority": 6, **dict(r)})

        # Sort by priority, dedup by trade id
        seen = set()
        result = []
        for item in sorted(items, key=lambda x: x["priority"]):
            if item["id"] not in seen and len(result) < limit:
                seen.add(item["id"])
                result.append(item)

        return result
    finally:
        conn.close()


def get_calendar(user_id: str, month: str) -> dict:
    """Get calendar data for a month (YYYY-MM format)."""
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM journal_entries
               WHERE user_id = ? AND entry_date LIKE ?
               ORDER BY entry_date""",
            (user_id, f"{month}%"),
        ).fetchall()
        trades = [dict(r) for r in rows]

        # Daily journals for this month
        dj_rows = conn.execute(
            "SELECT date, review_complete FROM daily_journals WHERE user_id = ? AND date LIKE ?",
            (user_id, f"{month}%"),
        ).fetchall()
        dj_map = {r["date"]: bool(r["review_complete"]) for r in dj_rows}

        # Screenshots count per trade
        sc_rows = conn.execute(
            """SELECT trade_id, COUNT(*) as c FROM journal_screenshots
               WHERE user_id = ? AND trade_id IN (SELECT id FROM journal_entries WHERE entry_date LIKE ?)
               GROUP BY trade_id""",
            (user_id, f"{month}%"),
        ).fetchall()
        sc_map = {r["trade_id"]: r["c"] for r in sc_rows}

        # Group by date
        days = {}
        for t in trades:
            d = t["entry_date"][:10] if t.get("entry_date") else None
            if not d:
                continue
            if d not in days:
                days[d] = {
                    "trade_count": 0, "wins": 0, "losses": 0,
                    "net_pnl_pct": 0, "net_pnl_dollar": 0,
                    "avg_process_score": 0, "_ps_sum": 0, "_ps_count": 0,
                    "has_daily_journal": d in dj_map,
                    "daily_review_complete": dj_map.get(d, False),
                    "mistake_count": 0, "screenshot_count": 0,
                    "review_statuses": [],
                }
            day = days[d]
            day["trade_count"] += 1
            if t.get("pnl_pct") is not None:
                if t["pnl_pct"] > 0:
                    day["wins"] += 1
                else:
                    day["losses"] += 1
                day["net_pnl_pct"] += t["pnl_pct"]
                day["net_pnl_dollar"] += (t.get("pnl_dollar") or 0)
            if t.get("process_score") is not None:
                day["_ps_sum"] += t["process_score"]
                day["_ps_count"] += 1
            if t.get("mistake_tags"):
                day["mistake_count"] += len(t["mistake_tags"].split(","))
            day["screenshot_count"] += sc_map.get(t["id"], 0)
            day["review_statuses"].append(t.get("review_status", "draft"))

        # Finalize
        for d, day in days.items():
            day["net_pnl_pct"] = round(day["net_pnl_pct"], 2)
            day["net_pnl_dollar"] = round(day["net_pnl_dollar"], 2)
            day["avg_process_score"] = round(day["_ps_sum"] / day["_ps_count"], 1) if day["_ps_count"] else None
            del day["_ps_sum"]
            del day["_ps_count"]

        return {"month": month, "days": days}
    finally:
        conn.close()
```

- [ ] **Step 2: Commit**

```bash
git add api/services/journal_service.py
git commit -m "feat(journal): rewrite service — filtering, derived fields, review queue, calendar"
```

---

## Task 4: Execution Service

**Files:**
- Create: `api/services/journal_executions.py`

- [ ] **Step 1: Create execution service**

```python
"""
Trade execution service — scale-in/out tracking with VWAP computation.
"""

import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection


def list_executions(user_id: str, trade_id: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM trade_executions
               WHERE user_id = ? AND trade_id = ?
               ORDER BY sort_order, exec_date, exec_time""",
            (user_id, trade_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


def create_execution(user_id: str, trade_id: str, data: dict) -> dict:
    exec_id = str(uuid.uuid4())[:12]
    now = datetime.now(timezone.utc).isoformat()

    conn = get_connection()
    try:
        # Verify trade belongs to user
        trade = conn.execute(
            "SELECT id FROM journal_entries WHERE id = ? AND user_id = ?",
            (trade_id, user_id),
        ).fetchone()
        if not trade:
            return None

        conn.execute(
            """INSERT INTO trade_executions
               (id, user_id, trade_id, exec_type, exec_date, exec_time, price, shares, fees, notes, sort_order, created_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (
                exec_id, user_id, trade_id,
                data.get("exec_type", "entry"),
                data.get("exec_date", ""),
                data.get("exec_time"),
                float(data.get("price", 0)),
                float(data.get("shares", 0)),
                float(data.get("fees", 0)),
                (data.get("notes") or "")[:1000],
                int(data.get("sort_order", 0)),
                now,
            ),
        )
        conn.commit()

        # Recompute parent trade VWAP
        _recompute_trade_from_executions(conn, user_id, trade_id)

        row = conn.execute("SELECT * FROM trade_executions WHERE id = ?", (exec_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


def delete_execution(user_id: str, trade_id: str, exec_id: str) -> bool:
    conn = get_connection()
    try:
        result = conn.execute(
            "DELETE FROM trade_executions WHERE id = ? AND user_id = ? AND trade_id = ?",
            (exec_id, user_id, trade_id),
        )
        conn.commit()
        if result.rowcount > 0:
            _recompute_trade_from_executions(conn, user_id, trade_id)
            return True
        return False
    finally:
        conn.close()


def _recompute_trade_from_executions(conn, user_id: str, trade_id: str):
    """Recompute parent trade entry_price, exit_price, shares, fees from execution legs."""
    rows = conn.execute(
        "SELECT * FROM trade_executions WHERE trade_id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchall()
    executions = [dict(r) for r in rows]

    if not executions:
        return  # No executions, leave parent as-is (simple mode)

    entry_types = {"entry", "add"}
    exit_types = {"trim", "exit", "stop"}

    entries = [e for e in executions if e["exec_type"] in entry_types]
    exits = [e for e in executions if e["exec_type"] in exit_types]

    # VWAP entry
    entry_shares = sum(abs(e["shares"]) for e in entries)
    entry_vwap = (
        sum(e["price"] * abs(e["shares"]) for e in entries) / entry_shares
        if entry_shares > 0 else None
    )

    # VWAP exit
    exit_shares = sum(abs(e["shares"]) for e in exits)
    exit_vwap = (
        sum(e["price"] * abs(e["shares"]) for e in exits) / exit_shares
        if exit_shares > 0 else None
    )

    total_fees = sum(e.get("fees", 0) or 0 for e in executions)
    total_shares = entry_shares  # gross shares bought

    updates = {"fees": round(total_fees, 2), "shares": round(total_shares, 4)}
    if entry_vwap:
        updates["entry_price"] = round(entry_vwap, 4)
    if exit_vwap:
        updates["exit_price"] = round(exit_vwap, 4)

    # Earliest entry date/time
    if entries:
        sorted_entries = sorted(entries, key=lambda e: (e["exec_date"], e.get("exec_time") or ""))
        updates["entry_date"] = sorted_entries[0]["exec_date"]
        if sorted_entries[0].get("exec_time"):
            updates["entry_time"] = sorted_entries[0]["exec_time"]

    # Latest exit date/time
    if exits:
        sorted_exits = sorted(exits, key=lambda e: (e["exec_date"], e.get("exec_time") or ""))
        updates["exit_date"] = sorted_exits[-1]["exec_date"]
        if sorted_exits[-1].get("exec_time"):
            updates["exit_time"] = sorted_exits[-1]["exec_time"]

    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    set_clause = ", ".join(f"{k} = ?" for k in updates)
    values = list(updates.values()) + [trade_id, user_id]
    conn.execute(
        f"UPDATE journal_entries SET {set_clause} WHERE id = ? AND user_id = ?",
        values,
    )
    conn.commit()
```

- [ ] **Step 2: Commit**

```bash
git add api/services/journal_executions.py
git commit -m "feat(journal): add execution service — VWAP, scale-in/out, parent recompute"
```

---

## Task 5: Screenshot Service

**Files:**
- Create: `api/services/journal_screenshots.py`

- [ ] **Step 1: Create screenshot service**

```python
"""
Journal screenshot service — upload, serve, delete chart screenshots.
Storage: /data/journal_screenshots/ (Railway persistent volume).
Format: WebP via Pillow (same pattern as avatar upload).
"""

import os
import uuid
from datetime import datetime, timezone

from api.services.auth_db import get_connection
from api.services.journal_taxonomy import SCREENSHOT_SLOTS

_STORAGE_DIR = os.environ.get("SCREENSHOT_DIR", "/data/journal_screenshots")
# Local dev fallback
if not os.path.exists(os.path.dirname(_STORAGE_DIR)):
    _STORAGE_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "data", "journal_screenshots")

MAX_FILE_SIZE = 2 * 1024 * 1024  # 2MB
MAX_PER_TRADE = 5
ALLOWED_TYPES = {"image/jpeg", "image/png", "image/webp"}


def list_screenshots(user_id: str, trade_id: str) -> list[dict]:
    conn = get_connection()
    try:
        rows = conn.execute(
            """SELECT * FROM journal_screenshots
               WHERE user_id = ? AND trade_id = ?
               ORDER BY sort_order, created_at""",
            (user_id, trade_id),
        ).fetchall()
        return [dict(r) for r in rows]
    finally:
        conn.close()


async def upload_screenshot(user_id: str, trade_id: str, file, slot: str, label: str = "") -> dict | str:
    """Upload a screenshot. Returns dict on success, error string on failure."""
    if slot not in SCREENSHOT_SLOTS:
        return f"Invalid slot. Must be one of: {', '.join(SCREENSHOT_SLOTS)}"

    if file.content_type not in ALLOWED_TYPES:
        return "Only JPEG, PNG, or WebP images are allowed"

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE:
        return "File too large (max 2MB)"

    conn = get_connection()
    try:
        # Verify trade belongs to user
        trade = conn.execute(
            "SELECT id FROM journal_entries WHERE id = ? AND user_id = ?",
            (trade_id, user_id),
        ).fetchone()
        if not trade:
            return "Trade not found"

        # Check limit
        count = conn.execute(
            "SELECT COUNT(*) as c FROM journal_screenshots WHERE trade_id = ?",
            (trade_id,),
        ).fetchone()["c"]
        if count >= MAX_PER_TRADE:
            return f"Maximum {MAX_PER_TRADE} screenshots per trade"

        # Convert to WebP via Pillow
        from PIL import Image
        import io
        img = Image.open(io.BytesIO(contents))
        img = img.convert("RGBA")
        # Resize large images (max 1920px wide)
        if img.width > 1920:
            ratio = 1920 / img.width
            img = img.resize((1920, int(img.height * ratio)), Image.LANCZOS)

        sc_id = str(uuid.uuid4())[:12]
        filename = f"{user_id}_{trade_id}_{slot}_{sc_id}.webp"

        os.makedirs(_STORAGE_DIR, exist_ok=True)
        filepath = os.path.join(_STORAGE_DIR, filename)
        img.save(filepath, "WEBP", quality=85)

        now = datetime.now(timezone.utc).isoformat()
        conn.execute(
            """INSERT INTO journal_screenshots
               (id, user_id, trade_id, slot, filename, label, sort_order, created_at)
               VALUES (?,?,?,?,?,?,?,?)""",
            (sc_id, user_id, trade_id, slot, filename, (label or "")[:200], count, now),
        )
        conn.commit()

        return {
            "id": sc_id,
            "trade_id": trade_id,
            "slot": slot,
            "filename": filename,
            "label": label,
            "url": f"/api/journal/{trade_id}/screenshots/{sc_id}",
        }
    finally:
        conn.close()


def get_screenshot_path(user_id: str, trade_id: str, screenshot_id: str) -> str | None:
    """Get filesystem path for a screenshot. Returns None if not found."""
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT filename FROM journal_screenshots WHERE id = ? AND user_id = ? AND trade_id = ?",
            (screenshot_id, user_id, trade_id),
        ).fetchone()
        if not row:
            return None
        filepath = os.path.join(_STORAGE_DIR, row["filename"])
        return filepath if os.path.exists(filepath) else None
    finally:
        conn.close()


def delete_screenshot(user_id: str, trade_id: str, screenshot_id: str) -> bool:
    conn = get_connection()
    try:
        row = conn.execute(
            "SELECT filename FROM journal_screenshots WHERE id = ? AND user_id = ? AND trade_id = ?",
            (screenshot_id, user_id, trade_id),
        ).fetchone()
        if not row:
            return False

        # Delete file
        filepath = os.path.join(_STORAGE_DIR, row["filename"])
        if os.path.exists(filepath):
            os.remove(filepath)

        # Delete record
        conn.execute(
            "DELETE FROM journal_screenshots WHERE id = ?",
            (screenshot_id,),
        )
        conn.commit()
        return True
    finally:
        conn.close()
```

- [ ] **Step 2: Commit**

```bash
git add api/services/journal_screenshots.py
git commit -m "feat(journal): add screenshot service — WebP upload, serve, delete"
```

---

## Task 6: Enhanced Journal Router

**Files:**
- Modify: `api/routers/journal.py` (full rewrite)

- [ ] **Step 1: Rewrite router with all endpoints**

```python
"""Journal API — per-user trade journal with filtering, executions, screenshots, and review queue."""

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional

from api.middleware.auth_middleware import get_current_user
from api.services import journal_service, journal_screenshots
from api.services.journal_executions import (
    list_executions, create_execution, delete_execution,
)
from api.services.journal_taxonomy import (
    MISTAKE_TAXONOMY, EMOTION_TAGS, SETUP_GROUPS, SCREENSHOT_SLOTS,
)

router = APIRouter()


# ── Pydantic models ──────────────────────────────────────────────────────────

class JournalEntry(BaseModel):
    sym: str
    direction: Optional[str] = "long"
    setup: Optional[str] = ""
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    size_pct: Optional[float] = None
    status: Optional[str] = "open"
    entry_date: Optional[str] = ""
    exit_date: Optional[str] = None
    notes: Optional[str] = ""
    rating: Optional[int] = None
    # v2 fields
    account: Optional[str] = "default"
    asset_class: Optional[str] = "equity"
    strategy: Optional[str] = ""
    playbook_id: Optional[str] = None
    tags: Optional[str] = ""
    mistake_tags: Optional[str] = None
    emotion_tags: Optional[str] = None
    entry_time: Optional[str] = None
    exit_time: Optional[str] = None
    fees: Optional[float] = 0
    shares: Optional[float] = None
    risk_dollars: Optional[float] = None
    thesis: Optional[str] = ""
    market_context: Optional[str] = ""
    confidence: Optional[int] = None
    ps_setup: Optional[int] = None
    ps_entry: Optional[int] = None
    ps_exit: Optional[int] = None
    ps_sizing: Optional[int] = None
    ps_stop: Optional[int] = None
    outcome_score: Optional[int] = None
    lesson: Optional[str] = ""
    follow_up: Optional[str] = ""
    review_status: Optional[str] = None
    session: Optional[str] = ""


class JournalUpdate(BaseModel):
    sym: Optional[str] = None
    direction: Optional[str] = None
    setup: Optional[str] = None
    entry_price: Optional[float] = None
    exit_price: Optional[float] = None
    stop_price: Optional[float] = None
    target_price: Optional[float] = None
    size_pct: Optional[float] = None
    status: Optional[str] = None
    entry_date: Optional[str] = None
    exit_date: Optional[str] = None
    notes: Optional[str] = None
    rating: Optional[int] = None
    pnl_pct: Optional[float] = None
    pnl_dollar: Optional[float] = None
    account: Optional[str] = None
    asset_class: Optional[str] = None
    strategy: Optional[str] = None
    playbook_id: Optional[str] = None
    tags: Optional[str] = None
    mistake_tags: Optional[str] = None
    emotion_tags: Optional[str] = None
    entry_time: Optional[str] = None
    exit_time: Optional[str] = None
    fees: Optional[float] = None
    shares: Optional[float] = None
    risk_dollars: Optional[float] = None
    thesis: Optional[str] = None
    market_context: Optional[str] = None
    confidence: Optional[int] = None
    ps_setup: Optional[int] = None
    ps_entry: Optional[int] = None
    ps_exit: Optional[int] = None
    ps_sizing: Optional[int] = None
    ps_stop: Optional[int] = None
    outcome_score: Optional[int] = None
    lesson: Optional[str] = None
    follow_up: Optional[str] = None
    review_status: Optional[str] = None
    session: Optional[str] = None


class ExecutionCreate(BaseModel):
    exec_type: str  # entry, add, trim, exit, stop
    exec_date: str
    exec_time: Optional[str] = None
    price: float
    shares: float
    fees: Optional[float] = 0
    notes: Optional[str] = ""
    sort_order: Optional[int] = 0


# ── Trade CRUD ───────────────────────────────────────────────────────────────

@router.get("/api/journal")
def list_journal(
    status: Optional[str] = None,
    review_status: Optional[str] = None,
    symbol: Optional[str] = None,
    setup: Optional[str] = None,
    direction: Optional[str] = None,
    asset_class: Optional[str] = None,
    playbook_id: Optional[str] = None,
    session: Optional[str] = None,
    day_of_week: Optional[str] = None,
    account: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    tag: Optional[str] = None,
    mistake_tag: Optional[str] = None,
    has_screenshots: Optional[str] = None,
    has_notes: Optional[str] = None,
    has_process_score: Optional[str] = None,
    min_r: Optional[float] = None,
    max_r: Optional[float] = None,
    min_pnl: Optional[float] = None,
    max_pnl: Optional[float] = None,
    sort_by: Optional[str] = "entry_date",
    sort_dir: Optional[str] = "desc",
    limit: int = 50,
    offset: int = 0,
    user: dict = Depends(get_current_user),
):
    filters = {
        "status": status, "review_status": review_status, "symbol": symbol,
        "setup": setup, "direction": direction, "asset_class": asset_class,
        "playbook_id": playbook_id, "session": session, "day_of_week": day_of_week,
        "account": account, "date_from": date_from, "date_to": date_to,
        "tag": tag, "mistake_tag": mistake_tag, "has_screenshots": has_screenshots,
        "has_notes": has_notes, "has_process_score": has_process_score,
        "min_r": min_r, "max_r": max_r, "min_pnl": min_pnl, "max_pnl": max_pnl,
        "sort_by": sort_by, "sort_dir": sort_dir,
    }
    # Remove None values
    filters = {k: v for k, v in filters.items() if v is not None}
    return journal_service.list_entries(user["id"], filters=filters, limit=limit, offset=offset)


@router.get("/api/journal/stats")
def journal_stats(
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    user: dict = Depends(get_current_user),
):
    return journal_service.get_stats(user["id"], date_from=date_from, date_to=date_to)


@router.get("/api/journal/taxonomy")
def journal_taxonomy():
    """Return mistake library, emotion tags, setup groups, screenshot slots."""
    return {
        "mistakes": MISTAKE_TAXONOMY,
        "emotions": EMOTION_TAGS,
        "setups": SETUP_GROUPS,
        "screenshot_slots": SCREENSHOT_SLOTS,
    }


@router.get("/api/journal/review-queue")
def review_queue(user: dict = Depends(get_current_user)):
    return journal_service.get_review_queue(user["id"])


@router.get("/api/journal/calendar")
def journal_calendar(
    month: str = Query(..., description="YYYY-MM format"),
    user: dict = Depends(get_current_user),
):
    return journal_service.get_calendar(user["id"], month)


@router.post("/api/journal")
def create_journal_entry(entry: JournalEntry, user: dict = Depends(get_current_user)):
    return journal_service.create_entry(user["id"], entry.model_dump())


@router.put("/api/journal/{entry_id}")
def update_journal_entry(entry_id: str, update: JournalUpdate, user: dict = Depends(get_current_user)):
    data = {k: v for k, v in update.model_dump().items() if v is not None}
    result = journal_service.update_entry(user["id"], entry_id, data)
    if not result:
        raise HTTPException(status_code=404, detail="Entry not found")
    return result


@router.delete("/api/journal/{entry_id}")
def delete_journal_entry(entry_id: str, user: dict = Depends(get_current_user)):
    if not journal_service.delete_entry(user["id"], entry_id):
        raise HTTPException(status_code=404, detail="Entry not found")
    return {"ok": True}


# ── Executions ───────────────────────────────────────────────────────────────

@router.get("/api/journal/{trade_id}/executions")
def get_executions(trade_id: str, user: dict = Depends(get_current_user)):
    return list_executions(user["id"], trade_id)


@router.post("/api/journal/{trade_id}/executions")
def add_execution(trade_id: str, exec_data: ExecutionCreate, user: dict = Depends(get_current_user)):
    result = create_execution(user["id"], trade_id, exec_data.model_dump())
    if result is None:
        raise HTTPException(status_code=404, detail="Trade not found")
    return result


@router.delete("/api/journal/{trade_id}/executions/{exec_id}")
def remove_execution(trade_id: str, exec_id: str, user: dict = Depends(get_current_user)):
    if not delete_execution(user["id"], trade_id, exec_id):
        raise HTTPException(status_code=404, detail="Execution not found")
    return {"ok": True}


# ── Screenshots ──────────────────────────────────────────────────────────────

@router.get("/api/journal/{trade_id}/screenshots")
def get_screenshots(trade_id: str, user: dict = Depends(get_current_user)):
    return journal_screenshots.list_screenshots(user["id"], trade_id)


@router.post("/api/journal/{trade_id}/screenshots")
async def upload_screenshot(
    trade_id: str,
    file: UploadFile = File(...),
    slot: str = Form("pre_entry"),
    label: str = Form(""),
    user: dict = Depends(get_current_user),
):
    result = await journal_screenshots.upload_screenshot(user["id"], trade_id, file, slot, label)
    if isinstance(result, str):
        raise HTTPException(status_code=400, detail=result)
    return result


@router.get("/api/journal/{trade_id}/screenshots/{screenshot_id}")
def serve_screenshot(trade_id: str, screenshot_id: str, user: dict = Depends(get_current_user)):
    path = journal_screenshots.get_screenshot_path(user["id"], trade_id, screenshot_id)
    if not path:
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return FileResponse(path, media_type="image/webp", headers={"Cache-Control": "public, max-age=3600"})


@router.delete("/api/journal/{trade_id}/screenshots/{screenshot_id}")
def remove_screenshot(trade_id: str, screenshot_id: str, user: dict = Depends(get_current_user)):
    if not journal_screenshots.delete_screenshot(user["id"], trade_id, screenshot_id):
        raise HTTPException(status_code=404, detail="Screenshot not found")
    return {"ok": True}
```

- [ ] **Step 2: Commit**

```bash
git add api/routers/journal.py
git commit -m "feat(journal): expand router — filtering, executions, screenshots, review queue, calendar, taxonomy"
```

---

## Task 7: Frontend — JournalPage Shell + TradeLog Tab

This is the largest frontend task. It creates the page shell and the primary trade log view.

**Files:**
- Delete: `app/src/pages/Journal.jsx`, `app/src/pages/Journal.module.css`
- Create: `app/src/pages/journal/JournalPage.jsx`
- Create: `app/src/pages/journal/JournalPage.module.css`
- Create: `app/src/pages/journal/tabs/TradeLog.jsx`
- Create: `app/src/pages/journal/tabs/TradeLog.module.css`
- Create: `app/src/pages/journal/components/FilterBar.jsx`
- Create: `app/src/pages/journal/components/FilterBar.module.css`
- Create: `app/src/pages/journal/components/StatCard.jsx`
- Modify: `app/src/App.jsx` — update import path

- [ ] **Step 1: Create JournalPage shell**

Create `app/src/pages/journal/JournalPage.jsx` — the shell with horizontal tab bar. Renders the active tab component. Persists active tab via `usePreferences`.

The shell should include:
- Page header: "Trade Journal" in Cinzel gold + "+ New Trade" button
- Horizontal tab bar: Overview | Trade Log | Daily Notes | Calendar | Analytics | Playbooks | Review Queue
- Tab bar shows badge count on Review Queue tab (from stats.review_counts)
- Active tab content area below
- For Phase 1, only TradeLog tab is functional. Others show "Coming soon" placeholder.

- [ ] **Step 2: Create TradeLog tab**

Create `app/src/pages/journal/tabs/TradeLog.jsx` — the professional trade table.

Key implementation details:
- Fetches `/api/journal?limit=50&offset=0` via SWR (60s refresh)
- Fetches `/api/journal/stats` via SWR (60s refresh)
- Stats strip at top (6 KPIs: Net P&L, Win Rate, Avg R, Profit Factor, Expectancy, Process Score)
- FilterBar component above table (collapsible, shows active filter count)
- Dense table columns: Date | Symbol | Dir | Setup | Entry | Exit | Stop | R | P&L% | Process | Review | Actions
- Sticky thead
- Click row → opens TradeDrawer (next task)
- Pagination controls (Prev/Next + "Showing 1-50 of 234")
- Sort by clicking column headers (cycles asc/desc)
- Tabular numerals (IBM Plex Mono) for all numbers
- Direction badges (green LONG / red SHORT)
- Review status pills (colored per status)
- P&L colored green/red

- [ ] **Step 3: Create FilterBar component**

Create `app/src/pages/journal/components/FilterBar.jsx`.

Collapsed: single row showing "Filters (N active)" + expand button.
Expanded: grid of filter controls:
- Date range (from/to date inputs)
- Symbol (text input, auto-uppercase)
- Direction (select: All/Long/Short)
- Setup (select from SETUP_GROUPS)
- Status (select: All/Open/Closed/Stopped)
- Review status (select: All/Draft/Logged/Partial/Reviewed/Flagged/Follow-up)
- Has screenshots (checkbox)
- Has notes (checkbox)
- Clear All button

Each filter change updates URL params and triggers SWR refetch.

- [ ] **Step 4: Create StatCard component**

Create `app/src/pages/journal/components/StatCard.jsx` — reusable KPI card.

Props: `{ label, value, format, accent }` where format is "pct" | "dollar" | "ratio" | "number" and accent is "gain" | "loss" | "neutral".

- [ ] **Step 5: Create all CSS modules**

Create `JournalPage.module.css`, `TradeLog.module.css`, `FilterBar.module.css` using the existing design token system. Follow the patterns from Breadth.module.css and Watchlists.module.css (same project).

Key classes needed:
- `.page`, `.header`, `.heading` (Cinzel gold, consistent with other pages)
- `.tabBar`, `.tab`, `.tabActive` (horizontal, IBM Plex Mono, gold active)
- `.tabBadge` (small count pill on tab)
- `.statsStrip`, `.statCard` (6-card row)
- `.tableWrap`, `.table`, `.thead`, `.tr`, `.th`, `.td` (dense, sticky header)
- `.filterBar`, `.filterRow`, `.filterGroup` (collapsible grid)
- `.pagination` (bottom of table)
- Responsive: stacks on mobile (≤640px), reduces columns on tablet

- [ ] **Step 6: Update App.jsx import**

In `app/src/App.jsx`, change the Journal import from:
```javascript
const Journal = lazy(() => import('./pages/Journal'))
```
to:
```javascript
const Journal = lazy(() => import('./pages/journal/JournalPage'))
```

The route `/journal` stays the same.

- [ ] **Step 7: Commit**

```bash
git add app/src/pages/journal/ app/src/App.jsx
git rm app/src/pages/Journal.jsx app/src/pages/Journal.module.css
git commit -m "feat(journal): add JournalPage shell + TradeLog tab with filtering and stats"
```

---

## Task 8: Frontend — TradeDrawer (Summary + Executions + Chart)

**Files:**
- Create: `app/src/pages/journal/components/TradeDrawer.jsx`
- Create: `app/src/pages/journal/components/TradeDrawer.module.css`
- Create: `app/src/pages/journal/components/TradeForm.jsx`
- Create: `app/src/pages/journal/components/TradeForm.module.css`
- Create: `app/src/pages/journal/components/ExecutionsList.jsx`
- Create: `app/src/pages/journal/components/ReviewProgress.jsx`

- [ ] **Step 1: Create TradeDrawer**

480px right-side drawer. Slides in with CSS transform. Contains:
- Header: symbol (large, IBM Plex Mono bold), direction badge, P&L, R-multiple, review status pill, close (×) button, expand (⤡) button
- Tab bar: Summary | Executions | Process | Notes | Mistakes | Related
- Active tab content
- ReviewProgress sidebar (always visible, right edge, 40px wide)
- Close on Escape key
- Backdrop click closes

**Summary tab content:**
- Embedded `<StockChart>` component (height 280px) with:
  - `markers` prop: array of entry/exit/execution markers
  - `priceLines` prop: stop (red dashed), target (green dashed)
  - Timeframe toggle: Daily/Weekly (buttons above chart)
- Metrics grid below chart: 3×4 grid of key-value pairs (Entry, Exit, Stop, Target, Shares, Fees, Risk$, R:R, Holding Time, P&L$, P&L%, Account)
- Thesis section (readonly text)
- Market context section (readonly text)

**Building markers from trade data:**
```javascript
const markers = []
if (trade.entry_price && trade.entry_date) {
  markers.push({
    time: trade.entry_date,
    position: 'belowBar',
    color: '#3cb868',
    shape: 'arrowUp',
    text: 'BUY',
  })
}
if (trade.exit_price && trade.exit_date) {
  markers.push({
    time: trade.exit_date,
    position: 'aboveBar',
    color: '#e74c3c',
    shape: 'arrowDown',
    text: trade.status === 'stopped' ? 'STOP' : 'SELL',
  })
}
// Add execution markers
executions.forEach(ex => {
  const isEntry = ['entry', 'add'].includes(ex.exec_type)
  markers.push({
    time: ex.exec_date,
    position: isEntry ? 'belowBar' : 'aboveBar',
    color: isEntry ? '#3cb868' : '#e74c3c',
    shape: isEntry ? 'arrowUp' : 'arrowDown',
    text: ex.exec_type.toUpperCase(),
  })
})
```

- [ ] **Step 2: Create TradeForm**

Reusable form for creating/editing trades. Used in:
- "+ New Trade" button (opens inline above trade log)
- Edit mode in TradeDrawer

Sections:
1. **Core**: Symbol, Direction toggle, Setup select, Entry Date, Entry Time
2. **Prices**: Entry$, Stop$, Target$, Exit$, Exit Date, Exit Time
3. **Position**: Shares, Size%, Risk$, Fees, Account
4. **Context**: Thesis (textarea), Market Context (textarea), Confidence (1-5 pills), Session select
5. **Tags**: Strategy, Tags (comma input), Playbook select (future, disabled for now)

All fields use existing design tokens. Number inputs use `type="number" step="0.01"`. Text inputs auto-uppercase for Symbol.

- [ ] **Step 3: Create ExecutionsList**

Executions tab content in the drawer. Shows:
- Table of executions: Type | Date | Time | Price | Shares | Fees | Notes
- Type badges: ENTRY (green), ADD (green), TRIM (amber), EXIT (red), STOP (red)
- "Add Execution" button → inline form row at bottom
- Delete (×) button per row
- VWAP summary at bottom: "Avg Entry: $XX.XX | Avg Exit: $XX.XX | Net Shares: XXX"
- Fetches `/api/journal/{id}/executions` via SWR

- [ ] **Step 4: Create ReviewProgress**

Vertical strip on right edge of drawer (40px wide). Shows completion dots:
- Core ✓/○ (has sym + entry_price)
- Thesis ✓/○ (thesis not empty)
- Process ✓/○ (process_score not null)
- Screenshots ✓/○ (has at least 1)
- Notes ✓/○ (notes or lesson not empty)
- Mistakes ✓/○ (mistake_tags is not null, even if empty string)

Green dot = complete, muted dot = incomplete. Hover shows label.

- [ ] **Step 5: Create CSS modules**

TradeDrawer.module.css — drawer overlay, slide-in animation, header, tabs, content area, review progress strip.
TradeForm.module.css — form grid, sections, input styling.

Key drawer styles:
```css
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.4); z-index: var(--z-modal); }
.drawer { position: fixed; top: 0; right: 0; bottom: 0; width: 480px; background: var(--bg-elevated); border-left: 1px solid var(--border); transform: translateX(0); transition: transform var(--duration-normal) var(--ease-out); z-index: calc(var(--z-modal) + 1); display: flex; flex-direction: column; }
.drawerHidden { transform: translateX(100%); }
.drawerExpanded { width: 100%; }
```

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/journal/components/
git commit -m "feat(journal): add TradeDrawer with chart markers, executions list, review progress"
```

---

## Task 9: Frontend — Process Scoring + Mistakes + Emotions

**Files:**
- Create: `app/src/pages/journal/components/ProcessScoreCard.jsx`
- Create: `app/src/pages/journal/components/MistakeSelector.jsx`
- Create: `app/src/pages/journal/components/EmotionSelector.jsx`

- [ ] **Step 1: Create ProcessScoreCard**

5 horizontal sliders, each 0-20:
- Setup Quality
- Entry Quality
- Exit Quality
- Sizing Discipline
- Stop Discipline

Each slider shows: label (left), slider (center), value (right, /20).
Total process score at bottom: "PROCESS SCORE: 72/100" with color gradient (red 0-30, amber 31-60, green 61-100).

Separate outcome score slider below: 0-100, labeled "OUTCOME SCORE".

Visual comparison bar: two horizontal bars stacked — green for process, blue for outcome. Makes divergence between process and outcome visible at a glance.

Props: `{ trade, onUpdate }` — calls `onUpdate({ ps_setup: N, ps_entry: N, ... })` on any slider change. Debounced 500ms to avoid excessive API calls.

- [ ] **Step 2: Create MistakeSelector**

Multi-select from `MISTAKE_TAXONOMY` (fetched from `/api/journal/taxonomy` or hardcoded).

Layout: checkboxes grouped by category (discipline, psychology, entry, exit, risk, strategy). Each checkbox shows mistake label. Selected mistakes appear as red-tinted chips above the list.

Props: `{ selected, onChange }` where selected is comma-separated string and onChange receives updated string.

Custom mistake input at bottom: text input + "Add" button for user-defined mistakes.

- [ ] **Step 3: Create EmotionSelector**

Multi-select from `EMOTION_TAGS`.

Layout: pill buttons in a flex-wrap row. Click to toggle. Selected pills are blue-tinted, unselected are muted. Max 5 selections (soft limit, shows warning).

Props: `{ selected, onChange }` where selected is comma-separated string.

- [ ] **Step 4: Wire into TradeDrawer tabs**

In TradeDrawer.jsx:
- Process tab renders `<ProcessScoreCard>` and `<EmotionSelector>` (emotions relate to process)
- Mistakes tab renders `<MistakeSelector>`
- Both tabs auto-save on change (PUT /api/journal/{id} with updated fields)

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal/components/ProcessScoreCard.jsx app/src/pages/journal/components/MistakeSelector.jsx app/src/pages/journal/components/EmotionSelector.jsx
git commit -m "feat(journal): add process scoring, mistake selector, emotion selector"
```

---

## Task 10: Frontend — Screenshots + Notes Tab

**Files:**
- Create: `app/src/pages/journal/components/ScreenshotUploader.jsx`

- [ ] **Step 1: Create ScreenshotUploader**

5-slot screenshot manager. Each slot shows:
- Slot label: "Pre-Entry", "In-Trade", "Exit", "Higher TF", "Lower TF"
- If empty: dashed border drop zone with "Click or drag to upload" + file input
- If filled: WebP thumbnail (200px wide), click to enlarge (lightbox overlay), label text input, delete (×) button

Upload flow:
1. User clicks slot or drags file
2. Frontend validates: JPEG/PNG/WebP, <2MB
3. POST `/api/journal/{id}/screenshots` with FormData (file + slot + label)
4. On success: refresh screenshot list from SWR
5. Lightbox: click thumbnail → fullscreen overlay with image, close on Escape/backdrop

- [ ] **Step 2: Wire Notes tab in TradeDrawer**

Notes tab content:
1. **Notes** — textarea (5000 char limit), placeholder: "What happened during this trade? What did you observe?"
2. **Lesson** — textarea (5000 char limit), placeholder: "If you could trade this again, what would you change?"
3. **Follow-up** — textarea (2000 char limit), placeholder: "Any action items for next time?"
4. **Screenshots** — `<ScreenshotUploader>` component
5. Auto-save on blur for text fields (PUT /api/journal/{id})

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/journal/components/ScreenshotUploader.jsx
git commit -m "feat(journal): add screenshot uploader + notes tab with auto-save"
```

---

## Task 11: Integration Testing + Polish

- [ ] **Step 1: Test the full create → review → close flow manually**

1. Create a new trade via "+ New Trade"
2. Fill core fields (sym, direction, entry price, stop, target)
3. Verify it appears in trade log with "draft" review status
4. Click to open drawer — verify chart loads with entry marker + stop/target lines
5. Add thesis, notes, lesson in Notes tab
6. Score process in Process tab (drag 5 sliders)
7. Add 2 mistakes in Mistakes tab
8. Upload a screenshot
9. Verify ReviewProgress shows all dots green
10. Verify review_status auto-updated to "reviewed"
11. Close the trade (set exit price + status=closed)
12. Verify P&L and R-multiple auto-computed
13. Verify exit marker appears on chart

- [ ] **Step 2: Test execution flow**

1. Create a new trade (simple mode, no executions)
2. Open drawer → Executions tab → "Add Execution"
3. Add entry execution (type=entry, 100 shares @ $50)
4. Add another entry (type=add, 50 shares @ $48)
5. Verify VWAP entry shows ~$49.33
6. Verify parent trade's entry_price updated
7. Add trim execution (type=trim, 50 shares @ $55)
8. Verify all 3 markers appear on chart

- [ ] **Step 3: Test filtering**

1. Create 3+ trades with different setups, directions, dates
2. Open filter bar
3. Filter by direction=long — verify only longs shown
4. Filter by setup=VCP — verify only VCPs shown
5. Clear filters — verify all trades return
6. Sort by P&L descending — verify order

- [ ] **Step 4: Test review queue**

1. Ensure some trades have missing process scores, screenshots, notes
2. Navigate to Review Queue tab (or check stats.review_counts)
3. Verify queue items appear with correct types and priorities

- [ ] **Step 5: Mobile responsive check**

1. Resize browser to 640px width
2. Verify table becomes scrollable or switches to card layout
3. Verify drawer becomes full-width overlay
4. Verify filter bar collapses properly
5. Verify tab bar is horizontally scrollable

- [ ] **Step 6: Commit all polish fixes**

```bash
git add -A
git commit -m "feat(journal): phases 1-3 complete — trade log, drawer, chart markers, executions, scoring, screenshots"
```

---

## Summary

| Task | What it builds | Backend/Frontend |
|------|---------------|-----------------|
| 1 | Schema migration (25 cols + 6 tables) | Backend |
| 2 | Taxonomy constants | Backend |
| 3 | Enhanced journal service (filtering, stats, review queue, calendar) | Backend |
| 4 | Execution service (VWAP, scale-in/out) | Backend |
| 5 | Screenshot service (upload, serve, delete) | Backend |
| 6 | Expanded journal router (all endpoints) | Backend |
| 7 | JournalPage shell + TradeLog tab + FilterBar + StatCard | Frontend |
| 8 | TradeDrawer (Summary + Chart + Executions + ReviewProgress) | Frontend |
| 9 | ProcessScoreCard + MistakeSelector + EmotionSelector | Frontend |
| 10 | ScreenshotUploader + Notes tab | Frontend |
| 11 | Integration testing + polish | Full stack |

**After Phases 1-3:** The core journal loop works end-to-end. Users can log trades, add executions, score process, tag mistakes/emotions, upload screenshots, and see chart markers. The review queue surfaces incomplete work. Filtering and stats provide analytical value.

**Next:** Phases 4-9 (Daily Notes, Calendar, Overview, Analytics, Playbooks, Review Queue UI, Import, AI Summaries) will be planned as a follow-up implementation document once Phases 1-3 are tested and stable.
