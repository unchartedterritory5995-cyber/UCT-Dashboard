/**
 * Breadth widget — the /breadth Monitor's pulse, live on the /charts board.
 *
 * A single HEATMAP of the breadth readings (the page's HM_METRICS registry +
 * 8-tier colors from breadth/heatmapMetrics.js), grouped Score / Primary / MA /
 * Regime / Highs-Lows / Sentiment. Real-time: the stored history (/api/breadth-
 * monitor) with today's LIVE intraday row (useLiveBreadth) laid on top, exactly
 * like the Breadth section. The footer's refresh re-pulls BOTH.
 *
 * Per-widget customization (persists through the workspace layout save path,
 * opts.hiddenMetrics): hover a tile → an ✕ removes that reading (survivors FLIP-
 * slide to fill); the ＋ menu (grouped, checkmarked) adds/removes any reading.
 * Appearance (canvas/text/palette) stays the global ⚙ pref (breadth_widget_settings).
 */
import { useCallback, useMemo, useRef, useState, useEffect, useLayoutEffect } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { mutate as globalMutate } from 'swr'
import useMobileSWR from '../../../hooks/useMobileSWR'
import usePreferences, { parsePref } from '../../../hooks/usePreferences'
import { resolveGlobalPrefSettings, tagAppTheme } from '../../../components/chart/chartThemes'
import usePlacedTheme from '../../../hooks/usePlacedTheme'
import { useLiveBreadth } from '../../../hooks/useLiveBreadth'
import { menuThemeVars } from '../../../utils/dividerColor'
import { sendCaptureToJournal } from '../../journal-2-0/lib/sendToJournal'
import { useJournalToast, JournalToast } from '../../journal-2-0/lib/useJournalToast'
import UIcon from '../../../components/ui/UIcon'
import { HM_METRICS, TIER_SCORES, TIER_TIP_COLORS, TIER_CELL_COLORS, FFILL_KEYS } from '../../breadth/heatmapMetrics'
import BreadthSettingsPanel from './BreadthSettingsPanel'
import {
  BREADTH_WIDGET_SETTINGS_KEY, mergeBreadthWidgetSettings, breadthDefaultsForTheme,
  breadthWidgetStyleVars, customBreadthColors, isLightCanvas,
  LIGHT_TIER_CELL_COLORS, LIGHT_TIER_TIP_COLORS,
} from './breadthWidgetSettings'
import styles from './BreadthWidget.module.css'

const fetcher = (url) => fetch(url).then(r => r.json())

const LIVE_URL = '/api/breadth-monitor/live'
const ALL_METRICS = HM_METRICS.filter(m => !m.isHeader)

// Heatmap group display order + labels (match the /breadth board).
const HEATMAP_GROUPS = ['Score', 'Primary', 'Internals', 'MA', 'Regime', 'Highs/Lows', 'Sentiment']
const GROUP_LABELS = {
  Score: 'Score', Primary: 'Primary Breadth', Internals: 'Internals', MA: 'MA Breadth',
  Regime: 'Regime', 'Highs/Lows': 'Highs / Lows', Sentiment: 'Sentiment',
}

// ── Ratio Bars view: horizontal split gauges for the paired bull/bear internals.
// Each pair renders one bar — the winning side's share fills from its end in the
// up/down color, with the raw counts flanking and the dominant % centered. Values
// resolve straight off the live currentRow; a pair with no data is skipped. ──
const RATIO_PAIRS = [
  { key: 'advdec', label: 'Advance / Decline',      up: 'advancing',     upLabel: 'Advancing',     dn: 'declining',      dnLabel: 'Declining' },
  { key: 'nhnl',   label: 'New Highs / New Lows',   up: 'new_52w_highs', upLabel: 'New Highs',     dn: 'new_52w_lows',   dnLabel: 'New Lows' },
  { key: 'p4',     label: 'Up 4% / Down 4%',        up: 'up_4pct_today', upLabel: 'Up 4%',         dn: 'down_4pct_today', dnLabel: 'Down 4%' },
  { key: 'open',   label: 'Up / Down from Open',    up: 'up_from_open',  upLabel: 'Up from Open',  dn: 'down_from_open', dnLabel: 'Down from Open' },
  { key: 'vol',    label: 'Up / Down on Volume',    up: 'up_on_volume',  upLabel: 'Up on Volume',  dn: 'down_on_volume', dnLabel: 'Down on Volume' },
]

