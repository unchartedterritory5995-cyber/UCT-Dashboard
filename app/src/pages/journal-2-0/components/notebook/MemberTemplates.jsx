/**
 * Wave 6 (lane E, item 3) — "Your templates", the member's own section of the
 * template picker: pick one to make a note from it, or rename / delete it.
 *
 * ⛔ Rename and Delete sit BESIDE the template's card button, never inside it
 * (a button in a button is one control to a screen reader). Delete asks once,
 * in words, before it acts — a template is the member's own work and there is
 * no trash for it. Every failure is a sentence on screen, never a silent no-op.
 *
 * Wave 10 lane DR-C (design finding D-4): two additions, both optional so a
 * caller that omits them sees byte-identical behaviour (the a11y rail renders
 * this component bare, with neither prop):
 *   * `query` — the gallery's search text (already lower-cased and trimmed by
 *     the caller); filters this section's cards by name, never hides the
 *     "Daily notes start from" preference control or the empty-state copy;
 *   * `onPreview(payload | null)` — opens the SAME TemplatePreview.jsx the
 *     built-in cards use. The full body isn't in this component's own list
 *     (only names are, by design — see memberTemplates.js), so Preview reads
 *     it once via `getMemberTemplate`; "Use this template" from inside the
 *     preview hands `onPick` that SAME already-fetched record (not the bare
 *     summary the card itself carries), so the caller's own read -- the one
 *     `onPick`'s caller makes when a card is clicked directly -- is skipped
 *     rather than repeating a GET this component already made. Creation still
 *     goes through the one door this component has always used.
 *
 * Wave 12 lane 12A: a "Share" action beside Rename/Delete opens GalleryPublishForm,
 * which submits a COPY of the template to the community gallery for review. It is
 * rendered only while notebook_template_gallery_enabled is LATCHED on, so with the
 * gate off this component is byte-for-byte what it was.
 */
import { useState } from 'react'
import {
  deleteMemberTemplate, getMemberTemplate, renameMemberTemplate, useMemberTemplates,
} from '../../lib/memberTemplates'
import { DAILY_TEMPLATE_PREF } from '../../lib/dailyNote'
import usePreferences from '../../../../hooks/usePreferences'
import UIcon from '../../../../components/ui/UIcon'
import { templateGalleryEnabled } from '../../lib/templateGallery'
import GalleryPublishForm from './GalleryPublishForm'
import styles from './TemplatePicker.module.css'

