// app/src/hooks/useDeskUsage.js
//
// Desktop plan Stage 1, Task 9: measure how many members use more than one monitor and
// pop-out windows, so the desktop-app go/no-go rests on numbers. Reads PRIMITIVES only
// (no usePreferences) and is mounted by <DeskUsageReporter /> beside <LogoPrewarm />.
//
// WHAT IS SENT (POST /api/auth/desk-usage, four allow-listed fields, nothing else):
//   multi_monitor  'yes' | 'no' | 'unknown'   screen.isExtended; absent => 'unknown'
//   popout_opened  bool                       a pop-out was open at some point today
//   standalone     bool                       matchMedia('(display-mode: standalone)')
//   os             coarse family only         never the user-agent string
// No URL, ticker, widget content or UA string is ever read into the payload.
//
// WHEN: a report is sent on page-hide / tab-hidden, on the first pop-out, and (for a tab
// that never hides) shortly before ET midnight. The day is the ET calendar date, the same
// day the server dedupes on. At most ONE report per member per day, plus ONE upgrade if a
// pop-out opens after a report that said false (server keeps one row and flips
// popout_opened false -> true). A failed send is dropped and not retried before the next
// day: the day key is written BEFORE the request. LIMIT: a pop-out opened and closed in a
// tab that was closed before any later trigger still counts, because opening a pop-out
// sends at once; only a failed send loses a day.
import { useEffect } from 'react'
import { hasOpenPopouts, subscribePopouts } from '../lib/popoutRegistry'

export const DESK_USAGE_SENT_KEY = 'uct.deskUsage.sent'
export const DESK_USAGE_ENDPOINT = '/api/auth/desk-usage'
const REPORT_BEFORE_MIDNIGHT_MS = 10 * 60 * 1000

const ET = 'America/New_York'

function etParts(now) {
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: ET, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  const o = {}
  for (const p of f.formatToParts(now)) o[p.type] = p.value
  return o
}

export function etDay(now = new Date()) {
  const o = etParts(now)
  return `${o.year}-${o.month}-${o.day}`
}

/** Milliseconds from `now` until 23:50 ET (0 if already past it). */
export function msUntilReportTime(now = new Date()) {
  const o = etParts(now)
  const sinceMidnight = ((+o.hour * 60 + +o.minute) * 60 + +o.second) * 1000
  return Math.max(0, 24 * 3600 * 1000 - REPORT_BEFORE_MIDNIGHT_MS - sinceMidnight)
}

export function classifyOs(text) {
  const s = String(text || '')
  if (/android/i.test(s)) return 'android'
  if (/iphone|ipad|ipod/i.test(s)) return 'ios'
  if (/cros/i.test(s)) return 'chromeos'
  if (/win/i.test(s)) return 'windows'
  if (/mac/i.test(s)) return 'mac'
  if (/linux|x11/i.test(s)) return 'linux'
  return 'other'
}

export function readDeskUsage(popoutOpened) {
  let multi = 'unknown'
  try {
    if (typeof screen !== 'undefined' && typeof screen.isExtended === 'boolean') {
      multi = screen.isExtended ? 'yes' : 'no'
    }
  } catch { /* unknown */ }
  let standalone = false
  try { standalone = !!window.matchMedia?.('(display-mode: standalone)')?.matches } catch { /* false */ }
  let os = 'other'
  try {
    const nav = window.navigator || {}
    os = classifyOs(nav.userAgentData?.platform || nav.platform || nav.userAgent)
    if (os === 'other' && nav.userAgent) os = classifyOs(nav.userAgent)
  } catch { /* other */ }
  return { multi_monitor: multi, popout_opened: !!popoutOpened, standalone, os }
}

function readSent() {
  try { return localStorage.getItem(DESK_USAGE_SENT_KEY) || '' } catch { return '' }
}

function writeSent(v) {
  try { localStorage.setItem(DESK_USAGE_SENT_KEY, v) } catch { /* private mode: send again next trigger is harmless server-side */ }
}

export function useDeskUsage(uid) {
  useEffect(() => {
    if (!uid) return undefined
    let poppedDay = ''   // ET day on which a pop-out was seen open
    let visibleDay = ''  // ET day on which this tab was seen visible
    let timer = null

    const markVisible = () => {
      try { if (document.visibilityState === 'visible') visibleDay = etDay() } catch { /* ignore */ }
    }
    markVisible()

    const send = () => {
      try {
        const day = etDay()
        if (hasOpenPopouts()) poppedDay = day
        const popped = poppedDay === day
        const state = `${uid}|${day}|${popped ? 'p1' : 'p0'}`
        const last = readSent()
        // already reported today, and nothing new to say
        if (last === state || last === `${uid}|${day}|p1`) return
        writeSent(state)  // written BEFORE the request: a failure is not retried today
        fetch(DESK_USAGE_ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          keepalive: true,
          body: JSON.stringify(readDeskUsage(popped)),
        }).catch(() => {})
      } catch { /* never throws into the app */ }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') send()
      else markVisible()
    }
    // The 23:50 timer is for a tab that never hides. A tab left idle and hidden overnight was not used
    // that day, so it files nothing; one that was visible at some point that ET day still does.
    const sendFromTimer = () => {
      markVisible()
      if (visibleDay === etDay()) send()
    }
    const arm = () => {
      const ms = msUntilReportTime()
      const wait = Number.isFinite(ms) ? Math.max(ms, 60 * 1000) : 60 * 60 * 1000
      timer = setTimeout(() => { sendFromTimer(); arm() }, wait)
    }
    const unsub = subscribePopouts(() => { if (hasOpenPopouts()) send() })
    if (hasOpenPopouts()) send()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', send)
    arm()
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', send)
      try { unsub?.() } catch { /* ignore */ }
    }
  }, [uid])
}

export default useDeskUsage
