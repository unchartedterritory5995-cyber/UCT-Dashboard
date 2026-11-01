// app/src/components/chart/engine/runtime/__tests__/runtimeInputKinds.test.js
//
// ⭐⭐ PHASE 3 WS-D — INPUT KINDS ON THE RUNTIME LANE (`docs/pine/PHASE3-RUNTIME-PLAN.md` §5, D).
//
// Each kind, end to end through the member door (`memberPaneDefinition` → install →
// `registry.computeFor`, the binder's own call): the script ATTACHES, the run computes with the
// author's default exactly, a member's value reaches the run and computes what the same script
// computes with that value typed as its default, a value outside the kind's grammar is refused BY
// NAME, and the settings the document declares are the ones `defSchema` validates.
//
//   input.time       → UNIX milliseconds (literal, `timestamp("dateString")`, or a binding to one)
//   input.session    → text (`HHMM-HHMM[:days]`), a member setting
//   input.timeframe  → text at its default (not a setting: the timeframe ruling)
//   input.symbol     → text at its default (not a setting: the same ruling, for a symbol)
//   v4 text input()  → text; a member's choice is no longer folded away
//   `var K = <lit>`  → a constant default, when nothing reassigns it
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import * as registry from '../../nativeRegistry'
import { memberPaneDefinition } from '../../../builder/memberPane/memberPaneDefinition'
import { validateDefinition, validateInputValue, isSessionString, RUNTIME_INPUT_TYPES } from '../../defSchema'
import {
  runtimeInputSpecsOf, runtimeInputValues, timestampOfDateString, textInputKindOf, constantVarsOf,
} from '../runtimeInputs'
import { lexPine, blockStatements } from '../../ast/pine.js'

const REPO = path.resolve(process.cwd(), '..')
const CASES = JSON.parse(fs.readFileSync(path.join(REPO, 'tests/fixtures/runtime_input_kind_cases.json'), 'utf8'))

const ID = 'u_member-pane-wsd'
afterEach(() => { registry.uninstallUserDefinition(ID); vi.unstubAllEnvs() })

const DAY = 86400
const T0 = 1600000000 // 2020-09-13T12:26:40Z
const bars = Array.from({ length: 300 }, (_, i) => {
  const c = 100 + 7 * Math.sin(i / 9) + 3 * Math.sin(i / 3.7)
  return { t: T0 + i * DAY, o: c - 0.4, h: c + 1.2, l: c - 1.1, c, v: 1000 + (i % 17) * 5 }
})
const CTX = { tf: 'D', newestBarIsForming: false, historyFromListing: true }

const mint = (src) => {
  vi.stubEnv('VITE_PINE_OBJECTS_ONLY_PANE_ENABLED', '1')
  vi.stubEnv('VITE_PINE_RUNTIME_PANE_ENABLED', '1')
  return memberPaneDefinition({ source: src, id: ID })
}
const runtimeOf = (src) => {
  const built = mint(src)
  expect(built.ok, built.reason || (built.runtimeDeclined && built.runtimeDeclined.why)).toBe(true)
  expect(built.lane).toBe('runtime')
  return built
}
/** The run's first drawn column for `inputs` (the instance's stored values), as the binder asks. */
const column = (built, inputs = {}) => {
  const { installed, rejected } = registry.installUserDefinitions([built.definition])
  expect(rejected || [], JSON.stringify(rejected)).toEqual([])
  const def = installed[0]
  const cols = registry.computeFor(def, bars, runtimeInputValues(def, inputs), CTX)
  registry.uninstallUserDefinition(ID)
  return Array.from(cols[built.rows[0].key])
}
/** A run handed `values` (raw, as the runtime receives them) refuses: no column, one named error. */
const refusalOf = (def, values) => {
  const cols = registry.computeFor(def, bars, values, CTX)
  expect(Object.keys(cols)).toEqual([])
  const errs = Object.values(registry.columnErrors(cols))
  expect(errs.length).toBeGreaterThan(0)
  return errs[0].message
}
const specOf = (built, key) => (built.definition.inputs || []).find((s) => s.key === key)

// A `var` read on every bar puts each script on the runtime lane (the host lane refuses it).
const RT = 'var float acc = 0.0\nacc := nz(acc) * 0 + 1\n'

