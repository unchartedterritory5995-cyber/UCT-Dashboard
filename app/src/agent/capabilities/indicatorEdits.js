// ── INDICATORS (M2): add, remove, show, hide ONE indicator on ONE chart ─────────────
//
// The Agent half of `docs/indicators/AGENT-INTEGRATION-HANDOFF.md` §14–§15. EVERY decision
// about the change — what it is, who may make it, whether it is stale, whether it landed,
// how it is undone — is Indicators' (`components/chart/builder/agentMutations.js`). This file
// only routes, presents, persists and receipts:
//
//   plan    planIndicatorMutation(cs, request, ctx)        → the proposal (what, and what a
//                                                            removal would sever) — writes nothing
//   apply   applyIndicatorMutation(cs NOW, plan, ctx NOW)   → re-checks permission + every pin
//   persist the chart's own sink (`.agent.commit`) → host.persist() ACK
//   confirm confirmIndicatorMutation(read-back, pending)    → the ONLY door to "done"
//   undo    undoIndicatorMutation(cs NOW, token, ctx NOW)   → exact (the revive writer) or refused
//
// ⛔ NO WRITER HERE. Nothing in this file touches `indicatorInstances`, hidden flags, panes,
// definitions or persistence internals; the settings it hands the chart's sink are exactly
// what the Indicators interface returned.
// ⛔ TOKENS ARE OPAQUE. `plan`, `pending` and the Undo token are held and passed back as
// returned — never edited, merged, rebuilt or persisted. Undo lives in this session's memory.
// ⛔ "DONE" ONLY ON `confirmed`. `unconfirmed` / `did-not-land` / a refused save are said as
// what they are, and no Undo is offered for them.

import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import { planIndicatorMutation, applyIndicatorMutation, confirmIndicatorMutation, undoIndicatorMutation, resolveIndicatorTarget, REASONS } from '../../components/chart/builder/agentMutations'
import { instancesOf } from '../../components/chart/builder/agentSeams'
import { catalogRows, userCatalogRows } from '../../components/chart/indicatorCatalog'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { afterRender } from '../frames'

const REF = 'ixe:'
const refOf = (chartRef) => `${REF}${chartRef}`
const chartRefOf = (ref) => (typeof ref === 'string' && ref.startsWith(REF) ? ref.slice(REF.length) : null)

// The member's OWN saved definition ids — the authoritative list is `useUserDefinitions`
// (server rows), which useAgent hands in on every render. Read at plan, apply and Undo.
let ownedSource = () => []
export function setOwnedDefinitionSource(fn) { ownedSource = typeof fn === 'function' ? fn : () => [] }
const ownedIds = () => { try { return [...(ownedSource() || [])] } catch { return [] } }

/** A FRESH permission context for one chart — built at the moment it is used. */
export function mutationCtx(host, chartRef) {
  let canManage = false
  try { canManage = host?.charts?.canManageIndicators?.(chartRef) === true } catch { canManage = false }
  return { canManage, ownedDefinitionIds: ownedIds(), registry: nativeRegistry, chartId: chartRef }
}

const rowsOf = (cs) => { try { return instancesOf(cs, nativeRegistry).filter(r => !r.setting) } catch { return [] } }

const snapOf = (host, c) => ({
  ref: refOf(c.ref), chartRef: c.ref, label: c.label, position: c.position || null, symbol: c.symbol,
  cs: c.cs, canManage: mutationCtx(host, c.ref).canManage, rows: rowsOf(c.cs),
})

// ── what can be ADDED: the Library's own rows (shipped definitions + the member's own),
// never the legacy overlay rows or the carved-out Volume Profile (§14.9.2) ──
export function addableRows() {
  const owned = new Set(ownedIds())
  let shipped = []
  let mine = []
  try { shipped = catalogRows(nativeRegistry).filter(r => !!nativeRegistry.getDefinition(r.id)) } catch { shipped = [] }
  try { mine = userCatalogRows(nativeRegistry).filter(r => owned.has(r.id)) } catch { mine = [] }
  return [...shipped, ...mine].map(r => ({ defId: r.id, name: r.name }))
}
const NOT_ADDABLE = /^(volume ?profile|vpvr|vp|ma|moving average|classic|overlay)$/i

