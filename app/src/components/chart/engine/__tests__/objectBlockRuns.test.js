// ⭐⭐ C48 (OBJECT LANE) — a `var` written from a `ta.*` call inside a block that
// does not run on every bar holds that call's value AT ITS LAST RUN, and the call's
// window counts the block's EXECUTIONS (capture `vw-call-site-history-rddt-1d-
// 2026-10-01`, rows C01-C04 / D01-D02). The host object lane drew the EVERY-BAR
// value of the call instead:
//
//   var float s = na
//   if close > open
//       s := ta.sma(close, 3)
//   if barstate.islast
//       label.new(bar_index, s, str.tostring(s))
//
// drew 145.7767 on RDDT 1D from listing where TradingView draws 149.2033 (ema:
// 146.96 vs 150.09; highest(high, 10): 161.67 vs 164.16). The plot lane withholds
// such a read by name (`engine/blockRuns.js`); this holds the object lane to the
// same gate: on a chart where the block runs after a bar it skipped, the value is
// withheld by name (`pine:block`); where the block runs on every bar the every-bar
// value IS TradingView's and stays drawn.
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../objectColumns'
import { evaluateObjects } from '../objectRuntime'
import { toRenderState } from '../objectRenderState'
import { toGraphDocument } from '../ast/graphDocument'

const REPO = path.resolve(process.cwd(), '..')
const DIR = path.join(REPO, 'tests/fixtures/vendor/harness')
const load = (file) => {
  const cap = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'))
  return {
    cap,
    bars: cap.bars.rows.map(([t, o, h, l, c, v]) => ({ t, o, h, l, c, v: v == null ? 0 : v })),
  }
}
const H = '//@version=6\nindicator("P", overlay = true)\n'
const lbl = (expr) => `if barstate.islast\n    label.new(bar_index, ${expr}, str.tostring(${expr}))\n`
const condVar = (guard, call) => `${H}var float s = na\nif ${guard}\n    s := ${call}\n${lbl('s')}`

/** TradingView's value of plot `field` at its last finite row (a `var` holds it). */
function vendorHeld(cap, field) {
  const at = cap.plotValues.fields.indexOf(field)
  let v = null
  for (const r of cap.plotValues.rows) if (r[at] != null && Number.isFinite(r[at])) v = r[at]
  return v
}
const lastRow = (cap, field) => {
  const rows = cap.plotValues.rows
  return rows[rows.length - 1][cap.plotValues.fields.indexOf(field)]
}

function draw(source, bars, symbol, listing, { graph = false } = {}) {
  // the graph form is a multi-tree document's: two plots make one
  const src = graph ? `${source}plot(close)
plot(open)
` : source
  const built = memberPaneDefinition({ source: src, id: 'u_objcond', name: 'P' })
  expect(built.ok, built.reason).toBe(true)
  let def = built.definition
  if (graph) {
    const g = toGraphDocument(def)
    expect(g.ok, g.reason).toBe(true)
    def = g.definition
  }
  const reader = objectReaderFor(def, bars, { inputs: undefined, tf: 'D', symbol, newestBarIsForming: false,
    ...(listing ? { historyFromListing: true } : {}) })
  const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode,
    readTime: reader.readTime, readUnknown: reader.readUnknown, offListing: reader.historyFromListing !== true })
  const state = toRenderState(run.live, { bars, tf: 'D', pineVersion: reader.program.pineVersion })
  return { def, reader, labels: (state.labels || []).map((l) => Number(l.text)) }
}

const close = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b))

