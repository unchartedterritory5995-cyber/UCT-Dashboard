// app/src/data/deviceStore/tfs.js — the timeframes the on-device bar store holds (ONE owner; the
// engine, the client, the BarStore's source and the BarStore's own gate (persist.js) all read these).

/** Stored timeframes (one file each), in INGEST order: most opened and smallest first, 1m last.
 *  '60' is the RTH session grid (the store key `SYM_60`); the extended clock grid ('60e') is not seeded. */
export const STORED_TFS = Object.freeze(['D', '5', '60', '15', '30', '1'])
/** Timeframes the ENGINE can derive from a stored one: tf → the stored tf it comes from. */
export const DERIVED_TFS = Object.freeze({ W: 'D', M: 'D' })
/**
 * ⭐ W AND M FROM A FULL-DEPTH D COPY (zero-network PR 3.3, 2026-11-28). The review of #2537 (H1) kept W and M off the
 * device: derived from a ~350-session D window that, on a weekday, held no bar for today, the copy was shallow and lacked
 * the period in progress, yet read current and fresh. Both causes are now facts the copy carries, and the lift is ONLY
 * where both hold (resample.deriveServed, read by source.js): the D copy is the symbol's WHOLE served series (the
 * full-depth pack, engine `whole`) AND the period in progress is known (resample.periodKnown: the copy holds today's
 * row, or no session has begun since its last one). Anything else answers null exactly as before (`why` names the rule).
 * The derivation is resample.js over utils/resampleBars, held equal to the server's W / M field for field by
 * tools/ffseed_wm_parity.py. False: W and M are never asked of the device at all (the H1 behaviour).
 */
export const DEVICE_WM_FROM_FULL_D = true
/** The timeframes the WORKER and its page client answer for: the STORED ones only. A W / M read never reaches the
 *  worker (review of #2549, P2-L2): the page's source derives them from the D copy it reads (source.js). */
export const WORKER_SERVED_TFS = STORED_TFS
/** Every store cache-tf the PAGE asks the device store for (persist.js, prefetch.js, source.js): the stored ones, plus
 *  W and M under DEVICE_WM_FROM_FULL_D. */
export const SERVED_TFS = Object.freeze(DEVICE_WM_FROM_FULL_D ? [...STORED_TFS, 'W', 'M'] : [...STORED_TFS])
const _SERVED = new Set(SERVED_TFS)
const _WORKER = new Set(WORKER_SERVED_TFS)

/** Does the page ask the device store for the store cache-tf `cacheTf` ('60e': no; W / M: under DEVICE_WM_FROM_FULL_D)? */
export function deviceServesTf(cacheTf) { return _SERVED.has(String(cacheTf)) }
/** Does the worker answer a read of `tf` (the stored timeframes only)? */
export function workerServesTf(tf) { return _WORKER.has(String(tf)) }
