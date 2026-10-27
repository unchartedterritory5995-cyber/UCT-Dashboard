"""Clock steps (W11.4, W11.5, W11.9) and the flag flip (W11.12). Each runs only on its own boot."""
import os
from ui import *
from ev import Inconclusive
from steps_b import names

CLOCK = os.environ.get("WALK_CLOCK") == "1"
PHASE = os.environ.get("WALK_PHASE", "")


def cctx(S, b, base, vp, pid, name):
    now, ident = now_et(base)
    c = Ctx(b, base, vp, pid, clock=now, clock_session=CLOCK)
    S.ctxs[name] = c
    S.saw(f"{name}: server shifted now / browser clock", f"{ident['clock_shift']['now_et_words']} / " +
          c.page.evaluate("() => new Date().toString()") if False else ident["clock_shift"]["now_et_words"])
    return c, now


def use_library(S, c, title):
    pg = c.page
    sheet, lib = open_picker(c)
    det = library_detail(c, lib, title)
    S.saw(f"{title} detail", det.inner_text()[:800])
    click(c, det.get_by_role("button", name="Use this template"))
    ad = adopt_sheet(pg)
    cr = ad.get_by_text(re.compile(r"^Create .* from the template$"))
    for i in range(cr.count()):
        cr.nth(i).click()
    click(c, ad.get_by_role("button", name="Use", exact=True))
    nid = wait_note(pg)
    after_use(S, c, f"{title} Use")
    rc.render_all(pg)
    return nid


def w11_4(S, b, base, vp, kbd=False):
    c, now = cctx(S, b, base, vp, A[vp], "A")
    S.check("the server's shifted now is Sunday 2026-11-22 21:00 ET", now.strftime("%Y-%m-%d %a %H") == "2026-11-22 Sun 21", now.isoformat())
    bclock = c.page.evaluate("() => new Date().toISOString()")
    S.saw("browser clock (ISO)", bclock)
    nid = use_library(S, c, "Night-before prep")
    pg = c.page
    rb = pg.locator("[data-routine-block]")
    t = rb.first.inner_text() if rb.count() else ""
    S.saw("routine block", t)
    S.check("the routine block reads 'For Mon Nov 23' (next trading day after the ET note day)", "For Mon Nov 23" in t, t[:200])
    S.shot(pg, "main")
    S.measure(pg, "note", "[data-routine-block]", touch=c.touch)


def w11_5(S, b, base, vp, kbd=False):
    c, now = cctx(S, b, base, vp, A[vp], "A")
    S.saw("server shifted now", now.isoformat())
    nid = use_library(S, c, "Weekend swing review")
    pg = c.page
    rb = pg.locator("[data-routine-block]")
    t = rb.first.inner_text() if rb.count() else ""
    S.saw("routine block", t)
    want = {"2026-10-24": "For the week of Oct 19", "2026-10-31": "For the week of Oct 26"}.get(now.strftime("%Y-%m-%d"), "?")
    if now.strftime("%Y-%m-%d") == "2026-10-31":
        S.note("FALLBACK instant 2026-10-31T11:00-04:00 (plan §1, recorded deviation)")
    S.check(f"the routine block reads {want!r} (the week just ended, labelled from its Monday)", want in t, t[:200])
    S.shot(pg, "main" if now.day == 24 else "main-fallback")
    S.measure(pg, f"note-{now.day}", "[data-routine-block]", touch=c.touch)


def listing_of(pid, title, base):
    s, gl = api(pid, "/api/j2/template-gallery", base=base, clock=CLOCK)
    rows = (gl.get("templates") or gl.get("items") or []) if isinstance(gl, dict) else []
    return next((r for r in rows if r.get("title") == title), None)


