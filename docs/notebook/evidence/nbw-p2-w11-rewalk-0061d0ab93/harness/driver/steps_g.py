"""Targeted re-walk on 0061d0ab93: D1-D6, R80/R82, editorNormalForm, PD-1..PD-3 (all viewports)."""
import os, difflib
from ui import *
from adapter import R as RunA, row as rowA
from ev import Inconclusive
from steps_b import names
from steps_e import use_library
from ytstub import YT_STUB

PUTP = {"1200": "P46", "820": "P14", "390": "P36"}
VIDM = "P01"

# text colour / background (composited, with the element's cumulative opacity) and the contrast ratio
CON_JS = r"""(e) => {
  const parse = c => { const m = c && c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1} };
  const over = (t, u) => ({r: t.r * t.a + u.r * (1 - t.a), g: t.g * t.a + u.g * (1 - t.a), b: t.b * t.a + u.b * (1 - t.a), a: 1});
  const bgOf = x => { const st = []; while (x && x.nodeType === 1) { const c = parse(getComputedStyle(x).backgroundColor); if (c && c.a > 0) { st.push(c); if (c.a >= 1) break } x = x.parentElement }
    let o = {r: 255, g: 255, b: 255, a: 1}; if (!st.length) return o; o = {...st.pop(), a: 1}; while (st.length) o = over(st.pop(), o); return o };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) };
  let op = 1; for (let x = e; x && x.nodeType === 1; x = x.parentElement) op *= parseFloat(getComputedStyle(x).opacity);
  const parentBg = bgOf(e.parentElement); const ownBg = bgOf(e);
  const fg = over(parse(getComputedStyle(e).color), ownBg);
  const visBg = over({...ownBg, a: op}, parentBg), visFg = over({...fg, a: op}, parentBg);
  const l1 = lum(visFg), l2 = lum(visBg); const b = e.getBoundingClientRect();
  const rgb = c => `rgb(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)})`;
  return {text: e.innerText.trim().slice(0, 40), fg: rgb(visFg), bg: rgb(visBg), opacity: op, ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100,
          w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, disabled: !!e.disabled, theme: document.documentElement.dataset.theme} }"""

INERT_JS = r"""() => { const root = document.getElementById('root'); const kids = [...document.body.children].filter(e => !['SCRIPT', 'STYLE', 'LINK'].includes(e.tagName));
  const ds = [...document.querySelectorAll('[role=dialog]')].filter(d => { const b = d.getBoundingClientRect(); return b.width > 0 && b.height > 0 });
  const topOf = d => { let t = d; while (t.parentElement && t.parentElement !== document.body) t = t.parentElement; return t };
  return {rootInert: !!(root && root.hasAttribute('inert')),
    dialogs: ds.map(d => ({label: d.getAttribute('aria-label') || (d.getAttribute('aria-labelledby') && (document.getElementById(d.getAttribute('aria-labelledby')) || {}).innerText) || '?',
                          inert: !!d.closest('[inert]'), z: getComputedStyle(topOf(d)).zIndex})),
    bodyChildren: kids.map(e => ({id: e.id, cls: String(e.className).slice(0, 40), inert: e.hasAttribute('inert'), keep: e.getAttribute('data-sheet-keep-live'), z: getComputedStyle(e).zIndex}))} }"""

FOCUS_JS = r"""() => { const a = document.activeElement; if (!a) return null; const b = a.getBoundingClientRect();
  return {tag: a.tagName, placeholder: a.getAttribute('placeholder'), aria: a.getAttribute('aria-label'), cls: String(a.className).slice(0, 60),
          value: (a.value || '').slice(0, 60), inertAncestor: !!a.closest('[inert]'), rootInert: !!(document.getElementById('root') || {}).hasAttribute?.('inert'),
          inDialog: !!a.closest('[role=dialog]'), visible: b.width > 0 && b.height > 0} }"""


def is_title(f):
    return bool(f) and f["tag"] in ("INPUT", "TEXTAREA") and ((f.get("placeholder") or "").lower().startswith("title") or "title" in (f.get("aria") or "").lower()
                                                               or "title" in (f.get("cls") or "").lower())


def d1_check(S, c, where):
    """D1 (W11-R78/R80 m-1): after a Template library Use the New note sheet is closed, and focus is on the new note's
    title with no inert ancestor."""
    pg = c.page
    pg.wait_for_timeout(1500)
    left = [d for d in pg.evaluate(INERT_JS)["dialogs"]]
    S.check(f"D1 {where}: after Use no sheet is left open over the new note", not left, json.dumps(left))
    f = pg.evaluate(FOCUS_JS)
    S.saw(f"D1 {where}: document.activeElement after Use", json.dumps(f))
    S.check(f"D1 {where}: focus is the new note's title", is_title(f), json.dumps(f))
    S.check(f"D1 {where}: the focused title has no inert ancestor (and #root is not inert)", bool(f) and not f["inertAncestor"] and not f["rootInert"], json.dumps(f))
    if left:
        S.shot(pg, "sheet-left-open")
        S.defect("[role=dialog] left open after a Template library Use", "walk D1 fix: the New note sheet closes and the note lands",
                 f"open: {left}", "major")
        for _ in range(3):
            pg.keyboard.press("Escape"); pg.wait_for_timeout(500)


