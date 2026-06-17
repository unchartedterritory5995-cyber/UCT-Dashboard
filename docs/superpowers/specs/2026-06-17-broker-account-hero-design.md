# Broker Account Hero (Open Positions) — Design

**Date:** 2026-06-17
**Status:** Approved (design); pending implementation plan
**Initiative:** Broker Sync (Journal 2.0)
**Related:** `feedback_broker_mirror_fidelity` (mirror the broker), `lesson_uct_dashboard_shared_worktree` (OpenPositionsTab is a parallel session's hot file)

## Problem

Opening **Journal → Open Positions** on a broker account doesn't lead with the numbers a trader checks first. Today the top shows a modest `BrokerEquityCurve` card (account equity + period change + small SVG) followed by a row of small StatPills (Positions · Value · Invested · Risk · Heat · Unrealized). It reads like a journal table, not a brokerage dashboard. The user wants account value, P&L, and the performance chart **front and center, broker-app style**, the moment the tab opens.

## Goal

A prominent **Account Hero** at the top of Open Positions for broker-linked accounts: dominant account value, today's P&L ($ + %), period P&L tied to the chart range, a large equity curve, and a secondary line of key balances (open P&L, cash, buying power, margin used, invested %). Journal-specific Risk/Heat stay in the smaller stats row below.

## Scope

- **In scope:** broker-linked accounts (`account.balanceSource === 'broker'`). One new component; a one-line swap in `OpenPositionsTab`.
- **Out of scope:** manual accounts (keep the current stats row, no hero). No backend changes — all data already exists. No new chart library (reuse the existing self-contained SVG approach).

## Approach

New component **`BrokerAccountHero`** that becomes the top of Open Positions for broker accounts. It **reuses** existing pieces rather than rewriting them:

- `useBrokerEquityCurve(days)` — equity-curve points + range tabs (already built by the parallel session for `BrokerEquityCurve`).
- the account object (`brokerTotalEquity`, `brokerCash`, `brokerBuyingPower`) from `useJ2SelectedAccount` — net-liq, cash, buying power, margin.
- `portfolioAggregates(...)` output already computed in `OpenPositionsTab` — open P&L (unrealized) + invested %.

**Edit to the parallel session's hot file is one line:** swap `<BrokerEquityCurve />` → `<BrokerAccountHero ... />` in `OpenPositionsTab.jsx`. The existing `BrokerEquityCurve` component is left intact (the hero absorbs its SVG-curve logic; `BrokerEquityCurve` may later be removed once nothing references it, but this spec does not touch it). `BrokerSyncStatus` (sync-freshness line) and `BrokerReviewNudge` stay where they are.

*Alternative considered & rejected:* restyle `BrokerEquityCurve` in place — directly edits the parallel session's component and risks clobbering in-flight work. The new-component + one-line-swap path minimizes collision surface.

## Layout

```
┌────────────────────────────────────────────────────────────┐
│ ACCOUNT VALUE                                  [1M 3M 1Y All]│
│ $14,632.18                                                   │
│ ▲ +$842.10 (+6.1%) Today     ▲ +$2,431 (+19.9%) · 3M         │
│                                                              │
│ ╱╲     ╱╲                                                    │
│╱   ╲╱╲╱  ╲__╱╲__   ← large full-width equity curve           │
│                                                              │
│ Open P&L +$1,204 · Cash $2,580 · Buying Power $9,470 ·       │
│ Margin Used $12,053 · Invested 178%                          │
└────────────────────────────────────────────────────────────┘
   (existing Risk/Heat/Positions stats row renders below, unchanged)
```

- **Account Value** — `account.brokerTotalEquity`, dominant type.
- **Today** — `brokerTotalEquity − priorDaySnapshotEquity` ($ + %), color-coded green/red. The prior-day snapshot is the last equity-curve point before the latest. Hidden when < 2 snapshots. (Exact at end of day; slightly stale intraday until the next sync — accepted.)
- **Period** — change over the selected chart range ($ + %), reusing the curve's existing first→last computation; updates with the range tabs.
- **Secondary strip** — Open P&L (`aggregates.unrealized`, live), Cash (`brokerCash`), Buying Power (`brokerBuyingPower`), Margin Used (`brokerCash < 0 ? −brokerCash : 0`), Invested % (`aggregates.invested`).
- **Chart** — the equity curve, enlarged and full-width (the visual centerpiece), same SVG gradient/area treatment as today, up/down colored.

## Component interface

`<BrokerAccountHero account={account} aggregates={aggregates} />`
- `account` — the selected account object (net-liq/cash/buying-power fields).
- `aggregates` — the `portfolioAggregates` result already computed in `OpenPositionsTab` (passed in to avoid recomputing / re-fetching live prices).
- Internally calls `useBrokerEquityCurve(range.days)` for the curve + period change.
- Renders **null** when not a broker account or when `brokerTotalEquity == null` (so non-broker accounts and pre-sync state show nothing — `OpenPositionsTab` falls back to its normal stats row, which always renders).

## Error / empty states

- No snapshots yet (just connected) → hero still shows Account Value + secondary strip; Today + Period + chart hidden until ≥2 points (mirrors `BrokerEquityCurve`'s current inert behavior).
- `useBrokerEquityCurve` loading → chart area shows a subtle loading affordance; numbers render as soon as the account object is present.

## Responsive

Phone (`≤640px`): Account Value + Today stack vertically, range tabs wrap, chart stays full-width (shorter height), secondary strip wraps to 2 columns. Reuse the canonical breakpoints (no new literals).

## Testing

Vitest component test mocking `useBrokerEquityCurve` + passing a broker `account` and an `aggregates` object:
- Renders the big account value (`$14,632.18`).
- Renders Today's P&L with sign + color (positive → success class; negative → danger).
- Renders the period change tied to the default range.
- Renders the chart (mock the SVG path build is internal; assert the `<svg>`/region present).
- Renders Margin Used from negative `brokerCash`.
- Returns null for a non-broker account (`balanceSource !== 'broker'`).

## Coordination

`OpenPositionsTab.jsx` is co-edited by a parallel Claude session + the partner (GitHub web UI). Procedure: re-read immediately before the one-line edit, stage only the new component + its test + the single OpenPositionsTab line, FF-push `worktree-broker-sync:master`, `grep -c broker_sync api/main.py ≥ 7` before push (unchanged here, backend untouched), rebase cleanly over any partner commit.
