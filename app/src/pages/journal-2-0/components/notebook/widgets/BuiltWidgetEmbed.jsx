import { useContext, useEffect, useRef, useState } from 'react'
import { UNSAFE_NavigationContext } from 'react-router-dom'
import UIcon from '../../../../../components/ui/UIcon'
import { embedAutoCaption } from '../../../lib/widgetEmbedCore'
import {
  BUILT_KIND, DEFS_URL, FAILED_SENTENCE, getJson, postJson, runBuilt, builtRefreshParams, failureText,
} from '../../../lib/builtWidgets'
import SnapshotFrame, { useSnapshotFrame, accountSourceLine, snapshotStyles as s } from './SnapshotFrame'
import NumberView from './builtViews/NumberView'
import TableView from './builtViews/TableView'
import TableAlt from './builtViews/TableAlt'
import CompareView from './builtViews/CompareView'
import BarView from './builtViews/BarView'
import LineView from './builtViews/LineView'
import ScatterView from './builtViews/ScatterView'
import HeatView from './builtViews/HeatView'
import ListView from './builtViews/ListView'
import ProgressView from './builtViews/ProgressView'
import DrillPanel from './builtViews/DrillPanel'
import HowMadeSheet, { UPDATED_VERSION } from './builtViews/HowMadeSheet'
import { CoverageNote, Footnotes } from './builtViews/Counts'
import { LOG_TRADE_HREF } from './builtViews/builtModel'
import { widgetsWaveOn } from '../../../lib/notebookWidgetsFlags'
import styles from './BuiltWidgetEmbed.module.css'

/**
 * Notebook widgets phase 2 (wave 8, Tasks 8.13-8.14): a widget the member BUILT, placed in a note.
 *
 * ⛔ A SNAPSHOT, like every phase 1 kind: it renders from `attrs.params` alone and never fetches on mount. See it
 * now and Change re-run it through the frame (`useSnapshotFrame('builtWidget')` -> lib/builtWidgets.js), and the
 * server echoes every key the note keeps.
 *
 * One view per `params.view`, each pure inline SVG or HTML (never a chart engine). "Show as table" (TableAlt) lays
 * out the same rows as a plain HTML table, for every view that is not one already. Enter or a click on a number,
 * bar, point, cell or row opens the rows behind it (DrillPanel, which is the only request a view makes, and only
 * then); a public page draws no drill.
 *
 * ⛔ The archive image (ruling R-25, WidgetEmbedView's self-archive): while `share === true` this body is what is
 * rasterised for a public page, so it draws no account NAME (the scope label; the views number accounts), and no
 * summary, subtitle or ⋯ menu, whose words can name the member's filters.
 */
const VIEWS = {
  number: NumberView, compare: CompareView, table: TableView, bar: BarView, line: LineView,
  scatter: ScatterView, heat: HeatView, list: ListView, progress: ProgressView,
}
export const SAVED_COPY_SENTENCE = 'Running from the saved copy in this note.'
export const ARCHIVED_SENTENCE = 'Archived widget'
/** The menu's read failed, or the browser is offline: the member is told the check did not happen. */
export const CHECK_FAILED_SENTENCE = "Couldn't check for updates."
/** A 404 while wave 8 is dark is the wave, not the widget (lib/builtWidgets FAILURE_COPY.unavailable). */
export const UNAVAILABLE_SENTENCE = 'Not available right now.'

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

/** The member's subtitle from the frozen plan (display.subtitle), or ''. */
const subtitleOf = (p) => (isRecord(p.def?.display) && typeof p.def.display.subtitle === 'string'
  ? p.def.display.subtitle.trim() : '')

/** The ⋯ menu of an editable placed widget: a plain popover of buttons (How this is made, Manage…) and what
 *  GET /{defId} says about the widget itself, read when it first opens (an update, an archived widget, or a widget
 *  that is gone). Escape closes it and returns focus to ⋯; Tab out of it or a click outside closes it. */
