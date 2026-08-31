"""iphone_walk.py — the iPhone-class rig for the phone /charts experience.

Drives the REAL app on iPhone metrics (393x852 @2x, touch, iOS Safari UA,
coarse-pointer media), seeds the browser's own IndexedDB bars store so candles,
legend and watchlist sparklines render WITHOUT market-data keys, then:

  1. screenshots every key screen (chart, sheets, watchlist, landscape), and
  2. runs the TOUCH DRAWING WALK: expands the drawing toolbar, arms Trendline,
     places two anchors via REAL touch events (CDP Input.dispatchTouchEvent —
     Chromium's genuine pointerType:'touch' path, the same input an iPhone
     finger produces), and asserts the drawing PERSISTED to the per-symbol
     localStorage store. Exit code 1 if it didn't.

This walk is what found the 2026-08-30 phone toolbar bug (the actions cluster
painting over the tools rail, making every drawing tool untappable) — a defect
invisible in screenshots, because the tap LOOKED like it landed.

Usage (backend first — see CLAUDE.md "Mobile audit harness" for the env):
  python -m uvicorn api.main:app --port 8077        # heavy jobs off, admin user
  python tools/iphone_walk.py --base http://localhost:8077
  python tools/iphone_walk.py --engine webkit        # Safari's engine, where
                                                     # `playwright install webkit`
                                                     # works (macOS/Windows/most
                                                     # Linux; not the CC sandbox)

Output: tools/mobile_audit_out/iphone/*.png (gitignored) + a pass/fail line.
Credentials default to the audit harness account (MOBILE_AUDIT_EMAIL/_PASSWORD).
"""
import argparse
import os
import re
import sys

from playwright.sync_api import sync_playwright

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mobile_audit_out', 'iphone')
SYMS = ['SPY', 'AAPL', 'NVDA', 'TSLA', 'META', 'AMD', 'MSFT', 'PLTR']
IOS_UA = ('Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) '
          'AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1')

# Seeds ~220 synthetic weekday bars per symbol into the app's own IDB store
# (uct_bars_v1/bars, the exact idbPut record shape incl. CACHE_LOGIC_VERSION).
# ⚠️ Keep the version literal in step with app/src/utils/barsIDB.js — a mismatch
# just makes the seed read as absent (charts render empty, nothing breaks).
SEED_JS = """
async (syms) => {
  const days = 220
  const dates = []
  let d = new Date()
  while (dates.length < days) {
    const dow = d.getUTCDay()
    if (dow !== 0 && dow !== 6) dates.push(d.toISOString().slice(0, 10))
    d.setUTCDate(d.getUTCDate() - 1)
  }
  dates.reverse()
  const mkBars = (seed) => {
    let px = 80 + (seed % 7) * 40
    let rng = seed * 2654435761 % 4294967296
    const rand = () => { rng = (rng * 1664525 + 1013904223) % 4294967296; return rng / 4294967296 }
    return dates.map((t) => {
      const o = px
      const c = Math.max(2, px + (rand() - 0.47) * px * 0.025)
      const h = Math.max(o, c) * (1 + rand() * 0.008)
      const l = Math.min(o, c) * (1 - rand() * 0.008)
      px = c
      return { t, o: +o.toFixed(2), h: +h.toFixed(2), l: +l.toFixed(2), c: +c.toFixed(2), v: Math.round(1e6 + rand() * 9e6) }
    })
  }
  const db = await new Promise((res, rej) => {
    const req = indexedDB.open('uct_bars_v1', 2)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains('bars')) req.result.createObjectStore('bars', { keyPath: 'key' })
    }
    req.onsuccess = () => res(req.result)
    req.onerror = () => rej(req.error)
  })
  await new Promise((res) => {
    const tx = db.transaction('bars', 'readwrite')
    const st = tx.objectStore('bars')
    syms.forEach((s, i) => {
      const bars = mkBars(i + 3)
      st.put({ key: `${s}_D`, bars, lastT: bars[bars.length - 1].t, savedAt: Date.now(), v: 6 })
    })
    tx.oncomplete = res
    tx.onerror = res
  })
  return 'seeded'
}
"""


