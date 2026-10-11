import { useState } from 'react'
import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'
import { memberSentence } from '../../../lib/presentation/memberCopy'

// FT-080 polarity — owner ruling 2026-10-11 ("store text but allow sorting, one week, one month
// etc."). A bull/bear split of the posts the room-attention series counts (#main-chat, plus the
// curated X feed), over a member-chosen window, and the posts themselves, sortable.
// Rendered by MentionSeriesPanel only when its payload says `polarity.state === 'available'`
// (SOCIAL_POLARITY_ENABLED on the server); the route 404s otherwise.
//
// ⛔ Every label is AUTO-LABELLED by a word-and-emoji rule, and the panel says so beside the split.
// ⛔ A day before the first labelled post (or past retention) is "—", never 0.
// ⛔ An X post past the X feed's own window keeps its label but not its text; the row says why.

export const WINDOWS = [['1w', '1W'], ['1m', '1M'], ['3m', '3M']]
const WINDOW_WORDS = { '1w': 'week', '1m': 'month', '3m': 'three months' }
export const SORTS = [['newest', 'Newest first'], ['oldest', 'Oldest first'],
  ['most_bullish', 'Most bullish first'], ['most_bearish', 'Most bearish first']]
const LABELS = [['all', 'All posts'], ['bullish', 'Bullish only'], ['bearish', 'Bearish only'], ['neutral', 'Neutral only']]
const LABEL_WORD = { bullish: 'Bullish', bearish: 'Bearish', neutral: 'Neutral' }

const dash = (v) => (v == null ? '—' : String(v))

// Only an https link becomes an href (the server already drops anything else).
const safeLink = (u) => (typeof u === 'string' && u.startsWith('https://') ? u : null)
const methodText = (m) => String(m || '').replace(/^auto-labelled by\s+/i, '').replace(/\.\s*$/, '')

function sourceText(p) {
  if (p.source === 'room') return '#main-chat'
  return p.author ? `X @${p.author}` : 'X'
}

