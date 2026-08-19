// app/src/pages/desk/ArticleReader.jsx
// The Desk → Articles → one article, read in full on UCT Intelligence rather
// than linked out to Substack.
//
// The body arrives as sanitized HTML from api/services/substack_article.py and
// is injected with dangerouslySetInnerHTML — the same shape Morning Wire has
// run for months. Injected markup can't carry React handlers, so the two
// interactive affordances (ticker chips, image lightbox) are wired by ONE
// delegated click listener on the container, which is also how MorningWire.jsx
// attaches its feedback controls.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import useSWR from 'swr'
import { ArticleIcon } from '../education/icons'
import UIcon from '../../components/ui/UIcon'
import TickerPopup from '../../components/TickerPopup'
import useLivePrices from '../../hooks/useLivePrices'
import { prefetchBar } from '../../utils/prefetchBars'
// Named `bookmark`, not `progress`: the component already has a `progress`
// state for the reading BAR, which would shadow a module called the same.
import * as bookmark from './articleProgress'
import { findScrollContainer, scrollMetrics } from './scrollContainer'
import styles from './ArticleReader.module.css'

// A Sunday Scans issue covers ~44 names; the rest sit behind a toggle so the
// masthead never costs a full phone screen before the prose starts.
const TICKER_PREVIEW = 12

const fetcher = async (url) => {
  const r = await fetch(url, { credentials: 'include' })
  if (!r.ok) {
    const err = new Error('fetch failed')
    err.status = r.status
    throw err
  }
  return r.json()
}

function fmtDate(unixSec) {
  if (!unixSec) return ''
  try {
    return new Date(unixSec * 1000).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric', year: 'numeric',
    })
  } catch {
    return ''
  }
}

