// app/src/pages/desk/ArticlesSection.jsx
// The Desk → Articles: the firm's Substack posts as link-out cards. Admins
// manage the source publications (RSS feeds) inline.
import { useState, useCallback, useEffect } from 'react'
import { Link } from 'react-router-dom'
import DeskSectionSkeleton from './DeskSectionSkeleton'
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

/* One card. Reads natively when we hold a converted body, and falls back to the
 * Substack link when we don't — a post can be paywalled, brand new, or awaiting
 * backfill, and none of those should render a card that opens an empty page. */
function ArticleCard({ a, snippet }) {
  const native = Boolean(a.has_body && a.slug)
  const linkProps = native
    ? { as: Link, to: `/desk/article/${a.slug}` }
    : { as: 'a', href: a.url, target: '_blank', rel: 'noopener noreferrer' }
  const { as: Tag, ...rest } = linkProps

  // The author is "Uncharted Territory" on a publication called "Uncharted
  // Territory", so printing both renders the same words twice.
  const byline = a.author && a.author !== a.publication_name ? a.author : null

  // Every issue opens with the same welcome paragraph, so the excerpt is
  // identical on all 61 cards. The week's ticker list is the one thing that
  // actually differs — and it is what a trader scans an archive for.
  let tickers = []
  try { tickers = JSON.parse(a.tickers_json || '[]') } catch { tickers = [] }

  return (
    <Tag className={styles.articleCard} {...rest}>
      {a.hero_image
        ? <img className={styles.articleHero} src={a.hero_image} alt="" loading="lazy" />
        : <div className={styles.articleHeroFallback} aria-hidden="true"><ArticleIcon size={28} /></div>}
      <div className={styles.articleBody}>
        {/* Every Sunday Scans post is titled "SUNDAY SCANS" at the source, so
            the grid is unreadable without the date-stamped display title. */}
        <div className={styles.articleTitle}>{a.display_title || a.title}</div>
        {snippet
          ? (
            <div
              className={styles.articleSnippet}
              // Server-built from FTS5 snippet(); the only markup it can contain
              // is the <mark> this app asked for -- the body text around it is
              // escaped by the same converter that renders the article.
              dangerouslySetInnerHTML={{ __html: snippet }}
            />
          )
          : tickers.length > 0
          ? (
            <div className={styles.articleTickers}>
              {tickers.slice(0, 10).map((s) => (
                <span key={s} className={styles.articleTicker}>{s}</span>
              ))}
              {tickers.length > 10 && (
                <span className={styles.articleTickerMore}>+{tickers.length - 10}</span>
              )}
            </div>
          )
          : a.excerpt && <div className={styles.articleExcerpt}>{a.excerpt}</div>}
        <div className={styles.articleMeta}>
          {a.published_at ? <span>{fmtDate(a.published_at)}</span> : null}
          {byline && <span>· {byline}</span>}
          {native && a.reading_minutes ? <span>· {a.reading_minutes} min read</span> : null}
          {native && a.image_count ? <span>· {a.image_count} charts</span> : null}
          {!native && <span>· on Substack ↗</span>}
        </div>
      </div>
    </Tag>
  )
}

/* Full-text search across the archive. The question a trader actually brings to
   a back catalogue is "what did he say about MU in May?", which a date-ordered
   grid of 91 cards cannot answer at all. */
function ArchiveSearch({ query, setQuery }) {
  const [draft, setDraft] = useState(query)
  useEffect(() => { setDraft(query) }, [query])
  // Debounced so typing doesn't fire a query per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setQuery(draft.trim()), 250)
    return () => clearTimeout(t)
  }, [draft, setQuery])

  return (
    <div className={styles.searchWrap}>
      <input
        className={styles.searchInput}
        type="search"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Search the archive — a ticker, a setup, a phrase…"
        aria-label="Search articles"
      />
      {draft && (
        <button type="button" className={styles.searchClear}
                onClick={() => setDraft('')} aria-label="Clear search">×</button>
      )}
    </div>
  )
}

function SearchResults({ query }) {
  const { data, isLoading } = useSWR(
    query ? `/api/desk/articles/search?q=${encodeURIComponent(query)}` : null,
    fetcher,
  )
  if (isLoading) return <div className={styles.searchNote}>Searching…</div>
  const results = data?.results || []

  if (data && data.available === false) {
    return <div className={styles.searchNote}>Archive search isn’t available right now.</div>
  }
  if (!results.length) {
    return (
      <div className={styles.searchNote}>
        Nothing in the archive matches “{query}”.
      </div>
    )
  }
  return (
    <>
      <div className={styles.searchNote}>
        {results.length} {results.length === 1 ? 'article' : 'articles'} matching “{query}”
      </div>
      <div className={styles.cardGrid}>
        {results.map((a) => <ArticleCard key={a.id} a={a} snippet={a.snippet} />)}
      </div>
    </>
  )
}

export default function ArticlesSection() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const { data, isLoading, mutate } = useSWR('/api/desk/articles', fetcher)
  const [managing, setManaging] = useState(false)
  const [query, setQuery] = useState('')

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

      {articles.length > 0 && <ArchiveSearch query={query} setQuery={setQuery} />}

      {isLoading && <DeskSectionSkeleton cards={6} />}

      {query && <SearchResults query={query} />}

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

      {!query && articles.length > 0 && (
        <div className={styles.cardGrid}>
          {articles.map((a) => <ArticleCard key={a.id} a={a} />)}
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
