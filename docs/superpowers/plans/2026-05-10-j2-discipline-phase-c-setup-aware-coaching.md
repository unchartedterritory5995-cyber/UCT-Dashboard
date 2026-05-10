# Journal 2.0 Discipline — Phase C: Setup-Aware Coaching

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use `- [ ]` checkbox syntax.

**Goal:** Turn the user's own historical setup performance into live coaching at trade-entry time. Two pieces:
1. **Live setup-expectancy panel** — when a user selects a setup in AddPosition/AddTrade, show a small inline panel: "Your record on `Bull Flag`: 12 trades, 41% win rate, +1.2R avg, +14.8R YTD. Last 5: W L L W L."
2. **A+ setup whitelist with elevated risk cap** — settings let the user mark certain setups as "A+". When the chosen setup is A+, the Phase A risk-cap multiplies by a user-chosen factor (default 1.5×).

**Architecture:** Two new per-account settings (`aPlusSetups: string[]`, `aPlusRiskMultiplier: number`). One new backend service (`setup_stats.py`) + one endpoint. One new SWR hook + one new presentational component on the frontend. AddPosition + AddTrade both render the panel and pick up the elevated cap when relevant.

**Tech Stack:** SQLite, FastAPI, React + SWR, vitest, pytest.

**Why this scope:**
- Setup stats are a pure read computation against `j2_trades` — no schema change there.
- A+ whitelist + multiplier are stored as `j2_accounts` columns (one TEXT JSON list, one REAL nullable).
- Risk-cap math reuses Phase A's `computeImpliedRiskPct` + `maxRiskPerTradePct` — only the cap value changes when setup is A+.
- Setup names are sourced from existing `settings.setups` — no new picker state, just chip-toggling within the existing list.

---

## Settings shape (canonical, after this phase)

```js
{
  // ... existing Phase A + Phase B fields ...

  // NEW Phase C:
  aPlusSetups: [],              // subset of `setups`; setups in this list get the elevated cap
  aPlusRiskMultiplier: null,    // multiplier applied to maxRiskPerTradePct when setup is A+ (e.g. 1.5)
}
```

When `aPlusSetups` is empty OR `aPlusRiskMultiplier` is null OR `maxRiskPerTradePct` is null, the cap behaves exactly as Phase A. The elevation only fires when all three are configured AND the chosen setup is in the whitelist.

## Setup-stats response shape

```json
{
  "setup": "Bull Flag",
  "tradeCount": 12,
  "winCount": 5,
  "lossCount": 6,
  "beCount": 1,
  "winRate": 0.4167,
  "avgR": 1.21,
  "totalR": 14.78,
  "totalPnlDollar": 4250,
  "lastFive": ["W", "L", "L", "W", "L"]
}
```

Empty result (`tradeCount: 0`) when the user has no trades for that setup yet — the panel renders a "No history yet on this setup" message.

---

## File map

**Backend:**
- Modify: `api/services/journal_two/db.py` — 2 ALTERs on `j2_accounts`
- Modify: `api/services/journal_two/settings.py` — extend defaults + `validate_settings_payload`
- Modify: `api/services/journal_two/accounts.py` — round-trip the 2 new fields
- Create: `api/services/journal_two/setup_stats.py` — `get_setup_stats(user_id, account_id, setup) -> dict`
- Create: `api/services/journal_two/test_setup_stats.py`
- Modify: `api/routers/journal_two.py` — `GET /accounts/{id}/setup-stats`

**Frontend:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2SetupStats.js`
- Create: `app/src/pages/journal-2-0/components/SetupStatsPanel.jsx`
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx` — A+ section
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx` — render panel + adjust effective cap
- Modify: `app/src/pages/journal-2-0/components/AddTradeModal.jsx` — same
- Test: `app/src/pages/journal-2-0/components/SetupStatsPanel.test.jsx`
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx` — Phase C round-trip case

---

## Task 1: Backend schema migration

**Files:**
- Modify: `api/services/journal_two/db.py`

- [ ] **Step 1: Append 2 ALTERs to `_PHASE_2_ALTERS`**

After the Phase B trio:

```python
    # Phase C — Setup-Aware Coaching (whitelist + multiplier; null/empty = disabled)
    "ALTER TABLE j2_accounts ADD COLUMN a_plus_setups TEXT NOT NULL DEFAULT '[]'",
    "ALTER TABLE j2_accounts ADD COLUMN a_plus_risk_multiplier REAL",
```

