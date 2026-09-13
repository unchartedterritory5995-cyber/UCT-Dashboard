import { Component, Suspense, lazy } from 'react'
import styles from './DocumentPreviewSheet.module.css'

/**
 * The PDF viewer, behind its own lazy boundary and its own error boundary.
 *
 * ⚰️ WHY THIS FILE EXISTS. On 2026-09-12 a real iPhone 15 Pro / iOS Safari 17.5 opened
 * `/journal/notebook` on production and got the ROUTE-LEVEL error boundary — "Something went
 * wrong on this page" — instead of the Notebook. The cause was one line inside `pdfjs-dist`'s
 * modern build (`typeof Iterator.prototype.join`, which throws where the `Iterator` global does
 * not exist, i.e. every iOS below 18.4). The import that pulled it in was **static**, three
 * components deep, so a failure in a document PREVIEW took down the whole NOTEBOOK.
 *
 * ⭐ THE COMPATIBILITY FIX ALONE WOULD NOT HAVE BEEN ENOUGH, and that is the point of this file.
 * `lib/pdfjs.js` now loads the legacy build and iOS 17 works again — but the structural defect was
 * never "pdfjs is incompatible", it was "a leaf component can kill a route". The next
 * incompatibility, in this dependency or another, must cost a member their PDF preview and
 * nothing else. That is what a boundary buys that a version bump does not.
 *
 * Two mechanisms, because they catch different failures:
 *   - `lazy()` keeps the chunk out of the Notebook's own bundle, so a module that throws at
 *     EVALUATION rejects a promise instead of taking the route's module graph with it;
 *   - the class boundary catches a throw during RENDER, which `lazy` does not.
 */
const PdfDocumentViewer = lazy(() => import('./PdfDocumentViewer'))

/** What a member sees instead of a dead route. Plain, honest, and it keeps the sheet usable —
 *  "Open in new tab" and "Download" live in the sheet above this and still work. */
function PdfUnavailable() {
  return (
    <div className={styles.pdfUnavailable} data-testid="pdf-preview-unavailable" role="status">
      PDF preview isn’t available on this browser.
    </div>
  )
}

class Catch extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    // ⛔ SWALLOWED ON PURPOSE, BUT NEVER SILENTLY. The whole job of this boundary is to stop the
    // throw propagating to the route; the console line is what keeps it diagnosable, and it is
    // the only trace a member's device leaves.
    // eslint-disable-next-line no-console
    console.error('[PdfViewerBoundary] PDF preview failed to load:', error)
  }

  render() {
    if (this.state.failed) return <PdfUnavailable />
    return this.props.children
  }
}

export default function PdfViewerBoundary(props) {
  return (
    <Catch>
      <Suspense fallback={<div className={styles.pdfLoading} role="status">Loading preview…</div>}>
        <PdfDocumentViewer {...props} />
      </Suspense>
    </Catch>
  )
}
