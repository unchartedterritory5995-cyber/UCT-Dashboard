// TERM-089 — replay a past Morning Wire.
//
// ⛔ ONE RENDERER. A past issue is written into the SAME wrapper class the live
// rundown uses (`MorningWire.module.css` `.rundownWrap`), because every rundown
// style is a `:global(.rd-*)` rule scoped under it. A replay styled any other way
// would be a second authority on what a letter looks like.
//
// ⛔ PAID ONLY, AND FREE MEMBERS FETCH NOTHING. `/morning-wire` is the free tier,
// and today's wire stays free; past mornings are the paid product
// (`GET /api/wire/archive*` is `require_paid`). A free member gets no tile and no
// request, so their page never sends a read the server would refuse.
//
// ⛔ A MISSING DATE IS AN ABSENCE, NEVER A NEIGHBOUR. The server answers
// `held: false` for a date it does not hold, and the tile says so in words.
import { useMemo, useState } from 'react'
import useSWR from 'swr'
import TileCard from '../TileCard'
import jsonFetcher from '../../utils/jsonFetcher'
import { useIsPaid } from '../../context/AuthContext'
import wireStyles from '../../pages/MorningWire.module.css'
import styles from './WireArchive.module.css'

const INDEX_URL = '/api/wire/archive'

export default function WireArchive() {
  const isPaid = useIsPaid()
  if (!isPaid) return null
  return <WireArchivePanel />
}

function Coverage({ coverage }) {
  if (!coverage || !coverage.held) {
    return <p className={styles.note}>No past issues are archived yet.</p>
  }
  const missing = coverage.missing_weekdays || []
  return (
    <p className={styles.note}>
      {coverage.held} of {coverage.weekdays_in_range} weekdays held, {coverage.first} to {coverage.last}.
      {missing.length > 0 && (
        <> <span className={styles.gaps}>Not held: {missing.join(', ')}.</span></>
      )}
    </p>
  )
}

function WireArchivePanel() {
  const { data: index, error: indexError } = useSWR(INDEX_URL, jsonFetcher)
  const [picked, setPicked] = useState('')
  const { data: issue, error: issueError } = useSWR(
    picked ? `${INDEX_URL}/${picked}` : null, jsonFetcher,
  )
  // Memoized identity: React diffs dangerouslySetInnerHTML by object identity.
  const issueHtml = useMemo(() => ({ __html: issue?.html || '' }), [issue?.html])

  let body
  if (indexError) {
    body = (
      <p className={styles.note}>
        {indexError.status === 402 || indexError.status === 401
          ? 'Past issues are part of the paid plan.'
          : 'The archive could not be loaded right now.'}
      </p>
    )
  } else if (!index) {
    body = <p className={styles.note}>Loading the archive…</p>
  } else {
    const cov = index.coverage || {}
    body = (
      <>
        <Coverage coverage={cov} />
        {cov.held > 0 && (
          <label className={styles.picker}>
            <span>Replay the wire of</span>
            <input
              type="date"
              value={picked}
              min={cov.first || undefined}
              max={cov.last || undefined}
              onChange={(e) => setPicked(e.target.value)}
            />
          </label>
        )}
        {picked && issueError && (
          <p className={styles.note}>That issue could not be loaded right now.</p>
        )}
        {picked && !issueError && issue && issue.date === picked && !issue.held && (
          <p className={styles.absent}>No wire in the archive for {picked}.</p>
        )}
        {picked && !issueError && issue && issue.date === picked && issue.held && (
          <div className={styles.replay}>
            <div className={styles.replayLabel}>Replaying the wire of {issue.date}</div>
            <div className={wireStyles.rundownWrap} dangerouslySetInnerHTML={issueHtml} />
          </div>
        )}
      </>
    )
  }

  return (
    <TileCard title="Past issues" icon="calendar">
      {body}
    </TileCard>
  )
}
