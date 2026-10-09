// app/src/components/chart/builder/agentSeams.js
//
// ─── ⭐ AGENT MILESTONE 1 — WHAT UCT AGENT MAY READ AND HAND OVER, AND NOTHING ELSE ──
//
// The Indicators half of `docs/indicators/AGENT-INTEGRATION-CONTRACT.md`. UCT Agent
// owns routing, capabilities and member-facing answers; Indicators owns what an
// indicator IS. These are the only two things Agent needs from us in Milestone 1:
//
//   * `instancesOf(cs, registry)` — the indicators on ONE chart, as plain data, named
//     exactly as the chart's own legend and settings rows name them (`instanceLabel`).
//   * `seedFrom(text)` — a member's request made safe to PREFILL into Create
//     Indicator's input box. It is shown to the member; it is never sent for them.
//
// ⛔ PURE. No React, no network, no write. Agent never calls `/converse`, never saves,
// and never interprets a formula: it reads this list and opens the existing panel.

import { adoptOverlayAverages } from '../maAdoption'
import { isInstanceTombstone } from '../instanceShape'
import { instanceLabel } from '../engine/sourceRef'
import { STUDIO_PREVIEW_DEF_ID } from './studio/chartPreview'

/**
 * ⭐ THE TOP-LEVEL CHART-SETTINGS KEYS INDICATORS OWNS — declared HERE, by the owner.
 * UCT Agent's `chartSettingsDescriptors.OWNED_TOP_KEYS` (what its whole-blob writers —
 * template, reset — must carry over unchanged via `keepOwned`) is held equal to this
 * list by a rail in `agentSeams.test.js`: a key Indicators adds fails that rail until
 * the Agent's list carries it too. (Reviewed 2026-10-09: the census entry for
 * `agent/capabilities/chart.js` is ACCEPTED — see AGENT-INTEGRATION-HANDOFF §11.)
 */
export const INDICATOR_OWNED_TOP_KEYS = Object.freeze([
  'indicatorInstances', 'indicators', 'overlays', 'paneOrder', 'paneSizes', 'paneSeriesOrder',
  'volumeOverlayIndicators', 'infoValues',
])

/** The longest prefilled request. A seed is the member's own words, edited and sent
 *  by them; this bounds what a routing turn can paste into the box. */
export const SEED_MAX = 600

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const USER_DEF = /^u_[0-9a-f]{12}$/

/**
 * @typedef {{
 *   instanceId: string,              // 'inst:<defId>:<n>' / 'ovl:<i>' — the stable handle
 *   defId: string,                   // native id ('rsi') or a saved definition ('u_' + 12 hex)
 *   name: string,                    // the legend's own name — display data, NOT an identifier
 *   kind: 'builtin' | 'custom',      // custom = a member's saved definition
 *   version: number | null,          // the saved version an instance pins (custom only)
 *   hidden: boolean,                 // the stored flag (Agent reads this one)
 *   enabled: boolean,                // = !hidden, the owner's word
 *   placement: 'price' | 'pane',
 *   setting?: true,                  // the Volume pane: a chart setting, not an instance
 * }} IndicatorSummary
 */

/**
 * The indicators on ONE chart, in stored order.
 *
 * @param {object} cs        the chart's settings blob (`chartApiById` entry `.agent.read().cs`)
 * @param {{getDefinition: function}} registry  the engine registry (`nativeRegistry`)
 * @returns {IndicatorSummary[]}
 *
 * ⛔ Never the Create Indicator live preview (`u_studio-preview`), never a removed
 * instance's tombstone (`{deleted: true}`), never an instance whose definition this
 * browser cannot resolve (it draws nothing, so it is not "on the chart").
 */
