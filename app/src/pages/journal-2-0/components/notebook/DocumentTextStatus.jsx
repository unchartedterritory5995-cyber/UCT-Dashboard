import UIcon from '../../../../components/ui/UIcon'
import { scannedPagesNotice } from '../../lib/documentProvenance'
import styles from './DocumentTextStatus.module.css'

/**
 * Wave P1 §23 — why Search and Ask cannot read this attachment yet.
 *
 * ⚰️ THE GAP THIS CLOSES, found by the P0 reconstruction. The document status
 * labels (Processing… / Text couldn't be processed / No extractable text)
 * existed only in `TickerResearchWorkspace`. The note editor fetched
 * `useNoteDocuments` and used it purely to resolve document ids — so a member
 * who uploaded a scan *into a note* saw nothing at all about its state in the
 * very place they uploaded it, and had no way to learn why searching for a
 * phrase they could see on the page returned nothing.
 *
 * ⛔ IT RENDERS NOTHING WHEN THERE IS NOTHING TO SAY. A document whose text is
 * complete is the overwhelmingly common case and gets no chrome — this is a
 * disclosure surface, not a status dashboard (§23: no separate OCR dashboard).
 *
 * ⛔ MEMBER LANGUAGE, NEVER ENGINE LANGUAGE (§24). "Reading scanned text…",
 * not "running inference". The engine, its version and its timings are
 * internal provenance and stay in the job table.
 *
 * ⛔ AND IT COUNTS PAGES, NOT JOBS (§15/§32). "2 of 3 pages" comes from pages
 * that actually hold text. A job reporting complete over an empty page must
 * not be able to say the document is readable — which is exactly the
 * `[492, 0, 781] -> ready` case P0 measured.
 */

/** The one sentence for one document, or null when it needs no explanation. */
export function documentTextNotice(doc) {
  if (!doc) return null
  const total = doc.pagesTotal || 0
  const withText = doc.pagesWithText || 0
  const awaiting = doc.pagesAwaitingOcr || 0
  const name = doc.name || 'This file'

  if (doc.status === 'processing_failed') {
    // Status alone is enough for this one, and it predates the page fields.
    return { tone: 'error', icon: 'warning', name,
             text: "couldn't be processed, so its text isn't searchable." }
  }

  // ⛔⛔ ABSENCE OF DATA IS NOT EVIDENCE OF A SCAN. Caught by the existing
  // editor suite the moment this component shipped: a payload with no page
  // counts — an older cached bundle mid-deploy, a stubbed fixture, a partial
  // response — fell straight through to "looks like a scan", and claimed a
  // perfectly readable document was unreadable. If the server has not told us
  // how many pages there are, this component has nothing to say.
  if (!Number.isFinite(doc.pagesTotal)) return null

  if (doc.status === 'pending' && total === 0) {
    return { tone: 'busy', icon: 'clock', name, text: 'is still being read…' }
  }
  if (awaiting > 0) {
    // ⛔⛔ WAVE P2 §19: "READING…" MUST NOT BE FOREVER. Pages are claimed only
    // while an engine exists, but capability can vanish afterwards — the flag
    // turned off, a rebuild without the binary — and the claim outlives it.
    // A spinner that can never resolve is a worse lie than "we can't read
    // this", because the member keeps waiting for it.
    if (doc.ocrUnavailable) {
      return {
        tone: 'muted', icon: 'document', name,
        text: withText > 0
          ? `— text available for ${withText} of ${total} pages. `
            + 'The scanned pages have not been read, so Search and Ask cannot use them.'
          : 'looks like a scan — its text has not been read, so Search and Ask cannot use it.',
      }
    }
    // ⛔ Say what is already usable. "Reading…" alone reads as "nothing works
    // yet", which is false the moment one page has landed.
    return {
      tone: 'busy', icon: 'clock', name,
      text: withText > 0
        ? `— reading scanned text… ${withText} of ${total} pages ready so far.`
        : '— reading scanned text…',
    }
  }
  if (doc.textComplete) {
    // ⛔ WAVE P2 §21/§22: A COMPLETE DOCUMENT STILL OWES ONE DISCLOSURE IF ITS
    // WORDS WERE READ OFF AN IMAGE. The member is about to quote a figure from
    // text UCT derived, and the scanned page — not this text — is the source of
    // truth for it. Native documents keep their silence.
    const scanned = scannedPagesNotice(doc)
    return scanned ? { tone: 'muted', icon: 'document', name, text: `— ${scanned}` } : null
  }
  if (withText === 0) {
    // A captured web source (`web:` passage, `x:` post) is not a file, so it cannot be a scan. An
    // imported post that left X has no page row at all (tweet_capture_sync.remove_post) and its
    // card already says so; "looks like a scan" would be a false statement about it.
    if (doc.sourceKind === 'web') return null
    return { tone: 'muted', icon: 'document', name,
             text: 'looks like a scan — no readable text yet, so Search and Ask cannot use it.' }
  }
  const short = total - withText
  return {
    tone: 'warn', icon: 'warning', name,
    text: `— text available for ${withText} of ${total} pages. `
      + `${short} page${short === 1 ? '' : 's'} could not be read.`,
  }
}

