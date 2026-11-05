// Audit 2026-11-05, spec S15 (mockup M1) and S18: the Today home -- the reason to open the Notebook every morning.
//
// ⛔⛔ ONE REQUEST. Everything here is `GET /api/j2/notes/today` (api/services/journal_two/notebook_today.py): today's
// note (made from the member's daily template the first time today), the setups near entry, the member's names,
// what is open from yesterday, on this day, the market line and the ET session. The cards never fetch on mount (the
// auth gate serialises every lazy read behind it); a card's own ask (adding names, writing the recap) runs only when
// the member presses it.
//
// The page is a lazy view (tabs/NotebookTab.jsx `lazyView`): its bytes are not on the Notebook's first open.
//
// ⛔ NOTHING SHIFTS. While the read is in flight every card is drawn as a skeleton of the SAME card, in the same order
// and at the same reserved height (TodayHome.module.css), so the answer fills boxes that are already there.
//
// ⛔ NEVER EMPTY. Each card has a teaching empty state: no names asks for them (S17's EmptyNamesAsk, M7's sentence),
// no setups asks for the first plan (FirstPlanAsk), and the others say what would fill them.
//
// The cards' ORDER follows the ET session (`cardOrder`): the plan first before the open, the setups and names during
// the session, and after the close the recap first (S18, from 16:05 ET on a session day).
import { useContext, useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import useSWR from 'swr'
import { AuthContext } from '../../../../context/AuthContext'
import usePreferences from '../../../../hooks/usePreferences'
import useJ2SelectedAccount from '../../hooks/useJ2SelectedAccount'
import LoadFailed from '../LoadFailed'
import EmptyNamesAsk from './EmptyNamesAsk'
import FirstPlanAsk from './FirstPlanAsk'
import { FirstRunInlineSlot } from './FirstRunGate'
import { importWithOneRetry } from '../../lib/lazyChunk'
import { DAILY_FOLDER_NOTICE, DAILY_TEMPLATE_MISSING } from '../../lib/dailyNote'
import { reviewDraftsEnabled } from '../../lib/reviewDraftsFlag'
import { invalidateNoteViews } from '../../lib/offline/invalidateNoteViews'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'
import { SETUPS_BOARD_PATH } from '../../lib/setupsBoardLink'
import { LANDINGS, LANDING_PREF, resolveLanding } from '../../lib/todayHome'
import styles from './TodayHome.module.css'

export const TODAY_URL = '/api/j2/notes/today'

/** S18's button, verbatim. */
export const RECAP_ACTION = "Write today's recap (about 1 minute)"
export const RECAP_WRITTEN = "Today's recap is in today's note."

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
        <h2 id={`${uid}-t`} className={styles.cardTitle}>{title}</h2>
        {aside != null && <span className={styles.cardAside}>{aside}</span>}
      </div>
      {children}
    </section>
  )
}

function Unavailable({ reason }) {
  if (reason === 'paid_plan') return <p className={styles.quiet}>The setups board comes with a paid plan.</p>
  return <p className={styles.quiet}>This could not be read just now. Try again in a minute.</p>
}

