/**
 * VIS-5 (audit 2026-11-05, issue 16): `?note=doesnotexist` said "Couldn't load this note. ... this looks like a
 * connection problem, not a save problem." A 404 is not a connection problem: it says "This note doesn't exist
 * or was deleted", with Back to All notes and Check Trash. Any other failure keeps its own sentence.
 */
import { render, screen, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../../../../context/AuthContext', () => ({ useAuth: () => ({ user: null }) }))
vi.mock('../../hooks/useJ2NoteFolders', () => ({ default: () => ({ folders: [] }) }))

let status = '404'
vi.mock('../../hooks/useJ2Notes', () => ({
  useJ2Note: () => ({ note: null, isLoading: false, error: new Error(status), update: vi.fn(), refresh: vi.fn() }),
  recordNoteOpened: vi.fn(),
  setNoteFavorite: vi.fn(),
}))

function Where() {
  const loc = useLocation()
  return <output data-testid="where">{`${loc.pathname}${loc.search}`}</output>
}
async function renderEditor() {
  const NoteEditorPage = (await import('./NoteEditorPage')).default
  return render(<MemoryRouter initialEntries={['/journal/notebook?note=gone']}><NoteEditorPage noteId="gone" onBack={vi.fn()} showBack /><Where /></MemoryRouter>)
}

beforeEach(() => { status = '404'; vi.resetModules() })

describe('a missing note (404)', () => {
  it('says the note does not exist, and never blames the connection', async () => {
    await renderEditor()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("This note doesn't exist or was deleted")
    expect(alert.textContent).not.toMatch(/connection/i)
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull()
  })

  it('Back to All notes goes to the list', async () => {
    await renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Back to All notes' }))
    expect(screen.getByTestId('where').textContent).toBe('/journal/notebook?view=all')
  })

  it('Check Trash opens the Trash', async () => {
    await renderEditor()
    fireEvent.click(await screen.findByRole('button', { name: 'Check Trash' }))
    expect(screen.getByTestId('where').textContent).toBe('/journal/notebook?folder=__trash__')
  })

  it('CONTROL: a network failure keeps its own sentence and Try again', async () => {
    status = '500'
    await renderEditor()
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent("Couldn't load this note.")
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(alert.textContent).not.toContain("doesn't exist")
  })
})
