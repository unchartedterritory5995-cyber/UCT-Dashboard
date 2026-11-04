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
//   • a plot whose output is a yes/no SIGNAL takes a trigger policy instead of a threshold — the
//     popover's own flow; the Agent does not arm those (it says where to).
// So the Agent offers exactly: create (proposed; Undo deletes what it made), toggle (exact Undo),
// delete (proposed, permanent). The instance comes from the chart's indicators (indicator.list /
// the indicators context: `id`); the catalog decides what is alertable — nothing here enumerates.
//
//   kind 'indicatorAlertLibrary'  one target — where new indicator alerts are made (and the list read)
//   kind 'indicatorAlert'         one target per alert (ref = its real id)

import { registerCapability, registerTargetKind, registerContextProvider, registerWarmup } from '../capabilities'
import { indicatorsOn } from './indicators'
import { instancesForAddress, addressBase } from '../../components/chart/engine/alertSets'

const MAX_CREATES = 5
const SHOW_IN_CONTEXT = 25
const ALWAYS_SHOW_UP_TO = 10
const ALERT_WORDS = /\b(alerts?|alarm|notify|notification|ping me|tell me when|let me know when|warn me|pause|resume|re-?arm|turn (on|off)|delete|remove|cancel|that one|those|it)\b/i
const SIGNAL_TYPES = new Set(['signal', 'condition', 'boolean', 'bool'])

