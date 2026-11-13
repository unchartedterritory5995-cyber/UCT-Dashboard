// HISTORY DETECTIVE (docs/study/GAMES.md §3, kind 'history'; built on the contract in §1). Case files from real falls in
// US stocks: the approved items of course unit F7.08 (POST /api/study/sessions {kind: 'skill', skill_id:
// 'history.detective', size: 8}), recall and scenario questions, many with a real index chart under them whose ticker
// stays hidden until the answer. Each one is a case, "Case 1" to "Case 8", easiest first; three hearts.
//
// THE PLAY is Hard mode's (one design, rule 21): the status line with the hearts beside it, the chart as the hero (the
// member's own chart widget, the last day ringed) or, for a case with no chart, the case card in its place (the story, the
// question, or a fill sentence with its gold blank), then the question header and the answer tiles, dealt in a seeded
// order (the bank lists the answer first more often than not). A number case is typed into one field. Check posts the
// answer to POST /api/study/attempts, which scores it against a key the browser never sees and grants the XP, so this
// game never posts a game run. The verdict takes over the screen (rule 15): the answer and, on a miss, why the pick was
// wrong in the bank's own words, or the working for a computed answer, and the hearts left. "Open the case file" then
// runs the chart on into what came next (the reveal's forward bars) and lays the case file under the answers: the ticker
// and the chart's last day, why, the working, the lesson line, and the sources the case rests on with their quotes.
// An answer the server did not score is not a miss: the pick stays and Check sends it again.
//
// THE END (EndHard): the cases solved and a detective's rank, the XP the attempts earned on the level bar, and the run
// log, one case a row with its answer, what was said, the chart's ticker and day, the lesson line and the source. Every
// number is games/history.js's or the server's. Fewer than three usable cases: an honest empty state with a way back.
// The best run lives on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { useRunOnTo } from '../../../lab/fx'   // pure motion (bars running on); no styling rides in
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
import StudyChart from '../ui/StudyChart'
import { Confetti } from '../ui/Stage'
import { calloutLook, hardCallouts } from '../ui/callout'
import s from '../ui/study.module.css'
import sa from '../ui/answerLooks.module.css'
import g from './HistoryDetectiveGame.module.css'
import ChallengeError, { isSignedOut } from './ChallengeError'
import { beginRunXp, fetchForwardRest, runXp, scoreAttempt } from './challengeBank'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { SESSIONS_URL, normalizeBars, studyFetch } from '../useStudySession'
import {
  EMPTY_LINE, FAILED_LINE, HISTORY_ATTEMPT_TIMEOUT_MS, HISTORY_BEST_KEY, HISTORY_HEARTS, HISTORY_KIND, HISTORY_MIN, HISTORY_POOL_TIMEOUT_MS,
  HISTORY_REST_CALLS, HISTORY_TOTAL, NUMBER_HINT, SIGNED_OUT_LINE, addCase, answerFor, bestLine, caseText, casesOf, chartFactsOf, dealChoices,
  deckOf, detailOf, heartsLeft, heartsLine, kindWord, lessonLineOf, parseNumber, pickNote, rankOf, reasonOf, rightIndex, rowOf, runOver, saidOf,
  sessionBody, shortDate, solvedOf, sourcesOf, thinLine, truthOf, typedNumber, verdictOf, workingOf, xpOf,
} from './games/history'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: HISTORY_KIND, title: 'History Detective', sub: 'Case files from real market falls. Read the chart and the clues, then solve each case. Three hearts.', icon: 'search', plate: 'Detective', accent: 'red', group: 'chart' }

