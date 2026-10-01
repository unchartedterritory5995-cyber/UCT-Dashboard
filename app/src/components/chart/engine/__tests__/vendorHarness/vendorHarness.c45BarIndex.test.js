// ─── ⭐⭐ C45 — `bar_index` AT THE MEMBER DOOR ────────────────────────────────
//
// TradingView's `bar_index` counts from the first bar of the symbol's history.
// The engine's `barindex` counts from the first bar it was handed. Off the
// listing the two differ by a number of bars `D >= 0` the chart cannot know —
// measured: every 2026-09-30 SPY probe prints 8175 on the bar a 300-bar window
// calls 0. Before C45 the door DREW the window's own count as if it were
// TradingView's (a plotted `bar_index` 8,175 low; `bar_index % 3` right only
// because 8175 happens to divide by three).
//
// THE RULE, as implemented (`ast/barIndexShift.js` proves the class from the tree;
// `interpret.js::barIndexMask` and `objectProgram.js::withBarIndexHeld` act on it):
//   · the series starts at the listing (`historyFromListing`)  → everything served;
//   · otherwise, what does not move with `D` (a DISTANCE: `bar_index - bar_index[5]`,
//     a least-squares line over the index) is served;
//   · a bar index used as a drawing's X-COORDINATE is served (the bar is the bar);
//   · a test against a fixed bar (`bar_index > 50`) is served where a longer
//     history can only confirm it, withheld on the early bars (`bar-index:early-bars`);
//   · anything else whose VALUE depends on the count is withheld on every bar,
//     by name (`bar-index:window`) — a plot draws nothing, an object is not created.
//
// GRADED on the five committed probes that carry a `plot(bar_index)` control row:
// as captured (300 bars: what a member's chart holds) and on TradingView's whole
// history (`c38Joined.js`, the 8,175 earlier bars joined in front, the join
// proving itself against the vendor's own control row).
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { gradeCapture } from './harness'
import { parent, joinedFromListing, vendorColumn, HARNESS } from './c38Joined'
import { enterMemberDoor, toProductBars, barIndexStartsAtZero } from './ourSide'
import * as registry from '../../nativeRegistry'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { CHART_CLOCK_WITHHELD } from '../../ast/interpret'

beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

/** [capture id, title of its `plot(bar_index)` row] — the five the brief names. */
const PROBES = [
  ['vw-offset-na-spy-1d-2026-09-30', 'E00_bar_index_CONTROL'],
  ['vw-mbb-auto-spy-1d-2026-09-30', 'M00_bar_index_CONTROL'],
  ['vw-gradient-spy-1d-2026-09-30', 'G00_bar_index_CONTROL'],
  ['vw-ne-na-spy-1d-2026-09-30', 'Q00_bar_index_CONTROL'],
  ['w4-cross-round-spy-1d-2026-09-30', 'X00_bar_index'],
]
const WITHHELD = /withheld on this chart on every bar, by name \(bar-index:window\)/
const byVerdict = (v, want) => v.plots.filter((p) => p.verdict === want).map((p) => p.title)
const plotOf = (v, title) => v.plots.find((p) => p.title === title)

