/**
 * Journal surface — legacy compatibility redirect.
 *
 * Calendar and Notebook used to be two segments of ONE grouped surface at
 * /journal/journal (?seg=calendar|notebook). They are now separate top-level
 * Journal tabs (/journal/calendar, /journal/notebook), so this route survives
 * only to forward old deep links (backlinks, shared/bookmarked URLs) onto the
 * new route, preserving every other param (note=, etc.).
 */

import { Navigate, useSearchParams } from 'react-router-dom'

export default function JournalSurface() {
  const [searchParams] = useSearchParams()
  const toNotebook = searchParams.get('seg') === 'notebook'
  const next = new URLSearchParams(searchParams)
  next.delete('seg')
  const qs = next.toString()
  const base = toNotebook ? '/journal/notebook' : '/journal/calendar'
  return <Navigate to={`${base}${qs ? `?${qs}` : ''}`} replace />
}
