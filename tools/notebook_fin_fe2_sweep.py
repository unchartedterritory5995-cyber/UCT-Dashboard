"""Finish program, lane FE2 round 2 -- two browser passes at 390 px (touch), port 8133.

  --config sweep   every wave switch ON. The other Notebook confirms, one by one: for each, the
                   confirm button is the top element at its own centre, a tap on it does the
                   thing, and the product's own API says it happened.
                     sample "Remove it" (no dialog: the button itself), bulk Move to Trash,
                     folder Delete, saved view Delete, version Restore, gallery Unpublish.
  --config off     review drafts, setups board and find similar ON; plan grading, chart plan and
                   the fingerprint OFF (the walk's configuration 3). P7 and P9 in the page:
                     a daily review draft says the discipline record is not in it;
                     the setups board's empty line says a plan cannot be drawn, and names no step;
                     an Example card has no Find similar door and says examples are not matched;
                     the find-similar sheet opened on an example shows the server's sentence.

Same sandbox rules as the other fin-fe walks. Raw observations are written before any row is
judged. A door the walker could not reach is printed as OBSERVED, never as a pass.

    python tools/notebook_fin_fe2_sweep.py --config sweep --data-dir 'C:\\data-fin-fe\\sw1' `
        --port 8133 --out 'docs\\notebook\\evidence\\fin-fe2\\sweep-<sha>'
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
from notebook_fin_fe_walk import para, pause  # noqa: E402
from notebook_fin_fe2_walk import ORB, TOP_AT, api_note, goto_note, press  # noqa: E402
from notebook_w13h2_walk import Walk, install_bars_route  # noqa: E402
from notebook_w13x_walk import FLAGS  # noqa: E402
from secret_scrub import brief, scrub  # noqa: E402

PW = "LocalTest2026!"
OFF_ON = ["NOTEBOOK_REVIEW_DRAFTS_ENABLED", "NOTEBOOK_SETUPS_BOARD_ENABLED", "NOTEBOOK_FIND_SIMILAR_ENABLED",
          "NOTEBOOK_VISUAL_PLAYBOOK_ENABLED"]
HIT = """(el) => { const r = el.getBoundingClientRect(); const cx = r.left + r.width / 2, cy = r.top + r.height / 2; const top = document.elementFromPoint(cx, cy);
  return { box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], cx, cy, top_is_button: !!top && (top === el || el.contains(top)),
           top_tag: top ? top.tagName + '.' + String(top.className && top.className.baseVal !== undefined ? top.className.baseVal : top.className).slice(0, 40) : null } }"""


DIALOGS = """() => [...document.querySelectorAll('[role=dialog]')].map((d) => { const r = d.getBoundingClientRect(); const l = d.getAttribute('aria-labelledby');
  return { name: d.getAttribute('aria-label') || (l && document.getElementById(l) ? document.getElementById(l).textContent.trim() : null), box: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
           shown: getComputedStyle(d).display !== 'none' && r.width > 0 } })"""


def seen(loc):
    """The first VISIBLE match: a hidden desktop twin of a phone control must never be picked."""
    return loc.locator("visible=true").first


def load(pg, base, path):
    pg.goto(base + path, wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pause(pg, 3.0)


def modal_confirm(pg, w, tag, obs, title_re, label):
    """A ConfirmModal is open: measure its confirm button, then tap it at its centre."""
    dlg = pg.get_by_role("dialog", name=title_re)
    dlg.first.wait_for(state="visible", timeout=15000)
    pause(pg, 0.6)
    btn = dlg.first.get_by_role("button", name=label, exact=True)
    hit = btn.first.evaluate(HIT)
    obs.update({"dialog": dlg.first.inner_text()[:160], "hit": hit, "voice_button_while_open": len(pg.evaluate(ORB)),
                "body_overflow": pg.evaluate("() => document.body.style.overflow")})
    w.shot(pg, f"{tag}_confirm")
    pg.touchscreen.tap(hit["cx"], hit["cy"])
    pause(pg, 2.0)
    obs["dialog_left"] = pg.get_by_role("dialog", name=title_re).count()
    return hit


def judge(w, tag, obs, done, detail):
    hit = obs.get("hit") or {}
    ok = bool(hit.get("top_is_button")) and obs.get("voice_button_while_open", 1) == 0 and bool(done)
    w.record(f"V390_{tag}", ok, f"confirm button is the top element at its centre={hit.get('top_is_button')} ({hit.get('top_tag')}), box={hit.get('box')}; "
                               f"voice button while open={obs.get('voice_button_while_open')}; done={done}: {detail}")
    w.raw[tag] = obs
    w.dump(f"{tag}.json", obs)


def step(w, pg, tag, fn):
    if w.raw.get("only") and tag not in w.raw["only"]:
        return
    try:
        fn()
    except h.SetupFailed:
        raise
    except Exception as e:  # noqa: BLE001
        print(f"  OBSERVED V390_{tag}: not reached ({brief(e, 260)})")
        w.raw.setdefault("not_reached", {})[tag] = brief(e, 400)
        try:
            w.raw.setdefault("not_reached_page", {})[tag] = {"stage": w.raw.get("stage"), "dialogs": pg.evaluate(DIALOGS), "url": pg.url[-80:]}
            print(f"    at stage {w.raw.get('stage')!r}; dialogs on the page: {w.raw['not_reached_page'][tag]['dialogs']}")
        except Exception:  # noqa: BLE001
            pass
        w.shot(pg, f"{tag}_not_reached")
        try:
            pg.keyboard.press("Escape")
        except Exception:  # noqa: BLE001
            pass


def sweep(pg, base, req, w):
    # ── the sample first: it can only be added to an empty Notebook ──────────────────────────
    add = req.post(base + "/api/j2/onboarding/sample-notebook")
    w.raw["sample_add"] = add.status

    def sample_remove():
        obs = {}
        load(pg, base, "/journal/notebook")
        btn = pg.get_by_role("button", name="Remove it")
        btn.first.wait_for(state="visible", timeout=20000)
        btn.first.scroll_into_view_if_needed()
        pause(pg, 0.5)
        obs["hit"] = btn.first.evaluate(HIT)
        obs["voice_button_while_open"] = 0          # no dialog here: the hit test alone decides
        obs["voice_buttons_on_page"] = len(pg.evaluate(ORB))
        w.shot(pg, "sample_remove_before")
        pg.touchscreen.tap(obs["hit"]["cx"], obs["hit"]["cy"])
        said = None
        for _ in range(30):
            said = pg.evaluate("() => { const p = [...document.querySelectorAll('[role=status], [role=alert]')].map((e) => e.textContent.trim()).find((t) => /sample/i.test(t)); return p || null }")
            if said:
                break
            pause(pg, 0.5)
        obs["message"] = said
        st = req.get(base + "/api/j2/onboarding/sample-notebook").json()
        obs["status_after"] = {"activeIds": len(st.get("activeIds") or []), "ids": len(st.get("ids") or [])}
        w.shot(pg, "sample_remove_after")
        judge(w, "sample_remove_it", obs, said and "Trash" in said and obs["status_after"]["activeIds"] == 0,
              f"message={said!r}; active sample notes after={obs['status_after']['activeIds']}")
    step(w, pg, "sample_remove_it", sample_remove)

    # ── seed the rest through the product's own routes ───────────────────────────────────────
    a = api_note(req, base, "sweep bulk a", [para("a")])
    b = api_note(req, base, "sweep bulk b", [para("b")])
    fo = req.post(base + "/api/j2/note-folders", data={"name": "Sweep folder"})
    sv = req.post(base + "/api/j2/saved-views", data={"name": "Sweep view", "viewType": "list", "spec": {}})
    vn = api_note(req, base, "sweep versions", [para("first words")])
    req.put(f"{base}/api/j2/notes/{vn['id']}", data={"bodyJson": {"type": "doc", "content": [para("second words")]}, "baseUpdatedAt": vn["updatedAt"]})
    tn = api_note(req, base, "sweep template source", [para("a template body")])
    tpl = req.post(base + "/api/j2/note-templates", data={"noteId": tn["id"], "name": "Sweep template"})
    tpl_id = ((tpl.json().get("template") or tpl.json().get("noteTemplate") or {}).get("id")) if tpl.status in (200, 201) else None
    pub = req.post(base + "/api/j2/template-gallery", data={"templateId": tpl_id, "title": "Sweep template", "category": "trade_plan"}) if tpl_id else None
    w.raw["seed"] = {"folder": fo.status, "saved_view": sv.status, "saved_view_body": sv.text()[:160], "template": tpl.status, "template_body": tpl.text()[:200],
                     "publish": pub.status if pub else None, "publish_body": pub.text()[:200] if pub else None}

    def bulk():
        obs = {}
        load(pg, base, "/journal/notebook?view=all")
        press(pg, pg.get_by_role("checkbox", name="Select sweep bulk a").first, True)
        pause(pg, 0.4)
        press(pg, pg.get_by_role("checkbox", name="Select sweep bulk b").first, True)
        pause(pg, 0.6)
        bar = pg.locator('[aria-label="Actions for the selected notes"]')
        trash = bar.get_by_role("button", name="Move to Trash", exact=True)
        if not (trash.count() and trash.first.is_visible()):
            more = bar.get_by_role("button", name=re.compile(r"More", re.I))
            press(pg, more.first, True)
            pause(pg, 0.5)
            trash = pg.get_by_role("button", name="Move to Trash", exact=True)
        trash.first.scroll_into_view_if_needed(timeout=10000)
        pause(pg, 0.4)
        obs["hit"] = trash.first.evaluate(HIT)
        obs["voice_buttons_on_page"] = len(pg.evaluate(ORB))
        w.shot(pg, "bulk_bar")
        pg.touchscreen.tap(obs["hit"]["cx"], obs["hit"]["cy"])
        pause(pg, 2.5)
        obs["dialogs_after_tap"] = pg.evaluate(DIALOGS)
        obs["confirm_dialog"] = any(d["shown"] for d in obs["dialogs_after_tap"])
        if obs["confirm_dialog"]:
            modal_confirm(pg, w, "bulk", obs, re.compile(r".*"), re.compile(r"Move to Trash|Trash|Delete"))
        else:
            obs["voice_button_while_open"] = 0      # no dialog: the bar button itself is the door
            obs["dialog_left"] = 0
        obs["notice"] = pg.evaluate("() => [...document.querySelectorAll('[role=status], [role=alert]')].map((e) => e.textContent.trim()).filter(Boolean).slice(0, 3)")
        w.shot(pg, "bulk_after")
        rows = req.get(base + "/api/j2/notes?limit=200").json()
        rows = rows.get("notes") if isinstance(rows, dict) else rows
        left = [r["title"] for r in rows if r.get("id") in (a["id"], b["id"])]
        judge(w, "bulk_move_to_trash", obs, not left and obs["dialog_left"] == 0,
              f"a confirm dialog opened={obs['confirm_dialog']}; notice={obs['notice']}; selected notes still in the active list={left}")
    step(w, pg, "bulk_move_to_trash", bulk)

    def folder():
        obs = {}
        load(pg, base, "/journal/notebook")
        press(pg, pg.get_by_role("button", name="Delete Sweep folder", exact=True).first, True)
        modal_confirm(pg, w, "folder", obs, re.compile(r"Delete folder"), "Delete")
        fl = req.get(base + "/api/j2/note-folders").text()
        judge(w, "folder_delete", obs, "Sweep folder" not in fl and obs["dialog_left"] == 0, f"folder still listed={'Sweep folder' in fl}")
    step(w, pg, "folder_delete", folder)

    def view():
        obs = {}
        load(pg, base, "/journal/notebook")
        w.raw["stage"] = "view: find the Delete button"
        vb = pg.get_by_role("button", name="Delete Sweep view", exact=True)
        obs["delete_buttons"] = vb.count()
        b = seen(vb)
        b.scroll_into_view_if_needed(timeout=10000)
        pause(pg, 0.6)
        obs["door"] = b.evaluate(HIT)
        w.shot(pg, "view_before")
        w.raw["stage"] = f"view: tapped Delete at {obs['door']}, waiting for the dialog"
        pg.touchscreen.tap(obs["door"]["cx"], obs["door"]["cy"])
        pause(pg, 1.0)
        obs["dialogs_after_tap"] = pg.evaluate(DIALOGS)
        if not any(d["shown"] for d in obs["dialogs_after_tap"]):
            # the row's own actions are hover-revealed on desktop: a first tap may only reveal them
            obs["second_tap"] = True
            obs["door2"] = b.evaluate(HIT)
            w.raw["stage"] = f"view: second tap at {obs['door2']}, waiting for the dialog"
            pg.touchscreen.tap(obs["door2"]["cx"], obs["door2"]["cy"])
        modal_confirm(pg, w, "view", obs, re.compile(r"Delete view"), "Delete")
        vl = req.get(base + "/api/j2/saved-views").text()
        judge(w, "saved_view_delete", obs, "Sweep view" not in vl and obs["dialog_left"] == 0, f"view still listed={'Sweep view' in vl}")
    step(w, pg, "saved_view_delete", view)

    def restore():
        obs = {}
        goto_note(pg, base, vn["id"], False)
        pause(pg, 2.0)
        w.raw["stage"] = "restore: open the note menu"
        press(pg, seen(pg.get_by_role("button", name="More note actions")), True)
        pause(pg, 0.8)
        w.raw["stage"] = "restore: tap History in the menu"
        hist = pg.get_by_role("button", name="Version history", exact=True)      # its text is "History"
        obs["history_controls"] = hist.count()
        press(pg, seen(hist), True)
        w.raw["stage"] = "restore: wait for the History panel"
        pause(pg, 3.0)
        obs["dialogs_history"] = pg.evaluate(DIALOGS)
        rb = pg.get_by_role("button", name="Restore this version")
        if not rb.locator("visible=true").count():
            w.raw["stage"] = "restore: pick a version in the list"
            obs["history_text"] = pg.evaluate("() => [...document.querySelectorAll('[role=dialog]')].map((d) => d.innerText.slice(0, 300))")
            w.raw["restore_partial"] = obs
            w.shot(pg, "restore_history_list")
            rows = pg.locator("[role=dialog] li button, [role=dialog] ul button")
            obs["version_rows"] = rows.count()
            press(pg, seen(rows.last if rows.count() > 1 else rows), True)
            pause(pg, 2.0)
        w.raw["stage"] = "restore: tap Restore this version"
        w.shot(pg, "restore_history")
        press(pg, seen(rb), True)
        w.raw["stage"] = "restore: waiting for the confirm"
        modal_confirm(pg, w, "restore", obs, re.compile(r"Restore this version\?"), "Restore")
        pause(pg, 1.5)
        after = json.dumps((req.get(f"{base}/api/j2/notes/{vn['id']}").json().get("note") or {}).get("bodyJson"))
        judge(w, "version_restore", obs, "first words" in after and obs["dialog_left"] == 0, f"the note reads its first version again={'first words' in after}")
    step(w, pg, "version_restore", restore)

    def unpublish():
        obs = {}
        load(pg, base, "/journal/notebook?view=all")
        press(pg, pg.get_by_role("button", name=re.compile(r"Templates")).first, True)
        pause(pg, 1.0)
        press(pg, pg.get_by_role("button", name=re.compile(r"Browse the community gallery")).first, True)
        pause(pg, 1.5)
        press(pg, pg.get_by_role("tab", name="Your submissions").or_(pg.get_by_role("button", name="Your submissions")).first, True)
        pause(pg, 1.0)
        press(pg, pg.get_by_role("button", name=re.compile(r"^Unpublish")).first, True)
        grp = pg.get_by_role("group", name=re.compile(r"^Unpublish"))
        grp.first.wait_for(state="visible", timeout=10000)
        pause(pg, 0.5)
        btn = grp.first.get_by_role("button", name="Unpublish", exact=True)
        obs["hit"] = btn.first.evaluate(HIT)
        obs["voice_button_while_open"] = len(pg.evaluate(ORB))
        obs["inside_a_dialog"] = btn.first.evaluate("el => !!el.closest('[role=dialog]')")
        w.shot(pg, "unpublish_confirm")
        pg.touchscreen.tap(obs["hit"]["cx"], obs["hit"]["cy"])
        pause(pg, 2.0)
        mine = req.get(base + "/api/j2/template-gallery?mine=1").text()
        obs["message"] = pg.evaluate("() => [...document.querySelectorAll('[role=status], [role=alert]')].map((e) => e.textContent.trim()).find((t) => /Unpublished/.test(t)) || null")
        obs["mine_after"] = mine[:300]
        judge(w, "gallery_unpublish", obs, bool(obs["message"]), f"message={obs['message']!r}; inside a sheet={obs['inside_a_dialog']}")
    step(w, pg, "gallery_unpublish", unpublish)


def off(pg, base, req, w):
    me = req.get(base + "/api/auth/me").json()
    flags = {k: me.get(k) for k in ("notebook_review_drafts_enabled", "notebook_plan_grading_enabled", "notebook_setups_board_enabled",
                                    "notebook_chart_plan_enabled", "notebook_find_similar_enabled", "notebook_ta_fingerprint_enabled")}
    w.record("V390_off_W0_switches", flags["notebook_review_drafts_enabled"] is True and flags["notebook_plan_grading_enabled"] is not True
             and flags["notebook_setups_board_enabled"] is True and flags["notebook_chart_plan_enabled"] is not True
             and flags["notebook_find_similar_enabled"] is True, f"{flags}")
    add = req.post(base + "/api/j2/onboarding/sample-notebook")
    w.raw["sample_add"] = add.status

    def draft():
        obs = {}
        load(pg, base, "/journal/notebook")
        btn = pg.locator('[data-tour="review-drafts-daily"]')
        btn.first.wait_for(state="visible", timeout=20000)
        obs["button"] = btn.first.inner_text()
        press(pg, btn.first, True)
        pg.wait_for_function("() => !!new URLSearchParams(location.search).get('note')", timeout=30000)
        pg.wait_for_selector(".ProseMirror", timeout=60000)
        text = ""
        for _ in range(20):
            text = pg.locator(".ProseMirror").first.inner_text()
            if "Discipline record" in text:
                break
            pause(pg, 0.5)
        i = text.find("Discipline record")
        obs["discipline_part"] = text[i:i + 220] if i >= 0 else None
        obs["draft_head"] = text[:200]
        w.shot(pg, "off_review_draft")
        ok = bool(obs["discipline_part"]) and "Plan grading is switched off, so this draft has no discipline record." in obs["discipline_part"] and "Plan rate" not in text
        w.record("V390_P7_review_draft_says_the_discipline_record_is_not_in_it", ok, f"under the heading: {obs['discipline_part']!r}")
        # the Insights sections only render once the account has a trade: seed one closed trade
        from datetime import datetime
        day = datetime.now().strftime("%Y-%m-%d")
        tr = req.post(base + "/api/j2/trades", data={"symbol": "AMD", "side": "Long", "shares": 50, "entryPrice": 150, "entryDate": day,
                                                     "exitPrice": 155, "exitDate": day, "originalStop": 145})
        obs["trade_seed"] = {"status": tr.status, "body": tr.text()[:160]}
        load(pg, base, "/journal/insights?ins=reviews")
        box = pg.locator('[data-testid="review-drafts-section"]')
        try:
            box.first.wait_for(state="visible", timeout=25000)       # the section is its own file
        except Exception:  # noqa: BLE001
            obs["insights_page_text"] = pg.locator("main").first.inner_text()[:900] if pg.locator("main").count() else None
            w.shot(pg, "off_insights_not_reached")
        obs["insights_box"] = box.first.inner_text()[:420] if box.count() else None
        if box.count():
            box.first.scroll_into_view_if_needed()
            w.shot(pg, "off_insights_box")
        w.record("V390_P7_insights_box_does_not_promise_the_discipline_record",
                 bool(obs["insights_box"]) and "The discipline record is left out" in obs["insights_box"] and "the discipline record, setup changes" not in obs["insights_box"],
                 f"box={obs['insights_box']!r}")
        w.raw["off_review_draft"] = obs
        w.dump("off_review_draft.json", obs)
    step(w, pg, "P7_review_draft", draft)

    def board():
        obs = {}
        api = req.get(base + "/api/j2/setups-board").json()
        obs["api"] = {"count": api.get("count"), "exampleCount": api.get("exampleCount"), "planDrawing": api.get("planDrawing"),
                      "cards": [{k: c.get(k) for k in ("symbol", "example", "similarNeverMatched", "similarEmbedKey", "noteId")} for c in (api.get("cards") or [])]}
        load(pg, base, "/journal/notebook/setups")
        pg.wait_for_selector("[data-setups-page]", timeout=30000)
        pause(pg, 2.0)
        text = pg.locator("[data-setups-page]").first.inner_text()
        obs["page_text"] = text[:900]
        obs["find_similar_buttons"] = pg.get_by_role("button", name=re.compile(r"^Find more like")).count()
        w.shot(pg, "off_setups_board")
        sentence = (api.get("planDrawing") or {}).get("sentence") or ""
        w.record("V390_P7_setups_board_empty_line_says_a_plan_cannot_be_drawn",
                 bool(sentence) and f"No open setups yet. {sentence}" in text and "Draw an entry line" not in text,
                 f"planDrawing={api.get('planDrawing')}; the line on the page starts: {text[text.find('No open setups'):][:170]!r}")
        examples = [c for c in obs["api"]["cards"] if c["example"]]
        w.record("V390_P9_example_cards_offer_no_find_similar_and_say_so",
                 bool(examples) and "Examples are not matched against the day" in text
                 and pg.locator("[data-board-page] li").filter(has_text="Examples are not matched").get_by_role("button", name=re.compile(r"^Find more like")).count() == 0,
                 f"example cards from the API={len(examples)}; 'Examples are not matched' on the page={'Examples are not matched' in text}; Find-more buttons on the page={obs['find_similar_buttons']}")
        ex = next((c for c in examples if c.get("similarEmbedKey")), None)
        if ex:
            ans = req.get(f"{base}/api/j2/similar-names/{ex['noteId']}/{ex['similarEmbedKey']}").json()
            obs["similar_api"] = {"status": ans.get("status"), "neverMatched": ans.get("neverMatched")}
            load(pg, base, f"/journal/notebook/setups?similar={ex['noteId']}:{ex['similarEmbedKey']}")
            sheet = pg.locator("[data-similar-names]")
            sheet.first.wait_for(state="visible", timeout=20000)
            pause(pg, 2.0)
            obs["sheet_text"] = sheet.first.inner_text()[:400]
            w.shot(pg, "off_find_similar_example")
            want = (ans.get("neverMatched") or {}).get("sentence") or "(no sentence in the answer)"
            w.record("V390_P9_find_similar_on_an_example_shows_the_never_matched_sentence",
                     ans.get("status") == "example" and want in obs["sheet_text"] and "matched tonight" not in obs["sheet_text"],
                     f"answer status={ans.get('status')!r}; sheet={obs['sheet_text']!r}")
        else:
            print("  OBSERVED V390_P9: no example card carries a tagged chart, so the sheet was not opened")
        w.raw["off_setups_board"] = obs
        w.dump("off_setups_board.json", obs)
    step(w, pg, "P7_P9_board", board)


def run(base, w, config):
    from playwright.sync_api import sync_playwright
    served, errors = [], []
    with sync_playwright() as pw:
        br = pw.chromium.launch()
        admin = br.new_context()
        ctx = br.new_context(reduced_motion="reduce", viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)
        req = ctx.request
        h._provision(admin.request, req, base, member=(f"fe2-{config}@local.dev", PW, f"fe2{config}"))
        install_bars_route(ctx, served)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(brief(e, 240)))
        (sweep if config == "sweep" else off)(pg, base, req, w)
        w.raw["page_errors"] = errors
        br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--config", choices=("sweep", "off"), required=True)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8133)
    ap.add_argument("--out", required=True)
    ap.add_argument("--only", default="", help="comma list of step tags; default all")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why or args.port != 8133 or h.port_busy(args.port):
        print(f"REFUSED: {why or 'port must be 8133 and free'}")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    w = Walk(out)
    if args.only:
        w.raw["only"] = [t.strip() for t in args.only.split(",") if t.strip()]
    for k in list(os.environ):
        if k.startswith("RAILWAY_") or (k.startswith("NOTEBOOK_") and k.endswith("_ENABLED")) or k == "AWARENESS_NOTE_RESURFACE_ENABLED":
            os.environ.pop(k, None)
    on = (FLAGS + ["NOTEBOOK_TEMPLATE_GALLERY_ENABLED"]) if args.config == "sweep" else OFF_ON
    os.environ.update({f: "1" for f in on})
    os.environ.update({"NOTEBOOK_ONBOARDING_ENABLED": "1", "NOTEBOOK_GETTING_STARTED_ENABLED": "1",
                       "FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    not_run = failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                run(base, w, args.config)
            except h.SetupFailed as e:
                not_run = scrub(str(e))[:400]
            except Exception as e:  # noqa: BLE001
                import traceback
                failure = f"the walk raised {brief(e, 400)}"
                w.raw["traceback"] = scrub(traceback.format_exc())[-3000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    w.record("W10_port_free_after_shutdown", not h.port_busy(args.port), f"listener on {args.port}: {h.port_busy(args.port)}")
    (out / "walk.json").write_text(json.dumps({"tool": "tools/notebook_fin_fe2_sweep.py", "config": args.config, "integrity": integ, "failure": failure,
                                               "not_run": not_run, "rows": w.rows, "raw": w.raw}, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    failed = [r["id"] for r in w.rows if r["verdict"] != "PASS"]
    missed = sorted((w.raw.get("not_reached") or {}).keys())
    if failure or failed:
        print(f"VERDICT: FAIL -- {failure or ', '.join(failed)}" + (f"; not reached: {missed}" if missed else ""))
        return 1
    print(f"VERDICT: {'PASS' if not missed else 'PARTIAL'} -- {len(w.rows)} rows" + (f"; not reached: {missed}" if missed else ""))
    return 0 if not missed else 1


if __name__ == "__main__":
    sys.exit(main())
