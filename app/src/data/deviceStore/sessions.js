// app/src/data/deviceStore/sessions.js — NYSE session dates for the device store (weekdays, full
// holidays skipped: utils/marketSession.isHolidayISO, the app's one calendar). Small: the page's
// prefetch reads it (fresh.js) as well as the worker.

import { isHolidayISO } from '../../utils/marketSession'

/** Is ISO date `iso` ('YYYY-MM-DD') a trading session? */
export function sessionISO(iso) {
  const wd = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return wd !== 0 && wd !== 6 && !isHolidayISO(iso)
}

function _step(day, dir) {
  const d = new Date(`${day}T12:00:00Z`)
  for (let i = 0; i < 14; i++) {
    d.setUTCDate(d.getUTCDate() + dir)
    const iso = d.toISOString().slice(0, 10)
    if (sessionISO(iso)) return iso
  }
  return null
}
/** The trading session before ISO date `day`. */
export const prevSessionISO = (day) => _step(day, -1)
/** The trading session after ISO date `day`. */
export const nextSessionISO = (day) => _step(day, +1)

/** YYYYMMDD number → 'YYYY-MM-DD'. */
export const isoOfYmd = (n) => `${Math.floor(n / 10000)}-${String(Math.floor(n / 100) % 100).padStart(2, '0')}-${String(n % 100).padStart(2, '0')}`
