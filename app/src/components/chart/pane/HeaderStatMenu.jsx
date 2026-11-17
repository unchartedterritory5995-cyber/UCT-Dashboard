// HeaderStatMenu (owner 11-17) — the quick-edit menu a chart-header stat opens when clicked ("Market Cap", "Next
// Earnings", a custom stat …), like the timeframes, the chart-type switch and the date box beside it.
//
// A small UCT Signature floating panel (the chip menus' look: #111214 panel, sentence-case rows, grey group labels,
// no icons, gold only on the chosen size's ✓-equivalent — here nothing is gold but nothing needs to be). It edits the
// SAME stored keys Chart Settings → Header & legend edits, through the host's writers:
//   · Name        — `header.statLabels` (the settings rename: ≤16 characters, empty = the stat's own name)
//   · Value color — `header.colors[colorKey]` (signed stats: `<colorKey>:pos` / `:neg`)
//   · Label color, shaded box (+ its color), size — `header.statStyle[key]` (headerStatStyle.js)
//   · Remove from header, "+ Add a stat…" and "Header settings…" (Chart Settings on Header & legend).
// Lazy-loaded by ChartPane on the first click, so none of it ships with the header.
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ColorPicker, { PORTAL_POPUP_ATTR } from '../ColorPicker'
import Switch from '../../ui/Switch'
import { STAT_LABEL_MAX, cleanStatLabel } from '../headerStatCatalog'
import { STAT_SIZES, STAT_SIZE_LABELS, DEFAULT_BOX_COLOR } from '../headerStatStyle'
import styles from './HeaderStatMenu.module.css'

const W = 252
const DEFAULT_INK = '#ededed'
const DEFAULT_LABEL_INK = '#cfcac0'

/**
 * @param {object}  props
 * @param {HTMLElement} props.anchor   the stat element that opened it (placement + focus return)
 * @param {object}  props.stat         { key, label (its own name), rename, value, signed, colorKey, valueColor, valueColors }
 * @param {object}  props.look         the stat's stored style ({labelColor, box, boxColor, size})
 */
