/**
 * Nested tags (Obsidian's `a/b/c`) — the tree the sidebar draws and the
 * hierarchy the tag autocomplete suggests.
 *
 * ⛔ THE SERVER OWNS THE COUNTS. `GET /api/j2/notes/tags` returns every node
 * (implied parents included) with `own` and `total`, where `total` is DISTINCT
 * notes in the subtree — what filtering by that tag returns. A client that
 * summed child counts would say "research 4" for three notes whenever one note
 * carries both "research" and "research/semis". `fallbackNodes` below is the
 * only place counts are derived here, and only for an answer that has no
 * `tree` yet (an older server, a test); it says so where it is used.
 */

/** Mirror of notes.py `_normalize_tag_path`: trim every level, drop empty
 *  levels. A flat tag comes back as `trim()` alone. */
export function normalizeTagPath(tag) {
  const t = String(tag ?? '').trim()
  if (!t.includes('/')) return t
  return t.split('/').map((s) => s.trim()).filter(Boolean).join('/')
}

export const tagKey = (tag) => normalizeTagPath(tag).toLowerCase()

/** 'a/b/c' -> ['a', 'a/b'] (keys of every level ABOVE it). */
export function ancestorKeys(key) {
  const segs = String(key || '').split('/')
  const out = []
  for (let i = 1; i < segs.length; i += 1) out.push(segs.slice(0, i).join('/'))
  return out
}

/** True when any tag has a level below it — flat-only libraries draw exactly
 *  as they always did. */
export function hasNestedTags(nodes) {
  return (nodes || []).some((n) => String(n.key || n.path || '').includes('/'))
}

const bySubtreeSize = (a, b) => (b.total - a.total) || a.key.localeCompare(b.key)

/**
 * Server nodes -> roots, each `{key, path, label, own, total, depth, children}`.
 * Siblings ordered by subtree size, then name — the order the flat tag list
 * has always used (count descending, then tag), so a flat library is
 * unchanged.
 */
export function buildTagTree(nodes) {
  const byKey = new Map()
  for (const n of nodes || []) {
    const key = n.key || tagKey(n.path)
    if (!key) continue
    const path = normalizeTagPath(n.path || key)
    const segs = path.split('/')
    byKey.set(key, {
      key,
      path,
      label: segs[segs.length - 1],
      own: Number(n.own ?? 0),
      total: Number(n.total ?? n.own ?? 0),
      depth: segs.length - 1,
      children: [],
    })
  }
  const roots = []
  for (const node of byKey.values()) {
    const parentKey = ancestorKeys(node.key).pop()
    const parent = parentKey ? byKey.get(parentKey) : null
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const sortDeep = (list) => {
    list.sort(bySubtreeSize)
    for (const n of list) sortDeep(n.children)
    return list
  }
  return sortDeep(roots)
}

/**
 * Nodes from a FLAT `[{tag, count}]` list, for an answer with no `tree`.
 * ⚠️ Parent totals here are the SUM of their subtree's own counts — an upper
 * bound that over-counts a note carrying two tags of one branch. Correct for
 * every flat tag (own === total), which is every tag most members have.
 */
export function fallbackNodes(tagCounts) {
  const nodes = new Map()
  for (const { tag, count } of tagCounts || []) {
    const path = normalizeTagPath(tag)
    const key = path.toLowerCase()
    if (!key) continue
    const cur = nodes.get(key) || { key, path, own: 0, total: 0 }
    cur.own += count
    cur.total += count
    nodes.set(key, cur)
    const segs = path.split('/')
    for (let i = 1; i < segs.length; i += 1) {
      const ppath = segs.slice(0, i).join('/')
      const pkey = ppath.toLowerCase()
      const p = nodes.get(pkey) || { key: pkey, path: ppath, own: 0, total: 0 }
      p.total += count
      nodes.set(pkey, p)
    }
  }
  return [...nodes.values()]
}

/**
 * Tag suggestions for what the member has typed, hierarchy first.
 *   "res"            -> research, research/semis, research/semis/nvda …
 *   "research/"      -> the tags BELOW research (children before grandchildren)
 *   "semis"          -> research/semis (a level that starts with it)
 * Ranked: a path that starts with the text, then one with a LEVEL starting
 * with it, then one containing it; inside a rank shallower first, then the
 * bigger subtree. A leading `#` is ignored — members type it.
 */
export function suggestTags(query, nodes, limit = 8) {
  const raw = String(query ?? '').trim().replace(/^#+/, '').toLowerCase()
  if (!raw) return []
  const all = (nodes || []).map((n) => ({
    key: n.key || tagKey(n.path),
    path: normalizeTagPath(n.path || n.key),
    total: Number(n.total ?? n.own ?? 0),
  })).filter((n) => n.key)
  const depth = (k) => k.split('/').length - 1
  let ranked
  if (raw.endsWith('/')) {
    const parent = normalizeTagPath(raw).toLowerCase()
    ranked = all
      .filter((n) => n.key.startsWith(`${parent}/`))
      .map((n) => ({ ...n, rank: depth(n.key) }))
  } else {
    const q = normalizeTagPath(raw).toLowerCase()
    ranked = all.map((n) => {
      let rank = -1
      if (n.key.startsWith(q)) rank = 0
      else if (n.key.split('/').some((seg) => seg.startsWith(q))) rank = 1
      else if (n.key.includes(q)) rank = 2
      return { ...n, rank }
    }).filter((n) => n.rank >= 0 && n.key !== q)
  }
  ranked.sort((a, b) => (a.rank - b.rank) || (depth(a.key) - depth(b.key))
    || (b.total - a.total) || a.key.localeCompare(b.key))
  return ranked.slice(0, limit).map((n) => n.path)
}
