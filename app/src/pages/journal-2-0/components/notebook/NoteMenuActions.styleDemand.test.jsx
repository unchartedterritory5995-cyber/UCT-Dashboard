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
  it('the button is there, nothing is fetched until it is pressed', async () => {
    latchNotebookFlags({ notebook_journal_styles_enabled: true })
    render(
      <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
        <NoteMenuActions note={{ id: 'n1', title: 'T' }} onBeforeTemplate={async () => true} />
      </SWRConfig>,
    )
    const btn = screen.getByRole('button', { name: "Save this note's setup as a style" })
    await vi.dynamicImportSettled()
    expect(loaded.surfaces).toBe(0)
    fireEvent.click(btn)
    expect(await screen.findByRole('textbox', { name: 'Style name' }, { timeout: 10000 })).toBeTruthy()
    expect(loaded.surfaces).toBe(1)
  })
})
