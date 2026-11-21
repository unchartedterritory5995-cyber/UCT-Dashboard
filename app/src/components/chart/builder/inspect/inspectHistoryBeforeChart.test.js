// ⭐⭐ (A), coordinator ruling 2026-11-20: "INSPECT A BAR" COMPUTES A SCRIPT THAT READS BEFORE THE CHART.
//
// The panel computes the member's script headless, on the chart it was opened over, with no listing fact
// (`InspectBarPanel`: `computeFor({ tf, sym })`). Since engine 90 a script that draws from a read before the
// chart's first bar (`plot(nz(close[1]))`) answered "This script is not computed here" there: the headless
// lane refused it whole for its one named bar. Now it computes. Each variable shows every bar, except the
// bars named `history:before-chart`, which are empty in the panel and in the by-hand plot alike.
import { describe, it, expect } from 'vitest'
import { names, build, computeFor } from './inspectDoors'
import { inspectScript, probeTitle } from './barInspection'
import { referenceBars } from '../../engine/referenceSeries.js'

const BARS = referenceBars()
const compute = computeFor({ tf: 'D', sym: 'TEST' })
const script = (title, body) => ['//@version=6', `indicator("${title}")`, ...body].join('\n')
const same = (a, b) => (Number.isNaN(a) && Number.isNaN(b)) || Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))

/** [title, body, { variable: [expression by hand, bars named at the left edge] }] */
const CASES = [
  ['The bar before, or zero', ['x = nz(close[1])', 'plot(x)'], { x: ['nz(close[1])', 1] }],
  ['Up from the bar before', ['up = close > close[1] ? 1 : 0', 'plot(up)'], { up: ['close > close[1] ? 1 : 0', 1] }],
]

describe('(A) Inspect a bar computes a script that reads before the chart, off the listing', () => {
  for (const [title, body, byHand] of CASES) {
    it(`${title}: computed, every bar shown except the named ones`, async () => {
      const got = await inspectScript({ source: script(title, body), bars: BARS, names, build, compute })
      expect(got.ok, got.reason).toBe(true)
      expect(got.failed).toEqual([])
      const hand = build(script(`${title} by hand`, Object.entries(byHand).map(([n, [e]]) => `plot(${e}, title="hand ${n}")`)))
      expect(hand.ok, hand.reason).toBe(true)
      const handOut = compute(hand.definition, BARS)
      expect(Array.isArray(handOut.outputs), handOut.reason).toBe(true)
      for (const [name, [, held]] of Object.entries(byHand)) {
        const mine = got.columns[probeTitle(name)]
        const want = handOut.outputs.find((o) => o.title === `hand ${name}`)
        expect(mine, name).toBeDefined()
        expect(want.withheld).toEqual([{ code: 'history:before-chart', bars: held }])
        for (let i = 0; i < held; i++) expect(Number.isNaN(mine[i]), `${name} bar ${i} is the named one`).toBe(true)
        let bad = -1
        let filled = 0
        for (let i = 0; i < mine.length && bad === -1; i++) {
          if (!same(mine[i], want.values[i])) bad = i
          else if (Number.isFinite(mine[i])) filled += 1
        }
        expect(bad, `${name} differs from its by-hand plot at bar ${bad}`).toBe(-1)
        expect(filled, `${name}: every bar past the named ones is shown`).toBe(BARS.length - held)
      }
    })
  }
})
