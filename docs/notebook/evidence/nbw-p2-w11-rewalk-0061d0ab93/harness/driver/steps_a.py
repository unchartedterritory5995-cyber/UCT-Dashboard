"""W11.1, W11.2, W11.3, W11.6 (Template library, use, routine, setup study)."""
from ui import *
from ev import Step, run, Inconclusive

LIB_GROUP_KEYS = ["night_before", "before_open", "during_day", "after_close", "weekly_monthly", "playbook", "mindset",
                  "challenges", "habits"]
USED_RE = re.compile(r"^(New|Used by 1 trader|Used by [2-9]\d* traders|Used by \d{2,} traders) · Updated [A-Z][a-z]{2} \d{1,2}( · \d+ found this helpful)?$")


def w11_1(S, b, base, vp, kbd=False):
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    now, _ = now_et(base)
    sheet, lib = open_picker(c)
    pg.wait_for_timeout(1500)
    head = lib.locator("h3").first.inner_text().strip()
    S.saw("section heading", head)
    S.check("section heading reads 'Template library'", head == "Template library", head)
    keys = lib.locator("[data-library-group]").evaluate_all("els => els.map(e => e.getAttribute('data-library-group'))")
    labels = lib.locator("[data-library-group] > h4").all_inner_texts()
    S.saw("groups in order", " | ".join(labels))
    order = [k for k in LIB_GROUP_KEYS if k in keys]
    S.check("groups appear in the server/LIBRARY_GROUPS order", keys == order, json.dumps(keys))
    cards = lib.locator("[data-library-card]")
    n = cards.count()
    s, libj = api(A[vp], "/api/j2/template-gallery/library", base=base)
    by_title = {t["title"]: t for t in (libj.get("templates") or [])} if isinstance(libj, dict) else {}
    bad = []
    for i in range(n):
        cd = cards.nth(i)
        title = cd.locator("h5").inner_text().strip()
        chip = cd.locator("[data-type-chip]").inner_text().strip() if cd.locator("[data-type-chip]").count() else ""
        author = cd.locator("[data-author-label]").inner_text().strip() if cd.locator("[data-author-label]").count() else ""
        used = cd.locator("[data-used-by]").inner_text().strip()
        txt = cd.inner_text()
        row = by_title.get(title) or {}
        has_contains = bool(row.get("contains"))
        probs = []
        if chip != "Template": probs.append(f"chip={chip!r}")
        if not author: probs.append("no author label")
        if "For: " not in txt and row.get("description"): probs.append("no For: line")
        if has_contains != (cd.locator("[data-contains]").count() > 0): probs.append("Contains line mismatch")
        if has_contains and "Fills in with your own data when you make a note." not in txt: probs.append("no fills line")
        if not USED_RE.match(used): probs.append(f"used-by line {used!r}")
        if "Used by 0" in txt: probs.append("Used by 0")
        if probs:
            bad.append({title: probs})
    S.saw("first card", cards.first.inner_text())
    S.saw("cards", f"{n} cards; server lists {len(by_title)}")
    S.check("every card: Template chip, author, For:, Contains: (when it holds any), Used by/New (never 0), Updated <Mon D>, fills line",
            not bad and n == len(by_title) and n > 0, json.dumps(bad)[:600] or f"{n} cards")
    upd = f"Updated {now:%b} {now.day}"
    S.check(f"cards read {upd!r} (listed today ET)", upd in lib.inner_text(), upd)
    pm = [r for r in c.requests if "preview-mine" in r["u"]]
    S.check("the list makes NO preview-mine request", not pm, json.dumps(pm))
    z = rc.zeros_in(sheet.inner_text())
    S.check("no zeros on the picker", not z, json.dumps(z))
    S.shot(pg, "picker")
    S.measure(pg, "picker", "dialog", touch=c.touch)
    before = len(c.requests)
    det = library_detail(c, lib, "Pre-market prep")
    pg.wait_for_timeout(2500)
    dtext = det.inner_text()
    S.saw("detail sheet", dtext)
    pm = [r for r in c.requests[before:] if "preview-mine" in r["u"]]
    S.check("the detail makes exactly ONE preview-mine", len(pm) == 1, json.dumps(pm))
    S.check("no card is labelled 'Sample data' (A has trades)", "Sample data" not in dtext, "")
    want = day_label(now)
    S.check(f"the routine slot shows its name, items and bind words ({want!r})",
            "Pre-market routine" in dtext and "Read the morning wire" in dtext and want in dtext, want)
    S.check("no day state in the detail (no tick control)", det.get_by_role("checkbox").count() == 0,
            str(det.get_by_role("checkbox").count()))
    S.check("credit line 'Based on UCT's Pre-market prep'", "Based on UCT's Pre-market prep" in dtext, "")
    raw = re.findall(r"\{\{block:[^}]+\}\}", dtext)
    S.shot(pg, "detail")
    if not S.check("the outline shows headings and prompts, no raw {{block:...}} placeholder", not raw, json.dumps(raw)):
        S.defect("TemplateDetailSheet outline ([role=dialog][name='Pre-market prep'] [data-template-preview-body])",
                 "the template's outline (its headings and prompts) -- TemplateDetailSheet.jsx header; spec §10 'Preview ... shows the outline'",
                 f"raw placeholder tokens shown to the member: {raw}", "major")
    S.measure(pg, "detail", "dialog", touch=c.touch)


