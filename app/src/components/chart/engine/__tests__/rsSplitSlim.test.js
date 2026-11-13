// app/src/components/chart/engine/__tests__/rsSplitSlim.test.js
//
// ─── UCT RS split, U7 — THE SLIM `rsLine` ("UCT RS Line", the MarketSurge look) ──
//
// `nativeRegistry.js` holds two `rsLine` definitions and registers ONE by the
// build flag `VITE_RS_SPLIT_ENABLED` (`rsSplitEnabled`). The suite's default is
// OFF (`test-setup.js`), so this file rails the slim definition through its
// exported raw, registered on its own through the same `registerDefinitions` the
// module runs at load: every assertion below holds whatever the build says.
// `rsSplitFlagOn.test.jsx` proves the registration under '1';
// `rsSplitMigration.test.js` holds the saved-chart contract (map §(b)).
//
// What this pins (engineering map §(a) U7, BRIEF-U7):
//   1. the shape — name, one-sentence description, price-pane placement, no
//      presets, no Reading, the trimmed `serverInputs`, the trimmed readout;
//   2. the inputs — about a dozen rendered, EVERY other v5 input declared
//      `legacy: true` with its v5 type, range and options (F20 drops an
//      undeclared key or an illegal enum value), none `requiresServer`, no `mapsTo`;
//   3. the plots — the line, its hidden condition column, the average gated on
//      `showAverage` (the one `plots[].activeWhen` on a data plot the schema
//      admits, and why), three circle glyphs with the gold the largest at every
//      bar spacing (the `markerPixels.test.js` arithmetic);
//   4. the readout — glance rows Benchmark, Rating, RS line, Last RS high,
//      Checks, History; the ranks in the Rating card; nothing of Mansfield,
//      Rotation, Quality, VARS, the fast rating, Agreement or Regime;
//   5. the fixture contract — every plot names a column `rs_events_default.json`
//      carries, and the real binder draws the ratio line and the glyphs from it;
//   6. the settings dialog on the slim definition: no Preset row, the five groups.
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { useState, createElement as h } from 'react'
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react'
import * as nativeRegistry from '../nativeRegistry'
import {
  registerDefinitions, getDefinition, resolveInputs, columnKeys, rsSplitEnabled,
  RS_LINE_V5_RAW, RS_LINE_SLIM_RAW, RS_CLASSIC_INPUTS,
} from '../nativeRegistry'
import { validateDefinition } from '../defSchema'
import { readoutRows, readoutChipRows, isGlanceRow } from '../readoutSchema'
import { readoutFallbackValue, readoutChipName } from '../readout'
import { planBindings, plotActiveFor, seriesOptionsForPlot } from '../pool'
import { scaledMarker } from '../presentation'
import { pickServerInputs, columnsFromWire, alignColumns } from '../serverCompute'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'
import { fieldsForInstance, visibleInputs, styleInputKeys } from '../../indicatorRegistry'
import { mergeChartSettings } from '../../chartDefaults'
import IndicatorSettingsDialog from '../../IndicatorSettingsDialog'
import { TOUR } from '../../../../content/rs/teachingData.js'
import { classicInputs } from '../../../../pages/study/studyRsOverlay'

/** The slim definition, registered exactly as the module registers its pick. */
const SLIM = (() => {
  const r = registerDefinitions([RS_LINE_SLIM_RAW])
  if (r.errors.length) throw new Error(`the slim rsLine does not register:\n  ${r.errors.join('\n  ')}`)
  return r.defs[0]
})()
const V5 = (() => registerDefinitions([RS_LINE_V5_RAW]).defs[0])()
const REGISTRY = { getDefinition: (id) => (id === 'rsLine' ? SLIM : null), listDefinitions: () => [SLIM] }
const input = (def, key) => def.inputs.find((i) => i.key === key)
const plot = (def, key) => def.plots.find((p) => p.key === key)
const RS_INFO = '#6ba3be'
const RS_GOLD = '#c9a84c'

/** The v4 row, every key and option declared (what the live server answers today). */
const DECLARED = Object.freeze({
  inputs: [...V5.meta.serverInputs],
  options: {
    benchmark: input(V5, 'benchmark').options.map((o) => o[0]),
    view: input(V5, 'view').options.map((o) => o[0]),
  },
})

/** What the slim definition RENDERS, in declaration order, with the live row declared. */
const RENDERED = Object.freeze([
  'benchmark', 'customBenchmark', 'sectorBenchmark', 'themeBenchmark', 'showAverage', 'showNewHigh', 'showNewHighBeforePrice', 'showRedDay', 'showRating',
  'maLength', 'maType', 'maColor',
  'color', 'lineWidth',
  'lookback', 'dotColor', 'dotBeforePriceColor', 'dotRedColor',
  'showRanksTable', 'ratingBands',
])
/** The keys that leave `meta.serverInputs` (map §(b) rows 1–3), never sent again. */
const REMOVED_FROM_SERVER = Object.freeze([
  'view', 'showMansfield', 'priceTolerance', 'shortHistoryDots', 'showNewLow',
  'rrgRatioLength', 'rrgMomentumLength', 'clenowWindow', 'clenowGapPct', 'atrLength', 'varsLookback', 'anchorDate',
])

