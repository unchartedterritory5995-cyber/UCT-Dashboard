// app/src/components/chart/engine/__tests__/rsDefinitionV4.test.js
//
// ─── UCT RS Phase 3, unit 3-08 — the member-facing rsLine definition v4 ─────
//
// Engineering map 2026-11-08 §2 "3-08" (decisions D1-D8). What this file pins,
// against the REGISTERED definition (never a copy of it):
//
//   1. the server gate: with no declaration, or the v3 row's declaration (what
//      production serves until `RS_V3_ENABLED` is armed), every Phase 3 control,
//      option and preset is hidden and the six shipped presets still list; with
//      the v4 row's declaration everything shows;
//   2. `detectPreset` round trip for EVERY preset, from every other preset;
//   3. a saved v3 Trend layout reads as Trend (3-08b, the legacy `mapsTo`), and a
//      stored Reading wins over the legacy switch;
//   4. the chip under CUSTOM reads `UCT RS · SMH · 94`;
//   5. the pane label under each Reading;
//   6. each Reading's glance row prints under its view only, and in the muted
//      ink when the server sent a reason instead of a reading;
//   7. the readout actions (pick a date, reset it, open the Rotation view);
//   8. the member copy rules on every new card (D8, plan §3).
import { describe, it, expect } from 'vitest'
import * as engineRegistry from '../nativeRegistry'
import { getDefinition } from '../nativeRegistry'
import { readoutRows } from '../readoutSchema'
import { validateDefinition } from '../defSchema'
import { legendChips, readoutChipName, readoutFallbackValue, paneReadoutLabel, resolvedInputsOf } from '../readout'
import { planBindings } from '../pool'
import { mergeChartSettings } from '../../chartDefaults'
import { setIndicatorEnabled, findInstance, applyPresetInputs, detectPreset, presetsOf } from '../instanceControls'
import { legacyInstanceId } from '../instances'
import { fieldsForInstance, visiblePresets } from '../../indicatorRegistry'

const RS = getDefinition('rsLine')
const HONESTY = 'No published hit rate exists for this signal and UCT has not measured one yet.'

const V3_SERVER_INPUTS = ['benchmark', 'maLength', 'maType', 'lookback', 'priceTolerance', 'redDayThreshold',
  'showNewHigh', 'showNewHighBeforePrice', 'shortHistoryDots', 'mansfieldLength', 'showMansfield',
  'showRedDay', 'showNewLow']
const V3_MENU = ['SPY', 'RSP', 'SECTOR', 'QQQ', 'IWM', 'INDUSTRY']
/** 2026-11-12: the menu as the DEFINITION orders it (the dropdown's order), and
 *  the v4 row's full menu (sector and theme benchmarks added). */
const V3_SHOWN = ['SPY', 'RSP', 'QQQ', 'IWM', 'SECTOR', 'INDUSTRY']
const V4_MENU = ['SPY', 'RSP', 'QQQ', 'IWM', 'SECTOR', 'SECTOR_PICK', 'INDUSTRY', 'THEME', 'THEME_PICK', 'CUSTOM']
/** What `serverCompute.serverDeclares('rsLine')` reads from the live row. */
const V3_DECLARED = Object.freeze({ inputs: V3_SERVER_INPUTS, options: { benchmark: V3_MENU, maType: ['EMA', 'SMA'] } })
const V4_DECLARED = Object.freeze({
  inputs: RS.meta.serverInputs,
  // rev 5 (Deepvue round 2): the live row's `view` enum names the RS Rating Reading too
  options: { benchmark: V4_MENU, maType: ['EMA', 'SMA'], view: ['ratio', 'mansfield', 'rotation', 'quality', 'vars', 'rating'] },
})
const SHIPPED = ['classic', 'classicWeekly', 'phase', 'trend', 'trendWeekly', 'stress']
const PHASE3 = ['rotation', 'rotationWeekly', 'quality', 'volAdjusted']
const PHASE3_INPUTS = ['view', 'customBenchmark', 'sectorBenchmark', 'themeBenchmark', 'rrgRatioLength',
  'rrgMomentumLength', 'clenowWindow', 'clenowGapPct', 'atrLength', 'varsLookback', 'anchorDate']

