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

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
