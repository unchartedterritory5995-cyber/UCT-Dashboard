// TRADE STORY (docs/study/GAMES.md §3, kind 'story'; built on the contract in §1). A real setup fired on the last candle
// of a chart; the member names it, takes the trade on that setup's own plan, and manages it as the bars that followed
// replay, tick by tick inside each day where the server stored the day's 30-minute bars.
//
// THE CHARTS are the Spot the Setup pool asked with `need_plan` (POST /api/study/spot-setup, the call Draw it makes): a
// chart whose last candle is its setup and nothing else, of a setup with a trade plan. Four a run, a fresh draw each time.
//
// THE ENTRY QUESTION is Hard mode's, without "Nothing fired" (something always fired here): four setup names, and the
// pick is posted the way Hard mode posts it (hardMode.hardAnswer: the chart's own setup is the bank's Yes, another name
// is posted as itself and is a miss), so it is scored on the server and earns its XP through /attempts. The verdict takes
// over the screen (rule 15) with the ticker and the plan in one line; a miss names the setup and keeps its lesson on the
// screen for the whole trade.
//
// THE TRADE is the reveal's plan (api/services/study_trade.py; docs/study/TRADE_PLANS.md) on the account rulebook
// (docs/study/sizing_rule.md §9): the entry, the stop, the house trims at 3R and 5R (a third at each, B19 and E51; the
// plan's trim_r), drawn on the chart as Hard mode draws them, with the trail's line added once it trails. The replay
// STOPS only where the plan defines a decision (games/tradeStory.js: 3R, 5R, the Gap Support's post-gap high, the High
// Volume Edge's first return to the high-volume close, the stop trading, the trail breaking) and holds there (the run-on
// is asked for no further than the next stop, so it waits under reduced motion too, and never shows a candle past a
// decision before it is made). Hold, Sell a third, or Sell the rest. A call on the plan flashes and says why; a miss
// takes over the screen with the plan's call, then "See the working" opens the working on the plan's own prices and the
// rule it comes from. Between stops nothing is asked. The chart's marks and the plan key only ever show what has already
// happened. At the 3R trim the stop on the rest moves up to breakeven (the entry line; the key grows a "Breakeven stop"
// row and the position chip reads Breakeven); a bar back at the entry from then on is the breakeven stop trading, marked
// STOPPED by the game itself (hardMode.reviewTrade reads the plan's original stop and does not know it). The post-gap
// high is a dotted green line from the start (a plan level, like the trims); the high-volume close IS the entry line, so
// the key names it there. The first return is a call the owner has not ruled on (HVE_RETURN_CALL): until he does, it
// asks, says the plan's words and its stop, shows the working, and is neither right nor wrong (no flash, no takeover,
// not in the calls, the log or the XP; the end screen says it was the member's call).
//
// THE END of each trade lists every stop with the plan's call and its R, the member's exits beside the plan's, each at its
// own R: the rulebook's trims are a third each, so no single R is claimed for the whole trade (the thirds went at
// different prices). The run's end screen (EndHard) counts the calls on the plan, logs each one, and says each trade in
// a line. The calls are computed against the plan in the browser, so they report once through POST /api/study/game-runs
// (kind 'story'); the entry answers already earned their XP through /attempts and are not reported again. The level bar
// runs from before the first scored answer to the game run's grant; if the report fails the end screen stays whole and
// says the calls' XP did not save.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { useRunOnTicks } from '../../../lab/fx'   // pure motion (bars running on, tick by tick); no styling rides in
import { useIsPhone } from '../../../hooks/useBreakpoint'
import ChallengeError, { isSignedOut } from './ChallengeError'
import { beginRunXp, fetchForwardRest, runXp, scoreAttempt } from './challengeBank'
import { yesNo } from './SpotSetupChallenge'
import { RUN_ON_MS, hardAnswer, hardRight, idSeed, replayView, timesWord, trimLabels, trimR } from './hardMode'
import { alignTicks, developing, fetchIntraday, showChart } from './replayTicks'
import { tradeAnnotations, tradeMarkers } from './tradeMarks'
import {
  ACTIONS, EMPTY_LINE, ENTRY_DETAIL, ENTRY_Q, EXIT_NOTE, FAILED_LINE, GAP_SUPPORT, HVE, HVE_RETURN_CALL, NOTHING_TRADED, NOT_SCORED, NO_PLAN,
  START_LEAD, STORY_KIND, STORY_SOURCE, STORY_TOTAL, STORY_VIEW, STORY_VIEW_PHONE, actionLabel, bankLine, breakevenAt, callsOf, entryChoices,
  entryTitle, exitsOf, exitsText, freeCalls, isFree, legsOf, levelAfter, logRows, namedLine, planExits, planLine, planOk, poolItems,
  positionLine, positionWord, postGapHigh, px, questionOf, rAt, rText, riskPct, runIdOf, stopAt, stopTag, storyKeys, storyOf, storyVerdict,
  tally, tradeLine, tradeOk, tradeTitle, trailAt, trailMeasured, trimNote, whyOf, workingOf, yoursLines,
} from './games/tradeStory'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { normalizeBars, studyFetch } from '../useStudySession'
import { HudCombo } from '../ui/HudLooks'
import { AnswerLessonApp } from '../ui/AnswerLooks'
import { EndHard } from '../ui/EndLooks'
import { StartArena } from '../ui/StartLooks'
import { Medal } from '../ui/Medal'
import HowItPlays from '../ui/HowItPlays'
import VerdictTakeover from '../ui/VerdictTakeover'
import StudyButton from '../ui/StudyButton'
import Tile from '../ui/Tile'
import StudyChart from '../ui/StudyChart'
import ReplayClock from '../ui/ReplayClock'
import LessonCard from '../ui/LessonCard'
import { Confetti } from '../ui/Stage'
import { calloutLook, hardCallouts } from '../ui/callout'
import s from '../ui/study.module.css'
import sa from '../ui/answerLooks.module.css'
import ck from '../ui/chartKey.module.css'
import g from './TradeStoryGame.module.css'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: STORY_KIND, title: 'Trade Story', sub: 'A real setup fires. Take the trade on its own plan, then make the calls as the chart plays out.', icon: 'compass', plate: 'Story', accent: 'green', group: 'chart' }

