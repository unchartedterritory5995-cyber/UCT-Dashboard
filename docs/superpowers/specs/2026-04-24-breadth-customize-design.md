# Breadth Sheet Customization — Design

**Status:** Approved 2026-04-24
**Scope:** Monitor tab on the Breadth page only
**Persistence:** localStorage (single-user dashboard, no cross-device sync needed)

## Problem

The Breadth Monitor table renders a fixed list of ~35 metrics across six groups
(Score, Primary, MA, Regime, Highs/Lows, Sentiment). Users have no way to hide
metrics they don't care about or to save view layouts for different focus modes
(e.g., "MA only", "Sentiment focus"). Existing column-collapse-on-click behavior
is transient session state — it doesn't persist across reloads.

## Goal

A "⚙ Customize" panel on the Breadth page where the user checks metrics in/out
of the Monitor sheet and saves named presets. The page should look identical to
today when no customization is applied; the only addition is one button in the
header.

## Out of scope

- Cross-device sync (localStorage only — easily migrated to a backend later if needed)
- Customizing the Heatmap, COT, Data Charts, or Analogues tabs
- Group-level master toggles (individual checkboxes only)
- Reordering columns (separate feature)
- Tier/threshold customization (the color-grading rules stay as-is)

## UX

### Trigger

A `⚙ Customize` button in the Breadth header, placed immediately before the
existing `↓ CSV` button. Visible only when `activeTab === 'breadth'` (Monitor).

### Panel

Dropdown anchored to the button's bottom-right corner. ~340px wide, max-height
capped at viewport-minus-header, scrollable body. Visual style matches the
existing modal aesthetic (dark surface `#1a1a1a`-ish, gold accents `#d4a04a`-ish,
sectioned with subtle dividers — see `PortfolioSettingsModal.module.css` for the
reference palette).

**Layout, top to bottom:**

1. **Header bar** — title "Customize Breadth Sheet" + close ✕.
2. **Preset row** — left: dropdown listing `Default` (always first) plus custom
   presets (alphabetical). Right: three small buttons — `Save as…`, `Rename`,
   `Delete`. `Rename` and `Delete` are disabled when `Default` is the active
   preset.
3. **Metric sections** — one per group (Score, Primary, MA, Regime, Highs/Lows,
   Sentiment). Each section has the group label as a subhead and one checkbox
   row per metric, showing the metric's display label.
4. **Footer** — `Reset to defaults` link. Clears the active preset's hidden set
   only (does not affect other presets).

### Behavior

- Clicking outside the panel or pressing `Esc` closes it.
- Toggles apply live — the table updates immediately, no Save button needed for
  the currently active preset.
- "Inline prompt" throughout this spec means an in-panel form (text input +
  Save/Cancel buttons) that temporarily replaces the preset row inside the
  panel — **not** the browser's `prompt()` dialog.
- `Save as…` opens an inline prompt for a name; on submit, snapshots the current
  hidden-set under that name and switches the active preset to the new one.
- `Rename` opens an inline prompt prefilled with the current preset name.
- `Delete` shows an inline confirm ("Delete '<name>'?" with Confirm/Cancel)
  before removing; switches active preset to `Default` afterward.
- The `Default` preset is hard-coded and immutable. If the user toggles a
  checkbox while `Default` is active, an inline "Save these changes as a new
  preset?" prompt appears: accepting it captures the toggle into a new preset;
  canceling reverts the toggle. This prevents accidental loss of the canonical
  Default view.
- Existing column/group click-to-collapse stays as transient session UI,
  orthogonal to presets.

## Data shape

**localStorage key:** `uct.breadth.customize.v1` (versioned for future migrations)

**Stored value:**
```json
{
  "activePreset": "Default",
  "presets": {
    "MA Only": { "hidden": ["breadth_score", "up_4pct_today", "..."] },
    "Sentiment Focus": { "hidden": [...] }
  }
}
```

