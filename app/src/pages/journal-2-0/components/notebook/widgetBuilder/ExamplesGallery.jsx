import { memo, useCallback, useContext, useEffect, useId, useMemo, useRef, useState } from 'react'
import { DEFS_URL, getJson, postJson } from '../../../lib/builtWidgets'
import { widgetsWaveOn, doorLostSentence } from '../../../lib/notebookWidgetsFlags'
import { insertToolBlock } from '../../../lib/toolEmbed'
import { BuilderDoor } from './builderDoor'
import useMediaQuery from '../../../../../hooks/useMediaQuery'
import { useIsPhone } from '../../../../../hooks/useBreakpoint'
import ExampleCard from './ExampleCard'
import { rankExamples, examplesFailureText, REDUCED_MOTION } from './examplesModel'
import styles from './ExamplesGallery.module.css'

/**
 * Notebook widgets phase 2 (wave 8, Task 8.16): the builder's start screen, "Start from an example" (spec 5.2 step 1).
 *
 * The ready-made widgets as cards (`GET /shelf`: `{examples: [{id, name, description, keywords, plan}]}`), plus "Start
 * blank", with a search over each card's name and keywords: a NAME match ranks above a keyword match, and within a
 * tier the shelf's own order holds.
 *
 * Card results come from `POST /examples` (`{ids}` -> `{sample, cards: {id: payload}}`, at most 8 ids), asked for as
 * cards scroll into view (one IntersectionObserver over the card list items, rooted on the sheet's own scroller so
 * its margin reaches ahead of what is in view):
 *   * Newly visible cards are COALESCED for `COALESCE_MS`, then sent as ONE batch, topped up to `BATCH` with the next
 *     cards in display order that were never asked for. At most ONE batch is in flight (fix 1, I-3): the server's gate
 *     holds a handful of slots, and three batches at once made the gallery manufacture its own "busy".
 *   * ⛔ A card already asked for is NEVER asked for again: not when it scrolls out and back, not when the search
 *     hides and shows it, not when the member goes into the builder and back (this component stays mounted, hidden).
 *   * On `busy` a card keeps its skeleton and its batch is asked for ONCE more after `BUSY_RETRY_MS` (the slot stays
 *     held meanwhile). A second busy leaves the card's bare shape; "busy" is never shown on a card.
 *   * Any other refusal leaves the cards' bare shapes and ONE line above the list. "Try again" (and the browser
 *     coming back online) asks once more for those cards only. A failed list read is read again on 'online' too.
 *   * `sample: true` (fewer than 5 closed trades): a "Sample data" ribbon on every answered card and a banner with
 *     Link broker and Log a trade. The server resolves a sample card's range against the sample book's own last day.
 *   * Wave 9 (Task 9.19, spec 5.2 step 1): on sample data, a first step that needs no trades sits above the cards,
 *     "Set up your pre-market routine (1 minute)". It opens the routine editor on the ready-made pre-market routine
 *     (a dynamic import: the editor stays off this chunk); from a note's builder the builder gives way to it, and
 *     saving puts the routine at the caret (the door: builderDoor.js).
 *
 * The two live regions (the search's count, the refused-batch line) are ALWAYS mounted and only their text changes,
 * so a screen reader hears them; the count is debounced. Escape in a non-empty search clears it (`clearSearchRef`,
 * which the sheet asks before it backs out).
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
/** Task 9.19: the first step for a member on sample data (spec 5.2 step 1). */
export const FIRST_STEP = 'Set up your pre-market routine (1 minute)'
export const FIRST_STEP_HINT = 'A short list you tick every trading day. It needs no trades.'
/** At most this many cards per `POST /examples` (the server's MAX_EXAMPLES). */
export const BATCH = 8
/** A busy batch is asked for once more after this long, and never again. */
export const BUSY_RETRY_MS = 1500
/** Cards that come into view within this long of each other go in one batch. */
export const COALESCE_MS = 150
/** The search's result count is read out this long after typing stops. */
export const COUNT_DELAY_MS = 500

const isRecord = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

const shelfOf = (data) => (Array.isArray(data?.examples) ? data.examples : [])
  .filter((e) => isRecord(e) && typeof e.id === 'string' && e.id && typeof e.name === 'string' && isRecord(e.plan))

/** The nearest ancestor that scrolls (the sheet's own scroller), or null for the viewport. */
function scrollerOf(el) {
  for (let p = el?.parentElement || null; p && p !== document.body; p = p.parentElement) {
    let oy = ''
    try { oy = window.getComputedStyle(p).overflowY } catch { oy = '' }
    if (oy === 'auto' || oy === 'scroll') return p
  }
  return null
}