describe('C45 — the five probes AS CAPTURED (300 bars, 8,175 bars after the listing)', () => {
  it('the vendor\'s own control row says where the window starts: 8175, not 0', () => {
    for (const [id, control] of PROBES) {
      const cap = parent(id)
      expect(cap.history && cap.history.startsAtBar0, id).not.toBe(true)
      expect(vendorColumn(cap, control)[0], id).toBe(8175)
      expect(vendorColumn(cap, control)[299], id).toBe(8474)
      expect(barIndexStartsAtZero(cap), id).toBe(false)
    }
  })

  it('⭐ NOT ONE ROW IS DRAWN WRONG: the control row is withheld by name in all five, and nothing DIVERGES', () => {
    for (const [id, control] of PROBES) {
      const { verdict, ours } = gradeCapture(parent(id))
      expect(ours.ok, `${id}: ${ours.refusal}`).toBe(true)
      expect(byVerdict(verdict, 'DIVERGE'), id).toEqual([])
      expect(plotOf(verdict, control).verdict, id).toBe('INCONCLUSIVE')
      expect(plotOf(verdict, control).reason, id).toMatch(WITHHELD)
      expect(ours.notes.some((n) => /`bar_index` withheld \(bar-index:window\)/.test(n)), id).toBe(true)
    }
  })

  it('what does NOT read the count is still served and still MATCHES', () => {
    // vw-ne-na: the two rows over a `var float` that stays na read no index
    const ne = gradeCapture(parent('vw-ne-na-spy-1d-2026-09-30')).verdict
    expect(byVerdict(ne, 'MATCH')).toEqual(['Q10_na_var_ne_close', 'Q11_na_var_eq_close'])
    expect(ne.plots.filter((p) => WITHHELD.test(p.reason || '')).map((p) => p.title)).toEqual([
      'Q00_bar_index_CONTROL', 'Q01_x_is_na', 'Q02_x_ne_close', 'Q03_x_eq_close', 'Q04_x_ne_x',
      'Q05_x_eq_x', 'Q06_i_ne_1', 'Q07_i_eq_1', 'Q08_x_gt_0', 'Q09_not_x_eq_close',
    ])
    // w4-cross-round: ONLY the control row reads the index; the crosses and the
    // rounding rows are untouched (five MATCH, as before C45)
    const x = gradeCapture(parent('w4-cross-round-spy-1d-2026-09-30')).verdict
    expect(x.plots.filter((p) => WITHHELD.test(p.reason || '')).map((p) => p.title)).toEqual(['X00_bar_index'])
    expect(byVerdict(x, 'MATCH')).toEqual([
      'X01_crossover_close_sma5', 'X02_crossunder_close_sma5', 'X03_cross_EITHER_DIRECTION',
      'X04_rising3', 'X05_falling3', 'X10_round_close_2dp',
    ])
    // vw-offset-na: `close[1]` reads no index
    expect(plotOf(gradeCapture(parent('vw-offset-na-spy-1d-2026-09-30')).verdict, 'E04_close_1_CONTROL').verdict).toBe('MATCH')
  })

  it('⚰️ what the member saw before: the window\'s own count, drawn — reproduced by stating the lie', () => {
    // The pre-C45 door is the door told (falsely) that this window starts at
    // TradingView's bar 0. It draws 0, 1, 2 … against the vendor's 8175, 8176 …
    const cap = parent('vw-mbb-auto-spy-1d-2026-09-30')
    const door = enterMemberDoor(cap.source.text)
    try {
      const bars = toProductBars(cap)
      const output = door.built.translation.outputs.find((o) => o.title === 'M00_bar_index_CONTROL')
      const key = door.built.rows.find((r) => r.ast === output.ast).key
      const before = registry.computeFor(door.def, bars, undefined, { tf: 'D', barIndexFromFirstBar: true })
      expect(Array.from(before[key]).slice(0, 3)).toEqual([0, 1, 2])
      expect(vendorColumn(cap, 'M00_bar_index_CONTROL').slice(0, 3)).toEqual([8175, 8176, 8177])
      // …and now: nothing, by name
      const now = registry.computeFor(door.def, bars, undefined, { tf: 'D' })
      expect(Array.from(now[key]).every((v) => Number.isNaN(v))).toBe(true)
      const report = registry.chartClockReport(now)
      expect(report.withheld.map((r) => r.code)).toEqual(['bar-index:window'])
      expect(report.withheld[0].reason).toBe(CHART_CLOCK_WITHHELD['bar-index:window']('D'))
      expect(report.withheld[0].plots).toContain(key)
    } finally {
      registry.uninstallUserDefinition(door.def.id)
    }
  })
})

