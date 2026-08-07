import { useCallback } from 'react'
import ScannerPicker from './ScannerPicker'

// The Scanner widget: open a scan (e.g. "Relative Strength Leaders") and load its
// results into the SAME watchlist-style table — identical columns, tint/weight,
// resize-drag, column presets, and ⚙ settings (it reuses the watchlist machinery).
//
// For now the widget is the PICKER SHELL: a "Preset Scanners" section (empty until
// we add scans) and a disabled "Create your own scan" (until the custom scan-builder
// lands). Per-widget appearance lives in `opts.settings` (a watchlist-settings blob),
// so each scanner owns its canvas/colors/text and one widget's look never touches
// another — same isolation model as the watchlist and chart widgets.
export default function ScannerWidget({ opts, onOptsChange }) {
  const settingsOverride = opts?.settings || null
  const persistSettings = useCallback(
    (next) => onOptsChange?.({ ...(opts || {}), settings: next }),
    [opts, onOptsChange],
  )
  // Picking a scan persists a `scanKey` into the widget's opts. No preset scans
  // exist yet, so this stays on the picker; once scans land, a chosen scan will
  // render the watchlist-style results table here (Watchlists embedded).
  const pickScan = useCallback(
    (sel) => onOptsChange?.({ ...(opts || {}), scanKey: sel?.key || null, scanName: sel?.name || null }),
    [opts, onOptsChange],
  )

  return (
    <ScannerPicker
      onPick={pickScan}
      settingsOverride={settingsOverride}
      onSettingsPersist={persistSettings}
    />
  )
}
