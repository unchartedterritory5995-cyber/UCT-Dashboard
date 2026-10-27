"""W11.10 (Templates management), W11.11 (public), W11.13 (keyboard open), W11.17 (chips and doors)."""
from ui import *
from adapter import R as RunA, row as rowA
from ev import Inconclusive
from steps_b import names, account_names, open_share


def msg(sh):
    m = sh.locator("[data-testid=my-tools-message]")
    return m.first.inner_text().strip() if m.count() else ""


def menu_items(pg):
    return [x.inner_text().strip() for x in pg.get_by_role("menuitem").all() if x.is_visible()]


def open_menu(c, sh, name):
    click(c, sh.get_by_role("button", name=f"Actions for {name}", exact=True).first.first)
    c.page.wait_for_timeout(700)
    items = menu_items(c.page)
    if not items:   # touch: a bottom sheet of buttons
        d = top_dialog(c.page)
        items = [x.inner_text().strip() for x in d.get_by_role("button").all() if x.is_visible()] if d is not None else []
    return items


def pick(c, label):
    pg = c.page
    it = pg.get_by_role("menuitem", name=label)
    if not visible(it):
        d = top_dialog(pg)
        it = d.get_by_role("button", name=label, exact=True) if d is not None else it
    click(c, it.last)
    pg.wait_for_timeout(1500)


def filt(c, sh, label):
    click(c, sh.get_by_role("group", name="Show").get_by_role("button", name=label, exact=True))
    c.page.wait_for_timeout(1800)


