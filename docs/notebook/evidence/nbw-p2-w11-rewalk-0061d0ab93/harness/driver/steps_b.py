"""W11.7 (template share -> review -> adopt) and W11.8 (share a widget, routine, tracker)."""
from ui import *
from adapter import R as RunA, row as rowA
from ev import Inconclusive


def names(vp):
    return {"style": f"Share source {vp}", "note": f"Share source note {vp}", "widget": f"Setup win rate {vp}",
            "routine": f"Prep routine {vp}", "tracker": f"Sleep {vp}"}


def account_names(pid, base):
    s, r = api(pid, "/api/j2/accounts", base=base)
    rows = r.get("accounts") if isinstance(r, dict) else r
    return [a.get("name") for a in (rows or []) if isinstance(a, dict) and a.get("name")]


def ensure_tools(pid, vp, base):
    n = names(vp)
    s, r = api(pid, "/api/j2/routines", base=base)
    if not any(x["name"] == n["routine"] for x in r.get("routines", [])):
        s, out = api(pid, "/api/j2/routines", {"name": n["routine"], "items": [{"text": "Check futures"}, {"text": "Mark my levels"},
                                                                                {"text": "Size my risk"}], "schedule": {"kind": "every"}}, base=base)
        if s not in (200, 201):
            raise Inconclusive(f"routine setup refused: {s} {out}")
    s, r = api(pid, "/api/j2/trackers", base=base)
    if not any(x["name"] == n["tracker"] for x in r.get("trackers", [])):
        s, out = api(pid, "/api/j2/trackers", {"name": n["tracker"], "kind": "number", "unit": "h"}, base=base)
        if s not in (200, 201):
            raise Inconclusive(f"tracker setup refused: {s} {out}")


def build_share_note(S, c, vp, base):
    """A note with two built widgets (one with a Setup filter and a 'Hold days at least 2' number), one routine
    and one tracker, saved as the style 'Share source <vp>' -- the plan's W11.7 setup, driven through the product."""
    pg = c.page
    n = names(vp)
    ensure_tools(A[vp], vp, base)
    r = RunA(c); rw = rowA()
    c.goto("/journal/notebook?view=all")
    rc.a_seed_note(r, {"title": n["note"], "paras": ["Built for sharing."]}, rw)
    st_set(f"share_note_{vp}", r.alias["n1"])
    rc.a_open_note(r, {"note": "n1"}, rw)
    rc.a_open_builder(r, {}, rw)
    rc.a_builder_example(r, {"card": "shelf:win-rate"}, rw)
    dlg = rc.builder(pg)
    click(c, dlg.get_by_role("button", name="Filter", exact=True))
    click(c, dlg.get_by_role("list", name="Fields").get_by_role("button", name="Setup", exact=True))
    pg.wait_for_timeout(1500)
    vals = dlg.get_by_role("list", name="Setup values").get_by_role("button")
    setup = vals.first.inner_text().strip()
    click(c, vals.first)
    click(c, dlg.get_by_role("button", name="Add filter", exact=True))
    pg.wait_for_timeout(1500)
    click(c, dlg.get_by_role("button", name="Filter", exact=True))
    click(c, dlg.get_by_role("list", name="Fields").get_by_role("button", name="Hold days", exact=True))
    pg.wait_for_timeout(1200)
    dlg.locator("select:has(option[value=gte])").last.select_option("gte")
    pg.wait_for_timeout(500)
    box = dlg.get_by_label("Value", exact=True)
    if not box.count():
        box = dlg.get_by_role("spinbutton").last
    box.last.fill("2")
    add = dlg.get_by_role("button", name="Add", exact=True)
    if visible(add) and add.first.is_enabled():
        click(c, add.first)
    click(c, dlg.get_by_role("button", name="Add filter", exact=True))
    pg.wait_for_timeout(1500)
    rc.a_builder_name(r, {"value": n["widget"]}, rw)
    rc.a_builder_save(r, {"expect_frame": n["widget"]}, rw)
    rc.a_open_builder(r, {}, rw)
    rc.a_builder_example(r, {"card": "shelf:daily-pnl-bars"}, rw)
    rc.a_builder_save(r, {"expect_frame": "Daily P&L bars"}, rw)
    rc.a_insert_routine(r, {"existing": n["routine"]}, rw)
    pg.wait_for_timeout(1500)
    # the / menu lists the member's own tracker as a row of its own (the Mine group): pick it there
    rc.slash(r, pg, "/" + n["tracker"].split()[0].lower(), "^" + re.escape(n["tracker"]))
    pg.locator("[data-tracker-block]").first.wait_for(timeout=T)
    pg.wait_for_timeout(3000)
    S.check("setup note: two built widgets, one routine and one tracker placed",
            pg.locator("[data-routine-block]").count() == 1 and pg.locator("[data-tracker-block]").count() == 1 and
            all(ch["ok"] for ch in rw["checks"]), json.dumps(rw["checks"])[:300])
    more = pg.get_by_role("button", name="More note actions")
    click(c, more)
    pg.wait_for_timeout(500)
    click(c, pg.get_by_role("button", name="Save this note's setup as a style").first)
    pg.wait_for_timeout(2000)
    grp = pg.get_by_role("group", name="Organise this note")
    grp.get_by_label("Style name").fill(n["style"])
    grp.get_by_label("Kind of note").select_option(label="Daily prep")
    click(c, grp.get_by_role("button", name="Save style"))
    pg.wait_for_timeout(2500)
    ok = f"Saved as the style “{n['style']}”." in grp.inner_text()
    S.check(f"saved as the style {n['style']!r}", ok, grp.inner_text()[:200])
    return setup


