// app/src/components/chart/builder/pineEditor/MyScripts.jsx
//
// ─── A3 / A4 — "MY SCRIPTS": the member's own Pine, reopened ────────────────
//
// Lists every stored definition that carries a Pine source (the store's LIST
// answers with a `pine_source` summary, never the text), and offers: Open (into
// the editor, where Apply then UPDATES that definition in place), Rename,
// Duplicate (A6: a new definition carrying the same script, opened), Versions
// (every stored version, oldest first, with Restore) and Delete.
//
// ⛔ EVERY WRITE GOES THROUGH THE HOST, which walks the sheet's own store doors
// (`validateUserDefinitions` → `saveUserDefinition` → `installUserDefinitions`).
// This panel holds no save path of its own.
//
// ⛔ DELETE IS SOFT AND ASKS FIRST: the store appends a tombstone (history stays
// readable), and the row arms before it fires — the sheet's rule for a formula
// ("DELETE ASKS FIRST"), applied here. RESTORE APPENDS: restoring version 2 of 5
// writes version 6 carrying version 2's script, so nothing is ever overwritten.

import { useCallback, useMemo, useState } from 'react'
import { fetchDefinitionHistory } from '../../../../hooks/useUserDefinitions'
import { pineScriptsOf, pineSourceOf } from './pineScripts'
import styles from './PineEditor.module.css'

const when = (ts) => {
  if (!ts) return ''
  try {
    return new Date(ts * 1000).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    })
  } catch { return '' }
}

