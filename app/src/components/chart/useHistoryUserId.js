// app/src/components/chart/useHistoryUserId.js
//
// ⭐ A1.2 — the signed-in member's id, for scoping the indicator Undo stack
// (`indicatorHistoryStore`), read WITHOUT `useAuth()` (which throws outside a provider).
//
// ⛔ A REAL CONTEXT OR NOTHING. Many component tests replace `context/AuthContext` with a
// partial mock; a named import the mock does not define would throw at module load. So the
// export is read defensively and used only when it is a genuine React context — otherwise
// the hook answers `null` ("no member"), which keeps every stack in the anonymous scope.

import { createContext, useContext } from 'react'
import * as Auth from '../../context/AuthContext'

const NONE = createContext(null)
let AuthCtx = NONE
try {
  const c = Auth.AuthContext
  if (c && typeof c === 'object' && c.$$typeof) AuthCtx = c
} catch { AuthCtx = NONE }

export default function useHistoryUserId() {
  const v = useContext(AuthCtx)
  return (v && v.user && v.user.id) ?? null
}
