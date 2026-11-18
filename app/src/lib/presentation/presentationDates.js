/**
 * Date text for surfaces that load on demand (Import a tweet's card and price line).
 *
 * Kept out of `presentationPrimitives.js` because that module is in the Notebook's first open, and
 * a dynamically imported chunk's use of an export keeps the export in the module that owns it.
 */
import { LOCALE, MARKET_TIME_ZONE, formatTimeEt } from './presentationPrimitives'

/**
 * A short weekday, date and time in the market's zone: "Fri Nov 6, 3:47 PM".
 *
 * @param {*} epochSeconds
 * @param {{zoneSuffix?: string|null, absent?: *}} [options]
 */
export function formatWeekdayDateTimeEt(epochSeconds, { zoneSuffix = null, absent = null } = {}) {
  if (!Number.isFinite(epochSeconds)) return absent
  const d = new Date(epochSeconds * 1000)
  if (Number.isNaN(d.getTime())) return absent
  const day = d.toLocaleDateString(LOCALE, {
    timeZone: MARKET_TIME_ZONE, weekday: 'short', month: 'short', day: 'numeric',
  })
  return `${day.replace(',', '')}, ${formatTimeEt(d, { zoneSuffix })}`
}

/**
 * A calendar date, "Oct 14", from an ISO `YYYY-MM-DD`. A session date names a day rather than an
 * instant, so it is read and written in UTC: no viewer's zone can move it to the day before.
 *
 * @param {*} isoDate
 * @param {{absent?: *}} [options]
 */
export function formatSessionDate(isoDate, { absent = '' } = {}) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(isoDate ?? ''))
  if (!m) return absent
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  if (d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return absent
  return d.toLocaleDateString(LOCALE, { timeZone: 'UTC', month: 'short', day: 'numeric' })
}
