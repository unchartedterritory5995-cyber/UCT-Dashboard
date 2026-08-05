// ─── v1 → v2: THE SETTINGS BLOB STOPS ENUMERATING INDICATORS ────────────────
//
// ⭐ THE ONE TASK IN B5 THAT TOUCHES A REAL USER'S STORED DATA. Every other flip
// changed which code drew a line; this changes what is IN the blob those lines
// are drawn from. `chart_settings` is a JSON string in `user_preferences`,
// written months before the engine existed, and after this commit it is read
// through a migration that runs ONCE, at read time, and writes nothing.
//
// ⛔ EVERY FIXTURE HERE IS A JSON *STRING*. Record §6's R3, verbatim: *a fixture
// built as an object skips the step that is being migrated.* `mergeChartSettings`
// accepts either, and an object literal typed with the shape the migration
// PRODUCES would pass a test the migration never ran for.
//
// ⚠️ WHAT "A JULY BLOB DOES" MEANS HERE, AND IT IS MEASURED IN EVERY CASE:
// every indicator that was on is still on, with the same period / colour /
// opacity / line style, in the shipped stack order, and NO key the user deleted
// comes back. The user does nothing — no reset, no re-tick, no re-login.

import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { CHART_DEFAULTS, mergeChartSettings, mergeSettingsOverride } from '../../chartDefaults'
import { migrateLegacyToInstances, SHIPPED_STACK_ORDER } from '../instances'
import * as engineRegistry from '../nativeRegistry'
import { computePaneMargins } from '../../paneMargins'

/** The repo root — same walk `enumerationSites.test.js` uses, and it THROWS BY
 *  NAME rather than returning a path that does not exist, because the Task-12
 *  coupling below is asserted with `existsSync`. */
const ROOT = (() => {
  let dir = process.cwd()
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'app', 'src', 'components', 'StockChart.jsx'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error(`settingsBlobMigration: could not find the repo root from ${process.cwd()}`)
})()

// A trimmed capture of the shape `ChartsWorkspace.jsx` froze in July, with three
// indicators ON and one explicitly OFF. No `settingsVersion`, no
// `indicatorInstances`, no `engineEnabled` — the engine did not exist.
const JULY = '{"chartType":"candles","indicators":{"rsi":{"enabled":true,"period":7,"color":"#7b68ee"},'
  + '"stoch":{"enabled":true,"kPeriod":14},"macd":{"enabled":false}},"overlays":[]}'

