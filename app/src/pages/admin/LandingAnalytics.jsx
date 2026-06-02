import { useEffect, useState } from 'react'
import styles from './LandingAnalytics.module.css'

const DAY_OPTIONS = [1, 7, 30, 90]

export default function LandingAnalytics() {
  const [days, setDays] = useState(7)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/landing-analytics/summary?days=${days}`, { credentials: 'include' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d) => { if (!cancelled) setData(d) })
      .catch((e) => { if (!cancelled) setError(String(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [days])

  const totalEvents = (data?.events || []).reduce((sum, e) => sum + e.n, 0)
  const maxDaily = Math.max(1, ...(data?.daily || []).map((d) => d.events))
  const maxEvent = Math.max(1, ...(data?.events || []).map((e) => e.n))

  const funnel = data?.funnel
  const ctr = funnel ? Math.round((funnel.click_through_rate || 0) * 1000) / 10 : 0

  return (
    <div className={styles.page}>
      <div className={styles.head}>
        <div>
          <h1 className={styles.h1}>Landing Analytics</h1>
          <p className={styles.sub}>
            Anonymous conversion events from <code>/</code>. Visitor IDs are
            localStorage-stable; IPs trimmed to /24.
          </p>
        </div>
        <div className={styles.daysRow}>
          {DAY_OPTIONS.map((n) => (
            <button
              key={n}
              className={`${styles.dayBtn} ${days === n ? styles.dayBtnActive : ''}`}
              onClick={() => setDays(n)}
            >
              {n}d
            </button>
          ))}
        </div>
      </div>

      {loading && <div className={styles.loading}>Loading…</div>}
      {error && <div className={styles.error}>Failed: {error}</div>}

      {!loading && !error && data && (
        <>
          {/* ── Funnel ── */}
          <div className={styles.funnel}>
            <div className={styles.stat}>
              <div className={styles.statLbl}>Unique visitors</div>
              <div className={styles.statVal}>{funnel?.views ?? 0}</div>
            </div>
            <div className={styles.funnelArrow}>→</div>
            <div className={styles.stat}>
              <div className={styles.statLbl}>Clicked any CTA</div>
              <div className={styles.statVal}>{funnel?.cta_clickers ?? 0}</div>
            </div>
            <div className={styles.funnelArrow}>→</div>
            <div className={`${styles.stat} ${styles.statHighlight}`}>
              <div className={styles.statLbl}>Click-through rate</div>
              <div className={styles.statVal}>{ctr}<span className={styles.statUnit}>%</span></div>
            </div>
          </div>

          {/* ── Per-event counts ── */}
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.h2}>Events</h2>
              <span className={styles.muted}>{totalEvents.toLocaleString()} total · last {days} day{days === 1 ? '' : 's'}</span>
            </div>
            {data.events.length === 0 ? (
              <div className={styles.empty}>No events in this window.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Event</th>
                    <th className={styles.alignRight}>Count</th>
                    <th>Share</th>
                  </tr>
                </thead>
                <tbody>
                  {data.events.map((row) => (
                    <tr key={row.event}>
                      <td><code>{row.event}</code></td>
                      <td className={styles.alignRight}>{row.n.toLocaleString()}</td>
                      <td>
                        <div className={styles.bar}>
                          <div
                            className={styles.barFill}
                            style={{ width: `${(row.n / maxEvent) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* ── Daily ── */}
          <div className={styles.panel}>
            <div className={styles.panelHead}>
              <h2 className={styles.h2}>Daily activity</h2>
              <span className={styles.muted}>Unique visitors and total events per day</span>
            </div>
            {data.daily.length === 0 ? (
              <div className={styles.empty}>No activity in this window.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Day</th>
                    <th className={styles.alignRight}>Visitors</th>
                    <th className={styles.alignRight}>Events</th>
                    <th>Volume</th>
                  </tr>
                </thead>
                <tbody>
                  {data.daily.map((row) => (
                    <tr key={row.day}>
                      <td><code>{row.day}</code></td>
                      <td className={styles.alignRight}>{row.visitors.toLocaleString()}</td>
                      <td className={styles.alignRight}>{row.events.toLocaleString()}</td>
                      <td>
                        <div className={styles.bar}>
                          <div
                            className={styles.barFill}
                            style={{ width: `${(row.events / maxDaily) * 100}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </>
      )}
    </div>
  )
}
