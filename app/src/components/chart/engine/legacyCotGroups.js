// app/src/components/chart/engine/legacyCotGroups.js
//
// ─── ONE-TIME NORMALISATION: THE THREE-PANE COT GROUP → THE ONE-PANE GROUP ──
//
// Production served a three-pane COT layout for a few hours on 2026-09-30
// (`f288540c4`): one COT dataset was saved as three `dataSeries` instances, each in a
// pane of its own. The accepted design is ONE pane holding the three participants
// side by side. This rewrites, on READ, exactly the representation that release
// persisted — and nothing else — so a member who added COT in that window arrives at
// the current layout, and their next ordinary save persists it.
//
// ⛔⛔ IT RECOGNISES A SIGNATURE, NEVER A RESEMBLANCE. Three series that happen to be
// called "Commercials / Large Speculators / Small Speculators" are not a COT group.
// A group is converted only when ALL of these hold (`legacyGroupAt`):
//
//   · exactly three LIVE `dataSeries` instances carry one `group.id`
//   · that id is `grp:<instanceId>` of the Commercials part (how the release minted it)
//   · their sources are exactly `sym:COT:<SYM>:COMM|LARGE|SMALL:close`, one each,
//     for ONE market
//   · `group.name` is `<market> COT` and the group has no `note` (the release's form)
//   · no part has a display target or `presentation.bar` (every part still in its
//     OWN pane, as the release left it — a member who moved one has said something
//     this must not overwrite)
//   · all three share one `hidden` state (the release only ever hid them together)
//
// Anything else — a partial group, a duplicate part, mixed markets, a group already in
// the one-pane form — is left EXACTLY as it is, by identity.
//
// ⭐ IDEMPOTENT BY CONSTRUCTION: the output has a `group.note`, bar geometry and guest
// targets, each of which alone fails the signature, so a second pass returns its input
// unchanged — the SAME object.
//
// ─── SECOND STEP: THE PER-MARKET GROUP → THE ONE THAT FOLLOWS THE CHART ─────
//
// From 2026-09-30 COT is ONE indicator whose market follows the chart symbol
// (`engine/cotFollow.js`); the 58 per-market entries are no longer offered. A
// per-market one-pane group — exactly as `createFromResult` built it, or as the first
// step above leaves a three-pane one — is rewritten to name no market: its sources
// become `sym:COT:AUTO:<PART>:close` and its title `COT (Commitment of Traders)`.
// Ids, colours, visibility, bar geometry and the pane's place are all kept.
// Same rules: an exact signature (`perMarketGroupAt`), anything else left alone by
// identity, and the output (`AUTO`) fails the signature so a second pass is a no-op.

import { sideBySideBars, GROUP_PANE_HEIGHT } from './groupBars'
import { COT_FOLLOW_TOKEN, COT_FOLLOW_DISPLAY, cotFollowSource } from './cotFollow'

// ⛔⛔ THIS MODULE IS IMPORTED BY `chartDefaults` — THE APP'S ENTRY BUNDLE — SO IT MAY
// DEPEND ON NOTHING HEAVY. Importing `sourceRef` for `paneOfTarget` dragged the pool,
// placement, pane-layout and fundamentals modules into every page's first load (+411 KB
// on the Notebook's measured first-open budget, caught by `notebook bytes`). The one
// thing it needed is the display-target prefix, stated here and railed against
// `sourceRef.paneOfTarget` in `__tests__/legacyCotGroups.test.js`.
export const PANE_TARGET_PREFIX = '@'
const paneOfTarget = (id) => PANE_TARGET_PREFIX + id

const PARTS = ['COMM', 'LARGE', 'SMALL']
const SOURCE = /^sym:COT:([A-Z0-9]+):(COMM|LARGE|SMALL):close$/
const GROUP_ID = /^grp:(.+)$/
const LEGACY_NAME = /^(.+) COT$/

const isLive = (i) => i && typeof i === 'object' && i.deleted !== true && typeof i.instanceId === 'string'

function legacyGroupAt(members) {
  if (members.length !== 3) return null
  const byPart = {}
  let sym = null
  for (const m of members) {
    if (m.defId !== 'dataSeries') return null
    const src = m.inputs && m.inputs.source
    const hit = typeof src === 'string' ? SOURCE.exec(src) : null
    if (!hit || hit[1] === COT_FOLLOW_TOKEN) return null
    if (sym !== null && hit[1] !== sym) return null
    sym = hit[1]
    if (byPart[hit[2]]) return null                     // a duplicated part
    byPart[hit[2]] = m
    if (m.placement && m.placement.target) return null  // moved by the member
    if (m.presentation && m.presentation.bar) return null
  }
  if (!PARTS.every((p) => byPart[p])) return null
  const g = byPart.COMM.group
  if (!g || GROUP_ID.exec(g.id)?.[1] !== byPart.COMM.instanceId) return null
  if (g.note !== undefined) return null
  const name = typeof g.name === 'string' ? LEGACY_NAME.exec(g.name) : null
  if (!name) return null
  for (const m of members) {
    if (!m.group || m.group.id !== g.id || m.group.name !== g.name || m.group.note !== undefined) return null
  }
  const hidden = byPart.COMM.hidden === true
  if (members.some((m) => (m.hidden === true) !== hidden)) return null
  return { byPart, group: g, market: name[1] }
}

function groupsOf(cs) {
  const byGroup = new Map()
  for (const i of cs.indicatorInstances) {
    if (!isLive(i) || !i.group || typeof i.group.id !== 'string') continue
    if (!byGroup.has(i.group.id)) byGroup.set(i.group.id, [])
    byGroup.get(i.group.id).push(i)
  }
  return byGroup
}

