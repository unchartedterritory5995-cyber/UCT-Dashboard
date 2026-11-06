// ── MULTI CHART AS A MODE: going in and out, its shape, its options, its groups and its saved grids ─────────────────────
//
// Everything Layouts ▸ Multi Chart offers a person (pages/charts/grid/MultiChartMenu.jsx, GroupPicker.jsx, GridChartCell.jsx),
// through the hook that menu writes with (host.multiChartBoard, agent/host.js). A cell's ticker, timeframe, style, drawings
// and indicators are not here: a cell is an ordinary chart target (agent/gridMode.js says what does not carry over).
//
//   kind multiChart        the grid itself, on screen or not. boardScoped: false: it is the member's one grid, whichever
//                          layout is open, and an Undo has to cross the mode change it made.
//   kind gridCell          one cell, for what only a cell has (maximize, reset). It is chart-backed (`chartRef`), so every
//                          rule about which chart a member meant applies to it unchanged: a click never stands in for a
//                          described chart (deixis.js), and a hidden cell is refused (gridMode.js).
//   kind multiChartSaved   the member's saved grids.
//
// ⭐ READ-BACK BEFORE ANY CLAIM. A commit writes, waits until the hook's state says it landed, then saves through the
// hook's own flush (`persistsInCommit`). If it did not land or did not save, the commit puts back what it touched and reads
// that back too: runtime's "nothing was left changed" is only said after a confirmed revert (`unreverted` otherwise).
// ⭐ EXACT UNDO. A patch names the fields it `touched`; Undo restores those and no others (restoreFields), and is refused
// only if one of THOSE fields changed since. A smaller layout drops its tail cells: they come back whole.
// ⛔ A layout this file cannot make is refused, never clamped: makeLayout quietly cuts anything past 4 rows or 4 columns.
// ⛔ There is no symbol or timeframe sync in Multi Chart. Both are in the option enum so that a request for one gets the
// truth and nothing runs; a capability that left them out would invite the planner to fake one with chart.setSetting.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { afterRender } from '../frames'
import { neighborGroup } from '../../pages/charts/grid/groupRecents'
import { fetchGroups } from '../../pages/charts/grid/groupsApi'
import { LAYOUTS, GRID_MAX_CELLS, makeLayout, parseLayoutId } from '../../pages/charts/grid/gridLayouts'

const REF = 'multiChart'
const SAVED_REF = 'multiChartSaved'
const SETTLE_MS = 4000
const SAVE_FAILED = 'the server did not confirm the change, so it is not saved'
const NOT_READY = 'Multi Chart is still loading your saved grid. Ask again in a moment.'
const IN_GRID_ONLY = 'that only exists inside Multi Chart, and you are on the Charts board. Switch to Multi Chart first.'

