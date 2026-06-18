# Accurate Historical Portfolio Reconstruction — Design

**Date:** 2026-06-17
**Status:** Approved direction; spec for review
**Initiative:** Broker Sync (Journal 2.0)
**Supersedes:** the estimated walk-back in `performance_service` (`feedback_broker_mirror_fidelity`)

## Problem

The broker equity curve is **estimated**: it walks back from the first net-liq snapshot subtracting only *realized* trade P&L, so it ignores the mark-to-market of positions you were *holding* at each past date. The user — correctly — wants a *perfectly accurate* daily portfolio-value curve, the way a brokerage shows it. We have the data to do it.

## Capability audit (verified 2026-06-17)

- **Historical daily STOCK closes:** Massive/Polygon `/v2/aggs/ticker/{T}/range/1/day/{from}/{to}` (also yfinance/FMP fallback). ✅
- **Historical daily OPTION closes:** the SAME `/v2/aggs/ticker/O:{OCC}/range/1/day/...` endpoint returns option daily bars — **probed live** against both `MASSIVE_API_KEY` and `POLYGON_API_KEY`: `O:AAPL260116C00200000` → 50 daily bars, `status=OK`. ✅ (This closes the only suspected gap.)
- **Holdings + cash + option legs + corporate actions:** SnapTrade activities (`get_activities`) + option holdings expose strike/expiry/type/underlying → OCC symbol is constructible. ✅
- **Immediate/live current value:** Massive stock snapshot + SnapTrade/Massive option mark for the live right-edge. ✅
- **Env (Railway prod, confirmed set):** `MASSIVE_API_KEY`, `POLYGON_API_KEY`, `SNAPTRADE_*`, `FMP_API_KEY`, `FINNHUB_API_KEY`, plus options-data extras (`UW_API_KEY`, `BULLFLOW_API_KEY`). No new secrets required.

## Goal

Replace the estimated series with a **true daily mark-to-market reconstruction** of net-liquidation value for broker accounts: `net_liq(day) = cash(day) + Σ stock_shares(day)×close(day) + Σ option_contracts(day)×opt_close(day)×100`. Accurate from the first activity to today, with a live right-edge.

## Scope

- **In scope:** broker-linked accounts. Stocks + options + cash, marked to historical prices.
- **Out of scope:** manual accounts (separate cash-flow spec); intraday historical granularity (daily closes only); non-USD/FX.

## Architecture

New service **`historical_equity.py`** (`api/services/journal_two/broker/`) with one public function:

`reconstruct_daily_equity(user_id, account_id, conn=None) -> list[{date, equity, estimated:false}]`

### Algorithm

1. **Load activities** for the account (already persisted in `j2_broker_activities`; partition via `snaptrade_adapter`). Need equity fills, option events, cash flows, and split events.
2. **Replay chronologically** to build, per calendar day from first activity → today:
   - `stock_shares: {ticker: shares}` (buy +, sell −, split ×factor).
   - `option_contracts: {occ: contracts}` (open +, close/expire/assign/exercise −).
   - `cash`: deposits +, withdrawals −, buy −(qty×price+fee), sell +(qty×price−fee), dividends +, interest ±, fees −.
   - Carry each day's state forward (step function; changes only on activity days).
3. **Collect the price universe:** every ever-held stock ticker + every ever-held OCC option symbol, with each one's first/last held date.
4. **Fetch UNADJUSTED daily closes** for each symbol over its held window via the aggregates endpoint (`adjusted=false` — point-in-time valuation must use as-traded shares × raw historical price; splits handled explicitly in step 2 via split events). Options use `O:{OCC}`. Reuse the existing Massive client + bars cache; forward-fill non-trading days, gaps, and pre-listing with the nearest available close.
5. **Compute `net_liq(day)`** across the date range = cash(day) + Σ stock marks + Σ option marks (×100, ×10 for minis).
6. **Live right-edge:** the final point uses the live net-liq (`account.brokerTotalEquity`) so the curve's right edge is current, not stale-until-next-sync.
7. Return the daily series (all `estimated:false`). `performance_service.account_performance` uses this as the equity series (replacing the estimated walk-back) — the hero + PerformancePanel curves and TWR/MWR then run on exact data.

### OCC symbol builder

`occ(underlying, expiration 'YYYY-MM-DD', type 'call'|'put', strike) -> 'O:' + UNDERLYING + YYMMDD + (C|P) + str(round(strike*1000)).zfill(8)`. Built from SnapTrade option-leg fields (already imported). Verified format: `O:AAPL260116C00200000`.

### Splits

Activities carrying split events adjust `stock_shares` on the split date; valuation uses `adjusted=false` prices so as-traded share counts match raw prices. If a split is absent from the activity feed (broker omitted it), that symbol's pre-split valuation may be off — detected by a share-vs-holdings reconciliation check and logged (not silently wrong).

## Caching / performance

- Reconstruction fans out one aggregates fetch per ever-held symbol (~20–40 calls for a typical account), all routed through the existing bars cache (memory/disk/R2) — warm after first build.
- Recompute on sync (best-effort, never blocks sync). Cache the resulting series (in-memory TTL keyed by account + a holdings-hash; recompute when activities change). First cold build may take a few seconds → compute async, serve `estimated` walk-back or last-cached until ready.

## Error handling / edge cases

- Missing/*halted* price day → forward-fill last close; if a symbol has no aggregates at all (delisted/obscure) → fall back to last known trade price from activities for that holding, flag the day's point `partial:true`.
- Option with no aggregates (illiquid/expired-worthless) → value 0 after expiry, cost-basis or last aggregate before expiry otherwise; flag `partial`.
- Empty account / pre-first-activity → no points (curve hidden), unchanged behavior.
- All fetches best-effort; a provider hiccup degrades to the prior cached series, never errors the page.

## Testing

Pure, deterministic unit tests (no live API — inject a price-lookup fn):
- Replay: buy 100 @ $10, later sell 40 → holdings/cash correct each day.
- Mark-to-market: hold 100 shares, price 10→12 over 3 days, $0 cash → net_liq 1000→1200 (the core "it reflects holding gains" test the estimated version failed).
- Option: hold 2 contracts, opt close 1.50→2.10 → +$120 (×100).
- Split: 2:1 split doubles shares; unadjusted price halves → net_liq continuous across the split.
- Deposit mid-window: net_liq steps up by the deposit, but TWR (downstream) stays flat (no phantom gain).
- OCC builder: known leg → `O:AAPL260116C00200000`.
- Integration (marks mocked): `performance_service` returns `estimated:false` series; TWR computed on exact marks.

## Coordination

Backend-only; no edits to the parallel session's hot files. `performance_service` swaps its series source (one internal change). Shared-worktree procedure as before (own files only, FF-push, rebase over partner).
