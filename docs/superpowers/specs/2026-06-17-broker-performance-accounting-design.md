# Broker Performance Accounting — Design

**Date:** 2026-06-17
**Status:** Approved (design); pending implementation plan
**Initiative:** Broker Sync (Journal 2.0 / SnapTrade)
**Related principle:** `feedback_broker_mirror_fidelity` — J2 mirrors the broker account exactly; never curate/suppress imported data.

## Problem

J2's performance accounting is wrong the moment real-account reality intrudes:

- **Return %** is computed as `realized_trade_pnl / starting_balance` (`accounts.py::_account_metrics`). It ignores deposits, withdrawals, dividends, interest, fees, open-position mark-to-market, and margin. A $10k deposit looks like a $10k gain; a withdrawal looks like a loss.
- **Drawdown / equity curve** for the legacy path are built off the closed-trade equity curve (`starting_balance + Σ realized P&L`), not the real net-liq.
- Deposits/withdrawals/dividends/interest/fees are already pulled from SnapTrade and partitioned by the adapter into the `cash` bucket — then **discarded** by reconstruction. The data is in hand; we just don't use it.

Goal: make the journal + performance surfaces calculate performance *properly* — deposit/withdrawal-adjusted, margin-aware — for broker-linked accounts, with a user-selectable return metric, matching what mature trade-journal / broker products do.

## Scope

- **In scope (this spec):** broker-linked accounts (`balanceSource = 'broker'`). Fully automatic from the SnapTrade feed — zero manual entry.
- **Deferred (later spec):** manual (non-broker) accounts — they have no broker feed and would need a manual deposit/withdrawal CRUD UI. Manual accounts keep their current simple return until then.
- **Non-goals:** non-USD multi-currency performance (v1 is USD-focused, consistent with existing balances code); tax-lot/wash-sale accounting.

## Accounting principle (the core correctness rule)

Every cash transaction is classified as **external** or **internal**:

| Transaction | SnapTrade type(s) | Class | Effect on return |
|---|---|---|---|
| Deposit | `CONTRIBUTION` | External inflow (+) | Excluded from return; it's an adjustment the math removes |
| Withdrawal | `WITHDRAWAL` | External outflow (−) | Excluded from return |
| Transfer in/out | transfer activities | External | Excluded from return |
| Dividend | `DIVIDEND`, `STOCK_DIVIDEND`, `REI` | Internal income | **Part of** return (already in equity); shown in tx list |
| Interest (credit or margin-interest debit) | `INTEREST` | Internal income/cost | **Part of** return; shown in tx list |
| Fee/commission | `FEE` | Internal cost | **Part of** return; shown in tx list |

**Margin** is not a transaction class: a margin loan is never tagged `CONTRIBUTION`, so it cannot inflate return. Its only effects are (a) it amplifies returns (real, correct) and (b) its interest appears as an `INTEREST` cost. Net-liq equity already nets the loan (`equity = cash + market_value`, with a negative cash debit reducing equity). Margin *usage* is surfaced for display (buying power, margin used = −cash when negative) but needs no special return math.

**Consequence:** the return engine only needs the **equity series** + the **external-flow series**. Internal flows are deliberately *not* subtracted — they're already reflected in equity changes; subtracting them would double-count.

## Architecture

Three backend units + display surfaces. Each unit has one purpose and a clean interface.

### Unit 1 — Cash-flow ledger (capture)

New table `j2_broker_cash_flows`:

```
id            TEXT PK
user_id       TEXT
account_id    TEXT          -- j2 account
external_id   TEXT          -- stable fingerprint for idempotency (mirror trade dedup)
flow_date     TEXT          -- ISO date
flow_type     TEXT          -- deposit | withdrawal | dividend | interest | fee | transfer | other
amount        REAL          -- signed USD: + into account, − out
is_external   INTEGER       -- 1 = external (deposit/withdrawal/transfer), 0 = internal
currency      TEXT
source        TEXT          -- 'broker'
created_at    TEXT
UNIQUE(user_id, external_id)
```

- Populated during sync from the activities the adapter already classifies as `cash`. New `cashflow_reconstruct.py` (sibling to `option_reconstruct.py`) maps SnapTrade cash/transfer activities → ledger rows.
- **Idempotent + corrections-healing** exactly like trades: stable `external_id`, re-sync imports zero dupes, voided/amended activities pruned from the re-fetched window. Manual rows (none yet) never touched.
- USD-only in v1 (non-USD flows skipped, mirroring `market_value`).

### Unit 2 — Equity time series

- **Forward (accurate):** the existing `j2_broker_equity_snapshots` (daily net-liq, latest sync of day wins).
- **Pre-snapshot history (estimated):** `estimate_equity_series(account)` walks backward from the earliest real snapshot:
  `equity_est(t) = first_real_snapshot − netExternalFlows(after t) − realizedTradePnl(after t)`.
  This ignores historical open-MTM drift, dividends/interest/fees → flagged `estimated: true` per point. Acceptable per design decision ("accurate forward + approximate history, clearly labeled").

### Unit 3 — Performance engine (compute)

New pure module `performance.py`. Input: equity series (dated values) + external-flow series (dated signed amounts) + a period window. Output, per period (1W/1M/3M/YTD/1Y/All):

