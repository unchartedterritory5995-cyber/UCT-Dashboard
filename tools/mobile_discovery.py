"""mobile_discovery.py — the 500-user discovery sweep for the phone /charts tab.

Where iphone_walk.py is the regression GATE (five pass/fail invariants), this is
the DISCOVERY net: it runs user JOURNEYS across device sizes, orientations,
network failures, edge-case input and every dialog, capturing a screenshot at
each beat plus every console error/pageerror — then a human (or Claude) reviews
the captures like a design reviewer and turns findings into fixes.

Journeys (each an isolated browser context):
  se-seeded        iPhone SE class (375x667) — the smallest common phone
  promax           430x932 — the largest
  land-sheets      bottom sheets on a 393px-tall landscape screen
  rotate-midsheet  orientation change while a sheet is open
  search-edge      dotted tickers, garbage input, the Go-to fallback, recents
  neterr-bars      /api/bars dead + no cache — the error state a user sees
  neterr-search    /api/ticker-search dead — search must degrade, not blank
  settings-dialog  the chart-settings modal on a phone
  indicator-lib    the indicator library dialog + adding a sub-pane indicator
  persistence      TF + chart-type survive a reload
  two-charts       a layout with two chart widgets
  ipad-dialogs     the same dialogs at tablet size beside the docked panel

Output: tools/mobile_audit_out/discovery/<journey>/*.png + report.md
(console errors, soft findings, screenshot index). Exit code is ALWAYS 0 —
discovery reports, the walk gates.

Usage:  python tools/mobile_discovery.py --base http://localhost:8077
"""
import argparse
import os
import re
import sys

from playwright.sync_api import sync_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from iphone_walk import IOS_UA, SEED_JS, SYMS  # noqa: E402

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mobile_audit_out', 'discovery')
REPORT = []


_STORAGE_STATE = None  # cookies from the ONE login — 12 back-to-back logins trip the auth 429 guard


class Journey:
    def __init__(self, browser, base, email, pw, name, width=393, height=852, seed=True,
                 block=('**/api/bars/**',), extra_block=()):
        self.name = name
        self.dir = os.path.join(OUT, name)
        os.makedirs(self.dir, exist_ok=True)
        self.errors = []
        self.findings = []
        self.shots = []
        global _STORAGE_STATE
        self.ctx = browser.new_context(viewport={'width': width, 'height': height},
                                       device_scale_factor=2, is_mobile=True, has_touch=True,
                                       user_agent=IOS_UA, storage_state=_STORAGE_STATE)
        self.base = base
        # Build the page mostly like make_page, but with journey-specific routing.
        page = self.ctx.new_page()
        self.page = page
        page.on('console', lambda m: self.errors.append(f'console.{m.type}: {m.text[:220]}')
                if m.type in ('error',) and 'favicon' not in m.text else None)
        page.on('pageerror', lambda e: self.errors.append(f'pageerror: {str(e)[:220]}'))
        if _STORAGE_STATE is None:
            page.request.post(f'{base}/api/auth/signup', data={'email': email, 'password': pw, 'display_name': 'x'})
            r = page.request.post(f'{base}/api/auth/login', data={'email': email, 'password': pw})
            if r.status != 200:
                print('login failed', r.status)
                sys.exit(2)
            page.request.post(f'{base}/api/watchlists/flagged/sync', data={'symbols': SYMS})
            _STORAGE_STATE = self.ctx.storage_state()
        for pat in tuple(block) + tuple(extra_block):
            page.route(pat, lambda route: route.abort())
        page.goto(f'{base}/login', wait_until='domcontentloaded')
        if seed:
            page.evaluate(SEED_JS, SYMS)
        page.evaluate("(s) => localStorage.setItem('uct_flagged', JSON.stringify(s))", SYMS)
        page.goto(f'{base}/charts', wait_until='domcontentloaded')
        page.wait_for_timeout(2200)
        page.keyboard.press('Escape')
        page.wait_for_timeout(2600)
        try:
            page.get_by_text('Got it', exact=True).click(timeout=1200)
        except Exception:
            pass

    def shot(self, label, wait=900):
        self.page.wait_for_timeout(wait)
        p = os.path.join(self.dir, f'{len(self.shots):02d}-{label}.png')
        self.page.screenshot(path=p)
        self.shots.append(f'{len(self.shots):02d}-{label}')
        print(f'  [{self.name}] shot {label}')

    def find(self, text):
        self.findings.append(text)
        print(f'  [{self.name}] FINDING: {text}')

    def soft(self, cond, text):
        if not cond:
            self.find(text)

    def close(self):
        REPORT.append((self.name, self.shots, self.findings, self.errors))
        try:
            self.ctx.close()
        except Exception:
            pass


