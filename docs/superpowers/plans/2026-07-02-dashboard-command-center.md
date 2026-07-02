# Dashboard Command-Center Implementation Plan

Spec: docs/superpowers/specs/2026-07-02-dashboard-command-center-design.md (user-approved).
Worktree .worktrees/rh-journal branch feat/rh-journal-p2; tests `cd app && npx vitest run <path>`.

1. **quotes.js extraction** — move the QUOTES array + date-seeded pick from FuturesStrip.jsx
   to app/src/data/quotes.js (exports QUOTES, quoteOfTheDay(date?)); FuturesStrip imports it.
   Test: determinism + same seed math. Commit.
2. **MarketStatusBar** — new component + css per spec §1 (session pill w/ 30s ET clock,
   index chips from /api/snapshot, exposure chip from /api/breadth, quote line). Tests:
   4 session states, chips render from mock data, empty-feed safe, quote line present. Commit.
3. **Dashboard re-grid** — Dashboard.jsx desktop block reordered per spec §2; Dashboard.module.css
   new grid (rowB 7fr/5fr + rail, rowC 4-col, rowD 2-col, hero gold edge, hover lift,
   breakpoints 1440/1100). Update Dashboard.test.jsx expectations. Commit.
4. **Verify + ship** — full dashboard-related vitest + build; local screenshot desktop
   1600px + 1280px + phone regression (mobile stack unchanged); rebase → push master →
   chunk-verify (`MARKET OPEN` marker in index or Dashboard chunk); memory update.
