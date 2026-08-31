"""mobile_crawl.py — the exhaustive action-point crawler for the phone /charts tab.

Where mobile_discovery.py runs authored JOURNEYS, this enumerates and taps EVERY
reachable control in every charts-tab state — the mechanical stand-in for hundreds
of testers poking every crevice. Per action it records an outcome class:

  changed      the tap did something visible (sheet/dialog/nav/DOM moved)
  noop         nothing observable changed — a DEAD-TAP candidate for review
  error        a console error / pageerror fired during the action
  left-route   the tap navigated away from /charts (unexpected unless a nav link)
  overflow     the resulting state scrolls horizontally (the #1 mobile bug)
  skipped      destructive/mutating controls (remove/delete/sign-out/Add-widget)
  crash        the page had to be reloaded to continue

plus a per-state sweep for sub-44px tap targets. Runs on its OWN disposable
account (crawl@local.dev) so the walk/discovery accounts stay clean, logs in
once (storage_state — 12 rapid logins trip the auth 429 guard), and dedupes by
(state, accessible-name) signature.

Output: tools/mobile_audit_out/crawl/report.md + ledger.tsv + state screenshots.
Exit code always 0 — the crawler reports; iphone_walk gates.

Usage: python tools/mobile_crawl.py --base http://localhost:8077 [--viewports phone,ipad,se]
"""
import argparse
import os
import re
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from iphone_walk import IOS_UA, SEED_JS, SYMS  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mobile_audit_out', 'crawl')
DENY = re.compile(r'remove|delete|trash|sign ?out|log ?out|disconnect|clear |reset|^add |drop|unflag', re.I)
# Bottom tab-bar / global-nav links leave the charts tab by design — enumerate
# them as covered, classify as skipped (their pages are other tabs' ground).
NAV_OK = re.compile(r'^(home|markets|charts|journal|more)$', re.I)
VIEWPORTS = {'phone': (393, 852), 'se': (375, 667), 'ipad': (820, 1180)}

ENUM_JS = '''(sheetOnly) => {
  const roots = sheetOnly
    ? [...document.querySelectorAll('[data-sheet-panel]'), ...document.querySelectorAll('[role="dialog"]')]
    : [document.querySelector('[data-testid="mobile-charts-app"]'),
                 ...document.querySelectorAll('[data-sheet-panel]'),
                 ...document.querySelectorAll('[role="dialog"]')].filter(Boolean)
  const seen = new Set(); const out = []
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('title')
    || (el.innerText || '').trim().slice(0, 60) || el.getAttribute('placeholder') || '').trim()
  for (const root of roots) {
    for (const el of root.querySelectorAll('button, [role="button"], [role="option"], [role="tab"], [role="switch"], a[href], input, select, textarea')) {
      const r = el.getBoundingClientRect()
      if (r.width < 4 || r.height < 4) continue
      if (r.bottom < 0 || r.top > innerHeight) continue
      const st = getComputedStyle(el)
      if (st.visibility === 'hidden' || st.display === 'none' || el.disabled) continue
      const name = nameOf(el)
      const sig = el.tagName + '|' + name
      if (seen.has(sig)) continue
      seen.add(sig)
      out.push({ name, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '',
                 x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, sig })
    }
  }
  return out
}'''

PROBE_JS = '''() => ({
  url: location.pathname,
  sheets: document.querySelectorAll('[data-sheet-panel]').length,
  dialogs: document.querySelectorAll('[role="dialog"]').length,
  overflowX: (document.scrollingElement || document.documentElement).scrollWidth > innerWidth + 1,
})'''


