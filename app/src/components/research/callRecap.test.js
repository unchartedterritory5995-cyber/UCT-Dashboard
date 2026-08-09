import { describe, it, expect } from 'vitest'
import { normalizeCallRecap, guidanceKind, recapEmptyState } from './callRecap'

const payload = {
  ticker: 'NVDA',
  recap: { headline: 'Data-centre revenue beat again', sentiment: 'bullish',
           bullets: ['a', 'b'], quotes: [{ speaker: 'CEO', text: 'x' }],
           guidance: 'raised', qa_highlights: ['q1'] },
  webcast_url: 'https://ir.example/live',
  rating_changes: [{ period: '2026-08', net_delta: 2 }],
}

describe('normalizeCallRecap', () => {
  it('flattens the wrapper into the shape CallRecapSection actually reads', () => {
    const out = normalizeCallRecap(payload)
    // inner fields
    expect(out.headline).toBe('Data-centre revenue beat again')
    expect(out.bullets).toEqual(['a', 'b'])
    expect(out.guidance).toBe('raised')
    // outer fields — these live on the WRAPPER and are lost by `recapData?.recap`
    expect(out.webcast_url).toBe('https://ir.example/live')
    expect(out.rating_changes).toHaveLength(1)
  })

  it('returns null when there is no recap body, even if the wrapper exists', () => {
    expect(normalizeCallRecap({ ticker: 'NVDA', recap: null, webcast_url: null })).toBeNull()
    expect(normalizeCallRecap(null)).toBeNull()
  })

  it('tolerates an already-flat recap (defensive against a future payload change)', () => {
    const flat = { headline: 'h', bullets: [], webcast_url: 'u' }
    expect(normalizeCallRecap(flat).headline).toBe('h')
    expect(normalizeCallRecap(flat).webcast_url).toBe('u')
  })

  it('never lets an outer null clobber an inner value', () => {
    const out = normalizeCallRecap({ recap: { headline: 'h', webcast_url: 'inner' },
                                     webcast_url: null })
    expect(out.webcast_url).toBe('inner')
  })

  // Phantom-zero: rating_changes / webcast_url must be distinguished from a
  // genuine falsy-but-present value (an empty array is NOT "absent"; the
  // outer-clobber loop above uses `!= null`, not truthiness, on purpose).
  it('keeps a genuinely empty rating_changes array rather than treating it as absent', () => {
    const out = normalizeCallRecap({
      recap: { headline: 'h' }, rating_changes: [], webcast_url: null,
    })
    expect(out.rating_changes).toEqual([])
  })
})

// ── Shape reconciliation ──────────────────────────────────────────────────────
//
// Three producer/consumer disagreements, each of which was live in production.

describe('normalizeCallRecap — quote shapes', () => {
  it('accepts the {topic, quote} shape the service actually emits', () => {
    // call_recap.py's prompt asks for {topic, quote}; the renderer read
    // {speaker, text}. Result: empty quotation marks on every recap.
    const out = normalizeCallRecap({
      recap: { headline: 'h', quotes: [{ topic: 'Margins', quote: 'We see leverage.' }] },
    })
    expect(out.quotes).toEqual([
      // `segment` is null here because this payload predates grounding; when the
      // server locates the quote it fills in the verified transcript index.
      { speaker: '', role: '', topic: 'Margins', text: 'We see leverage.', segment: null },
    ])
  })

  it('still accepts the {speaker, text} shape', () => {
    const out = normalizeCallRecap({
      recap: { headline: 'h', quotes: [{ speaker: 'CEO', text: 'Firing on all cylinders.' }] },
    })
    expect(out.quotes[0]).toMatchObject({ speaker: 'CEO', text: 'Firing on all cylinders.' })
  })

  it('accepts a bare string', () => {
    const out = normalizeCallRecap({ recap: { headline: 'h', quotes: ['Plain quote.'] } })
    expect(out.quotes[0].text).toBe('Plain quote.')
  })

  it('drops quotes with no text rather than rendering empty quotation marks', () => {
    const out = normalizeCallRecap({
      recap: { headline: 'h', quotes: [{ topic: 'Margins' }, null, 42, { quote: '   ' }] },
    })
    expect(out.quotes).toEqual([])
  })

  it('every quote exposes a string `text` — the crash was an object reaching .toLowerCase()', () => {
    const out = normalizeCallRecap({
      recap: { headline: 'h', quotes: [{ topic: 'a', quote: 'x' }, 'y', { speaker: 'CFO', text: 'z' }] },
    })
    for (const q of out.quotes) expect(typeof q.text).toBe('string')
    expect(() => out.quotes.filter(q => q.text.toLowerCase().includes('x'))).not.toThrow()
  })
})

describe('normalizeCallRecap — sentiment vocabulary', () => {
  it('passes the service vocabulary through', () => {
    expect(normalizeCallRecap({ recap: { headline: 'h', sentiment: 'positive' } }).sentiment)
      .toBe('positive')
  })

  it('maps the legacy bullish/bearish labels onto it', () => {
    expect(normalizeCallRecap({ recap: { headline: 'h', sentiment: 'bullish' } }).sentiment)
      .toBe('positive')
    expect(normalizeCallRecap({ recap: { headline: 'h', sentiment: 'bearish' } }).sentiment)
      .toBe('negative')
  })

  it('absent stays absent — it must not become a neutral CLAIM', () => {
    expect(normalizeCallRecap({ recap: { headline: 'h' } }).sentiment).toBeNull()
  })
})

