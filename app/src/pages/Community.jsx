import useSWR from 'swr'
import styles from './Community.module.css'

const fetcher = url => fetch(url).then(r => r.json())

export default function Community() {
  const { data: stats } = useSWR('/api/community/stats', fetcher, { refreshInterval: 120000 })

  if (!stats) return <div className={styles.page}><p className={styles.loading}>Loading community stats…</p></div>

  if (stats.total_closed_trades === 0) {
    return (
      <div className={styles.page}>
        <h1 className={styles.heading}>Community</h1>
        <div className={styles.empty}>
          <div className={styles.emptyIcon}>📊</div>
          <div className={styles.emptyText}>
            No community data yet.<br />
            As members close trades in their journals,<br />
            anonymous aggregate stats will appear here.
          </div>
        </div>
      </div>
    )
  }

  const totalDir = stats.direction_split.long + stats.direction_split.short
  const longPct = totalDir > 0 ? Math.round(stats.direction_split.long / totalDir * 100) : 50

  return (
    <div className={styles.page}>
      <h1 className={styles.heading}>Community</h1>
      <p className={styles.subtitle}>Anonymous aggregate stats from {stats.unique_traders} trader{stats.unique_traders !== 1 ? 's' : ''}</p>

      <div className={styles.statsGrid}>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Total Trades</div>
          <div className={styles.statValue}>{stats.total_closed_trades}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Win Rate</div>
          <div className={styles.statValue}>{stats.community_win_rate}%</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Profit Factor</div>
          <div className={styles.statValue}>{stats.profit_factor}</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Avg Win</div>
          <div className={`${styles.statValue} ${styles.statGain}`}>+{stats.avg_win_pct}%</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>Avg Loss</div>
          <div className={`${styles.statValue} ${styles.statLoss}`}>-{stats.avg_loss_pct}%</div>
        </div>
        <div className={styles.stat}>
          <div className={styles.statLabel}>This Week</div>
          <div className={styles.statValue}>{stats.recent_activity}</div>
        </div>
      </div>

      {/* Direction split */}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Direction Split</div>
        <div className={styles.splitBar}>
          <div className={styles.splitLong} style={{ width: `${longPct}%` }}>
            {longPct > 10 ? `LONG ${longPct}%` : ''}
          </div>
          <div className={styles.splitShort} style={{ width: `${100 - longPct}%` }}>
            {100 - longPct > 10 ? `SHORT ${100 - longPct}%` : ''}
          </div>
        </div>
      </div>

      {/* Popular setups */}
      {stats.popular_setups.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Most Used Setups</div>
          <div className={styles.setupGrid}>
            {stats.popular_setups.map(s => {
              const maxCount = stats.popular_setups[0].count
              return (
                <div key={s.setup} className={styles.setupCard}>
                  <div className={styles.setupName}>{s.setup}</div>
                  <div className={styles.setupMeta}>{s.count} trades</div>
                  <div className={styles.setupBar}>
                    <div className={styles.setupBarFill} style={{ width: `${(s.count / maxCount) * 100}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Best setups */}
      {stats.best_setups.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionTitle}>Highest Win Rate Setups (min 3 trades)</div>
          <div className={styles.setupGrid}>
            {stats.best_setups.map(s => (
              <div key={s.setup} className={styles.setupCard}>
                <div className={styles.setupName}>{s.setup}</div>
                <div className={styles.setupMeta}>
                  {s.win_rate}% WR · {s.total} trades · {s.avg_pnl >= 0 ? '+' : ''}{s.avg_pnl}%
                </div>
                <div className={styles.setupBar}>
                  <div className={styles.setupBarFill} style={{ width: `${s.win_rate}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
