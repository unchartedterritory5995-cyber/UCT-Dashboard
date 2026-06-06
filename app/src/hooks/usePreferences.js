import useSWR from 'swr'
import { useCallback } from 'react'

const fetcher = url => fetch(url).then(r => r.ok ? r.json() : {})

const DEFAULTS = {
  default_chart_tf: 'D',
  theme: 'midnight',
}

// Preferences are stored server-side as TEXT. Reads can therefore come back as
// a JSON string (the normal case) OR — from the optimistic cache below — as an
// already-parsed object/array. Parse defensively and fall back on bad input.
export function parsePref(raw, fallback) {
  if (raw == null) return fallback
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return fallback }
}

export default function usePreferences() {
  const { data, mutate, isLoading } = useSWR('/api/auth/preferences', fetcher, {
    dedupingInterval: 300000, // 5 min
    revalidateOnFocus: false,
  })

  // Merge server prefs over defaults
  const prefs = { ...DEFAULTS, ...(data || {}) }

  const setPref = useCallback(async (key, value) => {
    // The backend's SetPreferenceRequest types `value` as a str, so an
    // object/array would be rejected with a 422. Coerce non-strings to JSON
    // here so callers can pass structured values transparently (read them
    // back with parsePref).
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    // Optimistic update
    mutate(prev => ({ ...DEFAULTS, ...prev, [key]: serialized }), false)
    try {
      await fetch('/api/auth/preferences', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: serialized }),
      })
    } catch {
      // Revert on failure
      mutate()
    }
  }, [mutate])

  return { prefs, setPref, loading: isLoading }
}
