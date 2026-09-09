// Wave P2 §21/§22 — where a page's text CAME FROM, in member language.
//
// ⛔⛔ PROVENANCE IS NOT IDENTITY. A search hit on a scanned page is still a
// DOCUMENT at a real page number; `text_origin` only records how UCT came to
// hold that page's words. Nothing here may turn a result into an "OCR object",
// re-rank it, or hide it — the member asked for their document, not for a
// pipeline stage.
//
// ⛔ AND IT IS NOT A CONFIDENCE SCORE. The engine supplies no reliable
// per-page number and we refuse to invent one (§4 of the wave directive), so
// this is a binary fact — read from a scan, or not — plus the one thing the
// member can act on: look at the page.
//
// ⛔ NEVER NAME THE ENGINE. "Scanned text", not "Tesseract 5.3.0". The engine,
// its version and its timings are internal provenance and stay in the job
// table.
//
// ONE AUTHORITY. The sidebar's search row, the attachment status line and any
// later surface all import from here, so the vocabulary cannot fork the way
// the document status labels did before Wave P1 pulled them together.

export const TEXT_ORIGIN_NATIVE = 'native'
export const TEXT_ORIGIN_OCR = 'ocr'
export const TEXT_ORIGIN_WEB = 'web_passage'

/** The chip a member sees. Short, because it sits inside a result row. */
export const SCANNED_TEXT_LABEL = 'Scanned text'

/** Why it matters, for the row's title/tooltip and the document-level line.
 *
 *  ⭐ THE SENTENCE EARNS ITS SPACE BY BEING ACTIONABLE. "This came from OCR"
 *  tells the member a mechanism; "check the figures against the page" tells
 *  them what to do with it, which is the whole reason the label exists. */
export const SCANNED_TEXT_HINT =
  'Read from a scanned page — check exact figures against the page itself.'

/** Did this page's text come from reading a scan? */
export function isScannedText(row) {
  return (row && row.textOrigin) === TEXT_ORIGIN_OCR
}

/** The one-line disclosure for a whole document, or null when there is
 *  nothing to disclose.
 *
 *  ⛔ IT COUNTS PAGES, NOT DOCUMENTS. "Some of this was scanned" is not the
 *  same claim as "all of it was", and a mixed PDF — a native filing with two
 *  scanned exhibits — is the common shape. Absent counts say NOTHING rather
 *  than guessing, the same rule `documentTextNotice` already follows. */
export function scannedPagesNotice(doc) {
  if (!doc) return null
  const from = doc.pagesFromOcr
  const total = doc.pagesTotal
  if (!Number.isFinite(from) || from <= 0) return null
  if (!Number.isFinite(total) || total <= 0) return null
  return from >= total
    ? `Text read from ${total === 1 ? 'a scanned page' : 'scanned pages'}. `
      + 'Check exact figures against the page.'
    : `Text on ${from} of ${total} pages was read from a scan. `
      + 'Check exact figures against the page.'
}
