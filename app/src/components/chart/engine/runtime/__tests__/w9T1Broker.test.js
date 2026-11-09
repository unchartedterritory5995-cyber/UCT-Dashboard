// W9-T1 rails: pinning, the window, rule 11, the forming bar, the record, the opcode, the vocabulary.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

import { buildRuntimeIr } from '../../ast/pineRuntimeFrontend.js'
import { lowerIrProgram } from '../lowerIr.js'
import { execute } from '../vm.js'
import { OP, IMPLEMENTED } from '../program.js'
import { BROKER_RULE_IDS, BROKER_RULES, PRESENTATION_RULE_IDS, PRESENTATION_RULES, isLedgerRuleId } from '../brokerRules.js'
import RESOLVED from '../brokerPins.resolved.json'

const SYMBOL = { ticker: 'RDDT', exchange: 'NYSE' }
const barsOf = (rows) => rows.map(([o, h, l, c], i) => ({ t: 1700000000 + i * 86400, o, h, l, c, v: 1000 }))
const QUIET = barsOf(Array.from({ length: 30 }, (_, i) => [100 + i, 101.5 + i, 99 + i, 100.5 + i]))
const V5 = '//@version=5\nstrategy("t")\n'
const ALL = () => true

const attempt = (src, { bars = QUIET, pins, window = 5000, confirmed = true, listing = true } = {}) => {
  const built = buildRuntimeIr(src, { bars, inputs: {}, symbol: SYMBOL, strategyBroker: true })
  if (!built.ok) return { refused: built.refusal }
  const program = lowerIrProgram(built.ir, { historyFromListing: listing })
  const series = ['o', 'h', 'l', 'c', 'v'].map((k) => Float64Array.from(bars.map((b) => b[k])))
  const ctx = { bars: bars.length, series, columns: program.columns, confirmed, barTimes: bars.map((b) => b.t) }
  if (window !== null) ctx.historyWindowBars = window
  try {
    const res = execute(program, ctx, undefined, pins === undefined ? undefined : { brokerPinned: pins })
    return { res }
  } catch (e) { return { err: e } }
}
const SCRIPT = `${V5}if bar_index == 3\n    strategy.entry("L", strategy.long)\nif bar_index == 10\n    strategy.close("L")\n`
  + 'plot(strategy.position_size)\nplot(strategy.netprofit)\n'

