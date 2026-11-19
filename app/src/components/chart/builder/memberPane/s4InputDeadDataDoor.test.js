// app/src/components/chart/builder/memberPane/s4InputDeadDataDoor.test.js
//
// ─── PINE DATA UNIT S4-1, ON THE PRODUCT PATH: THE MEMBER DOOR, THEN THE RUN WITH THE MEMBER'S INPUTS ──
//
// `engine/runtime/__tests__/s4InputDeadDataArms.test.js` holds the rule at the front end. This holds it
// where a member meets it: the door (`memberPaneDefinition`, MemberPane.jsx's own call) builds the
// VWAP-shaped script on the runtime lane at its default, the run draws the arm the default takes, and a
// member who moves the anchor to an arm that reads data gets that read's refusal by name from the run
// (`runtimeColumnsFor`, the binder's call, keyed by the member's values). The source is written here (the
// VWAP's shape, never TradingView's text).
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { memberPaneDefinition } from './memberPaneDefinition'
import { __permitRuntimePaneForTests } from '../../engine/runtimePaneGate'
import { __allowEveryRuntimeScriptForTests } from '../../engine/runtimeKill'
import { runtimeColumnsFor } from '../../engine/runtime/runtimeColumns.js'

const flagOf = (rel) => (fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8')
  .match(/source\.(VITE_[A-Z0-9_]+)\s*===\s*'1'/) || [])[1]
vi.stubEnv(flagOf('src/components/chart/engine/objectsOnlyPaneGate.js'), '1')
vi.stubEnv(flagOf('src/components/chart/engine/runtimePaneGate.js'), '1')

const SOURCE = [
  '//@version=6',
  'indicator("s4-1 door probe", overlay = true)',
  'var anchor = input.string(defval = "Session", title = "Anchor", options = ["Earnings", "Dividends", "Splits", "Session"])',
  'isNew = switch anchor',
  '    "Earnings" =>',
  '        e = request.earnings(syminfo.tickerid, earnings.actual, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol = true)',
  '        not na(e)',
  '    "Dividends" =>',
  '        d = request.dividends(syminfo.tickerid, dividends.gross, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol = true)',
  '        not na(d)',
  '    "Splits" =>',
  '        s = request.splits(syminfo.tickerid, splits.denominator, barmerge.gaps_on, barmerge.lookahead_on, ignore_invalid_symbol = true)',
  '        not na(s)',
  '    "Session" => close > open',
  '    => false',
  'var float count = 0',
  'count := isNew ? count + 1 : count',
  'plot(count, "Count")',
].join('\n')

const BARS = Array.from({ length: 40 }, (_, i) => (
  { t: 1700000000 + i * 86400, o: 100, h: 102, l: 98, c: i % 2 ? 101 : 99, v: 1000 + i }))

describe('S4-1 on the product path (member door, then the run with the member\'s inputs)', () => {
  beforeAll(() => {
    __permitRuntimePaneForTests()
    __allowEveryRuntimeScriptForTests()
  })

  it('⭐ the door builds the script on the runtime lane, and the run draws the default arm', () => {
    const d = memberPaneDefinition({ source: SOURCE, id: 'u_s4door', name: 's4' })
    expect(d.ok, `door refused: ${d.guard} ${d.reason}`).toBe(true)
    expect(d.lane).toBe('runtime')
    const cols = runtimeColumnsFor(d.definition, BARS, {}, { tf: 'D', historyFromListing: true })
    const values = Object.values(cols).find((c) => c && typeof c.length === 'number' && c.length === BARS.length)
    // the Session arm (close > open) is true on the odd bars: the count is the number of odd bars so far
    expect(values[BARS.length - 1]).toBe(BARS.length / 2)
  })

  it('⛔ the member moves the anchor to Earnings: the run refuses by name, never a count', () => {
    const d = memberPaneDefinition({ source: SOURCE, id: 'u_s4door2', name: 's4' })
    expect(d.ok).toBe(true)
    const keys = (d.definition.inputs || []).map((s) => s && s.key)
    expect(keys).toContain('anchor')
    expect(() => runtimeColumnsFor(d.definition, BARS, { anchor: 'Earnings' }, { tf: 'D', historyFromListing: true }))
      .toThrow(/request\.earnings/)
  })
})
