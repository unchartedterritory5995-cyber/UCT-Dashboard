# Phase B2 — Engine Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the indicator engine — definition schema, native registry, instance manager, a series-pooling binding layer, and a placement adapter — **rendering nothing by default**, behind a flag, with zero indicators migrated and zero pixels changed.

**Architecture:** Every decision lives in a pure, unit-testable module; one thin shell touches lightweight-charts. The engine hooks into `StockChart.updateChart` at a single call site that already has every dependency in scope, so it inherits the existing render plan and dep array. Series are **pooled by LWC type and re-purposed via `applyOptions`/`moveToPane`** rather than destroyed and recreated — the escape from open issue #2049.

**Tech Stack:** React 19 + Vite 7 · lightweight-charts **5.2.0 (pinned exact)** · vitest 4 (jsdom, pool=forks) · Playwright + Pillow (the B1 parity gate).

## Global Constraints

- **Branch from `feat/phase-b1-foundations`, NOT master** — B2 builds directly on B1's foundations (pinned renderer, `designTokens.js`, the settings passthrough, the unrounded/NaN-padded compute contract, the parity gate). Worktree: `C:\Users\Patrick\uct-worktrees\phase-b2-engine`, branch `feat/phase-b2-engine`.
- **⛔ NO PUSH TO MASTER.** Phase B ships after the Sep 5 launch freeze. Branch backup push only (`git push -u origin <branch>`).
- **THE ENGINE LANDS DARK.** `CHART_DEFAULTS.indicatorInstances` stays `[]` and the flag defaults OFF. Flag off ⇒ **zero** LWC calls of any kind. That single assertion is the whole "lands dark" contract and is trivially testable — write it first.
- **Zero indicators migrate in B2.** No legacy render block, no `CHART_DEFAULTS.indicators` key, no `indicatorData` line is deleted. That's B3.
- **Exit criterion: `python tools/chart_parity.py` reports 0 changed pixels with the flag OFF**, and its `--perturb-b` self-test still reports non-zero. A B2 that changes a pixel with the engine dark has a bug.
- Frontend: `cd app && npx vitest run <paths>` (NEVER `npm test -- run` — double-runs). Backend: `python -m pytest ... -q` from root.
- Mutation-check every new gate; restore byte-identical with an in-place copy (**never `git stash`**) and confirm `git status --short` is empty.
- Stage files BY NAME. Trailer: `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- No Ravi-owned files: `OptionsFlow.jsx`, `OptionsFlow_admin.jsx`, `schwab_router.py`, `live_massive_router.py`, `massive_ws_worker.py`, `massive_processor.py`, `liveflow_router.py`.

## Ground truth that overturns the old assumptions (verified against the installed 5.2.0 bundle)

**Two in-code comments are WRONG for 5.2.0** — `StockChart.jsx:5460-5461` and `:5490` both say scale id / pane / type are fixed at creation. They were true on 5.1.x. Today:

| Property | Mutable after `addSeries`? | Evidence |
|---|---|---|
| `priceScaleId` | **YES** via `applyOptions` → `moveSeriesToScale` | `lightweight-charts.development.mjs:3476-3482`, `:7174-7178` |
| Pane | **YES** via `series.moveToPane(i)` | `typings.d.ts:2600-2606`; impl `:7223-7240` (auto-removes an emptied source pane) |
| Series **TYPE** | **NO** — `seriesType()` is a read-only getter | `typings.d.ts:2570` |

**⇒ The pool key is the LWC series constructor and nothing else.** A pooled `LineSeries` can be moved between panes, re-bound to any price scale, recoloured, restyled and re-`setData`'d — it can become any single-line plot of any indicator. Given #2049 (mass `removeSeries` = 2–4 s, still open), this reduces steady-state churn to ~zero.

**Seven traps the binding layer must handle explicitly** (each has a task below):
1. `_applyData` returns early on `_noop` — a freshly created/re-purposed series would render **blank**. Safe today only because every create is triggered by a `cs` change; pooling breaks that coupling. **Force `setData` on first bind, independent of the plan.**
2. Price-scale options are asymmetric: `{autoScale:false, minimum:0, maximum:100}` is applied on the **create branch only** (`:5773`). Scales are chart-level and keyed by id, so a pooled series inheriting an RSI's scale keeps 0–100 and would clip an ATR. **Re-assert the FULL scale option set on every bind.**
3. `createPriceLine` handles are **never tracked** — re-purposing a pooled series leaks the previous tenant's 70/50/30 guides. **Track and `removePriceLine` on release.**
4. `.length` is the pane-existence test today (`:5761`). With NaN-padded columns it is always truthy. **Use "has ≥1 finite value"** — `_schema.md` explicitly assigns this unification to B2.
5. `resolveToken` falls back to the `classic` preset for an unknown preset — and **every settings write sets `preset:'custom'`**, so an OLED user who touches any setting silently gets classic tokens. **Resolve the preset from the canvas, not `cs.preset`.**
6. `setPref` is a **blind whole-blob write with no CAS** (`hooks/usePreferences.js:32-50`) — a live bug with up to 16 grid cells as concurrent writers. Spec §5 safeguard 3 assigns the fix to B2.
7. The MACD head-mask (`StockChart.jsx:3952-3965`) is a deliberate B1 pixel-parity hold. **The binding layer must carry it** or `macd_only` goes red in the gate.

---

### Task 0: Worktree from B1

**Files:** creates worktree + branch. No repo change.

- [ ] **Step 1: Create it from the B1 branch (not master)**

```bash
cd /c/Users/Patrick/uct-dashboard
git fetch origin
git worktree add -b feat/phase-b2-engine /c/Users/Patrick/uct-worktrees/phase-b2-engine feat/phase-b1-foundations
git -C /c/Users/Patrick/uct-worktrees/phase-b2-engine log --oneline -1
```
Expected: HEAD at B1's tip (the parity-gate commit or later).

- [ ] **Step 2: Real, isolated node_modules**

```bash
cmd //c "dir /AL C:\Users\Patrick\uct-worktrees\phase-b2-engine\app"
```
If `node_modules` shows as `<JUNCTION>`, `rmdir` the LINK only (no `/S`) then `npm ci` in `app/`. If absent, just `npm ci`. Then confirm the pin survived: `node -p "require('lightweight-charts/package.json').version"` → **5.2.0**.

- [ ] **Step 3: Baselines** — `cd app && npx vitest run src/components/chart/ src/hooks/` (record the count) and `python -m pytest tests/test_indicator_golden.py -q`. Both must be green before any B2 code.

- [ ] **Step 4: Prove the parity gate runs HERE** — follow `docs/runbooks/chart-parity-gate.md`, run the same-build capture twice, confirm **0 changed pixels** both times. This is B2's exit criterion; verify it works before you can break it.

---

### Task 1: Definition schema + validator

**Files:**
- Create: `app/src/components/chart/engine/defSchema.js`, `app/src/components/chart/engine/defSchema.test.js`

**Interfaces:**
- `validateDefinition(def) -> {ok: true, def} | {ok: false, errors: string[]}` — pure, no I/O.
- `SCHEMA_VERSION = 1`.
- Accepts the spec §3 shape: `{schemaVersion, id, version, compute:{kind, fn, rev, budget}, meta:{name, shortName, category, tier, repaint}, placement:{target, scale}, inputs:[…], plots:[…], events:[…]}`.
- **Fail-closed on behavioural fields** (spec §3.1): an unknown `inputs[].type` or `plots[].style` makes the definition **invalid at registration** — never a silent coercion. Unknown *document* fields (meta additions) are ignored-and-preserved.
- **`$<inputKey>` substitution** is resolved at validation: valid in `plots[].color`, `plots[].width`, `plots[].levels`. An unresolvable `$ref` is a validation ERROR (spec §3.1: "Resolution failure = definition invalid at registration. Never silent defaults").
- Input types v1: `int, float, bool, enum, string, color, source`. Plot styles v1: `line, stepline, histogram, area, baseline, hlines, markers, band`.

- [ ] **Step 1: Write the failing test**

```js
// app/src/components/chart/engine/defSchema.test.js
import { describe, it, expect } from 'vitest'
import { validateDefinition, SCHEMA_VERSION } from './defSchema'