describe('⭐⭐ timestamp(dateString) — the documented forms, read exactly', () => {
  it.each([
    ['01 Jan 2021 00:00 +0000', Date.UTC(2021, 0, 1)],
    ['18 May 2022 00:00 +0000', Date.UTC(2022, 4, 18)],
    ['20 Feb 2020', Date.UTC(2020, 1, 20)], // no time → 00:00, no zone → GMT+0 (reference)
    ['20 Feb 2020 15:30', Date.UTC(2020, 1, 20, 15, 30)],
    ['Thu, 20 Feb 2020 15:30:10 -0500', Date.UTC(2020, 1, 20, 20, 30, 10)],
    ['01 Jan 2000 00:00:00 GMT+10', Date.UTC(1999, 11, 31, 14)], // ⚠️ needs capture (not RFC 2822)
    ['2020-02-20', Date.UTC(2020, 1, 20)],
    ['2020-02-20T15:30+02:00', Date.UTC(2020, 1, 20, 13, 30)],
    ['2020-02-20T15:30:45Z', Date.UTC(2020, 1, 20, 15, 30, 45)],
  ])('%s', (s, ms) => {
    expect(timestampOfDateString(s)).toBe(ms)
  })
  it.each(['31 Feb 2020', '2020-13-01', 'yesterday', '01 Foo 2020', '2020-02-20T25:00', '20 Feb 2020 America/New_York'])(
    '⛔ %s is not read', (s) => { expect(timestampOfDateString(s)).toBe(null) })
})

