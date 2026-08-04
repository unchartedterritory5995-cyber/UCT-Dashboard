// app/src/pages/calendar/useEarningsModalRoute.js
//
// URL state for the earnings modal (spec §4.4).
//
// BANNED HERE: raw `window.history.pushState`. Calendar.jsx already owns
// `?week` and `?d` through React Router's `useSearchParams` (Calendar.jsx:88);
// a bare pushState desyncs the router's copy of the query and the next
// router-driven write silently reinstates the params it thought were current.
// Every write below goes through `mergeParams`, which copies the CURRENT
// params and applies a patch, so unrelated keys always survive.
//
// HISTORY SEMANTICS (normative):
//   open()        PUSH    — one history entry, so Back closes in one press
//   step()        REPLACE — stepping a 40-name day must not bury the exit
//   setSection()  REPLACE — same reason
//   jumpToWeek()  REPLACE — part of resolving a deep link, not a user step
//   close()       pops OUR pushed entry when we pushed one; otherwise strips
//                 the params with replace (the deep-link-entry case, where
//                 there is no entry of ours to pop and navigate(-1) would
//                 leave the app entirely).
import { useCallback, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

export const EARNINGS_PARAM = 'earnings'
export const SECTION_PARAM = 'esection'
export const WEEK_PARAM = 'week'

// §4.4: the param is honored on these two surfaces ONLY. CatalystFlow is
// deliberately absent — the Dashboard mounts two live instances (desktop +
// mobile trees) and its rows come from today's wire list, so a URL-driven open
// there is both double-rendering and unresolvable.
export const ROUTED_PATHS = ['/calendar', '/calendar/mystocks']

export function isRoutedPath(pathname) {
  const p = (pathname || '').replace(/\/+$/, '') || '/'
  return ROUTED_PATHS.includes(p)
}

/** Pure. Copies `current`, applies `patch` (null/'' deletes), returns a NEW
 *  URLSearchParams. Never mutates its input. */
export function mergeParams(current, patch) {
  const next = new URLSearchParams(current)
  for (const [k, v] of Object.entries(patch || {})) {
    if (v == null || v === '') next.delete(k)
    else next.set(k, String(v))
  }
  return next
}

/** Uppercased ticker, or null. A URL is user input: an unvalidated value would
 *  reach fetch paths and section headings. */
export function normalizeSym(raw) {
  const s = (typeof raw === 'string' ? raw : '').toUpperCase().trim()
  return /^[A-Z][A-Z.-]{0,6}$/.test(s) ? s : null
}

const SESSIONS = ['bmo', 'amc', 'tbd']

/** Pure lookup of a symbol in a loaded calendar week. */
export function resolveFeedEntry(sym, days) {
  const want = normalizeSym(sym)
  if (!want || !days) return null
  for (const [ds, day] of Object.entries(days)) {
    for (const timing of SESSIONS) {
      const entry = (day?.[timing] || []).find(
        (e) => (e?.sym || '').toUpperCase() === want,
      )
      if (entry) return { entry, ds, timing }
    }
  }
  return null
}

export default function useEarningsModalRoute({ enabled = true, pathname = '' } = {}) {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  // Tracks whether THIS hook instance pushed the entry currently on the stack.
  const pushedRef = useRef(false)

  const routed = !!enabled && isRoutedPath(pathname)
  const sym = routed ? normalizeSym(params.get(EARNINGS_PARAM)) : null
  const section = routed ? (params.get(SECTION_PARAM) || null) : null

  const write = useCallback((patch, replace) => {
    setParams((prev) => mergeParams(prev, patch), { replace })
  }, [setParams])

  const open = useCallback((next) => {
    const v = normalizeSym(next)
    if (!routed || !v) return
    pushedRef.current = true
    // Clear any section carried over from the previous symbol — a section id
    // is only meaningful for the symbol it was chosen on.
    write({ [EARNINGS_PARAM]: v, [SECTION_PARAM]: null }, false)
  }, [routed, write])

  const step = useCallback((next) => {
    const v = normalizeSym(next)
    if (!routed || !v) return
    write({ [EARNINGS_PARAM]: v }, true)
  }, [routed, write])

  const setSection = useCallback((id) => {
    if (!routed) return
    write({ [SECTION_PARAM]: id || null }, true)
  }, [routed, write])

  const jumpToWeek = useCallback((monday) => {
    if (!routed || !monday) return
    write({ [WEEK_PARAM]: monday }, true)
  }, [routed, write])

  const close = useCallback(() => {
    if (!routed) return
    if (pushedRef.current) {
      pushedRef.current = false
      navigate(-1)
      return
    }
    write({ [EARNINGS_PARAM]: null, [SECTION_PARAM]: null }, true)
  }, [routed, navigate, write])

  return { routed, sym, section, open, step, setSection, jumpToWeek, close }
}
