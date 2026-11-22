/** Wave H — the Notebook's one aggregated "home" read (checkpoint decision 14). Research home was its first reader;
 *  since go-live wave 1 the Daily brief reads its "Needs review" and "Notes on your open positions" sections, and the
 *  get-started list reads it too. */
import useSWR from 'swr'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

const EMPTY = { continueWorking: [], favorites: [], activeTheses: [], openPositionResearch: [], needsReview: [] }

/** `enabled: false` asks for nothing yet (the Daily brief holds this read until its own read has answered). */
export default function useNotebookHome({ enabled = true } = {}) {
  const { data, error, isLoading, mutate } = useSWR(enabled ? '/api/j2/notebook/home' : null, fetcher, {
    revalidateOnFocus: false,
    shouldRetryOnError: false,
  })
  return {
    home: data || EMPTY,
    isLoading,
    error,
    refresh: () => mutate(),
  }
}
