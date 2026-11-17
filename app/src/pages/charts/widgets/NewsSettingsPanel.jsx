// ⚙ News & Catalysts Settings — canvas (solid / gradient) + text color. A trimmed
// sibling of ThemeTrackerSettingsPanel: portaled beside the widget, each color a
// swatch that opens the shared ColorPanel (same picker the charts use).
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from '../../../components/chart/ColorPanel'
import ChoiceMenu from '../../../components/chart/ChoiceMenu'
import { rowToggleClick } from './widgetMenuRowToggle'
import useSavedColors from '../../../hooks/useSavedColors'
import Switch from '../../../components/ui/Switch'
import WidgetThemeSection from './WidgetThemeSection'
import styles from './NewsSettingsPanel.module.css'
import useWidgetMenuPlacement from './useWidgetMenuPlacement'

const PANEL_W = 268

function Row({ label, hint, title, children }) {
  return (
    <div className={styles.row} title={title}>
      <div className={styles.rowLabel}>
        {label}
        {hint && <span className={styles.hint}>{hint}</span>}
      </div>
      <div className={styles.rowControl}>{children}</div>
    </div>
  )
}

// A two-way On/Off pick (Highlight new, Category, Sound…) is an on/off: the soft square, not a
// dropdown. Same setting values ('on' / 'off'), same key.
const isOnOff = (options = []) => options.length === 2 && options.every(o => o.key === 'on' || o.key === 'off')
  && options[0].key !== options[1].key

const BG_MODES = [
  { key: 'solid', label: 'Solid' },
  { key: 'gradient', label: 'Gradient' },
]

export default function NewsSettingsPanel({ settings: s, onChange, onReset, onClose, gearEl, hostEl, themeVars = null, title = 'News settings', perfLabel = '% change', extraSections = [], showPerf = true, textHint = 'titles & tickers', widgetType = 'news',
  // uct (owner 11-14, /charts board — Notebook first): a dropdown under the gear in the board's
  // menu style (sentence-case labels, soft segmented control, round swatches) instead of a
  // panel beside the widget. Same rows, same handlers; off = the panel exactly as before.
  uct = false }) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [activeTarget, setActiveTarget] = useState(null)   // { target, label }
  const [colorPos, setColorPos] = useState(null)
  const { savedColors, saveColor, deleteColor } = useSavedColors()

  // Place the menu on the side of the widget facing the middle of the layout.
  useWidgetMenuPlacement({ hostEl, gearEl, panelW: PANEL_W, setPos, onClose })  // owner 11-14: beside the widget for every widget (the uct drop-down is retired)

  // ColorPanel beside the menu (flip left if tight), bottom-aligned.
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
        className={`${styles.panel} ${styles.uct}`}
        style={{ ...(themeVars || {}), ...(pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { visibility: 'hidden' }) }}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={styles.title}>{title}</span>
          <div className={styles.headRight}>
            <button className={styles.uReset} onClick={onReset} title="Restore this widget's settings to defaults">Reset</button>
            <button className={styles.close} onClick={onClose} title="Close" aria-label="Close">✕</button>
          </div>
        </div>

        <div className={styles.body} onClick={rowToggleClick(styles.row)}>
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

          {/* Text */}
          <div className={styles.sectionLabel}>Text</div>
          <Row label="Text color" hint={textHint}>{swatch('textColor', 'Text')}</Row>

          {/* Performance / % Change */}
          {showPerf && (
            <>
              <div className={styles.sectionLabel}>{perfLabel}</div>
              <Row label="Up">{swatch('upColor', 'Up %')}</Row>
              <Row label="Down">{swatch('downColor', 'Down %')}</Row>
            </>
          )}

          {/* Optional extra sections — color swatches (default) or a segmented
             * pick control (row.type === 'segmented', e.g. Header shows Ticker/
             * Company/Both). */}
          {extraSections.map(sec => (
            <div key={sec.label}>
              <div className={styles.sectionLabel}>{sec.label}</div>
              {sec.rows.map(r => (
                <Row key={r.key} label={r.label} hint={r.hint} title={r.title}>
                  {r.type === 'segmented' && isOnOff(r.options) ? (
                    <Switch checked={s[r.key] === 'on'} onClick={() => set({ [r.key]: s[r.key] === 'on' ? 'off' : 'on' })}
                      aria-label={r.label} className={styles.toggle} checkedClassName={styles.toggleOn} knobClassName={styles.knob} />
                  ) : r.type === 'segmented' ? (
                    <ChoiceMenu ariaLabel={r.label} value={s[r.key]}
                      options={r.options.map(o => ({ value: o.key, label: o.label }))}
                      onChange={(v) => set({ [r.key]: v })} />
                  ) : swatch(r.key, r.label)}
                </Row>
              ))}
            </div>
          ))}
        </div>
      </div>

      {activeTarget && colorPos && (
        <div data-color-panel style={{ position: 'fixed', left: colorPos.left, bottom: colorPos.bottom, zIndex: 4100 }}>
          <ColorPanel
            title={activeTarget.label}
            value={targetValue(activeTarget.target)}
            onChange={(hex) => setColorTarget(activeTarget.target, hex)}
            onClose={() => setActiveTarget(null)}
            savedColors={savedColors}
            onSaveColor={saveColor}
            onDeleteColor={deleteColor}
          />
        </div>
      )}
    </>
  ), document.body)
}