describe('1 · the server gate', () => {
  const fieldKeys = (declared) => fieldsForInstance(RS, null, { declared }).all.map((f) => f.key)
  const benchOptions = (declared) => fieldsForInstance(RS, null, { declared }).all
    .find((f) => f.key === 'benchmark').options.map((o) => o[0])

  it('nothing declared and the v3 row: the six shipped presets list, no Phase 3 preset does', () => {
    for (const declared of [null, V3_DECLARED]) {
      expect(visiblePresets(RS, declared).map((p) => p.id)).toEqual(SHIPPED)
    }
  })

  it('the v4 row: all ten, in declared order', () => {
    expect(visiblePresets(RS, V4_DECLARED).map((p) => p.id)).toEqual([...SHIPPED, ...PHASE3])
    for (const id of PHASE3) expect(RS.meta.presets.find((p) => p.id === id).requiresServer, id).toBe(true)
  })

  it('a v4 row that does not list CUSTOM still lists every preset (none sets the benchmark)', () => {
    const noCustom = { ...V4_DECLARED, options: { ...V4_DECLARED.options, benchmark: V3_MENU } }
    expect(visiblePresets(RS, noCustom).map((p) => p.id)).toEqual([...SHIPPED, ...PHASE3])
    for (const p of RS.meta.presets) expect(p.inputs, p.id).not.toHaveProperty('benchmark')
  })

  // ⭐ 3-14: the legacy switch renders while its successor (`view`) is gated off —
  // on a v3 server it is the only control that draws Mansfield — and is replaced
  // by the Reading once the row declares `view`.
  it('every Phase 3 control and the "Your symbol" option are hidden until declared; the legacy switch shows only until the Reading does', () => {
    for (const declared of [null, V3_DECLARED]) {
      const keys = fieldKeys(declared)
      for (const k of PHASE3_INPUTS) expect(keys, k).not.toContain(k)
      expect(keys).toContain('showMansfield')
      expect(benchOptions(declared)).toEqual(V3_SHOWN)
    }
    const keys = fieldKeys(V4_DECLARED)
    for (const k of PHASE3_INPUTS) expect(keys, k).toContain(k)
    expect(keys).not.toContain('showMansfield')
    expect(benchOptions(V4_DECLARED)).toEqual(V4_MENU)
    expect(RS.inputs.find((i) => i.key === 'benchmark').options.at(-1)).toEqual(['CUSTOM', 'Your symbol', { requiresServer: true }])
  })

  it('the inputs, groups and text boxes are the ones the map names', () => {
    const input = (k) => RS.inputs.find((i) => i.key === k)
    expect(input('view')).toMatchObject({ type: 'enum', label: 'Reading', group: 'Simple', default: 'ratio', requiresServer: true })
    expect(input('view').options.map((o) => o[0])).toEqual(['ratio', 'mansfield', 'rotation', 'quality', 'vars', 'rating'])
    expect(input('customBenchmark')).toMatchObject({ type: 'string', group: 'Simple', default: '', requiresServer: true,
      activeWhen: { key: 'benchmark', equals: 'CUSTOM' }, pattern: '^[A-Z][A-Z.\\-]{0,9}$', maxLength: 10, case: 'upper',
      placeholder: 'SMH', hint: 'Letters, dots and dashes, up to 10' })
    expect(input('anchorDate')).toMatchObject({ type: 'string', group: 'Checks', default: '', requiresServer: true,
      pattern: '^\\d{4}-\\d{2}-\\d{2}$', tooltip: 'Blank uses the benchmark\'s lowest close of the last 20 sessions' })
    expect(RS.meta.groupsCollapsed).toEqual(expect.arrayContaining(['Method', 'Checks']))
    expect(RS.meta.serverInputs.slice(-PHASE3_INPUTS.length)).toEqual(PHASE3_INPUTS)
    // rev 5 since Deepvue round 2 (the RS Rating Reading); `rsRatingView.test.js` owns the rest of it
    expect(RS).toMatchObject({ version: 5, compute: { kind: 'server', fn: 'rsLine', rev: 5 } })
    expect(RS.placement).toMatchObject({ target: 'pane', ownScale: true })
  })
})

