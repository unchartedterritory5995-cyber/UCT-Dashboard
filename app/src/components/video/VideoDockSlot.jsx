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
import { useEffect, useRef, useState, useSyncExternalStore, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { subscribe, getSnapshot, registerDockSlot, clearDockSlot, play, playIndex, expand, seekTo, getCurrentTime } from './videoStore'
import { useVideoInsights } from '../../hooks/useVideoInsights'
import { useVideoNotes } from '../../hooks/useVideoNotes'
import { useVideoRelated } from '../../hooks/useVideoRelated'
import { useVideoThread } from '../../hooks/useVideoThread'
import TickerPopup from '../TickerPopup'
import TranscriptPanel from './TranscriptPanel'
import CompassAssistButton from '../voice/CompassAssistButton'
import styles from './VideoDockSlot.module.css'

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
  const { list, index, mode } = snap
  const active = mode !== 'closed' && list.length > 0
  const docked = mode === 'docked'
  const boxRef = useRef(null)
  // Chapters + ticker-moments + recap for the now-playing video (empty for
  // non-session videos or before generation). Hook runs unconditionally.
  const { chapters, tickerMoments, headline, summary, posterUrl, loading, hasTranscript } =
    useVideoInsights(active ? list[index]?.id : null)
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
  // Which chapter is playing now — for the left-rail highlight + auto-scroll.
  const [activeChapter, setActiveChapter] = useState(-1)
  const chapterListRef = useRef(null)
  const [activeTicker, setActiveTicker] = useState(-1) // ticker chip playing now

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
    registerDockSlot({ top: r.top, left: r.left, width: r.width, height: r.height })
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

  useEffect(() => {
    const el = chapterListRef.current?.querySelector('[data-active="true"]')
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' })
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
  const hasLeft = loading || chapters.length > 0 || !!posterUrl

  return (
    <div className={styles.theater}>
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
              </div>
              {tickersOpen && (
                <div className={styles.tickerScroll}>
                  <div className={styles.tickerRow}>
                    {tickerMoments.map((tm, i) => (
                      <span
                        key={`${tm.ticker}-${tm.t}-${i}`}
                        className={`${styles.tickerChip} ${i === activeTicker ? styles.tickerChipActive : ''}`}
                        title={tm.note || tm.ticker}
                      >
                        {/* Click the symbol → open the chart; click the time → seek the video. */}
                        <TickerPopup sym={tm.ticker} as="button" className={styles.tickerSym}>
                          {tm.ticker}
                        </TickerPopup>
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
