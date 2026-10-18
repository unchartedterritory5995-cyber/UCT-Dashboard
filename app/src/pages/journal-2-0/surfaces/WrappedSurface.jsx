/**
 * P2 Tier 3, Task 8 — "Your <year> in trading" (`/journal-2-0/wrapped/:year`).
 *
 * Four sections, every number the server's (`GET /api/j2/wrapped/{year}`,
 * api/services/journal_two/wrapped.py): best setups (playbook_stats' own expectancy R, each row's n
 * is `sampleN`, the count the band describes, and its trades are `tradeCount` in their own column),
 * most-written tickers (member-wide: `tickersScope: "all"`, so the section says so), a twelve-month
 * discipline list (a month with no adherence record reads "—", never 0; each month's n is its
 * adherence RECORDS, `sampleN`, and never its trades: final fix I2) and the rule changes of the
 * year. Sample wording is `sampleSize.js`'s, through `wordStat`; nothing here restates a word or a
 * threshold. Ticker chips open the Notebook's own ticker filter (`notebookTickerHref`).
 *
 * THE ACCOUNT IS THE ONE THE PAGE WAS OPENED FOR (ruling R-T3-T8-R2): a `?account_id=` on the URL
 * (the Report page door always writes one, `_all_` for All Accounts) wins; with none, the Journal's
 * own pick (`useJ2SelectedAccount`), as My Playbook reads it. The header names the scope.
 *
 * "Not ready" and "no closed trades" are told apart by the PAYLOAD's `unavailableReason` (ruling
 * R-T3-T8-R3: `not_ready` for the current ET year before December 1, trades or not; else
 * `no_trades`), never by this device's clock.
 *
 * Dark behind `journal_tier3_enabled` (the My Playbook precedent): with the switch off nothing is
 * fetched and the route sends the member to the Journal (a bare Report page link loses its query).
 *
 * ⛔ LAZY ONLY: App.jsx reaches this through its own lazy route, so the Notebook's first open pays
 * nothing for it. No emoji: UIcon only.
 */
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../../../components/TileCard'
import UIcon from '../../../components/ui/UIcon'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import { tier3Enabled } from '../lib/tier3Flag'
import { wordStat } from '../lib/sampleSize'
import { fmtPct, fmtR } from '../lib/playbookFormat'
import { notebookTickerHref } from '../lib/notebookTickerLink'
import { YEAR_UNAVAILABLE, accountFromParam } from '../lib/wrappedLink'
import { RouteLanding } from '../lib/routeFocus'
import styles from './WrappedSurface.module.css'

const BASE = '/api/j2/wrapped'
const NOTHING = 'Nothing here yet.'
// The plan's own sentences (R-T3-9; Review Focus 6), verbatim.
const TOO_FEW_TO_RANK = 'Too few trades to rank'
const NO_ADHERENCE = 'No adherence recorded this year.'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September',
  'October', 'November', 'December']

