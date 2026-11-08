// THE END SCREEN, FOCUS ROUND 3 (2026-11-08). Batch 22 ranked the end screen, the score ring, the stat cards and the run
// log Weak, with the owner's words: "This can also be greatly improved in terms of graphics and production." Three real
// versions on Done's own inputs (right, total, xp, log, results), each built to a named reference:
//
//   A · Trophy        a struck coin whose metal is the run's tier (bronze, silver, gold, the Legendary medal at a perfect
//                     run), the next tier named, one slim stats bar, the run as eight dots (Apple Fitness awards)
//   B · Report card   what to study next: accuracy as a dial, every setup in the run scored, the weakest one named with a
//                     way to practise it, the run as a timeline of cards (Chess.com's Game Review)
//   C · Statement     the run as a trading statement: the result like a P&L line, a step curve of charts named over the
//                     run, a blotter of every chart (a broker's daily statement)
//
// Every number is counted from the run itself: right, total, xp and the log rows. Nothing about a stock is written here.
import { Medal } from './Medal'
import UIcon from '../../../components/ui/UIcon'
import brandMark from '../../../components/intro/assets/compass-mark.png'
import { useCountUp } from '../../../lab/fx'
import StudyButton from './StudyButton'
import LevelBar from './LevelBar'
import { bySetup, bestStreak, tierOf, verdictWord } from './endMath'
import e from './endLooks.module.css'

function Actions({ onAgain, onBack, againLabel = 'Run it again' }) {
  return (
    <div className={e.actions}>
      <button type="button" className={e.primary} onClick={onAgain}>{againLabel}<UIcon name="chevronRight" size={18} gold={false} /></button>
      <button type="button" className={e.ghost} onClick={onBack}>Back to Study</button>
    </div>
  )
}

/** A · Trophy */
export function EndTrophy({ right, total, xp = 0, log = [], results = [], onAgain, onBack }) {
  const tier = tierOf(right, total)
  const shown = useCountUp(xp, true, 28)
  const acc = total ? Math.round((right / total) * 100) : 0
  return (
    <div className={`${e.end} ${e.trophy} ${e['t_' + tier.key] || ''}`}>
      <div className={e.coinStage}>
        <i className={e.rays} aria-hidden="true" />
        {tier.key === 'legend'
          ? <Medal lit ignite size={150} />
          : (
            <div className={e.coin} aria-label={`${tier.name} for this run`}>
              <div className={e.coinFace}><img src={brandMark} alt="" /><b>{right}<small>/{total}</small></b></div>
              <i className={e.coinShine} aria-hidden="true" />
            </div>
          )}
        <span className={e.ribbon}>{tier.key === 'legend' ? `${total} for ${total}` : tier.name}</span>
      </div>
      <div className={e.tTitle}>{verdictWord(right, total)}</div>
      <div className={e.tSub}>{right} of {total} named without a ticker{tier.next ? <> · <b>{tier.next.more} more</b> for {tier.next.name}</> : null}</div>
      <div className={e.tBar}>
        <span><UIcon name="star" size={16} gold={false} /><b>+{shown}</b> XP</span>
        <span><UIcon name="flame" size={16} gold={false} /><b>{bestStreak(results)}</b> best streak</span>
        <span><UIcon name="check" size={16} gold={false} /><b>{acc}%</b> accuracy</span>
      </div>
      <div className={e.tDots} role="list" aria-label="The run">
        {log.map((r, i) => (
          <span key={i} role="listitem" className={`${e.tDot} ${r.ok ? e.ok : e.miss}`} style={{ '--i': i }} title={`${i + 1}. ${r.name}${r.ticker ? ' · ' + r.ticker : ''}${r.ok ? '' : ' · you said ' + (r.said || '')}`}>
            {r.ok ? <UIcon name="check" size={13} gold={false} /> : <UIcon name="x" size={13} gold={false} />}
          </span>
        ))}
      </div>
      <Actions onAgain={onAgain} onBack={onBack} />
    </div>
  )
}

