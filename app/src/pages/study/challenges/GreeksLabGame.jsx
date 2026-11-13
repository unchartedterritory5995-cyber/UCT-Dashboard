// GREEKS LAB (docs/study/GAMES.md §3, kind 'greeks'; the owner picked the options games 2026-11-08 and asked for games
// that are "really cool and fun and educational and valuable"). A lab of one option on XYZ, a made-up stock: three
// sliders (XYZ's price within 30% of the strike, the days to expiry, implied volatility) and a call/put toggle; the
// option's price and its delta, gamma, theta and vega update live from Black-Scholes, no dividends, a 4% rate, said on
// screen. Every Greek is drawn where it lives: the price across XYZ's range as a curve (delta its slope at the dot), the
// expiry hockey stick under it (the gap is time value, what theta eats), and each slider beside the Greek that measures
// it. The last move reads out what one step did, so a covered Greek can still be read off the price.
//
// Five challenges a run, one per station in the course's order (delta, theta, vega, gamma, then time against IV): two or
// three are SET (move one slider until a covered Greek lands in a stated zone; scored on the numbers as the screen shows
// them) and the rest are PICK (the move that does the most, a dollar estimate with its named mistakes, which way IV
// takes the price). Check takes over the screen with the verdict and one line (rule 15): the lesson on a right answer, what
// went wrong on a miss (the takeover cannot scroll, so a second line would push its button off a small phone); "See it in
// the lab" slides the lab to the answer, then the coach's card shows the lesson, the numbers before and after and the
// rule's course unit, and the lab is the member's to play with until Next. A set challenge is fair to its hint: reading
// the covered Greek off the last move, a notch at a time, never lands a member outside the zone (fairToHint). Every number is games/greeksLab.js's, unit tested by hand; XYZ is made up, so no
// market fact is invented. The run's XP is the server's (POST /api/study/game-runs, once at the end); a failed post shows
// the end screen without the level bar and says so.
//
// The one design (OWNER_PRINCIPLES rule 21): the kit's start arena, status line, question header, tiles, Check and Next,
// verdict takeover, coach's card and end screen. The question header sits ABOVE the lab here (a slider game: on a phone
// the lab is taller than the screen, and the question must stay in view of the slider it names). The kit lacks only the
// lab itself: GreeksLabGame.module.css, on the kit's own tokens.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { useIsPhone } from '../../../hooks/useBreakpoint'
import { HudCombo } from '../ui/HudLooks'
import { StartArena } from '../ui/StartLooks'
import HowItPlays from '../ui/HowItPlays'
import { EndHard } from '../ui/EndLooks'
import { Medal } from '../ui/Medal'
import Prompt from '../ui/Prompt'
import Stamp from '../ui/Stamp'
import StudyButton from '../ui/StudyButton'
import Tile from '../ui/Tile'
import VerdictTakeover from '../ui/VerdictTakeover'
import { Confetti } from '../ui/Stage'
import s from '../ui/study.module.css'
import sa from '../ui/answerLooks.module.css'
import { isSignedOut } from './ChallengeError'
import { endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import {
  GREEKS_BEST_KEY, GREEKS_KIND, GREEKS_TOTAL, MODEL_LINE, SLIDER_NAMES, STATIONS, TICKER, buildRun, curveOf,
  dollars, fmtDelta, fmtGamma, fmtStock, intrinsic, measureText, money, priceParts, rowsOf, runIdOf, scoreSet, setLine, shown,
  sliderOf, sliderText, snapState, snapTo, stepOf, stepText, verdictOf, zoneText,
} from './games/greeksLab'
import g from './GreeksLabGame.module.css'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: GREEKS_KIND, title: 'Greeks Lab', sub: 'One option, three sliders, five challenges. Watch delta, theta and vega move.', icon: 'sliders', plate: 'Greeks', accent: 'amber', group: 'skill' }

