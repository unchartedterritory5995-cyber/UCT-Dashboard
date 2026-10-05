import { describe, it, expect } from 'vitest'
import { buildTTSText } from './CallRecapSection'
import { normalizeCallRecap } from '../research/callRecap'

// TRAN read-aloud -- the section reads a NORMALIZED recap, whose Q&A items are
// objects. Joining them raw read "[object Object]" aloud.
describe('buildTTSText', () => {
  it('reads each Q&A highlight as its takeaway, else its verbatim quote', () => {
    const recap = normalizeCallRecap({
      recap: {
        headline: 'Strong quarter',
        qa_highlights: [
          { analyst: 'A', question: 'Margins?', takeaway: 'Margins expand next year', quote: 'we see expansion' },
          { analyst: 'B', quote: 'Demand remains robust' },
          'Legacy string highlight',
        ],
      },
    })
    const text = buildTTSText(recap)
    expect(text).not.toContain('[object Object]')
    expect(text).toContain('Q&A highlights: Margins expand next year. Demand remains robust. Legacy string highlight')
  })

  it('omits the Q&A clause when there are no highlights', () => {
    expect(buildTTSText(normalizeCallRecap({ recap: { headline: 'H', qa_highlights: [] } }))).not.toContain('Q&A')
  })
})
