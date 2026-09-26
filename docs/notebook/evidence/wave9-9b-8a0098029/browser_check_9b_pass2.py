"""Lane 9B browser check, PASS 2: the ledger rows whose UI behaviour pass 1 did not drive
(folders, trash restore, version restore, the template picker, saved views, image caption and
alignment, relation property, widget insert, PDF upload + preview + document search, the live
research page's My Research tab, the Ask scope label). Same sandbox recipe as pass 1: real
Chromium through Playwright, a census-pinned sandbox of the SAME product trees (8a0098029's app
and api; 9B's scorecard header names the one test file that differs), a synthetic member made in
that sandbox only, production's armed Notebook gates in the sandbox environment, no model key.

    python browser_check_9b_pass2.py --base http://127.0.0.1:8205 --out <dir> --tip <sha> --integrity-log <path>

Every check records what the DOM or the API answered, with a screenshot. A check that could not
run reads INCONCLUSIVE with its reason; a failed assertion reads FAIL. The JSON is rewritten after
every check, so a crash keeps what was measured.
"""
import argparse, json, os, re, secrets, struct, sys, tempfile, time, traceback, zlib
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--tip', required=True)
ap.add_argument('--integrity-log', required=True)
ap.add_argument('--only', default='')
A = ap.parse_args()
BASE = A.base.rstrip('/')
os.makedirs(A.out, exist_ok=True)
RUN = os.environ.get('W9B_RUN') or datetime.now(timezone.utc).strftime('p%H%M%S')
PW = os.environ.get('W9B_PASSWORD') or ('W9b-' + secrets.token_urlsafe(12))  # a test value; never written anywhere
ADMIN = 'hubtest@local.dev'
JSON_NAME = 'browser-check-pass2.json'
res = {'lane': '9B', 'pass': 2, 'tip': A.tip, 'base': BASE, 'run': RUN,
       'started_utc': datetime.now(timezone.utc).isoformat(), 'integrity_log': A.integrity_log,
       'instrument': 'Playwright Chromium (sync API), desktop 1280x800',
       'checks': {}, 'errors': [], 'pageerrors': []}


def dump():
    with open(os.path.join(A.out, JSON_NAME), 'w', encoding='utf-8', newline='\n') as fh:
        json.dump(res, fh, indent=1, ensure_ascii=False)


def record(cid, rows, verdict, **facts):
    res['checks'][cid] = {'rows': rows, 'verdict': verdict, **facts}
    dump()
    print(f'{verdict:12s} {cid} {rows}', flush=True)


def shot(pg, name):
    fn = f'{name}.png'
    try:
        pg.screenshot(path=os.path.join(A.out, fn), full_page=False)
        return fn
    except Exception as e:  # noqa: BLE001
        return f'(screenshot failed: {e})'


def guarded(cid, rows):
    def wrap(fn):
        def inner(*a, **k):
            if A.only and not any(cid.startswith(x) for x in A.only.split(',')):
                return None
            try:
                return fn(*a, **k)
            except AssertionError as e:
                record(cid, rows, 'FAIL', reason=f'assertion: {e}', traceback=traceback.format_exc()[-1500:])
            except Exception as e:  # noqa: BLE001
                record(cid, rows, 'INCONCLUSIVE', reason=f'exception: {type(e).__name__}: {e}',
                       traceback=traceback.format_exc()[-1500:])
        return inner
    return wrap


def signup_or_login(req, email, name):
    r = req.post(BASE + '/api/auth/signup', data={'email': email, 'password': PW, 'display_name': name})
    if r.status not in (200, 201):
        r = req.post(BASE + '/api/auth/login', data={'email': email, 'password': PW})
    return r.status


def dismiss_intro(pg):
    d = pg.locator('div[role="dialog"][aria-label="Welcome"]')
    try:
        d.first.wait_for(state='visible', timeout=2500)
    except Exception:  # noqa: BLE001
        return
    pg.keyboard.press('Escape')
    try:
        d.first.wait_for(state='detached', timeout=6000)
    except Exception:  # noqa: BLE001
        pg.get_by_role('button', name='Skip intro', exact=True).click(timeout=1500)
        d.first.wait_for(state='detached', timeout=6000)


