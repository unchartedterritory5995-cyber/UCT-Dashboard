# Chart UX Walls — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three walls a serious trial user hits in the first five minutes of the UCT chart — no persistent legend and no chip controls (30 seconds), one instance per definition (2–5 minutes), and no per-indicator settings dialog (5 minutes) — and carry the one naming pipeline that falls out of them into the alert row and the alert notification.

**Architecture:** The engine already stores, computes, binds and *labels* per **instance** — `binder` keys bindings by `bindingKey(instanceId, plotKey)`, `readout.engineChips` resolves inputs by `instanceId`, and `validateInstance` rejects a duplicate `instanceId` but never a duplicate `defId`. What is per-**definition** is only the WRITE DOOR (`instanceControls.setIndicatorEnabled` / `setIndicatorInput`, both keyed to `legacyInstanceId(defId)`) and the generated settings ROW. So the model change is a write-door change, it can be made a provable no-op while exactly one instance per definition exists, and it lands first and alone. The chip is then built on a settled door, the dialog on a settled chip, and the second instance last — when the chip can name it, the dialog can edit it and the door can address it.

**Tech Stack:** React 18 + Vite, lightweight-charts 5.2.0, CSS modules, vitest + @testing-library/react (frontend); FastAPI + pytest (the two alert tasks); `tools/chart_parity.py` (Playwright + Pillow) for the one task that moves pixels.

---

## Global Constraints

These apply to **every** task. They are not advice; each one has already cost this repo a day.

**Ownership and git (multi-agent tree)**
- Four other agents are editing this worktree. Their files: `api/routers/signature.py`, `api/services/signature/*`, `api/services/indicator_alert_service.py`, `api/routers/indicator_alerts.py`, `api/services/alerts.py`, `api/services/watchlist_alert_service.py`, `app/src/components/AlertBell.jsx`. **No task in this plan may edit any of them.** Every file this plan names was verified free at 2026-08-06.
- **Re-derive ownership from `git status --porcelain` immediately before you start**, never from this document. Three separate Phase C tasks found the controller's ownership list stale.
- Commit with the **pathspec form**: `git commit -m "…" -- path/one path/two`. Never `git add` then a bare `git commit` — two agents share one git index and a bare commit swept 12 files into one commit in Phase C.
- The pathspec form is **necessary and not sufficient**: `git commit -- <path>` commits the WORKING TREE at that path, including a co-worker's uncommitted edits to the *same file*. Before every commit run `git diff --stat HEAD -- <each path>` and **read the hunks**. If a hunk is not yours, stop and report.
- `git commit -- <paths>` **refuses an untracked file.** A new file needs a single-file `git add <file>` first.
- Do **not** push. Do not merge master. Report at the end of each task.

**Verification commands (exact)**
- Frontend: `cd app && npx vitest run <paths>` — **never** `npm test -- run`.
- Backend: `python -m pytest <paths> -q` from the repo root.
- Read the **bare exit code** (`echo $?` on its own line, not through a pipe). An exit code is lost through `| tail`, which fired for real in Phase C Task 15.
- ⚠️ **vitest prints `Test Files N passed` BEFORE `Tests M passed`.** A harness that regexes the first `(\d+) passed` reads `1` where the truth is `35`. Phase C Task 12 measured exactly this and it blessed a bad control. If you parse vitest output, anchor on `Tests\s+(\d+) passed`.
- ⚠️ `app/src/components/chart/liveStyles.dist.test.js` **reads `app/dist/assets/*.css`** and fails on a stale build. Run `cd app && npm run build` before trusting any full-suite run, and do not run a build while another agent is running vitest.
- ⚠️ `--pool=threads` reports "no tests" alongside 425 errors, which reads like a pass. Do not pass it.

**Environment traps**
- **This repo is CRLF.** A multi-line `\n` anchor matches ZERO. Six Phase C tasks hit it. Match single lines, or read bytes.
- **A python patch script must read and write BYTES** (`Path.read_bytes()` / `write_bytes()`), or it silently converts a whole file CRLF→LF. Phase C Task 13's controller patch converted 2,638 lines this way; git normalised the commit so the diff still looked right while the working tree no longer matched a checkout.
- `Path.write_text` **truncated `tools/chart_parity_cases.json` to 0 bytes** (cp1252 + lone surrogates). If you corrupt a committed file, restore with `git show HEAD:<path>` piped to `write_bytes` and verify sha256 — **not** `git checkout --`, which does not restore bytes under `core.autocrlf`.
- cp1252 kills a harness's own stdout on `…`, `→`, `⛔`. Keep tool output ASCII.
- Git-Bash `/tmp` is not Python's `/tmp`. Use absolute Windows paths for anything two languages share.
- **`useMediaQuery` / `useIsPhone` / `useIsTouch` are stale at first paint** (they seed from `matchMedia` at mount and only update on a `change` event; a fixed mobile viewport never fires one). Use CSS `@media` for **layout**; reserve the hooks for **click-triggered** conditional rendering. `ContextPopover` already obeys this — it reads `useIsTouch()` only after `open` is true.
- Canonical breakpoints only: phone `≤640px`, tablet `641–1024px`, desktop `≥1025px`. Copy the `@media` strings from `app/src/styles/breakpoints.css`. Never invent a literal.

**Rigor (carried from Phase C, which found 20 distinct ways a gate was vacuous — four by mutation, none by a failing test)**
- **Every zero needs a positive control.** A case that cannot report a difference must **refuse** (raise / exit non-zero), never return 0.
- **Mutation discipline, for every task**: CONTROL A = the unmutated tree, and it **aborts** if it reports zero collected tests; CONTROL B = the filtered selection with a **non-zero passed count**. `passed=None` is ambiguous between "the filter selected nothing" and "everything selected failed" — disambiguate with `collected > 0`. **Read WHY each kill happened** — a survivor can be a semantic no-op and a kill can be for the wrong reason.
- **Refusal messages must be disjoint.** Two gates sharing a phrase let `pytest.raises(match=…)` / `toThrow(/…/)` pass with the safety deleted. That happened in Phase C Task 9.
- **Verify structure with an AST, never a grep.** A `grep -c admit_alert_fire` counted 2 — both were prose in comments — and nearly became a false ship-blocker.
- **Derive identifiers from the system, never type them.** Five separate probe findings in Phase C were typed names that failed in the shape of a catastrophic bug (a 14-entry catalog read as 1, an admin session read as anonymous, a live table read as missing).
- **Do not restate in this plan, or in any doc, a count that a test asserts.** That copy rots green; this spec has suffered it twice (691,195 survived in 17 in-code sites after the fixture moved). Where a count appears below it is tagged **[measured 2026-08-06]** and points at the file that asserts the live number.
- **A source rail that slices by LINE NUMBER is unsafe here.** `inspect.getsource` returned the wrong slice mid-run when a co-worker inserted 180 lines above the function. Re-parse the `FunctionDef`/`VariableDeclaration` **by name**.

**Measured baselines [measured 2026-08-06 — read the live numbers where noted, never here]**
- `engineRegistry.listDefinitions()` returns **17** definitions. Asserted at `app/src/components/chart/engine/nativeRegistry.test.js:509`.
- `alert_catalog()` returns **16 groups / 31 addresses**. The live numbers are asserted in the Phase C alert suite; read them there.
- `tools/chart_parity_cases.json` holds **50** cases, **4** of them `status: "placeholder"`.
- `app/src/components/chart/engine/instanceControls.test.js` — **31 tests**, exit 0.
- **11 visible chip declarations across 8 definitions.** Nine definitions declare **no chip at all**: `bb, vwap, mfi, cci, williamsR, adx, obv, donchian, avwap`. (Not asserted anywhere today — Task 2 replaces the count with a derived totality rail.)

---

## The dependency order, and the measurement it rests on

`setIndicatorEnabled`'s own docstring gives the reason for the per-definition tombstone: *"a settings row is per-DEFINITION at v1."* That sentence is the coupling. But the coupling is **narrower than it reads**, and the measurement is this:

| layer | keyed by | verified at |
|---|---|---|
| stored instance list | `instanceId`; a duplicate `defId` is **not** an error | `instances.js:542` `validateInstance` — only `ctx.seenIds` duplicate-**instanceId** is rejected |
| binder / series pool | `bindingKey(instanceId, plotKey)` | `pool.js:115`, `pool.js:672` |
| pane assignment | `def.id` — `orderedPaneKeys` dedupes by `defId` (`seen.has(inst.defId)`) | `paneLayout.js:265-283`, `placement.js:337` `const key = def.id` |
| legend chip | `instanceId`; inputs resolved per instance | `readout.js:229-243` |
| **write door** | **`legacyInstanceId(defId)`** — one id per definition | `instanceControls.js:220, 302, 340` |
| **generated settings row** | **`defId`**; `liveInstanceFor` takes the **first** match | `indicatorRegistry.js:208-214, 279` |

So **the storage, the binder and the readout are already multi-instance; only the write door and the settings row are not.** Two RSI instances at different periods land on the **same pane, same 0–100 axis** (because a pane key is a `defId`), which is also the display a fast/slow RSI trader wants — so the duplicate needs **zero** change to `paneLayout`, `placement` or `binder`.

**Therefore the order is: model change → chip → dialog → duplicate.**

1. **Per-instance write door first, alone (Task 1).** It is a provable no-op while at most one instance per definition exists, so it can be gated by an *equality* rather than by taste. It also lands before anything calls it, which is the only arrangement in which "the chip's Hide button hides THIS instance" is true on the day the chip ships rather than a bug that appears when the duplicate does.
2. **Chip second (Tasks 2–4).** The chip is what makes multiple instances legible. Shipping the duplicate first produces two indistinguishable coloured lines that one control turns both off — strictly worse than today.
3. **Dialog third (Task 5).** It is per-instance by definition ("RSI(7) settings" vs "RSI(14) settings"), so it needs Task 1's door and Task 4's launcher.
4. **Duplicate last (Task 6).** By then the chip names it, the dialog edits it and the door addresses it. Task 6 is also the only task in this plan that moves a pixel.
5. **The naming pipeline reaches the alert lane (Tasks 7–8).** Task 7's value — two RSI alerts stop sending byte-identical email — is only *reachable* after Task 6.

---

## What the pixel gate does NOT cover here — and what does

`tools/chart_parity.py` renders exactly one route: `/r/chart` (`app/src/pages/ChartRender.jsx`). That page injects, at `ChartRender.jsx:527`:

```
#chart-export [class*="legend" i]{display:none !important}
#chart-export [class*="volLegend" i]{display:flex !important}
```

**The entire OHLC/indicator legend is `display:none` in the only route the pixel gate photographs.** So the gate is blind to the whole chip surface — not merely to interactivity as one might assume, but to the chip *text* as well. **A total regression of Tasks 2, 3, 4 and 5 would report 0 changed pixels on all 46 live cases.** It is also blind by construction to anything requiring a cursor, a keypress or a click: the parity route has no cursor, mounts no popover and clicks nothing.

`chartScreenshot.js` drops the same legend from the branded export, so the chips are absent there too.

| Task | Deliverable | THE REAL GATE | Pixel gate |
|---|---|---|---|
| 1 | per-instance write door | `instanceControls.test.js` + a **byte equality** of `setIndicatorEnabled`/`setIndicatorInput` output over the whole fixture corpus, pinned as a literal so it predates the change | not run — no render path touched, and a 0 would be vacuous |
| 2 | every definition declares a chip | `legendFromDefinitions.test.jsx` **totality rail** (every definition that binds a data plot yields ≥1 chip) + a declared chip-text table | not run — `plots[].legend` is read by `readout.js` alone (verified: no other shipped module reads it) |
| 3 | persistent chip strip | `legendFromDefinitions.test.jsx` off-cursor cases + a new **blindness proof** asserting the parity route hides `.legend`, so nobody later cites a 0 from it | **must not be run as a gate**; the blindness proof is the substitute |
| 4 | chip controls | interaction tests through `ContextPopover` + `controlDoorCensus.test.js` (the new door must be named) | not run |
| 5 | per-instance settings dialog | dialog DOM tests + a **rollback equality** (Cancel restores the settings object byte-for-byte) | not run |
| 6 | a second instance | `tools/chart_parity.py --cases engine_two_rsi_instances` with a declared `expect`, **plus** its fail-proof; and `stockChartWiring.test.jsx` | **run — this is the one task that moves pixels** |
| 7 | notification names the instance | `python -m pytest tests/test_indicator_alert_evaluator*.py` + `tools/alert_replay.py --check` **must still report FIRE LOG MATCHES** (the message text is not in the fire key; if `--check` moves, you changed evaluation, not text) | n/a |
| 8 | create errors surfaced + 8 timeframes | `IndicatorAlertPopover.test.jsx` + `useIndicatorAlerts` unit tests | not run |

---

## File structure

**Created**
| File | Responsibility |
|---|---|
| `app/src/components/chart/legend/IndicatorChip.jsx` | ONE chip: label, value, hover controls, hidden/error dot. No settings knowledge, no writes — it calls props. |
| `app/src/components/chart/legend/IndicatorChip.module.css` | Chip styling. All layout via CSS `@media`, never a JS breakpoint hook. |
| `app/src/components/chart/legend/chipMenu.js` | PURE. `(instance, def, ctx) → ContextPopover items[]`. Unit-testable with no chart, no DOM. |
| `app/src/components/chart/legend/chipMenu.test.js` | Its tests. |
| `app/src/components/chart/legend/IndicatorChip.test.jsx` | Its tests. |
| `app/src/components/chart/IndicatorSettingsDialog.jsx` | The three-tab per-INSTANCE dialog (Inputs / Style / Visibility). Owns the snapshot-on-open and the debounce; writes through `instanceControls`. |
| `app/src/components/chart/IndicatorSettingsDialog.module.css` | Its styling. |
| `app/src/components/chart/IndicatorSettingsDialog.test.jsx` | Its tests. |
| `app/src/components/chart/engine/__tests__/perInstanceDoor.test.js` | Task 1's equality + two-instance behaviour. |
| `app/src/components/chart/engine/__tests__/parityGateBlindness.test.js` | Proves the pixel gate cannot see the legend, so a future 0 cannot be cited as evidence. |

**Modified**
| File | Change |
|---|---|
| `app/src/components/chart/engine/instanceControls.js` | + `findInstance`, `setInstanceHidden`, `setInstanceInput`, `removeInstance`, `addInstance`. The per-definition functions keep their contract. |
| `app/src/components/chart/engine/instances.js` | + `newInstanceId(defId, list)` — deterministic, collision-free against tombstones. |
| `app/src/components/chart/engine/readout.js` | + `legendChips(...)`, which emits a value-less chip for a HIDDEN instance so it can be un-hidden. |
| `app/src/components/chart/engine/nativeRegistry.js` | The nine chip-less definitions gain `plots[].legend` blocks. |
| `app/src/components/StockChart.jsx` | `computeLatestCrosshair` emits chips; the legend renders `IndicatorChip`s; the dialog is mounted; `Add alert on …` joins the region menu. |
| `app/src/components/chart/indicatorRegistry.js` | Task 6 only: rows go per-instance. |
| `app/src/components/chart/IndicatorLibraryDialog.jsx` | Task 6 only: "Add another". |
| `app/src/hooks/useIndicatorAlerts.js` | Task 8: `createIndicatorAlert` stops swallowing non-OK. |
| `app/src/components/chart/IndicatorAlertPopover.jsx` | Task 8: render the error; offer all eight timeframes. |
| `api/services/indicator_alert_evaluator.py` | Task 7: the notification names the instance and the bar. |
| `tools/chart_parity_cases.json` | Task 6: one new case + its fail-proof note. |

---

## Deviations from spec §6, and things in it that shipped code has overtaken

State these in the task reports; they are decisions, not oversights.