const GAME_RUNS_URL = '/api/study/game-runs'
const SLIDERS = ['S', 'days', 'iv']
const CHIPS = { S: ['delta', 'gamma'], days: ['theta'], iv: ['vega'] }
const GREEK = {
  delta: { name: 'Delta', what: `per $1 of ${TICKER}`, text: (v) => fmtDelta(v) },
  gamma: { name: 'Gamma', what: 'delta\'s change per $1', text: (v) => fmtGamma(v) },
  theta: { name: 'Theta', what: 'one calendar day', text: (v) => money(v) },
  vega: { name: 'Vega', what: 'one point of IV', text: (v) => money(v) },
}
const STATION_NAME = Object.fromEntries(STATIONS.map((st) => [st.key, st.name]))
const MOVE_WORD = { S: 'stock', days: 'days', iv: 'IV' }
const GLIDE_FRAMES = 14
const GLIDE_MS = 45

const readBest = () => { try { return Number(localStorage.getItem(GREEKS_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(GREEKS_BEST_KEY, String(v)) } catch { /* no storage */ } }
const scrollTo = (el, block) => { try { if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block, behavior: 'smooth' }) } catch { /* an old engine without options */ } }
const reducedMotion = () => { try { return !!window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches } catch { return false } }
const sameState = (a, b) => !!a && !!b && a.type === b.type && a.K === b.K && a.S === b.S && a.days === b.days && a.iv === b.iv

/** The server's answer to the run as the end screen's level bar, or null when it is not one (then the XP did not save). */
function levelOf(res) {
  const after = res?.progress?.xp
  const gained = Number(res?.xp_gained ?? res?.progress?.xp_gained ?? 0)
  return typeof after === 'number' && Number.isFinite(after) && Number.isFinite(gained) ? { before: after - gained, after } : null
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
  return Math.max(260, Math.min(900, w))
}

/** The price across XYZ's slider range today (gold), on expiry day (dashed), the strike, and the option where it stands:
 *  a dot on the curve, the gap down to the expiry line (its time value) and the tangent whose slope is delta. Labels
 *  live on the axes only; the legend says what each line is, so nothing is ever written over a line. */
function Curve({ st, phone, covered }) {
  const figRef = useRef(null)
  const clip = `greeks-clip-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const W = useBoxWidth(figRef, phone ? 320 : 480)
  const c = useMemo(() => curveOf(st), [st])
  const H = phone ? 180 : 290
  const L = 46, R = 12, T = 12, B = 28
  const pw = W - L - R, ph = H - T - B
  const X = (x) => L + ((x - c.x0) / (c.x1 - c.x0)) * pw
  // never clamped: the tangent's ends may fall under $0 or over the top, and the clip trims them there, so its drawn
  // slope stays delta's own
  const Y = (y) => T + ((c.y1 - y) / (c.y1 - c.y0)) * ph
  const line = (pts) => pts.map((p, i) => `${i ? 'L' : 'M'} ${X(p.x).toFixed(1)} ${Y(p.y).toFixed(1)}`).join(' ')
  const dx = (c.x1 - c.x0) * 0.09
  const tan = [{ x: st.S - dx, y: c.at.y - c.at.delta * dx }, { x: st.S + dx, y: c.at.y + c.at.delta * dx }]
  const ex = X(st.S), ey = Y(c.at.y), iy = Y(intrinsic(st.type, st.S, st.K))
  const kx = X(st.K)
  const slopeHidden = covered.includes('delta')
  const aria = `The ${TICKER} ${st.K} ${st.type}: today's price across ${TICKER} ${fmtStock(c.x0)} to ${fmtStock(c.x1)}, and its value at expiry. At ${fmtStock(st.S)} it is worth ${money(shown(st).price)}.`
  return (
    <figure className={g.plot} ref={figRef} data-testid="greeks-curve">
      <svg viewBox={`0 0 ${W} ${H}`} className={g.svg} role="img" aria-label={aria}>
        <defs><clipPath id={clip}><rect x={L} y={T} width={pw} height={ph} /></clipPath></defs>
        {c.ticks.map((t) => (
          <g key={t}>
            {t > 0 ? <line x1={L} x2={W - R} y1={Y(t)} y2={Y(t)} className={g.grid} /> : null}
            <text x={L - 8} y={Y(t) + 4} className={g.yTick}>{dollars(t)}</text>
          </g>
        ))}
        <line x1={L} x2={W - R} y1={T + ph} y2={T + ph} className={g.axis} />
        <line x1={kx} x2={kx} y1={T} y2={T + ph} className={g.strike} />
        <text x={kx} y={T + ph + 19} textAnchor="middle" className={g.xTick}>{st.K} strike</text>
        <text x={L} y={T + ph + 19} textAnchor="start" className={g.xTickDim}>{fmtStock(c.x0)}</text>
        <text x={W - R} y={T + ph + 19} textAnchor="end" className={g.xTickDim}>{fmtStock(c.x1)}</text>
        <g clipPath={`url(#${clip})`}>
          <path d={line(c.expiry)} className={g.expiry} data-testid="greeks-expiry-line" />
          <path d={line(c.today)} className={g.today} data-testid="greeks-today-line" />
          {Math.abs(iy - ey) > 4 ? <line x1={ex} x2={ex} y1={ey} y2={iy} className={g.tv} /> : null}
          <path d={line(tan)} className={g.tangent} data-testid="greeks-tangent" />
          <line x1={ex} x2={ex} y1={ey} y2={T + ph} className={g.guide} />
        </g>
        <circle cx={ex} cy={ey} r={6} className={g.dot} />
      </svg>
      <figcaption className={g.legend}>
        <span><i className={g.swToday} />Today</span>
        <span><i className={g.swExpiry} />At expiry</span>
        <span><i className={g.swTv} />Time value</span>
        <span><i className={g.swTangent} />{slopeHidden ? 'Slope: delta' : `Slope: delta ${fmtDelta(shown(st).delta)}`}</span>
      </figcaption>
    </figure>
  )
}

