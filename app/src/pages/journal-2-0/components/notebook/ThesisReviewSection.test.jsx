import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let reviewsResult
const useThesisReviewsSpy = vi.fn(() => reviewsResult)
vi.mock('../../hooks/useThesisReviews', () => ({
  default: (noteId) => useThesisReviewsSpy(noteId),
}))

import ThesisReviewSection from './ThesisReviewSection'
import * as settleModule from '../../lib/offline/settleNoteWrite'

const EVIDENCE = [
  { id: 'e1', stance: 'supports', targetType: 'document_excerpt', targetId: 'x1' },
  { id: 'e2', stance: 'opposes', targetType: 'document_excerpt', targetId: 'x2' },
  { id: 'e3', stance: 'opposes', targetType: 'document_excerpt', targetId: 'x3' },
]

function base(overrides = {}) {
  return {
    reviews: [], draft: null, completed: [],
    attention: { noteId: 'n1', reasons: [], changes: { hasPriorReview: false } },
    isLoading: false, error: null, refresh: vi.fn(),
    ...overrides,
  }
}

const renderIt = (props = {}) =>
  render(<ThesisReviewSection noteId="n1" evidence={EVIDENCE} {...props} />)

beforeEach(() => {
  reviewsResult = base()
  useThesisReviewsSpy.mockClear()
  global.fetch = vi.fn(() => Promise.resolve({
    ok: true, json: () => Promise.resolve({ review: { id: 'r1', status: 'draft' } }),
  }))
})

describe('the closed state', () => {
  it('says a thesis has never been reviewed rather than showing a zero', () => {
    renderIt()
    expect(screen.getByText(/has not been reviewed yet/i)).toBeTruthy()
  })

  it('names the last review and its outcome once one exists', () => {
    reviewsResult = base({
      completed: [{ id: 'r0', status: 'completed', outcome: 'no_change',
                    completedAt: '2026-02-01T00:00:00Z', memberNote: 'still holds' }],
    })
    renderIt()
    expect(screen.getByText(/Last reviewed/i).textContent).toMatch(/No change/i)
  })

  it('offers the action where the research already is', () => {
    renderIt()
    expect(screen.getByRole('button', { name: /Review thesis/i })).toBeTruthy()
  })
})

describe('the open review', () => {
  const open = async () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: /Review thesis/i }))
    await waitFor(() => expect(screen.getByLabelText(/Your assessment/i)).toBeTruthy())
  }

  it('shows supporting and opposing as SEPARATE counts', async () => {
    await open()
    expect(screen.getByText('1 supporting')).toBeTruthy()
    expect(screen.getByText('2 opposing')).toBeTruthy()
  })

  it('⛔ never derives a percentage or a score from those counts', async () => {
    // §41: 1 supporting / 2 opposing is not "33% supported". Evidence quality
    // and independence differ; a number here would read as a measurement.
    await open()
    const text = document.body.textContent
    expect(text).not.toMatch(/\d+\s?%/)
    expect(text).not.toMatch(/conviction|strength|score/i)
  })

  it('⛔ the empty state is a different SENTENCE, not "nothing changed"', async () => {
    await open()
    expect(screen.getByText(/No completed review yet/i)).toBeTruthy()
    expect(screen.queryByText(/Nothing has changed/i)).toBeNull()
  })

  it('states what completing does AND does not do', async () => {
    // §33: a member must never discover afterwards that the thesis was or was
    // not touched.
    await open()
    expect(screen.getByText(/does not change the thesis itself/i)).toBeTruthy()
  })

  it('⛔ offers no control that could set a thesis status', async () => {
    // §4. The absence of the lever is the guarantee.
    await open()
    const labels = screen.getAllByRole('radio').map((b) => b.textContent.toLowerCase())
    expect(labels).toEqual(['no change', 'revised', 'invalidated', 'need more work'])
    expect(screen.queryByText(/thesis status/i)).toBeNull()
  })

  it('cannot be completed without an explicit decision', async () => {
    await open()
    expect(screen.getByRole('button', { name: /Complete review/i })).toBeDisabled()
    fireEvent.click(screen.getByRole('radio', { name: 'No change' }))
    expect(screen.getByRole('button', { name: /Complete review/i })).not.toBeDisabled()
  })

  it('labels the member note as THEIR words, kept apart from sources', async () => {
    await open()
    expect(screen.getByText(/kept separate from the sources/i)).toBeTruthy()
  })
})