describe('2 · detectPreset round trip, every preset from every other preset', () => {
  const ID = legacyInstanceId('rsLine')
  const fresh = () => setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
  const apply = (cs, id) => applyPresetInputs(cs, ID, RS, RS.meta.presets.find((p) => p.id === id), engineRegistry)
  const defaults = Object.fromEntries(RS.inputs.map((i) => [i.key, i.default]))
  const values = (cs) => ({ ...defaults, ...(findInstance(cs, ID).inputs || {}) })
  const reads = (cs) => {
    const instance = findInstance(cs, ID)
    const hit = detectPreset(presetsOf(RS), values(cs), { instance, def: RS, cs })
    return hit ? hit.id : null
  }
  const ids = RS.meta.presets.map((p) => p.id)

  it('declares the ten presets', () => {
    expect(ids).toEqual([...SHIPPED, ...PHASE3])
  })

  for (const from of ids) {
    it(`after ${from}, every preset reads back as itself and sets the Reading it names`, () => {
      const base = apply(fresh(), from)
      expect(reads(base)).toBe(from)
      for (const to of ids) {
        const cs = apply(base, to)
        expect(reads(cs), `${from} → ${to}`).toBe(to)
        expect(values(cs).view, `${from} → ${to}`).toBe(RS.meta.presets.find((p) => p.id === to).inputs.view)
      }
    })
  }

  it('a fresh instance (no preset touched) reads Classic', () => {
    expect(reads(fresh())).toBe('classic')
  })

  it('each Phase 3 preset sets its Reading and its own lengths only (and Rotation the new-high lookback its weekly twin differs by)', () => {
    const by = Object.fromEntries(RS.meta.presets.map((p) => [p.id, p.inputs]))
    expect(by.rotation).toEqual({ view: 'rotation', rrgRatioLength: 10, rrgMomentumLength: 5, lookback: 252 })
    expect(by.rotationWeekly).toEqual({ view: 'rotation', rrgRatioLength: 10, rrgMomentumLength: 5, lookback: 52 })
    expect(by.quality).toEqual({ view: 'quality', clenowWindow: 90, clenowGapPct: 15 })
    expect(by.volAdjusted).toEqual({ view: 'vars', atrLength: 20, varsLookback: 60 })
  })
})

