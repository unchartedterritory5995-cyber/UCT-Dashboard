import { useContext, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'
import Sheet from '../../../../../../components/mobile/Sheet'
import { useIsTouch } from '../../../../../../hooks/useBreakpoint'
import { money, moneySigned, rMultiple } from '../../../../../../lib/journal-2-0/format'
import { drillBuilt, failureText } from '../../../../lib/builtWidgets'
import { tradeHref } from './builtModel'
import { noteHref, openNoteInPlace } from '../../../../lib/noteHref'
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
 * clamped to it, no taller than the widget's visible area, scrolled into view, and re-anchored when the widget or
 * the window resizes. It closes ONLY on Escape or Close (focus back to the mark) or a click outside it (focus where
 * the member clicked); moving focus out with Tab leaves it open, as a non-modal dialog should. Touch: a Sheet (and a Sheet while the widget is
 * shared, `detached`: a shared widget's body is the archive image, so its trades never sit inside it).
 *
 * `onClose(refocus)` — the host moves focus back to the mark AFTER this has unmounted, so a Sheet's own focus
 * restore (to whatever held focus when it opened, the editor perhaps) can never win.
 */
export const DRILL_MORE = (n) => `and ${n} more`
/** Wave 10 (Task 10.17): a drilled options strategy opens in the existing options drawer (ruling R-30: the Journal's
 *  trades tab opens the strategy its `openTrade` parameter names, `TradeJournalTab`), the door a note's linked
 *  strategy already uses (`NoteEditorPage`). */
export const optionHref = (id) => `/journal?j2tab=journal&openTrade=${encodeURIComponent(String(id))}`
/** A drilled note opens in the note editor's own navigation (`lib/noteHref.js`, the one owner of the note link). */
export const drillNoteHref = noteHref
const TITLE = (what) => (what ? `Behind ${what}` : 'The rows behind this')
const PANEL_W = 360

function rowText(sourceKey, r) {
  if (sourceKey === 'options_strategies') {
    // be drill._option_row: `label` the underlying, `label2` the strategy; an open one has no net, R or result yet.
    return [
      r.label || 'A strategy', r.label2, r.day,
      typeof r.net === 'number' ? moneySigned(r.net) : null,
      typeof r.r === 'number' ? rMultiple(r.r) : null, r.result,
    ]
  }
  if (sourceKey === 'notes') return [r.label || 'Untitled note', r.day]     // be drill._note_row
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

/** Where a drilled row goes, or null: a trade to its page, an options strategy to the options drawer, a note to the
 *  note. Each row names its own id field (be drill `_SHAPE`). */
function rowLink(sourceKey, r) {
  const id = (k) => (typeof r[k] === 'string' && r[k] ? r[k] : null)
  // W10-R65: an OPEN strategy (the server's `open`) has no drawer that opens it (the Journal's drawer reads closed
  // strategies only, and no open-positions door takes a strategy id): it is plain text, never a link to nothing.
  if (sourceKey === 'options_strategies') {
    return id('strategyId') && r.open !== true ? { href: optionHref(r.strategyId), note: null } : null
  }
  if (sourceKey === 'notes') return id('noteId') ? { href: drillNoteHref(r.noteId), note: r.noteId } : null
  if (sourceKey === 'open_positions' || sourceKey === 'trading_days') return null
  if (sourceKey === 'routine_history' || sourceKey === 'tracker_history') return null
  return id('id') ? { href: tradeHref(r.id), note: null } : null
}

const plainClick = (e) => !e.defaultPrevented && e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey

function DrillBody({ params, state, onLink }) {
  const sourceKey = params?.sourceKey
  // The app router's history, when the widget is drawn inside it (null outside any router): a note or a strategy
  // opens through it on a plain click, as the note editor's own links do; a modified click is the browser's.
  const routerNav = useContext(UNSAFE_NavigationContext)?.navigator || null
  if (state.status === 'loading') return <p className={styles.caption} role="status">Loading the rows…</p>
  if (state.status === 'error') return <p className={s.message} role="status">{state.text}</p>
  const d = state.data
  const rows = Array.isArray(d.rows) ? d.rows.filter((r) => r && typeof r === 'object') : []
  const follow = (e, link) => {
    if (sourceKey === 'notes' || sourceKey === 'options_strategies') {
      if (routerNav && plainClick(e)) {
        e.preventDefault()
        routerNav.push(link.href)
      } else if (link.note) openNoteInPlace(e, link.note)
    }
    onLink()
  }
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
            const link = rowLink(sourceKey, r)
            return (
              <li key={`d${i}`} className={styles.drillRowItem}>
                {link ? (
                  <a className={s.link} href={link.href} onClick={(e) => follow(e, link)}>{head}</a>
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

/** Below this much room under the mark the panel opens ABOVE it (if there is this much room there); and the most
 *  it is ever allowed to be. */
export const PANEL_MIN_H = 120
export const PANEL_MAX_H = 320
const GAP = 4
const MARGIN = 8
/** A short widget's frame keeps this much of its own height clear of a panel that cannot fit (8 px each side). */
const FRAME_INSET = 16

/** Where the anchored panel sits inside `box` (rects in the same coordinates). Its left edge is at the mark's,
 *  clamped so the whole panel stays inside the widget. It opens under the mark, no taller than min(PANEL_MAX_H,
 *  the room under the mark inside the visible `frame`, minus MARGIN); when that room is under PANEL_MIN_H and
 *  there is at least PANEL_MIN_H above, it opens ABOVE the mark instead (`bottom`, measured from the box's bottom
 *  edge). With no room above either (a short widget) it opens under the mark with a height FLOOR of
 *  min(PANEL_MIN_H, the frame's client height - FRAME_INSET): the frame scrolls to it, and it is never a sliver.
 *  With no frame the height is only capped at PANEL_MAX_H. Pure, so it is testable without layout. */
export function anchorPosition(box, mark, panelW, frame = null) {
  const w = Math.max(0, box.width || 0)
  const pw = Math.min(panelW, w || panelW)
  const left = Math.round(Math.max(0, Math.min((mark.left - box.left) || 0, Math.max(0, w - pw))))
  const top = Math.round(Math.max(0, (mark.bottom - box.top) || 0) + GAP)
  if (!frame || !(frame.bottom > frame.top)) return { left, top, width: Math.round(pw), maxHeight: PANEL_MAX_H }
  const below = Math.floor(frame.bottom - mark.bottom - GAP - MARGIN)
  const above = Math.floor(mark.top - frame.top - GAP - MARGIN)
  if (below < PANEL_MIN_H && above >= PANEL_MIN_H) {
    const boxBottom = typeof box.bottom === 'number' ? box.bottom : box.top + (box.height || 0)
    return { left, bottom: Math.round(boxBottom - mark.top + GAP), width: Math.round(pw),
      maxHeight: Math.max(0, Math.min(PANEL_MAX_H, above)), above: true }
  }
  const frameH = frame.clientHeight > 0 ? frame.clientHeight : frame.bottom - frame.top
  const floor = Math.max(0, Math.min(PANEL_MIN_H, Math.floor(frameH - FRAME_INSET)))
  return { left, top, width: Math.round(pw), maxHeight: Math.max(0, Math.min(PANEL_MAX_H, Math.max(below, floor))) }
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

  // Anchor beside the mark, inside the widget, before the first paint, and again whenever the widget or the
  // window resizes; then bring it into view. Its height is capped to the widget's visible area (the snapshot
  // frame is the scroller).
  useLayoutEffect(() => {
    if (sheet) return undefined
    const box = container?.current
    if (!box) return undefined
    const place = () => {
      const b = box.getBoundingClientRect()
      const o = opener?.isConnected && opener.getBoundingClientRect ? opener.getBoundingClientRect() : b
      const frameEl = box.closest?.('[data-snapshot-frame]')
      const fr = frameEl ? frameEl.getBoundingClientRect() : null
      const f = fr ? { top: fr.top, bottom: fr.bottom, clientHeight: frameEl.clientHeight } : null
      const next = anchorPosition(b, o, PANEL_W, f)
      setPos((prev) => (prev && JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
    }
    place()
    window.addEventListener('resize', place)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null
    ro?.observe(box)
    return () => { window.removeEventListener('resize', place); ro?.disconnect() }
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
      // ...nor a press on THIS widget's drill surface (the Line overlay), which picks its own period: closing here
      // would close and reopen the panel on the same click. Another widget's surface is outside: it closes.
      const surface = e.target?.closest?.('[data-drill-surface]')
      if (surface && container?.current?.contains(surface)) return
      closeCb.current?.(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [sheet, opener, container])

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
      data-above={pos?.above ? '' : undefined}
      style={pos ? { left: pos.left, width: pos.width, maxHeight: pos.maxHeight,
        ...(pos.above ? { bottom: pos.bottom, top: 'auto' } : { top: pos.top }) } : undefined}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeCb.current?.(true) } }}
    >
      <div className={styles.drillTop}>
        <span className={styles.drillTitle}>{title}</span>
        <button ref={closeRef} type="button" className={s.btn} onClick={() => closeCb.current?.(true)}>Close</button>
      </div>
      {body}
    </div>
  )
}
