/**
 * P2 Tier 3, Task 8 — "Your <year> in trading" (`/journal-2-0/wrapped/:year`).
 *
 * Four sections, every number the server's (`GET /api/j2/wrapped/{year}`,
 * api/services/journal_two/wrapped.py): best setups (playbook_stats' own expectancy R, each row's n
 * is `sampleN`, the count the band describes, and its trades are `tradeCount` in their own column),
 * most-written tickers (member-wide: `tickersScope: "all"`, so the section says so), a twelve-month
 * discipline list (a month with no adherence record reads "—", never 0) and the rule changes of the
 * year. Sample wording is `sampleSize.js`'s, through `wordStat`; nothing here restates a word or a
 * threshold. Ticker chips open the Notebook's own ticker filter (`notebookTickerHref`).
 *
 * The account is the Journal's own pick (`useJ2SelectedAccount`), as My Playbook reads it.
 *
 * Dark behind `journal_tier3_enabled` (the My Playbook precedent): with the switch off nothing is
 * fetched and the route sends the member back to the Report page, where the door lives.
 *
 * ⛔ LAZY ONLY: App.jsx reaches this through its own lazy route, so the Notebook's first open pays
 * nothing for it. No emoji: UIcon only.
 */
import { Link, Navigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import TileCard from '../../../components/TileCard'
import UIcon from '../../../components/ui/UIcon'
import useJ2SelectedAccount from '../hooks/useJ2SelectedAccount'
import { tier3Enabled } from '../lib/tier3Flag'
import { wordStat } from '../lib/sampleSize'
import { fmtPct, fmtR } from '../lib/playbookFormat'
import { notebookTickerHref } from '../lib/notebookTickerLink'
import { currentYearOpen } from '../lib/wrappedLink'
import { RouteLanding } from '../lib/routeFocus'
import styles from './WrappedSurface.module.css'

const BASE = '/api/j2/wrapped'
const NOTHING = 'Nothing here yet.'
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
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Tickers({ rows, scope }) {
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
                    aria-label={`${t.symbol}, ${plural(t.noteCount, 'note', 'notes')}, open in the Notebook`}>
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
  return (
    <ol className={styles.months} data-testid="wrapped-discipline">
      {rows.map((d) => {
        const pct = fmtPct(d.adherence)
        const width = typeof d.adherence === 'number' ? `${Math.max(0, Math.min(1, d.adherence)) * 100}%` : '0%'
        return (
          <li key={d.month} className={styles.month} data-month={d.month}>
            <span className={styles.monthName}>{monthName(d.month)}</span>
            <span className={styles.bar} aria-hidden="true"><span className={styles.fill} style={{ width }} /></span>
            <span className={styles.pct}>{pct}</span>
            <span className={styles.trades}>{plural(d.tradeCount, 'trade', 'trades')}</span>
          </li>
        )
      })}
    </ol>
  )
}

function Lessons({ rows }) {
  if (!rows.length) return <p className={styles.nothing}>{NOTHING}</p>
  return (
    <ul className={styles.lessons} data-testid="wrapped-lessons">
      {rows.map((l) => (
        <li key={`${l.ruleId}:${l.version}`} className={styles.lesson}>
          <span className={styles.lessonLabel}>{l.label}</span>
          <span className={styles.lessonMeta}>Version {l.version} · {String(l.changedAt || '').slice(0, 10)}</span>
          {l.changeNote ? <span className={styles.lessonNote}>{l.changeNote}</span> : null}
        </li>
      ))}
    </ul>
  )
}

export default function WrappedSurface({ now }) {
  const on = tier3Enabled()
  const { year: yearParam } = useParams()
  const year = String(yearParam || '')
  const { accountId, isLoading: accountsLoading } = useJ2SelectedAccount(on)
  const url = on && !accountsLoading
    ? `${BASE}/${encodeURIComponent(year)}${accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''}`
    : null
  const { data, error, mutate } = useSWR(url, getJson, { revalidateOnFocus: false, shouldRetryOnError: false })

  if (!on) return <Navigate to="/journal-2-0/report" replace />

  const title = `Your ${year} in trading`
  const cur = currentYearOpen(now)
  let body
  if (error) {
    body = error.status === 400 && error.detail ? (
      <p className={styles.sentence} role="alert">{error.detail}</p>
    ) : (
      <p className={styles.sentence} role="alert">
        Couldn’t load your trading year.{' '}
        <button type="button" className={styles.linkBtn} onClick={() => mutate()}>Try again</button>
      </p>
    )
  } else if (!data) {
    body = <p className={styles.sentence} data-testid="wrapped-loading">Reading your year…</p>
  } else if (!data.available && Number(year) === cur.year && !cur.open) {
    body = <p className={styles.sentence}>{`Your ${year} trading year opens on December 1.`}</p>
  } else if (!data.available) {
    body = <p className={styles.sentence}>{`No closed trades in ${year}.`}</p>
  } else {
    body = (
      <>
        <RouteLanding title={`${title}, four sections`} />
        <TileCard title="Best setups" icon="star" className={styles.tile}>
          <BestSetups rows={data.bestSetups || []} />
        </TileCard>
        <TileCard title="Most-written tickers" icon="tag" className={styles.tile}>
          <Tickers rows={data.tickers || []} scope={data.tickersScope} />
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
        {data?.available ? (
          <p className={styles.meta}>{plural(data.tradeCount, 'closed trade', 'closed trades')}</p>
        ) : null}
      </header>
      {body}
    </section>
  )
}
