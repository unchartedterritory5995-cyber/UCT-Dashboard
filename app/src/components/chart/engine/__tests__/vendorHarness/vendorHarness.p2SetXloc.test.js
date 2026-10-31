// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.p2SetXloc.test.js
//
// ─── P2 — `line.set_xloc`, AGAINST TRADINGVIEW'S OWN, AT THE RENDER STATE ──────
//
// `poor-man's volume profile` creates its two block lines once
// (`var line … = line.new(bar_index, high, bar_index, high)`) and on every bar moves
// them onto TIMES: `line.set_xloc(block_high_line, max(time[block_size],
// first_bar_time), time_close, xloc.bar_time)`, `block_size` = 200 by default. Before
// P2 that setter was a name the reader did not carry, so the two lines were withheld
// (C45, "2 of 246"). P2 carries it.
//
// ⛔⛔ P2b — GRADED WHERE THE MEMBER LOOKS: THE RENDER STATE. P2's first rail graded
// the program (and only the dense rank of x), and it passed while the render state
// DROPPED both lines: x2 is `time_close`, 16:00 on the last bar's date, and
// `timeAtInstant` placed only a bar's opening instant. Now an instant inside a loaded
// bar's span is that bar (`objectRenderState.js::makeBarClock`), and this pins:
//   · the program's x as the ACTUAL times the script computes off the capture's own
//     bars (x1 = the open of bar n-1-200, x2 = the last bar's 16:00 ET close);
//   · the render state drawing BOTH lines, nothing dropped, x1 on bar n-1-200's date
//     and x2 on the last bar's date;
//   · TradingView's records: same ids, same prices, and its x order (the capture's x is
//     a dense rank) — the lines' right ends share a rank with the forty labels made at
//     `time_close`, i.e. TradingView puts that instant on the last bar too.
//
// ⛔ The forty labels are not P2's (their text's run is over its per-bar budget) and
// are pinned as withheld, at the render state too.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import process from 'node:process'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
import { toRenderState } from '../../objectRenderState'
// ⭐ importing the runtime lane is what lets the object reader ask it (C18)
import { runtimeObjectValues } from '../../runtime/runtimeColumns'

vi.setConfig({ testTimeout: 60000 })

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/poor-man039s-volume-profile-rddt-1d-2026-09-28.json')
const BLOCK = 200

/** Dense rank of the distinct values, 0-based — the capture's own `x`. */
const denseRank = (xs) => {
  const order = [...new Set(xs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
  return xs.map((x) => order.indexOf(x))
}

function run() {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const loaded = loadCapture(FILE)
  expect(loaded.capture, loaded.reason).toBeTruthy()
  const cap = loaded.capture
  expect(cap.history && cap.history.startsAtBar0).toBe(true)
  expect(cap.source.text).toMatch(/block_size = input\(200,/)
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source: cap.source.text, id: 'u_p2_setxloc', name: 'pmvp' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    historyFromListing: true,
  })
  const out = evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
  const state = toRenderState(out.live, { bars, tf: 'D' })
  return { cap, bars, d, out, state }
}

describe('⭐ P2 — poor-man\'s volume profile: the two lines line.set_xloc moves, at the render state', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('the program holds the script\'s actual times: x1 = open of bar n-1-200, x2 = the last close (16:00 ET)', () => {
    const { cap, d, out } = run()
    expect(d.translation.objectDiagnostics.dropReasons).toEqual({})
    const rows = cap.bars.rows
    const n = rows.length
    const lines = out.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    expect(lines.map((l) => l.props.xloc)).toEqual(['bar_time', 'bar_time'])
    // the capture's bars are unix seconds at the session open (09:30 ET)
    const openOf = (i) => rows[i][0] * 1000
    const lastClose = openOf(n - 1) + 6.5 * 3600 * 1000
    for (const l of lines) expect([l.props.x1, l.props.x2]).toEqual([openOf(n - 1 - BLOCK), lastClose])
  })

  it('⭐⭐ the RENDER STATE draws both lines, nothing dropped, on bar n-1-200 and on the last bar', () => {
    const { cap, bars, state } = run()
    const n = bars.length
    expect(state.dropped.line).toBe(0)
    expect(state.lines).toHaveLength(2)
    for (const l of state.lines) {
      expect(l.x1).toBe(bars[n - 1 - BLOCK].t)
      expect(l.x2).toBe(bars[n - 1].t)
    }
    // TradingView's records: same ids, same prices
    const vLines = cap.objects.records.lines
    const oLines = [...state.lines].sort((a, b) => a.id - b.id)
    expect(oLines.map((l) => l.id)).toEqual(vLines.map((l) => l.id))
    expect(oLines.map((l) => [l.y1, l.y2])).toEqual(vLines.map((l) => [l.y1, l.y2]))
    // …and TradingView's x order, its `time_close` labels included: the lines' right
    // end and every label share one rank, the left end the rank below it
    const vxs = [...vLines.flatMap((l) => [l.x1, l.x2]), ...cap.objects.records.labels.map((l) => l.x)]
    expect(new Set(vxs.slice(4))).toEqual(new Set([vLines[0].x2]))
    expect(denseRank(oLines.flatMap((l) => [l.x1, l.x2]))).toEqual(vLines.flatMap((l) => [l.x1, l.x2]))
    // the harness's own grade agrees on the family
    const { verdict } = gradeCapture(cap)
    expect(verdict.objects.counts.find((c) => c.family === 'lines')).toMatchObject({ vendor: 2, ours: 2, agree: true })
  })

  it('⛔ the forty labels stay withheld (their text\'s run stops on the per-bar budget) — not drawn at the render state either', () => {
    const { cap, bars, d, out, state } = run()
    expect(cap.objects.records.labels.length).toBe(40)
    expect(out.live.filter((o) => o.family === 'label').length).toBe(0)
    expect(state.labels).toHaveLength(0)
    const r = runtimeObjectValues(d.definition.objects.runtime, bars, {
      tf: 'D', fromListing: true, atDefaults: true, newestBarIsForming: false, symbol: { ticker: 'RDDT', exchange: 'NYSE' },
    })
    expect(r.served).toBe(false)
    expect(r.reason).toBe('runtime:INSTRUCTIONS_PER_BAR')
  })
})
