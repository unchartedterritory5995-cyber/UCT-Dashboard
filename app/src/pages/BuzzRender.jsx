// app/src/pages/BuzzRender.jsx — headless, token-gated /buzz board export.
//
// Renders the Discord `/buzz` board image: the top tickers with full
// treatment (rank/count/magnitude bar/people/heat), and the tail — 2+ mentions
// and once-named alike — as READABLE chips. The tail is not decoration: the
// owner asked specifically to see the 1-3 mention names (2026-09-02).
// ⛔ NO PROSE LEAD — the owner reviewed a rendered board with a two-sentence
// derived lead at the top and rejected it (2026-09-01). Do not re-add one.
// A headless browser (chart-renderer) navigates to /r/buzz, waits for
// window.__buzzReady, and screenshots #buzz-export.
//
// Design is LOCKED to the owner-reviewed reference —
// docs/superpowers/design/2026-09-01-buzz-board-reference.html — not
// reinvented here. See task-8-report.md for the handful of places that file
// and the task brief's own prose disagree (this component follows the
// rendered reference). (⚠️ this comment previously named a "-v4-" filename
// that does not exist on disk — corrected 2026-09-01 during the
// brand-treatment port, see task-8-brand-port-report.md.)
// ⛔ The reference is regenerated IN THE SAME COMMIT as any change here.
// A committed design file that lags the component becomes a second authority
// over one value, which has already silently overridden two rulings on this
// branch — see progress.md.
//
// Public route (no AuthGuard). Data comes from /api/r/buzz?token= (a
// token-gated public read over the buzz store — aggregate counts/tickers
// only, never author_id/message_id/jump links). ?token= is checked against
// VITE_CHART_RENDER_TOKEN, same pattern as ChartRender/CatalystsRender.
//
// window.__buzzReady is set from ROWS THAT HAVE LAID OUT (measured height >
// 0), never from mount. A sized container is not a drawn board -- that
// mistake shipped blank chart images twice in this repo.

import { useEffect, useRef, useState } from 'react'
import uctLogo from '../components/intro/assets/compass-mark.png'
import styles from './BuzzRender.module.css'

const TOKEN = import.meta.env.VITE_CHART_RENDER_TOKEN || ''

// ⛔ THE EXPORT CONTAINER'S GEOMETRY IS INLINE, AND MUST STAY INLINE.
// `id="buzz-export"` is a literal string because buzz_image.py screenshots
// `{"selector": "#buzz-export"}` — but this page's stylesheet is a CSS
// MODULE, and css-modules scopes bare *id* selectors exactly like classes
// (postcss-modules-local-by-default handles `case "id": case "class":` in one
// branch). A `#buzz-export { width: 1000px }` rule in BuzzRender.module.css
// compiles to `#_buzz-export_1ey3r_1` and matches NOTHING — verified against
// this repo's own `npm run build`: the literal `#buzz-export{` appears zero
// times in dist/assets/*.css.
//
// It shipped that way and nothing could see it. jsdom computes no layout, so
// BuzzRender.test.jsx is blind to it; buzz_image.PROBE_JS counts
// [data-buzz-row] elements, which still EXIST, so the probe reports "drawn"
// and hands back a mislaid-out PNG. Unstyled, the board filled chart-renderer's
// 1400px viewport instead of its designed 1000px, which doubled the row grid's
// `1fr` column and pushed every people/heat cell ~800px away from the count it
// annotates — i.e. the posted image was never the layout that was reviewed.
//
// ChartRender, MoversRender and CatalystsRender all set their export
// container's geometry inline for this reason; this is that house idiom, not
// a local workaround. Class-based rules in the module are unaffected (they
// are scoped and referenced through `styles.*`), and `:root` custom properties
// survive scoping, so `var(--buzz-*)` resolves here.
const BOARD_W = 1000

// Published for the render probe. buzz_image.PROBE_JS measures the drawn board
// and compares it against THIS value, then discards a PNG whose box does not
// match — the guard that would have caught the css-modules bug above on its
// first render instead of two days later. The number therefore has exactly one
// authority: the same constant that sets the width below. Never restate it
// in Python; the probe reads it from here.
if (typeof window !== 'undefined') window.__buzzBoardW = BOARD_W

