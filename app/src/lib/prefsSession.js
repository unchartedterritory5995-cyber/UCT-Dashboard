// app/src/lib/prefsSession.js — whose preferences the app is holding.
//
// AuthContext is the single writer (`publishPrefsUser`, once /api/auth/me has answered, on every
// committed user change); hooks/usePreferences is the reader (`onPrefsUserChange`), and clears
// its module state and the cached preferences when the member changes. Its own module, not an
// export of usePreferences, so the many tests that mock that hook do not have to mock this too.
//
// ⛔⛔ AND IT OWNS THE SESSION GENERATION — the one authority for "is this still the member an
// operation began for". `beginPrefsOp()` captures it; `op.stale()` is true once the member has
// changed. Here rather than in usePreferences so a caller (Notebook, Charts) that begins an op
// before its own await does not depend on a module half the test suite mocks.
let current
let gen = 0
const listeners = new Set()

/** AuthContext only. `id` null = signed out. */
export function publishPrefsUser(id) {
  const next = id ?? null
  if (next === current) return
  const prev = current
  current = next
  if (prev !== undefined) gen += 1        // the first answer of /me is not a change of member
  for (const fn of [...listeners]) fn(next, prev)
}

/** Start an operation for the current member. `op.stale()` is true once the member has changed. */
export function beginPrefsOp() {
  const g = gen
  const user = current
  return { gen: g, user, stale: () => g !== gen }
}

/** The member last published; undefined before the first answer. */
export function prefsUser() { return current }

export function onPrefsUserChange(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Tests only. */
export function __resetPrefsSessionForTests() { current = undefined }
