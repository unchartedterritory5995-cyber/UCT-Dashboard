/**
 * useStudySession — the drill session's state (spec §7.2, §13.7 D7, D18).
 *
 * Loads a set (Today's Study from GET /api/study/today, or a payload handed in
 * by PractiseSheet / a `session=<id>` resume), keeps the current index, every
 * item's drill state, the scored results, the bars for the one chart (forward
 * bars appended on reveal, T6), and the offline outbox.
 *
 *   const s = useStudySession({ initial, sessionId })
 *   s.status            'loading' | 'ready' | 'error'
 *   s.items, s.index, s.current, s.finished
 *   s.answer(answer, timeMs) -> Promise<{correct, reveal, ...} | {failed, error}>
 *   s.next(), s.defer()      advance; move the current item to the end (D7 "Skip this one")
 *   s.getState(id) / s.setState(id, state)
 *   s.barsFor(id)            normalised bars (t as 'YYYY-MM-DD'), visible + forward
 *   s.ensureBars(id)         fetch /items/{id}/bars when the set did not inline them
 *   s.results, s.combo, s.summary   (summary.total/correct count scored items only;
 *                                    a walk-through counts in summary.seen, §13.9 #1)
 *
 * Offline (D18): the whole set is on the device the moment /today answers (it is
 * also cached in localStorage so a reload without a connection still opens it);
 * an answer is written to the ten-row outbox THE INSTANT Check is tapped and
 * replayed on `online`; a failed POST leaves the item "pending" and the member
 * continues. `time_ms` is analytics only.
 */
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { dequeueOutbox, enqueueOutbox, outboxRowId, readOutbox, replayOutbox } from './studyOutbox'

export const TODAY_URL = '/api/study/today'
export const ATTEMPTS_URL = '/api/study/attempts'
export const SESSIONS_URL = '/api/study/sessions'
export const SET_CACHE_KEY = 'study.set.cache'

export async function studyFetch(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = new Error(`${method} ${url} answered ${res.status}`)
    err.status = res.status
    throw err
  }
  return res.json()
}

/** Bars arrive as {t: 20250102 | '2025-01-02', o, h, l, c, v}; the chart wants 'YYYY-MM-DD'. */
export function normalizeBars(payload) {
  const list = Array.isArray(payload) ? payload : Array.isArray(payload?.bars) ? payload.bars : []
  return list.map((b) => {
    let t = b.t ?? b.time ?? b.date
    // a daily bar's integer key is YYYYMMDD (eight digits, 19000101..29991231); an hourly bar's
    // key is unix SECONDS (ten digits), which StockChart needs as a NUMBER, so only the first
    // form is rewritten to ISO and the second is passed through untouched
    if (typeof t === 'number' && t > 19000000 && t < 30000000) {
      const s = String(t)
      t = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
    }
    return { t: typeof t === 'number' ? t : String(t), o: Number(b.o ?? b.open), h: Number(b.h ?? b.high), l: Number(b.l ?? b.low), c: Number(b.c ?? b.close), v: Number(b.v ?? b.volume ?? 0) }
  })
}

/** Append forward bars to a visible window, deduped by date and kept in order. */
export function appendForwardBars(bars, forward) {
  const base = Array.isArray(bars) ? bars : []
  const extra = normalizeBars(forward)
  if (!extra.length) return base
  const seen = new Set(base.map((b) => b.t))
  const out = base.slice()
  for (const b of extra) if (!seen.has(b.t)) { seen.add(b.t); out.push(b) }
  return out
}

/** Item types the server records as seen, never graded (§13.9 #1). */
export const UNSCORED_TYPES = new Set(['walkthrough'])

export function isUnscoredItem(item) {
  return !!item && UNSCORED_TYPES.has(String(item.type || '').toLowerCase())
}

