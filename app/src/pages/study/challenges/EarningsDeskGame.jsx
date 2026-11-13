// EARNINGS DESK (docs/study/GAMES.md §3, kind 'earnings'; built on the contract in §1). Real quarters from real companies:
// the approved items of course unit F5.08 (POST /api/study/sessions {kind: 'skill', skill_id: 'fund.earnings_desk', size: 8}).
// Each one lands on the desk as a report, "Report 1" to "Report 8", easiest first: beat, miss or in line first, then the
// surprise in percent, then reading the whole report (the guide, the key number, what the stock did). Three hearts.
//
// THE PLAY is Hard mode's (one design, rule 21): the status line with the hearts beside it, the report card as the hero
// where a chart would stand (the masthead reads the company and the quarter off the front of the bank's own question, the
// report's lines under it, then the question, or a fill sentence with its gold blank), then the question header and the
// answer tiles, dealt in a seeded order. A number report is typed into one field. Check posts the answer to
// POST /api/study/attempts, which scores it against a key the browser never sees and grants the XP, so this game never
// posts a game run. The verdict takes over the screen (rule 15): the answer and, on a miss, why the call was wrong in the
// bank's own words (the note for that very pick, or the working for a computed answer), what the stock did, and the hearts
// left. "Read the desk note" then lays the note under the answers: your call and why it was not it, why, what the stock
// did, the working, the lesson line, and the sources the report rests on with their quotes. Every number on the screen is
// the server's or games/earnings.js's; every sentence about a quarter is the reveal's own, word for word (rule 6).
// An answer the server did not score is not a miss: the pick stays and Check sends it again.
//
// THE END (EndHard): the calls made right and a desk's rank, the XP the attempts earned on the level bar, the kind of
// report to work on next, and the run log, one report a row with its masthead, its question, the answer, what was said,
// what the stock did, the lesson line and the source. Fewer than three usable reports: an honest empty state with a way
// back. The best run lives on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudCombo } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import VerdictTakeover from '../ui/VerdictTakeover'
import Prompt from '../ui/Prompt'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import { Confetti } from '../ui/Stage'
import s from '../ui/study.module.css'
import sa from '../ui/answerLooks.module.css'
import g from './EarningsDeskGame.module.css'
import ChallengeError, { isSignedOut } from './ChallengeError'
import { beginRunXp, runXp, scoreAttempt } from './challengeBank'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { SESSIONS_URL, studyFetch } from '../useStudySession'
import {
  EARNINGS_ATTEMPT_TIMEOUT_MS, EARNINGS_BEST_KEY, EARNINGS_HEARTS, EARNINGS_KIND, EARNINGS_MIN, EARNINGS_POOL_TIMEOUT_MS, EARNINGS_TOTAL,
  EMPTY_LINE, FAILED_LINE, NUMBER_HINT, SIGNED_OUT_LINE, addCase, answerFor, bestLine, cardText, dealChoices, deckOf, deskLine, detailOf,
  heartsLeft, heartsLine, kindWord, lessonLineOf, nearNote, parseNumber, pickNote, rankOf, reportsOf, rightIndex, rowOf, runOver, saidOf,
  sessionBody, solvedOf, sourcesOf, splitWhy, stockLine, teachOf, thinLine, truthOf, typedNumber, verdictOf, weakLine, weakestOf, workingOf, xpOf,
} from './games/earnings'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: EARNINGS_KIND, title: 'Earnings Desk', sub: 'Real quarters against the estimates. Beat, miss or in line, the surprise in percent, then what the stock did next. Three hearts.', icon: 'earnings', plate: 'Desk', accent: 'gold', group: 'skill' }

