// app/src/components/chart/engine/__tests__/blockRunsParity.test.js
//
// ─── C48 / C45 — `meta.blockRuns`, THE SAME ANSWER ON THE CHART AND ON THE SERVER ──
//
// A member pane attaches ONE document. The chart's bind refuses a plot the member
// door stamped (`engine/blockRuns.js`) wherever the code its gate guards runs after
// a bar it skipped; the server's user-series alert and scan sweep evaluate the same
// saved document with `ast_interpret`, and since this file they ask the same
// question of the same stamp (`api/services/block_runs.py`).
//
// ⭐ THE FIXTURE IS THE ONE AUTHORITY: `tests/fixtures/ast/block_runs_parity.json`.
// This file WRITES it (`BLOCK_RUNS_PARITY_WRITE=1`) from the JS lane's own output and
// otherwise READS it and requires the JS lane to reproduce it exactly, so neither
// lane can drift without a red; `tests/test_block_runs_parity.py` holds the Python
// lane to the same file. The documents are the member door's own, built from Pine
// sources over a real vendor capture's bars (RDDT 1D, `vw-arm-history`), and the
// expected sentence is what the chart's bind (`computeFor`) answers — off the
// listing, which is what a server lane always is.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { loadCapture } from './vendorHarness/harness'
import { toProductBars, enterMemberDoor, HARNESS_DEF_ID } from './vendorHarness/ourSide'
import * as registry from '../nativeRegistry'
import { firstRunAfterSkip, BLOCK_RUNS_GUARD } from '../blockRuns'

const REPO = path.resolve(process.cwd(), '..')
const FIXTURE = path.join(REPO, 'tests/fixtures/ast/block_runs_parity.json')
const CAPTURE = path.join(REPO, 'tests/fixtures/vendor/harness/vw-arm-history-rddt-1d-2026-10-02.json')

afterEach(() => { vi.unstubAllEnvs() })

const v6 = (...body) => ['//@version=6', 'indicator("block runs parity")', 'up = close > open', ...body].join('\n')

/** The scripts, each one plot: [name, source]. */
const SCRIPTS = [
  ['?: true arm (T03)', v6('y = up ? ta.sma(close, 5) : close', 'plot(y, "Y")')],
  ['?: false arm (T02)', v6('y = up ? na : ta.lowest(low, 10)', 'plot(y, "Y")')],
  ['v6 and', v6('x = up and ta.crossover(close, ta.sma(close, 5))', 'plot(x ? 1 : 0, "X")')],
  ['v6 or', v6('x = up or ta.change(close) > 0', 'plot(x ? 1 : 0, "X")')],
  ['?: test true on every bar', v6('y = volume >= 0 ? ta.sma(close, 5) : close', 'plot(y, "Y")')],
  ['?: test never true', v6('y = close < 0 ? ta.sma(close, 5) : close', 'plot(y, "Y")')],
  ['smoothed MA seed arm', ['//@version=6', 'indicator("smma")', 'len = input.int(7, "Length")', 'src = close',
    'smma = 0.0', 'smma := na(smma[1]) ? ta.sma(src, len) : (smma[1] * (len - 1) + src) / len', 'plot(smma, "SMMA")'].join('\n')],
  ['if block (C48)', v6('float v = na', 'if up', '    v := ta.sma(close, 3)', 'plot(v, "V")')],
  ['input knob in the guard', v6('k = input.float(0.0, "Cut")', 'y = close - open > k ? ta.ema(close, 5) : close', 'plot(y, "Y")')],
]

/** `firstRunAfterSkip` on hand-written columns (`null` = not computable). */
const COLUMNS = [
  [1, 1, 1, 1], [0, 0, 0], [1, 1, 0, 0], [1, 0, 1], [0, 0, 1, 1], [true, false, false, true], [],
  [null, null, 1, 1], [1, null, 1], [0, null, null], [null, 0, null, 1], [2, -1, 0, 0.5], [0, 0, -3],
]

