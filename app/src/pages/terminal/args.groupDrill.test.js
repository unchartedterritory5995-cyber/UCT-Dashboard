// The sector and theme drill-down (GRP, 2026-11-18): its argument kind and the parser rule it needs.
//
// args.js takes GRP's group as a REST kind and never reads the name itself (the panel model owns
// the resolver). This rail pins what the kind takes, that the range words stay PCHG's, and that a
// name made of words that are also function codes or tickers still reaches the panel whole.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, PERIOD_RANGE_WORDS, applyArgs, argsEcho } from './args'
import { BY_CODE, FUNCTIONS } from './functions'
import parseCommand, { formatCommand } from './parseCommand'
import { describeCommand } from './grammar'
import { writeBackCommand } from './panels/commandWriteBack'
import { PERIOD_RANGE_ARG_WORDS } from './panels/periodChangeModel'
import { GROUP_DRILL_CODE, GROUP_KIND_ARG_WORDS, groupDrillCommand, groupDrillCommandArgs, parseGroupQuery } from './panels/groupDrillModel'

const GRP = BY_CODE.GRP
const run = (tokens) => applyArgs(GRP.market, tokens)

describe('GRP is one market-wide code', () => {
  it('registered once, under the code the model names, with a range and a group name', () => {
    expect(GROUP_DRILL_CODE).toBe('GRP')
    expect(FUNCTIONS.filter((f) => f.code === 'GRP')).toHaveLength(1)
    expect(GRP.group).toBe('Market')
    expect(GRP.ticker).toBeUndefined()
    expect(GRP.market.panel).toBe('GroupDrill')
    expect(GRP.market.args).toEqual([{ kind: 'periodRange', prop: 'range' }, { kind: 'groupName', prop: 'group', rest: true, phrase: true }])
  })
})

describe('the groupName kind', () => {
  it('takes any word that is not a range word, upper case, and never reads the name', () => {
    const parse = ARG_KINDS.groupName.parse
    expect(parse('xlk')).toBe('XLK')
    expect(parse('/')).toBe('/')
    expect(parse('&')).toBe('&')
    expect(parse('E&P')).toBe('E&P')
    expect(parse('$xlk')).toBe('$XLK')
    for (const empty of ['', '   ', null, undefined]) expect(parse(empty)).toBeNull()
    expect(ARG_KINDS.groupName.describe('THEME AI / GPU CHIPS')).toBe('group "THEME AI / GPU CHIPS"')
    expect(ARG_KINDS.groupName.takes).toContain('GRP XLK')
  })

  it('a range word is never a name word: the range kind is PCHG\'s, word for word', () => {
    expect(PERIOD_RANGE_WORDS).toEqual(PERIOD_RANGE_ARG_WORDS)
    for (const word of Object.keys(PERIOD_RANGE_ARG_WORDS)) {
      expect(ARG_KINDS.groupName.parse(word), word).toBeNull()
      expect(ARG_KINDS.groupName.parse(word.toLowerCase()), word).toBeNull()
    }
    // and no kind word is a range word, so `GRP SECTOR ...` never loses its lead
    for (const word of Object.keys(GROUP_KIND_ARG_WORDS)) expect(PERIOD_RANGE_ARG_WORDS[word], word).toBeUndefined()
  })

  it('the words are joined into one group, the range is taken wherever it is typed', () => {
    expect(run(['THEME', 'AI', '/', 'GPU', 'CHIPS', '3M'])).toMatchObject({ props: { group: 'THEME AI / GPU CHIPS', range: 'm3' }, ignored: [] })
    expect(run(['3M', 'AEROSPACE', '&', 'DEFENSE']).props).toEqual({ range: 'm3', group: 'AEROSPACE & DEFENSE' })
    expect(run(['xlk']).props).toEqual({ group: 'XLK' })
    expect(run(['QTD']).props).toEqual({ range: 'qtd' })
    expect(run([])).toMatchObject({ props: {}, applied: [], ignored: [] })
    // a second range word is said to be not applied, never folded into the name
    const twice = run(['XLK', '3M', '1Y'])
    expect(twice.props).toEqual({ group: 'XLK', range: 'm3' })
    expect(twice.ignored).toEqual(['1Y'])
    expect(argsEcho('GRP', twice)).toContain('Not applied: "1Y"')
  })
})

