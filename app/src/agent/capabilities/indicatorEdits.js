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

import { namedKinds } from '../nl/collisions'
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
  return [...shipped, ...mine].map(r => {
    const settings = settingsLine(r.inputs)
    return settings ? { defId: r.id, name: r.name, settings } : { defId: r.id, name: r.name }
  })
}

// ⭐ PHASE 2.5 — WHAT EACH INDICATOR'S SETTINGS ARE, read off the definition's OWN declared
// inputs (`indicatorCatalog` rows → `instanceControls.inputSpecOf`), never a second schema here.
// One compact line per row so the model can map "a 20 EMA" onto real keys:
//   "period int 1-500 (5); maType sma|ema|wma|… (sma)". Colours, sources and text are left
// out — the Agent sets lengths, multipliers, types and switches, not paint.
const SETTABLE = new Set(['int', 'float', 'enum', 'bool'])
export function settableInputs(inputs) {
  return (Array.isArray(inputs) ? inputs : []).filter(i => i && SETTABLE.has(i.type))
}
function settingsLine(inputs) {
  return settableInputs(inputs).map(i => {
    const kind = i.type === 'enum' ? (i.options || []).map(o => String(o.value)).join('|')
      : i.type === 'bool' ? 'true|false'
        : `${i.type}${Number.isFinite(i.min) || Number.isFinite(i.max) ? ` ${i.min ?? ''}-${i.max ?? ''}` : ''}`
    return `${i.key} ${kind} (${i.default})`
  }).join('; ')
}
/** The declared settable inputs of one addable defId (`[]` when it has none or is unknown). */
export function inputsOfDef(defId) {
  try {
    const row = [...catalogRows(nativeRegistry), ...userCatalogRows(nativeRegistry)].find(r => r.id === defId)
    return settableInputs(row && row.inputs)
  } catch { return [] }
}

/** The model's closed-schema list `[{key, value}]` → the interface's `{key: value}` object.
 *  `null`/`[]` → undefined (the indicator's own defaults). A key named twice is refused — which
 *  value was meant is not this file's guess. */
export function inputsOfArgs(list) {
  if (list == null) return { ok: true, inputs: undefined }
  if (!Array.isArray(list)) return { ok: false, why: 'the settings were not a list' }
  if (!list.length) return { ok: true, inputs: undefined }
  const out = {}
  for (const it of list) {
    const key = it && typeof it.key === 'string' ? it.key.trim() : ''
    if (!key) return { ok: false, why: 'a setting had no name' }
    if (Object.prototype.hasOwnProperty.call(out, key)) return { ok: false, why: `"${key}" was given twice` }
    out[key] = it.value
  }
  return { ok: true, inputs: out }
}
const addRequest = (defId, inputs) => (inputs ? { op: 'add', defId, inputs } : { op: 'add', defId })