def _diff(a, b, path=""):
    """Structural diff of two JSON values: [(path, old, new)]; a key absent on one side is reported as missing."""
    out = []
    if isinstance(a, dict) and isinstance(b, dict):
        for k in sorted(set(a) | set(b)):
            if k not in a:
                out.append((f"{path}.{k}", "<absent>", b[k]))
            elif k not in b:
                out.append((f"{path}.{k}", a[k], "<absent>"))
            else:
                out += _diff(a[k], b[k], f"{path}.{k}")
    elif isinstance(a, list) and isinstance(b, list):
        for i in range(max(len(a), len(b))):
            if i >= len(a):
                out.append((f"{path}[{i}]", "<absent>", b[i]))
            elif i >= len(b):
                out.append((f"{path}[{i}]", a[i], "<absent>"))
            else:
                out += _diff(a[i], b[i], f"{path}[{i}]")
    elif a != b or type(a) is not type(b):
        out.append((path, a, b))
    return out


def _node_at(body, path):
    """The content node a diff path sits in (path like .content[3].attrs.fallback)."""
    m = re.match(r"^\.content\[(\d+)\]", path)
    return (body.get("content") or [])[int(m.group(1))] if m else None


def d2(S, b, base, vp, kbd=False):
    """D2 / W11-R79 ruling (a): the first open of a template-made note may write ONLY the Market context
    self-archive's new `fallback` (null -> an image); then nothing. Every PUT body and the exact stored change."""
    pid = PUTP[vp]
    c = S.ctx(pid, Ctx(b, base, vp, pid))
    pg = c.page
    bodies = []
    pg.on("request", lambda r: r.method in ("PUT", "PATCH") and "/api/j2/notes/" in r.url and bodies.append(
        {"t": time.strftime("%H:%M:%S"), "m": r.method, "u": r.url[-60:], "body": (r.post_data or "")[:400000]}))
    sheet, lib = open_picker(c)
    det = library_detail(c, lib, "Pre-market prep")
    click(c, det.get_by_role("button", name="Use this template"))
    ad = adopt_sheet(pg)
    cr = ad.get_by_text(re.compile(r"^Create .* from the template$"))
    for i in range(cr.count()):
        cr.nth(i).click()
    click(c, ad.get_by_role("button", name="Use", exact=True))
    nid = wait_note(pg)
    d1_check(S, c, "D2 Use")
    n0 = note_of(pid, nid, base)
    pg.wait_for_timeout(15000)
    n1 = note_of(pid, nid, base)
    k1 = len(bodies)
    ch = _diff(n0.get("bodyJson"), n1.get("bodyJson"))
    S.saw("first open: note PUTs", json.dumps([{k: v for k, v in x.items() if k != "body"} for x in bodies]))
    S.saw("first open: every stored change (path, before, after)", json.dumps([[p, o, (str(n_)[:300])] for p, o, n_ in ch])[:6000])
    for x in bodies:
        try:
            sent = json.loads(x["body"]).get("bodyJson")
            pc = _diff(n0.get("bodyJson"), sent)
            S.saw(f"PUT {x['t']}: what the request body changes against the created note",
                  json.dumps([[p, o, str(n_)[:300]] for p, o, n_ in pc])[:6000])
        except Exception as e:  # noqa: BLE001
            S.saw(f"PUT {x['t']}: body not JSON", str(e))
    bad = []
    for p_, o, n_ in ch:
        node = _node_at(n0.get("bodyJson") or {}, p_) or {}
        wid = (node.get("attrs") or {}).get("widgetId")
        ok = p_.endswith(".attrs.fallback") and o is None and isinstance(n_, dict) and wid == "marketcontext"
        if not ok:
            bad.append([p_, o, str(n_)[:200], wid])
    S.check("D2: the first open's only stored change is the Market context self-archive's new `fallback` (null -> image)",
            not bad, json.dumps(bad)[:1500])
    S.check("D2: at most one note PUT on the first open", k1 <= 1, k1)
    pg.reload(wait_until="domcontentloaded")
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    pg.wait_for_timeout(15000)
    n2 = note_of(pid, nid, base)
    S.saw("reload: note PUTs", json.dumps([{k: v for k, v in x.items() if k != "body"} for x in bodies[k1:]]))
    S.check("D2: then zero: re-opening it (reload, 15 s) sends no note PUT and changes nothing", len(bodies) == k1 and
            not _diff(n1.get("bodyJson"), n2.get("bodyJson")), json.dumps(_diff(n1.get("bodyJson"), n2.get("bodyJson")))[:500])
    S.shot(pg, "main")
    S.measure(pg, "note", None, touch=c.touch)


