// app/src/data/deviceStore/diag.js — did a switch's first paint come from the device copy, and if not, why?
//
// One record per symbol switch, written by the handoff at its commit (hooks/useSymbolHandoff.js) while the
// device store is switched on, so an on/off timing can say whether the device ran at all:
//   { sym, tf, at, outcome, painted, reason, why }
//     at       performance.now() of the commit (the page clock the proofs key on)
//     painted  what the chart's first frame is built from: 'device' | 'server' | another store source | 'none'
//     reason   the device rule's verdict (barStore/prefetch.deviceVerdict): 'paints', or the rule that refused
//     why      when the device copy was not the paint, the WORKER's rule (engine.why, asynchronously):
//              'ok' | 'seed-only:<overlay rule>' | seed-short | no-file | missing | split | bad | no-engine | no-client
//     pre      the device rule's verdict the LAST time the switch asked it while no server answer held the key
//              (null: it never waited, or the answer was already there). `reason` is taken at the commit, after
//              the answer of a switch that waited, where it can only read 'held:rest'; `pre` is why it waited.
// Read in the page as window.__uctDeviceDiag.log() (the proofs: uct-desktop scripts/proofs). Nothing reads
// it to decide anything. Bounded; lazy (the handoff is chart code, never on the first-open closure).

export const DIAG_MAX = 400
const _log = []

/** Append one switch record (kept: the newest DIAG_MAX). Returns the stored record (filled in later). */
export function noteDeviceSwitch(rec) {
  const r = { ...rec }
  _log.push(r)
  if (_log.length > DIAG_MAX) _log.splice(0, _log.length - DIAG_MAX)
  return r
}

/** A copy of the records, oldest first. */
export function deviceDiagLog() { return _log.map((r) => ({ ...r })) }

/** Forget every record. */
export function clearDeviceDiag() { _log.length = 0 }

/** window.__uctDeviceDiag = {log, clear}: the read path for the proofs. */
export function exposeDeviceDiag() {
  try { if (typeof window !== 'undefined') window.__uctDeviceDiag = { log: deviceDiagLog, clear: clearDeviceDiag } } catch { /* locked-down host */ }
}
