// ⚙ New Highs / Lows widget settings — canvas (solid / gradient), text size,
// symbol color, and the New-Highs / New-Lows direction colors. Same shared
// ColorPanel + portal placement as the Breadth / Fundamentals settings panels.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from '../../../components/chart/ColorPanel'
import ChoiceMenu from '../../../components/chart/ChoiceMenu'
import { rowToggleClick } from './widgetMenuRowToggle'
import Switch from '../../../components/ui/Switch'
import WidgetThemeSection from './WidgetThemeSection'
import styles from './NhnlSettingsPanel.module.css'
import useWidgetMenuPlacement from './useWidgetMenuPlacement'

const PANEL_W = 268
const BG_MODES = [{ key: 'solid', label: 'Solid' }, { key: 'gradient', label: 'Gradient' }]
const FONT_SIZES = [10, 11, 12, 13, 14]

function Row({ label, hint, children }) {
  return (
    <div className={styles.row}>
      <div className={styles.rowLabel}>{label}{hint && <span className={styles.hint}>{hint}</span>}</div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

export default function NhnlSettingsPanel({ settings: s, onChange, onReset, onClose, gearEl, hostEl, themeVars = null,
  title = 'Highs / lows settings', showLogos = null, onToggleLogos = null, widgetType = 'nhnl' }) {
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
      case 'textColor': return s.textColor || '#f8f7f3'
      case 'upColor': return s.upColor || '#34d17c'
      case 'downColor': return s.downColor || '#f24b42'
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
          <span className={styles.title}>{title}</span>
          <div className={styles.headRight}>
            <button className={styles.uReset} onClick={onReset} title="Restore settings to defaults">Reset</button>
            <button className={styles.close} onClick={onClose} title="Close" aria-label="Close">✕</button>
          </div>
        </div>

        <div className={styles.body} onClick={rowToggleClick(styles.row)}>
          <div className={styles.sectionLabel}>Theme</div>
          <Row label="UCT theme" hint="whole-widget look">
            <WidgetThemeSection
              widgetType={widgetType}
              currentSettings={s}
              onSettings={(next) => onChange(next)}
              themeVars={themeVars}
              buttonClass={styles.uBtn} buttonLabel="UCT themes"
            />
          </Row>
          {showLogos !== null && onToggleLogos && (
            <>
              <div className={styles.sectionLabel}>Display</div>
              <Row label="Logos" hint="company logo by ticker">
                <Switch checked={!!showLogos} onClick={() => onToggleLogos(!showLogos)} aria-label="Logos"
                  className={styles.toggle} checkedClassName={styles.toggleOn} knobClassName={styles.knob} />
              </Row>
            </>
          )}
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

          <div className={styles.sectionLabel}>Text</div>
          <Row label="Text size" hint="row + header text">
            <ChoiceMenu ariaLabel="Row + header text size" title="Row + header text size" value={Number(s.fontSize) || 11}
              options={FONT_SIZES.map(v => ({ value: v, label: String(v) }))}
              onChange={(v) => set({ fontSize: Number(v) })} />
          </Row>

          <div className={styles.sectionLabel}>Text colors</div>
          <Row label="Symbol" hint="ticker + price ink">{swatch('textColor', 'Symbol')}</Row>

          <div className={styles.sectionLabel}>New highs / new lows</div>
          <Row label="Highs" hint="green side">{swatch('upColor', 'New Highs color')}</Row>
          <Row label="Lows" hint="red side">{swatch('downColor', 'New Lows color')}</Row>
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
