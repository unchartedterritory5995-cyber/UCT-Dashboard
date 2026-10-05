"""Wave 14, lane W14-Q1 -- the real-browser walk of the NON-tour onboarding surfaces.

Spec: docs/notebook/WAVE-14-PLAN.md section 6.2 (one walk script, `notebook_w14_onboarding_walk.py`,
on `notebook_perf_harness.Sandbox`, raw JSON before any summary) and 5.3-5.6 (no tour blocks a
member, keyboard paths, phone and tablet, the first-run stage owns every first-run surface).
Lane record: docs/notebook/wave14-w14-q1.md.

Surfaces walked, on a FRESH sandbox account per width (no notes, no preferences):

  S1  the base tour as it auto-starts on the first-run screen (wave 8, unchanged)
  S2  the first-run welcome: today's buttons, the capability preview, the sample promotion,
      the "Get started" checklist (W14-A, W14-D)
  S3  the tour OFFER prompt ("New in your Notebook: ...", W14-C2), after the base tour is
      dismissed and the checklist is hidden (the two things it waits behind)
  S4  Help > What's new and Help > Walkthroughs (W14-0, W14-C2)
  S5  the base tour replayed from Help on a COLD page (W14-C2's fix for W14-0's step-2 open)

At each surface, at 1200 / 820 / 390 px:
  * a small PNG of the surface itself (element screenshot, palette-quantised);
  * no horizontal scroll (document, body, and the app's scroll container) and no surface
    element past the viewport's right edge;
  * at <= 1024 px (the touch tier): every control in the surface at least `--tap-min`
    (read from the page's own computed style, never hard-coded) in BOTH dimensions;
  * no stacked first-run surfaces: at most ONE of {a tour dialog, the offer card, another
    card in the first-run slot} on screen;
  * keyboard-only reach: every enabled control in the surface receives focus from real Tab
    presses (from the top of the document; inside a modal tour, inside the dialog);
  * axe-core (the repo's pinned copy) scoped to the surface, every violation recorded.
And once: the offer never takes focus (activeElement polled from before it mounts until
1.5 s after).

CONTROL phase ("off"): a second sandbox with `NOTEBOOK_ONBOARDING_ENABLED` and
`NOTEBOOK_GETTING_STARTED_ENABLED` UNSET (production's default for an unset gate) and the tour
capability flag still on. The first-run screen must be exactly the pre-wave-14 shape: title,
hint, one row of the base buttons (Start a note, Create a thesis, Import notes, and Today when
passed), no sample / tour door, no preview, no checklist, no tour dialog.

Flags (sandbox env only; each a key of api/routers/auth.py NOTEBOOK_FLAGS, never invented). The
ledger convention (tools/notebook_w13q_clicks.py header): plain LISTS, armed with
`os.environ.update`, never a subscript and never a dict literal of gate names.

Usage (PowerShell; ports 8715-8719; each phase gets its own empty data dir under --data-root):
    python tools/notebook_w14_onboarding_walk.py --data-root '<scratch>\\w14q1-walk' --port 8715 `
        --out docs\\notebook\\evidence\\wave14-q1

Exit: 0 = every check PASSED in every phase; 1 = at least one FAILED; 3 = not run.
R-RAW: walk.json is rewritten after every check, before any verdict is printed.
"""
from __future__ import annotations

import argparse
import io
import json
import os
import re
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:  # noqa: BLE001
        pass

REPO = Path(__file__).resolve().parents[1]
if str(REPO / "tools") not in sys.path:
    sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

PORTS = range(8715, 8720)
AXE_PATH = REPO / "app" / "node_modules" / "axe-core" / "axe.min.js"
WIDTHS = [(1200, 900), (820, 1180), (390, 844)]
TOUCH_MAX = 1024          # app/src/styles/breakpoints.js: the touch tier is <= 1024 px
TAB_CAP = 400

# The two onboarding gates this lane walks, and two tour-capability gates armed so an offer can
# appear: writing help (armed on web per docs/feature_flags.json, so this is the offer a new member
# meets today, and the one capability line the welcome preview can show) and the template gallery
# (a second offerable tour, so What's new has more than the declined one). The offer's title is READ
# from the card, never assumed: registry order decides it (tours/b1Core.js).
ONBOARDING_FLAGS = ["NOTEBOOK_ONBOARDING_ENABLED", "NOTEBOOK_GETTING_STARTED_ENABLED"]
CAPABILITY_FLAGS = ["NOTEBOOK_WRITING_HELP_ENABLED", "NOTEBOOK_TEMPLATE_GALLERY_ENABLED"]
BASE_TOUR_TITLE = "Notebook basics"
BASE_STEP1_TITLE = "Welcome to your Notebook"

