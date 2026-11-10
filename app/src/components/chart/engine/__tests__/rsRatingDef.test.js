// app/src/components/chart/engine/__tests__/rsRatingDef.test.js
//
// ─── UCT RS Rating (`rsRating`), unit U6 of the RS split (2026-11-09) ────────
//
// Against the REGISTERED definition (never a copy). What this file pins:
//
//   1. the identity: version 1, `compute {server, rsRating, rev 1}`, registered
//      beside `rsLine` on the server lane, schema-valid, `meta.requiresServer`,
//      an own pane with the U3 floor and a VISIBLE axis (80 and 90 are levels);
//   2. the server inputs are the row's: NONE (`serverInputs: []`), so the fetch
//      is keyed on the symbol alone and a colour never reaches it;
//   3. every scalar path it reads is in the U4 contract (`rsSplitContract.json`);
//   4. hidden from every offer surface until the live server lists the id;
//   5. daily only (`meta.timeframes`), the rsLine rev 5 plots moved across
//      field for field, the ranks table, the readout rows and the pane label;
//   6. a placed instance drawn through the real binder on the rev 5 fixture
//      (`rs_rating_view.json`), and fail-closed (blank + the server's reason)
//      when the history is dark.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { getDefinition, SERVER_DEFS, computeFor, resolveInputs } from '../nativeRegistry'
import * as engineRegistry from '../nativeRegistry'
import { validateDefinition } from '../defSchema'
import {
  isDefinitionOffered, primeServerDefinitions, clearServerDefinitions, pickServerInputs, clearServerColumns, scalarsFor,
} from '../serverCompute'
import { readoutRows, readoutChipRows } from '../readoutSchema'
import { readoutFallbackValue } from '../readout'
import { paneTableFor } from '../paneTable'
import { validateInstance } from '../instances'
import { eligibleInstances } from '../eligibility'
import { libraryRows } from '../../discoveryCatalog'
import { IND_TOKENS } from '../../designTokens'
import {
  RS_SPLIT_CONTRACT, loadCase, scalarPathsOf, labelsOf, wireFrom, primeEnvelope, placed, bindOnce, seriesWithData, CTX,
} from './rsSplitTestKit'

const DEF = getDefinition('rsRating')
const RS = getDefinition('rsLine')
const CONTRACT = RS_SPLIT_CONTRACT.rsRating
const NB = ' '   // the server's non-breaking space inside `up 20` / `20 sessions`

/** The rev 5 hand-checkable case: 30 sessions, 24 stored ratings, 60 → 83. */
const CASE = loadCase('rs_rating_view')
const BARS = CASE.sessions.map((t) => ({ t, o: 100, h: 101, l: 99, c: 100, v: 1 }))
/** The envelope `rs_rating_envelope` sends (`tests/test_rs_split_rows.py` proves
 *  every path), the `ratingHistory` block being the fixture's own. */
const PAYLOAD = Object.freeze({
  rating: { ibd: 83, m1: 50, m3: 60, m6: 70, m9: 80, m12: 90, asof: '2026-11-06', summary: '83',
    components: '1M 50 · 3M 60 · 6M 70 · 9M 80 · 12M 90', source: 'row' },
  ratingHistory: CASE.expected.block,
  history: { bars: 30, requested: 852, short: true },
  inputs: {}, intraday: false, state: 'ok',
})
const DARK = Object.freeze({
  rating: { ibd: null, m1: null, m3: null, m6: null, m9: null, m12: null, asof: null, summary: null, components: null, source: 'dark' },
  ratingHistory: { value: null, average: null, change20: null, sessions: 0, asof: null, stale: null,
    summary: 'the rating history is not switched on', reason: 'the rating history is not switched on' },
  history: { bars: 30, requested: 852, short: true },
  inputs: {}, intraday: false, state: 'ok',
})
const wire = (payload = PAYLOAD) => wireFrom(BARS, { ratingLine: CASE.expected.ratingLine, ratingMa: CASE.expected.ratingMa }, payload)
const blankWire = () => wireFrom(BARS, { ratingLine: BARS.map(() => null), ratingMa: BARS.map(() => null) }, DARK)

beforeEach(() => { clearServerDefinitions(); clearServerColumns() })
afterEach(() => { clearServerDefinitions(); clearServerColumns() })

