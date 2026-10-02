import { useAuth } from '../../context/AuthContext'

/**
 * COV-10: may list widgets subscribe to a colour group's list source (frozen or tracking)?
 * Dark behind CHARTS_LIST_SUBSCRIBE_ENABLED, carried on the auth payload.
 *
 * Read from auth by each widget, NOT carried on the workspace context. A workspace member
 * must be mirrored by every provider that hosts these widgets (the breadth drill, the
 * Notebook's frozen capture), and the Notebook's file is not this workstream's to edit
 * (hub/rule12Paths).
 *
 * `useAuth` throws only when no AuthProvider is mounted (isolated component tests; the app
 * root always mounts one). That reads as OFF, the dark default, so the failure direction is
 * the feature staying hidden, never an unreleased surface appearing.
 */
export default function useListSubscribeEnabled() {
  let auth = null
  try { auth = useAuth() } catch { auth = null }
  return auth?.chartsListSubscribeEnabled === true
}
