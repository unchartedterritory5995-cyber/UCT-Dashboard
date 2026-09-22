// ── WHO MOVED THE CAMERA? ────────────────────────────────────────────────────
//
// ⛔⛔ THE INVARIANT THIS EXISTS TO POLICE. Market data may change the SERIES.
// Market data may not change the USER'S CAMERA. Once a member pans or zooms,
// the visible time range is theirs until THEY act again — no tick, no new bar,
// no price spike, no autoscale pass gets to reposition it.
//
// There are ~40 call sites in StockChart that can move the horizontal view.
// Reading them does not tell you which one fires during a live burst, and this
// project has already been burned repeatedly by plausible-looking reasoning
// that measurement then contradicted. So instead of auditing by eye, every
// programmatic camera mutation is funnelled through a wrapper that records who
// called it, why, and whether the user owned the view at that instant.
//
// ⭐ DEV/HARNESS ONLY. Inert unless `localStorage['uct.cameraAudit'] === '1'`,
// so production pays one boolean read when a chart is created and nothing else.
// It NEVER blocks a call — it observes. A guard that silently swallowed a move
// would hide the very defect we are hunting.
//
// ⚠️ `userOwned` IS SUPPLIED BY THE CHART, NOT INVENTED HERE. StockChart's
// `userViewMovedRef` is the canonical horizontal-ownership latch (its own
// comment names the original "drag left and it snaps straight back" bug), and
// this module must not become a second opinion about who owns the view.

const KEY = 'uct.cameraAudit'
const MAX = 400

export function cameraAuditEnabled() {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1' }
  catch { return false }
}

const _events = []
let _ownedProbe = () => false

/** The chart tells us how to ask "does the user own the view right now?". */
export function setOwnershipProbe(fn) {
  if (typeof fn === 'function') _ownedProbe = fn
}

/** Marks the calls a USER ACTION legitimately caused, so they are not flagged.
 *  Wrap the smallest possible region — anything inside it is exempt. */
let _userIntentDepth = 0
export function asUserIntent(reason, fn) {
  _userIntentDepth += 1
  try { return fn() } finally { _userIntentDepth -= 1; void reason }
}

function _record(method, args, before, after, stack) {
  const owned = (() => { try { return !!_ownedProbe() } catch { return false } })()
  const ev = {
    t: Math.round(typeof performance !== 'undefined' ? performance.now() : Date.now()),
    method,
    arg: (() => { try { return JSON.parse(JSON.stringify(args?.[0] ?? null)) } catch { return null } })(),
    before, after,
    userOwned: owned,
    userIntent: _userIntentDepth > 0,
    // ⛔ THE FAILING CASE, NAMED AT THE MOMENT IT HAPPENS: the user owns the
    // view and something that is not a user action moved it anyway.
    unauthorized: owned && _userIntentDepth === 0,
    // Trimmed to the frames that identify the caller; the full stack is noise.
    at: (stack || '').split('\n').slice(2, 7).map(s => s.trim()).join(' | '),
  }
  _events.push(ev)
  if (_events.length > MAX) _events.shift()
  return ev
}

const METHODS = ['setVisibleLogicalRange', 'setVisibleRange', 'scrollToRealTime',
                 'scrollToPosition', 'fitContent', 'resetTimeScale', 'applyOptions']

/**
 * Instrument one chart's time scale. Idempotent, and a no-op when disabled.
 *
 * ⚠️ WRAPS, NEVER REPLACES. The original method is always called with the
 * original arguments — this changes observability, never behaviour, so a run
 * with the audit on measures the same product a member gets.
 */
