import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from './ColorPanel'
import { CHART_DEFAULTS } from './chartDefaults'
import ChartThemesModal from './ChartThemesModal'
import { applyThemeToSettings, themeWithAppSurface } from './chartThemes'
import { legendModeOf, LEGEND_MODES } from './legendMode'
import { crosshairModeOf, CROSSHAIR_MODES } from './crosshairMode'
import {
  listAllIndicators, readEnabled, applyRowPatch, indTarget, splitIndTarget, isIndTarget,
} from './indicatorRegistry'
// The engine's definitions, so the Indicators tab can GENERATE the rows for the
// indicators the engine owns instead of carrying a second hand-written copy of
// their fields. See `indicatorRegistry.js`'s header — this import is what
// "superseded, not absorbed" looks like at the consumer.
import * as engineRegistry from './engine/nativeRegistry'
import usePreferences, { parsePref } from '../../hooks/usePreferences'
import UIcon from '../ui/UIcon'
import { HEADER_FIELDS, HEADER_FIELD_BY_KEY, headerFieldKeys, SIGN_POS, SIGN_NEG } from './headerFields'
import styles from './ChartSettingsModal.module.css'

// A user's saved chart-settings templates live in ONE global pref so they're
// available from every chart/tab/grid cell. Applying a template routes through
// the modal's onChange (→ the active surface's own settings), never the global
// pref, so it lands on exactly the tab/widget you opened settings from.
const CHART_TEMPLATES_KEY = 'chart_templates'
const MAX_TEMPLATES = 40

/**
 * Chart Settings — the new, centered, OLED-black settings modal for the Charts
 * workspace. Replaces the old inline gear panel. Opened by the settings button in
 * the chart header (above the clock). Built section-by-section; v1 ships the chart
 * TYPE selector. `settings` is the merged chart_settings object; `onChange(next)`
 * persists the whole object (via chart_settings preference).
 */

// #rrggbb + 0..1 alpha ⇄ 8-digit hex — for the watermark, whose color & opacity
// are stored as separate settings but edited through the one opacity-aware picker.
function splitHexA(v) {
  const m8 = /^#?([0-9a-f]{6})([0-9a-f]{2})$/i.exec((v || '').trim())
  if (m8) return { rgb: `#${m8[1].toLowerCase()}`, a: parseInt(m8[2], 16) / 255 }
  const m6 = /^#?([0-9a-f]{6})$/i.exec((v || '').trim())
  return { rgb: m6 ? `#${m6[1].toLowerCase()}` : '#a8a290', a: 1 }
}
function joinHexA(rgb, a) {
  const base = /^#[0-9a-f]{6}$/i.test(rgb || '') ? rgb.toLowerCase() : '#a8a290'
  const av = Math.max(0, Math.min(1, a ?? 1))
  if (av >= 0.999) return base
  return base + Math.round(av * 255).toString(16).padStart(2, '0')
}

// Compact type glyphs (24×24, currentColor) so each option reads at a glance.
function TypeGlyph({ kind }) {
  const s = { width: 26, height: 26, display: 'block' }
  switch (kind) {
    case 'candles':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="3" x2="8" y2="23" />
          <rect x="5.5" y="8" width="5" height="9" fill="currentColor" stroke="none" />
          <line x1="18" y1="4" x2="18" y2="22" />
          <rect x="15.5" y="7" width="5" height="8" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'hollow':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="3" x2="8" y2="23" />
          <rect x="5.5" y="8" width="5" height="9" />
          <line x1="18" y1="4" x2="18" y2="22" />
          <rect x="15.5" y="7" width="5" height="8" />
        </svg>
      )
    case 'hlc':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="4" x2="8" y2="22" />
          <line x1="8" y1="15" x2="12" y2="15" />
          <line x1="18" y1="6" x2="18" y2="20" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      )
    case 'bars':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.4">
          <line x1="8" y1="4" x2="8" y2="22" />
          <line x1="4" y1="9" x2="8" y2="9" />
          <line x1="8" y1="15" x2="12" y2="15" />
          <line x1="18" y1="6" x2="18" y2="20" />
          <line x1="14" y1="10" x2="18" y2="10" />
          <line x1="18" y1="12" x2="22" y2="12" />
        </svg>
      )
    case 'line':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <polyline points="3,17 9,11 14,15 23,5" />
        </svg>
      )
    case 'area':
      return (
        <svg viewBox="0 0 26 26" style={s} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round">
          <polyline points="3,17 9,11 14,15 23,5" />
          <path d="M3 17 L9 11 L14 15 L23 5 L23 22 L3 22 Z" fill="currentColor" fillOpacity="0.18" stroke="none" />
        </svg>
      )
    default:
      return null
  }
}

const CHART_TYPES = [
  { val: 'candles', label: 'Candles' },
  { val: 'hollow',  label: 'Hollow Candles' },
  { val: 'hlc',     label: 'HLC Bars' },
  { val: 'bars',    label: 'OHLC Bars' },
  { val: 'line',    label: 'Line' },
  { val: 'area',    label: 'Area' },
]

const COLOR_MODES = [
  { val: 'onecolor',  label: 'One Color' },
  { val: 'netchange', label: 'Net Change' },
  { val: 'openclose', label: 'Open vs Close' },
]

const TARGET_MAP = {
  bodyUp: 'upColor', bodyDown: 'downColor',
  borderUp: 'upBorder', borderDown: 'downBorder',
  wickUp: 'upWick', wickDown: 'downWick',
  one: 'oneColor',
}

// Header tab options.
const TITLE_MODES = [
  { val: 'ticker', label: 'Ticker' },
  { val: 'company', label: 'Company' },
  { val: 'both', label: 'Both' },
]
// Shape of the on-chart OHLCV legend. Horizontal is the flat, box-less strip.
const LEGEND_LAYOUTS = [
  { val: 'vertical', label: 'Vertical' },
  { val: 'horizontal', label: 'Horizontal' },
]
// When the on-chart OHLCV legend shows. ⚠️ The VALUES are not written here —
// `LEGEND_MODES` is the enumeration, and this only supplies each one's label and
// its one-line explanation. A hand-typed value list beside the module that owns
// it is how a fourth mode ends up unreachable from the settings UI.
const LEGEND_MODE_LABELS = {
  always: { label: 'Always', hint: 'On, following the crosshair as you hover' },
  hold: { label: 'Hold', hint: 'Chart stays clean; press and hold to peek, release to hide' },
  off: { label: 'Off', hint: 'Never shown' },
}
// When the hover crosshair (lines + tracking axis labels) shows. Same three-way
// control as the legend; labels/hints only — `CROSSHAIR_MODES` owns the values.
const CROSSHAIR_MODE_LABELS = {
  always: { label: 'Always', hint: 'On, following the cursor as you hover' },
  hold: { label: 'Hold', hint: 'Chart stays clean; press and hold to show it, release to hide' },
  off: { label: 'Off', hint: 'Never shown' },
}