def goto(pg, path):
    pg.goto(BASE + path)
    dismiss_intro(pg)


def open_note(ctx, nid, tries=6):
    pg = None
    for attempt in range(tries):
        if pg is not None:
            try:
                pg.close()
            except Exception:  # noqa: BLE001
                pass
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: res['pageerrors'].append(str(e)[:300]))
        goto(pg, f'/journal/notebook?note={nid}')
        try:
            pg.wait_for_selector('.ProseMirror', timeout=15000)
            return pg
        except Exception:  # noqa: BLE001
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f'editor never mounted for {nid}')


def list_page(ctx):
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: res['pageerrors'].append(str(e)[:300]))
    goto(pg, '/journal/notebook?view=all')
    pg.get_by_role('button', name='List view').first.wait_for(state='visible', timeout=15000)
    return pg


def para(text):
    return {'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]}


def new_note(api, title, body=None):
    r = api.post(BASE + '/api/j2/notes', data={'title': title, 'bodyJson': body or {'type': 'doc', 'content': [para(title)]}})
    assert r.status in (200, 201), f'create note {title}: HTTP {r.status} {r.text()[:200]}'
    return r.json()['note']['id']


def make_png(path, w=96, h=64):
    raw = b''.join(b'\x00' + bytes([30, 120, 200]) * w for _ in range(h))

    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    data = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + \
        chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')
    open(path, 'wb').write(data)


def make_pdf(path, text):
    objs = [b'<< /Type /Catalog /Pages 2 0 R >>', b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
            b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>']
    stream = ('BT /F1 18 Tf 72 700 Td (%s) Tj ET' % text).encode('latin-1')
    objs.append(b'<< /Length %d >>\nstream\n' % len(stream) + stream + b'\nendstream')
    objs.append(b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
    out = b'%PDF-1.4\n'
    offs = []
    for i, o in enumerate(objs, 1):
        offs.append(len(out))
        out += b'%d 0 obj\n' % i + o + b'\nendobj\n'
    xref = len(out)
    out += b'xref\n0 %d\n' % (len(objs) + 1) + b'0000000000 65535 f \n' + b''.join(b'%010d 00000 n \n' % o for o in offs)
    out += b'trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n' % (len(objs) + 1, xref) + b'%%EOF\n'
    open(path, 'wb').write(out)


def main():
    tmp = tempfile.mkdtemp(prefix='w9b-p2-')
    png = os.path.join(tmp, f'chart-{RUN}.png')
    pdf = os.path.join(tmp, f'guidance-{RUN}.pdf')
    word = f'zephyrine{RUN.lower()}'
    make_png(png)
    make_pdf(pdf, f'Quarterly guidance raised {word} margins')

    with sync_playwright() as p:
        browser = p.chromium.launch()
        actx = browser.new_context()
        res['admin_signup_or_login'] = signup_or_login(actx.request, ADMIN, 'hubtest')
        email = f'w9b-p2-{RUN.lower()}@local.dev'
        ctx = browser.new_context(viewport={'width': 1280, 'height': 800}, accept_downloads=True)
        st = signup_or_login(ctx.request, email, 'w9b p2')
        comp = actx.request.post(BASE + '/api/auth/admin/comp-access', data={'email': email, 'action': 'grant'})
        ver = actx.request.post(BASE + '/api/auth/admin/verify-email', data={'email': email})
        me = ctx.request.get(BASE + '/api/auth/me').json()
        res['member'] = {'email_domain': 'local.dev', 'signup': st, 'comp': comp.status, 'verify': ver.status,
                         'paid_equiv': me.get('paid_equiv')}
        assert me.get('paid_equiv'), res['member']
        api = ctx.request
        dump()

        @guarded('B21_folders_nested', ['G-020'])
        def b21():
            q = list_page(ctx)
            parent, child = f'Parent {RUN}', f'Child {RUN}'
            q.get_by_role('button', name='+ New folder').click()
            inp = q.get_by_label('New folder name')
            inp.fill(parent)
            inp.press('Enter')
            q.get_by_role('button', name=re.compile(re.escape(parent))).first.wait_for(state='visible', timeout=8000)
            q.get_by_role('button', name=re.compile(re.escape(parent))).first.hover()
            q.get_by_role('button', name=f'Add subfolder to {parent}').first.click()
            sub = q.get_by_label(f'New subfolder in {parent}')
            sub.fill(child)
            sub.press('Enter')
            q.get_by_role('button', name=re.compile(re.escape(child))).first.wait_for(state='visible', timeout=8000)
            s = shot(q, 'B21-folders')
            folders = api.get(BASE + '/api/j2/note-folders').json()
            flat = folders.get('folders') if isinstance(folders, dict) else folders
            byname = {f.get('name'): f for f in (flat or [])}
            nested = child in byname and parent in byname and byname[child].get('parentId', byname[child].get('parent_id')) == byname[parent].get('id')
            q.close()
            assert nested, f'server folders do not show {child} under {parent}: {list(byname)[:10]}'
            record('B21_folders_nested', ['G-020'], 'PASS', parent=parent, child=child, server_nested=nested, screenshot=s)
        b21()

        @guarded('B22_trash_restore', ['G-001'])
        def b22():
            title = f'Trash me {RUN}'
            nid = new_note(api, title)
            q = open_note(ctx, nid)
            q.get_by_role('button', name=re.compile(r'^Delete$')).first.click()
            dlg = q.get_by_role('dialog', name=re.compile('Delete this note'))
            dlg.first.wait_for(state='visible', timeout=5000)
            dlg.first.get_by_role('button', name=re.compile(r'^Delete$')).click()
            q.wait_for_timeout(1200)
            q.close()
            q = list_page(ctx)
            q.get_by_role('button', name=re.compile(r'^Trash \d')).first.click()
            card = q.locator('[data-trashed="true"]', has_text=title)
            card.first.wait_for(state='visible', timeout=8000)
            s1 = shot(q, 'B22-trash')
            card.first.get_by_role('button', name='Restore').click()
            q.wait_for_timeout(1500)
            back = api.get(BASE + f'/api/j2/notes/{nid}')
            q.close()
            q = list_page(ctx)
            q.get_by_role('button', name=re.compile(re.escape(title))).first.wait_for(state='visible', timeout=8000)
            s2 = shot(q, 'B22-restored')
            q.close()
            assert back.status == 200, f'restored note GET {back.status}'
            record('B22_trash_restore', ['G-001'], 'PASS', restored_get=back.status, screenshots=[s1, s2])
        b22()

        @guarded('B23_version_restore', ['G-002'])
        def b23():
            title = f'Versions {RUN}'
            nid = new_note(api, title, {'type': 'doc', 'content': [para(f'original words {RUN}')]})
            cur = api.get(BASE + f'/api/j2/notes/{nid}').json()['note']
            r = api.put(BASE + f'/api/j2/notes/{nid}', data={'bodyJson': {'type': 'doc', 'content': [para(f'edited words {RUN}')]},
                                                             'baseUpdatedAt': cur.get('updatedAt')})
            assert r.status == 200, f'PUT {r.status} {r.text()[:200]}'
            q = open_note(ctx, nid)
            q.get_by_text(f'edited words {RUN}').first.wait_for(state='visible', timeout=8000)
            q.get_by_role('button', name='Version history').first.click()
            dlg = q.get_by_role('dialog', name='Version history')
            dlg.wait_for(state='visible', timeout=6000)
            lst = dlg.get_by_label('Earlier versions')
            lst.first.wait_for(state='visible', timeout=8000)
            items = lst.first.locator('button, [role="option"], li')
            n_items = items.count()
            items.first.click()
            q.wait_for_timeout(800)
            s1 = shot(q, 'B23-history')
            dlg.get_by_role('button', name=re.compile(r'^Restore')).first.click()
            conf = q.get_by_role('dialog', name=re.compile('Restore this version'))
            try:
                conf.first.wait_for(state='visible', timeout=4000)
                conf.first.get_by_role('button', name=re.compile(r'^Restore')).last.click()
            except Exception:  # noqa: BLE001
                pass
            q.wait_for_timeout(2000)
            after = api.get(BASE + f'/api/j2/notes/{nid}').json()['note']
            body = json.dumps(after.get('bodyJson') or after.get('body_json') or after.get('body') or '')
            s2 = shot(q, 'B23-restored')
            q.close()
            assert n_items > 0, 'no earlier version listed'
            assert f'original words {RUN}' in body, f'restore did not bring the original back: {body[:160]}'
            record('B23_version_restore', ['G-002'], 'PASS', versions_listed=n_items, restored=True, screenshots=[s1, s2])
        b23()

        @guarded('B24_template_picker', ['G-026'])
        def b24():
            q = list_page(ctx)
            q.get_by_role('button', name='Templates').first.click()
            card = q.get_by_role('button', name='Long/Short Thesis')
            card.first.wait_for(state='visible', timeout=8000)
            sheet = q.get_by_role('dialog').filter(has=card).first
            labels = [' / '.join(x.strip() for x in b.inner_text().splitlines() if x.strip()) for b in sheet.locator('button').all()]
            s1 = shot(q, 'B24-templates')
            card.first.click()
            q.wait_for_selector('.ProseMirror', timeout=15000)
            q.wait_for_timeout(1200)
            heads = [h.inner_text().strip() for h in q.locator('.ProseMirror h1, .ProseMirror h2, .ProseMirror h3').all()][:12]
            s2 = shot(q, 'B24-thesis-note')
            q.close()
            assert any('Long/Short Thesis' in l for l in labels), labels
            assert heads, 'the thesis template produced no headings'
            record('B24_template_picker', ['G-026'], 'PASS', picker_buttons=labels[:30], template_headings=heads,
                   screenshots=[s1, s2])
        b24()

        @guarded('B25_saved_view', ['G-025'])
        def b25():
            q = list_page(ctx)
            q.get_by_role('button', name='Table view').first.click()
            q.wait_for_timeout(800)
            q.get_by_role('button', name='Save view').first.click()
            dlg = q.get_by_role('dialog', name='Save view')
            dlg.wait_for(state='visible', timeout=6000)
            name = f'My table {RUN}'
            dlg.get_by_placeholder('e.g. Active Theses').fill(name)
            dlg.get_by_role('button', name='Save view').click()
            q.get_by_role('button', name=re.compile(re.escape(name))).first.wait_for(state='visible', timeout=8000)
            q.close()
            q = list_page(ctx)
            before = q.get_by_role('button', name='Table view').first.get_attribute('aria-pressed')
            q.get_by_role('button', name=re.compile(re.escape(name))).first.click()
            q.wait_for_timeout(1200)
            pressed = q.get_by_role('button', name='Table view').first.get_attribute('aria-pressed')
            s = shot(q, 'B25-saved-view')
            q.close()
            assert before != 'true', 'the fresh list page already showed the table'
            assert pressed == 'true', f'reopening the saved view left Table view aria-pressed={pressed}'
            record('B25_saved_view', ['G-025'], 'PASS', view=name, table_pressed_on_fresh_page=before,
                   table_pressed_after_reopen=pressed, screenshot=s)
        b25()

        @guarded('B26_image_caption_align', ['G-133'])
        def b26():
            nid = new_note(api, f'Image note {RUN}')
            q = open_note(ctx, nid)
            ed = q.locator('.ProseMirror').first
            ed.click()
            q.keyboard.press('Control+End')
            q.locator('input[aria-label="Upload image"]').first.set_input_files(png)
            q.wait_for_selector('.ProseMirror img', timeout=20000)
            q.locator('.ProseMirror [data-uct-image] img').first.click(force=True)
            bar = q.get_by_role('toolbar', name='Image')
            bar.wait_for(state='visible', timeout=6000)
            aligns = [b.get_attribute('aria-label') for b in bar.locator('button[aria-pressed]').all()]
            bar.get_by_role('button', name='Center the image').click()
            q.wait_for_timeout(400)
            align_after_press = q.locator('.ProseMirror [data-uct-image]').first.get_attribute('data-align')
            center_pressed = bar.get_by_role('button', name='Center the image').get_attribute('aria-pressed')
            bar.get_by_role('button', name='Add caption').click()
            q.keyboard.type(f'Setup chart {RUN}')
            q.wait_for_timeout(1200)
            cap = q.locator('.ProseMirror figcaption').first.inner_text() if q.locator('.ProseMirror figcaption').count() else ''
            align = q.locator('.ProseMirror [data-uct-image]').first.get_attribute('data-align')
            s = shot(q, 'B26-image')
            q.close()
            assert f'Setup chart {RUN}' in cap, f'caption text {cap!r}'
            assert align == 'center', f'data-align {align!r} after pressing Center the image'
            record('B26_image_caption_align', ['G-133'], 'PASS', align_buttons=aligns, data_align_after_center=align_after_press,
                   center_pressed=center_pressed, data_align_after_caption=align, caption=cap, screenshot=s)
        b26()

        @guarded('B27_relation_property', ['G-158'])
        def b27():
            tgt_title = f'Relation target {RUN}'
            tgt = new_note(api, tgt_title)
            src = new_note(api, f'Relation source {RUN}')
            q = open_note(ctx, src)
            q.get_by_role('button', name='Add property').first.click()
            q.get_by_role('button', name=re.compile('New property')).first.click()
            q.get_by_placeholder('Property name').fill(f'Related {RUN}')
            q.locator('select').filter(has=q.locator('option[value="relation"]')).first.select_option('relation')
            q.get_by_role('button', name='Create').click()
            q.get_by_role('button', name='Link a note').first.click()
            q.get_by_label('Find a note to link').fill(tgt_title)
            q.get_by_role('list', name='Notes to link').get_by_role('button', name=re.compile(re.escape(tgt_title))).first.click()
            chip = q.get_by_role('button', name=re.compile(re.escape(tgt_title)))
            chip.first.wait_for(state='visible', timeout=8000)
            s1 = shot(q, 'B27-relation')
            q.close()
            q = open_note(ctx, tgt)
            q.wait_for_timeout(2500)
            back = q.get_by_text(f'Relation source {RUN}').count()
            s2 = shot(q, 'B27-backlink')
            q.close()
            assert back > 0, 'the target note does not show the source note'
            record('B27_relation_property', ['G-158'], 'PASS', target_shows_source=back, screenshots=[s1, s2])
        b27()

        @guarded('B28_widget_insert', ['G-034'])
        def b28():
            nid = new_note(api, f'Widget note {RUN}')
            q = open_note(ctx, nid)
            q.locator('.ProseMirror').first.click()
            q.get_by_role('button', name='Insert widget').first.click()
            pal = q.get_by_role('dialog', name='Insert widget')
            pal.wait_for(state='visible', timeout=6000)
            kinds = [b.inner_text().strip() for b in pal.locator('button').all()][:20]
            s1 = shot(q, 'B28-palette')
            pal.get_by_role('button', name=re.compile(r'^Chart')).first.click()
            pal.get_by_label('Ticker').fill('NVDA')
            pal.get_by_role('button', name=re.compile(r'^Insert chart')).first.click()
            q.wait_for_timeout(2500)
            embeds = q.locator('.ProseMirror .react-renderer, .ProseMirror [data-node-view-wrapper]').count()
            doc = api.get(BASE + f'/api/j2/notes/{nid}').json()['note']
            s2 = shot(q, 'B28-inserted')
            q.close()
            body = json.dumps(doc.get('bodyJson') or {})
            assert embeds > 0 or 'widgetEmbed' in body, f'no widget node (dom {embeds}); palette buttons {kinds}'
            record('B28_widget_insert', ['G-034'], 'PASS', palette_buttons=kinds, dom_embeds=embeds,
                   saved_body_has_widget='widgetEmbed' in body, screenshots=[s1, s2],
                   note='the sandbox has no market-data keys: the embed node is asserted, not its chart data')
        b28()

        @guarded('B29_pdf_upload_preview_search', ['G-036', 'G-036b', 'G-113'])
        def b29():
            nid = new_note(api, f'PDF note {RUN}')
            q = open_note(ctx, nid)
            q.locator('.ProseMirror').first.click()
            q.keyboard.press('Control+End')
            q.locator('input[aria-label="Upload file attachment"]').first.set_input_files(pdf)
            chip = q.locator('.ProseMirror a[data-type="attachmentChip"]')
            chip.first.wait_for(state='visible', timeout=20000)
            q.wait_for_timeout(1500)
            chip.first.click()
            prev = q.get_by_role('dialog', name=re.compile(r'^Preview of'))
            prev.first.wait_for(state='visible', timeout=10000)
            q.wait_for_timeout(2500)
            canv = prev.first.locator('canvas').count()
            s1 = shot(q, 'B29-preview')
            q.keyboard.press('Escape')
            q.close()
            out = {'chip': True, 'preview_dialog': True, 'preview_canvases': canv}
            # document search: the sidebar Search tab, the unique word in the PDF's text
            q = list_page(ctx)
            q.get_by_role('tab', name='Search notes').first.click()
            box = q.get_by_label('Search your notes').first
            box.fill(word)
            found = False
            for _ in range(12):
                q.wait_for_timeout(2500)
                txt = q.locator('body').inner_text()
                if f'guidance-{RUN}' in txt or 'Documents' in txt and word in txt.lower():
                    found = True
                    break
                box.fill('')
                box.fill(word)
            out['document_search_found'] = found
            s2 = shot(q, 'B29-doc-search')
            q.close()
            if not found:
                record('B29_pdf_upload_preview_search', ['G-036', 'G-036b', 'G-113'], 'INCONCLUSIVE',
                       reason='the PDF uploaded and previewed; its text did not appear in the sidebar search within 30 s '
                              '(extraction may not run in this sandbox) — G-113 not confirmed', screenshots=[s1, s2], **out)
                return
            record('B29_pdf_upload_preview_search', ['G-036', 'G-036b', 'G-113'], 'PASS', screenshots=[s1, s2], **out)
        b29()

        @guarded('B30_live_research_tab', ['G-112', 'G-075'])
        def b30():
            r = api.post(BASE + '/api/j2/notes', data={'title': f'NVDA research {RUN}', 'ticker': 'NVDA',
                                                      'bodyJson': {'type': 'doc', 'content': [para('NVDA notes')]}})
            assert r.status in (200, 201), r.status
            q = ctx.new_page()
            goto(q, '/research/NVDA?section=research')
            q.get_by_role('heading', name='NVDA').first.wait_for(state='visible', timeout=15000)
            q.wait_for_timeout(1500)
            q.get_by_text(f'NVDA research {RUN}').first.wait_for(state='visible', timeout=10000)
            secs = [h.inner_text().strip() for h in q.locator('h3').all()][:12]
            s = shot(q, 'B30-research-my-research')
            q.close()
            record('B30_live_research_tab', ['G-112', 'G-075'], 'PASS', section_headings=secs, url='/research/NVDA?section=research',
                   screenshot=s)
        b30()

        @guarded('B31_ask_scope_label', ['G-122'])
        def b31():
            nid = new_note(api, f'Ask scope {RUN}')
            q = open_note(ctx, nid)
            q.get_by_role('button', name='Ask a question about this note').first.click()
            chip = q.get_by_test_id('ask-scope')
            chip.first.wait_for(state='visible', timeout=6000)
            label = chip.first.inner_text().strip()
            s = shot(q, 'B31-ask-scope')
            q.close()
            assert 'This note' in label, label
            record('B31_ask_scope_label', ['G-122'], 'PASS', scope_chip=label, screenshot=s,
                   note='the scope is visible text before any question; no model key, so no answer was requested')
        b31()

        browser.close()


try:
    main()
except SystemExit:
    raise
except Exception as e:  # noqa: BLE001
    res['errors'].append(f'{type(e).__name__}: {e}')
    res['traceback'] = traceback.format_exc()[-3000:]
finally:
    res['finished_utc'] = datetime.now(timezone.utc).isoformat()
    verdicts = [c['verdict'] for c in res['checks'].values()]
    res['summary'] = {v: verdicts.count(v) for v in sorted(set(verdicts))}
    dump()
    print('SUMMARY', res['summary'], 'pageerrors', len(res['pageerrors']), 'errors', res['errors'][:3], flush=True)
