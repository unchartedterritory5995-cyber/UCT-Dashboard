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
//
// ⛔ AND A NUMBER READ ALOUD IS A DIFFERENT NUMBER. The direction used to live
// in a SEPARATE span beside the lift — visually adjacent, programmatically
// unrelated. A screen reader that lands on the strong alone (or any consumer
// that reads the emphasised value on its own) hears "+31.21 pp" and nothing
// else, which is the same upside-edge misreading the comment above exists to
// prevent, just through the other channel. The direction is now INSIDE the
// element that carries the number, and the unit is spelled out, so the two
// cannot be separated by anything short of deleting the element.
import { useEffect, useId, useMemo, useState } from 'react'
import styles from './StructureProvenance.module.css'

const STATE_LABEL = {
  sourced: 'Published by the source',
  refused: 'The source did not publish this',
  ours: 'Our number, not theirs',
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
  const signed = pp(evidence.lift)
  const resolves = evidence.direction === 'short' ? 'downward' : 'upward'
  return {
    headline: `${signed}pp`,
    resolves,
    // ⭐ THE SPOKEN FORM IS DERIVED FROM THE SAME TWO FIELDS as the visible
    // one, never re-typed, so the two channels cannot drift into disagreeing
    // about which way a structure resolved. "pp" is spelled out because a
    // screen reader says "pee pee".
    spoken: `${signed} percentage points, resolving ${resolves}`,
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
    // `data-state` is the state as a VALUE, not as a colour or a hashed class
    // name. The left border says which state this is in three hues AND, since
    // the a11y pass, in three border STYLES; this attribute is the third
    // channel, and it is the one a test can read without asserting on colour.
    <li className={`${styles.criterion} ${styles[c.state]}`} data-state={c.state}>
      <div className={styles.condition}>{c.condition}</div>
      {c.value != null && (
        <div className={styles.value}>{String(
          Array.isArray(c.value) ? c.value.join(' – ') : c.value
        )}</div>
      )}
      {c.quote && <blockquote className={styles.quote}>“{c.quote}”</blockquote>}
      {c.missing && (
        // ⛔ THE SPACE IS LOAD-BEARING. The pill's 6px margin is a VISUAL gap;
        // the accessibility tree concatenates adjacent inline text with no
        // separator, so this read as "not publishedDarvas publishes no minimum
        // or maximum box length" — one invented word at the seam of the two
        // sentences the panel exists to keep apart.
        <div className={styles.missing}>
          <span className={styles.missingTag}>not published</span>{' '}
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
  // ⭐ useId, not `entry.key`. The card is exported and rendered on its own
  // (tests do it today), and two mounts of the same structure would otherwise
  // publish the same id twice — a duplicate id makes aria-labelledby resolve
  // to whichever copy the browser found first, silently naming one card after
  // another. React hands out a per-instance value; nothing here can collide.
  const uid = useId()
  const labelId = `${uid}-label`
  return (
    <article className={styles.card} data-structure={entry.key} aria-labelledby={labelId}>
      <header className={styles.head}>
        <h3 className={styles.label} id={labelId}>{entry.label}</h3>
        {/* "neutral" on its own is a word, not a claim. The label sits OUTSIDE
            the pill so the pill's own text stays exactly the bias — the shape
            every existing reader of this element depends on. */}
        <span className="sr-only">Bias: </span>
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
            <strong className={styles.lift}>
              <span aria-hidden="true">{lift.headline}</span>
              <span className="sr-only">{lift.spoken}</span>
            </strong>
            {/* aria-hidden because `lift.spoken` above already said it, from
                the same field. Two nodes, one claim, read once. */}
            <span className={styles.resolves} aria-hidden="true">resolves {lift.resolves}</span>
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

      {/* ⛔⛔ THE LABEL IS THE ONLY NON-COLOUR CHANNEL THAT SURVIVES A SCREEN
          READER, and until this pass it was not attached to anything. The
          heading and the list were siblings: a reader who jumped INTO the list
          (by list navigation, by find-in-page, by touch exploration) got eight
          criteria with no statement of whose they were. `aria-labelledby` makes
          the heading the list's NAME, so every entry into the list carries the
          provenance with it — "Published by the source 3, list, 3 items".
          The count now has a space before it too; without one the name read as
          "Published by the source3". */}
      {['sourced', 'ours', 'refused'].map(state => (
        groups[state].length > 0 && (
          <section key={state} className={styles.group}>
            <h4 className={styles.groupHead} id={`${uid}-${state}`}>
              {STATE_LABEL[state]}{' '}
              <span className={styles.count}>{groups[state].length}</span>
            </h4>
            <ul className={styles.list} aria-labelledby={`${uid}-${state}`}>
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
  const uid = useId()
  const titleId = `${uid}-title`

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
  // role="status" (an implicit polite live region) because the panel opens
  // EMPTY: `Sheet` focuses the dialog before the fetch lands, so a screen
  // reader user hears the dialog name and then silence. Without a live region
  // the arrival of ~28 structures is not announced at all — the member is
  // sitting in what sounds like an empty panel.
  if (!data) return <div className={styles.loading} role="status">Loading structures…</div>

  const entries = Object.values(data.structures || {})
  const counts = data.counts || {}
  return (
    <div className={styles.wrap}>
      {/* ⛔ THE PANEL HAD NO HEADING. `Sheet` renders its `title` prop into a
          plain <div> (Sheet.jsx L160), so "Structure library" is TEXT, not a
          heading — and the cards' <h3>s therefore opened the outline at level
          three under nothing. Screen-reader users navigate a dialog by heading
          first; there was none to find. This one is sr-only because the sheet
          already shows the same words, and it is the aria-labelledby target
          for the card list below so the two facts stay one fact. */}
      <h2 className="sr-only" id={titleId}>Structure library</h2>
      {/* Was a <header>. HTML-AAM maps <header> to the `banner` LANDMARK unless
          it descends from article/aside/main/nav/section — and a
          `div[role="dialog"]` is none of those, so this counts-line was
          publishing a SECOND banner landmark over the app's own every time the
          sheet opened. The card's <header> is fine: it is inside <article>. */}
      <div className={styles.summary}>
        <strong>{counts.structures ?? entries.length}</strong> structures ·{' '}
        <strong>{counts.sourced ?? 0}</strong> criteria published by a source ·{' '}
        <strong>{counts.ours ?? 0}</strong> supplied by us ·{' '}
        <strong>{counts.refused ?? 0}</strong> the sources never published
        {counts.uct_originals > 0 && (
          <> · <strong>{counts.uct_originals}</strong> of the structures are ours, not classics</>
        )}
      </div>
      {/* ⭐ A LIST, BECAUSE THE COUNT IS INFORMATION. Twenty-eight sibling
          <article>s announce as twenty-eight unrelated things; a named list
          announces "Structure library, list, 28 items" and gives item
          positions, which is how a reader knows there is more below the fold
          without scrolling to find out. */}
      <ul className={styles.cards} aria-labelledby={titleId}>
        {libraryOrder(entries).map(e => (
          <li key={e.key}><StructureCard entry={e} /></li>
        ))}
      </ul>
    </div>
  )
}
