// Data wave 2 (2026-11-17): the argument kinds of H52 and RSS.
//
// args.js types RSS's accepted words as a plain map (so the panel's code stays out of the shell's
// first-open bytes), which is a second copy of a vocabulary the panel model owns. This rail pins the
// two together, and checks that H52 reads the side words HILO's kind already yields.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, HILO_SIDE_WORDS, RS_SCREEN_ARG_WORDS, applyArgs } from './args'
import { BY_CODE } from './functions'
import { RS_SCREEN_TOKENS, RS_SCREEN_WORDS, parseRsScreen } from './panels/rsScreensModel'
import { HIGHS52_SIDES, normSide52 } from './panels/highs52Model'

describe('data wave 2 argument kinds match the panels that own the words', () => {
  it('RSS: the word map in args.js is the panel model map, word for word', () => {
    expect(Object.keys(RS_SCREEN_ARG_WORDS).length).toBeGreaterThan(5)
    expect({ ...RS_SCREEN_ARG_WORDS }).toEqual({ ...RS_SCREEN_WORDS })
    for (const [word, id] of Object.entries(RS_SCREEN_ARG_WORDS)) {
      expect(parseRsScreen(word), word).toBe(id)
      expect(ARG_KINDS.rsScreen.parse(word.toLowerCase()), word).toBe(id)
    }
    expect(ARG_KINDS.rsScreen.parse('NVDA')).toBeNull()
  })

  it('RSS: every token the panel writes back is a word the kind accepts, for the same screen', () => {
    for (const [id, token] of Object.entries(RS_SCREEN_TOKENS)) {
      expect(ARG_KINDS.rsScreen.parse(token), id).toBe(id)
    }
  })

  it('H52: every side HILO side words yield is a side the 52-week panel reads, and its tokens parse', () => {
    for (const side of new Set(Object.values(HILO_SIDE_WORDS))) expect(normSide52(side), side).toBe(side)
    for (const [side, spec] of Object.entries(HIGHS52_SIDES)) {
      if (spec.token) expect(ARG_KINDS.hiloSide.parse(spec.token), side).toBe(side)
    }
  })

  it('the registry applies each argument to the prop its panel reads', () => {
    const run = (code, scope, tokens) => applyArgs(BY_CODE[code][scope], tokens)
    expect(run('H52', 'market', ['lows']).props).toEqual({ side: 'lows' })
    expect(run('RSS', 'market', ['nhbp']).props).toEqual({ screen: 'starter_rs_nh_before_price' })
    expect(run('RSS', 'market', ['banana']).ignored).toEqual(['banana'])
    expect(BY_CODE.LEARN.ticker.panel).toBe('Learn')
  })
})
