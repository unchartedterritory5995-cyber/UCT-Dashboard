import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'

// Notebook P1 round 4 (re-review 2, N-M7): pressing "Save as template with blocks" must not make the button
// vanish while the chunk loads, and focus must not be dropped on the page.
// Notebook simplify, Task 4: that door is now the "Keep live blocks" choice inside the one "Save as template" entry;
// the same rule holds for it. Its own file: the gate holds the
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

const NAME = 'Keep live blocks'

describe('Save this note\'s setup as a style: while its chunk loads', () => {
  it('N-M7: the choice keeps its place, label and focus while the door loads, then focus goes into the form', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    let release
    gate.promise = new Promise((r) => { release = r })
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NoteMenuActions note={{ id: 'n1', title: 'T' }} onBeforeTemplate={async () => true} />
      </SWRConfig>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    const before = screen.getByRole('button', { name: NAME })
    expect(before.getAttribute('aria-pressed')).toBe('false')
    before.focus()
    fireEvent.click(before)
    // the chunk is still loading: the same button is still there, pressed, and focused; the wait is said
    const during = await screen.findByRole('button', { name: NAME })
    expect(during).toBe(before)
    expect(during.getAttribute('aria-pressed')).toBe('true')
    expect(document.activeElement).toBe(during)
    expect(screen.getByRole('status').textContent).toBe('Opening…')
    expect(screen.queryByRole('textbox', { name: 'Template name' })).toBeNull()
    release()
    const input = await screen.findByRole('textbox', { name: 'Template name' }, { timeout: 10000 })
    expect(document.activeElement).toBe(input)
    expect(screen.getAllByRole('button', { name: NAME })).toHaveLength(1)
  })
})
