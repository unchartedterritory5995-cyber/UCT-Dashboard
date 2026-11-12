// app/src/components/chart/engine/__tests__/rsPresets.test.js
//
// ─── UCT RS Phase 2a VISUAL ROUND, unit VA2 — the definition half ───────────
//
// Spec: phase2a-visual-spec.md items A1 (glance list + `detailOf`), A2 (Mansfield
// view), A3 (the red-day mark), A4 (`placement.axis`), A6 (`plots[].restyle`,
// labels), A9 (names and copy). Every acceptance check a definition can answer
// without a browser is asserted here; the pixels are the surfaces' units.
//
// The payload below is shaped like the VA1 server (the contract's summary
// strings), because that is what the glance rows read.
import { describe, it, expect } from 'vitest'
import * as engineRegistry from '../nativeRegistry'
import { getDefinition, listDefinitions } from '../nativeRegistry'
import { readoutRows, readoutChipRows, isGlanceRow, READOUT_ENTRY_FIELDS } from '../readoutSchema'
import { validateDefinition, PLACEMENT_AXIS_MODES } from '../defSchema'
import { legendChips, paneReadoutLabel } from '../readout'
import { mergeChartSettings } from '../../chartDefaults'
import { setIndicatorEnabled, findInstance, applyPresetInputs, detectPreset, presetsOf } from '../instanceControls'
import { legacyInstanceId } from '../instances'
import { evalActiveWhen } from '../../indicatorRegistry'

const RS = getDefinition('rsLine')
const RS_INFO = '#6ba3be'
const RS_GOLD = '#c9a84c'
const RS_NEUTRAL = '#8a8574'

const GLANCE = ['benchmarkName', 'ratingSummary', 'phase', 'mansfield', 'rotation', 'quality', 'vars', 'ratingView', 'rsHigh',
  'sensitivity', 'regime', 'checks', 'shortHistory']

/** NVDA against SPY on a daily chart, as the VA1 provider builds it. */
const PAYLOAD = Object.freeze({
  benchmark: { requested: 'SPY', resolved: 'SPY', label: 'S&P 500 (SPY)', fallback: null, bars: 852 },
  legend: { pctFromMa: 6.84, maSlope: 1, above: true, summary: 'above its 21 EMA by 6.8%', asOf: 20261105, lastValue: 0.4187 },
  lastRsHigh: { index: 850, time: 20261104, beforePrice: true, redDay: true, barsAgo: 1, summary: '1 bar ago · before price · red day' },
  history: { bars: 852, requested: 852, short: false },
  rating: { ibd: 94, fast: 91, asof: '2026-11-05', summary: '94 · fast 91' },
  mansfield: { value: 18.71, aboveZero: true, state: 0, stateLabel: 'neutral', crossBarsAgo: 57, length: 200, lengthText: '200 bars', lastCross: 'up, 57 bars ago',
    summary: '+18.7%, above zero, falling' },
  regime: { label: 'persistence', pctFrom200: 4.1, return2y: 38.2, volTercile: 'low', reason: null },
  sensitivity: { spy: { word: 'rising', ticker: 'SPY' }, rsp: null, sector: { word: 'rising', ticker: 'XLK' },
    reasons: { rsp: 'no RSP bars' }, summary: 'SPY and XLK rising; RSP: no bars' },
  checks: {
    ma: { pass: true, line: 'pass · stock +15.2% vs its 200-day, SPY +0.4%' },
    anchor: { pass: false, line: 'fail · stock −0.2%, SPY +2.0%; low was 1 bar ago' },
    pivotSpeed: { pass: false, line: 'fail · 4 of the last 10 red days closed in the top third' },
    greenOnRed: { pass: true, line: 'pass · up on 5 red days in the last 20 sessions' },
    pullbackEma8: 0.1, passed: 2, of: 4, summary: '2 of 4 pass',
  },
  theme: { label: 'Consumer Electronics (XLK)' },
})

const rows = (payload, inputs = {}) => readoutRows(RS, payload, { inputs })
const glanceKeys = (list) => list.filter((r) => !r.detailOf).map((r) => r.key)
const textOf = (list, key) => (list.find((r) => r.key === key) || {}).text

