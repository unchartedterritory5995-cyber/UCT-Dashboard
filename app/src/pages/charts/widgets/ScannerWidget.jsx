import { useCallback } from 'react'
import ScannerPicker from './ScannerPicker'
import ScannerResults from './ScannerResults'

// The Scanner widget: open a scan (e.g. "Highest Volume (1-Year)") and load its
// live results into a watchlist-style table. No scan chosen → the picker (preset
// scans + a disabled "create your own"); a scan chosen → its results.
//
// Per-widget appearance lives in `opts.settings` (a watchlist-settings blob), so
// each scanner owns its canvas/colors/text — same isolation as the watchlist/chart
// widgets. `opts.scanKey`/`scanName` remember the selected scan.
export default function ScannerWidget({ color, opts, onOptsChange }) {
  const scanKey = opts?.scanKey || null
  const settingsOverride = opts?.settings || null
  const persistSettings = useCallback(
    (next) => onOptsChange?.({ ...(opts || {}), settings: next }),
    [opts, onOptsChange],
  )
  const pickScan = useCallback(
    (sel) => onOptsChange?.({ ...(opts || {}), scanKey: sel?.key || null, scanName: sel?.name || null }),
    [opts, onOptsChange],
  )
  const exitScan = useCallback(
    () => onOptsChange?.({ ...(opts || {}), scanKey: null, scanName: null }),
    [opts, onOptsChange],
  )

  if (!scanKey) {
    return (
      <ScannerPicker
        onPick={pickScan}
        settingsOverride={settingsOverride}
        onSettingsPersist={persistSettings}
      />
    )
  }
  return (
    <ScannerResults
      scanKey={scanKey}
      scanName={opts?.scanName}
      color={color}
      settingsOverride={settingsOverride}
      onSettingsPersist={persistSettings}
      onExit={exitScan}
    />
  )
}
