// app/src/components/chart/chartIq/chartIqGate.js — who may switch Chart IQ on.
//
// ONE predicate for both doors (the toolbar button and StockChart's fetch). The server decides: `chart_iq_enabled` rides the
// auth payload only while CHART_IQ_ENABLED is on for an admin, or CHART_IQ_MEMBERS_ENABLED is also on for a paid member
// (api/routers/auth.py::_chart_iq_flag, the same predicates the route asks). Reads AuthContext with useContext, never
// useAuth(): a chart renders on surfaces with no AuthProvider (bot renderers, tests), where it is simply not enabled.
import { useContext } from 'react'
import { AuthContext } from '../../../context/AuthContext'

export function chartIqAllowed(auth) {
  return !!auth && !!auth.user && auth.chartIqEnabled === true
}

export function useChartIqAllowed() {
  return chartIqAllowed(useContext(AuthContext))
}
