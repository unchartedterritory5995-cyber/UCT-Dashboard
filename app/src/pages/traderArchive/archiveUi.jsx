// app/src/pages/traderArchive/archiveUi.jsx
//
// The building blocks of The Desk → Archive (owner ruling 2026-10-28: cards, plain words, the
// numbers behind a "Details" fold). One call card renders both call shapes the server sends:
// a ticker/trader call ({outcome: {r5, r20, r60}, record_note}) and a playbook example
// ({r20, sim_R, regime, evidence}). Formatting only; the server owns every number.
//
// ⛔ A 404 means the archive is switched off and a 402 means no paid plan: both are said as
// such, never rendered as "nothing found".
import { clip, fmtDay, fmtR, rTone, setupName, traderOf } from '../../utils/traderArchive'
import ArchiveThumbs from './ArchiveThumbs'
import WatchLink from './WatchLink'
import styles from './TraderArchive.module.css'

export const SWR_OPTS = { revalidateOnFocus: false, shouldRetryOnError: false }

export const pct0 = (v) => (v === null || v === undefined ? '—' : `${Math.round(Number(v) * 100)}%`)

export function StateLine({ error, what }) {
  if (error?.status === 404) {
    return <p className={styles.notice} data-testid="archive-off">The trader archive isn&apos;t available yet.</p>
  }
  if (error?.status === 402) {
    return <p className={styles.notice} data-testid="archive-paywall">The trader archive is part of the paid plan.</p>
  }
  return <p className={styles.notice}>Couldn&apos;t load {what}. Try again in a moment.</p>
}

export function Outcome({ value, className }) {
  const tone = rTone(value)
  const cls = [className, tone === 'up' ? styles.up : tone === 'down' ? styles.down : ''].filter(Boolean).join(' ')
  return <span className={cls || undefined}>{fmtR(value)}</span>
}

export function Avatar({ name }) {
  return <span className={styles.avatar} aria-hidden="true">{String(name || '?').charAt(0).toUpperCase()}</span>
}

export function StatTile({ label, children, hint }) {
  return (
    <div className={styles.tile}>
      <span className={styles.tileValue}>{children}</span>
      <span className={styles.tileLabel}>{label}</span>
      {hint && <span className={styles.tileHint}>{hint}</span>}
    </div>
  )
}

export function SectionTitle({ children, count }) {
  return (
    <h3 className={styles.h3}>
      {children}{count !== undefined && <span className={styles.h3Count}>{count}</span>}
    </h3>
  )
}

function DetailRow({ label, value }) {
  if (value === null || value === undefined || value === '' || value === '—') return null
  return <><dt>{label}</dt><dd>{value}</dd></>
}

const fmtTradeR = (v) => (v === null || v === undefined ? null : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(2)}R`)

export function CallCard({ call }) {
  const r20 = call.outcome?.r20 ?? call.r20
  const words = call.evidence || call.record_note
  const dir = (call.direction || '').toLowerCase()
  const r5 = call.outcome?.r5
  const r60 = call.outcome?.r60
  const hasDetails = call.entry != null || call.stop != null || r5 != null || r60 != null || call.sim_R != null || call.regime
  return (
    <article className={styles.card} data-testid="ta-call">
      <header className={styles.cardHead}>
        <div className={styles.cardTitle}>
          <span className={styles.ticker}>{call.ticker}</span>
          {dir && <span className={dir === 'short' ? `${styles.dir} ${styles.dirShort}` : styles.dir}>{dir}</span>}
        </div>
        <div className={styles.result}>
          <Outcome value={r20} className={styles.resultValue} />
          <span className={styles.resultLabel}>20-day result</span>
        </div>
      </header>
      {call.setup && <span className={styles.setupChip}>{setupName(call.setup)}</span>}
      <p className={styles.byline}>{traderOf(call)} · {fmtDay(call.posted)}</p>
      {words && <p className={styles.words}>&ldquo;{clip(words, 220)}&rdquo;</p>}
      <ArchiveThumbs ids={call.images} max={1} />
      <div className={styles.cardFoot}>
        {hasDetails && (
          <details className={styles.details}>
            <summary>Details</summary>
            <dl className={styles.detailList}>
              <DetailRow label="Entry" value={call.entry} />
              <DetailRow label="Stop" value={call.stop} />
              <DetailRow label="5-day result" value={r5 != null ? fmtR(r5) : null} />
              <DetailRow label="60-day result" value={r60 != null ? fmtR(r60) : null} />
              <DetailRow label="Trade result" value={fmtTradeR(call.sim_R)} />
              <DetailRow label="Market" value={call.regime} />
            </dl>
          </details>
        )}
        <WatchLink call={call} className={styles.watch} />
      </div>
    </article>
  )
}

export function CallGrid({ calls, empty }) {
  if (!calls.length) return <p className={styles.empty}>{empty}</p>
  return <div className={styles.grid}>{calls.map((c) => <CallCard key={c.call_id} call={c} />)}</div>
}

const KIND = { CALL: 'Call', LESSON: 'Lesson', RECAP: 'Recap', IDEA: 'Idea', ENTRY: 'Entry', EXIT: 'Exit' }
const kindOf = (t) => KIND[String(t || '').toUpperCase()] || setupName(String(t || '').toLowerCase())

export function PostCard({ post, onTicker }) {
  const name = traderOf(post)
  const kind = post.record_type ? kindOf(post.record_type) : null
  return (
    <article className={styles.post}>
      <header className={styles.postHead}>
        <Avatar name={name} />
        <div className={styles.postWho}>
          <span className={styles.postName}>{name}</span>
          <span className={styles.postDate}>{fmtDay(post.stated_date || post.date)}</span>
        </div>
        {kind && <span className={styles.kind}>{kind}</span>}
      </header>
      {post.note && <p className={styles.note}>{post.note}</p>}
      {post.quote && <blockquote className={styles.quote}>{clip(post.quote, 600)}</blockquote>}
      <ArchiveThumbs ids={post.images} />
      {(post.tickers || []).length > 0 && (
        <div className={styles.tickerChips}>
          {post.tickers.map((t) => (onTicker
            ? <button key={t} type="button" className={styles.tickerChip} onClick={() => onTicker(t)}>{t}</button>
            : <span key={t} className={styles.tickerChip}>{t}</span>))}
        </div>
      )}
    </article>
  )
}

export function PostFeed({ posts, empty, onTicker }) {
  if (!posts.length) return <p className={styles.empty}>{empty}</p>
  return <div className={styles.feed}>{posts.map((p) => <PostCard key={p.record_id} post={p} onTicker={onTicker} />)}</div>
}
