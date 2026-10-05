// UCT Terminal — version history of the member's terminal board (lane T2 / V2).
//
// The server half is TERM-021's `terminal` board (`api/routers/workspace_doc.py`): every
// layout write is a version; a restore APPENDS a copy of an older one, compare-and-set on the
// head the member was looking at, and writes it back into `user_preferences` under the same
// key. After a 200 the client only RE-READS its preferences (`refreshPreferences`).
//
// ⛔ DARK UNTIL `WORKSPACE_DOC_STORE_ENABLED` IS ARMED: every route answers 404 and this says
// so in one line instead of offering a control that cannot work. ⛔ A STALE BASE (409) IS
// NEVER RETRIED: the list is re-fetched and the member chooses again.
import { useCallback, useEffect, useState } from 'react'
import { refreshPreferences } from '../../hooks/usePreferences'
import styles from './TerminalShell.module.css'

export const TERMINAL_DOC_BOARD = 'terminal'
const BASE = '/api/workspace/doc'

export function versionWhen(epochSeconds) {
  const d = new Date(Number(epochSeconds) * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

export function versionLabel(v) {
  switch (v?.source) {
    case 'migration': return 'First saved copy of your terminal'
    case 'restore': return v.restored_from != null ? `Restored from version ${v.restored_from}` : 'Restored'
    case 'delete': return 'History cleared'
    default: return 'Terminal saved'
  }
}

async function getJson(url, init) {
  try {
    const res = await fetch(url, { credentials: 'include', ...(init || {}) })
    let body = null
    try { body = await res.json() } catch { body = null }
    return { status: res.status, ok: res.ok, body }
  } catch {
    return { status: 0, ok: false, body: null }
  }
}

export default function TerminalVersions({ onRestored }) {
  const [state, setState] = useState({ phase: 'loading', versions: [], message: null, refreshNotice: null })

  const load = useCallback(async (message = null) => {
    const r = await getJson(`${BASE}/versions?board=${TERMINAL_DOC_BOARD}&limit=20`)
    if (r.status === 404) { setState({ phase: 'dark', versions: [], message: null }); return }
    if (!r.ok || !Array.isArray(r.body?.versions)) {
      // A failed refresh must never overwrite a success message already in hand (e.g. a
      // restore that worked) — it is reported as a separate, lesser notice instead.
      if (message) { setState((s) => ({ ...s, phase: 'ready', message, refreshNotice: "Restored; couldn't refresh the list." })); return }
      setState({ phase: 'error', versions: [], message: 'Version history could not be loaded.' })
      return
    }
    setState({ phase: 'ready', versions: r.body.versions, message, refreshNotice: null })
  }, [])

  useEffect(() => { load() }, [load])

  const restore = async (version) => {
    const head = state.versions[0]?.version
    if (head == null) return
    setState((s) => ({ ...s, phase: 'restoring' }))
    const r = await getJson(`${BASE}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ board: TERMINAL_DOC_BOARD, version, base_version: head }),
    })
    if (r.status === 409) { await load('Your terminal changed since this list loaded. Choose again.'); return }
    if (!r.ok) { await load('That version could not be restored.'); return }
    const fresh = await refreshPreferences()
    await load(fresh ? `Restored version ${version}.` : `Restored version ${version}. Reload to see it.`)
    onRestored?.(version)
  }

  if (state.phase === 'loading') return <p className={styles.menuNote}>Loading version history…</p>
  if (state.phase === 'dark') {
    return <p className={styles.menuNote} data-testid="terminal-versions-dark">Version history is not switched on for this server yet.</p>
  }
  return (
    <div data-testid="terminal-versions">
      {state.message && <p className={styles.menuNote} role="status">{state.message}</p>}
      {state.refreshNotice && <p className={styles.menuNote} role="status" data-testid="terminal-versions-refresh-notice">{state.refreshNotice}</p>}
      <ul className={styles.menuList}>
        {state.versions.map((v, i) => (
          <li key={v.version} className={styles.menuRow}>
            <span className={styles.menuMain}>
              <span className={styles.code}>v{v.version}</span>
              <span className={styles.menuLabel}>{versionLabel(v)} · {versionWhen(v.created_at)}</span>
            </span>
            {i === 0 ? <span className={styles.menuHint}>current</span> : (
              <button type="button" className={styles.menuBtn} disabled={state.phase === 'restoring' || v.tombstone}
                title={v.tombstone ? "This version's content was cleared and can no longer be restored." : undefined}
                onClick={() => restore(v.version)} data-testid={`terminal-restore-${v.version}`}>Restore</button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
