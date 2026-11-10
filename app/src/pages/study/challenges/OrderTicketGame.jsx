// ORDER TICKET (docs/study/GAMES.md §3, kind 'ticket'; built on the contract in §1). Eight trade situations, three hearts.
// Each one is two sentences in a mentor's voice and a practice quote (the bid, the ask, the last trade and the level the
// situation names, drawn on a price ladder); the member fills the ticket: the side (Buy, Sell, Sell short, Buy to cover),
// the order type (Market, Limit, Stop, Stop-limit) and the price (the right one and two named mistakes). All three right
// scores. Check takes over the screen (rule 15): on a miss it shows the right ticket, each field marked right or wrong
// and the first wrong field's lesson (kept short: the takeover cannot scroll, and its button must stay on a phone's
// screen), and a heart goes; the review then draws the right order on the ladder against the market, marks each field,
// and gives the whole working with the rule it comes from (the SEC's order definitions in plain words, course units
// F10.01 and F10.02, and our entry, a market order once it trades through the trigger; a buy stop a cent over as the order
// that automates it). Every number is games/orderTicket.js's, dealt once
// from a seed at the start. The run reports itself once at the end (POST /api/study/game-runs) and the end screen's level
// bar shows what the server granted; a failed report leaves the end screen whole, without the bar, and an answer for an
// earlier run never lands on a later one. The hearts are the kit's (UIcon's shield, as in Options Payoff). The best run
// lives on this device.
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
import t from './OrderTicketGame.module.css'
import { isSignedOut } from './ChallengeError'
import { comboFeedback, endFeedback, feedbackPrefs, revealFeedback, tapFeedback } from '../studyFeedback'
import { studyFetch } from '../useStudySession'
import {
  FIELDS, LABEL_CHAR_W, LABEL_CHAR_W_WIDE, SIDES, TICKET_BEST_KEY, TICKET_HEARTS, TICKET_TOTAL, TYPES, buildRun, fmt, heartsLeft,
  labelFit, ladderOf, orderMarks, runOver, runPost, scoreTicket, verdictMiss, working,
} from './games/orderTicket'

// eslint-disable-next-line react-refresh/only-export-components -- the build contract (GAMES.md §4): the deck and the sheet register a game from this one export
export const GAME = { kind: 'ticket', title: 'Order Ticket', sub: 'Eight trade situations. Fill the ticket: the side, the order type and the price.', icon: 'document', plate: 'Ticket', accent: 'green', group: 'skill' }