export default function ChartSettingsModal({
  open, onClose, settings, onChange, savedColors = [], onSaveColor, onDeleteColor, themeVars = null,
  // Optional: apply a UCT theme to EVERY chart in the layout at once. Supplied by
  // the Charts workspace (via ChartPane); when absent, the themes gallery offers
  // only "this chart".
  onApplyThemeAll = null,
  // Optional: apply the theme to EVERY widget in the layout (chart or not).
  onApplyThemeAllWidgets = null,
  // Reason string when the SURFACE that opened this modal fixes the volume pane
  // itself (charts workspace / multi-chart grid — see VOLUME_PANE_SURFACE_FIXED).
  // Renders the separate-pane toggle inert rather than letting it look live.
  volumePaneFixed = null,
}) {
  const panelRef = useRef(null)
  const dragRef = useRef(null)
  const [activeTab, setActiveTab] = useState('price') // 'price' | 'canvas'
  const [activeTarget, setActiveTarget] = useState(null) // { target, label }
  const [panelPos, setPanelPos] = useState(null)
  const [pos, setPos] = useState(null) // dragged modal position {left, top}; null = centered
  const [confirmReset, setConfirmReset] = useState(false)
  const resetTimerRef = useRef(null)
  const [themesOpen, setThemesOpen] = useState(false)

  // Apply a UCT theme's visual layer. 'one' → this surface (via onChange, exactly
  // like a template); 'all' → every chart in the layout; 'allwidgets' → every
  // widget in the layout (chart or not). The last two are workspace-supplied.
  const applyTheme = (theme, scope) => {
    if (scope === 'allwidgets' && onApplyThemeAllWidgets) onApplyThemeAllWidgets(theme)
    else if (scope === 'all' && onApplyThemeAll) onApplyThemeAll(theme)
    // 'one' = this chart only. An app-mirrored theme uses the app surface as canvas.
    else onChange?.(applyThemeToSettings(settings, themeWithAppSurface(theme)))
  }

  // ── Settings templates (save the whole look, reuse on any tab) ──────────────
  const { prefs, setPref } = usePreferences()
  const templates = useMemo(() => {
    const arr = parsePref(prefs?.[CHART_TEMPLATES_KEY], [])
    return Array.isArray(arr) ? arr : []
  }, [prefs])
  const [tplMenuOpen, setTplMenuOpen] = useState(false)
  const [savingTpl, setSavingTpl] = useState(false)   // inline "name your template" row is showing
  const [tplName, setTplName] = useState('')
  const tplInputRef = useRef(null)
  useEffect(() => { if (savingTpl && tplInputRef.current) { tplInputRef.current.focus(); tplInputRef.current.select() } }, [savingTpl])
  // Info Row field-picker menu (Header tab) — pops out to the RIGHT of the modal (like the
  // color panel) so it never gets clipped by the modal's bottom.
  const [fieldMenuOpen, setFieldMenuOpen] = useState(false)
  const [fieldQuery, setFieldQuery] = useState('')
  const [fieldMenuPos, setFieldMenuPos] = useState(null)
  const fieldWrapRef = useRef(null)
  const fieldMenuRef = useRef(null)
  useEffect(() => {
    if (!fieldMenuOpen) return
    const onDown = (e) => {
      const inWrap = fieldWrapRef.current && fieldWrapRef.current.contains(e.target)
      const inMenu = fieldMenuRef.current && fieldMenuRef.current.contains(e.target)
      if (!inWrap && !inMenu) setFieldMenuOpen(false)
    }
    document.addEventListener('mousedown', onDown, true)   // capture: beats the panel's stopPropagation
    return () => document.removeEventListener('mousedown', onDown, true)
  }, [fieldMenuOpen])
  useLayoutEffect(() => {
    if (!fieldMenuOpen || !panelRef.current) { setFieldMenuPos(null); return }
    const r = panelRef.current.getBoundingClientRect()
    // Top-align the field menu to the settings modal's top edge, and give it enough
    // height that every field shows without scrolling (H tracks the full list); if it
    // would spill past the viewport bottom, nudge it up.
    const W = 240, gap = 12, H = Math.min(760, window.innerHeight - 24)
    let left = r.right + gap
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - gap)  // flip left if tight
    let top = r.top
    if (top + H > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - H)
    setFieldMenuPos({ left, top })
  }, [fieldMenuOpen, pos])

  const persistTemplates = (arr) => setPref(CHART_TEMPLATES_KEY, JSON.stringify(arr.slice(0, MAX_TEMPLATES)))
  const commitSaveTemplate = () => {
    const name = tplName.trim().slice(0, 40)
    if (!name) { setSavingTpl(false); setTplName(''); return }
    // Snapshot the CURRENT settings as the template body. Overwrite a same-named
    // template (case-insensitive) so re-saving updates in place instead of piling up.
    const snapshot = JSON.parse(JSON.stringify({ ...settings, preset: 'custom' }))
    const id = `tpl${Math.random().toString(36).slice(2, 9)}`
    const without = templates.filter(t => (t.name || '').toLowerCase() !== name.toLowerCase())
    persistTemplates([{ id, name, settings: snapshot }, ...without])
    setSavingTpl(false); setTplName(''); setTplMenuOpen(false)
  }
  const applyTemplate = (t) => {
    if (!t?.settings) return
    onChange?.(JSON.parse(JSON.stringify({ ...t.settings, preset: 'custom' })))
    setTplMenuOpen(false)
  }
  const deleteTemplate = (id) => persistTemplates(templates.filter(t => t.id !== id))

  useEffect(() => { if (!open) { setPos(null); setConfirmReset(false); setTplMenuOpen(false); setSavingTpl(false); setTplName(''); setThemesOpen(false) } }, [open]) // re-center + reset transient UI on each open

  // Restore all chart settings to defaults. Two-click confirm (button shows
  // "Confirm?" for a moment) so an accidental tap can't wipe custom colors.
  const handleReset = () => {
    if (confirmReset) {
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      setConfirmReset(false)
      onChange?.(JSON.parse(JSON.stringify(CHART_DEFAULTS)))
    } else {
      setConfirmReset(true)
      if (resetTimerRef.current) clearTimeout(resetTimerRef.current)
      resetTimerRef.current = setTimeout(() => setConfirmReset(false), 2600)
    }
  }

  // Drag the modal by its header (like a floating tool window). Stays open while
  // dragging; clicking the ✕ or outside still closes it.
  const startDrag = (e) => {
    if (e.button !== 0 || e.target.closest?.('[data-modal-close]')) return
    const panel = panelRef.current
    const r = panel?.getBoundingClientRect(); if (!r) return
    e.preventDefault()
    // Pin the panel to fixed positioning up front so we can move it by DIRECT DOM
    // (no re-render) during the drag. Matches the `pos` style applied on commit.
    panel.style.position = 'fixed'; panel.style.margin = '0'; panel.style.animation = 'none'
    panel.style.left = `${r.left}px`; panel.style.top = `${r.top}px`
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: r.left, oy: r.top, w: r.width, h: r.height }
    let raf = 0, last = null, committed = null
    const flush = () => {
      raf = 0; const d = dragRef.current; if (!d || !last) return
      const nx = Math.max(8, Math.min(window.innerWidth - d.w - 8, d.ox + (last.clientX - d.sx)))
      const ny = Math.max(8, Math.min(window.innerHeight - d.h - 8, d.oy + (last.clientY - d.sy)))
      committed = { left: nx, top: ny }
      // Move by direct style — do NOT setState per frame. Re-rendering this large
      // modal every frame, stacked on the dark-pool overlay's rAF loop and a live
      // Scanner, was enough cumulative main-thread load to hang/crash the tab.
      panel.style.left = `${nx}px`; panel.style.top = `${ny}px`
      last = null
    }
    const move = (ev) => { last = ev; if (!raf) raf = requestAnimationFrame(flush) }
    const up = () => {
      if (raf) cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up)
      if (committed) setPos(committed)   // commit the final position to React state ONCE
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  useEffect(() => {
    if (!open) return
    const onKey = (e) => { if (e.key === 'Escape') { if (activeTarget) setActiveTarget(null); else onClose?.() } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, activeTarget])

  useEffect(() => { if (!open) setActiveTarget(null) }, [open])
  useEffect(() => { if (open) setActiveTab('price') }, [open]) // always open on Price Style
  useEffect(() => { setActiveTarget(null) }, [activeTab])

  // Position the pop-out color panel to the RIGHT of the modal (flip left if tight).
  useLayoutEffect(() => {
    if (!open || !activeTarget || !panelRef.current) { setPanelPos(null); return }
    const r = panelRef.current.getBoundingClientRect()
    const W = 316, gap = 12
    let left = r.right + gap
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - gap)
    // Align the color panel's BOTTOM edge with the settings modal's bottom edge.
    const bottom = Math.max(8, window.innerHeight - r.bottom)
    setPanelPos({ left, bottom })
  }, [activeTarget, open, pos])

  // Close the color panel on an outside click (not a swatch, not inside the panel).
  useEffect(() => {
    if (!activeTarget) return
    const onDown = (e) => {
      if (e.target.closest?.('[data-color-swatch]') || e.target.closest?.('[data-color-panel]')) return
      setActiveTarget(null)
    }
    window.addEventListener('mousedown', onDown, true)
    return () => window.removeEventListener('mousedown', onDown, true)
  }, [activeTarget])

  if (!open) return null

  const curType = settings?.chartType || 'candles'
  const setType = (val) => {
    if (val === curType) return
    onChange?.({ ...settings, chartType: val, preset: 'custom' })
  }

  const curColorMode = settings?.candleColorMode || 'netchange'
  const setColorMode = (val) => {
    if (val === curColorMode) return
    onChange?.({ ...settings, candleColorMode: val, preset: 'custom' })
  }
  const showColorMode = true

  // Candle colors. Candles/Hollow expose Body / Borders / Wick separately; bars &
  // line/area just use the body (up/down) color. 'onecolor' mode = a single color.
  const candles = settings?.candles || {}
  const grid = settings?.grid || {}
  const crosshair = settings?.crosshair || {}
  // Three-way crosshair state (always / hold / off) — DERIVED through the resolver,
  // never read off a field, so a blob predating `mode` (which carries only the
  // legacy `crosshair.enabled` boolean) resolves consistently. Mirrors legendMode.
  const crosshairMode = crosshairModeOf(settings)
  const watermark = settings?.watermark || {}
  const isCandleType = curType === 'candles' || curType === 'hollow'
  const bgMode = settings?.bgMode || 'solid'

  // A color "target" → the nested settings path it writes. Covers candles + canvas.
  const COLOR_PATHS = {
    bodyUp: ['candles', 'upColor'], bodyDown: ['candles', 'downColor'],
    borderUp: ['candles', 'upBorder'], borderDown: ['candles', 'downBorder'],
    wickUp: ['candles', 'upWick'], wickDown: ['candles', 'downWick'],
    one: ['candles', 'oneColor'],
    bg: ['background'], bgTop: ['bgGradient', 'top'], bgBottom: ['bgGradient', 'bottom'],
    grid: ['grid', 'color'], crosshair: ['crosshair', 'color'], text: ['textColor'],
    // Per-item header/legend colors (Header tab → Show). Day change is a pair.
    hdrDayUp: ['header', 'colors', 'dayChangeUp'],
    hdrDayDown: ['header', 'colors', 'dayChangeDown'],
    hdrTitle: ['header', 'colors', 'title'],
    hdrMarketCap: ['header', 'colors', 'marketCap'],
    hdrNextEarnings: ['header', 'colors', 'nextEarnings'],
    hdrUctRating: ['header', 'colors', 'uctRating'],
    hdrLegend: ['header', 'colors', 'legend'],
    // Swing-label colors (Markers tab).
    swingColor: ['swingLabels', 'color'],
    swingUp: ['swingLabels', 'upColor'],
    swingDown: ['swingLabels', 'downColor'],
    swingBg: ['swingLabels', 'bg'],
    // Earnings beat/miss badge colors (also color the popover surprise rows).
    earnBeat: ['markers', 'earningsBeat'],
    earnMiss: ['markers', 'earningsMiss'],
    // Previous-day H/L/C line colors (Markers tab).
    pdlHighColor: ['prevDayLevels', 'high', 'color'],
    pdlLowColor: ['prevDayLevels', 'low', 'color'],
    pdlCloseColor: ['prevDayLevels', 'close', 'color'],
    // Dark-pool overlay bar + label colors (Indicators tab). 8-digit hex so the
    // color menu's opacity slider is stored inline; StockChart splits it.
    dpBarColor: ['darkPool', 'barColor'],
    dpLabelColor: ['darkPool', 'labelColor'],
  }
  const setColorTarget = (target, hex) => {
    if (isIndTarget(target)) {
      const { rowId, field } = splitIndTarget(target)
      const row = indRowById(rowId)
      if (row) setRow(row, { [field]: hex })
      return
    }
    // Watermark keeps color + opacity as SEPARATE settings (the chart reads them
    // apart), so map the picker's 8-digit color → {color, opacity}.
    if (target === 'watermark') {
      const { rgb, a } = splitHexA(hex)
      onChange?.({ ...settings, watermark: { ...watermark, color: rgb, opacity: a }, preset: 'custom' })
      return
    }
    // Per-field Info Row colors: `hdrf:<colorKey>` → header.colors[colorKey].
    if (target.startsWith('hdrf:')) {
      const key = target.slice(5)
      const h = settings?.header || {}
      onChange?.({ ...settings, header: { ...h, colors: { ...(h.colors || {}), [key]: hex } }, preset: 'custom' })
      return
    }
    const path = COLOR_PATHS[target]; if (!path) return
    const next = { ...settings }
    let o = next
    for (let i = 0; i < path.length - 1; i++) { o[path[i]] = { ...(o[path[i]] || {}) }; o = o[path[i]] }
    o[path[path.length - 1]] = hex
    next.preset = 'custom'
    onChange?.(next)
  }
  // Hand-written rows (MA overlays + the volume pane, which the engine cannot own)
  // followed by the rows GENERATED from the engine definitions. Neither this file
  // nor the registry names an engine indicator's fields.
  //
  // ⚠️ `volumePaneFixed` STILL HAS TO REACH THE VOLUME ROW. It used to be passed
  // to `listIndicators` here; `listAllIndicators` forwards the same options object
  // to it, so master's inert-toggle reason (`f3d9daba`) survives B4's switch to
  // generated rows.
  const indRows = listAllIndicators(settings, engineRegistry, { volumePaneFixed })
  const indRowById = (id) => indRows.find((r) => r.id === id)
  /** One writer for every row: `patchFor` for the hand-written ones, and
   *  `instanceControls` for the engine-owned ones — the same writer the toolbar
   *  checkbox, both right-click doors and the four keyboard shortcuts share. A
   *  refused write returns the settings unchanged by identity, so nothing persists. */
  const setRow = (row, patch) => {
    const next = applyRowPatch(row, patch, settings, engineRegistry)
    if (next !== settings) onChange?.({ ...next, preset: 'custom' })
  }

  const targetValue = (t) => {
    // Registry-driven indicator fields carry their path in the target string, so the
    // switch below never needs a case per indicator.
    if (isIndTarget(t)) {
      const { rowId, field } = splitIndTarget(t)
      return indRowById(rowId)?.values?.[field] || '#c9a84c'
    }
    if (t.startsWith('hdrf:')) {
      const key = t.slice(5)
      const ov = settings?.header?.colors?.[key]
      if (ov) return ov
      // Signed field halves (`<colorKey>:pos` / `:neg`) default to green / red.
      if (key.endsWith(':pos')) return SIGN_POS
      if (key.endsWith(':neg')) return SIGN_NEG
      const hf = HEADER_FIELDS.find((x) => x.colorKey === key)
      return (hf && hf.dflt) || '#9b9684'   // neutral placeholder for auto/sign-tinted fields
    }
    switch (t) {
      case 'bodyUp': return candles.upColor || '#1ae51a'
      case 'bodyDown': return candles.downColor || '#c41f2d'
      case 'borderUp': return candles.upBorder || candles.upColor || '#1ae51a'
      case 'borderDown': return candles.downBorder || candles.downColor || '#c41f2d'
      case 'wickUp': return candles.upWick || candles.upColor || '#1ae51a'
      case 'wickDown': return candles.downWick || candles.downColor || '#c41f2d'
      case 'one': return candles.oneColor || candles.upColor || '#1ae51a'
      case 'bg': return settings.background || '#0e0f0d'
      case 'bgTop': return settings.bgGradient?.top || '#16233b'
      case 'bgBottom': return settings.bgGradient?.bottom || '#0e0f0d'
      case 'grid': return grid.color || 'rgba(46,49,39,0.25)'
      case 'crosshair': return crosshair.color || '#706b5e'
      case 'text': return settings.textColor || '#706b5e'
      case 'watermark': return joinHexA(watermark.color || '#a8a290', (watermark.opacity == null || watermark.opacity === 0.07) ? 0.82 : watermark.opacity)
      // Header/legend colors: the stored value, else the item's built-in default so
      // the swatch reads as the current on-screen color before the user changes it.
      case 'hdrDayUp': return hdrColors.dayChangeUp || '#1ae51a'
      case 'hdrDayDown': return hdrColors.dayChangeDown || '#ff3b47'
      case 'hdrTitle': return hdrColors.title || '#c9a84c'
      case 'hdrMarketCap': return hdrColors.marketCap || '#c9a84c'
      case 'hdrNextEarnings': return hdrColors.nextEarnings || '#6ba3be'
      case 'hdrUctRating': return hdrColors.uctRating || '#1ae51a'  // price-candle up-green
      case 'hdrLegend': return hdrColors.legend || '#a8a290'
      case 'swingColor': return swing.color || '#d4d0c4'
      case 'swingUp': return swing.upColor || '#4ade80'
      case 'swingDown': return swing.downColor || '#f87171'
      // Unset background halo matches the canvas, so show that as the swatch default.
      case 'swingBg': return swing.bg || settings.background || '#0e0f0d'
      case 'earnBeat': return evtMarkers.earningsBeat || '#1ae51a'
      case 'earnMiss': return evtMarkers.earningsMiss || '#c41f2d'
      case 'pdlHighColor': return settings.prevDayLevels?.high?.color || '#3cb868'
      case 'pdlLowColor': return settings.prevDayLevels?.low?.color || '#e74c3c'
      case 'pdlCloseColor': return settings.prevDayLevels?.close?.color || '#9aa0a6'
      case 'dpBarColor': return settings.darkPool?.barColor || '#c9a84ccc'
      case 'dpLabelColor': return settings.darkPool?.labelColor || '#c9a84c'
      default: return '#1ae51a'
    }
  }
  const setSetting = (patch) => onChange?.({ ...settings, ...patch, preset: 'custom' })
  const setBgMode = (m) => { if (m !== bgMode) setSetting({ bgMode: m }) }
  const setGridVisible = (v) => setSetting({ grid: { ...grid, visible: v } })
  const setWmVisible = (v) => setSetting({ watermark: { ...watermark, visible: v } })
  const setWmLine = (key, v) => setSetting({ watermark: { ...watermark, lines: { ...(watermark.lines || {}), [key]: v } } })
  const setWmSize = (v) => setSetting({ watermark: { ...watermark, sizeScale: v } })
  const setWmWeight = (v) => setSetting({ watermark: { ...watermark, weight: v } })
  const wmLines = watermark.lines || {}
  const wmSize = watermark.sizeScale ?? 1.0
  const wmWeight = watermark.weight ?? 700
  // Watermark size scale options (× the base per-role font). Shown as percent.
  const WM_SIZES = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4]
  const WM_WEIGHTS = [[300, 'Thin'], [400, 'Light'], [500, 'Regular'], [600, 'Medium'], [700, 'Bold'], [800, 'Heavy']]
  // Header tab.
  const header = settings?.header || {}
  const setHeader = (patch) => setSetting({ header: { ...header, ...patch } })
  // Through the resolver, never off `header.legendMode` — a user whose blob
  // predates the mode carries only the legacy `showLegend`, and reading the field
  // directly would show them "Always" while their chart draws nothing.
  const legendMode = legendModeOf(settings)
  // Info Row — the picked fields (migrates a legacy show* blob); the picker menu state
  // lives up top with the other hooks (this code runs after the `!open` early return).
  const infoFields = headerFieldKeys(header)
  const toggleInfoField = (key) => setHeader({
    fields: infoFields.includes(key) ? infoFields.filter((k) => k !== key) : [...infoFields, key],
  })
  const hdrColors = header.colors || {}
  // Markers tab.
  const swing = settings?.swingLabels || {}
  const setSwing = (patch) => setSetting({ swingLabels: { ...swing, ...patch } })
  const evtMarkers = settings?.markers || {}
  const setMarker = (key, v) => setSetting({ markers: { ...evtMarkers, [key]: v } })
  // Previous-day H/L/C reference lines (Markers tab).
  const pdl = settings?.prevDayLevels || {}
  const setPrevDay = (key, patch) => setSetting({ prevDayLevels: { ...pdl, [key]: { ...(pdl[key] || {}), ...patch } } })
  const PDL_LINES = [['high', 'Prev-day high'], ['low', 'Prev-day low'], ['close', 'Prev-day close']]
  const PDL_COLOR_TARGET = { high: 'pdlHighColor', low: 'pdlLowColor', close: 'pdlCloseColor' }
  const LINE_STYLES = [['solid', 'Solid'], ['dashed', 'Dashed'], ['dotted', 'Dotted']]
  const SWING_SENS = [['low', 'Low'], ['medium', 'Med'], ['high', 'High']]
  // 'desk' = Desk-mention markers (spec 2026-08-11 §C). Opt-in like News: it carries
  // no default in CHART_DEFAULTS.markers, so an unset blob reads undefined → OFF.
  const EVENT_MARKERS = [['earnings', 'Earnings'], ['splits', 'Splits'], ['dividends', 'Dividends'], ['news', 'News'], ['desk', 'Desk mentions']]
  const TEXT_SIZES = [8, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 32, 40]
  const curTextSize = settings.textSize ?? 11
  const colorSwatch = (target, label, bg) => (
    <button
      type="button"
      data-color-swatch
      className={`${styles.cSwatch} ${activeTarget?.target === target ? styles.cSwatchActive : ''}`}
      style={{ background: bg || targetValue(target) }}
      title={label}
      onClick={() => setActiveTarget({ target, label })}
    />
  )

  // A "Show X" row: color swatch(es) (only while on) + an on/off switch. Shared by the
  // Title's Day-change row and the Chart-legend row.
  const renderShowRow = (key, label, swatches = []) => {
    const on = header[key] !== false
    return (
      <div className={styles.field} key={key}>
        <span className={styles.fieldLabel}>{label}</span>
        <div className={styles.hdrRowCtl}>
          {on && swatches.map(([target, pickerLabel]) => (
            <span key={target}>{colorSwatch(target, pickerLabel)}</span>
          ))}
          <button
            type="button" role="switch" aria-checked={on}
            className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
            onClick={() => setHeader({ [key]: header[key] === false })}
          ><span className={styles.toggleKnob} /></button>
        </div>
      </div>
    )
  }

  return (
    <>
      {createPortal(
        <div className={styles.backdrop} onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Chart settings">
      <div
        className={styles.panel}
        ref={panelRef}
        onMouseDown={(e) => e.stopPropagation()}
        style={{ ...(themeVars || {}), ...(pos ? { position: 'fixed', left: pos.left, top: pos.top, margin: 0, animation: 'none' } : {}) }}
      >
        <div className={styles.header} onPointerDown={startDrag} style={{ cursor: 'move' }}>
          <span className={styles.title}>Chart Settings</span>
          <div className={styles.headerRight} onPointerDown={e => e.stopPropagation()}>
            <button
              type="button"
              className={`${styles.resetBtn}${confirmReset ? ' ' + styles.resetBtnConfirm : ''}`}
              onClick={handleReset}
              title="Restore all chart settings to defaults"
              style={{ cursor: 'pointer' }}
            >{confirmReset ? 'Confirm?' : '↺ Restore Defaults'}</button>
            <button type="button" data-modal-close className={styles.close} onClick={onClose} aria-label="Close" style={{ cursor: 'pointer' }}>✕</button>
          </div>
        </div>

        {/* Template bar: save the whole current look, or open a saved one. Applying
            writes to THIS surface (the tab/widget you opened settings from) via
            onChange — never the global blob. */}
        <div className={styles.tplBar} onPointerDown={e => e.stopPropagation()}>
          <div className={styles.tplMenuWrap}>
            <button
              type="button"
              className={styles.tplBtn}
              onClick={() => setTplMenuOpen(o => !o)}
              aria-haspopup="listbox"
              aria-expanded={tplMenuOpen}
              title="Open a saved chart-settings template"
            >⌸ Templates{templates.length ? ` (${templates.length})` : ''} ▾</button>
            {tplMenuOpen && (
              <div className={styles.tplMenu} role="listbox">
                {templates.length === 0 && (
                  <div className={styles.tplEmpty}>No saved templates yet. Set up a chart, then “Save as Template”.</div>
                )}
                {templates.map(t => (
                  <div key={t.id} className={styles.tplRow}>
                    <button
                      type="button"
                      className={styles.tplApply}
                      onClick={() => applyTemplate(t)}
                      title={`Apply “${t.name}” to this chart`}
                    >{t.name}</button>
                    <button
                      type="button"
                      className={styles.tplDelete}
                      onClick={() => deleteTemplate(t.id)}
                      aria-label={`Delete template ${t.name}`}
                      title="Delete template"
                    >✕</button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {savingTpl ? (
            <div className={styles.tplSaveRow}>
              <input
                ref={tplInputRef}
                className={styles.tplInput}
                value={tplName}
                onChange={(e) => setTplName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); commitSaveTemplate() }
                  else if (e.key === 'Escape') { e.preventDefault(); setSavingTpl(false); setTplName('') }
                }}
                placeholder="Template name"
                maxLength={40}
              />
              <button type="button" className={styles.tplSaveBtn} onClick={commitSaveTemplate}>Save</button>
              <button type="button" className={styles.tplCancelBtn} onClick={() => { setSavingTpl(false); setTplName('') }}>Cancel</button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.tplBtn}
              onClick={() => { setSavingTpl(true); setTplMenuOpen(false) }}
              title="Save the current chart settings as a reusable template"
            >＋ Save as Template</button>
          )}
          {/* Pushed to the far right of the template row; same visual style as the
              template buttons (not a special accent) per owner request. */}
          <button
            type="button"
            className={`${styles.tplBtn} ${styles.themesBarBtn}`}
            onClick={() => setThemesOpen(true)}
            title="Browse UCT chart themes — one-click looks for this chart"
          >🎨 UCT Chart Themes</button>
        </div>

        <div className={styles.tabs} role="tablist">
          {[['price', 'Price Style'], ['canvas', 'Canvas'], ['indicators', 'Indicators'], ['header', 'Header'], ['markers', 'Markers']].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={activeTab === id}
              className={`${styles.tab} ${activeTab === id ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(id)}
            >{label}</button>
          ))}
        </div>

        <div className={styles.body}>
          {activeTab === 'canvas' && (<>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Background</div>
            <div className={styles.card}>
              <div className={styles.seg} role="tablist">
                {[['solid', 'Solid'], ['gradient', 'Gradient']].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    role="tab"
                    aria-selected={bgMode === val}
                    className={`${styles.segBtn} ${bgMode === val ? styles.segBtnActive : ''}`}
                    onClick={() => setBgMode(val)}
                  >{label}</button>
                ))}
              </div>
              {bgMode === 'solid' ? (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Color</span>
                  {colorSwatch('bg', 'Background')}
                </div>
              ) : (<>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Top</span>
                  {colorSwatch('bgTop', 'Gradient Top')}
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Bottom</span>
                  {colorSwatch('bgBottom', 'Gradient Bottom')}
                </div>
              </>)}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Grid</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Show grid lines</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={grid.visible !== false}
                  className={`${styles.toggle} ${grid.visible !== false ? styles.toggleOn : ''}`}
                  onClick={() => setGridVisible(grid.visible === false)}
                ><span className={styles.toggleKnob} /></button>
              </div>
              {grid.visible !== false && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Line color</span>
                  {colorSwatch('grid', 'Grid')}
                </div>
              )}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Crosshair &amp; Text</div>
            <div className={styles.card}>
              {/* Three-way control (Always / Hold / Off), mirroring Chart legend.
                  Writes ONLY `crosshair.mode`; the legacy `crosshair.enabled`
                  boolean survives as a read-only fallback (see crosshairMode.js),
                  so nothing here toggles it. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Crosshair</span>
                <div className={styles.seg} role="tablist">
                  {CROSSHAIR_MODES.map((val) => (
                    <button
                      key={val} type="button" role="tab"
                      aria-selected={crosshairMode === val}
                      title={CROSSHAIR_MODE_LABELS[val].hint}
                      className={`${styles.segBtn} ${crosshairMode === val ? styles.segBtnActive : ''}`}
                      onClick={() => setSetting({ crosshair: { ...crosshair, mode: val } })}
                    >{CROSSHAIR_MODE_LABELS[val].label}</button>
                  ))}
                </div>
              </div>
              {crosshairMode !== 'off' && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Line color</span>
                  {colorSwatch('crosshair', 'Crosshair')}
                </div>
              )}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Scale text</span>
                <div className={styles.fieldControls}>
                  <select
                    className={styles.sizeSelect}
                    value={curTextSize}
                    onChange={(e) => setSetting({ textSize: Number(e.target.value) })}
                    aria-label="Scale text size"
                  >
                    {TEXT_SIZES.map((px) => <option key={px} value={px}>{px}</option>)}
                  </select>
                  {colorSwatch('text', 'Scale Text')}
                </div>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Axis Labels</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Price labels</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={settings.showPriceLabels !== false}
                  aria-label="Show price labels on the axis"
                  className={`${styles.toggle} ${settings.showPriceLabels !== false ? styles.toggleOn : ''}`}
                  onClick={() => setSetting({ showPriceLabels: settings.showPriceLabels === false })}
                ><span className={styles.toggleKnob} /></button>
              </div>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Moving average labels</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={!!settings.showMaLabels}
                  aria-label="Show moving average labels on the axis"
                  className={`${styles.toggle} ${settings.showMaLabels ? styles.toggleOn : ''}`}
                  onClick={() => setSetting({ showMaLabels: !settings.showMaLabels })}
                ><span className={styles.toggleKnob} /></button>
              </div>
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Watermark</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Show watermark</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={watermark.visible !== false}
                  className={`${styles.toggle} ${watermark.visible !== false ? styles.toggleOn : ''}`}
                  onClick={() => setWmVisible(watermark.visible === false)}
                ><span className={styles.toggleKnob} /></button>
              </div>
              {watermark.visible !== false && (<>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Fields</span>
                  <div className={styles.chipRow}>
                    {[['ticker', 'Ticker'], ['company', 'Company'], ['sector', 'Sector'], ['industry', 'Industry'], ['theme', 'Theme']].map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        className={`${styles.chip} ${wmLines[key] !== false ? styles.chipOn : ''}`}
                        onClick={() => setWmLine(key, wmLines[key] === false)}
                        aria-pressed={wmLines[key] !== false}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Size</span>
                  <select
                    className={styles.sizeSelect}
                    value={wmSize}
                    onChange={(e) => setWmSize(Number(e.target.value))}
                    aria-label="Watermark size"
                  >
                    {WM_SIZES.map((s) => <option key={s} value={s}>{Math.round(s * 100)}%</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Weight</span>
                  <select
                    className={styles.sizeSelect}
                    value={wmWeight}
                    onChange={(e) => setWmWeight(Number(e.target.value))}
                    aria-label="Watermark font weight"
                  >
                    {WM_WEIGHTS.map(([w, label]) => <option key={w} value={w}>{label}</option>)}
                  </select>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Color &amp; opacity</span>
                  {colorSwatch('watermark', 'Watermark', watermark.color || '#a8a290')}
                </div>
              </>)}
            </div>
          </section>
          </>)}
          {activeTab === 'indicators' && (<>
          {/* Rendered ENTIRELY from the rows — no per-indicator JSX, and no
              hardcoded section list either. The groups come from the rows in row
              order, so a definition added to `nativeRegistry` brings its own
              section with it (B4 Task 6 deleted `ENGINE_ROW_DEF_IDS`, the list
              of which definitions got a generated row; every one of them does
              now). The three group names used to be an array literal here, and
              it was an enumeration site of its own: a row in a group nobody had
              listed rendered NOTHING, silently, until someone remembered to add
              it. `enumerationSites.test.js` fails if it returns. */}
          {[...new Set(indRows.map((r) => r.group))].map((group) => {
            const rows = indRows.filter((r) => r.group === group)
            if (!rows.length) return null
            return (
              <section key={group} className={styles.section}>
                <div className={styles.sectionLabel}>{group}</div>
                {rows.map((row) => {
                  const on = readEnabled(row)
                  const enabledKey = row.enabledKey || 'enabled'
                  const set = (patch) => setRow(row, patch)
                  return (
                    <div key={row.id} className={styles.indBlock}>
                      <div className={styles.indHead}>
                        <button
                          type="button" role="switch" aria-checked={on} aria-label={`Toggle ${row.label}`}
                          className={`${styles.toggle} ${on ? styles.toggleOn : ''}`}
                          onClick={() => set({ [enabledKey]: !on })}
                        ><span className={styles.toggleKnob} /></button>
                        <span className={styles.indName}>{row.label}</span>
                      </div>
                      {on && row.fields.map((f) => {
                        if (f.showIf && !f.showIf(row.values)) return null
                        const val = row.values?.[f.key]
                        const dis = !!f.disabled
                        // ⛔ THE REASON HAS TO REACH A SCREEN READER, NOT JUST A POINTER.
                        //
                        // `f.disabled` carries a sentence ("Coming soon — needs renderer
                        // support", "Fixed by this chart's layout") and it was rendered
                        // ONLY as a `title` on the row below — a hover tooltip. Measured
                        // on production 2026-08-15: the five MA rows ship `Offset` and
                        // `Plot style` inert, and the controls carried `disabled` with
                        // NO `aria-disabled` and no description, so assistive tech got
                        // "dimmed, no reason" while a mouse user got the sentence. The
                        // toggle branch below already put the reason on the control; the
                        // number and select branches did not, which is the same
                        // inconsistency that let the toggle ship live-but-inert.
                        //
                        // `IndicatorSettingsDialog` states the rule this follows:
                        // "`aria-disabled` alongside `disabled` so the reason reaches
                        // assistive tech, which a bare `disabled` attribute does not
                        // carry." The sentence is bound with `aria-describedby` to a
                        // visually-hidden span (the global `.sr-only` in tokens.css), so
                        // nothing about the rendered layout changes.
                        const whyId = dis ? `ind-why-${row.id}-${f.key}` : undefined
                        const inert = dis
                          ? { disabled: true, 'aria-disabled': 'true', title: f.disabled, 'aria-describedby': whyId }
                          : {}
                        return (
                          <div key={f.key} className={styles.indRow} title={f.disabled || undefined}>
                            <span className={`${styles.indLabel} ${dis ? styles.indLabelOff : ''}`}>{f.label}</span>
                            {dis && <span id={whyId} className="sr-only">{f.disabled}</span>}
                            {f.type === 'color' && colorSwatch(indTarget(row.id, f.key), f.label, val)}
                            {f.type === 'toggle' && (
                              /* `disabled` is load-bearing, not decoration: a disabled
                                 <button> fires no click, so an inert field can't write
                                 a pref the surface will ignore. The number/select
                                 branches below already honored f.disabled — the toggle
                                 didn't, which is how a "not applicable here" field
                                 could still look (and act) live. */
                              <button
                                type="button" role="switch" aria-checked={val !== false} aria-label={f.label}
                                {...inert}
                                className={`${styles.toggle} ${val !== false ? styles.toggleOn : ''} ${dis ? styles.toggleOff : ''}`}
                                onClick={() => set({ [f.key]: val === false })}
                              ><span className={styles.toggleKnob} /></button>
                            )}
                            {f.type === 'number' && (
                              <input
                                type="number" className={styles.indNum} {...inert}
                                min={f.min} max={f.max} step={f.step} value={val ?? ''}
                                onChange={(e) => set({ [f.key]: Number(e.target.value) })}
                              />
                            )}
                            {f.type === 'select' && (
                              <select
                                className={styles.indSelect} {...inert} value={val ?? ''}
                                onChange={(e) => {
                                  const raw = e.target.value
                                  const opt = f.options.find(([v]) => String(v) === raw)
                                  set({ [f.key]: opt ? opt[0] : raw })
                                }}
                              >
                                {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                              </select>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )
                })}
              </section>
            )
          })}
          </>)}

          {activeTab === 'header' && (<>
          {/* TITLE — the ticker/company label + its color + the day-change readout that
              sits right beside it (all "the title line", so they're grouped together). */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Title</div>
            <div className={styles.modeRow}>
              {TITLE_MODES.map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  className={`${styles.modeCard} ${(header.titleMode || 'company') === val ? styles.modeCardActive : ''}`}
                  onClick={() => setHeader({ titleMode: val })}
                  aria-pressed={(header.titleMode || 'company') === val}
                >
                  <span className={styles.modeName}>{label}</span>
                </button>
              ))}
            </div>
            {/* Title color — same swatch/ColorPanel mechanism as the other header
                items, so it supports opacity. Unset keeps the built-in gold. */}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Title color</span>
              <div className={styles.hdrRowCtl}>{colorSwatch('hdrTitle', 'Title color')}</div>
            </div>
            {/* Day change ($ / %) — reads beside the title, so it lives in this section. */}
            {renderShowRow('showChange', 'Day change ($ / %)',
              [['hdrDayUp', 'Up-day color'], ['hdrDayDown', 'Down-day color']])}
          </section>

          {/* CHART LEGEND — its own section (the on-chart OHLCV readout + its shape). */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Chart Legend</div>
            <div className={styles.card}>
              {/* ⚰️ A SHOW/HIDE TOGGLE STOOD HERE (`renderShowRow('showLegend', …)`)
                  and is replaced by a three-way control rather than joined by one.
                  Two controls over one fact — a boolean AND a mode — is the defect
                  the resolver exists to prevent; `header.showLegend` survives ONLY
                  as a read-only fallback for blobs written before the mode, and
                  nothing writes it any more. The toolbar's eye button cycles the
                  same key. */}
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Chart legend</span>
                <div className={styles.hdrRowCtl}>
                  {legendMode !== 'off' && colorSwatch('hdrLegend', 'Chart legend color')}
                  <div className={styles.seg} role="tablist">
                    {LEGEND_MODES.map((val) => (
                      <button
                        key={val} type="button" role="tab"
                        aria-selected={legendMode === val}
                        title={LEGEND_MODE_LABELS[val].hint}
                        className={`${styles.segBtn} ${legendMode === val ? styles.segBtnActive : ''}`}
                        onClick={() => setHeader({ legendMode: val })}
                      >{LEGEND_MODE_LABELS[val].label}</button>
                    ))}
                  </div>
                </div>
              </div>
              {/* Legend shape. Only meaningful while the legend is shown, and only the
                  Charts workspace honors it (other surfaces keep their own inline row). */}
              {legendMode !== 'off' && (
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Legend layout</span>
                  <div className={styles.seg} role="tablist">
                    {LEGEND_LAYOUTS.map(({ val, label }) => (
                      <button
                        key={val} type="button" role="tab"
                        aria-selected={(header.legendLayout || 'vertical') === val}
                        className={`${styles.segBtn} ${(header.legendLayout || 'vertical') === val ? styles.segBtnActive : ''}`}
                        onClick={() => setHeader({ legendLayout: val })}
                      >{label}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* INFO ROW — an "Add Field" button (beside the label) opens the searchable field
              menu (pops out to the RIGHT of the modal). Every selected field then lists here
              with a color swatch. */}
          <section className={styles.section}>
            <div className={styles.infoRowHead}>
              <span className={styles.sectionLabel} style={{ padding: 0 }}>Info Row</span>
              <button
                type="button"
                ref={fieldWrapRef}
                className={styles.addFieldBtn}
                onClick={() => setFieldMenuOpen((o) => !o)}
                aria-expanded={fieldMenuOpen}
              >＋ Add Field</button>
            </div>
            {infoFields.length > 0 && (
              <div className={styles.card}>
                {infoFields.map((k) => {
                  const f = HEADER_FIELD_BY_KEY[k]
                  if (!f) return null
                  // Signed fields (% change, $ change, N-day…) get TWO swatches: the left
                  // colors positive values, the right colors negative values.
                  return (
                    <div className={styles.field} key={k}>
                      <span className={styles.fieldLabel}>{f.label} color</span>
                      <div className={styles.hdrRowCtl}>
                        {f.signed ? (<>
                          {colorSwatch(`hdrf:${f.colorKey}:pos`, `${f.label} — positive`)}
                          {colorSwatch(`hdrf:${f.colorKey}:neg`, `${f.label} — negative`)}
                        </>) : colorSwatch(`hdrf:${f.colorKey}`, `${f.label} color`)}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
          {/* Timeframes/Favorites are managed on the chart's own timeframe menu (the
              ⌄ button) — star to favorite there; no separate settings section. */}
          </>)}
          {activeTab === 'markers' && (<>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Swing labels</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Swing prices</span>
                <button
                  type="button" role="switch" aria-checked={!!swing.enabled} aria-label="Swing prices"
                  className={`${styles.toggle} ${swing.enabled ? styles.toggleOn : ''}`}
                  onClick={() => setSwing({ enabled: !swing.enabled })}
                ><span className={styles.toggleKnob} /></button>
              </div>
              {swing.enabled && (<>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Sensitivity</span>
                  <div className={styles.seg} role="tablist">
                    {SWING_SENS.map(([val, label]) => (
                      <button
                        key={val} type="button" role="tab"
                        aria-selected={(swing.sensitivity || 'medium') === val}
                        className={`${styles.segBtn} ${(swing.sensitivity || 'medium') === val ? styles.segBtnActive : ''}`}
                        onClick={() => setSwing({ sensitivity: val })}
                      >{label}</button>
                    ))}
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Label color</span>
                  {colorSwatch('swingColor', 'Swing label color')}
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Label background</span>
                  <div className={styles.hdrRowCtl}>
                    {swing.bgEnabled !== false && colorSwatch('swingBg', 'Swing label background')}
                    <button
                      type="button" role="switch" aria-checked={swing.bgEnabled !== false} aria-label="Label background"
                      className={`${styles.toggle} ${swing.bgEnabled !== false ? styles.toggleOn : ''}`}
                      onClick={() => setSwing({ bgEnabled: swing.bgEnabled === false })}
                    ><span className={styles.toggleKnob} /></button>
                  </div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Tint by type</span>
                  <div className={styles.hdrRowCtl}>
                    {swing.tintByType && colorSwatch('swingUp', 'Swing-high color')}
                    {swing.tintByType && colorSwatch('swingDown', 'Swing-low color')}
                    <button
                      type="button" role="switch" aria-checked={!!swing.tintByType} aria-label="Tint by type"
                      className={`${styles.toggle} ${swing.tintByType ? styles.toggleOn : ''}`}
                      onClick={() => setSwing({ tintByType: !swing.tintByType })}
                    ><span className={styles.toggleKnob} /></button>
                  </div>
                </div>
              </>)}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Event markers</div>
            <div className={styles.card}>
              {EVENT_MARKERS.map(([key, label]) => (
                <div className={styles.field} key={key}>
                  <span className={styles.fieldLabel}>{label}</span>
                  <div className={styles.hdrRowCtl}>
                    {/* Earnings badge is beat/miss-colored — expose both when it's on. */}
                    {key === 'earnings' && evtMarkers.earnings && (<>
                      {colorSwatch('earnBeat', 'Beat color')}
                      {colorSwatch('earnMiss', 'Miss color')}
                    </>)}
                    <button
                      type="button" role="switch" aria-checked={!!evtMarkers[key]} aria-label={label}
                      className={`${styles.toggle} ${evtMarkers[key] ? styles.toggleOn : ''}`}
                      onClick={() => setMarker(key, !evtMarkers[key])}
                    ><span className={styles.toggleKnob} /></button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Prev-day levels — intraday</div>
            <div className={styles.card}>
              {PDL_LINES.map(([key, label]) => {
                const c = pdl[key] || {}
                return (
                  <div className={styles.field} key={key}>
                    <span className={styles.fieldLabel}>{label}</span>
                    <div className={styles.hdrRowCtl}>
                      {c.enabled && (<>
                        <select
                          className={styles.sizeSelect}
                          aria-label={`${label} line style`}
                          value={c.style || 'dashed'}
                          onChange={(e) => setPrevDay(key, { style: e.target.value })}
                        >
                          {LINE_STYLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                        </select>
                        <select
                          className={styles.sizeSelect}
                          aria-label={`${label} line width`}
                          value={c.width || 1}
                          onChange={(e) => setPrevDay(key, { width: Number(e.target.value) })}
                        >
                          {[1, 2, 3, 4].map((w) => <option key={w} value={w}>{w}px</option>)}
                        </select>
                        {colorSwatch(PDL_COLOR_TARGET[key], `${label} color`)}
                      </>)}
                      <button
                        type="button" role="switch" aria-checked={!!c.enabled} aria-label={label}
                        className={`${styles.toggle} ${c.enabled ? styles.toggleOn : ''}`}
                        onClick={() => setPrevDay(key, { enabled: !c.enabled })}
                      ><span className={styles.toggleKnob} /></button>
                    </div>
                  </div>
                )
              })}
            </div>
          </section>

          {/* Dark Pool — brings the Dark Pool page's print-level bars onto this
              chart. Off by default; paid-gated at fetch (empty for free users).
              Bar + label colors carry opacity via the color menu. */}
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Dark pool</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Show dark pool bars</span>
                <button
                  type="button" role="switch" aria-checked={!!settings.darkPool?.enabled} aria-label="Show dark pool bars"
                  className={`${styles.toggle} ${settings.darkPool?.enabled ? styles.toggleOn : ''}`}
                  onClick={() => setSetting({ darkPool: { ...(settings.darkPool || {}), enabled: !settings.darkPool?.enabled } })}
                ><span className={styles.toggleKnob} /></button>
              </div>
              {settings.darkPool?.enabled && (<>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Bar color</span>
                  <div className={styles.hdrRowCtl}>{colorSwatch('dpBarColor', 'Bar color')}</div>
                </div>
                <div className={styles.field}>
                  <span className={styles.fieldLabel}>Label color</span>
                  <div className={styles.hdrRowCtl}>{colorSwatch('dpLabelColor', 'Label color')}</div>
                </div>
              </>)}
            </div>
          </section>

          <section className={styles.section}>
            <div className={styles.sectionLabel}>Countdown</div>
            <div className={styles.card}>
              <div className={styles.field}>
                <span className={styles.fieldLabel}>Countdown to bar close</span>
                <button
                  type="button" role="switch" aria-checked={!!settings.countdown} aria-label="Countdown to bar close"
                  className={`${styles.toggle} ${settings.countdown ? styles.toggleOn : ''}`}
                  onClick={() => setSetting({ countdown: !settings.countdown })}
                ><span className={styles.toggleKnob} /></button>
              </div>
            </div>
          </section>
          </>)}
          {activeTab === 'price' && (<>
          <section className={styles.section}>
            <div className={styles.sectionLabel}>Type</div>
            <div className={styles.typeGrid}>
              {CHART_TYPES.map(({ val, label }) => (
                <button
                  key={val}
                  type="button"
                  className={`${styles.typeCard} ${curType === val ? styles.typeCardActive : ''}`}
                  onClick={() => setType(val)}
                  aria-pressed={curType === val}
                >
                  <span className={styles.typeGlyph}><TypeGlyph kind={val} /></span>
                  <span className={styles.typeName}>{label}</span>
                </button>
              ))}
            </div>
          </section>

          {/* Bar thickness — OHLC/HLC bars only. Lightweight Charts exposes exactly one
              boolean (thinBars); CandlestickSeries has no width option, so this section
              is hidden for candles/hollow rather than shown as a control that does nothing. */}
          {(curType === 'bars' || curType === 'hlc') && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Bar thickness</div>
              <div className={styles.modeRow}>
                {[{ thin: true, label: 'Thin' }, { thin: false, label: 'Thick' }].map(({ thin, label }) => (
                  <button
                    key={label}
                    type="button"
                    className={`${styles.modeCard} ${(candles.thinBars !== false) === thin ? styles.modeCardActive : ''}`}
                    onClick={() => setSetting({ candles: { ...candles, thinBars: thin } })}
                    aria-pressed={(candles.thinBars !== false) === thin}
                  >
                    <span className={styles.modeName}>{label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {showColorMode && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Color based on</div>
              <div className={styles.modeRow}>
                {COLOR_MODES.map(({ val, label }) => (
                  <button
                    key={val}
                    type="button"
                    className={`${styles.modeCard} ${curColorMode === val ? styles.modeCardActive : ''}`}
                    onClick={() => setColorMode(val)}
                    aria-pressed={curColorMode === val}
                  >
                    <span className={styles.modeName}>{label}</span>
                  </button>
                ))}
              </div>
            </section>
          )}

          {showColorMode && (
            <section className={styles.section}>
              <div className={styles.sectionLabel}>Colors</div>
              {curColorMode === 'onecolor' ? (
                <div className={styles.cGroupsSingle}>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Color</span>
                    <div className={styles.cSwatches}>{colorSwatch('one', 'Color')}</div>
                  </div>
                </div>
              ) : isCandleType ? (
                <div className={styles.cGroups}>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Body</span>
                    <div className={styles.cSwatches}>{colorSwatch('bodyUp', 'Body Up')}{colorSwatch('bodyDown', 'Body Down')}</div>
                  </div>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Borders</span>
                    <div className={styles.cSwatches}>{colorSwatch('borderUp', 'Border Up')}{colorSwatch('borderDown', 'Border Down')}</div>
                  </div>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Wick</span>
                    <div className={styles.cSwatches}>{colorSwatch('wickUp', 'Wick Up')}{colorSwatch('wickDown', 'Wick Down')}</div>
                  </div>
                </div>
              ) : (
                <div className={styles.cGroups}>
                  <div className={styles.cGroup}>
                    <span className={styles.cGroupLabel}>Color</span>
                    <div className={styles.cSwatches}>{colorSwatch('bodyUp', 'Up')}{colorSwatch('bodyDown', 'Down')}</div>
                  </div>
                </div>
              )}
            </section>
          )}
          </>)}
        </div>
      </div>
        </div>,
        document.body,
      )}
      {activeTarget && panelPos && createPortal(
        <div
          data-color-panel
          style={{ position: 'fixed', left: panelPos.left, bottom: panelPos.bottom, zIndex: 9100 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <ColorPanel
            title={activeTarget.label}
            value={targetValue(activeTarget.target)}
            onChange={(hex) => setColorTarget(activeTarget.target, hex)}
            onClose={() => setActiveTarget(null)}
            savedColors={savedColors}
            onSaveColor={onSaveColor}
            onDeleteColor={onDeleteColor}
            line={activeTarget.target === 'crosshair' ? {
              width: crosshair.width ?? 1,
              style: crosshair.style ?? 3,
              onWidth: (w) => setSetting({ crosshair: { ...crosshair, width: w } }),
              onStyle: (s) => setSetting({ crosshair: { ...crosshair, style: s } }),
            } : null}
          />
        </div>,
        document.body,
      )}
      {/* Field picker — portaled to the RIGHT of the modal (like the color panel) so it
          never gets clipped by the modal's bottom. */}
      {fieldMenuOpen && fieldMenuPos && createPortal(
        <div
          ref={fieldMenuRef}
          className={styles.fieldMenu}
          style={{ position: 'fixed', left: fieldMenuPos.left, top: fieldMenuPos.top, right: 'auto', zIndex: 9200 }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <input
            className={styles.fieldSearch}
            placeholder="Search fields…"
            value={fieldQuery}
            onChange={(e) => setFieldQuery(e.target.value)}
            autoFocus
          />
          <div className={styles.fieldList}>
            {HEADER_FIELDS
              .filter((f) => !fieldQuery || f.label.toLowerCase().includes(fieldQuery.toLowerCase()))
              .map((f) => {
                const on = infoFields.includes(f.key)
                return (
                  <button key={f.key} type="button" className={styles.fieldItem} onClick={() => toggleInfoField(f.key)}>
                    <span className={styles.fieldCheck}>{on ? <UIcon name="check" size={11} /> : null}</span>
                    {f.label}
                  </button>
                )
              })}
          </div>
        </div>,
        document.body,
      )}
      <ChartThemesModal
        open={themesOpen}
        onClose={() => setThemesOpen(false)}
        onApply={applyTheme}
        canApplyAll={!!onApplyThemeAll}
        canApplyAllWidgets={!!onApplyThemeAllWidgets}
        currentSettings={settings}
        themeVars={themeVars}
      />
    </>
  )
}
