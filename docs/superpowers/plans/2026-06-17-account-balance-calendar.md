# Account-Balance Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an "Account Balance | Closed Trades" basis toggle to the Journal 2.0 calendar; in account-balance mode each day shows the close-to-close change in the broker account's net-liquidation value (live right edge), derived by differencing `historical_equity.reconstruct_daily_equity`.

**Architecture:** Backend `get_calendar`/`get_day_detail` gain a `basis` param. A new pure helper diffs the broker daily net-liq series into the existing day-payload shape so the grid renders unchanged. Account-balance mode is broker-only with a closed-trade fallback; manual accounts + All-Accounts stay closed. Frontend adds a broker-only segmented toggle persisted via `usePreferences`.

**Tech Stack:** FastAPI + SQLite (Python), React + Vite (vitest), SWR.

**Spec:** `docs/superpowers/specs/2026-06-17-account-balance-calendar-design.md`

## Global Constraints

- **Reads only** from the parallel session's broker hot files (`broker/historical_equity.py`, `broker/performance_service.py`). Never edit them.
- Work in this isolated worktree; never `git add -A` (stage explicit paths); ship via fast-forward `git push origin feat/account-balance-calendar:master`; rebase cleanly over the partner. (`lesson_uct_dashboard_shared_worktree`)
- Account object keys are camelCase: `balanceSource` (`'manual'` for non-broker), `brokerTotalEquity` (number|null). Account row column is `balance_source`.
- Reconstruction interface (already on master): `historical_equity.reconstruct_daily_equity(user_id, account_id, *, live_equity=None, conn=None) -> [{date:'YYYY-MM-DD', equity:float, estimated:bool, partial:bool}]`, ascending, weekday-sampled, `[]` for non-broker/empty.
- Day payload shape that the grid consumes (unchanged): `{date, pnlDollar, pnlPercent, rSum, tradeCount, winners, losers, hasNotes, expiringCount}`.
- The `historical_equity` import in `calendar.py` MUST be wrapped so any import/runtime failure degrades to closed mode — never error the calendar.
- Run backend tests with: `cd <worktree> && python -m pytest api/services/journal_two/test_calendar.py -q`
- Run frontend tests with: `cd <worktree>/app && npx vitest run src/pages/journal-2-0/<file>`

---

### Task 1: Backend — pure `_account_equity_days` differ

**Files:**
- Modify: `api/services/journal_two/calendar.py` (add helper near `_aggregate_trades`)
- Test: `api/services/journal_two/test_calendar.py`

**Interfaces:**
- Produces: `_account_equity_days(series: list[dict], start_iso: str, end_iso: str, closed_days: list[dict]) -> tuple[list[dict], dict]` — `series` is the full ascending net-liq series; `closed_days` is the existing closed-aggregation day list (for tradeCount/winners/losers/hasNotes/expiringCount overlay). Returns `(days, totals)` in the standard payload shape with each in-window day's `pnlDollar` = net-liq delta vs the immediately-preceding series point, `pnlPercent` = delta/prevEquity. `totals.netPnlDollar` = last-in-window equity − pre-window equity. The absolute first series point (no predecessor) is skipped.

- [ ] **Step 1: Write the failing test**

