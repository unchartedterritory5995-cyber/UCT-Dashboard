// app/src/components/research/sections/TeamReadTile.jsx
//
// The Setup canvas's "Team read": what the trader archive holds on this ticker (how many calls,
// how they did 20 sessions later, the most recent one) and how the setup of that most recent
// call has done across the whole archive (its playbook's win rate and edge verdict).
//
// Two reads, both shared and cached: the archive ticker key every research surface uses
// (useArchiveTicker) and one playbook for the latest call's setup.
//
// ⛔ RENDERS NOTHING without team calls on the ticker, so a name the team never called adds no
// empty box to a canvas whose gold budget and layout are already spent. No price levels are
// shown: a recent call's entry and stop are the trader's private store until they age out.
import useSWR from 'swr'

import { EyebrowLabel, StatTile } from '../../research-kit'
import { ARCHIVE_API, dayOf, edgeVerdict, fmtR, traderOf } from '../../../utils/traderArchive'
import { sectionFetcher } from './sectionFetch'
import useArchiveTicker, { ARCHIVE_SWR_OPTS, newestCalls } from './useArchiveTicker'
import styles from './SetupSection.module.css'

const pct0 = (v) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : `${Math.round(Number(v) * 100)}%`)

export default function TeamReadTile({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useArchiveTicker(s)
  const latest = !error && data ? newestCalls(data)[0] : null
  const setup = latest?.setup || null
  const { data: book } = useSWR(setup ? `${ARCHIVE_API}/playbook/${encodeURIComponent(setup)}` : null,
    sectionFetcher, ARCHIVE_SWR_OPTS)
  if (!s || error || !data || !latest) return null

  const all = book?.stats?.all || null
  return (
    <div className={styles.block} data-testid="team-read">
      <EyebrowLabel>Team read</EyebrowLabel>
      <div className={styles.stats}>
        <StatTile label="Team calls" value={String(data.n_calls ?? newestCalls(data).length)}
          sub={data.n_scored ? `${data.n_scored} scored` : null} />
        <StatTile label="Mean 20d after" value={data.n_scored ? fmtR(data.mean_r20) : null} />
        <StatTile label="Last call" value={dayOf(latest.posted) || null}
          sub={[traderOf(latest), latest.direction, setup].filter(Boolean).join(' · ')} />
        {book && all ? (
          <StatTile label={`${book.name || setup} record`} value={pct0(all.win20)}
            sub={`win 20d · ${edgeVerdict(all)}`} />
        ) : null}
      </div>
      <a className={styles.teamReadLink} href={`/trader-archive?sym=${encodeURIComponent(s)}`}>
        The team on {s} in the trader archive
      </a>
    </div>
  )
}
