// GRPS (2026-11-21): the code in the registry, its two argument kinds, how they parse, the write-back, and the
// words that find it.
//
// args.js keeps its own copy of the words the panel model owns (so the panel's code stays out of the shell's
// first-open bytes); this rail pins the copy to its owner, word for word, and checks no word collides with a
// function code or another function's reading.
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { ARG_KINDS, GROUPS_KIND_WORDS, GROUPS_VIEW_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS, FUNCTION_GROUPS, codesForWords, exampleFor, isCode, variantFor } from './functions'
import parseCommand from './parseCommand'
import { PANEL_IMPORTERS } from './panels'
import { writeBackCommand } from './panels/commandWriteBack'
import {
  DEFAULT_GROUPS_KIND, DEFAULT_GROUPS_VIEW, GROUPS_KIND_ARG_WORDS, GROUPS_TABLE_CODE, GROUPS_VIEWS, GROUPS_VIEW_ARG_WORDS, groupsCommandArgs,
} from './panels/groupStatsModel'

const run = (tokens) => applyArgs(BY_CODE.GRPS.market, tokens)

describe('GRPS in the registry', () => {
  it('the model names the code; registered once, in the Market group, market-wide, two argument kinds', () => {
    expect(GROUPS_TABLE_CODE).toBe('GRPS')
    expect(FUNCTIONS.filter((f) => f.code === 'GRPS')).toHaveLength(1)
    expect(FUNCTION_GROUPS).toContain(BY_CODE.GRPS.group)
    expect(BY_CODE.GRPS.group).toBe('Market')
    // GRPS CROWDING (2026-11-22) moved the label on purpose: it names the new column set
    expect(BY_CODE.GRPS.label).toBe('Every sector or industry: weekly rank, median growth, margins, valuation, breadth and crowding')
    expect(BY_CODE.GRPS.market).toEqual({ panel: 'GroupTable', args: [{ kind: 'groupsKind', prop: 'kind' }, { kind: 'groupsView', prop: 'view' }] })
    expect(BY_CODE.GRPS.ticker).toBeUndefined()
    expect(BY_CODE.GRPS.market.flag).toBeUndefined()              // its route answers every paid member; states are in words
    expect(exampleFor(BY_CODE.GRPS)).toBe('GRPS INDUSTRIES')
    expect(variantFor('GRPS', false)).toMatchObject({ scope: 'market' })
    expect(typeof PANEL_IMPORTERS.GroupTable).toBe('function')
    // GRP, the one-group drill-down it opens, keeps its own arguments
    expect(BY_CODE.GRP.market.args.map((a) => a.kind)).toEqual(['periodRange', 'groupName'])
  })

  it('GRPS is not a stock in the site\'s universe', () => {
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.size).toBeGreaterThan(3000)
    expect(universe.has('NVDA')).toBe(true)                       // the control: the list is the ticker list
    expect(universe.has('GRPS')).toBe(false)
  })

  it('no argument kind takes GRPS, and neither of GRPS\'s kinds takes a function code', () => {
    for (const [kind, spec] of Object.entries(ARG_KINDS)) {
      expect(spec.parse('GRPS', { today: '2026-11-21' }) == null || /Name|Query|code|cotMarket/i.test(kind), `${kind} takes GRPS`).toBe(true)
    }
    for (const f of FUNCTIONS) {
      for (const kind of ['groupsKind', 'groupsView']) expect([kind, f.code, ARG_KINDS[kind].parse(f.code)]).toEqual([kind, f.code, null])
    }
  })
})

