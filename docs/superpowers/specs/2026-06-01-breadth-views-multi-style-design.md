# Breadth Views — Multi-Style, Customizable Visualizations

**Date:** 2026-06-01
**Status:** Approved (design)
**Author:** Patrick + Claude

## Summary

Turn the Breadth **Heatmap** tab from a single ECharts treemap into a **multi-style
visualization surface**. Users pick one of four visualization styles and choose which
breadth metrics appear in it. Style choice + visible-metric set persist per named
preset, building directly on the existing `useBreadthCustomize` infrastructure.

The tab is relabeled **"Views."** The Monitor tab (the canonical 40+ metric data
table) is unchanged.

## Goals

- Let users choose *how* they see breadth, not just *what* metrics show.
- Fix the two complaints about the current treemap: it's monotone in a one-directional
  tape, and it has weak visual hierarchy.
- Reuse the existing preset/show-hide system rather than inventing a parallel one.
- Build view components as standalone, composable pieces so a future drag-to-compose
  canvas (cf. Charts Hub V2) can reuse them with no rewrite.

## Non-Goals

- A composable multi-widget canvas (Phase 2 — explicitly deferred; architecture leaves
  room for it).
- Changing the Monitor tab, COT Data, Data Charts, or Analogues tabs.
- The Dashboard `MarketBreadth` tile (easy follow-up later; not in this spec).
- Backend/API changes. All four views render from the existing
  `GET /api/breadth-monitor?days=N` payload.

## The Four Styles

All four read the **same** metric registry and the **same** visible-metric set. Switching
style never changes which metrics are shown — only their rendering.

1. **Treemap** (default) — the current `BreadthHeatmap`, moved into a `TreemapView`
   component essentially unchanged. Default so nothing is lost for existing users.
2. **Vitals Rings** — Apple-Watch-style ring gauges. The first metric in the set renders
   as a large hero ring; the rest orbit as smaller rings. Ring fill + color = strength.
3. **Bull/Bear Tug** — diverging tug-of-war. Paired metrics (up vs down) render as
   opposing bars around a center spine; bar length = magnitude. A "net posture" summary
   line aggregates the board. Unpaired metrics render as a single signed bar from center.
4. **Tactical Meters** — horizontal sliders on a shared oversold→overbought scale with
   30/70 reference ticks. Marker position = where the metric sits on its recent range.

## Shared Foundations

### Metric registry extension

`HM_METRICS` (in `Breadth.jsx`) today carries `{ key, label, getTier, getFmt, drillKey }`.
Three fields are added to each non-header entry so the non-treemap views can position and
color values:

- **`getValue(row)`** → raw `number | null`. The underlying numeric (already implicit in
  most `getFmt`/`getTier` bodies; factor it out).
- **`polarity`** → `'bull' | 'bear' | 'neutral'`. Whether *high* is bullish. Drives slider
  marker color and tug-of-war side. E.g. `new_52w_lows` and `vix` are `'bear'`;
  `cnn_fear_greed` is `'bear'` (high = greed = caution); most are `'bull'`.
- **`pair`** → optional `{ partnerKey, side: 'up' | 'down' }`. Links paired metrics for the
  tug view (`up_4pct_today ↔ down_4pct_today`, `new_52w_highs ↔ new_52w_lows`,
  `stage2_count ↔ stage4_count`, etc.). Metrics without a `pair` render as single signed
  bars in the tug view.

`getTier`/`getFmt`/`drillKey` are untouched, so the treemap is unaffected.

### Universal 0–100 normalizer

Rings and sliders need every metric on a common 0–100 scale. Resolution order per metric:

1. **Native percentage** (key matches `pct_above_*` or value is already 0–100, e.g.
   `cnn_fear_greed`) → use the raw value.
2. **Percentile rank** over the loaded window — reuse the existing `pctileByKey`
   computation (already built for treemap tooltips; `PCTILE_KEYS` set). This answers "where
   does today sit vs its own recent range," which is exactly what a gauge should show for
   counts like `new_52w_highs` or `magna_up`.
3. **Fallback** → metric is shown with its formatted value but a neutral/empty gauge fill
   (no crash, no fake position).

Tier color for rings/sliders comes from the existing `getTier` → `TIER_*` color maps, so
all four views stay color-consistent.

### Drill-through

Clicking any ring / bar / slider whose metric has a `drillKey` opens the existing
`DrillModal` via the current `onDrill(date, metric)` path. Identical behavior to treemap
tile clicks.

### Date navigation

The existing ←/→ + arrow-key date navigation and the "LATEST" button (currently inside
`BreadthHeatmap`) are lifted into the Views container so all four styles share one date
cursor and the forward-fill logic (`FFILL_KEYS`).

