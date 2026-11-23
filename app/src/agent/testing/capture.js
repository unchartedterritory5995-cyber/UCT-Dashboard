// ── NL-1 EVAL: the request a turn would send, built without a model call ────────────────────
//
//   mode 'nl1'     buildNl1Request — the SAME function the panel uses with NL-1 on
//   mode 'legacy'  today's request: routed manifest + keyword-gated context, as useAgent.send builds it
//                  (agentEvalCapture.test.js checks it against what the real panel sends)
//
// Conversations are teacher-forced: earlier turns' EXPECTED changes are noted in a real session memory
// (agent/memory.js), exactly as the panel notes a committed change, so references like "make it 15
// minutes instead" are asked with the memory the member would have.

import { buildContext, manifestFor, getCapability, getTargetKind, MANIFEST_VERSION, MANIFEST_CONTRACT } from '../capabilities'
import { GROUPS, groupOfAction, routeManifest, routingNames } from '../routing'
import { routeManifestV2 } from '../nlm1/routingV2'
import { NL1_MAX_NEED, nl1GroupOf } from '../nl1/selection'
import { correctTypos, lexiconFor } from '../nl/lexicon'
import { createMemory } from '../memory'
import { buildNl1Request, exactLane } from '../nl1/interpreter'
import { hostFor, nameToId } from './fixtureHost'
import { turnsOf } from './sets'

/** The real ref of a target named the way a case names it (a label, 'selected', or a list / layout name). */
function refOfHint(host, hint, action, selectedRef) {
  if (!hint) return null
  if (hint === 'selected') return selectedRef
  const kind = getTargetKind(getCapability(action)?.target)
  const list = (() => { try { return kind?.list(host) || [] } catch { return [] } })()
  const hit = list.find(s => String(s.label).toLowerCase() === String(hint).toLowerCase())
  return hit ? hit.ref : (list.length === 1 ? list[0].ref : null)
}

// the capability context of an admin's Charts panel, as useAgent builds it (createIndicator: the admin + flag rule)
export const CAP_CTX = { surface: 'charts', createIndicator: true }
const managesIndicators = (host) => { try { return host.charts.list().some(c => host.charts.canManageIndicators?.(c.ref) === true) } catch { return false } }

/** The routers the legacy request can be built with: 'v1' (routing.js, the default here) or 'v2' (NLM-1 routing v2 —
 *  what production's panel uses while UCT_AGENT_ROUTING_V2 is on, nlm1/flag.js pickRouter). */
export const ROUTERS = { v1: routeManifest, v2: routeManifestV2 }

function legacyRequest({ host, text, memory, router = 'v1', catalogs = null }) {
  const full = manifestFor({ ...CAP_CTX, manageIndicators: managesIndicators(host) })
  const route = ROUTERS[router]
  if (!route) throw new Error(`unknown router ${router}`)
  const routeOpts = {
    enabled: true, pendingActions: [], recentActions: (memory.lastChange()?.ops || []).map(o => o.action),
    limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold,
    names: routingNames(host), correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text),
  }
  const routed = route(full, text, routeOpts)
  const legacy = catalogs ? legacyRerouteRecord({ full, text, routed, route, routeOpts, catalogs }) : null
  const { context, refMap } = buildContext(host, { ...CAP_CTX, message: text })
  const back = Object.fromEntries(Object.entries(refMap).map(([k, v]) => [v.ref, k]))
  const m = memory.forModel()
  const mem = m ? (m.subject_chart ? { ...m, subject_chart: back[m.subject_chart] || null } : m) : null
  return {
    body: { message: text, context: mem ? { ...context, conversation_memory: mem } : context, capabilities: routed.manifest,
      manifestVersion: MANIFEST_VERSION, routing: routed.routing, pending: null },
    refMap,
    ...(legacy || {}),
  }
}