```python
def test_account_equity_days_diffs_close_to_close():
    from api.services.journal_two.calendar import _account_equity_days
    series = [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
        {"date": "2026-06-03", "equity": 100200.0},
        {"date": "2026-06-04", "equity": 101000.0},
    ]
    # window covers 06-02..06-04; 06-01 is the pre-window anchor.
    days, totals = _account_equity_days(series, "2026-06-02", "2026-06-04", [])
    by_date = {d["date"]: d for d in days}
    assert round(by_date["2026-06-02"]["pnlDollar"], 2) == 500.0
    assert round(by_date["2026-06-03"]["pnlDollar"], 2) == -300.0
    assert round(by_date["2026-06-04"]["pnlDollar"], 2) == 800.0
    assert round(by_date["2026-06-02"]["pnlPercent"], 6) == round(500.0 / 100000.0, 6)
    assert round(totals["netPnlDollar"], 2) == 1000.0  # 101000 - 100000


def test_account_equity_days_skips_inception_point():
    from api.services.journal_two.calendar import _account_equity_days
    series = [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
    ]
    # window starts at inception; 06-01 has no predecessor → omitted.
    days, totals = _account_equity_days(series, "2026-06-01", "2026-06-02", [])
    by_date = {d["date"]: d for d in days}
    assert "2026-06-01" not in by_date
    assert round(by_date["2026-06-02"]["pnlDollar"], 2) == 500.0


def test_account_equity_days_overlays_closed_badges():
    from api.services.journal_two.calendar import _account_equity_days
    series = [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
    ]
    closed_days = [{"date": "2026-06-02", "pnlDollar": 200.0, "rSum": 1.5,
                    "tradeCount": 3, "winners": 2, "losers": 1,
                    "hasNotes": True, "expiringCount": 0, "pnlPercent": 0.002}]
    days, _ = _account_equity_days(series, "2026-06-02", "2026-06-02", closed_days)
    d = days[0]
    assert d["pnlDollar"] == 500.0          # account delta wins for the headline number
    assert d["tradeCount"] == 3             # badge carried from closed aggregation
    assert d["winners"] == 2 and d["losers"] == 1
    assert d["hasNotes"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest api/services/journal_two/test_calendar.py -k account_equity_days -q`
Expected: FAIL with `ImportError`/`AttributeError: _account_equity_days`.

- [ ] **Step 3: Write minimal implementation**

Add to `api/services/journal_two/calendar.py` (after `_aggregate_trades`):

```python
def _account_equity_days(
    series: list[dict[str, Any]],
    start_iso: str,
    end_iso: str,
    closed_days: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Difference a daily net-liq series into per-day balance-change buckets.

    `series` is the full ascending [{date, equity}, ...] reconstruction.
    Each in-window day's pnlDollar = equity(d) − equity(immediately-preceding
    point in the FULL series); the absolute first point (no predecessor) is
    skipped. pnlPercent = delta / prevEquity. Badge/count fields are overlaid
    from the closed-trade aggregation (`closed_days`)."""
    closed_by_date = {d["date"]: d for d in closed_days}

    days: list[dict[str, Any]] = []
    window_first_prev: float | None = None
    window_last_equity: float | None = None

    for i, point in enumerate(series):
        d = point["date"]
        if not (start_iso <= d <= end_iso):
            continue
        if i == 0:
            # Inception day: no predecessor → no defined daily change. Skip.
            continue
        prev_equity = float(series[i - 1]["equity"])
        equity = float(point["equity"])
        delta = equity - prev_equity
        if window_first_prev is None:
            window_first_prev = prev_equity
        window_last_equity = equity

        c = closed_by_date.get(d, {})
        days.append({
            "date": d,
            "pnlDollar": delta,
            "pnlPercent": (delta / prev_equity) if prev_equity > 0 else 0.0,
            "rSum": c.get("rSum", 0.0),
            "tradeCount": c.get("tradeCount", 0),
            "winners": c.get("winners", 0),
            "losers": c.get("losers", 0),
            "hasNotes": c.get("hasNotes", False),
            "expiringCount": c.get("expiringCount", 0),
        })

    days.sort(key=lambda x: x["date"])

    net = (
        (window_last_equity - window_first_prev)
        if (window_last_equity is not None and window_first_prev is not None)
        else 0.0
    )
    # Win-rate / counts come from the closed aggregation (semantics unchanged).
    winners = sum(c.get("winners", 0) for c in closed_days)
    losers = sum(c.get("losers", 0) for c in closed_days)
    totals = {
        "netPnlDollar": net,
        "grossPnlDollar": net,
        "fees": 0.0,
        "tradeCount": sum(c.get("tradeCount", 0) for c in closed_days),
        "winners": winners,
        "losers": losers,
        "winRate": (winners / (winners + losers)) if (winners + losers) > 0 else None,
        "rSum": sum(c.get("rSum", 0.0) for c in closed_days),
    }
    return days, totals
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest api/services/journal_two/test_calendar.py -k account_equity_days -q`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/calendar.py api/services/journal_two/test_calendar.py
git commit -m "feat(journal): pure account-balance day differ for calendar"
```

---

### Task 2: Backend — `basis` wiring in `get_calendar` + broker detection + series loader

**Files:**
- Modify: `api/services/journal_two/calendar.py` (`get_calendar` signature + branch; add `_account_is_broker`, `_load_equity_series`)
- Modify: `api/routers/journal_two.py:1005-1030` (add `basis` query param, pass through)
- Test: `api/services/journal_two/test_calendar.py`

**Interfaces:**
- Consumes: `_account_equity_days` (Task 1).
- Produces:
  - `_account_is_broker(user_id, account_id, conn) -> bool` — True iff the account row's `balance_source != 'manual'`.
  - `_load_equity_series(user_id, account_id, conn) -> list[dict]` — live-edged net-liq series via `historical_equity.reconstruct_daily_equity`; `[]` on any failure. **Monkeypatch target in tests.**
  - `get_calendar(user_id, *, view, year, month, week, account_id, basis='closed', conn=None)` — payload gains `"basis": 'account'|'closed'`.

- [ ] **Step 1: Write the failing test**

```python
def test_get_calendar_account_basis_uses_equity_series(db_conn, monkeypatch):
    import api.services.journal_two.calendar as cal
    uid = "u-acct"
    _add_user(db_conn, uid, "acct@example.com")
    # Broker account row.
    now = datetime.now(timezone.utc).isoformat()
    acct_id = str(uuid.uuid4())
    db_conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, account_size, starting_balance, "
        "created_at, updated_at, balance_source) VALUES (?,?,?,?,?,?,?,?, 'snaptrade')",
        (acct_id, uid, "RH", "#888", 100000, 100000, now, now),
    )
    db_conn.commit()
    monkeypatch.setattr(cal, "_load_equity_series", lambda u, a, conn=None: [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},
        {"date": "2026-06-03", "equity": 100200.0},
    ])
    out = cal.get_calendar(uid, view="month", year=2026, month=6,
                           account_id=acct_id, basis="account", conn=db_conn)
    assert out["basis"] == "account"
    by_date = {d["date"]: d for d in out["days"]}
    assert round(by_date["2026-06-02"]["pnlDollar"], 2) == 500.0
    assert round(by_date["2026-06-03"]["pnlDollar"], 2) == -300.0


