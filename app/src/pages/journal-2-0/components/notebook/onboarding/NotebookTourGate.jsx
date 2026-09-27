// Whether the Notebook tour's chunk is fetched at all, and what happens if it cannot be
// (wave 8 final review, fix I-2; ruling D-C7).
//
// ⚰️ THE DEFECT. NotebookTab loaded the tour through `lazyChunk` inside a bare <Suspense>,
// and mounted it for EVERY member while `notebook_onboarding_enabled` was on -- so every
// Notebook visit fetched the chunk, and a failed fetch went to `utils/lazyWithRetry`, which
// reloads the page once per session with no online check. Offline (Wave Q1's default
// editing mode) that reload lands on the browser's offline page; after a deploy a stale tab
// reloaded itself on entering the Notebook; and once the session's one reload was spent the
// error reached the route boundary, so an OPTIONAL onboarding card replaced the whole
// Notebook with the error screen.
//
// NOW, two things, and they fail for different reasons:
//   * WHEN -- the chunk is fetched only when the tour will actually show: a member the tour
//     is for (tourPref.js's rule, the one the tour itself runs), or an explicit request
//     ("Take the tour": a pending request or the open event; the help article's link:
//     `state.startTour`). A member with notes and no request never downloads it. Once
//     wanted, it stays mounted (the tour holds its own state while open).
//   * IF IT FAILS -- `lazyLeaf` (one in-place retry of a failed fetch, NEVER a page reload)
//     inside `TourCatch`, which renders NOTHING. The tour is optional: its failure costs the
//     member the tour, and nothing else.
import { Component, Suspense, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import usePreferences from '../../../../../hooks/usePreferences'
import { useIsPaid } from '../../../../../context/AuthContext'
import { reportError } from '../../../../../lib/errorBeacon'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { lazyLeaf, RETRY_WAIT_MS } from '../../../lib/lazyChunk'
import { TOUR_OPEN_EVENT, hasPendingTourOpen } from './tourControl'
import { TOUR_PREF, readTourPref, tourFinished, tourIsForThisMember } from './tourPref'

/** The tour's own boundary: a failed chunk (or a throw while it renders) renders NOTHING,
 *  never the route's error screen. Swallowed on purpose, never silently. */
class TourCatch extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[NotebookTourGate] the tour could not load:', error)
    reportError(error, { kind: 'boundary', componentStack: info?.componentStack })
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Build a gate over `load` (rails hand in a loader that fails; the app uses the tour). */
export function makeTourGate(load, waitMs = RETRY_WAIT_MS) {
  const NotebookTourLeaf = lazyLeaf(load, waitMs)

  function NotebookTourGate({ hasAnyNotes = false, notesKnown = false }) {
    const enabled = notebookFlag('notebook_onboarding_enabled') === true
    const isPaid = useIsPaid()
    const { prefs, loading } = usePreferences()
    const location = useLocation()
    // "Take the tour" before the tour exists: the pending flag, or the event while we wait.
    const [asked, setAsked] = useState(() => hasPendingTourOpen())
    useEffect(() => {
      if (!enabled || asked) return undefined
      const onOpen = () => setAsked(true)
      window.addEventListener(TOUR_OPEN_EVENT, onOpen)
      return () => window.removeEventListener(TOUR_OPEN_EVENT, onOpen)
    }, [enabled, asked])

    const savedState = readTourPref(prefs?.[TOUR_PREF])?.state ?? null
    const auto = tourIsForThisMember({ enabled, isPaid, notesKnown, hasAnyNotes, loading })
      && !tourFinished(savedState)
    const wanted = enabled && (asked || auto || Boolean(location.state?.startTour))
    // Latched: once the tour is wanted it stays mounted -- it may be open, or recording.
    const [mounted, setMounted] = useState(false)
    if (wanted && !mounted) setMounted(true)

    if (!enabled || !mounted) return null
    return (
      <TourCatch>
        <Suspense fallback={null}>
          <NotebookTourLeaf hasAnyNotes={hasAnyNotes} notesKnown={notesKnown} />
        </Suspense>
      </TourCatch>
    )
  }
  return NotebookTourGate
}

export default makeTourGate(() => import('./NotebookTour'))
