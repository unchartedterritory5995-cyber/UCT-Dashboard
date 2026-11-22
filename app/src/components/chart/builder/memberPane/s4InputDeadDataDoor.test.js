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
import { EVENTS_KEY } from '../../engine/pineEvents.js'

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

  // ⭐⭐ T4 E2 (NUMBER PENDING) — the Earnings arm reads the chart's own events through the events door
  // (`eventSupply.js`, under `pineEvents.EVENTS_KEY`): never a count drawn without them, refused by name where the door is
  // dark, and the count stepping on each report's bar where they are served. ⚰️ Before E2 the run refused the read.
  it('⛔ the member moves the anchor to Earnings: never a count without the events, refused by name where the door is dark', () => {
    const d = memberPaneDefinition({ source: SOURCE, id: 'u_s4door2', name: 's4' })
    expect(d.ok).toBe(true)
    const keys = (d.definition.inputs || []).map((s) => s && s.key)
    expect(keys).toContain('anchor')
    const ctx = { tf: 'D', historyFromListing: true, symbol: { ticker: 'AAPL', exchange: 'NASDAQ' } }
    // the events not landed yet: the run WAITS (a pending stop, in the events' own words), and no count is drawn
    let wait = null
    try { runtimeColumnsFor(d.definition, BARS, { anchor: 'Earnings' }, ctx) } catch (e) { wait = e }
    expect(wait && wait.pending).toBe(true)
    expect(String(wait.message)).toMatch(/UCT is gathering AAPL's earnings/)
    // the door dark for this member: refused by name, never a count
    expect(() => runtimeColumnsFor(d.definition, BARS, { anchor: 'Earnings' },
      { ...ctx, secondary: new Map([[EVENTS_KEY, { status: 'dark', symbol: 'AAPL' }]]) })).toThrow(/earnings data is not available on this chart yet/)
  })

  it('⭐ (T4 E2) the events served: the count steps once on each report bar, as TradingView draws the anchor', () => {
    const d = memberPaneDefinition({ source: SOURCE, id: 'u_s4door3', name: 's4' })
    const daily = BARS.map((b) => ({ ...b, t: new Date(b.t * 1000).toISOString().slice(0, 10) }))
    const doc = { symbol: 'AAPL', families: { earnings: { state: 'ok', knownFrom: daily[0].t, rows: [
      { date: daily[5].t, actual: 1.1 }, { date: daily[20].t, actual: 1.3 }] } } }
    const cols = runtimeColumnsFor(d.definition, daily, { anchor: 'Earnings' }, { tf: 'D', historyFromListing: true,
      symbol: { ticker: 'AAPL', exchange: 'NASDAQ' }, secondary: new Map([[EVENTS_KEY, { status: 'available', events: doc, symbol: 'AAPL', rev: '1' }]]) })
    const values = Object.values(cols).find((c) => c && typeof c.length === 'number' && c.length === BARS.length)
    expect([values[4], values[5], values[19], values[20], values[BARS.length - 1]]).toEqual([0, 1, 1, 2, 2])
  })
})
