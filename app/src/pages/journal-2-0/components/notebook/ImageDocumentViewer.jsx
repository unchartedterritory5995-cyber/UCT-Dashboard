import { forwardRef, useEffect, useImperativeHandle, useState } from 'react'
import { fetchDocumentRow, fetchPageText } from './documentKind'
import styles from './ImageDocumentViewer.module.css'

/**
 * Wave 7 lane G (G4) — an image attachment that became a searchable document.
 *
 * The image itself is the source of truth and is shown as-is; the text UCT read
 * from it sits in a pane beside it (desktop) or below it (touch tier), so a
 * member checking a figure can look at both at once.
 *
 * ⛔ THE TEXT IS DERIVED, AND SAYS SO. It was read from the picture by OCR, so
 * the pane is labelled as read text with the one actionable hint — check exact
 * figures against the image — and never presented as the image's own content.
 *
 * ⛔ EVERY STATE IS A SENTENCE. "Still reading", "no searchable text", "OCR
 * isn't available here" and "couldn't load" are different facts, and a blank
 * pane would make all four look like the same broken panel.
 */
const ImageDocumentViewer = forwardRef(function ImageDocumentViewer(
  { href, documentId = null, name = null }, ref,
) {
  // loading | reading | unavailable | ready | empty | failed | error
  const [state, setState] = useState('loading')
  const [text, setText] = useState('')
  const [attempt, setAttempt] = useState(0)

  // One page, nowhere to scroll to — but AskPanel navigates every viewer the
  // same way, so the handle exists and does nothing rather than being absent.
  useImperativeHandle(ref, () => ({ scrollToPage: () => {} }), [])

  useEffect(() => {
    const ctrl = new AbortController()
    let cancelled = false
    setState('loading')
    setText('')
    ;(async () => {
      try {
        const row = await fetchDocumentRow({ href, documentId, signal: ctrl.signal })
        if (cancelled) return
        if (!row) { setState('error'); return }
        if (row.status === 'pending') {
          setState(row.ocrUnavailable ? 'unavailable' : 'reading')
          return
        }
        if (row.status === 'processing_failed') { setState('failed'); return }
        const page = await fetchPageText(row.id, 1, { signal: ctrl.signal })
        if (cancelled) return
        if (page && page.available) {
          setText(page.text || '')
          setState('ready')
        } else {
          setState('empty')
        }
      } catch (e) {
        if (!cancelled && e?.name !== 'AbortError') setState('error')
      }
    })()
    return () => { cancelled = true; ctrl.abort() }
  }, [href, documentId, attempt])

  const retry = (
    <button type="button" className={styles.retry} onClick={() => setAttempt((n) => n + 1)}>
      Check again
    </button>
  )

  return (
    <div className={styles.wrap} data-testid="image-document-viewer">
      <div className={styles.imagePane}>
        <img className={styles.image} src={href} alt={name && name !== 'Image' ? name : 'Attached image'} />
      </div>
      <section className={styles.textPane} aria-label="Text read from this image">
        <h3 className={styles.heading}>Text read from this image</h3>
        {state === 'loading' && (
          <p className={styles.status} role="status">Loading the text from this image…</p>
        )}
        {state === 'reading' && (
          <div className={styles.statusRow}>
            <p className={styles.status} role="status">
              Reading the text in this image. This can take a moment.
            </p>
            {retry}
          </div>
        )}
        {state === 'unavailable' && (
          <p className={styles.status} role="status">
            Text reading isn’t available right now, so this image isn’t searchable yet.
          </p>
        )}
        {state === 'empty' && (
          // ⛔ NEUTRAL ON PURPOSE (fix round 1, M-9). With no OCR engine wired,
          // an image lands `no_text` without ever being read, and the row
          // carries no "never read" signal -- so this cannot claim an attempt
          // ("could not be read") that may never have happened.
          <p className={styles.status} role="status">This image has no searchable text.</p>
        )}
        {state === 'failed' && (
          <p className={styles.status} role="status">
            This image couldn’t be read, so its text isn’t searchable.
          </p>
        )}
        {state === 'error' && (
          <div className={styles.statusRow}>
            <p className={styles.status} role="status">Couldn’t load the text for this image.</p>
            {retry}
          </div>
        )}
        {state === 'ready' && (
          <>
            <p className={styles.note}>
              Read from the image — check exact figures against the image itself.
            </p>
            <div className={styles.text} data-testid="image-document-text" tabIndex={0}>
              {text}
            </div>
          </>
        )}
      </section>
    </div>
  )
})

export default ImageDocumentViewer