function buildDoc() {
  const cap = loadCapture(CAPTURE).capture
  const bars = toProductBars(cap)
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  const cases = SCRIPTS.map(([name, source]) => {
    const door = enterMemberDoor(source)
    try {
      expect(door.def, `${name}: ${door.refusal || ''}`).toBeTruthy()
      const def = door.def
      const keys = (def.plots || []).map((p) => p.key)
      expect(keys, name).toHaveLength(1)
      const key = keys[0]
      // the chart's own bind, OFF the listing (no server lane can state one)
      const cols = registry.computeFor(def, bars, undefined, { tf: 'D' })
      const err = (registry.columnErrors(cols) || {})[key]
      const expected = err && err.guard === BLOCK_RUNS_GUARD ? err.message : null
      return {
        name,
        key,
        definition: {
          meta: def.meta.blockRuns ? { blockRuns: def.meta.blockRuns } : {},
          inputs: def.inputs || [],
        },
        expected,
      }
    } finally {
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
    }
  })
  return {
    _: 'C48 / C45 — `meta.blockRuns` on the chart and on the server. Written by '
      + 'app/src/components/chart/engine/__tests__/blockRunsParity.test.js (BLOCK_RUNS_PARITY_WRITE=1) and read by that '
      + 'file and by tests/test_block_runs_parity.py. `columns`: firstRunAfterSkip (null = not computable) -> '
      + '[skipped, bar] or null. `cases`: the member door\'s own document (its stamp and inputs) for each script, and '
      + '`expected` is the chart\'s bind answer over `bars` (RDDT 1D from vw-arm-history, off the listing): the '
      + '`pine:block` refusal sentence, or null when the plot is drawn.',
    bars: bars.map((b) => ({ t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v })),
    columns: COLUMNS.map((column) => {
      const hit = firstRunAfterSkip(column.map((v) => (v === null ? NaN : v)))
      return { column, expected: hit ? [hit.skipped, hit.bar] : null }
    }),
    cases,
  }
}

describe('C48 / C45 — the blockRuns parity fixture', () => {
  it('⭐ the JS lane reproduces the committed fixture exactly (regenerate with BLOCK_RUNS_PARITY_WRITE=1)', () => {
    const doc = buildDoc()
    if (process.env.BLOCK_RUNS_PARITY_WRITE === '1') {
      fs.writeFileSync(FIXTURE, `${JSON.stringify(doc)}\n`)
    }
    const committed = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    expect(committed).toEqual(JSON.parse(JSON.stringify(doc)))
  })

  it('⛔ the fixture is not vacuous: refused and drawn cases, arm, right-side and block wording all appear', () => {
    const doc = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    const by = Object.fromEntries(doc.cases.map((c) => [c.name, c]))
    expect(by['?: true arm (T03)'].expected).toMatch(/one arm of a `\?:`.* — on this chart that arm skips bar 1 and runs again on bar 2, so its calls have not run on every bar$/)
    expect(by['?: false arm (T02)'].expected).toMatch(/that arm skips bar 0 and runs again on bar 1/)
    expect(by['v6 and'].expected).toMatch(/on the right of a Pine v6 `and`.* — on this chart that right side skips bar 1/)
    expect(by['v6 or'].expected).toMatch(/on the right of a Pine v6 `or`.* — on this chart that right side skips bar 0/)
    expect(by['if block (C48)'].expected).toMatch(/inside a block that does not run on every bar.* — on this chart the block skips bar 1/)
    expect(by['input knob in the guard'].expected).toMatch(/one arm of a `\?:`/)
    // drawn: stamped, but the gate does not vary on these bars
    for (const name of ['?: test true on every bar', '?: test never true', 'smoothed MA seed arm']) {
      expect(by[name].definition.meta.blockRuns, name).toBeTruthy()
      expect(by[name].expected, name).toBeNull()
    }
    expect(doc.columns.filter((c) => c.expected).length).toBeGreaterThan(3)
    expect(doc.columns.filter((c) => !c.expected).length).toBeGreaterThan(3)
  })
})
