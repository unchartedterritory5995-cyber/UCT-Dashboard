/**
 * ⛔⛔ THE REPRODUCTION CHANNEL — INERT UNLESS EXPLICITLY ARMED.
 *
 * Wave Q1 round 3 has escaped three deploys and jsdom cannot construct the
 * ordering that produces it (`doorsThroughTheEditor.property.test.jsx` is green
 * on current code AND green with the `|| saved` defect reintroduced). The
 * instrument that caught it three times is the browser canary — but the canary
 * can only see the OUTSIDE: stores, PUTs, revisions. It cannot see what the
 * editor DECIDED, and the decision is the thing under suspicion.
 *
 * So this records the decisions. It answers, for a real run on the rig:
 *   · what did `captureLocalState()` actually return at settle time — null, or
 *     a stale object, or a current one?
 *   · what did `sameAuthoredContent` compare, and what did it answer?
 *   · which branch did the settle take, and what happened to the entry?
 *
 * ⛔⛔ IT IS OFF, AND OFF MEANS NOTHING HAPPENS. Not "records to a buffer nobody
 * reads" — the calls return immediately, allocate nothing, and touch no storage.
 * The layer this belongs to already ships dark behind `OFFLINE_DEFAULT_ON`, and
 * a diagnostic that is merely quiet rather than absent is how a dark feature
 * stops being dark (`project_feature_flag_ledger`: OFF-and-unset must be
 * indistinguishable from off-on-purpose).
 *
 * ⛔ NEVER READ BY PRODUCT CODE. Nothing branches on what is recorded here. If a
 * decision ever depends on this buffer it has stopped being an instrument and
 * become a second authority over the thing it was watching.
 *
 * ⭐ Arm it from the console or a CDP eval, never from a build:
 *      localStorage.setItem('uct.nb.diag', '1')   // then reload
 *      window.__uctNbDiag                          // the records, oldest first
 *      window.__uctNbDiag = []                     // reset between orderings
 */

export const DIAG_KEY = 'uct.nb.diag'

/** ⛔ Capped. A run that loops would otherwise trade a data-loss bug for an
 *  out-of-memory one, on the member's own machine. Oldest records are dropped —
 *  the interesting moment in every round so far was the LAST one. */
export const DIAG_MAX = 500

export function diagEnabled(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(DIAG_KEY) === '1'
  } catch {
    // A browser that refuses storage is not an armed browser.
    return false
  }
}

/**
 * Record one decision. ⛔ `build` is a FUNCTION, not a value: when the channel is
 * disarmed nothing is constructed at all, so an expensive payload costs nothing
 * on the path members actually run.
 */
export function diag(event, build) {
  if (!diagEnabled()) return
  try {
    const g = globalThis
    if (!Array.isArray(g.__uctNbDiag)) g.__uctNbDiag = []
    const payload = typeof build === 'function' ? build() : build
    g.__uctNbDiag.push({ at: new Date().toISOString(), event, ...payload })
    if (g.__uctNbDiag.length > DIAG_MAX) g.__uctNbDiag.splice(0, g.__uctNbDiag.length - DIAG_MAX)
  } catch {
    // ⛔ A diagnostic must never be able to break the thing it is diagnosing.
    // A throw here would turn an observation into an outage.
  }
}

/** A compact, greppable shape for a note-ish object — never the member's prose.
 *  ⛔ Length and a short hash, never the text: this runs against a real account,
 *  and a diagnostic that copies note bodies into a global is a data-exposure
 *  surface wearing a debugging hat. The canary already asserts the SENTENCE
 *  separately, from the server, where it belongs. */
export function shape(o) {
  if (o === null) return null
  if (o === undefined) return undefined
  try {
    const body = JSON.stringify(o.bodyJson ?? null)
    return {
      title: typeof o.title === 'string' ? o.title.length : null,
      subtitle: typeof o.subtitle === 'string' ? o.subtitle.length : null,
      bodyLen: body ? body.length : 0,
      bodyHash: hash32(body || ''),
      // ⛔ NO `??` OVER A BASELINE. `baseline.test.js` forbids it under
      // journal-2-0 and it is right to: nullish-coalescing PICKS `''` and the
      // consumers then DROP it on truthiness, so a baseline can be present here
      // and absent three lines later (`lesson_chosen_with_nullish_consumed_with_truthiness`).
      // A diagnostic must not be the one place that reintroduces the shape the
      // product spent a wave removing. Report exactly what is there.
      baseUpdatedAt: typeof o.baseUpdatedAt === 'string' ? o.baseUpdatedAt : null,
      updatedAt: typeof o.updatedAt === 'string' ? o.updatedAt : null,
    }
  } catch {
    return { unreadable: true }
  }
}

/** FNV-1a, 32-bit. Enough to say "these two documents differ" in a log line
 *  without carrying either of them. */
export function hash32(s) {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
