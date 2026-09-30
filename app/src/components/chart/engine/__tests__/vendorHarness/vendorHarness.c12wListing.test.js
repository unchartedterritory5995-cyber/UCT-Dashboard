// app/src/components/chart/engine/__tests__/vendorHarness/vendorHarness.c12wListing.test.js
//
// ─── C12w — THE LISTING SEED, WITNESSED BY TRADINGVIEW'S OWN CAPTURES ──────────
//
// Ruling R-W: a series that provably starts at the symbol's first-ever bar may
// seed a Pine `var` there and lift the warm-up curtain. NYSE:RDDT 1D listed on
// 2024-03-21; every RDDT capture here holds all 632 bars from that day
// (`history.startsAtBar0: true`, asserted by the batch only when the vendor's
// history stopped growing AND began on the listing day). So these captures are
// exactly the case the exception is for, and the curtained objects are the
// measurement.
//
// ⭐ WHAT IS PINNED, AND WHY IT IS STRONGER THAN A COUNT. TradingView numbers
// every drawing with ONE creation counter across lines, labels and boxes, and so
// does `objectRuntime` (`nextId`). Before C12w our side held TradingView's tail
// with the first creates missing, so every id we held sat a fixed offset below
// the vendor's (C16's rail pins exactly that offset, 10, on smc). Under the
// listing seed we hold EVERY object, and the ids agree with no offset at all —
// order, family, price and caption, one for one.
//
// ⛔ EACH `it` HAS A CONTROL: the same capture with the listing statement taken
// away must still show the curtain. A rail that passed both ways would prove the
// captures, not the exception.
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import path from 'node:path'

import { loadCapture, gradeCapture } from './harness'
import { runOurSide, toProductBars } from './ourSide'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { objectReaderFor } from '../../objectColumns'
import { evaluateObjects } from '../../objectRuntime'

// ⛔ market-structure draws objects only: its door needs the objects-only pane, which
// production arms (`docs/feature_flags.json`) and vitest's env leaves unset. Stubbed
// here, read off the gate's own flag name, so the rail does not depend on the shell.
beforeAll(() => { vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1') })
afterAll(() => { vi.unstubAllEnvs() })

const capture = (name) => {
  const loaded = loadCapture(path.resolve(process.cwd(), '..', 'tests/fixtures/vendor/harness', name))
  if (!loaded.capture) throw new Error(`not a capture — ${loaded.reason}`)
  return loaded.capture
}
const withoutListing = (cap) => ({ ...cap, history: { ...(cap.history || {}), startsAtBar0: false } })

function memberRun(cap, listing) {
  const bars = toProductBars(cap)
  const d = memberPaneDefinition({ source: cap.source.text, id: 'u_c12w_listing', name: 'c12w' })
  expect(d.ok, d.reason).toBe(true)
  const reader = objectReaderFor(d.definition, bars, {
    tf: 'D', symbol: { ticker: 'RDDT', exchange: 'NYSE' }, newestBarIsForming: cap.newestBarIsForming ?? null,
    ...(listing ? { historyFromListing: true } : {}),
  })
  return evaluateObjects(reader.program, {
    barCount: bars.length, readNode: reader.readNode, readTime: reader.readTime, readUnknown: reader.readUnknown,
  })
}

const vendorObjects = (cap) => {
  const r = cap.objects.records
  return [
    ...(r.lines || []).map((l) => ({ f: 'line', id: l.id, y: [l.y1, l.y2], t: null })),
    ...(r.labels || []).map((l) => ({ f: 'label', id: l.id, y: [l.y], t: String(l.t) })),
  ].sort((a, b) => a.id - b.id)
}
const ourObjects = (run) => run.live.filter((o) => o.family === 'line' || o.family === 'label').map((o) => {
  const p = o.props
  if (o.family === 'line') return { f: 'line', id: o.id, y: [p.y1, p.y2], t: null }
  return { f: 'label', id: o.id, y: [p.y], t: String(p.text) }
}).sort((a, b) => a.id - b.id)
const key = (o) => `${o.id}|${o.f}|${o.t}|${o.y.map((v) => Math.round(v * 1e4) / 1e4).join(',')}`

const WITNESSES = [
  // [capture, lines, labels] as TradingView holds them at the last bar
  ['market-structure-by-leviathan-rddt-1d-2026-09-28.json', 6, 22],
  ['institutional-smc-order-flow-matrix-pro-rddt-1d-2026-09-28.json', 18, 34],
]

describe('C12w — the listing seed reproduces TradingView\'s structure objects, id for id', () => {
  for (const [name, lines, labels] of WITNESSES) {
    describe(name, () => {
      const cap = capture(name)

      it('⛔ CONTROL — the capture is a from-listing capture and holds what we say it holds', () => {
        expect(cap.history.startsAtBar0).toBe(true)
        expect(new Date(cap.bars.rows[0][0] * 1000).toISOString().slice(0, 10)).toBe('2024-03-21')
        expect(cap.objects.counts.lines).toBe(lines)
        expect(cap.objects.counts.labels).toBe(labels)
      })

      it('⭐⭐ every line and label TradingView holds, and nothing else: id, family, price, caption', () => {
        const O = ourObjects(memberRun(cap, true))
        expect(O.map(key)).toEqual(vendorObjects(cap).map(key))
      }, 60000)

      it('⛔ CONTROL — without the listing statement the curtain still withholds the early ones', () => {
        const O = ourObjects(memberRun(cap, false))
        expect(O.length).toBeLessThan(lines + labels)
      }, 60000)

      it('⭐ the harness grades the objects MATCH from the capture\'s own statement — and not without it', () => {
        const ours = runOurSide(cap)
        expect(ours.ok, ours.refusal).toBe(true)
        expect(ours.objects.counts.lines).toBe(lines)
        expect(ours.objects.counts.labels).toBe(labels)
        const control = runOurSide(withoutListing(cap))
        expect(control.objects.counts.lines + control.objects.counts.labels).toBeLessThan(lines + labels)
      }, 60000)
    })
  }
})

describe('C12w — the plot lane: trend-duration-forecast HMA, value AND colour from the listing day', () => {
  // The HMA's colour is `var trend` (rising/falling state). Under the curtain the
  // colour condition read the not-computable prefix as `na`, and the else-branch
  // colour was DRAWN on 138 bars where TradingView drew the other one — measured
  // 2026-09-29 (`#ec5610ff` vs the vendor's `#12e49eff`, bars 58-230).
  const cap = capture('trend-duration-forecast-chartprime-rddt-1d-2026-09-28.json')
  const hmaOf = (ours) => ours.plots.find((p) => p.title === 'HMA')

  it('⭐ the harness grades the HMA MATCH — every value and every captured colour, all 632 bars', () => {
    const { verdict, integrity } = gradeCapture(cap)
    expect(integrity.ok).toBe(true)
    const p = verdict.plots.find((x) => x.title === 'HMA')
    expect(p.verdict, p.reason).toBe('MATCH')
    expect(p.color).toBe('compared')
    expect(p.stats.steady.compared).toBe(632)
    expect(p.stats.colorMismatches).toBe(0)
  }, 60000)

  it('⛔ CONTROL — without the listing statement the drawn colour differs on the formerly curtained bars', () => {
    const listed = hmaOf(runOurSide(cap)).colors
    const curtained = hmaOf(runOurSide(withoutListing(cap))).colors
    const moved = listed.filter((c, i) => i >= 58 && i <= 230 && c !== curtained[i]).length
    expect(moved).toBeGreaterThan(0)
  }, 60000)
})
