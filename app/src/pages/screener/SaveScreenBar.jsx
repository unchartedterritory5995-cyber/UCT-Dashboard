import { useState, useRef, useEffect } from 'react'
import UIcon from '../../components/ui/UIcon'
import useSavedScreens from './hooks/useSavedScreens'
import { sharedScreenUrl } from './screenShareLink'
import styles from './ScannerPro.module.css'

// Prompt-free saved-screens menu: starters + saved (apply / share / rename /
// delete) + an inline "save current" input.
//
// ─── 🔴 THE PUBLISH DOOR ────────────────────────────────────────────────────
//
// `saved_screens.update` mints `share_token = secrets.token_urlsafe(8)` ONLY
// when a screen's owner sets `is_public`, and `GET /api/screener/shared/{token}`
// has been served the whole time. Until this control existed, **`is_public` was
// never sent true from anywhere in the app** — so no token was ever minted, and
// a complete public-sharing backend was unreachable by construction
// (`.superpowers/sdd/audit/reachability-report.md` §3a).
//
// ⛔ NOTHING HERE PUBLISHES ANYTHING BY ITSELF. `create(name, spec)` still
// leaves `is_public` at its default false — see the rail
// `screenSharing.mount.test.jsx`, which asserts the create payload does NOT
// carry a true `is_public`. Publishing is one deliberate click, on one named
// screen, and the same control takes it back.
export default function SaveScreenBar({ currentSpec, onApply }) {
  const { saved, starters, create, update, remove } = useSavedScreens()
  const [open, setOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [renameId, setRenameId] = useState(null)
  const [renameVal, setRenameVal] = useState('')
  const [shareId, setShareId] = useState(null)
  const [copied, setCopied] = useState(false)
  const wrapRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const apply = s => { onApply(s.spec); setOpen(false) }
  const saveCurrent = async () => {
    const name = newName.trim()
    if (!name) return
    await create(name, currentSpec)
    setNewName('')
  }
  const commitRename = async id => {
    const name = renameVal.trim()
    if (name) await update(id, { name })
    setRenameId(null); setRenameVal('')
  }

  // ⭐ REVERSIBLE, AND THE SERVER MAKES IT SO. `get_public` filters on
  // `is_public=1`, so unpublishing stops every copy of the link resolving
  // immediately. ⚠️ The token itself is KEPT on the row, so re-publishing the
  // same screen restores the SAME link rather than minting a new one — which is
  // why the panel says "stops working" and not "is destroyed".
  const setPublic = async (id, isPublic) => {
    setCopied(false)
    await update(id, { is_public: isPublic })
  }

  const copyLink = async url => {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
    } catch {
      // Clipboard is permission-gated and absent over plain http. The input
      // below is selectable, so the link is still gettable by hand — a failed
      // copy must not read as a failed share.
      setCopied(false)
    }
  }

  return (
    <div className={styles.saveMenuWrap} ref={wrapRef}>
      <button type="button" className={styles.saveBtn} onClick={() => setOpen(o => !o)}>
        Screens ▾
      </button>
      {open && (
        <div className={styles.saveMenuPop} role="menu">
          {starters.length > 0 && (
            <div className={styles.saveMenuSection}>
              <div className={styles.saveMenuHdr}>Starters</div>
              {starters.map(s => (
                <div key={s.id} className={styles.saveMenuItem}>
                  <button type="button" className={styles.saveMenuName} onClick={() => apply(s)}>{s.name}</button>
                </div>
              ))}
            </div>
          )}
          <div className={styles.saveMenuSection}>
            <div className={styles.saveMenuHdr}>My screens</div>
            {saved.length === 0 && <div className={styles.saveMenuEmpty}>None saved yet</div>}
            {saved.map(s => (
              <div key={s.id}>
                <div className={styles.saveMenuItem}>
                  {renameId === s.id ? (
                    <input className={styles.saveMenuInput} autoFocus value={renameVal}
                      onChange={e => setRenameVal(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && commitRename(s.id)}
                      onBlur={() => commitRename(s.id)} />
                  ) : (
                    <button type="button" className={styles.saveMenuName} onClick={() => apply(s)}>{s.name}</button>
                  )}
                  <span className={styles.saveMenuAct}>
                    {/* 🔴 THE DOOR. Opens the panel below; the panel is where the
                        member actually publishes. Two steps on purpose — sharing
                        is outward-facing and a one-click publish sitting beside
                        Rename and Delete is a mis-click away from public. */}
                    <button type="button" aria-label={`Share ${s.name}`}
                      aria-expanded={shareId === s.id}
                      onClick={() => { setShareId(id => (id === s.id ? null : s.id)); setCopied(false) }}>
                      <UIcon name={s.is_public ? 'globe' : 'link'} size={12} />
                    </button>
                    <button type="button" aria-label={`Rename ${s.name}`}
                      onClick={() => { setRenameId(s.id); setRenameVal(s.name) }}>✎</button>
                    <button type="button" aria-label={`Delete ${s.name}`}
                      onClick={() => remove(s.id)}>✕</button>
                  </span>
                </div>

                {shareId === s.id && (
                  <div className={styles.sharePanel} data-testid={`share-panel-${s.id}`}>
                    {s.is_public && s.share_token ? (
                      <>
                        <div className={styles.shareState}>
                          <UIcon name="globe" size={11} /> Anyone with this link can open it
                        </div>
                        <div className={styles.shareLinkRow}>
                          <input className={styles.saveMenuInput} readOnly
                            aria-label={`Share link for ${s.name}`}
                            value={sharedScreenUrl(s.share_token)}
                            onFocus={e => e.target.select()} />
                          <button type="button" className={styles.saveBtn}
                            onClick={() => copyLink(sharedScreenUrl(s.share_token))}>
                            <UIcon name={copied ? 'check' : 'copy'} size={12} />{' '}
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        {/* ⭐ WHAT THE RECIPIENT SEES, STATED WHERE THE MEMBER
                            DECIDES. The server sends a filter spec and nothing
                            else, and the person publishing should not have to
                            read the router to know that. */}
                        <p className={styles.shareNote}>
                          They see this screen&rsquo;s <strong>filters</strong> only — no results,
                          no watchlist, no positions. Running it needs their own plan.
                        </p>
                        <button type="button" className={styles.shareUnpublish}
                          onClick={() => setPublic(s.id, false)}>
                          <UIcon name="lock" size={11} /> Unpublish — the link stops working
                        </button>
                      </>
                    ) : (
                      <>
                        <div className={styles.shareState}>
                          <UIcon name="lock" size={11} /> Private — only you can see this screen
                        </div>
                        <p className={styles.shareNote}>
                          Publishing creates a secret link. Whoever opens it sees this
                          screen&rsquo;s <strong>filters</strong> only — no results, no watchlist,
                          no positions — and running it needs their own plan. You can
                          unpublish at any time.
                        </p>
                        <button type="button" className={styles.saveBtn}
                          onClick={() => setPublic(s.id, true)}>
                          <UIcon name="link" size={12} /> Publish a share link
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className={styles.saveMenuFoot}>
            <input className={styles.saveMenuInput} placeholder="Name this screen…"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && saveCurrent()} />
            <button type="button" className={styles.saveBtn} onClick={saveCurrent}>Save current</button>
          </div>
        </div>
      )}
    </div>
  )
}
