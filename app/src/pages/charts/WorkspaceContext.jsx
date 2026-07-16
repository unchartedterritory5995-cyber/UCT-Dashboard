import { createContext, useContext } from 'react'

export const WorkspaceContext = createContext(null)

const FALLBACK = {
  groupSyms: { A: null, B: null, C: null, D: null },
  setGroupSym: () => {},
  crosshairBus: { emit: () => {}, subscribe: () => () => {} },
  // request(query) → delivers to any mounted AI Search widget; returns true if one
  // handled it (so the caller can fall back to a temporary popup when false).
  aiSearchBus: { subscribe: () => () => {}, request: () => false },
}

export function useWorkspace() {
  return useContext(WorkspaceContext) || FALLBACK
}