/** "period 20, MA type EMA" — the settings AS STORED, with the definition's own labels. */
export function settingsPhrase(defId, values) {
  if (!values || typeof values !== 'object') return ''
  const specs = new Map(inputsOfDef(defId).map(i => [i.key, i]))
  return Object.entries(values).map(([k, v]) => {
    const s = specs.get(k)
    const label = s ? String(s.label || k) : k
    const opt = s && s.type === 'enum' ? (s.options || []).find(o => o.value === v) : null
    return `${label.toLowerCase()} ${opt ? opt.label : v}`
  }).join(', ')
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
    // ⭐ PHASE 2.5 — a setting the indicator does not have, or a value it does not allow: the
    // Indicators rule's own reason, then what IS allowed (its declared range / options).
    case REASONS.BAD_INPUT: {
      const d = res.detail || {}
      const spec = d.input
      let allowed = ''
      if (spec && spec.type === 'enum' && Array.isArray(spec.options)) allowed = ` ${spec.label || spec.key} can be ${spec.options.map(o => o.label ?? o.value).join(', ')}.`
      else if (spec && (Number.isFinite(spec.min) || Number.isFinite(spec.max))) {
        allowed = ` ${spec.label || spec.key} takes ${spec.type === 'int' ? 'a whole number' : 'a number'}${Number.isFinite(spec.min) && Number.isFinite(spec.max) ? ` from ${spec.min} to ${spec.max}` : Number.isFinite(spec.min) ? ` of at least ${spec.min}` : ` up to ${spec.max}`}.`
      }
      return `I didn't ${op === 'setInputs' ? 'change it' : 'add it'}: ${d.why || 'that setting is not valid'}.${allowed} Nothing was changed.`
    }
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
      return `Restored ${name}${where} with its original identity${back.length ? ` and reconnected ${back.join(', ')}` : ''}.`
    }
    if (receipt.undoOf === 'add') return `Removed the ${name} I added${where}.`
    if (receipt.undoOf === 'setInputs') return `Put ${name}${where} back to its previous settings.`
    return `Put ${name}${where} back to ${receipt.visible ? 'shown' : 'hidden'}.`
  }
  if (receipt.op === 'add') {
    // ⭐ PHASE 2.5 — the settings AS STORED (the confirmed receipt's own `inputs`), never the
    // words the member used.
    const set = receipt.inputs ? settingsPhrase(receipt.defId, receipt.inputs) : ''
    return `Added ${name}${where}${set ? ` — ${set}` : ''}.`
  }
  if (receipt.op === 'setInputs' && receipt.inputs) {
    // GATE C — what changed, AS STORED: "Changed EMA 9 on Chart (QQQ) — period 20 → 9"
    const specs = new Map(inputsOfDef(receipt.defId).map(i => [i.key, i]))
    const shown = (k, v) => { const s = specs.get(k); const o = s && s.type === 'enum' ? (s.options || []).find(x => x.value === v) : null; return o ? o.label : v }
    const pairs = Object.keys(receipt.inputs.after).map(k => `${String(specs.get(k)?.label || k).toLowerCase()} ${shown(k, receipt.inputs.before[k])} → ${shown(k, receipt.inputs.after[k])}`)
    return `Changed ${name}${where} — ${pairs.join(', ')}.`
  }
  if (receipt.op === 'remove') {
    const cut = severText(receipt.severed)
    return `Removed ${name}${where}${cut.length ? ` — disconnected ${cut.join(', ')}` : ''}.`
  }
  return `${receipt.visible ? 'Showed' : 'Hid'} ${name}${where}.`
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

// ⛔ §14.9 limit 3 — success needs an AUTHORITATIVE read-back. A host with no persist path has
// no ACK, and the rendered settings are not what was saved: neither may ever confirm a change.
async function persistAndReadBack(host, chartRef) {
  if (typeof host?.persist !== 'function') return { ok: false, reason: 'not-saved' }
  let r
  try { r = await host.persist() } catch { r = { ok: false, reason: 'not-saved' } }
  if (!r || !r.ok) return { ok: false, reason: (r && r.reason) || 'not-saved' }
  await afterRender()
  const c = host.charts.read(chartRef)
  // the board's STORED copy only — null (→ confirm says 'unconfirmed') if there is none
  return { ok: true, readBack: c && c.stored != null ? c.stored : null }
}

const fail = (msg, { unreverted = false } = {}) => Object.assign(new Error(msg), unreverted ? { unreverted: true } : {})

