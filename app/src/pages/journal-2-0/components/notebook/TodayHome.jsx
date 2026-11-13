// Audit 2026-11-05, spec S15 (mockup M1) and S18: the Today home -- the reason to open the Notebook every morning.
// Notebook simplify, Task 5: it is the "Daily brief" now, an optional page (`?view=today`, the folders panel's "Daily
// brief" row). The Notebook opens on the notes list; this page no longer offers "Open the Notebook on" or a Research
// home link. Below the cards it carries two of Research home's boxes, folded: "Reporting soon" and "Passed setups"
// (each only while its switch is on; folded, a box is not mounted and reads nothing).
// Go-live wave 1: three more of Research home's pieces live here. The Notices box sits at the top of the cards (it
// renders nothing when there is nothing to tell), and "Needs review" and "Notes on your open positions" sit after the
// cards, each drawn only when it has rows.
//
// ⛔⛔ ONE REQUEST FOR THE CARDS. The phase cards are `GET /api/j2/notes/today?make=0` (notebook_today.py): today's note
// (READ, never made: simplify pass 2, B1), the setups near entry, the member's names,
// what is open from yesterday, on this day, the market line and the ET session. The cards never fetch on mount (the
// auth gate serialises every lazy read behind it); a card's own ask (adding names, writing the recap) runs only when
// the member presses it. The two review sections read `GET /api/j2/notebook/home` (useNotebookHome) only AFTER that
// read has answered, so they never delay a card; the Notices box makes its own two reads (NoticesBox.jsx).
//
// The page is a lazy view (tabs/NotebookTab.jsx `lazyView`): its bytes are not on the Notebook's first open.
//
// ⛔ NOTHING SHIFTS. While the read is in flight every card is drawn as a skeleton of the SAME card, in the same order
// and at the same reserved height (TodayHome.module.css), so the answer fills boxes that are already there.
//
// ⛔ ONLY WHAT IT HAS (simplify pass 2, B2 to B5). A card with nothing to show is not drawn: "Open from yesterday" and
// "On this day" when empty, "Today's plan" when it has no open lines, and a figure the member's plan does not include.
// Two asks stay, compact (a heading, one line, the field): no names asks for them (EmptyNamesAsk), no setups asks for
// the first plan (FirstPlanAsk). When nothing else is drawn, one quiet line says what will show here (NOTHING_YET). A
// section that could not be read is still said, with a retry (M7). The teaching sentences the empty cards used to carry
// are in Help (Support.jsx, the Notebook getting-started answer).
//
// ⛔ THE HEADER'S ONE BUTTON (B4) is today's note: "Open today's note" when it exists, "Start today's note" when it does
// not (the press makes it through NotebookTab's `openToday`, the door the list's "Today's note" and Ctrl+Alt+D use), and
// Restore / "Start a fresh one" when it is in Trash. Quick capture (the palette), All notes (the panel) and + New (the
// list) have their own doors.
//
// The cards' ORDER follows the ET session (`cardOrder`): the plan first before the open, the setups and names during
// the session, and after the close the recap first (S18, from 16:05 ET on a session day).
import { Suspense, useContext, useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useLocation } from 'react-router-dom'
import useSWR from 'swr'
import { AuthContext } from '../../../../context/AuthContext'
import usePreferences from '../../../../hooks/usePreferences'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import LoadFailed from '../LoadFailed'
import CollapsibleSection from '../CollapsibleSection'
import EmptyNamesAsk from './EmptyNamesAsk'
import FirstPlanAsk from './FirstPlanAsk'
import { FirstRunInlineSlot } from './FirstRunGate'
import lazyChunk, { importWithOneRetry } from '../../lib/lazyChunk'
import { DAILY_FOLDER_NOTICE, openDailyNote } from '../../lib/dailyNote'
import { TODAY_READ_URL } from '../../lib/todayHome'
import { firstRunInlineIsDue } from '../../lib/firstRun'
import { starterPacksEnabled } from '../../lib/starterPacksFlag'
import { TIPS_PREF } from '../../lib/notebookTips'
import { reviewDraftsEnabled } from '../../lib/reviewDraftsFlag'
import { invalidateNoteViews } from '../../lib/offline/invalidateNoteViews'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'
import { SETUPS_BOARD_PATH } from '../../lib/setupsBoardLink'
import { earningsPrepEnabled } from '../../lib/earningsPrepShared'
import { passedSetupsEnabled } from '../../lib/researchCapture'
import { NOTEBOOK_PREP_HASH } from '../../lib/notebookDoors'
import {
  getRegistryTourClosedCount, getRegistryTourWanted, hasPendingRegistryTourOpen, subscribeRegistryTourClosed,
  subscribeRegistryTourWanted,
} from './onboarding/tourRegistryControl'
import styles from './TodayHome.module.css'

