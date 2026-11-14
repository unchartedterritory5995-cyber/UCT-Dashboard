// app/src/components/screener/MethodologyPanel.jsx
//
// Packet O CP1 (signed 2026-09-22, fingerprint fd57fe079) -- publishing HOW
// the screener's composite columns are computed. GET /api/screener/methodology
// already had this: weights/bands read live off the ratings module (so a
// re-weighting moves the published document on the same deploy), a mandatory
// caveat on every entry, and a not_claimed list on the composite -- it just
// had zero frontend callers. Modeled on StructureProvenance.jsx's idiom in
// this same directory: a failed fetch reports an error, never an empty
// library; a caveat is a first-class field, never a hidden footnote.
import { useEffect, useId, useRef, useState } from 'react'
import styles from './MethodologyPanel.module.css'

function ComponentBreakdown({ components }) {
  if (!components?.length) return null
  return (
    <ul className={styles.breakdown}>
      {components.map((c) => (
        <li key={c.key} className={styles.breakdownRow}>
          <span className={styles.breakdownLabel}>{c.label}</span>
          <span className={styles.breakdownShare}>{c.share_pct}%</span>
        </li>
      ))}
    </ul>
  )
}

function MethodCard({ m }) {
  const uid = useId()
  const labelId = `${uid}-label`
  return (
    <article className={styles.card} aria-labelledby={labelId}>
      <header className={styles.head}>
        <h3 className={styles.label} id={labelId}>{m.label}</h3>
        <code className={styles.column}>{m.column}</code>
      </header>
      <p className={styles.oneLine}>{m.one_line}</p>
      <div className={styles.scale}>{m.scale}</div>
      <p className={styles.how}>{m.how}</p>
      <ComponentBreakdown components={m.components} />
      {/* ⛔ THE CAVEAT IS A FIELD, NOT A FOOTNOTE -- same rule as
          StructureProvenance.jsx. Never collapsed, never optional. */}
      {m.caveat && (
        <div className={styles.caveat}>
          <span className={styles.caveatTag}>Caveat</span> {m.caveat}
        </div>
      )}
      {m.not_claimed?.length > 0 && (
        <div className={styles.notClaimed}>
          <div className={styles.notClaimedHead}>This number does NOT claim to be:</div>
          <ul>
            {m.not_claimed.map((n, i) => <li key={i}>{n}</li>)}
          </ul>
        </div>
      )}
    </article>
  )
}

// `focusColumns` (optional): open AT a section. Once the methods have loaded, the first card
// (in the document's own order) whose column is in this list is scrolled to the top of the
// panel. The Focus screener's "How the RS screens work" uses it. Absent, or no card matching:
// the panel opens at the top, as before.
export default function MethodologyPanel({ fetcher = fetch, focusColumns = null }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const uid = useId()
  const titleId = `${uid}-title`
  const wanted = Array.isArray(focusColumns) ? focusColumns : []
  const focusAt = data ? (data.methods || []).find((m) => wanted.includes(m.column))?.column : null
  const focusRef = useRef(null)
  useEffect(() => {
    // jsdom has no scrollIntoView; a browser without it simply opens at the top.
    if (focusAt && typeof focusRef.current?.scrollIntoView === 'function') focusRef.current.scrollIntoView({ block: 'start' })
  }, [focusAt])

  useEffect(() => {
    let alive = true
    fetcher('/api/screener/methodology')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (alive) setData(d) })
      .catch((e) => { if (alive) setError(e) })
    return () => { alive = false }
  }, [fetcher])

  if (error) {
    return (
      <div className={styles.error} role="alert">
        Could not load the methodology ({String(error.message)}).
      </div>
    )
  }
  if (!data) return <div className={styles.loading} role="status">Loading methodology…</div>

  return (
    <div className={styles.wrap}>
      <h2 className="sr-only" id={titleId}>Screener methodology</h2>
      {data.as_of_note && <div className={styles.asOfNote}>{data.as_of_note}</div>}
      <ul className={styles.cards} aria-labelledby={titleId}>
        {(data.methods || []).map((m) => (
          <li key={m.column} ref={m.column === focusAt ? focusRef : undefined}><MethodCard m={m} /></li>
        ))}
      </ul>
    </div>
  )
}