describe('the arguments match the panel that owns the words', () => {
  it('the copies equal the model, word for word; no word is a code and no word sits in both maps', () => {
    expect(GROUPS_KIND_WORDS).toEqual(GROUPS_KIND_ARG_WORDS)
    expect(GROUPS_VIEW_WORDS).toEqual(GROUPS_VIEW_ARG_WORDS)
    for (const w of [...Object.keys(GROUPS_KIND_WORDS), ...Object.keys(GROUPS_VIEW_WORDS)]) {
      expect([w, isCode(w)]).toEqual([w, false])
      expect([w, ARG_KINDS.groupsKind.parse(w) != null && ARG_KINDS.groupsView.parse(w) != null]).toEqual([w, false])
    }
    for (const v of Object.values(GROUPS_VIEW_WORDS)) expect(v in GROUPS_VIEWS).toBe(true)
    for (const no of ['toString', 'constructor', '', 'NOPE', 'THEMES']) {
      expect([no, ARG_KINDS.groupsKind.parse(no), ARG_KINDS.groupsView.parse(no)]).toEqual([no, null, null])
    }
  })

  it('the registry applies each word to the prop the panel reads, in either order, and says what it did not take', () => {
    expect(run(['INDUSTRIES']).props).toEqual({ kind: 'industry' })
    expect(run(['valuation', 'industry']).props).toEqual({ view: 'valuation', kind: 'industry' })
    expect(run(['INDUSTRIES', 'VALUATION']).applied).toEqual(['every industry', 'the valuation columns'])
    expect(run(['NVDA']).ignored).toEqual(['NVDA'])
    expect(run(['GROWTH', 'MARGINS']).ignored).toEqual(['MARGINS'])
    expect(applyArgs(BY_CODE.GRPS.market, []).takes).toEqual(['SECTORS or INDUSTRIES',
      'a column set (OVERVIEW, GROWTH, MARGINS, VALUATION, BREADTH, RANK, CROWDING, ALL)'])
    // GRPS RANK (2026-11-22): the weekly rank's word, in either order with the kind
    expect(run(['RANK', 'INDUSTRIES']).props).toEqual({ view: 'rank', kind: 'industry' })
    expect(run(['INDUSTRIES', 'RANK']).applied).toEqual(['every industry', 'the weekly rank columns'])
    // GRPS CROWDING (2026-11-22): positioning's word, in either order with the kind
    expect(run(['CROWDING', 'INDUSTRIES']).props).toEqual({ view: 'crowding', kind: 'industry' })
    expect(run(['SECTORS', 'CROWDING']).applied).toEqual(['every sector', 'the crowding columns (short interest, insider buying, fund holdings)'])
  })

  it('what the panel writes back is read as the same choice; the default is the bare command', () => {
    for (const kind of ['sector', 'industry']) {
      for (const view of Object.keys(GROUPS_VIEWS)) {
        const tokens = groupsCommandArgs({ kind, view })
        const r = run(tokens)
        expect([kind, view, r.ignored]).toEqual([kind, view, []])
        expect([r.props.kind || DEFAULT_GROUPS_KIND, r.props.view || DEFAULT_GROUPS_VIEW]).toEqual([kind, view])
        expect(writeBackCommand('GRPS', tokens)).toBe(['GRPS', ...tokens].join(' '))
      }
    }
    expect(groupsCommandArgs({})).toEqual([])
  })
})

describe('GRPS parses', () => {
  it('the code alone, with its words in either order, and lower case', () => {
    expect(parseCommand('GRPS')).toMatchObject({ ok: true, type: 'function', code: 'GRPS', sym: null, args: [] })
    expect(parseCommand('GRPS INDUSTRIES VALUATION')).toMatchObject({ ok: true, code: 'GRPS', sym: null, args: ['INDUSTRIES', 'VALUATION'] })
    expect(parseCommand('grps breadth industries')).toMatchObject({ ok: true, code: 'GRPS', sym: null, args: ['BREADTH', 'INDUSTRIES'] })
    // ALL is also a stock: after the code it is GRPS's word; first it is the stock, and GRPS says it is market-wide
    expect(parseCommand('GRPS ALL')).toMatchObject({ ok: true, code: 'GRPS', sym: null, args: ['ALL'] })
    expect(parseCommand('ALL GRPS')).toMatchObject({ ok: true, code: 'GRPS', sym: 'ALL' })
    // GRP's phrase reading is untouched: every word after GRP is the group's name
    expect(parseCommand('GRP TECHNOLOGY')).toMatchObject({ ok: true, code: 'GRP', args: ['TECHNOLOGY'] })
  })

  it('RANK (2026-11-22) is GRPS\'s word after the code, is no code and no stock, and no other argument kind takes it', () => {
    expect(parseCommand('GRPS RANK')).toMatchObject({ ok: true, code: 'GRPS', sym: null, args: ['RANK'] })
    expect(parseCommand('grps industries rank')).toMatchObject({ ok: true, code: 'GRPS', sym: null, args: ['INDUSTRIES', 'RANK'] })
    expect(isCode('RANK')).toBe(false)
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.has('RANK')).toBe(false)
    // a kind that takes any word of a shape (a ticker, a name) takes an invented word too: it is not a dictionary
    const ctx = { today: '2026-11-22' }
    const dictionaries = Object.entries(ARG_KINDS).filter(([kind, spec]) => kind !== 'groupsView' && spec.parse('QZXW', ctx) == null)
    expect(dictionaries.length).toBeGreaterThan(40)
    expect(dictionaries.some(([kind]) => kind === 'groupsKind')).toBe(true)          // the control: a closed word list is checked
    for (const [kind, spec] of dictionaries) expect([kind, spec.parse('RANK', ctx)]).toEqual([kind, null])
  })
})