describe('since last review', () => {
  const withChanges = (changes) => base({
    attention: { noteId: 'n1', reasons: [], changes: { hasPriorReview: true, ...changes } },
  })

  const openWith = async (result) => {
    reviewsResult = result
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: /Review thesis/i }))
    await waitFor(() => expect(screen.getByLabelText(/Your assessment/i)).toBeTruthy())
  }

  it('states added evidence as a FACT', async () => {
    await openWith(withChanges({ since: '2026-02-01T00:00:00Z', addedOpposing: 2 }))
    expect(screen.getByText(/2 opposing evidence items added/i)).toBeTruthy()
  })

  it('⛔ never interprets what that means', async () => {
    await openWith(withChanges({ since: '2026-02-01T00:00:00Z', addedOpposing: 2 }))
    // ⛔ SCOPED TO WHAT UCT SAYS, not to the whole panel. "Invalidated" is one
    // of the four outcomes the MEMBER may choose — a legitimate part of their
    // own vocabulary. A whole-page word check flagged it and would have been a
    // false finding about the product (the same shape as Wave N's
    // "Document excerpt" whole-page check).
    const since = screen.getByText(/Since your last review/i).closest('div')
    const text = since.textContent.toLowerCase()
    for (const w of ['weaken', 'strengthen', 'invalid', 'at risk', 'priority']) {
      expect(text).not.toContain(w)
    }
    expect(screen.getByText(/What that means is your call/i)).toBeTruthy()
  })

  it('⛔ keeps member removal and source purge as TWO facts', async () => {
    await openWith(withChanges({
      since: '2026-02-01T00:00:00Z', removedByMember: 1, sourcesNoLongerAvailable: 2,
    }))
    expect(screen.getByText(/1 evidence relationship you removed/i)).toBeTruthy()
    expect(screen.getByText(/2 evidence sources no longer available/i)).toBeTruthy()
  })

  it('says nothing changed only when there IS a prior review', async () => {
    await openWith(withChanges({ since: '2026-02-01T00:00:00Z' }))
    expect(screen.getByText(/Nothing has changed/i)).toBeTruthy()
  })
})

describe('history', () => {
  it('keeps each completed review with its own decision and words', () => {
    reviewsResult = base({
      completed: [
        { id: 'r2', status: 'completed', outcome: 'invalidated',
          completedAt: '2026-03-01T00:00:00Z', memberNote: 'gave up in March' },
        { id: 'r1', status: 'completed', outcome: 'no_change',
          completedAt: '2026-02-01T00:00:00Z', memberNote: 'held in Feb' },
      ],
    })
    renderIt()
    // The history is a CollapsibleSection, which UNMOUNTS its children while
    // collapsed (the Analytics accordion idiom) — so it has to be opened
    // before anything inside it exists to assert on.
    fireEvent.click(screen.getByText(/Review history/i))
    expect(screen.getByText(/held in Feb/)).toBeTruthy()
    expect(screen.getByText(/gave up in March/)).toBeTruthy()
    expect(screen.getByText('No change')).toBeTruthy()
    expect(screen.getByText('Invalidated')).toBeTruthy()
  })

  it('shows no history section before the first completed review', () => {
    renderIt()
    expect(screen.queryByText(/Review history/i)).toBeNull()
  })
})

