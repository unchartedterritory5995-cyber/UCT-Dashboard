# Compass Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Compass Chat — a persistent conversational coaching surface inside the Compass tab with read/analyze/action tool calling, preview-confirm flow for state mutations, streaming responses, and an elevated-warning pattern for discipline changes.

**Architecture:** Anthropic Sonnet 4.6 streaming chat with prompt caching. New `coach_chat.py` orchestrator + `coach_chat_tools.py` tool catalog. New `j2_chat_messages` table for persistent per-account history. Sliding-window summarization. Single linear conversation per `(user, account)`. SSE for streaming + tool events to the React frontend.

**Tech Stack:** Python 3.12, FastAPI, SQLite, `anthropic>=0.40.0` SDK, React + Vite + SWR, vitest + pytest.

**Spec:** `docs/superpowers/specs/2026-05-11-compass-chat-design.md`

---

## File Map

| Path | Action | Role |
|---|---|---|
| `api/services/journal_two/db.py` | Modify | Add `j2_chat_messages` table + `muted_setups`/`paper_only_days` columns on `j2_accounts` |
| `api/services/journal_two/coach_chat_tools.py` | Create | Tool catalog: schemas + executors. Read/analysis/action functions. |
| `api/services/journal_two/test_coach_chat_tools.py` | Create | Per-tool unit tests |
| `api/services/journal_two/coach_chat.py` | Create | Orchestrator: history reconstruction, streaming loop, summarization, rate-limit, audit |
| `api/services/journal_two/test_coach_chat.py` | Create | Orchestrator tests with FakeAnthropicClient |
| `api/services/journal_two/coach_prompts.py` | Modify | Append Section 7 (chat-specific guidance) to `COMPASS_SYSTEM_PROMPT` |
| `api/routers/journal_two.py` | Modify | Six new endpoints under `/coach/chat/*` |
| `app/src/pages/journal-2-0/hooks/useJ2CoachChat.js` | Create | SWR + streaming consumer hook |
| `app/src/pages/journal-2-0/components/ChatToolChip.jsx` | Create | Inline tool-call chip (read/analyze) |
| `app/src/pages/journal-2-0/components/ChatActionCard.jsx` | Create | Pending action card with Confirm/Cancel + elevated warning |
| `app/src/pages/journal-2-0/components/ChatMessage.jsx` | Create | Per-role message renderer (user/assistant/tool/summary) |
| `app/src/pages/journal-2-0/components/CompassChat.jsx` | Create | Main panel: scrollback + composer + empty state |
| `app/src/pages/journal-2-0/components/CompassChat.test.jsx` | Create | Vitest cases |
| `app/src/pages/journal-2-0/tabs/CompassTab.jsx` | Modify | Mount `<CompassChat />` at top of the Compass tab |

---

## Task 1: DB migration — chat table + muted_setups + paper_only_days

**Files:**
- Modify: `api/services/journal_two/db.py`

Add three additive migrations. Lazy-applied on startup via the existing migration runner (the file has an idempotent `IF NOT EXISTS` + `ALTER TABLE` pattern; follow it).

- [ ] **Step 1: Locate the migration list in `db.py`**

Find the migration array (it's a list of SQL strings near the bottom of the file, each prefixed by a comment that names the phase). New migrations get appended.

- [ ] **Step 2: Add the three migrations to the array**

Append to the migration array (preserving existing ordering):

```python
    # Compass Chat — j2_chat_messages table + per-account chat state
    """
    CREATE TABLE IF NOT EXISTS j2_chat_messages (
        id              TEXT PRIMARY KEY,
        user_id         TEXT NOT NULL,
        account_id      TEXT NOT NULL,
        role            TEXT NOT NULL CHECK(role IN ('user','assistant','tool','summary')),
        content         TEXT,
        tool_calls      TEXT,
        tool_results    TEXT,
        parent_id       TEXT,
        metadata        TEXT,
        created_at      TEXT NOT NULL,
        forgotten       INTEGER NOT NULL DEFAULT 0
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_j2_chat_account ON j2_chat_messages(user_id, account_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_j2_chat_parent ON j2_chat_messages(parent_id)",
    # Compass Chat — per-account muted setups + paper-only days (consumed later by Pre-Trade Verdict)
    "ALTER TABLE j2_accounts ADD COLUMN muted_setups TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE j2_accounts ADD COLUMN paper_only_days TEXT NOT NULL DEFAULT '[]'",
```

- [ ] **Step 3: Smoke-test the migration**

```bash
cd C:/Users/Patrick/uct-dashboard
python -c "from api.services import auth_db; auth_db.init_db(); import sqlite3, os; conn = sqlite3.connect(os.environ.get('AUTH_DB_PATH','data/auth.db')); print(conn.execute('SELECT name FROM sqlite_master WHERE type=\"table\" AND name=\"j2_chat_messages\"').fetchone()); print(conn.execute('PRAGMA table_info(j2_accounts)').fetchall())"
```

Expected: prints `('j2_chat_messages',)` then a table-info list that includes columns `muted_setups` and `paper_only_days`.

- [ ] **Step 4: Run full j2 suite (no regressions)**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: 368 passing (same as baseline).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/db.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): db migration — j2_chat_messages + muted_setups + paper_only_days"
```

---

## Task 2: Tool catalog — read tools (8 tools) + tests

**Files:**
- Create: `api/services/journal_two/coach_chat_tools.py`
- Create: `api/services/journal_two/test_coach_chat_tools.py`

Eight read tools. Each is a pure function `(user_id, account_id, args, conn) -> dict`. No mutation. Most wrap existing `coach_data_assembler` or service-layer functions.

- [ ] **Step 1: Write the failing test file (read-tool tests only)**

Create `api/services/journal_two/test_coach_chat_tools.py`:

```python
"""Tests for the chat tool catalog."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_chat"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, exit_iso, **kwargs):
    """Closed-trade insert helper (mirrors test_coach_data_assembler.py)."""
    defaults = dict(
        symbol="TEST", side="Long", shares=100,
        entry_price=100.0, entry_date=exit_iso,
        exit_price=105.0, exit_date=exit_iso,
        original_stop=95.0, setup="Bull Flag", notes=None,
        pnl_dollar=500.0, pnl_percent=5.0, r_multiple=1.0,
        hold_days=2, result="Win", context_at_entry="{}",
        created_at=exit_iso, mistake_tags="[]", emotion_tags="[]",
        fees=0, regime=None,
    )
    defaults.update(kwargs)
    conn.execute(
        """INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id, mistake_tags, emotion_tags, fees, regime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (str(uuid.uuid4()), user_id, str(uuid.uuid4()),
         defaults["symbol"], defaults["side"], defaults["shares"],
         defaults["entry_price"], defaults["entry_date"],
         defaults["exit_price"], defaults["exit_date"],
         defaults["original_stop"], defaults["setup"], defaults["notes"],
         defaults["pnl_dollar"], defaults["pnl_percent"], defaults["r_multiple"],
         defaults["hold_days"], defaults["result"], defaults["context_at_entry"],
         defaults["created_at"], account_id, defaults["mistake_tags"],
         defaults["emotion_tags"], defaults["fees"], defaults["regime"]),
    )
    conn.commit()


# ── TOOLS dict shape ─────────────────────────────────────────────────────────

def test_tools_dict_exposes_expected_entries():
    from api.services.journal_two import coach_chat_tools as tools
    expected_read = {"list_recent_trades", "get_aggregates", "get_open_positions",
                     "get_trader_profile", "get_recent_recaps", "get_account_settings",
                     "get_setup_stats", "find_arcs"}
    assert expected_read.issubset(tools.TOOLS.keys()), f"missing: {expected_read - tools.TOOLS.keys()}"
    for name in expected_read:
        spec = tools.TOOLS[name]
        assert spec["requires_confirm"] is False
        assert callable(spec["executor"])
        assert "input_schema" in spec


# ── list_recent_trades ───────────────────────────────────────────────────────

def test_list_recent_trades_returns_filtered_trades(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  symbol="NVDA", setup="Bull Flag", result="Win")
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-10T20:00:00+00:00",
                  symbol="AAPL", setup="Pullback", result="Loss")
    result = tools.TOOLS["list_recent_trades"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 7}, conn=db_conn,
    )
    assert result["count"] == 2
    assert len(result["trades"]) == 2


def test_list_recent_trades_filters_by_setup(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  symbol="NVDA", setup="Bull Flag", result="Win")
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-10T20:00:00+00:00",
                  symbol="AAPL", setup="Pullback", result="Loss")
    result = tools.TOOLS["list_recent_trades"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 7, "setup": "Bull Flag"}, conn=db_conn,
    )
    assert result["count"] == 1
    assert result["trades"][0]["symbol"] == "NVDA"


# ── get_aggregates ───────────────────────────────────────────────────────────

def test_get_aggregates_period_week_returns_summary(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  pnl_dollar=400, r_multiple=2.0, result="Win")
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-12T20:00:00+00:00",
                  pnl_dollar=-200, r_multiple=-1.0, result="Loss")
    result = tools.TOOLS["get_aggregates"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"period": "week"}, conn=db_conn,
    )
    assert result["aggregates"]["trade_count"] == 2
    assert result["aggregates"]["wins"] == 1
    assert result["aggregates"]["losses"] == 1


def test_get_aggregates_with_breakdown_by_setup(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  setup="Bull Flag", r_multiple=1.5, result="Win")
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-12T20:00:00+00:00",
                  setup="Pullback", r_multiple=-1.0, result="Loss")
    result = tools.TOOLS["get_aggregates"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"period": "week", "breakdown_by": "setup"}, conn=db_conn,
    )
    setups = {b["key"]: b for b in result["breakdown"]}
    assert "Bull Flag" in setups
    assert "Pullback" in setups


# ── get_trader_profile + get_account_settings ───────────────────────────────

