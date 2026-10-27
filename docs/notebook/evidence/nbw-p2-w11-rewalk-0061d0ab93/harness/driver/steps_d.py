"""W11.14 keyboard only, W11.15 themes, W11.16 reduced motion, F-DEF-1 retests."""
from ui import *
from adapter import R as RunA, row as rowA
from ev import Inconclusive
from steps_b import names, open_share
from steps_c import open_menu


def kb_open(c, loc):
    rc.tab_to(c.page, loc)
    c.page.keyboard.press("Enter")
    c.page.wait_for_timeout(1500)


def audit(S, pg, label, touch):
    sel = __import__("ev").mark_dialog(pg)
    r = kbd_audit(pg, sel)
    S.saw(f"keyboard audit: {label}", json.dumps(r)[:900])
    S.check(f"{label}: every visible control is reached by Tab (a radio group / tab list counts once)",
            r.get("controls", 0) > 0 and not r.get("missing"), json.dumps(r.get("missing"))[:400])
    S.check(f"{label}: focus stays inside the sheet (trap)", r.get("escaped", 1) == 0, f"escaped {r.get('escaped')} of {r.get('presses')}")
    return r


def esc_returns(S, pg, label, opener_label_rx):
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(900)
    f = focus_label(pg)
    S.check(f"{label}: Escape returns focus to the control that opened it", re.search(opener_label_rx, f or "") is not None, f)