describe('C45 — the same five on TradingView\'s whole history: the count is the vendor\'s, every bar', () => {
  // one probe a test: each grades 8,475 bars through the real door
  it.each(PROBES)('⭐ %s: the control row MATCHES, 300 of 300 bars, and nothing is withheld', (id, control) => {
    const cap = parent(id)
    const { verdict, ours, integrity } = gradeCapture(joinedFromListing(cap, { control }))
    expect(integrity.ok, (integrity.errors || []).join('; ')).toBe(true)
    const row = plotOf(verdict, control)
    expect(row.verdict, `${id}: ${row.reason}`).toBe('MATCH')
    expect(row.stats.matching, id).toBe(300)
    expect(byVerdict(verdict, 'DIVERGE'), id).toEqual([])
    expect(verdict.plots.filter((p) => WITHHELD.test(p.reason || '')), id).toEqual([])
    expect(ours.notes.filter((n) => /bar-index:/.test(n)), id).toEqual([])
  }, 60000)

  it('vw-ne-na: MATCH, all twelve rows; vw-gradient: the twelve rows the pane carries MATCH', () => {
    const ne = gradeCapture(joinedFromListing(parent('vw-ne-na-spy-1d-2026-09-30'), { control: 'Q00_bar_index_CONTROL' })).verdict
    expect(ne.verdict, ne.reason).toBe('MATCH')
    expect(byVerdict(ne, 'MATCH').length).toBe(12)
    const g = gradeCapture(joinedFromListing(parent('vw-gradient-spy-1d-2026-09-30'), { control: 'G00_bar_index_CONTROL' })).verdict
    expect(byVerdict(g, 'MATCH')).toEqual([
      'G00_bar_index_CONTROL', 'G01_v', 'G02_g1_r', 'G03_g1_g', 'G04_g1_b', 'G05_g1_t', 'G06_w',
      'G07_g2_r_clamp', 'G08_g2_g_clamp', 'G09_g2_b_clamp', 'G10_g2_t_clamp', 'G11_g3_r_new30',
    ])
  }, 60000)

  it('CONTROL — the grade can fail: the vendor\'s count moved by one bar is a DIVERGE', () => {
    const cap = parent('vw-ne-na-spy-1d-2026-09-30')
    const moved = joinedFromListing(cap, {
      control: 'Q00_bar_index_CONTROL', id: 'c45-control',
      mutateVendor: (fields, rows) => {
        const at = fields.indexOf(cap.study.plots.find((p) => p.title === 'Q00_bar_index_CONTROL').id)
        rows[7][at] += 1
      },
    })
    const { verdict } = gradeCapture(moved)
    expect(byVerdict(verdict, 'DIVERGE')).toEqual(['Q00_bar_index_CONTROL'])
  }, 60000)
})

describe('C45 — a capture that PROVES it starts at the vendor\'s bar 0 is graded, not withheld', () => {
  const read = (id) => JSON.parse(fs.readFileSync(path.join(HARNESS, `${id}.json`), 'utf8'))

  it('the control row is read on EVERY bar: 0, 1, 2 … or it is not the fact', () => {
    // an hourly and a weekly capture assert no listing, and print 0..n-1 themselves
    for (const id of ['vw-bool-cast-spy-60-2026-09-28', 'vw-object-gc-a-spy-1w-2026-09-28', 'vw-bar-counters-rddt-5-2026-09-30']) {
      const cap = read(id)
      expect(cap.history && cap.history.startsAtBar0, id).not.toBe(true)
      expect(barIndexStartsAtZero(cap), id).toBe(true)
    }
    // one that starts mid-history does not
    expect(barIndexStartsAtZero(read('vw-clock-vwap-spy-5-ext-2026-09-28'))).toBe(false)
    // one row out of step and it is not the fact (non-vacuity of the every-bar check)
    const cap = read('vw-bool-cast-spy-60-2026-09-28')
    const at = cap.plotValues.fields.indexOf(cap.study.plots.find((p) => p.title === 'B00_bar_index_CONTROL').id)
    cap.plotValues.rows[5000][at] += 1
    expect(barIndexStartsAtZero(cap)).toBe(false)
    // no control row at all: nothing is proved
    expect(barIndexStartsAtZero({ study: { plots: [] }, plotValues: { fields: ['time'], rows: [[1]] }, bars: { rows: [[1]] } })).toBe(false)
  })

  it('⛔ no member surface states it: only the engine reads the name, only the harness writes it', () => {
    const src = path.resolve(process.cwd(), 'src')
    const hits = []
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name)
        if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p); continue }
        if (!/\.(jsx?|mjs)$/.test(e.name)) continue
        if (fs.readFileSync(p, 'utf8').includes('barIndexFromFirstBar')) hits.push(path.relative(src, p).replace(/\\/g, '/'))
      }
    }
    walk(src)
    const product = hits.filter((f) => !/__tests__\//.test(f) && !/\.test\.js$/.test(f)).sort()
    // the reader, and the two places a caller's statement is passed through
    expect(product).toEqual([
      'components/chart/engine/binder.js',
      'components/chart/engine/nativeRegistry.js',
    ])
    // ⛔ non-vacuity: the walk does see the chart surface it is clearing
    expect(fs.existsSync(path.join(src, 'components/StockChart.jsx'))).toBe(true)
    expect(hits.length).toBeGreaterThan(product.length)
  })
})

