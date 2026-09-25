import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

/**
 * Wave 6 (lane E, item 6) — the Timeline is the SIXTH view mode, WIRED: offered
 * in the toolbar, SAVEABLE with its settings, and RESTORED — a saved timeline
 * reopens as a timeline with that view's settings, never silently as a list
 * (an unknown type falls back to list on purpose, which is why the restore needs
 * a rail).
 */
vi.mock('../hooks/useJ2Notes', () => ({
  default: () => ({
    notes: [{ id: 'n1', title: 'A', tags: [] }], isLoading: false, error: null, refresh: vi.fn(),
    mutate: vi.fn(), total: 1, hasMore: false, loadMore: vi.fn(), isLoadingMore: false,
  }),
}))
const SAVED = { id: 'v1', name: 'Reviews by quarter', viewType: 'timeline',
  spec: { timeline: { timeBy: 'builtin:review_date', zoom: 'quarter', groupBy: 'tag' } } }
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: ({ onSelectView }) => (
    <div data-testid="folder-sidebar">
      <button type="button" onClick={() => onSelectView(SAVED)}>open saved timeline</button>
    </div>
  ),
}))
let timelineProps = null
vi.mock('../components/notebook/NoteTimelineView', () => ({
  default: (props) => { timelineProps = props; return <div data-testid="note-timeline" /> },
}))
vi.mock('../components/notebook/NoteEditorPage', () => ({ default: () => <div data-testid="note-editor" /> }))
vi.mock('../components/notebook/import/ImportWizard', () => ({ default: () => null }))
vi.mock('../components/connectors/NoteConnectorsTrustStrip', () => ({ default: () => null }))
vi.mock('../components/notebook/ResearchHome', () => ({ default: () => <div data-testid="research-home" /> }))
vi.mock('../lib/offline/useBlockedNotes', () => ({ useBlockedNotes: () => ({ blocked: new Set() }) }))

import NotebookTab from './NotebookTab'

beforeEach(() => {
  timelineProps = null
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if (u === '/api/j2/saved-views' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      return { ok: true, json: async () => ({ savedView: { id: 'v9', ...body } }) }
    }
    if (u.startsWith('/api/j2/saved-views')) return { ok: true, json: async () => ({ savedViews: [] }) }
    return { ok: true, json: async () => ({}) }
  })
})

const renderTab = () => render(
  <MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>,
)

describe('the Timeline view mode', () => {
  it('is offered in the toolbar and draws the timeline', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Timeline view' }))
    expect(screen.getByTestId('note-timeline')).toBeInTheDocument()
    expect(timelineProps.initialSettings).toBeNull()
  })

  it('saves WITH the settings the timeline reports', async () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'Timeline view' }))
    timelineProps.onSettingsChange({ timeBy: 'created', zoom: 'week', groupBy: 'tag' })
    fireEvent.click(screen.getByRole('button', { name: /save view/i }))
    const name = await screen.findByLabelText('Name')
    fireEvent.change(name, { target: { value: 'This week by tag' } })
    fireEvent.keyDown(name, { key: 'Enter' })
    await waitFor(() => {
      const call = global.fetch.mock.calls.find(([u, o]) => String(u) === '/api/j2/saved-views' && o?.method === 'POST')
      expect(call).toBeTruthy()
      const body = JSON.parse(call[1].body)
      expect(body.viewType).toBe('timeline')
      expect(body.spec.timeline).toEqual({ timeBy: 'created', zoom: 'week', groupBy: 'tag' })
    })
  })

  it('a saved timeline REOPENS as a timeline, with that view’s settings', () => {
    renderTab()
    fireEvent.click(screen.getByRole('button', { name: 'open saved timeline' }))
    expect(screen.getByTestId('note-timeline')).toBeInTheDocument()
    expect(timelineProps.initialSettings).toEqual(SAVED.spec.timeline)
  })
})