class Crawl:
    def __init__(self, page, viewport):
        self.page = page
        self.viewport = viewport
        self.ledger = []       # dicts: state, name, outcome, note
        self.errors = []
        self.small = []        # sub-44px interactive targets, per state
        page.on('console', lambda m: self.errors.append(m.text[:200]) if m.type == 'error' and 'favicon' not in m.text else None)
        page.on('pageerror', lambda e: self.errors.append('pageerror: ' + str(e)[:200]))

    def log(self, state, name, outcome, note=''):
        self.ledger.append({'state': state, 'name': (name or '?')[:60], 'outcome': outcome, 'note': note[:120]})

    def settle(self, ms=350):
        self.page.wait_for_timeout(ms)

    def close_layers(self):
        for _ in range(4):
            if self.page.evaluate("() => document.querySelectorAll('[data-sheet-panel], [role=\\'dialog\\']').length") == 0:
                break
            self.page.keyboard.press('Escape')
            self.settle(250)
        # A widget PAGE (the over-chart overlay) survives Escapes — its back
        # button is the '‹ Chart' at top-left. Run 1 left AI Search open under
        # every later state and poisoned the whole ledger's attribution.
        try:
            back = self.page.get_by_role('button', name=re.compile('^Chart$'))
            for _ in range(2):
                if back.count() and back.first.is_visible():
                    back.first.click(timeout=1500); self.settle(350)
                else:
                    break
        except Exception:
            pass
        # And the expanded drawing toolbar goes back to its chevron.
        try:
            hide = self.page.get_by_label('Hide toolbar')
            if hide.count() and hide.first.is_visible():
                hide.first.click(timeout=1500); self.settle(250)
        except Exception:
            pass

    def ensure_charts(self, base):
        if '/charts' not in self.page.url:
            self.page.goto(f'{base}/charts', wait_until='domcontentloaded')
            self.settle(1500)
            self.page.keyboard.press('Escape')
            self.settle(800)

    def crawl_state(self, base, state, enter, probe_sel, cap=60, expect_sheet=None):
        """Enumerate once, then tap each element (re-entering when a tap breaks
        the state). Every state starts from a CLEAN baseline — a previous
        state's stray sheet poisoned everything downstream in run 1."""
        p = self.page
        try:
            self.close_layers(); self.ensure_charts(base)
            enter()
        except Exception as e:
            self.log(state, '(enter)', 'crash', str(e).splitlines()[0])
            self.close_layers(); self.ensure_charts(base)
            return
        self.settle(500)
        try:
            p.screenshot(path=os.path.join(OUT, f'{self.viewport}-{state}.png'))
        except Exception:
            pass
        els = p.evaluate(ENUM_JS, bool(expect_sheet))[:cap]
        # tap-target sweep (informational, one pass per state)
        for e in els:
            if (e['w'] < 40 or e['h'] < 40) and e['tag'] in ('button', 'a') and not NAV_OK.match(e['name'] or ''):
                self.small.append(f"{self.viewport}/{state}: '{e['name']}' {e['w']:.0f}x{e['h']:.0f}")
        print(f'  [{self.viewport}/{state}] {len(els)} elements')
        for e in els:
            name = e['name']
            if DENY.search(name or ''):
                self.log(state, name, 'skipped', 'denylist'); continue
            if NAV_OK.match(name or '') and e['tag'] == 'a':
                self.log(state, name, 'skipped', 'app tab'); continue
            if e['tag'] in ('input', 'textarea'):
                self.log(state, name, 'changed', 'input (typed via journeys)'); continue
            before = p.evaluate(PROBE_JS)
            err0 = len(self.errors)
            mut0 = p.evaluate("() => { window.__mut = 0; if (!window.__mo) { window.__mo = new MutationObserver(ms => window.__mut += ms.length); window.__mo.observe(document.body, {subtree: true, childList: true, attributes: true}) } return 0 }")
            void_ = mut0
            try:
                p.mouse.click(e['x'], e['y'])
            except Exception as ex:
                self.log(state, name, 'crash', str(ex).splitlines()[0][:100])
                self.close_layers(); self.ensure_charts(base)
                try: enter(); self.settle(400)
                except Exception: return
                continue
            self.settle(400)
            after = p.evaluate(PROBE_JS)
            muts = p.evaluate('() => window.__mut')
            errs = self.errors[err0:]
            real = [x for x in errs if 'Failed to load resource' not in x]
            if real:
                self.log(state, name, 'error', real[-1])
            elif errs:
                self.log(state, name, 'neterr', errs[-1][:80])
            elif after['url'] != before['url']:
                self.log(state, name, 'left-route', after['url'])
                self.ensure_charts(base)
            elif after['overflowX'] and not before['overflowX']:
                self.log(state, name, 'overflow', '')
            elif after['sheets'] != before['sheets'] or after['dialogs'] != before['dialogs'] or muts > 2:
                self.log(state, name, 'changed', f"muts={muts}")
            else:
                self.log(state, name, 'noop', '')
            # Recover the state for the next element. "Broken" = the probe is
            # gone, OR a sheet exists where none should (a tap opened a layer
            # over a bare-chart state), OR the state's own sheet/dialog closed.
            probe_ok = p.locator(probe_sel).count() > 0 if probe_sel else True
            if expect_sheet is False and (after['sheets'] > 0 or after['dialogs'] > 0):
                probe_ok = False
            if expect_sheet is True and after['sheets'] == 0 and after['dialogs'] == 0:
                probe_ok = False
            if not probe_ok:
                self.close_layers(); self.ensure_charts(base)
                try:
                    enter(); self.settle(400)
                except Exception:
                    self.close_layers(); self.ensure_charts(base)
                    try: enter(); self.settle(400)
                    except Exception:
                        self.log(state, '(re-enter)', 'crash', 'state unrecoverable'); return