def shot(page, name, wait=1200):
    page.wait_for_timeout(wait)
    page.screenshot(path=os.path.join(OUT, f'{name}.png'))
    print('  shot', name)


def make_page(ctx, base, email, pw, viewport_note):
    page = ctx.new_page()
    page.request.post(f'{base}/api/auth/signup', data={'email': email, 'password': pw, 'display_name': 'x'})
    r = page.request.post(f'{base}/api/auth/login', data={'email': email, 'password': pw})
    if r.status != 200:
        print(f'login failed ({r.status}) — create the audit account first (see CLAUDE.md)')
        sys.exit(2)
    page.request.post(f'{base}/api/watchlists/flagged/sync', data={'symbols': SYMS})
    # Block bars fetches so an empty/keyless backend can't wipe the seed — this
    # is also the offline-resilience path the IDB layer exists to serve.
    page.route('**/api/bars/**', lambda route: route.abort())
    page.goto(f'{base}/login', wait_until='domcontentloaded')
    print(f'  [{viewport_note}] seed:', page.evaluate(SEED_JS, SYMS))
    page.evaluate("(s) => localStorage.setItem('uct_flagged', JSON.stringify(s))", SYMS)
    page.goto(f'{base}/charts', wait_until='domcontentloaded')
    page.wait_for_timeout(2500)
    page.keyboard.press('Escape')   # skip the intro animation
    page.wait_for_timeout(3000)
    # Dismiss the one-time voice coach-mark so its card never overlaps a step.
    try:
        page.get_by_text('Got it', exact=True).click(timeout=1500)
        page.wait_for_timeout(400)
    except Exception:
        pass
    return page


def touch_walk(ctx, page):
    """Arm Trendline, place two touch anchors, return True if it persisted."""
    # Expand the drawing toolbar (the phone default is collapsed). Never swallow
    # this silently: report which state was found so a failure names itself.
    if page.get_by_label('Show toolbar').count() > 0:
        page.get_by_label('Show toolbar').click(timeout=5000)
        print('  toolbar: expanded from collapsed')
    elif page.get_by_label('Hide toolbar').count() > 0:
        print('  toolbar: already expanded')
    else:
        print('  toolbar: NO toggle found — is the chart mounted?')
    page.wait_for_timeout(500)
    shot(page, '20-toolbar-expanded')
    page.get_by_title(re.compile('^Trendline')).click(timeout=5000)
    page.wait_for_timeout(400)

    cdp = None
    try:
        cdp = ctx.new_cdp_session(page)
    except Exception:
        print('  (no CDP on this engine — using tap fallback)')
    def touch(kind, points):
        cdp.send('Input.dispatchTouchEvent', {
            'type': kind,
            'touchPoints': [{'x': x, 'y': y, 'id': 1} for x, y in points],
        })

    def tap(x, y):
        if cdp:
            touch('touchStart', [(x, y)])
            touch('touchEnd', [])
        else:
            page.touchscreen.tap(x, y)
        page.wait_for_timeout(400)

    # The one-time coach chip should be up before the first anchor…
    hint_before = page.get_by_test_id('tap-tap-hint').count() > 0
    print('  tap-tap hint shown:', hint_before)
    tap(120, 500)   # anchor 1 — clean canvas, clear of legend/range bar/popovers
    tap(330, 300)   # anchor 2 commits (TAP-TAP placement, the TradingView model)
    shot(page, '21-trendline-drawn')
    # …and retired for good by the completed placement.
    hint_after = page.get_by_test_id('tap-tap-hint').count() == 0
    print('  hint retired after placement:', hint_after)
    stored = page.evaluate("() => localStorage.getItem('uct-chart-drawings') || ''")
    ok = '"trendline"' in stored
    print('  drawing persisted:', ok)
    if not ok:
        return False

    # ── RESHAPE BY TOUCH: select the line, drag anchor 2 to a new spot, and
    # assert the persisted points MOVED. This is the grab-handle gate — it
    # fails if the coarse hit zone or the drag path regresses.
    tap(225, 400)                    # tap the line body → select (handles show)
    shot(page, '22-handles-selected', wait=600)
    touch('touchStart', [(330, 300)])
    for xy in [(330, 280), (330, 255), (330, 235)]:
        touch('touchMove', [xy])
        page.wait_for_timeout(60)
    touch('touchEnd', [])
    page.wait_for_timeout(500)
    moved = page.evaluate("() => localStorage.getItem('uct-chart-drawings') || ''")
    reshaped = moved != stored and '"trendline"' in moved
    print('  reshape persisted:', reshaped)
    return reshaped


