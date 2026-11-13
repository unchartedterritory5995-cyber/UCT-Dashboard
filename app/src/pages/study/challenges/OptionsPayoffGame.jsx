// OPTIONS PAYOFF (docs/study/GAMES.md §3, kind 'payoff'; the owner picked it 2026-11-08: "Options Payoff + Earnings
// Desk"). Six positions, three hearts: a long call, a long put, a cash-secured put, a covered call, a bull call debit
// spread and a bear call credit spread, one of each in a seeded order. The position is said plainly and the stock's price
// on expiry day is given; the member picks the profit or loss from four tiles built on two of the three classic slips
// (forgot the x100, left out the premium, the sign flipped), seeded per position: the right amount, each slip alone and
// both together, so the pattern of the amounts never points at the answer (rule 10). Check takes over the screen (rule 15)
// with the verdict and one line: the rule on a right answer; the slip or slips named, with the numbers, and the hearts
// left on a miss. The run's log names the slip beside what was said. It stays that short on purpose, the
// shape Hard mode, Size It and Order Ticket use: the kit's takeover is a fixed, centred box that cannot scroll, so a longer
// verdict pushes its only button off a phone's screen. The review then draws the payoff at expiry as a gold line with the
// breakeven and the expiry price marked (a finger, the mouse or the arrow keys read any price along it), and the coach's
// card gives the working: intrinsic value at expiry, minus or plus the premium, times 100, then the rule and its course
// unit. Every number is the pure module's (games/optionsPayoff.js), unit tested by hand. The stock is a practice stock
// with no ticker, so no market fact is invented. The run reports itself once at the end (POST /api/study/game-runs) and
// the end screen's level bar shows what the server granted; a failed report leaves the end screen whole, without the bar,
// and says the XP did not save; an answer for an earlier run never lands on a later one. The best run lives on this device.
//
// The one design (OWNER_PRINCIPLES rule 21): Hard mode's start arena, status line (the hearts beside it, as in Order
// Ticket), answer tiles, verdict takeover, coach's card and end screen. The kit lacks only the position ticket and the
// payoff drawing: those are OptionsPayoffGame.module.css, on the kit's own tokens and colours.
import { useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudCombo } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import { Medal } from '../ui/Medal'
import Prompt from '../ui/Prompt'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import VerdictTakeover from '../ui/VerdictTakeover'
import { Confetti } from '../ui/Stage'
import s from '../ui/study.module.css'
import { showChart } from './replayTicks'
import { isSignedOut } from './ChallengeError'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import {
  PAYOFF_BEST_KEY, PAYOFF_HEARTS, PAYOFF_KIND, PAYOFF_TOTAL, bare, buildRun, fmtPL, headlineOf, heartsLeft, mistakeLine,
  freeSpot, mistakeOf, payoffChart, plAt, price, priceAt, runIdOf, runOver, slipOf,
} from './games/optionsPayoff'
import g from './OptionsPayoffGame.module.css'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: PAYOFF_KIND, title: 'Options Payoff', sub: 'Six positions, three hearts. Price each one at expiry.', icon: 'dollar', plate: 'Payoff', accent: 'gold', group: 'skill' }

