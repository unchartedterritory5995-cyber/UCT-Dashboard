import { useMemo, useState } from 'react'
import useCatalysts from '../../hooks/useCatalysts'
import useUserTickerSet from '../../hooks/useUserTickerSet'
import HighlightThesis from '../../utils/highlightThesis'
import { timeAgo, formatET } from '../../utils/timeAgo'
import TickerPopup from '../TickerPopup'
import { useAuth } from '../../context/AuthContext'
import styles from './CatalystTable.module.css'

const UI_ENABLED = (import.meta.env.VITE_CATALYST_UI_ENABLED ?? '1') !== '0'

const ALL_TAGS = ['Catalyst', 'Earnings', 'Gapper', 'News']

function TagChip({ tag, active, onClick, count }) {
  const cls = {
    Catalyst: styles.tagCatalyst,
    Earnings: styles.tagEarnings,
    Gapper:   styles.tagGapper,
    News:     styles.tagNews,
  }[tag] || styles.tagDefault
  const dim = !active ? styles.chipDim : ''
  return (
    <button
      type="button"
      className={`${styles.tag} ${cls} ${styles.chipBtn} ${dim}`}
      onClick={onClick}
      title={`Toggle ${tag} (${count})`}
    >
      {tag}{count != null ? ` ${count}` : ''}
    </button>
  )
}

function RowTagChip({ tag }) {
  const cls = {
    Catalyst: styles.tagCatalyst,
    Earnings: styles.tagEarnings,
    Gapper:   styles.tagGapper,
    News:     styles.tagNews,
  }[tag] || styles.tagDefault
  return <span className={`${styles.tag} ${cls}`}>{tag || '—'}</span>
}

function fmtPct(v) {
  if (v == null) return '—'
  const sign = v > 0 ? '+' : ''
  return `${sign}${v.toFixed(2)}%`
}

function fmtVolX(v) {
  if (v == null || v === 0) return '—'
  if (v >= 100) return `${v.toFixed(0)}×`
  if (v >= 10) return `${v.toFixed(1)}×`
  return `${v.toFixed(2)}×`
}

function fmtPrice(v) {
  if (v == null) return '—'
  return `$${v.toFixed(2)}`
}

function parseSources(raw) {
  if (!raw) return []
  if (Array.isArray(raw)) return raw.filter(Boolean)
  try {
    const arr = JSON.parse(raw)
    return Array.isArray(arr) ? arr.filter(Boolean) : []
  } catch {
    return []
  }
}

function CitationsPopover({ sources }) {
  const [open, setOpen] = useState(false)
  if (!sources || sources.length === 0) return null
  return (
    <span className={styles.citationsWrap}>
      <button
        type="button"
        className={styles.citationsBtn}
        onClick={() => setOpen(o => !o)}
        title={`${sources.length} source${sources.length > 1 ? 's' : ''} cited`}
      >
        ⓘ
      </button>
      {open && (
        <span className={styles.citationsPop}>
          <span className={styles.citationsHeader}>
            Sources ({sources.length})
            <button type="button" className={styles.citationsClose} onClick={() => setOpen(false)}>✕</button>
          </span>
          {sources.slice(0, 8).map((url, i) => (
            <a key={i} href={url} target="_blank" rel="noreferrer" className={styles.citationLink}>
              {(() => {
                try { return new URL(url).hostname.replace(/^www\./, '') }
                catch { return url.slice(0, 40) }
              })()}
            </a>
          ))}
        </span>
      )}
    </span>
  )
}

