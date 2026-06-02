# Breadth Views — Per-View Customization & Presets

**Date:** 2026-06-01
**Status:** Design — awaiting user sign-off
**Supersedes parts of:** `2026-06-01-breadth-views-multi-style-design.md` (the customization/preset model only; the 8 view styles themselves are unchanged)

## Problem

The Breadth → Views tab has 8 visualization styles (Treemap, Rings, Tug, Meters,
Timeline, Radar, Scoreboard, Levels). Today a "preset" stores
`{ viewStyle, hidden[] }` where the `hidden` metric set is **global** — the same
metrics are hidden no matter which style is active. Consequences:

- You cannot make Radar show a different metric set than Scoreboard.
- Each style has no controls of its own (Radar's spoke cap is hardcoded at 14;
  Scoreboard/Levels can't be sorted; Timeline's window is fixed).
- Switching a preset re-skins everything at once; there's no "this is how I want
  *Radar* to look" independent of the other views.

## Goal

Make **each view independently customizable**, with **per-view named presets**,
**smart per-view defaults**, and a **clean, view-scoped customization surface** so
the controls on screen always match the view you're looking at.

User decisions captured during brainstorming:
- **Per-view presets** (each style has its own named presets), not one global
  workspace preset.
- **Smart per-view defaults** (each style ships a hand-tuned default metric set),
  not "all metrics everywhere."
- **Full options layer now** (view-specific knobs ship in this build, not deferred).
- **Quick preset switcher on the bar** in addition to the Customize panel.

## Non-goals (v1)

- No per-view color theming / font / label editing (full theming is out of scope).
- No server-side sync of presets — stays `localStorage`, like today.
- No changes to the Monitor sheet customization (`useBreadthCustomize` /
  `uct.breadth.customize.v1`) — it keeps its hidden-set model.
- No changes to the 8 view renderers' core visual identity (only new optional knobs).

---

## Architecture

### 1. Per-view metric registry (`views/viewMetricConfig.js` — new)

A single source of truth describing, for each style:

```js
// keyed by style id ('radar', 'scoreboard', …)
{
  radar: {
    label: 'Radar',
    eligibleKeys: (allMetrics) => allMetrics,         // which metrics this view can render
    defaultVisible: ['breadth_score', 'uct_exposure', …],  // curated smart default
    options: RADAR_OPTIONS,                           // schema (see §3)
  },
  tug: {
    label: 'Tug',
    eligibleKeys: (allMetrics) => allMetrics.filter(m => isPairMetric(m.key)),
    defaultVisible: PAIR_KEYS,
    options: {},                                      // none
  },
  …
}
```

- **`eligibleKeys`** lets the Customize panel show *only* metrics a view can use.
  Tug only offers paired metrics; Radar/Scoreboard/Levels offer the full board.
  This is the core "clean, organized, user-friendly" property — no dead toggles.
- **`defaultVisible`** is the curated default set (the "Default" preset for that
  view). Defined in code, not stored.

**Smart default sets (initial):**

| View | Default visible | Rationale |
|------|-----------------|-----------|
| Treemap | full board | built to hold many tiles |
| Scoreboard | full board | cards scroll |
| Levels (equalizer) | ~16 | columns scroll horizontally |
| Radar | ~12 most-defining | gets illegible past ~14 spokes |
| Rings | ~8 headline gauges | rings need breathing room |
| Meters | ~8 headline gauges | gauges need space |
| Timeline | ~10 focused | time grid stays readable |
| Tug | the 7 bull/bear pairs | only pairs render |

(Exact key lists finalized in implementation; headline gauges =
breadth_score, uct_exposure, pct_above_50sma, pct_above_200sma, up_4pct_today,
down_4pct_today, new_52w_highs, new_52w_lows, mcclellan_osc, vix.)

### 2. Storage model (`useBreadthViews` → `uct.breadth.views.v2`)

