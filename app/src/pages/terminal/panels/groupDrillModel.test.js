// GRP, the pure half: the query a member types, the ONE resolver and its order, the lists read
// together, the join of a group's stocks with their change, RS rank and flow signal, and the sort.
// The fixtures are the routes' real shapes (api/services/scan_period.py get_period_change_groups
// and _assemble, api/services/rs_ranking.py, api/confluence_screen.py), with made-up tickers.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DEFAULT_GROUP_SORT, GROUP_DRILL_CODE, GROUP_KINDS, GROUP_KIND_ARG_WORDS, GROUP_KIND_ORDER, GROUP_RS_URL, GROUP_SUGGESTIONS, SECTOR_FUNDS,
  combineGroupLists, flowBoard, flowWords, groupDrillCommand, groupDrillCommandArgs, groupDrillRows, groupKey, groupKindsToRead,
  groupSortWords, normGroupRange, normGroupSort, parseGroupQuery, resolveGroup, rsRanks, sectorFundForName, sectorFundOf, sortGroupRows,
  taxonomyTheme,
} from './groupDrillModel'
import { PERIOD_RANGES, PERIOD_UNIT_ARG_WORDS, periodGroupsRead, periodRead } from './periodChangeModel'
import { confluenceRead } from './confluenceModel'
import { RS_URL } from './RsLeadersPanel'
import parseCommand from '../parseCommand'
import { applyArgs } from '../args'
import { BY_CODE } from '../functions'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO = path.resolve(HERE, '..', '..', '..', '..', '..')
const py = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8')
/** The `"key": "value"` pairs of one Python dict literal, found by the line that opens it. */
function pyDict(text, opener) {
  const at = text.indexOf(opener)
  expect(at, opener).toBeGreaterThan(-1)
  const body = text.slice(at, text.indexOf('}', at))
  return [...body.matchAll(/"([^"]+)":\s*"([^"]+)"/g)].map((m) => [m[1], m[2]])
}

const groupsBody = (group, results) => ({ status: 'ok', group, results, count: results.length, start: 20251231, end: 20261117, as_of: '2026-11-18T09:41:00-05:00' })
const SECTORS = periodGroupsRead(groupsBody('sector', [
  { name: 'Technology', period_change: 38.3, count: 3, members: ['AAA', 'BBB', 'CCC'] },
  { name: 'Consumer Cyclical', period_change: 4.4, count: 2, members: ['DDD', 'EEE'] },
  { name: 'Consumer Defensive', period_change: 1.1, count: 1, members: ['FFF'] },
  { name: 'Financial Services', period_change: -2.0, count: 1, members: ['GGG'] },
]), 'sector').rows
const INDUSTRIES = periodGroupsRead(groupsBody('industry', [
  { name: 'Semiconductors', period_change: 51.0, count: 2, members: ['AAA', 'BBB'] },
  { name: 'Semiconductor Equipment & Materials', period_change: 20.0, count: 1, members: ['CCC'] },
  { name: 'Aerospace & Defense', period_change: 12.0, count: 1, members: ['HHH'] },
  { name: 'Oil & Gas E&P', period_change: -8.0, count: 1, members: ['III'] },
  { name: 'Drug Manufacturers - Specialty & Generic', period_change: 2.0, count: 1, members: ['JJJ'] },
]), 'industry').rows
const THEMES = periodGroupsRead(groupsBody('theme', [
  { name: 'AI / GPU Chips', period_change: 80.0, count: 2, members: ['AAA', 'KKK'] },
  { name: 'Semiconductors', period_change: 44.0, count: 3, members: ['AAA', 'BBB', 'KKK'] },
  { name: 'Gold Miners', period_change: 9.0, count: 1, members: ['LLL'] },
]), 'theme').rows
const LISTS = { sector: SECTORS, industry: INDUSTRIES, theme: THEMES }
const ask = (raw, lists = LISTS) => resolveGroup(lists, parseGroupQuery(raw))

