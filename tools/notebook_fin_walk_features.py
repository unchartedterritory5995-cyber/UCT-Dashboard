"""Notebook finish program, lane WALK -- configuration c2's steps (every wave 11-14 switch ON).

Driven by tools/notebook_fin_walk.py (`--config c2`), which owns the sandbox, the recorder and the
per-step instrumentation; this module holds what a member does. It reuses, by import, the chart
drawing helpers of the 13H-2 walk and the tour walker of the W14-Q2 walk, so a check here means
what it meant there.

Trades: the sample notebook seeds none by design, and logging a trade is not a wave 12-15 surface,
so positions and closes go through the member's own API routes (recorded with request and
response). Everything wave 12-15 adds is driven through the page.

Never run on import; running it directly prints how to run the walk.
"""
from __future__ import annotations

import json
import re
import sys
import time
import traceback
from datetime import timedelta
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO / "tools") not in sys.path:
    sys.path.insert(0, str(REPO / "tools"))

import notebook_perf_harness as h  # noqa: E402
import notebook_w14_onboarding_walk as w  # noqa: E402
import notebook_w14q2_tours_walk as q2  # noqa: E402
import notebook_w13h2_walk as h2  # noqa: E402

PW = "LocalTest2026!"
SAMPLE_SYMS = ["AAPL", "MSFT", "NVDA", "GOOGL", "TSLA", "AMZN"]
ORDER = ["firstrun", "sample", "checklist", "offer", "gallery", "formulas", "chartplan", "positions", "board1",
         "earnings", "transcript", "passed", "child", "resurface", "board2", "trades", "grading", "discipline",
         "vplaybook", "playbook", "reviews", "nokey", "layout", "tours1280", "tours390", "remove"]

CHECKLIST_JS = """() => { const hd = [...document.querySelectorAll('h3')].find(e => e.textContent.trim() === 'Get started');
  if (!hd) return null; const card = hd.closest('section');
  const prog = card.querySelector('[class*="progress"]');
  return { progress: prog ? prog.textContent.trim() : null,
           items: [...card.querySelectorAll('li')].map(li => ({ label: li.textContent.trim().replace(/\\s+/g, ' '),
                    done: !!li.querySelector('[class*="doneLabel"]') })) } }"""

MAIN_TEXT_JS = "() => (document.querySelector('[class*=\"_main_\"]') || document.body).innerText.trim().replace(/\\s+/g, ' ').slice(0, 900)"


class Shim:
    """What the 13H-2 helpers expect of their `Walk` object."""
    def __init__(self):
        self.raw = {}


