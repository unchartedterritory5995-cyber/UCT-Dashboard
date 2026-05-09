# Journal 2.0 Discipline — Phase B: Daily / Session Discipline

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Add three per-account session-level discipline guards (daily loss lockout, cooling-off after a loss, no-trade time windows) that intervene at trade-entry time via a shared `DisciplineLockBanner` driven by a new `/api/j2/accounts/{id}/discipline/state` endpoint.

**Architecture:** All three guards share infrastructure: one settings shape, one server-side compute service, one state endpoint, one polled SWR hook, one shared banner component, one Save-disable rule applied to both AddPosition and AddTrade. Phase A's banner/override pattern is reused exactly — just driven by server state instead of client-derived risk.

**Tech Stack:** SQLite (extending `j2_accounts`), FastAPI router (`journal_two.py`), Python `zoneinfo` for ET handling, React + SWR (5s polling while a J2 modal is open), vitest, pytest.

**Why this scope:**
- All three settings are **optional** (null/empty = disabled). Existing accounts behave identically.
- Cooling-off uses `j2_trades.exit_date` directly — that column already stores full ISO timestamps (verified). **No schema change to `j2_trades`.**
- Soft-block pattern from Phase A is reused exactly: red banner + Override button + Save disabled until override armed. Friction is the feature.
- No-trade windows use `America/New_York` for evaluation. Stored as `[{start: "HH:MM", end: "HH:MM", label?}]`.
- Override resets when *any* of the relevant inputs in the modal change (mirrors Phase A) — *and* when the underlying state changes (e.g., new minute in a no-trade window, the override clears once the window closes naturally).

---

## File map

**Backend:**
- Modify: `api/services/journal_two/db.py` — 3 ALTERs on `j2_accounts` (idempotent)
- Modify: `api/services/journal_two/settings.py` — extend `default_settings_data`, `validate_settings_payload`; add `_validate_no_trade_windows` helper; tests
- Modify: `api/services/journal_two/accounts.py` — extend `_default_settings_block`, `_account_to_settings`, `upsert_account_settings`; tests
- Create: `api/services/journal_two/discipline.py` — `compute_discipline_state(user_id, account_id, now=None) -> dict`
- Create: `api/services/journal_two/test_discipline.py` — unit tests
- Modify: `api/routers/journal_two.py` — `GET /accounts/{id}/discipline/state` endpoint

**Frontend:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2DisciplineState.js` — SWR with 5s refresh
- Create: `app/src/pages/journal-2-0/components/DisciplineLockBanner.jsx` — shared banner component
- Create: `app/src/pages/journal-2-0/components/NoTradeWindowsEditor.jsx` — list editor for windows
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx` — extend ENTRY DEFAULTS & GUARDS section with 3 new controls
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx` — mount banner + integrate Save soft-block
- Modify: `app/src/pages/journal-2-0/components/AddTradeModal.jsx` — same
- Test: `app/src/pages/journal-2-0/components/NoTradeWindowsEditor.test.jsx`
- Test: extend `PortfolioSettingsModal.test.jsx` with one round-trip case

---

## Settings shape (canonical, after this phase)

```js
{
  // ... existing fields ...
  defaultSizePct: null,
  defaultRMultipleTarget: null,
  maxRiskPerTradePct: null,

  // NEW Phase B (all optional; null/empty = disabled):
  dailyLossLimitPct: null,            // % of accountSize (e.g. 2 = lock at -2%)
  coolingOffMinutesAfterLoss: null,   // positive integer (e.g. 15 = lock for 15 min after any loss exit)
  noTradeWindowsET: [],               // [{start: "11:30", end: "13:30", label: "Lunch chop"}]
}
```

## Discipline-state response shape

```json
{
  "locked": true,
  "reasons": [
    { "type": "daily_loss",        "message": "Down -2.4% today (limit: -2%)", "severity": "block" },
    { "type": "cooling_off",       "message": "Cooling off after loss",         "unlockAt": "2026-05-09T20:14:00Z", "severity": "block" },
    { "type": "no_trade_window",   "message": "Lunch chop window", "unlockAt": "2026-05-09T18:30:00Z", "severity": "block" }
  ],
  "todaysPnlDollar": -2400,
  "todaysPnlPct": -2.4,
  "computedAt": "2026-05-09T17:55:00Z"
}
```

`reasons` is an array — multiple guards can fire at once. `unlockAt` is optional ISO UTC timestamp the client uses to render countdown. `locked = (reasons.length > 0)`. When all three settings are null/empty, the response is `{locked: false, reasons: [], todaysPnlDollar: <real>, todaysPnlPct: <real>, computedAt: ...}`.

---

## Task 1: Backend schema migration

**Files:**
- Modify: `api/services/journal_two/db.py`

- [ ] **Step 1: Append 3 idempotent ALTERs to `_PHASE_2_ALTERS`**

After the Phase A entries added previously:

```python
    # Phase B — Session Discipline (nullable scalars; null = disabled)
    "ALTER TABLE j2_accounts ADD COLUMN daily_loss_limit_pct REAL",
    "ALTER TABLE j2_accounts ADD COLUMN cooling_off_minutes_after_loss INTEGER",
    "ALTER TABLE j2_accounts ADD COLUMN no_trade_windows_et TEXT NOT NULL DEFAULT '[]'",
```

The first two are nullable. The third has a NOT NULL default of `'[]'` (empty JSON array) — same defensive pattern as `setups`, `breakeven_range`.

- [ ] **Step 2: Run accounts test suite**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/test_accounts.py -q
```

