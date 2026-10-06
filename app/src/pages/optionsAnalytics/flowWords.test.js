import { describe, it, expect } from 'vitest'
import { sideWords, tradeTypeWords, callPutWords } from './flowWords'

describe('flowWords', () => {
  it('says the tape side codes in the house words', () => {
    expect(['AA', 'A', 'B', 'BB', 'M', '', null].map(sideWords))
      .toEqual(['Above ask', 'At ask', 'At bid', 'Below bid', 'At mid', 'Unsided', 'Unsided'])
    expect(sideWords(' bb ')).toBe('Below bid')
  })
  it('says the trade type and call/put as words, never the raw enum', () => {
    expect(['SWEEP', 'BLOCK', 'SPLIT', 'MULTI_LEG'].map(tradeTypeWords)).toEqual(['Sweep', 'Block', 'Split', 'Multi Leg'])
    expect(['call', 'put', 'C', 'P'].map(callPutWords)).toEqual(['Call', 'Put', 'Call', 'Put'])
  })
})
