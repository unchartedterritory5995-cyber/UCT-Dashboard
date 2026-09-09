import useSWR from 'swr'

// Named Charts-workspace layouts: admin-built PREBUILT templates (global) + the
// user's own saved layouts (mine). Backed by /api/charts/layouts.
const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : { global: [], mine: [] }))

export default function useChartLayouts() {
  const { data, mutate, isLoading } = useSWR('/api/charts/layouts', fetcher, { revalidateOnFocus: false })

  const saveLayout = async ({ name, layout, groups, scope = 'user' }) => {
    const r = await fetch('/api/charts/layouts', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, layout, groups, scope }),
    })
    if (!r.ok) {
      const body = await r.json().catch(() => ({}))
      throw new Error(body.detail || 'Save failed')
    }
    const saved = await r.json()
    // Merge the saved row straight into the cache instead of refetching it.
    // `mutate()` with no argument costs a SECOND round-trip before a new layout
    // can appear on the Layout Dock — the POST returns, then the whole list is
    // fetched again — and that gap reads as the app being slow rather than the
    // network being slow. The server hands back the full row, so there is
    // nothing a refetch would tell us that we do not already have.
    await mutate((cur) => {
      const base = cur || { global: [], mine: [] }
      const key = (saved?.scope === 'global') ? 'global' : 'mine'
      const list = base[key] || []
      const exists = list.some(t => t.id === saved?.id)
      return {
        ...base,
        [key]: exists ? list.map(t => (t.id === saved.id ? saved : t)) : list.concat(saved),
      }
    }, { revalidate: false })
    return saved
  }

  const deleteLayout = async (id) => {
    const r = await fetch(`/api/charts/layouts/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new Error('Delete failed')
    // Same reasoning as the save path: drop it from the cache rather than
    // refetching, so the bar loses the layout the instant the server confirms.
    await mutate((cur) => {
      const base = cur || { global: [], mine: [] }
      return {
        ...base,
        global: (base.global || []).filter(t => t.id !== id),
        mine: (base.mine || []).filter(t => t.id !== id),
      }
    }, { revalidate: false })
  }

  return {
    global: data?.global || [],
    mine: data?.mine || [],
    isLoading,
    saveLayout,
    deleteLayout,
    refresh: mutate,
  }
}
