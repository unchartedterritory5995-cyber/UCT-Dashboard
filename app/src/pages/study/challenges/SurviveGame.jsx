// SURVIVE THE DRAWDOWN (docs/study/GAMES.md §3, kind 'survive'; the owner picked the catalogue 2026-11-08: "be creative
// and awesome"). One system, the course's own (F9.03: wins 40% at +2.5R, loses 60% at −1R, +0.4R a trade), and a
// $100,000 account. The member picks a risk per trade, 0.5%, 1%, 2%, 5% or 10%, and the same 50 trades play out: the
// account curve draws trade by trade in gold, the high-water mark and the fall under it drawn as it goes, the 50% line
// riding half a peak below, the trades lighting a strip of fifty marks. Then the other four picks join it, muted, on the
// same trades. Three questions follow on answer tiles: what the stretch's longest losing streak takes at a big risk (10%,
// or our 2% ceiling for a member who took 10%), how deep the member's own pick fell, and which fell 50% or more from its
// peak. (It used to ask which pick ended highest: on this bag that was 10% in about three runs in four, a lesson
// backwards. See games/survive.js.) The member's depth is asked before the 50% line's review lists every fall, and until
// it is checked nothing on screen states it as a percent: the board's head shows the losing streak, the line under the
// drawn curve gives the verdict, the slider reads the peak in dollars, and the streak question never shows that number. A
// pick over our 2% ceiling that stayed above the 50% line is "held this time", never "survived". Check takes over the
// screen (rule 15) with the verdict and one line; "See the working" opens the review: the chart marks the answer (what the
// streak took on its line, the member's peak and low, each fall across the line) and the coach's card gives the working,
// the rule and where it comes from (F9.01, F9.03, F9.04, our sizing rule). The end screen carries the run log, the
// stretch's win count and longest losing streak, the member's own line, the same game played 10,000 times (on the
// promised bag and on one a little worse, since nobody knows their real edge for sure), and the rule: 0.25% to 2% a
// trade, 2% the ceiling.
//
// Every number is games/survive.js's, from the seed taken once at Start. The run reports itself once at the end (POST
// /api/study/game-runs) and the end screen's level bar shows what the server granted; a failed report leaves the end
// screen whole, without the bar, and says the XP did not save; an answer for an earlier run never lands on a later one. A
// stretch that cannot be dealt is an honest empty state with a way back. The best run lives on this device.
//
// The one design (OWNER_PRINCIPLES rule 21): Hard mode's start arena, status line, answer tiles, verdict takeover, coach's
// card and end screen. The kit lacks only the account chart, the pick list, the small drawings in the working and the
// many-stretches panel: those are SurviveGame.module.css, on the kit's own tokens and colours.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudCombo } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import { Medal } from '../ui/Medal'
import { Confetti } from '../ui/Stage'
import Prompt from '../ui/Prompt'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import Tile from '../ui/Tile'
import VerdictTakeover from '../ui/VerdictTakeover'
import s from '../ui/study.module.css'
import { showChart } from './replayTicks'
import { isSignedOut } from './ChallengeError'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import {
  EDGE_TEXT, LESSON_RULE, LINE, LOSS_TEXT, PICKS, RULE_RANGE, WIN_TEXT, QUESTIONS, RULE_MAX_BPS, RULE_MIN_BPS, SOURCE_RULE, START, SURVIVE_BEST_KEY, SURVIVE_KIND, TRADES,
  WIN_PCT, atText, climbOf, countText, dealStretch, dollars, domainOf, edgeText, fallOf, fallsOf, firstRisk, headlineOf, isRight, kText, liveAt,
  manyPanel, peaksOf, pct, pickLabel, pickLine, pickOf, pickText, questionsFor, readoutAt, runFall, runIdOf, signedPct, spreadLabels, stretchLine,
  survivalLine, survivalTitle, ticksOf, verdictOf, whyLine, workingOf,
} from './games/survive'
import g from './SurviveGame.module.css'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: SURVIVE_KIND, title: 'Survive the Drawdown', sub: 'Five risk sizes, the same 50 trades. See which account survives.', icon: 'equity', plate: 'Survive', accent: 'red', group: 'skill' }

const GAME_RUNS_URL = '/api/study/game-runs'
/** One trade every 70 ms: fifty trades draw in three and a half seconds. */
export const TICK_MS = 70
const readBest = () => { try { return Number(localStorage.getItem(SURVIVE_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(SURVIVE_BEST_KEY, String(v)) } catch { /* no storage */ } }
const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches } catch { return false } }
const scrollTo = (el, block = 'start') => { try { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block, behavior: 'smooth' }) } catch { /* an old engine without options */ } }
/** The stretch for a seed. The generator has never failed on any seed tried (the tests and a 10,000-seed sweep, every
 *  pick dealing its three questions), but a throw here would blank the screen, so it lands as no stretch, which shows an
 *  honest note and a way back. */
const safeDeal = (seed) => { try { return dealStretch(seed) } catch { return null } }
const safeQuestions = (stretch, bps, seed) => { try { return questionsFor(stretch, bps, seed) } catch { return [] } }

/** The server's answer to the run, as the end screen's numbers, or null when it is not one (then the XP did not save). */
function levelOf(res) {
  const after = res?.progress?.xp
  const gained = Number(res?.xp_gained ?? res?.progress?.xp_gained ?? 0)
  return typeof after === 'number' && Number.isFinite(after) && Number.isFinite(gained) ? { gained, before: after - gained, after } : null
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
  return Math.max(280, Math.min(1100, w))
}

const pathOfPoints = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')

/** THE ACCOUNT CHART. x is the trade (0 is the start), y the account on a log scale, so equal falls look equal at any
 *  height: on the five-line chart every gridline is double the one below, and a 50% fall drops a full gridline. While the
 *  member's curve draws, the axis fits that curve alone (its whole 50, so it never jumps), the high-water mark runs
 *  behind it, the fall under the mark is tinted, and the 50% line rides half the mark below. With the others shown, the
 *  axis holds all five; the reveal marks what the question asked about. The streak question shades the streak's trades
 *  across all five lines, and its review marks what the streak took on the line it asked about (`streakAt`). The depth
 *  question asks about the member's own line, so it zooms back to that line alone (a 0.5% pick's 2% fall would be a flat
 *  line beside 10%), its peak and its low marked. Labels sit at the right end of each line, pushed apart so none
 *  overlaps. Once the curve has drawn, the chart is a slider: a finger, the mouse or the arrow keys read any trade of the
 *  member's line under it (the trade, its result, the account and how far under its peak). */
