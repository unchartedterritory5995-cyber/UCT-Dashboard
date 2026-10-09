// ── INDICATORS (M1): read the indicators on a chart; open Create Indicator ─────────
//
// The Agent half of the Indicators ⇄ Agent contract (docs/indicators/AGENT-INTEGRATION-HANDOFF.md
// §11, docs/agent/M1-INDICATORS-PLAN.md). Indicators owns what an indicator IS; this file only
// READS through the owner's seam and OPENS the owner's panel:
//
//   indicator.list        a query: `instancesOf(cs, nativeRegistry)` for one chart, as a table.
//                         Never a second reader of `indicatorInstances`.
//   indicator.openCreate  opens the EXISTING Create Indicator panel through the chart's own
//                         opener (ChartPane → StockChart → ChartToolbar.openCreateIndicatorFor),
//                         with the member's request PREFILLED (`seedFrom`) — never sent.
//
// ⛔ NO WRITE. Nothing here touches chart settings, `indicatorInstances`, `/converse` or
// `/api/user-definitions`. Opening the panel is the only effect; whatever the member does in
// it afterwards (Send, preview, Save) is the panel's own flow, approved by the member there.
// ⛔ ACCESS IS THE OWNER'S. The action is offered only when `createIndicatorAccess` (the
// button's own rule) says yes for this member; the chart's `canCreateIndicator()` is checked
// at planning, the snapshot fingerprint re-checks it at Apply, and the opener checks it AGAIN
// itself. `/converse` enforces it server-side whatever the browser says.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { instancesOf, seedFrom, SEED_MAX } from '../../components/chart/builder/agentSeams'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'

const REF = 'ind:'
const refOf = (chartRef) => `${REF}${chartRef}`
const chartRefOf = (ref) => (typeof ref === 'string' && ref.startsWith(REF) ? ref.slice(REF.length) : null)

/** The indicators on one chart, exactly as the owner's seam lists them. */
export function indicatorsOn(cs) {
  try { return instancesOf(cs, nativeRegistry) } catch { return [] }
}

const snapOf = (host, c) => ({
  ref: refOf(c.ref), chartRef: c.ref, label: c.label, position: c.position || null, symbol: c.symbol,
  indicators: indicatorsOn(c.cs),
  canCreate: (() => { try { return !!host.charts.canCreateIndicator?.(c.ref) } catch { return false } })(),
})

export const indicatorsKind = {
  name: 'indicators',
  undoable: false,                 // opening a panel is not a change Undo can take back
  selfDescribing: true,
  list: (host) => (host?.charts ? host.charts.list().map(c => snapOf(host, c)) : []),
  read: (host, ref) => {
    const c = chartRefOf(ref) && host?.charts?.read(chartRefOf(ref))
    return c ? snapOf(host, c) : null
  },
  stateOf: (s) => ({ chart: s.label, symbol: s.symbol, canCreate: s.canCreate, indicators: s.indicators, open: null }),
  patch: (before, after) => (after.open ? { open: after.open } : null),
  async commit(host, ref, patch) {
    const { defId = null, seed = null } = patch.open
    const res = host.charts.openCreateIndicator?.(chartRefOf(ref), { ...(defId ? { defId } : {}), ...(seed ? { seed } : {}) })
      || { ok: false, reason: 'unavailable', prefilled: false, draft: false, editing: false }
    if (!res.ok) throw new Error(OPENER_REFUSALS[res.reason] || OPENER_REFUSALS.unavailable)
    return { lines: [openedLine(res, patch.open)] }
  },
  // The opener's own `{ok:true}` is the read-back: the panel is React state of the chart's
  // toolbar, not a stored value this kind could re-read.
  landed: () => true,
  undoPatch: () => null,
  // Access and the member's saved definitions (what `defId` may name) — what a plan relies on.
  // A change between planning and Apply refuses ("changed while I was working").
  fingerprint: (s) => JSON.stringify([s.chartRef, s.canCreate, s.indicators.filter(i => i.kind === 'custom').map(i => i.defId)]),
}