afterEach(() => cleanup())

describe('1 · the shape', () => {
  it('registers and validates: same id, version and compute.rev as v5, a new name and a one-sentence description', () => {
    expect(validateDefinition(RS_LINE_SLIM_RAW).ok).toBe(true)
    expect(SLIM).toMatchObject({ id: 'rsLine', version: 5, compute: { kind: 'server', fn: 'rsLine', rev: 5 } })
    expect(V5).toMatchObject({ id: 'rsLine', version: 5, compute: { kind: 'server', fn: 'rsLine', rev: 5 } })
    expect(SLIM.meta).toMatchObject({ name: 'UCT RS Line', shortName: 'UCT RS', category: V5.meta.category, tier: 'premium' })
    expect(SLIM.meta.description).toBe('The stock against a benchmark, drawn under the price bars: blue dots on RS new highs, gold when the RS line leads price, and the RS Rating at the line\'s end.')
    expect(SLIM.meta.description.split('. ').length, 'one sentence').toBe(1)
    expect(SLIM.meta.requiresServer, 'the RS Line is offered everywhere (U1 gates the three NEW definitions only)').toBeUndefined()
  })

  it('the suite default is OFF: the registry holds v5 (UCT Relative Strength) with the U7a legacy showAverage', () => {
    expect(rsSplitEnabled()).toBe(false)
    const reg = getDefinition('rsLine')
    expect(reg.meta.name).toBe('UCT Relative Strength')
    expect(input(reg, 'showAverage')).toEqual({ key: 'showAverage', type: 'bool', label: 'Show average', default: false, group: 'Line', legacy: true })
    // byte for byte the v5 raw, registered
    expect(JSON.stringify(reg)).toBe(JSON.stringify(V5))
    // the classic preset IS the exported Classic object (the Study overlay reads it)
    expect(V5.meta.presets.find((p) => p.id === 'classic').inputs).toEqual(RS_CLASSIC_INPUTS)
  })

  it('on the price pane by default, own invisible scale, no axis; a 0.20 pane never under 64 px after "Display in"', () => {
    expect(SLIM.placement).toEqual({ target: 'price', ownScale: true, pane: { height: 0.2, minPx: 64 }, axis: 'hidden' })
    expect(V5.placement.target, 'v5 stays in its own pane by default').toBe('pane')
  })

  it('no presets, no Reading, no legendFallback; the groups fold but Simple; the lessons, the tour and the signpost stay', () => {
    expect(SLIM.meta.presets).toBeUndefined()
    expect(SLIM.meta.legendFallback).toBeUndefined()
    expect(SLIM.meta.groupsCollapsed).toEqual(['Average', 'Line', 'New highs', 'Rating'])
    expect(SLIM.meta.learn).toEqual(V5.meta.learn)
    expect(SLIM.meta.tour).toEqual(TOUR)
    expect(SLIM.meta.searchHint).toEqual(V5.meta.searchHint)
    expect(SLIM.meta.glossaryHref).toBe(V5.meta.glossaryHref)
    expect(SLIM.meta.paneTable).toEqual(V5.meta.paneTable)
    expect(SLIM.meta.legendParams).toEqual(['benchmark'])
    // tags name nothing the definition no longer draws
    for (const t of SLIM.meta.tags) expect(t).not.toMatch(/mansfield|weinstein|rrg|rotation|clenow|quality|vars|regime|rating line|rating history|stress/)
    expect(SLIM.meta.tags.some((t) => /\brsi\b/i.test(t)), 'F45: no rsi tag').toBe(false)
  })

  it('meta.serverInputs: the trimmed list, exactly; nothing removed is in it, and mansfieldLength stays for the Study slot key', () => {
    expect(SLIM.meta.serverInputs).toEqual(['benchmark', 'maLength', 'maType', 'lookback', 'redDayThreshold',
      'showNewHigh', 'showNewHighBeforePrice', 'mansfieldLength', 'showRedDay', 'customBenchmark',
      'sectorBenchmark', 'themeBenchmark'])
    for (const k of REMOVED_FROM_SERVER) expect(SLIM.meta.serverInputs, k).not.toContain(k)
    // a strict subset of the v5 list: no new server key, so the rev 5 row answers it as it is
    for (const k of SLIM.meta.serverInputs) expect(V5.meta.serverInputs, k).toContain(k)
  })
})

