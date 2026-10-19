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
// P3a Task 10: a STYLE item (`itemType === 'style'`, only while the library switch is on: the server's queue
// holds outline rows alone otherwise) also shows its kind, its blocks and its trading style, read from the
// item's `payload` (getGalleryTemplate, admin-visible while pending); Preview shows its outline. A held revision
// of a listed style says so ("Update to version N of a listed style ...") with the revision's own title.
// ⛔ Fix round 1 (ruling P3a-T10-R1): for a held REVISION every detail shown is the revision's own, read from the
//    admin-only `pendingRevision` on the same single-item read (title, description, category, trading style,
//    kind, blocks, and the outline Preview shows). The queue row's own fields are the LISTED version's, so they
//    are never shown as the update. A revision the server could not read says so; it is never shown as listed.
// ⛔ Ruling P3a-T10-R7: a style row's approve token is PINNED to the read its details card renders; Preview never
//    moves it. When a Preview read finds a newer version than the card shows, the panel says so and puts that
//    read into the card, and the token follows the card. (An outline row has no card: its Preview sets it.)
// P4b Task 8: a PAGE LAYOUT item (`itemType === 'page_layout'`) shows which page it is for, its trading style, and
// per list the panels in order with Shown / Hidden, read from the item's `payload` on the same single-item read the
// style card uses (and pinned as the approve token the same way, P3a-T10-R7). A held revision shows the revision's
// own lists, from `pendingRevision`. A layout whose payload is null (every panel unknown to this build, P4b-T6b-R1)
// says "This layout can't be used yet." and its lists are never read. A layout row has no Preview: it has no outline,
// and its details card IS the preview.
// The panel is reached through the gallery's lazy chunk (ruling X13), so none of this is first-open code.
// Rendered inside the Notebook's community gallery for admins (TemplateGallery.jsx);
// the server refuses every one of these calls to a non-admin regardless.
import { useCallback, useEffect, useId, useState } from 'react'
import useSWR, { useSWRConfig } from 'swr'
import {
  getGalleryTemplate, resolveGalleryReport, reviewGalleryTemplate, useGalleryQueue,
  REPORT_REASONS, categoryLabel,
} from '../../pages/journal-2-0/lib/templateGallery'
import { LAYOUT_UNSUPPORTED_SENTENCE, tradingStyleLabel } from '../../pages/journal-2-0/lib/styleLibrary'
import { PANELS, PHASES, PHASE_LABELS } from '../../pages/journal-2-0/lib/pageLayouts'
import { blockLabel } from '../../pages/journal-2-0/lib/journalBlocks'
import { BUILTIN_NOTE_KINDS } from '../../pages/journal-2-0/lib/noteKinds'
import TemplatePreview from '../../pages/journal-2-0/components/notebook/TemplatePreview'
import styles from '../../pages/journal-2-0/components/notebook/TemplateGallery.module.css'

const reasonLabel = (key) => REPORT_REASONS.find((r) => r.key === key)?.label || key

// ⛔ `version` is the server's `pendingRevision.version` (final review M-10): the panel never restates the server's
// "listed + 1" arithmetic, so the card line and the Preview subtitle cannot name two numbers for one revision.
export const revisionLine = (version) =>
  `Update to version ${version} of a listed style. Approving lists it; the current version stays until then.`
export const REVISION_UNREADABLE_LINE = 'This update could not be read, so there is nothing to show. Ask the author to share it again.'
export const CARD_REFRESHED_LINE = 'The author changed this since its details were shown. The details now show the latest version.'
// The layout revision's line (P4b): `version` is the server's `pendingRevision.version`, never restated arithmetic.
export const layoutRevisionLine = (version) =>
  `Update to a listed layout (version ${version}). Approving lists it; the current version stays until then.`
const reviewCardKey = (item) => ['gallery-review-style', item.id, item.updatedAt]
const kindName = (id) => BUILTIN_NOTE_KINDS.find((k) => k.id === id)?.name || 'A kind of note this version does not know'

/** What a reviewer is approving: for a held revision the admin-only `pendingRevision`, else the item itself.
 *  `null` for a revision row whose revision the server could not read (never the listed version instead). */
export function underReview(item, full) {
  if (!full) return null
  if (!item.hasRevision) {
    return { title: full.title, description: full.description, category: full.category,
      tradingStyle: full.tradingStyle, payload: full.payload, outline: full.bodyJson, version: full.version }
  }
  const rev = full.pendingRevision
  if (!rev) return null
  return { ...rev, outline: rev.payload?.outlineBodyJson || null }
}

/** A style item's kind, blocks and trading style (and, for a revision, its own title, description and category),
 *  all from ONE read. Keyed on the row's `updatedAt`, so an author's resubmission is read afresh. `onRead` hands
 *  the read's `updatedAt` up as the approve token. */