def test_get_calendar_account_basis_falls_back_when_empty(db_conn, monkeypatch):
    import api.services.journal_two.calendar as cal
    uid = "u-fb"
    _add_user(db_conn, uid, "fb@example.com")
    now = datetime.now(timezone.utc).isoformat()
    acct_id = str(uuid.uuid4())
    db_conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, account_size, starting_balance, "
        "created_at, updated_at, balance_source) VALUES (?,?,?,?,?,?,?,?, 'snaptrade')",
        (acct_id, uid, "RH", "#888", 100000, 100000, now, now),
    )
    db_conn.commit()
    monkeypatch.setattr(cal, "_load_equity_series", lambda u, a, conn=None: [])
    out = cal.get_calendar(uid, view="month", year=2026, month=6,
                           account_id=acct_id, basis="account", conn=db_conn)
    assert out["basis"] == "closed"  # empty series → fallback


def test_get_calendar_manual_account_forces_closed(db_conn, monkeypatch):
    import api.services.journal_two.calendar as cal
    uid = "u-man"
    _add_user(db_conn, uid, "man@example.com")
    now = datetime.now(timezone.utc).isoformat()
    acct_id = str(uuid.uuid4())
    db_conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, account_size, starting_balance, "
        "created_at, updated_at, balance_source) VALUES (?,?,?,?,?,?,?,?, 'manual')",
        (acct_id, uid, "Manual", "#888", 100000, 100000, now, now),
    )
    db_conn.commit()
    # Even if a series exists, manual accounts never use it.
    monkeypatch.setattr(cal, "_load_equity_series",
                        lambda u, a, conn=None: [{"date": "2026-06-02", "equity": 1.0}])
    out = cal.get_calendar(uid, view="month", year=2026, month=6,
                           account_id=acct_id, basis="account", conn=db_conn)
    assert out["basis"] == "closed"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest api/services/journal_two/test_calendar.py -k "account_basis or forces_closed" -q`
Expected: FAIL (`get_calendar() got an unexpected keyword argument 'basis'`).

- [ ] **Step 3: Write minimal implementation**

In `calendar.py` add the helpers (top-level, after the date utilities):

```python
def _account_is_broker(user_id: str, account_id: str, conn: sqlite3.Connection) -> bool:
    row = conn.execute(
        "SELECT balance_source FROM j2_accounts WHERE id = ? AND user_id = ?",
        (account_id, user_id),
    ).fetchone()
    if row is None:
        return False
    keys = row.keys()
    src = row["balance_source"] if "balance_source" in keys else "manual"
    return bool(src) and src != "manual"


