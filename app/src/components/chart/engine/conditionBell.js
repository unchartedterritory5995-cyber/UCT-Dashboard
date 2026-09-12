import {
  conditionCapability, LOCAL_ONLY, PROMOTABLE, DURABLE, SOURCE_UNAVAILABLE, INVALID,
} from './conditionCapability'
import { alertsForCondition } from './conditionAlerts'

// ─── WHAT THE BELL ON A CONDITION ROW SHOWS ─────────────────────────────────
//
// ⭐ THE DERIVATION, SEPARATED FROM THE TWO PIECES THAT RENDER IT. The bell is
// in two parts — a button in the row's head and a sentence below it — and both
// read one answer. Keeping that answer here also means it is testable without
// mounting anything, which is where the interesting cases are.

/** What the bell can DO, per capability. Data, so a new capability is a row. */
export const PRESENTATION = Object.freeze({
  [DURABLE]: { action: 'arm', enabled: true },
  [PROMOTABLE]: { action: 'promote', enabled: true },
  [LOCAL_ONLY]: { action: 'explain', enabled: true },
  [SOURCE_UNAVAILABLE]: { action: null, enabled: false },
  [INVALID]: { action: null, enabled: false },
})

/**
 * Everything both pieces need, derived once.
 *
 * @param {object} cond  a NORMALISED condition
 * @param {object|null} registry  read for `getDefinition` — its PRESENCE is the
 *   whole difference between DURABLE and SOURCE_UNAVAILABLE, so it is asked for
 *   rather than assumed. Absent ⇒ a definition-backed condition is trusted, which
 *   is right for a surface holding no registry and wrong for the settings panel.
 * @param {unknown[]} alerts  rows as served by `GET /api/indicator-alerts`
 */
export function bellState(cond, registry, alerts, sym) {
  const get = registry && typeof registry.getDefinition === 'function'
    ? (id) => registry.getDefinition(id)
    : null
  const cap = conditionCapability(cond, get ? { hasDefinition: (id) => !!get(id) } : {})
  const definition = cap.definitionId && get ? get(cap.definitionId) : null
  const armed = alertsForCondition(alerts, cond, { definition, sym })
  const p = PRESENTATION[cap.capability] || PRESENTATION[INVALID]
  return { cap, definition, armed, action: p.action, enabled: p.enabled }
}
