// app/src/components/chart/engine/__tests__/rsDesignRound.test.js
//
// ─── UCT RS · the design round inspired by Deepvue's RS pane (2026-11-08) ────
//
// Three presentation features, each a GENERIC engine field the RS definition
// declares (no `rsLine` literal in the engine):
//
//   1. the ranks table      — `meta.paneTable`   (`engine/paneTable.js`)
//   2. the band to the MA   — `plots[].fill.activeWhen` (`binder.fillActiveFor`)
//   3. the cross markers    — `plots[].derive`  (`engine/derivedColumns.js`)
//
// and the rails around them: none of the three new inputs is a server input, the
// presets stay exact (`detectPreset`), a saved Classic chart draws as before, and
// the palette budget holds per view.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { getDefinition, resolveInputs, computeFor, columnKeys } from '../nativeRegistry'
import { validateDefinition } from '../defSchema'
import { paneTableFor, paneTableShownOn, paneTableFits, MISSING_TEXT, validatePaneTable } from '../paneTable'
import { withDerivedColumns, deriveColumn } from '../derivedColumns'
import { primeServerColumns, clearServerColumns, pickServerInputs } from '../serverCompute'
import { detectPreset } from '../instanceControls'
import { legendChips } from '../readout'
import { createBinder } from '../binder'
import { createFakeChart } from './fakeChart'
import { IND_TOKENS } from '../../designTokens'

const RS = getDefinition('rsLine')
const NEW_INPUTS = ['shadeVsAverage', 'showCrossMarkers', 'showRanksTable']

// Round 2 (rev 5): the v4 payload carries `m9`, so the table prints five ranks.
const RATING = Object.freeze({
  ibd: 94, fast: 91, asof: '2026-11-06', d5: 2, d20: 7, m1: 91, m3: 97, m6: 95, m9: 93, m12: 96,
  source: 'row', summary: '94 · fast 91', components: '1M 91 · 3M 97 · 6M 95 · 9M 93 · 12M 96',
})
const RANKS = [['1M', '91'], ['3M', '97'], ['6M', '95'], ['9M', '93'], ['12M', '96'], ['RS', '94']]
const payload = (rating = RATING) => ({ rating })
const cols = (t) => t.columns.map((c) => [c.label, c.text])

describe('the three new inputs are presentation inputs', () => {
  it('declared once each, in their groups, with the defaults the brief names', () => {
    const by = Object.fromEntries(RS.inputs.map((i) => [i.key, i]))
    expect(by.shadeVsAverage).toMatchObject({ type: 'bool', default: false, group: 'Line', label: 'Shade vs avg' })
    expect(by.showCrossMarkers).toMatchObject({ type: 'bool', default: false, group: 'Line', label: 'Cross markers' })
    expect(by.showRanksTable).toMatchObject({ type: 'bool', default: true, group: 'Rating', label: 'Ranks table' })
    expect(by.showRanksTable.activeWhen).toEqual({ key: 'showRating', equals: true })
    for (const k of NEW_INPUTS) {
      expect(by[k].label.length, `${k}: the inspector's label column fits 14 characters`).toBeLessThanOrEqual(14)
      expect(by[k].tooltip, k).toMatch(/^[A-Z][^!]*\.$/)
      expect(by[k].tooltip, `${k}: RS is the tool, never RSI`).not.toMatch(/\bRSI\b|buy|sell/i)
    }
  })

  it('⛔ none of them keys the fetch: not in meta.serverInputs, never picked for the server', () => {
    for (const k of NEW_INPUTS) expect(RS.meta.serverInputs, k).not.toContain(k)
    const sent = pickServerInputs(RS, resolveInputs(RS, { shadeVsAverage: true, showCrossMarkers: true, showRanksTable: false }))
    for (const k of NEW_INPUTS) expect(sent, k).not.toHaveProperty(k)
    // so turning any of them on is the SAME request, and compute.rev stays where it was
    expect(pickServerInputs(RS, resolveInputs(RS, { shadeVsAverage: true }))).toEqual(pickServerInputs(RS, resolveInputs(RS, {})))
    expect(RS.compute.rev).toBe(5)        // rev 5 is round 2's Reading, not these presentation inputs
  })

  it('the definition still validates through the schema, and the engine names no tenant in the new modules', () => {
    expect(validateDefinition(RS).ok).toBe(true)
    for (const f of ['paneTable.js', 'derivedColumns.js']) {
      const src = readFileSync(resolve(process.cwd(), 'src/components/chart/engine', f), 'utf8')
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
      expect(code.length, f).toBeGreaterThan(400)
      expect(code.includes("'rsLine'") || code.includes('"rsLine"'), `${f} names the RS definition`).toBe(false)
      expect(code.includes('rating.'), `${f} knows a payload key`).toBe(false)
    }
  })
})