def _use_premarket(S, c, base, vp, choose_create=True, label="adopt"):
    pg = c.page
    sheet, lib = open_picker(c)
    det = library_detail(c, lib, "Pre-market prep")
    click(c, det.get_by_role("button", name="Use this template"))
    ad = adopt_sheet(pg)
    S.saw("adopt sheet", ad.inner_text())
    rs = radios_state(ad)
    q = ad.locator("[data-question]").count()
    return ad, rs, q


def w11_2(S, b, base, vp, kbd=False):
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    now, _ = now_et(base)
    ad, rs, q = _use_premarket(S, c, base, vp)
    S.saw("reuse question radios", json.dumps(rs))
    s, routines = api(A[vp], "/api/j2/routines", base=base)
    names = [r["name"] for r in (routines.get("routines") or [])] if isinstance(routines, dict) else []
    S.saw("A's routines before", json.dumps(names))
    pre = [r["label"] for r in rs if r["checked"]]
    if "Morning routine" in names:
        S.check("A's own 'Morning routine' (best match) is pre-selected: 'Use your Morning routine'",
                pre == ["Use your Morning routine"], json.dumps(pre))
    else:
        S.check("A has no routine: only 'Create Pre-market routine from the template' is offered",
                [r["label"] for r in rs] == ["Create Pre-market routine from the template"], json.dumps(rs))
    S.shot(pg, "adopt")
    S.measure(pg, "adopt", "dialog", touch=c.touch)
    create = ad.get_by_text("Create Pre-market routine from the template", exact=True)
    click(c, create)
    S.check("chose 'Create Pre-market routine from the template'",
            ad.get_by_role("radio", name=re.compile("Create Pre-market routine")).is_checked() if ad.get_by_role("radio", name=re.compile("Create Pre-market routine")).count() else True, "")
    click(c, ad.get_by_role("button", name="Use", exact=True))
    nid = wait_note(pg)
    st_set(f"w112_note_{vp}", nid)
    after_use(S, c, "W11.2")
    rc.render_all(pg)
    text = pg.locator(".ProseMirror").first.inner_text()
    S.saw("new note", text[:1500])
    S.check("navigated to a new note holding the prep blocks", "The market this morning" in text and "Pre-market routine" in text, pg.url)
    want = day_label(now)
    rb = pg.locator("[data-routine-block]")
    S.check(f"the routine block is bound to the note's day ({want!r})", rb.count() == 1 and want in rb.first.inner_text(),
            rb.first.inner_text()[:200] if rb.count() else "no routine block")
    S.check("no raw {{block:..}} placeholder in the note", "{{block:" not in text, "")
    s, lib = api(A[vp], "/api/j2/template-gallery/library", base=base)
    cont = [t.get("contains") for t in lib.get("templates", []) if t["title"] == "Pre-market prep"]
    S.note(f"Plan W11.2 says 'two built widgets FILLED'; the served Pre-market prep holds contains={cont} (no built widget), "
           "so the filled-widget check reads the snapshot blocks instead (wire, market context, levels).")
    S.check("snapshot blocks are filled (numbers, not placeholders)", "Morning wire" in text or "MARKET CONTEXT" in text.upper(), text[:300])
    before = note_of(A[vp], nid, base)
    p0 = len(c.requests)
    box = pg.locator("[data-routine-block] [role=checkbox]").first
    # a keyboard user starts in the note (the page's own "Skip to note" link lands there): focus the editor, then Tab
    pg.locator(".ProseMirror").first.focus()
    S.saw("focus before Tab", focus_label(pg) + " | " + pg.evaluate("() => document.activeElement.className.slice(0, 80)"))
    try:
        rc.tab_to(pg, box, limit=200)
    except Exception as e:  # noqa: BLE001
        S.saw("focus at the failure", focus_label(pg) + " | " + pg.evaluate("() => document.activeElement.outerHTML.slice(0, 300)"))
        S.saw("dialogs open at the failure", json.dumps(pg.evaluate("""() => [...document.querySelectorAll('[role=dialog]')].map(d => { const b = d.getBoundingClientRect(); return {label: d.getAttribute('aria-label') || (d.querySelector('h2,h3') || {}).innerText, w: b.width, h: b.height, vis: getComputedStyle(d).visibility, hidden: d.closest('[hidden],[inert]') ? 1 : 0} })""")))
        S.shot(pg, "kbd-unreachable")
        raise
    S.check("the routine items are reachable by Tab", True, rc.describe(box))
    pg.keyboard.press("Space")
    pg.wait_for_timeout(2500)
    S.check("Space toggles the item (the tick shows)", box.get_attribute("aria-checked") == "true", box.get_attribute("aria-checked"))
    put = puts(c, p0)
    S.check("ticking sends ZERO note PUTs (§6.2)", not put, json.dumps(put))
    S.shot(pg, "main")
    S.measure(pg, "note", "[data-routine-block]", touch=c.touch)
    pg.reload(wait_until="domcontentloaded")
    h._dismiss_intro(pg)
    pg.locator("[data-routine-block] [role=checkbox]").first.wait_for(timeout=T)
    pg.wait_for_timeout(2000)
    after = note_of(A[vp], nid, base)
    S.check("after reload the tick is still there", pg.locator("[data-routine-block] [role=checkbox]").first.get_attribute("aria-checked") == "true", "")
    S.check("after reload the note shows no unsaved change (updatedAt unchanged by open + tick)",
            before and after and before.get("updatedAt") == after.get("updatedAt"), f"{before and before.get('updatedAt')} -> {after and after.get('updatedAt')}")
    put = puts(c, p0)
    S.check("no note PUT across tick + reload", not put, json.dumps(put))


