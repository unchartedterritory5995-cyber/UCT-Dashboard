import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import NoteHistoryPanel from './NoteHistoryPanel'
import { useJ2NoteVersions, useJ2NoteVersion, restoreNoteVersion } from '../../hooks/useJ2NoteVersions'

// NoteVersionPreview mounts a real TipTap editor -- this codebase's own
// convention (NoteEditorPage.jsx, SharedNotePage.jsx) is to leave anything
// that mounts useEditor/EditorContent to real-browser E2E, never RTL/jsdom.
// Stubbing it here keeps this file testing NoteHistoryPanel's OWN logic
// (list/selection/diff/restore/error states), not TipTap.
vi.mock('./NoteVersionPreview', () => ({
  default: ({ title, bodyJson }) => (
    <div data-testid="stub-preview">{title} :: {JSON.stringify(bodyJson)}</div>
  ),
}))

// vi.mock hoists above imports; the hook module is replaced wholesale so
// each test can set per-hook return values via the imported mock fns
// directly, without relying on ESM-namespace spyOn mutability.
vi.mock('../../hooks/useJ2NoteVersions', () => ({
  useJ2NoteVersions: vi.fn(),
  useJ2NoteVersion: vi.fn(),
  restoreNoteVersion: vi.fn(),
}))

const CURRENT = { id: 'n1', updatedAt: '2026-09-06T12:00:00Z', bodyPlain: 'current text here' }

function versionsList(list) {
  return { versions: list, isLoading: false, error: null }
}

beforeEach(() => {
  vi.restoreAllMocks()
})
afterEach(() => {
  vi.restoreAllMocks()
})