function Curves({ stretch, mine, step, showOthers, focus = null, revealed = false, fresh = false, fall = true, phone, streakAt = null }) {
  const figRef = useRef(null)
  const [hover, setHover] = useState(null)
  const W = useBoxWidth(figRef, phone ? 340 : 760)
  const H = phone ? 236 : 316
  const L = phone ? 48 : 58, R = phone ? 62 : 84, T = 16, B = 28
  const pw = W - L - R, ph = H - T - B
  const me = pickOf(stretch, mine)
  // the member's line alone: while it draws, and again for the question about it
  const solo = !showOthers || focus === 'deep'
  const series = useMemo(() => (solo ? stretch.picks.filter((p) => p.bps === mine) : stretch.picks), [stretch, mine, solo])
  const [lo, hi] = useMemo(() => domainOf(series.map((p) => p.balances), !solo), [series, solo])
  // doubling gridlines on the five-line chart, and on the member's own curve when it spans four times or more
  const doubling = !solo || hi / lo >= 4
  const ticks = useMemo(() => ticksOf(lo, hi, doubling), [lo, hi, doubling])
  const X = (i) => L + (i / stretch.n) * pw
  const Y = (v) => T + ((Math.log(hi) - Math.log(v)) / (Math.log(hi) - Math.log(lo))) * ph
  const upto = Math.max(0, Math.min(stretch.n, step))
  const mineBal = me.balances.slice(0, upto + 1)
  const peaks = peaksOf(mineBal)
  const minePath = pathOfPoints(mineBal.map((v, i) => [X(i), Y(v)]))
  const live = solo
  // the fall under the high-water mark, tinted: forward along the mark, back along the curve
  const under = live && upto > 0
    ? `${pathOfPoints(peaks.map((v, i) => [X(i), Y(v)]))} ${mineBal.map((v, i) => [X(i), Y(v)]).reverse().map((p) => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')} Z`
    : null
  const mark = live ? pathOfPoints(peaks.flatMap((v, i) => (i ? [[X(i - 1), Y(v)], [X(i), Y(v)]] : [[X(0), Y(v)]]))) : null
  // the 50% line rides half the running peak while the curve plays (not on the depth question, whose fall runs from
  // its own peak, not the highest one)
  const halfY = !showOthers ? Y(peaks[peaks.length - 1] * LINE) : null
  const showHalf = halfY != null && halfY <= T + ph - 2
  const head = [X(upto), Y(mineBal[mineBal.length - 1])]
  // the labels at the right end of every line drawn
  const ends = series.map((p) => ({ bps: p.bps, y: Y(p.bps === mine ? mineBal[mineBal.length - 1] : p.final), mine: p.bps === mine }))
  const spread = spreadLabels(ends.map((e) => e.y), 14, T + 4, T + ph)
  const endX = head[0]
  const xTicks = [0, 10, 20, 30, 40, 50].filter((t) => t <= stretch.n)
  const d = me.deep
  const deepFocus = focus === 'deep' && showOthers
  // the streak question: the streak's trades shaded on every line; once checked, its cost marked on the line it asked about
  const sk = stretch.streak
  const streakFocus = focus === 'streak' && showOthers && !solo && sk.length > 0
  const atLine = streakFocus && streakAt != null ? pickOf(stretch, streakAt) : null
  const atMark = atLine && revealed ? {
    x1: X(sk.from - 1), x2: X(sk.to), y1: Y(atLine.balances[sk.from - 1]), y2: Y(atLine.balances[sk.to]), value: runFall(streakAt, sk.length),
  } : null
  // the peak's label above its dot (beside it when the top is near), the low's below (beside it when the axis is near);
  // each turns to the left of its dot when the right edge is near
  const place = (x, y, above) => {
    const room = above ? y - 10 >= T + 2 : y + 18 <= T + ph - 2
    const right = x + 120 <= W - R
    return { x: room ? (right ? Math.max(L + 4, x - 6) : x) : (right ? x + 9 : x - 9), y: room ? (above ? y - 10 : y + 18) : y + 4, anchor: right ? 'start' : 'end' }
  }
  const peakTx = place(X(d.peakAt), Y(d.peak), true)
  const lowTx = place(X(d.lowAt), Y(d.low), false)
  const lineFocus = focus === 'line' && showOthers && revealed
  const crossers = lineFocus ? stretch.picks.filter((p) => p.deep.dd >= LINE) : []
  const brackets = lineFocus ? (crossers.length ? crossers : [stretch.picks[stretch.picks.length - 1]]) : []
  // once drawn, the chart reads any trade: the pointer's trade, or the arrow keys walking along the line
  const canRead = showOthers || upto >= stretch.n
  const read = (e) => {
    if (!canRead) return
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width) return
    const px = ((e.clientX - r.left) / r.width) * W
    setHover(Math.max(0, Math.min(stretch.n, Math.round(((px - L) / pw) * stretch.n))))
  }
  const at = hover ?? stretch.n
  const nudge = (e) => {
    if (!canRead || e.altKey || e.ctrlKey || e.metaKey) return
    const next = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? at + 1 : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? at - 1
      : e.key === 'Home' ? 0 : e.key === 'End' ? stretch.n : null
    if (next == null) return
    e.preventDefault()
    setHover(Math.max(0, Math.min(stretch.n, next)))
  }
  const slider = canRead
    ? { role: 'slider', tabIndex: 0, 'aria-valuemin': 0, 'aria-valuemax': stretch.n, 'aria-valuenow': at, 'aria-valuetext': readoutAt(stretch, mine, at, fall), onKeyDown: nudge, onBlur: () => setHover(null) }
    : { role: 'img' }
  const aria = deepFocus
    ? `Your account at ${pickText(mine)} over ${stretch.n} trades. Its peak ${dollars(d.peak)} ${atText(d.peakAt)}, its low after that ${dollars(d.low)} ${atText(d.lowAt)}.`
    : showOthers
      ? `The account for all five picks over ${stretch.n} trades. ${stretch.picks.map((p) => `${pickText(p.bps)} ended at ${dollars(p.final)}`).join('. ')}.`
        + (streakFocus ? ` The longest losing streak, trades ${sk.from} to ${sk.to}, is shaded.` : '')
      : `Your account at ${pickText(mine)}, trade ${upto} of ${stretch.n}: ${dollars(mineBal[mineBal.length - 1])}.`
  return (
    <figure className={g.plot} ref={figRef} data-testid="survive-chart" data-others={showOthers ? '1' : '0'} data-focus={focus || ''}>
      <svg viewBox={`0 0 ${W} ${H}`} className={`${g.svg} ${canRead ? g.reads : ''}`} aria-label={aria} {...slider}
        onPointerMove={read} onPointerDown={read} onPointerLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className={t === START ? g.startLine : g.grid} />
            <text x={L - 8} y={Y(t) + 4} className={g.yTick}>{kText(t)}</text>
          </g>
        ))}
        {ticks.includes(START) ? null : <line x1={L} x2={W - R} y1={Y(START)} y2={Y(START)} className={g.startLine} />}
        <line x1={L} x2={W - R} y1={T + ph} y2={T + ph} className={g.axis} />
        {xTicks.map((t) => (
          <text key={t} x={X(t)} y={T + ph + 18} textAnchor={t === 0 ? 'start' : t === stretch.n ? 'end' : 'middle'} className={g.xTick}>
            {t === 0 ? 'Start' : t === stretch.n && !phone ? `${t} trades` : t}
          </text>
        ))}
        {deepFocus && d.lowAt > d.peakAt ? (
          <rect x={X(d.peakAt)} y={T} width={Math.max(2, X(d.lowAt) - X(d.peakAt))} height={ph} className={g.window} data-testid="survive-window" />
        ) : null}
        {streakFocus ? (
          <rect x={X(sk.from - 1)} y={T} width={Math.max(2, X(sk.to) - X(sk.from - 1))} height={ph} className={g.window} data-testid="survive-streak-window" />
        ) : null}
        {under ? <path d={under} className={g.under} /> : null}
        {mark ? <path d={mark} className={g.mark} /> : null}
        {showHalf ? <line x1={L} x2={W - R} y1={halfY} y2={halfY} className={g.half} /> : null}
        {!solo ? stretch.picks.filter((p) => p.bps !== mine).map((p) => (
          <path key={p.bps} d={pathOfPoints(p.balances.map((v, i) => [X(i), Y(v)]))} pathLength="1"
            className={`${g.other} ${fresh ? g.drawIn : ''} ${atMark && p.bps === streakAt ? g.otherAt : ''}`}
            data-testid={`survive-line-${p.bps}`} />
        )) : null}
        <path d={minePath} className={g.mine} data-testid={`survive-line-${mine}`} />
        {atMark ? (
          <g className={`${g.bracket} ${g.bracketBad}`} data-testid="survive-streak-fall">
            <line x1={atMark.x1} x2={atMark.x2} y1={atMark.y1} y2={atMark.y1} className={g.bracketGuide} />
            <line x1={atMark.x2} x2={atMark.x2} y1={atMark.y1} y2={atMark.y2} />
            <circle cx={atMark.x1} cy={atMark.y1} r={3.5} />
            <circle cx={atMark.x2} cy={atMark.y2} r={3.5} />
            <text x={atMark.x2 + 60 > W - R ? atMark.x2 - 6 : atMark.x2 + 6} y={(atMark.y1 + atMark.y2) / 2 + 4}
              textAnchor={atMark.x2 + 60 > W - R ? 'end' : 'start'} className={g.bracketText}>
              {`−${pct(atMark.value)}`}
            </text>
          </g>
        ) : null}
        {!showOthers ? <circle cx={head[0]} cy={head[1]} r={5} className={g.headDot} /> : null}
        {/* the 50% line's name drawn over the curve, so a dip through it never hides it */}
        {showHalf ? <text x={L + 6} y={halfY - 5} className={g.halfText} data-testid="survive-half">50% line</text> : null}
        {brackets.map((p) => {
          const bx = X(p.deep.lowAt), y1 = Y(p.deep.peak), y2 = Y(p.deep.low)
          const crossed = p.deep.dd >= LINE
          return (
            <g key={p.bps} className={`${g.bracket} ${crossed ? g.bracketBad : g.bracketNear}`} data-testid={`survive-fall-${p.bps}`}>
              <line x1={X(p.deep.peakAt)} x2={bx} y1={y1} y2={y1} className={g.bracketGuide} />
              <line x1={bx} x2={bx} y1={y1} y2={y2} />
              <circle cx={X(p.deep.peakAt)} cy={y1} r={3.5} />
              <circle cx={bx} cy={y2} r={3.5} />
              <text x={bx + 60 > W - R ? bx - 6 : bx + 6} y={(y1 + y2) / 2 + 4} textAnchor={bx + 60 > W - R ? 'end' : 'start'} className={g.bracketText}>
                {`${'−'}${pct(fallOf(p.deep.peak, p.deep.low))}`}
              </text>
            </g>
          )
        })}
        {deepFocus ? (
          <g className={g.peakLow} data-testid="survive-peak-low">
            <circle cx={X(d.peakAt)} cy={Y(d.peak)} r={5} className={g.peakDot} />
            <text x={peakTx.x} y={peakTx.y} textAnchor={peakTx.anchor} className={g.peakText}>Peak {dollars(d.peak)}</text>
            <circle cx={X(d.lowAt)} cy={Y(d.low)} r={5} className={g.lowDot} />
            <text x={lowTx.x} y={lowTx.y} textAnchor={lowTx.anchor} className={g.lowText}>Low {dollars(d.low)}</text>
            {revealed ? (
              <g className={g.bracketBad}>
                <line x1={X(d.lowAt)} x2={X(d.lowAt)} y1={Y(d.peak)} y2={Y(d.low)} className={g.deepLine} />
                <line x1={X(d.peakAt)} x2={X(d.lowAt)} y1={Y(d.peak)} y2={Y(d.peak)} className={g.bracketGuide} />
                <text x={X(d.lowAt) + 60 > W - R ? X(d.lowAt) - 7 : X(d.lowAt) + 7} y={(Y(d.peak) + Y(d.low)) / 2 + 4}
                  textAnchor={X(d.lowAt) + 60 > W - R ? 'end' : 'start'} className={g.bracketText} data-testid="survive-deep-fall">
                  {`−${pct(fallOf(d.peak, d.low))}`}
                </text>
              </g>
            ) : null}
          </g>
        ) : null}
        {ends.map((e, k) => {
          const ly = spread[k]
          const lit = !!atMark && e.bps === streakAt
          return (
            <g key={e.bps} className={`${g.endLabel} ${e.mine ? g.endMine : ''} ${lit ? g.endAt : ''}`}>
              {Math.abs(ly - e.y) > 2 ? <line x1={endX + 2} x2={endX + 8} y1={e.y} y2={ly - 4} className={g.leader} /> : null}
              <text x={endX + 10} y={ly} data-testid={`survive-end-${e.bps}`}>{e.mine ? `You ${pickLabel(e.bps)}` : pickLabel(e.bps)}</text>
            </g>
          )
        })}
        {canRead && hover != null ? (
          <g className={g.cross} aria-hidden="true" data-testid="survive-cross">
            <line x1={X(hover)} x2={X(hover)} y1={T} y2={T + ph} />
            <circle cx={X(hover)} cy={Y(me.balances[hover])} r={4.5} />
          </g>
        ) : null}
      </svg>
      {canRead ? (
        <figcaption className={g.readout} data-testid="survive-readout">
          {hover != null
            ? <span><b className={g.readKey}>Your {pickLabel(mine)}</b> {readoutAt(stretch, mine, hover, fall)}</span>
            : <small>{phone ? 'Slide along the chart to read any trade.' : 'Slide along the chart, or use the arrow keys, to read any trade.'}</small>}
        </figcaption>
      ) : null}
    </figure>
  )
}

