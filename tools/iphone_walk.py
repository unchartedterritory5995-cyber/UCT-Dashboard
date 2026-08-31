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
    def tap(x, y):
        if cdp:
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x, 'y': y, 'id': 1}]})
            cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
        else:
            page.touchscreen.tap(x, y)
        page.wait_for_timeout(400)

    tap(120, 500)   # anchor 1 — clean canvas, clear of legend/range bar/popovers
    tap(330, 300)   # anchor 2 commits (TAP-TAP placement, the TradingView model)
    shot(page, '21-trendline-drawn')
    stored = page.evaluate("() => localStorage.getItem('uct-chart-drawings') || ''")
    ok = '"trendline"' in stored
    print('  drawing persisted:', ok)
    return ok


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
        browser.close()

    print(f'done -> {OUT}')
    if not drew:
        print('FAIL: the touch trendline did not persist — the drawing pipeline regressed on touch')
        return 1
    print('PASS: touch drawing verified end-to-end')
    return 0


if __name__ == '__main__':
    sys.exit(main())