function StyleReviewDetails({ item, onRead }) {
  const { data, error } = useSWR(reviewCardKey(item), () => getGalleryTemplate(item.id),
    { revalidateOnFocus: false, shouldRetryOnError: false })
  useEffect(() => { if (data?.updatedAt) onRead(item.id, data.updatedAt) }, [data, item.id, onRead])
  const shown = underReview(item, data)
  const blocks = (shown?.payload?.blocks || []).map((b) => blockLabel(b.block))
  return (
    <div data-gallery-review-style={item.id}>
      {item.hasRevision && shown?.version != null && <p className={styles.note}>{revisionLine(shown.version)}</p>}
      {error && <p className={styles.error} role="alert">Couldn't load this style's kind and blocks.</p>}
      {!error && !data && <p className={styles.note}>Loading the style…</p>}
      {data && !shown && <p className={styles.error} role="alert">{REVISION_UNREADABLE_LINE}</p>}
      {shown && (
        <>
          {item.hasRevision && <p className={styles.note}>{`Title in this update: ${shown.title}`}</p>}
          {item.hasRevision && shown.description && <p className={styles.cardDesc}>{`Description in this update: ${shown.description}`}</p>}
          {item.hasRevision && shown.category && <p className={styles.meta}>{`Category in this update: ${categoryLabel(shown.category)}`}</p>}
          <p className={styles.meta}>{`Kind of note: ${kindName(shown.payload?.kindId)}`}</p>
          <p className={styles.meta}>{`Blocks: ${blocks.join(', ') || 'none'}`}</p>
          <p className={styles.meta}>{`Trading style: ${tradingStyleLabel(shown.tradingStyle) || 'not set'}`}</p>
        </>
      )}
    </div>
  )
}

const LAYOUT_PAGE_NAMES = { today: 'Today', trade: 'Trade page' }
const panelLabel = (page, id) => PANELS[page]?.find((p) => p.id === id)?.label || 'A panel this version does not know'

/** One shared list, in its order, each panel Shown or Hidden. */
function LayoutList({ page, name, list }) {
  const heading = page === 'trade' ? 'Panels' : PHASE_LABELS[name]
  return (
    <div>
      <p className={styles.meta}>{`${heading}:`}</p>
      <ol className={styles.meta} aria-label={page === 'trade' ? 'Trade page panels' : `${heading} panels`}>
        {list.map((e, i) => <li key={`${e.id}-${i}`}>{`${panelLabel(page, e.id)}: ${e.shown ? 'Shown' : 'Hidden'}`}</li>)}
      </ol>
    </div>
  )
}

/** A page layout item's page, trading style and lists (for a revision, the revision's own), from ONE read. Keyed and
 *  token-pinned exactly as the style card is. ⛔ A null payload is never read past (P4b-T6b-R1). */
