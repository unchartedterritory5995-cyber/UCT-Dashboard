// ── COMPARE PANEL view: Tools → Compare Symbols, its Rotation (RRG-style) and Overlay tabs ─────────────────────────
//
// compare.openView: what a member does by hand on the desktop Charts board — Tools → Compare Symbols opens the panel;
// its Overlay / Rotation tabs switch it; a chart's "Open the rotation map" link opens it on Rotation with that stock's
// group picked. The Agent goes through the SAME door that link uses: the `uct:compare-open` window event
// (COMPARE_OPEN_EVENT, pages/charts/compareAgent.js), detail `{ tab, sym?, group? }`, where `group` is a group TYPE
// resolved for `sym` (the link's own default is 'theme') or `{ type, name }` (a named group, matched by UCT's own list).
//
// A VIEW: the panel is not saved with the layout, and opening it writes nothing — except in two cases the product's
// open path DOES write, which are refused here instead (nothing dispatched):
//   • no chart on the board: openCompare adds a chart widget (a saved layout change) before opening;
//   • the chart the panel works on is on % scale: the panel turns that off and saves it as it mounts.
//
// ⛔ A receipt follows a read-back of the panel's OWN state: open, and the tab it reports on screen (onTabChange).
// ⛔ Phone shell / Multi Chart / another page: "not available here", no event.
// ⛔ Already on that tab (nothing picked): an honest "already" with no dispatch and no Undo.
// Undo is exact where it can be: a panel that was closed is closed again; Overlay → Rotation goes back to Overlay (its
// comparisons are untouched). Leaving Rotation, or picking again on it, has NO Undo: the rotation map starts over when it is
// left or re-picked, so its earlier view cannot be put back exactly (`undoNote` says so).
//
// ≠ the RS indicator's Rotation VIEW (its `view: 'rotation'` input, nativeRegistry): that is an indicator edit.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { GROUP_TYPES, readGroupList } from '../../pages/charts/compareGroups'
import { matchGroup, nameWords } from './compareGroup'

const REF = 'comparePanel'
const LABEL = 'Compare panel (Tools → Compare Symbols)'
export const COMPARE_TABS = ['rotation', 'overlay']
const TYPES = GROUP_TYPES.map(t => t.key)                // theme | sector | industry
const TAB_LABEL = { rotation: 'Rotation', overlay: 'Overlay' }
const NOTHING = 'Nothing was changed.'
const UNREADABLE = `I can't read the Compare panel right now, so I won't change it. Try again in a moment. ${NOTHING}`
export const COMPARE_NOT_HERE = `The Compare panel isn't available here: it opens on the desktop Charts board (not the phone app or Multi Chart). ${NOTHING}`
const NO_CHART = `There's no chart on this board for the Compare panel to work on. Add a chart first, then ask again. ${NOTHING}`
const SCALE_LOCKED = `The chart the Compare panel works on is on % scale, and opening the panel turns % scale off and saves that. Turn % scale off first (or open Tools → Compare Symbols yourself), then ask again. ${NOTHING}`
export const COMPARE_NO_UNDO = 'No Undo for this one: the Rotation map starts over when you leave it or pick again, so its earlier view can\'t be put back exactly. Use the panel\'s Rotation and Overlay tabs.'
const MAX_WAIT_MS = 3000
const settle = () => new Promise(r => setTimeout(r, 40))
const sameJson = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
const typeWord = (t) => (t === 'industry' ? 'industry' : t === 'sector' ? 'sector' : 'theme')
const quote = (s) => `“${s}”`
// the panel's own symbol sanitiser (CompareSymbolsPanel addSymbol): `:` `$` `^` `.` `-` survive
const symOf = (s) => String(s || '').trim().toUpperCase().replace(/[^A-Z0-9.:$^-]/g, '')
const keyOf = (args) => JSON.stringify([String(args?.groupType || 'any'), String(args?.group || '').trim().toLowerCase()])

function readPanel(host) {
  if (!host?.compare) return null                          // not on this page: no target (the kind's `unavailable`)
  let r = null
  try { r = host.compare.read?.() ?? null } catch { r = null }
  if (!r) return { ref: REF, label: LABEL, unreadable: true, here: false, open: false, tab: null, intent: null, hasChart: false, scaleLocked: false }
  const open = !!r.open
  return { ref: REF, label: LABEL, here: r.here !== false, open, tab: open && COMPARE_TABS.includes(r.tab) ? r.tab : null,
    intent: open ? (r.intent ?? null) : null, hasChart: !!r.hasChart, scaleLocked: !open && !!r.scaleLocked }
}
const viewOf = (s) => ({ open: !!s?.open, tab: s?.open ? s.tab ?? null : null })
const pickOf = (d) => ({ sym: d?.sym ?? null, group: d?.group ?? null })
const hasPick = (d) => !!(d && (d.sym || d.group))