function BuiltMenu({ params, editor, getPos, onApplyLatest }) {
  // The app router's history, when this widget is drawn inside it (null in a render outside any router): My tools
  // opens on its own root, so its note links move the router through this (`useNavigate` throws outside a router).
  const routerHistory = useContext(UNSAFE_NavigationContext)?.navigator
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState(null)       // null | loading | {ok, def} | missing | dark | paid | error
  const [how, setHow] = useState(false)
  const [message, setMessage] = useState('')
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  const defId = typeof params.defId === 'string' && params.defId ? params.defId : null
  const shelf = defId !== null && defId.startsWith('shelf:')

  // The popover takes focus when it opens (its first button), and a click outside closes it.
  useEffect(() => {
    if (!open) return undefined
    wrapRef.current?.querySelector('[data-built-menu] button')?.focus()
    const away = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  const load = () => {
    if (!defId) { setStatus({ kind: 'missing' }); return }
    if (shelf) { setStatus({ kind: 'shelf' }); return }
    setStatus({ kind: 'loading' })
    getJson(`${DEFS_URL}/${encodeURIComponent(defId)}`).then((got) => {
      if (!mounted.current) return
      if (got.ok) setStatus({ kind: 'ok', def: got.data })
      // A 404 is a widget that is gone, unless wave 8 is dark: then it is the wave (and nothing is "gone").
      else if (got.code === 'unavailable') setStatus({ kind: widgetsWaveOn(8) ? 'missing' : 'dark' })
      // A 402 is the member's plan, not a failed check: it says so (wave 8 consolidation), never "Couldn't check".
      else if (got.code === 'paid') setStatus({ kind: 'paid' })
      else setStatus({ kind: 'error' })
    })
  }
  const toggle = () => {
    const next = !open
    setOpen(next)
    setMessage('')
    if (next && (status === null || status.kind === 'error' || status.kind === 'dark' || status.kind === 'paid')) load()
  }
  const closeMenu = () => { setOpen(false); buttonRef.current?.focus() }

  const def = status?.kind === 'ok' && isRecord(status.def) ? status.def : null
  const placed = Math.max(Number.isInteger(params.defRev) ? params.defRev : 0,
    Number.isInteger(def?.placedRev) ? def.placedRev : 0)
  const latest = def && Number.isInteger(def.rev) && def.rev > placed ? def : null
  const archived = def?.archived === true

  const edit = async () => {
    setHow(false)
    try {
      const mod = await import('../widgetBuilder/openWidgetBuilder.js')
      // Focus comes back to ⋯ when the builder closes without placing anything (Task 8.15 fix 1, I-9).
      mod.openWidgetBuilder({ editor, from: { defId, getPos }, returnFocus: buttonRef.current })
    } catch { /* the builder could not load: nothing opens */ }
  }
  const manage = async () => {
    setOpen(false)
    try {
      const mod = await import('../myTools/openMyTools.js')
      mod.openMyTools({ editor, defId, ...(routerHistory ? { navigate: (to) => routerHistory.push(to) } : {}) })
    } catch { /* My tools could not load: nothing opens */ }
  }
  const restore = async () => {
    const got = await postJson(`/${encodeURIComponent(defId)}/unarchive`, {})
    if (!mounted.current) return
    if (got.ok) setStatus((st) => (st?.kind === 'ok' ? { ...st, def: { ...st.def, archived: false } } : st))
    else setMessage(failureText(got.code, got.message) || FAILED_SENTENCE)
  }

  return (
    <span className={styles.menuWrap} ref={wrapRef}>
      <button ref={buttonRef} type="button" className={`${s.btn} ${styles.menuButton}`}
        aria-expanded={open} aria-label="More for this widget" onClick={toggle}>
        <UIcon name="more" size={14} gold={false} />
      </button>
      {open && (
        <div className={styles.menu} data-built-menu="" data-testid="built-menu"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu() } }}
          onBlur={(e) => {
            // Tab out (focus moving anywhere outside ⋯ and its popover) closes it.
            const next = e.relatedTarget
            if (next && wrapRef.current && !wrapRef.current.contains(next)) setOpen(false)
          }}>
          <button type="button" className={styles.menuItem}
            onClick={() => { setOpen(false); setHow(true) }}>How this is made</button>
          <button type="button" className={styles.menuItem} onClick={manage}>Manage…</button>
          {status?.kind === 'loading' && <p className={styles.menuNote} role="status">Checking this widget…</p>}
          {latest && (
            <button type="button" className={styles.menuItem}
              onClick={() => { setOpen(false); setHow(true) }}>{UPDATED_VERSION}</button>
          )}
          {archived && (
            <>
              <p className={styles.menuNote}>{ARCHIVED_SENTENCE}</p>
              <button type="button" className={styles.menuItem} onClick={restore}>Restore</button>
            </>
          )}
          {status?.kind === 'missing' && <p className={styles.menuNote}>{SAVED_COPY_SENTENCE}</p>}
          {status?.kind === 'dark' && <p className={styles.menuNote}>{UNAVAILABLE_SENTENCE}</p>}
          {status?.kind === 'error' && <p className={styles.menuNote} role="status">{CHECK_FAILED_SENTENCE}</p>}
          {status?.kind === 'paid' && <p className={styles.menuNote} role="status">{failureText('paid')}</p>}
          {message && <p className={s.message} role="status">{message}</p>}
        </div>
      )}
      {how && (
        // Its opener (a menu item) is gone once the menu closes, so focus comes back to the ⋯ button.
        <HowMadeSheet open onClose={() => { setHow(false); buttonRef.current?.focus() }} summary={params.summary}
          shelf={shelf} onEdit={edit}
          latest={latest} onApply={latest ? () => onApplyLatest(latest.rev) : undefined} />
      )}
    </span>
  )
}

