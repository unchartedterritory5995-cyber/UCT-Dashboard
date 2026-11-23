// app/src/data/deviceStore/tfs.js — the timeframes the on-device bar store holds (ONE owner; the
// engine, the client, the BarStore's source and the BarStore's own gate (persist.js) all read these).

/** Stored timeframes (one file each), in INGEST order: most opened and smallest first, 1m last.
 *  '60' is the RTH session grid (the store key `SYM_60`); the extended clock grid ('60e') is not seeded. */
export const STORED_TFS = Object.freeze(['D', '5', '60', '15', '30', '1'])
/** Timeframes the ENGINE can derive from a stored one: tf → the stored tf it comes from. Never served (below). */
export const DERIVED_TFS = Object.freeze({ W: 'D', M: 'D' })
/**
 * Every store cache-tf the device store answers for: the STORED ones only.
 * ⛔ NEVER W OR M (review of #2537, H1). Derived from the device's D window they were wrong as a first frame: that
 * window is ~350 sessions (a shallow W / M) and, on a weekday, holds no bar for today, so the week in progress was
 * dropped on every weekday and the month in progress on almost every day (resample.js drops a period that has not
 * ended), while the copy still read current and fresh and the switch painted it at once. No derivation from the seed
 * equals the server's W / M bars (the period in progress and the full depth), so a W or M key is never asked of the
 * device at all and behaves exactly as with the store off.
 */
export const SERVED_TFS = STORED_TFS
const _SERVED = new Set(SERVED_TFS)

/** Does the device store answer for the store cache-tf `cacheTf` ('60e', 'W' and 'M': no)? */
export function deviceServesTf(cacheTf) { return _SERVED.has(String(cacheTf)) }
