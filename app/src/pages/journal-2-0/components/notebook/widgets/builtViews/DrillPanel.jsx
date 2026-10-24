import { useEffect, useRef, useState } from 'react'
import Sheet from '../../../../../../components/mobile/Sheet'
import { trapTabKey } from '../../../../../../components/mobile/useFocusTrap'
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
 * each trade linking to the Journal, a flagged trade labelled "Flagged", and the server's note as given.
 *
 * A Sheet on touch, an anchored panel on desktop (a Sheet too while the widget is shared: `detached`). Either way it
 * traps focus, Escape closes it, and focus goes back to the mark that opened it (`opener`).
 */
export const DRILL_MORE = (n) => `and ${n} more`
const TITLE = (what) => (what ? `Behind ${what}` : 'The rows behind this')

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

export default function DrillPanel({ params, cell, what, opener, onClose, detached = false }) {
  const isTouch = useIsTouch()
  const [state, setState] = useState({ status: 'loading' })
  const panelRef = useRef(null)
  const closeRef = useRef(null)
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
  const close = () => {
    onClose?.()
    if (opener && typeof opener.focus === 'function') opener.focus()
  }
  const closeRefFn = useRef(close)
  closeRefFn.current = close
  // The desktop panel takes focus when it opens (the Sheet does its own).
  const sheet = isTouch || detached
  useEffect(() => {
    if (!sheet) closeRef.current?.focus()
  }, [sheet])

  const title = TITLE(what)
  const body = <DrillBody params={params} state={state} onLink={() => onClose?.()} />
  // ⛔ `detached`: a SHARED widget's body is what the self-archive rasterises for a public page, so its rows (the
  // member's trades) are drawn in a Sheet, which portals outside that body, never in an anchored panel inside it.
  if (sheet) {
    return (
      <Sheet open onClose={() => closeRefFn.current()} title={title} variant={isTouch ? 'bottom-sheet' : 'modal'}
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
      aria-modal="true"
      aria-label={title}
      data-testid="built-drill-panel"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.stopPropagation(); close() } else if (e.key === 'Tab') trapTabKey(e, panelRef.current)
      }}
    >
      <div className={styles.drillTop}>
        <span className={styles.drillTitle}>{title}</span>
        <button ref={closeRef} type="button" className={s.btn} onClick={close}>Close</button>
      </div>
      {body}
    </div>
  )
}
