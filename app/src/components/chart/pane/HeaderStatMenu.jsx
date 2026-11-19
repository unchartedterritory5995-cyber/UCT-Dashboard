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
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { PORTAL_POPUP_ATTR } from '../ColorPicker'
// The UCT color picker Chart Settings uses for every indicator / legend / header color (palette, saved colors,
// custom, opacity) — the same panel, so both surfaces pick colors, and box opacity, the same way.
import ColorPanel from '../ColorPanel'
import Switch from '../../ui/Switch'
import { STAT_LABEL_MAX, cleanStatLabel } from '../headerStatCatalog'
import { STAT_SIZES, STAT_SIZE_LABELS, STAT_WEIGHTS, STAT_WEIGHT_LABELS, STAT_WEIGHT_VALUE, DEFAULT_BOX_COLOR } from '../headerStatStyle'
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
export default function HeaderStatMenu({ anchor, stat, look = {}, onRename, onValueColor, onStyle, onRemove, onAddStat, onOpenSettings, onClose,
  savedColors = [], onSaveColor, onDeleteColor }) {
  const ref = useRef(null)
  const nameRef = useRef(null)
  const [pos, setPos] = useState(null)
  const [picking, setPicking] = useState(null)   // { id, title, value, onChange } — the open color panel
  const [panelPos, setPanelPos] = useState(null)
  const panelRef = useRef(null)
  const name = stat.rename || stat.label
  const size = look.size || 'm'
  const weight = look.weight || 'regular'

  // Placement: under the stat (above it when there is no room), and AGAIN whenever the stat changes size — a size /
  // box / rename pick re-lays the header, so the menu follows its stat instead of floating where it was.
  const place = useCallback(() => {
    if (!anchor || !anchor.isConnected) return
    const r = anchor.getBoundingClientRect()
    const win = anchor.ownerDocument.defaultView || window
    const h = ref.current ? ref.current.offsetHeight : 320
    const left = Math.max(8, Math.min(r.left, win.innerWidth - W - 8))
    const below = r.bottom + 6
    const top = below + h > win.innerHeight - 8 ? Math.max(8, r.top - 6 - h) : below
    setPos((p) => (p && p.left === Math.round(left) && p.top === Math.round(top) ? p
      : { left: Math.round(left), top: Math.round(top), target: anchor.ownerDocument.body }))
  }, [anchor])
  // eslint-disable-next-line react-hooks/set-state-in-effect -- placement needs the measured menu, before paint
  useLayoutEffect(() => { place() }, [place, look.size, look.weight, look.box, name, stat.value])
  useEffect(() => {
    if (!anchor) return undefined
    const win = anchor.ownerDocument.defaultView || window
    let ro = null
    if (typeof win.ResizeObserver === 'function') { ro = new win.ResizeObserver(() => place()); ro.observe(anchor) }
    win.addEventListener('resize', place)
    return () => { if (ro) ro.disconnect(); win.removeEventListener('resize', place) }
  }, [anchor, place])

  // The color panel sits beside the menu (right, or left when there is no room), top-aligned and kept on screen.
  useLayoutEffect(() => {
    if (!picking || !pos) { setPanelPos(null); return }   // eslint-disable-line react-hooks/set-state-in-effect
    const win = anchor?.ownerDocument?.defaultView || window
    const pw = panelRef.current ? panelRef.current.offsetWidth : 260
    const ph = panelRef.current ? panelRef.current.offsetHeight : 420
    const right = pos.left + W + 8
    const left = right + pw <= win.innerWidth - 8 ? right : Math.max(8, pos.left - pw - 8)
    const top = Math.max(8, Math.min(pos.top, win.innerHeight - ph - 8))
    setPanelPos({ left: Math.round(left), top: Math.round(top) })   // eslint-disable-line react-hooks/set-state-in-effect
  }, [picking, pos, anchor])

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
      if (panelRef.current) { setPicking(null); return }   // Escape closes the color panel first
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

  // One color row: a swatch that opens the shared color panel; "Default" when the member set one.
  // the open panel reads its color LIVE from this render (`live[id]`), so it follows every write it makes
  const live = {}
  const colorRow = (label, value, fallback, onPick, onReset, testId) => {
    const shown = value || fallback
    live[testId] = { title: label, value: shown, onChange: onPick }
    const open = picking && picking.id === testId
    return (
      <div className={styles.row} data-stat-menu-row={testId}>
        <span className={styles.rowName}>{label}</span>
        <span className={styles.rowCtl}>
          {value ? <button type="button" className={styles.reset} onClick={onReset} aria-label={`${label}: back to default`}>Default</button> : null}
          <button type="button" className={`${styles.swatch}${open ? ' ' + styles.swatchOn : ''}`} aria-label={label} aria-expanded={!!open}
            data-color-swatch="" onClick={() => setPicking(open ? null : { id: testId })}>
            <span className={styles.swatchInk} style={{ background: shown }} />
          </button>
        </span>
      </div>
    )
  }

  live.box = { title: 'Box color', value: look.boxColor || DEFAULT_BOX_COLOR, onChange: (c) => onStyle({ boxColor: c }) }
  if (!anchor) return null
  const doc = anchor.ownerDocument
  const menu = createPortal(
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
            {look.box ? (
              <button type="button" className={`${styles.swatch}${picking?.id === 'box' ? ' ' + styles.swatchOn : ''}`} aria-label="Box color"
                aria-expanded={picking?.id === 'box'} data-color-swatch=""
                onClick={() => setPicking(picking?.id === 'box' ? null : { id: 'box' })}>
                <span className={styles.swatchInk} style={{ background: look.boxColor || DEFAULT_BOX_COLOR }} />
              </button>
            ) : null}
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
        <div className={styles.row} data-stat-menu-row="weight">
          <span className={styles.rowName}>Thickness</span>
          <span className={styles.sizes} role="group" aria-label="Text thickness">
            {STAT_WEIGHTS.map((w) => (
              <button key={w} type="button" aria-pressed={weight === w} aria-label={`Thickness ${STAT_WEIGHT_LABELS[w]}`}
                title={STAT_WEIGHT_LABELS[w]} style={{ fontWeight: STAT_WEIGHT_VALUE[w] }}
                className={`${styles.size}${weight === w ? ' ' + styles.sizeOn : ''}`}
                onClick={() => { if (w !== weight) onStyle({ weight: w }) }}>A</button>
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
    pos?.target || doc.body,
  )
  const cur = picking ? live[picking.id] : null
  return (<>
    {menu}
    {cur && createPortal(
      <div ref={panelRef} {...{ [PORTAL_POPUP_ATTR]: 'header-stat-color' }} data-color-panel=""
        style={{ position: 'fixed', zIndex: 6010, ...(panelPos ? { left: panelPos.left, top: panelPos.top } : { left: -9999, top: -9999, visibility: 'hidden' }) }}>
        <ColorPanel title={`${name} · ${cur.title}`} value={cur.value} onChange={cur.onChange} onClose={() => setPicking(null)}
          savedColors={savedColors} onSaveColor={onSaveColor} onDeleteColor={onDeleteColor} />
      </div>,
      doc.body,
    )}
  </>)
}
