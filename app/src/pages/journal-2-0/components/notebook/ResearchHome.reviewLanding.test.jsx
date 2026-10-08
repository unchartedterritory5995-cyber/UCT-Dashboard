// Finish program, lane KEYS3 (Q18): "This week's review" drafts a note and opens it.
//
// The note used to open with focus at its top, and the first thing the review found (a
// collapsed block, "Revenge re-entries") was 18 Tab stops below at 1280 px and 24 at 390 px:
// the header, the title area and two charts. 27 and 33 keys against a budget of 9.
// The box now opens its note asking for the first collapsed block.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

vi.mock('../../lib/reviewDrafts', () => ({
  draftWeeklyReview: vi.fn(async () => ({ note: { id: 'rev-week' } })),
  draftDailyReview: vi.fn(async () => ({ note: { id: 'rev-day' } })),
  draftMonthlyReview: vi.fn(async () => ({ note: { id: 'rev-month' } })),
  mondayOfIso: () => '2026-10-05',
  todayDayIso: () => '2026-10-07',
  thisMonthIso: () => '2026-10',
}))

import { ReviewDraftsHomeBox } from './ResearchHome'

beforeEach(() => { __resetNotebookFlags(); latchNotebookFlags({ notebook_review_drafts_enabled: true }) })
afterEach(() => { __resetNotebookFlags() })

describe('ReviewDraftsHomeBox: the drafted review opens on its first collapsed block', () => {
  it.each([
    ["This week's review", 'rev-week'],
    ["Today's recap", 'rev-day'],
    ["This month's review", 'rev-month'],
  ])('%s opens its note asking for the first collapsed block', async (name, id) => {
    const onOpenNote = vi.fn()
    render(<ReviewDraftsHomeBox onOpenNote={onOpenNote} />)
    fireEvent.click(screen.getByRole('button', { name }))
    await waitFor(() => expect(onOpenNote).toHaveBeenCalledTimes(1))
    expect(onOpenNote).toHaveBeenCalledWith({ id }, null, { to: 'collapsed' })
  })
})
