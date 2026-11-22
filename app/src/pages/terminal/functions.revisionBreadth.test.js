// EEHSC (2026-11-21): the code in the registry, its two argument kinds, how they parse, the write-back, and the words
// that find it.
//
// args.js keeps its own copy of the words the panel model owns (so the panel's code stays out of the shell's
// first-open bytes); this rail pins the copy to its owner, word for word, and checks no word collides with a function
// code, a stock the site follows, COT's market words or another function's reading.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, EEHSC_METRIC_WORDS, EEHSC_WINDOW_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { rankCandidates } from './ranking'
import { PANEL_IMPORTERS } from './panels'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import {
  DEFAULT_EEHSC_METRIC, DEFAULT_EEHSC_WINDOW, EEHSC_CODE, EEHSC_METRICS, EEHSC_METRIC_ARG_WORDS, EEHSC_WINDOWS, EEHSC_WINDOW_ARG_WORDS, eehscCommandArgs,
} from './panels/revisionBreadthModel'
import { FIXTURE_TICKERS } from './panels/__fixtures__/revisionBreadthFixture'

const run = (tokens) => applyArgs(BY_CODE.EEHSC.market, tokens)
const universe = () => new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))

describe('EEHSC in the registry', () => {
  it('the model names the code; registered once, in the Market group, market-wide, behind EEH\'s switch, two argument kinds', () => {
    expect(EEHSC_CODE).toBe('EEHSC')
    expect(FUNCTIONS.filter((f) => f.code === 'EEHSC')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.EEHSC.group)
    expect(BY_CODE.EEHSC.group).toBe('Market')
    expect(BY_CODE.EEHSC.label).toBe('Estimate revisions by sector')
    expect(BY_CODE.EEHSC.market).toEqual({ panel: 'RevisionBreadth', flag: 'estimateHistoryEnabled',
      args: [{ kind: 'eehscWindow', prop: 'window' }, { kind: 'eehscMetric', prop: 'metric' }] })
    expect(BY_CODE.EEHSC.ticker).toBeUndefined()
    // the switch is EEH's own: the route answers 404 while ESTIMATE_HISTORY_ENABLED is off, and the shell never shows it then
    expect(BY_CODE.EEHSC.market.flag).toBe(BY_CODE.EEH.ticker.flag)
    expect(exampleFor(BY_CODE.EEHSC)).toBe('EEHSC')
    expect(variantFor('EEHSC', false)).toMatchObject({ scope: 'market' })
    expect(typeof PANEL_IMPORTERS.RevisionBreadth).toBe('function')
    // EEH, one stock's history, is unchanged
    expect(BY_CODE.EEH.ticker).toEqual({ panel: 'EstimateHistory', section: 'estimate-history', flag: 'estimateHistoryEnabled' })
    expect(BY_CODE.EEH.market).toBeUndefined()
  })

  it('no word a member types reaches EEHSC by close spelling, and none loses its own code to it', () => {
    // a four-letter code did: EEHS was within two letters of "peers" and came up before PEER in the command line
    expect(BY_CODE.EEHSC.code).toMatch(/^[A-Z]{2,5}$/)
    const words = ['peers', 'news', 'seas', 'sector', 'sectors', 'estimate', 'estimates', 'revisions', 'revenue', 'breadth', 'breakout',
      'insider', 'sentiment', 'regime', 'scatter', 'theme', 'movers', 'watchlist', 'correlation', 'checklist', 'rating', 'ratings']
    for (const w of words) {
      const first = rankCandidates(w, { limit: 6 }).filter((r) => r.kind === 'function')[0]
      const rank = (rankCandidates(w, { limit: 10 }).find((r) => r.value === 'EEHSC') || {}).rank
      expect([w, first?.value === 'EEHSC', rank === 'fuzzy' || rank === 'prefix']).toEqual([w, false, false])
    }
    expect(rankCandidates('peers', { limit: 6 }).filter((r) => r.kind === 'function')[0].value).toBe('PEER')
    // its own prefix still finds it
    expect(rankCandidates('EEHS', { limit: 6 })[0]).toMatchObject({ kind: 'function', value: 'EEHSC', rank: 'prefix' })
    expect(rankCandidates('EEH', { limit: 6 }).slice(0, 2).map((r) => r.value)).toEqual(['EEH', 'EEHSC'])
  })

  it('EEHSC and the fixtures\' tickers are not stocks the site follows', () => {
    const u = universe()
    expect(u.size).toBeGreaterThan(3000)
    expect(u.has('NVDA')).toBe(true)                               // the control: the list is the ticker list
    expect(u.has('EEHSC')).toBe(false)
    expect(isTickerCollision('EEHSC')).toBe(false)
    expect(FIXTURE_TICKERS.length).toBeGreaterThan(20)
    for (const t of FIXTURE_TICKERS) expect([t, u.has(t)]).toEqual([t, false])
  })

  it('no argument kind takes EEHSC, and neither of EEHSC\'s kinds takes a function code', () => {
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('EEHSC', { today: '2026-11-21' }) == null || /Name|Query|code|cotMarket/i.test(kind), `${kind} takes EEHSC`).toBe(true)
    }
    for (const f of FUNCTIONS) {
      for (const kind of ['eehscWindow', 'eehscMetric']) expect([kind, f.code, ARG_KINDS[kind].parse(f.code)]).toEqual([kind, f.code, null])
    }
  })
})

