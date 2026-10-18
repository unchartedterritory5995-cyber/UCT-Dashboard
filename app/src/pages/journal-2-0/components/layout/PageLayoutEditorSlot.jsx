// The eager half of the Customize editor (P4a Task 7): the lazy import, a boundary, and the Suspense. The
// editor itself (PageLayoutEditor.jsx) is fetched only when a member presses Customize, and nothing eager
// may import it directly -- reachable.test.js and the pages' own eager graph both rest on that.
// ⛔ `lazyLeaf`, never `lazyChunk`. A second chunk failure under lazyChunk reloads the page, and a reload
//    here would throw away the panel arrangement the member is on the page to look at. A chunk that cannot
//    load is a message in a sheet the member can close, not a blank click.
import { Component, Suspense } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import { lazyLeaf } from '../../lib/lazyChunk'

const PageLayoutEditor = lazyLeaf(() => import('./PageLayoutEditor'))

export const LOAD_FAILED = "Couldn't open Customize. Reload the page and try again."

class LoadBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (!this.state.failed) return this.props.children
    return (
      <Sheet open onClose={this.props.onClose} title="Customize" maxWidth={420} labelledByTitle>
        <p role="alert">{LOAD_FAILED}</p>
      </Sheet>
    )
  }
}

/** Mount this only while the editor is open: `{open && <PageLayoutEditorSlot page=... onClose=... />}`. */
export default function PageLayoutEditorSlot(props) {
  return (
    <LoadBoundary onClose={props.onClose}>
      <Suspense fallback={null}>
        <PageLayoutEditor {...props} />
      </Suspense>
    </LoadBoundary>
  )
}
