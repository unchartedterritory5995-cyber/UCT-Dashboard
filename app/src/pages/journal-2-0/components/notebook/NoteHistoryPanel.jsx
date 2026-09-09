import { useEffect, useMemo, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import ConfirmModal from '../ConfirmModal'
import { timeAgo, formatET } from '../../../../utils/timeAgo'
import { useJ2NoteVersions, useJ2NoteVersion, restoreNoteVersion } from '../../hooks/useJ2NoteVersions'
import { diffNoteBodies, diffHasChanges } from '../../lib/noteVersionDiff'
import NoteVersionPreview from './NoteVersionPreview'
import styles from './NoteHistoryPanel.module.css'

/**
 * Wave C (Version History) — the trust surface: "what did this used to say,
 * and can I get it back." A `Sheet` (auto: centered modal on desktop, a
 * fullscreen sheet on touch — never forced side-by-side on a narrow screen,
 * directive §79) holding a version LIST on one side and the selected
 * version's read-only preview/diff + Restore on the other.
 *
 * Deliberately NOT a new nav surface (§27) — it opens from a header button
 * on the note itself and closes back into it. Deliberately NOT Trash (§6):
 * every row here is a content CHECKPOINT the note passed through, not a
 * deleted note.
 */
export default function NoteHistoryPanel({ open, onClose, noteId, currentNote, onRestored }) {
  const { versions, isLoading, error } = useJ2NoteVersions(noteId, { enabled: open })
  const [selectedId, setSelectedId] = useState(null)
  const [mode, setMode] = useState('preview') // 'preview' | 'diff'
  const [confirmingRestore, setConfirmingRestore] = useState(false)
  const [restoreStatus, setRestoreStatus] = useState('idle') // idle | busy | done | conflict | error
  const [restoreErrorMsg, setRestoreErrorMsg] = useState('')

  // Fresh selection every time the panel (re)opens or the note underneath it
  // changes — an old selected-version id from a previous note/open must
  // never leak into a new session.
  useEffect(() => {
    if (!open) { setSelectedId(null); setMode('preview'); setRestoreStatus('idle'); setRestoreErrorMsg('') }
  }, [open, noteId])

  // Default to the most recent version once the list lands, so opening
  // History always shows something rather than an empty detail pane.
  useEffect(() => {
    if (open && !selectedId && versions.length > 0) setSelectedId(versions[0].id)
  }, [open, selectedId, versions])

  const { version: selected, isLoading: versionLoading } = useJ2NoteVersion(noteId, selectedId)

  const diff = useMemo(() => {
    if (!selected || mode !== 'diff') return null
    return diffNoteBodies(selected.bodyPlain || '', currentNote?.bodyPlain || '')
  }, [selected, mode, currentNote?.bodyPlain])

  const doRestore = async () => {
    if (!selectedId) return
    setRestoreStatus('busy')
    setRestoreErrorMsg('')
    try {
      const restored = await restoreNoteVersion(noteId, selectedId, currentNote?.updatedAt)
      setRestoreStatus('done')
      onRestored?.(restored)
    } catch (err) {
      if (err?.status === 409) {
        setRestoreStatus('conflict')
        setRestoreErrorMsg('This note changed since History opened — refresh the note and try again.')
      } else {
        setRestoreStatus('error')
        setRestoreErrorMsg(err?.message || 'Something went wrong restoring this version.')
      }
    }
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="History"
      variant="auto"
      maxWidth={860}
      ariaLabel="Version history"
    >
      <div className={styles.wrap}>
        {isLoading && <div className={styles.centered}>Loading history…</div>}
        {!isLoading && error && (
          <div className={styles.centered} role="alert">
            Couldn't load history for this note. <button type="button" className="btn btn-ghost" onClick={onClose}>Close</button>
          </div>
        )}
        {!isLoading && !error && versions.length === 0 && (
          <div className={styles.centered} data-testid="history-empty">
            <p>No earlier versions yet.</p>
            <p className={styles.emptyHint}>
              History begins the next time you make an edit — nothing is
              backfilled, so there's nothing here to lose track of yet.
            </p>
          </div>
        )}
        {!isLoading && !error && versions.length > 0 && (
          <div className={styles.split}>
            <ul className={styles.list} role="listbox" aria-label="Earlier versions">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={v.id === selectedId}
                    className={`${styles.listItem} ${v.id === selectedId ? styles.listItemActive : ''}`}
                    onClick={() => { setSelectedId(v.id); setRestoreStatus('idle'); setRestoreErrorMsg('') }}
                  >
                    <span className={styles.listItemTitle}>{v.title || 'Untitled'}</span>
                    <span className={styles.listItemTime} title={formatET(v.createdAt)}>{timeAgo(v.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.detail}>
              {versionLoading && <div className={styles.centered}>Loading version…</div>}
              {!versionLoading && selected && (
                <>
                  <div className={styles.detailHeader}>
                    <div className={styles.tabs}>
                      <button type="button" className={mode === 'preview' ? styles.tabActive : styles.tab} onClick={() => setMode('preview')}>
                        Preview
                      </button>
                      <button type="button" className={mode === 'diff' ? styles.tabActive : styles.tab} onClick={() => setMode('diff')}>
                        What changed
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setConfirmingRestore(true)}
                      disabled={restoreStatus === 'busy'}
                    >
                      <UIcon name="clock" size={14} gold={false} />
                      Restore this version
                    </button>
                  </div>

                  {restoreStatus === 'done' && (
                    <div className={styles.statusOk} role="status">
                      Restored. What this note said a moment ago is still saved right here in History.
                    </div>
                  )}
                  {(restoreStatus === 'conflict' || restoreStatus === 'error') && (
                    <div className={styles.statusErr} role="alert">{restoreErrorMsg}</div>
                  )}

                  {mode === 'preview' && (
                    <NoteVersionPreview title={selected.title} subtitle={selected.subtitle} bodyJson={selected.bodyJson} />
                  )}
                  {mode === 'diff' && (
                    <div className={styles.diffWrap} data-testid="history-diff">
                      {diff?.tooLargeToDiff && (
                        <div className={styles.centered}>
                          This note is too large to show a word-by-word diff — view each version's Preview instead.
                        </div>
                      )}
                      {diff && !diff.tooLargeToDiff && !diffHasChanges(diff.ops) && (
                        <div className={styles.centered}>No text changes between this version and the current note.</div>
                      )}
                      {diff && !diff.tooLargeToDiff && diffHasChanges(diff.ops) && (
                        <p className={styles.diffText}>
                          {diff.ops.map((op, i) => {
                            if (op.type === 'equal') return <span key={i}>{op.text}</span>
                            if (op.type === 'removed') return <del key={i} className={styles.diffRemoved}>{op.text}</del>
                            return <ins key={i} className={styles.diffAdded}>{op.text}</ins>
                          })}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>

      {confirmingRestore && (
        <ConfirmModal
          title="Restore this version?"
          body="Your current content is saved to History first, so nothing is lost — you can always undo this by restoring again."
          confirmLabel="Restore"
          tone="primary"
          onConfirm={doRestore}
          onClose={() => setConfirmingRestore(false)}
        />
      )}
    </Sheet>
  )
}