```jsonc
{
  "viewStyle": "radar",            // which view is currently showing
  "byView": {
    "radar": {
      "activePreset": "Wide",
      "presets": {
        "Wide":   { "visible": ["…"], "options": { "maxSpokes": 14 } },
        "Tight":  { "visible": ["…"], "options": { "maxSpokes": 8 } }
      }
    },
    "scoreboard": { "activePreset": "Default", "presets": {} },
    …
  }
}
```

- **Explicit `visible` arrays** per preset (not `hidden`). Rationale: curated
  views shouldn't get a surprise new spoke injected when a metric is added to the
  board later — the user picked exactly what they want. Tradeoff vs the Monitor
  sheet's hidden-model is intentional and documented here.
- **"Default"** is implicit per view (not stored). When `activePreset === 'Default'`,
  the resolved visible set = the view's `defaultVisible`; options = schema defaults.
- Each view independently tracks its own `activePreset`. Switching the view loads
  that view's active preset automatically.

**Hook API (per-view–aware):**

```
viewStyle, setViewStyle(style)

// all scoped to the ACTIVE view:
activePreset, presetNames, isDefaultActive
visibleKeys: Set            // resolved (Default → defaultVisible, else preset.visible)
options: {}                 // resolved (schema defaults merged under preset.options)
eligibleMetrics(allMetrics) // filtered list for the panel
toggleVisible(key)          // Default → prompt Save-as first (same pattern as today)
setOption(name, value)      // Default → prompt Save-as first
savePreset(name)            // captures current resolved visible + options
renamePreset(old, new)
deletePreset(name)
switchPreset(name)
resetActive()               // visible → view default, options → schema defaults
```

The Default-is-immutable + "edit prompts Save-as" UX is preserved from the current
panel (`savePromptFromDefault` mode), now applying to both metric toggles and option
changes.

### 3. View-specific options schema (§ "full set now")

Each view declares an `options` schema: an ordered list of
`{ name, label, type: 'select'|'toggle', choices?, default }`. The panel renders
them generically in a "View options" section; views read resolved `options` from props.

| View | Option | Choices | Default |
|------|--------|---------|---------|
| Radar | Max spokes | 8 / 10 / 12 / 14 | 14 |
| Radar | Spoke pick | Auto (most-defining) / As listed | Auto |
| Scoreboard | Sort | Group order / Value high→low / Bullishness | Group |
| Scoreboard | Density | Comfortable / Compact | Comfortable |
| Scoreboard | Sparkline window | 10 / 20 / 30 days | 20 |
| Levels | Sort | Board order / Value / Tier | Board |
| Meters | Sort | Group order / Value | Group |
| Timeline | Window | 10 / 20 / 30 days | 20 |
| Treemap | — | — | — |
| Rings | — | — | — |
| Tug | — | — | — |

Renderer changes to consume options:
- **RadarView**: read `options.maxSpokes` (replaces hardcoded `MAX_SPOKES = 14`)
  and `options.spokeSelect` (Auto keeps current most-defining cap; As-listed takes
  the first N in metric order). Signal/notable retention logic unchanged.
- **ScoreboardView**: apply `options.sort`, `options.density` (smaller card
  padding/min-width), `options.sparkWindow` (slice `recentRows`).
- **EqualizerView (Levels)** / **MetersView**: apply `options.sort`.
- **TimelineView**: apply `options.windowDays` to its recent-rows slice.

`BreadthViews.jsx` computes `recentRows` long enough (max window = 30) and passes
the resolved `options` object into every view via `common`.

### 4. UX surface

**Top bar (in `BreadthViews.jsx`):**
```
[ View switcher: Treemap Rings Tug Meters Timeline Radar Scoreboard Levels ]
[ ← 2026-06-01 →  LATEST ]                         [ Preset ▾ ]  [ ⚙ Customize ]
```
- **Quick preset switcher** (`Preset ▾`): a compact dropdown bound to the active
  view's `presetNames` → `switchPreset`. Flips presets without opening Customize.
  Shows the active preset; "Default" when on default.
- **Customize button** label includes the active preset: `⚙ Radar · Wide`.

**Customize panel (view-scoped):**
- Reuses the existing anchored-dropdown panel pattern (`CustomizePanel.module.css`),
  generalized into a Views-specific panel (`BreadthViewsCustomizePanel.jsx`) so the
  Monitor's `CustomizePanel.jsx` is untouched.
