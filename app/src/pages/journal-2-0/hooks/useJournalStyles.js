// Journal styles list (P1). Used by lazy chunks only. Revalidates on focus like the property defs.
// ⛔ FAILS CLOSED ON THE SWITCH ITSELF. The hook reads the latched gate (journalStylesEnabled) on every
// render and fetches only when it is on: no caller can widen it. Any falsy `enabled` may only NARROW it
// (a surface that is not showing). With the gate off every route here answers 404, and an offline copy
// would otherwise be served as if the feature were on.
// `data.fromCache === true` means the network was down and the offline copy is being shown.
import useSWR from 'swr'
import { STYLES_URL, fetchJournalStyles } from '../lib/journalStyles'
import { journalStylesEnabled } from '../lib/journalStylesFlag'

export default function useJournalStyles({ enabled = true } = {}) {
  const on = Boolean(enabled) && journalStylesEnabled()          // omitted = on (default); null/0/'' = off
  return useSWR(on ? STYLES_URL : null, () => fetchJournalStyles(), {
    revalidateOnFocus: true, shouldRetryOnError: false,
  })
}
