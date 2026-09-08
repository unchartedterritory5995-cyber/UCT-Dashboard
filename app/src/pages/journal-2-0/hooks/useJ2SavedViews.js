/** Wave E — saved views SWR hook. */
import useSWR, { mutate as globalMutate } from 'swr'
import { isNoteListKey } from './useJ2NoteVersions'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2SavedViews() {
  const url = '/api/j2/saved-views'
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })
  const savedViews = data?.savedViews ?? []

  const create = async (name, viewType, spec) => {
    const res = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, viewType, spec }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `${res.status}`)
    }
    const body = await res.json()
    await mutate()
    return body.savedView
  }
  const rename = async (id, name) => {
    const res = await fetch(`${url}/${id}`, {
      method: 'PUT', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    if (!res.ok) throw new Error(`${res.status}`)
    await mutate()
  }
  const remove = async (id) => {
    const res = await fetch(`${url}/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!res.ok) throw new Error(`${res.status}`)
    await mutate()
    // A note-list page filtered BY this view could still be cached under the
    // savedViewId URL -- not directly revalidatable (we don't know every key
    // that used it), but any currently-active view selection should already
    // be cleared by the caller (NotebookTab) the moment delete succeeds.
    globalMutate(isNoteListKey)
  }

  return { savedViews, isLoading, error, refresh: () => mutate(), create, rename, remove }
}
