import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import useSWR from 'swr'
import LoadFailed from '../LoadFailed'
import Sheet from '../../../../components/mobile/Sheet'
import { notebookFlag } from '../../lib/offline/notebookFlags'
import useStaggeredMount from '../../../charts/grid/useStaggeredMount'
import { makeGridWarmer } from '../../../charts/grid/gridWarm'
import { GRID_MAX_CELLS } from '../../../charts/grid/gridLayouts'
import { prefetchListAllTimeframes } from '../../../../utils/prefetchBars'
import BoardCard from './BoardCard'
import SimilarNames, { TEMPLATES_URL, fetchJson, findSimilarEnabled } from './SimilarNames'
import styles from './SetupsBoard.module.css'

/**
 * Wave 13 lane 13J -- the active setups board, the swing trader's morning cockpit, at
 * /journal/notebook/setups.
 *
 * Every open plan or watch note with drawn levels is a live mini-chart card, closest to its
 * trigger first (the server sorts: `setups_board.sort_key`), 16 to a page (the multi-chart
 * grid's own cell cap, `GRID_MAX_CELLS`). Below it, "Find more like this" lists the member's
 * tagged charts; picking one opens tonight's precomputed matches (`SimilarNames`).
 *
 * ⛔⛔ HERD SAFETY (CLAUDE.md, Multi-Chart Grid Mode; plan risk R-10, the 2026-05-24 outage
 * class). A page of charts is the fetch herd the grid's recipe exists to prevent, so the board
 * IS that recipe:
 *   * `useStaggeredMount` -- at most `MOUNT_LIMIT` (3) charts loading at once; a slot frees
 *     on the chart's own `onBarsReady` or the 5 s safety timer. Never an eager mount.
 *   * each card's StockChart has `backgroundWarm={false}` (BoardCard.jsx);
 *   * warming goes ONLY through the prefetch module (`prefetchListAllTimeframes`, the bounded,
 *     idle-deferred queue), decided by the grid's own `makeGridWarmer` -- daily bars of the
 *     NEXT page, once this page's first paint has settled. Never a direct fetch;
 *   * streams ride the shared pools; nothing here opens one.
 * The rail is `SetupsBoard.test.jsx`, which mounts a 40-card board.
 */

export const BOARD_FLAG = 'notebook_setups_board_enabled'
export const BOARD_URL = '/api/j2/setups-board'
export const MOUNT_LIMIT = 3
export const PAGE_SIZE = GRID_MAX_CELLS
export const WARM_TFS = Object.freeze(['D'])

export function boardEnabled() {
  return notebookFlag(BOARD_FLAG) === true
}

export const cardKey = (c) => `${c.noteId}:${c.symbol}`

const warmDaily = (syms) => prefetchListAllTimeframes(syms, { tfs: WARM_TFS })

function Board({ onFindSimilar }) {
  const { data, error, isLoading, mutate } = useSWR(BOARD_URL, fetchJson,
    { revalidateOnFocus: false, shouldRetryOnError: false })
  const [page, setPage] = useState(0)
  const cards = useMemo(() => (Array.isArray(data?.cards) ? data.cards : []), [data])
  const pages = Math.max(1, Math.ceil(cards.length / PAGE_SIZE))
  const current = Math.min(page, pages - 1)
  const pageCards = useMemo(() => cards.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE), [cards, current])
  const warmer = useRef(null)
  if (!warmer.current) warmer.current = makeGridWarmer({ warm: warmDaily })
  const [painted, setPainted] = useState(0)
  const onPainted = useCallback((n) => setPainted(n), [])

  // Warm the NEXT page's daily bars once every chart on this page has reported its bars.
  useEffect(() => {
    const next = cards.slice((current + 1) * PAGE_SIZE, (current + 2) * PAGE_SIZE).map((c) => c.symbol)
    const ready = pageCards.length > 0 && painted >= pageCards.length
    warmer.current.maybeWarm(next, ready)
  }, [cards, current, pageCards.length, painted])

  return (
    <section className={styles.board} aria-labelledby="board-title" data-setups-board="">
      <div className={styles.header}>
        <h2 id="board-title" className={styles.title}>Active setups</h2>
        <span className={styles.scope}>
          Open plans with levels drawn on a chart, closest to the entry first.
        </span>
      </div>
      {error && <LoadFailed compact what="your setups" error={error} onRetry={() => mutate()} />}
      {!error && isLoading && <p className={styles.quiet} role="status">Reading your plans…</p>}
      {!error && data && cards.length === 0 && (
        <p className={styles.quiet}>
          No open setups yet. Draw an entry line on a chart in a plan note (and a stop, for the
          distance in R) and it shows here.
        </p>
      )}
      {!error && data?.capped && (
        <p className={styles.note} role="note">
          Only your {data.scanned} most recently edited chart notes were read.
        </p>
      )}
      {cards.length > 0 && (
        <BoardPage key={current} cards={pageCards} onFindSimilar={onFindSimilar} onPainted={onPainted} />
      )}
      {pages > 1 && (
        <nav className={styles.pager} aria-label="Setup pages">
          <button type="button" className={styles.action} disabled={current === 0}
            onClick={() => { setPainted(0); setPage(current - 1) }}>Previous</button>
          <span className={styles.scope}>Page {current + 1} of {pages}</span>
          <button type="button" className={styles.action} disabled={current >= pages - 1}
            onClick={() => { setPainted(0); setPage(current + 1) }}>Next</button>
        </nav>
      )}
    </section>
  )
}