describe('a blob written before the engine existed', () => {
  it('folds every enabled indicator into an instance, with its stored inputs', () => {
    const cs = mergeChartSettings(JSON.parse(JULY))
    expect(cs.settingsVersion).toBe(2)
    // ⚠️ THE BRIEF WROTE `['stoch', 'rsi']` HERE AND IT CONTRADICTED ITS OWN NEXT
    // CASE (`['obv','rsi','stoch','atr'] → ['rsi','stoch','atr','obv']`). Both are
    // moot: the fold seeds in REGISTRY order, for the pixel-gate reason two cases
    // down — and registry order puts `rsi` before `stoch` here too.
    expect(cs.indicatorInstances.map(i => i.defId)).toEqual(['rsi', 'stoch'])
    expect(cs.indicatorInstances.find(i => i.defId === 'rsi').inputs)
      .toMatchObject({ period: 7, color: '#7b68ee' })
    // macd was OFF and stays off: no instance, no tombstone, nothing.
    expect(cs.indicatorInstances.some(i => i.defId === 'macd')).toBe(false)
  })

  // ⛔⭐⭐ THE SHIPPED STACK ORDER IS RECORDED, NOT APPLIED — AND THE PIXEL GATE IS
  // WHY. This case was written as *"the instance ORDER is the shipped stack
  // order, so nobody's panes reorder"* (⭐ Plan A5: `PANES` stacks bottom-to-top
  // obv,atr,adx,macd,cci,williamsR,mfi,stoch,rsi, so pane order is that list
  // reversed), with the fold emitting `SHIPPED_STACK_ORDER`. It is the right
  // ORDER and the wrong PLACE, and the gate said so:
  //
  //   `engine_three_bands_stacked` — 5/5 runs, **0 changed pixels**, 🔴 FAIL
  //     panes[0].series[2].scaleId: 'cci' -> 'williamsR'
  //     panes[0].series[3].scaleId: 'williamsR' -> 'cci'
  //
  // The instance list is ALSO the order the binder calls `addSeries` in, and
  // INSERTION ORDER IS Z-ORDER. Three oscillators in disjoint bands cannot
  // overlap, so the pixel number is 0 — and "0 px with a manifest GEOMETRY
  // change" is the one shape this gate treats as a lie by construction; no
  // declaration waves geometry through. B5 Task 8 rejected a plot-reorder probe
  // for the same reason.
  //
  // ⭐ SO THE ORDER LIVES IN `SHIPPED_STACK_ORDER` — derived from
  // `computePaneMargins`, measured by the case two down — and **Flip C applies
  // it** in `paneLayout.orderedPaneKeys`, where it decides PANE order rather than
  // insertion order. That is the point at which the two stop being one list.
  it('seeds in REGISTRY order — the binder\'s insertion order, unchanged', () => {
    // ⛔ THE SET MUST DISCRIMINATE, AND THE OBVIOUS ONE DOES NOT. A mutation that
    // sorts by `SHIPPED_STACK_ORDER` SURVIVED this case while it used the brief's
    // `['obv','rsi','stoch','atr']` — registry order and stack order agree on
    // those four (rsi, stoch, atr, obv either way), so the case could not see the
    // change it exists to refuse. `macd` and `stoch` are where the two disagree.
    const registryOrder = engineRegistry.listDefinitions().map(d => d.id)
    const ids = ['obv', 'rsi', 'stoch', 'atr', 'macd', 'cci']
    const many = JSON.stringify({ indicators: Object.fromEntries(
      ids.map(k => [k, { enabled: true }])) })
    const byRegistry = [...ids].sort((a, b) => registryOrder.indexOf(a) - registryOrder.indexOf(b))
    const byStack = [...ids].sort((a, b) => SHIPPED_STACK_ORDER.indexOf(a) - SHIPPED_STACK_ORDER.indexOf(b))
    expect(byRegistry, 'the fixture set cannot tell the two orders apart — pick another')
      .not.toEqual(byStack)
    expect(mergeChartSettings(JSON.parse(many)).indicatorInstances.map(i => i.defId))
      .toEqual(byRegistry)
  })

  it('⛔ …and SHIPPED_STACK_ORDER is a DIFFERENT order, which is why it is a record', () => {
    // If the two agreed, the revert above would have been unnecessary and Task
    // 12's hand-off a no-op. They do not agree, and `macd` is where they disagree
    // most: sixth in the registry, sixth-from-the-TOP in the stack.
    const registryOrder = engineRegistry.listDefinitions().map(d => d.id)
    expect(SHIPPED_STACK_ORDER,
      'the record collapsed onto registry order — then Flip C has nothing to apply')
      .not.toEqual(registryOrder)
    expect(SHIPPED_STACK_ORDER.indexOf('stoch')).toBeLessThan(SHIPPED_STACK_ORDER.indexOf('macd'))
    expect(registryOrder.indexOf('macd')).toBeLessThan(registryOrder.indexOf('stoch'))
    // …and the fold really does emit the OTHER one, stated here rather than left
    // for a reader to infer.
    const blob = JSON.stringify({ indicators: Object.fromEntries(
      ['macd', 'stoch'].map(k => [k, { enabled: true }])) })
    expect(mergeChartSettings(JSON.parse(blob)).indicatorInstances.map(i => i.defId))
      .toEqual(['macd', 'stoch'])
  })

  it('⛔ the seed order is READ OUT of computePaneMargins, not transcribed', () => {
    // The non-vacuity control for the literal above: `SHIPPED_STACK_ORDER`'s nine
    // pane ids must equal the bands `computePaneMargins` hands back for a blob
    // with all nine on, reversed (it stacks bottom-to-top; panes index
    // top-to-bottom). A hand-typed table that drifts from the layout function is
    // exactly the defect this phase keeps finding.
    const paneIds = engineRegistry.listDefinitions()
      .filter(d => d.placement.target === 'pane').map(d => d.id)
    const bands = computePaneMargins(
      { indicators: Object.fromEntries(paneIds.map(id => [id, { enabled: true }])) }, false, new Set())
    const fromLayout = Object.keys(bands).filter(k => k !== 'main' && k !== 'volume').reverse()
    expect(fromLayout, 'the layout function stacks nothing — this control is vacuous').toHaveLength(9)
    expect(SHIPPED_STACK_ORDER.slice(0, 9)).toEqual(fromLayout)
    // …and the tail is the price overlays, in registry order, which is legacy
    // z-order for the five of them (`instanceControls.registryRank`).
    expect(SHIPPED_STACK_ORDER.slice(9)).toEqual(['bb', 'vwap', 'sar', 'ichimoku', 'donchian'])
  })

  it('runs ONCE — a v2 blob is passed through untouched, by identity', () => {
    const once = mergeChartSettings(JSON.parse(JULY))
    const twice = mergeChartSettings(JSON.parse(JSON.stringify(once)))
    expect(twice.indicatorInstances).toEqual(once.indicatorInstances)
    // The R2 hazard: a preset writing settingsVersion 1 would make the migrator
    // re-run forever and re-seed instances the user has since deleted.
    expect(twice.settingsVersion).toBe(2)
  })

  it('a v2 blob whose instances were DELETED stays deleted', () => {
    // The failure this rules out is the one that makes a migration hated: the
    // user removes RSI, the migrator sees `indicators.rsi.enabled` still true in
    // some stale copy, and puts it back on every load.
    const cs = mergeChartSettings(JSON.parse(
      '{"settingsVersion":2,"indicatorInstances":[],"indicators":{"rsi":{"enabled":true}}}'))
    expect(cs.indicatorInstances).toEqual([])
  })

  it('…and a v1 blob\'s TOMBSTONE survives the fold, which is the same claim at v1', () => {
    // The pre-v2 half of the rule above. A user who deleted RSI through a control
    // that already existed has a tombstone and a still-true legacy toggle — the
    // toggle is what the pre-B3 renderer read, so deleting never cleared it.
    const cs = mergeChartSettings(JSON.parse(
      '{"indicatorInstances":[{"instanceId":"legacy:rsi","deleted":true}],'
      + '"indicators":{"rsi":{"enabled":true},"atr":{"enabled":true}}}'))
    expect(cs.indicatorInstances.filter(i => i.defId === 'rsi'), 'the fold resurrected a deleted RSI')
      .toEqual([])
    expect(cs.indicatorInstances.some(i => i.instanceId === 'legacy:rsi' && i.deleted === true),
      'the tombstone was destroyed by the fold, so the next read resurrects RSI').toBe(true)
    // …and the indicator that was NOT deleted still folds, so the case is not
    // passing because the fold did nothing at all.
    expect(cs.indicatorInstances.some(i => i.defId === 'atr')).toBe(true)
  })

  it('🐛 …and a CUSTOM-ID instance is not seeded a second time by its own toggle', () => {
    // The §6.1 double-draw, in its most permanent form. `migrateLegacyToInstances`
    // reserves ids PER INSTANCE ID, so a stored instance under any id other than
    // `legacy:rsi` does not stop the toggle projecting a second one — and unlike
    // the render-time version of this bug the answer here is WRITTEN BACK at
    // version 2 and never re-migrated. `?instances=` links, grid-cell overrides
    // and share links all produce this shape.
    const cs = mergeChartSettings(JSON.parse(
      '{"indicatorInstances":[{"instanceId":"grid-cell-3:rsi","defId":"rsi","inputs":{"period":21}}],'
      + '"indicators":{"rsi":{"enabled":true,"period":14}}}'))
    expect(cs.indicatorInstances.filter(i => i.defId === 'rsi'),
      'the fold seeded a SECOND rsi over the stored one — two lines, forever').toHaveLength(1)
    expect(cs.indicatorInstances[0].instanceId).toBe('grid-cell-3:rsi')
    expect(cs.indicatorInstances[0].inputs, 'the stored instance lost to the projection')
      .toEqual({ period: 21 })
    // …and a HIDDEN one counts as drawn too (it owns the definition), while a
    // DIFFERENT definition's toggle still seeds normally — so the rule is
    // per-definition rather than "any stored instance stops the whole fold".
    const cs2 = mergeChartSettings(JSON.parse(
      '{"indicatorInstances":[{"instanceId":"x:rsi","defId":"rsi","inputs":{},"hidden":true}],'
      + '"indicators":{"rsi":{"enabled":true},"atr":{"enabled":true}}}'))
    expect(cs2.indicatorInstances.filter(i => i.defId === 'rsi')).toHaveLength(1)
    expect(cs2.indicatorInstances.filter(i => i.defId === 'atr')).toHaveLength(1)
  })

  it('volumeProfile survives, because it has no definition and never will', () => {
    const cs = mergeChartSettings(JSON.parse('{"indicators":{"volumeProfile":{"enabled":true,"bins":24}}}'))
    expect(cs.indicators.volumeProfile).toMatchObject({ enabled: true, bins: 24 })
    expect(Object.keys(cs.indicators)).toEqual(['volumeProfile'])
    expect(cs.indicatorInstances.some(i => i.defId === 'volumeProfile')).toBe(false)
    // ⛔ AND AT THE LEVEL THE CLAIM IS MADE, WHICH IS THE MIGRATOR ITSELF. A
    // mutation that stopped it skipping a key with no definition SURVIVED the
    // line above: the fold runs `normalizeInstances` afterwards, which DROPS an
    // instance naming no definition, so the emitted-and-dropped path and the
    // skipped path look identical from outside `mergeChartSettings`. They are
    // not the same: `normalizeInstances` reports a drop as a FINDING, i.e. a
    // validation failure shown to a user who did nothing wrong.
    expect(migrateLegacyToInstances(
      { indicators: { volumeProfile: { enabled: true }, rsi: { enabled: true } } }, engineRegistry,
    ).map(i => i.defId), 'the migrator EMITTED a carved-out key for validation to drop')
      .toEqual(['rsi'])
    // The control that the migrator ran at all:
    expect(mergeChartSettings(JSON.parse('{"indicators":{"rsi":{"enabled":true}}}'))
      .indicatorInstances).toHaveLength(1)
  })

  it('and CHART_DEFAULTS.indicators is one key, not fifteen', () => {
    expect(Object.keys(CHART_DEFAULTS.indicators)).toEqual(['volumeProfile'])
  })

  it('⭐ a JULY BLOB, END TO END — everything on stays on, with its own settings', () => {
    // The sentence the report has to be able to make, measured rather than
    // argued. Six indicators, each with a stored input the DEFAULT is not, plus a
    // colour, an opacity and a line style — the four shapes a fold can silently
    // drop.
    const blob = JSON.stringify({
      chartType: 'candles',
      indicators: {
        rsi: { enabled: true, period: 7, color: '#ff0000' },
        macd: { enabled: true, fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 },
        stoch: { enabled: true, kPeriod: 21, dPeriod: 5 },
        atr: { enabled: true, period: 21 },
        bb: { enabled: true, period: 30, stdDev: 3 },
        vwap: { enabled: true, color: '#26C6DA', opacity: 40, lineStyle: 'dashed', lineWidth: 2 },
        adx: { enabled: false, period: 14 },
      },
    })
    const cs = mergeChartSettings(JSON.parse(blob))
    const byDef = Object.fromEntries(cs.indicatorInstances.map(i => [i.defId, i]))
    expect(Object.keys(byDef).sort(), 'an indicator that was ON did not survive the fold')
      .toEqual(['atr', 'bb', 'macd', 'rsi', 'stoch', 'vwap'])
    expect(byDef.rsi.inputs).toEqual({ period: 7, color: '#ff0000' })
    expect(byDef.macd.inputs).toMatchObject({ fastPeriod: 5, slowPeriod: 35, signalPeriod: 4 })
    expect(byDef.stoch.inputs).toMatchObject({ kPeriod: 21, dPeriod: 5 })
    expect(byDef.atr.inputs).toMatchObject({ period: 21 })
    expect(byDef.bb.inputs).toMatchObject({ period: 30, stdDev: 3 })
    expect(byDef.vwap.inputs, 'opacity and line style are the two a plot cannot express')
      .toMatchObject({ color: '#26C6DA', opacity: 40, lineStyle: 'dashed', lineWidth: 2 })
    // The one that was OFF is absent, not hidden and not tombstoned.
    expect(byDef.adx).toBeUndefined()
    // …and the order is REGISTRY order, which is the binder's insertion order and
    // therefore z-order. See the two cases at the top of this file for the
    // measurement that decided it.
    expect(cs.indicatorInstances.map(i => i.defId))
      .toEqual(['rsi', 'macd', 'bb', 'vwap', 'stoch', 'atr'])
    // ⛔ AND `enabled` IS NOT AN INPUT. It is what the instance's EXISTENCE means;
    // carried into `inputs` it would fail `validateInstance` and the whole
    // instance would be DROPPED — the indicator vanishes rather than moves.
    for (const inst of cs.indicatorInstances) expect(inst.inputs).not.toHaveProperty('enabled')
  })

  it('⭐ …and the fold is IDEMPOTENT through a real save → load round trip', () => {
    // What actually happens to a user: the blob is read, the app writes it back
    // (any settings change re-serialises the whole thing), and it is read again.
    const first = mergeChartSettings(JSON.parse(JULY))
    const stored = JSON.stringify(first)
    const second = mergeChartSettings(JSON.parse(stored))
    expect(second.indicatorInstances).toEqual(first.indicatorInstances)
    expect(second.indicators).toEqual(first.indicators)
    expect(second.settingsVersion).toBe(2)
  })

  it('⭐ a SHORT/LEGACY overlays array still pads, and the fold does not touch it', () => {
    // Positional merge + padding, from a JSON STRING. A short stored array means
    // DEFAULTS FOR THE MISSING TAIL, never deletions — and the fold runs beside
    // it, so a migration that rebuilt `overlays` from anything would show here.
    const cs = mergeChartSettings(JSON.parse(JSON.stringify({
      overlays: [
        { enabled: true, type: 'EMA', period: 9, color: '#4ade80' },
        { enabled: false, type: 'EMA', period: 20, color: '#f472b6' },
      ],
      indicators: { rsi: { enabled: true, period: 7 } },
    })))
    expect(cs.overlays).toHaveLength(CHART_DEFAULTS.overlays.length)
    expect(cs.overlays.slice(0, 2).map(o => o.enabled)).toEqual([true, false])
    expect(cs.overlays.slice(2).map(o => o.enabled), 'a short array DELETED the tail')
      .toEqual(CHART_DEFAULTS.overlays.slice(2).map(o => o.enabled))
    expect(cs.overlays[4]).toEqual(CHART_DEFAULTS.overlays[4])
    expect(cs.indicatorInstances.map(i => i.defId)).toEqual(['rsi'])
  })

  it('⛔ the fold reads the STORED section, not the allow-list\'s output', () => {
    // The bug this rules out is a one-line ordering mistake with no other symptom:
    // fold from `out.indicators` (which is `{volumeProfile}` by then) and EVERY
    // user silently loses every indicator, with `settingsVersion: 2` stamped on
    // the way out so it can never be retried.
    const cs = mergeChartSettings(JSON.parse('{"indicators":{"rsi":{"enabled":true,"period":7}}}'))
    expect(cs.indicatorInstances, 'the fold read the post-allow-list object').toHaveLength(1)
    expect(cs.indicators.rsi, 'and the allow-list still destroys the mirror').toBeUndefined()
  })

  it('⛔ a malformed `indicators` is not a crash and not a wipe', () => {
    for (const junk of ['{"indicators":null}', '{"indicators":[]}', '{"indicators":"rsi"}',
      '{"indicators":{"rsi":null}}', '{"indicators":{"rsi":{"enabled":"yes"}}}']) {
      const cs = mergeChartSettings(JSON.parse(junk))
      expect(cs.settingsVersion, junk).toBe(2)
      expect(cs.indicatorInstances, junk).toEqual([])
      expect(Object.keys(cs.indicators), junk).toEqual(['volumeProfile'])
    }
  })

  // ⏭️ TASK 12: `SHIPPED_STACK_ORDER` is derived from `computePaneMargins`, which
  // Flip C retires along with `paneMargins.js`. When that file goes, INLINE the
  // array this produces — do not re-derive it from something else, because at
  // that moment the shipped stack order stops existing and the seeded instance
  // order becomes the only record of it.
  //
  // ⚠️ A DATED COUPLING BETWEEN TWO TASKS, WRITTEN AS A TEST rather than as a
  // comment, so Task 12 gets a red assertion instead of a silent import of a
  // deleted module.
  it('⏭️ paneMargins.js still exists — Task 12 must inline the order before deleting it', () => {
    expect(fs.existsSync(path.join(ROOT, 'app/src/components/chart/paneMargins.js')),
      'paneMargins.js is gone and `instances.js` still derives SHIPPED_STACK_ORDER from it. '
      + 'Inline the array (it is in this test\'s expectations) and delete the import.').toBe(true)
    expect(SHIPPED_STACK_ORDER).toEqual([
      'rsi', 'stoch', 'mfi', 'williamsR', 'cci', 'macd', 'adx', 'atr', 'obv',
      'bb', 'vwap', 'sar', 'ichimoku', 'donchian',
    ])
    // ⛔ AND IT IS NOT APPLIED ANYWHERE YET — stated so Task 12 knows it has work
    // to do rather than a guarantee already in place. The fold seeds in REGISTRY
    // order (which is the binder's insertion order, i.e. z-order); Flip C is
    // where this array becomes PANE order, in `paneLayout.orderedPaneKeys`.
    const blob = JSON.stringify({ indicators: Object.fromEntries(
      ['mfi', 'cci', 'williamsR'].map(k => [k, { enabled: true }])) })
    expect(mergeChartSettings(JSON.parse(blob)).indicatorInstances.map(i => i.defId),
      'the fold applies the stack order now — re-run the pixel gate, it moves GEOMETRY '
      + '(engine_three_bands_stacked, 0 px, series[2]/series[3] scaleId swap)')
      .toEqual(['mfi', 'cci', 'williamsR'])
  })
})