const POOL_URL = '/api/study/spot-setup'
const GAME_RUNS_URL = '/api/study/game-runs'
const GOLD_SOFT = '#f6e2a0'   // the line colour Draw it draws the member's own entry in
const RED = '#ef5350'         // tradeMarks' STOPPED
const GREEN = '#2faf68'       // tradeMarks' trims: the post-gap high is a place to take some off, like them
const GOLD = '#dcbb5e'        // tradeMarks' ENTRY: the high-volume close is the entry
const NONE = []
const into = (el) => { try { el?.scrollIntoView?.({ block: 'nearest' }) } catch { /* an old engine without options */ } }
/** An R's colour follows the number printed: green for a plus, red for a minus, plain for a 0.0R. */
const rTone = (r) => { const t = rText(r); return t.startsWith('+') ? g.up : t.startsWith('−') ? g.down : '' }
const typing = (e) => !!e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)
const capFirst = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : t)
const dayOf = (p) => (p.session === 0 ? 'the entry day' : `day ${p.session}`)

/** Under the chart while the trade runs: where the member stands, where the price is in R, and the stop in force (the
 *  plan's, breakeven once 3R has traded, the trail once a higher low has lifted it). */
function PositionBar({ word, r, stop }) {
  const label = stop.kind === 'trail' ? 'Trail' : stop.kind === 'breakeven' ? 'Breakeven' : 'Stop'
  return (
    <div className={g.pos} role="group" aria-label="Your position" data-testid="story-position">
      <span className={`${g.chip} ${word === 'Out' ? g.out : ''}`}><small>Position</small><b data-testid="story-position-word">{word}</b></span>
      <span className={`${g.chip} ${rTone(r)}`}><small>Price now</small><b data-testid="story-r">{r == null ? '' : rText(r)}</b></span>
      <span className={`${g.chip} ${stop.kind === 'trail' ? g.trail : ''}`} data-testid="story-stop-chip" data-kind={stop.kind}><small>{label}</small><b data-testid="story-stop-level">{px(stop.level)}</b></span>
    </div>
  )
}

/** The plan's levels in the chart key's rows (ui/ChartKey's look): each line, its price, why it sits there in the plan's
 *  own words or the rulebook's, and a status only once the replay has reached it. Once 3R has traded the breakeven stop
 *  is a row of its own (the entry line is that stop, B19). The trim the plan names is a row of its own too: the post-gap
 *  high (the dotted green line) or the high-volume close (the entry line itself). */
