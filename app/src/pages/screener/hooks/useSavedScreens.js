import useSWR from 'swr'

const fetcher = url => fetch(url).then(r => r.json())

export default function useSavedScreens() {
  const { data, mutate } = useSWR('/api/screener/saved-screens', fetcher)

  const create = async (name, spec, is_public = false) => {
    await fetch('/api/screener/saved-screens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, spec, is_public }),
    })
    mutate()
  }
  const update = async (id, fields) => {
    await fetch(`/api/screener/saved-screens/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fields),
    })
    mutate()
  }
  const remove = async id => {
    await fetch(`/api/screener/saved-screens/${id}`, { method: 'DELETE' })
    mutate()
  }

  return {
    saved: data?.saved ?? [],
    starters: data?.starters ?? [],
    create, update, remove, refresh: mutate,
  }
}