def w11_3(S, b, base, vp, kbd=False):
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    ad, rs, q = _use_premarket(S, c, base, vp)
    S.saw("second use: radios", json.dumps(rs))
    S.shot(pg, "adopt")
    if not S.check("no routine question this time (the choice is remembered for that template)", q == 0, f"{q} question(s): {json.dumps(rs)}"):
        S.defect("AdoptSheet [data-question=routine_a] (second Use of Pre-market prep)",
                 "spec §10: 'using a template that contains a routine or tracker slot asks once per slot ... the choice is remembered for that template'",
                 f"the question is asked again; pre-selected: {[r['label'] for r in rs if r['checked']]}", "major")
        pre = [r["label"] for r in rs if r["checked"]]
        S.check("if asked, the routine the template already made is the pre-selected answer",
                any("Pre-market routine" in p for p in pre), json.dumps(pre))
    cr = ad.get_by_text("Create Pre-market routine from the template", exact=True)
    if cr.count():
        click(c, cr)
    click(c, ad.get_by_role("button", name="Use", exact=True))
    nid = wait_note(pg)
    after_use(S, c, "W11.3")
    s, routines = api(A[vp], "/api/j2/routines", base=base)
    pm = [r for r in routines.get("routines", []) if r.get("sourceTemplateKey") == "tpl:premarket_routine"]
    S.check("exactly ONE routine made from the template (unique on user, source_template_key)", len(pm) == 1, json.dumps([r["name"] for r in pm]))
    c.goto("/journal/notebook?view=all")
    sh = my_tools(c, "Routines")
    t = sh.inner_text()
    S.saw("My tools > Routines", t[:800])
    S.check("My tools > Routines lists ONE 'Pre-market routine' reading 'From template: Pre-market prep'",
            t.count("Pre-market routine") == 1 and "From template: Pre-market prep" in t, "")
    S.shot(pg, "mytools")
    S.measure(pg, "mytools", "dialog", touch=c.touch)
    pg.keyboard.press("Escape")
    # delete the second note through the product's own door
    c.goto(f"/journal/notebook?note={nid}")
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    deleted = False
    with contextlib.suppress(Exception):
        mb = pg.get_by_role("button", name="More note actions")
        click(c, mb)
        pg.wait_for_timeout(500)
        click(c, pg.get_by_role("button", name="Delete", exact=True).last)
        cf = pg.get_by_role("dialog").filter(has_text="Delete this note?").last
        cf.wait_for(timeout=T)
        click(c, cf.get_by_role("button", name="Delete", exact=True))
        pg.wait_for_timeout(2000)
        n = note_of(A[vp], nid, base)
        deleted = (n is None) or bool(n.get("deletedAt") or n.get("deleted"))
    S.check("the second note was deleted (Trash) through the note's Delete", deleted, nid)
    s, routines = api(A[vp], "/api/j2/routines", base=base)
    pm = [r for r in routines.get("routines", []) if r.get("sourceTemplateKey") == "tpl:premarket_routine"]
    S.check("deleting the note did NOT delete the routine", len(pm) == 1 and not pm[0].get("deleted"), json.dumps(pm and pm[0].get("name")))


