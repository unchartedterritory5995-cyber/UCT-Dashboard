// app/src/components/screener/StructureProvenance.jsx
//
// ─── WHAT A STRUCTURE MEANS, AND WHO SAID SO ────────────────────────────────
//
// ⛔⛔ THIS EXISTS BECAUSE THE RESEARCH WAS UNREACHABLE. The base library holds
// ~210 criteria across 26 structures — verbatim sentences with their source,
// numbers we supplied and label as ours, and refusals naming exactly what a
// house declined to publish. Until `GET /api/screener/structures` none of it
// left the server, and until this panel none of it reached a screen. A member
// saw "Darvas Box" in a column and had no way to learn what that claimed, who
// claimed it, or what we measured.
//
// ⭐ THE REFUSALS ARE THE PART NOBODY ELSE SHIPS, so they are rendered as a
// first-class section rather than hidden behind a toggle. "Darvas publishes no
// minimum or maximum box length" is not an absence of content — it is the
// most honest thing on the card, and the reason a reader can trust the numbers
// beside it.
//
// ⛔ AN UNMEASURED STRUCTURE SAYS SO IN WORDS, NEVER AS A ZERO. `pattern_join`
// shipped a synthetic 0.0 to members across 46 of 79 rows by treating absence
// as zero; the ledger's whole design is that a blank stays a blank. So a
// structure with no published lift renders "not measured" and never "+0.00pp".
//
// ⛔ AND A LIFT CARRIES ITS DIRECTION. `parabolic-extension` publishes
// +31.21pp on the SHORT metric — it resolved DOWNWARD more often than its
// baseline. Rendering "+31.21pp" alone reads as an upside edge, which is the
// exact mistake that had `stage-4-breakdown` published on a metric answering
// the opposite question.
import { useEffect, useMemo, useState } from 'react'
import styles from './StructureProvenance.module.css'

const STATE_LABEL = {
  sourced: 'Published by the source',
  refused: 'The source did not publish this',
  ours: 'Our number, not theirs',
}

export function formatLift(evidence) {
  // ⛔ Absence is words, never a zero — see the header note.
  if (!evidence || evidence.lift_pp == null) return null
  const dir = evidence.direction === 'short' ? 'downward' : 'upward'
  const ci = evidence.ci_pp || []
  return {
    headline: `${evidence.lift_pp > 0 ? '+' : ''}${evidence.lift_pp.toFixed(2)}pp`,
    resolves: dir,
    interval: ci.length === 2
      ? `${ci[0] > 0 ? '+' : ''}${ci[0].toFixed(2)} to ${ci[1] > 0 ? '+' : ''}${ci[1].toFixed(2)}`
      : null,
    n: evidence.n,
  }
}

export function groupCriteria(criteria) {
  const out = { sourced: [], refused: [], ours: [] }
  for (const c of criteria || []) {
    if (out[c.state]) out[c.state].push(c)
  }
  return out
}

function Criterion({ c }) {
  return (
    <li className={`${styles.criterion} ${styles[c.state]}`}>
      <div className={styles.condition}>{c.condition}</div>
      {c.value != null && (
        <div className={styles.value}>{String(
          Array.isArray(c.value) ? c.value.join(' – ') : c.value
        )}</div>
      )}
      {c.quote && <blockquote className={styles.quote}>“{c.quote}”</blockquote>}
      {c.missing && (
        <div className={styles.missing}>
          <span className={styles.missingTag}>not published</span>
          {c.missing}
        </div>
      )}
    </li>
  )
}

export function StructureCard({ entry }) {
  const lift = formatLift(entry.evidence)
  const groups = useMemo(() => groupCriteria(entry.criteria), [entry.criteria])
  return (
    <article className={styles.card} data-structure={entry.key}>
      <header className={styles.head}>
        <h3 className={styles.label}>{entry.label}</h3>
        <span className={styles.bias} data-bias={entry.bias}>{entry.bias}</span>
        {/* ⭐ WHOSE STRUCTURE THIS IS, at the structure level. A per-criterion
            "ours" tag cannot say it: Darvas Box carries several of our own
            numbers and is still Darvas' pattern. This badge fires only when
            NOTHING in the structure traces to a house -- and it already found
            five shipping structures nobody had labelled (the shape-axis
            partition: advancing/declining/contracting/expanding/undefined),
            which we invented and which rendered indistinguishably from the
            published classics beside them. */}
        {entry.origin === 'uct' && (
          <span className={styles.uctOriginal}>UCT original — not a published pattern</span>
        )}
        {entry.coverage_pct != null && (
          <span className={styles.coverage}>
            fires on {entry.coverage_pct}% of the universe
          </span>
        )}
      </header>
      <p className={styles.desc}>{entry.desc}</p>

      <div className={styles.evidence}>
        {lift ? (
          <>
            <strong className={styles.lift}>{lift.headline}</strong>
            <span className={styles.resolves}>resolves {lift.resolves}</span>
            {lift.interval && (
              <span className={styles.ci}>95% CI {lift.interval}pp</span>
            )}
            <span className={styles.n}>n={lift.n.toLocaleString()}</span>
          </>
        ) : (
          // Words, not a zero.
          <span className={styles.unmeasured}>
            No measured edge published — see the criteria below for what is
            known and what is not.
          </span>
        )}
      </div>

      {['sourced', 'ours', 'refused'].map(state => (
        groups[state].length > 0 && (
          <section key={state} className={styles.group}>
            <h4 className={styles.groupHead}>
              {STATE_LABEL[state]}
              <span className={styles.count}>{groups[state].length}</span>
            </h4>
            <ul className={styles.list}>
              {groups[state].map((c, i) => (
                <Criterion key={`${state}-${i}`} c={c} />
              ))}
            </ul>
          </section>
        )
      ))}
    </article>
  )
}

export default function StructureProvenance({ fetcher = fetch }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let alive = true
    fetcher('/api/screener/structures')
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(d => { if (alive) setData(d) })
      .catch(e => { if (alive) setError(e) })
    return () => { alive = false }
  }, [fetcher])

  if (error) {
    // ⛔ A failed fetch is reported, never rendered as an empty library — an
    // empty list would read as "we have no structures", which is a different
    // and false claim.
    return (
      <div className={styles.error} role="alert">
        Could not load the structure library ({String(error.message)}).
      </div>
    )
  }
  if (!data) return <div className={styles.loading}>Loading structures…</div>

  const entries = Object.values(data.structures || {})
  const counts = data.counts || {}
  return (
    <div className={styles.wrap}>
      <header className={styles.summary}>
        <strong>{counts.structures ?? entries.length}</strong> structures ·{' '}
        <strong>{counts.sourced ?? 0}</strong> criteria published by a source ·{' '}
        <strong>{counts.ours ?? 0}</strong> supplied by us ·{' '}
        <strong>{counts.refused ?? 0}</strong> the sources never published
        {counts.uct_originals > 0 && (
          <> · <strong>{counts.uct_originals}</strong> of the structures are ours, not classics</>
        )}
      </header>
      {entries.map(e => <StructureCard key={e.key} entry={e} />)}
    </div>
  )
}
