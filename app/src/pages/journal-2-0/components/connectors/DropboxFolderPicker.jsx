/**
 * DropboxFolderPicker — Task 12b. Dropbox's OAuth callback creates the
 * connector WITHOUT a source ("Dropbox needs a FOLDER before a source can
 * exist" — `api/routers/note_sync.py`'s own comment); this is the step that
 * closes the gap: browse `GET /{provider}/folders?path=` (non-recursive,
 * Dropbox-only) and turn a pick into a real source via
 * `POST /{provider}/sources`.
 *
 * `listFolders`/`addSource` are injected props (from `useNoteConnectors()`),
 * mirroring `ConnectTokenModal`'s `connectToken` prop — keeps this testable
 * in isolation and the parent owns the hook instance.
 *
 * Errors from the list call render inline with a "Try again" retry (mirrors
 * `ImportWizard`'s error-step wording) rather than a toast — a 401/409 means
 * "reconnect Dropbox", which the user needs to actually read.
 */
import { useCallback, useEffect, useState } from 'react'
import Sheet from '../../../../components/mobile/Sheet'
import UIcon from '../../../../components/ui/UIcon'
import styles from './DropboxFolderPicker.module.css'

export default function DropboxFolderPicker({ open, onClose, listFolders, addSource, onPicked }) {
  const [path, setPath] = useState('') // '' = Dropbox root
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
        const list = await listFolders('dropbox', p)
        setFolders(list)
      } catch (err) {
        setError(err?.detail || err?.message || 'Could not load your Dropbox folders.')
      } finally {
        setLoading(false)
      }
    },
    [listFolders]
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
  }, [open])

  const handleClose = () => {
    if (busy) return
    onClose?.()
  }

  const openFolder = (folder) => {
    setCrumbs((prev) => [...prev, { path: folder.pathLower, name: folder.name }])
    setPath(folder.pathLower)
    load(folder.pathLower)
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

  const pick = async (folder) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const remoteId = folder ? folder.pathLower : path
      const displayName = folder
        ? folder.name
        : path === ''
          ? 'Dropbox (root)'
          : crumbs[crumbs.length - 1]?.name || path
      await addSource('dropbox', { remoteId, displayName })
      onPicked?.()
      onClose?.()
    } catch (err) {
      setError(err?.detail || err?.message || 'Could not connect that folder.')
    } finally {
      setBusy(false)
    }
  }

  const currentLabel = path === '' ? 'Sync my whole Dropbox' : `Sync "${crumbs[crumbs.length - 1]?.name || path}"`

  return (
    <Sheet
      open={open}
      onClose={handleClose}
      variant="auto"
      title="Choose a Dropbox folder"
      maxWidth={480}
      dismissOnBackdrop={!busy}
    >
      <div className={styles.wrap}>
        <p className={styles.hint}>Pick the folder to sync — everything inside comes along.</p>

        <div className={styles.crumbs}>
          <button type="button" className={styles.crumbBtn} onClick={goToRoot} disabled={path === ''}>
            Dropbox
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
              <li key={f.pathLower} className={styles.row}>
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
          <button type="button" className={styles.primaryBtn} disabled={busy} onClick={() => pick(null)}>
            {busy ? 'Connecting…' : currentLabel}
          </button>
        </div>
      </div>
    </Sheet>
  )
}
