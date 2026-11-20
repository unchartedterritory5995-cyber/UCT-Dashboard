// app/src/data/deviceStore/fresh.js — is a device copy recent enough to be a chart's whole first frame?
//
// Every device copy carries `through`: the unix second up to which it is complete (engine.js: the end of
// its seed's as-of day, or of the newest minute the live overlay applied; live.js holds only complete
// buckets). The handoff paints a device copy at once only when this says it is fresh
// (barStore/prefetch.devicePaints), for EVERY timeframe:
//   * during the regular session: complete through the last DEVICE_FRESH_MS (2 minutes). D, W and M are
//     never complete mid-session (today's daily bar ends with the 04:00-20:00 day), so mid-session they
//     never paint from the device: the server's answer carries today's developing daily bar.
//   * outside it: complete through the end of the last closed session (intraday: its regular close, 13:00
//     on an NYSE early-close day; D/W/M: the end of that day, when its daily bar is whole).
// Small on purpose: barStore/prefetch.js imports it.

import { etDateLabel, etMinuteOfDay, fromChartTime } from '../../components/chart/barTime'
import { earlyCloseOn } from '../../lib/marketClock/nyseCalendar'
import { prevSessionISO, sessionISO } from './sessions'

export const DEVICE_FRESH_MS = 120_000
const RTH_OPEN_MIN = 570
const DATE_TFS = new Set(['D', 'W', 'M'])

/** ET minute of the regular close of session `iso` (13:00 on an early-close day). */
export function closeMinuteOf(iso) {
  const e = earlyCloseOn(iso)
  return e ? e.closeHour * 60 + e.closeMinute : 960
}

const dayUnix = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / 1000

/**
 * @param {number} through   unix s the copy is complete up to
 * @param {string} tf        store tf ('1' ... '60', 'D', 'W', 'M')
 * @param {number} [nowMs]
 */
export function deviceCopyFresh(through, tf, nowMs = Date.now()) {
  if (typeof through !== 'number' || !Number.isFinite(through)) return false
  const nowSec = Math.floor(nowMs / 1000)
  const today = etDateLabel(nowSec)
  const mod = etMinuteOfDay(nowSec)
  const close = closeMinuteOf(today)
  if (sessionISO(today) && mod >= RTH_OPEN_MIN && mod < close) return through * 1000 >= nowMs - DEVICE_FRESH_MS
  const last = sessionISO(today) && mod >= close ? today : prevSessionISO(today)
  if (!last) return false
  const need = DATE_TFS.has(String(tf))
    ? dayUnix(last) + 86400                                       // the whole day (the seed's own stamp)
    : fromChartTime(dayUnix(last) + closeMinuteOf(last) * 60)     // the regular close of that session
  return through >= need
}
