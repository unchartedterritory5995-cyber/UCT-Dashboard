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
//   close()       pops OUR pushed entry when we STILL occupy it; otherwise
//                 strips the params with replace (the deep-link-entry case,
//                 or the case below, where navigate(-1) would leave the app
//                 entirely or land on an unrelated entry).
//
// OWNERSHIP TRACKING (T11 review round 1, C2 — a plain boolean `pushedRef`
// cannot observe browser-driven traversal): a single `pushedRef.current=true`
// set once inside open() and cleared once inside close() is stale the moment
// ANY navigation happens that isn't ours — most concretely: open a shared
// link (no push — this is the FIRST entry) -> click a different ticker
// (push, "true") -> native Back (reopens the shared-link symbol; "true" is
// now a LIE, that entry was never pushed by us) -> click x -> close() still
// reads "true" and navigate(-1)s the user off the entry they arrived on,
// possibly off the app entirely. Fixed by tracking whether we still OWN the
// top-of-history entry, re-derived on every location change: `write()` flags
// the NEXT location-key change as "ours" (open/step/setSection/jumpToWeek all
// go through it); the effect below consumes that flag if present, and if a
// location-key change arrives WITHOUT the flag set, it can only be a
// browser-driven pop — ownership is lost. open() is the only place ownership
// is GRANTED (a push); step()/setSection()/jumpToWeek() (replace) preserve
// whatever ownership state already held, matching REPLACE's real semantics
// (same stack slot, not a new one).
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

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
  const location = useLocation()

  // Do we currently occupy a history entry WE pushed (open), with no
  // browser-driven traversal since? Re-derived on every location change —
  // see the OWNERSHIP TRACKING note above the imports.
  const weOwnRef = useRef(false)
  // Set right before any write() call; consumed by the location-key effect
  // so it can tell "this change is ours" from "this change is a pop".
  const initiatedRef = useRef(false)

  const routed = !!enabled && isRoutedPath(pathname)
  const sym = routed ? normalizeSym(params.get(EARNINGS_PARAM)) : null
  const section = routed ? (params.get(SECTION_PARAM) || null) : null

  const write = useCallback((patch, replace) => {
    initiatedRef.current = true
    setParams((prev) => mergeParams(prev, patch), { replace })
  }, [setParams])

  // Fires on EVERY location change, from ANY source. A change we initiated
  // (open/step/setSection/jumpToWeek, all routed through write()) consumes
  // the flag and leaves ownership untouched — replace-family calls don't
  // grant ownership, they preserve it, matching REPLACE's same-slot
  // semantics. A change that arrives with the flag NOT set can only be a
  // browser-driven pop (Back/Forward), which always costs ownership.
  useEffect(() => {
    if (initiatedRef.current) {
      initiatedRef.current = false
      return
    }
    weOwnRef.current = false
  }, [location.key])

  const open = useCallback((next) => {
    const v = normalizeSym(next)
    if (!routed || !v) return
    weOwnRef.current = true
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
    if (weOwnRef.current) {
      weOwnRef.current = false
      navigate(-1)
      return
    }
    write({ [EARNINGS_PARAM]: null, [SECTION_PARAM]: null }, true)
  }, [routed, navigate, write])

  // Minor (T11 review round 1): a fresh object literal every render gave
  // every consumer a new `route` identity even when nothing meaningful
  // changed — Calendar.jsx's `dismissModal` depends on `[route]`, so this
  // alone made `onClose` a new function every Calendar render, which made
  // the modal's Escape/arrow keydown effect unsubscribe and resubscribe on
  // every Calendar render (SSE ticks, live-price polls, ...) instead of only
  // when `routed`/`sym`/`section` actually changed. open/step/setSection/
  // jumpToWeek/close are already individually stable `useCallback`s, so this
  // memo is stable whenever the URL state itself hasn't changed.
  return useMemo(
    () => ({ routed, sym, section, open, step, setSection, jumpToWeek, close }),
    [routed, sym, section, open, step, setSection, jumpToWeek, close],
  )
}
