import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { fetchDocumentRow, fetchPageText } from './documentKind'
import styles from './TextPagesViewer.module.css'

/**
 * Wave 7 lane G (G4) — a .docx attachment that became a searchable document,
 * read one page at a time.
 *
 * ⛔ A DOCX HAS NO PAGES OF ITS OWN. Word paginates at print time; what UCT
 * stores are READING pages of about 3,000 characters, cut between paragraphs.
 * So this viewer is honest about being the document's TEXT (no formatting, no
 * layout) and points at Open/Download — in the sheet's bar above — for the
 * original.
 *
 * ⛔ ONE PAGE PER REQUEST. The page a search hit or an Ask citation names is
 * the one opened; a long document never ships its whole text to the browser
 * to show one page (the same rule the scanned-text panel follows).
 */
function clampPage(p, total) {
  const n = Math.floor(Number(p)) || 1
  if (!total) return Math.max(1, n)
  return Math.min(Math.max(1, n), total)
}

const TextPagesViewer = forwardRef(function TextPagesViewer(
  { href, documentId = null, initialPage = 1 }, ref,
) {
  // loading | reading | ready | empty | failed | error — about the DOCUMENT
  const [docState, setDocState] = useState('loading')
  const [row, setRow] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState(() => clampPage(initialPage, 0))
  // loading | ready | empty | error — about the PAGE on screen
  const [pageState, setPageState] = useState('loading')
  const [text, setText] = useState('')

  const total = row?.pagesTotal || 0

  // A new target from the mount (a second search hit while the sheet is open)
  // moves the page; so does Ask's citation navigation through the handle.
  useEffect(() => { setPage(clampPage(initialPage, total)) }, [initialPage]) // eslint-disable-line react-hooks/exhaustive-deps
  const goTo = useCallback((p) => setPage(clampPage(p, total)), [total])
  useImperativeHandle(ref, () => ({ scrollToPage: goTo }), [goTo])

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    setDocState('loading')
    ;(async () => {
      try {
        const found = await fetchDocumentRow({ href, documentId, signal: ctrl.signal })
        if (cancelled) return
        if (!found) { setDocState('error'); return }
        setRow(found)
        if (found.status === 'pending') setDocState('reading')
        else if (found.status === 'processing_failed') setDocState('failed')
        else if (!found.pagesWithText) setDocState('empty')
        else setDocState('ready')
      } catch (e) {
        if (!cancelled && e?.name !== 'AbortError') setDocState('error')
      }
    })()
    return () => { cancelled = true; ctrl.abort() }
  }, [href, documentId, attempt])

  // Once the page count is known, a target past the end lands on the last page.
  useEffect(() => { if (total) setPage((p) => clampPage(p, total)) }, [total])

  useEffect(() => {
    if (docState !== 'ready' || !row?.id) return undefined
    const ctrl = new AbortController()
    let cancelled = false
    setPageState('loading')
    setText('')
    ;(async () => {
      try {
        const d = await fetchPageText(row.id, page, { signal: ctrl.signal })
        if (cancelled) return
        if (d && d.available) { setText(d.text || ''); setPageState('ready') } else setPageState('empty')
      } catch (e) {
        if (!cancelled && e?.name !== 'AbortError') setPageState('error')
      }
    })()
    return () => { cancelled = true; ctrl.abort() }
  }, [docState, row?.id, page])

  const retry = (
    <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
      Check again
    </button>
  )

  if (docState !== 'ready') {
    return (
      <div className={styles.wrap} data-testid="text-pages-viewer">
        <div className={styles.center}>
          {docState === 'loading' && (
            <p className={styles.status} role="status">Loading this document’s text…</p>
          )}
          {docState === 'reading' && (
            <>
              <p className={styles.status} role="status">
                Reading this document. This can take a moment.
              </p>
              {retry}
            </>
          )}
          {docState === 'empty' && (
            <p className={styles.status} role="status">No text could be read from this document.</p>
          )}
          {docState === 'failed' && (
            <p className={styles.status} role="status">
              This document couldn’t be read, so its text isn’t searchable.
            </p>
          )}
          {docState === 'error' && (
            <>
              <p className={styles.status} role="status">Couldn’t load this document’s text.</p>
              {retry}
            </>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className={styles.wrap} data-testid="text-pages-viewer">
      <div className={styles.pager}>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => goTo(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
        >
          ‹ Prev
        </button>
        <span className={styles.pageLabel} aria-live="polite">
          Page {page} of {total}
        </span>
        <button
          type="button"
          className={styles.pageBtn}
          onClick={() => goTo(page + 1)}
          disabled={page >= total}
          aria-label="Next page"
        >
          Next ›
        </button>
      </div>
      <p className={styles.note}>
        The document’s text, without its formatting. Open or download it to see the original.
      </p>
      <section className={styles.page} aria-label={`Page ${page} of ${total}`}>
        {pageState === 'loading' && (
          <p className={styles.status} role="status">Loading page {page}…</p>
        )}
        {pageState === 'empty' && (
          <p className={styles.status} role="status">This page has no text.</p>
        )}
        {pageState === 'error' && (
          <p className={styles.status} role="status">Couldn’t load page {page}.</p>
        )}
        {pageState === 'ready' && (
          <div className={styles.text} data-testid="text-page-body" tabIndex={0}>{text}</div>
        )}
      </section>
    </div>
  )
})

export default TextPagesViewer
