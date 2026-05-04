import { useLocation } from 'react-router-dom'
import ErrorBoundary from './ErrorBoundary'
import AppErrorFallback from './AppErrorFallback'

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
      fallback={<AppErrorFallback />}
    >
      {children}
    </ErrorBoundary>
  )
}