1. **§6: *"chip live values render only while crosshair active"*** — **deviated from, deliberately.** That clause predates `alwaysShowLegend`, which `ChartPane` passes unconditionally (`ChartPane.jsx:523`) and which `/r/chart` passes too; `<ChartPane` is mounted from **12** shipped modules [measured 2026-08-06 — `grep -rln '<ChartPane' app/src --include=*.jsx | grep -v '\.test\.'`], and it already prints the last bar's O/H/L/C/V off-cursor. A chip that blanked would disagree with the row directly above it. **The label is always visible; the value follows the crosshair when hovering and falls back to `binding.lastValue` off-cursor** — which is the fallback `chipsFrom` already implements and documents.
2. **§6: *">4 chips/pane collapses to +N"*** — implemented as **">4 chips in the strip"**, because the shipped legend is ONE box positioned at the top-left of the whole chart (`StockChart.jsx:10485`), not one box per pane. Per-pane chip placement is **out of scope**: it needs pane-relative positioning, moves the branded export frame, and buys nothing against the three walls.
3. **§6 state 7 "Hidden" contradicts shipped behaviour.** `legendFromDefinitions.test.jsx` asserts today that *"a hidden instance emits no chip"*, because `planBindings` drops a hidden instance (`pool.js:655`) and `chipsFrom` needs a series. **A chip you cannot see is a chip you cannot un-hide from.** Task 3 inverts that assertion — a hidden instance emits a value-less, dimmed chip — and the reason goes in the test.
4. **§6: *"Move"* as a chip action** — offered, but only over `placement.target ∈ {price, pane, volume}`, which is what `validateInstance` accepts (`instances.js:616`) and what `resolvePlacement` reads. **You cannot move RSI into MACD's pane**, because a pane key is a `defId` (`placement.js:337`). Say so in the menu's disabled state rather than offering a move that cannot be stored.
5. **§6: *"ONE formatting pipeline drives Style-tab precision, chip values and crosshair readout"*** — the pipeline exists (`readout.chipsFrom`, off `plots[].legend.decimals`), and `defSchema.js:147` records that **`legend.decimals` is NOT `plots[].precision`**: the first is the chip's, the second is the price scale's, and RSI legitimately prints 1 in the chip while its scale carries LWC's default 2. The Style tab therefore edits **`legend.decimals`**, and the two fields must not be conflated.
6. **§5's `styleOverrides` instance field has ZERO consumers** in shipped code (grep across `app/src`: one mention, in a test comment quoting the spec). Task 5 does **not** introduce it — per-instance style is expressed through the definition's own declared `color`/`width`/`lineStyle` **inputs**, which `pool.resolvePlotForInstance` already resolves per instance through `$refs`. Introducing a second style channel would be a second thing to get wrong.

---

## How a new persisted field survives `mergeChartSettings`

`mergeChartSettings` (`app/src/components/chart/chartDefaults.js:336`) **is a hard allow-list**: its return is an object literal, and *a key absent from that literal is destroyed on every read*. That mechanism deleted `engineEnabled` at seven sites. There is a **second** allow-list one level down: `mergeSettingsOverride`'s `_OVERRIDE_SECTION_KEYS` (`instanceShape.js:71`), and its instance branch merges `{ ...prev, ...patch, inputs: {...} }` — a **shallow** spread with `inputs` as the only deep-merged child, so a *nested object* added to an instance is replaced wholesale by any grid-cell override.

**The rule this plan follows, and every task must obey:**

> **Persist inside `indicatorInstances[]`, never at the top level.** `indicatorInstances` passes through as `Array.isArray(parsed.indicatorInstances) ? parsed.indicatorInstances : []` (`chartDefaults.js:442`), and `validateInstance` checks only the fields it knows (`instanceId`, `defId`, `defVersion`, `hidden`, `scope`, `placement`, `inputs`) while `cloneInstance` explicitly preserves unknown ones. So a new **instance** field survives both allow-lists untouched. A new **top-level** field does not, and will be eaten silently.

Every task in this plan persists only `inputs`, `hidden`, `placement` and `instanceId` — all of which are already in the instance contract. **If a later change genuinely needs a top-level key**, it must (a) add a line to `mergeChartSettings`' return literal, (b) add a `key` to `_OVERRIDE_SECTION_KEYS` if it is a section object, and (c) ship the test in Task 1 Step 7 below, which round-trips a real JSON **string** and has a positive control.

---

# Task 1: The per-instance control door

**Files:**
- Modify: `app/src/components/chart/engine/instances.js` (add `newInstanceId`, near `legacyInstanceId` at `:122`)
- Modify: `app/src/components/chart/engine/instanceControls.js` (add four exports after `setIndicatorEnabled` at `:245`)
- Create: `app/src/components/chart/engine/__tests__/perInstanceDoor.test.js`
- Modify: `app/src/components/chart/engine/__tests__/controlDoorCensus.test.js` (name the new door)

**Interfaces:**
- Consumes: `withInstances(cs, instances, registry)`, `isLiveInstance` (module-local), `instanceTombstone`, `legacyInstanceId`, `validateInputValue`, `coerce` (module-local) — all already in `instanceControls.js`.
- Produces, for Tasks 4, 5 and 6:
  - `newInstanceId(defId: string, list: object[]) → string` — deterministic; `inst:<defId>:<n>` with the smallest `n ≥ 1` unused **by any element of `list`, tombstones included**.
  - `findInstance(cs: object, instanceId: string) → object|null` — the LIVE instance, or null.
  - `setInstanceHidden(cs, instanceId: string, hidden: boolean, registry) → object` — `cs` unchanged **by identity** when refused.
  - `setInstanceInput(cs, instanceId: string, key: string, value: unknown, registry) → object` — validates against the declared input; `cs` unchanged by identity when refused.
  - `removeInstance(cs, instanceId: string, registry) → object` — tombstones ONE instance; clears the legacy mirror **only when the last live instance of that definition goes**.
  - `addInstance(cs, defId: string, registry) → object` — appends a new live instance carrying the definition's declared defaults. **Exported here but reached by no UI until Task 6.**

- [ ] **Step 1: Write the premise probe — the renderer is ALREADY multi-instance**

This task's whole shape depends on it. Create `app/src/components/chart/engine/__tests__/perInstanceDoor.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { normalizeInstances, validateInstance } from '../instances'
import * as engineRegistry from '../nativeRegistry'
import { planBindings, bindingKey } from '../pool'

describe('the premise: storage and binding are already per-INSTANCE', () => {
  const TWO_RSI = [
    { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 },  hidden: false },
  ]

  it('two instances of ONE definition both survive normalisation', () => {
    const { kept, dropped } = normalizeInstances(TWO_RSI, engineRegistry)
    expect(dropped, 'a duplicate defId was rejected — the premise of this plan is wrong, STOP and report')
      .toEqual([])
    expect(kept.map(i => i.instanceId)).toEqual(['legacy:rsi', 'inst:rsi:1'])
  })

  it('a duplicate instanceId IS rejected — the control that proves the check runs', () => {
    const seenIds = new Set(['legacy:rsi'])
    const res = validateInstance(TWO_RSI[0], engineRegistry, { seenIds })
    expect(res.ok).toBe(false)
    expect(res.errors.join(' ')).toMatch(/duplicate/)
  })

  it('the binder plans TWO separate bindings, keyed by instanceId', () => {
    const { desired } = planBindings(TWO_RSI, engineRegistry, [], {})
    const keys = desired.map(d => d.key)
    expect(keys).toContain(bindingKey('legacy:rsi', 'rsi'))
    expect(keys).toContain(bindingKey('inst:rsi:1', 'rsi'))
    expect(new Set(keys).size, 'two instances collapsed to one binding').toBe(keys.length)
  })
})
```

- [ ] **Step 2: Run it — it must PASS**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/perInstanceDoor.test.js`
Expected: **3 passed**, exit 0.

⚠️ If the first or third case FAILS, this plan's dependency order is built on a false premise. **Stop, do not continue, and report** — the model change is larger than "the write door" and the whole plan must be re-cut.

If `planBindings`' return shape differs from `{ desired }`, read `pool.js:647` and adapt the destructuring **without weakening the assertion**: the two keys must still be distinct and both present.

- [ ] **Step 3: Write the failing tests for the four new doors**

Append to the same file:

```js
import {
  findInstance, setInstanceHidden, setInstanceInput, removeInstance, addInstance,
  setIndicatorEnabled, isIndicatorEnabled,
} from '../instanceControls'
import { newInstanceId } from '../instances'

const csWith = (instances, indicators = {}) => ({ indicatorInstances: instances, indicators })

describe('the per-INSTANCE door', () => {
  const TWO = () => ([
    { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 },  hidden: false },
  ])

  it('newInstanceId is deterministic and skips a TOMBSTONED id', () => {
    const list = [
      { instanceId: 'inst:rsi:1', defId: 'rsi' },
      { instanceId: 'inst:rsi:2', deleted: true },
    ]
    expect(newInstanceId('rsi', list)).toBe('inst:rsi:3')
    expect(newInstanceId('rsi', list)).toBe('inst:rsi:3')   // pure
  })

  it('setInstanceHidden hides ONE instance and leaves its sibling drawing', () => {
    const next = setInstanceHidden(csWith(TWO()), 'inst:rsi:1', true, engineRegistry)
    const byId = Object.fromEntries(next.indicatorInstances.map(i => [i.instanceId, i]))
    expect(byId['inst:rsi:1'].hidden).toBe(true)
    expect(byId['legacy:rsi'].hidden).toBe(false)
  })

  it('removeInstance tombstones ONE and KEEPS the mirror on while a sibling lives', () => {
    const cs = csWith(TWO(), { rsi: { enabled: true } })
    const next = removeInstance(cs, 'inst:rsi:1', engineRegistry)
    const live = next.indicatorInstances.filter(i => i && i.deleted !== true)
    expect(live.map(i => i.instanceId)).toEqual(['legacy:rsi'])
    expect(next.indicators.rsi.enabled, 'the mirror lied: RSI still draws').toBe(true)
    expect(isIndicatorEnabled(next, 'rsi', { has: () => true })).toBe(true)
  })

  it('…and CLEARS the mirror when the LAST live instance goes', () => {
    let cs = csWith(TWO(), { rsi: { enabled: true } })
    cs = removeInstance(cs, 'inst:rsi:1', engineRegistry)
    cs = removeInstance(cs, 'legacy:rsi', engineRegistry)
    expect(cs.indicators.rsi.enabled).toBe(false)
    expect(isIndicatorEnabled(cs, 'rsi', { has: () => true })).toBe(false)
  })

  it('setInstanceInput writes ONE instance and REFUSES an undeclared key by identity', () => {
    const cs = csWith(TWO())
    const ok = setInstanceInput(cs, 'inst:rsi:1', 'period', 9, engineRegistry)
    expect(findInstance(ok, 'inst:rsi:1').inputs.period).toBe(9)
    expect(findInstance(ok, 'legacy:rsi').inputs.period).toBe(14)
    expect(setInstanceInput(cs, 'inst:rsi:1', 'notAKey', 9, engineRegistry)).toBe(cs)
    expect(setInstanceInput(cs, 'inst:rsi:1', 'period', 7.5, engineRegistry)).toBe(cs)
    expect(setInstanceInput(cs, 'nope', 'period', 9, engineRegistry)).toBe(cs)
  })

  it('addInstance mints a live instance carrying the DECLARED defaults', () => {
    const cs = csWith([TWO()[0]])
    const next = addInstance(cs, 'rsi', engineRegistry)
    const added = next.indicatorInstances.find(i => i.instanceId === 'inst:rsi:1')
    const declared = engineRegistry.getDefinition('rsi').inputs
      .filter(i => i.default !== undefined)
    expect(added.defId).toBe('rsi')
    expect(added.hidden).toBe(false)
    for (const d of declared) expect(added.inputs[d.key]).toEqual(d.default)
  })

  it('⛔ the per-DEFINITION door still tombstones EVERY instance — unchanged contract', () => {
    const off = setIndicatorEnabled(csWith(TWO(), { rsi: { enabled: true } }), 'rsi', false, engineRegistry)
    expect(off.indicatorInstances.every(i => i.deleted === true || i.defId !== 'rsi')).toBe(true)
    expect(off.indicators.rsi.enabled).toBe(false)
  })
})
```

- [ ] **Step 4: Run them — they must FAIL**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/perInstanceDoor.test.js`
Expected: the 3 premise cases pass; the 7 new cases FAIL with `newInstanceId is not a function` / `setInstanceHidden is not a function`.

- [ ] **Step 5: Implement `newInstanceId` in `instances.js`**

Insert immediately after `legacyInstanceId` (`instances.js:124`):

```js
/** The namespace for an instance a USER added, as opposed to one the v1→v2 fold
 *  seeded. Distinct from `LEGACY_ID_PREFIX` because "came from the fourteen
 *  legacy toggles" is a fact the migrator and `isIndicatorEnabled` still key off. */
export const USER_ID_PREFIX = 'inst:'

/**
 * A fresh instance id for `defId` that nothing in `list` already uses.
 *
 * DETERMINISTIC — a pure function of the defId and the list. No clock, no
 * counter, no randomness, for the same reason `legacyInstanceId` is: re-running
 * a mint against the same list must produce the same answer, or a grid cell's
 * stale snapshot mints a SECOND copy on its next unrelated write.
 *
 * ⛔ IT COUNTS TOMBSTONES. Reusing `inst:rsi:2` after that id was deleted gives
 * the new instance a corpse's id: `mergeSettingsOverride` would collapse it back
 * to the tombstone (`instanceShape.js:100`) and the indicator would be added and
 * then silently vanish.
 */
export function newInstanceId(defId, list) {
  const taken = new Set()
  for (const i of (Array.isArray(list) ? list : [])) {
    if (i && typeof i === 'object' && isNonEmptyString(i.instanceId)) taken.add(i.instanceId)
  }
  for (let n = 1; ; n++) {
    const id = `${USER_ID_PREFIX}${defId}:${n}`
    if (!taken.has(id)) return id
  }
}
```

- [ ] **Step 6: Implement the four doors in `instanceControls.js`**

Add the import of `newInstanceId` to the existing import at `:69`:

```js
import { legacyInstanceId, newInstanceId, stackRank } from './instances'
```

Append after `setIndicatorEnabled` (`:245`):

```js
/** The LIVE instance under `instanceId`, or null. A tombstone is not an
 *  instance: every door below refuses one rather than reviving it. */
export function findInstance(cs, instanceId) {
  const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
  return list.find(i => isLiveInstance(i) && i.instanceId === instanceId) || null
}

/**
 * Hide or show ONE instance.
 *
 * `hidden` is REMOVE-and-rebind, not park: `pool.planBindings` drops a hidden
 * instance and the binder calls `removeSeries`, which under `paneMode() ===
 * 'panes'` drops the pane synchronously. That is the shipped decision
 * (`__tests__/hiddenIsRemovedNotParked.test.js`) and this door does not change it.
 *
 * ⛔ IT DOES NOT TOUCH THE MIRROR. `isIndicatorEnabled` counts a hidden instance
 * as ON — `Alt+Shift+I` declutters the chart and must not uncheck every box —
 * so writing `indicators[defId].enabled = false` here would make the checkbox
 * disagree with the reader on the very next paint.
 */
export function setInstanceHidden(cs, instanceId, hidden, registry) {
  if (!cs || typeof cs !== 'object' || typeof hidden !== 'boolean') return cs
  if (!findInstance(cs, instanceId)) return cs
  const next = cs.indicatorInstances.map(i =>
    (i && i.instanceId === instanceId) ? { ...i, hidden } : i)
  return withInstances(cs, next, registry)
}

/**
 * Remove ONE instance, leaving its siblings drawing.
 *
 * ⭐ THE MIRROR IS "AT LEAST ONE LIVE INSTANCE", NOT "THE ONE I JUST DELETED".
 * `cs.indicators.<id>.enabled` is read by the `?indicators=` render route and by
 * `mergeSettingsOverride`, neither of which knows about instances. Clearing it
 * while a sibling still draws would tell those two readers RSI is off while the
 * chart draws it — the exact disagreement the write-through mirror exists to
 * prevent.
 */
