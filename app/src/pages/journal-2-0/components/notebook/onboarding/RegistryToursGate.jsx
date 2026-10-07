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
import { Component, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { lazyLeaf, RETRY_WAIT_MS } from '../../../lib/lazyChunk'
import { reportError } from '../../../../../lib/errorBeacon'
import { getTourEntry, tourLive } from './tourRegistry'
import {
  REGISTRY_TOUR_OPEN_EVENT, announceRegistryTourClosed, hasPendingRegistryTourOpen,
  stripTourState, takePendingRegistryTourOpenAny,
} from './tourRegistryControl'

/** The one sentence a member reads when a walkthrough they asked for could not be shown. */
export const TOUR_FAILED_NOTICE = 'That walkthrough could not be shown here, so it was closed; you can start it again from Help.'
/** How long that sentence stays up. */
export const TOUR_NOTICE_MS = 8000
const NOTICE_STYLE = Object.freeze({
  position: 'fixed', left: '50%', bottom: 'calc(24px + env(safe-area-inset-bottom, 0px))',
  transform: 'translateX(-50%)', zIndex: 1200, maxWidth: 'min(92vw, 520px)', margin: 0,
  padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.45,
  background: 'var(--bg-elevated, #1c1f26)', color: 'var(--text-primary, #f1f3f5)',
  border: '1px solid var(--border, rgba(255,255,255,0.14))', boxShadow: '0 6px 24px rgba(0,0,0,0.35)',
})

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
    // Rendering nothing is not enough: the gate must hear it, or the one tour slot stays taken.
    this.props.onFail?.()
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
    const navigate = useNavigate()
    const [notice, setNotice] = useState(null)
    useEffect(() => {
      if (!notice) return undefined
      const t = setTimeout(() => setNotice(null), TOUR_NOTICE_MS)
      return () => clearTimeout(t)
    }, [notice])
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
      if (!fromState) return
      if (tours.some((t) => t.id === fromState)) setWantedId((cur) => cur ?? fromState)
      // ⛔ The request is SPENT the moment it is read. Left on the history entry, Back onto
      // this page opened the tour again (and the tour pushed forward again: a trap), and a
      // reload replayed it. Same entry, same URL, the request removed, anything else kept.
      navigate(
        { pathname: location.pathname, search: location.search, hash: location.hash },
        { replace: true, state: stripTourState(location.state) },
      )
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location.state, tours])

    const wantedRef = useRef(wantedId)
    wantedRef.current = wantedId
    // Every end is announced with whether the tour ever showed a step, so the offer is spent
    // only on a tour that opened (TourOfferGate.jsx, W14-Q1 finding S6).
    const close = useCallback((info) => {
      const id = wantedRef.current
      wantedRef.current = null
      setWantedId(null)
      // A request this tour answered must not outlive it: `openRegistryTour` leaves its id
      // pending, and the next shell remount (any change of page) would open the tour again
      // (W14-Q2).
      if (id && hasPendingRegistryTourOpen() === id) takePendingRegistryTourOpenAny()
      if (id) announceRegistryTourClosed(id, info?.opened === true)
      // A walkthrough the member asked for that could not be shown says so, once.
      if (id && info?.failed === true) setNotice(TOUR_FAILED_NOTICE)
    }, [])
    const failed = useCallback(() => {
      const e = wantedRef.current ? getTourEntry(wantedRef.current, tours) : null
      close({ opened: false, failed: e?.replayable !== false })
    }, [close, tours])

    const entry = wantedId ? getTourEntry(wantedId, tours) : null
    // tourLive: own flag, `requires`, and the wave-14 onboarding switch (tourRegistry.js)
    const allowed = tourLive(entry, notebookFlag)
    // A request for a tour whose capability is off is dropped, not held: the slot is one
    // tour wide, so a held request would block every later one (W14-C1).
    useEffect(() => { if (wantedId && !allowed) close({ opened: false }) }, [wantedId, allowed, close])

    const said = notice ? <p role="status" data-tour-notice="" style={NOTICE_STYLE}>{notice}</p> : null
    if (!allowed) return said
    return (
      <>
        <RegistryTourCatch key={wantedId} onFail={failed}>
          <Suspense fallback={null}>
            <GenericTourEngineLeaf entry={entry} onClose={close} />
          </Suspense>
        </RegistryTourCatch>
        {said}
      </>
    )
  }
  return RegistryToursGate
}

export default makeRegistryToursGate(() => import('./GenericTourEngine'))
