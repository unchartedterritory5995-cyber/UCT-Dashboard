/**
 * DropboxFolderPicker — Task 12b, widened to OneDrive in Task 7 (msgraph
 * wave). Dropbox's (and now OneDrive's) OAuth callback creates the
 * connector WITHOUT a source ("Dropbox needs a FOLDER before a source can
 * exist" — `api/routers/note_sync.py`'s own comment; OneDrive is the
 * identical shape); this is the step that closes the gap: browse
 * `GET /{provider}/folders?path=` (non-recursive, scoped to
 * `_FOLDER_PICKER_PROVIDERS` server-side) and turn a pick into a real
 * source via `POST /{provider}/sources`.
 *
 * `provider`/`providerLabel` parameterize which folder-picker provider is
 * open — defaults to Dropbox (the original, still-only-caller-until-Task-7
 * shape) so every existing call site/test that doesn't pass them is
 * unaffected. OneNote is NOT a valid `provider` here (whole-account, no
 * folder concept — see `ConnectedAppsCard`'s `FOLDER_PICKER_PROVIDERS`
 * gate, which is what decides whether this ever opens for a given tile).
 *
 * `listFolders`/`addSource` are injected props (from `useNoteConnectors()`),
 * mirroring `ConnectTokenModal`'s `connectToken` prop — keeps this testable
 * in isolation and the parent owns the hook instance.
 *
 * Errors from the list call render inline with a "Try again" retry (mirrors
 * `ImportWizard`'s error-step wording) rather than a toast — a 401/409 means
 * "reconnect {providerLabel}", which the user needs to actually read.
 *
 * Fix-round CRITICAL: every folder row read off `listFolders()` (which
 * returns `useNoteConnectors.js::normalizeFolders`' output) is the
 * provider-neutral `{name, remoteId, drillPath}` shape now — `remoteId` is
 * what gets POSTed to create a source, `drillPath` is what's passed back to
 * `listFolders` when the user drills into that row. Drilling and picking
 * both key on those fields, NEVER a Dropbox-specific `pathLower` (the
 * previous shape, which every OneDrive folder normalized to the SAME empty
 * value — collapsing every row to one dup React key, re-listing the root on
 * every "drill", and POSTing an empty `remoteId` that the backend 400s).
 *
 * The footer "sync the whole account" button picks root — that needs its
 * OWN per-provider sentinel (`FOLDER_PICKER_ROOT_REMOTE_ID`, see that
 * constant's own comment for why OneDrive doesn't have one yet).
 */
import { useCallback, useEffect, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import { FOLDER_PICKER_ROOT_REMOTE_ID } from '../../hooks/useNoteConnectors'
import styles from './DropboxFolderPicker.module.css'

export default function DropboxFolderPicker({
  open, onClose, listFolders, addSource, onPicked, provider = 'dropbox', providerLabel = 'Dropbox',
}) {
  const [path, setPath] = useState('') // '' = the provider's root
  const [crumbs, setCrumbs] = useState([]) // [{path, name}] — each entry's OWN path
  const [folders, setFolders] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(
    async (p) => {
      setLoading(true)
      setError(null)
      try {
        const list = await listFolders(provider, p)
        setFolders(list)
      } catch (err) {
        setError(err?.detail || err?.message || `Could not load your ${providerLabel} folders.`)
      } finally {
        setLoading(false)
      }
    },
    [listFolders, provider, providerLabel]
  )

  // Fresh state every time the picker opens — mirrors ConnectTokenModal.
  useEffect(() => {
    if (!open) return
    setPath('')
    setCrumbs([])
    setFolders([])
    setError(null)
    setBusy(false)
    load('')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, provider])

  const handleClose = () => {
    if (busy) return
    onClose?.()
  }

  const openFolder = (folder) => {
    setCrumbs((prev) => [...prev, { path: folder.drillPath, name: folder.name }])
    setPath(folder.drillPath)
    load(folder.drillPath)
  }

  const goToRoot = () => {
    setCrumbs([])
    setPath('')
    load('')
  }

  const goToCrumb = (idx) => {
    const target = crumbs[idx]
    setCrumbs((prev) => prev.slice(0, idx + 1))
    setPath(target.path)
    load(target.path)
  }

  // Fix-round item #2: the ROOT case (`path === ''`, nothing drilled into
  // yet) needs a provider-specific sentinel, not the bare (empty) `path`
  // state — an empty string is indistinguishable from "missing" everywhere
  // downstream (the router's own `if not remote_id: 400`), which is why
  // "sync my whole Dropbox" 400ed even for Dropbox before this fix. A
  // DRILLED folder's `path` is already a valid remoteId (drillPath ===
  // remoteId per provider, see the module docstring), so only the root case
  // needs the sentinel lookup.
  const rootRemoteId = FOLDER_PICKER_ROOT_REMOTE_ID[provider]
  const rootPickUnsupported = path === '' && !rootRemoteId

  const pick = async (folder) => {
    if (busy || (!folder && rootPickUnsupported)) return
    setBusy(true)
    setError(null)
    try {
      const remoteId = folder ? folder.remoteId : (path === '' ? rootRemoteId : path)
      const displayName = folder
        ? folder.name
        : path === ''
          ? `${providerLabel} (root)`
          : crumbs[crumbs.length - 1]?.name || path
      await addSource(provider, { remoteId, displayName })
      onPicked?.()
      onClose?.()
    } catch (err) {
      setError(err?.detail || err?.message || 'Could not connect that folder.')
    } finally {
      setBusy(false)
    }
  }

  const currentLabel = rootPickUnsupported
    ? `Pick a folder below to sync — ${providerLabel} doesn't support syncing the whole account yet`
    : path === ''
      ? `Sync my whole ${providerLabel}`
      : `Sync "${crumbs[crumbs.length - 1]?.name || path}"`

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      variant="auto"
      title={`Choose a ${providerLabel} folder`}
      maxWidth={480}
      dismissOnBackdrop={!busy}
    >
      <div className={styles.wrap}>
        <p className={styles.hint}>Pick the folder to sync — everything inside comes along.</p>

        <div className={styles.crumbs}>
          <button type="button" className={styles.crumbBtn} onClick={goToRoot} disabled={path === ''}>
            {providerLabel}
          </button>
          {crumbs.map((c, i) => (
            <span key={c.path}>
              <span className={styles.crumbSep}>/</span>
              <button
                type="button"
                className={styles.crumbBtn}
                onClick={() => goToCrumb(i)}
                disabled={i === crumbs.length - 1}
              >
                {c.name}
              </button>
            </span>
          ))}
        </div>

        {error && (
          <div className={styles.error} role="alert">
            <span>{error}</span>
            <button type="button" className={styles.retryBtn} onClick={() => load(path)} disabled={loading}>
              Try again
            </button>
          </div>
        )}

        {loading ? (
          <p className={styles.muted}>Loading folders…</p>
        ) : (
          <ul className={styles.list}>
            {folders.length === 0 && !error && <li className={styles.muted}>No subfolders here.</li>}
            {folders.map((f) => (
              <li key={f.remoteId} className={styles.row}>
                <button type="button" className={styles.folderBtn} onClick={() => openFolder(f)}>
                  <UIcon name="library" size={14} gold={false} />
                  {f.name}
                </button>
                <button type="button" className={styles.pickBtn} disabled={busy} onClick={() => pick(f)}>
                  {busy ? 'Connecting…' : 'Sync this folder'}
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className={styles.footerRow}>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={busy || rootPickUnsupported}
            onClick={() => pick(null)}
          >
            {busy ? 'Connecting…' : currentLabel}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
