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

import { sideBySideBars, GROUP_PANE_HEIGHT } from './groupBars'
import { paneOfTarget } from './sourceRef'

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
    if (!hit) return null
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

/**
 * Settings blob → the same blob with every legacy three-pane COT group converted to
 * the one-pane form, or the INPUT OBJECT itself when there is nothing to convert.
 */
export function migrateLegacyCotGroups(cs) {
  if (!cs || typeof cs !== 'object' || !Array.isArray(cs.indicatorInstances)) return cs
  const byGroup = new Map()
  for (const i of cs.indicatorInstances) {
    if (!isLive(i) || !i.group || typeof i.group.id !== 'string') continue
    if (!byGroup.has(i.group.id)) byGroup.set(i.group.id, [])
    byGroup.get(i.group.id).push(i)
  }
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
