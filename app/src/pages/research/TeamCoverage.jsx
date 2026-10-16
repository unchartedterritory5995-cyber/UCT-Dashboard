// app/src/pages/research/TeamCoverage.jsx
// "What has the trading team called on this name, and how did it go?"
//
// The full research page's sibling of DeskCoverage: DeskCoverage answers "what has the desk
// WRITTEN about it", this answers "what has the team CALLED on it" from the TSDR trader archive,
// with each call's measured outcome. Same card idiom, same rule: renders null when there is
// nothing to show, so it never adds an empty box to a name the team never called.
//
// Reads the shared archive key (useArchiveTicker), so the research modal's blocks and this card
// cost one request between them. ⛔ A 404 (archive off) or 402 (unpaid) renders nothing.
import { Link } from 'react-router-dom'

import useArchiveTicker, { newestCalls } from '../../components/research/sections/useArchiveTicker'
import { dayOf, fmtR, traderOf } from '../../utils/traderArchive'
import styles from './ResearchPage.module.css'

const MAX_ROWS = 6

export default function TeamCoverage({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useArchiveTicker(s)
  if (!s || error || !data) return null
  const calls = newestCalls(data)
  if (!calls.length) return null
  const shown = calls.slice(0, MAX_ROWS)

  return (
    <section className={styles.card} data-testid="team-coverage">
      <div className={styles.deskCovHead}>
        <h3 className={styles.deskCovTitle}>{s} in the trader archive</h3>
        <span className={styles.deskCovCount}>
          {calls.length} {calls.length === 1 ? 'call' : 'calls'}
          {data.n_scored ? ` · mean 20d ${fmtR(data.mean_r20)}` : ''}
        </span>
      </div>

      <ul className={styles.deskCovList}>
        {shown.map((c) => (
          <li key={c.call_id}>
            <Link className={styles.deskCovRow} to={`/trader-archive?sym=${encodeURIComponent(s)}`}>
              <span className={styles.deskCovDate}>{dayOf(c.posted)}</span>
              <span className={styles.deskCovName}>
                {traderOf(c)}{c.direction ? ` · ${c.direction}` : ''}{c.setup ? ` · ${c.setup}` : ''}
              </span>
              <span className={styles.deskCovMeta}>20d {fmtR(c.outcome?.r20)}</span>
            </Link>
          </li>
        ))}
      </ul>

      <Link className={styles.deskCovMore} to={`/trader-archive?sym=${encodeURIComponent(s)}`}>
        {calls.length > shown.length ? `All ${calls.length} calls in the trader archive →` : 'Open the trader archive →'}
      </Link>
    </section>
  )
}
