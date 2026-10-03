// app/src/components/chart/engine/__tests__/vendorHarness/rt4WallsBehind.measure.test.js
//
// ─── RT4 — WHAT STANDS BEHIND EACH RUNTIME WALL, MEASURED BY SUBSTITUTION ──────
//
// RT2 measured five runtime-lane walls on the member-door census (flag on):
// `runtime:request` 3, `runtime:varip` 3, `pine:input-kind` 6, `pine:builtin` 8,
// `runtime:history-expression` 4. Before loosening any of them, RT4 asks the
// cheaper question: if the wall were gone, would the script attach? Each case
// below rewrites the construct in memory (never in the corpus) into the nearest
// spelling the lanes already hold, runs the REAL member door with the runtime
// pane on, and prints where the script stops next. A script that still stops is
// a wall whose removal draws nothing — so it is not removed on a guess.
//
// ⛔ OPT-IN (`RT4_WALLS=1`) and it ASSERTS NO COUNT: other lanes move these walls.
// The rewrite is a probe, not a semantics claim (`sum(v * w, p)` → `sum(v, p)`
// computes a different number; it only exposes the next refusal).
//
//   cd app && RT4_WALLS=1 node node_modules/vitest/vitest.mjs run \
//     src/components/chart/engine/__tests__/vendorHarness/rt4WallsBehind.measure.test.js

import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import * as registry from '../../nativeRegistry'
import { enterMemberDoor, HARNESS_DEF_ID } from './ourSide'

const RUN = process.env.RT4_WALLS === '1'
const CORPUS = path.join(path.resolve(process.cwd(), '..'), 'corpus', 'committed')

/** [wall, slug, [[pattern, replacement], ...]] — an empty list runs the script as written. */
const CASES = [
  ['runtime:varip', 'bolingger-bands-inside-bar-boxes', [[/\bvarip\b/g, 'var']]],
  ['runtime:varip', 'ema-92150-vwap-macd-rsi-pro-v6', [[/\bvarip\b/g, 'var']]],
  ['runtime:varip', 'inside-bar-boxes', [[/\bvarip\b/g, 'var']]],
  ['pine:input-kind', 'machine-learning-knn-based-strategy', [[/input\.time\s*\(/g, 'input.int(']]],
  ['pine:input-kind', 'open-interest-profile-fixed-range-by-leviathan', [[/input\.time\s*\(/g, 'input.int(']]],
  ['pine:input-kind', 'renderingnature-smc-reversal-engine-v71', [[/input\.timeframe\(/g, 'input.string(']]],
  ['pine:input-kind', 'smart-money-concepts-by-welotrades', [[/input\.timeframe\(/g, 'input.string(']]],
  ['pine:input-kind', 'smc-structures-and-multi-timeframe-fvg-ma-py', [[/input\.timeframe\(/g, 'input.string(']]],
  ['pine:input-kind', 'supply-demand-mtf-flux-charts', [[/input\.timeframe\(/g, 'input.string(']]],
  ['pine:builtin', 'elliot-wave-detector-pro', [[/syminfo\.type/g, '"stock"']]],
  ['pine:builtin', 'market-profile-with-tpo', [[/syminfo\.type/g, '"stock"']]],
  ['pine:builtin', 'higher-time-frame-fair-value-gap-zeroherotrading', [[/session\.isfirstbar/g, 'barstate.isfirst']]],
  ['pine:builtin', 'power-of-3-ict-01-tradingfinder-amd-ict-smc-accumulations', [[/str\.tonumber\(/g, 'math.abs(']]],
  ['pine:builtin', 'renko-candles-overlay', [[/str\.length\(/g, 'math.abs(']]],
  ['pine:builtin', 'scalping-strategy-with-williams-r-macd-and-sma-1-minute-only', [[/str\.tostring\(/g, 'math.abs(']]],
  ['pine:builtin', 'smart-money-volume-activity-algoalpha', [[/barstate\.isnew/g, 'true']]],
  ['pine:builtin', 'smarter-snr', [[/str\.length\(/g, 'math.abs(']]],
  ['pine:builtin', 'volume-open-interest-footprint-by-leviathan', [[/chart\.left_visible_bar_time/g, 'time']]],
  ['runtime:history-expression', 'machine-learning-logistic-regression-v3', [[/sum\(v \* w, p\)/g, 'sum(v, p)']]],
  ['runtime:history-expression', 'strong-start-rvol-dashboard', [[/ta\.sma\(volume\[1\], N\)/g, 'ta.sma(volume, N)']]],
  ['runtime:request', '4c-nyse-market-breadth-ratio', []],
  ['runtime:request', 'multi-timeframe-trend-indicator', []],
  ['runtime:request', 'tehthomas-aligned-timeframe-fair-value-gaps', [[/,\s*lookahead\s*=\s*barmerge\.lookahead_on/g, '']]],
]

afterEach(() => { vi.unstubAllEnvs(); registry.uninstallUserDefinition(HARNESS_DEF_ID) })

describe.skipIf(!RUN)('RT4 — the wall behind each runtime wall (opt-in)', () => {
  it('runs every case through the real member door and prints where it stops', () => {
    const files = fs.readdirSync(CORPUS)
    const rows = []
    for (const [wall, slug, subs] of CASES) {
      const file = files.find((f) => f.startsWith(`${slug}__`))
      expect(file, slug).toBeTruthy()
      let src = fs.readFileSync(path.join(CORPUS, file), 'utf8')
      for (const [re, to] of subs) {
        const before = src
        src = src.replace(re, to)
        expect(src, `${slug}: the rewrite ${re} matched nothing`).not.toBe(before) // non-vacuity
      }
      vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
      vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
      const door = enterMemberDoor(src)
      const declined = (door.built && door.built.runtimeDeclined) || null
      rows.push({ wall, slug, attached: !!door.def, next: declined ? declined.code : (door.def ? '-' : door.stage) })
      registry.uninstallUserDefinition(HARNESS_DEF_ID)
      vi.unstubAllEnvs()
    }
    // eslint-disable-next-line no-console
    console.log(`\nRT4 walls behind walls (${rows.filter((r) => r.attached).length}/${rows.length} attach)\n`
      + rows.map((r) => `  ${r.wall.padEnd(28)} ${r.slug.padEnd(62)} ${r.attached ? 'ATTACHES' : `stops at ${r.next}`}`).join('\n'))
    expect(rows.length).toBe(CASES.length)
  }, 600000)
})