describe('C48 object lane — a var written from a ta.* call in a block that skips', () => {
  beforeAll(() => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_MEMBER_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
  })
  const RDDT = load('vw-call-site-history-rddt-1d-2026-10-01.json')
  const SPY = load('vw-call-site-history-spy-1d-2026-10-01.json')
  const SYM = { RDDT: [RDDT, { ticker: 'RDDT', exchange: 'NYSE' }, true], SPY: [SPY, { ticker: 'SPY', exchange: 'NYSE Arca' }, false] }

  // [name, guard, call, the vendor row that holds the truth, the every-bar row]
  const CASES = [
    ['sma', 'close > open', 'ta.sma(close, 3)', 'C03_sma3_cond', 'E03_sma3_every_bar'],
    ['ema', 'close > open', 'ta.ema(close, 3)', 'C04_ema3_cond', 'E04_ema3_every_bar'],
    ['highest', 'close > open', 'ta.highest(high, 10)', 'C01_highest10_cond', 'E01_highest10_every_bar'],
    ['lowest', 'close > open', 'ta.lowest(low, 10)', 'C02_lowest10_cond', 'E02_lowest10_every_bar'],
    ['sma even', 'bar_index % 2 == 0', 'ta.sma(close, 3)', 'D02_sma3_even', 'E03_sma3_every_bar'],
    ['highest even', 'bar_index % 2 == 0', 'ta.highest(high, 3)', 'D01_highest3_even', 'E06_highest3_every_bar'],
  ]
  const fieldOf = (cap, title) => {
    // the capture names its plots plot_N in the order the script declares them
    const order = ['C01_highest10_cond', 'C02_lowest10_cond', 'C03_sma3_cond', 'C04_ema3_cond', 'C05_local_x1_cond',
      'C06_bar_index1_cond', 'H01_param_src1_cond', 'H02_local_x1_cond', 'H03_sma3_cond', 'H04_highest10_cond',
      'H05_bar_index1_cond', 'H06_volume1_cond', 'D01_highest3_even', 'D02_sma3_even', 'D03_local_y1_even',
      'E01_highest10_every_bar', 'E02_lowest10_every_bar', 'E03_sma3_every_bar', 'E04_ema3_every_bar',
      'E05_local_every_bar', 'E06_highest3_every_bar']
    return `plot_${order.indexOf(title)}`
  }

  for (const [sym, [{ cap, bars }, symbol, listing]] of Object.entries(SYM)) {
    for (const [name, guard, call, truthRow, everyRow] of CASES) {
      for (const graph of [false, true]) {
        it(`${sym} ${name}${graph ? ' (graph form)' : ''}: never the every-bar value; TradingView's, or withheld by name`, () => {
          const truth = vendorHeld(cap, fieldOf(cap, truthRow))
          const every = lastRow(cap, fieldOf(cap, everyRow))
          const { labels, reader } = draw(condVar(guard, call), bars, symbol, listing, { graph })
          expect(labels.length).toBeLessThanOrEqual(1)
          if (labels.length) {
            // a drawn value is TradingView's own (a coincidence with the every-bar
            // number is allowed only when the two agree)
            expect(close(labels[0], truth), `drew ${labels[0]}, TradingView ${truth}, every-bar ${every}`).toBe(true)
          } else {
            // withheld BY NAME: this gate's sentence, or (off the listing, where
            // `bar_index` is not Pine's) the bar-index withholding that came first
            const named = (reader.refusals || []).filter((r) => r.guard === 'pine:block')
            const clock = (reader.chartClock || []).map((c) => c.code)
            expect(named.length + clock.length, JSON.stringify({ r: reader.refusals, clock })).toBeGreaterThan(0)
            if (named.length) expect(named[0].message).toMatch(/runs again on bar \d+/)
            else expect(clock).toContain('bar-index:window')
          }
        })
      }
    }
  }

  it('the RDDT witnesses the audit named: the every-bar values are no longer drawn', () => {
    const { cap, bars } = RDDT
    for (const [call, every] of [['ta.sma(close, 3)', 145.7766666667], ['ta.ema(close, 3)', 146.9609726164], ['ta.highest(high, 10)', 161.67]]) {
      const { labels } = draw(condVar('close > open', call), bars, SYM.RDDT[1], true)
      for (const v of labels) expect(Math.abs(v - every) > 1e-6, `${call} still drew the every-bar ${every}`).toBe(true)
      expect(cap.bars.rows.length).toBeGreaterThan(600)
    }
  })

  // ⛔ NEVER STOP DRAWING A VALUE THAT IS TRADINGVIEW'S. A block whose guard holds
  // on every bar of the chart has run on every bar: the every-bar value is exact.
  for (const guard of ['bar_index >= 0', 'close > 0', 'barstate.isconfirmed']) {
    it(`a block that runs on every bar (${guard}) still draws the every-bar value`, () => {
      const { cap, bars } = RDDT
      const { labels, reader } = draw(condVar(guard, 'ta.sma(close, 3)'), bars, SYM.RDDT[1], true)
      expect((reader.refusals || []).filter((r) => r.guard === 'pine:block')).toEqual([])
      expect(labels.length).toBe(1)
      expect(close(labels[0], lastRow(cap, fieldOf(cap, 'E03_sma3_every_bar')))).toBe(true)
    })
  }

  it('a stamp whose guard could not be read withholds the value (fail closed)', () => {
    const { bars } = RDDT
    const built = memberPaneDefinition({ source: condVar('bar_index >= 0', 'ta.sma(close, 3)'), id: 'u_objcond', name: 'P' })
    const def = structuredClone(built.definition)
    expect(def.objects.blockRuns[0].gates.length).toBeGreaterThan(0)
    for (const g of def.objects.blockRuns[0].gates) g.guard = null
    const reader = objectReaderFor(def, bars, { tf: 'D', symbol: SYM.RDDT[1], newestBarIsForming: false, historyFromListing: true })
    const run = evaluateObjects(reader.program, { barCount: bars.length, readNode: reader.readNode,
      readTime: reader.readTime, readUnknown: reader.readUnknown, offListing: false })
    const state = toRenderState(run.live, { bars, tf: 'D', pineVersion: reader.program.pineVersion })
    expect(state.labels || []).toEqual([])
    const named = reader.refusals.filter((r) => r.guard === 'pine:block')
    expect(named.length).toBe(1)
    expect(named[0].message).toMatch(/could not be computed/)
  })

  it('a block that runs then stops for good is exact too (no run after a skip)', () => {
    const { bars } = RDDT
    const n = bars.length
    const src = condVar(`bar_index < ${n - 5}`, 'ta.sma(close, 3)')
    const { labels, reader } = draw(src, bars, SYM.RDDT[1], true)
    expect((reader.refusals || []).filter((r) => r.guard === 'pine:block')).toEqual([])
    const c = bars.slice(n - 8, n - 5).map((b) => b.c)
    expect(labels.length).toBe(1)
    expect(close(labels[0], (c[0] + c[1] + c[2]) / 3)).toBe(true)
  })

  it('a later write without a call keeps the gate (the var still holds the call\'s value)', () => {
    const { bars } = RDDT
    const src = `${H}var float s = na\nif close > open\n    s := ta.sma(close, 3)\nif volume < 0\n    s := close\n${lbl('s')}`
    const { labels, reader } = draw(src, bars, SYM.RDDT[1], true)
    expect(labels).toEqual([])
    expect((reader.refusals || []).some((r) => r.guard === 'pine:block')).toBe(true)
  })

  it('a later TOP-LEVEL write keeps the gate too', () => {
    const { bars } = RDDT
    const src = `${H}var float s = na
if close > open
    s := ta.sma(close, 3)
s := nz(s)
${lbl('s')}`
    const { labels, reader } = draw(src, bars, SYM.RDDT[1], true)
    expect(labels).toEqual([])
    expect((reader.refusals || []).some((r) => r.guard === 'pine:block')).toBe(true)
  })

  it('a value only partly read from the gated var is withheld with it', () => {
    const { bars } = RDDT
    const src = `${H}var float s = na\nif close > open\n    s := ta.sma(close, 3)\n${lbl('s + 1')}`
    const { labels, reader } = draw(src, bars, SYM.RDDT[1], true)
    expect(labels).toEqual([])
    expect((reader.refusals || []).some((r) => r.guard === 'pine:block')).toBe(true)
  })

  it('a var written in the block from no call is untouched (nothing to gate)', () => {
    const { bars } = RDDT
    const src = `${H}var float s = na\nif close > open\n    s := close\n${lbl('s')}`
    const { labels, reader, def } = draw(src, bars, SYM.RDDT[1], true)
    expect((reader.refusals || []).filter((r) => r.guard === 'pine:block')).toEqual([])
    expect(def.objects.blockRuns).toBeUndefined()
    let held = null
    for (const b of bars) if (b.c > b.o) held = b.c
    expect(labels).toEqual([held])
  })
})
