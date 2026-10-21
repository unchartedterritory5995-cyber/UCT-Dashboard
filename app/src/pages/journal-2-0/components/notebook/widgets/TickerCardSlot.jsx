// Notebook widgets W1: the eager half of the $TICKER chip's card -- the lazy import, a boundary that renders
// nothing, and the Suspense. NoteEditorPage mounts it while W1 is on; the card (TickerCardPopover.jsx) listens on
// the editor's DOM for lib/tickerChip.js's event. ⛔ `lazyLeaf`, never `lazyChunk` (as FollowupOfferSlot.jsx): a
// chunk that cannot load leaves the chip inert, never a page reload.
import { Component, Suspense } from 'react'
import { lazyLeaf } from '../../../lib/lazyChunk'

const TickerCardPopover = lazyLeaf(() => import('./TickerCardPopover'))

class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

export default function TickerCardSlot({ editor }) {
  return <Quiet><Suspense fallback={null}><TickerCardPopover editor={editor} /></Suspense></Quiet>
}
