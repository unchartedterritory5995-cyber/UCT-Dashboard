// app/src/pages/community/components/CardRenderer.jsx
// DOM-rendered rich cards (no server image in the send path). Theme-aware via
// design tokens. Clicking a ticker opens the full TickerPopup live-chart modal
// ("act from the floor"). Card payloads are server-built + redacted.
import TickerPopup from '../../../components/TickerPopup'
import UIcon from '../../../components/ui/UIcon'
import styles from '../Community.module.css'

const money = (v) => (v == null ? '—' : `$${Number(v).toFixed(2)}`)
const pct = (v) => (v == null ? '—' : `${(Number(v) * 100).toFixed(1)}%`)
const rmult = (v) => (v == null ? '—' : `${Number(v) >= 0 ? '+' : ''}${Number(v).toFixed(2)}R`)

function TickerBadge({ ticker }) {
  return (
    <TickerPopup sym={ticker} as="button" className={styles.cardTickerBtn}>
      ${ticker}
    </TickerPopup>
  )
}

function ChartCard({ card }) {
  const dims = card.w && card.h ? { aspectRatio: `${card.w} / ${card.h}` } : { aspectRatio: '16 / 9' }
  return (
    <div className={styles.card} data-kind="chart">
      <div className={styles.cardHead}>
        <UIcon name="chart" size={14} />
        <TickerBadge ticker={card.ticker} />
        <span className={styles.cardMuted}>{card.tf}</span>
        {!card.snapshotUrl && (
          <TickerPopup sym={card.ticker} as="button" className={styles.cardOpenInline}>
            Open live chart →
          </TickerPopup>
        )}
      </div>
      {card.snapshotUrl && (
        <div className={styles.cardShot} style={dims}>
          <img src={card.snapshotUrl} alt={`${card.ticker} chart`} loading="lazy" />
        </div>
      )}
    </div>
  )
}

function TradeCard({ card }) {
  const win = card.result === 'Win'
  return (
    <div className={styles.card} data-kind="trade">
      <div className={styles.cardHead}>
        <UIcon name="journal" size={14} />
        <TickerBadge ticker={card.symbol} />
        <span className={styles.cardMuted}>{card.side}</span>
        <span className={`${styles.cardResult} ${win ? styles.cardWin : styles.cardLoss}`}>
          {card.result || '—'}
        </span>
      </div>
      <div className={styles.cardStats}>
        <div><span className={styles.cardMuted}>R</span><b className={win ? styles.cardWin : styles.cardLoss}>{rmult(card.rMultiple)}</b></div>
        <div><span className={styles.cardMuted}>%</span><b>{pct(card.pnlPercent)}</b></div>
        <div><span className={styles.cardMuted}>Entry</span><b>{money(card.entryPrice)}</b></div>
        <div><span className={styles.cardMuted}>Exit</span><b>{money(card.exitPrice)}</b></div>
      </div>
      {card.setup && <div className={styles.cardSetup}>{card.setup}</div>}
    </div>
  )
}

function FlowCard({ card }) {
  const call = card.cp === 'C'
  return (
    <div className={styles.card} data-kind="flow">
      <div className={styles.cardHead}>
        <UIcon name="bolt" size={14} />
        <TickerBadge ticker={card.ticker} />
        <span className={`${styles.cardResult} ${call ? styles.cardWin : styles.cardLoss}`}>
          {call ? 'CALL' : card.cp === 'P' ? 'PUT' : '—'}
        </span>
        {card.grade && <span className={styles.cardGrade}>{card.grade}</span>}
      </div>
      <div className={styles.cardStats}>
        <div><span className={styles.cardMuted}>Strike</span><b>{money(card.strike)}</b></div>
        <div><span className={styles.cardMuted}>Exp</span><b>{card.exp || '—'}</b></div>
        <div><span className={styles.cardMuted}>Prem</span><b>{card.premium != null ? `$${Number(card.premium).toLocaleString()}` : '—'}</b></div>
      </div>
    </div>
  )
}

function PollCard({ card, onVote }) {
  const results = card.results || { counts: {}, total: 0, my_vote: null }
  const total = results.total || 0
  const voted = !!results.my_vote
  return (
    <div className={styles.card} data-kind="poll">
      <div className={styles.pollQ}><UIcon name="ruler" size={13} /> {card.question}</div>
      <div className={styles.pollOpts}>
        {(card.options || []).map((o) => {
          const n = results.counts?.[o.key] || 0
          const pct = total ? Math.round((n / total) * 100) : 0
          const mine = results.my_vote === o.key
          return (
            <button key={o.key} className={`${styles.pollOpt} ${mine ? styles.pollOptMine : ''}`}
              onClick={() => onVote?.(o.key)}>
              <span className={styles.pollBar} style={{ width: voted ? `${pct}%` : '0%' }} />
              <span className={styles.pollLabel}>{o.label}{mine ? ' ✓' : ''}</span>
              {voted && <span className={styles.pollPct}>{pct}%</span>}
            </button>
          )
        })}
      </div>
      <div className={styles.pollTotal}>{total} vote{total === 1 ? '' : 's'}{voted ? '' : ' · tap to vote'}</div>
    </div>
  )
}

export default function CardRenderer({ card, onVote }) {
  if (!card || !card.kind) return null
  if (card.kind === 'chart') return <ChartCard card={card} />
  if (card.kind === 'trade') return <TradeCard card={card} />
  if (card.kind === 'flow') return <FlowCard card={card} />
  if (card.kind === 'poll') return <PollCard card={card} onVote={onVote} />
  return null
}