// ── Wave O6 §4: a review reached from Search or from a citation ─────────────
//
// ⚰️ THE FAILURE THIS BLOCKS is Wave M's, one section later. The review
// history lives inside a CollapsibleSection whose children are UNMOUNTED while
// it is closed — so a deep link that only set `?note=` would open the thesis,
// leave the panel shut, and be indistinguishable from "search still just opens
// the note", which is the entire defect O6 exists to close.
describe('landing on a specific review', () => {
  const HISTORY = [
    { id: 'rv2', status: 'completed', outcome: 'revised',
      completedAt: '2026-03-20T00:00:00Z', memberNote: 'trimmed the growth case' },
    { id: 'rv1', status: 'completed', outcome: 'no_change',
      completedAt: '2026-01-10T00:00:00Z', memberNote: 'the datacenter call still holds' },
  ]

  beforeEach(() => {
    // ⛔ CollapsibleSection persists its open/closed state in localStorage,
    // and jsdom keeps that store for the whole FILE. Without this, "the
    // history stays collapsed" below passes or fails depending on which test
    // ran before it — the section's own state leaking between cases.
    try { window.localStorage.clear() } catch { /* private mode */ }
    // jsdom lays nothing out and implements no scrolling.
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('OPENS the collapsed history so the anchored review is actually on screen', () => {
    reviewsResult = base({ completed: HISTORY })
    renderIt({ anchorReviewId: 'rv1' })
    expect(screen.getByText(/the datacenter call still holds/)).toBeTruthy()
  })

  it('scrolls to it and marks it, so it is findable among rows that look alike', () => {
    reviewsResult = base({ completed: HISTORY })
    renderIt({ anchorReviewId: 'rv1' })
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled()
    const row = screen.getByText(/the datacenter call still holds/).closest('li')
    expect(row.className).toMatch(/historyRowAnchored/)
  })

  it('announces the landing, because a silent scroll is invisible to a screen reader', () => {
    reviewsResult = base({ completed: HISTORY })
    renderIt({ anchorReviewId: 'rv1' })
    expect(screen.getByLabelText('Review status').textContent)
      .toMatch(/Showing your review from/)
  })

  it('⛔ does NOT consume the anchor while the history is still loading', () => {
    // Acting early would clear the deep link against an empty list and land
    // the member at the top of the note with the param already gone — a
    // failure that looks exactly like the feature never having been built.
    const onAnchorConsumed = vi.fn()
    reviewsResult = base({ completed: [], isLoading: true })
    renderIt({ anchorReviewId: 'rv1', onAnchorConsumed })
    expect(onAnchorConsumed).not.toHaveBeenCalled()
  })

  it('consumes the anchor once, so a refresh or a Back does not re-fire it', () => {
    const onAnchorConsumed = vi.fn()
    reviewsResult = base({ completed: HISTORY })
    const { rerender } = renderIt({ anchorReviewId: 'rv1', onAnchorConsumed })
    rerender(<ThesisReviewSection noteId="n1" evidence={EVIDENCE}
                                  anchorReviewId="rv1"
                                  onAnchorConsumed={onAnchorConsumed} />)
    expect(onAnchorConsumed).toHaveBeenCalledTimes(1)
  })

  it('a review that is no longer here still releases the anchor, and claims nothing', () => {
    const onAnchorConsumed = vi.fn()
    reviewsResult = base({ completed: HISTORY })
    renderIt({ anchorReviewId: 'gone', onAnchorConsumed })
    expect(onAnchorConsumed).toHaveBeenCalledTimes(1)
    expect(screen.getByLabelText('Review status').textContent).toBe('')
  })

  it('with no anchor the history stays collapsed, as the member left it', () => {
    reviewsResult = base({ completed: HISTORY })
    renderIt()
    expect(screen.queryByText(/the datacenter call still holds/)).toBeNull()
  })
})

// ⚰️ FOUND BY THE O6 FLAGSHIP HARNESS, and invisible to every rail above it.
// The URL anchor is cleared the moment it is consumed, so a refresh or a Back
// cannot re-fire the jump — which took `anchorReviewId` back to null and
// un-marked the row on the very next render. The member clicked a review
// result, watched the history open and scroll, and found nothing highlighted
// when they looked. Both halves are required: a clean URL AND a visible
// "you are here".
describe('the landing mark outlives the url parameter', () => {
  const HISTORY = [
    { id: 'rv2', status: 'completed', outcome: 'revised',
      completedAt: '2026-03-20T00:00:00Z', memberNote: 'trimmed the growth case' },
    { id: 'rv1', status: 'completed', outcome: 'no_change',
      completedAt: '2026-01-10T00:00:00Z', memberNote: 'the datacenter call still holds' },
  ]

  beforeEach(() => {
    try { window.localStorage.clear() } catch { /* private mode */ }
    Element.prototype.scrollIntoView = vi.fn()
  })

  it('stays marked after the anchor is consumed and the param goes away', () => {
    reviewsResult = base({ completed: HISTORY })
    const { rerender } = render(
      <ThesisReviewSection noteId="n1" evidence={EVIDENCE} anchorReviewId="rv1" />)
    expect(screen.getByText(/the datacenter call still holds/).closest('li')
      .getAttribute('aria-current')).toBe('true')
    // the URL cleanup lands: the prop returns to null
    rerender(<ThesisReviewSection noteId="n1" evidence={EVIDENCE} anchorReviewId={null} />)
    const row = screen.getByText(/the datacenter call still holds/).closest('li')
    expect(row.getAttribute('aria-current')).toBe('true')
    expect(row.className).toMatch(/historyRowAnchored/)
  })

  it('⛔ marks exactly one row — the one that was navigated to', () => {
    reviewsResult = base({ completed: HISTORY })
    renderIt({ anchorReviewId: 'rv1' })
    const marked = document.querySelectorAll('li[aria-current="true"]')
    expect(marked.length).toBe(1)
    expect(marked[0].textContent).toMatch(/the datacenter call still holds/)
  })

  it('does not scroll twice when the param is cleared under it', () => {
    reviewsResult = base({ completed: HISTORY })
    const { rerender } = render(
      <ThesisReviewSection noteId="n1" evidence={EVIDENCE} anchorReviewId="rv1" />)
    rerender(<ThesisReviewSection noteId="n1" evidence={EVIDENCE} anchorReviewId={null} />)
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledTimes(1)
  })
})

/**
 * ⛔⛔ A PROPERTY WRITE IS A DOOR.
 *
 * Completing a review with a next-review date writes `builtin:review_date`
 * through the ordinary note PUT — `update_note` — so it advances this note's
 * revision exactly like a body save. Unlanded, a member who reviewed a thesis
 * while offline work was queued against it got a `(conflicted copy)` of their
 * own note for it.
 *
 * ⭐ This rail owns "the component settles the PUT it just made, for this
 * note". That the settle then lands the right revision is owned once, in
 * `lib/offline/doorFamilies.settle.test.jsx`.
 */
describe('⛔ completing a review with a next date lands the note revision', () => {
  // ⛔ Its own opener: the harness's `open` lives inside another describe.
  const open = async () => {
    render(<ThesisReviewSection noteId="n1" evidence={EVIDENCE} />)
    fireEvent.click(screen.getByRole('button', { name: /Review thesis/i }))
    await waitFor(() => expect(screen.getByLabelText(/Your assessment/i)).toBeTruthy())
  }

  const completeWith = async ({ nextDate }) => {
    await open()
    fireEvent.click(screen.getByRole('radio', { name: 'No change' }))
    if (nextDate) {
      const date = document.querySelector('input[type="date"]')
      if (date) fireEvent.change(date, { target: { value: nextDate } })
    }
    fireEvent.click(screen.getByRole('button', { name: /Complete review/i }))
  }

  it('the property PUT is settled', async () => {
    const spy = vi.spyOn(settleModule, 'settleNoteWrite').mockResolvedValue('T2')
    // ⛔ URL-AWARE. The complete handler early-returns without a review id, so
    // a stub that answers everything with one body never reaches the door and
    // the rail would pass by never exercising it.
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).endsWith('/reviews')
        ? { review: { id: 'r1' } }
        : { note: { id: 'n1', updatedAt: 'T2' } }),
    })))
    await completeWith({ nextDate: '2026-12-01' })

    await waitFor(() => expect(spy, '⛔ the review-date PUT did not land its revision').toHaveBeenCalled())
    expect(spy.mock.calls[0][0]).toBe('n1')
    spy.mockRestore()
  })

  it('⛔ CONTROL — with NO next date there is no note write, so nothing is settled', async () => {
    const spy = vi.spyOn(settleModule, 'settleNoteWrite').mockResolvedValue('T2')
    // ⛔ URL-AWARE. The complete handler early-returns without a review id, so
    // a stub that answers everything with one body never reaches the door and
    // the rail would pass by never exercising it.
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      json: async () => (String(url).endsWith('/reviews')
        ? { review: { id: 'r1' } }
        : { note: { id: 'n1', updatedAt: 'T2' } }),
    })))
    await completeWith({ nextDate: null })

    await waitFor(() => expect(screen.queryByRole('button', { name: /Complete review/i })).toBeNull())
    expect(spy, 'completing a review is not itself a note write').not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
