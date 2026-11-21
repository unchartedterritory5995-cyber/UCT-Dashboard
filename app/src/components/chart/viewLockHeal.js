// app/src/components/chart/viewLockHeal.js
//
// ─── ⭐⭐ THE ONE-TIME HEAL OF COMPOUNDED VIEW LOCKS (after #2346) ───────────────────────────
//
// #2346 stopped the price-axis view lock from compounding: it used to store the CANDLES' band,
// while the autoscale fills the candles AND every series that joins it (Fred RS's line under the
// bars), so each drag → switch round stored a smaller band. The fix stops NEW damage. It cannot
// reach a lock a member's browser already saved: `persistViewLock` wrote it, `readViewLock`
// re-applies it on every load, and a compounded lock stays compounded until right-click → Reset
// view. This module heals those, ONCE per device, before the first chart reads its lock.
//
// ⭐ THE RULE (coordinator ruling 2026-11-21, derived from production measurements that day).
// `band` = 1 − top − bottom, the pane share left to what the autoscale fits. A stored lock is
// COMPOUNDED iff it has a vertical half and
//   (a) band < 0.30 AND max(top, bottom) / min(top, bottom) ≥ 2.0, or
//   (b) it carries the clamp poison of the older frame-mix defect (`viewLockFractions`): a margin
//       ≥ 0.89, or top + bottom ≥ 0.94.
// Measured on production (fred_rs_axis_probe.py, PEB / KSS, 2026-11-21):
//   * nine UNCOMPOUNDED axis drags (Fred RS off before #2346; off and on after it), drags of
//     15–25% of the pane: bands 0.343–0.635, margin ratios ≤ 1.44 (≤ 1.10 after #2346). Spared.
//   * COMPOUNDED, Fred RS on before #2346: round 1 0.2415 / 0.3859 (band 0.373, ratio 1.60:
//     indistinguishable from a normal drag, spared); round 2 0.2069 / 0.5102 (band 0.283,
//     ratio 2.47); round 3 0.2419 / 0.655 (band 0.103, ratio 2.71), which left KSS's candles
//     6.5% of the pane. Rounds 2 and 3 are healed.
// Why the ratio and not the band alone: lightweight-charts scales a price-axis drag around the
// centre (`coeff = (y0 + 0.2H) / (y1 + 0.2H)`), so a deliberate drag of the full axis height can
// leave a band near 1/6 of where it started, but SYMMETRIC. Compounding is asymmetric: the line
// that joins the autoscale sits on one side of the bars, and only that side's margin grows.
// ⛔ THE ONE FALSE POSITIVE IT ACCEPTS: a member who compressed the axis and then dragged a
// PINNED scale off-centre stores a small asymmetric band on purpose. They lose that vertical
// placement once, and one re-drag restores it.
//
// ⭐ WHAT IT CHANGES: only `top` / `bottom` (nulled; `readViewLock` then restores no vertical
// half). The horizontal half (`anchorFrac`, `width`, `tf`) was never poisoned and is kept. A lock
// with no horizontal half left is removed. No other key is touched.
// ⭐ ONCE: the done flag `uct.charts.viewLockHeal.v1` holds `{ healed, at }`, the count of locks
// this device healed (device-local; no telemetry endpoint takes it). Present → never runs again.

export const VIEW_LOCK_KEY = 'uct.charts.viewLock'
export const VIEW_LOCK_KEY_PREFIX = 'uct.charts.viewLock.'
export const VIEW_LOCK_HEAL_FLAG = 'uct.charts.viewLockHeal.v1'
export const HEAL_BAND_BELOW = 0.30
export const HEAL_RATIO_AT_LEAST = 2.0
export const CLAMP_MARGIN_AT_LEAST = 0.89
export const CLAMP_SUM_AT_LEAST = 0.94

const num = (v) => typeof v === 'number' && Number.isFinite(v)

/** True iff a stored view lock's vertical half is clearly compounded (the rule above). */
export function viewLockIsCompounded(lock) {
  const t = lock?.top, b = lock?.bottom
  if (!num(t) || !num(b)) return false
  if (t >= CLAMP_MARGIN_AT_LEAST || b >= CLAMP_MARGIN_AT_LEAST || t + b >= CLAMP_SUM_AT_LEAST) return true
  const band = 1 - t - b
  const lo = Math.min(t, b), hi = Math.max(t, b)
  const ratio = lo > 0 ? hi / lo : (hi > 0 ? Infinity : 1)
  return band < HEAL_BAND_BELOW && ratio >= HEAL_RATIO_AT_LEAST
}

/** The lock without its vertical half, or null when no horizontal half is left (remove the key). */
export function healedViewLock(lock) {
  const hOK = num(lock?.anchorFrac) && num(lock?.width) && lock.width > 0
  if (!hOK) return null
  return { ...lock, top: null, bottom: null, vLocked: false }
}

let settledThisPage = false

/** Heal every compounded view lock on this device, once. Never throws. Returns the done record it
 *  wrote ({ healed, at }), or null when it did not run (already done on this device, already
 *  checked on this page, or storage unavailable). */
export function healViewLocksOnce(storage = globalThis.localStorage, now = () => new Date().toISOString()) {
  if (settledThisPage) return null
  settledThisPage = true
  try {
    if (!storage || storage.getItem(VIEW_LOCK_HEAL_FLAG) != null) return null
    const found = []
    for (let i = 0; i < storage.length; i += 1) {
      const k = storage.key(i)
      if (k === VIEW_LOCK_KEY || (typeof k === 'string' && k.startsWith(VIEW_LOCK_KEY_PREFIX))) found.push(k)
    }
    let healed = 0
    for (const k of found) {
      const name = k === VIEW_LOCK_KEY ? VIEW_LOCK_KEY : VIEW_LOCK_KEY_PREFIX + k.slice(VIEW_LOCK_KEY_PREFIX.length)
      let lock = null
      try { lock = JSON.parse(storage.getItem(name)) } catch { continue }
      if (!lock || typeof lock !== 'object' || !viewLockIsCompounded(lock)) continue
      const next = healedViewLock(lock)
      if (next) storage.setItem(name, JSON.stringify(next))
      else storage.removeItem(name)
      healed += 1
    }
    const done = { healed, at: now() }
    storage.setItem(VIEW_LOCK_HEAL_FLAG, JSON.stringify(done))
    return done
  } catch {
    return null
  }
}

/** Tests only: forget that this page already checked (a new page load). */
export function _resetViewLockHealForTests() { settledThisPage = false }