function PlanKey({ plan, story, k, name, gapHigh }) {
  const long = story ? story.long : plan.direction !== 'bearish'
  const pts = story?.points || NONE
  // a level reached so far (a post-gap high on a trim's bar is one stop with both)
  const at = (id, test = () => true) => pts.find((p) => legsOf(p).some((l) => l.id === id) && test(p) && k >= p.session) || null
  const day = dayOf
  const t1 = at('t1'), t2 = at('t2'), stopHit = at('stop', (p) => !p.breakeven), beHit = at('stop', (p) => !!p.breakeven), trailHit = at('trail')
  const now = story ? stopAt(story, plan, k) : { kind: 'stop', level: plan.stop, low: null }
  const [l1, l2] = trimLabels(plan)
  const [m1, m2] = trimR(plan)
  const rows = [
    { tone: 'gold', name: long ? 'Entry' : 'Short entry', price: px(plan.entry), why: plan.entry_note, status: { ok: true, text: long ? 'bought here' : 'shorted here' } },
    { tone: 'red', name: 'Stop', price: px(plan.stop), why: plan.stop_note, risk: riskPct(plan), status: stopHit ? { ok: false, text: `hit on ${day(stopHit)}` } : null },
  ]
  if (story && breakevenAt(story, k)) {
    rows.push({ tone: 'gold', name: 'Breakeven stop', price: px(plan.entry), why: `the entry: the stop on what is left since the ${l1} trim`,
      status: beHit ? { ok: false, text: `hit on ${day(beHit)}` } : { ok: true, text: `in force since ${day(t1)}` } })
  }
  rows.push(
    { tone: 'green', name: l1, price: px(plan.t1), why: `the first trim, ${timesWord(m1)} the risk: a third off, the stop on the rest to breakeven`, status: t1 ? { ok: true, text: `reached on ${day(t1)}` } : null },
    { tone: 'green', name: l2, price: px(plan.t2), why: `the second trim, ${timesWord(m2)} the risk: another third off, the last third trails`, status: t2 ? { ok: true, text: `reached on ${day(t2)}` } : null },
  )
  const note = capFirst(trimNote(plan))
  if (plan.skill === GAP_SUPPORT) {
    const level = gapHigh?.level
    const watched = story?.pgh != null
    const hit = at('pgh')
    rows.push({ tone: 'green', dot: true, name: 'Post-gap high', price: Number.isFinite(level) ? px(level) : '',
      why: Number.isFinite(level) && !watched ? `${note}. Here it is not over the entry, so the replay does not stop there.` : note,
      status: hit ? { ok: true, text: `reached on ${day(hit)}` } : null })
  } else if (plan.skill === HVE) {
    const back = at('hvc')
    rows.push({ tone: 'gold', name: 'High-volume close', price: px(plan.entry), why: `${note}. It is the entry line.`,
      status: back ? { ok: true, text: `back on ${day(back)}` } : null })
  }
  if (plan.trail) {
    rows.push({ tone: 'soft', name: 'Trail', price: now.kind === 'trail' ? px(now.level) : '',
      // the plan's own words; a trail the bars cannot place (the Gap Support's) is said, and not applied
      why: trailMeasured(plan) ? `${plan.trail}. This replay trails the last third under the higher lows from ${l2} on, starting at breakeven.` : `${plan.trail}. This replay keeps what is left on the stop: the plan's until ${l1}, breakeven after.`,
      status: trailHit ? { ok: false, text: `hit on ${day(trailHit)}` } : now.kind === 'trail' ? { ok: true, text: `under day ${now.low}` } : null })
  }
  return (
    <div className={`${ck.key} ${g.planKey}`} role="list" aria-label="The plan's levels" data-testid="story-plan">
      <span className={ck.head}>The plan · {name}</span>
      {rows.map((r) => (
        <div key={r.name} role="listitem" className={`${ck.row} ${ck[r.tone]} ${r.dot ? g.dot : ''}`} data-row={r.name}>
          <i className={ck.swatch} aria-hidden="true" />
          <b className={ck.name}>{r.name}</b>
          <span className={ck.price}>{r.price}</span>
          <span className={ck.why}>{r.why || ''}{r.risk != null ? <em className={ck.risk}>{r.risk.toFixed(1)}% risk from the entry</em> : null}</span>
          {r.status ? (
            <span className={`${ck.status} ${r.status.ok ? ck.sOk : ck.sBad}`}><UIcon name={r.status.ok ? 'check' : 'x'} size={12} gold={false} />{r.status.text}</span>
          ) : <span />}
        </div>
      ))}
    </div>
  )
}

/** THE REPLAY STOPS: the kit's replay card (Hard mode's), with the three calls. After a call the tiles show the plan's,
 *  the why reads under them, and a miss also shows the working; the card brings itself, then its why, into view. At a
 *  point the plan leaves to the member the pick is simply marked as theirs, and the plan's words and the working read
 *  under it, neither right nor wrong. */
function StopCard({ point, pick, plan, long, inPosition, position, missOpen, last, onPick, onGo }) {
  const box = useRef(null)
  const why = useRef(null)
  const done = pick != null
  const free = isFree(point)
  useEffect(() => { into(box.current) }, [])
  useEffect(() => { if (done && !missOpen) into(why.current) }, [done, missOpen])
  const w = done ? whyOf(point, pick, plan) : null
  const stateOf = (a) => (!done ? 'idle' : free ? (a === pick ? 'sel' : 'quiet') : a === point.answer ? 'right' : a === pick ? 'wrong' : 'quiet')
  const q = questionOf(point, long, inPosition)
  const tone = !done ? 'ask' : free ? 'yours' : w.ok ? 'ok' : 'bad'
  return (
    <section ref={box} className={`${s.replayPause} ${g.stop}`} data-testid="story-stop" data-at={point.id} data-state={tone} aria-live="polite">
      <div className={s.replayPauseHead}>
        <span className={s.replayPauseTag}>{stopTag(point)}</span>
        <h3 className={s.replayPauseQ} data-testid="story-stop-q">{q}</h3>
        <p className={g.where} data-testid="story-stop-where">{position}</p>
      </div>
      <div className={`${s.replayPauseTiles} ${g.tiles}`} role="radiogroup" aria-label={q} data-testid="story-calls">
        {ACTIONS.map((a, i) => (
          <Tile key={a} n={i + 1} i={i} label={actionLabel(a, long)} state={stateOf(a)} disabled={done} role="radio" checked={pick === a}
            onClick={() => onPick(a)} testId={`story-call-${a}`} />
        ))}
      </div>
      {done && w.ok !== true ? (
        <div className={g.working} data-testid="story-working">
          <span className={s.coachLabel}>The working</span>
          <ol className={s.steps}>
            {workingOf(point, plan).map((st, k) => <li key={st.key} data-testid={`story-step-${st.key}`}><i>{k + 1}</i><span>{st.text}</span></li>)}
          </ol>
          <span className={g.source}>{STORY_SOURCE}</span>
        </div>
      ) : null}
      {done ? (
        <div ref={why} className={`${s.replayPauseWhy} ${free ? g.yours : w.ok ? s.replayPauseOk : s.replayPauseBad}`}>
          <p data-testid="story-why"><b>{w.title}</b> {w.text}</p>
          <StudyButton kind={w.ok ? 'good' : 'primary'} arrow hotkey={missOpen ? null : 'Enter'} onClick={onGo} className={s.replayPauseGo} testId="story-go">
            {last ? 'See the trade' : 'Keep playing'}
          </StudyButton>
        </div>
      ) : null}
    </section>
  )
}

