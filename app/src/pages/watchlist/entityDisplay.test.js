// Entity Master UC-2, the pure half: what a watchlist row SAYS when the server decorated it.
import { describe, it, expect } from 'vitest'
import { entityDisplay, entityDisplayBySym } from './entityDisplay'

describe('entityDisplay', () => {
  it('is null whenever the row should render as it always has', () => {
    expect(entityDisplay(null)).toBeNull()
    expect(entityDisplay({ sym: 'NVDA' })).toBeNull()                                   // flag off
    expect(entityDisplay({ sym: 'NVDA', entity_id: null, display_sym: 'NVDA', entity_marker: null })).toBeNull()
    expect(entityDisplay({ sym: 'NVDA', entity_id: 'e1', display_sym: 'NVDA', entity_marker: null })).toBeNull()
    expect(entityDisplay({ sym: 'nvda', display_sym: 'NVDA', entity_marker: null })).toBeNull()  // case only
    expect(entityDisplay({ sym: '', display_sym: 'NVDA', entity_marker: 'renamed' })).toBeNull()
  })

  it('a rename shows the current symbol and says what it was', () => {
    const d = entityDisplay({ sym: 'FB', entity_id: 'e1', display_sym: 'META', entity_marker: 'renamed' })
    expect(d).toEqual({
      shown: 'META', note: 'renamed from FB', tone: null,
      title: 'This company now trades as META. You added it as FB.',
    })
  })

  it('a delisted row says delisted, with or without a different last ticker, in danger ink', () => {
    expect(entityDisplay({ sym: 'TWTR', display_sym: 'TWTR', entity_marker: 'delisted' }))
      .toEqual({ shown: 'TWTR', note: 'delisted', tone: 'danger', title: 'TWTR is delisted. The company no longer trades.' })
    const d = entityDisplay({ sym: 'OLD', display_sym: 'NEWR', entity_marker: 'delisted' })
    expect(d.shown).toBe('NEWR')
    expect(d.note).toBe('delisted')
    expect(d.title).toBe('This company is delisted. You added it as OLD; its last ticker was NEWR.')
  })

  it('no member-facing string carries an em-dash', () => {
    for (const it of [
      { sym: 'FB', display_sym: 'META', entity_marker: 'renamed' },
      { sym: 'A', display_sym: 'A', entity_marker: 'delisted' },
      { sym: 'A', display_sym: 'B', entity_marker: 'delisted' },
    ]) {
      const d = entityDisplay(it)
      expect(`${d.note} ${d.title}`).not.toMatch(/\u2014/)
    }
  })

  it('entityDisplayBySym keys only the decorated rows, by upper-cased stored sym', () => {
    expect(entityDisplayBySym([{ sym: 'NVDA' }, { sym: 'AMD' }])).toEqual({})
    expect(entityDisplayBySym(undefined)).toEqual({})
    const m = entityDisplayBySym([{ sym: 'NVDA' }, { sym: 'fb', display_sym: 'META', entity_marker: 'renamed' }])
    expect(Object.keys(m)).toEqual(['FB'])
    expect(m.FB.shown).toBe('META')
  })
})
