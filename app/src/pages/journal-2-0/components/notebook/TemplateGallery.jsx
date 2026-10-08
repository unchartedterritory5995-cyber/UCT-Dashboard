// Wave 12 (lane 12A) — the COMMUNITY template gallery, inside the Notebook's New note
// dialog (TemplatePicker.jsx opens it; dark behind notebook_template_gallery_enabled).
//
// Three views, chosen by the toggle at the top:
//   * Browse — "UCT picks" (featured) above "Community" (everything else listed), with a
//     search box, category chips and a sort. Each card has Preview, Use template and
//     Report as SIBLING controls (never a button in a button). Admins also get Feature /
//     Hide on a card.
//   * Your submissions — the member's own published templates in every state (waiting
//     for review, listed, not approved with the reviewer's reason, hidden), each with
//     Unpublish, which is always possible.
//   * Review queue — admins only (TemplateGalleryReviewPanel).
//
// ⛔ "Use template" COPIES the template into Your templates (the server does it); it never
// makes a note by itself. The member then picks "Make a note from it", which hands the
// copy to `onUseNow` — the SAME `onPickMember` door every member template already uses,
// so a gallery template is never a second way to create a note.
// ⛔ Every failure is a sentence on screen (role="alert"); nothing fails silently.
import { useEffect, useId, useRef, useState } from 'react'
import {
  GALLERY_CATEGORIES, GALLERY_SORTS, REPORT_REASONS, STATUS_LABELS, categoryLabel,
  copyGalleryTemplate, getGalleryTemplate, reportGalleryTemplate, reviewGalleryTemplate,
  unpublishFromGallery, useTemplateGallery,
} from '../../lib/templateGallery'
import TemplatePreview from './TemplatePreview'
import TemplateGalleryReviewPanel from '../../../../components/admin/TemplateGalleryReviewPanel'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TemplateGallery.module.css'

const ALL = ''

function PreviewLines({ lines }) {
  if (!lines?.length) return null
  return (
    <span className={styles.preview} aria-hidden="true">
      {lines.map((line, i) => (
        // a preview's lines are fixed for a template: the index is its identity
        <span key={i} className={`${styles.previewLine} ${line.kind === 'heading' ? styles.previewHeading : ''}`}>
          {line.kind === 'bullet' ? `• ${line.text}` : line.text}
        </span>
      ))}
    </span>
  )
}

