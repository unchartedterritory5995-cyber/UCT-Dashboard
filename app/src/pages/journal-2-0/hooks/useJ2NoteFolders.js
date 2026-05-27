/** Notebook folders SWR hook. */
import useSWR from 'swr'

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

  const create = async (name) => {
    const res = await fetch(url, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
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
    if (!res.ok) throw new Error(`${res.status}`)
    await mutate()
  }
  return { folders, isLoading, error, refresh: () => mutate(), create, rename, remove }
}
