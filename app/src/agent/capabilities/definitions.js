// ── INDICATOR DEFINITIONS: search, describe, duplicate, delete — `uct.indicators.definitions/1` ─────────
//
// The Agent half of AGENT-CONTRACT-P2 §5. Indicators owns every rule (`components/chart/builder/
// agentDefinitions.js`): what a member may see (built-ins + their OWN formulas, never another member's),
// what a copy is (the "Create custom copy" verb: a server fork, or a formula copy of a built-in), what a
// delete is (the server's soft delete, read back as 404) and how each is undone (a re-save under the SAME
// id; the copy soft-deleted). This file routes, plans, proposes and receipts:
//
//   definition.search     QUERY — built-ins and the member's own indicators, ranked
//   definition.describe   QUERY — one indicator's settings, outputs, placement, alert / scan capability
//   definition.duplicate  save a copy as one of the member's indicators   — proposed; Undo deletes the copy
//   definition.delete     delete one of the member's OWN saved indicators — proposed (the card lists every
//                         chart still drawing it); Undo re-saves it under the same id, so they draw again
//
// ⛔ SAFE BY DEFAULT: a delete names the charts using it on the card; the approval is what lets it run
// while in use (`allowInUse`), and the usage is pinned at plan time and re-checked when it runs.

import { mutate } from 'swr'
import { registerCapability, registerTargetKind, registerContextProvider } from '../capabilities'
import {
  searchDefinitions, describeDefinition, planDefinitionAction, executeDefinitionAction, undoDefinitionAction,
} from '../../components/chart/builder/agentDefinitions'
import { REASONS } from '../../components/chart/builder/agentMutations'
import { USER_DEFINITIONS_KEY } from '../../hooks/useUserDefinitions'
import * as nativeRegistry from '../../components/chart/engine/nativeRegistry'
import { ownedDefinitionIds } from './indicatorEdits'

const quote = (s) => `“${s}”`
// the network doors (`{fork, save, remove, read}`) — Indicators' own defaults unless a test hands in its in-memory server
let deps = {}
export function setDefinitionDeps(d) { deps = d && typeof d === 'object' ? d : {} }
const charts = (host) => { try { return host?.charts?.list() || [] } catch { return [] } }
/** The definitions context, built NOW: the member's own ids, every chart the Agent can see, the access answer. */
function defCtx(host) {
  const list = charts(host)
  let canManage = false
  try { canManage = list.some(c => host.charts.canManageIndicators?.(c.ref) === true) } catch { canManage = false }
  return { registry: nativeRegistry, ownedDefinitionIds: ownedDefinitionIds(), canManage, charts: list.map(c => ({ chartId: c.ref, cs: c.cs })) }
}
const labelOfChart = (host, ref) => charts(host).find(c => c.ref === ref)?.label || 'a chart'
const usageWords = (host, usage) => (usage || []).map(u => labelOfChart(host, u.chartId))

function snap(host) {
  const ctx = defCtx(host)
  return { ref: 'definitions', label: 'Your indicators', owned: ctx.ownedDefinitionIds, ctx }
}

export const definitionLibraryKind = {
  name: 'definitionLibrary',
  boardScoped: false,                 // a saved indicator is the member's in every layout
  selfDescribing: true,
  list: (host) => (host?.charts ? [snap(host)] : []),
  read: (host, ref) => (ref === 'definitions' && host?.charts ? snap(host) : null),
  stateOf: (s) => ({ ctx: s.ctx, action: null }),
  patch: (before, after) => (after.action ? { action: after.action } : null),
  async commit(host, ref, patch) {
    const ctx = defCtx(host)
    const res = patch.undo ? await undoDefinitionAction(patch.undo, ctx, deps) : await executeDefinitionAction(patch.action.plan, ctx, deps)
    if (res.ok === false) throw new Error(refusal(host, res))
    if (res.status !== 'confirmed') throw Object.assign(new Error(res.status === REASONS.UNCONFIRMED ? 'UCT could not read it back, so I am not reporting it as done' : `it did not land${res.error ? ` (${res.error})` : ''}`), { unreverted: true })
    // a new or restored definition must reach the member's list before a chart can be given it
    try { await mutate(USER_DEFINITIONS_KEY) } catch { /* the list re-reads on its own too */ }
    const r = res.receipt
    const line = patch.undo
      ? (r.undoOf === 'delete' ? `Restored your indicator ${quote(r.name)} — charts that used it draw it again.` : `Deleted the copy ${quote(r.name)} I made.`)
      : r.op === 'duplicate' ? `Saved a copy of ${quote(r.name)} as your indicator ${quote(r.newName || r.newDefId)}.`
        : `Deleted your indicator ${quote(r.name)}${(r.usage || []).length ? ` — ${usageWords(host, r.usage).join(', ')} no longer draw${r.usage.length === 1 ? 's' : ''} it` : ''}.`
    return { lines: [line], undoData: res.undo || null }
  },
  landed: () => true,                 // confirmed by Indicators' own read-back inside commit
  undoPatch: (item) => (item.undoData ? { undo: item.undoData } : null),
  fingerprint: (s) => (s ? JSON.stringify(s.owned) : 'gone'),
}

