// The whole-notebook Export dialog through 8A's axe harness (wave 8, lane 8C, C4) -- the rail
// file a11y/notebookSurfaces.js names for this surface. The dialog is a Sheet, which portals
// to document.body, so the run is over the body (component level).
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import ExportDialog from './ExportDialog'
import { expectNoAxeViolations } from '../../../a11y/axeHarness'

describe('ExportDialog -- axe', () => {
  it('idle, the format radio group showing: zero violations', async () => {
    render(<ExportDialog open onClose={() => {}} />)
    expect(screen.getAllByRole('radio')).toHaveLength(4)
    await expectNoAxeViolations(document.body)
  })

  it('a non-default format chosen: zero violations', async () => {
    render(<ExportDialog open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'Word (.docx)' }))
    expect(screen.getByRole('radio', { name: 'Word (.docx)' })).toBeChecked()
    await expectNoAxeViolations(document.body)
  })
})