function readCache() {
  try {
    const raw = window.localStorage?.getItem(SET_CACHE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function writeCache(payload) {
  try { window.localStorage?.setItem(SET_CACHE_KEY, JSON.stringify(payload)) } catch { /* quota / private */ }
}

function hydrate(payload, { offline = false } = {}) {
  const items = Array.isArray(payload?.items) ? payload.items : []
  const answered = new Set(payload?.answered_item_ids || [])
  const results = {}
  for (const id of answered) results[id] = { answered: true, correct: null, resumed: true }
  const barsById = {}
  for (const it of items) if (it.bars) barsById[it.id] = normalizeBars(it.bars)
  const firstOpen = items.findIndex((it) => !answered.has(it.id))
  return {
    status: 'ready',
    error: null,
    offline,
    session: payload,
    sessionId: payload?.session_id ?? null,
    items,
    index: firstOpen < 0 ? items.length : firstOpen,
    states: {},
    results,
    barsById,
    combo: 0,
    comboBest: 0,
  }
}

const INITIAL = { status: 'loading', error: null, offline: false, session: null, sessionId: null, items: [], index: 0, states: {}, results: {}, barsById: {}, combo: 0, comboBest: 0 }

function reducer(state, action) {
  switch (action.type) {
    case 'reset': return state.status === 'loading' ? state : { ...INITIAL }
    case 'loaded': return hydrate(action.payload, { offline: !!action.offline })
    case 'failed': return { ...state, status: 'error', error: action.error }
    case 'state': return { ...state, states: { ...state.states, [action.id]: action.value } }
    case 'bars': return { ...state, barsById: { ...state.barsById, [action.id]: action.bars } }
    case 'pending': return { ...state, results: { ...state.results, [action.id]: { pending: true, answer: action.answer } } }
    case 'result': {
      const r = action.result
      const correct = !!r.correct
      // a seen walk-through (unscored) leaves the combo exactly where it was
      const unscored = !!r.unscored || isUnscoredItem(state.items.find((it) => it.id === action.id))
      const combo = unscored ? state.combo : correct ? state.combo + 1 : 0
      const next = { ...state, results: { ...state.results, [action.id]: { ...r, answered: true, pending: false, failed: false } }, combo, comboBest: Math.max(state.comboBest, combo) }
      if (r.reveal?.forward_bars?.length) {
        next.barsById = { ...state.barsById, [action.id]: appendForwardBars(state.barsById[action.id] || [], r.reveal.forward_bars) }
      }
      return next
    }
    case 'post-failed': {
      const keep = isUnscoredItem(state.items.find((it) => it.id === action.id))
      return { ...state, results: { ...state.results, [action.id]: { pending: true, failed: true, answer: action.answer, error: action.error } }, combo: keep ? state.combo : 0 }
    }
    case 'next': return { ...state, index: Math.min(state.items.length, state.index + 1) }
    case 'defer': {
      if (state.index >= state.items.length) return state
      const items = state.items.slice()
      const [cur] = items.splice(state.index, 1)
      items.push(cur)
      return { ...state, items }
    }
    default: return state
  }
}

export default function useStudySession({ initial = null, sessionId = null, fetcher = studyFetch } = {}) {
  const [s, dispatch] = useReducer(reducer, INITIAL)
  const [tick, setTick] = useState(0)
  const startedAt = useRef(null)
  const fetchRef = useRef(fetcher)
  fetchRef.current = fetcher

  // Load: a payload handed in, else Today's Study, else the device cache.
  useEffect(() => {
    let alive = true
    dispatch({ type: 'reset' })
    if (initial) {
      dispatch({ type: 'loaded', payload: initial })
      writeCache(initial)
      return () => { alive = false }
    }
    const cached = readCache()
    ;(async () => {
      try {
        const payload = await fetchRef.current(TODAY_URL)
        if (!alive) return
        writeCache(payload)
        dispatch({ type: 'loaded', payload })
      } catch (error) {
        if (!alive) return
        if (cached && (!sessionId || cached.session_id === sessionId)) {
          dispatch({ type: 'loaded', payload: cached, offline: true })
        } else {
          dispatch({ type: 'failed', error })
        }
      }
    })()
    return () => { alive = false }
  }, [initial, sessionId, tick])

  // A fresh item starts its clock (time_ms is analytics only, D18).
  useEffect(() => { startedAt.current = Date.now() }, [s.index, s.items])

  const current = s.items[s.index] || null
  const finished = s.status === 'ready' && s.index >= s.items.length

  const postAttempt = useCallback(async (row) => {
    const body = { item_id: row.item_id, answer: row.answer, session_id: row.session_id, time_ms: row.time_ms }
    return fetchRef.current(ATTEMPTS_URL, { method: 'POST', body })
  }, [])

  const answer = useCallback(async (answerObj, timeMs) => {
    const item = s.items[s.index]
    if (!item) return { failed: true, error: new Error('no item') }
    const elapsed = Number.isFinite(timeMs) ? timeMs : Date.now() - (startedAt.current || Date.now())
    const row = { id: outboxRowId(s.sessionId, item.id), item_id: item.id, answer: answerObj, session_id: s.sessionId, time_ms: Math.max(0, Math.round(elapsed)), at: Date.now() }
    enqueueOutbox(row)
    dispatch({ type: 'pending', id: item.id, answer: answerObj })
    try {
      const result = await postAttempt(row)
      dequeueOutbox(row.id)
      dispatch({ type: 'result', id: item.id, result })
      return result
    } catch (error) {
      dispatch({ type: 'post-failed', id: item.id, answer: answerObj, error })
      return { failed: true, error }
    }
  }, [postAttempt, s.index, s.items, s.sessionId])

  const replay = useCallback(async () => {
    if (!readOutbox().length) return []
    const landed = await replayOutbox(postAttempt)
    for (const { row, result } of landed) dispatch({ type: 'result', id: row.item_id, result })
    return landed
  }, [postAttempt])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const onOnline = () => { replay() }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
  }, [replay])

  const ensureBars = useCallback(async (itemId) => {
    if (!itemId || s.barsById[itemId]) return s.barsById[itemId]
    const payload = await fetchRef.current(`/api/study/items/${encodeURIComponent(itemId)}/bars`)
    const bars = normalizeBars(payload)
    dispatch({ type: 'bars', id: itemId, bars })
    return bars
  }, [s.barsById])

  // The score counts the SCORED items only: a walk-through is seen, not
  // answered, so "7 of 10" never includes it; `seen` counts those read.
  const summary = useMemo(() => {
    let total = 0, correct = 0, answered = 0, xp = 0, pending = 0, seen = 0
    let last = null
    for (const it of s.items) {
      const r = s.results[it.id]
      if (isUnscoredItem(it) || r?.unscored) {
        if (r && !r.pending) seen += 1
        continue
      }
      total += 1
      if (!r) continue
      if (r.pending) { pending += 1; continue }
      if (r.answered) answered += 1
      if (r.correct) correct += 1
      xp += Number(r.progress?.xp_gained || 0)
      if (r.progress) last = r.progress
    }
    return { total, correct, answered, pending, seen, xp, comboBest: s.comboBest, progress: last }
  }, [s.items, s.results, s.comboBest])

  return {
    status: s.status,
    error: s.error,
    offline: s.offline,
    session: s.session,
    sessionId: s.sessionId,
    items: s.items,
    index: s.index,
    current,
    finished,
    results: s.results,
    combo: s.combo,
    summary,
    answer,
    replay,
    reload: useCallback(() => setTick((t) => t + 1), []),
    next: useCallback(() => dispatch({ type: 'next' }), []),
    defer: useCallback(() => dispatch({ type: 'defer' }), []),
    getState: useCallback((id) => s.states[id] ?? null, [s.states]),
    setState: useCallback((id, value) => dispatch({ type: 'state', id, value }), []),
    barsFor: useCallback((id) => s.barsById[id] || null, [s.barsById]),
    ensureBars,
    startedAt,
  }
}
