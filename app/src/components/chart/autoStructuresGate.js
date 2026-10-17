// app/src/components/chart/autoStructuresGate.js — who may see the Auto Structures layer, and how much.
//
// ONE predicate for both doors (the toolbar toggle and StockChart's fetch), so they can never
// disagree. It answers a SCOPE:
//   'all'     — an ADMIN while the server reports `auto_structures_enabled` (AUTO_STRUCTURES_ENABLED,
//               read per request, carried on the auth payload ONLY for admins while on): every tier,
//               the Levels layer, base boxes and the learned drawer.
//   'trusted' — a PAID non-admin while the server reports `auto_structures_members_enabled`
//               (AUTO_STRUCTURES_MEMBERS_ENABLED + AUTO_STRUCTURES_ENABLED, carried only for a paid
//               member while both are on): the Patterns toggle only, trusted-tier rows only. The
//               server filters the rows itself; the client's trusted-only draw is a second layer,
//               never the authority.
//   null      — everyone else: no toggle, no fetch, exactly as before.
//
// Reads AuthContext with useContext, never useAuth(): a chart renders on surfaces with no
// AuthProvider (bot renderers, tests) and useAuth() throws there. No provider = not enabled.
import { useContext } from 'react'
import { AuthContext } from '../../context/AuthContext'

export function autoStructuresScope(auth) {
  if (!auth) return null
  if (auth.user?.role === 'admin') return auth.autoStructuresEnabled === true ? 'all' : null
  if (auth.user && auth.isPaid === true && auth.autoStructuresMembersEnabled === true) return 'trusted'
  return null
}

/** The ADMIN door only (scope 'all'). */
export function autoStructuresAllowed(auth) {
  return autoStructuresScope(auth) === 'all'
}

export function useAutoStructuresScope() {
  return autoStructuresScope(useContext(AuthContext))
}

export function useAutoStructuresGate() {
  return autoStructuresAllowed(useContext(AuthContext))
}
