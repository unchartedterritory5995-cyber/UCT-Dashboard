// Read-only results table for a selected preset scan. Live-polls the scan endpoint
// and renders qualifiers in a watchlist-style table (colors/canvas/text via the
// shared watchlist settings vars). Clicking a row publishes the ticker to this
// widget's color group so a paired chart follows.
import { useMemo, useState, useCallback } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'
import usePreferences from '../../../hooks/usePreferences'
import { useWorkspace } from '../WorkspaceContext'
import UIcon from '../../../components/ui/UIcon'
import CompanyLogo from '../../../components/CompanyLogo'
import WatchlistSettingsPanel from '../../watchlist/WatchlistSettingsPanel'
import {
  WATCHLIST_DEFAULTS, mergeWatchlistSettings, watchlistStyleVars, watchlistDefaultsForTheme,
} from '../../watchlist/watchlistSettings'
import { menuThemeVars } from '../../../utils/dividerColor'
import styles from './ScannerResults.module.css'

const fetcher = url => fetch(url, { credentials: 'include' }).then(r => (r.ok ? r.json() : null)).catch(() => null)

// scanKey → endpoint. New presets add a line here + one in ScannerPicker's PRESET_SCANS.
const SCAN_ENDPOINTS = {
  'highest-volume-1y': '/api/scans/highest-volume-1y',
}

function fmtVol(v) {
  if (v == null) return '—'
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(0) + 'K'
  return String(v)
}

export default function ScannerResults({ scanKey, scanName, color, settingsOverride = null, onSettingsPersist = null, onExit }) {
  const { prefs } = usePreferences()
  const { setGroupSym } = useWorkspace() || {}
  const wlSettings = useMemo(
    () => mergeWatchlistSettings(settingsOverride ?? watchlistDefaultsForTheme(prefs?.theme)),
    [settingsOverride, prefs],
  )
  const wlStyle = useMemo(() => watchlistStyleVars(wlSettings), [wlSettings])
  const showLogos = wlSettings.showLogos !== false
  const menuVars = useMemo(() => {
    const canvas = wlSettings.bgMode === 'gradient' ? (wlSettings.bgGradient?.top || wlSettings.bg) : wlSettings.bg
    return menuThemeVars(canvas) || {}
  }, [wlSettings])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [gearEl, setGearEl] = useState(null)
  const [rootEl, setRootEl] = useState(null)
  const patchSettings = useCallback((patch) => onSettingsPersist?.({ ...wlSettings, ...patch }), [wlSettings, onSettingsPersist])
  const resetSettings = useCallback(() => onSettingsPersist?.({ ...WATCHLIST_DEFAULTS }), [onSettingsPersist])

  const url = SCAN_ENDPOINTS[scanKey] || null
  // Live all day: poll every 30s (the server recomputes at most ~once/min).
  const { data } = useMobileSWR(url, fetcher, {
    refreshInterval: 30_000,
    dedupingInterval: 15_000,
    revalidateOnFocus: false,
  })
  const results = data?.results || []
  const computing = data?.status === 'computing'

  const onRow = useCallback((sym) => { if (setGroupSym && color) setGroupSym(color, sym) }, [setGroupSym, color])

  return (
    <div className={styles.root} ref={setRootEl} style={wlStyle}>
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
        <button type="button" className={styles.back} onClick={onExit} title="Back to scanners">‹ Scanners</button>
        <div className={styles.title}>{scanName || 'Scan'}</div>
        {url && !computing && <div className={styles.count}>{results.length}</div>}
        <button
          type="button"
          ref={setGearEl}
          className={styles.gearBtn}
          onClick={() => setSettingsOpen(o => !o)}
          title="Scanner settings"
          aria-label="Scanner settings"
        ><UIcon name="gear" size={13} /></button>
      </div>

      {!url ? (
        <div className={styles.msg}>Unknown scan.</div>
      ) : (
        <>
          <div className={styles.colHead}>
            <span className={styles.cSym}>Symbol</span>
            <span className={styles.cNum}>Price</span>
            <span className={styles.cNum}>% Chg</span>
            <span className={styles.cNum}>Volume</span>
            <span className={styles.cNum}>× 1Y</span>
          </div>
          <div className={styles.body}>
            {!data ? (
              <div className={styles.msg}>Loading…</div>
            ) : computing ? (
              <div className={styles.msg}>Building the 1-year volume baseline…<br />This takes a few seconds the first time.</div>
            ) : results.length === 0 ? (
              <div className={styles.msg}>No stocks at a 1-year volume high yet today.<br />The list fills in as volume builds through the session.</div>
            ) : results.map(r => {
              const up = (r.change_pct ?? 0) >= 0
              return (
                <button key={r.sym} type="button" className={styles.row} onClick={() => onRow(r.sym)} title={`Prior 1Y high: ${fmtVol(r.ref_max)}`}>
                  <span className={styles.cSym}>
                    {showLogos && <span className={styles.logo}><CompanyLogo sym={r.sym} size={16} round /></span>}
                    <span className={styles.sym}>{r.sym}</span>
                  </span>
                  <span className={styles.cNum}>{r.price != null ? Number(r.price).toFixed(2) : '—'}</span>
                  <span className={`${styles.cNum} ${up ? styles.up : styles.down}`}>
                    {r.change_pct != null ? `${up ? '+' : ''}${r.change_pct.toFixed(2)}%` : '—'}
                  </span>
                  <span className={styles.cNum}>{fmtVol(r.volume)}</span>
                  <span className={`${styles.cNum} ${styles.ratio}`}>{r.ratio != null ? `${r.ratio.toFixed(2)}×` : '—'}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
