import { useState } from 'react'
import useSWR from 'swr'
import { depthFetcher } from './depthFetch'
import styles from './Depth.module.css'
import { useDepthChrome, DepthLoading } from './depthChrome'
import { memberText, memberSentence } from '../../../lib/presentation/memberCopy'
import { usePanelFreshness, panelAsOf } from '../../../components/terminal/terminalPanel'
import Input from '../../../components/ui/Input'
import Select from '../../../components/ui/Select'

// FT-058 / FT-059 / FT-060 — boolean, proximity, synonym and section-scoped
// search over this ticker's newest 10-K and 10-Q. DARK behind FILING_SEARCH_ENABLED.
//
// ⛔ A ticker whose filings are not indexed says so ("queued for indexing"),
//    never an empty list read as "no matches".
// ⛔ The synonym expansion the server used is printed, so a hit found through a
//    synonym is never mistaken for the word typed.
// ⛔ Every hit names its filing and section and links to the SEC document.

const SECTIONS = [['', 'All sections'], ['risk', 'Risk factors'], ['mdna', 'MD&A']]
const FORMS = [['', '10-K and 10-Q'], ['10-K', '10-K'], ['10-Q', '10-Q']]

function Snippet({ text, marks }) {
  const [open, close] = marks || ['\u0001', '\u0002']
  const out = []
  let rest = text || ''
  let k = 0
  while (rest.length) {
    const a = rest.indexOf(open)
    if (a < 0) { out.push(rest); break }
    const b = rest.indexOf(close, a + 1)
    if (b < 0) { out.push(rest.replace(open, '')); break }
    if (a > 0) out.push(rest.slice(0, a))
    out.push(<mark key={k++} className={styles.mark}>{rest.slice(a + 1, b)}</mark>)
    rest = rest.slice(b + 1)
  }
  return <>{out}</>
}

// The server's paragraph index is 0-based; a member reads 1-based. Null when it is missing or not
// a whole number, so the citation leaves it out instead of printing "paragraph NaN".
export function paraLabel(paraNo) {
  if (paraNo === null || paraNo === undefined || paraNo === '') return null
  const n = Number(paraNo)
  return Number.isInteger(n) && n >= 0 ? `paragraph ${n + 1}` : null
}

export default function FilingSearchPanel({ sym }) {
  const chrome = useDepthChrome()
  const s = (sym || '').toUpperCase().trim()
  const [draft, setDraft] = useState('')
  const [section, setSection] = useState('')
  const [form, setForm] = useState('')
  const [submitted, setSubmitted] = useState(null)

  const key = submitted
    ? `/api/research/filing-search?${new URLSearchParams({ q: submitted.q, sym: s, ...(submitted.section ? { section: submitted.section } : {}), ...(submitted.form ? { form: submitted.form } : {}) })}`
    : null
  const { data, error, mutate } = useSWR(key, depthFetcher, { revalidateOnFocus: false })
  // TERM-019: name this panel's source (and its as-of) in the terminal panel header when it is the
  // whole panel (a DPTH stack names "several" itself); a no-op outside the terminal.
  // The index's own fill time (`as_of`, epoch s) for the filings searched; absent until indexed.
  usePanelFreshness(chrome.alone && data && !data.paywalled && !error && data.source ? panelAsOf(memberText(data.source), data.as_of) : null)

  const onSubmit = (e) => {
    e.preventDefault()
    const q = draft.trim()
    if (q) setSubmitted({ q, section, form })
  }

  let body = null
  if (!submitted) body = null
  else if (error) body = <div className={styles.error} data-testid="filing-search-unavailable">Filing search is unavailable right now. That is a gap in what we could read, not a finding about {s}.{' '}<button type="button" className={styles.retry} onClick={() => mutate()}>Retry</button></div>
  else if (!data) body = <div className={styles.note} role="status">Searching…</div>
  else if (data.paywalled) body = <div className={styles.note}>Filing search requires a paid plan.</div>
  else if (data.badRequest) body = <div className={styles.error} data-testid="filing-search-bad-query">{data.badRequest}</div>
  else if (data.index_state && !['indexed', 'corpus'].includes(data.index_state)) {
    body = <div className={styles.note} data-testid="filing-search-not-indexed">{memberSentence(data.reason) || `${s}'s filings are not indexed yet.`}</div>
  } else {
    const exp = Object.entries(data.expanded || {})
    body = (
      <div data-testid="filing-search-results">
        <p className={styles.lede} data-testid="filing-search-count">
          {data.count} paragraph{data.count === 1 ? '' : 's'}{data.truncated ? ' (more exist; showing the best matches)' : ''} in {s}'s
          {' '}{(data.documents || []).map(d => `${d.form} filed ${d.filed || '—'}`).join(' and ') || 'indexed filings'}.
        </p>
        {exp.length > 0 && (
          <p className={styles.muted} data-testid="filing-search-expanded">
            Also searched: {exp.map(([w, alts]) => `${w} → ${alts.join(', ')}`).join('; ')}. Prefix a word with = to search it alone.
          </p>
        )}
        {(data.notes || []).map((n, i) => <p key={i} className={styles.muted}>{n}</p>)}
        {/* Audit 2026-10-08 (FSRC, point 7): zero hits over an empty list read as a dead end. */}
        {!(data.hits || []).length && (
          <p className={styles.note} data-testid="filing-search-no-hits">
            No paragraph matched. Try fewer words, All sections, or OR between alternatives (tariff OR duties).
          </p>
        )}
        <ol className={styles.hits} data-panel-list>
          {(data.hits || []).map((h) => (
            <li key={`${h.accession}-${h.section}-${h.para_no}`} className={styles.hit} data-testid="filing-search-hit">
              <Snippet text={h.snippet} marks={data.snippet_marks} />
              <div className={styles.cite}>
                {/* Audit 2026-10-08 (FSRC, point 12): a missing field is left out, never printed as
                    "paragraph NaN" or a stray separator. */}
                {[
                  [h.form, h.filed ? `filed ${h.filed}` : ''].filter(Boolean).join(' '),
                  h.section_label,
                  paraLabel(h.para_no),
                ].filter(Boolean).join(' · ')}
                {' · '}
                {h.url ? <a href={h.url} target="_blank" rel="noopener noreferrer">SEC document {h.accession}</a> : h.accession}
              </div>
            </li>
          ))}
        </ol>
        <p className={styles.muted}>Source: {memberText(data.source)}.</p>
      </div>
    )
  }

  return (
    <section className={chrome.panelClass} data-testid="filing-search">
      {chrome.showTitle && <h3 className={styles.panelTitle}>Filing search</h3>}
      <form className={styles.form} onSubmit={onSubmit} role="search">
        <Input className={styles.input} aria-label="Search this company's filings" value={draft}
          placeholder='e.g. tariff NEAR/8 margin, "supply chain" -china, section:risk'
          onChange={(e) => setDraft(e.target.value)} />
        <Select className={styles.select} aria-label="Section" value={section} onChange={(e) => setSection(e.target.value)}>
          {SECTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <Select className={styles.select} aria-label="Form" value={form} onChange={(e) => setForm(e.target.value)}>
          {FORMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </Select>
        <button className={styles.button} type="submit">Search</button>
      </form>
      <ul className={styles.help}>
        <li>AND (or a space), OR, NOT or -word; parentheses group.</li>
        <li>a NEAR/8 b: both within 8 words, either order. "a phrase" and =word match exactly.</li>
        <li>A plain word also finds its stems and listed synonyms. section:risk, section:mdna, form:10-Q narrow it.</li>
      </ul>
      {body}
    </section>
  )
}
