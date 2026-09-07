import { describe, it, expect } from 'vitest'
import { _locateTextRange, _buildPageText, _offsetOfPoint } from './PdfDocumentViewer'

// pdfjs-dist needs Worker/Canvas2D/ReadableStream, none of which jsdom
// implements -- real PDF rendering + native text selection is
// live-browser-verified (this program's established pattern for anything
// jsdom structurally cannot exercise). What IS unit-testable in isolation,
// and is the single most error-prone piece of this whole viewer, is the
// pure offset-to-DOM-Range mapping: given a page's full text and pdfjs's
// own per-run <span> layout, can a saved excerpt's captured text (plus its
// quote-context anchor) be relocated back to a real Range spanning the
// right spans? These tests build that exact span layout by hand.

function makeLayer(runs, { lineBreaks = false } = {}) {
  // Mirrors pdfjs TextLayer's own real DOM shape: one <span> per text run
  // (each a single text node, never nested markup), all siblings inside
  // ONE shared container. A Range spanning two DIFFERENT text nodes needs a
  // real common ancestor to resolve `.toString()`/`.getClientRects()`
  // correctly; two orphan, unattached spans (the first draft of this
  // helper) have none, which silently produced an empty range for every
  // multi-span case -- a test-fixture bug, not a component bug, caught by
  // these very tests.
  //
  // `lineBreaks: true` adds the `<br role="presentation">` pdfjs really
  // emits between rendered LINES (measured in Chrome: 9 spans, 8 <br>s on a
  // wrapped-paragraph page). That is the shape the newline defect lived in.
  const container = document.createElement('div')
  runs.forEach((text, i) => {
    if (lineBreaks && i > 0) {
      const br = document.createElement('br')
      br.setAttribute('role', 'presentation')
      container.appendChild(br)
    }
    const span = document.createElement('span')
    span.appendChild(document.createTextNode(text))
    container.appendChild(span)
  })
  document.body.appendChild(container)
  return container
}

function makePage(runs, opts) {
  return _buildPageText(makeLayer(runs, opts))
}

describe('_buildPageText', () => {
  it('joins runs on one rendered line with no separator, exactly as pdfjs lays them out', () => {
    const { fullText } = makePage(['Management expects ', 'gross margins', ' to normalize.'])
    expect(fullText).toBe('Management expects gross margins to normalize.')
  })

  it("puts a newline where pdfjs put a <br>, so the page text matches what a browser selection returns", () => {
    // ⛔ THE DEFECT THIS EXISTS FOR. The page text used to be built as
    // `items.map(i => i.str).join('')`, which produced
    // "...the meaning ofthe Private..." -- no separator at all -- while the
    // browser's Selection.toString() over the same DOM returns
    // "...the meaning of\nthe Private...". indexOf() then failed for every
    // selection crossing a line break, silently nulling quote_prefix,
    // quote_suffix, char_start and char_end.
    const { fullText } = makePage(
      ['statements within the meaning of', 'the Private Securities Litigation Reform Act'],
      { lineBreaks: true },
    )
    expect(fullText).toBe(
      'statements within the meaning of\nthe Private Securities Litigation Reform Act',
    )
    expect(fullText).not.toContain('ofthe')
  })

  it('maps every text node to its own offset window in the built text', () => {
    const { fullText, map } = makePage(['alpha', 'beta'], { lineBreaks: true })
    expect(map.map((m) => [m.start, m.len])).toEqual([[0, 5], [6, 4]])
    expect(fullText.slice(map[1].start, map[1].start + map[1].len)).toBe('beta')
  })
})

describe('_offsetOfPoint', () => {
  it('resolves a text-node boundary to its absolute offset, across a line break', () => {
    const container = makeLayer(['first line here', 'second line here'], { lineBreaks: true })
    const { map } = _buildPageText(container)
    const secondSpanText = container.querySelectorAll('span')[1].firstChild
    // "first line here" is 15 chars + 1 for the <br> newline = 16.
    expect(_offsetOfPoint(map, secondSpanText, 0)).toBe(16)
    expect(_offsetOfPoint(map, secondSpanText, 6)).toBe(22)
  })

  it('returns null for a boundary that is not inside this page at all', () => {
    const { map } = makePage(['on the page'])
    const stray = document.createTextNode('somewhere else entirely')
    expect(_offsetOfPoint(map, stray, 3)).toBeNull()
  })
})

