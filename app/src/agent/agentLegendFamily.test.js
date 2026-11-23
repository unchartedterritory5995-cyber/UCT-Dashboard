// LEGEND family (Charts: the on-chart legend / status line, its fields, the info row beside the ticker, and the legend menu's
// definition verbs): the instant path's GENERAL readers (capabilities/legendPhrases.js, indicatorPhrases.js toggle / copy /
// modify), tested as phrase CLASSES — every template × every place word × every field / mode is generated and must route to
// ONE existing capability with the args the class says. Then the near-misses each class must NOT claim. No model, no board
// except where the reading depends on the board (toggle). Evidence: LOCAL vitest, no model.
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { registerBuiltins } from './builtins'
import { fastParse } from './fastPath'
import { BAR_INFO_FIELDS } from '../components/chart/barInfoFields'
import { HEADER_STATS } from '../components/chart/headerStatCatalog'
import { barInfoFieldOf, infoRowStatOf, legendModeOfWords } from './capabilities/legendPhrases'
import { customCopyOfWords, modifyOfWords, toggleOfWords } from './capabilities/indicatorPhrases'
import { setOwnedDefinitionSource } from './capabilities/indicatorEdits'
import * as R from '../components/chart/engine/nativeRegistry'
import { makeBoard } from './__fixtures__/board'
import { mergeChartSettings, CHART_DEFAULTS } from '../components/chart/chartDefaults'

registerBuiltins()

const one = (text, host = null) => {
  const r = fastParse(text, host ? { host } : {})
  return r?.kind === 'ops' && r.ops.length === 1 ? r.ops[0] : null
}
const setting = (o) => (o && o.action === 'chart.setSetting' ? `${o.args.setting}=${o.args.value}` : o ? `${o.action}:${JSON.stringify(o.args)}` : 'MODEL')
const fill = (t, map) => Object.entries(map).reduce((s, [k, v]) => s.replace(k, v), t)

// ── C1-064 legend mode: always | hold | off ──
const LEGEND_PLACES = ['legend', 'chart legend', 'ohlc legend', 'status line', 'price legend', 'data legend', 'candle legend']
const MODE_TEMPLATES = {
  off: ['hide the P', 'turn off the P', 'turn the P off', 'remove the P', 'get rid of the P', 'disable the P', 'P off', 'no P', 'don\'t show the P',
    'stop showing the P', 'set the P to off', 'switch the P to hidden', 'kill the P', 'take away the P', 'hide the P completely', 'never show the P'],
  always: ['show the P', 'always show the P', 'turn on the P', 'turn the P back on', 'bring back the P', 'keep the P visible', 'set the P to always',
    'set the P mode to always on', 'unhide the P', 'P on', 'show the P again', 'keep the P on', 'switch the P to always visible', 'show the P always'],
  hold: ['only show the P when i hold', 'show the P only when i press and hold', 'show the P while i hold down the mouse', 'set the P to hold',
    'switch the P to press and hold', 'set the P mode to peek', 'P on hold', 'make the P press to peek', 'hide the P until i hold',
    'show the P when i click and hold', 'change the P to hold mode', 'put the P on hold', 'show the P only while i press'],
}
describe('C1-064 legend mode — every template × place → chart.setSetting header.legendMode', () => {
  for (const [mode, templates] of Object.entries(MODE_TEMPLATES)) {
    const all = templates.flatMap(t => LEGEND_PLACES.map(p => t.replace('P', p)))
    it(`${mode}: ${all.length} generated phrasings`, () => {
      const miss = all.filter(p => setting(one(p)) !== `header.legendMode=${mode}`)
      expect(miss.map(p => `${p} → ${setting(one(p))}`)).toEqual([])
    })
  }
  it('the reader itself, without the fast path around it', () => {
    expect(legendModeOfWords('show the status line only when i press-hold')).toEqual({ setting: 'header.legendMode', value: 'hold' })
    expect(legendModeOfWords('the chart legend off')).toEqual({ setting: 'header.legendMode', value: 'off' })
  })
})

