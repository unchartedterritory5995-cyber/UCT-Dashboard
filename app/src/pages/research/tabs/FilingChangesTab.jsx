import { useState } from 'react'
import useSWR from 'swr'
import { sectionFetcher } from '../../../components/research/sections/sectionFetch'
import styles from './FilingChangesTab.module.css'
import { usePendingReask } from '../depth/depthFetch'
import PendingGaveUp from '../depth/PendingGaveUp'
import { memberText } from '../../../lib/presentation/memberCopy'

// COV-04 (roadmap RM-L12) — what changed between a company's two most recent 10-Ks
// (or, selectable, its two most recent 10-Qs), section by section, from SEC EDGAR.
// DARK behind FILING_BLACKLINE_ENABLED.
//
// ⛔ Every side names its accession number and filing date.
// ⛔ A section we could not locate says so with the reason. It is never "no changes".
// ⛔ A change of only years, dates or figures is labelled and counted, never hidden.
// ⛔ A failed or pending read is a gap in what we could read, not a finding.

const KIND_LABEL = { added: 'Added', removed: 'Removed', changed: 'Changed', moved: 'Moved' }
const FORMS = [
  { form: '10-K', label: 'Annual (10-K)' },
  { form: '10-Q', label: 'Quarterly (10-Q)' },
]

function Cite({ side, f }) {
  if (!f) return null
  return (
    <span data-testid={`cite-${side}`}>
      {f.form} filed {f.filing_date} (accession{' '}
      <a href={f.index_url || f.url} target="_blank" rel="noreferrer">{f.accession}</a>)
    </span>
  )
}

function Marks({ segments }) {
  return segments.map((s, i) => {
    if (s.op === 'ins') return <ins key={i} className={styles.ins}>{s.text}</ins>
    if (s.op === 'del') return <del key={i} className={styles.del}>{s.text}</del>
    return <span key={i}>{s.text}</span>
  })
}

function Paragraph({ p }) {
  return (
    <li className={`${styles.para} ${styles[p.kind] || ''}`} data-testid={`para-${p.kind}`}>
      <span className={styles.kind}>
        {KIND_LABEL[p.kind] || p.kind}
        {p.boilerplate ? <span className={styles.boiler} data-testid="boilerplate-tag"> · only years, dates or figures</span> : null}
      </span>
      <p className={styles.text}>{p.segments ? <Marks segments={p.segments} /> : p.text}</p>
    </li>
  )
}

function Section({ s }) {
  if (s.state === 'reference_only') {
    return (
      <section className={styles.section} data-testid={`section-${s.key}`}>
        <h3 className={styles.h}>{s.label}</h3>
        <p className={styles.note} data-testid={`refonly-${s.key}`}>
          Both filings only refer back to another filing for this section, so there is no section text to compare.
          That is not a finding that nothing changed.
        </p>
        {s.excerpt?.newer ? <p className={styles.muted}>Newer filing says: “{s.excerpt.newer}”</p> : null}
      </section>
    )
  }
  if (s.state === 'omitted') {
    return (
      <section className={styles.section} data-testid={`section-${s.key}`}>
        <h3 className={styles.h}>{s.label}</h3>
        <p className={styles.note} data-testid={`omitted-${s.key}`}>
          Not in either filing: {s.reason}. That is not a finding that nothing changed.
        </p>
      </section>
    )
  }
  if (s.state !== 'ok') {
    return (
      <section className={styles.section} data-testid={`section-${s.key}`}>
        <h3 className={styles.h}>{s.label}</h3>
        <p className={styles.note} data-testid={`notfound-${s.key}`}>
          Not located: {s.reason}. This is a gap in what we could read, not a finding that nothing changed.
        </p>
      </section>
    )
  }
  const c = s.counts
  return (
    <section className={styles.section} data-testid={`section-${s.key}`}>
      <h3 className={styles.h}>{s.label}</h3>
      <p className={styles.counts} data-testid={`counts-${s.key}`}>
        {c.added} added · {c.removed} removed · {c.changed} changed ({c.boilerplate_changed} only years, dates or figures) · {c.moved} moved · {c.unchanged} unchanged
      </p>
      {s.reference_only && (s.reference_only.older || s.reference_only.newer)
        ? <p className={styles.note} data-testid={`refside-${s.key}`}>
            The {s.reference_only.older ? 'older' : 'newer'} filing only refers back to another filing here; the comparison is against that reference, not against the full section.
          </p>
        : null}
      {s.reflowed && (s.reflowed.older || s.reflowed.newer)
        ? <p className={styles.note} data-testid={`reflowed-${s.key}`}>
            This filing's layout splits sentences across lines, so paragraphs were rebuilt before comparing. Paragraph boundaries may not match the original exactly.
          </p>
        : null}
      {s.paragraphs.length === 0
        ? <p className={styles.note}>Both filings located; every paragraph is identical.</p>
        : <ol className={styles.list}>{s.paragraphs.map((p, i) => <Paragraph key={i} p={p} />)}</ol>}
    </section>
  )
}

