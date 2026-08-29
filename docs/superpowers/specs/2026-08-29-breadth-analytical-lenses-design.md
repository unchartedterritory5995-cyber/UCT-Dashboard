# Breadth Views — 8 → 16, adding analytical lenses

**Date:** 2026-08-29
**Branch:** `feat/breadth-lenses`
**Worktree:** `C:\Users\Patrick\uct-worktrees\breadth-lenses`

## Problem

The Breadth Views tab ships 8 styles — Treemap, Rings, Tug, Meters, Timeline, Radar,
Scoreboard, Levels. All 8 render the same shape of data: **today's row, normalized to
0-100, drawn as circles / bars / tiles / spokes**. Only Timeline and Scoreboard's
sparklines touch history at all. The variety is cosmetic, not analytical: switching
styles changes the geometry, never the question being answered.

Meanwhile the data on the wire supports far more than the tab exposes. `get_history`
returns the whole stored `metrics` JSON blob per row, so every row already carries
`rsp_spy_ratio`, `iwm_qqq_ratio`, `up_vol_ratio`, `adv_decline_cum`, `hi_ratio`,
`lo_ratio`, `vxn`, `near_52w_high` and `universe_count` — none of which appear as a
view metric. `GET /api/breadth-monitor/analogues` (500-day lookback, weighted 16-metric
similarity, forward SPY returns at 5/10/20/60d) exists, works, and **nothing on this tab
consumes it**.

## Goal

Add 8 **analytical lenses** — views that answer questions the current 8 cannot — taking
the switcher to 16. Not 8 more ways to draw one row.

Owner ruling (2026-08-29): "new analytical lenses", lens selection delegated, switcher
presented as two labeled groups, window decision delegated.

## The eight

| Lens | Kind | Question it answers |
|---|---|---|
| Regime Clock | lens | Where in the cycle are we, and which way are we moving? |
| Divergence Lens | lens | Is price outrunning the troops? |
| Heat Ribbon | board | When did the regime change? |
| Percentile Ladder | board | Is this reading high or low *for this metric*? |
| Event Ledger | lens | Did anything with a **name** happen? |
| Rotation Lens | lens | Is leadership broadening or narrowing? |
| Analogue Deck | lens | What happened *after* days that looked like this? |
| Score Attribution | lens | What is holding the score up? |

