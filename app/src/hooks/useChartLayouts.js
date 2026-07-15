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
    await mutate()
    return saved
  }

  const deleteLayout = async (id) => {
    const r = await fetch(`/api/charts/layouts/${id}`, { method: 'DELETE', credentials: 'include' })
    if (!r.ok) throw new Error('Delete failed')
    await mutate()
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
