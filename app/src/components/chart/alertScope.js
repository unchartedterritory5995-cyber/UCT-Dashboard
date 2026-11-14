// The id an indicator alert's "Only on this chart" scope names (Phase C Task 12): the chart surface's persisted id — a
// /charts widget's id, `${widgetId}:${tabId}` for one of its extra chart tabs, or a Multi Chart cell's id. ONE definition,
// read by ChartWidget (the id it hands IndicatorAlertPopover, which sends it as `scope`) and by UCT Agent's
// indicatorAlert.create (agent/capabilities/indicatorAlerts.js), so the Agent scopes an alert to exactly the chart the
// popover would. null = no chart identity: the alert stays GLOBAL (what an omitted scope has always meant server-side).
export function alertScopeId(chartId, tabId = null) {
  if (!chartId) return null
  return tabId ? `${chartId}:${tabId}` : String(chartId)
}