async function getJson(url) {
  const res = await fetch(url, { credentials: 'include' })
  if (!res.ok) {
    const err = new Error(`Your trading year request failed (${res.status})`)
    err.status = res.status
    try {
      const body = await res.json()
      if (typeof body?.detail === 'string') err.detail = body.detail
    } catch { /* no body */ }
    throw err
  }
  return res.json()
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

function monthName(month) {
  const m = Number(String(month || '').slice(5, 7))
  return MONTHS[m - 1] || String(month || '')
}

function BestSetups({ rows }) {
  if (!rows.length) return <p className={styles.nothing}>{NOTHING}</p>
  return (
    <table className={styles.table} data-testid="wrapped-setups">
      <thead>
        <tr>
          <th scope="col">Setup</th>
          <th scope="col" className={styles.num}>Trades</th>
          <th scope="col" className={styles.num}>Expectancy</th>
          <th scope="col">Sample</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const word = wordStat({ band: r.sample, n: r.sampleN })
          const value = fmtR(r.expectancyR)
          return (
            <tr key={r.setup} data-setup={r.setup}>
              <th scope="row" className={styles.setup}>{r.setup}</th>
              <td className={styles.num}>{r.tradeCount}</td>
              <td className={styles.num}>
                {word.hidden ? (
                  <details className={styles.reveal}>
                    <summary className={styles.summary}>{word.label}</summary>
                    <span>{value}</span>
                  </details>
                ) : value}
              </td>
              <td className={styles.sample}>
                <span className={styles.n} data-n={r.sampleN}>n={r.sampleN}</span>
                {word.label && !word.hidden ? <span className={styles.word}> {word.label}</span> : null}
                {r.sample === 'too_few' ? <span className={styles.unranked}> {TOO_FEW_TO_RANK}</span> : null}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** The count is the year's; the Notebook it opens holds every note on the ticker, so the name says both. */
const chipName = (t, year) =>
  `${t.symbol}, ${plural(t.noteCount, 'note', 'notes')} in ${year}. Opens all your notes on ${t.symbol}`

function Tickers({ rows, scope, year }) {
  return (
    <>
      {scope === 'all' ? (
        <p className={styles.scope} data-testid="wrapped-tickers-scope">
          These counts cover all your notes, not just this account.
        </p>
      ) : null}
      {rows.length ? (
        <ul className={styles.chips} data-testid="wrapped-tickers">
          {rows.map((t) => (
            <li key={t.symbol}>
              <Link className={styles.chip} to={notebookTickerHref(t.symbol)}
                    aria-label={chipName(t, year)} title={chipName(t, year)}>
                <span className={styles.chipSym}>{t.symbol}</span>
                <span className={styles.chipCount}>{t.noteCount}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className={styles.nothing}>{NOTHING}</p>}
    </>
  )
}

function Discipline({ rows }) {
  if (!rows.length) return <p className={styles.nothing}>{NOTHING}</p>
  // Review Focus 6: a year with no adherence record says so ABOVE the twelve rows, which still each
  // read "—" with their record count.
  const none = rows.every((d) => typeof d.adherence !== 'number')
  return (
    <>
      {none ? <p className={styles.nothing} data-testid="wrapped-no-adherence">{NO_ADHERENCE}</p> : null}
      <ol className={styles.months} data-testid="wrapped-discipline">
      {rows.map((d) => {
        // Final fix I2: the mean rests on the month's adherence RECORDS (`sampleN`), so the n printed is
        // theirs and the words are their band's (`sample`, through wordStat); a trade count is never
        // printed here. Too few: the percent is behind the reveal and the bar is drawn empty, as a
        // too-few setup's expectancy is hidden above.
        const has = typeof d.adherence === 'number'
        const word = wordStat({ band: d.sample, n: d.sampleN })
        const hidden = has && word.hidden
        const pct = fmtPct(d.adherence)
        const width = has && !hidden ? `${Math.max(0, Math.min(1, d.adherence)) * 100}%` : '0%'
        return (
          <li key={d.month} className={styles.month} data-month={d.month}>
            <span className={styles.monthName}>{monthName(d.month)}</span>
            <span className={styles.bar} aria-hidden="true"><span className={styles.fill} style={{ width }} /></span>
            <span className={styles.pct}>
              {hidden ? (
                <details className={styles.reveal}>
                  <summary className={styles.summary}>{word.label}</summary>
                  <span>{pct}</span>
                </details>
              ) : pct}
            </span>
            <span className={styles.records}>
              <span data-n={d.sampleN}>{plural(d.sampleN ?? 0, 'record', 'records')}</span>
              {has && word.label && !hidden ? <span className={styles.word}> {word.label}</span> : null}
            </span>
          </li>
        )
      })}
      </ol>
    </>
  )
}

function Lessons({ rows }) {
  if (!rows.length) return <p className={styles.nothing}>{NOTHING}</p>
  return (
    <ul className={styles.lessons} data-testid="wrapped-lessons">
      {rows.map((l) => (
        <li key={`${l.ruleId}:${l.version}`} className={styles.lesson}>
          <span className={styles.lessonLabel}>{l.label}</span>
          <span className={styles.lessonMeta}>Version {l.version} · {l.changedDay || '—'}</span>
          {l.changeNote ? <span className={styles.lessonNote}>{l.changeNote}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export default function WrappedSurface() {
  const on = tier3Enabled()
  const { year: yearParam } = useParams()
  const [search] = useSearchParams()
  const year = String(yearParam || '')
  const validYear = /^\d{4}$/.test(year)
  const fromUrl = accountFromParam(search.get('account_id'))      // undefined = the URL names none
  const { accountId: picked, accounts, isLoading: accountsLoading } = useJ2SelectedAccount(on)
  const accountId = fromUrl === undefined ? picked : fromUrl
  const ready = fromUrl !== undefined || !accountsLoading
  const url = on && validYear && ready
    ? `${BASE}/${year}${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`
    : null
  const { data, error, mutate } = useSWR(url, getJson, { revalidateOnFocus: false, shouldRetryOnError: false })

  if (!on) return <Navigate to="/journal" replace />

  const title = `Your ${year} in trading`
  const accountName = accountId ? accounts.find((a) => a.id === accountId)?.name ?? '—' : 'All Accounts'
  // A year the route refuses (or that is not a year at all) gets the server's plain sentence and no
  // retry: asking again cannot change the answer.
  const refused = !validYear || error?.status === 400 || error?.status === 422
  // The landing names the page in every state (focus on arrival reads the title, not the shell's).
  let landing = title
  let body
  if (refused) {
    body = <p className={styles.sentence} role="alert">{YEAR_UNAVAILABLE}</p>
  } else if (error) {
    body = (
      <p className={styles.sentence} role="alert">
        Couldn’t load your trading year.{' '}
        <button type="button" className={styles.linkBtn} onClick={() => mutate()}>Try again</button>
      </p>
    )
  } else if (!data) {
    body = <p className={styles.sentence} data-testid="wrapped-loading">Reading your year…</p>
  } else if (!data.available && data.unavailableReason === 'not_ready') {
    body = <p className={styles.sentence}>{`Your ${year} trading year opens on December 1.`}</p>
  } else if (!data.available) {
    body = <p className={styles.sentence}>{`No closed trades in ${year}.`}</p>
  } else {
    landing = `${title}, four sections`
    body = (
      <>
        <TileCard title="Best setups" icon="star" className={styles.tile}>
          <BestSetups rows={data.bestSetups || []} />
        </TileCard>
        <TileCard title="Most-written tickers" icon="tag" className={styles.tile}>
          <Tickers rows={data.tickers || []} scope={data.tickersScope} year={year} />
        </TileCard>
        <TileCard title="Discipline trend" icon="check" className={styles.tile}>
          <Discipline rows={data.discipline || []} />
        </TileCard>
        <TileCard title="Lessons you wrote into your rules" icon="book" className={styles.tile}>
          <Lessons rows={data.lessons || []} />
        </TileCard>
      </>
    )
  }

  return (
    // A section, not <main>: the app shell already is the page's one main landmark (M-11).
    <section className={styles.page} aria-labelledby="wrapped-title" data-testid="wrapped-page">
      <Link className={styles.back} to="/journal">Back to the Journal</Link>
      <header className={styles.header}>
        <h1 id="wrapped-title" className={styles.title}>
          <UIcon name="calendar" size={18} className={styles.titleIcon} />
          {title}
        </h1>
        {!refused ? (
          <p className={styles.meta} data-testid="wrapped-scope">
            {accountName}
            {data?.available ? ` · ${plural(data.tradeCount, 'closed trade', 'closed trades')}` : null}
          </p>
        ) : null}
      </header>
      <RouteLanding title={landing} />
      {body}
    </section>
  )
}
