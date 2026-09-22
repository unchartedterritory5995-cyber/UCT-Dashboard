import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SharedNotePage from './SharedNotePage'
import { SHARED_NOTE_ROUTE, sharedNotePath } from './lib/noteShareLink'

/**
 * G-106 (Wave B lower-frequency sweep, competitive-gap-ledger.md): the
 * 'loading' status used to be bare "Loading…" text. No test file existed
 * for this component before this pass. The 'ok' status mounts a real TipTap
 * editor (ReadOnlyNote) -- out of scope here, same convention
 * NoteHistoryPanel.test.jsx documents ("leave anything that mounts
 * useEditor/EditorContent to real-browser E2E"); these tests only exercise
 * the loading state, which never reaches that branch.
 */

function renderPage(token = 'tok1') {
  return render(
    <MemoryRouter initialEntries={[sharedNotePath(token)]}>
      <Routes>
        <Route path={SHARED_NOTE_ROUTE} element={<SharedNotePage />} />
      </Routes>
    </MemoryRouter>,
  )
}

afterEach(() => vi.restoreAllMocks())

describe('SharedNotePage — loading state (G-106)', () => {
  it('shows a Skeleton loading state, not bare text, while the shared note is in flight', () => {
    global.fetch = vi.fn(() => new Promise(() => {})) // never settles in this test
    renderPage()
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading…')
  })

  it('the loading skeleton disappears once the link is confirmed gone', async () => {
    global.fetch = vi.fn(() => Promise.resolve({ ok: false, status: 404 }))
    renderPage()
    await screen.findByTestId('shared-note-gone')
    expect(screen.queryByRole('status')).toBeNull()
    expect(screen.getByText('This link is no longer available.')).toBeInTheDocument()
  })
})
