/**
 * CAN THIS INDICATOR BE CALCULATED ON ANOTHER TIMEFRAME? — one answer, one place.
 *
 * ⭐⭐ ONE GENERAL CAPABILITY, NOT A LIST OF MTF INDICATORS. There is no `rsiMtf`,
 * no `if (defId === 'macd')`. An indicator computed from its OWN bars is, by
 * construction, the same calculation handed a different bar set; the binder does
 * exactly that (`binder.js`, the frame pre-pass) and `mtfProjection.js` puts the
 * answer on the chart. What this module decides is where that argument FAILS —
 * and it fails for reasons that are properties of the definition or its source,
 * never of its name:
 *
 *   · a SERVER lane (`compute.kind: 'server'`, the RS line) computes on the server
 *     at the chart's (sym, tf) — its columns are not ours to recompute;
 *   · a PASSTHROUGH (`dataSeries`) IS its source: a "1D QQQ" row on a 5m chart is
 *     a statement about another instrument's session bars, and its candle mode
 *     reads raw bars — a follow-up, not a checkbox;
 *   · a definition restricted by `meta.timeframes` (VWAP, anchored VWAP) means
 *     nothing off intraday — its maths is session-anchored;
 *   · a MARKER plot is an event on one bar; held across every lower bar it would
 *     print the same event dozens of times;
 *   · a DISPLACED plot is shifted in bars of ITS frame, which are not the chart's;
 *   · an OBJECT program draws in the bars it was evaluated on;
 *   · a FUNDAMENTAL source has its own as-of availability and no bar frame;
 *   · an ECONOMIC source (`econ:`) likewise: it is as-of on its RELEASE time with
 *     a per-frequency max age (`economicSource.js`), and has no bar frame;
 *   · VOLUME AS A MAGNITUDE: a daily volume average drawn over 5m volume bars reads
 *     as a 5m quantity a hundred times too large. `meta.calcTimeframe: false` on
 *     the definition, or a `volume` bar-field source, says so.
 *
 * ⛔ A SOURCE THAT IS ANOTHER INSTANCE IS NOT GATED — IT IS INHERITED. `MA(RSI)`
 * computes in RSI's frame (see `resolveInstanceFrames`): the dependent's own
 * control reads "From source", and nothing ever averages a 1h column on 5m bars.
 */

import { sourceInputsOf, parseSource } from './sourceRef'
import { calcTimeframeOf, effectiveCalcFrame } from './instanceTimeframe'

const DRAWABLE_STYLES = new Set(['line', 'stepline', 'histogram', 'area', 'baseline', 'band', 'hlines'])

/**
 * @returns {{ok: true, inherits?: string} | {ok: false, reason: string}}
 *   `inherits` names the upstream instance whose frame this one takes.
 */
const PERIODIC_TFS = new Set(['D', 'W', 'M'])

export function calcTimeframeCapability(def, inst) {
  if (!def || typeof def !== 'object') return { ok: false, reason: 'unknown' }
  const meta = def.meta || {}
  if (meta.calcTimeframe === false) return { ok: false, reason: 'declared' }
  const kind = def.compute && def.compute.kind
  if (kind === 'server') return { ok: false, reason: 'server' }
  if (def.passthrough === true) return { ok: false, reason: 'passthrough' }
  // ⭐ A SESSION study (its timeframe list names an INTRADAY frame — VWAP, Anchored
  // VWAP) resets per session and has no higher-frame meaning. A study limited to
  // D/W/M (2026-10-01: Historical Volatility, 52-Week High/Low) is not session-
  // based: on a daily chart it computes on weekly or monthly bars like any other.
  if (Array.isArray(meta.timeframes) && meta.timeframes.some((t) => !PERIODIC_TFS.has(String(t)))) {
    return { ok: false, reason: 'session' }
  }
  if (def.objects) return { ok: false, reason: 'objects' }
  const plots = Array.isArray(def.plots) ? def.plots : []
  if (!plots.length) return { ok: false, reason: 'unknown' }
  for (const p of plots) {
    if (!p || typeof p !== 'object') continue
    if (!DRAWABLE_STYLES.has(p.style)) return { ok: false, reason: 'markers' }
    if (Number.isInteger(p.displace) && p.displace !== 0) return { ok: false, reason: 'displaced' }
  }
  const sources = inst ? sourceInputsOf(def, inst) : []
  if (sources.length) {
    const parsed = parseSource(sources[0][1])
    if (parsed && parsed.kind === 'instance') return { ok: true, inherits: parsed.instanceId }
    if (parsed && parsed.kind === 'fundamental') return { ok: false, reason: 'fundamental' }
    if (parsed && parsed.kind === 'economic') return { ok: false, reason: 'economic' }
    if (parsed && parsed.kind === 'bar' && parsed.field === 'volume') return { ok: false, reason: 'volume' }
    if (parsed && parsed.kind === 'symbol' && parsed.field === 'volume') return { ok: false, reason: 'volume' }
  }
  return { ok: true }
}

/** Member-facing words for a refusal — short, because it sits under a control. */
export const CAPABILITY_WORDS = Object.freeze({
  declared: 'This indicator is always calculated on the chart timeframe.',
  server: 'This indicator is calculated on the chart timeframe.',
  passthrough: 'A data series always follows the chart timeframe.',
  session: 'This indicator is session-based and follows the chart timeframe.',
  objects: 'This indicator draws on the chart timeframe.',
  markers: 'Event markers follow the chart timeframe.',
  displaced: 'Shifted plots follow the chart timeframe.',
  fundamental: 'Fundamental data has its own reporting schedule.',
  economic: 'Economic data has its own release schedule.',
  volume: 'Volume averages follow the chart timeframe.',
  unknown: 'Calculated on the chart timeframe.',
})

/**
 * The frame every instance computes at on this chart, in DEPENDENCY ORDER.
 *
 * ⭐⭐ MODEL: A DEPENDENT INHERITS ITS SOURCE'S FRAME. `MA 5` sourced from a 1h
 * `RSI 14` is an average of 1h RSI values, computed over the 1h bars and projected
 * with RSI — the only reading under which "MA of RSI" means one thing. The other
 * candidates were each worse: evaluating the SOURCE at the dependent's frame would
 * silently change what the visible RSI line is; averaging the projected (held) RSI
 * over chart bars would weight a 1h value by however many 5m bars it spans; and
 * resampling invents bars. So the dependent's own stored timeframe is not
 * consulted while its source is an instance — the control reads "From source".
 *
 * @param {object[]} ordered   instances in dependency order (sources first)
 * @param {function} defOf     id → definition
 * @param {string}   chartTf
 * @returns {Map<string, {frame: string|null, relation: string, gated: string|null,
 *                        capability: object}>}
 */
export function resolveInstanceFrames(ordered, defOf, chartTf) {
  const out = new Map()
  for (const inst of (Array.isArray(ordered) ? ordered : [])) {
    if (!inst || typeof inst.instanceId !== 'string') continue
    const def = defOf(inst.defId)
    const capability = calcTimeframeCapability(def, inst)
    if (capability.ok && capability.inherits) {
      const up = out.get(capability.inherits)
      out.set(inst.instanceId, up
        ? { frame: up.frame, relation: up.relation, gated: up.gated, capability }
        : { frame: null, relation: 'chart', gated: null, capability })
      continue
    }
    if (!capability.ok || !calcTimeframeOf(inst)) {
      out.set(inst.instanceId, { frame: null, relation: 'chart', gated: null, capability })
      continue
    }
    const eff = effectiveCalcFrame(inst, chartTf)
    out.set(inst.instanceId, { ...eff, capability })
  }
  return out
}
