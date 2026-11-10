// SPOT THE MISTAKE (docs/study/GAMES.md §3, kind 'mistake'; built on the contract in §1). Eight approved entries from
// course unit F12.07 (POST /api/study/sessions {kind: 'skill', skill_id: 'process.mistakes', size: 8}): each a four-line
// trade plan or journal entry, numbered 1 to 4, where one line breaks a rule. The four lines are the answer tiles (the
// kit's Tile, one to a row, the story read as the member taps it); tapping line N answers "Line N", by tap or by its
// number key, then Check. Three hearts. Every answer is scored on the server (POST /api/study/attempts), which grants the
// XP, so this game never posts a game run. Check takes over the screen (rule 15): the verdict, the broken line, why, and
// on a miss the hearts left. The review then lights the broken line, marks the member's own pick, and under every line
// says why it broke the plan or why it was fine (the reveal's `wrong`, in the bank's own words), with the lesson line and
// the source on a coach's card. The end screen (EndHard) lists every entry's broken line with the member's pick and the
// lesson line, and its level bar shows the XP the attempts earned. A pool under MISTAKE_MIN entries says so honestly; a
// pool that fails offers a retry and a way back; an answer the server does not score is not counted and the run goes on
// (MISTAKE_MAX_FAILS in a row stop it). A story that does not split into four lines shows whole, over the plain tiles.
// Every number is games/mistake.js's or the server's. The best run lives on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudCombo } from '../ui/HudLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import VerdictTakeover from '../ui/VerdictTakeover'
import Prompt from '../ui/Prompt'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import Tile from '../ui/Tile'
import { EndHard } from '../ui/EndLooks'
import { Confetti } from '../ui/Stage'
import s from '../ui/study.module.css'
import sa from '../ui/answerLooks.module.css'
import g from './SpotMistakeGame.module.css'
import ChallengeError, { isSignedOut } from './ChallengeError'
import { beginRunXp, runXp, scoreAttempt } from './challengeBank'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import {
  EMPTY_LINE, LOST_LINE, MISTAKE_ATTEMPT_TIMEOUT_MS, MISTAKE_BEST_KEY, MISTAKE_HEARTS, MISTAKE_LINES, MISTAKE_MAX_FAILS, MISTAKE_MIN,
  MISTAKE_POOL_TIMEOUT_MS, MISTAKE_SIZE, MISTAKE_SKILL, MISTAKE_TOTAL, MISTAKE_UNIT, SESSIONS_URL, choiceFor, deckOf, endNote, endTitle,
  heartsLeft, heartsLine, keyLine, mistakeOf, questionsOf, rowOf, runOver, thinLine, verdictOf, verdictTitle,
} from './games/mistake'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: 'mistake', title: 'Spot the Mistake', sub: 'A four-line trade plan or journal entry. One line breaks a rule. Tap it.', icon: 'journal', plate: 'Mistake', accent: 'red', group: 'skill' }