/** B · Report card */
export function EndReport({ right, total, xp = 0, log = [], onAgain, onBack, onPractise }) {
  const acc = total ? Math.round((right / total) * 100) : 0
  const rows = bySetup(log)
  // the setup to practise next: the weakest real setup (Nothing fired is a call, not a setup to drill)
  const weak = rows.find((r) => r.ok < r.n && r.name !== 'Nothing fired') || null
  const R = 54, C = 2 * Math.PI * R
  return (
    <div className={`${e.end} ${e.report}`}>
      <div className={e.rHead}>
        <svg viewBox="0 0 140 140" className={e.dial} aria-label={`${acc}% accuracy`}>
          <circle cx="70" cy="70" r={R} className={e.dialTrack} />
          <circle cx="70" cy="70" r={R} className={e.dialFill} style={{ strokeDasharray: `${(acc / 100) * C} ${C}` }} transform="rotate(-90 70 70)" />
          <text x="70" y="68" className={e.dialNum}>{acc}%</text>
          <text x="70" y="90" className={e.dialLbl}>accuracy</text>
        </svg>
        <div>
          <span className={e.rEyebrow}>Hard mode · your review</span>
          <div className={e.rTitle}>{verdictWord(right, total)}</div>
          <div className={e.rSub}>{right} of {total} named without a ticker · <b>+{xp} XP</b></div>
        </div>
      </div>
      <div className={e.rCols}>
        <div className={e.rBox}>
          <span className={e.rBoxHead}>By setup</span>
          {rows.map((r) => (
            <div key={r.name} className={e.rSet}>
              <span className={e.rSetName}>{r.name}</span>
              <span className={e.rSetBar}><i style={{ width: `${(r.ok / r.n) * 100}%` }} /></span>
              <span className={`${e.rSetNum} ${r.ok === r.n ? e.ok : r.ok === 0 ? e.miss : ''}`}>{r.ok} of {r.n}</span>
            </div>
          ))}
        </div>
        <div className={`${e.rBox} ${e.rFocus}`}>
          <span className={e.rBoxHead}>Work on next</span>
          {weak
            ? <>
              <div className={e.rFocusName}>{weak.name}</div>
              <div className={e.rFocusWhy}>You named {weak.ok} of its {weak.n} chart{weak.n > 1 ? 's' : ''} in this run.</div>
              <button type="button" className={e.rPractise} onClick={() => onPractise?.(weak.name)}>Practise {weak.name}<UIcon name="chevronRight" size={16} gold={false} /></button>
            </>
            : <div className={e.rFocusWhy}>Every setup in this run was named. Run it again for a new eight.</div>}
        </div>
      </div>
      <div className={e.rTimeline} role="list" aria-label="The run">
        {log.map((r, i) => (
          <div key={i} role="listitem" className={`${e.rCard} ${r.ok ? e.ok : e.miss}`} style={{ '--i': i }}>
            <span className={e.rCardTop}><small>{i + 1}</small>{r.ok ? <UIcon name="check" size={13} gold={false} /> : <UIcon name="x" size={13} gold={false} />}</span>
            <b>{r.name}</b>
            {r.ticker ? <em>{r.ticker}</em> : null}
            {!r.ok && r.said ? <i>you said {r.said}{r.was ? `, it was ${r.was}` : ''}</i> : null}
          </div>
        ))}
      </div>
      <Actions onAgain={onAgain} onBack={onBack} />
    </div>
  )
}