function LayoutReviewDetails({ item, onRead }) {
  const { data, error } = useSWR(reviewCardKey(item), () => getGalleryTemplate(item.id),
    { revalidateOnFocus: false, shouldRetryOnError: false })
  useEffect(() => { if (data?.updatedAt) onRead(item.id, data.updatedAt) }, [data, item.id, onRead])
  const shown = underReview(item, data)
  const page = item.layoutPage === 'today' ? 'today' : 'trade'
  const payload = shown?.payload
  const lists = payload && typeof payload.lists === 'object' && payload.lists ? payload.lists : null
  const names = page === 'trade' ? ['trade'] : PHASES
  return (
    <div data-gallery-review-layout={item.id}>
      <p className={styles.meta}>{`Page: ${LAYOUT_PAGE_NAMES[page]}`}</p>
      {item.hasRevision && shown?.version != null && <p className={styles.note}>{layoutRevisionLine(shown.version)}</p>}
      {error && <p className={styles.error} role="alert">Couldn't load this layout's panels.</p>}
      {!error && !data && <p className={styles.note}>Loading the layout…</p>}
      {data && !shown && <p className={styles.error} role="alert">{REVISION_UNREADABLE_LINE}</p>}
      {shown && (
        <>
          {item.hasRevision && <p className={styles.note}>{`Title in this update: ${shown.title}`}</p>}
          <p className={styles.meta}>{`Trading style: ${tradingStyleLabel(shown.tradingStyle) || 'not set'}`}</p>
          {payload == null
            ? <p className={styles.note}>{LAYOUT_UNSUPPORTED_SENTENCE}</p>
            : names.filter((n) => Array.isArray(lists?.[n])).map((n) => <LayoutList key={n} page={page} name={n} list={lists[n]} />)}
        </>
      )}
    </div>
  )
}

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
      // TODO(P3b-F-R4): once P3b lands, Reject sends reviewedUpdatedAt as Approve does (ruling P4b-AUD-4).
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
  // The version of each template this reviewer has looked at: the preview's when they
  // opened one, else the queue row's. An approval sends it, and the server refuses (409)
  // when the author has published again since.
  const [seen, setSeen] = useState({})

  const act = async (fn, okText, onDone) => {
    setWorking(true)
    try {
      await fn()
      onDone?.()
      onMessage({ tone: 'ok', text: okText })
      refresh()
    } catch (err) {
      onMessage({ tone: 'error', text: err?.message || "Couldn't do that. Nothing changed." })
      // A 409 means the queue on screen is out of date: show what is there now.
      if (err?.status === 409) { setSeen({}); refresh() }
    } finally {
      setWorking(false)
    }
  }

  const markSeen = useCallback((id, updatedAt) => setSeen((prev) => (prev[id] === updatedAt ? prev : { ...prev, [id]: updatedAt })), [])
  // Style rows whose card a Preview brought up to date: { [id]: the row's updatedAt when it happened }. The line
  // says so until the reviewer ACTS on the row (an Approve that landed, a Reject that was sent -- never opening
  // Reject… or an Approve the server refused, final review M-1), reopens a card that is now current, or the queue
  // brings the row back with another updatedAt (Task 11, review N-4: it used to stay for as long as the row did).
  const [refreshed, setRefreshed] = useState({})
  const clearRefreshed = useCallback((id) => setRefreshed((prev) => {
    if (!(id in prev)) return prev
    const next = { ...prev }
    delete next[id]
    return next
  }), [])
  const { mutate: mutateCache } = useSWRConfig()

  const openPreview = async (item) => {
    const style = item.itemType === 'style'
    const what = !style ? '' : item.hasRevision ? ' · the update’s outline' : ' · the style’s outline'
    const base = { label: item.title, subtitle: `by ${item.author} · ${categoryLabel(item.category)}${what}` }
    setPreview({ ...base, loading: true })
    try {
      const full = await getGalleryTemplate(item.id)
      if (!style) markSeen(item.id, full.updatedAt)
      else if (seen[item.id] && full.updatedAt !== seen[item.id]) {
        // A newer version than the card shows: the card takes this read (and the token follows it, via onRead).
        mutateCache(reviewCardKey(item), full, { revalidate: false })
        setRefreshed((prev) => ({ ...prev, [item.id]: item.updatedAt }))
      } else {
        clearRefreshed(item.id)                         // the card the reviewer reopened is the current version
      }
      if (style && item.hasRevision) {
        const shown = underReview(item, full)
        if (!shown) { setPreview({ ...base, loadError: REVISION_UNREADABLE_LINE }); return }
        setPreview({ ...base, subtitle: `${base.subtitle} (version ${shown.version})`,
          body: shown.outline || { type: 'doc', content: [] } })
      } else {
        setPreview({ ...base, body: full.bodyJson })
      }
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
            <h5 className={styles.cardTitle}>{item.title}</h5>
            <span className={styles.meta}>by {item.author} · {categoryLabel(item.category)}</span>
            {item.description && <p className={styles.cardDesc}>{item.description}</p>}
            {item.itemType === 'style' && <StyleReviewDetails item={item} onRead={markSeen} />}
            {item.itemType === 'page_layout' && <LayoutReviewDetails item={item} onRead={markSeen} />}
            {refreshed[item.id] === item.updatedAt && <p className={styles.note} role="status">{CARD_REFRESHED_LINE}</p>}
            <div className={styles.actions}>
              {item.itemType !== 'page_layout' && (
                <button type="button" className={styles.btn} onClick={() => openPreview(item)}
                  aria-label={`Preview ${item.title}`}>Preview</button>
              )}
              <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={working}
                onClick={() => act(() => reviewGalleryTemplate(item.id, 'approve', '', seen[item.id] || item.updatedAt),
                  `Approved “${item.title}”. It is listed now.`, () => clearRefreshed(item.id))}
                aria-label={`Approve ${item.title}`}>Approve</button>
              <button type="button" className={styles.btn} onClick={() => setRejecting(item.id)}
                aria-label={`Reject ${item.title}`}>Reject…</button>
            </div>
            {rejecting === item.id && (
              <RejectForm item={item} onCancel={() => setRejecting(null)}
                onDone={(text) => { clearRefreshed(item.id); setRejecting(null); onMessage({ tone: 'ok', text }); refresh() }} />
            )}
          </div>
        ))}
      </section>

      <section className={styles.section} aria-label="Reported">
        <h4 className={styles.sectionLabel}>Reported ({reported.length})</h4>
        {reported.length === 0 && <p className={styles.note}>No open reports.</p>}
        {reported.map((item) => (
          <div key={item.id} className={styles.queueItem} data-gallery-reported={item.id}>
            <h5 className={styles.cardTitle}>{item.title}</h5>
            <span className={styles.meta}>by {item.author} · {item.openReports} open report{item.openReports === 1 ? '' : 's'}</span>
            {(item.reports || []).map((r) => (
              <div key={r.id} className={styles.actions}>
                <p className={styles.reportLine}>“{reasonLabel(r.reason)}”{r.note ? ` — ${r.note}` : ''}</p>
                <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={working}
                  onClick={() => act(() => resolveGalleryReport(r.id, 'hide'), `Hid “${item.title}”.`)}
                  aria-label={`Hide template ${item.title}`}>Hide template</button>
                <button type="button" className={styles.btn} disabled={working}
                  onClick={() => act(() => resolveGalleryReport(r.id, 'dismiss'), 'Dismissed the report.')}
                  aria-label={`Dismiss the report on ${item.title}`}>Dismiss</button>
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
            <h5 className={styles.cardTitle}>{item.title}</h5>
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