describe('GRP constants', () => {
  it('the code, the three kinds in the resolver\'s order, and the RS route RSL reads', () => {
    expect(GROUP_DRILL_CODE).toBe('GRP')
    expect(GROUP_KIND_ORDER).toEqual(['sector', 'industry', 'theme'])
    expect(Object.keys(GROUP_KINDS)).toEqual(GROUP_KIND_ORDER)
    expect(GROUP_RS_URL).toBe(RS_URL)
    // the kind words are PCHG's own words for the same three kinds, so the two panels read alike
    for (const [word, kind] of Object.entries(GROUP_KIND_ARG_WORDS)) expect(PERIOD_UNIT_ARG_WORDS[word], word).toBe(kind)
    for (const k of GROUP_KIND_ORDER) expect(GROUP_KIND_ARG_WORDS[GROUP_KINDS[k].token]).toBe(k)
  })

  it('the sector funds are the server\'s eleven, under every name the server gives each sector', () => {
    const strength = pyDict(py('api/services/sector_strength.py'), 'SECTOR_ETFS: dict[str, str] = {')
    expect(strength).toHaveLength(11)
    expect(SECTOR_FUNDS.map((f) => f.fund).sort()).toEqual(strength.map(([, fund]) => fund).sort())
    // SCTR's name for a fund is the entry's `name`
    for (const [name, fund] of strength) expect(SECTOR_FUNDS.find((f) => f.fund === fund).name, fund).toBe(name)
    // the company details' spellings (what the ranking's sectors are called) resolve to the same fund
    const details = pyDict(py('api/services/rs_benchmarks.py'), 'SECTOR_ETF: Dict[str, str] = {')
    expect(details).toHaveLength(11)
    for (const [name, fund] of details) expect(sectorFundForName(name)?.fund, name).toBe(fund)
    const aliases = pyDict(py('api/services/terminal_grammar.py'), '_SECTOR_ALIASES = {')
    expect(aliases.length).toBeGreaterThan(4)
    for (const [alias, name] of aliases) expect(sectorFundForName(alias)?.name, alias).toBe(name)
    // a fund is found by its ticker, however it is typed; a theme's reference fund is not a sector fund
    expect(sectorFundOf('xlk')).toMatchObject({ fund: 'XLK', name: 'Technology' })
    expect(sectorFundOf('$XLRE')?.name).toBe('Real Estate')
    for (const no of ['SMH', 'SPY', '', null, 'TECHNOLOGY']) expect(sectorFundOf(no), String(no)).toBeNull()
    // no name sits under two funds
    const fundsOf = new Map()
    for (const f of SECTOR_FUNDS) for (const n of f.names) fundsOf.set(groupKey(n), new Set([...(fundsOf.get(groupKey(n)) || []), f.fund]))
    expect([...fundsOf].filter(([, funds]) => funds.size > 1)).toEqual([])
  })
})

