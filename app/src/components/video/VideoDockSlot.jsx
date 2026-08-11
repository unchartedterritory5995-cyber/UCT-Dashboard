// Placeholder the Desk Videos section renders where the "theater" lives.
//
// When DOCKED, it reserves a 16:9 box (the GlobalVideoLayer host overlays it),
// reports that box's rect to the store, and shows the rich browsing chrome
// (title/description + Up-Next rail). Leaving the docked box — by navigating
// away OR by the user intentionally minimizing — clears the slot, which floats
// the player as a corner mini.
//
// When MINIMIZED (the user parked the player in the corner but is still on the
// Desk), it shows a slim "restore to theater" strip instead of fighting the
// user by yanking the video back into the theater.
import { useEffect, useRef, useState, useMemo, useSyncExternalStore, useCallback, lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribe, getSnapshot, registerDockSlot, clearDockSlot, play, playIndex, expand, seekTo, getCurrentTime } from './videoStore'
import { useVideoInsights } from '../../hooks/useVideoInsights'
import { useVideoNotes } from '../../hooks/useVideoNotes'
import { useVideoRelated } from '../../hooks/useVideoRelated'
import { useVideoThread } from '../../hooks/useVideoThread'
import { useTickerReturns } from '../../hooks/useTickerReturns'
import TickerPopup from '../TickerPopup'
import RsBadge from '../RsBadge'
import TranscriptPanel from './TranscriptPanel'
import CompassAssistButton from '../voice/CompassAssistButton'
import UIcon from '../ui/UIcon'
import styles from './VideoDockSlot.module.css'

// Heavy lazy chunk — must not load for viewers who never open the follow pane.
const ChartPane = lazy(() => import('../chart/pane/ChartPane'))

