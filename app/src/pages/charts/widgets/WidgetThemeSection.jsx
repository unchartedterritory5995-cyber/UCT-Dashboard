import { useState } from 'react'
import ChartThemesModal from '../../../components/chart/ChartThemesModal'
import { mapThemeToWidgetSettings } from '../../../components/chart/chartThemes'
import { useWorkspace } from '../WorkspaceContext'

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
  const applyAll = ws?.applyThemeToAllWidgets || null

  const handleApply = (theme, scope) => {
    if (scope === 'allwidgets' && applyAll) { applyAll(theme); return }
    // 'one' = this widget only.
    onSettings?.(mapThemeToWidgetSettings(currentSettings || {}, theme, widgetType))
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
