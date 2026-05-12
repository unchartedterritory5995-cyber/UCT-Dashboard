/**
 * Pre-Trade Verdict hook — one-shot POST, no SWR caching.
 *
 * Returns: { run, verdict, isLoading, error, reset }
 */
import { useState, useCallback } from 'react'

export default function usePreTradeVerdict(accountId) {
  const [verdict, setVerdict] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const run = useCallback(async (params) => {
    if (!accountId) return
    setIsLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/j2/accounts/${accountId}/coach/pre-trade-verdict`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!r.ok) {
        let msg = `${r.status}`
        try { const j = await r.json(); if (j?.detail) msg = j.detail } catch {}
        throw new Error(msg)
      }
      const data = await r.json()
      setVerdict(data)
      return data
    } catch (e) {
      setError(String(e.message || e))
      return null
    } finally {
      setIsLoading(false)
    }
  }, [accountId])

  const reset = useCallback(() => {
    setVerdict(null)
    setError(null)
  }, [])

  return { run, verdict, isLoading, error, reset }
}
