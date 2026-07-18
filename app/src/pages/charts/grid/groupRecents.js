// app/src/pages/charts/grid/groupRecents.js
// Recent-groups list (localStorage) + prev/next neighbor for fast group scanning.

const KEY = 'uct.groups.recents'
const CAP = 6

export function getRecents() {
  try {
    const arr = JSON.parse(localStorage.getItem(KEY) || '[]')
    return Array.isArray(arr) ? arr.slice(0, CAP) : []
  } catch { return [] }
}

export function pushRecent(id) {
  if (!id) return getRecents()
  const next = [id, ...getRecents().filter(x => x !== id)].slice(0, CAP)
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* ignore quota */ }
  return next
}

export function neighborGroup(groups, currentId, dir) {
  const list = Array.isArray(groups) ? groups : []
  if (!list.length) return null
  const i = list.findIndex(g => g.id === currentId)
  if (i === -1) return list[0].id
  const j = (i + dir + list.length) % list.length
  return list[j].id
}
