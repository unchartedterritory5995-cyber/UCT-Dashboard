// The Export dialog's format choice (wave 8, lane 8C, C4, ruling D-C4): a real radio group.
//
// ⛔ Copy is asserted as rendered text. ⛔ `fetch` is read from `fetch.mock.calls` OUTSIDE
// any mock callback. ExportDialog.test.jsx (the original door rails) stays as it was: the
// default is still Markdown, through the same URL, byte for byte.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import ExportDialog from './ExportDialog'
import { EXPORT_FORMATS, notebookExportUrl, filenameFromDisposition } from './exportFormats'

let clicked
beforeEach(() => {
  clicked = []
  const realCreate = document.createElement.bind(document)
  vi.spyOn(document, 'createElement').mockImplementation((tag, ...rest) => {
    const el = realCreate(tag, ...rest)
    if (tag === 'a') el.click = () => { clicked.push(el.download) }
    return el
  })
  global.URL.createObjectURL = vi.fn(() => 'blob:mock')
  global.URL.revokeObjectURL = vi.fn()
  global.fetch = vi.fn()
})
afterEach(() => { vi.restoreAllMocks() })

const ok = (disposition) => ({
  ok: true,
  status: 200,
  blob: async () => new Blob(['PK']),
  headers: { get: (n) => (n.toLowerCase() === 'content-disposition' ? disposition : null) },
})

describe('the format radio group', () => {
  it('is one fieldset named "Format", four radios, Markdown checked by default', () => {
    render(<ExportDialog open onClose={() => {}} />)
    const group = screen.getByRole('group', { name: 'Format' })
    const radios = within(group).getAllByRole('radio')
    expect(radios.map((r) => r.value)).toEqual(['md', 'html', 'json', 'docx'])
    expect(new Set(radios.map((r) => r.name)).size).toBe(1)
    expect(screen.getByRole('radio', { name: 'Markdown' })).toBeChecked()
    expect(screen.getByRole('button', { name: 'Download Markdown' })).toBeInTheDocument()
  })

  it('each option says what it keeps, and that sentence is its description', () => {
    render(<ExportDialog open onClose={() => {}} />)
    for (const f of EXPORT_FORMATS) {
      const radio = screen.getByRole('radio', { name: f.label })
      expect(screen.getByText(f.keeps)).toBeInTheDocument()
      expect(document.getElementById(radio.getAttribute('aria-describedby')).textContent).toBe(f.keeps)
    }
  })

  it('the member-facing sentences, verbatim', () => {
    render(<ExportDialog open onClose={() => {}} />)
    expect(screen.getByText('For a PDF, open a note and choose Print, then Save as PDF.')).toBeInTheDocument()
    expect(screen.getByText(/Downloads every note in your notebook as one zip archive/)).toBeInTheDocument()
    expect(EXPORT_FORMATS.map((f) => f.keeps)).toEqual([
      'Plain-text files with your folders, tags and attachments. Opens in Obsidian and any Markdown app, and imports back into UCT.',
      'Each note as a page that opens in any browser, offline, with its images, tables and formatting.',
      'Every note exactly as stored, with nothing left out. The format to bring your notes back into UCT with no loss.',
      'Each note as a Word document with its headings, lists, tables and images. Blocks Word has no match for become plain text.',
    ])
  })

  for (const f of EXPORT_FORMATS) {
    it(`choosing ${f.label} downloads the ${f.id} archive`, async () => {
      global.fetch.mockResolvedValue(ok(`attachment; filename="uct-notebook-export-20260926-${f.id}.zip"`))
      render(<ExportDialog open onClose={() => {}} />)
      fireEvent.click(screen.getByRole('radio', { name: f.label }))
      expect(screen.getByRole('radio', { name: f.label })).toBeChecked()
      fireEvent.click(screen.getByRole('button', { name: `Download ${f.label}` }))
      await waitFor(() => expect(screen.getByText('Your download has started.')).toBeInTheDocument())
      expect(global.fetch.mock.calls.map((c) => c[0])).toEqual([notebookExportUrl(f.id)])
      expect(clicked).toEqual([`uct-notebook-export-20260926-${f.id}.zip`])
    })
  }

  it('the URLs: Markdown keeps its original door; the rest take format=', () => {
    expect(notebookExportUrl('md')).toBe('/api/j2/notes/export')
    expect(notebookExportUrl('html')).toBe('/api/j2/export/notebook?format=html')
    expect(notebookExportUrl('json')).toBe('/api/j2/export/notebook?format=json')
    expect(notebookExportUrl('docx')).toBe('/api/j2/export/notebook?format=docx')
  })

  it('the 429 sentence is the busy sentence, rendered', async () => {
    global.fetch.mockResolvedValue({ ok: false, status: 429, headers: { get: () => null }, json: async () => ({}) })
    render(<ExportDialog open onClose={() => {}} />)
    fireEvent.click(screen.getByRole('radio', { name: 'JSON' }))
    fireEvent.click(screen.getByRole('button', { name: 'Download JSON' }))
    expect(await screen.findByText('An export is already running for your account. Please wait a moment and try again.')).toBeInTheDocument()
    // Try again returns to the choice, which is kept.
    fireEvent.click(screen.getByRole('button', { name: /try again/i }))
    expect(screen.getByRole('radio', { name: 'JSON' })).toBeChecked()
  })
})

describe('filenameFromDisposition', () => {
  it('prefers the UTF-8 filename*, falls back to filename, then to the fallback', () => {
    expect(filenameFromDisposition(`attachment; filename="a_b.md"; filename*=UTF-8''${encodeURIComponent('a—b.md')}`, 'x')).toBe('a—b.md')
    expect(filenameFromDisposition('attachment; filename="plain.zip"', 'x')).toBe('plain.zip')
    expect(filenameFromDisposition(null, 'fallback.zip')).toBe('fallback.zip')
    // A malformed escape falls through to the plain name rather than throwing.
    expect(filenameFromDisposition(`attachment; filename="safe.md"; filename*=UTF-8''%E0%A4%A`, 'x')).toBe('safe.md')
  })
})
