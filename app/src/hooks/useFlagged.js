import { useState, useEffect, useCallback, useRef } from 'react'
import { useAuth } from '../context/AuthContext'

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
  const { user } = useAuth()
  const timerRef = useRef(null)
  const mountedRef = useRef(true)

  // Stay in sync across components on the same page
  useEffect(() => {
    const sync = () => setFlagged(read())
    window.addEventListener(SYNC_EVENT, sync)
    return () => window.removeEventListener(SYNC_EVENT, sync)
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
      const defaultPrefix = `Flagged (${user.display_name || 'You'})`
      if (data.name && data.name !== defaultPrefix) {
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

  // Reads fresh from localStorage — always accurate inside event handlers
  const isFlagged = useCallback((sym) => read().includes(sym), [])

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

  return { flagged, toggle, remove, isFlagged, isShared, toggleShare, flaggedName, renameFlagged }
}