`a_plus_setups` mirrors the JSON-in-TEXT pattern (NOT NULL with `'[]'` default). `a_plus_risk_multiplier` is nullable.

- [ ] **Step 2: Verify**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/test_accounts.py -q
```

Expected: 25 passing (no regression).

- [ ] **Step 3: Commit**

```bash
git add api/services/journal_two/db.py
git commit -m "feat(j2-discipline): add 2 columns to j2_accounts for Phase C A+ whitelist"
```

---

## Task 2: Settings validators

**Files:**
- Modify: `api/services/journal_two/settings.py`
- Modify: `api/services/journal_two/test_settings.py`

- [ ] **Step 1: Append failing tests**

```python
def test_validate_accepts_phase_c_guards():
    from api.services.journal_two import settings as svc
    payload = _baseline_payload() | {
        "setups": ["Bull Flag", "Pullback", "Breakout"],
        "aPlusSetups": ["Bull Flag", "Pullback"],
        "aPlusRiskMultiplier": 1.5,
    }
    out = svc.validate_settings_payload(payload)
    assert out["aPlusSetups"] == ["Bull Flag", "Pullback"]
    assert out["aPlusRiskMultiplier"] == 1.5


def test_validate_phase_c_guards_default_to_empty_or_none():
    from api.services.journal_two import settings as svc
    out = svc.validate_settings_payload(_baseline_payload())
    assert out["aPlusSetups"] == []
    assert out["aPlusRiskMultiplier"] is None


def test_validate_phase_c_guards_reject_invalid():
    from api.services.journal_two import settings as svc
    from api.services.journal_two.settings import SettingsValidationError
    base = _baseline_payload()
    invalid = [
        {"aPlusSetups": "Bull Flag"},                      # not a list
        {"aPlusSetups": [123, "ok"]},                      # non-string entry
        {"aPlusRiskMultiplier": 0},                        # not > 1
        {"aPlusRiskMultiplier": 1},                        # not > 1 (must elevate)
        {"aPlusRiskMultiplier": -0.5},                     # negative
        {"aPlusRiskMultiplier": 11},                       # cap at 10x
    ]
    for bad in invalid:
        with pytest.raises(SettingsValidationError):
            svc.validate_settings_payload(base | bad)
```

Run, expect failure.

- [ ] **Step 2: Implement helpers + extension**

Add a helper above `validate_settings_payload`:

```python
def _validate_string_list(value: Any, field_name: str) -> list[str]:
    """Optional list of non-empty strings. None/'' = empty list. Trims whitespace."""
    if value is None or value == "":
        return []
    if not isinstance(value, list):
        raise SettingsValidationError(f"{field_name} must be a list")
    out: list[str] = []
    seen: set[str] = set()
    for s in value:
        if not isinstance(s, str):
            raise SettingsValidationError(f"{field_name} entries must be strings")
        stripped = s.strip()
        if not stripped or stripped in seen:
            continue
        seen.add(stripped)
        out.append(stripped)
    return out


def _validate_optional_multiplier(value: Any, field_name: str, *, min_exclusive: float = 1.0, max_inclusive: float = 10.0) -> float | None:
    """Optional multiplier > min_exclusive and <= max_inclusive. None/'' = disabled."""
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SettingsValidationError(f"{field_name} must be a number or null")
    f = float(value)
    if f <= min_exclusive or f > max_inclusive:
        raise SettingsValidationError(
            f"{field_name} must be in ({min_exclusive}, {max_inclusive}]"
        )
    return f
```

Extend `default_settings_data()`:

```python
        "noTradeWindowsET": [],
        # Phase C — Setup-Aware Coaching
        "aPlusSetups": [],
        "aPlusRiskMultiplier": None,
    }
```

Extend `validate_settings_payload` return:

```python
        "noTradeWindowsET": _validate_no_trade_windows(payload.get("noTradeWindowsET", [])),
        # Phase C
        "aPlusSetups": _validate_string_list(payload.get("aPlusSetups", []), "aPlusSetups"),
        "aPlusRiskMultiplier": _validate_optional_multiplier(
            payload.get("aPlusRiskMultiplier"), "aPlusRiskMultiplier",
        ),
    }
```

- [ ] **Step 3: Run tests, watch pass**

```bash
python -m pytest api/services/journal_two/test_settings.py -q
```

Expected: 25 passing (22 prior + 3 new).

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/settings.py api/services/journal_two/test_settings.py
git commit -m "feat(j2-discipline): validate Phase C A+ whitelist + risk multiplier"
```

---

