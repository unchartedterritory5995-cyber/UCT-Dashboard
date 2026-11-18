// ── INDICATOR ALERT capabilities (W1-B, Wave 1 — BOARD B-03; announced to Indicators) ─────────────
//
// The member's INDICATOR alerts (RSI above 70, MACD crossing its signal…): UCT's existing product,
// hooks/useIndicatorAlerts.js over /api/indicator-alerts. The Agent keeps no store and no second
// writer: reads and writes go ONLY through the hook's own exported functions (createIndicatorAlert,
// toggleIndicatorAlert, deleteIndicatorAlert — reached through host.indicatorAlerts, agent/host.js)
// and the routes the popover and the alert manager already use. The hook itself is NOT modified.
// What the product IS, measured from its code (IndicatorAlertPopover.jsx, indicator_alerts.py):
//   • an alert names a PLOT ADDRESS from the served catalog (`rsi`, `macd.signal`), a condition from
//     that plot's own list, a threshold when the condition needs one, the chart's symbol and
//     timeframe, the instance's inputs (`params`) and the instance it was armed from (`instance_id`);
//   • it may be paused / resumed (toggle), re-arms by itself, and delete is a HARD delete;
//   • a plot whose output is a yes/no SIGNAL (only a member's own formula: the server refuses a policy
//     on a shipped indicator) takes a trigger policy instead of a threshold — the popover's own flow,
//     armed here with the same payload after the same browser gate; the server still decides at arm;
//   • the timeframe is the chart's, or another NATIVE one (the popover's list): the evaluator reads
//     stored bars, on that timeframe, whatever the chart shows.
// So the Agent offers exactly: list, create (proposed; Undo deletes what it made), toggle (exact Undo),
// delete (proposed, permanent). The instance comes from the chart's indicators (indicator.list /
// the indicators context: `id`); the catalog decides what is alertable — nothing here enumerates.
//
//   kind 'indicatorAlertLibrary'  one target — where new indicator alerts are made (and the list read)
//   kind 'indicatorAlert'         one target per alert (ref = its real id)

import { withoutGuardIds } from '../../components/chart/engine/ast/guardIdText'
import { registerCapability, registerTargetKind, registerContextProvider, registerWarmup } from '../capabilities'
import { indicatorsOn } from './indicators'
import { instancesForAddress, addressBase } from '../../components/chart/engine/alertSets'
import { getDefinition } from '../../components/chart/engine/nativeRegistry'
import { calcTimeframeOf } from '../../components/chart/engine/instanceTimeframe'
import { isNativeTf, isValidTf, NATIVE_TFS, tfLabel } from '../../components/chart/timeframes'
import {
  takesTriggerPolicy, signalAlertGate, outputTypeForAddress, compileTriggerPolicy, policyOf, policyLabel, POLICY_OPTIONS,
} from '../../components/chart/engine/triggerPolicy'
import { alertNeedsAttention } from '../../components/chart/alertState'
import { showOnOf } from './indicatorControls'

const MAX_CREATES = 5
const SHOW_IN_CONTEXT = 25
const ALWAYS_SHOW_UP_TO = 10
const ALERT_WORDS = /\b(alerts?|alarm|notify|notification|ping me|tell me when|let me know when|warn me|pause|resume|re-?arm|turn (on|off)|delete|remove|cancel|that one|those|it)\b/i

function slim(r) {
  return {
    id: String(r.id), sym: String(r.sym || '').toUpperCase(), indicator: String(r.indicator || ''), condition: r.condition || null,
    threshold: r.threshold == null ? null : Number(r.threshold), tf: String(r.tf || 'D'), active: !!r.active,
    instanceId: r.instance_id ? String(r.instance_id) : null, scope: r.scope || null, state: r.state || null,
    detail: r.state_detail ? String(r.state_detail) : null, instanceMissing: !!r.instance_missing,
    params: paramsOf(r.params_json), instanceLabel: r.instance_label ? String(r.instance_label) : null,
  }
}
/** `params_json` as served (an object, or the stored JSON string) → an object, or null. */
function paramsOf(raw) {
  if (raw && typeof raw === 'object') return raw
  if (typeof raw === 'string' && raw.trim()) { try { const o = JSON.parse(raw); return o && typeof o === 'object' ? o : null } catch { return null } }
  return null
}
const rowSig = (a) => JSON.stringify([a.id, a.sym, a.indicator, a.condition, a.threshold, a.tf, a.active])

// ── the server's list and catalog, cached for planning; every write re-reads the list first ──
const cache = { rows: null, catalog: null, p: null }
export function _resetIndicatorAlertCache() { cache.rows = null; cache.catalog = null; cache.p = null }
let hostRef = null
export async function loadIndicatorAlerts(host = hostRef, { force = false } = {}) {
  const src = host?.indicatorAlerts
  if (!src) return cache.rows || []
  hostRef = host
  if (!force && cache.rows) return cache.rows
  if (!cache.p) {
    cache.p = Promise.resolve(src.list()).then(async rows => {
      cache.rows = (Array.isArray(rows) ? rows : []).map(slim)
      // the catalog names each alert's plot ("RSI", "MACD signal"); read once, never required for the list itself
      if (!cache.catalog) { try { await loadCatalog(host) } catch { /* labels fall back to the stored address */ } }
      return cache.rows
    }).finally(() => { cache.p = null })
  }
  return cache.p
}
async function loadCatalog(host = hostRef) {
  const src = host?.indicatorAlerts
  if (!src) return cache.catalog
  if (cache.catalog) return cache.catalog
  const c = await src.catalog()
  cache.catalog = Array.isArray(c) ? c : null
  return cache.catalog
}
const rows = () => cache.rows || []
/** calc-TF family: the ACTIVE indicator alerts already listed (no read here) that were armed from this instance on this symbol. */
export function activeAlertsOnInstance(instanceId, sym) {
  const s = String(sym || '').toUpperCase()
  return rows().filter(a => a.active && a.instanceId === String(instanceId || '') && (!s || a.sym === s))
}

