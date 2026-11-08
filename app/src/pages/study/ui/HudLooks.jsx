// THE STATUS LINE, FOCUS ROUND 1 (2026-11-08). The owner ranked the round-21 status line Cut in batch 22: "This needs to
// be greatly improved. Looks extremely generic." He then asked to "focus in on each feature and area so it can be
// improved", so this area gets three real versions, each built to a reference he can name, shown side by side in the
// workbench; he picks one and that one replaces Hud in the product. Same inputs as Hud (step, total, results, live), so
// whichever wins drops in without touching HardChallenge's state.
//
//   A · Journey     a thick glossy progress bar our mark rides, misses notched in red, a streak flame (Duolingo's lesson bar)
//   B · Scoreboard  eight candle slots that light gold or red, a big gold score (a game HUD, Chess.com Puzzle Rush)
//   C · Route       a chart-maker's route, eight waypoints, our compass travelling it (the Uncharted Territory intro's map)
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import h from './hudLooks.module.css'

function tally(step, total, results) {
  const named = results.filter((r) => r === true).length
  let streak = 0
  for (let i = results.length - 1; i >= 0 && results[i] === true; i--) streak += 1
  const answered = results.filter((r) => r === true || r === false).length
  return { named, streak, answered, at: Math.min(step, total - 1) }
}

function Star() {
  return <svg width="12" height="12" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z" fill="currentColor" /></svg>
}

/** A · Journey: the bar fills as charts are answered, our mark rides its leading edge, a red notch marks each miss. */
export function HudJourney({ step = 0, total = 8, results = [], live = false }) {
  const { named, streak, answered } = tally(step, total, results)
  const pct = Math.min(100, (answered / Math.max(1, total)) * 100)
  return (
    <div className={`${h.hud} ${h.journey}`} role="group" aria-label={`Hard mode, chart ${Math.min(step + 1, total)} of ${total}, ${named} named`}>
      <span className={`${h.badge} ${live ? h.live : ''}`}><Star /><span className={h.badgeText}>Hard</span></span>
      <div className={h.jTrack} aria-hidden="true">
        <div className={h.jFill} style={{ width: `${pct}%` }}><i className={h.jGloss} /></div>
        {results.map((r, i) => (r === false ? <i key={i} className={h.jMiss} style={{ left: `${((i + 0.5) / total) * 100}%` }} /> : null))}
        <span className={h.jRider} style={{ left: `${pct}%` }}><img src={brandMark} alt="" /></span>
      </div>
      <span className={`${h.flame} ${streak >= 2 ? h.hot : ''}`} title="in a row"><UIcon name="flame" size={18} gold={false} /><b>{streak}</b></span>
      <span className={h.count}><b>{Math.min(step + 1, total)}</b><i>of</i>{total}</span>
    </div>
  )
}

function Candle({ state }) {
  // a candlestick glyph: wick and body; the in-play one breathes, a miss carries a cross
  return (
    <svg viewBox="0 0 20 34" className={h.candle} aria-hidden="true" focusable="false">
      <line x1="10" y1="2" x2="10" y2="32" className={h.wick} />
      <rect x="4" y="9" width="12" height="16" rx="2.5" className={h.body} />
      {state === 'miss' ? <path d="M6.5 13.5l7 7M13.5 13.5l-7 7" className={h.cross} /> : null}
    </svg>
  )
}

/** B · Scoreboard: one slot per chart, lit as it is answered; the score is the biggest thing on the line. */
export function HudScoreboard({ step = 0, total = 8, results = [], live = false }) {
  const { named, at } = tally(step, total, results)
  return (
    <div className={`${h.hud} ${h.board}`} role="group" aria-label={`Hard mode, chart ${at + 1} of ${total}, ${named} named`}>
      <span className={h.bEmblem}><span className={h.bEmblemTop}>Hard</span><span className={h.bEmblemSub}>mode</span></span>
      <div className={h.bSlots} aria-hidden="true">
        {Array.from({ length: total }, (_, i) => {
          const r = results[i]
          const st = r === true ? 'done' : r === false ? 'miss' : i === at && live ? 'now' : i === at ? 'now' : 'ahead'
          return <span key={i} className={`${h.bSlot} ${h[st]}`}><Candle state={st} /></span>
        })}
      </div>
      <span className={h.bScore}><b>{named}</b><small>named</small><em>chart {at + 1} of {total}</em></span>
    </div>
  )
}

