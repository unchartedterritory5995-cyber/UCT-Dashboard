import { useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import AppErrorFallback from './AppErrorFallback'
import { recoverFromStaleChunk } from '../utils/staleChunk'

// React's ErrorBoundary doesn't reset state on its own. Without this wrapper,
// once a render error is caught the user sees the fallback forever — even
// after navigating to a different route. Keying the boundary by
// useLocation().pathname forces a remount on route change, which clears
// the error state.

export default function RouteErrorBoundary({ children }) {
  const { pathname } = useLocation()
  return (
    <ErrorBoundary
      key={pathname}
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