function ExamplesGallery({
  hidden = false, resume = null, resumeRef = null, clearSearchRef = null, onResume, onFresh, onOpen, onBlank, onLink,
}) {
  const [shelf, setShelf] = useState({ status: 'loading', list: [], code: '' })
  const [shelfTick, setShelfTick] = useState(0)
  const [cards, setCards] = useState(() => new Map())
  const [sample, setSample] = useState(false)
  const [note, setNote] = useState('')
  const [query, setQuery] = useState('')
  const [countSaid, setCountSaid] = useState('')
  const reduce = useMediaQuery(REDUCED_MOTION)
  // The builder's layout changes at the phone boundary (640 / 641 px), and with it which element scrolls the cards.
  const phone = useIsPhone()
  const searchId = useId()
  const rootEl = useRef(null)
  const mounted = useRef(true)
  const requested = useRef(new Set())     // every id ever asked for: never asked for again on its own
  const failed = useRef(new Set())        // refused (not busy): asked for again only by Try again / back online
  const visible = useRef(new Set())
  const wanted = useRef([])               // in view, not yet asked for: the next batch's first members
  const inFlight = useRef(false)
  const flushTimer = useRef(null)
  const timers = useRef(new Set())
  const nodes = useRef(new Map())         // id -> list item
  const order = useRef([])                // the cards in display order (the top-up follows it)
  const shelfState = useRef(shelf.status)
  const io = useRef(null)
  const door = useContext(BuilderDoor)

  const shown = useMemo(() => rankExamples(shelf.list, query), [shelf.list, query])
  useEffect(() => { order.current = shown.map((e) => e.id) }, [shown])
  useEffect(() => { shelfState.current = shelf.status }, [shelf.status])

  useEffect(() => {
    mounted.current = true
    const pending = timers.current
    return () => {
      mounted.current = false
      for (const t of pending) clearTimeout(t)
      pending.clear()
      if (flushTimer.current) clearTimeout(flushTimer.current)
      flushTimer.current = null
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

  const wait = useCallback((ms) => new Promise((resolve) => {
    const t = setTimeout(() => { timers.current.delete(t); resolve() }, ms)
    timers.current.add(t)
  }), [])

  /** Ask for one batch (<= BATCH ids); resolves once it has settled. A busy answer is asked for once more. */
  const send = useCallback(async (ids) => {
    for (let retry = false; ; retry = true) {
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
        await wait(BUSY_RETRY_MS)               // the skeleton stays; ONE more try, and never another
        if (!mounted.current) return
        continue
      }
      settle(ids, () => ({ status: 'static' }))
      if (got.code === 'busy') return            // busy twice: the bare shape, and nothing said
      for (const id of ids) failed.current.add(id)
      setNote(examplesFailureText(got.code, CARDS_FAILED))
      return
    }
  }, [settle, wait])

  /** Send the next batch, when none is out: the cards wanted first (display order), topped up to BATCH. */
  const flush = useCallback(() => {
    flushTimer.current = null
    if (inFlight.current || !mounted.current) return
    const ids = order.current
    const at = (id) => { const i = ids.indexOf(id); return i < 0 ? Infinity : i }
    const queue = wanted.current.filter((id) => !requested.current.has(id)).sort((a, b) => at(a) - at(b))
    if (!queue.length) { wanted.current = []; return }
    const batch = queue.slice(0, BATCH)
    const last = Math.max(...batch.map(at).filter(Number.isFinite), -1)
    for (const id of ids.slice(last + 1)) {
      if (batch.length >= BATCH) break
      if (!requested.current.has(id) && !batch.includes(id)) batch.push(id)
    }
    wanted.current = queue.filter((id) => !batch.includes(id))
    for (const id of batch) requested.current.add(id)
    inFlight.current = true
    send(batch).finally(() => {
      inFlight.current = false
      if (mounted.current && wanted.current.length) flush()
    })
  }, [send])

  const want = useCallback((ids) => {
    for (const id of ids) {
      if (!requested.current.has(id) && !wanted.current.includes(id)) wanted.current.push(id)
    }
    if (wanted.current.length && !flushTimer.current) flushTimer.current = setTimeout(flush, COALESCE_MS)
  }, [flush])

  /** Try again (or back online): the refused cards in view, once. A failed list read is read again. */
  const retryFailed = useCallback(() => {
    if (shelfState.current === 'failed') {
      setShelf((st) => ({ ...st, status: 'loading' }))
      setShelfTick((n) => n + 1)
    }
    const ids = [...failed.current].filter((id) => visible.current.has(id))
    if (!ids.length) return
    for (const id of ids) { failed.current.delete(id); requested.current.delete(id) }
    setNote('')
    settle(ids, () => ({ status: 'loading' }))
    want(ids)
  }, [want, settle])

  useEffect(() => {
    window.addEventListener('online', retryFailed)
    return () => window.removeEventListener('online', retryFailed)
  }, [retryFailed])

  // One observer for every card, rooted on the sheet's scroller: what comes into view is wanted. Rebuilt when the width
  // crosses the phone boundary (8.16 N5): the builder lays out differently there, so the scroller is found again.
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return undefined
    const obs = new IntersectionObserver((entries) => {
      const fresh = []
      for (const e of entries) {
        const id = e.target.getAttribute('data-example-id')
        if (!id) continue
        if (!e.isIntersecting) { visible.current.delete(id); continue }
        visible.current.add(id)
        if (!requested.current.has(id)) fresh.push(id)
      }
      if (fresh.length) want(fresh)
    }, { root: scrollerOf(rootEl.current), rootMargin: '160px 0px' })
    io.current = obs
    for (const el of nodes.current.values()) obs.observe(el)
    return () => {
      obs.disconnect()
      io.current = null
    }
  }, [want, phone])

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

  // The search's count, read out once typing stops (the region itself is always there).
  const searching = query.trim() !== ''
  const countText = searching ? `${shown.length} ${shown.length === 1 ? 'example' : 'examples'}` : ''
  useEffect(() => {
    const t = setTimeout(() => setCountSaid(countText), COUNT_DELAY_MS)
    return () => clearTimeout(t)
  }, [countText])

  // Escape in a non-empty search clears it first (the sheet asks this before it backs out).
  const queryRef = useRef(query)
  useEffect(() => { queryRef.current = query }, [query])
  useEffect(() => {
    if (!clearSearchRef) return undefined
    clearSearchRef.current = (target) => {
      if (!queryRef.current || !(target instanceof Element) || !target.hasAttribute('data-gallery-search')) return false
      setQuery('')
      return true
    }
    return () => { clearSearchRef.current = null }
  }, [clearSearchRef])

  const motion = !reduce

  /** The first step: the builder gives way (from a note's door) and the routine editor opens on the ready-made
   *  pre-market routine; saving it puts it at the caret when there is a note to put it in. */
  const firstStep = () => {
    const editor = door?.editor || null
    const go = () => import('../routines/openRoutineEditor').then((m) => {
      m.openRoutineEditor({
        starter: 'premarket', editor,
        onSaved: editor ? (routine) => { insertToolBlock(editor, 'routine', routine) } : undefined,
        returnFocus: editor?.view?.dom || null,
      })
    }, () => {
      // A lost chunk is said, never silent: here while the gallery is still up, else in the note's own toast (the
      // builder has already given way).
      if (mounted.current) setNote(doorLostSentence())
      else editor?.storage?.uctJournalWidgets?.notify?.(doorLostSentence(), 'error')
    })
    if (typeof door?.close === 'function') {
      door.close()
      // After the builder's own unmount (its close waits a tick), so its Sheet hands focus back before the next one.
      setTimeout(go, 0)
    } else {
      go()
    }
  }

  return (
    <div className={styles.gallery} hidden={hidden} data-testid="examples-gallery" ref={rootEl}>
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
            data-gallery-search="" placeholder="Win rate, drawdown, by weekday…"
            onChange={(e) => setQuery(e.target.value)} />
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
      {sample && widgetsWaveOn(9) && (
        <div className={styles.offer} role="group" aria-label={FIRST_STEP} data-testid="first-step">
          <p className={styles.hint}>{FIRST_STEP_HINT}</p>
          <div className={styles.actions}>
            <button type="button" className={styles.btnPrimary} onClick={firstStep}>{FIRST_STEP}</button>
          </div>
        </div>
      )}
      <div className={note ? styles.note : styles.noteIdle}>
        <p className={styles.noteText} role="status" data-testid="examples-note">{note}</p>
        {note && <button type="button" className={styles.btn} onClick={retryFailed}>Try again</button>}
      </div>
      <p className={styles.srOnly} role="status" data-testid="examples-count">{countSaid}</p>
      {shelf.status === 'loading' && <p className={styles.hint}>{SHELF_LOADING}</p>}
      {shelf.status === 'failed' && (
        <div className={styles.note}>
          <p className={styles.noteText} role="alert">{examplesFailureText(shelf.code, SHELF_FAILED)}</p>
          <button type="button" className={styles.btn} onClick={() => {
            setShelf((st) => ({ ...st, status: 'loading' }))
            setShelfTick((n) => n + 1)
          }}>Try again</button>
        </div>
      )}
      {shelf.status === 'ok' && (shown.length ? (
        // ⛔ role="list" spelled out: `list-style: none` drops the list role in Safari.
        <ul className={styles.list} role="list" aria-label="Examples">
          {shown.map((ex) => (
            <ExampleCard key={ex.id} example={ex} card={cards.get(ex.id)} sample={sample} motion={motion}
              onOpen={onOpen} observe={observe} />
          ))}
        </ul>
      ) : <p className={styles.hint}>{NO_MATCH}</p>)}
    </div>
  )
}

export default memo(ExamplesGallery)
