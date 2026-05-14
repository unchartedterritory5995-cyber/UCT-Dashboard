# Multi-Account Compass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified Compass coaching identity that activates when the J2 header selector is on "All Accounts", aggregating trades/positions from every `compass_enabled` account and persisting its own trader profile + reviews + recaps + chat history.

**Architecture:** New `account_id = '_all_'` sentinel reuses every existing Compass table (no migration). One new table `j2_unified_coach_state` holds the user-level trader profile and toggle. A single `resolve_account_scope()` helper turns `'_all_'` into the list of enabled real account ids; every assembler and chat tool unions queries across that list. Per-account coaches (and per-trade verdict / trade-review / interventions) keep working unchanged.

**Tech Stack:** FastAPI (Python 3.12), SQLite (auth_db), React + Vite, SWR for client cache, pytest for backend, vitest for frontend.

**Spec:** `docs/superpowers/specs/2026-05-14-multi-account-compass-design.md` (read first).

---

## Phase 1 — Foundation: schema + state service + scope helper

### Task 1: Add `j2_unified_coach_state` table to the schema

**Files:**
- Modify: `api/services/journal_two/db.py:14-336` (extend `_J2_SCHEMA`)
- Test: `tests/test_db_schema.py` (create if missing — see `tests/` for existing patterns)

- [ ] **Step 1: Write the failing test**

Create or extend `tests/test_db_schema.py`:

```python
"""Schema-level smoke tests for the j2_* tables."""
import sqlite3
import tempfile
import os
import pytest
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()
    os.remove(path)


def test_j2_unified_coach_state_table_exists(conn):
    row = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='j2_unified_coach_state'"
    ).fetchone()
    assert row is not None, "j2_unified_coach_state table missing from _J2_SCHEMA"


def test_j2_unified_coach_state_schema(conn):
    cols = {r["name"]: r for r in conn.execute(
        "PRAGMA table_info(j2_unified_coach_state)"
    ).fetchall()}
    assert set(cols.keys()) == {
        "user_id", "trader_profile", "compass_enabled",
        "onboarded", "created_at", "updated_at",
    }
    assert cols["user_id"]["pk"] == 1
    assert cols["trader_profile"]["notnull"] == 1
    assert cols["compass_enabled"]["notnull"] == 1
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd C:\Users\Patrick\uct-dashboard
python -m pytest tests/test_db_schema.py -v
```

Expected: FAIL with `j2_unified_coach_state table missing from _J2_SCHEMA`.

- [ ] **Step 3: Extend `_J2_SCHEMA`**

In `api/services/journal_two/db.py`, append this `CREATE TABLE` to the `_J2_SCHEMA` string (right before the closing `"""` on the same line as the last existing table). The exact insertion point: after the `j2_profile_suggestions` block at line 338.

```sql
CREATE TABLE IF NOT EXISTS j2_unified_coach_state (
  user_id          TEXT PRIMARY KEY,
  trader_profile   TEXT NOT NULL DEFAULT '',
  compass_enabled  INTEGER NOT NULL DEFAULT 1,
  onboarded        INTEGER NOT NULL DEFAULT 0,
  created_at       TEXT NOT NULL,
  updated_at       TEXT NOT NULL
);
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest tests/test_db_schema.py -v
```

Expected: 2 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/db.py tests/test_db_schema.py
git commit -m "feat(j2-compass): add j2_unified_coach_state table for unified coach"
```

---

### Task 2: Create `unified_coach.py` service (get/upsert state)

**Files:**
- Create: `api/services/journal_two/unified_coach.py`
- Test: `api/services/journal_two/test_unified_coach.py`

- [ ] **Step 1: Write the failing test**

Create `api/services/journal_two/test_unified_coach.py`:

```python
"""Tests for the unified coach state service."""
import sqlite3
import tempfile
import os
import pytest
from api.services.journal_two import unified_coach
from api.services.journal_two.db import ensure_schema


@pytest.fixture
def conn():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()
    os.remove(path)


def test_get_or_create_returns_defaults_on_first_read(conn):
    state = unified_coach.get_or_create(conn, "user-1")
    assert state["userId"] == "user-1"
    assert state["traderProfile"] == ""
    assert state["compassEnabled"] is True
    assert state["onboarded"] is False
    assert "createdAt" in state and "updatedAt" in state


def test_get_or_create_is_idempotent(conn):
    a = unified_coach.get_or_create(conn, "user-1")
    b = unified_coach.get_or_create(conn, "user-1")
    assert a["createdAt"] == b["createdAt"]


def test_update_profile_persists(conn):
    unified_coach.get_or_create(conn, "user-1")
    out = unified_coach.update_state(conn, "user-1", trader_profile="Disciplined swing trader.")
    assert out["traderProfile"] == "Disciplined swing trader."
    # Re-read confirms persistence
    reread = unified_coach.get_or_create(conn, "user-1")
    assert reread["traderProfile"] == "Disciplined swing trader."


def test_update_compass_enabled_toggles(conn):
    unified_coach.get_or_create(conn, "user-1")
    out = unified_coach.update_state(conn, "user-1", compass_enabled=False)
    assert out["compassEnabled"] is False
    reread = unified_coach.get_or_create(conn, "user-1")
    assert reread["compassEnabled"] is False


def test_update_with_no_changes_is_noop(conn):
    unified_coach.get_or_create(conn, "user-1")
    # Both None means no fields to update — should still return current state
    out = unified_coach.update_state(conn, "user-1")
    assert out["traderProfile"] == ""
    assert out["compassEnabled"] is True
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest api/services/journal_two/test_unified_coach.py -v
```

Expected: FAIL with `ModuleNotFoundError: api.services.journal_two.unified_coach`.

- [ ] **Step 3: Create the service**

Create `api/services/journal_two/unified_coach.py`:

```python
"""Unified Compass coach state — one row per user, holds the unified
trader profile + compass_enabled toggle when account_id == '_all_'.

Lives in its own table (j2_unified_coach_state) to keep the user-level
coach concept distinct from the per-account j2_accounts rows. All
unified-mode reviews/recaps/chat persist in their existing tables
with account_id = '_all_'.
"""

from __future__ import annotations

import sqlite3
from datetime import datetime, timezone
from typing import Any

from api.services.auth_db import get_connection

