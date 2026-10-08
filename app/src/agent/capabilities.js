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

const NAME = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$/
const RISKS = new Set(['local', 'confirm'])

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
  // A QUERY capability only reads: `answer(snapshot, args, host)` returns the reply
  // (a string, or { text, table?, link? } for structured results; it may be async),
  // and nothing is planned or committed. The model may route to it (so the answer comes
  // from real state, not the model's reading of the context); the fast path too.
  const fns = cap.query ? ['answer'] : ['check', 'apply', 'describe']
  for (const fn of fns) {
    if (typeof cap[fn] !== 'function') throw new Error(`${cap.name}: ${fn}() required`)
  }
  CAPS.set(cap.name, { risk: 'local', reversible: true, domain: cap.name.split('.')[0], ...cap })
  return () => CAPS.delete(cap.name)
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
 *  (it must still leave enough for the model to DISCOVER it is relevant). */
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

/** Capabilities this member may use on this surface now (gates, entitlements, flags). */
export function availableCapabilities(ctx = {}) {
  return [...CAPS.values()].filter(c => {
    if (!KINDS.has(c.target)) return false
    if (c.surfaces && ctx.surface && !c.surfaces.includes(ctx.surface)) return false
    try { return c.available ? !!c.available(ctx) : true } catch { return false }
  })
}

/** The model-facing manifest: metadata only, no code. */
export function manifestFor(ctx = {}) {
  return availableCapabilities(ctx).map(c => ({
    name: c.name, domain: c.domain, target: c.target, summary: c.summary,
    hints: c.hints || null, args: c.args, risk: c.risk, reversible: c.reversible !== false,
  }))
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
    try { sections[p.key] = p.build(host, refFor, { message: ctx.message || '' }) } catch { /* a broken provider drops out, never breaks the turn */ }
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
  for (const k of sch.required) if (!(k in args)) return `Missing “${k}”.`
  for (const [k, p] of Object.entries(sch.properties)) {
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