describe('CROWDING (2026-11-22), GRPS\'s positioning word', () => {
  it('is GRPS\'s word after the code, is no code and no stock, no other dictionary takes it, and it is in no panel title', () => {
    expect(parseCommand('GRPS CROWDING')).toMatchObject({ ok: true, code: 'GRPS', sym: null, args: ['CROWDING'] })
    expect(parseCommand('grps industries crowding')).toMatchObject({ ok: true, code: 'GRPS', sym: null, args: ['INDUSTRIES', 'CROWDING'] })
    expect(isCode('CROWDING')).toBe(false)
    const universe = new Set(JSON.parse(fs.readFileSync(path.join(process.cwd(), '..', 'api', 'data', 'cap_universe.json'), 'utf8')))
    expect(universe.has('CROWDING')).toBe(false)
    const ctx = { today: '2026-11-22' }
    const dictionaries = Object.entries(ARG_KINDS).filter(([kind, spec]) => kind !== 'groupsView' && spec.parse('QZXW', ctx) == null)
    expect(dictionaries.length).toBeGreaterThan(40)
    for (const [kind, spec] of dictionaries) expect([kind, spec.parse('CROWDING', ctx)]).toEqual([kind, null])
    // "positioning" is in POS's and COT's titles, so it is not the word; CROWDING is in no other function's title
    expect(BY_CODE.POS.label.toLowerCase()).toContain('positioning')
    expect(Object.keys(GROUPS_VIEW_WORDS)).not.toContain('POSITIONING')
    for (const f of FUNCTIONS) if (f.code !== 'GRPS') expect([f.code, /crowding/i.test(f.label || '')]).toEqual([f.code, false])
  })
})

describe('a plain word finds the panel', () => {
  it('its words find it first', () => {
    const words = ['sector fundamentals', 'industry fundamentals', 'sector breadth', 'industry breadth', 'sector valuation', 'sector margins',
      'group fundamentals', 'sector table', 'industry table', 'industry rank', 'group rank', 'industry group rank', 'industry ranking',
      'group rank history', 'leading industries', 'sector short interest', 'industry short interest', 'sector crowding',
      'industry crowding']
    expect(BY_CODE.GRPS.keywords).toEqual(words)
    for (const w of words) expect([w, codesForWords(w)[0]]).toEqual([w, 'GRPS'])
  })

  it('the words other functions answer to stay theirs', () => {
    expect(codesForWords('breadth')[0]).toBe('BRD')
    expect(codesForWords('sectors')[0]).toBe('RRG')
    expect(codesForWords('sector performance')[0]).toBe('SCTR')
    expect(codesForWords('fundamentals')[0]).toBe('FA')
    expect(codesForWords('valuation')[0]).toBe('PEER')
    expect(codesForWords('margins')[0]).toBe('FUND')
    expect(codesForWords('drill down')[0]).toBe('GRP')
    // GRPS RANK (2026-11-22): 'rank' stays with RSL and 'sector rank' with SCTR
    expect(codesForWords('rank')[0]).toBe('RSL')
    expect(codesForWords('sector rank')[0]).toBe('SCTR')
    // GRPS CROWDING (2026-11-22): the stock-level positioning words stay with their panels
    expect(codesForWords('positioning')[0]).toBe('POS')
    expect(codesForWords('short interest')[0]).toBe('OWN')                        // as before GRPS CROWDING
    expect(codesForWords('most shorted')[0]).toBe('SHRTS')
    expect(codesForWords('insider buying')[0]).toBe('INS')
    for (const w of ['short interest', 'insider', 'insider buying', 'buying', 'positioning', 'short', 'interest']) {
      expect([w, codesForWords(w).includes('GRPS')]).toEqual([w, false])
    }
  })
})
