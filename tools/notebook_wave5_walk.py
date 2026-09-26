"""Wave 5 live walk -- the Playwright script that produced
docs/notebook/gate-runs/wave5/walk-<sha>.json. Kept in tools/ so the evidence is
reproducible; it is NOT a pytest rail.

Preconditions (each one bit a real attempt):
  * a hub sandbox on :8093 booted from the tip under test
    (scripts/hub_sandbox_boot.py --data-dir C:\data-<name> --port 8093);
  * the walk account is PAID on that data dir -- an unpaid member is redirected
    off every notebook route and every step measures the redirect. Sign up the
    sandbox admin (ADMIN_EMAILS, default hubtest@local.dev) and comp the walk
    account via POST /api/auth/admin/comp-access; the script aborts otherwise;
  * app/dist rebuilt from the tip (the sandbox serves dist/).

    python tools/notebook_wave5_walk.py docs/notebook/gate-runs/wave5/walk-<sha>.json

Wave 5 live walk: real Chromium (Playwright), local sandbox on :8093, synthetic account.

Desktop 1280x800 unless noted. Each check records what the DOM/API actually says; nothing is
inferred. Selectors come from the committed components (CommandPalette, NoteCard, BulkActionBar,
codeBlockNode, mathNodes, TextColorMenu). Re-confirm the B-owned selectors after B reports.

  S1 quick switcher: Ctrl+K finds an OLD note (not a recent/favourite) by title and opens it
  S2 bulk: select 3 notes, move them to a folder in one pass; the API agrees
  S3 code block: ``` + language gives a <pre> with highlight spans
  S4 math: $x^2$ renders KaTeX
  S5 errors: no pageerror during the walk
"""
import json
import sys
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:8093"
EMAIL, PW = "g064@local.dev", "LocalTest2026!"   # synthetic sandbox account; MUST be paid/comped on the sandbox in use (see guard below)
OUT = sys.argv[1] if len(sys.argv) > 1 else "wave5_walk.json"
P = lambda t: {"type": "paragraph", "content": [{"type": "text", "text": t}]}
import time as _t
RUN = _t.strftime("r%H%M%S")   # unique per run: repeat runs never match an older run's notes

res = {"errors": []}
# A crash must never discard what was already measured (CLAUDE.md: "a timeout
# handler that discards its output destroys the one run you needed"): dump the
# partial `res` on ANY exit, and record the exception itself in it.
import atexit, traceback
def _dump_partial():
    try:
        json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
    except Exception as e:  # noqa: BLE001
        print("partial dump failed:", e)
atexit.register(_dump_partial)
_orig_hook = sys.excepthook
def _hook(t, v, tb):
    res["errors"].append("UNHANDLED: " + "".join(traceback.format_exception(t, v, tb))[-1500:])
    res["INCOMPLETE"] = True
    _orig_hook(t, v, tb)