/** One page of cards behind the mount queue. Each chart's first bars free its slot and count
 *  towards "this page has painted", which is what lets the warmer start (never before). */
function BoardPage({ cards, onFindSimilar, onPainted }) {
  const ids = useMemo(() => cards.map(cardKey), [cards])
  const { mountedIds, release } = useStaggeredMount(ids, { limit: MOUNT_LIMIT })
  const settledRef = useRef(new Set())
  const readyFns = useRef(new Map())
  const readyFor = useCallback((id) => {
    let fn = readyFns.current.get(id)
    if (!fn) {
      fn = () => {
        release(id)
        if (!settledRef.current.has(id)) {
          settledRef.current.add(id)
          onPainted(settledRef.current.size)
        }
      }
      readyFns.current.set(id, fn)
    }
    return fn
  }, [release, onPainted])
  return (
    <ul className={styles.grid} data-board-page="">
      {cards.map((c) => {
        const id = cardKey(c)
        return (
          <BoardCard key={id} card={c} mounted={mountedIds.has(id)} onBarsReady={readyFor(id)}
            onFindSimilar={onFindSimilar} />
        )
      })}
    </ul>
  )
}

function Templates({ onPick }) {
  const { data, error, isLoading, mutate } = useSWR(TEMPLATES_URL, fetchJson,
    { revalidateOnFocus: false, shouldRetryOnError: false })
  const items = Array.isArray(data?.templates) ? data.templates : []
  return (
    <section className={styles.board} aria-labelledby="similar-pick-title" data-similar-templates="">
      <div className={styles.header}>
        <h2 id="similar-pick-title" className={styles.title}>Find more like this</h2>
        <span className={styles.scope}>
          Your tagged charts, matched every night against the day’s scored names.
        </span>
      </div>
      {error && <LoadFailed compact what="your tagged charts" error={error} onRetry={() => mutate()} />}
      {!error && isLoading && <p className={styles.quiet} role="status">Reading your tagged charts…</p>}
      {!error && data && items.length === 0 && (
        <p className={styles.quiet}>Tag a chart in a note with its setup and it is matched tonight.</p>
      )}
      {items.length > 0 && (
        <ul className={styles.templateList}>
          {items.map((t) => (
            <li key={`${t.noteId}:${t.embedKey}`} className={styles.templateRow}>
              <span className={styles.symbol}>{t.symbol || '—'}</span>
              <span className={styles.chipText}>{t.setupTag}</span>
              <span className={styles.scope}>
                {t.matchCount ? `${t.matchCount} names, ${t.matchesAsOf}` : 'matched tonight'}
              </span>
              <button type="button" className={styles.action}
                aria-label={`Find more like ${t.symbol || 'this chart'} (${t.setupTag})`}
                onClick={() => onPick({ noteId: t.noteId, embedKey: t.embedKey, symbol: t.symbol })}>
                Find more like this
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

export default function SetupsBoard() {
  const boardOn = boardEnabled()
  const similarOn = findSimilarEnabled()
  const [params, setParams] = useSearchParams()
  const [picked, setPicked] = useState(() => {
    const raw = params.get('similar')
    if (!raw || !raw.includes(':')) return null
    const at = raw.indexOf(':')
    return { noteId: raw.slice(0, at), embedKey: raw.slice(at + 1) }
  })
  const open = useCallback((t) => {
    setPicked(t)
    setParams((p) => { const n = new URLSearchParams(p); n.set('similar', `${t.noteId}:${t.embedKey}`); return n }, { replace: true })
  }, [setParams])
  const close = useCallback(() => {
    setPicked(null)
    setParams((p) => { const n = new URLSearchParams(p); n.delete('similar'); return n }, { replace: true })
  }, [setParams])

  if (!boardOn && !similarOn) {
    return (
      <div className={styles.page}>
        <p className={styles.quiet}>This page is not available yet.</p>
        <Link className={styles.noteLink} to="/journal/notebook">Back to the Notebook</Link>
      </div>
    )
  }
  return (
    <div className={styles.page} data-setups-page="">
      <h1 className={styles.pageTitle}>Setups</h1>
      {boardOn && <Board onFindSimilar={similarOn ? open : null} />}
      {similarOn && <Templates onPick={open} />}
      {similarOn && picked && (
        <Sheet open onClose={close} variant="auto" title="Find more like this" labelledByTitle>
          <SimilarNames noteId={picked.noteId} embedKey={picked.embedKey} />
        </Sheet>
      )}
    </div>
  )
}