# The first-run row as it shipped before wave 14 (WAVE-14-PLAN.md 3.1; ResearchHome.jsx).
PRE_W14_BUTTONS = ["Start a note", "Create a thesis", "Import notes"]
PRE_W14_OPTIONAL = ["Today"]

CHECKS: list[dict] = []
REPORT: dict = {}
OUT: Path | None = None


def _flush() -> None:
    if OUT is not None:
        (OUT / "walk.json").write_text(json.dumps({**REPORT, "checks": CHECKS}, indent=1, ensure_ascii=False,
                                                  default=str), encoding="utf-8")


def record(phase: str, width: int, surface: str, check: str, ok: bool | None, **facts) -> None:
    """ok=None is INFO: a fact recorded beside the checks, never a pass or a fail."""
    row = {"phase": phase, "width": width, "surface": surface, "check": check,
           "verdict": "INFO" if ok is None else ("PASS" if ok else "FAIL"), **facts}
    CHECKS.append(row)
    short = {k: v for k, v in facts.items() if k not in ("violations", "trail", "controls")}
    print(f"{row['verdict']:<4} [{phase} {width}] {surface}: {check}" + (f" -- {short}" if short else ""),
          flush=True)
    _flush()


# ── page probes (JS) ──────────────────────────────────────────────────────────────────────

MARK_JS = """(sel) => { document.querySelectorAll('[data-q1-root]').forEach(e => e.removeAttribute('data-q1-root'));
  let n = 0; for (const s of sel) { document.querySelectorAll(s).forEach(e => { e.setAttribute('data-q1-root', '1'); n++ }) }
  return n }"""

CONTROLS_JS = """() => {
  const roots = [...document.querySelectorAll('[data-q1-root]')];
  const out = []; const seen = new Set();
  for (const r of roots) for (const el of r.querySelectorAll('button, a[href], [role=button], input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])')) {
    if (seen.has(el)) continue; seen.add(el);
    const b = el.getBoundingClientRect();
    if (b.width <= 0 || b.height <= 0) continue;
    if (el.disabled) continue;
    out.push(el);
  }
  return out;
}"""

TAP_JS = """() => {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--tap-min').trim();
  const tapMin = parseFloat(raw);
  const ctls = (""" + CONTROLS_JS + """)();
  const small = ctls.map(el => { const b = el.getBoundingClientRect();
      return { label: (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 50),
               w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10 } })
    .filter(c => !(c.w + 0.5 >= tapMin && c.h + 0.5 >= tapMin));
  return { tapMinRaw: raw, tapMin, controls: ctls.length, small };
}"""

OVERFLOW_JS = """() => {
  const de = document.documentElement, vw = de.clientWidth;
  const sc = document.querySelector('[class*="_content_"]');
  const off = [];
  for (const r of document.querySelectorAll('[data-q1-root]')) for (const el of [r, ...r.querySelectorAll('*')]) {
    const b = el.getBoundingClientRect();
    if (b.width > 0 && b.height > 0 && (b.right > vw + 1 || b.left < -1)) {
      off.push({ tag: el.tagName, cls: String(el.className || '').slice(0, 60), left: Math.round(b.left), right: Math.round(b.right) });
      if (off.length >= 8) break;
    }
  }
  return { vw, docScrollWidth: de.scrollWidth, bodyScrollWidth: document.body.scrollWidth,
           contentScroll: sc ? [sc.scrollWidth, sc.clientWidth] : null,
           horizontal: de.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1 || (sc ? sc.scrollWidth > sc.clientWidth + 1 : false),
           offenders: off };
}"""

STAGE_JS = """() => {
  const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
                       return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' };
  const tours = [...document.querySelectorAll('[role=dialog][aria-modal=true]')].filter(vis)
    .map(d => (d.querySelector('h2') || {}).innerText || d.getAttribute('aria-label') || '');
  const offers = [...document.querySelectorAll('[data-tour-offer]')].filter(vis);
  const slot = document.querySelector('[data-first-run-slot]');
  const others = slot ? [...slot.children].filter(e => !e.hasAttribute('data-tour-offer') && vis(e))
                          .map(e => (e.innerText || '').trim().slice(0, 60)) : [];
  return { tourDialogs: tours, offers: offers.length, slotPresent: !!slot,
           slotChildren: slot ? slot.children.length : 0, slotOthers: others,
           surfaces: tours.length + offers.length + others.length };
}"""

FOCUS_DESC_JS = """() => { const el = document.activeElement;
  if (!el || el === document.body) return 'BODY';
  return (el.tagName + ':' + (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\\s+/g, ' ').slice(0, 40)); }"""