describe('A1 — the glance list and the detail rows', () => {
  it('the definition declares exactly the glance list, in reading order, each label 12 characters or fewer', () => {
    const glance = RS.readout.filter(isGlanceRow)
    expect(glance.map((e) => e.key)).toEqual(GLANCE)
    expect(glance.map((e) => e.label)).toEqual(['Benchmark', 'Rating', 'RS line', 'Mansfield', 'Rotation', 'Quality',
      'Vol-adjusted', 'RS Rating', 'Last RS high', 'Agreement', 'Regime', 'Checks', 'History'])
    for (const e of glance) expect(e.label.length, e.label).toBeLessThanOrEqual(12)
    // the old "Benchmarks" row is "Agreement", never two rows a letter apart
    expect(RS.readout.some((e) => e.label === 'Benchmarks')).toBe(false)
  })

  it('every glance row but History opens a card; every other row is a detail row of a glance row with a card', () => {
    for (const e of RS.readout.filter(isGlanceRow)) {
      if (e.key === 'shortHistory') expect(e.card, 'History has no card').toBeUndefined()
      else expect(e.card, e.key).toBeTruthy()
    }
    const glance = new Map(RS.readout.filter(isGlanceRow).map((e) => [e.key, e]))
    const details = RS.readout.filter((e) => !isGlanceRow(e))
    expect(details.length).toBeGreaterThan(15)
    for (const e of details) {
      const parent = glance.get(e.detailOf)
      expect(parent, `${e.key} → ${e.detailOf}`).toBeTruthy()
      expect(parent.card, `${e.detailOf} has a card`).toBeTruthy()
    }
    const of = (key) => details.filter((e) => e.detailOf === key).map((e) => e.key)
    expect(of('benchmarkName')).toEqual(['benchmarkRequested', 'benchmark', 'benchmarkNote'])
    expect(of('ratingSummary')).toEqual(['rating', 'fastRating', 'ratingAsOf', 'ratingComponents'])
    expect(of('phase')).toEqual(['fromMa'])
    expect(of('mansfield')).toEqual(['mansfieldValue', 'mansfieldCross', 'mansfieldLength'])
    expect(of('rsHigh')).toEqual(['rsHighAge', 'beforePrice', 'redDay', 'history'])
    expect(of('sensitivity')).toEqual(['agreeSpy', 'agreeRsp', 'agreeSector', 'theme'])
    expect(of('regime')).toEqual(['regimePct200', 'regimeReturn2y', 'regimeVol', 'regimeNote'])
    expect(of('checks')).toEqual(['checkMa', 'checkAnchor', 'checkAnchorPicked', 'checkPivot', 'checkGreenOnRed', 'pullback'])
    // v4 (3-08): the three Phase 3 readings
    expect(of('rotation')).toEqual(['rotationQuadrant', 'rotationRatio', 'rotationMomentum', 'rotationBars'])
    expect(of('quality')).toEqual(['qualityScore', 'qualityPace', 'qualityFit', 'qualityGap', 'qualityWindow'])
    expect(of('vars')).toEqual(['varsValue', 'varsAverage', 'varsState', 'varsLookback', 'varsAtr'])
  })

  it('the glance rows read the server summary strings named in the contract; the checks read each check\'s line', () => {
    const src = Object.fromEntries(RS.readout.map((e) => [e.key, e.source]))
    expect(src).toMatchObject({
      benchmarkName: 'scalar:benchmark.label', ratingSummary: 'scalar:rating.summary', phase: 'scalar:legend.summary',
      mansfield: 'scalar:mansfield.summary', rsHigh: 'scalar:lastRsHigh.summary', sensitivity: 'scalar:sensitivity.summary',
      regime: 'scalar:regime.label', checks: 'scalar:checks.summary',
      checkMa: 'scalar:checks.ma.line', checkAnchor: 'scalar:checks.anchor.line',
      checkPivot: 'scalar:checks.pivotSpeed.line', checkGreenOnRed: 'scalar:checks.greenOnRed.line',
    })
  })

  it('acceptance 2: SPY on a daily chart lists rows 1, 2, 3, 5, 6, 7, 8 — and row 4 only under Mansfield view', () => {
    expect(glanceKeys(rows(PAYLOAD))).toEqual(['benchmarkName', 'ratingSummary', 'phase', 'rsHigh', 'sensitivity', 'regime', 'checks'])
    expect(glanceKeys(rows(PAYLOAD, { view: 'mansfield' })))
      .toEqual(['benchmarkName', 'ratingSummary', 'phase', 'mansfield', 'rsHigh', 'sensitivity', 'regime', 'checks'])
    // a short series adds History, and never more than nine rows
    const short = { ...PAYLOAD, history: { bars: 180, requested: 852, short: true, summary: '180 bars held; dots use every bar' } }
    const got = rows(short, { view: 'mansfield' })
    const g = glanceKeys(got)
    expect(g[g.length - 1]).toBe('shortHistory')
    expect(g.length).toBeLessThanOrEqual(9)
    // the History row is the server's sentence, in the muted ink (visual spec row 9)
    expect(got.find((r) => r.key === 'shortHistory')).toMatchObject({ text: '180 bars held; dots use every bar', muted: true })
  })

  it('the glance values print the composed reads verbatim', () => {
    const got = rows(PAYLOAD, { view: 'mansfield' })
    expect(Object.fromEntries(got.filter((r) => !r.detailOf).map((r) => [r.label, r.text]))).toEqual({
      Benchmark: 'S&P 500 (SPY)', Rating: '94 · fast 91', 'RS line': 'above its 21 EMA by 6.8%',
      Mansfield: '+18.7%, above zero, falling', 'Last RS high': '1 bar ago · before price · red day',
      Agreement: 'SPY and XLK rising; RSP: no bars', Regime: 'persistence', Checks: '2 of 4 pass',
    })
    // and an unrated name reads muted "not yet rated"
    const unrated = rows({ ...PAYLOAD, rating: { ibd: null, fast: null, asof: null, summary: null } })
    expect(unrated.find((r) => r.key === 'ratingSummary')).toMatchObject({ text: 'not yet rated', muted: true })
  })

  it('the Benchmark row carries the server note as a muted second line, and only when there is one', () => {
    expect(rows(PAYLOAD).find((r) => r.key === 'benchmarkName').note).toBeUndefined()
    const etf = { ...PAYLOAD, benchmark: { ...PAYLOAD.benchmark, requested: 'SECTOR', fallback: 'symbol is an ETF',
      note: 'Sector ETF not available for an ETF; using SPY' } }
    expect(rows(etf).find((r) => r.key === 'benchmarkName')).toMatchObject({
      text: 'S&P 500 (SPY)', note: 'Sector ETF not available for an ETF; using SPY', muted: false })
    // the card's Note row is the same sentence, never the raw code
    expect(rows(etf).find((r) => r.key === 'benchmarkNote')).toMatchObject({
      text: 'Sector ETF not available for an ETF; using SPY', detailOf: 'benchmarkName' })
    const gap = { ...PAYLOAD, benchmark: { ...PAYLOAD.benchmark, note: 'No SPY bar for Nov 5 yet' } }
    expect(rows(gap).find((r) => r.key === 'benchmarkName').note).toBe('No SPY bar for Nov 5 yet')
    // a blank note is no note
    const blank = { ...PAYLOAD, benchmark: { ...PAYLOAD.benchmark, note: '   ' } }
    expect(rows(blank).find((r) => r.key === 'benchmarkName').note).toBeUndefined()
  })

  it('the numbers blocks: each detail row resolves and carries its glance key', () => {
    const got = rows(PAYLOAD, { view: 'mansfield' })
    const block = (key) => got.filter((r) => r.detailOf === key).map((r) => [r.label, r.text])
    // Requested prints the OPTION the member picked, never the stored code
    expect(block('benchmarkName')).toEqual([['Requested', 'S&P 500 (SPY)'], ['Resolved', 'SPY']])
    const auto = rows(PAYLOAD, { benchmark: 'SECTOR' })
    expect(auto.find((r) => r.key === 'benchmarkRequested')).toMatchObject({ text: 'Sector ETF (auto)' })
    expect(block('ratingSummary')).toEqual([['IBD-style', '94'], ['Fast', '91'], ['Rated as of', '2026-11-05']])
    expect(block('phase')).toEqual([['From average', '+6.8%']])
    expect(block('mansfield')).toEqual([['Value', '+18.7%'], ['Last zero cross', 'up, 57 bars ago'], ['Length', '200 bars']])
    expect(block('rsHigh')).toEqual([['Bars ago', '1'], ['Before price', 'yes'], ['On a red day', 'yes']])
    expect(block('sensitivity')).toEqual([['SPY', 'rising'], ['Sector', 'rising'], ['Theme', 'Consumer Electronics (XLK)']])
    expect(block('regime')).toEqual([['vs 200-day', '+4.1%'], ['2-year return', '+38.2%'], ['Volatility third', 'low']])
    expect(block('checks')).toEqual([
      ['Averages', 'pass · stock +15.2% vs its 200-day, SPY +0.4%'],
      ['Since anchor', 'fail · stock −0.2%, SPY +2.0%; low was 1 bar ago'],
      ['Pivot speed', 'fail · 4 of the last 10 red days closed in the top third'],
      ['Green on red', 'pass · up on 5 red days in the last 20 sessions'],
      ['From 8-day EMA', '+0.1%'],
    ])
  })

  it('acceptance 6: no "1 bars", no "on a red day" value under a Red day label, no value that opens with its label\'s first word', () => {
    const got = rows(PAYLOAD, { view: 'mansfield' })
    for (const r of got) {
      expect(r.text, r.key).not.toMatch(/\b1 bars\b/)
      const first = r.label.split(/\s+/)[0].toLowerCase()
      expect(r.text.toLowerCase().startsWith(first + ' '), `${r.label}: ${r.text}`).toBe(false)
      if (/red day/i.test(r.label)) expect(r.text, r.key).not.toMatch(/on a red day/)
    }
    // a bool detail reads yes / no, never its own label again
    expect(RS.readout.find((e) => e.key === 'beforePrice').words).toEqual(['yes', 'no'])
    expect(RS.readout.find((e) => e.key === 'redDay').words).toEqual(['yes', 'no'])
  })

  it('the resolved row shape: `detailOf` on a detail row, ABSENT (not undefined) on a glance row', () => {
    const got = rows(PAYLOAD)
    const glance = got.find((r) => r.key === 'benchmarkName')
    expect(Object.keys(glance).sort()).toEqual(['key', 'label', 'muted', 'text', 'value'])
    expect(got.find((r) => r.key === 'benchmark')).toEqual({ key: 'benchmark', label: 'Resolved', value: 'SPY', text: 'SPY', muted: false, detailOf: 'benchmarkName' })
    expect(READOUT_ENTRY_FIELDS).toContain('detailOf')
  })

  it('⛔ the chip rows: the pane reads `UCT Relative Strength · XLK · 94` under the default headline (VA2, 2026-11-07)', () => {
    const sector = { ...PAYLOAD, benchmark: { requested: 'SECTOR', resolved: 'XLK', label: 'Technology sector (XLK)', fallback: null, bars: 852 } }
    expect(readoutChipRows(RS, rows(sector)).map((r) => [r.key, r.text]))
      .toEqual([['benchmark', 'XLK'], ['rating', '94']])
    const b = { instanceId: 'inst:rsLine:1', defId: 'rsLine', plotKey: 'rsLine', series: { __id: 'rs' }, lastValue: 0.4187 }
    const inst = { instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs: { benchmark: 'SECTOR' }, hidden: false }
    const chip = legendChips([b], null, engineRegistry, [inst], { scalarsOf: () => sector })[0]
    // the default headline (IBD-style since 2026-11-07; the plan said both) is the
    // Phase 2a label, byte for byte: the fast chip row resolves and stays out
    expect(chip.suffix).toBe(' · XLK · 94')
    expect(paneReadoutLabel(chip, RS, null)).toBe('UCT Relative Strength · XLK · 94')
    // headline `both` is the member's choice and puts both in the label
    const both = { ...inst, inputs: { benchmark: 'SECTOR', headlineRating: 'both' } }
    const bothChip = legendChips([b], null, engineRegistry, [both], { scalarsOf: () => sector })[0]
    expect(bothChip.suffix).toBe(' · XLK · 94 · fast 91')
    expect(paneReadoutLabel(bothChip, RS, null)).toBe('UCT Relative Strength · XLK · 94 · fast 91')
    const ibd = { ...inst, inputs: { benchmark: 'SECTOR', headlineRating: 'ibd' } }
    expect(legendChips([b], null, engineRegistry, [ibd], { scalarsOf: () => sector })[0].suffix).toBe(' · XLK · 94')
    // a fallback benchmark reads its note in the Benchmark card, never in the suffix
    const fellBack = { ...sector, benchmark: { ...sector.benchmark, resolved: 'SPY', fallback: 'symbol is an ETF',
      note: 'Sector ETF not available for an ETF; using SPY' } }
    expect(rows(fellBack).find((r) => r.key === 'benchmarkNote')).toMatchObject({ detailOf: 'benchmarkName' })
    expect(legendChips([b], null, engineRegistry, [ibd], { scalarsOf: () => fellBack })[0].suffix).toBe(' · SPY · 94')
  })
})

