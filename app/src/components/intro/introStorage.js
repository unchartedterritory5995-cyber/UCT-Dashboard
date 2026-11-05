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

// S12 (audit 2026-11-05, M9): the intro FILM plays in full ONCE A WEEK PER DEVICE; every other page load gets a
// 0.6 s fade (IntroAnimation's `fading` phase). The week counts Eastern Time calendar days (the market's), from the
// day the film last played in this browser. ⚰️ It was once per day (owner decision 2026-10-08, the `uct_intro_last_
// et_day` key), which still put the ~9 s film in front of a daily member every morning. Storage that throws (private
// mode, blocked site data) falls back to the session gate, so a blocked localStorage never means "the film on every
// page load".
const FULL_KEY = 'uct_intro_last_full_et_day'
export const FULL_INTRO_EVERY_DAYS = 7
const ET_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** `'YYYY-MM-DD'` of `now` on the Eastern Time calendar. */
export function etDay(now = new Date()) {
  const p = Object.fromEntries(ET_DAY.formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

const dayNumber = (ymd) => {
  const [y, m, d] = ymd.split('-').map(Number)
  return Date.UTC(y, m - 1, d) / 86400000
}

/** Is the full film due in this browser (never played, or played FULL_INTRO_EVERY_DAYS or more ET days ago)? */
// Fix round 1 (review Minor 12): the daily gate's key. A member who saw the film under it has seen it on that day,
// so it seeds the weekly key once (no 9 s film on the first load after the deploy because a key was renamed), and is
// removed.
const OLD_DAY_KEY = 'uct_intro_last_et_day'
function migrateOldKey() {
  const old = localStorage.getItem(OLD_DAY_KEY)
  if (old == null) return
  if (!localStorage.getItem(FULL_KEY) && /^\d{4}-\d{2}-\d{2}$/.test(old)) localStorage.setItem(FULL_KEY, old)
  localStorage.removeItem(OLD_DAY_KEY)
}

export function fullIntroDue(now = new Date()) {
  try {
    migrateOldKey()
    const last = localStorage.getItem(FULL_KEY)
    if (!last || !/^\d{4}-\d{2}-\d{2}$/.test(last)) return true
    return dayNumber(etDay(now)) - dayNumber(last) >= FULL_INTRO_EVERY_DAYS
  } catch {
    return !hasSeenIntroThisSession()
  }
}

export function markFullIntroPlayed(now = new Date()) {
  try {
    localStorage.setItem(FULL_KEY, etDay(now))
  } catch {
    /* noop: the session mark below still stops a replay in this tab */
  }
  markIntroSeenThisSession()
}

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