// ─── THE OBJECT LANE: WHICH SLOT A BAR INDEX SITS IN ─────────────────────────
const SLOTS = `//@version=5
indicator("c45 slots", overlay=true)
if high > high[1]
    label.new(bar_index, high, "up")
if close > open
    label.new(bar_index, low, str.tostring(bar_index))
if bar_index % 7 == 0
    line.new(bar_index - 5, low, bar_index, high)
if bar_index > 50
    box.new(bar_index - 3, high, bar_index, low)
plot(close)
`

describe('C45 — the object lane: an x-coordinate is served, a value is withheld', () => {
  const cap = () => parent('vw-offset-na-spy-1d-2026-09-30')
  const run = (opts) => {
    const door = enterMemberDoor(SLOTS)
    try {
      expect(door.def, door.refusal).toBeTruthy()
      const bars = toProductBars(cap())
      const reader = objectReaderFor(door.def, bars, { inputs: undefined, tf: 'D', newestBarIsForming: false, ...opts })
      const out = evaluateObjects(reader.program, {
        barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t,
        readUnknown: reader.readUnknown, trace: true,
      })
      const created = {}
      for (const e of out.events || []) {
        if (e.k !== 'create') continue
        const k = `${e.family}@${e.site}`
        ;(created[k] = created[k] || []).push(e.bar)
      }
      return { bars, reader, out, created, sites: Object.keys(created).sort() }
    } finally {
      registry.uninstallUserDefinition(door.def.id)
    }
  }
  // what the script creates, counted off the bars themselves (never off our lane)
  const expected = () => {
    const rows = cap().bars.rows                                    // [t, o, h, l, c, v]
    const up = rows.map((r, i) => i > 0 && r[2] > rows[i - 1][2])
    const green = rows.map((r) => r[4] > r[1])
    return {
      up: up.filter(Boolean).length, upBars: up.map((b, i) => (b ? i : -1)).filter((i) => i >= 0),
      green: green.filter(Boolean).length,
      sevenths: rows.filter((_r, i) => i % 7 === 0).length,
      past50: rows.filter((_r, i) => i > 50).length,
    }
  }

  it('from the listing: every object the script creates is created', () => {
    const want = expected()
    const { out, reader, created } = run({ historyFromListing: true })
    expect(out.stats.created).toBe(want.up + want.green + want.sevenths + want.past50)
    expect(out.stats.withheldBarIndex).toBeUndefined()
    expect(reader.chartClock).toEqual([])
    expect(Object.values(created).map((b) => b.length).sort((a, b) => a - b))
      .toEqual([want.up, want.green, want.sevenths, want.past50].sort((a, b) => a - b))
    // non-vacuity: four different numbers, so a slot cannot stand in for another
    expect(new Set([want.up, want.green, want.sevenths, want.past50]).size).toBe(4)
  })

  it('⭐ off the listing: the label PLACED on a bar is drawn; the one that PRINTS the count, and the line GATED on it, are not', () => {
    const want = expected()
    const { out, reader, created } = run({})
    const counts = Object.entries(created).map(([k, b]) => [k.split('@')[0], b.length])
    // x-coordinate: `label.new(bar_index, high, "up")` — every one, on its own bar
    const labels = counts.filter(([f]) => f === 'label')
    expect(labels.length).toBe(1)
    expect(labels[0][1]).toBe(want.up)
    expect(Object.entries(created).find(([k]) => k.startsWith('label@'))[1]).toEqual(want.upBars)
    // value: `str.tostring(bar_index)` — none; counted as withheld, by the lane's own stat
    expect(out.stats.withheldBarIndex).toBe(want.green)
    // guard: `bar_index % 7 == 0` — no line at all (TradingView's 43 sit on other bars)
    expect(counts.filter(([f]) => f === 'line')).toEqual([])
    // threshold: `bar_index > 50` — true here on bars 51.., and a longer history
    // can only keep it true, so those boxes are drawn
    expect(counts.filter(([f]) => f === 'box')).toEqual([['box', want.past50]])
    expect(Math.min(...Object.entries(created).find(([k]) => k.startsWith('box@'))[1])).toBe(51)
    expect(out.stats.created).toBe(want.up + want.past50)
    // …and both withholdings are NAMED to the member, in the lane's own report
    expect(reader.chartClock.map((r) => r.code).sort()).toEqual(['bar-index:early-bars', 'bar-index:window'])
    expect(reader.chartClock.find((r) => r.code === 'bar-index:window').reason).toBe(CHART_CLOCK_WITHHELD['bar-index:window']('D'))
  })

  it('the x a served label sits on is the bar\'s own position in the loaded series', () => {
    const { out } = run({})
    const live = out.live.filter((o) => o.family === 'label')
    expect(live.length).toBeGreaterThan(0)
    for (const o of live) {
      expect(o.props.x, `label ${o.id}`).toBe(o.createdBar)
      expect(o.props.text).toBe('up')
    }
  })

  it('the caller\'s statement that bar 0 is the vendor\'s bar 0 serves the same set as the listing does', () => {
    const a = run({ historyFromListing: true })
    const b = run({ barIndexFromFirstBar: true })
    expect(b.created).toEqual(a.created)
    expect(b.reader.chartClock).toEqual([])
  })
})