Expected: 24 passing (no regressions).

- [ ] **Step 3: Commit**

```bash
git add api/services/journal_two/db.py
git commit -m "feat(j2-discipline): add 3 columns to j2_accounts for session-discipline settings"
```

---

## Task 2: Settings validators

**Files:**
- Modify: `api/services/journal_two/settings.py`
- Modify: `api/services/journal_two/test_settings.py`

- [ ] **Step 1: TDD — write failing tests**

Append to `test_settings.py`:

```python
def test_validate_accepts_phase_b_guards():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "dailyLossLimitPct": 2,
        "coolingOffMinutesAfterLoss": 15,
        "noTradeWindowsET": [
            {"start": "11:30", "end": "13:30", "label": "Lunch chop"},
            {"start": "09:30", "end": "09:45"},
        ],
    }
    out = svc.validate_settings_payload(payload)
    assert out["dailyLossLimitPct"] == 2.0
    assert out["coolingOffMinutesAfterLoss"] == 15
    assert out["noTradeWindowsET"] == [
        {"start": "11:30", "end": "13:30", "label": "Lunch chop"},
        {"start": "09:30", "end": "09:45", "label": ""},
    ]


def test_validate_phase_b_guards_default_to_none_or_empty():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["dailyLossLimitPct"] is None
    assert out["coolingOffMinutesAfterLoss"] is None
    assert out["noTradeWindowsET"] == []


def test_validate_phase_b_guards_reject_invalid():
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    base = _baseline_payload()
    invalid = [
        # Daily loss limit
        {"dailyLossLimitPct": -1},                                   # negative
        {"dailyLossLimitPct": 100},                                  # >=100
        # Cooling-off
        {"coolingOffMinutesAfterLoss": 0},                           # not > 0
        {"coolingOffMinutesAfterLoss": 1.5},                         # not integer
        # No-trade windows
        {"noTradeWindowsET": "11:30-13:30"},                         # not a list
        {"noTradeWindowsET": [{"start": "25:00", "end": "13:00"}]},  # invalid HH:MM
        {"noTradeWindowsET": [{"start": "11:30", "end": "11:30"}]},  # zero-length
        {"noTradeWindowsET": [{"start": "13:00", "end": "11:00"}]},  # end before start (no overnight allowed in v1)
    ]
    for bad in invalid:
        with pytest.raises(SettingsValidationError):
            svc.validate_settings_payload(base | bad)
```

Run — expect failures.

- [ ] **Step 2: Implement validator extensions**

In `default_settings_data()`, append:

```python
        "dailyLossLimitPct": None,
        "coolingOffMinutesAfterLoss": None,
        "noTradeWindowsET": [],
```

Add helpers above `validate_settings_payload`:

```python
def _validate_optional_positive_int(value: Any, field_name: str) -> int | None:
    """Optional positive integer. None/'' = disabled."""
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise SettingsValidationError(f"{field_name} must be a positive integer or null")
    if value <= 0:
        raise SettingsValidationError(f"{field_name} must be > 0")
    return value


_HHMM_RE = __import__("re").compile(r"^([01]\d|2[0-3]):([0-5]\d)$")


def _validate_no_trade_windows(value: Any) -> list[dict[str, str]]:
    """List of {start: 'HH:MM', end: 'HH:MM', label?}. Empty list = disabled."""
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise SettingsValidationError("noTradeWindowsET must be a list")
    out: list[dict[str, str]] = []
    for i, w in enumerate(value):
        if not isinstance(w, dict):
            raise SettingsValidationError(f"noTradeWindowsET[{i}] must be an object")
        start = w.get("start")
        end = w.get("end")
        label = w.get("label", "")
        if not isinstance(start, str) or not _HHMM_RE.match(start):
            raise SettingsValidationError(f"noTradeWindowsET[{i}].start must be HH:MM (24-hour)")
        if not isinstance(end, str) or not _HHMM_RE.match(end):
            raise SettingsValidationError(f"noTradeWindowsET[{i}].end must be HH:MM (24-hour)")
        if not isinstance(label, str):
            raise SettingsValidationError(f"noTradeWindowsET[{i}].label must be a string")
        if start >= end:
            raise SettingsValidationError(
                f"noTradeWindowsET[{i}]: end must be after start (overnight windows not supported in v1)"
            )
        out.append({"start": start, "end": end, "label": label.strip()})
    return out
```

In `validate_settings_payload` return, append three new entries after the Phase A block:

```python
        # Phase B
        "dailyLossLimitPct": _validate_optional_pct(payload.get("dailyLossLimitPct"), "dailyLossLimitPct"),
        "coolingOffMinutesAfterLoss": _validate_optional_positive_int(
            payload.get("coolingOffMinutesAfterLoss"), "coolingOffMinutesAfterLoss",
        ),
        "noTradeWindowsET": _validate_no_trade_windows(payload.get("noTradeWindowsET", [])),
```

- [ ] **Step 3: Run tests to confirm pass**

```bash
python -m pytest api/services/journal_two/test_settings.py -q
```

