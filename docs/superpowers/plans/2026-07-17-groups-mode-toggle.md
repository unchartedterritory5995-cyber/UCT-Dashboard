# Groups Mode Toggle — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a persisted **Groups Mode** toggle so that, when ON, typing any ticker into any grid cell seeds a peer grid from that stock's group; when OFF, the grid is an ordinary manual grid.

**Architecture:** A small layer on the shipped Groups peer-fill. The behavioral pivot is one line: `MultiChartGrid`'s `inGroupMode` gate moves from `!!state.group` (a group is loaded) to `state.groupsMode` (the toggle). A new persisted `groupsMode` boolean, a `setGroupsMode` mutator (mirroring `setSyncTimeRange`), a menu checkbox, and a scan-prompt on empty cells complete it. All peer-fill/Undo/heat/badge machinery is reused unchanged.

**Tech Stack:** React + Vite; vitest (`--pool=threads`); the shipped `app/src/pages/charts/grid/` module.

## Global Constraints

- `groupsMode` is the **single source of truth for "scanning is on"**. The peer-fill-on-type gate reads `state.groupsMode`, NOT `!!state.group`.
- `state.group` (`{id, by, n, name} | null`) stays as the *loaded group identity* (heat header, badges, Refresh) — set on pick or on a resolved type; independent of the toggle.
- **Turning Groups Mode OFF clears `group`** but keeps the cells (charts stay as a now-manual grid).
- State extensions go through `sanitizeState`'s **strict allowlist** (it returns only named keys — never spread `...raw`).
- Reuse the shipped peer-fill: do NOT touch `peerFill.js`, `fillCells`, the Undo toast, `GroupHeatHeader`, or `cellBadge`. Vitest runs with `--pool=threads`. Commit locally (push freeze); do not push.

---

## File structure

- **`app/src/pages/charts/grid/gridLayouts.js`** — `sanitizeState` carries `groupsMode`; `makeDefaultState` seeds `groupsMode: false`.
- **`app/src/pages/charts/grid/useMultiChartState.js`** — `setGroupsMode(on)` (off also clears `group`); `applyGridTemplate` sets `groupsMode` from the restored board; expose `setGroupsMode`.
- **`app/src/pages/charts/grid/MultiChartGrid.jsx`** — repoint `inGroupMode`; pass `scanning={state.groupsMode}` to each cell.
- **`app/src/pages/charts/grid/GridChartCell.jsx`** — empty-cell prompt reads "Type a ticker → fill its group" when `scanning`.
- **`app/src/pages/charts/grid/MultiChartMenu.jsx`** — "Groups Mode" checkbox; `GroupPicker.pick` sets `groupsMode: true`.
- Tests: `gridLayouts.test.js`, `useMultiChartState.test.jsx` (extended).

---

## Task 1: Persist `groupsMode` in grid state

**Files:**
- Modify: `app/src/pages/charts/grid/gridLayouts.js` (`makeDefaultState` ~L50-63, `sanitizeState` return ~L112-115)
- Test: `app/src/pages/charts/grid/gridLayouts.test.js`

