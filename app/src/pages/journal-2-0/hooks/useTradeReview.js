/**
 * Trade-review hook.
 *
 * Returns: { generate, regenerate, feedback, forget, review, isLoading, error, reset }
 */
import { useState, useCallback } from 'react'

export default function useTradeReview(accountId) {
  const [review, setReview] = useState(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState(null)

  const callJson = useCallback(async (url, body) => {
    setError(null)
    const r = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
    if (!r.ok) {
      let msg = `${r.status}`
      try { const j = await r.json(); if (j?.detail) msg = j.detail } catch {}
      throw new Error(msg)
    }
    return r.json()
  }, [])

  const generate = useCallback(async (tradeId) => {
    if (!accountId || !tradeId) return null
    setIsLoading(true)
    try {
      const data = await callJson(
        `/api/j2/accounts/${accountId}/coach/trade-reviews/generate`,
        { trade_id: tradeId },
      )
      setReview(data)
      return data
    } catch (e) {
      console.error('Failed to generate trade review:', e)
      setError("Compass couldn't review this trade. Try again.")
      return null
    } finally {
      setIsLoading(false)
    }
  }, [accountId, callJson])

  const regenerate = useCallback(async (reviewId) => {
    if (!accountId || !reviewId) return null
    setIsLoading(true)
    try {
      const data = await callJson(
        `/api/j2/accounts/${accountId}/coach/trade-reviews/${reviewId}/regenerate`,
      )
      setReview(data)
      return data
    } catch (e) {
      console.error('Failed to regenerate trade review:', e)
      setError("Compass couldn't regenerate this review. Nothing was changed — try again.")
      return null
    } finally {
      setIsLoading(false)
    }
  }, [accountId, callJson])

  const feedback = useCallback(async (reviewId, value) => {
    if (!accountId || !reviewId) return
    try {
      await callJson(
        `/api/j2/accounts/${accountId}/coach/trade-reviews/${reviewId}/feedback`,
        { feedback: value },
      )
      setReview((r) => r && r.id === reviewId ? { ...r, feedback: value } : r)
    } catch (e) {
      console.error('Failed to save trade review feedback:', e)
      setError("Couldn't save your feedback. Try again.")
    }
  }, [accountId, callJson])

  const forget = useCallback(async (reviewId) => {
    if (!accountId || !reviewId) return
    try {
      await callJson(
        `/api/j2/accounts/${accountId}/coach/trade-reviews/${reviewId}/forget`,
      )
      setReview(null)
    } catch (e) {
      console.error('Failed to remove trade review:', e)
      setError("Couldn't remove this review. Try again.")
    }
  }, [accountId, callJson])

  const reset = useCallback(() => {
    setReview(null)
    setError(null)
  }, [])

  return { generate, regenerate, feedback, forget, review, isLoading, error, reset }
}
