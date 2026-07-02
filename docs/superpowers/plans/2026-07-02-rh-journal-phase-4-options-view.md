# Robinhood Journal — Phase 4: Options View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the holdings list's minimal Options section into RH-style contract cards (label · qty · expiry/DTE · mark · total return) plus a net-options-performance mini chart. Broker mark only — no greeks/quotes (spec-locked).

**Architecture:** Pure models in `lib/optionsBoard.js`; an `OptionsBoard` component that replaces `HoldingsList`'s inline Options section (self-fetches closed strategies for the performance curve via `useJ2OptionStrategies({status:'closed'})`); reuses `Sparkline` + `buildStrategyLabel` + `computeDaysToExpiration`.

## Global Constraints
Same as Phases 2–3 (spec `2026-07-01-robinhood-journal-design.md` Phase 4). RH fact: the options section charts **net options performance**, not market value. We have no per-option mark history, so the performance curve = **cumulative realized options P&L over closed strategies (by `closedAt`) with the current open unrealized P&L appended as the live last point** — the closest honest reconstruction from J2 data (documented adaptation). Options "Today" is omitted (no live option quotes — spec: options contribute ~0 to Today).

### Task 1: Pure models — `lib/optionsBoard.js`
- `buildOptionCards(strategies)` → `[{key, label, contracts, expiration, dte, mark, totalReturnDollar, totalReturnPct}]` (mark = |brokerCurrentValue|, return = brokerCurrentValue − netEntry; nulls when mark absent; sorted soonest-expiry first).
- `netOptionsPerformance(closedStrategies, openCards)` → number[] cumulative P&L (closed sorted by closedAt asc, skip null pnlDollar; append Σ open totalReturnDollar as last point; `null` when < 2 points).
TDD + commit `feat(journal): options board models — Phase 4`.

### Task 2: `components/OptionsBoard.jsx` + swap into HoldingsList
Section header "Options" + Sparkline (values from netOptionsPerformance, labeled "Net options P&L") + card grid (2-col desktop / 1-col ≤640). Card: label bold · "N contracts · Oct 16 · 45d" meta · right column mark + colored total return $ (%). HoldingsList drops its inline optionRows/OptionRow and renders `<OptionsBoard strategies={optionStrategies} />`; its Options tests move/update to OptionsBoard tests. Commit `feat(journal): RH options view — contract cards + net performance — Phase 4`.

### Task 3: Verify + ship
Journal suite + build; rebase; push master; prod chunk marker (`Net options P&L`); memory update.