def w11_14(S, b, base, vp, kbd=True):
    n = names(vp)
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    c.goto("/journal/notebook?view=all")
    kb_open(c, pg.get_by_role("button", name="Templates", exact=True).first)
    sheet = pg.get_by_role("dialog", name="New note")
    sheet.wait_for(timeout=T)
    pg.wait_for_function("() => document.querySelectorAll('[data-template-library] [data-library-card]').length > 0", timeout=T)
    audit(S, pg, "template picker + library section", c.touch)
    prev = sheet.get_by_role("button", name="Preview Pre-market prep, from the Template library")
    kb_open(c, prev)
    det = pg.get_by_role("dialog", name="Pre-market prep")
    det.wait_for(timeout=T)
    pg.wait_for_timeout(1500)
    audit(S, pg, "library detail", c.touch)
    esc_returns(S, pg, "library detail", r"^Preview Pre-market prep")
    kb_open(c, prev)
    det.wait_for(timeout=T)
    pg.wait_for_timeout(1500)
    kb_open(c, det.get_by_role("button", name="Use this template"))
    ad = adopt_sheet(pg)
    audit(S, pg, "adopt sheet (Pre-market prep)", c.touch)
    # the reuse question is a radio group: arrows move inside it
    r0 = ad.get_by_role("radio").first
    if r0.count():
        rc.tab_to(pg, r0)
        before = radios_state(ad)
        pg.keyboard.press("ArrowDown")
        pg.wait_for_timeout(300)
        after = radios_state(ad)
        S.check("adopt sheet: the reuse radios move with the arrow keys", before != after or len(before) == 1, json.dumps([before, after]))
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(900)
    S.check("adopt sheet: Escape closes it", pg.get_by_role("dialog", name="Make it yours").count() == 0, "")
    S.saw("focus after closing the adopt sheet", focus_label(pg))
    pg.keyboard.press("Escape")
    # SlotPicker (Setup study)
    sheet, lib = open_picker(c)
    kb_open(c, lib.get_by_role("button", name="Preview Setup study, from the Template library"))
    det = pg.get_by_role("dialog", name="Setup study")
    det.wait_for(timeout=T)
    pg.wait_for_timeout(1500)
    kb_open(c, det.get_by_role("button", name="Use this template"))
    ad = adopt_sheet(pg)
    ch = ad.get_by_role("button", name="Change setup")
    kb_open(c, ch)
    pk = ad.locator("[data-slot-picker]").first
    pk.wait_for(timeout=T)
    pg.wait_for_timeout(1500)
    radios = pk.get_by_role("radio")
    cur = ad.locator("[data-slot]").first.inner_text().split("\n")[0]
    if radios.count() > 1:
        rc.tab_to(pg, radios.first)
        curv = cur.replace("Setup: ", "").strip()
        for _ in range(radios.count()):
            pg.keyboard.press("ArrowDown")
            pg.wait_for_timeout(300)
            chk = [radios.nth(i).get_attribute("value") for i in range(radios.count()) if radios.nth(i).is_checked()]
            if chk and chk[0] != curv:
                break
        done = pk.get_by_role("button", name="Done", exact=True)
        rc.tab_to(pg, done)
        pg.keyboard.press("Enter")
        pg.wait_for_timeout(2500)
        new = ad.locator("[data-slot]").first.inner_text().split("\n")[0]
        S.check("SlotPicker: a value is picked with arrows and Done by keyboard", new != cur, f"{cur} -> {new}")
        f = focus_label(pg)
        S.check("SlotPicker: after Done, focus returns to its Change button", f.lower().startswith("change setup"), f)
    else:
        S.note("SlotPicker had fewer than two values to move between")
    audit(S, pg, "adopt sheet (Setup study, with a choice)", c.touch)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(800)
    pg.keyboard.press("Escape")
    # share preview, from My tools by keyboard
    c.goto("/journal/notebook?view=all")
    kb_open(c, pg.get_by_role("button", name="My tools", exact=True).first)
    sh = pg.get_by_role("dialog", name="My tools")
    sh.wait_for(timeout=T)
    tab = sh.get_by_role("tab", name="Templates")
    rc.tab_to(pg, tab)
    pg.keyboard.press("Enter")
    pg.wait_for_timeout(1800)
    S.check("My tools: the Templates tab is reached and selected by keyboard", tab.get_attribute("aria-selected") == "true", str(tab.get_attribute("aria-selected")))
    audit(S, pg, "My tools > Templates", c.touch)
    acts = sh.get_by_role("button", name=f"Actions for {n['style']}", exact=True).first
    kb_open(c, acts)
    items = [x.inner_text() for x in pg.get_by_role("menuitem").all() if x.is_visible()]
    S.saw("row actions menu by keyboard", json.dumps(items))
    S.check("Templates row: the Actions menu opens by Enter", len(items) >= 4 or top_dialog(pg) is not None, json.dumps(items))
    menu_kind = "menu" if any(pg.get_by_role("menuitem").nth(i).is_visible() for i in range(pg.get_by_role("menuitem").count())) else "sheet"
    for _ in range(14):
        f = focus_label(pg)
        if f.startswith("Share to library"):
            break
        pg.keyboard.press("ArrowDown" if menu_kind == "menu" else "Tab")
    S.check(f"Templates row: {'arrow keys' if menu_kind == 'menu' else 'Tab (touch: an action sheet)'} reach 'Share to library'",
            focus_label(pg).startswith("Share to library"), f"{menu_kind}: {focus_label(pg)}")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(700)
    S.check("Templates row: Escape returns focus to the row's Actions button", focus_label(pg).startswith(f"Actions for {n['style']}"), focus_label(pg))
    kb_open(c, acts)
    for _ in range(14):
        if focus_label(pg).startswith("Share to library"):
            break
        pg.keyboard.press("ArrowDown" if menu_kind == "menu" else "Tab")
    pg.keyboard.press("Enter")
    sp = pg.get_by_role("dialog", name="Share to library")
    sp.wait_for(timeout=T)
    pg.wait_for_timeout(3500)
    audit(S, pg, "share preview", c.touch)
    sw = sp.get_by_role("switch")
    if sw.count():
        rc.tab_to(pg, sw.first)
        pg.keyboard.press("Space")
        pg.wait_for_timeout(1200)
        S.check("share preview: the number switch toggles with Space", sw.first.get_attribute("aria-checked") == "true", "")
        pg.keyboard.press("Space")
        pg.wait_for_timeout(1200)
    esc_returns(S, pg, "share preview", r"^Actions for ")
    c.close()
    # review queue (admin): reach every control, approve nothing
    a = S.ctx("admin", Ctx(b, base, vp, ADMIN))
    pg = a.page
    a.goto("/journal/notebook?view=all")
    kb_open(a, pg.get_by_role("button", name="Templates", exact=True).first)
    sheet = pg.get_by_role("dialog", name="New note")
    kb_open(a, sheet.get_by_role("button", name="Browse the community gallery"))
    pg.wait_for_timeout(2000)
    rq = sheet.get_by_role("button", name="Review queue", exact=True)
    kb_open(a, rq)
    pg.wait_for_timeout(1500)
    S.check("review queue: opened by keyboard", rq.get_attribute("aria-pressed") == "true", "")
    audit(S, pg, "review queue (gallery)", a.touch)


