// Wave 12 (lane 12A) — "Share to the community gallery", one of Your templates at a time
// (MemberTemplates.jsx opens it beside the template's card; dark behind
// notebook_template_gallery_enabled).
//
// The SERVER reads the template and decides what leaves (template_gallery.py, through the
// one public reducer in `gallery` mode); this form only names it and says, in words,
// what will and will not be shared before the member presses Submit. A submission waits
// for a UCT reviewer before anyone else can see it.
import { useId, useState } from 'react'
import { GALLERY_CATEGORIES, publishToGallery } from '../../lib/templateGallery'
import styles from './TemplateGallery.module.css'

const FAILED_SENTENCE = "Couldn't submit that template. Nothing was shared."

/** What the member reads when a submit fails. The SERVER's own sentence when it sent one (a
 *  refusal carries a status and a `detail`); the plain sentence for everything else: a dropped
 *  connection (the browser's "Failed to fetch") and an error with no readable body (the
 *  client's "request failed (502)"), neither of which is written for a member. */
function refusalSentence(err) {
  const text = typeof err?.message === 'string' ? err.message.trim() : ''
  const fromServer = typeof err?.status === 'number' && text && !/^request failed \(\d+\)$/.test(text)
  return fromServer ? text : FAILED_SENTENCE
}

export default function GalleryPublishForm({ template, onDone, onCancel }) {
  const uid = useId()
  const [title, setTitle] = useState(template?.name || '')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (working || !title.trim() || !category) return
    setWorking(true)
    setError(null)
    try {
      const item = await publishToGallery({ templateId: template.id, title, description, category })
      onDone(`Submitted “${item.title}” for review. You'll see it under Your submissions in the community gallery.`)
    } catch (err) {
      setError(refusalSentence(err))
      setWorking(false)
    }
  }

  return (
    <form className={styles.publishForm} onSubmit={submit} aria-label={`Share ${template.name} to the community gallery`}>
      <label className={styles.field} htmlFor={`${uid}-title`}>
        <span>Title in the gallery</span>
        <input id={`${uid}-title`} value={title} maxLength={80} required onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className={styles.field} htmlFor={`${uid}-desc`}>
        <span>What it's for (optional)</span>
        <textarea id={`${uid}-desc`} rows={2} maxLength={280} value={description}
          onChange={(e) => setDescription(e.target.value)} />
      </label>
      <label className={styles.field} htmlFor={`${uid}-cat`}>
        <span>Category</span>
        <select id={`${uid}-cat`} value={category} required onChange={(e) => setCategory(e.target.value)}>
          <option value="">Choose a category</option>
          {GALLERY_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>
      <p className={styles.note} id={`${uid}-what`}>
        Shared under your display name: the template's text and the names of its properties. Left out: links to
        your other notes, images and attachments, Ask answers, email addresses and every property value. A UCT
        reviewer approves it before other members can see it, and you can unpublish it at any time.
      </p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <button type="submit" className={`${styles.btn} ${styles.primary}`} aria-describedby={`${uid}-what`}
          disabled={working || !title.trim() || !category}>
          Submit for review
        </button>
        <button type="button" className={styles.btn} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