describe('GRP: what was typed', () => {
  it('a name is compared without case, spacing or punctuation, and & is "and"', () => {
    expect(groupKey('AI / GPU Chips')).toBe('aigpuchips')
    expect(groupKey('AI_GPU_CHIPS')).toBe(groupKey('ai / gpu chips'))
    expect(groupKey('Aerospace & Defense')).toBe(groupKey('AEROSPACE AND DEFENSE'))
    expect(groupKey('Health Care')).toBe(groupKey('Healthcare'))
    expect(groupKey(null)).toBe('')
  })

  it('a sector fund is its sector; a leading kind word pins the kind and is not part of the name', () => {
    expect(parseGroupQuery('XLK')).toEqual({ kind: 'sector', text: 'XLK', fund: 'XLK' })
    expect(parseGroupQuery('$xlk')).toEqual({ kind: 'sector', text: 'XLK', fund: 'XLK' })
    expect(parseGroupQuery('SECTOR XLRE')).toEqual({ kind: 'sector', text: 'XLRE', fund: 'XLRE' })
    expect(parseGroupQuery('THEME AI / GPU CHIPS')).toEqual({ kind: 'theme', text: 'AI / GPU CHIPS', fund: null })
    expect(parseGroupQuery('industries Aerospace & Defense')).toEqual({ kind: 'industry', text: 'AEROSPACE & DEFENSE', fund: null })
    expect(parseGroupQuery('SEMICONDUCTORS')).toEqual({ kind: null, text: 'SEMICONDUCTORS', fund: null })
    // a fund ticker under another kind, or inside a longer name, is just a word
    expect(parseGroupQuery('THEME XLK')).toEqual({ kind: 'theme', text: 'XLK', fund: null })
    expect(parseGroupQuery('XLK LEADERS')).toEqual({ kind: null, text: 'XLK LEADERS', fund: null })
    // commas and quotes do not survive the command line, so they are dropped here too
    expect(parseGroupQuery('"Oil, Gas & Fuels"').text).toBe('OIL GAS & FUELS')
  })

  it('nothing typed, or a kind word alone, names no group', () => {
    expect(parseGroupQuery(null)).toEqual({ kind: null, text: '', fund: null })
    expect(parseGroupQuery('  ')).toEqual({ kind: null, text: '', fund: null })
    expect(parseGroupQuery('THEMES')).toEqual({ kind: 'theme', text: '', fund: null })
    expect(groupKindsToRead(parseGroupQuery('THEMES'))).toEqual([])
    expect(groupKindsToRead(null)).toEqual([])
  })

  it('a pinned kind reads one list; an unpinned name reads all three', () => {
    expect(groupKindsToRead(parseGroupQuery('XLK'))).toEqual(['sector'])
    expect(groupKindsToRead(parseGroupQuery('THEME GOLD MINERS'))).toEqual(['theme'])
    expect(groupKindsToRead(parseGroupQuery('SEMICONDUCTORS'))).toEqual(['sector', 'industry', 'theme'])
  })

  it('the range is PCHG\'s: its words, its keys, and its default', () => {
    expect(normGroupRange(null)).toBe('ytd')
    expect(normGroupRange('3M')).toBe('m3')
    expect(normGroupRange('m6')).toBe('m6')
    expect(normGroupRange('1W')).toBe('ytd')
    expect(normGroupRange('banana')).toBe('ytd')
  })
})

describe('GRP: the command a group is written as', () => {
  it('a fund is the whole group; a name leads with its kind word; the default range is left out', () => {
    expect(groupDrillCommandArgs({ fund: 'XLK' })).toEqual(['XLK'])
    expect(groupDrillCommandArgs({ fund: 'xlk', range: 'm3' })).toEqual(['XLK', '3M'])
    expect(groupDrillCommandArgs({ kind: 'theme', name: 'AI / GPU Chips', range: '1Y' })).toEqual(['THEME', 'AI', '/', 'GPU', 'CHIPS', '1Y'])
    expect(groupDrillCommandArgs({ kind: 'sector', name: 'Consumer Cyclical', range: 'ytd' })).toEqual(['SECTOR', 'CONSUMER', 'CYCLICAL'])
    expect(groupDrillCommandArgs({ kind: null, name: 'semis', range: 'QTD' })).toEqual(['SEMIS', 'QTD'])
    // a range this panel does not have (SCTR's "Today", THMS's 1W) is the default range, so no word
    expect(groupDrillCommandArgs({ fund: 'XLE', range: 'Today' })).toEqual(['XLE'])
    expect(groupDrillCommandArgs({ kind: 'theme', name: 'Gold Miners', range: '1W' })).toEqual(['THEME', 'GOLD', 'MINERS'])
    expect(groupDrillCommandArgs({})).toEqual([])
    expect(groupDrillCommandArgs({ range: 'm1' })).toEqual(['1M'])
    // an unknown fund is not a fund: the name decides
    expect(groupDrillCommandArgs({ fund: 'SMH', kind: 'theme', name: 'Semiconductors' })).toEqual(['THEME', 'SEMICONDUCTORS'])
    expect(groupDrillCommand({ fund: 'XLK', range: '3M' })).toBe('GRP XLK 3M')
  })

  it.each([
    ['theme', 'AI / GPU Chips', 'm3'],
    ['industry', 'Aerospace & Defense', 'ytd'],
    ['industry', 'Oil & Gas E&P', 'y1'],
    ['industry', 'Drug Manufacturers - Specialty & Generic', 'qtd'],
    ['industry', 'Semiconductor Equipment & Materials', 'mtd'],
    ['sector', 'Consumer Cyclical', 'm6'],
    ['theme', 'Gold Miners', 'm1'],
  ])('⭐ a %s called "%s" survives the command line, the registry and the resolver', (kind, name, range) => {
    const line = groupDrillCommand({ kind, name, range })
    // typed in lower case too: the shell upper-cases every token
    for (const typed of [line, line.toLowerCase()]) {
      const cmd = parseCommand(typed)
      expect(cmd, typed).toMatchObject({ ok: true, type: 'function', code: 'GRP', sym: null })
      const out = applyArgs(BY_CODE.GRP.market, cmd.args)
      expect(out.ignored, typed).toEqual([])
      expect(out.props.range ?? 'ytd').toBe(range)
      const query = parseGroupQuery(out.props.group)
      expect(query.kind).toBe(kind)
      const hit = resolveGroup(LISTS, query)
      expect(hit.status, typed).toBe('ok')
      expect(hit.group).toMatchObject({ kind, name })
      // and what the panel writes back for it is the same command
      expect(groupDrillCommand({ kind: hit.group.kind, name: hit.group.name, range: out.props.range })).toBe(line)
    }
  })

  it('a name with a comma, as the server spells it, comes back from the command line as the same group', () => {
    const lists = { industry: periodGroupsRead(groupsBody('industry', [{ name: 'Furnishings, Fixtures & Appliances', period_change: 3, count: 1, members: ['MMM'] }]), 'industry').rows }
    const line = groupDrillCommand({ kind: 'industry', name: 'Furnishings, Fixtures & Appliances' })
    expect(line).toBe('GRP INDUSTRY FURNISHINGS FIXTURES & APPLIANCES')
    const out = applyArgs(BY_CODE.GRP.market, parseCommand(line).args)
    expect(resolveGroup(lists, parseGroupQuery(out.props.group)).group.name).toBe('Furnishings, Fixtures & Appliances')
  })
})

