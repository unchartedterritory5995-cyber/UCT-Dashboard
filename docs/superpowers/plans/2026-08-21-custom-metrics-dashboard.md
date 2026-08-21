# Custom Metrics Dashboard — plan (2026-08-21)

## Goal
"Full reign over customization": every popular trading metric as a composable
CARD, a user-arranged dashboard, and a safe custom-KPI formula layer — with
every number flowing through the ONE audited pipeline (books_audit closes on
all of it). Customization must never fork the truth.

## Architecture (one truth, many cards)
- **Backend registry** `api/services/journal_two/metrics_registry.py`:
  `METRICS = {key: MetricDef(title, description, category, compute)}`.
  Every compute reads rows fetched with the SAME predicate builders analytics
  uses (`filters.trades_where` + `ANALYTICS_INCLUDED_SQL` + the
  `COALESCE(trading_day_et, exit_date)` spine) — shared helpers, never a
  restated predicate.
- **One batched endpoint** `GET /api/j2/metrics?keys=a,b,c&<scope>` →
  `{key: payload}`; `GET /api/j2/metrics/registry` lists cards for the picker.
  Unknown keys are reported in `unknownKeys`, never silently dropped.
- **Custom KPI** = a formula over a whitelisted variable vocabulary, evaluated
  server-side by an AST-allowlist evaluator (numbers, + − × ÷, parens, unary;
  no names outside the vocabulary, no calls/attributes/subscripts). Division
  by zero → null, never an error page. `expr` length-capped.
- **FE composer** — "My Metrics" section at the top of Analytics: card picker
  from the registry, add/remove/reorder, persisted via
  `usePreferences('j2_custom_dashboard')`; ONE batched fetch for all selected
  cards, scoped by the existing ScopeBar. Custom KPIs defined inline
  (name + formula), stored in the same preference blob.

## Sample-size honesty (non-negotiable)
Every ratio gates on its own minimum (risk ratios n≥20 trading days; Kelly
n≥20 decisive trades) and returns null WITH counts below it — the CoverageLine
idiom. No metric ever fabricates a number from a thin sample.

## Metric cards (v1 registry)
1. `consistency` — % profitable days, daily P&L stdev, largest-day dependency
   (top-day and top-3-day share of gross profit), day win streaks.
2. `risk_ratios` — Sharpe / Sortino / Calmar on daily equity returns
   (rf = 0, ×√252 annualization; Calmar = annualized return ÷ |max DD %|).
3. `payoff_kelly` — avg win, avg loss, payoff ratio, win rate, Kelly %,
   half-Kelly (the practical number).
4. `time_intel` — P&L/win-rate by hour of day (`hour_et`, stored and unused
   until now) and by weekday; hold-time buckets vs avg effective R.
5. `risk_per_trade` — per-trade $ risk distribution; risk = stop distance ×
   shares when a real stop exists, else |pnl ÷ True R| (source-labeled like
   `rSources`; unknown risk counted, never guessed).
6. `period_compare` — this month vs last, this quarter vs last, YTD vs prior
   YTD (net P&L, win rate, trades, avg R) — computed on the full book by
   design (the date facet does not re-scope a comparison card; documented).
7. `custom` — user formulas over the vocabulary (see below).

## Custom-KPI vocabulary (v1)
net_pnl · gross_pnl · fees · trades · wins · losses · win_rate · avg_win ·
avg_loss · payoff · profit_factor · expectancy · days_traded ·
profitable_days · avg_true_r · max_drawdown

## Tasks
- [x] Plan doc (this file)
- [ ] T1 `metrics_registry.py`: shared fetch + 6 metric computes + vocabulary
      builder + AST-safe evaluator + registry dict
- [ ] T2 tests: every registered card computes on a seeded book with
      hand-worked expectations; sample gates return null-with-counts;
      evaluator rejects calls/attributes/unknown names; div-zero → null
- [ ] T3 router: `/api/j2/metrics` (+ registry route; custom exprs via
      repeated `kpi=` params `name:expr`)
- [ ] T4 FE: `components/metrics/` — MetricsDashboard (picker + reorder +
      persistence + one batched fetch), per-card renderers, custom-KPI editor
- [ ] T5 wire into AnalyticsTab (top section, defaultOpen), build, vitest
- [ ] T6 ship → deploy-verify → prod smoke on the owner's book → memory

## Explicitly deferred (recorded, not forgotten)
- Drag-grid dashboard (react-grid-layout) — v1 is an ordered card list.
- Formula functions (rolling(), by_setup()) — vocabulary-only v1.
- Per-card date overrides — the global Scope governs all cards in v1.
