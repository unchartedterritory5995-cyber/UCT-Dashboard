import { describe, it, expect } from 'vitest'
import { memberText } from './memberCopy'

describe('memberText strips engineering detail and keeps the meaning', () => {
  it.each([
    ['FMP /stable/key-executives', 'FMP'],
    ['FMP /stable/governance-executive-compensation (proxy summary compensation table)', 'FMP (proxy summary compensation table)'],
    ['FMP /stable/analyst-estimates (period=quarter), snapshotted daily by UCT', 'FMP, snapshotted daily by UCT'],
    ['EDGAR Form 4 reading is switched off on this server (EDGAR_OWNERSHIP_ENABLED)', 'EDGAR Form 4 reading is switched off'],
    ['FMP refused /stable/analyst-estimates on this plan (401/403); this is an access problem, not an absence of analyst coverage',
      'FMP refused the request; this is an access problem, not an absence of analyst coverage'],
    ["FMP grades (the Analyst Ratings tab's read, analyst_grades), rating actions only", 'FMP grades, rating actions only'],
    ['FMP does not publish estimate revisions on this plan', 'FMP does not publish estimate revisions'],
    ['SEC EDGAR Form 4', 'SEC EDGAR Form 4'],
    ['no fails reported for GME between 2026-08-17 and 2026-09-15', 'no fails reported for GME between 2026-08-17 and 2026-09-15'],
  ])('%s', (input, out) => { expect(memberText(input)).toBe(out) })

  it('passes null through', () => { expect(memberText(null)).toBe(null) })
})

import { memberSentence } from './memberCopy'
describe('more internal detail and sentence shape', () => {
  it.each([
    ['UCT catalyst engine (catalysts.db)', 'UCT catalyst engine'],
    ['earnings payload (earnings_intel)', 'earnings payload'],
    ['fetch failed: ReadTimeout', 'fetch failed'],
  ])('%s', (i, o) => { expect(memberText(i)).toBe(o) })
  it('capitalises and closes a server reason', () => {
    expect(memberSentence('no fails reported for NVDA between 2026-08-17 and 2026-09-15'))
      .toBe('No fails reported for NVDA between 2026-08-17 and 2026-09-15.')
    expect(memberSentence('daily bars for NVDA could not be read.')).toBe('Daily bars for NVDA could not be read.')
    expect(memberSentence(null)).toBe(null)
  })
})