/** The fifty trades as a strip of marks, lit as they play: gold a winner, red a loser; the member's worst stretch ringed
 *  when the depth question asks about it. */
function Pips({ stretch, step, span = null }) {
  return (
    <div className={g.pips} role="img" aria-label={`${Math.min(step, stretch.n)} of ${stretch.n} trades played`} data-testid="survive-pips">
      {stretch.wins.map((w, i) => {
        const on = i < step
        const inWin = span && i >= span[0] && i < span[1]
        return <i key={i} className={`${g.pip} ${on ? (w ? g.pipWin : g.pipLoss) : ''} ${inWin ? g.pipWindow : ''}`} />
      })}
    </div>
  )
}

/** The head of the board while the curve draws: the trade, its result, the account, and how far under its peak. */
function LiveHead({ stretch, mine, step }) {
  const st = liveAt(stretch, mine, step)
  const fill = Math.min(1, st.under / LINE)
  return (
    <div className={g.boardHead} data-testid="survive-live">
      <div className={g.stat}>
        <span className={g.statLabel}>Trade</span>
        <b className={g.statBig} data-testid="survive-trade">{st.step}<small> of {stretch.n}</small></b>
      </div>
      <div className={g.stat}>
        <span className={g.statLabel}>Last trade</span>
        {st.last
          ? <b className={`${g.chip} ${st.last.win ? g.chipWin : g.chipLoss}`} data-testid="survive-last">{st.last.win ? WIN_TEXT : LOSS_TEXT} · {st.last.win ? '+' : '−'}{dollars(Math.abs(st.last.amount))}</b>
          : <b className={g.chip}>Ready</b>}
        {st.streak >= 2 ? <small className={g.streak} data-testid="survive-streak">{st.streak} losses in a row</small> : null}
      </div>
      <div className={g.stat}>
        <span className={g.statLabel}>Account</span>
        <b className={g.statBig} data-testid="survive-balance">{dollars(st.balance)}</b>
      </div>
      <div className={`${g.stat} ${g.meterStat}`}>
        <span className={g.statLabel}>{st.under > 0 ? 'Under the peak' : 'At its high'}</span>
        <span className={`${g.meter} ${st.under >= LINE ? g.meterBad : ''}`} aria-hidden="true"><i style={{ width: `${fill * 100}%` }} /><em /></span>
        <b className={g.meterText} data-testid="survive-under">{st.under > 0 ? `−${pct(st.under)}` : 'New high'}</b>
      </div>
    </div>
  )
}

