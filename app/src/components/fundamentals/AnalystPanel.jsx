import useAnalystIntel from '../../hooks/useAnalystIntel'
import UIcon from '../ui/UIcon'
import styles from './AnalystPanel.module.css'

const fmtPct = v => (v == null ? '' : `${v > 0 ? '+' : ''}${v}%`)
const fmt$ = v => (v == null ? '—' : `$${Number(v).toFixed(2)}`)
const pctClass = v => (v == null ? '' : v >= 0 ? styles.pos : styles.neg)
const clampPct = v => Math.min(100, Math.max(0, v))

function ConsensusBar({ c }) {
  if (!c) return null
  const buy = (c.buy || 0) + (c.strong_buy || 0)
  const sell = (c.sell || 0) + (c.strong_sell || 0)
  const total = buy + (c.hold || 0) + sell || 1
  return (
    <div className={styles.block}>
      <div className={styles.row}>
        <span className={styles.rating}>{c.rating || '—'}</span>
        <span className={styles.counts}>
          <span className={styles.pos}>{buy} Buy</span>
          <span className={styles.muted}>{c.hold || 0} Hold</span>
          <span className={styles.neg}>{sell} Sell</span>
        </span>
      </div>
      <div className={styles.bar}>
        <span className={styles.barBuy} style={{ width: `${buy / total * 100}%` }} />
        <span className={styles.barHold} style={{ width: `${(c.hold || 0) / total * 100}%` }} />
        <span className={styles.barSell} style={{ width: `${sell / total * 100}%` }} />
      </div>
    </div>
  )
}

function TargetRange({ p }) {
  if (!p || p.avg == null) return null
  const low = p.low ?? p.avg
  const high = p.high ?? p.avg
  const span = high - low
  const posOf = v => (span > 0 && v != null ? clampPct((v - low) / span * 100) : null)
  const avgPos = posOf(p.avg)
  const curPos = posOf(p.current)
  const meta = [
    p.count ? `${p.count} analyst${p.count === 1 ? '' : 's'}` : null,
    p.updated ? `as of ${p.updated}` : null,
  ].filter(Boolean).join(' · ')
  return (
    <div className={styles.block}>
      <div className={styles.row}>
        <span className={styles.muted}>Price Target</span>
        {p.upside_pct != null && <span className={pctClass(p.upside_pct)}>{fmtPct(p.upside_pct)} upside</span>}
      </div>
      <div className={styles.row}>
        <span className={styles.muted}>{fmt$(p.low)}</span>
        <span className={styles.ptAvg}>{fmt$(p.avg)}</span>
        <span className={styles.muted}>{fmt$(p.high)}</span>
      </div>
      {span > 0 && (
        <div className={styles.ptTrack} title={`Range ${fmt$(p.low)} – ${fmt$(p.high)}`}>
          {avgPos != null && <span className={styles.ptFill} style={{ width: `${avgPos}%` }} />}
          {curPos != null && (
            <span className={styles.ptCurrent} style={{ left: `${curPos}%` }} title={`Current ${fmt$(p.current)}`} />
          )}
        </div>
      )}
      {meta && <div className={styles.ptMeta}>{meta}</div>}
    </div>
  )
}

function actionMeta(action) {
  const key = (action || '').toLowerCase()
  if (key.includes('up')) return { glyph: '▲', cls: styles.pos, label: 'Upgrade' }
  if (key.includes('down')) return { glyph: '▼', cls: styles.neg, label: 'Downgrade' }
  if (key.includes('reinstat')) return { glyph: '◆', cls: styles.init, label: 'Reinstated' }
  if (key.includes('init')) return { glyph: '◆', cls: styles.init, label: 'Initiated' }
  if (!key) return { glyph: '•', cls: styles.muted, label: '' }
  return { glyph: '•', cls: styles.muted, label: 'Reiterated' }
}

function ActionRow({ a }) {
  const { glyph, cls, label } = actionMeta(a.action)
  const linkProps = a.news_url
    ? { href: a.news_url, target: '_blank', rel: 'noopener noreferrer', title: a.news_publisher ? `Source: ${a.news_publisher}` : 'Open source' }
    : {}
  const Tag = a.news_url ? 'a' : 'div'
  return (
    <Tag className={styles.action} {...linkProps}>
      <span className={`${styles.glyph} ${cls}`}>{glyph}</span>
      {label && <span className={`${styles.actionLabel} ${cls}`}>{label}</span>}
      <span className={styles.firm}>{a.firm || '—'}</span>
      <span className={styles.grades}>{a.from_grade ? `${a.from_grade} → ` : ''}{a.to_grade || ''}</span>
      {a.news_url && <UIcon name="link" size={10} gold={false} className={styles.linkIcon} />}
      <span className={styles.date}>{a.date}</span>
    </Tag>
  )
}

function Skeleton() {
  return (
    <div className={styles.root} aria-hidden="true">
      <div className={styles.block}>
        <div className={`${styles.skelLine} ${styles.skelShort}`} />
        <div className={styles.skelBar} />
      </div>
      <div className={styles.block}>
        <div className={`${styles.skelLine} ${styles.skelShort}`} />
        <div className={styles.skelTrack} />
      </div>
      <div className={styles.block}>
        <div className={`${styles.skelLine} ${styles.skelShort}`} />
        {[0, 1, 2].map(i => <div key={i} className={styles.skelRow} />)}
      </div>
    </div>
  )
}

export default function AnalystPanel({ sym }) {
  const { data } = useAnalystIntel(sym)
  if (!sym) return <div className={styles.hint}>Pick a ticker.</div>
  // A refusal is not a slow load. `/api/analyst/{sym}` is paid as of 2026-08-09
  // and this panel is reachable from a ticker chip on the FREE Morning Wire, so
  // without this branch a free member gets a skeleton that never resolves.
  if (data?.locked) {
    return <div className={styles.hint}>Analyst coverage is part of a paid plan.</div>
  }
  if (!data) return <Skeleton />
  const has = data.consensus || data.price_target || (data.recent_actions || []).length
  if (!has) return <div className={styles.hint}>No analyst coverage for {sym}.</div>
  return (
    <div className={styles.root}>
      <ConsensusBar c={data.consensus} />
      <TargetRange p={data.price_target} />
      {(data.recent_actions || []).length > 0 && (
        <div className={styles.block}>
          <div className={styles.sectionLabel}>Recent rating changes</div>
          {data.recent_actions.map((a, i) => <ActionRow key={i} a={a} />)}
        </div>
      )}
    </div>
  )
}