// ── sentences for every refusal the interface returns (§15.4) ──
export function refusalSentence(res, { chart = 'that chart', op = null } = {}) {
  const r = res && res.reason
  switch (r) {
    case REASONS.READONLY: return `Indicators on ${chart} can't be changed from here.`
    case REASONS.PERMISSION_CHANGED: return `Your permission to change indicators on ${chart} changed since I planned this, so I didn't change anything.`
    case REASONS.UNKNOWN_DEFINITION: return 'I don’t know that indicator for your account (it isn’t a built-in indicator or one of your own saved indicators).'
    case REASONS.UNSUPPORTED_DEFINITION: return 'That indicator can’t be added this way. Classic overlay averages and Volume Profile are added from Chart Settings.'
    case REASONS.NOT_FOUND: return `That indicator isn't on ${chart} any more.`
    case REASONS.AMBIGUOUS: {
      const names = (res.detail?.candidates || []).map(c => `${c.name} (${c.instanceId})`)
      return `More than one indicator on ${chart} matches that — ${names.join(', ')}. Say which one.`
    }
    case REASONS.WRITER_REFUSED: return 'UCT refused that change (the indicator’s own rules), so nothing changed.'
    case REASONS.NO_CHANGE: return op === 'setVisible' ? 'It is already in that state.' : 'Nothing to change.'
    case REASONS.CHANGED_WHILE_WORKING: return `The ${res.detail?.what === 'dependents' ? 'indicators that read this one' : res.detail?.what || 'indicator'} on ${chart} changed while I was working, so I didn't change anything. Ask again to see the current state.`
    case REASONS.RESTORE_CONFLICT: return 'It can no longer be undone exactly — that indicator, or something that read it, changed since. Nothing was undone.'
    case REASONS.DEPENDENT_EXISTS: return 'Something now reads the indicator I added, so removing it would disconnect that. Nothing was undone.'
    case REASONS.UNCONFIRMED: return 'UCT could not read the saved chart back, so I am not reporting it as done.'
    case REASONS.NOT_LANDED: return 'The saved chart does not show the change — it did not land.'
    case REASONS.BAD_REQUEST: return 'That request (or Undo) is not valid for this chart.'
    default: return 'That did not work.'
  }
}

const severText = (list) => (list || []).map(d => (d.kind === 'infoValue' ? `a header value reading it` : `${d.name}'s ${d.key || 'source'} input`))

/** The receipt sentence — only from a CONFIRMED receipt. */
export function receiptLine(receipt, chart) {
  const name = receipt.name || 'the indicator'
  const where = chart ? ` on ${chart}` : ''
  if (receipt.op === 'undo') {
    if (receipt.undoOf === 'remove') {
      const back = severText(receipt.restored)
      return `Restored ${name}${where} with its original identity${back.length ? ` and reconnected ${back.join(', ')}` : ''} (saved).`
    }
    if (receipt.undoOf === 'add') return `Removed the ${name} I added${where} (saved).`
    return `Put ${name}${where} back to ${receipt.visible ? 'shown' : 'hidden'} (saved).`
  }
  if (receipt.op === 'add') return `Added ${name}${where} (saved).`
  if (receipt.op === 'remove') {
    const cut = severText(receipt.severed)
    return `Removed ${name}${where} (saved)${cut.length ? ` — disconnected ${cut.join(', ')}` : ''}.`
  }
  return `${receipt.visible ? 'Showed' : 'Hid'} ${name}${where} (saved).`
}

// ── proposal-time plans (§14.4): a proposal's Apply re-plans; the pins must be the ones
// the member SAW. Kept per chart + request, in memory, briefly. ──
const PLAN_TTL_MS = 10 * 60 * 1000
const proposed = new Map()
const planKey = (chartRef, req) => `${chartRef}|${JSON.stringify(req)}`
const planCtx = (st) => ({ canManage: st.canManage === true, ownedDefinitionIds: ownedIds(), registry: nativeRegistry, chartId: st.chartRef })
function planFor(st, req) {
  const key = planKey(st.chartRef, req)
  const hit = proposed.get(key)
  if (hit && Date.now() - hit.at < PLAN_TTL_MS) return { ok: true, plan: hit.plan }
  const p = planIndicatorMutation(st.cs, req, planCtx(st))
  if (p.ok) proposed.set(key, { plan: p.plan, at: Date.now() })
  return p
}
export function _resetProposedPlans() { proposed.clear() }