export const TODAY_URL = '/api/j2/notes/today'

// Research home's two boxes, fetched only while their switch is on and the member opens them.
const ReportingSoon = lazyChunk(() => import('./ReportingSoon'))
const PassedSetups = lazyChunk(() => import('./PassedSetups'))
// Go-live wave 1, fix round 1: Research home's two note sections, a chunk of their own (TodayHomeNotes.jsx).
const HomeNotes = lazyChunk(() => import('./TodayHomeNotes'))
// Fix round 1: the Notices box's panel (the Journal Today panel, its own boundary inside) is fetched when the brief
// draws it, not with the brief (it renders nothing until it lands, and nothing with nothing to tell).
const NoticesPanel = lazyChunk(() => import('../../surfaces/today/panels/NoticesPanel'))

/** S18's button, verbatim. */
export const RECAP_ACTION = "Write today's recap (about 1 minute)"
export const RECAP_WRITTEN = "Today's recap is in today's note."
/** I3: the plan card when today's note is in the Trash (the coordinator's ruling, verbatim). */
export const TRASHED_NOTE = "Today's note is in Trash."
export const RESTORE_ACTION = 'Restore'
export const FRESH_ACTION = 'Start a fresh one'
/** B1 / B4: the header's one button, by what the read said about today's note. `NOTE_ACTION` (the list's own words)
 *  while that is not known: the read failed, or its today's-note section did. */
export const START_ACTION = "Start today's note"
export const OPEN_ACTION = "Open today's note"
export const NOTE_ACTION = "Today's note"
/** B5, verbatim: the one quiet line when no card has anything to show. */
export const NOTHING_YET = 'Nothing for today yet. Your plan, the setups near your entry and your names will show here.'
/** B3: the names ask's one line on the brief (EmptyNamesAsk's full sentence is the widgets'). */
export const NAMES_ASK_LINE = 'Add the tickers you watch, and your earnings and plan will follow them.'
/** I7: the order the cards are reserved in before the server has said which session it is. Every half-width card
 *  reserves the SAME height (TodayHome.module.css), so the answer's own order fills the same total space whatever it
 *  is (a holiday's "closed" order included) and nothing below the grid moves. */
export const SKELETON_ORDER = Object.freeze(['plan', 'setups', 'names', 'yesterday', 'onThisDay'])

/** The cards, in each ET session's order (S15). `recap` is drawn only when the server offers it (S18). */
export const CARD_ORDER = Object.freeze({
  premarket: ['plan', 'setups', 'names', 'yesterday', 'onThisDay'],
  open: ['setups', 'names', 'plan', 'yesterday', 'onThisDay'],
  after_close: ['recap', 'plan', 'yesterday', 'names', 'setups', 'onThisDay'],
  closed: ['plan', 'yesterday', 'onThisDay', 'setups', 'names'],
})

export function cardOrder(session, { recapOn = true } = {}) {
  const order = CARD_ORDER[session?.phase] || CARD_ORDER.premarket
  return order.filter((c) => c !== 'recap' || (recapOn && session?.recap === true))
}

const PHASE_LABEL = { premarket: 'Pre-market', open: 'Market open', after_close: 'After the close', closed: 'Market closed' }

/** The ET clock's phase before the server has answered, so the skeleton is already in the right order. */
function etParts(now = new Date()) {
  const f = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
  })
  const p = Object.fromEntries(f.formatToParts(now).map((x) => [x.type, x.value]))
  return { weekday: p.weekday, hour: Number(p.hour), minute: Number(p.minute) }
}

export function clientSession(now = new Date()) {
  const { weekday, hour, minute } = etParts(now)
  const hm = hour * 60 + minute
  const phase = weekday === 'Sat' || weekday === 'Sun' ? 'closed'
    : hm < 570 ? 'premarket' : hm < 960 ? 'open' : 'after_close'
  return { phase, recap: phase === 'after_close' && hm >= 965 }
}

function greeting(now = new Date()) {
  const { hour } = etParts(now)
  return hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'
}