- **timeWeightedReturn** — chain sub-period returns split at each external-flow date. Per sub-period between flows: `r = (V_end − F_during) / V_start − 1` using the standard convention (flow applied at period boundary); `TWR = Π(1 + r_i) − 1`.
- **moneyWeightedReturn (XIRR)** — solve for the rate where `Σ flow_i / (1+r)^{t_i} + endValue/(1+r)^{T} − startValue = 0`. Numeric (bisection with a bracketed fallback; no external dep).
- **simpleReturn** — `(endEquity − startEquity − netExternalFlows) / startEquity`.
- **dollarPnl** — `endEquity − startEquity − netExternalFlows` (true gain, net of deposits/withdrawals).
- **netDeposits, netWithdrawals, dividends, interest, fees** — summed line items for the window.
- **estimated** — true if the window draws on estimated equity points.

Pure function, no I/O. The accounting rules are pinned by tests (below). A thin service layer assembles the series from the ledger + snapshots and calls the engine.

### Display surfaces

- **Performance section (Analytics tab — backend-driven):** metric selector (TWR · Money-Weighted · Simple · $ P&L), a summary line (selected return + $ P&L + net deposits/withdrawals + dividends/interest/fees), and the equity curve annotated with **▲ deposit / ▼ withdrawal** markers. Estimated history visually distinguished (e.g. dashed).
- **Transactions list:** the secondary transactions (deposits, withdrawals, dividends, interest, fees) — the "see all transactions" view.
- **Account return %** (AccountSelector / Comparison / AccountsTab): switch from naive `realizedP&L / startingBalance` to the chosen cash-flow-adjusted metric for broker accounts (default TWR). Manual accounts unchanged.
- **Margin display:** buying power + margin used (−cash when negative) on the account / positions summary.

Default headline metric: **TWR**, user-switchable (persisted preference).

## Endpoints (additive)

- `GET /api/j2/broker/performance?accountId=&period=` → all metrics for the window + the annotated equity series + flow summary.
- `GET /api/j2/broker/cash-flows?accountId=&period=` → the transactions list.
- (Account-return wiring reuses the existing accounts/comparison serializers, switching the broker-account return source to the engine.)

## Data flow

```
SnapTrade activities ──(adapter.partition: cash/transfers)──► cashflow_reconstruct
                                                                   │ idempotent + heal
                                                                   ▼
                                                          j2_broker_cash_flows
                                                                   │
  j2_broker_equity_snapshots (fwd) ─┐                              │
  estimate_equity_series (hist) ────┴──► equity series            │ external flows
                                              │                    │
                                              ▼                    ▼
                                        performance.py (pure: TWR / XIRR / simple / $P&L)
                                              │
                                              ▼
                          /api/j2/broker/performance  +  /cash-flows  +  account return %
```

## Error handling / edge cases

- **Empty / single-point series** → return nulls (not 0%) so the UI shows "—", never a fake 0.
- **Zero or negative start equity** (fully withdrawn / new account) → guard divisions; TWR/simple null for that sub-period, XIRR may still be defined.
- **XIRR non-convergence** (pathological flows) → return null for MWR, keep the others.
- **Deposit on day with a market move** → TWR splits at the flow date so the deposit isn't counted as gain (pinned by test).
- **Best-effort, never breaks sync** — cash-flow capture wraps in try/except like the existing balances/options enrichment; a hiccup must not fail the core trade/position sync.

## Coordination (shared worktree)

Backend (ledger, engine, metric wiring, endpoints) is collision-free and holds the correctness — **build and ship it first**. The equity-curve UI is the parallel session's hot zone (`OpenPositionsTab`); the new performance UI lands primarily in the **Analytics tab** + a transactions section to minimize collision, and the equity-curve markers are added carefully/coordinated. Follow the shared-worktree procedure: isolated worktree edits, re-read before edit, stage only own files, FF-push `worktree-broker-sync:master`, `grep -c broker_sync api/main.py ≥ 7` before any push.

## Testing

Synthetic cases pin the accounting (pure-engine, no broker needed):

- Deposit mid-period, **no market move** → TWR = 0% (the headline correctness test).
- Withdrawal mid-period, no market move → TWR = 0% (no phantom loss).
- Dividend → counts as return (not subtracted as an external flow).
- Known-answer **XIRR** (e.g. textbook flow set) within tolerance.
- `dollarPnl` = end − start − netDeposits across deposit/withdrawal mix.
- Margin: negative cash → equity below market value (already covered) → performance uses net-liq.
- Ledger: idempotent re-sync = 0 dupes; voided activity pruned; deposit/withdrawal/dividend/interest/fee classified to the right `flow_type` + `is_external`.
- Estimated-history flag set when the window predates the first real snapshot.

## Phasing

1. **Ledger + capture** (`j2_broker_cash_flows`, `cashflow_reconstruct`, wired into sync, idempotent/heal) + tests.
2. **Performance engine** (`performance.py` pure) + series assembly service + tests.
3. **Endpoints** (`/performance`, `/cash-flows`).
4. **Surfaces** — account-return wiring (backend) → Analytics performance section + transactions list → equity-curve markers (coordinated).

Manual-account cash-flow entry = a later spec.