const thumb = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`

const fmtT = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
           : `${m}:${String(ss).padStart(2, '0')}`
}

export default function VideoDockSlot() {
  const snap = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const { list, index, mode, selectSeq } = snap
  const active = mode !== 'closed' && list.length > 0
  const docked = mode === 'docked'
  const boxRef = useRef(null)
  const theaterRef = useRef(null)
  // Chapters + ticker-moments + recap for the now-playing video (empty for
  // non-session videos or before generation). Hook runs unconditionally.
  const { chapters, tickerMoments, headline, summary, posterUrl, loading, hasTranscript, setups } =
    useVideoInsights(active ? list[index]?.id : null)
  // Since-session % per ticker + the session's anchor date (Task 4) — same
  // videoId key as the insights hook above, so `current` isn't defined yet.
  const { anchorDate, returns } = useTickerReturns(active ? list[index]?.id : null)
  // % formatting: whole numbers ≥10 ('+14%'), one decimal below ('-3.4%').
  const fmtPct = (p) => `${p > 0 ? '+' : p < 0 ? '' : ''}${Math.abs(p) >= 10 ? Math.round(p) : p.toFixed(1)}%`
  const retTitle = (tm, r) => {
    const parts = [`Since session: ${fmtPct(r.since_pct)}`]
    if (Number.isFinite(r.d5_pct)) parts.push(`1w: ${fmtPct(r.d5_pct)}`)
    if (Number.isFinite(r.d21_pct)) parts.push(`1m: ${fmtPct(r.d21_pct)}`)
    return `${tm.note ? `${tm.note} · ` : ''}${parts.join(' · ')}`
  }
  // Timestamped notes for the now-playing video (keyed by youtube_id).
  const currentYt = active ? list[index]?.youtube_id : null
  const { notes, add: addNote, remove: removeNote } = useVideoNotes(currentYt)
  // Related sessions (shared tickers) + community discussion thread.
  const { related } = useVideoRelated(active ? list[index]?.id : null)
  const { enabled: communityEnabled, threadId } = useVideoThread(active ? list[index]?.id : null)
  const navigate = useNavigate()
  const [draft, setDraft] = useState(null) // { t, text } while composing, else null
  const [savingNb, setSavingNb] = useState('')
  const [savingWl, setSavingWl] = useState('') // save-tickers-to-watchlist status
  const [savingJournal, setSavingJournal] = useState('') // '', 'saving', 'saved', 'error'
  const savedNoteRef = useRef(null) // id of the journal note just created
  // Collapsible ticker cloud — remember the user's choice across videos.
  const [tickersOpen, setTickersOpen] = useState(() => {
    try { return window.localStorage.getItem('uct.desk.tickersOpen') !== '0' } catch { return true }
  })
  const toggleTickers = useCallback(() => {
    setTickersOpen((o) => {
      const next = !o
      try { window.localStorage.setItem('uct.desk.tickersOpen', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  // Chip order: chronological (default) or best→worst since-session %.
  const [sortByPerf, setSortByPerf] = useState(() => {
    try { return window.localStorage.getItem('uct.desk.tickerSort') === '1' } catch { return false }
  })
  const toggleSort = useCallback(() => {
    setSortByPerf((s) => {
      const next = !s
      try { window.localStorage.setItem('uct.desk.tickerSort', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  // Which chapter is playing now — for the left-rail highlight + auto-scroll.
  const [activeChapter, setActiveChapter] = useState(-1)
  const chapterListRef = useRef(null)
  const [activeTicker, setActiveTicker] = useState(-1) // ticker chip playing now
  // Sorting reorders the CHIPS; activeTicker stays an index into the CHRONOLOGICAL
  // tickerMoments, so the playing-now highlight compares moment IDENTITY, not index.
  const activeMoment = activeTicker >= 0 ? tickerMoments[activeTicker] : null
  const displayMoments = useMemo(() => {
    if (!sortByPerf) return tickerMoments
    return [...tickerMoments].sort((a, b) =>
      (returns[b.ticker]?.since_pct ?? -Infinity) - (returns[a.ticker]?.since_pct ?? -Infinity))
  }, [tickerMoments, sortByPerf, returns])
  const haveReturns = Object.keys(returns).length > 0

  // Follow-along chart: auto-switches to the ticker under discussion. OFF by
  // default — ChartPane is a heavy lazy chunk; it must not load for viewers who
  // never opt in. followSym reuses the identity-safe activeMoment above (the
  // moment whose timestamp the playhead is currently at/past), falling back to
  // the first covered ticker before playback crosses any moment.
  const [followOpen, setFollowOpen] = useState(() => {
    try { return window.localStorage.getItem('uct.desk.followChart') === '1' } catch { return false }
  })
  const toggleFollow = useCallback(() => {
    setFollowOpen((o) => {
      const next = !o
      try { window.localStorage.setItem('uct.desk.followChart', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])
  const [followTf, setFollowTf] = useState('D')
  const followSym = (activeMoment || tickerMoments[0])?.ticker || null

  const startNote = useCallback(() => setDraft({ t: getCurrentTime(), text: '' }), [])
  const saveDraft = useCallback(async () => {
    if (!draft || !draft.text.trim()) { setDraft(null); return }
    await addNote(draft.t, draft.text)
    setDraft(null)
  }, [draft, addNote])

  // Bundle all of a video's notes into a J2 Notebook entry (TipTap doc), with a
  // timestamp prefix per line. Best-effort; surfaces a tiny status string.
  const saveToNotebook = useCallback(async () => {
    if (!notes.length) return
    const title = (list[index]?.title || 'Video') + ' — Notes'
    const yt = list[index]?.youtube_id
    // Carry the source video on the note so the Notebook hero renders an
    // embedded player + link instead of the image picker.
    const heroImageUrl = yt ? `https://www.youtube.com/watch?v=${yt}` : undefined
    const content = notes.map((n) => ({
      type: 'paragraph',
      content: [
        { type: 'videoTimestamp', attrs: { seconds: n.t_seconds } },
        { type: 'text', text: ' ' + n.text },
      ],
    }))
    setSavingNb('saving')
    try {
      const r = await fetch('/api/j2/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, heroImageUrl, bodyJson: { type: 'doc', content } }),
      })
      setSavingNb(r.ok ? 'saved' : 'error')
    } catch {
      setSavingNb('error')
    }
    setTimeout(() => setSavingNb(''), 2500)
  }, [notes, list, index])

  // Turn the session's covered tickers into a fresh watchlist in one click.
  const saveToWatchlist = useCallback(async () => {
    const syms = [...new Set(tickerMoments.map((t) => t.ticker).filter(Boolean))]
    if (!syms.length) return
    setSavingWl('saving')
    try {
      const raw = (list[index]?.title || 'Session').replace(
        /^(live trading session|daily session|post market recap|thoughts on the market|fireside chat)\s*[—-]?\s*/i, '')
      const name = `Desk — ${(raw || list[index]?.title || 'Session').trim()}`.slice(0, 60)
      const r = await fetch('/api/watchlists', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      if (!r.ok) throw new Error('create')
      const wl = await r.json()
      if (!wl?.id) throw new Error('no id')
      const br = await fetch(`/api/watchlists/${wl.id}/items/bulk`, {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ symbols: syms }),
      })
      setSavingWl(br.ok ? 'saved' : 'error')
    } catch {
      setSavingWl('error')
    }
    setTimeout(() => setSavingWl(''), 3000)
  }, [tickerMoments, list, index])

  // Save this session's AI recap into the J2 Notebook as a long-form note —
  // headline, key takeaways, setups covered, tickers, and a watch link. Builds a
  // TipTap doc (the Notebook's native format) and reuses the existing /api/j2/notes
  // endpoint. On success, links straight to the new note.
  const saveToJournal = useCallback(async () => {
    if (savingJournal === 'saving') return
    const vid = list[index]
    if (!vid) return
    setSavingJournal('saving')
    try {
      const content = []
      if (headline) {
        content.push({ type: 'paragraph', content: [{ type: 'text', text: headline }] })
      }
      if (summary.length) {
        content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Key takeaways' }] })
        content.push({
          type: 'bulletList',
          content: summary.map((s) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: String(s) }] }],
          })),
        })
      }
      if (setups.length) {
        content.push({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Setups covered' }] })
        content.push({
          type: 'bulletList',
          content: setups.map((s) => ({
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: s.note ? `${s.setup} — ${s.note}` : s.setup }] }],
          })),
        })
      }
      const syms = [...new Set(tickerMoments.map((t) => t.ticker).filter(Boolean))]
      if (syms.length) {
        content.push({
          type: 'paragraph',
          content: [
            { type: 'text', marks: [{ type: 'bold' }], text: 'Tickers: ' },
            { type: 'text', text: syms.join(', ') },
          ],
        })
      }
      if (vid.youtube_id) {
        const url = `https://www.youtube.com/watch?v=${vid.youtube_id}`
        content.push({
          type: 'paragraph',
          content: [{ type: 'text', marks: [{ type: 'link', attrs: { href: url, target: '_blank' } }], text: 'Watch the session ↗' }],
        })
      }
      if (!content.length) {
        content.push({ type: 'paragraph', content: [{ type: 'text', text: 'Saved from The Desk.' }] })
      }
      const r = await fetch('/api/j2/notes', {
        method: 'POST', credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: (vid.title || 'Desk session').slice(0, 200),
          subtitle: 'Saved from The Desk',
          bodyJson: { type: 'doc', content },
          tags: ['desk-session'],
          ticker: syms[0] || null,
        }),
      })
      if (!r.ok) throw new Error('save')
      const j = await r.json()
      savedNoteRef.current = j?.note?.id || null
      setSavingJournal('saved')
    } catch {
      setSavingJournal('error')
    }
    setTimeout(() => setSavingJournal(''), 5000)
  }, [savingJournal, list, index, headline, summary, setups, tickerMoments])

  // Open (creating on first click) the community thread for this session.
  const openDiscussion = useCallback(async () => {
    let tid = threadId
    if (!tid) {
      try {
        const r = await fetch(`/api/education/videos/${list[index]?.id}/community-thread`, {
          method: 'POST', credentials: 'include',
        })
        if (r.ok) tid = (await r.json())?.thread_id
      } catch { /* ignore */ }
    }
    if (tid) navigate(`/community/${tid}`)
  }, [threadId, list, index, navigate])

  const report = useCallback(() => {
    const el = boxRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    // Pass the element too: GlobalVideoLayer reads its live rect every frame to
    // pin the fixed player to the slot without waiting on a React re-render.
    registerDockSlot({ top: r.top, left: r.left, width: r.width, height: r.height }, el)
  }, [])

  // Only track the rect while the theater box is on screen (docked). Leaving
  // docked — minimize OR navigate-away (unmount) — runs the cleanup → clearDockSlot.
  useEffect(() => {
    if (!docked) return
    report()
    const onScrollOrResize = () => report()
    window.addEventListener('scroll', onScrollOrResize, true)
    window.addEventListener('resize', onScrollOrResize)
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(report) : null
    if (ro && boxRef.current) ro.observe(boxRef.current)
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true)
      window.removeEventListener('resize', onScrollOrResize)
      if (ro) ro.disconnect()
      clearDockSlot()
    }
  }, [docked, report])

  // Picking a video from the shelves below the fold starts it playing
  // off-screen — jump the page up to the theater so the selection is visible.
  // Keyed on selectSeq (explicit user picks only), NOT the video id: autoplay-
  // next must never yank a user who scrolled down to read notes.
  useEffect(() => {
    if (!docked || !selectSeq) return
    const el = theaterRef.current || boxRef.current
    if (el && typeof el.scrollIntoView === 'function') {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [docked, selectSeq])

  // Track the playing chapter by polling the player clock (the store exposes no
  // time subscription); highlight it + scroll it into view in the left rail.
  useEffect(() => {
    if (!docked || chapters.length === 0) { setActiveChapter(-1); return }
    const tick = () => {
      const now = getCurrentTime()
      let idx = -1
      for (let i = 0; i < chapters.length; i++) {
        if (now >= (chapters[i].t || 0) - 0.5) idx = i
        else break
      }
      setActiveChapter((prev) => (prev === idx ? prev : idx))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [docked, chapters])

  // Scroll ONLY the chapter list to the active row — scrollIntoView also
  // scrolls the page's container, which on the stacked mobile layout yanks the
  // theater down to the rail whenever the playing chapter changes.
  useEffect(() => {
    const list = chapterListRef.current
    const el = list?.querySelector('[data-active="true"]')
    if (!list || !el || typeof el.getBoundingClientRect !== 'function') return
    const lr = list.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    if (er.top < lr.top) list.scrollTop += er.top - lr.top
    else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom
  }, [activeChapter])

  // Highlight the ticker chip whose moment is playing now (most recent moment
  // at/before the playhead) — the tickers half of the follow-along.
  useEffect(() => {
    if (!docked || tickerMoments.length === 0) { setActiveTicker(-1); return }
    const tick = () => {
      const now = getCurrentTime()
      let idx = -1, best = -1
      for (let i = 0; i < tickerMoments.length; i++) {
        const tt = tickerMoments[i].t || 0
        if (now >= tt - 0.5 && tt >= best) { best = tt; idx = i }
      }
      setActiveTicker((prev) => (prev === idx ? prev : idx))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [docked, tickerMoments])

  if (!active) return null

  const current = list[index]

  // Minimized while still on the Desk → slim restore affordance, not the theater.
  if (!docked) {
    return (
      <button className={styles.restoreStrip} onClick={() => expand()} aria-label="Restore to theater">
        <span className={styles.restoreThumbWrap}>
          <img className={styles.restoreThumb} src={thumb(current.youtube_id)} alt="" />
        </span>
        <span className={styles.restoreText}>
          <span className={styles.restoreEyebrow}>Playing in mini-player</span>
          <span className={styles.restoreTitle}>{current.title}</span>
        </span>
        <span className={styles.restoreCta}>Restore to theater</span>
      </button>
    )
  }

  const upcoming = list.slice(index + 1)
  // Left rail only earns its column when it has content (or is still loading);
  // plain library videos with no insights collapse to video + right rail.
  const hasLeft = loading || chapters.length > 0 || !!posterUrl || setups.length > 0

  return (
    <div ref={theaterRef} className={styles.theater}>
      <div className={`${styles.fourZone} ${hasLeft ? '' : styles.noLeft}`}>
        {/* CENTER — the player + its title/subtitle. */}
        <div className={styles.centerCol}>
          {/* Reserved 16:9 box the fixed player host positions itself over. */}
          <div ref={boxRef} className={styles.dockBox} aria-label={`Now playing: ${current.title}`} />
          <div className={styles.meta}>
            <div className={styles.title}>{current.title}</div>
            {headline && <p className={styles.headline}>{headline}</p>}
            {!headline && current.description && <p className={styles.desc}>{current.description}</p>}
          </div>
          {/* Actions under the video: talk it through with Compass + discuss. */}
          {((summary.length > 0 || chapters.length > 0) || communityEnabled) && (
            <div className={styles.compassRow}>
              {(summary.length > 0 || chapters.length > 0) && (
                <CompassAssistButton
                  label="Ask Compass about this session"
                  pageHint={
                    `The user is watching the Desk trading session "${current.title}". ` +
                    (headline ? `One-liner: ${headline} ` : '') +
                    (summary.length ? `Key takeaways: ${summary.join(' | ')} ` : '') +
                    (chapters.length ? `Chapters: ${chapters.map((c) => c.title).join(', ')}.` : '')
                  }
                />
              )}
              {communityEnabled && (
                <button
                  type="button"
                  className={styles.discussBtn}
                  onClick={openDiscussion}
                  title="Discuss this session with the community"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
                    <path d="M2 3.2h10v5.4H6.4L3.6 11V8.6H2z" fill="none"
                      stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                  </svg>
                  Discuss
                </button>
              )}
            </div>
          )}
          {/* Search-and-seek transcript — collapsed by default, lazy-loaded. */}
          <TranscriptPanel videoId={current.id} hasTranscript={hasTranscript} onSeek={seekTo} />
        </div>

        {/* LEFT — chapter nav + the recap poster. Only rendered when it has
            content (or is still loading); plain videos collapse it away. */}
        {hasLeft && (
          <aside className={styles.leftRail}>
            {loading && chapters.length === 0 ? (
              <div className={styles.chaptersWrap}>
                <div className={styles.insHead}>Chapters</div>
                <div className={styles.skelList}>
                  {[0, 1, 2, 3].map((i) => <div key={i} className={styles.skelRow} />)}
                </div>
              </div>
            ) : chapters.length > 0 ? (
              <div className={styles.chaptersWrap}>
                <div className={styles.insHead}>Chapters</div>
                <ol className={styles.chapterList} ref={chapterListRef}>
                  {chapters.map((c, i) => (
                    <li key={`${c.t}-${i}`}>
                      <button
                        className={`${styles.chapterRow} ${i === activeChapter ? styles.chapterRowActive : ''}`}
                        data-active={i === activeChapter}
                        onClick={() => seekTo(c.t)}
                      >
                        <span className={styles.chapterTime}>{fmtT(c.t)}</span>
                        <span className={styles.chapterTitle}>{c.title}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            ) : null}
            {setups.length > 0 && (
              <div className={styles.setupsWrap}>
                <div className={styles.insHead}>Setups covered</div>
                <div className={styles.setupRow}>
                  {setups.map((s, i) => (
                    <a
                      key={`${s.setup}-${i}`}
                      className={styles.setupChip}
                      href={`/model-book?view=setups&setup=${encodeURIComponent(s.setup)}`}
                      title={s.note ? `${s.setup} — ${s.note}` : `Study "${s.setup}" in the Setup Library`}
                      onClick={(e) => {
                        e.preventDefault()
                        navigate(`/model-book?view=setups&setup=${encodeURIComponent(s.setup)}`)
                      }}
                    >
                      {s.setup}
                    </a>
                  ))}
                </div>
              </div>
            )}
            {posterUrl && (
              <div className={styles.posterWrap}>
                <div className={styles.insHead}>Session recap</div>
                <a
                  className={styles.posterLink}
                  href={posterUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open the full session recap poster"
                >
                  <img className={styles.poster} src={posterUrl} alt="Session recap poster" />
                </a>
              </div>
            )}
          </aside>
        )}

        {/* RIGHT — key takeaways + tickers covered + your notes. */}
        <aside className={styles.rightRail}>
          {loading && summary.length === 0 && (
            <div className={styles.recapBody}>
              <div className={styles.insHead}>Key takeaways</div>
              <div className={styles.skelList}>
                {[0, 1, 2, 3].map((i) => <div key={i} className={styles.skelLine} />)}
              </div>
            </div>
          )}
          {summary.length > 0 && (
            <div className={styles.recapBody}>
              <div className={styles.insHead}>Key takeaways</div>
              <ul className={styles.summaryList}>
                {summary.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {tickerMoments.length > 0 && (
            <div className={styles.followWrap}>
              <button
                type="button"
                className={styles.followToggle}
                onClick={toggleFollow}
                aria-expanded={followOpen}
                title="A chart that automatically switches to the ticker being discussed"
              >
                <UIcon name="chart" size={13} />
                <span className={styles.insHead}>Chart follows discussion</span>
                <span className={styles.followState}>{followOpen ? 'On' : 'Off'}</span>
              </button>
              {followOpen && followSym && (
                <div className={styles.followPane}>
                  <Suspense fallback={<div className={styles.followLoading}>Loading chart…</div>}>
                    <ChartPane
                      sym={followSym}
                      tf={followTf}
                      onTfChange={setFollowTf}
                      stored={null}
                      density="mini"
                      stockChartProps={{
                        height: 260,
                        hideLegend: true, // the OHLC legend overlapped this small canvas
                        ...(anchorDate ? { anchorDate } : {}),
                      }}
                    />
                  </Suspense>
                </div>
              )}
            </div>
          )}
          {tickerMoments.length > 0 && (
            <div className={styles.tickersWrap}>
              {/* Collapsible so a long stream's ticker cloud doesn't dominate
                  the rail; scroll-capped when open. Save turns the covered
                  symbols into a fresh watchlist. */}
              <div className={styles.tickersHead}>
                <button
                  type="button"
                  className={styles.tickersToggle}
                  onClick={toggleTickers}
                  aria-expanded={tickersOpen}
                >
                  <svg
                    className={`${styles.tickersChevron} ${tickersOpen ? styles.tickersChevronOpen : ''}`}
                    width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"
                  >
                    <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor"
                      strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className={styles.insHead}>Tickers covered</span>
                  <span className={styles.tickersCount}>{tickerMoments.length}</span>
                </button>
                <button
                  type="button"
                  className={styles.saveWatchlistBtn}
                  onClick={saveToWatchlist}
                  disabled={savingWl === 'saving'}
                  title="Save these tickers to a new watchlist"
                >
                  {savingWl === 'saved' ? '✓ Saved'
                    : savingWl === 'error' ? 'Retry'
                    : savingWl === 'saving' ? 'Saving…'
                    : '+ Watchlist'}
                </button>
                {haveReturns && (
                  <button
                    type="button"
                    className={styles.tickerSortBtn}
                    onClick={toggleSort}
                    title={sortByPerf ? 'Showing best → worst since the session — click for discussion order' : 'Sort tickers by % move since the session'}
                  >
                    {sortByPerf ? '⇅ Perf' : '⇅ Order'}
                  </button>
                )}
              </div>
              {tickersOpen && (
                <div className={styles.tickerScroll}>
                  <div className={styles.tickerRow}>
                    {displayMoments.map((tm, i) => (
                      <span
                        key={`${tm.ticker}-${tm.t}-${i}`}
                        className={`${styles.tickerChip} ${tm === activeMoment ? styles.tickerChipActive : ''}`}
                        title={tm.note || tm.ticker}
                      >
                        {/* Symbol → chart ANCHORED at the session date · RS badge ·
                            since-session % · time → seek. */}
                        <TickerPopup sym={tm.ticker} anchorDate={anchorDate} as="button" className={styles.tickerSym}>
                          {tm.ticker}
                        </TickerPopup>
                        <RsBadge sym={tm.ticker} size="sm" />
                        {Number.isFinite(returns[tm.ticker]?.since_pct) && (
                          <span
                            className={`${styles.tickerRet} ${returns[tm.ticker].since_pct >= 0 ? styles.tickerRetPos : styles.tickerRetNeg}`}
                            title={retTitle(tm, returns[tm.ticker])}
                          >
                            {fmtPct(returns[tm.ticker].since_pct)}
                          </span>
                        )}
                        <button
                          className={styles.tickerTime}
                          onClick={() => seekTo(tm.t)}
                          title={`Jump to ${fmtT(tm.t)} in the video`}
                        >
                          {fmtT(tm.t)}
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          {/* Archive the whole AI session recap (takeaways + setups + tickers +
              watch link) into the Journal Notebook — distinct from "My notes"
              below, which saves your own timestamped jottings. */}
          {(headline || summary.length > 0 || setups.length > 0 || tickerMoments.length > 0) && (
            <div className={styles.journalWrap}>
              {savingJournal === 'saved' && savedNoteRef.current ? (
                <button
                  type="button"
                  className={styles.journalBtn}
                  onClick={() => navigate(`/journal?j2tab=notebook&note=${savedNoteRef.current}`)}
                  title="Open it in your Journal Notebook"
                >
                  ✓ Saved — open in Notebook →
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.journalBtn}
                  onClick={saveToJournal}
                  disabled={savingJournal === 'saving'}
                  title="Save this session's recap, setups, and tickers to your Journal Notebook"
                >
                  {savingJournal === 'error' ? 'Couldn’t save — retry'
                    : savingJournal === 'saving' ? 'Saving…'
                    : '★ Save session to Journal'}
                </button>
              )}
            </div>
          )}
          {/* My notes — jot a thought at the current timestamp; click to jump back. */}
          <div className={styles.notesWrap}>
          <div className={styles.notesHead}>
            <span className={styles.insHead}>My notes</span>
            <button className={styles.noteAddBtn} onClick={startNote}>+ Note at {fmtT(getCurrentTime())}</button>
          </div>
          {draft && (
            <div className={styles.noteComposer}>
              <span className={styles.noteComposerT}>{fmtT(draft.t)}</span>
              <textarea
                className={styles.noteInput}
                autoFocus
                rows={2}
                placeholder="What just happened? (saved at this timestamp)"
                value={draft.text}
                onChange={(e) => setDraft((d) => ({ ...d, text: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) saveDraft()
                  if (e.key === 'Escape') setDraft(null)
                }}
              />
              <div className={styles.noteComposerBtns}>
                <button className={styles.noteSaveBtn} onClick={saveDraft}>Save</button>
                <button className={styles.noteCancelBtn} onClick={() => setDraft(null)}>Cancel</button>
              </div>
            </div>
          )}
          {notes.length > 0 && (
            <>
              <ul className={styles.noteList}>
                {notes.map((n) => (
                  <li key={n.id} className={styles.noteRow}>
                    <button className={styles.noteTime} onClick={() => seekTo(n.t_seconds)} title="Jump to this moment">
                      {fmtT(n.t_seconds)}
                    </button>
                    <span className={styles.noteText}>{n.text}</span>
                    <button className={styles.noteDel} onClick={() => removeNote(n.id)} aria-label="Delete note">×</button>
                  </li>
                ))}
              </ul>
              <button className={styles.notebookBtn} onClick={saveToNotebook} disabled={savingNb === 'saving'}>
                {savingNb === 'saved' ? '✓ Saved to Notebook'
                  : savingNb === 'error' ? 'Couldn’t save — retry'
                  : savingNb === 'saving' ? 'Saving…'
                  : 'Save notes to Journal Notebook'}
              </button>
            </>
          )}
          </div>
        </aside>
      </div>

      {/* BOTTOM — full-width up-next related-videos shelf. */}
      <div className={styles.bottomBand}>
        {upcoming.length > 0 && (
          <div className={styles.upNext}>
            <div className={styles.upNextHead}>Up next in this section</div>
            <div className={styles.upNextRail}>
              {upcoming.map((v, i) => (
                <button
                  key={v.id ?? v.youtube_id}
                  className={styles.upNextItem}
                  onClick={() => playIndex(index + 1 + i)}
                >
                  <span className={styles.upNextThumbWrap}>
                    <img className={styles.upNextThumb} src={thumb(v.youtube_id)} alt="" loading="lazy" />
                  </span>
                  <span className={styles.upNextTitle}>{v.title}</span>
                </button>
              ))}
            </div>
          </div>
        )}
        {related.length > 0 && (
          <div className={styles.upNext}>
            <div className={styles.upNextHead}>More sessions on these tickers</div>
            <div className={styles.upNextRail}>
              {related.map((v) => (
                <button key={v.id} className={styles.upNextItem} onClick={() => play([v], 0)}>
                  <span className={styles.upNextThumbWrap}>
                    <img className={styles.upNextThumb} src={thumb(v.youtube_id)} alt="" loading="lazy" />
                  </span>
                  <span className={styles.upNextTitle}>{v.title}</span>
                  <span className={styles.relatedShared}>{v.shared.slice(0, 4).join(' · ')}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
