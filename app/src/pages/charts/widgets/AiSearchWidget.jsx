import { useState, useCallback, useRef } from 'react'
import HighlightThesis from '../../../utils/highlightThesis'
import styles from './AiSearchWidget.module.css'

const EXAMPLES = [
  "What was JPM's last earnings report like?",
  'Best sympathy stocks for NBIS?',
  'Why is SMCI moving today?',
  'Recent analyst upgrades on NVDA',
]

// AI icon (sparkle) — inline so we don't depend on a UIcon glyph name.
function Spark({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M12 2l1.8 5.4L19 9.2l-5.2 1.8L12 16l-1.8-5L5 9.2l5.2-1.8L12 2zM19 14l.9 2.7L22.5 18l-2.6.9L19 21.5l-.9-2.6L15.5 18l2.6-.9L19 14z" />
    </svg>
  )
}

function AnswerBody({ text }) {
  const lines = String(text || '').split('\n')
  return (
    <>
      {lines.map((ln, i) => {
        const t = ln.trim()
        if (!t) return <div key={i} className={styles.gap} />
        const bullet = /^[-*•]\s+/.test(t)
        const body = bullet ? t.replace(/^[-*•]\s+/, '') : t
        return (
          <div key={i} className={bullet ? styles.bullet : styles.para}>
            {bullet && <span className={styles.dot}>•</span>}
            <span><HighlightThesis text={body} /></span>
          </div>
        )
      })}
    </>
  )
}

export default function AiSearchWidget() {
  const [query, setQuery] = useState('')
  const [answer, setAnswer] = useState(null)
  const [citations, setCitations] = useState([])
  const [asked, setAsked] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const inputRef = useRef(null)

  const run = useCallback(async (q) => {
    const question = (q ?? query).trim()
    if (!question || loading) return
    setLoading(true); setError(null); setAnswer(null); setCitations([]); setAsked(question)
    try {
      const r = await fetch('/api/ai-search', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: question }),
      })
      const d = await r.json().catch(() => null)
      if (!r.ok) throw new Error(d?.detail || `Request failed (${r.status})`)
      if (!d || d.error) throw new Error(d?.error || 'No answer')
      setAnswer(d.answer || '')
      setCitations(Array.isArray(d.citations) ? d.citations : [])
    } catch (e) {
      setError(e.message || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }, [query, loading])

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); run() }
  }

  return (
    <div className={styles.root}>
      <div className={styles.searchRow}>
        <span className={styles.spark}><Spark /></span>
        <input
          ref={inputRef}
          className={styles.input}
          placeholder="Ask anything about the markets…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
        />
        {query && !loading && (
          <button className={styles.clearBtn} title="Clear" onClick={() => { setQuery(''); inputRef.current?.focus() }}>✕</button>
        )}
        <button className={styles.askBtn} onClick={() => run()} disabled={loading || !query.trim()}>
          {loading ? <span className={styles.spinner} /> : 'Ask'}
        </button>
      </div>

      <div className={styles.body}>
        {loading && (
          <div className={styles.status}>
            <span className={styles.spinner} /> Searching the markets…
          </div>
        )}
        {!loading && error && <div className={styles.error}>{error}</div>}

        {!loading && !error && answer == null && (
          <div className={styles.empty}>
            <span className={styles.emptySpark}><Spark size={26} /></span>
            <div className={styles.emptyTitle}>Ask the markets anything</div>
            <div className={styles.emptySub}>Earnings recaps, sympathy plays, catalysts, comparables — cited, current.</div>
            <div className={styles.exampleWrap}>
              {EXAMPLES.map((ex) => (
                <button key={ex} className={styles.example} onClick={() => { setQuery(ex); run(ex) }}>{ex}</button>
              ))}
            </div>
          </div>
        )}

        {!loading && !error && answer != null && (
          <div className={styles.answer}>
            {asked && <div className={styles.asked}>{asked}</div>}
            <div className={styles.answerText}><AnswerBody text={answer} /></div>
            {citations.length > 0 && (
              <div className={styles.citations}>
                <span className={styles.citLabel}>Sources</span>
                <div className={styles.citList}>
                  {citations.map((c, i) => {
                    const url = typeof c === 'string' ? c : (c?.url || '')
                    if (!url) return null
                    let host = url
                    try { host = new URL(url).hostname.replace(/^www\./, '') } catch { /* keep raw */ }
                    return (
                      <a key={i} className={styles.cit} href={url} target="_blank" rel="noreferrer" title={url}>
                        <span className={styles.citNum}>{i + 1}</span>{host}
                      </a>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