AXE_RUN_JS = """async (tags) => {
  const els = [...document.querySelectorAll('[data-q1-root]')];
  if (!els.length) return { error: 'the scope matched nothing' };
  const r = await window.axe.run({ include: els }, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
  return { version: window.axe.version, violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help,
      nodes: v.nodes.length, targets: v.nodes.slice(0, 6).map(n => n.target.join(' ')),
      summary: (v.nodes[0] || {}).failureSummary })) };
}"""
WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"]


PROGRESS_RE = re.compile(r"^step (\d+) of (\d+)$", re.I)
FOCUS_WATCH_JS = """() => { window.__q1Focus = []; const t0 = performance.now();
    const tick = () => { const o = document.querySelector('[data-tour-offer]');
      const a = document.activeElement;
      window.__q1Focus.push({ t: Math.round(performance.now() - t0), offer: !!o,
                              inOffer: !!(o && a && o.contains(a)), active: a ? a.tagName : null });
      if (performance.now() - t0 < 20000) requestAnimationFrame(tick) };
    requestAnimationFrame(tick) }"""


def tour_card(dialog) -> tuple[str, int | None, int | None]:
    """(title, step, of) read from a tour card's own text. The progress line is CSS-uppercased, so
    the match is case-insensitive (the first walk read "STEP 1 OF 3" and failed a correct card)."""
    title = dialog.locator("h2").first.inner_text()
    for line in dialog.inner_text().splitlines():
        m = PROGRESS_RE.match(line.strip())
        if m:
            return title, int(m.group(1)), int(m.group(2))
    return title, None, None

def mark(pg, selectors: list[str]) -> int:
    return pg.evaluate(MARK_JS, selectors)


def shoot(pg, name: str) -> str | None:
    """An element screenshot of the marked surface (or the viewport), palette-quantised so the
    evidence stays small. Returns the file name."""
    if OUT is None:
        return None
    try:
        from PIL import Image
        roots = pg.locator("[data-q1-root]")
        if roots.count() == 1:
            # A surface taller than the viewport is clipped by the app's inner scroll container, so
            # grow the viewport to the surface for the shot only (then restore it). The layout
            # checks above all ran at the real viewport.
            vp = pg.viewport_size
            tall = roots.first.evaluate("e => Math.ceil(e.getBoundingClientRect().height)")
            if vp and tall + 200 > vp["height"]:
                pg.set_viewport_size({"width": vp["width"], "height": min(tall + 400, 4000)})
                pg.wait_for_timeout(300)
            try:
                png = roots.first.screenshot(timeout=8000)
            finally:
                if vp:
                    pg.set_viewport_size(vp)
        else:
            png = pg.screenshot(timeout=8000)
        im = Image.open(io.BytesIO(png)).convert("RGB")
        if im.width > 900:
            im = im.resize((900, int(im.height * 900 / im.width)))
        im = im.quantize(colors=64)
        dest = OUT / "shots" / f"{name.replace(' ', '-')}.png"
        dest.parent.mkdir(parents=True, exist_ok=True)
        im.save(dest, optimize=True)
        return dest.name
    except Exception as e:  # noqa: BLE001
        return f"(screenshot failed: {type(e).__name__}: {str(e)[:120]})"


def axe(pg) -> dict:
    if not pg.evaluate("() => typeof window.axe !== 'undefined'"):
        pg.add_script_tag(path=str(AXE_PATH))
    return pg.evaluate(AXE_RUN_JS, WCAG_TAGS)