describe('3 · a saved v3 Trend layout', () => {
  // ⭐ UNIT 3-08b. A Trend instance saved by v3 carries `showMansfield: true` and
  // no `view`. The legacy switch declares `mapsTo` the Mansfield Reading, so
  // every reader (`legacyInputs.inputsAsRead`) reads it as `view: 'mansfield'`
  // while `view` is not stored: the zero guide binds, the Mansfield glance row
  // and pane value print, the picker reads Trend, and the fetch asks for the
  // Mansfield Reading. A member who then picks "RS line" stores `view: 'ratio'`,
  // and a stored Reading always wins. Nothing is written back to the instance.
  const ID = legacyInstanceId('rsLine')
  const savedTrend = Object.freeze({ maLength: 21, maType: 'EMA', lookback: 252, showMansfield: true, mansfieldLength: 200,
    mansfieldColor: '#6ba3be', dotCrossColor: '#6ba3be', showRedDay: false, showNewLow: false })
  const withInputs = (inputs) => {
    const cs = setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
    return { ...cs, indicatorInstances: cs.indicatorInstances.map((i) => (i.instanceId === ID
      ? { ...i, inputs, visibility: { preset: 'dailyUp' }, presentation: { plots: { dotMansfieldCross: { dotSize: 'medium' } } } }
      : i)) }
  }
  const registry = { getDefinition: (id) => (id === 'rsLine' ? RS : null) }
  const guideKeys = (inputs) => planBindings([{ instanceId: ID, defId: 'rsLine', inputs }], registry, null, {})
    .bind.flatMap((b) => (b.guides || []).map((g) => g.key))
  const glanceKeys = (inputs) => readoutRows(RS, PAYLOAD, { inputs }).filter((r) => !r.detailOf).map((r) => r.key)
  const presetOf = (cs) => {
    const instance = findInstance(cs, ID)
    return detectPreset(presetsOf(RS), resolvedInputsOf(RS, instance.inputs), { instance, def: RS, cs })?.id ?? null
  }

  it('the legacy switch declares its successor', () => {
    expect(RS.inputs.find((i) => i.key === 'showMansfield').mapsTo).toEqual({ when: true, key: 'view', value: 'mansfield' })
  })

  it('draws the Mansfield zero guide, prints the Mansfield glance row and pane value, and reads Trend', () => {
    const cs = withInputs(savedTrend)
    const instance = findInstance(cs, ID)
    expect(guideKeys(instance.inputs)).toEqual(['mansfieldZero'])
    expect(glanceKeys(instance.inputs)).toContain('mansfield')
    expect(readoutFallbackValue(RS, PAYLOAD, 4, instance.inputs)).toEqual({ text: '+18.7%', muted: false })
    expect(resolvedInputsOf(RS, instance.inputs).view).toBe('mansfield')
    expect(engineRegistry.resolveInputs(RS, instance.inputs).view).toBe('mansfield')
    expect(fieldsForInstance(RS, instance).values.view).toBe('mansfield')
    expect(presetOf(cs)).toBe('trend')
  })

  it('a stored Reading wins: showMansfield true with view ratio draws the RS line', () => {
    const cs = withInputs({ ...savedTrend, view: 'ratio' })
    const instance = findInstance(cs, ID)
    expect(guideKeys(instance.inputs)).toEqual([])
    expect(glanceKeys(instance.inputs)).not.toContain('mansfield')
    expect(readoutFallbackValue(RS, PAYLOAD, 4, instance.inputs)).toEqual({ text: '0.4187 · Nov 5', muted: true })
    expect(engineRegistry.resolveInputs(RS, instance.inputs).view).toBe('ratio')
    expect(fieldsForInstance(RS, instance).values.view).toBe('ratio')
    expect(presetOf(cs)).toBeNull()
  })

  it('an instance that never stored the switch, or stored it off, keeps the default Reading', () => {
    for (const inputs of [{}, { showMansfield: false }]) {
      expect(guideKeys(inputs), JSON.stringify(inputs)).toEqual([])
      expect(resolvedInputsOf(RS, inputs).view).toBe('ratio')
    }
  })

  it('reading it writes nothing back: the stored instance is unchanged after every reader ran', () => {
    const cs = withInputs(savedTrend)
    const before = JSON.stringify(cs.indicatorInstances)
    const instance = findInstance(cs, ID)
    guideKeys(instance.inputs)
    readoutRows(RS, PAYLOAD, { inputs: instance.inputs })
    readoutFallbackValue(RS, PAYLOAD, 4, instance.inputs)
    resolvedInputsOf(RS, instance.inputs)
    engineRegistry.resolveInputs(RS, instance.inputs)
    fieldsForInstance(RS, instance)
    presetOf(cs)
    legendChips([{ instanceId: ID, defId: 'rsLine', plotKey: 'rsLine', series: { __id: 'rs' }, lastValue: 0.2477 }],
      null, engineRegistry, cs.indicatorInstances, { scalarsOf: () => PAYLOAD })
    expect(JSON.stringify(cs.indicatorInstances)).toBe(before)
    expect(instance.inputs).toBe(savedTrend)
    expect(instance.inputs).not.toHaveProperty('view')
  })

  it('applying Trend again keeps it Trend, and Classic after that is Classic', () => {
    const cs = withInputs(savedTrend)
    const trend = applyPresetInputs(cs, ID, RS, RS.meta.presets.find((p) => p.id === 'trend'), engineRegistry)
    expect(presetOf(trend)).toBe('trend')
    const classic = applyPresetInputs(trend, ID, RS, RS.meta.presets.find((p) => p.id === 'classic'), engineRegistry)
    expect(presetOf(classic)).toBe('classic')
    expect(findInstance(classic, ID).inputs).toMatchObject({ view: 'ratio', showMansfield: false })
  })
})

describe('4 · the chip under "Your symbol"', () => {
  const b = { instanceId: 'inst:rsLine:1', defId: 'rsLine', plotKey: 'rsLine', series: { __id: 'rs' }, lastValue: 0.2477 }
  const inst = { instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs: { benchmark: 'CUSTOM', customBenchmark: 'SMH' }, hidden: false }
  const payload = { benchmark: { requested: 'CUSTOM', resolved: 'SMH', name: 'SMH', label: 'SMH', fallback: null, bars: 852 },
    rating: { ibd: 94, fast: 91, asof: '2026-11-05', summary: '94 · fast 91' } }

  it('reads `UCT RS · SMH · 94`, and the pane `UCT Relative Strength · SMH · 94`', () => {
    const chip = legendChips([b], null, engineRegistry, [inst], { scalarsOf: () => payload })[0]
    expect(chip.suffix).toBe(' · SMH · 94')
    expect(readoutChipName(chip, RS)).toBe('UCT RS · SMH · 94')
    expect(paneReadoutLabel(chip, RS, null)).toBe('UCT Relative Strength · SMH · 94')
  })

  it('the Benchmark card says what was asked for and what was used', () => {
    const rows = readoutRows(RS, payload, { inputs: inst.inputs })
    expect(rows.find((r) => r.key === 'benchmarkRequested').text).toBe('Your symbol')
    expect(rows.find((r) => r.key === 'benchmark').text).toBe('SMH')
  })
})

