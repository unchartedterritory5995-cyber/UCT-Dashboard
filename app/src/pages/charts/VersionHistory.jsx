// app/src/pages/charts/VersionHistory.jsx
//
// TERM-051 (FB-S5-02) — workspace version history as a member restore.
//
// The server half is TERM-021: `api/routers/workspace_doc.py` keeps every
// version of the Charts board (30 days OR the newest 200, hard ceiling 2000)
// and restores one by APPENDING a copy of it, compare-and-set on the head the
// member was looking at. The restore route also writes the restored values back
// into `user_preferences` under the SAME keys — that store is still the one the
// board reads — so after a 200 the client only has to RE-READ its preferences
// (`refreshPreferences`) and re-seed the board from them. Nothing here writes a
// preference itself.
//
// ⛔ DARK UNTIL `WORKSPACE_DOC_STORE_ENABLED` IS ARMED. While it is unset every
// route answers 404, and a control that cannot work is HIDDEN, not disabled:
// `VersionHistoryMenuItem` renders nothing until a probe of the versions route
// answers 200 with a list, and the panel renders nothing (and asks its host to
// close it) if the store goes dark while it is open.
//
// ⛔ A STALE BASE (409) IS NEVER RETRIED. The board changed after the list was
// loaded, so the version the member chose was compared against a head that is
// gone. The list is re-fetched and the member is told; they choose again.

import { useCallback, useEffect, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import styles from './VersionHistory.module.css'

export const WORKSPACE_DOC_URL = '/api/workspace/doc'
const BOARD = 'charts'
const LIST_LIMIT = 50

/** Member-facing names for the board's stored keys (`WORKSPACE_PREF_KEYS`).
 *  A key missing here is shown by its raw name rather than hidden. */
// Member-facing names for the board's persisted keys. The WORDS are written here; the
// KEY SET is not ours to choose -- `VersionHistory.keyLabels.test.js` holds it equal to
// `WORKSPACE_PREF_KEYS` in api/services/workspace_doc_store.py, both directions.
export const KEY_LABELS = {
  charts_workspace_layout: 'Board layout',
  charts_workspace_groups: 'Linked symbols',
  chart_settings: 'Chart settings',
  charts_theme: 'Charts theme',
  charts_merged: 'Merged widgets',
  charts_vol_pane_pct: 'Volume pane size',
  charts_active_template: 'Open layout name',
  watchlist_settings: 'Watchlist settings',
  watchlist_columns: 'Watchlist columns',
  theme_tracker_settings: 'Theme Tracker settings',
  fundamentals_settings: 'Fundamentals settings',
  breadth_widget_settings: 'Breadth settings',
  aisearch_settings: 'AI Search settings',
}

export function keyLabel(key) {
  return KEY_LABELS[key] || key
}

/** How a version came to exist, in the member's words. */
export function sourceLabel(v) {
  switch (v?.source) {
    case 'migration': return 'First saved copy of your board'
    case 'mirror': return 'Board saved'
    case 'write': return 'Board saved'
    case 'restore': return v.restored_from != null ? `Restored from version ${v.restored_from}` : 'Restored'
    case 'delete': return 'Board history cleared'
    default: return 'Saved'
  }
}

export function formatVersionTime(epochSeconds) {
  const d = new Date(Number(epochSeconds) * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** Which stored keys a restore of `target` would change, against `head`.
 *
 *  `changes` — keys the version holds with a value different from the head's.
 *  `kept`    — keys the head holds that the version does not; the restore route
 *              leaves those exactly as they are (it never deletes a key). */
export function diffPrefs(targetPrefs, headPrefs) {
  const t = targetPrefs || {}
  const h = headPrefs || {}
  const changes = Object.keys(t).sort().filter(k => h[k] !== t[k])
  const kept = Object.keys(h).sort().filter(k => !(k in t))
  return { changes, kept }
}

async function requestJson(url, init) {
  if (typeof fetch !== 'function') return { status: 0, ok: false, body: null }
  try {
    const res = await fetch(url, { credentials: 'include', ...(init || {}) })
    if (!res) return { status: 0, ok: false, body: null }
    let body = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, ok: !!res.ok, body }
  } catch {
    return { status: 0, ok: false, body: null }
  }
}

/** True only when the versions route answers with a list — i.e. the store is
 *  armed and this member can use it. Any other answer (404 dark, an error, no
 *  network) is false: the entry point then renders nothing. */
export async function probeVersionHistory() {
  const r = await requestJson(`${WORKSPACE_DOC_URL}/versions?board=${BOARD}&limit=1`)
  return r.ok && Array.isArray(r.body?.versions)
}

export function useVersionHistoryAvailable(active = true) {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!active) { setAvailable(false); return undefined }
    let alive = true
    probeVersionHistory().then(ok => { if (alive) setAvailable(ok) })
    return () => { alive = false }
  }, [active])
  return available
}

