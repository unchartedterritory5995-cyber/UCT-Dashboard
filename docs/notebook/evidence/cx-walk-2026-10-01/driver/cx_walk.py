"""Lane CX (G-040) real-browser walk against the LOCAL sandbox on :8547.

⛔ Never imports api.*: every fixture goes through the sandboxed server over HTTP.
Keyboard first: each "Save to Notebook" is reached with Tab and pressed with Enter.
Writes walk.json + screenshots into OUT (the evidence dir) as it goes.
"""
import base64
import json
import re
import sys
import time
import traceback
from pathlib import Path

from playwright.sync_api import sync_playwright

assert not any(m == 'api' or m.startswith('api.') for m in sys.modules)

BASE = 'http://127.0.0.1:8547'
ADMIN = ('hubtest@local.dev', 'LocalTest2026!')
MEMBER = ('cxwalk@local.dev', 'LocalTest2026!')
OUT = Path(sys.argv[1])
OUT.mkdir(parents=True, exist_ok=True)
RUN = time.strftime('%H%M%S')
res = {'run': RUN, 'base': BASE, 'steps': {}, 'pageerrors': [], 'console_errors': [], 'log': []}


def save():
    (OUT / 'walk.json').write_text(json.dumps(res, indent=1, ensure_ascii=False), encoding='utf-8')


def log(msg):
    res['log'].append(msg)
    print(msg, flush=True)


def record(step, verdict, **facts):
    res['steps'][step] = {'verdict': verdict, **facts}
    log(f'[{verdict}] {step}: ' + json.dumps(facts, default=str, ensure_ascii=False)[:600])
    save()


def shot(pg, name):
    pg.screenshot(path=str(OUT / f'{name}.png'), full_page=False)


def watch(pg):
    pg.on('pageerror', lambda e: res['pageerrors'].append(f'{pg.url} :: {str(e)[:300]}'))
    pg.on('console', lambda m: res['console_errors'].append(f'{pg.url} :: {m.text[:300]}') if m.type == 'error' else None)


def dismiss_intro(pg):
    d = pg.locator('div[role="dialog"][aria-label="Welcome"]')
    try:
        d.first.wait_for(state='visible', timeout=3000)
    except Exception:  # noqa: BLE001
        return
    pg.keyboard.press('Escape')
    try:
        d.first.wait_for(state='detached', timeout=8000)
    except Exception:  # noqa: BLE001
        pg.get_by_role('button', name='Skip intro', exact=True).click(timeout=2000)
        d.first.wait_for(state='detached', timeout=8000)


def tab_to(pg, name_re, max_tabs=400):
    """Press Tab until the focused element's accessible label matches. Keyboard only."""
    pg.locator('body').focus()
    for i in range(max_tabs):
        pg.keyboard.press('Tab')
        label = pg.evaluate("() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || e.textContent || '') : '' }")
        if re.search(name_re, label or ''):
            return i + 1, label
    raise RuntimeError(f'Tab never reached {name_re!r} in {max_tabs} presses')


def toast_text(pg, pattern, timeout=8000):
    loc = pg.get_by_role('status').filter(has_text=re.compile(pattern))
    loc.first.wait_for(state='visible', timeout=timeout)
    return loc.first.inner_text()


def new_note(api, title):
    r = api.post(BASE + '/api/j2/notes', data={'title': title, 'bodyJson': {'type': 'doc', 'content': [{'type': 'paragraph'}]}})
    assert r.status in (200, 201), r.text()[:300]
    return r.json()['note']


def open_note(pg, note_id):
    pg.goto(f'{BASE}/journal/notebook?note={note_id}')
    dismiss_intro(pg)
    pg.wait_for_selector('.ProseMirror', timeout=20000)
    pg.wait_for_timeout(600)


def embed(pg, widget):
    v = pg.locator(f'[data-widget-embed-view="{widget}"]').first
    v.wait_for(state='attached', timeout=15000)
    v.scroll_into_view_if_needed()
    inner = pg.locator(f'[data-testid="{widget}-embed"]').first
    inner.wait_for(state='visible', timeout=15000)
    return inner


def b64url(s):
    return base64.urlsafe_b64encode(s.encode()).decode().rstrip('=')