/**
 * The legacy panel's ONE reroute (useAgent: the model answers `need_groups` → `route(full, text, routeOpts, need)` → the
 * same request again with `reroute: true`, or "That touches too many parts of UCT…" when a needed group still does not
 * fit), tabled for the eval replay (tools/agent_eval_run.py --mode legacy). One entry per set of at most
 * LEGACY_MAX_NEED groups the first request did not carry: { idx: positions in the full catalog, routing } or null (the
 * panel would stop). The full catalog is stored ONCE in `catalogs` ({ catalog, kind: 'legacy', manifest }).
 */
export const LEGACY_MAX_NEED = 2
export function legacyRerouteRecord({ full, text, routed, route, routeOpts, catalogs }) {
  if (!routed.routing) return null                       // the whole catalog was sent: the panel never reroutes
  const json = JSON.stringify(full)
  const id = catalogId(json)
  if (!catalogs.has(id)) catalogs.set(id, { catalog: id, kind: 'legacy', manifest: full })
  const pos = new Map(full.map((c, i) => [c.name, i]))
  const unselected = GROUPS.map(g => g.id).filter(g => !routed.routing.selected.includes(g) && full.some(c => groupOfAction(c.name) === g))
  const reroutes = {}
  for (const need of subsetsUpTo(unselected, LEGACY_MAX_NEED)) {
    const r = route(full, text, routeOpts, need)
    const fits = !r.routing || need.every(g => r.routing.selected.includes(g))
    // the routing's `groups` (every group's id + title, ~6 KB) is the first request's whenever it is the same: left out
    // (the replay takes it from the body), so the table stays small (~700 entries a request)
    const routing = r.routing && JSON.stringify(r.routing.groups) === JSON.stringify(routed.routing.groups)
      ? (({ groups, ...rest }) => (void groups, rest))(r.routing) : r.routing
    reroutes[need.join('+')] = fits ? { idx: r.manifest.map(c => pos.get(c.name)), routing } : null
  }
  return { catalog: id, legacyReroutes: reroutes }
}

// FNV-1a of a catalog's JSON: one id per distinct manifest (the capture stores each catalog once)
const catalogId = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 } return `cat-${h.toString(16)}-${s.length}` }

/** Every non-empty subset of `ids` with at most `k` members, each sorted (the reroute table's keys). */
export function subsetsUpTo(ids, k) {
  const out = []
  const walk = (start, cur) => {
    if (cur.length) out.push([...cur].sort())
    if (cur.length === k) return
    for (let i = start; i < ids.length; i++) walk(i + 1, [...cur, ids[i]])
  }
  walk(0, [])
  return out
}

/**
 * NL-1 selection, as the eval replays it (tools/agent_eval_run.py):
 *   selection  what decided the first call's actions
 *   reroutes   for every set of up to NL1_MAX_NEED unselected groups the model might ask for: the groups the
 *              panel's reroute would send (null = they do not fit; the panel then says so and stops)
 *   catalog    the id of this request's full available manifest (stored once, in `catalogs`)
 */
export function selectionRecord(req, catalogs, needsOf = null, expect = null) {
  const s = req.selection
  const json = JSON.stringify(req.full)
  const id = catalogId(json)
  if (catalogs && !catalogs.has(id)) {
    catalogs.set(id, {
      catalog: id, manifest: req.full, core: s.core,
      groupOf: Object.fromEntries(req.full.map(c => [c.name, nl1GroupOf(c.name)])),
      groups: GROUPS.filter(g => req.full.some(c => nl1GroupOf(c.name) === g.id)).map(g => ({ id: g.id, title: g.title })),
    })
  }
  // the reroute table only for an eval export (a `catalogs` collector): it is ~100 selections per request
  const reroutes = {}
  // `needsOf(selection, expect)` (optional) narrows WHICH needs are tabled; the default is every set of up to NL1_MAX_NEED
  for (const need of catalogs ? (needsOf ? needsOf(s, expect) : subsetsUpTo(s.unselected, NL1_MAX_NEED)) : []) {
    const r = req.reselect(need)
    reroutes[need.join('+')] = r.needMet ? { selected: r.selected, wordsNotSent: r.wordsNotSent } : null
  }
  return {
    catalog: id,
    selection: { core: s.core, pins: s.pins, selected: s.selected, unselected: s.unselected, wordGroups: s.wordGroups, wordsNotSent: s.wordsNotSent },
    reroutes,
  }
}

