// ── UCT Agent capability family: MULTI CHART, THE GRID ITSELF (pl-grid, C3-042..061) ─────────────────────────────────
//
// What a member does to the /charts Multi Chart grid as a whole, and the two per-cell buttons that are not chart settings,
// through the grid's OWN writers (pages/charts/grid/useGridAgentControl.js → useMultiChartState / gridGroupActions /
// useChartLayouts — the very functions the Multi Charts menu, the Groups picker and the cell buttons call):
//
//   multiChart.set   (target: the grid)   op =
//     layout          enter Multi Chart and/or set its shape (a preset or rows × columns)    mc.enterGrid / applyCustomLayout
//     exit            back to the Charts board (the grid is kept for next time)               mc.exitGrid
//     syncCrosshair   the crosshair follows across every cell, on / off                       mc.setSyncCrosshair
//     syncTimeRange   scrolling / zooming one cell moves every cell, on / off                 mc.setSyncTimeRange
//     groupsMode      Groups mode on / off (off = "Exit Groups": the loaded group is dropped)  mc.setGroupsMode
//     pickGroup       fill the grid with a named group's leaders (the picker / an also-in chip) pickGroup / switchGroup
//     stepGroup       the previous / next group (‹ Prev / Next ›)                             stepGroup
//     refreshGroup    re-rank the loaded group now (↻ Refresh group)                          refreshGroup
//     applySaved      open a saved grid (Prebuilt grids / My grids)                           mc.applyGridTemplate
//     saveGrid        save this grid under a new name (Save grid as… — always the member's own) saveLayout (create-only)
//     deleteSaved     delete one of the member's own saved grids (the ✕ on My grids)           deleteLayout
//     openSettings    open the grid's ONE Shared Chart Settings dialog                         mc.setSettingsOpen(true)
//     restoreGrid     un-maximize: every cell is on screen again (Esc / the restore button)   mc.setMaxId(null)
//   multiChart.cell  (target: ONE cell, by its chart ref)   op =
//     maximize        that cell covers the whole grid (its ⤢ button)                          mc.setMaxId(id)
//     resetToMine     the cell drops its own settings and draws your chart again ("Reset to my chart") mc.updateCellAt
//
// ⛔ SAFETY (owner bar): zero wrong-cell changes. The ONE cell multiChart.cell changes is a chart-backed target (its snapshot
// carries `chartRef`), so every rule that keeps a chart op on the cell the member named or clicked — deixis.js (the anchor of
// "the one next to AMD" is never the target, a negated click is excluded, an ambiguous position is asked), P2-B's unnamed-
// target check, gridMode's hidden-behind-maximized refusal — applies to it unchanged. A grid-wide op names its scope in the
// receipt ("every chart in the grid", which cells a smaller layout drops). Every op has an exact Undo: the board as it was
// persisted, byte for byte (mc.snapshot / restoreSnapshot), the maximized cell and the dialog as they were; a saved grid the
// Agent made is deleted again, one it deleted is saved again under its name with its content.
// ⛔ Admin / global scope (C3-054) is owner-blocked: the Agent saves only the member's own grids and deletes only those.
import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { LAYOUTS, GRID_MAX_CELLS, parseLayoutId } from '../../pages/charts/grid/gridLayouts'
import { fetchGroups } from '../../pages/charts/grid/groupsApi'
import { isIndustryGroup } from '../../pages/charts/grid/gridGroupActions'

