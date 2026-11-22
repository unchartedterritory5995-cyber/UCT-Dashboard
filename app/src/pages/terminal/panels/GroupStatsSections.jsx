// GRP's sections, "Rank" (2026-11-22), "Fundamentals" and "Breadth". Rank: one sector's or industry's place among its
// peers by the median 6-month (and 3-month) price change of its stocks, now, 4, 13 and 52 weeks ago with the places
// moved, its best and worst week, and the year's weekly line. Fundamentals and breadth: its medians from SEC filings
// (point in time) with a year and three years ago and its rank among its peers, and its breadth (the shares
// above each average and near the 52-week high, with the 1-week and 1-month change, the day's highs, lows and
// advance / decline, and a year's line of the share above the 50-day). GRP's ranked list is untouched: the
// sections sit above it, closed, each saying its headline numbers on its own line; a section's table is drawn
// only once it is opened (a click or Enter on its line).
//
// ONE read, GET /api/research/group-stats?kind=&name= (groupStatsModel.js), asked only for a sector or an
// industry (the evening build covers those two; a UCT theme says so in one line). It fails apart from the rest
// of GRP: a failed read is one line with Retry, and the ranked list stands.
import { useMemo, useState } from 'react'
import { formatNumber } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureText, useMarketRead } from './marketRead'
import {
  GROUP_STATS_COMPUTING_POLL_MS, GROUP_STATS_KINDS, GROUP_STATS_POLL_MS, breadthCounts, breadthRows, breadthSummary, builtWords,
  dayWords, fundRows, fundStateWords, fundSummary, groupStatsUrl, placeText, pointsText, rankLine, rankLineWords, rankRows,
  rankStateWords, rankSummary, rankText, rankWindowWords, readGroupDetail, shareLine, shareLineWords, shareText, signedCount,
} from './groupStatsModel'
import styles from './marketPanels.module.css'
import local from './groupStats.module.css'

const count = (n) => formatNumber(n, { decimals: 0 })
/** A rank that wraps between its place and "of N", never inside "of N" ('3rd' / 'of 11'). */
const keepOf = (rank) => (rank ? rank.replace(/ of (\d)/, ' of\u00a0$1') : '')
const WHAT = 'The group\'s fundamentals and breadth'

/** A section that opens and closes: a <details> whose open state is the panel's own, so its body is drawn only
 *  while open and a click or Enter / Space on its line works the same in every browser. */
function Section({ testId, title, line, lineTestId, children }) {
  const [open, setOpen] = useState(false)
  return (
    <details className={local.section} data-testid={testId} open={open}>
      <summary onClick={(e) => { e.preventDefault(); setOpen((o) => !o) }}>
        <span className={local.sectionTitle}>{title}</span>{' '}
        <span className={local.sectionLine} data-testid={lineTestId}>{line}</span>
      </summary>
      {open ? <div className={local.sectionBody}>{children}</div> : null}
    </details>
  )
}

/** A figure with how many members it rests on, or the count alone when there are too few. */
function Figure({ fig, min, phone = false }) {
  const cls = phone ? styles.phoneHide : undefined
  if (fig.value === null) {
    return (
      <td className={cls}>
        <span className={local.few} aria-hidden="true">{fig.n ? `${count(fig.n)} with data` : 'None'}</span>
        <span className="sr-only">{fig.n ? `${count(fig.n)} with data, fewer than ${count(min)}: no figure` : 'No member has a figure'}</span>
      </td>
    )
  }
  return (
    <td className={cls}>
      <span className={local.main}>{fig.text}</span>
      <span className={local.sub}>of {count(fig.n)}</span>
    </td>
  )
}

/** A rank with the stocks it rests on, or the count alone when there are too few for a rank. */
function RankFigure({ cell }) {
  if (!cell.text) return <td><span className="sr-only">{cell.words}</span></td>
  return (
    <td className={`${styles.snugWrap} ${styles.phoneWrap}`}>
      <span className={cell.few ? local.few : local.main}>{keepOf(cell.text)}</span>
      {cell.sub ? <span className={local.sub}>{cell.sub}</span> : null}
    </td>
  )
}