export function auditChartCamera(chart) {
  if (!chart || !cameraAuditEnabled()) return chart
  let ts
  try { ts = chart.timeScale() } catch { return chart }
  if (!ts || ts.__uctAudited) return chart
  for (const m of METHODS) {
    const orig = ts[m]
    if (typeof orig !== 'function') continue
    ts[m] = function wrapped(...args) {
      let before = null, after = null
      try { before = ts.getVisibleLogicalRange?.() ?? null } catch { /* mid-load */ }
      const out = orig.apply(this, args)
      try { after = ts.getVisibleLogicalRange?.() ?? null } catch { /* mid-load */ }
      // `applyOptions` only counts as a camera move when it carries a horizontal
      // option; a barSpacing/rightOffset change repositions, a border colour
      // does not.
      const horizontal = m !== 'applyOptions'
        || (args?.[0] && ('rightOffset' in args[0] || 'barSpacing' in args[0]
            || 'rightBarStaysOnScroll' in args[0] || 'shiftVisibleRangeOnNewBar' in args[0]))
      if (horizontal) {
        const ev = _record(m, args, before, after, new Error().stack)
        // ⛔⛔ SAMPLE THE SETTLED RANGE, NOT THE SYNCHRONOUS ONE. LWC applies
        // scrollToRealTime (and friends) ASYNCHRONOUSLY, so reading the range
        // on the next line returns the value from BEFORE the move — and the
        // "did this actually move anything?" filter then discarded a genuine
        // unauthorized move as a no-op. That is precisely how this harness's
        // own negative control failed: the forced scrollToRealTime WAS
        // recorded with unauthorized:true, yet unauthorizedMoves() reported
        // zero because before === after at that instant. Re-read once the
        // frame has settled and update the record in place.
        const settle = () => {
          try { ev.after = ts.getVisibleLogicalRange?.() ?? ev.after } catch { /* disposed */ }
        }
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => { settle() })
        setTimeout(settle, 120)
      }
      return out
    }
  }
  ts.__uctAudited = true
  // ⭐ A HANDLE FOR THE NEGATIVE CONTROL, and only for it. §5 requires proving
  // the audit can DETECT an unauthorized move before a clean run means
  // anything, which needs something able to make one. It lives here, inside
  // the dev-only module, behind the same flag — not as a new production export.
  _auditedTimeScale = ts
  return chart
}

let _auditedTimeScale = null

/** @internal harness-only: deliberately move the camera to prove detection.
 *
 *  ⛔ 'shiftOne' EXISTS BECAUSE THE FILTER ALREADY MISSED THE REAL DEFECT. The
 *  causal `setVisibleLogicalRange` that dragged a user-owned view forward one
 *  bar appeared in the RAW trace with userOwned:true, yet `unauthorizedMoves()`
 *  returned zero — so the two `scrollToRealTime`/`fitContent` controls were
 *  passing while the filter was blind to the exact shape of the production bug.
 *  A negative control has to match the failure it is guarding, not a convenient
 *  neighbour of it. */
export function forceIllegalCameraMove(kind = 'scrollToRealTime') {
  if (!cameraAuditEnabled() || !_auditedTimeScale) return 'unavailable'
  try {
    if (kind === 'fitContent') { _auditedTimeScale.fitContent(); return 'invoked' }
    if (kind === 'shiftOne') {
      const r = _auditedTimeScale.getVisibleLogicalRange?.()
      if (!r) return 'no-range'
      _auditedTimeScale.setVisibleLogicalRange({ from: r.from + 1, to: r.to + 1 })
      return 'invoked'
    }
    _auditedTimeScale.scrollToRealTime()
    return 'invoked'
  } catch (e) { return 'threw: ' + String(e).slice(0, 60) }
}

/** @internal harness-only: is the user's view ownership latched right now?
 *  Reads the CHART's own latch through the probe — this module never forms its
 *  own opinion about ownership. Without this a harness cannot tell "no
 *  unauthorized moves" from "the gesture never registered", and those two look
 *  identical in a summary. */
export function cameraAuditOwned() {
  try { return !!_ownedProbe() } catch { return false }
}

/** @internal harness-only: read/flip the LWC append-shift options so the A/B
 *  mechanism test can prove WHICH option produces the +1 drift, rather than
 *  inferring it from the option's name. */
export function cameraTimeScaleOptions(patch) {
  if (!cameraAuditEnabled() || !_auditedTimeScale) return null
  try {
    if (patch) _auditedTimeScale.applyOptions(patch)
    return _auditedTimeScale.options ? { ..._auditedTimeScale.options() } : null
  } catch { return null }
}

export function cameraAuditReport() { return _events.slice() }
export function cameraAuditClear() { _events.length = 0 }

/** Moves that happened while the user owned the view and no user action was in
 *  flight — the acceptance number. */
export function unauthorizedMoves() {
  return _events.filter(e => e.unauthorized && _movedRange(e))
}

/** A call that did not actually change the visible range is not a camera move,
 *  however loud its name. Re-asserting the same range is a no-op to the member. */
function _movedRange(e) {
  const a = e.before, b = e.after
  if (!a || !b) return true              // unknown → count it, fail closed
  return Math.abs((a.from ?? 0) - (b.from ?? 0)) > 0.01
      || Math.abs((a.to ?? 0) - (b.to ?? 0)) > 0.01
}

if (typeof window !== 'undefined') {
  window.__uctCameraAudit = {
    enable() { try { localStorage.setItem(KEY, '1') } catch { /* ignore */ } },
    disable() { try { localStorage.removeItem(KEY) } catch { /* ignore */ } },
    report: cameraAuditReport,
    clear: cameraAuditClear,
    unauthorized: unauthorizedMoves,
    forceIllegal: forceIllegalCameraMove,
    owned: cameraAuditOwned,
    tsOptions: cameraTimeScaleOptions,
  }
}
