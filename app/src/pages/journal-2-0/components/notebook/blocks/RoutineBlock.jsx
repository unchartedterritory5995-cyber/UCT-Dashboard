// The routine block (Notebook widgets phase 2, wave 9, Task 9.13): a routine's items for the bound day as
// checkboxes, the day's progress, a skip toggle, and the consistency, run and best-run lines.
//
// params { routineId, day: ''|'YYYY-MM-DD', bind: 'note-day'|'next-trading-day'|'week'|'today', display }.
// The day it shows: `bind === 'today'` reads the day 'today' (the SERVER resolves it: the session on or after
// today ET) and follows it across ET midnight; else `params.day`; else, from the note's day
// (`editor.storage.uctJournalWidgets.noteDay`, else today ET), ruling W9-R33: `next-trading-day` is the session
// after it, `week` that week's last trading day (spec §6.2), and `note-day` the day itself.
//
// ⛔⛔ LIVE STATE IS NEVER NOTE STATE. A tick, a skip, a restore and an adopted entry go through lib/blocks/toolsApi
// (the routine tables, never a note); this file makes no request of its own. The body calls `setParams` ONLY from
// the ⋯ menu's two day settings ("Follow today", "Use this note's day"), each ONE call carrying its search text:
// never on mount, a read, a tick, a skip or an adoption.
// ⛔ Every sentence a member reads is TOOL_COPY's, the server's own line (consistency, run, best run, a refusal), or
//    a word below (ruling W9-R26). No surface shows a 0: the server sends no line for one, and the partial is shown
//    only once an item is ticked. A not-done day is a text label with a tooltip: never red, never struck out.
// ⛔ ONE live region, mounted for the block's whole life: a sentence set by a control (or by the menu, which closes
//    as it acts) is still on screen after that control is gone, and the offline sentence is said there once.
// ⛔ A busy or offline control is `aria-disabled` with a guard in its handler, never `disabled`, so focus stays on it.
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import ContextPopover from '../../../../../components/mobile/ContextPopover'
import UIcon from '../../../../../components/ui/UIcon'
import { useIsTouch } from '../../../../../hooks/useBreakpoint'
import { todayET } from '../../../lib/calendar'
import { TOOL_COPY, isOffline, readDay, resolvedTodayIfCurrent, setSkipped, subscribe, tick, unarchive } from '../../../lib/blocks/toolsApi'
import { editorNoteDay, forDayLabel, readKeyOf, sessionAfter, toolSearchText, weekLastSession } from '../../../lib/blocks/toolDays'
import { BlockLoading } from './blockStates'
import styles from './Blocks.module.css'
import own from './RoutineBlock.module.css'

/** The day states' member words (ruling W9-R26). `open` is a scheduled day today or later, not yet done. */
export const STATE_WORDS = Object.freeze({ done: 'Done', not_done: 'Not done', skipped: 'Skipped', off: 'Off day', open: 'Not yet' })
export const NOT_DONE_TIP = 'Not enough items were ticked to count this day as done.'
export const NEGATIVE_TICKED = "Didn't happen"
export const SKIP_OFF = 'Skip this day'
export const SKIP_ON = 'Skipped'
const MENU_NAME = 'Routine options'
/** Ruling W9-R34: a FUTURE day that cannot be ticked yet. */
export const futureLine = (day) => `You can tick this on ${forDayLabel(day).replace(/^For /, '')}.`

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const isDay = (d) => typeof d === 'string' && DAY_RE.test(d)
// The day helpers are lib/blocks/toolDays' (the tracker block reads its day by the same rule); re-exported here.
export { sessionAfter, weekLastSession }

/** A read's failure code -> the block's state. */
const READ_STATE = { offline: 'offline', unavailable: 'unavailable', missing: 'missing' }
/** Write refusals whose sentence is the server's own, with nothing to retry. */
const SERVER_SENTENCE = new Set(['read_only', 'count_cap', 'conflict'])

