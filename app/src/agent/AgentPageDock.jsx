// The page dock (AgentProvider): its own lazy chunk, so the Notebook's first open does not carry it (it renders only
// once the Agent is open on a page that is not /charts).
import { Suspense, lazy } from 'react'
import { readAgentWidth } from './agentWidth'
import ErrorBoundary from '../components/ErrorBoundary'
import styles from './AgentPanel.module.css'

const AgentPanel = lazy(() => import('./AgentPanel'))

// The dock on a page that is not /charts: a fixed column at the right edge, the member's own Agent width
// (agentWidth.js — the width they chose on /charts). It overlays the page rather than re-tiling it: these
// pages have no grid to re-measure.
export default function AgentPageDock({ host, surface, request, onClose }) {
  const width = readAgentWidth()
  return (
    <div className={styles.pageDock} style={{ '--agent-w': `${width}px` }} data-testid="agent-page-dock" data-surface={surface}>
      {/* Its own boundary (review-728-741 #3): the dock renders OUTSIDE App.jsx's RouteErrorBoundary, so a
          panel crash would otherwise reach the top-level boundary and take the page down with it. Keyed by
          surface, so the next page gets a fresh panel. */}
      <ErrorBoundary key={surface} fallback={<AgentDockCrashed onClose={onClose} />}>
        <Suspense fallback={null}>
          <AgentPanel host={host} surface={surface} request={request} onClose={onClose} />
        </Suspense>
      </ErrorBoundary>
    </div>
  )
}

function AgentDockCrashed({ onClose }) {
  return (
    <div role="alert" data-testid="agent-page-dock-error" style={{ padding: 12, fontSize: 12, color: 'var(--text-muted)' }}>
      UCT Agent hit an error and stopped. The page is unaffected.{' '}
      <button type="button" onClick={onClose}>Close</button>
    </div>
  )
}