function RankSection({ detail, kindWords }) {
  const down = rankStateWords(detail.rankState)
  const rows = useMemo(() => rankRows(detail), [detail])
  const m6 = detail.rank?.m6
  const geo = useMemo(() => (m6 ? rankLine(detail.rankDates, m6.line, m6.ofLine) : null), [detail, m6])
  const lastOf = geo ? rankText({ position: geo.last.position, of: geo.last.of }) || placeText(geo.last.position) : null
  return (
    <Section testId="terminal-grp-rank" title="Rank" line={rankSummary(detail)} lineTestId="terminal-grp-rank-line">
      {down || !rows.length ? (
        <p className={styles.note} role="status" data-testid="terminal-grp-rank-state">
          {down || `${detail.name} has no weekly rank in the last evening build.`}
        </p>
      ) : (
        <>
          <div className={styles.tableBox}>
            <table className={`${styles.table} ${local.stats}`} data-testid="terminal-grp-rank-table"
              aria-label={`${detail.name}: its place among the ${kindWords.many} by the median 6-month and 3-month price change of its stocks, now, 4, 13 and 52 weeks ago, and its best and worst week`}>
              <thead>
                <tr>
                  <th scope="col" className={local.metric}>Week</th>
                  <th scope="col" className={`${styles.snugWrap} ${styles.phoneWrap}`} title={`Its place among the ${kindWords.many} by the median 6-month price change of their stocks`}>By 6-month change</th>
                  <th scope="col" className={`${styles.snugWrap} ${styles.phoneWrap}`} title={`Its place among the ${kindWords.many} by the median 3-month price change of their stocks`}>By 3-month change</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} data-testid={`terminal-grp-rank-row-${r.key}`}>
                    <td className={local.metric}>
                      <span className={local.main}>{r.label}</span>
                      {r.date ? <span className={local.sub}>{dayWords(r.date)}</span> : null}
                    </td>
                    {r.cells.map((c, i) => <RankFigure key={i === 0 ? 'm6' : 'm3'} cell={c} />)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {geo ? (
            <div className={local.lineBox} data-testid="terminal-grp-rank-chart">
              <svg className={local.line} viewBox={`0 0 ${geo.w} ${geo.h}`} preserveAspectRatio="none" role="img" aria-label={rankLineWords(geo)}>
                <line className={local.mid} x1="0" x2={geo.w} y1={geo.mid} y2={geo.mid} />
                <path className={local.trace} d={geo.path} />
              </svg>
              <div className={local.lineScale} aria-hidden="true">
                <span>{dayWords(geo.first.date)}</span>
                <span>{dayWords(geo.last.date)}</span>
              </div>
              <p className={styles.muted}>
                Its 6-month rank each week for a year, 1st at the top and {placeText(geo.top)} at the bottom; the dashed line is
                the middle. Best {placeText(geo.best.position)} ({dayWords(geo.best.date)}), worst {placeText(geo.worst.position)}{' '}
                ({dayWords(geo.worst.date)}), latest {lastOf}. A week with fewer than {count(detail.minMembers)} stocks priced breaks
                the line.
              </p>
            </div>
          ) : (
            <p className={styles.muted} data-testid="terminal-grp-rank-no-chart">
              Fewer than two ranked weeks in the last year, so there is no line to draw.
            </p>
          )}
          <p className={styles.muted} data-testid="terminal-grp-rank-method">
            {detail.name}&apos;s place each week among the {kindWords.many} with at least {count(detail.minMembers)} stocks priced
            that week, by the median 6-month price change of their stocks, highest first (equal medians share a place); the 3-month
            column is the same with the 3-month change. A stock&apos;s 6-month change is its close against its own close{' '}
            {rankWindowWords(detail.rankSessions.m6, 'm6')} earlier, and the 3-month change the same over{' '}
            {rankWindowWords(detail.rankSessions.m3, 'm3')}: the windows of UCT&apos;s RS rating, on closing prices (split-adjusted,
            price only). A week&apos;s point is its last close, and Now is the last session; each week uses only the closes up to
            that day (no look-ahead). The members are today&apos;s: UCT keeps no history of which stocks were in a {kindWords.one},
            so a stock that has since left it, or stopped trading, is not counted in earlier weeks (survivorship).
          </p>
        </>
      )}
    </Section>
  )
}

