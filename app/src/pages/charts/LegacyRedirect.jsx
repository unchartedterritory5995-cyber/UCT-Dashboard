import { Navigate, useLocation } from 'react-router-dom'

/**
 * V2: /charts has no sub-tabs. Legacy URLs (/theme-tracker, /watchlists,
 * /multi-chart) redirect to bare /charts, dropping any ?tab= param and
 * preserving all other query params.
 */
export default function LegacyRedirect() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  params.delete('tab')
  const qs = params.toString()
  return <Navigate to={qs ? `/charts?${qs}` : '/charts'} replace />
}
