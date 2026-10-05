// "Newly switched on, offer once" -- the EAGER half (wave 14, lane W14-C2; plan 4.3, D3).
//
// NotebookTab mounts this beside RegistryToursGate. It decides, with the pure rules in
// tourEligibility.js, whether ONE registered tour should be offered right now, and only
// then fetches the small card (TourOfferPrompt.jsx, its own lazy chunk -- the Notebook's
// first-open bytes are already over budget, and a member with nothing to be offered
// never downloads it). Accepting opens the tour through the registry's own door
// (`openRegistryTour`), so RegistryToursGate.jsx needed no change.
//
// THE FIRST-RUN STAGE (plan 5.6, risk R2). The card is portaled into Layout's in-flow
// first-run slot (never floating) and HOLDS the stage while it shows, so the "Meet
// Compass" card waits behind it. It never stacks on another first-run surface:
//   * it waits while someone ELSE holds the stage (a tour is open, the phone editor) --
//     counted with `useFirstRunStageHolderCount` minus its own claim;
//   * it waits while the slot already carries another card (the Compass card shows
//     without claiming, so the slot's children are the only signal; a MutationObserver
//     keeps that live);
//   * it waits while the base first-run tour is still due for this member, while the
//     "get started" checklist is open (that list already offers every armed tour), and
//     while a note is open (R4: never while a member is editing).
// Waiting is never dismissing: nothing is recorded, and the offer returns when the
// reason goes. It is NOT a modal: no focus is moved to it, nothing traps Tab.
import { Component, Suspense, useCallback, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import usePreferences from '../../../../../hooks/usePreferences'
import { useIsPaid } from '../../../../../context/AuthContext'
import { reportError } from '../../../../../lib/errorBeacon'
import {
  claimFirstRunStage, useFirstRunSlot, useFirstRunStageHolderCount,
} from '../../../../../components/firstRun/firstRunStage'
import { notebookFlag } from '../../../lib/offline/notebookFlags'
import { lazyLeaf, RETRY_WAIT_MS } from '../../../lib/lazyChunk'
import { openRegistryTour } from './tourRegistryControl'
import { TOURS_PREF, TOUR_STATES, recordTourState } from './tourSeenState'
import { TOUR_PREF, readTourPref, tourFinished, tourIsForThisMember } from './tourPref'
import { CHECKLIST_PREF, checklistClosed, checklistEnabled } from './gettingStartedPref'
import {
  offerBlockedBy, offerableTours, pickOffer, readOfferSession, writeOfferSession,
} from './tourEligibility'

/** The attribute the card's root carries, so the slot watcher can tell it from others. */
export const OFFER_ATTR = 'data-tour-offer'

class TourOfferCatch extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error, info) {
    // eslint-disable-next-line no-console
    console.error('[TourOfferGate] the offer could not load:', error)
    reportError(error, { kind: 'boundary', componentStack: info?.componentStack })
  }

  render() {
    return this.state.failed ? null : this.props.children
  }
}

/** Whether the slot holds anything that is not this offer's own card. */
function slotHasOthers(slot) {
  if (!slot) return false
  return Array.from(slot.children).some((el) => !el.hasAttribute(OFFER_ATTR))
}

function useSlotBusyByOthers(slot) {
  const [busy, setBusy] = useState(() => slotHasOthers(slot))
  useEffect(() => {
    if (!slot) { setBusy(false); return undefined }
    setBusy(slotHasOthers(slot))
    if (typeof MutationObserver !== 'function') return undefined
    const mo = new MutationObserver(() => setBusy(slotHasOthers(slot)))
    mo.observe(slot, { childList: true })
    return () => mo.disconnect()
  }, [slot])
  return busy
}

export function makeTourOfferGate(load, waitMs = RETRY_WAIT_MS) {
  const TourOfferPromptLeaf = lazyLeaf(load, waitMs)

  function TourOfferGate({ tours = [], hasAnyNotes = false, notesKnown = false, noteOpen = false }) {
    const { prefs, setPrefMerged, loading } = usePreferences()
    const isPaid = useIsPaid()
    const slot = useFirstRunSlot()
    const holders = useFirstRunStageHolderCount()
    const slotBusy = useSlotBusyByOthers(slot)
    const [session, setSession] = useState(() => readOfferSession())
    const [showing, setShowing] = useState(false)

    const offerable = offerableTours({ tours, flagOn: notebookFlag, toursPrefRaw: prefs?.[TOURS_PREF] })
    const entry = pickOffer({ offerable, session })

    const onboarding = notebookFlag('notebook_onboarding_enabled') === true
    const baseTourPending = tourIsForThisMember({ enabled: onboarding, isPaid, notesKnown, hasAnyNotes, loading })
      && !tourFinished(readTourPref(prefs?.[TOUR_PREF])?.state ?? null)
    const checklistOpen = checklistEnabled(notebookFlag) && !checklistClosed(prefs?.[CHECKLIST_PREF])
    const blocked = entry ? offerBlockedBy({
      prefsLoading: loading,
      notesKnown,
      noteOpen,
      baseTourPending,
      checklistOpen,
      stageHeldByOthers: holders - (showing ? 1 : 0) > 0,
      slot,
      // once on screen it keeps its place: anything arriving in the slot after it
      // arrived is waiting on ITS claim, not the other way round
      slotBusy: showing ? false : slotBusy,
    }) : 'nothing-to-offer'

    const show = Boolean(entry) && !blocked
    useEffect(() => { setShowing(show) }, [show])

    // the stage is held exactly while the card is on screen
    useEffect(() => (showing ? claimFirstRunStage() : undefined), [showing])

    // the first time this session's offer is on screen, it IS this session's offer
    const entryId = entry?.id ?? null
    useEffect(() => {
      if (!show || !entryId) return
      if (session && session.id === entryId) return
      const rec = { id: entryId, answered: false }
      writeOfferSession(rec)
      setSession(rec)
    }, [show, entryId, session])

    const answer = useCallback((accept) => {
      if (!entryId) return
      const rec = { id: entryId, answered: true }
      writeOfferSession(rec)
      setSession(rec)
      if (accept) openRegistryTour(entryId)
      else recordTourState(setPrefMerged, entryId, TOUR_STATES.dismissed, null)
    }, [entryId, setPrefMerged])
    const onAccept = useCallback(() => answer(true), [answer])
    const onLater = useCallback(() => answer(false), [answer])

    if (!show || !slot) return null
    return createPortal(
      <TourOfferCatch>
        <Suspense fallback={null}>
          <TourOfferPromptLeaf entry={entry} onAccept={onAccept} onLater={onLater} />
        </Suspense>
      </TourOfferCatch>,
      slot,
    )
  }
  return TourOfferGate
}

export default makeTourOfferGate(() => import('./TourOfferPrompt'))
