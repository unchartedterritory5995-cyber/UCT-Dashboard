import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.mjs?url'

/**
 * Wave J — PDF.js setup. This replaces DocumentPreviewSheet's Wave I
 * `<iframe>` for the one thing an iframe genuinely cannot do: expose a
 * real, selectable text layer.
 *
 * Live-measured this session, not assumed: opening a Wave I preview and
 * reading `iframe.contentDocument.body.innerText.length` returns 0 —
 * Chrome's built-in PDF viewer renders pages to an opaque internal surface,
 * not real DOM text. `window.getSelection()` inside that iframe returns
 * nothing usable, so excerpt/highlight capture is structurally impossible
 * without a real text-layer renderer. pdfjs-dist's own `TextLayer` class
 * (used here) renders one positioned, transparent `<span>` per text run,
 * over which the browser's native `Selection`/`Range` APIs work exactly as
 * they do over any other web text — including native long-press selection
 * on touch devices, which the Wave I iframe could not offer at all.
 */
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export { pdfjsLib }

/** Loads a PDF from an authenticated same-origin URL. `withCredentials`
 * carries the session cookie -- the exact same auth boundary the Wave I
 * iframe's `src` already relied on; no new auth surface. */
export function loadPdfDocument(url) {
  return pdfjsLib.getDocument({ url, withCredentials: true }).promise
}
