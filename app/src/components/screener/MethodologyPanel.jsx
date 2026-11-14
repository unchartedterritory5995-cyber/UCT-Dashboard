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

// The five Relative Strength screens' own page (RS screens unit U6, 2026-11-14). The server
// serves it beside the column methods as `rs_screens` (methodology.rs_screens_section), only
// while RS_SCREENS_ENABLED is on: each screen's rule, what its quick controls do and its
// caveat, the liquidity floor, the Setup label's rules with where each number comes from, what
// "Ratings as of" means, and the sentence that our RS Rating is our own calculation.
// ⚰️ Until U6 nothing drew it: "How the RS screens work" opened this panel at a column card, and
// the page the server wrote for that door was never on screen.
// ⛔ THE WORDS ARE THE SERVER'S, VERBATIM. Only the three card headings are written here, and a
// part the payload does not carry is left out (never a heading over nothing).
const text = (v) => (typeof v === 'string' && v.trim() ? v : '')
const items = (v) => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') : [])

function RsScreensSection({ doc, sectionRef }) {
  const uid = useId()
  const headId = `${uid}-rs-screens`
  const screens = items(doc.screens).filter((s) => text(s.name) && text(s.rule))
  const setup = doc.setup && typeof doc.setup === 'object' ? doc.setup : {}
  const labels = items(setup.labels).filter((x) => text(x.label) && text(x.rule))
  const flags = items(setup.flags).filter((x) => text(x.label) && text(x.rule))
  const tight = setup.tight && typeof setup.tight === 'object' && text(setup.tight.label) && text(setup.tight.rule) ? setup.tight : null
  const hasSetup = labels.length > 0 || flags.length > 0 || !!tight
  return (
    <section className={styles.rsSection} ref={sectionRef} aria-labelledby={headId} data-testid="rs-screens-method">
      <h3 className={styles.rsTitle} id={headId}>{text(doc.label) || 'Relative Strength screens'}</h3>
      {text(doc.floor) && <p className={styles.how}>{doc.floor}</p>}
      {screens.map((s) => (
        <article key={s.id || s.name} className={styles.card}>
          <h4 className={styles.label}>{s.name}</h4>
          <p className={styles.rsRule}>{s.rule}</p>
          {text(s.controls) && <p className={styles.how}>{s.controls}</p>}
          {text(s.caveat) && (
            <div className={styles.caveat}>
              <span className={styles.caveatTag}>Caveat</span> {s.caveat}
            </div>
          )}
        </article>
      ))}
      {hasSetup && (
        <article className={styles.card}>
          <h4 className={styles.label}>The Setup label</h4>
          {text(setup.order) && <p className={styles.rsRule}>{setup.order}</p>}
          {text(setup.atr) && <p className={styles.how}>{setup.atr}</p>}
          <dl className={styles.rsTerms}>
            {labels.map((x) => (
              <div key={x.key || x.label} className={styles.rsTerm}>
                <dt>{x.label}</dt>
                <dd>{x.rule}{text(x.source) && <span className={styles.rsSource}> {x.source}</span>}</dd>
              </div>
            ))}
            {tight && <div className={styles.rsTerm}><dt>{tight.label}</dt><dd>{tight.rule}</dd></div>}
            {flags.map((x) => (
              <div key={x.key || x.label} className={styles.rsTerm}>
                <dt>{x.label}</dt>
                <dd>{x.rule}</dd>
              </div>
            ))}
          </dl>
          {text(setup.near) && <p className={styles.how}>{setup.near}</p>}
          {text(setup.blank) && <p className={styles.how}>{setup.blank}</p>}
        </article>
      )}
      {(text(doc.ratings_as_of) || text(doc.rating_note)) && (
        <article className={styles.card}>
          <h4 className={styles.label}>The RS Rating on these screens</h4>
          {text(doc.rating_note) && <p className={styles.rsRule}>{doc.rating_note}</p>}
          {text(doc.ratings_as_of) && <p className={styles.how}>{doc.ratings_as_of}</p>}
        </article>
      )}
      {text(doc.honesty) && (
        <div className={styles.caveat}>
          <span className={styles.caveatTag}>Caveat</span> {doc.honesty}
        </div>
      )}
    </section>
  )
}

// `focusSection` / `focusColumns` (both optional): open AT a place. The Focus screener's "How
// the RS screens work" passes both. Once the methods have loaded:
//   - `focusSection="rs_screens"` and the payload carries that page: the page is scrolled to
//     the top of the panel;
//   - else the first card (in the document's own order) whose column is in `focusColumns`;
//   - else (neither given, or nothing matching) the panel opens at the top, as before.
export default function MethodologyPanel({ fetcher = fetch, focusColumns = null, focusSection = null }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const uid = useId()
  const titleId = `${uid}-title`
  // The page is drawn only when it is the document the server writes (an object with its
  // screens); anything else under that key draws nothing.
  const rsDoc = data && data.rs_screens && typeof data.rs_screens === 'object' && !Array.isArray(data.rs_screens)
    && Array.isArray(data.rs_screens.screens) ? data.rs_screens : null
  const sectionAt = focusSection === 'rs_screens' && rsDoc ? 'rs_screens' : null
  const wanted = Array.isArray(focusColumns) ? focusColumns : []
  const focusAt = data && !sectionAt ? (data.methods || []).find((m) => wanted.includes(m.column))?.column : null
  const focusRef = useRef(null)
  const target = sectionAt || focusAt
  useEffect(() => {
    // jsdom has no scrollIntoView; a browser without it simply opens at the top.
    if (target && typeof focusRef.current?.scrollIntoView === 'function') focusRef.current.scrollIntoView({ block: 'start' })
  }, [target])

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
      {rsDoc && <RsScreensSection doc={rsDoc} sectionRef={sectionAt ? focusRef : undefined} />}
    </div>
  )
}