describe('GRP: the lists a name is resolved against, read together', () => {
  const ok = (kind) => ({ kind, loading: false, error: null, view: periodGroupsRead(groupsBody(kind, [{ name: 'X', period_change: 1, count: 1, members: ['AAA'] }]), kind) })
  const withView = (kind, body) => ({ kind, loading: false, error: null, view: periodGroupsRead(body, kind) })

  it('no list asked for is idle; one still loading, failed or being worked out is the state of them all', () => {
    expect(combineGroupLists([]).state).toBe('idle')
    expect(combineGroupLists(null).state).toBe('idle')
    expect(combineGroupLists([ok('sector'), { kind: 'theme', loading: true, error: null, view: periodGroupsRead(undefined, 'theme') }]).state).toBe('loading')
    const err = Object.assign(new Error('http 402'), { status: 402 })
    const failed = combineGroupLists([ok('sector'), { kind: 'industry', loading: false, error: err, view: periodGroupsRead(undefined, 'industry') }])
    expect(failed).toMatchObject({ state: 'error', error: err })
    expect(combineGroupLists([ok('sector'), withView('theme', { status: 'computing', results: [], count: 0 })]).state).toBe('computing')
    expect(combineGroupLists([ok('sector'), withView('theme', { status: 'unavailable', results: [] })]).state).toBe('unavailable')
    expect(combineGroupLists([withView('theme', { status: 'error', error: 'start must be before end' })]).state).toBe('refused')
    expect(combineGroupLists([withView('theme', 'nonsense')]).state).toBe('failed')
    // an answer for another kind is not this list's answer
    expect(combineGroupLists([withView('theme', groupsBody('sector', []))]).state).toBe('failed')
  })

  it('all read: the rows by kind and the days the server used', () => {
    const all = combineGroupLists([ok('sector'), ok('theme')])
    expect(all.state).toBe('ok')
    expect(Object.keys(all.lists)).toEqual(['sector', 'theme'])
    expect(all.lists.theme[0]).toMatchObject({ name: 'X', pct: 1, members: ['AAA'] })
    expect(all).toMatchObject({ startDay: '2025-12-31', endDay: '2026-11-17', sameDay: false, asOf: '2026-11-18T09:41:00-05:00' })
    expect(combineGroupLists([withView('sector', { ...groupsBody('sector', []), start: 20261117 })]).sameDay).toBe(true)
  })
})

