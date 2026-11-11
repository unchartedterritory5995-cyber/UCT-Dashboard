// ── UCT Agent CAPABILITY REGISTRY (uct.agent.capabilities/1) ────────────────
//
// THE extension seam. UCT Agent knows nothing about any feature except what is
// REGISTERED here. A feature becomes Agent-operable by registering:
//
//   registerTargetKind(kind)        what a target of this kind IS: how to read
//                                   its state, commit a change through the
//                                   feature's OWN canonical writer, verify the
//                                   change landed, and describe it compactly
//   registerContextProvider(p)      what the model is told about current targets
//   registerCapability(cap)         one operation: manifest (id, summary, args
//                                   schema, hints, risk, availability) + pure
//                                   check / apply / describe (+ optional async
//                                   prepare for lookups)
//
// The orchestrator (useAgent), planner (executor) and runtime iterate the
// registry; the server builds the model's schema and action list from the
// MANIFEST the browser sends — the manifests of capabilities AVAILABLE to this
// member on this surface right now. No central prompt or orchestration code
// changes when a capability is added. See agent/README.md.
//
// ⛔ Registration is not discovery of arbitrary code: a capability exists only
// if a developer registered it with a deterministic writer. The model can only
// name registered, available capabilities, and every op is re-validated here.

export const CAPABILITY_CONTRACT = 'uct.agent.capabilities/1'

const CAPS = new Map()
const KINDS = new Map()
const PROVIDERS = new Map()

// The manifest wire contract shared with the server (api/services/uct_agent/turn.py reads the
// same numbers; tests/test_uct_agent_contract.py and agentContracts.test.js hold both to it).
import MANIFEST_CONTRACT from './contract/manifest.contract.json'
export { MANIFEST_CONTRACT }
export const MANIFEST_VERSION = MANIFEST_CONTRACT.manifestVersion

const NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/
const RISKS = new Set(['local', 'confirm'])
const UNDO = new Set(['exact', 'none'])

/** Throws on a malformed registration — a broken capability never reaches a member. */
export function registerCapability(cap) {
  if (!cap || !NAME.test(cap.name || '')) throw new Error(`capability name invalid: ${cap && cap.name}`)
  if (!cap.summary || typeof cap.summary !== 'string') throw new Error(`${cap.name}: summary required`)
  if (!cap.target || typeof cap.target !== 'string') throw new Error(`${cap.name}: target kind required`)
  if (!RISKS.has(cap.risk || 'local')) throw new Error(`${cap.name}: risk must be local|confirm`)
  const a = cap.args
  if (!a || a.type !== 'object' || a.additionalProperties !== false
      || JSON.stringify([...(a.required || [])].sort()) !== JSON.stringify(Object.keys(a.properties || {}).sort())) {
    throw new Error(`${cap.name}: args must be a closed object whose properties are all required`)
  }
  // `absentAsNull`: args ADDED to an existing capability. The manifest still lists them as required (the
  // server's strict grammar needs a fully required object), but an arg shape from BEFORE they existed (the
  // key left out) validates as if it were null, as the server's own _fill_absent_nullables does. Each must be
  // a declared, nullable property.
  for (const k of cap.absentAsNull || []) {
    const t = a.properties[k]?.type
    if (!(Array.isArray(t) ? t : [t]).includes('null')) throw new Error(`${cap.name}: absentAsNull “${k}” must be a nullable property`)
  }
  // A QUERY capability only reads: `answer(snapshot, args, host)` returns the reply
  // (a string, or { text, table?, link? } for structured results; it may be async),
  // and nothing is planned or committed. The model may route to it (so the answer comes
  // from real state, not the model's reading of the context); the fast path too.
  const fns = cap.query ? ['answer'] : ['check', 'apply', 'describe']
  for (const fn of fns) {
    if (typeof cap[fn] !== 'function') throw new Error(`${cap.name}: ${fn}() required`)
  }
  // `reversible` is POLICY (false ⇒ always proposed: permanent / hard to take back).
  // `undo` is the TRUTH about the receipt: 'exact' = the kind restores it (an Undo button),
  // 'none' = no Undo exists (navigation, a recurring-email switch). It defaults from
  // `reversible`, and a capability whose kind cannot undo MUST say 'none' — the manifest tells
  // the model, and the receipt says so, so nothing ever implies an Undo that isn't there.
  const undo = cap.undo ?? (cap.query || cap.reversible === false ? 'none' : 'exact')
  if (!UNDO.has(undo)) throw new Error(`${cap.name}: undo must be exact|none`)
  checkTolerance(cap)
  CAPS.set(cap.name, { risk: 'local', reversible: true, domain: cap.name.split('.')[0], ...cap, undo })
  return () => CAPS.delete(cap.name)
}