/** C · Statement */
export function EndStatement({ right, total, xp = 0, log = [], results = [], onAgain, onBack, date = null }) {
  const W = 560, H = 120, P = 10
  const pts = [[0, 0]]
  let c = 0
  results.forEach((r, i) => { if (r) c += 1; pts.push([i + 1, c]) })
  const x = (i) => P + (i / Math.max(1, total)) * (W - 2 * P)
  const y = (v) => H - P - (v / Math.max(1, total)) * (H - 2 * P)
  let d = `M ${x(0)} ${y(0)}`
  for (let i = 1; i < pts.length; i++) d += ` H ${x(pts[i][0])} V ${y(pts[i][1])}`
  const when = date || new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  return (
    <div className={`${e.end} ${e.statement}`}>
      <div className={e.sHead}>
        <span className={e.sBrand}><img src={brandMark} alt="" />UCT Intelligence</span>
        <span className={e.sDoc}>Hard mode statement · {when}</span>
      </div>
      <div className={e.sTop}>
        <div>
          <span className={e.sLbl}>Result</span>
          <div className={`${e.sBig} ${right * 2 >= total ? e.up : e.down}`}>{right}<small> / {total} named</small></div>
          <span className={e.sNote}>{verdictWord(right, total)} · best streak {bestStreak(results)} · <b>+{xp} XP</b></span>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className={e.curve} aria-label="Charts named over the run" preserveAspectRatio="none">
          {Array.from({ length: total + 1 }, (_, i) => <line key={i} x1={x(i)} x2={x(i)} y1={P} y2={H - P} className={e.grid} />)}
          <path d={`${d} V ${H - P} H ${x(0)} Z`} className={e.area} />
          <path d={d} className={e.line} />
          {results.map((r, i) => <circle key={i} cx={x(i + 1)} cy={y(pts[i + 1][1])} r="4.5" className={r ? e.dotUp : e.dotDown} />)}
        </svg>
      </div>
      <div className={e.blotter} role="table" aria-label="The run">
        <div className={e.bRow} role="row"><span>#</span><span>Setup</span><span>Ticker</span><span>Your call</span><span>Result</span></div>
        {log.map((r, i) => (
          <div key={i} className={`${e.bRow} ${r.ok ? e.ok : e.miss}`} role="row" style={{ '--i': i }}>
            <span>{i + 1}</span><span>{r.name}</span><span className={e.bTick}>{r.ticker || '—'}</span>
            <span>{r.ok ? r.name : (r.said || '—')}</span>
            <span className={e.bRes}>{r.ok ? 'Named' : 'Missed'}</span>
          </div>
        ))}
      </div>
      <Actions onAgain={onAgain} onBack={onBack} />
    </div>
  )
}

/** HARD MODE'S END (round 22): the owner's three versions merged the way he asked of the status line ("a combo ... all
 *  the best parts of each"): Trophy's coin struck in the run's tier with the next tier named; one slim stats bar;
 *  Report card's setups scored and the weakest real setup named; the run as cards with what was said on a miss. The
 *  test ids are the ones Hard mode's end always carried. Enter runs it again. */
