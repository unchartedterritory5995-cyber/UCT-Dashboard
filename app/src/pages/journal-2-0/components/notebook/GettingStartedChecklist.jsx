// The "get started" checklist's EAGER half (wave 14, lane W14-D): the one thing Research
// Home imports statically. It decides whether the list's chunk is fetched at all, and
// what happens if that fetch fails -- the same split NotebookTourGate.jsx makes for the
// tour (wave 8 ruling D-C7), for the same two reasons:
//   * WHEN -- only for a member the list is for: BOTH `notebook_onboarding_enabled` and
//     the list's own dark gate `notebook_getting_started_enabled` on, the
//     preferences loaded (a dismissed list must never flash, and must never be fetched),
//     and the one key (`notebook_getting_started`, gettingStartedPref.js) not closed.
//     The list itself (`GettingStartedList.jsx`) and its rules never join the
//     Notebook's first-open bytes, which are already at their budget
//     (docs/notebook/perf-budgets.json; budgets are never raised to fit a reading).
//   * IF IT FAILS -- `lazyLeaf` (one in-place retry, NEVER a page reload) inside a
//     boundary DECLARED HERE that renders nothing. The list is optional: its failure
//     costs the member the list, never Research Home. (Declared locally, not imported:
//     NotebookTab.lazyViews.test.js's D-I2 rail can only see a boundary declared in the
//     same file as the <Suspense> it wraps.)
import { Component, Suspense, useLayoutEffect, useSyncExternalStore } from 'react'
import usePreferences from '../../../../hooks/usePreferences'
import { reportError } from '../../../../lib/errorBeacon'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import { lazyLeaf, RETRY_WAIT_MS } from '../../lib/lazyChunk'
import { CHECKLIST_PREF, checklistClosed, checklistEnabled } from './onboarding/gettingStartedPref'

class ChecklistCatch extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[GettingStartedChecklist] the list could not load:', error)
    reportError(error, { kind: 'boundary', componentStack: info?.componentStack })
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

// Final fix (C4): whether a get-started card is up (drawn, or its chunk on the way), for the empty list's standalone
// "Add a sample notebook" (SampleNotebookDoor.jsx): while the card is up with its sample step not yet done, that step
// is the door and the button is not drawn. Marked by `CardUp` inside the boundary, so a card whose chunk could not
// load (the boundary renders nothing), a hidden or closed card, or no card at all lets the button draw again. A
// layout effect: a door already loaded reads the answer before the frame is painted, never a button that flashes.
let cardsUp = 0
const cardListeners = new Set()
const emitCards = () => cardListeners.forEach((fn) => fn())
const subscribeCards = (fn) => {
  cardListeners.add(fn)
  return () => cardListeners.delete(fn)
}
function CardUp() {
  useLayoutEffect(() => {
    cardsUp += 1
    emitCards()
    return () => {
      cardsUp -= 1
      emitCards()
    }
  }, [])
  return null
}
/** Whether a get-started card is up right now. */
export function useGettingStartedCardUp() {
  return useSyncExternalStore(subscribeCards, () => cardsUp > 0, () => false)
}

/** Build a gate over `load` (a rail hands in a loader that fails; the app uses the list). */
export function makeChecklistGate(load, waitMs = RETRY_WAIT_MS) {
  const GettingStartedListLeaf = lazyLeaf(load, waitMs)

  function GettingStartedChecklist(props) {
    const enabled = checklistEnabled(notebookFlag)
    const { prefs, loading } = usePreferences()
    // Notebook simplify: the list is for a member with zero notes. With one note it is gone (and never fetched).
    if (props.hasAnyNotes || !enabled || loading || checklistClosed(prefs?.[CHECKLIST_PREF])) return null
    return (
      <ChecklistCatch>
        <CardUp />
        <Suspense fallback={null}>
          <GettingStartedListLeaf {...props} />
        </Suspense>
      </ChecklistCatch>
    )
  }
  return GettingStartedChecklist
}

export default makeChecklistGate(() => import('./GettingStartedList'))