function Chip({ k, value, covered }) {
  const G = GREEK[k]
  return (
    <div className={`${g.chip} ${covered ? g.covered : ''}`} data-testid={`greeks-${k}`} data-covered={covered ? '1' : '0'}>
      <span className={g.chipName}>{G.name}</span>
      <b className={g.chipValue} aria-label={covered ? `${G.name} covered` : undefined}>
        {covered ? <><UIcon name="lock" size={15} gold={false} />?</> : G.text(value)}
      </b>
      <small>{G.what}</small>
    </div>
  )
}

/** One slider: its name and value, the range with a step down and a step up (44px each, for a finger), and the Greeks it
 *  drives. A native range input, so the arrows, Page Up and Down, Home and End all work; Enter presses the action. */
function Row({ k, st, n, on, live, covered, onSet, onEnter }) {
  const id = useId()
  const spec = sliderOf(k, st.K)
  const v = st[k]
  const pct = ((v - spec.min) / (spec.max - spec.min)) * 100
  const set = (x) => { const next = snapTo(k, st.K, x); if (next !== v) onSet(k, next) }
  const kAt = (st.K - spec.min) / (spec.max - spec.min)
  return (
    <div className={`${g.row} ${live ? g.rowLive : ''} ${on ? '' : g.rowLocked}`} data-testid={`greeks-row-${k}`} data-live={live ? '1' : '0'}>
      <div className={g.rowHead}>
        <label htmlFor={id} className={g.rowName}>{SLIDER_NAMES[k]}</label>
        {live ? <span className={g.yourMove}><UIcon name="sliders" size={12} gold={false} />Your move</span> : null}
        {!on ? <span className={g.lockTag}><UIcon name="lock" size={11} gold={false} />Locked</span> : null}
        <output htmlFor={id} className={g.rowValue} data-testid={`greeks-value-${k}`}>{sliderText(k, v)}</output>
      </div>
      <div className={g.rangeWrap}>
        <button type="button" className={g.nudge} aria-label={`${SLIDER_NAMES[k]}, one step down`} disabled={!on || v <= spec.min} onClick={() => set(v - spec.step)}>
          <UIcon name="chevronLeft" size={18} gold={false} />
        </button>
        <div className={g.rangeBox}>
          {k === 'S' ? <i className={g.strikeMark} style={{ '--at': kAt.toFixed(4) }} aria-hidden="true" /> : null}
          <input id={id} type="range" className={g.range} min={spec.min} max={spec.max} step={spec.step} value={v} disabled={!on}
            style={{ '--fill': `${pct}%` }} aria-valuetext={sliderText(k, v)} data-testid={`greeks-slider-${k}`}
            onChange={(e) => set(Number(e.target.value))}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.repeat && onEnter) { e.preventDefault(); onEnter() } }} />
        </div>
        <button type="button" className={g.nudge} aria-label={`${SLIDER_NAMES[k]}, one step up`} disabled={!on || v >= spec.max} onClick={() => set(v + spec.step)}>
          <UIcon name="chevronRight" size={18} gold={false} />
        </button>
      </div>
      <div className={g.chips}>
        {CHIPS[k].map((c) => <Chip key={c} k={c} value={n[c]} covered={covered.includes(c)} />)}
      </div>
    </div>
  )
}

