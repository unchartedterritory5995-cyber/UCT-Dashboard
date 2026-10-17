// app/src/components/chart/autoStructuresGate.js — who may see the Auto Structures layer.
//
// ONE predicate for both doors (the toolbar toggle and StockChart's fetch), so they can never
// disagree: an ADMIN, while the server reports `auto_structures_enabled` (AUTO_STRUCTURES_ENABLED,
// read per request and carried on the auth payload ONLY for admins while on). Members get false
// whatever the flag says — their toolbar stays exactly as before until a later member flip.
//
// Reads AuthContext with useContext, never useAuth(): a chart renders on surfaces with no
// AuthProvider (bot renderers, tests) and useAuth() throws there. No provider = not enabled.
import { useContext } from 'react'
import { AuthContext } from '../../context/AuthContext'

export function autoStructuresAllowed(auth) {
  return !!auth && auth.user?.role === 'admin' && auth.autoStructuresEnabled === true
}

export function useAutoStructuresGate() {
  return autoStructuresAllowed(useContext(AuthContext))
}
