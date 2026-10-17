/**
 * Today panel: notices (P4a Task 4).
 *
 * Research Home's Notices box (resurfaced notes, task reminders, fill and follow-up notices), unchanged.
 * It is loaded through the SAME module Research Home loads (components/notebook/NoticesBox), so the chunk is
 * shared and a member who has seen one has the other.
 *
 * ⛔ NO TileCard FRAME. NoticesBox is a folded card of its own ("Notices · 3") and renders null when there is
 * nothing to show, but it cannot tell a frame around it that it is empty. A frame here would be an empty card
 * on every quiet day. Without one, an empty box leaves nothing at all in the page, which is what a panel with
 * nothing to say should do. (It is the one Today panel that is not a TileCard; the brief's "renders nothing
 * when empty" cannot be met any other way without a second copy of NoticesBox's two reads.)
 *
 * ⛔ lazyLeaf, never lazyChunk (a second chunk failure must not reload Today), and a boundary that renders
 * nothing: notices that cannot load are simply absent.
 */
import { Component, Suspense } from 'react'
import { lazyLeaf } from '../../../lib/lazyChunk'

// A boundary that renders nothing, declared here: NotebookTab.lazyViews.test.js (D-I2) requires a lazyLeaf's file
// to render a boundary around its Suspense.
class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

const NoticesBox = lazyLeaf(() => import('../../../components/notebook/NoticesBox'))

export default function NoticesPanel() {
  return (
    <Quiet>
      <Suspense fallback={null}>
        <NoticesBox />
      </Suspense>
    </Quiet>
  )
}