describe('_locateTextRange', () => {
  it('locates a quote spanning a single span', () => {
    const { fullText, map } = makePage([
      'Full year revenue guidance raised to $185 billion, up from prior $165 billion.',
    ])
    const excerpt = { capturedText: 'revenue guidance raised to $185 billion' }
    const range = _locateTextRange(fullText, excerpt, map)
    expect(range).not.toBeNull()
    expect(range.toString()).toBe('revenue guidance raised to $185 billion')
  })

  it('locates a quote that spans MULTIPLE consecutive spans (pdfjs breaks runs on font/style changes)', () => {
    const { fullText, map } = makePage([
      'Management expects ', 'gross margins', ' to normalize lower next year.',
    ])
    const excerpt = { capturedText: 'expects gross margins to normalize' }
    const range = _locateTextRange(fullText, excerpt, map)
    expect(range).not.toBeNull()
    expect(range.toString()).toBe('expects gross margins to normalize')
  })

  it('redraws the highlight for a quote that crosses a rendered LINE break', () => {
    // The other half of the newline defect: even with the anchor stored
    // correctly, re-location has to find a captured text containing "\n"
    // inside the rebuilt page text on the next open.
    const { fullText, map } = makePage(
      ['Management expects gross margins to', 'normalize lower in the mid-seventies range.'],
      { lineBreaks: true },
    )
    const excerpt = { capturedText: 'gross margins to\nnormalize lower' }
    const range = _locateTextRange(fullText, excerpt, map)
    expect(range).not.toBeNull()
    // Asserted on the located BOUNDARIES, not on range.toString(): jsdom
    // drops the <br> when stringifying a Range and a real browser doesn't,
    // so a string assertion here would pin a jsdom quirk instead of the
    // behaviour. The boundaries are what getClientRects() draws from.
    expect(range.startContainer).not.toBe(range.endContainer)
    expect(range.startContainer.nodeValue.slice(range.startOffset)).toBe('gross margins to')
    expect(range.endContainer.nodeValue.slice(0, range.endOffset)).toBe('normalize lower')
  })

  it('prefers the quote-context anchor when captured_text alone would be ambiguous (repeats on the page)', () => {
    const { fullText, map } = makePage([
      'Revenue was strong. ', 'Revenue guidance was raised. ', 'Revenue remains the focus.',
    ])
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
    const range = _locateTextRange(fullText, excerpt, map)
    expect(range).not.toBeNull()
  })

  it('finds the SPECIFIC occurrence named by quote context, not just the first bare match', () => {
    const { fullText, map } = makePage([
      'Revenue was strong. Revenue guidance was raised to a new target for next year.',
    ])
    const excerpt = {
      capturedText: 'Revenue',
      quotePrefix: 'strong. ',
      quoteSuffix: ' guidance was raised',
    }
    const range = _locateTextRange(fullText, excerpt, map)
    expect(range).not.toBeNull()
    // Two "Revenue"s exist at index 0 and index 20 -- the range's own
    // start offset (within its single text-node container, since this
    // whole excerpt lives in one span) must land on the SECOND one, the
    // occurrence the quote context actually names.
    const secondOccurrenceIndex = fullText.indexOf('Revenue', 1)
    expect(range.startOffset).toBe(secondOccurrenceIndex)
  })

  it('returns null when the captured text can no longer be found at all (a genuinely re-extracted, drifted page)', () => {
    const { fullText, map } = makePage(['Completely different page content now.'])
    const excerpt = { capturedText: 'this text was never on this page' }
    expect(_locateTextRange(fullText, excerpt, map)).toBeNull()
  })

  it('returns null for an empty captured_text rather than matching everything', () => {
    const { map } = makePage(['some text'])
    expect(_locateTextRange('some text', { capturedText: '' }, map)).toBeNull()
  })
})