function ItemControl({ item, on, inert, onToggle }) {
  const noteId = useId()
  const negativeTicked = item.negative && on
  return (
    <li className={own.itemRow}>
      <button type="button" role="checkbox" aria-checked={on} aria-label={item.text} aria-disabled={inert || undefined}
        aria-describedby={negativeTicked ? noteId : undefined} data-item-id={item.id}
        className={`btn btn-ghost ${own.item} ${on ? own.itemOn : ''}`}
        onClick={() => { if (!inert) onToggle(item, !on) }}>
        <span className={`${own.box} ${on ? own.boxOn : ''}`} aria-hidden="true">
          {on && <UIcon name="check" size={14} gold={false} />}
        </span>
        <span className={own.text}>{item.text}</span>
        {negativeTicked && <span id={noteId} className={own.note}>{NEGATIVE_TICKED}</span>}
      </button>
    </li>
  )
}

function ItemText({ item, on }) {
  return (
    <li className={own.itemRow}>
      <span className={own.readItem}>
        <span className={`${own.box} ${on ? own.boxOn : ''}`} aria-hidden="true">
          {on && <UIcon name="check" size={14} gold={false} />}
        </span>
        <span className={own.text}>{item.text}</span>
        {item.negative && on && <span className={own.note}>{NEGATIVE_TICKED}</span>}
        {on && !item.negative && <span className="sr-only">(ticked)</span>}
      </span>
    </li>
  )
}

function StateWord({ state }) {
  const word = STATE_WORDS[state]
  if (!word) return null
  if (state === 'not_done') return <span className={own.state} title={NOT_DONE_TIP}>{word}</span>
  return <span className={own.state}>{word}</span>
}