Expected: 22 tests pass (19 prior + 3 new).

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/settings.py api/services/journal_two/test_settings.py
git commit -m "feat(j2-discipline): validate Phase B session-guard settings"
```

---

## Task 3: Backend accounts.py round-trip

**Files:**
- Modify: `api/services/journal_two/accounts.py`
- Modify: `api/services/journal_two/test_accounts.py`

- [ ] **Step 1: TDD — append failing test**

```python
def test_phase_b_guards_roundtrip(db_conn):
    user_id = "u_phase_b_roundtrip"
    account = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
        "dailyLossLimitPct": 2,
        "coolingOffMinutesAfterLoss": 15,
        "noTradeWindowsET": [{"start": "11:30", "end": "13:30", "label": "Lunch"}],
    }
    saved = accounts_service.upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["dailyLossLimitPct"] == 2.0
    assert saved["coolingOffMinutesAfterLoss"] == 15
    assert saved["noTradeWindowsET"] == [{"start": "11:30", "end": "13:30", "label": "Lunch"}]

    fresh = accounts_service.get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["dailyLossLimitPct"] == 2.0
    assert fresh["coolingOffMinutesAfterLoss"] == 15
    assert fresh["noTradeWindowsET"] == [{"start": "11:30", "end": "13:30", "label": "Lunch"}]
```

Run — expect KeyError on `dailyLossLimitPct`.

- [ ] **Step 2: Wire reads/writes in accounts.py**

In `_default_settings_block()`, append:
```python
        "dailyLossLimitPct": None,
        "coolingOffMinutesAfterLoss": None,
        "noTradeWindowsET": [],
```

In `_account_to_settings()` return dict, append three new lines BEFORE `createdAt`:
```python
            "dailyLossLimitPct": row["daily_loss_limit_pct"] if "daily_loss_limit_pct" in keys else None,
            "coolingOffMinutesAfterLoss": row["cooling_off_minutes_after_loss"] if "cooling_off_minutes_after_loss" in keys else None,
            "noTradeWindowsET": json.loads(row["no_trade_windows_et"]) if "no_trade_windows_et" in keys else [],
```

In `upsert_account_settings()` UPDATE, extend SET clause + tuple. Place new columns after `max_risk_per_trade_pct`:

```python
                   max_risk_per_trade_pct = ?,
                   daily_loss_limit_pct = ?,
                   cooling_off_minutes_after_loss = ?,
                   no_trade_windows_et = ?,
                   updated_at = ?
```

And matching tuple values:
```python
                full_validated.get("maxRiskPerTradePct"),
                full_validated.get("dailyLossLimitPct"),
                full_validated.get("coolingOffMinutesAfterLoss"),
                json.dumps(full_validated.get("noTradeWindowsET", [])),
                now, account_id, user_id,
```

INSERT paths in `get_or_migrate_default_account` and `create_account` need NO change — null defaults plus the `no_trade_windows_et` column having a SQL `DEFAULT '[]'` cover the gaps.

- [ ] **Step 3: Run tests**

```bash
python -m pytest api/services/journal_two/test_accounts.py -q
```

Expected: 25 passing (24 prior + 1 new).

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/accounts.py api/services/journal_two/test_accounts.py
git commit -m "feat(j2-discipline): persist Phase B settings on j2_accounts"
```

---

## Task 4: discipline.py service

**Files:**
- Create: `api/services/journal_two/discipline.py`
- Create: `api/services/journal_two/test_discipline.py`

- [ ] **Step 1: TDD — write failing tests**

Create `test_discipline.py`:

```python
"""Tests for the discipline state computation."""
from __future__ import annotations

import json
import sqlite3
import uuid
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from api.services.journal_two import discipline as disc
from api.services.journal_two import accounts as accounts_service
from api.services.journal_two import db as schema


ET = ZoneInfo("America/New_York")


@pytest.fixture
def db_conn():
    conn = sqlite3.connect(":memory:")
    conn.row_factory = sqlite3.Row
    schema.ensure_schema(conn)
    yield conn
    conn.close()


def _seed_account(db_conn, user_id="u_disc"):
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, pnl_dollar, exit_iso, result="Loss"):
    """Helper to drop a closed trade with a specific exit timestamp."""
    conn.execute(
        """
        INSERT INTO j2_trades (
            id, user_id, position_id, symbol, side, shares,
            entry_price, entry_date, exit_price, exit_date,
            original_stop, setup, notes, pnl_dollar, pnl_percent,
            r_multiple, hold_days, result, context_at_entry,
            created_at, account_id
        )
        VALUES (?, ?, ?, 'TEST', 'Long', 100, 100, ?, 99, ?, 99,
                NULL, NULL, ?, -1, NULL, 1, ?, '{}', ?, ?)
        """,
        (
            str(uuid.uuid4()), user_id, str(uuid.uuid4()),
            exit_iso, exit_iso, pnl_dollar, result,
            exit_iso, account_id,
        ),
    )
    conn.commit()


def test_no_settings_means_unlocked(db_conn):
    acc = _seed_account(db_conn)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert state["locked"] is False
    assert state["reasons"] == []
    assert state["todaysPnlDollar"] == 0
    assert state["todaysPnlPct"] == 0


def test_daily_loss_limit_locks_when_breached(db_conn):
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "dailyLossLimitPct": 2},
        conn=db_conn,
    )
    # Today's loss exceeds 2% of 100k => need <= -2000
    today_et = datetime.now(ET).date()
    exit_iso = datetime.combine(today_et, datetime.min.time(), tzinfo=ET).astimezone(timezone.utc).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-2500, exit_iso=exit_iso)

    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert state["locked"] is True
    assert any(r["type"] == "daily_loss" for r in state["reasons"])


def test_cooling_off_locks_within_window(db_conn):
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "coolingOffMinutesAfterLoss": 15},
        conn=db_conn,
    )
    # Loss exit 5 minutes ago => still locked
    five_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-100, exit_iso=five_min_ago)

    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    cooling = next((r for r in state["reasons"] if r["type"] == "cooling_off"), None)
    assert cooling is not None
    assert "unlockAt" in cooling


def test_cooling_off_clears_after_window(db_conn):
    acc = _seed_account(db_conn)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "coolingOffMinutesAfterLoss": 15},
        conn=db_conn,
    )
    twenty_min_ago = (datetime.now(timezone.utc) - timedelta(minutes=20)).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-100, exit_iso=twenty_min_ago)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn)
    assert not any(r["type"] == "cooling_off" for r in state["reasons"])


def test_no_trade_window_locks_during_window(db_conn):
    acc = _seed_account(db_conn)
    # Inject a window covering "now" in ET — compute via injected `now` param
    now_et = datetime.now(ET)
    start = (now_et - timedelta(minutes=10)).strftime("%H:%M")
    end = (now_et + timedelta(minutes=10)).strftime("%H:%M")
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(), "noTradeWindowsET": [{"start": start, "end": end, "label": "Test"}]},
        conn=db_conn,
    )
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn, now=now_et)
    assert any(r["type"] == "no_trade_window" for r in state["reasons"])


def test_multiple_reasons_can_fire_simultaneously(db_conn):
    acc = _seed_account(db_conn)
    now_et = datetime.now(ET)
    accounts_service.upsert_account_settings(
        "u_disc", acc["id"],
        {**_baseline_payload(),
         "dailyLossLimitPct": 2,
         "coolingOffMinutesAfterLoss": 15,
         "noTradeWindowsET": [{"start": (now_et - timedelta(minutes=5)).strftime("%H:%M"),
                               "end":   (now_et + timedelta(minutes=5)).strftime("%H:%M"),
                               "label": "Test"}]},
        conn=db_conn,
    )
    today_et = datetime.now(ET).date()
    exit_iso = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()
    _insert_trade(db_conn, user_id="u_disc", account_id=acc["id"], pnl_dollar=-3000, exit_iso=exit_iso)
    state = disc.compute_discipline_state("u_disc", acc["id"], conn=db_conn, now=now_et)
    types = {r["type"] for r in state["reasons"]}
    assert {"daily_loss", "cooling_off", "no_trade_window"} <= types


def _baseline_payload():
    return {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": [],
        "shareJournalData": False,
        "tradingMode": "both",
    }
```