describe('W9-T1 pinned(): the committed ledger is empty, so nothing serves', () => {
  it('the production ledger pins no rule', () => {
    expect(Object.keys(RESOLVED.rules)).toEqual([])
  })
  it('with the real ledger a run stops at the first rule it reaches, by name', () => {
    const { err } = attempt(SCRIPT) // no brokerPinned: the committed ledger
    expect(err).toBeDefined()
    expect(err.guard).toBe('runtime:strategy-unpinned')
    expect(err.rule).toBe('B-VAL') // the plot reads a value on bar 0, before any order is placed
    expect(err.message).toMatch(/B-VAL/)
    expect(err.message).toMatch(/Q-S1-core/)
  })
  it('every rule the run used, taken out of the pin set one at a time, stops the run naming THAT rule', () => {
    const full = attempt(SCRIPT, { pins: ALL })
    expect(full.err).toBeUndefined()
    const used = full.res.broker.record.rulesUsed
    expect(used.length).toBeGreaterThanOrEqual(6)
    for (const rule of used) {
      const { err } = attempt(SCRIPT, { pins: (id) => id !== rule })
      expect(err && err.guard, rule).toBe('runtime:strategy-unpinned')
      expect(err.rule).toBe(rule)
    }
  })
  it('the price-order and reversal rules are pin-gated too', () => {
    const src = '//@version=5\nstrategy("t", pyramiding = 2)\nif bar_index == 2\n    strategy.entry("L", strategy.long, qty = 2)\n'
      + '    strategy.exit("x", "L", limit = 140, stop = 90)\nif bar_index == 6\n    strategy.entry("S", strategy.short, qty = 3)\n'
      + 'if bar_index == 7\n    strategy.entry("S", strategy.short, qty = 3)\nplot(strategy.position_size)\n'
    const full = attempt(src, { pins: ALL })
    expect(full.err).toBeUndefined()
    for (const rule of full.res.broker.record.rulesUsed) {
      const { err } = attempt(src, { pins: (id) => id !== rule })
      expect(err && err.rule, rule).toBe(rule)
    }
    expect(full.res.broker.record.rulesUsed).toEqual(expect.arrayContaining(['B-REVERSE', 'B-PYR', 'B-EXIT-BIND']))
  })
  it('a rule with no queued capture is refused saying so', () => {
    const { err } = attempt(`${V5}if bar_index == 3\n    strategy.cancel_all()\nplot(strategy.opentrades)\n`, { pins: (id) => id !== 'B-CANCEL' })
    expect(err.rule).toBe('B-CANCEL')
    // W9-T5 r1: B-CANCEL's row is W9-X5 (queued on origin/fix/pine-capture-queue-hygiene d1a6cb9fb3)
    expect(err.message).toMatch(/capture row W9-X5/)
  })
  it('the rule tables are the only vocabulary: the ledger can name nothing outside them', () => {
    // W9-T12: an emulator rule (BROKER_RULE_IDS) or a presentation rule (PRESENTATION_RULE_IDS)
    for (const r of Object.keys(RESOLVED.rules)) expect(isLedgerRuleId(r), r).toBe(true)
    // CONTROL: the check can fail -- an unknown id, a prototype key and a non-string are refused
    expect(isLedgerRuleId('NO-SUCH-RULE')).toBe(false)
    expect(isLedgerRuleId('toString')).toBe(false)
    expect(isLedgerRuleId(undefined)).toBe(false)
    expect(isLedgerRuleId('B-PATH')).toBe(true)
    expect(isLedgerRuleId('MK-LOOK')).toBe(true)
    expect(PRESENTATION_RULE_IDS).toEqual(['MK-LOOK'])
    expect(PRESENTATION_RULES['MK-LOOK'].capture).toBe('W9-MK1')
    // a presentation rule is never an emulator rule
    for (const id of PRESENTATION_RULE_IDS) expect(BROKER_RULE_IDS).not.toContain(id)
    for (const id of BROKER_RULE_IDS) expect(BROKER_RULES[id].what.length).toBeGreaterThan(5)
  })
  it('RAIL: the test-only pin predicate is named in vm.js only (broker.js takes it as data.isPinned)', () => {
    const root = path.resolve(__dirname, '../../..')
    const hits = []
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name)
        if (e.isDirectory()) { if (e.name !== '__tests__' && e.name !== 'node_modules') walk(f); continue }
        if (!/\.jsx?$/.test(e.name) || /\.test\./.test(e.name)) continue
        if (/\bbrokerPinned\b/.test(fs.readFileSync(f, 'utf8'))) hits.push(e.name)
      }
    }
    walk(root)
    expect(hits.sort()).toEqual(['vm.js'])
  })
})

describe('W9-T1 the history window and the forming bar', () => {
  it('a run told no window, or holding more bars than it, is refused runtime:strategy-start', () => {
    expect(attempt(SCRIPT, { pins: ALL, window: null }).err.guard).toBe('runtime:strategy-start')
    const e = attempt(SCRIPT, { pins: ALL, window: 10 }).err
    expect(e.guard).toBe('runtime:strategy-start')
    expect(e.message).toMatch(/most recent 10 bars/)
    expect(attempt(SCRIPT, { pins: ALL, window: 30 }).err).toBeUndefined()
  })
  it('the forming bar is not executed (outputs na) and B-EXEC is pin-gated', () => {
    const { res } = attempt(SCRIPT, { pins: ALL, confirmed: false })
    expect(Number.isNaN(res.outputs[0][29])).toBe(true)
    expect(Number.isNaN(res.outputs[0][28])).toBe(false)
    expect(attempt(SCRIPT, { pins: (id) => id !== 'B-EXEC', confirmed: false }).err.rule).toBe('B-EXEC')
    expect(attempt(SCRIPT, { pins: (id) => id !== 'B-EXEC', confirmed: true }).err).toBeUndefined()
  })
  it('a run off the listing still stops by name', () => {
    expect(attempt(SCRIPT, { pins: ALL, listing: false }).err.message).toMatch(/Q-S1n/)
  })
})