def open_sheet(page, button_name, wait=800):
    page.get_by_role('button', name=re.compile(button_name)).first.click(timeout=4000)
    page.wait_for_timeout(wait)


def j_small_phone(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'se-seeded', width=375, height=667)
    p = j.page
    j.shot('chart')
    j.soft(p.get_by_test_id('mobile-chart-toolbar').is_visible(), 'toolbar missing at SE size')
    for name, label in [('Timeframe', 'tf-sheet'), ('Chart type', 'type-sheet'), ('More tools', 'more-sheet')]:
        try:
            open_sheet(p, f'^{name}')
            j.shot(label)
            p.keyboard.press('Escape'); p.wait_for_timeout(400)
        except Exception as e:
            j.find(f'{name} sheet failed at SE size: {str(e).splitlines()[0][:120]}')
    # Expanded drawing toolbar at the smallest size — the historic overlap zone.
    try:
        p.get_by_label('Show toolbar').click(timeout=3000)
        j.shot('toolbar-expanded')
    except Exception:
        j.find('drawing toolbar toggle not found at SE size')
    j.close()


def j_promax(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'promax', width=430, height=932)
    j.shot('chart')
    j.close()


def j_landscape_sheets(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'land-sheets', width=852, height=393)
    p = j.page
    j.shot('chart')
    for name, label in [('Timeframe', 'tf-sheet'), ('More tools', 'more-sheet')]:
        try:
            open_sheet(p, f'^{name}')
            j.shot(label)
            p.keyboard.press('Escape'); p.wait_for_timeout(400)
        except Exception as e:
            j.find(f'{name} sheet failed in landscape: {str(e).splitlines()[0][:120]}')
    try:
        p.get_by_label(re.compile('^Change symbol')).click(timeout=3000)
        j.shot('search-landscape')
        p.keyboard.press('Escape'); p.wait_for_timeout(300)
    except Exception as e:
        j.find(f'search failed in landscape: {str(e).splitlines()[0][:120]}')
    j.close()


def j_rotate_midsheet(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'rotate-midsheet')
    p = j.page
    open_sheet(p, '^Timeframe')
    j.shot('tf-portrait')
    p.set_viewport_size({'width': 852, 'height': 393})
    j.shot('tf-after-rotate')
    sheet_alive = p.locator('[data-sheet-panel]').count() > 0
    j.soft(sheet_alive, 'TF sheet vanished on rotation (state loss)')
    if sheet_alive:
        # Can it still commit?
        try:
            p.get_by_role('option', name='1h').click(timeout=3000)
            p.wait_for_timeout(500)
        except Exception:
            j.find('TF sheet present after rotation but not tappable')
    p.set_viewport_size({'width': 393, 'height': 852})
    j.shot('back-portrait')
    j.close()


def j_search_edge(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'search-edge')
    p = j.page
    p.get_by_label(re.compile('^Change symbol')).click(timeout=4000)
    p.wait_for_timeout(600)
    box = p.get_by_role('textbox', name='Search symbol')
    box.fill('BRK.B')
    j.shot('search-dotted')
    try:
        p.get_by_role('button', name=re.compile('Go to BRK.B')).click(timeout=3000)
        j.shot('after-dotted-pick')
        j.soft('BRK.B' in (p.get_by_label(re.compile('^Change symbol')).text_content() or ''),
               'strip does not show BRK.B after dotted-ticker pick')
    except Exception:
        j.find('no Go-to row for a dotted ticker (BRK.B)')
    p.get_by_label(re.compile('^Change symbol')).click(timeout=4000)
    p.wait_for_timeout(500)
    p.get_by_role('textbox', name='Search symbol').fill('XYZQ')
    j.shot('search-garbage')
    p.get_by_role('textbox', name='Search symbol').fill('')
    j.shot('search-empty-recents')
    p.keyboard.press('Escape')
    j.close()


