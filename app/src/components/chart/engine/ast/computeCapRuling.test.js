// app/src/components/chart/engine/ast/computeCapRuling.test.js
//
// ─── THE COMPUTE-CAP RULING OF 2026-11-17, RAILED: MEASURED, NONE RAISED ────────
//
// The 2026-11-17 coverage map (s8, blocker 6) found 9 scripts whose only blocker was a
// cap in `budget.js`. The ruling measured what raising each cap costs
// (`computeCapCost.measure.test.js`, `tools/pine_coverage/compute_cap_cost.py`; record:
// `docs/pine/evidence/2026-11-17-compute-caps/EVIDENCE.md`) and raised none:
//   · the scripts a raise frees cost 20.8 s to 561 s per compute on this (host) lane on
//     5,000 daily bars, where the runtime lane computes the ones it already serves in
//     7 to 110 ms; and the member door asks the HOST lane first, so a raise MOVES a
//     script the runtime lane serves today onto the slow lane;
//   · above 2,400 bars a lookback-capped recurrence no longer computes over the 5,000 bars
//     the server reads (`MAX_RECURRENCE_STEPS`).
// Each rail below holds one measured fact of that ruling and goes red when a cap moves
// past it, so the next raise starts from the measurement instead of rediscovering it.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { DEFAULT_BUDGET, CAP_GUARD } from './budget'
import { interpret, MAX_RECURRENCE_STEPS, TableRefusal } from './interpret'
import { parseFormula } from './parse'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'
import { __permitRuntimePaneForTests, __resetRuntimePanePermission } from '../runtimePaneGate'
import { __allowEveryRuntimeScriptForTests, __resetRuntimeAllowList } from '../runtimeKill'

const REPO = path.resolve(process.cwd(), '..')
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
const committed = (slug) => read(`corpus/committed/${slug}.pine`)

/** The bars both server lanes read, from its ONE authority (`bars_window.py`), never retyped. */
function serverWindowBars() {
  const m = /^HISTORY_WINDOW_BARS\s*=\s*(\d+)\s*$/m.exec(read('api/services/bars_window.py'))
  expect(m, 'api/services/bars_window.py no longer declares HISTORY_WINDOW_BARS in the shape this reads').toBeTruthy()
  return Number(m[1])
}

const bars = (n) => Array.from({ length: n }, (_, i) => {
  const c = 100 + 10 * Math.sin(i / 17) + (i % 7)
  return { t: 1262304000 + i * 86400, o: c - 1, h: c + 2, l: c - 2, c, v: 1000 + (i % 13) }
})

const guardOf = (fn) => {
  try { fn(); return 'NO-REFUSAL' } catch (e) { return e instanceof TableRefusal ? e.guard : `NOT-A-REFUSAL:${e && e.name}` }
}

afterEach(() => {
  vi.unstubAllEnvs()
  __resetRuntimePanePermission()
  __resetRuntimeAllowList()
})

describe('the lookback cap keeps a cap-deep recurrence computable over the server window', () => {
  it('maxLookback x the server window fits under the one recurrence ceiling both lanes share', () => {
    // ⭐ MEASURED: `accum(close, max(self, close), w)` over 5,000 bars computes at w = 960
    // and 2,400 and refuses `interpret:steps` at 2,500 and 2,560, in both lanes. A cap above
    // MAX_RECURRENCE_STEPS / 5,000 = 2,400 admits at the save door a formula the server's
    // own window then refuses at compute: told it worked, and then it does not.
    const window = serverWindowBars()
    expect(window).toBeGreaterThan(0)
    expect(DEFAULT_BUDGET.maxLookback * window,
      `maxLookback ${DEFAULT_BUDGET.maxLookback} x ${window} server bars passes MAX_RECURRENCE_STEPS ${MAX_RECURRENCE_STEPS}`)
      .toBeLessThanOrEqual(MAX_RECURRENCE_STEPS)
  })

  it('…and it is BEHAVIOUR, not arithmetic: a recurrence at the cap computes over the window; past the ceiling it refuses', () => {
    const cap = DEFAULT_BUDGET.maxLookback
    const tree = parseFormula(`accum(close, max(self, close), ${cap})`).ast
    const window = serverWindowBars()
    const col = interpret(tree, bars(window), {}, null, undefined, { tf: 'D' })
    expect(col.length).toBe(window)
    expect(Number.isFinite(col[window - 1]), 'the cap-deep recurrence drew nothing on its last bar').toBe(true)
    // ⛔ THE CONTROL: the same tree on just enough bars to pass the ceiling refuses by name,
    // so the rail above is about the ceiling and not about a walker that never refuses.
    const over = Math.floor(MAX_RECURRENCE_STEPS / cap) + 1
    expect(guardOf(() => interpret(tree, bars(over), {}, null, undefined, { tf: 'D' }))).toBe('interpret:steps')
  })
})

