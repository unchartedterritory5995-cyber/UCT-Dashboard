// app/src/components/chart/engine/__tests__/objectGuardRefusals.test.js
//
// ─── C17 — A `guard:<kind>` DROP NAMES WHAT ITS CONDITION STOPPED ON ──────────
//
// `artemis-oscillator-pro` (NYSE:RDDT 1D, 2026-09-28 capture) dropped four label
// creates as `guard:create` — TradingView holds three of them (`✦ OB` ×3) and
// one `R▼`. The drop key says only that the condition cannot be read. Traced
// (C17): all four conditions stop on ONE construct, a running count
//
//     var int meObCount = 0
//     meObCount := meObWeak ? meObCount + 1 : 0
//
// whose `self + 1` arm never forgets its seed (`forgetsItsSeed`), so the
// bounded accumulator would count over the last 250 bars, not since the reset
// (`pine:state`). C17 NAMED it in `objectDiagnostics.guardRefusals`; C12s
// (2026-09-30) SERVES it: a counter with a reset arm is a SWITCHED recurrence
// (`interpret.js::switchedVarSeed`), exact per bar wherever the data shows the
// reset, so the four creates convert and their guards are read at run time. The
// naming rail stays, pointed at a counter that never resets.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../ast/pine'

const HEAD = '//@version=5\nindicator("g", overlay=true)\n'

describe('C17 — `guardRefusals` names the refusal and the name a dropped guard stopped on', () => {
  // ⚰️ C29 SERVES a bar counter (measured, `vw-bar-counters-rddt-1d-2026-09-30`):
  // switched, exact from the listing, withheld elsewhere — so the guard converts.
  // The naming rail moves to a count that never resets AND is no bar counter.
  it('⭐ a running SUM that never resets, in a create\'s guard: `pine:state` on it', () => {
    const t = translatePine(`${HEAD}var float c = 0.0
c := c + volume
if c == 3
    label.new(bar_index, high, "X")
plot(close)
`)
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBe(1)
    expect(t.objectDiagnostics.guardRefusals).toEqual(['create@6: pine:state `c`'])
  })

  it('⭐ C29 — a bar counter in a create\'s guard converts (listing-only)', () => {
    const src = `${HEAD}var int c = 0
c := c + 1
if c == 3
    label.new(bar_index, high, "X")
plot(close)
`
    // the chart (host) lane serves it; the SCREEN lane has no listing, so it refuses there
    expect(translatePine(src, { strict: true }).objectDiagnostics.guardRefusals || []).toEqual([])
    expect(translatePine(src).objectDiagnostics.guardRefusals).toEqual(['create@6: pine:state `c`'])
  })

  it('⛔ CONTROL — a counter that the accumulator CAN hold is not a refusal, and names nothing', () => {
    const t = translatePine(`${HEAD}var int c = 0
c := close < open ? 1 : 0
if c == 1
    label.new(bar_index, high, "X")
plot(close)
`)
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBeUndefined()
    expect(t.objectDiagnostics.guardRefusals).toBeUndefined()
  })

  it('⭐ C12s — a counter WITH a reset in a create\'s guard converts (switched), and names nothing', () => {
    const t = translatePine(`${HEAD}var int c = 0
c := close < open ? c + 1 : 0
if c == 3
    label.new(bar_index, high, "X")
plot(close)
`)
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBeUndefined()
    expect(t.objectDiagnostics.guardRefusals).toBeUndefined()
  })

  it('⭐ C12s — artemis-oscillator-pro: the four creates C17 named now convert', () => {
    // was `guard:create` ×4 — R▲ (417) / R▼ (420) / ✦ OB (658) / ✦ OS (661), each
    // `pine:state` on `meObCount` / `meOsCount`
    const src = fs.readFileSync(path.resolve(process.cwd(), '..',
      'corpus/committed/artemis-oscillator-pro__ea1097ca9e.pine'), 'utf8')
    const t = translatePine(src)
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBeUndefined()
    expect(t.objectDiagnostics.guardRefusals).toBeUndefined()
  })
})
