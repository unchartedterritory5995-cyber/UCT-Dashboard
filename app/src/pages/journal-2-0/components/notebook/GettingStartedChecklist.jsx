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
import { Component, Suspense } from 'react'
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

/** Build a gate over `load` (a rail hands in a loader that fails; the app uses the list). */
export function makeChecklistGate(load, waitMs = RETRY_WAIT_MS) {
  const GettingStartedListLeaf = lazyLeaf(load, waitMs)

  function GettingStartedChecklist(props) {
    const enabled = checklistEnabled(notebookFlag)
    const { prefs, loading } = usePreferences()
    if (!enabled || loading || checklistClosed(prefs?.[CHECKLIST_PREF])) return null
    return (
      <ChecklistCatch>
        <Suspense fallback={null}>
          <GettingStartedListLeaf {...props} />
        </Suspense>
      </ChecklistCatch>
    )
  }
  return GettingStartedChecklist
}

export default makeChecklistGate(() => import('./GettingStartedList'))