/** The entry in the Layouts menu. Renders NOTHING unless the store answers. */
export function VersionHistoryMenuItem({ className, onOpen }) {
  const available = useVersionHistoryAvailable(true)
  if (!available) return null
  return (
    <button type="button" className={className} onClick={onOpen} data-testid="version-history-open">
      <UIcon name="clock" size={14} gold={false} style={{ verticalAlign: '-2px', marginRight: 6 }} />
      Version history
    </button>
  )
}

const CONFLICT_COPY = 'Your board changed after this list was loaded, so nothing was restored. The list has been refreshed. Choose the version again.'
const GONE_COPY = 'That version is no longer available. The list has been refreshed.'
const FAILED_COPY = 'The restore did not go through. Try again in a moment.'

/**
 * The restore panel. `onRestored(result)` is called with the route's answer on
 * a 200; the HOST closes the panel and reports the outcome, because the message
 * must outlive this control. `onUnavailable()` is called when the store answers
 * 404 (dark): the panel renders nothing and the host should drop it.
 */
export default function VersionHistoryPanel({ onClose, onRestored, onUnavailable }) {
  const [phase, setPhase] = useState('loading') // loading | ready | error | dark
  const [versions, setVersions] = useState([])
  const [selected, setSelected] = useState(null)
  const [preview, setPreview] = useState(null)  // { version, changes, kept } | { version, error }
  const [panelNote, setPanelNote] = useState('')
  const [restoring, setRestoring] = useState(false)
  const docsRef = useRef(new Map())
  const aliveRef = useRef(true)
  useEffect(() => () => { aliveRef.current = false }, [])

  const load = useCallback(async () => {
    const r = await requestJson(`${WORKSPACE_DOC_URL}/versions?board=${BOARD}&limit=${LIST_LIMIT}`)
    if (!aliveRef.current) return false
    if (r.status === 404) { setPhase('dark'); onUnavailable?.(); return false }
    if (!r.ok || !Array.isArray(r.body?.versions)) { setPhase('error'); return false }
    setVersions(r.body.versions)
    setPhase('ready')
    return true
  }, [onUnavailable])

  useEffect(() => { load() }, [load])

  // Escape closes through the dialog's OWN onKeyDown (focus is moved into it on
  // open), never a raw document listener: TERM-063's census ratchets those.
  const cardRef = useRef(null)
  useEffect(() => { cardRef.current?.focus?.() }, [])
  const onCardKeyDown = useCallback((e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onClose?.() }
  }, [onClose])

  const head = versions[0] || null
  const headVersion = head ? head.version : 0

  const readDoc = useCallback(async (version) => {
    if (docsRef.current.has(version)) return docsRef.current.get(version)
    const r = await requestJson(`${WORKSPACE_DOC_URL}/versions/${version}?board=${BOARD}`)
    if (!r.ok || !r.body) return undefined
    const doc = r.body.tombstone ? null : (r.body.doc || null)
    docsRef.current.set(version, doc)
    return doc
  }, [])

  // A preview that arrives after the member picked another row is dropped.
  const chooseSeqRef = useRef(0)
  const choose = useCallback(async (v) => {
    const seq = ++chooseSeqRef.current
    setSelected(v.version)
    setPanelNote('')
    setPreview(null)
    const [target, current] = await Promise.all([
      readDoc(v.version),
      head && !head.tombstone ? readDoc(head.version) : Promise.resolve(null),
    ])
    if (!aliveRef.current || seq !== chooseSeqRef.current) return
    if (target === undefined || (current === undefined && head && !head.tombstone)) {
      setPreview({ version: v.version, error: true })
      return
    }
    setPreview({ version: v.version, ...diffPrefs(target?.prefs, current?.prefs) })
  }, [head, readDoc])

  const restore = useCallback(async () => {
    if (selected == null || restoring) return
    setRestoring(true)
    setPanelNote('')
    const r = await requestJson(`${WORKSPACE_DOC_URL}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version: selected, base_version: headVersion, board: BOARD }),
    })
    if (!aliveRef.current) return
    setRestoring(false)
    if (r.ok && r.body) { onRestored?.(r.body); return }
    if (r.status === 409) {
      chooseSeqRef.current += 1
      setSelected(null); setPreview(null); docsRef.current.clear()
      if (await load()) setPanelNote(CONFLICT_COPY)
      return
    }
    if (r.status === 404) {
      setSelected(null); setPreview(null); docsRef.current.clear()
      if (await load()) setPanelNote(GONE_COPY)
      return
    }
    setPanelNote(FAILED_COPY)
  }, [selected, restoring, headVersion, load, onRestored])

  if (phase === 'dark') return null

  return (
    <div className={styles.backdrop} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.() }}>
      <div
        ref={cardRef}
        className={styles.card}
        role="dialog"
        aria-modal="true"
        aria-labelledby="vh-title"
        tabIndex={-1}
        onKeyDown={onCardKeyDown}
      >
        <div className={styles.head}>
          <UIcon name="clock" size={16} gold={false} />
          <span id="vh-title" className={styles.title}>Version history</span>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close version history">
            <UIcon name="x" size={14} gold={false} />
          </button>
        </div>
        <p className={styles.lede}>
          Every save of this board is kept as a version. Restoring one puts it back as a new
          version, and nothing in this list is deleted.
        </p>
        {panelNote && <div className={styles.note} role="alert">{panelNote}</div>}
        {phase === 'loading' && <div className={styles.empty}>Loading versions…</div>}
        {phase === 'error' && <div className={styles.empty}>Versions could not be loaded. Try again in a moment.</div>}
        {phase === 'ready' && versions.length === 0 && (
          <div className={styles.empty}>No versions yet. One is kept each time your board is saved.</div>
        )}
        {phase === 'ready' && versions.length > 0 && (
          <ul className={styles.list} aria-label="Board versions">
            {versions.map((v) => {
              const isHead = v === head
              const when = formatVersionTime(v.created_at)
              const d = new Date(Number(v.created_at) * 1000)
              const iso = Number.isNaN(d.getTime()) ? '' : d.toISOString()
              const body = (
                <>
                  <span className={styles.rowMain}>
                    <span className={styles.rowTitle}>Version {v.version}</span>
                    {isHead && <span className={styles.badge}>Current</span>}
                  </span>
                  <span className={styles.rowMeta}>
                    <time dateTime={iso}>{when}</time>
                    <span aria-hidden="true"> · </span>
                    <span>{sourceLabel(v)}</span>
                  </span>
                </>
              )
              const restorable = !isHead && !v.tombstone
              return (
                <li key={v.version} className={styles.item}>
                  {restorable ? (
                    <button
                      type="button"
                      className={`${styles.row} ${selected === v.version ? styles.rowOn : ''}`}
                      aria-pressed={selected === v.version}
                      aria-label={`Version ${v.version}, ${when}, ${sourceLabel(v)}`}
                      onClick={() => choose(v)}
                    >{body}</button>
                  ) : (
                    <div className={`${styles.row} ${styles.rowStatic}`}>{body}</div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
        {preview && (
          <div className={styles.preview} aria-live="polite">
            {preview.error ? (
              <p>This version could not be read. Choose another, or try again in a moment.</p>
            ) : preview.changes.length === 0 ? (
              <p>Version {preview.version} matches your current board. There is nothing to restore.</p>
            ) : (
              <>
                <p>
                  Restoring version {preview.version} changes: {preview.changes.map(keyLabel).join(', ')}.
                </p>
                {preview.kept.length > 0 && (
                  <p className={styles.kept}>
                    Not in this version, so kept as they are now: {preview.kept.map(keyLabel).join(', ')}.
                  </p>
                )}
                <button type="button" className={styles.restore} onClick={restore} disabled={restoring}>
                  <UIcon name="refresh" size={14} gold={false} style={{ verticalAlign: '-2px', marginRight: 6 }} />
                  {restoring ? 'Restoring…' : `Restore version ${preview.version}`}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