def j_neterr_bars(browser, base, email, pw):
    # No IDB seed + bars blocked = the true "backend down / no cache" view.
    j = Journey(browser, base, email, pw, 'neterr-bars', seed=False)
    j.shot('chart-no-data', wait=2500)
    p = j.page
    retry = p.get_by_role('button', name=re.compile('retry', re.I))
    j.soft(retry.count() > 0 or p.get_by_text(re.compile('load|unavailable|error', re.I)).count() > 0,
           'bars failure shows neither an error message nor a retry')
    j.close()


def j_neterr_search(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'neterr-search', extra_block=('**/api/ticker-search**',))
    p = j.page
    p.get_by_label(re.compile('^Change symbol')).click(timeout=4000)
    p.wait_for_timeout(500)
    p.get_by_role('textbox', name='Search symbol').fill('NVDA')
    j.shot('search-api-dead')
    j.soft(p.get_by_role('button', name=re.compile('Go to NVDA')).count() > 0,
           'search API dead: no Go-to fallback row for a typed ticker')
    j.close()


def j_settings_dialog(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'settings-dialog')
    p = j.page
    open_sheet(p, '^More tools')
    p.get_by_role('button', name=re.compile('Chart settings')).click(timeout=4000)
    j.shot('settings-modal', wait=1200)
    j.close()


def j_indicator_library(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'indicator-lib')
    p = j.page
    open_sheet(p, '^Indicators')
    try:
        p.get_by_role('button', name=re.compile('Browse indicator library')).click(timeout=4000)
        j.shot('library-dialog', wait=1400)
        # Try to add RSI — a sub-pane indicator — and see the phone render.
        try:
            sb = p.get_by_placeholder(re.compile('search', re.I)).first
            sb.fill('RSI')
            p.wait_for_timeout(600)
            j.shot('library-rsi-results')
            p.get_by_text(re.compile('^RSI', re.I)).first.click(timeout=3000)
            p.wait_for_timeout(900)
            j.shot('library-after-add')
            p.keyboard.press('Escape'); p.wait_for_timeout(600)
            p.keyboard.press('Escape'); p.wait_for_timeout(600)
            j.shot('chart-with-subpane', wait=1500)
        except Exception as e:
            j.find(f'could not add RSI from the library on phone: {str(e).splitlines()[0][:140]}')
    except Exception as e:
        j.find(f'indicator library did not open on phone: {str(e).splitlines()[0][:140]}')
    j.close()


def j_persistence(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'persistence')
    p = j.page
    open_sheet(p, '^Timeframe')
    p.get_by_role('option', name='1h').click(timeout=3000)
    p.wait_for_timeout(800)
    open_sheet(p, '^Chart type')
    p.get_by_role('option', name='Line').click(timeout=3000)
    p.wait_for_timeout(1200)
    p.reload(wait_until='domcontentloaded')
    p.wait_for_timeout(2500)
    p.keyboard.press('Escape')
    p.wait_for_timeout(2200)
    j.shot('after-reload')
    tf_pill = p.get_by_role('button', name=re.compile('^Timeframe'))
    label = (tf_pill.text_content() or '').strip()
    j.soft(label == '1h', f'TF did not survive reload (pill shows "{label}", expected "1h")')
    j.close()


def j_two_charts(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'two-charts')
    p = j.page
    # Add a second chart through the Tools sheet roster.
    open_sheet(p, '^More tools')
    try:
        p.get_by_role('button', name='Add Chart').click(timeout=3000)
        p.wait_for_timeout(1500)
        j.shot('after-add-second-chart')
        # The shell binds the FIRST chart; the second appears under Your widgets.
        open_sheet(p, '^More tools')
        j.shot('more-sheet-two-charts')
        p.keyboard.press('Escape')
    except Exception as e:
        j.find(f'adding a second chart failed: {str(e).splitlines()[0][:140]}')
    j.close()