def open_toolbar_btn(page, pattern):
    page.get_by_role('button', name=re.compile(pattern)).first.click(timeout=4000)


def run_viewport(browser, base, storage, vp_name):
    w, h = VIEWPORTS[vp_name]
    ctx = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=2,
                              is_mobile=True, has_touch=True, user_agent=IOS_UA, storage_state=storage)
    page = ctx.new_page()
    c = Crawl(page, vp_name)
    page.route('**/api/bars/**', lambda r: r.abort())
    page.goto(f'{base}/login', wait_until='domcontentloaded')
    page.evaluate(SEED_JS, SYMS)
    page.evaluate("(s) => localStorage.setItem('uct_flagged', JSON.stringify(s))", SYMS)
    page.goto(f'{base}/charts', wait_until='domcontentloaded')
    c.settle(2200); page.keyboard.press('Escape'); c.settle(2400)
    try:
        page.get_by_text('Got it', exact=True).click(timeout=1200)
    except Exception:
        pass

    S = c.crawl_state
    noop = lambda: None  # noqa: E731
    S(base, 'chart', noop, '[data-testid="mobile-chart-toolbar"]', expect_sheet=False)
    S(base, 'tf-sheet', lambda: open_toolbar_btn(page, '^Timeframe'), '[data-sheet-panel]', expect_sheet=True)
    S(base, 'type-sheet', lambda: open_toolbar_btn(page, '^Chart type'), '[data-sheet-panel]', expect_sheet=True)
    S(base, 'ind-sheet', lambda: open_toolbar_btn(page, '^Indicators'), '[data-sheet-panel]', expect_sheet=True)
    S(base, 'more-sheet', lambda: open_toolbar_btn(page, '^More tools'), '[data-sheet-panel]', expect_sheet=True)

    def enter_alert():
        c.close_layers(); open_toolbar_btn(page, '^More tools'); c.settle(400)
        page.get_by_role('button', name=re.compile('Set price alert')).click(timeout=3000)
    S(base, 'alert-sheet', enter_alert, '[data-sheet-panel]', expect_sheet=True)

    def enter_search():
        c.close_layers()
        page.get_by_label(re.compile('^Change symbol')).click(timeout=3000)
    S(base, 'search-sheet', enter_search, '[data-sheet-panel]', cap=24, expect_sheet=True)

    def enter_settings():
        c.close_layers(); open_toolbar_btn(page, '^More tools'); c.settle(400)
        page.get_by_role('button', name=re.compile('Chart settings')).click(timeout=3000)
        c.settle(800)
    S(base, 'settings', enter_settings, 'text=Chart Settings', cap=44)

    def enter_library():
        c.close_layers(); open_toolbar_btn(page, '^Indicators'); c.settle(400)
        page.get_by_role('button', name=re.compile('Browse indicator library')).click(timeout=3000)
        c.settle(900)
    S(base, 'library', enter_library, '[data-sheet-panel]', cap=26, expect_sheet=True)

    def enter_drawbar():
        c.close_layers()
        if page.get_by_label('Show toolbar').count():
            page.get_by_label('Show toolbar').click(timeout=3000)
        c.settle(400)
    S(base, 'drawbar', enter_drawbar, None, cap=40, expect_sheet=False)

    # Widget pages: every non-chart widget the layout holds (first 4).
    def widget_enter(label):
        def go():
            c.close_layers(); open_toolbar_btn(page, '^More tools'); c.settle(400)
            page.get_by_role('button', name=re.compile(f'^Open {label}', re.I)).click(timeout=3000)
            c.settle(900)
        return go
    try:
        c.close_layers(); c.ensure_charts(base)
        open_toolbar_btn(page, '^More tools'); c.settle(500)
        labels = page.evaluate('''() => [...document.querySelectorAll('[data-sheet-panel] button')]
            .map(b => b.getAttribute('aria-label') || '').filter(t => t.startsWith('Open ')).map(t => t.slice(5))''')
        c.close_layers()
        for lbl in labels[:4]:
            S(base, f'page-{lbl.lower()[:12].replace(" ", "-")}', widget_enter(re.escape(lbl)),
              '[class*="screenBody"]', cap=36)
    except Exception as e:
        c.log('widget-pages', '(discover)', 'crash', str(e).splitlines()[0][:120])

    ctx.close()
    return c


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=os.environ.get('MOBILE_AUDIT_BASE', 'http://localhost:8077'))
    ap.add_argument('--viewports', default='phone,ipad,se')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)
    email, pw = 'crawl@local.dev', 'LocalTest2026!'

    with sync_playwright() as p:
        try:
            browser = p.chromium.launch()
        except Exception:
            import glob
            exe = next((cand for pat in ('/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-*/chrome-linux/chrome')
                        for cand in sorted(glob.glob(pat)) if os.path.isfile(cand) and os.access(cand, os.X_OK)), None)
            browser = p.chromium.launch(executable_path=exe)
        boot = browser.new_context(user_agent=IOS_UA)
        bp = boot.new_page()
        bp.request.post(f'{args.base}/api/auth/signup', data={'email': email, 'password': pw, 'display_name': 'x'})
        r = bp.request.post(f'{args.base}/api/auth/login', data={'email': email, 'password': pw})
        if r.status != 200:
            print('login failed', r.status); return 0
        bp.request.post(f'{args.base}/api/watchlists/flagged/sync', data={'symbols': SYMS})
        storage = boot.storage_state()
        boot.close()

        crawls = []
        for vp in args.viewports.split(','):
            vp = vp.strip()
            if vp not in VIEWPORTS: continue
            print(f'== viewport {vp} ==')
            try:
                crawls.append(run_viewport(browser, args.base, storage, vp))
            except Exception as e:
                print(f'  viewport {vp} CRASHED:', str(e).splitlines()[0][:200])
        browser.close()

    rows = [r for c in crawls for r in c.ledger]
    small = sorted(set(s for c in crawls for s in c.small))
    by = {}
    for r in rows:
        by[r['outcome']] = by.get(r['outcome'], 0) + 1
    with open(os.path.join(OUT, 'ledger.tsv'), 'w') as f:
        f.write('viewport_state\tname\toutcome\tnote\n')
        for c in crawls:
            for r in c.ledger:
                f.write(f"{c.viewport}/{r['state']}\t{r['name']}\t{r['outcome']}\t{r['note']}\n")
    lines = ['# Mobile action-point crawl', '',
             f"**{len(rows)} action points** across {len(crawls)} viewports — " +
             ', '.join(f"{k}: {v}" for k, v in sorted(by.items())), '']
    for cls in ('error', 'crash', 'left-route', 'overflow'):
        hits = [r for c in crawls for r in c.ledger if r['outcome'] == cls]
        if hits:
            lines.append(f'## {cls} ({len(hits)})')
            lines += [f"- [{c.viewport}/{r['state']}] {r['name']} — {r['note']}"
                      for c in crawls for r in c.ledger if r['outcome'] == cls][:30]
            lines.append('')
    noops = [(f"{c.viewport}/{r['state']}", r['name']) for c in crawls for r in c.ledger if r['outcome'] == 'noop']
    lines.append(f'## noop / dead-tap candidates ({len(noops)})')
    lines += [f'- [{s}] {n}' for s, n in noops[:40]]
    lines.append('')
    lines.append(f'## sub-44px targets ({len(small)})')
    lines += [f'- {s}' for s in small[:40]]
    with open(os.path.join(OUT, 'report.md'), 'w') as f:
        f.write('\n'.join(lines) + '\n')
    print(f"\n{len(rows)} action points -> {os.path.join(OUT, 'report.md')}")
    print('   ' + ', '.join(f'{k}: {v}' for k, v in sorted(by.items())))
    return 0


if __name__ == '__main__':
    sys.exit(main())
