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
import UIcon from '../../../components/ui/UIcon'
import WatchlistSettingsPanel from '../../watchlist/WatchlistSettingsPanel'
import {
  WATCHLIST_DEFAULTS, mergeWatchlistSettings, watchlistStyleVars, watchlistDefaultsForTheme,
} from '../../watchlist/watchlistSettings'
import { menuThemeVars } from '../../../utils/dividerColor'
import styles from './WatchlistPicker.module.css'
import sc from './ScannerPicker.module.css'

// Preset scans. Each entry { key, name, description }; `key` maps to a scan
// endpoint in ScannerResults. Picking one loads its live results.
const PRESET_SCANS = [
  {
    key: 'highest-volume-1y',
    name: 'Highest Volume In 1-Year (HV1)',
    description: 'Trading their highest volume in a year',
  },
  {
    key: 'highest-volume-ever',
    name: 'Highest Volume Ever (HVE)',
    description: 'Trading their highest volume ever',
  },
  {
    key: 'ipo-1y',
    name: 'IPO in Last 1-Year',
    description: 'First traded within the last year',
  },
]

export default function ScannerPicker({ onPick, settingsOverride = null, onSettingsPersist = null }) {
  // Match the widget's own watchlist appearance (canvas / colors) + expose the
  // SAME ⚙ settings panel a picked scan's table will use, so the landing page is
  // styled and configurable exactly like the results view that follows it. No
  // saved override → DEFAULTS FOR THE CURRENT APP THEME (white on light).
  const { prefs } = usePreferences()
  const wlSettings = useMemo(
    () => mergeWatchlistSettings(settingsOverride ?? watchlistDefaultsForTheme(prefs?.theme)),
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
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <div className={styles.title}>Add a Scanner</div>
          {onSettingsPersist && (
            <button
              ref={setGearEl}
              type="button"
              className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
              onClick={() => setSettingsOpen(o => !o)}
              title="Scanner settings"
              aria-label="Scanner settings"
            ><UIcon name="gear" size={13} /></button>
          )}
        </div>

        <div className={styles.searchWrap}>
          <UIcon name="search" size={13} gold={false} />
          <input
            className={styles.search}
            placeholder="Search scans…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
      </div>

      <div className={styles.body}>
        {/* Create your own — disabled until the custom scan-builder ships. */}
        <button
          type="button"
          className={`${styles.newBtn} ${sc.createDisabled}`}
          disabled
          title="Custom scan builder — coming soon"
        >
          <UIcon name="plus" size={14} gold={false} />
          <span>Create your own scan</span>
          <span className={sc.soon}>Soon</span>
        </button>

        {/* Preset scanners */}
        <div className={sc.sectionLabel}>Preset Scanners</div>
        {presets.length === 0 ? (
          <div className={styles.empty}>{query ? 'No matches.' : 'No preset scans yet.'}</div>
        ) : presets.map(s => (
          <button key={s.key} type="button" className={styles.row} onClick={() => onPick?.({ key: s.key, name: s.name })}>
            <span className={styles.rowIcon}><UIcon name="search" size={13} gold={false} /></span>
            <span className={styles.rowName}>{s.name}</span>
            {s.description && <span className={styles.rowMeta}>{s.description}</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