export function removeInstance(cs, instanceId, registry) {
  const inst = findInstance(cs, instanceId)
  if (!inst) return cs
  const defId = inst.defId
  const next = cs.indicatorInstances.map(i =>
    (i && i.instanceId === instanceId) ? instanceTombstone(instanceId) : i)
  const indicators = { ...(cs.indicators || {}) }
  if (!next.some(i => isLiveInstance(i) && i.defId === defId)) {
    indicators[defId] = { ...(indicators[defId] || {}), enabled: false }
  }
  return { ...withInstances(cs, next, registry), indicators }
}

/**
 * Set one input on ONE instance.
 *
 * Same validation as `setIndicatorInput` and for the same reason — an input the
 * definition does not declare, or a value it would reject, produces an instance
 * `normalizeInstances` then DROPS, i.e. an indicator that silently disappears on
 * the next paint. Refused writes return `cs` by IDENTITY so the caller can skip
 * persisting.
 *
 * ⛔ IT DOES NOT WRITE THE MIRROR. The mirror is per DEFINITION and cannot carry
 * two instances' periods; writing one of them there would make the settings row
 * and the `?indicators=` route show a number no line on the chart is drawn with.
 */
export function setInstanceInput(cs, instanceId, key, value, registry) {
  const inst = findInstance(cs, instanceId)
  if (!inst) return cs
  const def = resolveRegistry(registry)(inst.defId)
  if (!def) return cs
  const declared = declaredInputs(def).get(key)
  if (!declared) return cs
  const coerced = coerce(declared, value)
  if (coerced === undefined) return cs
  const errors = []
  validateInputValue(declared, coerced, `inputs.${key}`, errors)
  if (errors.length) return cs

  const next = cs.indicatorInstances.map(i => (
    i && i.instanceId === instanceId ? { ...i, inputs: { ...(i.inputs || {}), [key]: coerced } } : i
  ))
  return withInstances(cs, next, registry)
}

/**
 * Add ANOTHER instance of a definition already on the chart.
 *
 * The new instance carries the definition's DECLARED defaults rather than a copy
 * of a sibling's inputs: "another RSI" that arrives identical to the one already
 * there draws a second line exactly on top of the first, which reads as nothing
 * having happened. `stackRank` gives siblings an equal rank and
 * `Array.prototype.sort` is stable (ES2019), so `withInstances` preserves the
 * order they were added in.
 *
 * ⛔ IT ALSO SETS THE MIRROR ON. A user can reach this only for a definition that
 * is already drawing, but the blob a grid cell hands back may not say so, and an
 * instance list that draws while the mirror says OFF is the disagreement above in
 * the other direction.
 */
export function addInstance(cs, defId, registry) {
  const def = resolveRegistry(registry)(defId)
  if (!def || !cs || typeof cs !== 'object') return cs
  const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  const inputs = {}
  for (const [key, declared] of declaredInputs(def)) {
    if (declared.default !== undefined) inputs[key] = declared.default
  }
  const added = {
    instanceId: newInstanceId(defId, list),
    defId,
    ...(Number.isInteger(def.version) ? { defVersion: def.version } : {}),
    inputs,
    ...(placementFor(def, defId, cs) ? { placement: placementFor(def, defId, cs) } : {}),
    hidden: false,
  }
  const indicators = { ...(cs.indicators || {}) }
  indicators[defId] = { ...(indicators[defId] || {}), enabled: true }
  return { ...withInstances(cs, [...list, added], registry), indicators }
}
```

- [ ] **Step 7: Run the tests — they must PASS**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/perInstanceDoor.test.js`
Expected: **10 passed**, exit 0.

- [ ] **Step 8: Write the NO-OP EQUALITY — the gate that makes this reviewable alone**

Append to `perInstanceDoor.test.js`. This is the task's real gate: it pins that adding four doors changed nothing about the three that already existed.

```js
import crypto from 'node:crypto'
import { CHART_DEFAULTS, PRESETS, mergeChartSettings } from '../../chartDefaults'
import { setIndicatorInput } from '../instanceControls'

/** A stable digest of a settings object. `JSON.stringify` with SORTED keys, so
 *  a key-ORDER change (which is invisible to `toEqual`) still moves the number,
 *  and a key added or destroyed by an allow-list cannot hide. */
const digest = (o) => crypto.createHash('sha256')
  .update(JSON.stringify(o, (_k, v) =>
    (v && typeof v === 'object' && !Array.isArray(v))
      ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]]))
      : v))
  .digest('hex')

describe('⭐ the per-DEFINITION doors did not move — an equality, not an opinion', () => {
  // Every preset plus the bare defaults, each read through the REAL merge, then
  // walked through every registered definition with both per-definition doors.
  const corpus = () => {
    const bases = [CHART_DEFAULTS, ...Object.values(PRESETS).map(p => p.settings)]
      .map(b => mergeChartSettings(JSON.stringify(b)))
    const out = []
    for (const base of bases) {
      for (const def of engineRegistry.listDefinitions()) {
        let cs = setIndicatorEnabled(base, def.id, true, engineRegistry)
        out.push(cs)
        const firstNum = (def.inputs || []).find(i => i.type === 'int' && i.default !== undefined)
        if (firstNum) {
          cs = setIndicatorInput(cs, def.id, firstNum.key, firstNum.default + 1, engineRegistry)
          out.push(cs)
        }
        out.push(setIndicatorEnabled(cs, def.id, false, engineRegistry))
      }
    }
    return out
  }

  it('the corpus is not empty and every element is distinct enough to measure', () => {
    const c = corpus()
    expect(c.length, 'an empty corpus proves nothing').toBeGreaterThan(50)
    expect(new Set(c.map(digest)).size, 'every write produced the same blob — the corpus is inert')
      .toBeGreaterThan(10)
  })

  it('⛔ THE LITERAL. Regenerating it instead of investigating is the one thing you may not do', () => {
    // Generated ONCE, on the tree before this task's implementation, by printing
    // `digest(corpus().map(digest).join('|'))`. If it moves, a per-definition
    // door changed behaviour — that is a FINDING, not a number to refresh.
    expect(digest(corpus().map(digest).join('|'))).toBe('__FILL_FROM_STEP_9__')
  })
})
```

- [ ] **Step 9: Generate the literal on the PRE-CHANGE tree, then paste it**

The literal must predate the change or it is not a control.

```bash
cd C:/Users/Patrick/uct-worktrees/phase-b2-engine
git stash push -- app/src/components/chart/engine/instanceControls.js app/src/components/chart/engine/instances.js
```

⚠️ **`git stash` is banned by `lesson_git_stash_keep_index_mutation_harness` in a shared tree.** Do this instead — restore in place, never stash:

```bash
cd C:/Users/Patrick/uct-worktrees/phase-b2-engine
python -c "from pathlib import Path; import hashlib; \
p=Path('app/src/components/chart/engine/instanceControls.js'); b=p.read_bytes(); \
Path('instanceControls.js.mine').write_bytes(b); print(hashlib.sha256(b).hexdigest())"
python -c "from pathlib import Path; import hashlib; \
p=Path('app/src/components/chart/engine/instances.js'); b=p.read_bytes(); \
Path('instances.js.mine').write_bytes(b); print(hashlib.sha256(b).hexdigest())"
git show HEAD:app/src/components/chart/engine/instanceControls.js | python -c "import sys,pathlib; pathlib.Path('app/src/components/chart/engine/instanceControls.js').write_bytes(sys.stdin.buffer.read())"
git show HEAD:app/src/components/chart/engine/instances.js | python -c "import sys,pathlib; pathlib.Path('app/src/components/chart/engine/instances.js').write_bytes(sys.stdin.buffer.read())"
```

Now temporarily comment out the four new-door imports in the test file (they do not exist on the restored tree), run **only** the two equality cases, copy the printed digest into `__FILL_FROM_STEP_9__`, then restore your files byte-for-byte and re-verify the sha256s match what you printed:

```bash
python -c "from pathlib import Path; import hashlib; \
b=Path('instanceControls.js.mine').read_bytes(); \
Path('app/src/components/chart/engine/instanceControls.js').write_bytes(b); print(hashlib.sha256(b).hexdigest())"
python -c "from pathlib import Path; import hashlib; \
b=Path('instances.js.mine').read_bytes(); \
Path('app/src/components/chart/engine/instances.js').write_bytes(b); print(hashlib.sha256(b).hexdigest())"
rm instanceControls.js.mine instances.js.mine
```

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/perInstanceDoor.test.js`
Expected: **12 passed**, exit 0, with the literal filled in and matching on the POST-change tree.

- [ ] **Step 10: Name the new door in the control-door census**

`controlDoorCensus.test.js:175` asserts *every `setIndicatorEnabled` / `setIndicatorInput` call site is a KNOWN door*. The four new functions add no call sites yet (nothing imports them), but the census's own scan of `instanceControls.js` will see the new exports.

Run it first and read what it says:

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/controlDoorCensus.test.js`

If it is green, add the doors to its header list as **door 8, with zero call sites**, and add one assertion that says so — because "a door with no callers" is a state that must be *asserted* rather than assumed, and it is the state Tasks 4–6 will change:

```js
it('⭐ the per-INSTANCE door exists and has NO caller yet — Tasks 4-6 open it', () => {
  const perInstance = /\b(setInstanceHidden|setInstanceInput|removeInstance|addInstance)\s*\(/
  const callers = SHIPPED
    .filter(f => perInstance.test(f.src) && !f.file.endsWith('engine/instanceControls.js'))
    .map(f => f.file)
  expect(callers, 'a per-instance door gained a caller — update this census, do not delete it')
    .toEqual([])
})
```

If it is RED before your change, that is another agent's work — report it and do not fix it.

- [ ] **Step 11: Mutation — three, aimed at the load-bearing gates**

For each: **CONTROL A** = the unmutated file, run the selection, record `Tests N passed` with `N > 0` (abort if 0 or if the run collected nothing); apply the mutation by writing BYTES; re-run; record the exit code; restore the file and verify its sha256; **read WHY it died**.

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | In `removeInstance`, drop the `if (!next.some(...))` guard so the mirror is cleared unconditionally | *"the mirror lied: RSI still draws"* |
| M2 | In `newInstanceId`, count only LIVE instances (`isLiveInstance(i) &&`) so a tombstoned id is reused | *"newInstanceId is deterministic and skips a TOMBSTONED id"* |
| M3 | In `setInstanceInput`, drop the `validateInputValue` block | the `7.5` identity assertion |

⚠️ A mutation that produces the same digest is a **semantic no-op**, not a survivor. If one survives, work out which it is before calling it a hole.

- [ ] **Step 12: Full engine suite + commit**

Run: `cd app && npx vitest run src/components/chart/engine src/components/chart/indicatorRegistry.test.js src/components/chart/indicatorCatalog.test.js`
Expected: exit 0. Record the `Tests N passed` figure in the report.

```bash
git add app/src/components/chart/engine/__tests__/perInstanceDoor.test.js
git commit -m "feat(chart): the indicator write door addresses ONE instance, not a definition

The storage, the binder and the readout have always keyed on instanceId; only
the write door and the settings row were per-definition, which is what
setIndicatorEnabled's own docstring blames the per-definition tombstone on.

Four doors added and NO caller opened: findInstance, setInstanceHidden,
setInstanceInput, removeInstance, addInstance. The three existing doors are
byte-identical over a corpus of every preset x every definition, pinned by a
digest generated on the pre-change tree.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  app/src/components/chart/engine/instances.js \
  app/src/components/chart/engine/instanceControls.js \
  app/src/components/chart/engine/__tests__/perInstanceDoor.test.js \
  app/src/components/chart/engine/__tests__/controlDoorCensus.test.js
```

---

# Task 2: Every definition declares its chip

**Files:**
- Modify: `app/src/components/chart/engine/nativeRegistry.js` (nine definitions gain `plots[].legend`)
- Modify: `app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx` (totality rail + declared table)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: for Task 3, the guarantee that **every definition that binds a data plot yields at least one chip.** Task 3's strip is worthless without it.

**Why this is a task and not a line in Task 3.** [measured 2026-08-06] Nine of the seventeen definitions declare **no `legend` block at all** — `bb, vwap, mfi, cci, williamsR, adx, obv, donchian, avwap`. A user who adds MFI, CCI, Williams %R, ADX, OBV or Donchian gets **no label at any time, on any surface, hovering or not**. That is a strictly worse version of Wall 1 than the review recorded, and it is invisible to every test in the repo because `legendFromDefinitions.test.jsx`'s fixture enables only the six definitions that already have chips.

- [ ] **Step 1: Write the failing totality rail**

Add to `legendFromDefinitions.test.jsx` (append a new `describe` at the end):

```js
import * as engineRegistry from '../nativeRegistry'
import { dataPlots } from '../pool'

describe('⭐ EVERY definition that draws a line can name itself', () => {
  const chipPlots = (def) =>
    (def.plots || []).filter(p => p && p.legend && p.legend.hide !== true)

  it('the subject is not empty — the control', () => {
    const defs = engineRegistry.listDefinitions()
    expect(defs.length, 'no definitions — this case proves nothing').toBeGreaterThan(10)
    expect(defs.filter(d => dataPlots(d).length).length).toBeGreaterThan(10)
  })

  it('a definition that binds a data plot declares at least ONE chip', () => {
    const silent = engineRegistry.listDefinitions()
      .filter(d => dataPlots(d).length > 0 && chipPlots(d).length === 0)
      .map(d => d.id)
    expect(silent,
      'these definitions draw a line the user can never put a name to — declare plots[].legend')
      .toEqual([])
  })

  it('every declared chip has a PRIMARY plot behind it, so the chip names the main series', () => {
    for (const def of engineRegistry.listDefinitions()) {
      const chips = chipPlots(def)
      if (!chips.length) continue
      expect(chips.some(p => p.role === 'primary'), `${def.id}: every chip is on a secondary plot`)
        .toBe(true)
    }
  })
})
```

If `pool.js` does not export `dataPlots`, read `pool.js:609` — the filter is `(def.plots || []).filter(p => p && p.style !== 'hlines' && typeof p.key === 'string')`. Export it under that name (a one-word `export` on the existing function), or inline the predicate; do **not** re-implement it differently, because a helper that reimplements the logic instead of calling it is the mutation-harness failure this repo has already recorded.

