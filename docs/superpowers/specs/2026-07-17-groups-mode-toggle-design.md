# Groups Mode Toggle — Design Spec

**Date:** 2026-07-17
**Status:** design — awaiting owner sign-off before the implementation plan
**Feature area:** `/charts` multi-chart grid, Groups feature (v1 + phases 2–3 shipped & live)
**Related:** `2026-07-17-multichart-groups-design.md`, `…-phase-2-3.md`

## 1. Goal

Let a trader flip an explicit **Groups Mode** on, then **type any stock into any cell to make the grid follow that stock's group** — "whatever stock I view dictates the grid." Rapid-fire scanning: type `RKLB` → its Space peers fill the rest; type `XOM` → Oil & Gas; type `NVDA` → Semis. When the mode is off, the grid is an ordinary manual grid (typing edits one cell).

## 2. The problem this solves

The peer-fill machinery already ships (v1 + phase 2): a committed ticker in a group grid refills the other cells with that ticker's peers, seed-immediate, with an Undo toast. But it only fires when a group is **already loaded** (`state.group` set), which today only happens by picking a group from the Groups picker. There is no way to be "in scanning mode" over an empty or manual grid and just start typing to seed a group. That's the gap.

Typing is one gesture that must mean two things — "seed a peer grid from this stock" vs "edit just this one chart." **The mode is the disambiguation:** Groups Mode ON → typing seeds peers; OFF → typing edits one cell. The trader never has to signal intent per-keystroke.

## 3. Final decisions (from brainstorm)

1. **A persisted Groups Mode toggle**, living **in the Multi Chart menu only** (a checkbox next to the Sync toggles). No header pill.
2. **ON = scanner:** a committed ticker (Enter / search-select) in *any* cell resolves that stock's group and fills the remaining cells with its peers (reuses the existing `peerFiller` path), seed stays put, **Undo toast** to revert.
3. **OFF = builder:** typing edits just that cell (today's manual behavior, untouched).
4. **Guard = Undo toast only** — instant, reversible, non-blocking (already built).
5. **Passive awareness** (since the toggle is menu-only, not a visible pill): when Groups Mode is ON, an empty cell's prompt reads **"Type a ticker → fill its group"** instead of "Add ticker"; a loaded group still shows the heat header. So the mode is legible without header chrome.

## 4. Model

Two pieces of state, one derived gate:

- **`groupsMode`** (new, boolean, persisted): the toggle. Source of truth for "am I scanning."
- **`group`** (existing, `{id, by, n, name} | null`): the *loaded* group identity — drives the heat header, badges, and Refresh. Set when a group is picked OR when a typed ticker resolves to a group. Can be `null` while `groupsMode` is on but nothing has been typed/picked yet.
- **Peer-fill-on-type gate** (the change): today `MultiChartGrid`'s `inGroupMode = !!state.group`. It becomes **`inGroupMode = state.groupsMode`**. That is the whole behavioral pivot.

Interactions:
- **Pick a group from the picker** → sets `groupsMode = true` **and** loads the group (fills cells). Same visible result as today, plus the mode is now explicitly on.
- **Groups Mode ON, no group yet, type a ticker** → `peerFiller.run(seed)` resolves the seed's group, fills `[seed, ...peers]`, sets `state.group`. The first type seeds the first group.
- **Groups Mode ON, group loaded, type a ticker** → re-seeds to the new ticker's group (today's in-group behavior).
- **Turn Groups Mode OFF** → the charts on screen **stay** as a now-plain manual grid; `state.group` is cleared (heat header + badges drop away), so you can hand-edit from there. (Does not clear cells — you keep what you were looking at.)

## 5. Components / files

- **`gridLayouts.js`** — `sanitizeState` allowlist carries `groupsMode` (boolean); `makeDefaultState` includes `groupsMode: false`. (Mirrors how `syncCrosshair` / `syncTimeRange` are handled.)
- **`useMultiChartState.js`** — add `setGroupsMode(on)` (mirrors `setSyncCrosshair`); expose `state.groupsMode`. Turning it **off** also clears `group` (one `apply`: `{...prev, groupsMode:false, group:null}`). `applyGridTemplate` sets `groupsMode` to whether the restored board carries a group (`groupsMode: !!restoredGroup`) — a saved Group board comes back in scanning mode; a plain saved grid does not.
- **`MultiChartMenu.jsx`** — a "Groups Mode" checkbox next to the Sync toggles, bound to `mc.state.groupsMode` / `mc.setGroupsMode`. Picking a group (existing `GroupPicker.pick`) also sets `groupsMode = true`.
- **`MultiChartGrid.jsx`** — repoint `inGroupMode` from `!!state.group` to `state.groupsMode`. Everything downstream (the `onChangeFns` peer-fill branch, the Undo toast, heat header, badges) is unchanged.
- **`GridChartCell.jsx`** — the empty-cell prompt reads "Type a ticker → fill its group" when a `scanning` prop (passed `= state.groupsMode`) is true, else "Add ticker".

## 6. Edge cases

| Case | Behavior |
|---|---|
| Groups Mode ON, empty grid | Cells show "Type a ticker → fill its group"; first committed ticker seeds a group |
| Groups Mode ON, typed ticker not in taxonomy | Existing behavior: AI-peer fallback (phase 2) or seed-solo + note |
| Groups Mode toggled OFF while a group is loaded | Charts stay; `group` cleared → header/badges drop; grid becomes manual |
| Groups Mode OFF, type a ticker | Edits that one cell (`updateCellAt`), no peer-fill — unchanged |
| Pick a group from the picker | Sets `groupsMode = true` + loads it (unchanged visible result) |
| Restore a saved Group board | `groupsMode = true` (it's a group board) so typing keeps scanning |
| Reload with `groupsMode` on but no group | Restores the toggle on; cells show the scan prompt |
| Spike harness (`?gridspike`) | Unaffected — peer-fill already short-circuits on `spikeActive` |

## 7. Testing

- **`gridLayouts.test.js`** — `sanitizeState` carries `groupsMode` (true/false), defaults false; malformed → false.
- **`useMultiChartState.test.jsx`** — `setGroupsMode(true/false)` toggles; turning off clears `group`.
- **`MultiChartGrid`** (behavioral, via the existing grid-dir suite + manual): with `groupsMode` on and no group, a committed ticker triggers `peerFiller.run` (peer-fill); with it off, a committed ticker calls `updateCellAt` only. The `onChangeFns` unit-of-behavior is covered by repointing the existing gate — confirm the grid-dir suite stays green and add a focused assertion if a seam test exists.
- **Manual (visible tab):** flip Groups Mode on over an empty grid → type RKLB → Space peers fill; type XOM → Oil & Gas; Undo reverts; flip off → charts stay, header drops, typing edits one cell.

## 8. Non-goals

Header pill / always-visible toggle (owner chose menu-only); confirm-before-clobber (Undo only); a separate "seed box" (rejected — the mode is the entry); any change to how peers are *ranked* or *resolved* (that's the separate curation initiative).