def w11_9(S, b, base, vp, kbd=False):
    n = names(vp)
    day = PHASE  # D1 / D2 / D3
    c, now = cctx(S, b, base, vp, B[vp], f"B-{day}")
    pg = c.page
    S.saw(f"{day}: server now", now.isoformat())
    p0 = len(c.requests)
    nid = use_style(c, "Daily prep", n["style"], S=S)
    S.check(f"{day}: B used the W11.7 template (a note was made)", bool(nid), pg.url)
    pg.wait_for_timeout(2500)
    line = pg.locator("[data-helpful-prompt]")
    days = sorted(set((st().get(f"b_days_{vp}") or []) + [now.strftime("%Y-%m-%d")]))
    st_set(f"b_days_{vp}", days)
    S.saw(f"{day}: the ET days B has used the template on (W11.7's Use counts)", json.dumps(days))
    if day == "D1":
        S.note("B's W11.7 Use (the real ET day the walk ran) is a use day too, so D1 is B's 2nd day and D2 its 3rd: the "
               "3rd-day line is expected on D2 (by ET days; a UTC-day server would count D1+D2 as one day and show it on D3).")
    nth = len(days)
    if nth > 3:
        S.check(f"{day}: day {nth}: the line answered on day 3 does not come back", line.count() == 0, "")
        S.shot(pg, f"helpful-{day.lower()}")
        return
    if nth < 3:
        S.check(f"{day}: no helpful line yet on the note", line.count() == 0, "")
        sheet = gallery(c)
        hb = sheet.get_by_role("button", name=f"Helpful: {n['style']}")
        if not hb.count():
            raise Inconclusive(f"no Helpful button for {n['style']!r} in the gallery")
        click(c, hb.first)
        pg.wait_for_timeout(2000)
        card = hb.first.locator("xpath=ancestor::*[.//*[@data-type-chip]][1]")
        ct = card.inner_text()
        S.saw(f"{day}: card after Helpful", ct[:500])
        want = "You can mark this helpful after using it on 3 different days."
        S.check(f"{day}: {want!r} under the button", want in ct, ct[-200:])
        S.check(f"{day}: the Helpful button stays enabled", hb.first.is_enabled() and hb.first.get_attribute("aria-disabled") != "true", "")
        S.shot(pg, f"helpful-{day.lower()}")
        S.measure(pg, f"gallery-{day}", "dialog", touch=c.touch)
        return
    # the 3rd ET day of use
    S.note(f"{day} is B's 3rd ET day of use: the line must show here")
    before = listing_of(B[vp], n["style"], base)
    hc0 = (before or {}).get("helpfulCount", 0)
    try:
        line.first.wait_for(timeout=15000)
    except Exception:  # noqa: BLE001
        pass
    lt = line.first.inner_text() if line.count() else ""
    S.saw(f"{day}: helpful line", lt)
    S.check(f"{day} (3rd day): the note shows ONE line 'Was {n['style']} helpful?'", line.count() == 1 and f"Was {n['style']} helpful?" in lt, lt)
    if not line.count():
        S.shot(pg, "helpful-d3")
        return
    S.check(f"{day} (3rd day): the line offers Yes, Not really and a Dismiss icon",
            line.get_by_role("button", name="Yes", exact=True).count() == 1 and line.get_by_role("button", name="Not really", exact=True).count() == 1
            and line.get_by_role("button", name="Dismiss", exact=True).count() == 1, "")
    S.shot(pg, "helpful-d3")
    S.measure(pg, "helpful-line", "[data-helpful-prompt]", touch=c.touch)
    yes = line.get_by_role("button", name="Yes", exact=True)
    if kbd:
        rc.tab_to(pg, yes)
        S.check("D3 keyboard: Yes is reached by Tab", True, focus_label(pg))
        pg.keyboard.press("Enter")
    else:
        click(c, yes)
    pg.wait_for_timeout(1500)
    S.check(f"{day} (3rd day): after Yes the line hides at once", pg.locator("[data-helpful-prompt]").count() == 0 or "Thanks for your answer." in pg.locator("body").inner_text(), "")
    after = listing_of(B[vp], n["style"], base)
    hc1 = (after or {}).get("helpfulCount", 0)
    S.check(f"{day} (3rd day): the listing's helpful count rises by exactly one", hc1 == hc0 + 1, f"{hc0} -> {hc1}")
    pg.reload(wait_until="domcontentloaded")
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    pg.wait_for_timeout(3000)
    S.check(f"{day} (3rd day): after reload the line does not return", pg.locator("[data-helpful-prompt]").count() == 0, "")
    again = listing_of(B[vp], n["style"], base)
    S.check(f"{day} (3rd day): after reload the count is still +1", (again or {}).get("helpfulCount", 0) == hc0 + 1, str((again or {}).get("helpfulCount")))
    put = [r for r in c.requests if r["m"] in ("PUT", "PATCH") and f"/api/j2/notes/{nid}" in r["u"]]
    S.check(f"{day} (3rd day): no note PUT across mount and answer", not put, json.dumps(put))