describe('GRP: the one resolver', () => {
  it('a sector fund is its sector, whatever the ranking calls it', () => {
    expect(ask('XLK')).toMatchObject({ status: 'ok', group: { kind: 'sector', name: 'Technology', fund: 'XLK', pct: 38.3, members: ['AAA', 'BBB', 'CCC'] }, also: [] })
    expect(ask('XLY').group).toMatchObject({ name: 'Consumer Cyclical', fund: 'XLY' })
    expect(ask('XLP').group).toMatchObject({ name: 'Consumer Defensive', fund: 'XLP' })
    expect(ask('XLF').group).toMatchObject({ name: 'Financial Services', fund: 'XLF' })
  })

  it('a fund whose sector the ranking does not hold says so and offers the sectors it does hold', () => {
    const miss = ask('XLE')
    expect(miss).toMatchObject({ status: 'unknown', query: 'XLE', fund: 'XLE' })
    expect(miss.suggestions.map((o) => o.name)).toEqual(['Consumer Cyclical', 'Consumer Defensive', 'Financial Services', 'Technology'])
    expect(miss.suggestions.every((o) => o.kind === 'sector')).toBe(true)
  })

  it('a sector answers to every name the app gives it', () => {
    expect(ask('CONSUMER DISCRETIONARY').group).toMatchObject({ kind: 'sector', name: 'Consumer Cyclical', fund: 'XLY' })
    expect(ask('consumer staples').group.name).toBe('Consumer Defensive')
    expect(ask('FINANCIALS').group.name).toBe('Financial Services')
    expect(ask('Information Technology').group.name).toBe('Technology')
  })

  it('⭐ an exact name: a sector before an industry before a UCT theme, and the other kind is named', () => {
    const hit = ask('SEMICONDUCTORS')
    expect(hit.status).toBe('ok')
    expect(hit.group).toMatchObject({ kind: 'industry', name: 'Semiconductors', pct: 51, members: ['AAA', 'BBB'] })
    expect(hit.also).toEqual([{ kind: 'theme', name: 'Semiconductors', fund: null }])
    // a kind word pins it, and then nothing else is offered
    const theme = ask('THEME SEMICONDUCTORS')
    expect(theme.group).toMatchObject({ kind: 'theme', name: 'Semiconductors', pct: 44, members: ['AAA', 'BBB', 'KKK'] })
    expect(theme.also).toEqual([])
    // an exact name wins over a longer name it starts
    expect(ask('INDUSTRY SEMICONDUCTORS').group.name).toBe('Semiconductors')
  })

  it('a prefix opens a group only when it is the one group that starts with it', () => {
    expect(ask('TECH').group).toMatchObject({ kind: 'sector', name: 'Technology' })
    expect(ask('gold').group).toMatchObject({ kind: 'theme', name: 'Gold Miners' })
    expect(ask('AEROSPACE').group).toMatchObject({ kind: 'industry', name: 'Aerospace & Defense' })
    const many = ask('SEMI')
    expect(many.status).toBe('ambiguous')
    expect(many.query).toBe('SEMI')
    expect(many.options).toEqual([
      { kind: 'industry', name: 'Semiconductor Equipment & Materials', fund: null },
      { kind: 'industry', name: 'Semiconductors', fund: null },
      { kind: 'theme', name: 'Semiconductors', fund: null },
    ])
    expect(ask('CONSUMER').options.map((o) => o.name)).toEqual(['Consumer Cyclical', 'Consumer Defensive'])
    // pinned to one kind, the same prefix is no longer shared
    expect(ask('THEME SEMI').group).toMatchObject({ kind: 'theme', name: 'Semiconductors' })
  })

  it('nothing fits: the nearest names, never a guess', () => {
    // a word inside a name is only ever a suggestion
    const inside = ask('GPU')
    expect(inside).toMatchObject({ status: 'unknown', query: 'GPU', fund: null })
    expect(inside.suggestions).toEqual([{ kind: 'theme', name: 'AI / GPU Chips', fund: null }])
    expect(ask('DEFENSE').suggestions.map((o) => o.name)).toEqual(['Aerospace & Defense'])
    expect(ask('MATERIALS').suggestions.map((o) => o.name)).toEqual(['Semiconductor Equipment & Materials'])
    // a slip of the keyboard
    expect(ask('TECHNOLGY').suggestions.map((o) => o.name)).toEqual(['Technology'])
    expect(ask('ZZZZZZZZ')).toMatchObject({ status: 'unknown', suggestions: [] })
    // pinned to a kind, only that kind is searched
    expect(ask('SECTOR GOLD MINERS')).toMatchObject({ status: 'unknown', suggestions: [] })
    expect(ask('THEME TECHNOLOGY').status).toBe('unknown')
  })

  it('never more than six names are offered; nothing typed is "empty"', () => {
    const many = { industry: periodGroupsRead(groupsBody('industry', Array.from({ length: 12 }, (_, i) => ({ name: `Banks ${i}`, period_change: i, count: 1, members: ['AAA'] }))), 'industry').rows }
    expect(ask('BANKS', many).options).toHaveLength(GROUP_SUGGESTIONS)
    expect(ask('BANKS', many).total).toBe(12)      // the count is of every group that fits, not of the six named
    expect(ask('SEMI').total).toBe(3)
    expect(ask('ANK', many).suggestions).toHaveLength(GROUP_SUGGESTIONS)
    expect(ask('')).toEqual({ status: 'empty' })
    expect(ask('THEMES')).toEqual({ status: 'empty' })
    // a kind that was not read is not searched (and does not throw)
    expect(ask('SEMICONDUCTORS', { theme: THEMES }).group.kind).toBe('theme')
    expect(ask('SEMICONDUCTORS', {})).toMatchObject({ status: 'unknown', suggestions: [] })
  })

  it('two sectors under one fund (two spellings in the company details) ask which', () => {
    const lists = { sector: periodGroupsRead(groupsBody('sector', [
      { name: 'Financial', period_change: 1, count: 1, members: ['AAA'] },
      { name: 'Financial Services', period_change: 2, count: 1, members: ['BBB'] },
    ]), 'sector').rows }
    expect(ask('XLF', lists)).toMatchObject({ status: 'ambiguous', options: [{ name: 'Financial Services' }, { name: 'Financial' }] })
    expect(ask('FINANCIALS', lists).status).toBe('ambiguous')
  })
})