function PlanCard({ note, reason, onOpenNote }) {
  if (!note) return <Card id="plan" title="Today's plan" wide><Unavailable reason={reason} /></Card>
  const aside = note.templateName ? `Started from “${note.templateName}”` : null
  const open = () => onOpenNote?.({ id: note.id, title: note.title })
  return (
    <Card id="plan" title="Today's plan" aside={aside} wide testId="today-plan">
      {note.created && !note.templateMissing && <p className={styles.notice} role="status">{DAILY_FOLDER_NOTICE}</p>}
      {note.templateMissing && <p className={styles.notice} role="status">{DAILY_TEMPLATE_MISSING}</p>}
      {note.items?.length ? (
        <ul className={styles.checks} aria-label="Today's plan">
          {note.items.map((it) => (
            <li key={it.index} className={styles.check}>
              <span className={`${styles.box} ${it.checked ? styles.boxDone : ''}`} aria-hidden="true" />
              <span className={it.checked ? styles.doneText : ''}>{it.text}</span>
              <span className="sr-only">{it.checked ? ' (done)' : ' (open)'}</span>
            </li>
          ))}
        </ul>
      ) : note.snippet ? (
        <p className={styles.snippet}>{note.snippet}</p>
      ) : (
        <p className={styles.quiet}>
          Nothing on today’s plan yet. Add a checklist line to today’s note; Today shows what is still open, and
          anything you don’t tick comes back tomorrow.
        </p>
      )}
      <div className={styles.cardFoot}>
        <button type="button" className={styles.action} onClick={open}>Open today’s note →</button>
      </div>
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

function SetupsCard({ setups, reason, onOpenNote }) {
  if (!setups) return <Card id="setups" title="Setups near entry"><Unavailable reason={reason} /></Card>
  const rows = setups.rows || []
  return (
    <Card id="setups" title="Setups near entry" aside={rows.length ? 'closest first' : null} testId="today-setups">
      {rows.length === 0 ? <FirstPlanAsk /> : (
        <ul className={styles.list}>
          {rows.map((r) => (
            <li key={`${r.noteId}:${r.symbol}`}>
              <button type="button" className={styles.row} onClick={() => onOpenNote?.({ id: r.noteId })}
                aria-label={`${r.symbol}, ${r.noteTitle || 'plan'}${r.state === 'invalidated' ? ', below stop: review' : ''}`}>
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
  if (!names) return <Card id="names" title="Your names"><Unavailable reason={reason} /></Card>
  const rows = names.rows || []
  const empty = names.count === 0
  return (
    <Card id="names" title="Your names" testId="today-names"
      aside={empty ? null : (
        <button type="button" className="btn btn-ghost btn-sm" aria-expanded={adding} onClick={() => setAdding((v) => !v)}>
          {adding ? 'Done' : 'Add'}
        </button>
      )}>
      {empty || adding ? (
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

function YesterdayCard({ open, reason, onOpenNote }) {
  if (!open) return <Card id="yesterday" title="Open from yesterday"><Unavailable reason={reason} /></Card>
  const items = open.items || []
  return (
    <Card id="yesterday" title="Open from yesterday" aside={open.count ? String(open.count) : null} testId="today-yesterday">
      {items.length === 0 ? (
        <p className={styles.quiet}>
          Nothing left open. A checklist line you don’t tick today, or a task due today, shows here tomorrow.
        </p>
      ) : (
        <ul className={styles.list}>
          {items.map((it) => (
            <li key={`${it.noteId}:${it.index}`}>
              <button type="button" className={styles.row} onClick={() => onOpenNote?.({ id: it.noteId })}
                aria-label={`${it.text}, in ${it.noteTitle || 'a note'}${it.from === 'overdue' ? ', overdue' : ''}`}>
                <span className={styles.box} aria-hidden="true" />
                <span className={styles.rowMain}>{it.text}</span>
                <span className={`${styles.rowEnd} ${it.from === 'overdue' ? styles.dn : ''}`}>
                  {it.from === 'yesterday' ? '' : it.from === 'overdue' ? `due ${fmtShortDay(it.due).replace(/, \d{4}$/, '')}` : 'due today'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {open.more > 0 && <p className={styles.quiet}>{open.more} more in your tasks.</p>}
    </Card>
  )
}

function OnThisDayCard({ onThisDay, reason, onOpenNote }) {
  if (!onThisDay) return <Card id="onThisDay" title="On this day"><Unavailable reason={reason} /></Card>
  const items = onThisDay.items || []
  const first = items[0]
  const aside = first ? (first.yearsAgo === 1 ? '1 year ago' : `${first.yearsAgo} years ago`) : null
  return (
    <Card id="onThisDay" title="On this day" aside={aside} testId="today-on-this-day">
      {items.length === 0 ? (
        <p className={styles.quiet}>Nothing written on this date in earlier years yet. What you write today comes back here next year.</p>
      ) : (
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
      )}
    </Card>
  )
}

/** S18: after 16:05 ET, the existing review drafts written into today's note (never a new folder or note). */
function RecapCard({ note, onOpenNote, onNotice, onWritten }) {
  const { accountId } = useJ2SelectedAccount(true)
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

function LandingChoice() {
  const { prefs, setPref, loading } = usePreferences()
  const uid = useId()
  const value = resolveLanding(prefs?.[LANDING_PREF], { on: true })
  return (
    <div className={styles.landing}>
      <label htmlFor={`${uid}-landing`}>Open the Notebook on</label>
      <select id={`${uid}-landing`} className={styles.select} value={value} disabled={loading}
        onChange={(e) => setPref(LANDING_PREF, e.target.value)}>
        {LANDINGS.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
      </select>
    </div>
  )
}

// ── the page ─────────────────────────────────────────────────────────────────────────────────

export default function TodayHome({ onOpenNote, onCreateNote, onSelectAllNotes, onOpenResearchHome, onNoteMade, onNotice }) {
  const auth = useContext(AuthContext)
  const { data, error, mutate } = useSWR(TODAY_URL, fetchToday, { revalidateOnFocus: false, shouldRetryOnError: false })
  const recapOn = reviewDraftsEnabled()
  const session = data?.session || clientSession()
  const order = cardOrder(session, { recapOn })
  const reasons = data?.reasons || {}

  // The day's note was MADE by this read: the tree and the counts are told (S6), once per note.
  const madeRef = useRef(null)
  useEffect(() => {
    const n = data?.todayNote
    if (n?.created && n.id && madeRef.current !== n.id) {
      madeRef.current = n.id
      onNoteMade?.({ id: n.id, title: n.title, updatedAt: n.updatedAt })
    }
  }, [data, onNoteMade])

  // S20 "Morning open rate": the Today home opened, once per mount.
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

  const card = (id) => {
    const wide = id === 'plan' || id === 'recap'
    if (!data) return <SkeletonCard key={id} id={id} wide={wide} />
    switch (id) {
      case 'plan': return <PlanCard key={id} note={data.todayNote} reason={reasons.todayNote} onOpenNote={onOpenNote} />
      case 'recap': return (
        <RecapCard key={id} note={data.todayNote} onOpenNote={onOpenNote} onNotice={onNotice} onWritten={refresh} />
      )
      case 'setups': return <SetupsCard key={id} setups={data.setups} reason={reasons.setups} onOpenNote={onOpenNote} />
      case 'names': return <NamesCard key={id} names={data.names} reason={reasons.names} onChanged={refresh} />
      case 'yesterday': return (
        <YesterdayCard key={id} open={data.openFromYesterday} reason={reasons.openFromYesterday} onOpenNote={onOpenNote} />
      )
      case 'onThisDay': return (
        <OnThisDayCard key={id} onThisDay={data.onThisDay} reason={reasons.onThisDay} onOpenNote={onOpenNote} />
      )
      default: return null
    }
  }

  return (
    <div className={styles.today} data-today-home="" aria-busy={!data && !error ? true : undefined}>
      <header className={styles.head}>
        <div className={styles.headText}>
          <h1 className={styles.hello}>{name ? `${greeting()}, ${name}` : greeting()}</h1>
          <p className={styles.sub} data-today-line="">{headerLine(data)}</p>
        </div>
        <div className={styles.headActions}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onSelectAllNotes?.()}>All notes</button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => onCreateNote?.()}>+ New note</button>
        </div>
      </header>
      <FirstRunInlineSlot onOpenNote={onOpenNote} onOpenToday={refresh} />
      {error && <LoadFailed compact what="Today" error={error} onRetry={refresh} />}
      {!error && <div className={styles.grid}>{order.map(card)}</div>}
      <footer className={styles.foot}>
        <LandingChoice />
        {onOpenResearchHome && (
          <button type="button" className={styles.link} onClick={onOpenResearchHome}>Research home →</button>
        )}
      </footer>
    </div>
  )
}