export const indicatorEditsKind = {
  name: 'indicatorEdits',
  noun: 'chart',                 // what a local "which one?" asks for
  // Its target IS a chart: the mutation policy counts "this chart's indicators" and "this chart" as one.
  groupOf: (ref) => chartRefOf(ref) ?? ref,
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
    // GATE C: the indicator this chat is now talking about ("make it a 9") — only from a CONFIRMED receipt
    const r = done.receipt
    if (!patch.undo && ['add', 'setInputs', 'setVisible'].includes(r.op) && r.instanceIds?.length === 1) {
      touched = { chartRef, instanceId: r.instanceIds[0], defId: r.defId, name: r.name }
    }
    return { lines: [receiptLine(done.receipt, label)], undoData: done.undo || null }
  },
  // `confirmIndicatorMutation` already verified the read-back inside commit.
  landed: () => true,
  // commit() above already persisted and read back the change: the runtime adds no second board write
  persistsInCommit: true,
  // Undo exists only when the interface minted a token on confirmation — held as returned.
  undoPatch: (item) => (item.undoData ? { undo: item.undoData } : null),
  // Staleness is the interface's (pins re-checked at apply / undo), not a whole-settings hash:
  // an unrelated chart change must not refuse an exact indicator Undo.
  fingerprint: (s) => s.chartRef,
}

// `sequential`: in a request that asks for more, each indicator change still runs ALONE (exclusive) —
// as its own step right after the rest, with its own receipt and Undo (useAgent), never mixed in a plan.
const common = { target: 'indicatorEdits', surfaces: ['charts'], exclusive: true, sequential: true,
  exclusiveReason: 'Change one indicator at a time, on its own — ask for anything else separately.',
  // Never advertised where the member cannot manage indicators (no writable chart on the board).
  available: (ctx) => ctx.surface === 'charts' && ctx.manageIndicators !== false }

function oneChange(st) { return st.change ? 'One indicator change at a time — ask for the next one after this.' : null }

/** Instance argument → the interface's own resolver (exact id, else a legend name). */
function targetOf(st, instance) {
  // GATE C: "#20" / "#20:ema" — the one instance whose legend shows that length (and type)
  const len = /^#(\d{1,4})(?::([a-z]+))?$/.exec(String(instance || ''))
  if (len) return instanceByLength(st, Number(len[1]), len[2] || null)
  const byId = resolveIndicatorTarget(st.cs, nativeRegistry, { instanceId: instance })
  if (byId.ok) return byId
  const byName = resolveIndicatorTarget(st.cs, nativeRegistry, { name: instance })
  if (byName.ok) return byName
  // Phase 2: "remove RSI" — the KIND of indicator, when exactly one of that kind is on the chart
  const want = String(instance || '').trim().toLowerCase()
  const kinds = (st.rows || []).filter(r => String(r.defId).toLowerCase() === want)
  return kinds.length === 1 ? { ok: true, instanceId: kinds[0].instanceId } : byName
}
/** "rsi" / "relative strength index" → the catalog id, when the words name exactly one indicator. */
function defIdOfWords(words) {
  const want = String(words || '').trim().toLowerCase()
  if (!want || NOT_ADDABLE.test(want)) return null
  const hits = addableRows().filter(r => String(r.defId).toLowerCase() === want || String(r.name).toLowerCase() === want)
  return hits.length === 1 ? hits[0].defId : null
}