// ── C1-065 bar info: which readings of the candle the legend strip prints ──
const BAR_PLACES = ['legend', 'chart legend', 'status line', 'bar info', 'bar info strip', 'ohlc strip', 'bar readout', 'readout', 'legend strip', 'ohlc legend']
const BAR_WORDS = {
  date: ['date', 'the date', 'time', 'timestamp'], open: ['open', 'the open', 'open price', 'opening price'], high: ['high', 'the high', 'high price'],
  low: ['low', 'the low', 'low price'], close: ['close', 'the close', 'closing price', 'last price'],
  change: ['net change', 'the net change', 'point change', 'dollar change', 'net chg'], changePct: ['percent change', 'the % change', '% chg', 'percentage change', 'pct change'],
}
const BAR_ADD = ['show F in the P', 'add F to the P', 'put F back in the P', 'include F in the P', 'bring back F in the P', 'add F back to the P', 'display F in the P']
const BAR_REMOVE = ['hide F in the P', 'remove F from the P', 'take F off the P', 'drop F from the P', 'don\'t show F in the P', 'i don\'t need F in the P',
  'take F out of the P', 'hide F from the P', 'no F in the P', 'stop showing F in the P', 'get rid of F in the P']
describe('C1-065 bar info — verb × field × place → chart.setSetting header.barInfo ±field', () => {
  it('every BAR_INFO_FIELDS field has words (the catalog is the source, never a copy)', () => {
    expect(Object.keys(BAR_WORDS).sort()).toEqual(BAR_INFO_FIELDS.map(f => f.id).sort())
    for (const f of BAR_INFO_FIELDS) expect(barInfoFieldOf(f.label), f.label).toBe(f.id)
  })
  for (const [sign, templates] of [['+', BAR_ADD], ['-', BAR_REMOVE]]) {
    const all = templates.flatMap(t => BAR_PLACES.flatMap(p => Object.entries(BAR_WORDS).flatMap(([id, ws]) => ws.map(w => [fill(t, { F: w, P: p }), `header.barInfo=${sign}${id}`]))))
    it(`${sign === '+' ? 'add' : 'remove'}: ${all.length} generated phrasings`, () => {
      const miss = all.filter(([p, want]) => setting(one(p)) !== want)
      expect(miss.map(([p, want]) => `${p} → ${setting(one(p))} (want ${want})`).slice(0, 30)).toEqual([])
    })
  }
})

// ── C1-066 info row: the stats beside the ticker, the Chart Settings stat picker's WHOLE catalog ──
const ROW_PLACES = ['header', 'chart header', 'info row', 'header stats', 'stat strip', 'stats row', 'stats beside the ticker', 'header row']
const ROW_ADD = ['add S to the P', 'show S in the P', 'put S in the P', 'include S in the P']
const ROW_REMOVE = ['remove S from the P', 'take S off the P', 'hide S in the P', 'drop S from the P', 'don\'t show S in the P']
// a label that is also an indicator's name ("ADR %", "Dollar Volume", "Up/Down Volume" are indicators too): "show the dollar
// volume in the header" may be the indicator's VALUE (C1-100, the Indicators-owned info value) — never read here, the model asks
const NOT_INSTANT = new Set(HEADER_STATS.filter(s => infoRowStatOf(s.label) == null).map(s => s.key))
// ⚠ KNOWN GAP, not this family's reader: screener.run's whole-sentence reader (fastWhole) claims "show rs rank in the header" as a
// SCREEN (rs_rank ≥ 0) before any clause reader is asked — pinned below as today's outcome, routed to the screener owner
const SCREENER_CLAIMS = new Set(['rsrank'])
describe('C1-066 info row — verb × stat × place → chart.setSetting header.fields ±stat', () => {
  it('every catalog stat is read by its own Chart Settings label, except the ones that also name an indicator', () => {
    expect([...NOT_INSTANT].sort()).toEqual(['adr', 'dolvol', 'udvol'])
    expect(HEADER_STATS.length - NOT_INSTANT.size).toBe(59)
  })
  it('the stats that name an indicator are not claimed as stats (the model hears them)', () => {
    for (const k of NOT_INSTANT) {
      const s = HEADER_STATS.find(x => x.key === k)
      expect(setting(one(`add ${s.label.toLowerCase()} to the info row`)), s.label).not.toMatch(/^header\.fields/)
    }
  })
  it('KNOWN GAP (screener over-claim): "show rs rank in the header" is read as a screen today', () => {
    expect(one('show rs rank in the header')?.action).toBe('screener.run')
  })
  for (const [sign, templates] of [['+', ROW_ADD], ['-', ROW_REMOVE]]) {
    const stats = HEADER_STATS.filter(s => !NOT_INSTANT.has(s.key) && !SCREENER_CLAIMS.has(s.key))
    const all = templates.flatMap(t => ROW_PLACES.flatMap(p => stats.map(s => [fill(t, { S: s.label.toLowerCase(), P: p }), `header.fields=${sign}${s.key}`])))
    it(`${sign === '+' ? 'add' : 'remove'}: ${all.length} generated phrasings over ${stats.length} stats`, () => {
      const miss = all.filter(([p, want]) => setting(one(p)) !== want)
      expect(miss.map(([p, want]) => `${p} → ${setting(one(p))} (want ${want})`).slice(0, 30)).toEqual([])
    })
  }
  it.each([
    ['add market cap to the header', '+mcap'], ['put the float in the info row', '+float'], ['show rel vol in the chart header', '+rvol'],
    ['take the earnings date off the header', '-earn'], ['add the market cap to the stats beside the ticker', '+mcap'], ['show the adr in the header', '+adr'],
    ['add the short float to the info row', '+shortf'], ['remove the sector from the info row', '-sector'], ['show the p/e ratio in the header', '+pe'],
  ])('trader words: %s', (p, v) => expect(setting(one(p))).toBe(`header.fields=${v}`))
})