async function persistAndReadBack(host, chartRef) {
  if (typeof host?.persist === 'function') {
    let r
    try { r = await host.persist() } catch { r = { ok: false, reason: 'not-saved' } }
    if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'not-saved' }
  }
  await afterRender()
  const c = host.charts.read(chartRef)
  // the board's stored copy as the chart reads it (falls back to the rendered settings)
  return { ok: true, readBack: c ? (c.stored ?? c.cs) : null }
}

const fail = (msg, { unreverted = false } = {}) => Object.assign(new Error(msg), unreverted ? { unreverted: true } : {})

export const indicatorEditsKind = {
  name: 'indicatorEdits',
  selfDescribing: true,
  list: (host) => (host?.charts ? host.charts.list().map(c => snapOf(host, c)) : []),
  read: (host, ref) => {
    const c = chartRefOf(ref) && host?.charts?.read(chartRefOf(ref))
    return c ? snapOf(host, c) : null
  },
  stateOf: (s) => ({ chart: s.label, chartRef: s.chartRef, cs: s.cs, canManage: s.canManage, rows: s.rows, change: null }),
  patch: (before, after) => (after.change ? { change: after.change } : null),
  // A change, or an Undo — both through the Indicators interface, then the chart's own
  // persist, then the authoritative read-back.
  async commit(host, ref, patch) {
    const chartRef = chartRefOf(ref)
    const cur = host.charts.read(chartRef)
    if (!cur) throw fail('that chart is no longer on the board')
    const label = cur.label
    const ctx = mutationCtx(host, chartRef)
    const step = patch.undo
      ? undoIndicatorMutation(cur.cs, patch.undo, ctx)
      : applyIndicatorMutation(cur.cs, patch.change.plan, ctx)
    if (!step.ok) throw fail(refusalSentence(step, { chart: label, op: patch.change?.plan?.op }))
    if (!patch.undo) proposed.delete(planKey(chartRef, patch.change.request))
    if (!host.charts.commit(chartRef, { settings: step.cs })) throw fail('the chart did not accept the change')
    const saved = await persistAndReadBack(host, chartRef)
    if (!saved.ok) throw fail(`the save was not confirmed (${saved.reason}), so it is not done`, { unreverted: true })
    const done = confirmIndicatorMutation(saved.readBack, step.pending, ctx)
    if (done.status !== 'confirmed') throw fail(refusalSentence({ reason: done.reason || done.status }, { chart: label }), { unreverted: true })
    return { lines: [receiptLine(done.receipt, label)], undoData: done.undo || null }
  },
  // `confirmIndicatorMutation` already verified the read-back inside commit.
  landed: () => true,
  // Undo exists only when the interface minted a token on confirmation — held as returned.
  undoPatch: (item) => (item.undoData ? { undo: item.undoData } : null),
  // Staleness is the interface's (pins re-checked at apply / undo), not a whole-settings hash:
  // an unrelated chart change must not refuse an exact indicator Undo.
  fingerprint: (s) => s.chartRef,
}

const common = { target: 'indicatorEdits', surfaces: ['charts'], exclusive: true,
  exclusiveReason: 'Change one indicator at a time, on its own — ask for anything else separately.',
  // Never advertised where the member cannot manage indicators (no writable chart on the board).
  available: (ctx) => ctx.surface === 'charts' && ctx.manageIndicators !== false }

function oneChange(st) { return st.change ? 'One indicator change at a time — ask for the next one after this.' : null }

/** Instance argument → the interface's own resolver (exact id, else a legend name). */
function targetOf(st, instance) {
  const byId = resolveIndicatorTarget(st.cs, nativeRegistry, { instanceId: instance })
  if (byId.ok) return byId
  return resolveIndicatorTarget(st.cs, nativeRegistry, { name: instance })
}

function planCheck(st, req) {
  if (!st.canManage) return refusalSentence({ reason: REASONS.READONLY }, { chart: st.chart })
  const p = planFor(st, req)
  if (!p.ok && p.reason === REASONS.NO_CHANGE) return null          // said as a no-op, not a refusal
  return p.ok ? null : refusalSentence(p, { chart: st.chart, op: req.op })
}

