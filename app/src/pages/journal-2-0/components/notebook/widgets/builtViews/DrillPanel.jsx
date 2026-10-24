import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import Sheet from '../../../../../../components/mobile/Sheet'
import { useIsTouch } from '../../../../../../hooks/useBreakpoint'
import { money, moneySigned, rMultiple } from '../../../../../../lib/journal-2-0/format'
import { drillBuilt, failureText } from '../../../../lib/builtWidgets'
import { tradeHref } from './builtModel'
import styles from './builtViews.module.css'
import { snapshotStyles as s } from '../SnapshotFrame'

/**
 * Built widgets (wave 8, Task 8.14): the rows behind one number, bar, point, cell or row of a placed widget.
 *
 * It asks `POST /api/j2/widget-definitions/drill` ONCE, when it opens (never on mount of the widget), with the
 * widget's own settings, the cell and the snapshot's count and time, so the server can say when the live rows
 * differ from the snapshot ("Live data; the snapshot was taken on Oct 24"). It lists up to 40 rows plus "and N more",
 * each trade linking to its own page (R-30), a flagged trade labelled "Flagged", and the server's note as given.
 *
 * Desktop: a NON-modal dialog ANCHORED beside the mark that opened it, positioned inside the widget (`container`),
 * clamped to it and scrolled into view. Escape and Close return focus to the mark; a click outside, or focus
 * moving out, closes it and leaves focus where the member put it. Touch: a Sheet (and a Sheet while the widget is
 * shared, `detached`: a shared widget's body is the archive image, so its trades never sit inside it).
 *
 * `onClose(refocus)` — the host moves focus back to the mark AFTER this has unmounted, so a Sheet's own focus
 * restore (to whatever held focus when it opened, the editor perhaps) can never win.
 */
export const DRILL_MORE = (n) => `and ${n} more`
const TITLE = (what) => (what ? `Behind ${what}` : 'The rows behind this')
const PANEL_W = 360

function rowText(sourceKey, r) {
  if (sourceKey === 'trading_days') {
    const n = Number(r.trades) || 0
    return [r.day, moneySigned(r.net), `${n} ${n === 1 ? 'trade' : 'trades'}`]
  }
  if (sourceKey === 'open_positions') {
    return [
      [r.symbol, r.side].filter(Boolean).join(' '), r.setup,
      typeof r.daysOpen === 'number' ? `${r.daysOpen} days open` : null,
      typeof r.unrealised === 'number' ? moneySigned(r.unrealised) : null,
      r.hasStop === false ? 'No stop set' : (typeof r.riskDollars === 'number' ? `${money(r.riskDollars)} at risk` : null),
    ]
  }
  return [
    [r.symbol, r.side].filter(Boolean).join(' '), r.day,
    typeof r.net === 'number' ? moneySigned(r.net) : 'no data',
    typeof r.r === 'number' ? rMultiple(r.r) : null, r.setup,
  ]
}

function DrillBody({ params, state, onLink }) {
  const sourceKey = params?.sourceKey
  if (state.status === 'loading') return <p className={styles.caption} role="status">Loading the rows…</p>
  if (state.status === 'error') return <p className={s.message} role="status">{state.text}</p>
  const d = state.data
  const rows = Array.isArray(d.rows) ? d.rows.filter((r) => r && typeof r === 'object') : []
  const linkable = sourceKey !== 'open_positions' && sourceKey !== 'trading_days'
  return (
    <div className={styles.drillBody}>
      {typeof d.notice === 'string' && d.notice && <p className={styles.caption}>{d.notice}</p>}
      {typeof d.note === 'string' && d.note && <p className={styles.caption} data-testid="built-drill-note">{d.note}</p>}
      {rows.length === 0 ? (
        <p className={styles.caption}>Nothing to list here.</p>
      ) : (
        <ul className={styles.drillList} data-testid="built-drill-rows">
          {rows.map((r, i) => {
            const parts = rowText(sourceKey, r).filter((x) => typeof x === 'string' && x)
            const head = parts[0] || 'A row'
            return (
              <li key={`d${i}`} className={styles.drillRowItem}>
                {linkable && typeof r.id === 'string' && r.id ? (
                  <a className={s.link} href={tradeHref(r.id)} onClick={onLink}>{head}</a>
                ) : <span className={styles.drillHead}>{head}</span>}
                {parts.slice(1).map((t, k) => <span key={`p${k}`} className={styles.drillPart}>{t}</span>)}
                {r.flagged === true && <span className={styles.flagged}>Flagged</span>}
              </li>
            )
          })}
        </ul>
      )}
      {Number(d.more) > 0 && <p className={styles.caption}>{DRILL_MORE(Number(d.more))}</p>}
    </div>
  )
}