// ── W1.1 R-01 (LT-3, live planner 2026-11-03): per-capability ARGS TOLERANCE, declared at registration ──
// The production model's args for an action are often a recoverable VARIANT of its schema. A capability may
// declare the variants it accepts (README.md "Args tolerance"); the manifest carries them, the server
// (turn.normalize_args) and this registry (normalizeArgs) apply exactly the same rules, logged, never guessed:
//   argAliases  { canonical: [alias, …] }   other KEY names (dotted = nested) read as the canonical arg when it is absent
//   coerce      { arg: { word: value } }    VALUE synonyms for one arg ("descending" → "desc", "exit" → null)
//   defaults    { arg: value }              the value of a REQUIRED non-nullable arg the model left out or set null
//   defaultsWhen { arg: { other: [values] } } (W1.1 review NB-2) the default applies ONLY when every named other arg
//                                           (after aliases / coerce) holds one of its values
//   shape       'one exact example…'        printed under the action's catalog line (≤ MAX_SHAPE chars)
// Plus the schema-driven rules every action gets: a string the schema types as boolean / number / null, enum
// case-folding, a number whose text is an enum string. A malformed declaration throws here (never ships).
const ARG_PATH = /^[a-zA-Z_][a-zA-Z0-9_]*(\.[a-zA-Z_][a-zA-Z0-9_]*)*$/
export const MAX_SHAPE = MANIFEST_CONTRACT.limits.maxShape
function checkTolerance(cap) {
  const props = cap.args.properties || {}
  const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
  if (cap.argAliases != null) {
    if (!isObj(cap.argAliases)) throw new Error(`${cap.name}: argAliases must be {canonical: [alias…]}`)
    for (const [canon, list] of Object.entries(cap.argAliases)) {
      if (!ARG_PATH.test(canon) || !(canon.split('.')[0] in props)) throw new Error(`${cap.name}: argAliases ${canon} is not an argument`)
      if (!Array.isArray(list) || !list.length) throw new Error(`${cap.name}: argAliases ${canon} needs a list of alias names`)
      for (const a of list) {
        if (typeof a !== 'string' || !ARG_PATH.test(a) || a === canon) throw new Error(`${cap.name}: bad alias ${a} for ${canon}`)
        if (a.split('.')[0] in props && !a.includes('.')) throw new Error(`${cap.name}: alias ${a} is already an argument`)
      }
    }
  }
  if (cap.coerce != null) {
    if (!isObj(cap.coerce)) throw new Error(`${cap.name}: coerce must be {arg: {word: value}}`)
    for (const [arg, words] of Object.entries(cap.coerce)) {
      if (!ARG_PATH.test(arg) || !(arg.split('.')[0] in props) || !isObj(words)) throw new Error(`${cap.name}: coerce ${arg} is not an argument map`)
      for (const v of Object.values(words)) if (v !== null && !['string', 'number', 'boolean'].includes(typeof v)) throw new Error(`${cap.name}: coerce ${arg} values must be scalars`)
    }
  }
  if (cap.defaults != null) {
    if (!isObj(cap.defaults)) throw new Error(`${cap.name}: defaults must be {arg: value}`)
    for (const arg of Object.keys(cap.defaults)) if (!(arg in props)) throw new Error(`${cap.name}: defaults ${arg} is not an argument`)
  }
  if (cap.defaultsWhen != null) {
    if (!isObj(cap.defaultsWhen)) throw new Error(`${cap.name}: defaultsWhen must be {arg: {other: [values]}}`)
    for (const [arg, cond] of Object.entries(cap.defaultsWhen)) {
      if (!isObj(cap.defaults) || !(arg in cap.defaults)) throw new Error(`${cap.name}: defaultsWhen ${arg} has no declared default`)
      if (!isObj(cond) || !Object.keys(cond).length) throw new Error(`${cap.name}: defaultsWhen ${arg} must name {other: [values]}`)
      for (const [k, vals] of Object.entries(cond)) {
        if (!(k in props) || !Array.isArray(vals) || !vals.length || vals.some(x => !['string', 'number', 'boolean'].includes(typeof x))) {
          throw new Error(`${cap.name}: defaultsWhen ${arg}.${k} must be an argument with a list of scalar values`)
        }
      }
    }
  }
  if (cap.shape != null && (typeof cap.shape !== 'string' || cap.shape.length > MAX_SHAPE)) throw new Error(`${cap.name}: shape is a string of at most ${MAX_SHAPE} characters`)
}

