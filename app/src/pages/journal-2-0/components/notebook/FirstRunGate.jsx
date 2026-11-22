// Audit 2026-11-05, spec S16: WHETHER the 60-second first run shows, and the inline ask on Home after a Skip. The
// EAGER half (small): the sheet and the inline ask are FirstRunSheet.jsx, a lazy leaf fetched only when one will show,
// inside a boundary that renders NOTHING if it cannot load -- the first run is optional, the Notebook is not.
//   * FirstRunGate (NotebookTab): opens by itself on a member's first Notebook visit (lib/firstRun.js
//     `firstRunIsDue`), and from Settings ("Set up my Notebook", `location.state.openFirstRun`). It records
//     `first_run` the moment it shows, so a reload or a second tab never brings it back, and while it is up the
//     Notebook tour waits (`setFirstRunShowing`, read by NotebookTourGate).
//   * FirstRunInlineSlot (Research Home): after a Skip, Home asks the same two things inline (S17).
import { Component, Suspense, useCallback, useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import usePreferences from '../../../../hooks/usePreferences'
import { lazyLeaf } from '../../lib/lazyChunk'
import { starterPacksEnabled } from '../../lib/starterPacksFlag'
import { TIPS_PREF, withTipSeen } from '../../lib/notebookTips'
import {
  FIRST_RUN_MARKS, FIRST_RUN_STATE, firstRunInlineIsDue, firstRunIsDue, setFirstRunShowing,
} from '../../lib/firstRun'

const FirstRunSheet = lazyLeaf(() => import('./FirstRunSheet'))
const FirstRunInline = lazyLeaf(() => import('./FirstRunSheet'), undefined, 'FirstRunInline')

/** The first run's own boundary: a failed chunk renders nothing, never the route's error screen. */
class Quiet extends Component {
  constructor(props) { super(props); this.state = { failed: false } }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFail?.() }
  render() { return this.state.failed ? null : this.props.children }
}

/** `mark(id)`: record one FIRST_RUN_MARKS id on the account (the one-time-tips preference). */
function useMark(setPrefMerged) {
  return useCallback((id) => setPrefMerged(TIPS_PREF, (current) => withTipSeen(current, id)), [setPrefMerged])
}

export default function FirstRunGate({ hasAnyNotes = false, notesKnown = false, onOpenNote, onOpenToday }) {
  const enabled = starterPacksEnabled()
  const { prefs, loading, readFailed, setPrefMerged } = usePreferences(enabled)
  const mark = useMark(setPrefMerged)
  const location = useLocation()
  const navigate = useNavigate()
  const asked = enabled && Boolean(location.state?.[FIRST_RUN_STATE])
  const due = firstRunIsDue({
    enabled, prefsReady: !loading && !readFailed, tipsRaw: prefs?.[TIPS_PREF], notesKnown, hasAnyNotes,
  })
  // Latched: once it opens it stays until the member closes it (recording `first_run` makes `due` false at once).
  const [open, setOpen] = useState(false)
  if ((due || asked) && !open) setOpen(true)

  useEffect(() => {
    if (!open) return
    mark(FIRST_RUN_MARKS.shown)
    // Settings' request is used once: a Back to this page does not open it again.
    if (location.state?.[FIRST_RUN_STATE]) {
      const { [FIRST_RUN_STATE]: _drop, ...rest } = location.state
      navigate(`${location.pathname}${location.search}${location.hash}`, { replace: true, state: rest })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])
  useEffect(() => { setFirstRunShowing(open); return () => setFirstRunShowing(false) }, [open])

  if (!open) return null
  return (
    <Quiet onFail={() => setOpen(false)}>
      <Suspense fallback={null}>
        <FirstRunSheet open onClose={() => setOpen(false)} onOpenNote={onOpenNote} onOpenToday={onOpenToday} mark={mark} />
      </Suspense>
    </Quiet>
  )
}

/** Research Home's inline first-run ask, after a Skip. Renders nothing until it is due. */
export function FirstRunInlineSlot({ onOpenNote, onOpenToday }) {
  const enabled = starterPacksEnabled()
  const { prefs, loading, readFailed, setPrefMerged } = usePreferences(enabled)
  const mark = useMark(setPrefMerged)
  const [closed, setClosed] = useState(false)
  const due = firstRunInlineIsDue({ enabled, prefsReady: !loading && !readFailed, tipsRaw: prefs?.[TIPS_PREF] })
  // Latched like the sheet: Build records `first_run_built`, and the build list must stay on screen until Done.
  const [shown, setShown] = useState(false)
  if (due && !shown && !closed) setShown(true)
  if (!shown || closed) return null
  return (
    <Quiet>
      <Suspense fallback={null}>
        <FirstRunInline mark={mark} onOpenNote={onOpenNote} onOpenToday={onOpenToday} onClose={() => setClosed(true)} />
      </Suspense>
    </Quiet>
  )
}