describe('the arguments match the panel that owns the words', () => {
  it('the copies equal the model, word for word; no word is a code, a stock, a COT market, or in both maps', () => {
    expect(EEHSC_WINDOW_WORDS).toEqual(EEHSC_WINDOW_ARG_WORDS)
    expect(EEHSC_METRIC_WORDS).toEqual(EEHSC_METRIC_ARG_WORDS)
    const u = universe()
    for (const w of [...Object.keys(EEHSC_WINDOW_WORDS), ...Object.keys(EEHSC_METRIC_WORDS)]) {
      expect([w, isCode(w), u.has(w), Object.prototype.hasOwnProperty.call(COT_WORDS, w)]).toEqual([w, false, false, false])
      expect([w, ARG_KINDS.eehscWindow.parse(w) != null && ARG_KINDS.eehscMetric.parse(w) != null]).toEqual([w, false])
    }
    for (const v of Object.values(EEHSC_WINDOW_WORDS)) expect(v in EEHSC_WINDOWS).toBe(true)
    for (const v of Object.values(EEHSC_METRIC_WORDS)) expect(v in EEHSC_METRICS).toBe(true)
    for (const no of ['toString', 'constructor', '', 'NOPE', '14D', '7', 'PE']) {
      expect([no, ARG_KINDS.eehscWindow.parse(no), ARG_KINDS.eehscMetric.parse(no)]).toEqual([no, null, null])
    }
  })

  it('the registry applies each word to the prop the panel reads, in either order, and says what it did not take', () => {
    expect(run(['7D']).props).toEqual({ window: 7 })
    expect(run(['revenue', '1w']).props).toEqual({ metric: 'revenue', window: 7 })
    expect(run(['30D', 'EPS']).applied).toEqual(['the change over 30 days', 'EPS estimates'])
    expect(run(['SALES']).applied).toEqual(['revenue estimates'])
    expect(run(['NVDA']).ignored).toEqual(['NVDA'])
    expect(run(['7D', '30D']).ignored).toEqual(['30D'])
    expect(applyArgs(BY_CODE.EEHSC.market, []).takes).toEqual(['a window (7D or 30D)', 'an estimate (EPS or REVENUE)'])
  })

  it('what the panel writes back is read as the same choice; the default is the bare command', () => {
    for (const window of Object.keys(EEHSC_WINDOWS).map(Number)) {
      for (const metric of Object.keys(EEHSC_METRICS)) {
        const tokens = eehscCommandArgs({ window, metric })
        const r = run(tokens)
        expect([window, metric, r.ignored]).toEqual([window, metric, []])
        expect([r.props.window || DEFAULT_EEHSC_WINDOW, r.props.metric || DEFAULT_EEHSC_METRIC]).toEqual([window, metric])
        expect(writeBackCommand('EEHSC', tokens)).toBe(['EEHSC', ...tokens].join(' '))
      }
    }
    expect(eehscCommandArgs({})).toEqual([])
  })
})

describe('EEHSC parses', () => {
  it('the code alone, with its words in either order, and lower case', () => {
    expect(parseCommand('EEHSC')).toMatchObject({ ok: true, type: 'function', code: 'EEHSC', sym: null, args: [] })
    expect(parseCommand('EEHSC 7D REVENUE')).toMatchObject({ ok: true, code: 'EEHSC', sym: null, args: ['7D', 'REVENUE'] })
    expect(parseCommand('eehsc eps 1m')).toMatchObject({ ok: true, code: 'EEHSC', sym: null, args: ['EPS', '1M'] })
    expect(parseCommand('EEHSC').collision).toBeUndefined()
    // EEH is untouched: one stock's history
    expect(parseCommand('NVDA EEH')).toMatchObject({ ok: true, code: 'EEH', sym: 'NVDA' })
  })
})

describe('a plain word finds the panel', () => {
  it('its words find it first', () => {
    const words = ['revision breadth', 'estimate revisions by sector', 'revisions by sector', 'sector revisions',
      'earnings revisions by sector', 'estimate breadth']
    expect(BY_CODE.EEHSC.keywords).toEqual(words)
    for (const w of words) expect([w, codesForWords(w)[0]]).toEqual([w, 'EEHSC'])
  })

  it('the words other functions answer to stay theirs; a generic single word does not find EEHSC first', () => {
    expect(codesForWords('revisions')[0]).toBe('EEH')
    expect(codesForWords('estimate revisions')[0]).toBe('EEH')
    expect(codesForWords('breadth')[0]).toBe('BRD')
    expect(codesForWords('sector breadth')[0]).toBe('GRPS')
    expect(codesForWords('sector performance')[0]).toBe('SCTR')
    for (const w of ['sector', 'sectors', 'estimate', 'estimates', 'earnings', 'revision', 'analysts', 'eps', 'revenue', 'raised', 'cut']) {
      expect([w, codesForWords(w)[0] === 'EEHSC']).toEqual([w, false])
    }
  })
})
