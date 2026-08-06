import { useMemo, useState, useRef, useCallback } from 'react'
import Screener from '../../Screener'
import { ChartsSymContext } from '../ChartsSymContext'
import { useWorkspace } from '../WorkspaceContext'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import NewsSettingsPanel from './NewsSettingsPanel'
import { mergeBasicWidgetSettings, basicWidgetStyleVars, basicDefaultsForTheme } from './basicWidgetSettings'
import styles from './ScannerWidget.module.css'

const KEY = 'scanner_settings'

export default function ScannerWidget({ color }) {
  const { groupSyms, setGroupSym } = useWorkspace()
  // Scoped context: routes any wrapped useChartsSym calls into THIS
  // widget's color group, not Group A.
  const scopedSymContext = useMemo(() => ({
    sym: groupSyms[color],
    setSym: (s) => setGroupSym(color, s),
  }), [groupSyms, color, setGroupSym])

  // ── Basic appearance settings (⚙): canvas + text color. Uncustomized → the
  // DEFAULTS FOR THE CURRENT APP THEME (light → white canvas + dark text). ──
  const { prefs, setPref } = usePreferences()
  const settings = useMemo(
    () => mergeBasicWidgetSettings(parsePref(prefs?.[KEY], null) ?? basicDefaultsForTheme(prefs?.theme)),
    [prefs],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const gearRef = useRef(null)
  const rootRef = useRef(null)
  const rootStyle = useMemo(() => {
    const v = basicWidgetStyleVars(settings)
    return v['--basic-canvas'] ? { ...v, background: v['--basic-canvas'] } : v
  }, [settings])
  const patchSettings = useCallback((patch) => setPref(KEY, JSON.stringify({ ...settings, ...patch })), [settings, setPref])
  const resetSettings = useCallback(() => setPref(KEY, JSON.stringify(basicDefaultsForTheme(prefs?.theme))), [setPref, prefs])
  const menuVars = useMemo(() => {
    const canvas = settings.bgMode === 'gradient' ? (settings.bgGradient?.top || settings.bg) : settings.bg
    return menuThemeVars(canvas) || {}
  }, [settings])

  return (
    <div ref={rootRef} className={styles.root} style={rootStyle}>
      {settingsOpen && (
        <NewsSettingsPanel
          title="Scanner Settings"
          showPerf={false}
          settings={settings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={gearRef.current}
          hostEl={rootRef.current}
          themeVars={menuVars}
        />
      )}
      <button
        ref={gearRef}
        type="button"
        className={styles.gearBtn}
        onClick={() => setSettingsOpen(o => !o)}
        title="Scanner settings"
        aria-label="Scanner settings"
      ><UIcon name="gear" size={13} /></button>
      <ChartsSymContext.Provider value={scopedSymContext}>
        <Screener embedded />
      </ChartsSymContext.Provider>
    </div>
  )
}