Considered and dropped: Streak Board and Record Book (largely subsumed by the Percentile
Ladder), Constellation (says nothing until configured — the weakest default state of the
set), Session Path (duplicates the Daily tab's hero).

## Architecture

### Two kinds, one registry

Today every view receives one bundle:

```
{ currentRow, prevRow, recentRows(30), metrics, normalize, onDrill, signalKey, notableKey, options }
```

That contract can only express "draw the metrics", which is exactly why the 8 look alike.
Six of the eight new lenses are not metric lists — a Regime Clock has no metric checklist,
an Analogue Deck has no metrics at all. Forcing them into the board contract would
reproduce the sameness this work exists to escape, and the Customize panel would render a
metric checklist that changes nothing on screen.

`VIEW_CONFIG` grows a `kind` field:

- **`kind: 'board'`** — the existing contract, unchanged. The current 8 plus Heat Ribbon
  and Percentile Ladder. Customize shows the metric checklist + options.
- **`kind: 'lens'`** — receives `{ rows, currentRow, rowIdx, prevRow, onDrill, options }`,
  where `rows` is the **forward-filled** window (`filledRows`, newest-first) that boards
  already normalize against — not the raw prop — so the two kinds can never disagree about
  what a session's value was. `eligibleKeys` returns `[]` and the
  Customize panel shows options only, no checklist.

`BreadthViews` passes the bundle its `kind` calls for. Board views are not edited.

Rejected alternatives: a separate lens sub-tab (splits the preset model and the date
cursor across two surfaces for no gain); forcing every lens into the metric-list contract
(that is the disease, not the cure).

### Two second-authority defects fixed on the way in

`BreadthViewSwitcher.jsx` hardcodes its own array of 8 styles **with its own labels**,
while `viewMetricConfig.js` separately holds `STYLES` and `VIEW_CONFIG[].label`.
`BreadthViews.jsx` then hardcodes an 8-line `&&` dispatch chain. That is three lists to
keep in sync; at 16 entries it is a live drift hazard and this repo's most-repeated defect
shape (see `lesson_a_second_authority_over_one_value`).

- The switcher **derives** its buttons from `VIEW_CONFIG` — label, order and grouping all
  come from the registry. It stops owning a list.
- Dispatch becomes a `style → component` map exported from the views registry, replacing
  the `&&` chain.
- A registry-driven rail asserts **every** `STYLES` entry resolves to a component that
  renders with a minimal props bundle for its `kind`. The existing `themingTierViews` and
  `themingAccentViews` tests name views one at a time and would silently skip all 8 new
  ones — this rail is what makes the registry the authority in practice, not just on paper.

### Switcher presentation

One row, two labeled groups with a divider: **BOARDS** then **LENSES**. Grouping is read
from `VIEW_CONFIG[].kind`, so a new view lands in the right group by declaring its kind —
there is no second list of group members.

Note this is **not** an "old 8 / new 8" split, and must not be described as one: Heat
Ribbon and Percentile Ladder are metric boards, so kind-based grouping puts them with the
boards. The shipped switcher reads **10 BOARDS · 6 LENSES**. Grouping by age instead of by
kind would re-introduce exactly the hand-maintained second list this section exists to
remove.

### Window

`Breadth.jsx:1005` gates the day pills behind `activeTab !== 'heatmap'`, so **the Views tab
has no window control and is permanently pinned to `days = 90`** — and the pills only
offer 30/60/90 anyway. Lenses live or die on window depth: an Event Ledger reading 90
sessions can only ever say "has not fired in 90 sessions", never "last fired in March".

Decision: show the pills on the Views tab and extend the Views-tab set to **90 / 180 / 365**,
default staying **90** so nothing changes for anyone who does not ask. `GET /api/breadth-monitor`
already bounds `days` at `ge=1, le=3650`, and `get_history` caches 5 minutes per `days`
value, so a deeper window needs no backend change. Cost is payload — roughly 1KB/row, so
365 sessions ≈ 365KB, paid only on request.

**Every lens states the basis it actually read** ("since 2026-04-02", "no occurrence in
the last 90 sessions") and never implies more history than it has. A lens that needs more
rows than the window holds says so and renders nothing rather than guessing — see
`lesson_a_fixture_that_cannot_distinguish_is_not_a_rail`.

### The one backend change

Score Attribution needs the **points each component actually contributed**, and
`_compute_breadth_score` renormalizes over the inputs that are present — so
`_SCORE_WEIGHTS` alone does not reproduce them. Serving the weights and re-implementing
`_lerp` and its bands client-side would be a textbook second authority over the score.

Instead the scoring function itself emits the breakdown. `_compute_breadth_score` is
refactored so a single pass produces both the total and a per-component list
(`{ key, label, weight, points, max_points, present }`), and the total continues to come
from that same pass — there is no path where the score and its attribution can disagree.

```
GET /api/breadth-monitor/score-components/{date}   (require_paid)
  → { date, total, min_weight_met, components: [...],
      prev: { date, total, components: [...] } | null }
```

The prior session ships in the same response so the waterfall's delta needs one request.
Cached alongside the existing history cache. An unrecorded date answers `ok: false`, not
an error — same shape as `session-path`.

Everything else is pure client work over rows already on the wire.

## The Event Ledger's honesty rule

An event fires when **the metric's own existing `getTier` function** says extreme, or when
a **published formula** says so. No fresh magic numbers. Where neither exists, the
threshold is percentile-of-window and is labeled as such on screen.

| Event | Source of truth |
|---|---|
| Follow-Through Day | `row.is_ftd` — already collected |
| Zweig Breadth Thrust | Published: 10-day EMA of `advancing/(advancing+declining)` rising from < 0.40 to > 0.615 within 10 sessions |
| 90% up / down volume day | `up_vol_ratio` is **up volume ÷ DOWN volume**, not ÷ total. Share = `r/(1+r)`, so a 90% up day is `r ≥ 9.0` and a 90% down day is `r ≤ 1/9`. The collector returns `None` when down volume is zero |
| McClellan extreme | `mcclellan_osc` via its existing `getTier` bands |
| HVC surge / ATR froth | `hvc_52w` / `atr_ext_7` via their existing `getTier` g3 bands |
| Washout / thrust in highs-lows | Percentile-of-window, labeled "top 5% of the last N sessions" |

⚠️ The `up_vol_ratio` conversion above is the specific defect this rule caught in design:
read as a share, `≥ 0.9` would have fired on ordinary sessions and a real 90% up day would
never have registered.

⚠️ Zweig requires `advancing` and `declining` populated across the whole 10-session
window. The lens checks coverage and **refuses** the event with a stated reason when the
window is short — it does not interpolate.

## Testing

- **Registry rail** — every `STYLES` entry resolves to a component; each renders for its
  `kind`'s minimal props; every view honoring `options.palette` produces the palette's
  color. This is the rail the current per-view theming tests cannot provide.
- **Per lens** — one test per lens over a fixture that **discriminates**: it must fail if
  the lens is wired to the wrong field or the wrong direction. Specifically, the Event
  Ledger's 90%-volume test carries one row at `r = 9.5` (fires) and one at `r = 0.95`
  (does not) — a fixture that cannot tell those apart proves nothing.
- **Score attribution** — a backend test asserting the components' points sum to the total
  the same call returns, including a row with a missing input so renormalization is
  exercised rather than assumed.
- **Window** — a test that the Views tab renders the pills and that a lens reading fewer
  rows than it needs renders its stated refusal, not a chart.

## Shipping

Three independently shippable waves:

- **W1 — foundation + 3:** `kind` contract, registry de-duplication (switcher + dispatch +
  rail), Views-tab window control, then Regime Clock, Heat Ribbon, Percentile Ladder.
  All client-side, no backend.
- **W2 — 3:** Divergence Lens, Rotation Lens, Event Ledger.
- **W3 — 2 + backend:** Analogue Deck (wires the existing endpoint) and Score Attribution
  (the `score-components` endpoint).

## Verification

Per `MEMORY.md`: a green suite is not the standard on this page. Both day-one defects in
the 8/26 Breadth reshape were caught by screenshotting the deployed page while ~5,700
tests stayed green. **Each wave is verified by opening the deployed artifact and counting
pixels** — every new view rendered at least once against real data, not fixtures.

## Open items carried into implementation

1. `advancing` / `declining` coverage over a 90-session window has not been measured;
   Zweig's refusal path may be the common case. Measure before claiming the event works.
2. The 365-session payload figure (~365KB) is estimated from field count, not measured.
   Measure it once the pill exists; if it is materially worse, drop 365 and keep 180.