describe('defSchema — `readout[].detailOf`', () => {
  const base = (readout) => ({ ...RS, readout })
  const card = { what: 'w', origin: 'o' }
  const errs = (readout) => { const r = validateDefinition(base(readout)); return r.ok ? [] : r.errors }

  it('accepts a detail row of a glance row with a card, declared before or after it', () => {
    expect(errs([{ key: 'a', label: 'A', source: 'scalar:x', format: 'text', card },
      { key: 'b', label: 'B', source: 'scalar:y', format: 'text', detailOf: 'a' }])).toEqual([])
    expect(errs([{ key: 'b', label: 'B', source: 'scalar:y', format: 'text', detailOf: 'a' },
      { key: 'a', label: 'A', source: 'scalar:x', format: 'text', card }])).toEqual([])
  })

  it('⛔ refuses a name nothing declares, itself, a parent with no card, a nested detail, and a non-string', () => {
    const one = (readout) => { const e = errs(readout); expect(e.length, JSON.stringify(e)).toBe(1); return e[0] }
    expect(one([{ key: 'b', label: 'B', source: 'scalar:y', format: 'text', detailOf: 'zz' }]))
      .toMatch(/^readout\[0\]\.detailOf: .*"zz" names no other readout row/)
    expect(one([{ key: 'b', label: 'B', source: 'scalar:y', format: 'text', card, detailOf: 'b' }]))
      .toMatch(/"b" names no other readout row/)
    expect(one([{ key: 'a', label: 'A', source: 'scalar:x', format: 'text' },
      { key: 'b', label: 'B', source: 'scalar:y', format: 'text', detailOf: 'a' }]))
      .toMatch(/^readout\[1\]\.detailOf: .*"a" has no card/)
    expect(one([{ key: 'a', label: 'A', source: 'scalar:x', format: 'text', card },
      { key: 'b', label: 'B', source: 'scalar:y', format: 'text', card, detailOf: 'a' },
      { key: 'c', label: 'C', source: 'scalar:z', format: 'text', detailOf: 'b' }]))
      .toMatch(/^readout\[2\]\.detailOf: .*"b" is itself a detail row .*one level deep/)
    expect(one([{ key: 'a', label: 'A', source: 'scalar:x', format: 'text', card },
      { key: 'b', label: 'B', source: 'scalar:y', format: 'text', detailOf: 7 }]))
      .toMatch(/^readout\[1\]\.detailOf: .*expected the key of the glance row/)
  })
})