// FLIP: animate tiles sliding to their new spot when one is removed/added. Reads
// [data-mkey] positions before/after each layout and plays the delta. No-ops under
// reduced-motion / where Element.animate is unavailable (jsdom).
function useFlip(containerRef, dep) {
  const prev = useRef(new Map())
  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) { prev.current = new Map(); return }
    const reduce = typeof window !== 'undefined' && window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const tiles = el.querySelectorAll('[data-mkey]')
    const next = new Map()
    tiles.forEach(t => next.set(t.getAttribute('data-mkey'), t.getBoundingClientRect()))
    if (!reduce) {
      tiles.forEach(t => {
        const key = t.getAttribute('data-mkey')
        const p = prev.current.get(key), n = next.get(key)
        if (p && n && (p.left !== n.left || p.top !== n.top) && typeof t.animate === 'function') {
          const dx = p.left - n.left, dy = p.top - n.top
          try { t.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0,0)' }], { duration: 190, easing: 'cubic-bezier(0.22,0.61,0.36,1)' }) } catch { /* WAAPI unavailable */ }
        }
      })
    }
    prev.current = next
  }, [dep, containerRef])
}

// A tile's woven-in trend line. viewBox is 100×VBH stretched to the tile
// (preserveAspectRatio none + non-scaling stroke), so it fits any tile width.
//   mode 'spark'  → a short line strip UNDER the value (in-flow)
//   mode 'area'   → a filled trend as the tile BACKDROP
//   mode 'ghost'  → a faint line as the tile BACKDROP
const SPARK_VBW = 100
function TileSpark({ values, mode }) {
  const vbh = mode === 'spark' ? 18 : 44
  const shape = useMemo(() => {
    const vals = (values || []).filter(v => v != null && v !== '' && Number.isFinite(Number(v))).map(Number)
    if (vals.length < 2) return null
    const min = Math.min(...vals), max = Math.max(...vals)
    const span = (max - min) || 1
    const pad = 2, h = vbh - pad * 2
    const x = i => (i / (vals.length - 1)) * SPARK_VBW
    const y = v => pad + h - ((v - min) / span) * h
    const line = vals.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
    return { line, area: `${line}L${SPARK_VBW},${vbh}L0,${vbh}Z`, open: vals[0], now: vals.at(-1), lastX: x(vals.length - 1), lastY: y(vals.at(-1)) }
  }, [values, vbh])
  if (!shape) return null
  // One ink colour — black lines, not green/red (owner). Adaptive: dark ink on a
  // light canvas (--bw-spark, emitted by breadthWidgetStyleVars) / light on dark.
  const stroke = 'var(--bw-spark, rgba(255, 255, 255, 0.82))'
  const backdrop = mode !== 'spark'
  return (
    <svg
      className={backdrop ? styles.tileSparkBg : styles.tileSparkInline}
      viewBox={`0 0 ${SPARK_VBW} ${vbh}`} preserveAspectRatio="none" aria-hidden="true"
    >
      {mode === 'area' && <path d={shape.area} fill={stroke} opacity="0.16" />}
      <path
        d={shape.line} fill="none" stroke={stroke} strokeWidth={mode === 'ghost' ? 1.4 : 1.6}
        strokeLinejoin="round" strokeLinecap="round" opacity={mode === 'ghost' ? 0.42 : 0.95}
        vectorEffect="non-scaling-stroke"
      />
      {!backdrop && <circle cx={shape.lastX} cy={shape.lastY} r="1.8" fill={stroke} />}
    </svg>
  )
}

