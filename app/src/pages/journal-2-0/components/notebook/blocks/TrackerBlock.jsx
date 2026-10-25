// The tracker block (Notebook widgets phase 2, wave 9, Task 9.14): log the bound day's value in one tap or keystroke,
// and see the tracker's last 30 entries as a small chart (with its table), its average and its latest value.
//
// params { trackerId, day: ''|'YYYY-MM-DD', bind: 'note-day'|'next-trading-day'|'week'|'today', display: 'chart'|'pnl' }.
// The day it shows is the routine block's rule (lib/blocks/toolDays.readKeyOf, ruling W9-R33): 'today' is the
// SERVER's resolved day and is followed across ET midnight; else `params.day`; else from the note's day.
//
// The controls, by the tracker's kind: yes/no is two buttons; a 1-5 scale five buttons; a number an input that logs
// on Enter or blur; a duration an `h:mm` input. Pressing the picked value again clears the day (`value: null`), as
// does emptying an input. A value is sent as typed: the server refuses a bad one with its own sentence, shown beside
// the control, and nothing is kept (the day keeps its stored value, the box its stored text).
//
// ⛔⛔ LIVE STATE IS NEVER NOTE STATE. A log, a restore and an adopted entry go through lib/blocks/toolsApi (the tracker
// tables, never a note); this file makes no request of its own. `setParams` is called ONLY from the ⋯ menu's day and
// display settings, each ONE call carrying its search text: never on mount, a read, a log or an adoption.
// ⛔ No surface shows a 0 for "nothing": an empty tracker says so in words, a missing value is a gap in the chart.
// ⛔ ONE live region, mounted for the block's whole life and placed right under the controls (the sentence a control
//    earns is read beside it); the offline sentence is said there once.
// ⛔ A busy or offline control is `aria-disabled` with a guard in its handler, never `disabled`, so focus stays on it.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import ContextPopover from '../../../../../components/mobile/ContextPopover'
import UIcon from '../../../../../components/ui/UIcon'
import { useIsTouch } from '../../../../../hooks/useBreakpoint'
import { isTradingDay } from '../../../../../lib/marketClock/sessionCalendar'
import { todayET } from '../../../lib/calendar'
import { TOOL_COPY, isOffline, logValue, readDay, resolvedTodayIfCurrent, subscribe, subscribeTool, unarchive, vsPnl } from '../../../lib/blocks/toolsApi'
import { dayWords, editorNoteDay, forDayLabel, readKeyOf, toolSearchText } from '../../../lib/blocks/toolDays'
import { DURATION_HINT, entriesText, inputText, typedValue, valueText } from '../../../lib/blocks/trackerValues'
import { BlockLoading } from './blockStates'
import TrackerChart from './TrackerChart'
import styles from './Blocks.module.css'
import own from './TrackerBlock.module.css'

export const CHECKIN_LINE = 'Mood and focus come from your check-ins.'
export const EMPTY_LINE = 'Log your first value; the chart starts with it.'
export const TRADING_ONLY = 'This tracker logs trading days only.'
const MENU_NAME = 'Tracker options'
/** Ruling W9-R34, in the tracker's words: a FUTURE day that cannot be logged yet. */
export const futureLine = (day) => `You can log this on ${dayWords(day)}.`

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const isDay = (d) => typeof d === 'string' && DAY_RE.test(d)
const KINDS = new Set(['yesno', 'scale', 'number', 'duration'])
const YESNO = [{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }]
const SCALE = [1, 2, 3, 4, 5].map((v) => ({ label: String(v), value: v }))

/** A read's failure code -> the block's state. */
const READ_STATE = { offline: 'offline', unavailable: 'unavailable', missing: 'missing' }
/** Refusals whose sentence is the server's own, with nothing to retry (a bad value among them: retrying it would
 *  be refused again). */
const SERVER_SENTENCE = new Set(['invalid', 'read_only', 'count_cap', 'conflict'])

/** The server's "not a number" sentence, which a duration box never shows (W9-R41: it says DURATION_HINT). */
const S_NOT_A_NUMBER = 'Enter a number.'
const finite = (v) => typeof v === 'number' && Number.isFinite(v)
/** The server's summary (W9-R40, M-5): the recent entries, average, latest and count exactly as it sent them. */
const summaryFrom = (x) => ({
  recent: Array.isArray(x?.recent) ? x.recent.filter((e) => e && typeof e.day === 'string') : [],
  average: finite(x?.average) ? x.average : null,
  latest: x?.latest && typeof x.latest.day === 'string' && finite(x.latest.value) ? x.latest : null,
  n: Number.isInteger(x?.n) && x.n > 0 ? x.n : null,
})

