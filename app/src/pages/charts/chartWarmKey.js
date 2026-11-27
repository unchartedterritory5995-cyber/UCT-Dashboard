// app/src/pages/charts/chartWarmKey.js — the bar-store key a chart widget will show, read from the board's own state, so a
// member's switch can ask whether that chart is WARM before mounting it (ChartsWorkspace warm admission).
//
// ⛔ THE SAME RULES AS ChartWidget (review of the warm admission, finding 4): the ACTIVE chart tab's timeframe and colour
// (sanitizeChartTabs), a suspended extra group or the unlinked colour 'N' read as cold (their symbol is not the group's),
// and extended hours as the canvas resolves them (utils/viewSession.resolveShowExtended on the tab's own settings over
// the account's). A wrong answer is safe one way only: "cold" keeps today's paced admission.
import { sanitizeChartTabs } from './chartTabs'
import { effectiveGroup, isSuspendedGroup } from './colorGroups'

/**
 * @param {object} tab        the widget's active widget-tab (widgetTabs.resolveActiveTab): { type, color, opts }
 * @param {object} groupSyms  the board's group symbols ({ A: 'AAPL', ... })
 * @param {object|null} accountCs  the account's chart settings (prefs chart_settings, parsed)
 * @param {boolean} extraGroupsOn
 * @returns {{ sym: string, tf: string, showExtended: boolean } | null}  null: not a chart, or no group symbol it shows
 */
export function chartWarmKey(tab, groupSyms, accountCs = null, extraGroupsOn = false) {
  if (!tab || tab.type !== 'chart') return null
  const opts = tab.opts || {}
  const { tabs, active } = sanitizeChartTabs(opts)
  const extra = active === 0 ? null : (tabs[active - 1] || null)
  const color = extra ? (extra.color || tab.color) : tab.color
  if (!color || effectiveGroup(color, extraGroupsOn) === 'N' || (extra?.color && isSuspendedGroup(extra.color, extraGroupsOn))) return null
  const sym = groupSyms?.[color]
  if (!sym) return null
  const tf = String((extra ? extra.tf : opts.tf) || 'D')
  const stored = (extra ? extra.settings : opts.settings) || null
  const ehs = stored?.extendedHoursShading ?? accountCs?.extendedHoursShading
  return { sym: String(sym), tf, showExtended: ehs ?? true }
}