def w11_10(S, b, base, vp, kbd=False):
    n = names(vp)
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    c.goto("/journal/notebook?view=all")
    sh = my_tools(c, "Templates")
    rows = sh.locator("[data-testid=my-tools-template-row]")
    rt = rows.all_inner_texts()
    S.saw("Templates rows", json.dumps(rt)[:1500])
    pm = next((r for r in rt if r.startswith("Pre-market prep")), "")
    S.check("a row shows name, kind, 'Used in <N> notes', last edited, and the credit for a copy",
            bool(pm) and "Daily prep" in pm and re.search(r"Used in \d+ notes?", pm) and "Edited" in pm and "Based on UCT's Pre-market prep" in pm, pm)
    ss = next((r for r in rt if r.startswith(n["style"])), "")
    S.check("an own template with no note reads 'Not in any note' and no credit", "Not in any note" in ss and "Based on" not in ss, ss)
    if vp == "390":
        hts = rows.evaluate_all("els => els.map(e => Math.round(e.getBoundingClientRect().height))")
        S.check("phone: rows are at least 56 px", hts and min(hts) >= 56, json.dumps(hts))
    S.shot(pg, "mytools")
    S.measure(pg, "templates-tab", "dialog", touch=c.touch)
    items = open_menu(c, sh, n["style"])
    S.saw("Active row menu", json.dumps(items))
    S.check("Active row actions: Open, Rename, Duplicate, Share to library, Archive (no Delete permanently)",
            all(any(i.startswith(x) for i in items) for x in ("Open", "Rename", "Duplicate", "Share to library", "Archive"))
            and not any(i.startswith("Delete permanently") for i in items), json.dumps(items))
    pick(c, "Duplicate")
    m1 = msg(sh)
    S.saw("after Duplicate", m1)
    mm = re.search(r"Made “(.+)”", m1)
    dup = mm.group(1) if mm else None
    S.check("Duplicate makes a copy ('Made “<name>”.')", bool(dup), m1)
    if not dup:
        raise Inconclusive("no duplicate to manage")
    new = f"Manage me {vp}"
    open_menu(c, sh, dup)
    pick(c, "Rename")
    pn = sh.locator("[data-testid=my-tools-rename]")
    pn.get_by_label("Name", exact=True).fill(new)
    click(c, pn.get_by_role("button", name="Save name"))
    pg.wait_for_timeout(2000)
    S.check(f"Rename -> 'Renamed to “{new}”.'", f"Renamed to “{new}”." in msg(sh), msg(sh))
    items = open_menu(c, sh, new)
    arch_hint = ""
    with contextlib.suppress(Exception):
        it = pg.get_by_role("menuitem", name=re.compile("^Archive")).last
        if not visible(it):
            it = top_dialog(pg).get_by_role("button", name=re.compile("^Archive")).last
        arch_hint = (it.get_attribute("aria-description") or it.get_attribute("title") or "") + " [" + it.inner_text() + "]"
    S.saw("Archive item (with its hint)", arch_hint)
    pick(c, re.compile("^Archive"))
    S.saw("after Archive", msg(sh))
    # used-in-N version of the sentence: Pre-market prep's copy (opens the archive panel; backed out with Escape)
    if pm:
        open_menu(c, sh, "Pre-market prep")
        pick(c, re.compile("^Archive"))
        h2 = sh.inner_text()
        un = re.search(r"Used in (\d+) notes?", pm)
        k = int(un.group(1)) if un else 0
        want = f"It stays in your {k} note{'s' if k != 1 else ''}. New notes can't use it until you restore it."
        S.saw("Pre-market prep Archive panel", h2[:600])
        S.check(f"Archive of a template in {k} notes reads {want!r}", want in h2, h2[:300])
        S.shot(pg, "archive-panel")
        bk = sh.get_by_role("button", name=re.compile(r"^(Cancel|Back to your templates)$"))
        if bk.count():
            click(c, bk.first)
        else:
            pg.keyboard.press("Escape")
        pg.wait_for_timeout(800)
        if pg.get_by_role("dialog", name="My tools").count() == 0:
            sh = my_tools(c, "Templates")
    S.check("Archive of a template in no note says \"New notes can't use it until you restore it.\" (the menu item's hint)",
            "New notes can't use it until you restore it." in (arch_hint + msg(sh)), arch_hint + " | " + msg(sh))
    S.note("For a template in no note the sentence is the Archive item's title / aria-description only (not visible text, "
           "and no tooltip on touch); the visible message after archiving reads: " + msg(sh))
    pg.keyboard.press("Escape")
    # gone from the picker
    sheet, lib = open_picker(c)
    click(c, sheet.get_by_role("button", name="Choose another style for Daily prep"))
    pg.wait_for_timeout(1500)
    S.check("the archived template is GONE from the picker", sheet.get_by_role("button", name=f"Use {new}", exact=True).count() == 0, "")
    pg.keyboard.press("Escape")
    c.goto("/journal/notebook?view=all")
    sh = my_tools(c, "Templates")
    filt(c, sh, "Archived")
    rt = sh.locator("[data-testid=my-tools-template-row]").all_inner_texts()
    S.saw("Archived list", json.dumps(rt))
    items = open_menu(c, sh, new)
    S.check("Archived row actions: Restore and Delete permanently", any(i.startswith("Restore") for i in items) and any(i.startswith("Delete permanently") for i in items), json.dumps(items))
    pick(c, "Restore")
    S.saw("after Restore", msg(sh))
    filt(c, sh, "Active")
    S.check("Restore brings it back to Active", any(r.startswith(new) for r in sh.locator("[data-testid=my-tools-template-row]").all_inner_texts()), "")
    pg.keyboard.press("Escape")
    sheet, lib = open_picker(c)
    click(c, sheet.get_by_role("button", name="Choose another style for Daily prep"))
    pg.wait_for_timeout(1500)
    S.check("restored, it is back in the picker", sheet.get_by_role("button", name=f"Use {new}", exact=True).count() == 1, "")
    pg.keyboard.press("Escape")
    c.goto("/journal/notebook?view=all")
    sh = my_tools(c, "Templates")
    open_menu(c, sh, new)
    pick(c, re.compile("^Archive"))
    filt(c, sh, "Archived")
    open_menu(c, sh, new)
    pick(c, "Delete permanently")
    dc = sh.locator("[data-testid=delete-typed-name]")
    S.check("Delete permanently needs the name typed (DeleteConfirm)", dc.count() == 1, "")
    btn = sh.get_by_role("button", name="Delete permanently", exact=True).last
    S.check("the delete button is off until the name is typed", btn.get_attribute("aria-disabled") == "true", str(btn.get_attribute("aria-disabled")))
    S.shot(pg, "delete-confirm")
    dc.fill(new)
    click(c, btn)
    pg.wait_for_timeout(2500)
    S.saw("after delete", msg(sh))
    filt(c, sh, "Recently deleted")
    rt = sh.locator("[data-testid=my-tools-template-row]").all_inner_texts()
    S.saw("Recently deleted", json.dumps(rt))
    now, _ = now_et(base)
    until = now + dt.timedelta(days=30)
    want = f"Kept until {until:%b} {until.day}"
    row = next((r for r in rt if r.startswith(new)), "")
    S.check(f"Recently deleted lists it with {want!r}", want in row, row)
    items = open_menu(c, sh, new)
    S.check("Recently deleted offers Restore", any(i.startswith("Restore") for i in items), json.dumps(items))
    pg.keyboard.press("Escape")
    S.shot(pg, "recently-deleted")