describe('GRP: a theme the ranking does not hold', () => {
  const PAYLOAD = {
    themes: [
      { name: 'UCT 20', ticker: 'UCT20', theme_id: '', holdings: [{ sym: 'NVDA' }, { sym: 'BRK.B', source: 'owner' }, { sym: 'ZZZ', source: 'engine' }] },
      { name: 'Quantum Computing', ticker: 'QTUM', theme_id: 'quantum', holdings: [{ sym: 'ENG1', source: 'engine' }, { sym: 'ENG2', source: 'engine' }] },
      { name: 'Empty Theme', ticker: 'EMP', theme_id: 'empty', holdings: [] },
      { name: 'Stashed', ticker: 'STSH', theme_id: 'stash', holdings: [{ sym: 'ENG3', source: 'engine' }], _owner_syms: ['OWN1'] },
    ],
  }
  const look = (raw) => taxonomyTheme(PAYLOAD, parseGroupQuery(raw))

  it('⛔ curated members only: an engine-suggested member is never listed', () => {
    const hit = look('UCT 20')
    expect(hit.status).toBe('ok')
    expect(hit.group).toEqual({ kind: 'theme', name: 'UCT 20', pct: null, count: null, members: ['BRK-B', 'NVDA'], fund: null, listed: true })
    expect(hit.group.members).not.toContain('ZZZ')
    expect(look('THEME stashed').group.members).toEqual(['OWN1'])
  })

  it('⛔ a theme with no curated member is "none", never an empty group', () => {
    expect(look('QUANTUM COMPUTING')).toEqual({ status: 'none', name: 'Quantum Computing' })
    expect(look('quantum')).toEqual({ status: 'none', name: 'Quantum Computing' })   // its id
    expect(look('EMPTY THEME')).toEqual({ status: 'none', name: 'Empty Theme' })
  })

  it('exact names only, and anything that is not a theme list is unknown', () => {
    expect(look('UCT')).toEqual({ status: 'unknown' })              // a prefix is not enough here
    expect(look('QTUM')).toEqual({ status: 'unknown' })             // a theme's reference fund is not its name
    expect(look('NOPE')).toEqual({ status: 'unknown' })
    expect(look('')).toEqual({ status: 'unknown' })
    expect(taxonomyTheme({ themes: [], status: 'computing' }, parseGroupQuery('UCT 20'))).toEqual({ status: 'unknown' })
    expect(taxonomyTheme(null, parseGroupQuery('UCT 20'))).toEqual({ status: 'unknown' })
  })
})