describe('A2 — Mansfield view', () => {
  const input = (key) => RS.inputs.find((i) => i.key === key)

  it('the switch is labelled Mansfield view, with the spec\'s tooltip, and is LEGACY since v4 (the Reading replaced it)', () => {
    expect(input('showMansfield')).toMatchObject({ label: 'Mansfield view', default: false, legacy: true,
      tooltip: 'Draw Weinstein\'s Mansfield line around zero in place of the RS line and its dots.' })
    expect(input('view')).toMatchObject({ label: 'Reading', default: 'ratio', group: 'Simple', requiresServer: true })
  })

  it('Trend and Trend weekly turn Mansfield view on; every other preset states it off', () => {
    const by = Object.fromEntries(RS.meta.presets.map((p) => [p.id, p]))
    expect(by.trend).toMatchObject({ inputs: { showMansfield: true, mansfieldLength: 200, mansfieldColor: RS_INFO, dotCrossColor: RS_INFO },
      dotSize: { dotMansfieldCross: 'medium' }, visibility: { preset: 'dailyUp' } })
    expect(by.trendWeekly).toMatchObject({ inputs: { showMansfield: true, mansfieldLength: 52, lookback: 52, mansfieldColor: RS_INFO, dotCrossColor: RS_INFO },
      dotSize: { dotMansfieldCross: 'medium' } })
    for (const id of ['classic', 'classicWeekly', 'phase', 'stress']) expect(by[id].inputs.showMansfield, id).toBe(false)
    // v4: the Reading says the same, in the new key
    for (const id of ['trend', 'trendWeekly']) expect(by[id].inputs.view, id).toBe('mansfield')
    for (const id of ['classic', 'classicWeekly', 'phase', 'stress']) expect(by[id].inputs.view, id).toBe('ratio')
  })

  it('the zero guide: one solid neutral hlines at 0, active ONLY under Mansfield view', () => {
    const guides = RS.plots.filter((p) => p.style === 'hlines')
    // v4: one guide per centred reading (Mansfield 0, Rotation 100, VARS 0); rev 5: the RS Rating's 80 / 90
    expect(guides.map((g) => g.key)).toEqual(['mansfieldZero', 'rotationCentre', 'varsZero', 'ratingGuides'])
    const z = guides[0]
    expect(z).toMatchObject({ key: 'mansfieldZero', levels: [0], role: 'context', color: RS_NEUTRAL, width: 1, lineStyle: 'solid',
      activeWhen: { key: 'view', equals: 'mansfield' } })
    expect(evalActiveWhen(z.activeWhen, { view: 'mansfield' })).toBe(true)
    expect(evalActiveWhen(z.activeWhen, { view: 'ratio' })).toBe(false)
    for (const g of guides) {
      expect(g, g.key).toMatchObject({ role: 'context', color: RS_NEUTRAL, width: 1, lineStyle: 'solid' })
      for (const view of ['ratio', 'mansfield', 'rotation', 'quality', 'vars', 'rating']) {
        expect(evalActiveWhen(g.activeWhen, { view }), `${g.key} under ${view}`).toBe(g.activeWhen.equals === view)
      }
    }
    // the Mansfield line draws at the instance's line width
    expect(RS.plots.find((p) => p.key === 'mansfield').$refs).toMatchObject({ color: 'mansfieldColor', width: 'lineWidth' })
  })

  it('the cross dot tooltip says "crosses up through zero"', () => {
    expect(input('dotCrossColor').tooltip).toMatch(/crosses up through zero/)
  })

  it('dims, never removes: the ratio-only inputs dim under Mansfield view, the Mansfield ones outside it', () => {
    const ratioOnly = ['color', 'lineDownColor', 'maColor', 'showNewHigh', 'showNewHighBeforePrice', 'shortHistoryDots',
      'showRedDay', 'showNewLow', 'dotColor', 'dotBeforePriceColor', 'dotPartialColor', 'dotRedColor', 'dotLowColor']
    for (const k of ratioOnly) expect(input(k).activeWhen, k).toEqual({ key: 'view', equals: 'ratio' })
    for (const k of ['mansfieldLength', 'mansfieldColor', 'dotCrossColor']) expect(input(k).activeWhen, k).toEqual({ key: 'view', equals: 'mansfield' })
    // v4: each Method length dims unless its own Reading is chosen
    for (const [k, view] of [['rrgRatioLength', 'rotation'], ['rrgMomentumLength', 'rotation'], ['clenowWindow', 'quality'],
      ['clenowGapPct', 'quality'], ['atrLength', 'vars'], ['varsLookback', 'vars']]) {
      expect(input(k), k).toMatchObject({ group: 'Method', requiresServer: true, activeWhen: { key: 'view', equals: view } })
    }
    // the controls every view uses never dim
    for (const k of ['benchmark', 'maLength', 'maType', 'lineWidth', 'lookback', 'priceTolerance', 'showMansfield', 'view', 'anchorDate']) {
      expect(input(k).activeWhen, k).toBeUndefined()
    }
  })
})