describe('C45 — a real corpus script that reads `bar_index` as a coordinate is untouched', () => {
  it('heat-map-seasons (lines and boxes placed at bar_index ± n): same objects off the listing as on it', () => {
    const cap = parent('heat-map-seasons-rddt-1d-2026-09-28')
    const door = enterMemberDoor(cap.source.text)
    try {
      const bars = toProductBars(cap)
      const liveOf = (opts) => {
        const reader = objectReaderFor(door.def, bars, { inputs: undefined, tf: 'D', newestBarIsForming: false, ...opts })
        const out = evaluateObjects(reader.program, {
          barCount: bars.length, readNode: reader.readNode, readTime: (i) => bars[i].t, readUnknown: reader.readUnknown,
        })
        return { n: out.live.length, by: out.live.map((o) => `${o.family}:${o.id}`).sort(), held: out.stats.withheldBarIndex || 0,
          codes: reader.chartClock.map((r) => r.code).filter((c) => c.startsWith('bar-index:')) }
      }
      const on = liveOf({ historyFromListing: true })
      const off = liveOf({})
      expect(on.n).toBeGreaterThan(0)
      expect(off.by).toEqual(on.by)
      expect(off.held).toBe(0)
      expect(off.codes).toEqual([])
    } finally {
      registry.uninstallUserDefinition(door.def.id)
    }
  })
})
