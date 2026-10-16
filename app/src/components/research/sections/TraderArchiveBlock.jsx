// app/src/components/research/sections/TraderArchiveBlock.jsx
//
// "What the traders said" — the TSDR trader archive's posts and scored calls on this
// ticker, inside the research modal's Catalysts tab (owner ruling 2026-10-15: paid members
// and every in-app tool). Reads GET /api/wisdom/archive/ticker/{sym}.
//
// ⛔ RENDERS NOTHING unless there is something to show: the endpoint answers 404 while
// WISDOM_ARCHIVE_ENABLED is off and 402 without a paid plan, and the block must not turn
// either into an empty-looking panel on a tab that already has its own content. Loading,
// error and an empty archive render nothing too.
import useSWR from 'swr'

import { sectionFetcher } from './sectionFetch'
import { ARCHIVE_API, clip, dayOf, fmtR, rTone, traderOf } from '../../../utils/traderArchive'
import styles from './TraderArchiveBlock.module.css'

const MAX_POSTS = 4
const MAX_CALLS = 5

// A failure is a state this block hides, not one it reports. The fetcher THROWS (TERM-033:
// never swallow a failure into a value) and the render below treats an error like "nothing to
// show"; shouldRetryOnError:false keeps SWR from re-asking a 404 on every focus.

export default function TraderArchiveBlock({ sym }) {
  const s = (sym || '').toUpperCase().trim()
  const { data, error } = useSWR(s ? `${ARCHIVE_API}/ticker/${encodeURIComponent(s)}?limit=500` : null, sectionFetcher,
    { revalidateOnFocus: false, shouldRetryOnError: false })
  if (!s || error || !data) return null
  const records = Array.isArray(data.records) ? data.records : []
  const calls = Array.isArray(data.calls) ? data.calls : []
  if (records.length === 0 && calls.length === 0) return null

  const posts = [...records].sort((a, b) => String(b.stated_date).localeCompare(String(a.stated_date))).slice(0, MAX_POSTS)
  const recentCalls = [...calls].sort((a, b) => String(b.posted || '').localeCompare(String(a.posted || ''))).slice(0, MAX_CALLS)
  const nScored = data.n_scored ?? null

  return (
    <section className={styles.wrap} data-testid="trader-archive-block" aria-labelledby="trader-archive-h">
      <h3 id="trader-archive-h" className={styles.heading}>What the traders said</h3>
      <p className={styles.summary} data-testid="trader-archive-summary">
        {records.length} {records.length === 1 ? 'post' : 'posts'} · {calls.length} {calls.length === 1 ? 'call' : 'calls'}
        {nScored ? ` · ${nScored} scored, mean r20 ${fmtR(data.mean_r20)}` : ''}
      </p>

      {posts.length > 0 && (
        <ul className={styles.list}>
          {posts.map((r) => (
            <li key={r.record_id} className={styles.item}>
              <div className={styles.meta}>
                <span className={styles.trader}>{traderOf(r)}</span>
                <span className={styles.date}>{dayOf(r.stated_date)}</span>
                <span className={styles.kind}>{r.record_type}</span>
              </div>
              {r.note && <p className={styles.note}>{clip(r.note, 240)}</p>}
            </li>
          ))}
        </ul>
      )}

      {recentCalls.length > 0 && (
        <table className={styles.calls} data-testid="trader-archive-calls" aria-label="Recent scored calls">
          <thead>
            <tr><th scope="col">Posted</th><th scope="col">Trader</th><th scope="col">Dir</th><th scope="col">Setup</th><th scope="col">R20</th></tr>
          </thead>
          <tbody>
            {recentCalls.map((c) => {
              const r20 = c.outcome?.r20
              const tone = rTone(r20)
              return (
                <tr key={c.call_id}>
                  <td>{dayOf(c.posted)}</td>
                  <td>{traderOf(c)}</td>
                  <td>{c.direction || '—'}</td>
                  <td>{c.setup || '—'}</td>
                  <td className={tone === 'up' ? styles.up : tone === 'down' ? styles.down : undefined}>{fmtR(r20)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      <p className={styles.footer}>
        Historical posts by the UCT team; outcomes are measured after the fact and are not advice.{' '}
        <a className={styles.link} href={`/trader-archive?sym=${encodeURIComponent(s)}`}>Open the trader archive</a>
      </p>
    </section>
  )
}