function ReportForm({ item, onDone, onCancel }) {
  const uid = useId()
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)
  const submit = async (e) => {
    e.preventDefault()
    if (!reason || working) return
    setWorking(true)
    setError(null)
    try {
      const out = await reportGalleryTemplate(item.id, { reason, note })
      onDone(out?.already
        ? `You've already reported “${item.title}”. A moderator will look at it.`
        : `Thanks. A moderator will review “${item.title}”.`)
    } catch (err) {
      setError(err?.message || "Couldn't send that report. Try again.")
      setWorking(false)
    }
  }
  return (
    <form className={styles.reportForm} onSubmit={submit} aria-label={`Report ${item.title}`}>
      <label className={styles.field} htmlFor={`${uid}-reason`}>
        <span>Why are you reporting it?</span>
        <select id={`${uid}-reason`} value={reason} onChange={(e) => setReason(e.target.value)} required>
          <option value="">Choose a reason</option>
          {REPORT_REASONS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        </select>
      </label>
      <label className={styles.field} htmlFor={`${uid}-note`}>
        <span>Anything a moderator should know (optional)</span>
        <textarea id={`${uid}-note`} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={styles.btn} disabled={!reason || working}>Send report</button>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

function GalleryCard({ item, isAdmin, busy, onPreview, onUse, onChanged, onMessage }) {
  const uid = useId()
  const [reporting, setReporting] = useState(false)
  const [working, setWorking] = useState(false)
  // FIN-A11Y (review R4, M-4): closing the Report form removes the control that had focus;
  // the Report button is still there, so focus goes back to it.
  const reportBtnRef = useRef(null)
  const closeReport = () => { setReporting(false); reportBtnRef.current?.focus() }
  const admin = async (action) => {
    setWorking(true)
    try {
      await reviewGalleryTemplate(item.id, action)
      onMessage({ tone: 'ok', text: action === 'hide' ? `Hid “${item.title}”. It is still in the Review queue.`
        : action === 'feature' ? `“${item.title}” is now a UCT pick.` : `“${item.title}” is no longer a UCT pick.` })
      onChanged()
    } catch (err) {
      onMessage({ tone: 'error', text: err?.message || "Couldn't update that template." })
    } finally {
      setWorking(false)
    }
  }
  return (
    <li className={styles.card} data-gallery-card="" data-gallery-id={item.id}>
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle} id={`${uid}-title`}>{item.title}</h4>
        <span className={styles.meta}>
          {item.firm ? <span className={styles.firmBadge}>UCT</span> : <>by {item.author}</>}
          {' · '}{categoryLabel(item.category)}
          {item.usedBy > 0 && <> · Used by {item.usedBy}</>}
        </span>
      </div>
      {item.description && <p className={styles.cardDesc}>{item.description}</p>}
      <PreviewLines lines={item.preview} />
      <div className={styles.actions} role="group" aria-labelledby={`${uid}-title`}>
        <button type="button" className={styles.btn} onClick={() => onPreview(item)} disabled={busy}
          aria-label={`Preview ${item.title}`}>
          <UIcon name="eye" size={13} gold={false} /> Preview
        </button>
        <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => onUse(item)} disabled={busy}
          aria-label={`Use template ${item.title}`}>
          Use template
        </button>
        {!item.mine && (
          <button type="button" ref={reportBtnRef} className={styles.btn} onClick={() => setReporting((v) => !v)}
            aria-expanded={reporting} aria-label={`Report ${item.title}`}>
            Report
          </button>
        )}
        {isAdmin && (
          <>
            <button type="button" className={styles.btn} disabled={working}
              onClick={() => admin(item.featured ? 'unfeature' : 'feature')}
              aria-label={`${item.featured ? 'Unfeature' : 'Feature'} ${item.title}`}>
              {item.featured ? 'Unfeature' : 'Feature'}
            </button>
            <button type="button" className={styles.btn} disabled={working} onClick={() => admin('hide')}
              aria-label={`Hide ${item.title}`}>
              Hide
            </button>
          </>
        )}
      </div>
      {reporting && (
        <ReportForm
          item={item}
          onCancel={closeReport}
          onDone={(text) => { closeReport(); onMessage({ tone: 'ok', text }) }}
        />
      )}
    </li>
  )
}

function statusText(item) {
  if (item.hidden) return 'Hidden by a moderator'
  return STATUS_LABELS[item.status] || item.status
}

