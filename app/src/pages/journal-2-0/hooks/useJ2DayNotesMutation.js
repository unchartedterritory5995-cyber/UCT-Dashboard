/**
 * Day notes mutation — upsert notes/attachments/rules for a single ET date.
 *
 * Optimistically updates every cached useJ2DayDetail entry for that date so the editor stays in sync
 * without a re-fetch round trip.
 *
 * ⛔ It sends ALL SIX fields. Until 2026-10-17 it forwarded only {notes, attachments, rules}, the server
 * wrote the missing narrative keys as "", and every save from the day page (a reflection edit, an
 * attachment, a rule tick) blanked prep, mid-day and recap. The server now keeps a key that is left out
 * (calendar.upsert_day_notes), but a field that is present is still the member's word, so nothing here
 * may drop one.
 *
 * ⛔ The day detail's SWR key carries the account and basis query (useJ2DayDetail), so the cache entry the
 * page reads is `/api/j2/calendar/day/<date>?account_id=…&basis=…`, never the bare path. Updates go to
 * every key for this date through a key filter.
 */

import { useCallback, useState } from 'react'
import { useSWRConfig } from 'swr'

export const DAY_NOTE_FIELDS = Object.freeze(['notes', 'prepNotes', 'midDayNotes', 'recapNotes', 'attachments', 'rules'])

/** The fields the caller passed, and only those (an undefined field is left out, so the server keeps it). */
export function dayNotesBody(input) {
  const body = {}
  for (const k of DAY_NOTE_FIELDS) {
    if (input && input[k] !== undefined) body[k] = input[k]
  }
  return body
}

/** True for the bare day path and for any query-string variant of it. */
export function isDayDetailKey(key, date) {
  if (typeof key !== 'string' || !date) return false
  const base = `/api/j2/calendar/day/${date}`
  return key === base || key.startsWith(`${base}?`)
}

export default function useJ2DayNotesMutation(date) {
  const { mutate } = useSWRConfig()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const save = useCallback(
    async (input) => {
      if (!date) return null
      setError(null)
      setSaving(true)
      const body = dayNotesBody(input)
      const matches = (key) => isDayDetailKey(key, date)
      const withNotes = (patch) => (current) => (
        current ? { ...current, notes: { ...(current.notes || {}), ...patch } } : current
      )
      try {
        // Optimistic: every cached view of this day shows the edit at once.
        await mutate(matches, withNotes(body), { revalidate: false })
        const res = await fetch(`/api/j2/calendar/day/${date}/notes`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(body),
        })
        if (!res.ok) {
          const detail = await res.json().catch(() => ({}))
          throw new Error(detail.detail || `${res.status}`)
        }
        const saved = await res.json()
        await mutate(matches, withNotes(saved), { revalidate: false })
        return true
      } catch (e) {
        setError(e)
        // Roll back by reading the server's copy again for every view of this day.
        await mutate(matches)
        return false
      } finally {
        setSaving(false)
      }
    },
    [date, mutate],
  )

  return { save, saving, error }
}
