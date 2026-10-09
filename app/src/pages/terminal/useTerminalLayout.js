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
//
// ⭐ WRITE COST (2026-10-05 audit #19). Every layout write is a POST and — with the store armed —
// a document VERSION, so a panel click used to mint a version. Now:
//   * a FOCUS-ONLY change (the board is otherwise what is stored) is never POSTed: it is held
//     on screen and remembered per viewer (localStorage, by panel id) and rides along with the
//     next real change. An unchanged document appends no version server-side either;
//   * real changes are DEBOUNCED (`saveTiming.debounceMs`) into one write, sent through the
//     preferences' ordered write queue (`setPrefMerged`), and FLUSHED on unmount and on
//     `pagehide` / hidden, so nothing typed is lost to a closed tab.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import { FOCUS_PREF_KEY } from '../../hooks/useAppFocus'
import {
  FIRST_VISIT_SYM, channelSyms, firstVisitLayout, isGuardedStatus, normalizeLayout, normalizeLibrary,
  readLayout, readLibrary, serializeLayout,
} from './boardModel'

import { TERMINAL_BOARDS_PREF, TERMINAL_LAYOUT_PREF } from './boardPrefs'

// The two preference keys live in `boardPrefs.js` (App.jsx's /calendar wrapper reads one of them
// without loading this hook); re-exported so existing importers keep one spelling.
export { TERMINAL_BOARDS_PREF, TERMINAL_LAYOUT_PREF }
/** The viewer's focused panel (by stable id) — a per-device convenience, never a version. */
export const FOCUS_STORAGE_KEY = 'uct.terminal.focusPanel'
/** Layout writes coalesce for this long. Mutable so a test can make writes immediate (0). */
export const saveTiming = { debounceMs: 1000 }

function readFocusId() {
  try { return window.localStorage.getItem(FOCUS_STORAGE_KEY) } catch { return null }
}
function writeFocusId(id) {
  try {
    if (id) window.localStorage.setItem(FOCUS_STORAGE_KEY, id)
    else window.localStorage.removeItem(FOCUS_STORAGE_KEY)
  } catch { /* storage off */ }
}

/** Pure: the board as stored, with the viewer's remembered focus applied when that panel is
 *  still on screen. */
export function withViewerFocus(layout, focusId) {
  if (!focusId) return layout
  const i = layout.panels.slice(0, layout.count).findIndex((p) => p.id === focusId)
  return i >= 0 && i !== layout.focus ? { ...layout, focus: i } : layout
}