// ── the catalog, read the way the popover reads it ──
const plotsOf = (entry) => (Array.isArray(entry?.plots) && entry.plots.length ? entry.plots : [{ value: entry.indicator, label: entry.label, conditions: entry.conditions || [], default_threshold: entry.default_threshold, inputs: {} }])
/** Every plot the catalog offers for this instance's definition (`instancesForAddress`: the product's own match). */
function plotsForInstance(catalog, inst) {
  const out = []
  for (const e of catalog || []) for (const p of plotsOf(e)) {
    const declared = Array.isArray(p.instance_defs) && p.instance_defs.includes(inst.defId)
    if (declared || instancesForAddress([{ instanceId: inst.instanceId, defId: inst.defId }], p.value).length) out.push({ ...p, entryLabel: e.label })
  }
  return out
}
const plotLabel = (p) => p.label || p.value
const condLabel = (p, c) => (p.conditions || []).find(x => x.value === c)?.label || c

// ── LT-13 (live 2026-11-03): a HUMAN reference to an indicator on the chart ─────────────────────────────
// "mark when the 9 ema crosses above the 20" → the model sent instance "EMA 9" (the name the indicators entry shows)
// instead of its id, and create refused although EMA 9 was on the chart. An `instance` that is no id on any chart is
// read as a reference to the chart's OWN instances, deterministically: its words and its first number against each
// instance's name ("EMA 9", "RSI (7)") — "EMA 9", "9 ema", "ema9", "the 20". Exactly ONE instance must match;
// several is an explicit question, none is the existing refusal. Nothing else about the alert changes: the id it
// resolves to is the instance's own, so the payload is the one the id would have produced.
const REF_STOP = new Set(['the', 'a', 'an', 'my', 'line', 'indicator', 'on', 'this', 'chart', 'period'])
function refParts(text) {
  const toks = String(text || '').toLowerCase().match(/[a-z]+|\d+(?:\.\d+)?/g) || []
  const words = toks.filter(t => /^[a-z]/.test(t) && !REF_STOP.has(t))
  const num = toks.find(t => /^\d/.test(t))
  return { words, num: num == null ? null : Number(num) }
}
function refMatches(ref, inst) {
  if (inst.setting) return false                        // Volume is a chart setting, never an alertable instance
  const own = refParts(inst.name)
  const num = inst.defId === 'movingAverage' && Number.isFinite(Number(inst.inputs?.period)) ? Number(inst.inputs.period) : own.num
  if (!ref.words.length && ref.num == null) return false
  if (ref.num != null && num !== ref.num) return false
  // every word of the reference, in order, starts the instance's own words ("bollinger" → "Bollinger Bands")
  return ref.words.every((w, i) => own.words[i] === w)
}
/** The single instance a human reference names across the board's charts: hits [{ inst, chart }], [] when none. */
function resolveInstanceRef(charts, text) {
  const ref = refParts(text)
  const exact = String(text || '').trim().toLowerCase()
  const hits = [], named = []
  for (const c of charts) {
    const insts = indicatorsOn(c.cs).filter(i => !i.setting)
    // an exact (case-insensitive) name wins over the word/number reading on that chart
    const byName = insts.filter(i => String(i.name || '').toLowerCase() === exact)
    for (const inst of (byName.length ? byName : insts.filter(i => refMatches(ref, i)))) hits.push({ inst, chart: c })
  }
  for (const h of hits) if (!named.includes(h.inst.name)) named.push(h.inst.name)
  return { hits, named }
}

/** The instance named by `instance` (its id, or LT-13 a human reference to it) across the board's charts:
 * { inst, chart } (the first chart), { ambiguous } (several charts), { ambiguousRef } (several instances), or null. */
// ⭐ W2 AUDIT (live 2026-11-04, train 3): `chart` scopes the lookup to ONE chart (the chart's ref, from the charts entry,
// or the chart the browser resolved: the selected one, the one the member named) — the same instance id ("ovl:0", the
// default EMA 9) is on every chart, so an unscoped lookup on a board of six asked "which chart?" forever.
function findInstance(host, instanceId, chartRef = null) {
  const id = String(instanceId || '')
  if (!id) return null
  let charts = []
  try { charts = host?.charts?.list?.() || [] } catch { charts = [] }
  if (chartRef != null && String(chartRef).trim()) {
    charts = charts.filter(c => String(c.ref) === String(chartRef))
    if (!charts.length) return { noChart: String(chartRef) }
  }
  let hits = []
  for (const c of charts) {
    const inst = indicatorsOn(c.cs).find(i => i.instanceId === id)
    if (inst) hits.push({ inst, chart: c })
  }
  if (!hits.length) {
    const r = resolveInstanceRef(charts, id)
    if (!r.hits.length) return null
    // two different instances on ONE chart (EMA 20 and SMA 20 for "the 20"), or two differently named ones: ask
    const perChart = new Map()
    for (const h of r.hits) perChart.set(h.chart, (perChart.get(h.chart) || 0) + 1)
    if (r.named.length > 1 || [...perChart.values()].some(n => n > 1)) return { ambiguousRef: r.named }
    hits = r.hits
  }
  // the same instance id on two charts with different symbols is two different alerts: ask
  if (new Set(hits.map(h => `${h.chart.symbol}|${h.chart.tf}`)).size > 1) return { ambiguous: hits }
  return hits[0]
}
const money = (n) => (Number.isFinite(n) ? (Math.abs(n) >= 1000 ? `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}` : String(n)) : '')
const plotOfAddress = (address) => { for (const e of cache.catalog || []) for (const p of plotsOf(e)) if (p.value === address) return p; return null }
/** "becomes true" for a yes/no alert (the popover's reading: never the 0.5 it compiles to), else null. */
const policyWords = (a) => (takesTriggerPolicy(plotOfAddress(a.indicator)?.output_type) ? policyLabel(policyOf(a.condition, a.threshold))?.toLowerCase() || null : null)
/** "NVDA RSI (14) above 70 (D)" */
export const indicatorAlertPhrase = (a, label = null) => `${a.sym} ${label || a.indicator} ${policyWords(a) || `${a.condition ? a.condition.replace(/_/g, ' ') : ''}${a.threshold != null ? ` ${money(a.threshold)}` : ''}`} (${a.tf})`.replace(/\s+/g, ' ')
const labelFor = (a) => {
  if (a.params && isCrossAddress(a.indicator) && a.params.fast != null && a.params.slow != null) {
    const t = String(a.params.ma_type || 'ema').toUpperCase()
    return `${t} ${a.params.fast} / ${t} ${a.params.slow}`
  }
  // the server's own name for this row's instance ("RSI(7)"): two alerts that differ only by their settings must read apart
  if (a.instanceLabel) return a.instanceLabel
  for (const e of cache.catalog || []) for (const p of plotsOf(e)) if (p.value === a.indicator) return p.label || e.label || a.indicator
  return a.indicator
}
const phrase = (a) => indicatorAlertPhrase(a, labelFor(a))
const statusOf = (a) => (a.active ? 'active' : 'paused')

