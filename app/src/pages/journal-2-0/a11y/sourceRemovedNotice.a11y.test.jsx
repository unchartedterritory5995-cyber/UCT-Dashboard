// @vitest-environment jsdom
// app/src/pages/journal-2-0/a11y/sourceRemovedNotice.a11y.test.jsx
//
// L3: the notice a connector note shows once its source app no longer has it
// (components/notebook/SourceRemovedNotice.jsx), through 8A's axe harness. The editor's own rail
// opens a note with no `source-deleted` tag, so the notice is never on screen there; it gets a
// recipe of its own, read after its role and its sentence are proved to be there. Both wordings
// are read: the authoritative one (Obsidian, "was removed from") and the listing one (Notion,
// "no longer lists this note").
import { describe } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeSurface } from './surface'
import SourceRemovedNotice from '../components/notebook/SourceRemovedNotice'

describe('the source-removed notice', () => {
  axeSurface('source-removed-notice', async () => {
    const { container } = render(
      <main>
        <SourceRemovedNotice importSource="obsidian" />
        <SourceRemovedNotice importSource="notion" />
      </main>,
    )
    const notes = screen.getAllByRole('note')
    if (notes.length !== 2) throw new Error(`expected 2 notices, found ${notes.length}`)
    screen.getByText(/was removed from Obsidian/)
    screen.getByText(/no longer lists this note/)
    return { root: container }
  })
})
