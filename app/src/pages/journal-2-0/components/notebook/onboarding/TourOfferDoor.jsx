// The door in front of the tour offer (finish program, lane FE).
//
// `TourOfferGate.jsx` is small but not free: with its eligibility rules and seen-state it was
// ~25 kB of source in the Notebook's first open for every member, and it can only ever show
// something while the wave-14 onboarding switch is on. This file is the part that stays in
// the first open: one flag read. With the switch off it renders nothing and loads nothing;
// with it on it loads the gate, which behaves exactly as it did when it was imported directly.
//
// The offer is passive (nobody asked for it), so a gate that cannot load is simply no offer on
// this page load: the boundary below renders nothing and reports it. `lazyLeaf` asks once more
// in place and never reloads the page.
import { Component, Suspense } from 'react'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { lazyLeaf, RETRY_WAIT_MS } from '../../../lib/lazyChunk'
import { checklistEnabled } from './gettingStartedPref'

class OfferDoorCatch extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error) {
    // eslint-disable-next-line no-console
    console.error('[TourOfferDoor] the tour offer could not load:', error)
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Notebook simplify: the "New in your Notebook" offer never opens by itself. The gate, its eligibility rules and
 *  its queue stay as they were; this is the one switch that stops the automatic trigger. Every walkthrough is still
 *  reachable from Help's Walkthroughs (the Learn menu went with Research home). A rail may build its own door with `makeTourOfferDoor(load, wait, true)`. */
export const AUTO_TOUR_OFFER = false

/** Build a door over `load` (rails hand in their own loader; the app uses the real gate). */
export function makeTourOfferDoor(load, waitMs = RETRY_WAIT_MS, auto = AUTO_TOUR_OFFER) {
  const TourOfferGateLeaf = lazyLeaf(load, waitMs)
  function TourOfferDoor(props) {
    // The same switch `tourLive` asks for every tour beyond the base one (tourRegistry.js).
    if (!auto || !checklistEnabled(notebookFlag)) return null
    return (
      <OfferDoorCatch>
        <Suspense fallback={null}>
          <TourOfferGateLeaf {...props} />
        </Suspense>
      </OfferDoorCatch>
    )
  }
  return TourOfferDoor
}

export default makeTourOfferDoor(() => import('./TourOfferGate'))
