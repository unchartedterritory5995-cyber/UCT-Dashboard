"""UI helpers for the wave 11 surfaces (selectors read from the product source and the exploration run)."""
import json, re, time, contextlib, datetime as dt
from common import *
from ev import Inconclusive
from wapi import req

A = {"1200": "P35", "820": "P04", "390": "P29"}
B = {"1200": "P08", "820": "P25", "390": "P28"}
N = {"1200": "P01", "820": "P36", "390": "P40"}
ADMIN = "P45"
for _k, _d in (("WALK_ROLE_A", A), ("WALK_ROLE_B", B)):
    if os.environ.get(_k):            # dev-only override "vp=Pnn"; never set on the evidence run
        _v, _p = os.environ[_k].split("=")
        _d[_v] = _p
STATE = Path(os.environ.get("WALK_STATE", str(SCR / "w2" / "state.json")))
ZERO_RE = rc.ZERO_RE
HEX_ID = re.compile(r"\b[0-9a-f]{32}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b")


def st():
    return json.loads(STATE.read_text(encoding="utf-8")) if STATE.exists() else {}


def st_set(key, val):
    s = st(); s[key] = val
    STATE.write_text(json.dumps(s, indent=1), encoding="utf-8")


def sess(pid, clock=False):
    return session_of(pid, clock)


def api(pid, path, data=None, meth=None, base=None, clock=False):
    return req(sess(pid, clock), path, data, meth, base=base)


def now_et(base):
    ident = json.loads(__import__("urllib.request").request.urlopen(base + "/__uct_sandbox_identity", timeout=10).read())
    # the identity's now_et is the boot-time snapshot: the server's now is the real clock plus the shift
    from zoneinfo import ZoneInfo
    off = float(ident["clock_shift"].get("offset_s") or 0)
    # absolute-time arithmetic (UTC), then ET: adding a timedelta to an aware ET datetime is WALL-clock arithmetic
    # and is an hour wrong across a DST change (Nov 1)
    now = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=off)).astimezone(ZoneInfo("America/New_York"))
    return now, ident


def day_label(d):
    return f"For {d:%a %b} {d.day}"


def visible(loc):
    try:
        return loc.count() > 0 and loc.first.is_visible()
    except Exception:  # noqa: BLE001
        return False


def click(c, loc, keyboard=False):
    loc.wait_for(state="visible", timeout=T)
    if keyboard:
        rc.tab_to(c.page, loc)
        c.page.keyboard.press("Enter")
    elif c.touch:
        loc.scroll_into_view_if_needed(timeout=T)
        loc.tap(timeout=T)
    else:
        loc.click(timeout=T)


def top_dialog(pg):
    d = pg.locator("[role=dialog]:visible")
    return d.last if d.count() else None


def open_picker(c):
    """The New note sheet that holds the TemplatePicker: the notebook toolbar's "Templates" button."""
    pg = c.page
    c.goto("/journal/notebook?view=all")
    btn = pg.get_by_role("button", name="Templates", exact=True)
    if not visible(btn):
        # phone: the toolbar may fold it away; the inline picker on an empty notebook is the same component
        more = pg.get_by_role("button", name=re.compile(r"^(More notebook actions|More)$"))
        raise Inconclusive("no visible Templates button on the notebook toolbar")
    click(c, btn.first)
    sheet = pg.get_by_role("dialog", name="New note")
    sheet.wait_for(timeout=T)
    lib = sheet.locator("[data-template-library]")
    lib.first.wait_for(timeout=T)
    pg.wait_for_function("() => document.querySelectorAll('[data-template-library] [data-library-card]').length > 0", timeout=T)
    return sheet, lib.first


def library_detail(c, lib, title):
    pg = c.page
    btn = lib.get_by_role("button", name=f"Preview {title}, from the Template library")
    click(c, btn)
    det = pg.get_by_role("dialog", name=title)
    det.wait_for(timeout=T)
    pg.get_by_text("Preview with your data").last.wait_for(timeout=T)
    pg.wait_for_timeout(1500)
    return det


def adopt_sheet(pg):
    ad = pg.get_by_role("dialog", name="Make it yours")
    ad.wait_for(timeout=T)
    with contextlib.suppress(Exception):
        pg.wait_for_function("() => !document.body.innerText.includes('Getting your preview ready')", timeout=20000)
    pg.wait_for_timeout(1200)
    return ad


def radios_state(ad):
    out = []
    r = ad.get_by_role("radio")
    for i in range(r.count()):
        out.append({"label": r.nth(i).evaluate("e => e.parentElement.innerText.trim()"), "checked": r.nth(i).is_checked()})
    return out