def _load_equity_series(
    user_id: str, account_id: str, conn: sqlite3.Connection | None = None
) -> list[dict[str, Any]]:
    """Live-edged daily net-liq series for a broker account. [] on any failure
    so the calendar always degrades to closed-trade mode rather than erroring."""
    try:
        from api.services.journal_two import accounts as _accounts
        from api.services.journal_two.broker import historical_equity
        acct = _accounts.get_account(user_id, account_id, conn=conn)
        live_eq = (
            float(acct["brokerTotalEquity"])
            if acct and acct.get("brokerTotalEquity") is not None
            else None
        )
        return historical_equity.reconstruct_daily_equity(
            user_id, account_id, live_equity=live_eq, conn=conn
        ) or []
    except Exception:
        return []
```

Then change `get_calendar`'s signature to add `basis: str = "closed"` (after `account_id`), and **after** the existing `days, totals = _aggregate_trades(...)` block computes the closed-trade `days` (with `hasNotes`/`expiringCount` already attached), insert the account-mode override just before building `payload`:

```python
        effective_basis = "closed"
        if (
            basis == "account"
            and account_id
            and _account_is_broker(user_id, account_id, conn)
        ):
            series = _load_equity_series(user_id, account_id, conn)
            if series:
                start_iso, end_iso = start.isoformat(), end.isoformat()
                days, totals = _account_equity_days(
                    series, start_iso, end_iso, days
                )
                effective_basis = "account"

        payload: dict[str, Any] = {
            "view": view,
            "year": year,
            "basis": effective_basis,
            "days": days,
            "totals": totals,
        }
