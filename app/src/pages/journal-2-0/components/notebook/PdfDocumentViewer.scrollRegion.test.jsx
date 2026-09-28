// Wave 10 follow-up F5 -- the PDF preview's scroll region can take keyboard focus.
//
// proof walk 10E-1 9b (docs/notebook/proof/walk-fd7d1f42d/axe.json, surface
// doc-preview): axe `scrollable-region-focusable` on `div._scroll` in dark, oled and
// light. The pages scroll inside that box and nothing in it can take focus (canvases
// and a text layer), so a keyboard member could not reach it to scroll. It is now a
// named region in the tab order; the browser scrolls a focused scroller with the
// arrow keys and Page Up / Page Down.
//
// pdfjs cannot run in jsdom; the loader is held pending so the viewer renders its
// scroll container and nothing else -- which is exactly the element under test.
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import PdfDocumentViewer from './PdfDocumentViewer'

vi.mock('../../lib/pdfjs', () => ({
  pdfjsLib: {},
  loadPdfDocument: () => new Promise(() => {}),
}))

describe('PdfDocumentViewer scroll region', () => {
  it('is a named region a keyboard can reach (tabIndex 0)', () => {
    render(<PdfDocumentViewer href="/api/j2/documents/doc1/file" />)
    const region = screen.getByRole('region', { name: 'Document pages' })
    expect(region.tabIndex).toBe(0)
    expect(region.getAttribute('tabindex')).toBe('0')
  })

  it('is the element that scrolls -- the pages mount inside it', () => {
    const { container } = render(<PdfDocumentViewer href="/api/j2/documents/doc1/file" />)
    const region = screen.getByRole('region', { name: 'Document pages' })
    expect(region.className).toMatch(/scroll/)
    // Non-vacuity: it is the viewer's outermost box, not a wrapper beside it.
    expect(container.firstElementChild).toBe(region)
  })
})