const ONE_PANE_NAME = /^(.+) · COT$/
const ONE_PANE_NOTE = 'Net Contracts'

/** The per-market ONE-PANE group, or null — the exact form `createFromResult` built. */
function perMarketGroupAt(members) {
  if (members.length !== 3) return null
  const byPart = {}
  let sym = null
  for (const m of members) {
    if (m.defId !== 'dataSeries') return null
    const src = m.inputs && m.inputs.source
    const hit = typeof src === 'string' ? SOURCE.exec(src) : null
    if (!hit || hit[1] === COT_FOLLOW_TOKEN) return null
    if (sym !== null && hit[1] !== sym) return null
    sym = hit[1]
    if (byPart[hit[2]]) return null
    byPart[hit[2]] = m
    if (!(m.presentation && m.presentation.bar)) return null
  }
  if (!PARTS.every((p) => byPart[p])) return null
  const hostId = byPart.COMM.instanceId
  const g = byPart.COMM.group
  if (!g || GROUP_ID.exec(g.id)?.[1] !== hostId) return null
  if (g.note !== ONE_PANE_NOTE || typeof g.name !== 'string' || !ONE_PANE_NAME.test(g.name)) return null
  for (const m of members) {
    if (!m.group || m.group.id !== g.id || m.group.name !== g.name || m.group.note !== g.note) return null
  }
  // The Commercials part hosts the pane; the other two are its guests — as created.
  if (byPart.COMM.placement && byPart.COMM.placement.target) return null
  for (const part of ['LARGE', 'SMALL']) {
    const t = byPart[part].placement && byPart[part].placement.target
    if (t !== paneOfTarget(hostId)) return null
  }
  const hidden = byPart.COMM.hidden === true
  if (members.some((m) => (m.hidden === true) !== hidden)) return null
  return { byPart, group: g }
}

function followCotGroups(cs) {
  const edits = new Map()
  for (const members of groupsOf(cs).values()) {
    const found = perMarketGroupAt(members)
    if (!found) continue
    const group = { ...found.group, name: COT_FOLLOW_DISPLAY }
    for (const part of PARTS) {
      const m = found.byPart[part]
      const compact = m.display && typeof m.display.compact === 'string' ? m.display.compact : ''
      edits.set(m.instanceId, {
        ...m,
        inputs: { ...m.inputs, source: cotFollowSource(part) },
        group,
        // The name a fresh add of the follow row gives it (`COT · Commercials`).
        ...(m.display && typeof m.display === 'object' && compact
          ? { display: { ...m.display, name: `COT · ${compact}` } } : {}),
      })
    }
  }
  if (!edits.size) return cs
  return {
    ...cs,
    indicatorInstances: cs.indicatorInstances.map((i) => (i && edits.has(i.instanceId) ? edits.get(i.instanceId) : i)),
  }
}

/**
 * Settings blob → the same blob with every legacy COT group converted — three-pane →
 * one-pane, then per-market → follow-the-chart — or the INPUT OBJECT itself when
 * there is nothing to convert.
 */
export function migrateLegacyCotGroups(cs) {
  if (!cs || typeof cs !== 'object' || !Array.isArray(cs.indicatorInstances)) return cs
  return followCotGroups(threePaneToOnePane(cs))
}

function threePaneToOnePane(cs) {
  const byGroup = groupsOf(cs)
  const edits = new Map()          // instanceId → replacement instance
  const retiredPanes = new Set()   // pane keys that stop existing (LARGE / SMALL)
  const resized = new Set()        // pane keys whose stored share no longer means anything
  const bars = sideBySideBars(3)
  for (const members of byGroup.values()) {
    const found = legacyGroupAt(members)
    if (!found) continue
    const { byPart, group, market } = found
    const hostId = byPart.COMM.instanceId
    const nextGroup = { id: group.id, name: `${market} · COT`, note: 'Net Contracts' }
    PARTS.forEach((part, k) => {
      const m = byPart[part]
      const next = {
        ...m,
        group: nextGroup,
        presentation: {
          ...(m.presentation || {}),
          bar: bars[k],
          ...(part === 'COMM' ? { paneHeight: GROUP_PANE_HEIGHT } : {}),
        },
      }
      if (part !== 'COMM') {
        next.placement = { ...(m.placement || {}), target: paneOfTarget(hostId) }
        retiredPanes.add(m.instanceId)
      }
      edits.set(m.instanceId, next)
    })
    // ⭐ THE COMMERCIALS PANE IS THE ANCHOR: its place in `paneOrder` stays where the
    // member put it. Its stored height was a share of ONE of three panes and means
    // nothing for the combined one, so all three stored heights are dropped and the
    // pane starts at the accepted default — never the sum of three.
    resized.add(hostId)
    for (const id of retiredPanes) resized.add(id)
  }
  if (!edits.size) return cs

  const out = {
    ...cs,
    indicatorInstances: cs.indicatorInstances.map((i) => (i && edits.has(i.instanceId) ? edits.get(i.instanceId) : i)),
  }
  if (Array.isArray(cs.paneOrder)) {
    out.paneOrder = cs.paneOrder.filter((k) => !retiredPanes.has(k))
  }
  if (cs.paneSizes && typeof cs.paneSizes === 'object') {
    out.paneSizes = Object.fromEntries(Object.entries(cs.paneSizes).filter(([k]) => !resized.has(k)))
  }
  if (cs.paneSeriesOrder && typeof cs.paneSeriesOrder === 'object') {
    out.paneSeriesOrder = Object.fromEntries(Object.entries(cs.paneSeriesOrder)
      .filter(([k]) => !retiredPanes.has(k)))
  }
  return out
}