/** Pure: do two boards differ only in which panel is focused (or not at all)? */
export function sameExceptFocus(a, b) {
  if (!a || !b) return false
  return serializeLayout({ ...a, focus: 0 }) === serializeLayout({ ...b, focus: 0 })
}

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
  // The board as the member has it, AHEAD of the stored blob (a focus-only change, or a write
  // still inside its debounce). An outside change to the stored blob — a version restore,
  // another tab — is not something this hook wrote, and it wins (the effect below).
  const [local, setLocal] = useState(null)
  const guarded = isGuardedStatus(read.status)
  // FIRST VISIT (owner decision 2026-10-08): a member with no saved board at all opens on CAL
  // beside an SPY overview. Only once preferences have loaded, so a returning member never sees
  // it flash before their own board. Nothing is written by opening; the first real change
  // saves the board and, if group A is still empty, fills it with SPY so the overview keeps it.
  const fresh = !loading && read.status === 'absent'
  const stored = useMemo(() => withViewerFocus(fresh ? firstVisitLayout() : read.layout, readFocusId()),
    [read.layout, fresh])
  const layout = guarded && session ? session : (local || stored)
  const shownGroups = useMemo(() => (fresh && !groups.A ? { ...groups, A: FIRST_VISIT_SYM } : groups),
    [fresh, groups])
  const syms = useMemo(() => channelSyms(layout, shownGroups), [layout, shownGroups])

  const loadingRef = useRef(loading)
  loadingRef.current = loading
  const guardedRef = useRef(guarded)
  guardedRef.current = guarded
  const storedRef = useRef(stored)
  storedRef.current = stored
  const seedRef = useRef(false)            // first visit: group A still needs its SPY written
  seedRef.current = fresh && !groups.A
  const writtenRef = useRef(undefined)     // the blob this hook last wrote
  const writtenLayoutRef = useRef(null)    // …and the board it encodes
  const pendingRef = useRef(null)          // a blob waiting out the debounce
  const timerRef = useRef(null)
  const setPrefMergedRef = useRef(setPrefMerged)
  setPrefMergedRef.current = setPrefMerged

  useEffect(() => {
    if (rawLayout === writtenRef.current) return
    setLocal(null)
    writtenRef.current = undefined
    writtenLayoutRef.current = null
    pendingRef.current = null
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
  }, [rawLayout])

  const flush = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null }
    const ser = pendingRef.current
    if (ser == null) return
    pendingRef.current = null
    writtenRef.current = ser
    writtenLayoutRef.current = readLayout(ser).layout
    // The ordered write queue: one POST per key at a time, so arrival order = write order.
    const p = setPrefMergedRef.current(TERMINAL_LAYOUT_PREF, () => ser)
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }, [])

  // Never lose a pending write: flush on unmount, on pagehide, and when the tab is hidden.
  useEffect(() => {
    const onHide = () => flush()
    const onVis = () => { if (document.visibilityState === 'hidden') flush() }
    window.addEventListener('pagehide', onHide)
    document.addEventListener('visibilitychange', onVis)
    return () => {
      window.removeEventListener('pagehide', onHide)
      document.removeEventListener('visibilitychange', onVis)
      flush()
    }
  }, [flush])

  const save = useCallback((next) => {
    // Hydration gate (IA §15 rule 5): nothing persists before the stored board has been read.
    if (loadingRef.current) return false
    const normalized = normalizeLayout(next)
    if (guardedRef.current) { setSession(normalized); return false }
    writeFocusId(normalized.panels[normalized.focus]?.id || null)
    setLocal(normalized)
    const ser = serializeLayout(normalized)
    // A write already waiting takes the newest board (focus included) on its existing timer.
    if (pendingRef.current != null) { pendingRef.current = ser; return true }
    // Focus-only against what is stored: nothing to write, no version to mint.
    if (sameExceptFocus(normalized, writtenLayoutRef.current || storedRef.current)) return true
    if (seedRef.current) {
      // The first board a new member saves keeps the SPY its overview was showing. Merged, and
      // only into an EMPTY group A: a ticker the member's own command set wins in either order.
      seedRef.current = false
      const p = setPrefMergedRef.current(FOCUS_PREF_KEY, (cur) => {
        const base = cur && typeof cur === 'object' ? cur : {}
        return base.A ? undefined : { ...base, A: FIRST_VISIT_SYM }
      })
      if (p && typeof p.catch === 'function') p.catch(() => {})
    }
    pendingRef.current = ser
    if (!(saveTiming.debounceMs > 0)) { flush(); return true }
    timerRef.current = setTimeout(flush, saveTiming.debounceMs)
    return true
  }, [flush])

  /** The member's explicit "start fresh": write the board on screen over the unreadable one.
   *  The blob it replaces is kept by the versioned store as the version before (when armed). */
  const replaceStoredLayout = useCallback(() => {
    if (loadingRef.current) return
    const ser = serializeLayout(session || read.layout)
    writtenRef.current = ser
    writtenLayoutRef.current = readLayout(ser).layout
    setPref('terminal_layout', ser)
    setSession(null)
  }, [read.layout, session, setPref])

  const saveLibrary = useCallback((next) => {
    if (loadingRef.current || isGuardedStatus(libRead.status)) return false
    setPref('terminal_boards', JSON.stringify(normalizeLibrary(next)))
    return true
  }, [libRead.status, setPref])

  const setGroupSym = useCallback((group, sym) => {
    // FIX 4: an empty/null `sym` is a real instruction — clear the channel back to
    // unlinked (e.g. `revertLayout` restoring a previously-unlinked channel over a
    // board-injected ticker) — never dropped as if it were a no-op call.
    const s = String(sym || '').trim().toUpperCase()
    if (!['A', 'B', 'C', 'D'].includes(group)) return
    // Merge, never replace: the other letters are /charts' live comparison slots.
    setPrefMerged(FOCUS_PREF_KEY, (cur) => {
      const base = cur && typeof cur === 'object' ? cur : {}
      const next = s || undefined
      if ((base[group] || undefined) === next) return undefined   // no-op writes cost a POST
      const out = { ...base }
      if (next) out[group] = next
      else delete out[group]
      return out
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
