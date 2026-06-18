# Account-Balance Calendar — Design

**Date:** 2026-06-17
**Status:** Approved; ready to plan/implement
**Initiative:** Journal 2.0 — Calendar
**Depends on:** Broker Sync → `historical_equity.reconstruct_daily_equity` — **already on master** (HEAD `22f55ecb` "perf(broker): cache the daily reconstruction"). The dependency is satisfied; implement now.

## Problem

The Journal 2.0 calendar (`/journal` → Calendar tab) shows daily/weekly P&L in calendar form. Today every cell is **realized closed-trade** P&L: the sum of trades whose `exit_date` (ET-bucketed) lands on that day. It never reflects the mark-to-market of positions you were *holding*. A trader watching their brokerage sees their **account balance** move every day from open-position gains/losses, not just on the days they close trades.

The user wants the calendar to be **account-balance based**: each day = the change in total account net-liquidation value from prior close → that day's close (incl. open-position MTM), with the **most recent day live to the current value**. A toggle lets the user switch back to closed-trade-only. Default = account balance.

This intentionally diverges from `feedback_j2_account_balance` (which locked J2 "balance" displays to closed-trade equity) **for the calendar surface specifically**, now that real broker net-liq data exists.

## Decisions (confirmed with user 2026-06-17)

1. **Data source:** consume the broker daily net-liq series from `historical_equity.reconstruct_daily_equity`. No duplicate MTM logic in the calendar.
2. **Manual accounts:** account-balance mode is **broker-only**. Manual accounts are unchanged (closed-trade) and show **no toggle**.
3. **Day math:** **close-to-close with a live right edge.** Completed day `d` = `net_liq(close d) − net_liq(close prev trading day)`. Latest day = `current net-liq − last close`. Non-trading days carry forward (no change shown).
4. **All Accounts view:** account-balance toggle is offered **only when a single broker-connected account is selected**. The All-Accounts (aggregate) view stays closed-trade based.
5. **Sequencing:** dependency is already on master → implement now. Reads only; no edits to the parallel session's broker hot files.

## Scope

- **In scope:** the J2 Calendar tab (Year / Month / Week views + day-detail drawer), backend `get_calendar`/`get_day_detail`, the `useJ2Calendar` hook, and a calendar-header basis toggle.
- **Out of scope:** manual-account MTM; All-Accounts aggregate account-balance; intraday/within-day granularity; any edit to the broker reconstruction itself.

## Consumer interface (already present on master)

```python
historical_equity.reconstruct_daily_equity(
    user_id, account_id, *, price_fn=None, live_equity=None, today=None, conn=None
) -> list[{ "date": "YYYY-MM-DD", "equity": float, "estimated": False, "partial": bool }]
```

- Returns one point **per weekday** from first activity → today (union of event dates + today), ascending. Exactly the daily granularity the calendar needs.
- Returns `[]` for a non-broker account or one with no events → natural signal for the closed-trade fallback.
- **Live right edge:** the function only overwrites the last point with live net-liq when `live_equity` is passed. The calendar resolves it the same way `performance_service.account_performance` does:

```python
from api.services.journal_two import accounts as _accounts
from api.services.journal_two.broker import historical_equity
acct = _accounts.get_account(user_id, account_id, conn=conn)
live_eq = (float(acct["brokerTotalEquity"])
           if acct and acct.get("brokerTotalEquity") is not None else None)
series = historical_equity.reconstruct_daily_equity(
    user_id, account_id, live_equity=live_eq, conn=conn) or []
```

The whole block is wrapped in `try/except` (defensive): any failure → empty series → closed-trade fallback, so the calendar can never error on the broker path.

## Architecture

### Backend (`api/services/journal_two/calendar.py`)