Run — expect ImportError.

- [ ] **Step 2: Implement the service**

Create `api/services/journal_two/discipline.py`:

```python
"""
Journal 2.0 — session-discipline state computation (Phase B).

Computes whether a single account is currently locked from new trades,
and the human-readable reasons. Pure read; never mutates DB rows.

Three guard types:
  - daily_loss: today's realized P&L (sum of j2_trades closed today, ET) breached -X% of accountSize
  - cooling_off: most-recent losing trade exit was within N minutes of `now`
  - no_trade_window: `now` (in ET) falls within any user-defined HH:MM window

Caller passes `now` for testability; defaults to `datetime.now(timezone.utc)`.
"""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from api.services.auth_db import get_connection
from api.services.journal_two import accounts as accounts_service


ET = ZoneInfo("America/New_York")


def compute_discipline_state(
    user_id: str,
    account_id: str,
    *,
    conn: sqlite3.Connection | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Return the locked/reasons/today's-pnl state for one account."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        settings = accounts_service.get_account_settings(user_id, account_id, conn=conn)
        if settings is None:
            return _empty_state(now or datetime.now(timezone.utc))

        now_utc = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
        now_et = now_utc.astimezone(ET)

        # Today's P&L (sum of j2_trades closed today in ET)
        today_pnl = _todays_pnl(conn, user_id, account_id, now_et)
        account_size = float(settings.get("accountSize") or 0)
        today_pnl_pct = (today_pnl / account_size * 100.0) if account_size > 0 else 0.0

        reasons: list[dict[str, Any]] = []

        # 1) Daily loss limit
        cap = settings.get("dailyLossLimitPct")
        if cap is not None and account_size > 0 and today_pnl_pct <= -float(cap):
            reasons.append({
                "type": "daily_loss",
                "message": f"Down {today_pnl_pct:.2f}% today (limit: -{cap}%)",
                "severity": "block",
            })

        # 2) Cooling off
        cool_min = settings.get("coolingOffMinutesAfterLoss")
        if cool_min is not None and cool_min > 0:
            last_loss_at = _last_loss_exit(conn, user_id, account_id)
            if last_loss_at is not None:
                unlock_at = last_loss_at + timedelta(minutes=int(cool_min))
                if now_utc < unlock_at:
                    reasons.append({
                        "type": "cooling_off",
                        "message": f"Cooling off after loss ({cool_min} min)",
                        "unlockAt": unlock_at.isoformat(),
                        "severity": "block",
                    })

        # 3) No-trade windows (ET, no overnight)
        windows = settings.get("noTradeWindowsET") or []
        for w in windows:
            start_dt, end_dt = _window_bounds_today(now_et, w["start"], w["end"])
            if start_dt <= now_et < end_dt:
                reasons.append({
                    "type": "no_trade_window",
                    "message": w.get("label") or f"No-trade window {w['start']}-{w['end']} ET",
                    "unlockAt": end_dt.astimezone(timezone.utc).isoformat(),
                    "severity": "block",
                })

        return {
            "locked": len(reasons) > 0,
            "reasons": reasons,
            "todaysPnlDollar": round(today_pnl, 2),
            "todaysPnlPct": round(today_pnl_pct, 2),
            "computedAt": now_utc.isoformat(),
        }
    finally:
        if owned:
            conn.close()


def _empty_state(now_utc: datetime) -> dict[str, Any]:
    return {
        "locked": False,
        "reasons": [],
        "todaysPnlDollar": 0,
        "todaysPnlPct": 0,
        "computedAt": now_utc.astimezone(timezone.utc).isoformat(),
    }


def _todays_pnl(conn: sqlite3.Connection, user_id: str, account_id: str, now_et: datetime) -> float:
    """Sum of pnl_dollar for trades whose exit_date (UTC ISO) falls on the
    current ET calendar day. We can't filter in SQL by ET date directly,
    so we widen by ±1 day in UTC and bucket precisely in Python."""
    today_et_date = now_et.date()
    day_start_et = datetime.combine(today_et_date, datetime.min.time(), tzinfo=ET)
    day_end_et = day_start_et + timedelta(days=1)
    day_start_utc = day_start_et.astimezone(timezone.utc).isoformat()
    day_end_utc = day_end_et.astimezone(timezone.utc).isoformat()

    rows = conn.execute(
        """
        SELECT pnl_dollar, exit_date FROM j2_trades
         WHERE user_id = ? AND account_id = ?
           AND exit_date >= ? AND exit_date < ?
        """,
        (user_id, account_id, day_start_utc, day_end_utc),
    ).fetchall()
    return sum(float(r["pnl_dollar"] or 0) for r in rows)


def _last_loss_exit(conn: sqlite3.Connection, user_id: str, account_id: str) -> datetime | None:
    """Return the most-recent losing trade's exit timestamp as a UTC datetime,
    or None if none exist."""
    row = conn.execute(
        """
        SELECT exit_date FROM j2_trades
         WHERE user_id = ? AND account_id = ? AND result = 'Loss'
         ORDER BY exit_date DESC LIMIT 1
        """,
        (user_id, account_id),
    ).fetchone()
    if row is None or not row["exit_date"]:
        return None
    try:
        dt = datetime.fromisoformat(str(row["exit_date"]).replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def _window_bounds_today(now_et: datetime, start_hhmm: str, end_hhmm: str) -> tuple[datetime, datetime]:
    """Build today's start/end datetimes in ET for an HH:MM window."""
    sh, sm = (int(x) for x in start_hhmm.split(":"))
    eh, em = (int(x) for x in end_hhmm.split(":"))
    today = now_et.date()
    start = datetime(today.year, today.month, today.day, sh, sm, tzinfo=ET)
    end = datetime(today.year, today.month, today.day, eh, em, tzinfo=ET)
    return start, end
```

