// app/src/lib/prefsSession.js — whose preferences the app is holding.
//
// AuthContext is the single writer (`publishPrefsUser`, once /api/auth/me has answered, on every
// committed user change); hooks/usePreferences is the reader (`onPrefsUserChange`), and clears
// its module state and the cached preferences when the member changes. Its own module, not an
// export of usePreferences, so the many tests that mock that hook do not have to mock this too.
let current
const listeners = new Set()

/** AuthContext only. `id` null = signed out. */
export function publishPrefsUser(id) {
  const next = id ?? null
  if (next === current) return
  const prev = current
  current = next
  for (const fn of [...listeners]) fn(next, prev)
}

/** The member last published; undefined before the first answer. */
export function prefsUser() { return current }

export function onPrefsUserChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Tests only. */
export function __resetPrefsSessionForTests() { current = undefined }
