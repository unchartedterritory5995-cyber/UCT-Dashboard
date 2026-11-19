// Data wave 6 (2026-11-17): the argument kinds of TOPF.
//
// args.js keeps its own small copies of vocabularies the panel model owns (so the panel's code
// stays out of the shell's first-open bytes). This rail pins each copy to its owner.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, TOP_FLOW_STATUS_WORDS, TOP_FLOW_DIRECTION_WORDS, TOP_FLOW_SORT_WORDS, applyArgs } from './args'
import { BY_CODE } from './functions'
import {
  TOP_FLOW_STATUS_ARG_WORDS, TOP_FLOW_DIRECTION_ARG_WORDS, TOP_FLOW_SORT_ARG_WORDS,
  TOP_FLOW_STATUSES, TOP_FLOW_DIRECTIONS, TOP_FLOW_SORTS,
  parseTopFlowStatus, parseTopFlowDirection, parseTopFlowSort, topFlowCommandArgs,
} from './panels/topFlowModel'

describe('data wave 6 argument kinds match the panel that owns the words', () => {
  it.each([
    ['topFlowStatus', TOP_FLOW_STATUS_WORDS, TOP_FLOW_STATUS_ARG_WORDS, parseTopFlowStatus, TOP_FLOW_STATUSES],
    ['topFlowDirection', TOP_FLOW_DIRECTION_WORDS, TOP_FLOW_DIRECTION_ARG_WORDS, parseTopFlowDirection, TOP_FLOW_DIRECTIONS],
    ['topFlowSort', TOP_FLOW_SORT_WORDS, TOP_FLOW_SORT_ARG_WORDS, parseTopFlowSort, TOP_FLOW_SORTS],
  ])('%s: the copy equals the model, word for word, and every chip token is taken', (kind, copy, owner, parse, chips) => {
    expect(copy).toEqual(owner)
    for (const [word, value] of Object.entries(owner)) {
      expect(ARG_KINDS[kind].parse(word.toLowerCase()), word).toBe(value)
      expect(parse(word), word).toBe(value)
    }
    for (const [value, spec] of Object.entries(chips)) {
      if (spec.token) expect(ARG_KINDS[kind].parse(spec.token), value).toBe(value)
    }
    expect(ARG_KINDS[kind].parse('NVDA')).toBeNull()
    expect(ARG_KINDS[kind].describe(Object.values(owner)[0])).toBeTruthy()
  })

  it('no word is taken by two of the three kinds, so the order typed does not matter', () => {
    const maps = [TOP_FLOW_STATUS_WORDS, TOP_FLOW_DIRECTION_WORDS, TOP_FLOW_SORT_WORDS]
    const words = maps.flatMap((m) => Object.keys(m))
    expect(new Set(words).size).toBe(words.length)
  })

  it('the registry applies each word to the prop the panel reads, in any order', () => {
    const run = (tokens) => applyArgs(BY_CODE.TOPF.market, tokens)
    expect(run(['expired', 'bear', 'peak']).props).toEqual({ status: 'expired', direction: 'bearish', sort: 'peak' })
    expect(run(['peak', 'bear', 'expired']).props).toEqual({ status: 'expired', direction: 'bearish', sort: 'peak' })
    expect(run(['open']).props).toEqual({ status: 'open' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    // what the panel writes back is read as the same picks
    expect(run(topFlowCommandArgs({ status: 'expired', direction: 'bearish', sort: 'peak' })).props)
      .toEqual({ status: 'expired', direction: 'bearish', sort: 'peak' })
    expect(topFlowCommandArgs({})).toEqual([])
  })

  it('IDAY takes no arguments', () => {
    expect(BY_CODE.IDAY.market.args ?? []).toEqual([])
    expect(applyArgs(BY_CODE.IDAY.market, ['anything']).ignored).toEqual(['anything'])
  })
})