export default function BuiltWidgetEmbed({
  attrs, height = 260, editable = false, onUpdateParams, uid, editor = null, getPos = null, shareView = false,
  chartWidth,
}) {
  const p = attrs?.params || {}
  const frame = useSnapshotFrame(BUILT_KIND, attrs, { editable, onUpdateParams, uid })
  const [asTable, setAsTable] = useState(false)
  const [drill, setDrill] = useState(null)        // {cell, what, opener, n}
  const drillSeq = useRef(0)
  const wrapRef = useRef(null)
  // Focus goes back to the mark AFTER the drill has unmounted: a Sheet restores focus to whatever held it when it
  // opened (the editor, after a click), and this effect runs after that cleanup, so the mark always wins.
  const refocus = useRef(null)
  useEffect(() => {
    if (drill || !refocus.current) return
    const el = refocus.current
    refocus.current = null
    if (el.isConnected && typeof el.focus === 'function') el.focus()
  }, [drill])
  const closeDrill = (back) => {
    refocus.current = back ? drill?.opener || null : null
    setDrill(null)
  }
  // The write after an awaited run reads the CURRENT params and host (as useSnapshotFrame's refresh does), so a
  // share switch made while the run was out wins and a note that turned read-only gets no write.
  const paramsRef = useRef(p)
  paramsRef.current = p
  const writeRef = useRef(null)
  writeRef.current = frame.editable ? onUpdateParams : null

  const view = typeof p.view === 'string' && Object.hasOwn(VIEWS, p.view) ? p.view : 'number'
  const empty = typeof p.empty === 'string' && p.empty && !p.tooLarge ? p.empty : null
  const shared = p.share === true
  const labels = [shared ? null : p.scopeLabel, p.rangeLabel].filter((x) => typeof x === 'string' && x).join(' · ')
  const subtitle = shared ? '' : subtitleOf(p)
  const extra = Number(p.truncated) > 0 ? `${p.truncated} more not shown.` : ''
  const sourceLine = [accountSourceLine(p), extra].filter(Boolean).join(' · ') || null
  const canToggle = !empty && view !== 'table'
  const canDrill = !shareView && !empty
  const onDrill = canDrill
    ? (cell, what, opener) => {
      // The mark whose panel is already open: leave it open (never close and reopen it).
      if (drill && opener && drill.opener === opener) return
      drillSeq.current += 1
      setDrill({ cell, what, opener, n: drillSeq.current })
    }
    : null

  const applyLatest = async (rev) => {
    const got = await runBuilt({ ...paramsRef.current, defRev: rev })
    if (!got.ok) return { ok: false, text: failureText(got.code, got.message) }
    const write = writeRef.current
    if (typeof write !== 'function') return { ok: false, text: FAILED_SENTENCE }
    write(builtRefreshParams(paramsRef.current, got.data))
    return { ok: true }
  }

  const View = VIEWS[view]
  let body
  if (empty) {
    body = (
      <p className={s.empty}>
        {empty}
        {p.sourceKey === 'closed_trades' && <>{' '}<a className={s.link} href={LOG_TRADE_HREF}>Log a trade</a></>}
      </p>
    )
  } else if (asTable && canToggle) body = <TableAlt params={p} onDrill={onDrill} />
  else body = <View params={p} onDrill={onDrill} width={chartWidth} />

  const menu = frame.editable && !shared && !shareView
    ? <BuiltMenu params={p} editor={editor} getPos={getPos} onApplyLatest={applyLatest} />
    : null

  return (
    <div style={{ height }} role="figure" aria-label={embedAutoCaption(attrs)} data-testid="built-widget-embed">
      <SnapshotFrame {...frame} sourceLine={sourceLine} menu={menu}>
        <div className={styles.wrap} ref={wrapRef}>
          {labels && <p className={styles.labels}>{labels}</p>}
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
          {body}
          {!empty && view !== 'number' && view !== 'compare' && view !== 'progress' && <CoverageNote params={p} />}
          {typeof p.notice === 'string' && p.notice && <p className={styles.notice}>{p.notice}</p>}
          {!empty && <Footnotes params={p} />}
          {canToggle && (
            <div className={styles.tools}>
              <button type="button" className={s.btn} aria-pressed={asTable} onClick={() => setAsTable((v) => !v)}>
                Show as table
              </button>
            </div>
          )}
          {drill && (
            <DrillPanel key={drill.n} params={p} cell={drill.cell} what={drill.what} opener={drill.opener}
              onClose={closeDrill} detached={shared} container={wrapRef} />
          )}
        </div>
      </SnapshotFrame>
    </div>
  )
}