## Task 3: accounts.py round-trip

**Files:**
- Modify: `api/services/journal_two/accounts.py`
- Modify: `api/services/journal_two/test_accounts.py`

- [ ] **Step 1: Append failing test**

```python
def test_phase_c_guards_roundtrip(db_conn):
    user_id = "u_phase_c_roundtrip"
    account = accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)
    payload = {
        "accountSize": 100_000,
        "defaultStop": {"mode": "custom"},
        "positionClosing": "FIFO",
        "breakevenRange": {"enabled": False, "unit": "$", "value": 0},
        "setups": ["Bull Flag", "Pullback"],
        "shareJournalData": False,
        "tradingMode": "both",
        "aPlusSetups": ["Bull Flag"],
        "aPlusRiskMultiplier": 1.5,
    }
    saved = accounts_service.upsert_account_settings(user_id, account["id"], payload, conn=db_conn)
    assert saved["aPlusSetups"] == ["Bull Flag"]
    assert saved["aPlusRiskMultiplier"] == 1.5

    fresh = accounts_service.get_account_settings(user_id, account["id"], conn=db_conn)
    assert fresh["aPlusSetups"] == ["Bull Flag"]
    assert fresh["aPlusRiskMultiplier"] == 1.5
```

- [ ] **Step 2: Wire reads/writes in `accounts.py`**

In `_default_settings_block()`, append after `noTradeWindowsET`:
```python
        "noTradeWindowsET": [],
        "aPlusSetups": [],
        "aPlusRiskMultiplier": None,
    }
```

In `_account_to_settings()` returned dict, append after `noTradeWindowsET`:
```python
            "noTradeWindowsET": json.loads(row["no_trade_windows_et"]) if "no_trade_windows_et" in keys else [],
            "aPlusSetups": json.loads(row["a_plus_setups"]) if "a_plus_setups" in keys else [],
            "aPlusRiskMultiplier": row["a_plus_risk_multiplier"] if "a_plus_risk_multiplier" in keys else None,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
```

In `upsert_account_settings()`, extend the UPDATE SET clause and parameter tuple. Place new columns AFTER `no_trade_windows_et`:

```python
                   no_trade_windows_et = ?,
                   a_plus_setups = ?,
                   a_plus_risk_multiplier = ?,
                   updated_at = ?
```

Tuple values:
```python
                json.dumps(full_validated.get("noTradeWindowsET", [])),
                json.dumps(full_validated.get("aPlusSetups", [])),
                full_validated.get("aPlusRiskMultiplier"),
                now, account_id, user_id,
```

INSERT paths need NO change.

- [ ] **Step 3: Run tests**

```bash
python -m pytest api/services/journal_two/test_accounts.py -q
```

Expected: 26 passing (25 prior + 1 new).

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/accounts.py api/services/journal_two/test_accounts.py
git commit -m "feat(j2-discipline): persist Phase C A+ whitelist + multiplier on j2_accounts"
```

---

## Task 4: setup_stats.py service

**Files:**
- Create: `api/services/journal_two/setup_stats.py`
- Create: `api/services/journal_two/test_setup_stats.py`

- [ ] **Step 1: Write failing tests**

```python
"""Tests for the per-setup performance stats."""
from __future__ import annotations

import importlib
import os
import sqlite3
import tempfile
import uuid
from datetime import datetime, timezone

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


def _seed_account(db_conn, user_id="u_stats"):
    from api.services.journal_two import accounts as accounts_service
    return accounts_service.get_or_migrate_default_account(user_id, conn=db_conn)