/** The lab: the option, its price, the curve, the last move and the three sliders. */
function Lab({ st, step, open, live, covered, phone, onSet, onType, onEnter, boxRef }) {
  const n = shown(st)
  const parts = priceParts(st)
  const t = stepText(step)
  return (
    <div className={`${s.heroChart} ${g.lab}`} ref={boxRef} data-testid="greeks-lab" data-open={open ? '1' : '0'}>
      <header className={g.head}>
        <span className={g.plate} data-testid="greeks-option">{TICKER} {st.K} {st.type}</span>
        <div className={g.toggle} role="group" aria-label="Call or put">
          {['call', 'put'].map((ty) => (
            <button key={ty} type="button" aria-pressed={st.type === ty} disabled={!open} onClick={() => onType(ty)} data-testid={`greeks-type-${ty}`}>
              {ty === 'call' ? 'Call' : 'Put'}
            </button>
          ))}
        </div>
        <span className={g.model} data-testid="greeks-model">{MODEL_LINE}</span>
      </header>
      <div className={g.body}>
        <div className={g.left}>
          <div className={g.price}>
            <span className={g.priceLabel}>Option price, a share</span>
            <b data-testid="greeks-price">{money(parts.price)}</b>
            <span className={g.priceSub} data-testid="greeks-parts">{dollars(parts.contract)} a contract · intrinsic {money(parts.intrinsic)} · time value {money(parts.timeValue)}</span>
            {parts.timeValue < 0 ? <span className={g.priceNote} data-testid="greeks-under">Under its intrinsic value: this model pays a put&apos;s strike only at expiry, and the 4% rate discounts it. A listed stock option can be exercised early, so it holds its intrinsic value.</span> : null}
          </div>
          <Curve st={st} phone={phone} covered={covered} />
        </div>
        <div className={g.panel}>
          <div className={g.last} data-testid="greeks-last">
            <span className={g.lastTag}>Last move</span>
            {t ? (
              <>
                <b>{t.move}</b>
                <span>price <b className={step.change > 0 ? g.up : step.change < 0 ? g.down : ''}>{t.change}</b></span>
                {t.per ? <em>{t.per}</em> : null}
              </>
            ) : <span className={g.lastIdle}>Move a slider: what one step does shows here.</span>}
          </div>
          {SLIDERS.map((k) => (
            <Row key={k} k={k} st={st} n={n} on={open || k === live} live={k === live} covered={covered} onSet={onSet} onEnter={onEnter} />
          ))}
        </div>
      </div>
    </div>
  )
}

/** The lesson, in the kit's coach card: the rule in one line, the mistake on a miss, the numbers before and after, what
 *  each move did, the working, the note and the course unit; then the lab is the member's until Next. */
function Lesson({ ch, ok, picked, rows, cols, onReplay, gliding }) {
  const allMoves = ch.mode === 'pick' && ch.choices.every((c) => c.result)
  return (
    <section className={s.coach} data-testid="greeks-lesson" aria-label="The lesson">
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>The lesson · {STATION_NAME[ch.station]}</span>
          <h3 className={s.coachTitle} data-testid="greeks-lesson-line">{ch.lesson}</h3>
        </div>
      </header>
      {!ok && picked?.why ? <p className={g.mistake} data-testid="greeks-mistake">{picked.why}</p> : null}
      <div className={g.ba} data-testid="greeks-before-after">
        <div className={g.baHead}><span /><span>{cols[0]}</span><span aria-hidden="true" /><span>{cols[1]}</span></div>
        {rows.map((r) => (
          <div key={r.key} className={`${g.baRow} ${r.main ? g.baMain : ''}`} data-testid={`greeks-ba-${r.key}`}>
            <span>{r.label}</span><b>{r.before}</b><i aria-label="to">→</i><b>{r.after}</b>
          </div>
        ))}
      </div>
      {allMoves ? (
        <ul className={g.moves} aria-label="What each move did" data-testid="greeks-moves">
          {ch.choices.map((c) => (
            <li key={c.label} className={c.right ? g.moveRight : ''}>
              <span>{c.label}</span><b>{c.result}</b>{c.right ? <UIcon name="check" size={15} gold={false} /> : <i aria-hidden="true" />}
            </li>
          ))}
        </ul>
      ) : null}
      {ch.working ? <ol className={s.steps}>{ch.working.map((w, i) => <li key={i}><i>{i + 1}</i><span>{w}</span></li>)}</ol> : null}
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>The numbers</span>
        <p className={g.note} data-testid="greeks-note">{ch.note}</p>
        <span className={g.source}>From the course · {ch.source}</span>
      </div>
      <div className={g.explore}>
        <span><UIcon name="sliders" size={15} gold={false} />The lab is yours now: move anything, flip call and put.</span>
        <button type="button" onClick={onReplay} disabled={gliding} data-testid="greeks-replay">Show the answer again</button>
      </div>
    </section>
  )
}