/** The verdict chip's words, by verdictOf. */
const VERDICT_WORD = { survived: 'Survived', held: 'Held this time', fell: 'Fell past 50%' }

/** The head of the board once the curve has drawn: the pick, where it ended, the stretch's longest losing streak, and the
 *  verdict. The pick's worst fall is not here: the depth question asks for it on this same board. */
function DoneHead({ stretch, mine }) {
  const p = pickOf(stretch, mine)
  const verdict = verdictOf(p)
  const ok = verdict === 'survived'
  return (
    <div className={g.boardHead} data-testid="survive-result">
      <div className={g.stat}>
        <span className={g.statLabel}>Your pick</span>
        <b className={g.statBig}>{pickLabel(mine)}<small> a trade</small></b>
      </div>
      <div className={g.stat}>
        <span className={g.statLabel}>Ended at</span>
        <b className={g.statBig} data-testid="survive-final">{dollars(p.final)}</b>
        <small className={p.change >= 0 ? g.upText : g.downText}>{signedPct(p.change)}</small>
      </div>
      <div className={g.stat}>
        <span className={g.statLabel}>Losing streak</span>
        <b className={g.statBig} data-testid="survive-run">{stretch.streak.length}<small> in a row</small></b>
      </div>
      <div className={g.stat}>
        <span className={`${g.verdictChip} ${ok ? g.chipWin : g.chipLoss}`} data-testid="survive-verdict" data-verdict={verdict}>
          <UIcon name={ok ? 'shield' : 'warning'} size={16} gold={false} />{VERDICT_WORD[verdict]}
        </span>
      </div>
    </div>
  )
}

/** The board: the head, the chart, the strip of trades. */
function Board({ stretch, mine, step, showOthers, focus = null, revealed = false, fresh = false, fall = true, phone, head, boxRef = null, span = null, streakAt = null }) {
  return (
    <div className={`${s.heroChart} ${g.board}`} ref={boxRef} data-testid="survive-board">
      {head}
      <Curves stretch={stretch} mine={mine} step={step} showOthers={showOthers} focus={focus} revealed={revealed} fresh={fresh} fall={fall} phone={phone} streakAt={streakAt} />
      <div className={g.stripRow}>
        <Pips stretch={stretch} step={step} span={span} />
        <span className={g.legend}><i className={g.pipWin} />winner {WIN_TEXT} <i className={g.pipLoss} />loser {LOSS_TEXT}</span>
      </div>
    </div>
  )
}

