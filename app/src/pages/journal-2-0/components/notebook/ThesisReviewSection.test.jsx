import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

let reviewsResult
const useThesisReviewsSpy = vi.fn(() => reviewsResult)
vi.mock('../../hooks/useThesisReviews', () => ({
  default: (noteId) => useThesisReviewsSpy(noteId),
}))

import ThesisReviewSection from './ThesisReviewSection'

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