## Customization & Persistence

Extend the existing pattern rather than replace it.

- **New hook `useBreadthViews`** (sibling to `useBreadthCustomize`, same shape/idioms),
  storage key **`uct.breadth.views.v1`**. A separate key from the Monitor sheet because the
  Views metric universe is the curated heatmap set, not the 40+ column sheet.
- **Preset shape:** `{ viewStyle: 'treemap'|'rings'|'tug'|'meters', hidden: string[] }`.
  Reuses the "store hidden, not visible" semantic so new metrics added in code auto-appear
  in every saved preset (same rationale as today).
- `Default` preset is hard-coded: `{ viewStyle: 'treemap', hidden: [] }`.
- **Style switcher** (`BreadthViewSwitcher.jsx`): a row of four style buttons + the existing
  ⚙ Customize trigger. Picking a style on the `Default` preset switches the live style; to
  *persist* a non-default style + metric set the user saves a named preset (mirrors how the
  Monitor sheet requires "Save As…" before edits stick — `toggleHidden` is a no-op on
  `Default`).
- The existing **`CustomizePanel`** is reused as-is for the show/hide + preset CRUD UI; it's
  wired to `useBreadthViews` instead of `useBreadthCustomize` when the Views tab is active.
  The Customize trigger (today gated to `activeTab === 'breadth'`) is extended to also show
  on the Views tab.

## Component Architecture

```
Breadth.jsx
  └─ (activeTab === 'heatmap' / "Views")
       BreadthViews.jsx                 ← new container: owns date cursor, style state,
       │                                   useBreadthViews, drill wiring, forward-fill
       ├─ BreadthViewSwitcher.jsx       ← style buttons + ⚙ Customize trigger
       ├─ CustomizePanel.jsx            ← existing, reused (wired to useBreadthViews)
       └─ views/
            ├─ TreemapView.jsx          ← current BreadthHeatmap body, lightly refactored
            ├─ RingsView.jsx            ← new
            ├─ TugView.jsx              ← new
            └─ MetersView.jsx           ← new
```

Each `views/*` component takes a uniform prop contract:
`{ currentRow, prevRow, metrics, normalize, onDrill }` — where `metrics` is the already-
filtered, ordered list of visible metric entries and `normalize(metric, row) → 0..100 | null`.
This uniform contract is what makes them composable later.

Shared helpers (`TIER_*` maps, `pctColor`, `pairedUpColor`, `pairedDnColor`, normalizer)
move into a small `views/breadthViewShared.js` so they aren't duplicated.

## Files

**New**
- `app/src/pages/breadth/BreadthViews.jsx`
- `app/src/pages/breadth/BreadthViewSwitcher.jsx` + `.module.css`
- `app/src/pages/breadth/views/{TreemapView,RingsView,TugView,MetersView}.jsx`
- `app/src/pages/breadth/views/breadthViewShared.js`
- `app/src/pages/breadth/useBreadthViews.js` + `useBreadthViews.test.js`

**Modified**
- `app/src/pages/Breadth.jsx` — extend `HM_METRICS` entries (`getValue`/`polarity`/`pair`);
  replace the inline `BreadthHeatmap` render with `<BreadthViews>`; extend the Customize
  trigger gating to the Views tab; relabel the tab "Views".
- `app/src/pages/breadth/CustomizePanel.jsx` — accept a `metrics`/`cols` source generic
  enough for both sheets (minor).

## Testing

- `useBreadthViews.test.js` — preset CRUD + `viewStyle` persistence + Default immutability
  + storage-key isolation from `useBreadthCustomize` (mirror the existing
  `useBreadthCustomize.test.js` cases).
- Per-view unit tests for the normalizer: native-percentage path, percentile-rank path,
  null/fallback path, and polarity-driven coloring (especially `vix`, `new_52w_lows`,
  `cnn_fear_greed` color *bearish* when high).
- Tug pairing test: paired metrics oppose correctly; unpaired render single signed bars.
- Drill-through: clicking a ring/bar/slider with a `drillKey` calls `onDrill`.

## Phasing

- **Phase 1 (this spec):** style switcher + four views + per-style customize, on the Views
  tab.
- **Phase 2 (future, out of scope):** drag-to-compose canvas reusing `views/*`; possibly a
  "Signal of the Day" / auto-"notable" callout; Dashboard tile style option.

## Open Questions / Defaults Chosen

- **Default style = Treemap** (zero regression for current users).
- **Ring hero = first visible metric** in registry order (Health by default). Could later be
  user-pinnable; not in scope.
- **Tug "net posture"** = signed sum of normalized paired deltas, expressed as
  `+NN% BULLISH / BEARISH`. Exact weighting can be tuned during implementation.