function refusal(host, res) {
  const d = res.detail || {}
  switch (res.reason) {
    case REASONS.UNKNOWN_DEFINITION: return 'I don’t know that indicator for your account (it isn’t a built-in indicator or one of your own).'
    case REASONS.UNSUPPORTED_DEFINITION: return d.why ? `That can’t be done: ${d.why}` : 'That indicator can’t be copied or deleted.'
    case REASONS.READONLY: return 'Indicators can’t be managed from here.'
    case REASONS.DEPENDENT_EXISTS: return `${usageWords(host, d.usage).join(', ') || 'A chart'} still draws it — it has to come off those charts first (or approve deleting it anyway).`
    case REASONS.CHANGED_WHILE_WORKING: return d.what === 'usage' ? 'The charts using it changed since I showed you, so nothing was deleted — ask again.' : 'It changed while I was working, so nothing was changed — ask again.'
    case REASONS.RESTORE_CONFLICT: return 'It can’t be restored exactly — something already holds that indicator again. Nothing was changed.'
    case REASONS.PERMISSION_CHANGED: return 'Your access changed since I planned this, so nothing was changed.'
    case REASONS.NOT_FOUND: return 'That indicator is no longer there.'
    default: return 'That did not work — nothing was changed.'
  }
}
// `defId` from the model, or the member's own words for one of their indicators ("my Trend Strength")
function defIdOf(st, words) {
  const w = String(words || '').trim()
  if (!w) return null
  const hits = searchDefinitions(w, { registry: st.ctx.registry, ownedDefinitionIds: st.ctx.ownedDefinitionIds, limit: 5 })
  const exact = hits.find(h => h.defId === w) || hits.find(h => h.score >= 100)
  return exact ? exact.defId : (hits.length === 1 ? hits[0].defId : w)
}
const planOf = (st, req) => planDefinitionAction(req, st.ctx)