def open_share(c, tab, name):
    pg = c.page
    c.goto("/journal/notebook?view=all")
    sh = my_tools(c, tab)
    row_action(c, sh, name, "Share to library")
    sp = pg.get_by_role("dialog", name="Share to library")
    sp.wait_for(timeout=T)
    with contextlib.suppress(Exception):
        pg.wait_for_function("() => !document.body.innerText.includes('Checking what will be shared')", timeout=20000)
    pg.wait_for_timeout(2500)
    return sp


def send_share(S, c, sp, category="Journal"):
    pg = c.page
    cat = sp.get_by_label("Category (required)")
    if cat.count():
        cat.select_option(label=category)
        pg.wait_for_timeout(1800)
    click(c, sp.get_by_role("button", name="Send for review"))
    pg.wait_for_timeout(3000)
    t = sp.inner_text()
    return "Sent. UCT reviews every item before it's listed." in t, t


def approve(S, b, base, vp, titles, label):
    a = S.ctx(f"admin-{label}", Ctx(b, base, vp, ADMIN))
    pg = a.page
    sheet = gallery(a, "Review queue")
    t = sheet.inner_text()
    S.saw("review queue", t[:1200])
    for title in titles:
        S.check(f"the review queue lists {title!r} waiting", title in t, "")
    S.shot(pg, "review")
    S.measure(pg, "review", "dialog", touch=a.touch)
    for title in titles:
        btn = sheet.get_by_role("button", name=f"Approve {title}")
        if not btn.count():
            raise Inconclusive(f"no Approve button for {title!r} in the review queue")
        click(a, btn.first)
        pg.wait_for_timeout(2500)
    s, gl = api(ADMIN, "/api/j2/template-gallery", base=base)
    listed = [x.get("title") for x in (gl.get("templates") or gl.get("items") or [])] if isinstance(gl, dict) else []
    for title in titles:
        S.check(f"{title!r} is listed after approval", title in listed, "")
    a.close()


