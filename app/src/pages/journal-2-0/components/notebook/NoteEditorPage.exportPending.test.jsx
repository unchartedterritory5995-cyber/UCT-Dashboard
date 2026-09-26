// Wave 8 final review, M-9, at the editor: the per-note export (all four formats) is built
// from the SERVER's copy, so the editor sends what it still holds FIRST -- the words in the
// autosave window reach the server before the file is asked for. NoteExportControls.test.jsx
// proves the control asks; this proves the editor wires its own `sendPendingEdits` into it
// (a severed prop leaves every control rail green).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers } from '../../a11y/fixtures'
import NoteEditorPage from './NoteEditorPage'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

const settle = (ms = 30) => act(async () => { await new Promise((r) => setTimeout(r, ms)) })

let fetchSpy
beforeEach(() => {
  fetchSpy = installFetch()
  latchWave8Flags(true)
  global.URL.createObjectURL = vi.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = vi.fn()
})
afterEach(() => { vi.restoreAllMocks() })

const callsOf = () => fetchSpy.mock.calls.map(([u, init = {}]) => ({
  url: String(typeof u === 'string' ? u : u?.url || ''),
  method: (init.method || 'GET').toUpperCase(),
  body: typeof init.body === 'string' ? init.body : '',
}))

describe('the editor sends its pending edits before a file is exported (M-9)', () => {
  it('a title typed inside the autosave window reaches the server BEFORE the export is fetched', async () => {
    render(
      <Providers route="/journal/notebook?note=n1">
        <NoteEditorPage noteId="n1" onBack={() => {}} showBack={false} />
      </Providers>,
    )
    const title = await screen.findByPlaceholderText('Title')
    await waitFor(() => {
      if (!document.querySelector('.ProseMirror')?.editor) throw new Error('editor not mounted')
    })
    await settle()
    fireEvent.change(title, { target: { value: 'NVDA thesis, revised' } })
    // straight to Export, inside the autosave window
    fireEvent.click(screen.getByRole('button', { name: /^export/i }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'JSON' }))
    await waitFor(() => expect(callsOf().some((c) => c.url.startsWith('/api/j2/export/notes/n1'))).toBe(true), { timeout: 4000 })
    const calls = callsOf()
    const save = calls.findIndex((c) => c.method === 'PUT' && c.url.startsWith('/api/j2/notes/n1') && c.body.includes('NVDA thesis, revised'))
    const exp = calls.findIndex((c) => c.url.startsWith('/api/j2/export/notes/n1'))
    expect(save, 'the revised title was never sent').toBeGreaterThanOrEqual(0)
    expect(save).toBeLessThan(exp)
  })
})
