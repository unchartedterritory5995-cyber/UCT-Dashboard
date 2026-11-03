// F-SB-1 (agent-sc, SAT-1 §B dry run): screen CONDITIONS that name an indicator, a data field or breadth were
// routed without the screener group, so the planner spent its second call on need_groups before it could
// screen. They now ADD the screener group; the group the words already matched stays.
import { describe, it, expect } from 'vitest'
import { selectGroups, wordsSelect } from './routing.js'

const sel = (q) => selectGroups(q).selected

// discovery-corpus ids from agent-sc's dry run on c3ba71c343 (scan/eval/discovery.json)
const SCREENS = {
  d03: ['show me the leaders making new highs', 'breadth'],
  d06: ['unusual volume in semis', 'charts'],
  d07: ['stocks trading at least 3x their average volume', 'charts'],
  d09: ['volume dried up to a 4-week low', 'indicators'],
  d12: ['tight consolidations above the 50-day', 'indicators'],
  d14: ['pullbacks to the 20 EMA in uptrends', 'indicators'],
  d15: ['EMA stack intact and RS line trending up', 'indicators'],
  d16: ['stocks within 3% of their 20-day high', 'indicators'],
  d18: ['RSI over 70', 'indicators'],
  d22: ['small caps under $2B with short float over 20%', 'data'],
  d23: ['reporting earnings in the next 5 days', 'data'],
  d25: ["strongest sectors' leaders", null],              // 'data' came only from soft vocabulary; a screen word now matches
  r01: ['EMA 9 crossing above EMA 20', 'indicators'],          // SC-1 refuses it (IC-1); routing is harmless
  r03: ['stocks where MACD just turned positive', 'indicators'],
}

describe('F-SB-1: screen conditions reach the screener group on the first call', () => {
  for (const [id, [q, kept]] of Object.entries(SCREENS)) {
    it(`${id}: "${q}"`, () => {
      const s = sel(q)
      expect(s).toContain('screener')
      if (kept) expect(s).toContain(kept)   // never drops a group the words themselves named
    })
  }
})

describe('chart and alert commands do not gain the screener group', () => {
  const NOT_SCREENS = [
    'add rsi to this chart',
    'make the rsi line green',
    'change the rsi length to 21',
    'set an alert when NVDA crosses 100',
    'draw a trend line',
    'put the 20 ema on the left chart',
    'remove the macd',
    'what percent of stocks are above the 50 day',
    'when does nvda report earnings',
    'show me NVDA news',
  ]
  for (const q of NOT_SCREENS) {
    it(`"${q}"`, () => { expect(sel(q)).not.toContain('screener') })
  }
})

// 2026-11-03 production miss: a count / list of stocks on a move named no screen word, so the model never saw
// the screener and the server web-researched "today". These now select the screener group.
describe('counts and lists of stocks on a move reach the screener group', () => {
  const SCREENS = [
    'how many stocks are up more than 5% today',
    'how many stocks are up more than 5%',
    'which stocks gained over 5% today',
    'what stocks are down more than 3% this week',
    'stocks up more than 5% today',
    'names that are green on big volume',
  ]
  for (const q of SCREENS) {
    it(`"${q}"`, () => { expect(sel(q)).toContain('screener') })
  }
  const NOT_SCREENS = ['is NVDA up more than 5% today', 'nvda price', 'why is TSLA up today', 'make the up candles green']
  for (const q of NOT_SCREENS) {
    // the screener's own words never match (a message no group matches still falls back to every group)
    it(`not a screen: "${q}"`, () => { expect(wordsSelect('screener', q)).toBe(false) })
  }
})
