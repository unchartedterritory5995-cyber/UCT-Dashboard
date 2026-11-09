import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import useSWR from 'swr'
import UIcon from '../../../../components/ui/UIcon'
import { formatWeekdayDateTimeEt } from '../../../../lib/presentation/presentationDates'
import useNoteExcerpts from '../../hooks/useNoteExcerpts'
import {
  authorInitials, avatarTint, consumePendingFocus, nowPriceOf, postHref, priceLineParts,
  saveTake, saveTakeOnLeave, snapshotKey, splitCashtags,
} from '../../lib/tweetImportHelpers'
import { call } from '../../lib/researchCapture'
import styles from './TweetCard.module.css'

const POST_GONE = 'This post is no longer on X.'
const SAVE_FAILED = "Couldn't save. Your words are still here. Leave the field to try again."

// One fetch when the note opens. Cards on one ticker share the SWR key, so they share the request.
const ONCE = {
  refreshInterval: 0,
  revalidateOnFocus: false,
  revalidateOnReconnect: false,
  shouldRetryOnError: false,
}

function Avatar({ tweet }) {
  const [failed, setFailed] = useState(false)
  if (tweet.avatarUrl && !failed) {
    return <img className={styles.avatar} src={tweet.avatarUrl} alt="" loading="lazy" onError={() => setFailed(true)} />
  }
  return (
    <span className={styles.avatar} style={{ borderColor: avatarTint(tweet.handle) }} aria-hidden="true">
      {authorInitials(tweet.name)}
    </span>
  )
}

/** The post is third-party text: React text nodes only, with its cashtags in gold. */
function PostText({ text }) {
  return splitCashtags(text).map((part, i) => (
    i % 2 ? <span key={i} className={styles.cash} data-cashtag="">{part}</span> : part
  ))
}

/** "$NVDA when posted $188.20" with the amount in bold, as the approved card has it. */
function Amount({ text }) {
  const cut = text.lastIndexOf(' ')
  return <span>{text.slice(0, cut + 1)}<b>{text.slice(cut + 1)}</b></span>
}

function PriceLine({ price }) {
  const key = price ? snapshotKey(price.symbol) : null
  const { data } = useSWR(key, (url) => call(url), ONCE)
  const parts = priceLineParts(price, nowPriceOf(data))
  if (!parts) return null
  return (
    <div className={styles.stamp}>
      <Amount text={parts.thenText} />
      {parts.nowText && <Amount text={parts.nowText} />}
      {parts.pctText && (
        <span className={parts.tone === 'up' ? styles.up : styles.down} data-tone={parts.tone}>{parts.pctText}</span>
      )}
    </div>
  )
}

/**
 * My take: a plain field on the excerpt row, inside the editor's atom node view. It saves on blur
 * when the words changed; a failed save keeps them and the next blur tries again.
 */
function MyTake({ excerpt, noteId }) {
  const { refresh } = useNoteExcerpts(noteId)
  const annotation = excerpt.annotation || ''
  const [value, setValue] = useState(annotation)
  const [failed, setFailed] = useState(false)
  const fieldRef = useRef(null)
  const fieldId = useId()

  // What the server holds, what the field holds, and the save in flight. Refs, because the save
  // reads them after the render that started it, including once the card has unmounted.
  const saved = useRef(annotation)
  const current = useRef(value)
  current.current = value
  const saving = useRef(false)
  const again = useRef(false)
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  const save = useRef(async () => {
    if (saving.current) {
      again.current = true
      return
    }
    // The server trims, so space alone is not a change.
    const text = current.current.trim()
    if (text === saved.current.trim()) {
      setFailed(false)
      return
    }
    saving.current = true
    try {
      await saveTake(excerpt.id, text)
      saved.current = text
      setFailed(false)
      refreshRef.current?.()
    } catch {
      setFailed(true)
    } finally {
      saving.current = false
      if (again.current) {
        again.current = false
        save.current()
      }
    }
  })

  // A refresh brings the server's words in, except over words the member has not saved.
  useEffect(() => {
    if (annotation === saved.current) return
    const untouched = current.current === saved.current
    saved.current = annotation
    if (untouched) setValue(annotation)
  }, [annotation])

  useEffect(() => {
    if (consumePendingFocus(excerpt.id)) fieldRef.current?.focus()
  }, [excerpt.id])

  // Closing the tab fires no blur and unmounts nothing, and an ordinary request would not finish.
  useEffect(() => {
    const leave = () => {
      const text = current.current.trim()
      if (text !== saved.current.trim()) saveTakeOnLeave(excerpt.id, text)
    }
    window.addEventListener('pagehide', leave)
    return () => window.removeEventListener('pagehide', leave)
  }, [excerpt.id])

  // Leaving the note without a blur still saves the words.
  useEffect(() => () => {
    if (current.current.trim() !== saved.current.trim()) save.current()
  }, [])

  useLayoutEffect(() => {
    const field = fieldRef.current
    field.style.height = 'auto'
    field.style.height = `${field.scrollHeight}px`
  }, [value])

  return (
    <>
      <div className={styles.take}>
        <label htmlFor={fieldId}>My take</label>
        <textarea
          id={fieldId}
          ref={fieldRef}
          className={styles.ttext}
          rows={1}
          placeholder="What do you make of this?"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => save.current()}
        />
      </div>
      {failed && <p className={styles.saveError} role="alert">{SAVE_FAILED}</p>}
    </>
  )
}

/**
 * The card a saved post shows as inside a note. `excerpt.tweet` is `useNoteExcerpts`' row; the
 * words are `excerpt.capturedText`, empty once the post has left X.
 */
export default function TweetCard({ excerpt, deleteNode, noteId }) {
  const tweet = excerpt.tweet
  const removed = !!tweet.removed
  const when = formatWeekdayDateTimeEt(tweet.postedAt)
  const href = postHref(tweet.url)
  const media = !removed && Array.isArray(tweet.media) ? tweet.media.filter((m) => typeof m === 'string' && m) : []

  return (
    <div className={styles.card} contentEditable={false} data-tweet-card="">
      <div className={styles.cmain}>
        <div className={styles.chead}>
          <Avatar tweet={tweet} />
          <div>
            <div className={styles.name}>{tweet.name}</div>
            <div className={styles.handle}>@{tweet.handle}</div>
          </div>
          <div className={styles.xmark}>
            <UIcon name="xLogo" size={16} gold={false} />
            <button type="button" className={styles.rm} title="Remove from note" aria-label="Remove from note" onClick={() => deleteNode()}>
              <UIcon name="x" size={16} gold={false} />
            </button>
          </div>
        </div>
        {removed
          ? <div className={`${styles.ctext} ${styles.gone}`}>{POST_GONE}</div>
          : <div className={styles.ctext}><PostText text={excerpt.capturedText} /></div>}
        {media.map((src) => (
          <div className={styles.cimg} key={src}><img src={src} alt="Attached to the post" loading="lazy" /></div>
        ))}
        {(when || href) && (
          <div className={styles.cfoot}>
            {when && <span>{when}</span>}
            {when && href && <span aria-hidden="true">·</span>}
            {href && <a href={href} target="_blank" rel="noopener noreferrer">View on X</a>}
          </div>
        )}
      </div>
      <PriceLine price={tweet.price} />
      <MyTake excerpt={excerpt} noteId={noteId} />
    </div>
  )
}