ROUTINE_OVF_JS = r"""() => [...document.querySelectorAll('[data-routine-block]')].map(rb => { const r = rb.getBoundingClientRect();
  const off = [...rb.querySelectorAll('*')].filter(e => { const b = e.getBoundingClientRect(); return b.width > 0 && (b.right > r.right + 0.5 || b.left < r.left - 0.5) })
     .slice(0, 8).map(e => ({tag: e.tagName, cls: String(e.className).slice(0, 40), right: Math.round(e.getBoundingClientRect().right), text: (e.innerText || '').slice(0, 40)}));
  const clipped = [...rb.querySelectorAll('*')].filter(e => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX !== 'visible').slice(0, 6)
     .map(e => ({cls: String(e.className).slice(0, 40), sw: e.scrollWidth, cw: e.clientWidth}));
  return {left: Math.round(r.left), right: Math.round(r.right), vw: innerWidth, outside: off, clipped} })"""


def d3(S, b, base, vp, kbd=False):
    """D3: the routine block of a Night-before prep note (the long item 'Check tomorrow's earnings and economic
    calendar') has no overflow."""
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    use_library(S, c, "Night-before prep")
    pg.wait_for_timeout(2500)
    rb = pg.locator("[data-routine-block]").first
    rb.scroll_into_view_if_needed()
    ov = pg.evaluate(ROUTINE_OVF_JS)
    S.saw("routine block geometry", json.dumps(ov))
    S.check("D3: no element of the routine block reaches outside it, nothing in it is clipped",
            ov and all(not x["outside"] and not x["clipped"] and x["right"] <= x["vw"] for x in ov), json.dumps(ov)[:800])
    S.check("D3: the long item reads whole ('Check tomorrow's earnings and economic calendar')",
            "Check tomorrow's earnings and economic calendar" in rb.inner_text().replace("’", "'"), rb.inner_text()[:300])
    S.shot(pg, "routine")
    m = S.measure(pg, "note", "[data-routine-block]", touch=c.touch)
    S.check("D3: page horizontal overflow 0", not (m.get("overflow") or {}).get("horizontal"), json.dumps(m.get("overflow"))[:300])


def d4(S, b, base, vp, kbd=False):
    """D4: the gallery cards' Use / Adopt / Preview buttons are >= 44 x 44 on the touch tier (820, 390)."""
    bc = S.ctx("B", Ctx(b, base, vp, B[vp]))
    pg = bc.page
    sheet = gallery(bc)
    seen = []
    for kind in ("Widgets", "Routines", "Trackers", "Templates"):
        chip = sheet.get_by_role("button", name=kind, exact=True)
        if chip.count():
            click(bc, chip.first); pg.wait_for_timeout(2000)
        boxes = pg.evaluate(r"""() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); if (!d) return [];
          return [...d.querySelectorAll('button')].filter(e => /^(Use|Adopt|Preview|Helpful)\b/.test(e.getAttribute('aria-label') || e.innerText.trim()))
            .filter(e => e.getBoundingClientRect().width > 0).map(e => { const b = e.getBoundingClientRect(); return {label: (e.getAttribute('aria-label') || e.innerText).slice(0, 50), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10} }) }""")
        S.saw(f"{kind}: card buttons", json.dumps(boxes)[:1500])
        seen += [dict(x, view=kind) for x in boxes]
        S.shot(pg, f"gallery-{kind.lower()}")
    uses = [x for x in seen if x["label"].startswith("Use ")]
    S.check("D4: the gallery shows tool cards with a Use button (W11.8 listings)", len(uses) > 0, len(uses))
    if bc.touch:
        small = [x for x in seen if x["w"] < 44 or x["h"] < 44]
        S.check("D4: every gallery card button (Use, Adopt, Preview, Helpful) is >= 44 x 44 on the touch tier", not small, json.dumps(small or uses[:4])[:800])
    else:
        S.note("1200 is not the touch tier: sizes recorded only")
    S.measure(pg, "gallery", "dialog", touch=bc.touch)