describe('A3 — the Stress preset and the red-day mark', () => {
  const plot = (key) => RS.plots.find((p) => p.key === key)
  const preset = (id) => RS.meta.presets.find((p) => p.id === id)

  it('the red-day mark is a large circle with NO text, declared before the before-price glyph', () => {
    // L1 (2026-11-07): both large glyphs are size 1.6 (13 px at the floor), was 2.0
    expect(plot('dotNHred').marker).toEqual({ shape: 'circle', position: 'inBar', size: 1.6 })
    for (const p of RS.plots) if (p.marker) expect('text' in p.marker, p.key).toBe(false)
    const keys = RS.plots.map((p) => p.key)
    expect(keys.indexOf('dotNHred')).toBeLessThan(keys.indexOf('dotNHbeforePx'))
  })

  it('the red-day default is the info blue; Stress makes it the one gold mark and turns before price off', () => {
    expect(RS.inputs.find((i) => i.key === 'dotRedColor').default).toBe(RS_INFO)
    expect(preset('stress')).toMatchObject({
      inputs: { showRedDay: true, showNewHighBeforePrice: false, dotRedColor: RS_GOLD, showMansfield: false },
      dotSize: { dotNHred: 'large' }, visibility: { preset: 'dailyUp' },
    })
  })

  it('the description and the tooltips lose "marked RED" and "gold, because"', () => {
    const texts = [RS.meta.description, ...RS.inputs.map((i) => i.tooltip || '')]
    for (const t of texts) {
      expect(t).not.toMatch(/marked RED/)
      expect(t).not.toMatch(/gold, because/)
    }
    expect(RS.meta.description).toMatch(/the gold dot marks a high before price in Classic and a high on a red market day in the Stress test/)
  })
})

