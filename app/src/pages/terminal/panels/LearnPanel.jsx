// LEARN: the teaching UCT already has about one stock, in one place. `NVDA LEARN` (data wave 2).
//
// ⭐ NO NEW ROUTE. Three reads the app already serves: the Desk articles that covered the stock
// (`/api/desk/articles/for-ticker/{sym}`), the Desk video moments that mention it
// (`/api/education/tickers/{sym}/mentions`, each with its time in the video) and the Model Book
// years it is in (`/api/modelbook/appearances/{symbol}`). The pure half (the URLs, the row
// shaping, the link targets) is learnModel.js, re-exported below.
//
// Three short sections, each a list of links that open the lesson where it lives: an article in
// the Desk reader, a video at that moment, the Model Book.
//
// ⛔ THE THREE READS FAIL APART. One failing never blanks the others: its section says it could
// not be read, with Retry, and the other two are listed. "Nothing on record for this stock" is an
// honest answer and is worded as one; a failed read never is.
// ⛔ NO TRADER ARCHIVE. What the trading team said is not shown to members (owner ruling
// 2026-10-17). The video moments read can carry such rows; learnModel.js `isDeskVideoMoment`
// drops every one of them before anything is drawn or counted.
//
// Lessons change when an article or a video is published, so nothing here polls.
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  PanelCommand, PanelSkeleton, PanelState, panelAsOf, useInTerminalPanel, usePanelFreshness,
} from '../../../components/terminal'
import { formatNumber, formatPercent, formatTimeEt } from '../../../lib/presentation/presentationPrimitives'
import { canRetry, failureKind, failureText, useMarketRead } from './marketRead'
import {
  LEARN_CODE, articleSearchHref, articlesRead, deskArticlesUrl, deskMomentsUrl, lessonsSentence, modelBookRead, modelBookUrl,
  momentsRead,
} from './learnModel'
import styles from './marketPanels.module.css'

export {
  ARTICLES_LIMIT, LEARN_CODE, MODEL_BOOK_HREF, articleHref, articleSearchHref, articlesRead, deskArticlesUrl, deskMomentsUrl,
  isDeskVideoMoment, learnCommand, learnCommandArgs, lessonsSentence, modelBookRead, modelBookUrl, momentHref, momentsRead,
} from './learnModel'

/** Video moments drawn until the member asks for all of them; the rest are counted, never dropped. */
export const MOMENTS_SHOWN = 12
const SOURCE = 'The Desk and the Model Book (UCT lessons)'
const count = (n) => formatNumber(n, { decimals: 0 })
const tone = (v) => (v > 0 ? styles.up : v < 0 ? styles.down : undefined)

/** One read's outcome: 'loading' | 'http' (the request itself failed) | the model's own state. */
const outcomeOf = (q, parsed) => (!q.body && !q.error ? 'loading' : q.error && !q.body ? 'http' : parsed.state)

/**
 * One section: its heading, then what its read says. `what` names the read in a failure sentence
 * ("The Desk articles"); `none` is the honest "nothing on record" sentence.
 */
function Section({ id, heading, label, what, q, state, n, none, children }) {
  return (
    <section aria-label={label} data-testid={`terminal-learn-${id}`} data-state={state}>
      <h3 className={styles.muted}>{heading}{state === 'ok' ? ` (${count(n)})` : ''}</h3>
      {state === 'loading' ? (
        <p className={styles.lede} role="status" data-testid={`terminal-learn-${id}-loading`}>Reading {what.replace(/^The /, 'the ')}.</p>
      ) : state !== 'ok' ? (
        <p className={styles.note} role="status" data-testid={`terminal-learn-${id}-error`}>
          {state === 'http' ? failureText(q.error, what) : `${what} could not be read just now.`} That is not the same as none on
          record.{' '}
          {state === 'http' && !canRetry(q.error) ? null : (
            <button type="button" className={styles.linkBtn} onClick={() => q.retry()}>Retry {what.replace(/^The /, 'the ')}</button>
          )}
        </p>
      ) : n === 0 ? (
        <p className={styles.muted} data-testid={`terminal-learn-${id}-none`}>{none}</p>
      ) : children}
      {state === 'ok' && q.error ? (
        <p className={styles.note} role="status" data-testid={`terminal-learn-${id}-stale`}>{failureText(q.error, what)} Showing the last read.</p>
      ) : null}
    </section>
  )
}

