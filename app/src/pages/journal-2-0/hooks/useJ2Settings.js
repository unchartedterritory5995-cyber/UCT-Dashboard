/**
 * Journal 2.0 — settings hook.
 *
 * Wraps SWR around GET /api/j2/settings and exposes a mutation for
 * PUT /api/j2/settings. The server seeds defaults on first read, so
 * the hook always returns a usable `settings` object once the user
 * is authenticated (never null after first resolve).
 */

import useSWR from 'swr'
import { useCallback } from 'react'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

/**
 * @returns {{
 *   settings: any,
 *   isLoading: boolean,
 *   error: any,
 *   save: (payload: any) => Promise<any>,
 *   refresh: () => Promise<any>,
 * }}
 */
export default function useJ2Settings() {
  const { data, error, isLoading, mutate } = useSWR('/api/j2/settings', fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })

  const save = useCallback(
    async (payload) => {
      const res = await fetch('/api/j2/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const body = await res.text()
        throw new Error(body || `save failed (${res.status})`)
      }
      const saved = await res.json()
      // Replace SWR cache with the server's canonical response (enabled
      // invariant, dedupe, etc.) without re-fetching.
      await mutate(saved, { revalidate: false })
      return saved
    },
    [mutate],
  )

  return {
    settings: data,
    isLoading,
    error,
    save,
    refresh: () => mutate(),
  }
}
