// G-040 — the "captured <when>" stamp the three capture-only embeds print.
//
// ⛔ ET, AND AN EXPLICIT LOCALE. The member's clock is not the market's: a 9pm ET
// capture read in UTC is already tomorrow, and an unqualified formatter answers a
// different string per browser. Same rule as `widgetEmbedCore.etDayOf`.

const ET = 'America/New_York'

const DATE_TIME = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
})
const DATE_ONLY = new Intl.DateTimeFormat('en-US', {
  timeZone: ET, month: 'short', day: 'numeric', year: 'numeric',
})

/** ISO instant → "Sep 30, 2026, 10:42 AM ET", or null when unreadable. */
export function etDateTime(iso) {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return null
  return `${DATE_TIME.format(new Date(t))} ET`
}

/** ISO instant → "Sep 30, 2026" (the ET day), or null when unreadable. */
export function etDate(iso) {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return null
  return DATE_ONLY.format(new Date(t))
}

/** 'YYYY-MM-DD' → "Sep 22, 2026" — a calendar day, never shifted through a zone. */
export function isoDayText(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(day ?? ''))
  if (!m) return day ? String(day) : null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12))
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}