const NONE = []
const EMPTY_TALLY = { results: [], log: [], xp: 0 }
const LEAD = 'Real quarters from real companies, as they landed on the desk. Put the numbers against the estimates, make the call, then see what the stock did and why.'
const readBest = () => { try { return Number(localStorage.getItem(EARNINGS_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(EARNINGS_BEST_KEY, String(v)) } catch { /* no storage */ } }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const streakOf = (results) => { let n = 0; for (let k = results.length - 1; k >= 0 && results[k] === true; k--) n += 1; return n }
const bringIntoView = (el) => { try { el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) } catch { /* an old engine without options */ } }
/** The product passes no sign-in of its own (only the workbench does): sign in in a new tab, so this run and its pick
 *  stay put and Check works again once the session is back. */
const openSignIn = () => {
  try { window.open(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`, '_blank', 'noopener') } catch { /* no window */ }
}

/** The hearts, in the kit's look (the shield History Detective, Order Ticket and Options Payoff wear): gold while one
 *  stands, dim once lost. */
function Hearts({ left, total = EARNINGS_HEARTS }) {
  return (
    <span className={g.hearts} role="img" aria-label={heartsLine(left)} data-testid="earnings-hearts" data-left={left}>
      {Array.from({ length: total }, (_, k) => (
        <i key={k} className={`${g.heart} ${k < left ? g.heartOn : g.lost}`}><UIcon name="shield" size={20} gold={false} /></i>
      ))}
    </span>
  )
}

/** A fill sentence with its blank as a gold slot that takes the picked word (green or red once checked). */
function Blank({ sentence, word, tone }) {
  const parts = String(sentence || '').split('___')
  return (
    <>
      {parts.map((part, i) => (
        <span key={i}>
          {part}
          {i < parts.length - 1 ? (
            <span className={`${g.slot} ${word ? g.slotOn : ''} ${tone === 'ok' ? g.slotOk : tone === 'bad' ? g.slotBad : ''}`} data-testid="earnings-blank"
              data-tone={tone || undefined} aria-label={word ? `blank: ${word}` : 'blank'}>{word || ' '}</span>
          ) : null}
        </span>
      ))}
    </>
  )
}

/** The report card, the hero where a chart would stand: the masthead (the company and the quarter, read off the bank's
 *  own words), the report's lines, then the question, or a fill sentence with its blank. */
function ReportCard({ c, n, words, blankWord, blankTone, checking }) {
  const desk = c.company
  return (
    <figure className={g.report} data-testid="earnings-report" aria-busy={checking || undefined}>
      <span className={g.tab}>Report {n}</span>
      <span className={g.mark} aria-hidden="true"><UIcon name="earnings" size={28} gold={false} /></span>
      {desk ? (
        <header className={g.mast} data-testid="earnings-mast">
          <b className={g.company}>{c.company}</b>
          {c.period ? <span className={g.period}><UIcon name="calendar" size={13} gold={false} />{c.period}</span> : null}
        </header>
      ) : null}
      {words.story ? <p className={g.lines} data-testid="earnings-story">{words.story}</p> : null}
      {c.kind === 'fill'
        ? <p className={g.big} data-testid="earnings-sentence"><Blank sentence={c.sentence} word={blankWord} tone={blankTone} /></p>
        : words.big ? <p className={g.big} data-testid="earnings-question">{words.big}</p> : null}
      <figcaption className={g.foot}><span>{kindWord(c)}</span>{checking ? <em>Checking</em> : null}</figcaption>
    </figure>
  )
}

/** A number report's answer area: the kit's question header and foot bar (answerLooks.module.css) around one field. */
function NumberAnswer({ c, typed, onType, state, busy, truth, onCheck, onNext, nextLabel, head, eyebrow, question, detail, hotkey, focusOnOpen = false, again = null }) {
  const asking = state === 'ask'
  const value = parseNumber(typed)
  const unreadable = asking && typed.trim() !== '' && value == null
  const field = useRef(null)
  // keyboard play: on a desktop the field takes the keys as the report opens, and again after an answer the server did
  // not score (`again`, the note), so the member can fix it or press Enter to resend. A phone keeps its keyboard down.
  useEffect(() => {
    if (!focusOnOpen) return
    try { field.current?.focus({ preventScroll: true }) } catch { /* an old engine without options */ }
  }, [focusOnOpen, again])
  // Enter sends the answer and the field lets go of the keys first: a field that is disabled while it holds the focus
  // keeps it in some engines, and a key press inside a field never presses a Study button, so Enter would never reach
  // the verdict's button or Next
  const onKeyDown = (e) => {
    if (e.key !== 'Enter' || e.repeat) return
    e.preventDefault()
    if (value != null) e.currentTarget.blur()
    onCheck()
  }
  return (
    <div className={`${sa.area} ${sa.lesson}`}>
      {!asking && head ? head : (
        <div className={sa.lHead}>
          <span className={sa.lEyebrow}>{eyebrow}</span>
          <h2 className={sa.lQ}>{question}</h2>
          {detail ? <p className={sa.lDetail}>{detail}</p> : null}
        </div>
      )}
      <label className={`${g.num} ${asking ? '' : state === 'ok' ? g.numOk : g.numBad}`}>
        <span className={g.numLabel}>{c.label || 'Your answer'}</span>
        <span className={g.numWrap}>
          {c.prefix ? <span className={g.affix} aria-hidden="true">{c.prefix}</span> : null}
          <input ref={field} className={g.numInput} type="text" inputMode="decimal" autoComplete="off" spellCheck={false} disabled={!asking || busy}
            value={typed} onChange={(e) => onType(typedNumber(e.target.value))}
            onKeyDown={onKeyDown}
            aria-label={c.label || 'Your answer'} aria-invalid={unreadable || undefined} data-testid="earnings-number" />
          {c.suffix ? <span className={g.affix} aria-hidden="true">{c.suffix}</span> : null}
        </span>
        {unreadable ? <span className={g.numHint} data-testid="earnings-number-hint">{NUMBER_HINT}</span> : null}
        {state === 'bad' && truth ? <span className={g.numTruth} data-testid="earnings-number-truth">The answer <b>{truth}</b></span> : null}
      </label>
      <div className={`${sa.lFoot} ${state === 'ok' ? sa.footOk : state === 'bad' ? sa.footBad : ''}`}>
        {asking
          ? <StudyButton kind="primary" size="xl" arrow wide hotkey={hotkey ? 'Enter' : null} busy={busy} disabled={value == null} onClick={onCheck} testId="earnings-check">{busy ? 'Checking' : 'Check'}</StudyButton>
          : <StudyButton kind={state === 'ok' ? 'good' : 'bad'} size="xl" arrow wide hotkey={hotkey ? 'Enter' : null} onClick={onNext} testId="earnings-next">{nextLabel}</StudyButton>}
      </div>
    </div>
  )
}

/** The desk note, after the answer: your call and why it was not it, why, what the stock did, the working, the lesson
 *  line and the sources with their quotes. Every word is the reveal's; every number the server's or the module's. */
function DeskNote({ n, desk, ok, truth, said, mine, near, print, stock, working, line, sources, boxRef }) {
  const quotes = sources.flatMap((src) => src.quotes.map((q) => ({ q, src })))
  return (
    <section className={s.coach} ref={boxRef} data-testid="earnings-note" aria-label="The desk note">
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>Report {n} · the desk note{desk ? ` · ${desk}` : ''}</span>
          <h3 className={s.coachTitle} data-testid="earnings-note-answer">{truth || 'The answer'}</h3>
        </div>
        <span className={`${g.verdict} ${ok ? g.verdictOk : g.verdictBad}`}><UIcon name={ok ? 'check' : 'x'} size={14} gold={false} />{ok ? 'Called right' : 'Missed'}</span>
      </header>
      {!ok && said ? (
        <div className={s.coachBlock} data-testid="earnings-call">
          <span className={s.coachLabel}>Your call</span>
          <p className={s.rule}><b className={g.said}>{said}</b>{near || mine ? <>. {near || mine}</> : null}</p>
        </div>
      ) : null}
      {print.length ? (
        <div className={s.coachBlock} data-testid="earnings-why">
          <span className={s.coachLabel}>Why</span>
          <p className={s.lead}>{print.join(' ')}</p>
        </div>
      ) : null}
      {stock.length ? (
        <div className={s.coachBlock} data-testid="earnings-stock">
          <span className={s.coachLabel}>What the stock did</span>
          <p className={g.reaction}><UIcon name="chart" size={18} gold={false} /><span>{stock.join(' ')}</span></p>
        </div>
      ) : null}
      {working ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>The working</span>
          <p className={g.formula} data-testid="earnings-working">
            <span>{working.formula}</span>
            <span>= {working.filled} = <b>{working.result}</b></span>
          </p>
        </div>
      ) : null}
      {line ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>The lesson</span>
          <p className={g.line} data-testid="earnings-line">{line}</p>
        </div>
      ) : null}
      {sources.length ? (
        <div className={s.coachBlock} data-testid="earnings-sources">
          <span className={s.coachLabel}>{sources.length === 1 ? 'The source' : 'The sources'}</span>
          <ul className={g.sources}>
            {sources.map((src) => (
              <li key={src.full}>
                <UIcon name="book" size={13} gold={false} />
                {src.url ? <a href={src.url} target="_blank" rel="noopener noreferrer" title={src.full}>{src.name}</a> : <span title={src.full}>{src.name}</span>}
              </li>
            ))}
          </ul>
          {quotes.length ? (
            <details className={g.evidence} data-testid="earnings-evidence">
              <summary><UIcon name="quote" size={13} gold={false} />Read the filings and the reports</summary>
              <ul className={g.quotes}>
                {quotes.map(({ q, src }, k) => <li key={k}><q>{q}</q><small>{src.name}</small></li>)}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}

/** One report: asked, checked on the server, then read. */
function Report({ c, idx, total, results, seed, prefs, fetcher, signedOut, onDone }) {
  const phone = useIsPhone()
  const choices = useMemo(() => dealChoices(c, seed), [c, seed])
  const words = useMemo(() => cardText(c), [c])
  const [pick, setPick] = useState(null)
  const [typed, setTyped] = useState('')
  const [state, setState] = useState('ask')        // ask | ok | bad
  const [takeover, setTakeover] = useState(false)  // the verdict holds the whole screen until the member opens the desk note
  const [busy, setBusy] = useState(false)          // the answer is on the wire: Check reads Checking and a second press posts nothing
  const [note, setNote] = useState(null)           // an answer the server did not score: { line, out }
  const [reveal, setReveal] = useState(null)
  const [xp, setXp] = useState(0)
  const top = useRef(null)
  const noteBox = useRef(null)
  const shownAt = useRef(0)
  const live = useRef(true)
  const timers = useRef(null)
  useEffect(() => {
    live.current = true
    shownAt.current = performance.now()
    if (!timers.current) timers.current = new Set()
    const pending = timers.current
    // each report opens at its top, the status line and the card in view (Check and Next sit low on the screen)
    const el = top.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' })
    return () => { live.current = false; pending.forEach((t) => clearTimeout(t)); pending.clear() }
  }, [])

  const asking = state === 'ask'
  const ok = state === 'ok'
  const said = saidOf(c, { pick, text: typed, choices })
  const truth = asking ? null : truthOf(c, reveal, { said, correct: ok, choices })
  const right = truth == null ? -1 : rightIndex(choices, truth)
  const after = asking ? results : [...results, ok]
  const left = heartsLeft(after)
  const over = !asking && runOver(after, total)
  const working = useMemo(() => (reveal ? workingOf(reveal, c) : null), [reveal, c])
  const sources = useMemo(() => (reveal ? sourcesOf(reveal) : NONE), [reveal])
  const { print, stock } = useMemo(() => (reveal ? splitWhy(reveal, truth) : { print: NONE, stock: NONE }), [reveal, truth])
  const mine = !asking && !ok && reveal ? pickNote(reveal, said) : ''
  const near = !asking && !ok && reveal ? nearNote(c, typed, reveal) : ''
  const line = reveal ? lessonLineOf(reveal) : ''
  const desk = deskLine(c)

  /** A promise that gives up after `ms`, its timer cleared on unmount. */
  const within = useCallback((p, ms) => new Promise((resolve, reject) => {
    const set = timers.current || (timers.current = new Set())
    const t = setTimeout(() => { set.delete(t); const e = new Error('The answer took too long to check.'); e.timeout = true; reject(e) }, ms)
    set.add(t)
    Promise.resolve(p).then((v) => { clearTimeout(t); set.delete(t); resolve(v) }, (e) => { clearTimeout(t); set.delete(t); reject(e) })
  }), [])

  const check = async () => {
    const answer = answerFor(c, { pick, text: typed, choices })
    if (state !== 'ask' || busy || !answer) return
    setBusy(true); setNote(null)
    let attempt = null
    let err = null
    try {
      attempt = await within(scoreAttempt({ id: c.id, sessionId: c.sessionId }, answer, performance.now() - shownAt.current, fetcher), EARNINGS_ATTEMPT_TIMEOUT_MS)
      // a reply with no verdict is not a score: read as a miss, it would cost a heart for nothing
      if (verdictOf(attempt) == null) throw new Error('The answer came back without a verdict.')
    } catch (e) { err = e || new Error('The answer was not checked.') }
    if (!live.current) return
    setBusy(false)
    if (err) { const out = isSignedOut(err); setNote({ line: out ? SIGNED_OUT_LINE : FAILED_LINE, out }); return }
    const good = verdictOf(attempt)
    setReveal(attempt.reveal || {}); setXp(xpOf(attempt)); setState(good ? 'ok' : 'bad'); setTakeover(true)
    revealFeedback(good, prefs)
    if (good) comboFeedback(streakOf(results) + 1, prefs)
  }

  // the number keys pick a tile; Enter is the action button's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    if (state !== 'ask' || busy || c.kind === 'numeric') return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const k = Number(e.key) - 1
      if (Number.isInteger(k) && k >= 0 && k < choices.length) { setPick(k); tapFeedback(prefs) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, busy, c.kind, choices.length, prefs])

  const openNote = () => { setTakeover(false); bringIntoView(noteBox.current) }
  // a report reports itself once: a second press (a double tap, Enter and a click together) never skips the next report
  const sent = useRef(false)
  const next = () => { if (sent.current) return; sent.current = true; onDone(rowOf(c, { ok, said, truth, reveal, xp })) }
  const headline = ok ? 'Called it.' : 'Not this one.'
  const nextLabel = over ? 'See the log' : 'Next report'
  // the takeover teaches in a line or two (it cannot scroll): the near thing a number missed by, the note for the pick,
  // the working, or why; then what the stock did, when it fits
  const teach = teachOf({ near, mine, working, print })
  const stockOne = stockLine(stock)
  const eyebrow = <>Report {idx + 1} of {total} · {kindWord(c)}{desk ? ` · ${desk}` : ''}</>
  const detail = detailOf(c, phone) || null
  const head = asking ? null : (
    <Prompt mood={ok ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={headline}
      sub={ok ? <><b>{truth || said}</b>{xp > 0 ? ` · +${xp} XP` : ''}</> : <>You said <b>{said || 'nothing'}</b> · {heartsLine(left)}</>}
      seal={<Stamp ok={ok} word={ok ? 'Right' : null} inline />} />
  )
  // the blank takes the picked word; once checked it reads the answer in green (the member's word in red only when the
  // server did not say what the answer was), so the finished sentence on screen is always the true one
  const blankWord = asking ? (pick == null ? null : choices[pick]) : (truth || said)
  const blankTone = asking ? null : truth ? 'ok' : 'bad'

  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="earnings-play" data-state={busy ? 'checking' : state} data-kind={c.kind} ref={top}>
      {!asking ? <span className={`${s.flash} ${ok ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {!asking && takeover ? (
        <VerdictTakeover ok={ok} title={headline} answer={truth} xp={xp} stampWord={ok ? 'Right' : null} label="Read the desk note"
          onContinue={openNote} testId="earnings-takeover"
          sub={(
            <>
              {ok
                ? (line ? <span className={g.tkLine} data-testid="earnings-takeover-line">{line}</span> : null)
                : (teach ? <span className={g.tkLine} data-testid="earnings-takeover-why">{teach}</span> : null)}
              {stockOne ? <span className={g.tkStock} data-testid="earnings-takeover-stock"><UIcon name="chart" size={15} gold={false} />{stockOne}</span> : null}
              {ok ? null : <span className={g.tkHearts} data-testid="earnings-takeover-hearts">{heartsLine(left)}</span>}
            </>
          )} />
      ) : null}
      <div className={g.hudRow}>
        <HudCombo label="Desk" step={idx} total={total} results={after} live={asking} stepTestId="earnings-step" unit="report" scoreWord="right" />
        <Hearts left={left} />
      </div>
      <ReportCard c={c} n={idx + 1} words={words} blankWord={blankWord} blankTone={blankTone} checking={busy} />
      {c.kind === 'numeric' ? (
        <NumberAnswer c={c} typed={typed} onType={setTyped} state={state} busy={busy} truth={truth} onCheck={check} onNext={next} nextLabel={nextLabel}
          head={head} eyebrow={eyebrow} question={words.question} detail={detail} hotkey={!takeover} focusOnOpen={!phone} again={note} />
      ) : (
        <AnswerLessonApp choices={choices} pick={pick} state={state} answer={right >= 0 ? choices[right] : null} step={idx} total={total} busy={busy} hotkey={!takeover}
          onPick={(k) => { if (asking && !busy) { setPick(k); tapFeedback(prefs) } }} onCheck={check} onNext={next} nextLabel={nextLabel}
          head={head} eyebrow={eyebrow} question={words.question} detail={detail}
          cardsTestId="earnings-cards" checkTestId="earnings-check" nextTestId="earnings-next" />
      )}
      {note ? <p className={g.note} role="status" data-testid="earnings-note-line">{note.line}</p> : null}
      {note?.out ? (
        <div className={g.signIn}>
          {signedOut || <StudyButton kind="secondary" onClick={openSignIn} testId="earnings-sign-in">Sign in (opens a new tab)</StudyButton>}
        </div>
      ) : null}
      {!asking ? (
        <DeskNote n={idx + 1} desk={desk} ok={ok} truth={truth} said={said} mine={mine} near={near} print={print} stock={stock} working={working} line={line} sources={sources} boxRef={noteBox} />
      ) : null}
    </div>
  )
}

/** One report in the run log, under its masthead: the question, the answer on a right call (a missed one carries "you
 *  said ..., it was ..." from the end screen itself, moved up by the stylesheet), what the stock did, the lesson line and
 *  the source. So the log reads as a review sheet: every quarter with its call. */
function LogLine({ row }) {
  return (
    <span className={g.logLine}>
      {row.ask ? <span className={g.logAsk} data-testid="earnings-log-ask">{row.ask}</span> : null}
      {row.ok && row.truth ? <span className={g.logAnswer} data-testid="earnings-log-answer"><UIcon name="check" size={13} gold={false} />{row.truth}</span> : null}
      {row.stock ? <span className={g.logStock} data-testid="earnings-log-stock"><UIcon name="chart" size={13} gold={false} />{row.stock}</span> : null}
      {row.line ? <span className={g.logLesson} data-testid="earnings-log-line">{row.line}</span> : null}
      {row.source ? (
        <span className={g.logSrc}>
          <UIcon name="book" size={13} gold={false} />
          {row.source.url ? <a href={row.source.url} target="_blank" rel="noopener noreferrer" title={row.source.full}>{row.source.name}</a> : <span title={row.source.full}>{row.source.name}</span>}
        </span>
      ) : null}
    </span>
  )
}

export default function EarningsDeskGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')   // start | play | done
  const [pool, setPool] = useState(null)         // the usable reports; null while the draw loads
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [run, setRun] = useState(null)           // { id, seed, deck }: the reports and the seed their tiles are dealt from
  const [i, setI] = useState(0)
  const [tally, setTally] = useState(EMPTY_TALLY)
  const [best, setBest] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0)

  // the draw: a fresh session each time the start screen opens; one that never answers fails honestly, never spins
  useEffect(() => {
    let on = true
    const t = setTimeout(() => {
      if (!on) return
      on = false
      setError(new Error('The reports took too long to load.')); setPool([])
    }, EARNINGS_POOL_TIMEOUT_MS)
    Promise.resolve()
      .then(() => fetcher(SESSIONS_URL, { method: 'POST', body: sessionBody() }))
      .then((res) => { if (!on) return; on = false; clearTimeout(t); setPool(reportsOf(res)) })
      .catch((e) => { if (!on) return; on = false; clearTimeout(t); setError(e || new Error('The reports did not load.')); setPool([]) })
    return () => { on = false; clearTimeout(t) }
  }, [reload, fetcher])

  const deck = useMemo(() => (pool ? deckOf(pool) : NONE), [pool])
  const ready = deck.length >= EARNINGS_MIN
  const start = useCallback(() => {
    if (!ready) return
    const seed = Date.now()   // seeded once; the pure module deals every report's tiles from it
    beginRunXp()
    setRun({ id: `earnings-${seed}`, seed, deck })
    setI(0); setTally(EMPTY_TALLY); setBestBefore(readBest()); setPhase('play')
  }, [ready, deck])
  const again = () => { setPool(null); setError(null); setRun(null); setReload((r) => r + 1); setPhase('start') }
  const retry = () => { setPool(null); setError(null); setReload((r) => r + 1) }
  const back = onClose ? <StudyButton kind="ghost" onClick={onClose} testId="earnings-back">Back to Study</StudyButton> : null

  const next = (row) => {
    const t = addCase(tally, row)
    setTally(t)
    if (!runOver(t.results, run.deck.length)) { setI((v) => v + 1); return }
    setPhase('done'); endFeedback(prefs)
    const right = solvedOf(t.results)
    if (right > readBest()) { writeBest(right); setBest(right) }
  }

  if (error) {
    return (
      <div className={`${s.kit} ${g.failed}`} data-testid="earnings-failed">
        <ChallengeError what="the Earnings Desk reports" error={error} signedOut={signedOut} onRetry={retry} />
        {back}
      </div>
    )
  }

  if (phase === 'start') {
    const empty = !!pool && !ready
    const thin = empty && deck.length > 0   // a report or two, too few for a run: said as it is
    // the stakes name the run as it will deal: this draw's reports once they are in, the game's own eight until then
    const count = ready ? deck.length : EARNINGS_TOTAL
    return (
      <div className={s.kit}>
        <StartArena plate={GAME.plate} title={GAME.title} caption="Beat, miss or in line?" testId={empty ? 'earnings-empty' : 'earnings-intro'} startTestId="earnings-start" hotkey
          total={count} ready={ready} onStart={start}
          stakes={[{ v: count, l: 'reports', icon: 'earnings' }, { v: EARNINGS_HEARTS, l: 'hearts', icon: 'shield' }, { v: 1, l: 'try each', icon: 'check' }]}
          label={ready ? 'Open the desk' : pool == null ? 'Pulling the reports' : thin ? 'Not enough reports yet' : 'No reports yet'}
          lead={empty ? <span data-testid="earnings-empty-line">{thin ? thinLine(deck.length) : EMPTY_LINE}</span> : LEAD}
          reward={empty ? null : undefined}
          howTo={empty ? null : <HowItPlays mode="earnings" testId="earnings-howto" steps={[
            { icon: 'earnings', title: 'Read the report', body: 'A real quarter from a real company: its own numbers against what analysts expected, as the desk saw them that day.' },
            { icon: 'check', title: 'Make the call', body: 'Beat, miss or in line, or work the surprise in percent. Number keys pick, Enter checks. One try each.' },
            { icon: 'shield', title: 'Three hearts', body: 'A miss costs a heart. Every answer opens the desk note: why, what the stock did next, and the filings and reports it rests on.' },
          ]} />}>
          {empty ? back : (
            <span data-testid="earnings-pool-line">
              {pool == null ? 'Pulling the reports' : `${plural(deck.length, 'report', 'reports')} on the desk`}
              {best > 0 ? <> · your best run <b data-testid="earnings-best">{best}</b> right</> : null}
            </span>
          )}
        </StartArena>
      </div>
    )
  }

  if (phase === 'done') {
    const { results, log, xp } = tally
    const right = solvedOf(results)
    const played = results.length
    const full = played === (run?.deck.length || 0)
    const perfect = full && played > 0 && right === played
    // the hearts cut the run short (a third miss on the last report still finished every report: that run earns its rank)
    const cut = heartsLeft(results) === 0 && !full
    const bl = bestLine(right, bestBefore)
    const weak = weakLine(weakestOf(log))
    const rows = log.map((r) => ({ name: r.name, ticker: <LogLine row={r} />, ok: r.ok, said: r.ok ? null : r.said, was: r.ok ? '' : r.truth }))
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s.kit} ${g.end}`}>
          <EndHard right={right} total={played} xp={xp} results={results} log={rows} level={runXp()} unit="reports called right" doneWord="right"
            showSetups={false} medal={full} testIdPrefix="earnings" title={cut ? 'Out of hearts' : rankOf(right, played)}
            againLabel="Open new reports" onAgain={again} onBack={onClose}>
            <span className={g.endNote} data-testid="earnings-end-line">
              {perfect
                ? <><b>Every call right.</b> The numbers, the surprise and the rest of the report, read right each time.</>
                : cut
                  ? <>The hearts ran out on report <b>{played}</b> of {run?.deck.length}. Each report below keeps its answer, what the stock did, its lesson and its source.</>
                  : <>Each report below keeps its answer, what the stock did, its lesson and its source.</>}
            </span>
            {weak ? <span className={g.endNote} data-testid="earnings-weak-line">{weak}</span> : null}
            {bl ? (
              <span className={g.endNote} data-testid="earnings-best-line">
                {bl.fresh ? <><b>A new best:</b> {bl.n} right.</> : <>Your best run stands at <b>{bl.n}</b> right.</>}
              </span>
            ) : null}
          </EndHard>
        </div>
      </>
    )
  }

  const c = run?.deck[i]
  if (!c) return null
  return (
    <Report key={`${run.id}-${i}`} c={c} idx={i} total={run.deck.length} results={tally.results} seed={run.seed} prefs={prefs}
      fetcher={fetcher} signedOut={signedOut} onDone={next} />
  )
}
