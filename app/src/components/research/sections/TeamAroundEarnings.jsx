// app/src/components/research/sections/TeamAroundEarnings.jsx
//
// "How the team traded this name's last reports": beneath the Earnings history table, each past
// report that had team calls within a few sessions of it, with what those calls did after
// (r5 / r20, measured after the fact). Reads the shared archive key (useArchiveTicker), so it
// costs nothing when the Catalysts tab has already asked for the ticker.
//
// ⛔ RENDERS NOTHING unless there is a match: archive off (404), no paid plan (402), an error,
// loading, or no call near any report all leave the history section exactly as it was.
import { callsAroundReports, AROUND_REPORT_DAYS } from '../archiveEarnings'
import { dayOf, fmtR, rTone, traderOf } from '../../../utils/traderArchive'
import useArchiveTicker from './useArchiveTicker'
import styles from './TraderArchiveBlock.module.css'

const MAX_REPORTS = 6

export default function TeamAroundEarnings({ sym, quarters }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useArchiveTicker(s)
  if (!s || error || !data) return null
  const rows = callsAroundReports(quarters, data.calls).slice(-MAX_REPORTS).reverse()
  if (!rows.length) return null

  return (
    <section className={styles.wrap} data-testid="team-around-earnings" aria-labelledby="team-around-earnings-h">
      <h3 id="team-around-earnings-h" className={styles.heading}>The team around these reports</h3>
      <table className={styles.calls} aria-label="Team calls around past earnings reports">
        <thead>
          <tr>
            <th scope="col">Report</th><th scope="col">Posted</th><th scope="col">Trader</th>
            <th scope="col">Dir</th><th scope="col">Setup</th><th scope="col">R5</th><th scope="col">R20</th>
          </tr>
        </thead>
        <tbody>
          {rows.flatMap((r) => r.calls.map((c, i) => {
            const o = c.outcome || {}
            const tone = rTone(o.r20)
            return (
              <tr key={c.call_id} data-testid="team-around-earnings-row">
                <td>{i === 0 ? `${r.quarter} · ${r.report_date}` : ''}</td>
                <td>{dayOf(c.posted)}</td>
                <td>{traderOf(c)}</td>
                <td>{c.direction || '—'}</td>
                <td>{c.setup || '—'}</td>
                <td>{fmtR(o.r5)}</td>
                <td className={tone === 'up' ? styles.up : tone === 'down' ? styles.down : undefined}>{fmtR(o.r20)}</td>
              </tr>
            )
          }))}
        </tbody>
      </table>
      <p className={styles.footer}>
        Team calls posted within {AROUND_REPORT_DAYS} days of a report; outcomes are measured after the fact and are not advice.{' '}
        <a className={styles.link} href={`/trader-archive?sym=${encodeURIComponent(s)}`}>Open the trader archive</a>
      </p>
    </section>
  )
}