/** `/inline/<file>` -- the part of an image's URL that names it, whatever prefix or query rides
 *  along. Images are always saved under `/inline/` (document_extraction.maybe_create_document). */
const inlineKey = (url) => {
  const m = /\/inline\/([^?#]+)/.exec(String(url || ''))
  return m ? m[1] : null
}
export const isImageDocument = (doc) => inlineKey(doc?.attachmentUrl) !== null

/** ⛔ Audit 2026-11-05, spec S5 (B4): what an IMAGE document may say. A note holding only widgets
 *  showed four "Image — Text read from a scanned page" lines: every widget's archived snapshot PNG
 *  goes through the image door (lib/embedArchive.js), becomes an OCR document, and OCR reads the
 *  chart's axis. So an image is spoken of only when the note HOLDS it (an image node in the body),
 *  and only while it is being read or has no text -- never the scan disclosure (a picture is not a
 *  scanned page), and never "looks like a scan" for a plain screenshot. */
export function imageTextNotice(doc) {
  const name = doc?.name || 'Image'
  if (doc?.status === 'pending' || (doc?.pagesAwaitingOcr || 0) > 0) {
    return { tone: 'busy', icon: 'clock', name, text: 'is still being read…' }
  }
  if (doc?.status === 'no_text' || (Number.isFinite(doc?.pagesTotal) && (doc?.pagesWithText || 0) === 0 && !doc?.textComplete
      && doc?.status !== 'processing_failed')) {
    return { tone: 'muted', icon: 'document', name, text: 'has no readable text, so Search and Ask cannot use it.' }
  }
  return null
}

export default function DocumentTextStatus({ documents = [], imageUrls = null }) {
  // `imageUrls` is what the body holds. Absent (an older caller), images are judged as before.
  const held = imageUrls ? new Set([...imageUrls].map(inlineKey).filter(Boolean)) : null
  const notices = documents
    .map((d) => {
      if (held && isImageDocument(d)) {
        return { doc: d, notice: held.has(inlineKey(d.attachmentUrl)) ? imageTextNotice(d) : null }
      }
      return { doc: d, notice: documentTextNotice(d) }
    })
    .filter((x) => x.notice)
  if (!notices.length) return null

  return (
    <div
      className={styles.wrap}
      role="status"
      aria-live="polite"
      /* ⛔ NAMED. `[role="status"]` is shared by several components in this
         product, and an unnamed one is indistinguishable from the others to
         a screen reader AND to a test probe — a lesson this program has paid
         for more than once. */
      aria-label="Attachment text status"
    >
      {notices.map(({ doc, notice }) => (
        <div key={doc.id} className={`${styles.row} ${styles[notice.tone]}`}>
          {/* ⛔ The icon is decoration; the sentence carries the meaning, so
              the state never depends on colour alone (§52). */}
          <UIcon name={notice.icon} size={12} gold={false} aria-hidden="true" />
          <span className={styles.text}>
            <strong className={styles.name}>{notice.name}</strong> {notice.text}
          </span>
        </div>
      ))}
    </div>
  )
}
