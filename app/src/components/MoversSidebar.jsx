// app/src/components/MoversSidebar.jsx
import { useMemo, useState } from 'react'
import useMobileSWR from '../hooks/useMobileSWR'
import useBatchTweetCounts from '../hooks/useBatchTweetCounts'
import useTickerTweets from '../hooks/useTickerTweets'
import { timeAgo } from '../utils/timeAgo'
import TickerPopup from './TickerPopup'
import CompanyLogo from './CompanyLogo'
import ErrorState from './ErrorState'
import UIcon from './ui/UIcon'
import { SkeletonTable } from './Skeleton'
import styles from './MoversSidebar.module.css'
import { prefetchBarOnIntent } from '../utils/prefetchBars'

const fetcher = (url) => fetch(url).then((r) => r.json())

// Master kill-switch for the tweet surfaces (per-row 🐦 icon + expand).
// Default ON; set VITE_TWITTER_UI_ENABLED="0" to hide everything.
const UI_ENABLED = (import.meta.env.VITE_TWITTER_UI_ENABLED ?? '1') !== '0'

function renderTweetText(text) {
  if (!text) return null
  // Style cashtags ($AAPL) in brand gold while keeping plain text intact.
  const parts = text.split(/(\$[A-Z]{1,5}\b)/g)
  return parts.map((p, i) =>
    /^\$[A-Z]{1,5}$/.test(p)
      ? (
        <span key={i} className={styles.cashtag}>{p}</span>
      )
      : (
        <span key={i}>{p}</span>
      ),
  )
}

function TweetExpand({ sym }) {
  const { data } = useTickerTweets(sym, { hours: 24 })
  if (!data || data.length === 0) return null
  return (
    <div className={styles.tweetExpand}>
      {data.slice(0, 5).map((t) => (
        <div key={t.id} className={styles.tweetRow}>
          <span className={styles.tweetHandle}>@{t.author_handle}</span>
          <span className={styles.tweetTime}>{timeAgo(t.created_at)}</span>
          <a className={styles.tweetLink} href={t.url} target="_blank" rel="noreferrer" title="open on X">↗</a>
          <div
            className={styles.tweetText}
            style={t.is_retweet ? { fontSize: '90%', opacity: 0.75 } : undefined}
          >
            {t.is_retweet ? 'RT: ' : ''}{renderTweetText(t.text)}
          </div>
        </div>
      ))}
    </div>
  )
}

function MoverSection({ label, items, positive, tweetCounts }) {
  const [expandedSym, setExpandedSym] = useState(null)
  return (
    <div className={styles.section}>
      <div className={`${styles.sectionLabel} ${positive ? styles.green : styles.red}`}>
        {positive ? '▲' : '▼'} {label}
      </div>
      <div className={styles.rows}>
        {items.map((item) => {
          const count = tweetCounts?.[item.sym] || 0
          const isExpanded = expandedSym === item.sym
          return (
            <div key={item.sym} className={styles.rowGroup}>
              <div
                className={styles.row}
                onPointerEnter={() => prefetchBarOnIntent(item.sym, 'D')}
                onFocus={() => prefetchBarOnIntent(item.sym, 'D')}
              >
                <span className={styles.symWrap}>
                  <CompanyLogo sym={item.sym} size={18} tile />
                  <TickerPopup sym={item.sym}>
                    <span className={styles.sym}>{item.sym}</span>
                  </TickerPopup>
                </span>
                <span className={`${styles.pct} ${positive ? styles.green : styles.red}`}>
                  {item.pct}
                </span>
                {UI_ENABLED && count > 0 && (
                  <button
                    type="button"
                    className={styles.birdBtn}
                    title={`${count} recent tweet${count > 1 ? 's' : ''}`}
                    onClick={() => setExpandedSym(isExpanded ? null : item.sym)}
                  >
                    <UIcon name="chat" size={13} />
                  </button>
                )}
              </div>
              {isExpanded && <TweetExpand sym={item.sym} />}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function MoversSidebar({ data: propData }) {
  const [open, setOpen] = useState(true)
  const { data: fetched, error, mutate } = useMobileSWR(
    propData !== undefined ? null : '/api/movers',
    fetcher,
    { refreshInterval: 30000, marketHoursOnly: true },
  )
  const data = propData !== undefined ? propData : fetched

  const allMoverSymbols = useMemo(() => {
    if (!data) return []
    return [...(data.ripping ?? []), ...(data.drilling ?? [])].map((x) => x.sym)
  }, [data])

  const { data: tweetCounts } = useBatchTweetCounts(UI_ENABLED ? allMoverSymbols : [])

  return (
    <div className={styles.tile}>
      <button className={styles.header} onClick={() => setOpen((o) => !o)}>
        <span className={styles.title}>Movers at the Open</span>
        <span className={styles.chevron}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className={styles.body}>
          {error ? (
            <ErrorState compact message="Failed to load movers" onRetry={() => mutate()} />
          ) : !data ? (
            <SkeletonTable rows={6} cols={2} />
          ) : (
            <div className={styles.scroll}>
              <div className={styles.moversGrid}>
                <MoverSection label="RIPPING" items={data.ripping ?? []} positive tweetCounts={tweetCounts} />
                <MoverSection label="DRILLING" items={data.drilling ?? []} positive={false} tweetCounts={tweetCounts} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
