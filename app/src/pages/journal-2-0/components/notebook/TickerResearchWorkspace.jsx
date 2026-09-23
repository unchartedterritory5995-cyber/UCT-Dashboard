import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import useTickerResearch from '../../hooks/useTickerResearch'
import { createNoteViaApi, createNoteFromTemplateViaApi } from '../../lib/noteCreation'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import { excerptRevisitTarget } from '../../lib/searchNavigation'
import AskPanel from './AskPanel'
import DocumentPreviewSheet from './DocumentPreviewSheet'
import CapturedSourceSheet from './CapturedSourceSheet'
import { SkeletonLine } from '../../../../components/Skeleton'
import styles from './TickerResearchWorkspace.module.css'

const DOC_STATUS_LABEL = {
  pending: 'Processing…',
  processing_failed: "Text couldn't be processed",
  no_text: 'No extractable text',
}

const STATUS_LABEL = { watching: 'Watching', active: 'Active', invalidated: 'Invalidated', closed: 'Closed' }

function relativeDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return d.toLocaleDateString()
}

function NoteRow({ note, onOpen }) {
  const status = note.propertiesJson?.['builtin:thesis_status']
  return (
    <button type="button" className={styles.row} onClick={() => onOpen(note)}>
      <span className={styles.rowTitle}>{note.title?.trim() || 'Untitled'}</span>
      <span className={styles.rowMeta}>
        {status && <span className={styles.chip}>{STATUS_LABEL[status] || status}</span>}
        <span className={styles.rowDate}>{relativeDate(note.updatedAt)}</span>
      </span>
    </button>
  )
}

function fmtFactValue(value, unit) {
  if (unit === 'usd_per_share' || unit === 'usd') {
    return typeof value === 'number' ? `$${value.toFixed(2)}` : String(value)
  }
  return String(value)
}

/**
 * Wave H — the Ticker Research Workspace (checkpoint decision 6/8). A
 * dynamic VIEW over existing notes/theses/facts/trade-links for one
 * security -- never a duplicate store (directive §15/§66). Reused as-is
 * from TWO entry surfaces (checkpoint decision 6): this component, mounted
 * both by the standalone `/journal/notebook/research/:symbol` route AND as
 * `/research/:sym`'s "My Research" bridge tab.
 */
