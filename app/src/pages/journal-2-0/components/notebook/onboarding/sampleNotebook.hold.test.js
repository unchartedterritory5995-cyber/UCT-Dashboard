// Final fix (C1): the sample removal's hold sentence. When the pre-check holds a note back, "try again in a moment"
// (the bulk trash's shared words) is not always true for this door: a save whose answer was lost is not re-sent by
// waiting. The door says what works, and names the note even when it is not in the list on screen.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { describeSampleHold, heldTitles, SAMPLE_COPY } from './sampleNotebook'
import { FAILURE_WORDS } from '../../../lib/noteBatch'

const AAPL = 'Trade plan: example -- AAPL pullback'
afterEach(() => { vi.unstubAllGlobals() })

describe('describeSampleHold: a note with changes that have not finished saving', () => {
  it('one unsent note: its title, that its changes have not finished saving, and what to do', () => {
    const out = describeSampleHold({ unsent: ['n1'], blocked: [], unchecked: [] }, { titleOf: (id) => (id === 'n1' ? AAPL : null) })
    expect(out.message).toBe(`The sample was not removed: "${AAPL}" has changes that have not finished saving. Open it so it can finish saving, then remove the sample again.`)
    expect(out.anyway).toBeUndefined()   // busy/anyway logic unchanged: no "anyway" for a held note
  })

  it('never the shared "try again in a moment", and no em dash', () => {
    const out = describeSampleHold({ unsent: ['n1'], blocked: ['n2'], unchecked: [] }, { titleOf: () => 'X' })
    expect(out.message).not.toContain(FAILURE_WORDS.unsent)
    expect(out.message).not.toMatch(/try again in a moment/)
    expect(out.message).not.toMatch(/\u2014/)
  })

  it('several held notes (unsent and blocked): named, then "have ... Open them"', () => {
    const t = { a: 'A', b: 'B', c: 'C', d: 'D' }
    const out = describeSampleHold({ unsent: ['a', 'b'], blocked: ['c', 'd'], unchecked: [] }, { titleOf: (id) => t[id] })
    expect(out.message).toBe(`${SAMPLE_COPY.notRemoved} "A", "B", "C" and 1 more ${SAMPLE_COPY.heldMany}`)
    expect(SAMPLE_COPY.heldMany).toMatch(/Open them so they can finish saving, then remove the sample again\.$/)
  })

  it('CONTROL: a device that could not be asked keeps its own sentence and the Remove anyway offer', () => {
    const out = describeSampleHold({ unsent: [], blocked: [], unchecked: ['n1'] }, { titleOf: () => AAPL })
    expect(out.message.startsWith(SAMPLE_COPY.uncheckedNotRemoved)).toBe(true)
    expect(out.anyway?.label).toBe(SAMPLE_COPY.removeAnyway)
  })
})

describe('heldTitles: the held note is named even when the list on screen does not hold it', () => {
  it('reads the title of a held note the list cannot name, and keeps the list\'s own names', async () => {
    const fetchSpy = vi.fn(async (url) => ({
      ok: true, status: 200,
      json: async () => ({ note: { id: 'off', title: url.endsWith('/off') ? AAPL : 'wrong' } }),
    }))
    vi.stubGlobal('fetch', fetchSpy)
    const titleOf = await heldTitles({ unsent: ['off', 'on'], blocked: [], unchecked: [] }, (id) => (id === 'on' ? 'On screen' : null))
    expect(titleOf('off')).toBe(AAPL)
    expect(titleOf('on')).toBe('On screen')
    expect(fetchSpy).toHaveBeenCalledTimes(1)   // only the one the list could not name
    expect(fetchSpy.mock.calls[0][0]).toBe('/api/j2/notes/off')
  })

  it('a read that fails leaves "A note" (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const titleOf = await heldTitles({ unsent: ['x'], blocked: [], unchecked: [] })
    expect(describeSampleHold({ unsent: ['x'] }, { titleOf }).message).toContain('A note has changes')
  })

  it('CONTROL: nothing held, nothing read', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await heldTitles({ unsent: [], blocked: [], unchecked: [] })
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
