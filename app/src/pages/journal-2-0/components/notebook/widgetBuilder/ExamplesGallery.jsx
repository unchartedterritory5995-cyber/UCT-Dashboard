import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { DEFS_URL, getJson, postJson } from '../../../lib/builtWidgets'
import ExampleCard from './ExampleCard'
import { rankExamples, examplesFailureText, useReducedMotion } from './examplesModel'
import styles from './ExamplesGallery.module.css'

/**
 * Notebook widgets phase 2 (wave 8, Task 8.16): the builder's start screen, "Start from an example" (spec 5.2 step 1).
 *
 * The ready-made widgets as cards (`GET /shelf`: `{examples: [{id, name, description, keywords, plan}]}`), plus "Start
 * blank", with a search over each card's name and keywords: a NAME match ranks above a keyword match, and within a
 * tier the shelf's own order holds.
 *
 * Card results come from `POST /examples` (`{ids}` -> `{sample, cards: {id: payload}}`, at most 8 ids), asked for in
 * batches of `BATCH` as cards scroll into view (an IntersectionObserver over the card list items):
 *   * ⛔ A card already asked for is NEVER asked for again: not when it scrolls out and back, not when the search
 *     hides and shows it, not when the member goes into the builder and back (this component stays mounted, hidden).
 *   * On `busy` a card keeps its skeleton and its batch is asked for ONCE more after `BUSY_RETRY_MS`. A second busy
 *     leaves the card's bare shape; "busy" is never shown on a card and nothing retries again on a timer.
 *   * Any other refusal leaves the cards' bare shapes and ONE line above the list with the spec 5.10 sentence for its
 *     code. "Try again" (and the browser coming back online) asks once more for those cards only.
 *   * `sample: true` (fewer than 5 closed trades): a "Sample data" ribbon on every card and a banner with Link broker
 *     and Log a trade. The server resolves a sample card's range against the sample book's own last day.
 *
 * ⛔ Member words: never "shelf", "definition", "plan" or "source".
 */
export const GALLERY_TITLE = 'Start from an example'
export const SAMPLE_BANNER = 'These use sample trades. Link a broker or log a trade to see yours.'
export const LINK_BROKER = 'Link broker'
export const LOG_TRADE = 'Log a trade'
/** Where BrokerConnectionsCard lives, and the Trade Journal. */
export const LINK_BROKER_HREF = '/journal/accounts'
export const LOG_TRADE_HREF = '/journal/trades'
export const START_BLANK = 'Start blank'
export const SEARCH_LABEL = 'Search examples'
export const NO_MATCH = 'No examples match. Try another word, or start blank.'
export const SHELF_LOADING = 'Loading the examples…'
export const SHELF_FAILED = "Couldn't load the examples. Try again, or start blank."
export const CARDS_FAILED = "Couldn't draw these previews. Open one to see it live."
/** At most this many cards per `POST /examples` (the server's MAX_EXAMPLES). */
export const BATCH = 8
/** A busy batch is asked for once more after this long, and never again. */
export const BUSY_RETRY_MS = 1500

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const shelfOf = (data) => (Array.isArray(data?.examples) ? data.examples : [])
  .filter((e) => isRecord(e) && typeof e.id === 'string' && e.id && typeof e.name === 'string' && isRecord(e.plan))

