/**
 * SWR hook for Compass weekly reviews per account.
 * Exposes: list, generate, regenerate, feedback, forget.
 */

import useSWR from 'swr'
import { compassScope } from './compassScope'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

async function jsonPost(url, body) {
  const r = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!r.ok) {
    let msg = `${r.status}`
    try {
      const data = await r.json()
      if (data?.detail) msg = data.detail
    } catch { /* ignore */ }
    throw new Error(msg)
  }
  return r.json()
}

export default function useJ2CoachReviews(accountId) {
  const scope = compassScope(accountId)
  const url = `/api/j2/accounts/${scope}/coach/weekly-reviews`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const base = url

  return {
    reviews: data?.reviews ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
    generate: async (weekStart) => {
      const out = await jsonPost(`${base}/generate`, weekStart ? { weekStart } : undefined)
      await mutate()
      return out
    },
    regenerate: async (reviewId) => {
      const out = await jsonPost(`${base}/${reviewId}/regenerate`)
      await mutate()
      return out
    },
    feedback: async (reviewId, value) => {
      await jsonPost(`${base}/${reviewId}/feedback`, { feedback: value })
      await mutate()
    },
    forget: async (reviewId) => {
      await jsonPost(`${base}/${reviewId}/forget`)
      await mutate()
    },
  }
}
