// ─── THE GATE FOR ADJUDICATION A2 ───────────────────────────────────────────
//
// `paneMargins.js` is CONSUMED, NOT OWNED. It has its own `PANES` stacking list,
// its own crash fix (`1c1b84bf`) and its own tests, and the engine has never been
// allowed to extend it. So Flip B does not teach it a second input — it projects
// the instance list back into the shape it already reads, and that projection is
// only allowed to exist because it is PROVABLY the same answer.
//
// "Provably" is the exhaustive case below: for all 512 subsets of the nine
// stacked oscillators, across three volume/exclusion variants, the projected
// margins are deep-equal to the legacy read. A projection that is right on the
// four blobs a brief happened to list is not a proof of anything.
import { describe, it, expect } from 'vitest'
import { csForPaneMargins, csForPaneMarginsFromSettings } from './paneMarginsProjection'
import { computePaneMargins } from '../paneMargins'
import { migrateLegacyToInstances } from './instances'
import { mergeChartSettings } from '../chartDefaults'
import { ENGINE_FLIPPED_DEF_IDS } from './flipState'
import * as engineRegistry from './nativeRegistry'

const CS = {
  indicators: {
    rsi: { enabled: true, period: 14 }, macd: { enabled: true },
    stoch: { enabled: false }, atr: { enabled: true },
  },
}

/** Every key `computePaneMargins` stacks a band for, in its own order. If this
 *  drifts from `paneMargins.js` the exhaustive gate below stops covering the
 *  list it claims to — so it is asserted against the module, not trusted. */
const PANE_KEYS = ['obv', 'atr', 'adx', 'macd', 'cci', 'williamsR', 'mfi', 'stoch', 'rsi']

