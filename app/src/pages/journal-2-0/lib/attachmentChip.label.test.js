/**
 * D2 item 6: an OPTIONAL `label` on the attachment chip. `[the report](q3%20report.pdf)`
 * keeps the member's words: the chip shows the label, the download name stays `name`.
 * ⛔ A chip with no label (every note written before this) must render, parse and read
 * exactly as before: the first test pins today's HTML byte for byte.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Editor, generateHTML, generateJSON } from '@tiptap/core'
import { buildExtensions, extractPlainText } from './tiptap'

const EXT = buildExtensions()
const HREF = '/api/j2/notes/attachments/u1/n1/file/q3 report.pdf'
const chipDoc = (attrs) => ({ type: 'doc', content: [{ type: 'attachmentChip', attrs }] })

let editor
afterEach(() => { editor?.destroy(); editor = null })

describe('attachmentChip — an absent label is today\'s chip', () => {
  it('renders, parses back and reads exactly as before', () => {
    const html = generateHTML(chipDoc({ href: HREF, name: 'q3 report.pdf', size: 12 }), EXT)
    expect(html).toBe(
      '<a data-type="attachmentChip" data-name="q3 report.pdf" data-size="12" '
      + 'href="/api/j2/notes/attachments/u1/n1/file/q3 report.pdf" download="q3 report.pdf" '
      + 'rel="noreferrer">q3 report.pdf</a>')
    const back = generateJSON(html, EXT).content[0]
    expect(back.attrs).toEqual({ href: HREF, name: 'q3 report.pdf', size: 12, label: null })
    expect(extractPlainText(chipDoc({ href: HREF, name: 'q3 report.pdf' }))).toBe('[file: q3 report.pdf]')
  })

  it('shows the name in the live editor', () => {
    editor = new Editor({ extensions: EXT, content: chipDoc({ href: HREF, name: 'q3 report.pdf' }) })
    const a = editor.view.dom.querySelector('a[data-type="attachmentChip"]')
    expect(a.textContent).toBe('q3 report.pdf')
    expect(a.getAttribute('download')).toBe('q3 report.pdf')
    expect(a.hasAttribute('data-label')).toBe(false)
  })
})

describe('attachmentChip — a label is shown, the download stays the name', () => {
  it('renders the label as the chip text and keeps it through a parse', () => {
    const html = generateHTML(chipDoc({ href: HREF, name: 'q3 report.pdf', label: 'the report' }), EXT)
    expect(html).toBe(
      '<a data-type="attachmentChip" data-name="q3 report.pdf" data-label="the report" title="q3 report.pdf" '
      + 'href="/api/j2/notes/attachments/u1/n1/file/q3 report.pdf" download="q3 report.pdf" '
      + 'rel="noreferrer">the report</a>')
    const back = generateJSON(html, EXT).content[0]
    expect(back.attrs).toEqual({ href: HREF, name: 'q3 report.pdf', size: null, label: 'the report' })
  })

  it('shows the label in the live editor and downloads under the name', () => {
    editor = new Editor({ extensions: EXT, content: chipDoc({ href: HREF, name: 'q3 report.pdf', label: 'the report' }) })
    const a = editor.view.dom.querySelector('a[data-type="attachmentChip"]')
    expect(a.textContent).toBe('the report')
    expect(a.getAttribute('download')).toBe('q3 report.pdf')
    expect(a.getAttribute('data-name')).toBe('q3 report.pdf')
  })

  it('an empty or non-string label is no label', () => {
    for (const label of ['', '   ', 7, null]) {
      const html = generateHTML(chipDoc({ href: HREF, name: 'q3 report.pdf', label }), EXT)
      expect(html, String(label)).toContain('>q3 report.pdf</a>')
      expect(html, String(label)).not.toContain('data-label')
    }
  })

  it('a label never hides the real file: its name is on hover and is the download (D2 fix round 1, M3)', () => {
    // `[invoice.pdf](payload.exe)`: the chip reads invoice.pdf, so the real name must show.
    editor = new Editor({ extensions: EXT, content: chipDoc({ href: HREF, name: 'payload.exe', label: 'invoice.pdf' }) })
    const a = editor.view.dom.querySelector('a[data-type="attachmentChip"]')
    expect(a.textContent).toBe('invoice.pdf')
    expect(a.getAttribute('title')).toBe('payload.exe')
    expect(a.getAttribute('download')).toBe('payload.exe')
    // No label, no title: today's chip, unchanged.
    const plain = generateHTML(chipDoc({ href: HREF, name: 'payload.exe' }), EXT)
    expect(plain).not.toContain('title=')
  })

  it('search and citation text name the file, label or not', () => {
    expect(extractPlainText(chipDoc({ href: HREF, name: 'q3 report.pdf', label: 'the report' })))
      .toBe('[file: q3 report.pdf]')
  })
})