```

(Keep the existing `if view == "month": payload["month"] = month` / week lines.)

In `api/routers/journal_two.py` `get_calendar` endpoint, add `basis: str = "closed"` to the params and pass `basis=basis` into `calendar_service.get_calendar(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest api/services/journal_two/test_calendar.py -q`
Expected: PASS (all calendar tests, including the 3 new + existing).

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/calendar.py api/services/journal_two/test_calendar.py api/routers/journal_two.py
git commit -m "feat(journal): account-balance basis in get_calendar (broker-only, closed fallback)"
```

---

### Task 3: Backend — `get_day_detail` account-mode breakdown

**Files:**
- Modify: `api/services/journal_two/calendar.py` (`get_day_detail` signature + metrics)
- Modify: `api/routers/journal_two.py` (`get_calendar_day` endpoint — add `basis` query param)
- Test: `api/services/journal_two/test_calendar.py`

**Interfaces:**
- Consumes: `_account_is_broker`, `_load_equity_series` (Task 2).
- Produces: `get_day_detail(user_id, date, *, account_id=None, basis='closed', conn=None)` — when account mode resolves, `metrics` gains `accountBalanceChange`, `realizedPnl`, `unrealizedChange` and `metrics.basis == 'account'`; `accountBalanceChange == realizedPnl + unrealizedChange`.

- [ ] **Step 1: Write the failing test**

```python
def test_day_detail_account_mode_breakdown(db_conn, monkeypatch):
    import api.services.journal_two.calendar as cal
    uid = "u-dd"
    _add_user(db_conn, uid, "dd@example.com")
    now = datetime.now(timezone.utc).isoformat()
    acct_id = str(uuid.uuid4())
    db_conn.execute(
        "INSERT INTO j2_accounts (id, user_id, name, color, account_size, starting_balance, "
        "created_at, updated_at, balance_source) VALUES (?,?,?,?,?,?,?,?, 'snaptrade')",
        (acct_id, uid, "RH", "#888", 100000, 100000, now, now),
    )
    db_conn.commit()
    # One closed trade on 2026-06-02 worth +200 realized.
    _add_trade(db_conn, uid, exit_date_iso="2026-06-02T18:00:00Z", pnl=200.0)
    db_conn.execute("UPDATE j2_trades SET account_id = ? WHERE user_id = ?", (acct_id, uid))
    db_conn.commit()
    monkeypatch.setattr(cal, "_load_equity_series", lambda u, a, conn=None: [
        {"date": "2026-06-01", "equity": 100000.0},
        {"date": "2026-06-02", "equity": 100500.0},  # +500 total balance change
    ])
    out = cal.get_day_detail(uid, "2026-06-02", account_id=acct_id,
                             basis="account", conn=db_conn)
    m = out["metrics"]
    assert m["basis"] == "account"
    assert round(m["accountBalanceChange"], 2) == 500.0
    assert round(m["realizedPnl"], 2) == 200.0
    assert round(m["unrealizedChange"], 2) == 300.0
    assert round(m["accountBalanceChange"], 2) == round(
        m["realizedPnl"] + m["unrealizedChange"], 2)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest api/services/journal_two/test_calendar.py -k day_detail_account_mode -q`
Expected: FAIL (`get_day_detail() got an unexpected keyword argument 'basis'`).

- [ ] **Step 3: Write minimal implementation**

In `get_day_detail`, add `basis: str = "closed"` to the signature (after `account_id`). After the existing `pnl_pct = ...` line and before building `trades_out`, compute the account-mode metric extension:

```python
        metrics = {**totals, "pnlPercent": pnl_pct}
        if (
            basis == "account"
            and account_id
            and _account_is_broker(user_id, account_id, conn)
        ):
            series = _load_equity_series(user_id, account_id, conn)
            by_date = {p["date"]: float(p["equity"]) for p in series}
            dates = sorted(by_date)
            if date in by_date:
                idx = dates.index(date)
                if idx > 0:
                    bal_change = by_date[date] - by_date[dates[idx - 1]]
                    realized = float(totals["netPnlDollar"])
                    metrics = {
                        **metrics,
                        "basis": "account",
                        "accountBalanceChange": bal_change,
                        "realizedPnl": realized,
                        "unrealizedChange": bal_change - realized,
                    }
```

Then return `"metrics": metrics` (replace the inline `{**totals, "pnlPercent": pnl_pct}` in the return dict with `metrics`).

In `api/routers/journal_two.py` `get_calendar_day`, add `basis: str = "closed"` param and pass `basis=basis` to `calendar_service.get_day_detail(...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest api/services/journal_two/test_calendar.py -q`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add api/services/journal_two/calendar.py api/services/journal_two/test_calendar.py api/routers/journal_two.py
git commit -m "feat(journal): account-mode balance breakdown in get_day_detail"
```

---

### Task 4: Frontend — `useJ2Calendar` forwards `basis`

**Files:**
- Modify: `app/src/pages/journal-2-0/hooks/useJ2Calendar.js`
- Test: `app/src/pages/journal-2-0/hooks/useJ2Calendar.test.js` (**create** — does not exist yet)

**Interfaces:**
- Produces: `useJ2Calendar({ view, year, month, week, accountId, basis })` — adds `&basis=` to the request when `basis` is set; returns `basis: data?.basis` in the result object (server-echoed effective basis).

- [ ] **Step 1: Write the failing test**

Create `app/src/pages/journal-2-0/hooks/useJ2Calendar.test.js`:

```js
import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { SWRConfig } from 'swr'
import useJ2Calendar from './useJ2Calendar'

// SWR dedupes globally; wrap to isolate the cache per test.
const wrapper = ({ children }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('useJ2Calendar basis', () => {
  it('includes basis in the request URL when provided', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ days: [], totals: null, basis: 'account' }),
    })
    renderHook(
      () => useJ2Calendar({ view: 'month', year: 2026, month: 6, basis: 'account' }),
      { wrapper },
    )
    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    expect(fetchSpy.mock.calls[0][0]).toContain('basis=account')
    fetchSpy.mockRestore()
  })
})
```

(If the JSX `wrapper` trips the `.js` extension, rename the test to `useJ2Calendar.test.jsx`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/hooks/useJ2Calendar.test.js`
Expected: FAIL (request URL lacks `basis=account`).

