// Support loop A1/A2 — the pure reader (`docs/pine/support-loop/PHASE-A.md`).
//
// ⛔ EVERY REPORT HERE COMES FROM THE SHIPPED DOOR (`PineBox.inspectSource`, the
// function the import box calls), never a hand-built object, except where a case
// needs a shape the translator cannot be made to produce on demand.
import { describe, it, expect } from 'vitest'
import { inspectSource } from '../builder/PineBox'
import {
  importGaps, gapNoticeText, gapLogPayload, isPineBuiltin, PINE_BUILTIN_NAMES, GAP_KIND,
} from './importGaps'
import BUILTINS from './pineBuiltins.json'

const pine = (body) => `//@version=5\nindicator("t")\n${body}\n`
const gapsOf = (src) => importGaps(inspectSource(src, 'auto'))

describe('the closed allowlist', () => {
  it('is a flat sorted list of dotted lower-case identifiers, nothing free-form', () => {
    expect(Array.isArray(BUILTINS.names)).toBe(true)
    expect(BUILTINS.names.length).toBeGreaterThan(500)
    for (const n of BUILTINS.names) expect(n).toMatch(/^[a-z_][a-z0-9_]*(\.[a-z_][a-z0-9_]*){0,2}$/)
    expect([...BUILTINS.names].sort()).toEqual(BUILTINS.names)
  })
  it('knows the real built-ins and not a member identifier', () => {
    for (const n of ['ta.sma', 'ta.supertrend', 'request.security', 'math.pow', 'syminfo.mintick', 'sma']) {
      expect(isPineBuiltin(n)).toBe(true)
    }
    for (const n of ['mySecretThing', 'myFn', 'ta.foo', '', null, 3, 'TA.SMA']) expect(isPineBuiltin(n)).toBe(false)
    expect(PINE_BUILTIN_NAMES.has('ta.rsi')).toBe(true)
  })
})

describe('A1 — a gap exists exactly when something did not translate', () => {
  it('a fully translated script has no gap and no notice', () => {
    const g = gapsOf(pine('plot(ta.sma(close, 10))'))
    expect(g.gaps).toEqual([])
    expect(gapNoticeText(g)).toBeNull()
  })

  it('a refused plot is a gap; a real built-in is named, with how it failed', () => {
    // `ta.sma` given one argument: the door KNOWS the name and cannot map the call.
    const g = gapsOf(pine('plot(ta.sma(close))\nplot(close)'))
    expect(g.gaps).toEqual([{ name: 'ta.sma', kind: GAP_KIND.CALL_UNMAPPED, guard: 'pine:arity' }])
    expect(gapNoticeText(g)).toBe('1 part of this script isn’t supported yet, so the chart may differ from TradingView: ta.sma.')
  })

  it('a member identifier is NEVER named — it is an unnamed part', () => {
    const g = gapsOf(pine('plot(mySecretThing + 1)\nplot(myFn(close))\nplot(close)'))
    expect(g.named).toEqual([])
    expect(g.unnamed).toBe(2)
    const text = gapNoticeText(g)
    expect(text).toBe('2 parts of this script aren’t supported yet, so the chart may differ from TradingView.')
    expect(text).not.toMatch(/mySecretThing|myFn/)
  })

  it('a whole-script refusal on an unknown name is a gap too', () => {
    const r = inspectSource(pine('plot(ta.foo(close, 14))'), 'auto')
    expect(r.ok).toBe(false)
    const g = importGaps(r)
    expect(g.gaps.length).toBe(1)
    expect(g.gaps[0].kind).toBe(GAP_KIND.NAME_UNKNOWN)
    expect(g.gaps[0].name).toBeNull()       // `ta.foo` is not a real built-in
  })

  it('named and unnamed together say both, and dedupe by name', () => {
    const g = gapsOf(pine('plot(ta.sma(close))\nplot(ta.sma(open))\nplot(myFn(close))\nplot(close)'))
    expect(g.named).toEqual(['ta.sma'])
    expect(gapNoticeText(g)).toBe('2 parts of this script aren’t supported yet, so the chart may differ '
      + 'from TradingView: ta.sma, and 1 other part.')
  })

  it('a script-shape refusal (nothing plotted) is not a "part not supported"', () => {
    const r = inspectSource('//@version=5\nindicator("t")\nx = close\n', 'auto')
    expect(r.ok).toBe(false)
    expect(importGaps(r).gaps).toEqual([])
  })

  it('another dialect is out of scope', () => {
    const r = inspectSource('def a = Average(close, 20);\nplot P1 = a;\nplot P2 = MACD(12, 26, 9).Value;', 'auto')
    expect(r.dialect).toBe('thinkscript')
    expect(importGaps(r).gaps).toEqual([])
  })

  it('never throws on garbage', () => {
    expect(importGaps(null).gaps).toEqual([])
    expect(importGaps({ outputs: 7, refusal: 'x' }).gaps).toEqual([])
  })
})

describe('A2 — the log payload carries only allowlisted names and a count', () => {
  it('drops every non-allowlisted name to a count', () => {
    const p = gapLogPayload({ gaps: [
      { name: 'ta.sma', kind: 'call-unmapped' },
      { name: 'mySecretThing', kind: 'name-unknown' },
      { name: null, kind: 'name-unknown' },
      { name: 'ta.rci', kind: 'weird' },
    ] })
    expect(p).toEqual({
      gaps: [{ name: 'ta.sma', kind: 'call-unmapped' }, { name: 'ta.rci', kind: 'call-unmapped' }],
      unlisted: 2,
    })
    expect(JSON.stringify(p)).not.toMatch(/mySecretThing/)
  })

  it('end to end from a real paste: identifiers never reach the payload', () => {
    const p = gapLogPayload(gapsOf(pine('secretLevel = 42\nplot(ta.sma(close))\nplot(myHelper(secretLevel))\nplot(close)')))
    expect(JSON.stringify(p)).not.toMatch(/secretLevel|myHelper/)
    for (const g of p.gaps) expect(isPineBuiltin(g.name)).toBe(true)
  })
})