let registered = false
export function registerIndicatorEditCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(indicatorEditsKind)
  registerContextProvider({
    key: 'indicatorCatalog',
    // what can be added — only when the request is about adding something
    build: (host, refFor, { message }) => (/\b(add|put|apply|insert|load|plot)\b/i.test(message || '') ? addableRows() : undefined),
    compact: (sec) => (sec || []).map(r => r.defId),
  })

  registerCapability({
    ...common,
    name: 'indicator.add',
    summary: 'Add ONE indicator to ONE chart — exactly what the Indicator Library\'s Add to Chart does. Built-in indicators or the member\'s own saved ones; Undo removes it again.',
    hints: 'target = the chart\'s `manage` ref from the indicators context. defId = an id from indicatorCatalog (never invented, never a name). Classic overlay averages (the legacy EMA/SMA rows) and Volume Profile are NOT added this way — say they live in Chart Settings.',
    args: { type: 'object', properties: { defId: { type: 'string' } }, required: ['defId'], additionalProperties: false },
    check(st, { defId }) {
      if (NOT_ADDABLE.test(String(defId || '').trim())) return refusalSentence({ reason: REASONS.UNSUPPORTED_DEFINITION })
      return oneChange(st) || planCheck(st, { op: 'add', defId })
    },
    apply(st, { defId }) {
      const req = { op: 'add', defId }
      const p = planFor(st, req)
      return p.ok ? { ...st, change: { request: req, plan: p.plan } } : st
    },
    describe: (b, a) => (a.change ? `Add ${a.change.plan.preview.name} to ${a.chart}` : null),
  })

  registerCapability({
    ...common,
    name: 'indicator.remove',
    risk: 'confirm',              // always a proposal: it can sever other indicators' inputs
    summary: 'Remove ONE indicator (its whole group, e.g. all COT panes) from ONE chart — the settings ✕ / legend Delete. Always shown as a proposal first, listing anything it would disconnect. Undo restores it exactly (same identity, reconnected inputs).',
    hints: 'target = the chart\'s `manage` ref. instance = the indicator\'s `id` from that chart\'s list (exact; a name only if it is unique). Volume is not an indicator (use volume.setState).',
    args: { type: 'object', properties: { instance: { type: 'string' } }, required: ['instance'], additionalProperties: false },
    check(st, { instance }) {
      const t = targetOf(st, instance)
      if (!t.ok) return refusalSentence(t, { chart: st.chart })
      return oneChange(st) || planCheck(st, { op: 'remove', instanceId: t.instanceId })
    },
    apply(st, { instance }) {
      const t = targetOf(st, instance)
      if (!t.ok) return st
      const req = { op: 'remove', instanceId: t.instanceId }
      const p = planFor(st, req)
      return p.ok ? { ...st, change: { request: req, plan: p.plan } } : st
    },
    describe: (b, a) => {
      if (!a.change) return null
      const { preview } = a.change.plan
      const cut = severText(preview.severs)
      return `Remove ${preview.name} from ${a.chart}${cut.length ? ` — this disconnects ${cut.join(', ')}` : ' — nothing else reads it'}`
    },
  })

  for (const [name, visible] of [['indicator.show', true], ['indicator.hide', false]]) {
    registerCapability({
      ...common,
      name,
      summary: `${visible ? 'Show' : 'Hide'} ONE indicator (its whole group) on ONE chart — the settings / legend eye. Undo puts it back.`,
      hints: 'target = the chart\'s `manage` ref. instance = the indicator\'s `id` from that chart\'s list (exact; a name only if it is unique). Volume is not an indicator (use volume.setState).',
      args: { type: 'object', properties: { instance: { type: 'string' } }, required: ['instance'], additionalProperties: false },
      check(st, { instance }) {
        const t = targetOf(st, instance)
        if (!t.ok) return refusalSentence(t, { chart: st.chart })
        return oneChange(st) || planCheck(st, { op: 'setVisible', instanceId: t.instanceId, visible })
      },
      apply(st, { instance }) {
        const t = targetOf(st, instance)
        if (!t.ok) return st
        const req = { op: 'setVisible', instanceId: t.instanceId, visible }
        const p = planFor(st, req)
        return p.ok ? { ...st, change: { request: req, plan: p.plan } } : st
      },
      noop: (b, a, { instance }) => `${targetOf(b, instance).name || 'It'} is already ${visible ? 'shown' : 'hidden'}`,
      describe: (b, a) => (a.change ? `${visible ? 'Show' : 'Hide'} ${a.change.plan.preview.name} on ${a.chart}` : null),
    })
  }
}
