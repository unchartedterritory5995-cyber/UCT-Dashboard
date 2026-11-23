// The ET wall clock of an instant, as a Date whose LOCAL getters (getFullYear / getMonth / getDate / getDay / getHours /
// getMinutes / getSeconds) read the America/New_York wall time: marketSession.js's established idiom, re-parsing a
// `toLocaleString('en-US', { timeZone: 'America/New_York' })` string. ONE place for it, so its cost and its
// correctness are decided once.

/** `new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }))`. */
export function etWallDate(ms) {
  return new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'America/New_York' }))
}
