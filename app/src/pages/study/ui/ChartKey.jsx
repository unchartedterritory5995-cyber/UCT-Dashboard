// THE CHART KEY (2026-11-08, the owner's batch-24 notes on the lesson and the run-on: "the visual graphic of the chart ...
// can also list the levels and action items in the chart as well. The visual on the chart can give the explanation too so
// they can see it all by looking at the chart the why and the what and where and everything" · "need better graphics and
// on screen explanations of levels and such"). It sits on the chart's lower edge in every mode: each dashed line's colour,
// its name, its price, why it sits there (the setup's own rule, from api/services/study_trade.py) and what the bars after
// it did. Every word is the plan's or measured from the bars; nothing is invented.
import { Fragment } from 'react'
import UIcon from '../../../components/ui/UIcon'
import { markWhy, trimLabels, trimR } from '../challenges/hardMode'
import k from './chartKey.module.css'

const px = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—')
// a daily chart counts sessions; an intraday course chart counts bars (its trade carries `unit: 'bar'`, courses_lib)
const sess = (n, unit = 'session') => `${n} ${unit}${n === 1 ? '' : 's'}`
// the risk a position takes from the entry to the stop, measured (the owner, batch 1: "give some entry and sizing
// indications"): the one number a member sizes from
const riskPct = (t) => (Number.isFinite(t.entry) && Number.isFinite(t.stop) && t.entry > 0 ? (Math.abs(t.entry - t.stop) / t.entry) * 100 : null)

function reached(at, stopped, unit = 'session') {
  if (at === 0) return { ok: true, text: unit === 'bar' ? 'reached in the fill bar' : 'reached the same day' }
  if (at != null) return { ok: true, text: `reached in ${sess(at, unit)}` }
  return { ok: false, text: stopped ? 'not reached before the stop' : 'not reached on this chart' }
}

/** `trade` is hardMode.reviewTrade's (kind 'plan') or tradeOf's line to hold (kind 'signal'). `detached`: the key stands
 *  as its own panel, framed all round, where something sits between it and the chart (the lesson's replay control);
 *  otherwise it hangs from the chart's lower edge. */
export default function ChartKey({ trade, testId = null, detached = false }) {
  if (!trade) return null
  let rows
  if (trade.kind === 'plan') {
    const stopped = trade.stoppedSession
    const unit = trade.unit === 'bar' ? 'bar' : 'session'
    const t1 = reached(trade.t1At, stopped, unit), t2 = reached(trade.t2At, stopped, unit)
    // 3R and 5R, from the plan's own trim_r, are MARKS ON THE RULER, never fixed sells (the owner's D-013, 2026-11-12,
    // superseding B19's "a third at 3R" and E51's "a third at 5R"): 3R is where the stop may move up to breakeven ("between
    // 2R and 5R, or at the first sell"); 5R sits in the 5 to 10R zone where a first sell into strength is often best, by
    // judgment, usually day 3 or later
    const [l1, l2] = trimLabels(trade)
    const [m1, m2] = trimR(trade)
    rows = [
      { tone: 'gold', name: trade.long === false ? 'Short entry' : 'Entry', price: px(trade.entry), why: trade.entry_note, status: { ok: true, text: trade.long === false ? 'shorted here' : 'bought here' } },
      { tone: 'red', name: 'Stop', price: px(trade.stop), why: trade.stop_note, risk: riskPct(trade),
        status: stopped ? { ok: false, text: `hit after ${sess(stopped, unit)}` } : { ok: true, text: 'never hit on this chart' } },
      { tone: 'green', name: l1, price: px(trade.t1), why: markWhy(m1), status: t1 },
      { tone: 'green', name: l2, price: px(trade.t2), why: markWhy(m2), status: t2 },
    ]
    if (trade.trail) rows.push({ tone: 'soft', name: 'Trail', price: '', why: trade.trail, status: null })
    if (trade.trim_note) rows.push({ tone: 'soft', name: 'Trim', price: '', why: trade.trim_note, status: null })
  } else if (trade.kind === 'signal' && Number.isFinite(trade.line)) {
    rows = [{
      tone: 'red', name: trade.short ? 'Must stay under' : 'Must hold', price: px(trade.line),
      why: trade.short ? "the signal day's high: a close over it ends the fall" : "the signal day's low: a close under it breaks the setup",
      status: trade.broke ? { ok: false, text: `broken after ${sess(trade.broke)}` } : { ok: true, text: 'held through the run' },
    }]
  } else return null
  return (
    <div className={`${k.key} ${detached ? k.detached : ''}`} role="list" aria-label="The levels on this chart" data-testid={testId || undefined}>
      <span className={k.head}>On this chart</span>
      {rows.map((r, i) => (
        <Fragment key={r.name}>
        {/* one rule across the whole row between two levels (each cell drew its own top border, at its own height,
            so the rules stepped where a row's cells differed in height: the screen check, 2026-11-14) */}
        {i ? <i className={k.sep} aria-hidden="true" /> : null}
        <div role="listitem" className={`${k.row} ${k[r.tone]}`}>
          <i className={k.swatch} aria-hidden="true" />
          <b className={k.name}>{r.name}</b>
          {r.price ? <span className={k.price}>{r.price}</span> : <span className={k.price} />}
          <span className={k.why}>{r.why || ''}{r.risk != null ? <em className={k.risk}>{r.risk.toFixed(1)}% risk from the entry</em> : null}</span>
          {/* the pill sits in a cell of its own: a row is always five cells */}
          <span className={k.statusCell}>
            {r.status ? (
              <span className={`${k.status} ${r.status.ok ? k.sOk : k.sBad}`}>
                <UIcon name={r.status.ok ? 'check' : 'x'} size={12} gold={false} />{r.status.text}
              </span>
            ) : null}
          </span>
        </div>
        </Fragment>
      ))}
    </div>
  )
}
