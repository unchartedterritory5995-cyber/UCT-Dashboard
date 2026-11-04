// ── UCT Agent APP-LEVEL HOST (W2-C1, 2026-11-03): one provider, one panel, a host per page ─────────────
//
// Mounted ONCE in App.jsx (inside the router and the auth provider). It owns:
//   • the render gate — the same two keys as /charts: the per-browser `uct.feature.agent` switch AND the
//     admin role (agentFlag.js; every /api/agent/* route is admin-only on the server whatever this says).
//     Dark for everyone else: nothing renders, nothing is fetched.
//   • the OPEN state (`uct.agent.open`, the key /charts already keeps, so the panel stays open across pages)
//   • the PAGE HOST the current page registered (`useAgentPageHost(surface, host)`): what the Agent can
//     read and write HERE, through that page's own hooks and writers. A page that registers nothing has
//     no Agent on it.
//   • the dock on every page that is NOT /charts: a fixed right-hand column holding the ordinary AgentPanel
//     (the same conversation, restored from the server by its id). /charts keeps today's mount untouched —
//     ChartsWorkspace renders its own AgentDock + AgentPanel and registers its host as `owned`, so this
//     provider renders no second panel there.
//   • a HANDOFF slot (W2-C3): conversation state one page leaves for the next (a pending plan that must
//     run on /charts after "open the top three on charts"). React state at the app level, so it survives
//     the route change that unmounts the page's panel; taken once, never persisted.
//
// ⛔ The provider has no capability of its own, no DOM control and no writer: a page's host is the only
// way a change reaches that page, and the registry's `surfaces` decides what is offered on it.

import { Suspense, lazy, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { useInRouterContext } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useAgentFlag, AGENT_OPEN_KEY, AGENT_OPEN_EVENT, readLocal, writeLocal } from './agentFlag'
import { readAgentWidth } from './agentWidth'
import AgentNavBridge from './AgentNavBridge'
import ErrorBoundary from '../components/ErrorBoundary'
import { AgentContext } from './agentApp'
import styles from './AgentPanel.module.css'

const loadAgentPanel = () => import('./AgentPanel')
const AgentPanel = lazy(loadAgentPanel)

// The dock on a page that is not /charts: a fixed column at the right edge, the member's own Agent width
// (agentWidth.js — the width they chose on /charts). It overlays the page rather than re-tiling it: these
// pages have no grid to re-measure, and the Agent is admin-dark here.
function AgentPageDock({ host, surface, request, onClose }) {
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

export default function AgentProvider({ children }) {
  const auth = useAuth()
  const flag = useAgentFlag()
  const allowed = flag && auth?.user?.role === 'admin'
  const inRouter = useInRouterContext()
  const [page, setPage] = useState(null)             // { surface, host, owned } | null
  const [open, setOpenState] = useState(() => readLocal(AGENT_OPEN_KEY) === '1')
  const setOpen = useCallback((v) => { setOpenState(!!v); writeLocal(AGENT_OPEN_KEY, v ? '1' : '0') }, [])
  // Pages come and go; the key is the one source of "open" (ChartsWorkspace writes it too), re-read on
  // every page change so an Agent opened on /charts is open on /screener and the other way round
  // (derived during render — AgentDock's own "adjust state when a prop changes" pattern, no effect).
  const [seenPage, setSeenPage] = useState(page)
  if (seenPage !== page) {
    setSeenPage(page)
    setOpenState(readLocal(AGENT_OPEN_KEY) === '1')
  }
  const registerPage = useCallback((p) => {
    setPage(p)
    return () => setPage(cur => (cur === p ? null : cur))
  }, [])
  const navRef = useRef(null)
  // W2-C3 handoff: set by the page that leaves, taken once by the panel that lands.
  const handoffRef = useRef(null)
  const handoff = useMemo(() => ({
    set: (v) => { handoffRef.current = v && typeof v === 'object' ? { ...v, at: Date.now() } : null },
    peek: () => handoffRef.current,
    take: () => { const v = handoffRef.current; handoffRef.current = null; return v },
  }), [])
  // Warm the panel's code once the Agent may show here (as /charts does), so the first open is instant.
  useEffect(() => {
    if (!allowed || !page || page.owned) return undefined
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500))
    const cancel = window.cancelIdleCallback || clearTimeout
    const id = idle(() => { loadAgentPanel().catch(() => {}) })
    return () => cancel(id)
  }, [allowed, page])
  // UCT News "Continue in UCT Agent" (agent/newsAsk.openAgent) on a page with a host of its own.
  const [request, setRequest] = useState(null)
  const seq = useRef(0)
  useEffect(() => {
    if (!allowed || !page || page.owned) return undefined
    const onOpen = (e) => {
      const conversationId = e?.detail?.conversationId
      if (typeof conversationId !== 'string' || !conversationId) return
      setOpen(true)
      setRequest({ id: ++seq.current, kind: 'conversation', conversationId })
    }
    window.addEventListener(AGENT_OPEN_EVENT, onOpen)
    return () => window.removeEventListener(AGENT_OPEN_EVENT, onOpen)
  }, [allowed, page, setOpen])

  const value = useMemo(() => ({
    allowed, open, setOpen, page, surface: page?.surface || null, registerPage, handoff,
    navigate: (to) => navRef.current?.(to),
  }), [allowed, open, setOpen, page, registerPage, handoff])
  const showDock = allowed && open && page && !page.owned
  return (
    <AgentContext.Provider value={value}>
      {children}
      {showDock && <AgentPageDock host={page.host} surface={page.surface} request={request} onClose={() => setOpen(false)} />}
      {allowed && page && !page.owned && inRouter && <AgentNavBridge navRef={navRef} />}
    </AgentContext.Provider>
  )
}

/**
 * The "UCT Agent" button a page puts in its header — the same gate and look as the /charts toolbar
 * button (data-testid agent-launch). Renders nothing unless the Agent may show on THIS page: admin +
 * switch, and the page registered a host it does not render itself.
 */
export function AgentDockButton({ className = '', style = null }) {
  const app = useContext(AgentContext)
  if (!app?.allowed || !app.page || app.page.owned) return null
  return (
    <button
      type="button"
      className={`${styles.launch} ${className}`.trim()}
      style={{ ...(app.open ? { color: 'var(--ut-gold, #c9a84c)' } : null), ...(style || {}) }}
      aria-pressed={app.open}
      data-testid="agent-launch"
      onClick={() => app.setOpen(!app.open)}
    >UCT Agent</button>
  )
}