def w11_7(S, b, base, vp, kbd=False):
    n = names(vp)
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    setup = build_share_note(S, c, vp, base)
    st_set(f"share_setup_{vp}", setup)
    accts = account_names(A[vp], base)
    reqs0 = len(c.requests)
    sp = open_share(c, "Templates", n["style"])
    t = sp.inner_text()
    S.saw("share preview", t)
    S.check("title 'Share to library'", sp.get_by_role("heading", name="Share to library").count() or t.startswith("Share to library"), t[:40])
    S.check("heading 'What will be shared'", "What will be shared" in t, "")
    names_in = sp.locator("input[type=text]").evaluate_all("els => els.map(e => e.value)")
    S.check("the Name is prefilled with the template's name", n["style"] in names_in, json.dumps(names_in))
    S.check("a Description field is offered", sp.get_by_text("Description").count() > 0, "")
    for lab in (f"Widget: {n['widget']}", "Widget: Daily P&L bars", f"Routine: {n['routine']}", f"Tracker: {n['tracker']}"):
        S.check(f"{lab!r} is listed with its controls", lab in t, "")
    pick = sp.locator("[data-pick-line]")
    pl = pick.first.inner_text() if pick.count() else ""
    S.check("'People who use it pick their own: <Setup, ...>' names the setup choice", pl.startswith("People who use it pick their own:") and "Setup" in pl, pl)
    sw = sp.get_by_role("switch")
    sws = [(sw.nth(i).evaluate("e => (e.closest('label') || e.parentElement).innerText.trim()"), sw.nth(i).get_attribute("aria-checked")) for i in range(sw.count())]
    S.saw("number switches", json.dumps(sws))
    S.check("every number switch 'Share this number (<value>)' starts OFF", sws and all(v != "true" for _, v in sws) and
            any("Share this number (" in l for l, _ in sws), json.dumps(sws))
    trav = sp.get_by_text("Exactly what travels").first.locator("xpath=..").inner_text() if sp.get_by_text("Exactly what travels").count() else ""
    S.saw("exactly what travels", trav)
    S.check("'Exactly what travels' is plain words, never JSON", trav and not re.search(r'[{\[]\s*"|":\s', trav), trav[:200])
    raw = re.findall(r"\{\{block:[^}]+\}\}", trav)
    if raw:
        S.check("'Exactly what travels' carries no raw {{block:..}} token", False, json.dumps(raw))
        S.defect("SharePreviewSheet 'Exactly what travels' > Outline",
                 "plan W11.7 / SharePreviewSheet: 'Exactly what travels' in plain words (never JSON)",
                 f"the outline section prints raw placeholder tokens: {raw}", "minor")
    leaks = [w for w in accts + [setup] if w and w in trav]
    S.check("'Exactly what travels' names none of A's account names or the picked setup (no stored member text)", not leaks, json.dumps(leaks))
    S.check("no id travels", not HEX_ID.search(trav), (HEX_ID.search(trav) or [""])[0])
    S.shot(pg, "share-preview")
    S.measure(pg, "share-preview", "dialog", touch=c.touch)
    if sws:
        before = len(c.requests)
        first = sw.first
        click(c, first)
        pg.wait_for_timeout(2500)
        S.check("switching ONE number on sends the next server preview", any("share/preview" in r["u"] for r in c.requests[before:]), "")
        trav2 = sp.get_by_text("Exactly what travels").first.locator("xpath=..").inner_text()
        S.saw("exactly what travels, one number on", trav2)
        S.check("the next server preview lists that number (2) only", ("at least 2" in trav2 or ": 2" in trav2 or " 2" in trav2) and first.get_attribute("aria-checked") == "true", trav2[:300])
        click(c, first)        # back OFF: the adopter picks their own number (W11.13 uses it)
        pg.wait_for_timeout(2000)
    ok, t2 = send_share(S, c, sp)
    S.check("Send -> 'Sent. UCT reviews every item before it's listed.'", ok, t2[-200:])
    approve(S, b, base, vp, [n["style"]], "w117")
    # B: find it, preview, make it yours with a changed slot, use
    bc = S.ctx("B", Ctx(b, base, vp, B[vp]))
    pg = bc.page
    sheet = gallery(bc)
    card = sheet.get_by_role("button", name=f"Adopt {n['style']}")
    if not card.count():
        raise Inconclusive(f"B's gallery shows no card for {n['style']!r}")
    S.note("Plan W11.7 says B finds it 'in the Template library'; the Template library section lists UCT's official templates "
           "only (W11-R4), so a member's approved listing is found in the community gallery (same picker sheet).")
    click(bc, card.first)
    ad = adopt_sheet(pg)
    atext = ad.inner_text()
    S.saw("B adopt sheet", atext)
    S.check("credit line names A's template", f"{n['style']}" in atext and "Based on" in atext, atext[:120])
    slot = ad.locator("[data-slot]")
    S.saw("B choices", " | ".join(slot.all_inner_texts()))
    chg = ad.get_by_role("button", name="Change setup")
    if not chg.count():
        raise Inconclusive("B's adopt sheet offers no setup choice")
    before_val = ad.locator("[data-slot]").first.inner_text()
    click(bc, chg.first)
    pg.wait_for_timeout(1800)
    pk = ad.locator("[data-slot-picker]").first
    opts = pk.get_by_role("radio")
    labels = [opts.nth(i).evaluate("e => e.parentElement.innerText.trim()") for i in range(opts.count())]
    cur = re.sub(r"^Setup: ", "", before_val.split("\n")[0])
    alt = next((l for l in labels if l != cur and not l.lower().startswith("any")), None)
    if not alt:
        raise Inconclusive(f"no other setup to pick: {labels}")
    pk.get_by_text(alt, exact=True).click()
    click(bc, pk.get_by_role("button", name="Done", exact=True))
    pg.wait_for_timeout(2500)
    S.check(f"B changed the setup from its suggestion ({cur}) to {alt}", f"Setup: {alt}" in ad.inner_text(), ad.locator("[data-slot]").first.inner_text())
    st_set(f"b_setup_{vp}", alt)
    hold = ad.get_by_role("button", name="Change hold days")
    if hold.count():
        click(bc, hold.first)
        pg.wait_for_timeout(800)
        pk2 = ad.locator("[data-slot-picker]").first
        anyb = pk2.get_by_role("checkbox")
        if anyb.count() and anyb.first.is_checked():
            anyb.first.uncheck()
        inp = pk2.locator("input[inputmode=decimal]").first
        inp.fill("3")
        click(bc, ad.locator("[data-slot-picker]").get_by_role("button", name="Done", exact=True))
        pg.wait_for_timeout(2500)
    S.shot(pg, "adopt")
    S.measure(pg, "adopt", "dialog", touch=bc.touch)
    click(bc, ad.get_by_role("button", name="Use", exact=True))
    pg.wait_for_timeout(3500)
    S.check("Use -> 'Added to your templates.'", "Added to your templates." in ad.inner_text(), ad.inner_text()[-200:])
    with contextlib.suppress(Exception):
        click(bc, ad.get_by_role("button", name="Done", exact=True))
    # B's copy in My tools -> Templates reads the credit
    bc.goto("/journal/notebook?view=all")
    sh = my_tools(bc, "Templates")
    tt = sh.inner_text()
    S.saw("B My tools > Templates", tt[:800])
    m = re.search(r"Based on (.+?)'s " + re.escape(n["style"]), tt)
    lab = m.group(1) if m else ""
    S.check(f"B's copy reads 'Based on <label>'s {n['style']}' (label not an email; else 'A UCT member')",
            bool(m) and "@" not in lab, m.group(0) if m else tt[:300])

    pg.keyboard.press("Escape")
    # B makes a note from the copy: B's values, nothing of A's
    nid = use_style(bc, "Daily prep", n["style"], S=S)
    st_set(f"b_note_{vp}", nid)
    st_set(f"b_days_{vp}", sorted(set((st().get(f"b_days_{vp}") or []) + [now_et(base)[0].strftime("%Y-%m-%d")])))
    rc.render_all(pg)
    txt = pg.locator(".ProseMirror").first.inner_text()
    S.saw("B's note from the copy", txt[:1500])
    a_leaks = [w for w in account_names(A[vp], base) if w and w in txt]
    S.check("nothing of A's values appears in B's note (A's account names)", not a_leaks, json.dumps(a_leaks))
    S.check("B's note holds the routine and tracker blocks", pg.locator("[data-routine-block]").count() == 1 and pg.locator("[data-tracker-block]").count() == 1, "")
    fr = pg.locator("[data-snapshot-frame]").count()
    S.check("B's note holds the two built widgets (two frames drawn)", fr >= 2, f"{fr} frames")
    s_, wd = api(B[vp], "/api/j2/widget-definitions", base=base)
    dn = [d.get("name") for d in (wd.get("definitions") or wd.get("widgets") or wd.get("items") or [])] if isinstance(wd, dict) else []
    S.saw("B's widget definitions", json.dumps(dn))
    S.check("B holds its own copies of both widgets, named as shared", n["widget"] in dn and "Daily P&L bars" in dn, json.dumps(dn))
    if n["widget"] not in txt:
        S.note("B's placed frame is titled with the generated description (e.g. 'Win rate, last 90 days'), not the shared "
               f"widget name {n['widget']!r} that B's My tools copy carries.")
    S.shot(pg, "main")


