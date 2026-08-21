import { useEffect, useMemo, useRef, useState } from 'react'
import UIcon from '../../components/ui/UIcon'
import useSavedScreens from './hooks/useSavedScreens'
import { sharedScreenUrl } from './screenShareLink'
import { useUserDefinitions } from '../../hooks/useUserDefinitions'
import { scannableScreens } from '../../components/screener/SavedScreensPanel'
import styles from './ScannerPro.module.css'

// ScreensManager — replaces SaveScreenBar (commit A of the E-4 unification
// cutover, docs/superpowers/plans/2026-08-22-screener-wave4-e4-unification.md
// supersession #5). Same trigger, same share-panel behavior (copied verbatim
// from SaveScreenBar.jsx, which this file now supersedes), PLUS a second
// section listing the member's SCANNABLE formula definitions with a
// "Use as filter" action that adds the formula's hash to the `scan` filter.
//
// ─── 🔴 THE PUBLISH DOOR (carried verbatim from SaveScreenBar) ─────────────
//
// `saved_screens.update` mints `share_token` ONLY when a screen's owner sets
// `is_public`. NOTHING HERE PUBLISHES ANYTHING BY ITSELF — `create(name, spec)`
// still leaves `is_public` at its default false; `screenSharing.mount.test.jsx`
// is the rail (its owner-file list now names this component).
//
// ⛔ ERROR ≠ EMPTY (K7). `useSavedScreens`' fetcher now throws on a non-ok
// response, and `useUserDefinitions` already did — a refused read renders
// `data-testid="screens-manager-error"` (role=alert), never "None saved yet"
// or an empty scans list. The two pictures look identical and send a member
// to different fixes.
//
// ⛔ NO Details AFFORDANCE YET. Task 6 of the plan adds definition detail
// (ScanResults mounted under a picked row); a disabled stub here would be
// worse than nothing, so this commit omits it entirely.

const badgeStyle = {
  fontSize: 9, letterSpacing: '.5px', color: 'var(--text-muted)',
  border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px',
  marginLeft: 6, textTransform: 'uppercase', fontWeight: 600, verticalAlign: 'middle',
}

function TypeBadge({ children }) {
  return <span style={badgeStyle}>{children}</span>
}

/** The name a member gave a scan, or its handle, so a row is never blank.
 *  Mirrors `SavedScreensPanel`'s unexported `screenName` — small enough that
 *  duplicating the fallback chain here beats exporting a third name for it. */
function scanName(row) {
  const meta = row && row.definition && row.definition.meta
  const name = meta && typeof meta.name === 'string' ? meta.name.trim() : ''
  return name || (row && row.def_id) || 'Untitled screen'
}

export default function ScreensManager({ currentSpec, onApply, onUseScan }) {
  const { saved, starters, create, update, remove, error: savedError } = useSavedScreens()
  const { rows: defRows, error: defsError } = useUserDefinitions()
  const scans = useMemo(() => scannableScreens(defRows), [defRows])

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

  // ⭐ REVERSIBLE, AND THE SERVER MAKES IT SO — see SaveScreenBar's original
  // note: unpublishing stops every copy of the link resolving immediately, and
  // the token is kept on the row so re-publishing restores the SAME link.
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
            <div className={styles.saveMenuHdr}>My screens<TypeBadge>SCREEN</TypeBadge></div>
            {savedError ? (
              <p role="alert" data-testid="screens-manager-error" className={styles.saveMenuEmpty}>
                Your saved screens could not be read ({String(savedError.message || savedError)}).
              </p>
            ) : saved.length === 0 ? (
              <div className={styles.saveMenuEmpty}>None saved yet</div>
            ) : saved.map(s => (
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
                    {/* 🔴 THE DOOR. Opens the panel below; the panel is where
                        the member actually publishes. */}
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
                            DECIDES. */}
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

          <div className={styles.saveMenuSection}>
            <div className={styles.saveMenuHdr}>My scans<TypeBadge>SCAN</TypeBadge></div>
            {defsError ? (
              <p role="alert" data-testid="screens-manager-error" className={styles.saveMenuEmpty}>
                Your saved scans could not be read ({String(defsError.message || defsError)}).
              </p>
            ) : scans.length === 0 ? (
              <div className={styles.saveMenuEmpty}>No scannable formulas yet</div>
            ) : scans.map(row => {
              const name = scanName(row)
              return (
                <div key={row.def_id} className={styles.saveMenuItem}>
                  <span className={styles.saveMenuName}>{name}</span>
                  <span className={styles.saveMenuAct}>
                    <button type="button" aria-label={`Use ${name} as filter`}
                      onClick={() => onUseScan(row.ast_hash, name)}>
                      Use as filter
                    </button>
                  </span>
                </div>
              )
            })}
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