def _insert_trade(conn, *, user_id, account_id, setup, result, pnl_dollar, r_multiple, exit_iso=None):
    exit_iso = exit_iso or datetime.now(timezone.utc).isoformat()
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
                ?, NULL, ?, -1, ?, 1, ?, '{}', ?, ?)
        """,
        (
            str(uuid.uuid4()), user_id, str(uuid.uuid4()),
            exit_iso, exit_iso, setup, pnl_dollar, r_multiple, result,
            exit_iso, account_id,
        ),
    )
    conn.commit()


def test_no_trades_returns_empty_record(db_conn):
    from api.services.journal_two import setup_stats
    acc = _seed_account(db_conn)
    out = setup_stats.get_setup_stats("u_stats", acc["id"], "Bull Flag", conn=db_conn)
    assert out["setup"] == "Bull Flag"
    assert out["tradeCount"] == 0
    assert out["winCount"] == 0
    assert out["lastFive"] == []
    assert out["winRate"] is None
    assert out["avgR"] is None


def test_aggregates_trades_for_one_setup(db_conn):
    from api.services.journal_two import setup_stats
    acc = _seed_account(db_conn)
    # 3 wins, 2 losses, 1 BE on Bull Flag
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Win", pnl_dollar=300, r_multiple=2.0)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Win", pnl_dollar=200, r_multiple=1.5)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Win", pnl_dollar=100, r_multiple=1.0)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Loss", pnl_dollar=-100, r_multiple=-1.0)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="Loss", pnl_dollar=-100, r_multiple=-1.0)
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result="BE", pnl_dollar=0, r_multiple=0.0)
    out = setup_stats.get_setup_stats("u_stats", acc["id"], "Bull Flag", conn=db_conn)
    assert out["tradeCount"] == 6
    assert out["winCount"] == 3
    assert out["lossCount"] == 2
    assert out["beCount"] == 1
    # Win rate excludes BE: 3 wins / (3 wins + 2 losses) = 0.6
    assert abs(out["winRate"] - 0.6) < 1e-6
    # avgR over all 6 trades = (2 + 1.5 + 1 - 1 - 1 + 0) / 6 = 2.5 / 6
    assert abs(out["avgR"] - (2.5 / 6)) < 1e-6
    assert abs(out["totalR"] - 2.5) < 1e-6
    assert out["totalPnlDollar"] == 400


def test_filters_by_account_and_setup(db_conn):
    from api.services.journal_two import setup_stats
    acc = _seed_account(db_conn)
    # Different setup — should NOT be counted
    _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Pullback", result="Win", pnl_dollar=100, r_multiple=1.0)
    # Different user — should NOT be counted
    _insert_trade(db_conn, user_id="u_other", account_id=acc["id"], setup="Bull Flag", result="Win", pnl_dollar=100, r_multiple=1.0)
    out = setup_stats.get_setup_stats("u_stats", acc["id"], "Bull Flag", conn=db_conn)
    assert out["tradeCount"] == 0


def test_last_five_in_chronological_order(db_conn):
    from api.services.journal_two import setup_stats
    acc = _seed_account(db_conn)
    base = datetime(2026, 1, 1, tzinfo=timezone.utc)
    # 7 trades with known order — last 5 should be [t3..t7]
    sequence = [
        ("Win", 1.0, "2026-01-01T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-02T00:00:00+00:00"),
        ("Win", 1.0, "2026-01-03T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-04T00:00:00+00:00"),
        ("BE", 0.0, "2026-01-05T00:00:00+00:00"),
        ("Win", 1.0, "2026-01-06T00:00:00+00:00"),
        ("Loss", -1.0, "2026-01-07T00:00:00+00:00"),
    ]
    for result, r, iso in sequence:
        _insert_trade(db_conn, user_id="u_stats", account_id=acc["id"], setup="Bull Flag", result=result, pnl_dollar=100 * r, r_multiple=r, exit_iso=iso)
    out = setup_stats.get_setup_stats("u_stats", acc["id"], "Bull Flag", conn=db_conn)
    # Most recent FIVE in chronological order (oldest of those five → newest)
    assert out["lastFive"] == ["W", "L", "B", "W", "L"]
```

Run, expect ImportError.

- [ ] **Step 2: Implement the service**

Create `api/services/journal_two/setup_stats.py`:

```python
"""
Journal 2.0 — per-setup performance stats (Phase C).

