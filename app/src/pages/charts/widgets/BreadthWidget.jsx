/**
 * Breadth widget — the /breadth section's pulse, live on the /charts board.
 *
 * Reuses the Breadth page's REAL machinery: the HM_METRICS registry + 8-tier
 * colors (breadth/heatmapMetrics.js — extracted so this widget doesn't bundle
 * the whole Breadth page) and the page's SVG view components (Rings / Meters /
 * Tug / Radar / Scoreboard / Equalizer / Timeline). The Heatmap view is a
 * lightweight DOM tile grid built here (the page's echarts treemap is too heavy
 * + too chrome-y for a widget slot). Same tier logic everywhere, so the widget
 * and the page can never disagree on what "bullish" looks like.
 *
 * Per-widget VIEW choice persists through the workspace layout save path
 * (opts.view — same mechanism as FundamentalsWidget). Appearance (canvas, text,
 * view palette/intensity) is a global ⚙ settings pref (breadth_widget_settings)
 * that rides layout templates like every other widget-settings blob.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import useMobileSWR from '../../../hooks/useMobileSWR'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { menuThemeVars } from '../../../utils/dividerColor'
import UIcon from '../../../components/ui/UIcon'
import {
  HM_METRICS, FFILL_KEYS, PCTILE_KEYS, TIER_SCORES, TIER_TIP_COLORS, TIER_CELL_COLORS,
} from '../../breadth/heatmapMetrics'
import { normalizeMetric, pickSignals } from '../../breadth/views/breadthViewShared'
import { resolveDefaultVisible, optionDefaults } from '../../breadth/views/viewMetricConfig'
import RingsView from '../../breadth/views/RingsView'
import MetersView from '../../breadth/views/MetersView'
import TugView from '../../breadth/views/TugView'
import RadarView from '../../breadth/views/RadarView'
import ScoreboardView from '../../breadth/views/ScoreboardView'
import EqualizerView from '../../breadth/views/EqualizerView'
import TimelineView from '../../breadth/views/TimelineView'
import BreadthSettingsPanel from './BreadthSettingsPanel'
import {
  BREADTH_WIDGET_SETTINGS_KEY, BREADTH_WIDGET_DEFAULTS, mergeBreadthWidgetSettings, breadthDefaultsForTheme,
  breadthWidgetStyleVars, customBreadthColors, isLightCanvas,
  LIGHT_TIER_CELL_COLORS, LIGHT_TIER_TIP_COLORS,
} from './breadthWidgetSettings'
import styles from './BreadthWidget.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())

// View registry for the widget's pill bar. 'heatmap' is widget-local (DOM tile
// grid below); the rest reuse the Breadth page's view components. The style key
// for the reused views matches viewMetricConfig STYLES so resolveDefaultVisible/
// optionDefaults resolve their curated per-view metric sets.
const WIDGET_VIEWS = [
  { key: 'heatmap',    label: 'Heatmap', styleKey: 'treemap' },   // treemap's eligible universe
  { key: 'rings',      label: 'Rings',   styleKey: 'rings',      Comp: RingsView },
  { key: 'meters',     label: 'Meters',  styleKey: 'meters',     Comp: MetersView },
  { key: 'tug',        label: 'Tug',     styleKey: 'tug',        Comp: TugView },
  { key: 'radar',      label: 'Radar',   styleKey: 'radar',      Comp: RadarView },
  { key: 'scoreboard', label: 'Board',   styleKey: 'scoreboard', Comp: ScoreboardView },
  { key: 'equalizer',  label: 'EQ',      styleKey: 'equalizer',  Comp: EqualizerView },
  { key: 'timeline',   label: 'Pulse',   styleKey: 'timeline',   Comp: TimelineView },
]
const VIEW_KEYS = new Set(WIDGET_VIEWS.map(v => v.key))

const ALL_METRICS = HM_METRICS.filter(m => !m.isHeader)

// Heatmap group display order (matches the page's board order).
const HEATMAP_GROUPS = ['Score', 'Primary', 'MA', 'Regime', 'Highs/Lows', 'Sentiment']
const GROUP_LABELS = {
  Score: 'Score', Primary: 'Primary Breadth', MA: 'MA Breadth',
  Regime: 'Regime', 'Highs/Lows': 'Highs / Lows', Sentiment: 'Sentiment',
}

// ── Heatmap view (widget-local): grouped 8-tier tile grid ──────────────────
// The page's treemap look, rebuilt as a plain CSS grid: dark tier fill + bright
// tier value — reads perfectly at widget size and costs zero chart libraries.
function HeatmapView({ currentRow, onDrill, cellColors = TIER_CELL_COLORS, tipColors = TIER_TIP_COLORS, textColor = null }) {
  return (
    <div className={styles.hmWrap}>
      {HEATMAP_GROUPS.map(g => {
        const metrics = ALL_METRICS.filter(m => m.group === g)
        if (!metrics.length) return null
        return (
          <div key={g} className={styles.hmGroup}>
            <div className={styles.hmGroupLabel}>{GROUP_LABELS[g] || g}</div>
            <div className={styles.hmGrid}>
              {metrics.map(m => {
                const tier = m.getTier(currentRow)
                const score = TIER_SCORES[tier]
                return (
                  <button
                    key={m.key}
                    type="button"
                    className={styles.hmTile}
                    style={{ background: cellColors[tier] ?? cellColors[''] }}
                    onClick={() => onDrill(m)}
                    title={`${m.label} — open Breadth`}
                  >
                    <span className={styles.hmTileLabel}>{m.label}</span>
                    {/* A custom ⚙ Readings color paints the values (owner ask) —
                        the tile fill still carries the tier; unset keeps the
                        bright tier-colored numbers. */}
                    <span className={styles.hmTileVal} style={{ color: textColor || (score != null ? tipColors[score] : 'var(--bw-text-dim, #8b8674)') }}>
                      {m.getFmt(currentRow)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function BreadthWidget({ opts, onOptsChange }) {
  const navigate = useNavigate()

  // ── Appearance settings (⚙ panel) — mirrors the other widget settings ──
  const { prefs, setPref } = usePreferences()
  // Uncustomized (no saved pref) → DEFAULTS FOR THE CURRENT APP THEME (light → white
  // canvas + dark header/value text), so the ⚙ swatches and the surface follow the
  // site theme (the heat-map tiles keep their own colors).
  const bwSettings = useMemo(
    () => mergeBreadthWidgetSettings(parsePref(prefs?.[BREADTH_WIDGET_SETTINGS_KEY], null) ?? breadthDefaultsForTheme(prefs?.theme)),
    [prefs],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback((patch) => {
    setPref(BREADTH_WIDGET_SETTINGS_KEY, JSON.stringify({ ...bwSettings, ...patch }))
  }, [bwSettings, setPref])
  const resetSettings = useCallback(() => {
    setPref(BREADTH_WIDGET_SETTINGS_KEY, JSON.stringify(breadthDefaultsForTheme(prefs?.theme)))
  }, [setPref, prefs])
  const bwStyle = useMemo(() => breadthWidgetStyleVars(bwSettings), [bwSettings])
  const bwMenuVars = useMemo(() => {
    const canvas = bwSettings.bgMode === 'gradient' ? (bwSettings.bgGradient?.top || bwSettings.bg) : bwSettings.bg
    return menuThemeVars(canvas) || {}
  }, [bwSettings])

  // ── View choice — per-widget, persisted via workspace opts ──
  const view = VIEW_KEYS.has(opts?.view) ? opts.view : 'heatmap'
  const setView = useCallback((next) => {
    if (next === (opts?.view || 'heatmap')) return
    onOptsChange?.({ ...(opts || {}), view: next })
  }, [opts, onOptsChange])

  // ── Data — same endpoint the Breadth page reads; 90 sessions covers the
  // percentile windows + timeline/scoreboard history. 5-min refresh (the
  // backend snapshot is daily; intraday patches land via the monitor page).
  const { data } = useMobileSWR('/api/breadth-monitor?days=90', fetcher, {
    refreshInterval: 300_000,
    dedupingInterval: 60_000,
    revalidateOnFocus: false,
  })
  const rows = useMemo(() => data?.rows ?? [], [data])

  // Forward-fill the weekly/sparse sentiment keys (same as BreadthViews).
  const filledRows = useMemo(() => {
    const asc = [...rows].reverse()
    const carry = {}
    const result = []
    for (const row of asc) {
      const filled = { ...row }
      for (const k of FFILL_KEYS) {
        if (filled[k] == null && carry[k] != null) filled[k] = carry[k]
        else if (filled[k] != null) carry[k] = filled[k]
      }
      result.push(filled)
    }
    return result.reverse()
  }, [rows])

  const currentRow = filledRows[0]
  const prevRow = filledRows[3]
  const recentRows = useMemo(() => filledRows.slice(0, 30), [filledRows])

  const pctileByKey = useMemo(() => {
    const out = {}
    for (const k of PCTILE_KEYS) {
      const vals = rows.map(r => r[k]).filter(v => v != null && !isNaN(Number(v)))
      if (vals.length > 1) out[k] = vals.map(Number).sort((a, b) => a - b)
    }
    return out
  }, [rows])

  const normalize = useMemo(
    () => (metric, row) => normalizeMetric(metric, row, pctileByKey),
    [pctileByKey],
  )

  const active = WIDGET_VIEWS.find(v => v.key === view) || WIDGET_VIEWS[0]

  // Curated per-view default metric set (the page's smart defaults).
  const metrics = useMemo(() => {
    const visible = resolveDefaultVisible(active.styleKey, ALL_METRICS)
    return ALL_METRICS.filter(m => visible.has(m.key))
  }, [active.styleKey])

  // Signal of the Day + notable divergence — same picker the page uses. The
  // strip UI was dropped (owner: reclaim the vertical space), but the keys still
  // flow to the views so they can star/pulse the standout metric inline.
  const signals = useMemo(
    () => (currentRow ? pickSignals(metrics, currentRow, prevRow, pctileByKey) : { signalKey: null, notableKey: null }),
    [metrics, currentRow, prevRow, pctileByKey],
  )

  // Widget drills open the full Breadth section (the widget has no drill modal).
  const drill = useCallback(() => navigate('/breadth'), [navigate])

  // Custom up/down direction colors (⚙): when both are set, all three tier
  // color systems rebuild from those two hues (null = follow the named palette).
  // A LIGHT canvas flips the heatmap tiles to soft tints with dark ink — the
  // dark near-black tiles read as heavy ink blocks on white.
  const lightCanvas = useMemo(() => isLightCanvas(bwSettings), [bwSettings])
  const custom = useMemo(() => customBreadthColors(bwSettings, lightCanvas), [bwSettings, lightCanvas])

  // View options: the view's own defaults + the ⚙ palette/intensity choice.
  // A custom up/down pair overrides the named palette (object palette —
  // resolveViewColors accepts it).
  const viewOptions = useMemo(() => ({
    ...optionDefaults(active.styleKey),
    palette: custom ? custom.viewPalette : bwSettings.palette,
    intensity: bwSettings.intensity,
  }), [active.styleKey, bwSettings.palette, bwSettings.intensity, custom])

  const common = {
    currentRow, prevRow, recentRows, metrics, normalize, onDrill: drill,
    signalKey: signals.signalKey, notableKey: signals.notableKey, options: viewOptions,
  }

  return (
    <div ref={rootRef} className={styles.root} style={bwStyle}>
      {settingsOpen && (
        <BreadthSettingsPanel
          settings={bwSettings}
          onChange={patchSettings}
          onReset={resetSettings}
          onClose={() => setSettingsOpen(false)}
          gearEl={settingsBtnRef.current}
          hostEl={rootRef.current}
          themeVars={bwMenuVars}
        />
      )}

      {/* View pills + date + gear */}
      <div className={styles.bar}>
        {WIDGET_VIEWS.map(v => (
          <button
            key={v.key}
            type="button"
            className={`${styles.pill}${view === v.key ? ' ' + styles.pillOn : ''}`}
            onClick={() => setView(v.key)}
          >{v.label}</button>
        ))}
        {currentRow?.date && <span className={styles.asOf}>{currentRow.date}</span>}
        <button
          ref={settingsBtnRef}
          type="button"
          className={`${styles.gearBtn}${settingsOpen ? ' ' + styles.gearBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)}
          title="Breadth widget settings"
        ><UIcon name="gear" size={13} /></button>
      </div>

      {!currentRow && (
        <div className={styles.hint}>{data ? 'No breadth data yet.' : 'Loading breadth…'}</div>
      )}

      {currentRow && (
        <div className={styles.viewArea}>
          {view === 'heatmap'
            ? <HeatmapView
                currentRow={currentRow} onDrill={drill}
                cellColors={custom ? custom.cellColors : (lightCanvas ? LIGHT_TIER_CELL_COLORS : TIER_CELL_COLORS)}
                tipColors={custom ? custom.tipColors : (lightCanvas ? LIGHT_TIER_TIP_COLORS : TIER_TIP_COLORS)}
                textColor={bwSettings.valueColor || null}
              />
            : <active.Comp {...common} />}
        </div>
      )}
    </div>
  )
}
