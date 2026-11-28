// INS SELLS / INS BOTH / INS 30D (2026-11-27): the argument kinds of INS, pinned to the panel model that owns the words.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, INS_SIDE_WORDS, INS_WINDOW_WORDS, applyArgs } from './args'
import { BY_CODE } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { INS_SIDES, INS_SIDE_ARG_WORDS, INS_WINDOWS, INS_WINDOW_ARG_WORDS, insCommandArgs } from './panels/insiderMarketModel'

describe('the copies equal the model, word for word', () => {
  it('side and window', () => {
    expect(INS_SIDE_WORDS).toEqual(INS_SIDE_ARG_WORDS)
    expect(INS_WINDOW_WORDS).toEqual(INS_WINDOW_ARG_WORDS)
    for (const [w, v] of Object.entries(INS_SIDE_ARG_WORDS)) expect(ARG_KINDS.insSide.parse(w.toLowerCase()), w).toBe(v)
    for (const [w, v] of Object.entries(INS_WINDOW_ARG_WORDS)) expect(ARG_KINDS.insWindow.parse(w), w).toBe(v)
    for (const s of Object.values(INS_SIDES)) if (s.token) expect(ARG_KINDS.insSide.parse(s.token)).not.toBeNull()
    for (const w of Object.values(INS_WINDOWS)) if (w.token) expect(ARG_KINDS.insWindow.parse(w.token)).not.toBeNull()
    for (const no of ['NVDA', 'toString', '', 'CLUSTER', '14D']) {
      expect(ARG_KINDS.insSide.parse(no), no).toBeNull()
      expect(ARG_KINDS.insWindow.parse(no), no).toBeNull()
    }
  })
})

describe('the registry applies each word to the prop the panel reads', () => {
  const run = (tokens) => applyArgs(BY_CODE.INS.market, tokens)
  it('side, window, both together, and the cluster view beside them', () => {
    expect(run(['SELLS']).props).toEqual({ side: 'sells' })
    expect(run(['30D']).props).toEqual({ window: 30 })
    expect(run(['BOTH', '90D']).props).toEqual({ side: 'both', window: 90 })
    expect(run(['CLUSTER']).props).toEqual({ view: 'cluster' })
    expect(run(['SELLS', 'BUYS']).ignored).toEqual(['BUYS'])
    expect(run(['banana']).ignored).toEqual(['banana'])
  })

  it('what a pick writes back is read as the same pick; the defaults are bare INS', () => {
    for (const side of Object.keys(INS_SIDES)) {
      for (const window of Object.keys(INS_WINDOWS).map(Number)) {
        const tokens = insCommandArgs({ side, window })
        const props = run(tokens).props
        expect(props.side ?? 'buys').toBe(side)
        expect(props.window ?? 7).toBe(window)
        expect(writeBackCommand('INS', tokens)).toBe(['INS', ...tokens].join(' '))
      }
    }
    expect(writeBackCommand('INS', [])).toBe('INS')
  })

  it('a typed command parses and keeps its words', () => {
    const cmd = parseCommand('INS SELLS 30D')
    expect(cmd.ok).toBe(true)
    expect(cmd.code).toBe('INS')
    expect(cmd.args).toEqual(['SELLS', '30D'])
  })
})
