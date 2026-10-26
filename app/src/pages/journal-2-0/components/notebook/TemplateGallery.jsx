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
//
// P3a (the community STYLE library, dark behind notebook_style_library_enabled). With the switch OFF
// this file behaves exactly as above. With it ON it adds: type chips (All · Outlines · Styles, the
// first one from `initialType`), trading-style chips (when the type is All or Styles), the library's
// sorts, a "Following" view (what the authors you follow listed), style cards (StyleLibraryCard) with
// a Preview composed by the journal styles preview door, and an author's page (AuthorView).
// ⛔ The library's cards (LibraryCard and what it renders) and AuthorView are imported only inside this lazy chunk (TemplatePicker.jsx,
// and since Task 10 styles/LibraryDoor.jsx, which opens it at Styles with its own `backLabel`), so none of the
// library is in the Notebook's first open (R-P3-5). styleLibrary.js is also read by the lazy Styles manager.
// P4b Task 7: every card goes through LibraryCard (the ONE dispatcher; shared PAGE LAYOUTS are LayoutLibraryCard),
// the Page layouts chip shows only while the list answer says `capabilities.layoutSharing`, and the message host
// renders a message's `action` (Undo) as a button beside its text.
import { Suspense, useEffect, useId, useRef, useState } from 'react'
import {
  GALLERY_CATEGORIES, GALLERY_SORTS, REPORT_REASONS, STATUS_LABELS, categoryLabel,
  copyGalleryTemplate, getGalleryTemplate, reportGalleryTemplate,
  unpublishFromGallery, useTemplateGallery,
} from '../../lib/templateGallery'
import {
  EXAMPLE_NOTE_TYPE, LISTED_ITEM_TYPES, LIBRARY_SORTS, TRADING_STYLES, isLinkableStyleItem, previewLibraryStyle,
  tradingStyleLabel, useLibraryFeed, useLibraryList,
} from '../../lib/styleLibrary'
import { styleLibraryEnabled } from '../../lib/styleLibraryFlag'
import { NOTEBOOK_EVENTS, trackNotebookEvent } from '../../lib/notebookTelemetry'
import TemplatePreview from './TemplatePreview'
// P3b Task 6: a style's Preview, with its examples ("In use"). Imported HERE only, so it ships inside this lazy chunk.
import StyleItemPreview from './styles/StyleItemPreview'
import { refusalSentence } from './StyleLibraryCard'
import LibraryCard from './LibraryCard'
import GalleryAdminActions from './GalleryAdminActions'
import AuthorView from './AuthorView'
import lazyChunk from '../../lib/lazyChunk'
import TemplateGalleryReviewPanel from '../../../../components/admin/TemplateGalleryReviewPanel'
import UIcon from '../../../../components/ui/UIcon'
import styles from './TemplateGallery.module.css'
// Notebook widgets wave 11 (Task 11.16): a card's library facts, and a listed widget, routine or tracker's Use (the
// adoption sheet, loaded on demand). Both only while wave 11 is on; off, every card is exactly as before.
import { widgetsWaveOn, doorLostSentence } from '../../lib/notebookWidgetsFlags'
import LibraryCardFacts, { ADOPT_KIND } from './library/LibraryCardFacts'

const ALL = ''

