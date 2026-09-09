// ⛔ WAVE P4 — the derived-text selection aid, and the four things it must
// never do: claim to be the document, appear on a page that has its own text,
// offer an empty box for an unreadable scan, or name the engine.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import ScannedTextPanel from './ScannedTextPanel'

const PAGE_TEXT = 'Total revenue was $12.48 billion, an increase of 22% year over year.'

function mockTranscript(body, { ok = true } = {}) {
  global.fetch = vi.fn().mockResolvedValue({
    ok, json: async () => body,
  })
}

function open() {
  fireEvent.click(screen.getByRole('button', { name: /scanned text/i }))
}

beforeEach(() => { vi.restoreAllMocks() })

describe('it offers the page text only when there is page text', () => {
  it('renders nothing at all without a document and page', () => {
    const { container } = render(<ScannedTextPanel documentId={null} pageNumber={1} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('is collapsed until asked, and fetches ONE page when opened', async () => {
    mockTranscript({ text: PAGE_TEXT, available: true, textOrigin: 'ocr', pageNumber: 4 })
    render(<ScannedTextPanel documentId="d1" pageNumber={4}
                             onTextReady={() => {}} buildPageText={() => ({})} />)
    expect(screen.queryByText(PAGE_TEXT)).not.toBeInTheDocument()
    expect(global.fetch).not.toHaveBeenCalled()

    open()
    await screen.findByText(PAGE_TEXT)
    // ⛔ §40 — one page, never the whole document.
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/j2/notes/documents/d1/pages/4/text', expect.anything())
    expect(global.fetch).toHaveBeenCalledTimes(1)
  })

  it('says an unreadable page has nothing to quote, rather than showing an empty box', async () => {
    // ⛔ §45 — the gate rejected this page's output. An empty transcript would
    // read as "still loading" and invite the member to wait for nothing.
    mockTranscript({ text: '', available: false, textOrigin: 'native', pageNumber: 2 })
    render(<ScannedTextPanel documentId="d1" pageNumber={2}
                             onTextReady={() => {}} buildPageText={() => ({})} />)
    open()
    expect(await screen.findByText(/nothing to\s+quote/i)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('says so when the text cannot be loaded', async () => {
    mockTranscript({}, { ok: false })
    render(<ScannedTextPanel documentId="d1" pageNumber={1}
                             onTextReady={() => {}} buildPageText={() => ({})} />)
    open()
    expect(await screen.findByText(/could not be loaded/i)).toBeInTheDocument()
  })
})

describe('the selection path is the viewer\'s existing one', () => {
  it('carries the page number the viewer\'s selection handler looks for', async () => {
    mockTranscript({ text: PAGE_TEXT, available: true, textOrigin: 'ocr', pageNumber: 7 })
    render(<ScannedTextPanel documentId="d1" pageNumber={7}
                             onTextReady={() => {}} buildPageText={() => ({})} />)
    open()
    const body = await screen.findByRole('region', { name: /scanned text from page 7/i })
    // ⛔ THE SAME ATTRIBUTE A RENDERED PAGE CARRIES. Without it the viewer's
    // `selectionchange` handler cannot tell which page a selection belongs to,
    // and "Save excerpt" never appears.
    expect(body.getAttribute('data-pdf-page-number')).toBe('7')
  })

  it('hands the viewer the text and offsets a selection will resolve against', async () => {
    const onTextReady = vi.fn()
    const buildPageText = vi.fn(() => ({ fullText: PAGE_TEXT, map: [] }))
    mockTranscript({ text: PAGE_TEXT, available: true, textOrigin: 'ocr', pageNumber: 3 })
    render(<ScannedTextPanel documentId="d1" pageNumber={3}
                             onTextReady={onTextReady} buildPageText={buildPageText} />)
    open()
    await screen.findByText(PAGE_TEXT)
    await waitFor(() => expect(onTextReady).toHaveBeenCalled())
    expect(onTextReady).toHaveBeenCalledWith(3, { fullText: PAGE_TEXT, map: [] })
  })

  it('collapses when the page changes, rather than showing the last page\'s words', async () => {
    mockTranscript({ text: PAGE_TEXT, available: true, textOrigin: 'ocr', pageNumber: 1 })
    const { rerender } = render(
      <ScannedTextPanel documentId="d1" pageNumber={1}
                        onTextReady={() => {}} buildPageText={() => ({})} />)
    open()
    await screen.findByText(PAGE_TEXT)
    rerender(<ScannedTextPanel documentId="d1" pageNumber={2}
                               onTextReady={() => {}} buildPageText={() => ({})} />)
    expect(screen.queryByText(PAGE_TEXT)).not.toBeInTheDocument()
  })
})

describe('what it says about itself', () => {
  it('tells the member to check the figures against the page', async () => {
    mockTranscript({ text: PAGE_TEXT, available: true, textOrigin: 'ocr', pageNumber: 1 })
    render(<ScannedTextPanel documentId="d1" pageNumber={1}
                             onTextReady={() => {}} buildPageText={() => ({})} />)
    open()
    expect(await screen.findByText(/check exact figures against the page/i))
      .toBeInTheDocument()
  })

  it('never names the engine, and never calls itself the document', async () => {
    // ⛔ §13 — member language. And §11: it is a selection aid, not the source.
    mockTranscript({ text: PAGE_TEXT, available: true, textOrigin: 'ocr', pageNumber: 1 })
    const { container } = render(
      <ScannedTextPanel documentId="d1" pageNumber={1}
                        onTextReady={() => {}} buildPageText={() => ({})} />)
    open()
    await screen.findByText(PAGE_TEXT)
    const words = container.textContent.toLowerCase()
    for (const banned of ['tesseract', 'ocr', 'transcription', 'text layer']) {
      expect(words).not.toContain(banned)
    }
  })

  it('is reachable as text, not as an aria-hidden overlay', async () => {
    // §39 — a screen reader has to be able to read the page's words too.
    mockTranscript({ text: PAGE_TEXT, available: true, textOrigin: 'ocr', pageNumber: 5 })
    render(<ScannedTextPanel documentId="d1" pageNumber={5}
                             onTextReady={() => {}} buildPageText={() => ({})} />)
    open()
    const body = await screen.findByRole('region', { name: /scanned text from page 5/i })
    expect(body.getAttribute('aria-hidden')).toBeNull()
    expect(body.textContent).toContain('$12.48 billion')
  })
})
