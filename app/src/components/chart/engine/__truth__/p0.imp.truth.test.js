// ─── P0 TRUTH CORPUS — slice "imp": imports tell the truth ────────────────────
//
// Every case states ASKED (what the member pasted), CLAIMED (what UCT used to say
// it would do — the BEFORE, measured 2026-10-05 on a92b96de2), DID (what the
// engine now does), and the expected outcome class. No case is left an
// unclassified silent wrong answer.
//
// Outcome classes used: EXACT · DISCLOSED DIFFERENCE · PARTIAL · UNSUPPORTED ·
// CONTROLLED ERROR · VALUE.
import { describe, it, expect, vi, afterEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { inspectSource, inspectPine } from '../../builder/PineBox'
import { translatePine } from '../ast/pine'
import { evaluateFormula } from '../../builder/FormulaField'
import { BUILDER_INPUT_SCOPE } from '../../builder/builderInputs'
import { importOutcome, OUTCOME, classifyNote, SEVERITY, TREE_SEMANTIC_RULES, controlledErrorReport } from '../ast/importOutcome'
import { foreignLanguage } from '../ast/foreignLanguage'
import { memberPaneDefinition } from '../../builder/memberPane/memberPaneDefinition'

const H = '//@version=5\nindicator("p")\n'
const REPO = path.resolve(process.cwd(), '..')
const verdict = (src) => inspectSource(src).outcome.verdict

afterEach(() => { vi.restoreAllMocks() })

describe('0G import outcome contract — exactly one verdict per import', () => {
  it('EXACT — ASKED plot(ta.sma(close,10)); CLAIMED ok (no verdict); DID exact', () => {
    expect(verdict(H + 'plot(ta.sma(close, 10))')).toBe(OUTCOME.EXACT)
  })
  it('EXACT is never given when an ignored line is presentation (PRESENTATION ⇒ DISCLOSED)', () => {
    const r = inspectSource('declare lower;\nplot p = Average(close, 20);\np.SetDefaultColor(Color.RED);')
    expect(r.outcome.verdict).toBe(OUTCOME.DISCLOSED)
    expect(r.outcome.presentation.length).toBeGreaterThan(0)
  })
  it('UNSUPPORTED — a refused script names its reason', () => {
    const r = inspectSource(H + 'plot(ta.supertrend(3, 10))')
    expect(r.outcome.verdict).toBe(OUTCOME.UNSUPPORTED)
    expect(r.outcome.reason).toBeTruthy()
  })
  it('every verdict is one of the five', () => {
    for (const s of [H + 'plot(close)', 'C > AVGC50', 'close > 10', 'plot x = close;', '{', 'Inputs: L(1);\nVars: A(0);']) {
      expect(Object.values(OUTCOME)).toContain(verdict(s))
    }
  })
  it('importOutcome never throws on junk', () => {
    expect(importOutcome(null).verdict).toBe(OUTCOME.UNSUPPORTED)
    expect(importOutcome({ ok: true, outputs: [null, {}], ignored: [null] }).verdict).toBeTruthy()
  })
})

describe('0H Pine silent drops', () => {
  it('UNSUPPORTED — ASKED request.security(..., currency=currency.EUR); CLAIMED ok, plotted sym(QQQ) in USD (silent wrong numbers); DID refuse naming currency', () => {
    const r = inspectSource(H + 'plot(request.security("NASDAQ:QQQ", "D", close, currency=currency.EUR))')
    expect(r.ok).toBe(false)
    expect(r.outcome.verdict).toBe(OUTCOME.UNSUPPORTED)
    expect(r.refusal.message).toMatch(/currency = currency\.EUR/)
  })
  it('VALUE — currency=currency.USD is the identity on a US-dollar engine (stays translated)', () => {
    expect(inspectSource(H + 'plot(request.security("QQQ", "D", close, currency=currency.USD))').ok).toBe(true)
  })
  it('UNSUPPORTED — ASKED weekly request with gaps=barmerge.gaps_on; CLAIMED ok tf(close,W) (step line where TV has na); DID refuse naming gaps', () => {
    for (const g of ['gaps=barmerge.gaps_on', 'gaps=true', 'barmerge.gaps_on']) {
      const r = inspectSource(H + `plot(request.security(syminfo.tickerid, "W", close, ${g}))`)
      expect(r.ok, g).toBe(false)
      expect(r.refusal.message, g).toMatch(/gaps = barmerge\.gaps_on/)
    }
  })
  it('DISCLOSED — gaps_off (the default) on a weekly request stays translated', () => {
    const r = inspectSource(H + 'plot(request.security(syminfo.tickerid, "W", close, gaps=barmerge.gaps_off))')
    expect(r.ok).toBe(true)
  })
  it('VALUE — gaps_on at the chart\'s own timeframe is the identity', () => {
    expect(inspectSource(H + 'plot(request.security(syminfo.tickerid, timeframe.period, close, gaps=barmerge.gaps_on))').ok).toBe(true)
  })
  it('UNSUPPORTED — ASKED calc_bars_count=100; CLAIMED ok (computed on all history); DID refuse naming it', () => {
    const r = inspectSource(H + 'plot(request.security(syminfo.tickerid, "W", close, calc_bars_count=100))')
    expect(r.ok).toBe(false)
    expect(r.refusal.message).toMatch(/calc_bars_count/)
  })
  it('VALUE — ignore_invalid_symbol=true changes no served value (classified INFO, stays translated)', () => {
    expect(inspectSource(H + 'plot(request.security("NASDAQ:QQQ", "D", close, ignore_invalid_symbol=true))').ok).toBe(true)
  })
  it('UNSUPPORTED — ASKED indicator(timeframe="W"); CLAIMED ok sma(close,10) on the CHART timeframe (silent wrong numbers); DID refuse', () => {
    const r = inspectSource('//@version=5\nindicator("p", timeframe="W", timeframe_gaps=true)\nplot(ta.sma(close, 10))')
    expect(r.ok).toBe(false)
    expect(r.outcome.verdict).toBe(OUTCOME.UNSUPPORTED)
    expect(r.refusal.message).toMatch(/indicator\(timeframe = "W"\)/)
    // and the strict (member pane) lane refuses too
    expect(translatePine('//@version=5\nindicator("p", timeframe="W")\nplot(close)', { strict: true }).ok).toBe(false)
  })
  it('EXACT — indicator(timeframe="") is the chart\'s own timeframe', () => {
    expect(verdict('//@version=5\nindicator("p", timeframe="")\nplot(ta.sma(close, 10))')).toBe(OUTCOME.EXACT)
  })
  it('DISCLOSED (presentation) — ASKED plot(show_last=10, trackprice=true); CLAIMED ok, nothing said; DID disclose both', () => {
    const r = inspectSource(H + 'plot(close, trackprice=true, show_last=10)')
    expect(r.ok).toBe(true)
    expect(r.outcome.verdict).toBe(OUTCOME.DISCLOSED)
    const text = r.outcome.presentation.map((n) => n.note).join(' ')
    expect(text).toMatch(/show_last/)
    expect(text).toMatch(/trackprice/)
    expect(r.outcome.semantic).toHaveLength(0)
  })
  it('DISCLOSED (presentation) — ASKED indicator(format=, precision=, scale=); CLAIMED nothing; DID disclose each', () => {
    const r = inspectSource('//@version=5\nindicator("p", format=format.percent, precision=1, scale=scale.left)\nplot(close)')
    expect(r.outcome.verdict).toBe(OUTCOME.DISCLOSED)
    const text = r.outcome.presentation.map((n) => n.note).join(' ')
    for (const a of ['format', 'precision', 'scale']) expect(text).toContain(`\`${a} =\``)
  })
  it('DISCLOSED (semantic) — ASKED weekly request lookahead_off; CLAIMED ok, nothing said; DID disclose the one-bar-later step-back (slice inv finding)', () => {
    const r = inspectSource(H + 'plot(request.security(syminfo.tickerid, "W", close))')
    expect(r.outcome.verdict).toBe(OUTCOME.DISCLOSED)
    const n = r.outcome.semantic.find((x) => x.name === 'htfLookaheadOffStepBacks')
    expect(n && n.note).toMatch(/one bar later than TradingView/)
    expect(r.outputs[0].htfLookaheadOffStepBacks).toHaveLength(1)
  })
  it('PERSISTED — the step-back disclosure rides the saved member-pane definition (meta.disclosures, existing field)', () => {
    const d = memberPaneDefinition({ source: H + 'plot(request.security(syminfo.tickerid, "W", close))', id: 'u_test', name: 't' })
    expect(d.ok).toBe(true)
    const names = (d.definition.meta.disclosures || []).map((n) => n.name)
    expect(names).toContain('htfLookaheadOffStepBacks')
  })
  it('the step-back seam does NOT fire for lookahead_on (tf_live)', () => {
    const r = inspectSource(H + 'plot(request.security(syminfo.tickerid, "W", close, lookahead=barmerge.lookahead_on))')
    expect((r.outputs[0].htfLookaheadOffStepBacks || [])).toHaveLength(0)
  })
  it('the tree seam exists and is empty by default (a rule with a null note attaches nothing)', () => {
    expect(Array.isArray(TREE_SEMANTIC_RULES)).toBe(true)
    const rep = { ok: true, dialect: 'pine', outputs: [{ formula: 'x', ast: { type: 'tf', args: [] }, downstream: { ok: true } }], ignored: [] }
    expect(importOutcome(rep, { rules: [{ node: 'tf', name: 'n', note: null }] }).verdict).toBe(OUTCOME.EXACT)
    expect(importOutcome(rep, { rules: [{ node: 'tf', name: 'n', note: 'differs' }] }).verdict).toBe(OUTCOME.DISCLOSED)
  })
})

describe('0I note severity', () => {
  it('thinkScript EMA seed is SEMANTIC and shown as such (was collapsed among skipped lines)', () => {
    const r = inspectSource('plot e = ExpAverage(close, 9);')
    expect(r.outcome.verdict).toBe(OUTCOME.DISCLOSED)
    expect(r.outcome.semantic.length).toBe(1)
    expect(classifyNote({ code: 'thinkscript:note-seed' })).toBe(SEVERITY.SEMANTIC)
  })
  it('PCF XUP at the default distance is a SEMANTIC difference (was recorded only in pcfCoverage)', () => {
    const r = inspectSource('XUP(C, AVGC50)')
    expect(r.outcome.verdict).toBe(OUTCOME.DISCLOSED)
    expect(r.outcome.semantic[0].name).toBe('XUP / XDOWN')
  })
  it('PCF XUP at an explicit distance is spelled out exactly — no note', () => {
    expect(inspectSource('XUP(C, AVGC50, 3)').outcome.semantic).toHaveLength(0)
  })
  it('the declaration line is INFO; an unknown code is never INFO', () => {
    expect(classifyNote({ code: 'pine:declaration' })).toBe(SEVERITY.INFO)
    expect(classifyNote({ code: 'pine:something-new' })).toBe(SEVERITY.PRESENTATION)
  })
})

describe('0J partial success', () => {
  it('PARTIAL — ASKED a study with Average and MACD plots; CLAIMED ok:true, refusal null; DID partial naming P2', () => {
    const r = inspectSource('def a = Average(close, 20);\nplot P1 = a;\nplot P2 = MACD(12, 26, 9).Value;')
    expect(r.ok).toBe(true)
    expect(r.outcome.verdict).toBe(OUTCOME.PARTIAL)
    expect(r.outcome.missing.map((m) => m.name)).toEqual(['P2'])
  })
  it('PARTIAL — the same on the Pine door (ta.barssince refused beside a good plot)', () => {
    const r = inspectSource(H + 'plot(ta.sma(close,20), "Basis")\nplot(ta.barssince(close > open), "BS")')
    expect(r.ok).toBe(true)
    expect(r.outcome.verdict).toBe(OUTCOME.PARTIAL)
  })
})

describe('0K language routing', () => {
  const FOREIGN = {
    'NinjaScript (NinjaTrader)': 'protected override void OnBarUpdate()\n{\n  if (CurrentBar < 20) return;\n  Value[0] = SMA(20)[0];\n}',
    'MetaTrader (MQL4/MQL5)': '#property indicator_chart_window\nint OnInit() { return 0; }\ndouble v = iMA(NULL,0,20,0,MODE_SMA,PRICE_CLOSE,0);',
    'EasyLanguage (TradeStation / MultiCharts)': 'Inputs: Len(20);\nVars: Avg(0);\nAvg = Average(Close, Len);\nPlot1(Avg, "Avg");',
    Python: 'import pandas as pd\ndf["sma"] = df["close"].rolling(20).mean()',
    MetaStock: 'Mov(C, 20, S) > Ref(C, -1)',
    'AmiBroker (AFL)': 'Buy = Cross(MA(C,10),MA(C,20));\nPlot(C, "Close", colorBlack);',
  }
  for (const [name, src] of Object.entries(FOREIGN)) {
    it(`UNSUPPORTED LANGUAGE — ASKED a ${name} paste; CLAIMED a TC2000 character/name refusal; DID name ${name}`, () => {
      const r = inspectSource(src)
      expect(r.outcome.verdict).toBe(OUTCOME.UNSUPPORTED)
      expect(r.foreign).toBe(name)
      expect(r.refusal.guard).toBe('language')
    })
  }
  it('VALUE — ASKED `close > Average(close, 50)`; CLAIMED unknown function "Average"; DID read it as thinkScript', () => {
    const r = inspectSource('close > Average(close, 50)')
    expect(r.ok).toBe(true)
    expect(r.dialect).toBe('thinkscript')
    expect(r.outputs[0].formula).toBe('close > sma(close, 50)')
    expect(r.rerouted).toEqual({ from: 'formula', name: 'Average' })
  })
  it('UNSUPPORTED — ASKED `RSI(14) < 30`; CLAIMED unknown function "RSI"; DID the thinkScript door\'s own refusal (with its offer)', () => {
    const r = inspectSource('RSI(14) < 30')
    expect(r.dialect).toBe('thinkscript')
    expect(r.refusal.guard).toBe('thinkscript:arity')
  })
  it('UNSUPPORTED — ASKED a native formula with lower-case `and`; CLAIMED only "`close` is not a TC2000 name"; DID say it reads like the native syntax', () => {
    const r = inspectSource('close > sma(close,50) and volume > 1000000')
    expect(r.refusal.message).toMatch(/`&&` and `\|\|`/)
  })
  it('a native formula still reads natively; a Pine script is never called foreign', () => {
    expect(inspectSource('close > sma(close, 50)').dialect).toBe('formula')
    expect(inspectSource('//@version=5\nindicator("x")\nBuy = ta.crossover(close, open)\nplot(Buy ? 1 : 0)').foreign).toBeUndefined()
  })
  it('the foreign recogniser stays silent on every committed Pine / thinkScript / PCF fixture', () => {
    const dirs = ['corpus/committed', 'tests/fixtures/pine', 'tests/fixtures/thinkscript', 'tests/fixtures/pine_community']
    let n = 0
    for (const d of dirs) {
      const dir = path.join(REPO, d)
      if (!fs.existsSync(dir)) continue
      for (const f of fs.readdirSync(dir).filter((x) => /\.(pine|ts)$/.test(x))) {
        n += 1
        expect(foreignLanguage(fs.readFileSync(path.join(dir, f), 'utf8')), `${d}/${f}`).toBeNull()
      }
    }
    expect(n).toBeGreaterThan(100)
  })
})

describe('0L exception safety', () => {
  const src = fs.readFileSync(path.join(REPO, 'corpus/committed/smart-money-breakouts-chartprime__ea79c79a67.pine'), 'utf8')
  it('UNSUPPORTED — ASKED smart-money-breakouts-chartprime; CLAIMED nothing (translatePine THREW, box froze); DID a named refusal', () => {
    expect(() => translatePine(src)).not.toThrow()
    expect(() => translatePine(src, { strict: true })).not.toThrow()
    const r = inspectSource(src)
    expect(r.outcome.verdict).toBe(OUTCOME.UNSUPPORTED)
    expect(r.refusal && r.refusal.guard).toBeTruthy()
  })
  it('CONTROLLED ERROR — any translator throw becomes ONE logged error report', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = controlledErrorReport('x', new Error('boom'))
    expect(r.ok).toBe(false)
    expect(r.outcome.verdict).toBe(OUTCOME.ERROR)
    expect(r.refusal.guard).toBe('import:internal-error')
    expect(console.error).toHaveBeenCalled()
  })
  it('inspectSource / inspectPine never throw, whatever they are handed', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    for (const s of [undefined, null, 42, '', '\u0000', src]) {
      expect(() => inspectSource(s)).not.toThrow()
      expect(() => inspectPine(String(s ?? ''))).not.toThrow()
    }
  })
})

describe('0M valuewhen readback', () => {
  it('VALUE — ASKED ta.valuewhen(c, s, 0); CLAIMED "sentence:window … got 0" (builder showed the output failing while the pane drew it); DID read back', () => {
    const ev = evaluateFormula('valuewhenOccurrence(crossOver(close, sma(close, 20)), close, 0)', BUILDER_INPUT_SCOPE)
    expect(ev.ok).toBe(true)
    expect(verdict(H + 'plot(ta.valuewhen(ta.crossover(close, ta.sma(close, 20)), close, 0))')).toBe(OUTCOME.EXACT)
  })
  it('REFUSAL kept — a negative occurrence and a 0 period still refuse at the read-back', () => {
    expect(evaluateFormula('valuewhenOccurrence(close > open, close, -1)', BUILDER_INPUT_SCOPE).ok).toBe(false)
    expect(evaluateFormula('sma(close, 0)', BUILDER_INPUT_SCOPE).ok).toBe(false)
  })
})
