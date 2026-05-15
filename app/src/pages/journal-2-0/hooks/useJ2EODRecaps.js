/**
 * SWR hook for Compass EOD recaps per account.
 * Exposes: list, generate, regenerate, feedback, forget, markViewed.
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

export default function useJ2EODRecaps(accountId) {
  const scope = compassScope(accountId)
  const url = `/api/j2/accounts/${scope}/coach/eod-recaps`
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  const base = url

  return {
    recaps: data?.recaps ?? [],
    isLoading,
    error,
    refresh: () => mutate(),
    generate: async (day) => {
      const out = await jsonPost(`${base}/generate`, day ? { day } : undefined)
      await mutate()
      return out
    },
    regenerate: async (recapId) => {
      const out = await jsonPost(`${base}/${recapId}/regenerate`)
      await mutate()
      return out
    },
    feedback: async (recapId, value) => {
      await jsonPost(`${base}/${recapId}/feedback`, { feedback: value })
      await mutate()
    },
    forget: async (recapId) => {
      await jsonPost(`${base}/${recapId}/forget`)
      await mutate()
    },
    markViewed: async (recapId) => {
      await jsonPost(`${base}/${recapId}/viewed`)
      await mutate()
    },
  }
}
