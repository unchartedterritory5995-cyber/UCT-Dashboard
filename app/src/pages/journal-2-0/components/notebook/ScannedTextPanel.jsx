import { useEffect, useRef, useState } from 'react'
import UIcon from '../../../../components/ui/UIcon'
import { SCANNED_TEXT_LABEL, SCANNED_TEXT_HINT, TEXT_ORIGIN_OCR }
  from '../../lib/documentProvenance'
import styles from './ScannedTextPanel.module.css'

/**
 * Wave P4 §11/§12/§13 — the text UCT read from a scanned page, offered so the
 * member can SELECT a passage they can also see with their own eyes.
 *
 * ⛔⛔ IT IS A SELECTION AID, NOT THE DOCUMENT. The scanned page above it stays
 * the source of truth; this is derived text, it says so in its own header, and
 * nothing here may be labelled "the document" or "the source text layer". A
 * member checking an exact figure checks the page.
 *
 * ⛔ AND IT IS NOT A SECOND VIEWER (§12). It lives inside the existing document
 * viewer, over the page it transcribes. Search, Ask and evidence all still
 * navigate to the ORIGINAL document and page; this is a tool inside that
 * destination, never a destination of its own.
 *
 * ⚰️ WHY IT EXISTS AT ALL. A scanned page has no text layer, so the browser has
 * nothing to select — the member could read a figure on screen and had no way
 * to quote it. Faking a text layer into the PDF was rejected: it would make the
 * derived text indistinguishable from the page's own, which is the one
 * distinction this whole wave is built to preserve.
 *
 * ⛔ ONE PAGE AT A TIME (§40). A 500-page filing must never ship its whole
 * transcript to a browser looking at one page.
 *
 * ⭐ THE SELECTION PATH IS THE EXISTING ONE. This renders inside an element
 * carrying `data-pdf-page-number`, which is what the viewer's own
 * `selectionchange` handler looks for, and it hands the viewer the same
 * text+offset map a rendered text layer would. So "Save excerpt" works here
 * without a second capture path, and the offsets it stores are offsets into
 * the canonical page text the server will check the quote against.
 */
export default function ScannedTextPanel({
  documentId, pageNumber, onTextReady, buildPageText,
}) {
  const [open, setOpen] = useState(false)
  // ⭐ `empty` is deliberately absent: `text_origin` becomes 'ocr' only on an
  // ACCEPTED write, so a page this panel renders for always has text. A page
  // whose OCR the gate rejected keeps `native` and gets no panel at all —
  // which is exactly §45's "must not offer a transcript as valid source text",
  // and the attachment status line is where the member is told why.
  const [state, setState] = useState('idle')   // idle | loading | ready | error
  const [text, setText] = useState('')
  const [origin, setOrigin] = useState(null)
  const bodyRef = useRef(null)

  // ⛔⛔ THE SERVER DECIDES WHETHER THIS PAGE HAS A TRANSCRIPT WORTH OFFERING.
  // An earlier version inferred it in the browser from an empty pdf.js text
  // layer, and that signal proved intermittent in the live product — the panel
  // appeared on one load and not the next. `text_origin` is a stored fact, so
  // it cannot race. One small request per page the member actually looks at
  // (§40), and NOTHING renders for a native page.
  useEffect(() => {
    let cancelled = false
    setOpen(false); setState('idle'); setText(''); setOrigin(null)
    if (!documentId || !pageNumber) return undefined
    setState('loading')
    fetch(`/api/j2/notes/documents/${documentId}/pages/${pageNumber}/text`,
          { credentials: 'include' })
      .then(async (r) => {
        if (cancelled) return
        if (!r.ok) { setState('error'); return }
        const d = await r.json()
        if (cancelled) return
        setOrigin(d.textOrigin || null)
        setText(d.text || '')
        // ⛔ "The page exists" and "we read something from it" are different
        // facts. An unreadable scan gets a sentence, never an empty box that
        // looks like a transcript still loading.
        setState(d.available ? 'ready' : 'error')
      })
      .catch(() => { if (!cancelled) setState('error') })
    return () => { cancelled = true }
  }, [documentId, pageNumber])

  // Register this text with the viewer once it is on screen, so a selection
  // inside it resolves to real offsets in the canonical page text.
  //
  // ⛔ `open` IS A DEPENDENCY. The body only exists while the panel is open, so
  // without it the effect last ran against a null ref and the viewer was never
  // handed the transcript — a selection would then fall back to searching the
  // EMPTY page text layer and store no offsets at all. Caught by the rail that
  // asserts the hand-off actually happens, not by anything visible on screen.
  useEffect(() => {
    if (!open || state !== 'ready' || !bodyRef.current || !onTextReady) return
    onTextReady(pageNumber, buildPageText(bodyRef.current))
  }, [open, state, text, pageNumber, onTextReady, buildPageText])

  // ⛔ A NATIVE PAGE GETS NOTHING. Its text is selectable on the page itself,
  // and a "Scanned text" affordance there would be a false claim about where
  // the words came from.
  if (!documentId || !pageNumber) return null
  if (state === 'loading' || state === 'error') return null
  if (origin !== TEXT_ORIGIN_OCR) return null

  return (
    <div className={styles.wrap} data-scanned-text-panel={pageNumber}>
      <button
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <UIcon name="document" size={12} gold={false} aria-hidden="true" />
        {SCANNED_TEXT_LABEL}
        <span className={styles.pageTag}>page {pageNumber}</span>
      </button>

      {open && (
        <div className={styles.panel}>
          {/* ⛔ §13/§39 — the disclosure is TEXT, read by a screen reader, and
              it says what to do rather than what happened. */}
          <p className={styles.note}>{SCANNED_TEXT_HINT}</p>
          {state === 'ready' && (
            <div
              ref={bodyRef}
              className={styles.body}
              /* The viewer's selection handler finds its page through this
                 attribute — the same one a rendered page carries. */
              data-pdf-page-number={pageNumber}
              aria-label={`Scanned text from page ${pageNumber}`}
              role="region"
              tabIndex={0}
            >
              {text}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
