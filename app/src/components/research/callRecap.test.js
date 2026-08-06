import { describe, it, expect } from 'vitest'
import { normalizeCallRecap } from './callRecap'

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
