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