/** The indicator half of "what alerts do I have" (alert.list), read as indicatorAlert.list reads it: { rows: [line] },
 *  { unread: true } when the list can't be read now, or null where indicator alerts aren't reachable at all. Never throws. */
export async function indicatorAlertBook(host, { symbol = null, activeOnly = false } = {}) {
  const from = host?.indicatorAlerts ? host : hostRef
  if (!from?.indicatorAlerts) return null
  try {
    const all = await loadIndicatorAlerts(from, { force: true })
    const shown = all.filter(a => (!symbol || a.sym === symbol) && (!activeOnly || a.active))
    return { rows: shown.map(a => `${phrase(a)} — ${statusOf(a)}${alertNeedsAttention(a) || a.instanceMissing ? ' (needs attention: it can\'t fire)' : ''}`) }
  } catch { return { unread: true } }
}

function libSnap() {
  return { ref: 'indicatorAlerts', label: 'Indicator alerts', loaded: !!cache.rows, alerts: rows() }
}

export const indicatorAlertLibraryKind = {
  name: 'indicatorAlertLibrary',
  boardScoped: false,
  selfDescribing: true,
  list: () => [libSnap()],
  read: (host, ref) => (ref === 'indicatorAlerts' ? libSnap() : null),
  stateOf: (snap) => ({ alerts: snap.alerts, loaded: snap.loaded, creates: [] }),
  patch: (before, after) => (after.creates.length ? { create: after.creates } : null),
  async commit(host, ref, patch) {
    const src = host?.indicatorAlerts
    if (!src) throw new Error('indicator alerts are not reachable here')
    if (patch.deleteCreated) {
      // Undo of a create: delete exactly the alerts it made (the hook's own delete), those still there
      const cur = await loadIndicatorAlerts(host, { force: true })
      for (const id of patch.deleteCreated) if (cur.some(x => x.id === id)) await src.remove(id)
      await loadIndicatorAlerts(host, { force: true })
      return true
    }
    // the CURRENT book (never the cache): a duplicate armed in another tab since the proposal is refused
    const cur = await loadIndicatorAlerts(host, { force: true })
    for (const c of patch.create) {
      const dup = cur.find(a => a.active && sameAlert(a, c))
      if (dup) throw new Error(`you already have an active alert for ${phrase(dup)}`)
    }
    const created = {}
    for (const [i, c] of patch.create.entries()) {
      // the SAME SHAPE as the popover's payload (IndicatorAlertPopover.handleAdd): sym, indicator (the PLOT address), condition,
      // tf, params when the plot has inputs (the INSTANCE's own inputs for the plot's declared knobs — not the popover's
      // catalog defaults), instance_id; threshold when the condition needs one; no scope = global
      const payload = { sym: c.sym, indicator: c.indicator, condition: c.condition, tf: c.tf, ...(c.params ? { params: c.params } : {}), instance_id: c.instanceId, ...(c.threshold != null ? { threshold: c.threshold } : {}), ...(c.triggerPolicy ? { trigger_policy: c.triggerPolicy } : {}) }
      let res
      try { res = await src.create(payload) } catch (e) { res = { ok: false, error: e?.message || 'error' } }
      if (!res || !res.ok) { const e = new Error(res?.error || 'The server refused this alert.'); e.created = created; throw e }
      created[`#${i}`] = String(res.id)
    }
    // the receipt words what the server STORED (normalize_params may change a value), read back from the fresh list
    const book = await loadIndicatorAlerts(host, { force: true })
    const lines = patch.create.map((c, i) => { const row = book.find(a => a.id === created[`#${i}`]); return createLine(c, row ? row.params : null) })
    return { created, lines }
  },
  landed(snap, patch) {
    if (!snap) return false
    const have = snap.alerts
    if (patch.deleteCreated) return patch.deleteCreated.every(id => !have.some(a => a.id === id))
    return patch.create.every(c => have.some(a => a.active && sameAlert(a, c)))
  },
  undoPatch: (item) => { const ids = Object.values(item.created || {}); return ids.length ? { deleteCreated: ids } : null },
  compensatePatch: (item) => { const ids = Object.values(item.created || item.partial || {}); return ids.length ? { deleteCreated: ids } : null },
  fingerprint: () => 'indicatorAlerts',
  fingerprintFor(host, snap, item) {
    const ids = Object.values(item.created || {})
    return JSON.stringify(ids.map(id => { const a = snap.alerts.find(x => x.id === id); return a ? rowSig(a) : null }))
  },
  async refreshForApproval(host) {
    try { await loadIndicatorAlerts(host, { force: true }); return { ok: true } } catch { return { ok: false, what: 'your indicator alerts' } }
  },
}
const crossKey = (params) => (params ? JSON.stringify([String(params.ma_type || '').toLowerCase(), Number(params.fast), Number(params.slow)]) : '')
// The settings an alert is EVALUATED with, as the server resolves them (indicator_alert_evaluator.instance_label): each knob the
// plot declares, its stored value, else the catalog's default — so a stored null IS the default, and a stored "14" is 14.
const knobValueKey = (v) => (v !== '' && v != null && Number.isFinite(Number(v)) ? Number(v) : String(v ?? '').toLowerCase())
function paramsKey(address, params) {
  const inputs = plotOfAddress(address)?.inputs
  const keys = Object.keys(inputs || params || {}).sort()
  return JSON.stringify(keys.map(k => [k, knobValueKey(params?.[k] ?? inputs?.[k])]))
}
const sameAlert = (a, c) => a.sym === c.sym && a.indicator === c.indicator && a.condition === c.condition && (a.threshold ?? null) === (c.threshold ?? null) && a.tf === c.tf
  && (isCrossAddress(a.indicator) ? crossKey(a.params) === crossKey(c.params) : paramsKey(a.indicator, a.params) === paramsKey(a.indicator, c.params))