/** One payload carrying every v4 block, as the provider builds them (3-06). */
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', name: 'SPY', label: 'S&P 500 (SPY)', fallback: null, bars: 852 },
  legend: { summary: 'above its 21 EMA by 6.8%', asOf: 20261105, lastValue: 0.4187 },
  mansfield: { value: 18.71, summary: '+18.7%, above zero, falling' },
  rotation: { quadrant: 'Leading', ratio: 101.23, momentum: 100.42, inQuadrantBars: 6, asOf: '20261106', stale: false,
    summary: 'Leading, 6 weeks', reason: null },
  quality: { score: 0.6234, annualPct: 91.4, r2: 0.6821, gap: false, window: 90, gapPct: 15, asOf: '20261106',
    summary: 'Score 0.62, 91% a year, R² 0.68, no gap over 15%', reason: null },
  vars: { value: 3.4123, ma: 2.1, state: 1, stateWord: 'Strong, rising', lookback: 60, atrLength: 20, maLength: 50,
    asOf: '20261106', stale: false, summary: 'Strong, rising: +3.4 against SPY, above its 50-session average', reason: null },
  checks: { anchor: { pass: true, line: 'pass · stock +18.0%, SPY +6.0% since Oct 15', source: 'picked', date: '2026-10-15' },
    summary: '1 of 1 pass' },
})

describe('5 · the pane label under each Reading', () => {
  const label = (view, payload = PAYLOAD) => readoutFallbackValue(RS, payload, 4, { view })
  it('ratio: the dated last RS value, muted (the live value is the line itself)', () => {
    expect(label('ratio')).toEqual({ text: '0.4187 · Nov 5', muted: true })
  })
  it('mansfield, rotation, quality, vars: the reading the pane draws, live', () => {
    expect(label('mansfield')).toEqual({ text: '+18.7%', muted: false })
    expect(label('rotation')).toEqual({ text: 'Leading', muted: false })
    expect(label('quality')).toEqual({ text: '0.6234', muted: false })
    expect(label('vars')).toEqual({ text: '3.412', muted: false })
  })
  it('a reading the server could not make falls back to the dated RS value, muted', () => {
    const none = { ...PAYLOAD, rotation: { ...PAYLOAD.rotation, quadrant: null, reason: 'not read on intraday charts' } }
    expect(label('rotation', none)).toEqual({ text: '0.4187 · Nov 5', muted: true })
  })
})