export function instancesOf(cs, registry) {
  if (!isObj(cs)) return []
  // the classic averages (EMA 9, SMA 50 …) are instances once adopted (`maAdoption.js`);
  // adoption is idempotent, so an already-adopted blob is returned unchanged
  const adopted = adoptOverlayAverages(cs) || cs
  const list = Array.isArray(adopted.indicatorInstances) ? adopted.indicatorInstances : []
  const getDef = registry && typeof registry.getDefinition === 'function' ? registry.getDefinition : () => null
  const out = []
  for (const inst of list) {
    if (!isObj(inst) || typeof inst.instanceId !== 'string' || isInstanceTombstone(inst)) continue
    const defId = typeof inst.defId === 'string' ? inst.defId : null
    if (!defId || defId.includes(STUDIO_PREVIEW_DEF_ID) || inst.instanceId.includes(STUDIO_PREVIEW_DEF_ID)) continue
    let def = null
    try { def = getDef(defId) } catch { def = null }
    if (!def) continue
    let name = null
    try { name = instanceLabel(def, inst) } catch { name = null }
    const target = (inst.placement && inst.placement.target) || (def.placement && def.placement.target)
    const custom = USER_DEF.test(defId)
    out.push(Object.freeze({
      instanceId: inst.instanceId,
      defId,
      name: typeof name === 'string' && name ? name : ((def.meta && def.meta.name) || defId),
      kind: custom ? 'custom' : 'builtin',
      version: custom && Number.isInteger(inst.defVersion) ? inst.defVersion : null,
      hidden: inst.hidden === true,
      enabled: inst.hidden !== true,
      placement: target === 'price' ? 'price' : 'pane',
    }))
  }
  // ⭐ the Volume pane is listed beside the indicators in Chart Settings, so a member
  // asking "what's on this chart" expects it — flagged as a SETTING (Agent's own
  // `volume.setState` changes it; it is not an instance and has no definition)
  if (isObj(cs.volume)) {
    out.push(Object.freeze({
      instanceId: 'volume', defId: 'volume', name: 'Volume', kind: 'builtin', version: null,
      hidden: cs.volume.visible === false, enabled: cs.volume.visible !== false, placement: cs.volume.separatePane ? 'pane' : 'price', setting: true,
    }))
  }
  return out
}

/**
 * ⭐ FOR MILESTONE 2's UNDO (Agent ask a): a deterministic fingerprint of ONLY this
 * chart's `indicatorInstances` — the live preview excluded, tombstones kept (a removal
 * is state). An unrelated chart change (theme, timeframe, scale) leaves it unchanged,
 * so an instance-scoped Undo is refused only when the indicators themselves moved.
 * Canonical JSON (sorted keys) → FNV-1a 32-bit, hex, with the instance count.
 */
export function instanceFingerprint(cs) {
  const adopted = isObj(cs) ? (adoptOverlayAverages(cs) || cs) : null
  const list = adopted && Array.isArray(adopted.indicatorInstances) ? adopted.indicatorInstances : []
  const kept = list.filter((i) => isObj(i) && typeof i.instanceId === 'string'
    && !i.instanceId.includes(STUDIO_PREVIEW_DEF_ID) && !(typeof i.defId === 'string' && i.defId.includes(STUDIO_PREVIEW_DEF_ID)))
  const canon = (v) => (Array.isArray(v) ? `[${v.map(canon).join(',')}]`
    : isObj(v) ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`
      : JSON.stringify(v === undefined ? null : v))
  const text = canon(kept)
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return `ii:${kept.length}:${h.toString(16).padStart(8, '0')}`
}

// C0 controls and DEL, except tab / newline (folded to spaces below). Built from code
// points so this file stays free of raw control characters.
const CONTROL = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g')

/**
 * A member's request, made safe to PREFILL into Create Indicator's input: control
 * characters removed, whitespace folded, trimmed, capped at `SEED_MAX` (at a word
 * boundary when one is near). `null` when nothing is left.
 *
 * ⛔ It is never sent. The panel puts it in the box; the member reads, edits and
 * presses Send — the same turn, budget and gates as typing it themselves.
 */
export function seedFrom(text) {
  if (typeof text !== 'string') return null
  let s = text.replace(CONTROL, '').replace(/\s+/g, ' ').trim()
  if (!s) return null
  if (s.length > SEED_MAX) {
    const cut = s.slice(0, SEED_MAX)
    const space = cut.lastIndexOf(' ')
    s = (space > SEED_MAX - 40 ? cut.slice(0, space) : cut).trim()
  }
  return s || null
}