export const indicatorAlertKind = {
  name: 'indicatorAlert',
  empty: "You have no indicator alerts yet.",
  boardScoped: false,
  selfDescribing: true,
  list: () => rows().map(a => ({ ...a, ref: a.id, label: phrase(a) })),
  read: (host, ref) => { const a = rows().find(x => x.id === ref); return a ? { ...a, ref: a.id, label: phrase(a) } : null },
  stateOf: (snap) => ({ ...snap, deleted: false }),
  patch(before, after) {
    if (after.deleted) return { delete: true, sig: rowSig(before) }
    if (after.active !== before.active) return { toggle: true, to: after.active, sig: rowSig(before) }
    return null
  },
  async commit(host, ref, patch) {
    const src = host?.indicatorAlerts
    if (!src) throw new Error('indicator alerts are not reachable here')
    const cur = await loadIndicatorAlerts(host, { force: true })
    const a = cur.find(x => x.id === ref)
    if (!a) throw new Error('that alert is already gone')
    if (patch.sig && rowSig(a) !== patch.sig) throw new Error('that alert changed since I read it — ask again')
    if (patch.delete) await src.remove(ref)
    // the popover row's own switch (toggleIndicatorAlert); the route FLIPS, so an alert already where it should be
    // (another tab, an Undo after a manual flip) is left alone rather than flipped away
    else if (patch.toggle && a.active !== patch.to) await src.toggle(ref)
    await loadIndicatorAlerts(host, { force: true })
    return true
  },
  landed: (snap, patch) => (patch.delete ? !snap : patch.toggle ? !!snap && snap.active === patch.to : true),
  // pause ⇄ resume is exact; a delete is a HARD delete in the product
  undoPatch: (item) => (item.patch?.toggle ? { toggle: true, to: !item.patch.to, sig: null } : null),
  fingerprint: (snap) => (snap ? rowSig(snap) : 'gone'),
  async refreshForApproval(host) {
    try { await loadIndicatorAlerts(host, { force: true }); return { ok: true } } catch { return { ok: false, what: 'your indicator alerts' } }
  },
}

/** What the settings claim may say. `stored` undefined = the plan (nothing is stored yet); null = the row could not be read back. */
function settingsWords(c, stored) {
  const own = "watched with that indicator's own settings"
  if (stored === undefined || !c.params) return own
  if (stored === null) return "saved, but I couldn't read back the settings it watches"
  const off = Object.keys(c.params).filter(k => String(stored[k]) !== String(c.params[k]))
  return off.length ? `saved with ${off.map(k => `${k} ${stored[k] ?? 'not set'} (your chart: ${c.params[k]})`).join(', ')}` : own
}
function createLine(c, stored) {
  const level = c.threshold != null && !c.triggerPolicy ? ` ${money(c.threshold)}` : ''
  const where = c.tf === c.chartTf ? `on the ${c.tf} chart` : `on ${tfLabel(c.tf)} bars (the chart shows ${tfLabel(c.chartTf)})`
  return `Indicator alert: ${c.sym} ${c.label} ${c.condLabel.toLowerCase()}${level} ${where} — ${settingsWords(c, stored)}`
}

