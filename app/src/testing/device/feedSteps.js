/* THE REVIEW FEED, ON A REAL PHONE.
 *
 * ⛔ WHY THESE CANNOT BE jsdom CASES. `ReviewFeed.test.jsx` already proves the
 * ceiling, the windowing and the order — against a fake observer, in a document
 * with no layout, no compositor and no finger. The questions left are the ones
 * only hardware answers:
 *   · does the window actually move when a THUMB scrolls, not when a test calls
 *     a callback (a real IntersectionObserver against real geometry);
 *   · does a vertical swipe over a card scroll the FEED, or pan the chart under
 *     it — the gesture collision that decides whether this surface is usable;
 *   · does the continuity contract hold across the real navigation the shell
 *     performs, for a review that came from a watchlist, a scan and a screener.
 *
 * ⛔ AND THEY RUN INSIDE A 60-SECOND DEVICE SESSION. Every step is written to
 * settle on a CONDITION rather than a sleep, and the suite is selectable
 * (`?suite=feed`) so a device minute is not spent re-proving the shell.
 *
 * ⭐ SEEDED THROUGH `sessionStorage`, WHICH IS THE REAL DOOR. A review session
 * is exactly what a scan's "Review charts" writes, so seeding it and navigating
 * to `/charts?sym=…` reproduces the production entry path — including the
 * handoff, whose failure mode is that the transport control never appears.
 */
import { until, expect, appDoc, appState, bootApp, api } from './authHarness'

export const SESSION_KEY = 'uct.review.session'

/** Twelve is enough to shift the window several times and still boot fast. */
export const FEED_SYMS = ['NVDA', 'AMD', 'AVGO', 'MU', 'TSLA', 'META',
  'GOOG', 'AMZN', 'AAPL', 'MSFT', 'NFLX', 'CRM']

const step = (id, tier, title, needs, run) => ({ id, tier, title, needs, run })

/** Write the session the way a results surface would, then open the chart on it. */
async function enterReview(frame, source, { index = 0, symbols = FEED_SYMS } = {}) {
  try {
    // ⛔ THE TOP WINDOW'S STORE, NOT THE FRAME'S. The harness page is served from
    // the app's own origin, and same-origin frames share the top-level
    // sessionStorage — so seeding here survives the frame navigating, while
    // writing through `frame.contentWindow` races the document that is about to
    // replace it.
    sessionStorage.setItem(SESSION_KEY, JSON.stringify({
      v: 1, source, sourceId: 'device', label: source, sort: null,
      symbols, index, reviewed: [symbols[index]],
      // ⛔ PENDING, because that is what a real cross-page entry writes. Seeding
      // an already-adopted session would skip the one mechanism most likely to
      // break on a device: the shell hydrating its own saved symbol first.
      pending: true,
    }))
  } catch (e) { throw new Error('could not seed the review session: ' + e.message) }

  /* ⛔⛔ AND THE OLD DOCUMENT HAS TO GO FIRST. `bootApp` settles on "a drawn
   * chart canvas", which is ALREADY TRUE of the page still on screen — so a
   * second call returns instantly against the previous review and every
   * assertion after it reads the last run's numbers. Measured: two source steps
   * both reported "7 / 12", the position left by the step before them. Blanking
   * the frame makes the wait mean what it says. */
  frame.src = 'about:blank'
  await until('the frame to clear', () => {
    const d = appDoc(frame)
    return !d || !d.querySelector('.tv-lightweight-charts')
  }, { timeout: 8000 })
  const st = await bootApp(frame, `/charts?sym=${symbols[index]}&tf=D`)
  /* ⛔ WAIT ON THE REVIEW'S OWN READOUT, not on a scraped symbol. `appState`
   * finds the ticker with a loose /[A-Z]{2,6}/ over the symbol strip and has
   * been seen to answer "GG" for GOOG; waiting on it timed out against a shell
   * that was working. The position chip is the thing under test and it says
   * exactly what this needs to know — the session reached this document and
   * opened where it was seeded. */
  await until(`the review to read ${index + 1} / ${symbols.length}`,
    () => position(frame) === `${index + 1} / ${symbols.length}`, { timeout: 20000 })
  return st
}

