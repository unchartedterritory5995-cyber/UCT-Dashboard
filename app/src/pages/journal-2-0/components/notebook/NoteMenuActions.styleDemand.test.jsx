import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SWRConfig } from 'swr'

// Notebook P1 round 3 (re-review N-I1): the Save-as-style door fetches the style surfaces ON DEMAND, at its first
// press, not when the note menu mounts (which is every note open). Counted through the surfaces module's factory.
const loaded = vi.hoisted(() => ({ surfaces: 0 }))
vi.mock('./styles/StyleSurfaces', async (importOriginal) => { loaded.surfaces += 1; return importOriginal() })
vi.mock('../../lib/journalStyles', async (importOriginal) => ({
  ...(await importOriginal()),
  fetchJournalStyles: async () => ({ kinds: [], styles: [], blockKinds: [] }),
}))

import NoteMenuActions from './NoteMenuActions'
import { latchNotebookFlags, __resetNotebookFlags } from '../../lib/offline/notebookFlags'

afterEach(() => __resetNotebookFlags())

describe('Save this note\'s setup as a style: loaded on demand', () => {
  // Notebook simplify, Task 4: the door is the "Keep live blocks" choice inside the one "Save as template" entry.
  it('opening "Save as template" fetches nothing; choosing "Keep live blocks" fetches the door', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NoteMenuActions note={{ id: 'n1', title: 'T' }} onBeforeTemplate={async () => true} />
      </SWRConfig>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save as template' }))
    const btn = screen.getByRole('button', { name: 'Keep live blocks' })
    await vi.dynamicImportSettled()
    expect(loaded.surfaces).toBe(0)
    fireEvent.click(btn)
    expect(await screen.findByRole('textbox', { name: 'Template name' }, { timeout: 10000 })).toBeTruthy()
    expect(loaded.surfaces).toBe(1)
  })
})