function slim(r) {
  return {
    id: String(r.id), sym: String(r.sym || '').toUpperCase(), indicator: String(r.indicator || ''), condition: r.condition || null,
    threshold: r.threshold == null ? null : Number(r.threshold), tf: String(r.tf || 'D'), active: !!r.active,
    instanceId: r.instance_id ? String(r.instance_id) : null, scope: r.scope || null, state: r.state || null,
    params: paramsOf(r.params_json),
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
/** "NVDA RSI (14) above 70 (D)" */
export const indicatorAlertPhrase = (a, label = null) => `${a.sym} ${label || a.indicator} ${a.condition ? a.condition.replace(/_/g, ' ') : ''}${a.threshold != null ? ` ${money(a.threshold)}` : ''} (${a.tf})`.replace(/\s+/g, ' ')
const labelFor = (a) => {
  if (a.params && isCrossAddress(a.indicator) && a.params.fast != null && a.params.slow != null) {
    const t = String(a.params.ma_type || 'ema').toUpperCase()
    return `${t} ${a.params.fast} / ${t} ${a.params.slow}`
  }
  for (const e of cache.catalog || []) for (const p of plotsOf(e)) if (p.value === a.indicator) return p.label || e.label || a.indicator
  return a.indicator
}
const phrase = (a) => indicatorAlertPhrase(a, labelFor(a))
const statusOf = (a) => (a.active ? 'active' : 'paused')

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
      const payload = { sym: c.sym, indicator: c.indicator, condition: c.condition, tf: c.tf, ...(c.params ? { params: c.params } : {}), instance_id: c.instanceId, ...(c.threshold != null ? { threshold: c.threshold } : {}) }
      let res
      try { res = await src.create(payload) } catch (e) { res = { ok: false, error: e?.message || 'error' } }
      if (!res || !res.ok) { const e = new Error(res?.error || 'The server refused this alert.'); e.created = created; throw e }
      created[`#${i}`] = String(res.id)
    }
    await loadIndicatorAlerts(host, { force: true })
    return { created }
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
const sameAlert = (a, c) => a.sym === c.sym && a.indicator === c.indicator && a.condition === c.condition && (a.threshold ?? null) === (c.threshold ?? null) && a.tf === c.tf
  && (!isCrossAddress(a.indicator) || crossKey(a.params) === crossKey(c.params))

export const indicatorAlertKind = {
  name: 'indicatorAlert',
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
    else if (patch.toggle) await src.toggle(ref)                       // the manager's own pause / resume
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
        ref: refFor('indicatorAlert', a.id), symbol: a.sym, indicator: labelFor(a), when: `${a.condition ? a.condition.replace(/_/g, ' ') : ''}${a.threshold != null ? ` ${a.threshold}` : ''}`.trim(),
        timeframe: a.tf, status: statusOf(a), ...(a.scope ? { chartOnly: true } : {}),
      }))
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
    summary: 'Create ONE indicator alert on an indicator that is ON a chart (RSI above 70, MACD line crossing a level, price touching a Bollinger band, the 9 EMA crossing above the 20 EMA…), as the chart\'s Indicator Alerts popover does: the alert watches that chart\'s symbol and timeframe with the instance\'s own settings. Undo deletes it.',
    hints: 'target = the ref of the indicatorAlertLibrary entry; instance = the id of the indicator from the indicators entry of the chart they mean (never a name); '
      + 'plot = null, or for an indicator with several lines the plot address the catalog names (e.g. macd.signal) — if you are not sure which line, ask; '
      + 'condition = above | below | cross_above | cross_below | cross_zero | touch_upper | touch_lower (what the member said: "crosses above 70" = cross_above 70; "is over 70" = above 70); '
      + 'threshold = the level as a number when the condition has one, else null. A PRICE level alert ("when NVDA hits 150") is alert.create, not this. '
      + 'MA cross ("the 9 ema crosses above the 20"): instance = the 9, crossWith = the 20 (ids), condition cross_above|cross_below, threshold null; crossWith = null otherwise. '
      + 'chart = the ref of the chart the alert is for (one indicator id can be on several charts). '
      + 'Always proposed first (disposition propose). For an indicator not on any chart, say to add it first.',
    args: { type: 'object', properties: {
      instance: { type: 'string' }, plot: { type: ['string', 'null'] }, condition: { type: 'string' }, threshold: { type: ['number', 'null'] },
      crossWith: { type: ['string', 'null'] }, chart: { type: ['string', 'null'] },
    }, required: ['instance', 'plot', 'condition', 'threshold', 'crossWith', 'chart'], additionalProperties: false },
    // 2026-11-04 — `crossWith` and `chart` were ADDED; an arg shape from before them (key left out) reads as null.
    absentAsNull: ['crossWith', 'chart'],
    // the model's chart ref → the real chart ref (useAgent translateRefs)
    argRefs: { chart: 'chart' },
    async prepare() {
      const host = hostRef
      let catalog = null, fresh = false
      try { catalog = await loadCatalog(host) } catch { catalog = null }
      try { await loadIndicatorAlerts(host, { force: true }); fresh = true } catch { fresh = false }
      return { iaCatalog: catalog, iaBookFresh: fresh }
    },
    check(st, { instance, plot, condition, threshold, crossWith = null, chart = null }, env) {
      const found = findInstance(hostRef, instance, chart)
      if (found?.noChart) return 'That chart isn’t on this board any more, so nothing was created — ask again for the chart you mean.'
      if (!found) return `There's no indicator “${instance}” on your charts — use an id from the indicators entry, or add the indicator to a chart first.`
      if (found.ambiguousRef) return `“${instance}” could be ${found.ambiguousRef.length > 1 ? found.ambiguousRef.join(' or ') : `more than one ${found.ambiguousRef[0]}`} on your chart — say which indicator the alert is for.`
      if (found.ambiguous) return `That indicator is on ${found.ambiguous.length} charts with different symbols — say which chart the alert is for.`
      if (!env?.iaCatalog) return 'I couldn\'t read which indicator alerts UCT offers right now, so nothing was created — try again in a moment.'
      if (!env?.iaBookFresh) return 'I couldn\'t read your indicator alerts just now, so nothing was created — try again in a moment.'
      const plots = plotsForInstance(env.iaCatalog, found.inst)
      if (!plots.length) return `Alerts aren't available for ${found.inst.name} — UCT's alert catalog doesn't offer it (set a price alert, or pick an indicator it lists).`
      let p = null
      if (plot != null) { p = plots.find(x => x.value === String(plot)); if (!p) return `${found.inst.name} has no line “${plot}” — its lines are ${plots.map(x => `${x.value} (${plotLabel(x)})`).join(', ')}.` }
      else if (plots.length === 1) p = plots[0]
      else return `${found.inst.name} has several lines — which one? ${plots.map(x => `${x.value} (${plotLabel(x)})`).join(', ')}.`
      if (p.output_type && SIGNAL_TYPES.has(String(p.output_type).toLowerCase())) return `${plotLabel(p)} is a yes/no signal — set that alert from the chart's Indicator Alerts popover (it takes a trigger policy, not a level).`
      const cond = (p.conditions || []).find(c => c.value === condition)
      if (!cond) return `${plotLabel(p)} can alert on ${(p.conditions || []).map(c => `${c.value} (${c.label})`).join(', ')} — not “${condition}”.`
      if (cond.needs_threshold && !Number.isFinite(threshold)) return `Say the level for “${cond.label}” on ${plotLabel(p)} (a number).`
      let cross = null
      if (isCrossPlot(p)) {
        cross = resolveCross(found, crossWith, condition)
        if (typeof cross === 'string') return cross
      } else if (crossWith != null && String(crossWith).trim()) {
        return `${plotLabel(p)} alerts on one line — “crossWith” is only for a moving-average cross.`
      }
      if (st.creates.length >= MAX_CREATES) return `That's more than ${MAX_CREATES} alerts in one request — ask for them in smaller groups.`
      const c = toCreate(found, p, condition, cond.needs_threshold ? threshold : null, cross)
      if (st.alerts.find(a => a.active && sameAlert(a, c)) || st.creates.find(x => sameAlert(x, c))) return `You already have an active alert for ${phrase(c)}.`
      return null
    },
    apply(st, { instance, plot, condition, threshold, crossWith = null, chart = null }, env) {
      const found = findInstance(hostRef, instance, chart)
      const plots = plotsForInstance(env.iaCatalog, found.inst)
      const p = plot != null ? plots.find(x => x.value === String(plot)) : plots[0]
      const cond = (p.conditions || []).find(c => c.value === condition)
      const cross = isCrossPlot(p) ? resolveCross(found, crossWith, condition) : null
      return { ...st, creates: [...st.creates, toCreate(found, p, condition, cond.needs_threshold ? threshold : null, cross)] }
    },
    describe(b, a) {
      if (a.creates.length <= b.creates.length) return null
      const c = a.creates[a.creates.length - 1]
      return `Indicator alert: ${c.sym} ${c.label} ${c.condLabel.toLowerCase()}${c.threshold != null ? ` ${money(c.threshold)}` : ''} on the ${c.tf} chart — watched with that indicator's own settings`
    },
  })

  // ── indicatorAlert.toggle ──
  registerCapability({
    name: 'indicatorAlert.toggle',
    surfaces: ['charts'],
    available: (ctx) => ctx.surface === 'charts',
    target: 'indicatorAlert',
    summary: 'Pause or resume ONE indicator alert (the alert manager\'s own switch). Undo switches it back.',
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

/** The alert to create, from the chart the instance is on and the catalog's plot — the popover's own fields. */
function toCreate(found, p, condition, threshold, cross = null) {
  if (cross) {
    const t = cross.params.ma_type.toUpperCase()
    return {
      sym: String(found.chart.symbol || '').toUpperCase(), tf: String(found.chart.tf || 'D'), indicator: p.value, condition: cross.rule,
      threshold: null, params: cross.params, instanceId: cross.fastInst.instanceId,
      label: `${t} ${cross.params.fast} / ${t} ${cross.params.slow}`, condLabel: condLabel(p, cross.rule), base: addressBase(p.value),
    }
  }
  const keys = Object.keys(p.inputs || {})
  // the instance's own settings for the knobs the plot declares (the popover: the catalog's shape, the instance's values)
  const params = keys.length ? Object.fromEntries(keys.map(k => [k, found.inst.inputs && found.inst.inputs[k] !== undefined ? found.inst.inputs[k] : p.inputs[k]])) : null
  return {
    sym: String(found.chart.symbol || '').toUpperCase(), tf: String(found.chart.tf || 'D'), indicator: p.value, condition,
    threshold: threshold == null ? null : Number(threshold), params, instanceId: found.inst.instanceId,
    label: `${plotLabel(p)}${found.inst.name && found.inst.name !== plotLabel(p) ? ` (${found.inst.name})` : ''}`, condLabel: condLabel(p, condition), base: addressBase(p.value),
  }
}