def key_reach(pg, *, from_top: bool = True, cap: int = TAB_CAP) -> dict:
    """Real Tab presses until every enabled control in the marked surface has held focus."""
    n = pg.evaluate("""() => { const c = (""" + CONTROLS_JS + """)(); c.forEach((el, i) => el.setAttribute('data-q1-ctl', String(i)));
                              return c.length }""")
    labels = pg.evaluate("""() => [...document.querySelectorAll('[data-q1-ctl]')].map(el =>
        (el.getAttribute('aria-label') || el.innerText || el.tagName).trim().replace(/\\s+/g, ' ').slice(0, 40))""")
    if from_top:
        pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); window.scrollTo(0, 0) }")
    reached: dict[int, int] = {}
    trail = []
    presses = 0
    while presses < cap:
        presses += 1
        pg.keyboard.press("Tab")
        idx = pg.evaluate("() => { const el = document.activeElement; const c = el && el.closest && el.closest('[data-q1-ctl]');"
                          " return c ? Number(c.getAttribute('data-q1-ctl')) : -1 }")
        if len(trail) < 80:
            trail.append(pg.evaluate(FOCUS_DESC_JS))
        if idx >= 0 and idx not in reached:
            reached[idx] = presses
        if len(reached) == n:
            break
        # W14-keys: a roving group (role=toolbar; the checklist's steps, the offer's answers) is
        # ONE Tab stop -- its other items are reached with the Arrow key the group declares, each
        # press counted like a Tab. Walk a group once, the first time Tab lands in it.
        group = pg.evaluate("""() => { const el = document.activeElement;
            const g = el && el.closest && el.closest('[role=toolbar]');
            if (!g || !el.hasAttribute('data-roving-item') || g.hasAttribute('data-q1-walked')) return null;
            g.setAttribute('data-q1-walked', '');
            return { n: g.querySelectorAll('[data-roving-item]').length,
                     key: g.getAttribute('aria-orientation') === 'vertical' ? 'ArrowDown' : 'ArrowRight' } }""")
        if group:
            for _ in range(group["n"] - 1):
                pg.keyboard.press(group["key"])
                presses += 1
                idx = pg.evaluate("() => { const el = document.activeElement; const c = el && el.closest && el.closest('[data-q1-ctl]');"
                                  " return c ? Number(c.getAttribute('data-q1-ctl')) : -1 }")
                if len(trail) < 80:
                    trail.append(pg.evaluate(FOCUS_DESC_JS))
                if idx >= 0 and idx not in reached:
                    reached[idx] = presses
            if len(reached) == n:
                break
    pg.evaluate("() => document.querySelectorAll('[data-q1-ctl]').forEach(e => e.removeAttribute('data-q1-ctl'))")
    pg.evaluate("() => document.querySelectorAll('[data-q1-walked]').forEach(e => e.removeAttribute('data-q1-walked'))")
    missing = [labels[i] for i in range(n) if i not in reached]
    return {"controls": labels, "reached_at": {labels[i]: p for i, p in sorted(reached.items())},
            "missing": missing, "presses": presses, "trail": trail}


def surface_checks(pg, phase: str, width: int, surface: str, selectors: list[str], *,
                   keyboard: str = "top", shot: str | None = None) -> None:
    """The per-surface battery: screenshot, overflow, tap floor, stacking, keyboard, axe."""
    n = mark(pg, selectors)
    if n == 0:
        record(phase, width, surface, "surface found", False, selectors=selectors)
        return
    shot_name = shoot(pg, shot or f"{phase}-{surface}-{width}")
    ov = pg.evaluate(OVERFLOW_JS)
    record(phase, width, surface, "no horizontal overflow", not ov["horizontal"] and not ov["offenders"],
           screenshot=shot_name, **ov)
    if width <= TOUCH_MAX:
        tap = pg.evaluate(TAP_JS)
        record(phase, width, surface, "touch targets >= --tap-min", bool(tap["tapMin"]) and not tap["small"], **tap)
    st = pg.evaluate(STAGE_JS)
    record(phase, width, surface, "no stacked first-run surfaces", st["surfaces"] <= 1, **st)
    if keyboard != "none":
        kr = key_reach(pg, from_top=(keyboard == "top"))
        mark(pg, selectors)  # key_reach may have re-rendered nothing, but re-mark for axe
        record(phase, width, surface, "keyboard-only reach to every control", not kr["missing"] and bool(kr["controls"]),
               **kr)
    try:
        res = axe(pg)
        v = res.get("violations") or []
        record(phase, width, surface, "axe (wcag2a/aa, 21aa, 22aa, best-practice)",
               not res.get("error") and not v, axe_version=res.get("version"), error=res.get("error"),
               violation_ids=[f"{x['id']}({x['impact']})" for x in v], violations=v)
    except Exception as e:  # noqa: BLE001
        record(phase, width, surface, "axe (wcag2a/aa, 21aa, 22aa, best-practice)", False,
               error=f"{type(e).__name__}: {str(e)[:200]}")
    pg.evaluate("() => document.querySelectorAll('[data-q1-root]').forEach(e => e.removeAttribute('data-q1-root'))")


# ── accounts ──────────────────────────────────────────────────────────────────────────────

def signup(req, base: str, email: str, pw: str, name: str) -> None:
    """The sandbox rate-limits /api/auth/signup (3/min/IP, W14-0's measurement): a 429 waits
    and retries instead of falling through to a login for an account that was never made."""
    for attempt in range(8):
        r = req.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": name})
        if r.status in (200, 201):
            return
        if r.status == 429:
            time.sleep(21)
            continue
        r2 = req.post(base + "/api/auth/login", data={"email": email, "password": pw})
        if r2.status in (200, 201):
            return
        raise h.SetupFailed(f"could not sign up {email}: signup HTTP {r.status}, login HTTP {r2.status}")
    raise h.SetupFailed(f"signup for {email} stayed rate-limited")


