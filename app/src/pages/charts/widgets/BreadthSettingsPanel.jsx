// ⚙ Breadth Widget Settings — canvas (solid / gradient), text color, and the
// view color system (palette + intensity, consumed by the breadth views).
// Sibling of FundamentalsSettingsPanel: same placement (side of the widget
// facing the middle of the layout), same shared ColorPanel for swatches.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from '../../../components/chart/ColorPanel'
import ChoiceMenu from '../../../components/chart/ChoiceMenu'
import WidgetThemeSection from './WidgetThemeSection'
import styles from './BreadthSettingsPanel.module.css'
import useWidgetMenuPlacement from './useWidgetMenuPlacement'

const PANEL_W = 268

function Row({ label, hint, children }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

const BG_MODES = [
  { key: 'solid', label: 'Solid' },
  { key: 'gradient', label: 'Gradient' },
]
const PALETTE_CHOICES = [
  ['classic', 'Classic (green/red)'],
  ['colorblind', 'Colorblind (blue/orange)'],
  ['mono', 'Mono (gold)'],
  ['ocean', 'Ocean (cyan/rose)'],
]
const INTENSITY_CHOICES = [
  ['subtle', 'Subtle'],
  ['normal', 'Normal'],
  ['bold', 'Bold'],
]
const TILE_STYLE_CHOICES = [
  ['values', 'Values (numbers only)'],
  ['spark', 'Sparkline (line under value)'],
  ['area', 'Area (filled trend)'],
  ['ghost', 'Backdrop (faint line)'],
]

export default function BreadthSettingsPanel({ settings: s, onChange, onReset, onClose, gearEl, hostEl, themeVars = null, widgetType = 'breadth' }) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [activeTarget, setActiveTarget] = useState(null)
  const [colorPos, setColorPos] = useState(null)

  // Place beside the widget on the side CLOSEST TO THE MIDDLE of the layout.
  useWidgetMenuPlacement({ hostEl, gearEl, panelW: PANEL_W, setPos, onClose })

  // ColorPanel pops to the RIGHT of the menu (flip left if tight).
  useLayoutEffect(() => {
    if (!activeTarget || !panelRef.current) { setColorPos(null); return }
    const r = panelRef.current.getBoundingClientRect()
    const W = 316, gap = 12
    let left = r.right + gap
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - gap)
    const bottom = Math.max(8, window.innerHeight - r.bottom)
    setColorPos({ left: Math.round(left), bottom: Math.round(bottom) })
  }, [activeTarget, pos])

  useEffect(() => {
    const onDown = (e) => {
      if (e.target.closest?.('[data-color-swatch]')) return
      if (e.target.closest?.('[data-color-panel]')) return
      if (e.target.closest?.('[data-uct-theme-gallery]')) return
      if (e.target.closest?.('[data-choice-menu]')) return  // a ChoiceMenu's list is portalled outside the panel
      if (panelRef.current && panelRef.current.contains(e.target)) { setActiveTarget(null); return }
      if (gearEl && gearEl.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') { if (activeTarget) setActiveTarget(null); else onClose?.() } }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [onClose, gearEl, activeTarget])

  const set = (patch) => onChange(patch)

  const targetValue = (t) => {
    switch (t) {
      case 'bg': return s.bg
      case 'gradTop': return s.bgGradient.top
      case 'gradBottom': return s.bgGradient.bottom
      // Unset = follow the palette — show a representative default so the swatch
      // never reads blank.
      case 'upColor': return s.upColor || '#22c55e'
      case 'downColor': return s.downColor || '#ef4444'
      case 'headerColor': return s.headerColor || '#c9a84c'
      case 'valueColor': return s.valueColor || '#e6e6e8'
      default: return s[t]
    }
  }
  const setColorTarget = (t, hex) => {
    if (t === 'gradTop') set({ bgGradient: { ...s.bgGradient, top: hex } })
    else if (t === 'gradBottom') set({ bgGradient: { ...s.bgGradient, bottom: hex } })
    else set({ [t]: hex })
  }

  const swatch = (target, label) => (
    <button
      type="button"
      data-color-swatch
      className={`${styles.swatch}${activeTarget?.target === target ? ' ' + styles.swatchActive : ''}`}
      style={{ background: targetValue(target) }}
      title={label}
      onClick={() => setActiveTarget({ target, label })}
    />
  )

  return createPortal((
    <>
      <div
        ref={panelRef}
        data-side={pos?.side}
        className={styles.panel}
        style={{ ...(themeVars || {}), ...(pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { visibility: 'hidden' }) }}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={styles.title}>Breadth settings</span>
          <div className={styles.headRight}>
            <button className={styles.uReset} onClick={onReset} title="Restore breadth widget settings to defaults">Reset</button>
            <button className={styles.close} onClick={onClose} title="Close" aria-label="Close">✕</button>
          </div>
        </div>

        <div className={styles.body}>
          <div className={styles.sectionLabel}>Theme</div>
          <Row label="UCT theme" hint="whole-widget look">
            <WidgetThemeSection widgetType={widgetType} currentSettings={s} onSettings={(next) => onChange(next)} themeVars={themeVars} buttonClass={styles.uBtn} buttonLabel="UCT themes" />
          </Row>
          {/* Canvas */}
          <div className={styles.sectionLabel}>Canvas</div>
          <Row label="Background">
            <ChoiceMenu ariaLabel="Background" value={s.bgMode}
              options={BG_MODES.map(m => ({ value: m.key, label: m.label }))} onChange={(v) => set({ bgMode: v })} />
          </Row>
          {s.bgMode === 'solid' && <Row label="Canvas color">{swatch('bg', 'Canvas')}</Row>}
          {s.bgMode === 'gradient' && (
            <Row label="Gradient" hint="top → bottom">
              <div className={styles.gradPair}>
                {swatch('gradTop', 'Gradient top')}
                <span className={styles.gradArrow}>→</span>
                {swatch('gradBottom', 'Gradient bottom')}
              </div>
            </Row>
          )}

          {/* Tiles — how each reading renders (numbers, or a woven-in trend line). */}
          <div className={styles.sectionLabel}>Tiles</div>
          <Row label="Tile style" hint="intraday / recent trend line">
            <ChoiceMenu ariaLabel="How each breadth reading renders" title="How each breadth reading renders" value={s.tileStyle || 'values'}
              options={TILE_STYLE_CHOICES.map(([v, l]) => ({ value: v, label: l }))}
              onChange={(v) => set({ tileStyle: v })} />
          </Row>

          {/* Text — two independent colors: headers sit ON the canvas, readings
              sit ON the dark tiles (one shared color fails on a light canvas). */}
          <div className={styles.sectionLabel}>Text colors</div>
          <Row label="Headers" hint="section names + date">{swatch('headerColor', 'Headers')}</Row>
          <Row label="Readings" hint="values on the tiles">{swatch('valueColor', 'Readings')}</Row>

          {/* View colors */}
          <div className={styles.sectionLabel}>View colors</div>
          <Row label="Palette" hint="rings / meters / radar…">
            <ChoiceMenu ariaLabel="View color palette" title="View color palette" value={s.palette}
              options={PALETTE_CHOICES.map(([v, l]) => ({ value: v, label: l }))}
              onChange={(v) => set({ palette: v })} />
          </Row>
          <Row label="Intensity">
            <ChoiceMenu ariaLabel="View color intensity" title="View color intensity" value={s.intensity}
              options={INTENSITY_CHOICES.map(([v, l]) => ({ value: v, label: l }))}
              onChange={(v) => set({ intensity: v })} />
          </Row>

          {/* Custom direction colors — set BOTH and every breadth reading
              recolors from these two hues (severity = darker/lighter shades),
              overriding the palette above. ↺ Reset returns to the palette. */}
          <div className={styles.sectionLabel}>Up / down colors</div>
          <Row label="Up" hint="bullish readings">{swatch('upColor', 'Up color')}</Row>
          <Row label="Down" hint="bearish readings">{swatch('downColor', 'Down color')}</Row>
          {(!s.upColor || !s.downColor) && (
            <div className={styles.hint} style={{ padding: '2px 0 4px' }}>
              Set both to override the palette; severity shades derive automatically.
            </div>
          )}
        </div>
      </div>

      {activeTarget && colorPos && (
        <div data-color-panel style={{ position: 'fixed', left: colorPos.left, bottom: colorPos.bottom, zIndex: 4100 }}>
          <ColorPanel
            title={activeTarget.label}
            value={targetValue(activeTarget.target)}
            onChange={(hex) => setColorTarget(activeTarget.target, hex)}
            onClose={() => setActiveTarget(null)}
          />
        </div>
      )}
    </>
  ), document.body)
}
