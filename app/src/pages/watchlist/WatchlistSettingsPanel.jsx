// ⚙ Watchlist Settings — a compact popover for restyling the watchlist: canvas
// (solid / gradient, to match the chart), per-column text colors, % up/down colors,
// the tick-flash tint, and company logos. Draws on the chart-settings ColorPicker
// but is its own layout. Controlled: `settings` in, `onChange(patch)` out.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPicker from '../../components/chart/ColorPicker'
import UIcon from '../../components/ui/UIcon'
import styles from './WatchlistSettingsPanel.module.css'

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
    <button
      type="button"
      role="switch"
      aria-checked={on}
      className={`${styles.toggle}${on ? ' ' + styles.toggleOn : ''}`}
      onClick={onClick}
      title={label}
    >
      <span className={styles.knob} />
    </button>
  )
}

const BG_MODES = [
  { key: 'default', label: 'Default' },
  { key: 'solid', label: 'Solid' },
  { key: 'gradient', label: 'Gradient' },
]

export default function WatchlistSettingsPanel({ settings: s, onChange, onReset, onClose, anchorEl }) {
  const ref = useRef(null)
  // Portaled to body + fixed-positioned under the gear so the watchlist's
  // overflow:hidden can't clip it. Right-aligned to the gear.
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    if (!anchorEl) return
    const place = () => {
      const r = anchorEl.getBoundingClientRect()
      setPos({ top: Math.round(r.bottom + 6), right: Math.max(8, Math.round(window.innerWidth - r.right)) })
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [anchorEl])

  // Close on outside click / Escape (ignore clicks on the gear so it can toggle).
  useEffect(() => {
    const onDown = (e) => {
      if (ref.current && ref.current.contains(e.target)) return
      if (anchorEl && anchorEl.contains(e.target)) return
      onClose?.()
    }
    const onKey = (e) => { if (e.key === 'Escape') onClose?.() }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [onClose, anchorEl])

  const set = (patch) => onChange(patch)
  const setGrad = (patch) => onChange({ bgGradient: { ...s.bgGradient, ...patch } })

  return createPortal((
    <div
      ref={ref}
      className={styles.panel}
      style={pos ? { top: pos.top, right: pos.right } : { visibility: 'hidden' }}
      onClick={e => e.stopPropagation()}
    >
      <div className={styles.head}>
        <span className={styles.title}><UIcon name="gear" size={13} /> Watchlist Settings</span>
        <button className={styles.close} onClick={onClose} title="Close">✕</button>
      </div>

      <div className={styles.body}>
        {/* ── Canvas ── */}
        <div className={styles.sectionLabel}>Canvas</div>
        <Row label="Background">
          <div className={styles.seg}>
            {BG_MODES.map(m => (
              <button
                key={m.key}
                className={`${styles.segBtn}${s.bgMode === m.key ? ' ' + styles.segBtnOn : ''}`}
                onClick={() => set({ bgMode: m.key })}
              >{m.label}</button>
            ))}
          </div>
        </Row>
        {s.bgMode === 'solid' && (
          <Row label="Canvas color">
            <ColorPicker value={s.bg} onChange={v => set({ bg: v })} />
          </Row>
        )}
        {s.bgMode === 'gradient' && (
          <Row label="Gradient" hint="top → bottom">
            <div className={styles.gradPair}>
              <ColorPicker value={s.bgGradient.top} onChange={v => setGrad({ top: v })} />
              <span className={styles.gradArrow}>→</span>
              <ColorPicker value={s.bgGradient.bottom} onChange={v => setGrad({ bottom: v })} />
            </div>
          </Row>
        )}

        {/* ── Text colors ── */}
        <div className={styles.sectionLabel}>Text colors</div>
        <Row label="Symbol"><ColorPicker value={s.symColor} onChange={v => set({ symColor: v })} /></Row>
        <Row label="Price"><ColorPicker value={s.priceColor} onChange={v => set({ priceColor: v })} /></Row>
        <Row label="Volume"><ColorPicker value={s.volColor} onChange={v => set({ volColor: v })} /></Row>

        {/* ── % change ── */}
        <div className={styles.sectionLabel}>% Change</div>
        <Row label="Up"><ColorPicker value={s.upColor} onChange={v => set({ upColor: v })} /></Row>
        <Row label="Down"><ColorPicker value={s.downColor} onChange={v => set({ downColor: v })} /></Row>

        {/* ── Tick flash ── */}
        <div className={styles.sectionLabel}>Tick flash</div>
        <Row label="Background tint" hint="pulse on each update">
          <Toggle on={s.tintEnabled} onClick={() => set({ tintEnabled: !s.tintEnabled })} label="Toggle tick tint" />
        </Row>
        {s.tintEnabled && (
          <>
            <Row label="Up tint"><ColorPicker value={s.tintUp} onChange={v => set({ tintUp: v })} /></Row>
            <Row label="Down tint"><ColorPicker value={s.tintDown} onChange={v => set({ tintDown: v })} /></Row>
          </>
        )}

        {/* ── Symbol column ── */}
        <div className={styles.sectionLabel}>Symbol column</div>
        <Row label="Company logos">
          <Toggle on={s.showLogos} onClick={() => set({ showLogos: !s.showLogos })} label="Toggle company logos" />
        </Row>
      </div>

      <div className={styles.foot}>
        <button className={styles.resetBtn} onClick={onReset}>Reset to defaults</button>
      </div>
    </div>
  ), document.body)
}
