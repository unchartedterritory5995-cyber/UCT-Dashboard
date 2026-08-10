// app/src/components/calendar/TranscriptSearchAll.jsx
//
// Search EVERY indexed transcript, not the one on screen. "Who said tariff
// this quarter, and what did they say?"
//
// Snippets arrive from the server with <mark> already around the match — FTS5
// computes them, because only the index knows where in a 50KB transcript the
// hit was. They are rendered through a whitelist that allows <mark> and
// nothing else, so the server cannot inject markup into the page even if the
// transcript text contained some.
import { useCallback, useEffect, useState } from 'react'
import { SeriesChart } from '../research-kit'
import styles from './TranscriptSearchAll.module.css'

const MIN_LEN = 2

/** Split a server snippet into plain text and highlighted runs.
 *  Never uses dangerouslySetInnerHTML: transcript text is third-party content
 *  and a <script> in it would otherwise execute. */
export function parseSnippet(snippet) {
  const out = []
  const re = /<mark>(.*?)<\/mark>/gs
  let last = 0
  let m
  while ((m = re.exec(snippet || '')) !== null) {
    if (m.index > last) out.push({ text: snippet.slice(last, m.index), hit: false })
    out.push({ text: m[1], hit: true })
    last = m.index + m[0].length
  }
  if (last < (snippet || '').length) out.push({ text: snippet.slice(last), hit: false })
  return out
}


/** "tariff, AI, buyback" → three terms. A quoted phrase keeps its commas. */
export function splitTerms(q) {
  const s = (q || '').trim()
  if (!s) return []
  if (s.startsWith('"')) return [s]          // a phrase is one term, commas and all
  const parts = s.split(',').map(t => t.trim()).filter(t => t.length >= MIN_LEN)
  // Cap the fan-out: each term is its own query, and six lines on one axis is
  // past the point anyone can read them apart.
  return (parts.length ? parts : [s]).slice(0, 4)
}

// Positional colour is legitimate HERE and nowhere else in this file: the
// series are arbitrary user terms with no inherent direction, so no hue can be
// semantically wrong. Anywhere the series mean up/down (ratings, breadth) the
// caller must name its own colour.
const TERM_COLORS = ['var(--ut-gold, #c9a84c)', '#5aa9e6', '#7ed957', '#e57373']

/** Align several single-term trends onto one shared month axis. */
export function alignTrends(trends) {
  const list = (trends || []).filter(t => (t?.months || []).length)
  if (!list.length) return { months: [], series: [] }
  // Union of months, sorted: a term absent for a month must read as a gap on a
  // shared axis, not shift every later point left.
  const months = [...new Set(list.flatMap(t => t.months.map(m => m.month)))].sort()
  return {
    months,
    series: list.map((t, i) => {
      const by = new Map(t.months.map(m => [m.month, m.pct]))
      return {
        name: t.query,
        color: TERM_COLORS[i % TERM_COLORS.length],
        values: months.map(m => (by.has(m) ? by.get(m) : null)),
      }
    }),
  }
}

export default function TranscriptSearchAll({ onOpenSymbol = null }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [trend, setTrend] = useState([])
  const [busy, setBusy] = useState(false)
  const trendSeries = alignTrends(trend)

  const run = useCallback(async (term) => {
    if (!term || term.trim().length < MIN_LEN) { setRes(null); return }
    setBusy(true)
    try {
      // A comma means "compare these narratives", which is a different
      // question from "find this phrase" — so the search still runs on the
      // whole string and only the TREND fans out per term.
      const terms = splitTerms(term)
      const enc = encodeURIComponent(term)
      // Fired together: the trend is the same question over time, and running
      // it after the search would make the panel arrive in two visible steps.
      const [r, ...ts] = await Promise.all([
        fetch(`/api/earnings/transcript-search?q=${enc}&limit=40`),
        ...terms.map(t2 => fetch(
          `/api/earnings/transcript-trend?q=${encodeURIComponent(t2)}&months=12`)),
      ])
      setRes(r.ok ? await r.json() : { hits: [], total: 0, error: 'search failed' })
      const trends = await Promise.all(ts.map(x => (x.ok ? x.json() : null)))
      setTrend(trends.filter(Boolean))
    } catch {
      setRes({ hits: [], total: 0, error: 'search failed' })
      setTrend([])
    } finally {
      setBusy(false)
    }
  }, [])

  // Debounced so typing does not fire a query per keystroke against a
  // full-text index.
  useEffect(() => {
    const t = setTimeout(() => run(q), 300)
    return () => clearTimeout(t)
  }, [q, run])

  return (
    <div className={styles.wrap} data-testid="transcript-search-all">
      <div className={styles.head}>
        <span className={styles.label}>SEARCH ALL TRANSCRIPTS</span>
        {res && !busy && (
          <span className={styles.count}>
            {res.total} {res.total === 1 ? 'call' : 'calls'}
          </span>
        )}
      </div>

      <input
        className={styles.input}
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={'e.g. tariff, "pricing power", buyback…'}
        aria-label="Search every indexed earnings transcript"
      />

      {busy && <p className={styles.note}>Searching…</p>}

      {/* Share of calls, not a raw count: calls cluster in earnings season, so
          a count peaks every quarter whatever the theme is doing. */}
      {!busy && trendSeries.months.length > 1 && (
        <SeriesChart
          periods={trendSeries.months}
          mode="line"
          label={trendSeries.series.length > 1
            ? 'Share of calls mentioning each term'
            : `Share of calls mentioning “${trendSeries.series[0]?.name}”`}
          valueFormatter={(v) => (v == null ? '—' : `${v}%`)}
          ariaLabel="Percent of indexed earnings calls mentioning each term, by month"
          series={trendSeries.series}
        />
      )}

      {res?.error && <p className={styles.note}>{res.error}</p>}

      {res && !busy && !res.error && res.hits.length === 0 && q.trim().length >= MIN_LEN && (
        <p className={styles.note}>
          No call in the index mentions that. The index covers recent calls only.
        </p>
      )}

      <ul className={styles.hits}>
        {(res?.hits || []).map(h => (
          <li key={`${h.symbol}-${h.year}-${h.quarter}`} className={styles.hit}>
            <button
              type="button"
              className={styles.sym}
              onClick={() => onOpenSymbol && onOpenSymbol(h.symbol)}
              title={`Open ${h.symbol}`}
            >
              {h.symbol}
            </button>
            <span className={styles.meta}>Q{h.quarter} {h.year} · {h.date}</span>
            <p className={styles.snippet}>
              {parseSnippet(h.snippet).map((p, i) =>
                p.hit ? <mark key={i} className={styles.mark}>{p.text}</mark>
                      : <span key={i}>{p.text}</span>)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  )
}
