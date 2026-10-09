const KEY = 'uct_intro_seen_v1'

export function hasSeenIntro() {
  try {
    return localStorage.getItem(KEY) === '1'
  } catch {
    return true
  }
}

export function markIntroSeen() {
  try {
    localStorage.setItem(KEY, '1')
  } catch {
    /* noop */
  }
}

export function clearIntroSeen() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}

// Session-scoped gate: the cinematic intro plays on the first load of a browser
// session, then is skipped on refreshes / returns within the same session (kills
// the repeated ~9s wait on mobile/cellular without losing the first-load brand
// moment). Cleared automatically when the tab/session ends.
const SESSION_KEY = 'uct_intro_seen_session'

export function hasSeenIntroThisSession() {
  try {
    return sessionStorage.getItem(SESSION_KEY) === '1'
  } catch {
    return false
  }
}

export function markIntroSeenThisSession() {
  try {
    sessionStorage.setItem(SESSION_KEY, '1')
  } catch {
    /* noop */
  }
}

// Daily gate (owner decision 2026-10-08): the intro plays at most ONCE PER DAY PER BROWSER,
// the day being the market's (Eastern Time) calendar date. The session gate above played it on
// every new tab or browser restart, which a member opening the terminal several times a day saw
// over and over. Storage that throws (private mode, blocked site data) falls back to the
// session gate, so a blocked localStorage never means "the film on every page load".
const DAY_KEY = 'uct_intro_last_et_day'
const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** `'YYYY-MM-DD'` of `now` on the Eastern Time calendar. */
export function etDay(now = new Date()) {
  const p = Object.fromEntries(ET_DAY.formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

export function hasSeenIntroToday(now = new Date()) {
  try {
    return localStorage.getItem(DAY_KEY) === etDay(now)
  } catch {
    return hasSeenIntroThisSession()
  }
}

export function markIntroSeenToday(now = new Date()) {
  try {
    localStorage.setItem(DAY_KEY, etDay(now))
  } catch {
    /* noop: the session mark below still stops a replay in this tab */
  }
  markIntroSeenThisSession()
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