def w11_8(S, b, base, vp, kbd=False):
    n = names(vp)
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    sent = []
    for tab, nm in (("Widgets", n["widget"]), ("Routines", n["routine"]), ("Trackers", n["tracker"])):
        sp = open_share(c, tab, nm)
        t = sp.inner_text()
        S.saw(f"share preview ({tab})", t[:1200])
        S.check(f"{tab}: the own row offers 'Share to library' and opens the same share preview", "What will be shared" in t, "")
        if tab == "Routines":
            S.check("routine share carries item text only (no ticks/history)", "Your ticks, history and reminders are left out." in t, "")
        if tab == "Trackers":
            S.check("tracker share carries name, kind and unit only", "Your logged values are left out." in t, "")
        S.shot(pg, f"share-{tab.lower()}")
        S.measure(pg, f"share-{tab.lower()}", "dialog", touch=c.touch)
        ok, t2 = send_share(S, c, sp)
        S.check(f"{tab}: Send -> 'Sent. UCT reviews every item before it's listed.'", ok, t2[-200:])
        sent.append(nm)
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)
    approve(S, b, base, vp, sent, "w118")
    bc = S.ctx("B", Ctx(b, base, vp, B[vp]))
    pg = bc.page
    def counts():
        out = {}
        for path, key, nm in (("/api/j2/widget-definitions", None, n["widget"]), ("/api/j2/routines", "routines", n["routine"]),
                              ("/api/j2/trackers", "trackers", n["tracker"])):
            s_, r_ = api(B[vp], path, base=base)
            rows = (r_.get(key) if key else (r_.get("definitions") or r_.get("widgets") or r_.get("items"))) if isinstance(r_, dict) else []
            out[nm] = len([x for x in rows or [] if x.get("name") == nm])
        return out
    c0 = counts()
    for kind, nm in (("Widgets", n["widget"]), ("Routines", n["routine"]), ("Trackers", n["tracker"])):
        sheet = gallery(bc)
        chip = sheet.get_by_role("button", name=kind, exact=True)
        if chip.count():
            click(bc, chip.first)
            pg.wait_for_timeout(2000)
        card = sheet.get_by_role("button", name=f"Use {nm}", exact=True)
        if not card.count():
            card = sheet.get_by_role("button", name=f"Adopt {nm}", exact=True)
        if not S.check(f"B finds the listed {kind[:-1].lower()} {nm!r} (filtered by its type chip)", card.count() > 0, sheet.inner_text()[-300:]):
            continue
        cardtxt = card.first.locator("xpath=ancestor::*[.//*[@data-type-chip]][1]").inner_text()
        S.check(f"the {nm!r} card carries the type chip {kind[:-1]!r}", kind[:-1] in cardtxt.splitlines()[:6], cardtxt[:120])
        click(bc, card.first)
        ad = adopt_sheet(pg)
        click(bc, ad.get_by_role("button", name="Use", exact=True))
        pg.wait_for_timeout(3000)
        S.check(f"B adopts {nm!r}: 'Added to My tools.'", "Added to My tools." in ad.inner_text(), ad.inner_text()[-200:])
        S.shot(pg, f"adopt-{kind.lower()}")
        with contextlib.suppress(Exception):
            click(bc, ad.get_by_role("button", name="Done", exact=True))
        pg.keyboard.press("Escape")
    c1 = counts()
    S.saw("B's copies by name, before -> after", json.dumps([c0, c1]))
    for k in c0:
        S.check(f"adopting adds exactly one copy of {k!r} to B's My tools", c1[k] == c0[k] + 1, f"{c0[k]} -> {c1[k]}")
    bc.goto("/journal/notebook?view=all")
    for tab, nm in (("Widgets", n["widget"]), ("Routines", n["routine"]), ("Trackers", n["tracker"])):
        sh = my_tools(bc, tab)
        t = sh.inner_text()
        S.saw(f"B My tools > {tab}", t[:900])
        S.check(f"B's {tab} row for {nm!r} carries the credit line", "Based on" in t and nm in t, "")
        acts = sh.get_by_role("button", name=f"Actions for {nm}")
        if acts.count():
            click(bc, acts.last)
            pg.wait_for_timeout(500)
            share = pg.get_by_role("menuitem", name="Share to library")
            S.check(f"B's copy of {nm!r} offers NO 'Share to library'", share.count() == 0, "")
            pg.keyboard.press("Escape")
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)
    s, rr = api(B[vp], "/api/j2/routines", base=base)
    mine = [r for r in rr.get("routines", []) if r["name"] == n["routine"] and r.get("credit")]
    S.check("B's adopted routine carries A's item text", mine and [i["text"] for i in mine[0]["items"]] == ["Check futures", "Mark my levels", "Size my risk"],
            json.dumps(mine and mine[0]["items"]))
    s, tr = api(B[vp], "/api/j2/trackers", base=base)
    tk = [t for t in tr.get("trackers", []) if t["name"] == n["tracker"] and t.get("credit")]
    S.check("B's adopted tracker carries name, kind and unit", tk and tk[0].get("kind") == "number" and tk[0].get("unit") == "h", json.dumps(tk and {k: tk[0].get(k) for k in ("name", "kind", "unit")}))
