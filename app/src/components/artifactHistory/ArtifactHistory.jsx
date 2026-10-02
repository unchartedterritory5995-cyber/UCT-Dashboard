// app/src/components/artifactHistory/ArtifactHistory.jsx
//
// COV-06 — version history on a member's own saved screens and named layouts.
//
// The server half is `api/routers/artifact_versions.py`: every save of the
// artefact is kept as a version (newest 10), and a restore puts an old version
// back AS A NEW VERSION, compare-and-set on the head this list was read at.
// Nothing in the list is ever removed by a restore, so a restore is undone by
// restoring the version before it.
//
// ⛔ DARK UNTIL `ARTIFACT_VERSIONS_ENABLED` IS ARMED. Every route answers 404
// while it is unset, and a control that cannot work is HIDDEN, not disabled:
// `useArtifactVersionsAvailable` is false unless the status probe answers 200,
// and the panel renders nothing (and tells its host) if the list answers 404.
//
// ⛔ A STALE BASE (409) IS NEVER RETRIED: the list is re-read and the member is
// told; they choose again. No read here ever writes.

import { useCallback, useEffect, useRef, useState } from 'react'
import styles from './ArtifactHistory.module.css'

export const ARTIFACT_VERSIONS_URL = '/api/artifact-versions'

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

/** True only when the status route answers 200 — the store is armed. */
export async function probeArtifactVersions() {
  const r = await requestJson(`${ARTIFACT_VERSIONS_URL}/status`)
  return r.ok && r.body?.enabled === true
}

export function useArtifactVersionsAvailable(active = true) {
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!active) { setAvailable(false); return undefined }
    let alive = true
    probeArtifactVersions().then(ok => { if (alive) setAvailable(ok) })
    return () => { alive = false }
  }, [active])
  return available
}

/** How a version came to exist, in the member's words. */
export function versionSourceLabel(v) {
  switch (v?.source) {
    case 'baseline': return 'As it was before this history began'
    case 'restore': return v.restored_from != null ? `Restored from version ${v.restored_from}` : 'Restored'
    default: return 'Saved'
  }
}

export function formatVersionTime(epochSeconds) {
  const d = new Date(Number(epochSeconds) * 1000)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const CONFLICT_COPY = 'This changed after the list was loaded, so nothing was restored. The list has been refreshed. Choose the version again.'
const GONE_COPY = 'That version is no longer available. The list has been refreshed.'
const FAILED_COPY = 'The restore did not go through. Try again in a moment.'

/**
 * The history list for one artefact. `kind` is 'screen' or 'layout'.
 * `onRestored(result)` gets the route's answer (`result.artifact` is the
 * artefact as it now stands). `onUnavailable()` fires on a 404 (dark, or the
 * artefact is gone); the panel then renders nothing. `refreshKey` re-reads the
 * list when the host saved the artefact itself.
 */
export default function ArtifactHistory({ kind, artifactId, title, refreshKey = 0, onRestored, onUnavailable, children }) {
  const [phase, setPhase] = useState('loading') // loading | ready | error | dark
  const [versions, setVersions] = useState([])
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const aliveRef = useRef(true)
  useEffect(() => { aliveRef.current = true; return () => { aliveRef.current = false } }, [])

  const base = `${ARTIFACT_VERSIONS_URL}/${kind}/${encodeURIComponent(artifactId)}`

  const load = useCallback(async () => {
    const r = await requestJson(base)
    if (!aliveRef.current) return false
    if (r.status === 404) { setPhase('dark'); onUnavailable?.(); return false }
    if (!r.ok || !Array.isArray(r.body?.versions)) { setPhase('error'); return false }
    setVersions(r.body.versions)
    setPhase('ready')
    return true
  }, [base, onUnavailable])

  useEffect(() => { load() }, [load, refreshKey])

  const headVersion = versions[0]?.version ?? 0

  const restore = useCallback(async (version) => {
    if (busy) return
    setBusy(true)
    setNote('')
    const r = await requestJson(`${base}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ version, base_version: headVersion }),
    })
    if (!aliveRef.current) return
    setBusy(false)
    if (r.ok && r.body) {
      await load()
      if (!aliveRef.current) return
      setNote(r.body.appended
        ? `Restored version ${version}. To undo, restore version ${headVersion}.`
        : `Version ${version} is already what is saved. Nothing changed.`)
      onRestored?.(r.body)
      return
    }
    if (r.status === 409) { if (await load()) setNote(CONFLICT_COPY); return }
    if (r.status === 404) { if (await load()) setNote(GONE_COPY); return }
    setNote(FAILED_COPY)
  }, [busy, base, headVersion, load, onRestored])

  if (phase === 'dark') return null

  return (
    <section className={styles.panel} aria-label={title || 'Version history'} data-testid={`artifact-history-${kind}-${artifactId}`}>
      <div className={styles.head}>{title || 'Version history'}</div>
      <p className={styles.lede}>
        The last 10 saves are kept. Restoring one saves it again as the newest
        version, so nothing here is lost and a restore can be undone.
      </p>
      {children}
      {note && <div className={styles.note} role="status">{note}</div>}
      {phase === 'loading' && <div className={styles.empty}>Loading versions…</div>}
      {phase === 'error' && <div className={styles.empty} role="alert">Versions could not be loaded. Try again in a moment.</div>}
      {phase === 'ready' && versions.length === 0 && (
        <div className={styles.empty}>No versions yet. One is kept each time this is saved.</div>
      )}
      {phase === 'ready' && versions.length > 0 && (
        <ol className={styles.list}>
          {versions.map((v, i) => (
            <li key={v.version} className={styles.row} data-testid={`artifact-version-${v.version}`}>
              <span className={styles.num}>v{v.version}</span>
              <span className={styles.meta}>
                <span className={styles.when}>{formatVersionTime(v.created_at)}</span>
                <span className={styles.what}>{versionSourceLabel(v)}{v.label ? ` · ${v.label}` : ''}</span>
              </span>
              {i === 0 ? (
                <span className={styles.current}>Current</span>
              ) : (
                <button
                  type="button"
                  className={styles.restore}
                  disabled={busy}
                  aria-label={`Restore version ${v.version}`}
                  onClick={() => restore(v.version)}
                >Restore</button>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
