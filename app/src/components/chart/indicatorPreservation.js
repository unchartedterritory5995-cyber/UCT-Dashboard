// app/src/components/chart/indicatorPreservation.js
//
// ⭐ A1.3 (D5, Q5) — a whole-LOOK write keeps the member's indicators. Pure; Indicators-owned.
//
// Restore Defaults and presets rewrite the chart's appearance. Before A1 they wrote a clone of
// `CHART_DEFAULTS` / the preset whole, and with it `indicatorInstances: []` — every indicator,
// every moving average, every pane size gone with one click. `keepIndicatorState(next, prev)`
// is applied at the APPLY SITE (PRESETS and CHART_DEFAULTS are not edited, so every rail that
// pins them by identity still holds).
//
// Kept from `prev`: every key of `INDICATOR_OWNED_TOP_KEYS` (instances, the mirror, the
// moving-average `overlays` — owner Q5: presets no longer reset MA colours — pane order and
// sizes, volume overlays) and `header.infoValues`, which lives under `header` (finding C5: the
// owned-keys list names a top-level `infoValues` that no blob has). Present keeps its value;
// absent stays absent — the same rule as the Agent's `keepOwned`.

import { INDICATOR_OWNED_TOP_KEYS } from './builder/agentSeams'
import { severInfoValuesForInstanceSwap } from './engine/infoValues'
import { isInstanceTombstone } from './instanceShape'

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v)
const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))

/** ⭐ A1.3 (D6) — the INDICATOR half of applying a share link: the sender's instance list
 *  REPLACES the recipient's (a union would resurrect the recipient's tombstones), their mirror
 *  entries merge in, and a recipient info value whose id now names a different instance is
 *  severed. Exactly the indicator part of the pre-A1 apply. */
export function applyShareIndicators(cs, decoded) {
  if (!isObj(cs) || !isObj(decoded) || !Array.isArray(decoded.indicatorInstances)) return cs
  return {
    ...severInfoValuesForInstanceSwap(cs, decoded.indicatorInstances),
    ...(decoded.indicators ? { indicators: { ...(cs.indicators || {}), ...decoded.indicators } } : {}),
    indicatorInstances: decoded.indicatorInstances,
    preset: 'custom',
  }
}

/** The live (non-tombstone) instances of a list, canonically comparable. */
export function liveInstanceList(list) {
  return (Array.isArray(list) ? list : []).filter((i) => isObj(i) && typeof i.instanceId === 'string' && !isInstanceTombstone(i))
}

export function keepIndicatorState(next, prev) {
  const out = clone(isObj(next) ? next : {})
  for (const k of INDICATOR_OWNED_TOP_KEYS) {
    if (isObj(prev) && Object.prototype.hasOwnProperty.call(prev, k)) out[k] = clone(prev[k])
    else delete out[k]
  }
  const iv = isObj(prev) && isObj(prev.header) ? prev.header.infoValues : undefined
  if (iv !== undefined) out.header = { ...(isObj(out.header) ? out.header : {}), infoValues: clone(iv) }
  else if (isObj(out.header) && 'infoValues' in out.header) {
    const { infoValues: _drop, ...rest } = out.header
    out.header = rest
  }
  return out
}
