/**
 * A PDF-viewer failure must cost the member the PREVIEW and nothing else.
 *
 * ⚰️ THE INCIDENT THIS ENCODES. 2026-09-12, real iPhone 15 Pro / iOS Safari 17.5 on production:
 * `/journal/notebook` rendered the ROUTE-LEVEL error boundary instead of the page, because
 * `pdfjs-dist@6` reads the `Iterator` global unguarded at module top level and that global did not
 * exist before Safari 18.4. The import chain was **static** — `DocumentPreviewSheet` →
 * `PdfDocumentViewer` → `lib/pdfjs` — so a leaf component's dependency took down a route.
 *
 * ⭐ THE COMPATIBILITY FIX IS NOT WHAT THIS FILE TESTS, AND THAT IS THE POINT. `iteratorGlobalShim`
 * makes iOS 17 work again; this makes the NEXT incompatibility — in pdfjs or anything else, on an
 * engine nobody has tested yet — cost a preview instead of a page. Those are different properties
 * and only one of them is permanent.
 */
import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ⛔ THROWS AT MODULE EVALUATION, which is the exact shape of the real failure — not a render-time
// throw, not a rejected fetch. `lazy()` turns that into a rejected promise, and the boundary has
// to catch it there.
vi.mock('./PdfDocumentViewer', () => {
  throw new ReferenceError("Can't find variable: Iterator")
})

let errorSpy
beforeEach(() => { errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {}) })
afterEach(() => { errorSpy.mockRestore() })

describe('⛔ a viewer that dies at module evaluation', () => {
  it('renders the fallback, and never rethrows into the route', async () => {
    const { default: PdfViewerBoundary } = await import('./PdfViewerBoundary')

    // ⭐ THE CONTROL: a route-level boundary standing in for the real one. If the throw escaped,
    // this would render instead of the fallback — which is precisely what happened on glass.
    class RouteBoundary extends (await import('react')).Component {
      constructor(p) { super(p); this.state = { down: false } }
      static getDerivedStateFromError() { return { down: true } }
      render() { return this.state.down ? <div data-testid="route-died" /> : this.props.children }
    }

    render(
      <RouteBoundary>
        <div data-testid="notebook-page">
          <PdfViewerBoundary url="/x.pdf" />
        </div>
      </RouteBoundary>,
    )

    await waitFor(() => {
      expect(screen.getByTestId('pdf-preview-unavailable')).toBeInTheDocument()
    })
    expect(screen.getByText(/PDF preview isn’t available on this browser/)).toBeInTheDocument()

    // The page around it survived, and the route boundary never fired.
    expect(screen.getByTestId('notebook-page')).toBeInTheDocument()
    expect(screen.queryByTestId('route-died')).not.toBeInTheDocument()
  })

  it('the failure is reported, not swallowed silently', async () => {
    const { default: PdfViewerBoundary } = await import('./PdfViewerBoundary')
    render(<PdfViewerBoundary url="/x.pdf" />)
    await waitFor(() => expect(screen.getByTestId('pdf-preview-unavailable')).toBeInTheDocument())
    // ⛔ A boundary that hides a crash with no trace is how the NEXT one goes unnoticed for a week.
    expect(errorSpy.mock.calls.some((c) => String(c[0]).includes('[PdfViewerBoundary]'))).toBe(true)
  })
})