/** The value a yes/no or scale button sends (yes/no as the bool the route takes). */
const sendOf = (kind, v) => (kind === 'yesno' ? v === 1 : v)

export default function TrackerBlock({ params, setParams, editable, editor }) {
  const p = params || {}
  const trackerId = typeof p.trackerId === 'string' ? p.trackerId : ''
  const bind = typeof p.bind === 'string' ? p.bind : 'note-day'
  const display = p.display === 'pnl' ? 'pnl' : 'chart'
  const follow = bind === 'today'
  const noteDay = editorNoteDay(editor)
  const readKey = readKeyOf(p, noteDay)
  const base = `${trackerId}|${readKey}`
  const isTouch = useIsTouch()

  const [attempt, setAttempt] = useState(0)
  // { base, attempt, status: 'ready'|'offline'|'unavailable'|'missing'|'failed', entry?, tool?, day?, summary? }. A read
  // for another (tracker, day, attempt) is read as loading, so a settings change never shows the old day's value.
  const [read, setRead] = useState(null)
  const [pending, setPending] = useState(null)          // { value, seq }: a log on its way (a button shows it pressed)
  const [draft, setDraft] = useState(null)              // the input's typed text; null shows the stored value
  const [offline, setOffline] = useState(isOffline())
  const [feedback, setFeedback] = useState(null)         // { text, retry?, focus?, invalid? }
  const [menu, setMenu] = useState(null)                 // the ⋯ menu's anchor while open
  const [pnl, setPnl] = useState(null)                   // { tracker, ok, sentence? }: the vs P&L read
  const [pnlTick, setPnlTick] = useState(0)              // bumped by a tool change or a vs P&L Retry (M-4)
  const wrap = useRef(null)
  const menuButton = useRef(null)
  const alive = useRef(true)
  const seq = useRef(0)
  const focusAfterRead = useRef(false)
  const toolSeen = useRef(null)            // the tool a restore's re-read handed this block
  const liveId = useId()
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const cur = read && read.base === base && read.attempt === attempt ? read : null
  const readRef = useRef(read)
  readRef.current = read

  // The read: one per (tracker, day, attempt), batched by the layer with every other block's.
  useEffect(() => {
    if (!trackerId) return undefined
    let live = true
    readDay('tracker', trackerId, readKey).then((r) => {
      if (!live) return
      if (r.ok) {
        setRead({ base, attempt, status: 'ready', entry: r.entry, tool: r.tool, day: r.resolvedDay, summary: summaryFrom(r.extras) })
      } else setRead({ base, attempt, status: READ_STATE[r.code] || 'failed' })
    })
    return () => { live = false }
  }, [trackerId, readKey, base, attempt])

  // Adoption: a value logged in this page (another block of the same tracker and day) or in another tab, the tab came
  // back to the front, ET midnight passed, or the tracker was restored (then the tool rides along). Never the note.
  // A follow-today block takes the entry's day (the server's new 'today'); any other block ignores another day's entry.
  useEffect(() => {
    if (!trackerId) return undefined
    return subscribe('tracker', trackerId, readKey, (entry, tool) => {
      if (!alive.current || !entry || typeof entry !== 'object') return
      if (tool && typeof tool === 'object') toolSeen.current = tool
      setRead((r) => {
        if (!r || r.base !== base || r.status !== 'ready') return r
        const next = tool && typeof tool === 'object' ? { ...r, tool } : r
        const day = isDay(entry.day) ? entry.day : r.day
        if (!follow && day !== r.day) return r
        return { ...next, entry, day }
      })
    })
  }, [trackerId, readKey, base, follow])

  // W9-R40: a log for ANY day of this tracker (here, in another block or another tab) or a restore. The layer re-reads
  // THIS block's own day from the server and hands over the summary with it, so the average, latest, count and chart
  // are the server's, bounded to this block's day (a past note's summary never moves, W9-R13).
  useEffect(() => {
    if (!trackerId) return undefined
    // An answer the block applies is ALSO the vs P&L read's input: it is re-read only when the summary it shows actually
    // changed (MIN-2), never for an answer the block discards and never on a tab's return with nothing new.
    const applies = (r, e) => {
      if (!r || r.base !== base || r.status !== 'ready') return false
      const day = isDay(e?.day) ? e.day : r.day
      return follow || day === r.day                       // an answer about another day: none of it is this block's
    }
    return subscribeTool('tracker', trackerId, readKey, (u) => {
      if (!alive.current || !u || typeof u !== 'object') return
      const e = u.entry && typeof u.entry === 'object' ? u.entry : null
      const before = readRef.current
      if (!applies(before, e)) return
      const summary = u.extras && typeof u.extras === 'object' ? summaryFrom(u.extras) : null
      setRead((r) => {
        if (!applies(r, e)) return r
        const next = { ...r, day: isDay(e?.day) ? e.day : r.day }
        if (e) next.entry = e
        if (u.tool && typeof u.tool === 'object') next.tool = u.tool
        if (summary) next.summary = summary
        return next
      })
      if (summary && JSON.stringify(summary) !== JSON.stringify(before.summary)) setPnlTick((n) => n + 1)
    })
  }, [trackerId, readKey, base, follow])

  // The browser's own connection events: controls follow them, and a read that found us offline is re-made.
  const statusRef = useRef(null)
  statusRef.current = cur?.status ?? null
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const off = () => setOffline(true)
    const on = () => {
      setOffline(false)
      if (statusRef.current === 'offline') setAttempt((n) => n + 1)
    }
    window.addEventListener('offline', off)
    window.addEventListener('online', on)
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on) }
  }, [])

  // After a read Retry, once the read has landed: the block's first control, else the ⋯ button (a layout effect, so
  // the focus moves in the same commit that shows the control).
  useLayoutEffect(() => {
    if (!focusAfterRead.current || !cur) return
    focusAfterRead.current = false
    const root = wrap.current
    const el = (cur.status === 'ready'
      ? root?.querySelector('[data-value-input]') || root?.querySelector('[data-value]')
      : root?.querySelector('[data-read-retry]')) || menuButton.current
    el?.focus?.()
  }, [cur])

  // vs P&L (display 'pnl'): one GET per (tracker, attempt, tool change) while it is shown. The last sentence stays on
  // screen while a fresh one is read, so a refresh never flashes "Loading…".
  const ready = cur?.status === 'ready'
  const pnlKey = `${trackerId}|${attempt}|${pnlTick}`
  useEffect(() => {
    if (display !== 'pnl' || !ready || !trackerId) return undefined
    let live = true
    vsPnl('tracker', trackerId).then((r) => {
      if (!live) return
      const sentence = r.ok && typeof r.data?.sentence === 'string' ? r.data.sentence : ''
      setPnl({ tracker: trackerId, ok: !!sentence, sentence })
    })
    return () => { live = false }
  }, [display, ready, trackerId, pnlKey])

  const adoptAnswer = useCallback((entry) => {
    setRead((r) => {
      if (!r || r.base !== base || r.status !== 'ready') return r
      if (isDay(entry?.day) && entry.day !== r.day) return r
      return { ...r, entry }
    })
  }, [base])

  /** A refused or failed write: the sentence it earns, and a Retry (which returns focus to `focus`) where trying
   *  again can help. Offline is said by the live region itself. */
  const failed = useCallback((out, retry, focus) => {
    if (out.code === 'offline') { setOffline(true); setFeedback(null); return }
    if (out.code === 'window') { setFeedback({ text: TOOL_COPY.window }); return }
    if (out.code === 'missing') { setFeedback({ text: TOOL_COPY.missing }); return }
    if (SERVER_SENTENCE.has(out.code) && out.message && out.message !== TOOL_COPY.tickFailed) {
      // W9-R41: a duration box never says "Enter a number."; the over-24-hours sentence is shown as it is.
      const text = out.code === 'invalid' && kindRef.current === 'duration' && out.message === S_NOT_A_NUMBER ? DURATION_HINT : out.message
      setFeedback({ text, invalid: out.code === 'invalid' })
      return
    }
    setFeedback({ text: TOOL_COPY.tickFailed, retry, focus })
  }, [])

  // The day a log goes to is read when it is SENT (a Retry made after ET midnight logs to the new day). A block whose
  // day moves drops what was pending for the old one (its sentence, its Retry, the pressed value on its way and the
  // typed text): a follow-today block at ET midnight, and ANY block whose read key changes (I-3: a bind switch), so a
  // Retry can never log the old day's value to the new day. An answer that lands after the switch is dropped too.
  const writeDayRef = useRef(null)
  writeDayRef.current = cur?.day ?? null
  const baseRef = useRef(base)
  baseRef.current = base
  const shownDay = useRef(null)
  const shownBase = useRef(base)
  const curDay = cur?.day
  const dropPending = useCallback(() => { setFeedback(null); setPending(null); setDraft(null) }, [])
  useEffect(() => {
    if (!curDay) return
    if (follow && shownDay.current && shownDay.current !== curDay) dropPending()
    shownDay.current = curDay
  }, [curDay, follow, dropPending])
  useEffect(() => {
    if (shownBase.current === base) return
    shownBase.current = base
    dropPending()
  }, [base, dropPending])

  const busy = pending !== null
  const send = useCallback(async (value, focus) => {
    const writeDay = writeDayRef.current
    if (!writeDay) return
    const mine = ++seq.current
    const sentFor = baseRef.current
    setFeedback(null)
    setPending({ value, seq: mine })
    const out = await logValue(trackerId, writeDay, value)
    if (!alive.current || baseRef.current !== sentFor) return
    // Only the newest log clears the pending value: an older answer never overwrites a newer press.
    setPending((x) => (x?.seq === mine ? null : x))
    setDraft(null)                                       // stored or refused, the box shows what is stored
    if (out.ok) { adoptAnswer(out.entry); return }
    failed(out, () => send(value, focus), focus)
  }, [trackerId, adoptAnswer, failed])

  const retry = () => {
    const f = feedback
    if (!f?.retry) return
    if (f.focus) wrap.current?.querySelector(f.focus)?.focus?.()
    else menuButton.current?.focus?.()
    f.retry()
  }

  // -- the ⋯ menu -------------------------------------------------------------------------------------------
  const tool = cur?.tool && typeof cur.tool === 'object' ? cur.tool : {}
  const name = typeof tool.name === 'string' ? tool.name : ''
  const archived = tool.archived === true
  const builtIn = tool.readOnly === true
  const kind = KINDS.has(tool.kind) ? tool.kind : 'number'
  const kindRef = useRef(kind)
  kindRef.current = kind
  const announce = useCallback((text) => { if (alive.current) setFeedback({ text }) }, [])

  const openMenu = () => {
    const r = menuButton.current?.getBoundingClientRect?.()
    setMenu({ x: r ? r.left : 0, y: r ? r.bottom : 0 })
  }
  const closeMenu = () => {
    setMenu(null)
    menuButton.current?.focus?.()
  }
  const manage = () => {
    import('../myTools/openMyTools')
      .then((m) => m.openMyTools({ editor, tab: 'trackers', defId: trackerId }))
      .catch(() => announce(TOOL_COPY.flagOff))
  }
  // Each setting is ONE setParams call, its search text riding the same transaction.
  const followToday = async () => {
    let day = null
    if (!isOffline()) {
      const r = await readDay('tracker', trackerId, 'today')
      if (r.ok && isDay(r.resolvedDay)) day = r.resolvedDay
    }
    day = day || resolvedTodayIfCurrent()
    if (!alive.current) return
    if (!day) {
      if (isOffline()) setOffline(true)
      else setFeedback({ text: TOOL_COPY.tickFailed, retry: followToday })
      return
    }
    setFeedback(null)
    setParams?.({ bind: 'today', day: '' }, { searchText: toolSearchText('tracker', name, day, 'today') })
  }
  const useNoteDay = () => {
    setFeedback(null)
    setParams?.({ bind: 'note-day', day: noteDay }, { searchText: toolSearchText('tracker', name, noteDay, 'note-day') })
  }
  const setDisplay = (next) => {
    const day = cur?.day || noteDay
    setFeedback(null)
    setParams?.({ display: next }, { searchText: toolSearchText('tracker', name, day, bind) })
  }
  const restore = async () => {
    setFeedback(null)
    toolSeen.current = null
    const out = await unarchive('tracker', trackerId)
    if (!alive.current) return
    // The layer re-reads every placed block of this tracker (this one too), handing each the tool. Only when that
    // re-read did not reach this block does it read afresh, so a normal Restore shows no loading screen.
    if (out.ok) {
      if (toolSeen.current?.archived !== false) setAttempt((n) => n + 1)
      return
    }
    failed(out, restore, null)
  }

  const menuItems = []
  if (editable && trackerId) {
    menuItems.push({ label: 'Manage…', onClick: manage })
    if (ready) {
      if (follow) menuItems.push({ label: "Use this note's day", onClick: useNoteDay })
      else if (offline && !resolvedTodayIfCurrent()) menuItems.push({ label: 'Follow today', disabled: true, hint: TOOL_COPY.offline })
      else menuItems.push({ label: 'Follow today', onClick: followToday })
      if (display === 'pnl') menuItems.push({ label: 'Show chart', onClick: () => setDisplay('chart') })
      else menuItems.push({ label: 'Show vs P&L', onClick: () => setDisplay('pnl') })
    }
    if (archived) menuItems.push({ label: 'Restore', onClick: restore })
  }

  // -- the body: what sits above the controls, the controls, the ONE live region, and what sits below -------------
  // Each is a fixed slot of the block, so the live region is the same element in every state (never remounted).
  // M-7: a state's sentence (not available, offline, a read failure) is said BY the one live region, never by a second
  // status element of its own.
  let top = null
  let control = null
  let bottom = null
  let stateLine = null
  if (!trackerId) {
    stateLine = { text: TOOL_COPY.missing }
  } else if (!cur) {
    top = <BlockLoading />
  } else if (cur.status === 'offline') {
    stateLine = { text: TOOL_COPY.offline }
  } else if (cur.status === 'unavailable') {
    stateLine = { text: TOOL_COPY.flagOff }
  } else if (cur.status === 'missing') {
    stateLine = { text: TOOL_COPY.missing }
  } else if (cur.status === 'failed') {
    stateLine = { text: TOOL_COPY.readFailedTracker, readRetry: true }
  } else {
    const entry = cur.entry || {}
    const unit = typeof tool.unit === 'string' && tool.unit ? tool.unit : null
    const stored = typeof entry.value === 'number' && Number.isFinite(entry.value) ? entry.value : null
    const summary = cur.summary || summaryFrom(null)
    const writable = entry.writable !== false
    const controls = editable && !archived && !builtIn && writable
    const inert = offline || busy
    let shut = null
    if (!archived && !builtIn && !writable) {
      if (tool.settings?.days === 'trading' && !isTradingDay(cur.day)) shut = TRADING_ONLY
      else shut = cur.day > todayET() ? futureLine(cur.day) : TOOL_COPY.window
    }
    const label = name || 'Tracker'
    // A button reads pressed for the value on its way, else the stored one (yes/no stored as 1 or 0).
    const pendingChoice = pending && kind === 'yesno' && typeof pending.value === 'boolean' ? (pending.value ? 1 : 0) : pending?.value
    const shownChoice = pending ? (pendingChoice ?? null) : stored
    const pressedOf = (v) => shownChoice !== null && shownChoice === v
    const press = (v) => {
      if (inert) return
      send(pressedOf(v) ? null : sendOf(kind, v), `[data-value="${v}"]`)
    }
    const commitInput = (text) => {
      if (inert) return
      const t = typedValue(kind, text)
      if (t.refused) { setDraft(null); setFeedback({ text: t.refused, invalid: true }); return }   // W9-R41: no request
      if (t.clear) {
        if (stored === null) { setDraft(null); return }
        send(null, '[data-value-input]')
        return
      }
      if (typeof t.value === 'number' && t.value === stored) { setDraft(null); return }
      send(t.value, '[data-value-input]')
    }
    if (controls && (kind === 'yesno' || kind === 'scale')) {
      control = (
        <div className={own.choices} role="group" aria-label={label}>
          {(kind === 'yesno' ? YESNO : SCALE).map((c) => (
            <button key={c.value} type="button" data-value={c.value} aria-pressed={pressedOf(c.value)}
              aria-disabled={inert || undefined}
              className={`btn btn-ghost ${own.tap} ${own.choice} ${pressedOf(c.value) ? own.choiceOn : ''}`}
              onClick={() => press(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      )
    } else if (controls) {
      const shownNumber = pending && typeof pending.value === 'number' ? pending.value : stored
      control = (
        <div className={own.inputRow}>
          <input type="text" data-value-input="" className={own.input} value={draft ?? inputText(kind, shownNumber)}
            inputMode={kind === 'number' ? 'decimal' : 'text'} enterKeyHint="done" autoComplete="off" spellCheck={false}
            placeholder={kind === 'duration' ? 'h:mm' : undefined}
            aria-label={kind === 'duration' ? `${label} (hours:minutes)` : label}
            aria-disabled={inert || undefined} aria-invalid={feedback?.invalid === true || undefined}
            aria-describedby={feedback ? liveId : undefined}
            onChange={(e) => { if (!inert) setDraft(e.target.value) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (draft !== null) commitInput(draft) } }}
            onBlur={() => { if (draft !== null) commitInput(draft) }} />
          {unit && kind === 'number' && <span className={own.unit}>{unit}</span>}
        </div>
      )
    }
    const avg = kind === 'yesno' ? null : valueText(kind, summary.average, unit)
    const latest = summary.latest ? valueText(kind, summary.latest.value, unit) : null
    // M-6: entries whose values are all unreadable are no entries to show: the empty line, never a blank body.
    const hasValues = summary.recent.some((e) => finite(e.value))
    top = (
      <>
        <p className={own.dayLine}>
          <span>{forDayLabel(cur.day, bind)}</span>
          {typeof entry.text === 'string' && entry.text && <span className={own.value} data-day-value="">{entry.text}</span>}
        </p>
        {archived && <p className={styles.muted}>{TOOL_COPY.archivedTracker}</p>}
        {builtIn && <p className={styles.muted}>{CHECKIN_LINE}</p>}
        {shut && <p className={styles.muted}>{shut}</p>}
      </>
    )
    const shownPnl = pnl?.tracker === trackerId ? pnl : null
    if (summary.n && hasValues) {
      bottom = (
        <>
          {avg && <p className={own.line} data-average="">{`Average ${avg} ${entriesText(summary.n)}`}</p>}
          {latest && <p className={own.line} data-latest="">{`Latest ${latest} (${dayWords(summary.latest.day)})`}</p>}
          {display === 'pnl'
            ? (
              <div className={own.pnlRow} data-vs-pnl="">
                <p className={own.line}>{!shownPnl ? 'Loading…' : shownPnl.ok ? shownPnl.sentence : TOOL_COPY.readFailedTracker}</p>
                {shownPnl && !shownPnl.ok && (
                  <button type="button" data-pnl-retry="" className={`btn btn-ghost ${own.tap}`} onClick={() => setPnlTick((n) => n + 1)}>Retry</button>
                )}
              </div>
            )
            : <TrackerChart points={summary.recent} kind={kind} unit={unit} name={name} trading={tool.settings?.days === 'trading'} />}
        </>
      )
    } else if (!builtIn) {
      bottom = <p className={styles.muted} data-empty="">{EMPTY_LINE}</p>
    }
  }

  // Going offline while ready is said ONCE, in the live region; a failure's sentence waits until the connection is back.
  const live = stateLine || (offline && ready ? { text: TOOL_COPY.offline } : feedback)
  return (
    <div className={own.wrap} data-tracker-block="" ref={wrap}>
      {menuItems.length > 0 ? (
        <div className={own.menuRow}>
          <button ref={menuButton} type="button" className={`btn btn-ghost ${own.tap} ${own.menuButton}`}
            aria-label={MENU_NAME} aria-haspopup={isTouch ? 'dialog' : 'menu'} aria-expanded={menu ? 'true' : 'false'}
            onClick={openMenu}>
            <UIcon name="more" size={16} gold={false} />
          </button>
        </div>
      ) : null}
      {top}
      {control}
      <div id={liveId} className={own.feedback} role="status" aria-live="polite" data-tracker-live="">
        {live && <span>{live.text}</span>}
        {live?.retry && <button type="button" className={`btn btn-ghost ${own.tap}`} onClick={retry}>Retry</button>}
        {live?.readRetry && (
          <button type="button" data-read-retry="" className={`btn btn-ghost ${own.tap}`}
            onClick={() => { focusAfterRead.current = true; setAttempt((n) => n + 1) }}>Retry</button>
        )}
      </div>
      {bottom}
      {menu ? <ContextPopover open onClose={closeMenu} anchor={menu} title={name || 'Tracker'} items={menuItems} /> : null}
    </div>
  )
}