/** The 50% line's working drawn: each pick's deepest fall as a bar, the 50% line across them. */
function FallBars({ stretch, mine }) {
  const falls = fallsOf(stretch)
  const top = Math.max(0.7, ...falls.map((f) => f.dd)) * 1.04
  return (
    <div className={g.bars} data-testid="survive-fall-bars" style={{ '--lf': LINE / top }}>
      {falls.map((f) => (
        <div key={f.bps} className={`${g.barRow} ${f.crossed ? g.barBad : ''} ${f.bps === mine ? g.barMine : ''}`}>
          <span className={g.barName}>{pickLabel(f.bps)}{f.bps === mine ? <small> you</small> : null}</span>
          <span className={g.barTrack}><i style={{ width: `${(f.dd / top) * 100}%` }} /></span>
          <b className={g.barVal}>{`−${pct(f.dd)}`}</b>
        </div>
      ))}
      <span className={g.barLine} aria-hidden="true"><em>50% line · needs +100% back</em></span>
    </div>
  )
}

/** The depth question's working drawn: the fall and the climb back on one scale, so the climb is visibly longer. */
function ClimbBars({ stretch, mine }) {
  const d = pickOf(stretch, mine).deep
  const fall = fallOf(d.peak, d.low), climb = climbOf(d.peak, d.low)
  const top = Math.max(fall, climb) * 1.04
  return (
    <div className={g.climb} data-testid="survive-climb">
      <div className={`${g.barRow} ${g.barBad}`}>
        <span className={g.barName}>Down</span>
        <span className={g.barTrack}><i style={{ width: `${(fall / top) * 100}%` }} /></span>
        <b className={g.barVal}>{`−${pct(fall)}`}</b>
      </div>
      <div className={`${g.barRow} ${g.barUp}`}>
        <span className={g.barName}>Back up</span>
        <span className={g.barTrack}><i style={{ width: `${(climb / top) * 100}%` }} /></span>
        <b className={g.barVal}>{signedPct(climb)}</b>
      </div>
    </div>
  )
}

/** The streak's working drawn: the account after each loss in a row, each step a share of what the last one left, so the
 *  steps shrink as the account does. */
function LossSteps({ q }) {
  const keep = 1 - q.at / 10000
  const cols = Array.from({ length: q.n + 1 }, (_, k) => keep ** k)
  return (
    <div className={g.lossSteps} data-testid="survive-loss-steps" role="img"
      aria-label={`The account after each of ${q.n} losses in a row at ${pickText(q.at)}: ${pct(q.left)} is left.`}>
      <div className={g.stepCols} style={{ '--cols': cols.length }}>
        {cols.map((v, k) => <span key={k} className={`${g.stepCol} ${k === 0 ? g.stepFirst : ''} ${k === q.n ? g.stepLast : ''}`}><i style={{ height: `${v * 100}%` }} /></span>)}
      </div>
      <div className={g.stepFoot}>
        <span>Start · 100%</span>
        <b>After {q.n} losses · {pct(q.left)} left</b>
      </div>
    </div>
  )
}

/** The working, in the kit's coach card: the mistake named on a miss, the steps, a drawing where one helps, and the rule
 *  with where it comes from. */
function Working({ q, stretch, mine, label, ok }) {
  const w = workingOf(q, stretch)
  return (
    <section className={s.coach} data-testid="survive-working" aria-label="The working">
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>The working</span>
          <h3 className={s.coachTitle}>{w.title}</h3>
        </div>
        <span className={s.tag}><b>{q.tag}</b></span>
      </header>
      {!ok ? <p className={g.mistake} data-testid="survive-mistake">{whyLine(q, stretch, label)}</p> : null}
      <ol className={s.steps}>
        {w.steps.map((st, i) => <li key={i}><i>{i + 1}</i><span>{st}</span></li>)}
      </ol>
      {q.key === 'streak' ? <LossSteps q={q} /> : null}
      {q.key === 'line' ? <FallBars stretch={stretch} mine={mine} /> : null}
      {q.key === 'deep' ? <ClimbBars stretch={stretch} mine={q.mine} /> : null}
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>The rule</span>
        <p className={g.rule}>{w.rule}</p>
        <span className={g.source}>{w.source}</span>
      </div>
    </section>
  )
}

/** The end screen's panel: the same game played 10,000 times on the promised bag and on one a little worse, every number
 *  manyPanel's (games/survive.js, pinned and recomputed by its test). The drawing is how many stretches fell by half or
 *  more for each pick on each bag; the lines read it the way a mentor would. */
function ManyPanel() {
  const m = manyPanel()
  const [big, small] = m.bags
  const said = m.rows.map((r) => `${pickText(r.bps)}: ${countText(r.big)} on ${big.label}, ${countText(r.small)} on ${small.label}`).join('. ')
  return (
    <section className={g.many} data-testid="survive-many" aria-label={m.eyebrow}>
      <span className={g.manyEyebrow}>{m.eyebrow}</span>
      <p className={g.manyTitle}>{m.title}</p>
      <div className={g.manyChart} data-testid="survive-many-bars" role="img" aria-label={`Fell by half or more, of ${countText(m.n)} stretches. ${said}.`}>
        <div className={g.manyHead} aria-hidden="true">
          <span>Fell by half or more</span>
          <span className={g.manyKey}><span><i className={g.keyBig} />{big.label}</span><span><i className={g.keySmall} />{small.label}</span></span>
        </div>
        {m.rows.map((r) => (
          <div key={r.bps} className={`${g.manyRow} ${r.bps > RULE_MAX_BPS ? g.manyOver : ''}`} data-testid={`survive-many-${r.bps}`} aria-hidden="true">
            <span className={g.barName}>{pickLabel(r.bps)}</span>
            <span className={g.manyTracks}>
              <span className={`${g.manyTrack} ${g.trackBig}`}>{r.big ? <i style={{ width: `${(r.big / m.n) * 100}%` }} /> : null}</span>
              <span className={`${g.manyTrack} ${g.trackSmall}`}>{r.small ? <i style={{ width: `${(r.small / m.n) * 100}%` }} /> : null}</span>
            </span>
            <span className={g.manyVals}><b>{countText(r.big)}</b><b>{countText(r.small)}</b></span>
          </div>
        ))}
      </div>
      <ul className={g.manyLines}>
        {m.lines.map((line, i) => <li key={i}>{line}</li>)}
      </ul>
      <span className={g.source}>{m.source}</span>
    </section>
  )
}

