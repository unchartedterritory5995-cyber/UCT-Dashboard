"""Probe: where is keyboard focus after the Model Book's Save to Notebook opens its box?"""
import sys
from playwright.sync_api import sync_playwright
assert not any(m == 'api' or m.startswith('api.') for m in sys.modules)
B = 'http://127.0.0.1:8547'
with sync_playwright() as p:
    br = p.chromium.launch()
    ctx = br.new_context(viewport={'width': 1366, 'height': 900}, reduced_motion='reduce')
    ctx.request.post(B + '/api/auth/login', data={'email': 'cxwalk@local.dev', 'password': 'LocalTest2026!'})
    pg = ctx.new_page()
    pg.goto(B + '/model-book?view=years')
    try:
        pg.locator('div[role="dialog"][aria-label="Welcome"]').first.wait_for(state='visible', timeout=3000)
        pg.keyboard.press('Escape')
        pg.locator('div[role="dialog"][aria-label="Welcome"]').first.wait_for(state='detached', timeout=8000)
    except Exception:
        pass
    pg.get_by_role('button', name='2025', exact=True).first.click()
    pg.get_by_text('MU', exact=True).first.click()
    btn = pg.get_by_role('button', name='Save MU 2025 to Notebook')
    btn.wait_for(timeout=20000)
    btn.focus()
    pg.keyboard.press('Enter')
    for t in (100, 300, 800, 1500):
        pg.wait_for_timeout(t)
        print(t, pg.evaluate("() => { const e=document.activeElement; return [e?.tagName, e?.getAttribute('aria-label'), e?.textContent?.slice(0,40)] }"),
              pg.locator('[role=menu]').count())
    print('menu vis', pg.evaluate("() => document.querySelector('[role=menu]')?.style.visibility"))
    pg.evaluate("() => { window.__focusLog=[]; document.addEventListener('focusin', e => window.__focusLog.push(['in', e.target.tagName, e.target.getAttribute('aria-label')]), true) }")
    pg.keyboard.press('Escape'); pg.wait_for_timeout(300)
    print('after esc menus', pg.locator('[role=menu]').count())
    btn.click(); pg.wait_for_timeout(800)
    print('mouse open active', pg.evaluate("() => [document.activeElement?.tagName, document.activeElement?.getAttribute('aria-label')]"))
    print('focus log', pg.evaluate("() => window.__focusLog"))
    print('menu html', pg.evaluate("() => document.querySelector('[role=menu]')?.outerHTML.slice(0,400)"))
    print('try focus', pg.evaluate("() => { const t=document.querySelector('[role=menu] textarea'); t?.focus(); return [document.activeElement===t, getComputedStyle(t).visibility, getComputedStyle(t).display] }"))
    br.close()
