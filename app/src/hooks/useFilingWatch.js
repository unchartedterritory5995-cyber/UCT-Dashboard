import useSWR, { mutate as globalMutate } from 'swr'
import { useState, useCallback } from 'react'
import { useAuth } from '../context/AuthContext'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : { predicates: [] })

// S7 filing-watch: "Notify me about new SEC filings for {sym}" — exactly one
// trigger (document-arrival). Every creation surface (TickerPopup,
// TickerHubSheet, Research, Settings) shares this hook so "is this security
// currently watched" has one source of truth: the caller's own active-
// predicate list. No separate status endpoint — this list already answers
// the question, filtered client-side by symbol (Part F).
// active_only=false so a SUSPENDED predicate stays visible (SUSPENDED state,
// Settings' reactivate action) instead of silently vanishing from every
// surface once suspended.
const LIST_KEY = '/api/alerts/taxonomy/document-arrival?active_only=false'
const revalidate = () => globalMutate(LIST_KEY)

export default function useFilingWatch() {
  const { user } = useAuth()
  const { data, isLoading } = useSWR(user ? LIST_KEY : null, fetcher, {
    refreshInterval: 30000,
    dedupingInterval: 10000,
  })
  // sym -> 'creating' | 'suspending' | 'error' — transient, per-action UI state.
  // Never optimistic: a sym leaves this map only after the backend call
  // resolves and the list has revalidated (D2).
  const [pending, setPending] = useState({})

  const predicates = Array.isArray(data?.predicates) ? data.predicates : []

  const getWatch = useCallback((sym) => {
    const s = sym?.toUpperCase()
    if (!s) return null
    return predicates.find(p => p.entity_scope?.symbol?.toUpperCase() === s) || null
  }, [predicates])

  // NOT_WATCHING | ACTIVE | SUSPENDED | CREATING | SUSPENDING | ERROR | LOADING
  const watchState = useCallback((sym) => {
    const p = pending[sym?.toUpperCase()]
    if (p === 'creating') return 'CREATING'
    if (p === 'suspending') return 'SUSPENDING'
    if (p === 'error') return 'ERROR'
    if (isLoading) return 'LOADING'
    const w = getWatch(sym)
    if (!w) return 'NOT_WATCHING'
    return w.suspended_at ? 'SUSPENDED' : 'ACTIVE'
  }, [pending, isLoading, getWatch])

  // Same call for a fresh create AND a suspended-watch reactivation — the
  // backend's Stage-3 idempotent registration already handles both (D5/D6):
  // an active-equivalent request returns the existing predicate id, and a
  // suspended-equivalent request reactivates it. The UI never needs to know
  // which case it's in.
  const createOrReactivate = useCallback(async (sym) => {
    const s = sym?.toUpperCase()
    if (!s) return false
    setPending(p => ({ ...p, [s]: 'creating' }))
    try {
      const res = await fetch('/api/alerts/taxonomy/document-arrival', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ticker: s }),
      })
      if (!res.ok) throw new Error(`create failed: ${res.status}`)
      await revalidate()
      setPending(p => { const n = { ...p }; delete n[s]; return n })
      return true
    } catch {
      setPending(p => ({ ...p, [s]: 'error' }))
      return false
    }
  }, [])

  const suspend = useCallback(async (predicateId, sym) => {
    const s = sym?.toUpperCase()
    if (!predicateId || !s) return false
    setPending(p => ({ ...p, [s]: 'suspending' }))
    try {
      const res = await fetch(`/api/alerts/taxonomy/document-arrival/${predicateId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error(`suspend failed: ${res.status}`)
      await revalidate()
      setPending(p => { const n = { ...p }; delete n[s]; return n })
      return true
    } catch {
      setPending(p => ({ ...p, [s]: 'error' }))
      return false
    }
  }, [])

  return { predicates, getWatch, watchState, createOrReactivate, suspend, isLoading, revalidate }
}