async function waitFor(host, ok) {
  const t0 = Date.now()
  for (;;) {
    const s = readPanel(host)
    if (s && !s.unreadable && ok(s)) return s
    if (Date.now() - t0 > MAX_WAIT_MS) return null
    await settle()
  }
}

let seq = 0
export const comparePanelKind = {
  name: 'comparePanel',
  source: 'compare',
  unavailable: COMPARE_NOT_HERE,
  list: (host) => { const s = readPanel(host); return s ? [s] : [] },
  read: (host, ref) => (ref === REF ? readPanel(host) : null),
  stateOf: (s) => ({ ...s, want: null }),
  patch(before, after) {
    const w = after.want
    if (!w) return null
    return { open: { ...w.detail }, set: { open: true, tab: w.tab }, ...(w.pick ? { pick: true } : {}) }
  },
  async commit(host, ref, patch) {
    const c = host?.compare
    if (!c) throw new Error('the Compare panel is not on this page')
    if (patch.close) {
      if (!c.close()) throw new Error('the Compare panel could not be closed')
      if (!await waitFor(host, s => !s.open)) throw new Error('the Compare panel did not close')
      return true
    }
    if (patch.open) {
      // a fresh detail per dispatch, so a re-pick is read back as THIS event's (the workspace keeps the last detail)
      const detail = { ...patch.open, agentSeq: ++seq }
      if (!c.open(detail)) throw new Error('the Compare panel did not take the request')
      const ok = (s) => sameJson(viewOf(s), patch.set) && (!patch.pick || sameJson(s.intent, detail))
      if (!await waitFor(host, ok)) throw new Error(`the Compare panel did not open on its ${TAB_LABEL[patch.set.tab] || ''} tab`)
      return true
    }
    return false
  },
  landed(snap, patch) {
    if (!snap || snap.unreadable) return false
    if (patch.close) return !snap.open
    if (patch.open) return sameJson(viewOf(snap), patch.set) && (!patch.pick || sameJson(pickOf(snap.intent), pickOf(patch.open)))
    return false
  },
  undoPatch(item) {
    const p = item.patch || {}
    const b = item.before || {}
    if (!p.open) return null
    if (!b.open) return { close: true }                                          // it was closed: close it again (exact)
    if (b.tab === 'overlay') return { open: { tab: 'overlay' }, set: { open: true, tab: 'overlay' } }   // its comparisons never moved
    return null                                                                  // left or re-picked Rotation: not exact (COMPARE_NO_UNDO)
  },
  // stale once the member opened, closed or switched the panel themselves
  fingerprint: (s) => (s ? JSON.stringify(viewOf(s)) : 'gone'),
}

/** One request's named group, through UCT's own group lists (/api/compare/groups) → `{ group }` or `{ refuse }`. */
async function lookUp(args) {
  const types = TYPES.includes(args?.groupType) ? [args.groupType] : TYPES
  const kinds = types.length === 1 ? typeWord(types[0]) : 'theme, sector or industry'
  if (!nameWords(args?.group).length) return { refuse: `Which ${kinds} should the Rotation map show? Name the group. ${NOTHING}` }
  const lists = await Promise.all(types.map(t => readGroupList(t)))
  const failed = types.filter((t, i) => lists[i] == null)
  const candidates = types.flatMap((t, i) => (lists[i] || []).map(g => ({ name: g.name, type: t })))
  const m = matchGroup(args.group, candidates)
  // ⛔ a list that could not be read is never "no such group": only an exact single match elsewhere may act
  if (failed.length && !(m.hit && nameWords(m.hit.name).join(' ') === nameWords(args.group).join(' '))) {
    return { refuse: `I couldn't read the ${failed.map(typeWord).join(' and ')} list just now, so I can't tell which group ${quote(args.group)} is. ${NOTHING}` }
  }
  if (m.many) {
    const shown = m.many.slice(0, 8).map(c => (types.length > 1 ? `${c.name} (${typeWord(c.type)})` : c.name)).join(', ')
    return { refuse: `More than one group matches ${quote(args.group)}: ${shown}${m.many.length > 8 ? `, and ${m.many.length - 8} more` : ''}. Which one did you mean? ${NOTHING}` }
  }
  if (m.none) return { refuse: `UCT has no ${kinds} called ${quote(args.group)}. ${NOTHING}` }
  return { group: { type: m.hit.type, name: m.hit.name } }
}

