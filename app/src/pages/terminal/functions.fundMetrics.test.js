// FUND (2026-11-21): the code in the registry, its three argument kinds, how both orders parse, the
// write-back, and the words that find it.
//
// args.js keeps its own copy of the metric words the panel model owns (so the panel's code stays out of
// the shell's first-open bytes); this rail pins the copy to its owner, word for word.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, FUND_MAX_METRICS, FUND_MAX_PEERS, FUND_METRIC_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { writeBackCommand } from './panels/commandWriteBack'
import {
  DEFAULT_METRICS, FUND_CODE, FUND_METRIC_ARG_WORDS, MAX_METRICS, MAX_PEERS, fundCommandArgs, parseFundMetric, parseFundMetrics,
  parseFundPeers,
} from './panels/fundMetricsModel'

const run = (tokens) => applyArgs(BY_CODE.FUND.ticker, tokens)

describe('FUND in the registry', () => {
  it('the model names the code; registered once, in the Security group, one stock, three argument kinds', () => {
    expect(FUND_CODE).toBe('FUND')
    expect(FUNCTIONS.filter((f) => f.code === 'FUND')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.FUND.group)
    expect(BY_CODE.FUND.group).toBe('Security')
    expect(BY_CODE.FUND.label).toBe('Company metrics over time (revenue, EPS, margins, cash flow, valuation; point in time from SEC filings)')
    expect(BY_CODE.FUND.ticker).toEqual({ panel: 'FundMetrics', args: [
      { kind: 'fundMetric', prop: 'line' }, { kind: 'fundMetrics', prop: 'metrics' }, { kind: 'fundPeers', prop: 'peers', rest: true },
    ] })
    expect(BY_CODE.FUND.market).toBeUndefined()
    expect(BY_CODE.FUND.ticker.flag).toBeUndefined()             // it says "switched off" itself, in words
    expect(exampleFor(BY_CODE.FUND)).toBe('NVDA FUND')
    expect(variantFor('FUND', true)).toMatchObject({ scope: 'ticker' })
    expect(variantFor('FUND', false)).toEqual({ variant: null, reason: 'needs-ticker' })
    expect(typeof PANEL_IMPORTERS.FundMetrics).toBe('function')
  })

  it('FUND is not a stock in the site\'s universe', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                       // the control: the list is the ticker list
    expect(universe.has('FUND')).toBe(false)
  })

  it('no argument kind takes FUND, and none of FUND\'s kinds takes another code', () => {
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('FUND', { today: '2026-11-21' }) == null || /Name|Query|code/i.test(kind), `${kind} takes FUND`).toBe(true)
    }
    for (const f of FUNCTIONS) {
      for (const kind of ['fundMetric', 'fundMetrics', 'fundPeers']) expect([kind, f.code, ARG_KINDS[kind].parse(f.code)]).toEqual([kind, f.code, null])
    }
  })
})

describe('the arguments match the panel that owns the words', () => {
  it('the copy equals the model, word for word, with the same limits', () => {
    expect(FUND_METRIC_WORDS).toEqual(FUND_METRIC_ARG_WORDS)
    expect([FUND_MAX_METRICS, FUND_MAX_PEERS]).toEqual([MAX_METRICS, MAX_PEERS])
    for (const [word, id] of Object.entries(FUND_METRIC_ARG_WORDS)) {
      expect(ARG_KINDS.fundMetric.parse(word.toLowerCase()), word).toBe(id)
      expect(parseFundMetric(word), word).toBe(id)
      expect(isCode(word), word).toBe(false)                       // `FUND PE` must not read as a code on a ticker
    }
    for (const tok of ['REV+EPS', 'rev+', 'REV+REV', 'PE+NOPE', 'REV', Object.keys(FUND_METRIC_ARG_WORDS).slice(0, 13).join('+')]) {
      expect([tok, ARG_KINDS.fundMetrics.parse(tok)]).toEqual([tok, parseFundMetrics(tok)])
    }
    for (const tok of ['AMD', 'AMD AVGO', '$GP', 'GP', 'PE', '$PE', 'A B C D', 'AMD AMD', 'BRK.B', '123']) {
      expect([tok, ARG_KINDS.fundPeers.parse(tok)]).toEqual([tok, parseFundPeers(tok)])
    }
    for (const no of ['toString', 'constructor', '', 'NOPE']) expect(ARG_KINDS.fundMetric.parse(no), no).toBeNull()
  })

  it('the registry applies each word to the prop the panel reads, and says what it did not take', () => {
    expect(run(['PE']).props).toEqual({ line: 'pe_ttm' })
    expect(run(['rev+eps+roe']).props).toEqual({ metrics: ['revenue_ttm', 'eps_ttm', 'roe'] })
    expect(run(['AMD', 'PE', 'AVGO']).props).toEqual({ line: 'pe_ttm', peers: ['AMD', 'AVGO'] })
    expect(run(['AMD', 'PE', 'AVGO']).applied).toEqual(['line of PE', 'compared with AMD, AVGO'])
    expect(run(['PE', 'REV']).ignored).toEqual(['REV'])           // one line: the second metric word is said, never a ticker
    expect(run(['AMD', 'AVGO', 'INTC', 'TSMX']).ignored).toEqual(['AMD', 'AVGO', 'INTC', 'TSMX'])   // four: all said, none dropped quietly
    expect(run(['GP']).ignored).toEqual(['GP'])                   // a code needs $ to be a ticker
    expect(run(['$GP']).props).toEqual({ peers: ['GP'] })
    expect(argsTakes()).toEqual(['a metric to draw as a line (PE, REV, EPS, NETM, FCFM, ROE)', 'the rows, metric words joined by + (REV+EPS+PE)',
      'up to three tickers to compare (NVDA FUND AMD AVGO)'])
  })

  it('what the panel writes back is read as the same choice; the default is the bare command', () => {
    for (const choice of [
      {}, { peers: ['AMD'] }, { peers: ['AMD', 'GP', 'PE'] }, { metrics: ['revenue_ttm', 'roe'] }, { metrics: ['roe'] },
      { line: 'beta_1y_spy' }, { peers: ['AMD', 'AVGO'], metrics: ['cash', 'pe_ttm'], line: 'pe_ttm' },
    ]) {
      const tokens = fundCommandArgs(choice)
      const props = run(tokens).props
      expect([choice, run(tokens).ignored]).toEqual([choice, []])
      expect(props.peers || []).toEqual(choice.peers || [])
      expect(props.metrics || DEFAULT_METRICS).toEqual(choice.metrics || DEFAULT_METRICS)
      expect(props.line || null).toEqual(choice.line || null)
      expect(writeBackCommand('FUND', tokens, 'nvda')).toBe(['NVDA', 'FUND', ...tokens].join(' '))
      expect(tokens.length).toBeLessThanOrEqual(8)                // a saved panel keeps at most 8 arguments (boardModel)
    }
    expect(writeBackCommand('FUND', ['PE'])).toBeNull()            // a per-stock code: no command without its stock
  })
})