**Interfaces:**
- Produces: `sanitizeState(raw)` returns `groupsMode` (boolean, `raw.groupsMode === true`); `makeDefaultState()` includes `groupsMode: false`.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/gridLayouts.test.js  (append inside the describe)
it('sanitizeState carries groupsMode; defaults false', () => {
  expect(sanitizeState({ layout: '2x2', cells: [], groupsMode: true }).groupsMode).toBe(true)
  expect(sanitizeState({ layout: '2x2', cells: [], groupsMode: 'yes' }).groupsMode).toBe(false)
  expect(sanitizeState({ layout: '2x2', cells: [] }).groupsMode).toBe(false)
  expect(makeDefaultState().groupsMode).toBe(false)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/gridLayouts.test.js`
Expected: FAIL (`groupsMode` is `undefined` — not in the allowlist / default).

- [ ] **Step 3: Implement**

In `gridLayouts.js`, add to `makeDefaultState()`'s returned object (next to `syncTimeRange: false`):

```javascript
    syncTimeRange: false,
    groupsMode: false,
    group: null,
```

And to `sanitizeState`'s returned object (next to `syncTimeRange`):

```javascript
    syncTimeRange: raw.syncTimeRange === true,
    groupsMode: raw.groupsMode === true,
    group: sanitizeGroup(raw.group),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/gridLayouts.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/gridLayouts.js app/src/pages/charts/grid/gridLayouts.test.js
git commit -m "feat(groups): persist groupsMode toggle in grid state"
```

---

## Task 2: `setGroupsMode` mutator + template restore

**Files:**
- Modify: `app/src/pages/charts/grid/useMultiChartState.js`
- Test: `app/src/pages/charts/grid/useMultiChartState.test.jsx`

**Interfaces:**
- Consumes: `apply(updater)`; Task 1's `groupsMode` in state; `sanitizeState`.
- Produces: `setGroupsMode(on)` on the hook (turning **off** also clears `group`); `state.groupsMode` exposed; `applyGridTemplate` restores `groupsMode` = `!!` the board's group.

- [ ] **Step 1: Write the failing test**

```javascript
// app/src/pages/charts/grid/useMultiChartState.test.jsx  (append a new describe)
describe('groupsMode', () => {
  it('toggles on, and turning off clears the loaded group', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.enterGrid('2x2'))
    act(() => result.current.setGroupsMode(true))
    act(() => result.current.fillCells(['RKLB', 'ASTS'], { id: 'space', by: 'today', n: 4, name: 'Space' }))
    expect(result.current.state.groupsMode).toBe(true)
    expect(result.current.state.group).toEqual({ id: 'space', by: 'today', n: 4, name: 'Space' })
    act(() => result.current.setGroupsMode(false))
    expect(result.current.state.groupsMode).toBe(false)
    expect(result.current.state.group).toBeNull()               // off clears the group
    expect(result.current.state.cells.map(c => c.sym).slice(0, 2)).toEqual(['RKLB', 'ASTS'])  // cells stay
  })

  it('applyGridTemplate restores groupsMode from the board (group present -> on)', () => {
    const { result } = renderHook(() => useMultiChartState())
    act(() => result.current.applyGridTemplate({
      layout: { kind: 'multichart', layout: '2x2', cells: [{ sym: 'XOP', tf: 'D' }],
                group: { id: 'oil_gas_ep', by: 'today', n: 4, name: 'Oil & Gas E&P' } },
    }))
    expect(result.current.state.groupsMode).toBe(true)
    act(() => result.current.applyGridTemplate({
      layout: { kind: 'multichart', layout: '2x2', cells: [{ sym: 'AAPL', tf: 'D' }] },  // no group
    }))
    expect(result.current.state.groupsMode).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/useMultiChartState.test.jsx`
Expected: FAIL (`setGroupsMode is not a function`; `applyGridTemplate` doesn't set `groupsMode`).

- [ ] **Step 3: Implement**

In `useMultiChartState.js`, add after `setSyncTimeRange`:

```javascript
  const setGroupsMode = useCallback((on) => {
    // The toggle IS the scanning gate. Turning it OFF also clears the loaded
    // group so the heat header + badges drop and the grid becomes plain manual
    // (the charts themselves stay — you keep what you were looking at).
    apply(prev => ({ ...prev, groupsMode: !!on, ...(!on ? { group: null } : {}) }))
  }, [apply])
```

Add `setGroupsMode` to the hook's returned object.

Update `applyGridTemplate` to set `groupsMode` from the restored board (find the current `sanitizeState({ ... group: l.group })` call and the `return { mode: 'grid', ...s }`):

```javascript
  const applyGridTemplate = useCallback((tpl) => {
    const l = tpl?.layout
    if (!l || l.kind !== 'multichart') return
    apply(prev => {
      const s = sanitizeState({ layout: l.layout, cells: l.cells,
        syncCrosshair: prev.syncCrosshair, syncTimeRange: prev.syncTimeRange, group: l.group })
      // A saved Group board comes back in scanning mode; a plain saved grid does not.
      return { mode: 'grid', ...s, groupsMode: !!s.group }
    })
  }, [apply])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/useMultiChartState.test.jsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/src/pages/charts/grid/useMultiChartState.js app/src/pages/charts/grid/useMultiChartState.test.jsx
git commit -m "feat(groups): setGroupsMode (off clears group) + template restores the mode"
```

---

## Task 3: Repoint the peer-fill gate + empty-cell scan prompt

**Files:**
- Modify: `app/src/pages/charts/grid/MultiChartGrid.jsx` (`inGroupMode` at line 118; the `<GridChartCell>` render)
- Modify: `app/src/pages/charts/grid/GridChartCell.jsx` (props destructure; empty-cell button ~L421-430)

**Interfaces:**
- Consumes: `state.groupsMode` (Task 1/2).
- Produces: peer-fill-on-type now fires whenever `state.groupsMode` is on (not only when a group is loaded); empty cells show the scan prompt when `scanning`.

This task has no new unit test (it repoints an existing gate + a text swap). Correctness gate = the grid-dir suite stays green + build + self-review. The peer-fill behavior itself is already covered by `peerFill.test.js` and the `MultiChartGrid` wiring; this only changes *when* it's allowed to fire.

- [ ] **Step 1: Repoint `inGroupMode`**

In `MultiChartGrid.jsx`, change line 118:

```javascript
  const inGroupMode = state.groupsMode
```

(Was `const inGroupMode = !!state.group`. The `onChangeFns` peer-fill branch that reads `inGroupMode` is unchanged — it now fires based on the toggle. `spikeActive` still short-circuits first.)

- [ ] **Step 2: Pass `scanning` to each cell**

In `MultiChartGrid.jsx`, in the `<GridChartCell ... />` render, add the prop (next to `badge=`/`rationale=`):

```jsx
                scanning={state.groupsMode}
```

- [ ] **Step 3: Render the scan prompt in GridChartCell**

In `GridChartCell.jsx`, add `scanning` to the props destructure (next to `badge`, `rationale`). Then change the empty-cell button (currently `<span>+</span> Add ticker`) to:

```jsx
          <button
            type="button"
            className={styles.cellEmpty}
            onClick={() => searchRef.current?.openWith('')}
          >
            <span className={styles.cellEmptyPlus}>+</span>
            {scanning ? 'Type a ticker → fill its group' : 'Add ticker'}
          </button>
```

- [ ] **Step 4: Verify (grid dir + build)**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/ && npm run build 2>&1 | grep -E "error|✓ built" | tail -1`
Expected: grid dir all pass + `✓ built`.

- [ ] **Step 5: Manual sanity (local dev, visible tab)**

With the toggle on (Task 4 wires the checkbox — for this task, temporarily flip it via the menu once Task 4 lands, or set `groupsMode:true` in the persisted pref): an empty grid shows "Type a ticker → fill its group"; typing a ticker fires the peer-fill. With the toggle off, empty cells show "Add ticker" and typing edits one cell. (This step is fully exercisable after Task 4; the automated gate above is the per-task check.)

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/charts/grid/MultiChartGrid.jsx app/src/pages/charts/grid/GridChartCell.jsx
git commit -m "feat(groups): peer-fill gate reads groupsMode; empty cells show the scan prompt"
```

---

## Task 4: Groups Mode checkbox + picker sets the mode

**Files:**
- Modify: `app/src/pages/charts/grid/MultiChartMenu.jsx` (the Sync toggles block ~L149-156; the "Exit Groups" button ~L238 — no new imports)
- Modify: `app/src/pages/charts/grid/GroupPicker.jsx` (`pick()` ~L30-40)
- Test: `app/src/pages/charts/grid/GroupPicker.test.jsx` (add `setGroupsMode: vi.fn()` to the mock `mc` if `pick()`'s new call throws)

**Interfaces:**
- Consumes: `mc.state.groupsMode`, `mc.setGroupsMode` (Task 2).
- Produces: a "Groups Mode" checkbox in the Multi Chart menu; `GroupPicker.pick` turns the mode on when a group is picked.

- [ ] **Step 1: Add the checkbox to the menu**

In `MultiChartMenu.jsx`, right after the existing "Sync time range across charts" `<label>` (the last of the sync toggles), add:

```jsx
      <label className={wsStyles.menuCheck}>
        <input
          type="checkbox"
          checked={mc.state.groupsMode}
          onChange={e => mc.setGroupsMode(e.target.checked)}
        />
        Groups Mode (type a ticker to fill its group)
      </label>
```

- [ ] **Step 2: Picker turns the mode on**

In `GroupPicker.jsx`'s `pick()`, set the mode so the picker and the toggle stay consistent (picking a group = entering scanning). The current `pick()` body is:

```javascript
    setBusy(g.id)
    const n = parseLayoutId(mc.state.layout).cellCount
    if (mc.state.mode !== 'grid') mc.enterGrid(mc.state.layout)
    const { syms, etf } = await fetchGroupTop(g.id, { n, by: 'today' })
    const filled = pinEtf(syms, etf, n)
    if (filled.length) mc.fillCells(filled, { id: g.id, by: 'today', n, name: g.name })
```

Add `mc.setGroupsMode(true)` right after the `enterGrid` line (before the awaited fetch, so the mode is on regardless of the fill result):

```javascript
    if (mc.state.mode !== 'grid') mc.enterGrid(mc.state.layout)
    mc.setGroupsMode(true)
    const { syms, etf } = await fetchGroupTop(g.id, { n, by: 'today' })
```

(`GroupPicker` receives `mc`; `setGroupsMode` is on it after Task 2.)

- [ ] **Step 3: "Exit Groups" fully exits scanning (consistency with the checkbox)**

In `MultiChartMenu.jsx`, the existing "Exit Groups" button (inside the `{mc.state.group && (…)}` block) currently calls `mc.clearGroup()`. Repoint it to `mc.setGroupsMode(false)` so the button and the checkbox mean the same thing (leave Groups Mode → group cleared + toggle off). Change:

```jsx
          <button type="button" className={wsStyles.addMenuItem} onClick={() => { mc.setGroupsMode(false); onClose() }}>
            Exit Groups
          </button>
```

(`clearGroup` stays exported/tested — only this call site changes. The Prev/Next/Refresh/Exit block stays gated on `mc.state.group`; when groupsMode is on with no group loaded, the block is absent and the checkbox is the control.)

- [ ] **Step 4: Verify (grid dir + build)**

Run: `cd app && npx vitest run --pool=threads src/pages/charts/grid/ && npm run build 2>&1 | grep -E "error|✓ built" | tail -1`
Expected: grid dir all pass (the existing `GroupPicker.test.jsx` still passes — `setGroupsMode` is a no-op on its mock `mc` unless the mock defines it; if the mock `mc` lacks `setGroupsMode`, add `setGroupsMode: vi.fn()` to the test's `mc` object so the call doesn't throw) + `✓ built`.

- [ ] **Step 5: Manual verification (local dev, visible tab)**

Open the Multi Chart menu → check **Groups Mode** → close. Empty grid shows "Type a ticker → fill its group". Type `RKLB` → Space peers fill; type `XOM` → Oil & Gas; Undo reverts. Uncheck Groups Mode → charts stay, header/badges drop, typing edits one cell. Pick a group from the picker → Groups Mode auto-checks; "Exit Groups" unchecks it.

- [ ] **Step 6: Commit**

```bash
git add app/src/pages/charts/grid/MultiChartMenu.jsx app/src/pages/charts/grid/GroupPicker.jsx
git commit -m "feat(groups): Groups Mode checkbox in the menu; picker turns the mode on"
```

---

## Final verification (after all tasks)

- Frontend: `cd app && npx vitest run --pool=threads src/pages/charts/grid/` — all green.
- Build: `cd app && npm run build` — `✓ built`.
- Manual (visible tab): the full loop in Task 4 Step 5, plus a reload with Groups Mode on to confirm the toggle + scan prompt persist.

## Non-goals

Header pill (menu-only per the spec); confirm-before-clobber (Undo only); changing how peers are ranked/resolved (that's the separate curation initiative).