- [ ] **Step 3: Run tests**

```bash
python -m pytest api/services/journal_two/test_discipline.py -q
```

Expected: 6 tests pass.

- [ ] **Step 4: Run full j2 backend suite**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/discipline.py api/services/journal_two/test_discipline.py
git commit -m "feat(j2-discipline): compute_discipline_state service for Phase B guards"
```

---

## Task 5: API endpoint

**Files:**
- Modify: `api/routers/journal_two.py`

- [ ] **Step 1: Locate the existing accounts router**

Find the section in `api/routers/journal_two.py` where `/accounts` endpoints are defined (where `get_account_comparison` and similar live).

- [ ] **Step 2: Add the new endpoint**

Add (after another `/accounts/...` endpoint):

```python
@router.get("/accounts/{account_id}/discipline/state")
def get_discipline_state(
    account_id: str,
    user: dict = Depends(require_auth_user),  # use whatever auth dep the router uses
):
    from api.services.journal_two import discipline as disc
    return disc.compute_discipline_state(user["id"], account_id)
```

If the existing endpoints use a different auth dependency or User type, match it exactly. If the file uses `from api.services.journal_two import discipline` at the top, prefer that pattern over the inline import.

- [ ] **Step 3: Smoke-test the endpoint**

Run the FastAPI app locally, hit `/api/j2/accounts/<id>/discipline/state` with a valid session cookie. Expected: 200 with the state shape from the spec.

If you can't do an interactive session test, just run the existing router tests and confirm none broke:

```bash
python -m pytest api/services/journal_two/ -q
```

- [ ] **Step 4: Commit**

```bash
git add api/routers/journal_two.py
git commit -m "feat(j2-discipline): GET /accounts/{id}/discipline/state endpoint"
```

---

## Task 6: Frontend `useJ2DisciplineState` hook

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2DisciplineState.js`

- [ ] **Step 1: Implement**

```js
/**
 * SWR hook: fetches /api/j2/accounts/{id}/discipline/state.
 * Refreshes every 5s while the consumer is mounted (i.e., while a J2 modal
 * is open). Returns null when accountId is null/undefined (e.g., All Accounts).
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2DisciplineState(accountId) {
  const url = accountId ? `/api/j2/accounts/${accountId}/discipline/state` : null
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    refreshInterval: 5_000,
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    state: data,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/pages/journal-2-0/hooks/useJ2DisciplineState.js
git commit -m "feat(j2-discipline): useJ2DisciplineState hook (5s SWR poll)"
```

---

## Task 7: Frontend `DisciplineLockBanner` component

**Files:**
- Create: `app/src/pages/journal-2-0/components/DisciplineLockBanner.jsx`

- [ ] **Step 1: Implement**

