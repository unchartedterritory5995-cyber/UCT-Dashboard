// UCT Terminal — the open board TABS, stored (behind TERMINAL_BOARD_TABS_ENABLED).
//
// The model is boardTabs.js (pure); this hook reads and writes it. It is mounted only by the
// new shell's chrome (BoardTabsChrome), so with the switch off nothing here runs and the key is
// never read or written.
//
// ⭐ ONE NEW KEY, THE SAME STORE. `terminal_board_tabs` in the member's preferences, the store
// the board on screen and the saved boards already use (useTerminalLayout). Written ONLY through
// `setPrefMerged`, the preferences' ordered write queue, as the layout is. The board on screen
// is still written by the layout hook's `save`, to `terminal_layout`, exactly as before: a tab
// switch hands the incoming tab's board to that same `save`.
//
// ⛔ A BLOB THAT CANNOT BE READ IS NEVER SAVED OVER (the layout's own rule). Unreadable tabs, a
// later build's tabs, or an unreadable board: this session runs on tabs held in memory and
// writes nothing, until the member chooses "Start with these tabs" (`startFresh`).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import usePreferences from '../../hooks/usePreferences'
import { boardSnapshot, channelSyms, openBoard, readLayout } from './boardModel'
import { TERMINAL_LAYOUT_PREF } from './boardPrefs'
import { sameExceptFocus } from './useTerminalLayout'
import {
  BOARD_TABS_KEY, OWN_NAME, TABS_FULL_TEXT, activeTab, addTab, boardSignature, clearPending, closeTab, findTab, needsHeal,
  readTabs, renameTab, retargetTab, seedTabs, selectTab, serializeTabs, sessionTabs, tabFor,
} from './boardTabs'

const COMPAT = ['A', 'B', 'C', 'D']