describe('the allow-list, asserted by what it DESTROYS', () => {
  it('has one indicator line — a v2 blob carrying `indicators.rsi` loses it', () => {
    // A hard allow-list destroys unknown keys. That is the behaviour, so assert
    // the behaviour: the source-text version of this claim cannot tell a deleted
    // line from a renamed one, and it is how `indicatorInstances` nearly died in
    // B1 — a key absent from the return is dropped on EVERY read.
    const cs = mergeChartSettings(JSON.parse('{"settingsVersion":2,"indicators":{"rsi":{"enabled":true}}}'))
    expect(cs.indicators.rsi).toBeUndefined()
    expect(Object.keys(cs.indicators)).toEqual(['volumeProfile'])
  })

  it('…and it destroys all fourteen, not just the one the case above names', () => {
    const all = Object.fromEntries(
      engineRegistry.listDefinitions().map(d => [d.id, { enabled: true, period: 99 }]))
    const cs = mergeChartSettings(JSON.parse(JSON.stringify({ settingsVersion: 2, indicators: all })))
    expect(Object.keys(cs.indicators)).toEqual(['volumeProfile'])
    // …and the fixture really did name fourteen, so the empty answer is a
    // destruction rather than an empty input.
    expect(Object.keys(all)).toHaveLength(14)
  })

  it('⛔ mergeSettingsOverride still passes a legacy section through UNTOUCHED', () => {
    // THE ONE READER LEFT. `pages/ChartRender.jsx`'s `?indicators=` route and a
    // grid cell's `settingsOverride` merge a PARTIAL legacy blob over an
    // already-merged base, and `mergeSettingsOverride` is NOT an allow-list — it
    // is the reason `isIndicatorEnabled`'s legacy-mirror rule still has a live
    // subject after this commit, and the reason the pane-margin projection has to
    // be re-derived per read rather than taken from the stored instance list.
    const base = mergeChartSettings(JSON.parse('{}'))
    const over = mergeSettingsOverride(base, { indicators: { rsi: { enabled: true, period: 5 } } })
    expect(over.indicators.rsi, 'the override lane lost its legacy section')
      .toMatchObject({ enabled: true, period: 5 })
    expect(migrateLegacyToInstances(over, engineRegistry).map(i => i.defId),
      'an override-injected legacy toggle no longer reaches the chart').toEqual(['rsi'])
  })
})