def _theme_pass(S, b, base, vp, theme_label, tag):
    c = Ctx(b, base, vp, A[vp])
    S.ctxs[f"A-{tag}"] = c
    pg = c.page
    got = set_theme(c, theme_label)
    S.saw(f"data-theme after picking {theme_label}", got)
    sheet, lib = open_picker(c)
    S.shot(pg, f"theme-{tag}")
    S.measure(pg, f"{tag}-picker", "dialog", touch=c.touch)
    det = library_detail(c, lib, "Pre-market prep")
    S.shot(pg, f"theme-{tag}-detail")
    S.measure(pg, f"{tag}-detail", "dialog", touch=c.touch)
    pg.keyboard.press("Escape")
    det2 = library_detail(c, lib, "Setup study")
    click(c, det2.get_by_role("button", name="Use this template"))
    ad = adopt_sheet(pg)
    S.shot(pg, f"theme-{tag}-adopt")
    S.measure(pg, f"{tag}-adopt", "dialog", touch=c.touch)
    dims = pg.evaluate("""() => [...document.querySelectorAll('[role=dialog] *')].filter(e => { const o = parseFloat(getComputedStyle(e).opacity);
        return o < 1 && e.innerText && e.innerText.trim().length > 0 && e.getBoundingClientRect().width > 0 }).map(e => ({cls: String(e.className).slice(0, 60), o: getComputedStyle(e).opacity, t: e.innerText.slice(0, 60)}))""")
    S.saw(f"{tag}: dimmed (opacity < 1) text in the adopt sheet", json.dumps(dims)[:600])
    pg.keyboard.press("Escape")
    n = names(vp)
    sp = open_share(c, "Templates", n["style"])
    S.shot(pg, f"theme-{tag}-share")
    S.measure(pg, f"{tag}-share", "dialog", touch=c.touch)
    pg.keyboard.press("Escape")
    c.goto("/journal/notebook?view=all")
    my_tools(c, "Templates")
    S.shot(pg, f"theme-{tag}-mytools")
    S.measure(pg, f"{tag}-mytools", "dialog", touch=c.touch)
    pg.keyboard.press("Escape")
    gsheet = gallery(c)
    cr = chip_report(pg, "[role=dialog]", hover=not c.touch)
    S.saw(f"{theme_label}: gallery active chips", json.dumps(cr)[:800])
    S.check(f"R5 {theme_label}: every active gallery chip holds >= 4.5:1 at rest and hovered",
            cr["rest"] and all(x["ratio"] >= 4.5 for x in cr["rest"] + cr["hover"]), json.dumps(cr)[:400])
    S.shot(pg, f"theme-{tag}-gallery")
    S.measure(pg, f"{tag}-gallery", "dialog", touch=c.touch)
    for surf, m in S.d["metrics"].items():
        if surf.startswith(tag):
            cc = [v for k in ("axe_sheet", "axe_page") for v in (m.get(k) or {}).get("violations") or [] if v["id"] == "color-contrast" and v["impact"] in ("serious", "critical")]
            S.check(f"{theme_label}: axe color-contrast has no serious finding on {surf}", not cc, json.dumps([x["summary"][:160] for x in cc])[:400])
    c.close()
    return got


