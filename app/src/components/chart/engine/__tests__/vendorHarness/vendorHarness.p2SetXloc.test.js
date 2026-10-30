// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.p2SetXloc.test.js
//
// ─── P2 — `line.set_xloc`, AGAINST TRADINGVIEW'S OWN ─────────────────────────
//
// `poor-man's volume profile` creates its two block lines once
// (`var line … = line.new(bar_index, high, bar_index, high)`) and on every bar moves
// them onto TIMES: `line.set_xloc(block_high_line, max(time[block_size],
// first_bar_time), time_close, xloc.bar_time)`. Before P2 that setter was a name
// the reader did not carry, so the two lines were WITHHELD (C45: 2 of 246 short,
// `vendorHarness.c45LostUpdates`). It is carried now — x1, x2 and xloc in one
// update — and this pins the two lines against the live capture (NYSE:RDDT 1D,
// 2026-09-28): same ids, same prices, x on TIMES, spanning the block the vendor's
// dense x rank says (x1 rank 0, x2 rank 1).
//
// ⛔ THE FORTY `#…` LABELS ARE NOT P2's AND ARE PINNED AS WHAT THEY ARE. Their text
// is the per-bar runtime lane's (C20), and on this capture that run stops on its
// per-bar instruction budget (`runtime:INSTRUCTIONS_PER_BAR`), so every label is
// withheld (drawn nothing, never drawn blank). Budgets are never raised; making
// that run cheaper is the runtime lane's work (Phase 3). The day it is, the second
// test goes red and is to be replaced by the id-for-id label grade.
import { describe, it, expect, vi, afterEach } from 'vitest'
import path from 'node:path'
import process from 'node:process'

import { loadCapture, gradeCapture } from './harness'
import { toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'
// ⭐ importing the runtime lane is what lets the object reader ask it (C18)
import { runtimeObjectValues } from '../../runtime/runtimeColumns'

vi.setConfig({ testTimeout: 60000 })

const FILE = path.resolve(process.cwd(), '..',
  'tests/fixtures/vendor/harness/poor-man039s-volume-profile-rddt-1d-2026-09-28.json')

/** Dense rank of the distinct values, 0-based — the capture's own `x`. */
const denseRank = (xs) => {
  const order = [...new Set(xs)].sort((a, b) => a - b)
  return xs.map((x) => order.indexOf(x))
}

function run() {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const loaded = loadCapture(FILE)
  expect(loaded.capture, loaded.reason).toBeTruthy()
  const cap = loaded.capture
  expect(cap.history && cap.history.startsAtBar0).toBe(true)
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
  return { cap, bars, d, out }
}

describe('⭐ P2 — poor-man\'s volume profile: the two lines line.set_xloc moves, id for id', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('same ids, same prices, x on times spanning the vendor\'s block; nothing dropped', () => {
    const { cap, d, out } = run()
    expect(d.translation.objectDiagnostics.dropReasons).toEqual({})
    expect(d.translation.objectDiagnostics.unsupported).toEqual([])
    const vLines = cap.objects.records.lines
    const oLines = out.live.filter((o) => o.family === 'line').sort((a, b) => a.id - b.id)
    expect(oLines.map((l) => l.id)).toEqual(vLines.map((l) => l.id))
    expect(oLines.map((l) => l.props.xloc)).toEqual(['bar_time', 'bar_time'])
    expect(oLines.map((l) => [l.props.y1, l.props.y2])).toEqual(vLines.map((l) => [l.y1, l.y2]))
    expect(denseRank(oLines.flatMap((l) => [l.props.x1, l.props.x2]))).toEqual(vLines.flatMap((l) => [l.x1, l.x2]))
    // ⛔ CONTROL: the move is real — the lines were created zero-length at a bar INDEX
    expect(cap.source.text).toMatch(/var line block_high_line = line\.new\(bar_index, high, bar_index, high/)
    expect(oLines.every((l) => l.props.x2 > l.props.x1)).toBe(true)
    // and the harness's own grade agrees on the family
    const { verdict } = gradeCapture(cap)
    expect(verdict.objects.counts.find((c) => c.family === 'lines')).toMatchObject({ vendor: 2, ours: 2, agree: true })
  })

  it('⛔ the forty labels stay withheld: their text\'s run stops on the per-bar budget (Phase 3)', () => {
    const { cap, bars, d, out } = run()
    expect(cap.objects.records.labels.length).toBe(40)
    expect(out.live.filter((o) => o.family === 'label').length).toBe(0)
    const r = runtimeObjectValues(d.definition.objects.runtime, bars, {
      tf: 'D', fromListing: true, atDefaults: true, newestBarIsForming: false, symbol: { ticker: 'RDDT', exchange: 'NYSE' },
    })
    expect(r.served).toBe(false)
    expect(r.reason).toBe('runtime:INSTRUCTIONS_PER_BAR')
  })
})