let registered = false
export function registerIndicatorAlertCapabilities() {
  if (registered) return
  registered = true
  registerTargetKind(indicatorAlertLibraryKind)
  registerTargetKind(indicatorAlertKind)
  registerWarmup((host) => loadIndicatorAlerts(host))

  registerContextProvider({
    key: 'indicatorAlertLibrary',
    refreshGroup: 'alerts',
    refresh: () => loadIndicatorAlerts(hostRef, { force: true }),
    build: (host, refFor) => {
      if (!host?.indicatorAlerts) return undefined
      hostRef = host                                   // the board the next plan's instances are looked up on
      const all = rows()
      return [{ ref: refFor('indicatorAlertLibrary', 'indicatorAlerts'), label: 'Indicator alerts (RSI, MACD… — create new ones here; an instance id comes from the indicators entry)',
        ...(cache.rows ? { active: all.filter(a => a.active).length, paused: all.filter(a => !a.active).length } : { status: 'loading' }) }]
    },
  })
  registerContextProvider({
    key: 'indicatorAlerts',
    compact: (list) => (list || []).slice(0, 8),
    build: (host, refFor, { message = '', nl1 = false } = {}) => {
      if (!host?.indicatorAlerts) return undefined
      const all = rows()
      if (!all.length) return undefined
      if (all.length > ALWAYS_SHOW_UP_TO && !nl1 && !ALERT_WORDS.test(message)) return undefined
      const ordered = [...all.filter(a => a.active), ...all.filter(a => !a.active)]
      return ordered.slice(0, SHOW_IN_CONTEXT).map(a => ({
        ref: refFor('indicatorAlert', a.id), symbol: a.sym, indicator: labelFor(a), when: policyWords(a) || `${a.condition ? a.condition.replace(/_/g, ' ') : ''}${a.threshold != null ? ` ${a.threshold}` : ''}`.trim(),
        timeframe: a.tf, status: statusOf(a), ...(a.scope ? { chartOnly: true } : {}),
      }))
    },
  })

  // ── indicatorAlert.list (QUERY): the server's list, read now (the context entry is capped) ──
  registerCapability({
    name: 'indicatorAlert.list',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    target: 'indicatorAlertLibrary',
    query: true,
    summary: 'Show the member\'s indicator alerts from UCT\'s real list: symbol, indicator, condition, timeframe, whether each is active or paused, and why one can\'t fire. Use this (disposition apply) for "show my indicator alerts", "why hasn\'t my RSI alert fired".',
    hints: 'target = the ref of the indicatorAlertLibrary entry. symbol: one ticker, or null. status: active | paused | attention (alerts that can\'t fire) | null (all).',
    args: { type: 'object', properties: { symbol: { type: ['string', 'null'] }, status: { type: ['string', 'null'], enum: ['active', 'paused', 'attention', null] } }, required: ['symbol', 'status'], additionalProperties: false },
    fast: ({ lower }) => (/^(?:show|list)(?: me)?(?: all)?(?: of)? my indicator alerts$/.test(lower) ? { symbol: null, status: null } : null),
    async answer(_snap, { symbol = null, status = null } = {}) {
      let all
      try {
        if (!hostRef?.indicatorAlerts) throw new Error('not reachable here')
        all = await loadIndicatorAlerts(hostRef, { force: true })
      } catch (e) { return `I couldn't read your indicator alerts right now (${e?.message || 'error'}).` }
      const sym = symbol ? String(symbol).trim().toUpperCase() : null
      const faulty = (a) => alertNeedsAttention(a) || a.instanceMissing
      const rowsNow = all.filter(a => (!sym || a.sym === sym) && (!status || (status === 'attention' ? faulty(a) : status === 'active' ? a.active : !a.active)))
      const what = `${status === 'attention' ? 'indicator alerts needing attention' : status ? `${status} indicator alerts` : 'indicator alerts'}${sym ? ` on ${sym}` : ''}`
      if (!rowsNow.length) return `You have no ${what}.`
      const note = (a) => (alertNeedsAttention(a) ? a.detail || `This alert is in the state “${a.state}”.` : a.instanceMissing ? 'The chart indicator it was armed from is gone.' : '')
      return {
        text: `You have ${rowsNow.length} ${rowsNow.length === 1 ? what.replace('alerts', 'alert') : what}.`,
        table: {
          columns: [{ key: 'symbol', label: 'Symbol' }, { key: 'indicator', label: 'Indicator' }, { key: 'when', label: 'When' }, { key: 'tf', label: 'Timeframe' }, { key: 'status', label: 'Status' }, { key: 'note', label: 'Note' }],
          rows: rowsNow.map(a => ({ symbol: a.sym, indicator: labelFor(a), when: policyWords(a) || `${a.condition ? a.condition.replace(/_/g, ' ') : ''}${a.threshold != null ? ` ${a.threshold}` : ''}`.trim(), tf: a.tf, status: statusOf(a), note: note(a) })),
        },
      }
    },
  })

  // ── indicatorAlert.create ──
  registerCapability({
    name: 'indicatorAlert.create',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    target: 'indicatorAlertLibrary',
    risk: 'confirm',
    createsResource: true,
    summary: 'Create ONE indicator alert on an indicator that is ON a chart (RSI above 70, MACD crossing a level, price touching a band, the 9 EMA crossing the 20 EMA, the member\'s own yes/no signal turning on), as the Indicator Alerts popover does. It watches that chart\'s symbol with the instance\'s own settings, on the chart\'s timeframe or another native one. Undo deletes it.',
    hints: 'target = the ref of the indicatorAlertLibrary entry; instance = the id of the indicator from that chart\'s indicators entry (never a name); chart = the ref of the chart it is on; '
      + 'plot = null, or for several lines the address the catalog names (macd.signal) — not sure which line: ask. '
      + 'condition = above | below | cross_above | cross_below | cross_zero | touch_upper | touch_lower ("crosses above 70" = cross_above; "is over 70" = above); threshold = the level, else null. '
      + 'MA cross: instance = the 9, crossWith = the 20 (ids), cross_above|cross_below, threshold null; crossWith = null otherwise. '
      + 'The member\'s own yes/no signal: trigger = becomes_true ("turns on") | becomes_false ("turns off") | is_true, condition and threshold null; trigger = null otherwise. '
      + 'timeframe = null for the chart\'s own, or 1 | 5 | 15 | 30 | 60 | D | W | M ("alert on the weekly RSI" = W). '
      + 'A PRICE level ("when NVDA hits 150") is alert.create. Always proposed (disposition propose). Not on any chart: say to add it first.',
    args: { type: 'object', properties: {
      instance: { type: 'string' }, plot: { type: ['string', 'null'] }, condition: { type: ['string', 'null'] }, threshold: { type: ['number', 'null'] },
      crossWith: { type: ['string', 'null'] }, chart: { type: ['string', 'null'] },
      trigger: { type: ['string', 'null'], enum: [...POLICY_OPTIONS.map(o => o.value), null] }, timeframe: { type: ['string', 'null'] },
    }, required: ['instance', 'plot', 'condition', 'threshold', 'crossWith', 'chart', 'trigger', 'timeframe'], additionalProperties: false },
    // 2026-11-04 — `crossWith` and `chart` were ADDED, then `trigger` and `timeframe`; an arg shape from before them (key left out) reads as null.
    absentAsNull: ['crossWith', 'chart', 'trigger', 'timeframe'],
    // the model's chart ref → the real chart ref (useAgent translateRefs)
    argRefs: { chart: 'chart' },
    async prepare() {
      const host = hostRef
      let catalog = null, fresh = false
      try { catalog = await loadCatalog(host) } catch { catalog = null }
      try { await loadIndicatorAlerts(host, { force: true }); fresh = true } catch { fresh = false }
      return { iaCatalog: catalog, iaBookFresh: fresh }
    },
    check(st, args, env) {
      const r = resolveCreate(args, env)
      if (r.why) return r.why
      if (st.creates.length >= MAX_CREATES) return `That's more than ${MAX_CREATES} alerts in one request — ask for them in smaller groups.`
      const c = toCreate(r)
      const dup = st.alerts.find(a => a.active && sameAlert(a, c))
      if (dup || st.creates.find(x => sameAlert(x, c))) return `You already have an active alert for ${phrase(dup || c)}.`
      return null
    },
    apply: (st, args, env) => ({ ...st, creates: [...st.creates, toCreate(resolveCreate(args, env))] }),
    describe(b, a) {
      if (a.creates.length <= b.creates.length) return null
      return createLine(a.creates[a.creates.length - 1])
    },
  })

  // ── indicatorAlert.toggle ──
  registerCapability({
    name: 'indicatorAlert.toggle',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    target: 'indicatorAlert',
    summary: 'Pause or resume ONE indicator alert (the ON / OFF switch on its row in the chart\'s Indicator Alerts popover). Undo switches it back.',
    hints: 'target = the ref of that alert in the indicatorAlerts list; active = false to pause, true to resume. One op per alert.',
    args: { type: 'object', properties: { active: { type: 'boolean' } }, required: ['active'], additionalProperties: false },
    check: () => null,
    apply: (st, { active }) => (st.active === active ? st : { ...st, active }),
    describe: (b, a) => (b.active === a.active ? null : `${a.active ? 'Resumed' : 'Paused'} the indicator alert ${phrase(b)}`),
    noop: (b, a, { active } = {}) => (active ? 'That alert is already active' : 'That alert is already paused'),
  })

  // ── indicatorAlert.delete ──
  registerCapability({
    name: 'indicatorAlert.delete',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    target: 'indicatorAlert',
    risk: 'confirm', reversible: false,
    summary: 'Delete one of the member\'s indicator alerts (permanent — UCT cannot restore a deleted alert).',
    hints: 'target = the ref of that alert in the indicatorAlerts list. One op per alert. Always shown as a proposal first; if two alerts could be the one they mean, clarify with the real alerts as choices — never pick one. To stop one without deleting it, indicatorAlert.toggle.',
    args: { type: 'object', properties: {}, required: [], additionalProperties: false },
    check: () => null,
    apply: (st) => ({ ...st, deleted: true }),
    describe: (b, a) => (a.deleted ? `Deleted the indicator alert ${phrase(b)} (permanent)` : null),
  })
}

