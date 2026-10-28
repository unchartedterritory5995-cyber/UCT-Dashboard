// ── NL-1 ACTION SELECTION: a fixed core + bounded additions (owner 2026-10-20, hybrid) ──────────────
//
// NL-1's whole catalog (~91 actions) is over the per-request limit (60, unchanged). Each request sends:
//
//   CORE      charts, indicators, screener, agent — whole groups, only the actions THIS member may use
//             here (manifestFor(ctx) is the input: nothing unavailable is ever added to fill it), at most
//             NL1_CORE_MAX actions. Sent first, so the server can keep it in a stable, cached prompt block.
//   PINNED    the groups of a waiting proposal, of the Agent's last change on this board (follow-ups and
//             corrections), and of the request a pending question came from.
//   NEEDED    groups the MODEL asked for (`need_groups`) — the one bounded reroute.
//   SOFT      the existing word router (routing.js) ADDS groups from the request's words, the member's
//             own names and typo readings, packed smallest-first in the room left. It never removes the
//             core, never decides what the request means and never acts: the model reads the request,
//             and every group it was not given is named so it can ask for it.
//
// Whole groups only, never a partial group; a group that does not fit is NAMED (unselected), never
// silently cut. Nothing here widens what can run: the server refuses any action it was not sent, and
// the browser re-validates every op against the full registry and availability before anything runs.
//
// The final list is assembled by `assembleNl1` — mirrored in tools/agent_eval_run.py (`assemble_nl1`) so the
// eval's reroute replay sends exactly what the panel would (parity fixture: tests/fixtures/nl1_assemble_parity.json).

import { MANIFEST_CONTRACT } from '../capabilities'
import { GROUPS, ROUTING_VERSION, groupOfAction, routeManifest, selectGroups } from '../routing'

export const NL1_CORE_GROUPS = ['charts', 'indicators', 'screener', 'agent']
export const NL1_CORE_MAX = 45
/** The server's per-request maximum (60): never raised here. */
export const NL1_LIMIT = MANIFEST_CONTRACT.limits.maxCapabilities
/** What one NL-1 request may carry: the routed budget (55), the same as the legacy path. */
export const NL1_BUDGET = MANIFEST_CONTRACT.routingThreshold
/** A reroute adds at most this many groups (more would not fit the budget beside the core anyway). */
export const NL1_MAX_NEED = 3

const ALWAYS = GROUPS.filter(g => g.always).map(g => g.id)
// how many of `full`'s actions each group has, counted in ONE pass (a scan per group was the bulk of
// NL-1's selection time once the catalog passed 110 actions)
function countsOf(full) {
  const counts = new Map()
  for (const c of full) { const g = groupOfAction(c.name); counts.set(g, (counts.get(g) || 0) + 1) }
  return counts
}
const presentGroups = (full) => { const n = countsOf(full); return GROUPS.filter(g => n.has(g.id)) }
const sizeOf = (full, id) => countsOf(full).get(id) || 0

/** The core groups present in this member's available manifest, whole, in order, within NL1_CORE_MAX. */
export function coreOf(full) {
  const out = []
  let used = 0
  for (const id of NL1_CORE_GROUPS) {
    const n = sizeOf(full, id)
    if (!n || used + n > NL1_CORE_MAX) continue
    out.push(id)
    used += n
  }
  return out
}

/** The groups of these action names that are present (authorized) in `full`. */
export function groupsOfActions(names, full) {
  const present = new Set(presentGroups(full).map(g => g.id))
  return [...new Set((names || []).map(groupOfAction).filter(id => id && present.has(id)))]
}

/**
 * The request's actions: { manifest, routing } plus what decided them.
 *   full         manifestFor(ctx) — this member's available actions on this surface
 *   text         the member's message (soft expansion only)
 *   names        routingNames(host)    correct  the lexicon's typo readings (routing.js)
 *   pinActions   action names of a waiting proposal / the last change
 *   pinGroups    group ids to keep (the request a pending question came from)
 *   need         group ids the model asked for (reroute)
 */
export function selectNl1(full, { text = '', names = null, correct = null, pinActions = [], pinGroups = [], need = [], budget = NL1_BUDGET } = {}) {
  const present = presentGroups(full).map(g => g.id)
  const core = coreOf(full)
  const keep = (ids) => [...new Set(ids)].filter(id => present.includes(id) && !core.includes(id))
  const needed = keep(need)
  const pins = keep([...groupsOfActions(pinActions, full), ...pinGroups])
  const routed = routeManifest(full, text, { enabled: true, limit: NL1_LIMIT, budget: Math.min(budget, NL1_LIMIT), names, correct },
    [...core, ...needed, ...pins])
  const selected = routed.routing ? routed.routing.selected : present
  // the groups the member's own words (names, typo readings) pointed at: reported, and used only to ADD caution
  const words = selectGroups(text, { names, correct })
  const wordGroups = (words.matched ? words.selected : words.soft).filter(id => !ALWAYS.includes(id) && present.includes(id))
  const { manifest, routing } = assembleNl1(full, core, selected)
  return {
    manifest, routing, core, pins, need: needed, selected,
    unselected: present.filter(id => !selected.includes(id)),
    wordGroups,
    // groups the words named that could not be sent: a plan made without them is only PROPOSED (useAgent)
    wordsNotSent: wordGroups.filter(id => !selected.includes(id)),
    needMet: needed.every(id => selected.includes(id)),
  }
}

/**
 * The manifest for these selected groups: the whole `full` (routing null) when every present group is
 * selected; otherwise the core actions first, then the other selected groups' — each in registry order —
 * and the routing the server reads (`stable` = how many leading actions are the core).
 */
export function assembleNl1(full, core, picked) {
  const selected = [...new Set([...core, ...picked])]          // the core is always selected (and sent first)
  const present = presentGroups(full)
  if (present.every(g => selected.includes(g.id))) return { manifest: full, routing: null }
  const inCore = (c) => core.includes(groupOfAction(c.name))
  const head = full.filter(inCore)
  const tail = full.filter(c => !inCore(c) && (groupOfAction(c.name) === null || selected.includes(groupOfAction(c.name))))
  return {
    manifest: [...head, ...tail],
    routing: {
      version: ROUTING_VERSION,
      groups: present.map(g => ({ id: g.id, title: g.title })),
      selected: present.filter(g => selected.includes(g.id)).map(g => g.id),
      stable: head.length,
    },
  }
}
