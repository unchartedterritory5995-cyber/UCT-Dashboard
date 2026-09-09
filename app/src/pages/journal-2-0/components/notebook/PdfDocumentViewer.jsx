import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { pdfjsLib, loadPdfDocument } from '../../lib/pdfjs'
import ScannedTextPanel from './ScannedTextPanel'
import styles from './PdfDocumentViewer.module.css'

const OVERSCAN = 2
const PAGE_GAP = 12
const QUOTE_CONTEXT_CHARS = 200
const EMPHASIS_MS = 2200
// A US-letter page at pdfjs scale 1 is 612 CSS px; browsers and print both
// treat ~96dpi (816px, scale 1.33) as its natural size. 960 leaves a little
// headroom above that for dense financial tables without tipping into
// magnification -- see the `renderWidth` comment for what uncapped did.
const MAX_PAGE_WIDTH = 960

/**
 * Wave J — a real, selectable PDF page renderer (canvas + pdfjs TextLayer),
 * replacing the Wave I `<iframe>` for the one thing an iframe cannot do:
 * expose text a member can select. See lib/pdfjs.js for the measured,
 * not-assumed reason this exists.
 *
 * Virtualized via the EXISTING (previously-unused) `@tanstack/react-virtual`
 * dependency (checkpoint decision 64) -- only pages near the viewport get a
 * canvas + text layer; everything else is a placeholder reserving scroll
 * space. Selection is captured via the native `Selection`/`Range` APIs over
 * the real text layer; saved excerpts are rendered as absolutely-positioned
 * highlight rects computed from `Range.getClientRects()` -- never a second
 * copy of the page's text, never a DOM mutation of the text layer itself.
 */
