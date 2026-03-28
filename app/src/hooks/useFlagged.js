import { useState, useEffect, useCallback } from 'react'

const STORAGE_KEY = 'uct_flagged'
const SYNC_EVENT  = 'uct:flagged-changed'

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

  // Stay in sync across components on the same page
  useEffect(() => {
    const sync = () => setFlagged(read())
    window.addEventListener(SYNC_EVENT, sync)
    return () => window.removeEventListener(SYNC_EVENT, sync)
  }, [])

  const toggle = useCallback((sym) => {
    const prev = read()
    write(prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym])
  }, [])

  const remove = useCallback((sym) => {
    write(read().filter(s => s !== sym))
  }, [])

  // Reads fresh from localStorage — always accurate inside event handlers
  const isFlagged = useCallback((sym) => read().includes(sym), [])

  return { flagged, toggle, remove, isFlagged }
}