function ExamplesGallery({ hidden = false, resume = null, resumeRef = null, onResume, onFresh, onOpen, onBlank, onLink }) {
  const [shelf, setShelf] = useState({ status: 'loading', list: [], code: '' })
  const [shelfTick, setShelfTick] = useState(0)
  const [cards, setCards] = useState(() => new Map())
  const [sample, setSample] = useState(false)
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const reduce = useReducedMotion()
  const searchId = useId()
  const mounted = useRef(true)
  const requested = useRef(new Set())     // every id ever asked for: never asked for again on its own
  const failed = useRef(new Set())        // refused (not busy): asked for again only by Try again / back online
  const visible = useRef(new Set())
  const timers = useRef(new Set())
  const nodes = useRef(new Map())         // id -> list item
  const io = useRef(null)

  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      for (const t of pending) clearTimeout(t)
      pending.clear()
    }
  }, [])

  useEffect(() => {
    let alive = true
    getJson(`${DEFS_URL}/shelf`).then((got) => {
      if (!alive || !mounted.current) return
      if (got.ok) setShelf({ status: 'ok', list: shelfOf(got.data), code: '' })
      else setShelf({ status: 'failed', list: [], code: got.code })
    })
    return () => { alive = false }
  }, [shelfTick])

  const settle = useCallback((ids, apply) => {
    setCards((prev) => {
      const next = new Map(prev)
      for (const id of ids) next.set(id, apply(id))
      return next
    })
  }, [])

  /** Ask for one batch (<= BATCH ids). A busy answer is asked for once more, after BUSY_RETRY_MS. */
  const send = useCallback((ids) => {
    const attempt = async (retry) => {
      const got = await postJson('/examples', { ids })
      if (!mounted.current) return
      if (got.ok) {
        const answered = isRecord(got.data.cards) ? got.data.cards : {}
        setSample(got.data.sample === true)
        for (const id of ids) failed.current.delete(id)
        settle(ids, (id) => (isRecord(answered[id]) ? { status: 'ok', payload: answered[id] } : { status: 'static' }))
        return
      }
      if (got.code === 'busy' && !retry) {
        // The skeleton stays; ONE more try, and never another.
        const t = setTimeout(() => {
          timers.current.delete(t)
          attempt(true)
        }, BUSY_RETRY_MS)
        timers.current.add(t)
        return
      }
      settle(ids, () => ({ status: 'static' }))
      if (got.code === 'busy') return            // busy twice: the bare shape, and nothing said
      for (const id of ids) failed.current.add(id)
      setNote(examplesFailureText(got.code, CARDS_FAILED))
    }
    return attempt(false)
  }, [settle])

  const request = useCallback((ids) => {
    for (let i = 0; i < ids.length; i += BATCH) send(ids.slice(i, i + BATCH))
  }, [send])

  /** Try again (or back online): the refused cards in view, once. */
  const retryFailed = useCallback(() => {
    const ids = [...failed.current].filter((id) => visible.current.has(id))
    if (!ids.length) return
    for (const id of ids) failed.current.delete(id)
    setNote('')
    settle(ids, () => ({ status: 'loading' }))
    request(ids)
  }, [request, settle])

  useEffect(() => {
    window.addEventListener('online', retryFailed)
    return () => window.removeEventListener('online', retryFailed)
  }, [retryFailed])

  // One observer for every card: what comes into view and has never been asked for is asked for, in batches.
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return undefined
    const obs = new IntersectionObserver((entries) => {
      const fresh = []
      for (const e of entries) {
        const id = e.target.getAttribute('data-example-id')
        if (!id) continue
        if (!e.isIntersecting) { visible.current.delete(id); continue }
        visible.current.add(id)
        if (requested.current.has(id)) continue
        requested.current.add(id)
        fresh.push(id)
      }
      if (fresh.length) request(fresh)
    }, { rootMargin: '160px 0px' })
    io.current = obs
    for (const el of nodes.current.values()) obs.observe(el)
    return () => {
      obs.disconnect()
      io.current = null
    }
  }, [request])

  /** Each card's list item reports itself here (mounted: `el`; gone: null), to be watched for scrolling into view. */
  const observe = useCallback((id, el) => {
    const was = nodes.current.get(id)
    if (was && was !== el) {
      io.current?.unobserve(was)
      nodes.current.delete(id)
      visible.current.delete(id)
    }
    if (el) {
      nodes.current.set(id, el)
      io.current?.observe(el)
    }
  }, [])

  const shown = useMemo(() => rankExamples(shelf.list, query), [shelf.list, query])
  const motion = !reduce

  return (
    <div className={styles.gallery} hidden={hidden} data-testid="examples-gallery">
      <h3 className={styles.title} tabIndex={-1} data-gallery-heading="">{GALLERY_TITLE}</h3>
      {resume && (
        <div className={styles.offer} role="group" aria-label={resume.text}>
          <p className={styles.offerText}>{resume.text}</p>
          <p className={styles.hint}>{resume.kept}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.btnPrimary} ref={resumeRef} onClick={onResume}>Resume</button>
            <button type="button" className={styles.btn} onClick={onFresh}>Start fresh</button>
          </div>
        </div>
      )}
      <div className={styles.top}>
        <label className={styles.field} htmlFor={searchId}>
          <span className={styles.fieldLabel}>{SEARCH_LABEL}</span>
          <input id={searchId} className={styles.search} type="search" value={query} autoComplete="off"
            placeholder="Win rate, drawdown, by weekday…" onChange={(e) => setQuery(e.target.value)} />
        </label>
        <button type="button" className={styles.btn} onClick={(e) => onBlank(e.currentTarget)}>{START_BLANK}</button>
      </div>
      {sample && (
        <div className={styles.banner} data-testid="sample-banner">
          <p className={styles.bannerText}>{SAMPLE_BANNER}</p>
          <div className={styles.actions}>
            <a className={styles.linkBtn} href={LINK_BROKER_HREF} onClick={(e) => onLink(LINK_BROKER_HREF, e)}>{LINK_BROKER}</a>
            <a className={styles.linkBtn} href={LOG_TRADE_HREF} onClick={(e) => onLink(LOG_TRADE_HREF, e)}>{LOG_TRADE}</a>
          </div>
        </div>
      )}
      {note && (
        <div className={styles.note}>
          <p className={styles.noteText} role="status">{note}</p>
          <button type="button" className={styles.btn} onClick={retryFailed}>Try again</button>
        </div>
      )}
      {shelf.status === 'loading' && <p className={styles.hint} role="status">{SHELF_LOADING}</p>}
      {shelf.status === 'failed' && (
        <div className={styles.note}>
          <p className={styles.noteText} role="alert">{examplesFailureText(shelf.code, SHELF_FAILED)}</p>
          <button type="button" className={styles.btn} onClick={() => {
            setShelf((st) => ({ ...st, status: 'loading' }))
            setShelfTick((n) => n + 1)
          }}>Try again</button>
        </div>
      )}
      {shelf.status === 'ok' && (
        <>
          {query.trim() !== '' && (
            <p className={styles.srOnly} role="status">
              {`${shown.length} ${shown.length === 1 ? 'example' : 'examples'}`}
            </p>
          )}
          {shown.length ? (
            <ul className={styles.list} aria-label="Examples">
              {shown.map((ex) => (
                <ExampleCard key={ex.id} example={ex} card={cards.get(ex.id)} sample={sample} motion={motion}
                  onOpen={onOpen} observe={observe} />
              ))}
            </ul>
          ) : <p className={styles.hint}>{NO_MATCH}</p>}
        </>
      )}
    </div>
  )
}

export default memo(ExamplesGallery)