const PdfDocumentViewer = forwardRef(function PdfDocumentViewer(
  { href, excerpts = [], onSaveExcerpt, emphasizeExcerptId, initialPage,
    documentId = null }, ref,
) {
  const scrollRef = useRef(null)
  const [pdf, setPdf] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [baseViewport, setBaseViewport] = useState(null) // {width, height} at scale=1 for page 1
  const [error, setError] = useState(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [selectionPopover, setSelectionPopover] = useState(null) // {x, y, text, pageNumber}
  const [emphasized, setEmphasized] = useState(null) // excerptId currently pulsing

  // pageNumber -> { fullText, map } from `_buildPageText` -- populated as
  // each page's text layer finishes rendering. Needed both to capture a
  // selection's offsets + quote-context and to re-locate a saved excerpt's
  // highlight rects, which is why ONE builder produces both.
  const pageTextRef = useRef(new Map())
  const pageContainerRef = useRef(new Map()) // pageNumber -> outer page div

  useEffect(() => {
    let cancelled = false
    if (!href) return undefined
    setError(null)
    loadPdfDocument(href).then(async (doc) => {
      if (cancelled) return
      setPdf(doc)
      setPageCount(doc.numPages)
      const page1 = await doc.getPage(1)
      const vp = page1.getViewport({ scale: 1 })
      if (!cancelled) setBaseViewport({ width: vp.width, height: vp.height })
    }).catch((e) => {
      if (!cancelled) setError(e?.message || 'Could not load this document')
    })
    return () => { cancelled = true }
  }, [href])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return undefined
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width
      if (w) setContainerWidth(Math.max(280, w - 32))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Fit-to-width, but CAPPED. Found live in the browser: the preview Sheet
  // is near-full-viewport, so a letter page (612pt) fitted to an 1883px
  // container rendered at 3.02x -- 72px body text, one paragraph per screen,
  // and the right edge clipped. A page has a natural reading size and more
  // pixels than that is magnification, not fidelity. MAX_PAGE_WIDTH is the
  // ceiling; narrow containers still fit-to-width as before, and the page
  // stays centred (.page is a centring flex row) once it stops growing.
  const renderWidth = Math.min(containerWidth, MAX_PAGE_WIDTH)
  const scale = baseViewport ? renderWidth / baseViewport.width : 1
  const pageHeight = baseViewport ? baseViewport.height * scale : 800

  const virtualizer = useVirtualizer({
    count: pageCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => pageHeight + PAGE_GAP,
    overscan: OVERSCAN,
  })

  // Re-measure once the real page height is known (avoids every page
  // starting at a wrong estimate before the PDF has loaded).
  useEffect(() => { virtualizer.measure() }, [pageHeight, virtualizer])

  useEffect(() => {
    if (!initialPage || !pdf || !pageCount) return
    const idx = Math.min(Math.max(1, initialPage), pageCount) - 1
    virtualizer.scrollToIndex(idx, { align: 'start' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageCount])

  const scrollToPage = useCallback((pageNumber) => {
    if (!pageCount) return
    const idx = Math.min(Math.max(1, pageNumber), pageCount) - 1
    virtualizer.scrollToIndex(idx, { align: 'start' })
  }, [virtualizer, pageCount])

  const emphasizeAndScroll = useCallback((excerptId) => {
    const ex = excerpts.find((e) => e.id === excerptId)
    if (!ex) return
    scrollToPage(ex.pageNumber)
    setEmphasized(excerptId)
    // The container for that page may not exist yet the instant we asked
    // to scroll to it (virtualization mounts it after the scroll settles).
    // A short retry window covers the mount without a hard dependency on
    // virtualizer internals.
    let tries = 0
    const tryScrollIntoView = () => {
      const container = pageContainerRef.current.get(ex.pageNumber)
      const rectEl = container?.querySelector(`[data-excerpt-id="${excerptId}"]`)
      if (rectEl) {
        rectEl.scrollIntoView({ block: 'center', behavior: 'smooth' })
      } else if (tries < 20) {
        tries += 1
        setTimeout(tryScrollIntoView, 100)
      }
    }
    setTimeout(tryScrollIntoView, 150)
    setTimeout(() => setEmphasized((cur) => (cur === excerptId ? null : cur)), EMPHASIS_MS)
  }, [excerpts, scrollToPage])

  useImperativeHandle(ref, () => ({ scrollToPage, emphasizeExcerpt: emphasizeAndScroll }), [scrollToPage, emphasizeAndScroll])

  useEffect(() => {
    if (emphasizeExcerptId) emphasizeAndScroll(emphasizeExcerptId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emphasizeExcerptId])

  // ── Selection capture ─────────────────────────────────────────────────
  useEffect(() => {
    const onSelectionChange = () => {
      const sel = window.getSelection()
      if (!sel || sel.isCollapsed || sel.rangeCount === 0) { setSelectionPopover(null); return }
      const text = sel.toString().trim()
      if (!text) { setSelectionPopover(null); return }
      const range = sel.getRangeAt(0)
      const container = range.commonAncestorContainer
      const el = container.nodeType === 1 ? container : container.parentElement
      const pageEl = el?.closest?.('[data-pdf-page-number]')
      if (!pageEl) { setSelectionPopover(null); return }
      const pageNumber = Number(pageEl.getAttribute('data-pdf-page-number'))
      const rects = range.getClientRects()
      const lastRect = rects[rects.length - 1] || range.getBoundingClientRect()
      const scrollBox = scrollRef.current?.getBoundingClientRect()
      if (!scrollBox) return
      // Resolve the selection's offsets HERE, against the live Range, while
      // it still exists -- a Range is invalidated by the click that saves,
      // and re-deriving offsets later by searching for the selected string
      // is exactly the lossy step `_buildPageText` documents.
      const map = pageTextRef.current.get(pageNumber)?.map
      const charStart = map ? _offsetOfPoint(map, range.startContainer, range.startOffset) : null
      const charEnd = map ? _offsetOfPoint(map, range.endContainer, range.endOffset) : null
      setSelectionPopover({
        x: lastRect.right - scrollBox.left,
        y: lastRect.bottom - scrollBox.top,
        text,
        pageNumber,
        charStart,
        charEnd,
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const handleSaveExcerpt = useCallback(() => {
    if (!selectionPopover || !onSaveExcerpt) return
    const { text, pageNumber } = selectionPopover
    const pageText = pageTextRef.current.get(pageNumber)?.fullText || ''
    let charStart = selectionPopover.charStart
    let charEnd = selectionPopover.charEnd
    if (charStart == null || charEnd == null || charEnd <= charStart) {
      // The Range boundaries didn't resolve (a selection anchored outside
      // this page's text nodes). Fall back to a search, which is exact now
      // that both strings come from the same builder.
      const idx = pageText.indexOf(text)
      charStart = idx >= 0 ? idx : null
      charEnd = idx >= 0 ? idx + text.length : null
    }
    let quotePrefix = null
    let quoteSuffix = null
    let capturedText = text
    if (charStart != null && charEnd != null) {
      // The popover shows the TRIMMED selection; keep the stored offsets on
      // the same characters so captured text, offsets and context can never
      // describe three slightly different passages.
      while (charStart < charEnd && /\s/.test(pageText[charStart])) charStart += 1
      while (charEnd > charStart && /\s/.test(pageText[charEnd - 1])) charEnd -= 1
      capturedText = pageText.slice(charStart, charEnd) || text
      quotePrefix = pageText.slice(Math.max(0, charStart - QUOTE_CONTEXT_CHARS), charStart) || null
      quoteSuffix = pageText.slice(charEnd, charEnd + QUOTE_CONTEXT_CHARS) || null
    }
    onSaveExcerpt({ pageNumber, capturedText, quotePrefix, quoteSuffix, charStart, charEnd })
    window.getSelection()?.removeAllRanges()
    setSelectionPopover(null)
  }, [selectionPopover, onSaveExcerpt])

  // ⛔⛔ WAVE P4 — WHICH PAGES HAVE NOTHING TO SELECT. A scanned page renders a
  // canvas and an EMPTY text layer, so the member can read a figure and cannot
  // quote it. This is measured from the page pdf.js actually rendered, not
  // guessed from a status field: it is true exactly when the browser has no
  // text, which is exactly when the transcript is worth offering.
  const [pagesWithoutText, setPagesWithoutText] = useState(() => new Set())
  const notePageText = useCallback((pageNumber, info) => {
    pageTextRef.current.set(pageNumber, info)
    const empty = !(info?.fullText || '').trim()
    setPagesWithoutText((prev) => {
      if (prev.has(pageNumber) === empty) return prev
      const next = new Set(prev)
      if (empty) next.add(pageNumber); else next.delete(pageNumber)
      return next
    })
  }, [])
  // ⛔ The transcript's own text goes to the SAME map so selections resolve —
  // but it must never clear the "this page has no text layer" fact, or the
  // panel would vanish the moment it succeeded.
  const noteTranscriptText = useCallback((pageNumber, info) => {
    pageTextRef.current.set(pageNumber, info)
  }, [])

  const visible = virtualizer.getVirtualItems()
  const currentPage = visible.length ? visible[0].index + 1 : null

  const excerptsByPage = useMemo(() => {
    const m = new Map()
    for (const ex of excerpts) {
      if (!m.has(ex.pageNumber)) m.set(ex.pageNumber, [])
      m.get(ex.pageNumber).push(ex)
    }
    return m
  }, [excerpts])

  if (error) {
    return <div className={styles.errorState}>{error}</div>
  }

  return (
    <div className={styles.scroll} ref={scrollRef}>
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {pdf && baseViewport && virtualizer.getVirtualItems().map((vi) => (
          <PdfPage
            key={vi.key}
            pdf={pdf}
            pageNumber={vi.index + 1}
            scale={scale}
            top={vi.start}
            excerptsOnPage={excerptsByPage.get(vi.index + 1) || []}
            emphasized={emphasized}
            onTextReady={notePageText}
            registerContainer={(pageNumber, el) => { pageContainerRef.current.set(pageNumber, el) }}
          />
        ))}
      </div>
      {/* Wave P4 §11/§12 — the derived-text selection aid, for the page on
          screen, and only when that page has no text of its own. */}
      {documentId && currentPage && pagesWithoutText.has(currentPage) && (
        <ScannedTextPanel
          documentId={documentId}
          pageNumber={currentPage}
          onTextReady={noteTranscriptText}
          buildPageText={_buildPageText}
        />
      )}
      {selectionPopover && (
        <button
          type="button"
          className={styles.selectionPopover}
          style={{ left: selectionPopover.x, top: selectionPopover.y }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={handleSaveExcerpt}
        >
          Save excerpt
        </button>
      )}
    </div>
  )
})

export default PdfDocumentViewer

/** One page: canvas render + real text layer + highlight-rect overlay for
 * any excerpts already saved on this page. Text-layer render is native
 * pdfjs-dist recipe (TextLayer class + its own `.textLayer` CSS). */
function PdfPage({ pdf, pageNumber, scale, top, excerptsOnPage, emphasized, onTextReady, registerContainer }) {
  const canvasRef = useRef(null)
  const textLayerRef = useRef(null)
  const [highlightRects, setHighlightRects] = useState([]) // [{excerptId, rects: [{x,y,w,h}]}]
  const outerRef = useRef(null)

  useEffect(() => {
    if (outerRef.current) registerContainer(pageNumber, outerRef.current)
  }, [pageNumber, registerContainer])

  useEffect(() => {
    let cancelled = false
    let renderTask = null
    // Drop the previous pass's rects BEFORE re-rendering. They are absolute
    // pixel offsets computed at the OLD scale, and re-render is async (page
    // render + text layer + re-location), so leaving them up paints
    // highlights over the wrong lines for the whole await -- caught live
    // after a viewport resize: two gold bars sat a paragraph above the
    // passage they were marking. A highlight that briefly ISN'T there is
    // honest; one that points at the wrong sentence is not.
    setHighlightRects([])
    pdf.getPage(pageNumber).then(async (page) => {
      if (cancelled) return
      const viewport = page.getViewport({ scale })
      const canvas = canvasRef.current
      if (!canvas) return
      const outputScale = window.devicePixelRatio || 1
      canvas.width = Math.floor(viewport.width * outputScale)
      canvas.height = Math.floor(viewport.height * outputScale)
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const ctx = canvas.getContext('2d')
      renderTask = page.render({
        canvasContext: ctx,
        viewport,
        transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
      })
      await renderTask.promise
      if (cancelled) return

      const textContent = await page.getTextContent()
      if (cancelled) return
      const container = textLayerRef.current
      if (!container) return
      container.innerHTML = ''
      // pdfjs's own TextLayer sizes/scales the container via CSS custom
      // properties normally set by its higher-level PDFPageView machinery,
      // which this viewer doesn't use. `--total-scale-factor` is what makes
      // each span's computed font-size (`--font-height` × that factor,
      // pdfjs's own per-span formula) match the canvas glyphs it sits over.
      //
      // The other two matter for a reason found by reading pdf.mjs rather
      // than by watching it fail: the TextLayer CONSTRUCTOR calls
      // setLayerDimensions, which overwrites style.width/height with
      // `round(down, var(--total-scale-factor) * <pt>px, var(--scale-round-x))`
      // -- and pdfjs declares no fallback for --scale-round-*, so with them
      // unset the whole expression is invalid and both dimensions are
      // dropped. (It looked fine only because .textLayerRoot's `inset: 0`
      // was silently covering for it, and any width/height set HERE, before
      // the constructor, is clobbered a line later.) pdf_viewer.css sets
      // both to 1px on `.pdfViewer .page`; this is that same declaration,
      // scoped to the one element that needs it.
      container.style.setProperty('--total-scale-factor', String(scale))
      container.style.setProperty('--scale-round-x', '1px')
      container.style.setProperty('--scale-round-y', '1px')
      const layer = new pdfjsLib.TextLayer({ textContentSource: textContent, container, viewport })
      await layer.render()
      if (cancelled) return

      const { fullText, map } = _buildPageText(container)
      onTextReady(pageNumber, { fullText, map })

      // Compute highlight rects for any excerpt already saved on this page,
      // by re-locating the captured text (via quote context, falling back
      // to a bare indexOf) inside the fresh full-page text, then mapping
      // that char range to real DOM Ranges over the text-layer spans.
      const rectsByExcerpt = []
      for (const ex of excerptsOnPage) {
        const range = _locateTextRange(fullText, ex, map)
        if (!range) continue
        // A range crossing a line break yields a zero-WIDTH rect for the
        // <br> boundary itself (measured: 0x19 at the page's left margin,
        // nowhere near the text). Drawing it puts an invisible element in
        // the highlight layer at a misleading position; drop anything with
        // no area.
        const containerBox = container.getBoundingClientRect()
        const rects = Array.from(range.getClientRects())
          .filter((r) => r.width > 0 && r.height > 0)
          .map((r) => ({
            x: r.left - containerBox.left, y: r.top - containerBox.top, w: r.width, h: r.height,
          }))
        if (!rects.length) continue
        rectsByExcerpt.push({ excerptId: ex.id, rects })
      }
      setHighlightRects(rectsByExcerpt)
    }).catch(() => {})
    return () => {
      cancelled = true
      try { renderTask?.cancel() } catch { /* noop */ }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pdf, pageNumber, scale, excerptsOnPage.length])

  return (
    <div
      ref={outerRef}
      data-pdf-page-number={pageNumber}
      className={styles.page}
      style={{ position: 'absolute', top, left: 0, right: 0 }}
    >
      <div className={styles.pageInner}>
        <canvas ref={canvasRef} className={styles.canvas} />
        <div ref={textLayerRef} className={styles.textLayerRoot + ' textLayer'} />
        <div className={styles.highlightLayer} aria-hidden="true">
          {highlightRects.map(({ excerptId, rects }) => (
            <div key={excerptId} data-excerpt-id={excerptId}>
              {rects.map((r, i) => (
                <div
                  // eslint-disable-next-line react/no-array-index-key
                  key={i}
                  className={`${styles.highlightRect} ${emphasized === excerptId ? styles.highlightRectEmphasized : ''}`}
                  style={{ left: r.x, top: r.y, width: r.w, height: r.h }}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** Builds a rendered page's canonical text AND the text-node offset map that
 * indexes into it. THE ONE PLACE either is derived, because capture and
 * re-location must agree character-for-character or excerpts silently lose
 * their anchors.
 *
 * ⛔ Found live in the browser: this used to be
 * `textContent.items.map(it => it.str).join('')` on one side and the
 * browser's own `Selection.toString()` on the other, and those are NOT the
 * same string. pdfjs renders one <span> per item separated by
 * `<br role="presentation">`, so a selection crossing a line break comes
 * back with a "\n" the item-join never had -- and a wrapped line's items
 * carry no trailing space, so the join reads "...meaning ofthe Private...".
 * The mismatch made `fullText.indexOf(selection)` return -1 for EVERY
 * selection longer than one rendered line, which is nearly every real
 * excerpt: quote_prefix, quote_suffix, char_start and char_end all landed
 * null (the entire W3C text-quote anchor Wave J is built on), and
 * `_locateTextRange` could then never redraw the highlight. Both failures
 * were SILENT -- the excerpt saved, the card appeared, and only the page
 * highlight and the durability guarantee were missing.
 *
 * Walking the real DOM in document order reproduces exactly what the
 * browser hands back from a selection, and needs no assumption about how
 * pdfjs chooses to emit EOLs. */
export function _buildPageText(container) {
  const parts = []
  const map = [] // [{ node, start, len }] -- text nodes, in document order
  let offset = 0
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
  )
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node.nodeValue || ''
      if (!t) continue
      map.push({ node, start: offset, len: t.length })
      parts.push(t)
      offset += t.length
    } else if (node.nodeName === 'BR') {
      parts.push('\n')
      offset += 1
    }
  }
  return { fullText: parts.join(''), map }
}

/** Converts a DOM Range boundary (node + offset) to an offset in the
 * `fullText` `_buildPageText` produced -- the exact inverse of
 * `_locateTextRange`'s mapping. Capturing offsets from the live Range is
 * what makes them EXACT: the alternative, searching for the selected string,
 * is both ambiguous on a repeated phrase and defeated by any whitespace the
 * browser adds. Returns null when the boundary isn't inside this page. */
export function _offsetOfPoint(map, node, offset) {
  if (!node) return null
  if (node.nodeType === Node.TEXT_NODE) {
    const entry = map.find((m) => m.node === node)
    return entry ? entry.start + Math.min(offset, entry.len) : null
  }
  // An element boundary: `offset` indexes its child nodes.
  const child = node.childNodes?.[offset]
  if (child) {
    const at = map.find((m) => m.node === child || child.contains?.(m.node))
    if (at) return at.start
  }
  const inside = map.filter((m) => node.contains?.(m.node))
  if (inside.length) {
    const last = inside[inside.length - 1]
    return last.start + last.len
  }
  return null
}

/** Locates a saved excerpt's text inside a freshly-rendered page's text and
 * returns a real DOM Range spanning it -- or null if it can no longer be
 * found (a page re-extraction changed the text enough that even the quote-
 * context window doesn't match; the excerpt's own captured_text remains the
 * source of truth regardless, per checkpoint decision 14 -- this function
 * only affects whether a VISUAL highlight can be drawn, never the excerpt's
 * own stored content). Quote-context first (robust to drift elsewhere on
 * the page), a bare indexOf of the captured text as fallback.
 *
 * `map` is `_buildPageText`'s text-node map over the SAME fullText. */
export function _locateTextRange(fullText, excerpt, map) {
  const needle = excerpt.capturedText || ''
  if (!needle) return null
  let start = -1
  if (excerpt.quotePrefix || excerpt.quoteSuffix) {
    const withContext = `${excerpt.quotePrefix || ''}${needle}${excerpt.quoteSuffix || ''}`
    const ctxIdx = fullText.indexOf(withContext)
    if (ctxIdx >= 0) start = ctxIdx + (excerpt.quotePrefix || '').length
  }
  if (start < 0) start = fullText.indexOf(needle)
  if (start < 0) return null
  const end = start + needle.length

  let startNode = null; let startOffset = 0
  let endNode = null; let endOffset = 0
  for (const entry of map) {
    const entryEnd = entry.start + entry.len
    if (!startNode && start >= entry.start && start < entryEnd) {
      startNode = entry.node
      startOffset = start - entry.start
    }
    if (!endNode && end > entry.start && end <= entryEnd) {
      endNode = entry.node
      endOffset = end - entry.start
    }
    if (startNode && endNode) break
  }
  if (!startNode || !endNode) return null
  try {
    const range = document.createRange()
    range.setStart(startNode, Math.max(0, startOffset))
    range.setEnd(endNode, Math.max(0, endOffset))
    return range
  } catch {
    return null
  }
}