function FundSection({ detail, kindWords }) {
  const off = fundStateWords(detail.fundState)
  const rows = useMemo(() => fundRows(detail), [detail])
  const summary = off ? 'not shown' : fundSummary(detail)
  return (
    <Section testId="terminal-grp-fund" title="Fundamentals" line={summary} lineTestId="terminal-grp-fund-line">
        {off ? <p className={styles.note} role="status" data-testid="terminal-grp-fund-state">{off}</p> : (
          <div className={styles.tableBox}>
            <table className={`${styles.table} ${local.stats}`} data-testid="terminal-grp-fund-table"
              aria-label={`${detail.name}: median company figures, a year and three years ago, and the rank among ${kindWords.many}`}>
              <thead>
                <tr>
                  <th scope="col" className={local.metric}>Figure</th>
                  <th scope="col" title="The median of the members with a figure, and how many that is">Median</th>
                  <th scope="col" className={`${styles.phoneHide} ${styles.snugWrap}`} title="The middle half of the members: from the lower to the upper quartile">Middle half</th>
                  <th scope="col" title="The median a year earlier, from the filings known then">A year ago</th>
                  <th scope="col" className={styles.phoneHide} title="The median three years earlier, from the filings known then">3 years ago</th>
                  <th scope="col" className={styles.snugWrap} title={`Its place among the ${kindWords.many} with a figure, highest first`}>Rank</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} data-testid={`terminal-grp-fund-row-${r.id}`} title={r.meta.methodology || undefined}>
                    <td className={local.metric}>
                      <span className={local.main}>{r.meta.name}</span>
                      {r.meta.subtitle ? <span className={local.sub}>{r.meta.subtitle}</span> : null}
                      <span className="sr-only">{r.words}</span>
                    </td>
                    <Figure fig={r.now} min={detail.minMembers} />
                    <td className={`${styles.phoneHide} ${styles.snugWrap}`}>{r.middle || ''}</td>
                    <Figure fig={r.yearAgo} min={detail.minMembers} />
                    <Figure fig={r.threeYears} min={detail.minMembers} phone />
                    <td className={styles.snugWrap}>{keepOf(r.rank)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {off ? null : (
          <p className={styles.muted} data-testid="terminal-grp-fund-method">
            Each figure is the median of the {detail.name} stocks with a value in force at the close of{' '}
            {dayWords(detail.fundRefs.now) || 'the last session'}, from their 10-Q and 10-K filings as known that day (SEC
            filings, point in time); the small line is how many stocks it rests on, and with fewer than {count(detail.minMembers)}{' '}
            the count is shown and no median. A year ago and three years ago use only the filings public by then. Growth is the
            newest quarter against the same quarter a year earlier; margins and ROE are trailing twelve months; P/E, P/S and FCF
            yield are worked out with UCT&apos;s stored close (a P/E with negative earnings is left out). Accelerating is the share
            whose newest quarter grew faster than the quarter before. The rank is among the {kindWords.many} with a figure, highest
            first, which is not a judgement: a high P/E ranks first. {detail.fundMembers != null ? `${count(detail.fundMembers)} of its ${count(detail.members)} stocks have current filing figures.` : ''}
          </p>
        )}
    </Section>
  )
}

function BreadthSection({ detail, kindWords }) {
  const rows = useMemo(() => breadthRows(detail), [detail])
  const c = useMemo(() => breadthCounts(detail), [detail])
  const geo = useMemo(() => shareLine(detail.lineDates, detail.breadth?.line), [detail])
  const down = detail.breadthState !== 'ok' || !c
  const session = dayWords(detail.session)
  return (
    <Section testId="terminal-grp-breadth" title="Breadth" line={down ? 'not shown' : breadthSummary(detail)} lineTestId="terminal-grp-breadth-line">
        {down ? (
          <p className={styles.note} role="status" data-testid="terminal-grp-breadth-down">
            No stored closes could be read for {detail.name} at the last evening build, so its breadth is not shown.
          </p>
        ) : (
          <>
            <div className={styles.tableBox}>
              <table className={`${styles.table} ${local.stats}`} data-testid="terminal-grp-breadth-table"
                aria-label={`${detail.name}: the share of its stocks above each average and near the 52-week high, now, a week and a month ago`}>
                <thead>
                  <tr>
                    <th scope="col" className={local.metric}>Share of stocks</th>
                    <th scope="col" title={`On ${session || 'the last session'}, and how many stocks had a close and enough history`}>Now</th>
                    <th scope="col" title={`Change in points from 5 sessions back${detail.sessions.week ? ` (${dayWords(detail.sessions.week)})` : ''}`}>1 week</th>
                    <th scope="col" title={`Change in points from 21 sessions back${detail.sessions.month ? ` (${dayWords(detail.sessions.month)})` : ''}`}>1 month</th>
                    <th scope="col" title={`Its place among the ${kindWords.many} with a share, highest first`}>Rank</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} data-testid={`terminal-grp-breadth-row-${r.key}`} title={r.title}>
                      <td className={local.metric}>{r.label}</td>
                      <Figure fig={{ value: r.now.share, n: r.now.n, text: shareText(r.now.share) }} min={detail.minMembers} />
                      <td>
                        {r.weekChange !== null ? <span className={local.main}>{pointsText(r.weekChange)}</span> : null}
                        {r.week.share !== null ? <span className={local.sub}>was {shareText(r.week.share)}</span> : <span className={local.few}>no share</span>}
                      </td>
                      <td>
                        {r.monthChange !== null ? <span className={local.main}>{pointsText(r.monthChange)}</span> : null}
                        {r.month.share !== null ? <span className={local.sub}>was {shareText(r.month.share)}</span> : <span className={local.few}>no share</span>}
                      </td>
                      <td>{keepOf(r.rank)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className={styles.muted} data-testid="terminal-grp-breadth-counts">
              {c.net !== null
                ? `On ${session || 'the last session'}: ${count(c.highs)} new 52-week closing ${c.highs === 1 ? 'high' : 'highs'} and ${count(c.lows)} new ${c.lows === 1 ? 'low' : 'lows'} of ${count(c.yearN)} stocks with a year of closes (highs minus lows ${signedCount(c.net)}${c.netRank ? `, ${c.netRank}` : ''}).`
                : `Fewer than ${count(detail.minMembers)} of its stocks have a year of closes, so new highs and lows are not counted.`}
              {c.n ? ` ${count(c.up)} closed up, ${count(c.down)} down${c.flat ? `, ${count(c.flat)} unchanged` : ''}.` : ''}
            </p>
            {geo ? (
              <div className={local.lineBox} data-testid="terminal-grp-breadth-chart">
                <svg className={local.line} viewBox={`0 0 ${geo.w} ${geo.h}`} preserveAspectRatio="none" role="img" aria-label={shareLineWords(geo)}>
                  <line className={local.mid} x1="0" x2={geo.w} y1={geo.mid} y2={geo.mid} />
                  <path className={local.trace} d={geo.path} />
                </svg>
                <div className={local.lineScale} aria-hidden="true">
                  <span>{dayWords(geo.first.date)}</span>
                  <span>{dayWords(geo.last.date)}</span>
                </div>
                <p className={styles.muted}>
                  Share above the 50-day average each session for a year, on a 0 to 100% scale; the dashed line is 50%. Now{' '}
                  {shareText(geo.last.v)}, low {shareText(geo.low.v)} ({dayWords(geo.low.date)}), high {shareText(geo.high.v)}{' '}
                  ({dayWords(geo.high.date)}). A day with fewer than {count(detail.minMembers)} stocks breaks the line.
                </p>
              </div>
            ) : (
              <p className={styles.muted} data-testid="terminal-grp-breadth-no-chart">
                Not enough sessions with {count(detail.minMembers)} or more stocks to draw a year of the share above the 50-day.
              </p>
            )}
            <p className={styles.muted} data-testid="terminal-grp-breadth-method">
              Of the {count(c.priced)} {detail.name} stocks with a close on {session || 'the last session'}, on closing prices from
              UCT&apos;s stored daily history (split-adjusted): above an average is a close above the plain average of the
              stock&apos;s own last 20, 50 or 200 closes; near the high is within 5% of its highest close of the last 252 sessions.
              A stock without enough closes for a measure is left out of it. A week and a month ago are 5 and 21 sessions back.
            </p>
          </>
        )}
    </Section>
  )
}

export default function GroupStatsSections({ kind, name }) {
  const asks = kind === 'sector' || kind === 'industry'
  const [computing, setComputing] = useState(false)
  const read = useMarketRead(asks && name ? groupStatsUrl(kind, name) : null, {
    refreshInterval: computing ? GROUP_STATS_COMPUTING_POLL_MS : GROUP_STATS_POLL_MS,
  })
  const detail = useMemo(() => readGroupDetail(read.body), [read.body])
  if ((detail.state === 'computing') !== computing) setComputing(detail.state === 'computing')
  if (!asks) {
    return (
      <p className={styles.muted} data-testid="terminal-grp-stats-theme">
        The weekly rank, fundamentals and breadth are worked out for sectors and industries, not for UCT themes. GRPS lists
        every sector and industry with them.
      </p>
    )
  }
  const kindWords = GROUP_STATS_KINDS[kind]
  if (read.loading) {
    return <p className={styles.muted} role="status" data-testid="terminal-grp-stats-loading">Loading the fundamentals and breadth of {name}.</p>
  }
  if (!read.body) {
    return (
      <p className={styles.note} role="status" data-testid="terminal-grp-stats-error">
        {failureText(read.error, WHAT)} The stocks below are not affected.{' '}
        {canRetry(read.error) ? <button type="button" className={styles.linkBtn} onClick={read.retry}>Retry</button> : null}
      </p>
    )
  }
  if (detail.state === 'not_built') {
    return (
      <p className={styles.muted} role="status" data-testid="terminal-grp-stats-not-built">
        Fundamentals and breadth are worked out once each evening after the close, and the first evening build has not run on
        this server yet.
      </p>
    )
  }
  if (detail.state === 'computing') {
    return (
      <p className={styles.muted} role="status" data-testid="terminal-grp-stats-computing">
        The server is working out every group&apos;s fundamentals and breadth for the first time. This panel asks again every
        minute.
      </p>
    )
  }
  if (detail.state === 'not_found') {
    return (
      <p className={styles.muted} role="status" data-testid="terminal-grp-stats-not-found">
        {name} was not in the last evening build of {kindWords.many}, so it has no rank, fundamentals or breadth yet.
      </p>
    )
  }
  if (detail.state !== 'ok') {
    return (
      <p className={styles.note} role="status" data-testid="terminal-grp-stats-error">
        {WHAT} came back in a form this panel cannot read. The stocks below are not affected.{' '}
        <button type="button" className={styles.linkBtn} onClick={read.retry}>Retry</button>
      </p>
    )
  }
  const when = builtWords(detail)
  return (
    <div className={local.sections} data-testid="terminal-grp-stats">
      <RankSection detail={detail} kindWords={kindWords} />
      <FundSection detail={detail} kindWords={kindWords} />
      <BreadthSection detail={detail} kindWords={kindWords} />
      {when ? (
        <p className={styles.muted} data-testid="terminal-grp-stats-when">
          Fundamentals and breadth worked out {when}{detail.refreshing ? '; the evening build is running and these are the last figures' : ''}.
          {detail.lagging.includes('prices') ? ' The stored closes stopped short of the evening, so breadth is at the last session most stocks have.' : ''}
        </p>
      ) : null}
    </div>
  )
}