function fmtDay(iso) {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

function fmtShortDay(iso) {
  const d = new Date(`${iso}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}

function fmtToOpen(min) {
  if (!Number.isFinite(min) || min <= 0) return null
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h ? `${h} h ` : ''}${m} m to the open`
}

const isNum = (v) => typeof v === 'number' && Number.isFinite(v)
const fmtPct = (v) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`
const tone = (v) => (isNum(v) ? (v > 0 ? styles.up : v < 0 ? styles.dn : '') : '')

/** The header's one line: the date, the session and the market line (each part only when it is known). */
export function headerLine(data, now = new Date()) {
  const s = data?.session || {}
  const parts = []
  if (data?.day) parts.push(fmtDay(data.day))
  if (s.phase) parts.push(PHASE_LABEL[s.phase] || s.phase)
  const m = data?.market
  if (m?.regimeWord) parts.push(`${m.regimeWord} regime`)
  if (isNum(m?.pctAbove50)) parts.push(`${m.pctAbove50}% above the 50-day`)
  const toOpen = s.phase === 'premarket' ? fmtToOpen(s.minutesToOpen) : null
  if (toOpen) parts.push(toOpen)
  if (!parts.length) parts.push(fmtDay(new Date(now).toISOString().slice(0, 10)))
  return parts.join(' · ')
}

async function fetchToday(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Today could not be read (${res.status})`)
    err.status = res.status
    throw err
  }
  return res.json()
}

// ── cards ────────────────────────────────────────────────────────────────────────────────────

function Card({ id, title, aside, wide = false, children, testId }) {
  const uid = useId()
  return (
    <section className={`${styles.card} ${styles[`card_${id}`] || ''} ${wide ? styles.wide : ''}`}
      aria-labelledby={`${uid}-t`} data-today-card={id} data-testid={testId}>
      <div className={styles.cardHead}>
        <h3 id={`${uid}-t`} className={styles.cardTitle}>{title}</h3>
        {aside != null && <span className={styles.cardAside}>{aside}</span>}
      </div>
      {children}
    </section>
  )
}

/** A section the server did not send. `plan` (fix round 1, I6): a figure the member's plan does not include -- the
 *  card's own neutral empty line, never an upsell. Anything else could not be read: said, with a retry (M7). */
function Unavailable({ reason, empty, onRetry }) {
  if (reason === 'plan') return <p className={styles.quiet}>{empty}</p>
  return (
    <div className={styles.unavailable}>
      <p className={styles.quiet}>This could not be read just now.</p>
      {onRetry && <button type="button" className={styles.action} onClick={onRetry}>Try again</button>}
    </div>
  )
}

/** I3: today's note is in the Trash. The read never replaces it; the member chooses (the header's pair, B4). */
function TrashedNoteActions({ note, templateId, onChanged }) {
  const [busy, setBusy] = useState(null)
  const [error, setError] = useState('')
  const run = async (which, fn) => {
    if (busy) return
    setBusy(which)
    setError('')
    try {
      await fn()
      invalidateNoteViews({ tags: true })
      onChanged?.()
    } catch (e) {
      setError(e?.message && !/^\d+$/.test(e.message) ? e.message : 'That did not go through. Nothing was changed.')
    } finally {
      setBusy(null)
    }
  }
  const restore = () => run('restore', async () => {
    // The batch door: it lands the restored revision (settleNoteWrites) before anything refreshes.
    const { runNoteBatch } = await importWithOneRetry(() => import('../../lib/noteBatch'))
    const out = await runNoteBatch({ ids: [note.id], op: 'restore' })
    if (!out?.results?.some((r) => r.status === 'changed' || r.status === 'unchanged')) throw new Error('')
  })
  const fresh = () => run('fresh', () => openDailyNote({ templateId: templateId || undefined, seedToday: true }))
  return (
    <div className={styles.trashed} data-today-trashed="">
      <p className={styles.quietInline}>{TRASHED_NOTE}</p>
      <button type="button" className="btn btn-ghost btn-sm" disabled={Boolean(busy)} onClick={restore}>{RESTORE_ACTION}</button>
      <button type="button" className="btn btn-primary btn-sm" disabled={Boolean(busy)} onClick={fresh}>{FRESH_ACTION}</button>
      {error && <p className={styles.error} role="alert">{error}</p>}
    </div>
  )
}

/** B4: the header's one button for today's note. `state` is todayNoteState's answer. */
function TodayNoteAction({ state, note, templateId, onOpenNote, onStart, onChanged }) {
  const [starting, setStarting] = useState(false)
  if (state === 'loading') {
    // Holds the button's room until the read answers, so nothing in the header wraps or moves when it lands.
    return <span className={`btn btn-primary btn-sm ${styles.actionHold}`} aria-hidden="true">{START_ACTION}</span>
  }
  if (state === 'trashed') return <TrashedNoteActions note={note} templateId={templateId} onChanged={onChanged} />
  if (state === 'exists') {
    return (
      <button type="button" className="btn btn-primary btn-sm" onClick={() => onOpenNote?.({ id: note.id, title: note.title })}>
        {OPEN_ACTION}
      </button>
    )
  }
  const start = async () => {
    if (starting) return
    setStarting(true)
    try { await onStart?.() } finally { setStarting(false) }
  }
  return (
    <button type="button" className="btn btn-primary btn-sm" disabled={starting} aria-busy={starting || undefined}
      onClick={start}>
      {state === 'missing' ? START_ACTION : NOTE_ACTION}
    </button>
  )
}

