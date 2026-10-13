// The eager half of Log Trade's pre-entry checklist (Notebook P2a, Task 8): the lazy import, a
// boundary that renders nothing, and the Suspense. The body (LogTradeChecklist.jsx) is fetched only
// when a Log Trade dialog shows it.
// ⛔ S15: `lazyLeaf`, never `lazyChunk`. A second chunk failure under lazyChunk reloads the page, and
// that would lose a half-filled trade. A checklist that cannot load is simply absent: the trade must
// still be loggable, and with no body nothing reports items up, so nothing is written.
import { Component, Suspense } from 'react'
import { lazyLeaf } from '../lib/lazyChunk'

const LogTradeChecklist = lazyLeaf(() => import('./LogTradeChecklist'))

class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

export default function LogTradeChecklistSlot(props) {
  return <Quiet><Suspense fallback={null}><LogTradeChecklist {...props} /></Suspense></Quiet>
}
