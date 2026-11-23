// ERNSC (2026-11-22): the code in the registry, its two argument kinds, how they parse, the write-back, and the words
// that find it.
//
// args.js keeps its own copy of the words the panel model owns (so the panel's code stays out of the shell's
// first-open bytes); this rail pins the copy to its owner, word for word, and checks no word collides with a function
// code, a stock the site follows, COT's market words or another function's reading.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, EEHSC_METRIC_WORDS, ERNSC_METRIC_WORDS, ERNSC_SEASON_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import { isTickerCollision } from './grammar'
import parseCommand from './parseCommand'
import { rankCandidates } from './ranking'
import { PANEL_IMPORTERS } from './panels'
import { writeBackCommand } from './panels/commandWriteBack'
import { COT_WORDS } from './panels/cotModel'
import {
  DEFAULT_ERNSC_METRIC, DEFAULT_ERNSC_SEASON, ERNSC_CODE, ERNSC_METRICS, ERNSC_METRIC_ARG_WORDS, ERNSC_SEASONS, ERNSC_SEASON_ARG_WORDS,
  ernscCommandArgs,
} from './panels/sectorEarningsModel'
import { FIXTURE_TICKERS } from './panels/__fixtures__/sectorEarningsFixture'

const run = (tokens) => applyArgs(BY_CODE.ERNSC.market, tokens)
const universe = () => new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))

describe('ERNSC in the registry', () => {
  it('the model names the code; registered once, in the Market group, market-wide, no switch, two argument kinds', () => {
    expect(ERNSC_CODE).toBe('ERNSC')
    expect(FUNCTIONS.filter((f) => f.code === 'ERNSC')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.ERNSC.group)
    expect(BY_CODE.ERNSC.group).toBe('Market')
    expect(BY_CODE.ERNSC.label).toBe('Earnings season by sector (beat rates, surprises and reactions)')
    expect(BY_CODE.ERNSC.market).toEqual({ panel: 'SectorEarnings',
      args: [{ kind: 'ernscSeason', prop: 'season' }, { kind: 'ernscMetric', prop: 'metric' }] })
    expect(BY_CODE.ERNSC.ticker).toBeUndefined()
    expect(exampleFor(BY_CODE.ERNSC)).toBe('ERNSC')
    expect(variantFor('ERNSC', false)).toMatchObject({ scope: 'market' })
    expect(typeof PANEL_IMPORTERS.SectorEarnings).toBe('function')
    // ERNS, one day's reporters, is unchanged
    expect(BY_CODE.ERNS.market.panel).toBe('EarningsSeason')
  })

  it('no word a member types reaches ERNSC by close spelling, and none loses its own code to it', () => {
    expect(BY_CODE.ERNSC.code).toMatch(/^[A-Z]{2,5}$/)
    // ("beat" and "surprise" find it on purpose: see the last test)
    const words = ['earnings', 'erns', 'seas', 'season', 'seasons', 'sector', 'sectors', 'scores', 'scanner', 'peers', 'news',
      'reaction', 'reactions', 'misses', 'revenue', 'returns', 'insider', 'movers', 'sentiment', 'regime', 'theme', 'watchlist',
      'rating', 'ratings', 'screens']
    for (const w of words) {
      const first = rankCandidates(w, { limit: 6 }).filter((r) => r.kind === 'function')[0]
      const rank = (rankCandidates(w, { limit: 10 }).find((r) => r.value === 'ERNSC') || {}).rank
      expect([w, first?.value === 'ERNSC', rank === 'fuzzy']).toEqual([w, false, false])
    }
    // DERIVED: every word of every other function's keywords and label, and every other code. Within two letters of ERNSC
    // are only ERN and ERNS (it starts with them: they keep their exact match) and EEHSC (its exact match wins).
    const near = new Set()
    for (const f of FUNCTIONS) {
      if (f.code === 'ERNSC') continue
      const ws = [f.code, ...(f.keywords || []).flatMap((k) => k.split(/[^A-Za-z0-9]+/)), ...String(f.label).split(/[^A-Za-z0-9]+/)]
      for (const w of ws.filter((x) => x && x.length >= 2)) {
        const hit = rankCandidates(w, { limit: 40 }).find((r) => r.value === 'ERNSC')
        if (hit && hit.rank === 'fuzzy') near.add(w.toUpperCase())
      }
    }
    expect([...near].sort()).toEqual(['EEHSC'])
    expect(rankCandidates('EEHSC', { limit: 6 })[0]).toMatchObject({ kind: 'function', value: 'EEHSC' })
    // two English words are within two letters, as of any five-letter code; no function answers either, and neither finds
    // ERNSC first
    for (const w of ['earns', 'ernst']) expect([w, rankCandidates(w, { limit: 6 }).filter((r) => r.kind === 'function')[0]?.value === 'ERNSC']).toEqual([w, false])
    // its own spelling finds it, and ERN and ERNS keep theirs
    expect(rankCandidates('ERNSC', { limit: 6 })[0]).toMatchObject({ kind: 'function', value: 'ERNSC' })
    expect(rankCandidates('ERNS', { limit: 6 })[0]).toMatchObject({ kind: 'function', value: 'ERNS' })
    expect(rankCandidates('ERN', { limit: 6 })[0]).toMatchObject({ kind: 'function', value: 'ERN' })
  })

  it('ERNSC and the fixtures\' tickers are not stocks the site follows', () => {
    const u = universe()
    expect(u.size).toBeGreaterThan(3000)
    expect(u.has('NVDA')).toBe(true)                               // the control: the list is the ticker list
    expect(u.has('ERNSC')).toBe(false)
    expect(isTickerCollision('ERNSC')).toBe(false)
    expect(FIXTURE_TICKERS.length).toBeGreaterThan(20)
    for (const t of FIXTURE_TICKERS) expect([t, u.has(t)]).toEqual([t, false])
  })

  it('no argument kind takes ERNSC, and neither of ERNSC\'s kinds takes a function code', () => {
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('ERNSC', { today: '2026-11-22' }) == null || /Name|Query|code|cotMarket/i.test(kind), `${kind} takes ERNSC`).toBe(true)
    }
    for (const f of FUNCTIONS) {
      for (const kind of ['ernscSeason', 'ernscMetric']) expect([kind, f.code, ARG_KINDS[kind].parse(f.code)]).toEqual([kind, f.code, null])
    }
  })
})

