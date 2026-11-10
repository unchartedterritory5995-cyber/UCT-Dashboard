// app/src/components/chart/engine/runtime/__tests__/runtimeLimitSentence.test.js
//
// ─── ⛔ A LIMIT STOP SPEAKS PLAIN WORDS, AND NAMES THE CEILING THAT FIRED ──────────
//
// 1. A VM limit's refusal never shows an engine token (`CALL_COUNT`) to a member: the
//    sentence names the limit in plain words, keeps the numbers, and the NAME rides
//    the refusal as `err.limit` for telemetry (`runtimeAsync.runtimeStopBeaconOf`).
// 2. A `WALL_TIME` stop is reported as the ceiling that actually fired: the PANE's
//    budget (`opts.budgetMs`) as `runtime:time-budget`, the VM's own `limits.WALL_TIME`
//    as a `runtime:limit` naming ITS ceiling — never one dressed as the other (seen
//    11/09: a 600,000 ms caller was told "more than 600000 ms" after 5,000 ms).
import { describe, it, expect, vi, afterEach } from 'vitest'

import { computeRuntimeColumns, runtimeLimitSentence, RUNTIME_LIMIT_GUARD, RUNTIME_TIME_BUDGET_GUARD } from '../runtimeColumns'
import { LIMIT_NAMES, LIMIT_PLAIN, RuntimeLimitError } from '../limits'

const LF = String.fromCharCode(10)
const TOKEN = /\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/
const CALLS = ['//@version=5', 'indicator("t")', 'f(x) => x + 1', 'float s = 0.0',
  'for i = 0 to 9', '    s := f(s)', 'plot(s)', ''].join(LF)
const PLAIN = ['//@version=5', 'indicator("t")', 'plot(close)', ''].join(LF)
const def = (source) => ({ id: 'u_lim', version: 1, compute: { kind: 'runtime', fn: 'lim:u', source, outputs: { value: 0 } },
  meta: { name: 'lim' }, plots: [{ key: 'value' }] })
const bars = (n) => Array.from({ length: n }, (_, i) => ({ t: 1e9 + i * 86400, o: 1, h: 2, l: 0.5, c: 1 + (i % 7), v: 10 }))
const ctx = { tf: 'D', newestBarIsForming: false }
function stopOf(source, opts, n = 40) {
  // every run from bar 0: a resumed session would skip the bars a stop is counted on
  try { computeRuntimeColumns(def(source), bars(n), ctx, { incremental: false, ...opts }) } catch (e) { return e }
  return null
}
const ticking = (step) => { let t = 0; return () => { t += step; return t } }

describe('1 — every limit has a plain phrase, and the sentence carries no token', () => {
  it('LIMIT_PLAIN covers LIMIT_NAMES exactly, token-free', () => {
    expect(Object.keys(LIMIT_PLAIN).sort()).toEqual([...LIMIT_NAMES].sort())
    for (const k of LIMIT_NAMES) expect(LIMIT_PLAIN[k]).not.toMatch(TOKEN)
  })

  it('every limit, through the sentence builder, reads with no token', () => {
    for (const k of LIMIT_NAMES) {
      const s = runtimeLimitSentence(new RuntimeLimitError(k, 5000000, 5000001), 4163, 8502)
      expect(s).not.toMatch(TOKEN)
      expect(s).toContain(LIMIT_PLAIN[k])
      expect(s).toContain('on bar 4,163 of 8,502')
    }
  })

  it('a real CALL_COUNT stop: plain words, the numbers, the name only as a field', () => {
    const e = stopOf(CALLS, { limits: { CALL_COUNT: 50 } })
    expect(e && e.guard).toBe(RUNTIME_LIMIT_GUARD)
    expect(e.limit).toBe('CALL_COUNT')
    expect(e.message).not.toMatch(TOKEN)
    expect(e.message).toContain('the number of function calls a script may make over the whole chart')
    expect(e.message).toMatch(/at most 50, it reached 51\) on bar 6 of 40/)
  })

  it('control: under the same ceiling raised, it draws', () => {
    expect(stopOf(CALLS, { limits: { CALL_COUNT: 1000 } })).toBeNull()
  })
})

