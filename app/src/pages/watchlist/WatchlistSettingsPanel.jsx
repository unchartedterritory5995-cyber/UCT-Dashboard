// ⚙ Watchlist Settings — restyle the watchlist: canvas (solid / gradient), per-column
// text colors, % up/down colors, the tick-flash tint (on/off + up/down), company logos.
//
// Layout mirrors the Chart Settings modal: the settings menu pops out to the LEFT of
// the watchlist, and each color is a SWATCH that opens the shared ColorPanel (the exact
// same palette/HSV/opacity picker the charts use) to the RIGHT of the menu.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPanel from '../../components/chart/ColorPanel'
import useSavedColors from '../../hooks/useSavedColors'
import UIcon from '../../components/ui/UIcon'
import { WATCHLIST_FONT_SIZES } from './watchlistSettings'
import styles from './WatchlistSettingsPanel.module.css'

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

function Toggle({ on, onClick, label }) {
  return (
    <button type="button" role="switch" aria-checked={on}
      className={`${styles.toggle}${on ? ' ' + styles.toggleOn : ''}`} onClick={onClick} title={label}>
      <span className={styles.knob} />
    </button>
  )
}

const BG_MODES = [
  { key: 'solid', label: 'Solid' },
  { key: 'gradient', label: 'Gradient' },
]

