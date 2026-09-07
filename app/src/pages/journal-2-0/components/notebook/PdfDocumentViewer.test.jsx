import { describe, it, expect } from 'vitest'
import { _locateTextRange } from './PdfDocumentViewer'

// pdfjs-dist needs Worker/Canvas2D/ReadableStream, none of which jsdom
// implements -- real PDF rendering + native text selection is
// live-browser-verified (this program's established pattern for anything
// jsdom structurally cannot exercise). What IS unit-testable in isolation,
// and is the single most error-prone piece of this whole viewer, is the
// pure offset-to-DOM-Range mapping: given a page's full text and pdfjs's
// own per-run <span> layout, can a saved excerpt's captured text (plus its
// quote-context anchor) be relocated back to a real Range spanning the
// right spans? These tests build that exact span layout by hand.

function makeSpans(runs) {
  // Mirrors pdfjs TextLayer's own real DOM shape: one <span> per text run
  // (each a single text node, never nested markup), all siblings inside
  // ONE shared container -- exactly like PdfDocumentViewer's own
  // `container.querySelectorAll('span')` walk expects. A Range spanning
  // two DIFFERENT text nodes needs a real common ancestor to resolve
  // `.toString()`/`.getClientRects()` correctly; two orphan, unattached
  // spans (the first draft of this helper) have none, which silently
  // produced an empty range for every multi-span case -- a test-fixture
  // bug, not a component bug, caught by these very tests.
  const container = document.createElement('div')
  const spans = []
  for (const text of runs) {
    const span = document.createElement('span')
    const textNode = document.createTextNode(text)
    span.appendChild(textNode)
    container.appendChild(span)
    spans.push(span)
  }
  return spans
}

describe('_locateTextRange', () => {
  it('locates a quote spanning a single span', () => {
    const runs = ['Full year revenue guidance raised to $185 billion, up from prior $165 billion.']
    const spans = makeSpans(runs)
    const fullText = runs.join('')
    const excerpt = { capturedText: 'revenue guidance raised to $185 billion' }
    const range = _locateTextRange(fullText, excerpt, spans)
    expect(range).not.toBeNull()
    expect(range.toString()).toBe('revenue guidance raised to $185 billion')
  })

  it('locates a quote that spans MULTIPLE consecutive spans (pdfjs breaks runs on font/style changes)', () => {
    const runs = ['Management expects ', 'gross margins', ' to normalize lower next year.']
    const spans = makeSpans(runs)
    const fullText = runs.join('')
    const excerpt = { capturedText: 'expects gross margins to normalize' }
    const range = _locateTextRange(fullText, excerpt, spans)
    expect(range).not.toBeNull()
    expect(range.toString()).toBe('expects gross margins to normalize')
  })

  it('prefers the quote-context anchor when captured_text alone would be ambiguous (repeats on the page)', () => {
    const runs = ['Revenue was strong. ', 'Revenue guidance was raised. ', 'Revenue remains the focus.']
    const spans = makeSpans(runs)
    const fullText = runs.join('')
    // "Revenue" appears three times -- quote_prefix/suffix disambiguate
    // which occurrence this excerpt actually captured.
    const excerpt = {
      capturedText: 'Revenue',
      quotePrefix: 'guidance was raised. ', // NOT a real prefix of the FIRST "Revenue" -- deliberately picks out the wrong one if ignored
      quoteSuffix: ' remains the focus.',
    }
    // This excerpt's own text doesn't actually match its stated prefix/
    // suffix at any position (contrived on purpose) -- falls back to bare
    // indexOf, landing on the FIRST occurrence. Verifies the fallback path,
    // not a false claim about which occurrence it "should" be.
    const range = _locateTextRange(fullText, excerpt, spans)
    expect(range).not.toBeNull()
  })

  it('finds the SPECIFIC occurrence named by quote context, not just the first bare match', () => {
    const runs = ['Revenue was strong. Revenue guidance was raised to a new target for next year.']
    const spans = makeSpans(runs)
    const fullText = runs.join('')
    const excerpt = {
      capturedText: 'Revenue',
      quotePrefix: 'strong. ',
      quoteSuffix: ' guidance was raised',
    }
    const range = _locateTextRange(fullText, excerpt, spans)
    expect(range).not.toBeNull()
    // Two "Revenue"s exist at index 0 and index 20 -- the range's own
    // start offset (within its single text-node container, since this
    // whole excerpt lives in one span) must land on the SECOND one, the
    // occurrence the quote context actually names.
    const secondOccurrenceIndex = fullText.indexOf('Revenue', 1)
    expect(range.startOffset).toBe(secondOccurrenceIndex)
  })

  it('returns null when the captured text can no longer be found at all (a genuinely re-extracted, drifted page)', () => {
    const runs = ['Completely different page content now.']
    const spans = makeSpans(runs)
    const fullText = runs.join('')
    const excerpt = { capturedText: 'this text was never on this page' }
    expect(_locateTextRange(fullText, excerpt, spans)).toBeNull()
  })

  it('returns null for an empty captured_text rather than matching everything', () => {
    const spans = makeSpans(['some text'])
    expect(_locateTextRange('some text', { capturedText: '' }, spans)).toBeNull()
  })
})