/** The trade, start to finish: every stop with the plan's call and its R (what was said on a miss), then the member's
 *  exits beside the plan's, each at its own R. */
function TradeResult({ story, picks, name, ticker, boxRef }) {
  const calls = callsOf(story, picks)
  return (
    <section ref={boxRef} className={`${s.coach} ${g.result}`} data-testid="story-result" aria-label="The trade, start to finish">
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>The trade, start to finish</span>
          <h3 className={s.coachTitle} data-testid="story-result-title">{tradeTitle(calls, freeCalls(story, picks))}</h3>
        </div>
        <span className={s.tag}>{ticker ? <><b>{ticker}</b> · </> : null}{name}</span>
      </header>
      {story.points.length ? (
        <ol className={g.calls} data-testid="story-result-calls">
          {story.points.map((p, i) => {
            // a call the plan leaves to the member is marked as theirs: neither right nor wrong
            const free = isFree(p)
            const ok = !free && picks[i] === p.answer
            const said = actionLabel(picks[i], story.long).toLowerCase()
            return (
              <li key={p.id} className={`${g.call} ${free ? g.free : ok ? g.ok : g.miss}`} data-ok={free ? 'free' : ok ? '1' : '0'}>
                <span className={g.callMark} aria-hidden="true"><UIcon name={free ? 'flag' : ok ? 'check' : 'x'} size={14} gold={false} /></span>
                <span className={g.callText}>
                  <b>{p.label} · {free ? 'Your call' : actionLabel(p.answer, story.long)}</b>
                  <small>{dayOf(p)}{free ? ` · the plan leaves this one to you · you said ${said}` : ok ? '' : ` · you said ${said}`}</small>
                </span>
                <span className={`${g.callR} ${rTone(p.r)}`}>{legsOf(p).map((l) => rText(l.r)).join(' · ')}</span>
              </li>
            )
          })}
        </ol>
      ) : <p className={g.nothing}>{NOTHING_TRADED}</p>}
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>Your exits</span>
        <p className={g.exits} data-testid="story-mine">{exitsText(exitsOf(story.points, picks), story.end)}</p>
        <span className={s.coachLabel}>The plan&rsquo;s exits</span>
        <p className={g.exits} data-testid="story-plan-exits">{exitsText(planExits(story), story.end)}</p>
        <p className={g.note}>{EXIT_NOTE}</p>
        <span className={g.source}>{STORY_SOURCE}</span>
      </div>
    </section>
  )
}

