// News (Trade Exchange) — one widget's numbered pages of the retained archive.
//
// Each News widget pages on its own (state here, per mounted widget); every page
// is filtered and cut by the SERVER (fetchPage -> pages.py), never from the rows
// this browser happens to hold.
//
//   page 1   the live edge: the server's newest page merged with the live pool's
//            matches (livePage) -- new headlines appear at the top as they arrive.
//   page 2+  cut from a SNAPSHOT `seq <= top` fixed when the reader left page 1:
//            arriving headlines never shift its rows, duplicate one or skip one.
//            They are counted (`newer`) for the "Return to latest" notice instead.
//
// A filter change, a new epoch (database recreated) or Return to latest goes back
// to page 1; filters and presets are never reset by paging.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { fetchPage } from '../../../lib/tradeExchangeNewsStreamManager'
import { livePage, newerThan, PAGE_SIZE, pageCount } from './tradeExchangeNewsModel'

/**
 * @param feed     the shared pool's state (useSyncExternalStore(NEED...))
 * @param matches  the pool's rows passing this widget's filters, newest first
 * @param request  pageRequest(...) for the same filters (memoised by the caller)
 * @param enabled  false while the feed is unavailable (no requests)
 */
export default function useTradeExchangeNewsPages({ feed, matches, request, enabled = true }) {
  const reqKey = useMemo(() => JSON.stringify(request), [request])
  const [page, setPage] = useState(1)
  const [snap, setSnap] = useState(null)           // { top, epoch } while on page 2+
  const [resp, setResp] = useState(null)           // the newest server answer, with its key
  const [error, setError] = useState(null)
  const [nonce, setNonce] = useState(0)
  const epoch = feed.epoch

  // A different filter set, or a recreated database: back to the live page.
  const firstRun = useRef(true)
  useEffect(() => {
    if (firstRun.current) { firstRun.current = false; return }
    setPage(1)
    setSnap(null)
  }, [reqKey, epoch])

  const key = `${reqKey}|${page}|${snap?.top ?? 'live'}|${epoch ?? ''}`
  const loading = enabled && resp?.key !== key && !error
  useEffect(() => {
    if (!enabled || resp?.key === key) return undefined
    let dead = false
    setError(null)
    fetchPage({ ...request, page, top: snap?.top ?? null, epoch: snap?.epoch ?? epoch ?? null })
      .then((r) => {
        if (dead) return
        if (r.reset && snap) { setSnap(null); setPage(1); return }
        // A page past the end (the archive was pruned, or a typed number) is clamped
        // by the server; adopt the page it served under that page's own key.
        const served = r.page || page
        setResp({ ...r, reqKey, snapTop: snap?.top ?? null,
          key: `${reqKey}|${served}|${snap?.top ?? 'live'}|${epoch ?? ''}` })
        if (served !== page) setPage(served)
      })
      .catch((e) => { if (!dead) setError(e) })
    return () => { dead = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, enabled, nonce])

  const current = resp && resp.key === key ? resp : null
  // While the next page loads, the previous answer stays on screen (no blank flash).
  const shownResp = current || (resp && resp.reqKey === reqKey ? resp : null)

  const live = page === 1
  const poolBySeq = useMemo(() => new Map((feed.items || []).map((it) => [it.seq, it])), [feed.items])
  const rows = useMemo(() => {
    if (live) return livePage(shownResp?.snapTop == null ? shownResp?.items : [], matches)
    // A pool row carries the live repeat count; content and seq never change.
    return (shownResp?.items || []).map((it) => poolBySeq.get(it.seq) || it)
  }, [live, shownResp, matches, poolBySeq])

  // Totals: exact for the snapshot; page 1 adds what arrived after the server's top.
  const top = shownResp?.top ?? 0
  const arrived = live && shownResp ? newerThan(matches, top) : 0
  const total = shownResp ? shownResp.total + arrived : null
  let poolNewer = 0
  if (live && shownResp) {
    const items = feed.items || []
    for (let i = items.length - 1; i >= 0 && items[i].seq > top; i--) poolNewer++
  }
  const archiveTotal = shownResp ? (shownResp.archive_total || 0) + poolNewer : null
  const pages = live ? pageCount(total) : (current ? current.pages : shownResp?.pages ?? null)
  const newer = !live && snap ? newerThan(matches, snap.top) : 0

  const goTo = useCallback((n) => {
    const target = Math.max(1, Math.floor(n))
    if (target === page) return
    if (target === 1) { setSnap(null); setPage(1); return }
    if (!snap) {
      // Leaving the live page: fix the boundary at the newest headline it showed.
      const t = Math.max(shownResp?.top || 0, feed.lastSeq || 0)
      setSnap({ top: t, epoch: epoch ?? null })
    }
    setPage(target)
  }, [page, snap, shownResp, feed.lastSeq, epoch])
  const toLatest = useCallback(() => { setSnap(null); setPage(1) }, [])
  const retry = useCallback(() => { setError(null); setNonce((n) => n + 1) }, [])

  return {
    page, pages, rows, total, archiveTotal, newer, live, loading, error, retry, goTo, toLatest,
    size: PAGE_SIZE,
    oldestMs: shownResp?.oldest_ms ?? null,
    hiddenPlaceholders: shownResp ? shownResp.hidden_placeholders || 0 : null,
  }
}