def w11_15(S, b, base, vp, kbd=False):
    if vp not in ("1200", "390"):
        S.note("themes are walked at 1200 and 390 (plan)")
        S.check("not walked at this viewport by the plan", True, "")
        return
    c = Ctx(b, base, vp, A[vp]); pg = c.page
    c.goto("/journal/notebook?view=all")
    orig = pg.evaluate("() => document.documentElement.dataset.theme")
    S.saw("theme before the pass (data-theme)", orig)
    c.close()
    for label, tag in (("Light", "light"), ("Graphite", "dark"), ("OLED Black", "oled")):
        _theme_pass(S, b, base, vp, label, tag)
    S.note("Helpful line themes: the line only exists on a day-3 note (W11.9, clock boots); shot there in the default theme.")


def w11_16(S, b, base, vp, kbd=False):
    if vp != "1200":
        S.note("1200 only")
        S.check("not walked at this viewport by the plan", True, "")
        return
    n = names(vp)
    res = {}
    for motion in ("reduce", "no-preference"):
        c = Ctx(b, base, vp, A[vp], motion=motion)
        S.ctxs[f"A-{motion}"] = c
        pg = c.page
        sheet, lib = open_picker(c)
        anims = pg.evaluate("() => document.getAnimations().filter(a => a.playState === 'running').length")
        sp_url = None
        sp = open_share(c, "Templates", n["style"])
        sw = sp.get_by_role("switch").first
        if not sw.count():
            raise Inconclusive("the share preview has no number switch")
        tr = sw.evaluate("""e => { const all = [e, ...e.querySelectorAll('*')]; return all.map(x => { const s = getComputedStyle(x);
            return s.transitionDuration + '|' + s.transitionProperty }) }""")
        res[motion] = {"library_running_animations": anims, "switch_transitions": tr}
        if motion == "no-preference":
            click(c, sw)
            pg.wait_for_timeout(80)
            S.shot(pg, "motion-on")
            click(c, sw)
        c.close()
    S.saw("transitions by motion setting", json.dumps(res))
    red = res["reduce"]["switch_transitions"]
    nop = res["no-preference"]["switch_transitions"]
    nz = lambda lst: any(any(float(d.strip().rstrip("s") or 0) > 0.001 for d in t.split("|")[0].split(",")) for t in lst)
    S.check("reduced motion: the share preview's number switch has no transition", not nz(red), json.dumps(red))
    S.check("no-preference: the transition exists", nz(nop), json.dumps(nop))
    S.check("reduced motion: nothing in the library animates", res["reduce"]["library_running_animations"] == 0, str(res["reduce"]["library_running_animations"]))


# ── F-DEF-1 retests ──────────────────────────────────────────────────────────────────────────────

def _note_page(c, pid, base, title):
    pg = c.page
    c.goto("/journal/notebook?view=all")
    r = pg.request.post(base + "/api/j2/notes", data={"title": title, "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Retest."}]}]}})
    nid = r.json()["note"]["id"]
    c.goto(f"/journal/notebook?note={nid}")
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    pg.wait_for_timeout(2000)
    return nid


def box_of(loc):
    return loc.first.evaluate("e => { const b = e.getBoundingClientRect(); return {w: Math.round(b.width*10)/10, h: Math.round(b.height*10)/10, vis: b.width > 0 && getComputedStyle(e).display !== 'none'} }")


def fdef_note(S, b, base, vp, pid, label, theme=None):
    c = Ctx(b, base, vp, pid)
    S.ctxs[f"{pid}-{label}"] = c
    pg = c.page
    if theme:
        set_theme(c, theme)
    _note_page(c, pid, base, f"F-DEF retest {label}")
    tg = pg.locator("[data-note-details-toggle]")
    out = {}
    if tg.count():
        bx = box_of(tg)
        out["toggle"] = bx
        out["toggle_opacity"] = tg.first.evaluate("e => getComputedStyle(e).opacity")
        out["toggle_text"] = tg.first.inner_text()
    sel = pg.locator("select:has(option[value=''])").filter(has=pg.locator("option", has_text="Unfiled"))
    if sel.count():
        out["folder_select"] = box_of(sel)
    ti = pg.get_by_placeholder("Title")
    if ti.count():
        out["title_input"] = box_of(ti)
    fab = pg.locator("button[title='Help & Feedback']")
    if fab.count():
        out["feedback_fab"] = box_of(fab)
    m = S.measure(pg, f"note-{pid}-{label}", None, touch=c.touch)
    ts = [v for v in (m.get("axe_page") or {}).get("violations") or [] if v["id"] in ("target-size", "color-contrast")]
    out["axe_target_or_contrast"] = [{"id": v["id"], "impact": v["impact"], "targets": v["targets"], "summary": v["summary"][:200]} for v in ts]
    S.shot(pg, f"note-{pid}" + (f"-{theme.split()[0].lower()}" if theme else ""))
    if theme:
        set_theme(c, "OLED Black")
    return out