let registered = false
export function registerDefinitionCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(definitionLibraryKind)
  registerContextProvider({
    key: 'definitionLibrary',
    build: (host, refFor) => (host?.charts ? [{ ref: refFor('definitionLibrary', 'definitions'), label: 'Indicator definitions (search, describe, copy, delete your own here)' }] : undefined),
  })
  const common = { target: 'definitionLibrary', surfaces: ['charts'], available: (ctx) => ctx.surface === 'charts' }

  registerCapability({
    ...common,
    name: 'definition.search',
    query: true,
    summary: 'Find indicators by name or what they do — UCT\'s built-in indicators and the member\'s own saved ones (never anyone else\'s). Read-only.',
    hints: 'target = the definitionLibrary entry; query = the member\'s words ("momentum", "volatility bands", "my trend"); kind = builtin | custom | null (both).',
    args: { type: 'object', properties: { query: { type: 'string' }, kind: { type: ['string', 'null'], enum: ['builtin', 'custom', null] } }, required: ['query', 'kind'], additionalProperties: false },
    answer(s, { query, kind }) {
      if (!s) return 'Indicators are not available here.'
      const rows = searchDefinitions(query, { registry: s.ctx.registry, ownedDefinitionIds: s.ctx.ownedDefinitionIds, limit: 12, ...(kind ? { kind } : {}) })
      if (!rows.length) return `I found no indicator matching ${quote(query)}.`
      return {
        text: `${rows.length} indicator${rows.length === 1 ? '' : 's'} matching ${quote(query)}:`,
        table: { columns: [{ key: 'name', label: 'Indicator' }, { key: 'kind', label: '' }, { key: 'placement', label: 'Draws' }],
          rows: rows.map(r => ({ name: r.name, kind: r.kind === 'custom' ? 'yours' : 'built-in', placement: r.placement === 'price' ? 'on price' : 'own pane' })) },
      }
    },
  })

  registerCapability({
    ...common,
    name: 'definition.describe',
    query: true,
    summary: 'Describe ONE indicator — its settings and their ranges, what it outputs, where it draws, and whether each output can drive an alert or a scan. Read-only.',
    hints: 'target = the definitionLibrary entry; defId = its id (from a search or a chart\'s indicators list), or its exact name.',
    args: { type: 'object', properties: { defId: { type: 'string' } }, required: ['defId'], additionalProperties: false },
    answer(s, { defId }) {
      if (!s) return 'Indicators are not available here.'
      const d = describeDefinition(defIdOf(s, defId), s.ctx)
      if (!d.ok) return refusal(null, d)
      const x = d.definition
      const ins = x.inputs.map(i => `${i.label || i.key}${i.type === 'enum' ? ` (${(i.options || []).map(o => o.label ?? o.value).join(' / ')})` : Number.isFinite(i.min) || Number.isFinite(i.max) ? ` (${i.min ?? ''}–${i.max ?? ''})` : ''} = ${i.default}`)
      const outs = x.outputs.map(o => {
        const c = x.capabilities[o.key] || {}
        const can = [c.alert === 'ok' && 'alerts', c.scan === 'ok' && 'scans'].filter(Boolean)
        return `${o.label}${can.length ? ` (can drive ${can.join(' and ')})` : ''}`
      })
      return [`${x.name}${x.kind === 'custom' ? ' — one of your indicators' : ' — built-in'}; draws ${x.placement === 'price' ? 'on the price pane' : 'in its own pane'}.`,
        x.description ? x.description : null,
        ins.length ? `Settings: ${ins.join('; ')}.` : 'No settings.',
        outs.length ? `Outputs: ${outs.join('; ')}.` : null,
        x.copyable.ok ? 'You can save a copy of it to edit.' : null].filter(Boolean).join('\n')
    },
  })

  registerCapability({
    ...common,
    name: 'definition.duplicate',
    risk: 'confirm',
    summary: 'Save a COPY of an indicator as one of the member\'s own indicators (the legend\'s "Create custom copy") — a built-in becomes an editable formula, one of theirs is forked. Shown first; Undo deletes the copy (while no chart draws it).',
    hints: 'target = the definitionLibrary entry; defId = the indicator\'s id (or its exact name). To put an indicator on a chart twice use indicatorCopy.duplicate instead.',
    args: { type: 'object', properties: { defId: { type: 'string' } }, required: ['defId'], additionalProperties: false },
    check(st, { defId }) {
      if (st.action) return 'One indicator change at a time.'
      const p = planOf(st, { op: 'duplicate', defId: defIdOf(st, defId) })
      return p.ok ? null : refusal(null, p)
    },
    apply(st, { defId }) {
      const p = planOf(st, { op: 'duplicate', defId: defIdOf(st, defId) })
      return p.ok ? { ...st, action: { plan: p.plan } } : st
    },
    describe: (b, a) => (a.action ? `Saved a copy of ${quote(a.action.plan.preview.name)} as one of your indicators (a ${a.action.plan.preview.kind === 'builtin' ? 'built-in becomes an editable formula' : 'fork of yours'})` : null),
  })

  registerCapability({
    ...common,
    name: 'definition.delete',
    risk: 'confirm',
    summary: 'Delete one of the member\'s OWN saved indicators (built-ins cannot be deleted). Always shown first, naming every chart still drawing it (they stop drawing it). Undo restores it under the same id, so those charts draw it again.',
    hints: 'target = the definitionLibrary entry; defId = the indicator\'s id from yourIndicators or a chart\'s indicators list (or its exact name). If more than one of theirs could be meant, ask — never pick by similarity.',
    args: { type: 'object', properties: { defId: { type: 'string' } }, required: ['defId'], additionalProperties: false },
    check(st, { defId }) {
      if (st.action) return 'One indicator change at a time.'
      // the approval of a card that LISTS the usage is what allows deleting an indicator in use
      const p = planOf(st, { op: 'delete', defId: defIdOf(st, defId), allowInUse: true })
      return p.ok ? null : refusal(null, p)
    },
    apply(st, { defId }) {
      const p = planOf(st, { op: 'delete', defId: defIdOf(st, defId), allowInUse: true })
      return p.ok ? { ...st, action: { plan: p.plan } } : st
    },
    describe(b, a) {
      if (!a.action) return null
      const pv = a.action.plan.preview
      const n = (pv.usage || []).length
      return `Deleted your indicator ${quote(pv.name)}${n ? ` — it is on ${n} chart${n === 1 ? '' : 's'} now (${pv.usage.map(u => u.instances.map(i => i.name).join(', ')).join('; ')}), which will stop drawing it` : ' — no chart uses it'} (Undo restores it)`
    },
  })
}

