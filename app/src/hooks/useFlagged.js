import { useState, useEffect, useCallback, useMemo, useRef, useContext } from 'react'
import { AuthContext } from '../context/AuthContext'

const STORAGE_KEY = 'uct_flagged'
const SYNC_EVENT  = 'uct:flagged-changed'
const DEBOUNCE_MS = 300

// Module-level dedupe — every useFlagged instance shares these. Without them
// a page with N TickerPopups (e.g. breadth drill-list with 60+ rows) fired
// N parallel GET /flagged + N parallel POST /flagged/sync on mount, blowing
// past Chrome's parallel-stream cap and producing ERR_INSUFFICIENT_RESOURCES
// for unrelated requests on the page.
let _flaggedGetInflight = null   // shared Promise for /api/watchlists/flagged
let _initialSyncSent = false     // initial syncToServer fires at most once per page

function read() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') }
  catch { return [] }
}

function write(arr) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(arr))
  window.dispatchEvent(new Event(SYNC_EVENT))
}

export function useFlagged() {
  const [flagged, setFlagged] = useState(read)
  const [isShared, setIsShared] = useState(false)
  const [flaggedName, setFlaggedName] = useState(null) // null = use default
  // Defensive: `useContext` (not `useAuth`) so a consumer rendered outside an
  // AuthProvider — e.g. a unit test of a result row — gets `user = undefined`
  // and the server-sync guards below simply no-op, instead of throwing. In the
  // app this is always inside the provider, so behaviour is unchanged.
  const ctx = useContext(AuthContext)
  const user = ctx?.user
  const timerRef = useRef(null)
  const mountedRef = useRef(true)

  // Stay in sync across components on the same page — and across TABS.
  //
  // `SYNC_EVENT` is a same-window custom event, so it never crossed tabs. That was
  // survivable while `isFlagged` re-read localStorage on every call: a star drawn
  // in this tab would eventually reflect another tab's write, even though the
  // `flagged` ARRAY driving the Flagged list stayed stale — an inconsistency, but
  // a quiet one. Now that both read from the same state, the browser's own
  // `storage` event (which fires only in the OTHER tabs) closes it properly
  // instead of leaving half the UI fresh and half stale.
  useEffect(() => {
    const sync = () => setFlagged(read())
    const onStorage = (e) => { if (!e.key || e.key === STORAGE_KEY) sync() }
    window.addEventListener(SYNC_EVENT, sync)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener(SYNC_EVENT, sync)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  // Cleanup
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  // Debounced server sync
  const syncToServer = useCallback(() => {
    if (!user) return
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const symbols = read()
      fetch('/api/watchlists/flagged/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols }),
      }).catch(() => {})  // fire-and-forget
    }, DEBOUNCE_MS)
  }, [user])

  // On mount (when logged in): fetch server state + initial sync. Both calls
  // are module-level deduped so N concurrent useFlagged consumers (one per
  // TickerPopup, dozens-to-hundreds on a populated drill-list) make at most
  // ONE network request per page.
  useEffect(() => {
    if (!user) return
    if (!_flaggedGetInflight) {
      _flaggedGetInflight = fetch('/api/watchlists/flagged')
        .then(r => r.json())
        .catch(() => null)
    }
    _flaggedGetInflight.then(data => {
      if (!data || !mountedRef.current) return
      setIsShared(!!data.is_public)
      // Auto-generated names (the plain "Flagged", or the legacy "Flagged (Name)"
      // some accounts still have stored) are treated as "no custom name" → the UI
      // shows a clean "Flagged". Only a genuinely user-chosen name is surfaced.
      const autoNames = ['Flagged', `Flagged (${user.display_name || 'You'})`]
      if (data.name && !autoNames.includes(data.name)) {
        setFlaggedName(data.name)
      }
    })
    if (!_initialSyncSent) {
      _initialSyncSent = true
      syncToServer()
    }
  }, [user, syncToServer])

  const toggle = useCallback((sym) => {
    const prev = read()
    write(prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym])
    syncToServer()
  }, [syncToServer])

  const remove = useCallback((sym) => {
    write(read().filter(s => s !== sym))
    syncToServer()
  }, [syncToServer])

  // Clear every flag at once — used after the screener moves a flagged batch into
  // a watchlist, so the staging set empties in one write (not N events).
  const clearAll = useCallback(() => {
    write([])
    syncToServer()
  }, [syncToServer])

  // ⛔ THIS IS CALLED ONCE PER ROW, PER RENDER, AND THE LIST RE-RENDERS EVERY
  // QUOTE TICK. It used to be `read().includes(sym)` — a `localStorage.getItem`
  // plus a `JSON.parse` plus an O(k) scan, per row. On a 1,872-row Russell 2000
  // that is ~1,900 synchronous storage reads and parses PER SECOND, on the main
  // thread, re-deriving a value that had not changed.
  //
  // The `flagged` state above is already the same array, kept in sync by the
  // SYNC_EVENT listener and by every writer in this hook — so a Set derived from
  // it answers identically without touching storage. The membership test is now
  // O(1) and the parse happens once per actual change.
  //
  // ⚠️ The old comment said "reads fresh from localStorage — always accurate
  // inside event handlers". It stays accurate: `write()` dispatches SYNC_EVENT
  // synchronously, and the listener calls `setFlagged(read())`, so state and
  // storage never diverge across a render boundary. What a stale read could
  // previously catch — another TAB's write — is handled by the `storage` listener
  // added above, which keeps the array and the membership test equally fresh.
  const flaggedSet = useMemo(() => new Set(flagged), [flagged])
  const isFlagged = useCallback((sym) => flaggedSet.has(sym), [flaggedSet])

  const toggleShare = useCallback(() => {
    if (!user) return
    const next = !isShared
    setIsShared(next)
    fetch('/api/watchlists/flagged/share', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_public: next }),
    }).catch(() => {
      // Revert on failure
      if (mountedRef.current) setIsShared(!next)
    })
  }, [user, isShared])

  const renameFlagged = useCallback((newName) => {
    if (!user) return
    const trimmed = newName.trim()
    if (!trimmed) return
    setFlaggedName(trimmed)
    fetch('/api/watchlists/flagged/rename', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: trimmed }),
    }).catch(() => {})
  }, [user])

  return { flagged, toggle, remove, clearAll, isFlagged, isShared, toggleShare, flaggedName, renameFlagged }
}