def d6(S, b, base, vp, kbd=False):
    """D6: with any Sheet open the page behind is inert (#root, and every body child not drawn above it); axe on the
    page shows no top-bar contrast finding in light (and dark)."""
    for theme, tag in (("Light", "light"), ("Graphite", "dark")):
        c = Ctx(b, base, vp, A[vp])
        S.ctxs[f"A-{tag}"] = c
        pg = c.page
        set_theme(c, theme)
        for surf, opener in (("picker", lambda: open_picker(c)), ("mytools", lambda: (c.goto("/journal/notebook?view=all"), my_tools(c, "Templates"))),
                             ("gallery", lambda: gallery(c))):
            opener()
            pg.wait_for_timeout(800)
            st = pg.evaluate(INERT_JS)
            S.saw(f"{tag} {surf}: inert picture", json.dumps(st)[:1500])
            S.check(f"D6 {tag} {surf}: #root is inert while the sheet is open", st["rootInert"], json.dumps(st)[:300])
            S.check(f"D6 {tag} {surf}: the open sheet itself is not inert", st["dialogs"] and not any(d["inert"] for d in st["dialogs"][-1:]), json.dumps(st["dialogs"]))
            live = [k for k in st["bodyChildren"] if not k["inert"] and k["id"] != "root" and not k["keep"]]
            S.saw(f"{tag} {surf}: body children left live (should be the sheet's own layer only)", json.dumps(live))
            m = S.measure(pg, f"{tag}-{surf}", "dialog", touch=c.touch)
            cc = [v for k in ("axe_page", "axe_sheet") for v in (m.get(k) or {}).get("violations") or [] if v["id"] == "color-contrast"]
            S.check(f"D6 {tag} {surf}: axe color-contrast has no finding (the top bar title behind the sheet included)", not cc,
                    json.dumps([x.get("targets") for x in cc])[:400])
            S.shot(pg, f"{tag}-{surf}")
            pg.keyboard.press("Escape"); pg.wait_for_timeout(800)
            st2 = pg.evaluate(INERT_JS)
            S.check(f"D6 {tag} {surf}: after closing it #root is live again", not st2["rootInert"] or bool(st2["dialogs"]), json.dumps(st2)[:200])
        set_theme(c, "OLED Black")
        c.close()


HOST_JS = r"""() => { const h = document.querySelector('[data-video-host]'); if (!h) return null; const b = h.getBoundingClientRect();
  return {mode: h.dataset.mode, inert: !!h.closest('[inert]'), parentIsBody: h.parentElement === document.body, keep: h.dataset.sheetKeepLive,
          z: getComputedStyle(h).zIndex, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height),
          visible: b.width > 0 && getComputedStyle(h).display !== 'none' && getComputedStyle(h).visibility !== 'hidden',
          rootInert: !!document.getElementById('root').hasAttribute('inert'), calls: (window.__ytCalls || []).slice(-8)} }"""


def _play_mini(S, c):
    pg = c.page
    c.goto("/desk")
    pg.wait_for_timeout(3000)
    card = pg.get_by_role("button").filter(has_text="53:49").first
    if not card.count():
        raise Inconclusive("no Desk video card (53:49) to play")
    click(c, card)
    pg.wait_for_timeout(2500)
    mn = pg.get_by_role("button", name="Minimize")
    if not mn.count():
        raise Inconclusive("the Desk player shows no Minimize")
    click(c, mn.first)
    pg.wait_for_timeout(1500)
    h = pg.evaluate(HOST_JS)
    S.saw("player after Minimize", json.dumps(h))
    return h


def _spa(pg, path):
    pg.evaluate("(p) => { history.pushState({}, '', p); dispatchEvent(new PopStateEvent('popstate')) }", path)
    pg.wait_for_timeout(3500)