describe('normalizeCallRecap — bullets are strings, Q&A is structured', () => {
  it('flattens bullets and drops empties', () => {
    const out = normalizeCallRecap({
      recap: { headline: 'h', bullets: ['plain', { text: 'wrapped' }, '', null] },
    })
    expect(out.bullets).toEqual(['plain', 'wrapped'])
    for (const b of out.bullets) expect(typeof b).toBe('string')
  })

  // Q&A deliberately stopped being a flat string list: an exchange carries an
  // analyst, a firm, the model's takeaway, and a SEPARATE verbatim excerpt that
  // the server could actually verify. Collapsing those to one string would lose
  // the distinction between what was said and what the model concluded.
  it('keeps Q&A structured and tolerates the legacy string form', () => {
    const out = normalizeCallRecap({
      recap: {
        headline: 'h',
        qa_highlights: [
          { analyst: 'Ben Reitzes', firm: 'Melius', question: 'On margins?',
            takeaway: 'Guided higher', quote: 'we expect margins to expand', segment: 4 },
          'a legacy string',
          { takeaway: '' },
        ],
      },
    })
    expect(out.qa_highlights).toHaveLength(2)
    expect(out.qa_highlights[0]).toMatchObject({
      analyst: 'Ben Reitzes', firm: 'Melius', segment: 4,
      quote: 'we expect margins to expand',
    })
    expect(out.qa_highlights[1]).toMatchObject({ takeaway: 'a legacy string', quote: '' })
  })
})

describe('normalizeCallRecap — forward-looking commentary', () => {
  it('keeps only items resting on a verbatim quote', () => {
    const out = normalizeCallRecap({
      recap: {
        headline: 'h',
        forward_looking: [
          { topic: 'Margins', horizon: 'full_year', detail: 'Expanding',
            quote: 'we remain on track for double-digit margins', speaker: 'CFO', segment: 2 },
          { topic: 'No quote', horizon: 'full_year', detail: 'floating claim' },
        ],
      },
    })
    expect(out.forward_looking).toHaveLength(1)
    expect(out.forward_looking[0]).toMatchObject({
      topic: 'Margins', horizon: 'full_year', speaker: 'CFO', segment: 2,
    })
  })

  it('defaults an absent horizon rather than inventing one', () => {
    const out = normalizeCallRecap({
      recap: { headline: 'h', forward_looking: [{ quote: 'we expect growth' }] },
    })
    expect(out.forward_looking[0].horizon).toBe('unspecified')
  })

  it('is an empty array when the payload has none', () => {
    expect(normalizeCallRecap({ recap: { headline: 'h' } }).forward_looking).toEqual([])
  })
})

describe('guidanceKind', () => {
  it('separates the enum from real prose so it is not rendered twice', () => {
    expect(guidanceKind('raised')).toBe('enum')
    expect(guidanceKind('MAINTAINED')).toBe('enum')
    expect(guidanceKind('Full-year EPS guidance raised to $5.20–$5.30.')).toBe('prose')
  })

  it('treats none/blank as nothing to show', () => {
    expect(guidanceKind('none')).toBeNull()
    expect(guidanceKind('')).toBeNull()
    expect(guidanceKind(null)).toBeNull()
  })
})

describe('recapEmptyState — the reason a recap is missing is not one reason', () => {
  it('says work is IN PROGRESS while the server is generating', () => {
    // The common case: the request path never synthesises inline, so the first
    // reader of any un-warmed ticker hits this. Calling it "No call recap yet"
    // reported a failure for work that was actively running.
    const { title, hint } = recapEmptyState('generating')
    expect(title).toBe('Writing the recap now')
    expect(hint).toMatch(/updates on its own/i)
    expect(title).not.toMatch(/^No /)
  })

  it('distinguishes a spent budget from an absent transcript', () => {
    expect(recapEmptyState('capped').title).toBe('Recap paused until tomorrow')
    expect(recapEmptyState('unavailable').title).toBe('No call recap yet')
    expect(recapEmptyState('capped').title)
      .not.toBe(recapEmptyState('unavailable').title)
  })

  it('names the quarter when one was explicitly chosen', () => {
    // Stepping back to an older call is deliberate; a bare "No call recap yet"
    // there reads as breakage rather than as "recaps cover the latest call".
    expect(recapEmptyState('no_recap_for_quarter', '2019Q2').title)
      .toBe('No recap for 2019Q2')
  })

  it('the quarter wins over the status, whatever the status says', () => {
    expect(recapEmptyState('generating', '2019Q2').title).toBe('No recap for 2019Q2')
  })

  it('falls back to the honest message for a payload with no status', () => {
    // An older cached payload carries no status. It must not claim something
    // is being generated when nothing is.
    expect(recapEmptyState(undefined).title).toBe('No call recap yet')
    expect(recapEmptyState('something_new').title).toBe('No call recap yet')
  })
})