// ⭐ PHASE 2.5 — the few settings phrasings that are unambiguous, mapped onto the definition's
// DECLARED keys and options (`inputsOfDef`), never onto a key this file invents. Every value is
// still the Indicators rule's to accept (an out-of-range "EMA 900" is refused BY NAME there).
//   "20 ema", "ema 20", "20-day ema", "200-period simple moving average", "50 day moving average"
//     → movingAverage {period, maType?} (maType only when the words name one of its options)
//   "rsi 7", "rsi(7)", "rsi with length 7", "atr with a period of 10"
//     → that indicator's ONE length input (`period`/`length`), when it has exactly one
const MA_TYPE_WORDS = {
  simple: 'sma', exponential: 'ema', weighted: 'wma', 'volume weighted': 'vwma', 'volume-weighted': 'vwma',
  hull: 'hma', smoothed: 'smma', 'double exponential': 'dema', 'triple exponential': 'tema', 'least squares': 'lsma',
}
function maTypeOf(words, options) {
  const w = String(words || '').trim()
  const values = new Set((options || []).map(o => String(o.value)))
  if (values.has(w)) return { ok: true, type: w }
  if (w === 'moving average' || w === 'ma') return { ok: true, type: null }
  const named = /^(.+?) moving average$/.exec(w)
  if (named && MA_TYPE_WORDS[named[1]] && values.has(MA_TYPE_WORDS[named[1]])) return { ok: true, type: MA_TYPE_WORDS[named[1]] }
  return { ok: false }
}
// ⭐ GATE C — MOVING-AVERAGE DEFAULTS (owner, approved provisionally 2026-10-13): a moving average named by
// its length alone ("the 9 and 20", "a 50 ma") is an EMA for 8, 9, 10, 20 and 21 and an SMA for 50 and
// above. Any other length has NO documented default: not guessed here (the model path asks). Explicit
// words always win ("a 20 sma"); an EDIT keeps the indicator's own type unless the member names one.
const EMA_DEFAULT_LENGTHS = new Set([8, 9, 10, 20, 21])
export function defaultMaType(n) {
  if (EMA_DEFAULT_LENGTHS.has(n)) return 'ema'
  return Number.isInteger(n) && n >= 50 ? 'sma' : null
}
export function settingsOfWords(words) {
  const w = String(words || '').trim().toLowerCase()
  // "the 9", "20" — a bare length is a moving average under the owner's defaults (or nothing)
  const bare = /^(?:the )?(\d{1,4})$/.exec(w)
  if (bare) {
    const n = Number(bare[1])
    const t = defaultMaType(n)
    return t ? { defId: 'movingAverage', inputs: [{ key: 'period', value: n }, { key: 'maType', value: t }], assumed: true } : null
  }
  let n = null
  let rest = null
  let m = /^(\d{1,4})(?:[- ](?:period|day|bar|length))?[- ](.+)$/.exec(w)
  if (m) { n = Number(m[1]); rest = m[2] }
  if (!m) {
    m = /^(.+?) with (?:a |an )?(?:length|period|lookback)(?: of)? (\d{1,4})$/.exec(w)
      || /^(.+?) ?\((\d{1,4})\)$/.exec(w)
      || /^(.+?) (\d{1,4})$/.exec(w)
    if (m) { rest = m[1]; n = Number(m[2]) }
  }
  if (!m || !Number.isInteger(n)) return null
  const ma = inputsOfDef('movingAverage')
  const maType = ma.find(i => i.key === 'maType')
  if (ma.some(i => i.key === 'period') && maType) {
    const t = maTypeOf(rest, maType.options)
    if (t.ok) {
      // "a 50 ma" / "20 day moving average": no type named → the owner's default, or no instant reading
      const type = t.type || defaultMaType(n)
      if (!type) return null
      return { defId: 'movingAverage', inputs: [{ key: 'period', value: n }, { key: 'maType', value: type }], ...(t.type ? {} : { assumed: true }) }
    }
  }
  const defId = defIdOfWords(rest)
  if (!defId) return null
  const lengths = inputsOfDef(defId).filter(i => i.type === 'int' && (i.key === 'period' || i.key === 'length'))
  return lengths.length === 1 ? { defId, inputs: [{ key: lengths[0].key, value: n }] } : null
}

