import { Navigate, useLocation } from 'react-router-dom'

export default function LegacyRedirect({ tab }) {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  params.delete('tab')  // we always overwrite with the canonical tab
  params.set('tab', tab)
  // Put tab first; URLSearchParams.set after delete appends, so rebuild:
  const merged = new URLSearchParams()
  merged.set('tab', tab)
  for (const [k, v] of params) {
    if (k !== 'tab') merged.append(k, v)
  }
  return <Navigate to={`/charts?${merged.toString()}`} replace />
}