describe('2 · the inputs', () => {
  it('renders about a dozen controls, in declaration order, with the live row declared', () => {
    const inst = { instanceId: 'rs', defId: 'rsLine', inputs: {} }
    const all = fieldsForInstance(SLIM, inst, { declared: DECLARED }).all.map((f) => f.key)
    expect(all).toEqual(RENDERED)
    // and without a declaration the gated boxes (Your symbol, and since 2026-11-12 the
    // picked sector and theme) wait, as on v5
    const GATED = ['customBenchmark', 'sectorBenchmark', 'themeBenchmark']
    expect(visibleInputs(SLIM).map((i) => i.key)).toEqual(RENDERED.filter((k) => !GATED.includes(k)))
  })

  it('every v5 input is declared here; each one not rendered is legacy with the v5 type, range, default and options', () => {
    const v5Keys = V5.inputs.map((i) => i.key)
    const slimKeys = SLIM.inputs.map((i) => i.key)
    expect(new Set(slimKeys)).toEqual(new Set(v5Keys))
    expect(slimKeys.length, 'no key declared twice').toBe(new Set(slimKeys).size)
    for (const v5In of V5.inputs) {
      const s = input(SLIM, v5In.key)
      expect(s.type, v5In.key).toBe(v5In.type)
      expect(s.default, v5In.key).toEqual(v5In.default)
      for (const f of ['min', 'max', 'step', 'pattern', 'maxLength']) expect(s[f], `${v5In.key}.${f}`).toEqual(v5In[f])
      if (v5In.type === 'enum') {
        expect(s.options.map((o) => o[0]), `${v5In.key} options`).toEqual(v5In.options.map((o) => o[0]))
      }
      if (!RENDERED.includes(v5In.key)) {
        expect(s.legacy, `${v5In.key} must be legacy`).toBe(true)
        expect(s.requiresServer, `${v5In.key}: a legacy input cannot be requiresServer`).toBeUndefined()
        expect(s.mapsTo, `${v5In.key}: a legacy input maps onto nothing here`).toBeUndefined()
      } else {
        expect(s.legacy, `${v5In.key} is rendered`).toBeUndefined()
      }
    }
    // the Reading keeps all six values, and its RS Rating option is no longer gated
    expect(input(SLIM, 'view')).toMatchObject({ legacy: true, default: 'ratio' })
    expect(input(SLIM, 'view').options).toEqual([['ratio', 'RS line'], ['mansfield', 'Mansfield'], ['rotation', 'Rotation'],
      ['quality', 'Quality (Clenow)'], ['vars', 'Volatility-adjusted'], ['rating', 'RS Rating']])
    expect(input(SLIM, 'showMansfield')).toEqual({ key: 'showMansfield', type: 'bool', label: 'Mansfield view', default: false, group: 'Method', legacy: true })
    expect(input(SLIM, 'headlineRating').legacy, 'the readout chip is IBD only').toBe(true)
  })

  it('showAverage is a rendered switch, off by default; the average colour wakes with it; the red dot colour with Red-day highs', () => {
    expect(input(SLIM, 'showAverage')).toMatchObject({ type: 'bool', default: false, group: 'Simple' })
    expect(input(SLIM, 'maColor').activeWhen).toEqual({ key: 'showAverage', equals: true })
    expect(input(SLIM, 'dotRedColor').activeWhen).toEqual({ key: 'showRedDay', equals: true })
    expect(input(SLIM, 'maLength').activeWhen, 'the length is read by the RS line row either way').toBeUndefined()
    expect(input(SLIM, 'color')).toMatchObject({ type: 'color', default: RS_INFO, group: 'Line' })
    expect(input(SLIM, 'lineWidth')).toMatchObject({ default: 1, min: 1, max: 4 })
  })

  it('a fully stored v5 Trend instance sends none of the removed keys, and the benchmark and lookback still key the fetch', () => {
    const stored = { benchmark: 'QQQ', maLength: 21, maType: 'EMA', lookback: 52, view: 'mansfield', showMansfield: true,
      mansfieldLength: 52, anchorDate: '2026-10-15', rrgRatioLength: 10, priceTolerance: 3, shortHistoryDots: false, showNewLow: true }
    const sent = pickServerInputs(SLIM, resolveInputs(SLIM, stored))
    for (const k of REMOVED_FROM_SERVER) expect(sent, k).not.toHaveProperty(k)
    expect(sent).toMatchObject({ benchmark: 'QQQ', lookback: 52, maLength: 21, maType: 'EMA', mansfieldLength: 52 })
    expect(Object.keys(sent).every((k) => SLIM.meta.serverInputs.includes(k))).toBe(true)
  })

  it('the Study overlay stamps the Classic look plus Show average, and under the slim definition that sends nothing removed', () => {
    expect(classicInputs()).toEqual({ ...RS_CLASSIC_INPUTS, showAverage: true })
    const sent = pickServerInputs(SLIM, resolveInputs(SLIM, classicInputs()))
    for (const k of REMOVED_FROM_SERVER) expect(sent, k).not.toHaveProperty(k)
    expect(sent).toMatchObject({ maLength: 21, maType: 'EMA', lookback: 252, mansfieldLength: 200 })
    // slot 1 keys on mansfieldLength, the one legacy key kept in serverInputs
    expect(pickServerInputs(SLIM, resolveInputs(SLIM, { ...classicInputs(), mansfieldLength: 201 })).mansfieldLength).toBe(201)
  })
})