def wait_note(pg):
    pg.wait_for_url(re.compile(r"[?&]note="), timeout=T)
    pg.locator(".ProseMirror").first.wait_for(timeout=T)
    pg.wait_for_timeout(2500)
    m = re.search(r"note=([0-9a-f]+)", pg.url)
    return m.group(1) if m else None


def note_of(pid, nid, base, clock=False):
    s, r = api(pid, f"/api/j2/notes/{nid}", base=base, clock=clock)
    return r.get("note") if isinstance(r, dict) else None


def puts(c, since=0):
    return [r for r in c.requests[since:] if r["m"] in ("PUT", "PATCH") and "/api/j2/notes/" in r["u"]]


def my_tools(c, tab=None):
    pg = c.page
    btn = pg.get_by_role("button", name="My tools", exact=True)
    if not visible(btn):
        raise Inconclusive("no visible My tools button on the notebook page")
    click(c, btn.first)
    sh = pg.get_by_role("dialog", name="My tools")
    sh.wait_for(timeout=T)
    pg.wait_for_timeout(1000)
    if tab:
        click(c, sh.get_by_role("tab", name=tab))
        pg.wait_for_timeout(1800)
    return sh


def row_action(c, sh, name, action):
    pg = c.page
    click(c, sh.get_by_role("button", name=f"Actions for {name}", exact=True).first.first)
    pg.wait_for_timeout(600)
    item = pg.get_by_role("menuitem", name=action)
    if not visible(item):
        item = pg.get_by_role("button", name=action, exact=True)
    click(c, item.last)
    pg.wait_for_timeout(800)


def gallery(c, view=None):
    pg = c.page
    sheet, lib = open_picker(c)
    click(c, sheet.get_by_role("button", name="Browse the community gallery"))
    pg.wait_for_timeout(2500)
    if view:
        click(c, sheet.get_by_role("button", name=view, exact=True))
        pg.wait_for_timeout(2500)
    return sheet


def set_theme(c, label):
    """The app's own theme picker on Settings (AppThemePicker)."""
    pg = c.page
    c.goto("/settings")
    pg.wait_for_timeout(1500)
    pr = pg.get_by_role("tab", name="Preferences").or_(pg.get_by_role("button", name="Preferences", exact=True)).or_(pg.get_by_role("link", name="Preferences", exact=True))
    if pr.count():
        pr.first.click()
        pg.wait_for_timeout(2000)
    opt = pg.get_by_role("button", name=re.compile("^" + re.escape(label) + r"(\s|$)"))
    if not visible(opt):
        raise Inconclusive(f"the theme picker shows no {label!r} option")
    opt.first.scroll_into_view_if_needed()
    opt.first.click()
    pg.wait_for_timeout(1500)
    return pg.evaluate("() => document.documentElement.dataset.theme")


def kbd_audit(pg, scope_sel, presses=None, opener_handle=None):
    """Tab through a surface: which visible controls Tab reaches (a radio group counts once), and whether focus
    stays inside it (the trap). Returns {controls, reached, missing, escaped}."""
    info = pg.evaluate("""(sel) => {
      const root = document.querySelector(sel); if (!root) return null;
      const vis = e => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e); return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' };
      const ctl = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=switch], [role=tab], [tabindex]:not([tabindex="-1"])')]
        .filter(vis).filter(e => !e.disabled && !e.closest('[inert]') && !e.closest('[aria-hidden=true]'));
      ctl.forEach((e, i) => e.setAttribute('data-walk-k', String(i)));
      return ctl.map((e, i) => ({ k: i, label: (e.getAttribute('aria-label') || e.innerText || e.value || e.tagName).trim().slice(0, 50),
        group: e.type === 'radio' ? 'radio:' + e.name : (e.getAttribute('role') === 'tab' ? 'tablist' : (e.hasAttribute('data-roving-item') ? 'roving' : '')),
        tabindex: e.getAttribute('tabindex') }));
    }""", scope_sel)
    if info is None:
        return {"error": "no scope"}
    n = presses or (len(info) * 2 + 8)
    reached, escaped = set(), 0
    for _ in range(n):
        pg.keyboard.press("Tab")
        k = pg.evaluate("""(sel) => { const a = document.activeElement; const root = document.querySelector(sel);
            if (!root || !a) return {in: false, k: null};
            const c = a.closest('[data-walk-k]'); return {in: root.contains(a), k: c ? c.getAttribute('data-walk-k') : null} }""", scope_sel)
        if not k["in"]:
            escaped += 1
        if k["k"] is not None:
            reached.add(int(k["k"]))
    groups_reached = {i["group"] for i in info if i["k"] in reached and i["group"]}
    missing = [i for i in info if i["k"] not in reached and not (i["group"] and i["group"] in groups_reached)]
    return {"controls": len(info), "reached": len(reached), "missing": missing[:12], "escaped": escaped, "presses": n}


