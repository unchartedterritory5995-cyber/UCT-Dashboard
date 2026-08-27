// app/src/pages/charts/widgets/ScannerPicker.jsx
//
// The "pick a scan" landing menu shown when a Scanner widget is first added (no
// scan chosen yet). Mirrors WatchlistPicker's look + settings so the scanner is
// styled and configurable exactly like the watchlist table it shares — same
// canvas/text/tint controls (WatchlistSettingsPanel), same theme-adaptation
// (white-on-light / black-on-OLED). Two ways in:
//   • PRESET SCANNERS — curated scans (e.g. "Relative Strength Leaders")
//   • CREATE YOUR OWN — disabled until the custom scan-builder ships
// Preset scans are intentionally EMPTY for now (the widget shell only).
import { useState, useCallback, useMemo } from 'react'
import usePreferences from '../../../hooks/usePreferences'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import UIcon from '../../../components/ui/UIcon'
import WatchlistSettingsPanel from '../../watchlist/WatchlistSettingsPanel'
import PickerHeader from './PickerHeader'
import {
  WATCHLIST_DEFAULTS, mergeWatchlistSettings, watchlistStyleVars, watchlistDefaultsForTheme,
} from '../../watchlist/watchlistSettings'
import { menuThemeVars } from '../../../utils/dividerColor'
import styles from './WatchlistPicker.module.css'

// Same three tabs as the Watchlist picker so the two are laid out identically. The
// scan builder + shared scans aren't live yet, so Community / My Scans show a
// coming-soon state; Prebuilt carries the curated PRESET_SCANS.
const SCANNER_TABS = [
  { key: 'prebuilt', label: 'Prebuilt' },
  { key: 'community', label: 'Community' },
  { key: 'mine', label: 'My Scans' },
]

// Preset scans. Each entry { key, name, description }; `key` maps to a scan
// endpoint in ScannerResults. Picking one loads its live results.
//
// ⚠️ EXPORTED SO A TEST CAN READ A LABEL RATHER THAN RETYPE ONE. `6e974ef7`
// renamed two of these and left `ScannerWidget.test.jsx` asserting the old
// string, which went red on master. `name` is display copy and will be renamed
// again; `key` is the wire contract with `/api/scans/<key>` and must NOT move
// silently, so tests derive the name from here and keep the key typed.
export const PRESET_SCANS = [
  {
    key: 'highest-volume-1y',
    name: 'Highest Volume In 1-Year',
    description: 'Trading their highest volume in a year',
  },
  {
    key: 'highest-volume-ever',
    name: 'Highest Volume Ever',
    description: 'Trading their highest volume ever',
  },
  {
    key: 'ipo-1y',
    name: 'IPO in Last 1-Year',
    description: 'First traded within the last year',
  },
  {
    key: 'top-gainers-30d',
    name: 'Top Gainers (30-Day)',
    description: 'Top 5% by 30-day gain',
  },
  {
    key: 'top-gainers-60d',
    name: 'Top Gainers (60-Day)',
    description: 'Top 5% by 60-day gain',
  },
  {
    key: 'top-gainers-90d',
    name: 'Top Gainers (90-Day)',
    description: 'Top 5% by 90-day gain',
  },
]

export default function ScannerPicker({ onPick, settingsOverride = null, onSettingsPersist = null }) {
  // Match the widget's own watchlist appearance (canvas / colors) + expose the
  // SAME ⚙ settings panel a picked scan's table will use, so the landing page is
  // styled and configurable exactly like the results view that follows it. No
  // saved override → DEFAULTS FOR THE CURRENT APP THEME (white on light).
  const { prefs } = usePreferences()
  const placedTheme = usePlacedTheme()
  const wlSettings = useMemo(
    () => mergeWatchlistSettings(settingsOverride ?? watchlistDefaultsForTheme(placedTheme)),
    [settingsOverride, prefs],
  )
  const wlStyle = useMemo(() => watchlistStyleVars(wlSettings), [wlSettings])
  const menuVars = useMemo(() => {
    const canvas = wlSettings.bgMode === 'gradient' ? (wlSettings.bgGradient?.top || wlSettings.bg) : wlSettings.bg
    return menuThemeVars(canvas) || {}
  }, [wlSettings])
  const [settingsOpen, setSettingsOpen] = useState(false)
  // Callback-ref state for the popover anchors (the gear button + the picker root),
  // so the settings panel gets the real DOM elements without reading ref.current
  // during render.
  const [gearEl, setGearEl] = useState(null)
  const [rootEl, setRootEl] = useState(null)
  const patchSettings = useCallback((patch) => onSettingsPersist?.({ ...wlSettings, ...patch }), [wlSettings, onSettingsPersist])
  const resetSettings = useCallback(() => onSettingsPersist?.({ ...WATCHLIST_DEFAULTS }), [onSettingsPersist])

  const [q, setQ] = useState('')
  const [tab, setTab] = useState('prebuilt')   // presets live under Prebuilt
  const query = q.trim().toLowerCase()
  const presets = PRESET_SCANS.filter(s => !query || String(s.name).toLowerCase().includes(query))

  return (
    <div className={styles.picker} ref={setRootEl} style={wlStyle}>
      {settingsOpen && onSettingsPersist && (
        <WatchlistSettingsPanel
          settings={wlSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={gearEl}
          hostEl={rootEl}
          themeVars={menuVars}
        />
      )}
      <PickerHeader
        tabs={SCANNER_TABS}
        tab={tab}
        onTab={setTab}
        query={q}
        onQuery={setQ}
        searchPlaceholder="Search scans…"
        onNew={() => {}}
        newTitle="Custom scan builder — coming soon"
        newDisabled
        newHint="Soon"
        showSettings={!!onSettingsPersist}
        settingsOpen={settingsOpen}
        onToggleSettings={() => setSettingsOpen(o => !o)}
        settingsTitle="Scanner settings"
        gearRef={setGearEl}
      />

      <div className={styles.body}>
        {/* ── Prebuilt: the curated preset scans ── */}
        {tab === 'prebuilt' && (
          presets.length === 0 ? (
            <div className={styles.empty}>{query ? 'No matches.' : 'No preset scans yet.'}</div>
          ) : presets.map(s => (
            <button key={s.key} type="button" className={styles.row} onClick={() => onPick?.({ key: s.key, name: s.name })}>
              <span className={styles.rowIcon}><UIcon name="search" size={13} gold={false} /></span>
              <span className={styles.rowName}>{s.name}</span>
              {s.description && <span className={styles.rowMeta}>{s.description}</span>}
            </button>
          ))
        )}

        {/* ── Community: shared scans (not live yet) ── */}
        {tab === 'community' && (
          <div className={styles.emptyWrap}>
            <UIcon name="community" size={22} gold />
            <div className={styles.emptyTitle}>Community scans</div>
            <div className={styles.emptyText}>Shared scans from the community are coming soon.</div>
          </div>
        )}

        {/* ── My Scans: the custom scan builder (coming soon) ── */}
        {tab === 'mine' && (
          <div className={styles.emptyWrap}>
            <UIcon name="library" size={22} gold />
            <div className={styles.emptyTitle}>Your scans</div>
            <div className={styles.emptyText}>Build and save your own scans — the scan builder is coming soon.</div>
          </div>
        )}
      </div>
    </div>
  )
}
