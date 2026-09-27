// app/src/components/chart/builder/memberPane/runtimeWallsNewlyAttaching.test.js
//
// ─── EVERY SCRIPT THE RUNTIME-WALLS WORK NEWLY ATTACHES, ON REAL BARS (2026-09-27) ───
//
// Each capability added on `pine/runtime-walls` is measured by the door census
// (`runtimeLaneDoor.census.measure.test.js`); this file holds every script that
// census newly attaches to the bar it must clear before a member sees it: through the
// REAL member door, installed, computed on real bars (600 SPY daily bars and the
// 631-bar NYSE:RDDT listing history from a vendor capture), and
//   · no throw and no column error,
//   · no ±Infinity anywhere,
//   · a `plot` line, once it has started, never falls back to `na` (NaN-poisoning),
//     and sits inside a plausible band of the price it overlays,
//   · a `plotshape` fires 0/1 only, and fires on SOME bar without firing on most.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { memberPaneDefinition } from './memberPaneDefinition'
import * as registry from '../../engine/nativeRegistry'

afterEach(() => {
  vi.unstubAllEnvs()
  for (const d of registry.listUserDefinitions()) registry.uninstallUserDefinition(d.id)
})

const REPO = path.resolve(process.cwd(), '..')
const corpus = (name) => fs.readFileSync(path.join(REPO, 'corpus/committed', `${name}.pine`), 'utf8')
const SPY = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/vendor/spy-1d-bars-3000-2026-09-13.json'), 'utf8'))
  .bars.slice(-600)
const RDDT = JSON.parse(fs.readFileSync(path.join(REPO,
  'tests/fixtures/vendor/harness/pivot-point-supertrend-rddt-1d-2026-09-27.json'), 'utf8'))
  .bars.rows.map(([t, o, h, l, c, v]) => ({ t: new Date(t * 1000).toISOString().slice(0, 10), o, h, l, c, v }))
const CTX = { tf: 'D', newestBarIsForming: false }

/** name → what its shapes are allowed to do (a shape gated by an input that is OFF
 *  by default draws nothing, exactly as on TradingView). */
const NEWLY = {
  'atr-stepped-pdf-ma-loxx__9b90a3f7bb': { shapesMayBeSilent: true },   // `showSigs` defaults false
  'twin-range-filter__xF3L2PeXm7': {},
  'range-filter-bs-signals__eCVFctFlqp': {},
  // `i_bothEMAs` defaults true, so the consolidated line is `na` on every bar by
  // the author's own ternary — on TradingView too.
  'btc-charlie-trader-xo-macro-trend-scanner__1f1c092d6a': { naByInput: ['Consolidated EMA'] },
  // `Alert Stream` is a hidden -1/0/1 signal plot (`display = display.none`), not a price
  'nadaraya-watson-rational-quadratic-kernel-non-repainting__2d248c3125': {
    shapesMayBeSilent: true, signals: { 'Alert Stream': [-1, 0, 1] },
  },
}

