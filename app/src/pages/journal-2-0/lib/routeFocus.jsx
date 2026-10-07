/**
 * Finish program, lane KEYS: where keyboard focus lands after an in-app navigation, for the
 * Journal and Notebook routes only (`/journal/**` through JournalLayout, `/journal-2-0/**`
 * through the pages that mount <RouteFocusTarget/> themselves). The rest of the app is not
 * touched.
 *
 * The defect (docs/notebook/fin-clicks.md): after a route change focus stayed on a control
 * that no longer made sense, or fell to <body>, so a keyboard member was back at "Skip to main
 * content" on every page.
 *
 * The fix is the standard one. A focusable, named target (tabIndex -1, visually hidden, its
 * text is the page title) sits directly before the page. When the PATH changes by an in-app
 * navigation, focus moves to it. A screen reader reads its text once, on focus: that is the
 * announcement, so there is no second live region saying the same thing. The next Tab is the
 * page's first control.
 *
 * Focus is left alone when something else owns it:
 *   - a fresh page load (`location.key === 'default'`): the shell's skip link stays first;
 *   - Back / Forward (`POP`): the browser restores the member's place;
 *   - a query-only or hash-only change: opening a note, a segment, a filter, a skip link;
 *   - a modal dialog is open (a tour step, a sheet, a page that opens its own dialog);
 *   - something took focus itself between the navigation and the next frame (a page that
 *     focuses its own field);
 *   - the caller passed `state: { keepFocus: true }`.
 *
 * `focus({ preventScroll: true })`: the router decides where the page is scrolled.
 * No dependency beyond react-router, which the layout already imports.
 */
import { useEffect, useRef } from 'react'
import { useLocation, useNavigationType } from 'react-router-dom'

const HIDDEN = {
  position: 'absolute', width: 1, height: 1, margin: -1, padding: 0, border: 0,
  overflow: 'hidden', clip: 'rect(0 0 0 0)', clipPath: 'inset(50%)', whiteSpace: 'nowrap',
  outline: 'none',
}

const TITLES = [
  [/^\/journal\/?$/, () => 'Today'],
  [/^\/journal\/trades/, () => 'Trades'],
  [/^\/journal\/calendar/, () => 'Calendar'],
  [/^\/journal\/notebook\/setups/, () => 'Active setups'],
  [/^\/journal\/notebook\/research\/([^/]+)/, (m) => `${decodeURIComponent(m[1]).toUpperCase()} research`],
  [/^\/journal\/notebook/, () => 'Notebook'],
  [/^\/journal\/insights/, () => 'Insights'],
  [/^\/journal\/compass/, () => 'Compass'],
  [/^\/journal\/community/, () => 'Community'],
  [/^\/journal\/accounts/, () => 'Accounts'],
  // the standalone Journal pages (outside JournalLayout)
  [/^\/journal-2-0\/position\/([^/]+)/, (m) => `${decodeURIComponent(m[1]).toUpperCase()} position`],
  [/^\/journal-2-0\/trade\//, () => 'Trade'],
  [/^\/journal-2-0\/playbook/, () => 'My Playbook'],
  [/^\/journal-2-0\/calendar\/([^/]+)/, (m) => `Day ${decodeURIComponent(m[1])}`],
  [/^\/journal-2-0\/report/, () => 'Report'],
]

/** The page title for a Journal path: the target's text, so what a screen reader reads. */
export function journalPageTitle(pathname) {
  for (const [re, name] of TITLES) {
    const m = re.exec(pathname || '')
    if (m) return name(m)
  }
  return 'Trade Journal'
}

const modalOpen = () => typeof document !== 'undefined'
  && document.querySelector('[role="dialog"][aria-modal="true"]') != null

/**
 * Moves focus to `ref.current` when the path changes by an in-app navigation. Mounting counts
 * as an arrival (a standalone page, or the layout entered from elsewhere in the app).
 */
export function useRouteFocus(ref) {
  const location = useLocation()
  const navType = useNavigationType()
  const lastPath = useRef(null)

  useEffect(() => {
    const prev = lastPath.current
    lastPath.current = location.pathname
    if (prev === location.pathname) return undefined        // query-only or hash-only
    if (location.key === 'default') return undefined        // a fresh page load
    if (navType === 'POP') return undefined                 // Back / Forward
    if (location.state && location.state.keepFocus) return undefined
    const before = document.activeElement
    if (before && before.closest && before.closest('[role="dialog"]')) return undefined
    if (modalOpen()) return undefined
    let raf = 0
    raf = requestAnimationFrame(() => {
      const el = ref.current
      if (!el || !el.isConnected || modalOpen()) return
      const now = document.activeElement
      // Something took focus for itself since the navigation: it owns it.
      if (now && now !== document.body && now !== before) return
      el.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(raf)
  }, [location.pathname, location.key, location.state, navType, ref])
}

/** The target itself. `title` defaults to the Journal page title for the current path. */
export default function RouteFocusTarget({ title }) {
  const ref = useRef(null)
  const { pathname } = useLocation()
  useRouteFocus(ref)
  return (
    <span ref={ref} tabIndex={-1} data-route-focus="" style={HIDDEN}>
      {title || journalPageTitle(pathname)}
    </span>
  )
}