describe('GRP: RS ranks and the flow signal, by symbol', () => {
  it('the RS ranking is a lookup; a stock it does not hold is absent, never 0', () => {
    const read = rsRanks([
      { ticker: 'AAA', rs_score: 9.1, rs_rank: 97, returns: {} },
      { ticker: 'brk.b', rs_rank: 55 },
      { ticker: 'CCC', rs_rank: null },
      { ticker: '', rs_rank: 4 },
      { ticker: 'AAA', rs_rank: 1 },
    ])
    expect(read.state).toBe('ok')
    expect([...read.ranks]).toEqual([['AAA', 97], ['BRK-B', 55]])
    expect(read.ranks.get('CCC')).toBeUndefined()
    for (const bad of [undefined, null, {}, { status: 'warming' }, [], [{ ticker: 'AAA' }]]) expect(rsRanks(bad).state).toBe('failed')
  })

  it('the confluence board is a lookup of direction and status; off the board is absent', () => {
    const view = confluenceRead({ ok: true, window: 'Oct 6 – Nov 14, 2026', days: 30, rows: [
      { sym: 'AAA', band: 'L', dir: 'BULL', status: 'BUILDING' },
      { sym: 'BRK.B', band: 'L', dir: 'BEAR', status: 'ESTABLISHED' },
      { sym: 'DDD', band: 'M', dir: 'BULL', status: 'ODD' },
    ] })
    const board = flowBoard(view)
    expect([...board]).toEqual([
      ['AAA', { direction: 'bullish', status: 'building' }],
      ['BRK-B', { direction: 'bearish', status: 'established' }],
      ['DDD', { direction: 'bullish', status: null }],
    ])
    expect(flowWords(board.get('AAA'))).toBe('Bullish, building')
    expect(flowWords(board.get('BRK-B'))).toBe('Bearish, established')
    expect(flowWords(board.get('DDD'))).toBe('Bullish')
    expect(flowWords(undefined)).toBeNull()
    expect(flowWords({ direction: 'sideways' })).toBeNull()
    expect(flowBoard(confluenceRead({ ok: false, status: 'warming' })).size).toBe(0)
    expect(flowBoard(null).size).toBe(0)
  })
})