// ─── 1. the ranks table ─────────────────────────────────────────────────────
describe('the ranks table (meta.paneTable)', () => {
  it('prints 1M 3M 6M 9M 12M and the rating, in that order, from the payload', () => {
    const t = paneTableFor(RS, payload(), { inputs: {} })
    expect(cols(t)).toEqual(RANKS)
    expect(t.label).toBe('RS ranks')
    expect(t.columns.find((c) => c.key === 'rating').emphasis).toBe(true)
    expect(t.columns.filter((c) => c.emphasis)).toHaveLength(1)
  })

  it('⭐ round 2: 9M is a REQUIRED column, between 6M and 12M; a rank not stored yet is a muted dash', () => {
    expect(RS.meta.paneTable.columns.find((c) => c.key === 'm9')).toEqual({ key: 'm9', label: '9M', source: 'scalar:rating.m9' })
    expect(RS.meta.paneTable.columns.some((c) => c.optional)).toBe(false)
    // a row stored before the 9M rank existed (null until `--fill-column m9`)
    const nul = paneTableFor(RS, payload({ ...RATING, m9: null }), {})
    expect(cols(nul)[3]).toEqual(['9M', MISSING_TEXT])
    // a payload with no key at all (a v3 server) still prints the column, as a dash
    const { m9, ...v3 } = RATING
    expect(m9).toBe(93)
    expect(cols(paneTableFor(RS, payload(v3), {}))[3]).toEqual(['9M', MISSING_TEXT])
  })

  it('⛔ a missing rank is a muted dash, never a number; a young listing keeps its other ranks', () => {
    const t = paneTableFor(RS, payload({ ...RATING, m12: null, components: '1M 91 · 3M 97 · 6M 95' }), {})
    const m12 = t.columns.find((c) => c.key === 'm12')
    expect(m12).toMatchObject({ text: MISSING_TEXT, missing: true, value: null })
    expect(m12.band).toBeUndefined()
    // anything that is not a 1-99 whole number is missing too
    for (const bad of [0, 100, 50.5, '91', NaN]) {
      expect(paneTableFor(RS, payload({ ...RATING, m1: bad }), {}).columns[0].text, String(bad)).toBe(MISSING_TEXT)
    }
  })

  it('⛔ hidden when the rating is off, the table is off, or the server has no row', () => {
    expect(paneTableFor(RS, payload(), { inputs: { showRating: false } })).toBeNull()
    expect(paneTableFor(RS, payload(), { inputs: { showRanksTable: false } })).toBeNull()
    // the dark / missing row the provider sends: every value None, asof None
    const none = { ibd: null, fast: null, asof: null, d5: null, d20: null, m1: null, m3: null, m6: null, m12: null,
      source: 'missing', summary: null, components: null }
    expect(paneTableFor(RS, payload(none), {})).toBeNull()
    // …and with a row but no rank at all, there is no row of dashes either
    expect(paneTableFor(RS, payload({ ...none, asof: '2026-11-06', source: 'row', fast: 91 }), {})).toBeNull()
    expect(paneTableFor(RS, null, {})).toBeNull()
    expect(paneTableFor(RS, { rating: null }, {})).toBeNull()
  })

  it('colours by the site\'s rating bands only while Rating colours is on', () => {
    const on = paneTableFor(RS, payload({ ...RATING, m1: 35, m3: 45, m6: 65 }), {})
    expect(on.columns.map((c) => c.band)).toEqual(['lag', 'neutral', 'strong', 'lead', 'lead', 'lead'])
    const off = paneTableFor(RS, payload(), { inputs: { ratingBands: false } })
    expect(off.columns.every((c) => c.band === undefined)).toBe(true)
  })

  it('daily charts only', () => {
    const t = paneTableFor(RS, payload(), {})
    expect(paneTableShownOn(t, 'D')).toBe(true)
    for (const tf of ['W', 'M', '60', '5', '2D', undefined]) expect(paneTableShownOn(t, tf), String(tf)).toBe(false)
    expect(paneTableShownOn(null, 'D')).toBe(false)
  })

  it('rides the chip, from the SAME scalars read as the readout rows', () => {
    const inst = { instanceId: 'rsLine', defId: 'rsLine', inputs: {} }
    const registry = { getDefinition, listDefinitions: () => [RS] }
    const scalarsOf = () => payload()
    const chip = legendChips([], null, registry, [inst], { scalarsOf }).find((c) => c.plotKey === 'rsLine')
    expect(chip.paneTable && cols(chip.paneTable)).toEqual(RANKS)
    expect(chip.readout.find((r) => r.key === 'rating').text).toBe('94')
    // no reader, or nothing landed: no table field at all
    expect(legendChips([], null, registry, [inst]).find((c) => c.plotKey === 'rsLine')).not.toHaveProperty('paneTable')
    expect(legendChips([], null, registry, [inst], { scalarsOf: () => null })
      .find((c) => c.plotKey === 'rsLine')).not.toHaveProperty('paneTable')
  })

  it('the collision rule: shown only while it clears the pane label by 12 px', () => {
    // desktop: 1100 px plot, label ends at 260, table 170 wide
    expect(paneTableFits({ plotWidth: 1100, labelRight: 260, tableWidth: 170 })).toBe(true)
    // 390 px phone: ~340 px plot, the label ends near 230, the table does not fit
    expect(paneTableFits({ plotWidth: 340, labelRight: 230, tableWidth: 170 })).toBe(false)
    // the boundary is exact: left edge = 340 - 6 - 100 = 234 ≥ 222 + 12
    expect(paneTableFits({ plotWidth: 340, labelRight: 222, tableWidth: 100 })).toBe(true)
    expect(paneTableFits({ plotWidth: 340, labelRight: 223, tableWidth: 100 })).toBe(false)
    expect(paneTableFits({ plotWidth: NaN, labelRight: 0, tableWidth: 0 })).toBe(false)
  })

  it('⛔ the schema refuses a malformed table, fail closed', () => {
    const errs = (spec) => { const e = []; validatePaneTable(spec, RS, e, { isValidTf: (t) => ['D', 'W'].includes(t) }); return e }
    expect(errs(RS.meta.paneTable)).toEqual([])
    expect(errs('table')).toHaveLength(1)
    expect(errs({ ...RS.meta.paneTable, colour: 'gold' }).join()).toMatch(/unknown pane table field/)
    expect(errs({ ...RS.meta.paneTable, columns: [] }).join()).toMatch(/non-empty array/)
    expect(errs({ ...RS.meta.paneTable, timeframes: ['daily'] }).join()).toMatch(/not a chart timeframe/)
    expect(errs({ ...RS.meta.paneTable, when: ['input:noSuchSwitch'] }).join()).toMatch(/names no declared input/)
    expect(errs({ ...RS.meta.paneTable, when: ['nonsense'] }).join()).toMatch(/expected a readout source/)
    const col = (c) => errs({ ...RS.meta.paneTable, columns: [{ key: 'a', label: '1M', source: 'scalar:rating.m1', ...c }] })
    expect(col({ label: 'One month' }).join()).toMatch(/column code of 1 to 4/)
    expect(col({ source: 'input:showRating' }).join()).toMatch(/scalar/)
    expect(col({ bold: true }).join()).toMatch(/unknown column field/)
    expect(col({ optional: true }).join()).toMatch(/every column is optional/)
    expect(errs({ ...RS.meta.paneTable, columns: [...RS.meta.paneTable.columns, RS.meta.paneTable.columns[0]] }).join())
      .toMatch(/declared twice/)
    // and the whole-definition door refuses it too
    const bad = { ...RS, meta: { ...RS.meta, paneTable: { columns: [] } } }
    expect(validateDefinition(bad).ok).toBe(false)
  })
})