/** What the read said about today's note: `loading` (no answer yet), `unknown` (the read or its section failed),
 *  `trashed`, `missing` (none today: B1 never makes one) or `exists`. */
export function todayNoteState(data, error) {
  if (!data) return error ? 'unknown' : 'loading'
  const n = data.todayNote
  if (!n) return 'unknown'
  if (n.trashed) return 'trashed'
  if (n.missing || !n.id) return 'missing'
  return 'exists'
}

/** B2: the plan card is drawn for an existing note with open lines only (the header's button opens the note). */
function PlanCard({ note, reason, onRetry }) {
  if (!note) {
    return <Card id="plan" title="Today's plan" wide><Unavailable reason={reason} onRetry={onRetry} /></Card>
  }
  const aside = note.templateName ? `Started from “${note.templateName}”` : null
  return (
    <Card id="plan" title="Today's plan" aside={aside} wide testId="today-plan">
      <ul className={styles.checks} aria-label="Today's plan">
        {note.items.map((it) => (
          <li key={it.index} className={styles.check}>
            <span className={`${styles.box} ${it.checked ? styles.boxDone : ''}`} aria-hidden="true" />
            <span className={it.checked ? styles.doneText : ''}>{it.text}</span>
            <span className="sr-only">{it.checked ? ' (done)' : ' (open)'}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function setupDistance(r) {
  if (r.state === 'invalidated') return <span className={styles.dn}>below stop</span>
  if (r.state === 'triggered') return <span className={styles.up}>triggered</span>
  if (r.state === 'no_price') return <span className={styles.quietInline}>no price yet</span>
  if (isNum(r.distancePct)) return <span>{Math.abs(r.distancePct).toFixed(1)}% away</span>
  return null
}

function setupFacts(r) {
  if (r.state === 'invalidated') return 'below stop, review'
  if (r.state === 'triggered') return 'triggered'
  if (r.state === 'no_price') return 'no price yet'
  return [isNum(r.distancePct) ? `${Math.abs(r.distancePct).toFixed(1)}% away` : null,
    isNum(r.distanceR) ? `${r.distanceR}R` : null, isNum(r.entry) ? `entry ${r.entry}` : null].filter(Boolean).join(', ')
}

function SetupsCard({ setups, reason, onOpenNote, onRetry }) {
  if (!setups) {
    return (
      <Card id="setups" title="Setups near entry">
        <Unavailable reason={reason} empty="No setups to show." onRetry={onRetry} />
      </Card>
    )
  }
  const rows = setups.rows || []
  return (
    <Card id="setups" title="Setups near entry" aside={rows.length ? 'closest first' : null} testId="today-setups">
      {rows.length === 0 ? <FirstPlanAsk compact /> : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={`${r.noteId}:${r.symbol}`}>
              <button type="button" className={styles.row} onClick={() => onOpenNote?.({ id: r.noteId })}
                aria-label={[r.symbol, r.setupTag || r.noteTitle || 'plan', setupFacts(r)].filter(Boolean).join(', ')}>
                <span className={styles.tk}>{r.symbol}</span>
                <span className={styles.rowMain}>{r.setupTag || r.noteTitle || 'Plan'}{r.state === 'waiting' || r.state === 'watching' ? ` · ${r.state}` : ''}</span>
                <span className={styles.rowNum}>{setupDistance(r)}</span>
                <span className={styles.rowEnd}>
                  {r.state === 'invalidated' ? 'Review →'
                    : [isNum(r.distanceR) ? `${r.distanceR}R` : null, isNum(r.entry) ? `entry ${r.entry}` : null]
                      .filter(Boolean).join(' · ')}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {setups.count > 0 && (
        <div className={styles.cardFoot}>
          <Link className={styles.action} to={SETUPS_BOARD_PATH}>
            {setups.more > 0 ? `${setups.more} more on the setups board →` : 'Open the setups board →'}
          </Link>
        </div>
      )}
    </Card>
  )
}

function nameLabel(r) {
  const e = r.earnings
  if (e) {
    const when = e.daysAway === 0 ? 'today' : e.daysAway === 1 ? 'tomorrow' : fmtShortDay(e.date).replace(/, \d{4}$/, '')
    return `Earnings ${when}${e.timing ? ` ${e.timing.toUpperCase()}` : ''}`
  }
  if (r.buzzHigh) return 'Room buzz high'
  return null
}

function nameEnd(r) {
  if (r.earnings && isNum(r.earnings.expectedMovePct)) return `exp. move ±${r.earnings.expectedMovePct}%`
  if (r.buzzHigh && isNum(r.mentions)) return `${r.mentions} mentions`
  if (isNum(r.price)) return `at ${r.price}`
  return ''
}

function NamesCard({ names, reason, onChanged }) {
  const [adding, setAdding] = useState(false)
  // M7: a names read that failed is said with a retry -- never the "add tickers" ask to a member who has names.
  if (!names) return <Card id="names" title="Your names"><Unavailable reason={reason} onRetry={onChanged} /></Card>
  const rows = names.rows || []
  const empty = names.count === 0
  return (
    <Card id="names" title="Your names" testId="today-names"
      aside={empty ? null : (
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Done' : 'Add'}
        </button>
      )}>
      {empty ? (
        // B3: compact on the brief -- the one line and the field (no suggestions, no import row).
        <EmptyNamesAsk testId="today-names-ask" sentence={NAMES_ASK_LINE} suggestions={[]} canImport={false}
          onAdded={() => onChanged?.()} />
      ) : adding ? (
        <EmptyNamesAsk testId="today-names-ask" onAdded={() => onChanged?.()} />
      ) : null}
      {!empty && (
        <ul className={styles.list} aria-label="Your names">
          {rows.map((r) => (
            <li key={r.symbol} className={styles.row} data-static="">
              <span className={styles.tk}>{r.symbol}</span>
              <span className={styles.rowMain}>
                {nameLabel(r) || ''}
              </span>
              <span className={`${styles.rowNum} ${tone(r.changePct)}`}>{isNum(r.changePct) ? fmtPct(r.changePct) : ''}</span>
              <span className={styles.rowEnd}>{nameEnd(r)}</span>
            </li>
          ))}
        </ul>
      )}
      {!empty && names.more > 0 && <p className={styles.quiet}>{names.more} more on your lists.</p>}
    </Card>
  )
}

function YesterdayCard({ open, reason, onOpenNote, onRetry }) {
  if (!open) return <Card id="yesterday" title="Open from yesterday"><Unavailable reason={reason} onRetry={onRetry} /></Card>
  const items = open.items || []
  return (
    <Card id="yesterday" title="Open from yesterday" aside={open.count ? String(open.count) : null} testId="today-yesterday">
      <ul className={styles.list}>
        {items.map((it) => (
          <li key={`${it.noteId}:${it.index}`}>
            <button type="button" className={styles.row} onClick={() => onOpenNote?.({ id: it.noteId })}
              title={`In ${it.noteTitle || 'a note'}`}>
              <span className={styles.box} aria-hidden="true" />
              <span className={styles.rowMain}>{it.text}</span>
              <span className={`${styles.rowEnd} ${it.from === 'overdue' ? styles.dn : ''}`}>
                {it.from === 'yesterday' ? '' : it.from === 'overdue' ? `due ${fmtShortDay(it.due).replace(/, \d{4}$/, '')}` : 'due today'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {open.more > 0 && <p className={styles.quiet}>{open.more} more in your tasks.</p>}
    </Card>
  )
}

function OnThisDayCard({ onThisDay, reason, onOpenNote, onRetry }) {
  if (!onThisDay) return <Card id="onThisDay" title="On this day"><Unavailable reason={reason} onRetry={onRetry} /></Card>
  const items = onThisDay.items || []
  const first = items[0]
  const aside = first ? (first.yearsAgo === 1 ? '1 year ago' : `${first.yearsAgo} years ago`) : null
  return (
    <Card id="onThisDay" title="On this day" aside={aside} testId="today-on-this-day">
      <ul className={styles.list}>
        {items.map((n) => (
          <li key={n.noteId}>
            <button type="button" className={styles.memory} onClick={() => onOpenNote?.({ id: n.noteId })}>
              {n.snippet && <span className={styles.quote}>“{n.snippet}”</span>}
              <span className={styles.from}>From {n.title || 'Untitled'} · {fmtShortDay(n.day)}</span>
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/** S18: after 16:05 ET, the existing review drafts written into today's note (never a new folder or note). */
function RecapCard({ note, onOpenNote, onNotice, onWritten }) {
  // M8: the selected account is read from this tab's own choice; the accounts list is not fetched for it.
  const { accountId } = useJ2SelectedAccount(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const written = note?.recapWritten === true
  const write = async () => {
    if (busy) return
    setBusy(true)
    setError('')
    try {
      const m = await importWithOneRetry(() => import('../../lib/reviewDrafts'))
      const { note: landed, created } = await m.draftDailyReview({ accountId, day: m.todayDayIso() })
      if (created) onNotice?.(DAILY_FOLDER_NOTICE)
      invalidateNoteViews({ tags: true })
      onWritten?.()
      onOpenNote?.(landed, null, { to: 'collapsed' })
    } catch (e) {
      setError(e?.memberMessage || "Couldn't write today's recap. Nothing was changed. Try again.")
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card id="recap" title="Today's recap" wide testId="today-recap">
      {written ? (
        <>
          <p className={styles.quiet}>{RECAP_WRITTEN}</p>
          <div className={styles.cardFoot}>
            <button type="button" className={styles.action} onClick={() => onOpenNote?.({ id: note.id })}>Open today’s note →</button>
          </div>
        </>
      ) : (
        <>
          <p className={styles.quiet}>Your numbers, discipline and best and worst trade, drafted into today’s note.</p>
          <div className={styles.cardFoot}>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} aria-busy={busy || undefined} onClick={write}>
              {busy ? 'Writing…' : RECAP_ACTION}
            </button>
          </div>
        </>
      )}
      {error && <p className={styles.error} role="alert">{error}</p>}
    </Card>
  )
}

function SkeletonCard({ id, wide }) {
  return (
    <section className={`${styles.card} ${styles[`card_${id}`] || ''} ${wide ? styles.wide : ''} ${styles.skeleton}`}
      aria-hidden="true" data-today-skeleton={id}>
      <span className={styles.skelTitle} />
      <span className={styles.skelLine} />
      <span className={styles.skelLine} />
    </section>
  )
}

/** Research home's "Reporting soon" and "Passed setups", below the cards, folded by default (the member's own
 *  open/closed choice is kept per box, CollapsibleSection). A walkthrough running now unfolds both, so its anchors are
 *  on screen; the palette's "Earnings prep" (`#prep`) unfolds Reporting soon. */
function MoreBoxes({ onOpenNote }) {
  const prepOn = earningsPrepEnabled()
  const passedOn = passedSetupsEnabled()
  const tourWanted = useSyncExternalStore(subscribeRegistryTourWanted, getRegistryTourWanted, () => null)
  const location = useLocation()
  if (!prepOn && !passedOn) return null
  const tourSignal = tourWanted ? `tour:${tourWanted}` : null
  const prepSignal = location.hash === NOTEBOOK_PREP_HASH ? `prep:${location.key}` : null
  return (
    <div className={styles.more} data-today-more="">
      {prepOn && (
        <CollapsibleSection id="nb-today-reporting-soon" title="Reporting soon" openSignal={tourSignal || prepSignal}>
          <Suspense fallback={null}><ReportingSoon onOpenNote={onOpenNote} /></Suspense>
        </CollapsibleSection>
      )}
      {passedOn && (
        <CollapsibleSection id="nb-today-passed-setups" title="Passed setups" openSignal={tourSignal}>
          <Suspense fallback={null}><PassedSetups /></Suspense>
        </CollapsibleSection>
      )}
    </div>
  )
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────

/** Milliseconds to the next ET wall-clock time `hh:mm` (today's, else tomorrow's). */
export function msUntilET(hh, mm, now = new Date()) {
  const { hour, minute } = etParts(now)
  const nowMin = hour * 60 + minute
  let diff = hh * 60 + mm - nowMin
  if (diff <= 0) diff += 24 * 60
  return diff * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds() + 1000
}

/** The ET calendar day of `now`, as YYYY-MM-DD. */
function etDay(now) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** How old an answer may be before a return to the tab reads again (fix round 2, N4). */
export const REVISIT_STALE_MS = 90_000

/** M1: Today re-reads when the tab comes back into view, and at the session boundaries that change what it shows --
 *  the recap's start (16:05 ET, the server's own `recapFrom` on a half-day) and ET midnight (a new day's note).
 *  N4: a return to the tab re-reads only when the answer is REVISIT_STALE_MS old, or the ET day or the session phase
 *  has changed since it was read -- flicking between the chart and the Notebook costs nothing. */
function useTodayRefresh(mutate, data) {
  const readAt = useRef(0)
  const answer = useRef(null)
  useEffect(() => {
    if (!data) return
    readAt.current = Date.now()
    answer.current = { day: data.day, phase: data.session?.phase }
  }, [data])
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState !== 'visible' || !answer.current) return
      const now = new Date(Date.now())
      const moved = etDay(now) !== answer.current.day || clientSession(now).phase !== answer.current.phase
      if (moved || Date.now() - readAt.current >= REVISIT_STALE_MS) mutate()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [mutate])
  const recapFrom = data?.session?.recapFrom
  useEffect(() => {
    const [h, m] = String(recapFrom || '16:05').split(':').map(Number)
    const timers = [setTimeout(() => mutate(), msUntilET(h, m)), setTimeout(() => mutate(), msUntilET(0, 0))]
    return () => timers.forEach(clearTimeout)
  }, [mutate, recapFrom])
}

/** B2: what a card draws for this answer -- `content`, `ask` (the compact first-run ask: no setups, or no names) or
 *  `retry` (its section could not be read: said, with a retry, M7) -- or null: nothing to show, so it is not drawn. A
 *  figure the member's plan does not include (`reasons[key] === 'plan'`) is nothing to show. */
export function cardKind(id, data) {
  const reasons = data?.reasons || {}
  const unread = (key) => (reasons[key] === 'plan' ? null : 'retry')
  const listed = (section, key) => (!section ? unread(key) : (section.items || []).length ? 'content' : null)
  switch (id) {
    case 'recap': return 'content'
    case 'plan': {
      const n = data?.todayNote
      if (!n) return unread('todayNote')
      return !n.trashed && !n.missing && n.id && n.openCount > 0 && (n.items || []).length ? 'content' : null
    }
    case 'setups':
      if (!data?.setups) return unread('setups')
      return (data.setups.rows || []).length ? 'content' : 'ask'
    case 'names':
      if (!data?.names) return unread('names')
      return data.names.count === 0 ? 'ask' : 'content'
    case 'yesterday': return listed(data?.openFromYesterday, 'openFromYesterday')
    case 'onThisDay': return listed(data?.onThisDay, 'onThisDay')
    default: return null
  }
}

/** I7: the inline first-run ask after a Skip sits BELOW the cards, in a slot that holds its height from the first
 *  paint when the preferences already say it is due, so it never pushes a card. */
function FirstRunSlot({ onOpenNote, onOpenToday }) {
  const on = starterPacksEnabled()
  const { prefs, loading, readFailed } = usePreferences(on)
  const due = firstRunInlineIsDue({ enabled: on, prefsReady: !loading && !readFailed, tipsRaw: prefs?.[TIPS_PREF] })
  return (
    <div className={due ? styles.firstRunSlot : undefined} data-today-first-run={due ? 'due' : ''}>
      <FirstRunInlineSlot onOpenNote={onOpenNote} onOpenToday={onOpenToday} />
    </div>
  )
}

export default function TodayHome({
  onOpenNote, onOpenToday, onNotice, dailyTemplateId = '', headingRef,
}) {
  const auth = useContext(AuthContext)
  // B1 (simplify pass 2): ONE read, `make=0`, in every state -- opening the brief never makes today's note or its
  // folder. It used to make the note (`make` / `hold` / `wait`, decided by NotebookTab from the first run's state).
  const { data, error, mutate } = useSWR(TODAY_READ_URL, fetchToday,
    { revalidateOnFocus: false, shouldRetryOnError: false })
  const recapOn = reviewDraftsEnabled()
  const order = data ? cardOrder(data.session, { recapOn }) : SKELETON_ORDER
  const reasons = data?.reasons || {}
  useTodayRefresh(mutate, data)
  // Review 4e: a registry walkthrough running now (the signal MoreBoxes unfolds the boxes on).
  const tourWanted = useSyncExternalStore(subscribeRegistryTourWanted, getRegistryTourWanted, () => null)
  // Final fix (C5): the gate publishes the wanted tour from an EFFECT, after the render in which this home first draws
  // (with its chunk in hand), so the latches below could set before the tour was wanted and Notices drew under a
  // starting tour. A walkthrough asked for on THIS visit (Help's navigation state, or a request still pending) holds
  // the latches from the first render until that tour has ended (the gate's closed count moves on, which it also does
  // for a request it drops).
  const location = useLocation()
  const closedCount = useSyncExternalStore(subscribeRegistryTourClosed, getRegistryTourClosedCount, () => 0)
  const [askedAt] = useState(() => (
    location.state?.startRegistryTourId || hasPendingRegistryTourOpen() ? getRegistryTourClosedCount() : null))
  const tourAsked = Boolean(tourWanted) || (askedAt !== null && closedCount === askedAt)
  // Fix round 2 (re-review): the hold covers only what has not been drawn yet. Once Notices or the note sections are on
  // screen they stay, so a walkthrough that starts later never unmounts them and shifts the boxes up mid-tour.
  const [noticesDrawn, setNoticesDrawn] = useState(false)
  const [notesDrawn, setNotesDrawn] = useState(false)
  const showNotices = noticesDrawn || !tourAsked
  const showNotes = notesDrawn || (Boolean(data || error) && !tourAsked)
  if (showNotices && !noticesDrawn) setNoticesDrawn(true)
  if (showNotes && !notesDrawn) setNotesDrawn(true)

  // S20 "Morning open rate": the Today home opened, once per mount. `created` stays in the event and is false on every
  // open now (B1: the read never makes the note); a Start press is the list button's own door.
  const trackedRef = useRef(false)
  useEffect(() => {
    if (!data || trackedRef.current) return
    trackedRef.current = true
    trackNotebookEvent(NOTEBOOK_EVENTS.TODAY_OPENED, {
      session: data.session?.phase, created: data.todayNote?.created === true,
    })
  }, [data])

  const name = String(auth?.user?.display_name || '').trim().split(/\s+/)[0]
  const refresh = () => mutate()
  // B1: "Start today's note" is NotebookTab's `openToday` (the list's "Today's note" and Ctrl+Alt+D), never a second
  // create path. It opens the note and revalidates this read, so a return here says "Open today's note". The seed is
  // what the read used to write into a note it made: today's plan from the held figures (S18).
  const startTodayNote = () => onOpenToday?.({ seedToday: true })
  const noteState = todayNoteState(data, error)
  // B2: only what has something to show is drawn, in the session's order. B5: nothing but the asks -> one quiet line.
  const drawn = data ? order.filter((id) => cardKind(id, data)) : order
  const nothingYet = Boolean(data) && !drawn.some((id) => cardKind(id, data) !== 'ask')

  const card = (id) => {
    const wide = id === 'plan' || id === 'recap'
    if (!data) return <SkeletonCard key={id} id={id} wide={wide} />
    switch (id) {
      case 'plan': return <PlanCard key={id} note={data.todayNote} reason={reasons.todayNote} onRetry={refresh} />
      case 'recap': return (
        <RecapCard key={id} note={data.todayNote} onOpenNote={onOpenNote} onNotice={onNotice} onWritten={refresh} />
      )
      case 'setups': return (
        <SetupsCard key={id} setups={data.setups} reason={reasons.setups} onOpenNote={onOpenNote} onRetry={refresh} />
      )
      case 'names': return <NamesCard key={id} names={data.names} reason={reasons.names} onChanged={refresh} />
      case 'yesterday': return (
        <YesterdayCard key={id} open={data.openFromYesterday} reason={reasons.openFromYesterday} onOpenNote={onOpenNote}
          onRetry={refresh} />
      )
      case 'onThisDay': return (
        <OnThisDayCard key={id} onThisDay={data.onThisDay} reason={reasons.onThisDay} onOpenNote={onOpenNote}
          onRetry={refresh} />
      )
      default: return null
    }
  }

  return (
    <div className={styles.today} data-today-home="" aria-busy={!data && !error ? true : undefined}>
      <header className={styles.head}>
        <div className={styles.headText}>
          {/* M4: the page's h1 is the Journal's ("Trade Journal"); this section's heading is the panel row's own name,
              "Daily brief" (simplify pass 2, A1). The greeting leads the date line under it. */}
          {/* Simplify pass 2: the page's ONE "Daily brief" heading, and the pane's focus landing (NotebookTab hands down
              `paneHeadingRef` and draws no hidden heading of its own here). Programmatic focus only (tabIndex -1); the
              app's own :focus-visible ring shows it to a keyboard member. */}
          <h2 ref={headingRef} tabIndex={-1} className={styles.hello} data-focus-fallback="">Daily brief</h2>
          <p className={styles.sub} data-today-line="">
            {`${name ? `${greeting()}, ${name}` : greeting()} · ${headerLine(data)}`}
          </p>
        </div>
        <div className={styles.headActions} data-today-actions="">
          <TodayNoteAction state={noteState} note={data?.todayNote} templateId={dailyTemplateId} onOpenNote={onOpenNote}
            onStart={startTodayNote} onChanged={refresh} />
        </div>
      </header>
      {error && <LoadFailed compact what="Today" error={error} onRetry={refresh} />}
      {/* Go-live wave 1: Research home's Notices, at the top of the cards (nothing at all when there is nothing).
          Fix round 1 (review 4e): held while a walkthrough is wanted, with the note sections below: both land late and
          would push the folded boxes a tour has just scrolled into view. They come in when the tour ends. Fix round 2:
          only what has not been drawn yet is held; once drawn, they stay. */}
      {showNotices && <Suspense fallback={null}><NoticesPanel /></Suspense>}
      {nothingYet && <p className={styles.quiet} data-today-nothing="">{NOTHING_YET}</p>}
      {!error && <div className={styles.grid}>{drawn.map(card)}</div>}
      <FirstRunSlot onOpenNote={onOpenNote} onOpenToday={refresh} />
      {showNotes && (
        <Suspense fallback={null}><HomeNotes ready onOpenNote={onOpenNote} styles={styles} /></Suspense>
      )}
      <MoreBoxes onOpenNote={onOpenNote} />
    </div>
  )
}
