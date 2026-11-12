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
// Notebook simplify, Task 2: the saved views are the View menu's "Saved views" group, fed by the saved-views list
// (served below); the panel is stubbed out as before.
vi.mock('../components/notebook/FolderSidebar', () => ({
  default: () => <div data-testid="folder-sidebar" />,
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
import { chooseSavedView, chooseView, pressSaveView } from './__tests__/toolbarDoors'

beforeEach(() => {
  timelineProps = null
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url)
    if (u === '/api/j2/saved-views' && init.method === 'POST') {
      const body = JSON.parse(init.body)
      return { ok: true, json: async () => ({ savedView: { id: 'v9', ...body } }) }
    }
    if (u.startsWith('/api/j2/saved-views')) return { ok: true, json: async () => ({ savedViews: [SAVED] }) }
    return { ok: true, json: async () => ({}) }
  })
})

const renderTab = () => render(
  <MemoryRouter initialEntries={['/journal?view=all']}><NotebookTab /></MemoryRouter>,
)

describe('the Timeline view mode', () => {
  it('is offered in the toolbar and draws the timeline', async () => {
    renderTab()
    chooseView('Timeline')
    await screen.findByTestId('note-timeline')
    expect(screen.getByTestId('note-timeline')).toBeInTheDocument()
    expect(timelineProps.initialSettings).toBeNull()
  })

  it('saves WITH the settings the timeline reports', async () => {
    renderTab()
    chooseView('Timeline')
    await screen.findByTestId('note-timeline')
    timelineProps.onSettingsChange({ timeBy: 'created', zoom: 'week', groupBy: 'tag' })
    pressSaveView()
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

  // ⚠️ A UNIT check of the restore branch over one hand-built view. The door
  // across every saveable mode — the real View menu row, a server-shaped
  // list, a fresh mount, every saveable mode — is NotebookTab.savedViewRestore
  // .test.jsx (wave 6 fix round 5, R5-2).
  it('a saved timeline REOPENS as a timeline, with that view’s settings', async () => {
    renderTab()
    await chooseSavedView('Reviews by quarter')
    await screen.findByTestId('note-timeline')
    expect(screen.getByTestId('note-timeline')).toBeInTheDocument()
    expect(timelineProps.initialSettings).toEqual(SAVED.spec.timeline)
  })
})