/** The transport control, or null. Its PRESENCE is the handoff's proof. */
const pill = (frame) => {
  const d = appDoc(frame)
  return d ? d.querySelector('[data-review-nav]') : null
}
/** The position button reads "N / M" — the review's own answer to "where am I". */
const position = (frame) => {
  const p = pill(frame)
  if (!p) return ''
  const btns = [...p.querySelectorAll('button')]
  return (btns[1] && (btns[1].textContent || '').trim()) || ''
}
const feedScroll = (frame) => {
  const d = appDoc(frame)
  return d ? d.querySelector('[data-testid="feed-scroll"]') : null
}
const feedCards = (frame) => {
  const d = appDoc(frame)
  return d ? [...d.querySelectorAll('[data-feed-index]')] : []
}
/** Charts INSIDE the feed. ⛔ Not a page-wide count: the shell's own chart stays
 *  mounted under the sheet by design, so a page count reads 4 against a budget
 *  of 3 and looks like a breach. */
const feedCharts = (frame) => {
  const el = feedScroll(frame)
  return el ? el.querySelectorAll('.tv-lightweight-charts').length : 0
}

const tap = (el) => {
  if (!el) throw new Error('nothing to tap')
  const r = el.getBoundingClientRect()
  const x = Math.round(r.left + r.width / 2)
  const y = Math.round(r.top + r.height / 2)
  const o = { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true }
  el.dispatchEvent(new PointerEvent('pointerdown', o))
  el.dispatchEvent(new PointerEvent('pointerup', o))
  el.click()
}