// The opener's refusal vocabulary (ChartToolbar.openCreateIndicatorFor `reason`).
export const OPENER_REFUSALS = {
  access: 'Create Indicator isn’t available for your account.',
  readonly: 'That chart can’t open Create Indicator.',
  'unknown-definition': 'I couldn’t find that indicator among your saved indicators.',
  unavailable: 'Create Indicator isn’t reachable on that chart right now.',
}

/** The receipt — from what the opener SAID happened, never from what was asked. */
export function openedLine(res, open) {
  const where = open?.chart ? ` on ${open.chart}` : ''
  const tail = ' Nothing was created or saved — review it there, and close the panel to cancel.'
  if (res.draft) {
    const what = res.editing || open?.defId ? `Modify on ${open?.name || 'that indicator'} in Create Indicator` : 'Create Indicator'
    return `Opened ${what}${where} — your earlier draft is open instead${open?.seed ? ', so your new request was not added' : ''}.${tail}`
  }
  // Without a placed request the opener's answer is the same for "just opened" and "was already
  // open" (prefilled:false either way), so these receipts say only what is true in both cases.
  if (res.editing) {
    const modify = `Modify on ${open?.name || 'that indicator'}`
    if (res.prefilled) return `Opened ${modify} in Create Indicator${where}, with your request in the box — press Send when you’re ready.${tail}`
    if (open?.seed) return `${modify} is open in Create Indicator${where}, and it was already open, so I didn’t type over what’s in the box.${tail}`
    return `${modify} is open in Create Indicator${where}.${tail}`
  }
  if (res.prefilled) return `Opened Create Indicator${where} with your request in the box — press Send when you’re ready.${tail}`
  if (open?.seed) return `Create Indicator was already open${where}, so I didn’t type over what’s in the box.${tail}`
  return `Create Indicator is open${where}.${tail}`
}

const PLACE = { price: 'price chart', pane: 'own pane' }

