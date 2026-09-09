import { useCallback } from 'react'
import useSWR from 'swr'

// Per-user custom theme SETS (see api/routers/theme_sets.py). Same-origin cookie auth,
// matching the app's other CRUD hooks (no explicit credentials needed).
const fetcher = (url) => fetch(url).then(r => (r.ok ? r.json() : { enabled: false, sets: [] }))
const jsonHeaders = { 'Content-Type': 'application/json' }

export function useThemeSets() {
  const { data, mutate } = useSWR('/api/theme-sets', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30_000,
  })
  const enabled = !!data?.enabled
  const sets = data?.sets || []

  const createSet = useCallback(async (name) => {
    const r = await fetch('/api/theme-sets', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ name }) })
    if (!r.ok) return null
    const s = await r.json()
    await mutate()
    return s
  }, [mutate])

  const deleteSet = useCallback(async (id) => {
    const r = await fetch(`/api/theme-sets/${id}`, { method: 'DELETE' })
    await mutate()
    return r.ok
  }, [mutate])

  // Rename preserves the existing diff (fetch it, PUT with the new name).
  const renameSet = useCallback(async (id, name) => {
    const cur = await getSetDef(id)
    if (!cur) return null
    const r = await fetch(`/api/theme-sets/${id}`, {
      method: 'PUT', headers: jsonHeaders,
      body: JSON.stringify({ name, themes: cur.themes, hidden: cur.hidden, removed: cur.removed, added: cur.added, custom: cur.custom }),
    })
    await mutate()
    return r.ok
  }, [mutate])

  return { enabled, sets, createSet, deleteSet, renameSet, refreshSets: mutate }
}

// One-shot helpers for the editor (not reactive — the editor holds its own diff state).
export async function getSetDef(id) {
  const r = await fetch(`/api/theme-sets/${id}`)
  return r.ok ? r.json() : null
}

export async function putSetDef(id, def) {
  const r = await fetch(`/api/theme-sets/${id}`, { method: 'PUT', headers: jsonHeaders, body: JSON.stringify(def) })
  return r.ok ? r.json() : null
}
