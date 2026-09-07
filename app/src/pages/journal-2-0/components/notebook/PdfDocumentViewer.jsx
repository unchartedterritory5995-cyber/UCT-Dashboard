import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { pdfjsLib, loadPdfDocument } from '../../lib/pdfjs'
import styles from './PdfDocumentViewer.module.css'

const OVERSCAN = 2
const PAGE_GAP = 12
const QUOTE_CONTEXT_CHARS = 200
const EMPHASIS_MS = 2200

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
  { href, excerpts = [], onSaveExcerpt, emphasizeExcerptId, initialPage }, ref,
) {
  const scrollRef = useRef(null)
  const [pdf, setPdf] = useState(null)
  const [pageCount, setPageCount] = useState(0)
  const [baseViewport, setBaseViewport] = useState(null) // {width, height} at scale=1 for page 1
  const [error, setError] = useState(null)
  const [containerWidth, setContainerWidth] = useState(800)
  const [selectionPopover, setSelectionPopover] = useState(null) // {x, y, text, pageNumber}
  const [emphasized, setEmphasized] = useState(null) // excerptId currently pulsing

  // pageNumber -> { fullText, spans: [{el, start, len}] } -- populated as
  // each page's text layer finishes rendering. Needed both to capture a
  // selection's quote-context and to re-locate a saved excerpt's rects.
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

  const scale = baseViewport ? containerWidth / baseViewport.width : 1
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
      setSelectionPopover({
        x: lastRect.right - scrollBox.left,
        y: lastRect.bottom - scrollBox.top,
        text,
        pageNumber,
      })
    }
    document.addEventListener('selectionchange', onSelectionChange)
    return () => document.removeEventListener('selectionchange', onSelectionChange)
  }, [])

  const handleSaveExcerpt = useCallback(() => {
    if (!selectionPopover || !onSaveExcerpt) return
    const { text, pageNumber } = selectionPopover
    const pageText = pageTextRef.current.get(pageNumber)?.fullText || ''
    const idx = pageText.indexOf(text)
    let quotePrefix = null
    let quoteSuffix = null
    let charStart = null
    let charEnd = null
    if (idx >= 0) {
      charStart = idx
      charEnd = idx + text.length
      quotePrefix = pageText.slice(Math.max(0, idx - QUOTE_CONTEXT_CHARS), idx) || null
      quoteSuffix = pageText.slice(charEnd, charEnd + QUOTE_CONTEXT_CHARS) || null
    }
    onSaveExcerpt({ pageNumber, capturedText: text, quotePrefix, quoteSuffix, charStart, charEnd })
    window.getSelection()?.removeAllRanges()
    setSelectionPopover(null)
  }, [selectionPopover, onSaveExcerpt])

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
            onTextReady={(pageNumber, info) => { pageTextRef.current.set(pageNumber, info) }}
            registerContainer={(pageNumber, el) => { pageContainerRef.current.set(pageNumber, el) }}
          />
        ))}
      </div>
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
      // properties + a `round()` expression normally set by its higher-
      // level PDFPageView machinery, which this viewer doesn't use. Setting
      // both explicitly here (rather than relying on that chain resolving
      // correctly on its own) is what makes each span's computed font-size
      // (`--font-height` × `--total-scale-factor`, pdfjs's own per-span
      // formula) actually match the canvas glyphs it sits over.
      container.style.setProperty('--total-scale-factor', String(scale))
      container.style.width = `${viewport.width}px`
      container.style.height = `${viewport.height}px`
      const layer = new pdfjsLib.TextLayer({ textContentSource: textContent, container, viewport })
      await layer.render()
      if (cancelled) return

      const fullText = textContent.items.map((it) => it.str || '').join('')
      const spans = Array.from(container.querySelectorAll('span'))
      onTextReady(pageNumber, { fullText, spans, textContent })

      // Compute highlight rects for any excerpt already saved on this page,
      // by re-locating the captured text (via quote context, falling back
      // to a bare indexOf) inside the fresh full-page text, then mapping
      // that char range to real DOM Ranges over the text-layer spans.
      const rectsByExcerpt = []
      for (const ex of excerptsOnPage) {
        const range = _locateTextRange(fullText, ex, spans)
        if (!range) continue
        const clientRects = Array.from(range.getClientRects())
        const containerBox = container.getBoundingClientRect()
        rectsByExcerpt.push({
          excerptId: ex.id,
          rects: clientRects.map((r) => ({
            x: r.left - containerBox.left, y: r.top - containerBox.top, w: r.width, h: r.height,
          })),
        })
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

/** Locates a saved excerpt's text inside a freshly-rendered page's text and
 * returns a real DOM Range spanning it -- or null if it can no longer be
 * found (a page re-extraction changed the text enough that even the quote-
 * context window doesn't match; the excerpt's own captured_text remains the
 * source of truth regardless, per checkpoint decision 14 -- this function
 * only affects whether a VISUAL highlight can be drawn, never the excerpt's
 * own stored content). Quote-context first (robust to drift elsewhere on
 * the page), a bare indexOf of the captured text as fallback. */
export function _locateTextRange(fullText, excerpt, spans) {
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

  // Map [start, end) in fullText to (node, offset) pairs over the text
  // layer's own spans, whose concatenated textContent equals fullText in
  // the SAME order pdfjs emitted it (both onTextReady and this function
  // walk `container.querySelectorAll('span')` identically).
  let cursor = 0
  let startNode = null; let startOffset = 0
  let endNode = null; let endOffset = 0
  for (const span of spans) {
    const len = (span.textContent || '').length
    const spanStart = cursor
    const spanEnd = cursor + len
    if (!startNode && start >= spanStart && start < spanEnd) {
      startNode = span.firstChild
      startOffset = start - spanStart
    }
    if (!endNode && end > spanStart && end <= spanEnd) {
      endNode = span.firstChild
      endOffset = end - spanStart
    }
    cursor = spanEnd
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