export default function CatalystTable() {
  const { data, mutate, isValidating } = useCatalysts()
  const auth = useAuth() || {}
  const isAdmin = auth?.user?.role === 'admin'
  const myTickers = useUserTickerSet()
  const [refreshing, setRefreshing] = useState(false)
  const [activeTags, setActiveTags] = useState(new Set(ALL_TAGS))

  if (!UI_ENABLED) return null

  const allRows = data?.rows || []
  const generatedAt = data?.generated_at

  // Per-tag counts (used in chip labels) — computed against full row list,
  // not filtered list, so toggling a chip doesn't change the counts.
  const tagCounts = useMemo(() => {
    const counts = {}
    for (const t of ALL_TAGS) counts[t] = 0
    for (const r of allRows) {
      if (counts[r.tag] != null) counts[r.tag]++
    }
    return counts
  }, [allRows])

  const filteredRows = useMemo(
    () => allRows.filter(r => activeTags.has(r.tag)),
    [allRows, activeTags]
  )

  function toggleTag(tag) {
    setActiveTags(prev => {
      const next = new Set(prev)
      if (next.has(tag)) next.delete(tag)
      else next.add(tag)
      // If user just turned everything off, turn everything back on
      if (next.size === 0) return new Set(ALL_TAGS)
      return next
    })
  }

  async function forceRefresh() {
    if (!isAdmin) return
    setRefreshing(true)
    try {
      await fetch('/api/catalysts/refresh', { method: 'POST' })
      setTimeout(() => mutate(), 3000)
    } finally {
      setTimeout(() => setRefreshing(false), 4000)
    }
  }

  const updatedText = generatedAt ? `updated ${timeAgo(generatedAt)}` : 'no data yet'
  const showingAll = activeTags.size === ALL_TAGS.length

  return (
    <div className={styles.tile}>
      <div className={styles.header}>
        <span className={styles.title}>🎯 STOCK CATALYSTS</span>
        <span className={styles.meta}>
          <span className={styles.updated}>{updatedText}</span>
          {isAdmin && (
            <button
              type="button"
              className={styles.refreshBtn}
              onClick={forceRefresh}
              disabled={refreshing || isValidating}
            >
              {refreshing ? '…' : '↻ Refresh'}
            </button>
          )}
        </span>
      </div>

      {allRows.length > 0 && (
        <div className={styles.chipRow}>
          {ALL_TAGS.map(t => (
            <TagChip
              key={t}
              tag={t}
              active={activeTags.has(t)}
              onClick={() => toggleTag(t)}
              count={tagCounts[t]}
            />
          ))}
          {!showingAll && (
            <button
              type="button"
              className={styles.chipBtn}
              onClick={() => setActiveTags(new Set(ALL_TAGS))}
              title="Show all"
            >
              reset
            </button>
          )}
        </div>
      )}

      {allRows.length === 0 ? (
        <div className={styles.empty}>
          No catalysts yet. Engine refreshes every 5 min during market hours.
        </div>
      ) : filteredRows.length === 0 ? (
        <div className={styles.empty}>
          No rows match the active tag filter. Click a chip above to add it back.
        </div>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colSym}>Sym</th>
                <th className={styles.colPrice}>Price</th>
                <th className={styles.colGap}>Gap %</th>
                <th className={styles.colVol}>Vol×</th>
                <th className={styles.colTag}>Tag</th>
                <th className={styles.colThesis}>Catalyst</th>
                <th className={styles.colUpdated}>When</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(r => {
                const onMyList = myTickers.has(String(r.ticker || '').toUpperCase())
                return (
                  <tr key={r.ticker} className={onMyList ? styles.rowMine : ''}>
                    <td className={styles.colSym}>
                      <TickerPopup sym={r.ticker}>
                        <span className={styles.ticker}>
                          {onMyList && <span className={styles.star} title="On your watchlist or flagged">★</span>}
                          {r.ticker}
                        </span>
                      </TickerPopup>
                    </td>
                    <td className={styles.colPrice}>{fmtPrice(r.price)}</td>
                    <td className={`${styles.colGap} ${(r.gap_pct ?? 0) >= 0 ? styles.gain : styles.loss}`}>
                      {fmtPct(r.gap_pct)}
                    </td>
                    <td className={styles.colVol}>{fmtVolX(r.vol_x)}</td>
                    <td className={styles.colTag}><RowTagChip tag={r.tag} /></td>
                    <td className={styles.colThesis}>
                      <HighlightThesis text={r.thesis_text} />
                      <CitationsPopover sources={parseSources(r.thesis_sources)} />
                    </td>
                    <td
                      className={styles.colUpdated}
                      title={r.catalyst_at
                        ? `Catalyst occurred ${timeAgo(r.catalyst_at)}\nSynthesized ${r.thesis_at ? timeAgo(r.thesis_at) : '—'}`
                        : (r.thesis_at ? `Synthesized ${timeAgo(r.thesis_at)} (no source timestamp)` : 'No data yet')}
                    >
                      {r.catalyst_at
                        ? formatET(r.catalyst_at)
                        : (r.thesis_at ? <span className={styles.fallbackTime}>{formatET(r.thesis_at)}</span> : '—')}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className={styles.footer}>
        Informational only — not investment advice. Synthesized by Claude Opus 4.7.
      </div>
    </div>
  )
}