def golive_walk(ctx, page):
    """Pan into history by touch → the » back-to-live chip appears → tap it →
    the view snaps to the newest bar and the chip retires. True only on the
    full round trip (Phase 8's flagship chart interaction)."""
    cdp = None
    try:
        cdp = ctx.new_cdp_session(page)
    except Exception:
        print('  (no CDP — go-live pan needs touch drags; step skipped)')
        return True  # webkit run: absence of CDP is not a regression signal

    def touch(kind, points):
        cdp.send('Input.dispatchTouchEvent', {
            'type': kind,
            'touchPoints': [{'x': x, 'y': y, 'id': 1} for x, y in points],
        })

    pill = page.get_by_label('Back to latest bar')
    if pill.count() > 0:
        print('  go-live: pill ALREADY visible before the pan — investigate')
    # Deselect the reshaped trendline first so the drag below is a chart PAN,
    # not a drawing move; then drag right along a mid-canvas lane. ⚠️ START
    # x >= 150: a rightward swipe that begins near the left edge trips
    # Chromium's overscroll history-back and NAVIGATES to the previous page —
    # measured 2026-08-31 with a start at x=70 (the walk landed on /dashboard
    # and every later step cascade-failed). y=300 clears the legend, the
    # drawn line, and the toolbar.
    touch('touchStart', [(60, 300)])
    touch('touchEnd', [])
    page.wait_for_timeout(400)
    touch('touchStart', [(150, 300)])
    for x in range(170, 351, 20):
        touch('touchMove', [(x, 300)])
        page.wait_for_timeout(30)
    touch('touchEnd', [])
    page.wait_for_timeout(700)
    if '/charts' not in page.url:
        print('  go-live: pan NAVIGATED AWAY (edge-gesture regression) — url', page.url)
        return False
    appeared = pill.count() > 0 and pill.is_visible()
    print('  go-live pill appeared after pan:', appeared)
    shot(page, '23-golive-pill', wait=200)
    if not appeared:
        return False
    try:
        pill.click(timeout=4000)
    except Exception as e:
        # A timeout here has meant a FAB intercepting the tap (the orb cluster
        # did exactly that at bottom: 42px) — that's a product bug, not rig
        # noise, so it fails the gate with the interceptor named.
        print('  pill TAP FAILED (intercepted?):', str(e).splitlines()[-1][:120])
        return False
    page.wait_for_timeout(900)  # scrollToRealTime glides back to the live edge
    gone = pill.count() == 0
    print('  pill retired after snap-back:', gone)
    shot(page, '24-back-at-live', wait=200)
    return gone


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--base', default=os.environ.get('MOBILE_AUDIT_BASE', 'http://localhost:8077'))
    ap.add_argument('--email', default=os.environ.get('MOBILE_AUDIT_EMAIL', 'mobtest@local.dev'))
    ap.add_argument('--password', default=os.environ.get('MOBILE_AUDIT_PASSWORD', 'LocalTest2026!'))
    ap.add_argument('--engine', choices=['chromium', 'webkit'], default='chromium',
                    help="webkit = Safari's engine (run `playwright install webkit` first; "
                         'closest to iOS Safari available off-device)')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    with sync_playwright() as p:
        launcher = p.webkit if args.engine == 'webkit' else p.chromium
        try:
            browser = launcher.launch()
        except Exception:
            # A pinned Playwright that predates/postdates the installed browser
            # set refuses the default launch. For chromium, fall back to any
            # preinstalled build (the Claude Code sandbox ships one at
            # /opt/pw-browsers); webkit has no such fallback — install it.
            if args.engine != 'chromium':
                raise
            import glob
            exe = next((c for pat in ('/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-*/chrome-linux/chrome')
                        for c in sorted(glob.glob(pat)) if os.path.isfile(c) and os.access(c, os.X_OK)), None)
            if not exe:
                raise
            browser = launcher.launch(executable_path=exe)

        # ── Portrait ──
        ctx = browser.new_context(viewport={'width': 393, 'height': 852}, device_scale_factor=2,
                                  is_mobile=(args.engine == 'chromium'), has_touch=True, user_agent=IOS_UA)
        page = make_page(ctx, args.base, args.email, args.password, 'portrait')
        shot(page, '01-chart')
        # Phase 9: the app top bar steps aside on the phone chart shell — the
        # hamburger is gone while the bottom tab bar (the control) stays.
        topbar_gone = (not page.get_by_label('Open menu').is_visible()
                       and page.get_by_role('link', name='Home').is_visible())
        print('  top bar hidden on /charts phone (tab bar stays):', topbar_gone)
        for label, name in [('Timeframe', '02-tf-sheet'), ('Chart type', '03-type-sheet'),
                            ('Indicators', '04-indicators-sheet'), ('More tools', '05-more-sheet')]:
            try:
                page.get_by_role('button', name=re.compile(f'^{label}')).click(timeout=4000)
                shot(page, name, wait=900)
                page.keyboard.press('Escape')
                page.wait_for_timeout(400)
            except Exception as e:
                print('  MISS', name, str(e).splitlines()[0])
        # Touch drawing first (the isolation-proven order), then the watchlist
        # page detour — page navigation must not be a variable under the walk.
        drew = touch_walk(ctx, page)
        golive = golive_walk(ctx, page)
        longpress_ok = False
        step = 'star'
        try:
            open_sheets = page.evaluate("() => document.querySelectorAll('[data-sheet-panel]').length")
            if open_sheets:
                print(f'  NOTE: {open_sheets} sheet(s) still open before ★ — Escaping')
                for _ in range(open_sheets):
                    page.keyboard.press('Escape')
                    page.wait_for_timeout(300)
            star = page.get_by_role('button', name='Watchlist')
            try:
                star.click(timeout=4000)
            except Exception:
                # Something floated over the toolbar (the voice orb's idle-tuck
                # timing can do this). Force past it for the NAV step, but say
                # so — a repeatable force here means a real z-order overlap.
                print('  NOTE: ★ needed force-click — check what floated over the toolbar')
                star.click(timeout=4000, force=True)
            page.wait_for_timeout(1200)
            step = 'expand Flagged'
            # The page REMEMBERS the last-open list: on a fresh account it shows
            # the lists index (expand Flagged), on later runs it opens straight
            # inside Flagged, where "Flagged" is the page TITLE — clicking that
            # does nothing. Symbol rows on screen = already inside; skip.
            if page.locator('[data-watch-sym]').count() == 0:
                fl = page.get_by_text('Flagged', exact=True)
                for i in range(fl.count()):
                    if fl.nth(i).is_visible():
                        fl.nth(i).click(timeout=4000)
                        break
            shot(page, '06-watchlist-sparks', wait=1800)

            # Phase 9: LONG-PRESS a row's sym cell → the row-action sheet
            # (notes / alerts / remove — right-click's touch door). The hook
            # swallows the release click, so the row must NOT also select and
            # bounce the page back to the chart underneath the sheet.
            # ⚠️ Row menus live on OWNER-LIST rows only — Flagged rows have
            # none BY DESIGN (the star is their remove; same on desktop
            # right-click) — so press in a real list: idempotent RigList.
            step = 'make RigList'
            wls = page.request.get(f'{args.base}/api/watchlists').json()
            rig = next((w for w in wls if w.get('name') == 'RigList'), None)
            if rig is None:
                rig = page.request.post(f'{args.base}/api/watchlists', data={'name': 'RigList'}).json()
                page.request.post(f"{args.base}/api/watchlists/{rig['id']}/items", data={'sym': 'AAPL'})
            step = 'open RigList'
            # Deterministic from either state: inside a list, ‹ Lists exists —
            # go up; on the lists index it doesn't. Then tap the list.
            lists_btn = page.get_by_role('button', name=re.compile('Lists'))
            if lists_btn.count() and lists_btn.first.is_visible():
                lists_btn.first.click(timeout=4000)
                page.wait_for_timeout(600)
            page.get_by_text('RigList', exact=True).first.click(timeout=4000)
            page.wait_for_timeout(900)
            step = 'long-press row'
            row = page.locator('[data-watch-sym]').first
            # Aim at the SYM CELL itself — the element carrying the binding.
            # Guessed x-offsets missed twice (x+42 = the flag star, x+150 = the
            # price cell; phone columns are narrower than they look).
            cell = row.locator('[class*="symCell"]').first
            box = cell.bounding_box() if cell.count() else row.bounding_box()
            if box:
                lx, ly = box['x'] + box['width'] * 0.55, box['y'] + box['height'] / 2
                # ⚠️ NOT a CDP touch: headless Chromium holds a motionless
                # dispatchTouchEvent press in tap-vs-scroll disambiguation and
                # flushes pointerdown only AT RELEASE — the 450ms timer starts
                # and dies in the same instant, so a held CDP press can never
                # fire (a 2px nudge stays inside browser slop; a real move
                # cancels by tolerance). Real browsers deliver pointerdown
                # immediately, so a JS-dispatched pointerdown at the cell is
                # the faithful stand-in; the hook's timing/swallow mechanics
                # are unit-tested in useLongPress.test.jsx.
                page.evaluate('''([x, y]) => {
                  const el = document.elementFromPoint(x, y)
                  el?.dispatchEvent(new PointerEvent('pointerdown', {
                    pointerType: 'touch', bubbles: true, cancelable: true,
                    clientX: x, clientY: y, pointerId: 7,
                  }))
                }''', [lx, ly])
                page.wait_for_timeout(800)
                row_sheet = page.locator('[data-sheet-panel]').count() > 0
                print('  long-press row menu opened:', row_sheet)
                shot(page, '07-row-menu', wait=300)
                if row_sheet:
                    page.keyboard.press('Escape')
                    page.wait_for_timeout(400)
                longpress_ok = row_sheet
            else:
                print('  long-press row menu: no row box — skipped')

            step = 'back to chart'
            page.get_by_role('button', name=re.compile('^Chart$')).click(timeout=4000)
            page.wait_for_timeout(500)
        except Exception as e:
            print(f'  MISS watchlist at step "{step}":', str(e).splitlines()[0])
        ctx.close()

        # ── Landscape immersive ──
        lctx = browser.new_context(viewport={'width': 852, 'height': 393}, device_scale_factor=2,
                                   is_mobile=(args.engine == 'chromium'), has_touch=True, user_agent=IOS_UA)
        lpage = make_page(lctx, args.base, args.email, args.password, 'landscape')
        shot(lpage, '10-landscape')
        lctx.close()

        # ── iPad two-pane (coarse-pointer tablet branch) ──
        tctx = browser.new_context(viewport={'width': 820, 'height': 1180}, device_scale_factor=2,
                                   is_mobile=(args.engine == 'chromium'), has_touch=True, user_agent=IOS_UA)
        tpage = make_page(tctx, args.base, args.email, args.password, 'ipad')
        tablet_ok = (tpage.locator('[data-shell-mode="tablet"]').count() > 0
                     and tpage.get_by_role('button', name='Close panel').count() > 0)
        print('  tablet two-pane docked:', tablet_ok)
        shot(tpage, '30-ipad-two-pane', wait=1800)
        browser.close()
        if not tablet_ok:
            print('FAIL: iPad viewport did not dock the two-pane shell')
            return 1

    print(f'done -> {OUT}')
    if not drew:
        print('FAIL: touch place/reshape did not persist — the phone drawing pipeline regressed')
        return 1
    if not golive:
        print('FAIL: back-to-live chip round trip failed — pan/pill/snap regressed')
        return 1
    if not topbar_gone:
        print('FAIL: app top bar still visible on the phone chart shell — full-height charting regressed')
        return 1
    if not longpress_ok:
        print('FAIL: long-press row menu did not open — phone row actions regressed')
        return 1
    print('PASS: touch place + reshape + back-to-live + top-bar + long-press verified end-to-end')
    return 0


if __name__ == '__main__':
    sys.exit(main())
