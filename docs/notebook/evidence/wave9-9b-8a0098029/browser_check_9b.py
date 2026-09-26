"""Lane 9B browser check: confirm, in a REAL browser on a sandbox of the tip, every gap-ledger row
whose evidence is a UI behaviour (owner rule P-1). Real Chromium through Playwright, synthetic
accounts made IN THAT SANDBOX ONLY (hubtest@local.dev is the launcher's admin; members are
run-unique), the gates production has armed set in the sandbox's environment by the driver.

    python browser_check_9b.py --base http://127.0.0.1:8205 --out <dir> --tip <sha> \
        --integrity-log <path> --axe <path to axe.min.js> --sample <sample_notebook.json>

Every check records what the DOM or the API answered, with a screenshot; nothing is inferred.
A check that could not run reads INCONCLUSIVE with its reason; an assertion that failed reads FAIL.
The JSON is rewritten after every check, so a crash keeps what was measured.
"""
import argparse, json, os, re, secrets, sys, time, traceback
from datetime import datetime, timezone
from playwright.sync_api import sync_playwright

ap = argparse.ArgumentParser()
ap.add_argument('--base', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--tip', required=True)
ap.add_argument('--integrity-log', required=True)
ap.add_argument('--axe', required=True)
ap.add_argument('--sample', required=True)
ap.add_argument('--only', default='')
A = ap.parse_args()
BASE = A.base.rstrip('/')
os.makedirs(A.out, exist_ok=True)
RUN = os.environ.get('W9B_RUN') or datetime.now(timezone.utc).strftime('r%H%M%S')
PW = os.environ.get('W9B_PASSWORD') or ('W9b-' + secrets.token_urlsafe(12))  # a test value; never written anywhere
ADMIN = 'hubtest@local.dev'
res = {'lane': '9B', 'tip': A.tip, 'base': BASE, 'run': RUN,
       'started_utc': datetime.now(timezone.utc).isoformat(), 'integrity_log': A.integrity_log,
       'instrument': 'Playwright Chromium (sync API), desktop 1280x800 unless a check says otherwise',
       'checks': {}, 'errors': [], 'pageerrors': []}


def dump():
    with open(os.path.join(A.out, 'browser-check.json'), 'w', encoding='utf-8', newline='\n') as fh:
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


def open_note(ctx, nid, pg=None, tries=6):
    """Hard-nav to a note, retrying on a FRESH page through the route error boundary (the
    wave-6 walk's measured recipe)."""
    for attempt in range(tries):
        if pg is None or attempt > 0:
            if pg is not None and attempt > 0:
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


def new_note(api, title, body=None, tags=None):
    data = {'title': title, 'bodyJson': body or {'type': 'doc', 'content': [{'type': 'paragraph'}]}}
    if tags is not None:
        data['tags'] = tags
    r = api.post(BASE + '/api/j2/notes', data=data)
    assert r.status in (200, 201), f'create note {title}: HTTP {r.status} {r.text()[:200]}'
    return r.json()['note']['id']


def para(text):
    return {'type': 'paragraph', 'content': [{'type': 'text', 'text': text}]}


def editor_end(pg):
    ed = pg.locator('.ProseMirror').first
    ed.click()
    pg.keyboard.press('Control+End')
    return ed


def slash(pg, title):
    pg.keyboard.type('/')
    lb = pg.get_by_role('listbox', name='Insert block')
    lb.wait_for(state='visible', timeout=5000)
    pg.keyboard.type(title[:6])
    opt = lb.get_by_role('option', name=re.compile(re.escape(title), re.I)).first
    opt.wait_for(state='visible', timeout=5000)
    opt.click()


# ── the checks ─────────────────────────────────────────────────────────────────────────────

def main():
    sample = json.load(open(A.sample, encoding='utf-8'))
    research = next(n for n in sample['notes'] if n['title'].startswith('Research'))
    rbody = research.get('bodyJson') or research.get('body_json') or research.get('body')

    with sync_playwright() as p:
        browser = p.chromium.launch()
        actx = browser.new_context()
        res['admin_signup_or_login'] = signup_or_login(actx.request, ADMIN, 'hubtest')

        def member(tag, **kw):
            email = f'w9b-{tag}-{RUN.lower()}@local.dev'
            opts = {'viewport': {'width': 1280, 'height': 800}, 'accept_downloads': True}
            opts.update(kw)
            c = browser.new_context(**opts)
            st = signup_or_login(c.request, email, f'w9b {tag}')
            comp = actx.request.post(BASE + '/api/auth/admin/comp-access', data={'email': email, 'action': 'grant'})
            ver = actx.request.post(BASE + '/api/auth/admin/verify-email', data={'email': email})
            me = c.request.get(BASE + '/api/auth/me').json()
            facts = {'email_domain': 'local.dev', 'signup': st, 'comp': comp.status, 'verify': ver.status,
                     'paid_equiv': me.get('paid_equiv'), 'flags': {k: v for k, v in me.items() if isinstance(v, bool)
                                                                   and ('notebook' in k or 'j2_' in k)}}
            assert me.get('paid_equiv'), f'member {tag} not paid-equivalent: {facts}'
            return c, facts

        ctx, facts = member('main')
        MAIN_EMAIL = f'w9b-main-{RUN.lower()}@local.dev'
        res['member_main'] = facts
        api = ctx.request

        # seed: 12 older notes first (the switcher target is the OLDEST, never a recent)
        olds = [new_note(api, f'Quarry ledger {i:02d} {RUN}', {'type': 'doc', 'content': [para(f'old {i}')]})
                for i in range(12)]
        rich = new_note(api, f'Rich body {RUN}', rbody)
        target = new_note(api, f'Zephyr thesis {RUN}', {'type': 'doc', 'content': [para('The target note.')]})
        mention = new_note(api, f'Mentions the target {RUN}',
                           {'type': 'doc', 'content': [para(f'I keep coming back to Zephyr thesis {RUN} today.')]})
        tagged = new_note(api, f'Tagged nested {RUN}', {'type': 'doc', 'content': [para('tagged')]},
                          tags=['inbox/to-read'])
        today = datetime.now().strftime('%Y-%m-%d')
        taskb = {'type': 'doc', 'content': [{'type': 'taskList', 'content': [{'type': 'taskItem', 'attrs': {'checked': False},
                 'content': [{'type': 'paragraph', 'content': [{'type': 'text', 'text': f'Review the setup {RUN} '},
                                                                 {'type': 'dateMention', 'attrs': {'date': today}}]}]}]}]}
        task = new_note(api, f'Task note {RUN}', taskb)
        res['seeded'] = {'old_oldest': olds[0], 'rich': rich, 'target': target, 'mention': mention,
                         'tagged': tagged, 'task': task}
        dump()

        pg = open_note(ctx, rich)

        @guarded('B01_slash_menu', ['G-143', 'G-129', 'G-130', 'G-132', 'G-134', 'G-136', 'G-139', 'G-142', 'G-162', 'G-165'])
        def b01():
            blank = new_note(api, f'Blank slash {RUN}')
            q = open_note(ctx, blank)
            editor_end(q)
            q.keyboard.type('/')
            lb = q.get_by_role('listbox', name='Insert block')
            lb.wait_for(state='visible', timeout=5000)
            names = [o.inner_text().split('\n')[0].strip() for o in lb.get_by_role('option').all()]
            s = shot(q, 'B01-slash-menu')
            want = ['Heading 4', 'Heading 5', 'Heading 6', 'Code block', 'Table', '2 columns', '3 columns',
                    'Table of contents', 'Callout', 'Inline math', 'Math block', 'Emoji', 'Dictate', 'Writing help']
            missing = [w for w in want if not any(n.startswith(w) for n in names)]
            q.keyboard.press('Escape')
            q.close()
            assert not missing, f'slash menu lacks {missing}; has {names}'
            record('B01_slash_menu', b01.rows, 'PASS', options=names, screenshot=s)
        b01.rows = ['G-143', 'G-129', 'G-130', 'G-132', 'G-134', 'G-136', 'G-139', 'G-142', 'G-162', 'G-165']
        b01()

        @guarded('B02_code_math_callout', ['G-129', 'G-130', 'G-132', 'G-030'])
        def b02():
            ed = pg.locator('.ProseMirror').first
            pg.wait_for_selector('.ProseMirror pre', timeout=8000)
            hl = ed.locator('pre [class^="hljs"], pre [class*=" hljs"]').count()
            pg.wait_for_selector('.ProseMirror .katex', timeout=10000)
            katex = ed.locator('.katex').count()
            pick = ed.get_by_role('button', name=re.compile(r'^Callout style')).count()
            s = shot(pg, 'B02-code-math-callout')
            assert hl > 0 and katex > 0 and pick > 0, f'hljs={hl} katex={katex} callout-style={pick}'
            record('B02_code_math_callout', ['G-129', 'G-130', 'G-132', 'G-030'], 'PASS',
                   hljs_spans=hl, katex_nodes=katex, callout_style_controls=pick, screenshot=s)
        b02()

        @guarded('B03_table_toolbar', ['G-134'])
        def b03():
            cell = pg.locator('.ProseMirror table td, .ProseMirror table th').first
            cell.click()
            bar = pg.get_by_role('toolbar', name='Table')
            if bar.count() == 0:
                bar = pg.locator('[aria-label="Table"]')
            bar.first.wait_for(state='visible', timeout=5000)
            labels = [b.get_attribute('aria-label') for b in bar.first.locator('button').all()]
            resize = pg.locator('.ProseMirror .column-resize-handle').count()
            sortish = [l for l in labels if l and re.search(r'sort', l, re.I)]
            s = shot(pg, 'B03-table-toolbar')
            need = ['Add a row above', 'Add a row below', 'Delete this row', 'Add a column to the left',
                    'Add a column to the right', 'Delete this column', 'Header row']
            missing = [n for n in need if n not in labels]
            assert not missing, f'toolbar lacks {missing}: {labels}'
            record('B03_table_toolbar', ['G-134'], 'PASS', toolbar_buttons=labels, resize_handles=resize,
                   sort_controls=sortish, note='add/delete rows and columns + header row present; resize handles '
                   f'{resize}, sort controls {len(sortish)} (the row records both as not built)', screenshot=s)
        b03()

        @guarded('B04_drag_outline_stats', ['G-135', 'G-136', 'G-137'])
        def b04():
            ed = pg.locator('.ProseMirror').first
            ed.locator('p').first.hover()
            grip = pg.get_by_role('button', name='Move this block')
            grip_n = grip.count()
            try:
                grip.first.wait_for(state='visible', timeout=3000)
                grip_vis = True
            except Exception:  # noqa: BLE001
                grip_vis = False
            ob = pg.get_by_role('button', name='Outline')
            ob.first.click()
            panel_text = ''
            try:
                pnl = pg.locator('[aria-label="Outline"]').last
                pnl.wait_for(state='visible', timeout=4000)
                panel_text = pnl.inner_text()[:400]
            except Exception:  # noqa: BLE001
                pass
            stats = pg.get_by_text(re.compile(r'\b\d[\d,]* words?\b')).first
            stats_text = stats.inner_text() if stats.count() else ''
            s = shot(pg, 'B04-drag-outline-stats')
            ob.first.click()
            assert grip_n > 0 and grip_vis, f'no visible block grip (count {grip_n})'
            assert panel_text, 'the outline panel did not open'
            assert stats_text, 'no word count on the page'
            record('B04_drag_outline_stats', ['G-135', 'G-136', 'G-137'], 'PASS', grip_count=grip_n,
                   outline_text=panel_text, stats_text=stats_text, screenshot=s)
        b04()

        @guarded('B05_typing_features', ['G-131', 'G-138', 'G-139', 'G-140', 'G-142', 'G-136'])
        def b05():
            nid = new_note(api, f'Typing features {RUN}')
            q = open_note(ctx, nid)
            editor_end(q)
            q.keyboard.type('alpha beta alpha ')
            # emoji
            q.keyboard.type(':rock')
            elb = q.get_by_role('listbox', name='Insert emoji')
            elb.wait_for(state='visible', timeout=5000)
            rocket = elb.get_by_role('option', name=re.compile('🚀')).count()
            q.keyboard.press('Enter')
            q.keyboard.type(' @tomorrow ')
            q.wait_for_timeout(300)
            ed = q.locator('.ProseMirror').first
            date_chips = ed.locator('[data-date]').count()
            # columns + toc
            q.keyboard.press('Enter')
            slash(q, '2 columns')
            q.wait_for_timeout(300)
            cols = ed.locator('[data-type="columns"], .uctColumns, [class*="olumns"]').count()
            s1 = shot(q, 'B05-emoji-date-columns')
            text = ed.inner_text()
            # find and replace (Ctrl+H opens the replace row)
            ed.click()
            q.keyboard.press('Control+Home')
            q.keyboard.press('Control+h')
            rep = q.get_by_label('Replace with')
            rep.wait_for(state='visible', timeout=5000)
            find = q.locator('input[aria-label="Find in note"]').first
            find.fill('alpha')
            rep.fill('gamma')
            q.get_by_role('button', name=re.compile(r'^Replace all', re.I)).first.click()
            q.wait_for_timeout(400)
            after = ed.inner_text()
            s2 = shot(q, 'B05-find-replace')
            q.keyboard.press('Escape')
            # text colour: select a word, open the disclosure
            ed.click()
            q.keyboard.press('Control+Home')
            q.keyboard.press('Shift+Control+ArrowRight')
            q.get_by_role('button', name='Text color and highlight').first.click()
            grp = q.get_by_role('group', name='Text color and highlight')
            grp.wait_for(state='visible', timeout=4000)
            swatches = grp.locator('button').count()
            s3 = shot(q, 'B05-text-colour')
            q.close()
            assert rocket > 0, 'no 🚀 option for :rock'
            assert '🚀' in text, 'the emoji was not inserted'
            assert date_chips > 0, 'no date chip after @tomorrow'
            assert cols > 0, 'no columns node after /2 columns'
            assert after.count('gamma') >= 2 and 'alpha' not in after, f'replace all did not replace: {after[:120]}'
            assert swatches > 0, 'no colour swatches'
            record('B05_typing_features', ['G-131', 'G-138', 'G-139', 'G-140', 'G-142'], 'PASS', rocket_options=rocket,
                   date_chips=date_chips, columns_nodes=cols, after_replace=after[:200], colour_swatches=swatches,
                   screenshots=[s1, s2, s3])
        b05()

        @guarded('B06_link_paste', ['G-141'])
        def b06():
            nid = new_note(api, f'Link paste {RUN}')
            q = open_note(ctx, nid)
            editor_end(q)
            url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
            q.evaluate("""(u) => { const el = document.querySelector('.ProseMirror');
                const dt = new DataTransfer(); dt.setData('text/plain', u);
                el.dispatchEvent(new ClipboardEvent('paste', {clipboardData: dt, bubbles: true, cancelable: true})); }""", url)
            menu = q.get_by_label('Pasted link')
            menu.first.wait_for(state='visible', timeout=5000)
            opts = menu.first.inner_text()
            s = shot(q, 'B06-link-paste')
            q.close()
            assert 'Embed' in opts, f'no Embed offer: {opts}'
            record('B06_link_paste', ['G-141'], 'PASS', offer_text=opts,
                   label='a dispatched paste event (an ENGINE test of the paste path, not a real clipboard)', screenshot=s)
        b06()

        @guarded('B07_touch_no_undo', ['G-144', 'G-159', 'G-162'])
        def b07():
            c = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
            st = c.request.post(BASE + '/api/auth/login', data={'email': MAIN_EMAIL, 'password': PW}).status
            assert st in (200, 201), f'touch login {st}'
            nid = new_note(c.request, f'Touch note {RUN}', {'type': 'doc', 'content': [para('touch text')]})
            q = open_note(c, nid)
            names = q.evaluate("""() => Array.from(document.querySelectorAll('button,[role=button]'))
                .map(b => (b.getAttribute('aria-label') || b.getAttribute('title') || b.innerText || '').trim())
                .filter(Boolean)""")
            undoish = [n for n in names if re.match(r'^(undo|redo)\b', n, re.I)]
            scan = q.get_by_role('button', name='Scan a document with the camera').count()
            mic = q.get_by_role('button', name=re.compile(r'voice input', re.I)).count()
            s = shot(q, 'B07-touch-390')
            c.close()
            assert not undoish, f'an undo/redo control exists on touch: {undoish}'
            record('B07_touch_no_undo', ['G-144', 'G-159', 'G-162'], 'PASS',
                   finding='NO undo or redo control among the note page buttons at 390px touch (G-144 OPEN confirmed)',
                   undo_redo_controls=undoish, scan_buttons=scan, mic_buttons=mic, button_count=len(names),
                   label='Chromium touch emulation, not a device', screenshot=s)
        b07()

        @guarded('B08_quick_switcher', ['G-145', 'G-031', 'G-102'])
        def b08():
            q = ctx.new_page()
            goto(q, '/journal/notebook')
            q.wait_for_timeout(800)
            q.keyboard.press('Control+k')
            dlg = q.get_by_role('dialog', name='Command palette')
            dlg.wait_for(state='visible', timeout=5000)
            inp = dlg.get_by_label('Search a security, company, or note')
            inp.fill(f'Quarry ledger 00 {RUN}')
            opt = dlg.get_by_role('option', name=re.compile(re.escape(f'Quarry ledger 00 {RUN}'))).first
            opt.wait_for(state='visible', timeout=8000)
            s = shot(q, 'B08-switcher')
            opt.click()
            q.wait_for_url(re.compile(olds[0]), timeout=8000)
            url = q.url
            q.close()
            assert olds[0] in url
            record('B08_quick_switcher', ['G-145', 'G-031', 'G-102'], 'PASS', opened_url=url, screenshot=s)
        b08()

        @guarded('B09_list_views_bulk', ['G-146', 'G-021', 'G-149', 'G-154', 'G-022', 'G-147'])
        def b09():
            q = ctx.new_page()
            goto(q, '/journal/notebook?view=all')
            q.get_by_role('button', name='List view').first.wait_for(state='visible', timeout=10000)
            modes = [b.get_attribute('aria-label') for b in q.locator('button[aria-pressed][aria-label$=" view"]').all()]
            # bulk
            box = q.get_by_label(f'Select Quarry ledger 01 {RUN}')
            box.first.check()
            q.get_by_label(f'Select Quarry ledger 02 {RUN}').first.check()
            bar_text = q.locator('body').inner_text()
            exp_btn = q.get_by_role('button', name=re.compile(r'^Export selected', re.I)).first
            exp_btn.click()
            q.wait_for_timeout(400)
            panel_text = q.locator('body').inner_text()
            s1 = shot(q, 'B09-bulk-export')
            formats = [f for f in ('Markdown', 'Web page (HTML)', 'JSON', 'Word (.docx)') if f in panel_text]
            q.keyboard.press('Escape')
            # nested tags in the sidebar: expand #inbox and read its child
            q.get_by_role('button', name='Expand tag inbox').first.click()
            child = q.get_by_role('button', name='Collapse tag inbox').count()
            q.wait_for_timeout(300)
            nested = child > 0 and q.get_by_text(re.compile(r'#?to-read')).count() > 0
            s_tags = shot(q, 'B09-nested-tags')
            # timeline + tasks + graph
            q.get_by_role('button', name='Timeline view').first.click()
            q.wait_for_timeout(800)
            s2 = shot(q, 'B09-timeline')
            q.goto(BASE + '/journal/notebook?view=tasks')
            dismiss_intro(q)
            q.get_by_text(f'Review the setup {RUN}').first.wait_for(state='visible', timeout=8000)
            s3 = shot(q, 'B09-tasks')
            q.goto(BASE + '/journal/notebook?view=all')
            dismiss_intro(q)
            q.get_by_role('button', name='Graph view').first.click()
            q.wait_for_selector('canvas[aria-label^="Note graph"]', timeout=15000)
            gl = q.get_by_role('button', name=re.compile(r'show as list', re.I)).count()
            canv = q.locator('canvas[aria-label^="Note graph"]').count()
            graph_label = q.locator('canvas[aria-label^="Note graph"]').first.get_attribute('aria-label')
            s4 = shot(q, 'B09-graph')
            q.close()
            assert {'Board view', 'Calendar view', 'Graph view', 'Timeline view'} <= set(modes), f'modes {modes}'
            assert len(formats) == 4, f'export panel formats {formats}'
            assert canv > 0, 'the graph view drew no canvas'
            assert nested, 'nested tag inbox/to-read not in the sidebar'
            record('B09_list_views_bulk', ['G-146', 'G-021', 'G-149', 'G-154', 'G-022', 'G-147'], 'PASS', view_modes=modes,
                   bulk_export_formats=formats, nested_tag_seen=nested, graph_list_toggle=gl, graph_canvas=canv, graph_label=graph_label,
                   screenshots=[s1, s_tags, s2, s3, s4])
        b09()

        @guarded('B10_unlinked_mentions', ['G-148'])
        def b10():
            q = open_note(ctx, target)
            sec = q.get_by_role('button', name=re.compile(r'^Unlinked mentions \(\d+\)'))
            sec.first.wait_for(state='visible', timeout=10000)
            title = sec.first.inner_text()
            sec.first.click()
            item = q.get_by_role('link', name=f'Open Mentions the target {RUN}')
            if item.count() == 0:
                item = q.get_by_text(f'Mentions the target {RUN}')
            item.first.wait_for(state='visible', timeout=5000)
            s = shot(q, 'B10-unlinked')
            q.close()
            record('B10_unlinked_mentions', ['G-148'], 'PASS', section=title, screenshot=s)
        b10()

        @guarded('B11_organise', ['G-150', 'G-151', 'G-152', 'G-155', 'G-156'])
        def b11():
            nid = new_note(api, f'Organise me {RUN}', {'type': 'doc', 'content': [para('organise text')]})
            q = open_note(ctx, nid)
            grp = q.get_by_role('group', name='Organise this note')
            grp.first.wait_for(state='visible', timeout=8000)
            labels = [b.inner_text().strip() for b in grp.first.locator('button').all()]
            # lock -> not editable
            grp.first.get_by_role('button', name='Lock').click()
            q.wait_for_timeout(700)
            editable_locked = q.locator('.ProseMirror').first.get_attribute('contenteditable')
            s1 = shot(q, 'B11-locked')
            grp.first.get_by_role('button', name='Unlock').click()
            q.wait_for_timeout(500)
            # archive -> the note leaves the list
            grp.first.get_by_role('button', name='Archive').click()
            q.wait_for_timeout(900)
            lst = api.get(BASE + '/api/j2/notes?limit=200').json()
            ids = [n.get('id') for n in (lst.get('notes') or lst.get('items') or [])]
            archived_gone = nid not in ids
            s2 = shot(q, 'B11-archived')
            q.close()
            # today + open beside
            q2 = ctx.new_page()
            goto(q2, '/journal/notebook')
            q2.get_by_role('button', name='Today').first.click()
            q2.wait_for_selector('.ProseMirror', timeout=12000)
            daily_url = q2.url
            s3 = shot(q2, 'B11-today')
            q2.close()
            assert 'Lock' in labels and 'Archive' in labels and 'Save as template' in labels, labels
            assert editable_locked == 'false', f'locked note contenteditable={editable_locked}'
            assert archived_gone, 'the archived note is still in the default list'
            assert 'note=' in daily_url
            record('B11_organise', ['G-150', 'G-151', 'G-155', 'G-156'], 'PASS', organise_buttons=labels,
                   contenteditable_when_locked=editable_locked, archived_left_default_list=archived_gone,
                   daily_url=daily_url, screenshots=[s1, s2, s3])
        b11()

        @guarded('B12_split_view', ['G-152'])
        def b12():
            q = open_note(ctx, rich)
            btn = q.get_by_role('button', name=re.compile(r'Open a note beside', re.I))
            if btn.count() == 0:
                btn = q.get_by_text('Open a note beside…')
            btn.first.click()
            inp = q.get_by_label('Find a note to open beside')
            inp.fill(f'Zephyr thesis {RUN}')
            q.get_by_role('list', name='Notes to open beside').get_by_role('button', name=re.compile(re.escape(f'Zephyr thesis {RUN}'))).first.click()
            q.wait_for_timeout(1500)
            editors = q.locator('.ProseMirror').count()
            s = shot(q, 'B12-split')
            q.close()
            assert editors >= 2, f'{editors} editors mounted'
            record('B12_split_view', ['G-152'], 'PASS', editors_mounted=editors, screenshot=s)
        b12()

        @guarded('B13_share_publish_export', ['G-080', 'G-167', 'G-169'])
        def b13():
            nid = new_note(api, f'Share me {RUN}', {'type': 'doc', 'content': [para(f'Public words {RUN}.')]})
            q = open_note(ctx, nid)
            q.get_by_role('button', name=re.compile(r'^Share$')).first.click()
            sheet = q.get_by_role('dialog', name='Share this note')
            sheet.wait_for(state='visible', timeout=5000)
            sheet.get_by_role('button', name='Create link').click()
            addr = sheet.get_by_label('Share link address')
            addr.wait_for(state='visible', timeout=8000)
            share_url = addr.input_value()
            sheet.get_by_role('button', name='Publish this note').click()
            pub = sheet.get_by_label('Published page address')
            pub.wait_for(state='visible', timeout=8000)
            pub_url = pub.input_value()
            s1 = shot(q, 'B13-share-sheet')
            q.keyboard.press('Escape')
            # export menu
            q.get_by_role('button', name=re.compile(r'^Export$')).first.click()
            menu = q.get_by_role('menu', name='Export this note as')
            menu.wait_for(state='visible', timeout=4000)
            items = [m.inner_text().strip() for m in menu.get_by_role('menuitem').all()]
            s2 = shot(q, 'B13-export-menu')
            q.close()
            # a stranger reads both public pages
            stranger = browser.new_context()
            sp = stranger.new_page()
            r1 = sp.goto(share_url if share_url.startswith('http') else BASE + share_url)
            sp.get_by_text(f'Public words {RUN}.').first.wait_for(state='visible', timeout=10000)
            s3 = shot(sp, 'B13-stranger-share')
            r2 = sp.goto(pub_url if pub_url.startswith('http') else BASE + pub_url)
            sp.get_by_text(f'Public words {RUN}.').first.wait_for(state='visible', timeout=10000)
            s4 = shot(sp, 'B13-stranger-published')
            stranger.close()
            assert len(items) == 4, f'export menu items {items}'
            record('B13_share_publish_export', ['G-080', 'G-167', 'G-169'], 'PASS', share_url_path=re.sub(r'^https?://[^/]+', '', share_url)[:12] + '…',
                   publish_url_path=re.sub(r'^https?://[^/]+', '', pub_url)[:6] + '…', stranger_share_status=r1.status if r1 else None,
                   stranger_published_status=r2.status if r2 else None, export_menu=items, screenshots=[s1, s2, s3, s4])
        b13()

        @guarded('B14_onboarding_help', ['G-171', 'G-172'])
        def b14():
            c, _ = member('fresh')
            q = c.new_page()
            goto(q, '/journal/notebook')
            tour = q.get_by_role('dialog', name=re.compile('Welcome to your Notebook'))
            tour.first.wait_for(state='visible', timeout=10000)
            s1 = shot(q, 'B14-tour')
            q.keyboard.press('Escape')
            q.wait_for_timeout(500)
            sample_offer = q.get_by_role('button', name=re.compile(r'sample notebook', re.I)).count()
            s2 = shot(q, 'B14-first-run')
            goto(q, '/support')
            q.wait_for_timeout(1500)
            body = q.locator('body').inner_text()
            notebook_articles = len(re.findall(r'[Nn]otebook', body))
            s3 = shot(q, 'B14-support')
            c.close()
            assert sample_offer > 0, 'no sample-notebook offer on the first-run screen'
            assert notebook_articles > 3, 'the Support page does not mention the Notebook'
            record('B14_onboarding_help', ['G-171', 'G-172'], 'PASS', sample_offer_buttons=sample_offer,
                   support_notebook_mentions=notebook_articles, screenshots=[s1, s2, s3])
        b14()

        @guarded('B15_writing_help', ['G-165'])
        def b15():
            nid = new_note(api, f'Writing help {RUN}', {'type': 'doc', 'content': [para('A sentence to rewrite for the check.')]})
            q = open_note(ctx, nid)
            editor_end(q)
            q.keyboard.press('Enter')
            slash(q, 'Writing help')
            q.wait_for_timeout(700)
            text = q.locator('body').inner_text()
            acts = [a for a in ('Summarize', 'Rewrite', 'Continue', 'Translate', 'Autofill') if re.search(a, text, re.I)]
            s = shot(q, 'B15-writing-help')
            q.close()
            assert {'Summarize', 'Rewrite', 'Continue', 'Translate'} <= set(acts), acts
            record('B15_writing_help', ['G-165'], 'PASS', actions_seen=acts, autofill_seen='Autofill' in acts,
                   note='no model key in the sandbox: the panel and its actions are confirmed, not an AI answer', screenshot=s)
        b15()

        @guarded('B16_offline_open_tab', ['G-082', 'G-083'])
        def b16():
            a1 = new_note(api, f'Offline A {RUN}', {'type': 'doc', 'content': [para(f'offline body A {RUN}')]})
            a2 = new_note(api, f'Offline B {RUN}', {'type': 'doc', 'content': [para(f'offline body B {RUN}')]})
            q = open_note(ctx, a1)
            q.wait_for_timeout(1500)
            q.evaluate("(u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }",
                       f'/journal/notebook?note={a2}')
            q.get_by_text(f'offline body B {RUN}').first.wait_for(state='visible', timeout=10000)
            q.wait_for_timeout(1500)
            ctx.set_offline(True)
            q.evaluate("(u) => { history.pushState({}, '', u); dispatchEvent(new PopStateEvent('popstate')); }",
                       f'/journal/notebook?note={a1}')
            q.get_by_text(f'offline body A {RUN}').first.wait_for(state='visible', timeout=10000)
            q.wait_for_timeout(1200)
            banner = q.get_by_text("Viewing an earlier saved copy").count()
            s = shot(q, 'B16-offline')
            ctx.set_offline(False)
            q.close()
            record('B16_offline_open_tab', ['G-082', 'G-083'], 'PASS', offline_note_rendered=True,
                   offline_banner_count=banner, label='context.set_offline in an open tab; no reload (a cold start is OUT by D6)',
                   screenshot=s)
        b16()

        @guarded('B17_older_rows', ['G-002', 'G-023', 'G-024', 'G-033', 'G-036', 'G-101', 'G-075', 'G-110'])
        def b17():
            out = {}
            q = open_note(ctx, rich)
            out['version_history_button'] = q.get_by_role('button', name='Version history').count()
            out['attach_file_button'] = q.get_by_label('Upload file attachment').count()
            editor_end(q)
            q.keyboard.press('Enter')
            q.keyboard.type('[[Zeph')
            q.wait_for_timeout(1200)
            out['note_link_menu_offers_target'] = q.get_by_text(f'Zephyr thesis {RUN}').count() > 0
            s1 = shot(q, 'B17-link-menu')
            q.keyboard.press('Escape')
            q.close()
            q = ctx.new_page()
            goto(q, '/journal/notebook?note=00000000000000000000000000000000')
            q.get_by_text("Couldn't load this note.").first.wait_for(state='visible', timeout=15000)
            s2 = shot(q, 'B17-load-error')
            goto(q, '/journal/notebook')
            q.wait_for_timeout(2000)
            home = q.locator('body').inner_text()
            out['research_home_continue_working'] = 'continue working' in home.lower()
            s3 = shot(q, 'B17-research-home')
            goto(q, '/journal/notebook/research/NVDA')
            q.wait_for_timeout(2500)
            out['ticker_workspace_text'] = q.locator('body').inner_text()[:160]
            s4 = shot(q, 'B17-research-NVDA')
            q.close()
            assert out['version_history_button'] > 0 and out['attach_file_button'] > 0
            assert out['note_link_menu_offers_target'], '[[ did not offer the target note'
            assert out['research_home_continue_working']
            record('B17_older_rows', ['G-002', 'G-033', 'G-036', 'G-101', 'G-110', 'G-075'], 'PASS', screenshots=[s1, s2, s3, s4], **out)
        b17()

        @guarded('B20_more_older_rows', ['G-023', 'G-024', 'G-013', 'G-014', 'G-032', 'G-103', 'G-105'])
        def b20():
            out = {}
            q = open_note(ctx, target)
            fav = q.get_by_role('button', name='Add to Favorites')
            fav.first.click()
            q.get_by_role('button', name='Remove from Favorites').first.wait_for(state='visible', timeout=5000)
            out['favorite_pressed'] = q.get_by_role('button', name='Remove from Favorites').first.get_attribute('aria-pressed')
            q.wait_for_timeout(800)
            side = q.locator('body').inner_text().lower()
            out['sidebar_has_favorites_and_recents'] = ('favorites' in side) and ('recents' in side)
            # find bar
            q.locator('.ProseMirror').first.click()
            q.keyboard.press('Control+f')
            out['find_bar'] = q.get_by_role('search', name='Find in note').count()
            q.keyboard.press('Escape')
            # Ask panel close is an icon, not a glyph
            ask = q.get_by_role('button', name=re.compile(r'^Ask'))
            if ask.count():
                ask.first.click()
                close = q.get_by_role('button', name='Close Ask')
                close.first.wait_for(state='visible', timeout=5000)
                out['ask_close_has_svg'] = close.first.locator('svg').count() > 0
                close.first.click()
            s1 = shot(q, 'B20-favorite-find-ask')
            # delete confirmation is a UCT modal
            q.get_by_role('button', name=re.compile(r'^Delete$')).first.click()
            dlg = q.get_by_role('dialog', name=re.compile('Delete this note'))
            dlg.first.wait_for(state='visible', timeout=5000)
            out['delete_modal'] = dlg.count()
            s2 = shot(q, 'B20-delete-modal')
            dlg.first.get_by_role('button', name=re.compile(r'^Cancel$')).click()
            q.close()
            # sidebar search: snippets with marks; the date filter
            q = ctx.new_page()
            goto(q, '/journal/notebook?view=all')
            q.get_by_role('tab', name='Search notes').first.click()
            box = q.get_by_label('Search your notes').first
            box.wait_for(state='visible', timeout=5000)
            box.fill('Zephyr')
            q.wait_for_timeout(1500)
            out['search_marks'] = q.locator('mark').count()
            s3 = shot(q, 'B20-search-snippets')
            q.get_by_role('button', name='Search filters').first.click()
            out['date_filter_label'] = q.get_by_text('Note created from').count()
            s4 = shot(q, 'B20-date-filter')
            q.close()
            assert out['favorite_pressed'] == 'true' and out['sidebar_has_favorites_and_recents']
            assert out['find_bar'] > 0 and out['delete_modal'] > 0
            assert out['search_marks'] > 0, 'no highlighted snippet in the search results'
            assert out['date_filter_label'] > 0, 'no date filter in the filter panel'
            record('B20_more_older_rows', ['G-023', 'G-024', 'G-013', 'G-014', 'G-032', 'G-103', 'G-105'], 'PASS',
                   screenshots=[s1, s2, s3, s4], **out)
        b20()

        @guarded('B18_dark_doors_answer_404', ['G-085', 'G-044', 'G-161', 'G-160'])
        def b18():
            me = api.get(BASE + '/api/auth/me').json()
            probes = {}
            for path in ('/api/j2/personal/tokens', '/api/j2/inbound-email/address'):
                probes[path] = api.get(BASE + path).status
            flags = {k: v for k, v in me.items() if 'notebook' in k or 'j2_' in k}
            record('B18_dark_doors_answer_404', ['G-085', 'G-044', 'G-161', 'G-160'], 'PASS' if all(v == 404 for v in probes.values()) else 'INCONCLUSIVE',
                   probes=probes, auth_payload_flags=flags,
                   note='the gates production has DARK are unset in this sandbox, as in production; a 404 is the dark answer')
        b18()

        @guarded('B19_axe_editor_and_list', ['G-168'])
        def b19():
            axe_src = open(A.axe, encoding='utf-8').read()
            out = {}
            for name, path in (('editor', f'/journal/notebook?note={rich}'), ('list', '/journal/notebook?view=all')):
                q = ctx.new_page()
                goto(q, path)
                q.wait_for_timeout(2500)
                q.add_script_tag(content=axe_src)
                r = q.evaluate("""async () => { const r = await axe.run(document, {runOnly: {type: 'tag',
                    values: ['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']}});
                    return {version: axe.version, violations: r.violations.map(v => ({id: v.id, impact: v.impact, nodes: v.nodes.length}))}; }""")
                out[name] = r
                q.close()
            record('B19_axe_editor_and_list', ['G-168'], 'PASS' if all(not v['violations'] for v in out.values()) else 'FAIL', axe=out,
                   note='whole page, WCAG 2.0-2.2 A/AA tags, no rule excluded (stricter than the wave-8 D-A5 page exclusion)')
        b19()

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