def fresh_member(browser, admin_req, base: str, tag: str, width: int, height: int):
    """A brand-new paid-equivalent member in its own context: zero notes, zero preferences."""
    touch = width <= TOUCH_MAX
    ctx = browser.new_context(viewport={"width": width, "height": height}, has_touch=touch, is_mobile=touch,
                              reduced_motion="reduce")
    email = f"q1{tag}{int(time.time() * 1000) % 10_000_000}@local.dev"
    signup(ctx.request, base, email, "LocalTest2026!", f"q1{tag}")
    c = admin_req.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
    v = admin_req.post(base + "/api/auth/admin/verify-email", data={"email": email})
    me = ctx.request.get(base + "/api/auth/me").json()
    if not me.get("paid_equiv"):
        ctx.close()
        raise h.SetupFailed(f"{email} is not paid-equivalent (comp HTTP {c.status}, verify HTTP {v.status})")
    return ctx, email, me


def prefs_of(ctx, base: str) -> dict:
    r = ctx.request.get(base + "/api/auth/preferences")
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        return {}
    return body.get("preferences", body) if isinstance(body, dict) else {}


def open_notebook(pg, base: str) -> None:
    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    pg.get_by_role("heading", name="Welcome to your Notebook", level=2).first.wait_for(timeout=30000)


def first_run_root_selector() -> str:
    # ResearchHome's first-run block: the parent of the `data-tour="first-run"` button row.
    return "div:has(> [data-tour='first-run'])"


def wait_pref_post(pg, action, timeout=8000) -> bool:
    """Run `action` and wait for the preference write it should cause. Returns whether one was SEEN;
    never raises on a timeout -- the caller reads the stored value back, which is the real verdict."""
    try:
        with pg.expect_response(lambda r: "/api/auth/preferences" in r.url or "/api/j2/onboarding/tours/" in r.url,
                                timeout=timeout):
            action()
        return True
    except Exception:  # noqa: BLE001 -- PlaywrightTimeoutError; the read-back decides
        pg.wait_for_timeout(1000)
        return False


# ── the ON phase, one width ───────────────────────────────────────────────────────────────

def walk_on(browser, admin_req, base: str, width: int, height: int) -> None:
    P = "on"
    try:
        ctx, email, me = fresh_member(browser, admin_req, base, f"on{width}", width, height)
    except h.SetupFailed as e:
        record(P, width, "setup", "fresh paid member", False, error=str(e))
        return
    record(P, width, "setup", "fresh paid member", True, email=email,
           flags={k: me.get(k) for k in ("notebook_onboarding_enabled", "notebook_getting_started_enabled",
                                         "notebook_template_gallery_enabled")})
    pg = ctx.new_page()
    pg.bring_to_front()
    errors: list = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    try:
        _walk_on_page(pg, ctx, base, width)
    except Exception as e:  # noqa: BLE001 -- recorded as a failed check, the walk goes on
        record(P, width, "driver", "walk completed", False, error=f"{type(e).__name__}: {str(e)[:300]}",
               traceback=traceback.format_exc()[-1500:])
    record(P, width, "driver", "no uncaught page errors", not errors, errors=errors[:10])
    ctx.close()