# ── W11.12: the snapshot (ON, before the flip), W11OFF checks, ON again ──────────────────────────

def _note_snapshot(pid, nid, base):
    n = note_of(pid, nid, base)
    if not n:
        return None
    blocks = [c.get("type") for c in (n.get("bodyJson") or {}).get("content") or []]
    return {"blocks": blocks, "updatedAt": n.get("updatedAt"), "body": json.dumps(n.get("bodyJson"), sort_keys=True)}


def _style(pid, name, base):
    s, r = api(pid, "/api/j2/journal-styles", base=base)
    rows = (r.get("styles") or r.get("items") or []) if isinstance(r, dict) else []
    return next((x for x in rows if x.get("name") == name), None)


def w11_12(S, b, base, vp, kbd=False):
    n = names(vp)
    notes = {k: st().get(f"{k}_{vp}") for k in ("w112_note", "share_note", "a_tplnote")}
    if PHASE == "snap":
        snap = {}
        c = S.ctxs.setdefault("A-snap", Ctx(b, base, vp, A[vp]))
        for k, nid in notes.items():
            if not nid:
                continue
            r0 = len(c.requests)
            c.goto(f"/journal/notebook?note={nid}")
            c.page.locator(".ProseMirror").first.wait_for(timeout=T)
            rc.render_all(c.page)
            c.page.wait_for_timeout(6000)
            sn = _note_snapshot(A[vp], nid, base)
            w = [r for r in c.requests[r0:] if r["m"] in ("PUT", "PATCH") and f"/api/j2/notes/{nid}" in r["u"]]
            S.check(f"ON (before the flip): opening note {k} sends no note PUT", not w, json.dumps(w))
            sn["text"] = c.page.locator(".ProseMirror").first.inner_text()
            snap[k] = sn
        sty = _style(A[vp], n["style"], base)
        snap["style_blocks"] = [x["block"] for x in (sty or {}).get("blocks", [])]
        st_set(f"w1112_snap_{vp}", snap)
        S.saw("ON snapshot before the flip", json.dumps({k: (v["blocks"] if isinstance(v, dict) else v) for k, v in snap.items()})[:800])
        S.check("snapshot of the W11.2-W11.7 notes and the style's slots taken under ON", bool(snap.get("style_blocks")), json.dumps(snap.get("style_blocks")))
        return
    snap = st().get(f"w1112_snap_{vp}") or {}
    c = Ctx(b, base, vp, A[vp])
    S.ctxs[f"A-{PHASE}"] = c
    pg = c.page
    s, me = api(A[vp], "/api/auth/me", base=base)
    w11 = me.get("notebook_widgets_w11_enabled") if isinstance(me, dict) else None
    s, lib = api(A[vp], "/api/j2/template-gallery/library", base=base)
    off = PHASE == "off"
    S.saw(f"{PHASE}: /api/auth/me w11 / library status", f"{w11} / {s}")
    S.check(f"{PHASE}: /api/auth/me notebook_widgets_w11_enabled is {not off}", w11 is (not off), str(w11))
    S.check(f"{PHASE}: GET /template-gallery/library answers {404 if off else 200}", s == (404 if off else 200), str(s))
    c.goto("/journal/notebook?view=all")
    click(c, pg.get_by_role("button", name="Templates", exact=True).first)
    sheet = pg.get_by_role("dialog", name="New note")
    sheet.wait_for(timeout=T)
    pg.wait_for_timeout(3500)
    has_lib = sheet.locator("[data-template-library]").count() > 0
    S.check(f"{PHASE}: the Template library section is {'gone' if off else 'back'}", has_lib != off, str(has_lib))
    S.shot(pg, f"picker-{PHASE}")
    click(c, sheet.get_by_role("button", name="Browse the community gallery"))
    pg.wait_for_timeout(2500)
    vr = sheet.get_by_role("button", name="Widgets", exact=True).count() + sheet.get_by_role("button", name="Routines", exact=True).count() + sheet.get_by_role("button", name="Trackers", exact=True).count()
    S.check(f"{PHASE}: the three new item types are {'gone' if off else 'back'} in the gallery", (vr == 0) == off, f"{vr} type chips")
    pg.keyboard.press("Escape")
    c.goto("/journal/notebook?view=all")
    sh = my_tools(c, "Templates")
    tt = sh.inner_text()
    if off:
        S.check("W11OFF: My tools > Templates reads 'Templates are coming soon.'", "Templates are coming soon." in tt, tt[:300])
    else:
        S.check("ON again: My tools > Templates lists the templates", sh.locator("[data-testid=my-tools-template-row]").count() > 0, tt[:200])
    S.shot(pg, f"mytools-{PHASE}")
    S.measure(pg, f"mytools-{PHASE}", "dialog", touch=c.touch)
    pg.keyboard.press("Escape")
    norm = lambda x: re.sub(r"as of [^\n]+|Captured [^\n]+|\d{1,2}:\d{2} [AP]M|Updated [^\n]+", "", x)
    for k, nid in notes.items():
        if not nid or k not in snap:
            continue
        r0 = len(c.requests)
        c.goto(f"/journal/notebook?note={nid}")
        pg.locator(".ProseMirror").first.wait_for(timeout=T)
        rc.render_all(pg)
        pg.wait_for_timeout(6000)
        now_s = _note_snapshot(A[vp], nid, base)
        t = pg.locator(".ProseMirror").first.inner_text()
        S.saw(f"{PHASE}: note {k} rendered", t[:600])
        S.check(f"{PHASE}: note {k} unchanged: same block count and kinds as before the flip (plan W11.12)",
                now_s and now_s["blocks"] == snap[k]["blocks"], json.dumps([len(snap[k]["blocks"]), now_s and len(now_s["blocks"])]))
        S.check(f"{PHASE}: note {k} renders the same text as before the flip (plan W11.12)", norm(t) == norm(snap[k]["text"]),
                json.dumps([x for x in __import__("difflib").unified_diff(norm(snap[k]["text"]).splitlines(), norm(t).splitlines(), lineterm="", n=0)][:12]))
        writes = [r for r in c.requests[r0:] if r["m"] in ("PUT", "PATCH") and f"/api/j2/notes/{nid}" in r["u"]]
        S.saw(f"{PHASE}: note {k} writes while opening it / stored body same / updatedAt",
              json.dumps({"writes": writes, "body_same": bool(now_s and now_s["body"] == snap[k]["body"]),
                          "updatedAt": [snap[k]["updatedAt"], now_s and now_s["updatedAt"]]}))
        S.check(f"{PHASE}: opening note {k} sends no note PUT (the flip never rewrites a member's note)", not writes, json.dumps(writes))
        if k == "share_note":
            S.shot(pg, f"note-{PHASE}")
    # the style editor: slots hidden under OFF, kept on save
    c.goto("/journal/notebook?view=all")
    click(c, pg.get_by_role("button", name="Styles", exact=True).first)
    pg.wait_for_timeout(2000)
    ed = pg.get_by_role("button", name=f"Edit {n['style']}", exact=True)
    if not ed.count():
        raise Inconclusive(f"the styles manager shows no Edit button for {n['style']!r}")
    click(c, ed.first)
    form = pg.get_by_role("form", name=f"Edit style {n['style']}")
    form.wait_for(timeout=T)
    lst = form.get_by_role("list", name="Blocks in this style")
    bl = lst.locator("li").all_inner_texts() if lst.count() else []
    S.saw(f"{PHASE}: style editor blocks", json.dumps(bl)[:600])
    slot_rows = [x for x in bl if any(w in x for w in (n["widget"], "Daily P&L bars", n["routine"], n["tracker"]))]
    if off:
        S.check("W11OFF: a style holding slots opens in the style editor without them", not slot_rows, json.dumps(slot_rows))
    else:
        S.check("ON again: the style editor shows the slots", len(slot_rows) >= 1, json.dumps(bl)[:300])
    S.shot(pg, f"style-editor-{PHASE}")
    sv = form.get_by_role("button", name="Save style")
    if sv.is_enabled():
        click(c, sv)
        pg.wait_for_timeout(2500)
    sty = _style(A[vp], n["style"], base)
    blocks = [x["block"] for x in (sty or {}).get("blocks", [])]
    S.saw(f"{PHASE}: stored style blocks after save", json.dumps(blocks))
    if off:
        S.note("Under W11OFF the API answer may hide slot blocks (_hidden_slots_at); the ON-again phase reads them back.")
    else:
        S.check("ON again: the slots are all still there after the W11OFF save (update_style keeps them)",
                sorted(blocks) == sorted(snap.get("style_blocks") or []), json.dumps([snap.get("style_blocks"), blocks]))