with sync_playwright() as p:
    br = p.chromium.launch()
    actx = br.new_context()
    a = actx.request
    a.post(BASE + '/api/auth/login', data={'email': ADMIN[0], 'password': ADMIN[1]})
    ctx = br.new_context(viewport={'width': 1366, 'height': 900}, reduced_motion='reduce')
    api = ctx.request
    r = api.post(BASE + '/api/auth/login', data={'email': MEMBER[0], 'password': MEMBER[1]})
    me = api.get(BASE + '/api/auth/me').json()
    res['account'] = {'login': r.status, 'role': (me.get('user') or {}).get('role'), 'paid_equiv': me.get('paid_equiv')}
    save()
    pg = ctx.new_page()
    watch(pg)

    # ── 1. SCREENER ────────────────────────────────────────────────────────────
    try:
        note1 = new_note(api, f'CX walk Screener {RUN}')
        open_note(pg, note1['id'])                      # this is now the last-opened note
        spec = b64url(json.dumps({'f': {'price': {'op': 'gte', 'min': 10}}}))
        pg.goto(f'{BASE}/screener?s={spec}')
        dismiss_intro(pg)
        pg.get_by_role('table', name='Scan results').wait_for(timeout=30000)
        pg.wait_for_timeout(1500)
        btn = pg.get_by_role('button', name='Save these screener results to Notebook')
        btn.wait_for(timeout=15000)
        pg.wait_for_function("() => !document.querySelector('[aria-label=\"Save these screener results to Notebook\"]').disabled", timeout=15000)
        shot(pg, '1a-screener-before-save')
        tabs, label = tab_to(pg, r'^Save these screener results to Notebook$')
        pg.keyboard.press('Enter')
        msg = toast_text(pg, r'sent to|captured|locked|failed')
        shot(pg, '1b-screener-saved-toast')
        open_note(pg, note1['id'])
        e = embed(pg, 'screener')
        pg.wait_for_timeout(500)
        text1 = e.inner_text()
        criteria = [t.strip() for t in pg.get_by_role('list', name='Screen criteria').locator('li').all_inner_texts()]
        rows1 = pg.locator('[data-testid^="screener-embed-row-"]').count()
        asof = pg.get_by_test_id('screener-embed-asof').inner_text()
        total = pg.get_by_test_id('screener-embed-total').inner_text()
        cut = pg.get_by_test_id('screener-embed-cut').inner_text() if pg.get_by_test_id('screener-embed-cut').count() else None
        run_link = pg.get_by_test_id('screener-embed-run')
        href = run_link.get_attribute('href')
        e.screenshot(path=str(OUT / '1c-screener-embed.png'))
        pg.reload()
        dismiss_intro(pg)
        pg.wait_for_selector('.ProseMirror', timeout=20000)
        e2 = embed(pg, 'screener')
        pg.wait_for_timeout(500)
        text2 = e2.inner_text()
        e2.screenshot(path=str(OUT / '1d-screener-embed-after-reload.png'))
        # "Run this scan now" opens a FRESH run on the Screener
        e2_link = pg.get_by_test_id('screener-embed-run')
        e2_link.click()
        pg.wait_for_url(re.compile(r'/screener\?s='), timeout=15000)
        dismiss_intro(pg)
        pg.get_by_role('table', name='Scan results').wait_for(timeout=30000)
        pg.wait_for_timeout(1200)
        filter_chip = criteria[1] if len(criteria) > 1 else '(none)'
        # the chip's own text carries its remove glyph ("Price: Over $10x"), so match its words
        chips = pg.get_by_text(filter_chip).count()
        shot(pg, '1e-run-this-scan-now-fresh-run')
        ok = (re.search(r'sent to', msg or '') and rows1 >= 1 and 'As of' in asof
              and (cut is None or 'Showing the first' in cut) and text1 == text2 and chips >= 1
              and href.startswith('/screener?s='))
        record('1_screener', 'PASS' if ok else 'FAIL', note_id=note1['id'], tabs_to_button=tabs,
               toast=msg, rows_frozen=rows1, total_line=total, asof_line=asof, cut_line=cut,
               run_href=href, identical_after_reload=text1 == text2, criteria=criteria,
               fresh_run_filter_chip=filter_chip, fresh_run_chip_count=chips,
               fresh_run_url=pg.url)
    except Exception as ex:  # noqa: BLE001
        shot(pg, '1z-screener-error')
        record('1_screener', 'INCONCLUSIVE', error=str(ex)[:400], tb=traceback.format_exc()[-1200:])

    # ── 2. COT ────────────────────────────────────────────────────────────────
    try:
        note2 = new_note(api, f'CX walk COT {RUN}')
        open_note(pg, note2['id'])
        pg.goto(f'{BASE}/breadth?tab=cot&cot=CL')
        dismiss_intro(pg)
        save_btn = pg.locator('button[aria-label^="Save CL COT positioning for the week of"]')
        save_btn.wait_for(timeout=40000)
        latest_label = save_btn.get_attribute('aria-label')
        canv = pg.locator('canvas').nth(1)
        canv.scroll_into_view_if_needed()
        box = canv.bounding_box()
        pg.mouse.move(box['x'] + box['width'] * 0.35, box['y'] + box['height'] * 0.5)
        pg.wait_for_timeout(800)
        scrub_label = save_btn.get_attribute('aria-label')
        when = pg.locator('aside[aria-label="COT positioning"]').inner_text()[:120]
        shot(pg, '2a-cot-scrubbed')
        tabs, label = tab_to(pg, r'^Save CL COT positioning for the week of')
        pg.keyboard.press('Enter')
        msg = toast_text(pg, r'sent to|captured|locked|failed')
        shot(pg, '2b-cot-saved-toast')
        week_saved = re.search(r'week of (\S+) to Notebook', label).group(1)
        open_note(pg, note2['id'])
        e = embed(pg, 'cot')
        wk = pg.get_by_test_id('cot-embed-week').inner_text()
        cur = pg.get_by_test_id('cot-embed-current')
        cur_href = cur.get_attribute('href')
        e.screenshot(path=str(OUT / '2c-cot-embed.png'))
        cur.click()
        pg.wait_for_url(re.compile(r'/breadth\?tab=cot&cot=CL'), timeout=15000)
        dismiss_intro(pg)
        landed = pg.locator('button[aria-label^="Save CL COT positioning for the week of"]')
        landed.wait_for(timeout=40000)
        landed_label = landed.get_attribute('aria-label')
        shot(pg, '2d-cot-current-link-landed')
        m, d, y = week_saved.split('/')
        iso = f'{y}-{int(m):02d}-{int(d):02d}'
        ok = (scrub_label != latest_label and label == scrub_label and re.search(r'sent to', msg)
              and 'Report week' in wk and cur_href == '/breadth?tab=cot&cot=CL'
              and landed_label == latest_label)
        record('2_cot', 'PASS' if ok else 'FAIL', note_id=note2['id'], latest_week_label=latest_label,
               scrubbed_week_label=scrub_label, tabs_to_button=tabs, toast=msg, week_saved=week_saved,
               week_saved_iso=iso, embed_week_line=wk, current_href=cur_href,
               current_link_landed_on=landed_label, rail_head=when)
    except Exception as ex:  # noqa: BLE001
        shot(pg, '2z-cot-error')
        record('2_cot', 'INCONCLUSIVE', error=str(ex)[:400], tb=traceback.format_exc()[-1200:])

    # ── 3. MODEL BOOK ─────────────────────────────────────────────────────────
    try:
        stocks = api.get(BASE + '/api/modelbook/stocks?year=2025').json()['stocks']
        mu = next(s for s in stocks if s['symbol'] == 'MU')
        # clear fixtures an earlier, interrupted run left behind: the embed resolves a setup by its
        # canonical identity (type + date) as well as its id, so a leftover twin would answer for it
        pre = api.get(BASE + f'/api/modelbook/stock/{mu["id"]}').json().get('setups') or []
        leftovers = [x['id'] for x in pre if x.get('notes') == 'CX walk fixture setup']
        cleared = [a.delete(BASE + f'/api/modelbook/setup/{i}').status for i in leftovers]
        sr = a.post(BASE + f'/api/modelbook/stock/{mu["id"]}/setups', data={
            'setup_type': 'VCP', 'label_date': '2025-06-20', 'timeframe': 'D', 'grade': 'A',
            'entry_price': 120.5, 'stop_price': 111.0, 'target_price': 150.0,
            'notes': 'CX walk fixture setup', 'marker_side': 'belowBar', 'marker_shape': 'arrowUp'})
        setup = sr.json().get('setup') or sr.json()
        note3 = new_note(api, f'CX walk Model Book {RUN}')
        open_note(pg, note3['id'])
        pg.goto(f'{BASE}/model-book?view=years')
        dismiss_intro(pg)
        pg.get_by_role('button', name='2025', exact=True).first.click()
        pg.get_by_text('MU', exact=True).first.click()
        pg.get_by_text('VCP', exact=True).first.wait_for(timeout=20000)
        pg.get_by_text('VCP', exact=True).first.click()
        pg.wait_for_timeout(800)
        shot(pg, '3a-modelbook-setup-selected')
        tabs, label = tab_to(pg, r'^Save MU 2025 to Notebook$')
        pg.keyboard.press('Enter')
        box = pg.get_by_role('textbox', name='Your note on this (optional)')
        box.wait_for(timeout=8000)
        # the popover focuses its first control once it has measured itself -- wait for THAT
        pg.wait_for_function("() => document.activeElement?.getAttribute('aria-label') === 'Your note on this (optional)'", timeout=8000)
        focused_box = pg.evaluate("() => document.activeElement?.getAttribute('aria-label')")
        pg.keyboard.type('memory names breaking out of a tight VCP')
        shot(pg, '3b-modelbook-annotation')
        pg.keyboard.press('Tab')       # -> Save
        on_save = pg.evaluate("() => document.activeElement?.textContent")
        assert on_save == 'Save', f'Tab landed on {on_save!r}, not Save'
        pg.keyboard.press('Enter')
        msg = toast_text(pg, r'sent to|captured|locked|failed')
        shot(pg, '3c-modelbook-saved-toast')
        open_note(pg, note3['id'])
        e = embed(pg, 'modelbook')
        pg.get_by_test_id('modelbook-embed-title').wait_for(timeout=15000)
        text = e.inner_text()
        e.screenshot(path=str(OUT / '3d-modelbook-embed.png'))
        # tombstone: the admin removes the referenced setup through the Model Book's own endpoint
        d = a.delete(BASE + f'/api/modelbook/setup/{setup["id"]}')
        pg.reload()
        dismiss_intro(pg)
        pg.wait_for_selector('.ProseMirror', timeout=20000)
        e2 = embed(pg, 'modelbook')
        pg.get_by_test_id('modelbook-embed-tombstone').wait_for(timeout=15000)
        ttext = e2.inner_text()
        e2.screenshot(path=str(OUT / '3e-modelbook-tombstone.png'))
        ok = (re.search(r'sent to', msg) and 'MU' in text and 'VCP' in text
              and 'memory names breaking out of a tight VCP' in text and d.status == 200
              and 'This Model Book entry was removed' in ttext
              and 'memory names breaking out of a tight VCP' in ttext)
        record('3_modelbook', 'PASS' if ok else 'FAIL', note_id=note3['id'], setup_id=setup.get('id'),
               tabs_to_button=tabs, annotation_box_focused=focused_box, toast=msg, embed_text=text,
               setup_delete_status=d.status, tombstone_text=ttext,
               leftover_fixtures_cleared=dict(zip(leftovers, cleared)))
    except Exception as ex:  # noqa: BLE001
        shot(pg, '3z-modelbook-error')
        record('3_modelbook', 'INCONCLUSIVE', error=str(ex)[:400], tb=traceback.format_exc()[-1200:])

    # ── 4. LOCKED last-opened note ────────────────────────────────────────────
    try:
        note4 = new_note(api, f'CX walk Locked {RUN}')
        open_note(pg, note4['id'])                       # last-opened note
        lk = api.patch(BASE + f'/api/j2/notes/{note4["id"]}/lock', data={'locked': True})
        inbox_before = len(api.get(BASE + '/api/j2/inbox').json().get('captures') or [])
        spec = b64url(json.dumps({'f': {'price': {'op': 'gte', 'min': 10}}}))
        pg.goto(f'{BASE}/screener?s={spec}')
        dismiss_intro(pg)
        pg.get_by_role('table', name='Scan results').wait_for(timeout=30000)
        pg.wait_for_function("() => !document.querySelector('[aria-label=\"Save these screener results to Notebook\"]').disabled", timeout=15000)
        tabs, _ = tab_to(pg, r'^Save these screener results to Notebook$')
        pg.keyboard.press('Enter')
        msg = toast_text(pg, r'locked|sent to|captured|failed')
        shot(pg, '4a-locked-note-toast')
        caps = api.get(BASE + '/api/j2/inbox').json().get('captures') or []
        body = api.get(BASE + f'/api/j2/notes/{note4["id"]}').json()['note']
        embeds_in_locked = json.dumps(body.get('bodyJson')).count('widgetEmbed')
        expected = f'“CX walk Locked {RUN}” is locked — Screener results captured to your inbox until you unlock it'
        newest = caps[0] if caps else {}
        ok = (lk.status == 200 and msg == expected and len(caps) == inbox_before + 1
              and embeds_in_locked == 0 and any(c.get('widgetId') == 'screener' for c in caps))
        record('4_locked', 'PASS' if ok else 'FAIL', note_id=note4['id'], lock_status=lk.status,
               toast=msg, expected=expected, inbox_before=inbox_before, inbox_after=len(caps),
               inbox_widget_ids=[c.get('widgetId') for c in caps], embeds_in_locked_note=embeds_in_locked)
    except Exception as ex:  # noqa: BLE001
        shot(pg, '4z-locked-error')
        record('4_locked', 'INCONCLUSIVE', error=str(ex)[:400], tb=traceback.format_exc()[-1200:])

    record('5_page_errors', 'PASS' if not res['pageerrors'] else 'FAIL',
           pageerror_count=len(res['pageerrors']), pageerrors=res['pageerrors'][:20],
           console_error_count=len(res['console_errors']))
    br.close()

save()
v = {k: s['verdict'] for k, s in res['steps'].items()}
print(json.dumps(v, indent=1))
sys.exit(0 if all(x == 'PASS' for x in v.values()) else 1)