```jsx
/**
 * Shared lock banner — renders one entry per `state.reasons` plus an
 * Override button. Mirrors the Phase A risk-cap banner styling so the
 * two feel like the same family of guard.
 *
 * Props:
 *   state: discipline state object from useJ2DisciplineState (may be null)
 *   overrideArmed: boolean
 *   onArmOverride: () => void
 */

const ICON_BY_TYPE = {
  daily_loss: '🛑',
  cooling_off: '⏳',
  no_trade_window: '🕒',
}

function fmtCountdown(unlockAt) {
  if (!unlockAt) return null
  const ms = new Date(unlockAt).getTime() - Date.now()
  if (ms <= 0) return null
  const totalSec = Math.floor(ms / 1000)
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export default function DisciplineLockBanner({ state, overrideArmed, onArmOverride }) {
  if (!state || !state.locked || !state.reasons || state.reasons.length === 0) return null

  return (
    <div
      role="alert"
      style={{
        margin: '0 0 12px',
        padding: '10px 14px',
        background: 'rgba(239,68,68,0.12)',
        border: '1px solid var(--loss, #ef4444)',
        borderRadius: 8,
        color: 'var(--loss, #ef4444)',
        fontSize: 13,
        lineHeight: 1.5,
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 4 }}>
        🚫 Trade entry locked
      </div>
      <ul style={{ margin: '4px 0 8px 18px', padding: 0 }}>
        {state.reasons.map((r, i) => {
          const countdown = fmtCountdown(r.unlockAt)
          return (
            <li key={`${r.type}-${i}`} style={{ marginBottom: 2 }}>
              {ICON_BY_TYPE[r.type] || '⚠️'} {r.message}
              {countdown && (
                <span style={{ opacity: 0.85 }}>{' '}— unlocks in {countdown}</span>
              )}
            </li>
          )
        })}
      </ul>
      {overrideArmed
        ? <span>Override armed — Save will commit anyway.</span>
        : (
          <button
            type="button"
            onClick={onArmOverride}
            style={{
              padding: '2px 10px',
              background: 'transparent',
              border: '1px solid var(--loss, #ef4444)',
              color: 'var(--loss, #ef4444)',
              borderRadius: 6, fontSize: 12, cursor: 'pointer',
            }}
          >
            Override
          </button>
        )}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/src/pages/journal-2-0/components/DisciplineLockBanner.jsx
git commit -m "feat(j2-discipline): DisciplineLockBanner shared component"
```

---

## Task 8: Frontend `NoTradeWindowsEditor`

**Files:**
- Create: `app/src/pages/journal-2-0/components/NoTradeWindowsEditor.jsx`
- Create: `app/src/pages/journal-2-0/components/NoTradeWindowsEditor.test.jsx`

- [ ] **Step 1: TDD — write the component test**

```jsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import NoTradeWindowsEditor from './NoTradeWindowsEditor'

describe('NoTradeWindowsEditor', () => {
  it('renders existing windows', () => {
    const value = [
      { start: '11:30', end: '13:30', label: 'Lunch' },
      { start: '09:30', end: '09:45', label: '' },
    ]
    render(<NoTradeWindowsEditor value={value} onChange={() => {}} />)
    expect(screen.getByDisplayValue('11:30')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Lunch')).toBeInTheDocument()
  })

  it('Add window appends a blank row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<NoTradeWindowsEditor value={[]} onChange={onChange} />)
    await user.click(screen.getByRole('button', { name: /add window/i }))
    expect(onChange).toHaveBeenCalledWith([
      { start: '', end: '', label: '' },
    ])
  })

  it('changing a field calls onChange with updated list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NoTradeWindowsEditor
        value={[{ start: '11:30', end: '13:30', label: '' }]}
        onChange={onChange}
      />,
    )
    const startInput = screen.getByDisplayValue('11:30')
    await user.clear(startInput)
    await user.type(startInput, '12:00')
    // userEvent.type fires onChange per keystroke; final state has start: '12:00'
    const lastCall = onChange.mock.calls[onChange.mock.calls.length - 1][0]
    expect(lastCall[0].start).toBe('12:00')
  })

  it('Remove button drops the row', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(
      <NoTradeWindowsEditor
        value={[{ start: '11:30', end: '13:30', label: 'Lunch' }]}
        onChange={onChange}
      />,
    )
    await user.click(screen.getByRole('button', { name: /remove/i }))
    expect(onChange).toHaveBeenCalledWith([])
  })
})
```