const TRUE_WORDS = new Set(['true', 'on', 'yes', 'enabled', 'enable', 'show', '1'])
const FALSE_WORDS = new Set(['false', 'off', 'no', 'disabled', 'disable', 'hide', '0'])
const NULL_WORDS = new Set(['null', 'none', 'nil', 'nothing', ''])
// W1.1 review NB-1: where the schema also allows a STRING (a name), only the JSON-ish null spellings become null
const NULL_WORDS_FOR_STRINGS = new Set(['null', ''])
const NUMBER_TEXT = /^[-+]?\$?\s*(\d{1,3}(,\d{3})+|\d+)(\.\d+)?\s*%?$/
const typesOf = (spec) => {
  const t = spec?.type
  const out = typeof t === 'string' ? [t] : Array.isArray(t) ? [...t] : []
  for (const b of spec?.anyOf || []) out.push(...typesOf(b))
  return out
}
const getPath = (o, path) => path.split('.').reduce((v, k) => (v && typeof v === 'object' && !Array.isArray(v) && k in v ? v[k] : undefined), o)
function setPath(o, path, v) {
  const segs = path.split('.')
  let cur = o
  for (const s of segs.slice(0, -1)) { if (!cur[s] || typeof cur[s] !== 'object' || Array.isArray(cur[s])) cur[s] = {}; cur = cur[s] }
  cur[segs[segs.length - 1]] = v
}
function delPath(o, path) {
  const segs = path.split('.')
  const parents = []
  let cur = o
  for (const s of segs.slice(0, -1)) { parents.push([cur, s]); cur = cur[s]; if (!cur || typeof cur !== 'object') return }
  delete cur[segs[segs.length - 1]]
  // a container emptied by the move is dropped too ({"sort": {}} after sort.field → sort_field)
  for (const [parent, s] of parents.reverse()) { if (parent[s] && typeof parent[s] === 'object' && !Object.keys(parent[s]).length) delete parent[s]; else break }
}
function coerceSchema(spec, v, path, applied) {
  if (!spec || typeof spec !== 'object') return v
  const types = typesOf(spec)
  const enumVals = spec.enum || []
  if (typeof v === 'string') {
    const low = v.trim().toLowerCase()
    if (types.includes('null') && (types.includes('string') ? NULL_WORDS_FOR_STRINGS : NULL_WORDS).has(low)) { applied.push(`${path}:null-word`); return null }
    if (!types.includes('string')) {
      if (types.includes('boolean') && (TRUE_WORDS.has(low) || FALSE_WORDS.has(low))) { applied.push(`${path}:string->boolean`); return TRUE_WORDS.has(low) }
      if ((types.includes('number') || types.includes('integer')) && NUMBER_TEXT.test(v.trim())) {
        const n = Number(v.trim().replace(/[$,%\s]/g, ''))
        if (Number.isFinite(n) && (types.includes('number') || Number.isInteger(n))) { applied.push(`${path}:string->number`); return n }
      }
    }
    if (enumVals.length && !enumVals.includes(v)) {
      const hit = enumVals.find(e => typeof e === 'string' && e.trim().toLowerCase() === low)
      if (hit !== undefined) { applied.push(`${path}:enum-case`); return hit }
    }
    return v
  }
  if (typeof v === 'boolean') {
    if (!types.includes('boolean') && enumVals.length) {
      const hit = enumVals.find(e => typeof e === 'string' && e.toLowerCase() === String(v))
      if (hit !== undefined) { applied.push(`${path}:boolean->enum`); return hit }
    }
    return v
  }
  if (typeof v === 'number') {
    if (types.includes('string') && enumVals.length && !enumVals.includes(v)) {
      const s = String(v)
      if (enumVals.includes(s)) { applied.push(`${path}:number->enum`); return s }
    }
    return v
  }
  if (Array.isArray(v)) {
    const items = spec.items && typeof spec.items === 'object' ? spec.items : (spec.anyOf || []).find(b => b?.type === 'array' && b.items)?.items
    return items ? v.map(x => coerceSchema(items, x, `${path}[]`, applied)) : v
  }
  if (v && typeof v === 'object') {
    const branches = [spec, ...(spec.anyOf || [])].filter(b => b && b.properties && typeof b.properties === 'object')
    const branch = branches.find(b => Object.keys(v).every(k => k in b.properties)) || branches[0]
    if (!branch) return v
    const out = { ...v }
    for (const [k, sub] of Object.entries(branch.properties)) {
      if (k in out) out[k] = coerceSchema(sub, out[k], `${path}.${k}`, applied)
      else if (typesOf(sub).includes('null')) { out[k] = null; applied.push(`${path}.${k}:absent-null`) }
    }
    return out
  }
  return v
}