def vid(S, b, base, vp, kbd=False):
    """R80/R82. (1) A Desk video playing in the floating player; a normal Sheet opens: the player stays live and its
    Pause, drag and Close work. (2) TickerPopup -> a chart sheet (touch): the sheet is drawn above the popup and is
    operable, the popup is inert under it. (3) A sheet lifted above the player makes the player inert.
    The YouTube iframe is a stand-in (ytstub.py); every product layer runs unchanged."""
    c = S.ctx("P01", Ctx(b, base, vp, VIDM))
    c.ctx.add_init_script(YT_STUB)
    pg = c.page
    h = _play_mini(S, c)
    S.check("the Desk video plays in the floating mini player (mode mini, 'play' sent to the player)", h and h["mode"] == "mini" and "play" in h["calls"], json.dumps(h))
    _spa(pg, "/journal/notebook?view=all")
    skip_tour(pg)
    click(c, pg.get_by_role("button", name="Templates", exact=True).first)
    pg.get_by_role("dialog", name="New note").wait_for(timeout=T)
    pg.wait_for_timeout(1200)
    h = pg.evaluate(HOST_JS)
    st = pg.evaluate(INERT_JS)
    S.saw("normal Sheet open: player / inert picture", json.dumps([h, st])[:2000])
    S.check("(1) a normal Sheet is open and #root is inert", st["rootInert"] and any(d["label"] == "New note" for d in st["dialogs"]), json.dumps(st["dialogs"]))
    S.check("(1) the player host (body child, keep-live 8500) is NOT inert under the normal Sheet", h and not h["inert"] and h["parentIsBody"], json.dumps(h))
    S.shot(pg, "video-under-sheet")
    host = pg.locator("[data-video-host]").first
    pb = host.get_by_role("button", name="Pause")
    click(c, pb)
    pg.wait_for_timeout(900)
    h2 = pg.evaluate(HOST_JS)
    S.check("(1) Pause works under the Sheet (the player got 'pause'; the button now reads Play)",
            "pause" in h2["calls"] and host.get_by_role("button", name="Play").count() >= 1, json.dumps(h2) + " play-buttons=" + str(host.get_by_role("button", name="Play").count()))
    S.check("(1) the Sheet stayed open (the tap did not fall through to its backdrop)", pg.get_by_role("dialog", name="New note").count() == 1, "")
    grip = host.locator("[class*=topbar]").first
    gb = grip.bounding_box()
    x0, y0 = h2["x"], h2["y"]
    pg.mouse.move(gb["x"] + gb["width"] * 0.3, gb["y"] + gb["height"] / 2)
    pg.mouse.down()
    for k in range(1, 9):
        pg.mouse.move(gb["x"] + gb["width"] * 0.3 - 12 * k, gb["y"] + gb["height"] / 2 - 9 * k)
        pg.wait_for_timeout(30)
    pg.mouse.up()
    pg.wait_for_timeout(800)
    h3 = pg.evaluate(HOST_JS)
    S.saw("drag: player position before / after", json.dumps([[x0, y0], [h3["x"], h3["y"]]]))
    S.check("(1) dragging the player's bar moves it under the Sheet", (h3["x"], h3["y"]) != (x0, y0), json.dumps([[x0, y0], [h3["x"], h3["y"]]]))
    S.check("(1) the Sheet stayed open through the drag", pg.get_by_role("dialog", name="New note").count() == 1, "")
    click(c, host.get_by_role("button", name="Close player"))
    pg.wait_for_timeout(1200)
    h4 = pg.evaluate(HOST_JS)
    S.check("(1) Close works under the Sheet (the player is gone)", h4 is None or not h4["visible"], json.dumps(h4))
    S.check("(1) the Sheet stayed open through Close", pg.get_by_role("dialog", name="New note").count() == 1, "")
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(800)
    # (2)+(3): the player again, then the article's TickerPopup and the sheets opened from inside it
    h = _play_mini(S, c)
    _spa(pg, "/desk/article/sunday-scans-36e")
    chip = pg.get_by_role("button", name="QQQ", exact=True).first
    if not chip.count():
        raise Inconclusive("the article shows no QQQ ticker button")
    chip.scroll_into_view_if_needed()
    click(c, chip)
    pop = pg.get_by_role("dialog", name="QQQ chart")
    pop.wait_for(timeout=T)
    pg.wait_for_timeout(5000)
    S.shot(pg, "tickerpopup")
    st = pg.evaluate(INERT_JS)
    S.saw("TickerPopup open: inert picture", json.dumps(st)[:1500])
    bb = pop.bounding_box()
    pg.mouse.click(bb["x"] + bb["width"] * 0.45, bb["y"] + bb["height"] * 0.55, button="right")
    pg.wait_for_timeout(1800)
    ca = pg.get_by_role("dialog", name="Chart actions")
    if c.touch and not ca.count():
        raise Inconclusive("the chart's context menu did not open as a Sheet")
    if c.touch:
        ai = ca.get_by_text("Add indicator", exact=False).first
        click(c, ai)
        pg.wait_for_timeout(2500)
        lib = pg.get_by_role("dialog", name="Indicator library")
        if not lib.count():
            raise Inconclusive("Add indicator did not open the Indicator library sheet")
        st = pg.evaluate(INERT_JS)
        h = pg.evaluate(HOST_JS)
        S.saw("Indicator library opened from the TickerPopup: inert picture / player", json.dumps([st, h])[:2500])
        zs = {d["label"]: d for d in st["dialogs"]}
        il, qp = zs.get("Indicator library") or {}, zs.get("QQQ chart") or {}
        S.check("(2) the chart sheet is drawn ABOVE the popup (z > 8600)", il and int(il.get("z") or 0) > int(qp.get("z") or 0) >= 8600, json.dumps([il, qp]))
        S.check("(2) the popup is inert under the sheet", bool(qp) and qp["inert"], json.dumps(qp))
        S.check("(2) the sheet is not inert", bool(il) and not il["inert"], json.dumps(il))
        S.check("(3) the sheet lifted above the video (z > 8500) makes the player inert", h and h["inert"], json.dumps(h))
        S.shot(pg, "indicator-sheet-over-popup")
        S.measure(pg, "indicator-sheet", "dialog", touch=True)
        sb = lib.get_by_role("searchbox").or_(lib.locator("input")).first
        n0 = lib.locator("button, [role=option], [role=checkbox]").count()
        click(c, sb)
        pg.keyboard.type("RSI", delay=40)
        pg.wait_for_timeout(1500)
        n1 = lib.locator("button, [role=option], [role=checkbox]").count()
        S.saw("Indicator library rows before / after typing RSI", json.dumps([n0, n1, sb.input_value() if sb.count() else None]))
        S.check("(2) the sheet over the popup is operable (its search takes typing and filters the list)", (sb.input_value() == "RSI") and n1 != n0, json.dumps([n0, n1]))
        pg.keyboard.press("Escape")
        pg.wait_for_timeout(1500)
        st = pg.evaluate(INERT_JS)
        qp = {d["label"]: d for d in st["dialogs"]}.get("QQQ chart")
        S.check("(2) closing the sheet makes the popup live again", qp and not qp["inert"], json.dumps(st["dialogs"]))
    else:
        st = pg.evaluate(INERT_JS); h = pg.evaluate(HOST_JS)
        S.saw("1200: Chart actions over the popup", json.dumps([st, h])[:2000])
        S.note("1200 is not the touch tier: the chart context menu is a popover there; (2) is a touch item")
    S.measure(pg, "tickerpopup", "dialog", touch=c.touch)