function LearnBody({ sym: s, code }) {
  const inPanel = useInTerminalPanel()
  const artQ = useMarketRead(deskArticlesUrl(s))
  const vidQ = useMarketRead(deskMomentsUrl(s))
  const mbQ = useMarketRead(modelBookUrl(s))
  const art = useMemo(() => articlesRead(artQ.body), [artQ.body])
  const vid = useMemo(() => momentsRead(vidQ.body), [vidQ.body])
  const mb = useMemo(() => modelBookRead(mbQ.body), [mbQ.body])
  const artState = outcomeOf(artQ, art)
  const vidState = outcomeOf(vidQ, vid)
  const mbState = outcomeOf(mbQ, mb)
  const [allMoments, setAllMoments] = useState(false)

  const reads = [{ q: artQ, state: artState }, { q: vidQ, state: vidState }, { q: mbQ, state: mbState }]
  const answered = reads.filter((r) => r.state === 'ok')
  // As of: when the OLDEST of the answers on screen was read (a lesson list has no market time).
  const readAt = answered.map((r) => r.q.receivedAt).filter(Boolean).sort()[0] || null
  usePanelFreshness(answered.length ? panelAsOf(SOURCE, readAt) : null)

  if (reads.every((r) => r.state === 'loading')) {
    return <PanelSkeleton label={`Finding the lessons on ${s}`} testId="terminal-learn-loading" />
  }
  const settled = reads.every((r) => r.state !== 'loading')
  if (settled && !answered.length) {
    const http = reads.filter((r) => r.state === 'http')
    const locked = http.length === reads.length && http.every((r) => !canRetry(r.q.error))
    return (
      <PanelState kind={locked ? failureKind(http[0].q.error) : 'error'} testId="terminal-learn-error"
        title={locked ? failureText(http[0].q.error, 'Lessons') : `The lessons on ${s} could not be read just now.`}
        action={locked ? null : <button type="button" className={styles.chip} onClick={() => reads.forEach((r) => r.q.retry())}>Retry</button>}>
        {locked ? null : `That is not the same as none on record. Retry, or run ${s} ${code} again.`}
      </PanelState>
    )
  }

  const nothing = settled && answered.length === reads.length && !art.rows.length && !vid.rows.length && !mb.rows.length
  const moments = allMoments ? vid.rows : vid.rows.slice(0, MOMENTS_SHOWN)

  return (
    <div className={`${styles.wrap} ${inPanel ? styles.inPanel : ''}`} data-testid="terminal-learn">
      {nothing ? (
        <PanelState kind="empty" role="status" testId="terminal-learn-empty" title={`No lessons on record for ${s} yet.`}>
          No Desk article covers it, no Desk video mentions it and it is in no Model Book year. All three were read, so
          this is what is on record, not a failed read.
        </PanelState>
      ) : (
        <>
          <p className={styles.lede} data-testid="terminal-learn-summary">
            {lessonsSentence(s, {
              articles: artState === 'ok' ? art.total : null,
              moments: vidState === 'ok' ? vid.rows.length : null,
              modelBook: mbState === 'ok' ? mb.rows.length : null,
            })}
          </p>

          <Section id="articles" heading="Desk articles" label={`Desk articles that cover ${s}`} what="The Desk articles" q={artQ}
            state={artState} n={art.total} none={`No Desk article covers ${s}.`}>
            <ul className={styles.newsList} data-testid="terminal-learn-articles-list">
              {art.rows.map((r) => (
                <li key={r.key} className={styles.newsItem}>
                  <Link className={styles.newsHeadline} to={r.href}>{r.title}</Link>
                  <span className={styles.newsMeta}>
                    {r.date ? <span>{r.date}</span> : null}
                    {r.publication ? <span>{r.publication}</span> : null}
                    {r.minutes ? <span>{count(r.minutes)} min read</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {art.total > art.rows.length ? (
              <p className={styles.muted} data-testid="terminal-learn-articles-more">
                Showing the newest {count(art.rows.length)} of {count(art.total)}.{' '}
                <Link className={styles.linkBtn} to={articleSearchHref(s)}>Search the Desk articles for {s}</Link>
              </p>
            ) : null}
          </Section>

          <Section id="moments" heading="Desk video moments" label={`Desk video moments that mention ${s}`} what="The Desk video moments" q={vidQ}
            state={vidState} n={vid.rows.length} none={`No Desk video mentions ${s}.`}>
            <ul className={styles.newsList} data-testid="terminal-learn-moments-list">
              {moments.map((r) => (
                <li key={r.key} className={styles.newsItem}>
                  <Link className={styles.newsHeadline} to={r.href} title={`Open the video at ${r.at}`}>{r.title}, at {r.at}</Link>
                  <span className={styles.newsMeta}>
                    {r.date ? <span>{r.date}</span> : null}
                    {r.note ? <span>{r.note}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            {vid.rows.length > MOMENTS_SHOWN ? (
              <div className={styles.toolbar}>
                <button type="button" className={styles.chip} aria-pressed={allMoments} onClick={() => setAllMoments((v) => !v)}
                  data-testid="terminal-learn-moments-all">
                  {allMoments ? `Show the newest ${MOMENTS_SHOWN}` : `Show all ${count(vid.rows.length)} moments`}
                </button>
              </div>
            ) : null}
          </Section>

          <Section id="modelbook" heading="Model Book" label={`Model Book years ${s} is in`} what="The Model Book" q={mbQ}
            state={mbState} n={mb.rows.length} none={`${s} is in no Model Book year. The Model Book is UCT's library of each year's best-performing stocks.`}>
            <ul className={styles.newsList} data-testid="terminal-learn-modelbook-list">
              {mb.rows.map((r) => (
                <li key={r.key} className={styles.newsItem}>
                  <Link className={styles.newsHeadline} to={r.href}>{r.year} Model Book</Link>
                  <span className={styles.newsMeta}>
                    {r.gainPct !== null ? (
                      <span className={tone(r.gainPct)}>{formatPercent(r.gainPct, { decimals: 1, signed: true })} that year</span>
                    ) : null}
                    {r.setupCount ? <span>{count(r.setupCount)} {r.setupCount === 1 ? 'setup' : 'setups'} marked</span> : null}
                  </span>
                </li>
              ))}
            </ul>
            <p className={styles.muted} data-testid="terminal-learn-modelbook-links">
              The Model Book opens on its newest year; pick the year there. In the terminal:{' '}
              <PanelCommand cmd={`${s} MB`} label={`Model Book entries for ${s}`}>Model Book for {s} (MB)</PanelCommand>
            </p>
          </Section>
        </>
      )}

      <p className={styles.muted} data-testid="terminal-learn-method">
        Desk articles are the issues that charted {s}, newest first. Desk video moments are the points in a Desk video
        where {s} is discussed; each link opens the video at that time. Model Book years are the years {s} is in UCT&apos;s
        library of the best-performing stocks. A sign (+/-) marks every gain, so color is never the only signal. Each
        link opens the lesson on its own page, outside the terminal.
        {readAt ? ` Read at ${formatTimeEt(readAt, { zoneSuffix: 'ET', absent: '' })}.` : ''}
      </p>
    </div>
  )
}

export default function LearnPanel({ sym }) {
  const s = String(sym || '').trim().toUpperCase()
  const code = useInTerminalPanel()?.code || LEARN_CODE
  if (!s) {
    return (
      <PanelState kind="input" title={`${code} needs a ticker.`}>
        Type one first, e.g. <kbd>NVDA {code}</kbd>
      </PanelState>
    )
  }
  // Keyed by ticker: a new ticker is three new reads, so one stock's lessons are never drawn under another's name.
  return <LearnBody key={s} sym={s} code={code} />
}
