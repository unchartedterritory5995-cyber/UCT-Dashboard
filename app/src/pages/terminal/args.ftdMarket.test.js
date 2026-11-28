// Bare FTD (2026-11-27): the market variant and its rank argument, pinned to the model that owns the words.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, FTD_RANK_WORDS, applyArgs } from './args'
import { BY_CODE, variantFor } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { FTD_RANKS, FTD_RANK_ARG_WORDS, ftdCommandArgs } from './panels/ftdMarketModel'
import { shareClassOf, shareDecision } from './share/shareRule'

describe('FTD rank', () => {
  it('the copy equals the model, and every chip token is taken', () => {
    expect(FTD_RANK_WORDS).toEqual(FTD_RANK_ARG_WORDS)
    for (const [w, v] of Object.entries(FTD_RANK_ARG_WORDS)) expect(ARG_KINDS.ftdRank.parse(w.toLowerCase()), w).toBe(v)
    for (const r of Object.values(FTD_RANKS)) if (r.token) expect(ARG_KINDS.ftdRank.parse(r.token)).not.toBeNull()
    for (const no of ['NVDA', 'toString', '', 'SUM']) expect(ARG_KINDS.ftdRank.parse(no), no).toBeNull()
  })

  it('bare FTD is the market list on its own panel and the same flag; NVDA FTD is still the series', () => {
    expect(BY_CODE.FTD.market).toEqual({ panel: 'FtdMarket', flag: 'researchDepth.ftd_dataset_enabled', args: [{ kind: 'ftdRank', prop: 'rank' }] })
    expect(BY_CODE.FTD.ticker).toMatchObject({ panel: 'Ftd', flag: 'researchDepth.ftd_dataset_enabled' })
    expect(variantFor('FTD', false)).toMatchObject({ scope: 'market' })
    expect(applyArgs(BY_CODE.FTD.market, ['VALUE']).props).toEqual({ rank: 'value' })
    expect(applyArgs(BY_CODE.FTD.market, ['VALUE', 'SHARES']).ignored).toEqual(['SHARES'])
    for (const rank of Object.keys(FTD_RANKS)) {
      const tokens = ftdCommandArgs(rank)
      expect(applyArgs(BY_CODE.FTD.market, tokens).props.rank ?? 'shares').toBe(rank)
      expect(writeBackCommand('FTD', tokens)).toBe(['FTD', ...tokens].join(' '))
    }
    const cmd = parseCommand('FTD VALUE')
    expect(cmd.ok && cmd.code === 'FTD' && cmd.args[0] === 'VALUE').toBe(true)
  })

  it('the market list is public SEC data, so it may be shared like the series', () => {
    expect(shareClassOf('FTD')).toBe('public')
    expect(shareDecision(BY_CODE.FTD, BY_CODE.FTD.market)).toMatchObject({ offered: true, image: true, file: true, cls: 'public' })
  })
})
