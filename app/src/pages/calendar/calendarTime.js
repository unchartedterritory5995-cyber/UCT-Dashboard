// app/src/pages/calendar/calendarTime.js
// Shared ET-time helpers — no clock times exist from any provider, so
// everything here is session/window-anchored.

// ET-anchored "today" ISO (YYYY-MM-DD).
export function todayIsoEt() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}

// Current ET hour, 0-23 (WebKit renders midnight as "24" with hour12:false).
export function etHour() {
  const h = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York', hour: '2-digit', hour12: false,
  })
  return parseInt(h, 10) % 24
}

// The "print window": post-close (>=16:00) or pre-open (06:00–09:59) ET.
export function inPrintWindow() {
  try {
    const h = etHour()
    return h >= 16 || (h >= 6 && h < 10)
  } catch { return false }
}

// Is this entry actively in its reporting window right now? (today, unreported,
// and the session's window is open). Session-anchored, never a clock time.
export function isReportingNow(entry) {
  if (!entry || entry.eps_act != null) return false
  if (entry._ds !== todayIsoEt()) return false
  const h = etHour()
  if (entry._timing === 'bmo') return h >= 6 && h < 10       // before-open window
  if (entry._timing === 'amc') return h >= 16 && h < 21      // after-close window
  return inPrintWindow()                                      // TBD → either window
}
