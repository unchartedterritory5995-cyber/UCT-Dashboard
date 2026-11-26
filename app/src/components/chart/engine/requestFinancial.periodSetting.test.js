// ⭐ 2026-11-25 -- THE FORM RULE 16 TEACHES RUNS ON THIS ENGINE (`api/services/pine_authoring.py::FINANCIAL_PERIOD_RULE`).
// A period the member chooses in the settings is written as one `request.financial` per option, each with a constant
// period, picked by the input. Held here against the engine's own static check: both reads are served, and the form
// the assistant wrote three times (the input itself as the period) is still refused, by its code. When e98's engine
// unit lets a simple-string input be the period, the control below changes and the rule gives way to the direct form.
import { describe, it, expect } from 'vitest'
import { translatePine } from './ast/pine'
import { staticallyUnservable, OTHER_SYMBOL_REFUSAL as R } from './otherSymbols'
import { EVENT_VENUE } from './pineEvents'

const pine = (lines) => ['//@version=5', 'indicator("EPS")', ...lines].join('\n')
const reads = (src) => (translatePine(src, { strict: true }).otherSymbols || [])
const refusals = (src) => reads(src).map((o) => staticallyUnservable(o.ticker, EVENT_VENUE)).filter(Boolean)

describe('rule 16: one constant read per option, chosen by the input', () => {
  it('two constant reads picked by an input are both served', () => {
    const src = pine([
      'period = input.string("FQ", "Period", options = ["FQ", "TTM"])',
      'fq = request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", "FQ")',
      'ttm = request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", "TTM")',
      'plot(period == "TTM" ? ttm : fq, "EPS", style = plot.style_stepline)',
    ])
    expect(reads(src)).toHaveLength(2)
    expect(refusals(src)).toEqual([])
  })

  it('CONTROL: the input itself as the period is refused for its period', () => {
    const src = pine([
      'period = input.string("FQ", "Period", options = ["FQ", "TTM"])',
      'plot(request.financial(syminfo.tickerid, "EARNINGS_PER_SHARE_DILUTED", period))',
    ])
    expect(refusals(src)[0]).toMatchObject({ code: R.FINANCIAL_PERIOD })
  })

  it('CONTROL: a fiscal-year read is refused, which is why the rule says to leave it out', () => {
    expect(refusals(pine(['plot(request.financial(syminfo.tickerid, "TOTAL_REVENUE", "FY"))']))[0])
      .toMatchObject({ code: R.FINANCIAL_PERIOD })
  })
})