export function EndHard({ right, total, xp = 0, log = [], results = [], onAgain, onBack, unit = 'named without a ticker', showSetups = true, againLabel = 'Run it again', testIdPrefix = 'hard', doneWord = 'named', xpLabel = 'XP', medal = true, title = null, children = null, level = null }) {
  const tier = tierOf(right, total)
  const shown = useCountUp(xp, true, 28)
  const acc = total ? Math.round((right / total) * 100) : 0
  const rows = bySetup(log)
  const weak = rows.find((r) => r.ok < r.n && r.name !== 'Nothing fired') || null
  return (
    <div className={`${e.end} ${e.trophy} ${e.hardEnd} ${e['t_' + tier.key] || ''}`} data-testid={`${testIdPrefix}-done`}>
      <div className={e.coinStage}>
        <i className={e.rays} aria-hidden="true" />
        {tier.key === 'legend'
          ? <Medal lit ignite size={150} />
          : (
            <div className={e.coin} data-testid={`${testIdPrefix}-score`} aria-label={`${right} of ${total} ${doneWord}`}>
              <div className={e.coinFace}><img src={brandMark} alt="" /><b>{right}<small>/{total}</small></b></div>
              <i className={e.coinShine} aria-hidden="true" />
            </div>
          )}
        <span className={e.ribbon}>{tier.key === 'legend' ? `${total} for ${total}` : tier.name}</span>
        <i className={e.pedestal} aria-hidden="true" />
        <i className={e.spot} aria-hidden="true" />
      </div>
      <div className={e.tTitle}>{title || verdictWord(right, total)}</div>
      <div className={e.tSub}>{right} of {total} {unit}{tier.next ? <> · <b>{tier.next.more} more</b> for {tier.next.name}</> : null}</div>
      {children ? <div className={e.tNote}>{children}</div> : null}
      {tier.key === 'legend' || !medal ? null : <span className={e.legendHint}><Medal size={22} /> {total} for {total} lights the Legendary medal</span>}
      <div className={e.tBar}>
        <span data-testid={`${testIdPrefix}-xp`}><UIcon name="star" size={16} gold={false} /><b>+{shown}</b> {xpLabel}</span>
        <span data-testid={`${testIdPrefix}-right`}><UIcon name="check" size={16} gold={false} /><b>{right}/{total}</b> {doneWord}</span>
        <span data-testid={`${testIdPrefix}-streak`}><UIcon name="flame" size={16} gold={false} /><b>{bestStreak(results)}</b> best streak</span>
        <span><UIcon name="eye" size={16} gold={false} /><b>{acc}%</b> accuracy</span>
      </div>
      {level ? <LevelBar before={level.before} after={level.after} testId={`${testIdPrefix}-level`} /> : null}
      {showSetups && rows.length ? (
        <div className={e.rCols}>
          <div className={e.rBox}>
            <span className={e.rBoxHead}>By setup</span>
            {rows.map((r) => (
              <div key={r.name} className={e.rSet}>
                <span className={e.rSetName}>{r.name}</span>
                <span className={e.rSetBar}><i style={{ width: `${(r.ok / r.n) * 100}%` }} /></span>
                <span className={`${e.rSetNum} ${r.ok === r.n ? e.ok : r.ok === 0 ? e.miss : ''}`}>{r.ok} of {r.n}</span>
              </div>
            ))}
          </div>
          <div className={`${e.rBox} ${e.rFocus}`}>
            <span className={e.rBoxHead}>Work on next</span>
            {weak
              ? <><div className={e.rFocusName}>{weak.name}</div><div className={e.rFocusWhy}>You named {weak.ok} of its {weak.n} chart{weak.n > 1 ? 's' : ''} in this run. Read its rule in the lesson the next time it comes up.</div></>
              : <div className={e.rFocusWhy}>Every setup in this run was named. Run it again for a new eight.</div>}
          </div>
        </div>
      ) : null}
      <div className={e.rTimeline} role="list" aria-label="The run" data-testid="run-log">
        {log.map((r, i) => (
          <div key={i} role="listitem" className={`${e.rCard} ${r.ok ? e.ok : e.miss}`} style={{ '--i': i }}>
            <span className={e.rCardTop}><small>{i + 1}</small>{r.ok ? <UIcon name="check" size={13} gold={false} /> : <UIcon name="x" size={13} gold={false} />}</span>
            <b>{r.name}</b>
            {r.ticker ? <em>{r.ticker}</em> : null}
            {!r.ok && r.said ? <i>you said {r.said}{r.was ? `, it was ${r.was}` : ''}</i> : null}
          </div>
        ))}
      </div>
      <div className={e.actions}>
        <StudyButton kind="primary" size="xl" arrow hotkey="Enter" onClick={onAgain} testId={`${testIdPrefix}-again`}>{againLabel}</StudyButton>
        <StudyButton kind="ghost" onClick={onBack}>Back to Study</StudyButton>
      </div>
    </div>
  )
}