describe('6 · each Reading prints its own glance row, muted when the server says why it has none', () => {
  const glance = (inputs, payload = PAYLOAD) => readoutRows(RS, payload, { inputs }).filter((r) => !r.detailOf)
  const VIEW_ROW = { mansfield: 'mansfield', rotation: 'rotation', quality: 'quality', vars: 'vars' }

  it('one view row at a time, in row 4, never under another view', () => {
    for (const view of ['ratio', 'mansfield', 'rotation', 'quality', 'vars']) {
      const keys = glance({ view }).map((r) => r.key)
      for (const [v, key] of Object.entries(VIEW_ROW)) expect(keys.includes(key), `${key} under ${view}`).toBe(v === view)
      if (VIEW_ROW[view]) expect(keys.indexOf(VIEW_ROW[view]), view).toBe(keys.indexOf('phase') + 1)
    }
  })

  it('the glance values are the server summaries, in the normal ink', () => {
    const text = (view, key) => glance({ view }).find((r) => r.key === key)
    expect(text('rotation', 'rotation')).toMatchObject({ label: 'Rotation', text: 'Leading, 6 weeks', muted: false })
    expect(text('quality', 'quality')).toMatchObject({ label: 'Quality', text: 'Score 0.62, 91% a year, R² 0.68, no gap over 15%', muted: false })
    expect(text('vars', 'vars')).toMatchObject({ label: 'Vol-adjusted',
      text: 'Strong, rising: +3.4 against SPY, above its 50-session average', muted: false })
  })

  it('a block with a reason prints that reason, MUTED, and never reaches the pane label', () => {
    const why = { ...PAYLOAD,
      rotation: { ...PAYLOAD.rotation, quadrant: null, summary: 'not read on intraday charts', reason: 'not read on intraday charts' },
      quality: { ...PAYLOAD.quality, score: null, summary: 'daily charts only', reason: 'daily charts only' },
      vars: { ...PAYLOAD.vars, value: null, summary: 'needs 80 bars of both (has 40)', reason: 'needs 80 bars of both (has 40)' } }
    expect(glance({ view: 'rotation' }, why).find((r) => r.key === 'rotation')).toMatchObject({ text: 'not read on intraday charts', muted: true })
    expect(glance({ view: 'quality' }, why).find((r) => r.key === 'quality')).toMatchObject({ text: 'daily charts only', muted: true })
    expect(glance({ view: 'vars' }, why).find((r) => r.key === 'vars')).toMatchObject({ text: 'needs 80 bars of both (has 40)', muted: true })
  })

  it('the numbers blocks', () => {
    const rows = (view) => readoutRows(RS, PAYLOAD, { inputs: { view } })
    const block = (view, key) => rows(view).filter((r) => r.detailOf === key).map((r) => [r.label, r.text])
    expect(block('rotation', 'rotation')).toEqual([['Quadrant', 'Leading'], ['RS-Ratio', '101.2'], ['RS-Momentum', '100.4'],
      ['Bars in quadrant', '6']])
    expect(block('quality', 'quality')).toEqual([['Score', '0.6234'], ['Yearly pace', '+91.4%'], ['Fit (R²)', '0.6821'],
      ['Gap in window', 'no'], ['Sessions', '90']])
    expect(block('vars', 'vars')).toEqual([['Value', '3.412'], ['Average', '2.1'], ['State', 'Strong, rising'],
      ['Sum (bars)', '60'], ['ATR (bars)', '20']])
  })

  it('defSchema refuses a muted gate that cannot be read', () => {
    const withMuted = (muted) => validateDefinition({ ...RS, readout: RS.readout.map((e) => (e.key === 'rotation' ? { ...e, muted } : e)) })
    expect(withMuted('scalar:rotation.reason').ok).toBe(true)
    expect(withMuted(true).ok).toBe(true)
    expect(withMuted('rotation reason').errors.join('\n')).toMatch(/readout\[\d+\]\.muted: .* expected a boolean or a readout gate/)
    expect(withMuted('input:nope').errors.join('\n')).toMatch(/\.muted: .*names no declared input/)
    expect(withMuted('input:view=rotaton').errors.join('\n')).toMatch(/\.muted: .*"rotaton" is not one of "view"'s option values/)
  })
})

describe('7 · the readout actions', () => {
  const rows = (inputs) => readoutRows(RS, PAYLOAD, { inputs })
  it('the anchor row offers a pick; a picked date prints its own row with a reset', () => {
    const blank = rows({})
    expect(blank.find((r) => r.key === 'checkAnchor')).toMatchObject({ label: 'Since anchor', detailOf: 'checks',
      action: { kind: 'pickDate', input: 'anchorDate' } })
    expect(blank.find((r) => r.key === 'checkAnchorPicked'), 'no picked date, no reset row').toBeUndefined()
    const picked = rows({ anchorDate: '2026-10-15' })
    expect(picked.find((r) => r.key === 'checkAnchorPicked')).toMatchObject({ label: 'Picked date', text: '2026-10-15',
      detailOf: 'checks', action: { kind: 'resetInput', input: 'anchorDate' } })
  })
  it('the Rotation row opens the Rotation view', () => {
    expect(rows({ view: 'rotation' }).find((r) => r.key === 'rotation').action).toEqual({ kind: 'openRotation' })
  })
})

describe('8 · the member copy on the three new cards (D8, plan §3)', () => {
  const card = (key) => RS.readout.find((e) => e.key === key).card
  const EMOJI = /\p{Extended_Pictographic}/u
  const BANNED = /\b(buy|sell|guarantee|elite|powerful|unlock alpha|institutional accumulation|leading indicator|crystal ball)\b/i

  it('every card ends with the honesty sentence, and only Quality carries a literature line (Quanterlab, tagged [V])', () => {
    for (const key of ['rotation', 'quality', 'vars']) expect(card(key).evidence.endsWith(HONESTY), key).toBe(true)
    expect(card('rotation').evidence).toBe(HONESTY)
    expect(card('vars').evidence).toBe(HONESTY)
    expect(card('quality').evidence).toMatch(/Quanterlab/)
    expect(card('quality').evidence).toMatch(/12\.0% a year against 7\.7%/)
    expect(card('quality').evidence).toMatch(/7\.5% against 13\.4%/)
    // a backtest never reads as a forecast for one stock (03-evidence.md, must-not-claim)
    expect(card('quality').evidence).toMatch(/not a forecast for this score on one stock/)
    // no card claims a measured hit rate it does not have
    for (const key of ['rotation', 'quality', 'vars']) expect(card(key).evidenceSource, key).toBeUndefined()
  })

  it('plain English: no emoji, no buy/sell, none of the banned words, and the RRG formula is called what it is', () => {
    const texts = ['rotation', 'quality', 'vars'].flatMap((k) => Object.values(card(k)))
    texts.push(...RS.meta.presets.flatMap((p) => [p.label, p.origin]))
    texts.push(...RS.inputs.filter((i) => PHASE3_INPUTS.includes(i.key)).flatMap((i) => [i.label, i.tooltip]))
    for (const t of texts.filter((x) => typeof x === 'string')) {
      expect(t, t).not.toMatch(EMOJI)
      expect(t, t).not.toMatch(BANNED)
    }
    expect(card('rotation').origin).toMatch(/proprietary/)
    expect(card('rotation').what).toMatch(/not a trading system/)
    expect(card('quality').origin).toMatch(/Commonly implemented with 90 trading days/)
  })

  it('the description names only what ships', () => {
    expect(RS.meta.description).toMatch(/Rotation/)
    expect(RS.meta.description).toMatch(/Quality/)
    expect(RS.meta.description).toMatch(/volatility-adjusted/)
    expect(RS.meta.description).not.toMatch(/rating pane|tour|RS Leaders/i)
  })
})

// ⭐ UCT RS 3-14 — a pane that drew nothing prints the server's note, not a dash.
describe('3-14 · the empty-pane label prints the benchmark note', () => {
  const NOTE = 'No XYZQ bars yet; they usually load within a minute'
  const noBars = { benchmark: { requested: 'CUSTOM', resolved: 'XYZQ', name: 'XYZQ', label: 'XYZQ', note: NOTE } }
  it('no value at all and a note: the note, muted, marked', () => {
    expect(readoutFallbackValue(RS, noBars, 4, { benchmark: 'CUSTOM', customBenchmark: 'XYZQ' }))
      .toEqual({ text: NOTE, muted: true, note: true })
  })
  it('no value and no note: the muted dash, as before', () => {
    expect(readoutFallbackValue(RS, { benchmark: { resolved: 'SPY', name: 'SPY', label: 'SPY' } }, 4, {})).toEqual({ text: '—', muted: true })
    expect(readoutFallbackValue(RS, null, 4, {})).toEqual({ text: '—', muted: true })
  })
  it('a last value wins over the note (a benchmark gap prints the dated value)', () => {
    const gap = { ...noBars, legend: { lastValue: 0.4187, asOf: 20261105 } }
    expect(readoutFallbackValue(RS, gap, 4, {})).toEqual({ text: '0.4187 · Nov 5', muted: true })
  })
})


// ⭐ UCT RS 3-14 — the inspector's label column: 'Momentum (bars)' wrapped to two
// lines (sandbox capture v3on_desktop_dark_inspector_method), while 'Momentum
// style' (the same column, the Plot style row) fits on one.
describe('3-14 · the Rotation momentum length label fits its column', () => {
  it('reads "Momentum bars", no longer than the style row that fits', () => {
    const label = RS.inputs.find((i) => i.key === 'rrgMomentumLength').label
    expect(label).toBe('Momentum bars')
    expect(label.length).toBeLessThanOrEqual('Momentum style'.length)
  })
})
