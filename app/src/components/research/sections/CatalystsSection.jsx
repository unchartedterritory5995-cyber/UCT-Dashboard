// app/src/components/research/sections/CatalystsSection.jsx
//
// Everything that carries the CATALYST tag for this name — the generated
// significant catalysts (this year's big-move days, web-grounded), the
// earnings reactions and the curated wire — the same merged feed the /charts
// News & Catalysts widget reads (/api/news-catalysts). It sits beside News on
// purpose (owner ask, 2026-08-21): News is outside links — wire coverage and
// the company's own PRs; this is OUR read of what actually moved the stock,
// newest first. Pre-generated for the week's reporters by the calendar warm
// pass, so on the names people open it is already written.
import { useEffect, useMemo, useState } from 'react'
import useMobileSWR from '../../../hooks/useMobileSWR'

import UIcon from '../../ui/UIcon'
import { EmptyState } from '../../research-kit'
import { SkeletonBlock } from '../../Skeleton'
import { fmtDate, fmtMove } from '../../../utils/feedFormat'
import { GENERATING_POLL_MS, paidFetcher } from './paidFetcher'
import styles from './CatalystsSection.module.css'

const SOURCE_ICON = { catalyst: 'bolt', earnings: 'calendar', breaking: 'bell' }
const SOURCE_LABEL = { catalyst: 'Catalyst', earnings: 'Earnings', breaking: 'Wire' }
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'up', label: '▲ Up' },
  { key: 'down', label: '▼ Down' },
]

export default function CatalystsSection({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const [filter, setFilter] = useState('all')
  // Poll fast only while the catalysts are being written, then stop.
  const [polling, setPolling] = useState(false)
  const { data } = useMobileSWR(
    s ? `/api/news-catalysts/${encodeURIComponent(s)}` : null, paidFetcher,
    { refreshInterval: polling ? GENERATING_POLL_MS : 0, dedupingInterval: 1500, revalidateOnFocus: false },
  )
  const isGenerating = data?.status === 'generating'
  useEffect(() => { setPolling(isGenerating) }, [isGenerating])
  const events = useMemo(() => (Array.isArray(data?.events) ? data.events : []), [data])
  const shown = useMemo(
    () => (filter === 'all' ? events : events.filter((e) => e.direction === filter)),
    [events, filter],
  )

  if (!s) return null
  if (data?.paywalled) {
    return (
      <EmptyState
        icon="lock"
        title="Catalysts require a paid plan"
        hint="The generated catalyst history is part of the paid research tools."
      />
    )
  }

  const generating = isGenerating
  const loading = data === undefined

  return (
    <div className={styles.wrap} data-testid="catalysts-section">
      <div className={styles.bar} role="group" aria-label="Catalyst direction">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={filter === f.key ? `${styles.pill} ${styles.pillOn}` : styles.pill}
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
          >{f.label}</button>
        ))}
      </div>

      {generating && (
        <div className={styles.generating} role="status" aria-live="polite" data-testid="catalysts-generating">
          <span className={styles.spinner} aria-hidden="true" />
          Finding this year&apos;s significant catalysts — about half a minute for a name we
          haven&apos;t covered yet. They appear here on their own.
        </div>
      )}

      {loading && (
        <ul className={styles.list} aria-hidden="true">
          {[0, 1, 2, 3].map((i) => (
            <li key={i} className={styles.item}><SkeletonBlock height={52} /></li>
          ))}
        </ul>
      )}

      {!loading && !generating && shown.length === 0 && (
        <EmptyState
          icon="bolt"
          title={events.length ? `No ${filter} catalysts for ${s}` : `No catalysts yet for ${s}`}
          hint="A catalyst is recorded once a move has a reason we can name — earnings, guidance, a deal, a headline."
        />
      )}

      {shown.length > 0 && (
        <ul className={styles.list} data-testid="catalysts-list">
          {shown.map((e, i) => {
            const dir = e.direction || 'neutral'
            const dirCls = dir === 'up' ? styles.up : dir === 'down' ? styles.down : styles.neutral
            return (
              <li key={`${e.type}-${e.date}-${i}`} className={styles.item}>
                <span className={`${styles.icon} ${dirCls}`} title={SOURCE_LABEL[e.type] || e.type}>
                  <UIcon name={SOURCE_ICON[e.type] || 'bolt'} size={13} gold={false} />
                </span>
                <div className={styles.main}>
                  <div className={styles.meta}>
                    <span className={styles.kind}>{SOURCE_LABEL[e.type] || 'Catalyst'}</span>
                    <span className={styles.date}>{fmtDate(e.date)}</span>
                    {e.move_pct != null && (
                      <span className={`${styles.move} ${dirCls}`}>{fmtMove(e.move_pct)}</span>
                    )}
                    {e.url
                      ? <a className={styles.source} href={e.url} target="_blank" rel="noopener noreferrer">{e.source}</a>
                      : e.source ? <span className={styles.source}>{e.source}</span> : null}
                  </div>
                  <span className={styles.title}>{e.title}</span>
                  {e.description && <p className={styles.desc}>{e.description}</p>}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {events.length > 0 && (
        <div className={styles.provenance} data-testid="catalysts-provenance">
          AI · generated catalysts, earnings reactions and the curated wire
        </div>
      )}
    </div>
  )
}