def run_c2(C, browser, admin, base, fs, data_dir, only) -> None:
    S = C.STATE
    cfg = "c2"
    steps = [s for s in ORDER if (not only or s in only)]

    # ── the main member, at 1280 ────────────────────────────────────────────────────────
    if S.get("c2_email"):
        ctx = C.new_ctx(browser, "1280")
        r = ctx.request.post(base + "/api/auth/login", data={"email": S["c2_email"], "password": PW})
        me = ctx.request.get(base + "/api/auth/me").json()
        if r.status not in (200, 201) or not me.get("paid_equiv"):
            raise h.SetupFailed(f"could not re-enter {S['c2_email']} as a paid member (login HTTP {r.status})")
    else:
        ctx, email, me = C.member(browser, admin.request, base, "c2m", "1280")
        S["c2_email"] = email
    inst = C.Inst(ctx, cfg, "1280")
    pg = ctx.new_page()
    M = ctx.request
    flags = {f: me.get(f.lower()) for f in fs["c2"] if f in fs["gates"]}
    C.step(None, inst, "flags", "auth payload: every c2 switch reads ON", "PASS" if all(flags.values()) else "FAIL",
           email=S["c2_email"], off=[k for k, v in flags.items() if not v], shot=False)

    def run(name, fn):
        if name not in steps:
            return
        try:
            fn()
        except h.SetupFailed:
            raise
        except Exception as e:  # noqa: BLE001 -- recorded; the walk goes on
            C.step(pg, inst, name, "driver exception (the step did not finish)", "FAIL",
                   error=f"{type(e).__name__}: {str(e)[:600]}", traceback=traceback.format_exc()[-1600:])

    def home():
        C.goto(pg, base, "/journal/notebook")
        pg.wait_for_timeout(1500)

    def note_json(nid):
        r = M.get(f"{base}/api/j2/notes/{nid}")
        return (r.json().get("note") or {}) if r.status == 200 else {}

    # ── first run ───────────────────────────────────────────────────────────────────────
    def first_run_on(pg_, inst_, ctx_):
        C.goto(pg_, base, "/journal/notebook")
        welcome = C.vis_loc(pg_.get_by_role("heading", name="Welcome to your Notebook", level=2), 30000)
        seen = C.settle_first_run(pg_)
        pg_.wait_for_timeout(1500)
        preview = C.vis_loc(pg_.get_by_role("heading", name="What your Notebook can do"), 10000)
        lines = pg_.evaluate("""() => { const hd = [...document.querySelectorAll('h3')].find(e => e.textContent.trim() === 'What your Notebook can do');
            const sec = hd && hd.closest('section'); return sec ? [...sec.querySelectorAll('li')].map(li => li.textContent.trim().replace(/\\s+/g, ' ')) : [] }""")
        promo = pg_.get_by_text("Want to try it first?").count() > 0
        chk = pg_.evaluate(CHECKLIST_JS)
        ok = welcome and preview and promo and bool(chk) and bool(lines)
        C.step(pg_, inst_, "first run", "welcome, capability preview, sample promotion and Get started list",
               "PASS" if ok else "FAIL", welcome=welcome, base_tour_autostarted=seen["base_tour"], preview=preview,
               preview_lines=lines, promotion=promo, checklist=chk, scope=[w.first_run_root_selector()])

    def firstrun():
        first_run_on(pg, inst, ctx)
        for vp in ("820", "390"):
            c2, email2, _ = C.member(browser, admin.request, base, f"c2f{vp}", vp)
            i2 = C.Inst(c2, cfg, vp)
            p2 = c2.new_page()
            try:
                first_run_on(p2, i2, c2)
            except Exception as e:  # noqa: BLE001
                C.step(p2, i2, "first run", "driver exception", "FAIL", error=str(e)[:400])
            c2.close()
    run("firstrun", firstrun)

    # ── the sample notebook ─────────────────────────────────────────────────────────────
    def sample():
        home()
        C.settle_first_run(pg)
        btn = pg.get_by_role("button", name="Add a sample notebook")
        btn.first.wait_for(state="visible", timeout=20000)
        btn.first.click()
        for _ in range(120):   # the click opens the sample's welcome note; the strip is on Home
            if len(C.notes_list(ctx, base)) >= 5:
                break
            pg.wait_for_timeout(500)
        pg.wait_for_timeout(3000)
        landed = pg.url.split(base)[-1]
        C.step(pg, inst, "sample notebook", "the click lands on the sample's welcome note", "INFO", landed=landed)
        home()
        strip = C.vis_loc(pg.get_by_text("You're looking at the sample notebook"), 60000)
        pg.wait_for_timeout(2500)
        notes = C.notes_list(ctx, base)
        tick = sorted({n.get("ticker") for n in notes if n.get("ticker")})
        st = M.get(base + "/api/j2/onboarding/sample-notebook").json()
        S["sample_ids"] = st.get("ids") or []
        S["sample_titles"] = [n.get("title") for n in notes]
        # an example names its symbol in its title (only three carry a note-level ticker)
        S["sample_by_ticker"] = {sym: next((n.get("id") for n in notes if sym in (n.get("title") or "")), None)
                                 for sym in SAMPLE_SYMS}
        examples = [n.get("title") for n in notes if "example --" in (n.get("title") or "")]
        ok = strip and len(notes) == 10 and len(examples) == 5
        C.step(pg, inst, "sample notebook", "Add a sample notebook: practice notes plus one example per feature",
               "PASS" if ok else "FAIL", strip=strip, notes=len(notes), tickers=tick, recorded_ids=len(S["sample_ids"]),
               titles=S["sample_titles"])
    run("sample", sample)

    # ── the Get started list ────────────────────────────────────────────────────────────
    def checklist():
        home()
        C.settle_first_run(pg)
        c0 = pg.evaluate(CHECKLIST_JS)
        C.step(pg, inst, "get started", "the list after adding the sample", "INFO", checklist=c0)
        if not c0:
            C.step(pg, inst, "get started", "the list is on Research Home", "FAIL", checklist=None)
            return

        def done(label, chk):
            return any(i["done"] and label in i["label"] for i in (chk or {}).get("items", []))

        # open the sample notebook (a real action: open one of its notes)
        sid = (S.get("sample_ids") or [None])[0]
        if sid:
            C.goto(pg, base, f"/journal/notebook?note={sid}", ".ProseMirror")
            pg.wait_for_timeout(1500)
        home()
        c1 = pg.evaluate(CHECKLIST_JS)
        C.step(pg, inst, "get started", "opening a sample note ticks 'Open the sample notebook'",
               "PASS" if done("Open the sample notebook", c1) else "FAIL", checklist=c1)
        # write your first note
        b = pg.get_by_role("button", name="Write your first note")
        if b.count():
            b.first.click()
        else:
            pg.get_by_role("button", name=re.compile(r"^\+?\s*New note$")).first.click()
        pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=60000)
        pg.locator('input[aria-label="Note title"]').first.fill("My first note")
        pg.locator(".ProseMirror").first.click()
        pg.keyboard.type("Watching the leaders into earnings.", delay=15)
        for _ in range(30):
            if any(n.get("title") == "My first note" for n in C.notes_list(ctx, base)):
                break
            pg.wait_for_timeout(500)
        S["first_note"] = next((n["id"] for n in C.notes_list(ctx, base) if n.get("title") == "My first note"), None)
        pg.wait_for_timeout(1500)
        home()
        c2_ = pg.evaluate(CHECKLIST_JS)
        C.step(pg, inst, "get started", "writing a note ticks 'Write your first note'",
               "PASS" if done("Write your first note", c2_) else "FAIL", checklist=c2_, note=S.get("first_note"),
               was_already_done=done("Write your first note", c1))
        # start a note from a template
        link = pg.get_by_role("link", name="Start a note from a template")
        tpl_err, tpl_note = None, None
        try:
            if link.count():
                link.first.click()
            else:
                C.goto(pg, base, "/journal/notebook?view=all")
                pg.get_by_role("button", name="Templates", exact=True).first.click()
            pg.wait_for_timeout(2500)
            card = pg.locator("[data-template-key]").filter(visible=True).first
            if not card.count():
                # the list's link lands on All notes; the templates are one press further (Templates)
                pg.get_by_role("button", name="Templates", exact=True).filter(visible=True).first.click()
            card.wait_for(state="visible", timeout=20000)
            key = card.get_attribute("data-template-key")
            card.click()
            pg.wait_for_timeout(800)
            use = pg.get_by_role("button", name="Use this template")
            if use.count() and use.first.is_visible():
                use.first.click()
            pg.wait_for_url(lambda u: "note=" in u, timeout=30000)
            tpl_note = pg.url.split("note=")[-1].split("&")[0]
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            pg.wait_for_timeout(1500)
            S["template_key"] = key
        except Exception as e:  # noqa: BLE001
            tpl_err = str(e)[:300]
        home()
        c3 = pg.evaluate(CHECKLIST_JS)
        C.step(pg, inst, "get started", "starting a note from a template ticks its step",
               "PASS" if done("Start a note from a template", c3) else "FAIL", checklist=c3, template_note=tpl_note,
               template_key=S.get("template_key"), reach_error=tpl_err)
        pg.reload(wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pg.wait_for_timeout(3000)
        c4 = pg.evaluate(CHECKLIST_JS)
        same = bool(c3) and bool(c4) and [i for i in c3["items"] if i["done"]] == [i for i in c4["items"] if i["done"]]
        C.step(pg, inst, "get started", "ticks survive a reload", "PASS" if same and c4 and any(i["done"] for i in c4["items"]) else "FAIL",
               before=c3, after=c4)
        hide = pg.get_by_role("button", name="Hide the get started list")
        hide.first.click()
        pg.wait_for_timeout(1500)
        gone1 = pg.evaluate(CHECKLIST_JS) is None
        pg.reload(wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pg.wait_for_timeout(3000)
        gone2 = pg.evaluate(CHECKLIST_JS) is None
        C.step(pg, inst, "get started", "Hide removes the list and it stays hidden after a reload",
               "PASS" if gone1 and gone2 else "FAIL", hidden_at_once=gone1, hidden_after_reload=gone2,
               pref=w.prefs_of(ctx, base).get("notebook_getting_started"))
    run("checklist", checklist)

    # ── the one-time offer, What's new, Walkthroughs ─────────────────────────────────────
    def offer():
        home()
        offer_ = pg.locator("[data-tour-offer]")
        for _ in range(24):
            if offer_.count():
                break
            if pg.evaluate(w.STAGE_JS)["slotOthers"]:
                try:
                    pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=2000)
                except Exception:  # noqa: BLE001
                    pass
            pg.wait_for_timeout(500)
        shown = C.vis_loc(offer_, 8000)
        title = offer_.first.locator("h2").inner_text() if shown else None
        focus_in = pg.evaluate("() => { const o = document.querySelector('[data-tour-offer]'); return !!(o && o.contains(document.activeElement)) }")
        C.step(pg, inst, "offer", "the one-time tour offer appears on Home, without taking focus",
               "PASS" if shown and not focus_in else "FAIL", title=title, took_focus=focus_in, stage=pg.evaluate(w.STAGE_JS),
               scope=["[data-tour-offer]"])
        if shown:
            later = offer_.first.get_by_role("button", name="Not now")
            later.focus()
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(1500)
            hidden = offer_.count() == 0
            pg.reload(wait_until="domcontentloaded")
            h._dismiss_intro(pg)
            pg.wait_for_timeout(4000)
            C.step(pg, inst, "offer", "Not now hides it; no second offer in the same session after a reload",
                   "PASS" if hidden and offer_.count() == 0 else "FAIL", hidden=hidden, offers_after_reload=offer_.count(),
                   notebook_tours=w.prefs_of(ctx, base).get("notebook_tours"))
        C.goto(pg, base, "/support")
        C.vis_loc(pg.get_by_role("link", name="Replay", exact=True), 20000)
        rows = [x.replace("Replay", "").strip() for x in
                pg.locator("li", has=pg.get_by_role("link", name="Replay", exact=True)).all_inner_texts()]
        registry = q2.read_registry()
        want = [t["title"] for t in registry if t["replayable"]]
        missing = [t for t in want if not any(t in r for r in rows)]
        wn = pg.locator("section[aria-labelledby='support-whats-new']")
        starts = [a.get_attribute("aria-label") for a in wn.first.get_by_role("link").all()] if wn.count() else []
        C.step(pg, inst, "help", "Walkthroughs lists the base tour and every replayable feature tour",
               "PASS" if not missing and len(rows) == len(want) + 1 else "FAIL", listed=rows, expected=want, missing=missing,
               scope=["ul:has(> li > a[href*='notebook'])"])
        C.step(pg, inst, "help", "What's new lists the tours not taken yet", "PASS" if wn.count() and starts else "FAIL",
               starts=starts, count=len(starts), scope=["section[aria-labelledby='support-whats-new']"])
    run("offer", offer)

    # ── template gallery ────────────────────────────────────────────────────────────────
    def gallery():
        C.goto(pg, base, "/journal/notebook?view=all")
        pg.get_by_role("button", name="Templates", exact=True).first.click()
        door = pg.get_by_role("button", name="Browse the community gallery")
        door.first.wait_for(state="visible", timeout=20000)
        door.first.click()
        opened = C.vis_loc(pg.get_by_role("heading", name="Community gallery"), 20000)
        pg.wait_for_timeout(1500)
        picks = M.get(base + "/api/j2/template-gallery?section=picks").json().get("templates") or []
        regions = {r: pg.get_by_role("region", name=r).count() for r in ("UCT picks", "Community")}
        C.step(pg, inst, "template gallery", "browse: the gallery opens from the template picker",
               "PASS" if opened and picks else "FAIL", opened=opened, picks=[p.get("title") or p.get("name") for p in picks][:12],
               regions=regions, scope=["[role=dialog]"])
        # insert: preview a UCT pick, add it, make a note from it
        if picks:
            title = picks[0].get("title") or picks[0].get("name")
            made, added, err = None, False, None
            try:
                pg.get_by_role("button", name=f"Preview {title}").first.click(timeout=10000)
                dlg = pg.get_by_role("dialog", name=title)
                dlg.first.wait_for(state="visible", timeout=15000)
                use = pg.get_by_role("button", name="Use this template")
                use.first.click(timeout=10000)
                added = C.vis_loc(pg.get_by_text(f"Added “{title}” to Your templates."), 15000)
                mk = pg.get_by_role("button", name="Make a note from it")
                if C.vis_loc(mk, 8000):
                    mk.first.click()
                    pg.wait_for_url(lambda u: "note=" in u, timeout=30000)
                    made = pg.url.split("note=")[-1].split("&")[0]
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
            except Exception as e:  # noqa: BLE001
                err = str(e)[:300]
            body_len = len(json.dumps(note_json(made).get("bodyJson") or {})) if made else 0
            C.step(pg, inst, "template gallery", "insert: use a UCT pick and make a note from it",
                   "PASS" if added and made and body_len > 200 else "FAIL", pick=title, added_to_your_templates=added, note=made,
                   note_body_chars=body_len, reach_error=err)
        # publish for review: a member template made from the member's own note (the note's own route)
        src = S.get("first_note") or (C.notes_list(ctx, base)[0]["id"])
        name = f"Fin walk plan {int(time.time()) % 100000}"
        st, tpl = C.api(ctx, inst, "POST", base, "/api/j2/note-templates", {"noteId": src, "name": name})
        C.goto(pg, base, "/journal/notebook?view=all")
        pg.get_by_role("button", name="Templates", exact=True).first.click()
        sent, perr = False, None
        try:
            share = pg.get_by_role("button", name=f"Share {name} to the community gallery")
            share.first.wait_for(state="visible", timeout=20000)
            share.first.click()
            form = pg.get_by_role("form", name=f"Share {name} to the community gallery")
            form.get_by_label("What it's for (optional)").fill("A weekly plan layout.")
            form.get_by_label("Category").select_option(index=1)
            form.get_by_role("button", name="Submit for review").click()
            sent = C.vis_loc(pg.get_by_text("for review. You'll see it under Your submissions"), 20000)
        except Exception as e:  # noqa: BLE001
            perr = str(e)[:300]
        mine = M.get(base + "/api/j2/template-gallery?section=mine").json().get("templates") or []
        row = next((t for t in mine if (t.get("title") or t.get("name")) == name), None)
        listed_before = [t.get("id") for t in (M.get(base + "/api/j2/template-gallery").json().get("templates") or [])]
        C.step(pg, inst, "template gallery", "publish for review: submitted, pending, not listed yet",
               "PASS" if sent and row and row.get("id") not in listed_before else "FAIL", template_api=st, sent=sent,
               submission={k: (row or {}).get(k) for k in ("id", "status", "title")}, reach_error=perr)
        if row:
            a_inst = C.Inst(admin, cfg, "1280")
            a_st, a_body = C.api(admin, a_inst, "GET", base, "/api/j2/template-gallery/admin/queue")
            S["gallery_submission"] = row.get("id")
            C.step(None, inst, "template gallery", "the admin review queue holds the submission", "PASS" if a_st == 200 and row.get("id") in json.dumps(a_body) else "FAIL",
                   queue_status=a_st, shot=False)
    run("gallery", gallery)

    # ── formulas ────────────────────────────────────────────────────────────────────────
    def formulas():
        st, body = C.api(ctx, inst, "POST", base, "/api/j2/notes", {"title": "Formula walk", "bodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Breakout over the pivot."}]}]}})
        nid = body["note"]["id"]
        S["formula_note"] = nid
        C.goto(pg, base, f"/journal/notebook?note={nid}", ".ProseMirror")

        def new_prop():
            pg.get_by_role("button", name="Add property").filter(visible=True).first.click()
            pg.get_by_role("button", name="+ New property…").filter(visible=True).first.click()
            pg.get_by_role("textbox", name="Property name").wait_for(state="visible", timeout=8000)

        for nm, val in (("Entry", 100), ("Stop", 95), ("Target", 115), ("Exit", 110)):
            new_prop()
            pg.get_by_role("textbox", name="Property name").fill(nm)
            pg.get_by_role("combobox", name="Property type").select_option(label="Number")
            pg.get_by_role("button", name="Create").click()
            row_ = pg.locator("li[data-prop-row]").filter(has_text=nm).first
            row_.wait_for(state="visible", timeout=10000)
            box = row_.locator("input").first
            box.fill(str(val))
            pg.keyboard.press("Enter")
            pg.wait_for_timeout(400)
        new_prop()
        types = [t.strip() for t in pg.get_by_role("combobox", name="Property type").locator("option").all_inner_texts()]
        pg.get_by_role("combobox", name="Property type").select_option(label="Formula")
        starter = pg.get_by_role("combobox", name="Start from a trader formula")
        starter.wait_for(state="visible", timeout=8000)
        starters = [t.strip() for t in starter.locator("option").all_inner_texts()]
        starter.select_option(label=next(s for s in starters if s.startswith("R-multiple")))
        nm_box = pg.get_by_role("textbox", name="Property name")
        if not nm_box.input_value():
            nm_box.fill("R-multiple")
        formula_text = pg.get_by_role("textbox", name="Formula").input_value()
        pg.get_by_role("button", name="Create").click()
        frow = pg.locator("li[data-prop-row]").filter(has_text="R-multiple").first
        frow.wait_for(state="visible", timeout=10000)
        pg.wait_for_timeout(2000)
        shown = frow.inner_text().replace("\n", " ")
        props = M.get(f"{base}/api/j2/notes/{nid}/properties").json().get("properties") or []
        rm = next((p for p in props if p.get("name") == "R-multiple"), {})
        ok = "2" in shown and rm.get("type") == "formula"
        C.step(pg, inst, "formulas", "a formula property (R-multiple from four numbers) computes on the note",
               "PASS" if ok else "FAIL", property_types=types, starters=starters, formula=formula_text, row_text=shown[:160],
               stored={k: rm.get(k) for k in ("type", "value", "formula")}, scope=["li[data-prop-row]"])
    run("formulas", formulas)

    # ── chart plan drawn in a note ──────────────────────────────────────────────────────
    def chartplan():
        st, body = C.api(ctx, inst, "POST", base, "/api/j2/notes", {"title": "AMD plan", "ticker": "AMD", "bodyJson": {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "The plan:"}]}]}})
        nid = body["note"]["id"]
        S["amd_note"] = nid
        sh = Shim()
        h2.open_note(pg, base, nid)
        h2.type_slash(pg, "/chart AMD", re.compile(r"^Chart — AMD"), False)
        frame = h2.frame_of(pg, 0)
        frame.wait_for(state="visible", timeout=30000)
        stored, ok1 = h2.wait_stored(M, base, nid, lambda e: any((a.get("params") or {}).get("symbol") == "AMD" for a in e))
        chart = next((a for a in stored or [] if (a.get("params") or {}).get("symbol") == "AMD"), {})
        embed_id = chart.get("embedId")
        _, archived = h2.wait_stored(M, base, nid, lambda e: bool((e[0].get("fallback") or {}).get("url")), timeout_s=30)
        pg.wait_for_timeout(1000)
        bars_err = frame.get_by_text("Couldn't load bars").count()
        C.step(pg, inst, "chart plan", "insert a chart into a note with /chart", "PASS" if ok1 and embed_id and not bars_err else "FAIL",
               embed=embed_id, params=chart.get("params"), snapshot_archived=archived, bars_error=bars_err,
               scope=['[data-widget-embed-view="chart"]'])
        placed = h2.draw_three_lines(pg, frame, False, sh, "c2", req=M, base=base, nid=nid)
        stored, drew = h2.wait_stored(M, base, nid, lambda e: len([d for d in (e[0].get("annotations") or []) if d.get("type") == "horizontal"]) >= 3)
        h2.press(h2.toolbar_button(pg, frame, "Plan", False), False)
        panel = pg.locator("[data-chart-plan-panel]").first
        panel.wait_for(state="visible", timeout=30000)
        rows = panel.locator("li[data-level-id]")
        rows.nth(2).wait_for(state="visible", timeout=20000)
        for i, role in ((0, "target"), (1, "entry"), (2, "stop")):
            h2.press(rows.nth(i).locator(f'[data-role="{role}"]'), False)
            pg.wait_for_timeout(300)
        stored, roled = h2.wait_stored(M, base, nid, lambda e: sorted(d.get("role") for d in (e[0].get("annotations") or []) if d.get("role")) == ["entry", "stop", "target"])
        by_role = {d["role"]: d for d in (stored[0].get("annotations") or []) if d.get("role")} if stored else {}
        price = lambda d: ((d or {}).get("points") or [{}])[0].get("price")  # noqa: E731
        prices = {r: price(d) for r, d in by_role.items()}
        ordered = (prices.get("target") or 0) > (prices.get("entry") or 0) > (prices.get("stop") or 0)
        S["amd_plan"] = prices
        S["amd_embed"] = embed_id
        C.step(pg, inst, "chart plan", "draw entry, stop and target on the chart and mark their roles",
               "PASS" if placed == 3 and drew and roled and ordered else "FAIL", lines_placed=placed, stored=drew, roles_stored=roled,
               prices=prices, target_over_entry_over_stop=ordered, draw_raw=sh.raw.get("c2_lines_after_tap"),
               scope=["[data-chart-plan-panel]"])
        try:
            pg.wait_for_function("() => { const e = document.querySelector('[data-plan-value=\"shares\"]'); return e && e.textContent.trim() !== '—' }", timeout=30000)
        except Exception:  # noqa: BLE001
            pass
        vals = {k: (panel.locator(f'[data-plan-value="{k}"]').first.inner_text() if panel.locator(f'[data-plan-value="{k}"]').count() else None)
                for k in ("rr", "rps", "acct", "shares")}
        label = panel.locator("[data-sized-by]").first.inner_text() if panel.locator("[data-sized-by]").count() else None
        C.step(pg, inst, "chart plan", "sizing: R:R, risk per share and shares, with the sizing label",
               "PASS" if vals.get("rr") and vals.get("shares") and label else "FAIL", values=vals, label=label,
               panel_text=panel.inner_text()[:500], scope=["[data-chart-plan-panel]"])
        stop_row = rows.nth(2)
        armed, aerr = False, None
        try:
            h2.press(stop_row.get_by_role("button", name=re.compile(r"^Arm alert at this level")).first, False)
            armed = C.vis_loc(stop_row.get_by_text("Alert armed"), 30000)
        except Exception as e:  # noqa: BLE001
            aerr = str(e)[:300]
        alerts = M.get(base + "/api/watchlist-alerts").json()
        want = f"nb:{embed_id}:{by_role.get('stop', {}).get('id')}"
        hit = next((a for a in alerts if a.get("drawing_id") == want), None) if isinstance(alerts, list) else None
        C.step(pg, inst, "chart plan", "arm an alert at the stop: listed in the member's alerts",
               "PASS" if armed and hit and hit.get("sym") == "AMD" else "FAIL", armed_in_panel=armed,
               alert={k: (hit or {}).get(k) for k in ("sym", "direction", "target_price", "drawing_id")}, reach_error=aerr,
               scope=["[data-chart-plan-panel]"])
    run("chartplan", chartplan)

    # ── positions: entry context, thesis chips ──────────────────────────────────────────
    def positions():
        plan = S.get("amd_plan") or {}
        entry = round(float(plan.get("entry") or 150.0), 2)
        stop = round(float(plan.get("stop") or entry * 0.95), 2)
        wl_s, wl = C.api(ctx, inst, "POST", base, "/api/watchlists", {"name": "This week"})
        wl_id = (wl or {}).get("id") if isinstance(wl, dict) else None
        if wl_id:
            C.api(ctx, inst, "POST", base, f"/api/watchlists/{wl_id}/items", {"sym": "AMZN"})
        s1, p1 = C.api(ctx, inst, "POST", base, "/api/j2/positions", {"symbol": "AMD", "side": "Long", "shares": 40, "entryPrice": entry,
                                                                     "stopPrice": stop, "entryDate": C.TODAY.isoformat(), "setup": "VCP"})
        s2, p2 = C.api(ctx, inst, "POST", base, "/api/j2/positions", {"symbol": "NVDA", "side": "Long", "shares": 30, "entryPrice": 121.0,
                                                                     "stopPrice": 110.0, "entryDate": C.TODAY.isoformat()})
        S["amd_pos"], S["nvda_pos"] = (p1 or {}).get("id"), (p2 or {}).get("id")
        C.step(None, inst, "setup", "two open positions through the member's own API (AMD against the drawn plan, NVDA)",
               "PASS" if s1 in (200, 201) and s2 in (200, 201) else "FAIL", amd=s1, nvda=s2, entry=entry, stop=stop, shot=False)
        C.goto(pg, base, "/journal-2-0/position/AMD")
        card = pg.locator('[data-testid="entry-context-card"]')
        present = C.vis_loc(card, 30000)
        pg.wait_for_timeout(2500)
        text = card.first.inner_text()[:600] if present else None
        why = pg.locator('[data-testid="entry-context-card"] textarea')
        saved_why = None
        if present and why.count():
            why.first.fill("Tight base, volume dried up, entered over the pivot.")
            sv = card.get_by_role("button", name=re.compile(r"^Save"))
            if sv.count():
                sv.first.click()
                pg.wait_for_timeout(2000)
                saved_why = M.get(base + f"/api/j2/entry-context/positions/{S['amd_pos']}").status
        C.step(pg, inst, "entry context", "the card on the position page: the market at the fill, and why you took it",
               "PASS" if present and text and "Regime" in text else "FAIL", present=present, card_text=text, why_box=why.count(),
               scope=['[data-testid="entry-context-card"]'])
        C.goto(pg, base, "/journal?j2tab=positions")
        chips = pg.locator("[data-thesis-chip]")
        has = C.vis_loc(chips, 30000)
        info = pg.evaluate("() => [...document.querySelectorAll('[data-thesis-chip]')].map(e => ({ note: e.getAttribute('data-thesis-chip'), text: e.innerText.trim().replace(/\\s+/g, ' ').slice(0, 120), row: (e.closest('tr') || e.parentElement).innerText.trim().replace(/\\s+/g, ' ').slice(0, 60) }))")
        nvda_note = (S.get("sample_by_ticker") or {}).get("NVDA")
        on_nvda = any(c["note"] == nvda_note for c in info)
        opened = None
        if has:
            try:
                chips.first.hover()
                btn = chips.first.locator("button")
                if btn.count():
                    btn.first.click()
                pg.wait_for_timeout(800)
                opened = chips.first.locator('a[href*="note="]').count()
            except Exception as e:  # noqa: BLE001
                opened = str(e)[:120]
        C.step(pg, inst, "thesis chips", "Open Positions rows carry a chip for a stock the member wrote a thesis on",
               "PASS" if has and on_nvda else "FAIL", chips=info, nvda_thesis_note=nvda_note, preview_link=opened,
               scope=["[data-thesis-chip]"])
    run("positions", positions)

    # ── the setups board (before any overnight run) ─────────────────────────────────────
    def board(tag):
        C.goto(pg, base, "/journal/notebook/setups")
        hd = C.vis_loc(pg.get_by_role("heading", name="Active setups"), 60000)
        C.vis(pg, "[data-board-card]", 30000)
        pg.wait_for_timeout(2500)
        cards = pg.locator("[data-board-card]").evaluate_all("els => els.map(e => e.getAttribute('data-board-card'))")
        C.step(pg, inst, "setups board", f"the board lists the open chart plans ({tag})", "PASS" if hd and cards else "FAIL",
               cards=cards, page_text=pg.evaluate(MAIN_TEXT_JS)[:400], scope=["[data-board-card]"])
        sym = "MSFT" if "MSFT" in cards else (cards[0] if cards else None)
        if not sym:
            return
        btn = pg.get_by_role("button", name=f"Find more like {sym}", exact=True)
        text, err = None, None
        try:
            btn.first.click(timeout=15000)
            pg.wait_for_timeout(4000)
            dl = pg.locator("[role=dialog]").last
            text = dl.inner_text()[:600] if dl.count() else pg.evaluate(MAIN_TEXT_JS)
        except Exception as e:  # noqa: BLE001
            err = str(e)[:300]
        matches = pg.locator("[data-match]").count()
        if tag == "before the first overnight run":
            verdict = "PASS" if text and not matches else "FAIL"
            name = "find similar before the first overnight run: an honest 'nothing yet', not an error"
        else:
            verdict = "PASS" if matches and "CRWD" in (text or "") else "FAIL"
            name = "find similar after the overnight run: the matching name is listed"
        C.step(pg, inst, "find similar", name, verdict, symbol=sym, matches=matches, sheet_text=text, reach_error=err,
               scope=["[role=dialog]"])
        pg.keyboard.press("Escape")
    run("board1", lambda: board("before the first overnight run"))

    # ── earnings prep ───────────────────────────────────────────────────────────────────
    def earnings():
        home()
        box = pg.locator("[data-reporting-soon]")
        present = C.vis_loc(box, 30000)
        pg.wait_for_timeout(2500)
        text = box.first.inner_text()[:400] if present else None
        C.step(pg, inst, "earnings prep", "Reporting soon lists the member's stock that reports this week",
               "PASS" if present and "AMZN" in (text or "") else "FAIL", box_text=text, report_day=S.get("report_day"),
               scope=["[data-reporting-soon]"])
        btn = pg.get_by_role("button", name="Create prep note for AMZN")
        made, body, err = None, "", None
        try:
            btn.first.click(timeout=15000)
            pg.wait_for_url("**/journal/notebook?note=*", timeout=45000)
            pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=20000)
            made = pg.url.split("note=")[-1].split("&")[0]
            n = note_json(made)
            body = json.dumps(n.get("bodyJson") or {})
        except Exception as e:  # noqa: BLE001
            err = str(e)[:300]
        sources = sorted(set(re.findall(r"Source: [^\"\\\\]{3,60}", body)))[:8]
        C.step(pg, inst, "earnings prep", "one click builds the prep note, each part naming its source",
               "PASS" if made and sources else "FAIL", note=made, source_lines=sources, body_chars=len(body), reach_error=err,
               note_text=(pg.locator(".ProseMirror").first.inner_text()[:700] if made else None))
        S["prep_note"] = made
    run("earnings", earnings)

    # ── transcript passage capture ──────────────────────────────────────────────────────
    def transcript():
        C.goto(pg, base, "/journal/notebook/research/TSLA")
        door = pg.get_by_role("button", name="Save from a transcript")
        there = C.vis_loc(door, 60000)
        cited, err, opt = None, None, None
        if there:
            try:
                door.first.click()
                sheet = pg.locator("[data-save-transcript]")
                sheet.first.wait_for(state="visible", timeout=30000)
                pg.get_by_role("button", name="Quote from turn 2").wait_for(state="visible", timeout=30000)
                opt = pg.get_by_role("combobox", name="Call quarter").evaluate("(s) => s.options[s.selectedIndex].textContent")
                pg.get_by_role("button", name="Quote from turn 2").click()
                boxp = pg.get_by_label("Passage from turn 2", exact=False)
                boxp.fill("Automotive gross margin excluding credits was 17.1%")
                pg.get_by_role("button", name="Save passage").click()
                done = pg.locator("[data-saved-excerpt]")
                done.first.wait_for(state="visible", timeout=30000)
                cited = done.first.inner_text()[:300]
            except Exception as e:  # noqa: BLE001
                err = str(e)[:300]
        tsla = (S.get("sample_by_ticker") or {}).get("TSLA")
        exs = []
        for n in C.notes_list(ctx, base):
            if n.get("ticker") == "TSLA":
                r = M.get(f"{base}/api/j2/notes/{n['id']}/excerpts")
                if r.status == 200:
                    exs += [{"note": n["id"], "quote": (e.get("quote") or e.get("text") or "")[:80]} for e in (r.json().get("excerpts") or [])]
        C.step(pg, inst, "transcript capture", "select a passage from a saved call and save it as a cited quote",
               "PASS" if cited and any("17.1%" in e["quote"] for e in exs) else "FAIL", door=there, quarter=opt, cited=cited,
               stored_excerpts=exs[:6], sample_tsla_note=tsla, reach_error=err, scope=["[data-save-transcript]"])
    run("transcript", transcript)

    # ── passed setups ───────────────────────────────────────────────────────────────────
    def passed():
        home()
        box = pg.locator("[data-passed-setups]")
        present = C.vis_loc(box, 30000)
        pg.wait_for_timeout(2000)
        rows = pg.evaluate("() => [...document.querySelectorAll('[data-passed-symbol]')].map(e => ({ sym: e.getAttribute('data-passed-symbol'), text: e.innerText.trim().replace(/\\s+/g, ' ').slice(0, 160) }))")
        C.step(pg, inst, "passed setups", "the list on Research Home shows the passed name and how it moved since",
               "PASS" if present and any(r["sym"] == "GOOGL" for r in rows) else "FAIL", rows=rows, scope=["[data-passed-setups]"])
        day = C.TODAY - timedelta(days=35)
        while day.weekday() >= 5:
            day -= timedelta(days=1)
        added, removed, err = False, False, None
        try:
            tick = pg.get_by_label("Ticker you passed on")
            tick.first.fill("IBM")
            pg.get_by_label("Day you passed on it").first.fill(day.isoformat())
            tick.first.focus()
            pg.keyboard.press("Enter")
            added = C.vis(pg, '[data-passed-symbol="IBM"]', 30000)
            row_text = pg.locator('[data-passed-symbol="IBM"]').first.inner_text().replace("\n", " ")[:200] if added else None
            C.step(pg, inst, "passed setups", "add a name you passed on: scored from the day you passed", "PASS" if added else "FAIL",
                   row_text=row_text, day=day.isoformat(), scope=["[data-passed-setups]"])
            pg.get_by_role("button", name="Remove IBM from passed setups").first.click()
            pg.wait_for_timeout(2500)
            removed = pg.locator('[data-passed-symbol="IBM"]').count() == 0
            C.step(pg, inst, "passed setups", "remove it again", "PASS" if removed else "FAIL", scope=["[data-passed-setups]"])
        except Exception as e:  # noqa: BLE001
            C.step(pg, inst, "passed setups", "add and remove a passed name", "FAIL", added=added, reach_error=str(e)[:300])
    run("passed", passed)

    # ── the two overnight jobs and one awareness scan, in a child process ────────────────
    def child():
        plan = S.get("amd_plan") or {}
        entry, stop = float(plan.get("entry") or 150.0), float(plan.get("stop") or 142.0)
        spec = {"email": S["c2_email"], "today": C.TODAY.isoformat(), "flags": fs["c2"], "template_symbol": "MSFT",
                "candidate": "CRWD", "project_note_ids": [S.get("amd_note")], "resurface_symbol": "AMD",
                "quotes": [["above the stop", round((entry + stop) / 2, 2)], ["through the stop", round(stop * 0.99, 2)]]}
        out = C.run_post_child(Path(S["data_dir"]), C.OUT, spec)
        S["post_child"] = out
        scans = out.get("scans") or []
        crossed = scans[-1] if scans else {}
        lv = next((x for x in crossed.get("levels", []) if x.get("note_id") == S.get("amd_note") and x.get("role") == "stop"), {})
        S["resurface_version"] = lv.get("version_id")
        S["resurface_insights"] = crossed.get("insights")
        ok = not out.get("error") and bool((out.get("nightly") or {}).get("ran", (out.get("nightly") or {}).get("rows"))) and bool(crossed.get("insights"))
        C.step(None, inst, "overnight jobs", "find-similar precompute, passed-setups refresh and one awareness scan (child process, sandbox data)",
               "PASS" if ok else "FAIL", result=json.dumps(out, default=str)[:1800], shot=False)
    run("child", child)

    # ── resurfacing ─────────────────────────────────────────────────────────────────────
    def resurface():
        ins = M.get(base + "/api/voice/insights")
        items = ins.json() if ins.status == 200 else None
        listed = json.dumps(items, default=str)[:700] if items is not None else None
        door, opened, err = None, False, None
        home()
        try:
            bell = pg.get_by_role("button", name="Notifications")
            if bell.count():
                bell.first.click()
                pg.wait_for_timeout(1500)
                item = pg.get_by_text(re.compile(r"AMD.*(stop|reached|named)", re.I))
                if item.count():
                    door = "Notifications bell: " + item.first.inner_text()[:100]
                    item.first.click()
                    pg.wait_for_timeout(2500)
        except Exception as e:  # noqa: BLE001
            err = str(e)[:200]
        sheet = pg.get_by_role("dialog", name="What you wrote then")
        if not sheet.count():
            vid = S.get("resurface_version")
            if vid:
                C.goto(pg, base, f"/journal/notebook?note={S['amd_note']}&resurfaceVersion={vid}")
                door = (door or "") + " | direct link with resurfaceVersion (the notice's own target)"
        opened = C.vis_loc(sheet, 30000)
        text = sheet.first.inner_text()[:600] if opened else None
        C.step(pg, inst, "note resurfacing", "a notice for the crossed stop opens the note at 'What you wrote then'",
               "PASS" if opened and S.get("resurface_insights") else "FAIL", insights_api_status=ins.status, insights=listed,
               scan_insights=S.get("resurface_insights"), door=door, sheet_text=text, reach_error=err,
               explainer=pg.locator("[data-tour-explainer]").count(), scope=["[role=dialog]"])
        pg.keyboard.press("Escape")
    run("resurface", resurface)

    run("board2", lambda: board("after the overnight run"))

    # ── close the planned trade; one unplanned trade ────────────────────────────────────
    def trades():
        plan = S.get("amd_plan") or {}
        target = round(float(plan.get("target") or 160.0), 2)
        s1, tr = C.api(ctx, inst, "POST", base, f"/api/j2/positions/{S['amd_pos']}/close", {"shares": 40, "exitPrice": target, "exitDate": C.TODAY.isoformat()})
        S["amd_trade"] = ((tr.get("trade") or tr) if isinstance(tr, dict) else {}).get("id")
        s2, p2 = C.api(ctx, inst, "POST", base, "/api/j2/positions", {"symbol": "IBM", "side": "Long", "shares": 10, "entryPrice": 200.0,
                                                                     "stopPrice": 190.0, "entryDate": C.TODAY.isoformat()})
        s3, t2 = C.api(ctx, inst, "POST", base, f"/api/j2/positions/{(p2 or {}).get('id')}/close", {"shares": 10, "exitPrice": 196.0, "exitDate": C.TODAY.isoformat()})
        S["ibm_trade"] = ((t2.get("trade") or t2) if isinstance(t2, dict) else {}).get("id")
        C.step(None, inst, "setup", "the AMD position closed at its target; one IBM trade with no plan (member API)",
               "PASS" if S.get("amd_trade") and S.get("ibm_trade") else "FAIL", amd_close=s1, ibm_close=s3, shot=False)
    run("trades", trades)

    def grading():
        tid = S["amd_trade"]
        g = M.get(base + f"/api/j2/plan-grades/trades/{tid}")
        gj = g.json() if g.status == 200 else {"status": g.status}
        C.goto(pg, base, f"/journal-2-0/trade/{tid}")
        card = pg.locator('[data-testid="plan-grade-card"]')
        present = C.vis_loc(card, 30000)
        try:
            card.get_by_test_id("plan-grade-loading").wait_for(state="detached", timeout=30000)
        except Exception:  # noqa: BLE001
            pass
        text = card.first.inner_text()[:700] if present else None
        checks = card.locator("[data-check]").count() if present else 0
        C.step(pg, inst, "plan grading", "the closed trade is matched to the plan drawn before it and graded on four checks",
               "PASS" if present and gj.get("status") == "planned" and checks >= 3 else "FAIL", api_status=gj.get("status"),
               api_checks={k: (gj.get("checks") or {}).get(k, {}).get("state") for k in ("entry", "stop", "size", "target")},
               checks_rendered=checks, card_text=text, scope=['[data-testid="plan-grade-card"]'])
        ec = pg.locator('[data-testid="entry-context-card"]')
        ba = pg.locator('[data-testid="trade-before-after"]')
        ec_ok, ba_ok = C.vis_loc(ec, 15000), C.vis_loc(ba, 15000)
        C.step(pg, inst, "entry context", "the same card persists on the closed trade's page", "PASS" if ec_ok else "FAIL",
               card_text=(ec.first.inner_text()[:400] if ec_ok else None), scope=['[data-testid="entry-context-card"]'])
        C.step(pg, inst, "visual playbook", "the trade page's before and after charts", "PASS" if ba_ok else "FAIL",
               text=(ba.first.inner_text()[:300] if ba_ok else None), scope=['[data-testid="trade-before-after"]'])
        C.goto(pg, base, "/journal/trades?seg=closed")
        chip = C.vis_loc(pg.get_by_test_id("unplanned-chip"), 30000)
        C.goto(pg, base, f"/journal-2-0/trade/{S['ibm_trade']}")
        badge = C.vis_loc(pg.get_by_test_id("plan-grade-unplanned"), 30000)
        C.step(pg, inst, "plan grading", "a trade with no plan is labelled Unplanned in the trades table and on its page",
               "PASS" if chip and badge else "FAIL", chip_in_table=chip, badge_on_page=badge)
    run("grading", grading)

    def discipline():
        C.goto(pg, base, "/journal/insights?ins=discipline")
        rec_ = pg.get_by_test_id("discipline-record")
        present = C.vis_loc(rec_, 30000)
        text = rec_.first.inner_text()[:600] if present else None
        tab = pg.get_by_role("button", name="Discipline", exact=True).count()
        C.step(pg, inst, "plan grading", "Insights has a Discipline tab with the record over recent trades",
               "PASS" if present and tab else "FAIL", tab=tab, record_text=text, scope=['[data-testid="discipline-record"]'])
    run("discipline", discipline)

    # ── the visual playbook ─────────────────────────────────────────────────────────────
    def vplaybook():
        nid = (S.get("sample_by_ticker") or {}).get("AAPL") or S.get("amd_note")
        C.goto(pg, base, f"/journal/notebook?note={nid}", ".ProseMirror")
        panel = pg.locator('[data-testid="fingerprint-panel"]')
        fp = C.vis_loc(panel, 30000)
        fp_text = panel.first.inner_text()[:400] if fp else None
        tag = None
        if fp:
            sel = panel.first.locator('select[id^="fp-tag-"]')
            tag = sel.first.input_value() if sel.count() else None
        C.step(pg, inst, "technical fingerprint", "the chart's technical shape on the plan note, with its setup tag",
               "PASS" if fp else "FAIL", panel_text=fp_text, setup_tag=tag, scope=['[data-testid="fingerprint-panel"]'])
        opened, cards, err = False, 0, None
        try:
            door = pg.get_by_role("button", name="Visual playbook")
            door.first.scroll_into_view_if_needed(timeout=10000)
            door.first.click(timeout=10000)
            vp_ = pg.locator('[data-testid="visual-playbook"]')
            opened = C.vis_loc(vp_, 30000)
            pg.wait_for_timeout(2500)
            cards = pg.locator('[data-testid="playbook-card"]').count()
        except Exception as e:  # noqa: BLE001
            err = str(e)[:300]
        text = pg.locator('[data-testid="visual-playbook"]').first.inner_text()[:500] if opened else None
        C.step(pg, inst, "visual playbook", "the gallery of every tagged chart opens from the fingerprint panel",
               "PASS" if opened and cards else "FAIL", opened=opened, cards=cards, gallery_text=text, reach_error=err,
               scope=['[data-testid="visual-playbook"]'])
        pg.keyboard.press("Escape")
    run("vplaybook", vplaybook)

    def playbook():
        C.goto(pg, base, "/journal/insights")
        door = pg.get_by_test_id("open-my-playbook")
        there = C.vis_loc(door, 30000)
        if there:
            door.first.click()
        else:
            C.goto(pg, base, "/journal-2-0/playbook")
        mp = pg.locator('[data-testid="my-playbook"]')
        opened = C.vis_loc(mp, 30000)
        pg.wait_for_timeout(2500)
        text = mp.first.inner_text()[:700] if opened else None
        setups = pg.evaluate("() => [...document.querySelectorAll('[data-setup]')].map(e => e.getAttribute('data-setup'))")
        C.step(pg, inst, "my playbook", "My Playbook opens from Insights: one card per tagged setup, worded by sample size",
               "PASS" if there and opened else "FAIL", door_on_insights=there, opened=opened, setups=setups, text=text,
               scope=['[data-testid="my-playbook"]'])
    run("playbook", playbook)

    # ── review drafts ───────────────────────────────────────────────────────────────────
    def reviews():
        for kind in ("daily", "weekly", "monthly"):
            home()
            box = pg.locator('[data-tour="review-drafts-home"]')
            present = C.vis_loc(box, 30000)
            made, text, err = None, None, None
            try:
                pg.locator(f'[data-tour="review-drafts-{kind}"]').first.click(timeout=15000)
                pg.wait_for_url(lambda u: "note=" in u, timeout=60000)
                made = pg.url.split("note=")[-1].split("&")[0]
                pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                pg.wait_for_timeout(1500)
                text = pg.locator(".ProseMirror").first.inner_text()
            except Exception as e:  # noqa: BLE001
                err = str(e)[:300]
            alerts = [a[:200] for a in pg.get_by_role("alert").all_inner_texts()]
            n = note_json(made) if made else {}
            heads = re.findall(r'"type": "heading".*?"text": "([^"]{2,60})"', json.dumps(n.get("bodyJson") or {}))[:14]
            C.step(pg, inst, "review drafts", f"one click drafts the {kind} review as a note",
                   "PASS" if made and text and len(text) > 200 else "FAIL", box=present, note=made, title=n.get("title"),
                   headings=heads, text_head=(text or "")[:500], mentions_amd="AMD" in (text or ""), alerts=alerts, reach_error=err)
            S[f"review_{kind}"] = made
        C.step(None, inst, "review drafts", "the Compass quote inside a draft", "NOT_RUN", reason="NO KEY", shot=False)
    run("reviews", reviews)

    def nokey():
        for feat_, what in (("writing help", "Improve / Shorten / Continue in the editor"), ("Ask Notebook", "ask a question over notes"),
                            ("AI actions", "Ask Notebook to do something (plan, approve, undo)"),
                            ("meaning search", "search by meaning (its tour's steps are walked; the search itself needs an embedding key)"),
                            ("dictation", "voice dictation and voice notes")):
            C.step(None, inst, feat_, what, "NOT_RUN", reason="NO KEY", shot=False)
    run("nokey", nokey)

    # ── layout pass at 820 and 390 over the same member's pages ─────────────────────────
    def pages_for_layout():
        sb = S.get("sample_by_ticker") or {}
        return [
            ("Research Home", "/journal/notebook", ["[data-reporting-soon]", "[data-passed-setups]", '[data-tour="review-drafts-home"]']),
            ("plan note with fingerprint (AAPL sample)", f"/journal/notebook?note={sb.get('AAPL')}", ['[data-testid="fingerprint-panel"]']),
            ("own chart plan note (AMD)", f"/journal/notebook?note={S.get('amd_note')}", ['[data-testid="fingerprint-panel"]', "[data-chart-plan-panel]"]),
            ("formula note", f"/journal/notebook?note={S.get('formula_note')}", ["li[data-prop-row]"]),
            ("trade page", f"/journal-2-0/trade/{S.get('amd_trade')}", ['[data-testid="plan-grade-card"]', '[data-testid="entry-context-card"]', '[data-testid="trade-before-after"]']),
            ("unplanned trade page", f"/journal-2-0/trade/{S.get('ibm_trade')}", ['[data-testid="plan-grade-card"]', '[data-testid="plan-grade-unplanned"]']),
            ("position page", "/journal-2-0/position/NVDA", ['[data-testid="entry-context-card"]']),
            ("Open Positions rows", "/journal?j2tab=positions", ["[data-thesis-chip]"]),
            ("closed trades table", "/journal/trades?seg=closed", ['[data-testid="unplanned-chip"]']),
            ("Insights > Discipline", "/journal/insights?ins=discipline", ['[data-testid="discipline-record"]']),
            ("Insights > Reviews", "/journal/insights?ins=reviews", ['[data-testid="review-drafts-section"]']),
            ("My Playbook", "/journal-2-0/playbook", ['[data-testid="my-playbook"]']),
            ("setups board", "/journal/notebook/setups", ["[data-board-card]"]),
            ("research workspace (TSLA)", "/journal/notebook/research/TSLA", []),
            ("review draft note", f"/journal/notebook?note={S.get('review_weekly')}", []),
            ("earnings prep note", f"/journal/notebook?note={S.get('prep_note')}", []),
            ("Help", "/support", ["section[aria-labelledby='support-whats-new']", "ul:has(> li > a[href*='notebook'])"]),
        ]

    def layout():
        storage = ctx.storage_state()
        union = {}
        for vp in ("820", "390", "1280"):
            c2 = C.new_ctx(browser, vp, storage)
            i2 = C.Inst(c2, cfg, vp)
            p2 = c2.new_page()
            for label, path, scope in pages_for_layout():
                if "None" in path:
                    C.step(None, i2, "layout", f"{label}: skipped, an earlier step did not produce its page", "NOT_RUN",
                           reason="depends on a failed step", shot=False)
                    continue
                try:
                    C.goto(p2, base, path)
                    for s in scope[:1]:
                        C.vis(p2, s, 20000)
                    p2.wait_for_timeout(3000)
                    found = C.census(p2)
                    for k, v in found.items():
                        union[k] = union.get(k, 0) + v
                    probe = p2.evaluate(C.PROBE_JS, [scope, i2.touch, C.ERROR_BOUNDARY_TEXT])
                    bad = probe["error_boundary"] or probe["overflow"]["horizontal"] or bool((probe.get("small") or {}).get("under"))
                    C.step(p2, i2, "layout", f"{label}", "FAIL" if bad else "PASS", path=path, surfaces_present=found, scope=scope)
                except Exception as e:  # noqa: BLE001
                    C.step(p2, i2, "layout", f"{label} (driver exception)", "FAIL", path=path, error=str(e)[:300])
            # the visual playbook and chart-plan panel are behind a press: open them at this width too
            try:
                sb = S.get("sample_by_ticker") or {}
                C.goto(p2, base, f"/journal/notebook?note={sb.get('AAPL')}", ".ProseMirror")
                d = p2.get_by_role("button", name="Visual playbook")
                d.first.scroll_into_view_if_needed(timeout=15000)
                (d.first.tap if i2.touch else d.first.click)(timeout=10000)
                ok = C.vis(p2, '[data-testid="visual-playbook"]', 30000)
                p2.wait_for_timeout(2000)
                probe = p2.evaluate(C.PROBE_JS, [['[data-testid="visual-playbook"]'], i2.touch, C.ERROR_BOUNDARY_TEXT])
                bad = (not ok) or probe["error_boundary"] or probe["overflow"]["horizontal"] or bool((probe.get("small") or {}).get("under"))
                union["visual_playbook"] = union.get("visual_playbook", 0) + (1 if ok else 0)
                C.step(p2, i2, "layout", "visual playbook gallery (opened)", "FAIL" if bad else "PASS", opened=ok,
                       scope=['[data-testid="visual-playbook"]'])
            except Exception as e:  # noqa: BLE001
                C.step(p2, i2, "layout", "visual playbook gallery (driver exception)", "FAIL", error=str(e)[:300])
            c2.close()
        C.REC["surfaces_seen_present_in_c2"] = union
        missing = [k for k in C.SURFACES if k not in union]
        C.step(None, inst, "census control", "every absence selector used in c1 matched a real element somewhere in c2",
               "INFO", seen=sorted(union), never_seen=missing, shot=False)
    run("layout", layout)

    # ── tours ───────────────────────────────────────────────────────────────────────────
    def tours(vp):
        registry = q2.read_registry()
        storage = ctx.storage_state()
        c2 = C.new_ctx(browser, vp, storage)
        i2 = C.Inst(c2, cfg, vp)
        p2 = c2.new_page()
        width = C.VIEWPORTS[vp][0]
        sub: list = []

        def adapter(phase, wd, surface, check, ok, **facts):
            sub.append({"check": check, "verdict": "INFO" if ok is None else ("PASS" if ok else "FAIL"),
                        **{k: v for k, v in facts.items() if k not in ("violations", "trail", "controls", "traceback")}})
        q2.record = adapter
        w.record = adapter
        C.goto(p2, base, "/journal/notebook")
        q2.settle_home(p2)
        for t in [t for t in registry if t["replayable"]]:
            sub.clear()
            try:
                row = q2.walk_tour(p2, c2, base, width, t, P="c2")
            except Exception as e:  # noqa: BLE001
                row = {"tour": t["id"], "opens": False, "declared": len(t["steps"]), "notes": [f"driver error: {type(e).__name__}: {str(e)[:200]}"]}
            focus_after = p2.evaluate(w.FOCUS_DESC_JS)
            fails = [s["check"] for s in sub if s["verdict"] == "FAIL"]
            ok = bool(row.get("opens")) and row.get("reached_start_at_step") == 1 and not fails
            C.step(p2, i2, f"tour: {t['id']}", "Replay from Help: opens at step one, Back, Next, Escape, card checks",
                   "PASS" if ok else "FAIL", title=t["title"], opens=row.get("opens"), start_url=row.get("start"),
                   start_step=row.get("reached_start_at_step"), shown=len(row.get("shown", [])), declared=row.get("declared"),
                   skipped=[{"id": s["id"], "why": s["why"]} for s in row.get("skipped", [])], back_ok=row.get("back_ok"),
                   escape_ok=row.get("escape_ok"), battery=row.get("battery"), trap=row.get("trap"), clicked=row.get("clicked"),
                   notes=row.get("notes"), failed_checks=fails, focus_after_close=focus_after, sub_checks=list(sub), shot=False,
                   tour_shot=row.get("shot"))
        sub.clear()
        try:
            q2.walk_explainer(p2, c2, base, width)
        except Exception as e:  # noqa: BLE001
            sub.append({"check": "driver", "verdict": "FAIL", "error": str(e)[:300]})
        fails = [s["check"] for s in sub if s["verdict"] == "FAIL"]
        C.step(p2, i2, "tour: note-resurfaces", "the explainer in the 'What you wrote then' sheet", "PASS" if sub and not fails else "FAIL",
               failed_checks=fails, sub_checks=list(sub))
        c2.close()
    run("tours1280", lambda: tours("1280"))
    run("tours390", lambda: tours("390"))

    # ── remove the sample in one click; nothing of it remains ───────────────────────────
    def remove():
        before = M.get(base + "/api/j2/onboarding/sample-notebook").json()
        home()
        strip = pg.get_by_text("You're looking at the sample notebook")
        there = C.vis_loc(strip, 30000)
        clicks, msg = 0, None
        if there:
            pg.get_by_role("button", name="Remove it", exact=True).first.click()
            clicks = 1
            pg.wait_for_timeout(4000)
            status = pg.get_by_role("status").all_inner_texts() + pg.get_by_role("alert").all_inner_texts()
            msg = [s[:200] for s in status if "sample" in s.lower()]
            anyway = pg.get_by_role("button", name=re.compile("anyway", re.I))
            if anyway.count() and anyway.first.is_visible():
                C.step(pg, inst, "remove sample", "one click was not enough: the page asked before removing", "INFO", message=msg)
                anyway.first.click()
                clicks += 1
                pg.wait_for_timeout(1000)
                again = pg.get_by_role("button", name=re.compile("anyway|remove", re.I))
                if again.count() and again.first.is_visible():
                    again.first.click()
                    clicks += 1
                pg.wait_for_timeout(4000)
        after = M.get(base + "/api/j2/onboarding/sample-notebook").json()
        ids = set(before.get("ids") or S.get("sample_ids") or [])
        left = [n for n in C.notes_list(ctx, base) if n.get("id") in ids]
        C.step(pg, inst, "remove sample", "Remove it: every sample note leaves the Notebook in one click",
               "PASS" if there and clicks == 1 and not left and not (after.get("activeIds") or []) else "FAIL", strip=there, clicks=clicks,
               message=msg, active_before=len(before.get("activeIds") or []), active_after=len(after.get("activeIds") or []),
               notes_left=[n.get("title") for n in left])
        pg.wait_for_timeout(1500)
        leftovers = {}
        # lists
        pg.reload(wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pg.wait_for_timeout(4000)
        home_text = pg.evaluate("() => (document.querySelector('[class*=\"_main_\"]') || document.body).innerText")
        titles = [t for t in (S.get("sample_titles") or []) if t and t in home_text]
        leftovers["home_titles"] = titles
        leftovers["home_passed_googl"] = pg.locator('[data-passed-symbol="GOOGL"]').count()
        hp = M.get(base + "/api/j2/notebook/home")
        leftovers["home_api_ids"] = [i for i in ids if i in hp.text()] if hp.status == 200 else f"HTTP {hp.status}"
        C.step(pg, inst, "remove sample", "Research Home after removal", "PASS" if not titles and not leftovers["home_passed_googl"] and not leftovers["home_api_ids"] else "FAIL",
               **leftovers)
        ps_ = M.get(base + "/api/j2/research-capture/passed-setups")
        passed_txt = ps_.text() if ps_.status == 200 else ""
        C.goto(pg, base, "/journal?j2tab=positions")
        pg.wait_for_timeout(4000)
        nvda_note = (S.get("sample_by_ticker") or {}).get("NVDA")
        chip = pg.locator(f'[data-thesis-chip="{nvda_note}"]').count()
        C.step(pg, inst, "remove sample", "Open Positions: the NVDA chip (it came from the sample thesis) is gone",
               "PASS" if not chip else "FAIL", chip=chip, any_chips=pg.locator("[data-thesis-chip]").count())
        C.goto(pg, base, "/journal/notebook/setups")
        pg.wait_for_timeout(5000)
        cards = pg.locator("[data-board-card]").evaluate_all("els => els.map(e => e.getAttribute('data-board-card'))")
        C.step(pg, inst, "remove sample", "setups board: no sample plan left", "PASS" if not any(c in ("MSFT", "AAPL") for c in cards) else "FAIL",
               cards=cards, page_text=pg.evaluate(MAIN_TEXT_JS)[:300])
        vp_api = M.get(base + "/api/j2/visual-playbook")
        vp_left = [i for i in ids if i in vp_api.text()] if vp_api.status == 200 else f"HTTP {vp_api.status}"
        C.goto(pg, base, "/journal/notebook?view=all")
        pg.wait_for_timeout(3000)
        list_text = pg.evaluate("() => document.body.innerText")
        in_list = [t for t in (S.get("sample_titles") or []) if t and t in list_text]
        counts = re.findall(r"(?:All notes|Notes)\s*\(?(\d+)\)?", list_text)[:3]
        box = pg.get_by_label("Search your notes").first
        found_by_search = None
        try:
            box.fill("sample")
            pg.wait_for_timeout(2500)
            found_by_search = [t for t in (S.get("sample_titles") or []) if t and t in pg.evaluate("() => document.body.innerText")]
        except Exception as e:  # noqa: BLE001
            found_by_search = f"(search box not reached: {str(e)[:100]})"
        folders = M.get(base + "/api/j2/note-folders")
        folder_names = [f.get("name") for f in ((folders.json().get("folders") if isinstance(folders.json(), dict) else folders.json()) or [])] if folders.status == 200 else f"HTTP {folders.status}"
        C.step(pg, inst, "remove sample", "the notes list, its search, the visual playbook and passed setups hold nothing of the sample",
               "PASS" if not in_list and not found_by_search and not vp_left and "GOOGL" not in passed_txt else "FAIL",
               titles_in_list=in_list, found_by_search=found_by_search, visual_playbook_ids_left=vp_left,
               passed_setups_has_googl="GOOGL" in passed_txt, folders_left=folder_names, counts_seen=counts)
        # export
        exp = {}
        for path in ("/api/j2/export/notebook?format=markdown", "/api/j2/export/notebook"):
            r = M.get(base + path)
            exp[path] = {"status": r.status, "type": r.headers.get("content-type"), "bytes": len(r.body()) if r.status == 200 else 0}
            if r.status == 200:
                raw = r.body()
                names = []
                try:
                    import io as _io
                    import zipfile
                    z = zipfile.ZipFile(_io.BytesIO(raw))
                    names = z.namelist()
                    blob = " ".join(names) + " " + " ".join(z.read(n).decode("utf-8", "replace")[:20000] for n in names[:200])
                except Exception:  # noqa: BLE001
                    blob = raw.decode("utf-8", "replace")
                exp[path]["files"] = names[:40]
                exp[path]["sample_titles_inside"] = [t for t in (S.get("sample_titles") or []) if t and t in blob]
                exp[path]["sample_ids_inside"] = [i for i in ids if i in blob]
                break
        ran = next((v for v in exp.values() if v["status"] == 200), None)
        C.step(None, inst, "remove sample", "a Notebook export after removal carries none of the sample",
               ("PASS" if not ran["sample_titles_inside"] and not ran["sample_ids_inside"] else "FAIL") if ran else "FAIL",
               export=exp, shot=False)
        tr_ = M.get(base + "/api/j2/notes?trash=1&limit=500")
        C.step(None, inst, "remove sample", "the sample notes are in Trash, restorable (the product's own stated design)", "INFO",
               trash_status=tr_.status, trash_count=len((tr_.json().get("notes") or [])) if tr_.status == 200 and isinstance(tr_.json(), dict) else None,
               shot=False)
    run("remove", remove)

    ctx.close()


if __name__ == "__main__":
    print("This module holds configuration c2's steps. Run: python tools/notebook_fin_walk.py --config c2 ...")
    sys.exit(0)