export default function MemberTemplates({ onPick, busy = false, query = '', onPreview = () => {} }) {
  const { templates, error, isLoading } = useMemberTemplates()
  const [renaming, setRenaming] = useState(null) // { id, draft }
  const [confirmDelete, setConfirmDelete] = useState(null) // id
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState(null) // { text, tone }
  const [sharing, setSharing] = useState(null) // id of the template being shared to the gallery
  const galleryOn = templateGalleryEnabled()
  const q = query.trim().toLowerCase()
  const visible = q ? templates.filter((t) => t.name.toLowerCase().includes(q)) : templates

  const openPreview = async (t) => {
    const base = { label: t.name, subtitle: t.title && t.title !== t.name ? t.title : null }
    onPreview({ ...base, body: null, loading: true, onUse: () => {} })
    try {
      const full = await getMemberTemplate(t.id)
      onPreview({ ...base, body: full.bodyJson, onUse: () => { onPreview(null); onPick(full) } })
    } catch (e) {
      onPreview({ ...base, body: null, loadError: e?.message || "Couldn't load this template.", onUse: () => {} })
    }
  }
  // Wave 6 (item 4): which of these makes each new daily note (a preference).
  // A template deleted since needs no guard here: a <select> shows its first
  // option ("A blank page") for a value it does not have, and Today itself says
  // the template is gone (the server's `templateMissing`).
  const { prefs, setPref } = usePreferences()
  const dailyChoice = prefs?.[DAILY_TEMPLATE_PREF] || ''

  const submitRename = async (e) => {
    e.preventDefault()
    if (!renaming || working) return
    setWorking(true)
    setMessage(null)
    try {
      const t = await renameMemberTemplate(renaming.id, renaming.draft)
      setRenaming(null)
      setMessage({ tone: 'ok', text: `Renamed to “${t.name}”.` })
    } catch (err) {
      setMessage({ tone: 'error', text: err?.message || "Couldn't rename that template." })
    } finally {
      setWorking(false)
    }
  }

  const doDelete = async (t) => {
    if (working) return
    setWorking(true)
    setMessage(null)
    try {
      await deleteMemberTemplate(t.id)
      setConfirmDelete(null)
      setMessage({ tone: 'ok', text: `Deleted “${t.name}”. Notes made from it are unchanged.` })
    } catch {
      setMessage({ tone: 'error', text: `Couldn't delete “${t.name}”. It is still here.` })
    } finally {
      setWorking(false)
    }
  }

  return (
    <section className={styles.family} aria-labelledby="member-templates-label">
      <div id="member-templates-label" className={styles.famLabel}>Your templates</div>
      {message && (
        <div className={message.tone === 'error' ? styles.memberError : styles.memberNote}
          role={message.tone === 'error' ? 'alert' : 'status'}>
          {message.text}
        </div>
      )}
      {error ? (
        <div className={styles.memberError} role="alert">Couldn't load your templates.</div>
      ) : isLoading ? (
        <div className={styles.memberNote}>Loading your templates…</div>
      ) : templates.length === 0 ? (
        <div className={styles.memberNote}>
          Save any note as a template from its menu, and it appears here.
        </div>
      ) : (
        <>
        <label className={styles.dailyPick}>
          <span>Daily notes start from</span>
          <select
            value={dailyChoice}
            onChange={(e) => setPref(DAILY_TEMPLATE_PREF, e.target.value)}
          >
            <option value="">A blank page</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        {q && visible.length === 0 && (
          <p className={styles.memberNote} role="status">No saved templates match “{query.trim()}”.</p>
        )}
        <div className={styles.grid}>
          {visible.map((t) => (
            <div key={t.id} className={styles.memberItem}>
              {renaming?.id === t.id ? (
                <form className={styles.renameForm} onSubmit={submitRename}>
                  <input
                    className={styles.renameInput}
                    value={renaming.draft}
                    onChange={(e) => setRenaming({ id: t.id, draft: e.target.value })}
                    aria-label={`New name for ${t.name}`}
                    maxLength={80}
                    autoFocus
                  />
                  <button type="submit" className={styles.miniBtn} disabled={working}>Save</button>
                  <button type="button" className={styles.miniBtn} onClick={() => setRenaming(null)}>Cancel</button>
                </form>
              ) : (
                <button
                  type="button"
                  className={styles.card}
                  data-template-card=""
                  onClick={() => onPick(t)}
                  disabled={busy || working}
                >
                  <span className={styles.cardLabel}>{t.name}</span>
                  {t.title && t.title !== t.name && <span className={styles.cardDesc}>{t.title}</span>}
                </button>
              )}
              {confirmDelete === t.id ? (
                <div className={styles.memberActions} role="group" aria-label={`Delete ${t.name}?`}>
                  <span className={styles.memberNote}>Delete “{t.name}”? This can't be undone.</span>
                  <button type="button" className={`${styles.miniBtn} ${styles.miniDanger}`}
                    onClick={() => doDelete(t)} disabled={working}>
                    Delete
                  </button>
                  <button type="button" className={styles.miniBtn} onClick={() => setConfirmDelete(null)}>
                    Keep it
                  </button>
                </div>
              ) : renaming?.id !== t.id && (
                <div className={styles.memberActions}>
                  <button type="button" className={styles.miniBtn}
                    onClick={() => openPreview(t)}
                    aria-label={`Preview ${t.name}`}>
                    <UIcon name="eye" size={12} gold={false} /> Preview
                  </button>
                  <button type="button" className={styles.miniBtn}
                    onClick={() => { setConfirmDelete(null); setRenaming({ id: t.id, draft: t.name }) }}
                    aria-label={`Rename ${t.name}`}>
                    Rename
                  </button>
                  <button type="button" className={styles.miniBtn}
                    onClick={() => { setRenaming(null); setConfirmDelete(t.id) }}
                    aria-label={`Delete ${t.name}`}>
                    Delete
                  </button>
                  {galleryOn && (
                    <button type="button" className={styles.miniBtn}
                      onClick={() => { setRenaming(null); setConfirmDelete(null); setSharing(t.id) }}
                      aria-expanded={sharing === t.id}
                      aria-label={`Share ${t.name} to the community gallery`}>
                      Share
                    </button>
                  )}
                </div>
              )}
              {galleryOn && sharing === t.id && (
                <GalleryPublishForm
                  template={t}
                  onCancel={() => setSharing(null)}
                  onDone={(text) => { setSharing(null); setMessage({ tone: 'ok', text }) }}
                />
              )}
            </div>
          ))}
        </div>
        </>
      )}
    </section>
  )
}
