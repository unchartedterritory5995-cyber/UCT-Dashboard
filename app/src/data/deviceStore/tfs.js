// app/src/data/deviceStore/tfs.js — the timeframes the on-device bar store holds (ONE owner; the
// engine, the client and the BarStore's source all read these).

/** Stored timeframes (one file each), in INGEST order: most opened and smallest first, 1m last.
 *  '60' is the RTH session grid (the store key `SYM_60`); the extended clock grid ('60e') is not seeded. */
export const STORED_TFS = Object.freeze(['D', '5', '60', '15', '30', '1'])
/** Timeframes derived on the device: tf → the stored tf it comes from. */
export const DERIVED_TFS = Object.freeze({ W: 'D', M: 'D' })
/** Every store cache-tf the device store answers for. */
export const SERVED_TFS = Object.freeze([...STORED_TFS, ...Object.keys(DERIVED_TFS)])
