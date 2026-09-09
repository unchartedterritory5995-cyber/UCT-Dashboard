import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import UIcon from '../../../../components/ui/UIcon'
import useTickerResearch from '../../hooks/useTickerResearch'
import { createNoteViaApi, createNoteFromTemplateViaApi } from '../../lib/noteCreation'
import { notePath } from '../../../../hooks/useNoteBacklinks'
import AskPanel from './AskPanel'
import DocumentPreviewSheet from './DocumentPreviewSheet'
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
  const [actionError, setActionError] = useState('')

  const openNote = (note) => (onOpenNote ? onOpenNote(note) : navigate(notePath(note.id)))

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
    return <div className={styles.loading}>Loading…</div>
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
          <AskPanel scope="security" target={identity.symbol}
                    onOpenNote={onOpenNote} />
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
        onClose={() => setPreviewDoc(null)}
        documentId={previewDoc?.documentId}
      />
    </div>
  )
}
