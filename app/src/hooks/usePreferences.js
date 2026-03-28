import useSWR from 'swr'
import { useCallback } from 'react'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : {})

const DEFAULTS = {
  default_chart_tf: 'D',
  theme: 'midnight',
}

export default function usePreferences() {
  const { data, mutate, isLoading } = useSWR('/api/auth/preferences', fetcher, {
    dedupingInterval: 300000, // 5 min
    revalidateOnFocus: false,
  })

  // Merge server prefs over defaults
  const prefs = { ...DEFAULTS, ...(data || {}) }

  const setPref = useCallback(async (key, value) => {
    // Optimistic update
    mutate(prev => ({ ...DEFAULTS, ...prev, [key]: value }), false)
    try {
      await fetch('/api/auth/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      })
    } catch {
      // Revert on failure
      mutate()
    }
  }, [mutate])

  return { prefs, setPref, loading: isLoading }
}
