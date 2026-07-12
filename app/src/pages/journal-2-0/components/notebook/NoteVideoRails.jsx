// Watch rails for a Notebook video-note whose video is a Desk library session —
// the same companion content the Desk theater shows (chapters + setups + recap
// poster on the left; key takeaways + tickers covered on the right), wrapped
// around the note column instead of the theater player. Data comes from the
// caller's useVideoInsights; seeks go through the `uct:video-seek` event that
// NoteVideoHero already listens for, and follow-along highlights poll the hero
// player's clock via getNoteVideoTime.
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import TickerPopup from '../../../../components/TickerPopup'
import RsBadge from '../../../../components/RsBadge'
import { getNoteVideoTime } from './NoteVideoHero'
import styles from './NoteVideoRails.module.css'

const fmtT = (sec) => {
  const s = Math.max(0, Math.floor(sec || 0))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
           : `${m}:${String(ss).padStart(2, '0')}`
}

export const seekNoteVideo = (seconds) =>
  window.dispatchEvent(new CustomEvent('uct:video-seek', { detail: { seconds } }))

// Poll the hero player's clock and return the index of the last item whose
// moment is at/behind the playhead (chapters use first-match-backward; tickers
// use the most recent moment). Shared by both rails' follow-along highlights.
function useActiveIndex(items, mode) {
  const [active, setActive] = useState(-1)
  useEffect(() => {
    if (!items.length) { setActive(-1); return undefined }
    const tick = () => {
      const now = getNoteVideoTime()
      let idx = -1
      if (mode === 'latest') {
        let best = -1
        for (let i = 0; i < items.length; i++) {
          const tt = items[i].t || 0
          if (now >= tt - 0.5 && tt >= best) { best = tt; idx = i }
        }
      } else {
        for (let i = 0; i < items.length; i++) {
          if (now >= (items[i].t || 0) - 0.5) idx = i
          else break
        }
      }
      setActive((prev) => (prev === idx ? prev : idx))
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [items, mode])
  return active
}

function Skeleton({ rows, line }) {
  return (
    <div className={styles.skelList}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className={line ? styles.skelLine : styles.skelRow} />
      ))}
    </div>
  )
}

// LEFT rail — chapter nav + setups covered + the session recap poster.
export function NoteRailLeft({ insights }) {
  const { loading, chapters, setups, posterUrl } = insights
  const navigate = useNavigate()
  const listRef = useRef(null)
  const activeChapter = useActiveIndex(chapters, 'ordered')

  // Keep the active chapter visible by scrolling ONLY the chapter list —
  // scrollIntoView would also scroll the page's container, which on phone
  // (rail stacked below the note) yanks the whole page down on mount.
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector('[data-active="true"]')
    if (!list || !el || typeof el.getBoundingClientRect !== 'function') return
    const lr = list.getBoundingClientRect()
    const er = el.getBoundingClientRect()
    if (er.top < lr.top) list.scrollTop += er.top - lr.top
    else if (er.bottom > lr.bottom) list.scrollTop += er.bottom - lr.bottom
  }, [activeChapter])

  return (
    <aside className={styles.rail} aria-label="Session chapters and recap">
      {loading && chapters.length === 0 ? (
        <div>
          <div className={styles.insHead}>Chapters</div>
          <Skeleton rows={4} />
        </div>
      ) : chapters.length > 0 ? (
        <div>
          <div className={styles.insHead}>Chapters</div>
          <ol className={styles.chapterList} ref={listRef}>
            {chapters.map((c, i) => (
              <li key={`${c.t}-${i}`}>
                <button
                  type="button"
                  className={`${styles.chapterRow} ${i === activeChapter ? styles.chapterRowActive : ''}`}
                  data-active={i === activeChapter}
                  onClick={() => seekNoteVideo(c.t)}
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
        <div>
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
        <div>
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
  )
}

// RIGHT rail — key takeaways + tickers covered (chip → chart, time → seek).
export function NoteRailRight({ insights }) {
  const { loading, summary, tickerMoments } = insights
  const activeTicker = useActiveIndex(tickerMoments, 'latest')
  const [tickersOpen, setTickersOpen] = useState(() => {
    try { return window.localStorage.getItem('uct.notebook.tickersOpen') !== '0' } catch { return true }
  })
  const toggleTickers = useCallback(() => {
    setTickersOpen((o) => {
      const next = !o
      try { window.localStorage.setItem('uct.notebook.tickersOpen', next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  return (
    <aside className={styles.rail} aria-label="Session takeaways and tickers">
      {loading && summary.length === 0 && (
        <div>
          <div className={styles.insHead}>Key takeaways</div>
          <Skeleton rows={4} line />
        </div>
      )}
      {summary.length > 0 && (
        <div>
          <div className={styles.insHead}>Key takeaways</div>
          <ul className={styles.summaryList}>
            {summary.map((s, i) => <li key={i}>{s}</li>)}
          </ul>
        </div>
      )}
      {tickerMoments.length > 0 && (
        <div>
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
          {tickersOpen && (
            <div className={styles.tickerScroll}>
              <div className={styles.tickerRow}>
                {tickerMoments.map((tm, i) => (
                  <span
                    key={`${tm.ticker}-${tm.t}-${i}`}
                    className={`${styles.tickerChip} ${i === activeTicker ? styles.tickerChipActive : ''}`}
                    title={tm.note || tm.ticker}
                  >
                    <TickerPopup sym={tm.ticker} as="button" className={styles.tickerSym}>
                      {tm.ticker}
                    </TickerPopup>
                    <RsBadge sym={tm.ticker} size="sm" />
                    <button
                      type="button"
                      className={styles.tickerTime}
                      onClick={() => seekNoteVideo(tm.t)}
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
    </aside>
  )
}
