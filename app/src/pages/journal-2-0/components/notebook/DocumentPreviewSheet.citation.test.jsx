import { render, screen, fireEvent, within } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import DocumentPreviewSheet from './DocumentPreviewSheet'

// "This document" -- the fourth Ask host. A cited page scrolls the viewer; a
// source with no page has nowhere to go in this viewer, and says so inside the
// Ask panel rather than doing nothing. Real sheet, real AskPanel; the network
// and the pdfjs canvas are the only stubs (jsdom has no Worker/Canvas2D).
const scrollToPage = vi.fn()
vi.mock('./PdfDocumentViewer', async () => {
  const { forwardRef, useImperativeHandle } = await import('react')
  return {
    default: forwardRef(function Stub(_p, ref) {
      useImperativeHandle(ref, () => ({ scrollToPage }))
      return <div data-testid="pdf-viewer-stub" />
    }),
  }
})

const HREF = '/api/j2/notes/attachments/u1/n1/file/abc123.pdf'

function stream(source) {
  const enc = new TextEncoder()
  return new ReadableStream({ start(c) {
    c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'sources', scope: 'document', scopeLabel: 'This document', coverageNotice: null, sources: [source] })}\n\n`))
    c.enqueue(enc.encode(`data: ${JSON.stringify({ type: 'final', answer: 'Revenue grew [1].' })}\n\n`))
    c.close()
  } })
}

async function askAndTap(source) {
  render(<DocumentPreviewSheet open href={HREF} name="report.pdf" onClose={vi.fn()} documentId="d1" />)
  await screen.findByTestId('pdf-viewer-stub')
  global.fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}), body: stream(source) })
  fireEvent.click(screen.getByRole('button', { name: 'Ask a question about this document' }))
  const ask = await screen.findByRole('dialog', { name: 'Ask This document' })
  fireEvent.change(within(ask).getByRole('textbox'), { target: { value: 'revenue?' } })
  fireEvent.click(within(ask).getByRole('button', { name: 'Ask' }))
  fireEvent.click(await within(ask).findByRole('button', { name: `Source 1: ${source.label}` }))
  return ask
}

const BASE = {
  n: 1, type: 'document_page', label: 'report.pdf p.3', citation: 'page_only', snippet: 's',
  location: {}, payload: {}, stance: null, truncated: false,
}

afterEach(() => { scrollToPage.mockReset() })

describe('DocumentPreviewSheet ("This document") — citations', () => {
  it('a cited page scrolls the viewer, and says nothing', async () => {
    const ask = await askAndTap({ ...BASE, navigation: { kind: 'document', document_id: 'd1', page_number: 3 } })
    await vi.waitFor(() => expect(scrollToPage).toHaveBeenCalledWith(3))
    expect(within(ask).getByTestId('ask-nav-notice')).toBeEmptyDOMElement()
  })

  it('a source with no page says so inside the Ask panel', async () => {
    const ask = await askAndTap({ ...BASE, label: 'report.pdf', navigation: { kind: 'document', document_id: 'd1' } })
    expect(await within(ask).findByText("That source can't be opened from here.")).toBeInTheDocument()
    expect(scrollToPage).not.toHaveBeenCalled()
  })
})