export default function SocialPolarity({ sym, polarity }) {
  const [win, setWin] = useState('1m')
  const [sort, setSort] = useState('newest')
  const [label, setLabel] = useState('all')
  const s = (sym || '').toUpperCase().trim()
  const route = polarity?.route || (s ? `/api/research/mention-series/${encodeURIComponent(s)}/polarity` : null)
  const url = route ? `${route}?window=${win}&sort=${sort}&label=${label}&limit=50` : null
  const { data, error, mutate } = useSWR(url, depthFetcher, { revalidateOnFocus: false, keepPreviousData: true })
  // keepPreviousData holds the last window on screen while the new one loads, so say so.
  const stale = Boolean(data && data.state === 'ok' && data.window_key && data.window_key !== win)

  let body
  if (error) body = <div className={styles.error} data-testid="polarity-unavailable">The bullish/bearish split is unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button></div>
  else if (!data) body = <div className={styles.note}>Loading the bullish/bearish split</div>
  else if (data.paywalled) body = <div className={styles.note}>The bullish/bearish split requires a paid plan.</div>
  else if (data.state !== 'ok') body = <div className={styles.note} data-testid="polarity-state">{memberSentence(data.reason) || `No labelled posts for ${s} yet.`}</div>
  else {
    const t = data.totals || {}
    const directional = (t.bullish || 0) + (t.bearish || 0)
    const bullW = directional ? Math.round((100 * t.bullish) / directional) : 0
    const covered = data.window?.covered_from
    const partial = covered && data.window?.from && covered > data.window.from
    const days = [...(data.days || [])].reverse().filter((d) => d.state !== 'ok' || d.bullish + d.bearish + d.neutral > 0).slice(0, 14)
    const posts = data.posts || []
    body = (
      <>
        <p className={styles.lede} data-testid="polarity-summary">
          {t.posts
            ? <>Last {WINDOW_WORDS[data.window_key] || data.window_key}: {t.bullish} bullish, {t.bearish} bearish, {t.neutral} neutral of {t.posts} posts{t.bull_share_pct != null ? <> ({t.bull_share_pct}% of the directional ones bullish)</> : null}.</>
            : <>No labelled posts named {s} in the last {WINDOW_WORDS[data.window_key] || data.window_key}.</>}
        </p>
        {directional > 0 && (
          <div className={styles.polaritySplit} role="img" aria-label={`${t.bullish} bullish, ${t.bearish} bearish`} data-testid="polarity-split">
            <span className={styles.polarityBull} style={{ width: `${bullW}%` }} />
            <span className={styles.polarityBear} style={{ width: `${100 - bullW}%` }} />
          </div>
        )}
        {stale && (
          <p className={styles.muted} role="status" data-testid="polarity-updating">
            Updating to the last {WINDOW_WORDS[win] || win}; the numbers below are still the last {WINDOW_WORDS[data.window_key] || data.window_key}.
          </p>
        )}
        <p className={styles.muted} data-testid="polarity-method">Auto-labelled by {methodText(data.method)}.</p>
        {partial && (
          <p className={styles.muted} data-testid="polarity-covered">
            Post text is kept {data.retention_days} days, so this window covers {covered} onward (ET); earlier days show —.
          </p>
        )}
        {days.length > 0 && (
          <div className={styles.scroll}>
            <table className={styles.grid} aria-label="Bullish and bearish posts per day">
              <thead><tr><th scope="col">Day (ET)</th><th scope="col">Bullish</th><th scope="col">Bearish</th><th scope="col">Neutral</th></tr></thead>
              <tbody>
                {days.map((d) => (
                  <tr key={d.date} data-testid="polarity-day">
                    <th scope="row">{d.date}</th>
                    {d.state === 'ok'
                      ? <><td className={styles.up}>{d.bullish}</td><td className={styles.down}>{d.bearish}</td><td>{d.neutral}</td></>
                      : <td colSpan={3}>— (not covered)</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className={styles.form}>
          <label className={styles.muted}>Sort{' '}
            <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value)} aria-label="Sort posts">
              {SORTS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className={styles.muted}>Show{' '}
            <select className={styles.select} value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Filter posts by label">
              {LABELS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <span className={styles.muted} data-testid="polarity-count">{posts.length} of {dash(data.posts_matching)} shown</span>
        </div>
        {posts.length === 0
          ? <div className={styles.note} data-testid="polarity-no-posts">No posts match this filter in the window.</div>
          : (
            <ul className={styles.hits} data-testid="polarity-posts">
              {posts.map((p) => (
                <li key={`${p.source}:${p.id}`} className={styles.hit} data-testid="polarity-post">
                  <span className={p.label === 'bullish' ? styles.up : p.label === 'bearish' ? styles.down : styles.muted}>{LABEL_WORD[p.label] || p.label}</span>
                  {' · '}{p.date} · {sourceText(p)}
                  <div className={styles.postText} data-testid="polarity-post-text">
                    {p.text != null
                      ? p.text
                      : <span className={styles.muted}>Text no longer held (the X feed keeps a post about 7 days); its label is kept.</span>}
                  </div>
                  {safeLink(p.link) && <div className={styles.cite}><a href={safeLink(p.link)} target="_blank" rel="noopener noreferrer">Open the post</a></div>}
                </li>
              ))}
            </ul>
          )}
      </>
    )
  }

  return (
    <div data-testid="polarity" aria-busy={stale}>
      <div className={styles.form} role="group" aria-label="Sentiment window">
        <span className={styles.muted}>Bullish/bearish split (auto-labelled)</span>
        {WINDOWS.map(([k, v]) => (
          <button key={k} type="button" className={`${styles.button} ${win === k ? styles.windowOn : ''}`}
            aria-pressed={win === k} onClick={() => setWin(k)}>{v}</button>
        ))}
      </div>
      {body}
    </div>
  )
}