// ── 2026-11-04: MOVING-AVERAGE CROSS (`ma_cross`, the canonical engine's address) ─────────────────────────
// Two chart averages → ONE alert body: {ma_type, fast, slow, direction, confirm: 'close'}. The catalog decides
// that an address is a cross (it reads `instance_defs` — `movingAverage` — and declares fast/slow knobs); nothing
// here enumerates indicators. The stored alert always reads FAST vs SLOW: "the 50 crosses above the 20" is the
// 20 crossing BELOW the 50, so the pair is swapped and the rule inverted rather than refused.
const CROSS_TYPES = new Set(['ema', 'sma'])
const isCrossPlot = (p) => !!p && Array.isArray(p.instance_defs) && p.inputs && 'fast' in p.inputs && 'slow' in p.inputs && 'ma_type' in p.inputs
function isCrossAddress(address) {
  for (const e of cache.catalog || []) for (const p of plotsOf(e)) if (p.value === address) return isCrossPlot(p)
  return address === 'ma_cross'
}
const INVERT = { cross_above: 'cross_below', cross_below: 'cross_above' }
const maOf = (inst) => {
  const i = inst?.inputs || {}
  const period = Number(i.period)
  const off = Number(inst?.presentation?.offset ?? i.offset ?? 0)
  return { type: String(i.maType || 'sma').toLowerCase(), period, source: i.source == null ? 'close' : String(i.source), offset: Number.isFinite(off) ? off : 0 }
}
/** The cross the two instances describe, or the sentence that says why they can't. */
// W2 AUDIT: the second average is looked up on the FIRST one's chart (a cross is one chart's two lines)
function resolveCross(found, crossWith, condition) {
  const a = found.inst
  if (!crossWith || !String(crossWith).trim()) return `Which average should ${a.name || 'it'} cross — say the other moving average on the chart (e.g. the 20).`
  let other = findInstance(hostRef, crossWith, found.chart?.ref ?? null)
  // not on that chart but on ANOTHER one: say so (two charts' lines are never one crossover), as before scoping
  if (!other || other.noChart) {
    const any = findInstance(hostRef, crossWith)
    if (any?.inst || any?.ambiguous) return 'Both averages must be on the same chart (symbol and timeframe) for a crossover alert.'
    other = any
  }
  if (!other) return `There's no indicator “${crossWith}” on your charts — use an id from the indicators entry, or add that moving average first.`
  if (other.ambiguousRef) return `“${crossWith}” could be ${other.ambiguousRef.length > 1 ? other.ambiguousRef.join(' or ') : `more than one ${other.ambiguousRef[0]}`} on your chart — say which average.`
  if (other.ambiguous) return `That average is on ${other.ambiguous.length} charts with different symbols — say which chart the alert is for.`
  const b = other.inst
  if (a.instanceId === b.instanceId) return 'A crossover needs two different moving averages — name the second one.'
  if (String(found.chart.symbol || '').toUpperCase() !== String(other.chart.symbol || '').toUpperCase() || String(found.chart.tf || 'D') !== String(other.chart.tf || 'D')) {
    return 'Both averages must be on the same chart (symbol and timeframe) for a crossover alert.'
  }
  if (b.defId !== a.defId) return `${b.name || crossWith} isn't a moving average — a crossover alert compares two moving averages.`
  const ma = maOf(a), mb = maOf(b)
  if (ma.source !== 'close' || mb.source !== 'close') return 'Crossover alerts watch averages of the close — one of these averages another series.'
  // a line drawn SHIFTED (offset ≠ 0) crosses on a different bar than the alert would judge
  if (ma.offset !== 0 || mb.offset !== 0) return `${ma.offset !== 0 ? a.name : b.name} is drawn with an offset, so its line crosses on a different bar than the alert would judge — set its offset to 0 first.`
  if (!CROSS_TYPES.has(ma.type) || !CROSS_TYPES.has(mb.type)) return 'Crossover alerts support EMA and SMA averages only.'
  if (ma.type !== mb.type) return `${a.name} and ${b.name} are different kinds of average — a crossover alert compares two EMAs or two SMAs.`
  if (!Number.isFinite(ma.period) || !Number.isFinite(mb.period)) return 'I couldn\'t read the periods of those averages — try again in a moment.'
  if (ma.period === mb.period) return `${a.name} and ${b.name} have the same period, so they can't cross.`
  const swapped = ma.period > mb.period
  const rule = swapped ? INVERT[condition] || condition : condition
  const fast = swapped ? b : a
  const slow = swapped ? a : b
  return {
    rule, fastInst: fast, slowInst: slow,
    params: { ma_type: ma.type, fast: Math.min(ma.period, mb.period), slow: Math.max(ma.period, mb.period), direction: rule === 'cross_below' ? 'below' : 'above', confirm: 'close' },
  }
}