def _walk_on_page(pg, ctx, base: str, width: int) -> None:
    P = "on"
    open_notebook(pg, base)

    # S1 -- the base tour auto-starts on the first-run screen
    dialog = pg.locator("[role=dialog][aria-modal=true]")
    try:
        dialog.first.wait_for(state="visible", timeout=10000)
        title, cur, total = tour_card(dialog.first)
        record(P, width, "S1 base tour", "auto-starts at step 1 on the first-run screen",
               title == BASE_STEP1_TITLE and cur == 1, title=title, step=cur, of=total)
    except Exception as e:  # noqa: BLE001
        record(P, width, "S1 base tour", "auto-starts at step 1 on the first-run screen", False, error=str(e)[:200])
    if dialog.count():
        # Inside a modal tour, keyboard reach is measured from where the tour put focus.
        surface_checks(pg, P, width, "S1 base tour", ["[role=dialog][aria-modal=true]"], keyboard="inside")
        wait_pref_post(pg, lambda: pg.keyboard.press("Escape"))
        dialog.first.wait_for(state="hidden", timeout=5000)
        record(P, width, "S1 base tour", "Escape dismisses it", True,
               notebook_tour=prefs_of(ctx, base).get("notebook_tour"))

    # S2 -- the first-run welcome with preview, promotion and checklist
    pg.wait_for_timeout(800)
    root = first_run_root_selector()
    preview = pg.get_by_role("heading", name="What your Notebook can do")
    checklist = pg.get_by_role("heading", name="Get started")
    try:
        preview.first.wait_for(timeout=10000)
        checklist.first.wait_for(timeout=10000)
        promo = pg.get_by_text("Want to try it first?").count() > 0
        sample_btn = pg.get_by_role("button", name=re.compile("Add a sample notebook"))
        described = sample_btn.first.get_attribute("aria-describedby") if sample_btn.count() else None
        points_at_promo = bool(described) and pg.locator(f"[id='{described}']").count() == 1
        record(P, width, "S2 first-run welcome", "preview, promotion and checklist all render",
               promo and points_at_promo, promotion=promo, sample_button_describedby=described,
               describedby_resolves=points_at_promo)
    except Exception as e:  # noqa: BLE001
        record(P, width, "S2 first-run welcome", "preview, promotion and checklist all render", False,
               error=str(e)[:200])
    st = pg.evaluate(STAGE_JS)
    record(P, width, "S2 first-run welcome", "the offer waits while the checklist is open", st["offers"] == 0, **st)
    surface_checks(pg, P, width, "S2 first-run welcome", [root])

    # S3 -- hide the checklist; the offer may now show. It must never take focus.
    hide = pg.get_by_role("button", name="Hide the get started list")
    pg.evaluate(FOCUS_WATCH_JS)
    seen_write = wait_pref_post(pg, lambda: hide.first.click())
    gs = None
    for _ in range(25):  # the write can land after the wire wait gave up (seen on the cold first width)
        gs = prefs_of(ctx, base).get("notebook_getting_started")
        if '"dismissed"' in (gs or ""):
            break
        pg.wait_for_timeout(400)
    record(P, width, "S3 offer", "Hide records the checklist closed", '"dismissed"' in (gs or ""),
           notebook_getting_started=gs, write_seen_on_the_wire=seen_write)
    offer = pg.locator("[data-tour-offer]")
    pg.wait_for_timeout(1500)
    st = pg.evaluate(STAGE_JS)
    if st["slotOthers"] and not st["offers"]:
        # The "Meet Compass" card shows without claiming the stage and holds the slot; the offer
        # waits behind it (W14-C2 1.4). A member closes it with "Got it" -- so does the walk.
        record(P, width, "S3 offer", "the offer waits while another first-run card holds the slot", True, **st)
        pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=5000)
    try:
        offer.first.wait_for(state="visible", timeout=10000)
        pg.wait_for_timeout(1500)
        samples = pg.evaluate("() => window.__q1Focus || []")
        seen = [x for x in samples if x["offer"]]
        stolen = [x for x in samples if x["inOffer"]]
        offered = offer.first.locator("h2").inner_text()
        REPORT.setdefault("offered", {})[str(width)] = offered
        record(P, width, "S3 offer", "the offer appears once the checklist and the Compass card are gone", True,
               title=offered)
        record(P, width, "S3 offer", "the offer never takes focus", bool(seen) and not stolen,
               frames_with_offer=len(seen), frames_focus_in_offer=len(stolen),
               active_after=pg.evaluate(FOCUS_DESC_JS))
        surface_checks(pg, P, width, "S3 offer", ["[data-tour-offer]"])
        # decline with the keyboard: focus "Not now" (key_reach proved Tab gets there), Enter
        later = offer.first.get_by_role("button", name="Not now")
        later.focus()
        wait_pref_post(pg, lambda: pg.keyboard.press("Enter"))
        offer.first.wait_for(state="hidden", timeout=5000)
        tours = json.loads(prefs_of(ctx, base).get("notebook_tours") or "{}")
        declined = [k for k, v in tours.items() if isinstance(v, dict) and v.get("state") == "dismissed"
                    and v.get("step") is None]
        record(P, width, "S3 offer", "Not now hides it and records dismissed, step null", len(declined) == 1,
               notebook_tours=tours)
        pg.reload(wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        pg.get_by_role("heading", name="Welcome to your Notebook", level=2).first.wait_for(timeout=30000)
        pg.wait_for_timeout(2000)
        record(P, width, "S3 offer", "no second offer in the same session (reload)", offer.count() == 0)
    except Exception as e:  # noqa: BLE001
        record(P, width, "S3 offer", "the offer appears once the checklist and the Compass card are gone", False,
               error=str(e)[:300], stage=pg.evaluate(STAGE_JS))

    # S4 -- Help > What's new and Walkthroughs
    pg.goto(base + "/support", wait_until="domcontentloaded", timeout=60000)
    replay = pg.get_by_role("link", name="Replay", exact=True)
    starts: list[str] = []
    try:
        replay.first.wait_for(timeout=15000)
        rows = pg.locator("li", has=pg.get_by_role("link", name="Replay", exact=True)).all_inner_texts()
        record(P, width, "S4 Help", "Walkthroughs lists the base tour and every armed capability's tour",
               len(rows) == 1 + len(CAPABILITY_FLAGS) and any(BASE_TOUR_TITLE in r for r in rows), rows=rows)
        wn = pg.locator("section[aria-labelledby='support-whats-new']")
        wn.first.wait_for(timeout=10000)
        starts = [a.get_attribute("aria-label") for a in wn.first.get_by_role("link").all()]
        offered = REPORT.get("offered", {}).get(str(width), "")
        names = [t.removeprefix("Start the ").removesuffix(" tour") for t in starts if t]
        record(P, width, "S4 Help", "What's new lists every armed tour not taken, the declined one included",
               len(starts) == len(CAPABILITY_FLAGS) and any(offered.endswith(n) for n in names),
               starts=starts, offered=offered)
        pg.wait_for_timeout(500)
        # What's new (a labelled section) and the Walkthroughs list (its <ul>; every row links into
        # the Notebook). Both plain CSS so the JS probes can use them.
        surface_checks(pg, P, width, "S4 Help",
                       ["section[aria-labelledby='support-whats-new']", "ul:has(> li > a[href*='notebook'])"])
    except Exception as e:  # noqa: BLE001
        record(P, width, "S4 Help", "Walkthroughs and What's new render", False, error=str(e)[:300])

    # S5 -- Replay the base tour from Help, from a COLD page (no pre-warm: W14-0 pre-warmed)
    cold = ctx.new_page()
    cold.bring_to_front()
    try:
        cold.goto(base + "/support", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(cold)
        row = cold.locator("li", has_text=BASE_TOUR_TITLE).filter(has=cold.get_by_role("link", name="Replay"))
        row.first.get_by_role("link", name="Replay").click()
        d = cold.locator("[role=dialog][aria-modal=true]")
        d.first.wait_for(state="visible", timeout=15000)
        title, cur, total = tour_card(d.first)
        record(P, width, "S5 replay", "Replay on a cold page opens the base tour at step one",
               title == BASE_STEP1_TITLE and cur == 1, title=title, step=cur, of=total,
               screenshot=shoot(cold, f"{P}-S5-replay-{width}"))
        cold.keyboard.press("Escape")
    except Exception as e:  # noqa: BLE001
        record(P, width, "S5 replay", "Replay on a cold page opens the base tour at step one", False, error=str(e)[:300])
    finally:
        cold.close()

    # S6 -- What's new > Start for each listed tour: does a tour actually open? (Accepting an offer
    # takes the SAME door, `openRegistryTour`, from the first-run screen -- see the clicks tool.)
    pg.bring_to_front()
    for label in starts:
        pg.goto(base + "/support", wait_until="domcontentloaded", timeout=60000)
        try:
            link = pg.get_by_role("link", name=label)
            link.first.wait_for(timeout=15000)
            link.first.click()
            d = pg.locator("[role=dialog][aria-modal=true]")
            try:
                d.first.wait_for(state="visible", timeout=15000)
                title, cur, total = tour_card(d.first)
                record(P, width, "S6 What's new Start", f"{label}: a tour opens", True, title=title, step=cur,
                       of=total, url=pg.url)
                pg.keyboard.press("Escape")
            except Exception:  # noqa: BLE001
                record(P, width, "S6 What's new Start", f"{label}: a tour opens", False, url=pg.url,
                       stage=pg.evaluate(STAGE_JS), screenshot=shoot(pg, f"{P}-S6-noopen-{width}"),
                       notebook_tours=prefs_of(ctx, base).get("notebook_tours"))
        except Exception as e:  # noqa: BLE001
            record(P, width, "S6 What's new Start", f"{label}: a tour opens", False, error=str(e)[:300])


# ── the OFF control, one width ────────────────────────────────────────────────────────────

def walk_off(browser, admin_req, base: str, width: int, height: int) -> None:
    P = "off"
    try:
        ctx, email, me = fresh_member(browser, admin_req, base, f"off{width}", width, height)
    except h.SetupFailed as e:
        record(P, width, "setup", "fresh paid member", False, error=str(e))
        return
    record(P, width, "setup", "fresh paid member, onboarding gates OFF",
           me.get("notebook_onboarding_enabled") is False and me.get("notebook_getting_started_enabled") is False,
           email=email, flags={k: me.get(k) for k in ("notebook_onboarding_enabled", "notebook_getting_started_enabled",
                                                     "notebook_template_gallery_enabled")})
    pg = ctx.new_page()
    pg.bring_to_front()
    try:
        open_notebook(pg, base)
        pg.wait_for_timeout(2500)  # past AUTO_START_DELAY_MS and the offer gate's decision
        shape = pg.evaluate("""() => {
          const row = document.querySelector("[data-tour='first-run']");
          const root = row && row.parentElement;
          return { children: root ? [...root.children].map(e => e.tagName) : null,
                   buttons: row ? [...row.querySelectorAll('button')].map(b => b.innerText.trim()) : null,
                   text: root ? root.innerText.slice(0, 600) : null } }""")
        st = pg.evaluate(STAGE_JS)
        btns = shape["buttons"] or []
        base_ok = btns[:3] == PRE_W14_BUTTONS and all(b in PRE_W14_BUTTONS + PRE_W14_OPTIONAL for b in btns)
        record(P, width, "control", "first-run screen is the pre-wave-14 shape",
               shape["children"] == ["H2", "P", "DIV"] and base_ok, **shape)
        record(P, width, "control", "no preview, no checklist, no sample or tour door",
               pg.get_by_role("heading", name="What your Notebook can do").count() == 0
               and pg.get_by_role("heading", name="Get started").count() == 0
               and pg.get_by_role("button", name=re.compile("Add a sample notebook|Take the tour")).count() == 0)
        record(P, width, "control", "no tour dialog", not st["tourDialogs"], **st)
        # INFO, not a check: the offer is gated by the tour's OWN capability flag (W14-C2 1.1),
        # not by the onboarding gate, so with the capability armed it may show here.
        try:  # the Compass card holds the slot first; close it so the offer's own gating is what shows
            pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=4000)
            pg.wait_for_timeout(3000)
        except Exception:  # noqa: BLE001
            pass
        st2 = pg.evaluate(STAGE_JS)
        record(P, width, "control", "offer card with onboarding off (capability armed)", None,
               offers=st2["offers"], title=(pg.locator("[data-tour-offer] h2").first.inner_text()
                                            if st2["offers"] else None))
        mark(pg, [first_run_root_selector()])
        record(P, width, "control", "screenshot", None, screenshot=shoot(pg, f"off-first-run-{width}"))
    except Exception as e:  # noqa: BLE001
        record(P, width, "control", "walk completed", False, error=f"{type(e).__name__}: {str(e)[:300]}")
    ctx.close()


# ── phases ────────────────────────────────────────────────────────────────────────────────

def run_phase(phase: str, data_root: Path, port: int) -> str | None:
    data_dir = data_root / phase
    if data_dir.exists() and any(data_dir.iterdir()):
        return f"{data_dir} is not empty"
    data_dir.mkdir(parents=True, exist_ok=True)
    for name in ONBOARDING_FLAGS + CAPABILITY_FLAGS:
        os.environ.pop(name, None)
    if phase == "on":
        os.environ.update({name: "1" for name in ONBOARDING_FLAGS + CAPABILITY_FLAGS})
    else:
        os.environ.update({name: "1" for name in CAPABILITY_FLAGS})
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    base = f"http://127.0.0.1:{port}"
    box = h.Sandbox(str(data_dir), port, OUT / f"sandbox-{phase}.log")
    box.start()
    not_run = None
    try:
        if not box.wait_healthy(base, 300):
            not_run = "the sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch()
                admin = browser.new_context()
                try:
                    h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
                    for w, ht in WIDTHS:
                        (walk_on if phase == "on" else walk_off)(browser, admin.request, base, w, ht)
                finally:
                    admin.close()
                    browser.close()
    finally:
        how = box.stop()
    REPORT.setdefault("phases", {})[phase] = {"base": base, "stop_how": how, "not_run": not_run,
                                              "armed": [n for n in ONBOARDING_FLAGS + CAPABILITY_FLAGS
                                                        if os.environ.get(n) == "1"]}
    _flush()
    return not_run


def main(argv=None) -> int:
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-root", required=True)
    ap.add_argument("--port", type=int, default=8715)
    ap.add_argument("--out", required=True)
    ap.add_argument("--phases", default="on,off")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_root)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port not in PORTS:
        print("REFUSED: this lane uses ports 8715-8719 only (never 8077)")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this tool never kills it")
        return 3
    OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    REPORT.update({"tool": "tools/notebook_w14_onboarding_walk.py", "tree": sha,
                   "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "widths": WIDTHS, "status": "INCOMPLETE (run did not finish)"})
    _flush()
    not_run = []
    for phase in [p.strip() for p in args.phases.split(",") if p.strip()]:
        nr = run_phase(phase, Path(args.data_root), args.port)
        if nr:
            not_run.append(f"{phase}: {nr}")
    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    REPORT.update({"finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "driver_imported_api": api_mods, "not_run": not_run,
                   "status": "COMPLETE" if not not_run else "NOT COMPLETE"})
    _flush()
    print(f"raw log written: {OUT / 'walk.json'}")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    failed = [f"[{c['phase']} {c['width']}] {c['surface']}: {c['check']}" for c in CHECKS if c["verdict"] == "FAIL"]
    if failed:
        print(f"VERDICT: FAIL -- {len(failed)} of {len(CHECKS)} checks failed:\n  " + "\n  ".join(failed))
        return 1
    print(f"VERDICT: PASS -- {len(CHECKS)} checks")
    return 0


if __name__ == "__main__":
    sys.exit(main())