Run — expect failure (component doesn't exist).

- [ ] **Step 2: Implement the component**

```jsx
/**
 * No-trade time-window list editor.
 * Each row: <start HH:MM> – <end HH:MM> [label] [Remove]
 * Plus a "+ Add window" button at the bottom.
 *
 * `value` is an array of {start, end, label}. `onChange(nextArray)` fires on
 * any edit. The component is fully controlled — no internal state.
 */

export default function NoTradeWindowsEditor({ value = [], onChange }) {
  const updateAt = (idx, patch) => {
    const next = value.map((row, i) => i === idx ? { ...row, ...patch } : row)
    onChange(next)
  }
  const removeAt = (idx) => {
    onChange(value.filter((_, i) => i !== idx))
  }
  const addWindow = () => {
    onChange([...value, { start: '', end: '', label: '' }])
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {value.map((row, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            gap: 8,
            alignItems: 'center',
            flexWrap: 'wrap',
          }}
        >
          <input
            type="time"
            aria-label={`Window ${idx + 1} start`}
            value={row.start}
            onChange={(e) => updateAt(idx, { start: e.target.value })}
            style={{ minWidth: 100 }}
          />
          <span style={{ color: 'var(--text-muted)' }}>–</span>
          <input
            type="time"
            aria-label={`Window ${idx + 1} end`}
            value={row.end}
            onChange={(e) => updateAt(idx, { end: e.target.value })}
            style={{ minWidth: 100 }}
          />
          <input
            type="text"
            aria-label={`Window ${idx + 1} label`}
            value={row.label || ''}
            onChange={(e) => updateAt(idx, { label: e.target.value })}
            placeholder="Label (optional)"
            style={{ flex: 1, minWidth: 140 }}
          />
          <button
            type="button"
            onClick={() => removeAt(idx)}
            aria-label={`Remove window ${idx + 1}`}
            style={{
              padding: '4px 10px',
              background: 'transparent',
              border: '1px solid var(--loss, #ef4444)',
              color: 'var(--loss, #ef4444)',
              borderRadius: 6, fontSize: 12, cursor: 'pointer',
            }}
          >
            Remove
          </button>
        </div>
      ))}
      <div>
        <button
          type="button"
          onClick={addWindow}
          style={{
            padding: '6px 12px',
            background: 'transparent',
            border: '1px solid var(--border)',
            color: 'var(--text-bright)',
            borderRadius: 6, fontSize: 12, cursor: 'pointer',
          }}
        >
          + Add window
        </button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Run tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/NoTradeWindowsEditor.test.jsx
```

Expected: 4 pass.

- [ ] **Step 4: Commit**

```bash
git add app/src/pages/journal-2-0/components/NoTradeWindowsEditor.jsx app/src/pages/journal-2-0/components/NoTradeWindowsEditor.test.jsx
git commit -m "feat(j2-discipline): NoTradeWindowsEditor component"
```

---

## Task 9: PortfolioSettingsModal — Phase B fields

**Files:**
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx`

- [ ] **Step 1: Add state for the 3 new settings**

Below the Phase A states (`maxRiskPerTradePct`):

```jsx
  const [dailyLossLimitPct, setDailyLossLimitPct] = useState(
    settings?.dailyLossLimitPct == null ? '' : String(settings.dailyLossLimitPct),
  )
  const [coolingOffMinutesAfterLoss, setCoolingOffMinutesAfterLoss] = useState(
    settings?.coolingOffMinutesAfterLoss == null ? '' : String(settings.coolingOffMinutesAfterLoss),
  )
  const [noTradeWindowsET, setNoTradeWindowsET] = useState(
    Array.isArray(settings?.noTradeWindowsET) ? settings.noTradeWindowsET : [],
  )
```

- [ ] **Step 2: Wire payload + deps**

In `handleSave`'s payload, after the Phase A entries:

```jsx
      dailyLossLimitPct: dailyLossLimitPct === '' ? null : Number(dailyLossLimitPct),
      coolingOffMinutesAfterLoss: coolingOffMinutesAfterLoss === '' ? null : parseInt(coolingOffMinutesAfterLoss, 10),
      noTradeWindowsET,
```

Add `dailyLossLimitPct, coolingOffMinutesAfterLoss, noTradeWindowsET` to the `useCallback` deps array (alongside the Phase A entries).

- [ ] **Step 3: Add a new section after ENTRY DEFAULTS & GUARDS**

Insert immediately AFTER the ENTRY DEFAULTS & GUARDS `</section>` closing tag and BEFORE the `{/* 5.2 DEFAULT STOP */}` comment:

```jsx
          {/* SESSION DISCIPLINE — Phase B */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>SESSION DISCIPLINE</h3>
            <p className={styles.helper}>
              Lock new trade entries when you've hit a daily loss, just took
              a losing trade, or are inside a no-trade time window. Each
              guard is independent — leave any field blank to disable it.
            </p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Daily Loss Limit (% of account)</span>
              <input
                type="number"
                min="0.05"
                max="50"
                step="0.05"
                value={dailyLossLimitPct}
                onChange={(e) => setDailyLossLimitPct(e.target.value)}
                placeholder="e.g. 2"
                className={styles.numberInput}
              />
            </label>
            <p className={styles.helper}>
              When today's realized P&amp;L drops below this %, Add Position
              and Add Trade are blocked (Override available).
            </p>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Cooling-Off After Loss (minutes)</span>
              <input
                type="number"
                min="1"
                max="240"
                step="1"
                value={coolingOffMinutesAfterLoss}
                onChange={(e) => setCoolingOffMinutesAfterLoss(e.target.value)}
                placeholder="e.g. 15"
                className={styles.numberInput}
              />
            </label>
            <p className={styles.helper}>
              After any losing trade exit, lock new entries for this many
              minutes. Forces a walk-away after a loss.
            </p>

            <div className={styles.field}>
              <span className={styles.fieldLabel}>No-Trade Time Windows (ET)</span>
              <NoTradeWindowsEditor
                value={noTradeWindowsET}
                onChange={setNoTradeWindowsET}
              />
            </div>
            <p className={styles.helper}>
              Block entries during specific time windows (e.g. lunch chop or
              the volatile open). Times are 24-hour Eastern.
            </p>
          </section>

```

Don't forget the import at the top:

```jsx
import NoTradeWindowsEditor from './NoTradeWindowsEditor'
```

- [ ] **Step 4: Build + run modal tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: clean build; 14 tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx
git commit -m "feat(j2-discipline): SESSION DISCIPLINE section in Portfolio Settings"
```

---

## Task 10: AddPositionModal — discipline lock integration

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx`

- [ ] **Step 1: Imports + hook**

Add the imports near the existing disciplineGuards import:

```jsx
import useJ2DisciplineState from '../hooks/useJ2DisciplineState'
import DisciplineLockBanner from './DisciplineLockBanner'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
```

In the component body (alongside the other hook calls at the top):

```jsx
  const { accountId } = useJ2SelectedAccount()
  const { state: disciplineState } = useJ2DisciplineState(accountId)
```

- [ ] **Step 2: Override state for the discipline lock**

Below the existing `overrideArmed` (Phase A risk-cap), add a SECOND override flag specific to session-discipline:

```jsx
  const [disciplineOverrideArmed, setDisciplineOverrideArmed] = useState(false)
  // Reset session-override whenever the underlying lock-set changes (e.g.,
  // a no-trade window naturally ends, or the user takes another loss).
  useEffect(() => {
    if (!disciplineState?.locked) setDisciplineOverrideArmed(false)
  }, [disciplineState?.locked, disciplineState?.computedAt])
```

- [ ] **Step 3: Render the banner**

Place it ABOVE the existing risk-cap banner (so the user sees session-level locks first):

```jsx
          <DisciplineLockBanner
            state={disciplineState}
            overrideArmed={disciplineOverrideArmed}
            onArmOverride={() => setDisciplineOverrideArmed(true)}
          />
```

- [ ] **Step 4: Update Save's `disabled` to include session lock**

```jsx
            disabled={
              saving
              || (overCap && !overrideArmed)
              || (disciplineState?.locked && !disciplineOverrideArmed)
            }
```

- [ ] **Step 5: Build + tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/journal-2-0/components/AddPositionModal.jsx
git commit -m "feat(j2-discipline): mount DisciplineLockBanner + soft-block in AddPosition"
```

---

## Task 11: AddTradeModal — same integration

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddTradeModal.jsx`

- [ ] **Step 1: Mirror Task 10's edits**

Add the same imports + hook + `disciplineOverrideArmed` state + reset effect + banner JSX + Save `disabled` extension. The only difference from Task 10 is that AddTradeModal doesn't have an existing `accountId` plumb — pull it from `useJ2SelectedAccount` exactly the same way.

- [ ] **Step 2: Build + tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/journal-2-0/components/AddTradeModal.jsx
git commit -m "feat(j2-discipline): mount DisciplineLockBanner + soft-block in AddTrade"
```

---

## Task 12: Settings modal round-trip test

**Files:**
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx`

- [ ] **Step 1: Add a Phase B round-trip test**

```jsx
it('Phase B guard inputs ship in the save payload', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn().mockResolvedValue({})
  render(
    <PortfolioSettingsModal settings={baseSettings} onSave={onSave} onClose={vi.fn()} />,
  )

  const lossInput = screen.getByLabelText(/Daily Loss Limit/i)
  const coolInput = screen.getByLabelText(/Cooling-Off After Loss/i)

  await user.clear(lossInput); await user.type(lossInput, '2')
  await user.clear(coolInput); await user.type(coolInput, '15')

  // Add a no-trade window
  await user.click(screen.getByRole('button', { name: /add window/i }))
  const startInputs = screen.getAllByLabelText(/Window 1 start/i)
  await user.type(startInputs[0], '11:30')
  const endInputs = screen.getAllByLabelText(/Window 1 end/i)
  await user.type(endInputs[0], '13:30')

  await user.click(screen.getByRole('button', { name: 'Save Settings' }))

  expect(onSave).toHaveBeenCalledTimes(1)
  const payload = onSave.mock.calls[0][0]
  expect(payload.dailyLossLimitPct).toBe(2)
  expect(payload.coolingOffMinutesAfterLoss).toBe(15)
  expect(payload.noTradeWindowsET).toEqual([
    { start: '11:30', end: '13:30', label: '' },
  ])
})
```

- [ ] **Step 2: Run**

```bash
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: 15 pass.

- [ ] **Step 3: Commit**

```bash
git add app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
git commit -m "test(j2-discipline): Phase B settings round-trip via Save Settings"
```

---

## Task 13: End-to-end smoke + push

- [ ] **Step 1: Backend full pass**

```bash
python -m pytest api/services/journal_two/ -q
```

Expected: clean.

- [ ] **Step 2: Frontend build + j2 tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0
```

Expected: clean.

- [ ] **Step 3: Manual smoke (optional but recommended)**

Run dev server. Open J2 → Settings → fill the 3 new SESSION DISCIPLINE fields → Save. Then:
- Add a no-trade window covering "now". Open Add Position → banner appears. Save disabled. Override re-enables.
- Wait for the window to pass — banner disappears (next 5s SWR poll).
- Insert a fake recent loss (or close a real position at a loss) → cooling-off banner appears.

- [ ] **Step 4: Push**

```bash
git push origin master
```

---

## Self-Review Checklist (before handoff)

- [ ] All three settings round-trip: backend validator → DB UPDATE → DB SELECT → modal state → save payload.
- [ ] Banner renders when `state.locked` is true, exactly N reasons listed.
- [ ] Both Save buttons (AddPosition, AddTrade) honor the session-override flag separately from the Phase A risk-cap override.
- [ ] No Phase A behavior changed. The Phase A risk-cap banner still works identically.
- [ ] Existing accounts (no Phase B settings configured) see no behavior change.
- [ ] No-trade windows treat ET as the source of truth, regardless of user's local timezone.
- [ ] No new test relies on real wall-clock time except where `now=` is explicitly injectable.
