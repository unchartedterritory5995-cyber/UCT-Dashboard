// The editor's Export menu through 8A's axe harness (wave 8, lane 8C, C4) -- the rail file
// a11y/notebookSurfaces.js names for this surface. Harness: a11y/axeHarness.js
// (`expectNoAxeViolations`, component level), both states: closed, and open on the menu.
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import NoteExportControls from './NoteExportControls'
import { expectNoAxeViolations } from '../../a11y/axeHarness'

vi.mock('../../lib/exportNote', () => ({ exportNoteAsPng: vi.fn(), printNote: vi.fn() }))

describe('NoteExportControls -- axe', () => {
  it('closed: zero violations', async () => {
    const { container } = render(
      <NoteExportControls noteId="n1" title="Plan" columnRef={{ current: null }} onMessage={() => {}} />,
    )
    await expectNoAxeViolations(container)
  })

  it('open on the menu: zero violations, and the menu is really there', async () => {
    const { container } = render(
      <NoteExportControls noteId="n1" title="Plan" columnRef={{ current: null }} onMessage={() => {}} />,
    )
    fireEvent.click(screen.getByRole('button', { name: /^export/i }))
    expect(screen.getAllByRole('menuitem')).toHaveLength(4)
    await expectNoAxeViolations(container)
  })
})
