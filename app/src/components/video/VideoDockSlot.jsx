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
import { subscribe, getSnapshot, registerDockSlot, clearDockSlot, playIndex, expand, seekTo, getCurrentTime } from './videoStore'
import { useVideoInsights } from '../../hooks/useVideoInsights'
import { useVideoNotes } from '../../hooks/useVideoNotes'
import TickerPopup from '../TickerPopup'
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
  const { chapters, tickerMoments, headline, summary, posterUrl } =
    useVideoInsights(active ? list[index]?.id : null)
  // Timestamped notes for the now-playing video (keyed by youtube_id).
  const currentYt = active ? list[index]?.youtube_id : null
  const { notes, add: addNote, remove: removeNote } = useVideoNotes(currentYt)
  const [draft, setDraft] = useState(null) // { t, text } while composing, else null
  const [savingNb, setSavingNb] = useState('')
  const [tickersOpen, setTickersOpen] = useState(true) // collapsible ticker cloud

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

  return (
    <div className={styles.theater}>
      <div className={styles.fourZone}>
        {/* CENTER — the player + its title/subtitle. */}
        <div className={styles.centerCol}>
          {/* Reserved 16:9 box the fixed player host positions itself over. */}
          <div ref={boxRef} className={styles.dockBox} aria-label={`Now playing: ${current.title}`} />
          <div className={styles.meta}>
            <div className={styles.title}>{current.title}</div>
            {headline && <p className={styles.headline}>{headline}</p>}
            {!headline && current.description && <p className={styles.desc}>{current.description}</p>}
          </div>
        </div>

        {/* LEFT — chapter nav + the recap poster. */}
        <aside className={styles.leftRail}>
          {chapters.length > 0 && (
            <div className={styles.chaptersWrap}>
              <div className={styles.insHead}>Chapters</div>
              <ol className={styles.chapterList}>
                {chapters.map((c, i) => (
                  <li key={`${c.t}-${i}`}>
                    <button className={styles.chapterRow} onClick={() => seekTo(c.t)}>
                      <span className={styles.chapterTime}>{fmtT(c.t)}</span>
                      <span className={styles.chapterTitle}>{c.title}</span>
                    </button>
                  </li>
                ))}
              </ol>
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

        {/* RIGHT — key takeaways + tickers covered. */}
        <aside className={styles.rightRail}>
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
                  the rail; scroll-capped when open. */}
              <button
                type="button"
                className={styles.tickersToggle}
                onClick={() => setTickersOpen((o) => !o)}
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
              {tickersOpen && (
                <div className={styles.tickerScroll}>
                  <div className={styles.tickerRow}>
                    {tickerMoments.map((tm, i) => (
                      <span
                        key={`${tm.ticker}-${tm.t}-${i}`}
                        className={styles.tickerChip}
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
      </div>
    </div>
  )
}
