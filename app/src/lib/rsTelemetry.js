/**
 * ⭐ UCT RS unit VA2 — the plan's §13 telemetry, as COUNTS ONLY.
 *
 * Six events (plan §13, "Telemetry counts as v3"):
 *   rs_on               an RS copy started drawing on a chart this tab is showing
 *   rs_off_within_60s   that copy stopped drawing (hidden or removed) within 60 s
 *   rs_preset {name}    a preset was picked (the dialog, the phone sheet, the chip
 *                       menu's Preset page, the Chart Settings inspector)
 *   rs_benchmark {value} a copy's benchmark changed (whichever door changed it)
 *   rs_marker_card {kind} a readout card was opened (`kind` = the readout row key)
 *   rs_learn {target}   a Learn link was followed (`target` = the lesson key)
 *
 * ⭐ THE PIPELINE IS THE APP'S OWN, NOT A NEW ONE: `lib/indicatorTelemetry.js` →
 * `POST /api/indicator-telemetry/event` → `landing_events`, the door the authoring
 * studio already uses. No vendor, no endpoint.
 *
 * ⛔⛔ DARK UNTIL THE SERVER LISTS THE EVENTS. That door refuses any event outside
 * `api/services/indicator_telemetry.CLIENT_FIREABLE_EVENTS` (400) and keeps only the
 * props its `EVENT_SCHEMAS` names. The six `rs_*` events are not on that list yet,
 * and this unit may not edit Python, so every call here is a no-op unless the build
 * carries `VITE_RS_TELEMETRY_ENABLED=1` — set it in the same deploy that adds the
 * six events (and their props: `symbol`, `name`, `value`, `kind`, `target`) to the
 * server's lists. Until then nothing is sent, so no member's browser posts a request
 * the server refuses.
 *
 * ⛔ NO PERSONAL DATA. A prop is a ticker symbol, a preset id, a benchmark code, a
 * readout row key or a lesson key: a short identifier, checked against
 * `PROP_VALUE_RE` and dropped otherwise. Never a name, an email, a note or a number
 * a member typed.
 *
 * ⛔ NEVER THROWS, NEVER AWAITS IN THE CALLER'S PATH. Telemetry that breaks the
 * product action it observes is worse than no telemetry.
 */
import { logIndicatorTelemetry, newImportId } from './indicatorTelemetry'

/** The definition these events describe. */
export const RS_DEF_ID = 'rsLine'

/** The six events and the one prop each may carry (besides `symbol`). */
export const RS_TELEMETRY_EVENTS = Object.freeze({
  rs_on: Object.freeze(['symbol']),
  rs_off_within_60s: Object.freeze(['symbol']),
  rs_preset: Object.freeze(['name']),
  rs_benchmark: Object.freeze(['value']),
  rs_marker_card: Object.freeze(['kind']),
  rs_learn: Object.freeze(['target']),
})

/** A prop value is a short identifier: a ticker (`BRK-B`, `BRK.B`), a preset id, a code. */
export const PROP_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$/

/** How long a copy may have been drawing for `rs_off_within_60s`. */
export const RS_QUICK_OFF_MS = 60_000

/** Two charts on one page read one settings blob, so one member action reaches every
 *  chart's tracker. The same event about the same thing inside this window is one. */
export const RS_DEDUPE_MS = 5_000

function envEnabled() {
  try { return import.meta.env?.VITE_RS_TELEMETRY_ENABLED === '1' } catch { return false }
}

let _sink = null
let _forced = null
/** Test seam: route events to `fn(event, props)` and force the gate open (or `null` to restore). */
export function __setRsTelemetrySink(fn) {
  _sink = typeof fn === 'function' ? fn : null
  _forced = _sink ? true : null
  _recent.clear()
  _onAt.clear()
}

/** Is RS telemetry on for this build? */
export function rsTelemetryEnabled() {
  return _forced === null ? envEnabled() : _forced
}

const _recent = new Map()
const now = () => Date.now()

function cleanProps(event, props) {
  const allowed = RS_TELEMETRY_EVENTS[event]
  const out = {}
  if (!allowed || !props || typeof props !== 'object') return out
  for (const key of allowed) {
    const v = props[key]
    if (typeof v === 'string' && PROP_VALUE_RE.test(v)) out[key] = v
  }
  return out
}

