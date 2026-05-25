import { createContext, useContext } from 'react'

export const WorkspaceContext = createContext(null)

const FALLBACK = {
  groupSyms: { A: null, B: null, C: null, D: null },
  setGroupSym: () => {},
}

export function useWorkspace() {
  return useContext(WorkspaceContext) || FALLBACK
}
