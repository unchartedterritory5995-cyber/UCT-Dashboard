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
import { NL1_MAX_NEED } from '../nl1/selection'
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

function legacyRequest({ host, text, memory }) {
  const full = manifestFor({ ...CAP_CTX, manageIndicators: managesIndicators(host) })
  const routed = routeManifest(full, text, {
    enabled: true, pendingActions: [], recentActions: (memory.lastChange()?.ops || []).map(o => o.action),
    limit: MANIFEST_CONTRACT.limits.maxCapabilities, budget: MANIFEST_CONTRACT.routingThreshold,
    names: routingNames(host), correct: (t) => (correctTypos(t, lexiconFor(host)) || []).map(v => v.text),
  })
  const { context, refMap } = buildContext(host, { ...CAP_CTX, message: text })
  const back = Object.fromEntries(Object.entries(refMap).map(([k, v]) => [v.ref, k]))
  const m = memory.forModel()
  const mem = m ? (m.subject_chart ? { ...m, subject_chart: back[m.subject_chart] || null } : m) : null
  return {
    body: { message: text, context: mem ? { ...context, conversation_memory: mem } : context, capabilities: routed.manifest,
      manifestVersion: MANIFEST_VERSION, routing: routed.routing, pending: null },
    refMap,
  }
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
function selectionRecord(req, catalogs) {
  const s = req.selection
  const json = JSON.stringify(req.full)
  const id = catalogId(json)
  if (catalogs && !catalogs.has(id)) {
    catalogs.set(id, {
      catalog: id, manifest: req.full, core: s.core,
      groupOf: Object.fromEntries(req.full.map(c => [c.name, groupOfAction(c.name)])),
      groups: GROUPS.filter(g => req.full.some(c => groupOfAction(c.name) === g.id)).map(g => ({ id: g.id, title: g.title })),
    })
  }
  // the reroute table only for an eval export (a `catalogs` collector): it is ~100 selections per request
  const reroutes = {}
  for (const need of catalogs ? subsetsUpTo(s.unselected, NL1_MAX_NEED) : []) {
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
 * distinct NL-1 catalog once.
 */
export function captureCase(spec, c, mode, { isProtectedLayout = null, catalogs = null, budget = undefined } = {}) {
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
      req = buildNl1Request({ host, text: t.say, capCtx: CAP_CTX, manageIndicators: managesIndicators(host), memory, pendingQuestion: pq, isProtectedLayout, budget })
    } else {
      // today: a local question is stored in the browser; the model sees only that one was asked
      if (t.pending) history = [...history, { role: 'member', text: t.pending.request }, { role: 'outcome', text: 'Asked which target.', data: { kind: 'clarify-target' } }]
      req = legacyRequest({ host, text: t.say, memory })
    }
    // EXACT Undo / Cancel with something to act on never reach the model (useAgent): marked, never sent or scored as model turns
    const x = exactLane(t.say)
    const exact = x && (x.kind === 'undo' || t.pending) ? x.kind : null
    out.push({ key: t.key, caseId: c.id, turn: t.index, mode, body: req.body, history, refMap: req.refMap, ...(exact ? { exact } : {}),
      ...(mode === 'nl1' ? selectionRecord(req, catalogs) : {}) })
    // teacher forcing: this turn's EXPECTED change is what the next turn remembers
    const ops = (t.expect?.ops || []).map(o => ({ action: o.a, args: o.args || {}, target: refOfHint(host, o.t, o.a, selectedRef) }))
    if (ops.length && ['act', 'propose'].includes(t.expect.kind)) memory.noteChange({ ops })
    void lib
  }
  return out
}

export { nameToId }