const rsiDef = () => ({
  schemaVersion: 1, id: 'rsi', version: 1,
  compute: { kind: 'native', fn: 'rsi', rev: 1 },
  meta: { name: 'RSI', shortName: 'RSI', category: 'Momentum', tier: 'free', repaint: 'non-repainting' },
  placement: { target: 'pane', scale: { min: 0, max: 100 } },
  inputs: [{ key: 'period', type: 'int', label: 'Length', default: 14, min: 2, max: 200 },
           { key: 'color', type: 'color', label: 'Colour', default: 'token:info' }],
  plots: [{ key: 'rsi', label: 'RSI', style: 'line', color: '$color', width: 1 },
          { key: 'levels', style: 'hlines', levels: [70, 50, 30] }],
  events: [],
})

describe('definition schema', () => {
  it('accepts a well-formed definition', () => {
    const r = validateDefinition(rsiDef())
    expect(r.ok, JSON.stringify(r.errors)).toBe(true)
  })

  it('FAILS CLOSED on an unknown input type — never coerces', () => {
    const d = rsiDef(); d.inputs[0].type = 'quantum'
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/quantum/)
  })

  it('FAILS CLOSED on an unknown plot style', () => {
    const d = rsiDef(); d.plots[0].style = 'hologram'
    expect(validateDefinition(d).ok).toBe(false)
  })

  it('rejects an unresolvable $ref rather than defaulting it', () => {
    const d = rsiDef(); d.plots[0].color = '$nope'
    const r = validateDefinition(d)
    expect(r.ok).toBe(false)
    expect(r.errors.join(' ')).toMatch(/\$nope/)
  })

  it('resolves $refs to their input defaults on the returned def', () => {
    const r = validateDefinition(rsiDef())
    expect(r.def.plots[0].color).toBe('token:info')   // from inputs[].default
  })

  it('preserves unknown META fields (document-shaped, forward-compatible)', () => {
    const d = rsiDef(); d.meta.futureThing = 42
    const r = validateDefinition(d)
    expect(r.ok).toBe(true)
    expect(r.def.meta.futureThing).toBe(42)
  })

  it('requires a matching schemaVersion', () => {
    const d = rsiDef(); d.schemaVersion = 99
    expect(validateDefinition(d).ok).toBe(false)
    expect(SCHEMA_VERSION).toBe(1)
  })

  it('rejects duplicate plot keys — they are the public handles', () => {
    const d = rsiDef(); d.plots[1].key = 'rsi'
    expect(validateDefinition(d).ok).toBe(false)
  })
})
```

- [ ] **Step 2: Run, confirm module-not-found.** `cd app && npx vitest run src/components/chart/engine/defSchema.test.js`
- [ ] **Step 3: Implement `defSchema.js`.** Pure, dependency-free, exhaustive error strings (each names the offending field and value — a validator whose errors don't identify the field is a validator nobody will debug with).
- [ ] **Step 4: Run to PASS.**
- [ ] **Step 5: Mutation-check the fail-closed gates** — make the unknown-type branch fall through to a default; the corresponding test must fail. Restore byte-identical.
- [ ] **Step 6: Commit**

```bash
git add app/src/components/chart/engine/defSchema.js app/src/components/chart/engine/defSchema.test.js
git commit -m "feat(engine): the indicator definition schema, validated at registration

