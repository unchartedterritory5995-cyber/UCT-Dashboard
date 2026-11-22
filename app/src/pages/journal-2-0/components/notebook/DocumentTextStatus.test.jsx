// ⚰️ THE GAP THIS COVERS. The document status labels lived only in
// TickerResearchWorkspace; the note editor — where the member actually
// uploads the file — showed nothing. A member searching for a phrase they can
// SEE on a scanned page got zero results and no explanation anywhere.
//
// ⛔ AND THE SENTENCE IS THE TEST. Colour cannot carry the state (§52), so
// every assertion here is on words a member reads, never on a class name.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import DocumentTextStatus, { documentTextNotice } from './DocumentTextStatus'
// The component's own source, so the icon-name check reads what it ASKS for
// rather than a list retyped here that could drift away from it.
import DocumentTextStatusSource from './DocumentTextStatus?raw'

const complete = {
  id: 'd1', name: 'NVDA 10-Q.pdf', status: 'ready',
  pagesTotal: 3, pagesWithText: 3, pagesAwaitingOcr: 0, textComplete: true,
}

describe('a captured web source is not a scan', () => {
  // The row `tweet_capture_sync.remove_post` leaves behind: the document stays, its page does not.
  const removedPost = {
    id: 'x1', name: '@north_ledger on X', status: 'ready', sourceKind: 'web',
    attachmentUrl: 'x:1990000000000000004',
    pagesTotal: 0, pagesWithText: 0, pagesAwaitingOcr: 0, textComplete: false,
  }

  it('says nothing about a post that left X', () => {
    expect(documentTextNotice(removedPost)).toBeNull()
    const { container } = render(<DocumentTextStatus documents={[removedPost]} imageUrls={new Set()} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('still calls a real file with no text a scan (the guard is the source kind, not the numbers)', () => {
    const scan = { ...removedPost, name: 'Scanned.pdf', sourceKind: 'attachment', attachmentUrl: '/a/Scanned.pdf' }
    expect(documentTextNotice(scan).text).toMatch(/looks like a scan/)
  })
})

describe('it speaks only when there is something to disclose', () => {
  it('renders NOTHING for a fully readable document', () => {
    const { container } = render(<DocumentTextStatus documents={[complete]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing at all with no documents', () => {
    const { container } = render(<DocumentTextStatus documents={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('⛔⛔ says NOTHING when the server sent no page counts', () => {
    // ⚰️ Caught by the existing editor suite the day this shipped: a payload
    // without the page fields — an older cached bundle mid-deploy, a stubbed
    // fixture, a partial response — fell through to "looks like a scan" and
    // called a perfectly readable document unreadable. Absence of data is not
    // evidence of absence of text.
    const { container } = render(<DocumentTextStatus documents={[
      { id: 'd9', name: 'report.pdf', status: 'ready' }]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('what it says', () => {
  it('⛔ a partly-read document names the shortfall in PAGES', () => {
    // ⚰️ P0 measured exactly this document — [492, 0, 781] characters, status
    // `ready` — and nothing anywhere told the member page 2 was unreadable.
    render(<DocumentTextStatus documents={[{
      ...complete, pagesWithText: 2, textComplete: false }]} />)
    expect(screen.getByText(/text available for 2 of 3 pages/i)).toBeTruthy()
    expect(screen.getByText(/1 page could not be read/i)).toBeTruthy()
  })

  it('a scan with nothing read yet says so, and says why it matters', () => {
    render(<DocumentTextStatus documents={[{
      ...complete, pagesWithText: 0, textComplete: false }]} />)
    expect(screen.getByText(/looks like a scan/i)).toBeTruthy()
    expect(screen.getByText(/Search and Ask cannot use it/i)).toBeTruthy()
  })

  it('while reading, it reports what is ALREADY usable', () => {
    // ⛔ "Reading…" alone reads as "nothing works yet", which stops being true
    // the moment the first page lands.
    render(<DocumentTextStatus documents={[{
      ...complete, pagesWithText: 1, pagesAwaitingOcr: 2, textComplete: false,
      status: 'pending' }]} />)
    expect(screen.getByText(/reading scanned text/i)).toBeTruthy()
    expect(screen.getByText(/1 of 3 pages ready so far/i)).toBeTruthy()
  })

  it('a failed document says it could not be processed', () => {
    render(<DocumentTextStatus documents={[{
      ...complete, status: 'processing_failed', pagesTotal: 0,
      pagesWithText: 0, textComplete: false }]} />)
    expect(screen.getByText(/couldn't be processed/i)).toBeTruthy()
  })

  it('⛔ never shows engine, model or version language (§24)', () => {
    const { container } = render(<DocumentTextStatus documents={[{
      ...complete, pagesWithText: 0, pagesAwaitingOcr: 3, textComplete: false }]} />)
    const txt = container.textContent.toLowerCase()
    for (const jargon of ['onnx', 'inference', 'engine', 'model', 'ocr']) {
      expect(txt).not.toContain(jargon)
    }
  })
})

describe('assistive technology', () => {
  it('is a NAMED live region', () => {
    // ⛔ `[role="status"]` is shared by several components here; an unnamed one
    // is indistinguishable from the others to a screen reader and to a probe.
    render(<DocumentTextStatus documents={[{
      ...complete, pagesWithText: 2, textComplete: false }]} />)
    expect(screen.getByLabelText('Attachment text status')).toBeTruthy()
  })
})

describe('the pure notice function', () => {
  it('is null when the document is complete, so callers cannot render an empty row', () => {
    expect(documentTextNotice(complete)).toBeNull()
    expect(documentTextNotice(null)).toBeNull()
  })

  it('pluralises the shortfall correctly', () => {
    const two = documentTextNotice({ ...complete, pagesWithText: 1, textComplete: false })
    expect(two.text).toMatch(/2 pages could not be read/)
  })
})

describe('the icons are real', () => {
  // ⚰️ The first cut asked UIcon for "alert", which is not in the registry.
  // UIcon degrades to nothing and only warns on the console, so every test
  // above stayed green while the row rendered with no glyph at all — a
  // silent no-op is exactly the failure this repo's icon system has produced
  // before. This asserts against the registry rather than against a render.
  it('every icon this component asks for exists in UIcon', async () => {
    const mod = await import('../../../../components/ui/UIcon')
    const src = DocumentTextStatusSource
    const asked = [...src.matchAll(/icon: '([a-zA-Z0-9_-]+)'/g)].map((m) => m[1])
    expect(asked.length).toBeGreaterThan(0)
    for (const name of asked) {
      // UIcon warns and renders null for an unknown name; a known one renders.
      const { container } = render(<mod.default name={name} size={12} />)
      expect(container.querySelector('svg'), `UIcon has no glyph "${name}"`).toBeTruthy()
    }
  })
})

// ── Wave P2 §19/§21 ─────────────────────────────────────────────────────────

describe('a claim nobody can serve is not "processing"', () => {
  const claimed = {
    id: 'd9', name: 'board-pack.pdf', status: 'pending',
    pagesTotal: 4, pagesWithText: 0, pagesAwaitingOcr: 4, textComplete: false,
  }

  it('says the scan has not been read, rather than reading forever', () => {
    // ⚰️ A spinner that can never resolve is a worse lie than "we cannot read
    // this", because the member keeps waiting for it.
    const n = documentTextNotice({ ...claimed, ocrUnavailable: true })
    expect(n.text).toMatch(/has not been read/i)
    expect(n.text).not.toMatch(/reading/i)
    expect(n.tone).not.toBe('busy')
  })

  it('still says "reading" while an engine is actually there', () => {
    // ⛔ THE CONTROL. Without it, a version that always said "not read" would
    // pass — replacing one lie with another.
    const n = documentTextNotice({ ...claimed, ocrUnavailable: false })
    expect(n.text).toMatch(/reading scanned text/i)
    expect(n.tone).toBe('busy')
  })

  it('keeps naming what is already usable when some pages landed first', () => {
    const n = documentTextNotice({
      ...claimed, pagesWithText: 1, pagesAwaitingOcr: 3, ocrUnavailable: true,
    })
    expect(n.text).toMatch(/1 of 4/)
    expect(n.text).toMatch(/have not been read/i)
  })
})

describe('a complete document still discloses that it was scanned', () => {
  it('says so, and tells the member to check the page', () => {
    const n = documentTextNotice({
      id: 'd10', name: 'exhibit.pdf', status: 'ready',
      pagesTotal: 2, pagesWithText: 2, pagesFromOcr: 2,
      pagesAwaitingOcr: 0, textComplete: true,
    })
    expect(n).not.toBeNull()
    expect(n.text).toMatch(/scanned/i)
    expect(n.text).toMatch(/check exact figures/i)
  })

  it('stays silent for a complete document that was never scanned', () => {
    // ⛔ The overwhelmingly common case gets no chrome. A disclosure that
    // appears on every attachment is furniture, and stops being read.
    expect(documentTextNotice({
      id: 'd11', name: 'native.pdf', status: 'ready',
      pagesTotal: 2, pagesWithText: 2, pagesFromOcr: 0,
      pagesAwaitingOcr: 0, textComplete: true,
    })).toBeNull()
  })

  it('says nothing when the server did not send the scanned-page count', () => {
    expect(documentTextNotice({
      id: 'd12', name: 'older-bundle.pdf', status: 'ready',
      pagesTotal: 2, pagesWithText: 2, pagesAwaitingOcr: 0, textComplete: true,
    })).toBeNull()
  })
})

// ⛔ Audit 2026-11-05, spec S5 (B4): a note holding only widgets showed FOUR "Image — Text read
// from a scanned page" lines, and a plain screenshot showed "Image looks like a scan". Root cause:
// every widget's archived snapshot PNG is uploaded through the image door (lib/embedArchive.js),
// which makes each one an OCR document; OCR then reads the chart's axis numbers. An image document
// is spoken of only when the note holds that image, and only while it is pending or has no text.
describe('S5 (B4): images are spoken of only when the note holds them', () => {
  const img = (id, file, extra) => ({
    id, name: 'Image', attachmentUrl: `/api/j2/notes/attachments/u1/n1/inline/${file}`,
    pagesTotal: 1, pagesWithText: 1, pagesFromOcr: 1, pagesAwaitingOcr: 0, textComplete: true,
    status: 'ready', ...extra,
  })
  const snapshotOcr = img('d1', 'snap1.png')                                     // a widget's archive PNG
  const noText = img('d2', 'shot.png', { pagesWithText: 0, pagesFromOcr: 0, textComplete: false, status: 'no_text' })
  const pending = img('d3', 'new.png', { pagesTotal: 0, pagesWithText: 0, pagesFromOcr: 0, textComplete: false, status: 'pending' })

  it('widget snapshots (images the note does not hold) say nothing', () => {
    const { container } = render(<DocumentTextStatus documents={[snapshotOcr, noText, pending]} imageUrls={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('an image the note holds whose text WAS read says nothing (no scan disclosure for a picture)', () => {
    const { container } = render(<DocumentTextStatus documents={[snapshotOcr]}
      imageUrls={['/api/j2/notes/attachments/u1/n1/inline/snap1.png']} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('an image the note holds that is pending or has no text is said, without calling it a scan', () => {
    render(<DocumentTextStatus documents={[noText, pending]}
      imageUrls={['/api/j2/notes/attachments/u1/n1/inline/shot.png', '/api/j2/notes/attachments/u1/n1/inline/new.png']} />)
    const region = screen.getByRole('status', { name: 'Attachment text status' })
    expect(region).toHaveTextContent('Image has no readable text, so Search and Ask cannot use it.')
    expect(region).toHaveTextContent('Image is still being read…')
    expect(region.textContent).not.toMatch(/scan/i)
  })

  it('CONTROL: a PDF is unchanged, whatever the body holds', () => {
    const pdf = { id: 'p', name: 'Deck.pdf', attachmentUrl: '/api/j2/notes/attachments/u1/n1/file/deck.pdf',
      status: 'ready', pagesTotal: 2, pagesWithText: 0, pagesAwaitingOcr: 0, textComplete: false }
    render(<DocumentTextStatus documents={[pdf]} imageUrls={[]} />)
    expect(screen.getByRole('status')).toHaveTextContent('looks like a scan')
  })
})