/**
 * Every turn of one case → { key, caseId, turn, mode, body, history, refMap } (+ NL-1: catalog, selection, reroutes).
 * `spec` = corpus.json's { fixtures, library }; `mode` = 'nl1' | 'legacy'. `catalogs` (a Map) collects each
 * distinct NL-1 catalog once. Legacy only: `router` 'v1' | 'v2' (ROUTERS); `legacyReroutes` tables the legacy panel's
 * need_groups reroute (legacyRerouteRecord) into `catalogs`, for a replay that reroutes as production does.
 */
export function captureCase(spec, c, mode, { isProtectedLayout = null, catalogs = null, budget = undefined, rerouteNeeds = null, router = 'v1', legacyReroutes = false } = {}) {
  const out = []
  const memory = createMemory()
  for (const t of turnsOf(c)) {
    const { host, selected, lib } = hostFor(spec, c.fx, { state: t.state, libExtra: c.libExtra })
    const selectedRef = selected ? host.charts.list().find(s => s.ref === selected || s.ref.endsWith(selected))?.ref || null : null
    let history = t.hist
    let req
    if (mode === 'nl1') {
      // a question UCT asked and is waiting on: its choices are the board's own targets, by label
      const pq = t.pending ? {
        text: t.pending.question,
        choices: (t.pending.choices || []).map(label => {
          const any = host.charts.list().find(s => s.label === label)
          return { label, ref: any ? any.ref : null }
        }),
      } : null
      if (t.pending) history = [...history, { role: 'member', text: t.pending.request }]
      // the member's previous message, as the panel passes it (useAgent: the chat's last member line before this one). A
      // single case's `hist` alternates member / UCT lines (member first); a conversation's history carries its roles.
      const said = Array.isArray(c.turns) ? history.filter(h => h.role === 'member').map(h => h.text)
        : [...(c.hist || []).filter((_, i) => i % 2 === 0), ...(t.pending ? [t.pending.request] : [])]
      const prevText = said[said.length - 1] || ''
      req = buildNl1Request({ host, text: t.say, capCtx: CAP_CTX, manageIndicators: managesIndicators(host), memory, pendingQuestion: pq, isProtectedLayout, budget, prevText })
    } else {
      // today: a local question is stored in the browser; the model sees only that one was asked
      if (t.pending) history = [...history, { role: 'member', text: t.pending.request }, { role: 'outcome', text: 'Asked which target.', data: { kind: 'clarify-target' } }]
      req = legacyRequest({ host, text: t.say, memory, router, catalogs: legacyReroutes ? catalogs : null })
    }
    // EXACT Undo / Cancel with something to act on never reach the model (useAgent): marked, never sent or scored as model turns
    const x = exactLane(t.say)
    const exact = x && (x.kind === 'undo' || t.pending) ? x.kind : null
    out.push({ key: t.key, caseId: c.id, turn: t.index, mode, body: req.body, history, refMap: req.refMap, ...(exact ? { exact } : {}),
      ...(mode === 'nl1' ? selectionRecord(req, catalogs, rerouteNeeds, t.expect) : {}),
      ...(mode !== 'nl1' && req.legacyReroutes ? { catalog: req.catalog, legacyReroutes: req.legacyReroutes } : {}),
      ...(mode !== 'nl1' && router !== 'v1' ? { router } : {}) })
    // teacher forcing: this turn's EXPECTED change is what the next turn remembers
    const ops = (t.expect?.ops || []).map(o => ({ action: o.a, args: o.args || {}, target: refOfHint(host, o.t, o.a, selectedRef) }))
    if (ops.length && ['act', 'propose'].includes(t.expect.kind)) memory.noteChange({ ops })
    void lib
  }
  return out
}

export { nameToId }