export function PreviewLines({ lines }) {
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

export function ReportForm({ item, onDone, onCancel }) {
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

export function GalleryCard({ item, isAdmin, busy, onPreview, onUse, onChanged, onMessage }) {
  const uid = useId()
  const [reporting, setReporting] = useState(false)
  // FIN-A11Y (review R4, M-4): closing the Report form removes the control that had focus;
  // the Report button is still there, so focus goes back to it.
  const reportBtnRef = useRef(null)
  const closeReport = () => { setReporting(false); reportBtnRef.current?.focus() }
  // Wave 11 (Task 11.16): the facts block replaces the description and the "Used by" count (never a 0: "New"), and a
  // tool type is made the member's through the adoption sheet (its own preview with their data), not copied.
  const w11 = widgetsWaveOn(11)
  const adoptKind = w11 ? ADOPT_KIND[item.itemType] : undefined
  const openAdopt = async () => {
    try {
      const mod = await import('./library/openAdoptSheet')
      mod.openAdoptSheet({ galleryId: item.id, kind: adoptKind })
    } catch {
      onMessage?.({ tone: 'error', text: doorLostSentence() })
    }
  }
  return (
    <li className={styles.card} data-gallery-card="" data-gallery-id={item.id}>
      <div className={styles.cardHead}>
        <h4 className={styles.cardTitle} id={`${uid}-title`}>{item.title}</h4>
        <span className={styles.meta}>
          {item.firm ? <span className={styles.firmBadge}>UCT</span> : <>by {item.author}</>}
          {' · '}{categoryLabel(item.category)}
          {!w11 && item.usedBy > 0 && <> · Used by {item.usedBy}</>}
        </span>
      </div>
      {w11 ? <LibraryCardFacts item={item} /> : item.description && <p className={styles.cardDesc}>{item.description}</p>}
      <PreviewLines lines={item.preview} />
      <div className={styles.actions} role="group" aria-labelledby={`${uid}-title`}>
        {adoptKind ? (
          <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={openAdopt} disabled={busy}
            aria-label={`Use ${item.title}`}>
            Use
          </button>
        ) : (
          <>
            <button type="button" className={styles.btn} onClick={() => onPreview(item)} disabled={busy}
              aria-label={`Preview ${item.title}`}>
              <UIcon name="eye" size={13} gold={false} /> Preview
            </button>
            <button type="button" className={`${styles.btn} ${styles.primary}`} onClick={() => onUse(item)} disabled={busy}
              aria-label={`Use template ${item.title}`}>
              Use template
            </button>
          </>
        )}
        {!item.mine && (
          <button type="button" ref={reportBtnRef} className={styles.btn} onClick={() => setReporting((v) => !v)}
            aria-expanded={reporting} aria-label={`Report ${item.title}`}>
            Report
          </button>
        )}
        {isAdmin && <GalleryAdminActions item={item} onChanged={onChanged} onMessage={onMessage} />}
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

// P3b: with the library on, the list is read through the library's hook (the same key), which also reads the server's
// `capabilities.exampleNotes`: an approved or pending style of the author's carries "Add an example note" (ruling
// P3b-R7), and the author's example notes are rows here too, with their status and any reviewer note (P3b-R12).
// The latched switch picks the hook once for the life of the tab, as TemplateGallery's own list does.
const EXAMPLE_ROW_NOTE = 'Example note'
// Loaded on demand, so the door's chunk is named only inside this lazy chunk (AddExampleNoteDoor.jsx says why).
const AddExampleNoteDoor = lazyChunk(() => import('./styles/AddExampleNoteDoor'))

function MySubmissions({ onMessage }) {
  const uid = useId()
  const useMine = styleLibraryEnabled() ? useLibraryList : useTemplateGallery
  const { templates, error, isLoading, refresh, exampleNotes = false } = useMine({ section: 'mine' })
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
            <h4 className={styles.cardTitle} id={`${uid}-${item.id}`}>{item.title}</h4>
            <span className={`${styles.status} ${styles[`status_${item.hidden ? 'hidden' : item.status}`] || ''}`}>
              {statusText(item)}
            </span>
            {item.itemType === EXAMPLE_NOTE_TYPE && <span className={styles.meta}>{EXAMPLE_ROW_NOTE}</span>}
          </div>
          {/* R-P3-3's client half (final review I-1). An APPROVED row carries a note only after a declined
              update (approve and a new share both clear it), so the author reads why; a held update is said too. */}
          {item.status === 'approved' && item.reviewNote && (
            <p className={styles.note}>Your last update was not approved. The listed version is unchanged.</p>
          )}
          {(item.status === 'rejected' || item.status === 'approved') && item.reviewNote && (
            <p className={styles.cardDesc}>Reviewer: {item.reviewNote}</p>
          )}
          {item.status === 'approved' && item.hasRevision && (
            <p className={styles.note}>An update is waiting for review. The listed version stays until then.</p>
          )}
          {confirm === item.id ? (
            <div className={styles.actions} role="group" aria-label={`Unpublish ${item.title}?`}>
              <span className={styles.note}>
                {item.itemType === EXAMPLE_NOTE_TYPE
                  ? `Withdraw the example “${item.title}”? It will no longer show on your style.`
                  : <>Take “{item.title}” out of the gallery?</>}
              </span>
              <button type="button" className={`${styles.btn} ${styles.danger}`} disabled={working}
                onClick={() => unpublish(item)}>Unpublish</button>
              <button type="button" className={styles.btn} onClick={() => keep(item)} data-gallery-focus="keep">Keep it</button>
            </div>
          ) : (
            <div className={styles.actions}>
              <button type="button" className={styles.btn} onClick={() => askUnpublish(item)}
                aria-label={`Unpublish ${item.title}`} data-gallery-focus="open">Unpublish</button>
              {exampleNotes && isLinkableStyleItem(item) && (
                <span data-example-door="">
                  <Suspense fallback={null}>
                    <AddExampleNoteDoor styleItemId={item.id} describedBy={`${uid}-${item.id}`}
                      onSent={(text) => { onMessage({ tone: 'ok', text }); refresh() }} />
                  </Suspense>
                </span>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}

export default function TemplateGallery({ onBack, onUseNow, busy = false, initialType = '', backLabel = 'Back to templates' }) {
  const uid = useId()
  const headingRef = useRef(null)
  const wrapRef = useRef(null)
  // The latched switch: it cannot change for the life of the tab, so the list hook below is chosen once.
  const libraryOn = styleLibraryEnabled()
  const [view, setView] = useState('browse')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState(ALL)
  const [sort, setSort] = useState('newest')
  const [itemType, setItemType] = useState(() => (libraryOn && LISTED_ITEM_TYPES.some((t) => t.key === initialType) ? initialType : ALL))
  const [tradingStyle, setTradingStyle] = useState(ALL)
  const [author, setAuthor] = useState(null) // an authorHandle, while their page is open
  const [preview, setPreview] = useState(null)
  const [message, setMessage] = useState(null) // { tone, text, made? }
  const [using, setUsing] = useState(false)
  const returnTo = useRef(null)

  useEffect(() => { headingRef.current?.focus() }, [])
  // Back from an author's page: focus goes back to the name that opened it (or the heading).
  useEffect(() => {
    if (author || !returnTo.current) return
    const handle = returnTo.current
    returnTo.current = null
    const door = [...(wrapRef.current?.querySelectorAll('[data-author-door]') || [])]
      .find((el) => el.getAttribute('data-author-door') === handle)
    ;(door || headingRef.current)?.focus()
  }, [author])

  // P3a Task 11: `library_viewed`, once per view change while the switch is on. The view is the one on screen
  // (an author's page over Browse or Following reads 'author'); 'Your submissions' and the review queue are not
  // library views and send nothing. Changing the type chip changes what the view shows, so it counts as a change.
  // ⛔ Enums only: never the author's handle, a query or an item.
  // An author's page lists every type whatever chip Browse had on, so it reads type 'all' (final review M-2).
  // ⚠️ Every open of the gallery counts ONE 'browse', whatever the member opened it for (Your submissions, the
  // review queue): the door lands on Browse first. Read the browse count as "gallery opens", not "browsing".
  const libraryView = !libraryOn ? null : author ? 'author' : view === 'browse' || view === 'following' ? view : null
  const libraryType = libraryView === 'author' ? 'all' : (itemType || 'all')
  // The dependency list IS the "once per change": a re-render that moves neither sends nothing.
  useEffect(() => {
    if (libraryView) trackNotebookEvent(NOTEBOOK_EVENTS.LIBRARY_VIEWED, { type: libraryType, view: libraryView })
  }, [libraryView, libraryType])

  const filters = libraryOn ? { q: query, category, sort, type: itemType, tradingStyle } : { q: query, category, sort }
  // Both hooks are one useSWR call over the gallery's list URL; with the switch off it is today's hook.
  const useList = libraryOn ? useLibraryList : useTemplateGallery
  const browsing = view === 'browse' && !author
  const picks = useList({ ...filters, section: 'picks' }, { enabled: browsing })
  const all = useList(filters, { enabled: browsing })
  const feed = useLibraryFeed({ enabled: libraryOn && view === 'following' && !author })
  const isAdmin = picks.isAdmin || all.isAdmin
  const community = all.templates.filter((t) => !t.featured)
  // P4b: the layout-sharing switch as the last list answer reported it, held while no list is asked (an author's
  // page, Following), so a layout row there renders by the same answer. No answer yet is not "off".
  const sharingAnswer = !libraryOn ? null : all.answered ? all.layoutSharing : picks.answered ? picks.layoutSharing : null
  const [layoutSharing, setLayoutSharing] = useState(false)
  if (sharingAnswer !== null && sharingAnswer !== layoutSharing) setLayoutSharing(sharingAnswer)
  // X11: a Page layouts chip (from `initialType`, or a stale tab) goes back to All once an answer says sharing is
  // off -- or the typed list is refused (a 400 carries no capabilities) and the untyped one then decides.
  const layoutsRefused = itemType === 'page_layout' && (all.error?.status === 400 || picks.error?.status === 400)
  useEffect(() => {
    if (itemType === 'page_layout' && (sharingAnswer === false || layoutsRefused)) setItemType(ALL)
  }, [itemType, sharingAnswer, layoutsRefused])
  const refresh = () => { picks.refresh(); all.refresh() }
  const chooseView = (key) => { setAuthor(null); setView(key) }
  const chooseType = (key) => { setItemType(key); if (key === 'outline') setTradingStyle(ALL) }
  const openAuthor = (handle) => { if (handle) { returnTo.current = handle; setAuthor(handle) } }
  const closeAuthor = () => setAuthor(null)

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

  // A style item's Preview: its listed payload composed with the member's OWN data (writes nothing).
  const openStylePreview = async (item) => {
    const by = item.firm ? 'UCT' : `by ${item.author}`
    const subtitle = (
      <>
        {by} · {tradingStyleLabel(item.tradingStyle) || categoryLabel(item.category)}
        <br />Rendered with your own data.
        <br />Your own property defaults are not shared.
      </>
    )
    // P3b-F-R8: a style's examples are its author's own, so its author gets no Report control on them.
    const base = { label: item.title, subtitle, style: true, examplesReportable: !item.mine }
    setPreview({ ...base, body: null, loading: true })
    try {
      const out = await previewLibraryStyle(item)
      setPreview({ ...base, body: out?.bodyJson || null, examples: out?.examples || [] })
    } catch (err) {
      setPreview({ ...base, body: null, loadError: refusalSentence(err, "Couldn't load this preview.") })
    }
  }

  const listError = picks.error || all.error
  const loading = (picks.isLoading || all.isLoading) && !picks.templates.length && !all.templates.length
  const nothing = !loading && !listError && !picks.templates.length && !community.length
  const filtered = Boolean(query.trim() || category || itemType || tradingStyle)

  const cardProps = {
    libraryOn, layoutSharing, isAdmin, busy: busy || using, onPreview: openPreview, onStylePreview: openStylePreview,
    onUse: use, onChanged: refresh, onMessage: setMessage, onOpenAuthor: openAuthor,
  }
  const card = (item) => <LibraryCard key={item.id} {...cardProps} item={item} />
  // No `onAdopted` refresh here: adoptStyle already revalidates every library view once
  // (refreshLibrary), and a second one doubled the list GETs on every adopt (review M-7).
  const renderCards = (items) => <ul className={styles.grid}>{items.map(card)}</ul>

  return (
    <div className={styles.wrap} ref={wrapRef} data-template-community-gallery="">
      <div className={styles.header}>
        <button type="button" className={styles.btn} onClick={onBack}>
          {backLabel}
        </button>
        <h3 className={styles.heading} ref={headingRef} tabIndex={-1} id={`${uid}-heading`}>Community gallery</h3>
      </div>
      <p className={styles.note}>
        Templates other members shared, reviewed by UCT before they are listed. Using one copies it into Your
        templates; it is yours to change.
      </p>

      <div className={styles.viewRow} role="group" aria-label="Community gallery view">
        {[['browse', 'Browse'], ['mine', 'Your submissions'], ...(isAdmin ? [['review', 'Review queue']] : []),
          ...(libraryOn ? [['following', 'Following']] : [])]
          .map(([key, label]) => (
            <button key={key} type="button" aria-pressed={view === key}
              className={`${styles.chip} ${view === key ? styles.chipActive : ''}`} onClick={() => chooseView(key)}>
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
            {message.action && (
              <button type="button" className={styles.btn}
                onClick={() => { const { run } = message.action; setMessage((m) => ({ ...m, action: null })); run() }}>
                {message.action.label}
              </button>
            )}
            {message.made && onUseNow && (
              <button type="button" className={`${styles.btn} ${styles.primary}`} disabled={busy}
                onClick={() => onUseNow(message.made)}>
                Make a note from it
              </button>
            )}
          </>
        )}
      </div>

      {author && (view === 'browse' || view === 'following') && (
        <AuthorView
          handle={author}
          onBack={closeAuthor}
          onMessage={setMessage}
          cardProps={cardProps}
        />
      )}

      {browsing && (
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
            {libraryOn && (
              <div className={styles.chipRow} role="group" aria-label="Filter by type" data-tour="library-types">
                {[{ key: ALL, label: 'All' }, ...LISTED_ITEM_TYPES.filter((t) => t.key !== 'page_layout' || layoutSharing)].map((t) => (
                  <button key={t.key || 'all'} type="button" aria-pressed={itemType === t.key}
                    className={`${styles.chip} ${itemType === t.key ? styles.chipActive : ''}`}
                    onClick={() => chooseType(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
            {libraryOn && itemType !== 'outline' && (
              <div className={styles.chipRow} role="group" aria-label="Filter by trading style">
                {[{ key: ALL, label: 'All' }, ...TRADING_STYLES].map((t) => (
                  <button key={t.key || 'all'} type="button" aria-pressed={tradingStyle === t.key}
                    className={`${styles.chip} ${tradingStyle === t.key ? styles.chipActive : ''}`}
                    onClick={() => setTradingStyle(t.key)}>
                    {t.label}
                  </button>
                ))}
              </div>
            )}
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
                {(libraryOn ? LIBRARY_SORTS : GALLERY_SORTS).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </select>
            </label>
          </div>

          {listError && <p className={styles.error} role="alert">Couldn't load the community gallery.</p>}
          {loading && <p className={styles.note}>Loading the community gallery…</p>}
          {nothing && (
            <p className={styles.note} role="status">
              {filtered ? 'No templates match.' : 'Nothing has been shared yet.'}
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

      {libraryOn && view === 'following' && !author && (
        feed.error ? (
          <p className={styles.error} role="alert">Couldn't load what the authors you follow listed.</p>
        ) : feed.isLoading && !feed.templates.length ? (
          <p className={styles.note}>Loading what the authors you follow listed…</p>
        ) : !feed.templates.length ? (
          <p className={styles.note} role="status">Follow an author to see their new styles here.</p>
        ) : (
          <section className={styles.section} aria-labelledby={`${uid}-following`}>
            <h4 className={styles.sectionLabel} id={`${uid}-following`}>From authors you follow</h4>
            {renderCards(feed.templates)}
          </section>
        )
      )}

      {view === 'mine' && <MySubmissions onMessage={setMessage} />}
      {view === 'review' && isAdmin && <TemplateGalleryReviewPanel onMessage={setMessage} />}

      <TemplatePreview
        open={Boolean(preview) && !preview.style}
        onClose={() => setPreview(null)}
        title={preview?.label}
        subtitle={preview?.subtitle}
        body={preview?.body}
        onUse={preview?.onUse}
        busy={busy || using}
        loading={Boolean(preview?.loading)}
        loadError={preview?.loadError || null}
      />
      {/* A style's Preview (P3a Task 9) is its own sheet since P3b Task 6: the same surface, plus "In use". */}
      <StyleItemPreview
        open={Boolean(preview?.style)}
        onClose={() => setPreview(null)}
        title={preview?.label}
        subtitle={preview?.subtitle}
        body={preview?.body}
        examples={preview?.examples}
        examplesReportable={Boolean(preview?.examplesReportable)}
        loading={Boolean(preview?.loading)}
        loadError={preview?.loadError || null}
      />
    </div>
  )
}