function ScriptRow({ s, active, onOpen, onRename, onDelete, onRestore, onDuplicate, loadHistory }) {
  const [mode, setMode] = useState(null)          // null | 'rename' | 'delete' | 'versions'
  const [draft, setDraft] = useState(s.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [versions, setVersions] = useState(null)

  const run = useCallback(async (fn) => {
    setBusy(true); setError(null)
    let res = null
    try { res = await fn() } catch { res = { ok: false, error: 'Could not reach the store. Nothing was changed.' } }
    setBusy(false)
    if (!res || !res.ok) {
      setError((res && typeof res.error === 'string' && res.error.trim()) || 'The store refused this change.')
      return false
    }
    return true
  }, [])

  const openVersions = useCallback(async () => {
    setMode('versions'); setVersions(null); setError(null)
    const r = await loadHistory(s.defId)
    if (!r || !r.ok) { setError((r && r.error) || 'The version history could not be read.'); return }
    setVersions(r.versions || [])
  }, [loadHistory, s.defId])

  return (
    <li className={styles.script} data-testid="pine-script-row" data-def-id={s.defId}
      data-active={active ? 'true' : 'false'}>
      <div className={styles.scriptHead}>
        <span className={styles.scriptName}>{s.name}</span>
        <span className={styles.scriptMeta}>v{s.version}{s.savedAt ? ` · ${when(s.savedAt)}` : ''}</span>
      </div>
      <div className={styles.scriptActions}>
        <button type="button" className={styles.ghost} disabled={busy || active}
          onClick={() => onOpen(s.defId)} data-testid="pine-script-open">
          {active ? 'Editing' : 'Open'}
        </button>
        <button type="button" className={styles.ghost} disabled={busy}
          onClick={() => { setDraft(s.name); setMode(mode === 'rename' ? null : 'rename') }}
          data-testid="pine-script-rename">Rename</button>
        {onDuplicate && (
          <button type="button" className={styles.ghost} disabled={busy}
            onClick={() => { setMode(null); run(() => onDuplicate(s.defId)) }}
            data-testid="pine-script-duplicate">Duplicate</button>
        )}
        <button type="button" className={styles.ghost} disabled={busy}
          onClick={() => (mode === 'versions' ? setMode(null) : openVersions())}
          data-testid="pine-script-versions">Versions</button>
        <button type="button" className={styles.ghost} disabled={busy}
          onClick={() => setMode(mode === 'delete' ? null : 'delete')}
          data-testid="pine-script-delete">Delete</button>
      </div>

      {mode === 'rename' && (
        <form className={styles.inline} onSubmit={async (e) => {
          e.preventDefault()
          if (await run(() => onRename(s.defId, draft))) setMode(null)
        }}>
          <input className={styles.nameInput} value={draft} maxLength={40} aria-label={`New name for ${s.name}`}
            onChange={(e) => setDraft(e.target.value)} data-testid="pine-script-rename-input" />
          <button type="submit" className={styles.apply} disabled={busy || !draft.trim()}
            data-testid="pine-script-rename-save">Save name</button>
        </form>
      )}
      {mode === 'delete' && (
        <div className={styles.inline} role="group" aria-label={`Delete ${s.name}?`}>
          <span className={styles.note}>Delete “{s.name}”? Its versions stay in your history.</span>
          <button type="button" className={styles.danger} disabled={busy}
            onClick={async () => { if (await run(() => onDelete(s.defId))) setMode(null) }}
            data-testid="pine-script-delete-confirm">Delete script</button>
          <button type="button" className={styles.ghost} onClick={() => setMode(null)}>Keep</button>
        </div>
      )}
      {mode === 'versions' && (
        <div data-testid="pine-script-history">
          {!versions && !error && <p className={styles.note}>Reading versions…</p>}
          {versions && (
            <ol className={styles.versions}>
              {versions.map((v) => {
                const src = pineSourceOf(v.definition)
                const current = v.version === s.version
                return (
                  <li key={v.version} data-testid="pine-script-version" data-version={v.version}>
                    <span>{`v${v.version}`}{v.created_at ? ` · ${when(v.created_at)}` : ''}</span>
                    {v.deleted_at && <span className={styles.scriptMeta}> · deleted</span>}
                    {!src && !v.deleted_at && <span className={styles.scriptMeta}> · no script kept</span>}
                    {current && <span className={styles.scriptMeta}> · current</span>}
                    {!current && !v.deleted_at && src && (
                      <button type="button" className={styles.ghost} disabled={busy}
                        onClick={async () => { if (await run(() => onRestore(s.defId, v))) setMode(null) }}
                        data-testid="pine-script-restore">Restore</button>
                    )}
                  </li>
                )
              })}
            </ol>
          )}
        </div>
      )}
      {error && <p className={styles.err} role="alert" data-testid="pine-script-error">{error}</p>}
    </li>
  )
}

/**
 * @param {object[]} rows          the store's LIST rows (`useUserDefinitions().rows`)
 * @param {string|null} activeDefId the script open in the editor, if any
 * @param {Function} onOpen        (defId) => Promise<{ok, error?}>
 * @param {Function} onRename      (defId, name) => Promise<{ok, error?}>
 * @param {Function} onDelete      (defId) => Promise<{ok, error?}>
 * @param {Function} onRestore     (defId, versionRow) => Promise<{ok, error?}>
 * @param {Function} [onDuplicate] (defId) => Promise<{ok, error?}> — A6: a copy, opened
 */
export default function MyScripts({
  rows = [], activeDefId = null, onOpen, onRename, onDelete, onRestore, onDuplicate = null,
  loadHistory = fetchDefinitionHistory,
}) {
  const scripts = useMemo(() => pineScriptsOf(rows), [rows])
  const [open, setOpen] = useState(false)
  const [openError, setOpenError] = useState(null)
  const doOpen = useCallback(async (defId) => {
    setOpenError(null)
    let res = null
    try { res = await onOpen(defId) } catch { res = { ok: false, error: 'Could not reach the store.' } }
    if (!res || !res.ok) setOpenError((res && res.error) || 'This script could not be opened.')
    else setOpen(false)
  }, [onOpen])

  return (
    <section className={styles.scripts} aria-label="My scripts" data-testid="pine-my-scripts">
      <button type="button" className={styles.scriptsToggle} aria-expanded={open}
        onClick={() => setOpen((o) => !o)} data-testid="pine-my-scripts-toggle">
        {`My scripts (${scripts.length})`}
      </button>
      {openError && <p className={styles.err} role="alert" data-testid="pine-my-scripts-error">{openError}</p>}
      {open && (scripts.length === 0 ? (
        <p className={styles.note} data-testid="pine-my-scripts-empty">
          Scripts you add to a chart from this editor are kept here, with their code, so you
          can come back to them.
        </p>
      ) : (
        <ul className={styles.scriptList}>
          {scripts.map((s) => (
            <ScriptRow key={s.defId} s={s} active={s.defId === activeDefId}
              onOpen={doOpen} onRename={onRename} onDelete={onDelete} onRestore={onRestore}
              onDuplicate={onDuplicate} loadHistory={loadHistory} />
          ))}
        </ul>
      ))}
    </section>
  )
}
