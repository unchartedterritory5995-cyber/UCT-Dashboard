// app/src/components/chart/builder/authoring/studioTelemetry.js
//
// ─── ⭐ CONTROLLED ROLLOUT — the conversation's funnel, as SHAPE ONLY ─────────
//
// One `studio_action` event per funnel step (opened · preview · saved ·
// save_failed · discarded · turn_failed), posted through the existing indicator
// telemetry door (`lib/indicatorTelemetry.js` → `/api/indicator-telemetry/event`),
// whose server side holds every string to a closed value set or a strict pattern.
//
// ⛔ NEVER the member's words, the model's reply, a tree, a formula, a name or a
// label. What leaves this file: the conversation's opaque lineage, an action, a
// surface, a comma list of output/presentation KINDS, an origin and booleans.
//
// ⭐ DE-DUPLICATED BY CONSTRUCTION: `import_id` is `<lineage>:<action>`, and the
// server keeps one row per (user, event, import_id) — so "reached preview" or
// "saved" counts a conversation once however many turns it took.

import { logIndicatorTelemetry } from '../../../../lib/indicatorTelemetry'
import { outputTypeOf, outputsOf, OUTPUT_TYPES } from '../../engine/outputType'
import { CONVERSATION_ID_RE } from './converseClient'

/** The KINDS a definition carries — presentation shape, never content. */
export function definitionKinds(def, requests = null) {
  const kinds = new Set()
  if (!def) return ''
  for (const o of outputsOf(def)) {
    const t = outputTypeOf(def, o.key)
    if (t && t.type === OUTPUT_TYPES.CONDITION) kinds.add('condition')
    else if (t && t.type === OUTPUT_TYPES.SERIES) kinds.add('series')
  }
  for (const p of Array.isArray(def.plots) ? def.plots : []) {
    if (!p) continue
    if (p.style === 'markers' || p.marker) kinds.add('marker')
    if (p.style === 'hlines') kinds.add('level')
    if (p.fill) kinds.add('fill')
  }
  for (const p of Array.isArray(def.paints) ? def.paints : []) {
    if (p && p.kind === 'barcolor') kinds.add('candle_paint')
    if (p && p.kind === 'bgcolor') kinds.add('background')
  }
  if (requests && Array.isArray(requests.infoValues) && requests.infoValues.length) kinds.add('info_value')
  if (requests && Array.isArray(requests.alerts) && requests.alerts.length) kinds.add('alert')
  return [...kinds].sort().join(',')
}

/** The client-side failure class of a turn that never reached a model answer. */
export function clientFailureOf(gate) {
  const g = String(gate || '')
  if (g === 'network') return 'network'
  if (/^http:(0|5\d\d)$/.test(g)) return 'http_5xx'
  if (g === 'http:429') return 'http_429'
  if (g === 'http:403') return 'http_403'
  if (g === 'http:402') return 'http_402'
  if (g.startsWith('http:')) return 'http_other'
  return null
}

/**
 * Fire-and-forget. Never throws, never awaits in the caller's path.
 * @param {string} lineage the conversation's opaque id (`authoringState.lineage`)
 * @param {'opened'|'preview'|'saved'|'save_failed'|'discarded'|'turn_failed'} action
 * @param {{surface?: 'studio'|'sheet', kinds?: string, origin?: 'native'|'imported',
 *          created?: boolean, failure?: string, turns?: number}} [props]
 */
export function logStudioAction(lineage, action, props = {}) {
  try {
    if (typeof lineage !== 'string' || !CONVERSATION_ID_RE.test(lineage)) return
    const clean = Object.fromEntries(Object.entries({ conversation_id: lineage, action, ...props })
      .filter(([, v]) => v !== undefined && v !== null && v !== ''))
    void logIndicatorTelemetry('studio_action', { importId: `${lineage}:${action}`.slice(0, 64), props: clean })
  } catch { /* telemetry never breaks the product */ }
}