function MySubmissions({ onMessage }) {
  const { templates, error, isLoading, refresh } = useTemplateGallery({ section: 'mine' })
  const [confirm, setConfirm] = useState(null)
  const [working, setWorking] = useState(false)
  // FIN-A11Y (review R4, M-4): Unpublish swaps itself for a confirm row and "Keep it" swaps
  // back; each removes the button that had focus. Focus follows: into the confirm row on
  // "Keep it" (the safe answer), and back to that template's Unpublish button after.
  const listRef = useRef(null)
  const focusRef = useRef(null) // { id, on: 'keep' | 'open' }
  useEffect(() => {
    const want = focusRef.current
    if (!want) return
    const row = [...(listRef.current?.querySelectorAll('[data-gallery-row]') || [])]
      .find((el) => el.getAttribute('data-gallery-row') === want.id)
    const el = row?.querySelector(`[data-gallery-focus="${want.on}"]`)
    if (!el) return
    focusRef.current = null
    el.focus()
  }, [confirm])
  const askUnpublish = (item) => { focusRef.current = { id: item.id, on: 'keep' }; setConfirm(item.id) }
  const keep = (item) => { focusRef.current = { id: item.id, on: 'open' }; setConfirm(null) }
  const unpublish = async (item) => {
    setWorking(true)
    try {
      await unpublishFromGallery(item.id)
      setConfirm(null)
      onMessage({ tone: 'ok', text: `Unpublished “${item.title}”. Copies other members made are theirs and stay.` })
      refresh()
    } catch (err) {
      onMessage({ tone: 'error', text: err?.message || `Couldn't unpublish “${item.title}”.` })
    } finally {
      setWorking(false)
    }
  }
  if (error) return <p className={styles.error} role="alert">Couldn't load your submissions.</p>
  if (isLoading && !templates.length) return <p className={styles.note}>Loading your submissions…</p>
  if (!templates.length) {
    return (
      <p className={styles.note}>
        You haven't shared a template yet. Open Your templates and choose Share on one of them.
      </p>
    )
  }
  return (
    <ul ref={listRef} className={styles.list} aria-label="Your submissions">
      {templates.map((item) => (
        <li key={item.id} className={styles.card} data-gallery-mine={item.status} data-gallery-row={item.id}>
          <div className={styles.cardHead}>
            <h4 className={styles.cardTitle}>{item.title}</h4>
            <span className={`${styles.status} ${styles[`status_${item.hidden ? 'hidden' : item.status}`] || ''}`}>
              {statusText(item)}
            </span>
          </div>
          {item.status === 'rejected' && item.reviewNote && (
            <p className={styles.cardDesc}>Reviewer: {item.reviewNote}</p>
          )}
          {confirm === item.id ? (
            <div className={styles.actions} role="group" aria-label={`Unpublish ${item.title}?`}>
              <span className={styles.note}>Take “{item.title}” out of the gallery?</span>
              <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={working}
                onClick={() => unpublish(item)}>Unpublish</button>
              <button type="button" className={styles.btn} onClick={() => keep(item)} data-gallery-focus="keep">Keep it</button>
            </div>
          ) : (
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => askUnpublish(item)}
                aria-label={`Unpublish ${item.title}`} data-gallery-focus="open">Unpublish</button>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function TemplateGallery({ onBack, onUseNow, busy = false }) {
  const uid = useId()
  const headingRef = useRef(null)
  const [view, setView] = useState('browse')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL)
  const [sort, setSort] = useState('newest')
  const [preview, setPreview] = useState(null)
  const [message, setMessage] = useState(null) // { tone, text, made? }
  const [using, setUsing] = useState(false)

  useEffect(() => { headingRef.current?.focus() }, [])

  const filters = { q: query, category, sort }
  const picks = useTemplateGallery({ ...filters, section: 'picks' }, { enabled: view === 'browse' })
  const all = useTemplateGallery(filters, { enabled: view === 'browse' })
  const isAdmin = picks.isAdmin || all.isAdmin
  const community = all.templates.filter((t) => !t.featured)
  const refresh = () => { picks.refresh(); all.refresh() }

  const use = async (item) => {
    if (using) return
    setUsing(true)
    setMessage(null)
    try {
      const out = await copyGalleryTemplate(item.id)
      const added = out?.properties?.added || []
      setMessage({
        tone: 'ok',
        text: `Added “${out.template.name}” to Your templates.${added.length ? ` New properties: ${added.join(', ')}.` : ''}`,
        made: out.template,
      })
      setPreview(null)
    } catch (err) {
      setMessage({ tone: 'error', text: err?.message || `Couldn't add “${item.title}” to Your templates.` })
    } finally {
      setUsing(false)
    }
  }

  const openPreview = async (item) => {
    const base = { label: item.title, subtitle: `${item.firm ? 'UCT' : `by ${item.author}`} · ${categoryLabel(item.category)}` }
    setPreview({ ...base, body: null, loading: true, onUse: () => {} })
    try {
      const full = await getGalleryTemplate(item.id)
      setPreview({ ...base, body: full.bodyJson, onUse: () => use(item) })
    } catch (err) {
      setPreview({ ...base, body: null, loadError: err?.message || "Couldn't load this template.", onUse: () => {} })
    }
  }

  const listError = picks.error || all.error
  const loading = (picks.isLoading || all.isLoading) && !picks.templates.length && !all.templates.length
  const nothing = !loading && !listError && !picks.templates.length && !community.length

  const renderCards = (items) => (
    <ul className={styles.grid}>
      {items.map((item) => (
        <GalleryCard
          key={item.id}
          item={item}
          isAdmin={isAdmin}
          busy={busy || using}
          onPreview={openPreview}
          onUse={use}
          onChanged={refresh}
          onMessage={setMessage}
        />
      ))}
    </ul>
  )

  return (
    <div className={styles.wrap} data-template-community-gallery="">
      <div className={styles.header}>
        <button type="button" className={styles.btn} onClick={onBack}>
          Back to templates
        </button>
        <h3 className={styles.heading} ref={headingRef} tabIndex={-1} id={`${uid}-heading`}>Community gallery</h3>
      </div>
      <p className={styles.note}>
        Templates other members shared, reviewed by UCT before they are listed. Using one copies it into Your
        templates; it is yours to change.
      </p>

      <div className={styles.viewRow} role="group" aria-label="Community gallery view">
        {[['browse', 'Browse'], ['mine', 'Your submissions'], ...(isAdmin ? [['review', 'Review queue']] : [])]
          .map(([key, label]) => (
            <button key={key} type="button" aria-pressed={view === key}
              className={`${styles.chip} ${view === key ? styles.chipActive : ''}`} onClick={() => setView(key)}>
              {label}
            </button>
          ))}
      </div>

      {/* Always mounted and refilled (FIN-A11Y, review R4 M-16): a status that mounts with its
          text is often not announced. An error is still an alert. */}
      <div
        className={message ? (message.tone === 'error' ? styles.error : styles.ok) : undefined}
        role={message?.tone === 'error' ? 'alert' : 'status'}
        data-gallery-message=""
      >
        {message && (
          <>
            <span>{message.text}</span>
            {message.made && onUseNow && (
              <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={busy}
                onClick={() => onUseNow(message.made)}>
                Make a note from it
              </button>
            )}
          </>
        )}
      </div>

      {view === 'browse' && (
        <>
          <div className={styles.toolbar}>
            <input
              type="search"
              className={styles.search}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the community gallery…"
              aria-label="Search the community gallery"
            />
            <div className={styles.chipRow} role="group" aria-label="Filter by category">
              {[{ key: ALL, label: 'All' }, ...GALLERY_CATEGORIES].map((c) => (
                <button key={c.key || 'all'} type="button" aria-pressed={category === c.key}
                  className={`${styles.chip} ${category === c.key ? styles.chipActive : ''}`}
                  onClick={() => setCategory(c.key)}>
                  {c.label}
                </button>
              ))}
            </div>
            <label className={styles.sortField} htmlFor={`${uid}-sort`}>
              <span>Sort</span>
              <select id={`${uid}-sort`} value={sort} onChange={(e) => setSort(e.target.value)}>
                {GALLERY_SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {listError && <p className={styles.error} role="alert">Couldn't load the community gallery.</p>}
          {loading && <p className={styles.note}>Loading the community gallery…</p>}
          {nothing && (
            <p className={styles.note} role="status">
              {query.trim() || category ? 'No templates match.' : 'Nothing has been shared yet.'}
            </p>
          )}

          {picks.templates.length > 0 && (
            <section className={styles.section} aria-labelledby={`${uid}-picks`}>
              <h4 className={styles.sectionLabel} id={`${uid}-picks`}>UCT picks</h4>
              {renderCards(picks.templates)}
            </section>
          )}
          {community.length > 0 && (
            <section className={styles.section} aria-labelledby={`${uid}-community`}>
              <h4 className={styles.sectionLabel} id={`${uid}-community`}>Community</h4>
              {renderCards(community)}
            </section>
          )}
        </>
      )}

      {view === 'mine' && <MySubmissions onMessage={setMessage} />}
      {view === 'review' && isAdmin && <TemplateGalleryReviewPanel onMessage={setMessage} />}

      <TemplatePreview
        open={Boolean(preview)}
        onClose={() => setPreview(null)}
        title={preview?.label}
        subtitle={preview?.subtitle}
        body={preview?.body}
        onUse={preview?.onUse}
        busy={busy || using}
        loading={Boolean(preview?.loading)}
        loadError={preview?.loadError || null}
      />
    </div>
  )
}