/**
 * A capability's args with its declared aliases / value synonyms / defaults and the schema-driven coercions
 * applied — the browser half of turn.normalize_args (the same rules, so a fast-path, NL-1 or planner-v2 op is as
 * tolerant as a legacy one). Returns { args, applied } (rule names and keys only, never values). Pure and total:
 * what it cannot read is returned as it came, for shapeError to refuse.
 */
export function normalizeArgs(name, args) {
  const c = CAPS.get(name)
  if (!c || !args || typeof args !== 'object' || Array.isArray(args)) return { args, applied: [] }
  const props = c.args.properties || {}
  const applied = []
  const out = JSON.parse(JSON.stringify(args))
  for (const [canon, list] of Object.entries(c.argAliases || {})) {
    if (getPath(out, canon) !== undefined) continue
    for (const a of list) {
      const v = getPath(out, a)
      if (v === undefined) continue
      delPath(out, a); setPath(out, canon, v); applied.push(`alias:${a}->${canon}`)
      break
    }
  }
  for (const [arg, words] of Object.entries(c.coerce || {})) {
    const v = getPath(out, arg)
    if (typeof v === 'string') {
      const low = v.trim().toLowerCase()
      if (Object.prototype.hasOwnProperty.call(words, low)) { setPath(out, arg, words[low]); applied.push(`${arg}:word`) }
    }
  }
  for (const [arg, v] of Object.entries(c.defaults || {})) {
    const cond = c.defaultsWhen?.[arg]
    const holds = (v, vals) => (typeof v === 'string' ? vals.some(x => typeof x === 'string' && x.trim().toLowerCase() === v.trim().toLowerCase()) : v !== undefined && vals.includes(v))
    if (cond && !Object.entries(cond).every(([k, vals]) => holds(out[k], vals))) continue   // W1.1 review NB-2 (strings case-insensitive)
    if (!(arg in out) || (out[arg] === null && !typesOf(props[arg]).includes('null'))) { out[arg] = JSON.parse(JSON.stringify(v)); applied.push(`${arg}:default`) }
  }
  for (const [k, spec] of Object.entries(props)) {
    if (k in out) out[k] = coerceSchema(spec, out[k], k, applied)
    else if (typesOf(spec).includes('null')) { out[k] = null; applied.push(`${k}:absent-null`) }     // (the server's 2026-10-08 rule)
  }
  return { args: out, applied }
}

/**
 * kind = {
 *   name,
 *   list(host)            -> [snapshot]         snapshot.ref is stable; .label human
 *   read(host, ref)       -> snapshot | null
 *   stateOf(snapshot)     -> state               the value capabilities transform
 *   patch(before, after)  -> patch | null        what to write (null = unchanged)
 *   commit(host, ref, patch)                     through the feature's own writer
 *   landed(snapshot, patch) -> boolean           read-back ACK
 *   undoPatch(item)       -> patch               restore `before`
 *   fingerprint(snapshot) -> string              revision for freshness / stale undo
 * }
 */
export function registerTargetKind(kind) {
  for (const fn of ['list', 'read', 'stateOf', 'patch', 'commit', 'landed', 'undoPatch', 'fingerprint']) {
    if (typeof kind[fn] !== 'function') throw new Error(`target kind ${kind.name}: ${fn}() required`)
  }
  KINDS.set(kind.name, kind)
  return () => KINDS.delete(kind.name)
}

// OPTIONAL hooks for compound CREATION (a plan that makes new targets and then
// configures them in the same request):
//   capability.creates(args) -> null | { kind, alias, spec }
//        this op makes a new target of `kind`; later ops in the SAME plan may
//        target `alias` (transaction-local — never persisted, never an id)
//   kind.virtual({ alias, n, spec }) -> snapshot
//        a planning stand-in for a target that does not exist yet (its defaults)
//   kind.createFlags(ops on that alias) -> object
//        anything the creator must do at creation time for those ops to be safe
//        (charts: unlink when the plan gives the new chart its own symbol)
//   kind.fingerprintFor(host, snap, undoItem) -> string
//        narrow the stale-undo check to what this item actually owns
//   kind.commit may be async and may return { created: { alias: realRef } }
//
// OPTIONAL policy / undo hooks:
//   capability.confirmIf(state, args, env) -> boolean
//        this op, in THIS state, must be proposed rather than applied (e.g. a
//        switch that would discard unsaved edits)
//   kind.undoPatch(item) may return null: that change has no Undo (the receipt
//        then offers none)
//   host.epoch() -> string   which board the targets belong to; a plan proposed
//        on one board is never applied to another, and undo never crosses it