describe('3 · the plots', () => {
  it('six plots: the line, its hidden condition column, the gated average, three circle glyphs; nothing else', () => {
    expect(SLIM.plots.map((p) => p.key)).toEqual(['rsLine', 'rsAbove', 'rsMa', 'dotNH', 'dotNHred', 'dotNHbeforePx'])
    const line = plot(SLIM, 'rsLine')
    // registered, the `$color` / `$lineWidth` refs are substituted and recorded in `$refs`
    expect(line).toMatchObject({ style: 'line', color: RS_INFO, width: 1, role: 'primary', precision: 4, legend: { decimals: 4 },
      $refs: { color: 'color', width: 'lineWidth' } })
    expect(plot(RS_LINE_SLIM_RAW, 'rsLine')).toMatchObject({ color: '$color', width: '$lineWidth' })
    expect(line.colorMode, 'one colour, no above/below split').toBeUndefined()
    expect(line.fill).toEqual({ with: 'rsMa', colorMode: 'column:rsAbove', colorUp: '#3cb868', colorDown: '#e74c3c',
      activeWhen: { key: 'showAverage', equals: true } })
    expect(line.endLabel).toEqual({ source: 'scalar:rating.ibd', prefix: 'RS ', when: ['input:showRating'] })
    expect(line.liveTail).toEqual({ kind: 'ratio', benchmark: 'scalar:benchmark.resolved' })
    expect(plot(SLIM, 'rsAbove')).toMatchObject({ hidden: true })
    expect(plot(SLIM, 'rsMa')).toMatchObject({ style: 'line', color: '#8a8574', $refs: { color: 'maColor' }, lineStyle: 'largeDashed',
      activeWhen: { key: 'showAverage', equals: true },
      liveTail: { kind: 'ma', of: 'rsLine', length: 'input:maLength', type: 'input:maType' } })
    for (const k of ['dotNH', 'dotNHred', 'dotNHbeforePx']) {
      expect(plot(SLIM, k)).toMatchObject({ style: 'markers', restyle: false, legend: { hide: true }, marker: { shape: 'circle', position: 'inBar' } })
    }
    expect(plot(SLIM, 'dotNH').marker.size).toBe(0.8)
    expect(plot(SLIM, 'dotNHred').marker.size).toBe(1.6)
    expect(plot(SLIM, 'dotNHbeforePx').marker.size).toBe(1.6)
    expect(plot(SLIM, 'dotNH').$refs).toEqual({ color: 'dotColor' })
    expect(input(SLIM, 'dotColor').default).toBe(RS_INFO)
    expect(input(SLIM, 'dotBeforePriceColor').default).toBe(RS_GOLD)
  })

  it('the average draws only while Show average holds (plotActiveFor and the plan agree), the line always', () => {
    const ma = plot(SLIM, 'rsMa')
    expect(plotActiveFor(ma, SLIM, {})).toBe(false)
    expect(plotActiveFor(ma, SLIM, { showAverage: true })).toBe(true)
    expect(plotActiveFor(plot(SLIM, 'rsLine'), SLIM, {})).toBe(true)
    const keysOf = (inputs) => planBindings([{ instanceId: 'rs', defId: 'rsLine', inputs }], REGISTRY, [], {})
      .bind.map((d) => d.plotKey)
    expect(keysOf({})).toEqual(['rsLine', 'rsAbove', 'dotNH', 'dotNHred', 'dotNHbeforePx'])
    expect(keysOf({ showAverage: true })).toEqual(['rsLine', 'rsAbove', 'rsMa', 'dotNH', 'dotNHred', 'dotNHbeforePx'])
  })

  it('⛔ the schema: a data plot takes a condition on a PRESENTATION key of a server definition only', () => {
    // keyed on a server input: refused with the pre-U7 sentence (the server already blanks that column)
    const sentKey = validateDefinition({ ...RS_LINE_SLIM_RAW,
      plots: RS_LINE_SLIM_RAW.plots.map((p) => (p.key === 'rsMa' ? { ...p, activeWhen: { key: 'showNewHigh', equals: true } } : p)) })
    expect(sentKey.ok).toBe(false)
    expect(sentKey.errors.join('\n')).toMatch(/plots\[\d+\]\.activeWhen: only an "hlines" guide carries a condition/)
    // the same switch, declared a server input: refused too
    const promoted = validateDefinition({ ...RS_LINE_SLIM_RAW,
      meta: { ...RS_LINE_SLIM_RAW.meta, serverInputs: [...RS_LINE_SLIM_RAW.meta.serverInputs, 'showAverage'] } })
    expect(promoted.ok).toBe(false)
    expect(promoted.errors.join('\n')).toMatch(/plots\[\d+\]\.activeWhen: only an "hlines" guide/)
    // an undeclared key is still unresolvable
    const unknown = validateDefinition({ ...RS_LINE_SLIM_RAW,
      plots: RS_LINE_SLIM_RAW.plots.map((p) => (p.key === 'rsMa' ? { ...p, activeWhen: { key: 'nope', equals: true } } : p)) })
    expect(unknown.ok).toBe(false)
  })

  // The `markerPixels.test.js` mirror of lightweight-charts 5.2.0: the glyph's
  // height is clamped to 12..30 px of bar spacing BEFORE the size multiplier, then
  // a circle takes 0.8 of it, ceiled odd; the drawn disc is one pixel narrower.
  const ceiledEven = (x) => { const c = Math.ceil(x); return c % 2 !== 0 ? c - 1 : c }
  const ceiledOdd = (x) => { const c = Math.ceil(x); return c % 2 === 0 ? c - 1 : c }
  const size = (bs, coeff) => ceiledOdd(Math.min(Math.max(bs, 12), 30) * coeff)
  const disc = (markerSize, bs) => size(ceiledEven(size(bs, 1)) * markerSize, 0.8) - 1
  const SPACINGS = [4, 6, 8, 12, 15, 20, 30]

  it('the blue dot is a glyph (never a point marker), 8 px at every ordinary zoom; the gold disc is larger at EVERY spacing', () => {
    const blue = plot(SLIM, 'dotNH')
    const gold = plot(SLIM, 'dotNHbeforePx')
    const o = seriesOptionsForPlot(blue, { scaleId: 'rsLine' })
    expect(o.pointMarkersVisible, 'a glyph plot draws no point marker').toBeFalsy()
    expect(SPACINGS.map((bs) => disc(blue.marker.size, bs))).toEqual([8, 8, 8, 8, 8, 10, 16])
    expect(SPACINGS.map((bs) => disc(gold.marker.size, bs))).toEqual([12, 12, 12, 12, 16, 22, 22])
    for (const bs of SPACINGS) expect(disc(gold.marker.size, bs), `bar spacing ${bs}`).toBeGreaterThan(disc(blue.marker.size, bs))
    // ⛔ CONTROL — why 0.8 and not 1: a size-1 blue disc would EQUAL the gold at the 30 px cap
    expect(disc(1, 30)).toBe(disc(gold.marker.size, 30))
    // the member's Dot size keeps the order: Large blue (0.8 × 1.4 = 1.12) is still the 8 px floor disc at
    // bar spacing 12 and 16 px at 20, under the gold's 12 and 22
    expect(disc(scaledMarker(blue.marker, 'large').size, 12)).toBe(8)
    expect(disc(scaledMarker(blue.marker, 'large').size, 20)).toBe(16)
    expect(disc(scaledMarker(gold.marker, 'large').size, 12)).toBe(16)
    expect(disc(scaledMarker(blue.marker, 'small').size, 12)).toBe(8)
  })
})

