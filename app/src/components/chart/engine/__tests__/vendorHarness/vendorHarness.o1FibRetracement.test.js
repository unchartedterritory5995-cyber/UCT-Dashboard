// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.o1FibRetracement.test.js
//
// ─── O1 (step 67) G7 — fib-retracement, through the member door, on vendor bars ─
//
// `fib-retracement` (corpus/committed) draws its levels with two helpers that
// delete and redraw one `var` line / label each, and calls four of them as
// `x = ExtraFibs ? Fib_line(…) : na`. The object lane refused those four calls
// (`fn:in-expression`), the lost bodies held `line.delete` / `label.delete`, and
// the door refused the whole script `pine:object-removal-lost`. G7 reads that
// statement as `if ExtraFibs` + the call (Pine runs only the arm `?:` picks).
//
// ⛔ NO TRADINGVIEW CAPTURE OF THIS SCRIPT EXISTS (queued:
// docs/pine/vendor-harness/capture-queue-2026-10-02-o1-drawing-only.md). The bars are the
// vendor's own (NYSE:RDDT 1D, a committed capture used here for its OHLC only),
// and every drawn object is held to the script's Pine semantics computed
// INDEPENDENTLY below from those bars — `highest(100)` / `lowest(100)`, the
// `*bars` offsets, the level formula, `tostring(x, "##.########")` — never to
// the engine's own output. At the default inputs (`ExtraFibs = false`) the four
// ternary calls never run: TradingView holds 7 lines and 7 labels, not 8.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { runOurSide, HARNESS_DEF_ID } from './ourSide'
import { REPO } from './harness'

const CAPTURE = path.join(REPO, 'tests/fixtures/vendor/harness/adx-and-di-for-v4-rddt-1d-2026-09-27.json')
const SCRIPT = path.join(REPO, 'corpus/committed/fib-retracement__8XcLscnekw.pine')
const LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1]
const LABEL_WORD = ['0 ( ', '0.236 ( ', '0.382 ( ', '0.500 ( ', '0.618 ( ', '0.786 ( ', '1.000 ( ']

afterEach(() => { vi.unstubAllEnvs() })

/** `tostring(x, "##.########")`: up to eight decimals, trailing zeros dropped. */
const fmt8 = (x) => String(Number(x.toFixed(8)))

function expected(rows, fields) {
  const hi = rows.map((r) => r[fields.indexOf('high')])
  const lo = rows.map((r) => r[fields.indexOf('low')])
  const last = rows.length - 1
  // Pine's highestbars/lowestbars: the offset (≤ 0) of the FIRST extreme met
  // walking back from the current bar — a later tie does not move it.
  let fh = -Infinity
  let fl = Infinity
  let FH = 0
  let FL = 0
  for (let k = 0; k < 100; k += 1) {
    const i = last - k
    if (hi[i] > fh) { fh = hi[i]; FH = -k }
    if (lo[i] < fl) { fl = lo[i]; FL = -k }
  }
  const rev = FL > FH // `not Reverse ? FL > FH : FL < FH`, Reverse = false
  const fx = (m) => (rev ? (fh - fl) * m + fl : fh - (fh - fl) * m)
  const bb = FL < FH ? last + FL : last + FH // bar_index[-FL] / bar_index[-FH]
  return { last, bb, ys: LEVELS.map(fx) }
}

describe('O1 G7 — fib-retracement draws its Pine picture through the member door', () => {
  const cap = JSON.parse(fs.readFileSync(CAPTURE, 'utf8'))
  const source = fs.readFileSync(SCRIPT, 'utf8')

  const run = () => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    const ours = runOurSide({ ...cap, source: { ...cap.source, text: source } })
    registry.uninstallUserDefinition(HARNESS_DEF_ID)
    return ours
  }

  it('⛔ CONTROL — the vendor bars are there, and the script carries the four ternary calls', () => {
    expect(cap.bars.rows.length).toBeGreaterThan(200)
    expect(source.match(/ExtraFibs\s*\?\s*Fib_(line|label)\(/g) || []).toHaveLength(4)
  })

  it('the door attaches it, and every object is the one Pine computes from these bars', () => {
    const ours = run()
    expect(ours.ok, ours.refusal).toBe(true)
    const objs = ours.objects
    expect(objs && objs.ok).toBe(true)
    const { last, bb, ys } = expected(cap.bars.rows, cap.bars.fields)
    const lines = objs.held.filter((o) => o.family === 'line')
    const labels = objs.held.filter((o) => o.family === 'label')
    // ⛔ 7, not 8: `ExtraFibs` is false, so `Fib886 = ExtraFibs ? Fib_line(…) : na` draws nothing.
    expect(lines).toHaveLength(7)
    expect(labels).toHaveLength(7)
    lines.forEach((l, i) => {
      expect(l.props.x1).toBe(bb)
      expect(l.props.x2).toBe(last)
      expect(l.props.y1).toBeCloseTo(ys[i], 9)
      expect(l.props.y2).toBeCloseTo(ys[i], 9)
    })
    labels.forEach((l, i) => {
      expect(l.props.x).toBe(last)
      expect(l.props.y).toBeCloseTo(ys[i], 9)
      expect(l.props.text).toBe(`${LABEL_WORD[i]}${fmt8(ys[i])} )`)
    })
  })
})
