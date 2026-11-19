// Data wave 3 (2026-11-17): the argument kinds of PERF and FLWL.
//
// args.js keeps its own small copies of two vocabularies the panel models own (so the panels'
// code stays out of the shell's first-open bytes). This rail pins each copy to its owner.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, FLOW_LIST_ARG_WORDS, applyArgs } from './args'
import { BY_CODE } from './functions'
import { FLOW_LISTS, parseFlowList } from './panels/flowListsModel'
import { parsePerformanceAccount, performanceCommandArgs } from './panels/performanceModel'

describe('data wave 3 argument kinds match the panels that own the words', () => {
  it('FLWL: each word parses to the list the panel model gives, and every chip token is accepted', () => {
    expect(Object.keys(FLOW_LIST_ARG_WORDS).length).toBeGreaterThan(3)
    for (const [word, list] of Object.entries(FLOW_LIST_ARG_WORDS)) {
      expect(parseFlowList(word), word).toBe(list)
      expect(ARG_KINDS.flowList.parse(word.toLowerCase()), word).toBe(list)
    }
    expect([...new Set(Object.values(FLOW_LIST_ARG_WORDS))].sort()).toEqual(Object.keys(FLOW_LISTS).sort())
    for (const [list, spec] of Object.entries(FLOW_LISTS)) {
      if (spec.token) expect(ARG_KINDS.flowList.parse(spec.token), list).toBe(list)
    }
    expect(ARG_KINDS.flowList.parse('NVDA')).toBeNull()
  })

  it('PERF: the kind reads an account word exactly as the panel model does', () => {
    for (const word of ['ALL', 'all', '1', '2', '10', '99', '0', '100', '-1', '1.5', 'NVDA', '', 'two']) {
      expect(ARG_KINDS.journalAccount.parse(word), word).toBe(parsePerformanceAccount(word))
    }
    expect(ARG_KINDS.journalAccount.parse('ALL')).toBe('all')
    expect(ARG_KINDS.journalAccount.parse('2')).toBe(2)
    expect(ARG_KINDS.journalAccount.parse('0')).toBeNull()
    // what the panel writes back is a word the kind takes, for the same account
    for (const account of ['all', 1, 3]) {
      const [token] = performanceCommandArgs({ account })
      expect(ARG_KINDS.journalAccount.parse(token), String(account)).toBe(account)
    }
  })

  it('the registry applies each argument to the prop its panel reads', () => {
    const run = (code, tokens) => applyArgs(BY_CODE[code].market, tokens)
    expect(run('PERF', ['all']).props).toEqual({ account: 'all' })
    expect(run('PERF', ['2']).props).toEqual({ account: 2 })
    expect(run('FLWL', ['open']).props).toEqual({ list: 'open' })
    expect(run('FLWL', ['banana']).ignored).toEqual(['banana'])
  })
})