/** provider = { key, kind?, build(host, refFor, { message }) -> JSON-able context section,
 *               compact?(section) -> a smaller section that still says what was left out }
 *  `message` is the member's request, so a provider may send its detail only when relevant
 *  (it must still leave enough for the model to DISCOVER it is relevant).
 *  `nl1` (NL-1, flag off by default): the model interprets the request, so a provider never gates
 *  its detail on the member's WORDS — it sends it, and the context budget compacts it. */
export function registerContextProvider(p) {
  if (!p || !p.key || typeof p.build !== 'function') throw new Error('context provider needs key + build()')
  PROVIDERS.set(p.key, p)
  return () => PROVIDERS.delete(p.key)
}

// ── TYPED OUTPUTS (cross-domain composition) ─────────────────────────────────
// One registered capability's RESULT may feed another's ARGUMENT in the same
// request, without a second model call and without the model ever seeing it.
// Deliberately narrow — ONE data type today, no expressions, no paths:
//   capability.produces = 'symbols'          a query whose result is an ORDERED
//     + produce(args, host) -> { symbols,     ticker list (e.g. a screen); it takes
//         count, summary }                    `as` to name that result in the plan
//   capability.inputs = { <arg>: 'symbols' }  that arg may be a ticker list OR a
//                                             reference { from, top }
//   registerOutputSource({ ref, type, available(), summary(), resolve() })
//                                             a standing result outside the plan
//                                             (the last screen) a reference may name
// The executor resolves references at APPLY (fresh), substitutes the actual
// symbols, then re-plans and commits through the ordinary path.
export const SYMBOLS = 'symbols'
const SOURCES = new Map()
export function registerOutputSource(src) { SOURCES.set(src.ref, src); return () => SOURCES.delete(src.ref) }
export const getOutputSource = (ref) => SOURCES.get(ref) || null

/** A reference value: exactly { from: string, top: integer|null } — nothing else. */
export function isRef(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && Object.keys(v).sort().join(',') === 'from,top' && typeof v.from === 'string'
    && (v.top === null || Number.isInteger(v.top))
}

// A feature may WARM its data when the Agent opens (e.g. fetch a catalog it will
// need for its context), so the first question doesn't pay for it. Never throws.
const WARMUPS = new Set()
export function registerWarmup(fn) { WARMUPS.add(fn); return () => WARMUPS.delete(fn) }
export function runWarmups(host) { for (const fn of WARMUPS) { try { Promise.resolve(fn(host)).catch(() => {}) } catch { /* a warm-up never breaks the panel */ } } }

export const getCapability = (name) => CAPS.get(name) || null
export const getTargetKind = (name) => KINDS.get(name) || null
export const allCapabilityNames = () => [...CAPS.keys()]

// ⭐ W2-C1 (multi-page host): a capability's `surfaces` names the pages it is offered on. `['*']`
// (ALL_SURFACES) = every page the Agent is mounted on — QUERIES that read UCT's own data (stock.*,
// news.*, breadth.*, guide, about, app.open) and need nothing from the page. A WRITE names its page
// ('charts', 'screener', 'journal' …): it is offered only where the page's own writer is on the host.
export const ALL_SURFACES = ['*']
export const onSurface = (cap, surface) => !cap?.surfaces || !surface || cap.surfaces.includes('*') || cap.surfaces.includes(surface)

/** Capabilities this member may use on this surface now (gates, entitlements, flags). */
export function availableCapabilities(ctx = {}) {
  return [...CAPS.values()].filter(c => {
    if (!KINDS.has(c.target)) return false
    if (!onSurface(c, ctx.surface)) return false
    try { return c.available ? !!c.available(ctx) : true } catch { return false }
  })
}