// ── near-misses: what the legend readers must NOT claim ──
describe('near-misses go to the model (or to the reader that owns them)', () => {
  it.each([
    'show volume in the legend',                 // volume is a PLOT, not a bar reading (barInfoFields.js)
    'add the change to the legend',              // fits Net Chg and % Chg
    'drop chg from the bar info',                // the same
    'only show the close in the legend',         // a whole set, several writes: the model
    'show the rsi value in the header',          // C1-100: the Indicators-owned info value (BLOCKED)
    'add rsi to the header',                     // RSI the stat or RSI the value: the model asks
    'add short interest to the info row',        // no such stat (Short % of Float is): refused by the check on the model path
    'take the uct rating off the header',        // retired stat
    'make the legend gold',                      // header colours: not eligible (C1-067 BLOCKED)
    'hide the ohlc',                             // the legend, or its four price fields? the model
    'keep the legend on all the time',           // "all" reads as every chart (fastPath ALL_RE): never half-read here
    'open the formula for rsi',                  // C2-045: no door (BLOCKED)
    'copy the rsi',                              // a copy on the chart, or a new definition? the model
    'create a custom copy of the 20 ema',        // a chart's instance, not a definition
  ])('%s', (p) => {
    const o = one(p)
    expect(o?.action === 'chart.setSetting' || o?.action === 'definition.duplicate' || o?.action === 'indicator.openCreate' ? setting(o) : 'not a legend reading').toBe('not a legend reading')
  })
  it('"show the day change in the header" stays the TITLE\'s day change (header.showChange), never an info-row stat', () => {
    expect(setting(one('show the day change'))).toBe('header.showChange=true')
    expect(infoRowStatOf('day change')).toBeNull()
  })
  it('"make a copy of the rsi" stays Duplicate on chart (indicatorCopy.duplicate), not Create custom copy', () => {
    expect(one('make a copy of the rsi')).toMatchObject({ action: 'indicatorCopy.duplicate', args: { instance: 'rsi' } })
  })
})

// ── C2-043 Create custom copy (definition.duplicate) ──
const COPY_TEMPLATES = ['create a custom copy of S', 'make my own copy of S', 'make a custom copy of S', 'save S as my own indicator', 'create an editable copy of S',
  'give me my own version of S', 'save a personal copy of S', 'copy S into my own indicator', 'fork S into my own indicator', 'make my own version of S']
const COPY_SUBJECTS = [['the rsi', 'rsi'], ['macd', 'macd'], ['the relative strength index', 'rsi'], ['the bollinger bands', 'bb'], ['the supertrend', 'superTrend'], ['the rs line', 'rsLine']]
describe('C2-043 Create custom copy — template × subject → definition.duplicate {defId}', () => {
  const all = COPY_TEMPLATES.flatMap(t => COPY_SUBJECTS.map(([s, id]) => [t.replace('S', s), id]))
  it(`${all.length} generated phrasings`, () => {
    const miss = all.filter(([p, id]) => { const o = one(p); return !(o && o.action === 'definition.duplicate' && o.args.defId === id) })
    expect(miss.map(([p]) => `${p} → ${setting(one(p))}`)).toEqual([])
  })
  it('the reader alone', () => expect(customCopyOfWords('make my own copy of macd')).toEqual({ defId: 'macd' }))
})