function FormPicker({ form, onPick }) {
  return (
    <div className={styles.forms} role="group" aria-label="Filing type">
      {FORMS.map((f) => (
        <button key={f.form} type="button" className={styles.formBtn} aria-pressed={form === f.form}
          data-testid={`form-${f.form}`} onClick={() => onPick(f.form)}>{f.label}</button>
      ))}
    </div>
  )
}

export default function FilingChangesTab({ sym }) {
  const [form, setForm] = useState('10-K')
  return (
    <div>
      <FormPicker form={form} onPick={setForm} />
      <FilingChanges sym={sym} form={form} />
    </div>
  )
}

function FilingChanges({ sym, form }) {
  const s = (sym || '').toUpperCase().trim()
  const key = s ? `/api/research/blackline/${encodeURIComponent(s)}?form=${form}` : null
  const { data, error, mutate } = useSWR(key, sectionFetcher, { revalidateOnFocus: false })
  // Re-asks while the comparison is being built, with a cap (it used to poll every 5 s with no
  // end, promising "the page will update" forever when the queue was full).
  const reask = usePendingReask(data?.state === 'pending', mutate, key)

  if (error) {
    return <div className={styles.note} data-testid="blackline-unavailable">
      Filing changes are unavailable right now. That is a gap in what we could read, not a finding about {s}.
    </div>
  }
  if (!data) return <div className={styles.note}>Loading filing changes…</div>
  if (data.paywalled) return <div className={styles.note}>Filing changes require a paid plan.</div>
  if (data.state === 'pending') {
    return <div className={styles.note} data-testid="blackline-pending">
      Reading {s}'s two most recent {form}s from SEC EDGAR. This can take a minute; the page will update.
      <PendingGaveUp exhausted={reask.exhausted} onRetry={reask.retry} what="The comparison" />
    </div>
  }
  // not_found WITH both filings: the pair was read, but no comparable section
  // could be located in it. That is a different fact from "no SEC filer" --
  // show the two filings and say what could not be found.
  // `sections_unlocated` is the server's name for it (R9); `not_found` with
  // both filings is the older spelling a still-cached snapshot may carry.
  const sectionsMissing = data.state === 'sections_unlocated' || (data.state === 'not_found' && !!data.newer)
  if (!sectionsMissing && (data.state === 'not_found' || data.state === 'unavailable')) {
    const why = data.state === 'not_found' ? `No comparison for ${s}: ${memberText(data.detail) || 'no SEC filer matched'}.`
      : `SEC EDGAR could not be read for ${s} right now.`
    return <div className={styles.note} data-testid="blackline-unread">
      {why} That is a gap in what we could read, not a finding that nothing changed.
    </div>
  }

  return (
    <div data-testid="blackline">
      <p className={styles.lede} data-testid="blackline-sides">
        {s}: <Cite side="newer" f={data.newer} /> compared with <Cite side="older" f={data.older} />.
      </p>
      {sectionsMissing && (
        <p className={styles.note} data-testid="blackline-sections-missing">
          Both filings were found, but the comparable sections could not be located in them.
          {' '}That is a gap in what we could read, not a finding that nothing changed.
        </p>
      )}
      {(data.sections || []).map((sec) => <Section key={sec.key} s={sec} />)}
      <p className={styles.muted}>
        From SEC EDGAR. Compared paragraph by paragraph; unchanged paragraphs are counted, not shown.
        {form === '10-Q' ? ' Each quarterly report is compared with the one before it, not with the same quarter a year earlier.' : ''}
        {' '}Running page footers are not part of a section.
      </p>
    </div>
  )
}