const readBest = () => { try { return Number(localStorage.getItem(MISTAKE_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(MISTAKE_BEST_KEY, String(v)) } catch { /* no storage */ } }
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`
const streakOf = (results) => { let n = 0; for (let k = results.length - 1; k >= 0 && results[k] === true; k--) n += 1; return n }
const LINE_NUMBERS = Array.from({ length: MISTAKE_LINES }, (_, k) => k + 1)

/** The hearts, in the kit's look (Order Ticket's): a gold shield for each one left, a dim one for each one lost. */
function Hearts({ left, total = MISTAKE_HEARTS }) {
  return (
    <span className={g.hearts} role="img" aria-label={heartsLine(left)} data-testid="mistake-hearts" data-left={left}>
      {Array.from({ length: total }, (_, k) => (
        <i key={k} className={`${g.heart} ${k < left ? g.heartOn : g.lost}`}><UIcon name="shield" size={20} gold={false} /></i>
      ))}
    </span>
  )
}

/** The state a line's tile shows: picked while asking; after Check the broken line lights, the member's own pick is
 *  marked wrong, the rest go quiet. */
function tileState(n, { pick, state, truth }) {
  if (state === 'ask') return pick === n ? 'sel' : 'idle'
  if (n === truth) return 'right'
  if (n === pick) return 'wrong'
  return 'quiet'
}

/** The note under a line after Check: the broken one says why it breaks the plan, each other one why it was fine. */
function LineNote({ n, row }) {
  const broke = n === row.truth
  const text = broke ? row.why : row.fine[n]
  return (
    <div className={`${g.note} ${broke ? g.noteBad : g.noteOk}`} data-testid={`mistake-note-${n}`} data-broke={broke ? '1' : '0'}>
      <span className={g.noteTag}><UIcon name={broke ? 'warning' : 'check'} size={13} gold={false} />{broke ? 'Breaks the plan' : 'Fine'}</span>
      {text ? <span className={g.noteText}>{text}</span> : null}
    </div>
  )
}

/** The entry: the four lines as tiles when the story splits, else the story whole over the plain Line tiles. The notes
 *  under the lines need the broken line known (a key the reveal did not name lights nothing and notes nothing: a "Fine"
 *  under the line marked wrong would contradict it). */
function Entry({ qn, pick, state, row, onPick }) {
  const ctx = { pick, state, truth: row?.truth ?? null }
  const asking = state === 'ask'
  const lines = qn.lines
  return (
    <section className={`${g.entry} ${asking ? '' : g.entryDone}`} aria-label="The entry" data-testid="mistake-entry" data-split={lines ? '1' : '0'}>
      <header className={g.entryHead}>
        <span className={g.plate}><UIcon name="journal" size={14} gold={false} />The entry</span>
        <span className={g.entryNote}>{lines ? 'Four lines. One breaks a rule.' : 'Read it whole, then pick the line.'}</span>
      </header>
      {lines ? null : <p className={g.story} data-testid="mistake-story">{qn.story}</p>}
      <div className={g.lines} role="radiogroup" aria-label="The lines" data-testid="mistake-lines">
        {LINE_NUMBERS.map((n) => {
          const st = tileState(n, ctx)
          return (
            <div key={n} className={`${g.lineRow} ${g['row_' + st] || ''}`} style={{ '--i': n - 1 }} data-testid={`mistake-line-${n}`} data-state={st}>
              <Tile n={n} i={n - 1} label={lines ? lines[n - 1] : choiceFor(qn, n)} role="radio" checked={pick === n} state={st} disabled={!asking}
                onClick={() => onPick(n)} testId={`mistake-tile-${n}`} className={`${g.line} ${lines ? g.lineText : ''}`} />
              {!asking && row && row.truth ? <LineNote n={n} row={row} /> : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** The coach's card after Check: the lesson line as its title, why the line breaks the plan, the other three in a
 *  word each, and where it comes from. */
function Lesson({ row }) {
  const fine = LINE_NUMBERS.filter((n) => n !== row.truth)
  return (
    <section className={s.coach} data-testid="mistake-lesson" aria-label="The lesson">
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>The lesson</span>
          <h3 className={s.coachTitle}>{row.line || (row.truth ? `Line ${row.truth} broke the plan.` : 'Read every line against the rules.')}</h3>
        </div>
      </header>
      {row.why ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>{row.truth ? `Why line ${row.truth} breaks the plan` : 'Why'}</span>
          <p className={g.why} data-testid="mistake-why">{row.why}</p>
        </div>
      ) : null}
      {fine.some((n) => row.fine[n]) ? (
        <div className={s.coachBlock}>
          <span className={s.coachLabel}>The other three</span>
          <ul className={s.leadList} data-testid="mistake-fine">
            {fine.map((n) => <li key={n}><b>Line {n}.</b> {row.fine[n] || 'Fine.'}</li>)}
          </ul>
        </div>
      ) : null}
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>Where it comes from</span>
        <p className={s.rule}>Course unit {row.unit}, Spot the mistake.</p>
        {row.source ? (
          <p className={g.src} data-testid="mistake-source">
            <UIcon name="book" size={13} gold={false} />
            {row.source.url
              ? <a href={row.source.url} target="_blank" rel="noopener noreferrer" title={row.source.full}>{row.source.name}</a>
              : <span title={row.source.full}>{row.source.name}</span>}
          </p>
        ) : null}
      </div>
    </section>
  )
}

/** One entry on the end screen, under the line that broke the plan: the member's pick, the lesson line, the source. */
function Review({ row }) {
  return (
    <span className={g.review}>
      <span className={g.calls}>
        <span className={`${g.call} ${g.truth}`}>{row.truth ? <>Line <b>{row.truth}</b> broke the plan</> : <>The plan</>}</span>
        <span className={`${g.call} ${row.ok ? g.mine : g.wrong}`}>You tapped <b>line {row.said}</b></span>
      </span>
      {row.line ? <span className={g.reviewLine} data-testid="mistake-log-line">{row.line}</span> : null}
      {row.source ? <span className={g.src}><UIcon name="book" size={13} gold={false} /><span title={row.source.full}>{row.source.name}</span></span> : null}
    </span>
  )
}

function Round({ idx, total, qn, results, prefs, fetcher, within, note = null, onDone }) {
  const phone = useIsPhone()
  const [pick, setPick] = useState(null)             // the line tapped, 1 to 4
  const [state, setState] = useState('ask')          // ask | ok | bad
  const [busy, setBusy] = useState(false)            // the answer is on the wire: Check reads Checking and a second tap posts nothing
  const [takeover, setTakeover] = useState(false)    // the verdict holds the whole screen until the member opens the review
  const [row, setRow] = useState(null)
  const [xp, setXp] = useState(0)
  const top = useRef(null)
  const entryBox = useRef(null)
  const shownAt = useRef(0)
  const live = useRef(true)
  useEffect(() => { live.current = true; shownAt.current = Date.now(); return () => { live.current = false } }, [])
  const asking = state === 'ask'
  const ok = state === 'ok'
  const after = asking ? results : [...results, ok]
  const left = heartsLeft(after)
  // the run ends with the hearts, with the last entry of the deck (an entry the server never scored still counts as
  // played through), or with every entry scored
  const over = !asking && (runOver(after, total) || idx + 1 >= total)

  // each entry opens at its top, the status line and the question in view (Check and Next sit low on the screen)
  useEffect(() => {
    const el = top.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' })
  }, [])

  const choose = useCallback((n) => {
    if (state !== 'ask' || busy || !n) return
    setPick(n); tapFeedback(prefs)
  }, [state, busy, prefs])

  const check = useCallback(async () => {
    if (state !== 'ask' || busy || pick == null) return
    setBusy(true)
    let a = null
    let err = null
    try {
      a = await within(scoreAttempt(qn, { choice: choiceFor(qn, pick) }, Date.now() - shownAt.current, fetcher), MISTAKE_ATTEMPT_TIMEOUT_MS)
      // a reply with no verdict is not a score: read as a miss, it would light a line as the broken one on no evidence
      if (verdictOf(a) == null) throw new Error('The answer came back without a verdict.')
    } catch (e) { err = e || new Error('The answer was not checked.') }
    if (!live.current) return
    setBusy(false)
    if (err) { onDone({ lost: true, out: isSignedOut(err) }); return }
    const r = rowOf({ question: qn, said: pick, correct: verdictOf(a), reveal: a.reveal || null })
    setRow(r); setXp(Number(a.progress?.xp_gained || 0)); setState(r.ok ? 'ok' : 'bad'); setTakeover(true)
    revealFeedback(r.ok, prefs)
    if (r.ok) comboFeedback(streakOf(results) + 1, prefs)
  }, [state, busy, pick, qn, fetcher, within, prefs, results, onDone])

  // the number keys tap a line; Enter is Check's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    if (state !== 'ask') return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const n = keyLine(e.key)
      if (n) { e.preventDefault(); choose(n) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, choose])

  const openReview = () => {
    setTakeover(false)
    const el = entryBox.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
  const title = row ? verdictTitle(row.ok, row.truth) : ''
  const heartWords = heartsLine(left)
  const xpNote = xp > 0 ? ` · +${xp} XP` : ''
  const sub = !row ? null : ok
    ? <>Line {row.truth} broke the plan{xpNote}</>
    : <>You tapped line {row.said} · {heartWords}</>

  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="mistake-round" data-state={busy ? 'checking' : state} ref={top}>
      {!asking ? <span className={`${s.flash} ${ok ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {!asking && takeover && row ? (
        <VerdictTakeover ok={ok} title={title} answer={row.truth ? `Line ${row.truth}` : null} xp={xp} stampWord={ok ? 'Spotted' : null}
          label={ok ? 'See the lesson' : 'See why'} onContinue={openReview} testId="mistake-takeover"
          sub={(
            <>
              {row.why ? <span className={g.tkWhy} data-testid="mistake-takeover-why">{row.why}</span> : null}
              {ok ? <span className={g.tkLine}>{row.line}</span> : <span className={`${g.tkLine} ${g.tkHearts}`} data-testid="mistake-takeover-hearts">{heartWords}</span>}
            </>
          )} />
      ) : null}
      <div className={g.hudRow}>
        <HudCombo label="Spot the Mistake" step={idx} total={total} results={after} live={asking} stepTestId="mistake-step" unit="entry" scoreWord="spotted" />
        <Hearts left={left} />
      </div>
      {asking ? (
        <div className={sa.area}>
          <div className={sa.lHead}>
            <span className={sa.lEyebrow}>Spot the Mistake · entry {idx + 1} of {total} · {heartWords}</span>
            <h2 className={g.question} data-testid="mistake-question">{qn.q}</h2>
            <p className={sa.lDetail}>Three lines keep the rules. <b>Tap the one that breaks a rule</b>{phone ? '' : ', or press its number'}, then Check.</p>
          </div>
        </div>
      ) : (
        <Prompt mood={ok ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={title} sub={sub} seal={<Stamp ok={ok} word={ok ? 'Spotted' : null} inline />} />
      )}
      <div ref={entryBox}>
        <Entry qn={qn} pick={pick} state={state} row={row} onPick={choose} />
      </div>
      {note && asking ? <p className={g.lostNote} role="status" data-testid="mistake-note">{note}</p> : null}
      <div className={sa.area}>
        <div className={`${sa.lFoot} ${ok ? sa.footOk : state === 'bad' ? sa.footBad : ''}`}>
          {asking
            ? <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" busy={busy} disabled={pick == null} onClick={check} testId="mistake-check">{busy ? 'Checking' : pick == null ? 'Tap a line' : `Check line ${pick}`}</StudyButton>
            : <StudyButton kind={ok ? 'good' : 'bad'} size="xl" arrow wide hotkey={takeover ? null : 'Enter'} onClick={() => onDone({ ok, row, xp })} testId="mistake-next">{over ? 'See the run' : 'Next entry'}</StudyButton>}
        </div>
      </div>
      {row ? <Lesson row={row} /> : null}
    </div>
  )
}

export default function SpotMistakeGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')       // start | play | done
  const [pool, setPool] = useState(null)             // the playable entries; null while the draw loads
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [run, setRun] = useState(null)               // { id, deck }: the entries dealt once from the seed
  const [i, setI] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  const [xp, setXp] = useState(0)
  const [lost, setLost] = useState(0)                // answers the server never scored (not counted)
  const [fails, setFails] = useState(0)              // of those, in a row
  const [note, setNote] = useState(null)             // said on the next entry when the last one could not be checked
  const [stop, setStop] = useState(null)             // why a run ended early: hearts | offline | signedOut
  const [best, setBest] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0)
  const timers = useRef(null)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    if (!timers.current) timers.current = new Set()
    const pending = timers.current
    return () => { live.current = false; pending.forEach((t) => clearTimeout(t)); pending.clear() }
  }, [])

  // the draw: a fresh one each time the start screen opens; a draw that never answers fails honestly, never spins
  useEffect(() => {
    let on = true
    const t = setTimeout(() => {
      if (!on) return
      on = false
      setError(new Error('The entries took too long to load.')); setPool([])
    }, MISTAKE_POOL_TIMEOUT_MS)
    Promise.resolve()
      .then(() => fetcher(SESSIONS_URL, { method: 'POST', body: { kind: 'skill', skill_id: MISTAKE_SKILL, size: MISTAKE_SIZE } }))
      .then((set) => { if (!on) return; on = false; clearTimeout(t); setPool(questionsOf(set)) })
      .catch((e) => { if (!on) return; on = false; clearTimeout(t); setError(e || new Error('The entries did not load.')); setPool([]) })
    return () => { on = false; clearTimeout(t) }
  }, [reload, fetcher])

  /** A promise that gives up after `ms`, its timer cleared on unmount. */
  const within = useCallback((p, ms) => new Promise((resolve, reject) => {
    const set = timers.current || (timers.current = new Set())
    const t = setTimeout(() => { set.delete(t); const e = new Error('The answer took too long to check.'); e.timeout = true; reject(e) }, ms)
    set.add(t)
    Promise.resolve(p).then((v) => { clearTimeout(t); set.delete(t); resolve(v) }, (e) => { clearTimeout(t); set.delete(t); reject(e) })
  }), [])

  const ready = !!pool && pool.length >= MISTAKE_MIN
  const start = useCallback(() => {
    if (!pool || pool.length < MISTAKE_MIN) return
    const seed = Date.now()   // seeded once; the pure module deals the whole run from it
    beginRunXp()
    setRun({ id: `mistake-${seed}`, deck: deckOf(pool, seed) })
    setI(0); setResults([]); setLog([]); setXp(0); setLost(0); setFails(0); setNote(null); setStop(null); setBestBefore(best); setPhase('play')
  }, [pool, best])
  const again = () => { setPool(null); setError(null); setReload((n) => n + 1); setPhase('start') }

  const finish = (res, reason) => {
    setPhase('done'); setStop(reason); endFeedback(prefs)
    const right = res.filter(Boolean).length
    if (right > best) { setBest(right); writeBest(right) }
  }

  const done = (out) => {
    const total = run.deck.length
    if (out.lost) {
      // not scored, not counted; signed out ends the run, three failures in a row end it too
      const nextLost = lost + 1
      setLost(nextLost)
      if (out.out) { finish(results, 'signedOut'); return }
      const f = fails + 1
      setFails(f)
      if (f >= MISTAKE_MAX_FAILS) { finish(results, 'offline'); return }
      if (i + 1 >= total) { finish(results, null); return }
      setNote(LOST_LINE); setI(i + 1)
      return
    }
    const res = [...results, !!out.ok]
    setResults(res); setFails(0); setNote(null)
    setXp((v) => v + (out.xp || 0))
    setLog((l) => [...l, { name: mistakeOf(out.row), ticker: <Review row={out.row} />, ok: !!out.ok, said: null, was: '' }])
    // an entry the server never scored was played through, so the deck can end before the results fill it
    if (!runOver(res, total) && i + 1 < total) { setI(i + 1); return }
    finish(res, heartsLeft(res) === 0 ? 'hearts' : null)
  }

  const back = onClose ? <StudyButton kind="ghost" onClick={onClose} testId="mistake-back">Back to Study</StudyButton> : null

  if (error) {
    return (
      <div className={`${s.kit} ${g.failed}`} data-testid="mistake-failed">
        <ChallengeError what="the Spot the Mistake entries" error={error} signedOut={signedOut} onRetry={() => { setPool(null); setError(null); setReload((n) => n + 1) }} />
        {back}
      </div>
    )
  }

  if (phase === 'start') {
    const empty = !!pool && pool.length < MISTAKE_MIN
    const count = ready ? Math.min(MISTAKE_TOTAL, pool.length) : MISTAKE_TOTAL
    return (
      <div className={s.kit}>
        <StartArena plate={GAME.plate} title={GAME.title} caption="Which line breaks the plan?" testId={empty ? 'mistake-empty' : 'mistake-intro'} startTestId="mistake-start" hotkey
          total={count} ready={ready} onStart={start}
          label={ready ? 'Open the journal' : pool == null ? 'Loading the entries' : pool.length ? 'Not enough entries yet' : 'No entries yet'}
          stakes={[{ v: count, l: 'entries', icon: 'journal' }, { v: MISTAKE_HEARTS, l: 'hearts', icon: 'shield' }, { v: 1, l: 'line breaks a rule', icon: 'search' }]}
          lead={empty ? <span data-testid="mistake-empty-line">{pool.length ? thinLine(pool.length) : EMPTY_LINE}</span> : <>A trade plan or a journal entry, four lines long. Three keep the rules we teach. One breaks a rule. Find it before the hearts run out.</>}
          reward={empty ? null : <><UIcon name="star" size={22} /><span data-testid="mistake-best">{best > 0 ? <>Your best run: <b>{best}</b> of {MISTAKE_TOTAL} spotted</> : <>Spot all <b>{MISTAKE_TOTAL}</b> and keep every heart</>}</span></>}
          howTo={empty ? null : <HowItPlays mode="mistake" testId="mistake-howto" steps={[
            { icon: 'journal', title: 'Read the entry', body: `Four numbered lines of a trade plan or a journal entry, from course unit ${MISTAKE_UNIT}. Three keep the rules. One breaks a rule.` },
            { icon: 'search', title: 'Tap the broken line', body: 'Tap the line that breaks a rule, or press its number, then Check. One try each.' },
            { icon: 'shield', title: 'Three hearts', body: 'A miss costs a heart and shows the line that broke the plan, why, and why the other three were fine.' },
          ]} />}>
          {empty ? back : <span data-testid="mistake-pool-line">{pool == null ? 'Drawing the entries' : `${plural(pool.length, 'entry', 'entries')} in this draw`}</span>}
        </StartArena>
      </div>
    )
  }

  if (phase === 'done') {
    // the run is scored on the entries played: a run the hearts ended early is right of played, its accuracy too, and the
    // medal line shows only on a full run (as in Order Ticket)
    const right = results.filter(Boolean).length
    const played = results.length
    const full = played === MISTAKE_TOTAL
    const perfect = full && right === MISTAKE_TOTAL
    const out = stop === 'hearts'
    const newBest = right > 0 && right > bestBefore
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s.kit} ${g.end}`}>
          <EndHard right={right} total={played} xp={xp} results={results} log={log} level={runXp()} title={endTitle(right, played, out)}
            unit="mistakes spotted" doneWord="spotted" showSetups={false} medal={full} testIdPrefix="mistake"
            againLabel="Open a new journal" onAgain={again} onBack={onClose}>
            <span className={g.endNote} data-testid="mistake-best-line">
              {perfect
                ? <><b>Eight for eight.</b> Every broken line found, every heart kept.</>
                : out
                  ? <>The hearts ran out on entry <b>{played}</b> of {run?.deck.length || MISTAKE_TOTAL}.{newBest ? <> <b>A new best</b> all the same: {right} spotted.</> : null}</>
                  : newBest
                    ? <><b>A new best:</b> {right} of {played} spotted.</>
                    : <>Your best run stands at <b>{best}</b> of {MISTAKE_TOTAL}.</>}
            </span>
            {endNote(log) ? <span className={g.endNote} data-testid="mistake-end-note">{endNote(log)}</span> : null}
            {stop === 'offline' ? <span className={g.endNote} data-testid="mistake-offline">The server stopped answering, so the run ended early.</span> : null}
            {stop === 'signedOut' ? <span className={g.endNote} data-testid="mistake-signed-out">You are signed out, so the run stopped there.</span> : null}
            {lost && stop !== 'offline' ? <span className={g.endNote} data-testid="mistake-lost">{plural(lost, 'entry', 'entries')} could not be checked, so {lost === 1 ? 'it does' : 'they do'} not count.</span> : null}
          </EndHard>
          {stop === 'signedOut' && signedOut ? <div className={g.signIn}>{signedOut}</div> : null}
        </div>
      </>
    )
  }

  const qn = run?.deck[i]
  if (!qn) return null
  return <Round key={`${run.id}-${i}`} idx={i} total={run.deck.length} qn={qn} results={results} prefs={prefs} fetcher={fetcher} within={within} note={note} onDone={done} />
}
