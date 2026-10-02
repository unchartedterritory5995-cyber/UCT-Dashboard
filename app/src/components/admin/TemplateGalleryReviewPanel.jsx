// app/src/components/admin/TemplateGalleryReviewPanel.jsx
//
// Wave 12 (lane 12A) — the community template gallery's REVIEW QUEUE, the Floor's
// CommunityReportsPanel shape (list → act → refresh) over the gallery's own endpoints:
//   * Waiting for review — Preview, Approve, or Reject with a reason the author reads
//     (the owner's "reviewed before publishing": nothing is listed until approved);
//   * Reported — the template with each open report's reason (never the reporter), and
//     Hide (the template) or Dismiss (that report);
//   * Hidden — Unhide.
// ⛔ Hide is a VISIBILITY state on the server, never a delete (the kill-switch rule).
// Rendered inside the Notebook's community gallery for admins (TemplateGallery.jsx);
// the server refuses every one of these calls to a non-admin regardless.
import { useId, useState } from 'react'
import {
  getGalleryTemplate, resolveGalleryReport, reviewGalleryTemplate, useGalleryQueue,
  REPORT_REASONS, categoryLabel,
} from '../../pages/journal-2-0/lib/templateGallery'
import TemplatePreview from '../../pages/journal-2-0/components/notebook/TemplatePreview'
import styles from '../../pages/journal-2-0/components/notebook/TemplateGallery.module.css'

const reasonLabel = (key) => REPORT_REASONS.find((r) => r.key === key)?.label || key

function RejectForm({ item, onDone, onCancel }) {
  const uid = useId()
  const [note, setNote] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (!note.trim() || working) return
    setWorking(true)
    setError(null)
    try {
      await reviewGalleryTemplate(item.id, 'reject', note)
      onDone(`Rejected “${item.title}”. The author sees your reason.`)
    } catch (err) {
      setError(err?.message || "Couldn't reject that template.")
      setWorking(false)
    }
  }
  return (
    <form className={styles.reportForm} onSubmit={submit} aria-label={`Reject ${item.title}`}>
      <label className={styles.field} htmlFor={`${uid}-why`}>
        <span>Why? The author reads this.</span>
        <textarea id={`${uid}-why`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} required />
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={`${styles.btn} ${styles.danger}`} disabled={!note.trim() || working}>Reject</button>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function TemplateGalleryReviewPanel({ onMessage = () => {} }) {
  const { queue, error, isLoading, refresh } = useGalleryQueue()
  const [rejecting, setRejecting] = useState(null)
  const [working, setWorking] = useState(false)
  const [preview, setPreview] = useState(null)

  const act = async (fn, okText) => {
    setWorking(true)
    try {
      await fn()
      onMessage({ tone: 'ok', text: okText })
      refresh()
    } catch (err) {
      onMessage({ tone: 'error', text: err?.message || "Couldn't do that. Nothing changed." })
    } finally {
      setWorking(false)
    }
  }

  const openPreview = async (item) => {
    const base = { label: item.title, subtitle: `by ${item.author} · ${categoryLabel(item.category)}` }
    setPreview({ ...base, loading: true })
    try {
      const full = await getGalleryTemplate(item.id)
      setPreview({ ...base, body: full.bodyJson })
    } catch (err) {
      setPreview({ ...base, loadError: err?.message || "Couldn't load this template." })
    }
  }

  if (error) return <p className={styles.error} role="alert">Couldn't load the review queue.</p>
  if (isLoading) return <p className={styles.note}>Loading the review queue…</p>

  const { pending, reported, hidden } = queue
  return (
    <div className={styles.wrap} data-gallery-review-queue="">
      <section className={styles.section} aria-label="Waiting for review">
        <h4 className={styles.sectionLabel}>Waiting for review ({pending.length})</h4>
        {pending.length === 0 && <p className={styles.note}>Nothing is waiting.</p>}
        {pending.map((item) => (
          <div key={item.id} className={styles.queueItem} data-gallery-pending={item.id}>
            <strong className={styles.cardTitle}>{item.title}</strong>
            <span className={styles.meta}>by {item.author} · {categoryLabel(item.category)}</span>
            {item.description && <p className={styles.cardDesc}>{item.description}</p>}
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => openPreview(item)}
                aria-label={`Preview ${item.title}`}>Preview</button>
              <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={working}
                onClick={() => act(() => reviewGalleryTemplate(item.id, 'approve'), `Approved “${item.title}”. It is listed now.`)}
                aria-label={`Approve ${item.title}`}>Approve</button>
              <button type="button" className={styles.btn} onClick={() => setRejecting(item.id)}
                aria-label={`Reject ${item.title}`}>Reject…</button>
            </div>
            {rejecting === item.id && (
              <RejectForm item={item} onCancel={() => setRejecting(null)}
                onDone={(text) => { setRejecting(null); onMessage({ tone: 'ok', text }); refresh() }} />
            )}
          </div>
        ))}
      </section>

      <section className={styles.section} aria-label="Reported">
        <h4 className={styles.sectionLabel}>Reported ({reported.length})</h4>
        {reported.length === 0 && <p className={styles.note}>No open reports.</p>}
        {reported.map((item) => (
          <div key={item.id} className={styles.queueItem} data-gallery-reported={item.id}>
            <strong className={styles.cardTitle}>{item.title}</strong>
            <span className={styles.meta}>by {item.author} · {item.openReports} open report{item.openReports === 1 ? '' : 's'}</span>
            {(item.reports || []).map((r) => (
              <div key={r.id} className={styles.actions}>
                <p className={styles.reportLine}>“{reasonLabel(r.reason)}”{r.note ? ` — ${r.note}` : ''}</p>
                <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={working}
                  onClick={() => act(() => resolveGalleryReport(r.id, 'hide'), `Hid “${item.title}”.`)}>Hide template</button>
                <button type="button" className={styles.btn} disabled={working}
                  onClick={() => act(() => resolveGalleryReport(r.id, 'dismiss'), 'Dismissed the report.')}>Dismiss</button>
              </div>
            ))}
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => openPreview(item)}
                aria-label={`Preview ${item.title}`}>Preview</button>
            </div>
          </div>
        ))}
      </section>

      <section className={styles.section} aria-label="Hidden">
        <h4 className={styles.sectionLabel}>Hidden ({hidden.length})</h4>
        {hidden.length === 0 && <p className={styles.note}>Nothing is hidden.</p>}
        {hidden.map((item) => (
          <div key={item.id} className={styles.queueItem} data-gallery-hidden={item.id}>
            <strong className={styles.cardTitle}>{item.title}</strong>
            <span className={styles.meta}>by {item.author}</span>
            <div className={styles.actions}>
              <button type="button" className={styles.btn} disabled={working}
                onClick={() => act(() => reviewGalleryTemplate(item.id, 'unhide'), `“${item.title}” is visible again.`)}
                aria-label={`Unhide ${item.title}`}>Unhide</button>
            </div>
          </div>
        ))}
      </section>

      <TemplatePreview
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.label}
        subtitle={preview?.subtitle}
        body={preview?.body}
        showUse={false}
        loading={Boolean(preview?.loading)}
        loadError={preview?.loadError || null}
      />
    </div>
  )
}