describe('presets round-trip through the writer (A2 / A3)', () => {
  const ID = legacyInstanceId('rsLine')
  const fresh = () => setIndicatorEnabled(mergeChartSettings(null), 'rsLine', true, engineRegistry)
  const apply = (cs, id) => applyPresetInputs(cs, ID, RS, RS.meta.presets.find((p) => p.id === id), engineRegistry)
  const defaults = Object.fromEntries(RS.inputs.map((i) => [i.key, i.default]))
  const values = (cs) => { const inst = findInstance(cs, ID); return { ...defaults, ...(inst.inputs || {}) } }
  const reads = (cs) => { const instance = findInstance(cs, ID); const hit = detectPreset(presetsOf(RS), values(cs), { instance, def: RS, cs }); return hit ? hit.id : null }
  /** What the pane draws from: the server inputs, the colours of what draws, the fields. */
  const drawState = (cs) => {
    const inst = findInstance(cs, ID)
    const v = values(cs)
    return { v, visibility: inst.visibility, presentation: inst.presentation }
  }

  for (const via of ['trend', 'trendWeekly', 'stress']) {
    it(`Classic → ${via} → Classic reads Classic and draws what a fresh Classic draws`, () => {
      const classic = apply(fresh(), 'classic')
      const round = apply(apply(classic, via), 'classic')
      expect(reads(round)).toBe('classic')
      const a = drawState(classic)
      const b = drawState(round)
      expect(b.visibility).toEqual(a.visibility)
      expect(b.presentation).toEqual(a.presentation)
      // every input Classic or the ratio view reads is back where Classic left it
      for (const k of ['showMansfield', 'showRedDay', 'showNewLow', 'showNewHighBeforePrice', 'showNewHigh', 'color', 'lineDownColor',
        'dotColor', 'dotRedColor', 'dotBeforePriceColor', 'maLength', 'maType', 'lookback']) {
        expect(b.v[k], k).toEqual(a.v[k])
      }
    })
  }

  it('each preset reads back as itself after it is applied', () => {
    for (const p of RS.meta.presets) expect(reads(apply(fresh(), p.id)), p.id).toBe(p.id)
  })
})

