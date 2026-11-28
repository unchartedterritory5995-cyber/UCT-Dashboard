import { useState } from 'react'
import ChartThemesModal from '../../../components/chart/ChartThemesModal'
import { mapThemeToWidgetSettings, themeWithAppSurface } from '../../../components/chart/chartThemes'
import { useWorkspace } from '../WorkspaceContext'
import { useWidgetLook } from '../widgetLookContext'
import Switch from '../../../components/ui/Switch'

// Shared "🎨 UCT Themes" entry for a NON-chart widget's ⚙ settings panel — the same
// gallery the chart widget uses, so every widget can pick from the full UCT themes
// collection. Picking a theme at "This widget" scope maps it onto THIS widget's
// settings (via mapThemeToWidgetSettings) and hands the result back through onSettings;
// at "All widgets" scope it re-themes every widget in the layout via the workspace.
//
// Host panel wires:
//   widgetType      — the widget's registry type (nhnl, watchlist, breadth, …), so the
//                     theme maps to the keys this widget understands.
//   currentSettings — the widget's current settings blob (per-widget opts.settings, or
//                     the global-pref blob for theme-tracker/fundamentals/breadth/aisearch).
//   onSettings      — called with the mapped settings for "This widget"; the host writes
//                     it back the way it stores settings (onOptsChange / setPref).
export default function WidgetThemeSection({
  widgetType,
  currentSettings = null,
  onSettings,
  themeVars = null,
  buttonClass,
  buttonLabel = '🎨 UCT Themes',
}) {
  const [open, setOpen] = useState(false)
  const ws = useWorkspace()
  const look = useWidgetLook()
  const applyAll = ws?.applyThemeToAllWidgets || null
  const boardMatches = !!ws?.matchChart?.on

  const handleApply = (theme, scope) => {
    if (scope === 'allwidgets' && applyAll) { applyAll(theme); return }
    // A theme picked for THIS widget alone is its own look: it steps out of the chart link.
    if (boardMatches && look && !look.ownLook) look.setOwnLook(true)
    // 'one' = this widget only. An app-mirrored theme uses the app surface as canvas.
    onSettings?.(mapThemeToWidgetSettings(currentSettings || {}, themeWithAppSurface(theme), widgetType))
  }

  return (
    <>
      <button type="button" className={buttonClass} onClick={() => setOpen(true)}>{buttonLabel}</button>
      <ChartThemesModal
        open={open}
        variant="widget"
        onClose={() => setOpen(false)}
        onApply={handleApply}
        canApplyAllWidgets={!!applyAll}
        currentSettings={currentSettings}
        themeVars={themeVars}
      />
    </>
  )
}


// "Widgets match the chart" (owner 11-27): two switch rows for a widget's ⚙ panel, drawn
// with the panel's OWN Row so they sit in its grid. The board-wide link (every widget wears
// the chart's background, gradient and up/down colours, and follows it as it changes), then
// this widget's own place in it. Nothing off the Charts workspace or on a chart widget.
export function MatchChartRows({ Row, styles = {} }) {
  const ws = useWorkspace()
  const look = useWidgetLook()
  if (typeof ws?.setMatchChart !== 'function' || !look || look.type === 'chart' || !Row) return null
  const boardOn = !!ws.matchChart?.on
  const thisOn = boardOn && !look.ownLook
  const sw = { className: styles.toggle, checkedClassName: styles.toggleOn, knobClassName: styles.knob }
  return (
    <>
      <Row label="Match the chart" hint="every widget">
        <Switch checked={boardOn} onClick={() => ws.setMatchChart(!boardOn)}
          title="Every widget on this board wears the chart's background, gradient and up/down colours, and follows the chart when you change it"
          aria-label="All widgets match the chart" {...sw} />
      </Row>
      {boardOn && (
        <Row label="This widget" hint="matches the chart">
          <Switch checked={thisOn} onClick={() => look.setOwnLook(thisOn)}
            title="Turn off to give this widget its own look. Changing this widget's colours turns it off for you"
            aria-label="This widget matches the chart" {...sw} />
        </Row>
      )}
    </>
  )
}
