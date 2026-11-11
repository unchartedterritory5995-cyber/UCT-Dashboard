// Compare Symbols — the panel's group resolver (theme / sector / industry membership), shared by
// the Overlay tab (add a whole group as lines) and the Rotation tab (plot a group's names).
// `GET /api/compare/groups` and `GET /api/compare/group-members` (api/routers/compare.py).
// Lifted out of CompareSymbolsPanel.jsx unchanged (UCT RS Phase 3, unit 3-12).

export const GROUP_TYPES = [
  { key: 'theme', label: 'Themes' },
  { key: 'sector', label: 'Sectors' },
  { key: 'industry', label: 'Industries' },
]

/** The window event that opens the Compare panel (and, with `tab: 'rotation'`, its Rotation tab).
 *  `detail`: `{ tab: 'overlay' | 'rotation', sym?, group? }`, where `group` is a group TYPE
 *  ('theme' | 'sector' | 'industry', resolved for `sym`) or `{ type, name }`. Unit 3-09 dispatches it. */
export const COMPARE_OPEN_EVENT = 'uct:compare-open'

/** `[{ name, count }]` for one group type, or `null` when the read fails (the Agent says the list is
 *  unavailable rather than "there is no such group"). */
export async function readGroupList(type) {
  try {
    const r = await fetch(`/api/compare/groups?type=${type}`)
    if (!r.ok) return null
    const j = await r.json()
    return Array.isArray(j?.groups) ? j.groups : null
  } catch {
    return null
  }
}

/** `[{ name, count }]` for one group type; `[]` on any failure (the picker says "No matches"). */
export async function fetchGroupList(type) {
  try {
    const r = await fetch(`/api/compare/groups?type=${type}`)
    const j = r.ok ? await r.json() : { groups: [] }
    return j.groups || []
  } catch {
    return []
  }
}

/** `{ name, symbols: [SYM], total, truncated }` for one group, upper-cased; `null` when the
 *  read fails. The server caps `symbols` at 50 and says so in `total` / `truncated`. */
export async function fetchGroupMembers(type, name) {
  try {
    const r = await fetch(`/api/compare/group-members?type=${type}&name=${encodeURIComponent(name)}`)
    const j = r.ok ? await r.json() : null
    if (!j) return null
    const symbols = (j.symbols || []).map((s) => String(s).toUpperCase())
    return { name: j.name || name, symbols, total: Number(j.total) || symbols.length, truncated: !!j.truncated }
  } catch {
    return null
  }
}

// ── The panel's own list writes for a whole group (C1-035 / C1-037 / C1-040) ──
// CompareSymbolsPanel's addGroup / removeGroup / setGroupScale compute the next comparison list with
// these, and the Agent's chart.compareGroup writes exactly the same list, so the two can never differ.

/** The list after adding every member of group `name`: members already compared are skipped, each new
 *  one gets the next unused colour and its own % scale ("New price scale"), tagged with the group. */
export function withGroupAdded(prev, name, members, pickColor) {
  const have = new Set(prev.map(x => x.sym))
  const used = new Set(prev.map(x => String(x.color).toLowerCase()))
  let idx = prev.length
  const additions = []
  for (const s of members) {
    if (have.has(s)) continue
    const color = pickColor(idx++, used)
    used.add(color.toLowerCase())
    additions.push({ sym: s, enabled: true, color, scaleMode: 'new', group: name })
  }
  if (!additions.length) return prev
  return [...prev, ...additions]
}

/** The list without group `name` (the group row's ×). */
export const withoutGroup = (prev, name) => prev.filter(x => x.group !== name)

/** The list with every member of group `name` on `scaleMode` ('same' | 'new'), the group's scale buttons. */
export const withGroupScale = (prev, name, scaleMode) => prev.map(x => (x.group === name ? { ...x, scaleMode } : x))

/** The groups a comparison list holds, in first-seen order: `[{ name, count }]`. */
export function groupsIn(list) {
  const m = new Map()
  for (const x of list || []) if (x && x.group) m.set(x.group, (m.get(x.group) || 0) + 1)
  return [...m.entries()].map(([name, count]) => ({ name, count }))
}