function detailOf(args, env) {
  if (args.tab !== 'rotation') return { tab: 'overlay' }
  if (args.group) return { tab: 'rotation', group: { ...env.comparePanelGroups.get(keyOf(args)).group } }
  const sym = symOf(args.symbol)
  if (sym) return { tab: 'rotation', sym, group: TYPES.includes(args.groupType) ? args.groupType : 'theme' }   // the link's own default
  return { tab: 'rotation' }
}

let registered = false
export function registerComparePanelCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(comparePanelKind)
  registerContextProvider({
    key: 'comparePanel',
    build: (host, refFor) => {
      const s = readPanel(host)
      if (!s || !s.here) return undefined
      return [{ ref: refFor('comparePanel', REF), label: s.label, ...(s.unreadable ? { unavailable: true } : {}), open: s.open ? (TAB_LABEL[s.tab] || 'open') : null }]
    },
  })

  registerCapability({
    target: 'comparePanel', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts',
    name: 'compare.openView',
    summary: 'Open the Compare panel (Tools → Compare Symbols) on its Rotation tab — the RRG-style relative-rotation map — or its Overlay tab, or switch between them; optionally show one stock\'s theme / sector / industry, or a named group, on the Rotation map. A view: nothing saved.',
    hints: 'tab = rotation | overlay. For rotation: symbol = a ticker to show its group ("rotation map for NVDA"), groupType = theme | sector | industry (default theme); or group = a group NAME as said ("semis") with groupType when said. Else null. The RS INDICATOR\'s Rotation view is indicator.update, not this.',
    args: { type: 'object', properties: {
      tab: { type: 'string', enum: COMPARE_TABS },
      symbol: { type: ['string', 'null'] },
      groupType: { type: ['string', 'null'], enum: [...TYPES, null] },
      group: { type: ['string', 'null'] },
    }, required: ['tab', 'symbol', 'groupType', 'group'], additionalProperties: false },
    argAliases: { tab: ['view'], symbol: ['sym', 'ticker'] },
    coerce: { tab: { rrg: 'rotation', 'rotation map': 'rotation', 'relative rotation': 'rotation', overlays: 'overlay' }, groupType: { themes: 'theme', sectors: 'sector', industries: 'industry', any: null } },
    defaults: { tab: 'rotation' },
    async prepare(ops) {
      const out = new Map()
      for (const o of ops) {
        if (o?.args?.tab === 'rotation' && o.args.group && !out.has(keyOf(o.args))) out.set(keyOf(o.args), await lookUp(o.args))
      }
      return { comparePanelGroups: out }
    },
    check(st, args, env) {
      if (!st || st.unreadable) return UNREADABLE
      if (!st.here) return COMPARE_NOT_HERE
      if (!COMPARE_TABS.includes(args?.tab)) return 'The Rotation tab (the rotation map) or the Overlay tab?'
      if (st.open && !st.tab) return UNREADABLE
      if (!st.open && !st.hasChart) return NO_CHART
      if (!st.open && st.scaleLocked) return SCALE_LOCKED
      if (args.tab === 'rotation' && args.group) {
        const r = env?.comparePanelGroups?.get?.(keyOf(args))
        if (!r) return `I couldn't look that group up. ${NOTHING}`
        if (r.refuse) return r.refuse
      }
      return null
    },
    apply(st, args, env) {
      const detail = detailOf(args, env)
      const pick = hasPick(detail)
      if (st.open && st.tab === args.tab && !pick) return st                     // already there: no dispatch, no Undo
      return { ...st, open: true, tab: args.tab, want: { tab: args.tab, detail, pick } }
    },
    describe(b, a) {
      const w = a.want
      if (!w) return null
      const T = TAB_LABEL[w.tab]
      const head = b.open ? `Switched the Compare panel to its ${T} tab` : `Opened the Compare panel (Tools → Compare Symbols) on its ${T} tab`
      const d = w.detail
      const pick = d.group && typeof d.group === 'object' ? `, showing the ${d.group.name} ${typeWord(d.group.type)} on the rotation map`
        : d.sym ? `, showing ${d.sym}'s ${typeWord(d.group)} on the rotation map (the map says so if none is on file)` : ''
      return `${head}${pick} — a view, nothing saved`
    },
    noop: (b, a, args) => `The Compare panel is already open on its ${TAB_LABEL[args?.tab] || ''} tab`,
    undoNote: COMPARE_NO_UNDO,
  })
}