- Header: `Customize {ViewLabel}` (e.g. "Customize Radar").
- **Preset row**: dropdown (this view's presets) + Save as… / Rename / Delete
  (Default disabled for rename/delete) — identical flow to today.
- **View options** section (only if the view declares options): the generic
  option controls from §3.
- **Metrics** section: checkboxes for `eligibleMetrics`, grouped by `m.group`
  exactly like today. Editing on Default → Save-as prompt.
- Footer: "N of M visible" + "Reset to defaults" (→ view default set + default options).
- Switching the view (via the switcher) while the panel is open re-scopes it to the
  new view automatically.

### 5. Migration (`v1` → `v2`)

On first load with a `v1` blob present and no `v2`:
- Keep `viewStyle` from v1 as the active style.
- For each v1 custom preset `{ viewStyle: vs, hidden }`, convert into a `v2`
  per-view preset under `byView[vs].presets[name]` with
  `visible = (ALL_METRICS keys − hidden) ∩ eligibleKeys(vs)` and empty `options`.
  Set `byView[vs].activePreset = name` for the last one (best-effort; collisions
  resolved by last-wins).
- All other views initialize to `{ activePreset: 'Default', presets: {} }`.
- Wrapped in try/catch; any failure falls back to a clean empty v2 state. v1 key is
  left in place (not deleted) as a backstop.

---

## Components & files

**New**
- `app/src/pages/breadth/views/viewMetricConfig.js` — per-view registry (label,
  eligibleKeys, defaultVisible, options schema) + `isPairMetric` helper + option
  schema constants.
- `app/src/pages/breadth/BreadthViewsCustomizePanel.jsx` — view-scoped panel
  (preset row + View options + metrics), built from the existing panel's markup.
- `app/src/pages/breadth/QuickPresetSwitcher.jsx` — compact bar dropdown.

**Changed**
- `app/src/pages/breadth/useBreadthViews.js` — v2 model + per-view API + migration.
- `app/src/pages/breadth/BreadthViews.jsx` — wire quick switcher, view-scoped panel,
  resolved-options pass-through, 30-bar `recentRows`.
- `app/src/pages/breadth/views/RadarView.jsx` — consume `options.maxSpokes` /
  `spokeSelect`.
- `app/src/pages/breadth/views/ScoreboardView.jsx` — consume sort/density/sparkWindow.
- `app/src/pages/breadth/views/EqualizerView.jsx` — consume sort.
- `app/src/pages/breadth/views/MetersView.jsx` — consume sort.
- `app/src/pages/breadth/views/TimelineView.jsx` — consume windowDays.

**Untouched** — `CustomizePanel.jsx`, `useBreadthCustomize.js` (Monitor sheet),
TreemapView, RingsView, TugView.

## Testing

- `useBreadthViews.test.js` — extend: per-view isolation (customizing Radar doesn't
  touch Scoreboard), Default-is-immutable, save/rename/delete/switch scoped to active
  view, options resolve with schema defaults, `setOption` on Default prompts save,
  v1→v2 migration (preset lands under correct view, eligible intersection applied),
  corrupt-blob → empty v2.
- New `viewMetricConfig.test.js` — every style has a config; every `defaultVisible`
  key exists in the board and passes that view's `eligibleKeys`; Tug default ⊆ pairs.
- Renderer tests (extend existing view tests where present): Radar respects
  `maxSpokes`; Scoreboard sort/density/window; Levels & Meters sort; Timeline window.
- Keep the existing 98 breadth tests green.

## Rollout

Single build, behind no flag (additive UI; storage migrates on load). Follows the
project's ship-then-polish posture: ship the full per-view model + options together,
verify in browser, then polish.

## Open questions / deferred

- Per-view **color/intensity theming** — deferred (non-goal v1).
- **Cross-device sync** of presets via `usePreferences` — deferred; localStorage v1.
- **Treemap weighting** option (equal vs extremity) — deferred; metric selection
  covers the common case.