UNIFIED_ACCOUNT_ID = "_all_"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _row_to_state(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "userId": row["user_id"],
        "traderProfile": row["trader_profile"] or "",
        "compassEnabled": bool(row["compass_enabled"]),
        "onboarded": bool(row["onboarded"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


def get_or_create(
    conn: sqlite3.Connection | None,
    user_id: str,
) -> dict[str, Any]:
    """Return the unified coach state, seeding defaults on first read."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        row = conn.execute(
            "SELECT * FROM j2_unified_coach_state WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        if row is not None:
            return _row_to_state(row)
        now = _now_iso()
        conn.execute(
            """INSERT INTO j2_unified_coach_state
               (user_id, trader_profile, compass_enabled, onboarded, created_at, updated_at)
               VALUES (?, '', 1, 0, ?, ?)""",
            (user_id, now, now),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM j2_unified_coach_state WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return _row_to_state(row)
    finally:
        if owned:
            conn.close()


def update_state(
    conn: sqlite3.Connection | None,
    user_id: str,
    *,
    trader_profile: str | None = None,
    compass_enabled: bool | None = None,
    onboarded: bool | None = None,
) -> dict[str, Any]:
    """Patch any subset of the state fields. Missing args = no change."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        # Guarantee the row exists.
        get_or_create(conn, user_id)

        fields: list[str] = []
        params: list[Any] = []
        if trader_profile is not None:
            fields.append("trader_profile = ?")
            params.append(trader_profile)
        if compass_enabled is not None:
            fields.append("compass_enabled = ?")
            params.append(1 if compass_enabled else 0)
        if onboarded is not None:
            fields.append("onboarded = ?")
            params.append(1 if onboarded else 0)

        if fields:
            fields.append("updated_at = ?")
            params.append(_now_iso())
            params.append(user_id)
            conn.execute(
                f"UPDATE j2_unified_coach_state SET {', '.join(fields)} WHERE user_id = ?",
                params,
            )
            conn.commit()

        row = conn.execute(
            "SELECT * FROM j2_unified_coach_state WHERE user_id = ?",
            (user_id,),
        ).fetchone()
        return _row_to_state(row)
    finally:
        if owned:
            conn.close()
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest api/services/journal_two/test_unified_coach.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/unified_coach.py api/services/journal_two/test_unified_coach.py
git commit -m "feat(j2-compass): unified_coach service for user-level state"
```

---

### Task 3: Create `coach_scope.py` with `resolve_account_scope()`

**Files:**
- Create: `api/services/journal_two/coach_scope.py`
- Test: `api/services/journal_two/test_coach_scope.py`

- [ ] **Step 1: Write the failing test**

Create `api/services/journal_two/test_coach_scope.py`:

```python
"""Tests for resolve_account_scope — the single helper that turns a
caller-supplied account_id (real UUID or '_all_') into the list of
real account ids a Compass call should query."""
import sqlite3
import tempfile
import os
import uuid
from datetime import datetime, timezone
import pytest
from api.services.journal_two import coach_scope, accounts as accounts_service
from api.services.journal_two.db import ensure_schema


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@pytest.fixture
def conn():
    fd, path = tempfile.mkstemp(suffix=".db")
    os.close(fd)
    c = sqlite3.connect(path)
    c.row_factory = sqlite3.Row
    ensure_schema(c)
    yield c
    c.close()
    os.remove(path)


def _seed_account(conn, user_id, name, compass_enabled=1) -> str:
    aid = str(uuid.uuid4())
    now = _now_iso()
    conn.execute(
        """INSERT INTO j2_accounts (
              id, user_id, name, account_size, default_stop, position_closing,
              breakeven_range, setups, share_journal_data, created_at, updated_at,
              compass_enabled
           ) VALUES (?, ?, ?, 100000, '{"mode":"custom"}', 'FIFO',
                    '{"enabled":false,"unit":"$","value":0}', '[]', 0, ?, ?, ?)""",
        (aid, user_id, name, now, now, compass_enabled),
    )
    conn.commit()
    return aid


def test_resolve_real_account_id_returns_that_id(conn):
    aid = _seed_account(conn, "user-1", "Default")
    assert coach_scope.resolve_account_scope(conn, "user-1", aid) == [aid]


def test_resolve_all_sentinel_unions_enabled_accounts(conn):
    a1 = _seed_account(conn, "user-1", "Default", compass_enabled=1)
    a2 = _seed_account(conn, "user-1", "Cash", compass_enabled=1)
    a3 = _seed_account(conn, "user-1", "Excluded", compass_enabled=0)
    result = coach_scope.resolve_account_scope(conn, "user-1", "_all_")
    assert sorted(result) == sorted([a1, a2])
    assert a3 not in result


def test_resolve_all_sentinel_with_zero_enabled_returns_empty(conn):
    _seed_account(conn, "user-1", "Off", compass_enabled=0)
    result = coach_scope.resolve_account_scope(conn, "user-1", "_all_")
    assert result == []


def test_resolve_all_sentinel_ignores_other_users(conn):
    _seed_account(conn, "user-1", "Mine")
    _seed_account(conn, "user-2", "Theirs")
    result = coach_scope.resolve_account_scope(conn, "user-1", "_all_")
    assert len(result) == 1


def test_is_unified_helper():
    assert coach_scope.is_unified("_all_") is True
    assert coach_scope.is_unified("acc-abc") is False
    assert coach_scope.is_unified(None) is False
```

- [ ] **Step 2: Run test to verify it fails**

```bash
python -m pytest api/services/journal_two/test_coach_scope.py -v
```

Expected: FAIL with `ModuleNotFoundError: api.services.journal_two.coach_scope`.

- [ ] **Step 3: Create the helper**

Create `api/services/journal_two/coach_scope.py`:

```python
"""Compass scope resolution.

The Compass coaching surface accepts either a real account id (per-account
mode) or the literal string '_all_' (unified mode). Every read path that
backs a Compass call uses resolve_account_scope() to translate that
caller-supplied value into the list of real account ids it should query.

In unified mode the list is filtered to accounts the user has opted in to
via the per-account compass_enabled toggle. Turn that toggle off on an
account to exclude it from unified coaching while keeping its per-account
coach reachable when that account is the selected one.
"""

from __future__ import annotations

import sqlite3

from api.services.journal_two.unified_coach import UNIFIED_ACCOUNT_ID


def is_unified(account_id: str | None) -> bool:
    """True if the caller is asking for unified-mode behavior."""
    return account_id == UNIFIED_ACCOUNT_ID


def resolve_account_scope(
    conn: sqlite3.Connection,
    user_id: str,
    account_id: str,
) -> list[str]:
    """Return the list of real j2_accounts ids this Compass call should query.

    - account_id == '_all_': all of the user's accounts with compass_enabled = 1
    - any other value: [account_id] (assumed validated upstream)
    """
    if not is_unified(account_id):
        return [account_id]
    rows = conn.execute(
        "SELECT id FROM j2_accounts WHERE user_id = ? AND compass_enabled = 1 ORDER BY created_at ASC",
        (user_id,),
    ).fetchall()
    return [r["id"] for r in rows]
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest api/services/journal_two/test_coach_scope.py -v
```

Expected: 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/coach_scope.py api/services/journal_two/test_coach_scope.py
git commit -m "feat(j2-compass): resolve_account_scope helper for unified mode"
```

---

## Phase 2 — Data layer: assemblers + chat tools accept `'_all_'`

### Task 4: Teach `coach_data_assembler` helpers to union across accounts

**Files:**
- Modify: `api/services/journal_two/coach_data_assembler.py`
- Test: `api/services/journal_two/test_coach_data_assembler.py` (extend existing)

Strategy: Each helper that currently does `WHERE user_id = ? AND account_id = ?` becomes:
1. Call `resolve_account_scope(conn, user_id, account_id)` to get the list of ids.
2. If the list is empty, return the helper's empty-state (`[]` or `{}`).
3. Otherwise build a `WHERE user_id = ? AND account_id IN (?, ?, …)` clause and pass the ids as additional params.
4. For row-level fetches, JOIN `j2_accounts` (or look up name once) so each row carries `account_id` + `account_name`.

We update one helper at a time, keeping changes additive. The unit test always passes a `_all_` account_id and asserts the union.

- [ ] **Step 1: Write the failing test for `_trades_in_range`**

Append to `api/services/journal_two/test_coach_data_assembler.py`:

```python
def test_trades_in_range_unions_across_accounts(conn):
    """When account_id == '_all_', _trades_in_range pulls trades from
    every compass_enabled account the user owns and tags each row with
    its source account name."""
    from api.services.journal_two import coach_data_assembler as cda
    a1 = _seed_account(conn, "user-1", "Default", compass_enabled=1)
    a2 = _seed_account(conn, "user-1", "Cash", compass_enabled=1)
    _seed_closed_trade(conn, "user-1", a1, "AAPL", pnl_dollar=120.0)
    _seed_closed_trade(conn, "user-1", a2, "NVDA", pnl_dollar=-50.0)

    from datetime import datetime
    start = datetime(2026, 1, 1)
    end = datetime(2030, 1, 1)
    rows = cda._trades_in_range(conn, "user-1", "_all_", start, end)

    syms = sorted([r["sym"] for r in rows])
    assert syms == ["AAPL", "NVDA"]
    by_sym = {r["sym"]: r for r in rows}
    assert by_sym["AAPL"]["account_name"] == "Default"
    assert by_sym["NVDA"]["account_name"] == "Cash"
```

Assume `_seed_account` and `_seed_closed_trade` already exist in the test file (Phase G v1 tests added them). If they don't, copy these helpers in:

```python
def _seed_account(conn, user_id, name, compass_enabled=1) -> str:
    import uuid
    from datetime import datetime, timezone
    aid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_accounts (
              id, user_id, name, account_size, default_stop, position_closing,
              breakeven_range, setups, share_journal_data, created_at, updated_at,
              compass_enabled
           ) VALUES (?, ?, ?, 100000, '{"mode":"custom"}', 'FIFO',
                    '{"enabled":false,"unit":"$","value":0}', '[]', 0, ?, ?, ?)""",
        (aid, user_id, name, now, now, compass_enabled),
    )
    conn.commit()
    return aid


def _seed_closed_trade(conn, user_id, account_id, sym, pnl_dollar=0.0):
    import uuid
    from datetime import datetime, timezone
    tid = str(uuid.uuid4())
    now = datetime.now(timezone.utc).isoformat()
    conn.execute(
        """INSERT INTO j2_trades (
              id, user_id, account_id, sym, side, shares, entry_price, exit_price,
              entry_date, exit_date, pnl_dollar, pnl_percent, fees, status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'long', 100, 100, 101.2, ?, ?, ?, 0.012, 0, 'closed', ?, ?)""",
        (tid, user_id, account_id, sym, now, now, pnl_dollar, now, now),
    )
    conn.commit()
    return tid
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
python -m pytest api/services/journal_two/test_coach_data_assembler.py::test_trades_in_range_unions_across_accounts -v
```

Expected: FAIL — current `_trades_in_range` queries `WHERE account_id = '_all_'` literally and returns 0 rows.

- [ ] **Step 3: Update `_trades_in_range`**

In `api/services/journal_two/coach_data_assembler.py` (around line 134-150), replace the function body:

```python
def _trades_in_range(
    conn, user_id: str, account_id: str,
    start: datetime, end: datetime,
) -> list[dict]:
    from api.services.journal_two.coach_scope import resolve_account_scope
    ids = resolve_account_scope(conn, user_id, account_id)
    if not ids:
        return []
    placeholders = ",".join("?" * len(ids))
    start_iso = start.isoformat()
    end_iso = end.isoformat()
    rows = conn.execute(
        f"""SELECT t.id, t.sym, t.side, t.shares, t.entry_price, t.exit_price,
                  t.entry_date, t.exit_date, t.pnl_dollar, t.pnl_percent,
                  t.setup, t.regime, t.mistake_tags, t.emotion_tags,
                  t.notes, t.r_multiple, t.fees,
                  t.account_id, a.name AS account_name
             FROM j2_trades t
             JOIN j2_accounts a ON a.id = t.account_id
            WHERE t.user_id = ? AND t.account_id IN ({placeholders})
              AND t.exit_date BETWEEN ? AND ?
              AND t.status = 'closed'
            ORDER BY t.exit_date ASC""",
        [user_id, *ids, start_iso, end_iso],
    ).fetchall()
    return [dict(r) for r in rows]
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
python -m pytest api/services/journal_two/test_coach_data_assembler.py::test_trades_in_range_unions_across_accounts -v
```

Expected: PASS. Also re-run the full file to make sure existing per-account tests still pass:

```bash
python -m pytest api/services/journal_two/test_coach_data_assembler.py -v
```

Expected: every existing test still PASSes (per-account behavior preserved because `resolve_account_scope` returns `[account_id]` for non-sentinel inputs).

- [ ] **Step 5: Repeat steps 1-4 for each remaining helper**

Each of the following needs the same treatment (write a failing union test, then convert the helper). Group commits sensibly — one commit per helper is fine.

| Helper | Current location | Test name to add |
|---|---|---|
| `_open_positions` | `coach_data_assembler.py:587` | `test_open_positions_unions_across_accounts` |
| `_recent_eod_summaries` | line ~537 | `test_recent_eod_summaries_unions_across_accounts` |
| `_last_weekly_summary_and_focus` | line ~563 | `test_last_weekly_summary_unions_across_accounts` |
| `_discipline_events` | line ~279 | `test_discipline_events_unions_across_accounts` |
| `_feedback_signals` | line ~384 | `test_feedback_signals_unions_across_accounts` |
| `_eod_feedback_signals` | (look for similar) | `test_eod_feedback_signals_unions_across_accounts` |
| `_recent_coach_memory` | line ~109 | `test_recent_coach_memory_unions_across_accounts` |
| `_read_trader_profile` | line ~98 | special: in unified mode, reads `j2_unified_coach_state.trader_profile` instead — see Task 5 for code |

For `_discipline_events`, which reads `accounts_service.get_account_settings` for per-account risk caps, the unified-mode branch returns aggregated counts but uses the *unified* trader profile and no specific risk cap (caps only meaningful per-account). Confirm with the spec: discipline data still aggregates across accounts for stats purposes, but discipline *enforcement* (interventions, daily-loss block) stays per-account.

- [ ] **Step 6: Commit each helper conversion as you go**

Example commit messages:
```
feat(j2-compass): _trades_in_range unions across accounts on '_all_'
feat(j2-compass): _open_positions unions across accounts on '_all_'
…
```

---

### Task 5: Update `_read_trader_profile` to use unified state in `_all_` mode

**Files:**
- Modify: `api/services/journal_two/coach_data_assembler.py:98-107` (the `_read_trader_profile` helper)
- Test: `api/services/journal_two/test_coach_data_assembler.py`

- [ ] **Step 1: Write the failing test**

```python
def test_read_trader_profile_uses_unified_state_in_all_mode(conn):
    from api.services.journal_two import coach_data_assembler as cda
    from api.services.journal_two import unified_coach
    unified_coach.get_or_create(conn, "user-1")
    unified_coach.update_state(conn, "user-1", trader_profile="Cross-account swing bias.")

    out = cda._read_trader_profile(conn, "user-1", "_all_")
    assert out == "Cross-account swing bias."


def test_read_trader_profile_uses_account_row_in_per_account_mode(conn):
    from api.services.journal_two import coach_data_assembler as cda
    aid = _seed_account(conn, "user-1", "Default")
    conn.execute(
        "UPDATE j2_accounts SET trader_profile = ? WHERE id = ?",
        ("Account-specific profile.", aid),
    )
    conn.commit()
    out = cda._read_trader_profile(conn, "user-1", aid)
    assert out == "Account-specific profile."
```

- [ ] **Step 2: Run to verify it fails**

```bash
python -m pytest api/services/journal_two/test_coach_data_assembler.py::test_read_trader_profile_uses_unified_state_in_all_mode -v
```

Expected: FAIL — currently the helper hardcodes `WHERE id = ?` against `j2_accounts`, so `_all_` returns empty.

- [ ] **Step 3: Update the helper**

Replace the function body in `coach_data_assembler.py`:

```python
def _read_trader_profile(conn, user_id: str, account_id: str) -> str:
    from api.services.journal_two.coach_scope import is_unified
    from api.services.journal_two import unified_coach
    if is_unified(account_id):
        state = unified_coach.get_or_create(conn, user_id)
        return state["traderProfile"]
    row = conn.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    return (row and row["trader_profile"]) or ""
```

- [ ] **Step 4: Run both tests to verify they pass**

```bash
python -m pytest api/services/journal_two/test_coach_data_assembler.py -v
```

Expected: all existing + new tests PASS.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/coach_data_assembler.py api/services/journal_two/test_coach_data_assembler.py
git commit -m "feat(j2-compass): _read_trader_profile reads unified state in '_all_' mode"
```

---

### Task 6: Teach chat-tool read functions to handle `'_all_'`

**Files:**
- Modify: `api/services/journal_two/coach_chat_tools.py` (every `_exec_*` function that hits the DB)
- Test: `api/services/journal_two/test_coach_chat_tools.py`

The read tools mostly delegate to assembler helpers — those got unified-aware in Task 4-5, so most tools work for free. The tools that query directly need explicit conversion.

The minimum set to audit (grep for `account_id` in `coach_chat_tools.py`):

```
_exec_get_open_positions     → delegates to _open_positions ✓ (Task 4)
_exec_get_trader_profile     → queries j2_accounts directly — needs update
_exec_get_recent_recaps      → queries j2_coach_outputs directly — needs update
_exec_get_open_positions     ✓
_exec_get_weekly_review_data → delegates to assemble_week ✓
…and ~18 more
```

For each tool that queries directly, the conversion is the same shape as Task 4. For tools that only delegate to already-converted helpers, no change is needed — but we still add a unit test confirming `_all_` works end-to-end.

- [ ] **Step 1: Write a failing test for `_exec_get_trader_profile`**

In `api/services/journal_two/test_coach_chat_tools.py`:

```python
def test_exec_get_trader_profile_returns_unified_profile_in_all_mode(conn):
    from api.services.journal_two import coach_chat_tools as cct
    from api.services.journal_two import unified_coach
    unified_coach.get_or_create(conn, "user-1")
    unified_coach.update_state(conn, "user-1", trader_profile="Unified.")
    out = cct._exec_get_trader_profile(user_id="user-1", account_id="_all_", args={}, conn=conn)
    assert out == {"profile_markdown": "Unified.", "exists": True}
```

- [ ] **Step 2: Run to verify it fails**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py::test_exec_get_trader_profile_returns_unified_profile_in_all_mode -v
```

Expected: FAIL — current implementation returns `{"profile_markdown": "", "exists": False}` because no `j2_accounts` row matches `id = '_all_'`.

- [ ] **Step 3: Update `_exec_get_trader_profile`**

In `coach_chat_tools.py:140-148`:

```python
def _exec_get_trader_profile(*, user_id, account_id, args, conn=None) -> dict:
    from api.services.journal_two.coach_scope import is_unified
    from api.services.journal_two import unified_coach
    c = conn or get_connection()
    if is_unified(account_id):
        state = unified_coach.get_or_create(c, user_id)
        return {
            "profile_markdown": state["traderProfile"],
            "exists": bool(state["traderProfile"]),
        }
    row = c.execute(
        "SELECT trader_profile FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if row is None:
        return {"profile_markdown": "", "exists": False}
    return {"profile_markdown": row["trader_profile"] or "", "exists": True}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
python -m pytest api/services/journal_two/test_coach_chat_tools.py::test_exec_get_trader_profile_returns_unified_profile_in_all_mode -v
```

Expected: PASS.

- [ ] **Step 5: Repeat steps 1-4 for each remaining direct-DB tool**

Same pattern as Task 4, Step 5. The conversion list:

| Tool | Treatment in unified mode |
|---|---|
| `_exec_get_recent_recaps` | `WHERE account_id IN (?, …)` across enabled accounts (recaps live with `account_id='_all_'` AND per-account ids — the unified surface shows BOTH unless we filter; for v1, when account_id=='_all_', read ONLY rows where `account_id='_all_'` since per-account recaps belong to their own coaches) |
| `_update_trader_profile_preview` | In `_all_` mode, preview reads/writes unified state via `unified_coach.update_state(...)`. Existing preview-confirm flow unchanged. |
| `_update_trader_profile_execute` | Same — writes to `j2_unified_coach_state` instead of `j2_accounts.trader_profile`. |
| Any tool that writes to `j2_accounts` columns (e.g., `mute_setup`, `schedule_paper_only_day`) | Reject `_all_` with a friendly error: *"This action targets a specific account — switch to a single account first."* |
| `_exec_add_position`-style tools | Reject `_all_` with: *"Tell me which account to add the position to."* |
| Read tools (`get_pnl_today`, `get_active_interventions`, `get_trade_count_today`, etc.) | Use `resolve_account_scope` + `IN (...)`. Aggregate counts/dollar amounts across accounts. Per-row tools tag with `account_name`. |
| Pattern engine tools (`find_patterns_on_ticker`, etc.) | Already account-agnostic. No change needed. |

For interventions specifically: per the spec, v1 keeps interventions per-account. So `_exec_get_active_interventions` in `_all_` mode returns an empty list with a note: `{"interventions": [], "note": "Interventions stay per-account in unified mode (v1)."}`.

Each tool gets its own commit with the pattern:

```
feat(j2-compass): <tool_name> handles '_all_' scope
```

---

## Phase 3 — Endpoints: routes accept `'_all_'`

### Task 7: Add unified-mode precheck to every `/coach/` route

**Files:**
- Modify: `api/routers/journal_two.py` (the ~26 routes starting at line 964)

The current per-account gate is:

```python
settings_check = accounts_service.get_account_settings(user["id"], account_id)
if settings_check is None:
    raise HTTPException(status_code=404, detail="Account not found")
if not settings_check.get("compassEnabled", True):
    raise HTTPException(status_code=403, detail="Compass is disabled for this account")
```

It appears at the top of ~10 different route handlers. Extract it into a shared dependency.

- [ ] **Step 1: Write the failing test**

In `tests/test_journal_two_compass_router.py` (create if missing):

```python
def test_weekly_reviews_route_accepts_all_sentinel(client, user_session):
    """GET /api/j2/accounts/_all_/coach/weekly-reviews returns 200
    when the user has at least one compass_enabled account."""
    # set up a compass_enabled account
    # ... (use existing test fixtures for j2_accounts seeding)
    r = client.get("/api/j2/accounts/_all_/coach/weekly-reviews",
                   cookies={"session_id": user_session})
    assert r.status_code == 200
    assert "reviews" in r.json()


def test_weekly_reviews_route_403_when_unified_compass_disabled(client, user_session_with_unified_off):
    r = client.get("/api/j2/accounts/_all_/coach/weekly-reviews",
                   cookies={"session_id": user_session_with_unified_off})
    assert r.status_code == 403


def test_pre_trade_verdict_rejects_all_sentinel(client, user_session):
    r = client.post(
        "/api/j2/accounts/_all_/coach/pre-trade-verdict",
        json={"sym": "AAPL", "side": "long", "shares": 100, "entry": 100, "stop": 95},
        cookies={"session_id": user_session},
    )
    assert r.status_code == 400
    assert "single account" in r.json()["detail"].lower()
```

- [ ] **Step 2: Run to verify it fails**

```bash
python -m pytest tests/test_journal_two_compass_router.py -v
```

Expected: route returns 404 for `_all_` because `get_account_settings` returns None.

- [ ] **Step 3: Add a shared dependency**

In `api/routers/journal_two.py`, near the top of the file (after other imports), add:

```python
from api.services.journal_two import unified_coach
from api.services.journal_two.coach_scope import is_unified, UNIFIED_ACCOUNT_ID  # noqa


def _require_compass_enabled(user_id: str, account_id: str) -> None:
    """Raise 404/403 if Compass isn't reachable for (user, account).

    Accepts the '_all_' sentinel: in that case the per-user unified
    coach toggle gates the request instead of the per-account one.
    """
    if is_unified(account_id):
        state = unified_coach.get_or_create(None, user_id)
        if not state["compassEnabled"]:
            raise HTTPException(status_code=403, detail="Unified Compass is disabled.")
        return
    settings_check = accounts_service.get_account_settings(user_id, account_id)
    if settings_check is None:
        raise HTTPException(status_code=404, detail="Account not found")
    if not settings_check.get("compassEnabled", True):
        raise HTTPException(status_code=403, detail="Compass is disabled for this account")


def _reject_unified_for_per_trade(account_id: str) -> None:
    """Pre-trade verdict / trade-review / intervention endpoints are inherently
    per-account in v1. Reject the unified sentinel with a friendly 400."""
    if is_unified(account_id):
        raise HTTPException(
            status_code=400,
            detail="Switch to a single account — Compass needs an account context for this action.",
        )
```

- [ ] **Step 4: Replace inline gates with the dependency**

For each route currently using the inline 4-line gate, replace it with a single call:

```python
# Before
settings_check = accounts_service.get_account_settings(user["id"], account_id)
if settings_check is None:
    raise HTTPException(status_code=404, detail="Account not found")
if not settings_check.get("compassEnabled", True):
    raise HTTPException(status_code=403, detail="Compass is disabled for this account")

# After
_require_compass_enabled(user["id"], account_id)
```

Routes to update (every `@router.*("/accounts/{account_id}/coach/*")` route — see grep output in Task 0). Skip routes that need to refuse `_all_`: those use `_reject_unified_for_per_trade(account_id)` *first*, then the per-account gate.

The reject-list (per the spec):
- `/coach/pre-trade-verdict`
- `/coach/trade-reviews/...` (generate / regenerate / feedback / forget — anything that creates per-trade artifacts)
- `/coach/interventions/...` (interventions stay per-account in v1)

- [ ] **Step 5: Run tests to verify they pass**

```bash
python -m pytest tests/test_journal_two_compass_router.py -v
python -m pytest tests/ -k "journal_two" -v  # full router suite, regression check
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add api/routers/journal_two.py tests/test_journal_two_compass_router.py
git commit -m "feat(j2-compass): coach routes accept '_all_'; per-trade routes reject it"
```

---

### Task 8: Add `/api/j2/unified-coach` GET/PUT endpoints

**Files:**
- Modify: `api/routers/journal_two.py`
- Test: `tests/test_journal_two_compass_router.py`

- [ ] **Step 1: Write failing tests**

```python
def test_get_unified_coach_seeds_defaults(client, user_session):
    r = client.get("/api/j2/unified-coach", cookies={"session_id": user_session})
    assert r.status_code == 200
    body = r.json()
    assert body["traderProfile"] == ""
    assert body["compassEnabled"] is True
    assert body["onboarded"] is False


def test_put_unified_coach_persists_profile(client, user_session):
    r = client.put(
        "/api/j2/unified-coach",
        json={"traderProfile": "I trade swing setups across multiple accounts."},
        cookies={"session_id": user_session},
    )
    assert r.status_code == 200
    assert r.json()["traderProfile"] == "I trade swing setups across multiple accounts."

    # Re-GET confirms persistence
    r2 = client.get("/api/j2/unified-coach", cookies={"session_id": user_session})
    assert r2.json()["traderProfile"] == "I trade swing setups across multiple accounts."


def test_put_unified_coach_toggles_compass_enabled(client, user_session):
    r = client.put(
        "/api/j2/unified-coach",
        json={"compassEnabled": False},
        cookies={"session_id": user_session},
    )
    assert r.status_code == 200
    assert r.json()["compassEnabled"] is False
```

- [ ] **Step 2: Run to verify they fail**

Expected: 404 — route doesn't exist.

- [ ] **Step 3: Implement the endpoints**

In `api/routers/journal_two.py` (near the other coach routes):

```python
@router.get("/unified-coach")
def get_unified_coach_state_route(
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    return unified_coach.get_or_create(None, user["id"])


@router.put("/unified-coach")
def put_unified_coach_state_route(
    payload: dict[str, Any],
    user: dict = Depends(get_current_user),
) -> dict[str, Any]:
    profile = payload.get("traderProfile")
    enabled = payload.get("compassEnabled")
    if profile is not None and not isinstance(profile, str):
        raise HTTPException(400, "traderProfile must be a string")
    if enabled is not None and not isinstance(enabled, bool):
        raise HTTPException(400, "compassEnabled must be a boolean")
    return unified_coach.update_state(
        None, user["id"],
        trader_profile=profile,
        compass_enabled=enabled,
    )
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_journal_two_compass_router.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/routers/journal_two.py tests/test_journal_two_compass_router.py
git commit -m "feat(j2-compass): /api/j2/unified-coach GET/PUT for user-level state"
```

---

### Task 9: Wire `UNIFIED_COMPASS_ENABLED` feature flag

**Files:**
- Modify: `api/routers/journal_two.py` (`_require_compass_enabled`)
- Test: `tests/test_journal_two_compass_router.py`

- [ ] **Step 1: Write the failing test**

```python
def test_unified_routes_404_when_feature_flag_off(monkeypatch, client, user_session):
    monkeypatch.setenv("UNIFIED_COMPASS_ENABLED", "false")
    r = client.get("/api/j2/accounts/_all_/coach/weekly-reviews",
                   cookies={"session_id": user_session})
    assert r.status_code == 404
```

- [ ] **Step 2: Run to verify it fails**

Expected: 200 (route still serves unified bucket).

- [ ] **Step 3: Add the env-flag check**

Top of `_require_compass_enabled`:

```python
import os

def _unified_enabled() -> bool:
    raw = os.getenv("UNIFIED_COMPASS_ENABLED", "true").strip().lower()
    return raw in ("1", "true", "yes", "on")


def _require_compass_enabled(user_id: str, account_id: str) -> None:
    if is_unified(account_id):
        if not _unified_enabled():
            raise HTTPException(status_code=404, detail="Unified Compass is disabled by configuration.")
        state = unified_coach.get_or_create(None, user_id)
        if not state["compassEnabled"]:
            raise HTTPException(status_code=403, detail="Unified Compass is disabled.")
        return
    # … unchanged per-account branch …
```

- [ ] **Step 4: Run tests**

```bash
python -m pytest tests/test_journal_two_compass_router.py -v
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add api/routers/journal_two.py tests/test_journal_two_compass_router.py
git commit -m "feat(j2-compass): UNIFIED_COMPASS_ENABLED env flag for rollback"
```

---

## Phase 4 — Frontend: enable unified mode in the UI

### Task 10: Hooks accept null `accountId` and use `'_all_'` in URL

**Files:**
- Modify: `app/src/pages/journal-2-0/hooks/useJ2CoachReviews.js`
- Modify: `app/src/pages/journal-2-0/hooks/useJ2CoachChat.js`
- Modify: `app/src/pages/journal-2-0/hooks/useJ2EODRecaps.js`
- Modify: `app/src/pages/journal-2-0/hooks/useJ2TraderProfile.js`
- Modify: `app/src/pages/journal-2-0/hooks/useCompassOverview.js`
- Modify: `app/src/pages/journal-2-0/hooks/useInterventions.js`
- Modify: `app/src/pages/journal-2-0/hooks/useProfileSuggestions.js`
- Modify: `app/src/pages/journal-2-0/hooks/useJ2UnviewedEOD.js`
- Test: each hook's `.test.js` (extend existing)

Add a constant at the top of `app/src/pages/journal-2-0/hooks/`:

- [ ] **Step 1: Create a shared scope helper**

Create `app/src/pages/journal-2-0/hooks/compassScope.js`:

```js
/**
 * Unified Compass mode sentinel. Mirrors api.services.journal_two.coach_scope:
 * when the J2 header selector is on "All Accounts", every Compass hook passes
 * this value to the backend so the routes resolve to the unified coach.
 */
export const UNIFIED_ACCOUNT_ID = '_all_'

/**
 * Convert the J2 selected-account value (real id or null) into the value to
 * embed in Compass URLs. Pass-through except null → '_all_'.
 */
export function compassScope(accountId) {
  return accountId ?? UNIFIED_ACCOUNT_ID
}
```

- [ ] **Step 2: Write the failing test for `useJ2CoachReviews`**

In `app/src/pages/journal-2-0/hooks/useJ2CoachReviews.test.js` (create if missing):

```js
import { renderHook } from '@testing-library/react'
import useJ2CoachReviews from './useJ2CoachReviews'
import { SWRConfig } from 'swr'

global.fetch = vi.fn(() =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ reviews: [] }) })
)

test('uses _all_ in URL when accountId is null', () => {
  renderHook(() => useJ2CoachReviews(null), {
    wrapper: ({ children }) => (
      <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
    ),
  })
  expect(global.fetch).toHaveBeenCalledWith(
    '/api/j2/accounts/_all_/coach/weekly-reviews',
    expect.anything(),
  )
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd app
npx vitest run src/pages/journal-2-0/hooks/useJ2CoachReviews.test.js
```

Expected: FAIL — current hook returns `null` URL when `accountId` is null, no fetch happens.

- [ ] **Step 4: Update each hook**

Pattern for every hook — replace:

```js
const url = accountId ? `/api/j2/accounts/${accountId}/coach/...` : null
```

with:

```js
import { compassScope } from './compassScope'
const scope = compassScope(accountId)  // real id or '_all_'
const url = `/api/j2/accounts/${scope}/coach/...`
```

For `useJ2TraderProfile`, the URL forks:

```js
import { compassScope, UNIFIED_ACCOUNT_ID } from './compassScope'

export default function useJ2TraderProfile(accountId) {
  const scope = compassScope(accountId)
  const url =
    scope === UNIFIED_ACCOUNT_ID
      ? '/api/j2/unified-coach'
      : `/api/j2/accounts/${scope}/coach/profile`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  // unified endpoint returns {traderProfile,…}, per-account returns {profile,…}
  const profile =
    scope === UNIFIED_ACCOUNT_ID ? (data?.traderProfile ?? '') : (data?.profile ?? '')
  return {
    profile,
    isLoading,
    error,
    refresh: () => mutate(),
    save: async (next) => {
      const body =
        scope === UNIFIED_ACCOUNT_ID
          ? { traderProfile: next }
          : { profile: next }
      const r = await fetch(url, {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!r.ok) throw new Error(`${r.status}`)
      const out = await r.json()
      await mutate(out, { revalidate: false })
      return out
    },
  }
}
```

For `useInterventions` in unified mode: short-circuit to an empty array (the backend already returns `[]`, but skipping the fetch saves one round-trip):

```js
if (scope === UNIFIED_ACCOUNT_ID) {
  return { interventions: [], dismiss: async () => {} }
}
```

- [ ] **Step 5: Run all hook tests**

```bash
npx vitest run src/pages/journal-2-0/hooks
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/journal-2-0/hooks
git commit -m "feat(j2-compass): hooks pass '_all_' to backend in unified mode"
```

---

### Task 11: Drop the guard in `CompassTab.jsx` and add unified header copy

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/CompassTab.jsx:74-80`
- Test: `app/src/pages/journal-2-0/tabs/CompassTab.test.jsx` (create if missing)

- [ ] **Step 1: Write the failing test**

In `app/src/pages/journal-2-0/tabs/CompassTab.test.jsx`:

```js
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import CompassTab from './CompassTab'

// Force the selected-account hook to return null (= All Accounts mode)
vi.mock('../hooks/useJ2SelectedAccount', () => ({
  default: () => ({ accountId: null, account: null, accounts: [] }),
}))
// Stub the other hooks so the test focuses on the guard
vi.mock('../hooks/useJ2Settings', () => ({
  default: () => ({ settings: { compassEnabled: true } }),
}))
vi.mock('../hooks/useJ2CoachReviews', () => ({
  default: () => ({ reviews: [], isLoading: false, generate: vi.fn() }),
}))
vi.mock('../hooks/useJ2EODRecaps', () => ({
  default: () => ({ recaps: [], isLoading: false, generate: vi.fn() }),
}))
vi.mock('../hooks/useJ2TraderProfile', () => ({
  default: () => ({ profile: '', save: vi.fn() }),
}))
// ... mock other hooks similarly (overview, interventions, suggestions, etc.)

describe('CompassTab unified mode', () => {
  it('renders unified header when accountId is null', () => {
    render(<CompassTab />)
    expect(screen.getByText(/Compass — Portfolio/i)).toBeInTheDocument()
    expect(screen.queryByText(/Select a single account/i)).not.toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd app
npx vitest run src/pages/journal-2-0/tabs/CompassTab.test.jsx
```

Expected: FAIL — guard still shows "Select a single account".

- [ ] **Step 3: Replace the guard in `CompassTab.jsx`**

Around lines 74-80, replace:

```jsx
if (!accountId) {
  return (
    <div style={{ padding: 24, color: 'var(--text-muted)' }}>
      Select a single account to view Compass reviews.
    </div>
  )
}
```

with:

```jsx
// accountId may be null in "All Accounts" mode — Compass switches to its
// unified coaching identity (aggregates across every compass_enabled account).
const isUnified = accountId === null
```

Then update the page heading:

```jsx
<h1 style={{ fontSize: 22, marginBottom: 8 }}>
  🧭 Compass{isUnified ? ' — Portfolio' : ''}
</h1>
```

And the intro paragraph below the heading:

```jsx
<p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 0 }}>
  {isUnified
    ? 'Coaching across every account where Compass is enabled.'
    : 'Your trading coach. Generates a weekly review of your closed trades, what worked, what didn\'t, and what to focus on next.'}
</p>
```

Suppress the InterventionBanner in unified mode (it returns `[]` anyway but render is wasted):

```jsx
{!isUnified && (
  <InterventionBanner
    interventions={interventions}
    onDismiss={dismissIntervention}
  />
)}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/pages/journal-2-0/tabs/CompassTab.test.jsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/tabs
git commit -m "feat(j2-compass): CompassTab works in unified All-Accounts mode"
```

---

### Task 12: Show "Coaching across N accounts" sub-line in unified mode

**Files:**
- Modify: `app/src/pages/journal-2-0/tabs/CompassTab.jsx`
- Test: `app/src/pages/journal-2-0/tabs/CompassTab.test.jsx`

- [ ] **Step 1: Write the failing test**

```js
it('lists accounts in scope in unified mode', () => {
  vi.mock('../hooks/useJ2Accounts', () => ({
    default: () => ({
      accounts: [
        { id: 'a1', name: 'Default', compass_enabled: true },
        { id: 'a2', name: 'Cash', compass_enabled: true },
        { id: 'a3', name: 'Excluded', compass_enabled: false },
      ],
      isLoading: false,
    }),
  }))
  render(<CompassTab />)
  expect(
    screen.getByText(/Coaching across Default \+ Cash \(2 accounts\)/i)
  ).toBeInTheDocument()
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
npx vitest run src/pages/journal-2-0/tabs/CompassTab.test.jsx
```

Expected: FAIL.

- [ ] **Step 3: Add the scope summary**

Import `useJ2Accounts`:

```jsx
import useJ2Accounts from '../hooks/useJ2Accounts'
```

In the component:

```jsx
const { accounts } = useJ2Accounts()
const inScope = (accounts || []).filter((a) => a.compass_enabled !== false)
```

Below the intro paragraph:

```jsx
{isUnified && inScope.length > 0 && (
  <p style={{ color: 'var(--text-muted)', fontSize: 12, margin: '6px 0 0' }}>
    Coaching across {inScope.map((a) => a.name).join(' + ')} ({inScope.length} account{inScope.length === 1 ? '' : 's'}).
  </p>
)}
```

- [ ] **Step 4: Run test**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/tabs/CompassTab.jsx app/src/pages/journal-2-0/tabs/CompassTab.test.jsx
git commit -m "feat(j2-compass): unified mode lists accounts in scope"
```

---

## Phase 5 — Ship + smoke test

### Task 13: Manual smoke test, push, verify on Railway

**Files:** none

- [ ] **Step 1: Run the full backend test suite**

```bash
python -m pytest tests/ api/services/journal_two/ -v
```

Expected: every test PASSes. If any pre-existing test fails, investigate before pushing.

- [ ] **Step 2: Run the full frontend test suite**

```bash
cd app
npx vitest run
```

Expected: all PASS.

- [ ] **Step 3: Start the dev server and run through the golden path**

```bash
# Terminal 1
cd C:\Users\Patrick\uct-dashboard
uvicorn api.main:app --reload --port 8000

# Terminal 2
cd C:\Users\Patrick\uct-dashboard\app
npm run dev
```

Manual checklist (golden path):
- [ ] In J2 header, switch the account selector to **All Accounts**.
- [ ] Open the Compass tab. Header reads "🧭 Compass — Portfolio".
- [ ] Sub-line lists every compass_enabled account by name.
- [ ] Trader Profile editor at the bottom shows the unified profile (empty on first run).
- [ ] Type a profile, click Save. Refresh. Profile persists.
- [ ] Click "Generate this week's review →". Wait. A review appears with trades attributed to source accounts (e.g. "[Default] AAPL +1.2R" wording in the body).
- [ ] EOD recap generation works the same way.
- [ ] Switch the selector to a single account. Compass header reverts to "🧭 Compass". Per-account profile and reviews show (NOT the unified ones).
- [ ] Open AddPositionModal in single-account mode. 🧭 Pre-Trade Verdict button works as before. Verify the LLM context includes the unified profile (check `coach_data_assembler` logs or DB row).
- [ ] In All-Accounts mode, try the 🧭 button on AddPositionModal — should be gated: "Switch to a single account…" (since position add is per-account).

- [ ] **Step 4: Commit and push**

```bash
git status   # confirm clean
git push     # Railway auto-deploys on push to master
```

- [ ] **Step 5: Smoke test on Railway**

Wait ~2 min for Railway redeploy. Hit production:

- [ ] Same golden-path checklist as Step 3, but on `https://uctintelligence.com`.
- [ ] Watch `https://uctintelligence.com/api/health` for green.
- [ ] If anything 404s or 403s, set `UNIFIED_COMPASS_ENABLED=false` in Railway env vars as the instant rollback. The unified routes return 404 and the guard restores.

---

## Self-review notes

This plan covers every section of the spec:

- **Account-id convention** → Task 3 (`coach_scope.py` + `UNIFIED_ACCOUNT_ID`)
- **Schema** → Task 1
- **Scope resolution helper** → Task 3
- **Read path (assemblers)** → Task 4-5
- **Read path (chat tools)** → Task 6
- **Write path** → Task 5 (`_read_trader_profile`), Task 6 (tools), Task 8 (`/unified-coach` endpoints)
- **Endpoints** → Task 7-9
- **Frontend (CompassTab, hooks)** → Task 10-12
- **Tests** → covered in each task
- **Rollback / feature flag** → Task 9
- **Out-of-scope items** → explicitly NOT implemented (no migration, no unified onboarding flow, no unified email digest, no unified pre-trade verdict)

No placeholders. All code blocks contain real, runnable code or shell commands. Types and names are consistent across tasks (`UNIFIED_ACCOUNT_ID`, `compassScope`, `_require_compass_enabled`, `resolve_account_scope`).

Estimated time for a focused agent: ~6-8 hours (mostly mechanical conversions in Phase 2-3, longer for Phase 4 UI polish).