const GAME_RUNS_URL = '/api/study/game-runs'
const FIELD_LABEL = { side: 'Side', type: 'Order type', price: 'Price' }
const readBest = () => { try { return Number(localStorage.getItem(TICKET_BEST_KEY)) || 0 } catch { return 0 } }
const writeBest = (v) => { try { localStorage.setItem(TICKET_BEST_KEY, String(v)) } catch { /* no storage */ } }
const pct = (x) => `${(x * 100).toFixed(3)}%`
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`
const streakOf = (results) => { let n = 0; for (let k = results.length - 1; k >= 0 && results[k] === true; k--) n += 1; return n }

/** The hearts, in the kit's look (Options Payoff's): a gold shield for each one left, a dim one for each one lost. */
function Hearts({ left, total = TICKET_HEARTS }) {
  return (
    <span className={t.hearts} role="img" aria-label={`${plural(left, 'heart')} left`} data-testid="ticket-hearts" data-left={left}>
      {Array.from({ length: total }, (_, k) => (
        <i key={k} className={`${t.heart} ${k < left ? t.heartOn : t.lost}`}><UIcon name="shield" size={20} gold={false} /></i>
      ))}
    </span>
  )
}

/** Reports the ladder's width in pixels whenever it changes (never in a runner with no layout, where the fixed guess
 *  stands), so its labels stack and hang for the card they are drawn on. */
function useWidthReport(ref, onWidth) {
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined' || !onWidth) return undefined
    const ro = new ResizeObserver((entries) => {
      const w = Math.round(entries[0]?.contentRect?.width || 0)
      if (w > 0) onWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref, onWidth])
}

/** The practice quote and its ladder: the market as a gold block, each level the situation names as a dashed tick, and
 *  after Check the right order (green) and the member's own price (red) hung over the line where they sit. A label on a
 *  card too narrow to hang it whole slides along (its `shift`) while its pin stays on its price. */
function QuoteCard({ sit, marks, fit, ladderW, onLadderW, boxRef }) {
  const lad = useMemo(() => ladderOf(sit, fit), [sit, fit])
  const ladderRef = useRef(null)
  useWidthReport(ladderRef, onLadderW)
  const slide = (shift) => (shift && ladderW ? `${(shift * ladderW).toFixed(1)}px` : undefined)
  const above = marks.length ? 1 + Math.max(...marks.map((m) => m.row)) : 0
  const cells = [
    { key: 'bid', label: 'Bid', cents: sit.quote.bid },
    { key: 'ask', label: 'Ask', cents: sit.quote.ask },
    { key: 'last', label: 'Last', cents: sit.quote.last },
    ...sit.levels.map((l) => ({ key: l.key, label: l.label, cents: l.cents, lit: true })),
  ]
  const mid = (lad.market.from + lad.market.to) / 2
  return (
    <section className={t.quote} aria-label="The quote" data-testid="ticket-quote" ref={boxRef}>
      <header className={t.quoteHead}>
        <span className={t.quoteTag}><UIcon name="chart" size={14} gold={false} />Practice quote</span>
        <span className={t.quoteNote}>Made-up prices, real order rules</span>
      </header>
      <dl className={t.cells}>
        {cells.map((c) => (
          <div key={c.key} className={`${t.cell} ${c.lit ? t.lit : ''}`}>
            <dt>{c.label}</dt><dd data-testid={`quote-${c.key}`}>{fmt(c.cents)}</dd>
          </div>
        ))}
      </dl>
      <div className={t.ladder} style={{ '--above': above, '--below': lad.rowsBelow }} aria-hidden="true" data-testid="ticket-ladder" ref={ladderRef}>
        <i className={t.track} />
        <i className={t.market} style={{ left: pct(mid), width: `max(8px, ${pct(lad.market.to - lad.market.from)})` }} />
        {lad.below.filter((b) => b.kind === 'level').map((b) => <i key={`tick-${b.key}`} className={t.tick} style={{ left: pct(b.x) }} />)}
        {lad.below.map((b) => (
          <span key={b.key} className={`${t.under} ${t[b.anchor]} ${b.kind === 'market' ? t.underMarket : ''}`} style={{ left: pct(b.x + (b.shift || 0)), '--row': b.row }}>{b.text}</span>
        ))}
        {marks.map((m) => (
          <span key={m.key} className={`${t.pin} ${m.tone === 'right' ? t.pinRight : t.pinSaid}`} style={{ left: pct(m.x), '--row': m.row }} data-testid={`ticket-mark-${m.key}`}
            data-row={m.row} data-anchor={m.anchor}>
            <i className={t.stem} /><b className={`${t.flag} ${t[m.anchor]}`} style={{ marginLeft: slide(m.shift) }}>{m.text}</b>
          </span>
        ))}
      </div>
      <div className={t.scale} aria-hidden="true">
        <span><UIcon name="chevronLeft" size={12} gold={false} />lower</span>
        <span>higher<UIcon name="chevronRight" size={12} gold={false} /></span>
      </div>
    </section>
  )
}

/** One field of the ticket: its tiles, lit while it is the one the number keys fill, marked right or wrong after Check. */
function Field({ name, choices, value, answer, active, state, onPick, onFocus, hint }) {
  const asking = state === 'ask'
  const ok = !asking && value === answer
  const tileState = (i) => {
    if (asking) return value === i ? 'sel' : 'idle'
    if (i === answer) return 'right'
    if (i === value) return 'wrong'
    return 'quiet'
  }
  return (
    <div className={`${t.field} ${asking && active ? t.on : ''} ${asking ? '' : ok ? t.fieldOk : t.fieldBad}`} role="radiogroup" aria-label={FIELD_LABEL[name]}
      data-testid={`ticket-field-${name}`} data-active={asking && active ? '1' : '0'} onFocus={onFocus}>
      <div className={t.fieldHead}>
        <span>{FIELD_LABEL[name]}</span>
        {asking ? (active && hint ? <em>{hint}</em> : null) : <UIcon name={ok ? 'check' : 'x'} size={14} gold={false} />}
      </div>
      <div className={`${t.choices} ${choices.length === 4 ? t.four : ''}`}>
        {choices.map((c, i) => (
          <Tile key={c} n={i + 1} i={i} label={c} role="radio" checked={value === i} state={tileState(i)} disabled={!asking}
            onClick={() => onPick(i)} testId={`ticket-${name}-${i}`} className={t.tile} />
        ))}
      </div>
    </div>
  )
}

/** The working, after Check: the right ticket, each field with why it is right and why the member's pick was not, then
 *  the rule and where it comes from. */
function Working({ work }) {
  return (
    <section className={s.coach} data-testid="ticket-working" aria-label="The working">
      <header className={s.coachHead}>
        <img className={s.coachMark} src={brandMark} alt="" aria-hidden="true" />
        <div className={s.coachTitles}>
          <span className={s.eyebrow}>The working</span>
          <h3 className={s.coachTitle}>{work.ticket}</h3>
        </div>
      </header>
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>Field by field</span>
        <ol className={t.rows}>
          {work.rows.map((r) => (
            <li key={r.field} className={`${t.row} ${r.ok ? t.rowOk : t.rowBad}`} data-testid={`ticket-working-${r.field}`}>
              <span className={t.rowMark} aria-hidden="true"><UIcon name={r.ok ? 'check' : 'x'} size={14} gold={false} /></span>
              <span className={t.rowText}>
                <span className={t.rowHead}><small>{r.label}</small><b>{r.right}</b>{r.ok ? null : <em>you said {r.said || 'nothing'}</em>}</span>
                {!r.ok && r.saidWhy ? <span className={t.rowSaid}>{r.saidWhy}</span> : null}
                <span className={t.rowWhy}>{r.why}</span>
              </span>
            </li>
          ))}
        </ol>
      </div>
      <div className={s.coachBlock}>
        <span className={s.coachLabel}>The rule</span>
        <p className={s.rule}>{work.rule}</p>
        {work.house ? <p className={s.rule}>{work.house}</p> : null}
        <p className={t.source}>{work.source}</p>
      </div>
    </section>
  )
}

function Round({ idx, sit, results, prefs, onDone, ladderW, onLadderW }) {
  const phone = useIsPhone()
  const [pick, setPick] = useState({ side: null, type: null, price: null })
  const [active, setActive] = useState('side')
  const [state, setState] = useState('ask')        // ask | ok | bad
  const [takeover, setTakeover] = useState(false)  // the verdict holds the whole screen until the member opens the review
  const quoteBox = useRef(null)
  const top = useRef(null)
  const asking = state === 'ask'
  // the ladder's labels stack and hang for the card's measured width; until it is measured, a fixed guess for the screen
  const fit = useMemo(() => (ladderW > 0 ? labelFit(ladderW) : phone ? LABEL_CHAR_W : LABEL_CHAR_W_WIDE), [ladderW, phone])
  const ok = state === 'ok'
  const choices = useMemo(() => ({ side: SIDES, type: TYPES, price: sit.prices.map((p) => p.label) }), [sit])
  const work = useMemo(() => (asking ? null : working(sit, pick)), [asking, sit, pick])
  const marks = useMemo(() => (asking ? [] : orderMarks(sit, pick, fit)), [asking, sit, pick, fit])
  const after = asking ? results : [...results, ok]
  const left = heartsLeft(after)
  const over = !asking && runOver(after)
  const valueOf = (f) => (f === 'price' ? pick.price : pick[f] == null ? null : choices[f].indexOf(pick[f]))
  const answerOf = (f) => (f === 'price' ? sit.price : choices[f].indexOf(sit[f]))
  const missing = FIELDS.find((f) => pick[f] == null) || null

  const choose = useCallback((f, i) => {
    if (state !== 'ask' || i < 0 || i >= choices[f].length) return
    const next = { ...pick, [f]: f === 'price' ? i : choices[f][i] }
    setPick(next)
    setActive(FIELDS.find((k) => next[k] == null) || f)   // the next empty field lights up for the number keys
    tapFeedback(prefs)
  }, [state, pick, choices, prefs])

  const check = useCallback(() => {
    if (state !== 'ask' || FIELDS.some((f) => pick[f] == null)) return
    const sc = scoreTicket(sit, pick)
    setState(sc.ok ? 'ok' : 'bad'); setTakeover(true); revealFeedback(sc.ok, prefs)
    if (sc.ok) comboFeedback(streakOf(results) + 1, prefs)
  }, [state, pick, sit, prefs, results])

  // each ticket opens at its top, the status line and the situation in view (Start and Next sit low on the screen)
  useEffect(() => {
    const el = top.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start' })
  }, [])

  // the number keys fill the lit field; Enter is Check's own hotkey (StudyButton), so it fires exactly once
  useEffect(() => {
    if (state !== 'ask') return undefined
    const onKey = (e) => {
      if (e.repeat || e.altKey || e.ctrlKey || e.metaKey) return
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return
      const i = Number(e.key) - 1
      if (Number.isInteger(i) && i >= 0 && i < 4) choose(active, i)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, active, choose])

  const heartLine = ok ? null : left > 0 ? `${plural(left, 'heart')} left` : 'Out of hearts'
  const title = ok ? 'Filled right.' : 'Not this ticket.'
  // the verdict on a miss stays short enough for a phone's screen (the takeover cannot scroll and its one button must
  // stay on screen): each field right or wrong, the first wrong one's lesson, the hearts. The rest is in the working.
  const miss = work && !ok ? verdictMiss(work) : null
  const verdictSub = !work ? null : ok
    ? <span className={`${t.tkLine} ${t.tkCenter}`} data-testid="ticket-takeover-rule">{work.rule}</span>
    : (
      <>
        <span className={t.tkMarks} data-testid="ticket-takeover-marks">
          {miss.marks.map((m) => (
            <span key={m.field} className={`${t.tkMark} ${m.ok ? t.tkMarkOk : t.tkMarkBad}`} data-testid={`ticket-takeover-${m.field}`} data-ok={m.ok ? '1' : '0'}>
              <UIcon name={m.ok ? 'check' : 'x'} size={13} gold={false} />{m.label}
            </span>
          ))}
        </span>
        <span className={t.tkLine} data-testid="ticket-takeover-why"><b>{miss.field}:</b> {miss.line}</span>
        <span className={`${t.tkLine} ${t.tkHearts}`}>{heartLine}</span>
      </>
    )
  const openReview = () => {
    setTakeover(false)
    const el = quoteBox.current
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div className={`${s.kit} ${s.screen}`} data-testid="ticket-round" data-state={state} ref={top}>
      {!asking ? <span className={`${s.flash} ${ok ? s.ok : s.bad}`} aria-hidden="true" /> : null}
      {!asking && takeover ? (
        <VerdictTakeover ok={ok} title={title} answer={work.ticket} sub={verdictSub} stampWord={ok ? 'Filled' : null} label="See the working"
          onContinue={openReview} testId="ticket-takeover" />
      ) : null}
      <div className={t.hudRow}>
        <HudCombo label="Ticket" step={idx} total={TICKET_TOTAL} results={after} live={asking} stepTestId="ticket-step" unit="ticket" scoreWord="filled" />
        <Hearts left={left} />
      </div>
      {asking ? (
        <div className={sa.area}>
          <div className={sa.lHead}>
            <span className={sa.lEyebrow}>Order Ticket · ticket {idx + 1} of {TICKET_TOTAL} · {plural(left, 'heart')}</span>
            <h2 className={t.situation} data-testid="ticket-situation">{sit.text.join(' ')}</h2>
            <p className={sa.lDetail}>Fill the ticket: the <b>side</b>, the <b>order type</b> and the <b>price</b>. All three right scores.</p>
          </div>
        </div>
      ) : (
        <>
          <Prompt mood={ok ? 'happy' : 'oops'} tone={state} size={phone ? 40 : 48} title={title}
            sub={<>{ok ? 'You filled' : 'The ticket was'} <b>{work.ticket}</b>{heartLine ? ` · ${heartLine}` : ''}</>}
            seal={<Stamp ok={ok} word={ok ? 'Filled' : null} inline />} />
          <p className={t.recap} data-testid="ticket-recap">{sit.text.join(' ')}</p>
        </>
      )}
      <QuoteCard sit={sit} marks={marks} fit={fit} ladderW={ladderW} onLadderW={onLadderW} boxRef={quoteBox} />
      <div className={t.ticket} data-testid="ticket-form">
        <div className={t.ticketHead}>
          <UIcon name="document" size={15} gold={false} /><b>Order ticket</b>
          {asking ? <small>{missing ? 'Number keys fill the lit field' : 'Enter checks the ticket'}</small> : null}
        </div>
        <div className={t.fields}>
          {FIELDS.map((f) => (
            <Field key={f} name={f} choices={choices[f]} value={valueOf(f)} answer={answerOf(f)} active={active === f} state={state}
              hint={phone ? null : 'keys 1 to ' + choices[f].length} onPick={(i) => choose(f, i)} onFocus={() => { if (asking) setActive(f) }} />
          ))}
        </div>
      </div>
      <div className={sa.area}>
        <div className={`${sa.lFoot} ${ok ? sa.footOk : state === 'bad' ? sa.footBad : ''}`}>
          {asking
            ? <StudyButton kind="primary" size="xl" arrow wide hotkey="Enter" disabled={!!missing} onClick={check} testId="ticket-check">{missing ? `Pick the ${FIELD_LABEL[missing].toLowerCase()}` : 'Check'}</StudyButton>
            : <StudyButton kind={ok ? 'good' : 'bad'} size="xl" arrow wide hotkey={takeover ? null : 'Enter'} onClick={() => onDone(ok, work)} testId="ticket-next">{over ? 'See the run' : 'Next ticket'}</StudyButton>}
        </div>
      </div>
      {work ? <Working work={work} /> : null}
    </div>
  )
}

export default function OrderTicketGame({ profile = null, fetcher = studyFetch, onClose, signedOut = null }) {
  const prefs = useMemo(() => feedbackPrefs(profile), [profile])
  const [phase, setPhase] = useState('start')   // start | play | done
  const [run, setRun] = useState(null)          // { id, seed, sits }: the eight situations, dealt once from the seed
  const [i, setI] = useState(0)
  const [results, setResults] = useState([])
  const [log, setLog] = useState([])
  const [post, setPost] = useState(null)        // the run's report: { state: pending | ok | failed, gained, level, out }
  const [best, setBest] = useState(readBest)
  const [bestBefore, setBestBefore] = useState(0)   // the best as this run began, so the end screen can say "a new best"
  const [ladderW, setLadderW] = useState(0)     // the quote card's ladder in pixels, kept from ticket to ticket
  const live = useRef(true)
  const posted = useRef('')
  const current = useRef('')                    // the run on screen: an answer for an earlier run is dropped
  useEffect(() => { live.current = true; return () => { live.current = false } }, [])

  const start = useCallback(() => {
    const seed = Date.now()   // seeded once; the pure module deals the whole run from it
    const id = `ticket-${seed}`
    current.current = id
    setRun({ id, seed, sits: buildRun(seed) })
    setI(0); setResults([]); setLog([]); setPost(null); setBestBefore(best); setPhase('play')
  }, [best])

  // once per run: the server grants capped XP for the tickets right (2 each, at most 30 a run, a resend grants nothing)
  const report = useCallback((runId, res) => {
    if (posted.current === runId) return
    posted.current = runId
    setPost({ state: 'pending', gained: 0, level: null })
    const mine = () => live.current && current.current === runId
    let call
    try { call = Promise.resolve(fetcher(GAME_RUNS_URL, { method: 'POST', body: runPost(runId, res) })) } catch (e) { call = Promise.reject(e) }
    call.then((r) => {
      if (!mine()) return
      const xp = Number(r?.progress?.xp)
      const gained = Number(r?.xp_gained ?? r?.progress?.xp_gained ?? 0)
      if (!Number.isFinite(xp) || !Number.isFinite(gained)) { setPost({ state: 'failed', gained: 0, level: null }); return }
      setPost({ state: 'ok', gained, level: { before: xp - gained, after: xp } })
    }).catch((e) => { if (mine()) setPost({ state: 'failed', gained: 0, level: null, out: isSignedOut(e) }) })
  }, [fetcher])

  const next = (ok, work) => {
    const sit = run.sits[i]
    const res = [...results, !!ok]
    setResults(res)
    setLog((l) => [...l, { name: sit.title, ticker: work.ticket, ok: !!ok, said: ok ? null : work.said }])
    if (!runOver(res)) { setI(i + 1); return }
    setPhase('done'); endFeedback(prefs)
    const right = res.filter(Boolean).length
    if (right > best) { setBest(right); writeBest(right) }
    report(run.id, res)
  }

  if (phase === 'start') {
    return (
      <div className={s.kit}>
        <StartArena plate="Ticket" title="Order Ticket" caption="Which order does the job?" testId="ticket-intro" startTestId="ticket-start" hotkey
          total={TICKET_TOTAL} ready onStart={start} label="Deal the tickets"
          stakes={[{ v: TICKET_TOTAL, l: 'situations', icon: 'document' }, { v: TICKET_HEARTS, l: 'hearts', icon: 'shield' }, { v: 3, l: 'fields, all right', icon: 'check' }]}
          lead="A breakout buy, a short on a breakdown, a stop that must not fill far from its price. Read the quote and fill the ticket the way a trader would."
          howTo={<HowItPlays mode="ticket" testId="ticket-howto" steps={[
            { icon: 'eye', title: 'Read the situation', body: 'Two lines on the trade and a practice quote: the bid, the ask, the last trade and the level that matters.' },
            { icon: 'document', title: 'Fill the ticket', body: 'Pick the side, the order type and the price. Tap a tile, or press its number. All three right scores.' },
            { icon: 'shield', title: 'Three hearts', body: 'A wrong ticket costs a heart and shows the working: the right order and why it sits where it does.' },
          ]} />}>
          <span data-testid="ticket-best">{best > 0 ? `Your best run: ${best} of ${TICKET_TOTAL} filled` : 'Made-up quotes, real order rules'}</span>
        </StartArena>
      </div>
    )
  }

  if (phase === 'done') {
    // the run is scored on the tickets played: a run the hearts ended early is right of played, its accuracy too, and
    // the medal line shows only on a full run of eight (as in Options Payoff)
    const right = results.filter(Boolean).length
    const played = results.length
    const full = played === TICKET_TOTAL
    const perfect = full && right === TICKET_TOTAL
    const out = heartsLeft(results) === 0
    const newBest = right > 0 && right > bestBefore
    const lost = post?.state === 'failed'
    return (
      <>
        {perfect ? <Confetti /> : null}
        <div className={s.kit}>
          <EndHard right={right} total={played} xp={post?.gained || 0} results={results} log={log} level={post?.state === 'ok' ? post.level : null}
            unit="tickets filled right" doneWord="filled" showSetups={false} medal={full} testIdPrefix="ticket" title={out ? 'Out of hearts' : null}
            againLabel="Deal new tickets" onAgain={() => setPhase('start')} onBack={onClose}>
            {perfect
              ? <><b>Eight for eight.</b> Every side, every order type, every price where it belongs.</>
              : out
                ? <>The hearts ran out on ticket <b>{played}</b> of {TICKET_TOTAL}.{newBest ? <> <b>A new best</b> all the same: {right} filled right.</> : null} Each miss below shows the ticket it should have been.</>
                : newBest
                  ? <><b>A new best:</b> {right} of {TICKET_TOTAL} filled right. Each miss below shows the ticket it should have been.</>
                  : <>Your best run stands at <b>{best}</b> of {TICKET_TOTAL}. Each miss below shows the ticket it should have been.</>}
            {lost ? <span data-testid="ticket-xp-failed">{post.out ? ' You are signed out, so this run\'s XP did not save.' : ' This run\'s XP did not save.'}</span> : null}
          </EndHard>
          {lost && post.out && signedOut ? signedOut : null}
        </div>
      </>
    )
  }

  const sit = run?.sits[i]
  if (!sit) return null
  return <Round key={`${run.id}-${i}`} idx={i} sit={sit} results={results} prefs={prefs} onDone={next} ladderW={ladderW} onLadderW={setLadderW} />
}