describe('1 · the identity', () => {
  it('is version 1 on the server lane, registered beside rsLine, and validates', () => {
    expect(DEF).toMatchObject({ id: 'rsRating', version: 1, compute: { kind: 'server', fn: 'rsRating', rev: 1 } })
    expect(validateDefinition(DEF).ok).toBe(true)
    expect(SERVER_DEFS.map((d) => d.id)).toEqual(['rsLine', 'rsRating', 'rsPhases', 'rsVsEma'])
    expect(DEF.meta).toMatchObject({ name: 'UCT RS Rating', shortName: 'UCT RS Rating', category: RS.meta.category,
      tier: 'premium', repaint: 'non-repainting', requiresServer: true, quickMenu: false, timeframes: ['D'] })
    expect(DEF.meta.description.split(/[.!?](\s|$)/).filter((s) => s.trim()).length, 'one sentence').toBe(1)
    expect(DEF.meta.presets).toBeUndefined()
    expect(DEF.meta.searchHint).toBeUndefined()
    expect(DEF.inputs.find((i) => i.key === 'view')).toBeUndefined()
  })

  it('takes its own pane at 0.20 with the U3 floor, and SHOWS its axis', () => {
    expect(DEF.placement).toEqual({ target: 'pane', pane: { height: 0.20, minPx: 64 }, axis: 'visible' })
  })

  it('every member-facing label is at most 18 characters', () => {
    for (const [kind, key, label] of labelsOf(DEF)) expect(label.length, `${kind} ${key}: "${label}"`).toBeLessThanOrEqual(18)
  })
})

describe('2 · the server inputs', () => {
  it('sends nothing: the row declares no input, so colours and width stay on the client', () => {
    expect(DEF.meta.serverInputs).toEqual(CONTRACT.inputs)
    expect(DEF.meta.serverInputs).toEqual([])
    expect(pickServerInputs(DEF, resolveInputs(DEF, { color: '#fff', lineWidth: 3 }))).toEqual({})
    expect(DEF.inputs.map((i) => i.key)).toEqual(['color', 'lineWidth'])
    expect(DEF.inputs.every((i) => i.group === 'Style')).toBe(true)
  })
})

describe('3 · the scalar paths', () => {
  it('reads only paths the U4 contract proves present', () => {
    const paths = scalarPathsOf(DEF)
    expect(paths.length).toBeGreaterThan(8)
    for (const p of paths) expect(CONTRACT.paths, p).toContain(p)
  })
})

describe('4 · the definition gate', () => {
  it('is not offered until the live server lists its id — then it is', () => {
    expect(isDefinitionOffered(DEF)).toBe(false)
    const offered = () => libraryRows(engineRegistry).filter((r) => r.kind === 'technical').map((r) => r.id)
    expect(offered()).not.toContain('rsRating')
    primeServerDefinitions({ schemaVersion: 1, definitions: [{ schemaVersion: 1, id: 'rsRating', version: 1,
      compute: { kind: 'server', fn: 'rsRating', rev: 1 }, inputs: [], columns: ['ratingLine', 'ratingMa'] }] })
    expect(isDefinitionOffered(DEF)).toBe(true)
    expect(offered()).toContain('rsRating')
  })

  it('a placed instance validates (F20 never drops it) whatever the server says', () => {
    const v = validateInstance(placed(DEF), engineRegistry)
    expect(v.ok, JSON.stringify(v.errors)).toBe(true)
  })
})