Pure read against j2_trades. Returns a flat record showing the user's
historical performance on a given setup name within a single account.
Used by the SetupStatsPanel at trade-entry time as live coaching.
"""

from __future__ import annotations

import sqlite3
from typing import Any

from api.services.auth_db import get_connection


_RESULT_LETTER = {"Win": "W", "Loss": "L", "BE": "B"}


def get_setup_stats(
    user_id: str,
    account_id: str,
    setup: str,
    *,
    conn: sqlite3.Connection | None = None,
) -> dict[str, Any]:
    """Aggregate stats for one (account, setup) pair."""
    owned = conn is None
    conn = conn or get_connection()
    try:
        rows = conn.execute(
            """
            SELECT result, pnl_dollar, r_multiple, exit_date FROM j2_trades
             WHERE user_id = ? AND account_id = ? AND setup = ?
             ORDER BY exit_date ASC
            """,
            (user_id, account_id, setup),
        ).fetchall()

        if not rows:
            return _empty(setup)

        wins = sum(1 for r in rows if r["result"] == "Win")
        losses = sum(1 for r in rows if r["result"] == "Loss")
        bes = sum(1 for r in rows if r["result"] == "BE")
        decisive = wins + losses
        win_rate = (wins / decisive) if decisive > 0 else None

        rs = [float(r["r_multiple"]) for r in rows if r["r_multiple"] is not None]
        avg_r = (sum(rs) / len(rs)) if rs else None
        total_r = sum(rs) if rs else 0.0

        total_pnl = sum(float(r["pnl_dollar"] or 0) for r in rows)

        last_five = [_RESULT_LETTER.get(r["result"], "?") for r in rows[-5:]]

        return {
            "setup": setup,
            "tradeCount": len(rows),
            "winCount": wins,
            "lossCount": losses,
            "beCount": bes,
            "winRate": win_rate,
            "avgR": avg_r,
            "totalR": round(total_r, 4),
            "totalPnlDollar": round(total_pnl, 2),
            "lastFive": last_five,
        }
    finally:
        if owned:
            conn.close()


def _empty(setup: str) -> dict[str, Any]:
    return {
        "setup": setup,
        "tradeCount": 0,
        "winCount": 0,
        "lossCount": 0,
        "beCount": 0,
        "winRate": None,
        "avgR": None,
        "totalR": 0,
        "totalPnlDollar": 0,
        "lastFive": [],
    }
```

- [ ] **Step 3: Run tests, watch pass**

```bash
python -m pytest api/services/journal_two/test_setup_stats.py -q
python -m pytest api/services/journal_two/ -q
```

- [ ] **Step 4: Commit**

```bash
git add api/services/journal_two/setup_stats.py api/services/journal_two/test_setup_stats.py
git commit -m "feat(j2-discipline): per-setup stats service for Phase C coaching panel"
```

---

## Task 5: Setup-stats API endpoint

**Files:**
- Modify: `api/routers/journal_two.py`

- [ ] **Step 1: Add the endpoint**

Add the import alongside the existing journal_two service imports:

```python
from api.services.journal_two import setup_stats as setup_stats_service
```

Add a new endpoint after the discipline-state endpoint:

```python
@router.get("/accounts/{account_id}/setup-stats")
def get_setup_stats_route(
    account_id: str,
    setup: str = Query(...),
    user: dict = Depends(get_current_user),
):
    """Per-setup historical performance for the live coaching panel."""
    return setup_stats_service.get_setup_stats(user["id"], account_id, setup)
```

If the file already imports `Query` from fastapi, reuse it. Otherwise add the import.

- [ ] **Step 2: Verify**

```bash
python -c "from api.routers import journal_two; print('OK')"
python -m pytest api/services/journal_two/ -q
```

- [ ] **Step 3: Commit**

```bash
git add api/routers/journal_two.py
git commit -m "feat(j2-discipline): GET /accounts/{id}/setup-stats endpoint"
```

---

## Task 6: useJ2SetupStats hook

**Files:**
- Create: `app/src/pages/journal-2-0/hooks/useJ2SetupStats.js`

- [ ] **Step 1: Implement**

```js
/**
 * SWR hook: per-setup historical performance for the live coaching panel.
 * Returns null when accountId is null OR setup is empty/whitespace.
 */

import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2SetupStats(accountId, setup) {
  const trimmed = (setup || '').trim()
  const url = (accountId && trimmed)
    ? `/api/j2/accounts/${accountId}/setup-stats?setup=${encodeURIComponent(trimmed)}`
    : null
  const { data, error, isLoading } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
    dedupingInterval: 60_000, // 60s — setup history doesn't change mid-modal
  })
  return { stats: data, isLoading, error }
}
```

- [ ] **Step 2: Build to verify**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
```

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/hooks/useJ2SetupStats.js
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-discipline): useJ2SetupStats hook (60s dedupe)"
```

---

## Task 7: SetupStatsPanel component + tests

**Files:**
- Create: `app/src/pages/journal-2-0/components/SetupStatsPanel.jsx`
- Create: `app/src/pages/journal-2-0/components/SetupStatsPanel.test.jsx`

- [ ] **Step 1: Write the test**

```jsx
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import SetupStatsPanel from './SetupStatsPanel'

describe('SetupStatsPanel', () => {
  it('renders nothing when stats is undefined (loading) or null (no setup picked)', () => {
    const { container, rerender } = render(<SetupStatsPanel stats={undefined} />)
    expect(container.firstChild).toBeNull()
    rerender(<SetupStatsPanel stats={null} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the empty-history message when tradeCount is 0', () => {
    render(<SetupStatsPanel stats={{ setup: 'Bull Flag', tradeCount: 0, lastFive: [] }} />)
    expect(screen.getByText(/no history yet on/i)).toBeInTheDocument()
    expect(screen.getByText(/Bull Flag/i)).toBeInTheDocument()
  })

  it('renders the headline + last-five when tradeCount > 0', () => {
    const stats = {
      setup: 'Bull Flag',
      tradeCount: 12,
      winCount: 5,
      lossCount: 6,
      beCount: 1,
      winRate: 0.4545,
      avgR: 1.21,
      totalR: 14.78,
      totalPnlDollar: 4250,
      lastFive: ['W', 'L', 'L', 'W', 'L'],
    }
    render(<SetupStatsPanel stats={stats} />)
    expect(screen.getByText(/12 trades/)).toBeInTheDocument()
    expect(screen.getByText(/45%/)).toBeInTheDocument()
    expect(screen.getByText(/\+1\.21R avg/)).toBeInTheDocument()
    // Last-five letters render
    const lastFiveContainer = screen.getByLabelText(/last 5 trades/i)
    expect(lastFiveContainer).toHaveTextContent('WLLWL')
  })

  it('shows A+ badge when isAPlus is true', () => {
    render(<SetupStatsPanel stats={{ setup: 'X', tradeCount: 0, lastFive: [] }} isAPlus />)
    expect(screen.getByText(/A\+/)).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Implement**

```jsx
/**
 * Live coaching panel rendered inline with the setup picker in
 * AddPosition / AddTrade. Shows the user's historical performance on
 * the chosen setup so the entry decision is informed by their own data.
 *
 * Props:
 *   stats: setup-stats object from useJ2SetupStats (may be undefined or null)
 *   isAPlus: boolean — whether the chosen setup is in the user's A+ whitelist
 */

const fmtPct = (x) => x == null ? '—' : `${Math.round(x * 100)}%`
const fmtR = (x, dp = 2) => x == null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(dp)}R`
const fmtMoney = (x) => x == null ? '—' : (
  x >= 0 ? `+$${Math.abs(x).toFixed(0)}` : `-$${Math.abs(x).toFixed(0)}`
)

const LETTER_COLOR = { W: 'var(--profit, #22c55e)', L: 'var(--loss, #ef4444)', B: 'var(--text-muted)' }

export default function SetupStatsPanel({ stats, isAPlus = false }) {
  if (!stats) return null

  const { setup, tradeCount, winRate, avgR, totalR, totalPnlDollar, lastFive } = stats

  return (
    <div
      style={{
        margin: '6px 0 4px',
        padding: '8px 10px',
        background: 'rgba(201, 168, 76, 0.08)',
        border: '1px solid rgba(201, 168, 76, 0.35)',
        borderRadius: 6,
        fontSize: 12,
        lineHeight: 1.5,
        color: 'var(--text-bright)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
        <strong style={{ color: 'var(--ut-gold, #c9a84c)' }}>Your record on {setup}</strong>
        {isAPlus && (
          <span
            style={{
              padding: '0 6px',
              fontSize: 10, fontWeight: 700, letterSpacing: 0.5,
              color: 'var(--ut-gold, #c9a84c)',
              border: '1px solid var(--ut-gold, #c9a84c)',
              borderRadius: 4,
            }}
          >
            A+
          </span>
        )}
      </div>

      {tradeCount === 0 ? (
        <span style={{ color: 'var(--text-muted)' }}>
          No history yet on <strong>{setup}</strong> in this account.
        </span>
      ) : (
        <>
          <div>
            <strong>{tradeCount}</strong> trades · win rate <strong>{fmtPct(winRate)}</strong> ·
            {' '}<strong>{fmtR(avgR)} avg</strong> · <strong>{fmtR(totalR, 1)} total</strong> ·
            {' '}<span style={{ color: 'var(--text-muted)' }}>{fmtMoney(totalPnlDollar)} P&amp;L</span>
          </div>
          <div
            aria-label="Last 5 trades"
            style={{ display: 'flex', gap: 4, marginTop: 4, fontFamily: 'var(--font-mono, monospace)', letterSpacing: 1 }}
          >
            {lastFive.map((ch, i) => (
              <span key={i} style={{ color: LETTER_COLOR[ch] || 'var(--text-muted)' }}>{ch}</span>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Run tests + build**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/SetupStatsPanel.test.jsx
npm run build
```

- [ ] **Step 4: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/SetupStatsPanel.jsx app/src/pages/journal-2-0/components/SetupStatsPanel.test.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-discipline): SetupStatsPanel coaching component"
```

---

## Task 8: PortfolioSettingsModal — A+ tagging UI

**Files:**
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx`

- [ ] **Step 1: Add 2 new states**

After the Phase B states (`noTradeWindowsET`):

```jsx
  const [aPlusSetups, setAPlusSetups] = useState(
    Array.isArray(settings?.aPlusSetups) ? settings.aPlusSetups : [],
  )
  const [aPlusRiskMultiplier, setAPlusRiskMultiplier] = useState(
    settings?.aPlusRiskMultiplier == null ? '' : String(settings.aPlusRiskMultiplier),
  )
```

- [ ] **Step 2: Wire payload + deps**

In `handleSave`'s payload, after `noTradeWindowsET`:

```jsx
      noTradeWindowsET,
      aPlusSetups,
      aPlusRiskMultiplier: aPlusRiskMultiplier === '' ? null : Number(aPlusRiskMultiplier),
```

In the `useCallback` deps array, add `aPlusSetups` and `aPlusRiskMultiplier`.

- [ ] **Step 3: Add the new section after SESSION DISCIPLINE**

Insert AFTER the SESSION DISCIPLINE `</section>` and BEFORE the `{/* 5.2 DEFAULT STOP */}` comment:

```jsx
          {/* SETUP-AWARE COACHING — Phase C */}
          <section className={styles.section}>
            <h3 className={styles.sectionHeader}>SETUP-AWARE COACHING</h3>
            <p className={styles.helper}>
              Mark setups as <strong>A+</strong> to allow them to exceed your
              Max Risk Per Trade cap by the multiplier below. Forces you to
              commit ahead of time which patterns deserve full size.
            </p>

            {setups.length === 0 ? (
              <p className={styles.helper}>
                Add some setups in the TRADE SETUPS section above first.
              </p>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '4px 0 8px' }}>
                {setups.map((s) => {
                  const active = aPlusSetups.includes(s)
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => {
                        setAPlusSetups((prev) =>
                          prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
                        )
                      }}
                      style={{
                        padding: '4px 10px',
                        fontSize: 12,
                        background: active ? 'var(--ut-gold, #c9a84c)' : 'transparent',
                        color: active ? 'var(--bg, #000)' : 'var(--text-bright)',
                        border: `1px solid ${active ? 'var(--ut-gold, #c9a84c)' : 'var(--border)'}`,
                        borderRadius: 999,
                        cursor: 'pointer',
                      }}
                      aria-pressed={active}
                    >
                      {active ? '★ ' : ''}{s}
                    </button>
                  )
                })}
              </div>
            )}

            <label className={styles.field}>
              <span className={styles.fieldLabel}>A+ Risk Multiplier</span>
              <input
                type="number"
                min="1.05"
                max="10"
                step="0.05"
                value={aPlusRiskMultiplier}
                onChange={(e) => setAPlusRiskMultiplier(e.target.value)}
                placeholder="e.g. 1.5"
                className={styles.numberInput}
              />
            </label>
            <p className={styles.helper}>
              Effective cap on an A+ setup = Max Risk Per Trade × this
              multiplier. Leave blank to keep all setups at the same cap.
            </p>
          </section>

```

- [ ] **Step 4: Build + tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: clean; 15 pass.

- [ ] **Step 5: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/PortfolioSettingsModal.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-discipline): A+ tagging chips + risk multiplier in Portfolio Settings"
```

---

## Task 9: AddPositionModal — render panel + elevated cap

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddPositionModal.jsx`

- [ ] **Step 1: Imports**

Add at the top:

```jsx
import useJ2SetupStats from '../hooks/useJ2SetupStats'
import SetupStatsPanel from './SetupStatsPanel'
```

- [ ] **Step 2: Hook calls**

In the component body, after the existing discipline-state hook:

```jsx
  const { stats: setupStats } = useJ2SetupStats(accountId, setup)
```

- [ ] **Step 3: Compute effective cap**

Replace the existing `cap` derivation:

```jsx
  const cap = settings?.maxRiskPerTradePct
```

With:

```jsx
  const baseCap = settings?.maxRiskPerTradePct
  const isAPlus = !!setup && (settings?.aPlusSetups || []).includes(setup)
  const multiplier = settings?.aPlusRiskMultiplier
  const effectiveCap = (baseCap != null && isAPlus && multiplier != null && multiplier > 1)
    ? baseCap * multiplier
    : baseCap
  const cap = effectiveCap
```

The rest of the `overCap` derivation continues to use `cap` so the existing banner logic just works against the elevated cap.

- [ ] **Step 4: Render the panel**

Locate the existing setup `<select>` element (near the bottom of the form, before Notes). Immediately AFTER its wrapping `<label>` closing tag, render the panel:

```jsx
            <SetupStatsPanel stats={setupStats} isAPlus={isAPlus} />
```

- [ ] **Step 5: Update the risk-cap banner copy to mention elevated A+ status**

Find the existing risk-cap banner. Currently it says `your cap of {cap}%`. Update to optionally surface the A+ elevation:

```jsx
              your cap of <strong>{cap}%</strong>
              {isAPlus && multiplier != null && (
                <span style={{ opacity: 0.85 }}>
                  {' '}(A+ elevated from {baseCap}% × {multiplier})
                </span>
              )}.
```

- [ ] **Step 6: Build + tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

- [ ] **Step 7: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/AddPositionModal.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-discipline): render SetupStatsPanel + apply A+ multiplier in AddPosition"
```

---

## Task 10: AddTradeModal — same integration

**Files:**
- Modify: `app/src/pages/journal-2-0/components/AddTradeModal.jsx`

- [ ] **Step 1: Mirror Task 9 in AddTradeModal**

Same imports, same hook call, same effective-cap derivation, same panel render after the setup picker, same banner copy update.

The only difference: `setup` state in AddTradeModal is named `setupVal` per the existing code — adapt accordingly.

- [ ] **Step 2: Build + tests**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npm run build
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/AddTradeModal.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "feat(j2-discipline): render SetupStatsPanel + apply A+ multiplier in AddTrade"
```

---

## Task 11: PortfolioSettingsModal Phase C round-trip test

**Files:**
- Modify: `app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx`

- [ ] **Step 1: Append a new test**

```jsx
it('Phase C A+ inputs ship in the save payload', async () => {
  const user = userEvent.setup()
  const onSave = vi.fn().mockResolvedValue({})
  const settingsWithSetups = { ...baseSettings, setups: ['Bull Flag', 'Pullback'] }
  render(
    <PortfolioSettingsModal settings={settingsWithSetups} onSave={onSave} onClose={vi.fn()} />,
  )

  // Tag "Bull Flag" as A+ via the chip toggle
  await user.click(screen.getByRole('button', { name: 'Bull Flag', pressed: false }))

  const multInput = screen.getByLabelText(/A\+ Risk Multiplier/i)
  await user.clear(multInput)
  await user.type(multInput, '1.5')

  await user.click(screen.getByRole('button', { name: 'Save Settings' }))

  expect(onSave).toHaveBeenCalledTimes(1)
  const payload = onSave.mock.calls[0][0]
  expect(payload.aPlusSetups).toEqual(['Bull Flag'])
  expect(payload.aPlusRiskMultiplier).toBe(1.5)
})
```

- [ ] **Step 2: Run**

```bash
cd C:/Users/Patrick/uct-dashboard/app
npx vitest run src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
```

Expected: 16 pass.

- [ ] **Step 3: Commit**

```bash
git -C C:/Users/Patrick/uct-dashboard add app/src/pages/journal-2-0/components/PortfolioSettingsModal.test.jsx
git -C C:/Users/Patrick/uct-dashboard commit -m "test(j2-discipline): Phase C A+ tagging round-trips via Save Settings"
```

---

## Task 12: End-to-end smoke + push

- [ ] **Step 1**

```bash
cd C:/Users/Patrick/uct-dashboard
python -m pytest api/services/journal_two/ -q
cd app
npm run build
npx vitest run src/pages/journal-2-0/
```

Expected: clean across all three.

- [ ] **Step 2: Push**

```bash
git push origin master
```

---

## Self-Review Checklist

- [ ] camelCase ↔ snake_case mapping consistent across `db.py`, `settings.py`, `accounts.py`.
- [ ] Phase A risk-cap banner still works on ALL setups (when no setup picked OR when setup is non-A+, the cap is unchanged).
- [ ] When setup IS A+ AND multiplier configured AND base cap configured, the banner shows the elevated cap and explains why.
- [ ] SetupStatsPanel handles loading (undefined), empty (tradeCount=0), and populated cases.
- [ ] No-setup-picked is handled gracefully (panel renders nothing, hook fetches nothing).
- [ ] Settings round-trip test covers A+ tagging + multiplier.