- `get_calendar(...)` gains `basis: 'account' | 'closed'` (default `'closed'`). The client sends `'account'` only when a single broker account is selected.
- New helper `_account_equity_days(user_id, account_id, start, end, conn) -> (days, totals)`:
  1. Resolve the live-edged series via the block above. Build a `{date: equity}` map and the ascending list of `(date, equity)` points.
  2. For each point whose `date` is inside `[start, end]`, compute `delta = equity(d) − equity(prev point)`, where "prev point" is the immediately preceding point in the **full** series (it may fall before `start` — that's what makes the first in-window cell correct). The **only** point with no predecessor is the absolute first point in the entire series (inception day): delta `0`, omitted from the grid.
  3. Emit the **same day payload shape** as closed mode so the grid renders unchanged:
     - `pnlDollar` = `delta`
     - `pnlPercent` = `delta / equity(prev point)` (true daily % return; `0` if prior equity ≤ 0)
     - `date`, plus `tradeCount` / `winners` / `losers` carried from the existing closed-trade aggregation for that day (badges/secondary info), `hasNotes` / `expiringCount` from the existing paths.
  4. `totals`: `netPnlDollar` = `equity(last in-window point) − equity(prev-before-window point)`; `winRate`/`rSum`/counts sourced from the existing closed-trade aggregation (unchanged semantics). Payload carries `basis: 'account'`.
- `get_calendar` flow: if `basis == 'account'` AND `account_id` is a single broker account (`balanceSource != 'manual'`) AND the series is non-empty → use `_account_equity_days`. Otherwise run the existing closed-trade aggregation untouched and return `basis: 'closed'` (so the client can detect a downgrade).
- `get_day_detail(...)` gains the same `basis`. In account mode the metrics row adds:
  - `accountBalanceChange` = that day's net-liq delta (headline),
  - `realizedPnl` = the day's closed-trade P&L (existing total),
  - `unrealizedChange` = `accountBalanceChange − realizedPnl` (open-position remainder),
  - existing `trades` / `strategies` lists unchanged.

The `historical_equity` import is wrapped so any absence/failure degrades to closed mode rather than erroring.

### Frontend

- **`useJ2Calendar.js`** — accept and forward a `basis` param into the query string (`&basis=account`). Return the server-echoed `basis` so the UI can reflect a downgrade.
- **Calendar header** (`pages/journal-2-0/components/calendar/CalendarHeader.jsx`) — segmented control **Account Balance | Closed Trades**.
  - Persisted via `usePreferences('j2_calendar_pnl_basis')`, default `'account'`.
  - Rendered only when the selected account is broker-connected (single account, `balanceSource !== 'manual'`). Otherwise hidden and the effective basis forced to `'closed'`.
  - Small caption/tooltip explains the active basis ("Daily change in account balance, incl. open positions" vs "Realized P&L from trades closed that day").
- **Cells** — no change. `cellBackground`, `fmtSignedDollar`, `fmtSignedPct` already render whatever `pnlDollar`/`pnlPercent` carry.
- **Day-detail drawer** (`components/calendar/DayDetailPage.jsx`) — in account mode show the headline balance change + the `realizedPnl` / `unrealizedChange` breakdown line above the existing trade list.

## Data flow

```
broker sync → reconstruct_daily_equity(account, live_equity)  ──┐
                                                                ├─► _account_equity_days (diff close-to-close, live right edge)
j2_trades / j2_day_notes (badges, counts) ─────────────────────┘        │
                                                                        ▼
                              get_calendar(basis='account')  → days[] {pnlDollar=Δnet-liq, pnlPercent=Δ/prev}
                                                                        ▼
                                    useJ2Calendar(basis) → existing Year/Month/Week grid (unchanged cells)
```

## Error handling / edge cases

- **Series unavailable / empty** (account never synced, reconstruction failed, manual account): respond `basis: 'closed'` with closed-trade days; client shows closed data and (when the user explicitly chose account mode) a subtle "account balance unavailable — showing closed trades" note.
- **Inception day** (absolute first series point): delta `0`, omitted — no spurious jump from zero, no divide-by-zero in `pnlPercent`.
- **Non-trading days / gaps:** the series is weekday-sampled; the calendar only renders points it has. Never synthesize a fake delta.
- **`partial:true` days** (a holding had no price that day): pass through; optionally badge the cell as approximate. v1 may render the value plainly.
- **Account switch / All-Accounts / manual:** force `basis='closed'` and hide the toggle.
- **DST / bucketing:** account mode keys purely off the reconstruction's `YYYY-MM-DD` (already ET trading-session dates); no `exit_date` UTC→ET conversion involved → no DST drift.

## Testing

Backend (pure — inject a fake `reconstruct_daily_equity`, or pass a stub series):
- Diffing: series `[100k, 100.5k, 100.2k, 101k]` over a 4-day window → deltas `+500/−300/+800`, first in-window cell uses the pre-window point.
- Inception day (absolute first series point) → delta `0` / omitted; no divide-by-zero in `pnlPercent`.
- Live right edge: last point = live net-liq → today's delta uses it.
- Fallback: empty series → `get_calendar` returns `basis:'closed'` with the existing closed aggregation.
- Manual account / All-Accounts → forced closed even if `basis='account'` requested.
- `get_day_detail` account mode → `accountBalanceChange == realizedPnl + unrealizedChange`.
- Totals: window net-liq endpoints subtract correctly.

Frontend:
- Toggle hidden for manual account; visible + default `account` for broker account.
- `useJ2Calendar` forwards `basis`; downgrade echo flips UI note.
- Day cells render account-mode `pnlDollar`/`pnlPercent` identically to closed mode (same color buckets).

## Coordination / git hygiene

- **No edits** to the parallel session's broker hot files (`broker/historical_equity.py`, `broker/performance_service.py`, `broker/balance_resolver.py`, etc.). Calendar only **reads** `reconstruct_daily_equity`.
- Calendar files (`calendar.py`, `useJ2Calendar.js`, `CalendarHeader.jsx`, `DayDetailPage.jsx`) are outside the broker hot set.
- Per `lesson_uct_dashboard_shared_worktree`: work in this isolated worktree, never `git add -A`, ship via fast-forward `push origin feat/account-balance-calendar:master`, rebase cleanly over the partner.
