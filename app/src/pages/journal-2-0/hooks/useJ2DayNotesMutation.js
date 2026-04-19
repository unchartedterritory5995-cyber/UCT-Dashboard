/**
 * Day notes mutation — upsert notes/attachments/rules for a single ET date.
 *
 * Optimistically updates the useJ2DayDetail SWR cache so the editor
 * stays in sync without a re-fetch round trip.
 */

import { useCallback, useState } from 'react'
import { useSWRConfig } from 'swr'

export default function useJ2DayNotesMutation(date) {
  const { mutate } = useSWRConfig()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const cacheKey = date ? `/api/j2/calendar/day/${date}` : null

  const save = useCallback(
    async ({ notes, attachments, rules }) => {
      if (!date) return null
      setError(null)
      setSaving(true)

      // Optimistic update
      const optimistic = { notes, attachments, rules }
      try {
        await mutate(
          cacheKey,
          async (current) => {
            const res = await fetch(`/api/j2/calendar/day/${date}/notes`, {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              credentials: 'include',
              body: JSON.stringify({ notes, attachments, rules }),
            })
            if (!res.ok) {
              const body = await res.json().catch(() => ({}))
              throw new Error(body.detail || `${res.status}`)
            }
            const saved = await res.json()
            return current
              ? { ...current, notes: saved }
              : { date, metrics: null, trades: [], notes: saved }
          },
          {
            optimisticData: (current) => (
              current
                ? { ...current, notes: optimistic }
                : { date, metrics: null, trades: [], notes: optimistic }
            ),
            rollbackOnError: true,
            revalidate: false,
          },
        )
        return true
      } catch (e) {
        setError(e)
        return false
      } finally {
        setSaving(false)
      }
    },
    [date, cacheKey, mutate],
  )

  return { save, saving, error }
}