describe('NoteHistoryPanel', () => {
  it('shows a loading state while the version list is fetching', () => {
    useJ2NoteVersions.mockReturnValue({ versions: [], isLoading: true, error: null })
    useJ2NoteVersion.mockReturnValue({ version: null, isLoading: false })
    render(<NoteHistoryPanel open noteId="n1" currentNote={CURRENT} onClose={() => {}} />)
    expect(screen.getByText(/loading history/i)).toBeTruthy()
  })

  it('shows an honest empty state for a note with no history yet -- never fabricated versions', () => {
    useJ2NoteVersions.mockReturnValue(versionsList([]))
    useJ2NoteVersion.mockReturnValue({ version: null, isLoading: false })
    render(<NoteHistoryPanel open noteId="n1" currentNote={CURRENT} onClose={() => {}} />)
    expect(screen.getByTestId('history-empty')).toBeTruthy()
    expect(screen.getByText(/no earlier versions yet/i)).toBeTruthy()
  })

  it('shows an error state on a failed fetch', () => {
    useJ2NoteVersions.mockReturnValue({ versions: [], isLoading: false, error: new Error('boom') })
    useJ2NoteVersion.mockReturnValue({ version: null, isLoading: false })
    render(<NoteHistoryPanel open noteId="n1" currentNote={CURRENT} onClose={() => {}} />)
    expect(screen.getByText(/couldn't load history/i)).toBeTruthy()
  })

  it('lists versions newest-first and selects the newest by default, showing its preview', () => {
    useJ2NoteVersions.mockReturnValue(versionsList([
      { id: 'v2', title: 'Newer', subtitle: null, createdAt: '2026-09-06T11:00:00Z' },
      { id: 'v1', title: 'Older', subtitle: null, createdAt: '2026-09-05T11:00:00Z' },
    ]))
    useJ2NoteVersion.mockImplementation((_noteId, versionId) => ({
      version: versionId === 'v2'
        ? { id: 'v2', title: 'Newer', subtitle: null, bodyJson: { type: 'doc' }, bodyPlain: 'newer text' }
        : null,
      isLoading: false,
    }))
    render(<NoteHistoryPanel open noteId="n1" currentNote={CURRENT} onClose={() => {}} />)
    expect(screen.getByText('Newer')).toBeTruthy()
    expect(screen.getByText('Older')).toBeTruthy()
    expect(screen.getByTestId('stub-preview').textContent).toContain('Newer')
  })

  it('switching to "What changed" renders a word diff against the current note', () => {
    useJ2NoteVersions.mockReturnValue(versionsList([
      { id: 'v1', title: 'Older', subtitle: null, createdAt: '2026-09-05T11:00:00Z' },
    ]))
    useJ2NoteVersion.mockReturnValue({
      version: { id: 'v1', title: 'Older', subtitle: null, bodyJson: { type: 'doc' }, bodyPlain: 'old text here' },
      isLoading: false,
    })
    render(<NoteHistoryPanel open noteId="n1" currentNote={{ ...CURRENT, bodyPlain: 'new text here' }} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /what changed/i }))
    const diff = screen.getByTestId('history-diff')
    expect(diff.querySelector('del')).toBeTruthy()
    expect(diff.querySelector('ins')).toBeTruthy()
  })

  it('reports no text changes when the version matches the current note', () => {
    useJ2NoteVersions.mockReturnValue(versionsList([
      { id: 'v1', title: 'Same', subtitle: null, createdAt: '2026-09-05T11:00:00Z' },
    ]))
    useJ2NoteVersion.mockReturnValue({
      version: { id: 'v1', title: 'Same', subtitle: null, bodyJson: { type: 'doc' }, bodyPlain: 'identical text' },
      isLoading: false,
    })
    render(<NoteHistoryPanel open noteId="n1" currentNote={{ ...CURRENT, bodyPlain: 'identical text' }} onClose={() => {}} />)
    fireEvent.click(screen.getByRole('button', { name: /what changed/i }))
    expect(screen.getByText(/no text changes/i)).toBeTruthy()
  })

  it('restoring a version asks for confirmation, then calls restoreNoteVersion and onRestored on success', async () => {
    useJ2NoteVersions.mockReturnValue(versionsList([
      { id: 'v1', title: 'Older', subtitle: null, createdAt: '2026-09-05T11:00:00Z' },
    ]))
    useJ2NoteVersion.mockReturnValue({
      version: { id: 'v1', title: 'Older', subtitle: null, bodyJson: { type: 'doc' }, bodyPlain: 'old text' },
      isLoading: false,
    })
    const restored = { id: 'n1', title: 'Older', bodyJson: { type: 'doc' } }
    const restoreSpy = restoreNoteVersion.mockResolvedValue(restored)
    const onRestored = vi.fn()
    render(<NoteHistoryPanel open noteId="n1" currentNote={CURRENT} onClose={() => {}} onRestored={onRestored} />)

    fireEvent.click(screen.getByRole('button', { name: /restore this version/i }))
    // ConfirmModal is up -- restoreNoteVersion must NOT fire until confirmed.
    expect(restoreSpy).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }))

    await waitFor(() => expect(restoreSpy).toHaveBeenCalledWith('n1', 'v1', CURRENT.updatedAt))
    await waitFor(() => expect(onRestored).toHaveBeenCalledWith(restored))
    expect(screen.getByText(/restored/i)).toBeTruthy()
  })

  it('a 409 conflict on restore shows an explicit message and never calls onRestored', async () => {
    useJ2NoteVersions.mockReturnValue(versionsList([
      { id: 'v1', title: 'Older', subtitle: null, createdAt: '2026-09-05T11:00:00Z' },
    ]))
    useJ2NoteVersion.mockReturnValue({
      version: { id: 'v1', title: 'Older', subtitle: null, bodyJson: { type: 'doc' }, bodyPlain: 'old text' },
      isLoading: false,
    })
    const err = Object.assign(new Error('conflict'), { status: 409 })
    restoreNoteVersion.mockRejectedValue(err)
    const onRestored = vi.fn()
    render(<NoteHistoryPanel open noteId="n1" currentNote={CURRENT} onClose={() => {}} onRestored={onRestored} />)

    fireEvent.click(screen.getByRole('button', { name: /restore this version/i }))
    fireEvent.click(screen.getByRole('button', { name: /^restore$/i }))

    await waitFor(() => expect(screen.getByText(/changed since history opened/i)).toBeTruthy())
    expect(onRestored).not.toHaveBeenCalled()
  })
})
