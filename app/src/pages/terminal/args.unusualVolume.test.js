// Unusual volume (2026-11-18): the argument kinds of UNVOL.
//
// args.js keeps its own small copies of vocabularies the panel model owns (so the panel's code
// stays out of the shell's first-open bytes). This rail pins each copy to its owner.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, UNVOL_MIN_WORDS, UNVOL_SIDE_WORDS, applyArgs } from './args'
import { BY_CODE, isCode } from './functions'
import parseCommand from './parseCommand'
import {
  UNVOL_MINS, UNVOL_MIN_ARG_WORDS, UNVOL_SIDES, UNVOL_SIDE_ARG_WORDS, parseUnvolMin, parseUnvolSide, unvolCommandArgs,
} from './panels/unusualVolumeModel'

describe('the unusual volume argument kinds match the panel that owns the words', () => {
  it.each([
    ['unvolSide', UNVOL_SIDE_WORDS, UNVOL_SIDE_ARG_WORDS, parseUnvolSide, UNVOL_SIDES, (k) => k],
    ['unvolMin', UNVOL_MIN_WORDS, UNVOL_MIN_ARG_WORDS, parseUnvolMin, UNVOL_MINS, (k) => Number(k)],
  ])('%s: the copy equals the model, word for word, and every chip token is taken', (kind, copy, owner, parse, chips, valueOf) => {
    expect(copy).toEqual(owner)
    for (const [word, value] of Object.entries(owner)) {
      expect(ARG_KINDS[kind].parse(word.toLowerCase()), word).toBe(value)
      expect(parse(word), word).toBe(value)
    }
    for (const [key, spec] of Object.entries(chips)) {
      if (spec.token) expect(ARG_KINDS[kind].parse(spec.token), key).toBe(valueOf(key))
    }
    for (const no of ['NVDA', 'toString', '', '4X']) expect(ARG_KINDS[kind].parse(no), no).toBeNull()
    expect(ARG_KINDS[kind].describe(Object.values(owner)[0])).toBeTruthy()
  })

  it('no word is taken by both kinds, so the order typed does not matter', () => {
    const words = [...Object.keys(UNVOL_SIDE_WORDS), ...Object.keys(UNVOL_MIN_WORDS)]
    expect(new Set(words).size).toBe(words.length)
  })

  it('the registry applies each word to the prop the panel reads, in either order', () => {
    const run = (tokens) => applyArgs(BY_CODE.UNVOL.market, tokens)
    expect(run(['up', '3x']).props).toEqual({ side: 'up', min: 3 })
    expect(run(['5X', 'DOWN']).props).toEqual({ side: 'down', min: 5 })
    expect(run(['losers']).props).toEqual({ side: 'down' })
    expect(run(['banana']).ignored).toEqual(['banana'])
    expect(run(['up', 'down']).ignored).toEqual(['down'])     // one direction: the second is said, not dropped
    // what the panel writes back is read as the same picks
    expect(run(unvolCommandArgs({ side: 'down', min: 5 })).props).toEqual({ side: 'down', min: 5 })
    expect(unvolCommandArgs({})).toEqual([])
    expect(ARG_KINDS.unvolMin.describe(3)).toBe('3× its usual volume or more')
    expect(ARG_KINDS.unvolSide.describe('down')).toBe('down on the day')
  })

  it('UNVOL is market-wide, and MOST keeps its own RVOL word', () => {
    expect(BY_CODE.UNVOL.ticker).toBeUndefined()
    expect(parseCommand('UNVOL UP 3X')).toMatchObject({ ok: true, type: 'function', code: 'UNVOL' })
    // RVOL stays an argument of MOST, never a code of its own: `MOST RVOL` must keep meaning the burst lens
    expect(isCode('RVOL')).toBe(false)
    expect(applyArgs(BY_CODE.MOST.market, ['RVOL']).props).toEqual({ lens: 'volume' })
  })
})
