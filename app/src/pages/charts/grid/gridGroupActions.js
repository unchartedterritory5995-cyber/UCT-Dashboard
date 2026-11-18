// app/src/pages/charts/grid/gridGroupActions.js
//
// The Multi Chart GROUP actions — pick a group, step to the previous / next one, switch to one the seed is also in, refresh
// the one loaded — as plain functions over the grid's `mc` (useMultiChartState). Lifted out of the UI handlers
// (GroupPicker.pick, MultiChartMenu's Prev / Next and ↻ Refresh, MultiChartGrid's also-in switcher) so the menu and the
// UCT Agent (useGridAgentControl) run exactly the same fetch-and-fill: one copy of the logic, never two.
//
// Every function reads `mc.state` once, when it is called (as the handlers did), and resolves to
//   { ok: true, syms }            the grid was filled with `syms`
//   { ok: false, error }          nothing was filled; `error` is the sentence the menu shows
//   { ok: false, stale: true }    (switchGroup only) a newer fill superseded this one; nothing was written
import { parseLayoutId } from './gridLayouts'
import { fetchGroups, fetchGroupTop, fetchPeers, pinEtf } from './groupsApi'
import { neighborGroup, pushRecent } from './groupRecents'

export const isIndustryGroup = (group) => String(group?.id || '').startsWith('industry:')

/** The Groups picker: enter the grid if needed, turn Groups mode on, fill the CURRENT grid size with the group's leaders. */
export async function pickGroup(mc, g) {
  const n = parseLayoutId(mc.state.layout).cellCount
  if (mc.state.mode !== 'grid') mc.enterGrid(mc.state.layout)
  mc.setGroupsMode(true)
  const { syms, etf } = await fetchGroupTop(g.id, { n, by: 'today' })
  const filled = pinEtf(syms, etf, n)
  if (filled.length) mc.fillCells(filled, { id: g.id, by: 'today', n, name: g.name })
  pushRecent(g.id)
  return filled.length ? { ok: true, syms: filled } : { ok: false, error: `${g.name || 'That group'} has no chartable names right now` }
}

/** ‹ Prev / Next ›: the neighbouring group in the theme list. Never silent: every path fills or explains. */
export async function stepGroup(mc, dir) {
  const group = mc.state.group
  if (!group?.id) return { ok: false, error: 'No group is loaded — pick a group first' }
  if (isIndustryGroup(group)) return { ok: false, error: 'Industry cohorts have no Prev/Next — pick a group below' }
  try {
    const list = await fetchGroups()
    const nextId = neighborGroup(list, group.id, dir)
    if (!nextId) return { ok: false, error: 'No neighboring group' }
    const n = mc.state.cells.length
    const { syms, etf } = await fetchGroupTop(nextId, { n, by: group.by || 'today' })
    const filled = pinEtf(syms, etf, n)
    const nextName = list.find(x => x.id === nextId)?.name
    if (!filled.length) return { ok: false, error: `${nextName || 'That group'} has no chartable names` }
    mc.fillCells(filled, { id: nextId, by: group.by || 'today', n, name: nextName })
    return { ok: true, syms: filled }
  } catch {
    return { ok: false, error: 'Group fetch failed — try again' }
  }
}

/** ↻ Refresh group: the loaded group's leaders now (an industry cohort re-resolves from its seed). */
export async function refreshGroup(mc) {
  const g = mc.state.group
  if (!g?.id) return { ok: false, error: 'No group is loaded — pick a group first' }
  const n = mc.state.cells.length
  try {
    if (isIndustryGroup(g)) {
      // Industry cohorts have no /top endpoint — re-resolve from the seed (same call that built the cohort; 60s server cache).
      if (!g.seed) return { ok: false, error: 'Nothing to refresh — type a ticker' }
      const res = await fetchPeers(g.seed, { n: Math.max(1, n - 1) })
      const syms = [g.seed, ...((res && res.peers) || [])].slice(0, n)
      if (syms.length <= 1) return { ok: false, error: 'No cohort right now' }
      mc.fillCells(syms, { ...g, n })
      return { ok: true, syms }
    }
    const { syms, etf } = await fetchGroupTop(g.id, { n, by: g.by || 'today' })
    const filled = pinEtf(syms, etf, n)
    if (!filled.length) return { ok: false, error: 'Group has no chartable names right now' }
    mc.fillCells(filled, { ...g, n })
    return { ok: true, syms: filled }
  } catch {
    return { ok: false, error: 'Refresh failed — try again' }
  }
}

/**
 * The heat header's "also in" switcher: re-fill with one of the seed's other groups, swapping the current group INTO the
 * switcher list so the member can flip back. `curName` is the current group's display name as the header shows it;
 * `stale()` says a newer fill has started since this one (MultiChartGrid's shared fill sequence).
 */
export async function switchGroup(mc, groupId, groupName, { curName = null, stale = () => false } = {}) {
  const g = mc.state.group
  const n = mc.state.cells.length
  let res = null
  try {
    res = await fetchGroupTop(groupId, { n, by: 'today' })
  } catch { res = null }
  if (stale()) return { ok: false, stale: true }
  if (!res) return { ok: false, error: `Couldn't load ${groupName} — kept your board` }
  const filled = pinEtf(res.syms, res.etf, n)
  if (!filled.length) return { ok: false, error: `${groupName} has no chartable names right now` }
  const cur = (g && (g.name || curName)) || (g && g.id) || null
  const others = (g?.alsoIn || []).filter(x => x.id !== groupId)
  const newAlsoIn = (g?.id && cur) ? [{ id: g.id, name: cur }, ...others] : others
  mc.fillCells(filled, { id: groupId, name: groupName, by: 'today', n, alsoIn: newAlsoIn, seed: g?.seed })
  return { ok: true, syms: filled }
}