// ── GATE C: which instance an edit means, and what it changes ──────────────────────────────────────────
// "the 20" / "the 20 ema" — an instance named by the LENGTH its legend shows (`#20`, `#20:ema`): exactly one
// on this chart, else the interface's own refusal (none → not-found; several → ambiguous, real names).
function instanceByLength(st, n, type) {
  const rows = (st.rows || []).filter(r => new RegExp(`(^|[^0-9.])${n}([^0-9.]|$)`).test(String(r.name || ''))
    && (!type || String(r.name || '').toLowerCase().includes(type)))
  if (rows.length === 1) return { ok: true, instanceId: rows[0].instanceId, name: rows[0].name }
  return rows.length ? { ok: false, reason: REASONS.AMBIGUOUS, detail: { candidates: rows.map(r => ({ instanceId: r.instanceId, name: r.name })) } } : { ok: false, reason: REASONS.NOT_FOUND }
}
const updateRequest = (st, instance, inputs) => {
  const ins = inputsOfArgs(inputs)
  if (!ins.ok || !ins.inputs) return null
  const t = targetOf(st, instance)
  return t.ok ? { op: 'setInputs', instanceId: t.instanceId, inputs: ins.inputs } : null
}
const TYPE_WORDS = `(?:${['ema', 'sma', 'wma', 'vwma', 'hma', 'smma', 'dema', 'tema', 'lsma', ...Object.keys(MA_TYPE_WORDS)].join('|')})`
const typeValue = (w) => (MA_TYPE_WORDS[w] || w)
/** The setting a bare NUMBER changes on one definition: `period` / `length` when it has exactly one such
 *  whole-number input, else null (the member must say which — "the MACD's fast length"). */
export function lengthKeyOf(defId) {
  const ints = inputsOfDef(defId).filter(i => i.type === 'int')
  const named = ints.filter(i => i.key === 'period' || i.key === 'length')
  if (named.length === 1) return named[0].key
  return ints.length === 1 ? ints[0].key : null
}
/** "a 9" / "an ema" / "a 9 ema" / "exponential" → [{key, value}] for ONE definition, from its declared inputs:
 *  a number → its one length; a type word → the enum input whose options carry it. null = not readable. */
export function inputsOfEditWords(defId, words) {
  const w = String(words || '').trim().toLowerCase().replace(/^(?:an? |the )/, '')
  const m = new RegExp(`^(?:(\\d{1,4})(?:[- ](?:day|period|bar|length))?)?(?:[- ]?(${TYPE_WORDS})(?: moving average)?)?$`).exec(w)
  if (!m || (!m[1] && !m[2])) return null
  const out = []
  if (m[1]) {
    const key = lengthKeyOf(defId)
    if (!key) return null
    out.push({ key, value: Number(m[1]) })
  }
  if (m[2]) {
    const v = typeValue(m[2])
    const enumInput = inputsOfDef(defId).find(i => i.type === 'enum' && (i.options || []).some(o => String(o.value) === v))
    if (!enumInput) return null
    out.push({ key: enumInput.key, value: v })
  }
  return out
}
// explicit edits the instant path reads without memory ("change the 20 to a 50", "make the rsi 7")
const EDIT_VERB = '(?:please )?(?:change|make|set|switch|turn|bump|move)'
function updateOfWords(lower) {
  // "change the 20 ema to a 50" / "make the 20 a 9" / "change the 20 to an sma"
  let m = new RegExp(`^${EDIT_VERB} (?:the |my )?(\\d{1,4})(?:[- ](?:day|period))?(?: (${TYPE_WORDS}|ma|moving average))? (?:to |into )?(?:an? |the )?(.+)$`).exec(lower)
  if (m) {
    const type = m[2] && m[2] !== 'ma' && m[2] !== 'moving average' ? typeValue(m[2]) : null
    const inputs = inputsOfEditWords('movingAverage', m[3])
    return inputs && inputs.length ? { instance: `#${m[1]}${type ? `:${type}` : ''}`, inputs } : null
  }
  // "make the rsi 7" / "change the rsi length to 2" / "set the atr period to 10"
  m = new RegExp(`^${EDIT_VERB} (?:the |my )?(.+?)(?:'s)?(?: (?:length|period|lookback))? (?:to |into )?(?:an? )?(\\d{1,4})$`).exec(lower)
  if (m) {
    const defId = defIdOfWords(m[1])
    const key = defId ? lengthKeyOf(defId) : null
    return key ? { instance: defId, inputs: [{ key, value: Number(m[2]) }] } : null
  }
  return null
}

