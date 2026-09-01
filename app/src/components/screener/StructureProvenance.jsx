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
  refused: 'Published with no number we can use',
  ours: 'Our number, not theirs',
}

/** Why a criterion has no value. The section header cannot say it, because one
 *  section holds all three kinds — so the tag on each row does. */
const MISSING_TAG = {
  source_silent: 'the source never published this',
  not_computable: 'published, but we cannot compute it',
  our_scope: 'we have not implemented this',
}

const pp = (x) => `${x > 0 ? '+' : ''}${(x * 100).toFixed(2)}`

/** Read a ledger row the way the ledger actually writes one.
 *
 * ⛔⛔ THIS FUNCTION SHIPPED READING FIELDS THAT DO NOT EXIST. It looked for
 * `lift_pp` and `ci_pp`; `lift_ledger.for_structure()` returns `lift`,
 * `ci_low` and `ci_high` — and as FRACTIONS, not percentage points. So it
 * returned null for every structure and the panel rendered "No measured edge
 * published" across the whole library, including the four rows that had
 * cleared all four gates. 26 green tests did not catch it, because the fixture
 * was written from my assumption about the payload instead of from the payload.
 * `tests/test_structure_panel_reads_the_real_ledger.py` is the cross-lane rail
 * that now pins the two together — the JS lane's field names are extracted from
 * this file and checked against a real row.
 *
 * ⛔ AND AN UNPUBLISHED ROW IS NOT AN EDGE. A row can carry a `lift` and still
 * have failed a gate — a negative sign, a CI touching zero, a CI lower bound
 * under the null's maximum, or too few null trials. Rendering that number as a
 * headline would publish what the gates refused, which is the whole thing the
 * ledger exists to prevent. The reasons are shown instead. */
export function formatLift(evidence) {
  if (!evidence || evidence.lift == null) return null
  if (!evidence.published) return null
  const ok = (x) => typeof x === 'number'
  return {
    headline: `${pp(evidence.lift)}pp`,
    resolves: evidence.direction === 'short' ? 'downward' : 'upward',
    interval: ok(evidence.ci_low) && ok(evidence.ci_high)
      ? `${pp(evidence.ci_low)} to ${pp(evidence.ci_high)}`
      : null,
    // ⭐ The null's maximum is the gate that decides most rows — a lift only
    // publishes when the CI's LOWER bound clears it — so it is shown, not
    // buried in the artifact.
    nullMax: ok(evidence.null_max) ? `${pp(evidence.null_max)}pp` : null,
    trials: evidence.null_trials ?? null,
    n: evidence.n,
    note: evidence.note || null,
  }
}

/** Why a measured structure is NOT publishing a number.
 *
 * ⭐ The refusals are the part nobody else ships, and that is as true of a
 * refused MEASUREMENT as of a refused criterion. */
export function refusalReasons(evidence) {
  if (!evidence || evidence.published) return []
  return evidence.reasons || []
}

/** The order a member should meet the library in.
 *
 * ⛔⛔ THE BROWSER FOUND THIS AND NO TEST COULD. Rendered in payload order, the
 * panel opened on the five SHAPE-partition cards — `advancing-structure`,
 * `declining-structure`, `contracting-range`… — which are ours, carry ONE
 * criterion each, and have no measured edge. Darvas Box's +7.35pp and every
 * sourced classic sat below them. 37 green tests said nothing about it, because
 * order is not correctness and jsdom paints nothing: the defect only exists on
 * a screen.
 *
 * The hierarchy is information, not taste: a MEASURED number outranks a
 * published rule, which outranks a label we invented. Within a tier the
 * payload's own order is kept — it is `ALL_STRUCTURES`, which is already
 * grouped by family. */
export function libraryOrder(entries) {
  const tier = (e) => {
    if (e.evidence?.published) return 0            // measured and published
    if (e.origin !== 'uct') return 1               // a published rule
    return 2                                       // ours
  }
  return [...entries]
    .map((e, i) => [e, i])
    .sort((a, b) => tier(a[0]) - tier(b[0]) || a[1] - b[1])
    .map(([e]) => e)
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
          {/* ⛔ THE TAG MUST NOT SAY "not published" WHEN THE SOURCE DID PUBLISH
              IT. The section header reads "The source did not publish this",
              and for a handful of criteria that sentence is false: Minervini
              states the 2.5-3x market-depth rule in the verbatim quote directly
              above, and the value is blank only because a per-symbol detector
              holds no index series. Telling a member a real author was silent
              when he was not is the exact class of claim this library exists to
              prevent, so the refusal says which KIND it is. */}
          <span className={styles.missingTag}>{MISSING_TAG[c.missing_kind] || MISSING_TAG.source_silent}</span>
          {c.missing}
        </div>
      )}
    </li>
  )
}

export function StructureCard({ entry }) {
  const lift = formatLift(entry.evidence)
  const reasons = refusalReasons(entry.evidence)
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
            {lift.nullMax && (
              <span className={styles.ci}>
                null max {lift.nullMax}
                {lift.trials ? ` over ${lift.trials} trials` : ''}
              </span>
            )}
            <span className={styles.n}>n={lift.n.toLocaleString()}</span>
          </>
        ) : reasons.length > 0 ? (
          // ⭐ MEASURED AND REFUSED IS A THIRD STATE, and it is the most
          // informative of the three. "We looked and it did not clear the bar"
          // is a different claim from "we never looked", and collapsing them
          // would hide the ledger's actual work behind the same sentence.
          <div className={styles.refusedMeasure}>
            <span className={styles.missingTag}>measured, not published</span>
            <ul className={styles.reasonList}>
              {reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
          </div>
        ) : (
          // Words, not a zero.
          <span className={styles.unmeasured}>
            No measured edge published — see the criteria below for what is
            known and what is not.
          </span>
        )}
      </div>

      {/* ⭐ THE NOTE IS THE MOST VALUABLE PROSE IN THE LEDGER and it was reaching
          nobody. It is where "this number exists only because the metric was
          fixed" lives, and the Darvas recency caveat, and the square-box
          scale-dependence story. A number without its caveat is the thing this
          whole library was built to stop shipping. */}
      {lift?.note && (
        <details className={styles.noteWrap}>
          <summary className={styles.noteSummary}>
            How this number was arrived at, and what it does not say
          </summary>
          <p className={styles.note}>{lift.note}</p>
        </details>
      )}

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
      {libraryOrder(entries).map(e => <StructureCard key={e.key} entry={e} />)}
    </div>
  )
}
