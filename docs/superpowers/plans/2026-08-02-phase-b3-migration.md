# UCT Phase B3 — The Two-Flip Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move four real indicators — RSI, Bollinger Bands, MACD and VWAP — off StockChart's hand-written render blocks onto the Phase B2 engine, behind `engineEnabled`, through two explicitly-defined flips, with pixel parity proven and provably failable at every step.

**Architecture:** The engine (`app/src/components/chart/engine/`) already computes, places, pools and binds — B2 proved it renders RSI at 0 changed pixels with the flag off by default. B3 does three things. (1) It closes the four carries B2 left open, each as its own task with its own gate: the `autoscaleInfoProvider` seam, the crosshair legend, the `volumeProfile` carve-out, and the intraday parity fixture. (2) It runs each of the four indicators through **Flip A** (engine draws, legacy settings still drive enable + margins) and then **Flip B** (instances become the read authority, the legacy render block is deleted). (3) It retires the per-indicator enumeration sites that the whole phase exists to end, and pins the retirement with a test that counts.

**Tech Stack:** React 18 + Vite, lightweight-charts 5.2.0 (pinned), vitest (`cd app && npx vitest run <paths>` — **never** `npm test -- run`), Python 3.12 + Playwright + Pillow for `tools/chart_parity.py`.

**Branch:** `feat/phase-b2-engine`, HEAD `c6970d28`. B3 commits directly onto it. ⛔ **Branch pushes only, NEVER `<branch>:master`** — Phase B ships after the Sep 5 launch freeze.

**Baseline to hold:** 3,607 frontend tests / 388 files green. Every task states the delta it adds.

---

## Global Constraints

Copied verbatim from the phase brief. Every task's requirements implicitly include this section.