def fdef(S, b, base, vp, kbd=False, pids=None):
    pids = pids or {"1200": ["P01"], "820": ["P01", "P04"], "390": ["P01", "P04"]}[vp]
    for pid in pids:
        o = fdef_note(S, b, base, vp, pid, "note")
        S.saw(f"{pid} measured", json.dumps(o))
        if vp == "1200":
            t = o.get("toggle")
            S.check(f"D-W11-001 {pid} 1200: the note details toggle is at least 24 px tall", t and t["h"] >= 24, json.dumps(t))
            S.check(f"D-W11-001 {pid} 1200: axe target-size has no finding on the note page",
                    not [x for x in o["axe_target_or_contrast"] if x["id"] == "target-size"], json.dumps(o["axe_target_or_contrast"]))
        else:
            fs = o.get("folder_select")
            if vp == "820":
                S.check(f"D-W11-002 {pid} 820: the header Folder select is at least 44 px tall", fs and fs["vis"] and fs["h"] >= 44, json.dumps(fs))
            else:
                S.saw(f"{pid} 390 folder select (lives in More, display:none expected)", json.dumps(fs))
            ti = o.get("title_input")
            S.check(f"D-W11-003 {pid} {vp}: the title input is at least 44 px tall", ti and ti["h"] >= 44, json.dumps(ti))
            fb = o.get("feedback_fab")
            S.check(f"D-W11-004 {pid} {vp}: FeedbackWidget '?' is 44 x 44", fb and fb["w"] >= 44 and fb["h"] >= 44, json.dumps(fb))
    if vp == "1200":
        o = fdef_note(S, b, base, vp, "P01", "light", theme="Light")
        S.saw("P01 light measured", json.dumps(o))
        S.check("m-3 P01 1200 light: the quiet details toggle reads opacity 0.9", o.get("toggle_opacity") == "0.9", str(o.get("toggle_opacity")))
        S.check("m-3 P01 1200 light: axe color-contrast has no finding on the note page (no details)",
                not [x for x in o["axe_target_or_contrast"] if x["id"] == "color-contrast"], json.dumps(o["axe_target_or_contrast"])[:400])
    # D-W11-007 / W11-R50b: P25 a.05
    c = Ctx(b, base, vp, "P25")
    S.ctxs["P25"] = c
    pg = c.page
    r = RunA(c); rw = rowA()
    c.goto("/journal/notebook?view=all")
    rc.a_seed_note(r, {"title": f"Campaign P25 retest {vp}", "paras": ["Formulas."]}, rw)
    rc.a_open_note(r, {"note": "n1"}, rw)
    rc.a_open_builder(r, {}, rw)
    rc.a_builder_blank(r, {"source": "Closed trades"}, rw)
    dlg = rc.builder(pg)
    pg.wait_for_timeout(2000)
    live0 = rc.live_text(pg)
    rc.a_builder_formula(r, {"name": "Winner", "formula": "If([net] > 0, 1", "expect_error": True}, rw)
    pg.wait_for_timeout(2500)
    last = dlg.locator("[data-testid=builder-preview-last]")
    bar = dlg.locator("[data-testid=builder-summary-bar]")
    live = rc.live_text(pg)
    state = {"line_visible": visible(last), "line_text": last.first.inner_text() if last.count() else None,
             "live": live, "bar": bar.first.inner_text() if bar.count() and bar.first.is_visible() else None,
             "opacity": pg.evaluate("() => { const e = document.querySelector('[class*=dimmed]'); return e ? getComputedStyle(e).opacity : null }"),
             "busy_opacity_var": pg.evaluate("() => { const e = document.querySelector('[class*=panel]'); return e ? getComputedStyle(e).getPropertyValue('--preview-dim-opacity').trim() : null }")}
    S.saw("P25 a.05 broken formula state", json.dumps(state))
    S.saw("builder checks", json.dumps(rw["checks"]))
    S.check("the broken formula shows its inline error", any(x["ok"] for x in rw["checks"] if "inline sentence" in x["what"]), json.dumps(rw["checks"])[:300])
    if vp == "390":
        S.check("390: the summary bar leads with 'Showing the last result.'", bool(state["bar"]) and state["bar"].startswith("Showing the last result."), str(state["bar"]))
    else:
        S.check(f"{vp}: 'Showing the last result.' is visible beside the dimmed preview", state["line_visible"] and state["line_text"] == "Showing the last result.", str(state["line_text"]))
    S.check("the live region stays summary-only (no 'Showing the last result.')", "Showing the last result." not in (live or ""), live)
    S.check("preview dim opacity reads 0.9", state["opacity"] in ("0.9",) or (state["opacity"] is None and state["busy_opacity_var"] == "0.9"), json.dumps([state["opacity"], state["busy_opacity_var"]]))
    S.shot(pg, "p25-broken")
    m = S.measure(pg, "p25-builder-broken", "dialog", touch=c.touch)
    cc = [v for k in ("axe_sheet",) for v in (m.get(k) or {}).get("violations") or [] if v["id"] == "color-contrast"]
    S.check("axe color-contrast: no finding on the builder with the dimmed preview", not cc, json.dumps([x["summary"][:200] for x in cc]))
    rc.a_builder_formula_append(r, {"text": ", 0)", "expect_valid": True}, rw)
    pg.wait_for_timeout(2500)
    S.check("fixed, the line is gone", not visible(dlg.locator("[data-testid=builder-preview-last]")) and
            not (bar.count() and bar.first.is_visible() and bar.first.inner_text().startswith("Showing the last result.")), "")
    rc.a_close_dialog(r, {"discard": True}, rw)