export default function RoutineBlock({ params, setParams, editable, editor }) {
  const p = params || {}
  const routineId = typeof p.routineId === 'string' ? p.routineId : ''
  const bind = typeof p.bind === 'string' ? p.bind : 'note-day'
  const follow = bind === 'today'
  const noteDay = editorNoteDay(editor)
  const readKey = readKeyOf(p, noteDay)
  const base = `${routineId}|${readKey}`
  const isTouch = useIsTouch()

  const [attempt, setAttempt] = useState(0)
  // { base, attempt, status: 'ready'|'offline'|'unavailable'|'missing'|'failed', entry?, tool?, day? }. A read for
  // another (routine, day, attempt) is read as loading, so a settings change never shows the old day's ticks.
  const [read, setRead] = useState(null)
  const [overrides, setOverrides] = useState({})        // itemId -> { on, seq }: a tick on its way
  const [skipBusy, setSkipBusy] = useState(false)
  const [offline, setOffline] = useState(isOffline())
  const [feedback, setFeedback] = useState(null)         // { text, retry?, focus? }
  const [menu, setMenu] = useState(null)                 // the ⋯ menu's anchor while open
  const wrap = useRef(null)
  const menuButton = useRef(null)
  const alive = useRef(true)
  const seq = useRef(0)
  const focusAfterRead = useRef(false)
  const toolSeen = useRef(null)            // the tool a restore's re-read handed this block (N-2)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  const cur = read && read.base === base && read.attempt === attempt ? read : null

  // The read: one per (routine, day, attempt), batched by the layer with every other block's.
  useEffect(() => {
    if (!routineId) return undefined
    let live = true
    readDay('routine', routineId, readKey).then((r) => {
      if (!live) return
      if (r.ok) {
        setRead({ base, attempt, status: 'ready', entry: r.entry, tool: r.tool, day: r.resolvedDay })
      } else setRead({ base, attempt, status: READ_STATE[r.code] || 'failed' })
    })
    return () => { live = false }
  }, [routineId, readKey, base, attempt])

  // Adoption: a tick landed in this page (another block of the same routine and day) or in another tab, the tab came
  // back to the front, ET midnight passed, or the routine was restored (then the tool rides along). Never the note.
  // I-1: a follow-today block takes the entry's day (the server's new 'today'); any other block ignores another
  // day's entry, so a day line, its ticks and the next tick's day can never be two different days.
  useEffect(() => {
    if (!routineId) return undefined
    return subscribe('routine', routineId, readKey, (entry, tool) => {
      if (!alive.current || !entry || typeof entry !== 'object') return
      if (tool && typeof tool === 'object') toolSeen.current = tool
      setRead((r) => {
        if (!r || r.base !== base || r.status !== 'ready') return r
        const next = tool && typeof tool === 'object' ? { ...r, tool } : r
        if (follow) return isDay(entry.day) ? { ...next, entry, day: entry.day } : { ...next, entry }
        if (isDay(entry.day) && entry.day !== r.day) return r
        return { ...next, entry }
      })
    })
  }, [routineId, readKey, base, follow])

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

  // After a read Retry, once the read has landed: the block's first control, else the ⋯ button. A layout effect, so
  // the focus moves in the same commit that shows the control (N-3).
  useLayoutEffect(() => {
    if (!focusAfterRead.current || !cur) return
    focusAfterRead.current = false
    const root = wrap.current
    const el = (cur.status === 'ready'
      ? root?.querySelector('[role="checkbox"]') || root?.querySelector('[data-skip]')
      : root?.querySelector('[data-read-retry]')) || menuButton.current
    el?.focus?.()
  }, [cur])

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
    if (SERVER_SENTENCE.has(out.code) && out.message) { setFeedback({ text: out.message }); return }
    setFeedback({ text: TOOL_COPY.tickFailed, retry, focus })
  }, [])

  // N-5: the day a write goes to is read when it is SENT (a Retry made after ET midnight writes to the new day), and a
  // block whose day moves drops what was pending for the old one (its sentence and its Retry): a follow-today block
  // at ET midnight, and (Task 9.14 fix round 1, I-3) ANY block whose read key changes, a bind switch among them, so a
  // Retry can never write the old day's tick to the new day. An answer that lands after the switch is dropped too.
  const writeDayRef = useRef(null)
  writeDayRef.current = cur?.day ?? null
  const baseRef = useRef(base)
  baseRef.current = base
  const shownDay = useRef(null)
  const shownBase = useRef(base)
  const curDay = cur?.day
  useEffect(() => {
    if (!curDay) return
    if (follow && shownDay.current && shownDay.current !== curDay) { setFeedback(null); setOverrides({}) }
    shownDay.current = curDay
  }, [curDay, follow])
  useEffect(() => {
    if (shownBase.current === base) return
    shownBase.current = base
    setFeedback(null)
    setOverrides({})
  }, [base])
  const sendTick = useCallback(async (item, on) => {
    const writeDay = writeDayRef.current
    if (!writeDay) return
    const mine = ++seq.current
    const sentFor = baseRef.current
    setFeedback(null)
    setOverrides((o) => ({ ...o, [item.id]: { on, seq: mine } }))
    const out = await tick(routineId, writeDay, item.id, on)
    if (!alive.current || baseRef.current !== sentFor) return
    // Only the newest tick of this item clears its override: an older answer never overwrites a newer press.
    setOverrides((o) => {
      if (o[item.id]?.seq !== mine) return o
      const next = { ...o }
      delete next[item.id]
      return next
    })
    if (out.ok) { adoptAnswer(out.entry); return }
    failed(out, () => sendTick(item, on), `[data-item-id="${item.id.replace(/["\\]/g, '\\$&')}"]`)
  }, [routineId, adoptAnswer, failed])

  const sendSkip = useCallback(async (skipped) => {
    const writeDay = writeDayRef.current
    if (!writeDay) return
    const sentFor = baseRef.current
    setFeedback(null)
    setSkipBusy(true)
    const out = await setSkipped(routineId, writeDay, skipped)
    if (!alive.current) return
    setSkipBusy(false)
    if (baseRef.current !== sentFor) return
    if (out.ok) { adoptAnswer(out.entry); return }
    failed(out, () => sendSkip(skipped), '[data-skip]')
  }, [routineId, adoptAnswer, failed])

  const retry = () => {
    const f = feedback
    if (!f?.retry) return
    if (f.focus) wrap.current?.querySelector(f.focus)?.focus?.()
    else menuButton.current?.focus?.()
    f.retry()
  }

  // -- the ⋯ menu -------------------------------------------------------------------------------------------
  const name = typeof cur?.tool?.name === 'string' ? cur.tool.name : ''
  const archived = cur?.tool?.archived === true
  const announce = useCallback((text) => { if (alive.current) setFeedback({ text }) }, [])

  const openMenu = () => {
    const r = menuButton.current?.getBoundingClientRect?.()
    setMenu({ x: r ? r.left : 0, y: r ? r.bottom : 0 })
  }
  const closeMenu = () => {
    setMenu(null)
    menuButton.current?.focus?.()
  }
  const editRoutine = () => {
    import('../routines/openRoutineEditor')
      .then((m) => m.openRoutineEditor({ editor, routineId, announce }))
      .catch(() => announce(TOOL_COPY.flagOff))
  }
  const manage = () => {
    import('../myTools/openMyTools')
      .then((m) => m.openMyTools({ editor, tab: 'routines', defId: routineId }))
      .catch(() => announce(TOOL_COPY.flagOff))
  }
  // Each day setting is ONE setParams call, its search text riding the same transaction.
  const followToday = async () => {
    let day = null
    if (!isOffline()) {
      const r = await readDay('routine', routineId, 'today')
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
    setParams?.({ bind: 'today', day: '' }, { searchText: toolSearchText('routine', name, day, 'today') })
  }
  const useNoteDay = () => {
    setFeedback(null)
    setParams?.({ bind: 'note-day', day: noteDay }, { searchText: toolSearchText('routine', name, noteDay, 'note-day') })
  }
  const restore = async () => {
    setFeedback(null)
    toolSeen.current = null
    const out = await unarchive('routine', routineId)
    if (!alive.current) return
    // The layer re-reads every placed block of this routine (this one too), handing each the tool. Only when that
    // re-read did not reach this block (a write that landed meanwhile makes the layer drop it) does it read afresh,
    // so a normal Restore shows no loading screen and sends no second read (N-2).
    if (out.ok) {
      if (toolSeen.current?.archived !== false) setAttempt((n) => n + 1)
      return
    }
    failed(out, restore, null)
  }

  const menuItems = []
  if (editable && routineId) {
    menuItems.push({ label: 'Edit routine', onClick: editRoutine })
    menuItems.push({ label: 'Manage…', onClick: manage })
    if (cur?.status === 'ready') {
      if (follow) menuItems.push({ label: "Use this note's day", onClick: useNoteDay })
      else if (offline && !resolvedTodayIfCurrent()) menuItems.push({ label: 'Follow today', disabled: true, hint: TOOL_COPY.offline })
      else menuItems.push({ label: 'Follow today', onClick: followToday })
    }
    if (archived) menuItems.push({ label: 'Restore', onClick: restore })
  }

  // -- the body -------------------------------------------------------------------------------------------------
  // Task 9.14 fix round 1 (M-7): a state's sentence (not available, offline, a read failure) is said BY the one live
  // region, never by a second status element of its own.
  let body = null
  let stateLine = null
  if (!routineId) {
    stateLine = { text: TOOL_COPY.missing }
  } else if (!cur) {
    body = <BlockLoading />
  } else if (cur.status === 'offline') {
    stateLine = { text: TOOL_COPY.offline }
  } else if (cur.status === 'unavailable') {
    stateLine = { text: TOOL_COPY.flagOff }
  } else if (cur.status === 'missing') {
    stateLine = { text: TOOL_COPY.missing }
  } else if (cur.status === 'failed') {
    stateLine = { text: TOOL_COPY.readFailedRoutine, readRetry: true }
  } else {
    const entry = cur.entry || {}
    const items = Array.isArray(entry.items) ? entry.items.filter((it) => it && typeof it.id === 'string' && it.text) : []
    const tickedOf = (id) => (Object.hasOwn(overrides, id) ? overrides[id].on : entry.ticked?.[id] === true)
    const done = items.filter((it) => tickedOf(it.id)).length
    // The server's own rule: "4 of 6" once something is ticked, never "0 of 6" and never "0 of 0".
    const partial = done > 0 && items.length > 0 ? `${done} of ${items.length}` : null
    const shut = entry.writable === false && !archived && entry.state !== 'off'
    const future = shut && cur.day > todayET()                 // W9-R34: not yet; the 7-day sentence is for the past
    const controls = editable && !archived && entry.writable !== false
    const run = entry.run && typeof entry.run === 'object' ? entry.run : {}
    body = (
      <>
        <p className={own.dayLine}>
          <span>{forDayLabel(cur.day, bind)}</span>
          <StateWord state={entry.state} />
        </p>
        {archived && <p className={styles.muted}>{TOOL_COPY.archivedRoutine}</p>}
        {shut && <p className={styles.muted}>{future ? futureLine(cur.day) : TOOL_COPY.window}</p>}
        {items.length > 0 && (
          <ul className={own.items} aria-label={name || 'Routine'}>
            {items.map((it) => (controls
              ? <ItemControl key={it.id} item={it} on={tickedOf(it.id)} inert={offline || Object.hasOwn(overrides, it.id)} onToggle={sendTick} />
              : <ItemText key={it.id} item={it} on={tickedOf(it.id)} />))}
          </ul>
        )}
        {partial && <p className={own.partial}>{partial}</p>}
        {controls && (
          <button type="button" data-skip="" aria-pressed={entry.skipped === true} aria-disabled={offline || skipBusy || undefined}
            className={`btn btn-ghost ${own.tap} ${own.skip} ${entry.skipped === true ? own.skipOn : ''}`}
            onClick={() => { if (!offline && !skipBusy) sendSkip(entry.skipped !== true) }}>
            {entry.skipped === true ? SKIP_ON : SKIP_OFF}
          </button>
        )}
        {typeof entry.consistency === 'string' && entry.consistency && <p className={own.line}>{entry.consistency}</p>}
        {typeof run.line === 'string' && run.line && (
          <p className={`${own.line} ${run.milestone === true ? own.milestone : ''}`} data-milestone={run.milestone === true ? '' : undefined}>
            {run.line}
          </p>
        )}
        {typeof run.best === 'string' && run.best && <p className={own.line}>{run.best}</p>}
        {typeof entry.beyondNote === 'string' && entry.beyondNote && <p className={styles.muted}>{entry.beyondNote}</p>}
      </>
    )
  }

  // M-2: going offline while ready is said ONCE, here; a failure's sentence waits until the connection is back.
  const live = stateLine || (offline && cur?.status === 'ready' ? { text: TOOL_COPY.offline } : feedback)
  return (
    <div className={own.wrap} data-routine-block="" ref={wrap}>
      {menuItems.length > 0 && (
        <div className={own.menuRow}>
          <button ref={menuButton} type="button" className={`btn btn-ghost ${own.tap} ${own.menuButton}`}
            aria-label={MENU_NAME} aria-haspopup={isTouch ? 'dialog' : 'menu'} aria-expanded={menu ? 'true' : 'false'}
            onClick={openMenu}>
            <UIcon name="more" size={16} gold={false} />
          </button>
        </div>
      )}
      {body}
      <div className={own.feedback} role="status" aria-live="polite" data-routine-live="">
        {live && <span>{live.text}</span>}
        {live?.retry && <button type="button" className={`btn btn-ghost ${own.tap}`} onClick={retry}>Retry</button>}
        {live?.readRetry && (
          <button type="button" data-read-retry="" className={`btn btn-ghost ${own.tap}`}
            onClick={() => { focusAfterRead.current = true; setAttempt((n) => n + 1) }}>Retry</button>
        )}
      </div>
      {menu && (
        <ContextPopover open onClose={closeMenu} anchor={menu} title={name || 'Routine'} items={menuItems} />
      )}
    </div>
  )
}