// ── WHAT THE ALERT WILL ACTUALLY WATCH ────────────────────────────────────────────────────────────────
// The receipt says "watched with that indicator's own settings", so that has to be TRUE. Three ways it was not:
//  • a chart definition and the alert column name the same knob differently (macd fastPeriod / fast, bb stdDev / stddev,
//    stoch kPeriod / k_period), and a key looked up verbatim missed, so MACD 8/21/5 armed as 12/26/9 with nothing said;
//  • a setting the column has no knob for (stoch smoothK) cannot be carried at all;
//  • a custom timeframe (45m, 3D…) is a client-side resample: the evaluator reads stored bars, and there are none.
// The first is read correctly; the others are refused by name, never armed as something close.
const fold = (k) => String(k).toLowerCase().replace(/_/g, '')
const defOf = (inst) => { try { return getDefinition(inst.defId) || null } catch { return null } }
/** The chart input a plot's knob means: same name but for case and `_`, or that name + "Period" (`fast` → `fastPeriod`). */
function inputOfKnob(def, knob) {
  const f = fold(knob)
  return (def?.inputs || []).find(d => d?.key && (fold(d.key) === f || fold(d.key) === `${f}period`)) || null
}
function knobValue(inst, def, knob, dflt) {
  const spec = inputOfKnob(def, knob)
  const given = inst.inputs || {}
  if (spec && given[spec.key] !== undefined) return given[spec.key]
  if (given[knob] !== undefined) return given[knob]
  return spec && spec.default !== undefined ? spec.default : dflt
}
// paint and line look: they change how it is drawn, never what it computes
const DRAWN_ONLY = /^(?:opacity|line(?:Width|Style)|bands)$/
/** A setting of this instance that changes its line and that the plot's knobs cannot carry, or null. */
function settingOutOfReach(inst, def, p) {
  const knobs = Object.keys(p.inputs || {})
  const carried = new Set(knobs.flatMap(k => [k, inputOfKnob(def, k)?.key]))
  for (const d of def?.inputs || []) {
    if (!d?.key || carried.has(d.key) || d.type === 'color' || DRAWN_ONLY.test(d.key)) continue
    const v = inst.inputs?.[d.key]
    if (v !== undefined && String(v) !== String(d.default)) return { label: d.label || d.key, value: v }
  }
  return null
}
const nativeWords = () => NATIVE_TFS.map(t => tfLabel(t)).join(', ')
/** The timeframe the alert runs on: the one the member named (a code or a word), else the chart's. */
function alertTf(found, timeframe) {
  const said = timeframe == null ? '' : String(timeframe).trim()
  if (!said) return String(found.chart.tf || 'D')
  if (isNativeTf(said)) return said
  const read = showOnOf(said)
  return read && read.preset === 'custom' && read.tfs.length === 1 ? read.tfs[0] : said
}
/** Why an alert on this plot, on this timeframe, would not be watching what the chart draws — or null. */
function cannotWatchFaithfully(found, p, tf) {
  if (!isValidTf(tf)) return `“${tf}” isn't a timeframe. Nothing was created — an alert can run on ${nativeWords()}.`
  if (!isNativeTf(tf)) return `Indicator alerts read stored bars, and ${tfLabel(tf)} is a custom timeframe with none, so that alert could never fire. Nothing was created — it can run on ${nativeWords()}.`
  const stored = (found.chart.cs?.indicatorInstances || []).find(i => i && i.instanceId === found.inst.instanceId)
  const calc = calcTimeframeOf(stored)
  if (calc && calc !== tf) return `${found.inst.name} is calculated on ${tfLabel(calc)}, so an alert on ${tfLabel(tf)} would judge a different line. Nothing was created.`
  if (isCrossPlot(p)) return null                       // resolveCross has already judged both averages
  const out = settingOutOfReach(found.inst, defOf(found.inst), p)
  return out ? `${plotLabel(p)} alerts can't use ${found.inst.name}'s ${out.label} of ${out.value}, so an alert would watch a different line than your chart draws. Nothing was created — set that back to its default, or pick another indicator.` : null
}