def w11_11(S, b, base, vp, kbd=False):
    n = names(vp)
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    nid = use_style(c, "Daily prep", n["style"], S=S)
    st_set(f"a_tplnote_{vp}", nid)
    rc.render_all(pg)
    box = pg.locator("[data-routine-block] [role=checkbox]").first
    box.wait_for(timeout=T)
    click(c, box)
    pg.wait_for_timeout(1500)
    s, rr = api(A[vp], "/api/j2/routines", base=base)
    items = [i["text"] for r in rr.get("routines", []) if r["name"] == n["routine"] for i in r["items"]]
    private = account_names(A[vp], base) + items + [st().get(f"share_setup_{vp}", "")]
    # share link
    click(c, pg.get_by_role("button", name="Share", exact=True))
    sh = pg.get_by_role("dialog", name="Share this note")
    sh.wait_for(timeout=T)
    addr = sh.get_by_label("Share link address")
    if not visible(addr):
        click(c, sh.get_by_role("button", name="Create link", exact=True))
    share_url = addr.input_value(timeout=T)
    pub_btn = sh.get_by_role("button", name="Publish this note")
    pub_url = None
    if visible(pub_btn):
        click(c, pub_btn)
        pg.wait_for_timeout(2500)
        dd = top_dialog(pg)
        conf = dd.get_by_role("button", name=re.compile(r"^Publish")) if dd is not None else None
        if conf is not None and conf.count() and conf.last.is_visible() and conf.last.inner_text().strip() != "Publish this note":
            click(c, conf.last); pg.wait_for_timeout(2500)
        vals = top_dialog(pg).locator("input").evaluate_all("els => els.map(e => e.value)")
        pub_url = next((v for v in vals if "/p/" in v or "publish" in v or (v.startswith("http") and v != share_url)), None)
    S.saw("addresses", json.dumps([share_url, pub_url]))
    pg.keyboard.press("Escape")
    for label, url in (("share link", share_url), ("published page", pub_url)):
        if not url:
            S.check(f"the {label} address was read", False, "")
            continue
        pub = walk.open_public(b, vp if vp in walk.VIEWPORTS else "1200", url)
        try:
            text = pub["dom"].get("text") or ""
            S.saw(f"{label} text", text[:1500])
            want = "A private account item is not shown on public pages."
            S.check(f"the {label} says {want!r} for the private widgets/routine/tracker", want in text, text[:300])
            k = text.count(want)
            if not S.check(f"adjacent private items share ONE line on the {label} (counted {k})", k == 1, str(k)):
                S.defect(f"public {label} body (ACCOUNT_NEUTRAL_LINE paragraphs)",
                         "plan W11.11: 'A private account item is not shown on public pages.' (public_note_payload.py:224; adjacent private items share ONE line, the wave 8-10 walk's rule)",
                         f"a template-made note (blocks separated by the outline's empty paragraphs) shows the line {k} times, one per block, with blank paragraphs between", "minor")
            leaks = walk.leaks_in(pub, [w for w in private if w])
            S.check(f"no value, account name, routine item or day state on the {label}", not leaks, json.dumps(leaks)[:300])
            S.check(f"no tick state on the {label}", "aria-checked" not in json.dumps(pub["dom"])[:100000] or "checkbox" not in text, "")
            p = EVD_PUBLIC = None
            S.shot(pub["page"], "public" if label == "share link" else "public-published")
            S.measure(pub["page"], "public-" + label.split()[0], None, touch=vp != "1200")
            for e in pub["watch"].take():
                if e.get("http") == 401 and "/api/auth/me" in (e.get("url") or ""):
                    continue
                S.d["events"].setdefault("anon-" + label, []).append(e)
        finally:
            pub["ctx"].close()


