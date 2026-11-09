// app/src/components/DeskUsageReporter.jsx
//
// Null-rendering leaf, mounted at the app root beside <LogoPrewarm />. Acts only for a
// resolved, signed-in member (nothing fires for a stranger on a public page). Holds its
// own state in useDeskUsage and reads primitives only; see that file for what is sent.
import { useAuth } from '../context/AuthContext'
import useDeskUsage from '../hooks/useDeskUsage'

export default function DeskUsageReporter() {
  const { user, loading } = useAuth()
  useDeskUsage(!loading && user ? user.id : null)
  return null
}
