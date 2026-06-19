// app/src/pages/desk/ArticlesSection.jsx
// The Desk → Articles: the firm's Substack posts as link-out cards. Admins
// manage the source publications (RSS feeds) inline.
import { useState, useCallback } from 'react'
import useSWR from 'swr'
import { useAuth } from '../../context/AuthContext'
import Sheet from '../../components/mobile/Sheet'
import { ArticleIcon, PlusIcon } from '../education/icons'
import styles from './Desk.module.css'

const fetcher = (url) =>
  fetch(url, { credentials: 'include' }).then((r) => (r.ok ? r.json() : null))

function fmtDate(unixSec) {
  if (!unixSec) return ''
  try {
    return new Date(unixSec * 1000).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function ArticlesSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data, isLoading, mutate } = useSWR('/api/desk/articles', fetcher)
  const [managing, setManaging] = useState(false)

  const articles = data?.articles || []

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div className={styles.sectionHeadMain}>
          <span className={styles.sectionIcon} aria-hidden="true"><ArticleIcon /></span>
          <div>
            <div className={styles.eyebrow}>UCT INTELLIGENCE</div>
            <h1 className={styles.sectionTitle}>Articles</h1>
            <div className={styles.sectionSub}>Long-form research & notes from our Substack</div>
          </div>
        </div>
        {isAdmin && (
          <button className={styles.ghostBtn} onClick={() => setManaging(true)}>
            Manage publications
          </button>
        )}
      </div>

      {isLoading && <div className={styles.note}>Loading…</div>}

      {!isLoading && articles.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true"><ArticleIcon size={30} /></span>
          <div className={styles.emptyTitle}>Articles are on the way</div>
          <div className={styles.emptyText}>
            {isAdmin
              ? 'Add your Substack publication — paste its feed URL (e.g. https://yourname.substack.com/feed) and posts will appear here automatically.'
              : 'Our written research is being connected in. Check back shortly.'}
          </div>
          {isAdmin && (
            <button className={styles.goldBtn} onClick={() => setManaging(true)}>
              <PlusIcon /> Add a publication
            </button>
          )}
        </div>
      )}

      {articles.length > 0 && (
        <div className={styles.cardGrid}>
          {articles.map((a) => (
            <a
              key={a.id}
              className={styles.articleCard}
              href={a.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {a.hero_image
                ? <img className={styles.articleHero} src={a.hero_image} alt="" loading="lazy" />
                : <div className={styles.articleHeroFallback} aria-hidden="true"><ArticleIcon size={28} /></div>}
              <div className={styles.articleBody}>
                <div className={styles.articleTitle}>{a.title}</div>
                {a.excerpt && <div className={styles.articleExcerpt}>{a.excerpt}</div>}
                <div className={styles.articleMeta}>
                  {a.publication_name && <span>{a.publication_name}</span>}
                  {a.author && <span>· {a.author}</span>}
                  {a.published_at ? <span>· {fmtDate(a.published_at)}</span> : null}
                </div>
              </div>
            </a>
          ))}
        </div>
      )}

      {managing && (
        <PublicationsManager onClose={() => setManaging(false)} onChanged={mutate} />
      )}
    </div>
  )
}

function PublicationsManager({ onClose, onChanged }) {
  const { data, mutate } = useSWR('/api/desk/publications', fetcher)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const pubs = data?.publications || []

  const add = useCallback(async () => {
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/desk/publications', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, feed_url: url }),
      })
      if (!r.ok) {
        const j = await r.json().catch(() => ({}))
        throw new Error(j.detail || 'Add failed')
      }
      setName(''); setUrl('')
      mutate(); onChanged()
    } catch (e) { setErr(e.message) } finally { setBusy(false) }
  }, [name, url, mutate, onChanged])

  const remove = async (id) => {
    if (!window.confirm('Remove this publication and its posts?')) return
    await fetch(`/api/desk/publications/${id}`, { method: 'DELETE', credentials: 'include' })
    mutate(); onChanged()
  }

  const repoll = async (id) => {
    await fetch(`/api/desk/publications/${id}/poll`, { method: 'POST', credentials: 'include' })
    onChanged()
  }

  return (
    <Sheet open onClose={onClose} variant="auto" title="Substack publications">
      <div className={styles.form}>
        <div className={styles.field}>
          <span className={styles.label}>Publication name</span>
          <input className={styles.input} value={name} onChange={(e) => setName(e.target.value)}
                 placeholder="UCT Intelligence Letter" />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>RSS feed URL</span>
          <input className={styles.input} value={url} onChange={(e) => setUrl(e.target.value)}
                 placeholder="https://yourname.substack.com/feed" />
        </div>
        {err && <div className={styles.formErr}>{err}</div>}
        <div className={styles.formActions}>
          <button className={styles.goldBtn} onClick={add} disabled={busy || !name || !url}>
            {busy ? 'Adding…' : 'Add publication'}
          </button>
        </div>

        {pubs.length > 0 && (
          <div className={styles.pubList}>
            {pubs.map((p) => (
              <div key={p.id} className={styles.pubRow}>
                <div className={styles.pubInfo}>
                  <div className={styles.pubName}>{p.name}</div>
                  <div className={styles.pubUrl}>{p.feed_url}</div>
                </div>
                <div className={styles.pubActions}>
                  <button className={styles.adminLink} onClick={() => repoll(p.id)}>Re-poll</button>
                  <button className={styles.adminLinkDanger} onClick={() => remove(p.id)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  )
}