// ── Heatmap: grouped 8-tier tile grid, each tile removable on hover ──
function HeatmapView({ currentRow, visibleKeys, tileStyle, seriesFor, onDrill, onRemove, cellColors, tipColors, textColor }) {
  const wrapRef = useRef(null)
  useFlip(wrapRef, visibleKeys.join(','))
  const backdrop = tileStyle === 'area' || tileStyle === 'ghost'
  return (
    <div className={styles.hmWrap} ref={wrapRef}>
      {HEATMAP_GROUPS.map(g => {
        const metrics = ALL_METRICS.filter(m => m.group === g && visibleKeys.includes(m.key))
        if (!metrics.length) return null
        return (
          <div key={g} className={styles.hmGroup}>
            <div className={styles.hmGroupLabel}>{GROUP_LABELS[g] || g}</div>
            <div className={styles.hmGrid}>
              {metrics.map(m => {
                const tier = m.getTier(currentRow)
                const score = TIER_SCORES[tier]
                const spark = tileStyle !== 'values'
                  ? <TileSpark values={seriesFor(m.key)} mode={tileStyle} />
                  : null
                return (
                  <button
                    key={m.key}
                    data-mkey={m.key}
                    type="button"
                    className={`${styles.hmTile}${backdrop ? ' ' + styles.hmTileBackdrop : ''}`}
                    style={{ background: cellColors[tier] ?? cellColors[''] }}
                    onClick={() => onDrill?.(m)}
                    title={onDrill ? `${m.label} — open Breadth` : m.label}
                  >
                    {backdrop && spark}
                    {onRemove && (
                    <span
                      className={styles.hmTileX}
                      role="button"
                      tabIndex={-1}
                      aria-label={`Remove ${m.label}`}
                      title={`Remove ${m.label}`}
                      onClick={(e) => { e.stopPropagation(); onRemove(m.key) }}
                    ><UIcon name="x" size={9} gold={false} /></span>
                    )}
                    <span className={styles.hmTileLabel}>{m.label}</span>
                    <span className={styles.hmTileVal} style={{ color: textColor || (score != null ? tipColors[score] : 'var(--bw-text-dim, #8b8674)') }}>
                      {m.getFmt(currentRow)}
                    </span>
                    {tileStyle === 'spark' && spark}
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

// ── Ratio Bars: a stacked set of premium gauge CARDS, one per bull/bear pair.
// Each card: centered title, winning % top-right, a glossy split pill (green vs
// red, gloss gradient + a soft 50% midpoint tick + a crisp seam), then the raw
// counts + labels. The pill's down side is the bar background with a single
// absolutely-positioned up-fill over it, so both halves are always identical
// height. Live-only pairs with no reading yet (outside RTH) render a calm
// "awaiting session" card instead of vanishing — so the set never looks empty. ──
function RatioBarsView({ ratioRow, upColor, dnColor, upText, dnText, textColor }) {
  const bars = RATIO_PAIRS.map(p => {
    const u = ratioRow?.[p.up]
    const d = ratioRow?.[p.dn]
    const has = !(u == null && d == null)
    const uu = Math.max(0, Number(u) || 0)
    const dd = Math.max(0, Number(d) || 0)
    const tot = uu + dd
    const bullWins = uu >= dd
    // DeepVue-style single shade: the WINNER fills from ITS side of a neutral
    // track, so bar length = dominance and colour = direction. % = winner share.
    const winFrac = tot > 0 ? (bullWins ? uu : dd) / tot : 0.5
    const pct = has && tot > 0 ? Math.round(winFrac * 100) : null
    return { ...p, has, uu, dd, bullWins, winPct: winFrac * 100, pct }
  })
  return (
    <div className={styles.ratioWrap}>
      {bars.map(b => (
        <div key={b.key} className={`${styles.ratioCard}${b.has ? '' : ' ' + styles.ratioCardEmpty}`}>
          <div className={styles.ratioHead}>
            <span className={styles.ratioLabel} style={textColor ? { color: textColor } : undefined}>{b.label}</span>
            <span
              className={styles.ratioPct}
              style={b.pct != null ? { color: b.bullWins ? upText : dnText } : undefined}
            >{b.pct != null ? `${b.pct}%` : '—'}</span>
          </div>
          <div className={styles.ratioBar}>
            {b.has && (
              <div
                className={`${styles.ratioFill} ${b.bullWins ? styles.ratioFillL : styles.ratioFillR}`}
                style={{ width: `${b.winPct}%`, background: b.bullWins ? upColor : dnColor }}
              />
            )}
            <span className={styles.ratioMid} aria-hidden="true" />
          </div>
          <div className={styles.ratioFoot}>
            {b.has ? (
              <>
                <span className={styles.ratioFootUp} style={{ color: upText }}>
                  <b className={styles.ratioCount}>{b.uu.toLocaleString()}</b> {b.upLabel}
                </span>
                <span className={styles.ratioFootDn} style={{ color: dnText }}>
                  <b className={styles.ratioCount}>{b.dd.toLocaleString()}</b> {b.dnLabel}
                </span>
              </>
            ) : (
              <>
                <span className={styles.ratioFootMuted}>{b.upLabel}</span>
                <span className={styles.ratioFootMuted}>{b.dnLabel}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

// ── ＋ menu: every reading, grouped, with a checkmark on the shown ones. Opens
// BESIDE the widget (portaled to <body>, placed toward the layout middle) just
// like the ⚙ settings panel — so it never covers the tiles you're toggling. ──
const ADD_MENU_W = 300
function AddMenu({ hidden, onToggle, onClose, anchorEl, hostEl, themeVars }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!hostEl) return undefined
    const place = () => {
      const r = hostEl.getBoundingClientRect()
      const gap = 8
      const preferRight = (r.left + r.width / 2) < window.innerWidth / 2
      let left = preferRight ? r.right + gap : r.left - gap - ADD_MENU_W
      if (preferRight && left + ADD_MENU_W > window.innerWidth - 8) left = r.left - gap - ADD_MENU_W
      if (!preferRight && left < 8) left = Math.min(window.innerWidth - ADD_MENU_W - 8, r.right + gap)
      left = Math.max(8, Math.min(left, window.innerWidth - ADD_MENU_W - 8))
      let top = Math.max(8, r.top)
      const h = Math.min(Math.round(window.innerHeight * 0.72), 560)
      if (top + h > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - h)
      setPos({ left: Math.round(left), top: Math.round(top) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [hostEl])
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return
      if (anchorEl?.contains(e.target)) return
      onClose()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0)
    window.addEventListener('keydown', onKey)
    return () => { clearTimeout(t); document.removeEventListener('mousedown', onDown); window.removeEventListener('keydown', onKey) }
  }, [onClose, anchorEl])
  return createPortal((
    <div
      ref={ref}
      className={styles.addMenu}
      style={{ ...(themeVars || {}), width: ADD_MENU_W, ...(pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }) }}
    >
      <div className={styles.addMenuHead}>Readings</div>
      <div className={styles.addMenuScroll}>
        {HEATMAP_GROUPS.map(g => {
          const metrics = ALL_METRICS.filter(m => m.group === g)
          if (!metrics.length) return null
          return (
            <div key={g} className={styles.addMenuGroup}>
              <div className={styles.addMenuGroupLabel}>{GROUP_LABELS[g] || g}</div>
              <div className={styles.addChipGrid}>
                {metrics.map(m => {
                  const on = !hidden.has(m.key)
                  return (
                    <button
                      key={m.key} type="button"
                      className={`${styles.addChip}${on ? ' ' + styles.addChipOn : ''}`}
                      onClick={() => onToggle(m.key)} role="menuitemcheckbox" aria-checked={on}
                      title={on ? `Hide ${m.label}` : `Show ${m.label}`}
                    >
                      <span className={styles.addChipDot} aria-hidden="true" />
                      <span className={styles.addChipLbl}>{m.label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  ), document.body)
}

export default function BreadthWidget({
  opts, onOptsChange,
  // Frozen-embed mode (journal host): `frozen` carries {row, series, settings,
  // updated} — the captured heat-map verbatim. A mid-session capture holds
  // the LIVE intraday row the 4:15 collector DISCARDS: this payload is the
  // only record of it anywhere (owner-approved freeze). readOnly strips the
  // gear (writes the GLOBAL settings pref), add/remove metric editing, tile
  // drill (navigates away), and the footer refresh (globalMutate refetches
  // app-wide — the structural-readOnly audit finding).
  frozen = null, readOnly = false, journalDoor = true,
}) {
  const navigate = useNavigate()

  // ── Appearance settings (⚙) ──
  const { prefs, setPref } = usePreferences()
  const placedTheme = usePlacedTheme()
  const bwSettings = useMemo(
    () => mergeBreadthWidgetSettings(frozen?.settings ?? resolveGlobalPrefSettings(parsePref(prefs?.[BREADTH_WIDGET_SETTINGS_KEY], null), placedTheme, breadthDefaultsForTheme)),
    [prefs, frozen, placedTheme],
  )
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const settingsBtnRef = useRef(null)
  const addBtnRef = useRef(null)
  const rootRef = useRef(null)
  const patchSettings = useCallback((patch) => {
    setPref(BREADTH_WIDGET_SETTINGS_KEY, JSON.stringify(tagAppTheme({ ...bwSettings, ...patch }, placedTheme)))
  }, [bwSettings, setPref, placedTheme])
  const resetSettings = useCallback(() => {
    setPref(BREADTH_WIDGET_SETTINGS_KEY, JSON.stringify(breadthDefaultsForTheme(placedTheme)))
  }, [setPref, prefs])
  const bwStyle = useMemo(() => breadthWidgetStyleVars(bwSettings), [bwSettings])
  const bwMenuVars = useMemo(() => {
    const canvas = bwSettings.bgMode === 'gradient' ? (bwSettings.bgGradient?.top || bwSettings.bg) : bwSettings.bg
    return menuThemeVars(canvas) || {}
  }, [bwSettings])

  // ── Per-widget hidden readings (persist via workspace opts; default = all shown) ──
  const hidden = useMemo(() => new Set(Array.isArray(opts?.hiddenMetrics) ? opts.hiddenMetrics : []), [opts])
  const visibleKeys = useMemo(() => ALL_METRICS.filter(m => !hidden.has(m.key)).map(m => m.key), [hidden])
  const removeMetric = useCallback((key) => {
    if (hidden.has(key)) return
    onOptsChange?.({ ...(opts || {}), hiddenMetrics: [...hidden, key] })
  }, [opts, onOptsChange, hidden])
  const toggleMetric = useCallback((key) => {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key); else next.add(key)
    onOptsChange?.({ ...(opts || {}), hiddenMetrics: [...next] })
  }, [opts, onOptsChange, hidden])

  // ── Data: stored history + LIVE intraday row on top (real-time, like /breadth) ──
  const { data, mutate, isValidating } = useMobileSWR(frozen ? null : '/api/breadth-monitor?days=90', fetcher, {
    refreshInterval: 300_000, dedupingInterval: 60_000, revalidateOnFocus: false,
  })
  const rows = useMemo(() => data?.rows ?? [], [data])
  const liveBreadth = useLiveBreadth({ enabled: !frozen })
  // Live intraday row on top of stored history; forward-fill the sparse weekly
  // sentiment keys (AAII/NAAIM) from recent rows so those tiles aren't "—".
  const currentRow = useMemo(() => {
    if (frozen?.row) return frozen.row
    const base = liveBreadth.row ? liveBreadth.row : rows[0]
    if (!base) return null
    const filled = { ...base }
    for (const k of FFILL_KEYS) {
      if (filled[k] == null) {
        for (const r of rows) { if (r?.[k] != null) { filled[k] = r[k]; break } }
      }
    }
    return filled
  }, [frozen, liveBreadth.row, rows])

  // Per-reading trend series for the sparkline tile styles: today's INTRADAY path
  // for the 7 live-sampled readings (real-time), else the last ~month of daily
  // values (newest = the live row, so the endpoint tracks live). oldest-first.
  const TREND_N = 24
  const trendBase = useMemo(
    () => (liveBreadth.row && currentRow ? [currentRow, ...rows] : rows),
    [liveBreadth.row, currentRow, rows],
  )
  const seriesFor = useCallback((key) => {
    if (frozen) return Array.isArray(frozen.series?.[key]) ? frozen.series[key] : []
    const p = liveBreadth.path?.[key]
    if (Array.isArray(p) && p.length >= 2) return p.map(x => x?.[1])
    const out = []
    for (let i = Math.min(TREND_N, trendBase.length) - 1; i >= 0; i--) out.push(trendBase[i]?.[key])
    return out
  }, [frozen, liveBreadth.path, trendBase])
  const tileStyle = bwSettings.tileStyle || 'values'

  // When we last pulled the data (client-side), so the footer always shows a TIME
  // like the Scanner widget — not just a date once the live row is superseded.
  // Stamped when the fetched `data` object changes (render-time ref, not an
  // effect → no setState-in-effect, and no one-render lag).
  const stampRef = useRef({ data: null, at: null })
  if (data && data !== stampRef.current.data) stampRef.current = { data, at: Date.now() }
  const fetchedAt = stampRef.current.at
  const [refreshing, setRefreshing] = useState(false)
  const [journalMsg, setJournalMsg] = useJournalToast()
  const refreshAll = useCallback(async () => {
    setRefreshing(true)
    try { await Promise.all([mutate(), globalMutate(LIVE_URL)]) } finally { setRefreshing(false) }
  }, [mutate])
  const spinning = refreshing || isValidating

  // "Last updated" always carries a time: the live intraday clock while a live row
  // stands, else the last fetch time. ET, "h:mm AM/PM".
  const fmtEtTime = (ms) => {
    try { return new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }) }
    catch { return null }
  }
  const updated = frozen
    ? (frozen.updated || currentRow?.date || null)
    : liveBreadth.clock
      ? `${liveBreadth.clock} ET`
      : (fetchedAt ? `${fmtEtTime(fetchedAt)} ET` : (currentRow?.date || null))

  const drill = useCallback(() => navigate('/breadth'), [navigate])

  const lightCanvas = useMemo(() => isLightCanvas(bwSettings), [bwSettings])
  const custom = useMemo(() => customBreadthColors(bwSettings, lightCanvas), [bwSettings, lightCanvas])
  const cellColors = custom ? custom.cellColors : (lightCanvas ? LIGHT_TIER_CELL_COLORS : TIER_CELL_COLORS)
  const tipColors = custom ? custom.tipColors : (lightCanvas ? LIGHT_TIER_TIP_COLORS : TIER_TIP_COLORS)

  // ── View: Heatmap (default) ⇄ Ratio Bars (persist via workspace opts; a local
  // fallback keeps the toggle live in frozen/journal embeds with no onOptsChange) ──
  const [localView, setLocalView] = useState(null)
  const view = localView ?? (opts?.view === 'ratio' ? 'ratio' : 'heatmap')
  const setView = useCallback((v) => {
    setLocalView(v)
    onOptsChange?.({ ...(opts || {}), view: v })
  }, [opts, onOptsChange])

  // Ratio-bar hues: the custom up/down override wins, else the UCT green/red —
  // the same family as the heatmap tiles + the app's up/down values (medium,
  // flat; NOT the neon bright and NOT the dark tile fill).
  const ratioUp = custom ? custom.viewPalette.tier.g3 : (lightCanvas ? '#15833f' : '#1c9b54')
  const ratioDn = custom ? custom.viewPalette.tier.r3 : (lightCanvas ? '#c0392f' : '#bf3b34')
  // Brighter text for the % + counts (the heatmap idiom: medium fill, bright value)
  // so the labels stay legible on the widget canvas instead of reading dull.
  const ratioUpText = custom ? custom.viewPalette.tier.g3 : (lightCanvas ? '#15803d' : '#3ad684')
  const ratioDnText = custom ? custom.viewPalette.tier.r3 : (lightCanvas ? '#c0392f' : '#f57368')

  // The row the Ratio-Bars view reads: REAL-TIME only during the regular session;
  // otherwise the frozen last-close internals (held until the next 9:30 open).
  // NH/NL + Up/Down-4% live in the daily row too, so they fall back to currentRow
  // when no intraday freeze exists yet.
  const ratioRow = useMemo(() => {
    if (liveBreadth.marketOpen && liveBreadth.row) return liveBreadth.row
    const frozen = liveBreadth.frozen
    return (frozen && Object.keys(frozen).length) ? { ...currentRow, ...frozen } : currentRow
  }, [liveBreadth.marketOpen, liveBreadth.row, liveBreadth.frozen, currentRow])

  return (
    <div ref={rootRef} className={styles.root} style={bwStyle}>
      {settingsOpen && (
        <BreadthSettingsPanel
          settings={bwSettings} onChange={patchSettings} onReset={resetSettings}
          onClose={() => setSettingsOpen(false)} gearEl={settingsBtnRef.current}
          hostEl={rootRef.current} themeVars={bwMenuVars}
        />
      )}

      {/* Single top row (no "Breadth Monitor" title): the Heatmap/Ratio Bars view
          tabs (flat, like the Watchlist/Scanner pickers) + the journal/add/⚙ buttons
          on the right. */}
      <div className={styles.tabBar}>
        {currentRow && (
          <>
            <button
              type="button"
              className={`${styles.pill}${view === 'heatmap' ? ' ' + styles.pillOn : ''}`}
              onClick={() => setView('heatmap')} aria-pressed={view === 'heatmap'}
            >Heatmap</button>
            <button
              type="button"
              className={`${styles.pill}${view === 'ratio' ? ' ' + styles.pillOn : ''}`}
              onClick={() => setView('ratio')} aria-pressed={view === 'ratio'}
            >Ratio Bars</button>
          </>
        )}
        <span className={styles.tabSpacer} />
        {/* Send to Journal: freeze the shown heat-map into the note (payload capture,
            owner decision). A mid-session capture preserves the live intraday row the
            4:15 collector discards. */}
        {journalDoor && !readOnly && currentRow && (
          <button
            type="button" className={styles.iconBtn}
            onClick={async () => {
              setJournalMsg('sending…')
              const series = {}
              for (const k of visibleKeys) series[k] = seriesFor(k)
              setJournalMsg(await sendCaptureToJournal('breadth', {
                hiddenMetrics: Array.isArray(opts?.hiddenMetrics) ? opts.hiddenMetrics : [],
                tileStyle, settings: bwSettings, row: currentRow, series, updated,
              }, { label: 'Breadth' }))
            }}
            title="Send this snapshot to Journal" aria-label="Send this snapshot to Journal"
          ><UIcon name="journal" size={13} /></button>
        )}
        <JournalToast msg={journalMsg} />
        {!readOnly && (
        <button
          ref={addBtnRef} type="button"
          className={`${styles.iconBtn}${addOpen ? ' ' + styles.iconBtnActive : ''}`}
          onClick={() => setAddOpen(o => !o)} title="Add / remove readings" aria-label="Add or remove readings"
        ><UIcon name="plus" size={14} /></button>
        )}
        {!readOnly && (
        <button
          ref={settingsBtnRef} type="button"
          className={`${styles.iconBtn}${settingsOpen ? ' ' + styles.iconBtnActive : ''}`}
          onClick={() => setSettingsOpen(o => !o)} title="Breadth widget settings" aria-label="Breadth widget settings"
        ><UIcon name="gear" size={13} /></button>
        )}
        {addOpen && (
          <AddMenu
            hidden={hidden} onToggle={toggleMetric} onClose={() => setAddOpen(false)}
            anchorEl={addBtnRef.current} hostEl={rootRef.current} themeVars={bwMenuVars}
          />
        )}
      </div>

      {!currentRow && (
        <div className={styles.hint}>{data || liveBreadth.meta ? 'No breadth data yet.' : 'Loading breadth…'}</div>
      )}

      {currentRow && (
        <div className={styles.viewArea}>
          {view === 'ratio'
            ? <RatioBarsView
                ratioRow={ratioRow} upColor={ratioUp} dnColor={ratioDn}
                upText={ratioUpText} dnText={ratioDnText}
                textColor={bwSettings.valueColor || null}
              />
            : visibleKeys.length === 0
              ? <div className={styles.hint}>All readings hidden — add some with ＋.</div>
              : <HeatmapView
                  currentRow={currentRow} visibleKeys={visibleKeys}
                  tileStyle={tileStyle} seriesFor={seriesFor}
                  onDrill={readOnly ? null : drill} onRemove={readOnly ? null : removeMetric}
                  cellColors={cellColors} tipColors={tipColors} textColor={bwSettings.valueColor || null}
                />}
        </div>
      )}

      {/* Footer: last-updated + refresh (mirrors the Scanner widget). */}
      <div className={styles.footer}>
        <span className={styles.footerUpdated}>{updated ? `Updated ${updated}` : 'Live'}</span>
        {!readOnly && (
        <button type="button" className={styles.footerRefresh} onClick={refreshAll} title="Refresh" aria-label="Refresh">
          <UIcon name="refresh" size={12} gold={false} className={spinning ? styles.footerRefreshSpin : undefined} />
        </button>
        )}
      </div>
    </div>
  )
}
