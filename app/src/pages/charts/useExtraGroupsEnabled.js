import { useAuth } from '../../context/AuthContext'

/**
 * COV-10 remainder: may /charts offer colour groups E-H? Dark behind
 * CHARTS_EXTRA_GROUPS_ENABLED, carried on the auth payload.
 *
 * Read from auth (not the workspace context) for the same reason as
 * useListSubscribeEnabled: a workspace member would have to be mirrored by every
 * host of these widgets, including the Notebook's frozen capture, which is not this
 * workstream's file. No AuthProvider (isolated tests) reads as OFF, the dark default.
 */
export default function useExtraGroupsEnabled() {
  let auth = null
  try { auth = useAuth() } catch { auth = null }
  return auth?.chartsExtraGroupsEnabled === true
}
