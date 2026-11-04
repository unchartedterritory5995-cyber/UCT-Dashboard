// ── UCT Agent APP-LEVEL HOST: the context and the page hook (W2-C1) ─────────────────────────────────────
//
// Split from AgentProvider.jsx so that file exports components only (fast refresh). AgentProvider owns the
// value; pages call `useAgentPageHost`; capability hooks read `useAgentApp`.

import { createContext, useContext, useEffect } from 'react'

export const AgentContext = createContext(null)

/** The provider's value, or null outside one (tests, pop-outs, the phone app). */
export const useAgentApp = () => useContext(AgentContext)

/**
 * A page hands the provider its host. `host` must be STABLE (build it once with useMemo and read live
 * state through refs — host.js's own rule); `surface` is the registry's name for the page ('screener',
 * 'breadth', 'calendar', 'journal', 'charts'). `owned`: the page renders its own panel (/charts).
 * No-op outside a provider.
 */
export function useAgentPageHost(surface, host, { owned = false } = {}) {
  const app = useContext(AgentContext)
  const register = app?.registerPage
  useEffect(() => {
    if (!register || !host || !surface) return undefined
    return register({ surface, host, owned })
  }, [register, surface, host, owned])
}