Behavioural fields fail closed — an unknown input type or plot style makes the
definition invalid rather than silently coercing, because a coerced input default
changes alert maths downstream. Document fields (meta) are ignored-and-preserved
so a newer definition can round-trip through an older client.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Native registry — the 15 as definitions

**Files:**
- Create: `app/src/components/chart/engine/nativeRegistry.js`, `nativeRegistry.test.js`

**Interfaces:**
- `NATIVE_DEFS` — an array of definitions, one per native indicator, each passing `validateDefinition`. Mirror the CURRENT behaviour exactly (periods, colours, plot counts, scale hints) — read `CHART_DEFAULTS.indicators` (`chartDefaults.js:126-154`) and the render blocks for each.
- `getDefinition(defId)` → def or `null`. `listDefinitions()` → all.
- `computeFor(def, bars, inputs)` → `{ [plotKey]: Float64Array-like }` — dispatches to the existing `indicators.js` functions and **normalises every native's return shape into the columnar contract** (input-length, NaN-padded, one array per plot key). This is the adapter that makes 15 bespoke return shapes (bare arrays, `{upper,middle,lower}`, `{macd,signal,histogram}`, `{k,d}`, `{adx,plusDI,minusDI}`, SAR's `isUptrend` third field) uniform.
- **`hasAnyFinite(col)`** — exported; the pane-existence test that replaces `.length` (trap #4).
- **Carry the MACD head-mask** (trap #7): `computeFor` for MACD must reproduce `StockChart.jsx:3952-3965`'s masking so the engine's MACD is byte-identical to the legacy path's.
- `volumeProfile` is **NOT** in the registry — it is a canvas overlay with no compute function and no expressible plot style (B3 carve-out). State that in the module docstring so nobody "completes the set".

- [ ] **Step 1: Write the failing test** — for each of the 14 registry entries: it validates; its declared `plots[].key` set equals the keys `computeFor` returns; every returned column is input-length; a series too short to compute yields all-NaN columns and `hasAnyFinite` is `false`; a normal series yields `hasAnyFinite` `true`. Plus: MACD's masked head matches the legacy memo's output exactly (import the legacy `computeMACD` and reproduce the mask in the expectation); SAR's `isUptrend` does not leak into a plot column; `volumeProfile` is absent from `listDefinitions()`.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.** Reuse `_CASE_COLUMNS` from `api/services/indicator_compute.py:450-458` as the reference for per-indicator column names where the Python lane already has them — do not invent a second naming.
- [ ] **Step 4: Run to PASS.**
- [ ] **Step 5: Mutation-check** — drop one plot key from a definition; its shape test must fail. Break the MACD mask; its parity test must fail.
- [ ] **Step 6: Commit.**

---

### Task 3: Instance manager + legacy migrator

**Files:**
- Create: `app/src/components/chart/engine/instances.js`, `instances.test.js`

**Interfaces:**
- `migrateLegacyToInstances(cs) -> instance[]` — **pure**. Reads `cs.indicators` (the 15 keyed booleans + params) and emits `[{instanceId, defId, defVersion, inputs, placement, hidden}]`. Deterministic `instanceId` (e.g. `legacy:${defId}`) so re-running is idempotent and a migrated blob never duplicates.
- **Does NOT fold in `overlays`** — MA overlays merge POSITIONALLY and pad to the defaults' length (`chartDefaults.js:79-83`); their positional identity is load-bearing for every stored blob. Migrating them is B3+. State this in the docstring.
- `validateInstance(inst, registry) -> {ok, errors}` — element validation the B1 passthrough deliberately left to B2: id-less, duplicate-id, unknown-`defId`, and inputs violating the definition's declared `min`/`max`/`type`.
- `normalizeInstances(list, registry) -> {kept: instance[], dropped: {inst, reason}[]}` — never throws; a bad instance is dropped WITH a reason, never silently.

- [ ] **Step 1: Write the failing tests**, including: migration is idempotent (`migrate(migrate(cs))` adds nothing); a legacy blob with RSI enabled + period 7 produces exactly one instance carrying `period: 7`; a disabled indicator produces no instance; an unknown `defId` is dropped with a reason; `overlays` is untouched.
- [ ] **Step 2: Run, confirm failures.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Golden-test against REAL blobs** (spec §5 safeguard 2). Pull 3–5 real `chart_settings` values — read them from the prod DB if a safe read-only path exists, otherwise reconstruct from `CHART_DEFAULTS` + the presets and SAY SO in the report. Commit them as fixtures under `app/src/components/chart/engine/__fixtures__/`. Assert the migration output for each.
- [ ] **Step 5: Mutation-check + Commit.**

---

### Task 4: The settings write path — stop losing concurrent writes

**Files:**
- Modify: `app/src/hooks/usePreferences.js`
- Create/modify: `app/src/hooks/usePreferences.test.js`

**Interfaces:**
- `setPref(key, value)` keeps its signature. Add `setPrefMerged(key, updater)` where `updater(current) -> next` — re-reads the freshest cached value immediately before the POST and applies the update to THAT, so two concurrent writers can't clobber each other's disjoint changes.
- For `chart_settings` specifically: merge `indicatorInstances` **by `instanceId`** (reuse the id-merge already written in `mergeSettingsOverride`, `chartDefaults.js:438-448` — import it, don't reimplement).

**Why (verified):** `usePreferences.js:32-50` optimistically mutates then POSTs the **whole blob**, with no CAS and no per-key merge. Up to 16 grid cells are concurrent writers each holding a possibly-stale `cs`. Adding an instance in one cell while another cell writes = the add is lost. This is a **live bug today** (it can already lose an indicator toggle), not new risk introduced by the engine.

- [ ] **Step 1: Write the failing test** — simulate two writers: A reads, B reads, B writes `{x:1}`, A writes `{y:2}` from its stale snapshot. With `setPref` the result loses `x`; with `setPrefMerged` both survive. Prove the OLD behaviour is lossy first (that test documents the bug), then the new path.
- [ ] **Step 2: Run, confirm the lossy case reproduces.**
- [ ] **Step 3: Implement.** Do not change `setPref`'s existing callers in this task — add the merged path and use it only from the engine's writer. (Migrating the other callers is a follow-up; a wholesale switch here would touch every settings surface.)
- [ ] **Step 4: Run to PASS.** Then the full chart+hooks suites — `usePreferences` is used everywhere; a regression here is app-wide.
- [ ] **Step 5: Mutation-check + Commit.**

---

### Task 5: The binding layer — pool, bind, release

**Files:**
- Create: `app/src/components/chart/engine/pool.js`, `pool.test.js` (pure decisions)
- Create: `app/src/components/chart/engine/binder.js`, `binder.test.js` (the LWC-touching shell, tested against a recording double)

**Interfaces — `pool.js` (pure, no LWC):**
- `poolKey(plot) -> 'line'|'histogram'|'area'|'baseline'` — derived from `plots[].style` ONLY (series type is the sole immutable property).
- `planBindings(instances, registry, prevBindings) -> {bind: [...], release: [...], reuse: [...]}` — decides which existing series objects are re-purposed for which plots, which are freed, and which must be created. Never returns a `release` for something a `bind` in the same pass could have reused (that's the whole point).
- `firstBindNeedsSetData(binding, planMode) -> boolean` — **trap #1**: always `true` for a newly created or re-purposed series, regardless of `planMode`.

**Interfaces — `binder.js` (touches LWC):**
- `createBinder({ chart, LWC })` → `{ sync(ctx), teardown() }`.
- `sync(ctx)` where `ctx = { cs, instances, registry, bars, adjustTime, paneMargins, indTarget, applyIndScale, applyData, plan: {noop, incr, fresh}, resolvePreset }`.
- On every bind it MUST: re-assert the **full** price-scale option set (trap #2), `removePriceLine` every guide the previous tenant created (trap #3), force `setData` on first bind (trap #1), and use `moveToPane` + `applyOptions({priceScaleId})` instead of remove/add (the #2049 escape).
- **Flag off ⇒ `sync` returns immediately having made zero LWC calls.**

- [ ] **Step 1: Write `pool.test.js` first** (pure, cheap): two line plots share a pool key; a histogram never matches a line; a released line is reused by the next line rather than recreated; `firstBindNeedsSetData` is true under a `noop` plan.
- [ ] **Step 2: Build the recording double.** Extend the existing stub idiom from `StockChart.smoke.test.jsx:13-39` into `app/src/components/chart/engine/__tests__/fakeChart.js` — every method records its call. This is new but small, and it is what makes the behavioural assertions below possible.
- [ ] **Step 3: Write `binder.test.js`** asserting the invariants that matter:
  - flag off → **zero** calls of any kind (the lands-dark contract)
  - a recolour-only settings change → **zero** `addSeries`/`removeSeries`
  - a pane move → `moveToPane` + `applyOptions({priceScaleId})`, **never** `removeSeries`+`addSeries`
  - a newly-pooled series always gets `setData`, never `update`, on first bind — even under a `noop` plan
  - reclaiming a pooled series calls `removePriceLine` for every guide its previous tenant created
  - every bind re-applies the full scale option set (assert the recorded options object, not just that it was called)
- [ ] **Step 4: Implement both modules.** Keep every decision in `pool.js`; `binder.js` should read as a translation of a plan into LWC calls with no branching logic of its own.
- [ ] **Step 5: Mutation-check EACH invariant** — this task's tests are the engine's spine. Break the first-bind rule → the setData test fails. Swap `moveToPane` for remove/add → the pane test fails. Skip `removePriceLine` → the guide test fails. Restore byte-identical each time.
- [ ] **Step 6: Commit.**

---

### Task 6: Placement adapter (Flip A — legacy bands)

**Files:**
- Create: `app/src/components/chart/engine/placement.js`, `placement.test.js`

**Interfaces:**
- `resolvePlacement(instance, def, ctx) -> {paneIndex, scaleId, scaleOptions}` — pure. `ctx` carries `paneMargins`, `volSeparatePane`, `volOverlaySet`, `VOL_PANE_INDEX`.
- Mirrors `indTarget`/`applyIndScale` (`StockChart.jsx:5457-5480`) exactly: overlaid → `{pane: VOL_PANE_INDEX, scaleId: 'left'}` with the autoscaled left-axis options; otherwise `{pane: 0, scaleId: <defId>}` with `scaleMargins: paneMargins[key] || {top:0.82, bottom:0}`.
- Returns the **complete** scale option set every time (trap #2) — including the fixed-range extras (`{autoScale:false, minimum, maximum}`) that today are applied only at create.
- `resolvePreset(cs) -> 'classic'|'oled'|'tradingview'|'light'` — **trap #5**: derive from the canvas (`cs.background`/`canvasTheme`), never from `cs.preset`, because every settings write sets `preset:'custom'` and `resolveToken` would silently fall back to classic.

**Do NOT touch `paneMargins.js`.** The engine *consumes* its output; adding an engine key to `PANES` would reserve a band for something rendering nothing. B5 retires it.

- [ ] **Step 1: Write the failing tests** — pane-0 default; volume-overlay path; the fixed-range extras are present on EVERY resolve (not just the first); `resolvePreset` returns `oled` for an OLED-background blob whose `preset` is `'custom'` (the trap-5 case, which must fail before the fix).
- [ ] **Step 2–5:** run/implement/mutation-check/commit as above.

---

### Task 7: Wire into StockChart — dark, one call site

**Files:**
- Modify: `app/src/components/StockChart.jsx` (a `useRef`, one `sync` call, and the hide-all-indicators extension)
- Modify: `app/src/components/chart/chartDefaults.js` (the flag)

**Interfaces:**
- Flag: `CHART_DEFAULTS.engineEnabled = false` (and through `mergeChartSettings`, as B1 established). Off ⇒ the engine never runs.
- **The single hook-in point:** inside `updateChart`, immediately after `applyIndScale` is defined (~`StockChart.jsx:5480`) and BEFORE the volume block. At that point `chart`, `_applyData`, `_noop`/`_incr`/`_freshChart`, `paneMargins`, `indTarget`, `applyIndScale`, `cs`, `filteredBars` and `adjustTime` are all in scope. One line plus one ref.
- **Do NOT extract to a separate effect in B2.** `_noop`/`_incr` are locals of `updateChart`; a separate effect would duplicate the render-plan decision and re-order pane creation — exactly what the parity gate would catch. Extraction is B5's job when panes become real.
- **Extend the hide-all-indicators effect** (`StockChart.jsx:8140-8162`) to iterate the binding map. Today it hand-lists 27 refs and carries an in-code warning that a phantom name there crashed `/charts` for every user on 2026-07-22 with no build-time check. Iterating the map removes that failure class for engine-owned series.

- [ ] **Step 1: Write the failing test** — a component-level test (using the existing `vi.mock('lightweight-charts')` idiom from `StockChart.smoke.test.jsx`) asserting that with the flag OFF the engine's `sync` is never called, and with it ON + zero instances it is called exactly once per `updateChart` and makes no series calls.
- [ ] **Step 2: Run, confirm failure.**
- [ ] **Step 3: Implement the wiring.** Smallest possible diff.
- [ ] **Step 4: Extend the hide-all effect** + a test that an engine-bound series hides with the toggle.
- [ ] **Step 5: Full chart+hooks suites green.**
- [ ] **Step 6: THE PARITY GATE — flag OFF must be 0 changed pixels.** Run `python tools/chart_parity.py` per the runbook against this build vs the B1 build. Any non-zero diff means the wiring changed rendering while dark — STOP and fix. Record the number.
- [ ] **Step 7: Commit.**

---

### Task 8: Prove the engine can actually draw (dark rehearsal)

**Files:**
- Create: `tools/chart_parity_cases.json` additions (an `engine_rsi` case), `app/src/pages/ChartRender.jsx` (an `?instances=` param mirroring the existing `?indicators=`)

**Why:** every prior task tests the engine's *decisions*. Nothing has yet proven it can put a correct line on a real canvas. This task does — without migrating anything — by rendering ONE engine instance in the headless route and diffing it against the legacy render of the same indicator.

**Interfaces:**
- `ChartRender.jsx` gains `?instances=<base64url JSON>` → seeds `cs.indicatorInstances` + turns the engine flag on, for that route only.
- New parity case `engine_rsi_vs_legacy`: side A renders legacy RSI (`?indicators=`), side B renders engine RSI (`?instances=`), same fixed bars, same preset.

- [ ] **Step 1: Add the param + case.**
- [ ] **Step 2: Run the comparison.** **Expected: 0 changed pixels.** The engine's RSI must be pixel-identical to the legacy RSI — that is the entire premise of Flip A, and this is the cheapest possible place to discover it isn't.
- [ ] **Step 3: If non-zero, diagnose and fix** — a difference here is a real defect in the binding layer, placement adapter, or the compute normalisation. Report the pixel count and the cause; do not tune the tolerance.
- [ ] **Step 4: Prove the case can fail** — perturb the engine RSI's colour by one hex digit and confirm a non-zero diff, so the 0 above means agreement rather than a broken comparison.
- [ ] **Step 5: Commit** with both numbers in the message.

---

### Task 9: Verification + branch handoff

- [ ] **Step 1: Full frontend** — `cd app && npx vitest run src/`. Report the count. (Known: two order/load-dependent flakes may be fixed by B1's independent-verification pass; if they still flake, name them and confirm they pass in isolation.)
- [ ] **Step 2: Full backend** — `python -m pytest tests/ -q`. Only known pre-existing failures allowed; name each.
- [ ] **Step 3: `npm run build`** clean.
- [ ] **Step 4: Parity gate, both ways** — flag OFF vs B1 build = **0**; the `--perturb-b` self-test = **non-zero**. Both numbers in the report.
- [ ] **Step 5: Push the BRANCH only** — `git push -u origin feat/phase-b2-engine`. ⛔ **Never `:master`.**
- [ ] **Step 6: Report the B2 exit state** and what B3 inherits: which definitions exist, what the pool key is, which traps are handled by which module, and the exact list of things B3 must do to migrate its first indicator.

---

## Self-review notes

- **Spec coverage:** §3 schema → T1 · §4 compute contract normalisation → T2 · §5 instance manager + migration + write path → T3/T4 · §5 binding layer + placement → T5/T6 · §5 "renders into legacy bands" (Flip A) → T6/T7 · §9.3 parity gate as exit criterion → T7/T8/T9.
- **The seven traps map to tasks:** 1 → T5 (`firstBindNeedsSetData`) · 2 → T5+T6 (full scale set every bind) · 3 → T5 (`removePriceLine` tracking) · 4 → T2 (`hasAnyFinite`) · 5 → T6 (`resolvePreset`) · 6 → T4 (`setPrefMerged`) · 7 → T2 (MACD mask carried).
- **Deliberately NOT in B2:** any indicator migration (B3) · `volumeProfile` (B3 carve-out) · real panes (B5) · the auto-generated settings UI, legend chips, library dialog (B4) · the remaining enumeration sites — ChartToolbar rows, `chartRegion.INDICATOR_LABELS`, the crosshair legend, the share-URL keys (B4) · `indicatorRegistry`'s MA/volume/VWAP descriptors (stay as-is; B2 only decides that the schema supersedes the *vocabulary*, and must not build a second parallel field system).
- **Type consistency:** `validateDefinition`'s returned def is what `nativeRegistry` stores and what `pool.poolKey`/`placement.resolvePlacement` read; `normalizeInstances` output is what `binder.sync` consumes; `hasAnyFinite` (T2) is the pane-existence test used by T5/T6.