/** C · Route: the run is a route on a chart-maker's map; waypoints fill in behind our compass as it travels. */
export function HudRoute({ step = 0, total = 8, results = [], live = false }) {
  const { named, at } = tally(step, total, results)
  const pos = (i) => (total <= 1 ? 50 : 4 + (i / (total - 1)) * 92)
  return (
    <div className={`${h.hud} ${h.route}`} role="group" aria-label={`Hard mode, chart ${at + 1} of ${total}, ${named} named`}>
      <span className={h.rTitle}><em>Hard mode</em><small>the route</small></span>
      <div className={h.rMap} aria-hidden="true">
        <i className={h.rLine} />
        <i className={h.rWalked} style={{ width: `${pos(at) - 4}%` }} />
        {Array.from({ length: total }, (_, i) => {
          const r = results[i]
          const st = r === true ? 'done' : r === false ? 'miss' : i === at ? 'now' : 'ahead'
          return (
            <span key={i} className={`${h.rPoint} ${h[st]}`} style={{ left: `${pos(i)}%` }}>
              {st === 'done' ? <UIcon name="check" size={11} gold={false} /> : st === 'miss' ? <b>×</b> : null}
            </span>
          )
        })}
        <span className={`${h.rShip} ${live ? h.live : ''}`} style={{ left: `${pos(at)}%` }}><img src={brandMark} alt="" /></span>
      </div>
      <span className={h.rLog}><b>{named}</b> named<small>chart {at + 1} of {total}</small></span>
    </div>
  )
}

/** THE COMBINED STATUS LINE (round 22; the owner on focus round 1, every version Okay: "Essentially a combo of all 4 of
 *  them would be ideal, incorporating all the best parts of each"). Today's mode tag; Journey's thick glossy bar with our
 *  mark riding it and the streak flame; Scoreboard's mark per chart, lit gold or red, and its big gold score; Route's
 *  waypoints along the track, a check or a cross on each. */
export function HudCombo({ step = 0, total = 8, results = [], live = false, stepTestId = 'hard-step', label = 'Hard mode', unit = 'chart', scoreWord = 'named' }) {
  const { named, streak, answered, at } = tally(step, total, results)
  const seg = (i) => ((i + 0.5) / Math.max(1, total)) * 100
  return (
    <div className={`${h.hud} ${h.combo}`} role="group" aria-label={`${label}, ${unit.toLowerCase()} ${at + 1} of ${total}, ${named} ${scoreWord}`}>
      <span className={`${h.badge} ${live ? h.live : ''}`}><Star /><span className={h.badgeText}>{label}</span></span>
      <div className={h.cTrack} aria-hidden="true">
        {answered > 0 ? <div className={h.jFill} style={{ width: `${Math.min(100, (answered / Math.max(1, total)) * 100)}%` }}><i className={h.jGloss} /></div> : null}
        {Array.from({ length: total }, (_, i) => {
          const r = results[i]
          const st = r === true ? 'done' : r === false ? 'miss' : 'ahead'
          if (i === at && r !== true && r !== false) return null
          return (
            <span key={i} className={`${h.cPip} ${h[st]}`} style={{ left: `${seg(i)}%` }}>
              {st === 'done' ? <UIcon name="check" size={10} gold={false} /> : st === 'miss' ? <b>×</b> : null}
            </span>
          )
        })}
        <span className={`${h.cRider} ${live ? h.live : ''}`} style={{ left: `${seg(at)}%` }}><img src={brandMark} alt="" /></span>
      </div>
      <span className={`${h.flame} ${streak >= 2 ? h.hot : ''}`} title="in a row"><UIcon name="flame" size={18} gold={false} /><b>{streak}</b></span>
      <span className={h.cScore}><b>{named}</b><small>{scoreWord}</small><em data-testid={stepTestId || undefined}>{unit} {at + 1} of {total}</em></span>
    </div>
  )
}


/** The same status line for a timed run (Blitz, 2026-11-08: one design for every mode). The gold track is the clock: it
 *  drains as the seconds go and turns red in the last ten; the flame is the combo, the score is the points. */
export function HudClock({ left = 60, secs = 60, score = 0, combo = 0, mult = 1, label = 'Blitz', live = true }) {
  const pct = Math.max(0, Math.min(100, (left / Math.max(1, secs)) * 100))
  return (
    <div className={`${h.hud} ${h.combo} ${h.clock} ${left <= 10 ? h.low : ''}`} role="group" aria-label={`${label}, ${left} seconds left, ${score} points`}>
      <span className={`${h.badge} ${live ? h.live : ''}`}><Star /><span className={h.badgeText}>{label}</span></span>
      <div className={h.cTrack} aria-hidden="true">
        <div className={h.jFill} style={{ width: `${pct}%` }}><i className={h.jGloss} /></div>
        <span className={`${h.cRider} ${live ? h.live : ''}`} style={{ left: `${Math.max(4, pct)}%` }}><img src={brandMark} alt="" /></span>
      </div>
      <span className={`${h.flame} ${combo >= 2 ? h.hot : ''}`} title="in a row"><UIcon name="flame" size={18} gold={false} /><b>x{mult}</b></span>
      <span className={h.cScore}><b data-testid="blitz-score">{score}</b><small>points</small><em data-testid="blitz-clock">{left}s left</em></span>
    </div>
  )
}