export default function WatchlistSettingsPanel({
  settings: s, onChange, onReset, onClose, gearEl, hostEl, themeVars = null,
  templates = [], onApplyTemplate, onSaveTemplate, onDeleteTemplate,
}) {
  const panelRef = useRef(null)
  const [pos, setPos] = useState(null)               // settings-menu position (left of the watchlist)
  const [activeTarget, setActiveTarget] = useState(null)  // { target, label } — which color is being edited
  const [colorPos, setColorPos] = useState(null)     // ColorPanel position (right of the menu)
  const { savedColors, saveColor, deleteColor } = useSavedColors()  // global saved colors (shared w/ chart)
  const [tplName, setTplName] = useState('')         // "save current look" name field
  const [tplMenuOpen, setTplMenuOpen] = useState(false)   // Templates ▾ dropdown showing
  const [savingTpl, setSavingTpl] = useState(false)       // inline "name your look" row showing

  const saveTpl = () => {
    const name = tplName.trim()
    if (!name) return
    onSaveTemplate?.(name)
    setTplName('')
    setSavingTpl(false)
  }

  // Place the settings menu to the LEFT of the watchlist (flip to the right if there's
  // no room), portaled so the watchlist's overflow can't clip it.
  useLayoutEffect(() => {
    if (!hostEl) return
    const place = () => {
      const r = hostEl.getBoundingClientRect()
      const gap = 8
      let left = r.left - gap - PANEL_W
      if (left < 8) left = Math.min(window.innerWidth - PANEL_W - 8, r.right + gap)  // no room left → right
      left = Math.max(8, left)
      let top = Math.max(8, r.top)
      const panelH = Math.min(540, Math.round(window.innerHeight * 0.8))
      if (top + panelH > window.innerHeight - 8) top = Math.max(8, window.innerHeight - 8 - panelH)
      setPos({ left: Math.round(left), top: Math.round(top) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [hostEl])

  // Pop the ColorPanel out to the RIGHT of the settings menu (flip left if tight),
  // bottom-aligned to the menu — exactly like Chart Settings.
  useLayoutEffect(() => {
    if (!activeTarget || !panelRef.current) { setColorPos(null); return }
    const r = panelRef.current.getBoundingClientRect()
    const W = 316, gap = 12
    let left = r.right + gap
    if (left + W > window.innerWidth - 8) left = Math.max(8, r.left - W - gap)
    const bottom = Math.max(8, window.innerHeight - r.bottom)
    setColorPos({ left: Math.round(left), bottom: Math.round(bottom) })
  }, [activeTarget, pos])

  // Outside interaction: click a swatch → switch color; click elsewhere in the menu →
  // close the ColorPanel; click fully outside (not gear/menu/color panel) → close all.
  useEffect(() => {
    const onDown = (e) => {
      if (e.target.closest?.('[data-color-swatch]')) return
      if (e.target.closest?.('[data-color-panel]')) return
      // A click anywhere that isn't the Templates control closes its dropdown.
      if (!e.target.closest?.('[data-tpl-wrap]')) setTplMenuOpen(false)
      if (panelRef.current && panelRef.current.contains(e.target)) { setActiveTarget(null); return }
      if (gearEl && gearEl.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      if (activeTarget) setActiveTarget(null)
      else if (tplMenuOpen || savingTpl) { setTplMenuOpen(false); setSavingTpl(false) }
      else onClose?.()
    }
    document.addEventListener('mousedown', onDown, true)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown, true); document.removeEventListener('keydown', onKey) }
  }, [onClose, gearEl, activeTarget, tplMenuOpen, savingTpl])

  const set = (patch) => onChange(patch)

  const targetValue = (t) => {
    switch (t) {
      case 'bg': return s.bg
      case 'gradTop': return s.bgGradient.top
      case 'gradBottom': return s.bgGradient.bottom
      // Unset = AUTO (canvas-derived) — show the dark default's derived line so
      // the swatch reads as the current on-screen gridline, not a blank.
      case 'gridColor': return s.gridColor || 'rgba(255,255,255,0.11)'
      default: return s[t]
    }
  }
  const setColorTarget = (t, hex) => {
    if (t === 'gradTop') set({ bgGradient: { ...s.bgGradient, top: hex } })
    else if (t === 'gradBottom') set({ bgGradient: { ...s.bgGradient, bottom: hex } })
    else set({ [t]: hex })
  }

  // A color SWATCH that opens the shared ColorPanel (same as Chart Settings).
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
        className={styles.panel}
        style={{ ...(themeVars || {}), ...(pos ? { left: pos.left, top: pos.top } : { visibility: 'hidden' }) }}
        onClick={e => e.stopPropagation()}
      >
        <div className={styles.head}>
          <span className={styles.title}><UIcon name="gear" size={13} /> Watchlist Settings</span>
          <div className={styles.headRight}>
            <button className={styles.resetBtn} onClick={onReset} title="Restore watchlist settings to defaults">↺ Reset</button>
            <button className={styles.close} onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        {/* Template bar — save the whole watchlist look (canvas/colors + columns; NO
            symbols) and reapply it to any list later. Mirrors the Chart Settings bar. */}
        <div className={styles.tplBar}>
          <div className={styles.tplMenuWrap} data-tpl-wrap>
            <button
              type="button"
              className={styles.tplBtn}
              onClick={() => { setTplMenuOpen(o => !o); setSavingTpl(false) }}
              aria-haspopup="listbox"
              aria-expanded={tplMenuOpen}
              title="Open a saved watchlist look"
            >⌸ Templates{templates.length ? ` (${templates.length})` : ''} ▾</button>
            {tplMenuOpen && (
              <div className={styles.tplMenu} role="listbox">
                {templates.length === 0 && (
                  <div className={styles.tplEmpty}>No saved looks yet. Style this watchlist, then “Save as Template”.</div>
                )}
                {templates.map(t => (
                  <div key={t.id} className={styles.tplRow}>
                    <button
                      type="button"
                      className={styles.tplApply}
                      title={`Apply “${t.name}”`}
                      onClick={() => { onApplyTemplate?.(t); setTplMenuOpen(false) }}
                    >{t.name}</button>
                    <button
                      type="button"
                      className={styles.tplDel}
                      title="Delete template"
                      aria-label={`Delete template ${t.name}`}
                      onClick={() => onDeleteTemplate?.(t.id)}
                    ><UIcon name="trash" size={12} /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
          {savingTpl ? (
            <div className={styles.tplSaveRow} data-tpl-wrap>
              <input
                autoFocus
                className={styles.tplInput}
                placeholder="Template name"
                value={tplName}
                maxLength={60}
                onChange={e => setTplName(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); saveTpl() }
                  else if (e.key === 'Escape') { e.preventDefault(); setSavingTpl(false); setTplName('') }
                }}
              />
              <button type="button" className={styles.tplSaveBtn} disabled={!tplName.trim()} onClick={saveTpl}>Save</button>
              <button type="button" className={styles.tplCancelBtn} onClick={() => { setSavingTpl(false); setTplName('') }}>Cancel</button>
            </div>
          ) : (
            <button
              type="button"
              className={styles.tplBtn}
              onClick={() => { setSavingTpl(true); setTplMenuOpen(false) }}
              title="Save the current watchlist look as a reusable template"
            >＋ Save as Template</button>
          )}
        </div>

        <div className={styles.body}>
          {/* Canvas */}
          <div className={styles.sectionLabel}>Canvas</div>
          <Row label="Background">
            <div className={styles.seg}>
              {BG_MODES.map(m => (
                <button key={m.key}
                  className={`${styles.segBtn}${s.bgMode === m.key ? ' ' + styles.segBtnOn : ''}`}
                  onClick={() => set({ bgMode: m.key })}>{m.label}</button>
              ))}
            </div>
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
          <Row label="Text size" hint="whole watchlist">
            <select
              className={styles.sizeSelect}
              value={Number(s.fontSize)}
              onChange={e => set({ fontSize: Number(e.target.value) })}
              title="Watchlist text size"
            >
              {WATCHLIST_FONT_SIZES.map(px => <option key={px} value={px}>{px}</option>)}
            </select>
          </Row>

          {/* Text colors */}
          <div className={styles.sectionLabel}>Text colors</div>
          <Row label="Symbol">{swatch('symColor', 'Symbol')}</Row>
          <Row label="Price">{swatch('priceColor', 'Price')}</Row>
          <Row label="Volume">{swatch('volColor', 'Volume')}</Row>

          {/* % change */}
          <div className={styles.sectionLabel}>% Change</div>
          <Row label="Up">{swatch('upColor', 'Up')}</Row>
          <Row label="Down">{swatch('downColor', 'Down')}</Row>

          {/* Gridlines */}
          <div className={styles.sectionLabel}>Gridlines</div>
          <Row label="Line color" hint="all column + row lines">{swatch('gridColor', 'Gridlines')}</Row>

          {/* Tick flash */}
          <div className={styles.sectionLabel}>Tick flash</div>
          <Row label="Background tint" hint="pulse on each update">
            <Toggle on={s.tintEnabled} onClick={() => set({ tintEnabled: !s.tintEnabled })} label="Toggle tick tint" />
          </Row>
          {s.tintEnabled && (
            <>
              <Row label="Up tint">{swatch('tintUp', 'Up tint')}</Row>
              <Row label="Down tint">{swatch('tintDown', 'Down tint')}</Row>
            </>
          )}

          {/* Symbol column */}
          <div className={styles.sectionLabel}>Symbol column</div>
          <Row label="Company logos">
            <Toggle on={s.showLogos} onClick={() => set({ showLogos: !s.showLogos })} label="Toggle company logos" />
          </Row>
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
