// TERM-038 (2026-10-01): ONE way for a page to honour a URL "door".
//
// A door is a query param that tells a page to open something: `/charts?openLayout=12`,
// `/community?thread=41`, `/screener?savedScreen=7`, `/ai-search?thread=t-9`. The Ctrl/Cmd+K
// palette opens a saved thing by navigating to its door. Each page used to read its door
// ONCE, at mount, so a member already on `/charts` who picked a layout in the palette saw
// the URL change and nothing open. This hook re-reads the door on every router location
// change, applies it, and strips it.
//
//   useDoorParam(name, apply, { ready })
//
//   - `apply(value)` runs once per router location (keyed on `location.key`) that carries
//     the param, after `ready` is true. The latest `apply` is always the one called (read
//     through a ref), so it can close over fresh state without re-triggering the door.
//   - The param is stripped BEFORE `apply` runs, with `replace`, so the stripped entry has
//     a new key and no param: the effect runs once more, finds nothing, and stops (H14:
//     at most two passes per pick, never a loop). A re-pick of the same address is a new
//     `navigate()` with a new key, so it applies again; back/forward lands on entries that
//     were already stripped, so they re-open nothing.
//   - While `ready` is false the param is left alone (a page that is dark or still loading
//     neither applies nor eats the instruction).
//   - The value is not validated here; each door validates its own id form inside `apply`.
//
// Works outside a router (the standalone floor2.html entry): it then reads and strips
// `window.location` once per mount, the old behaviour.
//
// Where the param is READ: from the router's live location when it carries the param,
// else from `window.location`. Under the app's BrowserRouter they are the same URL. They
// differ only in tests that render under a MemoryRouter and set the window URL by hand,
// which is how the mount-time door tests were written; both keep working.
import { createContext, useContext, useEffect, useRef } from 'react'
import * as RouterDom from 'react-router-dom'

// Read the router's contexts without requiring them: ~60 test files mock
// 'react-router-dom' with only `useNavigate`, and a vitest mock THROWS on a missing
// export, so a named import would break every page that uses a door under such a mock.
// With no router context the hook falls back to window.location (as outside a router).
const NO_ROUTER = createContext(null)
function routerContext(name) {
  try { return RouterDom[name] || NO_ROUTER } catch { return NO_ROUTER }
}
const LocationContext = routerContext('UNSAFE_LocationContext')
const NavigationContext = routerContext('UNSAFE_NavigationContext')

function without(search, name) {
  const p = new URLSearchParams(search)
  p.delete(name)
  const q = p.toString()
  return q ? `?${q}` : ''
}

export default function useDoorParam(name, apply, { ready = true } = {}) {
  const locCtx = useContext(LocationContext)
  const navCtx = useContext(NavigationContext)
  const location = locCtx?.location || null
  const navigator = navCtx?.navigator || null

  const applyRef = useRef(apply)
  applyRef.current = apply
  const handledKeyRef = useRef(null)

  const trigger = location ? `${location.key}` : 'no-router'
  const routerSearch = location ? location.search : ''

  useEffect(() => {
    if (!ready) return
    // The history object's own location is live (it is the URL right now, after any
    // strip earlier in this same commit); the rendered `location` may be one step behind.
    const live = (navigator && navigator.location) || location
    const routerHas = !!live && new URLSearchParams(live.search).has(name)
    const winSearch = typeof window !== 'undefined' ? window.location.search : ''
    const value = (routerHas ? new URLSearchParams(live.search).get(name) : null)
      ?? new URLSearchParams(winSearch).get(name)
    if (!value) return
    if (handledKeyRef.current === trigger) return
    handledKeyRef.current = trigger

    try {
      if (routerHas && navigator?.replace) {
        navigator.replace(
          { pathname: live.pathname, search: without(live.search, name), hash: live.hash || '' },
          live.state ?? null,
        )
      }
      if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has(name)) {
        window.history.replaceState(
          window.history.state, '',
          `${window.location.pathname}${without(window.location.search, name)}${window.location.hash || ''}`,
        )
      }
    } catch { /* history unavailable — a lingering param is harmless */ }

    applyRef.current(value)
    // `location`/`navigator` are read live above; the door re-fires on a new key only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger, routerSearch, ready, name])
}
