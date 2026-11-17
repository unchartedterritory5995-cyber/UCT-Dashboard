// The scan board's state for one page (boardModel.js holds the rules). Read once from the member's
// preferences when they have answered, kept in React state, and written back 500 ms after the last
// change (a drag fires many). Nothing is written before the preferences were read, and nothing at
// all when the read failed: a board drawn from defaults must never replace a stored one.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../../../hooks/usePreferences'
import * as model from './boardModel'
// Imported by name (not through `model`) so the server's preference-key rail can read which key
// this file writes (tests/test_preference_key_validation.py).
import { BOARD_PREF } from './boardModel'

const SAVE_MS = 500

export default function useScanBoard(enabled) {
  const { prefs, setPref, loading, readFailed } = usePreferences()
  const stored = prefs?.[BOARD_PREF]
  // When the preferences have already answered (the usual case: the app read them at sign-in), the
  // board opens straight on the stored layout, with no first frame on the default preset.
  const [ready] = useState(() => !!enabled && !loading && !readFailed)
  const [state, setState] = useState(() => model.sanitize(ready ? stored : null))
  // Customize is where the member is right now, not part of the layout: it is never stored.
  const [edit, setEdit] = useState(false)
  const stateRef = useRef(state)
  const hydrated = useRef(ready)
  const timer = useRef(null)
  const dirty = useRef(false)
  const writeRef = useRef(null)
  // The write, kept current for the timer and the unmount flush (both outlive the render that armed them).
  useEffect(() => {
    writeRef.current = () => {
      if (!dirty.current || !hydrated.current || readFailed) return
      dirty.current = false
      setPref(BOARD_PREF, model.serialize(stateRef.current))
    }
  })
  useEffect(() => {
    if (!enabled || hydrated.current || loading || readFailed) return
    hydrated.current = true
    if (stored == null || dirty.current) return
    const next = model.sanitize(stored)
    stateRef.current = next
    // Once per mount, when an external store (the preferences) answers.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setState(next)
  }, [enabled, loading, readFailed, stored])
  useEffect(() => () => { clearTimeout(timer.current); writeRef.current?.() }, [])

  const apply = useCallback((fn, ...args) => {
    const next = fn(stateRef.current, ...args)
    if (next === stateRef.current) return false
    stateRef.current = next
    setState(next)
    dirty.current = true
    clearTimeout(timer.current)
    timer.current = setTimeout(() => writeRef.current?.(), SAVE_MS)
    return true
  }, [])

  const api = useMemo(() => ({
    pickLayout: id => apply(model.pickLayout, id),
    acceptArrangement: (widgets, movedId, wasMove) => apply(model.acceptArrangement, widgets, movedId, wasMove),
    setRows: rows => apply(model.setRows, rows),
    addWidget: type => apply(model.addWidget, type),
    removeWidget: id => apply(model.removeWidget, id),
    saveMine: name => apply(model.saveMine, name, `m-${Date.now().toString(36)}`),
    updateMine: id => apply(model.updateMine, id),
    deleteMine: id => apply(model.deleteMine, id),
    adoptLayout: (name, widgets) => apply(model.adoptLayout, name, widgets, `m-${Date.now().toString(36)}`),
    setOption: (key, value) => apply(model.setOption, key, value),
    setEdit,
  }), [apply])

  const board = useMemo(() => (enabled ? { ...state, edit } : null), [enabled, state, edit])
  return [board, api]
}