/**
 * Send one RS event. `dedupeKey` (optional) folds repeats of the same event about
 * the same thing inside `RS_DEDUPE_MS` into one. Returns whether it was sent.
 */
export function logRsEvent(event, props, dedupeKey) {
  try {
    if (!Object.prototype.hasOwnProperty.call(RS_TELEMETRY_EVENTS, event)) return false
    if (!rsTelemetryEnabled()) return false
    const t = now()
    if (dedupeKey !== undefined && dedupeKey !== null) {
      const k = `${event}|${dedupeKey}`
      const last = _recent.get(k)
      if (last !== undefined && t - last < RS_DEDUPE_MS) return false
      _recent.set(k, t)
      if (_recent.size > 200) {
        for (const [key, at] of _recent) if (t - at >= RS_DEDUPE_MS) _recent.delete(key)
      }
    }
    const clean = cleanProps(event, props)
    if (_sink) { _sink(event, clean); return true }
    let importId = null
    try { importId = newImportId() } catch { importId = `${event}:${t}:${Math.random().toString(36).slice(2, 10)}` }
    void logIndicatorTelemetry(event, { importId, props: clean })
    return true
  } catch {
    return false
  }
}

const isRs = (defOrId) => (typeof defOrId === 'string' ? defOrId : defOrId && defOrId.id) === RS_DEF_ID

/** A preset was picked on an RS copy (any door). */
export function noteRsPreset(def, preset) {
  if (!isRs(def) || !preset || typeof preset.id !== 'string') return false
  return logRsEvent('rs_preset', { name: preset.id }, preset.id)
}

/** A readout card was opened on an RS chip. `kind` is the readout row key. */
export function noteRsCard(defOrId, kind) {
  if (!isRs(defOrId)) return false
  return logRsEvent('rs_marker_card', { kind }, kind)
}

/** A Learn link was followed from an RS card or About page. `target` is the lesson key. */
export function noteRsLearn(defOrId, target) {
  if (!isRs(defOrId)) return false
  return logRsEvent('rs_learn', { target }, target)
}

// ── rs_on / rs_off_within_60s / rs_benchmark — OBSERVED, not wired per door ──
//
// A copy can be turned on from the library, the Indicators list, the phone switch,
// a chord, the Agent, a share link or a template; its benchmark from the dialog, the
// inspector, the phone sheet or the Agent. Wiring each door would miss the next one,
// so each chart OBSERVES its own RS instances and reports what changed between two
// observations. The first observation of a chart is its baseline: a chart that
// opens with RS already on reports nothing.

const _onAt = new Map()

/**
 * One chart's tracker. `observe(instances, {symbol})` takes the chart's resolved
 * instance list (any shape with `instanceId`, `defId`, `hidden`, `inputs`), keeps
 * the visible RS copies and sends what changed since the previous call.
 */
export function createRsInstanceTracker() {
  let prev = null
  return {
    observe(instances, ctx = {}) {
      try {
        const cur = new Map()
        for (const i of Array.isArray(instances) ? instances : []) {
          if (!i || i.defId !== RS_DEF_ID || typeof i.instanceId !== 'string' || i.hidden === true) continue
          const b = i.inputs && typeof i.inputs.benchmark === 'string' ? i.inputs.benchmark : 'SPY'
          cur.set(i.instanceId, b)
        }
        if (prev === null) { prev = cur; return }
        const symbol = typeof ctx.symbol === 'string' ? ctx.symbol : undefined
        const t = now()
        for (const [id, bench] of cur) {
          if (!prev.has(id)) {
            if (!_onAt.has(id)) _onAt.set(id, t)
            logRsEvent('rs_on', { symbol }, id)
          } else if (prev.get(id) !== bench) {
            logRsEvent('rs_benchmark', { value: bench }, `${id}|${bench}`)
          }
        }
        for (const id of prev.keys()) {
          if (cur.has(id)) continue
          const at = _onAt.get(id)
          if (at !== undefined && t - at <= RS_QUICK_OFF_MS) logRsEvent('rs_off_within_60s', { symbol }, id)
          _onAt.delete(id)
        }
        prev = cur
      } catch { /* telemetry never breaks the chart */ }
    },
  }
}