describe('2 — a WALL_TIME stop names the ceiling that fired', () => {
  it('the pane budget fires first: runtime:time-budget naming budgetMs', () => {
    const e = stopOf(PLAIN, { budgetMs: 7, now: ticking(10) })
    expect(e && e.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(e.message).toMatch(/took more than 7 ms/)
  })

  it('the VM WALL_TIME fires first: STILL runtime:time-budget (never cached), naming ITS ceiling', () => {
    const e = stopOf(PLAIN, { budgetMs: 600000, now: ticking(10), limits: { WALL_TIME: 25 } })
    expect(e && e.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(e.limit).toBe('WALL_TIME')
    expect(e.message).toMatch(/took more than 25 ms/)
    expect(e.message).toContain('the most time one run of a script may take')
    expect(e.message).not.toMatch(/600,?000/)
  })

  it('the shipped VM ceiling is the one named: 5,000 ms', () => {
    const e = stopOf(PLAIN, { budgetMs: 600000, now: ticking(1000) })
    expect(e && e.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(e.message).toMatch(/took more than 5000 ms/)
  })
})

describe('4 — every stop names the 1-based bar it stopped on, the same way', () => {
  // a sentence naming bar k is right when a chart of k-1 bars draws and one of k stops
  const named = (e) => Number(/bar (\d[\d,]*) of/.exec(e.message)[1].replace(/,/g, ''))
  it('a limit stop: 5 bars of 10 calls fit a 50-call ceiling, the 6th bar stops and is named bar 6', () => {
    const lim = { limits: { CALL_COUNT: 50 } }
    expect(stopOf(CALLS, lim, 5)).toBeNull()
    expect(named(stopOf(CALLS, lim, 6))).toBe(6)
  })
  // a clock that advances ONLY when the pane's own bar-end check reads it (10 ms a bar),
  // so its stop bar is known exactly: past 55 ms at the end of the 6th bar
  const paneClock = () => { let t = 0; return () => (/onBar/.test(new Error().stack) ? (t += 10) : t) }
  it('the pane budget: 5 bars fit, the 6th bar stops and is named bar 6', () => {
    const opts = () => ({ budgetMs: 55, now: paneClock() })
    expect(stopOf(PLAIN, opts(), 5)).toBeNull()
    const e = stopOf(PLAIN, opts(), 6)
    expect(e && e.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(named(e)).toBe(6)
  })
  it('the same stop bar reads the same in both sentences', () => {
    const limit = stopOf(CALLS, { limits: { CALL_COUNT: 50 } })
    const pane = stopOf(PLAIN, { budgetMs: 55, now: paneClock() })
    expect(limit.guard).toBe(RUNTIME_LIMIT_GUARD)
    expect(pane.guard).toBe(RUNTIME_TIME_BUDGET_GUARD)
    expect(named(limit)).toBe(named(pane))
  })
})

describe('3 — the worker carries the limit NAME as a field (the beacon reads it there)', () => {
  afterEach(() => { vi.unstubAllGlobals() })
  it('a CALL_COUNT stop posted by the worker keeps limit, and a plain sentence', async () => {
    const posted = []
    const SELF = { postMessage: (m) => posted.push(m) }
    vi.stubGlobal('self', SELF)
    await import('../runtimeWorker.js')
    // the worker runs with DEFAULT limits; a call-heavy body passes INSTRUCTIONS_PER_BAR
    const heavy = ['//@version=5', 'indicator("t")', 'f(x) => x + 1', 'float s = 0.0',
      'for i = 0 to 100000', '    s := f(s)', 'plot(s)', ''].join(LF)
    SELF.onmessage({ data: { id: 1, def: def(heavy), rows: bars(3), ctx: { tf: 'D' } } })
    const msg = structuredClone(posted[0])
    expect(msg.ok).toBe(false)
    expect(msg.error.guard).toBe(RUNTIME_LIMIT_GUARD)
    expect(msg.error.limit).toBe('INSTRUCTIONS_PER_BAR')
    expect(msg.error.message).not.toMatch(TOKEN)
  })
})
