// Tier 2 part B (R-T2B-7): the eager half of the earnings follow-up card -- the lazy import, a boundary that
// renders nothing, and the Suspense. The card itself (FollowupOffer.jsx) is fetched only the first time a
// follow-up link is open with both switches on, so a member who never opens one downloads nothing.
// ⛔ V12: `lazyLeaf`, never `lazyChunk`. A second chunk failure under lazyChunk reloads the page (or throws past a
// `<Suspense fallback={null}>` to the route's error screen) and blanks the Notebook for one optional card. A card
// whose chunk cannot load is simply absent; the notice still links here and the rest of the Notebook stands.
// (Why not a `lazyDialog` in NotebookTab: tabs/NotebookTab.lazyViews.test.js pins that file's dynamic imports.)
import { Component, Suspense, useMemo, useState } from 'react'
import { lazyLeaf } from '../../lib/lazyChunk'

/** The chunk loader, on an object so a rail can count or fail the fetch (like lazyChunk's `chunkRetry`). */
export const followupChunk = { load: () => import('./FollowupOffer') }

class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

/** Renders nothing, and requests nothing, until `open` has been true once. */
export default function FollowupOfferSlot(props) {
  const [opened, setOpened] = useState(Boolean(props.open))
  if (props.open && !opened) setOpened(true)
  // One lazy per mount, made only once opened: React.lazy remembers a REJECTED load for the life of the element
  // type, so a module-level one that failed once would never try again in this tab, even for the next notice.
  // (The module itself is fetched once by the browser; a mount that finds it loaded renders at once.)
  const FollowupOffer = useMemo(() => (opened ? lazyLeaf(() => followupChunk.load()) : null), [opened])
  if (!opened) return null
  return <Quiet><Suspense fallback={null}><FollowupOffer {...props} /></Suspense></Quiet>
}
