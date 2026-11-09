import { useEffect, useMemo, useRef, useState } from 'react'
import { mutate as mutateSWR } from 'swr'
import { Sheet } from '../../../../components/mobile'
import { useIsTouch } from '../../../../hooks/useBreakpoint'
import UIcon from '../../../../components/ui/UIcon'
import {
  fetchRecent, resolveLink, saveTweets, groupByDay, postAge, isPostLink, setPendingFocus,
  authorInitials, avatarTint, splitCashtags, discardEmptyNote,
} from '../../lib/tweetImportHelpers'
import { createNoteViaApi } from '../../lib/noteCreation'
import { settleNoteWrite } from '../../lib/offline/settleNoteWrite'
import { TOOLBAR_ICON } from '../../lib/notebookIcons'
import useNoteExcerpts from '../../hooks/useNoteExcerpts'
import PoliteStatus from './PoliteStatus'
import styles from './ImportTweetSheet.module.css'

const NEW_NOTE = '__new__'
const MAX_POSTS = 20
const LINK_WAIT_MS = 180
const NOT_A_LINK = "That doesn't look like a link to a post on X."
const AT_MOST = `Import at most ${MAX_POSTS} posts at a time.`
const KINDS = [['news', 'Headlines'], ['commentary', 'Theses and takes']]