/** Where the anchored panel sits inside `box`: just under the mark, its left edge at the mark's, clamped so the
 *  whole panel stays inside the widget. Pure, so it is testable without layout. */
export function anchorPosition(box, mark, panelW) {
  const w = Math.max(0, box.width || 0)
  const pw = Math.min(panelW, w || panelW)
  const left = Math.max(0, Math.min((mark.left - box.left) || 0, Math.max(0, w - pw)))
  const top = Math.max(0, (mark.bottom - box.top) || 0) + 4
  return { left: Math.round(left), top: Math.round(top), width: Math.round(pw) }
}

export default function DrillPanel({ params, cell, what, opener, onClose, detached = false, container = null }) {
  const isTouch = useIsTouch()
  const [state, setState] = useState({ status: 'loading' })
  const [pos, setPos] = useState(null)
  const panelRef = useRef(null)
  const closeRef = useRef(null)
  const closeCb = useRef(onClose)
  closeCb.current = onClose
  const sheet = isTouch || detached
  // Asked once per opening: the panel is keyed on the cell, so another cell is another panel.
  useEffect(() => {
    let live = true
    drillBuilt(params, cell).then((got) => {
      if (!live) return
      setState(got?.ok ? { status: 'ok', data: got.data } : { status: 'error', text: failureText(got?.code, got?.message) })
    }, () => { if (live) setState({ status: 'error', text: failureText('failed') }) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Anchor beside the mark, inside the widget, before the first paint; then bring it into view.
  useLayoutEffect(() => {
    if (sheet) return
    const box = container?.current
    if (!box) return
    const b = box.getBoundingClientRect()
    const o = opener?.getBoundingClientRect ? opener.getBoundingClientRect() : b
    setPos(anchorPosition(b, o, PANEL_W))
  }, [sheet, container, opener])
  useEffect(() => {
    if (sheet) return undefined
    closeRef.current?.focus()
    panelRef.current?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' })
    // A click outside closes it (focus goes where the member clicked); a click on the mark that opened it
    // is the mark's own business.
    const away = (e) => {
      const panel = panelRef.current
      if (!panel || panel.contains(e.target) || (opener && opener.contains?.(e.target))) return
      closeCb.current?.(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [sheet, opener])

  const title = TITLE(what)
  const body = <DrillBody params={params} state={state} onLink={() => closeCb.current?.(false)} />
  if (sheet) {
    return (
      <Sheet open onClose={() => closeCb.current?.(true)} title={title} variant={isTouch ? 'bottom-sheet' : 'modal'}
        labelledByTitle>
        {body}
      </Sheet>
    )
  }
  return (
    <div
      ref={panelRef}
      className={styles.drillPanel}
      role="dialog"
      aria-label={title}
      data-testid="built-drill-panel"
      style={pos ? { left: pos.left, top: pos.top, width: pos.width } : undefined}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCb.current?.(true) } }}
      onBlur={(e) => {
        // Focus moving out of a non-modal panel closes it (and leaves focus where it went).
        const next = e.relatedTarget
        if (next && panelRef.current && !panelRef.current.contains(next)) closeCb.current?.(false)
      }}
    >
      <div className={styles.drillTop}>
        <span className={styles.drillTitle}>{title}</span>
        <button ref={closeRef} type="button" className={s.btn} onClick={() => closeCb.current?.(true)}>Close</button>
      </div>
      {body}
    </div>
  )
}