const NONE = []
const EMPTY_TALLY = { results: [], log: [], xp: 0 }
/** The aftermath runs on calmly at first, then briskly: a fall's forward strip can be 120 sessions. */
const RUN_ON = { slowN: 3, slowMs: 260, fastMs: 45 }
const LEAD = 'Real falls in US stocks, as case files. Every big fall has a depth, a length, a cause and an aftermath. Read the clues, then call it.'
const readBest = () => { try { return Number(localStorage.getItem(HISTORY_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(HISTORY_BEST_KEY, String(v)) } catch { /* no storage */ } }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const streakOf = (results) => { let n = 0; for (let k = results.length - 1; k >= 0 && results[k] === true; k--) n += 1; return n }
const bringIntoView = (el) => { try { el?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' }) } catch { /* an old engine without options */ } }
/** The product passes no sign-in of its own (only the workbench does): sign in in a new tab, so this run and its pick
 *  stay put and Check works again once the session is back. */
const openSignIn = () => {
  try { window.open(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`, '_blank', 'noopener') } catch { /* no window */ }
}

/** The hearts, in the kit's look (Order Ticket's and Options Payoff's shield): gold while one stands, dim once lost. */
function Hearts({ left, total = HISTORY_HEARTS }) {
  return (
    <span className={g.hearts} role="img" aria-label={heartsLine(left)} data-testid="history-hearts" data-left={left}>
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
            <span className={`${g.slot} ${word ? g.slotOn : ''} ${tone === 'ok' ? g.slotOk : tone === 'bad' ? g.slotBad : ''}`} data-testid="history-blank"
              data-tone={tone || undefined} aria-label={word ? `blank: ${word}` : 'blank'}>{word || ' '}</span>
          ) : null}
        </span>
      ))}
    </>
  )
}

/** The case card: the hero where a chart would stand, or the case notes under one. */
function CaseCard({ c, n, words, blankWord, blankTone, checking, compact }) {
  return (
    <figure className={`${g.file} ${compact ? g.compact : ''}`} data-testid="history-case" aria-busy={checking || undefined}>
      <span className={g.tab}>Case {n}</span>
      <span className={g.mark} aria-hidden="true"><UIcon name="search" size={compact ? 20 : 28} gold={false} /></span>
      {words.story ? <p className={g.story} data-testid="history-story">{words.story}</p> : null}
      {c.kind === 'fill'
        ? <p className={g.big} data-testid="history-sentence"><Blank sentence={c.sentence} word={blankWord} tone={blankTone} /></p>
        : words.big ? <p className={g.big} data-testid="history-question">{words.big}</p> : null}
      <figcaption className={g.foot}><span>{kindWord(c)}</span>{checking ? <em>Checking</em> : null}</figcaption>
    </figure>
  )
}

/** A number case's answer area: the kit's question header and foot bar (answerLooks.module.css) around one field. */
function NumberAnswer({ c, typed, onType, state, busy, truth, onCheck, onNext, nextLabel, head, eyebrow, question, detail, hotkey, focusOnOpen = false, again = null }) {
  const asking = state === 'ask'
  const value = parseNumber(typed)
  const unreadable = asking && typed.trim() !== '' && value == null
  const field = useRef(null)
  // keyboard play: on a desktop the field takes the keys as the case opens, and again after an answer the server did not
  // score (`again`, the note), so the member can fix it or press Enter to resend. A phone keeps its keyboard down until a tap.
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
            aria-label={c.label || 'Your answer'} aria-invalid={unreadable || undefined} data-testid="history-number" />
          {c.suffix ? <span className={g.affix} aria-hidden="true">{c.suffix}</span> : null}
        </span>
        {unreadable ? <span className={g.numHint} data-testid="history-number-hint">{NUMBER_HINT}</span> : null}
        {state === 'bad' && truth ? <span className={g.numTruth} data-testid="history-number-truth">The answer <b>{truth}</b></span> : null}
      </label>
      <div className={`${sa.lFoot} ${state === 'ok' ? sa.footOk : state === 'bad' ? sa.footBad : ''}`}>
        {asking
          ? <StudyButton kind="primary" size="xl" arrow wide hotkey={hotkey ? 'Enter' : null} busy={busy} disabled={value == null} onClick={onCheck} testId="history-check">{busy ? 'Checking' : 'Check'}</StudyButton>
          : <StudyButton kind={state === 'ok' ? 'good' : 'bad'} size="xl" arrow wide hotkey={hotkey ? 'Enter' : null} onClick={onNext} testId="history-next">{nextLabel}</StudyButton>}
      </div>
    </div>
  )
}

/** The case file, after the answer: the chart's facts, the member's pick and why it was not this, why, the working, the
 *  lesson line and the sources with their quotes. Every word is the reveal's; every number the server's or the module's. */
function CaseFile({ n, ok, truth, said, mine, why, working, line, facts, sources, boxRef }) {
  const quotes = sources.flatMap((src) => src.quotes.map((q) => ({ q, src })))
  return (
    <section className={s.coach} ref={boxRef} data-testid="history-file" aria-label="The case file">
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>Case {n} · the case file</span>
          <h3 className={s.coachTitle} data-testid="history-file-answer">{truth || 'The answer'}</h3>
        </div>
        <span className={`${g.verdict} ${ok ? g.verdictOk : g.verdictBad}`}><UIcon name={ok ? 'check' : 'x'} size={14} gold={false} />{ok ? 'Solved' : 'Missed'}</span>
      </header>
      {facts ? (
        <div className={s.coachBlock} data-testid="history-facts">
          <span className={s.coachLabel}>On the chart</span>
          <div className={g.chips}>
            {facts.sym ? <span className={g.chip}><UIcon name="chart" size={13} gold={false} /><b>{facts.sym}</b></span> : null}
            {facts.date ? <span className={g.chip}><UIcon name="calendar" size={13} gold={false} />Last day shown <b>{facts.date}</b></span> : null}
          </div>
          {facts.fund ? <p className={s.rule}>{facts.fund}</p> : null}
        </div>
      ) : null}
      {!ok && said ? (
        <div className={s.coachBlock} data-testid="history-pick">
          <span className={s.coachLabel}>Your pick</span>
          <p className={s.rule}><b className={g.said}>{said}</b>{mine ? <>. {mine}</> : null}</p>
        </div>
      ) : null}
      {why ? (
        <div className={s.coachBlock} data-testid="history-why">
          <span className={s.coachLabel}>Why</span>
          <p className={s.lead}>{why}</p>
        </div>
      ) : null}
      {working ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>The working</span>
          <p className={g.formula} data-testid="history-working">
            <span>{working.label} = {working.formula}</span>
            <span>= {working.filled} = <b>{working.result}</b></span>
          </p>
        </div>
      ) : null}
      {line ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>The lesson</span>
          <p className={g.line} data-testid="history-line">{line}</p>
        </div>
      ) : null}
      {sources.length ? (
        <div className={s.coachBlock} data-testid="history-sources">
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
            <details className={g.evidence} data-testid="history-evidence">
              <summary><UIcon name="quote" size={13} gold={false} />Read the evidence</summary>
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

/** One case: asked, checked on the server, then reviewed. */
function Case({ c, idx, total, results, seed, prefs, fetcher, signedOut, onDone }) {
  const phone = useIsPhone()
  const choices = useMemo(() => dealChoices(c, seed), [c, seed])
  const words = useMemo(() => caseText(c), [c])
  const [pick, setPick] = useState(null)
  const [typed, setTyped] = useState('')
  const [state, setState] = useState('ask')        // ask | ok | bad
  const [takeover, setTakeover] = useState(false)  // the verdict holds the whole screen until the member opens the case file
  const [busy, setBusy] = useState(false)          // the answer is on the wire: Check reads Checking and a second press posts nothing
  const [note, setNote] = useState(null)           // an answer the server did not score: { line, out }
  const [reveal, setReveal] = useState(null)
  const [xp, setXp] = useState(0)
  const [fwd, setFwd] = useState(NONE)             // what came next on the chart (the reveal's forward bars, then the rest)
  const top = useRef(null)
  const hero = useRef(null)
  const fileBox = useRef(null)
  const shownAt = useRef(0)
  const live = useRef(true)
  const timers = useRef(null)
  useEffect(() => {
    live.current = true
    shownAt.current = performance.now()
    if (!timers.current) timers.current = new Set()
    const pending = timers.current
    // each case opens at its top, the status line and the case in view (Check and Next sit low on the screen)
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
  const working = useMemo(() => (reveal ? workingOf(reveal) : null), [reveal])
  const sources = useMemo(() => (reveal ? sourcesOf(reveal) : NONE), [reveal])
  const facts = useMemo(() => (reveal ? chartFactsOf(c, reveal) : null), [c, reveal])
  const why = reveal ? reasonOf(reveal, truth) : ''
  const mine = !asking && !ok && reveal ? pickNote(reveal, said) : ''
  const line = reveal ? lessonLineOf(reveal) : ''

  // the chart: the case's own window while it is asked; after, the run on into what came next
  const reviewing = !asking && !takeover
  const { bars: all } = useRunOnTo(c.bars, fwd, fwd.length, reviewing && c.chart, RUN_ON)
  const n = c.bars?.length || 0
  const lastDay = n ? shortDate(c.bars[n - 1].t) : ''
  const callouts = useMemo(() => (n ? hardCallouts({ index: n - 1, label: asking || !lastDay ? 'Last day shown' : lastDay, tone: state }) : NONE), [n, asking, lastDay, state])
  const look = useMemo(() => calloutLook(phone), [phone])

  /** A promise that gives up after `ms`, its timer cleared on unmount. */
  const within = useCallback((p, ms) => new Promise((resolve, reject) => {
    const set = timers.current || (timers.current = new Set())
    const t = setTimeout(() => { set.delete(t); const e = new Error('The answer took too long to check.'); e.timeout = true; reject(e) }, ms)
    set.add(t)
    Promise.resolve(p).then((v) => { clearTimeout(t); set.delete(t); resolve(v) }, (e) => { clearTimeout(t); set.delete(t); reject(e) })
  }), [])

  // the rest of the forward strip (the server serves it in pieces), so the aftermath plays out as far as the case stored
  const loadRest = useCallback(async (attempt, have) => {
    let at = have
    for (let k = 0; k < HISTORY_REST_CALLS; k++) {
      const more = await fetchForwardRest(attempt, at, fetcher)
      if (!live.current || !more.length) return
      at += more.length
      setFwd((f) => [...f, ...more])
    }
  }, [fetcher])

  const check = async () => {
    const answer = answerFor(c, { pick, text: typed, choices })
    if (state !== 'ask' || busy || !answer) return
    setBusy(true); setNote(null)
    let attempt = null
    let err = null
    try {
      attempt = await within(scoreAttempt({ id: c.id, sessionId: c.sessionId }, answer, performance.now() - shownAt.current, fetcher), HISTORY_ATTEMPT_TIMEOUT_MS)
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
    if (c.chart && attempt.forward?.length) { setFwd(attempt.forward); loadRest(attempt, attempt.forward.length) }
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

  const openFile = () => { setTakeover(false); bringIntoView(c.chart ? hero.current : fileBox.current) }
  // a case reports itself once: a second press (a double tap, Enter and a click together) never skips the next case
  const sent = useRef(false)
  const next = () => { if (sent.current) return; sent.current = true; onDone(rowOf(c, { ok, said, truth, reveal, xp })) }
  const headline = ok ? 'Case solved.' : 'Not this one.'
  const nextLabel = over ? 'See the cases' : 'Next case'
  // the takeover on a miss teaches in one line (it cannot scroll): why the pick was not it, or the working, or why
  const teach = mine || working?.text || why
  const eyebrow = <>Case {idx + 1} of {total} · {kindWord(c)}{c.chart ? ' · ticker hidden' : ''}</>
  const detail = detailOf(c, phone) || null
  const head = asking ? null : (
    <Prompt mood={ok ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={headline}
      sub={ok ? <><b>{truth || said}</b>{xp > 0 ? ` · +${xp} XP` : ''}</> : <>You said <b>{said || 'nothing'}</b> · {heartsLine(left)}</>}
      seal={<Stamp ok={ok} word={ok ? 'Solved' : null} inline />} />
  )
  // the blank takes the picked word; once checked it reads the answer in green (the member's word in red only when the
  // server did not say what the answer was), so the finished sentence on screen is always the true one
  const blankWord = asking ? (pick == null ? null : choices[pick]) : (truth || said)
  const blankTone = asking ? null : truth ? 'ok' : 'bad'
  const showCard = !c.chart || !!words.story || c.kind === 'fill'

  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="history-play" data-state={busy ? 'checking' : state} data-kind={c.kind} ref={top}>
      {!asking ? <span className={`${s.flash} ${ok ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {!asking && takeover ? (
        <VerdictTakeover ok={ok} title={headline} answer={truth} xp={xp} stampWord={ok ? 'Solved' : null} label="Open the case file"
          onContinue={openFile} testId="history-takeover"
          sub={ok
            ? (line || why ? <span className={g.tkLine} data-testid="history-takeover-line">{line || why}</span> : null)
            : (
              <>
                {teach ? <span className={g.tkLine} data-testid="history-takeover-why">{teach}</span> : null}
                <span className={g.tkHearts} data-testid="history-takeover-hearts">{heartsLine(left)}</span>
              </>
            )} />
      ) : null}
      <div className={g.hudRow}>
        <HudCombo label="Detective" step={idx} total={total} results={after} live={asking} stepTestId="history-step" unit="case" scoreWord="solved" />
        <Hearts left={left} />
      </div>
      {c.chart ? (
        <div className={s.heroChart} ref={hero}>
          <StudyChart id={c.id} bars={all} view={all?.length || n} height={phone ? 300 : 460} callouts={callouts} calloutLook={look}
            symbol={facts?.sym || null} masked={asking || !facts?.sym} frameEnd={asking ? null : all?.[all.length - 1]?.t} />
          {reviewing && fwd.length ? (
            <p className={g.after} data-testid="history-aftermath"><UIcon name="play" size={14} gold={false} />The ringed candle is the last day the case showed. What came next plays out to its right.</p>
          ) : null}
        </div>
      ) : null}
      {showCard ? <CaseCard c={c} n={idx + 1} words={words} blankWord={blankWord} blankTone={blankTone} checking={busy} compact={c.chart} /> : null}
      {c.kind === 'numeric' ? (
        <NumberAnswer c={c} typed={typed} onType={setTyped} state={state} busy={busy} truth={truth} onCheck={check} onNext={next} nextLabel={nextLabel}
          head={head} eyebrow={eyebrow} question={words.question} detail={detail} hotkey={!takeover} focusOnOpen={!phone} again={note} />
      ) : (
        <AnswerLessonApp choices={choices} pick={pick} state={state} answer={right >= 0 ? choices[right] : null} step={idx} total={total} busy={busy} hotkey={!takeover}
          onPick={(k) => { if (asking && !busy) { setPick(k); tapFeedback(prefs) } }} onCheck={check} onNext={next} nextLabel={nextLabel}
          head={head} eyebrow={eyebrow} question={words.question} detail={detail}
          cardsTestId="history-cards" checkTestId="history-check" nextTestId="history-next" />
      )}
      {note ? <p className={g.note} role="status" data-testid="history-note">{note.line}</p> : null}
      {note?.out ? (
        <div className={g.signIn}>
          {signedOut || <StudyButton kind="secondary" onClick={openSignIn} testId="history-sign-in">Sign in (opens a new tab)</StudyButton>}
        </div>
      ) : null}
      {!asking ? (
        <CaseFile n={idx + 1} ok={ok} truth={truth} said={said} mine={mine} why={why} working={working} line={line} facts={facts} sources={sources} boxRef={fileBox} />
      ) : null}
    </div>
  )
}

/** One case in the run log, under its question: the answer on a solved case (a missed one carries "you said ..., it was
 *  ..." from the end screen itself, moved up under the question by the stylesheet), the chart's ticker and day, the lesson
 *  line, the source. So the log reads as a review sheet: every case with its answer. */
function LogLine({ row }) {
  return (
    <span className={g.logLine}>
      {row.ok && row.truth ? <span className={g.logAnswer} data-testid="history-log-answer"><UIcon name="check" size={13} gold={false} />{row.truth}</span> : null}
      {row.chart ? <span className={g.logChart}><UIcon name="chart" size={13} gold={false} />{row.chart}</span> : null}
      {row.line ? <span className={g.logLesson} data-testid="history-log-line">{row.line}</span> : null}
      {row.source ? (
        <span className={g.logSrc}>
          <UIcon name="book" size={13} gold={false} />
          {row.source.url ? <a href={row.source.url} target="_blank" rel="noopener noreferrer" title={row.source.full}>{row.source.name}</a> : <span title={row.source.full}>{row.source.name}</span>}
        </span>
      ) : null}
    </span>
  )
}

export default function HistoryDetectiveGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')   // start | play | done
  const [pool, setPool] = useState(null)         // the usable cases; null while the draw loads
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [run, setRun] = useState(null)           // { id, seed, deck }: the cases and the seed their tiles are dealt from
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
      setError(new Error('The case files took too long to load.')); setPool([])
    }, HISTORY_POOL_TIMEOUT_MS)
    Promise.resolve()
      .then(() => fetcher(SESSIONS_URL, { method: 'POST', body: sessionBody() }))
      .then((res) => { if (!on) return; on = false; clearTimeout(t); setPool(casesOf(res, normalizeBars)) })
      .catch((e) => { if (!on) return; on = false; clearTimeout(t); setError(e || new Error('The case files did not load.')); setPool([]) })
    return () => { on = false; clearTimeout(t) }
  }, [reload, fetcher])

  const deck = useMemo(() => (pool ? deckOf(pool) : NONE), [pool])
  const ready = deck.length >= HISTORY_MIN
  const start = useCallback(() => {
    if (!ready) return
    const seed = Date.now()   // seeded once; the pure module deals every case's tiles from it
    beginRunXp()
    setRun({ id: `history-${seed}`, seed, deck })
    setI(0); setTally(EMPTY_TALLY); setBestBefore(readBest()); setPhase('play')
  }, [ready, deck])
  const again = () => { setPool(null); setError(null); setRun(null); setReload((r) => r + 1); setPhase('start') }
  const retry = () => { setPool(null); setError(null); setReload((r) => r + 1) }
  const back = onClose ? <StudyButton kind="ghost" onClick={onClose} testId="history-back">Back to Study</StudyButton> : null

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
      <div className={`${s.kit} ${g.failed}`} data-testid="history-failed">
        <ChallengeError what="the History Detective cases" error={error} signedOut={signedOut} onRetry={retry} />
        {back}
      </div>
    )
  }

  if (phase === 'start') {
    const empty = !!pool && !ready
    const thin = empty && deck.length > 0   // a case or two, too few for a run: said as it is
    // the stakes name the run as it will deal: this draw's cases once they are in, the game's own eight until then
    const count = ready ? deck.length : HISTORY_TOTAL
    return (
      <div className={s.kit}>
        <StartArena plate={GAME.plate} title={GAME.title} caption="Solve the case" testId={empty ? 'history-empty' : 'history-intro'} startTestId="history-start" hotkey
          total={count} ready={ready} onStart={start}
          stakes={[{ v: count, l: 'cases', icon: 'search' }, { v: HISTORY_HEARTS, l: 'hearts', icon: 'shield' }, { v: 1, l: 'try each', icon: 'check' }]}
          label={ready ? 'Open the case files' : pool == null ? 'Opening the case files' : thin ? 'Not enough cases yet' : 'No cases yet'}
          lead={empty ? <span data-testid="history-empty-line">{thin ? thinLine(deck.length) : EMPTY_LINE}</span> : LEAD}
          reward={empty ? null : undefined}
          howTo={empty ? null : <HowItPlays mode="history" testId="history-howto" steps={[
            { icon: 'search', title: 'Open the case', body: 'A real fall in US stocks: an index fund’s chart with its ticker hidden, or the case notes. Read every clue.' },
            { icon: 'check', title: 'Solve it', body: 'Pick an answer, or type the number, then Check. Number keys pick, Enter checks. One try each.' },
            { icon: 'shield', title: 'Three hearts', body: 'A miss costs a heart. Every answer opens the case file: the answer, why, and the sources it rests on.' },
          ]} />}>
          {empty ? back : (
            <span data-testid="history-pool-line">
              {pool == null ? 'Drawing the cases' : `${plural(deck.length, 'case', 'cases')} in this draw`}
              {best > 0 ? <> · your best run <b data-testid="history-best">{best}</b> solved</> : null}
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
    // the hearts cut the run short (a third miss on the last case still finished every case: that run earns its rank)
    const cut = heartsLeft(results) === 0 && !full
    const bl = bestLine(right, bestBefore)
    const rows = log.map((r) => ({ name: r.name, ticker: <LogLine row={r} />, ok: r.ok, said: r.ok ? null : r.said, was: r.ok ? '' : r.truth }))
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s.kit} ${g.end}`}>
          <EndHard right={right} total={played} xp={xp} results={results} log={rows} level={runXp()} unit="cases solved" doneWord="solved"
            showSetups={false} medal={full} testIdPrefix="history" title={cut ? 'Out of hearts' : rankOf(right, played)}
            againLabel="Open new cases" onAgain={again} onBack={onClose}>
            <span className={g.endNote} data-testid="history-end-line">
              {perfect
                ? <><b>Every case solved.</b> Depth, length, cause and aftermath, read right each time.</>
                : cut
                  ? <>The hearts ran out on case <b>{played}</b> of {run?.deck.length}. Each case below keeps its answer, its lesson and its source.</>
                  : <>Each case below keeps its answer, its lesson and its source.</>}
            </span>
            {bl ? (
              <span className={g.endNote} data-testid="history-best-line">
                {bl.fresh ? <><b>A new best:</b> {bl.n} solved.</> : <>Your best run stands at <b>{bl.n}</b> solved.</>}
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
    <Case key={`${run.id}-${i}`} c={c} idx={i} total={run.deck.length} results={tally.results} seed={run.seed} prefs={prefs}
      fetcher={fetcher} signedOut={signedOut} onDone={next} />
  )
}