- [ ] **Step 3: Write minimal implementation**

In `useJ2Calendar.js`: add `basis` to the destructured opts; after the other `params.set(...)` lines add `if (basis) params.set('basis', basis)`; add `basis: data?.basis ?? basis` to the returned object.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/hooks/useJ2Calendar.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/hooks/useJ2Calendar.js app/src/pages/journal-2-0/hooks/useJ2Calendar.test.js
git commit -m "feat(journal): useJ2Calendar forwards pnl basis"
```

---

### Task 5: Frontend — basis toggle in CalendarHeader + CalendarTab wiring

**Files:**
- Modify: `app/src/pages/journal-2-0/components/calendar/CalendarHeader.jsx`
- Modify: `app/src/pages/journal-2-0/components/calendar/CalendarHeader.module.css` (reuse `.viewPills`/`.pill`; add a `.basisGroup` wrapper + `.basisCaption` if needed)
- Modify: `app/src/pages/journal-2-0/tabs/CalendarTab.jsx`
- Test: `app/src/pages/journal-2-0/components/calendar/CalendarHeader.test.jsx` (create if absent)

**Interfaces:**
- Consumes: `useJ2SelectedAccount()` → `account` (has `balanceSource`); `usePreferences`.
- Produces: CalendarHeader renders a **Account Balance | Closed Trades** segmented control only when `showBasisToggle` is true; calls `onBasisChange(next)`.

- [ ] **Step 1: Write the failing test**

Create `CalendarHeader.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import CalendarHeader from './CalendarHeader'

const base = {
  view: 'month', year: 2026, month: 6, week: undefined,
  totals: null, mode: 'pct',
  onViewChange: () => {}, onPeriodChange: () => {}, onModeChange: () => {},
  onBasisChange: () => {},
}