let registered = false
export function registerIndicatorCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(indicatorsKind)
  // What the model is told: per chart, its indicators by name and defId (names are display
  // data; a custom `defId` is what indicator.openCreate may name for Modify).
  registerContextProvider({
    key: 'indicators',
    build: (host, refFor) => {
      const list = indicatorsKind.list(host)
      return list.length ? list.map(s => ({
        ref: refFor('indicators', s.ref), chart: s.label, position: s.position, symbol: s.symbol,
        createIndicator: s.canCreate,
        indicators: s.indicators.map(i => ({
          name: i.name, ...(i.kind === 'custom' ? { defId: i.defId, custom: true } : {}),
          ...(i.hidden ? { hidden: true } : {}), placement: i.placement, ...(i.setting ? { setting: true } : {}),
        })),
      })) : undefined
    },
    compact: (sec) => (sec || []).map(e => ({ ...e, indicators: e.indicators.map(i => i.name), note: 'names only (over the context budget)' })),
  })

  const common = { target: 'indicators', surfaces: ['charts'] }

  registerCapability({
    ...common,
    name: 'indicator.list',
    query: true,
    available: (ctx) => ctx.surface === 'charts',
    summary: 'List the indicators on ONE chart (as its legend names them): built-in or custom, shown or hidden, on the price chart or in its own pane. UCT answers from the chart\'s real state — use this (disposition apply) whenever they ask what indicators are on a chart, whether one is on, or which are hidden, instead of answering yourself.',
    hints: 'target = the indicators entry for the chart the member means (with several charts and no chart named, ask which). filter: hidden | shown | null (all).',
    args: { type: 'object', properties: { filter: { type: ['string', 'null'], enum: ['hidden', 'shown', null] } }, required: ['filter'], additionalProperties: false },
    fast: ({ core }) => {
      // "…on my chart" / "…on this" (the clause tail "chart" is already cut); a position
      // ("the right chart") was taken out before this runs and becomes the target hint.
      const t = core.replace(/\s+(?:on|in)\s+(?:the|my|this)(?:\s+chart)?$/, '').replace(/\s+(?:currently|right now)$/, '')
      const m = /^(?:what|which|list|show(?: me)?)(?: are)?(?: all)?(?: the| my)? indicators(?: are| do i have)?(?: (hidden|shown|visible|turned on|on))?$/.exec(t)
      if (!m) return null
      const w = m[1] || null
      return { filter: w === 'hidden' ? 'hidden' : (w === 'shown' || w === 'visible') ? 'shown' : null }
    },
    answer: (snap, { filter } = {}) => {
      if (!snap) return 'That chart is not available.'
      const all = snap.indicators
      const count = (list) => list.filter(i => !i.setting).length
      const plural = (n) => `${n} indicator${n === 1 ? '' : 's'}`
      const vol = (list) => (list.some(i => i.setting) ? ' (plus the Volume pane)' : '')
      const rows = filter === 'hidden' ? all.filter(i => i.hidden) : filter === 'shown' ? all.filter(i => !i.hidden) : all
      if (!all.length) return `No indicators on ${snap.label}.`
      if (!rows.length) return filter === 'hidden' ? `Nothing is hidden on ${snap.label} — everything on it is shown.` : `Everything on ${snap.label} is hidden.`
      const what = filter === 'hidden' ? 'hidden on' : filter === 'shown' ? 'shown on' : 'on'
      return {
        text: count(rows) ? `${plural(count(rows))} ${what} ${snap.label}${vol(rows)}.` : `Only the Volume pane ${filter === 'hidden' ? 'is hidden on' : 'is on'} ${snap.label} — no indicators.`,
        table: {
          columns: [{ key: 'name', label: 'Indicator' }, { key: 'kind', label: 'Type' }, { key: 'state', label: 'Shown' }, { key: 'place', label: 'Where' }],
          rows: rows.map(i => ({
            name: i.name,
            kind: i.setting ? 'chart setting' : i.kind === 'custom' ? `custom${i.version ? ` (v${i.version})` : ''}` : 'built-in',
            state: i.hidden ? 'hidden' : 'shown',
            place: PLACE[i.placement] || i.placement,
          })),
        },
      }
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.openCreate',
    undo: 'none',
    exclusive: true,
    exclusiveReason: 'Opening Create Indicator is its own step — ask for any other changes separately.',
    // The member's own access — the Create Indicator button's rule (admin + this browser's flag,
    // or the server cohort). Not offered at all without it.
    available: (ctx) => ctx.surface === 'charts' && ctx.createIndicator === true,
    summary: 'Open Create Indicator (the indicator builder) on one chart, with the member\'s indicator request typed into its box for them to review and send. It does NOT build, preview, add or save anything — the member presses Send there. With defId, opens Modify on one of their own saved custom indicators on that chart.',
    hints: `target = the indicators entry for the chart. request = the member's description of the indicator, in their words (≤ ${SEED_MAX} characters), or null to just open it. defId = a custom indicator's defId from that chart's list (only to modify it), else null — never a name. `
      + 'Use for "open Create Indicator", "help me build/write an indicator that…". Adding, removing or changing indicators directly is not available yet.',
    args: {
      type: 'object',
      properties: { request: { type: ['string', 'null'] }, defId: { type: ['string', 'null'] } },
      required: ['request', 'defId'], additionalProperties: false,
    },
    fast: ({ core }) => (/^(?:open|show|bring up|launch)(?: the)? (?:create indicator|indicator builder)(?: panel)?$/.test(core) ? { request: null, defId: null } : null),
    check(st, { request, defId }) {
      if (!st.canCreate) return 'Create Indicator isn’t available for your account on this chart.'
      if (request != null && typeof request !== 'string') return 'Describe the indicator in words.'
      if (defId != null) {
        const row = st.indicators.find(i => i.kind === 'custom' && i.defId === defId)
        if (!row) return 'I can only open Modify on one of your own custom indicators on that chart.'
      }
      if (st.open) return 'One Create Indicator at a time.'
      return null
    },
    apply(st, { request, defId }) {
      const seed = seedFrom(request)
      const name = defId ? st.indicators.find(i => i.defId === defId)?.name || null : null
      return { ...st, open: { ...(defId ? { defId } : {}), ...(seed ? { seed } : {}), chart: st.chart, name } }
    },
    describe: (b, a) => {
      if (!a.open) return null
      const o = a.open
      const what = o.defId ? `Modify on ${o.name || 'your indicator'}` : 'Create Indicator'
      return `Open ${what} on ${o.chart}${o.seed ? ' with your request in the box (not sent)' : ''}`
    },
  })
}
