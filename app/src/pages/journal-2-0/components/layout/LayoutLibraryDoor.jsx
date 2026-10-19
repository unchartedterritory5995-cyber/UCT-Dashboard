// P4b Task 8: the community library opened at Page layouts, from Customize's "Find shared layouts". The LibraryDoor
// pattern (F21) without a button: the page renders `<LayoutLibraryDoor open={findingLayouts} onClose=... />`, after
// closing the Customize editor, so only one sheet is open at any moment.
// ⛔ The gallery loads through the SAME module specifier the other library doors use (`notebook/TemplateGallery`),
//    so the chunk is shared and this door adds no gallery bytes of its own. The import lives HERE, and the two
//    pages that render this door are lazy routes: it adds no first-open bytes.
// ⛔ `lazyLeaf`, never `lazyChunk` (ruling X15 / P4b-AUD-4): a second chunk failure under lazyChunk reloads the
//    page, and a reload would throw away the trade or the day the member is looking at. A gallery that cannot
//    load is a sentence in a sheet the member can close.
import { Component, Suspense } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { lazyLeaf } from '../../lib/lazyChunk'

const TemplateGallery = lazyLeaf(() => import('../notebook/TemplateGallery'))

export const LIBRARY_TITLE = 'Shared page layouts'
export const LIBRARY_LOAD_FAILED = "Couldn't open the shared layouts. Reload the page and try again."

class LoadBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return <p role="alert">{LIBRARY_LOAD_FAILED}</p>
  }
}

/** Renders nothing while `open` is false. */
export default function LayoutLibraryDoor({ open, onClose }) {
  if (!open) return null
  return (
    <Sheet open onClose={onClose} title={LIBRARY_TITLE} labelledByTitle variant="auto" maxWidth={960}>
      <LoadBoundary>
        <Suspense fallback={<p role="status">Loading the community library…</p>}>
          <TemplateGallery initialType="page_layout" onBack={onClose} backLabel="Close the library" />
        </Suspense>
      </LoadBoundary>
    </Sheet>
  )
}
