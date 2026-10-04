// The eager, tiny half of the generic tour engine (wave 14, lane W14-0) -- mirrors
// NotebookTourGate.jsx's own split exactly. THIS file is statically imported by
// NotebookTab (so it can decide eligibility without ever paying for a tour's
// content), and it dynamically imports the walking UI, `GenericTourEngine.jsx`,
// ONLY once some tour is WANTED (risk R3: a member who never asks for a second
// tour never fetches its chunk, exactly like the base tour's own I-2 fix).
//
// The base tour (`notebook-basics`) is NEVER handled here -- NotebookTab filters it
// out of `tours` before handing the list down (zero behaviour change: the base
// tour's own proven gate/engine pair, NotebookTourGate.jsx / NotebookTour.jsx,
// keeps running it unchanged). This file is for every OTHER registered tour.
//
// ONE tour open at a time (plan section 4.3, decision D3): a second request while
// one is already open is ignored until the first closes -- `wantedId` is a single
// slot, not one per tour. Nothing here auto-starts a tour: every entry opens only
// by explicit request (Help's Replay button, a `startRegistryTourId` navigation
// state, or any future caller) until W14-C wires a "newly armed" trigger. That is
// a scope boundary stated in docs/notebook/wave14-w14-0.md, not an oversight.
import { Component, Suspense, useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { lazyLeaf, RETRY_WAIT_MS } from '../../../lib/lazyChunk'
import { reportError } from '../../../../../lib/errorBeacon'
import { getTourEntry } from './tourRegistry'
import { REGISTRY_TOUR_OPEN_EVENT, takePendingRegistryTourOpenAny } from './tourRegistryControl'

/** This gate's own boundary: a failed chunk (or a throw while it renders) renders
 *  NOTHING, never the route's error screen. Mirrors NotebookTourGate.jsx's
 *  `TourCatch` exactly (same shape, same swallow-on-purpose contract) but declared
 *  LOCALLY rather than imported: `NotebookTab.lazyViews.test.js`'s D-I2 rail can
 *  only see a `lazyLeaf`'s boundary when the error-boundary class is DECLARED in
 *  the same file as the `<Suspense>` it wraps -- an imported one is invisible to
 *  that AST walk, which is itself the correctness property the rail checks for
 *  (a boundary you cannot see in the file is a boundary you cannot audit from it). */
class RegistryTourCatch extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[RegistryToursGate] a registered tour could not load:', error)
    reportError(error, { kind: 'boundary', componentStack: info?.componentStack })
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Build a gate over `load` (rails hand in a loader that fails; the app uses the
 *  real engine chunk). Mirrors `makeTourGate`'s own factory shape on purpose, so a
 *  test can exercise this gate exactly the way NotebookTourGate.test.jsx exercises
 *  the base one. */
export function makeRegistryToursGate(load, waitMs = RETRY_WAIT_MS) {
  const GenericTourEngineLeaf = lazyLeaf(load, waitMs)

  function RegistryToursGate({ tours = [] }) {
    const location = useLocation()
    const [wantedId, setWantedId] = useState(() => {
      const pending = takePendingRegistryTourOpenAny()
      return pending && tours.some((t) => t.id === pending) ? pending : null
    })

    useEffect(() => {
      const onOpen = (e) => {
        const id = e?.detail?.tourId
        if (!id || !tours.some((t) => t.id === id)) return
        setWantedId((cur) => cur ?? id)
      }
      window.addEventListener(REGISTRY_TOUR_OPEN_EVENT, onOpen)
      return () => window.removeEventListener(REGISTRY_TOUR_OPEN_EVENT, onOpen)
    }, [tours])

    useEffect(() => {
      const fromState = location.state?.startRegistryTourId
      if (fromState && tours.some((t) => t.id === fromState)) setWantedId((cur) => cur ?? fromState)
    }, [location.state, tours])

    const close = useCallback(() => setWantedId(null), [])

    if (!wantedId) return null
    const entry = getTourEntry(wantedId, tours)
    if (!entry || notebookFlag(entry.flag) !== true) return null
    return (
      <RegistryTourCatch>
        <Suspense fallback={null}>
          <GenericTourEngineLeaf entry={entry} onClose={close} />
        </Suspense>
      </RegistryTourCatch>
    )
  }
  return RegistryToursGate
}

export default makeRegistryToursGate(() => import('./GenericTourEngine'))