describe('4 · the readout', () => {
  /** A rev 5 payload shaped as `rs_provider` sends it, the blocks this definition reads. */
  const PAYLOAD = Object.freeze({
    benchmark: { requested: 'SECTOR', resolved: 'XLK', name: 'XLK', label: 'Technology (XLK)', note: null },
    legend: { pctFromMa: 10.6, above: true, lastValue: 0.47, asOf: 20261106, summary: 'above its 21 EMA by 10.6%' },
    lastRsHigh: { barsAgo: 3, beforePrice: true, redDay: false, summary: '3 bars ago, before price' },
    history: { bars: 330, requested: 852, short: true, summary: '330 bars held of 852' },
    rating: { ibd: 94, fast: 91, asof: '2026-11-05', m1: 88, m3: 97, m6: 95, m9: 93, m12: 90, summary: '94, up 2 in 20 sessions', components: '1M 88 · 3M 97' },
    mansfield: { value: 3.2, summary: 'above its 200-bar average' },
    rotation: { quadrant: 'Leading', summary: 'Leading, 6 weeks' },
    quality: { score: 0.62, summary: 'Score 0.62' },
    vars: { value: 3.4, summary: 'Strong, rising' },
    ratingHistory: { value: 94, summary: '94, up 2' },
    sensitivity: { summary: 'agree', spy: { word: 'up' } },
    regime: { label: 'Persistence', pctFrom200: 4.1 },
    checks: { summary: '3 of 4', ma: { line: 'stock 4% above, benchmark 1% above' }, anchor: { line: 'since Oct 15, +6% vs +2%' },
      pivotSpeed: { line: '7 of 10' }, greenOnRed: { line: '8 of 20' }, pullbackEma8: 1.2 },
  })
  const rows = (inputs = {}) => readoutRows(SLIM, PAYLOAD, { inputs })

  it('the glance list, in reading order; every glance row but History opens a card', () => {
    expect(SLIM.readout.filter(isGlanceRow).map((r) => r.key)).toEqual(['benchmarkName', 'ratingSummary', 'phase', 'rsHigh', 'checks', 'shortHistory'])
    for (const r of SLIM.readout.filter(isGlanceRow)) {
      if (r.key !== 'shortHistory') expect(r.card, r.key).toBeTruthy()
      expect(r.label.length, r.key).toBeLessThanOrEqual(12)
    }
    // the chip rows: the resolved benchmark and the IBD-style rating, ungated by any headline choice
    const chips = SLIM.readout.filter((r) => r.chip)
    expect(chips.map((r) => r.key)).toEqual(['benchmark', 'rating'])
    expect(chips.every((r) => r.chipWhen === undefined)).toBe(true)
  })

  it('nothing of the readings this definition no longer draws, and no date picker', () => {
    const keys = SLIM.readout.map((r) => r.key)
    for (const gone of ['fastRating', 'ratingComponents', 'mansfield', 'rotation', 'quality', 'vars', 'ratingView',
      'sensitivity', 'agreeSpy', 'theme', 'regime', 'checkAnchorPicked']) expect(keys, gone).not.toContain(gone)
    for (const r of SLIM.readout) {
      expect(r.action, `${r.key} offers no action`).toBeUndefined()
      for (const field of ['source', 'when', 'muted']) {
        if (typeof r[field] === 'string') expect(r[field], `${r.key}.${field}`).not.toMatch(/mansfield|rotation|quality|vars|ratingHistory|sensitivity|regime|rating\.fast|input:view|anchorDate|showComponents|headlineRating/)
      }
    }
    expect(keys).toContain('checkAnchor')
  })

  it('on a rev 5 payload: the six glance rows, the five ranks in the Rating card, the IBD number on the chip', () => {
    const got = rows({ benchmark: 'SECTOR' })
    const glance = got.filter(isGlanceRow).map((r) => [r.key, r.text])
    expect(glance).toEqual([
      ['benchmarkName', 'Technology (XLK)'], ['ratingSummary', '94, up 2 in 20 sessions'], ['phase', 'above its 21 EMA by 10.6%'],
      ['rsHigh', '3 bars ago, before price'], ['checks', '3 of 4'], ['shortHistory', '330 bars held of 852'],
    ])
    const inRating = got.filter((r) => r.detailOf === 'ratingSummary').map((r) => [r.key, r.text])
    expect(inRating).toEqual([['rating', '94'], ['ratingAsOf', '2026-11-05'],
      ['rank1m', '88'], ['rank3m', '97'], ['rank6m', '95'], ['rank9m', '93'], ['rank12m', '90']])
    expect(readoutChipRows(SLIM, got).map((r) => [r.key, r.text])).toEqual([['benchmark', 'XLK'], ['rating', '94']])
    expect(readoutChipName({ label: 'x' }, SLIM)).toBe('UCT RS')
    expect(got.map((r) => r.key)).not.toContain('fastRating')
    // the RS Rating switch off: no rating row at all, the chip loses the number
    const off = rows({ showRating: false })
    expect(off.some((r) => r.key === 'ratingSummary' || r.detailOf === 'ratingSummary')).toBe(false)
    expect(readoutChipRows(SLIM, off).map((r) => r.key)).toEqual(['benchmark'])
  })

  it('every card lesson is one of meta.learn; the copy names no RSI, no buy or sell, no reading that is gone', () => {
    const lessons = new Set(SLIM.meta.learn.map((l) => l.key))
    for (const r of SLIM.readout) {
      if (!r.card) continue
      if (r.card.learn) expect(lessons.has(r.card.learn), `${r.key}.card.learn`).toBe(true)
      for (const s of Object.values(r.card)) {
        if (typeof s !== 'string') continue
        expect(s, r.key).not.toMatch(/\bRSI\b|\b(buy|sell)\b|Agreement row|Regime row|Mansfield|Rotation|Clenow|VARS|fast rating/i)
      }
    }
  })

  it('the pane label with no live value prints the dated last RS value, muted (no legendFallback to consult)', () => {
    expect(readoutFallbackValue(SLIM, PAYLOAD, 4, {})).toEqual({ text: '0.4700 · Nov 6', muted: true })
    expect(readoutFallbackValue(SLIM, null, 4, {})).toEqual({ text: '—', muted: true })
  })
})

