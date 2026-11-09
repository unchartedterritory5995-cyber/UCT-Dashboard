// SIZE IT (docs/study/GAMES.md §3, kind 'size'; built on the contract in §1). Sixty seconds of trade cards like Blitz: an
// account, the risk per trade (0.25% to 2%, docs/study/sizing_rule.md §1), a long entry and its stop. How many shares?
// Four tiles: the right size and three of the named sizing mistakes (sized on the price, rounded up past the risk, a 10x
// slip, the stop's percent used as dollars, the risk % left out). A right answer flashes and the next card comes at once,
// the multiplier climbing as in Blitz; a miss takes over the screen with the working (rule 15) while the clock waits, so
// reading the lesson never costs time. Every number is games/sizeIt.js's, seeded once at start. The run reports itself
// once at the end (POST /api/study/game-runs), and the end screen's level bar shows what the server granted; a failed
// report leaves the end screen whole, without the bar. The best score lives on this device.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudClock } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import VerdictTakeover from '../ui/VerdictTakeover'
import s2 from '../ui/study.module.css'
import g from './SizeItGame.module.css'
import { isSignedOut } from './ChallengeError'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import {
  LESSON, LESSON_SOURCE, MISTAKES, SIZE_BEST_KEY, SIZE_KIND, SIZE_SECS, cardAt, dollars, ladderGap, missTitle, mistakeOf, pointsFor,
  price, riskPctText, runIdOf, sharesText, sizeMult, sizeVerdict, slipLine, whyLine, working,
} from './games/sizeIt'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: 'size', title: 'Size It', sub: 'Sixty seconds. Size every trade from its stop, rounded down.', icon: 'scale', plate: 'Size', accent: 'gold' }