describe('GRP on the command line', () => {
  it.each([
    ['GRP', []],
    ['GRP XLK', ['XLK']],
    ['grp xlk 3m', ['XLK', '3M']],
    ['GRP 3M XLK', ['3M', 'XLK']],
    ['GRP TECHNOLOGY', ['TECHNOLOGY']],
    ['GRP SEMICONDUCTORS 1Y', ['SEMICONDUCTORS', '1Y']],
    ['GRP AI / GPU Chips', ['AI', '/', 'GPU', 'CHIPS']],
    ['GRP Aerospace & Defense', ['AEROSPACE', '&', 'DEFENSE']],
    ['GRP THEME GOLD MINERS QTD', ['THEME', 'GOLD', 'MINERS', 'QTD']],
    ['GRP "Furnishings, Fixtures & Appliances"', ['FURNISHINGS', 'FIXTURES', '&', 'APPLIANCES']],
  ])('%s opens GRP with every word after the code', (line, args) => {
    const cmd = parseCommand(line)
    expect(cmd).toMatchObject({ ok: true, type: 'function', code: 'GRP', sym: null, args })
    expect(run(cmd.args).ignored).toEqual([])
    const echo = describeCommand(cmd)
    expect(echo.text, line).toBeTruthy()
    expect(echo.tone, `${line}: ${echo.text}`).not.toBe('error')
    // the canonical text (the panel title, `?cmd=`, a saved board) parses back to the same command
    expect(parseCommand(formatCommand(cmd))).toMatchObject({ code: 'GRP', sym: null, args })
  })

  it('⭐ a name whose first word is a function code or a real ticker is still the group, not `TICKER FUNC`', () => {
    // TECH, LIVE, FLOW and NEWS are function codes; TECH and AI are also real tickers
    for (const [line, args] of [
      ['GRP TECH', ['TECH']],
      ['grp tech 3m', ['TECH', '3M']],
      ['GRP LIVE ENTERTAINMENT', ['LIVE', 'ENTERTAINMENT']],
      ['GRP FLOW CONTROL', ['FLOW', 'CONTROL']],
      ['GRP NEWS', ['NEWS']],
      ['GRP AI', ['AI']],
    ]) {
      const cmd = parseCommand(line)
      expect(cmd, line).toMatchObject({ ok: true, type: 'function', code: 'GRP', sym: null, args })
      expect(run(cmd.args).ignored, line).toEqual([])
    }
    expect(parseGroupQuery(run(parseCommand('GRP TECH').args).props.group)).toEqual({ kind: null, text: 'TECH', fund: null })
  })

  it('CONTROL: the rule is GRP\'s alone; every other code keeps the grammar it had', () => {
    // a code in second place still makes the first word a ticker
    expect(parseCommand('NVDA TECH')).toMatchObject({ code: 'TECH', sym: 'NVDA' })
    expect(parseCommand('NVDA GP W')).toMatchObject({ code: 'GP', sym: 'NVDA', args: ['W'] })
    // TSRC is a REST code too, but it did not ask for the rule, so it reads as it always did
    expect(BY_CODE.TSRC.market.args.some((s) => s.phrase)).toBe(false)
    expect(parseCommand('TSRC FLOW')).toMatchObject({ code: 'FLOW', sym: 'TSRC' })
    // IMOV takes a ticker, so a lone ticker after it is still the ticker
    expect(parseCommand('IMOV NVDA 1W')).toMatchObject({ code: 'IMOV', sym: 'NVDA', args: ['1W'] })
    // `$` still forces a ticker reading of the first word
    expect(parseCommand('$GRP TECH')).toMatchObject({ code: 'TECH', sym: 'GRP' })
    // and a ticker before GRP is not a group (GRP is market-wide)
    expect(parseCommand('XLK GRP')).toMatchObject({ code: 'GRP', sym: 'XLK', args: [] })
    // only GRP carries the flag today
    expect(FUNCTIONS.filter((f) => [...(f.market?.args || []), ...(f.ticker?.args || [])].some((s) => s.phrase)).map((f) => f.code)).toEqual(['GRP'])
  })
})

describe('GRP: what the panel writes back is taken whole', () => {
  it.each([
    [{ fund: 'XLK' }, 'GRP XLK'],
    [{ fund: 'XLK', range: 'm3' }, 'GRP XLK 3M'],
    [{ kind: 'sector', name: 'Technology', range: 'y1' }, 'GRP SECTOR TECHNOLOGY 1Y'],
    [{ kind: 'theme', name: 'AI / GPU Chips' }, 'GRP THEME AI / GPU CHIPS'],
    [{ kind: 'industry', name: 'Aerospace & Defense', range: 'qtd' }, 'GRP INDUSTRY AEROSPACE & DEFENSE QTD'],
    [{ kind: null, name: 'tech' }, 'GRP TECH'],
  ])('%o is written as "%s", and reads back as the same picks', (pick, line) => {
    expect(groupDrillCommand(pick)).toBe(line)
    expect(writeBackCommand('GRP', groupDrillCommandArgs(pick))).toBe(line)
    const cmd = parseCommand(line)
    expect(cmd).toMatchObject({ ok: true, code: 'GRP', sym: null })
    expect(formatCommand(cmd)).toBe(line)
  })
})
