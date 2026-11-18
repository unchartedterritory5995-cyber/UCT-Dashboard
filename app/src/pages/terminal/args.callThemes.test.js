// CEOS (what CEOs are saying): its two argument kinds.
//
// args.js keeps its own small copy of the list words the panel model owns (so the panel's code
// stays out of the shell's first-open bytes). This rail pins the copy to its owner, and the
// registry to the props the panel reads.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, CALL_THEMES_LIST_WORDS, applyArgs } from './args'
import { BY_CODE, FUNCTIONS } from './functions'
import { writeBackCommand } from './panels/commandWriteBack'
import {
  CALL_THEMES_CODE, CALL_THEMES_LIST_ARG_WORDS, CALL_THEME_LISTS, callThemesCommandArgs, parseCallThemesList, parseCallThemesMonth,
} from './panels/callThemesModel'

describe('CEOS argument kinds match the panel that owns the words', () => {
  it('the list copy equals the model, word for word, and every chip token is taken', () => {
    expect(CALL_THEMES_LIST_WORDS).toEqual(CALL_THEMES_LIST_ARG_WORDS)
    for (const [word, value] of Object.entries(CALL_THEMES_LIST_ARG_WORDS)) {
      expect(ARG_KINDS.callThemesList.parse(word.toLowerCase()), word).toBe(value)
      expect(parseCallThemesList(word), word).toBe(value)
      expect(ARG_KINDS.callThemesList.describe(value)).toBeTruthy()
    }
    for (const [value, spec] of Object.entries(CALL_THEME_LISTS)) {
      if (spec.token) expect(ARG_KINDS.callThemesList.parse(spec.token), value).toBe(value)
    }
    expect(ARG_KINDS.callThemesList.parse('NVDA')).toBeNull()
    expect(ARG_KINDS.callThemesList.parse('toString')).toBeNull()
  })

  it('the month kind reads exactly what the model reads', () => {
    for (const tok of ['2026-10', '2026-9', '2026/10', '2026-13', '2026-00', '1999-10', '2026', 'OCT', '2026-10-05', 'NEW', '', null]) {
      expect(ARG_KINDS.callThemesMonth.parse(tok), String(tok)).toBe(parseCallThemesMonth(tok))
    }
    expect(ARG_KINDS.callThemesMonth.parse('2026-9')).toBe('2026-09')
    expect(ARG_KINDS.callThemesMonth.describe('2026-10')).toBe('month 2026-10')
  })

  it('the registry applies each word to the prop the panel reads, in either order', () => {
    expect(CALL_THEMES_CODE).toBe('CEOS')
    const run = (tokens) => applyArgs(BY_CODE.CEOS.market, tokens)
    expect(run(['RISING', '2026-10']).props).toEqual({ list: 'rising', month: '2026-10' })
    expect(run(['2026-10', 'rising']).props).toEqual({ list: 'rising', month: '2026-10' })
    expect(run(['new']).props).toEqual({ list: 'new' })
    expect(run([]).props).toEqual({})
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['NEW', 'RISING']).ignored).toEqual(['RISING'])        // one list at a time
    // what the panel writes back is read as the same picks, so a chip never snaps back
    expect(run(callThemesCommandArgs({ list: 'new', month: '2026-10' })).props).toEqual({ list: 'new', month: '2026-10' })
    expect(writeBackCommand('CEOS', callThemesCommandArgs({ list: 'rising', month: '2026-10' }))).toBe('CEOS RISING 2026-10')
    expect(writeBackCommand('CEOS', callThemesCommandArgs({}))).toBe('CEOS')
  })

  it('CEOS is registered once, beside the call search it opens, and is a market function', () => {
    const f = BY_CODE.CEOS
    expect(FUNCTIONS.filter((x) => x.code === 'CEOS')).toHaveLength(1)
    expect([f.group, f.market.panel, !!f.ticker]).toEqual(['Market', 'CallThemes', false])
    expect(f.example).toBe('CEOS RISING')
    expect(BY_CODE.TSRC.market.panel).toBe('CallSearch')
    // the command a phrase opens is one the call search takes whole
    expect(applyArgs(BY_CODE.TSRC.market, ['"PRICING', 'POWER"']).props).toEqual({ q: '"pricing power"' })
  })
})