def w11_13(S, b, base, vp, kbd=False):
    if vp != "390":
        S.note("390 only")
        S.check("not applicable at this viewport", True, "")
        return
    n = names(vp)
    bc = S.ctx("B", Ctx(b, base, vp, B[vp]))
    pg = bc.page
    sheet = gallery(bc)
    card = sheet.get_by_role("button", name=f"Adopt {n['style']}")
    if not card.count():
        raise Inconclusive("no listing to adopt for the number slot")
    click(bc, card.first)
    ad = adopt_sheet(pg)
    hold = ad.get_by_role("button", name="Change hold days")
    if not hold.count():
        raise Inconclusive("the adopt sheet has no number slot")
    click(bc, hold.first)
    pg.wait_for_timeout(800)
    pk = ad.locator("[data-slot-picker]").first
    anyb = pk.get_by_role("checkbox")
    if anyb.count() and anyb.first.is_checked():
        anyb.first.uncheck()
    inp = pk.locator("input[inputmode=decimal]").first
    pg.set_viewport_size({"width": 390, "height": 464})
    pg.wait_for_timeout(600)
    inp.focus()
    pg.wait_for_timeout(800)
    box = inp.bounding_box()
    vv = pg.evaluate("() => ({h: visualViewport.height, w: visualViewport.width, top: visualViewport.offsetTop})")
    S.saw("number input box / visual viewport", json.dumps([box, vv]))
    S.check("(a) the focused number input lies inside visualViewport.height", box and box["y"] >= 0 and box["y"] + box["height"] <= vv["h"] + 1, json.dumps(box))
    ov = overflow(pg)
    S.check("(a) no horizontal page scroll", not ov.get("horizontal"), json.dumps(ov)[:200])
    S.shot(pg, "kbd-open")
    reached = False
    for _ in range(25):
        pg.keyboard.press("Tab")
        if pg.evaluate("() => { const a = document.activeElement; return !!a && a.tagName === 'BUTTON' && a.innerText.trim() === 'Use' }"):
            reached = True; break
    S.check("(a) the sheet's primary button (Use) is reachable by Tab", reached, focus_label(pg))
    S.measure(pg, "kbd-open-adopt", "dialog", touch=True)
    bc.close()
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    sp = open_share(c, "Templates", n["style"])
    pg.set_viewport_size({"width": 390, "height": 464})
    pg.wait_for_timeout(600)
    name_in = sp.locator("input[type=text]").first
    name_in.focus()
    pg.wait_for_timeout(800)
    box = name_in.bounding_box()
    vv = pg.evaluate("() => ({h: visualViewport.height, w: visualViewport.width})")
    S.check("(b) the focused share-preview Name field lies inside visualViewport.height", box and box["y"] >= 0 and box["y"] + box["height"] <= vv["h"] + 1, json.dumps([box, vv]))
    ov = overflow(pg)
    S.check("(b) no horizontal page scroll", not ov.get("horizontal"), json.dumps(ov)[:200])
    S.shot(pg, "kbd-open-share")
    send = sp.get_by_role("button", name="Send for review")
    S.saw("(b) Send for review before a category is chosen", json.dumps({"disabled": send.first.is_disabled() if send.count() else None}))
    cat = sp.get_by_label("Category (required)")
    if cat.count():
        cat.focus()
        cat.select_option(label="Journal")      # a keyboard user picks the required category first (a <select>)
        pg.wait_for_timeout(1500)
        name_in.focus()
        S.note("(b) the required Category is chosen first: until then Send for review is disabled and so not in the Tab order")
    reached = False
    for _ in range(80):
        pg.keyboard.press("Tab")
        if pg.evaluate("() => { const a = document.activeElement; return !!a && a.tagName === 'BUTTON' && a.innerText.trim() === 'Send for review' }"):
            reached = True; break
    S.check("(b) the sheet's primary button (Send for review) is reachable by Tab", reached, focus_label(pg))
    S.measure(pg, "kbd-open-share", "dialog", touch=True)


