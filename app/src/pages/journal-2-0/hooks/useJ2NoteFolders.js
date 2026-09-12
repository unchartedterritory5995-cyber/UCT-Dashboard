/** Notebook folders SWR hook. */
import useSWR from 'swr'
import { settleNoteWrites } from '../lib/offline/settleNoteWrite'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status}`)
    return r.json()
  })

export default function useJ2NoteFolders() {
  const url = '/api/j2/note-folders'
  const { data, error, isLoading, mutate } = useSWR(url, fetcher, {
    revalidateOnFocus: true,
    shouldRetryOnError: false,
  })
  const folders = data?.folders ?? []

  const create = async (name, parentId) => {
    const res = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, ...(parentId ? { parentId } : {}) }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `${res.status}`)
    }
    await mutate()
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
    const res = await fetch(`${url}/${id}`, {
      method: 'DELETE', credentials: 'include',
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      throw new Error(body.detail || `${res.status}`)
    }
    // ⛔⛔ `delete_folder` MOVES EVERY NOTE IN THE FOLDER, in one bulk UPDATE, and
    // every one of them gets a new revision. A member can easily have unsent
    // offline work in one — deleting a folder is exactly the kind of tidying
    // done after a writing session — and an unlanded revision reads to the drain
    // as a stranger's write, forking the member's note against their own filing.
    // The endpoint returns `moved: [{noteId, updatedAt}]` so this can land them.
    const body = await res.json().catch(() => ({}))
    await settleNoteWrites(body.moved)
    await mutate()
  }
  return { folders, isLoading, error, refresh: () => mutate(), create, rename, remove }
}
