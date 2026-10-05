// The eager, tiny half of the generic tour engine (wave 14, lanes W14-0 and W14-C1) --
// mirrors NotebookTourGate.jsx's own split exactly. THIS file is statically imported by
// the app shell, `components/Layout.jsx`, ONCE (W14-C1: tours start on Journal pages and
// in notes as well as on the Notebook, and a tour must survive the navigation to its own
// start, so the gate cannot live in any one page). It dynamically imports the walking
// UI, `GenericTourEngine.jsx`, ONLY once some tour is WANTED (risk R3).
//
// The base tour (`notebook-basics`) is NEVER handled here -- the shell hands down
// `OTHER_TOURS` (tourRegistry.js), which leaves it out; its own gate/engine pair,
// NotebookTourGate.jsx / NotebookTour.jsx, keeps running it unchanged.
//
// ONE tour open at a time (plan section 4.3, decision D3): `wantedId` is a single slot.
// A tour opens only by explicit request: Help's Replay (a `startRegistryTourId`
// navigation state), the offer (TourOfferGate.jsx), the checklist, or the resurfacing
// notice's passive explainer, each through `openRegistryTour` or the navigation state.
import { Component, Suspense, useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { lazyLeaf, RETRY_WAIT_MS } from '../../../lib/lazyChunk'
import { reportError } from '../../../../../lib/errorBeacon'
import { getTourEntry, tourLive } from './tourRegistry'
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

    const entry = wantedId ? getTourEntry(wantedId, tours) : null
    // tourLive: own flag, `requires`, and the wave-14 onboarding switch (tourRegistry.js)
    const allowed = tourLive(entry, notebookFlag)
    // A request for a tour whose capability is off is dropped, not held: the slot is one
    // tour wide, so a held request would block every later one (W14-C1).
    useEffect(() => { if (wantedId && !allowed) setWantedId(null) }, [wantedId, allowed])

    if (!allowed) return null
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