describe('CalendarHeader basis toggle', () => {
  it('shows the basis toggle when showBasisToggle is true', () => {
    render(<CalendarHeader {...base} showBasisToggle basis="account" />)
    expect(screen.getByRole('button', { name: /account balance/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /closed trades/i })).toBeInTheDocument()
  })

  it('hides the basis toggle when showBasisToggle is false', () => {
    render(<CalendarHeader {...base} showBasisToggle={false} basis="closed" />)
    expect(screen.queryByRole('button', { name: /account balance/i })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/calendar/CalendarHeader.test.jsx`
Expected: FAIL (toggle not rendered).

- [ ] **Step 3: Write minimal implementation**

In `CalendarHeader.jsx`: accept `basis`, `showBasisToggle`, `onBasisChange` props. Add (inside `.controlsRow`, before `.modeGroup`) a basis segmented control rendered only when `showBasisToggle`:

```jsx
const BASES = [
  { key: 'account', label: 'Account Balance' },
  { key: 'closed', label: 'Closed Trades' },
]
// ...
{showBasisToggle && (
  <div className={styles.modeGroup}>
    <span className={styles.modeLabel}>P&L basis</span>
    <div className={styles.viewPills} role="radiogroup" aria-label="P&L basis">
      {BASES.map((b) => (
        <button
          key={b.key}
          type="button"
          className={`${styles.pill} ${basis === b.key ? styles.pillActive : ''}`}
          onClick={() => onBasisChange(b.key)}
          aria-pressed={basis === b.key}
        >
          {b.label}
        </button>
      ))}
    </div>
  </div>
)}
```

In `CalendarTab.jsx` (the `usePreferences` hook is arg-less and returns `{ prefs, setPref }`; values are read with the named `parsePref` export):
- `import usePreferences, { parsePref } from '../../../hooks/usePreferences'` (verify the relative depth from `tabs/` to `app/src/hooks/` — it is three `../`).
- Extend the destructure to `const { accountId, account } = useJ2SelectedAccount()`.
- `const isBroker = !!account && account.balanceSource && account.balanceSource !== 'manual'`.
- `const { prefs, setPref } = usePreferences()`.
- `const basisPref = parsePref(prefs.j2_calendar_pnl_basis, 'account')`.
- `const effectiveBasis = isBroker ? basisPref : 'closed'`.
- Pass `basis: effectiveBasis` into `useJ2Calendar({...})`.
- Pass `showBasisToggle={isBroker}`, `basis={effectiveBasis}`, `onBasisChange={(b) => setPref('j2_calendar_pnl_basis', b)}` to `<CalendarHeader>`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/calendar/CalendarHeader.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/calendar/CalendarHeader.jsx app/src/pages/journal-2-0/components/calendar/CalendarHeader.module.css app/src/pages/journal-2-0/components/calendar/CalendarHeader.test.jsx app/src/pages/journal-2-0/tabs/CalendarTab.jsx
git commit -m "feat(journal): broker-only account-balance basis toggle on calendar"
```

---

### Task 6: Frontend — DayDetailPage account-mode breakdown line

**Files:**
- Modify: `app/src/pages/journal-2-0/components/calendar/DayDetailPage.jsx`
- Modify: `app/src/pages/journal-2-0/hooks/useJ2DayDetail.js` (forward `basis` to the day-detail request, mirroring Task 4)
- Test: `app/src/pages/journal-2-0/components/calendar/DayDetailPage.test.jsx` (create if absent) OR extend the existing day-detail test.

**Interfaces:**
- Consumes: `metrics.basis === 'account'` + `accountBalanceChange`/`realizedPnl`/`unrealizedChange` (Task 3). `useJ2DayDetail(date, accountId)` is positional and returns a **flattened** `{ metrics, trades, strategies, notes, isLoading, error, refresh }` (NOT `{ data }`).
- Produces: `useJ2DayDetail(date, accountId, basis)` — adds `&basis=` when set. When account mode, DayDetailPage renders a breakdown line: headline balance change + "Realized $X · Open positions $Y".

- [ ] **Step 1: Write the failing test**

Create/extend `DayDetailPage.test.jsx`. Mock the hook to return account-mode metrics (flattened shape), then assert the breakdown text appears:

```jsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('../../hooks/useJ2DayDetail', () => ({
  default: () => ({
    metrics: { basis: 'account', accountBalanceChange: 500, realizedPnl: 200,
               unrealizedChange: 300, netPnlDollar: 200, tradeCount: 1,
               winners: 1, losers: 0, winRate: 1, rSum: 1, pnlPercent: 0.005 },
    trades: [], strategies: { closed: [], expiring: [] }, notes: null,
    isLoading: false, error: null, refresh: () => {},
  }),
}))

// Import DayDetailPage AFTER the mock. Wrap in MemoryRouter if it reads route params.
import DayDetailPage from './DayDetailPage'

describe('DayDetailPage account-mode breakdown', () => {
  it('renders the balance-change breakdown when metrics.basis is account', () => {
    render(<DayDetailPage /* + any required router/props wrapper */ />)
    expect(screen.getByText(/account balance/i)).toBeInTheDocument()
    expect(screen.getByText(/realized/i)).toBeInTheDocument()
    expect(screen.getByText(/open positions/i)).toBeInTheDocument()
  })
})
```

(Check how `DayDetailPage` obtains `date`/`accountId` — likely route params via `useParams` + `useJ2SelectedAccount`; wrap the render in `MemoryRouter`/route as the existing page tests do, and mock `useJ2SelectedAccount` if needed.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/calendar/DayDetailPage.test.jsx`
Expected: FAIL (breakdown text not present).

- [ ] **Step 3: Write minimal implementation**

In `useJ2DayDetail.js`: accept + forward a `basis` arg into the request URL (mirror Task 4). Wire `CalendarTab`/`DayDetailPage`'s call site to pass `effectiveBasis` (thread it through whatever opens the day detail).

In `DayDetailPage.jsx`: when `metrics?.basis === 'account'`, render above the trade list:

```jsx
{metrics?.basis === 'account' && (
  <div className={styles.basisBreakdown}>
    <span className={styles.basisHeadline}>
      Account balance {fmtSignedDollar(metrics.accountBalanceChange)}
    </span>
    <span className={styles.basisDetail}>
      Realized {fmtSignedDollar(metrics.realizedPnl)} · Open positions {fmtSignedDollar(metrics.unrealizedChange)}
    </span>
  </div>
)}
```

(Import `fmtSignedDollar` from `../../lib/calendar`; add `.basisBreakdown`/`.basisHeadline`/`.basisDetail` to the page's CSS module.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run src/pages/journal-2-0/components/calendar/DayDetailPage.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/journal-2-0/components/calendar/DayDetailPage.jsx app/src/pages/journal-2-0/components/calendar/DayDetailPage.module.css app/src/pages/journal-2-0/hooks/useJ2DayDetail.js app/src/pages/journal-2-0/components/calendar/DayDetailPage.test.jsx
git commit -m "feat(journal): account-mode balance breakdown in day detail"
```

---

### Task 7: Build + full-suite verification + ship

**Files:** none (verification only)

- [ ] **Step 1: Backend calendar suite**

Run: `python -m pytest api/services/journal_two/test_calendar.py -q`
Expected: PASS (all, including new account-basis tests).

- [ ] **Step 2: Frontend build + touched tests**

Run: `cd app && npm run build` (MUST pass — `feedback_vite_manualchunks_object_form`), then
`cd app && npx vitest run src/pages/journal-2-0/hooks/useJ2Calendar.test.js src/pages/journal-2-0/components/calendar/CalendarHeader.test.jsx src/pages/journal-2-0/components/calendar/DayDetailPage.test.jsx`
Expected: build OK; tests PASS.

- [ ] **Step 3: Manual smoke (optional, against local backend + admin acct)**

Per CLAUDE.md mobile-audit harness boot; open `/journal` → Calendar with a broker account selected → toggle Account Balance / Closed Trades; with a manual account selected → toggle absent.

- [ ] **Step 4: Ship (fast-forward push to master)**

```bash
git fetch origin master
git rebase origin/master          # rebase cleanly over the partner; resolve only our files
python -m pytest api/services/journal_two/test_calendar.py -q   # re-verify post-rebase
git push origin feat/account-balance-calendar:master
```

(If the partner advanced master with conflicting edits in `calendar.py`/`journal_two.py`, re-apply our additive hunks — they are append/param-add only — never drop their changes.)

---

## Self-Review

**Spec coverage:**
- Basis param + broker-only + closed fallback → Task 2 ✓
- Close-to-close differ w/ live right edge + inception skip → Task 1 ✓ (live edge comes from `_load_equity_series` passing `live_equity`)
- Day-detail breakdown → Tasks 3, 6 ✓
- Frontend toggle (broker-only, default account, persisted) + hook forwarding → Tasks 4, 5 ✓
- All-Accounts / manual stay closed → Task 2 (manual forces closed; All-Accounts: `accountId` null → `_account_is_broker` false → closed) ✓
- Build-before-push + shared-worktree FF ship → Task 7 ✓

**Placeholder scan:** none — every code step has concrete code. The one adaptive note (usePreferences API shape in Task 5) instructs checking `usePreferences.js` because its return contract must be matched exactly; the surrounding wiring is fully specified.

**Type consistency:** `_account_equity_days(series, start_iso, end_iso, closed_days)` signature identical across Tasks 1–2. `basis` defaults to `'closed'` everywhere (service + router). Account key `balanceSource` (camelCase, frontend + `accounts.get_account`) vs column `balance_source` (backend SQL) used correctly in each layer. `reconstruct_daily_equity(..., live_equity=, conn=)` matches the on-master signature.
