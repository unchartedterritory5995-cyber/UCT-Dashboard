// app/src/components/research/sections/useArchiveTicker.js
//
// ONE read of the trader archive for a ticker, shared by every research surface that shows it:
// the Catalysts tab's "What the traders said", the Setup canvas's team-read tile, the earnings
// history's "the team around these reports", the Overview card and the Terminal WHO panel.
// They all ask the SAME SWR key, so a ticker costs one request however many of them mount.
//
// ⛔ A 404 (archive flag off) and a 402 (no paid plan) arrive as `error` with a `status`. Every
// surface but the Terminal panel renders nothing for them; the panel, being the whole view,
// says which one it is. Neither is "the team never mentioned it".
import useSWR from 'swr'

import { ARCHIVE_API } from '../../../utils/traderArchive'
import { sectionFetcher } from './sectionFetch'

/** The SWR key. Exported so a test (or a second reader) asks the same key, never a lookalike. */
export const archiveTickerKey = (sym) => {
  const s = (sym || '').toUpperCase().trim()
  return s ? `${ARCHIVE_API}/ticker/${encodeURIComponent(s)}?limit=500` : null
}

export const ARCHIVE_SWR_OPTS = Object.freeze({ revalidateOnFocus: false, shouldRetryOnError: false })

export default function useArchiveTicker(sym) {
  const { data, error } = useSWR(archiveTickerKey(sym), sectionFetcher, ARCHIVE_SWR_OPTS)
  return { data, error }
}

/** Calls in the payload, newest posted first. */
export function newestCalls(data) {
  const calls = Array.isArray(data?.calls) ? data.calls : []
  return [...calls].sort((a, b) => String(b.posted || '').localeCompare(String(a.posted || '')))
}