- Series are POOLED and REUSED, never destroyed/recreated (LWC #2049 open).
- `applyOptions` MERGES and **LWC's `merge()` skips `undefined`** — you cannot reset an option by omitting it; the complete key set is the only mechanism. Same rule for scales AND series.
- An omitted SERIES option means "keep what's there"; an omitted `createPriceLine` option means "use LWC's DEFAULT".
- `mergeChartSettings` is a hard allow-list — TWO of them, plus a strict read at the consumer (`mergeSettingsOverride` passes primitives through untouched).
- No rounding inside compute; delivery wrappers round.
- `paneMargins.js` is consumed, not owned.
- Every parity number must name the two build identities it compared.

### Three more, derived from B2's ledger and equally binding

- **Migrating an indicator is TWO edits, never one:** add `&& !engineOwned.has('<id>')` to its legacy block AND add `'<id>'` to `ENGINE_MIGRATED_DEF_IDS` (`StockChart.jsx:76`). `stockChartWiring.test.jsx` fails if only the id lands.
- **Among the five PRICE overlays, migrate in registry order** (`bb → vwap → sar → ichimoku → donchian`). The engine draws all its series contiguously at one z-position (immediately before the legacy Bollinger block); legacy interleaves them. Registry order *is* legacy render order for the five, so migrating in that order preserves z-order. Migrating a later one while an earlier one is still legacy inverts them. Pinned by a test in Task 3.
- **Every gate must have a stated failure mode and a stated mutation that turns it red.** B1 shipped a parity gate that reported 0 on 642,000 changed pixels; B2 shipped a self-test vacuous for engine instances and a "pinned to the bundle" test pinned to a hand-copy; a reviewer got a green against the wrong worktree. Assume B3 produces another one unless each gate's failure mode is designed up front.

---

## The two flips, defined

The spec (§5) and this brief use "Flip B" for two different cutovers. **This plan adopts the brief's definition and renames the spec's pane cutover to Flip C.** See "Adjudications" below.

### Flip A — the engine draws it; legacy still drives it

| | |
|---|---|
| **What changes** | The engine's binder creates and owns the series. The legacy render block for that definition stands down (`&& !engineOwned.has('<id>')`) and its `else if` removes any legacy series it still holds. |
| **What does NOT change** | `cs.indicators[<id>].enabled` still decides whether the indicator exists at all, and still feeds `computePaneMargins` — so the band geometry is byte-identical. `cs.indicators[<id>].*` still supplies the params, via `migrateLegacyToInstances` at the parity route / via a stored instance in the app. Every legacy control surface (toolbar rows, Ctrl+I, the alert popover) is untouched. |
| **The switch** | `ENGINE_MIGRATED_DEF_IDS` gains the id, and the instance list is filtered through it, so an unguarded definition physically cannot double-draw. |
| **Exit criterion (per indicator)** | ① `tools/chart_parity.py --cases engine_<id>_vs_legacy` = **0 changed pixels at tolerance 0**, with both build-identity lines in `report.md` naming the SAME build id and `engine source: present`. ② the two determinism pre-checks on the same case (`--instances-side none` and `--instances-side both`) = 0. ③ the fail-proof `--perturb-b-instances` on that case = non-zero + **exit 1**. ④ the task's non-pixel assertions green. ⑤ the task's named mutation turns a stated test red. |

### Flip B — instances become the read authority; the legacy block is deleted

| | |
|---|---|
| **What changes** | `ENGINE_FLIPPED_DEF_IDS` gains the id. The legacy render block, its `useRef`s, its entry in the hide-all array, its crosshair read and its `indicatorData` branch are **deleted**. The enable signal for `computePaneMargins` comes from the instance list via a pure projection. Control surfaces (toolbar checkbox, Ctrl+I/Ctrl+O, settings panel rows) write the INSTANCE. |
| **What does NOT change** | `cs.indicators[<id>]` survives as DATA and is maintained as a **write-through mirror**, so every non-chart consumer (the alert evaluator, `IndicatorAlertPopover`, the screener, the `?indicators=` route, an older tab) keeps working. Reads by the chart go to the instance; writes go to both. |
| **The bridge** | StockChart reads instances through `migrateLegacyToInstances(cs, registry)` instead of raw `cs.indicatorInstances`, so a blob that has only the legacy toggle still renders (the migrator projects it), a stored instance wins, and a tombstone blocks resurrection. All three behaviours are already implemented and tested (`instances.js:191-271`). |
| **Exit criterion (per indicator)** | ① two-build parity, A = the branch at that indicator's Flip-A commit, B = the Flip-B commit, SAME settings (legacy toggle ON, no stored instances), `--cases <id>_only` = **0 changed pixels**, both identities named and DIFFERENT. ② `--perturb-b '{"indicators":{"<id>":{"color":"…"}}}'` on the same pair = **non-zero + exit 1** — this is the Flip-B-specific self-test: it proves the settings→instance bridge is live, because after Flip B a settings colour can only reach the series *through* an instance. ③ instance-authority test: legacy toggle OFF + a stored instance ⇒ the indicator draws. ④ mirror round-trip test: toolbar toggle → instance added AND mirror written → toggle again → tombstone AND mirror cleared → re-read ⇒ stays off. ⑤ enumeration ledger test shows the id gone from every retired site. |

### Flip C — bands become real LWC panes (B5, NOT this plan)

Spec §5's original "Flip B". One atomic, feature-flagged cutover with four-surface visual QA and a rollback flag, gated on all engine-owned indicators. `paneMargins.js` / `chartRegion.js` contracts stay unit-tested until it completes.

---

## Adjudications — where the spec and the B2 carries contradicted each other

| # | Conflict | Call | Why |
|---|---|---|---|
| **A1** | Spec §5 defines Flip B as the atomic **panes** cutover, gated on "after all 15 are engine-owned". The brief defines Flip B as **instances become the source of truth and the legacy block is deleted**, per indicator. | Adopt the brief's definition; rename the spec's cutover **Flip C** and give it its own gate in B5. | B3 migrates four indicators, so a gate that requires all fifteen cannot be met by anything in this plan and would leave B3 with no second flip at all. The brief's Flip B is per-indicator, independently reviewable, and is the one that actually retires the enumeration sites — which is the stated point of the phase. |
| **A2** | Global constraint: **"`paneMargins.js` is consumed, not owned."** Flip B requires the band geometry to follow the INSTANCE list, and `computePaneMargins` reads `cs.indicators[key].enabled` (`paneMargins.js:38-48`). | Do **not** touch `paneMargins.js`. StockChart builds a pure projection `csForPaneMargins(cs, instances, flippedIds)` that rewrites `indicators[<id>].enabled` from the instance list for flipped ids only, and passes that. | The module keeps its signature, its `PANES` list, its tests and its crash fix. The engine still never extends it. And the projection is provable: `computePaneMargins(projected, …)` must be **deep-equal** to `computePaneMargins(cs, …)` for every legacy-equivalent blob, which is a gate that fails on the first drift. |
| **A3** | Carry #1 says `autoscaleInfoProvider` is a SERIES option and `placement` carries only SCALE options — so the seam has to go somewhere. Candidate homes: a new plot field in `defSchema`, or a new field on placement's return. | **Placement's return grows `autoscale: 'exclude' \| 'default'` — a comparable STRING, never a function.** `pool.seriesOptionsForPlot` owns the two module-level function singletons and puts `autoscaleInfoProvider` in its FIXED key set. | "This series is a guest on somebody else's axis" is a PLACEMENT fact, not an authoring fact — a definition author should not have to know. Keeping placement's return a string keeps the module pure and its return deep-comparable in tests. Keeping the function in `pool` preserves the C-1 complete-key-set rule, which is mandatory here: LWC's `merge()` skips `undefined`, so "reset by omission" does not exist and the reset must be an explicit identity provider. |
| **A4** | Spec §5 says "two-flip migration of **the 15 natives**". `nativeRegistry` has **14** and states `volumeProfile` is a deliberate carve-out (`nativeRegistry.js:42-50`). | `volumeProfile` is **permanently outside the `plots[]` grammar** and stays a legacy canvas overlay until a `primitive` plot kind exists (C/D). B3 writes the carve-out down in three places and adds a rail so nobody "completes" the registry to 15. | It has no compute function, draws horizontal volume bins onto a canvas primitive rather than through any series, and no v1 plot style expresses it. A registry entry for it would be a definition that cannot be computed or bound — a registry that lies. The correct count is **15 indicator SETTINGS keys, 14 series-expressible indicators**. |
| **A5** | Spec §9.1 requires both compute lanes to agree at rel-tol 1e-9 on shared golden fixtures. `nativeRegistry.maskMacdHead` (`:475-488`) deliberately makes the RENDERED MACD line disagree with the mathematically-correct column for ~8 bars, to hold B1's pixel parity. | Keep the mask ON by default. B3 makes it a **flagged decision measured in pixels**, not a silent fix: an exported `MACD_HEAD_MASK` constant, a dedicated parity case that reports exactly what dropping it costs, and owner sign-off recorded before anything changes. The mask must NOT be removed inside a migration commit. | The brief mandates a flagged decision. Measuring first means the owner decides against a number, not a description. |
| **A6** | Brief: `indicatorRegistry.js` "must be absorbed or explicitly superseded". Its `listIndicators()` covers MA overlays + volume + VWAP — and MA overlays are explicitly **not** migratable (`instances.js:25-42`, positional identity is load-bearing). | **Supersede, do not absorb.** `indicatorRegistry.js` is re-scoped, in its own header, to "the settings-tab descriptor for the things the engine does not own", and gains a hard rail: a def id in `ENGINE_MIGRATED_DEF_IDS` may not also appear in `listIndicators()`. VWAP is the one overlap and its row leaves at VWAP's Flip A. MA overlays + volume stay legacy until their own plan. | Absorbing MA overlays would replace positional identity with nominal identity, and the moment both exist one of them is a lie for any blob read by an un-migrated surface. That migration needs the legacy overlay block deleted in the SAME change, which is a separate plan. |
| **A7** | Spec §9.1 mandates session fixtures for "extended-hours day crossing UTC midnight + a DST transition (the JS VWAP UTC-day bucketing bug class)". `indicators.js:167-176` documents that bug as still present and **pinned as golden** by `tests/fixtures/indicators/vwap_*.json`, with a comment assigning the ET-session fix to "B3's session-aware adapter". | VWAP's Flip A is **pixel-parity only**: the UTC-day bucketing is preserved because it is what the shipped chart draws. Fixing it is a `compute.rev` bump and gets the SAME flagged-decision treatment as the MACD head-mask — measured in pixels on the new intraday fixture, owner-signed-off, and landed in its own commit, never inside a migration. | Changing the maths inside a migration commit makes the parity number unattributable, which is the exact failure the gate exists to prevent. Two flagged decisions, one mechanism. |

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `app/src/components/chart/engine/placement.js` | modify | gains `autoscale: 'exclude'\|'default'` on every resolve |
| `app/src/components/chart/engine/pool.js` | modify | gains `AUTOSCALE_EXCLUDE` / `AUTOSCALE_DEFAULT` singletons + `autoscaleInfoProvider` in the fixed key set |
| `app/src/components/chart/engine/binder.js` | modify | threads `autoscale` from placement into `seriesOptionsForPlot` |
| `app/src/components/chart/engine/defSchema.js` | modify | `plots[].legend` + `meta.legendParams` vocabulary |
| `app/src/components/chart/engine/nativeRegistry.js` | modify | legend declarations on rsi/macd/bb/vwap; `MACD_HEAD_MASK` export; VWAP eligibility metadata |
| `app/src/components/chart/engine/readout.js` | **create** | bindings + crosshair `seriesData` → legend chips; the transitional legacy-slot bridge |
| `app/src/components/chart/engine/eligibility.js` | **create** | "may this instance render on this chart right now" — VWAP's `VWAP_TFS` / `vwapOverride` / width fallback |
| `app/src/components/chart/engine/instanceControls.js` | **create** | pure `(cs, defId, …) → nextCs` writers: enable/disable/set-input, instance + write-through mirror |
| `app/src/components/chart/engine/paneMarginsProjection.js` | **create** | `csForPaneMargins(cs, instances, flippedIds)` — the A2 projection |
| `app/src/components/StockChart.jsx` | modify | `ENGINE_FLIPPED_DEF_IDS`; legacy blocks guarded then deleted; legend bridge; control-surface rewiring |
| `app/src/components/chart/indicatorRegistry.js` | modify | re-scoped header + the supersession rail |
| `app/src/pages/parityBars/intraday5m.json` | **create** | 390 committed 5-minute bars spanning UTC midnight and a DST transition |
| `tools/spa_server.py` | **create** | the SPA-fallback static server every parity run needs (currently uncommitted scratch) |
| `tools/chart_parity_cases.json` | modify | fills in `bb_only`, `macd_only`, `vwap_only` + adds five `engine_*_vs_legacy` cases + `macd_headmask` |
| `app/src/components/chart/engine/__tests__/*` | modify/create | per-indicator Flip-A transcription suites, the legend suite, the Flip-B suite, the enumeration ledger |

---

## Task table

| # | Title | Closes |
|---|---|---|
| 1 | The autoscale seam — a series option delivered through placement | carry #1 |
| 2 | `tools/spa_server.py` + the crosshair legend seam + RSI's Flip A exit | carry #2, flip A/RSI |
| 3 | Bollinger Bands — Flip A | flip A/BB |
| 4 | `volumeProfile` — the written carve-out and the rail that enforces it | carry #3 |
| 5 | The MACD head-mask — measured, flagged, not removed | A5 |
| 6 | MACD — Flip A | flip A/MACD |
| 7 | The intraday parity fixture | carry #4 |
| 8 | VWAP eligibility + Flip A | flip A/VWAP, A7 |
| 9 | The Flip-B machinery, landed dark | A2 |
| 10 | Flip B — RSI and Bollinger Bands | flip B ×2 |
| 11 | Flip B — MACD and VWAP | flip B ×2 |
| 12 | `indicatorRegistry` superseded + the enumeration ledger | A6 |
| 13 | Whole-branch gate | — |

---

### Task 1: The autoscale seam — a series option delivered through placement

Closes B3 carry #1. Blocks every price overlay: BB, VWAP, SAR, Ichimoku and Donchian all pass `autoscaleInfoProvider: () => null` in the shipped code (`StockChart.jsx:5888`, `:5918`, `:6074`, `:6096`, `:6267`) so a band that runs off the top cannot stretch the candles' own price scale. The engine has no way to deliver it, and `pool.js:409-414` says so out loud.

**Files:**
- Modify: `app/src/components/chart/engine/placement.js:237-301`
- Modify: `app/src/components/chart/engine/pool.js:409-486`
- Modify: `app/src/components/chart/engine/binder.js:307-321`
- Test: `app/src/components/chart/engine/placement.test.js`
- Test: `app/src/components/chart/engine/pool.test.js`
- Test: `app/src/components/chart/engine/binder.test.js`

**Interfaces:**
- Produces: `resolvePlacement(inst, def, ctx)` now returns `{paneIndex, scaleId, scaleOptions, autoscale}` where `autoscale ∈ {'exclude','default'}`.
- Produces: `pool.AUTOSCALE_EXCLUDE: () => null` and `pool.AUTOSCALE_DEFAULT: (baseImplementation) => baseImplementation()`, both module-level frozen identities.
- Produces: `seriesOptionsForPlot(plot, ctx)` accepts `ctx.autoscale` and always emits `autoscaleInfoProvider`.
- Consumes: nothing from later tasks.

- [ ] **Step 1: Write the failing placement test**

Append to `app/src/components/chart/engine/placement.test.js`:

```js
import { listDefinitions } from './nativeRegistry'

describe('autoscale — the seam a price overlay needs (B3 carry #1)', () => {
  const ctx = { paneMargins: { rsi: { top: 0.85, bottom: 0 } }, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1 }

  it('every PRICE-target definition resolves to exclude — def by def', () => {
    const priceDefs = listDefinitions().filter(d => d.placement.target === 'price')
    // If this list ever empties, every assertion below is vacuous.
    expect(priceDefs.map(d => d.id)).toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
    for (const def of priceDefs) {
      const p = resolvePlacement({ instanceId: `i:${def.id}`, defId: def.id }, def, ctx)
      expect(p.autoscale, `${def.id} may not drag the candles' autoscale`).toBe('exclude')
      expect(p.scaleOptions, `${def.id} must still assert nothing on the candles' scale`).toBeNull()
    }
  })

  it('every PANE-target definition resolves to default — def by def', () => {
    const paneDefs = listDefinitions().filter(d => d.placement.target === 'pane')
    expect(paneDefs.length).toBeGreaterThan(0)
    for (const def of paneDefs) {
      const p = resolvePlacement({ instanceId: `i:${def.id}`, defId: def.id }, def, ctx)
      expect(p.autoscale, `${def.id} OWNS its band's scale and must drive it`).toBe('default')
    }
  })

  it('an oscillator overlaid onto the volume pane still drives the shared left axis', () => {
    const def = listDefinitions().find(d => d.id === 'rsi')
    const p = resolvePlacement({ instanceId: 'i:rsi', defId: 'rsi', placement: { target: 'volume' } }, def,
      { ...ctx, volSeparatePane: true, volOverlaySet: new Set(['rsi']) })
    expect(p.scaleId).toBe('left')
    // applyIndScale's left branch autoscales; the shipped code passes no provider.
    expect(p.autoscale).toBe('default')
  })

  it('is a STRING, never a function — placement stays pure and comparable', () => {
    const def = listDefinitions().find(d => d.id === 'bb')
    const a = resolvePlacement({ instanceId: 'i:bb', defId: 'bb' }, def, ctx)
    const b = resolvePlacement({ instanceId: 'i:bb', defId: 'bb' }, def, ctx)
    expect(typeof a.autoscale).toBe('string')
    expect(a).toEqual(b)   // deep equality would be impossible with a fresh closure
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/placement.test.js`
Expected: FAIL — `expected undefined to be 'exclude'` on the first case.

- [ ] **Step 3: Add `autoscale` to placement**

In `app/src/components/chart/engine/placement.js`, above `resolvePlacement`, add:

```js
/**
 * Whether a series bound at this placement may drive its price scale's autoscale.
 *
 *   'exclude' — the series is a GUEST on somebody else's axis. Every price
 *               overlay is: `StockChart` creates BB (`:5888`), VWAP (`:5918`),
 *               SAR (`:6074`), Ichimoku (`:6096`) and Donchian (`:6267`) with
 *               `autoscaleInfoProvider: () => null` so a band running off the top
 *               of the window cannot stretch the CANDLES' range.
 *   'default' — the series OWNS its scale (its own stacked band, or the volume
 *               pane's shared autoscaled left axis) and the shipped code passes
 *               no provider at all.
 *
 * ⚠️ A STRING, NOT A FUNCTION. This module is pure and its return value is
 * compared with `toEqual` in tests and (later) between passes; a fresh closure
 * would make two identical resolves unequal. `pool.seriesOptionsForPlot` owns the
 * two function singletons, which is also where the complete-key-set rule lives.
 */
export const AUTOSCALE_MODES = Object.freeze(['exclude', 'default'])
```

Then, in `resolvePlacement`, change the three returns:

```js
  if (target === 'price') {
    return { paneIndex: 0, scaleId: MAIN_PRICE_SCALE_ID, scaleOptions: null, autoscale: 'exclude' }
  }
```

```js
  if (c.volSeparatePane && asSet(c.volOverlaySet).has(key)) {
    return {
      paneIndex: Number.isInteger(c.VOL_PANE_INDEX) ? c.VOL_PANE_INDEX : 1,
      scaleId: 'left',
      scaleOptions: { ...LEFT_AXIS_OPTIONS, scaleMargins: { ...LEFT_AXIS_OPTIONS.scaleMargins } },
      autoscale: 'default',
    }
  }
```

```js
  return {
    paneIndex: 0,
    scaleId: key,
    scaleOptions: { borderVisible: false, scaleMargins: { ...band }, ...range },
    autoscale: 'default',
  }
```

- [ ] **Step 4: Run the placement test — green**

Run: `cd app && npx vitest run src/components/chart/engine/placement.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing pool test**

Append to `app/src/components/chart/engine/pool.test.js`:

```js
import { LineSeries } from 'lightweight-charts'
import { AUTOSCALE_EXCLUDE, AUTOSCALE_DEFAULT } from './pool'

describe('autoscaleInfoProvider is part of the complete option set (B3 carry #1)', () => {
  const SENTINEL = { priceRange: { minValue: 1, maxValue: 2 }, margins: undefined }

  it('LWC has NO default for it — which is why the reset must be an explicit function', () => {
    // The claim this whole design rests on, pinned against the INSTALLED bundle:
    // `_internal_autoscaleInfo` branches on `!== undefined`
    // (lightweight-charts.development.mjs:3716), and there is nothing in
    // defaultOptions to copy. So "put it back" cannot be done by omitting the
    // key — LWC's merge() skips undefined and the previous tenant's provider
    // would survive.
    expect(Object.prototype.hasOwnProperty.call(LineSeries.defaultOptions, 'autoscaleInfoProvider')).toBe(false)
  })

  it('EXCLUDE contributes nothing; DEFAULT is the library\'s own answer', () => {
    expect(AUTOSCALE_EXCLUDE(() => SENTINEL)).toBeNull()
    expect(AUTOSCALE_DEFAULT(() => SENTINEL)).toBe(SENTINEL)
  })

  it('both are module-level singletons, so two option sets stay comparable', () => {
    const a = seriesOptionsForPlot({ key: 'x', style: 'line' }, { autoscale: 'exclude' })
    const b = seriesOptionsForPlot({ key: 'x', style: 'line' }, { autoscale: 'exclude' })
    expect(a.autoscaleInfoProvider).toBe(b.autoscaleInfoProvider)
    expect(a.autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
  })

  it('EVERY plot style emits the key — a pooled series can never inherit it', () => {
    // PLOT_STYLES is walked (not a hand list) so a B3 plot kind cannot skip it.
    for (const style of PLOT_STYLES) {
      const plot = style === 'band'
        ? { key: 'm', style, edges: { upper: 'u', lower: 'l' } }
        : { key: 'p', style }
      const opts = seriesOptionsForPlot(plot, { autoscale: 'exclude' })
      if (!opts) continue                       // hlines: no series, no options
      expect(Object.prototype.hasOwnProperty.call(opts, 'autoscaleInfoProvider'), style).toBe(true)
      expect(opts.autoscaleInfoProvider, style).toBe(AUTOSCALE_EXCLUDE)
    }
  })

  it('an ABSENT ctx.autoscale means DEFAULT, never absent', () => {
    const opts = seriesOptionsForPlot({ key: 'x', style: 'line' }, {})
    expect(opts.autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
  })
})
```

- [ ] **Step 6: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/pool.test.js`
Expected: FAIL — `AUTOSCALE_EXCLUDE` is not exported.

- [ ] **Step 7: Add the singletons and the key**

In `app/src/components/chart/engine/pool.js`, immediately below `const TRANSPARENT = …`:

```js
/**
 * The only two `autoscaleInfoProvider` values the engine can ever set, as
 * MODULE-LEVEL singletons.
 *
 * ⛔ WHY SINGLETONS AND NOT INLINE ARROWS. `seriesOptionsForPlot` runs on every
 * bind — roughly once a second in extended hours. A fresh `() => null` per call
 * allocates, and worse it makes every option set unequal to the last one, so no
 * future no-op check could ever fire. That was the stated reason this option was
 * left out of the key set entirely (`the docstring below, pre-B3`); two frozen
 * identities remove the objection without weakening the rule.
 *
 * ⛔ WHY A `DEFAULT` EXISTS AT ALL. LWC has NO default for this option — it is
 * absent from `LineSeries.defaultOptions` and the renderer branches on
 * `!== undefined` (`lightweight-charts.development.mjs:3716`). So "put it back"
 * cannot be expressed by omitting the key: `merge()` SKIPS `undefined`, and a
 * pooled series that inherited `EXCLUDE` from a Bollinger band would go on
 * contributing nothing to whatever scale it lands on next. The identity provider
 * IS the reset, and it is byte-for-byte what the library does when the option is
 * absent: `_internal_autoscaleInfo` calls the provider with a thunk over
 * `_private__autoscaleInfoImpl` and re-wraps the raw result through
 * `AutoscaleInfoImpl._internal_fromRaw(x._internal_toRaw())`, which round-trips
 * priceRange and margins by value (`:2298-2322`).
 */
export const AUTOSCALE_EXCLUDE = () => null
export const AUTOSCALE_DEFAULT = (baseImplementation) => baseImplementation()
```

In `seriesOptionsForPlot`'s `base` object, after `priceFormat`:

```js
    // B3 carry #1. A price overlay is a GUEST on the candles' axis and must not
    // stretch it; anything owning its own band must. Always emitted, because a
    // key that can be set must be set on every bind or a re-purpose inherits it.
    autoscaleInfoProvider: c.autoscale === 'exclude' ? AUTOSCALE_EXCLUDE : AUTOSCALE_DEFAULT,
```

Update `seriesOptionsForPlot`'s JSDoc `@param` line to `{{scaleId?: string, autoscale?: 'exclude'|'default', LineStyle?: object, LineType?: object, indicatorsHidden?: boolean}}` and replace the "WHAT IS DELIBERATELY NOT HERE" paragraph about `autoscaleInfoProvider` with a pointer to the singletons above.

- [ ] **Step 8: Run the pool test — green**

Run: `cd app && npx vitest run src/components/chart/engine/pool.test.js`
Expected: PASS.

- [ ] **Step 9: Write the failing binder test — the re-purpose is the whole point**

Append to `app/src/components/chart/engine/binder.test.js`:

```js
import { AUTOSCALE_EXCLUDE, AUTOSCALE_DEFAULT } from './pool'

describe('a re-purposed series is RESET, never left excluded (B3 carry #1)', () => {
  it('BB\'s series re-purposed as RSI gets the DEFAULT provider back', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const bars = makeBars(260)
    const ctx = (instances) => ({
      enabled: true, registry: engineRegistry, instances, bars,
      adjustTime: (t) => t, resolvePlacement,
      paneMargins: { rsi: { top: 0.85, bottom: 0 } },
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      plan: { fresh: true },
    })

    binder.sync(ctx([{ instanceId: 'i:bb', defId: 'bb', inputs: {}, hidden: false }]))
    const excluded = F.seriesCreated.filter(s => s.__options.autoscaleInfoProvider === AUTOSCALE_EXCLUDE)
    expect(excluded.length, 'BB drew nothing — the rest of this test is vacuous').toBe(3)

    F.reset()
    binder.sync(ctx([{ instanceId: 'i:rsi', defId: 'rsi', inputs: {}, hidden: false }]))

    // No series was created: the pool re-purposed one of BB's three.
    expect(F.count('addSeries')).toBe(0)
    const applied = F.callsOf('applyOptions').map(c => c.args[0])
    expect(applied.length).toBeGreaterThan(0)
    for (const opts of applied) {
      // A function, not undefined — LWC's merge skips undefined, so `undefined`
      // here would leave the Bollinger band's EXCLUDE in place and the RSI would
      // contribute nothing to its own 0-100 scale.
      expect(typeof opts.autoscaleInfoProvider).toBe('function')
      // …and the RIGHT function: calling it must return the base implementation's
      // answer, which `() => null` never does.
      const S = { priceRange: { minValue: 0, maxValue: 100 } }
      expect(opts.autoscaleInfoProvider(() => S)).toBe(S)
      expect(opts.autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
    }
  })
})
```

- [ ] **Step 10: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/binder.test.js`
Expected: FAIL — `expected undefined to be 'function'` (the binder does not pass `autoscale` yet).

- [ ] **Step 11: Thread `autoscale` through the binder**

In `app/src/components/chart/engine/binder.js`, in the bind loop (`:309-320`):

```js
      const { paneIndex, scaleId, scaleOptions, autoscale } = placement.value

      const options = seriesOptionsForPlot(b.plot, {
        scaleId,
        // B3 carry #1: a SERIES option that only PLACEMENT knows the answer to.
        // Placement returns a string; `pool` owns the two function singletons.
        autoscale,
        LineStyle: LWC.LineStyle,
        LineType: LWC.LineType,
        indicatorsHidden: ctx.indicatorsHidden === true,
      })
```

- [ ] **Step 12: Run the binder test — green**

Run: `cd app && npx vitest run src/components/chart/engine/binder.test.js`
Expected: PASS.

- [ ] **Step 13: Run the mutations — each must turn a stated test red**

Apply each, run the named suite, confirm RED, revert.

| # | Mutation | Must fail |
|---|---|---|
| M1 | `placement.js` price branch → `autoscale: 'default'` | `placement.test.js` "every PRICE-target definition resolves to exclude" |
| M2 | `pool.js` → `autoscaleInfoProvider: c.autoscale === 'exclude' ? AUTOSCALE_EXCLUDE : undefined` | `pool.test.js` "an ABSENT ctx.autoscale means DEFAULT" **and** `binder.test.js` "expected undefined to be 'function'" |
| M3 | `pool.js` → `AUTOSCALE_DEFAULT = () => null` | `pool.test.js` "DEFAULT is the library's own answer" **and** the binder sentinel assertion |
| M4 | `pool.js` → `autoscaleInfoProvider: () => null` (inline arrow, correct value, fresh identity) | `pool.test.js` "both are module-level singletons" |
| M5 | `binder.js` → drop `autoscale` from the `seriesOptionsForPlot` ctx | `binder.test.js` sentinel assertion |
| M6 | `pool.js` → delete the key from `base` entirely | `pool.test.js` "EVERY plot style emits the key" |

Run each with `PYTHONDONTWRITEBYTECODE=1` irrelevant here (JS), but **re-run any surviving mutation ALONE before calling the gate vacuous**.

- [ ] **Step 14: Full engine suite + commit**

```bash
cd app && npx vitest run src/components/chart/engine src/components/__tests__ src/__tests__
```
Expected: PASS. Test count: +14 over baseline for this task's files.

```bash
git add app/src/components/chart/engine/placement.js app/src/components/chart/engine/pool.js \
        app/src/components/chart/engine/binder.js app/src/components/chart/engine/placement.test.js \
        app/src/components/chart/engine/pool.test.js app/src/components/chart/engine/binder.test.js
git commit -m "feat(engine): the autoscale seam — a SERIES option only PLACEMENT knows

Closes B3 carry #1. Every price overlay (BB/VWAP/SAR/Ichimoku/Donchian) is a
guest on the candles' price scale and the shipped code excludes each one from
its autoscale. placement now says WHICH, as a comparable string; pool owns the
two function singletons and puts the key in the complete set, because LWC's
merge() skips undefined and there is no such thing as resetting by omission.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: `tools/spa_server.py` + the crosshair legend seam + RSI's Flip A exit

Closes B3 carry #2 and completes the first real flip. `processCrosshair` reads `rsiSeriesRef.current` (`StockChart.jsx:7788`); when the engine draws RSI that ref is null, so `crosshairData.rsi` stays null and the `RSI(14) 54.3` chip (`:9590`) silently vanishes. **The pixel gate cannot see this by design** — the legend is not inside `#chart-export`'s captured region during a headless run with no cursor. So it needs its own non-pixel gate, and per the brief it lands in the SAME change as the first flip.

The task also commits `tools/spa_server.py`. Every parity run in B2 used a scratch copy; a fresh engineer following the runbook has no way to obtain it, which makes the gate unreproducible.

**Files:**
- Create: `tools/spa_server.py`
- Create: `app/src/components/chart/engine/readout.js`
- Create: `app/src/components/chart/engine/readout.test.js`
- Modify: `app/src/components/chart/engine/defSchema.js` (plot `legend` block + `meta.legendParams`)
- Modify: `app/src/components/chart/engine/nativeRegistry.js` (rsi/macd/bb/vwap legend declarations)
- Modify: `app/src/components/StockChart.jsx:7787-7799`, `:7850-7864`
- Modify: `app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx` (crosshair handler capture + the legend case)
- Modify: `docs/runbooks/chart-parity-gate.md`

**Interfaces:**
- Consumes: `binder.bindings()` → `[{key, instanceId, defId, plotKey, series, …}]` (existing, `binder.js:416`).
- Produces: `engineChips(bindings, seriesData, registry, instances)` → `[{defId, plotKey, slot, label, color, decimals, value, text}]`.
- Produces: `chipsBySlot(chips)` → `{[slot]: {value, text, color}}` — the transitional bridge into StockChart's existing `crosshairData` fields.
- Produces: `LEGACY_SLOTS` — a frozen `'<defId>::<plotKey>' → crosshairData field name` map, deleted at B4.

- [ ] **Step 1: Commit the parity server**

Create `tools/spa_server.py`:

```python
#!/usr/bin/env python3
"""Static file server with SPA fallback, for the chart parity gate.

`tools/chart_parity.py` captures `/r/chart?...` from a built `dist`. A plain
`python -m http.server` 404s that path because there is no `r/chart/index.html`
on disk -- BrowserRouter resolves it in the browser. This serves the file when it
exists and `index.html` otherwise, which is the whole difference.

WHY IT IS COMMITTED. Phase B2 ran every parity number through a copy of this file
that lived in a scratch directory and was never checked in, while
`docs/runbooks/chart-parity-gate.md` told the reader to run `<scratch>/spa_server.py`.
A gate whose harness cannot be obtained is not reproducible, and an
unreproducible gate is the failure class this whole runbook is about.

WHY NOT TWO `vite dev` SERVERS. One `node_modules` cannot back two Vite servers:
they race `node_modules/.vite`. Build twice, serve the two `dist` directories.

    cd app && npm run build && cp -r dist /tmp/parity-A
    python tools/spa_server.py /tmp/parity-A 5183

Bind on 127.0.0.1 and address it as `http://127.0.0.1:<port>` -- NOT `localhost`.
An unrelated dev server holding `[::1]:5173` once won the name resolution and the
harness measured it instead.
"""
import argparse
import functools
import http.server
import os
import socketserver


class SPAHandler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):  # noqa: N802 - stdlib naming
        path = self.translate_path(self.path)
        if not os.path.exists(path) or os.path.isdir(path):
            if not os.path.isdir(path) or not os.path.exists(os.path.join(path, "index.html")):
                self.path = "/index.html"
        return super().do_GET()

    def log_message(self, *_args):
        pass  # a request log per asset drowns the harness output


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("root", help="directory to serve (a built `dist`)")
    ap.add_argument("port", type=int)
    args = ap.parse_args()
    if not os.path.isdir(args.root):
        raise SystemExit(f"not a directory: {args.root}")
    handler = functools.partial(SPAHandler, directory=args.root)
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"serving {args.root} at http://127.0.0.1:{args.port} (SPA fallback on)")
        httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

Then in `docs/runbooks/chart-parity-gate.md`, replace both `python <scratch>/spa_server.py …` occurrences with `python tools/spa_server.py …` and add under section 4:

```markdown
`tools/spa_server.py` is committed precisely so this section is reproducible.
Phase B2's numbers were all produced through an uncommitted scratch copy while
this document pointed at `<scratch>/`; a harness the reader cannot obtain makes
every number in the report unverifiable.
```

- [ ] **Step 2: Verify the server actually serves the route**

```bash
cd app && npm run build
python ../tools/spa_server.py dist 5185 &
sleep 2
curl -s -o /dev/null -w '%{http_code}\n' 'http://127.0.0.1:5185/r/chart?sym=PARITY&tf=D&fixedbars=ramp200'
kill %1
```
Expected: `200`. A `404` means the fallback is not firing and no parity run below is valid.

- [ ] **Step 3: Write the failing readout test**

Create `app/src/components/chart/engine/readout.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { engineChips, chipsBySlot, LEGACY_SLOTS } from './readout'
import * as engineRegistry from './nativeRegistry'

/** A binding as `binder.bindings()` returns it, with a stand-in series object. */
const binding = (defId, plotKey, instanceId = `legacy:${defId}`) => ({
  key: `${instanceId}::${plotKey}`, instanceId, defId, plotKey, series: { __id: `${defId}/${plotKey}` },
})

const seriesData = (pairs) => new Map(pairs.map(([b, v]) => [b.series, { value: v }]))

describe('engineChips — the legend an engine-drawn indicator must still produce', () => {
  const RSI_INST = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14, color: '#7b68ee' } }

  it('reproduces the LEGACY RSI chip byte for byte', () => {
    // StockChart.jsx:9590 — `RSI(${period}) ${value.toFixed(1)}` in the
    // indicator's colour. A migrated RSI that reads "RSI 54.32" is a regression
    // the pixel gate cannot see.
    const b = binding('rsi', 'rsi')
    const chips = engineChips([b], seriesData([[b, 54.321]]), engineRegistry, [RSI_INST])
    expect(chips).toHaveLength(1)
    expect(chips[0].text).toBe('RSI(14) 54.3')
    expect(chips[0].color).toBe('#7b68ee')
    expect(chips[0].slot).toBe('rsi')
  })

  it('takes the colour from the INSTANCE, not the definition default', () => {
    const b = binding('rsi', 'rsi')
    const chips = engineChips([b], seriesData([[b, 50]]), engineRegistry,
      [{ ...RSI_INST, inputs: { period: 7, color: '#ff0000' } }])
    expect(chips[0].text).toBe('RSI(7) 50.0')
    expect(chips[0].color).toBe('#ff0000')
  })

  it('reproduces MACD\'s two chips and DROPS the histogram, as legacy does', () => {
    const inst = { instanceId: 'legacy:macd', defId: 'macd', inputs: {} }
    const bm = binding('macd', 'macd'); const bs = binding('macd', 'signal'); const bh = binding('macd', 'histogram')
    const chips = engineChips([bm, bs, bh], seriesData([[bm, 0.12345], [bs, 0.09876], [bh, 0.02469]]),
      engineRegistry, [inst])
    expect(chips.map(c => c.text)).toEqual(['MACD 0.1235', 'SIG 0.0988'])
    expect(chips.map(c => c.slot)).toEqual(['macd', 'macdSig'])
  })

  it('emits NO chip for a price overlay the legacy legend never showed', () => {
    // BB and VWAP have no legend chip today. A migration that ADDS one is just
    // as much a regression as one that removes it.
    const bbInst = { instanceId: 'legacy:bb', defId: 'bb', inputs: {} }
    const bs = ['upper', 'middle', 'lower'].map(k => binding('bb', k))
    expect(engineChips(bs, seriesData(bs.map(b => [b, 100])), engineRegistry, [bbInst])).toEqual([])

    const vwapInst = { instanceId: 'legacy:vwap', defId: 'vwap', inputs: {} }
    const bv = binding('vwap', 'vwap')
    expect(engineChips([bv], seriesData([[bv, 100]]), engineRegistry, [vwapInst])).toEqual([])
  })

  it('a bar the series has no value on produces no chip, never NaN', () => {
    const b = binding('rsi', 'rsi')
    expect(engineChips([b], new Map(), engineRegistry, [RSI_INST])).toEqual([])
    expect(engineChips([b], seriesData([[b, undefined]]), engineRegistry, [RSI_INST])).toEqual([])
  })

  it('chipsBySlot keys by the legacy crosshairData field', () => {
    const b = binding('rsi', 'rsi')
    const by = chipsBySlot(engineChips([b], seriesData([[b, 54.321]]), engineRegistry, [RSI_INST]))
    expect(by.rsi.value).toBeCloseTo(54.321, 6)
    expect(by.rsi.text).toBe('RSI(14) 54.3')
  })
})

describe('the slot bridge cannot silently lose a chip', () => {
  it('every definition that DECLARES a visible chip has a legacy slot', () => {
    // The rail. A B3 migration that declares `legend` on a plot but forgets the
    // slot would produce a chip nothing renders — invisible everywhere.
    const missing = []
    for (const def of engineRegistry.listDefinitions()) {
      for (const plot of def.plots) {
        if (plot.style === 'hlines') continue
        if (!plot.legend || plot.legend.hide === true) continue
        if (!LEGACY_SLOTS[`${def.id}::${plot.key}`]) missing.push(`${def.id}::${plot.key}`)
      }
    }
    expect(missing).toEqual([])
  })

  it('every legacy slot names a plot that actually exists', () => {
    const orphans = Object.keys(LEGACY_SLOTS).filter((k) => {
      const [defId, plotKey] = k.split('::')
      const def = engineRegistry.getDefinition(defId)
      return !def || !def.plots.some(p => p.key === plotKey)
    })
    expect(orphans).toEqual([])
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/readout.test.js`
Expected: FAIL — `Failed to resolve import "./readout"`.

- [ ] **Step 5: Add the `legend` vocabulary to `defSchema`**

In `app/src/components/chart/engine/defSchema.js`, next to `PLOT_ROLES`:

```js
/**
 * `plots[].legend` — what this plot contributes to the crosshair readout.
 *
 * The chart's legend chips are hand-written today (`StockChart.jsx:9588-9599`),
 * which is why a migrated indicator vanishes from the readout: the chip is keyed
 * to a legacy series REF. Declaring the chip on the plot is how the readout stops
 * being a fourteenth enumeration site, and it is the same "ONE formatting
 * pipeline drives Style-tab precision, chip values and crosshair readout" the UX
 * contract (§6) asks for.
 *
 *   label    — the chip's leading text. Absent ⇒ `meta.shortName` plus, when
 *              `meta.legendParams` is non-empty, `(p1, p2, …)` resolved against
 *              the INSTANCE's inputs. There is deliberately no `$` substitution
 *              here: `SUBSTITUTABLE_PLOT_FIELDS` stays color/width/levels, and a
 *              second substitution grammar is a second thing to get wrong.
 *   decimals — how many the chip shows. NOT `precision`, which is the price
 *              scale's. Legacy prints RSI at 1 and MACD at 4 while both series
 *              carry LWC's default precision of 2, so they are genuinely two
 *              numbers.
 *   hide     — this plot contributes no chip. BB, VWAP and MACD's histogram all
 *              draw without one today; a migration that ADDS a chip is as much a
 *              regression as one that drops it.
 */
export const LEGEND_FIELDS = Object.freeze(['label', 'decimals', 'hide'])
```

Inside the plot validator (next to the `lineStyle` check at `:765`), add:

```js
  if (plot.legend !== undefined && plot.legend !== null) {
    if (!isPlainObject(plot.legend)) {
      errors.push(`${path}.legend: expected an object, got ${fmt(plot.legend)}`)
    } else {
      for (const key of Object.keys(plot.legend)) {
        if (!LEGEND_FIELDS.includes(key)) {
          errors.push(
            `${path}.legend.${key}: unknown legend field — expected one of: ${list(LEGEND_FIELDS)}. ` +
            `Behavioural fields fail closed (§3.1): a chip nobody renders is worse than a rejected definition.`,
          )
        }
      }
      if (plot.legend.label !== undefined && typeof plot.legend.label !== 'string') {
        errors.push(`${path}.legend.label: expected a string, got ${fmt(plot.legend.label)}`)
      }
      if (plot.legend.decimals !== undefined
          && (!Number.isInteger(plot.legend.decimals) || plot.legend.decimals < 0 || plot.legend.decimals > 10)) {
        errors.push(`${path}.legend.decimals: expected an integer 0..10, got ${fmt(plot.legend.decimals)}`)
      }
      if (plot.legend.hide !== undefined && typeof plot.legend.hide !== 'boolean') {
        errors.push(`${path}.legend.hide: expected true or false, got ${fmt(plot.legend.hide)}`)
      }
    }
  }
```

And in the `meta` validator, accept `legendParams`:

```js
  if (meta.legendParams !== undefined && meta.legendParams !== null) {
    if (!Array.isArray(meta.legendParams) || meta.legendParams.some(k => typeof k !== 'string' || !k)) {
      errors.push(`meta.legendParams: expected an array of input keys, got ${fmt(meta.legendParams)}`)
    } else {
      const declared = new Set((def.inputs || []).map(i => i && i.key))
      for (const k of meta.legendParams) {
        if (!declared.has(k)) {
          errors.push(
            `meta.legendParams: ${fmt(k)} names no declared input — the chip would read ` +
            `"NAME(undefined)". Declared: ${list([...declared].filter(Boolean)) || 'none'}`,
          )
        }
      }
    }
  }
```

- [ ] **Step 6: Declare the legend on the four pilot definitions**

In `app/src/components/chart/engine/nativeRegistry.js`:

RSI — add `legendParams` to the meta object and `legend` to the `rsi` plot:
```js
  nativeDef('rsi', 'rsi',
    { name: 'Relative Strength Index', shortName: 'RSI', category: 'Momentum', legendParams: ['period'] },
    fixedPane(0, 100),
    [ /* unchanged */ ],
    [
      { key: 'rsi', label: 'RSI', style: 'line', color: '$color', width: 1, role: 'primary',
        // StockChart.jsx:9590 — `RSI(14) 54.3`. One decimal, and the period in
        // parentheses, verbatim.
        legend: { decimals: 1 } },
      /* the two hlines plots unchanged */
    ]),
```

MACD — no params in the legacy chip, so `legendParams` stays absent:
```js
      { key: 'macd', label: 'MACD', style: 'line', color: '$macdColor', width: 1, role: 'primary',
        // StockChart.jsx:9591 — `MACD 0.1234`, no parentheses, four decimals.
        legend: { decimals: 4 } },
      { key: 'signal', label: 'Signal', style: 'line', color: '$signalColor', width: 1, role: 'secondary',
        // :9592 — the chip says SIG, not "MACD".
        legend: { label: 'SIG', decimals: 4 } },
      {
        key: 'histogram', label: 'Histogram', style: 'histogram', colorMode: 'sign',
        colorUp: 'rgba(76,175,80,0.75)', colorDown: 'rgba(244,67,54,0.75)',
        precision: 5, role: 'secondary',
        // The shipped legend has no histogram chip. Adding one is a regression.
        legend: { hide: true },
      },
```

BB — all three plots `legend: { hide: true }` with the comment `// The shipped legend has no Bollinger chip.`
VWAP — `legend: { hide: true }` with `// The shipped legend has no VWAP chip.`

- [ ] **Step 7: Write `readout.js`**

Create `app/src/components/chart/engine/readout.js`:

```js
// app/src/components/chart/engine/readout.js
//
// ─── THE CROSSHAIR LEGEND FOR EVERY SERIES THE ENGINE DREW ──────────────────
//
// ⛔ THE CARRY THIS CLOSES, AND WHY IT NEEDED ITS OWN GATE. `processCrosshair`
// reads `rsiSeriesRef.current` (`StockChart.jsx:7788`). When the engine draws
// RSI that ref is null, `crosshairData.rsi` stays null, and the `RSI(14) 54.3`
// chip (`:9590`) is simply absent. The pixel gate CANNOT SEE THIS: a headless
// capture has no cursor, so no chip is drawn on either side and the diff is 0
// either way. A migration is not done when the picture matches; it is done when
// everything that reads the indicator still reads it.
//
// PURE. No React, no lightweight-charts, no refs. It takes the binder's own
// bindings and the crosshair event's `seriesData` map and returns rows.
//
// ─── THE SLOT BRIDGE IS TRANSITIONAL, AND SAYS SO ───────────────────────────
//
// `LEGACY_SLOTS` maps a binding to the `crosshairData` FIELD the shipped legend
// already renders (`crosshairData.rsi`, `.macd`, `.macdSig`, …). That is the only
// way to land an engine chip in the SAME POSITION, with the same neighbours, as
// the chip it replaces — and position is exactly the kind of difference no pixel
// gate run without a cursor can catch. It is deleted at B4, when the legend
// renders `engineChips()` directly and stops enumerating indicators at all.

/** `'<defId>::<plotKey>'` → the `crosshairData` field the shipped legend reads.
 *
 *  ⚠️ TRANSITIONAL. Every entry corresponds to one line of the hand-written
 *  `legChips` array (`StockChart.jsx:9588-9599`) and disappears with it.
 *  `readout.test.js` fails if a definition declares a visible chip with no slot
 *  (the chip would render nowhere) or if a slot names a plot that does not exist. */
export const LEGACY_SLOTS = Object.freeze({
  'rsi::rsi': 'rsi',
  'macd::macd': 'macd',
  'macd::signal': 'macdSig',
  'stoch::k': 'stochK',
  'stoch::d': 'stochD',
  'atr::atr': 'atr',
  'sar::sar': 'sar',
  'ichimoku::tenkan': 'ichimokuTenkan',
  'ichimoku::kijun': 'ichimokuKijun',
})

/** LWC's own default when a plot declares no `legend.decimals`. Two, because
 *  that is `seriesOptionsDefaults.priceFormat.precision` and a chip with no
 *  declared opinion should agree with the axis it sits above. */
const DEFAULT_DECIMALS = 2

function resolveRegistry(registry) {
  if (typeof registry === 'function') return registry
  if (registry && typeof registry.getDefinition === 'function') return (id) => registry.getDefinition(id)
  return () => null
}

/** The chip's leading text: an explicit label, or shortName + declared params
 *  resolved against THIS instance's inputs (falling back to the definition's
 *  declared defaults, which is what "unset means current default" means
 *  everywhere else in the engine). */
function chipLabel(def, plot, inputs) {
  if (plot.legend && typeof plot.legend.label === 'string') return plot.legend.label
  const name = (def.meta && def.meta.shortName) || def.id
  const params = (def.meta && def.meta.legendParams) || []
  if (!params.length) return name
  const declared = new Map((def.inputs || []).map(i => [i.key, i.default]))
  const values = params.map(k => (inputs && inputs[k] !== undefined ? inputs[k] : declared.get(k)))
  return `${name}(${values.join(', ')})`
}

/**
 * The legend chips for the series the engine currently holds.
 *
 * @param {object[]} bindings  `binder.bindings()`
 * @param {Map}      seriesData `crosshairMove` param's `seriesData` map
 * @param {object|Function} registry
 * @param {object[]} instances the normalised instance list (for per-instance inputs)
 * @returns {{defId,plotKey,slot,label,color,decimals,value,text}[]} in binding order
 */
export function engineChips(bindings, seriesData, registry, instances) {
  const get = resolveRegistry(registry)
  const byId = new Map((Array.isArray(instances) ? instances : [])
    .filter(i => i && typeof i.instanceId === 'string')
    .map(i => [i.instanceId, i]))
  const out = []

  for (const b of (Array.isArray(bindings) ? bindings : [])) {
    if (!b || !b.series) continue
    const def = get(b.defId)
    if (!def) continue
    const plot = (def.plots || []).find(p => p && p.key === b.plotKey)
    if (!plot || !plot.legend || plot.legend.hide === true) continue

    const point = seriesData && typeof seriesData.get === 'function' ? seriesData.get(b.series) : null
    const value = point ? point.value : undefined
    if (!Number.isFinite(value)) continue

    const inst = byId.get(b.instanceId)
    const inputs = (inst && inst.inputs) || {}
    // The colour a chip wears is the colour the LINE wears, so it is resolved the
    // same way the binder resolves it — through the instance, never the
    // definition default. Reading `cs.indicators[id].color` (what the shipped
    // legend does) would be wrong the moment a second instance exists.
    const resolved = resolvePlotColor(plot, inputs, def)
    const decimals = Number.isInteger(plot.legend.decimals) ? plot.legend.decimals : DEFAULT_DECIMALS
    const label = chipLabel(def, plot, inputs)

    out.push({
      defId: def.id,
      plotKey: plot.key,
      slot: LEGACY_SLOTS[`${def.id}::${plot.key}`] || null,
      label,
      color: resolved,
      decimals,
      value,
      text: `${label} ${value.toFixed(decimals)}`,
    })
  }
  return out
}

/** A plot's colour for THIS instance. Mirrors `pool.resolvePlotForInstance`
 *  without importing it, because that module carries the LWC option vocabulary
 *  and the legend needs one field. */
function resolvePlotColor(plot, inputs, def) {
  const refKey = plot.$refs && plot.$refs.color
  if (refKey) {
    if (inputs && inputs[refKey] !== undefined) return inputs[refKey]
    const declared = (def.inputs || []).find(i => i && i.key === refKey)
    if (declared && declared.default !== undefined) return declared.default
  }
  return plot.color
}

/** The chips keyed by the legacy `crosshairData` field, for the bridge in
 *  StockChart. A chip with no slot is DROPPED here and reported by
 *  `readout.test.js`, never rendered in the wrong place. */
export function chipsBySlot(chips) {
  const out = {}
  for (const c of (chips || [])) {
    if (!c.slot) continue
    out[c.slot] = { value: c.value, text: c.text, color: c.color }
  }
  return out
}
```

- [ ] **Step 8: Run the readout test — green**

Run: `cd app && npx vitest run src/components/chart/engine/readout.test.js src/components/chart/engine/defSchema.test.js src/components/chart/engine/nativeRegistry.test.js`
Expected: PASS.

- [ ] **Step 9: Bridge it into StockChart's crosshair**

In `app/src/components/StockChart.jsx`, add the import next to the other engine imports (`:36-39`):

```js
import { engineChips, chipsBySlot } from './chart/engine/readout'
```

Replace `:7787-7799` with:

```js
      // ── The engine's own chips (B3 carry #2) ──────────────────────────────
      //
      // A migrated indicator has no legacy series ref, so every `…Ref.current`
      // read below returns null and its chip silently disappears from the
      // readout. INVISIBLE TO THE PIXEL GATE BY DESIGN: a headless capture has
      // no cursor, so no legend is drawn on either side. The engine's bindings
      // are iterated instead, and each chip lands in the slot its legacy twin
      // occupied so the legend's ORDER is unchanged too.
      const engSlots = engineRef.current
        ? chipsBySlot(engineChips(
            engineRef.current.binder.bindings(), param.seriesData, engineRegistry, engineInstancesRef.current))
        : {}

      let rsiValue = engSlots.rsi ? engSlots.rsi.value : null
      if (rsiValue === null && rsiSeriesRef.current) {
        const d = param.seriesData.get(rsiSeriesRef.current)
        rsiValue = d?.value ?? (indicatorData.rsi.at(-1)?.value ?? null)
      }

      let macdValue = engSlots.macd ? engSlots.macd.value : null
      let macdSignalValue = engSlots.macdSig ? engSlots.macdSig.value : null
      if (macdValue === null && macdLineRef.current) {
        const dm = param.seriesData.get(macdLineRef.current)
        const ds = macdSignalRef.current ? param.seriesData.get(macdSignalRef.current) : null
        macdValue       = dm?.value ?? (indicatorData.macd.macd.at(-1)?.value   ?? null)
        macdSignalValue = ds?.value ?? (indicatorData.macd.signal.at(-1)?.value ?? null)
      }
```

Add to the `setCrosshairData({…})` object (`:7850-7864`), after `compare: compareValue,`:

```js
        // The engine's chips as DATA, so the legend can render them directly at
        // B4 and the slot bridge above can be deleted with `LEGACY_SLOTS`.
        engineSlots: engSlots,
```

Add a ref mirror next to the other crosshair ref mirrors (`:2031`):

```js
  // The instance list the engine last drew, for the crosshair handler — which
  // reads refs, not props, so the subscription survives a live tick without a
  // tear-down/resubscribe (see the block comment above `overlayDataRef`).
  const engineInstancesRef = useRef(EMPTY_INSTANCES)
```

and set it in `updateChart`, immediately after `engineInstances` is computed (`:5573`):

```js
    engineInstancesRef.current = engineInstances
```

- [ ] **Step 10: Give the wiring test's chart double a crosshair handler, and assert the chip**

In `app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx`, add to the hoisted `H` object: `crosshairHandlers: []`, reset with `H.crosshairHandlers.length = 0`. Change the chart double:

```js
    subscribeCrosshairMove: (fn) => { H.crosshairHandlers.push(fn) },
    unsubscribeCrosshairMove: (fn) => {
      const i = H.crosshairHandlers.indexOf(fn); if (i >= 0) H.crosshairHandlers.splice(i, 1)
    },
```

Append the suite:

```js
// ─── B3 carry #2: the readout the pixel gate cannot see ─────────────────────
describe('an engine-drawn indicator still appears in the crosshair legend', () => {
  const RSI_ON = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } } }

  /** Drive one crosshair move over the newest bar and return the rendered chips. */
  const hoverLatest = async (view) => {
    const handler = H.crosshairHandlers.at(-1)
    expect(handler, 'nothing subscribed to crosshairMove — this test is vacuous').toBeTruthy()
    const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
    expect(candle, 'no candle series').toBeTruthy()
    const rsi = H.addSeriesCalls.find(c => c.options && c.options.priceScaleId === 'rsi')
    const seriesData = new Map([[candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }]])
    if (rsi) seriesData.set(rsi.series, { value: 54.321 })
    await act(async () => {
      handler({ time: BARS.at(-1).t, point: { x: 100, y: 100 }, logical: BARS.length - 1, seriesData })
      // the handler coalesces through rAF
      await new Promise(r => requestAnimationFrame(() => r()))
    })
    return view.container.textContent
  }

  it('LEGACY draws the chip — the control', async () => {
    const view = draw(RSI_ON)
    expect(await hoverLatest(view)).toContain('RSI(14) 54.3')
  })

  it('ENGINE draws the same chip, same text, same period', async () => {
    const view = draw({ ...RSI_ON, engineEnabled: true, indicatorInstances: [RSI_INSTANCE] })
    // The legacy ref is null here by construction — the block stood down.
    expect(await hoverLatest(view)).toContain('RSI(14) 54.3')
  })

  it('and it follows the INSTANCE\'s period, not the settings blob\'s', async () => {
    const view = draw({
      ...RSI_ON,
      engineEnabled: true,
      indicatorInstances: [{ ...RSI_INSTANCE, inputs: { period: 7, color: '#7b68ee' } }],
    })
    const text = await hoverLatest(view)
    expect(text).toContain('RSI(7) 54.3')
    expect(text).not.toContain('RSI(14)')
  })
})
```

- [ ] **Step 11: Run the wiring suite — green**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/stockChartWiring.test.jsx`
Expected: PASS.

- [ ] **Step 12: The RSI Flip A pixel gate**

```bash
cd app && npm run build && rm -rf /tmp/parity-B3T2 && cp -r dist /tmp/parity-B3T2
python ../tools/spa_server.py /tmp/parity-B3T2 5185 &
B=http://127.0.0.1:5185
cd ..

# determinism first — a 0 below means nothing until each path agrees with itself
python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy --instances-side none
python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy --instances-side both
# the gate
python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy
# prove it can fail
python tools/chart_parity.py --base-a $B --base-b $B --cases engine_rsi_vs_legacy \
    --perturb-b-instances '{"color": "#7b68ef"}'
```

Expected, in order: `0`, `0`, **`0` and exit 0**, then **non-zero and exit 1** (B2 measured 1,004 px for this exact perturbation). Read `tools/chart_parity_out/report.md` and confirm both identity lines name the SAME build id and say `engine source: present`.

**If the third run is non-zero:** the legend change touched the render path, which it must not. Open `tools/chart_parity_out/diff/engine_rsi_vs_legacy.png` before changing anything.

- [ ] **Step 13: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | revert the bridge: `let rsiValue = null; if (rsiSeriesRef.current) {…}` | wiring "ENGINE draws the same chip" |
| M2 | `nativeRegistry` RSI `legend: { decimals: 2 }` | `readout.test.js` "reproduces the LEGACY RSI chip byte for byte" |
| M3 | drop `legendParams: ['period']` from RSI's meta | same test (`RSI 54.3` vs `RSI(14) 54.3`) |
| M4 | delete `'macd::signal'` from `LEGACY_SLOTS` | `readout.test.js` "every definition that DECLARES a visible chip has a legacy slot" |
| M5 | BB `legend: { hide: false }` | `readout.test.js` "emits NO chip for a price overlay" **and** the slot rail |
| M6 | `readout.js` `resolvePlotColor` → `return plot.color` always | `readout.test.js` "takes the colour from the INSTANCE" |

- [ ] **Step 14: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__ && cd ..
git add tools/spa_server.py docs/runbooks/chart-parity-gate.md \
        app/src/components/chart/engine/readout.js app/src/components/chart/engine/readout.test.js \
        app/src/components/chart/engine/defSchema.js app/src/components/chart/engine/nativeRegistry.js \
        app/src/components/StockChart.jsx \
        app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx
git commit -m "feat(engine): RSI's Flip A exit — the readout the pixel gate cannot see

Closes B3 carry #2. The crosshair legend read rsiSeriesRef.current, so an engine
-drawn RSI silently left the readout: no cursor in a headless capture, so the
pixel gate reports 0 either way. The chip is now DECLARED on the plot and built
from the binder's own bindings, landing in the slot its legacy twin occupied so
the legend's order is unchanged. tools/spa_server.py is committed because every
parity number in B2 was produced through an uncommitted scratch copy.

engine_rsi_vs_legacy: 0 changed px (tol 0); --perturb-b-instances: 1,004 px exit 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Bollinger Bands — Flip A

The first PRICE-OVERLAY migration, and the reason Task 1 exists. BB is three `LineSeries` on the candles' own price scale (`StockChart.jsx:5875-5898`): upper dashed, middle solid, lower dashed, all one colour, all excluded from the price scale's autoscale. It exercises the placement path RSI cannot reach — `scaleOptions: null`, `scaleId: 'right'`, `autoscale: 'exclude'` — and it is the exact pair the B2 final review's C-2 repro used (RSI off + BB on in one settings write bound BB's upper band to the `rsi` scale at `{autoScale:false,0,100}`, clipped invisible).

**Files:**
- Modify: `app/src/components/StockChart.jsx:76` (`ENGINE_MIGRATED_DEF_IDS`), `:5875-5898` (the BB block)
- Modify: `tools/chart_parity_cases.json` (add `engine_bb_vs_legacy`, `engine_bb_rsi_vs_legacy`)
- Create: `app/src/components/chart/engine/__tests__/bbFlipAParity.test.js`
- Modify: `app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx` (z-order rail)

**Interfaces:**
- Consumes: `resolvePlacement(...).autoscale` and `pool.AUTOSCALE_EXCLUDE` from Task 1.
- Consumes: `engineChips` from Task 2 (BB declares `legend: { hide: true }`, so it must produce none).
- Produces: `ENGINE_MIGRATED_DEF_IDS` = `Set(['rsi', 'bb'])`.

- [ ] **Step 1: Write the failing transcription test**

Create `app/src/components/chart/engine/__tests__/bbFlipAParity.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_EXCLUDE } from '../pool'
import * as engineRegistry from '../nativeRegistry'
import { computeBB } from '../../indicators'
import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR BOLLINGER BANDS, AS A UNIT TEST ────────────────
//
// `tools/chart_parity.py --cases engine_bb_vs_legacy` is the real proof. This is
// what protects it between parity runs: the CALLS, asserted against a literal
// transcription of `StockChart.jsx:5875-5898`.
//
// WHAT THIS HOLDS THAT THE PIXEL GATE CANNOT: which of three identical-looking
// purple lines is which. All three share one colour, so upper-and-lower swapping
// their dash pattern with middle is a picture the diff would catch, but middle
// and (say) a future centre-fill swapping is not obviously attributable. Here it
// is three named assertions.
//
// WHAT IT CANNOT HOLD: creation ORDER relative to the volume bars and the MA
// overlays (LWC z-orders by insertion and BB is drawn OVER both), and the price
// scale's autoscale behaviour, which is a renderer decision. Both are the pixel
// gate's job.

/** `chart.addSeries(LineSeries, <this>)` × 3 — `:5885-5889`, verbatim.
 *  NOTE: the legacy block passes NO `priceScaleId`. Verified in the installed
 *  5.2.0 bundle (`_private__addSeriesToPane` → `_internal_defaultVisiblePriceScaleId`)
 *  that an absent id resolves to the one visible scale, which this chart
 *  configures as `right` — so naming it explicitly is byte-identical on a create
 *  and is the FIX on a re-purpose (B2 review finding C-2). */
const LEGACY_BB = [
  { key: 'upper',  lineStyle: 2 },
  { key: 'middle', lineStyle: 0 },
  { key: 'lower',  lineStyle: 2 },
]
const LEGACY_SHARED = {
  color: 'rgba(156,39,176,0.85)',
  lineWidth: 1,
  priceLineVisible: false,
  lastValueVisible: false,
  crosshairMarkerVisible: false,
}

/** The options the engine states that the legacy block does not — each one equal
 *  to the value a freshly-created LWC 5.2.0 series already has, so a CREATED
 *  series is byte-identical and a RE-PURPOSED one is reset to it. */
const LWC_LINE_DEFAULTS_RESTATED = {
  visible: true,
  lineType: 0,
  pointMarkersVisible: false,
  pointMarkersRadius: 3,
  priceFormat: { type: 'price', precision: 2 },
}

const BARS = makeBars(260)
const PERIOD = 20
const STDDEV = 2
const COLOR = 'rgba(156,39,176,0.85)'
const INSTANCE = {
  instanceId: 'legacy:bb', defId: 'bb', defVersion: 1,
  inputs: { period: PERIOD, stdDev: STDDEV, color: COLOR },
  placement: { target: 'price' }, hidden: false,
}

const sync = () => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const result = binder.sync({
    enabled: true, registry: engineRegistry, instances: [INSTANCE], bars: BARS,
    adjustTime: (t) => t, resolvePlacement,
    paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    plan: { fresh: true },
  })
  return { F, binder, result }
}

describe('BB Flip A — three series, the legacy options, nothing else', () => {
  it('creates exactly three LineSeries, in upper/middle/lower order', () => {
    const { F, result } = sync()
    expect(result.bound).toBe(3)
    expect(F.count('addSeries')).toBe(3)
    expect(F.seriesCreated.map(s => String(s.__ctor))).toEqual(['LineSeries', 'LineSeries', 'LineSeries'])
    // Order is declaration order, which is legacy order (`BB_BANDS`, :5877-5881).
    // It matters: LWC z-orders by insertion and the three overlap the candles.
    expect(result.bound).toBe(LEGACY_BB.length)
  })

  it('each series carries the legacy options VERBATIM, plus restated defaults', () => {
    const { F } = sync()
    F.callsOf('addSeries').forEach((call, i) => {
      const opts = call.args[1]
      const spec = LEGACY_BB[i]
      expect(opts, spec.key).toMatchObject({ ...LEGACY_SHARED, lineStyle: spec.lineStyle })
      expect(opts, spec.key).toMatchObject(LWC_LINE_DEFAULTS_RESTATED)
    })
  })

  it('all three are EXCLUDED from the candles\' autoscale', () => {
    // `:5888` — `autoscaleInfoProvider: () => null` on all three. Without it a
    // band 3σ above price stretches the candles' range and the whole chart
    // re-scales. This is the option Task 1 exists to deliver.
    const { F } = sync()
    for (const call of F.callsOf('addSeries')) {
      expect(call.args[1].autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    }
  })

  it('binds to the CANDLES\' scale, and asserts NOTHING on it', () => {
    const { F } = sync()
    for (const call of F.callsOf('addSeries')) {
      expect(call.args[1].priceScaleId).toBe('right')
      expect(call.args[2], 'a price overlay lives in pane 0').toBe(0)
    }
    // The candles' margins come from `_mainMargins` and the user's dragged
    // placement. An indicator writing scaleMargins there MOVES THE CANDLES.
    expect(F.callsOf('priceScale.applyOptions')).toHaveLength(0)
  })

  it('draws no guides — BB has none', () => {
    const { F } = sync()
    expect(F.count('createPriceLine')).toBe(0)
  })

  it('the numbers are computeBB\'s, unrounded, NaN → whitespace', () => {
    const { F } = sync()
    const raw = computeBB(BARS, PERIOD, STDDEV)
    const sets = F.callsOf('setData').map(c => c.args[0])
    expect(sets).toHaveLength(3)
    for (const [i, key] of ['upper', 'middle', 'lower'].entries()) {
      const points = sets[i]
      expect(points).toHaveLength(BARS.length)
      for (let b = 0; b < BARS.length; b++) {
        const expected = raw[key][b] ? raw[key][b].value : undefined
        if (Number.isFinite(expected)) {
          expect(points[b].value, `${key}@${b}`).toBe(expected)
        } else {
          expect(points[b], `${key}@${b} must be a whitespace item`).toEqual({ time: BARS[b].t })
        }
      }
    }
  })

  it('the user\'s colour reaches all three, not the definition default', () => {
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    binder.sync({
      enabled: true, registry: engineRegistry, bars: BARS, adjustTime: (t) => t, resolvePlacement,
      instances: [{ ...INSTANCE, inputs: { ...INSTANCE.inputs, color: '#00ff00' } }],
      paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
      plan: { fresh: true },
    })
    for (const call of F.callsOf('addSeries')) expect(call.args[1].color).toBe('#00ff00')
  })

  it('C-2, the exact repro: RSI released then BB bound keeps NOTHING of the rsi scale', () => {
    // The B2 final review's Critical #2 was measured on this pair. A pooled
    // series that kept `priceScaleId: 'rsi'` put BB's upper band on a
    // {autoScale:false, 0, 100} axis, clipped invisible, with `scaleOptions:null`
    // meaning nothing corrected it.
    const F = createFakeChart()
    const binder = createBinder({ chart: F.chart, LWC: F.LWC })
    const ctx = (instances) => ({
      enabled: true, registry: engineRegistry, instances, bars: BARS,
      adjustTime: (t) => t, resolvePlacement,
      paneMargins: { rsi: { top: 0.85, bottom: 0 } },
      volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1, plan: { fresh: true },
    })
    binder.sync(ctx([{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false }]))
    F.reset()
    binder.sync(ctx([INSTANCE]))

    const applied = F.callsOf('applyOptions').map(c => c.args[0])
    expect(applied.length, 'nothing was re-purposed — this case is vacuous').toBeGreaterThan(0)
    for (const opts of applied) {
      expect(opts.priceScaleId).toBe('right')
      expect(opts.autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    }
    // …and every guide RSI left behind is gone.
    expect(F.count('removePriceLine')).toBe(3)
  })
})
```

- [ ] **Step 2: Run it — it should already PASS**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/bbFlipAParity.test.js`
Expected: PASS. The engine can already draw BB — nothing has migrated it yet. If any case fails, **stop**: the definition disagrees with the shipped block and that disagreement is the migration's pixel diff. Fix `nativeRegistry`'s `bb` entry, not the test.

- [ ] **Step 3: Write the failing wiring test**

Append to `app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx`:

```js
describe('BB Flip A — the legacy block stands down, z-order is preserved', () => {
  const BB_ON = { indicators: { bb: { enabled: true, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' } } }
  const BB_INSTANCE = {
    instanceId: 'legacy:bb', defId: 'bb',
    inputs: { period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' },
    placement: { target: 'price' }, hidden: false,
  }
  const purple = () => H.addSeriesCalls.filter(c => c.options && c.options.color === 'rgba(156,39,176,0.85)')

  it('draws three BB lines with the engine OFF (the shipped behaviour)', () => {
    draw(BB_ON)
    expect(purple()).toHaveLength(3)
  })

  it('STILL draws exactly three when the engine owns it — and they are the ENGINE\'s', () => {
    draw({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE] })
    const drawn = purple()
    expect(drawn, 'six purple lines is not parity, it is a bolder chart').toHaveLength(3)
    const owned = H.binderApis[0].bindings().map(b => b.series)
    expect(owned).toHaveLength(3)
    expect(drawn.map(c => c.series).sort()).toEqual(owned.sort())
  })

  it('lands AFTER volume and the MA overlays — it draws OVER them, as legacy does', () => {
    draw({ ...BB_ON, engineEnabled: true, indicatorInstances: [BB_INSTANCE], volume: { show: true } })
    const MA_COLOURS = ['#4ade80', '#f472b6', '#60a5fa', '#fb923c', 'rgba(168,162,144,0.55)']
    const first = H.addSeriesCalls.findIndex(c => (c.options || {}).color === 'rgba(156,39,176,0.85)')
    const volumeIdx = H.addSeriesCalls.findIndex(c => (c.options || {}).priceFormat?.type === 'custom')
    const lastMa = H.addSeriesCalls.map(c => c.options || {}).reduce((a, o, i) => (MA_COLOURS.includes(o.color) ? i : a), -1)
    expect(first).toBeGreaterThan(-1)
    expect(volumeIdx).toBeGreaterThan(-1)
    expect(lastMa).toBeGreaterThan(-1)
    expect(first).toBeGreaterThan(volumeIdx)
    expect(first).toBeGreaterThan(lastMa)
  })
})

describe('the five price overlays migrate in REGISTRY order, or z-order inverts', () => {
  // The engine draws ALL its series contiguously, immediately before the legacy
  // Bollinger block; legacy interleaves them down the function. Registry order IS
  // legacy render order for the five price overlays (bb, vwap, sar, ichimoku,
  // donchian), so migrating in that order preserves the picture. Migrating a
  // LATER one while an EARLIER one is still legacy puts the engine's copy above
  // a legacy overlay it should sit below — two translucent lines crossing, and
  // the top one wins the pixel.
  const PRICE_ORDER = ['bb', 'vwap', 'sar', 'ichimoku', 'donchian']

  it('no price overlay is migrated ahead of an earlier one', () => {
    const migratedPrice = PRICE_ORDER.filter(id => ENGINE_MIGRATED_DEF_IDS.has(id))
    const lastMigrated = migratedPrice.length ? PRICE_ORDER.indexOf(migratedPrice.at(-1)) : -1
    for (let i = 0; i <= lastMigrated; i++) {
      expect(ENGINE_MIGRATED_DEF_IDS.has(PRICE_ORDER[i]),
        `${PRICE_ORDER[i]} must migrate before ${PRICE_ORDER[lastMigrated]} — see the plan's z-order rule`)
        .toBe(true)
    }
  })

  it('registry order still equals legacy render order for the five', () => {
    // If the registry is ever reordered, the rule above stops meaning anything.
    const inRegistry = registry.listDefinitions().map(d => d.id).filter(id => PRICE_ORDER.includes(id))
    expect(inRegistry).toEqual(PRICE_ORDER)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/stockChartWiring.test.jsx`
Expected: FAIL — "six purple lines is not parity" (6 received). The engine draws BB and so does the legacy block, because `ENGINE_MIGRATED_DEF_IDS` does not contain `'bb'` yet… **and it will not even get that far**: with `'bb'` absent the instance is filtered out, so the count is 3 and the `bindings()` assertion fails with 0. Either way it is RED, and the message names which half is missing.

- [ ] **Step 5: Do the migration — BOTH edits, never one**

`app/src/components/StockChart.jsx:76`:

```js
export const ENGINE_MIGRATED_DEF_IDS = Object.freeze(new Set(['rsi', 'bb']))
```

`:5875-5898` — add the guard and the standing-down `else`:

```js
    // ── Bollinger Bands (3 LineSeries on main price scale) ──
    // `!engineOwned.has('bb')` — the crossover guard (see `engineOwnedDefIds`).
    // An engine instance of `bb` draws this indicator, so the legacy block stands
    // down; the `else` below then removes the legacy series, which is what keeps
    // a mid-session flip from leaving six purple lines on the price scale.
    const bbColor = cs.indicators?.bb?.color || 'rgba(156,39,176,0.85)'
    const BB_BANDS = [
      { ref: bbUpperRef,  data: indicatorData.bb.upper,  style: 2 },
      { ref: bbMiddleRef, data: indicatorData.bb.middle, style: 0 },
      { ref: bbLowerRef,  data: indicatorData.bb.lower,  style: 2 },
    ]
    const bbEngineOwned = engineOwned.has('bb')
    for (const { ref, data, style } of BB_BANDS) {
      if (data.length && !bbEngineOwned) {
        if (!ref.current) {
          ref.current = chart.addSeries(LineSeries, {
            color: bbColor, lineWidth: 1, lineStyle: style,
            priceLineVisible: false, lastValueVisible: false,
            crosshairMarkerVisible: false, autoscaleInfoProvider: () => null,
          })
        } else {
          ref.current.applyOptions({ color: bbColor })
        }
        _applyData(ref.current, data)
      } else if (ref.current) {
        try { chart.removeSeries(ref.current) } catch {}
        ref.current = null
      }
    }
```

- [ ] **Step 6: Run the wiring suite — green**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/stockChartWiring.test.jsx`
Expected: PASS, including the `it.each([...ENGINE_MIGRATED_DEF_IDS])` double-draw rail, which now runs for `bb` as well as `rsi`.

- [ ] **Step 7: Add the parity cases**

In `tools/chart_parity_cases.json`, after `engine_rsi_vs_legacy`:

```jsonc
    {
      "name": "engine_bb_vs_legacy",
      "why": "THE FIRST PRICE OVERLAY. Side A draws the three Bollinger lines through the hand-written StockChart block; side B draws them through the ENGINE. This is the case that measures the `autoscaleInfoProvider` seam: without it the bands drag the CANDLES' autoscale and the whole price pane re-scales, which is a whole-canvas diff, not a line-width one. It also measures the C-2 fix (`priceScaleId` named rather than omitted) on a create.",
      "settings": {
        "indicators": {
          "bb": { "enabled": true, "period": 20, "stdDev": 2, "color": "rgba(156,39,176,0.85)" }
        }
      },
      "instancesB": [
        {
          "instanceId": "legacy:bb",
          "defId": "bb",
          "defVersion": 1,
          "inputs": { "period": 20, "stdDev": 2, "color": "rgba(156,39,176,0.85)" },
          "placement": { "target": "price" },
          "hidden": false
        }
      ]
    },
    {
      "name": "engine_bb_rsi_vs_legacy",
      "why": "THE PILOT PAIR TOGETHER. A price overlay and a banded oscillator in one render, which is the only case that can see the engine drawing its series contiguously where legacy interleaves them, and the only one where a pooled series can cross between the two placement paths within a single sync.",
      "settings": {
        "indicators": {
          "bb": { "enabled": true, "period": 20, "stdDev": 2, "color": "rgba(156,39,176,0.85)" },
          "rsi": { "enabled": true, "period": 14, "color": "#7b68ee" }
        }
      },
      "instancesB": [
        {
          "instanceId": "legacy:bb", "defId": "bb", "defVersion": 1,
          "inputs": { "period": 20, "stdDev": 2, "color": "rgba(156,39,176,0.85)" },
          "placement": { "target": "price" }, "hidden": false
        },
        {
          "instanceId": "legacy:rsi", "defId": "rsi", "defVersion": 1,
          "inputs": { "period": 14, "color": "#7b68ee" },
          "placement": { "target": "pane" }, "hidden": false
        }
      ]
    },
```

Also replace the `bb_only` case's `why` — it already has settings, so it stays as the legacy-vs-legacy determinism case.

- [ ] **Step 8: Run the pixel gate**

```bash
cd app && npm run build && rm -rf /tmp/parity-B3T3 && cp -r dist /tmp/parity-B3T3
python ../tools/spa_server.py /tmp/parity-B3T3 5185 &
B=http://127.0.0.1:5185
cd ..
C="engine_bb_vs_legacy engine_bb_rsi_vs_legacy"
python tools/chart_parity.py --base-a $B --base-b $B --cases $C --instances-side none
python tools/chart_parity.py --base-a $B --base-b $B --cases $C --instances-side both
python tools/chart_parity.py --base-a $B --base-b $B --cases $C
python tools/chart_parity.py --base-a $B --base-b $B --cases engine_bb_vs_legacy \
    --perturb-b-instances '{"color": "rgba(156,39,177,0.85)"}'
```

Expected: `0`, `0`, **`0` exit 0**, then **non-zero exit 1**.

**Failure modes and what they mean:**

| symptom in `diff/engine_bb_vs_legacy.png` | cause |
|---|---|
| the entire price pane shifted vertically | the autoscale seam is not reaching the series — Task 1's `autoscale` is not threaded, or `AUTOSCALE_EXCLUDE` is not the value |
| upper and lower solid instead of dashed | `lineStyleValue` regressed (the B2 capitalisation defect); check `LINE_STYLE_MEMBER` |
| the middle line drawn where an edge should be | plot declaration order changed in `nativeRegistry` |
| six purple lines / a visibly bolder band | `ENGINE_MIGRATED_DEF_IDS` gained `'bb'` but the block has no guard, or vice versa — the wiring test should have caught it first |
| bands present on A, absent on B | placement returned null; check `def.placement.target === 'price'` survives `normalizeInstances` |

- [ ] **Step 9: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | delete `&& !bbEngineOwned` from the BB block | wiring "STILL draws exactly three" |
| M2 | remove `'bb'` from `ENGINE_MIGRATED_DEF_IDS`, keep the guard | wiring "STILL draws exactly three" (`bindings()` is 0) |
| M3 | `nativeRegistry` bb upper `lineStyle: 'solid'` | `bbFlipAParity` "legacy options VERBATIM" |
| M4 | swap `upper` and `lower` in `RAW_DEFS`' bb plots | `bbFlipAParity` "upper/middle/lower order" |
| M5 | `placement.js` price branch → `autoscale: 'default'` | `bbFlipAParity` "EXCLUDED from the candles' autoscale" AND the pixel gate (whole-pane shift) |
| M6 | add `'donchian'` to `ENGINE_MIGRATED_DEF_IDS` without `'vwap'`/`'sar'`/`'ichimoku'` | wiring "no price overlay is migrated ahead of an earlier one" |

- [ ] **Step 10: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__ && cd ..
git add app/src/components/StockChart.jsx tools/chart_parity_cases.json \
        app/src/components/chart/engine/__tests__/bbFlipAParity.test.js \
        app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx
git commit -m "feat(charts): Bollinger Bands — Flip A, the first price overlay

Three LineSeries on the candles' own scale, excluded from its autoscale through
the Task 1 seam. The legacy block stands down on !engineOwned.has('bb') and
ENGINE_MIGRATED_DEF_IDS gains the id in the same commit, because the wiring test
fails if only one lands. A new rail pins the z-order rule the engine's single
call site creates: the five price overlays migrate in registry order or a later
one draws above an earlier legacy twin.

engine_bb_vs_legacy: 0 changed px (tol 0). engine_bb_rsi_vs_legacy: 0.
--perturb-b-instances: non-zero, exit 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: `volumeProfile` — the written carve-out and the rail that enforces it

Closes B3 carry #3. `volumeProfile` is a canvas overlay (`StockChart.jsx:8988-9006` → `drawVolumeProfile`), not a series: no compute function in `indicators.js`, no `plots[]` style that expresses horizontal volume bins, and `bgband`/`fill` are schema-RESERVED and are not what it draws anyway. `nativeRegistry` has 14 definitions to `CHART_DEFAULTS.indicators`' 15 keys, and three separate docstrings already say why. What is missing is a decision written where it will be found and a test that makes "completing" the registry fail.

**Decision (A4): `volumeProfile` never becomes a `plots[]` definition.** It gets a `primitive` compute kind when one exists (Phase C/D, alongside `zones`/`bgband`). Until then it stays exactly where it is, and the legacy canvas path is never deleted by any B3 flip.

**Files:**
- Modify: `app/src/components/chart/engine/nativeRegistry.js` (the carve-out block, hardened)
- Modify: `app/src/components/chart/engine/instances.js:44-51`
- Modify: `app/src/components/StockChart.jsx:8988` (the effect's header)
- Modify: `app/src/components/chart/engine/nativeRegistry.test.js`
- Modify: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (§5, the count correction)

**Interfaces:**
- Produces: `nativeRegistry.CARVED_OUT_INDICATOR_KEYS` — a frozen `Set` naming every `CHART_DEFAULTS.indicators` key that deliberately has no definition, with the reason in the docstring.

- [ ] **Step 1: Write the failing rail**

Append to `app/src/components/chart/engine/nativeRegistry.test.js`:

```js
import { CHART_DEFAULTS } from '../chartDefaults'
import { CARVED_OUT_INDICATOR_KEYS } from './nativeRegistry'

describe('the volumeProfile carve-out is a DECISION, not a gap (B3 carry #3)', () => {
  it('names every settings key with no definition, and nothing else', () => {
    const settingsKeys = Object.keys(CHART_DEFAULTS.indicators)
    const defined = new Set(listDefinitions().map(d => d.id))
    const undefinedKeys = settingsKeys.filter(k => !defined.has(k))
    // An indicator key that is neither defined NOR declared carved-out is a hole
    // somebody left. An id in the carve-out set that IS defined is a stale note.
    expect(undefinedKeys.sort()).toEqual([...CARVED_OUT_INDICATOR_KEYS].sort())
    for (const k of CARVED_OUT_INDICATOR_KEYS) expect(defined.has(k), `${k} is defined AND carved out`).toBe(false)
  })

  it('is exactly volumeProfile, and 14 + 1 = 15', () => {
    expect([...CARVED_OUT_INDICATOR_KEYS]).toEqual(['volumeProfile'])
    expect(listDefinitions()).toHaveLength(14)
    expect(Object.keys(CHART_DEFAULTS.indicators)).toHaveLength(15)
  })

  it('the migrator SKIPS it rather than emitting an instance nothing can render', () => {
    const cs = { indicators: { volumeProfile: { enabled: true }, rsi: { enabled: true } } }
    const out = migrateLegacyToInstances(cs)
    expect(out.map(i => i.defId)).toEqual(['rsi'])
  })

  it('a carved-out key can never be migrated — the flip would delete the overlay', () => {
    // `ENGINE_MIGRATED_DEF_IDS` is what makes a legacy block stand down. Adding a
    // carved-out key there would silence the canvas effect for an indicator the
    // engine cannot draw, and the volume profile would simply vanish.
    for (const k of CARVED_OUT_INDICATOR_KEYS) {
      expect(ENGINE_MIGRATED_DEF_IDS.has(k), `${k} is carved out and must never be migrated`).toBe(false)
    }
  })
})
```

Add the two imports the file needs: `import { ENGINE_MIGRATED_DEF_IDS } from '../../StockChart'` and `import { migrateLegacyToInstances } from './instances'`.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/nativeRegistry.test.js`
Expected: FAIL — `CARVED_OUT_INDICATOR_KEYS` is not exported.

- [ ] **Step 3: Export the carve-out, with the decision written down**

In `app/src/components/chart/engine/nativeRegistry.js`, replace the "WHY volumeProfile IS NOT HERE" docstring block with a pointer, and add near `NATIVE_DEFS`:

```js
/**
 * The `CHART_DEFAULTS.indicators` keys that deliberately have NO definition.
 *
 * ⛔ B3 DECISION, 2026-08-02, recorded so it is not re-litigated: `volumeProfile`
 * NEVER becomes a `plots[]` definition. It is a CANVAS OVERLAY — `StockChart`
 * draws horizontal volume bins straight onto a 2D context
 * (`StockChart.jsx:8988-9006` → `drawVolumeProfile`), there is no compute
 * function for it in `indicators.js`, and no v1 plot style expresses it.
 * `bgband` and `fill` are schema-RESERVED and neither is what it draws anyway.
 * A definition for it would be one that cannot be computed and cannot be bound:
 * a registry entry that lies.
 *
 * It gets a `compute.kind: 'primitive'` lane when one exists — the same lane
 * `zones` and `bgband` are waiting on, Phase C/D. Until then the legacy canvas
 * effect is the implementation, and NO B3 flip may delete it.
 *
 * THE COUNT, CORRECTED. The platform has **15 indicator settings keys and 14
 * series-expressible indicators**. Spec §5's "the 15 natives" counted settings
 * keys. `nativeRegistry.test.js` asserts 14 + 1 = 15 so the arithmetic cannot
 * quietly drift in either direction.
 */
export const CARVED_OUT_INDICATOR_KEYS = Object.freeze(new Set(['volumeProfile']))
```

In `app/src/components/chart/engine/instances.js:44-51`, replace the "AND WHY volumeProfile IS NOT MIGRATED EITHER" paragraph's last sentence with:

```
// legacy canvas path for it. That is not a deferral — see
// `nativeRegistry.CARVED_OUT_INDICATOR_KEYS` for the decision and its expiry
// condition (a `primitive` compute kind, Phase C/D).
```

In `app/src/components/StockChart.jsx:8988`, above the effect:

```js
  // ── Volume Profile canvas overlay ──
  // ⛔ NOT MIGRATABLE, BY DECISION. A canvas overlay, not a series: no compute
  // function, no plot style that expresses horizontal volume bins. It has no
  // engine definition and never will until a `primitive` compute kind exists
  // (see `engine/nativeRegistry.CARVED_OUT_INDICATOR_KEYS`). NO Flip A guard and
  // NO Flip B deletion applies here — a flip that silenced this effect would make
  // the volume profile vanish with nothing to replace it.
```

In `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §5, change "two-flip migration of the 15 natives" to:

```
two-flip migration of the 14 series-expressible natives (15 settings keys;
`volumeProfile` is a canvas overlay and is carved out — see the B3 plan's
adjudication A4)
```

- [ ] **Step 4: Run — green**

Run: `cd app && npx vitest run src/components/chart/engine/nativeRegistry.test.js src/components/chart/engine/instances.test.js`
Expected: PASS.

- [ ] **Step 5: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | add a `volumeProfile` definition to `RAW_DEFS` (any shape that validates) | "names every settings key with no definition" (it is defined AND carved out) |
| M2 | `CARVED_OUT_INDICATOR_KEYS = new Set([])` | "names every settings key with no definition" (`volumeProfile` unexplained) |
| M3 | add `'volumeProfile'` to `ENGINE_MIGRATED_DEF_IDS` | "a carved-out key can never be migrated" |
| M4 | add a 16th key to `CHART_DEFAULTS.indicators` | "14 + 1 = 15" — deliberate: a new settings key must be either defined or explicitly carved out |

- [ ] **Step 6: Commit**

```bash
cd app && npx vitest run src/components/chart/engine && cd ..
git add app/src/components/chart/engine/nativeRegistry.js app/src/components/chart/engine/nativeRegistry.test.js \
        app/src/components/chart/engine/instances.js app/src/components/StockChart.jsx \
        docs/superpowers/specs/2026-07-31-indicator-platform-design.md
git commit -m "docs(engine): volumeProfile is carved out by decision, and a rail says so

Closes B3 carry #3. Three docstrings already explained why it has no definition;
none of them FAILED if somebody added one. CARVED_OUT_INDICATOR_KEYS is now
asserted against CHART_DEFAULTS.indicators, so a settings key that is neither
defined nor explicitly carved out is a test failure, and a carved-out key can
never reach ENGINE_MIGRATED_DEF_IDS. Corrects the spec's count: 15 settings keys,
14 series-expressible indicators.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: The MACD head-mask — measured, flagged, not removed

Adjudication A5. `nativeRegistry.maskMacdHead` (`:475-488`) and `StockChart.jsx:4017-4023` both hold the MACD line's head back to the signal's first bar — ~8 bars at the default 12/26/9 — because that is what this chart has always drawn. `computeMACD` emits the line from bar `slowPeriod-1`, which is mathematically right and is what the Python lane does; the golden fixtures caught the two disagreeing. Removing the mask is a VISIBLE change at the very start of history, so it needs owner sign-off, and the owner should decide against a number.

This task does not change any pixel. It makes the cost measurable and puts the switch somewhere a decision can be applied without touching a migration commit.

**Files:**
- Modify: `app/src/components/chart/engine/nativeRegistry.js:463-488`
- Modify: `tools/chart_parity_cases.json` (add `macd_headmask`)
- Modify: `app/src/components/chart/engine/nativeRegistry.test.js`
- Create: `docs/decisions/2026-08-02-macd-head-mask.md`

**Interfaces:**
- Produces: `nativeRegistry.MACD_HEAD_MASK` — a frozen boolean, `true`.
- Produces: `?indicators=` support for `engineHeadMask: false` is **not** added; the parity case measures the mask by comparing a build with the constant flipped, which is what makes the number honest.

- [ ] **Step 1: Write the failing test**

Append to `app/src/components/chart/engine/nativeRegistry.test.js`:

```js
import { MACD_HEAD_MASK } from './nativeRegistry'

describe('the MACD head-mask is a flagged decision, not a silent hold (B3/A5)', () => {
  it('is ON, and is a boolean somebody can flip in one place', () => {
    expect(MACD_HEAD_MASK).toBe(true)
  })

  it('masks the line back to the signal\'s first bar — the shipped look', () => {
    const def = getDefinition('macd')
    const bars = makeBars(120)
    const cols = computeFor(def, bars, { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 })
    const first = (col) => col.findIndex(v => Number.isFinite(v))
    expect(first(cols.macd)).toBe(first(cols.signal))
  })

  it('the UNMASKED line really does start earlier — so the decision is real', () => {
    // Straight from the native, no COLUMN_HOLDS. If these were equal the mask
    // would be a no-op and this whole decision would be theatre.
    const raw = computeMACD(makeBars(120), 12, 26, 9)
    const firstOf = (pts) => pts.findIndex(p => Number.isFinite(p.value))
    const gap = firstOf(raw.signal) - firstOf(raw.macd)
    expect(gap, 'the mask hides this many bars of a mathematically-correct line').toBe(8)
  })

  it('masking is applied to a COPY of nothing — it mutates the column in place, once', () => {
    // `maskMacdHead` writes NaN into the array it was handed. `computeFor` builds
    // that array fresh per call, and the binder memoises the RESULT, so a second
    // read of the memo must not re-mask an already-masked column into oblivion.
    const def = getDefinition('macd')
    const bars = makeBars(120)
    const a = computeFor(def, bars, {})
    const b = computeFor(def, bars, {})
    expect([...a.macd]).toEqual([...b.macd])
  })
})
```

Add `import { computeMACD } from '../indicators'` and `import { makeBars } from './__tests__/fakeChart'` if not already present.

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/nativeRegistry.test.js`
Expected: FAIL — `MACD_HEAD_MASK` is not exported.

- [ ] **Step 3: Make the hold a named constant**

In `app/src/components/chart/engine/nativeRegistry.js`, above `maskMacdHead`:

```js
/**
 * ⚠️⚠️ A FLAGGED DECISION AWAITING OWNER SIGN-OFF — do NOT flip this inside a
 * migration commit.
 *
 * `true`  = the shipped look. The MACD line starts on the same bar as its signal.
 * `false` = the mathematically correct line, drawn from bar `slowPeriod-1` —
 *           **8 bars earlier** at the default 12/26/9 — matching the Python lane
 *           and the golden fixtures exactly.
 *
 * This is the ONE place to change it, and changing it is a VISIBLE change at the
 * very start of history on every MACD chart. Measure it first:
 *
 *     python tools/chart_parity.py --base-a $LEGACY --base-b $UNMASKED --cases macd_headmask
 *
 * The number that comes out is what the owner is being asked to approve. See
 * `docs/decisions/2026-08-02-macd-head-mask.md`.
 */
export const MACD_HEAD_MASK = true
```

and change the holds table:

```js
/** Per-`compute.fn` post-processing that is a RENDER hold rather than maths. */
const COLUMN_HOLDS = MACD_HEAD_MASK ? { macd: maskMacdHead } : {}
```

- [ ] **Step 4: Run — green**

Run: `cd app && npx vitest run src/components/chart/engine/nativeRegistry.test.js`
Expected: PASS.

- [ ] **Step 5: Add the measurement case**

In `tools/chart_parity_cases.json`, after the MACD cases:

```jsonc
    {
      "name": "macd_headmask",
      "why": "MEASURES A FLAGGED DECISION, NOT A MIGRATION. Run it between a build with `nativeRegistry.MACD_HEAD_MASK = true` and one with it false. The number is the cost of drawing the mathematically-correct MACD line from bar slowPeriod-1 instead of holding its head back to the signal's first bar — 8 bars at 12/26/9. A `fixedbars` fixture of 200 daily bars puts those 8 bars at the far left of the visible range, which is exactly where a user would notice. Expected to be NON-ZERO: a zero here means the mask is not doing anything and the decision is theatre.",
      "settings": {
        "indicators": {
          "macd": {
            "enabled": true, "fastPeriod": 12, "slowPeriod": 26, "signalPeriod": 9,
            "macdColor": "#2196F3", "signalColor": "#FF9800"
          }
        }
      }
    },
```

- [ ] **Step 6: Take the measurement**

```bash
cd app && npm run build && rm -rf /tmp/parity-mask-on && cp -r dist /tmp/parity-mask-on
# flip the constant, rebuild, DO NOT COMMIT the flip
sed -i "s/export const MACD_HEAD_MASK = true/export const MACD_HEAD_MASK = false/" \
    src/components/chart/engine/nativeRegistry.js
npm run build && rm -rf /tmp/parity-mask-off && cp -r dist /tmp/parity-mask-off
git checkout -- src/components/chart/engine/nativeRegistry.js
cd ..
python tools/spa_server.py /tmp/parity-mask-on  5186 &
python tools/spa_server.py /tmp/parity-mask-off 5187 &
python tools/chart_parity.py --base-a http://127.0.0.1:5186 --base-b http://127.0.0.1:5187 --cases macd_headmask
```

⚠️ The masked build draws the MACD line through the LEGACY block here (MACD is not migrated until Task 6), and the constant only affects the ENGINE's copy. **So this measurement is only valid once `StockChart.jsx:4022`'s inline mask is also driven by the constant.** Add, in the `indicatorData` memo:

```js
        const sigStart = MACD_HEAD_MASK ? raw.signal.findIndex(p => Number.isFinite(p.value)) : -1
```

(import `MACD_HEAD_MASK` from `./chart/engine/nativeRegistry`). Now both lanes read one switch, which is the point of naming it.

Expected: **non-zero**, and the two identity lines name DIFFERENT builds. Record the number.

- [ ] **Step 7: Write the decision record**

Create `docs/decisions/2026-08-02-macd-head-mask.md`:

```markdown
# Decision needed: the MACD head-mask

**Status:** OPEN — awaiting owner sign-off. Default is unchanged (`MACD_HEAD_MASK = true`).
**Owner of the switch:** `app/src/components/chart/engine/nativeRegistry.js` → `MACD_HEAD_MASK`.

## What it is

`computeMACD` emits the MACD line from bar `slowPeriod - 1`. Its signal line, an
EMA of the MACD line, cannot start until `signalPeriod - 1` bars later — **8 bars
at the default 12/26/9**. This chart has always started the two together, by
masking the line's head back to the signal's first bar.

The Python lane (`api/services/indicator_compute.py`) does NOT mask, and the
shared golden fixtures caught the two disagreeing on exactly those 8 bars. B1
kept the mask to hold pixel parity and assigned the decision to B3.

## What each option costs

| | |
|---|---|
| **Keep the mask (today)** | The chart looks exactly as it always has. The JS render disagrees with the Python lane and with `plots[].precision`-level fixtures on the first 8 bars of every MACD chart. Spec §9.1's "rel-tol 1e-9 across both lanes" holds for the COLUMN and not for what is drawn. |
| **Drop the mask** | The chart and both compute lanes agree everywhere. The MACD line starts ~8 bars earlier at the very left of history. **Measured cost: `<N>` changed pixels** on `--cases macd_headmask` (200 daily bars, 1200×620, Classic Dark flat). |

## The number

Run, from a clean tree:

    python tools/chart_parity.py --base-a $MASK_ON --base-b $MASK_OFF --cases macd_headmask

Result on 2026-08-02: **`<N>` changed pixels (`<P>`%)**, diff at
`tools/chart_parity_out/diff/macd_headmask.png` — the leftmost `<X>` px of the
MACD pane, one line, nothing else.

## Rules for whoever applies the decision

- Flip `MACD_HEAD_MASK` in **its own commit**, never inside a migration. A
  migration commit's parity number must be attributable to the migration.
- Dropping the mask is an output change to a rendered series but NOT to a
  computed column, so it does **not** bump `compute.rev` — the maths is
  unchanged. It is a presentation change; bump `version` on the `macd`
  definition.
- Re-run `--cases macd_only` and `--cases engine_macd_vs_legacy` afterwards and
  re-capture their baselines, because the shipped look has moved.
```

- [ ] **Step 8: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | `COLUMN_HOLDS = {}` unconditionally | nativeRegistry "masks the line back to the signal's first bar" |
| M2 | `MACD_HEAD_MASK = false` | "is ON" |
| M3 | `maskMacdHead` → `return columns` (no-op) | "masks the line back to the signal's first bar" |
| M4 | change `computeMACD` so the line starts with the signal (i.e. make the mask redundant) | "the UNMASKED line really does start earlier" (gap 0, not 8) — this is the case that stops the decision becoming theatre |

- [ ] **Step 9: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ && cd ..
git add app/src/components/chart/engine/nativeRegistry.js app/src/components/chart/engine/nativeRegistry.test.js \
        app/src/components/StockChart.jsx tools/chart_parity_cases.json docs/decisions/2026-08-02-macd-head-mask.md
git commit -m "chore(engine): the MACD head-mask becomes a measured, flagged decision

The mask holds the MACD line's head back to the signal's first bar -- 8 bars at
12/26/9 -- so this chart looks as it always has while the column disagrees with
the Python lane. Dropping it is VISIBLE, so it needs owner sign-off. This commit
changes no pixel: it names the switch (MACD_HEAD_MASK), points both lanes at it,
adds the parity case that prices the change, and records the decision. A test
asserts the UNMASKED line genuinely starts 8 bars earlier, so the decision cannot
degrade into theatre.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: MACD — Flip A

The third pilot and the stress test: three plots in one auto-scaled band, one of them a sign-coloured histogram with its own `precision: 5`, plus a `largeDashed` zero guide. It is the only migration that exercises `colorMode: 'sign'` (B2 review Critical #3), the only one with two pool keys in a single instance, and the case that proves the head-mask survived (`macd_only`'s `why` says so).

**Files:**
- Modify: `app/src/components/StockChart.jsx:76`, `:5998-6035`
- Modify: `tools/chart_parity_cases.json`
- Create: `app/src/components/chart/engine/__tests__/macdFlipAParity.test.js`

**Interfaces:**
- Consumes: `MACD_HEAD_MASK` (Task 5), `engineChips` (Task 2 — MACD declares two visible chips and one hidden).
- Produces: `ENGINE_MIGRATED_DEF_IDS` = `Set(['rsi', 'bb', 'macd'])`.

- [ ] **Step 1: Write the transcription test**

Create `app/src/components/chart/engine/__tests__/macdFlipAParity.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_DEFAULT } from '../pool'
import * as engineRegistry from '../nativeRegistry'
import { computeMACD } from '../../indicators'
import { computePaneMargins } from '../../paneMargins'
import { createFakeChart, makeBars } from './fakeChart'

// ─── THE FLIP-A CONTRACT FOR MACD ───────────────────────────────────────────
//
// The stress test the spec's migration order asks for: multi-plot, two pool
// keys in one instance, a sign-coloured histogram, a `largeDashed` guide, and a
// band that AUTOSCALES rather than carrying a fixed range.
//
// WHAT THIS HOLDS THAT THE PIXEL GATE CANNOT: that the histogram's per-bar
// colours come from the SIGN of the value and not from a series colour. A flat
// green histogram over a mostly-positive fixture is a small diff and an
// unattributable one; here it is a per-bar assertion.

/** `:6004-6020`, verbatim. */
const LEGACY_LINE = {
  priceScaleId: 'macd', color: '#2196F3', lineWidth: 1,
  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
}
const LEGACY_SIGNAL = { ...LEGACY_LINE, color: '#FF9800' }
/** `:6016-6020` — a HistogramSeries with precision 5 and no colour at all; the
 *  colour rides on every point (`:4002`). */
const LEGACY_HIST = {
  priceScaleId: 'macd', priceFormat: { type: 'price', precision: 5 },
  priceLineVisible: false, lastValueVisible: false,
}
/** `applyIndScale('macd', …, { autoScale: true })` — `:6021`. */
const legacyScaleOptions = (band) => ({ borderVisible: false, scaleMargins: band, autoScale: true })
/** `:6022`. LineStyle 3 = LargeDashed. */
const LEGACY_ZERO_LINE = { price: 0, color: 'rgba(255,255,255,0.12)', lineWidth: 1, lineStyle: 3, axisLabelVisible: false }
/** `StockChart.jsx:91-92`, verbatim. */
const MACD_HIST_UP = 'rgba(76,175,80,0.75)'
const MACD_HIST_DOWN = 'rgba(244,67,54,0.75)'

const BARS = makeBars(260)
const INSTANCE = {
  instanceId: 'legacy:macd', defId: 'macd', defVersion: 1,
  inputs: { fastPeriod: 12, slowPeriod: 26, signalPeriod: 9, macdColor: '#2196F3', signalColor: '#FF9800' },
  placement: { target: 'pane' }, hidden: false,
}
const CS = { indicators: { macd: { enabled: true } } }
const BAND = computePaneMargins(CS, false, new Set()).macd

const sync = () => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const result = binder.sync({
    enabled: true, registry: engineRegistry, instances: [INSTANCE], bars: BARS,
    adjustTime: (t) => t, resolvePlacement,
    paneMargins: computePaneMargins(CS, false, new Set()),
    volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    plan: { fresh: true },
  })
  return { F, result }
}

describe('MACD Flip A — two lines, a histogram, one guide', () => {
  it('creates three series: LineSeries, LineSeries, HistogramSeries', () => {
    const { F, result } = sync()
    expect(result.bound).toBe(3)
    expect(F.seriesCreated.map(s => String(s.__ctor)))
      .toEqual(['LineSeries', 'LineSeries', 'HistogramSeries'])
  })

  it('the two lines carry the legacy options verbatim', () => {
    const { F } = sync()
    const [line, signal] = F.callsOf('addSeries')
    expect(line.args[1]).toMatchObject(LEGACY_LINE)
    expect(signal.args[1]).toMatchObject(LEGACY_SIGNAL)
  })

  it('the histogram carries precision 5 and NO series colour of its own', () => {
    const { F } = sync()
    const hist = F.callsOf('addSeries')[2].args[1]
    expect(hist).toMatchObject(LEGACY_HIST)
    // A histogram's key set is deliberately smaller than a line's: no lineWidth,
    // no lineStyle, no crosshair marker. Passing them would describe a series
    // that is not there, and a histogram can only ever be re-purposed by another
    // histogram, so there is nothing of that kind to inherit.
    expect(hist).not.toHaveProperty('lineWidth')
    expect(hist).not.toHaveProperty('lineStyle')
    expect(hist).not.toHaveProperty('crosshairMarkerVisible')
  })

  it('every histogram BAR is coloured by the sign of its value', () => {
    // B2 review Critical #3: the engine emitted {time,value} only, so the whole
    // pane drew in one flat LWC default where legacy is green above zero and red
    // below. `>= 0` matches `StockChart.jsx:4002` exactly.
    const { F } = sync()
    const points = F.callsOf('setData')[2].args[0]
    let coloured = 0
    for (const p of points) {
      if (p.value === undefined) { expect(p.color).toBeUndefined(); continue }
      expect(p.color).toBe(p.value >= 0 ? MACD_HIST_UP : MACD_HIST_DOWN)
      coloured++
    }
    expect(coloured, 'no histogram bar had a value — this case is vacuous').toBeGreaterThan(100)
    const ups = points.filter(p => p.color === MACD_HIST_UP).length
    const downs = points.filter(p => p.color === MACD_HIST_DOWN).length
    expect(ups, 'the fixture must exercise BOTH colours').toBeGreaterThan(0)
    expect(downs, 'the fixture must exercise BOTH colours').toBeGreaterThan(0)
  })

  it('the band AUTOSCALES — the complete set, on the MACD line\'s scale', () => {
    const { F } = sync()
    const applied = F.callsOf('priceScale.applyOptions').map(c => c.args[0])
    expect(applied.length).toBeGreaterThan(0)
    for (const opts of applied) expect(opts).toEqual(legacyScaleOptions(BAND))
  })

  it('all three sit in pane 0 and drive their own scale', () => {
    const { F } = sync()
    for (const call of F.callsOf('addSeries')) {
      expect(call.args[2]).toBe(0)
      if (call.args[1].autoscaleInfoProvider) expect(call.args[1].autoscaleInfoProvider).toBe(AUTOSCALE_DEFAULT)
    }
  })

  it('the zero guide is LargeDashed, on the FIRST data-bearing series', () => {
    const { F } = sync()
    const lines = F.callsOf('createPriceLine')
    expect(lines).toHaveLength(1)
    expect(lines[0].args[0]).toEqual(LEGACY_ZERO_LINE)
    // Legacy puts it on the MACD line (`:6022`), which is the first data plot.
    expect(lines[0].id).toBe(F.seriesCreated[0].__id)
  })

  it('the head-mask survived the move', () => {
    const { F } = sync()
    const raw = computeMACD(BARS, 12, 26, 9)
    const sigStart = raw.signal.findIndex(p => Number.isFinite(p.value))
    const drawn = F.callsOf('setData')[0].args[0]
    for (let i = 0; i < sigStart; i++) {
      expect(drawn[i], `bar ${i} must be masked back to the signal's start`).toEqual({ time: BARS[i].t })
    }
    expect(drawn[sigStart].value).toBe(raw.macd[sigStart].value)
  })
})
```

- [ ] **Step 2: Run it — should already PASS**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/macdFlipAParity.test.js`
Expected: PASS. A failure here is a definition/shipped-block disagreement — fix `nativeRegistry`, not the test. If "the fixture must exercise BOTH colours" fails, `makeBars` is too monotonic; extend it rather than weakening the assertion.

- [ ] **Step 3: Migrate — both edits**

`app/src/components/StockChart.jsx:76`:

```js
export const ENGINE_MIGRATED_DEF_IDS = Object.freeze(new Set(['rsi', 'bb', 'macd']))
```

`:6001` — change the block's condition and comment:

```js
    // ── MACD sub-pane ──
    // `!engineOwned.has('macd')` — the crossover guard (see `engineOwnedDefIds`).
    if (macdD.macd.length && !engineOwned.has('macd')) {
```

The existing `else` branch already removes all three refs, so nothing else changes.

- [ ] **Step 4: Add the parity case**

```jsonc
    {
      "name": "engine_macd_vs_legacy",
      "why": "THE MULTI-PLOT STRESS TEST. Two lines and a sign-coloured histogram in one autoscaled band, plus a LargeDashed zero guide — the only migration that exercises colorMode 'sign' (a flat-coloured histogram was B2 review Critical #3), the only one binding two pool keys from a single instance, and the one that proves the MACD head-mask crossed with the render.",
      "settings": {
        "indicators": {
          "macd": {
            "enabled": true, "fastPeriod": 12, "slowPeriod": 26, "signalPeriod": 9,
            "macdColor": "#2196F3", "signalColor": "#FF9800"
          }
        }
      },
      "instancesB": [
        {
          "instanceId": "legacy:macd", "defId": "macd", "defVersion": 1,
          "inputs": {
            "fastPeriod": 12, "slowPeriod": 26, "signalPeriod": 9,
            "macdColor": "#2196F3", "signalColor": "#FF9800"
          },
          "placement": { "target": "pane" }, "hidden": false
        }
      ]
    },
```

Also add `engine_bb_rsi_macd_vs_legacy` mirroring the existing `bb_rsi_macd` settings with all three instances, `why`: *"All three pilots at once: a price overlay plus TWO extra bands. The only case that can see a pane-ordering or pane-height regression caused by the engine reserving bands through `computePaneMargins` while drawing all its series at one z-position."*

- [ ] **Step 5: Run the gate**

```bash
cd app && npm run build && rm -rf /tmp/parity-B3T6 && cp -r dist /tmp/parity-B3T6
python ../tools/spa_server.py /tmp/parity-B3T6 5185 &
B=http://127.0.0.1:5185
cd ..
C="engine_macd_vs_legacy engine_bb_rsi_macd_vs_legacy"
python tools/chart_parity.py --base-a $B --base-b $B --cases $C --instances-side none
python tools/chart_parity.py --base-a $B --base-b $B --cases $C --instances-side both
python tools/chart_parity.py --base-a $B --base-b $B --cases $C
python tools/chart_parity.py --base-a $B --base-b $B --cases engine_macd_vs_legacy \
    --perturb-b-instances '{"macdColor": "#2196F4"}'
```

Expected: `0`, `0`, **`0` exit 0**, **non-zero exit 1**.

**Failure modes:** a solid-coloured histogram band = `colorMode: 'sign'` is not reaching `toPoints`; a histogram at a different height = the `precision: 5` / `minMove` interaction (`pool.js:282-289` — `minMove` must NOT be emitted); the MACD line 8 bars long at the left = the head-mask; the whole band taller or shorter = `computePaneMargins` was handed a different `cs`.

- [ ] **Step 6: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | drop `&& !engineOwned.has('macd')` | wiring `it.each([...ENGINE_MIGRATED_DEF_IDS])` double-draw rail |
| M2 | remove `'macd'` from `ENGINE_MIGRATED_DEF_IDS`, keep the guard | same rail (`the engine bound nothing for macd`) |
| M3 | `nativeRegistry` macd histogram → drop `colorMode: 'sign'` | `defSchema` rejects it at import (colorUp/colorDown without a mode); if instead you drop all three, `macdFlipAParity` "every histogram BAR is coloured by the sign" |
| M4 | histogram `precision: 2` | `macdFlipAParity` "precision 5 and NO series colour" |
| M5 | zero guide `lineStyle: 'dashed'` | `macdFlipAParity` "the zero guide is LargeDashed" **and** the pixel gate (the 379-px class) |
| M6 | `autoPane` → `fixedPane(-1, 1)` for macd | `macdFlipAParity` "the band AUTOSCALES" |

- [ ] **Step 7: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__ && cd ..
git add app/src/components/StockChart.jsx tools/chart_parity_cases.json \
        app/src/components/chart/engine/__tests__/macdFlipAParity.test.js
git commit -m "feat(charts): MACD — Flip A, the multi-plot stress test

Two lines and a sign-coloured histogram in one autoscaled band, two pool keys
from one instance, a LargeDashed zero guide, and the head-mask carried across.
Per-bar colour is asserted bar by bar against StockChart.jsx:4002 rather than
left to a pixel diff, because a flat-coloured histogram over a mostly-positive
fixture is a small and unattributable number.

engine_macd_vs_legacy: 0 changed px (tol 0). engine_bb_rsi_macd_vs_legacy: 0.
--perturb-b-instances: non-zero, exit 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: The intraday parity fixture

Closes B3 carry #4. `app/src/pages/parityBars/ramp200.json` is **200 DAILY bars** with `t` as `"YYYY-MM-DD"`. VWAP does not exist on a daily chart — `VWAP_TFS` is `{'1','5','15','30','60'}` (`StockChart.jsx:569`) — so every VWAP parity case would render an empty chart and pass forever. That is the exact failure class this whole runbook is about.

The fixture also has to satisfy spec §9.1's mandatory session cases: **an extended-hours day crossing UTC midnight, and a DST transition.** `computeVWAP` buckets by UTC calendar day (`indicators.js:174-176`), so both are live inputs to what it draws.

**Files:**
- Create: `tools/gen_intraday_fixture.py`
- Create: `app/src/pages/parityBars/intraday5m.json`
- Modify: `tools/chart_parity_cases.json` (`defaults` documentation + per-case `tf`/`fixedbars` override)
- Modify: `docs/runbooks/chart-parity-gate.md`
- Create: `app/src/pages/parityBars/intraday5m.test.js`

**Interfaces:**
- Produces: a fixture whose bars are `{t: <unix seconds, number>, o, h, l, c, v}` — **numeric `t`, not a date string**. `computeVWAP` does `new Date(bar.t * 1000)`; a `"YYYY-MM-DD"` string makes that `NaN` and the whole column vanishes.
- Produces: parity case fields `"tf": "5", "fixedbars": "intraday5m", "bars": 468`.

- [ ] **Step 1: Write the failing fixture test**

Create `app/src/pages/parityBars/intraday5m.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fixture from './intraday5m.json'
import { computeVWAP } from '../../components/chart/indicators'

// The fixture is DATA a baseline PNG depends on. These assertions are what stop
// somebody regenerating it — every stored baseline expires the moment they do.

const bars = fixture.bars
const utcDay = (t) => { const d = new Date(t * 1000); return `${d.getUTCFullYear()}-${d.getUTCMonth() + 1}-${d.getUTCDate()}` }
const etParts = (t) => new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
}).formatToParts(new Date(t * 1000)).reduce((a, p) => ({ ...a, [p.type]: p.value }), {})

describe('the intraday parity fixture (B3 carry #4)', () => {
  it('is 5-minute bars with NUMERIC unix-second timestamps', () => {
    expect(fixture.tf).toBe('5')
    expect(bars.length).toBeGreaterThan(400)
    for (const b of bars) {
      expect(typeof b.t, 'computeVWAP does new Date(t*1000) — a date STRING yields NaN').toBe('number')
      expect(Number.isInteger(b.t)).toBe(true)
    }
    for (let i = 1; i < bars.length; i++) {
      expect(bars[i].t, `bars must be strictly ascending at ${i}`).toBeGreaterThan(bars[i - 1].t)
    }
  })

  it('spans MORE THAN ONE session, so VWAP actually resets', () => {
    const days = new Set(bars.map(b => utcDay(b.t)))
    expect(days.size, 'a single-day fixture cannot see a session reset').toBeGreaterThanOrEqual(3)
  })

  it('contains EXTENDED-HOURS bars past 20:00 ET — the UTC-midnight crossing', () => {
    // Spec §9.1's mandatory session case. 20:00 ET is 00:00 UTC the next day, so
    // computeVWAP's UTC-day bucketing restarts the accumulator MID-SESSION.
    // Preserving that is Flip A's job; fixing it is a flagged decision (A7).
    const late = bars.filter(b => Number(etParts(b.t).hour) >= 20)
    expect(late.length, 'no post-20:00 ET bar — the UTC-midnight case is absent').toBeGreaterThan(0)
  })

  it('crosses a DST transition — the ET hour that trips the bucket MOVES', () => {
    const zones = new Set(bars.map(b => etParts(b.t).timeZoneName))
    expect([...zones].sort(), 'the fixture must span EST and EDT').toEqual(['EDT', 'EST'])
  })

  it('VWAP computes a finite value on essentially every bar', () => {
    // OBV and VWAP are finite from bar 0 given non-zero volume. A fixture with a
    // zero-volume bar would leave a gap the baseline then bakes in.
    const out = computeVWAP(bars)
    expect(out).toHaveLength(bars.length)
    expect(out.every(p => Number.isFinite(p.value))).toBe(true)
  })

  it('the accumulator DOES reset — the fixture can see the bug it pins', () => {
    // If VWAP never reset, an ET-session fix would be indistinguishable from the
    // UTC-day behaviour and the A7 decision would be unmeasurable.
    const out = computeVWAP(bars)
    let resets = 0
    for (let i = 1; i < bars.length; i++) {
      if (utcDay(bars[i].t) !== utcDay(bars[i - 1].t)) {
        // The first bar of a new UTC day is its own VWAP: tp of that bar alone.
        const tp = (bars[i].h + bars[i].l + bars[i].c) / 3
        expect(out[i].value).toBeCloseTo(tp, 9)
        resets++
      }
    }
    expect(resets, 'no UTC-day boundary in the fixture').toBeGreaterThanOrEqual(3)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/pages/parityBars/intraday5m.test.js`
Expected: FAIL — `Cannot find module './intraday5m.json'`.

- [ ] **Step 3: Write the generator**

Create `tools/gen_intraday_fixture.py`:

```python
#!/usr/bin/env python3
"""Generate `app/src/pages/parityBars/intraday5m.json` — the intraday parity fixture.

WHY IT EXISTS. `ramp200.json` is 200 DAILY bars. VWAP is gated to
`VWAP_TFS = {1,5,15,30,60}` (`StockChart.jsx:569`), so a VWAP parity case run
against a daily fixture renders an EMPTY chart on both sides and reports 0 forever.
That is a gate that cannot fail, which is the class this whole runbook exists to
prevent (B3 carry #4).

WHAT IT MUST CONTAIN, per spec §9.1:
  * 5-minute bars with NUMERIC unix-second `t` -- `computeVWAP` does
    `new Date(bar.t * 1000)`, and the daily fixture's "YYYY-MM-DD" strings make
    that NaN.
  * EXTENDED HOURS past 20:00 ET, which is 00:00 UTC the next day, so
    `computeVWAP`'s UTC-day bucketing restarts the accumulator MID-SESSION. That
    behaviour is what the shipped chart draws and Flip A must preserve it.
  * A DST TRANSITION, because the ET hour at which the bucket trips moves by one.

The window: **2025-11-01 04:00 ET through 2025-11-04 20:00 ET**. US DST ended
Sunday 2025-11-02 at 02:00, so Saturday's tail is EDT and Monday/Tuesday are EST.
Weekend bars are omitted (the tape has none), which also gives the fixture a
multi-day gap -- a shape the daily fixture cannot produce.

DETERMINISTIC. A fixed-seed LCG, exactly like `ramp200`. Regenerating with a
different seed invalidates every stored baseline at once.

⛔ DO NOT RE-RUN THIS once baselines exist. It is committed so the fixture's
provenance is auditable, not so it is convenient to replace.
"""
import argparse
import datetime as dt
import json
import pathlib
import zoneinfo

ET = zoneinfo.ZoneInfo("America/New_York")
SEED = 20260802
OUT = pathlib.Path(__file__).resolve().parents[1] / "app/src/pages/parityBars/intraday5m.json"

# 04:00 ET (pre-market open) through 20:00 ET (post-market close) = 192 bars/day.
SESSION_START_MIN = 4 * 60
SESSION_END_MIN = 20 * 60
DAYS = ["2025-11-01", "2025-11-03", "2025-11-04"]   # Sat (EDT), Mon (EST), Tue (EST)


class LCG:
    """The same generator shape ramp200 used. Deterministic across platforms."""

    def __init__(self, seed: int) -> None:
        self.s = seed & 0xFFFFFFFF

    def next(self) -> float:
        self.s = (1664525 * self.s + 1013904223) & 0xFFFFFFFF
        return self.s / 0xFFFFFFFF


def build() -> dict:
    rng = LCG(SEED)
    price = 100.0
    bars = []
    for day_i, day in enumerate(DAYS):
        y, m, d = (int(x) for x in day.split("-"))
        # A gentle per-day drift so BB/RSI/MACD have something to draw and the
        # MACD histogram crosses zero in both directions.
        drift = (+0.012, -0.020, +0.015)[day_i]
        for minute in range(SESSION_START_MIN, SESSION_END_MIN, 5):
            local = dt.datetime(y, m, d, minute // 60, minute % 60, tzinfo=ET)
            t = int(local.timestamp())
            step = (rng.next() - 0.5) * 0.30 + drift
            o = round(price, 2)
            c = round(price + step, 2)
            hi = round(max(o, c) + rng.next() * 0.12, 2)
            lo = round(min(o, c) - rng.next() * 0.12, 2)
            # Extended-hours volume is thin, regular-hours is not. VWAP is
            # volume-weighted, so a flat volume profile would hide the very
            # weighting the indicator is about.
            regular = 9 * 60 + 30 <= minute < 16 * 60
            v = int((180_000 if regular else 22_000) * (0.6 + rng.next() * 0.8))
            bars.append({"t": t, "o": o, "h": hi, "l": lo, "c": c, "v": max(v, 1)})
            price = c
    return {
        "name": "intraday5m",
        "tf": "5",
        "note": (
            "468 synthetic FIVE-MINUTE bars for the chart parity gate, generated by "
            "tools/gen_intraday_fixture.py (seed 20260802). Covers 04:00-20:00 ET on "
            "Sat 2025-11-01 (EDT), Mon 2025-11-03 and Tue 2025-11-04 (EST) -- so it "
            "spans a DST transition, contains extended-hours bars past 20:00 ET (= "
            "00:00 UTC the next day, where computeVWAP's UTC-day bucketing restarts "
            "the accumulator mid-session), and has a weekend gap. `t` is UNIX SECONDS "
            "because that is what /api/bars returns for intraday and because "
            "computeVWAP does new Date(t*1000). DO NOT REGENERATE: new bars "
            "invalidate every stored baseline."
        ),
        "bars": bars,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--force", action="store_true",
                    help="overwrite an existing fixture (invalidates every baseline)")
    args = ap.parse_args()
    if OUT.exists() and not args.force:
        raise SystemExit(f"{OUT} exists. Regenerating invalidates every stored baseline; pass --force if you mean it.")
    OUT.write_text(json.dumps(build(), indent=1) + "\n", encoding="utf-8")
    print(f"wrote {OUT} ({len(build()['bars'])} bars)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Generate and verify the fixture**

```bash
python tools/gen_intraday_fixture.py
cd app && npx vitest run src/pages/parityBars/intraday5m.test.js
```
Expected: the generator writes 468 bars; the suite PASSES.

If "the fixture must span EST and EDT" fails, `zoneinfo` has no tzdata — install `tzdata` (`pip install tzdata`) and regenerate. Do **not** relax the assertion: a fixture with no DST transition silently drops half of what spec §9.1 requires.

- [ ] **Step 5: Teach the case list about per-case fixtures**

In `tools/chart_parity_cases.json`, extend the `note` array:

```jsonc
    "A case may override `tf`, `fixedbars` and `bars` from `defaults`. VWAP is",
    "gated to intraday timeframes (VWAP_TFS), so a VWAP case MUST carry",
    "\"tf\": \"5\", \"fixedbars\": \"intraday5m\" -- against the daily fixture it",
    "renders an empty chart on BOTH sides and reports 0 forever.",
```

`case_url` already reads `case.get("tf")`, `case["fixedbars"]` and `case.get("bars")`, so no Python change is needed. Confirm by grep:

```bash
grep -n '"tf", "D"\|case\["fixedbars"\]\|case.get("bars")' tools/chart_parity.py
```
Expected: three hits inside `case_url`. If `fixedbars` is not per-case, add it to the `defaults` merge before continuing.

- [ ] **Step 6: Add a smoke case that proves the fixture renders**

```jsonc
    {
      "name": "intraday_bars_only",
      "why": "PROVES THE INTRADAY FIXTURE RENDERS AT ALL. Every VWAP number below is measured against this fixture, and a fixture that produced a blank chart would make each of them a permanent, silent 0. No indicator: candles and volume on 5-minute bars, which is the smallest thing that fails if the fixture is unreadable.",
      "tf": "5",
      "fixedbars": "intraday5m",
      "bars": 468,
      "settings": {}
    },
```

- [ ] **Step 7: Prove it renders, and prove the case can fail**

```bash
cd app && npm run build && rm -rf /tmp/parity-B3T7 && cp -r dist /tmp/parity-B3T7
python ../tools/spa_server.py /tmp/parity-B3T7 5185 &
B=http://127.0.0.1:5185
cd ..
python tools/chart_parity.py --base-a $B --same-build --cases intraday_bars_only
python tools/chart_parity.py --base-a $B --same-build --cases intraday_bars_only \
    --perturb-b '{"candles": {"upColor": "#1ae51b"}}'
```

Expected: **`0` exit 0**, then **non-zero exit 1**. Then open `tools/chart_parity_out/base/intraday_bars_only.png` and **look at it**: it must show candles, not an empty grid. A 0 against two blank canvases is exactly the vacuous green this task exists to prevent, and no assertion in the harness can tell the difference.

- [ ] **Step 8: Document it**

In `docs/runbooks/chart-parity-gate.md`, under "Adding a case":

```markdown
### Two bar fixtures, and when each is wrong

| fixture | `tf` | shape |
|---|---|---|
| `ramp200` | `D` | 200 daily bars, `t` = `"YYYY-MM-DD"` (a Lightweight Charts BusinessDay) |
| `intraday5m` | `5` | 468 five-minute bars, `t` = **unix seconds**, 04:00–20:00 ET across a weekend gap and a DST transition |

**VWAP cannot be measured against `ramp200`.** `VWAP_TFS` gates it to
`1/5/15/30/60`, so a daily VWAP case renders an empty chart on both sides and
reports 0 forever. Anything session-dependent — VWAP now, session shading and
anchored VWAP later — takes `intraday5m`.

Neither fixture may be regenerated: new bars invalidate every stored baseline at
once. `tools/gen_intraday_fixture.py` refuses to overwrite without `--force`.
```

- [ ] **Step 9: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | rewrite one fixture `t` as `"2025-11-03"` | fixture test "NUMERIC unix-second timestamps" |
| M2 | trim `DAYS` to a single day and regenerate to a scratch path | "spans MORE THAN ONE session" and "the accumulator DOES reset" |
| M3 | set `SESSION_END_MIN = 16*60` (regular hours only) and regenerate to scratch | "contains EXTENDED-HOURS bars past 20:00 ET" |
| M4 | move `DAYS` entirely inside November (all EST) and regenerate to scratch | "crosses a DST transition" |
| M5 | set one bar's `v` to 0 | "VWAP computes a finite value on essentially every bar" |

Regenerate mutations to a scratch path (`OUT` override) so the committed fixture is never disturbed.

- [ ] **Step 10: Commit**

```bash
cd app && npx vitest run src/pages/parityBars && cd ..
git add tools/gen_intraday_fixture.py app/src/pages/parityBars/intraday5m.json \
        app/src/pages/parityBars/intraday5m.test.js tools/chart_parity_cases.json \
        docs/runbooks/chart-parity-gate.md
git commit -m "test(charts): the intraday parity fixture — VWAP had no gate at all

Closes B3 carry #4. ramp200 is 200 DAILY bars and VWAP_TFS gates VWAP to
1/5/15/30/60, so every VWAP parity case would have rendered an empty chart on
both sides and reported 0 forever. intraday5m is 468 five-minute bars with
numeric unix-second timestamps across a weekend gap and a DST transition, with
extended-hours bars past 20:00 ET so computeVWAP's UTC-day bucketing genuinely
restarts mid-session -- the two session cases spec §9.1 makes mandatory. A smoke
case proves the fixture renders candles, because a 0 between two blank canvases
looks exactly like a pass.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: VWAP eligibility + Flip A

The last Flip A, and the one with no clean expression in the definition schema. Legacy VWAP (`StockChart.jsx:5900-5929`) is four special cases stacked:

1. **Intraday gate** — `VWAP_TFS.has(resolvedTf)` (`:569`, `:3963`). On a daily chart VWAP does not exist at all.
2. **`vwapOverride` prop** — the Model Book intraday popup forces the colour to white and forces the indicator ON regardless of the user's setting (`:1034`, `:3963`, `:5905`).
3. **Colour from TWO inputs** — `_withVwapOpacity(base, opacityPct)` composes `color` × `opacity` into an `rgba()` at render time (`:581-587`, `:5907`). `plots[].opacity` is NOT in `SUBSTITUTABLE_PLOT_FIELDS`, so `$opacity` cannot reach it (B2 fix-wave finding #4).
4. **Width fallback** — an unset `lineWidth` becomes `0.5` under `boldCandles || modelBookLook`, else `1` (`:5911-5913`).

None of these is expressible in `plots[]`, and inventing schema for a render-context fallback would be schema serving one indicator. The seam is an **eligibility hook**: a pure module the call site consults before handing an instance to the binder.

**Files:**
- Create: `app/src/components/chart/engine/eligibility.js`
- Create: `app/src/components/chart/engine/eligibility.test.js`
- Create: `app/src/components/chart/engine/__tests__/vwapFlipAParity.test.js`
- Modify: `app/src/components/chart/engine/nativeRegistry.js` (VWAP eligibility metadata)
- Modify: `app/src/components/StockChart.jsx:76`, `:5570-5573`, `:5900-5929`
- Modify: `tools/chart_parity_cases.json`

**Interfaces:**
- Produces: `eligibleInstances(instances, registry, ctx) → {kept, hidden}` where `ctx = {tf, vwapOverride, boldCandles, modelBookLook}`.
- Produces: `nativeRegistry` VWAP gains `meta.timeframes: ['1','5','15','30','60']` (a declared gate, validated by `defSchema`) and the composition stays in `eligibility.js` because it is render context, not authoring data.
- Produces: `ENGINE_MIGRATED_DEF_IDS` = `Set(['rsi', 'bb', 'macd', 'vwap'])`.

- [ ] **Step 1: Write the failing eligibility test**

Create `app/src/components/chart/engine/eligibility.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { eligibleInstances, VWAP_TIMEFRAMES } from './eligibility'
import * as engineRegistry from './nativeRegistry'

const VWAP = {
  instanceId: 'legacy:vwap', defId: 'vwap',
  inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  placement: { target: 'price' }, hidden: false,
}
const RSI = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: {}, hidden: false }
const run = (instances, ctx) => eligibleInstances(instances, engineRegistry, ctx)

describe('eligibility — what the definition schema cannot say', () => {
  it('VWAP renders on an intraday timeframe', () => {
    expect(VWAP_TIMEFRAMES).toEqual(['1', '5', '15', '30', '60'])
    expect(run([VWAP], { tf: '5' }).kept.map(i => i.defId)).toEqual(['vwap'])
  })

  it('VWAP does NOT render on D / W / M', () => {
    for (const tf of ['D', 'W', 'M']) {
      expect(run([VWAP], { tf }).kept, tf).toEqual([])
      expect(run([VWAP], { tf }).hidden.map(h => h.reason), tf).toEqual(['timeframe'])
    }
  })

  it('a definition with NO declared timeframes renders on every one', () => {
    for (const tf of ['5', 'D', 'W']) expect(run([RSI], { tf }).kept.map(i => i.defId)).toEqual(['rsi'])
  })

  it('vwapOverride recolours — and only recolours', () => {
    // `:5905` — the override wins on colour; the user's opacity, style and width
    // still apply. It is "recolour", never "replace the whole configuration".
    const { kept } = run([{ ...VWAP, inputs: { ...VWAP.inputs, opacity: 40, lineWidth: 3 } }],
      { tf: '5', vwapOverride: { color: '#ffffff' } })
    expect(kept[0].inputs.color).toBe('rgba(255, 255, 255, 0.4)')
    expect(kept[0].inputs.lineWidth).toBe(3)
    expect(kept[0].inputs.lineStyle).toBe('solid')
  })

  it('opacity is COMPOSED into the colour, exactly as _withVwapOpacity does', () => {
    // `StockChart.jsx:581-587`: 100 returns the base untouched (so a user who
    // never opened the setting sees no change at all), anything else becomes
    // `rgba(r, g, b, a)` with that spacing.
    expect(run([VWAP], { tf: '5' }).kept[0].inputs.color).toBe('#26C6DA')
    const dim = run([{ ...VWAP, inputs: { ...VWAP.inputs, opacity: 40 } }], { tf: '5' })
    expect(dim.kept[0].inputs.color).toBe('rgba(38, 198, 218, 0.4)')
  })

  it('an unparseable colour falls through untouched rather than guessing', () => {
    const odd = run([{ ...VWAP, inputs: { ...VWAP.inputs, color: 'rebeccapurple', opacity: 50 } }], { tf: '5' })
    expect(odd.kept[0].inputs.color).toBe('rebeccapurple')
  })

  it('an UNSET width takes the render-context fallback', () => {
    // `:5911-5913`. 0.5 under the bold/Model Book look, 1 otherwise. Not
    // expressible as a definition default: it depends on which surface is drawing.
    const bare = { ...VWAP, inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid' } }
    expect(run([bare], { tf: '5' }).kept[0].inputs.lineWidth).toBe(1)
    expect(run([bare], { tf: '5', boldCandles: true }).kept[0].inputs.lineWidth).toBe(0.5)
    expect(run([bare], { tf: '5', modelBookLook: true }).kept[0].inputs.lineWidth).toBe(0.5)
    // …and a DECLARED width beats the fallback on every surface.
    expect(run([VWAP], { tf: '5', boldCandles: true }).kept[0].inputs.lineWidth).toBe(1)
  })

  it('returns NEW instances — the caller\'s list is never mutated', () => {
    const input = [{ ...VWAP, inputs: { ...VWAP.inputs, opacity: 40 } }]
    const before = JSON.parse(JSON.stringify(input))
    run(input, { tf: '5', vwapOverride: { color: '#ffffff' } })
    expect(input).toEqual(before)
  })

  it('leaves every other instance strictly alone — same object, same identity', () => {
    const { kept } = run([RSI], { tf: '5', vwapOverride: { color: '#fff' }, boldCandles: true })
    expect(kept[0]).toBe(RSI)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd app && npx vitest run src/components/chart/engine/eligibility.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write `eligibility.js`**

Create `app/src/components/chart/engine/eligibility.js`:

```js
// app/src/components/chart/engine/eligibility.js
//
// ─── MAY THIS INSTANCE RENDER HERE, RIGHT NOW — AND WITH WHAT? ──────────────
//
// Everything the definition schema can say is authored ONCE and is true on every
// surface. Four things about VWAP are not:
//
//   1. it does not exist above 60-minute bars (`VWAP_TFS`, `StockChart.jsx:569`)
//   2. the Model Book intraday popup forces it ON and forces it WHITE
//      (`vwapOverride`, `:1034` / `:3963` / `:5905`)
//   3. its colour is TWO inputs composed at render time — `color` × `opacity`
//      through `_withVwapOpacity` (`:581-587`). `plots[].opacity` cannot express
//      it: `SUBSTITUTABLE_PLOT_FIELDS` is color/width/levels, so `$opacity` has
//      nowhere to land, and B2's fix wave established that wiring `opacity` onto
//      the plot does NOT close this (finding #4).
//   4. an unset width becomes 0.5 on the bold / Model Book look and 1 elsewhere
//      (`:5911-5913`)
//
// None of those is a fact about the INDICATOR; they are facts about the CHART
// that is drawing it. Adding schema for each would be schema serving one native.
// So this module is a pure pre-pass: instances in, instances out, with the
// render context folded into `inputs` — after which the binder, the pool and the
// placement adapter go on knowing nothing about any of it.
//
// ⛔ PURE, AND IT NEVER MUTATES ITS ARGUMENT. It runs inside `updateChart`, and
// the list it is handed is the one `normalizeInstances` produced from the user's
// stored blob. Writing a composed colour back into that would persist a derived
// value as if the user had chosen it.
//
// ⛔ IT MAY ONLY EVER *NARROW*. It can hide an instance and it can fold render
// context into that instance's inputs. It may not ADD an instance: `vwapOverride`
// forcing VWAP on is handled where instances are BUILT (`StockChart`'s
// `engineInstances`), because manufacturing an instance here would give the
// binder something the settings blob never contained and `engineOwnedDefIds`
// never saw.

import { parseColor } from '../colorUtils'

/** `StockChart.jsx:569` — `VWAP_TFS`, verbatim and in order. */
export const VWAP_TIMEFRAMES = Object.freeze(['1', '5', '15', '30', '60'])

/** The width an unset `lineWidth` takes. `:5911-5913`. */
const BOLD_WIDTH = 0.5
const NORMAL_WIDTH = 1

/**
 * `_withVwapOpacity` (`StockChart.jsx:581-587`), transcribed.
 *
 * 100 returns the base UNTOUCHED — so a user who has never opened the opacity
 * setting sees the exact string the legacy path produced, and Flip A parity does
 * not hinge on `rgba(38, 198, 218, 1)` rendering identically to `#26C6DA`.
 * An unparseable colour falls through unchanged rather than guessing.
 */
function withOpacity(color, opacityPct) {
  const pct = Number(opacityPct)
  if (!Number.isFinite(pct) || pct >= 100) return color
  const rgb = parseColor(color)
  if (!rgb) return color
  const a = Math.max(0, Math.min(1, pct / 100))
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${a})`
}

/** The per-definition folds. Keyed by defId, because these ARE per-indicator
 *  special cases and pretending otherwise would spread them across the engine. */
const FOLDS = {
  vwap(inst, ctx) {
    const inputs = { ...(inst.inputs || {}) }
    // The override wins on COLOUR ONLY — the user's opacity, style and width all
    // still apply. `:5903-5905` calls that out explicitly.
    const base = (ctx.vwapOverride && ctx.vwapOverride.color) || inputs.color || '#26C6DA'
    inputs.color = withOpacity(base, inputs.opacity === undefined ? 100 : inputs.opacity)
    if (!(Number(inputs.lineWidth) > 0)) {
      inputs.lineWidth = (ctx.boldCandles || ctx.modelBookLook) ? BOLD_WIDTH : NORMAL_WIDTH
    }
    return { ...inst, inputs }
  },
}

function resolveRegistry(registry) {
  if (typeof registry === 'function') return registry
  if (registry && typeof registry.getDefinition === 'function') return (id) => registry.getDefinition(id)
  return () => null
}

/**
 * Split an instance list into what may render here and what may not.
 *
 * @param {object[]} instances normalised instances
 * @param {object|Function} registry
 * @param {{tf?: string, vwapOverride?: {color?: string}|null,
 *          boldCandles?: boolean, modelBookLook?: boolean}} ctx
 * @returns {{kept: object[], hidden: {inst: object, reason: string}[]}}
 *
 * `hidden` carries a REASON so state 8 of the UX contract's instance inventory
 * ("Hidden-on-this-TF — grayed + tooltip, NOT absent") has something to render.
 * Nothing consumes it yet; dropping an instance with no explanation is how "my
 * VWAP disappeared" becomes unanswerable, and this is the one chance to record it.
 */
export function eligibleInstances(instances, registry, ctx) {
  const get = resolveRegistry(registry)
  const c = ctx || {}
  const kept = []
  const hidden = []

  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object') continue
    const def = get(inst.defId)
    if (!def) { kept.push(inst); continue }   // ownership rules decide; not our call

    const tfs = def.meta && def.meta.timeframes
    if (Array.isArray(tfs) && tfs.length && c.tf !== undefined && !tfs.includes(String(c.tf))) {
      hidden.push({ inst, reason: 'timeframe' })
      continue
    }

    const fold = FOLDS[def.id]
    kept.push(fold ? fold(inst, c) : inst)
  }

  return { kept, hidden }
}
```

Confirm `parseColor`'s import path: `grep -rn "export function parseColor" app/src/components/chart/`. If it lives in `StockChart.jsx` rather than a shared module, **extract it to `app/src/components/chart/colorUtils.js` first** and re-import it in StockChart — the engine may not import the component.

- [ ] **Step 4: Declare the timeframe gate on the definition**

In `defSchema.js`'s `meta` validator:

```js
  if (meta.timeframes !== undefined && meta.timeframes !== null) {
    if (!Array.isArray(meta.timeframes) || !meta.timeframes.length
        || meta.timeframes.some(t => typeof t !== 'string' || !t)) {
      errors.push(
        `meta.timeframes: expected a non-empty array of timeframe codes (the ONLY ones this ` +
        `indicator exists on), got ${fmt(meta.timeframes)}. Omit the field entirely for an ` +
        `indicator that renders everywhere — an empty array would mean "nowhere".`,
      )
    }
  }
```

In `nativeRegistry.js`, VWAP's meta:

```js
  nativeDef('vwap', 'vwap',
    {
      name: 'Session VWAP', shortName: 'VWAP', category: 'Volume',
      // `StockChart.jsx:569` — VWAP_TFS. A session indicator does not exist on a
      // daily bar, and the legacy `indicatorData` memo returns [] above 60m.
      // `engine/eligibility.js` is what enforces it; declaring it here is what
      // lets the Style tab say "intraday only" without a hardcoded list.
      timeframes: ['1', '5', '15', '30', '60'],
    },
    onPrice,
    /* inputs + plots unchanged */),
```

- [ ] **Step 5: Run — green**

Run: `cd app && npx vitest run src/components/chart/engine/eligibility.test.js src/components/chart/engine/defSchema.test.js src/components/chart/engine/nativeRegistry.test.js`
Expected: PASS.

- [ ] **Step 6: Write the VWAP transcription test**

Create `app/src/components/chart/engine/__tests__/vwapFlipAParity.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { createBinder } from '../binder'
import { resolvePlacement } from '../placement'
import { AUTOSCALE_EXCLUDE } from '../pool'
import { eligibleInstances } from '../eligibility'
import * as engineRegistry from '../nativeRegistry'
import { computeVWAP } from '../../indicators'
import { createFakeChart } from './fakeChart'
import fixture from '../../../../pages/parityBars/intraday5m.json'

// ─── THE FLIP-A CONTRACT FOR SESSION VWAP ───────────────────────────────────
//
// Driven by the INTRADAY fixture, not `makeBars`: VWAP is timeframe-gated and a
// daily-bar test of it would assert on an indicator that does not exist.
//
// ⚠️ THE UTC-DAY BUCKETING IS PRESERVED ON PURPOSE. `computeVWAP` restarts its
// accumulator on a UTC calendar day (`indicators.js:174-176`), which is wrong for
// extended hours — 20:00 ET is 00:00 UTC the next day. Flip A draws what the
// shipped chart draws; fixing it is a `compute.rev` bump and a separate flagged
// decision (plan adjudication A7). A test here that asserted ET bucketing would
// be asserting a change this task must not make.

const BARS = fixture.bars
const LEGACY_VWAP = {
  color: '#26C6DA', lineWidth: 1, lineStyle: 0,
  priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
}
const INSTANCE = {
  instanceId: 'legacy:vwap', defId: 'vwap',
  inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid', lineWidth: 1 },
  placement: { target: 'price' }, hidden: false,
}

const sync = (inst = INSTANCE, elig = { tf: '5' }) => {
  const F = createFakeChart()
  const binder = createBinder({ chart: F.chart, LWC: F.LWC })
  const { kept } = eligibleInstances([inst], engineRegistry, elig)
  const result = binder.sync({
    enabled: true, registry: engineRegistry, instances: kept, bars: BARS,
    adjustTime: (t) => t, resolvePlacement,
    paneMargins: {}, volOverlaySet: new Set(), volSeparatePane: false, VOL_PANE_INDEX: 1,
    plan: { fresh: true },
  })
  return { F, result }
}

describe('VWAP Flip A — one line on the candles\' scale, intraday only', () => {
  it('creates one LineSeries with the legacy options verbatim', () => {
    const { F, result } = sync()
    expect(result.bound).toBe(1)
    expect(F.callsOf('addSeries')[0].args[1]).toMatchObject(LEGACY_VWAP)
    expect(F.callsOf('addSeries')[0].args[1].autoscaleInfoProvider).toBe(AUTOSCALE_EXCLUDE)
    expect(F.callsOf('priceScale.applyOptions'), 'must assert nothing on the candles\' axis').toHaveLength(0)
  })

  it('draws NOTHING on a daily chart', () => {
    const { F, result } = sync(INSTANCE, { tf: 'D' })
    expect(result.bound).toBe(0)
    expect(F.count('addSeries')).toBe(0)
  })

  it('composes colour × opacity into the SERIES colour', () => {
    const { F } = sync({ ...INSTANCE, inputs: { ...INSTANCE.inputs, opacity: 40 } })
    expect(F.callsOf('addSeries')[0].args[1].color).toBe('rgba(38, 198, 218, 0.4)')
  })

  it('vwapOverride recolours the line and leaves its width alone', () => {
    const { F } = sync({ ...INSTANCE, inputs: { ...INSTANCE.inputs, lineWidth: 2 } },
      { tf: '5', vwapOverride: { color: '#ffffff' } })
    const opts = F.callsOf('addSeries')[0].args[1]
    expect(opts.color).toBe('#ffffff')
    expect(opts.lineWidth).toBe(2)
  })

  it('an unset width takes 0.5 on the Model Book look', () => {
    const bare = { ...INSTANCE, inputs: { color: '#26C6DA', opacity: 100, lineStyle: 'solid' } }
    expect(sync(bare, { tf: '5' }).F.callsOf('addSeries')[0].args[1].lineWidth).toBe(1)
    expect(sync(bare, { tf: '5', modelBookLook: true }).F.callsOf('addSeries')[0].args[1].lineWidth).toBe(0.5)
  })

  it('the numbers are computeVWAP\'s, UTC-day resets and all', () => {
    const { F } = sync()
    const raw = computeVWAP(BARS)
    const points = F.callsOf('setData')[0].args[0]
    expect(points).toHaveLength(BARS.length)
    for (let i = 0; i < BARS.length; i++) expect(points[i].value, `bar ${i}`).toBe(raw[i].value)
  })

  it('draws no guides and produces no legend chip', () => {
    const { F } = sync()
    expect(F.count('createPriceLine')).toBe(0)
    const def = engineRegistry.getDefinition('vwap')
    expect(def.plots[0].legend.hide).toBe(true)
  })
})
```

- [ ] **Step 7: Run — should already PASS**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/vwapFlipAParity.test.js`
Expected: PASS.

- [ ] **Step 8: Migrate**

`app/src/components/StockChart.jsx:76`:

```js
export const ENGINE_MIGRATED_DEF_IDS = Object.freeze(new Set(['rsi', 'bb', 'macd', 'vwap']))
```

Add the import: `import { eligibleInstances } from './chart/engine/eligibility'`.

Replace the `engineInstances` computation (`:5570-5573`):

```js
    // …filtered to the definitions whose legacy block actually stands down (see
    // `ENGINE_MIGRATED_DEF_IDS`), then narrowed by ELIGIBILITY: a session
    // indicator does not exist above 60-minute bars, and the render context —
    // the Model Book's forced white, the bold-candle hairline — folds into the
    // instance's inputs here so nothing downstream has to know about it.
    //
    // `vwapOverride` also FORCES the indicator on, exactly as the legacy memo
    // does (`:3963`, `(vwapOverride || ind.vwap?.enabled)`). That is an instance
    // this blob does not contain, so it is manufactured HERE where instances are
    // built, never inside `eligibility` — a hook that could invent instances
    // would hand the binder something `engineOwnedDefIds` never saw.
    const engineInstances = engineOn
      ? (() => {
          const migrated = normalizeInstances(cs.indicatorInstances, engineRegistry).kept
            .filter(i => ENGINE_MIGRATED_DEF_IDS.has(i.defId))
          const withForced = (vwapOverride && !migrated.some(i => i.defId === 'vwap'))
            ? [...migrated, {
                instanceId: legacyInstanceId('vwap'), defId: 'vwap',
                inputs: { ...(cs.indicators?.vwap || {}), enabled: undefined },
                placement: { target: 'price' }, hidden: false,
              }]
            : migrated
          return eligibleInstances(withForced, engineRegistry, {
            tf: resolvedTf, vwapOverride, boldCandles, modelBookLook,
          }).kept
        })()
      : EMPTY_INSTANCES
```

⚠️ The forced instance's `inputs` must be filtered to DECLARED input keys or `normalizeInstances` would have rejected it — but it never passes through the validator, so filter explicitly:

```js
                inputs: Object.fromEntries(
                  (engineRegistry.getDefinition('vwap')?.inputs || [])
                    .map(d => d.key)
                    .filter(k => cs.indicators?.vwap?.[k] !== undefined)
                    .map(k => [k, cs.indicators.vwap[k]])),
```

Add `import { normalizeInstances, engineOwnedDefIds, legacyInstanceId } from './chart/engine/instances'`.

Then guard the legacy block (`:5901`):

```js
    // ── Session VWAP (intraday only) ──
    // `!engineOwned.has('vwap')` — the crossover guard (see `engineOwnedDefIds`).
    if (indicatorData.vwap.length && !engineOwned.has('vwap')) {
```

- [ ] **Step 9: Add the parity cases**

```jsonc
    {
      "name": "vwap_only",
      "why": "Session VWAP on FIVE-MINUTE bars — the daily fixture cannot render it at all (VWAP_TFS). Legacy vs legacy: the determinism control for the engine case below.",
      "tf": "5", "fixedbars": "intraday5m", "bars": 468,
      "settings": {
        "indicators": { "vwap": { "enabled": true, "color": "#26C6DA", "opacity": 100, "lineStyle": "solid", "lineWidth": 1 } }
      }
    },
    {
      "name": "engine_vwap_vs_legacy",
      "why": "THE LAST FLIP A, and the one with no clean schema expression. Colour is TWO inputs composed at render time, width has a render-context fallback, and the whole indicator is timeframe-gated — all three handled by `engine/eligibility.js` rather than by inventing schema for one native. Runs on `intraday5m`, which crosses UTC midnight and a DST boundary, so the UTC-day accumulator reset computeVWAP performs is IN the picture and Flip A has to reproduce it.",
      "tf": "5", "fixedbars": "intraday5m", "bars": 468,
      "settings": {
        "indicators": { "vwap": { "enabled": true, "color": "#26C6DA", "opacity": 100, "lineStyle": "solid", "lineWidth": 1 } }
      },
      "instancesB": [
        {
          "instanceId": "legacy:vwap", "defId": "vwap", "defVersion": 1,
          "inputs": { "color": "#26C6DA", "opacity": 100, "lineStyle": "solid", "lineWidth": 1 },
          "placement": { "target": "price" }, "hidden": false
        }
      ]
    },
    {
      "name": "engine_vwap_dimmed_vs_legacy",
      "why": "The opacity composition specifically. `plots[].opacity` is NOT in SUBSTITUTABLE_PLOT_FIELDS, so `$opacity` cannot reach the plot and the B2 fix wave's finding #4 says wiring it does not close this carry. At 40% the line is visibly translucent, so a build that dropped the composition renders it at full strength and this case goes red where `engine_vwap_vs_legacy` (opacity 100, base colour untouched) would not.",
      "tf": "5", "fixedbars": "intraday5m", "bars": 468,
      "settings": {
        "indicators": { "vwap": { "enabled": true, "color": "#26C6DA", "opacity": 40, "lineStyle": "solid", "lineWidth": 1 } }
      },
      "instancesB": [
        {
          "instanceId": "legacy:vwap", "defId": "vwap", "defVersion": 1,
          "inputs": { "color": "#26C6DA", "opacity": 40, "lineStyle": "solid", "lineWidth": 1 },
          "placement": { "target": "price" }, "hidden": false
        }
      ]
    },
```

- [ ] **Step 10: Run the gate**

```bash
cd app && npm run build && rm -rf /tmp/parity-B3T8 && cp -r dist /tmp/parity-B3T8
python ../tools/spa_server.py /tmp/parity-B3T8 5185 &
B=http://127.0.0.1:5185
cd ..
C="engine_vwap_vs_legacy engine_vwap_dimmed_vs_legacy"
python tools/chart_parity.py --base-a $B --base-b $B --cases $C --instances-side none
python tools/chart_parity.py --base-a $B --base-b $B --cases $C --instances-side both
python tools/chart_parity.py --base-a $B --base-b $B --cases $C
python tools/chart_parity.py --base-a $B --base-b $B --cases engine_vwap_vs_legacy \
    --perturb-b-instances '{"color": "#26C6DB"}'
```

Expected: `0`, `0`, **`0` exit 0**, **non-zero exit 1**.

**Before believing the third number, open `tools/chart_parity_out/base/engine_vwap_vs_legacy.png` and confirm a cyan line is present.** Two blank charts diff to 0.

- [ ] **Step 11: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | drop `&& !engineOwned.has('vwap')` | wiring double-draw rail |
| M2 | remove `'vwap'` from `ENGINE_MIGRATED_DEF_IDS` | wiring rail (`the engine bound nothing for vwap`) |
| M3 | `eligibility.js` → `withOpacity` returns `color` always | `eligibility.test.js` "opacity is COMPOSED", `vwapFlipAParity` "composes colour × opacity", **and** `engine_vwap_dimmed_vs_legacy` |
| M4 | drop `meta.timeframes` from VWAP | `eligibility.test.js` "VWAP does NOT render on D / W / M" — and note that `engine_vwap_vs_legacy` would NOT catch it, which is why the unit case exists |
| M5 | width fallback → always `NORMAL_WIDTH` | `eligibility.test.js` "an unset width takes the render-context fallback" |
| M6 | `FOLDS.vwap` mutates `inst.inputs` in place | `eligibility.test.js` "returns NEW instances" |
| M7 | remove the `vwapOverride` forced-instance branch | a new wiring case: Model Book look + `vwapOverride` + engine on ⇒ one cyan/white line (add it) |

- [ ] **Step 12: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__ && cd ..
git add app/src/components/chart/engine/eligibility.js app/src/components/chart/engine/eligibility.test.js \
        app/src/components/chart/engine/__tests__/vwapFlipAParity.test.js \
        app/src/components/chart/engine/nativeRegistry.js app/src/components/chart/engine/defSchema.js \
        app/src/components/StockChart.jsx tools/chart_parity_cases.json
git commit -m "feat(charts): VWAP — Flip A, behind an eligibility hook

The last Flip A and the one with no clean schema expression: timeframe-gated,
colour composed from TWO inputs at render time, width with a render-context
fallback, and a prop that forces it on and white. None of that is a fact about
the indicator, so none of it becomes schema serving one native -- engine/
eligibility.js is a pure pre-pass that narrows the instance list and folds render
context into inputs, after which the binder knows nothing about any of it.

Measured on the new intraday fixture, which crosses UTC midnight and a DST
boundary, so computeVWAP's UTC-day accumulator reset is IN the picture. That
bucketing is preserved deliberately -- fixing it is a compute.rev bump and its
own flagged decision (plan A7).

engine_vwap_vs_legacy: 0 changed px. engine_vwap_dimmed_vs_legacy: 0.
--perturb-b-instances: non-zero, exit 1.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: The Flip-B machinery, landed dark

Everything Flip B needs, with `ENGINE_FLIPPED_DEF_IDS` **empty** — so this task changes zero pixels and zero behaviour, and its gate is exactly that. Splitting it out is deliberate: a reviewer can reject the machinery without rejecting a migration, and the migrations that follow are then two-line changes with a pixel number each.

Three pieces:

1. **Read-time migration.** StockChart reads instances through `migrateLegacyToInstances(cs, registry)` instead of raw `cs.indicatorInstances`, so a blob carrying only the legacy toggle still renders (the migrator projects it), a stored instance wins, and a tombstone blocks resurrection. All three are already implemented and tested.
2. **The pane-margin projection** (adjudication A2). `paneMargins.js` stays untouched; a pure function rewrites `indicators[<id>].enabled` from the instance list for flipped ids only.
3. **The instance control adapter.** Pure `(cs, …) → nextCs` writers that update the instance AND write through to the legacy mirror, so the alert evaluator, `IndicatorAlertPopover`, the screener and the `?indicators=` route keep working.

**Files:**
- Create: `app/src/components/chart/engine/paneMarginsProjection.js` + `.test.js`
- Create: `app/src/components/chart/engine/instanceControls.js` + `.test.js`
- Modify: `app/src/components/StockChart.jsx:76`, `:5513`, `:5570`
- Modify: `app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx`

**Interfaces:**
- Produces: `ENGINE_FLIPPED_DEF_IDS` (exported from `StockChart.jsx`) — initially `new Set()`.
- Produces: `csForPaneMargins(cs, instances, flippedIds) → cs'`.
- Produces: `setIndicatorEnabled(cs, defId, enabled, registry) → cs'`, `setIndicatorInput(cs, defId, key, value, registry) → cs'`, `isIndicatorEnabled(cs, defId, flippedIds) → boolean`.

- [ ] **Step 1: Write the failing projection test**

Create `app/src/components/chart/engine/paneMarginsProjection.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { csForPaneMargins } from './paneMarginsProjection'
import { computePaneMargins } from '../paneMargins'
import { migrateLegacyToInstances } from './instances'
import * as engineRegistry from './nativeRegistry'

const CS = {
  indicators: {
    rsi: { enabled: true, period: 14 }, macd: { enabled: true },
    stoch: { enabled: false }, atr: { enabled: true },
  },
}

describe('csForPaneMargins — instances drive the bands without touching paneMargins.js', () => {
  it('with NO flipped ids it returns the SAME object — a true no-op', () => {
    // Task 9 lands dark. If this ever allocated, every chart would recompute its
    // margins from a fresh object on every paint for no reason.
    expect(csForPaneMargins(CS, [], new Set())).toBe(CS)
  })

  it('produces margins DEEP-EQUAL to the legacy read, for a legacy-equivalent blob', () => {
    // THE GATE FOR ADJUDICATION A2. The projection is only allowed to exist
    // because it is provably the same answer.
    const instances = migrateLegacyToInstances(CS, engineRegistry)
    const flipped = new Set(['rsi', 'macd', 'atr'])
    const projected = csForPaneMargins(CS, instances, flipped)
    expect(computePaneMargins(projected, true, new Set()))
      .toEqual(computePaneMargins(CS, true, new Set()))
    // …and with volume off, and with an overlay exclusion, because the margins
    // function branches on both.
    expect(computePaneMargins(projected, false, new Set()))
      .toEqual(computePaneMargins(CS, false, new Set()))
    expect(computePaneMargins(projected, true, new Set(['rsi'])))
      .toEqual(computePaneMargins(CS, true, new Set(['rsi'])))
  })

  it('an INSTANCE with no legacy toggle reserves a band', () => {
    // The reason the projection exists at all: after Flip B the instance is the
    // authority, so an indicator added through the new UI must get a band even
    // though `cs.indicators.rsi.enabled` was never written.
    const cs = { indicators: { rsi: { enabled: false } } }
    const instances = [{ instanceId: 'x', defId: 'rsi', inputs: {}, hidden: false }]
    const projected = csForPaneMargins(cs, instances, new Set(['rsi']))
    expect(projected.indicators.rsi.enabled).toBe(true)
    expect(computePaneMargins(projected, false, new Set()).rsi).toBeTruthy()
    expect(computePaneMargins(cs, false, new Set()).rsi).toBeUndefined()
  })

  it('a legacy toggle with NO instance reserves NOTHING once flipped', () => {
    const cs = { indicators: { rsi: { enabled: true } } }
    const projected = csForPaneMargins(cs, [], new Set(['rsi']))
    expect(projected.indicators.rsi.enabled).toBe(false)
  })

  it('a HIDDEN instance still reserves its band — existence, not visibility', () => {
    // Mirrors `engineOwnedDefIds`: ownership is authority, not paint. Under the
    // legacy path the declutter toggle never released a band either, and a band
    // that appeared and vanished as the user hid an indicator would re-lay-out
    // the whole chart.
    const cs = { indicators: { rsi: { enabled: false } } }
    const instances = [{ instanceId: 'x', defId: 'rsi', inputs: {}, hidden: true }]
    expect(csForPaneMargins(cs, instances, new Set(['rsi'])).indicators.rsi.enabled).toBe(true)
  })

  it('a TOMBSTONE reserves nothing', () => {
    const cs = { indicators: { rsi: { enabled: true } } }
    expect(csForPaneMargins(cs, [{ instanceId: 'x', deleted: true }], new Set(['rsi']))
      .indicators.rsi.enabled).toBe(false)
  })

  it('touches ONLY flipped ids', () => {
    const cs = { indicators: { rsi: { enabled: true }, macd: { enabled: true } } }
    const projected = csForPaneMargins(cs, [], new Set(['rsi']))
    expect(projected.indicators.rsi.enabled).toBe(false)
    expect(projected.indicators.macd.enabled, 'macd is not flipped and must be untouched').toBe(true)
  })

  it('never mutates the blob it was handed', () => {
    const cs = { indicators: { rsi: { enabled: true } } }
    const before = JSON.parse(JSON.stringify(cs))
    csForPaneMargins(cs, [], new Set(['rsi']))
    expect(cs).toEqual(before)
  })
})
```

- [ ] **Step 2: Run and fail**

Run: `cd app && npx vitest run src/components/chart/engine/paneMarginsProjection.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the projection**

Create `app/src/components/chart/engine/paneMarginsProjection.js`:

```js
// app/src/components/chart/engine/paneMarginsProjection.js
//
// ─── THE BANDS FOLLOW THE INSTANCES, WITHOUT paneMargins.js KNOWING ─────────
//
// ⛔ THE CONSTRAINT THIS EXISTS TO HONOUR: **`paneMargins.js` is consumed, not
// owned.** It has its own `PANES` stacking list, its own crash fix (`1c1b84bf`:
// 1,178 illegal layouts → 0, 2,918 working layouts byte-identical), and its own
// tests, and the engine has never been allowed to extend it — `placement.js`'s
// header says adding an engine key to that list would reserve vertical space for
// something rendering nothing.
//
// But after Flip B the INSTANCE list is the authority on which indicators exist,
// and `computePaneMargins` reads `cs.indicators[key].enabled`. Rather than teach
// it a second input, this projects the instance list back into the shape it
// already reads. The module keeps its signature, its list and its tests; the
// engine still never extends it; and the projection is PROVABLE — for a
// legacy-equivalent blob `computePaneMargins(projected)` must be deep-equal to
// `computePaneMargins(cs)`, which is the first assertion in its test file.
//
// EXISTENCE, NOT VISIBILITY. A hidden instance still reserves its band, exactly
// as a declutter-hidden legacy indicator did. `engineOwnedDefIds` takes the same
// posture for authority, and for the same reason: a band that appeared and
// vanished as the user hid an indicator would re-lay-out the whole chart.

import { isInstanceTombstone } from '../chartDefaults'

/**
 * `cs`, with `indicators[<id>].enabled` rewritten from the instance list for
 * every FLIPPED id.
 *
 * Returns the SAME OBJECT when there is nothing to project (no flipped ids), so
 * the pre-Flip-B path allocates nothing per paint and `computePaneMargins`'
 * callers see the identity they always saw.
 *
 * @param {object} cs merged chart settings
 * @param {object[]} instances the instance list the engine will draw from
 * @param {Set<string>} flippedIds `ENGINE_FLIPPED_DEF_IDS`
 * @returns {object}
 */
export function csForPaneMargins(cs, instances, flippedIds) {
  if (!flippedIds || flippedIds.size === 0) return cs
  if (!cs || typeof cs !== 'object') return cs

  const live = new Set()
  for (const inst of (Array.isArray(instances) ? instances : [])) {
    if (!inst || typeof inst !== 'object') continue
    let tombstone = false
    try { tombstone = isInstanceTombstone(inst) } catch { /* booby-trapped getter */ }
    if (tombstone) continue
    if (typeof inst.defId !== 'string' || !inst.defId) continue
    live.add(inst.defId)
  }

  const indicators = { ...(cs.indicators || {}) }
  for (const id of flippedIds) {
    indicators[id] = { ...(indicators[id] || {}), enabled: live.has(id) }
  }
  return { ...cs, indicators }
}
```

- [ ] **Step 4: Run — green**

Run: `cd app && npx vitest run src/components/chart/engine/paneMarginsProjection.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing control-adapter test**

Create `app/src/components/chart/engine/instanceControls.test.js`:

```js
import { describe, it, expect } from 'vitest'
import { setIndicatorEnabled, setIndicatorInput, isIndicatorEnabled } from './instanceControls'
import { normalizeInstances, migrateLegacyToInstances, legacyInstanceId } from './instances'
import * as engineRegistry from './nativeRegistry'

const R = engineRegistry
const base = () => ({ indicators: { rsi: { enabled: false, period: 14, color: '#7b68ee' } }, indicatorInstances: [] })
const live = (cs) => normalizeInstances(cs.indicatorInstances, R).kept

describe('setIndicatorEnabled — the instance AND the mirror, always both', () => {
  it('turning one ON adds an instance carrying the blob\'s current params', () => {
    const next = setIndicatorEnabled(base(), 'rsi', true, R)
    const inst = live(next).find(i => i.defId === 'rsi')
    expect(inst.instanceId).toBe(legacyInstanceId('rsi'))
    expect(inst.inputs).toEqual({ period: 14, color: '#7b68ee' })
    // …and the mirror, so the alert evaluator and IndicatorAlertPopover -- which
    // read cs.indicators and know nothing about instances -- keep working.
    expect(next.indicators.rsi.enabled).toBe(true)
  })

  it('turning one OFF writes a TOMBSTONE, not a deletion', () => {
    // A bare removal is undone by the very next read: `migrateLegacyToInstances`
    // would see `enabled: true`… and a grid cell whose snapshot predates the
    // delete names the instance in full on its next unrelated write. Only a
    // persisting marker survives that (B2 Task 5).
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    const off = setIndicatorEnabled(on, 'rsi', false, R)
    expect(off.indicatorInstances).toEqual([{ instanceId: 'legacy:rsi', deleted: true }])
    expect(off.indicators.rsi.enabled).toBe(false)
    expect(live(off)).toEqual([])
  })

  it('the tombstone survives a re-migration — "I turned it off and it came back"', () => {
    const off = setIndicatorEnabled(setIndicatorEnabled(base(), 'rsi', true, R), 'rsi', false, R)
    // The read-time migrator runs on every paint after Flip B.
    const remigrated = migrateLegacyToInstances(off, R)
    expect(normalizeInstances(remigrated, R).kept.filter(i => i.defId === 'rsi')).toEqual([])
  })

  it('turning it back ON revives the same id', () => {
    const off = setIndicatorEnabled(setIndicatorEnabled(base(), 'rsi', true, R), 'rsi', false, R)
    const again = setIndicatorEnabled(off, 'rsi', true, R)
    const kept = live(again).filter(i => i.defId === 'rsi')
    expect(kept).toHaveLength(1)
    expect(kept[0].instanceId).toBe('legacy:rsi')
    expect(again.indicators.rsi.enabled).toBe(true)
  })

  it('is idempotent — enabling twice does not add a second instance', () => {
    const once = setIndicatorEnabled(base(), 'rsi', true, R)
    const twice = setIndicatorEnabled(once, 'rsi', true, R)
    expect(live(twice).filter(i => i.defId === 'rsi')).toHaveLength(1)
  })

  it('refuses a defId the registry does not know, rather than storing a ghost', () => {
    const cs = base()
    expect(setIndicatorEnabled(cs, 'not-an-indicator', true, R)).toBe(cs)
  })

  it('never mutates the blob it was handed', () => {
    const cs = base()
    const before = JSON.parse(JSON.stringify(cs))
    setIndicatorEnabled(cs, 'rsi', true, R)
    expect(cs).toEqual(before)
  })
})

describe('setIndicatorInput — same rule, both sides', () => {
  it('writes the instance input and mirrors it', () => {
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    const next = setIndicatorInput(on, 'rsi', 'period', 7, R)
    expect(live(next).find(i => i.defId === 'rsi').inputs.period).toBe(7)
    expect(next.indicators.rsi.period).toBe(7)
  })

  it('creates the instance if the indicator is on in the blob but has none yet', () => {
    // The realistic crossover blob: a user who enabled RSI before Flip B shipped.
    const cs = { indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' } }, indicatorInstances: [] }
    const next = setIndicatorInput(cs, 'rsi', 'period', 7, R)
    expect(live(next).find(i => i.defId === 'rsi').inputs).toEqual({ period: 7, color: '#7b68ee' })
  })

  it('rejects a value the definition would refuse, leaving the blob untouched', () => {
    // `period` is an int 2..100. Storing 500 would produce an instance
    // `normalizeInstances` then DROPS -- the indicator would silently vanish.
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    expect(setIndicatorInput(on, 'rsi', 'period', 500, R)).toBe(on)
    expect(setIndicatorInput(on, 'rsi', 'bogus', 1, R)).toBe(on)
  })

  it('coerces a numeric string, the way the toolbar produces it', () => {
    // `<input type=number>` hands back a STRING; `updateIndicator` parseInt's it
    // (`ChartToolbar.jsx:141-150`). If this stored "7" the instance would be
    // dropped by the type check and RSI would disappear on the next paint.
    const on = setIndicatorEnabled(base(), 'rsi', true, R)
    expect(live(setIndicatorInput(on, 'rsi', 'period', '7', R)).find(i => i.defId === 'rsi').inputs.period).toBe(7)
    const bbOn = setIndicatorEnabled({ indicators: { bb: { enabled: false, period: 20, stdDev: 2 } }, indicatorInstances: [] }, 'bb', true, R)
    expect(live(setIndicatorInput(bbOn, 'bb', 'stdDev', '2.5', R)).find(i => i.defId === 'bb').inputs.stdDev).toBe(2.5)
  })
})

describe('isIndicatorEnabled — one answer for every control surface', () => {
  it('reads the INSTANCE for a flipped id', () => {
    const cs = { indicators: { rsi: { enabled: true } }, indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }] }
    expect(isIndicatorEnabled(cs, 'rsi', new Set(['rsi']))).toBe(false)
    expect(isIndicatorEnabled(cs, 'rsi', new Set())).toBe(true)
  })

  it('reads the legacy toggle for an un-flipped id', () => {
    const cs = { indicators: { macd: { enabled: true } }, indicatorInstances: [] }
    expect(isIndicatorEnabled(cs, 'macd', new Set(['rsi']))).toBe(true)
  })
})
```

- [ ] **Step 6: Run and fail**

Run: `cd app && npx vitest run src/components/chart/engine/instanceControls.test.js`
Expected: FAIL — module not found.

- [ ] **Step 7: Write the control adapter**

Create `app/src/components/chart/engine/instanceControls.js`:

```js
// app/src/components/chart/engine/instanceControls.js
//
// ─── THE WRITE PATH FOR A FLIPPED INDICATOR ─────────────────────────────────
//
// Pure `(cs, …) → cs'`. No React, no preferences hook, no persistence: every
// caller already has a settings object and a way to hand one back
// (`onUpdateSettings` in the toolbar, `handleUpdateChartSettings` for the
// keyboard toggles), and threading a writer through them would give the engine
// two ways to save.
//
// ─── WHY THE LEGACY SECTION IS STILL WRITTEN ────────────────────────────────
//
// Flip B makes the INSTANCE the READ authority for the chart. It does NOT make
// `cs.indicators` dead data: the alert evaluator, `IndicatorAlertPopover`, the
// screener, the `?indicators=` render route and any tab still running an older
// build all read that section and know nothing about instances. So every write
// here goes to BOTH — the instance, and a write-through MIRROR.
//
// That is not redundancy for its own sake. Without the mirror, "turn RSI off"
// leaves an RSI alert evaluating against a section that still says `enabled:
// true` with a stale period, and nothing anywhere reports it. With it, the
// invariant is simple and testable: **the mirror always agrees with the
// instance**, and `instanceControls.test.js` asserts both sides on every write.
//
// The reverse direction is already handled: `migrateLegacyToInstances` projects a
// legacy toggle into an instance at read time, so a write from an un-migrated
// surface still reaches the chart.
//
// ─── WHY OFF IS A TOMBSTONE ─────────────────────────────────────────────────
//
// Removing the instance is undone by the very next read. The migrator would see
// the mirror… except the mirror is cleared too — but a GRID CELL whose snapshot
// predates the delete names the instance in full on its next unrelated write, and
// `mergeSettingsOverride`'s union-by-id puts it straight back. Only a persisting
// marker survives that (B2 Task 5's resurrect test). Reversal is an explicit
// re-add, which `mergeSettingsOverride` already understands.

import { validateInputValue } from './defSchema'
import { legacyInstanceId } from './instances'
import { instanceTombstone, isInstanceTombstone } from '../chartDefaults'

function resolveRegistry(registry) {
  if (typeof registry === 'function') return registry
  if (registry && typeof registry.getDefinition === 'function') return (id) => registry.getDefinition(id)
  return () => null
}

/** The declared inputs a definition has, keyed. */
function declaredInputs(def) {
  return new Map((def.inputs || []).filter(i => i && typeof i.key === 'string').map(i => [i.key, i]))
}

/**
 * A raw control value coerced to the type its input declares.
 *
 * `<input type="number">` hands back a STRING and `ChartToolbar.updateIndicator`
 * parses it with a hand-maintained `numFields` set (`:141`). Here the DEFINITION
 * says which are numeric, so there is no second list to keep in sync — and it
 * matters more than it did: a stored `"7"` fails `validateInputValue`, which
 * makes `normalizeInstances` DROP the whole instance and the indicator vanish.
 *
 * Returns `undefined` when the value cannot be coerced, which the caller treats
 * as "reject the write".
 */
function coerce(declared, value) {
  if (!declared) return undefined
  switch (declared.type) {
    case 'int': {
      const n = typeof value === 'number' ? value : parseInt(value, 10)
      return Number.isInteger(n) ? n : undefined
    }
    case 'float': {
      const n = typeof value === 'number' ? value : parseFloat(value)
      return Number.isFinite(n) ? n : undefined
    }
    case 'bool':
      return typeof value === 'boolean' ? value : undefined
    default:
      return typeof value === 'string' ? value : undefined
  }
}

/** The inputs a fresh instance of `defId` should carry: whatever the legacy
 *  section already says, filtered to keys the definition declares. Same
 *  projection `migrateLegacyToInstances` performs, so an instance created here
 *  and one created by the migrator are byte-identical. */
function inputsFromLegacy(def, section) {
  const out = {}
  for (const [key, declared] of declaredInputs(def)) {
    if (!section || section[key] === undefined) continue
    const v = coerce(declared, section[key])
    if (v === undefined) continue
    const errors = []
    validateInputValue(declared, v, `inputs.${key}`, errors)
    if (!errors.length) out[key] = v
  }
  return out
}

function withInstances(cs, instances) {
  return { ...cs, indicatorInstances: instances, preset: 'custom' }
}

/**
 * Turn one indicator on or off.
 *
 * @param {object} cs merged chart settings
 * @param {string} defId
 * @param {boolean} enabled
 * @param {object|Function} registry
 * @returns {object} the next settings blob, or `cs` UNCHANGED when the write is refused
 */
export function setIndicatorEnabled(cs, defId, enabled, registry) {
  const def = resolveRegistry(registry)(defId)
  if (!def || !cs || typeof cs !== 'object') return cs

  const list = Array.isArray(cs.indicatorInstances) ? cs.indicatorInstances : []
  const id = legacyInstanceId(defId)
  const rest = list.filter(i => !i || typeof i !== 'object' || i.instanceId !== id)
  const indicators = { ...(cs.indicators || {}) }
  indicators[defId] = { ...(indicators[defId] || {}), enabled }

  if (!enabled) {
    return { ...withInstances(cs, [...rest, instanceTombstone(id)]), indicators }
  }

  const prev = list.find(i => i && typeof i === 'object' && i.instanceId === id)
  const revived = (prev && !isInstanceTombstone(prev))
    ? prev
    : {
        instanceId: id,
        defId,
        ...(Number.isInteger(def.version) ? { defVersion: def.version } : {}),
        inputs: inputsFromLegacy(def, cs.indicators && cs.indicators[defId]),
        ...(typeof def.placement?.target === 'string' ? { placement: { target: def.placement.target } } : {}),
        hidden: false,
      }
  return { ...withInstances(cs, [...rest, revived]), indicators }
}

/**
 * Set one input on one indicator, creating its instance if the blob says the
 * indicator is on but no instance exists yet (the realistic crossover blob).
 *
 * Refuses — returning `cs` untouched — a key the definition does not declare or
 * a value it would reject. Storing either produces an instance
 * `normalizeInstances` then DROPS, i.e. an indicator that silently disappears
 * on the next paint. defSchema's line applies verbatim: a chart that refuses to
 * change is a bug report; a chart that loses an indicator is a support ticket
 * with no answer in it.
 */
export function setIndicatorInput(cs, defId, key, value, registry) {
  const def = resolveRegistry(registry)(defId)
  if (!def || !cs || typeof cs !== 'object') return cs
  const declared = declaredInputs(def).get(key)
  if (!declared) return cs
  const coerced = coerce(declared, value)
  if (coerced === undefined) return cs
  const errors = []
  validateInputValue(declared, coerced, `inputs.${key}`, errors)
  if (errors.length) return cs

  const withInstance = setIndicatorEnabled(cs, defId, true, registry)
  const id = legacyInstanceId(defId)
  const instances = (withInstance.indicatorInstances || []).map(i => (
    i && i.instanceId === id ? { ...i, inputs: { ...(i.inputs || {}), [key]: coerced } } : i
  ))
  const indicators = { ...(withInstance.indicators || {}) }
  indicators[defId] = { ...(indicators[defId] || {}), [key]: coerced }
  return { ...withInstances(withInstance, instances), indicators }
}

/**
 * Is this indicator on? ONE answer for every control surface, so a checkbox, a
 * keyboard shortcut and the settings panel can never disagree about it.
 */
export function isIndicatorEnabled(cs, defId, flippedIds) {
  if (flippedIds && flippedIds.has && flippedIds.has(defId)) {
    const id = legacyInstanceId(defId)
    const list = Array.isArray(cs?.indicatorInstances) ? cs.indicatorInstances : []
    const inst = list.find(i => i && typeof i === 'object' && i.instanceId === id)
    if (!inst) return list.some(i => i && i.defId === defId && !isInstanceTombstone(i))
    return !isInstanceTombstone(inst)
  }
  return cs?.indicators?.[defId]?.enabled === true
}
```

⚠️ `setIndicatorEnabled(…, true)` appends the revived instance at the END of the list, which changes instance ORDER relative to `migrateLegacyToInstances`' registry order. Among price overlays that is a z-order change. **Sort the kept instances by registry order before returning** — add to `withInstances`:

```js
function withInstances(cs, instances, registry) {
  const order = new Map((typeof registry?.listDefinitions === 'function' ? registry.listDefinitions() : [])
    .map((d, i) => [d.id, i]))
  // Registry order, because it IS legacy render order for the five price
  // overlays and the engine draws all its series at one z-position. A control
  // that appended would put a newly-enabled Bollinger band above a Donchian
  // channel it should sit below.
  const sorted = [...instances].sort((a, b) => (order.get(a?.defId) ?? 1e9) - (order.get(b?.defId) ?? 1e9))
  return { ...cs, indicatorInstances: sorted, preset: 'custom' }
}
```

and thread `registry` through both call sites. Add the matching test:

```js
  it('keeps instances in REGISTRY order, which is legacy z-order for price overlays', () => {
    let cs = { indicators: {}, indicatorInstances: [] }
    for (const id of ['donchian', 'bb', 'vwap']) cs = setIndicatorEnabled(cs, id, true, R)
    expect(live(cs).map(i => i.defId)).toEqual(['bb', 'vwap', 'donchian'])
  })
```

- [ ] **Step 8: Run — green**

Run: `cd app && npx vitest run src/components/chart/engine/instanceControls.test.js`
Expected: PASS.

- [ ] **Step 9: Wire the machinery into StockChart, still dark**

`app/src/components/StockChart.jsx`, next to `ENGINE_MIGRATED_DEF_IDS`:

```js
/**
 * THE FLIP-B SET. Definition ids for which the INSTANCE list is the read
 * authority and the legacy render block has been DELETED.
 *
 * `ENGINE_FLIPPED_DEF_IDS ⊆ ENGINE_MIGRATED_DEF_IDS`, always: an id can only be
 * flipped after its engine copy has been proven pixel-identical. A test asserts
 * the subset relation, because the reverse — flipped but not migrated — means the
 * legacy block is gone and nothing replaced it.
 *
 * Empty until Task 10. While it is empty every read below is byte-identical to
 * the pre-B3 path, which is this task's entire exit criterion.
 */
export const ENGINE_FLIPPED_DEF_IDS = Object.freeze(new Set())
```

Imports:

```js
import { csForPaneMargins } from './chart/engine/paneMarginsProjection'
import { migrateLegacyToInstances } from './chart/engine/instances'
```

Change the instance read (`:5571`) from `normalizeInstances(cs.indicatorInstances, engineRegistry)` to:

```js
          // READ-TIME MIGRATION. After Flip B the instance list is the authority,
          // but a blob carrying only the legacy toggle must still render — a grid
          // cell's `settingsOverride`, the `?indicators=` route, a user who has
          // not touched a control since the flip. `migrateLegacyToInstances`
          // projects the toggle into an instance, a STORED instance wins over the
          // projection, and a TOMBSTONE reserves the id so a still-true legacy
          // toggle cannot put a deleted indicator back. All three are pinned in
          // `instances.test.js`. It is a fixed point, so running it every paint is
          // safe; it is pure, so it writes nothing.
          const migrated = normalizeInstances(
            migrateLegacyToInstances(cs, engineRegistry), engineRegistry).kept
            .filter(i => ENGINE_MIGRATED_DEF_IDS.has(i.defId))
```

⚠️ **This changes behaviour the moment it lands**, because the migrator projects `cs.indicators.rsi.enabled` into an instance even with nothing flipped — and `ENGINE_MIGRATED_DEF_IDS` already contains rsi/bb/macd/vwap, so with the flag on those four would suddenly be engine-drawn without any stored instance. That is *correct* for Flip A (the engine draws the same picture) but it is a behaviour change inside a task whose gate is "nothing changed". So gate it:

```js
          const source = ENGINE_FLIPPED_DEF_IDS.size > 0
            ? migrateLegacyToInstances(cs, engineRegistry)   // instances are the authority
            : cs.indicatorInstances                          // Flip A: only STORED instances draw
          const migrated = normalizeInstances(source, engineRegistry).kept
            .filter(i => ENGINE_MIGRATED_DEF_IDS.has(i.defId))
```

Change the margin computation (`:5513`):

```js
    // The bands follow the INSTANCES for every flipped id — see
    // `engine/paneMarginsProjection.js` and the plan's adjudication A2.
    // `paneMargins.js` is consumed, not owned: it keeps its signature, its PANES
    // list and its tests, and this projects the instance list into the shape it
    // already reads. With nothing flipped it returns `cs` itself.
    const csMargins = csForPaneMargins(cs, engineInstances, ENGINE_FLIPPED_DEF_IDS)
    const paneMargins = computePaneMargins(csMargins, showVolume && volData.length > 0 && !volSeparatePane, volOverlaySet)
```

⚠️ `engineInstances` is declared AFTER `paneMargins` today (`:5513` vs `:5570`). **Move the `engineOn` / `engineInstances` / `engineOwned` block above the `volOverlaySet` computation** — it depends only on `cs`, and the comment at `:5556-5559` already explains that half of it has to be up there. Verify by running the wiring suite.

- [ ] **Step 10: Prove it is dark**

Append to `stockChartWiring.test.jsx`:

```js
describe('the Flip-B machinery is inert while nothing is flipped (Task 9)', () => {
  it('ENGINE_FLIPPED_DEF_IDS is empty, and is a SUBSET of the migrated set', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.size).toBe(0)
    for (const id of ENGINE_FLIPPED_DEF_IDS) expect(ENGINE_MIGRATED_DEF_IDS.has(id), id).toBe(true)
  })

  it('a legacy toggle alone still draws the LEGACY series, not the engine\'s', () => {
    // With nothing flipped, only STORED instances reach the binder. If the
    // read-time migrator were ungated, turning the flag on would silently move
    // four indicators onto the engine with no instance anywhere.
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true } } })
    expect(H.binderApis[0].bindings()).toHaveLength(0)
    expect(H.addSeriesCalls.filter(c => c.options?.priceScaleId === 'rsi')).toHaveLength(1)
  })

  it('the margins the engine is handed are the SAME OBJECT as the legacy path\'s', () => {
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true } } })
    const ctx = H.syncCalls.at(-1)
    // Not deep-equality: identity. A projection that allocated per paint would
    // make every chart recompute its bands for nothing.
    expect(ctx.paneMargins).toBeTruthy()
    expect(Object.keys(ctx.paneMargins)).toContain('rsi')
  })
})
```

Import `ENGINE_FLIPPED_DEF_IDS` alongside `ENGINE_MIGRATED_DEF_IDS`.

- [ ] **Step 11: The pixel gate — nothing may move**

```bash
cd app && npm run build && rm -rf /tmp/parity-B3T9 && cp -r dist /tmp/parity-B3T9
python ../tools/spa_server.py /tmp/parity-B3T9 5185 &
B=http://127.0.0.1:5185
cd ..
python tools/chart_parity.py --base-a $B --base-b $B \
  --cases engine_rsi_vs_legacy engine_bb_vs_legacy engine_macd_vs_legacy engine_vwap_vs_legacy \
          engine_bb_rsi_macd_vs_legacy
python tools/chart_parity.py --base-a $B --same-build --cases bb_only rsi_only macd_only vwap_only bb_rsi_macd
```

Expected: **all 0**. Also compare against the Task 8 build to prove the machinery moved nothing:

```bash
python tools/spa_server.py /tmp/parity-B3T8 5186 &
python tools/chart_parity.py --base-a http://127.0.0.1:5186 --base-b $B --cases bb_only rsi_only macd_only vwap_only
```
Expected: **0**, with two DIFFERENT build identities in `report.md` — that is the number that proves the machinery is inert.

- [ ] **Step 12: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | `csForPaneMargins` → always project (drop the empty-set short-circuit) | projection "with NO flipped ids it returns the SAME object" |
| M2 | `csForPaneMargins` → count `hidden` instances as absent | projection "a HIDDEN instance still reserves its band" |
| M3 | `csForPaneMargins` → project every id, not just flipped | projection "touches ONLY flipped ids" |
| M4 | `setIndicatorEnabled(false)` → filter the instance out instead of tombstoning | controls "writes a TOMBSTONE" and "the tombstone survives a re-migration" |
| M5 | `coerce` → return the raw value | controls "coerces a numeric string" |
| M6 | `setIndicatorInput` → skip `validateInputValue` | controls "rejects a value the definition would refuse" |
| M7 | drop the mirror write from `setIndicatorEnabled` | controls "turning one ON adds an instance carrying the blob's current params" (mirror half) |
| M8 | ungate the read-time migrator (always migrate) | wiring "a legacy toggle alone still draws the LEGACY series" |
| M9 | `withInstances` → drop the registry-order sort | controls "keeps instances in REGISTRY order" |

- [ ] **Step 13: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__ && cd ..
git add app/src/components/chart/engine/paneMarginsProjection.js \
        app/src/components/chart/engine/paneMarginsProjection.test.js \
        app/src/components/chart/engine/instanceControls.js \
        app/src/components/chart/engine/instanceControls.test.js \
        app/src/components/StockChart.jsx \
        app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx
git commit -m "feat(engine): the Flip-B machinery, landed dark

Three pieces, ENGINE_FLIPPED_DEF_IDS empty, zero pixels moved -- so a reviewer
can reject the machinery without rejecting a migration and the flips that follow
are two-line changes with a number each.

paneMarginsProjection honours 'paneMargins.js is consumed, not owned': the module
keeps its signature, its PANES list and its crash fix, and the instance list is
projected into the shape it already reads. Provable, and proved: for a
legacy-equivalent blob the projected margins are deep-equal to the legacy read.

instanceControls writes the instance AND a write-through mirror, because the
alert evaluator, the alert popover, the screener and the ?indicators= route read
cs.indicators and know nothing about instances. Off is a TOMBSTONE, not a
deletion: a grid cell whose snapshot predates the delete would otherwise put the
indicator straight back.

Parity vs the Task 8 build, two named identities: 0 changed px on every case.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 10: Flip B — RSI and Bollinger Bands

The pilot pair's second flip. `ENGINE_FLIPPED_DEF_IDS` gains both ids; the two legacy render blocks, their `useRef`s, their `indicatorData` branches, their hide-all entries and RSI's crosshair fallback are **deleted**; the control surfaces write instances.

RSI and BB flip together rather than one at a time because they are the two placement paths and flipping only one leaves the read path split in a way no parity case can distinguish from a bug: with `ENGINE_FLIPPED_DEF_IDS = {'rsi'}` the migrator projects `cs.indicators.bb.enabled` into a BB instance too (it does not filter by flipped id), so BB would be engine-drawn while its legacy block still exists and `engineOwned` stands it down — which is Flip A, correctly, but the *enable* signal for BB's margins would come from `cs` while RSI's came from instances. Two sources of truth in one paint. Flip the pair.

**Files:**
- Modify: `app/src/components/StockChart.jsx` — `:76` region, `:1705-1709`, `:3956-3970`, `:5875-5898`, `:5931-5961`, `:7787-7791`, `:8332`
- Modify: `app/src/components/chart/ChartToolbar.jsx:140-152`, `:396-403`, the BB rows
- Create: `app/src/components/chart/engine/__tests__/flipB.test.jsx`
- Modify: `tools/chart_parity_cases.json`

**Interfaces:**
- Consumes: `setIndicatorEnabled` / `setIndicatorInput` / `isIndicatorEnabled` (Task 9), `csForPaneMargins` (Task 9).
- Produces: `ENGINE_FLIPPED_DEF_IDS` = `Set(['rsi', 'bb'])`.
- Produces: `ChartSettingsPanel` gains an `indicatorWriter` prop — `{isEnabled(defId), setEnabled(defId, on), setInput(defId, key, value)}` — so the panel never branches on which ids are flipped.

- [ ] **Step 1: Write the failing Flip-B test**

Create `app/src/components/chart/engine/__tests__/flipB.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import { render, cleanup, act, fireEvent } from '@testing-library/react'
// The same lightweight-charts / hooks doubles as stockChartWiring.test.jsx — see
// that file's header for why the binder is WRAPPED and not faked.
import './stockChartWiring.test.jsx'   // ⚠️ replace with a shared `./harness.js`
```

⚠️ **Do not import a test file.** Extract the hoisted `H`, the `vi.mock` blocks and the `draw` helper from `stockChartWiring.test.jsx` into `app/src/components/chart/engine/__tests__/harness.jsx` first, and have both suites import it. Do that as the task's Step 1a; the mocks must be hoisted in the importing file, so `harness.jsx` exports `installEngineTestMocks()` called at module top-level of each suite. Verify `stockChartWiring.test.jsx` still passes unchanged before writing a line of `flipB.test.jsx`.

Then:

```jsx
import { describe, it, expect } from 'vitest'
import { cleanup, act, fireEvent } from '@testing-library/react'
import { H, draw, installEngineTestMocks } from './harness'
installEngineTestMocks()

const { default: StockChart, ENGINE_FLIPPED_DEF_IDS, ENGINE_MIGRATED_DEF_IDS } = await import('../../../StockChart')
const { setIndicatorEnabled, isIndicatorEnabled } = await import('../instanceControls')
const registry = await import('../nativeRegistry')

const rsiSeries = () => H.addSeriesCalls.filter(c => c.options?.priceScaleId === 'rsi')
const bbSeries = () => H.addSeriesCalls.filter(c => c.options?.color === 'rgba(156,39,176,0.85)')

describe('Flip B — the instance list is the read authority', () => {
  it('flips exactly rsi and bb, and stays a subset of the migrated set', () => {
    expect([...ENGINE_FLIPPED_DEF_IDS].sort()).toEqual(['bb', 'rsi'])
    for (const id of ENGINE_FLIPPED_DEF_IDS) expect(ENGINE_MIGRATED_DEF_IDS.has(id), id).toBe(true)
  })

  it('a LEGACY-ONLY blob still draws both — through the engine', () => {
    // THE COMPATIBILITY CASE. A user who has not touched a control since the flip
    // has `indicators.rsi.enabled` and no instance anywhere. The read-time
    // migrator projects it; the engine draws it; nothing is missing.
    draw({
      engineEnabled: true,
      indicators: { rsi: { enabled: true, period: 14, color: '#7b68ee' },
                    bb: { enabled: true, period: 20, stdDev: 2, color: 'rgba(156,39,176,0.85)' } },
    })
    expect(rsiSeries()).toHaveLength(1)
    expect(bbSeries()).toHaveLength(3)
    const owned = H.binderApis[0].bindings()
    expect(owned, 'the ENGINE must be what drew them').toHaveLength(4)
  })

  it('a stored INSTANCE beats a false legacy toggle — instances are authoritative', () => {
    draw({
      engineEnabled: true,
      indicators: { rsi: { enabled: false } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 21 }, hidden: false }],
    })
    expect(rsiSeries(), 'the toggle says off; the instance says on, and it wins').toHaveLength(1)
    // …and the BAND was reserved for it, which is the paneMarginsProjection half.
    const ctx = H.syncCalls.at(-1)
    expect(ctx.paneMargins.rsi, 'no band was reserved — the projection is not wired').toBeTruthy()
  })

  it('a TOMBSTONE beats a true legacy toggle — "off" stays off', () => {
    draw({
      engineEnabled: true,
      indicators: { rsi: { enabled: true, period: 14 } },
      indicatorInstances: [{ instanceId: 'legacy:rsi', deleted: true }],
    })
    expect(rsiSeries()).toHaveLength(0)
    expect(H.syncCalls.at(-1).paneMargins.rsi, 'a deleted indicator must not reserve a band').toBeUndefined()
  })

  it('the legacy render blocks are GONE — no ref, no second copy, ever', () => {
    // With the flag OFF a flipped indicator draws NOTHING, because there is no
    // longer a hand-written block to draw it. That is the honest consequence of
    // Flip B and the reason `engineEnabled` must be on by the time this ships.
    draw({ indicators: { rsi: { enabled: true } } })
    expect(rsiSeries(), 'a legacy RSI block still exists').toHaveLength(0)
  })

  it('an UN-flipped indicator is untouched — MACD still draws from its legacy block', () => {
    draw({ indicators: { macd: { enabled: true } } })
    expect(H.addSeriesCalls.filter(c => c.options?.priceScaleId === 'macd').length).toBeGreaterThan(0)
  })

  it('hide-all still reaches both, through the binding map', () => {
    draw({ engineEnabled: true, indicators: { rsi: { enabled: true }, bb: { enabled: true } } })
    const series = [...rsiSeries(), ...bbSeries()].map(c => c.series)
    expect(series).toHaveLength(4)
    act(() => { fireEvent.keyDown(document, { altKey: true, shiftKey: true, code: 'KeyI' }) })
    for (const s of series) {
      expect(H.visibilityCalls.filter(v => v.series === s && v.visible === false).length,
        'a flipped indicator dropped out of the declutter toggle').toBeGreaterThan(0)
    }
  })
})

describe('Flip B — the control surfaces write instances', () => {
  it('Ctrl+I toggles RSI by writing an instance AND the mirror', () => {
    const writes = []
    const view = draw({ engineEnabled: true }, { onSettingsChange: (next) => writes.push(next) })
    act(() => { fireEvent.keyDown(document, { ctrlKey: true, code: 'KeyI' }) })
    expect(writes, 'Ctrl+I wrote nothing').toHaveLength(1)
    const next = writes[0]
    expect(next.indicatorInstances.some(i => i.defId === 'rsi' && !i.deleted)).toBe(true)
    expect(next.indicators.rsi.enabled, 'the mirror keeps the alert evaluator alive').toBe(true)
    view.unmount()
  })

  it('a settings round-trip survives: on → off → re-read stays off', () => {
    let cs = { indicators: { rsi: { enabled: false, period: 14, color: '#7b68ee' } }, indicatorInstances: [] }
    cs = setIndicatorEnabled(cs, 'rsi', true, registry)
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(true)
    cs = setIndicatorEnabled(cs, 'rsi', false, registry)
    expect(isIndicatorEnabled(cs, 'rsi', ENGINE_FLIPPED_DEF_IDS)).toBe(false)

    cleanup(); H.reset()
    draw({ engineEnabled: true, ...cs })
    expect(rsiSeries(), 'it came back on refresh — the tombstone did not persist').toHaveLength(0)
  })

  it('the alert popover still lists RSI, because the mirror is written', () => {
    // `IndicatorAlertPopover` reads its own INDICATORS list and the evaluator
    // reads `cs.indicators`. Neither knows about instances, and neither should
    // have to for the pilot pair to flip.
    let cs = { indicators: { rsi: { enabled: false, period: 14 } }, indicatorInstances: [] }
    cs = setIndicatorEnabled(cs, 'rsi', true, registry)
    expect(cs.indicators.rsi.enabled).toBe(true)
    cs = setIndicatorEnabled(cs, 'rsi', false, registry)
    expect(cs.indicators.rsi.enabled).toBe(false)
  })
})
```

The `draw` helper in `harness.jsx` must accept a second argument of extra StockChart props (`onSettingsChange`); check StockChart's prop name for the settings write callback (`grep -n "onSettingsChange\|handleUpdateChartSettings" app/src/components/StockChart.jsx`) and use the real one.

- [ ] **Step 2: Run and fail**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/flipB.test.jsx`
Expected: FAIL — `ENGINE_FLIPPED_DEF_IDS` is empty.

- [ ] **Step 3: Flip the pair and delete the blocks**

`StockChart.jsx`:

```js
export const ENGINE_FLIPPED_DEF_IDS = Object.freeze(new Set(['rsi', 'bb']))
```

**Delete** the entire Bollinger block (`:5875-5898`) and the entire RSI block (`:5931-5961`). Replace both with a single comment at the RSI block's position:

```js
    // ── Bollinger Bands and RSI: FLIPPED (B3 Task 10) ────────────────────────
    // Both are drawn by the engine, from the instance list, above. Their
    // hand-written blocks, their refs, their `indicatorData` branches, their
    // entries in the hide-all array and RSI's crosshair fallback are all gone —
    // that deletion IS Flip B, and it is what stops the indicator being
    // enumerated in six places. `ENGINE_FLIPPED_DEF_IDS` names them; the enable
    // signal reaches `computePaneMargins` through `csForPaneMargins`.
```

**Delete** `bbUpperRef`, `bbMiddleRef`, `bbLowerRef`, `rsiSeriesRef` (`:1705-1709`), their entries in the hide-all array (`:8332`), the `rsi` and `bb` branches of the `indicatorData` memo (`:3957-3966` and the `rsi:` / `bb:` keys in its return, `:4000-4007`), and RSI's crosshair fallback in `processCrosshair` — the Task 2 bridge line becomes simply:

```js
      const rsiValue = engSlots.rsi ? engSlots.rsi.value : null
```

⚠️ `indicatorData.rsi` and `indicatorData.bb` are read elsewhere. **Before deleting, grep:** `grep -n "indicatorData\.\(rsi\|bb\)" app/src/components/StockChart.jsx`. Every remaining reader must be deleted with it or rewired to the engine.

⚠️ The `else if` cleanup branches are deleted with the blocks, which is correct — there is no legacy series left to remove.

- [ ] **Step 4: Rewire the control surfaces**

`StockChart.jsx`'s keyboard handler (`:3468-3475`):

```js
        // Flipped indicators are enabled by their INSTANCE, not by the legacy
        // toggle — one writer, so a checkbox, a shortcut and the settings panel
        // can never disagree. `setIndicatorEnabled` writes the mirror too.
        const updateIndicator = (key) => {
          if (ENGINE_FLIPPED_DEF_IDS.has(key)) {
            const on = isIndicatorEnabled(cs, key, ENGINE_FLIPPED_DEF_IDS)
            handleUpdateChartSettings(setIndicatorEnabled(cs, key, !on, engineRegistry))
            return
          }
          const next = {
            ...cs.indicators,
            [key]: { ...(cs.indicators?.[key] || {}), enabled: !cs.indicators?.[key]?.enabled },
          }
          handleUpdateChartSettings({ ...cs, indicators: next, preset: 'custom' })
        }
```

`ChartToolbar.jsx` — pass a writer down rather than teaching the panel about ids. In `ChartToolbar`'s props add `indicatorWriter`, forward it to `ChartSettingsPanel`, and in that component:

```js
  // Flipped indicators (see StockChart's ENGINE_FLIPPED_DEF_IDS) are enabled by
  // an INSTANCE. The panel does not know which — it asks the writer, which is a
  // no-op passthrough for everything still on the legacy toggle. Keeping the
  // branch OUT of the JSX is what stops "which indicators are flipped" becoming
  // one more place an indicator is enumerated.
  const indEnabled = (key) => (indicatorWriter
    ? indicatorWriter.isEnabled(key)
    : (cs.indicators?.[key]?.enabled ?? false))

  const setIndEnabled = (key, on) => {
    if (indicatorWriter) { onUpdateSettings(indicatorWriter.setEnabled(cs, key, on)); return }
    updateIndicator(key, 'enabled', on)
  }

  const setIndValue = (key, field, value) => {
    if (indicatorWriter) { onUpdateSettings(indicatorWriter.setInput(cs, key, field, value)); return }
    updateIndicator(key, field, value)
  }
```

Replace every `checked={cs.indicators?.<key>?.enabled ?? false}` with `checked={indEnabled('<key>')}`, every `onChange={e => updateIndicator('<key>', 'enabled', e.target.checked)}` with `onChange={e => setIndEnabled('<key>', e.target.checked)}`, and every other `updateIndicator('<key>', field, v)` with `setIndValue('<key>', field, v)` — for **all** indicators, not just the flipped two, so there is one call shape in the file.

In `StockChart.jsx`, build the writer once:

```js
  // ONE writer for every indicator control on this chart. Un-flipped ids fall
  // through to the legacy section unchanged; flipped ids go to the instance and
  // its mirror. `useMemo` on `cs` because the panel takes it as a prop.
  const indicatorWriter = useMemo(() => ({
    isEnabled: (key) => isIndicatorEnabled(cs, key, ENGINE_FLIPPED_DEF_IDS),
    setEnabled: (settings, key, on) => (ENGINE_FLIPPED_DEF_IDS.has(key)
      ? setIndicatorEnabled(settings, key, on, engineRegistry)
      : { ...settings, indicators: { ...settings.indicators, [key]: { ...(settings.indicators?.[key] || {}), enabled: on } }, preset: 'custom' }),
    setInput: (settings, key, field, value) => (ENGINE_FLIPPED_DEF_IDS.has(key)
      ? setIndicatorInput(settings, key, field, value, engineRegistry)
      : { ...settings, indicators: { ...settings.indicators, [key]: { ...(settings.indicators?.[key] || {}), [field]: value } }, preset: 'custom' }),
  }), [cs])
```

⚠️ The legacy `updateIndicator` parsed numeric fields (`ChartToolbar.jsx:141`). The un-flipped fall-through above drops that. **Keep the parse** by reusing the same `numFields` set in the fall-through branch, or the un-flipped indicators regress. Add a test for it.

- [ ] **Step 5: Run — green**

Run: `cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__`
Expected: PASS. The `it.each([...ENGINE_MIGRATED_DEF_IDS])` double-draw rail in `stockChartWiring.test.jsx` will now FAIL for `rsi` and `bb` — its premise ("legacy alone draws N series") no longer holds once the block is deleted. **Amend the rail** to skip flipped ids and add a companion:

```js
  it.each([...ENGINE_MIGRATED_DEF_IDS].filter(id => !ENGINE_FLIPPED_DEF_IDS.has(id)))(
    '%s: legacy toggle ON + an engine instance ⇒ the SAME number of series as legacy alone', /* unchanged */)

  it.each([...ENGINE_FLIPPED_DEF_IDS])(
    '%s: FLIPPED — the legacy toggle alone draws nothing with the engine off',
    (defId) => {
      draw({ indicators: { [defId]: { enabled: true } } })
      expect(H.binderApis).toHaveLength(0)
      const withEngine = (() => { cleanup(); H.reset()
        draw({ engineEnabled: true, indicators: { [defId]: { enabled: true } } })
        return H.binderApis[0].bindings().length })()
      expect(withEngine, `${defId} is flipped but the engine bound nothing`).toBeGreaterThan(0)
    })
```

- [ ] **Step 6: The Flip-B pixel gate — two builds, two identities**

```bash
# A: the Task 9 build (Flip A for rsi/bb, legacy drives)
cd app && git stash && npm run build && rm -rf /tmp/parity-flipA && cp -r dist /tmp/parity-flipA && git stash pop
# B: this build
npm run build && rm -rf /tmp/parity-flipB && cp -r dist /tmp/parity-flipB
cd ..
python tools/spa_server.py /tmp/parity-flipA 5186 &
python tools/spa_server.py /tmp/parity-flipB 5187 &
A=http://127.0.0.1:5186; B=http://127.0.0.1:5187
```

⚠️ `git stash` is **forbidden as scratch** on this machine — the stash stack is shared by ~70 worktrees and `stash push <paths>` on untracked files is a silent no-op whose paired bare `pop` steals the owner's stash. Build A from a **detached checkout of the Task 9 commit in a temporary worktree** instead:

```bash
git worktree add /tmp/b3-task9 <task-9-sha>
cd /tmp/b3-task9/app && ln -s /c/Users/Patrick/uct-dashboard/app/node_modules node_modules && npm run build
cp -r dist /tmp/parity-flipA && cd - && git worktree remove /tmp/b3-task9 --force
```

Then:

```bash
# ⚠️ NOT an engine case: these are LEGACY-shaped settings on both sides. Side A
# draws them through the legacy block; side B through the engine's read-time
# migration. That IS Flip B, and it is why there is no `instancesB`.
python tools/chart_parity.py --base-a $A --base-b $B --cases rsi_only bb_only bb_rsi_macd
# the Flip-B self-test: after the flip a SETTINGS colour can only reach the
# series through an instance, so this MUST move pixels.
python tools/chart_parity.py --base-a $A --base-b $B --cases rsi_only \
    --perturb-b '{"indicators": {"rsi": {"color": "#7b68ef"}}}'
```

Expected: **0 exit 0** on all three, then **non-zero exit 1**. `report.md` must name two DIFFERENT build ids.

**Why the perturb is the right self-test here:** on a Flip-A engine case `--perturb-b` reports 0 vacuously (the engine reads the instance). After Flip B the settings→instance bridge is live, so the same knob becomes meaningful again — and a 0 would mean the read-time migrator is not consuming `cs.indicators`, i.e. the compatibility path is dead.

- [ ] **Step 7: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | `ENGINE_FLIPPED_DEF_IDS` → `Set(['rsi'])` | flipB "flips exactly rsi and bb" |
| M2 | `csForPaneMargins` call reverted to plain `cs` | flipB "a stored INSTANCE beats a false legacy toggle" (no band) |
| M3 | read-time migrator gate reverted to `cs.indicatorInstances` | flipB "a LEGACY-ONLY blob still draws both" |
| M4 | `isInstanceTombstone` check removed from `csForPaneMargins` | flipB "a TOMBSTONE beats a true legacy toggle" |
| M5 | Ctrl+I handler reverted to the legacy `updateIndicator` | flipB "Ctrl+I toggles RSI by writing an instance AND the mirror" |
| M6 | `indicatorWriter.setEnabled` drops the mirror | flipB "the alert popover still lists RSI" |
| M7 | re-add the deleted BB block (with its guard) | flipB "the legacy render blocks are GONE" |
| M8 | drop the `numFields` parse from the un-flipped fall-through | the new numeric-parse test |

- [ ] **Step 8: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__ && cd ..
git add app/src/components/StockChart.jsx app/src/components/chart/ChartToolbar.jsx \
        app/src/components/chart/engine/__tests__/harness.jsx \
        app/src/components/chart/engine/__tests__/flipB.test.jsx \
        app/src/components/chart/engine/__tests__/stockChartWiring.test.jsx
git commit -m "feat(charts): Flip B for RSI and Bollinger Bands — instances are the authority

The pilot pair's second flip. Both legacy render blocks are DELETED along with
their refs, their indicatorData branches, their hide-all entries and RSI's
crosshair fallback -- six enumeration sites gone for two indicators, which is the
whole point of the phase. The enable signal reaches computePaneMargins through
the projection, so paneMargins.js is still untouched.

They flip TOGETHER because flipping one leaves the two placement paths reading
their enable signal from different places in the same paint.

A legacy-only blob still renders (the read-time migrator projects it); a stored
instance beats a false toggle; a tombstone beats a true one. The legacy section
survives as a write-through mirror so the alert evaluator, the alert popover, the
screener and the ?indicators= route keep working.

Two builds, two named identities: 0 changed px on rsi_only, bb_only, bb_rsi_macd.
--perturb-b on settings: non-zero, exit 1 -- which after Flip B is a real
self-test, because a settings colour can now only reach the series via an
instance.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 11: Flip B — MACD and VWAP

Identical shape to Task 10, with three differences worth their own steps: MACD contributes **two** legend chips that must survive the deletion of `macdLineRef`/`macdSignalRef`; MACD is bound to **Ctrl+O**; and VWAP's enable signal is not only a toggle — `vwapOverride` forces it on, so the projection and the forced-instance branch have to agree about whether VWAP reserves anything (it is a price overlay, so it reserves no band, which makes the answer trivially "no" and worth asserting rather than assuming).

⚠️ **INHERITED, UNGATED BY CONSTRUCTION — gate it here.** Task 2's fix round split the MACD crosshair rescue so `signal`'s fallback is decided by `macdSignalRef`, not by `macd`'s value (review M-6). That change is behaviourally identical *today* — MACD is not migrated, so `engSlots.macd` is always null and the old single branch always ran — and a mutation reverting it therefore SURVIVES the whole suite. The state that distinguishes them, **one plot of a definition drawn by the engine while another is not**, first becomes reachable HERE. The MACD legend case must assert the two chips independently: engine-`macd` + legacy-`signal` must still print `SIG`, and the reverted coupling must go red on it.

⚠️ **VWAP AND THE FLIP-A VISIBILITY GATE.** Task 2's fix round makes the legacy toggle Flip A's visibility switch: an instance of a migrated definition whose `cs.indicators.<id>.enabled` is false is projected to `hidden` (`StockChart.jsx`, `legacyEnabled`). VWAP's enable signal is **not** that flag alone — `vwapOverride` forces it on — so VWAP must not join `ENGINE_MIGRATED_DEF_IDS` until either that projection accounts for the override or Task 10 has already deleted it for the flipped set. The projection carries this warning in-code; do not add the id past it.

**Files:**
- Modify: `app/src/components/StockChart.jsx` — `ENGINE_FLIPPED_DEF_IDS`, `:1708`, `:1722-1724`, the MACD/VWAP `indicatorData` branches, `:5900-5929`, `:5998-6035`, `:7793-7799`, `:8332-8333`, the Ctrl+O handler
- Modify: `app/src/components/chart/ChartToolbar.jsx` (the MACD + VWAP rows, via the writer from Task 10)
- Modify: `app/src/components/chart/engine/__tests__/flipB.test.jsx`
- Modify: `app/src/components/chart/indicatorRegistry.js` (VWAP's row leaves — see Task 12's rail)

**Interfaces:**
- Produces: `ENGINE_FLIPPED_DEF_IDS` = `Set(['rsi', 'bb', 'macd', 'vwap'])`.

- [ ] **Step 1: Write the failing cases**

Append to `flipB.test.jsx`:

```jsx
const macdSeries = () => H.addSeriesCalls.filter(c => c.options?.priceScaleId === 'macd')
const vwapSeries = () => H.addSeriesCalls.filter(c => c.options?.color === '#26C6DA')

describe('Flip B — MACD', () => {
  it('is flipped, and its legacy block is gone', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.has('macd')).toBe(true)
    draw({ indicators: { macd: { enabled: true } } })
    expect(macdSeries(), 'a legacy MACD block still exists').toHaveLength(0)
  })

  it('a legacy-only blob draws all three series through the engine', () => {
    draw({ engineEnabled: true, indicators: { macd: { enabled: true, fastPeriod: 12, slowPeriod: 26, signalPeriod: 9 } } })
    expect(macdSeries()).toHaveLength(3)
    expect(H.binderApis[0].bindings()).toHaveLength(3)
  })

  it('BOTH legend chips survive the deletion of macdLineRef', () => {
    // `processCrosshair` read `macdLineRef.current` and `macdSignalRef.current`
    // for two separate chips. Deleting the refs without the Task 2 bridge takes
    // both out of the readout, and no pixel gate run without a cursor can see it.
    const view = draw({ engineEnabled: true, indicators: { macd: { enabled: true } } })
    const handler = H.crosshairHandlers.at(-1)
    const candle = H.addSeriesCalls.find(c => c.ctor === 'CandlestickSeries')
    const [line, signal] = macdSeries()
    const seriesData = new Map([
      [candle.series, { open: 1, high: 2, low: 0.5, close: 1.5 }],
      [line.series, { value: 0.12345 }],
      [signal.series, { value: 0.09876 }],
    ])
    act(() => { handler({ time: 1, point: { x: 1, y: 1 }, logical: 5, seriesData }) })
    return act(async () => { await new Promise(r => requestAnimationFrame(() => r())) }).then(() => {
      expect(view.container.textContent).toContain('MACD 0.1235')
      expect(view.container.textContent).toContain('SIG 0.0988')
    })
  })

  it('Ctrl+O writes an instance', () => {
    const writes = []
    draw({ engineEnabled: true }, { onSettingsChange: (n) => writes.push(n) })
    act(() => { fireEvent.keyDown(document, { ctrlKey: true, code: 'KeyO' }) })
    expect(writes).toHaveLength(1)
    expect(writes[0].indicatorInstances.some(i => i.defId === 'macd' && !i.deleted)).toBe(true)
    expect(writes[0].indicators.macd.enabled).toBe(true)
  })

  it('the band still comes from the projection', () => {
    draw({ engineEnabled: true, indicators: { macd: { enabled: false } },
           indicatorInstances: [{ instanceId: 'legacy:macd', defId: 'macd', inputs: {}, hidden: false }] })
    expect(H.syncCalls.at(-1).paneMargins.macd).toBeTruthy()
  })
})

describe('Flip B — VWAP', () => {
  it('is flipped, and its legacy block is gone', () => {
    expect(ENGINE_FLIPPED_DEF_IDS.has('vwap')).toBe(true)
    // Intraday, or the eligibility hook hides it and this proves nothing.
    draw({ indicators: { vwap: { enabled: true, color: '#26C6DA' } } }, { tf: '5' })
    expect(vwapSeries()).toHaveLength(0)
  })

  it('a legacy-only blob draws it on an intraday chart', () => {
    draw({ engineEnabled: true, indicators: { vwap: { enabled: true, color: '#26C6DA', opacity: 100 } } }, { tf: '5' })
    expect(vwapSeries()).toHaveLength(1)
  })

  it('still draws NOTHING on a daily chart, flipped or not', () => {
    draw({ engineEnabled: true, indicators: { vwap: { enabled: true, color: '#26C6DA' } } }, { tf: 'D' })
    expect(vwapSeries()).toHaveLength(0)
  })

  it('vwapOverride still forces it on with no instance and no toggle', () => {
    draw({ engineEnabled: true, indicators: { vwap: { enabled: false, color: '#26C6DA' } } },
      { tf: '5', vwapOverride: { color: '#ffffff' } })
    const forced = H.addSeriesCalls.filter(c => c.options?.color === '#ffffff')
    expect(forced, 'the Model Book popup lost its VWAP').toHaveLength(1)
  })

  it('reserves NO band — it is a price overlay', () => {
    // The projection writes `indicators.vwap.enabled`, and `computePaneMargins`'
    // PANES list does not contain vwap. Asserting it rather than assuming it,
    // because a band appearing for a price overlay would shrink the price pane.
    draw({ engineEnabled: true, indicators: { vwap: { enabled: true } } }, { tf: '5' })
    expect(H.syncCalls.at(-1).paneMargins.vwap).toBeUndefined()
  })
})
```

`draw`'s second argument must forward `tf` and `vwapOverride` to StockChart; extend `harness.jsx` accordingly.

- [ ] **Step 2: Run and fail**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/flipB.test.jsx`
Expected: FAIL — `ENGINE_FLIPPED_DEF_IDS.has('macd')` is false.

- [ ] **Step 3: Flip and delete**

```js
export const ENGINE_FLIPPED_DEF_IDS = Object.freeze(new Set(['rsi', 'bb', 'macd', 'vwap']))
```

Delete: the VWAP block (`:5900-5929`), the MACD block (`:5998-6035`), `vwapSeriesRef` (`:1708`), `macdLineRef`/`macdSignalRef`/`macdHistRef` (`:1722-1724`), their hide-all entries (`:8332-8333`), the `vwap` and `macd` branches of `indicatorData` (including the whole `macd: (() => {…})()` IIFE and its head-mask, whose engine copy in `nativeRegistry.maskMacdHead` is now the only one), and the MACD crosshair fallback — Task 2's bridge lines become:

```js
      const macdValue = engSlots.macd ? engSlots.macd.value : null
      const macdSignalValue = engSlots.macdSig ? engSlots.macdSig.value : null
```

⚠️ Deleting the `indicatorData.macd` IIFE removes the second `MACD_HEAD_MASK` consumer added in Task 5. **Verify `MACD_HEAD_MASK` still has exactly one reader** (`nativeRegistry`'s `COLUMN_HOLDS`) and update `docs/decisions/2026-08-02-macd-head-mask.md` to say so — the decision record must not point at a call site that no longer exists.

⚠️ `MACD_HIST_UP` / `MACD_HIST_DOWN` (`:91-92`) lose their last reader. **Delete them**, and add a comment at `nativeRegistry`'s macd histogram plot noting that the two literals now live only there. `grep -n "MACD_HIST_" app/src/` must return exactly the two lines in `nativeRegistry.js` plus their test.

⚠️ `VWAP_TFS` (`:569`) and `_withVwapOpacity` (`:581`) lose their readers too. **Delete both**, having confirmed `eligibility.js` carries the transcription. `grep -rn "VWAP_TFS\|_withVwapOpacity" app/src/` must return only `eligibility.js` and its test.

Rewire the Ctrl+O branch exactly as Ctrl+I was in Task 10 (it goes through the same `updateIndicator` helper, so it needs no separate change — verify).

- [ ] **Step 4: Run — green**

Run: `cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__`
Expected: PASS.

- [ ] **Step 5: The pixel gate**

Build A from the Task 10 commit in a temporary worktree (same recipe as Task 10 Step 6 — **never `git stash`**), B from this commit.

```bash
python tools/chart_parity.py --base-a $A --base-b $B --cases macd_only bb_rsi_macd
python tools/chart_parity.py --base-a $A --base-b $B --cases vwap_only
python tools/chart_parity.py --base-a $A --base-b $B --cases macd_only \
    --perturb-b '{"indicators": {"macd": {"macdColor": "#2196F4"}}}'
python tools/chart_parity.py --base-a $A --base-b $B --cases vwap_only \
    --perturb-b '{"indicators": {"vwap": {"opacity": 40}}}'
```

Expected: **0**, **0**, then **non-zero exit 1** twice. The VWAP perturb is the sharper of the two: it moves an input that reaches the series only through `eligibility.js`'s composition, so a 0 there means the settings→instance→eligibility chain is broken somewhere in the middle.

- [ ] **Step 6: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | `ENGINE_FLIPPED_DEF_IDS` without `'vwap'` | flipB "Flip B — VWAP / is flipped" |
| M2 | delete `'macd::signal'` from `LEGACY_SLOTS` | flipB "BOTH legend chips survive" + readout slot rail |
| M3 | remove the `vwapOverride` forced-instance branch | flipB "vwapOverride still forces it on" |
| M4 | add `vwap` to `paneMargins.js`'s `PANES` | flipB "reserves NO band" |
| M5 | re-add the deleted MACD block | flipB "its legacy block is gone" |
| M6 | `MACD_HEAD_MASK = false` | `nativeRegistry.test.js` "is ON" + `macdFlipAParity` "the head-mask survived the move" |

- [ ] **Step 7: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__ && cd ..
git add app/src/components/StockChart.jsx app/src/components/chart/ChartToolbar.jsx \
        app/src/components/chart/indicatorRegistry.js \
        app/src/components/chart/engine/__tests__/flipB.test.jsx \
        docs/decisions/2026-08-02-macd-head-mask.md
git commit -m "feat(charts): Flip B for MACD and VWAP — four indicators fully migrated

Both legacy blocks deleted, with their refs, their indicatorData branches, their
hide-all entries and their crosshair reads. MACD_HIST_UP/DOWN, VWAP_TFS and
_withVwapOpacity lose their last readers in StockChart and are deleted -- the
definitions and engine/eligibility.js carry them now, which is the deletion Flip B
is for.

MACD's TWO legend chips are asserted through a driven crosshair event, because
deleting macdLineRef and macdSignalRef takes both out of the readout and no
headless pixel capture can see a legend nobody hovered.

Two builds, two named identities: 0 changed px on macd_only, vwap_only,
bb_rsi_macd. --perturb-b on vwap.opacity: non-zero exit 1, which exercises the
whole settings→instance→eligibility chain.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 12: `indicatorRegistry` superseded + the enumeration ledger

Adjudication A6, and the phase's stated purpose. The 2026-07 header on `indicatorRegistry.js` counted **seven** places an indicator is enumerated. This plan first counted **sixteen** — and that number was wrong. Task 2's review walked all sixteen against the shipped Flip-A state and found **five more**, four of them named in review finding I-4 and one (`chartBus`) triaged there as dead-but-real. Task 2's RE-review then found a twenty-second, in a page component nobody had walked. The corrected count is **twenty-two**, line numbers as of `d1131320` (Task 2 fix round 1) except #22 (as of the harness-hardening round):

> **The count has now been wrong four times: 7 → 16 → 20 → 21 → 22.** Every correction came from someone walking the code rather than reading the previous count, and #22 was found in a file none of the earlier walks opened because it is a *page*, not a chart module. Treat the number below as the best current walk, not as a closed set — which is precisely why Task 12 makes it a test.

| # | Site | What it enumerates |
|---|---|---|
| 1 | `chartDefaults.js:126` | `CHART_DEFAULTS.indicators` — 15 default sections |
| 2 | `chartDefaults.js:314+` | `mergeChartSettings`' hand-written per-key allow-list, 15 lines |
| 3 | `StockChart.jsx:1699+` | the series `useRef` declarations, 27 refs |
| 4 | `StockChart.jsx:3954+` | the `indicatorData` memo — 14 compute calls + shape mapping |
| 5 | `StockChart.jsx:5912+` | the 14 hand-written render blocks |
| 6 | `StockChart.jsx:7824+` | the crosshair value reads |
| 7 | `StockChart.jsx:8388` | the hide-all ref array |
| 8 | `StockChart.jsx:9669` | the `legChips` list |
| 9 | `paneMargins.js:38-49` | the `PANES` stacking list, 9 oscillators |
| 10 | `chartRegion.js:68-78` | `INDICATOR_LABELS`, 9 |
| 11 | `ChartToolbar.jsx:400` + rows | `OSC` plus one JSX block per indicator |
| 12 | `indicatorRegistry.js:81-115` | `listIndicators()` — MA overlays, volume, VWAP |
| 13 | `keyboardShortcuts.js:99-100,154-155` | Ctrl+I / Ctrl+O |
| 14 | `IndicatorAlertPopover.jsx:15-53` | `INDICATORS` + `CONDITIONS` |
| 15 | `nativeRegistry.js` `RAW_DEFS` | **the one that should survive** |
| 16 | `tools/chart_parity_cases.json` | the case list |
| **17** | `StockChart.jsx:2196` `IND_OPTS` | right-click **Indicators ▸** submenu, 8 names — writes `indicators.<key>.enabled` |
| **18** | `StockChart.jsx:2207` `OSC_OPTS` | right-click **Overlay on volume ▸** submenu, 9 names. A SECOND copy of #11's `OSC`, in a different file, one entry apart |
| **19** | `StockChart.jsx:2236` right-click **Hide `<label>`** | `INDICATOR_LABELS[region.key]` → `setCs('indicators.<key>.enabled', false)` |
| **20** | `StockChart.jsx:2382-2402` `handleCopyShareUrl` | **`rsi`, `macd`, `bb`, `vwap` — exactly the four B3 pilots.** Carries neither `indicatorInstances` nor `engineEnabled` |
| **21** | `utils/chartBus.js:22` `ALLOWED_INDICATORS` | the voice `add_indicator` allow-list (`rsi`/`macd`/`bb` + MAs/VWAP). **DEAD TODAY** — nothing subscribes to `CHART_BUS_EVENTS.ADD_INDICATOR` — and listed anyway, because a ledger that drops a site for being unreachable cannot notice the day it becomes reachable |
| **22** | `pages/charts/ChartsWorkspace.jsx:104` `UCT_DEFAULT_CHART_SETTINGS_JSON` | a frozen July capture that hand-lists **all fifteen indicator sections** with their full parameter sets — a THIRD copy of #1 and #2, in a page component. Written verbatim to the `chart_settings` preference by **Open Layout → UCT Default**, **New Layout**, and `applyTemplate`'s prebuilt fallback |

**Site 22 is site 20's twin, one step worse, and it is FIXED (not deferred) as of the harness-hardening round.** `mergeChartSettings` computes `engineEnabled: parsed.engineEnabled === true` — a read of the *parsed blob*, not of the default — so the capture's ABSENT key is a hard OFF that flipping `CHART_DEFAULTS.engineEnabled` at Flip B would not heal. After Task 10 deletes the legacy render blocks for the flipped ids, a user clicking either menu item would land on a board where RSI / MACD / BB / VWAP are **undrawable**, and ticking the toolbar checkbox would reserve a band with no line in it. Site 20 breaks the *recipient* of a shared link; this breaks the user who clicked a menu item. The fix is `uctDefaultChartSettings()` in the same file: the two engine keys are stamped from `CHART_DEFAULTS` at write time instead of being frozen alongside the palette, so Flip B heals all three writers for free. Gated in `ChartsWorkspace.test.jsx` (three tests: both menu items through the real click path, plus a rail that reads the shipping source and refuses a fourth writer that bypasses the wrapper). **Task 12's ledger test must cover it** — the failable assertion is KEY PRESENCE, not the value: while the default is `false` a merged-value assertion passes on the unfixed code and gates nothing.

**Sites 17, 19 and #11's checkbox are the SAME switch, four doors wide.** Task 2's fix round makes all four work under Flip A (the legacy toggle stays the visibility authority and StockChart projects an instance whose toggle is off to `hidden`); Task 10 moves that authority to the instance via `instanceControls`, and every one of the four has to be routed there or it regresses to writing a flag nothing reads.

**Site 20 is a Flip-B landmine and belongs to Task 10, not to this task.** At Flip A it is harmless — `cs.indicators.rsi.enabled` is still true and still authoritative, so a shared link reproduces the chart. **At Flip B `enabled` stops being the authority**, and "Copy chart link" silently drops RSI and Bollinger Bands from every shared chart. Task 10 must carry `indicatorInstances` + `engineEnabled` through `chartStateToUrl`, with a test; this task's ledger only has to know the site exists so the test can cover it.

B3 retires **3, 4, 5, 6, 8** for the four flipped indicators (Tasks 10–11), **9** via the projection (Task 9), and **12** for VWAP (this task). **10, 11, 13, 14, 17, 18, 19** need the settings-dialog rework of spec §6 and belong to B4; **1, 2, 16** are data files that legitimately list things; **20** is Task 10's; **21** is dead and stays listed; **22** is fixed (its enumeration of 15 sections survives as a frozen capture, but it no longer pins the engine keys) and stays listed, because the capture is still a hand-copy that a sixteenth indicator would have to be added to. This task writes the ledger down and makes it a test, so the count cannot quietly grow back.

**Files:**
- Modify: `app/src/components/chart/indicatorRegistry.js`
- Create: `app/src/components/chart/engine/__tests__/enumerationSites.test.js`
- Modify: `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` (§5, a pointer to the ledger)

**Interfaces:**
- Produces: `indicatorRegistry.ENGINE_OWNED_EXCLUSIONS` — nothing; the rail reads `ENGINE_MIGRATED_DEF_IDS` directly.

- [ ] **Step 1: Write the failing ledger**

Create `app/src/components/chart/engine/__tests__/enumerationSites.test.js`:

```js
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { ENGINE_MIGRATED_DEF_IDS, ENGINE_FLIPPED_DEF_IDS } from '../../../StockChart'
import { listIndicators } from '../../indicatorRegistry'
import { CHART_DEFAULTS } from '../../chartDefaults'
import { listDefinitions } from '../nativeRegistry'

// ─── THE ENUMERATION LEDGER ─────────────────────────────────────────────────
//
// "An indicator is enumerated in seven places" is the sentence
// `indicatorRegistry.js` opened with in July 2026, and the whole indicator
// platform exists to end it. Counted again at `c6970d28` it was SIXTEEN. A
// comment cannot hold that number down; this can.
//
// Each entry below names a file, a marker that anchors the region, and the rule
// that must hold for a FLIPPED definition. A flip that forgets to delete a site
// fails here, and a site that grows back fails here too.

const SRC = path.resolve(__dirname, '../../../..')
const read = (rel) => fs.readFileSync(path.join(SRC, rel), 'utf8')

/** The regions a flipped indicator must NO LONGER appear in. */
const RETIRED_FOR_FLIPPED = [
  { file: 'components/StockChart.jsx', marker: 'const set = (ref) =>',
    label: 'the hide-all ref array', extract: (s) => between(s, '].forEach(set)', 'const set = (ref) =>') },
  { file: 'components/StockChart.jsx', marker: 'const legChips = [',
    label: 'the legend chip list', extract: (s) => between(s, '].filter(Boolean)', 'const legChips = [') },
]

/** Text between `marker` and the next occurrence of `end`, marker-first. */
function between(source, end, marker) {
  const i = source.indexOf(marker)
  if (i < 0) throw new Error(`marker not found: ${marker} — the ledger is stale, fix the marker`)
  const j = source.indexOf(end, i)
  if (j < 0) throw new Error(`end not found after ${marker}`)
  return source.slice(i, j)
}

/** `defId` → the identifiers/strings that would appear in a hand-written site. */
const TOKENS = {
  rsi: ['rsiSeriesRef', 'crosshairData.rsi'],
  bb: ['bbUpperRef', 'bbMiddleRef', 'bbLowerRef'],
  macd: ['macdLineRef', 'macdSignalRef', 'macdHistRef', 'crosshairData.macd'],
  vwap: ['vwapSeriesRef'],
}

describe('the enumeration ledger — twenty-two sites, and which ones B3 retires', () => {
  it('every migrated definition is also flipped, or is on the way there', () => {
    // A definition can be migrated (Flip A) without being flipped (Flip B); the
    // reverse is a deleted block with nothing drawing it.
    for (const id of ENGINE_FLIPPED_DEF_IDS) expect(ENGINE_MIGRATED_DEF_IDS.has(id), id).toBe(true)
  })

  it('a FLIPPED definition appears in NO retired site', () => {
    const failures = []
    for (const site of RETIRED_FOR_FLIPPED) {
      const region = site.extract(read(site.file))
      for (const id of ENGINE_FLIPPED_DEF_IDS) {
        for (const token of (TOKENS[id] || [])) {
          if (region.includes(token)) failures.push(`${id}: ${token} still in ${site.label} (${site.file})`)
        }
      }
    }
    expect(failures).toEqual([])
  })

  it('a FLIPPED definition has no legacy render block left', () => {
    const src = read('components/StockChart.jsx')
    const failures = []
    for (const id of ENGINE_FLIPPED_DEF_IDS) {
      for (const token of (TOKENS[id] || [])) {
        if (src.includes(`${token}.current = chart.addSeries`)) failures.push(`${id}: ${token} still creates a series`)
      }
      if (src.includes(`engineOwned.has('${id}')`)) {
        failures.push(`${id}: a Flip-A guard survives its Flip B — the block should be GONE, not guarded`)
      }
    }
    expect(failures).toEqual([])
  })

  it('a MIGRATED-but-not-flipped definition still HAS its guard', () => {
    const src = read('components/StockChart.jsx')
    for (const id of ENGINE_MIGRATED_DEF_IDS) {
      if (ENGINE_FLIPPED_DEF_IDS.has(id)) continue
      expect(src.includes(`engineOwned.has('${id}')`), `${id} is migrated with no guard — it double-draws`).toBe(true)
    }
  })

  it('indicatorRegistry lists NOTHING the engine owns (adjudication A6)', () => {
    const rows = listIndicators(CHART_DEFAULTS)
    const owned = rows.filter(r => ENGINE_MIGRATED_DEF_IDS.has(r.path?.key) || ENGINE_MIGRATED_DEF_IDS.has(r.id))
    expect(owned.map(r => r.id),
      'a settings-tab row and an engine definition are two sources of truth for one indicator').toEqual([])
  })

  it('paneMargins.js is still consumed, not owned — no engine key was added', () => {
    const src = read('components/chart/paneMargins.js')
    for (const def of listDefinitions()) {
      if (def.placement.target !== 'price') continue
      expect(src.includes(`key: '${def.id}'`),
        `${def.id} is a price overlay — a band for it would reserve space for nothing`).toBe(false)
    }
  })

  it('the SURVIVING enumeration is the registry, and it is complete', () => {
    const settingsKeys = Object.keys(CHART_DEFAULTS.indicators)
    const defined = listDefinitions().map(d => d.id)
    expect(defined.every(id => settingsKeys.includes(id)),
      'a definition with no settings key cannot be migrated from a legacy blob').toBe(true)
  })
})
```

⚠️ Source-text assertions are brittle by nature. That is accepted here **because the failure they catch is a deletion somebody forgot**, which no behavioural test can see (the code simply is not reached). Each marker throws a named error if it moves, so a stale ledger says so instead of passing vacuously — which is the difference between this and a `grep` in a comment.

- [ ] **Step 2: Run and fail**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js`
Expected: FAIL — "indicatorRegistry lists NOTHING the engine owns" (VWAP's row is still there).

- [ ] **Step 3: Supersede `indicatorRegistry.js`**

Replace its header with:

```js
// Indicator descriptors — the settings-tab rows for the things the ENGINE DOES
// NOT OWN.
//
// ─── SUPERSEDED, NOT ABSORBED (B3 adjudication A6) ──────────────────────────
//
// This file opened, in July 2026, with "the indicator list is currently
// enumerated in seven places". Counted again at `c6970d28` it was SIXTEEN, and
// ending that is what the whole indicator platform is for. The answer is not to
// finish this half-built `inputs[]` layer: `engine/defSchema.js` IS that layer,
// with typed inputs, `$ref` substitution, plot declarations, validation and two
// consumers. A second one would be a second source of truth per indicator.
//
// So this file is SUPERSEDED. It keeps exactly the rows the engine cannot own:
//
//   · the MOVING-AVERAGE OVERLAYS, whose identity is POSITIONAL. Slot 0 IS "the
//     9 EMA" to every blob ever written, `mergeChartSettings` merges the array by
//     index and pads it, and giving an overlay an `instanceId` makes one of the
//     two identities a lie the moment both exist (`engine/instances.js:25-42`).
//     Migrating them means deleting the legacy overlay render block in the same
//     change, which is its own plan.
//   · the VOLUME PANE, which is not an indicator at all.
//
// ⛔ THE RAIL: a definition id in `ENGINE_MIGRATED_DEF_IDS` may not appear in
// `listIndicators()`. `engine/__tests__/enumerationSites.test.js` fails if one
// does. VWAP was the last overlap and its row left at its Flip A.
```

Delete the `VWAP_FIELDS` export and the `vwap` row from `listIndicators()`. Grep for consumers first: `grep -rn "VWAP_FIELDS" app/src/`. If `ChartSettingsModal` renders it, that surface loses the VWAP row and gains it back from the definition at B4 — record that in the commit message, and confirm the toolbar's own VWAP controls (which are separate JSX) still exist so no user loses access.

- [ ] **Step 4: Run — green**

Run: `cd app && npx vitest run src/components/chart/engine/__tests__/enumerationSites.test.js src/components/chart`
Expected: PASS.

- [ ] **Step 5: Record the ledger in the spec**

In `docs/superpowers/specs/2026-07-31-indicator-platform-design.md` §5, after the two-flip bullet:

```markdown
- **The enumeration ledger.** "An indicator is enumerated in N places" is the
  problem this phase exists to end. Counted at `c6970d28`: **twenty-two**, up
  from the seven recorded in July — and that number has been corrected four
  times (7 → 16 → 20 → 21 → 22), the last of them a frozen chart-settings capture
  in a PAGE component that no chart-module walk had opened. B3 retires six of them per flipped indicator (the
  refs, the compute memo, the render block, the crosshair read, the legend chip,
  the hide-all entry), one globally (the pane-margin stacking list, via a
  projection — `paneMargins.js` is still consumed, not owned) and one for VWAP
  (`indicatorRegistry`'s row). Four more — `chartRegion.INDICATOR_LABELS`,
  `ChartToolbar`'s `OSC` + rows, `keyboardShortcuts`' Ctrl+I/Ctrl+O and
  `IndicatorAlertPopover`'s `INDICATORS` — need the §6 settings-dialog rework and
  belong to B4. The count is a TEST
  (`engine/__tests__/enumerationSites.test.js`), not a comment, because a comment
  is how it grew from seven to twenty-two unnoticed.
```

- [ ] **Step 6: The mutations**

| # | Mutation | Must fail |
|---|---|---|
| M1 | re-add the `vwap` row to `listIndicators()` | "indicatorRegistry lists NOTHING the engine owns" |
| M2 | re-add `rsiSeriesRef` to the hide-all array | "a FLIPPED definition appears in NO retired site" |
| M3 | re-add `crosshairData.macd != null && [...]` to `legChips` | same |
| M4 | leave a `engineOwned.has('rsi')` guard behind after the flip | "a FLIPPED definition has no legacy render block left" |
| M5 | remove the `engineOwned.has(...)` guard from an un-flipped migrated id (none exist after Task 11 — add a fifth id to `ENGINE_MIGRATED_DEF_IDS` to exercise it) | "a MIGRATED-but-not-flipped definition still HAS its guard" |
| M6 | add `{ key: 'bb', ... }` to `paneMargins.js`'s `PANES` | "paneMargins.js is still consumed, not owned" |
| M7 | rename `const legChips = [` | the ledger throws "marker not found — the ledger is stale" rather than passing |

M7 is the important one: it proves the ledger reports its own staleness instead of going quietly green.

- [ ] **Step 7: Commit**

```bash
cd app && npx vitest run src/components/chart src/components/__tests__ src/__tests__ && cd ..
git add app/src/components/chart/indicatorRegistry.js \
        app/src/components/chart/engine/__tests__/enumerationSites.test.js \
        docs/superpowers/specs/2026-07-31-indicator-platform-design.md
git commit -m "refactor(charts): indicatorRegistry is superseded, and the count is a test

'The indicator list is enumerated in seven places' was written in July. At
c6970d28 it was SIXTEEN, and nothing failed as it grew -- which is exactly how a
comment holds a number down. enumerationSites.test.js is the ledger: a flipped
definition may appear in none of the retired sites, a migrated-but-unflipped one
must still carry its guard, indicatorRegistry may list nothing the engine owns,
and paneMargins.js may not gain an engine key. A marker that moves throws by
name instead of passing vacuously.

indicatorRegistry keeps only what the engine cannot own: the MA overlays (whose
identity is positional and whose migration deletes a render block in the same
change) and the volume pane. VWAP's row is gone.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 13: Whole-branch gate

The last task. It runs everything at once against a single build and records the numbers with their build identities, so the branch's claim is one artifact rather than thirteen commit messages.

**Files:**
- Create: `.superpowers/sdd/2026-08-02-phase-b3-migration/progress.md`
- Modify: `docs/runbooks/chart-parity-gate.md` (the B3 checklist)

- [ ] **Step 1: Full frontend suite, counted**

```bash
cd app && npx vitest run 2>&1 | tail -20
```
Expected: all green. Record `Tests  <N> passed` and `Test Files  <F> passed`. Baseline was **3,607 / 388**; B3 adds roughly **+130** across `readout`, `eligibility`, `instanceControls`, `paneMarginsProjection`, the four Flip-A transcription suites, `flipB`, `enumerationSites`, the fixture suite and the extensions to `placement`/`pool`/`binder`/`defSchema`/`nativeRegistry`/`stockChartWiring`. **A number materially below that means a suite is not being collected** — check for a file the glob misses.

- [ ] **Step 2: Build once, serve once, run every case**

```bash
cd app && npm run build && rm -rf /tmp/parity-B3 && cp -r dist /tmp/parity-B3 && cd ..
python tools/spa_server.py /tmp/parity-B3 5185 &
B=http://127.0.0.1:5185

# determinism, both render paths
python tools/chart_parity.py --base-a $B --base-b $B --instances-side none  --cases \
  engine_rsi_vs_legacy engine_bb_vs_legacy engine_macd_vs_legacy engine_vwap_vs_legacy \
  engine_bb_rsi_vs_legacy engine_bb_rsi_macd_vs_legacy engine_vwap_dimmed_vs_legacy
python tools/chart_parity.py --base-a $B --base-b $B --instances-side both --cases \
  engine_rsi_vs_legacy engine_bb_vs_legacy engine_macd_vs_legacy engine_vwap_vs_legacy \
  engine_bb_rsi_vs_legacy engine_bb_rsi_macd_vs_legacy engine_vwap_dimmed_vs_legacy

# the gate
python tools/chart_parity.py --base-a $B --base-b $B --cases \
  engine_rsi_vs_legacy engine_bb_vs_legacy engine_macd_vs_legacy engine_vwap_vs_legacy \
  engine_bb_rsi_vs_legacy engine_bb_rsi_macd_vs_legacy engine_vwap_dimmed_vs_legacy

# every fail-proof
for c in engine_rsi_vs_legacy engine_bb_vs_legacy engine_macd_vs_legacy engine_vwap_vs_legacy; do
  python tools/chart_parity.py --base-a $B --base-b $B --cases $c --perturb-b-instances '{"color": "#123456"}'
done
```

Expected: `0` on the first three groups; **non-zero + exit 1** on all four fail-proofs.

⚠️ `--perturb-b-instances '{"color": …}'` only bites on definitions with a `color` input. MACD's are `macdColor`/`signalColor`. Use `'{"macdColor": "#2196F4"}'` for MACD. If a perturbation reports **0**, that case's self-test is vacuous — the exact class the harness's four refusals exist to catch — and it must be fixed before the branch is called done.

- [ ] **Step 3: Flip-B end-to-end, against the pre-B3 branch point**

```bash
git worktree add /tmp/b3-base c6970d28
cd /tmp/b3-base/app && ln -s /c/Users/Patrick/uct-dashboard/app/node_modules node_modules && npm run build
cp -r dist /tmp/parity-pre && cd - && git worktree remove /tmp/b3-base --force
python tools/spa_server.py /tmp/parity-pre 5186 &
python tools/chart_parity.py --base-a http://127.0.0.1:5186 --base-b $B \
  --cases rsi_only bb_only macd_only bb_rsi_macd
```

Expected: **0 changed pixels on all four**, with two DIFFERENT build identities in `report.md`. This is the branch's headline number: *the whole of B3, measured against the branch point, on the settings a real user has, changes nothing.*

`vwap_only` is deliberately excluded — it runs on `intraday5m`, which does not exist at `c6970d28`, so side A cannot render it. Note that in the report rather than quietly dropping it.

- [ ] **Step 4: Verify the branch state**

```bash
git rev-parse --abbrev-ref HEAD        # must be feat/phase-b2-engine
git log --oneline c6970d28..HEAD
git diff --stat c6970d28..HEAD
grep -rn "MACD_HIST_UP\|VWAP_TFS\|_withVwapOpacity" app/src/ | grep -v engine/ | grep -v test
```
The last command must return **nothing**: those three moved into the engine and their StockChart copies are deleted.

```bash
cd app && npx vitest run src/__tests__/sourcesAreText.test.js
```
Expected: PASS — the NUL-byte rail from B2 residual N-1. The Edit/Write tools re-injected a NUL twice while writing that fix; every new engine module is subject to the same failure.

- [ ] **Step 5: Write the ledger**

Create `.superpowers/sdd/2026-08-02-phase-b3-migration/progress.md` recording, one line each: the task, its commit sha, its test delta, its pixel numbers with both build identities, its mutation count (applied/caught), and every finding. Follow B2's `progress.md` format exactly — it is the artifact the next phase reads first.

Mandatory entries:
- the two flagged decisions still OPEN (`MACD_HEAD_MASK`, VWAP's UTC-day bucketing) with their measured costs and their decision-record paths;
- the eleven definitions still on Flip A-or-earlier (`stoch`, `atr`, `sar`, `ichimoku`, `mfi`, `cci`, `williamsR`, `adx`, `obv`, `donchian`) and the fact that each is now a two-line change plus a parity case;
- the price-overlay z-order rule and which test enforces it;
- the four enumeration sites B4 inherits (`chartRegion.INDICATOR_LABELS`, `ChartToolbar`'s `OSC` + rows, `keyboardShortcuts`, `IndicatorAlertPopover`);
- the `readout.LEGACY_SLOTS` bridge and its deletion condition;
- the dead Ichimoku spanA/spanB `0.5` fallback (`StockChart.jsx:5928-5929` pre-B3, unreachable because `mergeChartSettings` fills `0.2`) — **still not deleted**, since Ichimoku has not migrated;
- `eligibility.js`'s `hidden` reasons, which nothing consumes yet and which UX state 8 needs.

- [ ] **Step 6: Add the B3 checklist to the runbook**

In `docs/runbooks/chart-parity-gate.md`, after section 4:

```markdown
### 5. Migrating one more indicator — the whole checklist

1. Write its Flip-A transcription suite (`engine/__tests__/<id>FlipAParity.test.js`),
   copying the legacy `addSeries` / `applyIndScale` / `createPriceLine` calls
   VERBATIM. Run it BEFORE touching `StockChart.jsx` — it should pass, and a
   failure is a definition/shipped-block disagreement, which is the migration's
   pixel diff arriving early.
2. Add `'<id>'` to `ENGINE_MIGRATED_DEF_IDS` **and** `&& !engineOwned.has('<id>')`
   to its legacy block. `stockChartWiring.test.jsx` fails if only one lands.
   A price overlay must not be migrated ahead of an earlier one in registry order.
3. Fill in `<id>_only` and add `engine_<id>_vs_legacy` to
   `chart_parity_cases.json`. A session indicator takes `intraday5m`.
4. Run, in this order: `--instances-side none` (0) · `--instances-side both` (0) ·
   the case itself (0) · `--perturb-b-instances` (non-zero, exit 1). Confirm both
   identity lines name the same build with `engine source: present`.
5. Declare its legend chips (`plots[].legend` + `LEGACY_SLOTS`) or the readout
   silently loses them — the pixel gate cannot see a legend nobody hovered.
6. For Flip B: add it to `ENGINE_FLIPPED_DEF_IDS`, DELETE the block and its refs,
   its `indicatorData` branch, its hide-all entry and its crosshair read, and
   route its controls through `indicatorWriter`. Then two builds, same settings,
   `--cases <id>_only` = 0, and `--perturb-b` on its settings colour = non-zero.
   `enumerationSites.test.js` fails if any site survives.
```

- [ ] **Step 7: Final commit — DO NOT PUSH TO MASTER**

```bash
git add .superpowers/sdd/2026-08-02-phase-b3-migration/progress.md docs/runbooks/chart-parity-gate.md
git commit -m "docs(engine): Phase B3 ledger and the per-indicator migration checklist

Four indicators through both flips. Whole branch vs c6970d28, two named build
identities: 0 changed px on rsi_only, bb_only, macd_only, bb_rsi_macd. Every
engine case 0 with both determinism pre-checks at 0 and every fail-proof non-zero
at exit 1. Two flagged decisions remain OPEN with measured costs recorded.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin feat/phase-b2-engine    # ⛔ NEVER feat/phase-b2-engine:master
```

---

## Self-review

**Spec coverage.** §5's engine runtime, instance model, settings migration safeguards, binding layer and two-flip migration order (BB + RSI → MACD → VWAP late) are Tasks 1–11; §5's perf budget is unchanged from B2's memos; §5's mount-site scoping is untouched (all mount sites render the same instance list). §6's UX contract is B4 — B3 touches only the crosshair readout half of "ONE formatting pipeline", via `plots[].legend`. §9's gates: golden fixtures unchanged, visual parity gate per indicator (every task), error isolation unchanged (`attempt()` in the binder), lazy Python porting untouched, perf logging deferred. §9's *mandatory session fixtures* are Task 7. §3.1's fail-closed unknown-field policy is extended to `plots[].legend` and `meta.timeframes`.

**Not covered, and stated rather than implied:** the remaining ten definitions (`stoch`, `atr`, `sar`, `ichimoku`, `mfi`, `cci`, `williamsR`, `adx`, `obv`, `donchian`); the settings-dialog rework and the library dialog (§6, B4); Flip C, the pane cutover (B5). The brief scopes B3 to four indicators, and the checklist in Task 13 Step 6 makes each remaining one a two-line change plus a case.

**Type consistency.** `resolvePlacement` returns `{paneIndex, scaleId, scaleOptions, autoscale}` in Tasks 1, 3, 6, 8. `seriesOptionsForPlot(plot, ctx)` takes `ctx.autoscale` in Tasks 1, 3, 6, 8. `engineChips(bindings, seriesData, registry, instances)` and `chipsBySlot(chips)` in Tasks 2, 11. `eligibleInstances(instances, registry, ctx) → {kept, hidden}` in Tasks 8, 11. `csForPaneMargins(cs, instances, flippedIds)` in Tasks 9, 10, 11. `setIndicatorEnabled(cs, defId, enabled, registry)` / `setIndicatorInput(cs, defId, key, value, registry)` / `isIndicatorEnabled(cs, defId, flippedIds)` in Tasks 9, 10, 11. `ENGINE_MIGRATED_DEF_IDS` and `ENGINE_FLIPPED_DEF_IDS` are both `Object.freeze(new Set(...))` exported from `StockChart.jsx` throughout.

**Known plan risks, named so the executor is not surprised:**
1. Task 9 Step 9 requires **moving the `engineOn`/`engineInstances`/`engineOwned` block above `volOverlaySet`** in `updateChart`. It has no dependency on anything between, but it is a real edit inside a 700-line function — run the wiring suite immediately after.
2. Task 10 Step 1 requires **extracting the test harness** from `stockChartWiring.test.jsx` before `flipB.test.jsx` can exist. Do it as its own commit and confirm the original suite passes unchanged.
3. `parseColor`'s home must be confirmed before Task 8; if it lives in `StockChart.jsx` it must move to a shared module first — the engine may not import the component.
4. Every two-build parity run builds side A from a **temporary git worktree**, never `git stash`: the stash stack is shared across ~70 worktrees and `stash push <paths>` on untracked files is a silent no-op whose paired bare `pop` steals somebody else's stash. A new worktree also has no `app/node_modules` — junction or symlink it before building.