/** A real vertical swipe over an element, as touch events. */
function swipeUp(el, dy = 220) {
  const r = el.getBoundingClientRect()
  const x = Math.round(r.left + r.width / 2)
  const y0 = Math.round(r.top + r.height * 0.7)
  const mk = (type, y) => new TouchEvent(type, {
    bubbles: true, cancelable: true,
    touches: type === 'touchend' ? [] : [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
    changedTouches: [new Touch({ identifier: 1, target: el, clientX: x, clientY: y })],
  })
  el.dispatchEvent(mk('touchstart', y0))
  for (let i = 1; i <= 6; i += 1) el.dispatchEvent(mk('touchmove', y0 - (dy / 6) * i))
  el.dispatchEvent(mk('touchend', y0 - dy))
}

export function buildFeedSteps({ frame, cred }) {
  return [
    /* ⛔ THE SUITE LOGS IN ITSELF. Selecting `?suite=feed` skips the full
     * suite — including its `auth` step — so without this the iframe loads
     * /charts, the app bounces to /login, and the first feed step fails with
     * "no drawn chart canvas". That reads as a FEED defect and costs a device
     * minute to misdiagnose; it cost one local run to find. A suite that can be
     * selected must carry its own prerequisites. */
    step('feed-auth', 1, 'a real login, so the suite can stand alone', [], async () => {
      const me = await api.me()
      if (!me) await api.login(cred)
      const who = await api.me()
      return expect(!!who, !!who, true, 'authenticated before any chart is asked for')
    }),

    step('feed-handoff-scan', 1, 'a SCAN review reaches the chart — the handoff survives the shell', ['feed-auth'], async () => {
      await enterReview(frame, 'scan')
      // ⛔ THE CONTROL APPEARING IS THE ASSERTION. If `pending` were broken the
      // shell's hydrated symbol would exit the session and this would be a chart
      // with no review on it — silently, which is why it is step one.
      await until('the review transport control', () => pill(frame), { timeout: 20000 })
      return expect(position(frame), position(frame) === `1 / ${FEED_SYMS.length}`,
        `1 / ${FEED_SYMS.length}`, 'the review opened at its first symbol')
    }),

    step('feed-open', 1, 'the position chip opens the feed, and the WHOLE set is in it',
      ['feed-handoff-scan'], async () => {
        const p = pill(frame)
        tap([...p.querySelectorAll('button')][1])
        await until('the feed', () => feedScroll(frame), { timeout: 15000 })
        const n = feedCards(frame).length
        return expect(n, n === FEED_SYMS.length, FEED_SYMS.length,
          'a bounded feed is still a COMPLETE list')
      }),

    step('feed-ceiling', 1, '🔴 scrolling ten cards never holds more than three live charts',
      ['feed-open'], async () => {
        const el = feedScroll(frame)
        const cards = feedCards(frame)
        const h = Math.round(cards[0].getBoundingClientRect().height) || 300
        let worst = feedCharts(frame)
        for (let i = 1; i <= 10; i += 1) {
          el.scrollTop = h * i
          // Let the real IntersectionObserver fire and the window settle.
          // eslint-disable-next-line no-await-in-loop
          await new Promise((r) => setTimeout(r, 260))
          worst = Math.max(worst, feedCharts(frame))
        }
        return expect(worst, worst <= 3, '<= 3', `peak live charts across 10 cards (${worst})`)
      }),

    step('feed-scroll-intent', 1, '⛔ a card does not claim the vertical gesture the feed needs',
      ['feed-open'], async () => {
        /* ⚰️ THIS WAS A SYNTHETIC SWIPE AND IT COULD NOT WORK. Dispatching
         * TouchEvents does not drive native scrolling in any browser — the
         * compositor scrolls from real input — so the first version asserted
         * "the feed scrolled" against a scrollTop that had not moved, on a feed
         * with nothing wrong with it. A harness that cannot perform the gesture
         * cannot judge the gesture.
         *
         * ⭐ WHAT IS ACTUALLY DECIDABLE HERE IS WHO CLAIMS THE GESTURE, and that
         * is a property of the DOM, not of a finger: a chart whose container
         * takes `touch-action: none` swallows a vertical drag before the
         * scroller ever sees it, which is exactly the collision this step
         * exists for. The finger half is the human check on the device. */
        /* ⛔⛔ READ ATOMICALLY, INSIDE THE PREDICATE. The feed is a moving
         * target by design: between selecting a card and reading its chart, the
         * window can shift and that chart is gone. Doing it in two statements
         * produced, in order, a fabricated `touch-action: "none"` (an old
         * fallback), an unearned `!important` override, a wrong disproof, and a
         * null dereference — four wrong conclusions from one race. The whole
         * reading now happens in one tick or is retried. */
        const w = frame.contentWindow
        const read = await until('a card holding a chart, read in one tick', () => {
          const dd = appDoc(frame)
          const scroller = dd && dd.querySelector('[data-testid="feed-scroll"]')
          if (!scroller) return null
          const bodies = [...dd.querySelectorAll('[data-testid^="feed-body-"]')]
          for (const b of bodies) {
            const c = b.querySelector('.tv-lightweight-charts')
            if (!c) continue
            return {
              card: b.getAttribute('data-testid'),
              cardsHoldingCharts: bodies.filter((x) => x.querySelector('.tv-lightweight-charts')).length,
              chartTouchAction: w.getComputedStyle(c).touchAction,
              chartInline: c.style.touchAction || '(none inline)',
              scrollerScrolls: /auto|scroll/.test(w.getComputedStyle(scroller).overflowY),
              overlayInert: (() => {
                const o = b.querySelector('canvas[data-uct-overlay], [data-uct-qbar]')
                return !o || w.getComputedStyle(o).pointerEvents === 'none'
              })(),
            }
          }
          return null
        }, { timeout: 8000 })

        // `none` would mean the browser is handed no vertical axis at all, and a
        // drag over a card could never reach the scroller.
        const ok = read.chartTouchAction !== 'none' && read.scrollerScrolls && read.overlayInert
        return expect(read, ok,
          { chartTouchAction: 'not none', scrollerScrolls: true, overlayInert: true },
          'nothing inside a card claims the vertical drag')
      }),

    step('feed-pick', 1, 'tapping a card moves the REVIEW to that index, not just the chart',
      ['feed-open'], async () => {
        const cards = feedCards(frame)
        const idx = 6
        const head = cards[idx].querySelector('button')
        tap(head)
        await until('the feed to close', () => !feedScroll(frame), { timeout: 10000 })
        const want = `${idx + 1} / ${FEED_SYMS.length}`
        await until('the position to follow', () => position(frame) === want, { timeout: 10000 })
        const st = appState(frame)
        // ⚠️ THE PILL'S OWN SYMBOL, NOT the strip's. `appState` scrapes the symbol
        // strip with a loose /[A-Z]{2,6}/, which happily matches a neighbouring
        // label — it reported "GG" for GOOG once. The review's position is the
        // assertion that matters here; the symbol is carried for the record.
        return expect({ symbol: st.symbol, position: position(frame) },
          position(frame) === want,
          { position: want },
          'the chip followed the tapped card')
      }),

    step('feed-next-then-return', 1, '⭐ next, then the feed comes back on the NEW current symbol',
      ['feed-pick'], async () => {
        const btns = [...pill(frame).querySelectorAll('button')]
        tap(btns[2])                                   // ›
        const want = `8 / ${FEED_SYMS.length}`
        await until('the review to advance', () => position(frame) === want, { timeout: 10000 })
        tap([...pill(frame).querySelectorAll('button')][1])
        await until('the feed again', () => feedScroll(frame), { timeout: 10000 })
        // ⛔ THE RETURN TARGET IS THE CURRENT SYMBOL, not a remembered offset.
        // A feed that reopened at the top would make "where am I" the first
        // thing a member has to solve, every time.
        // ⚠️ WAITED FOR, NOT SAMPLED. The sheet is on screen before its charts
        // are; asserting on the same tick measured the gap between those two
        // facts and reported it as "the feed reopened in the wrong place".
        let live = null
        try {
          live = await until('the current card to go live',
            () => appDoc(frame).querySelector('[data-feed-index="7"] .tv-lightweight-charts'),
            { timeout: 8000 })
        } catch { live = null }
        return expect({ position: position(frame), currentCardLive: !!live },
          !!live, { currentCardLive: true },
          'the feed reopened on the symbol the review is now at')
      }),

    step('feed-source-watchlist', 2, 'the same contract, entered from a WATCHLIST', ['feed-auth', 'feed-handoff-scan'], async () => {
      await enterReview(frame, 'watchlist', { index: 2 })
      await until('the transport control', () => pill(frame), { timeout: 20000 })
      tap([...pill(frame).querySelectorAll('button')][1])
      await until('the feed', () => feedScroll(frame), { timeout: 12000 })
      const n = feedCards(frame).length
      return expect({ position: position(frame), cards: n },
        position(frame) === `3 / ${FEED_SYMS.length}` && n === FEED_SYMS.length,
        { position: `3 / ${FEED_SYMS.length}`, cards: FEED_SYMS.length },
        'a watchlist review opens where it left off')
    }),

    step('feed-source-screener', 2, 'the same contract, entered from a SCREENER', ['feed-handoff-scan'], async () => {
      await enterReview(frame, 'screener', { index: 4 })
      await until('the transport control', () => pill(frame), { timeout: 20000 })
      tap([...pill(frame).querySelectorAll('button')][1])
      await until('the feed', () => feedScroll(frame), { timeout: 12000 })
      return expect(position(frame), position(frame) === `5 / ${FEED_SYMS.length}`,
        `5 / ${FEED_SYMS.length}`, 'source does not change the contract')
    }),
  ]
}
