/**
 * Pre-Trade Verdict hook — one-shot POST, no SWR caching.
 *
 * Returns: { run, verdict, isLoading, error, reset }
 *
 * A 429 is the member's daily verdict limit, and its `detail` is a sentence
 * written for them ("You've hit today's limit ... resets at midnight ET"), so
 * it is shown verbatim. Every other failure keeps the generic line: a 4xx/5xx
 * detail is not guaranteed to be member-readable.
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
        const err = new Error(msg)
        err.memberFacing = r.status === 429 && typeof msg === 'string' && msg !== `${r.status}`
        throw err
      }
      const data = await r.json()
      setVerdict(data)
      return data
    } catch (e) {
      console.error('Failed to get pre-trade verdict:', e)
      setError(e?.memberFacing ? e.message : "Compass couldn't grade this trade. Try again.")
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
