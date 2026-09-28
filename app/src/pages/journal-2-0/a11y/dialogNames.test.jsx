// app/src/pages/journal-2-0/a11y/dialogNames.test.jsx
//
// F4 / A2R-08 (WCAG 4.1.2). Lane 10E-2's walk could not read a name for the Templates,
// Import, Export and Writing help dialogs, and said its probe did not read aria-labelledby.
// F4 re-read them in a browser with Playwright's accessibility snapshot: Writing help IS named
// (by its title, through `labelledByTitle`); the other three had NO name at all -- `role=dialog`
// with neither aria-label nor aria-labelledby (evidence/a11y-f4-keyboard-2026-09-27,
// walk-f4.json F4-03). Each is a `Sheet` with a visible title, so each now names itself from
// that title (`labelledByTitle`: one value, never a restated copy).
//
// Asserted through the real NotebookTab, opening each dialog from the button a member uses,
// by its accessible NAME -- which is what the dialogs lacked.
import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import { installFetch, latchWave8Flags, Providers } from './fixtures'
import NotebookTab from '../tabs/NotebookTab'

if (!Range.prototype.getClientRects) Range.prototype.getClientRects = () => []
if (!Range.prototype.getBoundingClientRect) {
  Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 })
}

async function renderTab() {
  render(<Providers route="/journal/notebook?view=all"><NotebookTab /></Providers>)
  await screen.findAllByText('Theses')
  return document.getElementById('notebook-pane').parentElement
}

describe('the Notebook dialogs are named (F4, A2R-08)', () => {
  beforeEach(() => { installFetch(); latchWave8Flags(true) })

  it.each([
    ['Templates', 'New note'],
    ['Import', 'Import notes'],
    ['Export', 'Export your notebook'],
  ])('%s opens a dialog named "%s", by its visible title', async (button, name) => {
    const wrap = await renderTab()
    fireEvent.click(within(wrap).getByRole('button', { name: button }))
    const dialog = await screen.findByRole('dialog', { name })
    // the name IS the visible title (aria-labelledby), not a second copy of it
    const by = dialog.getAttribute('aria-labelledby')
    expect(by).toBeTruthy()
    expect(document.getElementById(by).textContent).toBe(name)
    expect(dialog.getAttribute('aria-label')).toBeNull()
  }, 30000)
})