def fdef2(S, b, base, vp, kbd=False):
    """D-W11-001 for P14 (a note with a routine) and P46 (a widget and a routine) at 1200, on the retest data dir."""
    if vp != "1200":
        S.check("1200 only", True, ""); return
    for pid in ("P14", "P46"):
        c = Ctx(b, base, vp, pid)
        S.ctxs[pid] = c
        pg = c.page
        r = RunA(c); rw = rowA()
        c.goto("/journal/notebook?view=all")
        if pid == "P14":
            api(pid, "/api/j2/routines", {"name": "P14 routine", "items": [{"text": "Item one"}, {"text": "Item two"}], "schedule": {"kind": "every"}}, base=base)
        rc.a_seed_note(r, {"title": f"Campaign {pid} retest", "paras": ["Retest."]}, rw)
        rc.a_open_note(r, {"note": "n1"}, rw)
        if pid == "P46":
            rc.a_open_builder(r, {}, rw)
            rc.a_builder_example(r, {"card": "shelf:daily-pnl-bars"}, rw)
            rc.a_builder_save(r, {"expect_frame": "Daily P&L bars"}, rw)
        rc.a_insert_routine(r, {"existing": "P14 routine" if pid == "P14" else "Flag routine"}, rw)
        tg = pg.locator("[data-note-details-toggle]")
        bx = box_of(tg) if tg.count() else None
        m = S.measure(pg, f"note-{pid}", None, touch=False)
        ts = [v for v in (m.get("axe_page") or {}).get("violations") or [] if v["id"] == "target-size"]
        S.saw(f"{pid} toggle", json.dumps(bx))
        S.check(f"D-W11-001 {pid} 1200: the note details toggle is at least 24 px tall", bx and bx["h"] >= 24, json.dumps(bx))
        S.check(f"D-W11-001 {pid} 1200: axe target-size has no finding on the note page", not ts, json.dumps([t["targets"] for t in ts]))
        S.shot(pg, f"note-{pid}")
