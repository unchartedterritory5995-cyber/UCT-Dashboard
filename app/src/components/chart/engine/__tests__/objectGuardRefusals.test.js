// app/src/components/chart/engine/__tests__/objectGuardRefusals.test.js
//
// ─── C17 — A `guard:<kind>` DROP NAMES WHAT ITS CONDITION STOPPED ON ──────────
//
// `artemis-oscillator-pro` (NYSE:RDDT 1D, 2026-09-28 capture) drops four label
// creates as `guard:create` — TradingView holds three of them (`✦ OB` ×3) and
// one `R▼`. The drop key says only that the condition cannot be read. Traced
// (C17): all four conditions stop on ONE construct, a running count
//
//     var int meObCount = 0
//     meObCount := meObWeak ? meObCount + 1 : 0
//
// whose `self + 1` arm never forgets its seed (`forgetsItsSeed`), so the
// bounded accumulator would count over the last 250 bars, not since the reset
// (`pine:state`). Not served — the converter's state grammar is the C12 lane's
// (owner-gated); the refusal is now NAMED in `objectDiagnostics.guardRefusals`.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { translatePine } from '../ast/pine'

const HEAD = '//@version=5\nindicator("g", overlay=true)\n'

describe('C17 — `guardRefusals` names the refusal and the name a dropped guard stopped on', () => {
  it('⭐ a running count in a create\'s guard: `pine:state` on the counter', () => {
    const t = translatePine(`${HEAD}var int c = 0
c := close < open ? c + 1 : 0
if c == 3
    label.new(bar_index, high, "X")
plot(close)
`)
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBe(1)
    expect(t.objectDiagnostics.guardRefusals).toEqual(['create@6: pine:state `c`'])
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

  it('⭐ artemis-oscillator-pro: the four dropped creates are the two exhaustion counters', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), '..',
      'corpus/committed/artemis-oscillator-pro__ea1097ca9e.pine'), 'utf8')
    const t = translatePine(src)
    expect(t.objectDiagnostics.dropReasons['guard:create']).toBe(4)
    expect(t.objectDiagnostics.guardRefusals).toEqual([
      'create@417: pine:state `meOsCount`', // R▲ ← meRevBull ← meOsSignal
      'create@420: pine:state `meObCount`', // R▼ ← meRevBear ← meObSignal
      'create@658: pine:state `meObCount`', // ✦ OB
      'create@661: pine:state `meOsCount`', // ✦ OS
    ])
  })
})