describe('5 · the plots, the table and the readout', () => {
  const plot = (k) => DEF.plots.find((p) => p.key === k)

  it('the rev 5 Rating Reading plots, field for field, with the member\'s colour and width on the line', () => {
    expect(plot('ratingLine')).toMatchObject({ style: 'line', precision: 0, role: 'primary', legend: { decimals: 0 },
      autoscaleInclude: { min: 80, max: 99 } })
    expect(plot('ratingLine').$refs).toEqual({ color: 'color', width: 'lineWidth' })
    expect(plot('ratingMa')).toMatchObject({ style: 'line', color: IND_TOKENS.classic.neutral, width: 1, lineStyle: 'largeDashed', precision: 2 })
    expect(plot('ratingMa').lineStyle).toBe(RS.plots.find((p) => p.key === 'rsMa').lineStyle)
    expect(plot('ratingGuides')).toMatchObject({ style: 'hlines', levels: [80, 90], color: IND_TOKENS.classic.neutral, width: 1, lineStyle: 'solid' })
    expect(plot('ratingGuides').activeWhen, 'always drawn: this pane has one reading').toBeUndefined()
    expect(DEF.plots.map((p) => p.key)).toEqual(['ratingLine', 'ratingMa', 'ratingGuides'])
    expect(DEF.inputs.find((i) => i.key === 'color').default).toBe(IND_TOKENS.classic.info)
  })

  it('daily charts only: hidden by the timeframe on a weekly chart, kept on a daily one', () => {
    const inst = placed(DEF)
    expect(eligibleInstances([inst], engineRegistry, { tf: 'W' }).hidden).toEqual([{ inst, reason: 'timeframe' }])
    expect(eligibleInstances([inst], engineRegistry, { tf: 'D' }).kept.map((i) => i.instanceId)).toEqual([inst.instanceId])
  })

  it('the ranks table: the five component ranks and the rating, banded, while the server holds a row', () => {
    const table = paneTableFor(DEF, PAYLOAD, { inputs: {} })
    expect(table.label).toBe('RS ranks')
    expect(table.timeframes).toEqual(['D'])
    expect(table.columns.map((c) => [c.label, c.text])).toEqual([['1M', '50'], ['3M', '60'], ['6M', '70'], ['9M', '80'], ['12M', '90'], ['RS', '83']])
    expect(table.columns.every((c) => typeof c.band === 'string' && c.band)).toBe(true)
    expect(table.columns.at(-1).emphasis).toBe(true)
    expect(paneTableFor(DEF, DARK, { inputs: {} }), 'no row stored, no table').toBeNull()
  })

  it('the readout: the summary as the glance row, the numbers beneath it, no chip number on the pane label', () => {
    const rows = readoutRows(DEF, PAYLOAD, { inputs: {} })
    const glance = rows.filter((r) => !r.detailOf)
    expect(glance.map((r) => r.key)).toEqual(['ratingView', 'history'])
    expect(glance[0]).toMatchObject({ label: 'RS Rating', text: `83, up${NB}20 in 20${NB}sessions`, muted: false })
    expect(typeof glance[0].band).toBe('string')
    expect(rows.filter((r) => r.detailOf === 'ratingView').map((r) => [r.label, r.text])).toEqual([
      ['Rating', '83'], ['21-session avg', '73'], ['20-session change', '20'], ['Sessions drawn', '24'],
      ['Rated as of', '2026-11-06'], ['Components', '1M 50 · 3M 60 · 6M 70 · 9M 80 · 12M 90'],
    ])
    // F3 (2026-11-10): the pane label's value IS the rating (the line's number live,
    // the summary as the fallback), so the chip number that doubled it (`· 83  83, up…`)
    // is gone — declared `chip: false`, never "the first rows".
    expect(DEF.readout.find((r) => r.key === 'rating').chip).toBe(false)
    expect(readoutChipRows(DEF, rows)).toEqual([])
    expect(glance[1]).toMatchObject({ label: 'Bars held', text: '30', muted: true })
    // the card: plain English, the honesty sentence, no trade words
    const card = DEF.readout.find((r) => r.key === 'ratingView').card
    expect(card.evidence).toMatch(/No published hit rate exists/)
    for (const s of [DEF.meta.description, card.what, card.origin, card.evidence]) expect(s).not.toMatch(/\b(buy|sell|RSI)\b/i)
  })

  it('⛔ fail-closed: with the history dark the glance row is the reason, muted, and no chip rides the label', () => {
    const rows = readoutRows(DEF, DARK, { inputs: {} })
    expect(rows.find((r) => r.key === 'ratingView')).toMatchObject({ text: 'the rating history is not switched on', muted: true })
    expect(rows.find((r) => r.key === 'rating')).toBeUndefined()
    expect(readoutChipRows(DEF, rows)).toEqual([])
    expect(readoutFallbackValue(DEF, DARK, 0, {})).toEqual({ text: 'the rating history is not switched on', muted: true })
    // ...and with a row stored the label's fallback is the summary, live
    expect(readoutFallbackValue(DEF, PAYLOAD, 0, {})).toEqual({ text: `83, up${NB}20 in 20${NB}sessions`, muted: false })
  })
})

describe('6 · a placed instance through the real binder', () => {
  it('draws the rating line and its average from the landed envelope, with the two guides', () => {
    primeEnvelope(DEF, wire())
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(Object.keys(cols).sort()).toEqual(['ratingLine', 'ratingMa'])
    expect(cols.ratingLine.length).toBe(BARS.length)
    expect(cols.ratingLine.filter(Number.isFinite).length).toBe(CASE.expected.ratingLine.filter((v) => v !== null).length)
    expect(cols.ratingLine.at(-1)).toBe(83)
    expect(scalarsFor(DEF, {}, CTX)).toEqual(PAYLOAD)

    const { fake } = bindOnce([placed(DEF)], BARS)
    const drawn = seriesWithData(fake)
    expect(drawn.length, 'the line and its average').toBe(2)
    expect(drawn.every((s) => s.__hasValue)).toBe(true)
    expect(drawn.map((s) => s.__ctor.__type)).toEqual(['LineSeries', 'LineSeries'])
    const guides = fake.calls.filter((c) => c.method === 'createPriceLine').map((c) => c.args[0].price).sort()
    expect(guides).toEqual([80, 90])
  })

  it('⛔ fail-closed: a blank envelope (the history dark) binds series with NO value and no guess', () => {
    primeEnvelope(DEF, blankWire())
    const cols = computeFor(DEF, BARS, {}, CTX)
    expect(cols.ratingLine.every(Number.isNaN) && cols.ratingMa.every(Number.isNaN)).toBe(true)
    const { fake } = bindOnce([placed(DEF)], BARS)
    expect(fake.seriesCreated.some((s) => s.__hasValue)).toBe(false)
  })
})
