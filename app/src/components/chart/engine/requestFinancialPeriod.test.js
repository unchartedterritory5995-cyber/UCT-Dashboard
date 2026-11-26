// app/src/components/chart/engine/requestFinancialPeriod.test.js
//
// ─── ⭐⭐ e98 E4 — `request.financial`'s PERIOD FROM A SETTING, BOUND AT THE INSTANCE'S SETTINGS ───────────────────
//
// ⚰️ TradingView accepts a simple-string period, a setting included (`period = input.string("FQ", options = ["FQ", "FY",
// "TTM"])`). The parse read the period as a constant only, so such a script read the `XP` ticker and was refused
// `other-symbol:financial-period` ("not written as one of `FQ`, `FY`, …"), whatever the member had set: measured
// 2026-11-25 on the shape of a Deepvue EPS script (quarterly / annual), which did not run after two repairs.
//
// ⭐ NOW the parse (`pine.js::eventAsSecurity`, `pineFinancial.js::financialPeriodArms`) reads one call per catalog period,
// `p == "FQ" ? <FQ read> : p == "TTM" ? <TTM read> : … : <the call as written>`, and the resolver reads each test as the
// member's enum setting (`enumCompare`), so the bind prunes to the read the instance's setting picks (`knobBind.js::
// boundAtInputs`, `meta.otherSymbols` narrowed with it). Each read is judged by its own period: a period UCT serves is
// left to the financial door (dark / unadmitted for members: refused as NOT AVAILABLE, never as a period); a period it
// does not serve, or an option outside the catalog, stays refused BY NAME.

import { describe, it, expect, afterAll } from 'vitest'

import { translatePine, __financialPeriodSettingForTests } from './ast/pine.js'
import { memberPaneDefinition } from '../builder/memberPane/memberPaneDefinition'
import { boundAtInputs } from './knobBind.js'
import { symTickersOf, staticallyUnservable, financialDecision, OTHER_SYMBOL_REFUSAL } from './otherSymbols.js'
import { EVENT_VENUE } from './pineEvents.js'
import { FINANCIAL_KEY, financialPeriodArms } from './pineFinancial.js'
import { validateDefinition } from './defSchema.js'

afterAll(() => __financialPeriodSettingForTests(true))

const H = '//@version=6\nindicator("EPS")\n'
const SETTING = (options = '"FQ", "FY", "TTM"', dflt = 'FQ') => `${H}p = input.string("${dflt}", "Period", options = [${options}])\n`
  + 'eps = request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", p)\nplot(eps, "EPS")\n'
const R = OTHER_SYMBOL_REFUSAL

function door(src) {
  const r = memberPaneDefinition({ source: src })
  expect(r.ok, r.reason).toBe(true)
  expect(validateDefinition(r.definition).errors || []).toEqual([])
  return r.definition
}
/** The one financial read an instance with these settings draws, and the static decision on it. */
function readAt(def, inputs) {
  const tickers = symTickersOf(boundAtInputs(def, inputs)).filter((t) => t.startsWith('EV-F'))
  expect(tickers, JSON.stringify(inputs)).toHaveLength(1)
  return { ticker: tickers[0], refusal: staticallyUnservable(tickers[0], EVENT_VENUE) }
}
const darkSupply = () => new Map([[FINANCIAL_KEY, { status: 'dark' }]])

describe('e98 E4 — the period setting is the member\'s enum setting; the setting selects one read', () => {
  it('the door carries the setting and one read per option, as a knob chain', () => {
    const def = door(SETTING())
    expect(def.inputs.find((i) => i.key === 'p')).toMatchObject({ type: 'enum' })
    expect(def.compute.source).toContain("p == 0 ? sym('EV-FED-Q0', close)")
    expect(def.compute.source).toContain("sym('EV-FED-T0', close)")
  })

  it('at the default (FQ) the read is served by its period; for a member the refusal names the financial door, not the period', () => {
    const def = door(SETTING())
    const { ticker, refusal } = readAt(def, {})
    expect(ticker).toBe('EV-FED-Q0')
    expect(refusal).toBeNull()
    const d = financialDecision(ticker, { tf: 'D', secondary: darkSupply(), symbol: { ticker: 'AAPL' } })
    expect(d.code).toBe(R.FINANCIAL_NOT_AVAILABLE)
    expect(d.reason).toContain('financial figures are not available on this chart yet')
  })

  it('the member picks TTM: the TTM read, served by its period', () => {
    const { ticker, refusal } = readAt(door(SETTING()), { p: 'TTM' })
    expect(ticker).toBe('EV-FED-T0')
    expect(refusal).toBeNull()
  })

  it('the member picks FY, a period UCT does not serve for this id: refused BY NAME, that period\'s own reason', () => {
    const { ticker, refusal } = readAt(door(SETTING()), { p: 'FY' })
    expect(ticker).toBe('EV-FED-Y0')
    expect(refusal.code).toBe(R.FINANCIAL_PERIOD)
    expect(refusal.reason).toContain('served for `FQ` and `TTM` only (`FY`: UCT\'s filings store holds no fiscal-year series yet)')
  })

  it('an option outside the catalog\'s periods falls to the call as written: refused by name, never guessed', () => {
    const def = door(SETTING('"FQ", "quarterly"'))
    const { ticker, refusal } = readAt(def, { p: 'quarterly' })
    expect(ticker).toBe('EV-FED-XP')
    expect(refusal.code).toBe(R.FINANCIAL_PERIOD)
    expect(refusal.reason).toContain('not written as one of')
    expect(readAt(def, {}).ticker).toBe('EV-FED-Q0')
  })
})

describe('e98 E4 — what does not move', () => {
  it('control: before E4 the same script read the unreadable period, refused as a period', () => {
    __financialPeriodSettingForTests(false)
    try {
      const t = translatePine(SETTING(), { basePeriod: 'D', strict: true })
      expect(t.outputs[0].formula).toBe("sym('EV-FED-XP', close)")
      expect(staticallyUnservable('EV-FED-XP', EVENT_VENUE).code).toBe(R.FINANCIAL_PERIOD)
    } finally { __financialPeriodSettingForTests(true) }
  })

  it('a literal period is one read, exactly as before (no chain)', () => {
    const t = translatePine(`${H}plot(request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", "FQ"), "EPS")\n`,
      { basePeriod: 'D', strict: true })
    expect(t.outputs[0].formula).toBe("sym('EV-FED-Q0', close)")
  })

  it('the parse leaves a constant period alone (no arms), and arms a name with one call per catalog period', () => {
    const call = (period) => ({ type: 'call', name: 'request.financial', args: [
      { name: null, value: { type: 'name', name: 'syminfo.tickerid' } },
      { name: null, value: { type: 'string', value: 'EARNINGS_PER_SHARE_DILUTED' } },
      { name: null, value: period }] })
    expect(financialPeriodArms(call({ type: 'string', value: 'FQ' }))).toBeNull()
    const arms = financialPeriodArms(call({ type: 'name', name: 'p' }))
    expect(arms.arms.map((a) => a.period)).toEqual(['FQ', 'TTM', 'FY', 'FH', 'D'])
    expect(arms.arms[1].call.args[2].value).toMatchObject({ type: 'string', value: 'TTM' })
  })

  it('a plain (undeclared) translation folds the setting to its default: one read', () => {
    const t = translatePine(SETTING('"FQ", "FY", "TTM"', 'TTM'), { basePeriod: 'D', strict: true })
    expect(t.outputs[0].formula).toBe("sym('EV-FED-T0', close)")
  })
})