export default function useBoardTabs({ layout, syms, layoutStatus, library, save, setGroupSym }) {
  const { prefs, setPrefMerged, loading } = usePreferences()
  const raw = prefs?.[BOARD_TABS_KEY]
  const rawLayout = prefs?.[TERMINAL_LAYOUT_PREF]
  const read = useMemo(() => readTabs(raw), [raw])
  const layoutGuarded = layoutStatus === 'unreadable' || layoutStatus === 'newer'
  const tabsGuarded = read.status === 'unreadable' || read.status === 'newer'
  const writable = !loading && !layoutGuarded && !tabsGuarded

  // The tabs as the member has them, AHEAD of the stored blob (a write on its way). A change to
  // the stored blob this hook did not write (another device) wins: the effect below drops it.
  const [local, setLocal] = useState(null)
  // Tabs held in memory only, while nothing may be written (see the header).
  const [session, setSession] = useState(null)
  // What this hook has written and not yet seen stored (two quick writes can both be on their way).
  const inFlightRef = useRef(new Set())
  useEffect(() => {
    if (inFlightRef.current.delete(raw)) return   // one of our own writes landing
    setLocal(null)
    inFlightRef.current.clear()
  }, [raw])

  const doc = loading ? null : (writable ? (local || read.doc) : session)

  const docRef = useRef(doc)
  docRef.current = doc
  const writableRef = useRef(writable)
  writableRef.current = writable
  const layoutRef = useRef(layout)
  layoutRef.current = layout
  const symsRef = useRef(syms)
  symsRef.current = syms
  const libraryRef = useRef(library)
  libraryRef.current = library
  const rawLayoutRef = useRef(rawLayout)
  rawLayoutRef.current = rawLayout
  const saveRef = useRef(save)
  saveRef.current = save
  const setGroupSymRef = useRef(setGroupSym)
  setGroupSymRef.current = setGroupSym
  const setPrefMergedRef = useRef(setPrefMerged)
  setPrefMergedRef.current = setPrefMerged

  const write = useCallback((next) => {
    const ser = serializeTabs(next)
    inFlightRef.current.add(ser)
    // Called under its own name: tools/persistence_census.mjs finds a preference write by the
    // callee's name, and a `.current(...)` call would leave this key out of the manifest.
    const setPrefMerged = setPrefMergedRef.current
    const p = setPrefMerged(BOARD_TABS_KEY, () => ser)
    if (p && typeof p.catch === 'function') p.catch(() => {})
  }, [])

  const commit = useCallback((next) => {
    docRef.current = next
    if (!writableRef.current) { setSession(next); return }
    setLocal(next)
    write(next)
  }, [write])

  /** The board on screen, as a working copy. */
  const currentSnap = useCallback(() => boardSnapshot(layoutRef.current, symsRef.current), [])

  /** Put a board on screen through the layout hook's own `save` (and the A to D tickers it
   *  carries through the /charts groups, as opening a saved board always has). */
  const activate = useCallback((snapshot, { sym } = {}) => {
    const { layout: next, compatSyms } = openBoard(snapshot, { sym })
    for (const [ch, s] of Object.entries(compatSyms)) setGroupSymRef.current(ch, s)
    saveRef.current(next)
    return { next, compatSyms }
  }, [])

  // The switch this session made and has not yet seen stored: `{ id, raw, noop }`.
  const switchRef = useRef(null)
  /** Tabs first, then the board: the order the two-key gap is covered for (boardTabs.js). */
  const show = useCallback((nextDoc, snapshot, opts) => {
    const storedRaw = rawLayoutRef.current
    commit(nextDoc)
    const { next } = activate(snapshot, opts)
    if (nextDoc.pending) {
      switchRef.current = { id: nextDoc.pending, raw: storedRaw, noop: sameExceptFocus(next, readLayout(storedRaw).layout) }
    }
  }, [commit, activate])

  // ── first draw: seed the tabs from the board the member already has ──
  const seededRef = useRef(false)
  useEffect(() => {
    if (loading || seededRef.current) return
    if (!writable) {
      seededRef.current = true
      setSession(sessionTabs())
      return
    }
    if (read.status !== 'absent' || local) return
    seededRef.current = true
    const current = currentSnap()
    const { doc: seeded, open } = seedTabs({
      layout: layoutRef.current, syms: symsRef.current, layoutStatus, library: libraryRef.current,
    })
    if (!open) { commit(seeded); return }
    show({ ...seeded, pending: seeded.active, pendingFrom: boardSignature(current, { own: true }) || null }, open)
  }, [loading, writable, read.status, local, layoutStatus, commit, show, currentSnap])

  // ── the two-key gap (boardTabs.js): finish a switch, or mark it finished ──
  useEffect(() => {
    if (!writable || !doc?.pending) return
    const sw = switchRef.current
    if (sw && sw.id === doc.pending) {
      // This session's switch: finished once the stored board is no longer the one it replaced.
      if (sw.noop || rawLayout !== sw.raw) { switchRef.current = null; commit(clearPending(docRef.current)) }
      return
    }
    // A switch this session did not make (an earlier visit that ended in between).
    if (needsHeal(doc, boardSnapshot(readLayout(rawLayout).layout))) {
      switchRef.current = { id: doc.pending, raw: rawLayout, noop: false }
      activate(activeTab(doc).copy)
    } else commit(clearPending(doc))
  }, [writable, doc, rawLayout, commit, activate])

  /**
   * Open a board in a tab. `tab` says what it is (`{ kind, ref, sym }`); without one it is a
   * board from a list, a share link or a ticker preset. Returns `{ ok, id, reused }`, or
   * `{ ok: false, text }` when it could not open (the tab limit).
   *   * already open (a ready-made, stock or saved board): its tab is selected, working copy
   *     and all. With `sym` (a ticker preset) the board is opened again for that ticker.
   *   * a list board paged with Next / Previous replaces the list tab it came from.
   */
  const lastListTabRef = useRef(null)   // { id, name }: the tab the last list board opened in
  const open = useCallback((snapshot, { sym, name, tab = null } = {}) => {
    const cur = docRef.current
    if (!cur) { activate(snapshot, { sym }); return { ok: true, id: null, reused: false } }
    const current = currentSnap()
    const existing = tab ? tabFor(cur, tab) : null
    if (existing) {
      const here = existing.id === cur.active
      const next = here ? cur : selectTab(cur, existing.id, current).doc
      if (sym) show(next, snapshot, { sym })
      else if (!here) show(next, existing.copy || snapshot)
      return { ok: true, id: existing.id, reused: true }
    }
    const label = String(name || '').trim() || OWN_NAME
    const list = lastListTabRef.current
    if (!tab && list && list.id === cur.active && list.name === label && findTab(cur, list.id)) {
      activate(snapshot, { sym })
      return { ok: true, id: list.id, reused: true }
    }
    const { layout: nextLayout, compatSyms } = openBoard(snapshot, { sym })
    const groups = { ...Object.fromEntries(COMPAT.map((c) => [c, symsRef.current?.[c] || null])), ...compatSyms }
    const copy = boardSnapshot(nextLayout, channelSyms(nextLayout, groups))
    const res = addTab(cur, { kind: 'own', ref: null, ...(tab || {}), name: label }, copy, current)
    if (!res.ok) return { ok: false, text: TABS_FULL_TEXT }
    if (!tab) lastListTabRef.current = { id: res.id, name: label }
    show(res.doc, snapshot, { sym })
    return { ok: true, id: res.id, reused: false }
  }, [activate, currentSnap, show])

  const select = useCallback((id) => {
    const cur = docRef.current
    const to = cur && findTab(cur, id)
    if (!to || id === cur.active) return false
    const res = selectTab(cur, id, currentSnap())
    if (!res.ok) return false
    if (to.copy) show(res.doc, to.copy)
    else commit(clearPending(res.doc))   // a tab with no copy yet keeps the board on screen
    return true
  }, [commit, currentSnap, show])

  const close = useCallback((id) => {
    const cur = docRef.current
    if (!cur) return false
    const res = closeTab(cur, id, currentSnap())
    if (!res.ok) return false
    if (res.activate?.copy) show(res.doc, res.activate.copy)
    else commit(clearPending(res.doc))
    return true
  }, [commit, currentSnap, show])

  const rename = useCallback((id, name) => {
    const cur = docRef.current
    if (!cur) return false
    const next = renameTab(cur, id, name)
    if (next === cur) return false
    commit(next)
    return true
  }, [commit])

  /** The selected tab's board was saved to the member's boards: the tab is that board now. */
  const markSaved = useCallback((board) => {
    const cur = docRef.current
    if (!cur || !board) return
    commit(retargetTab(cur, cur.active, { kind: 'saved', ref: board.id, name: board.name, sym: null }))
  }, [commit])

  /** Replace the selected tab's board in place (reset to default, put it back). */
  const replaceActive = useCallback((snapshot) => { activate(snapshot) }, [activate])

  /** The member's explicit choice when the stored tabs could not be read: write these over it. */
  const startFresh = useCallback(() => {
    if (docRef.current && read.status === 'unreadable' && !layoutGuarded && !loading) write(docRef.current)
  }, [read.status, layoutGuarded, loading, write])

  return {
    doc,
    status: read.status,
    writable,
    canStartFresh: !loading && read.status === 'unreadable' && !layoutGuarded,
    open, select, close, rename, markSaved, replaceActive, startFresh, currentSnap,
  }
}
