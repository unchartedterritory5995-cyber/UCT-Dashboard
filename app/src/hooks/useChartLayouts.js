import useSWR from 'swr'

// Named Charts-workspace layouts: admin-built PREBUILT templates (global) + the
// user's own saved layouts (mine). Backed by /api/charts/layouts.
//
// ⭐ Every mutation writes the SWR cache directly instead of calling bare
// `mutate()` to refetch. A refetch is a second round-trip before the change can
// show up, and on the Layout Dock that gap reads as the app being slow rather
// than the network being slow. Save/rename get the full row back from the
// server, so a refetch would tell us nothing we do not already have; delete has
// nothing to learn at all.
const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : { global: [], mine: [] }))

const EMPTY = { global: [], mine: [] }

/** Insert-or-replace `row` in whichever scope list owns it. */
function withRow(cur, row) {
  const base = cur || EMPTY
  const key = row?.scope === 'global' ? 'global' : 'mine'
  const list = base[key] || []
  const exists = list.some(t => t.id === row?.id)
  return {
    ...base,
    [key]: exists ? list.map(t => (t.id === row.id ? row : t)) : list.concat(row),
  }
}

/** Drop `id` from both scope lists. */
function withoutId(cur, id) {
  const base = cur || EMPTY
  return {
    ...base,
    global: (base.global || []).filter(t => t.id !== id),
    mine: (base.mine || []).filter(t => t.id !== id),
  }
}

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
    await mutate(cur => withRow(cur, saved), { revalidate: false })
    return saved
  }

  // Rename goes through PATCH, never save-new + delete-old: `upsert` is keyed on
  // (scope, user_id, name), so saving under a new name creates a SECOND row
  // instead of renaming the first.
  //
  // OPTIMISTIC, then reconciled with the server's row — the new name is on the
  // bar before the request leaves. Rolls the whole cache back if the server
  // refuses (a duplicate name comes back as 409).
  const renameLayout = async (id, name) => {
    const before = data
    await mutate((cur) => {
      const base = cur || EMPTY
      const patch = list => (list || []).map(t => (t.id === id ? { ...t, name } : t))
      return { ...base, global: patch(base.global), mine: patch(base.mine) }
    }, { revalidate: false })
    try {
      const r = await fetch(`/api/charts/layouts/${id}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!r.ok) {
        const body = await r.json().catch(() => ({}))
        throw new Error(body.detail || 'Rename failed')
      }
      const saved = await r.json()
      await mutate(cur => withRow(cur, saved), { revalidate: false })
      return saved
    } catch (e) {
      await mutate(before, { revalidate: false })
      throw e
    }
  }

  // OPTIMISTIC: the layout leaves the bar on the click, not on the response.
  // Waiting for the round-trip left a deleted layout sitting there for a beat,
  // which reads as the click not having registered. Restored if the server
  // refuses, so a failed delete can never silently lose a layout from the UI.
  const deleteLayout = async (id) => {
    const before = data
    await mutate(cur => withoutId(cur, id), { revalidate: false })
    try {
      const r = await fetch(`/api/charts/layouts/${id}`, { method: 'DELETE', credentials: 'include' })
      if (!r.ok) throw new Error('Delete failed')
    } catch (e) {
      await mutate(before, { revalidate: false })
      throw e
    }
  }

  return {
    global: data?.global || [],
    mine: data?.mine || [],
    isLoading,
    saveLayout,
    renameLayout,
    deleteLayout,
    refresh: mutate,
  }
}