- `Default` is **never** in `presets` — it's a constant in code (`{ hidden: [] }`).
- Storing `hidden` (not `visible`) means newly added metrics in code auto-appear
  in every saved preset. Users only re-hide them if they don't want them.
- `activePreset` defaults to `"Default"` when missing or invalid.

## Filtering

The Monitor view's existing `visibleCols` derivation already filters by
`collapsedCols` (the transient click-to-collapse set). It will be extended to
also drop keys in the active preset's `hidden` set:

```js
visibleCols = COLS.filter(c => !hidden.has(c.key) && !collapsedCols.has(c.key))
```

`GROUP_SPANS` is recomputed so any group with zero visible metrics is dropped
from the group-header row entirely. The existing structure already handles
variable spans.

`exportCsv(rows, COLS)` (line 1328 in `Breadth.jsx`) is changed to receive
`visibleCols` so downloaded CSVs match the on-screen sheet.

## Edge cases

| Case | Behavior |
|------|----------|
| All metrics hidden | Inline empty-state in the table area: "All metrics hidden — open Customize to show some." Date column still renders. |
| Stored preset references a metric key no longer in code | Silently filtered on read. No warning. |
| Stored preset references a key for a different view (e.g. heatmap-only) | Harmless — filter only applies inside Monitor. |
| Multiple browser tabs | Last write wins. Acceptable for a single-user dashboard. |
| Corrupt JSON in localStorage | Caught and replaced with the default value. No crash. |
| User-supplied preset name "Default" | Rejected with inline message; reserved. |
| User-supplied preset name collides with existing custom preset | Rejected with inline message: "A preset with that name already exists." |
| User-supplied preset name is empty / whitespace only | Rejected with inline message: "Name cannot be empty." |
| User-supplied preset name longer than 40 chars | Rejected with inline message: "Name must be 40 characters or fewer." |

## Files

### New files (under `app/src/pages/breadth/`)

- `useBreadthCustomize.js` — localStorage-backed hook (~80 lines). Pure state +
  serialization. Returns `{ activePreset, hidden, setHidden, presets, savePreset,
  renamePreset, deletePreset, switchPreset, resetActive }`. Wraps reads/writes
  in try/catch; debounces writes ~150ms to avoid thrashing storage during rapid
  toggles.
- `CustomizePanel.jsx` — the dropdown panel UI (~180 lines). Receives data and
  handlers from the parent via props. Has no knowledge of localStorage.
- `CustomizePanel.module.css` — panel styling matching the modal aesthetic.

### Touched files

- `app/src/pages/Breadth.jsx` — instantiate the hook, add the `⚙ Customize`
  button to the header (line ~1326 area, before the CSV button), mount
  `<CustomizePanel>`, extend `visibleCols` / `GROUP_SPANS` / `exportCsv` calls
  to honor `hidden`.
- `app/src/pages/Breadth.module.css` — small additions for the customize button
  only.

## Testing

### Unit (Vitest) — `useBreadthCustomize.test.js`

- Loads defaults from empty storage.
- Round-trips a preset save.
- Switches active preset.
- Renames a preset (rejects "Default", rejects collisions).
- Deletes a preset (resets active to "Default").
- Recovers gracefully from corrupt JSON in storage.
- Drops unknown metric keys on read.

### Manual smoke checklist

1. Open panel → uncheck a few metrics → table updates live → reload page → still
   hidden.
2. Save as "MA Only" → switch back to Default → all metrics visible → switch to
   "MA Only" → hidden re-applied.
3. Rename "MA Only" → "MA". Delete "MA". Confirm dropdown reflects.
4. Hide everything → empty-state message renders, page doesn't crash.
5. Active preset = Default + toggle a checkbox → "Save as…" prompt appears →
   cancel reverts the toggle.
6. CSV download with custom preset active → downloaded file's columns match
   what's on screen.
7. Switch tabs (Heatmap, COT, Data Charts, Analogues) → all unaffected; Customize
   button hidden on non-Monitor tabs.