const GAME_RUNS_URL = '/api/study/game-runs'
const readBest = () => { try { return Number(localStorage.getItem(SIZE_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(SIZE_BEST_KEY, String(v)) } catch { /* no storage */ } }
const EMPTY_RUN = { runId: '', seed: 0, score: 0, combo: 0, best: 0, right: 0, answered: 0, results: [], log: [] }

/** The hero in place of a chart: the account and the risk, the entry and the stop drawn as two levels with the stop's
 *  width between them, and the method under it. */
function TradeCard({ card, n }) {
  return (
    <div className={g.card} data-testid="size-card" data-level={card.level}>
      <div className={g.head}>
        <span className={g.side}><UIcon name="equity" size={14} gold={false} />Long</span>
        <span className={g.tier}>{card.levelName}</span>
        <span className={g.no}>Card <b>{n}</b></span>
      </div>
      <div className={g.body}>
        <dl className={g.facts}>
          <div className={g.fact}><dt>Account</dt><dd data-testid="size-account">{dollars(card.account)}</dd></div>
          <div className={`${g.fact} ${g.risk}`}><dt>Risk per trade</dt><dd data-testid="size-risk">{riskPctText(card.riskBps)}</dd></div>
        </dl>
        <div className={g.ladder} style={{ '--gap': ladderGap(card) }}>
          <div className={`${g.row} ${g.entry}`}><span>Entry</span><i aria-hidden="true" /><b data-testid="size-entry">{price(card.entryCents)}</b></div>
          <div className={g.band} aria-hidden="true"><em>?</em><small>risk a share</small></div>
          <div className={`${g.row} ${g.stop}`}><span>Stop</span><i aria-hidden="true" /><b data-testid="size-stop">{price(card.stopCents)}</b></div>
        </div>
      </div>
      <ol className={g.steps} aria-label="The method">
        <li><b>1</b>Dollars at risk</li>
        <li><b>2</b>Risk a share</li>
        <li><b>3</b>Shares, rounded down</li>
      </ol>
    </div>
  )
}

/** What a miss shows: why that tile was wrong, the working in three steps, and the rule it comes from. Spans only: the
 *  takeover sets it inside a paragraph. */
function Working({ card, value }) {
  return (
    <>
      <span className={g.why} data-testid="size-why">{whyLine(card, value)}</span>
      <span className={g.work} data-testid="size-working">
        {working(card).map((st, k) => (
          <span key={st.key} className={g.wRow}><span className={g.wNum}>{k + 1}</span><span>{st.pre}<b>{st.value}</b>{st.post}</span></span>
        ))}
      </span>
      <span className={g.rule}>{LESSON}<small>{LESSON_SOURCE}</small></span>
    </>
  )
}

export default function SizeItGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const phone = useIsPhone()
  const [phase, setPhase] = useState('start')      // start | play | done
  const [run, setRun] = useState(EMPTY_RUN)
  const [i, setI] = useState(0)
  const [left, setLeft] = useState(SIZE_SECS)
  const [miss, setMiss] = useState(null)            // { card, value }: the takeover holds the screen and the clock waits
  const [flash, setFlash] = useState(null)
  const [level, setLevel] = useState(null)          // { before, after } from the game-runs answer, or null
  const [saveFailed, setSaveFailed] = useState(null)   // the refused report's error, for the signed-out line
  const [bestEver, setBestEver] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0)
  const runRef = useRef(EMPTY_RUN)
  const leftRef = useRef(SIZE_SECS)
  const lockRef = useRef(-1)                        // the card already answered: a fast second tap scores nothing
  const runNo = useRef(0)
  const flashT = useRef(null)
  const live = useRef(true)
  useEffect(() => { live.current = true; return () => { live.current = false; clearTimeout(flashT.current) } }, [])

  const card = useMemo(() => (phase === 'play' && run.seed ? cardAt(run.seed, i) : null), [phase, run.seed, i])

  // the end of the run: once, from the clock's last tick. The report goes out once per run id (the server is idempotent
  // on it too); whatever it answers, the end screen is already up.
  const finish = useCallback(() => {
    const r = runRef.current
    setPhase('done'); endFeedback(prefs)
    const prev = readBest()
    if (r.score > prev) writeBest(r.score)
    setBestEver(Math.max(prev, r.score))
    if (!r.answered || r.posted) return
    runRef.current = { ...r, posted: true }
    // a late answer lands only on its own run's end screen, never on a run started after it
    const mine = () => live.current && runRef.current.runId === r.runId
    Promise.resolve()
      .then(() => fetcher(GAME_RUNS_URL, { method: 'POST', body: { kind: SIZE_KIND, run_id: r.runId, right: r.right, total: r.answered } }))
      .then((res) => {
        const after = Number(res?.progress?.xp)
        const gained = Number(res?.xp_gained ?? res?.progress?.xp_gained ?? 0)
        if (mine() && Number.isFinite(after) && Number.isFinite(gained)) setLevel({ before: after - gained, after })
      })
      .catch((e) => { if (mine()) setSaveFailed(e || new Error('not saved')) })
  }, [prefs, fetcher])

  // the clock: one tick a second while a card is up; it stops while a miss holds the screen
  useEffect(() => {
    if (phase !== 'play' || miss) return undefined
    const t = setInterval(() => {
      const next = Math.max(0, leftRef.current - 1)
      leftRef.current = next
      setLeft(next)
      if (next === 0) { clearInterval(t); finish() }
    }, 1000)
    return () => clearInterval(t)
  }, [phase, miss, finish])

  const flashNow = (ok) => { clearTimeout(flashT.current); setFlash(ok ? 'ok' : 'bad'); flashT.current = setTimeout(() => setFlash(null), 220) }

  const answer = useCallback((value) => {
    if (phase !== 'play' || miss || !card || lockRef.current === card.index) return
    lockRef.current = card.index
    const r = runRef.current
    const ok = value === card.shares
    const combo = ok ? r.combo + 1 : 0
    const row = { ok, value, mistake: ok ? null : mistakeOf(card, value), shares: card.shares, account: card.account, riskBps: card.riskBps }
    const next = { ...r, answered: r.answered + 1, right: r.right + (ok ? 1 : 0), combo, best: Math.max(r.best, combo),
      score: r.score + (ok ? pointsFor(combo) : 0), results: [...r.results, ok], log: [...r.log, row] }
    runRef.current = next
    setRun(next)
    revealFeedback(ok, prefs)
    flashNow(ok)
    if (ok) { comboFeedback(combo, prefs); setI((v) => v + 1) } else setMiss({ card, value })
  }, [phase, miss, card, prefs])

  const nextCard = () => { setMiss(null); setI((v) => v + 1) }

  // number keys pick a tile while a card is up (Enter belongs to the takeover's own button)
  useEffect(() => {
    if (phase !== 'play' || miss || !card) return undefined
    const k = (e) => {
      if (e.repeat || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const n = +e.key - 1
      if (n >= 0 && n < card.choices.length) answer(card.choices[n].value)
    }
    window.addEventListener('keydown', k)
    return () => window.removeEventListener('keydown', k)
  }, [phase, miss, card, answer])

  const start = () => {
    const seed = Date.now()
    runNo.current += 1
    const fresh = { ...EMPTY_RUN, runId: runIdOf(seed, runNo.current), seed }
    runRef.current = fresh; leftRef.current = SIZE_SECS; lockRef.current = -1
    setRun(fresh); setLeft(SIZE_SECS); setI(0); setMiss(null); setLevel(null); setSaveFailed(null); setBestBefore(bestEver); setPhase('play')
  }

  if (phase === 'start') {
    return (
      <div className={s2.kit}>
        <StartArena plate="Size It" title="Size It" caption="How many shares?" testId="size-intro" startTestId="size-start" hotkey ready onStart={start}
          stakes={[{ v: 60, l: 'seconds', icon: 'clock' }, { v: '2%', l: 'max risk', icon: 'shield' }, { v: 'x5', l: 'top multiplier', icon: 'bolt' }]}
          label="Start the clock" lead={<>{LESSON} Every card is a long trade sized on our rule.</>}
          reward={<><UIcon name="star" size={22} /><span>Your best <b data-testid="size-best">{bestEver}</b> points</span></>}
          howTo={<HowItPlays mode="size" testId="size-howto" steps={[
            { icon: 'dollar', title: 'Read the card', body: 'An account, the risk per trade (0.25% to 2%), a long entry and its stop.' },
            { icon: 'ruler', title: 'Size it', body: 'Dollars at risk, divided by the risk a share (entry minus stop), rounded down. Tap the size or press its number.' },
            { icon: 'bolt', title: 'Build the multiplier', body: 'Right answers in a row climb it to x5. A miss resets it and shows the working; the clock waits while you read.' },
          ]} />}>
          <span>Fresh cards every run · warm-up first, then any price to the cent</span>
        </StartArena>
      </div>
    )
  }

  if (phase === 'done') {
    const rows = run.log.map((r) => ({
      name: `${sharesText(r.shares)} shares`, ticker: `${dollars(r.account)} at ${riskPctText(r.riskBps)}`, ok: r.ok,
      said: r.ok ? null : `${sharesText(r.value)}${r.mistake ? `, ${MISTAKES[r.mistake].short}` : ''}`, was: '',
    }))
    const newBest = run.score > 0 && run.score > bestBefore
    const signed = saveFailed && isSignedOut(saveFailed)
    return (
      <div className={`${s2.kit} ${g.end}`}>
        <EndHard right={run.right} total={run.answered} xp={run.score} xpLabel="points" results={run.results} log={rows} level={level}
          title={sizeVerdict(run.right, run.answered)} unit="sized right in sixty seconds" doneWord="right" medal={false} showSetups={false}
          againLabel="Again" testIdPrefix="size" onAgain={() => setPhase('start')} onBack={onClose}>
          <span className={g.note} data-testid="size-best-line">
            {newBest ? <><b>A new best.</b> Top multiplier x{sizeMult(run.best)}.</> : <>Your best stands at <b>{bestEver}</b>. Top multiplier this run x{sizeMult(run.best)}.</>}
          </span>
          <span className={g.note} data-testid="size-slip">{slipLine(run.log)}</span>
          {signed ? <span className={g.saved} data-testid="size-not-saved">You are signed out, so this run's XP was not saved.</span> : null}
        </EndHard>
        {signed && signedOut ? <div className={g.signIn}>{signedOut}</div> : null}
      </div>
    )
  }

  if (!card) return null
  const n = i + 1
  return (
    <div className={`${s2.kit} ${s2.screen}`} data-testid="size-play">
      {flash ? <span className={`${s2.flash} ${flash === 'ok' ? s2.ok : s2.bad}`} aria-hidden="true" /> : null}
      {miss ? (
        <VerdictTakeover ok={false} title={missTitle(miss.card, miss.value)} answer={`${sharesText(miss.card.shares)} shares`}
          sub={<Working card={miss.card} value={miss.value} />} label="Next card" onContinue={nextCard} testId="size-takeover" />
      ) : null}
      <HudClock left={left} secs={SIZE_SECS} score={run.score} combo={run.combo} mult={sizeMult(run.combo)} label="Size It" live={!miss} />
      <div key={`card-${i}`} className={g.deal}>
        <TradeCard card={card} n={n} />
        <AnswerLessonApp instant choices={card.choices.map((c) => sharesText(c.value))} onPick={(k) => answer(card.choices[k].value)}
          eyebrow={<>Size It · card {n} · {card.levelName}</>} question="How many shares do you buy?"
          detail={phone ? null : <>Whole shares, <b>rounded down</b>: the loss at the stop must stay inside your risk.</>} cardsTestId="size-choices" />
      </div>
    </div>
  )
}