/** The model-facing manifest: metadata only, no code. */
export function manifestFor(ctx = {}) {
  return availableCapabilities(ctx).map(c => ({
    name: c.name, domain: c.domain, target: c.target, summary: c.summary,
    hints: c.hints || null, args: c.args, risk: c.risk, reversible: c.reversible !== false, undo: c.undo, query: !!c.query,
    // W1.1 R-01: the capability's args tolerance (null when it declares none) and its exact-shape example
    argAliases: c.argAliases || null, coerce: c.coerce || null, defaults: c.defaults || null, defaultsWhen: c.defaultsWhen || null,
    shape: c.shape || null,
  }))
}

/**
 * Before a model turn: every provider's optional async `refresh()` (re-read data that can change
 * OUTSIDE this panel — e.g. an alert made from a chart menu), all at once, capped at `budgetMs`.
 * A slow or failing refresh never blocks the turn; the provider then builds from what it has.
 */
// `groups` (Phase 2): refresh only the providers whose `refreshGroup` is among the routing groups this
// message was sent with (null = every provider). A provider with no `refreshGroup` always refreshes.
// `refresh` is handed those groups: a section that is sent only with its group reads them here.
export async function refreshContext(budgetMs = 1500, { groups = null } = {}) {
  const jobs = [...PROVIDERS.values()].filter(p => typeof p.refresh === 'function')
    .filter(p => !groups || !p.refreshGroup || groups.includes(p.refreshGroup))
    .map(p => Promise.resolve().then(() => p.refresh({ groups })).catch(() => {}))
  if (!jobs.length) return
  await Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, budgetMs))])
}

/** Build every registered provider's context section. Short refs ("c1") map to real refs. */
export function buildContext(host, ctx = {}) {
  const refMap = {}
  const counters = {}
  const refFor = (kind, realRef) => {
    const prefix = kind[0]
    counters[prefix] = (counters[prefix] || 0) + 1
    const short = `${prefix}${counters[prefix]}`
    refMap[short] = { kind, ref: realRef }
    return short
  }
  const sections = { surface: ctx.surface || null }
  for (const p of PROVIDERS.values()) {
    try { sections[p.key] = p.build(host, refFor, { message: ctx.message || '', nl1: ctx.nl1 === true }) } catch { /* a broken provider drops out, never breaks the turn */ }
  }
  // ⛔ AN EXPLICIT BUDGET, NEVER A SILENT CUT. Over it, providers that can compact themselves do
  // so, one at a time in registration order, and the compacted section says what it left out
  // (the server would otherwise refuse the whole turn as too large).
  const size = () => JSON.stringify(sections).length
  for (const p of PROVIDERS.values()) {
    if (size() <= CONTEXT_BUDGET_BYTES) break
    if (typeof p.compact !== 'function' || sections[p.key] === undefined) continue
    try { sections[p.key] = p.compact(sections[p.key]) } catch { /* keep the full section */ }
  }
  return { context: sections, refMap }
}

/** The client's context budget, under the server's hard cap (MAX_CONTEXT_BYTES = 24000). */
export const CONTEXT_BUDGET_BYTES = 20000

/**
 * Shape-check args against the capability's own JSON schema (closed object,
 * required keys, enums, primitive types). Every caller passes this gate.
 */
export function shapeError(name, args, ctx) {
  const c = CAPS.get(name)
  if (!c || (ctx && !availableCapabilities(ctx).includes(c))) return `UCT Agent can't “${name}” here.`
  const sch = c.args
  if (!args || typeof args !== 'object' || Array.isArray(args)) return 'That action is missing its details.'
  for (const k of Object.keys(args)) if (!(k in sch.properties)) return `Unexpected detail “${k}”.`
  const asNull = c.absentAsNull || []
  for (const k of sch.required) if (!(k in args) && !asNull.includes(k)) return `Missing “${k}”.`
  for (const [k, p] of Object.entries(sch.properties)) {
    if (!(k in args) && asNull.includes(k)) continue
    const v = args[k]
    // A typed-output input (capability.inputs) may hold a reference instead.
    if (c.inputs?.[k] && isRef(v)) continue
    const branches = p.anyOf || [p]
    const ok = branches.some(b => (Array.isArray(b.type) ? b.type : [b.type]).some(t => (t === 'null' ? v === null
      : t === 'integer' ? Number.isInteger(v)
        : t === 'array' ? Array.isArray(v)
          : t === 'object' ? (!!v && typeof v === 'object' && !Array.isArray(v))
            : typeof v === t)))
    if (!ok) return `“${k}” has the wrong kind of value.`
    if (p.enum && v !== null && !p.enum.includes(v)) return `“${v}” isn't an option for ${k}.`
  }
  return null
}