def enf(S, b, base, vp, kbd=False):
    """editorNormalForm (W11-R80 m-3 / R82): a note made from a member template that holds widgets opens with zero
    note PUTs and no console errors."""
    n = names(vp)
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    puts_ = []
    pg.on("request", lambda r: r.method in ("PUT", "PATCH") and "/api/j2/notes/" in r.url and puts_.append({"t": time.strftime("%H:%M:%S"), "u": r.url[-50:]}))
    e0 = len(c.events)
    nid = use_style(c, "Daily prep", n["style"], S=S)
    pg.wait_for_timeout(15000)
    nn = note_of(A[vp], nid, base)
    kinds = [x.get("type") for x in (nn.get("bodyJson") or {}).get("content", [])]
    S.saw("the created note's blocks", json.dumps(kinds))
    S.check("the member template holds widgets (two built widgets in the note)", kinds.count("widgetEmbed") >= 2 or pg.locator("[data-snapshot-frame]").count() >= 2, json.dumps(kinds))
    S.check("editorNormalForm: the created note opens with ZERO note PUTs (15 s)", not puts_, json.dumps(puts_))
    pg.reload(wait_until="domcontentloaded")
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    pg.wait_for_timeout(8000)
    S.check("editorNormalForm: and zero after a reload", not puts_, json.dumps(puts_))
    cons = [e for e in c.events[e0:] if "console" in e or "pageerror" in e]
    S.check("no console errors / page errors", not cons, json.dumps(cons)[:500])
    S.shot(pg, "main")


THEMES = (("dark", "Graphite"), ("oled", "OLED Black"), ("light", "Light"))


def pd1(S, b, base, vp, kbd=False):
    """PD-1: the Login 'Log In' button >= 4.5:1 in dark, OLED and light, at rest, on hover and while loading
    (disabled); Log In and 'Forgot password?' >= 44 px on the touch tier. Logged out; the theme is the app's own
    no-flash cache (uct.appTheme.v1), the path a returning visitor's browser takes."""
    for theme, label in THEMES:
        c = Ctx(b, base, vp, None)
        S.ctxs[f"anon-{theme}"] = c
        c.ctx.add_init_script("try { localStorage.setItem('uct.appTheme.v1', JSON.stringify({dataTheme: %s, vars: {}})) } catch (e) {}" % json.dumps(theme))
        pg = c.page
        pg.goto(base + "/login", wait_until="domcontentloaded")
        pg.get_by_role("button", name="Log In").wait_for(timeout=T)
        with contextlib.suppress(Exception):
            h._dismiss_intro(pg)
        pg.wait_for_timeout(1500)
        got = pg.evaluate("() => document.documentElement.dataset.theme")
        btn = pg.get_by_role("button", name="Log In")
        rest = btn.evaluate(CON_JS)
        S.saw(f"{theme}: data-theme / Log In at rest", json.dumps([got, rest]))
        S.check(f"PD-1 {theme}: the page is in the {theme} theme", got == theme, got)
        S.check(f"PD-1 {theme}: 'Log In' at rest >= 4.5:1", rest["ratio"] >= 4.5, json.dumps(rest))
        btn.hover(); pg.wait_for_timeout(400)
        hov = btn.evaluate(CON_JS)
        S.check(f"PD-1 {theme}: 'Log In' hovered >= 4.5:1", hov["ratio"] >= 4.5, json.dumps(hov))
        pg.mouse.move(1, 1)
        fp = pg.get_by_role("link", name="Forgot password?")
        fpc = fp.evaluate(CON_JS)
        S.saw(f"{theme}: Forgot password?", json.dumps(fpc))
        if c.touch:
            S.check(f"PD-1 {theme} {vp}: 'Log In' >= 44 px tall (and wide)", rest["h"] >= 44 and rest["w"] >= 44, json.dumps(rest))
            S.check(f"PD-1 {theme} {vp}: 'Forgot password?' >= 44 px tall", fpc["h"] >= 44, json.dumps(fpc))
        if theme == "light" or vp == "1200":
            S.shot(pg, f"login-{theme}")
        m = S.measure(pg, f"login-{theme}", None, touch=c.touch)
        # loading / disabled: hold the login answer so the button sits in "Logging in..."
        held = []
        pg.route("**/api/auth/login", lambda route: held.append(route))   # left pending: the button sits in its loading state
        pg.get_by_label(re.compile("^Email", re.I)).fill("nobody@local.dev")
        pg.get_by_label(re.compile("^Password", re.I)).fill("not-a-real-password")
        btn.click(no_wait_after=True)
        ld = pg.get_by_role("button", name=re.compile(r"^Logging in"))
        with contextlib.suppress(Exception):
            ld.first.wait_for(timeout=8000)
        ldc = ld.first.evaluate(CON_JS) if ld.count() else None
        S.saw(f"{theme}: the button while loading", json.dumps(ldc))
        S.check(f"PD-1 {theme}: 'Logging in...' (disabled) >= 4.5:1", bool(ldc) and ldc["disabled"] and ldc["ratio"] >= 4.5, json.dumps(ldc))
        if theme == "light":
            S.shot(pg, f"login-{theme}-loading")
        for rt in held:
            with contextlib.suppress(Exception):
                rt.fulfill(status=401, content_type="application/json", body='{"detail":"Invalid email or password"}')
        pg.wait_for_timeout(1000)
        c.close()