- [ ] **Step 2: Run it — it must FAIL, naming nine ids**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx`
Expected: FAIL on case 2 listing `bb, vwap, mfi, cci, williamsR, adx, obv, donchian, avwap` (order is registry order). Case 1 and case 3 pass.

⚠️ If case 2 passes, the registry moved under you. Re-measure with the probe below and adjust the plan's list before continuing — do not weaken the assertion.

- [ ] **Step 3: Declare the nine chips**

Edit `app/src/components/chart/engine/nativeRegistry.js`. For each definition, add a `legend` block to its **primary** plot. The values below follow the shipped convention (`defSchema.js:147`): `decimals` is the CHIP's precision, not the price scale's; a percentage-scale oscillator prints 1, a price-scale series prints 2, a raw-count series prints 0.

| definition | plot key | `legend` block | why this precision |
|---|---|---|---|
| `bb` | `middle` | `legend: { label: 'BB', decimals: 2 }` | a price; the band edges stay `hide: true` — three numbers for one indicator is the readout regression `readout.js` warns about |
| `vwap` | the VWAP line plot | `legend: { decimals: 2 }` | a price |
| `mfi` | `mfi` | `legend: { decimals: 1 }` | 0–100, matching `rsi` |
| `cci` | `cci` | `legend: { decimals: 1 }` | unbounded oscillator, one decimal is the shipped RSI convention |
| `williamsR` | `williamsR` | `legend: { label: '%R', decimals: 1 }` | −100–0; `%R` matches `stoch`'s `%K`/`%D` labelling |
| `adx` | `adx` | `legend: { decimals: 1 }` | 0–100; `plusDI`/`minusDI` stay chip-less — the ADX line is the one a trader reads |
| `obv` | `obv` | `legend: { decimals: 0 }` | a cumulative SHARE COUNT; decimals on it are noise |
| `donchian` | `middle` (the basis) | `legend: { label: 'DC', decimals: 2 }` | a price; the channel edges stay chip-less for the same reason as `bb` |
| `avwap` | the AVWAP line plot | `legend: { decimals: 2 }` | a price |

**Read each definition before editing it.** The exact plot keys must come from the file, not from this table — `donchian`'s basis may be named `basis` rather than `middle`, and `vwap`/`avwap` each have one line plot whose key you must read. **Derive the key from the definition, do not type it**: if the key you edit does not exist, `defSchema` will not complain (a `legend` on a plot object you added by mistake is just a new plot), and the totality rail will still fail.

Add `legendParams` where the chip should carry the period — `meta.legendParams: ['period']` for `mfi`, `cci`, `williamsR`, `adx`, `obv`, and `['period', 'stdDev']` for `bb`, `['period']` for `donchian`. Read `atr`'s existing declaration for the shape; `chipLabel` (`readout.js:106`) resolves them against the instance's inputs and falls back to the declared defaults.

- [ ] **Step 4: Run the rail — it must PASS**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx`
Expected: exit 0. ⚠️ The pre-existing case *"renders exactly the nine chips the shipped legend rendered, character for character"* must **still pass** — its fixture enables only the six definitions that already had chips, so it is unaffected. If it fails, you edited a definition that fixture uses; revert that edit and report.

- [ ] **Step 5: Pin the new chips as a DECLARED table, not a count**

Add to the same `describe`:

```js
it('⭐ the nine newly-named definitions print what was DECLARED, not a default', () => {
  // A table, not a count: a count rots green when the registry grows, and a
  // failure that says "expected 17, got 18" tells the next reader nothing.
  const declared = {
    bb: 'BB', vwap: 'VWAP', mfi: 'MFI', cci: 'CCI', williamsR: '%R',
    adx: 'ADX', obv: 'OBV', donchian: 'DC', avwap: 'AVWAP',
  }
  for (const [defId, label] of Object.entries(declared)) {
    const def = engineRegistry.getDefinition(defId)
    const chip = (def.plots || []).find(p => p && p.legend && p.legend.hide !== true)
    expect(chip, `${defId}: declares no chip`).toBeTruthy()
    const rendered = chip.legend.label ?? (def.meta.shortName || def.id)
    expect(rendered, `${defId}: the chip reads "${rendered}", the decision was "${label}"`).toBe(label)
    expect(Number.isInteger(chip.legend.decimals), `${defId}: decimals not declared`).toBe(true)
  }
})
```

Fix the table to match what you actually declared (`shortName` may already be `BB`/`VWAP`, in which case no `label` is needed and the fallback path is what the assertion reads).

- [ ] **Step 6: Mutation — two**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | Delete `obv`'s new `legend` block | the totality rail, naming `obv` |
| M2 | Change `obv`'s `decimals` from 0 to 2 | the declared table |

M2 exists because M1 alone would survive a rail that only checked *presence somewhere*.

- [ ] **Step 7: Run the neighbours + commit**

Run: `cd app && npx vitest run src/components/chart/engine src/components/chart/indicatorCatalog.test.js`
Expected: exit 0.

```bash
git commit -m "feat(chart): the nine silent indicators declare their legend chip

MFI, CCI, Williams %R, ADX, OBV, Donchian, BB, VWAP and AVWAP drew a line the
user could never put a name to -- on any surface, hovering or not, because
readout.chipsFrom emits nothing for a plot with no legend block. Replaced the
absence with a totality rail: a definition that binds a data plot must declare
at least one chip.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  app/src/components/chart/engine/nativeRegistry.js \
  app/src/components/chart/engine/pool.js \
  app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx
```

---

# Task 3: The persistent chip strip

**Files:**
- Modify: `app/src/components/chart/engine/readout.js` (add `legendChips`)
- Modify: `app/src/components/StockChart.jsx` (`computeLatestCrosshair` at `:2007`, the crosshair builder at `:8586`, the legend render at `:10478`)
- Create: `app/src/components/chart/engine/__tests__/parityGateBlindness.test.js`
- Modify: `app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx` (hidden-instance assertion INVERTS)

**Interfaces:**
- Consumes: Task 2's guarantee that every drawing definition yields a chip.
- Produces, for Task 4:
  - `legendChips(bindings: object[], seriesData: Map|null, registry, instances: object[]) → Chip[]`
  - `Chip = { defId, plotKey, instanceId, label, color, decimals, value: number|null, hidden: boolean, text: string }`
  — `value` is `null` and `hidden` is `true` for a hidden instance; `text` is then the label alone.

**The measured seam.** `computeLatestCrosshair` (`StockChart.jsx:2007`) already builds the off-cursor legend and already ships everywhere `ChartPane` is mounted (12 modules) and on `/r/chart`. Its last line is `overlays, chips: EMPTY_CHIPS, compare: null` — with a comment stating *"the always-on legend has never printed an indicator value."* **That one field is the whole of Wall 1's display half.**

- [ ] **Step 1: Write the failing test for `legendChips`**

Add to `app/src/components/chart/engine/readout.test.js`:

```js
import { legendChips } from './readout'
import * as engineRegistry from './nativeRegistry'

describe('legendChips — a chip for every LIVE instance, hidden ones included', () => {
  const INSTANCES = [
    { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
    { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 },  hidden: true },
  ]
  const fakeSeries = {}
  const BINDINGS = [
    { defId: 'rsi', plotKey: 'rsi', instanceId: 'legacy:rsi', series: fakeSeries, lastValue: 54.321 },
  ]

  it('a BOUND instance prints its value off-cursor, from lastValue', () => {
    const chips = legendChips(BINDINGS, null, engineRegistry, INSTANCES)
    const bound = chips.find(c => c.instanceId === 'legacy:rsi')
    expect(bound.hidden).toBe(false)
    expect(bound.value).toBeCloseTo(54.321, 5)
    expect(bound.text).toBe('RSI(14) 54.3')
  })

  it('⭐ a HIDDEN instance still gets a chip — a chip you cannot see is one you cannot un-hide from', () => {
    const chips = legendChips(BINDINGS, null, engineRegistry, INSTANCES)
    const hidden = chips.find(c => c.instanceId === 'inst:rsi:1')
    expect(hidden, 'the hidden instance vanished from the strip').toBeTruthy()
    expect(hidden.hidden).toBe(true)
    expect(hidden.value).toBe(null)
    expect(hidden.text).toBe('RSI(7)')
    expect(hidden.color, 'a hidden chip must still wear its line colour').toBeTruthy()
  })

  it('the crosshair value WINS over lastValue when seriesData carries the point', () => {
    const map = new Map([[fakeSeries, { value: 71.05 }]])
    const chips = legendChips(BINDINGS, map, engineRegistry, INSTANCES)
    expect(chips.find(c => c.instanceId === 'legacy:rsi').text).toBe('RSI(14) 71.1')
  })

  it('a TOMBSTONE contributes nothing', () => {
    const chips = legendChips(BINDINGS, null, engineRegistry,
      [...INSTANCES, { instanceId: 'inst:rsi:2', deleted: true }])
    expect(chips.filter(c => c.instanceId === 'inst:rsi:2')).toEqual([])
  })
})
```

- [ ] **Step 2: Run it — it must FAIL**

Run: `cd app && npx vitest run src/components/chart/engine/readout.test.js`
Expected: FAIL — `legendChips is not a function`.

- [ ] **Step 3: Implement `legendChips`**

Append to `app/src/components/chart/engine/readout.js`:

```js
/**
 * The chips the LEGEND renders — one per *(live instance, chip-declaring plot)*.
 *
 * ⭐ IT IS NOT `engineChips`, AND THE DIFFERENCE IS THE HIDDEN INSTANCE.
 * `engineChips` walks BINDINGS, and `pool.planBindings` drops a hidden instance
 * (`pool.js:655`) so the binder can call `removeSeries` and give the pane back
 * (`__tests__/hiddenIsRemovedNotParked.test.js`). That is right for the RENDERER
 * and wrong for the READOUT: with no chip there is no surface to un-hide from,
 * and "Hide" becomes a one-way door.
 *
 * So this walks the INSTANCE LIST and looks a binding up per instance. A bound
 * instance gets its value (crosshair point, else `binding.lastValue`); a hidden
 * one gets `value: null`, `hidden: true` and the label alone.
 *
 * ONE FORMATTING PIPELINE, unchanged: label, colour and decimals still come out
 * of `plots[].legend` + `meta.legendParams` + the INSTANCE's inputs, through the
 * same two helpers `chipsFrom` uses. Nothing here formats a number a second way.
 *
 * @param {object[]} bindings `binder.bindings()`
 * @param {Map|null} seriesData `crosshairMove`'s map, or null when off-cursor
 * @param {object|Function} registry
 * @param {object[]} instances the normalised instance list, in stack order
 * @returns {{defId,plotKey,instanceId,label,color,decimals,value,hidden,text}[]}
 */
export function legendChips(bindings, seriesData, registry, instances) {
  const get = resolveRegistry(registry)
  const bound = new Map()
  for (const b of (Array.isArray(bindings) ? bindings : [])) {
    if (b && b.series && typeof b.instanceId === 'string') {
      bound.set(`${b.instanceId}::${b.plotKey}`, b)
    }
  }

  const out = []
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object' || typeof inst.instanceId !== 'string') continue
    // A tombstone has no defId by design; asking the registry about it would
    // only ever produce a misleading null.
    if (inst.deleted === true) continue
    const def = get(inst.defId)
    if (!def) continue
    const inputs = (inst.inputs && typeof inst.inputs === 'object') ? inst.inputs : {}

    for (const plot of (def.plots || [])) {
      if (!plot || !plot.legend || plot.legend.hide === true) continue
      const label = chipLabel(def, plot, inputs)
      const color = resolvePlotColor(plot, inputs, def)
      const decimals = Number.isInteger(plot.legend.decimals) ? plot.legend.decimals : DEFAULT_DECIMALS
      const b = bound.get(`${inst.instanceId}::${plot.key}`)

      let value = null
      if (b) {
        const point = seriesData && typeof seriesData.get === 'function' ? seriesData.get(b.series) : null
        let v = point ? point.value : undefined
        if (!Number.isFinite(v)) {
          const fb = b.lastValue
          if (typeof fb === 'function') { try { v = fb() } catch { v = undefined } }
          else v = fb
        }
        if (Number.isFinite(v)) value = v
      }

      out.push({
        defId: def.id,
        plotKey: plot.key,
        instanceId: inst.instanceId,
        label,
        color,
        decimals,
        value,
        hidden: inst.hidden === true,
        text: value === null ? label : `${label} ${value.toFixed(decimals)}`,
      })
    }
  }
  return out
}
```

- [ ] **Step 4: Run it — it must PASS**

Run: `cd app && npx vitest run src/components/chart/engine/readout.test.js`
Expected: exit 0, the four new cases green and every pre-existing `chipsFrom`/`engineChips` case still green (they are untouched — `legendChips` is additive).

- [ ] **Step 5: Wire both crosshair builders in `StockChart.jsx`**

**5a — the off-cursor builder.** In `computeLatestCrosshair` (`:2007`), replace the return's `chips: EMPTY_CHIPS` and its comment with:

```js
      // ⭐ THE CHIPS THE OFF-CURSOR LEGEND NOW PRINTS. This line read
      // `chips: EMPTY_CHIPS` with a comment saying "the always-on legend has
      // never printed an indicator value" — which was true, and was Wall 1's
      // display half in one field. `legendChips` walks the INSTANCE list (not the
      // bindings) so a hidden instance still gets a chip to un-hide from, and
      // takes its value from `binding.lastValue`, the binder's own record of the
      // final point it set. Wrapped because a disposed binder throwing here would
      // take the legend down; EMPTY_CHIPS is the honest fallback.
      overlays, chips: latestChips(), compare: null,
```

and add, immediately above `computeLatestCrosshair`:

```js
  /** The chips for the LAST bar — no crosshair, so no `seriesData`. */
  const latestChips = () => {
    try {
      const engine = engineRef.current
      if (!engine) return EMPTY_CHIPS
      const chips = legendChips(engine.binder.bindings(), null, engineRegistry, engineInstancesRef.current)
      return chips.length ? chips : EMPTY_CHIPS
    } catch { return EMPTY_CHIPS }
  }
```

⚠️ `engineInstancesRef` is declared at `:2159`, *below* this function. That is safe — `latestChips` is only ever CALLED from effects and handlers, long after every `useRef` in the component body has run — but do not "fix" it by moving the ref, which would change the declaration order the rest of the file depends on.

**5b — the on-cursor builder.** At `:8586`, swap `engineChips` for `legendChips` so the hovering legend and the off-cursor legend produce the same rows:

```js
      let chips = EMPTY_CHIPS
      try {
        const engine = engineRef.current
          ? legendChips(engineRef.current.binder.bindings(), param.seriesData,
              engineRegistry, engineInstancesRef.current)
          : EMPTY_CHIPS
        if (engine.length) chips = engine
      } catch { /* disposed mid-hover */ }
```

Update the import at `:72` to `import { engineChips, legendChips } from './chart/engine/readout'` — keep `engineChips` imported only if something still uses it; if nothing does, drop it from the import and leave the export in place (`readout.test.js` still covers it and `chipsFrom`'s second-source seam is documented as Phase C's server lane).

- [ ] **Step 6: Render the chips as a persistent strip**

At `:10478`, `legChips` currently maps `crosshairData.chips` into `[key, color, text]` triples rendered as inert `<span>`s in three layout branches. Replace the array build with:

```js
        // ⭐ ONE ROW PER CHIP, and the row is a COMPONENT now rather than a
        // <span>: it carries the hover controls (Task 4) and its own hidden and
        // error states. The comparison chip stays hand-written and stays LAST —
        // it is a SYMBOL overlay, not an indicator, and prints a signed
        // percentage no `plots[].legend` can express.
        //
        // `+N` COLLAPSE (spec §6): above CHIP_COLLAPSE_AT the tail folds into one
        // "+N" button that expands in place. The spec says "per pane"; the shipped
        // legend is ONE box for the whole chart (see the plan's deviation #2), so
        // the threshold is over the strip.
        const indChips = crosshairData.chips || EMPTY_CHIPS
        const overflow = !chipsExpanded && indChips.length > CHIP_COLLAPSE_AT
        const shownChips = overflow ? indChips.slice(0, CHIP_COLLAPSE_AT) : indChips
```

and in each of the three layout branches replace `{legChips.map(...)}` with:

```jsx
                {shownChips.map((c) => (
                  <IndicatorChip
                    key={`${c.instanceId}::${c.plotKey}`}
                    chip={c}
                    onToggleHidden={() => handleChipHidden(c.instanceId, !c.hidden)}
                    onOpenSettings={() => setSettingsInstanceId(c.instanceId)}
                    onRemove={() => handleChipRemove(c.instanceId)}
                    onMenu={(anchor) => setChipMenu({ anchor, instanceId: c.instanceId })}
                  />
                ))}
                {overflow && (
                  <button type="button" className={styles.chipMore}
                    onClick={() => setChipsExpanded(true)}
                    aria-label={`Show ${indChips.length - CHIP_COLLAPSE_AT} more indicators`}
                  >+{indChips.length - CHIP_COLLAPSE_AT}</button>
                )}
                {crosshairData.compare != null && compareSymbol && (
                  <span style={{ color: '#fb923c' }}>
                    {compareSymbol.toUpperCase()} {crosshairData.compare > 0 ? '+' : ''}{crosshairData.compare.toFixed(2)}%
                  </span>
                )}
```