def j_ipad_dialogs(browser, base, email, pw):
    j = Journey(browser, base, email, pw, 'ipad-dialogs', width=820, height=1180)
    p = j.page
    j.shot('two-pane')
    open_sheet(p, '^More tools')
    j.shot('more-sheet-ipad')
    try:
        p.get_by_role('button', name=re.compile('Chart settings')).click(timeout=4000)
        j.shot('settings-ipad', wait=1200)
        p.keyboard.press('Escape')
    except Exception as e:
        j.find(f'settings failed on iPad: {str(e).splitlines()[0][:120]}')
    j.close()


JOURNEYS = [j_small_phone, j_promax, j_landscape_sheets, j_rotate_midsheet, j_search_edge,
            j_neterr_bars, j_neterr_search, j_settings_dialog, j_indicator_library,
            j_persistence, j_two_charts, j_ipad_dialogs]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default=os.environ.get('MOBILE_AUDIT_BASE', 'http://localhost:8077'))
    ap.add_argument('--email', default=os.environ.get('MOBILE_AUDIT_EMAIL', 'mobtest@local.dev'))
    ap.add_argument('--password', default=os.environ.get('MOBILE_AUDIT_PASSWORD', 'LocalTest2026!'))
    ap.add_argument('--only', default=None, help='comma list of journey suffixes to run')
    args = ap.parse_args()
    os.makedirs(OUT, exist_ok=True)

    with sync_playwright() as pw:
        try:
            browser = pw.chromium.launch()
        except Exception:
            import glob
            exe = next((c for pat in ('/opt/pw-browsers/chromium', '/opt/pw-browsers/chromium-*/chrome-linux/chrome')
                        for c in sorted(glob.glob(pat)) if os.path.isfile(c) and os.access(c, os.X_OK)), None)
            browser = pw.chromium.launch(executable_path=exe)
        for fn in JOURNEYS:
            tag = fn.__name__[2:]
            if args.only and not any(s in tag for s in args.only.split(',')):
                continue
            try:
                fn(browser, args.base, args.email, args.password)
            except Exception as e:
                REPORT.append((tag, [], [f'JOURNEY CRASHED: {str(e).splitlines()[0][:200]}'], []))
                print(f'  [{tag}] CRASHED:', str(e).splitlines()[0][:200])
        # Good-citizen cleanup: journeys leave color-group A on whatever they
        # last picked (server-persisted), which poisons the WALK's seeded-sym
        # assumption. Route the account back to SPY.
        try:
            j = Journey(browser, args.base, args.email, args.password, 'zz-cleanup')
            j.page.get_by_label(re.compile('^Change symbol')).click(timeout=4000)
            j.page.wait_for_timeout(600)
            j.page.get_by_role('textbox', name='Search symbol').fill('SPY')
            j.page.wait_for_timeout(800)
            j.page.get_by_role('button', name=re.compile('^SPY')).first.click(timeout=4000)
            j.page.wait_for_timeout(900)
            open_sheet(j.page, '^Timeframe')
            j.page.get_by_role('option', name='1D').click(timeout=4000)
            j.page.wait_for_timeout(900)
            j.close()
            REPORT.pop()  # cleanup is not a journey — keep it out of the report
        except Exception:
            pass
        browser.close()

    lines = ['# Mobile discovery report', '']
    total_findings = 0
    for name, shots, findings, errors in REPORT:
        lines.append(f'## {name}')
        if findings:
            total_findings += len(findings)
            lines += [f'- ⚠ {f}' for f in findings]
        if errors:
            dedup = sorted(set(errors))
            lines += [f'- 🔴 {e}' for e in dedup[:8]]
            if len(dedup) > 8:
                lines.append(f'- 🔴 …and {len(dedup) - 8} more console errors')
        if not findings and not errors:
            lines.append('- clean')
        lines.append(f'- shots: {", ".join(shots) if shots else "none"}')
        lines.append('')
    with open(os.path.join(OUT, 'report.md'), 'w') as f:
        f.write('\n'.join(lines))
    print(f'\nreport -> {os.path.join(OUT, "report.md")}  ({total_findings} soft findings)')
    return 0


if __name__ == '__main__':
    sys.exit(main())