describe('the arguments match the panel that owns the words', () => {
  it('the copies equal the model, word for word; no word is a code, a stock, a COT market, or in both maps', () => {
    expect(ERNSC_SEASON_WORDS).toEqual(ERNSC_SEASON_ARG_WORDS)
    expect(ERNSC_METRIC_WORDS).toEqual(ERNSC_METRIC_ARG_WORDS)
    // the measure words are EEHSC's, with the same meaning, so a member types the same word on both
    expect(ERNSC_METRIC_WORDS).toEqual(EEHSC_METRIC_WORDS)
    const u = universe()
    for (const w of [...Object.keys(ERNSC_SEASON_WORDS), ...Object.keys(ERNSC_METRIC_WORDS)]) {
      expect([w, isCode(w), u.has(w), Object.prototype.hasOwnProperty.call(COT_WORDS, w)]).toEqual([w, false, false, false])
      expect([w, ARG_KINDS.ernscSeason.parse(w) != null && ARG_KINDS.ernscMetric.parse(w) != null]).toEqual([w, false])
    }
    // a season word is no other kind's word (the measure words are EEHSC's and FUND's on purpose)
    for (const w of Object.keys(ERNSC_SEASON_WORDS)) {
      for (const [kind, spec] of Object.entries(ARG_KINDS)) {
        if (kind === 'ernscSeason' || /symbol|Name|Query|code|cotMarket|fundPeers/i.test(kind)) continue
        expect([w, kind, spec.parse(w, { today: '2026-11-22' }) == null]).toEqual([w, kind, true])
      }
    }
    for (const v of Object.values(ERNSC_SEASON_WORDS)) expect(v in ERNSC_SEASONS).toBe(true)
    for (const v of Object.values(ERNSC_METRIC_WORDS)) expect(v in ERNSC_METRICS).toBe(true)
    for (const no of ['toString', 'constructor', '', 'NOPE', 'NOW', 'CURRENT', 'PREV', 'PE']) {
      expect([no, ARG_KINDS.ernscSeason.parse(no), ARG_KINDS.ernscMetric.parse(no)]).toEqual([no, null, null])
    }
  })

  it('the registry applies each word to the prop the panel reads, in either order, and says what it did not take', () => {
    expect(run(['YEARAGO']).props).toEqual({ season: 'year_ago' })
    expect(run(['revenue', 'prior']).props).toEqual({ metric: 'revenue', season: 'previous' })
    expect(run(['LASTYEAR', 'EPS']).applied).toEqual(['the same season a year earlier', 'EPS against the consensus'])
    expect(run(['SALES']).applied).toEqual(['revenue against the consensus'])
    expect(run(['NVDA']).ignored).toEqual(['NVDA'])
    expect(run(['PRIOR', 'YEARAGO']).ignored).toEqual(['YEARAGO'])
    expect(applyArgs(BY_CODE.ERNSC.market, []).takes).toEqual(['a season (PRIOR or YEARAGO)', 'a measure (EPS or REVENUE)'])
  })

  it('what the panel writes back is read as the same choice; the default is the bare command', () => {
    for (const season of Object.keys(ERNSC_SEASONS)) {
      for (const metric of Object.keys(ERNSC_METRICS)) {
        const tokens = ernscCommandArgs({ season, metric })
        const r = run(tokens)
        expect([season, metric, r.ignored]).toEqual([season, metric, []])
        expect([r.props.season || DEFAULT_ERNSC_SEASON, r.props.metric || DEFAULT_ERNSC_METRIC]).toEqual([season, metric])
        expect(writeBackCommand('ERNSC', tokens)).toBe(['ERNSC', ...tokens].join(' '))
      }
    }
    expect(ernscCommandArgs({})).toEqual([])
  })
})