export default function ArticleReader() {
  const { slug } = useParams()
  const navigate = useNavigate()
  const bodyRef = useRef(null)
  const [activeId, setActiveId] = useState('')
  const [progress, setProgress] = useState(0)
  const [lightbox, setLightbox] = useState(null)
  const [showAllTickers, setShowAllTickers] = useState(false)
  // A ticker click opens the member's OWN chart in place (TickerPopup →
  // ChartPane with stored=null resolves their /charts widget settings), rather
  // than navigating away mid-read. One popup per page, never per chip.
  const [chartSym, setChartSym] = useState(null)
  const [resumedAt, setResumedAt] = useState(null)   // section we jumped to, if any
  // ⛔ The scroll-spy effect is declared BEFORE the restore effect, so on mount
  // it runs first — at scroll position 0. Saving then would write pct=0 and
  // DELETE the bookmark before restore ever reads it, which is exactly how this
  // feature would have shipped broken. Nothing is written until restore has had
  // its turn.
  const restoreSettledRef = useRef(false)
  const armedForRef = useRef(null)
  // Re-armed DURING RENDER, not in an effect. Walking prev/next swaps the
  // article without unmounting, so the gate has to close before the scroll-spy
  // effect gets a chance to save at scroll position 0 and wipe the incoming
  // article's bookmark.
  //
  // An effect HERE would also work — effects run in declaration order and this
  // sits above the scroll-spy — but only for as long as it stays above it.
  // Doing it during render is correct no matter where the effects below get
  // moved to, which is the kind of ordering nobody re-checks later.
  if (armedForRef.current !== slug) {
    armedForRef.current = slug
    restoreSettledRef.current = false
  }

  const { data, error, isLoading } = useSWR(
    slug ? `/api/desk/articles/${encodeURIComponent(slug)}` : null,
    fetcher,
    { revalidateOnFocus: false },
  )

  const sections = useMemo(
    () => (data?.sections || []).filter((s) => s.text && s.text.length <= 60),
    [data],
  )

  // The Covered chips carry today's move, so the masthead answers "which of
  // these names is doing something RIGHT NOW" before the reader commits 18
  // minutes. Only the chips on screen join the shared live-price poll.
  const visibleTickers = useMemo(() => {
    const t = data?.tickers || []
    return showAllTickers ? t : t.slice(0, TICKER_PREVIEW)
  }, [data, showAllTickers])
  const { prices: livePx } = useLivePrices(visibleTickers)

  // ── one delegated listener for every affordance inside the injected HTML ──
  const onBodyClick = useCallback((e) => {
    const chip = e.target.closest?.('.uctTickerChip')
    if (chip) {
      // The chip stays an <a href="/research/..."> so it survives without JS,
      // but with JS it opens the chart popup in place instead of navigating a
      // reader away mid-article.
      e.preventDefault()
      const sym = chip.getAttribute('data-ticker')
      if (sym) setChartSym(sym)
      return
    }
    const img = e.target.closest?.('img[data-lightbox]')
    if (img) {
      e.preventDefault()
      setLightbox({ src: img.currentSrc || img.src, alt: img.alt || '' })
      return
    }
    // A reference to an earlier issue that the server resolved to our own
    // reader. Without this it is a plain <a href>, so clicking would reload the
    // whole SPA to land on a route we are already inside.
    const link = e.target.closest?.('a[href^="/"]')
    if (link && !link.getAttribute('target')) {
      e.preventDefault()
      navigate(link.getAttribute('href'))
    }
  }, [navigate])

  // ChartPane is a lazy chunk and a cold open holds its Suspense fallback on
  // the MODULE fetch, not data — so hovering a chip warms the bars the way
  // TickerPopup's own triggers do. Once per symbol per page view.
  const warmedRef = useRef(new Set())
  const warmChip = useCallback((sym) => {
    if (!sym || warmedRef.current.has(sym)) return
    warmedRef.current.add(sym)
    prefetchBar(sym)
  }, [])
  const onBodyHover = useCallback((e) => {
    warmChip(e.target.closest?.('.uctTickerChip')?.getAttribute('data-ticker'))
  }, [warmChip])

  // Scroll-spy + reading progress. Reads the SCROLL CONTAINER, not window —
  // this app scrolls an inner .main element (see Layout.module.css).
  useEffect(() => {
    if (!data?.body_html) return undefined
    // ⛔ MEASURED, never named. The app's scroller is a CSS Module, so its class
    // is hashed and a literal '.main' matches nothing — which silently pinned
    // scrollTop at 0 and killed the progress bar, the scroll-spy AND the saved
    // position at once, with every test still green.
    const scroller = findScrollContainer(bodyRef.current)

    let frame = 0
    const measure = () => {
      frame = 0
      // ⛔ Query the headings EVERY TIME, never capture them once. A captured
      // NodeList goes stale the moment React re-renders the injected body, and
      // a detached node reports a zero rect — every heading then looks "above
      // the fold" and the spy silently reports the LAST one in the document.
      // Nine elements per throttled frame is free; the staleness is not.
      const heads = Array.from(bodyRef.current?.querySelectorAll('h2[id], h3[id]') || [])
      const el = scrollMetrics(scroller)
      const max = el.scrollHeight - el.clientHeight
      setProgress(max > 0 ? Math.min(1, Math.max(0, el.scrollTop / max)) : 0)
      const top = el.getBoundingClientRect ? el.getBoundingClientRect().top : 0
      let current = ''
      for (const h of heads) {
        if (h.getBoundingClientRect().top - top < 120) current = h.id
        else break
      }
      setActiveId(current)
      // The scroll-spy already knows the section and the percentage; saving
      // here means the bookmark can never disagree with what the TOC says.
      if (slug && restoreSettledRef.current) {
        bookmark.save(slug, { sectionId: current, pct: max > 0 ? el.scrollTop / max : 0 })
      }
    }
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure) }
    measure()
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [data?.body_html])

  useEffect(() => {
    if (!lightbox) return undefined
    const onKey = (e) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [lightbox])

  // Put the reader back where they were. Runs once per article, AFTER the body
  // is in the DOM — and anchors on a HEADING, so the 99 lazily-loaded charts
  // growing the page underneath cannot move the target.
  useEffect(() => {
    if (!data?.body_html || !slug) return
    // Whatever happens below, saving resumes after this runs — otherwise a
    // reader who has no bookmark could never create one.
    const settle = () => { restoreSettledRef.current = true }
    const saved = bookmark.load(slug)
    if (!saved) return settle()
    const el = bodyRef.current?.querySelector(`#${CSS.escape(saved.sectionId)}`)
    if (!el) return settle()
    // ⛔ ONE scrollIntoView HERE IS DROPPED. The effect fires the moment ~100 KB
    // of article HTML is committed, before the browser has laid it out, so the
    // scroll container is not yet tall enough to scroll and the call silently
    // no-ops — leaving the reader at the top under a pill claiming otherwise.
    // Re-assert across a few frames until it actually lands, and only then say
    // so. (Same shape as the chart that discards an early setVisibleLogicalRange.)
    // The TOC omits very long headings, so a saved section can be absent from
    // it — fall back to the heading's own words rather than showing no pill.
    const label = (data.sections || []).find((s) => s.id === saved.sectionId)?.text
      || (el.textContent || '').trim().slice(0, 48) || null
    let cancelled = false
    let frame = 0
    // A WALL-CLOCK budget, not a frame count: how long the browser takes to lay
    // out ~100 KB of article and 60+ charts varies hugely by machine, and a
    // 30-frame (~0.5s) budget expired before the container was even scrollable.
    const deadline = Date.now() + 3000
    // If the reader starts scrolling, they have chosen their own position —
    // stop re-asserting rather than yanking them.
    const abort = () => { cancelled = true }
    const stamp = () => {
      if (cancelled) return
      const metrics = scrollMetrics(findScrollContainer(bodyRef.current))
      try {
        el.scrollIntoView({ block: 'start' })
      } catch {
        return settle()
      }
      if (metrics && metrics.scrollTop > 0) {
        setResumedAt(label || null)
        return settle()
      }
      if (Date.now() < deadline) frame = setTimeout(stamp, 60)
      else settle()   // gave up — never claim a jump that did not happen
    }
    window.addEventListener('wheel', abort, { passive: true, once: true })
    window.addEventListener('touchstart', abort, { passive: true, once: true })
    // ⛔ TIMERS, NOT requestAnimationFrame. rAF does not fire while a tab is not
    // painting, so an article opened in a BACKGROUND TAB would never restore —
    // the reader switches to it and finds themselves at the top. Measured:
    // 17 rAF callbacks scheduled, 0 run. Timers still fire (throttled) there.
    frame = setTimeout(stamp, 0)
    return () => {
      cancelled = true
      window.removeEventListener('wheel', abort)
      window.removeEventListener('touchstart', abort)
      if (frame) clearTimeout(frame)
    }
  }, [data?.body_html, slug])

  const startFromTop = useCallback(() => {
    bookmark.clear(slug)
    setResumedAt(null)
    const scroller = findScrollContainer(bodyRef.current)
    if (scroller === window) window.scrollTo({ top: 0 })
    else scroller.scrollTop = 0
  }, [slug])

  const jumpTo = (id) => {
    const el = bodyRef.current?.querySelector(`#${CSS.escape(id)}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  if (isLoading) {
    return (
      <div className={styles.page}>
        <div className={styles.skeletonTitle} />
        <div className={styles.skeletonLine} />
        <div className={styles.skeletonLine} />
      </div>
    )
  }

  if (error || !data) {
    // 409 = the roster has this post but no converted body yet. That is a
    // different story from "gone", and the reader must not pretend otherwise.
    const pending = error?.status === 409
    return (
      <div className={styles.page}>
        <Link className={styles.back} to="/desk?section=articles">
          <UIcon name="chevronRight" size={16} className={styles.backIcon} /> Articles
        </Link>
        <div className={styles.empty}>
          <span className={styles.emptyIcon} aria-hidden="true"><ArticleIcon size={30} /></span>
          <div className={styles.emptyTitle}>
            {pending ? 'This article is still being prepared' : 'Article not found'}
          </div>
          <div className={styles.emptyText}>
            {pending
              ? 'The full text is being pulled in. It will appear here shortly — the original is available in the meantime.'
              : 'This article may have been removed from the source publication.'}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <div className={styles.progressTrack} aria-hidden="true">
        <div className={styles.progressBar} style={{ transform: `scaleX(${progress})` }} />
      </div>

      <Link className={styles.back} to="/desk?section=articles">
        <UIcon name="chevronRight" size={16} className={styles.backIcon} /> Articles
      </Link>

      {/* Never move someone silently: say where they landed and offer the way
          back. Auto-dismisses by being trivially dismissible, not on a timer. */}
      {resumedAt && (
        <div className={styles.resumed} role="status">
          <span>Picked up at <strong>{resumedAt}</strong></span>
          <button type="button" className={styles.resumedBtn} onClick={startFromTop}>
            Start from the top
          </button>
        </div>
      )}

      <header className={styles.head}>
        <div className={styles.eyebrow}>{data.publication_name || 'UCT Intelligence'}</div>
        <h1 className={styles.title}>{data.title}</h1>
        <div className={styles.meta}>
          {/* The eyebrow above already carries the publication, and the author
              on this feed IS the publication — printing both says it twice. */}
          {data.author && data.author !== data.publication_name && <span>{data.author}</span>}
          {data.published_at ? <span>{fmtDate(data.published_at)}</span> : null}
          {data.reading_minutes ? <span>{data.reading_minutes} min read</span> : null}
          {data.image_count ? <span>{data.image_count} charts</span> : null}
        </div>
        {data.tickers?.length > 0 && (
          <div className={styles.tickerRow}>
            <span className={styles.tickerRowLabel}>Covered</span>
            <div className={styles.tickerRowChips}>
              {/* A Sunday Scans issue covers ~44 names. Showing all of them
                  costs roughly a phone screen of chips BEFORE the reader sees a
                  word of the article, so the tail is behind a toggle. */}
              {visibleTickers.map((sym) => {
                const chg = livePx[sym]?.change_pct
                return (
                  <button
                    key={sym} type="button" className={styles.tickerChip}
                    onClick={() => setChartSym(sym)}
                    onMouseEnter={() => warmChip(sym)}
                  >
                    {sym}
                    {Number.isFinite(chg) && (
                      <span className={chg >= 0 ? styles.chipGain : styles.chipLoss}>
                        {`${chg >= 0 ? '+' : ''}${chg.toFixed(1)}%`}
                      </span>
                    )}
                  </button>
                )
              })}
              {data.tickers.length > TICKER_PREVIEW && (
                <button
                  type="button"
                  className={styles.tickerMore}
                  onClick={() => setShowAllTickers((v) => !v)}
                >
                  {showAllTickers ? 'Show fewer' : `+${data.tickers.length - TICKER_PREVIEW} more`}
                </button>
              )}
            </div>
          </div>
        )}
      </header>

      <div className={styles.layout}>
        {sections.length > 2 && (
          <nav className={styles.toc} aria-label="In this article">
            <div className={styles.tocLabel}>In this article</div>
            <ul className={styles.tocList}>
              {sections.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`${styles.tocLink} ${activeId === s.id ? styles.tocLinkActive : ''}`}
                    style={{ paddingLeft: s.level >= 3 ? 18 : 8 }}
                    onClick={() => jumpTo(s.id)}
                  >
                    {s.text}
                  </button>
                </li>
              ))}
            </ul>
          </nav>
        )}

        <article
          ref={bodyRef}
          className={styles.body}
          onClick={onBodyClick}
          onMouseOver={onBodyHover}
          dangerouslySetInnerHTML={{ __html: data.body_html }}
        />
      </div>

      {data.related_video && (
        <Link
          className={styles.sessionCard}
          to={`/desk?section=videos&v=${data.related_video.youtube_id}`}
        >
          <span className={styles.sessionIcon} aria-hidden="true">
            <UIcon name="play" size={18} />
          </span>
          <span className={styles.sessionText}>
            <span className={styles.sessionLabel}>Watch the session</span>
            <span className={styles.sessionTitle}>{data.related_video.title}</span>
          </span>
          <UIcon name="chevronRight" size={16} />
        </Link>
      )}

      {/* prev/next walks the archive as a sequence; these cards walk it by
          SUBJECT — the issues that charted the most of the same names. */}
      {data.related?.length > 0 && (
        <nav className={styles.related} aria-label="Issues on the same names">
          <div className={styles.relatedLabel}>Issues on the same names</div>
          <div className={styles.relatedCards}>
            {data.related.map((r) => (
              <Link key={r.slug} className={styles.relatedCard} to={`/desk/article/${r.slug}`}>
                <span className={styles.relatedTitle}>{r.title}</span>
                <span className={styles.relatedMeta}>
                  {fmtDate(r.published_at)} · {r.shared_count} shared names
                </span>
                {r.shared?.length > 0 && (
                  <span className={styles.relatedShared}>{r.shared.join(' · ')}</span>
                )}
              </Link>
            ))}
          </div>
        </nav>
      )}

      {/* An archive is a sequence. Without this the only exit from an 18-minute
          read is the back link. */}
      {(data.adjacent?.previous || data.adjacent?.next) && (
        <nav className={styles.adjacent} aria-label="More issues">
          {data.adjacent.previous ? (
            <Link className={styles.adjPrev} to={`/desk/article/${data.adjacent.previous.slug}`}>
              <span className={styles.adjLabel}>← Previous issue</span>
              <span className={styles.adjTitle}>{data.adjacent.previous.title}</span>
            </Link>
          ) : <span />}
          {data.adjacent.next && (
            <Link className={styles.adjNext} to={`/desk/article/${data.adjacent.next.slug}`}>
              <span className={styles.adjLabel}>Next issue →</span>
              <span className={styles.adjTitle}>{data.adjacent.next.title}</span>
            </Link>
          )}
        </nav>
      )}

      <footer className={styles.foot}>
        Originally published on{' '}
        <a href={data.url} target="_blank" rel="noopener noreferrer">Substack</a>.
      </footer>

      {chartSym && (
        <TickerPopup sym={chartSym} open onClose={() => setChartSym(null)} />
      )}

      {lightbox && (
        <div className={styles.lightbox} role="dialog" aria-modal="true"
             onClick={() => setLightbox(null)}>
          <button type="button" className={styles.lightboxClose}
                  onClick={() => setLightbox(null)} aria-label="Close">×</button>
          <img className={styles.lightboxImg} src={lightbox.src} alt={lightbox.alt} />
        </div>
      )}
    </div>
  )
}