export default function TickerResearchWorkspace({ symbol, onOpenNote, showBackLink = true }) {
  const { summary, isLoading } = useTickerResearch(symbol)
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [showPastTheses, setShowPastTheses] = useState(false)
  const [previewDoc, setPreviewDoc] = useState(null)
  const [capturedSource, setCapturedSource] = useState(null)
  const [actionError, setActionError] = useState('')

  const openNote = (note) => (onOpenNote ? onOpenNote(note) : navigate(notePath(note.id)))

  // ⛔ AN EXCERPT CITATION USED TO BE A DEAD CLICK. Its navigation is
  // `{kind:'excerpt', excerpt_id, document_id, page_number}` -- no `note_id` --
  // and this handler only knew `note_id`. It now opens the passage the way the
  // note editor already opens a saved excerpt (`handleOpenExcerptSource`): the
  // single-excerpt read, which carries the document's URL and the owning note,
  // then `excerptRevisitTarget` -- the one rule for where an excerpt may
  // truthfully land -- into the same two sheets. A PDF passage opens at its
  // page with the passage emphasised; a captured web passage opens as a
  // captured passage, never in a PDF viewer over `web:<sha256>`.
  //
  // ⛔ AND NOTHING HERE IS SILENT. A citation that genuinely has nowhere to go
  // says so, in words, and a failed read is not reported as a deleted passage.
  // The sentence is RETURNED to AskPanel, which shows it inside the panel: on
  // touch the panel is a modal Sheet, and this page's own alert line sits
  // behind its scrim.
  const openCitation = async (source) => {
    const nav = source?.navigation || {}
    if (nav.kind === 'excerpt' && nav.excerpt_id) {
      try {
        const res = await fetch(`/api/j2/excerpts/${encodeURIComponent(nav.excerpt_id)}`,
                                { credentials: 'include' })
        if (res.status === 404) return 'That passage is no longer available.'
        const excerpt = res.ok ? (await res.json())?.excerpt : null
        const target = excerptRevisitTarget(excerpt)
        if (target?.kind === 'captured_source') { setCapturedSource(excerpt); return null }
        if (target) { setPreviewDoc({ ...target, emphasizeExcerpt: excerpt }); return null }
      } catch (e) {
        console.error('[research] open cited excerpt failed', e)
      }
      return "Couldn't open that passage — try again."
    }
    if (nav.note_id) { openNote({ id: nav.note_id }); return null }
    return "That source can't be opened from here."
  }

  // ⛔ These two used to be `alert(\`Could not create note: ${e.message}\`)`.
  // Two defects in one line: a raw provider/backend exception rendered to a
  // member (Wave B removed that class elsewhere; Wave H reintroduced it here),
  // and a native `alert()` — the modal the scorecard already names as the
  // trust-eroding pattern. The copy now says what happened and what is still
  // true of the member's data, in the house idiom, and the exception goes to
  // the console where an engineer can read it.
  const handleNewNote = async () => {
    setCreating(true)
    setActionError('')
    try {
      const note = await createNoteViaApi({ ticker: symbol })
      openNote(note)
    } catch (e) {
      console.error('[research] create note failed', e)
      setActionError("Couldn't create that note. Nothing was saved — try again.")
    } finally {
      setCreating(false)
    }
  }

  const handleNewThesis = async () => {
    setCreating(true)
    setActionError('')
    try {
      const note = await createNoteFromTemplateViaApi('thesis', { ticker: symbol })
      openNote(note)
    } catch (e) {
      console.error('[research] create thesis failed', e)
      setActionError("Couldn't start that thesis. Nothing was saved — try again.")
    } finally {
      setCreating(false)
    }
  }

  if (isLoading || !summary) {
    // G-106 (Wave B lower-frequency sweep): same skeleton idiom as
    // ResearchHome's own loading state -- a title-shaped line, then a
    // couple of body-shaped lines -- rather than bare text.
    return (
      <div className={styles.loading} role="status" aria-label="Loading…">
        <SkeletonLine width="40%" height={18} />
        <div style={{ height: 16 }} />
        <SkeletonLine width="85%" height={13} />
        <SkeletonLine width="65%" height={13} />
      </div>
    )
  }

  const { identity, notes, activeTheses, pastTheses, facts, documents, tradeSummary } = summary
  const isEmpty = notes.length === 0 && activeTheses.length === 0 && pastTheses.length === 0 && documents.length === 0
  const viewAllHref = `/journal/notebook?view=all&ticker=${encodeURIComponent(symbol)}`

  return (
    <div className={styles.workspace} data-export-exclude>
      {showBackLink && (
        <button type="button" className={styles.backLink} onClick={() => navigate('/journal/notebook')}>
          <UIcon name="chevronRight" size={12} style={{ transform: 'rotate(180deg)', marginRight: 4 }} gold={false} />
          Notebook
        </button>
      )}

      {actionError && (
        <div className={styles.actionError} role="alert">{actionError}</div>
      )}

      <div className={styles.header}>
        <div>
          <h2 className={styles.symbol}>{identity.symbol}</h2>
          {identity.displayName && <div className={styles.companyName}>{identity.displayName}</div>}
          <div className={styles.subtitle}>My Research</div>
        </div>
        <div className={styles.headerActions}>
          {/* The scope is PRESELECTED. The member is already inside NVDA
              Research, so they should not have to type "NVDA" or configure a
              filter to ask about it. */}
          {/* ⛔ `onOpenNote` was never an AskPanel prop, so every citation in
              "This research" was a dead click. Citations navigate through
              `onNavigate`, into `openCitation` above. */}
          <AskPanel scope="security" target={identity.symbol}
                    onOpenNote={openNote}
                    onNavigate={openCitation} />
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleNewNote} disabled={creating}>
            <UIcon name="plus" size={13} gold={false} /> New note
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={handleNewThesis} disabled={creating}>
            <UIcon name="compass" size={13} gold={false} /> New thesis
          </button>
        </div>
      </div>

      {isEmpty ? (
        <div className={styles.empty}>
          <p>No research on {identity.symbol} yet.</p>
          <p className={styles.emptyHint}>Start a note or a thesis — it'll show up here automatically.</p>
        </div>
      ) : (
        <>
          {activeTheses.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Active thesis{activeTheses.length > 1 ? 'es' : ''}</h3>
              <div className={styles.rows}>
                {activeTheses.map((n) => <NoteRow key={n.id} note={n} onOpen={openNote} />)}
              </div>
            </div>
          )}

          {pastTheses.length > 0 && (
            <div className={styles.section}>
              <button type="button" className={styles.collapseToggle} onClick={() => setShowPastTheses((s) => !s)}>
                <UIcon name={showPastTheses ? 'chevronUp' : 'chevronDown'} size={12} gold={false} />
                Past theses ({pastTheses.length})
              </button>
              {showPastTheses && (
                <div className={styles.rows}>
                  {pastTheses.map((n) => <NoteRow key={n.id} note={n} onOpen={openNote} />)}
                </div>
              )}
            </div>
          )}

          {notes.length > 0 && (
            <div className={styles.section}>
              <div className={styles.sectionHeader}>
                <h3 className={styles.sectionTitle}>Notes</h3>
                <a className={styles.viewAll} href={viewAllHref}>View all</a>
              </div>
              <div className={styles.rows}>
                {notes.map((n) => <NoteRow key={n.id} note={n} onOpen={openNote} />)}
              </div>
            </div>
          )}

          {documents.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Documents</h3>
              <div className={styles.rows}>
                {documents.map((d) => {
                  const ready = d.status === 'ready' || d.status === 'no_text'
                  return (
                    <button
                      type="button"
                      key={d.id}
                      className={styles.row}
                      onClick={() => (ready
                        ? setPreviewDoc({ href: d.attachmentUrl, name: d.name })
                        : openNote({ id: d.noteId }))}
                    >
                      <span className={styles.rowTitle}>
                        <UIcon name="document" size={13} gold={false} style={{ marginRight: 6, verticalAlign: -2 }} />
                        {d.name || 'Document'}
                      </span>
                      <span className={styles.rowMeta}>
                        {d.status === 'ready' && d.pageCount != null && (
                          <span className={styles.chip}>{d.pageCount} page{d.pageCount === 1 ? '' : 's'}</span>
                        )}
                        {DOC_STATUS_LABEL[d.status] && (
                          <span className={styles.chip}>{DOC_STATUS_LABEL[d.status]}</span>
                        )}
                        <span className={styles.rowDate}>{relativeDate(d.createdAt)}</span>
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          )}

          {facts.length > 0 && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Captured facts</h3>
              <div className={styles.rows}>
                {facts.map((f) => (
                  <button type="button" key={f.id} className={styles.row} onClick={() => openNote({ id: f.noteId })}>
                    <span className={styles.rowTitle}>{f.factLabel}</span>
                    <span className={styles.rowMeta}>
                      <span className={styles.factValue}>{fmtFactValue(f.value, f.unit)}</span>
                      <span className={styles.rowDate}>{relativeDate(f.observedAt)}</span>
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {(tradeSummary.openPositions > 0 || tradeSummary.closedTrades > 0) && (
            <div className={styles.section}>
              <h3 className={styles.sectionTitle}>Trades &amp; positions</h3>
              <div className={styles.tradeSummary}>
                {tradeSummary.openPositions > 0 && (
                  <span className={styles.tradeChip}>{tradeSummary.openPositions} open position{tradeSummary.openPositions > 1 ? 's' : ''}</span>
                )}
                {tradeSummary.closedTrades > 0 && (
                  <span className={styles.tradeChipMuted}>{tradeSummary.closedTrades} closed trade{tradeSummary.closedTrades > 1 ? 's' : ''}</span>
                )}
                <a className={styles.viewAll} href="/journal/trades">Open Journal</a>
              </div>
            </div>
          )}
        </>
      )}
      <DocumentPreviewSheet
        open={!!previewDoc}
        href={previewDoc?.href}
        name={previewDoc?.name}
        page={previewDoc?.page}
        onClose={() => setPreviewDoc(null)}
        /* The viewer emphasises an excerpt only if it is HANDED that excerpt. */
        excerpts={previewDoc?.emphasizeExcerpt ? [previewDoc.emphasizeExcerpt] : []}
        emphasizeExcerptId={previewDoc?.emphasizeExcerptId}
        documentId={previewDoc?.documentId}
        onOpenNote={openNote}
      />
      <CapturedSourceSheet
        open={!!capturedSource}
        excerpt={capturedSource}
        onClose={() => setCapturedSource(null)}
        onOpenOwningNote={capturedSource ? () => {
          const id = capturedSource.noteId
          setCapturedSource(null)
          openNote({ id })
        } : null}
      />
    </div>
  )
}
