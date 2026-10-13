/**
 * Log Trade's pre-entry checklist, the dialog's half (Notebook P2a, Task 8; fix round 1, R-T8-1).
 * AddPositionModal and AddTradeModal each call this once. It owns the switch (the `preEntryChecklist`
 * prop only the two Log Trade doors pass, the journal styles switch and the member's preference),
 * the ticks, and the one save after the row exists. The body (components/LogTradeChecklist.jsx)
 * renders the list; lib/blocks/logTradeChecklist.js is the one file that writes.
 *
 * ⛔ A checklist is the member's own discipline record:
 *   - `ticked` keeps every tick, other setups' included (R-T7-2 I-2); only the ticks of the items on
 *     screen are sent;
 *   - I-1: "touched" is per SETUP LIST. A list is answered only once the member ticked or unticked a
 *     box in it; the setup on screen at log time must be one of those, or nothing is written (an
 *     untouched list is no answer, never "0 of N"; owner question O-7);
 *   - nothing is written without the id of a row the server created;
 *   - a failed write leaves the trade logged and says why; "Try again" is offered only where another
 *     try could answer differently (no answer, a timeout, a 5xx), and re-sends the SAME save.
 *
 * `isOpen()` is false once this dialog has unmounted: the dialogs skip a trailing close then (N-2).
 * @returns {{ on: boolean, slotProps: object, notSaved: string, canRetry: boolean, retrying: boolean,
 *             isOpen: () => boolean,
 *             saveFor: (created: object, setupForRecord: string|null) => Promise<boolean>,
 *             retry: () => Promise<boolean> }}
 *   `saveFor` and `retry` resolve true when the dialog may close.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import { journalStylesEnabled } from '../lib/journalStylesFlag'
import { checklistMode, notSavedLine, saveTicksResult, ticksToSave } from '../lib/blocks/logTradeChecklist'

const NO_IDS = []
const sameIds = (a, b) => a.length === b.length && a.every((x, i) => x === b[i])

export default function useLogTradeChecklist({ preEntryChecklist, kind, setup }) {
  const ask = !!preEntryChecklist && journalStylesEnabled()
  const { prefs } = usePreferences(ask)
  const mode = checklistMode(prefs)
  const on = ask && mode.show
  const [ticked, setTicked] = useState(NO_IDS)
  const [touchedSetups, setTouchedSetups] = useState(NO_IDS)
  const [itemIds, setItemIds] = useState(NO_IDS)
  const [notSaved, setNotSaved] = useState('')
  const [pending, setPending] = useState(null)   // the exact save "Try again" repeats, or null
  const [retrying, setRetrying] = useState(false)
  // N-2 (R-T8-2): a save or retry that settles after THIS dialog closed must not close the next one
  // (the door's onClose is `setModal(null)`, which would close whatever dialog is open by then).
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const isOpen = useCallback(() => mounted.current, [])

  const onChange = useCallback((next) => {
    setTicked(next)
    setTouchedSetups((prev) => (prev.includes(setup) ? prev : [...prev, setup]))
  }, [setup])
  const onItems = useCallback((ids) => setItemIds((prev) => (sameIds(prev, ids) ? prev : ids)), [])

  const settle = useCallback((save, result) => {
    if (result.ok) return true
    setNotSaved(notSavedLine(result.reason))
    setPending(result.retryable ? save : null)
    return false
  }, [])

  const saveFor = useCallback(async (created, setupForRecord) => {
    if (!on || !touchedSetups.includes(setup) || itemIds.length === 0 || created?.id == null) return true
    const { checked, total } = ticksToSave({ ticked, itemIds })
    const save = { kind, id: created.id, setup: setupForRecord, checked, total }
    return settle(save, await saveTicksResult(save))
  }, [on, touchedSetups, setup, itemIds, ticked, kind, settle])

  const retry = useCallback(async () => {
    if (!pending) return false
    setRetrying(true)
    try {
      return settle(pending, await saveTicksResult(pending))
    } finally {
      setRetrying(false)
    }
  }, [pending, settle])

  return {
    on,
    // N-4 (P2b Task 8): `touched` lets the body show a carried rule tick only on a list that will save it.
    slotProps: {
      setup, requireAll: mode.requireAll, checked: ticked, onChange, onItems, disabled: !!notSaved,
      touched: touchedSetups.includes(setup),
    },
    isOpen,
    notSaved,
    canRetry: !!pending,
    retrying,
    saveFor,
    retry,
  }
}