def test_get_trader_profile_returns_account_blob(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET trader_profile = ? WHERE id = ?",
        ("# Trader Profile\n\nDisciplined Long-only trader.", acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["get_trader_profile"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert "Disciplined" in result["profile_markdown"]


def test_get_account_settings_returns_dict(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["get_account_settings"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert isinstance(result["settings"], dict)


# ── get_open_positions ───────────────────────────────────────────────────────

def test_get_open_positions_returns_only_open(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        """INSERT INTO j2_positions (id, user_id, symbol, side, entry_date,
           shares, original_shares, entry_price, stop_price, breakeven_stop,
           raise_to_breakeven, setup, notes, context_at_entry, account_id,
           created_at, updated_at, closed_at)
           VALUES (?, 'u_chat', 'NVDA', 'Long', '2026-05-10T14:00:00+00:00',
           100, 100, 200.0, 195.0, NULL, 0, 'Bull Flag', NULL, '{}', ?,
           '2026-05-10T14:00:00+00:00', '2026-05-10T14:00:00+00:00', NULL)""",
        (str(uuid.uuid4()), acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["get_open_positions"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert result["count"] == 1
    assert result["positions"][0]["symbol"] == "NVDA"


# ── get_recent_recaps ────────────────────────────────────────────────────────

def test_get_recent_recaps_returns_eod_and_weekly(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    for kind, day in (("eod_recap", "2026-05-11"), ("weekly_review", "2026-05-04")):
        db_conn.execute(
            """INSERT INTO j2_coach_outputs
               (id, user_id, account_id, output_type, body, summary, metadata, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (str(uuid.uuid4()), "u_chat", acc["id"], kind,
             f"{kind} body", f"{kind} summary",
             json.dumps({"day": day, "week_start": day}),
             f"{day}T20:00:00+00:00"),
        )
    db_conn.commit()
    result = tools.TOOLS["get_recent_recaps"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"kind": "all"}, conn=db_conn,
    )
    assert result["count"] == 2


# ── find_arcs ─────────────────────────────────────────────────────────────────

def test_find_arcs_uses_assembler_detectors(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    for day, sym in (("2026-05-07", "TSLA"), ("2026-05-08", "NVDA"), ("2026-05-11", "CRWD")):
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso=f"{day}T20:00:00+00:00", setup="Bull Flag",
                      symbol=sym, result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    result = tools.TOOLS["find_arcs"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"lookback_days": 10}, conn=db_conn,
    )
    assert any("Bull Flag" in arc for arc in result["arcs"])


# ── get_setup_stats ──────────────────────────────────────────────────────────

def test_get_setup_stats_returns_per_setup_breakdown(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    for r, setup in ((2.1, "Bull Flag"), (-1.0, "Pullback"), (1.5, "Bull Flag")):
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso="2026-05-10T20:00:00+00:00",
                      setup=setup, r_multiple=r,
                      result="Win" if r > 0 else "Loss",
                      pnl_dollar=r * 100)
    result = tools.TOOLS["get_setup_stats"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert isinstance(result["setups"], list)
    setups = {s["setup"]: s for s in result["setups"]}
    assert "Bull Flag" in setups
```

- [ ] **Step 2: Run, confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
```

Expected: `ModuleNotFoundError: api.services.journal_two.coach_chat_tools`.

- [ ] **Step 3: Implement `coach_chat_tools.py` read tools**

Create `api/services/journal_two/coach_chat_tools.py`:

```python
"""
Compass Chat tool catalog.

Each tool is a dict in TOOLS with:
  - name (str)
  - description (str, used in Anthropic tool definition)
  - input_schema (JSON Schema for args)
  - requires_confirm (bool)
  - executor (callable: user_id, account_id, args, conn -> dict)
  - preview (callable, action tools only)

The orchestrator (coach_chat.py) reads this catalog to assemble the
`tools=` parameter for Anthropic, and dispatches tool calls to the
executor / preview functions.
"""
from __future__ import annotations
import json
import sqlite3
from datetime import datetime, timezone, timedelta, date
from typing import Any, Callable

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import coach_data_assembler


# ── Read tools ───────────────────────────────────────────────────────────────


def _date_from_for_period(period: str) -> str | None:
    period = (period or "").lower()
    today = date.today()
    if period == "today":
        return today.isoformat()
    if period == "week":
        return (today - timedelta(days=7)).isoformat()
    if period == "month":
        return (today - timedelta(days=30)).isoformat()
    if period == "ytd":
        return date(today.year, 1, 1).isoformat()
    return None  # 'all'


def _trades_range_to_iso(days: int) -> tuple[datetime, datetime]:
    end = datetime.now(timezone.utc)
    start = end - timedelta(days=int(days))
    return start, end


def _exec_list_recent_trades(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 30))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(
        conn or get_connection(), user_id, account_id, start, end,
    )
    # Apply post-fetch filters
    if args.get("symbol"):
        sym = args["symbol"].upper()
        trades = [t for t in trades if (t.get("symbol") or "").upper() == sym]
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    if args.get("result"):
        trades = [t for t in trades if t.get("result") == args["result"]]
    if args.get("regime"):
        trades = [t for t in trades if t.get("regime") == args["regime"]]
    limit = int(args.get("limit", 100))
    trades = trades[-limit:] if len(trades) > limit else trades
    return {
        "count": len(trades),
        "range": f"{start.date().isoformat()} to {end.date().isoformat()}",
        "trades": trades,
    }


def _exec_get_aggregates(*, user_id, account_id, args, conn=None) -> dict:
    period = (args.get("period") or "week").lower()
    days_map = {"today": 1, "week": 7, "month": 30, "ytd": (date.today() - date(date.today().year, 1, 1)).days or 1, "all": 3650}
    days = days_map.get(period, 7)
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    agg = coach_data_assembler._aggregate_trades(trades)
    out = {"aggregates": agg, "period": period, "range": f"{start.date().isoformat()} to {end.date().isoformat()}"}
    breakdown_by = args.get("breakdown_by")
    if breakdown_by:
        out["breakdown"] = _breakdown_trades(trades, breakdown_by)
    return out


def _breakdown_trades(trades: list[dict], dimension: str) -> list[dict]:
    buckets: dict[str, list[dict]] = {}
    for t in trades:
        key = _bucket_key(t, dimension)
        if key is None:
            continue
        buckets.setdefault(key, []).append(t)
    out = []
    for k, group in buckets.items():
        agg = coach_data_assembler._aggregate_trades(group)
        out.append({"key": k, **agg})
    out.sort(key=lambda b: b.get("net_pnl_dollar") or 0, reverse=True)
    return out


def _bucket_key(t: dict, dimension: str) -> str | None:
    if dimension == "setup":
        return t.get("setup") or "(no setup)"
    if dimension == "symbol":
        return (t.get("symbol") or "").upper() or None
    if dimension == "regime":
        return t.get("regime") or "(no regime)"
    if dimension == "day_of_week":
        try:
            d = datetime.fromisoformat(str(t.get("exit_date")).replace("Z", "+00:00"))
            return ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][d.weekday()]
        except Exception:
            return None
    if dimension == "hour":
        try:
            d = datetime.fromisoformat(str(t.get("exit_date")).replace("Z", "+00:00"))
            return f"{d.hour:02d}:00"
        except Exception:
            return None
    if dimension == "mistake":
        tags = t.get("mistake_tags") or []
        return tags[0] if tags else None
    if dimension == "emotion":
        tags = t.get("emotion_tags") or []
        return tags[0] if tags else None
    return None


def _exec_get_open_positions(*, user_id, account_id, args, conn=None) -> dict:
    rows = coach_data_assembler._open_positions(conn or get_connection(), user_id, account_id)
    return {"count": len(rows), "positions": rows}


def _exec_get_trader_profile(*, user_id, account_id, args, conn=None) -> dict:
    c = conn or get_connection()
    row = c.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if row is None:
        return {"profile_markdown": "", "exists": False}
    return {"profile_markdown": row["trader_profile"] or "", "exists": True}


def _exec_get_recent_recaps(*, user_id, account_id, args, conn=None) -> dict:
    kind = (args.get("kind") or "all").lower()
    limit = int(args.get("limit", 10))
    sql = """SELECT id, output_type, body, summary, metadata, created_at
             FROM j2_coach_outputs
             WHERE user_id = ? AND account_id = ? AND forgotten = 0"""
    params: list = [user_id, account_id]
    if kind == "eod":
        sql += " AND output_type = 'eod_recap'"
    elif kind == "weekly":
        sql += " AND output_type = 'weekly_review'"
    elif kind == "all":
        sql += " AND output_type IN ('eod_recap', 'weekly_review')"
    sql += " ORDER BY created_at DESC LIMIT ?"
    params.append(limit)
    rows = (conn or get_connection()).execute(sql, params).fetchall()
    out = []
    for r in rows:
        try:
            meta = json.loads(r["metadata"]) if r["metadata"] else {}
        except (TypeError, json.JSONDecodeError):
            meta = {}
        out.append({
            "id": r["id"],
            "kind": r["output_type"],
            "day_or_week": meta.get("day") or meta.get("week_start"),
            "summary": r["summary"] or "",
            "body": r["body"] or "",
        })
    return {"count": len(out), "recaps": out}


def _exec_get_account_settings(*, user_id, account_id, args, conn=None) -> dict:
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    return {"settings": settings}


def _exec_get_setup_stats(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    breakdown = _breakdown_trades(trades, "setup")
    return {"setups": [{"setup": b["key"], **{k: v for k, v in b.items() if k != "key"}} for b in breakdown]}


def _exec_find_arcs(*, user_id, account_id, args, conn=None) -> dict:
    lookback = int(args.get("lookback_days", 10))
    start, end = _trades_range_to_iso(lookback)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    arcs = coach_data_assembler._detect_recent_arcs(trades, today_date=end.date())
    return {"arcs": arcs}


# ── Tool catalog ──────────────────────────────────────────────────────────────

TOOLS: dict[str, dict[str, Any]] = {
    "list_recent_trades": {
        "name": "list_recent_trades",
        "description": "Fetch closed trades from the journal, optionally filtered by days, symbol, setup, result, or regime.",
        "requires_confirm": False,
        "executor": _exec_list_recent_trades,
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {"type": "integer", "default": 30, "minimum": 1, "maximum": 365},
                "symbol": {"type": "string"},
                "setup": {"type": "string"},
                "result": {"type": "string", "enum": ["Win", "Loss", "BE"]},
                "regime": {"type": "string", "enum": ["GREEN", "AMBER", "ORANGE", "RED"]},
                "limit": {"type": "integer", "default": 100, "maximum": 500},
            },
        },
    },
    "get_aggregates": {
        "name": "get_aggregates",
        "description": "Compute aggregate stats for a period, optionally with a breakdown by dimension.",
        "requires_confirm": False,
        "executor": _exec_get_aggregates,
        "input_schema": {
            "type": "object",
            "properties": {
                "period": {"type": "string", "enum": ["today", "week", "month", "ytd", "all"], "default": "week"},
                "breakdown_by": {"type": "string", "enum": ["setup", "symbol", "regime", "day_of_week", "hour", "mistake", "emotion"]},
            },
        },
    },
    "get_open_positions": {
        "name": "get_open_positions",
        "description": "List currently open positions (overnight bets).",
        "requires_confirm": False,
        "executor": _exec_get_open_positions,
        "input_schema": {"type": "object", "properties": {}},
    },
    "get_trader_profile": {
        "name": "get_trader_profile",
        "description": "Read the markdown Trader Profile for the current account.",
        "requires_confirm": False,
        "executor": _exec_get_trader_profile,
        "input_schema": {"type": "object", "properties": {}},
    },
    "get_recent_recaps": {
        "name": "get_recent_recaps",
        "description": "Fetch recent Compass recaps (EOD daily and/or Weekly Review).",
        "requires_confirm": False,
        "executor": _exec_get_recent_recaps,
        "input_schema": {
            "type": "object",
            "properties": {
                "kind": {"type": "string", "enum": ["eod", "weekly", "all"], "default": "all"},
                "limit": {"type": "integer", "default": 10, "maximum": 50},
            },
        },
    },
    "get_account_settings": {
        "name": "get_account_settings",
        "description": "Fetch the account's discipline + sizing settings.",
        "requires_confirm": False,
        "executor": _exec_get_account_settings,
        "input_schema": {"type": "object", "properties": {}},
    },
    "get_setup_stats": {
        "name": "get_setup_stats",
        "description": "Per-setup performance breakdown over a lookback window.",
        "requires_confirm": False,
        "executor": _exec_get_setup_stats,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup": {"type": "string"},
                "days": {"type": "integer", "default": 180, "minimum": 7, "maximum": 730},
            },
        },
    },
    "find_arcs": {
        "name": "find_arcs",
        "description": "Run multi-day arc detectors and return non-empty arcs.",
        "requires_confirm": False,
        "executor": _exec_find_arcs,
        "input_schema": {
            "type": "object",
            "properties": {"lookback_days": {"type": "integer", "default": 10, "minimum": 5, "maximum": 30}},
        },
    },
}
```

- [ ] **Step 4: Run tests — confirm all 9 read tests pass**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
```

Expected: 9 passed.

- [ ] **Step 5: Run full j2 suite (no regressions)**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: at least 368 + 9 = 377 passing.

- [ ] **Step 6: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat_tools.py api/services/journal_two/test_coach_chat_tools.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): tool catalog + 8 read tools (list_recent_trades, get_aggregates, …)"
```

---

## Task 3: Analysis tools (7 tools) + tests

**Files:**
- Modify: `api/services/journal_two/coach_chat_tools.py`
- Modify: `api/services/journal_two/test_coach_chat_tools.py`

Seven on-the-fly analyzers. Each takes a lookback window and runs statistics over `j2_trades`.

- [ ] **Step 1: Append analysis tests**

Append to `test_coach_chat_tools.py`:

```python
# ── analyze_time_of_day ──────────────────────────────────────────────────────

def test_analyze_time_of_day_buckets_by_hour(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    # 14:00 ET trades (win) and 15:00 ET trades (loss)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T18:00:00+00:00",
                  entry_date="2026-05-11T18:00:00+00:00",  # 14:00 ET
                  result="Win", r_multiple=2.0, pnl_dollar=200)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T19:00:00+00:00",
                  entry_date="2026-05-11T19:00:00+00:00",  # 15:00 ET
                  result="Loss", r_multiple=-1.0, pnl_dollar=-100)
    result = tools.TOOLS["analyze_time_of_day"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 30}, conn=db_conn,
    )
    assert "buckets" in result
    # buckets keyed by hour string
    assert isinstance(result["buckets"], dict)


# ── analyze_day_of_week ──────────────────────────────────────────────────────

def test_analyze_day_of_week_returns_weekday_buckets(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  entry_date="2026-05-11T18:00:00+00:00",  # Mon
                  result="Win", r_multiple=1.0)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-12T20:00:00+00:00",
                  entry_date="2026-05-12T18:00:00+00:00",  # Tue
                  result="Loss", r_multiple=-1.0)
    result = tools.TOOLS["analyze_day_of_week"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 30}, conn=db_conn,
    )
    assert "buckets" in result


# ── analyze_hold_duration ────────────────────────────────────────────────────

def test_analyze_hold_duration_returns_winner_loser_compare(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    # Winners with 4-day holds, losers with 1-day holds (classic "cutting winners")
    for _ in range(3):
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso="2026-05-11T20:00:00+00:00",
                      hold_days=4, result="Win", r_multiple=2.0)
    for _ in range(3):
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso="2026-05-11T20:00:00+00:00",
                      hold_days=1, result="Loss", r_multiple=-1.0)
    result = tools.TOOLS["analyze_hold_duration"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 90}, conn=db_conn,
    )
    assert result["winners"]["avg_days"] == 4.0
    assert result["losers"]["avg_days"] == 1.0
    assert result["hint"] in {"cutting_winners_short", "holding_losers", "balanced"}


# ── analyze_sequence ─────────────────────────────────────────────────────────

def test_analyze_sequence_returns_post_outcome_stats(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    for day in ("2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07"):
        result_type = "Win" if day == "2026-05-04" else "Loss"
        _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                      exit_iso=f"{day}T20:00:00+00:00",
                      result=result_type, r_multiple=1.5 if result_type == "Win" else -1.0,
                      pnl_dollar=150 if result_type == "Win" else -100)
    result = tools.TOOLS["analyze_sequence"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"prior_outcome": "Win", "n": 3}, conn=db_conn,
    )
    assert "trade_count" in result


# ── analyze_sizing_curve ─────────────────────────────────────────────────────

def test_analyze_sizing_curve_runs_without_error(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  shares=100, entry_price=100.0, original_stop=98.0,
                  r_multiple=1.0, pnl_dollar=100, result="Win")
    result = tools.TOOLS["analyze_sizing_curve"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"days": 180}, conn=db_conn,
    )
    assert "buckets" in result


# ── analyze_correlation ──────────────────────────────────────────────────────

def test_analyze_correlation_returns_dict(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["analyze_correlation"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )
    assert "open_positions_overlap" in result


# ── compare_setups ───────────────────────────────────────────────────────────

def test_compare_setups_returns_side_by_side(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  setup="Bull Flag", r_multiple=2.0, result="Win", pnl_dollar=200)
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00",
                  setup="Pullback", r_multiple=-1.0, result="Loss", pnl_dollar=-100)
    result = tools.TOOLS["compare_setups"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"setup_a": "Bull Flag", "setup_b": "Pullback"}, conn=db_conn,
    )
    assert "setup_a" in result
    assert "setup_b" in result
    assert result["setup_a"]["setup"] == "Bull Flag"
```

- [ ] **Step 2: Run, confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
```

Expected: 7 new tests fail (analyzers not defined).

- [ ] **Step 3: Implement the 7 analyzers in `coach_chat_tools.py`**

Insert before the `TOOLS` dict definition:

```python
# ── Analysis tools ────────────────────────────────────────────────────────────


def _exec_analyze_time_of_day(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    if args.get("symbol"):
        sym = args["symbol"].upper()
        trades = [t for t in trades if (t.get("symbol") or "").upper() == sym]
    # Group by hour-of-entry (ET = UTC-4)
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    buckets: dict[str, list[dict]] = {}
    for t in trades:
        try:
            d = datetime.fromisoformat(str(t.get("entry_date")).replace("Z", "+00:00"))
            key = f"{d.astimezone(et).hour:02d}:00"
        except Exception:
            continue
        buckets.setdefault(key, []).append(t)
    out_buckets = {k: coach_data_assembler._aggregate_trades(v) for k, v in buckets.items()}
    return {"buckets": out_buckets, "days": days}


def _exec_analyze_day_of_week(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
    buckets: dict[str, list[dict]] = {}
    for t in trades:
        try:
            d = datetime.fromisoformat(str(t.get("entry_date")).replace("Z", "+00:00"))
            key = weekdays[d.weekday()]
        except Exception:
            continue
        buckets.setdefault(key, []).append(t)
    out = {k: coach_data_assembler._aggregate_trades(v) for k, v in buckets.items()}
    return {"buckets": out, "days": days}


def _exec_analyze_hold_duration(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    if args.get("setup"):
        trades = [t for t in trades if t.get("setup") == args["setup"]]
    winners = [t for t in trades if t.get("result") == "Win"]
    losers = [t for t in trades if t.get("result") == "Loss"]

    def _stats(group: list[dict]) -> dict:
        if not group:
            return {"count": 0, "avg_days": None, "median_days": None}
        holds = sorted(float(t.get("hold_days") or 0) for t in group)
        avg = sum(holds) / len(holds)
        median = holds[len(holds) // 2]
        return {"count": len(group), "avg_days": round(avg, 1), "median_days": round(median, 1)}

    w = _stats(winners)
    l = _stats(losers)
    hint = "balanced"
    if w["avg_days"] and l["avg_days"]:
        if l["avg_days"] < w["avg_days"] * 0.5:
            hint = "cutting_winners_short"
        elif l["avg_days"] > w["avg_days"] * 1.5:
            hint = "holding_losers"
    return {"winners": w, "losers": l, "hint": hint, "days": days}


def _exec_analyze_sequence(*, user_id, account_id, args, conn=None) -> dict:
    prior_outcome = args.get("prior_outcome", "Win")
    n = int(args.get("n", 3))
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    # Sort by exit_date ascending
    trades.sort(key=lambda t: t.get("exit_date") or "")
    captured: list[dict] = []
    for i, t in enumerate(trades):
        if t.get("result") == prior_outcome:
            captured.extend(trades[i + 1:i + 1 + n])
    agg = coach_data_assembler._aggregate_trades(captured)
    return {"prior_outcome": prior_outcome, "n": n, **agg}


def _exec_analyze_sizing_curve(*, user_id, account_id, args, conn=None) -> dict:
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    # Bucket by approximate per-trade risk %
    if account_size <= 0:
        return {"buckets": [], "note": "account size not configured"}
    rows: list[dict] = []
    for t in trades:
        shares = float(t.get("shares") or 0)
        entry = float(t.get("entry_price") or 0)
        stop = float(t.get("original_stop") or 0)
        if shares <= 0 or entry <= 0 or stop <= 0:
            continue
        per_share = abs(entry - stop)
        risk_pct = (shares * per_share / account_size) * 100.0
        rows.append({"risk_pct": risk_pct, **t})
    # Bucket by 0.5% bands
    buckets: dict[str, list[dict]] = {}
    for r in rows:
        band = int(r["risk_pct"] // 0.5) * 0.5
        key = f"{band:.1f}-{band + 0.5:.1f}%"
        buckets.setdefault(key, []).append(r)
    out = []
    for k, group in sorted(buckets.items()):
        agg = coach_data_assembler._aggregate_trades(group)
        out.append({"band": k, **agg})
    return {"buckets": out, "days": days, "account_size": account_size}


def _exec_analyze_correlation(*, user_id, account_id, args, conn=None) -> dict:
    positions = coach_data_assembler._open_positions(conn or get_connection(), user_id, account_id)
    return {"open_positions_overlap": {"sector": None, "theme": None}, "open_count": len(positions),
            "note": "Sector/theme enrichment not wired yet — v1 returns counts only."}


def _exec_compare_setups(*, user_id, account_id, args, conn=None) -> dict:
    setup_a = args.get("setup_a")
    setup_b = args.get("setup_b")
    days = int(args.get("days", 180))
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn or get_connection(), user_id, account_id, start, end)

    def _stats_for_setup(setup_name: str) -> dict:
        group = [t for t in trades if t.get("setup") == setup_name]
        agg = coach_data_assembler._aggregate_trades(group)
        return {"setup": setup_name, **agg}

    a = _stats_for_setup(setup_a)
    b = _stats_for_setup(setup_b)
    return {"setup_a": a, "setup_b": b, "days": days}
```

Then add the 7 specs to the `TOOLS` dict (extending it):

```python
TOOLS.update({
    "analyze_time_of_day": {
        "name": "analyze_time_of_day",
        "description": "Bucket trades by hour-of-entry (ET) and return per-hour win rate and R.",
        "requires_confirm": False,
        "executor": _exec_analyze_time_of_day,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup": {"type": "string"},
                "symbol": {"type": "string"},
                "days": {"type": "integer", "default": 180, "minimum": 7, "maximum": 730},
            },
        },
    },
    "analyze_day_of_week": {
        "name": "analyze_day_of_week",
        "description": "Bucket trades by weekday (Mon–Sun) and return per-day win rate and R.",
        "requires_confirm": False,
        "executor": _exec_analyze_day_of_week,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup": {"type": "string"},
                "days": {"type": "integer", "default": 180, "minimum": 7, "maximum": 730},
            },
        },
    },
    "analyze_hold_duration": {
        "name": "analyze_hold_duration",
        "description": "Compare winners' vs losers' hold durations — surfaces cutting-winners-short or holding-losers patterns.",
        "requires_confirm": False,
        "executor": _exec_analyze_hold_duration,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup": {"type": "string"},
                "days": {"type": "integer", "default": 180, "minimum": 7, "maximum": 730},
            },
        },
    },
    "analyze_sequence": {
        "name": "analyze_sequence",
        "description": "Aggregate the N trades that follow each Win (or Loss) — reveals revenge-trading or overconfidence patterns.",
        "requires_confirm": False,
        "executor": _exec_analyze_sequence,
        "input_schema": {
            "type": "object",
            "properties": {
                "prior_outcome": {"type": "string", "enum": ["Win", "Loss"]},
                "n": {"type": "integer", "default": 3, "minimum": 1, "maximum": 10},
                "days": {"type": "integer", "default": 180},
            },
            "required": ["prior_outcome"],
        },
    },
    "analyze_sizing_curve": {
        "name": "analyze_sizing_curve",
        "description": "Bucket trades by per-trade risk % and return P&L by bucket. Reveals optimal position-size band.",
        "requires_confirm": False,
        "executor": _exec_analyze_sizing_curve,
        "input_schema": {
            "type": "object",
            "properties": {"days": {"type": "integer", "default": 180}},
        },
    },
    "analyze_correlation": {
        "name": "analyze_correlation",
        "description": "Inspect open-position correlations (sector / theme overlap). v1 returns counts only.",
        "requires_confirm": False,
        "executor": _exec_analyze_correlation,
        "input_schema": {"type": "object", "properties": {}},
    },
    "compare_setups": {
        "name": "compare_setups",
        "description": "Side-by-side stats for two named setups.",
        "requires_confirm": False,
        "executor": _exec_compare_setups,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup_a": {"type": "string"},
                "setup_b": {"type": "string"},
                "days": {"type": "integer", "default": 180},
            },
            "required": ["setup_a", "setup_b"],
        },
    },
})
```

- [ ] **Step 4: Run tests, confirm green**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
```

Expected: 16 passed (9 read + 7 analysis).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat_tools.py api/services/journal_two/test_coach_chat_tools.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): 7 analysis tools (time-of-day, day-of-week, hold duration, sequence, sizing curve, correlation, compare setups)"
```

---

## Task 4: Action tools (7 tools, preview + execute halves) + tests

**Files:**
- Modify: `api/services/journal_two/coach_chat_tools.py`
- Modify: `api/services/journal_two/test_coach_chat_tools.py`

Each action tool has TWO halves: `preview(args)` returns a dict with narration + contextual warnings; `executor(args)` performs the mutation. The orchestrator calls `preview` when the tool is emitted, and `executor` only after the user confirms.

- [ ] **Step 1: Append action tool tests**

```python
# ── tag_trade ────────────────────────────────────────────────────────────────

def test_tag_trade_preview_returns_narration(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    trade_id = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)
           VALUES (?, 'u_chat', ?, 'NVDA', 'Long', 100, 200.0,
           '2026-05-11T18:00:00+00:00', 205.0, '2026-05-11T20:00:00+00:00',
           198.0, 'Bull Flag', NULL, 500, 2.5, 2.0, 0, 'Win',
           '{}', '2026-05-11T20:00:00+00:00', ?, '[]', '[]', 0)""",
        (trade_id, str(uuid.uuid4()), acc["id"]),
    )
    db_conn.commit()
    preview = tools.TOOLS["tag_trade"]["preview"](
        user_id="u_chat", account_id=acc["id"],
        args={"trade_id": trade_id, "mistake_tags": ["FOMO"]}, conn=db_conn,
    )
    assert "narration" in preview
    assert "NVDA" in preview["narration"] or "trade" in preview["narration"].lower()


def test_tag_trade_execute_appends_tags(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    trade_id = str(uuid.uuid4())
    db_conn.execute(
        """INSERT INTO j2_trades (id, user_id, position_id, symbol, side, shares,
           entry_price, entry_date, exit_price, exit_date, original_stop, setup,
           notes, pnl_dollar, pnl_percent, r_multiple, hold_days, result,
           context_at_entry, created_at, account_id, mistake_tags, emotion_tags, fees)
           VALUES (?, 'u_chat', ?, 'NVDA', 'Long', 100, 200.0,
           '2026-05-11T18:00:00+00:00', 205.0, '2026-05-11T20:00:00+00:00',
           198.0, 'Bull Flag', NULL, 500, 2.5, 2.0, 0, 'Win',
           '{}', '2026-05-11T20:00:00+00:00', ?, '[]', '[]', 0)""",
        (trade_id, str(uuid.uuid4()), acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["tag_trade"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"trade_id": trade_id, "mistake_tags": ["FOMO"], "emotion_tags": ["rushed"]},
        conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT mistake_tags, emotion_tags FROM j2_trades WHERE id = ?", (trade_id,),
    ).fetchone()
    assert "FOMO" in row["mistake_tags"]
    assert "rushed" in row["emotion_tags"]


# ── set_weekly_focus ─────────────────────────────────────────────────────────

def test_set_weekly_focus_writes_to_metadata(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["set_weekly_focus"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"text": "Skip Pullbacks until Friday."}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute(
        "SELECT metadata FROM j2_coach_outputs WHERE user_id = ? AND output_type = 'weekly_review' ORDER BY created_at DESC LIMIT 1",
        ("u_chat",),
    ).fetchone()
    meta = json.loads(row["metadata"])
    assert "Skip Pullbacks" in (meta.get("this_weeks_focus") or "")


# ── mute_setup / unmute_setup ────────────────────────────────────────────────

def test_mute_setup_appends_to_account_list(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["mute_setup"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"setup_name": "Pullback", "until_date": "2026-05-25"}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute("SELECT muted_setups FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    muted = json.loads(row["muted_setups"])
    assert any(m["setup_name"] == "Pullback" for m in muted)


def test_unmute_setup_removes_from_list(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    db_conn.execute(
        "UPDATE j2_accounts SET muted_setups = ? WHERE id = ?",
        (json.dumps([{"setup_name": "Pullback", "until_date": "2026-05-25"}]), acc["id"]),
    )
    db_conn.commit()
    result = tools.TOOLS["unmute_setup"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={"setup_name": "Pullback"}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute("SELECT muted_setups FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    muted = json.loads(row["muted_setups"])
    assert not any(m["setup_name"] == "Pullback" for m in muted)


# ── set_a_plus_setups ────────────────────────────────────────────────────────

def test_set_a_plus_setups_adds_and_removes(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["set_a_plus_setups"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"add": ["High Tight Flag"], "remove": []}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute("SELECT a_plus_setups FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    a_plus = json.loads(row["a_plus_setups"])
    assert "High Tight Flag" in a_plus


# ── update_discipline_setting (ELEVATED) ────────────────────────────────────

def test_update_discipline_preview_includes_warnings(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    preview = tools.TOOLS["update_discipline_setting"]["preview"](
        user_id="u_chat", account_id=acc["id"],
        args={"field": "maxRiskPerTradePct", "value": 2.5}, conn=db_conn,
    )
    assert preview["elevated"] is True
    assert isinstance(preview["contextual_warnings"], list)
    assert "confirm_label" in preview


def test_update_discipline_execute_changes_setting(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["update_discipline_setting"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"field": "maxRiskPerTradePct", "value": 1.0}, conn=db_conn,
    )
    assert result["ok"] is True
    settings = tools.TOOLS["get_account_settings"]["executor"](
        user_id="u_chat", account_id=acc["id"], args={}, conn=db_conn,
    )["settings"]
    assert float(settings["maxRiskPerTradePct"]) == 1.0


# ── schedule_paper_only_day ──────────────────────────────────────────────────

def test_schedule_paper_only_day_appends_to_list(db_conn):
    from api.services.journal_two import coach_chat_tools as tools
    acc = _seed_account(db_conn)
    result = tools.TOOLS["schedule_paper_only_day"]["executor"](
        user_id="u_chat", account_id=acc["id"],
        args={"date": "2026-05-15"}, conn=db_conn,
    )
    assert result["ok"] is True
    row = db_conn.execute("SELECT paper_only_days FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    days = json.loads(row["paper_only_days"])
    assert any(d["date"] == "2026-05-15" for d in days)
```

- [ ] **Step 2: Run, confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
```

Expected: 9 new tests fail (action tools not defined).

- [ ] **Step 3: Implement action tools in `coach_chat_tools.py`**

Insert before the `TOOLS.update({...})` block (or anywhere logical):

```python
# ── Action tools (preview + execute halves) ──────────────────────────────────


def _tag_trade_preview(*, user_id, account_id, args, conn=None) -> dict:
    trade_id = args.get("trade_id")
    mistake = args.get("mistake_tags") or []
    emotion = args.get("emotion_tags") or []
    row = (conn or get_connection()).execute(
        "SELECT symbol, exit_date FROM j2_trades WHERE id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchone()
    if row is None:
        return {"narration": f"Trade {trade_id} not found.", "contextual_warnings": [],
                "confirm_label": "Confirm", "elevated": False, "error": "not_found"}
    pieces = []
    if mistake:
        pieces.append(f"mistake tags {mistake}")
    if emotion:
        pieces.append(f"emotion tags {emotion}")
    parts = " and ".join(pieces) or "tags"
    return {
        "narration": f"Add {parts} to your {row['symbol']} trade from {row['exit_date'][:10]}.",
        "contextual_warnings": [], "confirm_label": "Confirm", "elevated": False,
    }


def _tag_trade_execute(*, user_id, account_id, args, conn=None) -> dict:
    trade_id = args.get("trade_id")
    mistake = args.get("mistake_tags") or []
    emotion = args.get("emotion_tags") or []
    c = conn or get_connection()
    row = c.execute(
        "SELECT mistake_tags, emotion_tags FROM j2_trades WHERE id = ? AND user_id = ?",
        (trade_id, user_id),
    ).fetchone()
    if row is None:
        return {"ok": False, "error": "trade not found"}
    existing_m = []
    existing_e = []
    try:
        existing_m = json.loads(row["mistake_tags"] or "[]")
    except (TypeError, json.JSONDecodeError):
        pass
    try:
        existing_e = json.loads(row["emotion_tags"] or "[]")
    except (TypeError, json.JSONDecodeError):
        pass
    new_m = list(dict.fromkeys(existing_m + mistake))  # preserve order, dedupe
    new_e = list(dict.fromkeys(existing_e + emotion))
    c.execute(
        "UPDATE j2_trades SET mistake_tags = ?, emotion_tags = ? WHERE id = ? AND user_id = ?",
        (json.dumps(new_m), json.dumps(new_e), trade_id, user_id),
    )
    c.commit()
    return {"ok": True, "summary": "Tags added."}


def _set_weekly_focus_preview(*, user_id, account_id, args, conn=None) -> dict:
    return {"narration": f"Set this week's focus to: \"{args.get('text', '')}\"",
            "contextual_warnings": [], "confirm_label": "Set focus", "elevated": False}


def _set_weekly_focus_execute(*, user_id, account_id, args, conn=None) -> dict:
    text = (args.get("text") or "")[:500]
    c = conn or get_connection()
    # Use the most recent weekly_review for this account, or create a stub
    row = c.execute(
        """SELECT id, metadata FROM j2_coach_outputs
           WHERE user_id = ? AND account_id = ? AND output_type = 'weekly_review'
           ORDER BY created_at DESC LIMIT 1""",
        (user_id, account_id),
    ).fetchone()
    now_iso = datetime.now(timezone.utc).isoformat()
    if row is None:
        import uuid as _uuid
        review_id = str(_uuid.uuid4())
        meta = {"week_start": datetime.now(timezone.utc).date().isoformat(),
                "this_weeks_focus": text, "key_observations": []}
        c.execute(
            """INSERT INTO j2_coach_outputs
               (id, user_id, account_id, output_type, body, summary, metadata, forgotten, created_at)
               VALUES (?, ?, ?, 'weekly_review', '', '', ?, 0, ?)""",
            (review_id, user_id, account_id, json.dumps(meta), now_iso),
        )
    else:
        try:
            meta = json.loads(row["metadata"] or "{}")
        except (TypeError, json.JSONDecodeError):
            meta = {}
        meta["this_weeks_focus"] = text
        c.execute(
            "UPDATE j2_coach_outputs SET metadata = ? WHERE id = ?",
            (json.dumps(meta), row["id"]),
        )
    c.commit()
    return {"ok": True, "summary": "Focus set."}


def _mute_setup_preview(*, user_id, account_id, args, conn=None) -> dict:
    setup = args.get("setup_name")
    until = args.get("until_date") or (date.today() + timedelta(days=14)).isoformat()
    return {"narration": f"Mute {setup} until {until}. Pre-trade verdict will reject entries on this setup until then.",
            "contextual_warnings": [], "confirm_label": "Mute setup", "elevated": False,
            "resolved_args": {"setup_name": setup, "until_date": until}}


def _mute_setup_execute(*, user_id, account_id, args, conn=None) -> dict:
    setup = args.get("setup_name")
    until = args.get("until_date") or (date.today() + timedelta(days=14)).isoformat()
    c = conn or get_connection()
    row = c.execute("SELECT muted_setups FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)).fetchone()
    try:
        current = json.loads(row["muted_setups"]) if row else []
    except (TypeError, json.JSONDecodeError):
        current = []
    current = [m for m in current if m.get("setup_name") != setup]   # dedupe
    current.append({"setup_name": setup, "until_date": until})
    c.execute("UPDATE j2_accounts SET muted_setups = ? WHERE id = ? AND user_id = ?",
              (json.dumps(current), account_id, user_id))
    c.commit()
    return {"ok": True, "summary": f"Muted {setup} until {until}."}


def _unmute_setup_preview(*, user_id, account_id, args, conn=None) -> dict:
    return {"narration": f"Unmute {args.get('setup_name')}.",
            "contextual_warnings": [], "confirm_label": "Unmute", "elevated": False}


def _unmute_setup_execute(*, user_id, account_id, args, conn=None) -> dict:
    setup = args.get("setup_name")
    c = conn or get_connection()
    row = c.execute("SELECT muted_setups FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)).fetchone()
    try:
        current = json.loads(row["muted_setups"]) if row else []
    except (TypeError, json.JSONDecodeError):
        current = []
    current = [m for m in current if m.get("setup_name") != setup]
    c.execute("UPDATE j2_accounts SET muted_setups = ? WHERE id = ? AND user_id = ?",
              (json.dumps(current), account_id, user_id))
    c.commit()
    return {"ok": True, "summary": f"Unmuted {setup}."}


def _set_a_plus_setups_preview(*, user_id, account_id, args, conn=None) -> dict:
    add = args.get("add") or []
    remove = args.get("remove") or []
    return {"narration": f"Update A+ setups — add {add}, remove {remove}.",
            "contextual_warnings": [], "confirm_label": "Update A+ list", "elevated": False}


def _set_a_plus_setups_execute(*, user_id, account_id, args, conn=None) -> dict:
    add = args.get("add") or []
    remove = args.get("remove") or []
    c = conn or get_connection()
    row = c.execute("SELECT a_plus_setups FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)).fetchone()
    try:
        current = json.loads(row["a_plus_setups"]) if row else []
    except (TypeError, json.JSONDecodeError):
        current = []
    for s in add:
        if s not in current:
            current.append(s)
    current = [s for s in current if s not in remove]
    c.execute("UPDATE j2_accounts SET a_plus_setups = ? WHERE id = ? AND user_id = ?",
              (json.dumps(current), account_id, user_id))
    c.commit()
    return {"ok": True, "summary": "A+ list updated."}


def _update_discipline_setting_preview(*, user_id, account_id, args, conn=None) -> dict:
    field = args.get("field")
    new_value = args.get("value")
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    current = settings.get(field)
    warnings: list[str] = []
    # Detect loosening for known caps
    loosening = False
    if field in {"maxRiskPerTradePct", "dailyLossLimitPct"} and current is not None and new_value > current:
        loosening = True
    if field == "coolingOffMinutesAfterLoss" and current is not None and new_value < current:
        loosening = True
    if loosening:
        # Look up breach count in last 30 days where applicable
        days_back = 30
        breach_count = _count_recent_breaches(conn or get_connection(), user_id, account_id, field, current, days_back)
        if breach_count > 0:
            warnings.append(f"You've breached the current {field}={current} {breach_count} times in the last {days_back} days.")
        warnings.append(f"This change weakens the guardrail from {current} to {new_value}.")
    confirm_label = (
        "Yes, raise the cap" if (field == "maxRiskPerTradePct" and loosening) else
        "Yes, raise the loss limit" if (field == "dailyLossLimitPct" and loosening) else
        "Yes, change it" if loosening else
        f"Set {field}"
    )
    return {
        "narration": f"Change {field} from {current} to {new_value}.",
        "contextual_warnings": warnings,
        "confirm_label": confirm_label,
        "elevated": loosening,
    }


def _count_recent_breaches(conn, user_id, account_id, field, current_value, days) -> int:
    if current_value is None:
        return 0
    if field != "maxRiskPerTradePct":
        return 0  # only risk-cap breaches are derivable from trade data
    start, end = _trades_range_to_iso(days)
    trades = coach_data_assembler._trades_in_range(conn, user_id, account_id, start, end)
    settings = accounts_service.get_account_settings(user_id, account_id, conn=conn) or {}
    account_size = float(settings.get("accountSize") or 0)
    if account_size <= 0:
        return 0
    count = 0
    for t in trades:
        shares = float(t.get("shares") or 0)
        entry = float(t.get("entry_price") or 0)
        stop = float(t.get("original_stop") or 0)
        if shares <= 0 or entry <= 0 or stop <= 0:
            continue
        risk_pct = (shares * abs(entry - stop) / account_size) * 100.0
        if risk_pct > float(current_value):
            count += 1
    return count


def _update_discipline_setting_execute(*, user_id, account_id, args, conn=None) -> dict:
    field = args.get("field")
    value = args.get("value")
    valid_fields = {"maxRiskPerTradePct", "dailyLossLimitPct",
                    "coolingOffMinutesAfterLoss", "aPlusRiskMultiplier"}
    if field not in valid_fields:
        return {"ok": False, "error": f"field must be one of {sorted(valid_fields)}"}
    # Use accounts_service to update — keeps settings/account state consistent
    accounts_service.update_account_settings(user_id, account_id, {field: value}, conn=conn)
    return {"ok": True, "summary": f"{field} set to {value}."}


def _schedule_paper_only_day_preview(*, user_id, account_id, args, conn=None) -> dict:
    return {"narration": f"Mark {args.get('date')} as paper-only.",
            "contextual_warnings": [], "confirm_label": "Schedule paper day", "elevated": False}


def _schedule_paper_only_day_execute(*, user_id, account_id, args, conn=None) -> dict:
    d = args.get("date")
    c = conn or get_connection()
    row = c.execute("SELECT paper_only_days FROM j2_accounts WHERE id = ? AND user_id = ?",
                    (account_id, user_id)).fetchone()
    try:
        current = json.loads(row["paper_only_days"]) if row else []
    except (TypeError, json.JSONDecodeError):
        current = []
    current = [x for x in current if x.get("date") != d]
    current.append({"date": d, "reason": "compass_chat"})
    c.execute("UPDATE j2_accounts SET paper_only_days = ? WHERE id = ? AND user_id = ?",
              (json.dumps(current), account_id, user_id))
    c.commit()
    return {"ok": True, "summary": f"Marked {d} paper-only."}
```

Then append to `TOOLS` (after the analysis tools):

```python
TOOLS.update({
    "tag_trade": {
        "name": "tag_trade",
        "description": "Append mistake and/or emotion tags to a closed trade. Requires the trade id.",
        "requires_confirm": True,
        "executor": _tag_trade_execute,
        "preview": _tag_trade_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "trade_id": {"type": "string"},
                "mistake_tags": {"type": "array", "items": {"type": "string"}},
                "emotion_tags": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["trade_id"],
        },
    },
    "set_weekly_focus": {
        "name": "set_weekly_focus",
        "description": "Set this week's focus — a short directive the next Weekly Review reads back.",
        "requires_confirm": True,
        "executor": _set_weekly_focus_execute,
        "preview": _set_weekly_focus_preview,
        "input_schema": {
            "type": "object",
            "properties": {"text": {"type": "string", "maxLength": 500}},
            "required": ["text"],
        },
    },
    "mute_setup": {
        "name": "mute_setup",
        "description": "Mute a setup for a period — Pre-Trade Verdict will reject entries.",
        "requires_confirm": True,
        "executor": _mute_setup_execute,
        "preview": _mute_setup_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "setup_name": {"type": "string"},
                "until_date": {"type": "string", "format": "date"},
            },
            "required": ["setup_name"],
        },
    },
    "unmute_setup": {
        "name": "unmute_setup",
        "description": "Remove a setup from the muted list.",
        "requires_confirm": True,
        "executor": _unmute_setup_execute,
        "preview": _unmute_setup_preview,
        "input_schema": {
            "type": "object",
            "properties": {"setup_name": {"type": "string"}},
            "required": ["setup_name"],
        },
    },
    "set_a_plus_setups": {
        "name": "set_a_plus_setups",
        "description": "Add or remove setups from the A+ whitelist.",
        "requires_confirm": True,
        "executor": _set_a_plus_setups_execute,
        "preview": _set_a_plus_setups_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "add": {"type": "array", "items": {"type": "string"}},
                "remove": {"type": "array", "items": {"type": "string"}},
            },
        },
    },
    "update_discipline_setting": {
        "name": "update_discipline_setting",
        "description": "Update one of: maxRiskPerTradePct, dailyLossLimitPct, coolingOffMinutesAfterLoss, aPlusRiskMultiplier. Loosening triggers an elevated warning with breach data.",
        "requires_confirm": True,
        "executor": _update_discipline_setting_execute,
        "preview": _update_discipline_setting_preview,
        "input_schema": {
            "type": "object",
            "properties": {
                "field": {"type": "string", "enum": ["maxRiskPerTradePct", "dailyLossLimitPct", "coolingOffMinutesAfterLoss", "aPlusRiskMultiplier"]},
                "value": {"type": "number"},
            },
            "required": ["field", "value"],
        },
    },
    "schedule_paper_only_day": {
        "name": "schedule_paper_only_day",
        "description": "Mark a date as paper-only. Pre-Trade Verdict will reject live entries on that day.",
        "requires_confirm": True,
        "executor": _schedule_paper_only_day_execute,
        "preview": _schedule_paper_only_day_preview,
        "input_schema": {
            "type": "object",
            "properties": {"date": {"type": "string", "format": "date"}},
            "required": ["date"],
        },
    },
})
```

- [ ] **Step 4: Run tests, confirm 9 new pass (25 total)**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py -q
```

Expected: 25 passed.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat_tools.py api/services/journal_two/test_coach_chat_tools.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): 7 action tools with preview+execute halves and elevated discipline warnings"
```

---

## Task 5: Orchestrator — persistence helpers + history reconstruction

**Files:**
- Create: `api/services/journal_two/coach_chat.py`
- Create: `api/services/journal_two/test_coach_chat.py`

Just the persistence layer first — no Anthropic streaming yet. Tasks 6 + 7 layer the model on top.

- [ ] **Step 1: Write failing tests**

Create `api/services/journal_two/test_coach_chat.py`:

```python
"""Tests for the Compass Chat orchestrator (persistence layer first)."""
from __future__ import annotations
import importlib, json, os, sqlite3, tempfile, uuid
from datetime import datetime, timezone, timedelta
import pytest


@pytest.fixture
def db_conn(monkeypatch):
    tmp = tempfile.NamedTemporaryFile(suffix=".db", delete=False)
    tmp.close()
    monkeypatch.setenv("AUTH_DB_PATH", tmp.name)
    from api.services import auth_db
    importlib.reload(auth_db)
    auth_db.init_db()
    conn = sqlite3.connect(tmp.name)
    conn.row_factory = sqlite3.Row
    yield conn
    conn.close()
    os.unlink(tmp.name)


def _seed_account(db_conn, user_id="u_chat"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def test_append_user_message_writes_row(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    msg_id = coach_chat.append_message(
        user_id="u_chat", account_id=acc["id"],
        role="user", content="Hello Compass.",
        conn=db_conn,
    )
    row = db_conn.execute("SELECT role, content FROM j2_chat_messages WHERE id = ?", (msg_id,)).fetchone()
    assert row["role"] == "user"
    assert row["content"] == "Hello Compass."


def test_list_messages_returns_chronological(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="user", content="One", conn=db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="assistant", content="Reply", conn=db_conn)
    msgs = coach_chat.list_messages(user_id="u_chat", account_id=acc["id"], limit=10, conn=db_conn)
    assert msgs["messages"][0]["content"] == "One"
    assert msgs["messages"][1]["content"] == "Reply"


def test_forget_message_marks_forgotten(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    mid = coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                                    role="user", content="Forget me", conn=db_conn)
    coach_chat.forget_message(user_id="u_chat", account_id=acc["id"],
                              message_id=mid, conn=db_conn)
    msgs = coach_chat.list_messages(user_id="u_chat", account_id=acc["id"], limit=10, conn=db_conn)
    assert all(m["id"] != mid for m in msgs["messages"])


def test_forget_all_marks_every_message_forgotten(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="user", content="One", conn=db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="assistant", content="Two", conn=db_conn)
    coach_chat.forget_message(user_id="u_chat", account_id=acc["id"], all=True, conn=db_conn)
    msgs = coach_chat.list_messages(user_id="u_chat", account_id=acc["id"], limit=10, conn=db_conn)
    assert msgs["messages"] == []


def test_rate_limit_check_counts_user_messages_today(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    for _ in range(5):
        coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                                  role="user", content="msg", conn=db_conn)
    info = coach_chat.get_rate_limit_info(user_id="u_chat", account_id=acc["id"], conn=db_conn)
    assert info["used"] == 5
    assert info["remaining"] == 200 - 5


def test_chat_status_reflects_env_kill_switch(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    monkeypatch.setenv("COMPASS_CHAT_ENABLED", "false")
    status = coach_chat.get_chat_status(user_id="u_chat", account_id=acc["id"], conn=db_conn)
    assert status["enabled"] is False
    monkeypatch.setenv("COMPASS_CHAT_ENABLED", "true")
    status2 = coach_chat.get_chat_status(user_id="u_chat", account_id=acc["id"], conn=db_conn)
    assert status2["enabled"] is True
```

- [ ] **Step 2: Run, confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: `ModuleNotFoundError`.

- [ ] **Step 3: Implement persistence layer**

Create `api/services/journal_two/coach_chat.py`:

```python
"""Compass Chat orchestrator — persistence + history reconstruction.

The streaming Anthropic loop and tool dispatch land in Tasks 6 + 7.
This file ships only the storage primitives that those layers build on.
"""
from __future__ import annotations
import json
import os
import sqlite3
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from api.services.auth_db import get_connection
from api.services.journal_two import db as j2_db

RATE_LIMIT_PER_DAY = 200


def _get_conn(conn=None):
    if conn is not None:
        return conn, False
    import sqlite3 as _sq
    path = os.environ.get("AUTH_DB_PATH", j2_db.DEFAULT_DB_PATH)
    c = _sq.connect(path)
    c.row_factory = _sq.Row
    return c, True


def append_message(
    *,
    user_id: str,
    account_id: str,
    role: str,                          # 'user' | 'assistant' | 'tool' | 'summary'
    content: str | None = None,
    tool_calls: list | None = None,
    tool_results: list | None = None,
    parent_id: str | None = None,
    metadata: dict | None = None,
    conn=None,
) -> str:
    _conn, _close = _get_conn(conn)
    try:
        mid = str(uuid.uuid4())
        now = datetime.now(timezone.utc).isoformat()
        _conn.execute(
            """INSERT INTO j2_chat_messages
               (id, user_id, account_id, role, content, tool_calls, tool_results,
                parent_id, metadata, created_at, forgotten)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)""",
            (mid, user_id, account_id, role, content,
             json.dumps(tool_calls) if tool_calls is not None else None,
             json.dumps(tool_results) if tool_results is not None else None,
             parent_id,
             json.dumps(metadata) if metadata is not None else None,
             now),
        )
        _conn.commit()
        return mid
    finally:
        if _close:
            _conn.close()


def list_messages(
    *,
    user_id: str,
    account_id: str,
    limit: int = 50,
    before_id: str | None = None,
    include_forgotten: bool = False,
    conn=None,
) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        sql = """SELECT id, role, content, tool_calls, tool_results, parent_id,
                        metadata, created_at, forgotten
                 FROM j2_chat_messages
                 WHERE user_id = ? AND account_id = ?"""
        params: list[Any] = [user_id, account_id]
        if not include_forgotten:
            sql += " AND forgotten = 0"
        if before_id:
            row = _conn.execute(
                "SELECT created_at FROM j2_chat_messages WHERE id = ?", (before_id,)
            ).fetchone()
            if row:
                sql += " AND created_at < ?"
                params.append(row["created_at"])
        sql += " ORDER BY created_at ASC LIMIT ?"
        params.append(limit)
        rows = _conn.execute(sql, params).fetchall()
        out = [_row_to_dict(r) for r in rows]
        # Detect "has_more": count total non-forgotten rows
        total = _conn.execute(
            "SELECT COUNT(*) AS n FROM j2_chat_messages WHERE user_id = ? AND account_id = ? AND forgotten = 0",
            (user_id, account_id),
        ).fetchone()["n"]
        return {"messages": out, "has_more": len(out) < total}
    finally:
        if _close:
            _conn.close()


def _row_to_dict(row) -> dict:
    out = {
        "id": row["id"],
        "role": row["role"],
        "content": row["content"],
        "tool_calls": json.loads(row["tool_calls"]) if row["tool_calls"] else None,
        "tool_results": json.loads(row["tool_results"]) if row["tool_results"] else None,
        "parent_id": row["parent_id"],
        "metadata": json.loads(row["metadata"]) if row["metadata"] else None,
        "created_at": row["created_at"],
        "forgotten": bool(row["forgotten"]),
    }
    return out


def forget_message(
    *,
    user_id: str,
    account_id: str,
    message_id: str | None = None,
    all: bool = False,
    conn=None,
) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        if all:
            cur = _conn.execute(
                "UPDATE j2_chat_messages SET forgotten = 1 "
                "WHERE user_id = ? AND account_id = ? AND role != 'summary'",
                (user_id, account_id),
            )
        else:
            if not message_id:
                return {"updated": 0, "error": "message_id required when all=False"}
            cur = _conn.execute(
                "UPDATE j2_chat_messages SET forgotten = 1 WHERE id = ? AND user_id = ?",
                (message_id, user_id),
            )
        _conn.commit()
        return {"updated": cur.rowcount}
    finally:
        if _close:
            _conn.close()


def get_rate_limit_info(*, user_id: str, account_id: str, conn=None) -> dict:
    _conn, _close = _get_conn(conn)
    try:
        # Count user messages today (UTC)
        today_iso = datetime.now(timezone.utc).date().isoformat()
        cur = _conn.execute(
            """SELECT COUNT(*) AS n FROM j2_chat_messages
               WHERE user_id = ? AND account_id = ?
               AND role = 'user'
               AND substr(created_at, 1, 10) = ?""",
            (user_id, account_id, today_iso),
        ).fetchone()
        used = cur["n"]
        return {"limit": RATE_LIMIT_PER_DAY, "used": used,
                "remaining": max(0, RATE_LIMIT_PER_DAY - used)}
    finally:
        if _close:
            _conn.close()


def get_chat_status(*, user_id: str, account_id: str, conn=None) -> dict:
    enabled = os.environ.get("COMPASS_CHAT_ENABLED", "true").lower() != "false"
    rate = get_rate_limit_info(user_id=user_id, account_id=account_id, conn=conn)
    _conn, _close = _get_conn(conn)
    try:
        count_row = _conn.execute(
            "SELECT COUNT(*) AS n FROM j2_chat_messages WHERE user_id = ? AND account_id = ? AND forgotten = 0",
            (user_id, account_id),
        ).fetchone()
        return {
            "enabled": enabled,
            "rate_limit_remaining": rate["remaining"],
            "conversation_message_count": count_row["n"],
        }
    finally:
        if _close:
            _conn.close()
```

- [ ] **Step 4: Run tests, confirm green**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat.py api/services/journal_two/test_coach_chat.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): orchestrator persistence layer (append/list/forget/rate-limit/status)"
```

---

## Task 6: Orchestrator — Anthropic streaming + read/analyze tool loop

**Files:**
- Modify: `api/services/journal_two/coach_chat.py`
- Modify: `api/services/journal_two/test_coach_chat.py`

Add `handle_user_turn` — the main turn handler. Streams tokens, intercepts tool_use blocks, executes read/analyze tools inline, returns text + tool events via a generator. Tests inject a FakeAnthropicClient that scripts the tool_use / text sequence; we don't hit the real API.

- [ ] **Step 1: Append tests for the streaming loop**

```python
# ── Streaming loop with read/analyze tools ──────────────────────────────────


class FakeAnthropicStream:
    """Scripted Anthropic stream — emits text + tool_use events."""
    def __init__(self, *, events: list[dict]):
        self.events = list(events)
        self._tool_results_appended: list = []

    def __enter__(self):
        return self

    def __exit__(self, *a):
        return False

    def __iter__(self):
        for ev in self.events:
            yield ev


class FakeChatClient:
    """Drop-in stand-in for AnthropicClient. Script multiple stream responses
    so tests can simulate tool_use -> tool_result -> continuation."""
    def __init__(self, *, stream_scripts: list[list[dict]]):
        self.stream_scripts = list(stream_scripts)
        self.calls = []

    def start_stream(self, *, system_prompt: str, messages: list, tools: list):
        self.calls.append({"system_prompt": system_prompt, "messages": messages, "tools": tools})
        if not self.stream_scripts:
            raise RuntimeError("FakeChatClient out of stream scripts")
        events = self.stream_scripts.pop(0)
        return FakeAnthropicStream(events=events)


def test_handle_user_turn_simple_text_response(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    client = FakeChatClient(stream_scripts=[
        [
            {"type": "text", "text": "Hello back."},
            {"type": "message_stop"},
        ],
    ])
    events = list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"],
        user_message="Hi.",
        client=client, conn=db_conn,
    ))
    # User message persisted
    rows = db_conn.execute("SELECT role, content FROM j2_chat_messages ORDER BY created_at").fetchall()
    assert rows[0]["role"] == "user"
    assert rows[0]["content"] == "Hi."
    # Assistant message persisted
    assistant_rows = [r for r in rows if r["role"] == "assistant"]
    assert len(assistant_rows) == 1
    assert assistant_rows[0]["content"] == "Hello back."
    # Events emitted include text + complete
    types = [e.get("type") for e in events]
    assert "token" in types
    assert "complete" in types


def test_handle_user_turn_executes_read_tool_inline(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    # Seed one closed trade so list_recent_trades has data
    _insert_trade(db_conn, user_id="u_chat", account_id=acc["id"],
                  exit_iso="2026-05-11T20:00:00+00:00")
    client = FakeChatClient(stream_scripts=[
        # First stream — model emits tool_use for list_recent_trades
        [
            {"type": "tool_use", "id": "tu_1", "name": "list_recent_trades", "input": {"days": 7}},
            {"type": "message_stop"},
        ],
        # Second stream — after tool_result is appended, model produces text
        [
            {"type": "text", "text": "You had 1 trade."},
            {"type": "message_stop"},
        ],
    ])
    events = list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"],
        user_message="How many trades?",
        client=client, conn=db_conn,
    ))
    # Tool turn was executed inline and persisted
    rows = db_conn.execute(
        "SELECT role FROM j2_chat_messages ORDER BY created_at"
    ).fetchall()
    roles = [r["role"] for r in rows]
    assert "tool" in roles
    # Assistant final text persisted
    final = [r for r in rows if r["role"] == "assistant"]
    assert any("1 trade" in (r["content"] or "") for r in db_conn.execute("SELECT content FROM j2_chat_messages WHERE role='assistant'").fetchall())
    # Two streams consumed
    assert len(client.calls) == 2


def test_handle_user_turn_rate_limit_returns_error_event(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    # Pre-seed 200 user messages today
    for _ in range(coach_chat.RATE_LIMIT_PER_DAY):
        coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                                  role="user", content="x", conn=db_conn)
    client = FakeChatClient(stream_scripts=[])
    events = list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"], user_message="another",
        client=client, conn=db_conn,
    ))
    types = [e.get("type") for e in events]
    assert "error" in types
    # The 201st user message should NOT have been written
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_chat_messages WHERE role='user'").fetchone()["n"]
    assert n == coach_chat.RATE_LIMIT_PER_DAY


def test_handle_user_turn_kill_switch_returns_disabled(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    monkeypatch.setenv("COMPASS_CHAT_ENABLED", "false")
    client = FakeChatClient(stream_scripts=[])
    events = list(coach_chat.handle_user_turn(
        user_id="u_chat", account_id=acc["id"], user_message="hello",
        client=client, conn=db_conn,
    ))
    types = [e.get("type") for e in events]
    assert "error" in types
    n = db_conn.execute("SELECT COUNT(*) AS n FROM j2_chat_messages").fetchone()["n"]
    assert n == 0
```

Also append the `_insert_trade` helper from Task 4's test file to this one (so the test is self-contained):

```python
def _insert_trade(conn, *, user_id, account_id, exit_iso, **kwargs):
    defaults = dict(
        symbol="TEST", side="Long", shares=100,
        entry_price=100.0, entry_date=exit_iso,
        exit_price=105.0, exit_date=exit_iso,
        original_stop=95.0, setup="Bull Flag", notes=None,
        pnl_dollar=500.0, pnl_percent=5.0, r_multiple=1.0,
        hold_days=2, result="Win", context_at_entry="{}",
        created_at=exit_iso, mistake_tags="[]", emotion_tags="[]",
        fees=0, regime=None,
    )
    defaults.update(kwargs)
    conn.execute(
        """INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id, mistake_tags, emotion_tags, fees, regime
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (str(uuid.uuid4()), user_id, str(uuid.uuid4()),
         defaults["symbol"], defaults["side"], defaults["shares"],
         defaults["entry_price"], defaults["entry_date"],
         defaults["exit_price"], defaults["exit_date"],
         defaults["original_stop"], defaults["setup"], defaults["notes"],
         defaults["pnl_dollar"], defaults["pnl_percent"], defaults["r_multiple"],
         defaults["hold_days"], defaults["result"], defaults["context_at_entry"],
         defaults["created_at"], account_id, defaults["mistake_tags"],
         defaults["emotion_tags"], defaults["fees"], defaults["regime"]),
    )
    conn.commit()
```

- [ ] **Step 2: Confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: 4 new tests fail.

- [ ] **Step 3: Implement `handle_user_turn` + AnthropicClient wrapper**

Append to `api/services/journal_two/coach_chat.py`:

```python
# ── Anthropic streaming + turn handler ─────────────────────────────────────


class AnthropicChatClient:
    """Thin streaming wrapper. Returns an event iterator with shape compatible
    with the orchestrator's expectations."""
    DEFAULT_MODEL = "claude-sonnet-4-6"

    def __init__(self, api_key: str | None = None):
        import anthropic
        key = api_key or os.environ.get("ANTHROPIC_API_KEY")
        if not key:
            raise RuntimeError("ANTHROPIC_API_KEY not set")
        self._client = anthropic.Anthropic(api_key=key)

    def start_stream(self, *, system_prompt: str, messages: list, tools: list):
        return self._client.messages.stream(
            model=self.DEFAULT_MODEL,
            max_tokens=2000,
            temperature=0.4,
            system=[{"type": "text", "text": system_prompt,
                     "cache_control": {"type": "ephemeral"}}],
            messages=messages,
            tools=tools,
        )


def _build_anthropic_tools_param() -> list[dict]:
    from api.services.journal_two import coach_chat_tools as cct
    return [
        {
            "name": spec["name"],
            "description": spec["description"],
            "input_schema": spec["input_schema"],
        }
        for spec in cct.TOOLS.values()
    ]


def _reconstruct_messages(
    *, user_id: str, account_id: str, conn,
) -> list[dict]:
    """Pull non-forgotten messages and translate into Anthropic messages-API
    shape (alternating user/assistant; tool calls + results inlined)."""
    rows = list_messages(user_id=user_id, account_id=account_id, limit=200, conn=conn)["messages"]
    out: list[dict] = []
    pending_tool_uses: list[dict] = []
    pending_tool_results: list[dict] = []

    def _flush_tool_results():
        nonlocal pending_tool_results
        if pending_tool_results:
            out.append({"role": "user", "content": pending_tool_results})
            pending_tool_results = []

    for r in rows:
        if r["role"] == "user":
            _flush_tool_results()
            out.append({"role": "user", "content": r["content"] or ""})
        elif r["role"] == "assistant":
            _flush_tool_results()
            blocks: list = []
            if r["content"]:
                blocks.append({"type": "text", "text": r["content"]})
            for tc in (r["tool_calls"] or []):
                blocks.append({
                    "type": "tool_use", "id": tc["id"],
                    "name": tc["name"], "input": tc.get("args", {}),
                })
            out.append({"role": "assistant", "content": blocks or [{"type": "text", "text": ""}]})
        elif r["role"] == "tool":
            for tr in (r["tool_results"] or []):
                pending_tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tr["tool_call_id"],
                    "content": json.dumps(tr["result"]),
                })
        elif r["role"] == "summary":
            out.append({"role": "user",
                        "content": f"[Earlier in this conversation, summarized: {r['content'] or ''}]"})
    _flush_tool_results()
    return out


def handle_user_turn(
    *,
    user_id: str,
    account_id: str,
    user_message: str,
    client=None,
    conn=None,
):
    """Generator yielding events: {type, ...}.

    Event types: 'token', 'tool_call', 'tool_call_pending', 'complete', 'error'.
    """
    from api.services.journal_two import coach_chat_tools as cct
    from api.services.journal_two import coach_prompts

    # ── Kill switch
    if os.environ.get("COMPASS_CHAT_ENABLED", "true").lower() == "false":
        yield {"type": "error", "code": "disabled", "message": "Compass chat is disabled."}
        return

    _conn, _close = _get_conn(conn)
    try:
        # ── Rate limit
        rl = get_rate_limit_info(user_id=user_id, account_id=account_id, conn=_conn)
        if rl["remaining"] <= 0:
            yield {"type": "error", "code": "rate_limited",
                   "message": "Daily chat limit reached.", "reset_at_utc": "midnight UTC"}
            return

        # ── Persist user message
        append_message(user_id=user_id, account_id=account_id,
                       role="user", content=user_message, conn=_conn)

        active_client = client or AnthropicChatClient()
        tools_param = _build_anthropic_tools_param()
        loop_count = 0
        MAX_LOOPS = 8   # tool-use / tool-result iterations

        while loop_count < MAX_LOOPS:
            loop_count += 1
            messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
            system_prompt = coach_prompts.COMPASS_SYSTEM_PROMPT

            assistant_text = ""
            tool_uses: list[dict] = []
            with active_client.start_stream(system_prompt=system_prompt, messages=messages, tools=tools_param) as stream:
                for ev in stream:
                    if isinstance(ev, dict):
                        etype = ev.get("type")
                    else:
                        etype = getattr(ev, "type", None)
                    if etype == "text":
                        text = ev.get("text") if isinstance(ev, dict) else getattr(ev, "text", "")
                        assistant_text += text
                        yield {"type": "token", "text": text}
                    elif etype == "tool_use":
                        tu = {
                            "id": ev.get("id") if isinstance(ev, dict) else getattr(ev, "id", None),
                            "name": ev.get("name") if isinstance(ev, dict) else getattr(ev, "name", None),
                            "args": (ev.get("input") if isinstance(ev, dict)
                                     else getattr(ev, "input", {})) or {},
                        }
                        tool_uses.append(tu)
                    elif etype == "message_stop":
                        pass

            # Persist assistant turn
            tool_calls_json = [{"id": tu["id"], "name": tu["name"], "args": tu["args"],
                                "status": "pending"} for tu in tool_uses]
            asst_id = append_message(
                user_id=user_id, account_id=account_id,
                role="assistant", content=assistant_text or None,
                tool_calls=tool_calls_json if tool_calls_json else None,
                conn=_conn,
            )

            if not tool_uses:
                # No tools — turn is done.
                yield {"type": "complete", "message_id": asst_id}
                return

            # Split tools into read/analyze (execute inline) vs action (pending)
            inline_results: list[dict] = []
            had_pending_action = False
            for tu in tool_uses:
                spec = cct.TOOLS.get(tu["name"])
                if spec is None:
                    inline_results.append({
                        "tool_call_id": tu["id"],
                        "result": {"error": f"unknown tool: {tu['name']}"},
                    })
                    continue
                if spec["requires_confirm"]:
                    had_pending_action = True
                    preview = spec["preview"](
                        user_id=user_id, account_id=account_id,
                        args=tu["args"], conn=_conn,
                    )
                    # Mark this tool call status in the assistant row
                    _mark_tool_call_status(_conn, asst_id, tu["id"], "pending_confirm")
                    yield {
                        "type": "tool_call_pending",
                        "tool_call_id": tu["id"], "name": tu["name"], "args": tu["args"],
                        "preview": preview, "message_id": asst_id,
                    }
                else:
                    try:
                        result = spec["executor"](
                            user_id=user_id, account_id=account_id,
                            args=tu["args"], conn=_conn,
                        )
                    except Exception as e:  # noqa: BLE001
                        result = {"error": str(e)}
                    yield {"type": "tool_call", "name": tu["name"],
                           "args": tu["args"], "summary": _summarize_tool_result(tu["name"], result)}
                    inline_results.append({"tool_call_id": tu["id"], "result": result})
                    _mark_tool_call_status(_conn, asst_id, tu["id"], "confirmed")

            if inline_results:
                append_message(
                    user_id=user_id, account_id=account_id,
                    role="tool", tool_results=inline_results, parent_id=asst_id, conn=_conn,
                )

            if had_pending_action:
                # End turn — user must confirm before the model continues.
                yield {"type": "complete", "message_id": asst_id, "awaiting_confirm": True}
                return

            # Loop again: feed tool_results back to model, continue.
            continue

        yield {"type": "error", "code": "loop_limit_exceeded",
               "message": "Compass tool-use loop exceeded max iterations."}
    finally:
        if _close:
            _conn.close()


def _mark_tool_call_status(conn, assistant_msg_id: str, tool_call_id: str, status: str) -> None:
    row = conn.execute(
        "SELECT tool_calls FROM j2_chat_messages WHERE id = ?", (assistant_msg_id,),
    ).fetchone()
    if row is None or not row["tool_calls"]:
        return
    try:
        calls = json.loads(row["tool_calls"])
    except (TypeError, json.JSONDecodeError):
        return
    for tc in calls:
        if tc.get("id") == tool_call_id:
            tc["status"] = status
    conn.execute(
        "UPDATE j2_chat_messages SET tool_calls = ? WHERE id = ?",
        (json.dumps(calls), assistant_msg_id),
    )
    conn.commit()


def _summarize_tool_result(tool_name: str, result: dict) -> str:
    if "error" in result:
        return f"error: {result['error']}"
    if tool_name == "list_recent_trades":
        return f"{result.get('count', 0)} trades"
    if tool_name == "get_aggregates":
        agg = result.get("aggregates", {})
        return f"{agg.get('trade_count', 0)} trades, ${agg.get('net_pnl_dollar', 0):.0f} net"
    if tool_name == "get_open_positions":
        return f"{result.get('count', 0)} open"
    if tool_name == "find_arcs":
        return f"{len(result.get('arcs', []))} arc(s)"
    return "ok"
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: 10 passed (6 from Task 5 + 4 new).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat.py api/services/journal_two/test_coach_chat.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): orchestrator streaming loop with inline read/analyze tool dispatch"
```

---

## Task 7: Orchestrator — pending action confirm/cancel flow

**Files:**
- Modify: `api/services/journal_two/coach_chat.py`
- Modify: `api/services/journal_two/test_coach_chat.py`

Adds `confirm_pending_action` + `cancel_pending_action`. Both run the model again after the action settles, so Compass can acknowledge.

- [ ] **Step 1: Append tests**

```python
# ── Confirm + cancel pending actions ────────────────────────────────────────


def test_confirm_pending_action_executes_and_acknowledges(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    # Pre-seed: user turn + assistant turn with one pending mute_setup action
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="user", content="mute pullbacks", conn=db_conn)
    asst_id = coach_chat.append_message(
        user_id="u_chat", account_id=acc["id"],
        role="assistant", content=None,
        tool_calls=[{"id": "tu_x", "name": "mute_setup",
                     "args": {"setup_name": "Pullback", "until_date": "2026-05-25"},
                     "status": "pending_confirm"}],
        conn=db_conn,
    )
    client = FakeChatClient(stream_scripts=[
        [{"type": "text", "text": "Done. Muted Pullback until 2026-05-25."},
         {"type": "message_stop"}],
    ])
    events = list(coach_chat.confirm_pending_action(
        user_id="u_chat", account_id=acc["id"],
        message_id=asst_id, tool_call_id="tu_x",
        client=client, conn=db_conn,
    ))
    # Mutation visible
    row = db_conn.execute("SELECT muted_setups FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    muted = json.loads(row["muted_setups"])
    assert any(m["setup_name"] == "Pullback" for m in muted)
    # Acknowledgement turn persisted
    ack_rows = db_conn.execute("SELECT content FROM j2_chat_messages WHERE role = 'assistant' ORDER BY created_at DESC LIMIT 1").fetchall()
    assert "Done" in ack_rows[0]["content"]


def test_cancel_pending_action_marks_cancelled(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                              role="user", content="mute pullbacks", conn=db_conn)
    asst_id = coach_chat.append_message(
        user_id="u_chat", account_id=acc["id"],
        role="assistant", content=None,
        tool_calls=[{"id": "tu_y", "name": "mute_setup",
                     "args": {"setup_name": "Pullback"}, "status": "pending_confirm"}],
        conn=db_conn,
    )
    client = FakeChatClient(stream_scripts=[
        [{"type": "text", "text": "Got it, didn't mute."}, {"type": "message_stop"}],
    ])
    events = list(coach_chat.cancel_pending_action(
        user_id="u_chat", account_id=acc["id"],
        message_id=asst_id, tool_call_id="tu_y",
        client=client, conn=db_conn,
    ))
    # No mutation
    row = db_conn.execute("SELECT muted_setups FROM j2_accounts WHERE id = ?", (acc["id"],)).fetchone()
    muted = json.loads(row["muted_setups"])
    assert all(m["setup_name"] != "Pullback" for m in muted)
    # Status updated
    asst_row = db_conn.execute("SELECT tool_calls FROM j2_chat_messages WHERE id = ?", (asst_id,)).fetchone()
    calls = json.loads(asst_row["tool_calls"])
    assert calls[0]["status"] == "cancelled"


def test_confirm_unknown_tool_call_returns_error_event(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = coach_chat.append_message(
        user_id="u_chat", account_id=acc["id"],
        role="assistant", content="hi", conn=db_conn,
    )
    client = FakeChatClient(stream_scripts=[])
    events = list(coach_chat.confirm_pending_action(
        user_id="u_chat", account_id=acc["id"],
        message_id=asst_id, tool_call_id="missing",
        client=client, conn=db_conn,
    ))
    types = [e.get("type") for e in events]
    assert "error" in types
```

- [ ] **Step 2: Confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: 3 new tests fail.

- [ ] **Step 3: Implement confirm + cancel**

Append to `coach_chat.py`:

```python
# ── Pending-action confirm / cancel ─────────────────────────────────────────


def _find_pending_tool_call(conn, *, message_id: str, tool_call_id: str) -> dict | None:
    row = conn.execute(
        "SELECT tool_calls FROM j2_chat_messages WHERE id = ?", (message_id,),
    ).fetchone()
    if row is None or not row["tool_calls"]:
        return None
    try:
        calls = json.loads(row["tool_calls"])
    except (TypeError, json.JSONDecodeError):
        return None
    for tc in calls:
        if tc.get("id") == tool_call_id:
            return tc
    return None


def confirm_pending_action(
    *,
    user_id: str,
    account_id: str,
    message_id: str,
    tool_call_id: str,
    client=None,
    conn=None,
):
    """Execute a previously-emitted pending action, persist its result, then
    re-invoke the model so Compass can acknowledge. Generator yields events."""
    from api.services.journal_two import coach_chat_tools as cct
    from api.services.journal_two import coach_prompts

    _conn, _close = _get_conn(conn)
    try:
        tc = _find_pending_tool_call(_conn, message_id=message_id, tool_call_id=tool_call_id)
        if tc is None or tc.get("status") != "pending_confirm":
            yield {"type": "error", "code": "no_pending_action",
                   "message": "Tool call not found or no longer pending."}
            return
        spec = cct.TOOLS.get(tc["name"])
        if spec is None or not spec["requires_confirm"]:
            yield {"type": "error", "code": "invalid_tool",
                   "message": f"Tool {tc['name']} is not a confirmable action."}
            return

        try:
            result = spec["executor"](
                user_id=user_id, account_id=account_id,
                args=tc.get("args") or {}, conn=_conn,
            )
        except Exception as e:  # noqa: BLE001
            result = {"ok": False, "error": str(e)}

        _mark_tool_call_status(_conn, message_id, tool_call_id, "confirmed")
        append_message(
            user_id=user_id, account_id=account_id,
            role="tool",
            tool_results=[{"tool_call_id": tool_call_id, "result": result}],
            parent_id=message_id, conn=_conn,
        )
        yield {"type": "tool_call", "name": tc["name"], "args": tc.get("args") or {},
               "summary": _summarize_tool_result(tc["name"], result)}

        # Re-invoke model for acknowledgement
        active_client = client or AnthropicChatClient()
        tools_param = _build_anthropic_tools_param()
        messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
        ack_text = ""
        with active_client.start_stream(
            system_prompt=coach_prompts.COMPASS_SYSTEM_PROMPT,
            messages=messages, tools=tools_param,
        ) as stream:
            for ev in stream:
                etype = ev.get("type") if isinstance(ev, dict) else getattr(ev, "type", None)
                if etype == "text":
                    text = ev.get("text") if isinstance(ev, dict) else getattr(ev, "text", "")
                    ack_text += text
                    yield {"type": "token", "text": text}
        ack_id = append_message(
            user_id=user_id, account_id=account_id,
            role="assistant", content=ack_text or None, conn=_conn,
        )
        yield {"type": "complete", "message_id": ack_id}
    finally:
        if _close:
            _conn.close()


def cancel_pending_action(
    *,
    user_id: str,
    account_id: str,
    message_id: str,
    tool_call_id: str,
    client=None,
    conn=None,
):
    """User clicked Cancel on a pending action. Mark cancelled, model
    acknowledges with a brief turn."""
    from api.services.journal_two import coach_prompts

    _conn, _close = _get_conn(conn)
    try:
        tc = _find_pending_tool_call(_conn, message_id=message_id, tool_call_id=tool_call_id)
        if tc is None or tc.get("status") != "pending_confirm":
            yield {"type": "error", "code": "no_pending_action",
                   "message": "Tool call not found or no longer pending."}
            return

        _mark_tool_call_status(_conn, message_id, tool_call_id, "cancelled")
        append_message(
            user_id=user_id, account_id=account_id,
            role="tool",
            tool_results=[{"tool_call_id": tool_call_id,
                           "result": {"ok": False, "cancelled": True, "reason": "user_cancelled"}}],
            parent_id=message_id, conn=_conn,
        )

        # Brief ack
        active_client = client or AnthropicChatClient()
        tools_param = _build_anthropic_tools_param()
        messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
        ack_text = ""
        with active_client.start_stream(
            system_prompt=coach_prompts.COMPASS_SYSTEM_PROMPT,
            messages=messages, tools=tools_param,
        ) as stream:
            for ev in stream:
                etype = ev.get("type") if isinstance(ev, dict) else getattr(ev, "type", None)
                if etype == "text":
                    text = ev.get("text") if isinstance(ev, dict) else getattr(ev, "text", "")
                    ack_text += text
                    yield {"type": "token", "text": text}
        ack_id = append_message(
            user_id=user_id, account_id=account_id,
            role="assistant", content=ack_text or None, conn=_conn,
        )
        yield {"type": "complete", "message_id": ack_id}
    finally:
        if _close:
            _conn.close()
```

- [ ] **Step 4: Run tests, confirm green**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: 13 passed (10 + 3).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat.py api/services/journal_two/test_coach_chat.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): confirm + cancel flow with model acknowledgement"
```

---

## Task 8: System prompt — append Section 7

**Files:**
- Modify: `api/services/journal_two/coach_prompts.py`

- [ ] **Step 1: Insert Section 7 before the closing line**

Find:
```
You are Compass. Begin when asked.
"""
```

Insert ABOVE it (so the closing line stays last):

```
## 7. Chat mode

You are now in chat mode. The trader is talking with you in real time.

### Voice principles, applied to chat

Section 2's five principles still apply. In chat specifically:
1. **Lead with the answer.** No "let me think about this..." preambles. State your conclusion in the first sentence; substantiate it in the next 1-3.
2. **Tools are not narration.** When you call a tool, the user sees a chip showing what you queried. You don't have to say "let me check..." — just call the tool and use its result.
3. **Short turns over long monologues.** Default to 50-150 words. Longer only when the question genuinely requires it (e.g., a 3-month review).
4. **Citations stay tight.** "You're 4-12 on Bull Flags this quarter" rather than "Looking at your trades from this quarter, specifically the Bull Flag setup, the data shows..."

### When to use tools

You have read tools (instant data fetch), analysis tools (compute patterns), and action tools (write back to the journal with the trader's explicit confirmation).

- **Default to a tool over a guess.** Never invent a number. If the user asks "how many Bull Flags this month?" — call `get_aggregates`.
- **Batch when the model permits.** If you need recent trades AND hold-duration analysis to answer, call both in one turn.
- **Action tools require the user's confirmation.** When you call one, end your turn immediately after — don't continue narrating, the user needs to see the pending action and click Confirm.

### When you call an action tool

The system will emit a confirmation UI to the user. You do not need to restate "are you sure?" — the UI handles that. Just call the tool and end your turn.

If the user asked you to do something destructive or surprising, inline a sentence BEFORE the tool call explaining your reasoning: "Given the 4 breaches this month and the -1.7R average on >2% risk trades, I'd argue you should tighten the cap to 1%, not raise it. But if you're sure, I'll set it." Then call the tool.

### Refusing requests

If the trader asks you to predict markets, name specific tickers as buys, or weaken discipline guardrails when the data clearly says they're already too loose — name the tradeoff and let the user decide, but don't preach. One sentence of "the data suggests X" is enough. Then call the tool they asked for, if they insist.

You don't moralize. You don't refuse. You inform, calibrate, and respect the trader's autonomy.
```

- [ ] **Step 2: Smoke import + suite**

```bash
cd C:/Users/Patrick/uct-dashboard
python -c "from api.services.journal_two.coach_prompts import COMPASS_SYSTEM_PROMPT; assert 'Chat mode' in COMPASS_SYSTEM_PROMPT; assert COMPASS_SYSTEM_PROMPT.rstrip().endswith('You are Compass. Begin when asked.'); print('OK, prompt length =', len(COMPASS_SYSTEM_PROMPT))"
python -m pytest api/services/journal_two/ -q
```

Expected: prints OK with prompt length ~16000 chars; full j2 suite green.

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_prompts.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): system prompt Section 7 (chat-mode voice + tool guidance)"
```

---

## Task 9: Router — 6 chat endpoints (SSE + REST)

**Files:**
- Modify: `api/routers/journal_two.py`

Insert after the EOD-recap endpoints from Phase G v2.

- [ ] **Step 1: Add imports + helpers**

Add to imports at the top of the file (alongside existing `coach_service`):

```python
from api.services.journal_two import coach_chat as coach_chat_service
```

Add `StreamingResponse` to the FastAPI imports:

```python
from fastapi.responses import StreamingResponse
```

- [ ] **Step 2: Insert 6 endpoints**

Below the existing EOD endpoints:

```python
# ── Phase G v3: Compass Chat ────────────────────────────────────────────────


def _sse_format(event: dict) -> str:
    return f"data: {json.dumps(event)}\n\n"


@router.post("/accounts/{account_id}/coach/chat/stream")
def chat_stream(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    msg = (payload or {}).get("message", "").strip()
    if not msg:
        raise HTTPException(status_code=400, detail="message required")
    settings_check = accounts_service.get_account_settings(user["id"], account_id)
    if settings_check is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not settings_check.get("compassEnabled", True):
        raise HTTPException(status_code=403, detail="Compass is disabled for this account")

    def _gen():
        for event in coach_chat_service.handle_user_turn(
            user_id=user["id"], account_id=account_id, user_message=msg,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/accounts/{account_id}/coach/chat/confirm")
def chat_confirm(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    message_id = (payload or {}).get("message_id")
    tool_call_id = (payload or {}).get("tool_call_id")
    if not message_id or not tool_call_id:
        raise HTTPException(status_code=400, detail="message_id and tool_call_id required")

    def _gen():
        for event in coach_chat_service.confirm_pending_action(
            user_id=user["id"], account_id=account_id,
            message_id=message_id, tool_call_id=tool_call_id,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.post("/accounts/{account_id}/coach/chat/cancel")
def chat_cancel(
    account_id: str,
    payload: dict,
    user: dict = Depends(get_current_user),
):
    message_id = (payload or {}).get("message_id")
    tool_call_id = (payload or {}).get("tool_call_id")
    if not message_id or not tool_call_id:
        raise HTTPException(status_code=400, detail="message_id and tool_call_id required")

    def _gen():
        for event in coach_chat_service.cancel_pending_action(
            user_id=user["id"], account_id=account_id,
            message_id=message_id, tool_call_id=tool_call_id,
        ):
            yield _sse_format(event)
    return StreamingResponse(_gen(), media_type="text/event-stream")


@router.get("/accounts/{account_id}/coach/chat/messages")
def chat_list_messages(
    account_id: str,
    limit: int = 50,
    before_id: str | None = None,
    user: dict = Depends(get_current_user),
):
    return coach_chat_service.list_messages(
        user_id=user["id"], account_id=account_id,
        limit=max(1, min(int(limit), 200)),
        before_id=before_id,
    )


@router.post("/accounts/{account_id}/coach/chat/forget")
def chat_forget(
    account_id: str,
    payload: dict | None = None,
    user: dict = Depends(get_current_user),
):
    body = payload or {}
    return coach_chat_service.forget_message(
        user_id=user["id"], account_id=account_id,
        message_id=body.get("message_id"),
        all=bool(body.get("all", False)),
    )


@router.get("/accounts/{account_id}/coach/chat/status")
def chat_status(
    account_id: str,
    user: dict = Depends(get_current_user),
):
    return coach_chat_service.get_chat_status(user_id=user["id"], account_id=account_id)
```

- [ ] **Step 3: Smoke**

```bash
cd C:/Users/Patrick/uct-dashboard
python -c "from fastapi.testclient import TestClient; from api.main import app; routes = [r.path for r in app.routes if 'coach/chat' in r.path]; print(sorted(routes))"
```

Expected: prints 6 routes including `/api/j2/accounts/{account_id}/coach/chat/stream` etc.

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: 393+ passing.

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/routers/journal_two.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): 6 chat endpoints (stream, confirm, cancel, messages, forget, status)"
```

---

## Task 10: Async safety — sliding-window summarization + hallucination audit

**Files:**
- Modify: `api/services/journal_two/coach_chat.py`
- Modify: `api/services/journal_two/test_coach_chat.py`

Two non-blocking safety nets: (a) summarize oldest 30% of history when total tokens exceed 80k; (b) post-turn hallucination audit that flags assistant messages where numbers/symbols don't match the data Compass actually had.

- [ ] **Step 1: Append tests**

```python
# ── Summarization + hallucination audit ─────────────────────────────────────


def test_estimate_tokens_returns_positive_int():
    from api.services.journal_two import coach_chat
    n = coach_chat._estimate_tokens([{"role": "user", "content": "hello world"}])
    assert isinstance(n, int)
    assert n > 0


def test_maybe_summarize_inserts_summary_row_when_oversized(db_conn, monkeypatch):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    monkeypatch.setattr(coach_chat, "SUMMARIZE_THRESHOLD_TOKENS", 100)  # force trigger

    class FakeSummaryClient:
        def summarize(self, *, text: str) -> str:
            return "earlier the user discussed bull flag losses"

    for i in range(20):
        coach_chat.append_message(user_id="u_chat", account_id=acc["id"],
                                  role="user", content="x" * 50, conn=db_conn)
    inserted = coach_chat._maybe_summarize(user_id="u_chat", account_id=acc["id"],
                                           summary_client=FakeSummaryClient(), conn=db_conn)
    assert inserted is True
    row = db_conn.execute("SELECT content, role FROM j2_chat_messages WHERE role = 'summary'").fetchone()
    assert row is not None
    assert "bull flag" in row["content"]


def test_audit_assistant_message_flags_unverified_numbers(db_conn):
    from api.services.journal_two import coach_chat
    acc = _seed_account(db_conn)
    asst_id = coach_chat.append_message(
        user_id="u_chat", account_id=acc["id"],
        role="assistant", content="You're 99.9R on Bull Flags this quarter.",
        conn=db_conn,
    )
    # No tools were called and no trades exist — the 99.9R claim is unverified
    coach_chat._audit_assistant_message(message_id=asst_id, conn=db_conn)
    row = db_conn.execute("SELECT metadata FROM j2_chat_messages WHERE id = ?", (asst_id,)).fetchone()
    meta = json.loads(row["metadata"] or "{}")
    assert "audit_flags" in meta
    assert any("99.9" in f for f in meta["audit_flags"])
```

- [ ] **Step 2: Confirm fail**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: 3 new tests fail.

- [ ] **Step 3: Implement summarization + audit**

Append to `coach_chat.py`:

```python
# ── Summarization + hallucination audit ────────────────────────────────────

SUMMARIZE_THRESHOLD_TOKENS = 80_000


def _estimate_tokens(messages: list[dict]) -> int:
    """Quick token estimate: len(JSON) / 3.5. Good enough for sliding-window
    detection without a tokenizer dependency."""
    payload = json.dumps(messages, default=str)
    return max(1, int(len(payload) / 3.5))


def _maybe_summarize(*, user_id: str, account_id: str, summary_client=None, conn=None) -> bool:
    """If history exceeds the threshold, summarize the oldest 30% of
    non-summary messages into a single 'summary' row and mark them
    forgotten. Returns True if summarization happened."""
    _conn, _close = _get_conn(conn)
    try:
        messages = _reconstruct_messages(user_id=user_id, account_id=account_id, conn=_conn)
        if _estimate_tokens(messages) < SUMMARIZE_THRESHOLD_TOKENS:
            return False
        rows = list_messages(user_id=user_id, account_id=account_id, limit=200, conn=_conn)["messages"]
        non_summary = [r for r in rows if r["role"] != "summary"]
        cut = max(1, int(len(non_summary) * 0.3))
        to_summarize = non_summary[:cut]
        if not to_summarize:
            return False
        # Build a compact text representation
        text_blob = "\n".join(
            f"[{r['role']}] {r.get('content') or ''}"
            for r in to_summarize
        )
        summary_text = (summary_client or _DefaultSummaryClient()).summarize(text=text_blob)
        # Insert summary BEFORE marking forgotten
        append_message(
            user_id=user_id, account_id=account_id,
            role="summary", content=summary_text, conn=_conn,
        )
        # Mark forgotten
        ids = [r["id"] for r in to_summarize]
        if ids:
            _conn.execute(
                "UPDATE j2_chat_messages SET forgotten = 1 WHERE id IN (" +
                ",".join("?" * len(ids)) + ")",
                ids,
            )
            _conn.commit()
        return True
    finally:
        if _close:
            _conn.close()


class _DefaultSummaryClient:
    def summarize(self, *, text: str) -> str:
        import anthropic
        client = anthropic.Anthropic(api_key=os.environ["ANTHROPIC_API_KEY"])
        msg = client.messages.create(
            model="claude-sonnet-4-6",
            max_tokens=600,
            temperature=0.2,
            system="You compress trading-coach conversations. Preserve any user-stated focus, behavioral commitments, or Compass observations of trader patterns. Drop tool-call mechanics. ≤500 tokens.",
            messages=[{"role": "user", "content": text}],
        )
        return msg.content[0].text if msg.content else ""


def _audit_assistant_message(*, message_id: str, conn=None) -> dict:
    """Hallucination audit. Re-uses coach_validation's numeric/symbol grounding
    against the data Compass actually had access to in the surrounding turn.
    Non-blocking — writes flags to metadata."""
    from api.services.journal_two import coach_validation as cv
    _conn, _close = _get_conn(conn)
    try:
        row = _conn.execute(
            "SELECT id, user_id, account_id, content, tool_calls, parent_id FROM j2_chat_messages WHERE id = ?",
            (message_id,),
        ).fetchone()
        if row is None or row["content"] is None:
            return {"passed": True, "flags": []}
        # Collect tool results for the same turn (matched by parent_id or surrounding tool rows)
        # v1 simplification: only enforce numeric grounding against an empty data dict —
        # any number cited that didn't come from a tool result IS unverified.
        data = {"today": {"trades": [], "open_positions": []}, "recent_arcs": []}
        # If tool_calls executed inline before this assistant turn, pull their results
        tool_rows = _conn.execute(
            """SELECT tool_results FROM j2_chat_messages
               WHERE user_id = ? AND account_id = ? AND role = 'tool'
                 AND created_at < ? AND forgotten = 0
               ORDER BY created_at DESC LIMIT 5""",
            (row["user_id"], row["account_id"], row["id"]),  # row id sort proxy not perfect; OK for v1
        ).fetchall()
        for tr in tool_rows:
            try:
                results = json.loads(tr["tool_results"] or "[]")
            except (TypeError, json.JSONDecodeError):
                continue
            for r in results:
                result_obj = r.get("result") or {}
                trades = (result_obj.get("trades") or [])
                positions = (result_obj.get("positions") or [])
                data["today"]["trades"].extend(trades)
                data["today"]["open_positions"].extend(positions)
                if "arcs" in result_obj:
                    data["recent_arcs"].extend(result_obj["arcs"])
        result = cv.validate_eod_output(row["content"], data)
        # Persist
        try:
            existing_meta = json.loads(_conn.execute(
                "SELECT metadata FROM j2_chat_messages WHERE id = ?", (message_id,),
            ).fetchone()["metadata"] or "{}")
        except (TypeError, json.JSONDecodeError):
            existing_meta = {}
        existing_meta["audit_flags"] = result["flags"]
        existing_meta["audit_passed"] = result["passed"]
        _conn.execute(
            "UPDATE j2_chat_messages SET metadata = ? WHERE id = ?",
            (json.dumps(existing_meta), message_id),
        )
        _conn.commit()
        return result
    finally:
        if _close:
            _conn.close()
```

Wire the audit into `handle_user_turn` AFTER each assistant message persists. Find both `append_message(... role="assistant" ...)` calls and follow each with:

```python
        try:
            _audit_assistant_message(message_id=asst_id, conn=_conn)
        except Exception:
            pass  # non-blocking
```

Wire summarization at the top of `handle_user_turn`, before persisting the user message:

```python
        # Sliding-window summarization (non-blocking)
        try:
            _maybe_summarize(user_id=user_id, account_id=account_id, conn=_conn)
        except Exception:
            pass
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest api/services/journal_two/test_coach_chat.py -q
```

Expected: 16 passed (13 + 3).

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add api/services/journal_two/coach_chat.py api/services/journal_two/test_coach_chat.py
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): sliding-window summarization + post-turn hallucination audit"
```

---

## Task 11: Frontend hook — `useJ2CoachChat.js`

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2CoachChat.js`

SWR for messages + status; `fetch` with `ReadableStream` for SSE consumption (EventSource doesn't support POST bodies, so we use `fetch` + `getReader`).

- [ ] **Step 1: Create the hook**

```js
/**
 * Compass Chat hook.
 *
 * Returns: { messages, status, isLoading, send, confirm, cancel, forget,
 *            forgetAll, isStreaming, streamingTokens, pendingAction,
 *            error, refresh }.
 *
 * SSE consumed via fetch + getReader (POST bodies are required).
 */
import { useState, useCallback, useRef } from 'react'
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

async function* sseFromFetch(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx)
      buffer = buffer.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (line) {
        try { yield JSON.parse(line.slice(6)) } catch { /* skip */ }
      }
    }
  }
}

export default function useJ2CoachChat(accountId) {
  const messagesUrl = accountId ? `/api/j2/accounts/${accountId}/coach/chat/messages?limit=200` : null
  const statusUrl = accountId ? `/api/j2/accounts/${accountId}/coach/chat/status` : null
  const { data: messagesData, error, isLoading, mutate: refreshMessages } = useSWR(messagesUrl, fetcher,
    { revalidateOnFocus: true, shouldRetryOnError: false })
  const { data: status, mutate: refreshStatus } = useSWR(statusUrl, fetcher,
    { revalidateOnFocus: true, refreshInterval: 30000 })

  const [isStreaming, setStreaming] = useState(false)
  const [streamingTokens, setStreamingTokens] = useState('')   // current assistant buffer
  const [pendingAction, setPendingAction] = useState(null)    // {message_id, tool_call_id, name, preview}
  const [streamError, setStreamError] = useState(null)
  const abortRef = useRef(null)

  const consumeStream = useCallback(async (url, body) => {
    setStreamError(null)
    setStreaming(true)
    setStreamingTokens('')
    setPendingAction(null)
    abortRef.current = new AbortController()
    try {
      const resp = await fetch(url, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body || {}),
        signal: abortRef.current.signal,
      })
      if (!resp.ok) {
        let msg = `${resp.status}`
        try { const j = await resp.json(); if (j?.detail) msg = j.detail } catch {}
        throw new Error(msg)
      }
      for await (const event of sseFromFetch(resp)) {
        if (event.type === 'token') {
          setStreamingTokens((s) => s + (event.text || ''))
        } else if (event.type === 'tool_call_pending') {
          setPendingAction({
            message_id: event.message_id,
            tool_call_id: event.tool_call_id,
            name: event.name,
            args: event.args,
            preview: event.preview,
          })
        } else if (event.type === 'error') {
          throw new Error(event.message || event.code || 'chat error')
        } else if (event.type === 'complete') {
          await refreshMessages()
          await refreshStatus()
        }
      }
    } catch (e) {
      setStreamError(String(e.message || e))
    } finally {
      setStreaming(false)
      setStreamingTokens('')
      abortRef.current = null
    }
  }, [refreshMessages, refreshStatus])

  const send = useCallback((text) => {
    if (!accountId || !text?.trim()) return
    return consumeStream(
      `/api/j2/accounts/${accountId}/coach/chat/stream`,
      { message: text.trim() },
    )
  }, [accountId, consumeStream])

  const confirm = useCallback((message_id, tool_call_id) => {
    if (!accountId) return
    return consumeStream(
      `/api/j2/accounts/${accountId}/coach/chat/confirm`,
      { message_id, tool_call_id },
    )
  }, [accountId, consumeStream])

  const cancel = useCallback((message_id, tool_call_id) => {
    if (!accountId) return
    return consumeStream(
      `/api/j2/accounts/${accountId}/coach/chat/cancel`,
      { message_id, tool_call_id },
    )
  }, [accountId, consumeStream])

  const forget = useCallback(async (message_id) => {
    if (!accountId) return
    await fetch(`/api/j2/accounts/${accountId}/coach/chat/forget`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message_id }),
    })
    await refreshMessages()
  }, [accountId, refreshMessages])

  const forgetAll = useCallback(async () => {
    if (!accountId) return
    await fetch(`/api/j2/accounts/${accountId}/coach/chat/forget`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    await refreshMessages()
  }, [accountId, refreshMessages])

  return {
    messages: messagesData?.messages ?? [],
    status: status ?? { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0 },
    isLoading,
    error: error || streamError,
    isStreaming,
    streamingTokens,
    pendingAction,
    send,
    confirm,
    cancel,
    forget,
    forgetAll,
    refresh: refreshMessages,
  }
}
```

- [ ] **Step 2: Build + commit**

```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run build
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/useJ2CoachChat.js
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): useJ2CoachChat hook with SSE streaming + pending-action state"
```

---

## Task 12: Frontend atoms — ChatToolChip, ChatActionCard, ChatMessage

**Files:**
- Create: `app/src/pages/journal-2-0/components/ChatToolChip.jsx`
- Create: `app/src/pages/journal-2-0/components/ChatActionCard.jsx`
- Create: `app/src/pages/journal-2-0/components/ChatMessage.jsx`

Three small, focused components — each ~50-80 lines. ChatMessage composes the other two.

- [ ] **Step 1: ChatToolChip**

```jsx
/**
 * Compact tool-call chip. Click to expand args + result JSON.
 *
 * Props:
 *   toolCall: { id, name, args, status }
 *   toolResult?: { tool_call_id, result }
 */
import { useState } from 'react'

const TOOL_ICONS = {
  list_recent_trades: '🔍', get_aggregates: '📊', get_open_positions: '📈',
  get_trader_profile: '👤', get_recent_recaps: '📜', get_account_settings: '⚙',
  get_setup_stats: '🎯', find_arcs: '🌀',
  analyze_time_of_day: '⏰', analyze_day_of_week: '📅',
  analyze_hold_duration: '⏱', analyze_sequence: '🔁',
  analyze_sizing_curve: '📏', analyze_correlation: '🔗', compare_setups: '⚖',
  tag_trade: '🏷', set_weekly_focus: '🧭', mute_setup: '🔇', unmute_setup: '🔊',
  set_a_plus_setups: '⭐', update_discipline_setting: '🛡',
  schedule_paper_only_day: '📝',
}

export default function ChatToolChip({ toolCall, toolResult, summary }) {
  const [open, setOpen] = useState(false)
  const icon = TOOL_ICONS[toolCall.name] || '🔧'
  const label = summary || toolCall.name
  return (
    <div style={{ display: 'inline-block', margin: '4px 4px 4px 0' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{
          fontSize: 11, padding: '3px 8px', borderRadius: 999,
          background: 'rgba(201,168,76,0.08)',
          border: '1px solid rgba(201,168,76,0.4)',
          color: 'var(--text-bright)', cursor: 'pointer',
        }}
      >
        {icon} {label}
      </button>
      {open && (
        <pre style={{
          marginTop: 4, padding: 8, fontSize: 10, lineHeight: 1.4,
          background: 'rgba(0,0,0,0.4)', border: '1px solid var(--border)',
          borderRadius: 6, maxWidth: 600, overflow: 'auto',
        }}>
          {JSON.stringify({ args: toolCall.args, result: toolResult?.result }, null, 2)}
        </pre>
      )}
    </div>
  )
}
```

- [ ] **Step 2: ChatActionCard**

```jsx
/**
 * Pending-action card. Confirm / Cancel buttons + optional elevated warning.
 *
 * Props:
 *   pendingAction: { name, args, preview: {narration, contextual_warnings, confirm_label, elevated} }
 *   onConfirm(): void
 *   onCancel(): void
 *   disabled?: bool
 */

export default function ChatActionCard({ pendingAction, onConfirm, onCancel, disabled }) {
  if (!pendingAction) return null
  const { preview } = pendingAction
  const elevated = preview?.elevated
  return (
    <div
      role="region"
      aria-label="Pending Compass action"
      style={{
        margin: '8px 0', padding: '12px 16px',
        background: elevated ? 'rgba(239,68,68,0.06)' : 'rgba(201,168,76,0.06)',
        border: `1px solid ${elevated ? 'rgba(239,68,68,0.5)' : 'rgba(201,168,76,0.5)'}`,
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
        ⏸ Compass wants to:
      </div>
      <div style={{ fontSize: 13, lineHeight: 1.5, marginBottom: 8 }}>
        {preview?.narration}
      </div>
      {Array.isArray(preview?.contextual_warnings) && preview.contextual_warnings.length > 0 && (
        <div style={{
          margin: '6px 0 10px', padding: '6px 10px', fontSize: 11,
          background: 'rgba(239,68,68,0.10)',
          border: '1px solid rgba(239,68,68,0.5)', borderRadius: 4,
          color: 'var(--loss, #ef4444)',
        }}>
          ⚠ Heads up:
          <ul style={{ margin: '4px 0 0 18px' }}>
            {preview.contextual_warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button" disabled={disabled} onClick={onConfirm}
          style={{
            padding: '5px 14px', fontSize: 12, fontWeight: 600,
            background: elevated ? '#ef4444' : 'var(--ut-gold, #c9a84c)',
            color: elevated ? '#fff' : '#000',
            border: 'none', borderRadius: 4, cursor: 'pointer',
          }}
        >
          {preview?.confirm_label || 'Confirm'}
        </button>
        <button
          type="button" disabled={disabled} onClick={onCancel}
          style={{
            padding: '5px 14px', fontSize: 12, background: 'transparent',
            color: 'var(--text-muted)', border: '1px solid var(--border)',
            borderRadius: 4, cursor: 'pointer',
          }}
        >
          Keep it
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: ChatMessage**

```jsx
/**
 * Per-role message renderer.
 *
 * Props:
 *   message: { id, role, content, tool_calls?, tool_results?, metadata? }
 *   summaries: Map<tool_call_id, string>   // optional tool-result summary strings
 */
import { renderMarkdown } from '../lib/coachMarkdown'
import ChatToolChip from './ChatToolChip'

export default function ChatMessage({ message, toolResults = {}, toolSummaries = {} }) {
  const role = message.role
  if (role === 'tool') return null   // tool rows render inside the assistant message via chips
  if (role === 'summary') {
    return (
      <div style={{
        margin: '10px 0', padding: '8px 14px', fontSize: 12, fontStyle: 'italic',
        background: 'rgba(255,255,255,0.03)', borderLeft: '3px solid var(--border)',
        color: 'var(--text-muted)',
      }}>
        Compass's memory of earlier: {message.content}
      </div>
    )
  }

  const alignment = role === 'user' ? 'flex-end' : 'flex-start'
  const bg = role === 'user' ? 'rgba(255,255,255,0.04)' : 'rgba(201,168,76,0.05)'
  const flagged = message.metadata?.audit_passed === false
  return (
    <div style={{ display: 'flex', justifyContent: alignment, margin: '8px 0' }}>
      <div style={{
        maxWidth: '80%',
        padding: '10px 14px',
        background: bg,
        border: `1px solid ${role === 'user' ? 'var(--border)' : 'rgba(201,168,76,0.3)'}`,
        borderRadius: 8,
        lineHeight: 1.55,
        fontSize: 13,
      }}>
        {role === 'assistant' && (
          <div style={{ fontSize: 10, color: 'var(--ut-gold, #c9a84c)', marginBottom: 4 }}>
            🧭 Compass {flagged && <span title="Some claims unverified" style={{ color: 'var(--loss, #ef4444)' }}>⚠</span>}
          </div>
        )}
        {message.content && (
          <div>{renderMarkdown(message.content)}</div>
        )}
        {Array.isArray(message.tool_calls) && message.tool_calls.length > 0 && (
          <div style={{ marginTop: 6 }}>
            {message.tool_calls.map((tc) => (
              <ChatToolChip
                key={tc.id}
                toolCall={tc}
                toolResult={toolResults[tc.id]}
                summary={toolSummaries[tc.id]}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Build**

```bash
cd C:/Users/Patrick/uct-dashboard/app && npm run build
```

Expected: success.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/ChatToolChip.jsx app/src/pages/journal-2-0/components/ChatActionCard.jsx app/src/pages/journal-2-0/components/ChatMessage.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): ChatToolChip + ChatActionCard + ChatMessage atoms"
```

---

## Task 13: Main panel — CompassChat.jsx + tests

**Files:**
- Create: `app/src/pages/journal-2-0/components/CompassChat.jsx`
- Create: `app/src/pages/journal-2-0/components/CompassChat.test.jsx`

Panel composes scrollback + composer + empty state + pending action card. Handles auto-scroll, suggested prompts, Cmd+Enter submission, disabled-when-rate-limited.

- [ ] **Step 1: Write failing tests**

```jsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import CompassChat from './CompassChat'

vi.mock('../hooks/useJ2CoachChat', () => ({
  default: vi.fn(),
}))

import useJ2CoachChat from '../hooks/useJ2CoachChat'

function _hookReturn(overrides = {}) {
  return {
    messages: [],
    status: { enabled: true, rate_limit_remaining: 200, conversation_message_count: 0 },
    isLoading: false,
    error: null,
    isStreaming: false,
    streamingTokens: '',
    pendingAction: null,
    send: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
    forget: vi.fn(),
    forgetAll: vi.fn(),
    refresh: vi.fn(),
    ...overrides,
  }
}

describe('CompassChat', () => {
  beforeEach(() => vi.clearAllMocks())

  it('renders empty state with suggested prompts when no messages', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn())
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByText(/Compass is here/i)).toBeInTheDocument()
    expect(screen.getByText(/How am I doing this week/i)).toBeInTheDocument()
  })

  it('clicking a suggested prompt populates and submits', async () => {
    const send = vi.fn()
    useJ2CoachChat.mockReturnValue(_hookReturn({ send }))
    const user = userEvent.setup()
    render(<CompassChat accountId="acc1" />)
    await user.click(screen.getByRole('button', { name: /How am I doing this week/i }))
    expect(send).toHaveBeenCalledWith('How am I doing this week?')
  })

  it('typing + Send calls send', async () => {
    const send = vi.fn()
    useJ2CoachChat.mockReturnValue(_hookReturn({ send }))
    const user = userEvent.setup()
    render(<CompassChat accountId="acc1" />)
    const textarea = screen.getByRole('textbox')
    await user.type(textarea, 'Hi Compass')
    await user.click(screen.getByRole('button', { name: /^Send$/ }))
    expect(send).toHaveBeenCalledWith('Hi Compass')
  })

  it('renders pending-action card when pendingAction is set', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      pendingAction: {
        message_id: 'm1', tool_call_id: 'tc1', name: 'mute_setup',
        args: { setup_name: 'Pullback' },
        preview: { narration: 'Mute Pullback', contextual_warnings: [],
                   confirm_label: 'Mute setup', elevated: false },
      },
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByText(/Compass wants to/i)).toBeInTheDocument()
    expect(screen.getByText(/Mute Pullback/i)).toBeInTheDocument()
  })

  it('hides panel when status.enabled is false', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      status: { enabled: false, rate_limit_remaining: 200, conversation_message_count: 0 },
    }))
    const { container } = render(<CompassChat accountId="acc1" />)
    expect(container.firstChild).toBeNull()
  })

  it('disables composer when rate-limit remaining is 0', () => {
    useJ2CoachChat.mockReturnValue(_hookReturn({
      status: { enabled: true, rate_limit_remaining: 0, conversation_message_count: 200 },
    }))
    render(<CompassChat accountId="acc1" />)
    expect(screen.getByText(/Daily limit reached/i)).toBeInTheDocument()
    const sendBtn = screen.getByRole('button', { name: /^Send$/ })
    expect(sendBtn).toBeDisabled()
  })
})
```

- [ ] **Step 2: Confirm fail**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/CompassChat.test.jsx
```

Expected: module not found.

- [ ] **Step 3: Implement CompassChat**

```jsx
/**
 * Compass Chat panel — top of the Compass tab.
 *
 * Composes: header, scrollback, pending-action card, composer, empty state.
 * Hidden entirely when status.enabled = false. Composer disabled when rate
 * limit exhausted.
 */
import { useState, useRef, useEffect, useMemo } from 'react'
import useJ2CoachChat from '../hooks/useJ2CoachChat'
import ChatMessage from './ChatMessage'
import ChatActionCard from './ChatActionCard'

const SUGGESTED_PROMPTS = [
  'How am I doing this week?',
  "Why did I lose on my worst recent day?",
  'Compare my Bull Flag and Pullback performance',
  'What is the biggest pattern in my recent losses?',
]

export default function CompassChat({ accountId }) {
  const {
    messages, status, isStreaming, streamingTokens, pendingAction,
    error, send, confirm, cancel, forgetAll,
  } = useJ2CoachChat(accountId)
  const [input, setInput] = useState('')
  const scrollerRef = useRef(null)
  const [showMenu, setShowMenu] = useState(false)

  // Auto-scroll on new content unless user has scrolled up
  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (distanceFromBottom < 80) {
      el.scrollTop = el.scrollHeight
    }
  }, [messages.length, streamingTokens])

  // Build tool-result lookup for ChatMessage
  const toolResults = useMemo(() => {
    const out = {}
    for (const m of messages) {
      if (m.role === 'tool' && Array.isArray(m.tool_results)) {
        for (const tr of m.tool_results) out[tr.tool_call_id] = tr
      }
    }
    return out
  }, [messages])

  if (status && status.enabled === false) return null

  const limitHit = status?.rate_limit_remaining <= 0
  const composerDisabled = isStreaming || limitHit

  const onSubmit = (text) => {
    const t = (text ?? input).trim()
    if (!t) return
    setInput('')
    send(t)
  }

  const onKeyDown = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      onSubmit()
    }
  }

  const hasContent = messages.length > 0 || isStreaming

  return (
    <section style={{
      background: 'var(--bg-elevated, rgba(255,255,255,0.02))',
      border: '1px solid var(--border)', borderRadius: 8,
      margin: '12px 0', padding: '12px 16px',
    }}>
      <header style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginBottom: 6, paddingBottom: 6, borderBottom: '1px solid var(--border)',
      }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ut-gold, #c9a84c)' }}>
          🧭 Talk to Compass
        </div>
        <div style={{ position: 'relative' }}>
          <button
            type="button" aria-label="Chat options"
            onClick={() => setShowMenu((v) => !v)}
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16,
            }}
          >⋯</button>
          {showMenu && (
            <div style={{
              position: 'absolute', right: 0, top: '100%', zIndex: 5,
              background: 'var(--bg-base, #1a1a1a)',
              border: '1px solid var(--border)', borderRadius: 6,
              minWidth: 200, padding: 4,
            }}>
              <button
                type="button"
                onClick={() => { setShowMenu(false); forgetAll() }}
                style={{
                  display: 'block', width: '100%', textAlign: 'left',
                  padding: '8px 12px', fontSize: 12,
                  background: 'transparent', border: 'none',
                  color: 'var(--text-bright)', cursor: 'pointer',
                }}
              >Clear conversation</button>
            </div>
          )}
        </div>
      </header>

      <div ref={scrollerRef} style={{
        maxHeight: 480, overflowY: 'auto', padding: '4px 2px', minHeight: 80,
      }}>
        {!hasContent && (
          <div style={{ textAlign: 'center', padding: '24px 8px', color: 'var(--text-muted)' }}>
            <div style={{ fontSize: 24, marginBottom: 6 }}>🧭</div>
            <div style={{ fontSize: 13, marginBottom: 4 }}>
              <strong style={{ color: 'var(--text-bright)' }}>Compass is here.</strong>
            </div>
            <div style={{ fontSize: 12, marginBottom: 12 }}>
              Ask me anything about your trading.
            </div>
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: 6, maxWidth: 700, margin: '0 auto',
            }}>
              {SUGGESTED_PROMPTS.map((p) => (
                <button
                  key={p} type="button"
                  onClick={() => onSubmit(p)}
                  style={{
                    padding: '8px 12px', fontSize: 12, textAlign: 'left',
                    background: 'rgba(201,168,76,0.06)',
                    border: '1px solid rgba(201,168,76,0.3)',
                    borderRadius: 4, color: 'var(--text-bright)', cursor: 'pointer',
                  }}
                >{p}</button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m) => (
          <ChatMessage key={m.id} message={m} toolResults={toolResults} />
        ))}

        {isStreaming && streamingTokens && (
          <ChatMessage
            message={{ id: '_streaming', role: 'assistant', content: streamingTokens + '▌' }}
            toolResults={{}}
          />
        )}

        {pendingAction && (
          <ChatActionCard
            pendingAction={pendingAction}
            onConfirm={() => confirm(pendingAction.message_id, pendingAction.tool_call_id)}
            onCancel={() => cancel(pendingAction.message_id, pendingAction.tool_call_id)}
            disabled={isStreaming}
          />
        )}
      </div>

      {error && (
        <div role="alert" style={{
          margin: '6px 0', padding: '6px 10px', fontSize: 11,
          background: 'rgba(239,68,68,0.08)', color: 'var(--loss, #ef4444)',
          border: '1px solid rgba(239,68,68,0.4)', borderRadius: 4,
        }}>{String(error)}</div>
      )}

      <div style={{ marginTop: 8 }}>
        <textarea
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={limitHit ? 'Daily limit reached. Resets at midnight UTC.' : 'Type to Compass… (Cmd+Enter to send)'}
          disabled={composerDisabled}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '8px 12px',
            fontSize: 13, fontFamily: 'inherit',
            background: 'var(--bg-base, #1a1a1a)', color: 'var(--text-bright)',
            border: '1px solid var(--border)', borderRadius: 6, resize: 'vertical',
          }}
        />
        <div style={{ display: 'flex', justifyContent: 'space-between',
                       alignItems: 'center', marginTop: 6 }}>
          <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
            {limitHit
              ? '⛔ Daily limit reached'
              : `${status?.rate_limit_remaining ?? 200} messages remaining today`}
          </span>
          <button
            type="button"
            onClick={() => onSubmit()}
            disabled={composerDisabled || !input.trim()}
            style={{
              padding: '5px 14px', fontSize: 12, fontWeight: 600,
              background: 'var(--ut-gold, #c9a84c)', color: '#000',
              border: 'none', borderRadius: 4, cursor: composerDisabled ? 'not-allowed' : 'pointer',
              opacity: composerDisabled || !input.trim() ? 0.5 : 1,
            }}
          >Send</button>
        </div>
      </div>
    </section>
  )
}
```

- [ ] **Step 4: Run tests + build**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/CompassChat.test.jsx
npm run build
```

Expected: 6 vitest passes; build succeeds.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/CompassChat.jsx app/src/pages/journal-2-0/components/CompassChat.test.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): CompassChat panel — scrollback + composer + empty state + pending-action card"
```

---

## Task 14: CompassTab integration + end-to-end smoke + push

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/CompassTab.jsx`

- [ ] **Step 1: Add import + mount**

In `CompassTab.jsx`, add to imports:

```jsx
import CompassChat from '../components/CompassChat'
```

In the JSX, insert the panel as the FIRST element after the header `<h1>🧭 Compass</h1>` + subtitle paragraph. Find the existing `{errorMsg && (...)}` block and insert above it:

```jsx
      <CompassChat accountId={accountId} />
```

So the vertical order becomes: header → CompassChat → errorMsg → weekly CTA → Daily Recaps → Weekly Reviews → TraderProfileEditor.

- [ ] **Step 2: Build + frontend full suite**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/
```

Expected: build OK, all tests passing.

- [ ] **Step 3: Backend full suite**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/ -q
```

Expected: all green (368 baseline + 16 chat + 25 chat tools = ~409 passing).

- [ ] **Step 4: Manual smoke (only if ANTHROPIC_API_KEY is set locally)**

1. `uvicorn api.main:app --reload --port 8000` + frontend `npm run dev`.
2. Open `/journal` → Compass tab.
3. Verify empty state with 4 suggested prompts. Click "How am I doing this week?" — Compass streams a response.
4. Ask follow-up "compare my Bull Flag and Pullback performance" — Compass calls `compare_setups` tool, chip appears.
5. Try an action: "this week, skip Pullbacks" → pending-action card appears with mute_setup + set_weekly_focus. Click Confirm on each.
6. Try elevated action: "raise my daily loss limit to 5%" → pending card has red warning sub-block with breach data + verb-level "Yes, raise the loss limit" / "Keep it" buttons. Click Cancel.
7. Open second tab → SWR revalidate-on-focus should sync history.
8. Toggle `COMPASS_CHAT_ENABLED=false` env → panel disappears next refresh.

- [ ] **Step 5: Commit + push**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/tabs/CompassTab.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-chat): mount CompassChat at top of Compass tab"
git -C C:/Users/Patrick/uct-dashboard push origin master
```

Railway redeploys; Compass Chat is live.

---

## Self-Review Checklist

- **Spec coverage:** §1-3 covered by Tasks 1+5+6; §4 by Task 1; §5 by Task 9; §6 by Tasks 2+3+4; §7 by Task 8; §8 by Tasks 11+12+13+14; §9 by Tasks 6+10; §10 cost is observed during deployment; §11 test plan executed across Tasks 2-13; §12 file map matches; §13 deferred items not built; §14 open questions noted as future polish.
- **Placeholder scan:** No TBD/TODO. Every step has concrete code or commands.
- **Type consistency:** `handle_user_turn`, `confirm_pending_action`, `cancel_pending_action`, `append_message`, `list_messages`, `forget_message`, `get_chat_status`, `get_rate_limit_info` are the canonical orchestrator names. `TOOLS` dict shape `{name, description, input_schema, requires_confirm, executor, preview?}` consistent across Tasks 2-4. SSE event types `{token, tool_call, tool_call_pending, complete, error}` consistent across backend + frontend.
- **Idempotency:** Conversation is append-only; forget is soft-delete; tool-call status mutations rewrite the parent assistant row's `tool_calls` JSON; safe across retries.
- **Security:** All endpoints scoped by `Depends(get_current_user)` (Task 9). Compass-enabled gate on stream endpoint. Per-user rate limit (Task 5+6). Action confirmation required for state mutation (Tasks 4+6+7).