describe('csForPaneMargins — instances drive the bands without touching paneMargins.js', () => {
  // ⚠️⛔ THE TWO CASES BELOW ARE UNIT CLAIMS WITH NO LIVE PATH AS OF B5 TASK 8,
  // AND THAT IS SAID HERE RATHER THAN LEFT TO BE DISCOVERED. Their subject is
  // "`flippedIds` is empty", and `ENGINE_FLIPPED_DEF_IDS` now holds all fourteen
  // series-expressible definitions — so no shipped call site can reach the
  // short-circuit any more: `StockChart` passes the constant, and the constant is
  // never empty. They are KEPT, deliberately, because the short-circuit is real
  // code with a real cost if it is deleted (every chart would allocate a fresh
  // settings object on every paint) and because an empty set is exactly what a
  // future caller — a test double, a Phase-C lane that owns a different set —
  // would hand it.
  //
  // ⛔ WHAT IS NOT ALLOWED IS TO GO ON READING THEM AS "the dark state is inert".
  // That sentence was true while B3/B4 were landing dark and it is now a claim
  // about an unreachable branch, which is precisely how a comment rots: the
  // assertion stays green, the reason underneath it stops being true, and the
  // next reader inherits a guarantee about production that nothing measures. The
  // live claim is the DEEP-EQUAL one below.
  it('with NO flipped ids it returns the SAME object — a true no-op (UNIT ONLY)', () => {
    // If this ever allocated, a caller holding an empty set would recompute its
    // margins from a fresh object on every paint for no reason.
    expect(csForPaneMargins(CS, [], new Set())).toBe(CS)
  })

  it('…and the short-circuit is on the FLIP SET, not on an empty instance list (UNIT ONLY)', () => {
    // "Nothing is flipped" is not the same fact as "there are no instances", and
    // a blob carrying instances must still take the identity path when the set it
    // is handed is empty. ⚠️ NO PRODUCTION CALLER CAN PRODUCE THAT STATE ANY
    // MORE — see the block above.
    const instances = migrateLegacyToInstances(CS, engineRegistry)
    expect(instances.length, 'no instances — this case is vacuous').toBeGreaterThan(0)
    expect(csForPaneMargins(CS, instances, new Set())).toBe(CS)
    expect(csForPaneMargins(CS, instances, undefined)).toBe(CS)
    expect(csForPaneMargins(CS, instances, null)).toBe(CS)
  })

  it('produces margins DEEP-EQUAL to the legacy read, for a legacy-equivalent blob', () => {
    // THE GATE FOR ADJUDICATION A2. The projection is only allowed to exist
    // because it is provably the same answer.
    const instances = migrateLegacyToInstances(CS, engineRegistry)
    const flipped = new Set(['rsi', 'macd', 'atr'])
    const projected = csForPaneMargins(CS, instances, flipped)
    expect(projected, 'a projection that returned `cs` would make this vacuous').not.toBe(CS)
    expect(computePaneMargins(projected, true, new Set()))
      .toEqual(computePaneMargins(CS, true, new Set()))
    // …and with volume off, and with an overlay exclusion, because the margins
    // function branches on both.
    expect(computePaneMargins(projected, false, new Set()))
      .toEqual(computePaneMargins(CS, false, new Set()))
    expect(computePaneMargins(projected, true, new Set(['rsi'])))
      .toEqual(computePaneMargins(CS, true, new Set(['rsi'])))
  })

  // ⭐ B5 TASK 10 — WHAT THIS PROOF IS ABOUT, NOW THAT THERE ARE TWO MODES. It is
  // a `'bands'`-mode obligation, in full: `computePaneMargins` is what STACKS the
  // bands, and this projection is what feeds it the instance list. Under
  // `paneMode() === 'panes'` the bands are gone and the same obligation is
  // discharged by `paneLayout.test.js`'s own 512-subset identity — the one that
  // sweeps 1,024 configurations × every integer chart height and reproduces each
  // definition's `baseH` by READING `paneMargins.js`. Neither replaces the other:
  // this one says the projection cannot lie about which oscillators are ON, and
  // that one says the pane arithmetic reproduces the band arithmetic exactly.
  // ⛔ It does NOT rot at Flip C, because `'bands'` is still a live mode until
  // Task 12 flips the constant and `paneMargins.js` retires with it.
  it('…for ALL 512 subsets of the nine stacked panes, on both volume settings', () => {
    // The exhaustive form of the same claim. `computePaneMargins` is not linear
    // in its inputs — it proportionally squeezes, rounds each band to whole
    // hundredths, and then SHAVES the tallest band one hundredth at a time until
    // the stack fits under `MAX_STACK_C`. A projection that is right on a
    // three-indicator blob can still be wrong on the nine-indicator one that
    // enters the shave loop, and that loop is exactly where `1c1b84bf`'s 1,178
    // illegal layouts lived.
    //
    // Every id is FLIPPED here, so this is also the proof that the projection
    // reproduces the legacy answer for the whole `PANES` list and not just the
    // four pilots.
    const flipped = new Set(PANE_KEYS)
    let sawShave = false
    for (let mask = 0; mask < (1 << PANE_KEYS.length); mask++) {
      const indicators = {}
      PANE_KEYS.forEach((k, i) => { indicators[k] = { enabled: !!(mask & (1 << i)) } })
      const cs = { indicators }
      const projected = csForPaneMargins(cs, migrateLegacyToInstances(cs, engineRegistry), flipped)
      for (const hasVolume of [true, false]) {
        const legacy = computePaneMargins(cs, hasVolume, new Set())
        expect(computePaneMargins(projected, hasVolume, new Set()), `mask ${mask} vol ${hasVolume}`)
          .toEqual(legacy)
        // The stack the shave loop is about: main's `bottom` at the 0.69 ceiling.
        if (legacy.main.bottom >= 0.69) sawShave = true
      }
    }
    expect(sawShave, 'no subset reached the shave ceiling — the hard half went untested').toBe(true)
  })

  it('the key list this gate sweeps IS `paneMargins.js`\'s own', () => {
    // Non-vacuity for the case above. If `PANES` gained a key, the sweep would
    // silently stop being exhaustive; this fails instead. `main` is the residual
    // band, not a stacked one, and `volume` is driven by the `hasVolume`
    // argument rather than by `cs.indicators`.
    const all = {}
    for (const k of PANE_KEYS) all[k] = { enabled: true }
    const keys = Object.keys(computePaneMargins({ indicators: all }, true, new Set()))
    expect(new Set(keys)).toEqual(new Set([...PANE_KEYS, 'volume', 'main']))
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

  it('…and a blob with no `indicators` SECTION at all still gets one', () => {
    // `mergeChartSettings` always supplies the section, but `mergeSettingsOverride`
    // writes primitives through untouched and the `?instances=` route can hand
    // over a blob that only ever named instances. Reading `.rsi.enabled` off
    // `undefined` inside the paint is a blank chart via the ErrorBoundary.
    const projected = csForPaneMargins({}, [{ instanceId: 'x', defId: 'rsi', inputs: {} }], new Set(['rsi']))
    expect(projected.indicators.rsi.enabled).toBe(true)
    expect(computePaneMargins(projected, false, new Set()).rsi).toBeTruthy()
  })

  it('a legacy toggle with NO instance reserves NOTHING once flipped', () => {
    const cs = { indicators: { rsi: { enabled: true } } }
    const projected = csForPaneMargins(cs, [], new Set(['rsi']))
    expect(projected.indicators.rsi.enabled).toBe(false)
  })

  it('…and keeps that indicator\'s other settings — it rewrites ONE field', () => {
    // The projected blob is handed to `computePaneMargins` only today, but it is
    // a `cs` and the next reader will not know that. Dropping `period` here would
    // be a landmine for whoever passes it anywhere else.
    const cs = { indicators: { rsi: { enabled: true, period: 21, color: '#abcdef' } } }
    const projected = csForPaneMargins(cs, [], new Set(['rsi']))
    expect(projected.indicators.rsi).toEqual({ enabled: false, period: 21, color: '#abcdef' })
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

  it('⭐ …INCLUDING a tombstone that still carries its defId', () => {
    // ⛔ THE CASE THAT MAKES `if (tombstone) continue` LOAD-BEARING, added in B3
    // Task 10 after a mutation deleting that line SURVIVED the whole 1,557-test
    // chart selection.
    //
    // Every other tombstone fixture in this file is `{instanceId, deleted}` with
    // NO `defId` — which the very next line (`typeof inst.defId !== 'string'`)
    // already skips. So the guard was unobservable through all of them: it was
    // being credited for work the defId check was doing.
    //
    // ⚠️ THE SHIPPED CALL SITE CANNOT PRODUCE THIS SHAPE TODAY, and the guard is
    // still not decoration. `StockChart` hands this function an ALREADY-NORMALISED
    // list (tombstones dropped), and `mergeSettingsOverride` collapses a tombstone
    // to `instanceTombstone(id)` (defId stripped) — so the only producers are a
    // hand-written blob, a `?instances=` payload, and any future caller that
    // passes the RAW list, which is exactly what this module's docstring promises
    // to survive ("a malformed record is skipped, not raised"). A pure exported
    // function is tested against its own contract, not against the one caller it
    // happens to have.
    const cs = { indicators: { rsi: { enabled: true } } }
    const corpse = { instanceId: 'legacy:rsi', defId: 'rsi', inputs: { period: 14 }, deleted: true }
    expect(csForPaneMargins(cs, [corpse], new Set(['rsi'])).indicators.rsi.enabled,
      'a deleted instance reserved a band because it still knew its definition').toBe(false)
  })

  it('…and a tombstone does not cancel a LIVE instance of the same definition', () => {
    // Two instances of one definition is legal, so "this one is gone" cannot mean
    // "the definition is gone". A projection that took the LAST word would drop a
    // band out from under a line that is still on the chart.
    const cs = { indicators: { rsi: { enabled: false } } }
    const list = [{ instanceId: 'a', defId: 'rsi', inputs: {} }, { instanceId: 'b', deleted: true }]
    expect(csForPaneMargins(cs, list, new Set(['rsi'])).indicators.rsi.enabled).toBe(true)
  })

  it('touches ONLY flipped ids', () => {
    const cs = { indicators: { rsi: { enabled: true }, macd: { enabled: true } } }
    const projected = csForPaneMargins(cs, [], new Set(['rsi']))
    expect(projected.indicators.rsi.enabled).toBe(false)
    // ⚠️ ABOUT THE SET HANDED IN, NOT THE SHIPPED ONE. `macd` IS flipped in
    // production since Task 11; this function takes the flip set as an ARGUMENT
    // precisely so it can be interrogated without one, and the claim is that it
    // touches only what it is told to.
    expect(projected.indicators.macd.enabled,
      'the projection rewrote a definition that was not in the set it was handed').toBe(true)
  })

  it('never mutates the blob it was handed', () => {
    const cs = { indicators: { rsi: { enabled: true } } }
    const before = JSON.parse(JSON.stringify(cs))
    csForPaneMargins(cs, [], new Set(['rsi']))
    expect(cs).toEqual(before)
  })

  it('survives garbage in the instance list rather than taking the chart down', () => {
    // This runs inside the paint. `normalizeInstances` has usually already been
    // past, but the forced-VWAP instance StockChart manufactures has not, and a
    // throw here is a blank page through the ErrorBoundary.
    const cs = { indicators: { rsi: { enabled: false } } }
    const junk = [null, undefined, 'rsi', 42, [], { defId: 5 }, { noDefId: true },
      { instanceId: 'x', defId: 'rsi', inputs: {} }]
    expect(csForPaneMargins(cs, junk, new Set(['rsi'])).indicators.rsi.enabled).toBe(true)
    expect(csForPaneMargins(cs, 'not-an-array', new Set(['rsi'])).indicators.rsi.enabled).toBe(false)
    expect(csForPaneMargins(cs, undefined, new Set(['rsi'])).indicators.rsi.enabled).toBe(false)
  })

  it('a booby-trapped tombstone getter does not escape', () => {
    // `normalizeInstances` guards the same call for the same reason.
    const cs = { indicators: { rsi: { enabled: false } } }
    const bomb = { defId: 'rsi', get deleted() { throw new Error('boom') } }
    expect(() => csForPaneMargins(cs, [bomb], new Set(['rsi']))).not.toThrow()
  })

  it('a non-object `cs` is handed straight back', () => {
    expect(csForPaneMargins(null, [], new Set(['rsi']))).toBe(null)
    expect(csForPaneMargins(undefined, [], new Set(['rsi']))).toBe(undefined)
  })
})

// ─── B5 TASK 9 ─────────────────────────────────────────────────────────────
//
// ⛔⭐ THE HAZARD THIS EXISTS FOR, MEASURED IN THE FIRST CASE BELOW.
// `computePaneMargins` has FOUR call sites in `StockChart.jsx` and only ONE of
// them had the instance list in scope. The other three read the raw `cs` —
// `_mainMargins` (which feeds the CANDLE series' own `scaleMargins` at seven
// callers), the right-click region resolver, and the price-scale toggle's CSS
// `bottom`. They were correct only because `cs.indicators[id].enabled` was a
// write-through MIRROR of the instance list, and Task 9 DELETED that mirror.
//
// Handed a merged v2 blob, `computePaneMargins` now reserves NO bands at all:
// the candles' scaleMargins fill the whole pane and every oscillator is painted
// over. No series count sees it, and no test that mocks lightweight-charts sees
// it — it is the `autoScale:false` class of defect. This is the seam.
describe('csForPaneMarginsFromSettings — the bands survive the v1→v2 fold', () => {
  const V1 = (...on) => JSON.stringify({
    indicators: Object.fromEntries(PANE_KEYS.map(k => [k, { enabled: on.includes(k) }])),
  })

  it('⛔ the RAW merged blob reserves NO bands — the regression, measured first', () => {
    const cs = mergeChartSettings(JSON.parse(V1('rsi', 'macd', 'atr')))
    expect(Object.keys(cs.indicators), 'the mirror survived the fold — this case is vacuous')
      .toEqual(['volumeProfile'])
    const naive = computePaneMargins(cs, true, new Set())
    expect(naive.rsi, 'a raw `cs` still reserves a band — there is nothing to fix here')
      .toBeUndefined()
    expect(naive.main.bottom, 'the price pane did NOT take the whole height').toBe(0.15)
  })

  it('⭐ …and the projection puts them back, identically to the PRE-FOLD blob', () => {
    for (const on of [[], ['rsi'], ['rsi', 'macd'], ['obv', 'atr', 'adx', 'macd'],
      PANE_KEYS.slice()]) {
      const json = V1(...on)
      const cs = mergeChartSettings(JSON.parse(json))
      const projected = csForPaneMarginsFromSettings(cs, engineRegistry, ENGINE_FLIPPED_DEF_IDS)
      for (const hasVolume of [true, false]) {
        expect(computePaneMargins(projected, hasVolume, new Set()), `${on.join()} vol=${hasVolume}`)
          .toEqual(computePaneMargins(JSON.parse(json), hasVolume, new Set()))
      }
    }
  })

  it('⭐ and it agrees with the RENDER path’s own projection, on all 512 subsets', () => {
    // The render path builds `csMargins` from `engineInstances`; these three
    // sites build it from the blob. They must be the same answer for BANDS or
    // the candles and the oscillators disagree about where the stack starts.
    let differed = 0
    for (let mask = 0; mask < 512; mask++) {
      const on = PANE_KEYS.filter((_, i) => mask & (1 << i))
      const cs = mergeChartSettings(JSON.parse(V1(...on)))
      const fromBlob = csForPaneMarginsFromSettings(cs, engineRegistry, ENGINE_FLIPPED_DEF_IDS)
      const fromInstances = csForPaneMargins(cs, cs.indicatorInstances, ENGINE_FLIPPED_DEF_IDS)
      for (const hasVolume of [true, false]) {
        const a = computePaneMargins(fromBlob, hasVolume, new Set())
        const b = computePaneMargins(fromInstances, hasVolume, new Set())
        if (JSON.stringify(a) !== JSON.stringify(b)) differed++
      }
    }
    expect(differed, 'the blob-derived projection and the instance-derived one disagree').toBe(0)
    // …and the 512 subsets really are different stacks, or the zero above is a
    // loop comparing one empty answer to another 1,024 times.
    const distinct = new Set()
    for (let mask = 0; mask < 512; mask++) {
      const on = PANE_KEYS.filter((_, i) => mask & (1 << i))
      const cs = mergeChartSettings(JSON.parse(V1(...on)))
      distinct.add(JSON.stringify(computePaneMargins(
        csForPaneMarginsFromSettings(cs, engineRegistry, ENGINE_FLIPPED_DEF_IDS), true, new Set())))
    }
    expect(distinct.size, 'the 512 subsets collapsed to one layout').toBe(512)
  })

  it('⛔ an OVERRIDE-injected legacy section still reaches the bands', () => {
    // `mergeSettingsOverride` is NOT an allow-list — a grid cell's per-cell
    // override and the `?indicators=` render route can put a legacy section back
    // on an already-merged blob. The projection derives per read for exactly
    // this reason; taking the stored instance list alone would miss it.
    const cs = mergeChartSettings(JSON.parse('{}'))
    const withOverride = { ...cs, indicators: { ...cs.indicators, rsi: { enabled: true } } }
    const projected = csForPaneMarginsFromSettings(withOverride, engineRegistry, ENGINE_FLIPPED_DEF_IDS)
    expect(computePaneMargins(projected, true, new Set()).rsi,
      'an override-injected indicator reserves no band, so the engine draws it over volume')
      .toEqual({ top: 0.85, bottom: 0 })
  })

  it('never throws, and short-circuits on an empty flip set', () => {
    expect(csForPaneMarginsFromSettings(CS, engineRegistry, new Set())).toBe(CS)
    expect(csForPaneMarginsFromSettings(null, engineRegistry, ENGINE_FLIPPED_DEF_IDS)).toBe(null)
    // ⛔ THE DERIVATION IS WHAT THIS FUNCTION ADDS, so the derivation is what it
    // guards: it runs inside the paint, and a registry that throws is a missing
    // band rather than a blank chart through StockChart's ErrorBoundary.
    //
    // ⚠️ STATED, NOT ASSUMED: a booby-trapped getter on `cs` ITSELF still throws,
    // because `csForPaneMargins` spreads the blob and that module is CONSUMED,
    // not owned — its contract is unchanged and this wrapper does not widen it.
    const throwingRegistry = { getDefinition() { throw new Error('boom') },
      listDefinitions() { throw new Error('boom') } }
    expect(() => csForPaneMarginsFromSettings(CS, throwingRegistry, ENGINE_FLIPPED_DEF_IDS))
      .not.toThrow()
    expect(csForPaneMarginsFromSettings(CS, throwingRegistry, ENGINE_FLIPPED_DEF_IDS)
      .indicators.rsi.enabled, 'a registry that throws silently reserved a band').toBe(false)
    // …and the SAME call with the real registry does reserve one, so the `false`
    // above is the guard rather than a projection that never reserves anything.
    expect(csForPaneMarginsFromSettings(CS, engineRegistry, ENGINE_FLIPPED_DEF_IDS)
      .indicators.rsi.enabled).toBe(true)
  })
})