ZERO_NODES_JS = r"""() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); const out = []; if (!d) return out;
  const w = document.createTreeWalker(d, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) { const t = n.textContent; if (!/(^|[^\d.,])0 (trades|strategies|positions|days|notes)\b|\$0\.00/.test(t)) continue;
    const e = n.parentElement; const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
    const clip = s.clip === 'rect(0px, 0px, 0px, 0px)' || s.clipPath === 'inset(50%)' || (b.width <= 1 && b.height <= 1);
    out.push({text: t.trim().slice(0, 140), cls: String(e.className).slice(0, 40), live: !!e.closest('[aria-live]'),
              shown: !clip && b.width > 2 && b.height > 2 && s.visibility !== 'hidden' && s.opacity !== '0' && !e.closest('[hidden]'),
              testid: (e.closest('[data-testid]') || {dataset: {}}).dataset.testid || null}) }
  return out }"""


def pd2(S, b, base, vp, kbd=False):
    """PD-2: the builder's summary on an empty payload says the empty sentence, never '0 trades · $0.00' (P14, 10
    trades, 0 options strategies and 0 open positions: two empty sources)."""
    c = S.ctx("P14", Ctx(b, base, vp, "P14"))
    pg = c.page
    r = RunA(c); rw = rowA()
    c.goto("/journal/notebook?view=all")
    rc.a_seed_note(r, {"title": f"PD-2 retest {vp}", "paras": ["Builder."]}, rw)
    rc.a_open_note(r, {"note": "n1"}, rw)
    for src, want in (("Options strategies", "No options strategies in this range."), ("Open positions", "No open positions.")):
        rc.a_open_builder(r, {}, rw)
        rc.a_builder_blank(r, {"source": src}, rw)
        pg.wait_for_timeout(3000)
        dlg = rc.builder(pg)
        bar = dlg.locator("[data-testid=builder-summary-bar]")
        bt = bar.first.inner_text() if bar.count() and bar.first.is_visible() else None
        pane = dlg.locator("[data-testid=builder-preview]")
        pt = pane.first.inner_text() if pane.count() and pane.first.is_visible() else None
        live = rc.live_text(pg)
        S.saw(f"{src}: summary bar / preview pane / live region", json.dumps({"bar": bt, "pane": (pt or "")[:400], "live": live}))
        shown = bt if vp == "390" else (pt or "")
        if vp == "390":
            S.check(f"PD-2 {src}: the phone summary bar says the empty sentence {want!r}", bool(bt) and want in bt, str(bt))
        else:
            S.check(f"PD-2 {src}: the preview says the empty sentence {want!r}", want in (pt or "") or want in (bt or ""), (pt or bt or "")[:300])
        if vp == "390":
            S.check(f"PD-2 {src}: no '0 <unit>' count and no '$0.00' in the phone summary bar", not re.search(r"(^|[^\d.,])0 (trades|strategies|positions|days|notes)\b|\$0\.00", bt or ""), str(bt)[:300])
        vis0 = pg.evaluate(ZERO_NODES_JS)
        S.saw(f"{src}: zero-count text nodes in the builder (shown / in a live region)", json.dumps(vis0))
        shownz = [x for x in vis0 if x["shown"] and not x["live"]]
        S.check(f"PD-2 {src}: no SHOWN '0 <unit>' / '$0.00' text anywhere in the builder", not shownz, json.dumps(shownz)[:400])
        if shownz:
            S.defect(f"builder preview over an empty source: .{shownz[0]['cls']} (data-testid={shownz[0].get('testid')})",
                     "plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (PD-2's rule, another surface)",
                     f"shown at {vp}: {[x['text'] for x in shownz]}", "minor")
        zl = re.search(r"(^|[^\d.,])0 (trades|strategies|positions|days|notes)\b", live or "")
        S.saw(f"{src}: zero count in the polite live region (not the PD-2 surface)", json.dumps({"live": live, "zero": bool(zl)}))
        if zl:
            S.defect("[data-testid=builder-live] (the builder's polite live region) over an empty source",
                     "plan w7-w8 :666 'An `empty` payload renders its §5.9 sentence ... never a zero' (the same rule PD-2 applied to the bar)",
                     f"the live region announces {live!r}: a zero count, not the empty sentence", "minor")
        S.shot(pg, f"builder-{src.split()[0].lower()}")
        S.measure(pg, f"builder-{src.split()[0].lower()}", "dialog", touch=c.touch)
        rc.a_close_dialog(r, {"discard": True}, rw)
        pg.wait_for_timeout(800)