export const GRID_REF = 'multichart'
const MAX_SIDE = 4
const NAME_MAX = 60
const ctlOf = (host) => host?.gridControl || null
const quote = (s) => `“${s}”`
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const shape = (l) => `${l.rows}×${l.cols}`
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const listWords = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const norm = (s) => String(s || '').toLowerCase().replace(/[“”"']/g, '').replace(/\s+/g, ' ').trim()
const settle = async (until, ms = 2000) => { const t0 = Date.now(); while (!until() && Date.now() - t0 < ms) await new Promise(r => setTimeout(r, 25)) }

/** One saved / listed name from `items` by what the member said: exact (case-insensitive), else the ONE that contains it. */
export function matchNamed(items, said, nameOf = (x) => x.name) {
  const want = norm(said).replace(/\s+(?:grid|layout|group|theme)s?$/, '')
  if (!want) return { none: true }
  const exact = items.filter(x => norm(nameOf(x)) === want || norm(nameOf(x)) === norm(said))
  if (exact.length === 1) return { hit: exact[0] }
  if (exact.length > 1) return { many: exact }
  const part = items.filter(x => norm(nameOf(x)).includes(want))
  if (part.length === 1) return { hit: part[0] }
  return part.length ? { many: part } : { none: true }
}

// ── the grid as the Agent reads it ──
function gridSnap(host) {
  const ctl = ctlOf(host)
  if (!ctl) return null
  const st = ctl.state()
  if (!st) return null
  const l = parseLayoutId(st.layout)
  const g = st.group || null
  return {
    ref: GRID_REF, label: 'Multi Chart',
    mode: st.mode === 'grid' ? 'grid' : 'workspace', layout: l.id, rows: l.rows, cols: l.cols,
    cells: (st.cells || []).map(c => ({ id: c.id, sym: c.sym || null, tf: c.tf, forked: !!c.settings })),
    syncCrosshair: !!st.syncCrosshair, syncTimeRange: !!st.syncTimeRange, groupsMode: !!st.groupsMode,
    group: g ? { id: g.id, name: g.name || null, industry: isIndustryGroup(g), alsoIn: (g.alsoIn || []).map(x => ({ id: x.id, name: x.name })) } : null,
    maxId: ctl.maxId(), settingsOpen: ctl.settingsOpen(),
    raw: ctl.snapshot(),
    saved: (ctl.savedGrids() || []).map(s => ({ id: s.id, name: s.name, scope: s.scope, layout: s.layout })),
  }
}
const SAVED_OPS = new Set(['saveGrid', 'deleteSaved'])
const savedSig = (snap) => JSON.stringify((snap?.saved || []).map(s => [s.id, s.name, s.scope]))
const gridKind = {
  name: 'multiChart',
  source: 'gridControl',  // #1112 rail: the host key this kind's list/read/commit reads (capabilities.noTargetSentence)
  unavailable: "Multi Chart isn't available on this page — open Charts to use the chart grid.",
  boardScoped: false,          // the grid is the member's own board (multichart_state), whichever layout is open
  selfDescribing: true,
  list: (host) => { const s = gridSnap(host); return s ? [s] : [] },
  read: (host, ref) => (ref === GRID_REF ? gridSnap(host) : null),
  stateOf: (snap) => ({ ...snap, do: null }),
  patch: (before, after) => (after.do ? { do: after.do } : null),
  async commit(host, _ref, patch) {
    const ctl = ctlOf(host)
    if (!ctl) throw new Error('Multi Chart is not available here')
    if (patch.restore) return restoreGrid(ctl, patch.restore)
    const d = patch.do
    switch (d.op) {
      case 'layout': {
        const id = `${d.rows}x${d.cols}`
        if (d.rows == null) ctl.enterGrid()
        else if (LAYOUTS.some(l => l.id === id)) ctl.enterGrid(id)
        else ctl.applyCustomLayout(d.rows, d.cols)
        break
      }
      case 'exit': ctl.exitGrid(); break
      case 'syncCrosshair': ctl.setSyncCrosshair(d.on); break
      case 'syncTimeRange': ctl.setSyncTimeRange(d.on); break
      case 'groupsMode': ctl.setGroupsMode(d.on); break
      case 'pickGroup':
      case 'stepGroup':
      case 'refreshGroup': {
        // the picker turns Groups mode on (and opens the grid) BEFORE its fetch: a fetch that fills nothing is taken back
        // here, so "nothing was left changed" stays true
        const before = { raw: ctl.snapshot(), maxId: ctl.maxId(), settingsOpen: ctl.settingsOpen() }
        let r = null
        try {
          r = d.op === 'pickGroup'
            ? (d.viaAlsoIn ? await ctl.switchGroup(d.group.id, d.group.name) : await ctl.pickGroup(d.group))
            : d.op === 'stepGroup' ? await ctl.stepGroup(d.dir) : await ctl.refreshGroup()
        } catch { r = null }
        if (!r?.ok) {
          await restoreGrid(ctl, before)
          throw new Error(r?.error || 'the group could not be loaded')
        }
        await settle(() => sameJson((ctl.state().cells || []).map(c => c.sym || null).filter(Boolean), r.syms.slice(0, ctl.state().cells.length)))
        return { undoData: { syms: r.syms, group: ctl.state().group?.name || ctl.state().group?.id || null } }
      }
      case 'applySaved': ctl.applySaved({ layout: d.tpl.layout }); break
      case 'saveGrid': {
        const row = await ctl.saveGrid(d.name)
        await settle(() => (ctl.savedGrids() || []).some(s => s.name === d.name))
        return { undoData: { savedId: row?.id ?? null } }
      }
      case 'deleteSaved': {
        await ctl.deleteGrid(d.id)
        await settle(() => !(ctl.savedGrids() || []).some(s => s.id === d.id))
        return { undoData: { deleted: { name: d.name, layout: d.tpl.layout } } }
      }
      case 'openSettings': ctl.setSettingsOpen(true); break
      case 'restoreGrid': ctl.setMaxId(null); break
      default: throw new Error('that Multi Chart change is not one I can make')
    }
    await settle(() => gridKind.landed(gridSnap(host), patch))
    return true
  },
  landed(snap, patch) {
    if (!snap) return false
    if (patch.restore) {
      const r = patch.restore
      if (r.raw != null && (snap.raw !== r.raw || (snap.maxId ?? null) !== (r.maxId ?? null) || snap.settingsOpen !== r.settingsOpen)) return false
      if (r.unsave != null && snap.saved.some(s => s.id === r.unsave)) return false
      if (r.resave && !snap.saved.some(s => s.scope === 'user' && s.name === r.resave.name)) return false
      return true
    }
    const d = patch.do
    switch (d.op) {
      case 'layout': return snap.mode === 'grid' && (d.rows == null || snap.layout === `${d.rows}x${d.cols}`)
      case 'exit': return snap.mode !== 'grid'
      case 'syncCrosshair': return snap.syncCrosshair === d.on
      case 'syncTimeRange': return snap.syncTimeRange === d.on
      case 'groupsMode': return snap.groupsMode === d.on && (d.on || !snap.group)
      case 'pickGroup': return snap.mode === 'grid' && snap.groupsMode && snap.group?.id === d.group.id
      case 'stepGroup': case 'refreshGroup': return snap.mode === 'grid' && !!snap.group
      case 'applySaved': {
        const l = parseLayoutId(d.tpl.layout?.layout)
        const want = (d.tpl.layout?.cells || []).slice(0, l.cellCount).map(c => (typeof c?.sym === 'string' && c.sym.trim() ? c.sym.trim().toUpperCase() : null))
        return snap.mode === 'grid' && snap.layout === l.id && sameJson(snap.cells.slice(0, want.length).map(c => c.sym), want)
      }
      case 'saveGrid': return snap.saved.some(s => s.scope === 'user' && s.name === d.name)
      case 'deleteSaved': return !snap.saved.some(s => s.id === d.id)
      case 'openSettings': return snap.settingsOpen === true
      case 'restoreGrid': return !snap.maxId
      default: return false
    }
  },
  // Undo: the board exactly as it was persisted, the maximized cell and the dialog as they were — and a grid the change
  // saved is deleted again / one it deleted is saved again
  // (a save / delete owns only the saved-grid list: its Undo never touches the grid, which may have changed since)
  undoPatch: (item) => {
    const listOnly = SAVED_OPS.has(item?.patch?.do?.op)
    return { restore: {
      raw: listOnly ? null : item.before.raw, maxId: item.before.maxId ?? null, settingsOpen: !!item.before.settingsOpen,
      unsave: item.undoData?.savedId ?? null, resave: item.undoData?.deleted || null,
    } }
  },
  fingerprint: (snap) => JSON.stringify([snap.raw, snap.maxId ?? null, !!snap.settingsOpen, savedSig(snap)]),
  // a save / delete owns only the saved-grid list: a later change to the grid does not make its Undo stale
  fingerprintFor(_host, snap, item) {
    return SAVED_OPS.has(item?.patch?.do?.op) ? savedSig(snap) : gridKind.fingerprint(snap)
  },
}
async function restoreGrid(ctl, r) {
  if (r.raw != null) {
    if (ctl.snapshot() !== r.raw) ctl.restoreSnapshot(r.raw)
    if ((ctl.maxId() ?? null) !== (r.maxId ?? null)) ctl.setMaxId(r.maxId ?? null)
    if (ctl.settingsOpen() !== !!r.settingsOpen) ctl.setSettingsOpen(!!r.settingsOpen)
  }
  if (r.unsave != null) await ctl.deleteGrid(r.unsave)
  if (r.resave) await ctl.saveGrid(r.resave.name, r.resave.layout)
  await settle(() => (r.raw == null || (ctl.snapshot() === r.raw && (ctl.maxId() ?? null) === (r.maxId ?? null)))
    && (r.unsave == null || !(ctl.savedGrids() || []).some(s => s.id === r.unsave))
    && (!r.resave || (ctl.savedGrids() || []).some(s => s.name === r.resave.name)))
  return true
}

// ── ONE cell of the grid (multiChart.cell): a chart-backed target, so the chart-targeting rules all apply ──
function cellSnaps(host) {
  const ctl = ctlOf(host)
  const grid = host?.charts?.grid?.() || null
  if (!ctl || !grid || ctl.state()?.mode !== 'grid') return []
  const cells = ctl.state().cells || []
  const maxId = ctl.maxId()
  return (host.charts.list?.() || []).map(ch => {
    const c = cells.find(x => x.id === ch.ref)
    if (!c) return null
    return { ref: ch.ref, chartRef: ch.ref, label: ch.label, position: ch.position ?? null, symbol: c.sym || null,
      forked: !!c.settings, maxId, cellJson: JSON.stringify(c) }
  }).filter(Boolean)
}
const cellKind = {
  name: 'gridCell',
  source: 'gridControl',  // #1112 rail: cellSnaps/commit read host.gridControl (capabilities.noTargetSentence)
  unavailable: "Multi Chart isn't available on this page — open Charts to use the chart grid.",
  boardScoped: false,
  selfDescribing: true,
  list: (host) => cellSnaps(host),
  read: (host, ref) => cellSnaps(host).find(s => s.ref === ref) || null,
  groupOf: (ref) => ref,
  stateOf: (snap) => ({ forked: snap.forked, maxId: snap.maxId ?? null, do: null }),
  patch: (before, after) => (after.do ? { do: after.do } : null),
  async commit(host, ref, patch) {
    const ctl = ctlOf(host)
    if (!ctl) throw new Error('Multi Chart is not available here')
    if ('restoreCell' in patch) {
      const cur = cellKind.read(host, ref)
      if (cur && cur.cellJson !== patch.restoreCell) ctl.restoreCell(patch.restoreCell)
      if ((ctl.maxId() ?? null) !== (patch.maxId ?? null)) ctl.setMaxId(patch.maxId ?? null)
    } else if (patch.do === 'maximize') ctl.setMaxId(ref)
    else if (patch.do === 'resetToMine') { if (!ctl.resetCell(ref)) return false }
    else return false
    await settle(() => cellKind.landed(cellKind.read(host, ref), patch))
    return true
  },
  landed(snap, patch) {
    if (!snap) return false
    if ('restoreCell' in patch) return snap.cellJson === patch.restoreCell && (snap.maxId ?? null) === (patch.maxId ?? null)
    if (patch.do === 'maximize') return snap.maxId === snap.ref
    if (patch.do === 'resetToMine') return !snap.forked
    return false
  },
  undoPatch: (item) => ({ restoreCell: item.before.cellJson, maxId: item.before.maxId ?? null }),
  fingerprint: (snap) => JSON.stringify([snap.cellJson, snap.maxId ?? null]),
}

// ── multiChart.set: the op's own check / apply / describe ──
const OPS = ['layout', 'exit', 'syncCrosshair', 'syncTimeRange', 'groupsMode', 'pickGroup', 'stepGroup', 'refreshGroup',
  'applySaved', 'saveGrid', 'deleteSaved', 'openSettings', 'restoreGrid']
const NEEDS_GRID = new Set(['saveGrid', 'openSettings', 'restoreGrid', 'stepGroup', 'refreshGroup'])
const onOff = (on) => (on ? 'on' : 'off')

function resolveGroup(st, name, env) {
  const also = (st.group?.alsoIn || []).map(x => ({ ...x, alsoIn: true }))
  const list = [...also, ...(env?.mcGroups || []).filter(g => !also.some(a => a.id === g.id))]
  if (!list.length) return { why: 'I couldn’t load the list of groups just now, so nothing changed. Try again in a moment.' }
  const m = matchNamed(list, name)
  if (m.hit) return { group: m.hit }
  if (m.many) return { why: `Several groups match ${quote(name)}: ${listWords(m.many.slice(0, 6).map(g => g.name))}. Say which one — nothing changed.` }
  return { why: `I can’t find a group called ${quote(name)}, so nothing changed.` }
}
function resolveSaved(st, name, { own = false } = {}) {
  const m = matchNamed(st.saved, name)
  if (m.none) return { why: `You have no saved grid called ${quote(name)}${st.saved.length ? ` — your saved grids are ${listWords(st.saved.slice(0, 8).map(s => quote(s.name)))}` : ''}. Nothing changed.` }
  if (m.many) return { why: `Several saved grids match ${quote(name)}: ${listWords(m.many.map(s => quote(s.name)))}. Say which one — nothing changed.` }
  if (own && m.hit.scope !== 'user') return { why: `${quote(m.hit.name)} is a prebuilt grid, which only an admin can delete. Nothing changed.` }
  return { hit: m.hit }
}

function checkSet(st, args, env) {
  const { op } = args
  if (!OPS.includes(op)) return 'That isn’t a Multi Chart change I can make.'
  if (NEEDS_GRID.has(op) && st.mode !== 'grid') return 'Multi Chart isn’t open, so there is no grid to do that on. Ask me to open Multi Chart first (for example “show me a 2×2 grid”).'
  switch (op) {
    case 'layout': {
      const { rows, cols } = args
      if (rows == null && cols == null) return null
      if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) return 'Say the grid as rows × columns, for example 2×3.'
      if (rows > MAX_SIDE || cols > MAX_SIDE || rows * cols > GRID_MAX_CELLS) return `A Multi Chart grid can be at most ${MAX_SIDE} rows by ${MAX_SIDE} columns (${GRID_MAX_CELLS} charts), so ${rows}×${cols} isn’t possible. Nothing changed.`
      return null
    }
    case 'syncCrosshair': case 'syncTimeRange': case 'groupsMode':
      return typeof args.on === 'boolean' ? null : 'Say whether to turn it on or off.'
    case 'pickGroup': {
      if (!String(args.name || '').trim()) return 'Which group? Say its name.'
      return resolveGroup(st, args.name, env).why || null
    }
    case 'stepGroup':
      if (!st.group) return 'No group is loaded in the grid, so there is no next or previous one. Pick a group first.'
      if (st.group.industry) return 'This is an industry cohort, which has no previous or next group — name a group to load instead. Nothing changed.'
      return args.direction === 'next' || args.direction === 'previous' ? null : 'Say next or previous.'
    case 'refreshGroup':
      return st.group ? null : 'No group is loaded in the grid, so there is nothing to refresh. Pick a group first.'
    case 'applySaved':
      if (!String(args.name || '').trim()) return 'Which saved grid? Say its name.'
      return resolveSaved(st, args.name).why || null
    case 'saveGrid': {
      const name = String(args.name || '').trim()
      if (!name) return 'What should I call the grid? Say a name for it.'
      if (name.length > NAME_MAX) return `That name is longer than ${NAME_MAX} characters — say a shorter one.`
      if (st.saved.some(s => s.scope === 'user' && norm(s.name) === norm(name))) return `You already have a saved grid called ${quote(name)}. Say another name — nothing changed.`
      return null
    }
    case 'deleteSaved':
      if (!String(args.name || '').trim()) return 'Which saved grid? Say its name.'
      return resolveSaved(st, args.name, { own: true }).why || null
    case 'restoreGrid':
      return null
    default:
      return null
  }
}
function applySet(st, args, env) {
  const { op } = args
  switch (op) {
    case 'layout': {
      const l = args.rows == null ? parseLayoutId(st.layout) : parseLayoutId(`${args.rows}x${args.cols}`)
      if (st.mode === 'grid' && l.id === st.layout) return st
      return { ...st, do: { op, rows: args.rows ?? null, cols: args.cols ?? null }, mode: 'grid', layout: l.id, rows: l.rows, cols: l.cols, cellCount: l.cellCount }
    }
    case 'exit': return st.mode !== 'grid' ? st : { ...st, do: { op }, mode: 'workspace' }
    case 'syncCrosshair': case 'syncTimeRange': case 'groupsMode':
      return st[op] === args.on ? st : { ...st, do: { op, on: args.on }, [op]: args.on }
    case 'pickGroup': {
      const { group } = resolveGroup(st, args.name, env)
      if (st.groupsMode && st.group?.id === group.id) return st
      return { ...st, do: { op, group: { id: group.id, name: group.name }, viaAlsoIn: !!group.alsoIn }, mode: 'grid', groupsMode: true }
    }
    case 'stepGroup': return { ...st, do: { op, dir: args.direction === 'previous' ? -1 : 1 } }
    case 'refreshGroup': return { ...st, do: { op } }
    case 'applySaved': {
      const { hit } = resolveSaved(st, args.name)
      return { ...st, do: { op, id: hit.id, name: hit.name, tpl: { layout: hit.layout } }, mode: 'grid' }
    }
    case 'saveGrid': return { ...st, do: { op, name: String(args.name).trim() } }
    case 'deleteSaved': {
      const { hit } = resolveSaved(st, args.name, { own: true })
      return { ...st, do: { op, id: hit.id, name: hit.name, tpl: { layout: hit.layout } } }
    }
    case 'openSettings': return st.settingsOpen ? st : { ...st, do: { op }, settingsOpen: true }
    case 'restoreGrid': return st.maxId ? { ...st, do: { op }, maxId: null } : st
    default: return st
  }
}
const symsOf = (cells) => cells.map(c => c.sym).filter(Boolean)
function describeSet(b, a) {
  const d = a.do
  if (!d) return null
  switch (d.op) {
    case 'layout': {
      const n = a.cellCount
      const had = b.cells.length
      const entered = b.mode !== 'grid' ? 'Opened Multi Chart' : 'Multi Chart'
      const head = `${entered}: the whole grid is now ${shape(a)} (${plural(n, 'chart')})`
      if (n === had) return `${head}`
      if (n > had) return `${head} — your ${plural(had, 'chart')} stay in the first cells, ${plural(n - had, 'new empty cell')} after them`
      const dropped = symsOf(b.cells.slice(n))
      return `${head} — ${dropped.length ? `${listWords(dropped)} ${dropped.length === 1 ? 'was' : 'were'} removed from the end of the grid` : `${plural(had - n, 'empty cell')} removed`} (Undo brings ${dropped.length === 1 ? 'it' : 'them'} back)`
    }
    case 'exit': return 'Left Multi Chart — your Charts board is back on screen (the grid is kept for next time)'
    case 'syncCrosshair': return `Crosshair sync is ${onOff(d.on)} for every chart in the grid`
    case 'syncTimeRange': return `Time-range sync is ${onOff(d.on)} for every chart in the grid${d.on ? ' — scrolling or zooming one moves them all' : ''}`
    case 'groupsMode': return d.on
      ? 'Groups mode is on for the whole grid — typing a ticker in any cell now fills every cell with its group'
      : `Groups mode is off${b.group ? ` — ${quote(b.group.name || b.group.id)} is no longer loaded` : ''}; the charts stay as they are`
    case 'pickGroup': return `Filled every cell of the grid with ${quote(d.group.name || d.group.id)}’s leaders (Groups mode on)`
    case 'stepGroup': return `Filled every cell of the grid with the ${d.dir < 0 ? 'previous' : 'next'} group’s leaders`
    case 'refreshGroup': return `Refreshed ${quote(b.group?.name || b.group?.id || 'the group')} across every cell of the grid`
    case 'applySaved': return `Opened your saved grid ${quote(d.name)} — it replaces every cell of the grid`
    case 'saveGrid': return `Saved this grid (${shape(b)}, ${plural(symsOf(b.cells).length, 'chart')}) as ${quote(d.name)} in My grids`
    case 'deleteSaved': return `Deleted your saved grid ${quote(d.name)} (the grid on screen is unchanged)`
    case 'openSettings': return 'Opened Shared Chart Settings — changes there apply to every chart in the grid that hasn’t its own settings'
    case 'restoreGrid': return 'Restored the grid — every chart is on screen again'
    default: return null
  }
}
function noopSet(b, a, args) {
  switch (args.op) {
    case 'layout': return `Multi Chart is already ${shape(b)}`
    case 'exit': return 'Multi Chart isn’t open — you’re on your Charts board'
    case 'syncCrosshair': return `Crosshair sync is already ${onOff(args.on)}`
    case 'syncTimeRange': return `Time-range sync is already ${onOff(args.on)}`
    case 'groupsMode': return `Groups mode is already ${onOff(args.on)}`
    case 'pickGroup': return `${quote(b.group?.name || args.name)} is already loaded`
    case 'openSettings': return 'Shared Chart Settings is already open'
    case 'restoreGrid': return 'No chart is maximized — every chart is already on screen'
    default: return 'Nothing to change'
  }
}

let registered = false
export function registerMultiChartCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(gridKind)
  registerTargetKind(cellKind)
  registerContextProvider({
    key: 'multiChart',
    build: (host, refFor) => {
      const s = gridSnap(host)
      if (!s) return undefined
      const maxCell = s.maxId ? (host?.charts?.list?.() || []).find(c => c.ref === s.maxId) : null
      return {
        ref: refFor('multiChart', GRID_REF),
        open: s.mode === 'grid',
        layout: shape(s), charts: s.cells.length,
        syncCrosshair: s.syncCrosshair, syncTimeRange: s.syncTimeRange, groupsMode: s.groupsMode,
        group: s.group ? (s.group.name || s.group.id) : null,
        ...(s.group?.alsoIn?.length ? { alsoIn: s.group.alsoIn.map(x => x.name) } : {}),
        maximized: maxCell ? maxCell.label : null,
        savedGrids: s.saved.slice(0, 30).map(x => (x.scope === 'global' ? `${x.name} (prebuilt)` : x.name)),
      }
    },
  })

  registerCapability({
    name: 'multiChart.set',
    target: 'multiChart',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    summary: 'Change the Multi Chart GRID as a whole, as its Multi Charts menu does: open it at a shape (layout rows × columns) or exit to the Charts board, crosshair / time-range sync, Groups mode, load / step / refresh a group, open / save / delete a saved grid, open Shared Chart Settings, restore a maximized grid. Undo restores the grid exactly.',
    hints: 'target = the multiChart ref. rows/cols only with op layout (both null = open Multi Chart as it was); on only with the sync / groupsMode ops; name = the group (pickGroup) or saved grid (applySaved / saveGrid / deleteSaved) as the member said it; direction only with stepGroup. ONE chart’s ticker / timeframe / style is a chart.* action on that cell, not this. Maximizing one cell or resetting one cell to the member’s own chart is multiChart.cell.',
    shape: '{"op":"layout","rows":2,"cols":3,"on":null,"name":null,"direction":null}',
    args: { type: 'object', additionalProperties: false,
      properties: {
        op: { type: 'string', enum: OPS },
        rows: { type: ['integer', 'null'] }, cols: { type: ['integer', 'null'] },
        on: { type: ['boolean', 'null'] },
        name: { type: ['string', 'null'] },
        direction: { type: ['string', 'null'], enum: ['next', 'previous', null] },
      },
      required: ['op', 'rows', 'cols', 'on', 'name', 'direction'] },
    coerce: { direction: { prev: 'previous', back: 'previous', forward: 'next' } },
    // the group list a name is matched against (the picker's own fetch), only when a plan names a group
    async prepare(ops) {
      return ops.some(o => o?.args?.op === 'pickGroup') ? { mcGroups: await fetchGroups() } : {}
    },
    // a delete, and a smaller layout that drops charts, are shown first
    confirmIf: (st, args) => args?.op === 'deleteSaved'
      || (args?.op === 'layout' && args.rows != null && st.mode === 'grid' && symsOf(st.cells.slice(parseLayoutId(`${args.rows}x${args.cols}`).cellCount)).length > 0),
    check: checkSet,
    apply: applySet,
    describe: describeSet,
    noop: noopSet,
  })

  registerCapability({
    name: 'multiChart.cell',
    target: 'gridCell',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    summary: 'ONE Multi Chart cell’s own buttons: maximize it so it covers the whole grid, or “Reset to my chart” (the cell drops its own chart settings and draws the member’s chart settings again; its ticker, timeframe and Style stay). Undo puts it back.',
    hints: 'target = that cell’s ref from charts (the chart the member named or clicked). To un-maximize use multiChart.set op restoreGrid.',
    shape: '{"op":"maximize"}',
    args: { type: 'object', additionalProperties: false, properties: { op: { type: 'string', enum: ['maximize', 'resetToMine'] } }, required: ['op'] },
    coerce: { op: { maximise: 'maximize', expand: 'maximize', reset: 'resetToMine' } },
    check: (st, { op }) => (op === 'maximize' || op === 'resetToMine' ? null : 'That isn’t a cell change I can make.'),
    apply(st, { op }, env) {
      if (op === 'maximize') return st.maxId === env?.target?.ref ? st : { ...st, do: 'maximize', maxId: env?.target?.ref }
      return st.forked ? { ...st, do: 'resetToMine', forked: false } : st
    },
    describe: (b, a, _args, env) => {
      const label = env?.target?.label || 'That chart'
      if (a.do === 'maximize') return `${label} is maximized — it covers the whole grid; the other charts are hidden behind it until you restore the grid`
      if (a.do === 'resetToMine') return `${label} is reset to your chart — it dropped its own settings and uses your shared chart settings again (its ticker, timeframe and Style stay)`
      return null
    },
    noop: (b, a, { op }, env) => (op === 'maximize' ? `${env?.target?.label || 'That chart'} is already maximized` : `${env?.target?.label || 'That chart'} already uses your own chart settings`),
  })
}
