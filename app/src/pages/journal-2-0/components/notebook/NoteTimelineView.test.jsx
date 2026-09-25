import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'

/**
 * Wave 6 (lane E, item 6) — the Timeline view: placing, zooming, grouping,
 * opening (read-only), the honest counts, and reporting/restoring its settings.
 */
vi.mock('../../hooks/useJ2NoteFolders', () => ({
  default: () => ({ folders: [{ id: 'f1', name: 'Research', parentId: null }] }),
}))

import NoteTimelineView from './NoteTimelineView'

const REVIEW = { id: 'builtin:review_date', type: 'date', name: 'Review date', source: 'user_set' }
const NOTES = [
  { id: 'a', title: 'NVDA thesis', folderId: 'f1', tags: ['semis'], updatedAt: '2026-09-22T15:00:00+00:00',
    createdAt: '2026-01-02T15:00:00+00:00', propertiesJson: { 'builtin:review_date': '2026-09-23' } },
  { id: 'b', title: 'Loose idea', folderId: null, tags: [], updatedAt: '2026-09-24T15:00:00+00:00',
    createdAt: '2026-09-24T15:00:00+00:00', propertiesJson: {} },
]
const today = () => '2026-09-24'
let onOpenNote
let onSettingsChange
beforeEach(() => { onOpenNote = vi.fn(); onSettingsChange = vi.fn() })

const renderIt = (props = {}) => render(
  <NoteTimelineView notes={NOTES} propertyDefs={[REVIEW]} onOpenNote={onOpenNote}
    onSettingsChange={onSettingsChange} today={today} {...props} />,
)

describe('the timeline', () => {
  it('places by last update in a month by default, in folder lanes, and opens a note (read-only)', () => {
    renderIt()
    expect(screen.getByText('Sep 2026')).toBeInTheDocument()
    const research = screen.getByRole('rowheader', { name: 'Research' }).closest('tr')
    fireEvent.click(within(research).getByRole('button', { name: 'NVDA thesis' }))
    expect(onOpenNote).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }))
    expect(screen.getByRole('rowheader', { name: 'Unfiled' })).toBeInTheDocument()
    expect(onSettingsChange).toHaveBeenLastCalledWith({ timeBy: 'updated', zoom: 'month', groupBy: 'folder' })
  })

  it('placing by a date property shows the undated as Unscheduled, never drops them', () => {
    renderIt()
    fireEvent.change(screen.getByRole('combobox', { name: 'Place by' }), { target: { value: 'builtin:review_date' } })
    const unscheduled = screen.getByRole('region', { name: 'Unscheduled' })
    expect(within(unscheduled).getByText('Unscheduled (1)')).toBeInTheDocument()
    expect(within(unscheduled).getByRole('button', { name: 'Loose idea' })).toBeInTheDocument()
    expect(onSettingsChange).toHaveBeenLastCalledWith({ timeBy: 'builtin:review_date', zoom: 'month', groupBy: 'folder' })
  })

  it('zooms, moves, and says how many notes sit outside the window', () => {
    renderIt()
    fireEvent.click(screen.getByRole('button', { name: 'Week' }))
    expect(screen.getByText('Week of Sep 21')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Next week' }))
    expect(screen.getByText('Week of Sep 28')).toBeInTheDocument()
    expect(screen.getByText('Nothing placed in this week.')).toBeInTheDocument()
    expect(screen.getByText('2 more notes sit outside this week.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Today' }))
    expect(screen.getByText('Week of Sep 21')).toBeInTheDocument()
  })

  it('groups by tag', () => {
    renderIt()
    fireEvent.change(screen.getByRole('combobox', { name: 'Group by' }), { target: { value: 'tag' } })
    expect(screen.getByRole('rowheader', { name: '#semis' })).toBeInTheDocument()
    expect(screen.getByRole('rowheader', { name: 'No tag' })).toBeInTheDocument()
  })

  it('restores a saved view’s settings, and falls back safely from settings it cannot use', () => {
    const { unmount } = renderIt({ initialSettings: { timeBy: 'builtin:review_date', zoom: 'quarter', groupBy: 'tag' } })
    expect(screen.getByText('Q3 2026')).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Group by' })).toHaveValue('tag')
    expect(screen.getByRole('combobox', { name: 'Place by' })).toHaveValue('builtin:review_date')
    unmount()
    renderIt({ initialSettings: { timeBy: 'deleted-property', zoom: 'decade', groupBy: 'mood' } })
    expect(onSettingsChange).toHaveBeenLastCalledWith({ timeBy: 'updated', zoom: 'month', groupBy: 'folder' })
  })
})