function tileState(i, label, pick, state, answer) {
  if (state === 'ask') return pick === i ? 'sel' : 'idle'
  if (label === answer) return 'right'
  if (pick === i) return 'wrong'
  return 'quiet'
}

function Challenge({ idx, ch, results, prefs, onDone }) {
  const phone = useIsPhone()
  const set = ch.mode === 'set'
  const [lab, setLab] = useState(ch.start)
  const [step, setStep] = useState(null)
  const [moved, setMoved] = useState(false)
  const [pick, setPick] = useState(null)
  const [state, setState] = useState('ask')       // ask | ok | bad
  const [said, setSaid] = useState(null)          // the lab as it stood at Check (a set challenge)
  const [takeover, setTakeover] = useState(false)
  const [gliding, setGliding] = useState(false)
  const labRef = useRef(ch.start)
  const glideT = useRef(null)
  const rootRef = useRef(null)
  const boxRef = useRef(null)
  // each challenge opens at its top (the status line and the question); the glide never outlives the challenge
  useEffect(() => { scrollTo(rootRef.current, 'start'); return () => { clearInterval(glideT.current); glideT.current = null } }, [])

  const ok = state === 'ok'
  const revealed = state !== 'ask'
  const open = revealed && !takeover && !gliding
  const picked = !set && pick != null ? ch.choices[pick] : null
  const shownResults = revealed ? [...results, ok] : results
  const last = idx + 1 >= GREEKS_TOTAL
  const zt = set ? zoneText(ch) : null
  const zoneAnswer = set ? (ch.live === 'S' ? `${TICKER} ${zt.slider}` : zt.slider) : null
  const target = !revealed ? null : set ? (ok ? said : ch.best) : ch.after

  const put = useCallback((next) => {
    const cur = labRef.current
    labRef.current = next
    setStep(stepOf(cur, next))
    setLab(next)
  }, [])
  const onSet = useCallback((k, v) => { put({ ...labRef.current, [k]: v }); setMoved(true) }, [put])
  const onType = useCallback((ty) => put({ ...labRef.current, type: ty }), [put])

  /** The lab slides from where it stands to `to`, a few frames, then the last move reads the whole move. */
  const glide = useCallback((from, to) => {
    clearInterval(glideT.current)
    if (sameState(from, to)) { glideT.current = null; setGliding(false); return }
    const done = () => { glideT.current = null; labRef.current = to; setLab(to); setStep(stepOf(from, to)); setGliding(false) }
    if (reducedMotion()) { done(); return }
    setGliding(true)
    let k = 0
    glideT.current = setInterval(() => {
      k += 1
      if (k >= GLIDE_FRAMES) { clearInterval(glideT.current); done(); return }
      const t = 1 - (1 - k / GLIDE_FRAMES) ** 3
      const mid = snapState({ ...to, S: from.S + (to.S - from.S) * t, days: from.days + (to.days - from.days) * t, iv: from.iv + (to.iv - from.iv) * t })
      labRef.current = mid
      setLab(mid)
    }, GLIDE_MS)
  }, [])

  const check = () => {
    if (state !== 'ask') return
    let right
    if (set) {
      if (!moved) return
      right = scoreSet(ch, labRef.current).ok
      setSaid(labRef.current)
    } else {
      if (picked == null) return
      right = picked.right
    }
    // the slider locks under the takeover: let go of its focus so Enter reaches the takeover's button in every browser
    const el = typeof document !== 'undefined' ? document.activeElement : null
    if (el && boxRef.current?.contains(el) && typeof el.blur === 'function') el.blur()
    setState(right ? 'ok' : 'bad'); setTakeover(true); revealFeedback(right, prefs)
  }
  const seeLab = () => {
    setTakeover(false)
    glide(labRef.current, set ? (ok ? said : ch.best) : ch.after)
    scrollTo(boxRef.current, 'nearest')
  }
  const next = () => {
    const row = set
      ? { name: ch.title, ticker: STATION_NAME[ch.station], ok, said: ok ? null : saidText(ch, said), was: ok ? '' : zt.measure }
      : { name: ch.title, ticker: STATION_NAME[ch.station], ok, said: ok ? null : picked?.label, was: ok ? '' : ch.answer }
    onDone(ok, row)
  }
  const onEnter = () => { if (state === 'ask') check(); else if (open) next() }

  // number keys pick a tile while a pick challenge asks (Enter is the action button's own hotkey, so it fires once)
  useEffect(() => {
    if (set || state !== 'ask') return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey || (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))) return
      const i = +e.key - 1
      if (Number.isInteger(i) && i >= 0 && i < ch.labels.length) { setPick(i); tapFeedback(prefs) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [set, state, ch.labels, prefs])

  const headline = !revealed ? '' : set ? (ok ? 'In the zone.' : 'Outside the zone.') : (picked?.headline || (ok ? 'Right.' : 'Not this one.'))
  const why = !revealed ? '' : set
    ? `${setLine(ch, said)}${ok ? '' : ` The zone is ${zt.measure}.`}`
    : (ok ? ch.note : (picked?.why || ch.note))
  // the takeover is a fixed box that cannot scroll, so it holds the verdict and ONE line (a second one pushes its only
  // button off a small phone): the lesson on a right answer, what went wrong on a miss. The coach's card has the rest.
  const tkLine = ok
    ? <span className={g.tkLesson} data-testid="greeks-takeover-lesson">{ch.lesson}</span>
    : <span className={g.tkWhy} data-testid="greeks-takeover-why">{why}</span>
  const promptSub = !revealed ? null : set
    ? (ok ? <>{setLine(ch, said)} · <b>{zt.measure}</b> counts</> : <>The zone: <b>{zoneAnswer}</b> · you set {sliderText(ch.live, said[ch.live])}</>)
    : (ok ? <><b>{ch.answer}</b> · {ch.title}</> : <>The answer was <b>{ch.answer}</b> · you said {picked?.label}</>)
  const stampWord = ok ? (set ? 'Set' : 'Right') : null
  const rows = revealed ? rowsOf(ch, set ? (ok ? ch.start : said) : ch.start, target) : []
  const cols = set ? (ok ? ['Start', 'You set'] : ['You set', 'In the zone']) : ['Before', 'After']
  const enabledLive = state === 'ask' && set ? ch.live : null
  const covered = state === 'ask' ? (ch.covered || []) : []
  const eyebrow = <>Challenge {idx + 1} of {GREEKS_TOTAL} · {STATION_NAME[ch.station]} · {set ? 'set it' : 'pick one'}</>

  return (
    <div className={`${s.kit} ${s.screen} ${g.game}`} ref={rootRef} data-testid="greeks-play" data-state={state} data-mode={ch.mode} data-kind={ch.kind}>
      {revealed ? <span className={`${s.flash} ${ok ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {revealed && takeover ? (
        <VerdictTakeover ok={ok} title={headline} answer={set ? (ok ? null : zoneAnswer) : (ok ? picked?.label : ch.answer)} stampWord={stampWord}
          sub={tkLine}
          label="See it in the lab" onContinue={seeLab} testId="greeks-takeover" />
      ) : null}
      <HudCombo label="Greeks Lab" unit="Challenge" scoreWord="right" step={idx} total={GREEKS_TOTAL} results={shownResults} live={state === 'ask'} stepTestId="greeks-step" />
      <div className={`${sa.area} ${sa.lesson}`}>
        {revealed ? (
          <Prompt mood={ok ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={headline} sub={promptSub} seal={<Stamp ok={ok} word={stampWord} inline />} />
        ) : (
          <div className={sa.lHead}>
            <span className={sa.lEyebrow}>{eyebrow}</span>
            <h2 className={sa.lQ} data-testid="greeks-question">{ch.question}</h2>
            <p className={sa.lDetail} data-testid="greeks-detail">{ch.detail}</p>
          </div>
        )}
      </div>
      <Lab st={lab} step={step} open={open} live={enabledLive} covered={covered} phone={phone} onSet={onSet} onType={onType} onEnter={onEnter} boxRef={boxRef} />
      <div className={`${sa.area} ${sa.lesson}`}>
        {set ? null : (
          <div className={sa.lGrid} role="group" aria-label="Your answer" data-testid="greeks-cards" data-tiles="">
            {ch.labels.map((c, i) => (
              <Tile key={c} n={i + 1} i={i} label={c} state={tileState(i, c, pick, state, revealed ? ch.answer : null)} disabled={revealed}
                onClick={() => { if (state === 'ask') { setPick(i); tapFeedback(prefs) } }} />
            ))}
          </div>
        )}
        {revealed && !takeover ? <Lesson ch={ch} ok={ok} picked={picked} rows={rows} cols={cols} gliding={gliding} onReplay={() => glide(labRef.current, target)} /> : null}
        <div className={`${sa.lFoot} ${ok ? sa.footOk : state === 'bad' ? sa.footBad : ''}`}>
          {state === 'ask' ? (
            <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" disabled={set ? !moved : pick == null} onClick={check} testId="greeks-check"
              sub={set && !moved ? `move the ${MOVE_WORD[ch.live]} slider first` : null}>Check</StudyButton>
          ) : (
            <StudyButton kind={ok ? 'good' : 'bad'} size="xl" arrow wide hotkey={takeover ? null : 'Enter'} onClick={next} testId="greeks-next">{last ? 'See the run' : 'Next'}</StudyButton>
          )}
        </div>
      </div>
    </div>
  )
}

/** A set challenge's try for the run log: "delta 0.38 at $95", "$0.05 a day at 60 days", "gamma 0.031 at $90". */
function saidText(ch, st) {
  if (!st) return ''
  const m = measureText(ch.measure, scoreSet(ch, st).value)
  const at = sliderText(ch.live, st[ch.live])
  if (ch.measure === 'decay') return `${m} a day at ${at}`
  return `${ch.measure} ${m} at ${at}`
}

export default function GreeksLabGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')     // start | play | done | empty
  const [seed, setSeed] = useState(null)
  const [run, setRun] = useState([])
  const [i, setI] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  const [report, setReport] = useState(null)      // the run's XP: { level, gained } once saved, { failed, out } when not
  const [best, setBest] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0)
  const alive = useRef(true)
  const current = useRef(null)                    // the run on screen: a late answer for an older run is dropped
  const posted = useRef(null)                     // the run already reported: one post per run (a resend would read +0 XP)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])

  // the component seeds once at start (GAMES.md §1.7); the pure module never reads the clock. A run that cannot be dealt
  // is an honest empty state with a way back, never a crash
  const start = () => {
    const sd = Date.now()
    let dealt = []
    try { dealt = buildRun(sd) } catch { dealt = [] }
    current.current = sd; posted.current = null
    setSeed(sd); setRun(dealt); setI(0); setResults([]); setLog([]); setReport(null); setBestBefore(readBest())
    setPhase(dealt.length ? 'play' : 'empty')
  }

  const finish = (all, rows) => {
    const right = all.filter(Boolean).length
    const total = all.length
    const mine = seed
    setResults(all); setLog(rows); setPhase('done'); endFeedback(prefs)
    const prev = readBest()
    if (right > prev) writeBest(right)
    setBest(Math.max(prev, right))
    if (posted.current === mine) return
    posted.current = mine
    // the run's XP, once (idempotent on run_id on the server); whatever it answers, the end screen is already up
    Promise.resolve()
      .then(() => fetcher(GAME_RUNS_URL, { method: 'POST', body: { kind: GREEKS_KIND, run_id: runIdOf(mine), right, total } }))
      .then((res) => {
        if (!alive.current || current.current !== mine) return
        const level = levelOf(res)
        setReport(level ? { level, gained: level.after - level.before } : { failed: true, out: false })
      })
      .catch((e) => { if (alive.current && current.current === mine) setReport({ failed: true, out: isSignedOut(e) }) })
  }

  if (phase === 'start') {
    return (
      <div className={s.kit} style={{ padding: '26px 0 34px' }}>
        <StartArena plate="Greeks" title="Greeks Lab" caption="Which slider moves it most?" testId="greeks-intro" startTestId="greeks-start" hotkey
          total={GREEKS_TOTAL} ready onStart={start} label="Open the lab"
          stakes={[{ v: GREEKS_TOTAL, l: 'challenges', icon: 'flag' }, { v: 3, l: 'sliders', icon: 'sliders' }, { v: 4, l: 'Greeks', icon: 'eye' }]}
          lead={<>One option on {TICKER}, a made-up stock. Slide the stock, the days and IV, and watch its price and Greeks move. {MODEL_LINE}.</>}
          reward={<><Medal size={40} testId={null} /><span><b>{GREEKS_TOTAL} for {GREEKS_TOTAL}</b> lights the Legendary medal · your best <b data-testid="greeks-best">{best}</b></span></>}
          howTo={<HowItPlays mode="greeks" testId="greeks-howto" steps={[
            { icon: 'sliders', title: 'Work the lab', body: `Three sliders: ${TICKER}'s price, the days to expiry and IV. The price, delta, gamma, theta and vega update as you move them.` },
            { icon: 'flag', title: 'Take the challenge', body: 'Set a slider to hit a number, or pick the move that does the most. Step a notch at a time and a covered Greek reads off the last move. Number keys pick, Enter checks.' },
            { icon: 'eye', title: 'See it move', body: 'The lab slides to the answer with the numbers before and after and the one-line lesson. Then it is yours to play with.' },
          ]} />}>
          <span>Fresh challenges every run · delta, theta, vega, gamma, then time against IV</span>
        </StartArena>
      </div>
    )
  }

  if (phase === 'empty') {
    return (
      <div className={s.kit}>
        <div className={g.empty} data-testid="greeks-empty" role="status">
          <span className={g.emptyIcon}><UIcon name="sliders" size={30} gold={false} /></span>
          <h2>No challenges in the lab right now.</h2>
          <p>The lab could not deal this run. Deal a fresh one, or head back to Study.</p>
          <div className={g.emptyActions}>
            <StudyButton kind="primary" size="xl" arrow onClick={start} testId="greeks-retry">Deal a fresh run</StudyButton>
            <StudyButton kind="ghost" onClick={onClose} testId="greeks-back">Back to Study</StudyButton>
          </div>
        </div>
      </div>
    )
  }

  if (phase === 'done') {
    const right = results.filter(Boolean).length
    const total = results.length
    const perfect = total === GREEKS_TOTAL && right === total
    const newBest = right > 0 && right > bestBefore
    const failed = !!report?.failed
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={`${s.kit} ${g.end}`}>
          <EndHard right={right} total={total} xp={report?.gained || 0} results={results} log={log} level={report?.level || null}
            title={verdictOf(right, total)} unit="right in the lab" doneWord="right" showSetups={false} medal
            againLabel="Run it again" testIdPrefix="greeks" onAgain={start} onBack={onClose}>
            <span className={g.endNote} data-testid="greeks-best-line">
              {perfect ? <><b>Five for five.</b> Delta, theta, vega and gamma, all in hand.</>
                : newBest ? <><b>Your best run.</b> {right} of {GREEKS_TOTAL} right.</>
                  : <>Your best stands at <b>{best}</b> of {GREEKS_TOTAL}.</>}
            </span>
            {failed ? (
              <span className={g.endSave} data-testid="greeks-not-saved">
                {report.out ? 'You are signed out, so this run earned no XP.' : 'This run\'s XP did not save. Your score and best still count here.'}
              </span>
            ) : null}
          </EndHard>
          {failed && report.out && signedOut ? <div className={g.signIn}>{signedOut}</div> : null}
        </div>
      </>
    )
  }

  const ch = run[i]
  if (!ch) return null
  return (
    <Challenge key={`${seed}-${i}`} idx={i} ch={ch} results={results} prefs={prefs}
      onDone={(ok, row) => {
        const all = [...results, !!ok]
        const rows = [...log, row]
        if (all.length >= run.length) finish(all, rows)
        else { setResults(all); setLog(rows); setI(i + 1) }
      }} />
  )
}