const GAME_RUNS_URL = '/api/study/game-runs'
const readBest = () => { try { return Number(localStorage.getItem(PAYOFF_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(PAYOFF_BEST_KEY, String(v)) } catch { /* no storage */ } }
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
/** The six positions for a seed. The generator never fails on any seed tried (tests and a 60,000-seed sweep), but a
 *  throw here would blank the screen mid-game, so it lands as an empty run, which shows an honest note and a way back. */
const dealRun = (seed) => { try { return buildRun(seed) } catch { return [] } }

/** The hearts, in the kit's look (Order Ticket's): a gold shield for each one left, a dim one for each one lost. */
function Hearts({ left, total = PAYOFF_HEARTS }) {
  return (
    <span className={g.hearts} role="img" aria-label={`${plural(left, 'heart')} left`} data-testid="payoff-hearts" data-left={left}>
      {Array.from({ length: total }, (_, i) => (
        <i key={i} className={`${g.heart} ${i < left ? g.heartOn : g.lost}`}><UIcon name="shield" size={20} gold={false} /></i>
      ))}
    </span>
  )
}

/** The drawing's width in screen pixels, so its labels draw at their real size at any width (a fallback before the first
 *  measure, and wherever there is no ResizeObserver). */
function useBoxWidth(ref, fallback) {
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => {
      const cw = Math.round(entries[0]?.contentRect?.width || 0)
      if (cw > 0) setW(cw)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return Math.max(260, Math.min(960, w))
}

const box = (x, y, w, h) => ({ x, y, w, h })
/** How far one arrow key moves the reading along the drawing: a thirtieth of its width (always at least a nickel). */
const KEY_STEP = 1 / 30

/** The payoff at expiry: x is the stock's price on expiry day, y the position's P/L. Before the answer, only the strikes
 *  and the expiry price; after it, the line draws with the breakeven and the P/L at the expiry price, and a finger, the
 *  mouse or the arrow keys (the drawn chart is a slider) read the P/L at any price along it. The labels live outside the
 *  plot (the expiry price and its P/L in the top margin, the strikes and then the breakeven under the axis), so none can
 *  ever sit on the line, at any width; only the faint Profit and Loss words go inside, and only where there is open space. */
function PayoffPlot({ pos, revealed, drawn, phone }) {
  const chart = useMemo(() => payoffChart(pos), [pos])
  const [hover, setHover] = useState(null)
  const figRef = useRef(null)
  const W = useBoxWidth(figRef, phone ? 320 : 520)
  const B = drawn ? 52 : 32
  const H = (revealed ? (phone ? 210 : 240) : (phone ? 150 : 220)) + (drawn ? 20 : 0)
  const L = 60, R = 12, T = 30
  const pw = W - L - R, ph = H - T - B
  const X = (c) => L + ((c - chart.x0) / (chart.x1 - chart.x0)) * pw
  const Y = (d) => T + ((chart.y1 - d) / (chart.y1 - chart.y0)) * ph
  const zeroY = revealed ? Y(0) : T + ph / 2
  const ex = X(pos.expiry)
  const exY = Y(pos.pl)
  const within = (x, half) => Math.max(L + half, Math.min(W - R - half, x))
  const pts = chart.points.map((q) => ({ x: X(q.x), y: Y(q.y) }))
  const line = pts.map((q, i) => `${i ? 'L' : 'M'} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(' ')
  const be = X(pos.breakeven)
  const bounds = { x0: L + 2, y0: T + 2, x1: W - R - 2, y1: T + ph - 2 }
  const marks = [box(ex - 9, exY - 9, 18, 18), box(be - 8, zeroY - 8, 16, 16)]
  const profitWord = zeroY - T > 26 ? freeSpot([box(L + 8, T + 5, 54, 13), box(W - R - 62, T + 5, 54, 13)], { boxes: marks, bounds, points: pts, strict: true, pad: 4 }) : null
  const lossWord = T + ph - zeroY > 26 ? freeSpot([box(L + 8, T + ph - 18, 40, 13), box(W - R - 48, T + ph - 18, 40, 13)], { boxes: marks, bounds, points: pts, strict: true, pad: 4 }) : null
  const expLabel = `Expiry ${price(pos.expiry)}`
  const plLabel = fmtPL(pos.pl)
  const topText = drawn ? `${expLabel} · ${plLabel}` : expLabel
  const beLabel = `Breakeven ${price(pos.breakeven)}`
  const two = pos.strikes.length > 1
  const read = (e) => {
    if (!drawn) return
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width) return
    setHover(priceAt(chart, ((((e.clientX - r.left) / r.width) * W) - L) / pw))
  }
  const at = hover ?? pos.expiry
  const atPL = plAt(pos, at)
  // the arrow keys walk the reading along the line (Home and End jump to its ends), never past the drawing
  const nudge = (e) => {
    if (!drawn || e.altKey || e.ctrlKey || e.metaKey) return
    const share = (at - chart.x0) / (chart.x1 - chart.x0)
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? priceAt(chart, share + KEY_STEP)
      : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? priceAt(chart, share - KEY_STEP)
        : e.key === 'Home' ? chart.x0 : e.key === 'End' ? chart.x1 : null
    if (next == null) return
    e.preventDefault()
    setHover(next)
  }
  const aria = revealed
    ? `Payoff at expiry. Breakeven ${price(pos.breakeven)}. At ${price(pos.expiry)} the position makes ${plLabel}.`
    : `The strike${two ? 's' : ''} ${pos.strikes.map((k) => bare(k)).join(' and ')} and the stock's price at expiry, ${price(pos.expiry)}.`
  const slider = drawn
    ? { role: 'slider', tabIndex: 0, 'aria-valuemin': chart.x0 / 100, 'aria-valuemax': chart.x1 / 100, 'aria-valuenow': at / 100, 'aria-valuetext': `At ${price(at)} on expiry day: ${fmtPL(atPL)}`, onKeyDown: nudge, onBlur: () => setHover(null) }
    : { role: 'img' }
  return (
    <figure className={g.plot} ref={figRef} data-testid="payoff-plot" data-drawn={drawn ? '1' : '0'}>
      <svg viewBox={`0 0 ${W} ${H}`} className={g.svg} aria-label={aria} {...slider} onPointerMove={read} onPointerDown={read} onPointerLeave={() => setHover(null)}>
        {revealed ? (
          <>
            {zeroY > T ? <rect x={L} y={T} width={pw} height={Math.max(0, zeroY - T)} className={g.zoneUp} /> : null}
            {zeroY < T + ph ? <rect x={L} y={zeroY} width={pw} height={Math.max(0, T + ph - zeroY)} className={g.zoneDown} /> : null}
            {chart.ticks.filter((t) => t !== 0).map((t) => (
              <g key={t}>
                <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className={g.grid} />
                <text x={L - 8} y={Y(t) + 4} className={g.yTick}>{fmtPL(t)}</text>
              </g>
            ))}
          </>
        ) : null}
        <line x1={L} x2={W - R} y1={zeroY} y2={zeroY} className={g.zero} />
        <text x={L - 8} y={zeroY + 4} className={g.yTick}>$0</text>
        <line x1={L} x2={W - R} y1={T + ph} y2={T + ph} className={g.axis} />
        {pos.strikes.map((k, i) => {
          const x = X(k)
          const anchor = two ? (i === 0 ? 'end' : 'start') : 'middle'
          const tx = two ? (i === 0 ? x + 4 : x - 4) : within(x, 34)
          return (
            <g key={k}>
              <line x1={x} x2={x} y1={T} y2={T + ph} className={g.strikeLine} />
              <line x1={x} x2={x} y1={T + ph} y2={T + ph + 5} className={g.axis} />
              <text x={tx} y={T + ph + 19} textAnchor={anchor} className={g.xTick}>{bare(k)} strike</text>
            </g>
          )
        })}
        <line x1={ex} x2={ex} y1={T - 4} y2={T + ph} className={g.expiryLine} />
        <text x={within(ex, topText.length * 3.5 + 4)} y={T - 10} textAnchor="middle" className={g.expiryText} data-testid="payoff-expiry">
          {expLabel}{drawn ? <tspan className={pos.pl >= 0 ? g.upFill : g.downFill}>{` · ${plLabel}`}</tspan> : null}
        </text>
        {!revealed ? (
          <g className={g.ask}>
            <circle cx={ex} cy={zeroY} r={15} />
            <text x={ex} y={zeroY + 6} textAnchor="middle">?</text>
          </g>
        ) : null}
        {drawn ? (
          <>
            {profitWord ? <text x={profitWord.x} y={profitWord.y + profitWord.h - 2} className={g.zoneWord}>Profit</text> : null}
            {lossWord ? <text x={lossWord.x} y={lossWord.y + lossWord.h - 2} className={g.zoneWord}>Loss</text> : null}
            <path d={line} className={g.line} pathLength="1" data-testid="payoff-line" />
            <g className={g.mark}>
              <line x1={be} x2={be} y1={zeroY} y2={T + ph + 5} className={g.beGuide} />
              <circle cx={be} cy={zeroY} r={5} className={g.beDot} />
              <text x={within(be, beLabel.length * 3.3 + 4)} y={T + ph + 40} textAnchor="middle" className={g.beText} data-testid="payoff-breakeven">{beLabel}</text>
            </g>
            <g className={g.mark}>
              <circle cx={ex} cy={exY} r={6.5} className={g.exDot} />
            </g>
            {hover != null ? (
              <g className={g.cross} aria-hidden="true">
                <line x1={X(hover)} x2={X(hover)} y1={T} y2={T + ph} />
                <circle cx={X(hover)} cy={Y(plAt(pos, hover))} r={4.5} />
              </g>
            ) : null}
          </>
        ) : null}
      </svg>
      <figcaption className={g.readout} data-testid="payoff-readout">
        {drawn
          ? <><span>At <b>{price(at)}</b> on expiry day: <b className={atPL >= 0 ? g.up : g.down}>{fmtPL(atPL)}</b></span><small>{phone ? 'Slide along the chart to read any price.' : 'Slide along the chart, or use the arrow keys, to read any price.'}</small></>
          : <span>Where the stock closed on expiry day, against the strike{two ? 's' : ''}.</span>}
      </figcaption>
    </figure>
  )
}

/** The position, said plainly: the ticket beside its payoff drawing. */
function Board({ pos, state, drawn, phone, boxRef }) {
  return (
    <div className={`${s.heroChart} ${g.board}`} ref={boxRef} data-testid="payoff-board">
      <div className={g.ticket}>
        <div className={g.top}>
          <span className={g.plate}>{pos.title}</span>
        </div>
        <p className={g.sentence} data-testid="payoff-position">{pos.sentence}</p>
        {pos.legs.length > 1 ? (
          <ul className={g.legs} aria-label="The legs">
            {pos.legs.map((l) => (
              <li key={l.what}><b className={l.side === 'Sell' ? g.sell : g.buy}>{l.side}</b><span>{l.what}</span>{l.at ? <em>{l.at}</em> : null}</li>
            ))}
            <li className={g.net}><span>Net</span><em>{pos.net}</em></li>
          </ul>
        ) : null}
        {pos.note ? <p className={g.note}>{pos.note}</p> : null}
        <p className={g.context}>{pos.context}</p>
      </div>
      <PayoffPlot key={pos.id} pos={pos} revealed={state !== 'ask'} drawn={drawn} phone={phone} />
    </div>
  )
}

/** The working, in a coach's card (the kit's): the mistake named on a miss, the steps, the rule and its course unit. */
function Working({ pos, ok, mistake }) {
  return (
    <section className={s.coach} data-testid="payoff-working" aria-label="The working">
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>The working</span>
          <h3 className={s.coachTitle}>{ok ? 'How it adds up' : `How to get ${pos.answer}`}</h3>
        </div>
        <span className={s.tag}><b>{pos.title}</b></span>
      </header>
      {!ok && mistake ? <p className={g.mistake} data-testid="payoff-mistake">{mistakeLine(pos, mistake)}</p> : null}
      <ol className={s.steps}>
        {pos.working.map((w, i) => <li key={i}><i>{i + 1}</i><span>{w}</span></li>)}
      </ol>
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>The rule</span>
        <p className={g.rule}>{pos.rule}</p>
        <span className={g.source}>From the course · {pos.unit} {pos.unitName}</span>
      </div>
    </section>
  )
}

function Q({ idx, pos, results, prefs, onDone }) {
  const phone = useIsPhone()
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')       // ask | ok | bad
  const [takeover, setTakeover] = useState(false) // the verdict holds the whole screen until the member opens the review
  const boxRef = useRef(null)
  const rootRef = useRef(null)
  // each position opens at its top (the status line and the position), never where the last Next or Start was pressed
  useEffect(() => { try { rootRef.current?.scrollIntoView?.({ block: 'start' }) } catch { /* an old engine without options */ } }, [])
  const choices = pos.labels
  const picked = pick == null ? null : choices[pick]
  const mistake = state === 'ask' || picked == null ? null : mistakeOf(pos, picked)
  const ok = state === 'ok'
  const shown = state === 'ask' ? results : [...results, ok]
  const hearts = heartsLeft(shown)
  const last = state !== 'ask' && runOver(shown)
  const check = () => {
    if (pick == null || state !== 'ask') return
    const right = mistakeOf(pos, choices[pick]) === 'right'
    setState(right ? 'ok' : 'bad'); setTakeover(true); revealFeedback(right, prefs)
  }
  // the number keys pick a tile; Enter is the action button's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    if (state !== 'ask') return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const i = Number(e.key) - 1
      if (Number.isInteger(i) && i >= 0 && i < choices.length) setPick(i)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, choices.length])
  const headline = state === 'ask' ? '' : headlineOf(pos, mistake)
  const heartLine = hearts > 0 ? `${plural(hearts, 'heart')} left` : 'Out of hearts'
  // the takeover holds the verdict and one line (it cannot scroll, and its one button must stay on a phone's screen):
  // the rule on a right answer; on a miss, the mistake named and the hearts. The working is the review's coach card.
  const tkSub = ok
    ? <span className={g.tkRule} data-testid="payoff-takeover-rule">{pos.rule}</span>
    : (
      <>
        <span className={g.tkWhy} data-testid="payoff-takeover-why">{mistakeLine(pos, mistake)}</span>
        <span className={g.tkHearts} data-testid="payoff-takeover-hearts">{heartLine}</span>
      </>
    )
  const promptSub = ok
    ? <><b>{pos.answer}</b> at {price(pos.expiry)} · {pos.title}</>
    : <>The answer was <b>{pos.answer}</b> · you said {picked} · {heartLine}</>
  return (
    <div className={`${s.kit} ${s.screen}`} ref={rootRef} data-testid="payoff-question" data-state={state}>
      {state !== 'ask' ? <span className={`${s.flash} ${ok ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {state !== 'ask' && takeover ? (
        <VerdictTakeover ok={ok} title={headline} answer={ok ? picked : pos.answer} sub={tkSub} stampWord={ok ? 'Priced' : null}
          label="See the payoff" onContinue={() => { setTakeover(false); showChart(boxRef.current) }} testId="payoff-takeover" />
      ) : null}
      <div className={g.hudRow}>
        <HudCombo label="Payoff" unit="position" scoreWord="right" step={idx} total={PAYOFF_TOTAL} results={shown} live={state === 'ask'} stepTestId="payoff-step" />
        <Hearts left={hearts} />
      </div>
      <Board pos={pos} state={state} drawn={state !== 'ask' && !takeover} phone={phone} boxRef={boxRef} />
      <AnswerLessonApp choices={choices} pick={pick} state={state} answer={state === 'ask' ? null : pos.answer} step={idx} total={PAYOFF_TOTAL} hotkey={!takeover}
        eyebrow={<>Position {idx + 1} of {PAYOFF_TOTAL} · {plural(hearts, 'heart')}</>} question={pos.question} detail={pos.detail}
        onPick={(i) => { if (state === 'ask') { setPick(i); tapFeedback(prefs) } }} onCheck={check}
        onNext={() => onDone(ok, picked)} nextLabel={last ? 'See the run' : 'Next'}
        head={<Prompt mood={ok ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={headline} sub={promptSub}
          seal={<Stamp ok={ok} word={ok ? 'Priced' : null} inline />} />}
        cardsTestId="payoff-cards" checkTestId="payoff-check" nextTestId="payoff-next" />
      {state !== 'ask' && !takeover ? <Working pos={pos} ok={ok} mistake={mistake} /> : null}
    </div>
  )
}

export default function OptionsPayoffGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')     // start | play | done
  const [seed, setSeed] = useState(null)
  const [i, setI] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  const [xp, setXp] = useState(null)              // the server's answer to the run: { gained, before, after } or { failed, out }
  const [best, setBest] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0) // the best as this run began, so the end screen says "a new best" only when it is
  const alive = useRef(true)
  const current = useRef(null)                    // the run on screen: a late answer for an older run is dropped
  const posted = useRef(null)                     // the run already reported: one post per run, whatever presses Next twice
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const run = useMemo(() => (seed == null ? [] : dealRun(seed)), [seed])

  // the component seeds once at start (GAMES.md §1.7); the pure module never reads the clock
  const start = () => {
    const sd = Date.now()
    current.current = sd; posted.current = null
    setSeed(sd); setI(0); setResults([]); setLog([]); setXp(null); setBestBefore(best); setPhase('play')
  }

  const finish = (all) => {
    const right = all.filter(Boolean).length
    const total = all.length
    const mine = seed
    setPhase('done'); endFeedback(prefs)
    if (right > best) { setBest(right); writeBest(right) }
    if (posted.current === mine) return
    posted.current = mine
    // the run's XP, once (the server is idempotent on run_id too); whatever it answers, the end screen is already up
    Promise.resolve()
      .then(() => fetcher(GAME_RUNS_URL, { method: 'POST', body: { kind: PAYOFF_KIND, run_id: runIdOf(mine), right, total } }))
      .then((r) => {
        if (!alive.current || current.current !== mine) return
        const after = r?.progress?.xp
        const gained = Number(r?.xp_gained ?? r?.progress?.xp_gained ?? 0)
        setXp(typeof after === 'number' && Number.isFinite(after) && Number.isFinite(gained) ? { gained, before: after - gained, after } : { failed: true, out: false })
      })
      .catch((e) => { if (alive.current && current.current === mine) setXp({ failed: true, out: isSignedOut(e) }) })
  }

  if (phase === 'start') {
    return (
      <div className={s.kit} style={{ padding: '26px 0 34px' }}>
        <StartArena plate="Payoff" title="Options Payoff" caption="Profit or loss at expiry?" testId="payoff-intro" startTestId="payoff-start" hotkey
          total={PAYOFF_TOTAL} ready onStart={start} label="Start"
          stakes={[{ v: PAYOFF_TOTAL, l: 'positions', icon: 'document' }, { v: PAYOFF_HEARTS, l: 'hearts', icon: 'shield' }, { v: 'x100', l: 'a contract', icon: 'dollar' }]}
          lead="A call, a put, a covered call or a spread, and where the stock closed on expiry day. What did you make or lose?"
          reward={<><Medal size={40} testId={null} /><span><b>{PAYOFF_TOTAL} for {PAYOFF_TOTAL}</b> lights the Legendary medal · your best <b data-testid="payoff-best">{best}</b></span></>}
          howTo={<HowItPlays mode="payoff" testId="payoff-howto" steps={[
            { icon: 'document', title: 'Read the position', body: 'Six trades on a practice stock: calls, puts, a covered call and two spreads. One contract is 100 shares.' },
            { icon: 'dollar', title: 'Price it at expiry', body: 'You get the closing price on expiry day. Pick your profit or loss, fees left out. Number keys pick, Enter checks.' },
            { icon: 'equity', title: 'Watch the payoff draw', body: 'The payoff line draws with its breakeven. Miss one and you see the working. Three misses end the run.' },
          ]} />} />
      </div>
    )
  }

  if (phase === 'done') {
    // a run the hearts ended early is scored on the positions played; the medal line shows only on a full run of six
    const right = results.filter(Boolean).length
    const total = results.length
    const perfect = total === PAYOFF_TOTAL && right === total
    const outOfHearts = heartsLeft(results) === 0
    const newBest = right > 0 && right > bestBefore
    const level = xp && !xp.failed ? { before: xp.before, after: xp.after } : null
    const lost = !!xp?.failed
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s.kit} ${g.end}`}>
          <EndHard right={right} total={total} xp={xp?.gained || 0} results={results} log={log} level={level}
            title={outOfHearts ? 'Out of hearts' : null} unit="priced right" doneWord="right" showSetups={false} medal={total === PAYOFF_TOTAL}
            againLabel="Run it again" testIdPrefix="payoff" onAgain={start} onBack={onClose}>
            {perfect
              ? <>Six positions, six right. <b>You know the payoff cold.</b></>
              : outOfHearts
                ? <>The hearts ran out on position <b>{total}</b> of {PAYOFF_TOTAL}.{newBest ? <> <b>A new best</b> all the same: {right} priced right.</> : null} Intrinsic value at expiry, minus or plus the premium, then x100.</>
                : newBest
                  ? <><b>A new best:</b> {right} of {PAYOFF_TOTAL} priced right.</>
                  : <>Your best run stands at <b>{best}</b> of {PAYOFF_TOTAL}.</>}
            {lost ? (
              <span className={g.saved} data-testid="payoff-xp-failed">
                {xp.out ? 'You are signed out, so this run\'s XP did not save.' : 'This run\'s XP did not save.'}
              </span>
            ) : null}
          </EndHard>
          {lost && xp.out && signedOut ? <div className={g.signIn}>{signedOut}</div> : null}
        </div>
      </>
    )
  }

  const pos = run[i]
  if (!pos) {
    return (
      <div className={`${s.kit} ${g.empty}`} data-testid="payoff-empty">
        <p>These positions did not deal. Deal a fresh six, or head back to Study.</p>
        <div className={g.emptyGo}>
          <StudyButton kind="primary" size="xl" arrow onClick={start} testId="payoff-redeal">Deal again</StudyButton>
          <StudyButton kind="ghost" onClick={onClose}>Back to Study</StudyButton>
        </div>
      </div>
    )
  }
  return (
    <Q key={`${seed}-${i}`} idx={i} pos={pos} results={results} prefs={prefs}
      onDone={(ok, said) => {
        const all = [...results, !!ok]
        // a miss logs what was said and the slip or slips it made: "−$2.20 (wrong sign, forgot the x100)"
        const slip = ok ? '' : slipOf(mistakeOf(pos, said))
        const rows = [...log, { name: pos.title, ticker: `${pos.short} · ${price(pos.expiry)}`, ok: !!ok, said: ok ? null : (slip ? `${said} (${slip})` : said), was: pos.answer }]
        setResults(all); setLog(rows)
        if (runOver(all)) finish(all); else setI(i + 1)
      }} />
  )
}