/** One question: the board marks the answer once it is checked; the tiles, the takeover, then the working. `fallKnown`:
 *  the depth question was checked on an earlier screen, so the slider may read the fall as a percent. */
function Question({ idx, q, stretch, mine, results, prefs, phone, fallKnown = false, onDone }) {
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')       // ask | ok | bad
  const [takeover, setTakeover] = useState(false) // the verdict holds the whole screen until the member opens the review
  const boxRef = useRef(null)
  const rootRef = useRef(null)
  // each question opens at its top (the status line and the chart), never where the last Next was pressed
  useEffect(() => { scrollTo(rootRef.current) }, [])
  const label = pick == null ? null : q.labels[pick]
  const ok = state === 'ok'
  const shown = state === 'ask' ? results : [...results, ok]
  const last = idx === QUESTIONS - 1
  const check = () => {
    if (pick == null || state !== 'ask') return
    const right = isRight(q, q.labels[pick])
    setState(right ? 'ok' : 'bad'); setTakeover(true); revealFeedback(right, prefs)
  }
  // the number keys pick a tile; Enter is the action button's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    if (state !== 'ask') return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const i = Number(e.key) - 1
      if (Number.isInteger(i) && i >= 0 && i < q.labels.length) setPick(i)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, q.labels.length])
  const headline = state === 'ask' ? '' : headlineOf(q, label)
  const why = state === 'ask' ? '' : whyLine(q, stretch, label)
  const d = pickOf(stretch, mine).deep
  // the strip rings the trades the question is about: the streak's, or the member's worst fall
  const span = q.key === 'streak' ? [q.from - 1, q.to] : q.key === 'deep' && d.lowAt > d.peakAt ? [d.peakAt, d.lowAt] : null
  const promptSub = ok
    ? <><b>{q.answer}</b> · {q.tag}</>
    : <>The answer was <b>{q.answer}</b> · you said {label}</>
  return (
    <div className={`${s.kit} ${s.screen}`} ref={rootRef} data-testid="survive-question" data-key={q.key} data-state={state}>
      {state !== 'ask' ? <span className={`${s.flash} ${ok ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {state !== 'ask' && takeover ? (
        <VerdictTakeover ok={ok} title={headline} answer={ok ? label : q.answer} stampWord={ok ? 'Read it' : null}
          sub={<span className={g.tkWhy} data-testid="survive-takeover-why">{why}</span>}
          label="See the working" onContinue={() => { setTakeover(false); showChart(boxRef.current) }} testId="survive-takeover" />
      ) : null}
      <HudCombo label="Survive" unit="question" scoreWord="right" step={idx} total={QUESTIONS} results={shown} live={state === 'ask'} stepTestId="survive-step" />
      <Board stretch={stretch} mine={mine} step={stretch.n} showOthers focus={q.key} revealed={state !== 'ask' && !takeover} fresh={idx === 0}
        fall={fallKnown || (q.key === 'deep' && state !== 'ask')} streakAt={q.key === 'streak' ? q.at : null}
        phone={phone} boxRef={boxRef} span={span} head={<DoneHead stretch={stretch} mine={mine} />} />
      <AnswerLessonApp choices={q.labels} pick={pick} state={state} answer={state === 'ask' ? null : q.answer} step={idx} total={QUESTIONS} hotkey={!takeover}
        eyebrow={<>Question {idx + 1} of {QUESTIONS} · {q.tag}</>} question={q.question} detail={q.detail}
        onPick={(i) => { if (state === 'ask') { setPick(i); tapFeedback(prefs) } }} onCheck={check}
        onNext={() => onDone(ok, label)} nextLabel={last ? 'See the run' : 'Next question'}
        head={<Prompt mood={ok ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={headline} sub={promptSub}
          seal={<Stamp ok={ok} word={ok ? 'Read it' : null} inline />} />}
        cardsTestId="survive-cards" checkTestId="survive-check" nextTestId="survive-next" />
      {state !== 'ask' && !takeover ? <Working q={q} stretch={stretch} mine={mine} label={label} ok={ok} /> : null}
    </div>
  )
}

/** The pick: the system on the left, the five risks on the right, our range bracketed. */
function PickScreen({ stretch, pick, setPick, onPlay, prefs, phone }) {
  // number keys 1 to 5 pick a risk (Enter is Play's own hotkey)
  useEffect(() => {
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const i = Number(e.key) - 1
      if (Number.isInteger(i) && i >= 0 && i < PICKS.length) setPick(PICKS[i])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setPick])
  const row = (bps, i) => (
    <Tile key={bps} n={i + 1} i={i} role="radio" checked={pick === bps} state={pick === bps ? 'sel' : 'idle'} testId={`survive-pick-${bps}`}
      className={g.pickTile} onClick={() => { setPick(bps); tapFeedback(prefs) }}
      label={(
        <span className={g.risk}>
          <b>{pickLabel(bps)}</b>
          <span className={g.riskBar} aria-hidden="true"><i style={{ width: `${(bps / PICKS[PICKS.length - 1]) * 100}%` }} /></span>
          <small>{firstRisk(bps)} on trade one</small>
        </span>
      )} />
  )
  const inRule = PICKS.filter((b) => b >= RULE_MIN_BPS && b <= RULE_MAX_BPS)
  const over = PICKS.filter((b) => b > RULE_MAX_BPS)
  return (
    <div className={g.pickLayout}>
      <div className={`${s.heroChart} ${g.system}`} data-testid="survive-system">
        <span className={g.sysEyebrow}>The system · course unit F9.03</span>
        <div className={g.sysEdge}><b>{EDGE_TEXT}</b><span>a trade, on average</span></div>
        <div className={g.marbles} role="img" aria-label={`${WIN_PCT / 10} in 10 trades win`}>
          {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < WIN_PCT / 10 ? g.pipWin : g.pipLoss} />)}
          <small>{WIN_PCT / 10} in 10 win</small>
        </div>
        <p className={g.sysLine}>{edgeText()}</p>
        <dl className={g.sysFacts}>
          <div><dt>Account</dt><dd>{dollars(START)}</dd></div>
          <div><dt>Trades</dt><dd>{TRADES}</dd></div>
          <div><dt>For every pick</dt><dd>Same trades</dd></div>
        </dl>
      </div>
      <div className={g.pickArea}>
        <div className={g.pickHead}>
          <span className={g.pickEyebrow}>Your call · risk per trade</span>
          <h2 className={g.pickQ}>How much do you risk on each trade?</h2>
          {phone ? null : <p className={g.pickDetail}>Each trade risks that share of the account as it stands, so the dollars grow and shrink with it.</p>}
        </div>
        <div role="radiogroup" aria-label="Risk per trade" className={g.pickList} data-testid="survive-picks">
          <div className={g.group}>
            <span className={g.groupLabel}><UIcon name="shield" size={13} gold={false} />Our range · {RULE_RANGE}</span>
            {inRule.map((b) => row(b, PICKS.indexOf(b)))}
          </div>
          <div className={`${g.group} ${g.groupOver}`}>
            <span className={g.groupLabel}><UIcon name="warning" size={13} gold={false} />Over our {pickLabel(RULE_MAX_BPS)} ceiling</span>
            {over.map((b) => row(b, PICKS.indexOf(b)))}
          </div>
        </div>
        <p className={g.pickNote}>Pick any of the five. The same {stretch.n} trades play for all of them.</p>
        <div className={g.pickGo}>
          <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" disabled={pick == null} onClick={onPlay} testId="survive-play">
            {pick == null ? 'Pick a risk' : `Play ${stretch.n} trades at ${pickLabel(pick)}`}
          </StudyButton>
        </div>
      </div>
    </div>
  )
}

export default function SurviveGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const phone = useIsPhone()
  const [phase, setPhase] = useState('start')      // start | pick | play | done | empty
  const [run, setRun] = useState(null)             // { seed, runId, stretch }
  const [pick, setPick] = useState(null)           // the risk picked on the pick screen (bps)
  const [mine, setMine] = useState(null)           // the risk locked in at Play
  const [qs, setQs] = useState([])
  const [step, setStep] = useState(0)              // trades drawn
  const [others, setOthers] = useState(false)      // the other four picks shown
  const [qi, setQi] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  const [report, setReport] = useState(null)       // { level } once saved, { failed, out } when it was not
  const [best, setBest] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0)
  const live = useRef(true)
  const current = useRef(null)                     // the run on screen: a late answer for an older run is dropped
  const posted = useRef(null)                      // the run already reported: one post per run
  const runNo = useRef(0)
  const stepRef = useRef(0)
  const rootRef = useRef(null)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  // a fresh stretch: seeded once from the clock (GAMES.md §1.7); the pure module never reads it
  const deal = useCallback(() => {
    const seed = Date.now()
    runNo.current += 1
    const stretch = safeDeal(seed)
    const runId = runIdOf(seed, runNo.current)
    current.current = runId; posted.current = null; stepRef.current = 0
    setRun(stretch ? { seed, runId, stretch } : null)
    setPick(null); setMine(null); setQs([]); setStep(0); setOthers(false); setQi(0); setResults([]); setLog([]); setReport(null)
    setBestBefore(readBest())
    setPhase(stretch ? 'pick' : 'empty')
  }, [])

  const play = useCallback(() => {
    if (!run || pick == null) return
    const list = safeQuestions(run.stretch, pick, run.seed)
    if (list.length !== QUESTIONS) { setPhase('empty'); return }
    setMine(pick); setQs(list)
    const instant = reducedMotion()
    stepRef.current = instant ? run.stretch.n : 0
    setStep(stepRef.current); setOthers(false); setPhase('play')
    scrollTo(rootRef.current)
  }, [run, pick])

  // the draw: one trade a tick while the member's curve plays; nothing runs once it has drawn, or off this screen
  const drawing = phase === 'play' && !!run && step < run.stretch.n
  useEffect(() => {
    if (!drawing) return undefined
    const n = run.stretch.n
    const t = setInterval(() => {
      const next = Math.min(n, stepRef.current + 1)
      stepRef.current = next
      setStep(next)
      if (next >= n) clearInterval(t)
    }, TICK_MS)
    return () => clearInterval(t)
  }, [drawing, run])
  const skip = useCallback(() => { if (run) { stepRef.current = run.stretch.n; setStep(run.stretch.n) } }, [run])
  // the curve's last trade lands with the verdict's feel, once a run: the reveal's success when the pick survived, its
  // warning when it fell past the 50% line or only held this time over our ceiling
  const drawnNow = phase === 'play' && !!run && !!mine && step >= run.stretch.n && !others
  const told = useRef(null)
  useEffect(() => {
    if (!drawnNow || told.current === run.runId) return
    told.current = run.runId
    revealFeedback(verdictOf(pickOf(run.stretch, mine)) === 'survived', prefs)
  }, [drawnNow, run, mine, prefs])
  const showOthers = useCallback(() => setOthers(true), [])

  const finish = (all) => {
    const right = all.filter(Boolean).length
    const total = all.length
    const mineId = current.current
    setPhase('done'); endFeedback(prefs)
    const prev = readBest()
    if (right > prev) writeBest(right)
    setBest(Math.max(prev, right))
    if (!total || posted.current === mineId) return
    posted.current = mineId
    // the run's XP, once (the server is idempotent on run_id too); whatever it answers, the end screen is already up
    Promise.resolve()
      .then(() => fetcher(GAME_RUNS_URL, { method: 'POST', body: { kind: SURVIVE_KIND, run_id: mineId, right, total } }))
      .then((res) => { if (live.current && current.current === mineId) { const level = levelOf(res); setReport(level ? { level } : { failed: true, out: false }) } })
      .catch((e) => { if (live.current && current.current === mineId) setReport({ failed: true, out: isSignedOut(e) }) })
  }

  if (phase === 'start') {
    return (
      <div className={s.kit} style={{ padding: '26px 0 34px' }}>
        <StartArena plate="Survive" title="Survive the Drawdown" caption="How much do you risk?" testId="survive-intro" startTestId="survive-start" hotkey
          total={QUESTIONS} ready onStart={deal} label="Start"
          stakes={[{ v: TRADES, l: 'trades', icon: 'equity' }, { v: PICKS.length, l: 'risk sizes', icon: 'sliders' }, { v: QUESTIONS, l: 'questions', icon: 'check' }]}
          lead={<>One system with a real edge, a {dollars(START)} account and the same {TRADES} trades. Only your risk per trade changes. Pick it and see what survives.</>}
          reward={<><Medal size={40} testId={null} /><span><b>{QUESTIONS} for {QUESTIONS}</b> lights the Legendary medal · your best <b data-testid="survive-best">{best}</b></span></>}
          howTo={<HowItPlays mode="survive" testId="survive-howto" steps={[
            { icon: 'sliders', title: 'Pick your risk', body: `${PICKS.slice(0, -1).map(pickLabel).join(', ')} or ${pickLabel(PICKS[PICKS.length - 1])} of the account on every trade. Number keys pick, Enter plays.` },
            { icon: 'equity', title: `Watch ${TRADES} trades`, body: `Wins ${WIN_PCT}% at ${WIN_TEXT}, loses ${100 - WIN_PCT}% at ${LOSS_TEXT}. Your account draws trade by trade, then the other four picks join it.` },
            { icon: 'check', title: 'Read the damage', body: 'What the longest losing streak takes, how deep yours fell, which fell 50% from its peak. Every answer shows the working.' },
          ]} />}>
          <span>A fresh stretch of trades every run · our range is {RULE_RANGE} a trade</span>
        </StartArena>
      </div>
    )
  }

  if (phase === 'empty' || !run) {
    return (
      <div className={s.kit}>
        <div className={g.empty} data-testid="survive-empty" role="status">
          <span className={g.emptyIcon}><UIcon name="equity" size={30} gold={false} /></span>
          <h2>No stretch to play right now.</h2>
          <p>This run's {TRADES} trades did not deal. Deal a fresh stretch, or head back to Study.</p>
          <div className={g.emptyGo}>
            <StudyButton kind="primary" size="xl" arrow onClick={deal} testId="survive-retry">Deal a fresh stretch</StudyButton>
            <StudyButton kind="ghost" onClick={onClose} testId="survive-back">Back to Study</StudyButton>
          </div>
        </div>
      </div>
    )
  }

  const { stretch } = run

  if (phase === 'done') {
    const right = results.filter(Boolean).length
    const total = results.length
    const perfect = total === QUESTIONS && right === total
    const p = pickOf(stretch, mine)
    const newBest = right > 0 && right > bestBefore
    const failed = !!report?.failed
    const level = report?.level ? { before: report.level.before, after: report.level.after } : null
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s.kit} ${g.end}`}>
          <EndHard right={right} total={total} xp={report?.level?.gained || 0} results={results} log={log} level={level}
            title={survivalTitle(p)} unit="read right" doneWord="right" showSetups={false} medal
            againLabel="New stretch" testIdPrefix="survive" onAgain={deal} onBack={onClose}>
            <span className={g.note} data-testid="survive-stretch">{stretchLine(stretch)}</span>
            <span className={g.note} data-testid="survive-yours">Your {pickLine(p)}.</span>
            <ManyPanel />
            <span className={`${g.note} ${g.noteRule}`} data-testid="survive-rule">{LESSON_RULE}<small>{SOURCE_RULE}</small></span>
            <span className={g.note} data-testid="survive-best-line">
              {newBest ? <><b>A new best:</b> {right} of {QUESTIONS} read right.</> : <>Your best run stands at <b>{best}</b> of {QUESTIONS}.</>}
            </span>
            {failed ? (
              <span className={g.saved} data-testid="survive-not-saved">
                {report.out ? 'You are signed out, so this run\'s XP did not save.' : 'This run\'s XP did not save.'}
              </span>
            ) : null}
          </EndHard>
          {failed && report.out && signedOut ? <div className={g.signIn}>{signedOut}</div> : null}
        </div>
      </>
    )
  }

  if (phase === 'pick') {
    return (
      <div className={`${s.kit} ${s.screen}`} data-testid="survive-pick" ref={rootRef}>
        <HudCombo label="Survive" unit="question" scoreWord="right" step={0} total={QUESTIONS} results={[]} live={false} stepTestId="survive-step" />
        <PickScreen stretch={stretch} pick={pick} setPick={setPick} onPlay={play} prefs={prefs} phone={phone} />
      </div>
    )
  }

  // play: the member's curve draws, then the other four join it, then the three questions
  if (others && qs.length === QUESTIONS) {
    const q = qs[qi]
    return (
      <Question key={`${run.runId}-${qi}`} idx={qi} q={q} stretch={stretch} mine={mine} results={results} prefs={prefs} phone={phone}
        fallKnown={qi > qs.findIndex((x) => x.key === 'deep')}
        onDone={(ok, said) => {
          const all = [...results, !!ok]
          const rows = [...log, { name: q.tag, ticker: q.answer, ok: !!ok, said: ok ? null : said, was: '' }]
          setResults(all); setLog(rows)
          if (qi + 1 >= QUESTIONS) finish(all); else setQi(qi + 1)
        }} />
    )
  }

  const drawn = step >= stretch.n
  const p = pickOf(stretch, mine)
  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="survive-play" data-state={drawn ? 'drawn' : 'drawing'} ref={rootRef}>
      <HudCombo label="Survive" unit="question" scoreWord="right" step={0} total={QUESTIONS} results={[]} live={false} stepTestId="survive-step" />
      <Board stretch={stretch} mine={mine} step={step} showOthers={false} fall={false} phone={phone}
        head={drawn ? <DoneHead stretch={stretch} mine={mine} /> : <LiveHead stretch={stretch} mine={mine} step={step} />} />
      {drawn ? (
        <div className={g.after} data-testid="survive-after">
          <p className={`${g.afterLine} ${verdictOf(p) === 'survived' ? g.upText : g.downText}`} data-testid="survive-line">{survivalLine(p)}</p>
          <p className={g.afterNext}>Same {stretch.n} trades, four other risks. See how each one did.</p>
          <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" onClick={showOthers} testId="survive-others">Show the other four</StudyButton>
        </div>
      ) : (
        <div className={g.after}>
          <p className={g.afterNext}>{pickText(mine)}: every trade risks {pickLabel(mine)} of the account as it stands.</p>
          <StudyButton kind="ghost" hotkey="Enter" onClick={skip} testId="survive-skip">Skip to trade {stretch.n}</StudyButton>
        </div>
      )}
    </div>
  )
}

