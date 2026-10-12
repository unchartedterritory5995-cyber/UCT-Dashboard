import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'

// Notebook P1 round 4 (re-review 2, N-M7): pressing "Save this note's setup as a style" must not make the button
// vanish while the chunk loads, and focus must not be dropped on the page. Its own file: the gate holds the
// surfaces module back, and a module another test already loaded would not wait.
const gate = vi.hoisted(() => ({ promise: null }))
vi.mock('./styles/StyleSurfaces', async (importOriginal) => { await gate.promise; return importOriginal() })
vi.mock('../../lib/journalStyles', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchJournalStyles: async () => ({ kinds: [], styles: [], blockKinds: [] }),
}))

import NoteMenuActions from './NoteMenuActions'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

afterEach(() => __resetNotebookFlags())

const NAME = "Save this note's setup as a style"

describe('Save this note\'s setup as a style: while its chunk loads', () => {
  it('N-M7: the button keeps its place, label and focus, then focus goes into the form', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    let release
    gate.promise = new Promise((r) => { release = r })
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NoteMenuActions note={{ id: 'n1', title: 'T' }} onBeforeTemplate={async () => true} />
      </SWRConfig>,
    )
    const before = screen.getByRole('button', { name: NAME })
    expect(before.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(before)
    // the chunk is still loading: a button of the same name is still there, busy, expanded, and focused
    const during = await screen.findByRole('button', { name: NAME })
    expect(during.getAttribute('aria-busy')).toBe('true')
    expect(during.getAttribute('aria-expanded')).toBe('true')
    expect(during.className).toBe(before.className)
    expect(document.activeElement).toBe(during)
    expect(screen.queryByRole('textbox', { name: 'Style name' })).toBeNull()
    release()
    const input = await screen.findByRole('textbox', { name: 'Style name' }, { timeout: 10000 })
    expect(document.activeElement).toBe(input)
    expect(screen.getAllByRole('button', { name: NAME })).toHaveLength(1)
  })
})