const FIELDS = ['mode', 'layout', 'cells', 'syncCrosshair', 'syncTimeRange', 'groupsMode', 'group', 'maximized']
const OPTIONS = { crosshair_sync: ['syncCrosshair', 'Crosshair sync'], time_range_sync: ['syncTimeRange', 'Time-range sync'], groups_mode: ['groupsMode', 'Groups mode'] }
const NO_SUCH_OPTION = {
  symbol_sync: 'Multi Chart has no symbol sync: every cell keeps its own ticker. I can put one ticker on the cells you name.',
  timeframe_sync: 'Multi Chart has no timeframe sync: every cell keeps its own timeframe. I can set one timeframe on the cells you name.',
}
const OPTION_IDS = [...Object.keys(OPTIONS), 'maximized', ...Object.keys(NO_SUCH_OPTION)]
const pick = (o, keys) => Object.fromEntries(keys.map(k => [k, o?.[k]]))
const cellSig = (cells) => (cells || []).map(c => [c.id, c.sym || null, c.tf, c.chartType ?? null, c.settings ?? null])
const fieldSig = (s, k) => (k === 'cells' ? cellSig(s?.cells) : k === 'group' ? (s?.group?.id ?? null) : s?.[k] ?? null)
const sigOf = (s, keys) => JSON.stringify(keys.map(k => fieldSig(s, k)))
const shapeWord = (id) => { const l = parseLayoutId(id); return `${l.rows}×${l.cols}` }
const andNames = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`)
const groupName = (g) => g?.name || g?.id || 'that group'

function snapOf(host) {
  const b = host?.multiChartBoard
  const s = b?.read?.()
  if (!s) return null
  const { global, mine } = b.saved()
  return { ref: REF, label: 'Multi Chart', ...s, savedList: [...mine, ...global] }
}

/** "2x2" | "2 x 2" | "2×2" | "2 by 2" → the layout it names exactly, or null. Nothing here rounds a shape to one that fits. */
export function exactLayout(words) {
  const m = /^\s*(\d+)\s*(?:x|×|by)\s*(\d+)\s*$/i.exec(String(words ?? ''))
  if (!m) return null
  const l = makeLayout(Number(m[1]), Number(m[2]))
  return l.rows === Number(m[1]) && l.cols === Number(m[2]) ? l : null
}

/** A name the words pick out of `rows`: exact, else the one name containing them. → { hit } | { many } | {} */
function matchNamed(rows, words) {
  const w = String(words || '').trim().toLowerCase()
  if (!w) return {}
  const exact = rows.filter(r => String(r.name || '').toLowerCase() === w || String(r.id).toLowerCase() === w)
  const list = exact.length ? exact : rows.filter(r => String(r.name || '').toLowerCase().includes(w))
  return list.length === 1 ? { hit: list[0] } : list.length ? { many: list } : {}
}

function touchedBy(before, set) {
  const keys = new Set(Object.keys(set))
  if ('layout' in set) keys.add('cells')
  if (set.groupsMode === false && before.group) keys.add('group')
  return FIELDS.filter(k => keys.has(k))
}

function write(board, patch) {
  const { set } = patch
  if (patch.restore) {
    const { maximized: _maximized, ...fields } = set
    if (Object.keys(fields).length) board.restore(fields)
    return
  }
  if (set.mode === 'workspace') board.exit()
  else if (set.mode === 'grid' || 'layout' in set) board.enter(set.layout)
  if ('syncCrosshair' in set) board.setSyncCrosshair(set.syncCrosshair)
  if ('syncTimeRange' in set) board.setSyncTimeRange(set.syncTimeRange)
  if ('groupsMode' in set) board.setGroupsMode(set.groupsMode)
  if (set.maximized !== undefined) board.setMaximized(set.maximized)
}

export const multiChartKind = {
  name: REF,
  boardScoped: false,
  selfDescribing: true,
  persistsInCommit: true,
  list: (host) => { const s = snapOf(host); return s ? [s] : [] },
  read: (host, ref) => (ref === REF ? snapOf(host) : null),
  stateOf: (s) => ({ ...pick(s, FIELDS), load: null, template: null, hydrated: s.hydrated }),
  patch(before, after) {
    if (after.template) return { template: after.template, set: { mode: 'grid', layout: after.layout }, touched: ['mode', 'layout', 'cells', 'groupsMode', 'group'] }
    if (after.load) return { load: after.load, set: {}, touched: ['mode', 'cells', 'groupsMode', 'group'] }
    const set = {}
    for (const k of FIELDS) if (k !== 'cells' && k !== 'group' && after[k] !== before[k]) set[k] = after[k]
    return Object.keys(set).length ? { set, touched: touchedBy(before, set) } : null
  },
  async commit(host, ref, patch) {
    const board = host.multiChartBoard
    const undo = multiChartKind.undoPatch({ before: snapOf(host), patch })
    const settled = async (p) => {
      const t0 = Date.now()
      for (;;) {
        await afterRender()
        // an Undo back into the grid: a cell can be maximized again only once the grid has mounted
        if (p.restore && 'maximized' in p.set && board.mounted() && (board.read().maximized ?? null) !== (p.set.maximized ?? null)) board.setMaximized(p.set.maximized ?? null)
        if (multiChartKind.landed(snapOf(host), p)) return true
        if (Date.now() - t0 > SETTLE_MS) return false
      }
    }
    // Which cell is maximized is this screen's, as it is for a click; everything else goes through the hook's own save.
    const save = async (p) => {
      if (p.touched.every(k => k === 'maximized')) return { ok: true }
      try { return (await board.persist()) || { ok: false } } catch { return { ok: false } }
    }
    const fail = async (reason) => {
      write(board, undo)
      const back = (await settled(undo)) && (await save(undo)).ok
      const e = new Error(reason)
      if (!back) e.unreverted = true
      throw e
    }
    let lines = null
    let told = patch
    if (patch.load) {
      // the group is looked up before anything is written, so this refusal leaves the grid as it was
      const res = patch.load.refresh ? await board.refreshGroup() : await board.loadGroup(patch.load)
      if (!res?.ok) throw new Error(res?.reason || 'that group did not load')
      told = { ...patch, set: { mode: 'grid', groupsMode: true }, syms: res.syms }
      lines = [`${patch.load.refresh ? 'Refreshed' : 'Loaded'} ${groupName(patch.load)}: ${andNames(res.syms)}`]
    } else if (patch.template) {
      const tpl = board.openSaved(patch.template.id)
      if (!tpl) throw new Error('that saved grid is gone')
      const n = parseLayoutId(tpl.layout.layout).cellCount
      told = { ...patch, syms: (tpl.layout.cells || []).slice(0, n).map(c => (typeof c?.sym === 'string' && c.sym.trim() ? c.sym.trim().toUpperCase() : null)) }
    } else {
      write(board, patch)
    }
    patch.syms = told.syms
    if (!(await settled(told))) return fail('did not take effect')
    if (!(await save(told)).ok) return fail(SAVE_FAILED)
    return lines ? { lines } : true
  },
  landed(s, patch) {
    if (!s) return false
    if (patch.restore) return patch.touched.every(k => sigOf(s, [k]) === sigOf(patch.set, [k]))
    if (!Object.entries(patch.set).every(([k, v]) => (s[k] ?? null) === (v ?? null))) return false
    if ('layout' in patch.set && s.cells.length !== parseLayoutId(patch.set.layout).cellCount) return false
    if (patch.syms && JSON.stringify(s.cells.map(c => c.sym || null).slice(0, patch.syms.length)) !== JSON.stringify(patch.syms)) return false
    return true
  },
  undoPatch: (item) => (item.patch?.touched ? { restore: true, set: pick(item.before, item.patch.touched), touched: item.patch.touched } : null),
  fingerprint: (s) => sigOf(s, FIELDS),
  fingerprintFor: (host, s, item) => sigOf(s, item.patch?.touched || FIELDS),
}

// ── one cell ─────────────────────────────────────────────────────────────────────────────────────────────────────────
function cellSnap(host, c) {
  const s = host.multiChartBoard.read()
  const settings = s.cells.find(x => x.id === c.ref)?.settings ?? null
  return { ref: c.ref, chartRef: c.ref, label: c.label, position: c.position ?? null, symbol: c.symbol, tf: c.tf,
    maximized: s.maximized === c.ref, settings, ...(c.selected ? { selected: true } : {}) }
}
const cellsOn = (host) => (host?.multiChartBoard?.mounted?.() ? (host.charts?.list?.() || []) : [])
export const gridCellKind = {
  name: 'gridCell',
  list: (host) => cellsOn(host).map(c => cellSnap(host, c)),
  read: (host, ref) => { const c = cellsOn(host).find(x => x.ref === ref); return c ? cellSnap(host, c) : null },
  stateOf: (s) => pick(s, ['maximized', 'settings', 'label']),
  groupOf: (ref) => ref,
  patch(before, after) {
    if (after.maximized !== before.maximized) return { maximized: after.maximized }
    return after.settings !== before.settings ? { settings: after.settings, from: before.settings } : null
  },
  async commit(host, ref, patch) {
    if ('maximized' in patch) { host.multiChartBoard.setMaximized(patch.maximized ? ref : null); return true }
    return host.multiChartBoard.setCellSettings(ref, patch.settings)
  },
  landed(s, patch) {
    if (!s) return false
    return 'maximized' in patch ? s.maximized === patch.maximized : JSON.stringify(s.settings ?? null) === JSON.stringify(patch.settings ?? null)
  },
  undoPatch: (item) => ('maximized' in (item.patch || {}) ? { maximized: !item.patch.maximized } : item.patch ? { settings: item.patch.from, from: item.patch.settings } : null),
  fingerprint: (s) => JSON.stringify([s.maximized, s.settings ?? null]),
  fingerprintFor: (host, s, item) => JSON.stringify('maximized' in (item.patch || {}) ? [s.maximized] : [s.settings ?? null]),
}

// ── saved grids ──────────────────────────────────────────────────────────────────────────────────────────────────────
function savedSnap(host) {
  const b = host?.multiChartBoard
  if (!b) return null
  const { global, mine } = b.saved()
  return { ref: SAVED_REF, label: 'Saved grids', global, mine, gridOn: b.read()?.mode === 'grid' }
}
export const multiChartSavedKind = {
  name: SAVED_REF,
  boardScoped: false,
  selfDescribing: true,
  persistsInCommit: true,
  list: (host) => { const s = savedSnap(host); return s ? [s] : [] },
  read: (host, ref) => (ref === SAVED_REF ? savedSnap(host) : null),
  stateOf: (s) => ({ global: s.global, mine: s.mine, gridOn: s.gridOn, save: null, remove: null }),
  patch: (before, after) => (after.save ? { save: after.save } : after.remove ? { remove: after.remove } : null),
  async commit(host, ref, patch) {
    const board = host.multiChartBoard
    if (patch.save) await board.saveGrid(patch.save)
    else {
      const row = savedSnap(host).mine.find(r => r.name === patch.remove.name)
      if (!row) throw new Error('that saved grid is gone')
      await board.deleteSaved(row.id)
    }
    const t0 = Date.now()
    while (!multiChartSavedKind.landed(savedSnap(host), patch)) {
      if (Date.now() - t0 > SETTLE_MS) {
        // the server took it and the list has not shown it: never "nothing was left changed"
        const e = new Error('the saved grids did not update, so check that list')
        e.unreverted = true
        throw e
      }
      await afterRender()
    }
    return true
  },
  landed: (s, patch) => !!s && s.mine.some(r => r.name === (patch.save ?? patch.remove.name)) === !!patch.save,
  // a grid the Agent saved can be taken back; a deleted one cannot (its cells are gone with it)
  undoPatch: (item) => (item.patch?.save ? { remove: { name: item.patch.save } } : null),
  fingerprint: (s) => JSON.stringify([s.global.map(r => r.id), s.mine.map(r => r.id)]),
  fingerprintFor: (host, s, item) => JSON.stringify(s.mine.some(r => r.name === item.patch?.save)),
}

let registered = false
export function registerMultiChartCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(multiChartKind)
  registerTargetKind(gridCellKind)
  registerTargetKind(multiChartSavedKind)
  registerContextProvider({
    key: REF,
    // Only what the menu shows. A cell's settings and a group's internals stay out; the cells are in the charts section.
    build(host, refFor) {
      const s = snapOf(host)
      if (!s) return undefined
      const on = s.mode === 'grid'
      const names = s.savedList.map(r => r.name).slice(0, 20)
      // an option that is off is left out: a quiet grid costs no bytes on every turn, and the model says what it reads here
      return [{ ref: refFor(REF, REF), label: 'Multi Chart', on, layout: shapeWord(s.layout),
        ...(s.syncCrosshair ? { crosshairSync: true } : {}), ...(s.syncTimeRange ? { timeRangeSync: true } : {}), ...(s.groupsMode ? { groupsMode: true } : {}),
        ...(s.group ? { group: groupName(s.group) } : {}), ...(s.maximized ? { maximized: true } : {}) },
      ...(names.length || on ? [{ ref: refFor(SAVED_REF, SAVED_REF), label: 'Saved grids', names }] : [])]
    },
  })

  const common = { target: REF, surfaces: ['charts'] }
  const notReady = (st) => (st.hydrated === false ? NOT_READY : null)
  const noArgs = { type: 'object', properties: {}, required: [], additionalProperties: false }
  const named = { type: 'object', properties: { name: { type: 'string' } }, required: ['name'], additionalProperties: false }

  registerCapability({
    ...common, name: 'multiChart.enter',
    exclusive: true,
    exclusiveReason: 'Switching Multi Chart replaces the charts on screen, so do it in two steps: switch first, then ask for the chart changes.',
    summary: 'Switch to Multi Chart or change its shape.',
    hints: `Multi Chart is the full-screen grid of independent chart cells; chartGrid.set lays out charts on the board instead. target = the Multi Chart entry. layout = rows x columns, 1 to 4 each: ${LAYOUTS.map(l => l.id).join(', ')} or any other shape up to 4x4 (1x2 side by side, 2x1 stacked), or null for the grid it had. A chart count that fits two shapes is a question for the member.`,
    args: { type: 'object', properties: { layout: { type: ['string', 'null'] } }, required: ['layout'], additionalProperties: false },
    check(st, args) {
      if (args.layout != null && !exactLayout(args.layout)) return `Multi Chart grids go up to 4 rows by 4 columns (${GRID_MAX_CELLS} charts), written like 2x3, so I can't make “${String(args.layout).slice(0, 12)}”.`
      return notReady(st)
    },
    apply(st, args) {
      const layout = args.layout == null ? st.layout : exactLayout(args.layout).id
      return st.mode === 'grid' && layout === st.layout ? st : { ...st, mode: 'grid', layout }
    },
    noop: (st) => `Multi Chart is already on, ${shapeWord(st.layout)}`,
    describe(before, after) {
      const n = parseLayoutId(after.layout).cellCount
      const lost = after.layout === before.layout ? [] : before.cells.slice(n).map(c => c.sym).filter(Boolean)
      const head = before.mode === 'grid' ? `Changed Multi Chart to ${shapeWord(after.layout)}` : `Switched to Multi Chart (${shapeWord(after.layout)})`
      return lost.length ? `${head}. ${andNames(lost)} no longer ${lost.length === 1 ? 'fits' : 'fit'} in the grid` : head
    },
  })

  registerCapability({
    ...common, name: 'multiChart.exit',
    exclusive: true,
    exclusiveReason: 'Leaving Multi Chart replaces the charts on screen, so do it in two steps: leave first, then ask for the chart changes.',
    summary: 'Leave Multi Chart for the Charts board.',
    hints: 'target = the Multi Chart entry. The grid keeps its charts for next time.',
    args: noArgs,
    check: (st) => notReady(st),
    apply: (st) => (st.mode === 'grid' ? { ...st, mode: 'workspace', maximized: null } : st),
    noop: () => 'Multi Chart is already off',
    describe: () => 'Back on the Charts board. Multi Chart keeps its grid',
  })

  registerCapability({
    ...common, name: 'multiChart.setOption',
    summary: 'Set crosshair sync, time-range sync or Groups mode, or restore a maximized grid.',
    hints: `target = the Multi Chart entry. option = ${OPTION_IDS.join('|')} (symbol_sync and timeframe_sync do not exist in UCT: name them and UCT says so). Each can be set with Multi Chart on or off, but maximized only takes on = false, which restores the grid after a cell was maximized. on = true, false, or null to flip it. One op per option. Turning Groups mode off keeps the charts and clears the group.`,
    args: { type: 'object', properties: { option: { type: 'string', enum: OPTION_IDS }, on: { type: ['boolean', 'null'] } }, required: ['option', 'on'], additionalProperties: false },
    check(st, args) {
      if (args.option !== 'maximized') return NO_SUCH_OPTION[args.option] || notReady(st)
      if (st.mode !== 'grid') return IN_GRID_ONLY
      return args.on === false ? null : 'name the cell to maximize.'
    },
    apply(st, args) {
      if (args.option === 'maximized') return st.maximized ? { ...st, maximized: null } : st
      const key = OPTIONS[args.option][0]
      const want = args.on == null ? !st[key] : !!args.on
      return st[key] === want ? st : { ...st, [key]: want }
    },
    noop: (st, _after, args) => (args.option === 'maximized' ? 'No cell is maximized' : `${OPTIONS[args.option][1]} is already ${st[OPTIONS[args.option][0]] ? 'on' : 'off'}`),
    describe(before, after, args) {
      if (args.option === 'maximized') return 'Restored the grid'
      const [key, label] = OPTIONS[args.option]
      if (before[key] === after[key]) return null
      const tail = after.mode === 'grid' ? '' : ' (it applies when Multi Chart is on)'
      return `${label} ${after[key] ? 'on' : 'off'}${!after[key] && key === 'groupsMode' && before.group ? `: ${groupName(before.group)} cleared, the charts stay` : ''}${tail}`
    },
  })

  registerCapability({
    ...common, name: 'multiChart.loadGroup',
    summary: 'Load, step or refresh a theme group in Multi Chart.',
    hints: 'Turns Multi Chart and Groups mode on. target = the Multi Chart entry. group = the group\'s name in the member\'s words, or null; step = next|previous|refresh, or null. Exactly one of them. UCT matches the name and says so when several fit.',
    args: { type: 'object', properties: { group: { type: ['string', 'null'] }, step: { type: ['string', 'null'], enum: ['next', 'previous', 'refresh', null] } }, required: ['group', 'step'], additionalProperties: false },
    async prepare(ops) {
      return ops.some(o => o?.args?.group || (o?.args?.step && o.args.step !== 'refresh')) ? { multiChartGroups: await fetchGroups() } : {}
    },
    check(st, args, env) {
      if (!!args.group === !!args.step) return 'name one group, or say next, previous or refresh.'
      if (args.step) {
        if (!st.group) return 'there is no group loaded in Multi Chart. Name one.'
        if (args.step !== 'refresh' && String(st.group.id).startsWith('industry:')) return 'industry cohorts have no next or previous group. Name one.'
      }
      if (args.step === 'refresh') return notReady(st)
      const list = env?.multiChartGroups
      if (!Array.isArray(list) || !list.length) return 'I could not read the list of groups just now.'
      if (args.group) {
        const m = matchNamed(list, args.group)
        if (m.many) return `several groups fit “${args.group}”: ${m.many.slice(0, 8).map(g => g.name).join(', ')}. Which one?`
        if (!m.hit) return `there is no group called “${args.group}”.`
      } else if (!neighborGroup(list, st.group.id, args.step === 'next' ? 1 : -1)) return 'there is no neighboring group.'
      return notReady(st)
    },
    apply(st, args, env) {
      if (args.step === 'refresh') return { ...st, load: { ...st.group, refresh: true } }
      const list = env.multiChartGroups
      const hit = args.group ? matchNamed(list, args.group).hit
        : list.find(g => g.id === neighborGroup(list, st.group.id, args.step === 'next' ? 1 : -1))
      return { ...st, load: { id: hit.id, name: hit.name, by: st.group?.by || 'today', recent: !!args.group } }
    },
    // the receipt is what landed (the commit's own lines); this only names the plan on a proposal card
    describe: (before, after) => `${after.load.refresh ? 'Refreshed' : 'Loaded'} ${groupName(after.load)}`,
  })

  registerCapability({
    ...common, name: 'multiChart.openSaved',
    exclusive: true,
    exclusiveReason: 'Opening a saved grid replaces the charts on screen, so do it in two steps: open it first, then ask for the chart changes.',
    summary: 'Open a saved Multi Chart grid.',
    hints: 'target = the Multi Chart entry. name = one of the Saved grids entry\'s names, in the member\'s words. UCT matches it and says so when several fit.',
    args: named,
    check(st, args, env) {
      const m = matchNamed(env.target.savedList, args.name)
      if (m.many) return `several saved grids fit “${args.name}”: ${m.many.slice(0, 8).map(r => r.name).join(', ')}. Which one?`
      return m.hit ? notReady(st) : `there is no saved grid called “${args.name}”.`
    },
    apply(st, args, env) {
      const { hit } = matchNamed(env.target.savedList, args.name)
      return { ...st, layout: parseLayoutId(hit.layout).id, template: { id: hit.id, name: hit.name } }
    },
    describe: (before, after) => `Opened the saved grid “${after.template.name}” (${shapeWord(after.layout)})`,
  })

  registerCapability({
    target: 'gridCell', surfaces: ['charts'], name: 'multiChart.cell', chartIsItsArgument: true,
    summary: 'Maximize one Multi Chart cell, or reset it to my chart settings.',
    hints: 'target = the ref of the cell in `charts`. do = maximize|reset. Reset drops the settings only that cell has.',
    args: { type: 'object', properties: { do: { type: 'string', enum: ['maximize', 'reset'] } }, required: ['do'], additionalProperties: false },
    check: () => null,
    apply(st, args) {
      if (args.do === 'maximize') return st.maximized ? st : { ...st, maximized: true }
      return st.settings ? { ...st, settings: null } : st
    },
    noop: (st, _after, args) => (args.do === 'maximize' ? `${st.label} is already maximized` : `${st.label} already uses your chart settings`),
    describe: (before, after, args) => (args.do === 'maximize' ? `Maximized ${before.label}` : `Reset ${before.label} to your chart settings`),
  })

  registerCapability({
    target: SAVED_REF, surfaces: ['charts'], name: 'multiChart.saveGrid',
    summary: 'Save the Multi Chart grid under a new name.',
    hints: 'target = the Saved grids entry. name = the new name, 60 characters at most. Keeps its tickers and timeframes; never replaces a saved grid.',
    args: named,
    check(st, args) {
      const nm = String(args.name || '').trim()
      if (!nm || nm.length > 60) return 'a saved grid needs a name of 1 to 60 characters.'
      if (!st.gridOn) return 'there is no grid on screen to save. Switch to Multi Chart first.'
      if ([...st.mine, ...st.global].some(r => r.name.toLowerCase() === nm.toLowerCase())) return `you already have a saved grid called “${nm}”. Pick another name; I won't replace it.`
      return null
    },
    apply: (st, args) => ({ ...st, save: String(args.name).trim() }),
    describe: (before, after) => `Saved this grid as “${after.save}”`,
  })

  registerCapability({
    target: SAVED_REF, surfaces: ['charts'], name: 'multiChart.deleteSaved',
    risk: 'confirm', reversible: false, undo: 'none',
    undoNote: 'A deleted grid cannot be brought back.',
    summary: 'Delete a saved Multi Chart grid. Permanent.',
    hints: 'target = the Saved grids entry. name = the grid\'s name. Only the member\'s own; prebuilt grids cannot be deleted here.',
    args: named,
    check(st, args) {
      const m = matchNamed(st.mine, args.name)
      if (m.many) return `several of your saved grids fit “${args.name}”: ${m.many.slice(0, 8).map(r => r.name).join(', ')}. Which one?`
      return m.hit ? null : `you have no saved grid called “${args.name}”.`
    },
    apply: (st, args) => ({ ...st, remove: { name: matchNamed(st.mine, args.name).hit.name } }),
    describe: (before, after) => `Deleted the saved grid “${after.remove.name}”`,
  })
}