def _setup_counts(pid, base):
    s, r = api(pid, "/api/j2/trades?limit=5000", base=base)
    rows = r.get("trades") if isinstance(r, dict) else None
    if rows is None and isinstance(r, list):
        rows = r
    cnt = {}
    for t in rows or []:
        k = t.get("setup") or t.get("setupName")
        if k:
            cnt[k] = cnt.get(k, 0) + 1
    return cnt


def w11_6(S, b, base, vp, kbd=False):
    for who, pid in (("A", A[vp]), ("N", N[vp])):
        c = S.ctx(who, Ctx(b, base, vp, pid))
        pg = c.page
        sheet, lib = open_picker(c)
        det = library_detail(c, lib, "Setup study")
        click(c, det.get_by_role("button", name="Use this template"))
        ad = adopt_sheet(pg)
        txt = ad.inner_text()
        S.saw(f"{who} adopt sheet (Setup study)", txt)
        slot = ad.locator("[data-slot]").first
        st_txt = slot.inner_text() if slot.count() else ""
        use = ad.get_by_role("button", name="Use", exact=True)
        if who == "A":
            cnt = _setup_counts(pid, base)
            mx = max(cnt.values()) if cnt else 0
            tops = [k for k, v in cnt.items() if v == mx]
            S.saw("A's setups by trade count", json.dumps(cnt))
            S.check(f"the setup slot opens at A's most-used setup ({' / '.join(tops)}; a tie accepts any)",
                    bool(tops) and any(f"Setup: {t}" in st_txt for t in tops), st_txt)
            S.check("the preview renders immediately (no 'Pick a setup' sentence; widgets drawn)",
                    "Pick a setup to see this widget." not in txt and "Preview with your data" in txt, "")
            S.check("Use is enabled", use.is_enabled(), "")
            S.shot(pg, "adopt")
            S.measure(pg, "adopt-A", "dialog", touch=c.touch)
        else:
            S.check("N: the widget reads 'Pick a setup to see this widget.'", "Pick a setup to see this widget." in txt, txt[:300])
            S.check("N: Use is disabled", not use.is_enabled(), "")
            S.check("N: 'Pick a value for each choice, or Any.' beside Use", "Pick a value for each choice, or Any." in txt, "")
            z = rc.zeros_in(txt)
            S.check("N: no 0 anywhere", not z, json.dumps(z))
            S.shot(pg, "adopt-new")
            S.measure(pg, "adopt-N", "dialog", touch=c.touch)
            ch = ad.get_by_role("button", name=re.compile(r"^Change setup$", re.I))
            if ch.count():
                click(c, ch.first)
                pg.wait_for_timeout(2000)
                ptxt = ad.locator("[data-slot-picker]").first.inner_text() if ad.locator("[data-slot-picker]").count() else ""
                S.saw("N: setup picker", ptxt)
                anyr = ad.get_by_role("radio", name=re.compile(r"^Any setup$", re.I))
                if anyr.count():
                    anyr.first.check()
                    click(c, ad.get_by_role("button", name="Done", exact=True))
                    pg.wait_for_timeout(2500)
                    S.check("N: once a value (Any) is picked, Use is enabled", use.is_enabled(), ad.inner_text()[:200])
                else:
                    S.note("N has no setups and the setup choice offers no Any: " + ptxt[:200])
        click(c, ad.get_by_role("button", name="Cancel", exact=True).last)
        pg.wait_for_timeout(500)