describe('⭐ newly attaching through the runtime lane — finite, plausible, no NaN-poisoning', () => {
  for (const [name, rule] of Object.entries(NEWLY)) {
    for (const [label, bars] of [['SPY 600', SPY], ['RDDT 631', RDDT]]) {
      it(`${name} on ${label}`, () => {
        vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
        const d = memberPaneDefinition({ source: corpus(name), id: 'u_member-pane-rtw' })
        expect(d.ok, d.reason).toBe(true)
        expect(d.lane).toBe('runtime')
        const { installed, errors } = registry.installUserDefinitions([d.definition])
        expect(errors).toEqual([])
        const cols = registry.computeFor(installed[0], bars, undefined, CTX)
        expect(registry.columnErrors(cols)).toEqual({})
        const lo = Math.min(...bars.map((b) => b.l))
        const hi = Math.max(...bars.map((b) => b.h))
        const specs = d.definition.compute.columns
        let lines = 0
        let shapesFired = 0
        for (const t of [...(rule.naByInput || []), ...Object.keys(rule.signals || {})]) {
          expect(d.rows.map((r) => r.label), t).toContain(t)
        }
        for (const row of d.rows.filter((r) => !r.colourFor)) {
          const call = specs[row.key] && specs[row.key].call
          const col = Array.from(cols[row.key])
          expect(col.length, row.label).toBe(bars.length)
          expect(col.some((v) => v === Infinity || v === -Infinity), `${row.label} carries Infinity`).toBe(false)
          if (call === 'plot' && rule.signals && rule.signals[row.label]) {
            const allowed = rule.signals[row.label]
            expect(col.every((v) => allowed.includes(v)), `${row.label} is not a ${allowed} signal`).toBe(true)
            expect(new Set(col).size, `${row.label} never moves`).toBeGreaterThan(1)
          } else if (call === 'plot' && (rule.naByInput || []).includes(row.label)) {
            expect(col.filter(Number.isFinite), `${row.label} should be na by input`).toEqual([])
          } else if (call === 'plot') {
            lines += 1
            const first = col.findIndex(Number.isFinite)
            expect(first, `${row.label} never draws`).toBeGreaterThanOrEqual(0)
            expect(first, `${row.label} starts too late`).toBeLessThan(bars.length / 2)
            const holes = col.slice(first).filter((v) => !Number.isFinite(v)).length
            expect(holes, `${row.label} falls back to na after it started (NaN-poisoning)`).toBe(0)
            for (const v of col.slice(first)) {
              expect(v, `${row.label} left the price band`).toBeGreaterThan(lo * 0.5)
              expect(v, `${row.label} left the price band`).toBeLessThan(hi * 2)
            }
          } else if (call === 'plotshape') {
            const fin = col.filter(Number.isFinite)
            expect(fin.every((v) => v === 0 || v === 1), `${row.label} is not a 0/1 signal`).toBe(true)
            const ones = fin.filter((v) => v === 1).length
            expect(ones, `${row.label} fires on most bars`).toBeLessThan(bars.length / 2)
            shapesFired += ones
          }
        }
        if (!rule.shapesMayBeSilent) expect(shapesFired, 'no signal ever fired').toBeGreaterThan(0)
        expect(lines + d.rows.length, 'nothing is drawn').toBeGreaterThan(0)
      })
    }
  }
})

// ⛔ ADMITTED BY THE DOOR, STOPPED ON EVERY REAL CHART — and pinned as exactly that, so
// the census's count of it is never read as a working indicator. wyckoff's
// `myhigh(len)` fills an array in a loop bounded by `ta.barssince(…)`, which is `na`
// until the first event, so its `array.max` meets an EMPTY array (and later `high[i]`
// before bar i exists). What TradingView answers for either has not been measured
// (capture queue Q5), and the engine stops by name rather than guess. When Q5 is
// captured this block flips to the finite/plausible check above.
describe('⛔ wyckoff-accumulation-distribution — attaches, then stops by name on Q5', () => {
  for (const [label, bars] of [['SPY 600', SPY], ['RDDT 631', RDDT]]) {
    it(label, () => {
      vi.stubEnv('VITE_PINE_RUNTIME_LANE_ENABLED', '1')
      const d = memberPaneDefinition({ source: corpus('wyckoff-accumulation-distribution__d9ae726e21'), id: 'u_member-pane-rtw' })
      expect(d.ok, d.reason).toBe(true)
      expect(d.lane).toBe('runtime')
      const { installed, errors } = registry.installUserDefinitions([d.definition])
      expect(errors).toEqual([])
      const errs = Object.values(registry.columnErrors(registry.computeFor(installed[0], bars, undefined, CTX)))
      expect(errs.length, 'expected the Q5 stop').toBeGreaterThan(0)
      for (const e of errs) expect(e.message).toMatch(/array\.(max|min): .*capture queue Q5/)
    })
  }
})