// ─── 2. the band to the average ─────────────────────────────────────────────
describe('the shaded band (plots[].fill.activeWhen)', () => {
  const line = RS.plots.find((p) => p.key === 'rsLine')

  it('is a declared fill to the average, bull above and bear below on rsAbove, a low tint, switched by shadeVsAverage', () => {
    expect(line.fill).toEqual({ with: 'rsMa', colorMode: 'column:rsAbove', colorUp: IND_TOKENS.classic.bull,
      colorDown: IND_TOKENS.classic.bear, activeWhen: { key: 'shadeVsAverage', equals: true } })
    expect(line.fillOpacity).toBeGreaterThan(0)
    expect(line.fillOpacity).toBeLessThanOrEqual(0.15)
  })

  const BARS = Array.from({ length: 4 }, (_, i) => ({ t: 1700000000 + i * 60, c: 10 + i }))
  const DEF = {
    schemaVersion: 1, id: 'u_shade', version: 1, compute: { kind: 'native', fn: 'rsi', rev: 1 },
    meta: { name: 'Shade fixture' }, placement: { target: 'pane' }, events: [],
    inputs: [{ key: 'shade', type: 'bool', label: 'Shade', default: false }],
    plots: [
      { key: 'upper', label: 'U', style: 'line', color: '#2962FF', legend: { decimals: 2 },
        fill: { with: 'lower', activeWhen: { key: 'shade', equals: true } } },
      { key: 'lower', label: 'L', style: 'line', legend: { decimals: 2 } },
    ],
  }
  const harness = () => {
    const fake = createFakeChart()
    const binder = createBinder({ chart: fake.chart, LWC: fake.LWC })
    const registry = {
      getDefinition: (id) => (id === DEF.id ? DEF : null),
      computeFor: () => ({ upper: [3, 4, 5, 6], lower: [1, 1, 1, 1] }),
      hasAnyFinite: (col) => Array.isArray(col) && col.some(Number.isFinite),
      columnKeys: (d) => d.plots.map((p) => p.key),
    }
    const run = (inputs) => binder.sync({
      enabled: true, instances: [{ instanceId: 'i1', defId: DEF.id, inputs }], registry, bars: BARS,
      adjustTime: (t) => t, plan: { fresh: true }, applyData: (s, d) => s.setData(d),
      resolvePlacement: () => ({ paneIndex: 1, scaleId: 's', scaleOptions: {} }),
    })
    const count = (m) => fake.calls.filter((c) => c.method === m).length
    return { run, count }
  }

  it('the binder attaches the band only while the switch holds, and takes it off again', () => {
    const h = harness()
    h.run({})                            // the declared default: off
    expect(h.count('attachPrimitive')).toBe(0)
    h.run({ shade: true })
    expect(h.count('attachPrimitive')).toBe(1)
    h.run({ shade: true })               // a second pass reuses it
    expect(h.count('attachPrimitive')).toBe(1)
    h.run({ shade: false })
    expect(h.count('detachPrimitive')).toBe(1)
  })

  it('⛔ the schema refuses a band gated on nothing real', () => {
    const plot = (fill) => ({ ...DEF, plots: [{ ...DEF.plots[0], fill }, DEF.plots[1]] })
    expect(validateDefinition(DEF).ok).toBe(true)
    for (const aw of [{ key: 'nope', equals: true }, { equals: true }, { key: 'shade' }, 'shade', { key: 'shade', equals: true, gt: 1 }]) {
      const r = validateDefinition(plot({ with: 'lower', activeWhen: aw }))
      expect(r.ok, JSON.stringify(aw)).toBe(false)
      expect(r.errors.join(), JSON.stringify(aw)).toMatch(/fill\.activeWhen/)
    }
  })
})

