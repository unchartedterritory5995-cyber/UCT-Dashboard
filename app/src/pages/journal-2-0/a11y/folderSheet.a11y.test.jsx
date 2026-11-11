// S12 (B13), fix round 1 (review Important 6): the folders sheet inside a note on a phone is the repo's Sheet -- a
// dialog named "Folders" -- read OPEN by axe. Focus and Escape are railed through the real tab in
// tabs/NotebookTab.phoneNote.test.jsx.
import { describe, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeSurface } from './surface'
import FolderSheet from '../components/notebook/FolderSheet'

describe('the folders sheet -- axe', () => {
  axeSurface('folder-sheet:open', async () => {
    render(
      <main>
        <button type="button">Show folders</button>
        <FolderSheet open onClose={vi.fn()}>
          <nav aria-label="Folders and tags"><ul><li><button type="button">All notes</button></li><li><button type="button">Theses</button></li></ul></nav>
        </FolderSheet>
      </main>,
    )
    expect(screen.getByRole('dialog', { name: 'Folders' })).toBeInTheDocument()
  })
})
