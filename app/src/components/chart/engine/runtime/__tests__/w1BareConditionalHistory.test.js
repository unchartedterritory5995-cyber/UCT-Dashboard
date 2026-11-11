// app/src/components/chart/engine/runtime/__tests__/w1BareConditionalHistory.test.js
//
// ─── W1 REVIEW (2026-11-02) — A v1–v4 BARE `barssince` / `cmo` / `cog` IN ONE ARM OF
//     `?:` IS HISTORY, EXACTLY AS ITS `ta.*` SPELLING IS (INTENDED, FAIL-CLOSED) ──────
//
// W1 taught the shared Resolver three v1–v4 bare spellings: the one-argument
// `barssince(cond)` (routed to `ta.barssince`), and `cmo(src, n)` / `cog(src, n)`
// (TradingView's published bodies). The runtime lane asks that Resolver whether a
// call's head keeps state (`pineRuntimeFrontend.js::callHeadStateful`, literal
// arguments). Before W1 it could not answer for these spellings, so the question
// fell back to "is it spelled `ta.*`?" and the bare spelling was NOT history:
//   · v4 `barssince(c)` in an arm of a `?:` that reads a slot was served on EVERY bar
//     (Pine runs it only on the bars that arm is reached, and keeps those bars'
//     history: vw-arm-history, WS-C), where `ta.barssince(c)` was already refused;
//   · v4 `cmo` / `cog` there met `pine:function` (the Resolver did not know them).
// Now each is history on the runtime pane, exactly as `ta.barssince` / `ta.cmo` /
// `ta.cog` are, and is refused by name, `runtime:conditional-history`. That is the
// change the W1 review found unannounced; it is fail-closed and INTENDED: the bare
// spelling meets exactly what the namespaced one meets. On every bar (no arm) both
// spellings are served, as they were.
// ⚠️ The pane build (`pane: true`) is the one that changed: off a pane the Resolver
// still refuses `ta.barssince`, so a bare one-argument `barssince` falls back to the
// spelling test there, exactly as before W1.
import { describe, it, expect } from 'vitest'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'

const NL = String.fromCharCode(10)
const R4 = 'runtime:conditional-history'
const v4 = (...lines) => ['//@version=4', 'study("t")', ...lines].join(NL)
const v6 = (...lines) => ['//@version=6', 'indicator("t")', ...lines].join(NL)
const guardOf = (src) => {
  const b = buildRuntimeIr(src, { bars: [], inputs: {}, pane: true })
  return b.ok ? null : b.refusal.guard
}
// a test that reads a slot (a `var` the script steps), so this lane lowers the `?:`
const STATE = ['var float s = 0.0', 's := s + 1']
// [v4 bare spelling, v6 namespaced spelling]
const CALLS = [
  ['barssince(close > open)', 'ta.barssince(close > open)'],
  ['cmo(close, 5)', 'ta.cmo(close, 5)'],
  ['cog(close, 5)', 'ta.cog(close, 5)'],
]

describe('W1 review 3 — v4 bare barssince / cmo / cog in one arm of `?:` are history, as their ta.* spellings', () => {
  it.each(CALLS)('%s in an arm is refused by name, exactly as %s is', (bare, ns) => {
    expect(guardOf(v4(...STATE, `y = s > 3 ? ${bare} : 0.0`, 'plot(y)'))).toBe(R4)
    expect(guardOf(v6(...STATE, `y = s > 3 ? ${ns} : 0.0`, 'plot(y)'))).toBe(R4)
  })

  it.each(CALLS)('CONTROL: %s on every bar is served, as %s is', (bare, ns) => {
    expect(guardOf(v4(`plot(${bare})`))).toBeNull()
    expect(guardOf(v6(`plot(${ns})`))).toBeNull()
  })
})
