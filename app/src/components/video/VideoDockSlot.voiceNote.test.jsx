// Wave 11 lane 11A — "Save to Notebook" on a Desk session: offered only while the
// voice-notes gate is on, to a paid member, on a session that HAS a transcript; it
// opens the voice-note dialog on that session, and once saved it says so and
// links to the note. The dialog is stubbed (its own states are railed in
// VoiceNoteDialog.test.jsx); the dock and its gate are real.
import { act, fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AuthContext } from '../../context/AuthContext'
import { __resetNotebookFlags, latchNotebookFlags } from '../../pages/journal-2-0/lib/offline/notebookFlags'
import VideoDockSlot from './VideoDockSlot'
import * as store from './videoStore'

const insights = vi.hoisted(() => ({ hasTranscript: true }))
vi.mock('../../hooks/useVideoInsights', () => ({
  useVideoInsights: () => ({
    chapters: [], tickerMoments: [], headline: '', summary: [], posterUrl: null,
    loading: false, hasTranscript: insights.hasTranscript, setups: [],
  }),
}))
vi.mock('../../hooks/useVideoNotes', () => ({ useVideoNotes: () => ({ notes: [], add: vi.fn(), remove: vi.fn() }) }))
const seen = vi.hoisted(() => ({ props: null }))
vi.mock('../../pages/journal-2-0/components/notebook/VoiceNoteDialog', () => ({
  default: (props) => {
    seen.props = props
    return (
      <div role="dialog" aria-label="Voice note">
        <button type="button" onClick={() => { props.onSaved({ id: 'nv9' }); props.onClose() }}>stub: save</button>
      </div>
    )
  },
}))

const LIST = [{ id: 42, youtube_id: 'abcdefghijk', title: 'Live Trading — Oct 1, 2026' }]
const PAID = { user: { id: 'u1' }, isPaid: true }

beforeEach(() => {
  store.__reset()
  insights.hasTranscript = true
  seen.props = null
  __resetNotebookFlags()
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }))
})
afterEach(() => { vi.unstubAllGlobals(); __resetNotebookFlags() })

function mount(auth = PAID) {
  act(() => store.play(LIST, 0))
  render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter><VideoDockSlot /></MemoryRouter>
    </AuthContext.Provider>,
  )
}
const door = () => screen.queryByRole('button', { name: 'Save to Notebook' })

describe('Save to Notebook on a Desk session', () => {
  it('is absent while the gate is off', () => {
    latchNotebookFlags({ notebook_voice_notes_enabled: false })
    mount()
    expect(door()).toBeNull()
  })

  it('is absent for a free member', () => {
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    mount({ user: { id: 'u2' }, isPaid: false })
    expect(door()).toBeNull()
  })

  it('is absent on a session with no transcript (there is nothing to save)', () => {
    insights.hasTranscript = false
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    mount()
    expect(door()).toBeNull()
  })

  it('opens the voice-note dialog on THIS session, and links to the note once saved', async () => {
    latchNotebookFlags({ notebook_voice_notes_enabled: true })
    mount()
    const btn = door()
    expect(btn).toHaveAttribute('aria-haspopup', 'dialog')
    await act(async () => { fireEvent.click(btn) })
    await screen.findByRole('dialog', { name: 'Voice note' })
    expect(seen.props.deskVideo).toEqual({ id: 42, title: 'Live Trading — Oct 1, 2026' })
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'stub: save' })) })
    expect(screen.queryByRole('dialog', { name: 'Voice note' })).toBeNull()
    expect(screen.getByRole('button', { name: /Saved to Notebook — open it/ })).toBeInTheDocument()
  })
})
