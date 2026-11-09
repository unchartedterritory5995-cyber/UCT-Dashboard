import '../../styles/tokens.css'
import { PLAIN_RULES } from '../../pages/study/studyPlainRules'
import s from '../../pages/study/ui/study.module.css'

// 2026-11-08: the setups in plain words, beside the bank's words today, for the owner's approval (studyPlainRules.js).
const TODAY = {
  'setup.family3.kicker': "the stock is already set up, in an uptrend or a clean base; the day before closes red and WEAK near its low, an almost-failed breakdown with a real body (about 1-5% of price); then the next day gaps up and follows through with a strong green candle that closes above the red day's high and near its own high, usually on a volume surge. The sellers from the red day are trapped. It is short-term positioning and rarely an earnings day: an earnings-day gap is an earnings gapper, a baby red candle before a gap is just a breakout, and a gap against a downtrend is a different setup.",
  'setup.family4.oops': "opens below the prior close, trades under the prior day's low, then reverses and closes above the prior close. A Williams Oops opens below the prior LOW and rallies back above it. A Super Oops closes above the prior day's HIGH, engulfing the whole day. LOCATION is the main thing: it comes at the end of an orderly drift lower, a flag, a wedge, a double bottom or the end of a downtrend, into a buyable spot, with orderly days before it (no news gap, no outsized red bar) and a technical, not news-sized, Oops day; the Oops-day low must never break afterwards.",
  'setup.family4.slingshot': 'a drive first, usually an earnings gapper (it is mostly the way into a power earnings gap after its first pause), sometimes a strong rally; THEN a tight orderly pullback of three to seven sessions, about 5-12% deep, with the closes under the 4-day average of the highs; THEN the trigger, the first close back above that average, a decisive day that closes near its high and needs no gap. The gap day or rally day itself is never the trigger, and the 200-day is not required.',
  'setup.family1.launchpad': 'after a real correction the 8, 21 and 50-day averages chunk up into a tight bundle at or near the 200-day while price lives UNDER and through the bundle for weeks in a long flat base, dangling and retesting it; the launch is the FIRST bar that closes above every average, the bundle and the 200-day alike, as they stack into 8 > 21 > 50. It is the convergence and the dangle, not a breakout: a stock riding on top of its averages that breaks out is a base breakout.',
  'setup.family3.hve': "an up day on a volume that DWARFS everything before it, ten times normal and above the prior record, often on a lesser-known name, the start of a new story; an earnings day counts when the volume is truly massive. That day's close is a LEVEL to mark on the chart, the price the biggest participants committed at; price may trade under it later. It is not an HVC (any high-volume close) and not a PEG (an earnings gap on big but ordinary volume); OPEX and month-end sessions do not count.",
  'setup.family3.gap_support': "a stock that is not in a downtrend gaps up at least 4% on twice its normal volume and holds the gap; days or weeks later it pulls back to the GAP-UP DAY'S LOW and buyers defend it. The best examples hold that low and keep the gap open; a slight breach that closes back above it is still good; a fill down to the gap-fill spot (the prior day's high) that reclaims the low is a lesser example, and a breach that does not reclaim is a failed gap. The gap day itself is a PEG, not gap support, and a gap never revisited is nothing.",
  'setup.family3.bear_gap': 'the first true gap down since a recent top, marked on the gap day itself. It is not Gap Support (a gap up that is later tested) and not a gap inside a downtrend.',
}

const card = { padding: 16, borderRadius: 14 }
const eyebrow = { fontSize: 11, fontWeight: 900, letterSpacing: '.2em', textTransform: 'uppercase' }

export default function Piece72PlainRules() {
  return (
    <div className={s.kit} style={{ maxWidth: 1180, margin: '0 auto', padding: '24px 18px', display: 'grid', gap: 18 }}>
      <h2 style={{ margin: 0, fontSize: 28, fontWeight: 900 }}>
        The setups in plain words <span style={{ fontSize: 14, color: '#a39e94', fontWeight: 600 }}>drafts for your approval; the bank&apos;s words today on the left</span>
      </h2>
      {Object.entries(PLAIN_RULES).map(([id, r]) => (
        <div key={id} data-testid={`plain-${id}`} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
          <div style={{ ...card, background: '#121316', border: '1px solid #2c2e34' }}>
            <div style={{ ...eyebrow, color: '#a39e94' }}>{r.name} · today</div>
            <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.55, color: '#bdb7aa' }}>{TODAY[id]}</p>
          </div>
          <div style={{ ...card, background: 'linear-gradient(180deg,#1c1d21,#121316)', border: '1px solid rgba(233,205,119,.45)' }}>
            <div style={{ ...eyebrow, color: '#e9cd77' }}>{r.name} · plain draft</div>
            <ol style={{ margin: '10px 0 0', paddingLeft: 20, display: 'grid', gap: 6, fontSize: 15.5, lineHeight: 1.45, color: '#f8f7f3' }}>{r.steps.map((x, i) => <li key={i}>{x}</li>)}</ol>
            <p style={{ margin: '10px 0 0', fontSize: 13.5, color: '#ffb3a8' }}>{r.notIt}</p>
          </div>
        </div>
      ))}
    </div>
  )
}