describe('5 · the shared fixture, and the real binder', () => {
  const FIX = [
    join(process.cwd(), '..', 'tests', 'fixtures', 'indicators'),
    join(process.cwd(), 'tests', 'fixtures', 'indicators'),
  ].find((p) => existsSync(join(p, 'rs_events_default.json')))
  if (!FIX) throw new Error(`indicator fixtures not found from cwd ${process.cwd()}`)
  const c = JSON.parse(readFileSync(join(FIX, 'rs_events_default.json'), 'utf8'))

  it('every plot names a column the fixture carries, and columnsFromWire + alignColumns land them on the bars by time', () => {
    for (const p of SLIM.plots) expect(c.expected, p.key).toHaveProperty(p.key)
    expect(columnKeys(SLIM)).toEqual(SLIM.plots.map((p) => p.key))
    const times = c.bars.map((b) => b.t)
    const wire = { rev: 5, times, columns: Object.fromEntries(SLIM.plots.map((p) => [p.key, c.expected[p.key]])) }
    const parsed = columnsFromWire(wire, SLIM)
    const aligned = alignColumns(parsed, c.bars, (t) => t)
    for (const p of SLIM.plots) {
      expect(aligned[p.key].length, p.key).toBe(c.bars.length)
      aligned[p.key].forEach((v, i) => {
        const want = c.expected[p.key][i]
        if (want === null) expect(Number.isNaN(v), `${p.key}[${i}]`).toBe(true)
        else expect(v, `${p.key}[${i}]`).toBe(want)
      })
    }
    // a dot sits on the line
    c.expected.dotNH.forEach((d, i) => { if (d !== null) expect(d).toBe(c.expected.rsLine[i]) })
    // the server still sends columns no plot here draws: the binder ignores them (rsSplitMigration pins the draw)
    expect(Object.keys(c.expected)).toEqual(expect.arrayContaining(['dotNL', 'dotNHpartial', 'crossUp', 'crossDown']))
  })

  it('the binder draws the ratio line, a blue 0.8 glyph on each new high, the gold 1.6 glyph on the before-price bar, and the average only when asked', () => {
    const BARS = Array.from({ length: 8 }, (_, i) => ({ t: 1700000000 + i * 86400, c: 10 + i }))
    const NONE = [NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN]
    const COLUMNS = {
      rsLine: [1, 1.1, 1.2, 1.15, 1.3, 1.25, 1.4, 1.35],
      rsAbove: [1, 1, 1, 0, 1, 0, 1, 0],
      rsMa: [1, 1.05, 1.1, 1.12, 1.16, 1.18, 1.22, 1.25],
      dotNH: [NaN, NaN, 1.2, NaN, 1.3, NaN, 1.4, NaN],
      dotNHbeforePx: [NaN, NaN, NaN, NaN, 1.3, NaN, NaN, NaN],
      dotNHred: NONE,
      // columns the rev 5 row keeps sending and no plot here draws
      dotNL: [NaN, 1.1, NaN, NaN, NaN, NaN, NaN, NaN], dotNHpartial: NONE, mansfield: [NaN, NaN, -2.1, -0.4, 0.8, 1.6, 2.2, 1.9],
      ratingLine: [80, 81, 82, 83, 84, 85, 86, 87],
    }
    const drive = (inputs = {}) => {
      const fake = createFakeChart()
      const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
      const glyphs = []
      binder.sync({
        enabled: true,
        instances: [{ instanceId: 'inst:rsLine:1', defId: 'rsLine', inputs }],
        registry: { getDefinition: (id) => (id === 'rsLine' ? SLIM : null), computeFor: () => COLUMNS,
          hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite), columnKeys: (d) => d.plots.map((p) => p.key) },
        bars: BARS, adjustTime: (t) => t, plan: { fresh: true },
        applyData: (series, data) => series.setData(data),
        resolvePlacement: () => ({ paneIndex: 0, scaleId: 'own:rsLine', scaleOptions: {} }),
        createSeriesMarkers: (series, markers) => { glyphs.push({ series, markers }); return { setMarkers: (m) => glyphs.push({ series, markers: m }) } },
      })
      const dataOf = (series) => (fake.calls.filter((x) => x.on === 'series' && x.id === series.__id && x.method === 'setData').pop() || { args: [null] }).args[0]
      return { fake, glyphs, dataOf }
    }
    const { fake, glyphs, dataOf } = drive()
    const line = fake.seriesCreated.find((s) => s.__options.color === RS_INFO && s.__options.lineWidth === 1 && !s.__options.pointMarkersVisible && s.__options.lineVisible !== false)
    expect(line, 'the blue ratio line').toBeTruthy()
    expect(dataOf(line).map((p) => ('value' in p ? p.value : null))).toEqual(COLUMNS.rsLine)
    const all = glyphs.flatMap((g) => g.markers)
    expect(all.filter((m) => m.color === RS_INFO).map((m) => [m.time, m.shape, m.position, m.size]))
      .toEqual([[BARS[2].t, 'circle', 'inBar', 0.8], [BARS[4].t, 'circle', 'inBar', 0.8], [BARS[6].t, 'circle', 'inBar', 0.8]])
    expect(all.filter((m) => m.color === RS_GOLD).map((m) => [m.time, m.size])).toEqual([[BARS[4].t, 1.6]])
    // no dashed average while the switch is off (the plan skips the plot), and the
    // columns no plot draws (dotNL, mansfield, ratingLine…) create no series at all:
    // the line and the two glyph hosts that have a point (the hidden column is
    // computed, never a series; the all-NaN red-day column binds nothing)
    expect(fake.seriesCreated.some((s) => s.__options.lineStyle === 3 || s.__options.color === '#8a8574')).toBe(false)
    expect(fake.seriesCreated.length).toBe(3)
    const on = drive({ showAverage: true })
    const ma = on.fake.seriesCreated.find((s) => s.__options.color === '#8a8574')
    expect(ma, 'the dashed average while Show average holds').toBeTruthy()
    expect(on.dataOf(ma).map((p) => ('value' in p ? p.value : null))).toEqual(COLUMNS.rsMa)
  })
})