export default function HeaderStatMenu({ anchor, stat, look = {}, onRename, onValueColor, onStyle, onRemove, onAddStat, onOpenSettings, onClose }) {
  const ref = useRef(null)
  const nameRef = useRef(null)
  const [pos, setPos] = useState(null)
  const name = stat.rename || stat.label
  const size = look.size || 'm'

  useLayoutEffect(() => {
    if (!anchor) return
    const r = anchor.getBoundingClientRect()
    const win = anchor.ownerDocument.defaultView || window
    const h = ref.current ? ref.current.offsetHeight : 320
    const left = Math.max(8, Math.min(r.left, win.innerWidth - W - 8))
    const below = r.bottom + 6
    const top = below + h > win.innerHeight - 8 ? Math.max(8, r.top - 6 - h) : below
    // eslint-disable-next-line react-hooks/set-state-in-effect -- placement needs the measured menu, before paint
    setPos({ left: Math.round(left), top: Math.round(top), target: anchor.ownerDocument.body })
  }, [anchor])

  useEffect(() => { if (pos && nameRef.current) nameRef.current.focus({ preventScroll: true }) }, [!!pos]) // eslint-disable-line react-hooks/exhaustive-deps

  // close on an outside press (a color picker's portalled popup is logically inside) and on Escape; focus goes back
  useEffect(() => {
    const doc = anchor?.ownerDocument || document
    const onDown = (e) => {
      const t = e.target
      if (ref.current?.contains(t) || anchor?.contains(t)) return
      if (t && typeof t.closest === 'function' && t.closest(`[${PORTAL_POPUP_ATTR}]`)) return
      onClose()
    }
    const onKey = (e) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
      try { anchor?.focus?.({ preventScroll: true }) } catch { /* detached */ }
    }
    doc.addEventListener('mousedown', onDown, true)
    doc.addEventListener('keydown', onKey, true)
    return () => { doc.removeEventListener('mousedown', onDown, true); doc.removeEventListener('keydown', onKey, true) }
  }, [anchor, onClose])

  const commitName = (el) => {
    const v = cleanStatLabel(el.value)
    if ((v || stat.label) === name) { el.value = name; return }
    onRename(v)
    if (!v) el.value = stat.label
  }

  const colorRow = (label, value, fallback, onPick, onReset, testId) => (
    <div className={styles.row} data-stat-menu-row={testId}>
      <span className={styles.rowName}>{label}</span>
      <span className={styles.rowCtl}>
        {value ? <button type="button" className={styles.reset} onClick={onReset} aria-label={`${label}: back to default`}>Default</button> : null}
        <ColorPicker value={value || fallback} onChange={onPick} title={label} />
      </span>
    </div>
  )

  if (!anchor) return null
  return createPortal(
    <div ref={ref} className={styles.menu} role="dialog" aria-label={`${name} options`} data-header-stat-menu={stat.key}
      style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: -9999, visibility: 'hidden' }}>
      <div className={styles.head}>
        <span className={styles.headName}>{name}</span>
        {stat.value != null && stat.value !== '' ? <span className={styles.headVal}>{stat.value}</span> : null}
      </div>
      <label className={styles.nameRow}>
        <span className={styles.groupLabel}>Name</span>
        <input
          ref={nameRef}
          key={name}
          className={styles.nameInput}
          defaultValue={name}
          maxLength={Math.max(STAT_LABEL_MAX, name.length)}
          spellCheck={false}
          aria-label={`Name for ${stat.label}`}
          onBlur={(e) => commitName(e.currentTarget)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitName(e.currentTarget) }
            if (e.key === 'Escape' && e.currentTarget.value !== name) { e.stopPropagation(); e.currentTarget.value = name }
          }}
        />
      </label>
      <div className={styles.group}>
        {stat.signed ? (<>
          {colorRow('Value color · up', stat.valueColors?.pos, stat.defaultColors?.pos || DEFAULT_INK, (c) => onValueColor(`${stat.colorKey}:pos`, c), () => onValueColor(`${stat.colorKey}:pos`, null), 'value-pos')}
          {colorRow('Value color · down', stat.valueColors?.neg, stat.defaultColors?.neg || DEFAULT_INK, (c) => onValueColor(`${stat.colorKey}:neg`, c), () => onValueColor(`${stat.colorKey}:neg`, null), 'value-neg')}
        </>) : colorRow('Value color', stat.valueColor, stat.defaultColor || DEFAULT_INK, (c) => onValueColor(stat.colorKey, c), () => onValueColor(stat.colorKey, null), 'value')}
        {colorRow('Label color', look.labelColor, DEFAULT_LABEL_INK, (c) => onStyle({ labelColor: c }), () => onStyle({ labelColor: null }), 'label')}
        <div className={styles.row} data-stat-menu-row="box">
          <span className={styles.rowName}>Shaded box</span>
          <span className={styles.rowCtl}>
            {look.box ? <ColorPicker value={look.boxColor || DEFAULT_BOX_COLOR} onChange={(c) => onStyle({ boxColor: c })} title="Box color" withOpacity /> : null}
            <Switch checked={!!look.box} aria-label="Shaded box" className={styles.switch} checkedClassName={styles.switchOn}
              knobClassName={styles.knob} onClick={() => onStyle({ box: !look.box })} />
          </span>
        </div>
        <div className={styles.row} data-stat-menu-row="size">
          <span className={styles.rowName}>Size</span>
          <span className={styles.sizes} role="group" aria-label="Text size">
            {STAT_SIZES.map((s) => (
              <button key={s} type="button" aria-pressed={size === s} aria-label={`Size ${STAT_SIZE_LABELS[s]}`}
                className={`${styles.size}${size === s ? ' ' + styles.sizeOn : ''}`}
                onClick={() => { if (s !== size) onStyle({ size: s }) }}>{STAT_SIZE_LABELS[s]}</button>
            ))}
          </span>
        </div>
      </div>
      <div className={styles.sep} role="separator" />
      {typeof onAddStat === 'function' && (<>
        <button type="button" className={styles.item} onClick={() => { onClose(); onAddStat('list') }}>Add a stat…</button>
        <button type="button" className={styles.item} onClick={() => { onClose(); onAddStat('custom') }}>Add an indicator value…</button>
      </>)}
      <button type="button" className={styles.item} onClick={() => { onClose(); onOpenSettings() }}>Header settings…</button>
      <button type="button" className={styles.item} onClick={() => { onClose(); onRemove() }}>Remove from header</button>
    </div>,
    pos?.target || anchor.ownerDocument.body,
  )
}