In Task 3 the four handlers are **stubs that do nothing** — declare them as `() => {}` with a comment naming Task 4 — and `setChipMenu` / `setSettingsInstanceId` do not exist yet. **Do not render a control that writes nowhere**: in this task, pass **only** `chip` and render the chip as a labelled, non-interactive element. Task 4 adds the props and the handlers together, in one commit, so a control never exists without its writer.

Add near the other module constants (`:94`):

```js
/** Spec §7: ">4 chips collapses to +N". Four is the shipped number and it is a
 *  DESIGN constant, not a tuning knob — a fifth chip is where a 200px-wide
 *  strip starts middle-truncating labels. */
const CHIP_COLLAPSE_AT = 4
```

and `const [chipsExpanded, setChipsExpanded] = useState(false)` beside the other legend state.

- [ ] **Step 7: Create `IndicatorChip.jsx` (display only, this task)**

`app/src/components/chart/legend/IndicatorChip.jsx`:

```jsx
import styles from './IndicatorChip.module.css'

/**
 * ONE legend chip.
 *
 * ⛔ IT MUST RENDER INSIDE `StockChart`'s legend container, and that is not a
 * layout preference. `pages/ChartRender.jsx:527` injects
 * `#chart-export [class*="legend" i]{display:none !important}` into the parity
 * and newsletter-export route; the legend container's CSS-module class contains
 * "legend", so a chip inside it inherits the hide. A chip rendered as a SIBLING
 * would appear in every branded export the hand-made charts never carried, and
 * would move all 46 pixel-parity baselines at once.
 *
 * Presentational only: it holds no settings, reads no registry and writes
 * nothing. Every action is a prop.
 */
export default function IndicatorChip({ chip }) {
  return (
    <span
      className={`${styles.chip}${chip.hidden ? ' ' + styles.chipHidden : ''}`}
      style={{ color: chip.color }}
      data-instance-id={chip.instanceId}
      title={chip.text}
    >
      <span className={styles.chipText}>{chip.text}</span>
    </span>
  )
}
```

`IndicatorChip.module.css`:

```css
/* One line, 20px, middle-truncating at ~200px — spec §7's chip anatomy. */
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 20px;
  max-width: 200px;
  font: 600 11px 'Instrument Sans', sans-serif;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.chipText { overflow: hidden; text-overflow: ellipsis; }
/* GRAY = intentional (spec §6's colour language: red broken / amber degraded /
   gray intentional). A hidden indicator is not an error. */
.chipHidden { opacity: 0.45; }
```

- [ ] **Step 8: Invert the hidden-instance assertion, with the reason**

In `legendFromDefinitions.test.jsx`, the case *"a hidden instance emits no chip, and re-showing brings the same one back"* is now wrong. Replace its body (keep the file's style — read the surrounding cases first) with a case asserting the new contract, and put the reason in the test, not only in the commit:

```js
  it('⭐ a hidden instance DOES emit a chip now — you cannot un-hide from a chip that is gone', async () => {
    // This case asserted the OPPOSITE until the chart-UX-walls phase. `hidden`
    // is remove-and-rebind (`hiddenIsRemovedNotParked.test.js`), which is right
    // for the renderer and was wrong for the readout: with no chip there was no
    // surface carrying the eye toggle, so Hide was a one-way door reachable only
    // from the settings modal. The chip is now sourced from the INSTANCE LIST,
    // so a hidden instance renders dimmed, value-less and un-hideable-from.
    // …assert: the chip is present, carries no value, and is marked hidden.
  })
