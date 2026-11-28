// FEED (2026-11-27): the market variant and the form argument, pinned to the model that owns the words.
import { describe, it, expect } from 'vitest'
import { ARG_KINDS, FEED_FORM_WORDS, applyArgs } from './args'
import { BY_CODE, variantFor } from './functions'
import parseCommand from './parseCommand'
import { writeBackCommand } from './panels/commandWriteBack'
import { FEED_FORMS, FEED_FORM_ARG_WORDS, feedCommandArgs } from './panels/filingsFeedModel'

describe('the copy equals the model, word for word', () => {
  it('every word, every chip token, and nothing else', () => {
    expect(FEED_FORM_WORDS).toEqual(FEED_FORM_ARG_WORDS)
    for (const [w, v] of Object.entries(FEED_FORM_ARG_WORDS)) expect(ARG_KINDS.feedForm.parse(w.toLowerCase()), w).toBe(v)
    for (const chip of FEED_FORMS) if (chip.token) expect(ARG_KINDS.feedForm.parse(chip.token), chip.label).toBe(chip.value)
    for (const no of ['NVDA', 'toString', '', 'MINE', '424B6', 'DEF14A']) expect(ARG_KINDS.feedForm.parse(no), no).toBeNull()
    expect(ARG_KINDS.feedForm.describe('DILUTION')).toBe('share-offering filings (S-1, S-3, 424B, S-8)')
    expect(ARG_KINDS.feedForm.describe('4')).toBe('Form 4 filings')
  })
})

describe('FEED in the registry', () => {
  it('bare FEED is the market feed on the same panel, flag and form argument; NVDA FEED stays the company', () => {
    expect(BY_CODE.FEED.market).toMatchObject({ panel: 'FilingsFeed', flag: 'filingsFeedEnabled', props: { market: true } })
    expect(BY_CODE.FEED.ticker).toMatchObject({ panel: 'FilingsFeed', section: 'filings-feed', flag: 'filingsFeedEnabled' })
    expect(variantFor('FEED', false)).toMatchObject({ scope: 'market' })
    expect(variantFor('FEED', true)).toMatchObject({ scope: 'ticker' })
    for (const side of ['market', 'ticker']) {
      const kinds = BY_CODE.FEED[side].args.map((a) => a.kind)
      expect(kinds, side).toEqual(expect.arrayContaining(['feedForm', 'mine']))
    }
  })

  it('applies a form and MINE on either variant, and says what it did not take', () => {
    expect(applyArgs(BY_CODE.FEED.market, ['8-K']).props).toEqual({ form: '8-K' })
    expect(applyArgs(BY_CODE.FEED.market, ['DILUTION', 'MINE']).props).toEqual({ form: 'DILUTION', mine: true })
    expect(applyArgs(BY_CODE.FEED.ticker, ['10K']).props).toEqual({ form: '10-K' })
    expect(applyArgs(BY_CODE.FEED.market, ['8-K', '10-K']).ignored).toEqual(['10-K'])
  })

  it('what a chip writes back is read as the same pick, with and without a stock', () => {
    for (const chip of FEED_FORMS) {
      for (const mine of [false, true]) {
        const tokens = feedCommandArgs({ form: chip.value, mine })
        const props = applyArgs(BY_CODE.FEED.market, tokens).props
        expect(props.form ?? null, chip.label).toBe(chip.value)
        expect(!!props.mine).toBe(mine)
        expect(writeBackCommand('FEED', tokens)).toBe(['FEED', ...tokens].join(' '))
        expect(writeBackCommand('FEED', tokens, 'nvda')).toBe(['NVDA', 'FEED', ...tokens].join(' '))
      }
    }
  })

  it('typed commands parse with their words', () => {
    for (const [line, sym, args] of [['FEED', null, []], ['FEED 8-K', null, ['8-K']], ['FEED DILUTION', null, ['DILUTION']],
      ['NVDA FEED 10-K', 'NVDA', ['10-K']], ['FEED S-1 MINE', null, ['S-1', 'MINE']]]) {
      const cmd = parseCommand(line)
      expect(cmd.ok, `${line}: ${cmd.error}`).toBe(true)
      expect(cmd.code).toBe('FEED')
      expect(cmd.sym ?? null, line).toBe(sym)
      expect(cmd.args, line).toEqual(args)
    }
  })
})