def w11_17(S, b, base, vp, kbd=False):
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    sheet, lib = open_picker(c)
    S.check("door: TemplatePicker's Template library section", lib.is_visible(), "")
    chips = lib.locator("[data-type-chip]").all_inner_texts()
    S.check("every library card carries one type chip 'Template'", chips and all(x == "Template" for x in chips) and
            len(chips) == lib.locator("[data-library-card]").count(), f"{len(chips)} chips")
    n0 = lib.locator("[data-library-card]").count()
    search = sheet.get_by_role("searchbox")
    if not search.count():
        search = sheet.locator("input[type=search]")
    search.first.fill("prep")
    pg.wait_for_timeout(1200)
    titles = lib.locator("[data-library-card] h5").all_inner_texts()
    S.saw("search 'prep' keeps", json.dumps(titles))
    s, libj = api(A[vp], "/api/j2/template-gallery/library", base=base)
    exp = [t["title"] for t in libj["templates"] if "prep" in " ".join([t["title"], t.get("description") or ""] + (t.get("contains") or [])).lower()]
    S.check("the search filters the library by title, description and contains", sorted(titles) == sorted(exp), json.dumps(exp))
    search.first.fill("")
    pg.wait_for_timeout(800)
    # R8 / W11-R68: each chip keeps exactly its library groups (FAMILY_GROUPS, lib/templateLibrary.js), so the
    # spec §10 table decides: Night-before prep, Pre-market prep and Morning routine under rituals, Pre-session
    # check-in under Mindset.
    want_titles = {"Daily & weekly rituals": ["Night-before prep", "Pre-market prep", "Morning routine"], "Mindset": ["Pre-session check-in"]}
    seen_in = {}
    for chip, groups in (("Daily & weekly rituals", {"night_before", "before_open", "after_close", "weekly_monthly", "challenges", "habits"}),
                         ("Around a trade", {"during_day"}), ("Thesis & research", {"playbook"}), ("Mindset", {"mindset"})):
        cb = sheet.get_by_role("button", name=chip, exact=True)
        click(c, cb)
        pg.wait_for_timeout(2500)
        ks = set(lib.locator("[data-library-group]").evaluate_all("els => els.map(e => e.getAttribute('data-library-group'))")) if lib.count() else set()
        ts = lib.locator("[data-library-card] h5").all_inner_texts() if lib.count() else []
        for x in ts:
            seen_in.setdefault(x, []).append(chip)
        S.saw(f"chip {chip!r} keeps", json.dumps(ts))
        S.check(f"the {chip!r} chip keeps exactly the {sorted(groups)} groups", ks == groups, json.dumps(sorted(ks)))
        for wt in want_titles.get(chip, []):
            S.check(f"R8: {wt!r} is under the {chip!r} chip", wt in ts, json.dumps(ts))
        fc = filter_chip_sizes(pg, "[role=dialog]")
        cr = chip_report(pg, "[role=dialog]", hover=not c.touch)
        S.saw(f"chip {chip!r}: active chip contrast / sizes", json.dumps({"active": cr, "sizes": fc})[:1200])
        act = [x for x in cr["rest"] + cr["hover"] if x["text"] == chip]
        S.check(f"R5: the active {chip!r} chip holds >= 4.5:1 at rest and hovered", act and all(x["ratio"] >= 4.5 for x in act), json.dumps(act))
        if c.touch:
            small = [x for x in fc if x["w"] < 44 or x["h"] < 44]
            S.check(f"R6: every picker/library chip is >= 44 x 44 on the touch tier ({chip!r} active)", not small, json.dumps(small))
    multi = {k: v for k, v in seen_in.items() if len(v) != 1}
    S.check("R8: every library template sits under exactly one chip", not multi, json.dumps(multi))
    click(c, sheet.get_by_role("button", name="Your templates", exact=True))
    pg.wait_for_timeout(1000)
    S.check("'Your templates' hides the library section", sheet.locator("[data-template-library]").count() == 0 or not sheet.locator("[data-template-library]").first.is_visible(), "")
    click(c, sheet.get_by_role("button", name="All", exact=True).first)
    pg.wait_for_timeout(800)
    S.shot(pg, "picker")
    click(c, sheet.get_by_role("button", name="Browse the community gallery"))
    pg.wait_for_timeout(2500)
    S.check("door: the community gallery opens from the picker", "Community gallery" in sheet.inner_text(), "")
    gchips = sheet.locator("[data-type-chip]").all_inner_texts()
    S.saw("gallery type chips", json.dumps(sorted(set(gchips))))
    S.check("gallery cards carry type chips (Template / Widget / Routine / Tracker present)", {"Template", "Widget", "Routine", "Tracker"} <= set(gchips), json.dumps(sorted(set(gchips))))
    S.shot(pg, "gallery")
    S.measure(pg, "gallery", "dialog", touch=c.touch)
    for v in ("Templates", "Widgets"):
        vb = sheet.get_by_role("button", name=v, exact=True)
        if vb.count():
            click(c, vb.first)
            pg.wait_for_timeout(2000)
    fc = filter_chip_sizes(pg, "[role=dialog]")
    cr = chip_report(pg, "[role=dialog]", hover=not c.touch)
    S.saw("gallery: active chips / chip sizes", json.dumps({"active": cr, "sizes": fc})[:1500])
    bad = [x for x in cr["rest"] + cr["hover"] if x["ratio"] < 4.5]
    S.check("R5: every active gallery chip holds >= 4.5:1 at rest and hovered", cr["rest"] and not bad, json.dumps(bad or cr["rest"])[:500])
    if c.touch:
        small = [x for x in fc if x["w"] < 44 or x["h"] < 44]
        S.check("R6: every gallery filter chip is >= 44 x 44 on the touch tier", fc and not small, json.dumps(small or fc)[:500])
    S.shot(pg, "gallery-chips")
    pg.keyboard.press("Escape")
    c.goto("/journal/notebook?view=all")
    sh = my_tools(c, "Templates")
    S.check("door: My tools -> Templates", sh.locator("[data-testid=my-tools-template-row]").count() > 0, "")
    pg.keyboard.press("Escape")
    nid = st().get(f"share_note_{vp}")
    if not nid:
        raise Inconclusive("no W11.7 note to read the placed-tool doors on")
    c.goto(f"/journal/notebook?note={nid}")
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    rc.render_all(pg)
    r = RunA(c)
    menu = pg.get_by_role("listbox", name="Insert block").last
    rc.caret_to_end(r, pg)
    pg.keyboard.press("Enter")
    pg.keyboard.type("/", delay=40)
    menu.wait_for(timeout=T)
    opts = menu.get_by_role("option").all_inner_texts()
    S.saw("/ menu rows", json.dumps(opts)[:800])
    mi = next((i for i, o in enumerate(opts) if o.startswith("Manage my tools")), None)
    S.check("door: 'Manage my tools' is in the / menu (end of the Mine group)", mi is not None, json.dumps(opts)[:300])
    pg.keyboard.press("Escape")
    pg.keyboard.press("Backspace")
    for what, sel in (("built widget", "[data-snapshot-frame]"), ("routine", "[data-routine-block]"), ("tracker", "[data-tracker-block]")):
        blk = pg.locator(sel).first
        if not blk.count():
            S.check(f"door: a placed {what} is in the note", False, "")
            continue
        blk.scroll_into_view_if_needed()
        mb = blk.get_by_role("button", name=re.compile(r"^(More|Routine options|Tracker options)"))
        if not mb.count():
            mb = blk.locator("xpath=ancestor-or-self::*[.//button[starts-with(@aria-label,'More')]][1]").get_by_role("button", name=re.compile(r"^More"))
        click(c, mb.first)
        pg.wait_for_timeout(700)
        mg = pg.get_by_role("button", name="Manage…").or_(pg.get_by_role("menuitem", name="Manage…"))
        ok = visible(mg)
        S.check(f"door: 'Manage…' in the ⋯ menu of a placed {what}", ok, "")
        if ok:
            click(c, mg.first)
            pg.wait_for_timeout(1500)
            S.check(f"'Manage…' on the {what} opens My tools", pg.get_by_role("dialog", name="My tools").count() > 0, "")
            pg.keyboard.press("Escape")
            pg.wait_for_timeout(600)
        else:
            pg.keyboard.press("Escape")