// ── A YES/NO OUTPUT: the popover's reading of its type, the same server-side rule for who may carry a policy ──
const USER_ADDRESS = /^u_[0-9a-f]{12}\./
function signalOf(p) {
  const installed = outputTypeForAddress(getDefinition, p.value)
  return { signal: takesTriggerPolicy(installed ? installed.type : (p.output_type ?? null)), installed }
}
/** Everything one create request resolves to, or { why }: the check's sentence, in the check's order. */
/** The bounded range an indicator's values live in, from its definition's fixed pane scale; null when unbounded or unknown. */
function valueRangeOf(inst) {
  let d = null
  try { d = getDefinition(inst?.defId) } catch { d = null }
  const s = d?.placement?.scale
  return s && Number.isFinite(s.min) && Number.isFinite(s.max) && s.min < s.max ? { min: s.min, max: s.max } : null
}
function resolveCreate({ instance, plot, condition, threshold, crossWith = null, chart = null, trigger = null, timeframe = null }, env) {
  const found = findInstance(hostRef, instance, chart)
  if (found?.noChart) return { why: 'That chart isn’t on this board any more, so nothing was created — ask again for the chart you mean.' }
  if (!found) return { why: `There's no indicator “${instance}” on your charts — use an id from the indicators entry, or add the indicator to a chart first.` }
  if (found.ambiguousRef) return { why: `“${instance}” could be ${found.ambiguousRef.length > 1 ? found.ambiguousRef.join(' or ') : `more than one ${found.ambiguousRef[0]}`} on your chart — say which indicator the alert is for.` }
  if (found.ambiguous) return { why: `That indicator is on ${found.ambiguous.length} charts with different symbols — say which chart the alert is for.` }
  if (!env?.iaCatalog) return { why: 'I couldn\'t read which indicator alerts UCT offers right now, so nothing was created — try again in a moment.' }
  if (!env?.iaBookFresh) return { why: 'I couldn\'t read your indicator alerts just now, so nothing was created — try again in a moment.' }
  const plots = plotsForInstance(env.iaCatalog, found.inst)
  if (!plots.length) return { why: `Alerts aren't available for ${found.inst.name} — UCT's alert catalog doesn't offer it (set a price alert, or pick an indicator it lists).` }
  const lines = () => plots.map(x => `${x.value} (${plotLabel(x)})`).join(', ')
  let p = null
  if (plot != null) { p = plots.find(x => x.value === String(plot)); if (!p) return { why: `${found.inst.name} has no line “${plot}” — its lines are ${lines()}.` } }
  else if (plots.length === 1) p = plots[0]
  else return { why: `${found.inst.name} has several lines — which one? ${lines()}.` }
  const tf = alertTf(found, timeframe)
  const { signal, installed } = signalOf(p)
  if (signal) {
    if (!USER_ADDRESS.test(p.value)) return { why: `${plotLabel(p)} is a yes/no output I can't arm here: a trigger applies only to one of your own indicators.` }
    if (crossWith != null && String(crossWith).trim()) return { why: `${plotLabel(p)} alerts on one line — “crossWith” is only for a moving-average cross.` }
    if (trigger == null) return { why: `${plotLabel(p)} is a yes/no signal — should it alert when it ${POLICY_OPTIONS.map(o => o.label.toLowerCase()).join(', ')}?` }
    if (!POLICY_OPTIONS.some(o => o.value === trigger)) return { why: `${plotLabel(p)} can alert when it ${POLICY_OPTIONS.map(o => o.label.toLowerCase()).join(', ')} — not “${trigger}”.` }
    const faithful = cannotWatchFaithfully(found, p, tf)
    if (faithful) return { why: faithful }
    if (installed) {
      const gate = signalAlertGate(installed.def, installed.key, { tf })
      if (gate.status === 'refused') return { why: withoutGuardIds(gate.reason) }
    }
    return { found, p, tf, policy: trigger, ...compileTriggerPolicy(trigger), cross: null }
  }
  if (trigger != null) return { why: `${plotLabel(p)} is a number on every bar, not a yes/no — say a condition and a level instead.` }
  const cond = (p.conditions || []).find(c => c.value === condition)
  if (!cond) return { why: `${plotLabel(p)} can alert on ${(p.conditions || []).map(c => `${c.value} (${c.label})`).join(', ')} — not “${condition}”.` }
  if (cond.needs_threshold && !Number.isFinite(threshold)) return { why: `Say the level for “${cond.label}” on ${plotLabel(p)} (a number).` }
  // ⭐ round 3 (pl-exec): a level the indicator can never reach is refused, from the indicator's OWN declared range (its
  // definition's fixed pane scale: RSI 0-100, Williams %R -100-0, CMO -100-100…), never a per-indicator list
  const range = cond.needs_threshold ? valueRangeOf(found.inst) : null
  // at the ends the bound is EXCLUSIVE for a level that has to be passed: RSI can never go above 100 or below 0
  const upward = /^(?:above|cross_above)$/.test(condition), downward = /^(?:below|cross_below)$/.test(condition)
  if (range && (threshold < range.min || threshold > range.max || (upward && threshold >= range.max) || (downward && threshold <= range.min))) return { why: `${plotLabel(p)} moves between ${range.min} and ${range.max}, so ${threshold} can never be reached — nothing was created. Say a level from ${range.min} to ${range.max}.` }
  let cross = null
  if (isCrossPlot(p)) {
    cross = resolveCross(found, crossWith, condition)
    if (typeof cross === 'string') return { why: cross }
  } else if (crossWith != null && String(crossWith).trim()) {
    return { why: `${plotLabel(p)} alerts on one line — “crossWith” is only for a moving-average cross.` }
  }
  const faithful = cannotWatchFaithfully(found, p, tf)
  if (faithful) return { why: faithful }
  return { found, p, tf, policy: null, condition, threshold: cond.needs_threshold ? threshold : null, cross }
}

/** The alert to create, from the chart the instance is on and the catalog's plot — the popover's own fields. */
function toCreate({ found, p, tf, policy, condition, threshold, cross }) {
  const common = { sym: String(found.chart.symbol || '').toUpperCase(), tf, chartTf: String(found.chart.tf || 'D'), indicator: p.value }
  if (cross) {
    const t = cross.params.ma_type.toUpperCase()
    return {
      ...common, condition: cross.rule,
      threshold: null, params: cross.params, instanceId: cross.fastInst.instanceId,
      label: `${t} ${cross.params.fast} / ${t} ${cross.params.slow}`, condLabel: condLabel(p, cross.rule), base: addressBase(p.value),
    }
  }
  const keys = Object.keys(p.inputs || {})
  // the instance's own settings for the knobs the plot declares (the popover: the catalog's shape, the instance's values)
  const def = defOf(found.inst)
  const params = keys.length ? Object.fromEntries(keys.map(k => [k, knobValue(found.inst, def, k, p.inputs[k])])) : null
  return {
    ...common, condition, ...(policy ? { triggerPolicy: policy } : {}),
    threshold: threshold == null ? null : Number(threshold), params, instanceId: found.inst.instanceId,
    label: `${plotLabel(p)}${found.inst.name && found.inst.name !== plotLabel(p) ? ` (${found.inst.name})` : ''}`, condLabel: policy ? policyLabel(policy) : condLabel(p, condition), base: addressBase(p.value),
  }
}
