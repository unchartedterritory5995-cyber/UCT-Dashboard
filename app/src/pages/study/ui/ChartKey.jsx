// THE CHART KEY (2026-11-08, the owner's batch-24 notes on the lesson and the run-on: "the visual graphic of the chart ...
// can also list the levels and action items in the chart as well. The visual on the chart can give the explanation too so
// they can see it all by looking at the chart the why and the what and where and everything" · "need better graphics and
// on screen explanations of levels and such"). It sits on the chart's lower edge in every mode: each dashed line's colour,
// its name, its price, why it sits there (the setup's own rule, from api/services/study_trade.py) and what the bars after
// it did. Every word is the plan's or measured from the bars; nothing is invented.
import UIcon from '../../../components/ui/UIcon'
import k from './chartKey.module.css'

const px = (v) => (Number.isFinite(v) ? v.toFixed(2) : '—')
const sess = (n) => `${n} session${n === 1 ? '' : 's'}`
// the risk a position takes from the entry to the stop, measured (the owner, batch 1: "give some entry and sizing
// indications"): the one number a member sizes from
const riskPct = (t) => (Number.isFinite(t.entry) && Number.isFinite(t.stop) && t.entry > 0 ? (Math.abs(t.entry - t.stop) / t.entry) * 100 : null)

function reached(at, stopped) {
  if (at === 0) return { ok: true, text: 'reached the same day' }
  if (at != null) return { ok: true, text: `reached in ${sess(at)}` }
  return { ok: false, text: stopped ? 'not reached before the stop' : 'not reached on this chart' }
}

/** `trade` is hardMode.reviewTrade's (kind 'plan') or tradeOf's line to hold (kind 'signal'). */
export default function ChartKey({ trade, testId = null }) {
  if (!trade) return null
  let rows
  if (trade.kind === 'plan') {
    const stopped = trade.stoppedSession
    const t1 = reached(trade.t1At, stopped), t2 = reached(trade.t2At, stopped)
    rows = [
      { tone: 'gold', name: trade.long === false ? 'Short entry' : 'Entry', price: px(trade.entry), why: trade.entry_note, status: { ok: true, text: trade.long === false ? 'shorted here' : 'bought here' } },
      { tone: 'red', name: 'Stop', price: px(trade.stop), why: trade.stop_note, risk: riskPct(trade),
        status: stopped ? { ok: false, text: `hit after ${sess(stopped)}` } : { ok: true, text: 'never hit on this chart' } },
      { tone: 'green', name: '2R', price: px(trade.t1), why: 'the first target, twice the risk', status: t1 },
      { tone: 'green', name: '3R', price: px(trade.t2), why: 'the second target, three times the risk', status: t2 },
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
    <div className={k.key} role="list" aria-label="The levels on this chart" data-testid={testId || undefined}>
      <span className={k.head}>On this chart</span>
      {rows.map((r) => (
        <div key={r.name} role="listitem" className={`${k.row} ${k[r.tone]}`}>
          <i className={k.swatch} aria-hidden="true" />
          <b className={k.name}>{r.name}</b>
          {r.price ? <span className={k.price}>{r.price}</span> : <span className={k.price} />}
          <span className={k.why}>{r.why || ''}{r.risk != null ? <em className={k.risk}>{r.risk.toFixed(1)}% risk from the entry</em> : null}</span>
          {r.status ? (
            <span className={`${k.status} ${r.status.ok ? k.sOk : k.sBad}`}>
              <UIcon name={r.status.ok ? 'check' : 'x'} size={12} gold={false} />{r.status.text}
            </span>
          ) : <span />}
        </div>
      ))}
    </div>
  )
}
