import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

import NoteCalendarView, { noteDateKey, datedDefs } from './NoteCalendarView'

/**
 * ⛔ THE LOAD-BEARING TESTS HERE ARE THE DATE-PARSING ONES.
 *
 * `note_properties` validates a date property as "a non-empty string" and
 * nothing more, so the stored value is free-form. The tempting implementation
 * is `new Date(value)`, which parses a bare `YYYY-MM-DD` as UTC and therefore
 * lands a member in ET on the PREVIOUS day — a wrong answer that looks right
 * for most of the day and only misbehaves in the evening.
 */

const REVIEW = { id: 'builtin:review_date', name: 'Review Date', type: 'date', source: 'user_set' }
const DUE = { id: 'p:due', name: 'Due', type: 'date', source: 'user_set' }

const n = (id, title, date, prop = REVIEW.id) => ({
  id, title, propertiesJson: date === null ? {} : { [prop]: date },
})

beforeEach(() => {
  vi.useFakeTimers()
  // Mid-month so prev/next never cross a year boundary by accident.
  vi.setSystemTime(new Date('2026-09-15T17:00:00Z'))
})
afterEach(() => { vi.useRealTimers() })

const renderCal = (props = {}) => render(
  <NoteCalendarView
    notes={[]}
    propertyDefs={[REVIEW]}
    onOpenNote={vi.fn()}
    {...props}
  />,
)

describe('date parsing', () => {
  it('accepts a plain YYYY-MM-DD', () => {
    expect(noteDateKey(n('a', 'A', '2026-09-10'), REVIEW)).toBe('2026-09-10')
  })

  it('accepts an ISO datetime by taking its DATE part, never re-zoning it', () => {
    expect(noteDateKey(n('a', 'A', '2026-09-10T23:30:00Z'), REVIEW)).toBe('2026-09-10')
    // ⛔ THE CASE THAT CAN ACTUALLY DISTINGUISH. The line above cannot: a Date
    // round trip of a 23:30Z stamp lands on the same calendar day, so it stays
    // green against the very implementation it is meant to forbid. An evening
    // stamp with an explicit offset is a different day in UTC, so this fails
    // the moment anyone reaches for `new Date(...).toISOString()`.
    expect(noteDateKey(n('a', 'A', '2026-09-10T23:30:00-04:00'), REVIEW)).toBe('2026-09-10')
  })

  it('tolerates surrounding whitespace', () => {
    expect(noteDateKey(n('a', 'A', '  2026-09-10 '), REVIEW)).toBe('2026-09-10')
  })

  it('refuses anything that is not a leading YYYY-MM-DD', () => {
    for (const bad of ['next Tuesday', '10/09/2026', '2026-9-1', '', 'soon']) {
      expect(noteDateKey(n('a', 'A', bad), REVIEW)).toBeNull()
    }
  })

  it('refuses a well-shaped but impossible date', () => {
    expect(noteDateKey(n('a', 'A', '2026-13-01'), REVIEW)).toBeNull()
    expect(noteDateKey(n('a', 'A', '2026-00-10'), REVIEW)).toBeNull()
    expect(noteDateKey(n('a', 'A', '2026-09-40'), REVIEW)).toBeNull()
  })

  it('refuses a non-string, and a missing property', () => {
    expect(noteDateKey({ propertiesJson: { [REVIEW.id]: 20260910 } }, REVIEW)).toBeNull()
    expect(noteDateKey({ propertiesJson: {} }, REVIEW)).toBeNull()
    expect(noteDateKey({ propertiesJson: {} }, null)).toBeNull()
  })

  it('only date properties can lay out a calendar', () => {
    expect(datedDefs([REVIEW, { id: 'x', type: 'select', options: [] }, DUE]).map((d) => d.id))
      .toEqual(['builtin:review_date', 'p:due'])
  })
})

describe('NoteCalendarView', () => {
  it('opens on the current month', () => {
    renderCal()
    expect(screen.getByText('September 2026')).toBeInTheDocument()
  })

  it('places a note on its own day', () => {
    renderCal({ notes: [n('a', 'NVDA review', '2026-09-10')] })
    const cell = screen.getByRole('gridcell', { name: '2026-09-10' })
    expect(within(cell).getByText('NVDA review')).toBeInTheDocument()
  })

  it('SHOWS notes it cannot place instead of dropping them', () => {
    renderCal({
      notes: [n('a', 'Scheduled', '2026-09-10'), n('b', 'Someday note', 'next Tuesday'), n('c', 'No date', null)],
    })
    const un = screen.getByRole('region', { name: 'Unscheduled' })
    expect(within(un).getByText('Someday note')).toBeInTheDocument()
    expect(within(un).getByText('No date')).toBeInTheDocument()
    expect(within(un).queryByText('Scheduled')).toBeNull()
  })

  it('says how many dated notes are in OTHER months', () => {
    // Otherwise an empty September reads as "nothing scheduled" when in fact
    // everything is in October.
    renderCal({ notes: [n('a', 'Later', '2026-10-02'), n('b', 'Much later', '2026-11-02')] })
    expect(screen.getByText(/2 more in other months/i)).toBeInTheDocument()
  })

  it('does not claim other months when everything is on screen', () => {
    renderCal({ notes: [n('a', 'This month', '2026-09-10')] })
    expect(screen.queryByText(/more in other months/i)).toBeNull()
  })

  it('marks today', () => {
    renderCal()
    const cell = screen.getByRole('gridcell', { name: '2026-09-15' })
    expect(cell.className).toMatch(/cellToday/)
  })

  it('navigates months and comes back via Today', () => {
    renderCal()
    fireEvent.click(screen.getByLabelText('Next month'))
    expect(screen.getByText('October 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Previous month'))
    fireEvent.click(screen.getByLabelText('Previous month'))
    expect(screen.getByText('August 2026')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByText('September 2026')).toBeInTheDocument()
  })

  it('opens the note that was clicked', () => {
    const onOpenNote = vi.fn()
    renderCal({ notes: [n('a', 'NVDA review', '2026-09-10')], onOpenNote })
    fireEvent.click(screen.getByText('NVDA review'))
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
  })

  it('defaults to a date property the notes actually use', () => {
    renderCal({
      propertyDefs: [REVIEW, DUE],
      notes: [n('a', 'Has a due date', '2026-09-10', DUE.id)],
    })
    expect(screen.getByLabelText('Date')).toHaveValue('p:due')
  })

  it('switching the date property re-lays the month', () => {
    renderCal({
      propertyDefs: [REVIEW, DUE],
      notes: [{ id: 'a', title: 'Both', propertiesJson: { [REVIEW.id]: '2026-09-10', [DUE.id]: '2026-09-20' } }],
    })
    expect(within(screen.getByRole('gridcell', { name: '2026-09-10' })).getByText('Both')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: 'p:due' } })
    expect(within(screen.getByRole('gridcell', { name: '2026-09-20' })).getByText('Both')).toBeInTheDocument()
  })

  it('says what to do when the notebook has no date property', () => {
    renderCal({ propertyDefs: [{ id: 'x', name: 'Status', type: 'select', options: [] }] })
    expect(screen.getByText(/lays notes out by a/i)).toBeInTheDocument()
  })
})
