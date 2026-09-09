/**
 * Wave Q1 — the switch that keeps this dark until the certification gate opens.
 *
 * ⚰️ WHY IT EXISTS, STATED PLAINLY. §32 makes the browser matrix a HARD Q1
 * CERTIFICATION / MERGE gate: Safari/iOS unmeasured means Q1 cannot close. This
 * branch ships to `master`, and `master` is production — so the durable working
 * copy and the outbox reached members BEFORE that gate was satisfied. Reverting
 * would throw away work that is correct and railed; the repo's own idiom is the
 * better answer, and it is the one the OCR wave used a fortnight ago: merge the
 * code, ship it DARK, and let a measured gate turn it on.
 *
 * ⛔ DEFAULT OFF. With this off, `useDurableNote` and `useOutboxDrain` report
 * `supported: false` and every path in the Notebook behaves exactly as it did
 * before Wave Q1: the synchronous localStorage draft, the ~800ms server PUT,
 * the existing conflict handling. Nothing is written to IndexedDB, nothing is
 * queued, and nothing is drained.
 *
 * ⛔ AND THE OPT-IN IS PER BROWSER, NOT PER DEPLOY. `localStorage` rather than a
 * `VITE_` variable, mirroring `uct.barsPush.enabled`: certification has to run
 * against the REAL production build in a REAL browser, and a build-time flag
 * would force the choice between a sandbox (which is not the product) and
 * turning it on for every member at once (which is the gate this exists to
 * respect).
 *
 *     localStorage.setItem('uct.j2.offline.enabled', '1')   // this browser only
 *     localStorage.removeItem('uct.j2.offline.enabled')     // back to the default
 *
 * ⛔ TURNING IT ON IS A MEASUREMENT DECISION, NOT A CLEANUP TASK. Flip
 * `OFFLINE_DEFAULT_ON` only when the §32 matrix — Chrome desktop, Safari/iOS,
 * Firefox desktop, fresh profile, private/incognito — has actually been
 * reported. "It works on my machine" is the failure this program has already
 * paid for twice.
 */

/** ⛔ The certification gate. Do not flip this without the §32 matrix. */
export const OFFLINE_DEFAULT_ON = false

export const OFFLINE_FLAG_KEY = 'uct.j2.offline.enabled'

export function offlineEnabled(storage = globalThis.localStorage) {
  try {
    const v = storage?.getItem(OFFLINE_FLAG_KEY)
    if (v === '1') return true
    if (v === '0') return false
  } catch { /* private mode: fall through to the default */ }
  return OFFLINE_DEFAULT_ON
}
