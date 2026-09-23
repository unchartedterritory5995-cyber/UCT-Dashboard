/**
 * G-106 (Wave B lower-frequency sweep, competitive-gap-ledger.md): the
 * Suspense fallback shown while the `PdfDocumentViewer` chunk itself is
 * loading -- deliberately a SEPARATE file from PdfViewerBoundary.test.jsx,
 * which is about the ERROR boundary and mocks the module to throw at
 * evaluation. A module that throws settles (rejects) almost immediately,
 * leaving no reliable window to observe the fallback; this file mocks the
 * module to resolve via a promise that is never settled during the test, so
 * the Suspense fallback has a stable, non-racy state to assert against.
 */
import { render, screen } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

vi.mock('./PdfDocumentViewer', () => new Promise(() => {})) // never settles

describe('PdfViewerBoundary — Suspense fallback (G-106)', () => {
  it('shows a Skeleton loading state, not bare text, while the viewer chunk loads', async () => {
    const { default: PdfViewerBoundary } = await import('./PdfViewerBoundary')
    render(<PdfViewerBoundary url="/x.pdf" />)
    expect(screen.getByRole('status')).toHaveAccessibleName('Loading preview…')
  })
})