describe('W9-T1 rule 11: repaint-class inputs refuse broker mode by name', () => {
  const read = 'plot(strategy.position_size)\n'
  const cases = {
    'security with lookahead_on': 'x = request.security(syminfo.tickerid, "W", close, lookahead = barmerge.lookahead_on)\n',
    'security (higher timeframe)': 'x = request.security(syminfo.tickerid, "W", close)\n',
    timenow: 'x = timenow\n',
    'barstate.isrealtime': 'x = barstate.isrealtime ? 1 : 0\n',
    'barstate.islast': 'x = barstate.islast ? 1 : 0\n',
    'barstate.isconfirmed': 'x = barstate.isconfirmed ? 1 : 0\n',
    varip: 'varip int x = 0\n',
  }
  for (const [name, body] of Object.entries(cases).filter(([k]) => !['barstate.isrealtime', 'barstate.isconfirmed', 'varip'].includes(k))) {
    it(`${name} refuses runtime:strategy-repaint`, () => {
      const r = attempt(`${V5}${body}if bar_index == 3\n    strategy.entry("L", strategy.long)\n${read}`, { pins: ALL }).refused
      expect(r && r.guard).toBe('runtime:strategy-repaint')
    })
  }
  // These three are already refused BY NAME by the first build (they never reach the broker retry),
  // so the broker cannot serve them either; rule 11 holds them under their own guards.
  const OWN = { 'barstate.isrealtime': 'runtime:realtime-untold', 'barstate.isconfirmed': 'runtime:realtime-untold', varip: 'runtime:varip' }
  for (const [name, guard] of Object.entries(OWN)) {
    it(`${name} is refused by name (${guard}) before the broker is reached`, () => {
      const r = attempt(`${V5}${cases[name]}if bar_index == 3
    strategy.entry("L", strategy.long)
${read}`, { pins: ALL }).refused
      expect(r && r.guard).toBe(guard)
    })
  }
  it('a construct only in a comment or a string does not refuse', () => {
    const r = attempt(`${V5}// timenow barstate.islast\nplot(strategy.position_size, title = "varip timenow")\n`, { pins: ALL })
    expect(r.refused).toBeUndefined()
  })
  it('a strategy with none builds', () => {
    expect(attempt(SCRIPT, { pins: ALL }).err).toBeUndefined()
  })
})

describe('W9-T1 the record skeleton, keyed by bar time', () => {
  it('every trade carries entry/exit TIMES and the rule each fill rested on', () => {
    const { res } = attempt(SCRIPT, { pins: ALL })
    const rec = res.broker.record
    expect(rec.schema).toBe('uct.strategy-record/v0')
    expect(rec.trades).toHaveLength(1)
    expect(rec.trades[0].entry).toEqual({ time: QUIET[4].t, price: 104, rule: 'B-MARKET' })
    expect(rec.trades[0].exit).toEqual({ time: QUIET[11].t, price: 111, rule: 'B-CLOSE' })
    expect(JSON.stringify(rec)).not.toMatch(/bar_index|"bar":/)
  })
})

describe('W9-T1 the opcode and an order inside an if', () => {
  it('OP.BROKER sits after OBJ_DELETE, shares no number, and is implemented', () => {
    expect(OP.BROKER).toBe(100)
    expect(OP.BROKER).toBeGreaterThan(OP.OBJ_DELETE)
    expect(new Set(Object.values(OP)).size).toBe(Object.values(OP).length)
    expect(IMPLEMENTED.has(OP.BROKER)).toBe(true)
  })
  it('F10: an `if` reading a broker value around an order is lowered, not skipped', () => {
    const src = `${V5}if bar_index == 2\n    strategy.entry("L", strategy.long)\n`
      + 'if strategy.position_size > 0\n    strategy.exit("x", "L", limit = 400, stop = 90)\n'
      + 'if strategy.position_size > 0 and bar_index == 8\n    strategy.close("L")\nplot(strategy.position_size)\n'
    const { res, err } = attempt(src, { pins: ALL })
    expect(err).toBeUndefined()
    expect(Array.from(res.outputs[0].slice(2, 12))).toEqual([0, 1, 1, 1, 1, 1, 1, 0, 0, 0])
  })
})

describe('W9-T1 the gate is dark by default', () => {
  it('with no build option and no VITE flag, a broker value refuses pine:strategy-call exactly as before', () => {
    const b = buildRuntimeIr(SCRIPT, { bars: QUIET, inputs: {}, symbol: SYMBOL })
    expect(b.ok).toBe(false)
    expect(b.refusal.guard).toBe('pine:strategy-call')
  })
})
