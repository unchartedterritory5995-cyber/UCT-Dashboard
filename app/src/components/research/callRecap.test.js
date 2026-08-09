import { describe, it, expect } from 'vitest'
import { normalizeCallRecap, guidanceKind } from './callRecap'

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
      { speaker: '', role: '', topic: 'Margins', text: 'We see leverage.' },
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

describe('normalizeCallRecap — bullets and Q&A are always strings', () => {
  it('flattens object-shaped items and drops empties', () => {
    const out = normalizeCallRecap({
      recap: {
        headline: 'h',
        bullets: ['plain', { text: 'wrapped' }, '', null],
        qa_highlights: [{ takeaway: 'a takeaway' }, 'a string'],
      },
    })
    expect(out.bullets).toEqual(['plain', 'wrapped'])
    expect(out.qa_highlights).toEqual(['a takeaway', 'a string'])
    for (const b of [...out.bullets, ...out.qa_highlights]) expect(typeof b).toBe('string')
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