def focus_label(pg):
    return pg.evaluate("() => { const a = document.activeElement; return a ? (a.getAttribute('aria-label') || a.innerText || a.tagName).trim().slice(0, 60) : '' }")


def use_style(c, kind, style_name, S=None):
    """Make a note from one of the member's styles: the picker's kind card -> 'Choose another style' -> Use <name>."""
    pg = c.page
    sheet, lib = open_picker(c)
    click(c, sheet.get_by_role("button", name=f"Choose another style for {kind}"))
    pg.wait_for_timeout(1500)
    btn = sheet.get_by_role("button", name=f"Use {style_name}", exact=True)
    if not btn.count():
        raise Inconclusive(f"the {kind} style list shows no {style_name!r}")
    click(c, btn.first)
    pg.wait_for_timeout(1500)
    ad = pg.get_by_role("dialog", name="Make it yours")
    if ad.count() and ad.first.is_visible():
        adopt_sheet(pg)
        cr = ad.get_by_text(re.compile(r"^Create .* from the template$"))
        for i in range(cr.count()):
            cr.nth(i).click()
        click(c, ad.get_by_role("button", name="Use", exact=True))
    nid = wait_note(pg)
    if S is not None:
        after_use(S, c, f"Use {style_name}")
    return nid


CHIP_JS = r"""(sel) => {
  const root = document.querySelector(sel) || document;
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(',').map(x => parseFloat(x)); return {r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1} };
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b) };
  const bgOf = e => { let x = e; const stack = []; while (x && x.nodeType === 1) { const c = parse(getComputedStyle(x).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break } x = x.parentElement }
    let out = {r: 255, g: 255, b: 255, a: 1}; if (!stack.length) return out; out = stack.pop(); while (stack.length) { const t = stack.pop(); out = {r: t.r * t.a + out.r * (1 - t.a), g: t.g * t.a + out.g * (1 - t.a), b: t.b * t.a + out.b * (1 - t.a), a: 1} } return out };
  const els = [...root.querySelectorAll('button')].filter(e => /chipActive|chip_?[A-Za-z]*Active/.test(String(e.className)) || (/chip/i.test(String(e.className)) && e.getAttribute('aria-pressed') === 'true'));
  return els.filter(e => e.getBoundingClientRect().width > 0).map(e => { const fg = parse(getComputedStyle(e).color); const bg = bgOf(e); const l1 = lum(fg), l2 = lum(bg);
    const b = e.getBoundingClientRect();
    return {text: e.innerText.trim().slice(0, 40), cls: String(e.className).slice(0, 80), fg: getComputedStyle(e).color, bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
            ratio: Math.round(((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)) * 100) / 100, w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10} }) }"""


def chip_report(pg, sel, hover=True):
    """R5/R6: the active chip(s) of a gallery/picker filter row: text and background colours, contrast, size;
    measured at rest and (pointer) while hovered (the R5 bug was the hover rule out-ranking the active rule)."""
    rest = pg.evaluate(CHIP_JS, sel)
    hov = []
    if hover:
        for i, r in enumerate(rest):
            loc = pg.locator(sel).locator("button", has_text=r["text"]).first
            with contextlib.suppress(Exception):
                loc.hover(timeout=5000)
                pg.wait_for_timeout(300)
                hov.extend([x for x in pg.evaluate(CHIP_JS, sel) if x["text"] == r["text"]])
        pg.mouse.move(1, 1)
    return {"rest": rest, "hover": hov}


def filter_chip_sizes(pg, sel):
    """R6: every filter chip in the gallery / picker filter rows (role=button with aria-pressed), its box."""
    return pg.evaluate(r"""(sel) => { const root = document.querySelector(sel) || document;
      return [...root.querySelectorAll('button')].filter(e => /(^|\s)_chip(Active)?_/.test(String(e.className)) && e.getBoundingClientRect().width > 0)
        .map(e => { const b = e.getBoundingClientRect(); return {text: e.innerText.trim().slice(0, 40), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10} }) }""", sel)


def after_use(S, c, where):
    """Re-walk: D1 (sheet closed, focus on the new note's title, no inert ancestor) after every Use."""
    from steps_g import d1_check
    d1_check(S, c, where)
    return True