describe('a script just over each cap is refused BY NAME at the member door (production: runtime pane dark)', () => {
  const door = (source) => {
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    return memberPaneDefinition({ source, id: 'u_compute-cap-ruling', name: 'compute cap ruling' })
  }

  it('lookback: volume-spikes needs 1,000 bars (four nested 250-bar `var` warm-ups); measured 32.1 s per compute on this lane', () => {
    const built = door(committed('volume-spikes-growing-volume-signals-with-alerts-scanner__8e706f448f'))
    expect(built.ok).toBe(false)
    expect(built.guard).toBe(CAP_GUARD.maxLookback)
    expect(built.reason).toContain(`needs 1000 bars of history behind every bar, and one plot may reach back at most ${DEFAULT_BUDGET.maxLookback} here`)
  })

  it('series: mtf-key-levels reads 10 distinct series', () => {
    const built = door(committed('mtf-key-levels-support-and-resistance__29f470a089'))
    expect(built.ok).toBe(false)
    expect(built.guard).toBe(CAP_GUARD.maxSeriesRefs)
    expect(built.reason).toContain(`reads 10 different data series, and one plot may read at most ${DEFAULT_BUDGET.maxSeriesRefs} here`)
  })

  it('nodes: a first-party probe one plot over the node cap', () => {
    // `close[1] + close[2] + …`: every term a distinct offset, so the tree grows by two
    // evaluation units a term and nothing can be shared. Sized FROM the cap, never typed.
    const terms = Math.ceil(DEFAULT_BUDGET.maxNodes / 2) + 2
    const sum = Array.from({ length: terms }, (_, i) => `close[${i + 1}]`).join(' + ')
    const built = door(`//@version=5\nindicator("cap probe")\nplot(${sum}, "wide")\n`)
    expect(built.ok).toBe(false)
    expect(built.guard).toBe(CAP_GUARD.maxNodes)
    expect(built.reason).toMatch(new RegExp(`is a formula of \\d+ steps, and one plot may hold at most ${DEFAULT_BUDGET.maxNodes} here`))
  })
})

describe('the cap routes what it refuses to the lane that computes it (production: runtime pane armed)', () => {
  it('vwap-fibo reads 10 distinct series: refused on the host lane BY NAME and built by the runtime lane', () => {
    // ⭐ MEASURED: its host document costs 1,982 ms per compute on 5,000 daily bars; the
    // runtime lane computes it in 18.5 ms. The door asks the host lane first, so a series
    // cap of 10 or more would move it onto the slower lane. The same holds for the reference
    // scripts the runtime lane serves today (multi-timeframe-vwap-v5: 5,550 ms vs 101 ms;
    // tradingviews-technical-analysis: 1,339 ms vs 110 ms; range-filter-buy-and-sell-5min:
    // 20.8 s vs 6.7 ms; check-head-and-shoulders: 561 s vs 16 ms).
    vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
    const source = committed('vwap-fibo-dev-extensions-strategy__mR2vfyGjUv')
    const built = memberPaneDefinition({ source, id: 'u_compute-cap-ruling', name: 'compute cap ruling' })
    expect(built.ok).toBe(true)
    expect(built.lane).toBe('runtime')
    // ⛔ THE CONTROL: with the runtime pane dark the same script is the host lane's
    // budget refusal, so the lane above is the cap's doing and not the script's.
    vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '')
    __resetRuntimePanePermission()
    const host = memberPaneDefinition({ source, id: 'u_compute-cap-ruling', name: 'compute cap ruling' })
    expect(host.ok).toBe(false)
    expect(host.guard).toBe(CAP_GUARD.maxSeriesRefs)
  })
})
