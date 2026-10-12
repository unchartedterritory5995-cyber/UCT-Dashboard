// Journal styles list (P1). Used by lazy chunks only. Revalidates on focus like the property defs.
// `enabled` is the caller's gate (pass journalStylesEnabled()): with it false no request is made.
// `data.fromCache === true` means the network was down and the offline copy is being shown.
import useSWR from 'swr'
import { STYLES_URL, fetchJournalStyles } from '../lib/journalStyles'

export default function useJournalStyles({ enabled = true } = {}) {
  return useSWR(enabled ? STYLES_URL : null, () => fetchJournalStyles(), {
    revalidateOnFocus: true, shouldRetryOnError: false,
  })
}