```

Write the real assertions against the rendered DOM in the same style as the neighbouring cases (they mount `StockChart` and read chip text).

- [ ] **Step 9: Prove the pixel gate is blind — so nobody later cites a 0 from it**

Create `app/src/components/chart/engine/__tests__/parityGateBlindness.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
//
// `tools/chart_parity.py` renders exactly one route, `/r/chart`, and that page
// injects a rule that hides the whole legend from the captured element. So the
// pixel gate cannot see a chip — not its text, not its controls, not its
// absence. A TOTAL REGRESSION OF THE CHIP SURFACE REPORTS 0 CHANGED PIXELS ON
// ALL 46 LIVE CASES.
//
// A 0 from an instrument that cannot fail is the shape this branch keeps
// finding. This test makes the blindness an ASSERTED FACT, so a future reader
// who runs the parity gate after touching the legend and sees 0 has something
// that tells them what that 0 is worth.
describe('the pixel gate cannot see the legend — asserted, not assumed', () => {
  const ROOT = (() => {
    let dir = process.cwd()
    for (let i = 0; i < 8; i++) {
      if (fs.existsSync(path.join(dir, 'app', 'src', 'pages', 'ChartRender.jsx'))) return dir
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
    throw new Error(`parity blindness: repo root not found from ${process.cwd()}`)
  })()

  const src = fs.readFileSync(
    path.join(ROOT, 'app', 'src', 'pages', 'ChartRender.jsx'), 'utf8')

  it('the export route hides every element whose class contains "legend"', () => {
    // Single-line match on purpose: this repo is CRLF and a multi-line `\n`
    // anchor matches ZERO.
    expect(src).toMatch(/#chart-export \[class\*="legend" i\]\{display:none !important\}/)
  })

  it('…and re-shows ONLY the volume legend — the control that the rule is narrow', () => {
    expect(src).toMatch(/#chart-export \[class\*="volLegend" i\]\{display:flex !important\}/)
  })

  it('⛔ so the chip strip must stay INSIDE the legend container', () => {
    // If the chip were a sibling of the legend it would survive the hide, appear
    // in every branded newsletter export, and move all 46 parity baselines.
    const chart = fs.readFileSync(
      path.join(ROOT, 'app', 'src', 'components', 'StockChart.jsx'), 'utf8')
    const legendBlock = chart.slice(chart.indexOf('ref={legendRef}'))
    const chipAt = legendBlock.indexOf('<IndicatorChip')
    const legendCloses = legendBlock.indexOf('})()}')
    expect(chipAt, 'IndicatorChip is not rendered inside the legend container').toBeGreaterThan(0)
    expect(chipAt).toBeLessThan(legendCloses)
  })
})
```

⚠️ The third case slices source by **string search**, not by line number — a co-worker inserting lines above `legendRef` must not break it. If the anchors move, re-derive them from the file; do not pin line numbers.

- [ ] **Step 10: Run it — the first two must PASS immediately**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/parityGateBlindness.test.js`
Expected: exit 0, 3 passed.

If case 1 or 2 fails, the export route changed — **that is a finding**: the branded export may now be carrying the legend. Report it before proceeding.

- [ ] **Step 11: Mutation — three**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | In `legendChips`, `continue` when `inst.hidden === true` | the hidden-chip case in `readout.test.js` AND the inverted case in `legendFromDefinitions.test.jsx` — **check that BOTH died**; if only one does, the DOM-level contract is untested |
| M2 | In `computeLatestCrosshair`, restore `chips: EMPTY_CHIPS` | the off-cursor DOM case |
| M3 | Change `CHIP_COLLAPSE_AT` from 4 to 99 | the `+N` case |

- [ ] **Step 12: Full frontend run + commit**

Because `app/src` changed, the ~10-minute suite is owed. Build first (`liveStyles.dist.test.js` reads `app/dist`), and **only if no other agent is running vitest**:

Run: `cd app && npm run build && npx vitest run`
Expected: exit 0 apart from any red another agent owns — identify each by `git log -1 --format=%h -- <its file>` before calling it yours. `app/src/pages/calendar/Calendar.realModal.test.jsx` is a known wall-clock flake: run it standalone 3× before calling it a regression.

```bash
git add app/src/components/chart/legend/IndicatorChip.jsx \
        app/src/components/chart/legend/IndicatorChip.module.css \
        app/src/components/chart/engine/__tests__/parityGateBlindness.test.js
git commit -m "feat(chart): the indicator legend is persistent, and a hidden instance keeps its chip

computeLatestCrosshair shipped `chips: EMPTY_CHIPS` on every ChartPane surface
and on /r/chart, with a comment saying the always-on legend had never printed an
indicator value. It does now, off binding.lastValue.

legendChips walks the INSTANCE list rather than the bindings, so a hidden
instance renders dimmed and value-less instead of vanishing -- a chip you cannot
see is a chip you cannot un-hide from.

The pixel gate is BLIND to all of this: ChartRender hides every .legend element
from the captured export, so a total regression reports 0 changed pixels.
parityGateBlindness.test.js asserts that, so a future 0 cannot be cited.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  app/src/components/chart/engine/readout.js \
  app/src/components/chart/engine/readout.test.js \
  app/src/components/StockChart.jsx \
  app/src/components/chart/legend/IndicatorChip.jsx \
  app/src/components/chart/legend/IndicatorChip.module.css \
  app/src/components/chart/engine/__tests__/parityGateBlindness.test.js \
  app/src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx
```

---

# Task 4: Chip controls — hover row and `ContextPopover`

**Files:**
- Create: `app/src/components/chart/legend/chipMenu.js`, `chipMenu.test.js`
- Create: `app/src/components/chart/legend/IndicatorChip.test.jsx`
- Modify: `app/src/components/chart/legend/IndicatorChip.jsx`, `IndicatorChip.module.css`
- Modify: `app/src/components/StockChart.jsx` (handlers + `ContextPopover` mount + `Add alert on …` in the region menu at `:2432`)
- Modify: `app/src/components/chart/engine/__tests__/controlDoorCensus.test.js`

**Interfaces:**
- Consumes: Task 1's `setInstanceHidden` / `removeInstance`; Task 3's `Chip` shape and `IndicatorChip`.
- Produces, for Task 5: `onOpenSettings(instanceId)` fires with a live instance id; Task 5 mounts the dialog on it.
- `chipMenuItems(chip, def, handlers) → { key, label, icon, danger?, disabled?, separator?, onClick }[]` — six rows plus separators, in spec §6's order: **Settings · Hide/Show · Move · Alerts · About · Remove**.

**Shipped primitives — reuse, do not rebuild.** `ContextPopover` (`app/src/components/mobile/ContextPopover.jsx`) is already a bottom sheet on touch and an anchored menu on desktop, with 44px rows, focus handling, outside-click and Escape. `useLongPress` (`app/src/components/mobile/useLongPress.js`) accepts a right-click on desktop, so ONE binding serves both inputs. `useBreakpoint`/`useIsTouch` is consumed *inside* `ContextPopover`, after `open` — which is the only safe use of a hook that is stale at first paint. **Do not design new primitives; §6's touch mapping names these three.**

- [ ] **Step 1: Write the failing tests for `chipMenu`**

`app/src/components/chart/legend/chipMenu.test.js`:

```js
import { describe, it, expect, vi } from 'vitest'
import { chipMenuItems } from './chipMenu'
import * as engineRegistry from '../engine/nativeRegistry'

const chip = (over = {}) => ({
  defId: 'rsi', plotKey: 'rsi', instanceId: 'legacy:rsi',
  label: 'RSI(14)', color: '#7b68ef', decimals: 1, value: 54.3, hidden: false,
  text: 'RSI(14) 54.3', ...over,
})
const handlers = () => ({
  onSettings: vi.fn(), onToggleHidden: vi.fn(), onMove: vi.fn(),
  onAlerts: vi.fn(), onAbout: vi.fn(), onRemove: vi.fn(),
})

describe('chipMenuItems — spec §6\'s six rows, from ONE source', () => {
  it('offers exactly the six actions, in the declared order', () => {
    const items = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), handlers())
      .filter(i => !i.separator)
    expect(items.map(i => i.key))
      .toEqual(['settings', 'hidden', 'move', 'alerts', 'about', 'remove'])
  })

  it('the Hide row states which way it goes — a toggle labelled "Hide" on a hidden chip is a lie', () => {
    const shown = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), handlers())
    const hidden = chipMenuItems(chip({ hidden: true }), engineRegistry.getDefinition('rsi'), handlers())
    expect(shown.find(i => i.key === 'hidden').label).toBe('Hide RSI(14)')
    expect(hidden.find(i => i.key === 'hidden').label).toBe('Show RSI(14)')
  })

  it('Remove is the only danger row', () => {
    const items = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), handlers())
    expect(items.filter(i => i.danger).map(i => i.key)).toEqual(['remove'])
  })

  it('⛔ Move offers only targets validateInstance ACCEPTS, and says why the others are absent', () => {
    const items = chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), handlers())
    const move = items.find(i => i.key === 'move')
    expect(move.submenu.map(s => s.target)).toEqual(['price', 'pane', 'volume'])
    // The CURRENT target is checked, never offered as a destination that does nothing.
    expect(move.submenu.find(s => s.target === 'pane').checked).toBe(true)
  })

  it('a PRICE-target definition cannot be moved to the volume pane', () => {
    const bb = engineRegistry.getDefinition('bb')
    const items = chipMenuItems(chip({ defId: 'bb', instanceId: 'legacy:bb' }), bb, handlers())
    const vol = items.find(i => i.key === 'move').submenu.find(s => s.target === 'volume')
    expect(vol.disabled, 'a price overlay in the volume pane is not a placement the binder resolves')
      .toBeTruthy()
  })

  it('every row calls its handler with the INSTANCE id, never the defId', () => {
    const h = handlers()
    for (const item of chipMenuItems(chip(), engineRegistry.getDefinition('rsi'), h).filter(i => i.onClick)) {
      item.onClick()
    }
    for (const fn of [h.onSettings, h.onToggleHidden, h.onAlerts, h.onAbout, h.onRemove]) {
      expect(fn).toHaveBeenCalledWith('legacy:rsi')
    }
  })
})
```

- [ ] **Step 2: Run — must FAIL** (`chipMenuItems is not a function`)

Run: `cd app && npx vitest run src/components/chart/legend/chipMenu.test.js`

- [ ] **Step 3: Implement `chipMenu.js`**

```js
// app/src/components/chart/legend/chipMenu.js
//
// PURE. No React, no chart, no registry import — the definition is passed in, so
// this file names no indicator and cannot become an enumeration site in the
// phase that exists to end them.
//
// ⛔ EVERY HANDLER TAKES AN INSTANCE ID. A chip is per instance; a handler taking
// a defId would hide, remove or open the settings of the WRONG RSI the moment a
// second one exists, and would do it silently.

/** The placement targets `instances.validateInstance` accepts (`PLACEMENT_TARGETS`).
 *  Kept as labels here and as the raw values in `target`, so the menu can never
 *  offer a placement the validator would reject. */
const MOVE_TARGETS = [
  { target: 'price',  label: 'Price pane' },
  { target: 'pane',   label: 'Its own pane' },
  { target: 'volume', label: 'Volume pane' },
]

export function chipMenuItems(chip, def, h) {
  const declared = (def && def.placement && def.placement.target) || 'pane'
  const current = chip.placementTarget || declared
  return [
    { key: 'settings', label: 'Settings…', icon: 'gear', onClick: () => h.onSettings(chip.instanceId) },
    { key: 'hidden', label: `${chip.hidden ? 'Show' : 'Hide'} ${chip.label}`, icon: 'eye',
      onClick: () => h.onToggleHidden(chip.instanceId) },
    { key: 'move', label: 'Move to', icon: 'expand',
      submenu: MOVE_TARGETS.map(t => ({
        ...t,
        checked: t.target === current,
        // ⛔ A price overlay draws on the CANDLES' own scale (`placement.js:324`),
        // so it has no band to move into a pane and no left axis in the volume
        // pane. `resolvePlacement` returns null for the combination, which means
        // the instance would bind NOTHING — an indicator that silently vanishes.
        disabled: declared === 'price' && t.target !== 'price'
          ? 'a price overlay draws on the price scale' : undefined,
        onClick: () => h.onMove(chip.instanceId, t.target),
      })) },
    { key: 'alerts', label: 'Add alert…', icon: 'bell', onClick: () => h.onAlerts(chip.instanceId) },
    { key: 'about', label: `About ${def && def.meta ? def.meta.name : chip.defId}`, icon: 'info',
      onClick: () => h.onAbout(chip.instanceId) },
    { separator: true },
    { key: 'remove', label: 'Remove', icon: 'trash', danger: true,
      onClick: () => h.onRemove(chip.instanceId) },
  ]
}
```

Run: `cd app && npx vitest run src/components/chart/legend/chipMenu.test.js` — expect exit 0.

⚠️ Case 6 iterates `.filter(i => i.onClick)` — the `move` row has no `onClick`, only submenu entries. Adjust the test to assert `onMove` through the submenu rather than weakening the assertion.

- [ ] **Step 4: Write the failing chip-interaction tests**

`app/src/components/chart/legend/IndicatorChip.test.jsx` — mount the chip alone and assert:
1. desktop: the eye / gear / × controls are **present in the DOM at all times** and revealed by CSS on hover (`.hoverReveal`-style), **not** conditionally rendered off a JS hook — assert `container.querySelectorAll('button').length === 3` without any hover event, and assert the module CSS contains an `:hover` rule for `.chipControls`;
2. clicking the eye calls `onToggleHidden` once, with no other handler called;
3. clicking the gear calls `onOpenSettings`;
4. clicking × calls `onRemove`;
5. a `contextmenu` event calls `onMenu` with an `{x, y}` anchor;
6. every control has an `aria-label` naming the chip (`Hide RSI(14)`, not `Hide`);
7. every control is at least 44×44 CSS px under the touch media query — assert the CSS module declares `min-width: var(--tap-min)` inside `@media (max-width:1024px)`.

Point 1 is the one that matters: **conditional rendering off `useIsTouch()` would render the desktop variant on a phone at first paint**, which is the documented `useMediaQuery` staleness trap.

- [ ] **Step 5: Implement the controls in `IndicatorChip.jsx`**

Add a `<span className={styles.chipControls}>` after `chipText`, holding three `<button>`s with `UIcon` glyphs `eye`, `gear`, `x` (all three names exist in the registry), each with an `aria-label` built from `chip.label`. Bind `useLongPress(onMenu)` on the chip root so a long-press on touch and a right-click on desktop both open the menu through one binding. Reveal on hover via CSS only:

```css
.chipControls { display: inline-flex; gap: 2px; opacity: 0; transition: opacity 150ms ease-out; }
.chip:hover .chipControls, .chip:focus-within .chipControls { opacity: 1; }
/* Touch has no hover: the controls are always visible and 44px, and the
   collapse-to-dots rule below the phone breakpoint hides the TEXT, never the
   control. CSS @media, never useIsTouch() — that hook is stale at first paint. */
@media (max-width: 1024px) {
  .chipControls { opacity: 1; }
  .chipControls button { min-width: var(--tap-min); min-height: var(--tap-min); }
}
@media (max-width: 640px) {
  .chipText { max-width: 0; }
  .chip::before { content: ''; width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
}
```

- [ ] **Step 6: Wire the handlers and the popover in `StockChart.jsx`**

Add state and handlers near the legend state, and mount `ContextPopover` **outside** the legend container (a menu is not part of the export frame, and `ContextPopover` portals anyway):

```jsx
  const [chipMenu, setChipMenu] = useState(null)          // {anchor, instanceId}
  const [settingsInstanceId, setSettingsInstanceId] = useState(null)  // Task 5 mounts on this

  /** ⭐ ONE WRITER. Every chip action routes at `instanceControls`, the same
   *  module the toolbar checkbox, both right-click doors, the four keyboard
   *  chords, the generated settings rows and the voice bus already share. A
   *  refused write returns the settings object BY IDENTITY, so nothing persists. */
  const writeInstance = useCallback((next) => {
    if (next !== cs) handleUpdateChartSettings({ ...next, preset: 'custom' })
  }, [cs, handleUpdateChartSettings])

  const handleChipHidden = useCallback((instanceId, hidden) => {
    writeInstance(setInstanceHidden(cs, instanceId, hidden, engineRegistry))
  }, [cs, writeInstance])

  const handleChipRemove = useCallback((instanceId) => {
    writeInstance(removeInstance(cs, instanceId, engineRegistry))
  }, [cs, writeInstance])

  const handleChipMove = useCallback((instanceId, target) => {
    const list = (cs.indicatorInstances || []).map(i =>
      (i && i.instanceId === instanceId) ? { ...i, placement: { ...(i.placement || {}), target } } : i)
    writeInstance({ ...cs, indicatorInstances: list })
  }, [cs, writeInstance])
```

Render the menu:

```jsx
      {chipMenu && (() => {
        const chip = (crosshairData?.chips || EMPTY_CHIPS)
          .find(c => c.instanceId === chipMenu.instanceId)
        if (!chip) return null
        return (
          <ContextPopover
            open
            onClose={() => setChipMenu(null)}
            anchor={chipMenu.anchor}
            title={chip.label}
            items={chipMenuItems(chip, engineRegistry.getDefinition(chip.defId), {
              onSettings: (id) => { setChipMenu(null); setSettingsInstanceId(id) },
              onToggleHidden: (id) => { setChipMenu(null); handleChipHidden(id, !chip.hidden) },
              onMove: (id, t) => { setChipMenu(null); handleChipMove(id, t) },
              onAlerts: () => { setChipMenu(null); setAlertPopoverOpen(true) },
              onAbout: (id) => { setChipMenu(null); setAboutInstanceId(id) },
              onRemove: (id) => { setChipMenu(null); handleChipRemove(id) },
            })}
          />
        )
      })()}
```

`setAlertPopoverOpen` and `setAboutInstanceId`: read how the toolbar currently opens `IndicatorAlertPopover` (`ChartToolbar.jsx:7`) — the popover is mounted by `ChartToolbar`, which `StockChart` renders, so route the chip's Alerts row through the existing prop rather than mounting a second popover. If no prop exists, **add one prop and one only**; do not duplicate the popover. **About** in v1 renders `def.meta.description` inside the same `ContextPopover` as a second page — it is a string that already exists on every definition and needs no new data.

**Also add the region-menu row** at `StockChart.jsx:2432`, beside `Hide <label>` and `<label> settings…`:

```js
        { id: 'i-alert', label: `Add alert on ${label}…`, onSelect: () => setAlertPopoverOpen(true) },
```

- [ ] **Step 7: Run the interaction tests**

Run: `cd app && npx vitest run src/components/chart/legend src/components/chart/engine/__tests__/legendFromDefinitions.test.jsx src/components/chart/engine/__tests__/stockChartWiring.test.jsx`
Expected: exit 0.

- [ ] **Step 8: Update the control-door census — door 8 is now OPEN**

Task 1 asserted the per-instance door had **no** caller. Invert that case with the reason, and add `StockChart.jsx` to the census's known-door list as **door 8 — the legend chip**. Read `controlDoorCensus.test.js:174-210` first and follow its existing shape (it derives call sites from comment-stripped source via `sourceScan.js` — a raw scan would read the prose in this plan's own comments as doors).

- [ ] **Step 9: Mutation — three**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | In `handleChipRemove`, call `setIndicatorEnabled(cs, chip.defId, false, …)` instead of `removeInstance` | ⚠️ **this will SURVIVE today**, because only one instance per definition exists. That is the finding, not a failure: write the kill into Task 6, where a second instance exists, and record here that the guard is currently untestable. Do **not** invent a fake two-instance blob to make it die — a mutation killed by a fixture the product cannot produce proves nothing about the product. |
| M2 | Delete the `if (next !== cs)` identity guard in `writeInstance` | a case asserting that a refused write (e.g. Move to an invalid target) calls `handleUpdateChartSettings` zero times |
| M3 | In `IndicatorChip`, render the controls only when `useIsTouch()` is false | the always-in-the-DOM assertion from Step 4 |

M1's honesty is the point: **state in the report that the per-instance remove is unproven until Task 6**, and make Task 6 Step 9 carry the kill.

- [ ] **Step 10: Commit**

```bash
git add app/src/components/chart/legend/chipMenu.js \
        app/src/components/chart/legend/chipMenu.test.js \
        app/src/components/chart/legend/IndicatorChip.test.jsx
git commit -m "feat(chart): legend chips carry their own controls

Hover -> eye/gear/x; right-click or long-press -> ContextPopover with Settings,
Hide, Move, Alerts, About, Remove as 44px rows. All six shipped primitives
(ContextPopover, Sheet, useLongPress) reused per spec §6's touch mapping; the
hover reveal is CSS, never useIsTouch(), which is stale at first paint.

Every action routes at instanceControls' per-INSTANCE door and names an
instanceId. Move offers only the three targets validateInstance accepts and
disables the ones resolvePlacement returns null for, because an unresolvable
placement binds nothing and the indicator silently vanishes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  app/src/components/chart/legend/ \
  app/src/components/StockChart.jsx \
  app/src/components/chart/engine/__tests__/controlDoorCensus.test.js
```

---

# Task 5: The per-instance settings dialog

**Files:**
- Create: `app/src/components/chart/IndicatorSettingsDialog.jsx`, `.module.css`, `.test.jsx`
- Modify: `app/src/components/StockChart.jsx` (mount on `settingsInstanceId`)
- Modify: `app/src/components/chart/indicatorRegistry.js` (export a per-instance field builder)

**Interfaces:**
- Consumes: Task 1's `setInstanceInput` / `setInstanceHidden` / `findInstance`; Task 4's `settingsInstanceId`.
- Produces: nothing later depends on it, which is why it can land here.

**What already works and must be reused.** `fieldsFromDefinition(def)` (`indicatorRegistry.js:202`) turns declared inputs into control descriptors — `{key, label, type: 'number'|'color'|'toggle'|'select', min, max, step, options}` — in **declaration order**, and `ChartSettingsModal` already renders exactly those four control types. **The generation is the good part; the container is missing.** Do not write a second generator.

- [ ] **Step 1: Write the failing dialog tests**

`app/src/components/chart/IndicatorSettingsDialog.test.jsx`. Each case names a §6 clause:

```js
describe('IndicatorSettingsDialog — spec §6\'s settings form, per INSTANCE', () => {
  // 1. THREE TABS, in order.
  it('renders Inputs / Style / Visibility as tabs, Inputs first')

  // 2. ONE INPUT PER ROW, label left / control right.
  it('every declared input of the definition reaches a row, in declaration order')

  // 3. `inline` PACKS <=3 SAME-TYPE.
  it('three same-type inputs sharing an `inline` group render on ONE row; a fourth wraps')

  // 4. LIVE-APPLY.
  it('typing a period and blurring calls onChange with the INSTANCE updated')

  // 5. 250ms DEBOUNCE.
  it('three keystrokes inside 250ms produce ONE onChange, and it carries the LAST value')

  // 6. NUMERIC COMMIT ON BLUR/ENTER, WITH VISIBLE CLAMPING.
  it('a period above the declared max commits CLAMPED and the input SHOWS the clamped value')
  it('…and the clamp is announced, not silent: the row carries a role="status" saying max is N')

  // 7. CANCEL-ROLLBACK VIA SNAPSHOT-ON-OPEN.
  it('Cancel restores the settings object the dialog opened with, BYTE for byte')

  // 8. `activeWhen` DIMS, NEVER REMOVES.
  it('an input whose activeWhen is false is disabled and still in the DOM')

  // 9. 70vh MAX-HEIGHT + COLLAPSIBLE GROUPS.
  it('the body declares max-height:70vh in the module CSS')
  it('a definition with two `group`s renders two collapsible sections')

  // 10. FOCUS TRAP + TAB ORDER + ARIA.
  it('Tab from the last control returns to the first')
  it('every control has an accessible name from its label, and its tooltip as aria-describedby')

  // 11. THE STYLE TAB EDITS legend.decimals, NOT plots[].precision.
  it('the Style tab\'s Precision control writes the chip decimals and the chip text follows')

  // 12. PER INSTANCE.
  it('opening on inst:rsi:1 shows THAT instance\'s period, not its sibling\'s')
})
```

Write real bodies for all twelve. Case 7 is the task's real gate — a byte equality:

```js
  it('Cancel restores the settings object the dialog opened with, BYTE for byte', async () => {
    const before = JSON.stringify(cs)
    render(<IndicatorSettingsDialog open instanceId="legacy:rsi" settings={cs}
             onChange={setCs} onClose={close} registry={engineRegistry} />)
    await user.clear(screen.getByLabelText('Length'))
    await user.type(screen.getByLabelText('Length'), '7')
    await act(() => new Promise(r => setTimeout(r, 300)))   // past the debounce
    expect(JSON.stringify(latest())).not.toBe(before)        // ⭐ the positive control
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(JSON.stringify(latest())).toBe(before)
  })
```

⚠️ The `not.toBe(before)` line is not decoration: without it, a dialog that wrote *nothing at all* would pass the rollback assertion. **A test that cannot observe the change it rolls back is a gate that cannot fail.**

- [ ] **Step 2: Run — must FAIL** (module not found)

- [ ] **Step 3: Implement the dialog**

Structure, in `Sheet variant="auto"` so it is a centred modal on desktop and fullscreen on phone (§6's touch mapping, and `Sheet` already ships focus-trap, Escape, body-scroll-lock and safe-area):

```jsx
export default function IndicatorSettingsDialog({ open, instanceId, settings, onChange, onClose, registry }) {
  // ⭐ SNAPSHOT ON OPEN — the whole of Cancel-rollback. Taken once, on the
  // transition to open, NOT on every render: a snapshot refreshed while the user
  // types is a snapshot of their edits, and Cancel would restore them.
  const snapshotRef = useRef(null)
  useEffect(() => { if (open && !snapshotRef.current) snapshotRef.current = settings
                    if (!open) snapshotRef.current = null }, [open, settings])
  ...
}
```

Key implementation notes, each answering a §6 clause:
- **Debounce**: hold the raw control value in local state, and push through `setInstanceInput` on a 250ms trailing timer. ⚠️ **The timer callback must read the latest value from a ref, not from the closure** — `feedback_tiptap_onupdate_stale_closure` is the recorded version of this bug in this repo.
- **Commit on blur/Enter with visible clamping**: on blur/Enter, clamp to `[min, max]` from the declared input, **write the clamped value back into the control** so the user sees what was stored, and render a `role="status"` line. A silent clamp is a control changing the number the user typed.
- **`activeWhen`**: `disabled` + `aria-disabled`, never unmounted. Read `defSchema` for the field's exact name and shape before implementing; if no definition declares one yet, ship the branch **and** a test using a hand-built definition, and say in the test that no shipped definition exercises it.
- **Visibility tab**: §6 marks it *"deferred to C"*. C has shipped, and the honest v1 content is the two visibility facts the instance already carries — `hidden` (the eye) and `placement.target` (the Move). Render those two; do not invent per-timeframe visibility, which needs `meta.timeframes` semantics no instance stores.
- **Style tab**: the definition's `color`, `width` and `lineStyle` **inputs** (which `pool.resolvePlotForInstance` already resolves per instance through `$refs`) plus the chip **`legend.decimals`**. Do **not** introduce `styleOverrides`.

- [ ] **Step 4: Mount it in `StockChart.jsx`**

```jsx
      {settingsInstanceId && (
        <IndicatorSettingsDialog
          open
          instanceId={settingsInstanceId}
          settings={cs}
          registry={engineRegistry}
          onChange={(next) => { if (next !== cs) handleUpdateChartSettings({ ...next, preset: 'custom' }) }}
          onClose={() => setSettingsInstanceId(null)}
        />
      )}
```

**Re-point `<label> settings…`** in the region right-click menu (`:2434`) from the global modal to this dialog, resolving the region's `defId` to its first live instance via `findInstance` over the instance list. Leave the global modal's Indicators tab exactly as it is — it is the "manage everything" surface and Task 6 makes its rows per-instance.

- [ ] **Step 5: Run the dialog tests — must PASS**

Run: `cd app && npx vitest run src/components/chart/IndicatorSettingsDialog.test.jsx`
Expected: 12+ passed, exit 0.

- [ ] **Step 6: Mutation — three**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | Move the snapshot out of the open-transition guard so it refreshes every render | the byte-equality rollback case |
| M2 | Drop the clamp write-back (clamp on commit but leave the input showing what was typed) | the "input SHOWS the clamped value" case |
| M3 | Read the debounced value from the closure instead of the ref | the "three keystrokes → one onChange carrying the LAST value" case |

- [ ] **Step 7: Full run + commit**

Run: `cd app && npm run build && npx vitest run src/components/chart src/components/StockChart*`
Expected: exit 0.

```bash
git add app/src/components/chart/IndicatorSettingsDialog.jsx \
        app/src/components/chart/IndicatorSettingsDialog.module.css \
        app/src/components/chart/IndicatorSettingsDialog.test.jsx
git commit -m "feat(chart): a three-tab settings dialog per INSTANCE

'RSI settings...' opened the GLOBAL five-tab modal. It now opens Inputs/Style/
Visibility scoped to one instance, generated from fieldsFromDefinition -- the
same generator the settings tab already uses, in the container spec §6 asked
for: live-apply, Cancel-rollback from a snapshot taken once on open, 250ms
debounce, numeric commit on blur/Enter with the clamped value written back
where the user can see it, activeWhen dimming rather than removing, 70vh.

The Style tab edits legend.decimals (the chip's) and never plots[].precision
(the price scale's) -- defSchema:147 records why those are two numbers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  app/src/components/chart/IndicatorSettingsDialog.jsx \
  app/src/components/chart/IndicatorSettingsDialog.module.css \
  app/src/components/chart/IndicatorSettingsDialog.test.jsx \
  app/src/components/chart/indicatorRegistry.js \
  app/src/components/StockChart.jsx
```

---

# Task 6: Two RSIs — the duplicate, and the settings rows go per-instance

**Files:**
- Modify: `app/src/components/chart/indicatorRegistry.js` (`listEngineIndicators` + `applyRowPatch` per instance)
- Modify: `app/src/components/chart/IndicatorLibraryDialog.jsx` (an "Add another" row)
- Modify: `app/src/components/chart/legend/chipMenu.js` (a "Duplicate" row)
- Modify: `tools/chart_parity_cases.json` (one new case)
- Modify: `app/src/components/chart/engine/__tests__/perInstanceDoor.test.js` (Task 4's M1 kill lands here)

**Interfaces:**
- Consumes: Task 1's `addInstance`, Task 3's chips, Task 5's dialog.
- Produces: `IndicatorAlertPopover`'s Instance dropdown (`:370`, gated on `addressInstances.length > 1`) becomes reachable — which is what Task 7 needs.

**The pane fact, decided and stated.** `orderedPaneKeys` dedupes by `defId` (`paneLayout.js:277`) and `resolvePlacement` resolves `const key = def.id` (`placement.js:337`). **Two RSI instances therefore share one pane and one 0–100 axis.** That is the right v1 answer — RSI(7) and RSI(14) belong on one scale — and it means the duplicate needs **zero** change to `paneLayout`, `placement`, `binder` or `pool`. It also means **"move RSI(7) into its own pane" is not expressible**, and the Move submenu already says so. Do not make pane keys instance-scoped in this task: that vocabulary reaches `bands`, `paneLayout.panes[].key`, the right-click `region.key`, `volumeOverlayIndicators` and the pane manifest the pixel gate diffs.

- [ ] **Step 1: Write the failing two-instance render test**

Add to `stockChartWiring.test.jsx` (read its existing mount helpers first — it already mounts `StockChart` with `barsOverride` and `settingsOverride`):

```js
it('⭐ TWO RSIs at different periods draw two lines, in ONE pane, with TWO chips', async () => {
  const view = render(<StockChart sym="AAPL" tf="D" barsOverride={BARS} alwaysShowLegend
    settingsOverride={{ indicatorInstances: [
      { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, hidden: false },
      { instanceId: 'inst:rsi:1', defId: 'rsi', inputs: { period: 7 },  hidden: false },
    ] }} />)
  await waitFor(() => expect(chipTexts(view).length).toBeGreaterThan(0))
  const labels = chipTexts(view).map(t => t.split(' ')[0])
  expect(labels).toContain('RSI(14)')
  expect(labels).toContain('RSI(7)')
  // ⛔ ONE pane, not two: a pane key is a defId.
  expect(paneCount(view)).toBe(paneCountWithOneRsi)
})
```

- [ ] **Step 2: Run — the chips must ALREADY pass; the pane count is the new information**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/stockChartWiring.test.jsx -t 'TWO RSIs'`

If the chips already render (they should — Tasks 1–3 made that true), record it: **the renderer needed nothing.** If the pane count is 2, the premise in the header is wrong and `orderedPaneKeys` changed under you — stop and report.

- [ ] **Step 3: Write the failing tests for per-instance settings rows**

In `app/src/components/chart/engine/__tests__/generatedSettingsRows.test.jsx`:

```js
it('⭐ with TWO instances of one definition there are TWO rows, each naming its instance', () => {
  const rows = listAllIndicators(csWithTwoRsi, engineRegistry, {})
    .filter(r => r.defId === 'rsi')
  expect(rows.map(r => r.instanceId)).toEqual(['legacy:rsi', 'inst:rsi:1'])
  expect(rows[0].values.period).toBe(14)
  expect(rows[1].values.period).toBe(7)
})

it('…and editing the SECOND row leaves the first alone', () => {
  const rows = listAllIndicators(csWithTwoRsi, engineRegistry, {}).filter(r => r.defId === 'rsi')
  const next = applyRowPatch(rows[1], { period: 9 }, csWithTwoRsi, engineRegistry)
  expect(findInstance(next, 'inst:rsi:1').inputs.period).toBe(9)
  expect(findInstance(next, 'legacy:rsi').inputs.period).toBe(14)
})

it('a definition with NO instance still gets exactly ONE row — the "turn it on" control', () => {
  const rows = listAllIndicators(csWithNoInstances, engineRegistry, {}).filter(r => r.defId === 'obv')
  expect(rows).toHaveLength(1)
  expect(rows[0].instanceId, 'an off definition has no instance to name').toBeUndefined()
})
```

- [ ] **Step 4: Implement the row change**

In `listEngineIndicators` (`indicatorRegistry.js:279`), replace the one-row-per-definition loop: for each definition, find **every** live instance; emit one row per instance (id = the instanceId, plus a new `instanceId` field, `values` from that instance) and, when there are none, one row keyed by defId as today.

In `applyRowPatch` (`:457`), route on `row.instanceId`:

```js
  let next = settings
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'enabled') {
      // ⛔ THE ENABLED TOGGLE STAYS PER-DEFINITION even on an instance row, and
      // that is the shipped meaning of the control: "RSI: off" means no RSI.
      // `removeInstance` is the per-instance verb and it belongs to the chip's
      // Remove and the row's own delete affordance, not to a definition toggle.
      next = value === true
        ? setIndicatorEnabled(next, row.defId, true, registry)
        : setIndicatorEnabled(next, row.defId, false, registry)
    } else {
      next = row.instanceId
        ? setInstanceInput(next, row.instanceId, key, value, registry)
        : setIndicatorInput(next, row.defId, key, value, registry)
    }
  }
```

⚠️ `ChartSettingsModal` builds colour-swatch targets as `ind:${row.id}:${f.key}` and looks rows up with `indRowById` (`ChartSettingsModal.jsx:349`). An instanceId contains a `:`, so `t.split(':')` at `:362` breaks. **Fix the split, do not rename the id**: split on the FIRST colon only (`const i = t.indexOf(':'); const rest = t.slice(i + 1)`, then split the rest on its LAST colon for the field). Add a case with a `legacy:rsi` row id asserting the swatch resolves — this is exactly the kind of contract-between-components defect that survives thousands of green tests.

- [ ] **Step 5: Add the two entry points**

- `IndicatorLibraryDialog.jsx`: a row already checked shows **"+ Add another"** beside its checkmark, calling `addInstance(settings, def.id, registry)` through the dialog's existing `onChange`. Read how the checkmark is rendered before adding it.
- `chipMenu.js`: a **Duplicate** row between Move and Alerts, `onDuplicate(chip.instanceId)`, implemented in `StockChart` as `addInstance(cs, chip.defId, engineRegistry)`. Update `chipMenu.test.js`'s order assertion to `['settings','hidden','move','duplicate','alerts','about','remove']` — **update the expectation, never delete the assertion.**

- [ ] **Step 6: Add the parity case**

Add to `tools/chart_parity_cases.json` — **read and write BYTES** (`Path.read_bytes()`/`write_bytes()`; `write_text` truncated this exact file to 0 bytes in Phase C):

```json
{
  "name": "engine_two_rsi_instances",
  "why": "THE DUPLICATE, MEASURED. Side A draws ONE RSI(14) from the legacy mirror; side B draws RSI(14) AND RSI(7) from `instancesB`, one build apart, so the diff is the second line and nothing else. It is the ONLY task in the chart-UX-walls phase that moves a pixel -- the chip, its controls and the settings dialog are all invisible here, because ChartRender hides every .legend element from the captured export (see app/src/components/chart/engine/__tests__/parityGateBlindness.test.js). !! ONE PANE, NOT TWO: `orderedPaneKeys` dedupes by defId, so both instances land on the pane keyed 'rsi' and on its 0..100 scale -- a pane-count change in the MANIFEST here is a regression, not a feature. !! THE FAIL-PROOF IS THE SECOND PERIOD, NOT A COLOUR: re-run with the second instance at period 14 and the number must fall to 0, because two identical RSIs draw the same line twice. A colour probe would move pixels even if the second instance were never bound.",
  "tf": "D",
  "fixedbars": "<the same fixture rsi_only uses -- read it, do not type it>",
  "settings": { "indicators": { "rsi": { "enabled": true, "period": 14 } } },
  "instancesB": [
    { "instanceId": "legacy:rsi", "defId": "rsi", "inputs": { "period": 14 }, "hidden": false },
    { "instanceId": "inst:rsi:1", "defId": "rsi", "inputs": { "period": 7 }, "hidden": false }
  ],
  "priceLine": false,
  "expect": 0
}
```

- [ ] **Step 7: Run the pixel gate and replace `expect: 0` with what you MEASURE**

Preconditions, each of which has cost this repo a run:
- `git status --porcelain` shows only this task's paths. Another agent mid-edit attributes their pixels to you (three Phase C tasks declined the gate for exactly this).
- Two dev servers off the SAME build: `cd app && npm run dev` (5173) and a second on 5174, or `--base-a $B --base-b $B` for the `instancesB` rehearsal form.
- The Playwright sweep writes `app/dist`, which `liveStyles.dist.test.js` READS — do not run vitest concurrently.

```bash
python tools/chart_parity.py --base-a http://localhost:5173 --base-b http://localhost:5173 \
    --cases engine_two_rsi_instances --instances-side none   # 1-vs-1, must be 0
python tools/chart_parity.py --base-a http://localhost:5173 --base-b http://localhost:5173 \
    --cases engine_two_rsi_instances --instances-side both   # 2-vs-2, must be 0
python tools/chart_parity.py --base-a http://localhost:5173 --base-b http://localhost:5173 \
    --cases engine_two_rsi_instances --repeat 5              # THE MEASUREMENT
```

`expect` is an **equality on every run** and `--tolerance` is **forbidden**: a diff smaller than the declared number fails, and variance between runs is itself a failure. Write the measured number into `expect`, then run the fail-proof:

```bash
# the second instance at period 14 -> two identical lines -> the number must FALL TO 0
python tools/chart_parity.py --base-a http://localhost:5173 --base-b http://localhost:5173 \
    --cases engine_two_rsi_instances --perturb-b-instances '{"period": 14}'
```

⚠️ **If the case reports 0 on the main run, it must REFUSE, not pass.** A 0 there means the second instance never bound. `rs_line_spy_only` set the precedent in Phase C: the harness raised `PaneLayoutAlertError` rather than returning 0, and that is the anti-vacuous-green rule working. Check the pane manifest diff explicitly — the geometry half must show **the same pane count** on both sides.

- [ ] **Step 8: Run the full 46-case set**

```bash
python tools/chart_parity.py --base-a http://localhost:5173 --base-b http://localhost:5174 --repeat 5
```
Expected: every pre-existing case at its declared number, zero variance. This task changes definition data for nobody and adds an instance for nobody, so **every existing case must be unmoved**; a move is a finding.

- [ ] **Step 9: Land Task 4's deferred mutation kill**

Task 4's M1 (`handleChipRemove` calling `setIndicatorEnabled` instead of `removeInstance`) survived because one instance existed. Add the case that kills it now, in `perInstanceDoor.test.js` — a two-instance blob, Remove on one chip, the sibling still drawing — and re-run M1 to confirm it dies. **Record the kill and the reason.**

- [ ] **Step 10: Mutation — three more**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | `listEngineIndicators` emits only the FIRST live instance per definition | the two-rows case |
| M2 | `applyRowPatch` routes an instance row's non-`enabled` patch to `setIndicatorInput(row.defId, …)` | "editing the SECOND row leaves the first alone" |
| M3 | `addInstance` reuses `legacyInstanceId(defId)` instead of `newInstanceId` | the duplicate produces one instance, not two — killed by the two-chip case |

- [ ] **Step 11: Commit**

```bash
git commit -m "feat(chart): two instances of one indicator can coexist

setIndicatorEnabled's docstring blamed the per-definition tombstone on 'a
settings row is per-DEFINITION at v1'. The rows are per-instance now, so the
reason is gone and RSI(7) and RSI(14) can share a chart -- on ONE pane and one
0..100 axis, because orderedPaneKeys dedupes by defId, which is also the display
a fast/slow RSI trader wants. Nothing in paneLayout, placement, binder or pool
changed.

This also makes IndicatorAlertPopover's Instance dropdown reachable: it renders
only when addressInstances.length > 1, which no user could produce until now.

Pixel gate: engine_two_rsi_instances at <MEASURED> px, 5/5 runs, zero variance,
fail-proof (the second instance at period 14) falls to 0. All 46 pre-existing
cases unmoved.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  app/src/components/chart/indicatorRegistry.js \
  app/src/components/chart/ChartSettingsModal.jsx \
  app/src/components/chart/IndicatorLibraryDialog.jsx \
  app/src/components/chart/legend/chipMenu.js \
  app/src/components/chart/legend/chipMenu.test.js \
  app/src/components/StockChart.jsx \
  tools/chart_parity_cases.json \
  app/src/components/chart/engine/__tests__/perInstanceDoor.test.js \
  app/src/components/chart/engine/__tests__/generatedSettingsRows.test.jsx \
  app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx
```

---

# Task 7: One naming pipeline — the notification names the instance and the bar

**Files:**
- Modify: `api/services/indicator_alert_evaluator.py` (`_dispatch_delivery`, around `:1395-1410`)
- Modify/create: `tests/test_indicator_alert_notification.py`

⛔ **`api/services/watchlist_alert_service.py`, `api/services/indicator_alert_service.py`, `api/routers/indicator_alerts.py` and `api/services/alerts.py` belong to other agents. Do not touch them.** This task changes two strings inside the evaluator and nothing else.

**Interfaces:**
- Consumes: `instance_label(address, params)` — already in this module at `:704`, deriving its knobs from `alert_series.address_inputs`, i.e. from the column function that consumes them, so it cannot name a parameter the compute ignores.
- Produces: nothing downstream.

**The defect, measured.** `_dispatch_delivery` builds `indicator = (alert.get("indicator") or "").upper()` and interpolates it. So a plot alert emails `ADX.PLUSDI`, and **two RSI alerts one keystroke apart send byte-identical email** — while the popover row already renders `a.instance_label` correctly (`IndicatorAlertPopover.jsx:464`). Spec §8's own motivating sentence is *"RSI(7) crossed 70" vs "RSI(14)"*, and the function that produces it lives in this same module.

- [ ] **Step 1: Write the failing test**

`tests/test_indicator_alert_notification.py`:

```python
def test_two_rsi_alerts_one_keystroke_apart_do_not_send_the_same_message(monkeypatch):
    """The defect, stated as an inequality. Before the fix both render
    'SPY RSI cross above 70.00 (now: 71.34) on 5'."""
    sent = []
    monkeypatch.setattr(wls, "deliver_alert_payload", lambda **kw: sent.append(kw))

    fast = {"id": 1, "user_id": 9, "sym": "SPY", "indicator": "rsi", "condition": "cross_above",
            "threshold": 70.0, "tf": "5", "params": {"period": 7}}
    slow = {**fast, "id": 2, "params": {"period": 14}}
    ev._dispatch_delivery(fast, 71.34, bar_time=1761913500)
    ev._dispatch_delivery(slow, 71.34, bar_time=1761913500)

    assert sent[0]["message"] != sent[1]["message"]
    assert "RSI(7)" in sent[0]["message"]
    assert "RSI(14)" in sent[1]["message"]


def test_a_plot_alert_names_the_plot_in_english_not_the_raw_address(monkeypatch):
    ...
    assert "ADX.PLUSDI" not in sent[0]["message"]
    assert "+DI" in sent[0]["message"] or "ADX" in sent[0]["message"]


def test_the_message_states_the_bar_that_caused_it_and_when_that_bar_CLOSED(monkeypatch):
    """A notification without a bar identity answers 'something happened at
    09:41:03', never 'can I trust this number after the bar closed'."""
    ...
    assert "09:35" in sent[0]["message"]     # ET, derived -- not typed
    assert "5m bar" in sent[0]["message"]


def test_a_MISSING_bar_time_degrades_to_the_old_shape_rather_than_crashing(monkeypatch):
    """bar_time is None on the live lane today. A notification that raises is an
    alert the member never receives -- strictly worse than one without a bar."""
    ev._dispatch_delivery(fast, 71.34, bar_time=None)
    assert sent and "RSI(7)" in sent[0]["message"]
```

⚠️ **Derive the expected ET time from the timestamp**, do not type `09:35` — compute it in the test with the same zone resolver the evaluator uses (`indicator_compute._et_zone()`), or the test is a wall-clock time bomb and will fail on a DST boundary. `lesson_weekday_only_test_time_bombs` is the recorded version of this class here.

- [ ] **Step 2: Run — must FAIL**

Run: `python -m pytest tests/test_indicator_alert_notification.py -q`
Expected: 3 failures (the degradation case may pass vacuously — check that it does, and say so).

- [ ] **Step 3: Implement**

Replace the two f-strings in `_dispatch_delivery`:

```python
        label = instance_label(alert.get("indicator") or "", alert.get("params"))
        condition = (alert.get("condition") or "").replace("_", " ")
        thr_str = f"{threshold:.2f}" if isinstance(threshold, (int, float)) else "—"
        val_str = f"{value:.2f}" if isinstance(value, (int, float)) else str(value)
        title = f"{sym} {label} alert"
        # ⭐ SPEC §8: "instance named in alert rows". `instance_label` derives its
        # knobs from the column function that CONSUMES them, so this can never
        # name a parameter the compute ignores -- and two alerts one keystroke
        # apart stop sending byte-identical email.
        #
        # ⛔ THE BAR IS THE RECEIPT. Without it the member is told "something
        # happened at 09:41:03"; with it they can put the number on a chart. It
        # is OPTIONAL because `bar_time` is None on the live lane today: a
        # notification that raised here would be an alert nobody receives, which
        # is worse than one without a bar.
        when = _bar_close_text(alert.get("tf"), bar_time)
        message = (f"{sym} {label} {condition} {thr_str} — {val_str}"
                   + (f" at {when}" if when else "")
                   + f" ({_tf_label(alert.get('tf'))} bar)")
```

Add the two small helpers beside it. `_bar_close_text` resolves ET **per instant** through `indicator_compute._et_zone()` — never a module-load offset, which is the trap `closed_bar_index` already documents.

**Do NOT change `_run_one_cycle`'s call signature in this task** unless `bar_time` is already threaded. If it is not, give `_dispatch_delivery` a `bar_time=None` keyword-only parameter and leave the call site alone: passing the real bar time is Phase C Task 8's owed work (`B4`/`A3` in the competitive review) and belongs in the cutover commit, not here.

- [ ] **Step 4: Run — must PASS, and the fire log must NOT move**

```bash
python -m pytest tests/test_indicator_alert_notification.py -q; echo $?
python tools/alert_replay.py --check; echo $?
```
Expected: both exit 0, and `--check` prints **FIRE LOG MATCHES**.

⚠️ **This is the task's real gate.** The message text is not in the fire key. If `--check` moves, you changed *evaluation*, not text — stop and investigate. Do **not** re-freeze.

- [ ] **Step 5: Mutation — two**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | Restore `label = (alert.get("indicator") or "").upper()` | the two-RSI inequality |
| M2 | Make `_bar_close_text` raise on `bar_time=None` instead of returning `None` | the degradation case |

Refusal/assert messages must be **disjoint** — two gates sharing a phrase let `pytest.raises(match=…)` pass with the safety deleted (Phase C Task 9's finding).

- [ ] **Step 6: Run the alert family + commit**

```bash
python -m pytest tests/test_indicator_alert_evaluator.py tests/test_alert_closed_bar.py \
                 tests/test_alert_shadow.py tests/test_indicator_alert_notification.py -q; echo $?
```

```bash
git add tests/test_indicator_alert_notification.py
git commit -m "fix(alerts): the notification names the instance and the bar

The evaluator built its message from indicator.upper(), so a plot alert read
ADX.PLUSDI and two RSI alerts one keystroke apart sent byte-identical email --
while the popover row already rendered instance_label correctly and
instance_label lives in this same module.

The bar close is stated where it is known. It is optional because bar_time is
None on the live lane until the closed-bar cutover passes it; a notification
that raised would be an alert nobody receives.

alert_replay --check: FIRE LOG MATCHES. The message is not in the fire key, so
a move there would mean evaluation changed.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  api/services/indicator_alert_evaluator.py \
  tests/test_indicator_alert_notification.py
```

---

# Task 8: "Add Alert" stops failing silently, and offers every timeframe the chart does

**Files:**
- Modify: `app/src/hooks/useIndicatorAlerts.js` (`createIndicatorAlert`, `:82-98`)
- Modify: `app/src/components/chart/IndicatorAlertPopover.jsx` (`TFS` at `:41-47`; `handleAdd` at `:269-274`; the error render beside `catalogError` at `:290`)
- Modify: `app/src/components/chart/IndicatorAlertPopover.test.jsx`

⛔ **No backend change is needed and none is permitted here** — `api/routers/indicator_alerts.py` belongs to another agent. Verified: `_TF_SECONDS` (`:72`) already enumerates all eight timeframes, and `create_alert` applies **no** timeframe allow-list — its three refusals are `_PRICE_ALIASES`, `value_function(address) is None`, and `ias.refusal_for(...)`. So widening the dropdown is frontend-only, and a `vwap`-on-`W` alert is refused by `refusal_for` with a message this task will finally show.

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `createIndicatorAlert(payload) → { ok: true, id } | { ok: false, error: string }` — a **shape change**; every call site is in these two files.

- [ ] **Step 1: Write the failing tests**

```js
it('a 400 from the server is SHOWN, not swallowed', async () => {
  fetchMock.mockResolvedValueOnce({ ok: false, status: 400,
    json: async () => ({ detail: "A live price alert belongs to the watchlist alert lane" }) })
  render(<IndicatorAlertPopover sym="SPY" onClose={noop} />)
  await user.click(screen.getByRole('button', { name: /add alert/i }))
  expect(await screen.findByRole('alert'))
    .toHaveTextContent(/watchlist alert lane/i)
})

it('a NETWORK failure says something different from a refusal', async () => {
  fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'))
  ...
  expect(await screen.findByRole('alert')).toHaveTextContent(/could not reach/i)
  // ⛔ Two failures that read identically send the user to the wrong fix.
})

it('a SUCCESS clears any previous error', async () => { ... })

it('offers all eight timeframes the chart offers', () => {
  render(<IndicatorAlertPopover sym="SPY" onClose={noop} />)
  const opts = [...screen.getByLabelText('Timeframe').options].map(o => o.value)
  // ⛔ DERIVED from the chart's own list, never typed: the two must not drift.
  expect(opts).toEqual(NATIVE_TFS)
})
```

Import `NATIVE_TFS` from `app/src/components/chart/timeframes.js:13` in **both** the test and the component. Typing `['1','5','15','30','60','D','W','M']` into the test would let the two lists drift apart again, which is the defect.

- [ ] **Step 2: Run — must FAIL**

Run: `cd app && npx vitest run src/components/chart/IndicatorAlertPopover.test.jsx`

- [ ] **Step 3: Implement**

`useIndicatorAlerts.js`:

```js
/**
 * ⛔ IT USED TO SWALLOW EVERY NON-OK RESPONSE AND RETURN null, so the create
 * path's carefully-written 400s -- the price-alias routing message and the "this
 * could never fire" refusal -- reached nobody. The user clicked Add Alert, the
 * label flickered, and nothing appeared. That is the exact inverse of the
 * decision one function above, where the CATALOG fetcher was made to THROW
 * because a swallowed failure is invisible.
 *
 * @returns {{ok: true, id: number} | {ok: false, error: string}} — never null.
 */
export async function createIndicatorAlert(payload) {
  let r
  try {
    r = await fetch(KEY, { method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  } catch {
    // A transport failure and a refusal need DIFFERENT words: one is "try again",
    // the other is "this alert can never fire". Same message sends the user to
    // the wrong fix.
    return { ok: false, error: 'Could not reach the server — check your connection and try again.' }
  }
  if (r.ok) { mutate(KEY); return { ok: true, id: (await r.json()).id } }
  let detail = ''
  try { detail = (await r.json()).detail || '' } catch { /* not JSON */ }
  return { ok: false, error: detail || `The server refused this alert (${r.status}).` }
}
```

`IndicatorAlertPopover.jsx`: replace `TFS` with a list derived from `NATIVE_TFS` (map each code to its label through the same table the chart's timeframe bar uses — read `timeframes.js` and reuse its label source rather than writing a second one); hold `const [submitError, setSubmitError] = useState(null)`; in `handleAdd`, `const res = await createIndicatorAlert(payload); setSubmitError(res.ok ? null : res.error)`; render the error above the submit button reusing the existing `styles.catalogError` block with `role="alert"`.

- [ ] **Step 4: Run — must PASS**

Run: `cd app && npx vitest run src/components/chart/IndicatorAlertPopover.test.jsx`
Expected: exit 0.

- [ ] **Step 5: Verify the refusal is REAL, not a story**

The point of this task is that a message the backend already writes reaches a human. Prove one round-trip against a real refusal rather than a mock:

```bash
python -c "
import sys; sys.path.insert(0,'.')
from api.services import indicator_alert_service as ias
print(repr(ias.refusal_for('vwap','above','W',10.0)))
print(repr(ias.refusal_for('rsi','above','5',70.0)))
"
```
Expected: a non-empty refusal string for the first (VWAP is intraday-only) and `None`/empty for the second — the positive control that `refusal_for` is not simply refusing everything. Quote both in the report.

⚠️ **Do not probe a mutating endpoint to test this** (`lesson_never_probe_a_mutating_endpoint_to_test_auth`). Call the service function directly, as above.

- [ ] **Step 6: Mutation — two**

| # | Mutation | Must be killed by |
|---|---|---|
| M1 | Restore the `return null` swallow | the 400-is-shown case |
| M2 | Give the network branch the same string as the refusal branch | the "says something different" case |

- [ ] **Step 7: Commit**

```bash
git commit -m "fix(alerts): a refused Add Alert says why, and the dropdown offers all eight timeframes

createIndicatorAlert swallowed every non-OK response and returned null, so the
create path's two carefully-written 400s -- the price-alias routing message and
the 'this could never fire' refusal -- reached nobody. The catalog fetcher one
function above was deliberately made to THROW for exactly this reason.

A transport failure and a refusal now read differently, because the same words
send the user to the wrong fix.

Timeframes are derived from timeframes.NATIVE_TFS in both the component and its
test, so the chart's eight and the alert's cannot drift apart again. No backend
change: _TF_SECONDS already carries all eight and create_alert applies no
timeframe allow-list.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>" -- \
  app/src/hooks/useIndicatorAlerts.js \
  app/src/components/chart/IndicatorAlertPopover.jsx \
  app/src/components/chart/IndicatorAlertPopover.test.jsx
```

---

## Open questions for the owner

These are decisions this plan could not make. Each one is a product judgement, not a technical unknown.

1. **Does "Move to → its own pane" need to work for a duplicate?** As shipped, a pane key is a `defId`, so RSI(7) and RSI(14) share one pane and one 0–100 axis. This plan takes that as **correct for v1** (it is the fast/slow display a trader wants, and it needs zero renderer change). Making panes instance-scoped is a separate phase touching `bands`, `paneLayout.panes[].key`, `region.key`, `volumeOverlayIndicators` and the pixel gate's manifest. **Confirm v1 is acceptable.**
2. **Should the chip strip move to per-pane placement?** Spec §6/§7 say ">4 chips **per pane**", implying pane-local chips as TradingView has. The shipped legend is one box at the chart's top-left. Per-pane placement is a further phase; this plan collapses at >4 over the whole strip and says so. **Confirm.**
3. **The repaint badge is a seeded default and one live indicator wears it falsely.** `nativeRegistry.js:112` spreads `repaint: 'non-repainting'` into every definition, and `indicator_compute.py:743` writes bar *i*'s close to index *i−26* for `ichimoku.chikou` — which is repainting by §4's own rule. `indicatorCatalog.test.js:573` asserts **uniformity**, so an honest `repaints` declaration would be *blocked* by a test. This plan does not touch it (it is Phase D Task 7's, and it shares a mechanism with Phase C Task 8's accepted `ichimoku.chikou` casualty). **The two should go to the owner in one message, as the Phase C ledger already recommends.**
4. **`legend.decimals` for OBV.** This plan declares 0, on the grounds that OBV is a cumulative share count. If the owner reads OBV in millions with one decimal, say so — it is a one-line change and it is a trading-display preference, not an engineering one.

## Self-review notes

- **Spec coverage.** §6's chip anatomy → Tasks 2–4. Hover controls → Task 4. `+N` → Task 3. Tap→`ContextPopover` with six 44px rows → Task 4. Three-tab dialog and the whole settings-form spec → Task 5. The ten instance states: 3 (warmup), 4 (compute error), 5 (server unavailable), 6 (premium locked), 8 (hidden-on-this-TF), 9 (repaint badge) and 10 (version-migrated) are **NOT** in this plan — they are error/edge states, not walls, and several depend on data the client does not yet carry. States 1, 2 and 7 fall out of the chip. **Say so rather than implying coverage.** §8's "instance named in alert rows" → Task 7.
- **Counts.** Every number in this document is tagged `[measured 2026-08-06]` and points at the file that asserts the live one. No task adds an assertion duplicating a count another test already owns.
- **Type consistency.** `Chip` is produced by `legendChips` (Task 3) and consumed by `IndicatorChip` and `chipMenuItems` (Task 4) with the same field names throughout. The per-instance door's five function names are used identically in Tasks 1, 4, 5 and 6.