/** One trade: name the setup, take the trade, make the calls, read the trade back. */
function Trade({ idx, total, item, results, prefs, fetcher, phone, signedOut, onDone }) {
  const bars = item.bars
  const n = bars.length
  const signal = bars[n - 1]
  const choices = useMemo(() => entryChoices(item, idSeed(item.id)), [item])
  const [pick, setPick] = useState(null)
  const [stage, setStage] = useState('ask')          // ask | trade
  const [busy, setBusy] = useState(false)            // the answer is on the wire: Check reads Checking and posts nothing more
  const [failed, setFailed] = useState(null)         // the answer could not be scored: { out }
  const [entry, setEntry] = useState(null)           // { named, picked, ticker, xp, plan, lesson, rule }
  const [entryOpen, setEntryOpen] = useState(false)  // the entry's verdict holds the screen
  const [rolling, setRolling] = useState(false)      // the replay has begun; it stays on (a stop holds it, never restarts it)
  const [fwd, setFwd] = useState(null)
  const [restDone, setRestDone] = useState(false)    // the rest of the forward strip has come back (or there was none)
  const [intraday, setIntraday] = useState(null)     // the forward days' 30-minute bars, when the server stored them
  const [picks, setPicks] = useState(NONE)
  const [open, setOpen] = useState(null)             // the stop being reviewed: { i, takeover }
  const [flash, setFlash] = useState(null)
  const chartBox = useRef(null)
  const resultBox = useRef(null)
  const shownAt = useRef(0)
  const live = useRef(true)
  const flashT = useRef(null)
  const called = useRef(new Set())                   // the stops already called: a fast second tap scores nothing
  const checking = useRef(false)
  useEffect(() => {
    shownAt.current = performance.now(); live.current = true
    return () => { live.current = false; clearTimeout(flashT.current) }
  }, [])

  const plan = entry?.plan || null
  // the post-gap high a Gap Support plan names, off the chart the member saw (games/tradeStory.postGapHigh)
  const gapHigh = useMemo(() => (plan?.skill === GAP_SUPPORT ? postGapHigh(bars) : null), [plan, bars])
  const story = useMemo(() => (plan ? storyOf(plan, signal, fwd || NONE, { pgh: gapHigh?.level ?? null, hveCall: HVE_RETURN_CALL }) : null),
    [plan, signal, fwd, gapHigh])
  const pts = story?.points || NONE
  const pending = pts.findIndex((_, i) => picks[i] == null)
  const holdIdx = open ? open.i : pending
  // the run-on goes no further than the next stop: it waits there for the call (reduced motion too), then runs on
  const target = !story ? 0 : holdIdx >= 0 ? pts[holdIdx].session : story.end.session
  const ticks = useMemo(() => alignTicks(fwd, intraday), [fwd, intraday])
  const keys = useMemo(() => (ticks && story ? storyKeys(story) : null), [ticks, story])
  const { bars: all, k, clock } = useRunOnTicks(bars, fwd, target, rolling, { slowMs: RUN_ON_MS, ticks, keys, develop: developing })
  const due = rolling && holdIdx >= 0 && k >= pts[holdIdx].session ? holdIdx : -1
  // a trade the stop or the trail ended is whole (no bar after it can add a call), so it never waits on the rest of the strip
  const settled = !!story && (restDone || story.end.kind !== 'open')
  const finished = stage === 'trade' && !entryOpen && (!story || (settled && pending < 0 && !open && k >= story.end.session))

  // the chart: the question frames 90 sessions; the replay starts closer and widens as each day arrives
  const view = stage === 'ask' ? Math.min(phone ? STORY_VIEW_PHONE : STORY_VIEW, n) : replayView(all?.length || n, n)
  const look = useMemo(() => calloutLook(phone), [phone])
  const tone = stage === 'ask' ? 'ask' : entry?.named ? 'ok' : 'bad'
  const callouts = useMemo(() => hardCallouts({ index: n - 1, label: stage === 'ask' ? 'What fired here?' : item.name, tone }), [n, stage, item.name, tone])
  const trailNow = story ? trailAt(story, k) : null
  const lines = useMemo(() => {
    if (stage === 'ask' || !story) return null
    const out = [...(tradeAnnotations(story.shown, signal, all) || NONE)]
    const from = trailNow && trailNow.low != null ? all?.[n - 1 + trailNow.low] : null
    if (from) out.push({ id: 'story-TRAIL', type: 'hray', points: [{ time: from.t, price: trailNow.level }], color: GOLD_SOFT, lineWidth: 1.5, lineStyle: 'dashed', showPriceLabel: true })
    // the post-gap high: a plan level from the start, drawn like the targets (dotted, so it reads apart from them)
    if (story.pgh != null) out.push({ id: 'story-PGH', type: 'hray', points: [{ time: signal.t, price: story.pgh }], color: GREEN, lineWidth: 1.5, lineStyle: 'dotted', showPriceLabel: true })
    return out.length ? out : null
  }, [stage, story, signal, all, trailNow, n])
  // the action items, on whole days only: a day still growing never carries the mark of what it is about to do
  const marks = useMemo(() => {
    if (stage === 'ask' || !story || !all) return null
    const whole = all.slice(0, n + k)
    const out = [...(tradeMarkers(story.shown, whole, n) || NONE)]
    // a broken trail or a breakeven stop is the game's own mark (the review reads the plan's original stop)
    const hit = (story.end.kind === 'trail' || story.end.breakeven) && k >= story.end.session ? whole[n - 1 + story.end.session] : null
    if (hit) out.push({ time: hit.t, size: 1.4, position: story.long ? 'belowBar' : 'aboveBar', shape: 'square', color: RED, text: story.end.kind === 'trail' ? 'TRAIL HIT' : 'STOPPED' })
    // the trims the plan names, on the bar where they traded
    for (const p of story.points) {
      const b = (p.id === 'pgh' || p.id === 'hvc') && p.session >= 1 && k >= p.session ? whole[n - 1 + p.session] : null
      if (!b) continue
      out.push(p.id === 'pgh' ? { time: b.t, size: 1.4, position: 'aboveBar', shape: 'circle', color: GREEN, text: 'POST-GAP HIGH' }
        : { time: b.t, size: 1.4, position: story.long ? 'belowBar' : 'aboveBar', shape: 'circle', color: GOLD, text: 'FIRST RETURN' })
    }
    return out.length ? out.sort((a, b) => String(a.time).localeCompare(String(b.time))) : null
  }, [stage, story, all, n, k])

  const check = async () => {
    if (pick == null || stage !== 'ask' || checking.current) return
    checking.current = true
    setBusy(true); setFailed(null)
    const picked = choices[pick]
    const { yes, no } = yesNo(item.choices)
    let a = null
    try {
      a = await scoreAttempt(item, hardAnswer(picked, item, yes, no), performance.now() - shownAt.current, fetcher)
    } catch (e) {
      checking.current = false
      if (live.current) { setBusy(false); setFailed({ out: isSignedOut(e) }) }
      return
    }
    if (!live.current) return
    const named = hardRight(picked, item, a.correct)
    const tp = planOk(a.reveal?.trade) ? a.reveal.trade : null
    setEntry({ named, picked, ticker: a.reveal?.sym || a.reveal?.ticker || '', xp: Number(a.progress?.xp_gained || 0), plan: tp,
      lesson: a.reveal?.lesson || '', rule: a.reveal?.setup_rule || null })
    setFwd(a.forward || NONE); setBusy(false); setStage('trade'); setEntryOpen(true); revealFeedback(named, prefs)
    // the rest of the forward strip and the days' 30-minute bars, so the story can run to the trade's end
    fetchIntraday(a, fetcher).then((d) => { if (live.current && d) setIntraday(d) })
    fetchForwardRest(a, (a.forward || NONE).length, fetcher).then((more) => {
      if (!live.current) return
      if (more.length) setFwd((f) => [...(f || NONE), ...more])
      setRestDone(true)
    })
  }

  const beginTrade = useCallback(() => { setEntryOpen(false); setRolling(true); showChart(chartBox.current) }, [])
  const decide = useCallback((i, action) => {
    if (!story || i < 0 || i >= story.points.length || called.current.has(i)) return
    called.current.add(i)
    const free = isFree(story.points[i])
    const ok = action === story.points[i].answer
    setPicks((arr) => { const b = arr.slice(); b[i] = action; return b })
    // a call the plan leaves to the member is neither right nor wrong: no takeover, no flash, the tap's own sound
    setOpen({ i, takeover: !free && !ok })
    clearTimeout(flashT.current)
    if (free) { setFlash(null); tapFeedback(prefs); return }
    setFlash(ok ? 'ok' : 'bad'); flashT.current = setTimeout(() => setFlash(null), 700)
    revealFeedback(ok, prefs)
  }, [story, prefs])
  const seeWorking = useCallback(() => setOpen((o) => (o ? { ...o, takeover: false } : o)), [])
  const keepPlaying = useCallback(() => { setOpen(null); showChart(chartBox.current) }, [])

  // the number keys: a setup tile while asking (Enter is Check's own hotkey), a call while the replay waits on one
  useEffect(() => {
    if (stage !== 'ask' || busy) return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || typing(e)) return
      const j = Number(e.key) - 1
      if (Number.isInteger(j) && j >= 0 && j < choices.length) setPick(j)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [stage, busy, choices.length])
  const awaiting = due >= 0 && picks[due] == null && !entryOpen
  useEffect(() => {
    if (!awaiting) return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || typing(e)) return
      const j = Number(e.key) - 1
      if (Number.isInteger(j) && j >= 0 && j < ACTIONS.length) decide(due, ACTIONS[j])
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [awaiting, due, decide])
  useEffect(() => { if (finished) into(resultBox.current) }, [finished])

  // a scored chart whose reveal brought no playable plan is still played (its name counts, it has no calls): not skipped
  const record = () => ({ id: item.id, name: item.name, skill: item.skill, ticker: entry?.ticker || '', long: story ? story.long : true,
    named: !!entry?.named, xp: entry?.xp || 0, story, picks, skipped: false })
  const skip = () => onDone({ id: item.id, name: item.name, skill: item.skill, ticker: '', named: false, xp: 0, story: null, picks: NONE, skipped: true })
  const last = idx + 1 >= total
  const point = due >= 0 ? pts[due] : null
  const before = point ? exitsOf(pts, picks.slice(0, due)) : null
  const missOpen = !!open?.takeover && !!point
  const mine = exitsOf(pts, picks)
  const nowPx = all?.length ? all[all.length - 1].c : null
  const good = finished && (story ? tradeOk(record()) : !!entry?.named)
  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="story-trade" data-stage={stage} data-done={finished ? '1' : '0'}>
      {flash ? <span className={`${s.flash} ${flash === 'ok' ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {stage === 'trade' && entryOpen && entry ? (
        <VerdictTakeover ok={entry.named} title={entryTitle(entry.named, item.name)} answer={entry.named ? null : item.name}
          sub={<span data-testid="story-entry-sub">{entry.ticker ? <><b>{entry.ticker}</b> · </> : null}{plan ? planLine(plan) : NO_PLAN}{entry.named ? null : <> · you said {entry.picked}</>}</span>}
          xp={entry.xp} label={plan ? 'Take the trade' : 'Continue'} onContinue={beginTrade} testId="story-entry" />
      ) : null}
      {missOpen ? (
        <VerdictTakeover ok={false} title="Not the plan." answer={actionLabel(point.answer, story.long)}
          sub={<span data-testid="story-miss-why">{whyOf(point, picks[due], plan).text}</span>} label="See the working" onContinue={seeWorking} testId="story-miss" />
      ) : null}
      <HudCombo label="Trade Story" unit="trade" scoreWord="on plan" step={idx} total={total} results={results} live={stage === 'ask'} stepTestId="story-step" />
      <div className={s.heroChart} ref={chartBox}>
        <StudyChart id={item.id} bars={all} view={view} height={phone ? 340 : 480} callouts={callouts} calloutLook={look} symbol={entry?.ticker || null}
          masked={stage === 'ask' || !entry?.ticker} annotations={lines} markers={marks} frameEnd={stage === 'ask' ? null : all?.[all.length - 1]?.t} />
        <ReplayClock clock={clock} tfMin={intraday?.tf || 30} testId="story-clock" />
      </div>
      {stage === 'ask' ? (
        <>
          <AnswerLessonApp choices={choices} pick={pick} state="ask" busy={busy} hotkey onCheck={check}
            onPick={(i) => { if (!busy) { setPick(i); tapFeedback(prefs) } }}
            eyebrow={<>Trade {idx + 1} of {total} · Daily · ticker hidden</>} question={ENTRY_Q} detail={phone ? null : ENTRY_DETAIL}
            cardsTestId="story-cards" checkTestId="story-check" />
          {failed ? (
            <p className={g.skipLine} role="alert" data-testid="story-failed">
              {failed.out ? 'You are signed out, so this chart could not be scored.' : NOT_SCORED}
              <StudyButton kind="secondary" onClick={skip} testId="story-skip">Skip</StudyButton>
            </p>
          ) : null}
          {failed?.out && signedOut ? <div className={g.way}>{signedOut}</div> : null}
        </>
      ) : null}
      {point && !entryOpen ? (
        <StopCard key={`${due}-${point.id}`} point={point} pick={picks[due] ?? null} plan={plan} long={story.long} inPosition={!before.out}
          position={positionLine(before)} missOpen={missOpen} last={due === pts.length - 1 && story.end.kind !== 'open'}
          onPick={(a) => decide(due, a)} onGo={keepPlaying} />
      ) : null}
      {stage === 'trade' && !entryOpen && story ? <PositionBar word={positionWord(mine)} r={rAt(plan, nowPx)} stop={stopAt(story, plan, k)} /> : null}
      {finished ? (
        <>
          {story ? <TradeResult story={story} picks={picks} name={item.name} ticker={entry?.ticker || ''} boxRef={resultBox} />
            : <p className={g.nothing} data-testid="story-no-plan" ref={resultBox}>{NO_PLAN}</p>}
          <div className={sa.area}>
            <div className={`${sa.lFoot} ${good ? sa.footOk : sa.footBad}`}>
              <StudyButton kind={good ? 'good' : 'bad'} size="xl" arrow wide hotkey="Enter" onClick={() => onDone(record())} testId="story-next">{last ? 'See the run' : 'Next trade'}</StudyButton>
            </div>
          </div>
        </>
      ) : null}
      {stage === 'trade' && !entryOpen && plan ? <PlanKey plan={plan} story={story} k={k} name={item.name} gapHigh={gapHigh} /> : null}
      {stage === 'trade' && !entryOpen && entry && (finished || !entry.named) ? (
        <LessonCard text={entry.lesson} ticker={entry.ticker || null} setup={item.name} skillId={item.skill || null} fired bars={bars}
          setupRule={entry.rule} showReads={false} testId="story-lesson" />
      ) : null}
    </div>
  )
}

export default function TradeStoryGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const phone = useIsPhone()
  const [phase, setPhase] = useState('start')   // start | play | done
  const [pool, setPool] = useState(null)
  const [error, setError] = useState(null)
  const [reload, setReload] = useState(0)
  const [run, setRun] = useState(null)          // { id, items }: the trades, dealt at Start
  const [i, setI] = useState(0)
  const [trades, setTrades] = useState(NONE)
  const [report, setReport] = useState(null)    // the calls' game run: { level, xp } once saved, { failed, out, level } when not
  const runNo = useRef(0)
  const live = useRef(true)
  const current = useRef('')                    // the run id now playing: a late report lands only on its own run
  const posted = useRef(new Set())
  const list = useRef(NONE)
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])
  useEffect(() => {
    let on = true
    // a fresh draw every load (the server shuffles per member and day; the seed makes "New trades" deal new ones)
    Promise.resolve()
      .then(() => fetcher(POOL_URL, { method: 'POST', body: { rounds: STORY_TOTAL, need_plan: true, seed: `story-${Date.now()}` } }))
      .then((set) => { if (on) setPool(poolItems(set, normalizeBars)) })
      .catch((e) => { if (on) { setError(e); setPool(NONE) } })
    return () => { on = false }
  }, [reload, fetcher])
  const count = pool ? Math.min(STORY_TOTAL, pool.length) : STORY_TOTAL

  const start = useCallback(() => {
    if (!pool?.length) return
    const seed = Date.now()
    runNo.current += 1
    const id = runIdOf(seed, runNo.current)
    current.current = id
    list.current = NONE
    beginRunXp()
    setRun({ id, items: pool.slice(0, STORY_TOTAL) }); setI(0); setTrades(NONE); setReport(null); setPhase('play')
  }, [pool])
  const retry = () => { setPool(null); setError(null); setReload((r) => r + 1) }
  const again = () => { setRun(null); setTrades(NONE); setReport(null); retry(); setPhase('start') }

  /** The run's end: the end screen at once, then the calls reported once (POST /game-runs, kind 'story'). */
  const finish = (all, id) => {
    setPhase('done'); endFeedback(prefs)
    const t = tally(all)
    if (!t.total || posted.current.has(id)) { setReport({ level: runXp(), xp: 0 }); return }
    posted.current.add(id)
    const mine = () => live.current && current.current === id
    Promise.resolve()
      .then(() => fetcher(GAME_RUNS_URL, { method: 'POST', body: { kind: STORY_KIND, run_id: id, right: t.right, total: t.total } }))
      .then((res) => {
        if (!mine()) return
        const level = levelAfter(runXp(), res)
        setReport(level ? { level, xp: Number(res?.xp_gained ?? res?.progress?.xp_gained ?? 0) || 0 } : { failed: true, out: false, level: runXp(), xp: 0 })
      })
      .catch((e) => { if (mine()) setReport({ failed: true, out: isSignedOut(e), level: runXp(), xp: 0 }) })
  }
  const onTradeDone = (tr) => {
    if (list.current.length !== i) return          // this trade is already recorded: a second press adds nothing
    const next = [...list.current, tr]
    list.current = next
    setTrades(next)
    if (i + 1 >= run.items.length) finish(next, run.id); else setI(i + 1)
  }

  if (error && isSignedOut(error)) return <ChallengeError what="the Trade Story charts" error={error} signedOut={signedOut} onRetry={retry} />

  if (phase === 'start' || !run) {
    const failed = !!error
    const empty = !failed && pool != null && !pool.length
    const ready = !failed && !!pool?.length
    return (
      <div className={s.kit} style={{ padding: '26px 0 34px' }}>
        <StartArena plate="Story" title="Trade Story" caption="Manage the trade" testId="story-intro" startTestId="story-start" hotkey
          total={count} ready={ready} onStart={start}
          label={failed ? 'The trades did not load' : pool == null ? 'Loading the bank' : ready ? 'Take the first trade' : 'No trades yet'}
          stakes={[{ v: count, l: count === 1 ? 'real trade' : 'real trades', icon: 'chart' }, { v: 'No', l: 'ticker', icon: 'lock' }, { v: '3R · 5R', l: 'trims', icon: 'flag' }]}
          lead={failed ? FAILED_LINE : empty ? EMPTY_LINE : START_LEAD}
          reward={failed || empty ? null : <><Medal size={40} testId={null} /><span>Every call on the plan lights the <b>Legendary</b> medal</span></>}
          howTo={<HowItPlays mode="story" testId="story-howto" steps={[
            { icon: 'eye', title: 'Name the setup', body: 'A real chart from the UCT bank, ticker hidden. Name the setup that fired on the last candle.' },
            { icon: 'play', title: 'Take the trade', body: 'You enter on the setup\'s own plan: the entry, the stop, and the trims at 3R and 5R, drawn on the chart.' },
            { icon: 'flag', title: 'Make the calls', body: 'The replay stops at each moment that matters. Hold, sell a third, or sell the rest. The plan and the account rules score every call.' },
          ]} />}>
          {failed || empty ? (
            <span className={g.way} data-testid={failed ? 'story-load-failed' : 'story-empty'}>
              {failed ? <StudyButton kind="secondary" onClick={retry} testId="story-retry">Try again</StudyButton> : null}
              <StudyButton kind="ghost" onClick={onClose} testId="story-back">Back to Study</StudyButton>
            </span>
          ) : pool == null ? null : <span data-testid="story-bank">{bankLine(count)}</span>}
        </StartArena>
      </div>
    )
  }

  if (phase === 'done') {
    const t = tally(trades)
    const xp = trades.reduce((a, tr) => a + (tr.xp || 0), 0) + (report?.xp || 0)
    const perfect = t.total > 0 && t.right === t.total
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s.kit} ${g.end}`}>
          <EndHard right={t.right} total={t.total} xp={xp} results={t.results} log={logRows(trades)} level={report?.level || null}
            title={storyVerdict(t.right, t.total)} unit="calls on the plan" doneWord="on plan" showSetups={false} againLabel="New trades"
            testIdPrefix="story" onAgain={again} onBack={onClose}>
            <span className={g.endLine} data-testid="story-named">{namedLine(t)}</span>
            {trades.map((tr) => <span key={tr.id} className={g.endLine} data-testid="story-end-trade">{tradeLine(tr)}</span>)}
            {yoursLines(trades).map((l, j) => <span key={`yours-${j}`} className={g.endLine} data-testid="story-end-yours">{l}</span>)}
            {report?.failed ? (
              <span className={g.saved} data-testid="story-not-saved">
                {report.out ? 'You are signed out, so the XP for your calls did not save.' : 'The XP for your calls did not save. Your score still counts here.'}
              </span>
            ) : null}
          </EndHard>
          {report?.failed && report.out && signedOut ? <div className={g.way}>{signedOut}</div> : null}
        </div>
      </>
    )
  }

  const item = run.items[i]
  if (!item) return null
  return (
    <Trade key={`${run.id}-${i}`} idx={i} total={run.items.length} item={item} results={trades.map(tradeOk)} prefs={prefs} fetcher={fetcher} phone={phone}
      signedOut={signedOut} onDone={onTradeDone} />
  )
}