// ── C2-044 Modify with the UCT Agent (indicator.openCreate {defId}), one of the member's OWN formulas ──
describe('C2-044 Modify — template × the member\'s own indicator → indicator.openCreate {defId}', () => {
  const MINE = 'u_aaaaaaaaaa44'
  beforeAll(() => {
    const FIX = JSON.parse(fs.readFileSync(path.resolve(globalThis.process.cwd(), '..', 'tests/fixtures/authoring/batch2_definitions.json'), 'utf8'))
    const res = R.installUserDefinitions([{ ...FIX.styled_markers, id: MINE, version: 1, meta: { ...(FIX.styled_markers.meta || {}), name: 'Trend Gauge' } }])
    expect(res.errors).toEqual([])
    setOwnedDefinitionSource(() => [MINE])
  })
  afterAll(() => setOwnedDefinitionSource(() => []))
  const T = ['modify S with the uct agent', 'edit S with uct intelligence', 'open modify on S', 'tweak S in the indicator studio', 'open S in create indicator',
    'change S using the agent', 'rework S with the ai', 'modify S in create indicator']
  it.each(T.flatMap(t => ['my trend gauge', 'trend gauge', 'the trend gauge'].map(s => t.replace('S', s))))('%s', (p) => {
    expect(modifyOfWords(p, () => [MINE])).toEqual({ request: null, defId: MINE })
  })
  it('a built-in has no Modify (the legend offers it only for the member\'s own): not read', () => {
    expect(modifyOfWords('modify the rsi with the uct agent', () => [MINE])).toBeNull()
    expect(modifyOfWords('modify my trend gauge with the uct agent', () => [])).toBeNull()
  })
})

// ── C1-104 the chords (Ctrl+I / Ctrl+O / Ctrl+B / Alt+U): "toggle X" — the board decides which of hide / show / add ──
describe('C1-104 toggle — the chord\'s meaning, only when the whole board agrees', () => {
  const BARE = { overlays: CHART_DEFAULTS.overlays.map(() => ({ removed: true })) }
  const chart = (id, x, inst = []) => ({ id, type: 'chart', x, y: 0, w: 12, h: 10, color: 'N', opts: { settings: { ...mergeChartSettings(BARE), indicatorInstances: inst } } })
  const rsi = (hidden) => ({ instanceId: 'inst:rsi:1', defId: 'rsi', defVersion: 1, inputs: {}, hidden })
  const host = (...specs) => makeBoard(specs.map((s, i) => chart(`c${i}`, i * 12, s)), Object.fromEntries(specs.map((_, i) => [`N:c${i}`, ['SPY', 'QQQ'][i]]))).host
  it.each(['toggle rsi', 'toggle the rsi', 'flip the rsi', 'toggle the relative strength index', 'toggle rsi again'])('%s: shown everywhere → hide', (p) => {
    expect(one(p, host([rsi(false)], [rsi(false)]))).toMatchObject({ action: 'indicator.hide' })
  })
  it('hidden everywhere → show; absent everywhere → add (the catalog id, default settings)', () => {
    expect(one('toggle rsi', host([rsi(true)]))).toMatchObject({ action: 'indicator.show' })
    expect(one('toggle vwap', host([], []))).toMatchObject({ action: 'indicator.add', args: { defId: 'vwap', inputs: null } })
    expect(one('toggle the macd', host([]))).toMatchObject({ action: 'indicator.add', args: { defId: 'macd' } })
  })
  it('a board that disagrees (shown on one chart, absent on the other) is the model\'s; so is "off" on an absent one', () => {
    expect(one('toggle rsi', host([rsi(false)], []))).toBeNull()
    expect(one('toggle rsi off', host([], []))).toBeNull()
    expect(toggleOfWords('toggle rsi on', 'hide', host([rsi(false)]))).toBeNull()
    expect(one('toggle rsi', null)).toBeNull()
  })
})