// ─── 3. the cross markers ───────────────────────────────────────────────────
const FIX = [join(process.cwd(), '..', 'tests', 'fixtures', 'indicators'), join(process.cwd(), 'tests', 'fixtures', 'indicators')]
  .find((p) => existsSync(join(p, 'rs_events_default.json')))
const CASE = JSON.parse(readFileSync(join(FIX, 'rs_events_default.json'), 'utf8'))

describe('the cross markers (plots[].derive)', () => {
  const up = RS.plots.find((p) => p.key === 'dotCrossUp')
  const down = RS.plots.find((p) => p.key === 'dotCrossDown')

  it('two small arrow glyphs ON the line, in the line\'s own colour for each side', () => {
    expect(up.$refs.color).toBe('color')
    expect(down.$refs.color).toBe('lineDownColor')
    expect(up).toMatchObject({ style: 'markers', restyle: false,
      marker: { shape: 'arrowUp', position: 'inBar', size: 0.6 },
      derive: { from: 'rsLine', where: 'crossUp', activeWhen: { key: 'showCrossMarkers', equals: true } } })
    expect(down).toMatchObject({ style: 'markers',
      marker: { shape: 'arrowDown', position: 'inBar', size: 0.6 },
      derive: { from: 'rsLine', where: 'crossDown' } })
    // declared before the large glyphs, so gold paints on top where both fire
    const order = RS.plots.map((p) => p.key)
    expect(order.indexOf('dotCrossDown')).toBeLessThan(order.indexOf('dotNHred'))
    expect(order.indexOf('dotCrossDown')).toBeLessThan(order.indexOf('dotNHbeforePx'))
    expect(columnKeys(RS)).toContain('dotCrossUp')
  })

  it('⭐ on the shared fixture: the RS value exactly where crossUp / crossDown fired, NaN elsewhere', () => {
    const e = CASE.expected
    const num = (a) => a.map((v) => (v === null ? NaN : v))
    const c = { rsLine: num(e.rsLine), crossUp: num(e.crossUp), crossDown: num(e.crossDown) }
    const out = withDerivedColumns(RS, c, resolveInputs(RS, { showCrossMarkers: true }))
    for (const [key, ev] of [['dotCrossUp', 'crossUp'], ['dotCrossDown', 'crossDown']]) {
      let fired = 0
      out[key].forEach((v, i) => {
        if (e[ev][i] === 1) { expect(v, `${key}[${i}]`).toBe(e.rsLine[i]); fired += 1 } else expect(Number.isNaN(v), `${key}[${i}]`).toBe(true)
      })
      expect(fired, `${ev} never fires on the fixture — it pins nothing`).toBeGreaterThan(0)
    }
    // the caller's object is never mutated (it is a cached envelope's alignment)
    expect(c).not.toHaveProperty('dotCrossUp')
  })

  it('⛔ absent while the switch is off; the server wins when it sends the column itself', () => {
    const c = { rsLine: [1, 2, 3], crossUp: [0, 1, 0], crossDown: [0, 0, 1] }
    const off = withDerivedColumns(RS, c, resolveInputs(RS, {}))
    expect(off).toBe(c)
    const sent = { ...c, dotCrossUp: [9, 9, 9] }
    const on = withDerivedColumns(RS, sent, resolveInputs(RS, { showCrossMarkers: true }))
    expect(on.dotCrossUp).toEqual([9, 9, 9])
    expect([...on.dotCrossDown].map((v) => (Number.isNaN(v) ? null : v))).toEqual([null, null, 3])
    // a Reading that blanks the line blanks the markers by construction
    expect([...deriveColumn([NaN, NaN, NaN], [0, 1, 0])].every(Number.isNaN)).toBe(true)
    expect(deriveColumn([1, 2], [0, 1, 0])).toBeNull()
  })

  it('⭐ end to end through computeFor: a landed envelope grows the markers only when the member asks', () => {
    clearServerColumns()
    const times = CASE.bars.map((b) => b.t)
    const wire = { times, rev: 4, columns: { rsLine: CASE.expected.rsLine, crossUp: CASE.expected.crossUp, crossDown: CASE.expected.crossDown } }
    const ctx = { sym: 'NVDA', tf: 'D' }
    primeServerColumns('rsLine', 'NVDA', 'D', pickServerInputs(RS, resolveInputs(RS, {})), wire)
    const plain = computeFor(RS, CASE.bars, {}, ctx)
    expect(Object.keys(plain).sort()).toEqual(['crossDown', 'crossUp', 'rsLine'])
    const marked = computeFor(RS, CASE.bars, { showCrossMarkers: true }, ctx)
    expect(Object.keys(marked).sort()).toEqual(['crossDown', 'crossUp', 'dotCrossDown', 'dotCrossUp', 'rsLine'])
    clearServerColumns()
  })

  it('⛔ the schema: only a markers plot, only on the server lane, from a real data plot, no unknown field', () => {
    const withPlot = (p, compute = RS.compute) => validateDefinition({ ...RS, compute, plots: [...RS.plots.filter((q) => q.key !== 'dotCrossUp'), { ...up, ...p }] })
    expect(withPlot({}).ok).toBe(true)
    const bad = (p, re, compute) => {
      const r = withPlot(p, compute)
      expect(r.ok, re.source).toBe(false)
      expect(r.errors.join('\n')).toMatch(re)
    }
    bad({ style: 'line', marker: undefined }, /only a "markers" plot derives/)
    bad({ derive: { ...up.derive, from: 'nowhere' } }, /names no declared plot/)
    bad({ derive: { ...up.derive, from: 'dotCrossUp' } }, /cannot derive from itself/)
    bad({ derive: { ...up.derive, from: 'mansfieldZero' } }, /is a guide/)
    bad({ derive: { ...up.derive, from: 'dotCrossDown' } }, /is itself derived/)
    bad({ derive: { ...up.derive, where: '' } }, /0\/1 event column/)
    bad({ derive: { ...up.derive, colour: 'red' } }, /unknown field/)
    bad({ derive: { ...up.derive, activeWhen: { key: 'nope', equals: true } } }, /derive\.activeWhen/)
  })
})