function argsTakes() {
  return applyArgs(BY_CODE.FUND.ticker, []).takes
}

describe('FUND parses', () => {
  it('both orders keep the first ticker as the stock: the compared tickers are one REST argument', () => {
    expect(parseCommand('NVDA FUND')).toMatchObject({ ok: true, type: 'function', code: 'FUND', sym: 'NVDA', args: [] })
    expect(parseCommand('NVDA FUND AMD AVGO')).toMatchObject({ ok: true, code: 'FUND', sym: 'NVDA', args: ['AMD', 'AVGO'] })
    expect(parseCommand('FUND NVDA AMD AVGO')).toMatchObject({ ok: true, code: 'FUND', sym: 'NVDA', args: ['AMD', 'AVGO'] })
    expect(parseCommand('fund nvda')).toMatchObject({ ok: true, code: 'FUND', sym: 'NVDA', args: [] })
    expect(parseCommand('FUND')).toMatchObject({ ok: true, type: 'function', code: 'FUND', sym: null, args: [] })
  })

  it('a metric word after the bare code is the metric (the linked stock follows), and $ makes it a ticker', () => {
    expect(parseCommand('FUND PE')).toMatchObject({ ok: true, code: 'FUND', sym: null, args: ['PE'], argNotTicker: 'PE' })
    expect(parseCommand('NVDA FUND PE')).toMatchObject({ ok: true, code: 'FUND', sym: 'NVDA', args: ['PE'] })
    expect(parseCommand('NVDA FUND REV+EPS+PE AMD')).toMatchObject({ ok: true, code: 'FUND', sym: 'NVDA', args: ['REV+EPS+PE', 'AMD'] })
    expect(parseCommand('FUND $PE')).toMatchObject({ ok: true, code: 'FUND', sym: 'PE' })
  })
})

describe('a plain word finds the panel', () => {
  it('its words find it first', () => {
    for (const w of ['fundamentals history', 'metrics', 'revenue history', 'eps history', 'margins', 'fcf', 'roe',
      'pe history', 'valuation history', 'financial history']) {
      expect([w, codesForWords(w)[0]]).toEqual([w, 'FUND'])
    }
    expect(BY_CODE.FUND.keywords).toEqual(['fundamentals history', 'metrics', 'revenue history', 'eps history', 'margins', 'fcf',
      'roe', 'pe history', 'valuation history', 'financial history'])
    // no keyword whose single words are generic: "free cash flow" made "free" and "cash" alone find FUND
    expect(codesForWords('free')).not.toContain('FUND')
  })

  it('the words other functions answer to stay theirs', () => {
    expect(codesForWords('fundamentals')[0]).toBe('FA')
    expect(codesForWords('financials')[0]).toBe('FA')
    expect(codesForWords('revenue')[0]).toBe('FA')
    expect(codesForWords('eps')[0]).toBe('EE')
    expect(codesForWords('valuation')[0]).toBe('PEER')
    expect(codesForWords('rating')[0]).toBe('RTG')
    expect(codesForWords('compare')[0]).toBe('CMP')
    expect(codesForWords('overview')[0]).toBe('DES')
    // a single word of "free cash flow" never puts FUND ahead of the flow functions
    expect(codesForWords('flow')[0]).not.toBe('FUND')
    expect(codesForWords('history').slice(0, 3)).not.toContain('FUND')
  })
})