function Avatar({ post }) {
  const [failed, setFailed] = useState(false)
  if (post.avatarUrl && !failed) {
    return <img className={styles.avatar} src={post.avatarUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
  }
  return <span className={styles.avatar} style={{ borderColor: avatarTint(post.handle) }} aria-hidden="true">{authorInitials(post.name)}</span>
}

/** The post's words, with its cashtags in gold. */
function PostText({ text }) {
  return splitCashtags(text).map((part, i) => (
    i % 2 ? <span key={i} className={styles.cash}>{part}</span> : part
  ))
}

/** One row of the list. Not the note's card: that is a separate component. */
function PostRow({ post, ticked, already, onToggle }) {
  const media = Array.isArray(post.media) ? post.media[0] : null
  return (
    <button type="button" role="checkbox" aria-checked={ticked} disabled={already}
      className={`${styles.post} ${ticked ? styles.ticked : ''} ${already ? styles.already : ''}`}
      onClick={() => onToggle(post.id)}>
      <Avatar post={post} />
      <span className={styles.postMain}>
        <span className={styles.postLine}>
          <b className={styles.name}>{post.name}</b>
          <span className={styles.handle}>@{post.handle} · {postAge(post.postedAt)}</span>
        </span>
        <span className={styles.postText}><PostText text={post.text} /></span>
        {media && <img className={styles.postImage} src={media} alt="" loading="lazy" />}
        {already
          ? <span className={styles.tag}>Already in this note</span>
          : post.savedInNote && <span className={styles.tag}>Saved in one of your notes</span>}
      </span>
      <span className={styles.check} aria-hidden="true">
        {ticked && <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>}
      </span>
    </button>
  )
}

/**
 * Import a tweet: posts UCT already holds, or a pasted link, into a note as cited excerpts.
 * Nothing is saved until Import is pressed.
 *
 * Two doors, one sheet (`TweetDoors.jsx`, which loads this file on use): the ticker page, where
 * the member picks the note, and the editor's /tweet and toolbar button, where the note is the
 * open one and the cards land at the caret.
 */
export default function ImportTweetSheet({
  open, onClose, symbol = '', notes = null, fixedNoteId = null, noteTitle = '', onSaved, onOpenNote,
}) {
  const isTouch = useIsTouch()
  const [scope, setScope] = useState(symbol ? 'ticker' : 'all')
  const [kind, setKind] = useState('')
  const [query, setQuery] = useState('')
  const [posts, setPosts] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [link, setLink] = useState('')
  const [linkError, setLinkError] = useState('')
  const [resolving, setResolving] = useState(0)
  const [linked, setLinked] = useState([])
  const [ticked, setTicked] = useState([])
  const [dest, setDest] = useState(NEW_NOTE)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const linkTimer = useRef(0)
  const live = useRef(true)
  // A save that failed after its note was created retries into THAT note, never a second one.
  const createdNote = useRef(null)
  const createdNoteHasPosts = useRef(false)
  const importing = useRef(false)

  // Closing after every attempt failed: the note this sheet made holds nothing, so it goes. A save
  // still running may yet land in it, so that case keeps the note.
  useEffect(() => {
    if (!open) return undefined
    return () => {
      const id = createdNote.current
      if (id && !createdNoteHasPosts.current && !importing.current) discardEmptyNote(id).catch(() => {})
    }
  }, [open])

  useEffect(() => {
    live.current = true
    return () => { live.current = false; clearTimeout(linkTimer.current) }
  }, [])

  const { excerpts } = useNoteExcerpts(open ? fixedNoteId : null)
  const already = useMemo(
    () => new Set(excerpts.map((x) => x?.tweet?.tweetId).filter(Boolean).map(String)), [excerpts])
  const alreadyRef = useRef(already)
  alreadyRef.current = already
  const tickedRef = useRef(ticked)
  tickedRef.current = ticked

  useEffect(() => {
    if (!open) return
    setScope(symbol ? 'ticker' : 'all')
    setKind('')
    setQuery('')
    setLink('')
    setLinkError('')
    setLinked([])
    setTicked([])
    setDest(NEW_NOTE)
    setError('')
    setResult(null)
    createdNote.current = null
    createdNoteHasPosts.current = false
  }, [open, symbol])

  useEffect(() => {
    if (!open) return undefined
    let current = true
    setPosts(null)
    setLoadError('')
    fetchRecent({ symbol, scope })
      .then((p) => { if (current) setPosts(p) })
      .catch((e) => { if (current) { setPosts([]); setLoadError(e.message) } })
    return () => { current = false }
  }, [open, scope, symbol])

  const toggle = (id) => {
    if (already.has(id)) return
    setError('')
    if (ticked.includes(id)) {
      setTicked(ticked.filter((x) => x !== id))
    } else if (ticked.length >= MAX_POSTS) {
      setError(AT_MOST)
    } else {
      setTicked([...ticked, id])
    }
  }

  const handleLink = async (value) => {
    const url = value.trim()
    setLinkError('')
    if (!url) return
    if (!isPostLink(url)) {
      setLinkError(NOT_A_LINK)
      return
    }
    setResolving((n) => n + 1)
    try {
      const post = await resolveLink(url)
      if (!live.current || !post) return
      setLinked((prev) => (prev.some((p) => p.id === post.id) ? prev : [post, ...prev]))
      setLink((current) => (current.trim() === url ? '' : current))
      if (!alreadyRef.current.has(post.id) && !tickedRef.current.includes(post.id)
        && tickedRef.current.length < MAX_POSTS) {
        setTicked((prev) => (prev.includes(post.id) ? prev : [...prev, post.id]))
      }
    } catch (e) {
      if (live.current) setLinkError(e?.message || NOT_A_LINK)
    } finally {
      if (live.current) setResolving((n) => n - 1)
    }
  }

  const onLinkChange = (value) => {
    setLink(value)
    clearTimeout(linkTimer.current)
    linkTimer.current = setTimeout(() => handleLink(value), LINK_WAIT_MS)
  }

  const linkedIds = useMemo(() => new Set(linked.map((p) => p.id)), [linked])
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (posts || []).filter((p) => !linkedIds.has(p.id)
      && (!kind || p.kind === kind)
      && (!q || `${p.text} ${p.name} ${p.handle}`.toLowerCase().includes(q)))
  }, [posts, linkedIds, kind, query])
  const days = useMemo(() => groupByDay(visible), [visible])

  const selected = ticked.filter((id) => !already.has(id))
  const count = selected.length

  const doImport = async () => {
    if (!count || saving) return
    const tweetIds = selected
    setSaving(true)
    importing.current = true
    setError('')
    setResult(null)
    try {
      let noteId = fixedNoteId || dest
      if (!fixedNoteId && dest === NEW_NOTE) {
        if (!createdNote.current) {
          const created = await createNoteViaApi({ title: `${symbol}: what people are saying`, ticker: symbol })
          createdNote.current = created.id
        }
        noteId = createdNote.current
      }
      const out = await saveTweets({ noteId, tweetIds })
      createdNoteHasPosts.current = true
      // The save ADVANCED the note, on every 200, `stopped` included. Land that revision, or the
      // offline queue reads the member's own write as somebody else's and forks the note.
      await settleNoteWrite(noteId, out)
      const saved = Array.isArray(out?.excerpts) ? out.excerpts.filter(Boolean) : []
      if (saved[0]?.id) setPendingFocus(saved[0].id)
      mutateSWR(`/api/j2/notes/${noteId}/excerpts`)
      onSaved?.(out, noteId)
      const warnings = Array.isArray(out?.warnings) ? out.warnings : []
      if (out?.stopped || warnings.length) {
        const landed = new Set(saved.map((x) => String(x?.tweet?.tweetId)))
        setTicked(out?.stopped ? tweetIds.filter((id) => !landed.has(id)) : [])
        setResult({ noteId, saved: saved.length, warnings, stopped: out?.stopped || '' })
      } else {
        onClose?.()
        if (onOpenNote && !fixedNoteId) onOpenNote({ id: noteId })
      }
    } catch (e) {
      setError(e?.detail || e?.message || "Couldn't import those posts. Your note is unchanged.")
    } finally {
      importing.current = false
      setSaving(false)
    }
  }

  const row = (post) => (
    <PostRow key={post.id} post={post} ticked={selected.includes(post.id)}
      already={already.has(post.id)} onToggle={toggle} />
  )
  const nothingToShow = posts !== null && !visible.length && !linked.length && !resolving && !loadError

  return (
    <Sheet open={open} onClose={onClose} variant="auto" ariaLabel="Import a tweet" maxWidth={760}
      className={styles.sheet} bodyClassName={styles.body}>
      <div className={styles.head}>
        <h3 className={styles.title}><UIcon name="xLogo" {...TOOLBAR_ICON} /> Import a tweet</h3>
        <button type="button" className={styles.close} onClick={onClose} aria-label="Close">
          <UIcon name="x" {...TOOLBAR_ICON} />
        </button>
      </div>

      <div className={styles.linkRow}>
        <div className={styles.linkBox}>
          <UIcon name="link" {...TOOLBAR_ICON} className={styles.linkIcon} />
          <input className={styles.linkInput} type="text" autoComplete="off" autoFocus={!isTouch}
            aria-label="Link to a post on X" placeholder="Paste a link to any post on X"
            value={link} onChange={(e) => onLinkChange(e.target.value)} />
        </div>
        {linkError && <p className={styles.linkError} role="alert">{linkError}</p>}
      </div>

      <div className={styles.filters}>
        {symbol && (
          <button type="button" className={`${styles.chip} ${scope === 'ticker' ? styles.chipOn : ''}`}
            aria-pressed={scope === 'ticker'} onClick={() => setScope('ticker')}>${symbol}</button>
        )}
        <button type="button" className={`${styles.chip} ${scope === 'all' ? styles.chipOn : ''}`}
          aria-pressed={scope === 'all'} onClick={() => setScope('all')}>All recent</button>
        {KINDS.map(([value, label]) => (
          <button key={value} type="button" className={`${styles.chip} ${kind === value ? styles.chipOn : ''}`}
            aria-pressed={kind === value} onClick={() => setKind(kind === value ? '' : value)}>{label}</button>
        ))}
        <label className={styles.search}>
          <UIcon name="search" {...TOOLBAR_ICON} />
          <input type="search" className={styles.searchInput} placeholder="Search name or words"
            aria-label="Search posts" value={query} onChange={(e) => setQuery(e.target.value)} />
        </label>
      </div>
      <PoliteStatus text={query.trim() ? `${visible.length} ${visible.length === 1 ? 'post matches' : 'posts match'}.` : ''} />

      <div className={styles.list}>
        {(resolving > 0 || linked.length > 0) && (
          <div role="group" aria-label="From your link">
            <div className={styles.day}>From your link</div>
            {resolving > 0 && <div className={styles.shim} aria-hidden="true" />}
            {linked.map(row)}
          </div>
        )}
        {posts === null && (
          <div role="status" aria-label="Loading posts">
            <div className={styles.shim} /><div className={styles.shim} /><div className={styles.shim} />
          </div>
        )}
        {days.map((group) => (
          <div key={group.day} role="group" aria-label={group.day}>
            <div className={styles.day}>{group.day}</div>
            {group.posts.map(row)}
          </div>
        ))}
        {loadError && <p className={styles.none} role="alert">{loadError}</p>}
        {nothingToShow && <p className={styles.none}>No recent posts match. Paste a link above to bring in any post.</p>}
      </div>

      {(error || result) && (
        <div className={styles.notices}>
          {error && <p className={styles.error} role="alert">{error}</p>}
          {result && (
            <div className={styles.result} role="status" data-import-result="">
              {result.stopped
                ? <p className={styles.warn}>{result.stopped}</p>
                : <p>{result.saved === 1 ? '1 post' : `${result.saved} posts`} imported.</p>}
              {result.warnings.map((w) => <p key={w} className={styles.warn}>{w}</p>)}
              {onOpenNote && !fixedNoteId && (
                <button type="button" className={styles.openNote}
                  onClick={() => { onClose?.(); onOpenNote({ id: result.noteId }) }}>Open the note</button>
              )}
            </div>
          )}
        </div>
      )}

      <div className={styles.foot}>
        {fixedNoteId ? (
          <span className={styles.adding}>Adding to <b>{noteTitle?.trim() || 'this note'}</b></span>
        ) : (
          <>
            <label className={styles.saveTo} htmlFor="tw-dest">Save to</label>
            <select id="tw-dest" className={styles.select} value={dest} onChange={(e) => setDest(e.target.value)}>
              <option value={NEW_NOTE}>New {symbol} note</option>
              {(notes || []).map((n) => <option key={n.id} value={n.id}>{n.title?.trim() || 'Untitled'}</option>)}
            </select>
          </>
        )}
        <span className={styles.count}>{count ? `${count} selected` : 'Nothing saved until you import'}</span>
        <button type="button" className={styles.go} onClick={doImport} disabled={!count || saving}>
          {saving ? 'Importing…' : `Import${count > 1 ? ` ${count} posts` : ''}`}
        </button>
      </div>
    </Sheet>
  )
}
