import { useState, useSyncExternalStore } from 'react'
import { useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import AppErrorFallback from './AppErrorFallback'
import { recoverFromStaleChunk } from '../utils/staleChunk'
import { subscribePopouts, hasOpenPopouts } from '../lib/popoutRegistry'

// React's ErrorBoundary doesn't reset state on its own. Without this wrapper,
// once a render error is caught the user sees the fallback forever — even
// after navigating to a different route. Keying the boundary by
// useLocation().pathname forces a remount on route change, which clears
// the error state.
//
// ⛔ THAT KEY REMOUNTS THE WHOLE SHELL ON EVERY NAVIGATION (AuthGuard, Layout, the page), because
// this boundary sits above <Routes>. While a pop-out window is open the shell must stay mounted, or
// the board on the other monitor dies with it, so the key stands still for as long as a window is
// open. With no window open it is exactly the pathname, as it has always been. After the last
// window closes the key stays until the next navigation, so the close does not remount the page
// the member is reading.
//
// A held key can equal the path the member goes back to, so the key alone cannot be what clears an
// error screen. `resetKey` is: any change of pathname clears a caught error, and does nothing at all
// to a healthy tree (ErrorBoundary only acts on it while it is showing its fallback).
function useBoundaryKey() {
  const { pathname } = useLocation()
  const windowOpen = useSyncExternalStore(subscribePopouts, hasOpenPopouts)
  const [held, setHeld] = useState(null)
  let key = pathname
  let next = null
  if (windowOpen) {
    key = held ? held.key : pathname
    next = { key, lastPath: pathname }
  } else if (held && held.lastPath === pathname) {
    key = held.key
    next = held
  }
  // Adjusted during render, compared by value, so it settles in one pass.
  if (next?.key !== held?.key || next?.lastPath !== held?.lastPath) setHeld(next)
  return key
}

export default function RouteErrorBoundary({ children }) {
  const key = useBoundaryKey()
  const { pathname } = useLocation()
  return (
    <ErrorBoundary
      key={key}
      resetKey={pathname}
      // A deploy that lands while a tab is open deletes the chunk filenames
      // that tab still believes in, so a lazy import 404s and lands here on an
      // app that is perfectly healthy. Reload once instead of blaming the page;
      // anything else, or a second failure, shows the error as before.
      onError={recoverFromStaleChunk}
      fallback={<AppErrorFallback />}
    >
      {children}
    </ErrorBoundary>
  )
}
