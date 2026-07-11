/**
 * Insights surface — renders the existing Analytics tab, which already hosts
 * the P3 InsightsHub sub-nav + ScopeBar. Thin wrapper (no grouping); the
 * surface exists so `/journal/insights` resolves under the new shell.
 */

import AnalyticsTab from '../tabs/AnalyticsTab'

export default function InsightsSurface() {
  return <AnalyticsTab />
}
