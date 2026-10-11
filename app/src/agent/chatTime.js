// Discord-style time: "10:14 PM" today, "Yesterday at 10:14 PM", else "10/09/2026 10:14 PM".
export function stampText(ms, now = Date.now()) {
  const d = new Date(ms)
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const day = (x) => new Date(x).toDateString()
  if (day(ms) === day(now)) return time
  if (day(ms) === day(now - 86400000)) return `Yesterday at ${time}`
  return `${d.toLocaleDateString()} ${time}`
}

// Discord grouping: a line from the same sender within 7 minutes of the previous one joins its
// group (no avatar, name or time of its own).
const GROUP_MS = 7 * 60 * 1000
const sideOf = (it) => (it.role === 'member' ? 'member' : 'agent')
export function continues(prev, it) {
  return !!prev && sideOf(prev) === sideOf(it) && prev.at != null && it.at != null && it.at - prev.at < GROUP_MS
}