// ─── the presets stay exact ─────────────────────────────────────────────────
describe('presets: exact, and a saved chart is unchanged', () => {
  const preset = (id) => RS.meta.presets.find((p) => p.id === id)
  const values = (stored) => resolveInputs(RS, stored)
  const ctx = (inputs, extra = {}) => ({ instance: { instanceId: 'rsLine', defId: 'rsLine', inputs, ...extra }, def: RS })

  it('⛔ owner decision: NO preset sets the band, the markers or the table — they are the member\'s own switches', () => {
    for (const p of RS.meta.presets) {
      for (const k of NEW_INPUTS) expect(p.inputs, `${p.id} sets ${k}`).not.toHaveProperty(k)
    }
  })

  it('an untouched (or saved v1) instance is still Classic, and draws no band and no markers', () => {
    for (const stored of [{}, { benchmark: 'QQQ', color: '#4ECDC4', lineWidth: 2 }]) {
      const v = values(stored)
      expect(v.shadeVsAverage).toBe(false)
      expect(v.showCrossMarkers).toBe(false)
    }
    expect(detectPreset(RS.meta.presets, values({}), ctx({}))?.id).toBe('classic')
  })

  it('each preset reads back as itself, and the switches never move the picker', () => {
    for (const id of ['classic', 'classicWeekly', 'phase']) {
      const p = preset(id)
      expect(detectPreset(RS.meta.presets, values(p.inputs), ctx(p.inputs))?.id, id).toBe(id)
      // the band and the markers on by hand: still the same preset
      const tuned = { ...p.inputs, shadeVsAverage: true, showCrossMarkers: true }
      expect(detectPreset(RS.meta.presets, values(tuned), ctx(tuned))?.id, `${id} + band + markers`).toBe(id)
    }
    const stressed = { ...preset('stress').inputs, shadeVsAverage: true }
    const stressInst = { visibility: { preset: 'dailyUp' }, presentation: { plots: { dotNHred: { dotSize: 'large' } } } }
    expect(detectPreset(RS.meta.presets, values(stressed), ctx(stressed, stressInst))?.id).toBe('stress')
  })

  it('⭐ a Phase chart saved BEFORE this round (no key for either switch) still reads Phase and draws exactly as it did', () => {
    // the stored inputs a pre-round Phase pick wrote: the preset's own, byte for byte
    const old = { ...preset('phase').inputs }
    expect(old).not.toHaveProperty('shadeVsAverage')
    expect(old).not.toHaveProperty('showCrossMarkers')
    const v = values(old)
    expect(v.shadeVsAverage).toBe(false)     // no band appears on it by itself
    expect(v.showCrossMarkers).toBe(false)   // and no markers
    expect(detectPreset(RS.meta.presets, v, ctx(old))?.id).toBe('phase')
    // …and the same chart with the band turned on by hand is still Phase
    const banded = { ...old, shadeVsAverage: true }
    expect(detectPreset(RS.meta.presets, values(banded), ctx(banded))?.id).toBe('phase')
  })
})