describe('A4 / A6 / A9 — axis, restyle opt-out, labels, names', () => {
  it('A4: the RS pane declares its axis hidden; the vocabulary is visible | hidden and fails closed', () => {
    expect(RS.placement).toMatchObject({ target: 'pane', axis: 'hidden' })
    expect(PLACEMENT_AXIS_MODES).toEqual(['visible', 'hidden'])
    const withAxis = (axis) => validateDefinition({ ...RS, placement: { ...RS.placement, axis } })
    expect(withAxis('visible').ok).toBe(true)
    expect(withAxis('hidden').ok).toBe(true)
    const bad = withAxis('none')
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toMatch(/placement\.axis: unknown placement axis mode "none" — expected one of: visible, hidden/)
  })

  it('A6: every dot plot opts out of Plot style; the three lines do not', () => {
    for (const p of RS.plots) {
      if (p.style === 'markers') expect(p.restyle, p.key).toBe(false)
      else expect(p.restyle, p.key).toBeUndefined()
    }
    const bad = validateDefinition({ ...RS, plots: RS.plots.map((p) => (p.key === 'dotNH' ? { ...p, restyle: 'no' } : p)) })
    expect(bad.ok).toBe(false)
    expect(bad.errors.join('\n')).toMatch(/plots\[\d+\]\.restyle: expected true or false/)
  })

  it('A6: the line plots are named in the inputs\' vocabulary, short enough not to truncate', () => {
    const label = (key) => RS.plots.find((p) => p.key === key).label
    expect([label('rsLine'), label('rsMa'), label('mansfield')]).toEqual(['RS line', 'Average', 'Mansfield'])
    expect(['rsRatio', 'rsMomentum', 'clenowScore', 'vars', 'varsMa'].map(label)).toEqual(['RS-Ratio', 'Momentum', 'Quality', 'VARS', 'VARS avg'])
    expect(RS.inputs.find((i) => i.key === 'shortHistoryDots').label).toBe('Short history')
    for (const p of RS.plots.filter((x) => x.style === 'line' && !x.hidden)) expect(`${p.label} style`.length, p.key).toBeLessThanOrEqual(16)
  })

  it('A9: the definition prints `UCT RS` and never `RS(` or `RS (`', () => {
    expect(RS.meta.shortName).toBe('UCT RS')
    const strings = [RS.meta.name, RS.meta.shortName, RS.meta.description,
      ...RS.inputs.flatMap((i) => [i.label, i.tooltip]), ...RS.plots.map((p) => p.label),
      ...RS.readout.flatMap((e) => [e.label, e.fallback, ...(e.words || []), ...(e.card ? Object.values(e.card) : [])])]
    for (const s of strings.filter((x) => typeof x === 'string')) expect(s, s).not.toMatch(/RS ?\(/)
  })
})

describe('defSchema — `plots[].activeWhen` (a guide\'s condition)', () => {
  const zero = RS.plots.find((p) => p.key === 'mansfieldZero')
  const withPlots = (plots) => validateDefinition({ ...RS, plots })
  it('is admitted on an hlines guide keyed on a declared input, and refused anywhere else', () => {
    expect(withPlots(RS.plots).ok).toBe(true)
    const onLine = withPlots(RS.plots.map((p) => (p.key === 'rsMa' ? { ...p, activeWhen: { key: 'view', equals: 'ratio' } } : p)))
    expect(onLine.ok).toBe(false)
    expect(onLine.errors.join('\n')).toMatch(/plots\[\d+\]\.activeWhen: only an "hlines" guide carries a condition/)
    const unknown = withPlots(RS.plots.map((p) => (p === zero ? { ...p, activeWhen: { key: 'nope', equals: true } } : p)))
    expect(unknown.errors.join('\n')).toMatch(/activeWhen\.key: unresolvable reference "nope"/)
    const noEquals = withPlots(RS.plots.map((p) => (p === zero ? { ...p, activeWhen: { key: 'view' } } : p)))
    expect(noEquals.errors.join('\n')).toMatch(/activeWhen: expected an `equals` value/)
    // v4: an enum guide's value must be one of the enum's options (3-07's check)
    const typo = withPlots(RS.plots.map((p) => (p === zero ? { ...p, activeWhen: { key: 'view', equals: 'mansfeld' } } : p)))
    expect(typo.errors.join('\n')).toMatch(/"mansfeld" is not one of "view"'s option values/)
  })
})

describe('⛔ CONTROL — no other definition changes', () => {
  it('no non-RS definition carries detailOf, an axis mode, a restyle opt-out or a guide condition, and every one still validates', () => {
    // ⭐ RS split F1 (2026-11-10): the RS FAMILY is four definitions now — the three
    // split out of rsLine carry its axis mode / guide conditions by design (their
    // own def tests pin them). Named, so a fifth RS definition is a decision here.
    // 2026-11-12 (RS Exit Warnings): the decision was taken: the RS family is FIVE, `rsExit` joins it
    // (an own pane with a hidden axis, and `restyle: false` on its three dots).
    const RS_FAMILY = ['rsLine', 'rsRating', 'rsPhases', 'rsVsEma', 'rsExit']
    expect(RS_FAMILY.map((id) => !!getDefinition(id))).toEqual([true, true, true, true, true])
    const others = listDefinitions().filter((d) => !RS_FAMILY.includes(d.id))
    expect(others.length).toBeGreaterThan(10)
    for (const d of others) {
      expect(d.placement && d.placement.axis, d.id).toBeUndefined()
      for (const p of d.plots || []) {
        expect(p.restyle, `${d.id}.${p.key}`).toBeUndefined()
        expect(p.activeWhen, `${d.id}.${p.key}`).toBeUndefined()
      }
      for (const e of d.readout || []) expect(e.detailOf, `${d.id}.${e.key}`).toBeUndefined()
      const r = validateDefinition(d)
      expect(r.ok, `${d.id}: ${(r.errors || []).join('; ')}`).toBe(true)
    }
  })

  it('a readout block with no detailOf resolves to the exact row shape it always had', () => {
    const def = { ...RS, readout: [{ key: 'a', label: 'A', source: 'scalar:x.y', format: 'text', chip: true }] }
    expect(readoutRows(def, { x: { y: 'v' } }, {})).toEqual([{ key: 'a', label: 'A', value: 'v', text: 'v', muted: false }])
  })
})