sys.excepthook = _hook
with sync_playwright() as p:
    browser = p.chromium.launch()
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    r = ctx.request.post(BASE + "/api/auth/login", data={"email": EMAIL, "password": PW})
    res["login"] = r.status
    api = ctx.request
    # ⛔ An UNPAID walk account cannot measure the notebook: AuthGuard sends a
    # non-paid member from every non-free route to FREE_HOME (/morning-wire), so
    # each notebook step would record a redirect and read as "the list never
    # rendered" (walk attempt 2 on the fresh w5final sandbox, 2026-09-24). Abort
    # loudly and name the reason; never let it read as a product regression.
    me = api.get(BASE + "/api/auth/me").json()
    res["account"] = {"role": (me.get("user") or {}).get("role"), "plan": me.get("plan"), "paid_equiv": me.get("paid_equiv")}
    if not me.get("paid_equiv"):
        res["INCOMPLETE"] = True
        res["errors"].append("ABORT: walk account is not paid (paid_equiv false) -- comp it via POST /api/auth/admin/comp-access as the sandbox admin (hubtest@local.dev) and re-run")
        raise SystemExit(2)

    # seed: 40 notes, oldest first, plus a folder
    ids = {}
    for i in range(1, 41):
        n = api.post(BASE + "/api/j2/notes", data={"title": f"Walk note {i:02d} {RUN}", "bodyJson": {"type": "doc", "content": [P(f"Body {i}.")]}}).json()["note"]
        ids[i] = n["id"]
    folder = api.post(BASE + "/api/j2/note-folders", data={"name": f"Walk folder {RUN}"})
    res["folder_status"] = folder.status
    res["folder_error"] = None if folder.ok else folder.text()[:200]
    folder_id = (folder.json().get("folder") or folder.json()).get("id") if folder.ok else None
    res["folder_id"] = folder_id

    page = ctx.new_page()
    page.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
    page.goto(f"{BASE}/journal/notebook")
    page.wait_for_timeout(1500)
    page.keyboard.press("Escape")            # the cinematic intro
    page.wait_for_timeout(1200)

    # S1 quick switcher
    page.keyboard.press("Control+k")
    page.wait_for_selector("[aria-label='Command palette']", timeout=8000)
    page.keyboard.type(f"Walk note 03 {RUN}", delay=40)
    page.wait_for_timeout(1200)
    res["S1_rows"] = page.eval_on_selector_all("[aria-label='Search results'] [role='option'], [aria-label='Search results'] li, [aria-label='Search results'] button",
                                               "els => els.slice(0, 6).map(e => e.textContent.trim().slice(0, 60))")
    page.keyboard.press("Enter")
    page.wait_for_timeout(2000)
    res["S1_url"] = page.url
    res["S1_opened_right_note"] = ids[3] in page.url

    # S1b (5C round 3, R1-N2): Enter pressed IMMEDIATELY on a short query is deterministic --
    # "plan" (an exact note title, not a ticker) opens the note; "nvda" opens the research page.
    plan = api.post(BASE + "/api/j2/notes", data={"title": "Plan", "bodyJson": {"type": "doc", "content": [P("plan body")]}}).json()["note"]
    page.goto(f"{BASE}/journal/notebook?view=all"); page.wait_for_timeout(1500)
    page.keyboard.press("Control+k"); page.wait_for_selector("[aria-label='Command palette']", timeout=8000)
    page.keyboard.type("plan", delay=10); page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    res["S1b_plan_url"] = page.url
    res["S1b_plan_opened_a_Plan_note"] = "note=" in page.url and "/research/" not in page.url
    page.goto(f"{BASE}/journal/notebook?view=all"); page.wait_for_timeout(1500)
    page.keyboard.press("Control+k"); page.wait_for_selector("[aria-label='Command palette']", timeout=8000)
    page.keyboard.type("nvda", delay=10); page.keyboard.press("Enter")
    page.wait_for_timeout(2500)
    res["S1b_nvda_url"] = page.url
    res["S1b_nvda_research"] = "/research/NVDA" in page.url.upper() or "/RESEARCH/NVDA" in page.url.upper()

    # S2 bulk move (checkboxes live in the All-notes list/table view, not on Home)
    page.goto(f"{BASE}/journal/notebook?view=all")
    # WAIT for the list, never sample it after a fixed sleep: on a fresh,
    # still-prewarming sandbox the first render takes longer than 2.5 s and a
    # count taken at that instant is 0 (CLAUDE.md, "sampling where a waiter
    # was available"). The ceiling is generous; a mount at any instant inside
    # it is caught.
    try:
        page.wait_for_selector(f"input[type=checkbox][aria-label$='{RUN}']", timeout=45000)
    except Exception as e:  # noqa: BLE001
        res["errors"].append(f"list never rendered a run checkbox within 45s: {str(e)[:200]}")
    page.wait_for_timeout(500)
    boxes = page.locator(f"input[type=checkbox][aria-label$='{RUN}']")
    res["S2_checkboxes"] = boxes.count()
    for k in range(min(3, boxes.count())):
        boxes.nth(k).check()
    bar = page.locator("[aria-label='Actions for the selected notes']")
    try:
        bar.first.wait_for(state="visible", timeout=10000)   # a waiter, not a 400 ms sample
        res["S2_bar_visible"] = True
    except Exception as e:  # noqa: BLE001
        res["S2_bar_visible"] = False
        res["errors"].append(f"bulk bar never became visible after selecting 3 notes: {str(e)[:200]}")
    if folder_id and res["S2_bar_visible"]:
        mv = bar.locator("select").first
        mv.select_option(value=str(folder_id))
        page.wait_for_timeout(1200)
        # S2b (review B1): CHOOSING a folder must move nothing; only the Move button acts
        before = api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=100").json()
        before_notes = before.get("notes", before if isinstance(before, list) else [])
        res["S2b_choose_alone_moved"] = sum(1 for n in before_notes if RUN in (n.get("title") or ""))
        go = bar.locator("button:has-text('Move')")
        if go.count():
            go.first.click()
        page.wait_for_timeout(1500)
        listed = api.get(BASE + f"/api/j2/notes?folder_id={folder_id}&limit=100").json()
        notes = listed.get("notes", listed if isinstance(listed, list) else [])
        res["S2_in_folder"] = sorted(n.get("title") for n in notes if RUN in (n.get("title") or ""))

    # S2c (C's concern 6): bulk trash of 10 run notes -- time to the Undo notice, then Undo restores all
    page.goto(f"{BASE}/journal/notebook?view=all")
    # WAIT for the list, never sample it after a fixed sleep: on a fresh,
    # still-prewarming sandbox the first render takes longer than 2.5 s and a
    # count taken at that instant is 0 (CLAUDE.md, "sampling where a waiter
    # was available"). The ceiling is generous; a mount at any instant inside
    # it is caught.
    try:
        page.wait_for_selector(f"input[type=checkbox][aria-label$='{RUN}']", timeout=45000)
    except Exception as e:  # noqa: BLE001
        res["errors"].append(f"list never rendered a run checkbox within 45s: {str(e)[:200]}")
    page.wait_for_timeout(500)
    boxes = page.locator(f"input[type=checkbox][aria-label$='{RUN}']")
    picked = min(10, boxes.count())
    for k in range(picked):
        boxes.nth(k).check()
    page.wait_for_timeout(300)
    t0 = _t.time()
    page.locator("[aria-label='Actions for the selected notes'] button:has-text('Move to Trash')").first.click()
    undo = page.get_by_role("button", name="Undo", exact=True)
    undo.first.wait_for(state="visible", timeout=15000)
    res["S2c_trash_to_notice_ms"] = round((_t.time() - t0) * 1000)
    trashed = api.get(BASE + "/api/j2/notes?deleted=true&limit=200").json()
    tn = trashed.get("notes", trashed if isinstance(trashed, list) else [])
    res["S2c_trashed"] = sum(1 for n in tn if RUN in (n.get("title") or ""))
    undo.first.click()
    page.wait_for_timeout(2500)
    trashed2 = api.get(BASE + "/api/j2/notes?deleted=true&limit=200").json()
    tn2 = trashed2.get("notes", trashed2 if isinstance(trashed2, list) else [])
    res["S2c_after_undo_still_trashed"] = sum(1 for n in tn2 if RUN in (n.get("title") or ""))
    res["S2c_picked"] = picked

    # S2d (5C review R1-S2): trash, then favorite -> both notices visible, stacked, Undo clickable,
    # at 1200 / 820 / 390 px; on a touch phone the stack must not sit under the joystick hub.
    def notice_check(pg, label):
        pg.goto(f"{BASE}/journal/notebook?view=all")
        pg.wait_for_timeout(2500)
        bx = pg.locator(f"input[type=checkbox][aria-label$='{RUN}']")
        out = {"boxes": bx.count()}
        if bx.count() < 2:
            return out
        bx.nth(0).check(); pg.wait_for_timeout(200)
        pg.locator("[aria-label='Actions for the selected notes'] button:has-text('Move to Trash')").first.click()
        pg.get_by_role("button", name="Undo", exact=True).first.wait_for(state="visible", timeout=15000)
        pg.wait_for_timeout(400)
        bx = pg.locator(f"input[type=checkbox][aria-label$='{RUN}']")
        bx.nth(0).check(); pg.wait_for_timeout(200)
        pg.locator("[aria-label='Actions for the selected notes'] button:has-text('Favorite')").first.click()
        pg.wait_for_timeout(1200)
        out.update(pg.evaluate("""() => {
          const undo = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Undo');
          if (!undo) return { undo: 'missing' };
          const r = undo.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const hub = document.querySelector('[data-testid="hub-root"]');
          let hubOverlap = null;
          if (hub && !hub.hidden && getComputedStyle(hub).display !== 'none') {
            const pad = hub.querySelector('[data-testid="hub-pad"]') || hub;
            const h = pad.getBoundingClientRect();
            hubOverlap = !(h.right < r.left || h.left > r.right || h.bottom < r.top || h.top > r.bottom) && h.width > 0;
          }
          const stack = undo.closest('[class]') && undo.parentElement && undo.parentElement.parentElement;
          const notices = stack ? stack.children.length : 0;
          return { undo: 'present', undoHitsItself: hit === undo || undo.contains(hit),
                   hitWhat: hit ? (hit.tagName + '.' + String(hit.className || '').slice(0, 60)) : null,
                   undoInViewport: r.bottom <= innerHeight && r.top >= 0, siblingNotices: notices,
                   hubOverlap, w: innerWidth };
        }"""))
        # record the measurements BEFORE the click can throw (a failed click used to discard them)
        try:
            pg.get_by_role("button", name="Undo", exact=True).first.click(timeout=8000)
            out["undoClick"] = "ok"
        except Exception as exc:
            out["undoClick"] = str(exc)[:600]
        pg.wait_for_timeout(1500)
        return out

    res["S2d"] = {}
    for w, h in ((1200, 800), (820, 1180)):
        page.set_viewport_size({"width": w, "height": h})
        res["S2d"][str(w)] = notice_check(page, str(w))
    page.set_viewport_size({"width": 1280, "height": 800})
    mctx = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True, device_scale_factor=2)
    mctx.request.post(BASE + "/api/auth/login", data={"email": EMAIL, "password": PW})
    mpage = mctx.new_page()
    mpage.on("pageerror", lambda e: res["errors"].append("mobile: " + str(e)[:280]))
    try:
        mpage.goto(f"{BASE}/journal/notebook?view=all"); mpage.wait_for_timeout(1500); mpage.keyboard.press("Escape")
        res["S2d"]["390-touch"] = notice_check(mpage, "390")
    except Exception as exc:
        res["S2d"]["390-touch"] = {"error": str(exc)[:200]}
    mctx.close()

    # S3/S4 in a fresh note
    # ⛔ An EMPTY TEXT NODE ({type:text, text:""}) is a document ProseMirror cannot build
    # ("Empty text nodes are not allowed"). Since 4da0b1fcd the content guard LOCKS such a
    # note read-only instead of blanking it -- attempt 3 seeded exactly that and every
    # editor step failed on a working product. Seed a bare paragraph, which is valid.
    fresh = api.post(BASE + "/api/j2/notes", data={"title": "Walk editor", "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}).json()["note"]
    page.goto(f"{BASE}/journal/notebook?note={fresh['id']}")
    page.wait_for_selector(".ProseMirror", timeout=30000)
    page.wait_for_timeout(800)
    page.locator(".ProseMirror").click()
    page.keyboard.press("Control+End")
    page.keyboard.type("```js ", delay=30)
    page.keyboard.type("const x = 42", delay=20)
    page.wait_for_timeout(800)
    res["S3_code"] = page.evaluate("""(() => { const pre = document.querySelector('.ProseMirror pre');
        return pre ? { hl: pre.querySelectorAll('[class*=hljs-]').length, text: pre.textContent.slice(0, 40) } : null })()""")
    page.keyboard.press("Control+End")
    page.keyboard.press("ArrowDown")
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    page.keyboard.press("Enter")
    page.keyboard.type("Area is $x^2$ ", delay=30)
    page.wait_for_timeout(1500)
    res["S4_katex"] = page.eval_on_selector_all(".ProseMirror .katex", "els => els.length")

    # S5 find & replace: Ctrl+H, replace all, and ONE undo restores (one transaction)
    page.keyboard.press("Control+End")
    page.keyboard.press("Enter")
    page.keyboard.type("alpha beta alpha", delay=20)
    page.wait_for_timeout(300)
    page.keyboard.press("Control+h")
    page.wait_for_timeout(500)
    page.locator("input[aria-label='Find in note']").first.fill("alpha")
    page.locator("input[aria-label='Replace with']").first.fill("gamma")
    page.locator("button:has-text('Replace all')").first.click()
    page.wait_for_timeout(500)
    txt = lambda: page.evaluate("document.querySelector('.ProseMirror').innerText")
    res["S5_after_replace"] = "gamma beta gamma" in txt() and "alpha" not in txt()
    page.keyboard.press("Escape")
    page.locator(".ProseMirror").click()
    page.keyboard.press("Control+z")
    page.wait_for_timeout(400)
    res["S5_one_undo_restores"] = "alpha beta alpha" in txt()

    # S5b (5B re-review R1-B1): Whole-word find with an EMOJI term must return, not hang the tab
    page.keyboard.press("Control+End")
    page.keyboard.press("Enter")
    page.keyboard.type("NVDA🚀 and 🚀 alone", delay=15)
    page.keyboard.press("Control+f")
    page.wait_for_timeout(400)
    ww = page.locator("[aria-label='Whole word']").first
    res["S5b_whole_word_toggle"] = ww.count() > 0
    if ww.count():
        ww.click()
    t0 = _t.time()
    try:
        # a hung find blocks the page's JS thread mid-fill, so the fill itself times out
        page.locator("input[aria-label='Find in note']").first.fill("🚀", timeout=8000)
        page.wait_for_timeout(300)
        page.wait_for_function("() => true", timeout=5000)
        res["S5b_page_responsive"] = True
    except Exception as exc:
        res["S5b_page_responsive"] = False
        res["S5b_error"] = str(exc)[:160]
    res["S5b_ms"] = round((_t.time() - t0) * 1000)
    if res["S5b_page_responsive"]:
        page.keyboard.press("Escape")
    else:
        # the frozen tab cannot continue: carry on in a fresh page on the same note
        try:
            page.close(run_before_unload=False)
        except Exception:
            pass
        page = ctx.new_page()
        page.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
        page.goto(f"{BASE}/journal/notebook?note={fresh['id']}")
        page.wait_for_selector(".ProseMirror", timeout=30000)
        page.wait_for_timeout(800)

    # S6 colour: select "beta", open the colour menu, choose Red, stored by NAME
    page.evaluate("""() => { const pm = document.querySelector('.ProseMirror');
      const w = document.createTreeWalker(pm, NodeFilter.SHOW_TEXT); let n;
      while ((n = w.nextNode())) { const i = n.data.indexOf('beta'); if (i >= 0) {
        const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 4);
        const s = getSelection(); s.removeAllRanges(); s.addRange(r); pm.focus();
        document.dispatchEvent(new Event('selectionchange')); return } } }""")
    page.wait_for_timeout(300)
    toggle = page.get_by_role("button", name=__import__("re").compile("colou?r", __import__("re").I)).first
    res["S6_toggle_found"] = toggle.count() > 0
    if toggle.count():
        toggle.click()
        page.wait_for_timeout(400)
        red = page.locator("button[aria-label='Red text']")
        res["S6_red_option"] = red.count()
        if red.count():
            red.first.click()
            page.wait_for_timeout(400)
    res["S6_red_span"] = page.eval_on_selector_all(".ProseMirror [data-text-color='red']", "els => els.map(e => e.textContent)")

    # S7 word count + reading time line
    res["S7_stats"] = page.evaluate("(document.querySelector('[data-testid=note-stats]')||{}).textContent || null")
    browser.close()

json.dump(res, open(OUT, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
print(json.dumps(res, indent=1, ensure_ascii=False))