describe('GRP: a group\'s stocks as rows', () => {
  const STOCKS = periodRead({
    status: 'ok', start: 20251231, end: 20261117, as_of: '2026-11-18T09:41:00-05:00', partial: false,
    results: [
      { sym: 'AAA', period_change: 212.5, net_change: 21.25, start_close: 10, end_close: 31.25, industry: 'Semiconductors', sector: 'Technology' },
      { sym: 'BBB', period_change: -4.0, net_change: -2, start_close: 50, end_close: 48, industry: 'Software', sector: 'Technology' },
      { sym: 'ZZZ', period_change: 999, net_change: 1, start_close: 1, end_close: 2, industry: 'Banks', sector: 'Financial Services' },
    ],
  }).rows
  const ranks = rsRanks([{ ticker: 'AAA', rs_rank: 97 }, { ticker: 'CCC', rs_rank: 12 }]).ranks
  const board = flowBoard({ rows: [{ sym: 'BBB', direction: 'bearish', status: 'steady' }] })
  const group = ask('XLK').group

  it('each member with its own change, RS rank and flow signal; biggest gain first', () => {
    const built = groupDrillRows(group, STOCKS, { ranks, board })
    expect(built.rows.map((r) => [r.sym, r.pct, r.rs, r.flow && r.flow.direction])).toEqual([
      ['AAA', 212.5, 97, null],
      ['BBB', -4, null, 'bearish'],
      ['CCC', null, 12, null],
    ])
    expect(built.rows[0]).toMatchObject({ key: 'grp-AAA', startClose: 10, endClose: 31.25, industry: 'Semiconductors', sector: 'Technology', order: 0 })
    expect(built).toMatchObject({ total: 3, known: 2, ranked: 2, onBoard: 1 })
    // a stock outside the group never rides in, however it moved
    expect(built.rows.map((r) => r.sym)).not.toContain('ZZZ')
  })

  it('⛔ a member the stock ranking does not hold keeps its row with no change, never 0', () => {
    const built = groupDrillRows(group, STOCKS, { ranks, board })
    expect(built.rows[2]).toMatchObject({ sym: 'CCC', pct: null, startClose: null, endClose: null, industry: null })
    const bare = groupDrillRows(group, [], {})
    expect(bare.rows.map((r) => [r.sym, r.pct, r.rs, r.flow])).toEqual([['AAA', null, null, null], ['BBB', null, null, null], ['CCC', null, null, null]])
    expect(bare).toMatchObject({ total: 3, known: 0, ranked: 0, onBoard: 0 })
  })

  it('a member is listed once, in the app\'s own symbol form; no group is no rows', () => {
    const built = groupDrillRows({ members: ['brk.b', 'BRK-B', 'AAA', ''] }, STOCKS, { ranks: rsRanks([{ ticker: 'BRK-B', rs_rank: 60 }]).ranks })
    expect(built.rows.map((r) => [r.sym, r.rs])).toEqual([['AAA', null], ['BRK-B', 60]])
    expect(groupDrillRows(null, STOCKS).rows).toEqual([])
    expect(groupDrillRows({ members: 'nope' }, STOCKS).total).toBe(0)
  })

  it('sorted by change or by RS, either way; a row with no value sinks to the end both ways', () => {
    const rows = groupDrillRows({ members: ['AAA', 'BBB', 'CCC', 'DDD'] }, STOCKS, { ranks: rsRanks([{ ticker: 'AAA', rs_rank: 40 }, { ticker: 'CCC', rs_rank: 90 }, { ticker: 'BBB', rs_rank: 40 }]).ranks }).rows
    const syms = (sort) => sortGroupRows(rows, sort).map((r) => r.sym)
    expect(DEFAULT_GROUP_SORT).toEqual({ key: 'pct', dir: 'desc' })
    expect(syms(DEFAULT_GROUP_SORT)).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
    expect(syms({ key: 'pct', dir: 'asc' })).toEqual(['BBB', 'AAA', 'CCC', 'DDD'])
    expect(syms({ key: 'rs', dir: 'desc' })).toEqual(['CCC', 'AAA', 'BBB', 'DDD'])   // a tie keeps the change order
    expect(syms({ key: 'rs', dir: 'asc' })).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
    // anything else is the default order, and the input is never reordered in place
    expect(syms({ key: 'banana', dir: 'sideways' })).toEqual(syms(DEFAULT_GROUP_SORT))
    expect(syms(null)).toEqual(syms(DEFAULT_GROUP_SORT))
    expect(rows.map((r) => r.sym)).toEqual(['AAA', 'BBB', 'CCC', 'DDD'])
    expect(sortGroupRows(null, DEFAULT_GROUP_SORT)).toEqual([])
    expect(normGroupSort({ key: 'rs' })).toEqual({ key: 'rs', dir: 'desc' })
    expect(groupSortWords(DEFAULT_GROUP_SORT)).toBe('biggest gain first')
    expect(groupSortWords({ key: 'pct', dir: 'asc' })).toBe('biggest fall first')
    expect(groupSortWords({ key: 'rs', dir: 'desc' })).toBe('highest RS rank first')
    expect(groupSortWords({ key: 'rs', dir: 'asc' })).toBe('lowest RS rank first')
  })
})

describe('GRP: every one-click range has a word the command line takes', () => {
  it('each range chip writes a word the registry applies as that range', () => {
    for (const [key, r] of Object.entries(PERIOD_RANGES)) {
      const out = applyArgs(BY_CODE.GRP.market, groupDrillCommandArgs({ fund: 'XLK', range: key }))
      expect(out.ignored, key).toEqual([])
      expect(out.props.group, key).toBe('XLK')
      expect(out.props.range ?? 'ytd', r.token).toBe(key)
    }
  })
})