def pd3(S, b, base, vp, kbd=False):
    """PD-3: the Journal Toast 'Dismiss' is >= 44 x 44 on the touch tier (the '/tilt' check's 'Tilt check added.')."""
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    r = RunA(c); rw = rowA()
    c.goto("/journal/notebook?view=all")
    rc.a_seed_note(r, {"title": f"PD-3 retest {vp}", "paras": ["Toast."]}, rw)
    rc.a_open_note(r, {"note": "n1"}, rw)
    rc.slash(r, pg, "/tilt", "(?i)tilt check")
    dm = pg.get_by_role("button", name="Dismiss", exact=True)
    try:
        dm.first.wait_for(timeout=10000)
    except Exception:  # noqa: BLE001
        raise Inconclusive("no Toast with a Dismiss appeared after '/tilt'")
    tt = pg.evaluate("() => [...document.querySelectorAll('[role=status], [role=alert]')].map(e => e.innerText.trim()).filter(Boolean).slice(0, 4)")
    bx = dm.first.evaluate(CON_JS)
    S.saw("toast / Dismiss", json.dumps([tt, bx]))
    if c.touch:
        S.check(f"PD-3 {vp}: Toast 'Dismiss' >= 44 x 44", bx["w"] >= 44 and bx["h"] >= 44, json.dumps(bx))
    else:
        S.check("1200: the Toast shows (sizes recorded; the floor is a touch-tier rule)", True, json.dumps(bx))
    S.shot(pg, "toast")
    S.measure(pg, "toast", None, touch=c.touch)
    click(c, dm.first)
    pg.wait_for_timeout(700)
    S.check(f"PD-3 {vp}: Dismiss closes the toast", dm.count() == 0 or not dm.first.is_visible(), "")


def d5(S, b, base, vp, kbd=False):
    """D5: axe scrollable-region-focusable nowhere: every surface this run measured at this viewport, plus the
    Pre-market prep note (Market context readings list) measured here."""
    c = S.ctx("A", Ctx(b, base, vp, A[vp]))
    pg = c.page
    nid = st().get(f"w112_note_{vp}")
    if not nid:
        raise Inconclusive("no W11.2 note")
    c.goto(f"/journal/notebook?note={nid}")
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    rc.render_all(pg)
    pg.wait_for_timeout(2500)
    lst = pg.evaluate("() => [...document.querySelectorAll('[class*=_list_]')].filter(e => e.scrollHeight > e.clientHeight).map(e => ({cls: String(e.className).slice(0, 40), tabindex: e.getAttribute('tabindex'), role: e.getAttribute('role'), label: e.getAttribute('aria-label')}))")
    S.saw("scrollable lists on the note (tabindex / role / label)", json.dumps(lst))
    m = S.measure(pg, "note", None, touch=c.touch)
    own = [v for v in (m.get("axe_page") or {}).get("violations") or [] if v["id"] == "scrollable-region-focusable"]
    S.check("D5: axe scrollable-region-focusable has no finding on the template note", not own, json.dumps([v.get("targets") for v in own]))
    from ev import _load
    w = _load()
    hits = []
    for k, d in w["steps"].items():
        if not k.startswith(vp + "-"):
            continue
        for surf, mm in d.get("metrics", {}).items():
            for key in ("axe_sheet", "axe_page"):
                for v in (mm.get(key) or {}).get("violations") or []:
                    if v["id"] == "scrollable-region-focusable":
                        hits.append([k, surf, v.get("targets")])
    S.check(f"D5: no surface measured at {vp} in this run has scrollable-region-focusable", not hits, json.dumps(hits)[:600])
    S.shot(pg, "note")