describe('⭐⭐ input.time — UNIX milliseconds', () => {
  const SRC = `//@version=5
indicator("t")
startDate = input.time(timestamp("01 Jan 2021 00:00 +0000"), "Start")
${RT}plot(acc * (time >= startDate ? 1 : 0))
`
  const firstOn = (col) => col.findIndex((v) => v === 1)
  const firstBarAtOrAfter = (ms) => bars.findIndex((b) => b.t * 1000 >= ms)

  it('attaches, declares a `time` setting with the author\'s default, and compares against `time` in ms', () => {
    const built = runtimeOf(SRC)
    expect(specOf(built, 'startDate')).toEqual({ key: 'startDate', type: 'time', default: Date.UTC(2021, 0, 1), label: 'Start' })
    expect(validateDefinition(built.definition).ok).toBe(true)
    expect(firstOn(column(built))).toBe(firstBarAtOrAfter(Date.UTC(2021, 0, 1)))
  })

  it('a member\'s time reaches the run: the same column as the script with that date typed in', () => {
    const built = runtimeOf(SRC)
    const member = Date.UTC(2021, 2, 1)
    const typed = runtimeOf(SRC.replace('01 Jan 2021 00:00 +0000', '01 Mar 2021 00:00 +0000'))
    const got = column(built, { startDate: member })
    expect(firstOn(got)).toBe(firstBarAtOrAfter(member))
    expect(got).toEqual(column(typed))
  })

  it('the default follows a name bound to `timestamp(…)` (the kNN shape), zone included', () => {
    const built = runtimeOf(`//@version=5
indicator("t2")
int sd = timestamp('01 Jan 2000 00:00:00 GMT+10')
startDate = input.time(sd, "Start")
${RT}plot(acc * (time >= startDate ? 1 : 0))
`)
    expect(specOf(built, 'startDate').default).toBe(Date.UTC(1999, 11, 31, 14))
  })

  it('v4: `input(defval = timestamp(…), type = input.time)` is the same setting', () => {
    const { specs } = runtimeInputSpecsOf(`//@version=4
study("t4")
s = input(defval = timestamp("01 Jan 2021 00:00 +0000"), title = "From", type = input.time)
plot(close)
`)
    expect(specs).toEqual([{ key: 's', type: 'time', default: Date.UTC(2021, 0, 1), label: 'From' }])
  })

  it('⛔ `timestamp(year, month, …)` reads the exchange\'s zone: refused by name, not guessed', () => {
    const built = mint(`//@version=5
indicator("t3")
startDate = input.time(timestamp(2021, 1, 1), "Start")
${RT}plot(acc * (time >= startDate ? 1 : 0))
`)
    expect(built.ok).toBe(false)
    expect(built.runtimeDeclined.why).toMatch(/exchange's time zone/)
  })

  it.each(['99999999999999999', '8640000000000001', '-8640000000000001'])(
    '⛔ a default outside the JS Date range (%s ms) is refused by name — the document would never validate', (lit) => {
      const src = SRC.replace('timestamp("01 Jan 2021 00:00 +0000")', lit)
      const { specs, skipped } = runtimeInputSpecsOf(src)
      expect(specs.find((s) => s.key === 'startDate')).toBeUndefined()
      expect(skipped.find((s) => s.key === 'startDate').reason).toMatch(/outside the dates/)
      const built = mint(src)
      expect(built.ok).toBe(false)
      expect(built.runtimeDeclined.why).toMatch(/startDate.*outside the dates/)
    })

  it('the edge of the range is still a time: ±8.64e15 ms', () => {
    const built = runtimeOf(SRC.replace('timestamp("01 Jan 2021 00:00 +0000")', '8640000000000000'))
    expect(specOf(built, 'startDate').default).toBe(8.64e15)
    expect(validateDefinition(built.definition).ok).toBe(true)
  })

  it('⛔ a member value outside the JS Date range is refused by name', () => {
    const built = runtimeOf(SRC)
    const { installed } = registry.installUserDefinitions([built.definition])
    expect(refusalOf(installed[0], { startDate: 8640000000000001 })).toMatch(/startDate.*not a time/)
  })

  it('⭐ `timestamp("UTC", y, m, d, h, mi)` names its zone, so it is read exactly', () => {
    const at = (args) => runtimeInputSpecsOf(`//@version=5
indicator("tz")
s = input.time(timestamp(${args}), "S")
plot(close)
`).specs[0]
    expect(at('"UTC", 2021, 1, 1, 0, 0').default).toBe(Date.UTC(2021, 0, 1))
    expect(at('"GMT+10", 2021, 1, 1, 9, 30').default).toBe(Date.UTC(2020, 11, 31, 23, 30))
    expect(at('"UTC-5", 2021, 6, 1, 0, 0, 15').default).toBe(Date.UTC(2021, 5, 1, 5, 0, 15))
    expect(at('timezone = "UTC", year = 2021, month = 1, day = 1, hour = 0, minute = 0').default).toBe(Date.UTC(2021, 0, 1))
  })

  it.each([
    ['"America/New_York", 2021, 1, 1, 0, 0', /named time zone/],
    ['"UTC", 2021, 2, 30, 0, 0', /not a date/],
    ['"UTC", 2021, 1, 1, 5, -1', /not a date/], // Date.UTC would carry it to 04:59 the same day
    ['"UTC-14", 275760, 9, 13, 0, 0', /outside the dates/], // Date's last instant, then 14 h later
    ['"UTC", 2021, 1, 1, h, 0', /not a fixed date/],
  ])('⛔ timestamp(%s) is refused with its own reason', (args, why) => {
    const { skipped } = runtimeInputSpecsOf(`//@version=5
indicator("tz")
h = 3
s = input.time(timestamp(${args}), "S")
plot(close)
`)
    expect(skipped.find((x) => x.key === 's').reason).toMatch(why)
  })

  it('⛔ a member value that is not whole milliseconds is refused by name, never coerced', () => {
    const built = runtimeOf(SRC)
    const { installed } = registry.installUserDefinitions([built.definition])
    expect(refusalOf(installed[0], { startDate: 1.5 })).toMatch(/startDate.*not a time/)
    const errors = []
    validateInputValue(specOf(built, 'startDate'), 1.5, 'inputs.startDate', errors)
    expect(errors[0]).toMatch(/whole milliseconds/)
  })
})

describe('⭐⭐ input.session — a session string', () => {
  const SRC = `//@version=5
indicator("s")
sess = input.session("0930-1600", "Session")
var string seen = ""
seen := sess
${RT}plot(acc * (seen == "0930-1600" ? close : seen == "0800-1200" ? open : 0))
`
  it('attaches with the author\'s default, and declares a `session` setting', () => {
    const built = runtimeOf(SRC)
    expect(specOf(built, 'sess')).toEqual({ key: 'sess', type: 'session', default: '0930-1600', label: 'Session' })
    expect(column(built)).toEqual(bars.map((b) => b.c))
  })
  it('a member\'s session reaches the run', () => {
    expect(column(runtimeOf(SRC), { sess: '0800-1200' })).toEqual(bars.map((b) => b.o))
  })
  it('⛔ a member value that is not a session is refused by name', () => {
    const built = runtimeOf(SRC)
    const { installed } = registry.installUserDefinitions([built.definition])
    expect(refusalOf(installed[0], { sess: '9:30 to 4' })).toMatch(/sess.*not a session/)
  })
  it('⛔ an AUTHOR default that is not a session is refused by name (the setting is skipped, the run refuses)', () => {
    const built = mint(SRC.replace('input.session("0930-1600"', 'input.session("9:30 to 4"'))
    expect(built.ok).toBe(false)
    expect(built.runtimeDeclined.why).toMatch(/"9:30 to 4", which is not a session/)
  })
  it('with `options`, it is a menu of the author\'s sessions', () => {
    const { specs } = runtimeInputSpecsOf(`//@version=5
indicator("s2")
sess = input.session("0930-1600", "S", options = ["0930-1600", "0400-0930"])
plot(close)
`)
    expect(specs).toEqual([{ key: 'sess', type: 'enum', default: '0930-1600', label: 'S', options: ['0930-1600', '0400-0930'] }])
  })
})

describe('⭐ input.timeframe and input.symbol — text at the author\'s default, never a setting', () => {
  it.each([
    ['input.timeframe("D", "TF")', 'D', /timeframe setting/],
    ['input.symbol("NASDAQ:AAPL", "Sym")', 'NASDAQ:AAPL', /symbol setting/],
  ])('%s', (call, dflt, reason) => {
    const built = runtimeOf(`//@version=5
indicator("x")
k = ${call}
var string seen = ""
seen := k
${RT}plot(acc * (seen == "${dflt}" ? close : open))
`)
    expect(column(built)).toEqual(bars.map((b) => b.c))
    expect(specOf(built, 'k')).toBeUndefined()
    const { skipped } = runtimeInputSpecsOf(`k = ${call}\nplot(close)\n`)
    expect(skipped[0].reason).toMatch(reason)
  })
})

describe('⭐⭐ v4 text `input(…)` — a member\'s choice reaches the run', () => {
  const SRC = `//@version=4
study("ls")
t = input("EMA", options=["EMA", "SMA"])
${RT}plot(acc * (t == "EMA" ? ema(close, 10) : sma(close, 10)))
`
  it('⚰️ "SMA" drew the EMA column (the columnar lane folded the comparison from the default); now it is the SMA', () => {
    const built = runtimeOf(SRC)
    expect(specOf(built, 't')).toEqual({ key: 't', type: 'enum', default: 'EMA', label: 't', options: ['EMA', 'SMA'] })
    const typed = runtimeOf(SRC.replace('input("EMA"', 'input("SMA"'))
    const sma = column(built, { t: 'SMA' })
    expect(sma).toEqual(column(typed))
    expect(sma).not.toEqual(column(built))
  })
  it('textInputKindOf: a quoted default or a text `type` makes a v4 input text; a number does not', () => {
    const call = (args) => ({ type: 'call', name: 'input', args })
    expect(textInputKindOf(call([{ value: { type: 'string', value: 'x' } }]))).toBe('string')
    expect(textInputKindOf(call([{ value: { type: 'string', value: 'D' } }, { value: { type: 'string', value: 'R' } },
      { value: { type: 'name', name: 'input.resolution' } }]))).toBe('timeframe')
    expect(textInputKindOf(call([{ value: { type: 'number', value: 3 } }]))).toBe(null)
  })
})

describe('⭐⭐ a default read from a `var` nothing reassigns is a constant', () => {
  const SRC = `//@version=4
study("vc")
var string MD1 = "A"
var string MD2 = "B"
m = input(MD1, "Mode", options = [MD1, MD2])
${RT}plot(acc * (m == MD1 ? close : open))
`
  it('attaches (was `runtime:input-state`), offers the author\'s menu, and the member\'s pick reaches the run', () => {
    const built = runtimeOf(SRC)
    expect(specOf(built, 'm')).toEqual({ key: 'm', type: 'enum', default: 'A', label: 'Mode', options: ['A', 'B'] })
    expect(column(built)).toEqual(bars.map((b) => b.c))
    expect(column(built, { m: 'B' })).toEqual(bars.map((b) => b.o))
  })
  it('constantVarsOf: once-declared, never reassigned, literal — nothing else', () => {
    const stmts = (src) => { const l = lexPine(src); return blockStatements(l.tokens, l.indents, 0) }
    const got = constantVarsOf(stmts(`var string A = "a"
var int B = 2
B := 3
var float C = close
var D = 4
D += 1
var E = 5
if close > open
    E2 = 1
`))
    expect([...got.keys()].sort()).toEqual(['A', 'E'])
  })
})

describe('⭐ defSchema — the two runtime-only types', () => {
  it.each(CASES.sessions.valid)('session %s is valid', (s) => { expect(isSessionString(s)).toBe(true) })
  it.each(CASES.sessions.invalid)('session %j is not', (s) => { expect(isSessionString(s)).toBe(false) })

  it('⛔ a formula (non-runtime) document may not declare them — the reserved sentence', () => {
    expect(RUNTIME_INPUT_TYPES).toEqual(['time', 'session'])
    const built = runtimeOf(`//@version=5
indicator("t")
startDate = input.time(timestamp("01 Jan 2021 00:00 +0000"), "Start")
${RT}plot(acc * (time >= startDate ? 1 : 0))
`)
    const asFormula = { ...built.definition, compute: { kind: 'ast', ast: { type: 'num', value: 0 }, fn: 'x', source: '0' } }
    const v = validateDefinition(asFormula)
    expect(v.ok).toBe(false)
    expect(v.errors.join('\n')).toMatch(/inputs\[\d+\]\.type: input type "time" is SCHEMA-RESERVED/)
  })
})

describe('⭐ saved documents', () => {
  it('a runtime document minted before WS-D (no time/session inputs) installs and runs exactly as before', () => {
    const built = runtimeOf(`//@version=5
indicator("old")
len = input.int(10, "Length")
${RT}plot(acc * ta.sma(close, len))
`)
    // what the door minted before this change for this script: the same inputs (nothing new is offered)
    expect(built.definition.inputs.map((s) => s.type).filter((t) => t === 'time' || t === 'session')).toEqual([])
    const before = column(built)
    expect(column(built, { len: 10 })).toEqual(before)
  })
  it('a stored instance value is what the next run reads (time and session survive the settings writer)', async () => {
    const { setIndicatorEnabled, setInstanceInput, findInstance } = await import('../../instanceControls')
    const { mergeChartSettings } = await import('../../../chartDefaults')
    const { legacyInstanceId } = await import('../../instances')
    const built = runtimeOf(`//@version=5
indicator("persist")
startDate = input.time(timestamp("01 Jan 2021 00:00 +0000"), "Start")
sess = input.session("0930-1600", "Session")
var string seen = ""
seen := sess
${RT}plot(acc * (time >= startDate and seen == "0930-1600" ? close : 0))
`)
    registry.installUserDefinitions([built.definition])
    let cs = setIndicatorEnabled(mergeChartSettings(null), ID, true, registry)
    const inst = legacyInstanceId(ID)
    cs = setInstanceInput(cs, inst, 'startDate', Date.UTC(2021, 5, 1), registry)
    cs = setInstanceInput(cs, inst, 'sess', '0800-1200', registry)
    const refused = setInstanceInput(cs, inst, 'sess', 'not a session', registry)
    expect(refused).toBe(cs)
    // ⛔ a time that is not whole ms, or not a number, is refused with the TIME sentence
    expect(setInstanceInput(cs, inst, 'startDate', 1.5, registry)).toBe(cs)
    expect(setInstanceInput(cs, inst, 'startDate', '2021-06-01', registry)).toBe(cs)
    const { checkInstanceInput } = await import('../../instanceControls')
    expect(checkInstanceInput(registry.getDefinition(ID), 'startDate', 1.5).why).toMatch(/whole milliseconds/)
    expect(checkInstanceInput(registry.getDefinition(ID), 'startDate', '2021-06-01').why).toMatch(/takes a time/)
    expect(findInstance(cs, inst).inputs).toMatchObject({ startDate: Date.UTC(2021, 5, 1), sess: '0800-1200' })
    const reread = JSON.parse(JSON.stringify(cs))
    const col = registry.computeFor(registry.getDefinition(ID), bars,
      runtimeInputValues(registry.getDefinition(ID), findInstance(reread, inst).inputs), CTX)[built.rows[0].key]
    expect(Array.from(col).every((v) => v === 0)).toBe(true) // the member's session never matches the default
  })
})
