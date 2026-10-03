// UCT Terminal — the board on screen, the member's board library, and the security LINK.
//
// ⭐ PERSISTENCE (lane T2 / V2). Two preference keys, both ADDITIONS (no key renamed or
// re-shaped under a reader, coexistence MG-4), both allow-listed in
// `api/routers/auth.py::_PREFERENCE_KEYS`, and both versioned as the TERM-021 `terminal`
// board (`api/services/workspace_doc_store.py::TERMINAL_PREF_KEYS`, re-derived from the
// `*_PREF` exports below by `tests/test_workspace_doc_terminal_board.py`). While that store is
// armed every write here is also a document version, and read-new serves the document head —
// so a bad blob is recoverable from Version history instead of being lost.
//
// ⛔ A BLOB THAT CANNOT BE READ IS NEVER SAVED OVER (IA §2 #7 / §15 rule 4). `readLayout`
// says `unreadable` (or `newer`, a later build's shape); the shell then runs on a SESSION
// layout (the default, editable) and writes nothing until the member chooses "Start fresh"
// (`replaceStoredLayout`) or restores an earlier version.
//
// ⭐ THE LINK. A–D channels are the /charts colour groups: their security is
// `charts_workspace_groups` (`useAppFocus.FOCUS_PREF_KEY`), one value with /charts and the
// app focus. Channels E and later keep their security in the layout's channel record.
import { useCallback, useMemo, useRef, useState } from 'react'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import { FOCUS_PREF_KEY } from '../../hooks/useAppFocus'
import {
  channelSyms, isGuardedStatus, normalizeLayout, normalizeLibrary, readLayout, readLibrary,
  serializeLayout,
} from './boardModel'

export const TERMINAL_LAYOUT_PREF = 'terminal_layout'
export const TERMINAL_BOARDS_PREF = 'terminal_boards'

// Re-exported so existing importers (functions.rail.test.js pins these) keep one source.
export {
  DEFAULT_LAYOUT, GROUP_DOT, LAYOUT_VERSION, LINK_GROUPS, PANEL_COUNTS, panelSym,
} from './boardModel'

/** The letter after `g` in the /charts vocabulary (A B C D N), kept for v1 callers. */
export function nextGroup(g) {
  const order = ['A', 'B', 'C', 'D', 'N']
  const i = order.indexOf(g)
  return order[(i + 1) % order.length]
}

export default function useTerminalLayout() {
  const { prefs, setPref, setPrefMerged, loading } = usePreferences()
  const rawLayout = prefs?.[TERMINAL_LAYOUT_PREF]
  const rawLibrary = prefs?.[TERMINAL_BOARDS_PREF]
  const read = useMemo(() => readLayout(rawLayout), [rawLayout])
  const libRead = useMemo(() => readLibrary(rawLibrary), [rawLibrary])
  const groups = useMemo(() => parsePref(prefs?.[FOCUS_PREF_KEY], null) || {}, [prefs])

  // A session-only layout while the stored one cannot be read: edits show, nothing is written.
  const [session, setSession] = useState(null)
  const guarded = isGuardedStatus(read.status)
  const layout = guarded && session ? session : read.layout
  const syms = useMemo(() => channelSyms(layout, groups), [layout, groups])

  const loadingRef = useRef(loading)
  loadingRef.current = loading
  const guardedRef = useRef(guarded)
  guardedRef.current = guarded

  const save = useCallback((next) => {
    // Hydration gate (IA §15 rule 5): nothing persists before the stored board has been read.
    if (loadingRef.current) return false
    const normalized = normalizeLayout(next)
    if (guardedRef.current) { setSession(normalized); return false }
    setPref(TERMINAL_LAYOUT_PREF, serializeLayout(normalized))
    return true
  }, [setPref])

  /** The member's explicit "start fresh": write the board on screen over the unreadable one.
   *  The blob it replaces is kept by the versioned store as the version before (when armed). */
  const replaceStoredLayout = useCallback(() => {
    if (loadingRef.current) return
    setPref(TERMINAL_LAYOUT_PREF, serializeLayout(session || read.layout))
    setSession(null)
  }, [read.layout, session, setPref])

  const saveLibrary = useCallback((next) => {
    if (loadingRef.current || isGuardedStatus(libRead.status)) return false
    setPref(TERMINAL_BOARDS_PREF, JSON.stringify(normalizeLibrary(next)))
    return true
  }, [libRead.status, setPref])

  const setGroupSym = useCallback((group, sym) => {
    const s = String(sym || '').trim().toUpperCase()
    if (!s || !['A', 'B', 'C', 'D'].includes(group)) return
    // Merge, never replace: the other letters are /charts' live comparison slots.
    setPrefMerged(FOCUS_PREF_KEY, (cur) => {
      const base = cur && typeof cur === 'object' ? cur : {}
      if (base[group] === s) return undefined          // no-op writes cost a POST
      return { ...base, [group]: s }
    })
  }, [setPrefMerged])

  return {
    layout,
    layoutStatus: read.status,
    groups,
    syms,
    save,
    replaceStoredLayout,
    library: libRead.library,
    libraryStatus: libRead.status,
    saveLibrary,
    setGroupSym,
    loading,
  }
}