// ── GATE C: the indicator a confirmed change last touched (session memory: "make it a 9") ──
let touched = null
/** The last CONFIRMED add / edit / show / hide: { chartRef, instanceId, defId, name } — taken once. */
export function takeIndicatorTouch() { const t = touched; touched = null; return t }
/** "make it a 9" / "change that to an SMA" on the indicator this chat last touched (`subject` from session
 *  memory, re-validated: still on that chart). → { op } | { say } | null (not an edit of it). */
export function updateOfSubject(host, subject, words) {
  if (!subject?.chart || !subject.instanceId) return null
  const c = host?.charts?.read?.(subject.chart)
  if (!c) return null
  const row = rowsOf(c.cs).find(r => r.instanceId === subject.instanceId)
  if (!row) return { say: `${subject.label || 'That indicator'} isn't on that chart any more, so there's nothing to change.` }
  const inputs = inputsOfEditWords(row.defId, words)
  if (!inputs) {
    const nums = /^(?:an? )?\d{1,4}$/.test(String(words || '').trim())
    return nums ? { say: `${row.name} has more than one length — which one should be ${String(words).replace(/^(?:an? )/, '')}?` } : null
  }
  return { op: { action: 'indicator.update', target: refOf(subject.chart), args: { instance: subject.instanceId, inputs } } }
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
  // ⛔ A TARGET IS ONLY VALID IF A CONTEXT ITEM PUBLISHES IT AS `ref` (the server's
  // `_context_refs`; anything else is refused as "Which one do you mean?"). One entry per chart.
  registerContextProvider({
    key: 'indicatorEdits',
    build: (host, refFor) => {
      const list = indicatorEditsKind.list(host)
      return list.length ? list.map(s => ({ ref: refFor('indicatorEdits', s.ref), chart: s.label, position: s.position, symbol: s.symbol, canManage: s.canManage })) : undefined
    },
  })
  registerContextProvider({
    key: 'indicatorCatalog',
    // what can be added — only when the request is about adding something
    build: (host, refFor, { message }) => (/\b(add|put|apply|insert|load|plot)\b/i.test(message || '') ? addableRows() : undefined),
    compact: (sec) => (sec || []).map(r => r.defId),
  })

  registerCapability({
    ...common,
    name: 'indicator.add',
    // ⭐ F5: the same add on several charts is proposed once and run once PER CHART (useAgent fan-out)
    fanOut: true,
    summary: 'Add ONE indicator to ONE chart — exactly what the Indicator Library\'s Add to Chart does. Built-in indicators or the member\'s own saved ones; Undo removes it again.',
    hints: 'target = the ref of that chart\'s indicatorEdits entry. defId = an id from indicatorCatalog (never invented, never a name). The SAME indicator on several charts = one indicator.add per chart named, same defId; if it isn\'t clear which charts, ask. Classic overlay averages (the legacy EMA/SMA rows) and Volume Profile are NOT added this way — say they live in Chart Settings. '
      + 'inputs = null for the indicator\'s defaults, else [{key, value}] with ONLY keys from that row\'s `settings` ("a 20 EMA" → movingAverage, [{key:"period",value:20},{key:"maType",value:"ema"}]; "RSI 7" → rsi, [{key:"period",value:7}]). '
      + 'Every number or type the member named goes in inputs — never drop one or add a default instead. A setting the row does not list: say it isn\'t available; never guess a key. '
      + 'A moving average named by its LENGTH only ("the 9 and 20", "a 50 ma"): EMA for 8, 9, 10, 20 and 21, SMA for 50 and above (the member\'s default — say which you used); any other length: ask EMA or SMA.',
    // ⭐ PHASE 2.5 — `inputs` is a closed-schema-safe LIST (`[{key, value}]`), turned into the
    // Indicators interface's `{key: value}` here; the interface (`agentMutations` → the settings
    // dialog's own `checkInstanceInput`) decides every value, refuses a bad one BY NAME, and
    // creates nothing then.
    args: {
      type: 'object',
      properties: {
        defId: { type: 'string' },
        inputs: {
          type: ['array', 'null'],
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, value: { type: ['string', 'number', 'boolean'] } },
            required: ['key', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['defId', 'inputs'],
      additionalProperties: false,
    },
    // Phase 1 — "put RSI on my chart", "add MACD": an indicator named EXACTLY (its catalog id or full
    // name, one match only) at its standard settings is an obvious command — no model call.
    // ⭐ Phase 2.5 — and with ONE length or a moving average's length + type ("a 20 EMA", "RSI 7",
    // "RSI with length 7", "a 200-period simple moving average"): `settingsOfWords`. Anything else
    // with parameters, or a near-name, goes to the model; the check below still decides.
    fast: ({ lower }) => {
      const m = /^(?:please )?(?:add|put|apply|plot)(?: an?| the| my)? (.+?)(?: indicator| study)?(?: (?:on|to|onto|in) (?:my|the|this) chart)?$/.exec(lower)
      if (!m) return null
      const defId = defIdOfWords(m[1])
      if (defId) return { defId, inputs: null }
      // (`assumed`: a default type was applied — the receipt names the type it used, "… ma type EMA")
      const s = settingsOfWords(m[1])
      if (!s) return null
      const { assumed, ...args } = s                                    // eslint-disable-line no-unused-vars
      return args
    },
    check(st, { defId, inputs }) {
      if (NOT_ADDABLE.test(String(defId || '').trim())) return refusalSentence({ reason: REASONS.UNSUPPORTED_DEFINITION })
      const ins = inputsOfArgs(inputs)
      if (!ins.ok) return refusalSentence({ reason: REASONS.BAD_INPUT, detail: { why: ins.why } })
      return oneChange(st) || planCheck(st, addRequest(defId, ins.inputs))
    },
    apply(st, { defId, inputs }) {
      const ins = inputsOfArgs(inputs)
      if (!ins.ok) return st
      const req = addRequest(defId, ins.inputs)
      const p = planFor(st, req)
      return p.ok ? { ...st, change: { request: req, plan: p.plan } } : st
    },
    describe: (b, a) => {
      if (!a.change) return null
      const { preview, defId } = a.change.plan
      const set = preview.inputs ? settingsPhrase(defId ?? a.change.request.defId, preview.inputs) : ''
      return `Add ${preview.name} to ${a.chart}${set ? ` — ${set}` : ''}`
    },
  })

  registerCapability({
    ...common,
    name: 'indicator.remove',
    risk: 'confirm',              // always a proposal: it can sever other indicators' inputs
    summary: 'Remove ONE indicator (its whole group, e.g. all COT panes) from ONE chart — the settings ✕ / legend Delete. Always shown as a proposal first, listing anything it would disconnect. Undo restores it exactly (same identity, reconnected inputs).',
    hints: 'target = the ref of that chart\'s indicatorEdits entry. instance = the indicator\'s `id` from that chart\'s indicators list (exact; a name only if it is unique). Volume is not an indicator (use volume.setState).',
    args: { type: 'object', properties: { instance: { type: 'string' } }, required: ['instance'], additionalProperties: false },
    // Phase 2 — "remove RSI", "get rid of the RSI": the indicator KIND named exactly; which instance
    // is decided on the chart (exactly one of that kind, else refused with the real names). Still
    // a proposal (risk confirm).
    fast: ({ raw, lower, host }) => {
      const m = /^(?:please )?remove(?: the| my)? (.+?)(?: from the chart)?$/.exec(lower)
      const defId = m ? defIdOfWords(m[1]) : null
      // ⛔ Gate B: "remove momentum" with a Momentum WATCHLIST (or layout / saved screen) is not read
      // as the indicator here — the model path sees both and asks. "the momentum indicator" is explicit
      // (read from the member's own words: the normaliser drops the word "indicator").
      if (defId && !/\b(?:indicator|study)\b/i.test(String(raw || '')) && namedKinds(host, m[1]).size) return null
      return defId ? { instance: defId } : null
    },
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

  // ⭐ GATE C — EDIT IN PLACE: "make it a 9", "change the 20 to a 50", "change that to an SMA", "make the rsi 7".
  // The SAME instance changes (never a remove + add, never a second copy); Indicators' `setInputs` decides every
  // value, writes through the settings rows' own doors, and mints the exact Undo. Instant when nothing reads the
  // indicator; a proposal when other indicators do (their inputs would move with it).
  registerCapability({
    ...common,
    name: 'indicator.update',
    summary: 'Change the settings of ONE indicator already on ONE chart, in place — its length, its moving-average type, or another setting its row lists (what the indicator\'s settings dialog does). Never adds a second copy. Undo puts the old settings back.',
    hints: 'target = the ref of that chart\'s indicatorEdits entry. instance = the indicator\'s `id` from that chart\'s indicators list (exact; a name only if it is unique). '
      + 'inputs = [{key, value}] with ONLY keys from that indicator\'s settings, and ONLY the settings the member named — everything else stays as it is (an EMA stays an EMA unless they name a type). '
      + '"make it a 9" right after adding an EMA 20 → that EMA, [{key:"period",value:9}]; "change that to an SMA" → [{key:"maType",value:"sma"}]. Use this — never indicator.remove + indicator.add — to change an indicator that is already on the chart.',
    args: {
      type: 'object',
      properties: {
        instance: { type: 'string' },
        inputs: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, value: { type: ['string', 'number', 'boolean'] } }, required: ['key', 'value'], additionalProperties: false } },
      },
      required: ['instance', 'inputs'],
      additionalProperties: false,
    },
    fast: ({ lower }) => updateOfWords(lower),
    // other indicators read this one → their inputs move with it: shown first, applied on approval
    confirmIf(st, { instance, inputs }) {
      const req = updateRequest(st, instance, inputs)
      if (!req) return false
      const p = planFor(st, req)
      return !!(p.ok && (p.plan.preview.dependents || []).length)
    },
    check(st, { instance, inputs }) {
      const ins = inputsOfArgs(inputs)
      if (!ins.ok) return refusalSentence({ reason: REASONS.BAD_INPUT, detail: { why: ins.why } }, { op: 'setInputs' })
      if (!ins.inputs) return 'Which setting should I change, and to what?'
      const t = targetOf(st, instance)
      if (!t.ok) return refusalSentence(t, { chart: st.chart })
      return oneChange(st) || planCheck(st, { op: 'setInputs', instanceId: t.instanceId, inputs: ins.inputs })
    },
    apply(st, { instance, inputs }) {
      const req = updateRequest(st, instance, inputs)
      if (!req) return st
      const p = planFor(st, req)
      return p.ok ? { ...st, change: { request: req, plan: p.plan } } : st
    },
    describe: (b, a) => {
      if (!a.change) return null
      const { preview } = a.change.plan
      const moved = (preview.dependents || []).length ? ` — ${severText(preview.dependents).join(', ')} will read the new settings` : ''
      return `Change ${preview.name} to ${preview.nameAfter} on ${a.chart}${moved}`
    },
    noop: () => 'It already has those settings — nothing changed.',
  })

  for (const [name, visible] of [['indicator.show', true], ['indicator.hide', false]]) {
    registerCapability({
      ...common,
      name,
      summary: `${visible ? 'Show' : 'Hide'} ONE indicator (its whole group) on ONE chart — the settings / legend eye. Undo puts it back.`,
      hints: 'target = the ref of that chart\'s indicatorEdits entry. instance = the indicator\'s `id` from that chart\'s indicators list (exact; a name only if it is unique). Volume is not an indicator (use volume.setState).',
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
