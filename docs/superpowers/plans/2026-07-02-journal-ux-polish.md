# Journal UX Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Skeleton loading, live micro-interactions, and phone card views for the journal, per spec `docs/superpowers/specs/2026-07-02-journal-ux-polish-design.md`.

**Architecture / Constraints:** Frontend-only; reuse `ChartSkeleton`'s shimmer + reduced-motion idiom; desktop tables untouched; worktree `.worktrees/rh-journal` branch `feat/rh-journal-p2`; tests `cd app && npx vitest run <path>`; ship = rebase → push master → chunk-verify.

### Task 1: `Skeleton` primitive
Create `app/src/components/Skeleton.jsx` + `.module.css` + test. Props `width/height/round/className`; gold-tinted shimmer 1.4s; reduced-motion static; `aria-hidden`. Commit `feat(ui): shared Skeleton shimmer primitive`.

### Task 2: Journal skeleton states
- `journal-2-0/components/HoldingsListSkeleton.jsx` (5 ghost rows, role="status") — used by `OpenPositionsTab` while `(isLoading||optionsLoading) && mergedPositions.length===0` (replaces the text) — list AND table view share it.
- `BrokerAccountHero`: skeleton block inside the card when no liveSummary AND no perf base AND no aggregates value yet.
- `PositionDetailPage`: header + chart-band skeleton while `!snapshot && !live` (cold first paint).
Tests: swap-in/swap-out per surface. Commit `feat(journal): skeleton loading states — hero, holdings, detail page`.

### Task 3: `useAnimatedNumber` + applications
`app/src/hooks/useAnimatedNumber.js` + test (fake timers/rAF): snap on first render, tween to new value, snap when reduced-motion, passthrough non-finite. Apply to BrokerAccountHero value + Today figure and detail-page header price. Commit `feat(journal): animated number roll on hero + detail price`.

### Task 4: Tick flash + press feedback
HoldingsList: per-row previous-price ref map → one-shot `flashUp/flashDown` class (600ms) on the pill; CSS keyframes + reduced-motion off; `.rowLink:active` press state. Detail header price color pulse. Tests: class appears on price change, direction correct, clears. Commit `feat(journal): price tick flash + row press feedback`.

### Task 5: Phone cards — PositionsTable
`useIsPhone()` branch renders card list (headline sym+side+current+P&L; meta shares@entry·stop·date; Edit/Close/Delete 44px buttons; option-row variant). Sorted rows reused. Tests with mocked `useIsPhone`. Commit `feat(journal): phone card view for Open Positions table`.

### Task 6: Phone cards — TradesTable
Card list (sym+side+P&L+R headline; entry→exit meta; read-only setup chip; 🧭 indicator). Tests likewise. Commit `feat(journal): phone card view for Trade Journal table`.

### Task 7: Verify + ship
Full journal suite + build; mobile audit `--viewport phone --routes /journal`; local screenshots (list skeleton via throttled load if feasible, phone cards); rebase → push master → verify prod chunk marker (e.g. `flashUp` / skeleton class in JournalTwoRoot chunk); memory update.
