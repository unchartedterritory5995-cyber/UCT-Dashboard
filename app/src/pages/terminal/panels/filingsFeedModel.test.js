// FEED's pure half (filingsFeedModel.js): the chips, the words, the query, the write-back and the dilution words.
import { describe, it, expect } from 'vitest'
import {
  DILUTION, DILUTION_FORMS, FEED_FORMS, dilutionWords, feedCommandArgs, feedFormChip, feedFormNoun, feedFormQuery,
  feedTickerUrl, normFeedForm, parseFeedForm,
} from './filingsFeedModel'

describe('the chips and the words', () => {
  it('one chip per form the server reads, All first, Dilution last, each with its own token', () => {
    expect(FEED_FORMS.map((f) => f.label)).toEqual(['All', '8-K', '10-Q', '10-K', 'Form 4', '13D', '13G', 'S-1', 'Dilution'])
    expect(FEED_FORMS[0]).toMatchObject({ value: null, token: null })
    for (const f of FEED_FORMS.slice(1)) expect(parseFeedForm(f.token), f.label).toBe(f.value)
    expect(new Set(FEED_FORMS.map((f) => f.token)).size).toBe(FEED_FORMS.length)
  })

  it('normalises a prop, a typed word, or the old chip word All', () => {
    expect(normFeedForm(null)).toBeNull()
    expect(normFeedForm('All')).toBeNull()
    expect(normFeedForm('SCHEDULE 13D')).toBe('SCHEDULE 13D')
    expect(normFeedForm('8k')).toBe('8-K')
    expect(normFeedForm('offerings')).toBe(DILUTION)
    expect(normFeedForm('toString')).toBeNull()
    expect(feedFormChip('nonsense').label).toBe('All')
  })

  it('the query, and what a pick writes back', () => {
    expect(feedFormQuery(null)).toBe('')
    expect(feedFormQuery('SCHEDULE 13G')).toBe('?form=SCHEDULE%2013G')
    expect(feedFormQuery('DILUTION')).toBe('?form=DILUTION')
    expect(feedCommandArgs({})).toEqual([])
    expect(feedCommandArgs({ form: '4' })).toEqual(['FORM4'])
    expect(feedCommandArgs({ form: DILUTION, mine: true })).toEqual(['DILUTION', 'MINE'])
    expect(feedTickerUrl(' nvda ')).toBe('/api/research/filings-feed/NVDA')
  })
})

describe('the words a row and an empty answer use', () => {
  it('names each form in a sentence', () => {
    expect(feedFormNoun(null)).toBe('filing in the forms this feed covers')
    expect(feedFormNoun('4')).toBe('Form 4 filing')
    expect(feedFormNoun('SCHEDULE 13D')).toBe('Schedule 13D filing')
    expect(feedFormNoun(DILUTION)).toBe('share-offering filing (S-1, S-3, 424B or S-8)')
  })

  it('says what each dilution form is, amendments included, and nothing for other forms', () => {
    expect(dilutionWords('S-3')).toBe('Shelf registration (shares it may sell later)')
    expect(dilutionWords('S-3/A')).toBe('Shelf registration (shares it may sell later), amended')
    expect(dilutionWords('424B5')).toBe('Prospectus (shares being sold now)')
    expect(dilutionWords('424B7')).toBe('Prospectus (shares being sold now)')
    expect(dilutionWords('424B6')).toBeNull()
    expect(dilutionWords('S-8')).toBe('Shares for an employee stock plan')
    expect(dilutionWords('8-K')).toBeNull()
    for (const f of DILUTION_FORMS) expect(dilutionWords(f), f).toBeTruthy()
  })
})
