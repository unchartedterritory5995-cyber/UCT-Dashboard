/**
 * ⭐ UCT RS unit VA2 — the plan's §13 telemetry, as COUNTS ONLY.
 *
 * Five events (plan §13, "Telemetry counts as v3"; six until U9 retired `rs_preset`):
 *   rs_on               an RS copy started drawing on a chart this tab is showing
 *   rs_off_within_60s   that copy stopped drawing (hidden or removed) within 60 s
 *   rs_benchmark {value} a copy's benchmark changed (whichever door changed it)
 *   rs_marker_card {kind} a readout card was opened (`kind` = the readout row key)
 *   rs_learn {target}   a Learn link was followed (`target` = the lesson key)
 *
 * ⭐ THE PIPELINE IS THE APP'S OWN, NOT A NEW ONE: `lib/indicatorTelemetry.js` →
 * `POST /api/indicator-telemetry/event` → `landing_events`, the door the authoring
 * studio already uses. No vendor, no endpoint.
 *
 * ⭐ ON BY DEFAULT SINCE THE SERVER LISTS THE EVENTS (2026-11-07). That door refuses
 * any event outside `api/services/indicator_telemetry.CLIENT_FIREABLE_EVENTS` (400)
 * and any prop its `EVENT_SCHEMAS` / `_VALUE_RULES` do not allow (422). The five
 * `rs_*` events and their one prop each are on those lists now, each value held to
 * a closed set (benchmark codes, card keys, lesson keys) or the ticker pattern, so
 * the gate is open.
 *
 * ⚰️ `rs_preset {name}` (a preset was picked) was RETIRED by the RS split (U9,
 * 2026-11-09): the slim UCT RS Line has no presets (map §(a) U7), so the count has
 * nothing to count. The server allow-list dropped it the same day; a build that
 * still sent it would be refused at the door (400), which is why it is gone here
 * rather than left dangling. Today's definition's preset doors simply count nothing. ⛔ KILL SWITCH: a build with
 * `VITE_RS_TELEMETRY_ENABLED=0` sends nothing at all; any other value, or none, is on.
 *
 * ⛔ NO PERSONAL DATA. A prop is a ticker symbol, a benchmark code, a readout row
 * key or a lesson key: a short identifier, checked against
 * `PROP_VALUE_RE` and dropped otherwise. Never a name, an email, a note or a number
 * a member typed.
 *
 * ⛔ NEVER THROWS, NEVER AWAITS IN THE CALLER'S PATH. Telemetry that breaks the
 * product action it observes is worse than no telemetry.
 */
import { logIndicatorTelemetry, newImportId } from './indicatorTelemetry'

/** The definition these events describe. */
export const RS_DEF_ID = 'rsLine'

/** The five events and the one prop each may carry (besides `symbol`). */
export const RS_TELEMETRY_EVENTS = Object.freeze({
  rs_on: Object.freeze(['symbol']),
  rs_off_within_60s: Object.freeze(['symbol']),
  rs_benchmark: Object.freeze(['value']),
  rs_marker_card: Object.freeze(['kind']),
  rs_learn: Object.freeze(['target']),
})

/** A prop value is a short identifier: a ticker (`BRK-B`, `BRK.B`), a lesson key, a code. */
export const PROP_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,31}$/

/** ⭐ The server's ticker rule for `symbol` (`indicator_telemetry._RS_TICKER`), so a
 *  symbol the door would refuse is dropped here and the count still lands without it. */
export const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.:-]{0,11}$/

/** How long a copy may have been drawing for `rs_off_within_60s`. */
export const RS_QUICK_OFF_MS = 60_000

/** Two charts on one page read one settings blob, so one member action reaches every
 *  chart's tracker. The same event about the same thing inside this window is one. */
export const RS_DEDUPE_MS = 5_000

/** On unless the build says `VITE_RS_TELEMETRY_ENABLED=0` (the kill switch). */
function envEnabled() {
  try { return import.meta.env?.VITE_RS_TELEMETRY_ENABLED !== '0' } catch { return false }
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

let _suiteOff = false
/** Test seam for `src/test-setup.js`: the suites written while this was dark mount
 *  RS charts under a `fetch` mock that counts calls, so the shared setup turns the
 *  default off (`true`); `rsTelemetry.test.js` turns it back (`false`) to rail the
 *  real gate. A sink (`__setRsTelemetrySink`) opens the gate either way. */
export function __setRsTelemetryOffForTests(off) {
  _suiteOff = off === true
}

/** Is RS telemetry on for this build? On unless `VITE_RS_TELEMETRY_ENABLED=0`. */
export function rsTelemetryEnabled() {
  if (_forced !== null) return _forced
  return _suiteOff ? false : envEnabled()
}

const _recent = new Map()
const now = () => Date.now()

function cleanProps(event, props) {
  const allowed = RS_TELEMETRY_EVENTS[event]
  const out = {}
  if (!allowed || !props || typeof props !== 'object') return out
  for (const key of allowed) {
    const v = props[key]
    if (typeof v === 'string' && PROP_VALUE_RE.test(v) && (key !== 'symbol' || SYMBOL_RE.test(v))) out[key] = v
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
