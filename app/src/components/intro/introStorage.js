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

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
