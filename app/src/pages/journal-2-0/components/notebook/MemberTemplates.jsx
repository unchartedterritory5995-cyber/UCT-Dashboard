/**
 * Wave 6 (lane E, item 3) — "Your templates", the member's own section of the
 * template picker: pick one to make a note from it, or rename / delete it.
 *
 * ⛔ Rename and Delete sit BESIDE the template's card button, never inside it
 * (a button in a button is one control to a screen reader). Delete asks once,
 * in words, before it acts — a template is the member's own work and there is
 * no trash for it. Every failure is a sentence on screen, never a silent no-op.
 */
import { useState } from 'react'
import {
  deleteMemberTemplate, renameMemberTemplate, useMemberTemplates,
} from '../../lib/memberTemplates'
import { DAILY_TEMPLATE_PREF } from '../../lib/dailyNote'
import usePreferences from '../../../../hooks/usePreferences'
import styles from './TemplatePicker.module.css'

export default function MemberTemplates({ onPick, busy = false }) {
  const { templates, error, isLoading } = useMemberTemplates()
  const [renaming, setRenaming] = useState(null) // { id, draft }
  const [confirmDelete, setConfirmDelete] = useState(null) // id
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState(null) // { text, tone }
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
        <div className={styles.grid}>
          {templates.map((t) => (
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
                    onClick={() => { setConfirmDelete(null); setRenaming({ id: t.id, draft: t.name }) }}
                    aria-label={`Rename ${t.name}`}>
                    Rename
                  </button>
                  <button type="button" className={styles.miniBtn}
                    onClick={() => { setRenaming(null); setConfirmDelete(t.id) }}
                    aria-label={`Delete ${t.name}`}>
                    Delete
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
        </>
      )}
    </section>
  )
}