describe('ERNSC parses', () => {
  it('the code alone, with its words in either order, and lower case', () => {
    expect(parseCommand('ERNSC')).toMatchObject({ ok: true, type: 'function', code: 'ERNSC', sym: null, args: [] })
    expect(parseCommand('ERNSC YEARAGO REVENUE')).toMatchObject({ ok: true, code: 'ERNSC', sym: null, args: ['YEARAGO', 'REVENUE'] })
    expect(parseCommand('ernsc eps prior')).toMatchObject({ ok: true, code: 'ERNSC', sym: null, args: ['EPS', 'PRIOR'] })
    expect(parseCommand('ERNSC').collision).toBeUndefined()
    // ERNS is untouched: one day's reporters
    expect(parseCommand('ERNS TONIGHT')).toMatchObject({ ok: true, code: 'ERNS' })
  })
})

describe('a plain word finds the panel', () => {
  it('its words find it first', () => {
    const words = ['earnings by sector', 'sector earnings', 'beat rate', 'beat rates', 'earnings beat rate',
      'earnings season by sector', 'season by sector', 'which sector is beating']
    expect(BY_CODE.ERNSC.keywords).toEqual(words)
    for (const w of words) expect([w, codesForWords(w)[0]]).toEqual([w, 'ERNSC'])
  })

  it('the words other functions answer to stay theirs; a generic single word does not find ERNSC first', () => {
    expect(codesForWords('earnings season')[0]).toBe('ERNS')
    expect(codesForWords('earnings scoreboard')[0]).toBe('EMOV')
    expect(codesForWords('earnings reaction')[0]).toBe('ERX')
    expect(codesForWords('earnings')[0]).toBe('CAL')
    expect(codesForWords('sector breadth')[0]).toBe('GRPS')
    expect(codesForWords('revisions by sector')[0]).toBe('EEHSC')
    expect(codesForWords('sector performance')[0]).toBe('SCTR')
    expect(codesForWords('earnings seas')[0]).toBe('ERNS')
    for (const w of ['sector', 'sectors', 'earnings', 'season', 'seasons', 'reaction', 'reactions', 'eps', 'revenue', 'consensus', 'misses']) {
      expect([w, codesForWords(w)[0] === 'ERNSC']).toEqual([w, false])
    }
    // "beat" and "surprise" find ERNSC on purpose (a keyword and its label): no other function's keywords or label hold
    // either word, so it takes them from no one
    for (const w of ['beat', 'surprise']) {
      expect([w, codesForWords(w)]).toEqual([w, ['ERNSC']])
      expect([w, FUNCTIONS.filter((f) => f.code !== 'ERNSC' && [...(f.keywords || []), f.label].some((k) => new RegExp(`\\b${w}`, 'i').test(k))).map((f) => f.code)]).toEqual([w, []])
    }
  })
})