const EXPORT_STYLE = {
  width: BOARD_W,
  background: 'var(--buzz-page)',
  position: 'relative',
  overflow: 'hidden',
  fontFamily: "'Instrument Sans', -apple-system, 'Segoe UI', sans-serif",
  WebkitFontSmoothing: 'antialiased',
}

// ⚰️ The Spark component and SPARK_FLOOR_PCT lived here until 2026-09-02.
// The owner called the board "clogged" and asked for "less of the trend and
// data crap and more of the stock selection stuff": a 26-bucket intra-day
// micro-histogram was the widest column on the board and the least
// decision-shaped thing on it. The payload still carries `spark` -- cheap,
// and the shape may earn its way back on a taller surface -- but nothing
// draws it. Do not re-add it to this board without asking.

export default function BuzzRender() {
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const exportRef = useRef(null)

  useEffect(() => {
    // Deliberately does NOT reset window.__buzzReady = false here: the flag
    // must stay untouched (undefined on a fresh load) until it is genuinely
    // measured true — an eager reset would still be "not yet drawn", but a
    // caller watching for the transition to `true` cares only that this page
    // never asserts readiness before it is real.
    const params = new URLSearchParams(window.location.search)
    const token = params.get('token') || ''
    if (TOKEN && token !== TOKEN) { setFailed(true); return }
    const qs = new URLSearchParams({ token, window: params.get('window') || 'open' })
    fetch(`/api/r/buzz?${qs}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setFailed(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Readiness: every head row AND every tail chip must have LAID OUT
  // (measured height > 0) before the flag flips — never on mount, and never
  // before the DOM has caught up to this data (rowEls/chipEls counts must
  // match what this payload says should be there).
  useEffect(() => {
    if (!data) return
    const el = exportRef.current
    if (!el) return
    const rows = data.rows || []
    const tail = data.tail || []
    const rowEls = el.querySelectorAll('[data-buzz-row]')
    const chipEls = el.querySelectorAll('[data-buzz-chip]')
    if (rowEls.length !== rows.length || chipEls.length !== tail.length) return
    const nothingToMeasure = rows.length === 0 && tail.length === 0
    const laidOut = [...rowEls, ...chipEls].every((n) => n.getBoundingClientRect().height > 0)
    if (nothingToMeasure || laidOut) window.__buzzReady = true
  }, [data])

  if (failed) {
    return (
      <div className={styles.fallback} id="buzz-export" style={EXPORT_STYLE}>Unavailable</div>
    )
  }
  if (!data) {
    return <div className={styles.fallback} id="buzz-export" style={EXPORT_STYLE} />
  }

  const rows = data.rows || []
  const tail = data.tail || []
  const singles = data.singles || []
  const totals = data.totals || {}

  // ⛔ THE BAR DRAWS THE QUANTITY THE BOARD IS RANKED BY — PEOPLE.
  //
  // It used to draw mentions, and the board looked mis-sorted because of it:
  // the ranking is people-descending (correct and monotonic), but the widest,
  // brightest element on each row came from a different number, so it stepped
  // UP three times in fourteen rows. Measured live 2026-09-02 12:56p: DELL
  // (8 people / 18 mentions) sat below COIN (9 / 9) with nearly double the
  // bar. A reader takes the long bar as the rank; ours contradicted it.
  //
  // Drawing people makes the board monotonic BY CONSTRUCTION — it cannot
  // disagree with its own order — and it makes the column label literally
  // true: share of the ROOM. Mentions keep the gold numeral, which is where
  // volume belongs.
  const maxPeople = Math.max(1, ...rows.map((r) => r.people || 0))

  return (
    <div className={styles.wrap}>
      <div id="buzz-export" ref={exportRef} style={EXPORT_STYLE}>
        <div className={styles.chrome}>
          <span className={styles.subject}>READ THE ROOM</span>
          <span className={styles.win}>{data.label}</span>
          <span className={styles.lockup}>
            <img src={uctLogo} alt="" />
            <span>UCT INTELLIGENCE</span>
          </span>
        </div>

        <div className={styles.wash} />
        <svg className={styles.rose} viewBox="0 0 100 100" aria-hidden="true">
          <g fill="none" stroke="#2faf68" strokeWidth="4.2" opacity=".5">
            <circle cx="50" cy="50" r="27.5" strokeWidth="8"
                    strokeDasharray="34 5.5" strokeDashoffset="8" />
          </g>
          <g fill="#2faf68" opacity=".55">
            <path d="M50 1.75 L55 22 L50 27 L45 22 Z" />
            <path d="M98.25 50 L78 55 L73 50 L78 45 Z" />
            <path d="M50 98.25 L45 78 L50 73 L55 78 Z" />
            <path d="M1.75 50 L22 45 L27 50 L22 55 Z" />
          </g>
          <g opacity=".6">
            <rect x="49.2" y="30" width="1.6" height="41" fill="#2faf68" />
            <rect x="42.9" y="33.5" width="14.2" height="34.2" fill="#2faf68" />
          </g>
        </svg>

        <div className={styles.body}>
          <div className={styles.stats}>
            {/* ⛔ "WITH TICKERS" is load-bearing: the store holds only
                ticker-bearing messages, so a bare "MESSAGES" would claim the
                board counted the whole room. Railed in BuzzRender.test.jsx. */}
            <div className={styles.stat}>
              <div className={`${styles.statn} ${styles.mono}`}>{totals.messages}</div>
              <div className={styles.statl}>MESSAGES WITH TICKERS</div>
            </div>
            <div className={styles.stat}>
              <div className={`${styles.statn} ${styles.mono}`}>{totals.members}</div>
              <div className={styles.statl}>MEMBERS TALKING</div>
            </div>
            <div className={styles.stat}>
              <div className={`${styles.statn} ${styles.mono}`}>{totals.tickers}</div>
              <div className={styles.statl}>TICKERS NAMED</div>
            </div>
          </div>

          {rows.length > 0 && (
            <div className={`${styles.grid} ${styles.hrow}`}>
              <span className={styles.hRk}>#</span>
              <span>TICKER</span>
              <span className={styles.hN}>MENTIONS</span>
              <span>SHARE OF THE ROOM</span>
              <span className={styles.hPpl}>PEOPLE</span>
              <span className={styles.hHeat}>TODAY VS 30D</span>
            </div>
          )}

          {rows.map((r, i) => (
            <div
              key={r.ticker}
              className={`${styles.grid} ${styles.r}${i === 0 ? ` ${styles.lead}` : ''}`}
              data-buzz-row
            >
              <span className={styles.rk}>{String(i + 1).padStart(2, '0')}</span>
              <span className={styles.sym}>{r.ticker}</span>
              <span className={styles.n}>{r.mentions}</span>
              <span className={styles.bar}>
                <i
                  className={r.hot != null ? `${styles.fill} ${styles.hot}` : styles.fill}
                  style={{ width: `${((100 * (r.people || 0)) / maxPeople).toFixed(1)}%` }}
                  data-buzz-bar
                />
              </span>
              <span className={styles.ppl}>{r.people}</span>
              <span className={styles.hcell}>
                {r.hot != null && <b className={styles.pill}>{`▲ ${r.hot}×`}</b>}
              </span>
            </div>
          ))}

          {tail.length > 0 && (
            <>
              <div className={styles.lbl}>ALSO MENTIONED</div>
              <div className={styles.multi}>
                {tail.map((t) => (
                  <span key={t.ticker} className={styles.m} data-buzz-chip>
                    <b>{t.ticker}</b><i>{t.mentions}</i>
                  </span>
                ))}
              </div>
            </>
          )}

          {singles.length > 0 && (
            <>
              <div className={styles.lbl}>NAMED ONCE</div>
              <div className={styles.singles}>
                {singles.map((t) => (
                  <span key={t} className={styles.one}>{t}</span>
                ))}
              </div>
            </>
          )}
        </div>

        <div className={styles.foot}>
          <span>{data.coverage}</span>
          <span>uctintelligence.com</span>
        </div>
      </div>
    </div>
  )
}