describe('6 · the settings dialog on the slim definition', () => {
  const INST = 'inst:rsLine:1'
  function Harness({ initial }) {
    const [cs, setCs] = useState(initial)
    return h(IndicatorSettingsDialog, { open: true, instanceId: INST, settings: cs, registry: REGISTRY,
      onChange: (next) => setCs(next), onClose: () => {} })
  }
  const mount = (inputs = {}) => {
    render(h(Harness, { initial: { ...mergeChartSettings(null), indicatorInstances: [{ instanceId: INST, defId: 'rsLine', inputs, hidden: false }] } }))
    const dialog = screen.getByRole('dialog')
    for (const b of dialog.querySelectorAll('button[aria-expanded="false"]')) act(() => { fireEvent.click(b) })
    return dialog
  }

  it('no Preset row; the CORE groups (Line holds only Style-tab inputs); a row for every rendered control, none for a legacy one', () => {
    const dialog = mount()
    expect(dialog.querySelector('[data-testid="preset-picker"]')).toBeNull()
    const heads = [...dialog.querySelectorAll('button[aria-expanded]')].map((b) => b.textContent)
    expect(heads).toEqual(['Simple', 'Average', 'New highs', 'Rating'])
    // CORE holds every rendered input that is not the Style tab's (colours, the line width) or the gated box
    const style = styleInputKeys(SLIM)
    expect([...style].sort()).toEqual(['color', 'dotBeforePriceColor', 'dotColor', 'dotRedColor', 'lineWidth', 'maColor'])
    // (the gated boxes: Your symbol, and since 2026-11-12 the picked sector and theme)
    const GATED = ['customBenchmark', 'sectorBenchmark', 'themeBenchmark']
    for (const k of RENDERED.filter((k) => !GATED.includes(k) && !style.has(k))) {
      expect(dialog.querySelector(`[data-input-key="${k}"]`), k).not.toBeNull()
    }
    for (const k of ['view', 'showMansfield', 'mansfieldLength', 'anchorDate', 'headlineRating', 'showComponents', 'shadeVsAverage', 'rrgRatioLength']) {
      expect(dialog.querySelector(`[data-input-key="${k}"]`), `${k} is legacy`).toBeNull()
    }
  })
})

describe('7 · the module keeps both raws and the flag reader', () => {
  it('exports RS_LINE_V5_RAW, RS_LINE_SLIM_RAW, RS_CLASSIC_INPUTS and rsSplitEnabled', () => {
    expect(typeof nativeRegistry.rsSplitEnabled).toBe('function')
    expect(RS_LINE_V5_RAW.id).toBe('rsLine')
    expect(RS_LINE_SLIM_RAW.id).toBe('rsLine')
    expect(Object.isFrozen(RS_CLASSIC_INPUTS)).toBe(true)
    expect(RS_CLASSIC_INPUTS).toEqual({ maLength: 21, maType: 'EMA', lookback: 252, color: RS_INFO, lineDownColor: RS_INFO, dotColor: RS_INFO,
      view: 'ratio', showMansfield: false, showRedDay: false, showNewLow: false, showNewHighBeforePrice: true, dotRedColor: RS_INFO })
  })
})