// ─── the palette budget per view ────────────────────────────────────────────
describe('the palette budget with the band and the markers drawn', () => {
  const NEUTRAL = IND_TOKENS.classic.neutral.toLowerCase()
  const defaults = Object.fromEntries(RS.inputs.map((i) => [i.key, i.default]))
  const hex = (v, inputs) => (typeof v === 'string' && v.startsWith('$') ? inputs[v.slice(1)] : v)
  const hues = (presetInputs, keys) => {
    const inputs = { ...defaults, ...presetInputs }
    const out = new Set()
    for (const p of RS.plots.filter((q) => keys.includes(q.key))) {
      for (const f of ['color', 'colorUp', 'colorDown']) {
        const h = hex(p.$refs && p.$refs[f] ? `$${p.$refs[f]}` : p[f], inputs)
        if (typeof h === 'string' && h.toLowerCase() !== NEUTRAL) out.add(h.toLowerCase())
      }
      if (p.fill && inputs[p.fill.activeWhen.key] === p.fill.activeWhen.equals) {
        for (const f of ['colorUp', 'colorDown']) out.add(String(p.fill[f]).toLowerCase())
      }
    }
    return out
  }
  const phase = RS.meta.presets.find((p) => p.id === 'phase').inputs

  it('Phase with the band and the markers switched on: no hue added — still bull, bear and the gold', () => {
    const h = hues({ ...phase, shadeVsAverage: true, showCrossMarkers: true },
      ['rsLine', 'rsMa', 'dotNH', 'dotNHbeforePx', 'dotNHpartial', 'dotCrossUp', 'dotCrossDown'])
    expect([...h].sort()).toEqual([IND_TOKENS.classic.bull, IND_TOKENS.classic.bear, IND_TOKENS.classic.premium].map((c) => c.toLowerCase()).sort())
  })

  it('Classic with the markers on: one blue, the direction told by the triangle\'s shape — no new hue', () => {
    const classic = RS.meta.presets.find((p) => p.id === 'classic').inputs
    const h = hues({ ...classic, showCrossMarkers: true }, ['rsLine', 'rsMa', 'dotCrossUp', 'dotCrossDown'])
    expect([...h]).toEqual([IND_TOKENS.classic.info.toLowerCase()])
  })

  it('Rotation, Quality and VARS draw neither: the server blanks the line the band and the markers ride', () => {
    // the derived markers read rsLine, and the band's two edges are rsLine and rsMa —
    // all three in the ratio family `_RS_VIEW_FAMILIES` blanks under every other view
    const blank = { rsLine: [NaN, NaN, NaN], rsMa: [NaN, NaN, NaN], crossUp: [0, 1, 0], crossDown: [1, 0, 0] }
    const out = withDerivedColumns(RS, blank, resolveInputs(RS, { view: 'rotation', showCrossMarkers: true }))
    expect([...out.dotCrossUp, ...out.dotCrossDown].every(Number.isNaN)).toBe(true)
  })
})

beforeEach(() => clearServerColumns())
