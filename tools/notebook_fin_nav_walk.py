"""Finish program, lane NAV -- the real-browser check for two keyboard and reach fixes.

  A. The active setups board's door on Research Home ("Active setups", shown only while
     NOTEBOOK_SETUPS_BOARD_ENABLED is on).
  B. The Screener's "Skip to save results" link (ruling P5 / proposal Q7): the keys it takes to
     reach and press "Save these results to Notebook".

It OWNS its sandbox (tools/notebook_perf_harness.py's `Sandbox`: scripts/hub_sandbox_boot.py
through the SIGBREAK shim, stopped gracefully so the launcher writes its SHUTDOWN checkpoint),
and boots it TWICE on the same port and data dir, one after the other:

  boot OFF  the setups-board flag unset. The door must be absent at 1200 and 390 px. The
            Screener keys are counted here too (the skip link has no flag).
  boot ON   NOTEBOOK_SETUPS_BOARD_ENABLED=1. The door must be visible at both widths, meet the
            44 px floor at 390, and a click / tap must land on /journal/notebook/setups.

A flag is read by the server per request and rides /api/auth/me, so each boot's first row is
what that payload actually said. The driver never imports `api.*`. It writes RAW evidence
(walk.json, screenshots, the integrity logs) and one verdict line.

Run from PowerShell (a Windows path through the Bash tool can lose its backslash):

    python tools/notebook_fin_nav_walk.py --data-dir 'C:/data-fin-nav' --port 8131 `
        --out 'docs/notebook/evidence/fin-nav'

Preconditions: app/dist rebuilt from this tree (`npm run build` in app/); the port free
(refused, never killed); the data dir outside the shared root (refused).

Exit: 0 = every row PASS and integrity CLEAN on both boots; 1 = a row FAILED; 2 = integrity
not CLEAN; 3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402  -- imports no api.* (asserted at the end)

MEMBER = ("finnav@local.dev", "LocalTest2026!", "finnav")
BOARD_FLAG = "notebook_setups_board_enabled"
BOARD_ENV = "NOTEBOOK_SETUPS_BOARD_ENABLED"
BOARD_PATH = "/journal/notebook/setups"
DOOR_NAME = "Active setups"
SAVE_NAME = "Save these results to Notebook"
SKIP_NAME = "Skip to save results"
KEY_BUDGET = 10          # WAVE-13-PLAN section 6, Q7, keyboard
TAP_FLOOR = 44
WIDTHS = {1200: {"width": 1200, "height": 900}, 390: {"width": 390, "height": 844}}

ACTIVE_JS = """() => {
  const el = document.activeElement
  if (!el) return null
  const r = el.getBoundingClientRect()
  const cs = getComputedStyle(el)
  return {
    tag: el.tagName.toLowerCase(), id: el.id || null,
    name: (el.getAttribute('aria-label') || el.innerText || el.textContent || '').trim().slice(0, 80),
    saveAnchor: el.hasAttribute('data-screener-save-anchor'),
    disabled: !!el.disabled,
    rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
    opacity: cs.opacity, pointerEvents: cs.pointerEvents,
    inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
  }
}"""

SKIP_UNFOCUSED_JS = """(name) => {
  const a = Array.from(document.querySelectorAll('a')).find((x) => (x.textContent || '').trim() === name)
  if (!a) return null
  const r = a.getBoundingClientRect()
  const cs = getComputedStyle(a)
  const hits = []
  for (const [x, y] of [[20, 12], [60, 26], [120, 30], [innerWidth / 2, 20], [innerWidth / 2, 70]]) {
    const el = document.elementFromPoint(x, y)
    hits.push(!!el && (el === a || a.contains(el)))
  }
  return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)],
           bottom: Math.round(r.bottom), opacity: cs.opacity, pointerEvents: cs.pointerEvents,
           hitAtAnyProbe: hits.some(Boolean), inSlot: !!a.closest('[data-skip-link-slot]') }
}"""


class Walk:
    def __init__(self, out: Path):
        self.out = out
        self.rows: list[dict] = []
        self.raw: dict = {}

    def record(self, rid, ok, detail):
        self.rows.append({"id": rid, "verdict": "PASS" if ok else "FAIL", "detail": detail})
        print(f"  {rid}: {'PASS' if ok else 'FAIL'} -- {detail}", flush=True)

    def shot(self, pg, name, full=False):
        p = self.out / f"{name}.png"
        pg.screenshot(path=str(p), full_page=full)
        return p.name


def _open(pg, base, path):
    pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
    pg.bring_to_front()
    h._dismiss_intro(pg)
    try:
        pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=2000)
    except Exception:  # noqa: BLE001 -- the hint did not show in this tab
        pass


def _to_top(pg):
    pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur();"
                " window.scrollTo(0, 0) }")


def _inbox_count(req, base):
    r = req.get(base + "/api/j2/inbox")
    if r.status != 200:
        return None
    b = r.json()
    items = b if isinstance(b, list) else (b.get("items") or b.get("captures") or [])
    return len(items)


def _toast(pg) -> str:
    try:
        return pg.evaluate("() => Array.from(document.querySelectorAll('span[role=status][data-empty=false]'))"
                           ".map(e => e.innerText.trim()).filter(Boolean).join(' | ')")[:300]
    except Exception:  # noqa: BLE001
        return ""


SLOT_LINKS_JS = """() => ({
  slot: Array.from(document.querySelectorAll('[data-skip-link-slot] a')).map((a) => (a.textContent || '').trim()),
  all: Array.from(document.querySelectorAll('a')).map((a) => (a.textContent || '').trim()).filter((t) => /^Skip to /.test(t)),
})"""


def notebook_skip_links(w: Walk, pg, tag: str) -> None:
    """Item C: the onboarding flows (O2/O3/O5/O6, docs/notebook/wave14-keys.md) run on the
    Notebook and count from the shell's skip-link slot. The Screener's new link must not be in
    that slot there, or every one of those counts would move by one Tab."""
    links = pg.evaluate(SLOT_LINKS_JS)
    w.raw[f"C_{tag}"] = links
    w.record(f"C_{tag}_notebook_skip_links_unchanged",
             SKIP_NAME not in links["slot"] and SKIP_NAME not in links["all"] and len(links["all"]) >= 1,
             f"skip links on /journal/notebook: slot {links['slot']}; all {links['all']} "
             f"({SKIP_NAME!r} is not among them)")


def _home_ready(pg):
    """Research Home has painted one of its member states (never the loading skeleton)."""
    pg.get_by_text("Nothing needs your attention right now.").or_(
        pg.get_by_role("heading", name="Continue working")).first.wait_for(state="visible", timeout=60000)


# ── B: the Screener keys ────────────────────────────────────────────────────────────────

def _door_ready(pg):
    door = pg.get_by_role("button", name=SAVE_NAME, exact=True).filter(visible=True)
    door.first.wait_for(state="visible", timeout=60000)
    end = time.time() + 60
    while time.time() < end and door.first.is_disabled():
        pg.wait_for_timeout(400)
    return door.first


def screener_keys(w: Walk, ctx, base: str, width: int) -> None:
    tag = f"B_screener_{width}"
    raw = w.raw.setdefault(tag, {})
    req = ctx.request
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    try:
        # 1. the walk WITHOUT the skip link: what the door cost before (and still costs a
        #    member who tabs past the link). "Skip to main content", Enter, then Tab.
        _open(pg, base, "/screener")
        door = _door_ready(pg)
        raw["door_disabled_at_start"] = door.is_disabled()
        pg.wait_for_timeout(600)
        _to_top(pg)
        raw["skip_link_unfocused"] = pg.evaluate(SKIP_UNFOCUSED_JS, SKIP_NAME)
        pg.keyboard.press("Tab")
        first = pg.evaluate(ACTIVE_JS)
        pg.keyboard.press("Enter")
        tabs, cap = 0, 700
        while tabs < cap:
            pg.keyboard.press("Tab")
            tabs += 1
            a = pg.evaluate(ACTIVE_JS)
            if a and a["tag"] == "button" and a["name"] == SAVE_NAME:
                break
        reached = tabs < cap
        raw["without_skip_link"] = {"first_stop": first, "tabs_after_skip_to_main": tabs, "reached": reached,
                                    "keys_total": (2 + tabs + 1) if reached else None, "cap": cap}
        w.record(f"{tag}_control_without_the_link_is_over_budget",
                 reached and (2 + tabs + 1) > KEY_BUDGET,
                 f"Tab, Enter (Skip to main content), {tabs} Tabs, Enter = {2 + tabs + 1} keys "
                 f"(budget {KEY_BUDGET})" if reached else f"cap {cap} reached, door never focused")

        s = raw["skip_link_unfocused"]
        ok_unfocused = bool(s) and s["opacity"] == "0" and s["pointerEvents"] == "none" \
            and s["bottom"] <= 0 and not s["hitAtAnyProbe"] and s["inSlot"]
        w.record(f"{tag}_unfocused_link_cannot_take_a_tap", ok_unfocused,
                 f"unfocused: {s}")

        # 2. the walk WITH the skip link, from a fresh load, counted key by key.
        _open(pg, base, "/screener")
        door = _door_ready(pg)
        if door.is_disabled():
            w.record(f"{tag}_keys", False, "INCONCLUSIVE: the door stayed disabled (no result set in this sandbox)")
            return
        pg.wait_for_timeout(600)
        _to_top(pg)
        inbox_before = _inbox_count(req, base)
        notes_before = {n["id"]: n.get("updatedAt") for n in (req.get(base + "/api/j2/notes?limit=500").json().get("notes") or [])}
        trail = []
        pg.keyboard.press("Tab"); trail.append({"key": "Tab", "focus": pg.evaluate(ACTIVE_JS)})
        pg.keyboard.press("Tab")
        # A waiter, never a sample: the link is shown by :focus-visible, and reading its style in
        # the same instant as the key press caught it before the first painted frame (the first
        # run of this tool read opacity 0 while its own screenshot, taken next, showed the link).
        try:
            pg.wait_for_function(
                "(name) => { const el = document.activeElement; if (!el) return false;"
                " const r = el.getBoundingClientRect();"
                " return (el.textContent || '').trim() === name && getComputedStyle(el).opacity === '1' && r.top >= 0 }",
                arg=SKIP_NAME, timeout=3000)
        except Exception:  # noqa: BLE001 -- recorded below as whatever the focus really is
            pass
        trail.append({"key": "Tab", "focus": pg.evaluate(ACTIVE_JS)})
        w.shot(pg, f"B-skip-link-focused-{width}")
        pg.keyboard.press("Enter"); trail.append({"key": "Enter", "focus": pg.evaluate(ACTIVE_JS)})
        pg.keyboard.press("Tab"); trail.append({"key": "Tab", "focus": pg.evaluate(ACTIVE_JS)})
        w.shot(pg, f"B-door-focused-{width}")
        pg.keyboard.press("Enter"); trail.append({"key": "Enter", "focus": pg.evaluate(ACTIVE_JS)})
        keys = len(trail)
        msg, changed, inbox_after = "", [], inbox_before
        end = time.time() + 20
        while time.time() < end:
            msg = _toast(pg) or msg
            inbox_after = _inbox_count(req, base)
            after = {n["id"]: n.get("updatedAt") for n in (req.get(base + "/api/j2/notes?limit=500").json().get("notes") or [])}
            changed = [i for i, u in after.items() if notes_before.get(i) != u]
            if changed or (inbox_before is not None and inbox_after is not None and inbox_after > inbox_before):
                break
            pg.wait_for_timeout(500)
        raw["with_skip_link"] = {"trail": trail, "keys": keys, "toast": msg, "notes_changed": changed,
                                 "inbox": [inbox_before, inbox_after]}
        f = [t["focus"] or {} for t in trail]
        path_ok = (f[0].get("name") == "Skip to main content"
                   and f[1].get("name") == SKIP_NAME and f[1].get("tag") == "a"
                   and f[1].get("opacity") == "1" and f[1].get("inViewport") is True
                   and f[2].get("saveAnchor") is True
                   and f[3].get("tag") == "button" and f[3].get("name") == SAVE_NAME)
        landed = bool(changed) or (inbox_before is not None and inbox_after is not None and inbox_after > inbox_before)
        w.record(f"{tag}_keys_within_budget", path_ok and landed and keys <= KEY_BUDGET,
                 f"{keys} keys (Tab, Tab, Enter, Tab, Enter; budget {KEY_BUDGET}); stops: "
                 f"{[x.get('name') for x in f]}; focused link visible={f[1].get('inViewport')} "
                 f"opacity={f[1].get('opacity')}; saved: toast {msg!r}, inbox {inbox_before}->{inbox_after}, "
                 f"notes changed {len(changed)}")
        w.record(f"{tag}_no_page_errors", not errors, "none" if not errors else f"{errors[:3]}")
    finally:
        pg.close()


# ── A: the door on Research Home ────────────────────────────────────────────────────────

def door_absent(w: Walk, ctx, base: str, width: int) -> None:
    tag = f"A_door_off_{width}"
    pg = ctx.new_page()
    try:
        _open(pg, base, "/journal/notebook")
        _home_ready(pg)
        pg.wait_for_timeout(800)
        by_role = pg.get_by_role("link", name=DOOR_NAME, exact=True).count()
        by_href = pg.locator(f'a[href="{BOARD_PATH}"]').count()
        today = pg.get_by_role("button", name="Today", exact=True).filter(visible=True).count()
        w.raw[tag] = {"links_by_name": by_role, "links_by_href": by_href, "today_buttons_visible": today}
        w.shot(pg, f"A-home-flag-off-{width}")
        notebook_skip_links(w, pg, f"off_{width}")
        w.record(tag, by_role == 0 and by_href == 0 and today >= 1,
                 f"flag off: {by_role} link(s) named {DOOR_NAME!r}, {by_href} link(s) to {BOARD_PATH}; "
                 f"control: {today} visible Today button(s) on the same screen")
    finally:
        pg.close()


def door_present(w: Walk, ctx, base: str, width: int, touch: bool) -> None:
    tag = f"A_door_on_{width}"
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:300]))
    try:
        _open(pg, base, "/journal/notebook")
        _home_ready(pg)
        link = pg.get_by_role("link", name=DOOR_NAME, exact=True)
        link.first.wait_for(state="visible", timeout=30000)
        n = link.count()
        link.first.scroll_into_view_if_needed()
        box = link.first.bounding_box()
        overflow = pg.evaluate("() => document.documentElement.scrollWidth - document.documentElement.clientWidth")
        href = link.first.get_attribute("href")
        link.first.focus()
        focusable = pg.evaluate("(name) => (document.activeElement.textContent || '').trim() === name", DOOR_NAME)
        w.shot(pg, f"A-home-flag-on-{width}")
        notebook_skip_links(w, pg, f"on_{width}")
        w.raw[tag] = {"count": n, "box": box, "href": href, "h_overflow_px": overflow, "focusable": focusable}
        size_ok = box is not None and (box["height"] >= TAP_FLOOR - 0.5 and box["width"] >= TAP_FLOOR - 0.5
                                       if width <= 1024 else box["height"] > 0)
        w.record(f"{tag}_visible", n == 1 and href == BOARD_PATH and size_ok and focusable and overflow <= 1,
                 f"{n} link, href {href}, box {round(box['width'])}x{round(box['height'])} px"
                 f"{' (44 px floor applies)' if width <= 1024 else ''}, keyboard-focusable {focusable}, "
                 f"sideways overflow {overflow} px")
        if touch:
            link.first.tap()
        else:
            link.first.click()
        pg.wait_for_url(f"**{BOARD_PATH}", timeout=30000)
        pg.get_by_role("heading", name="Active setups").first.wait_for(state="visible", timeout=60000)
        page_marker = pg.locator("[data-setups-page]").count()
        w.shot(pg, f"A-board-after-{'tap' if touch else 'click'}-{width}")
        w.raw[tag]["landed"] = {"url": pg.url, "setups_page_marker": page_marker}
        w.record(f"{tag}_navigates", pg.url.endswith(BOARD_PATH) and page_marker == 1,
                 f"{'tap' if touch else 'click'} -> {pg.url}; the board page mounted ({page_marker} [data-setups-page])")
        w.record(f"{tag}_no_page_errors", not errors, "none" if not errors else f"{errors[:3]}")
    finally:
        pg.close()


# ── the two boots ───────────────────────────────────────────────────────────────────────

def run_phase(phase: str, base: str, w: Walk) -> None:
    from playwright.sync_api import sync_playwright

    with sync_playwright() as pw:
        br = pw.chromium.launch()
        try:
            admin_ctx = br.new_context()
            setup_ctx = br.new_context()
            h._provision(admin_ctx.request, setup_ctx.request, base, member=MEMBER)
            state = setup_ctx.storage_state()
            me = setup_ctx.request.get(base + "/api/auth/me").json()
            w.raw[f"{phase}_auth_me"] = {BOARD_FLAG: me.get(BOARD_FLAG), "paid_equiv": me.get("paid_equiv"),
                                         "role": me.get("role")}
            want = phase == "on"
            w.record(f"{phase.upper()}_0_flag_on_the_auth_payload", (me.get(BOARD_FLAG) is True) == want
                     and me.get("paid_equiv"),
                     f"/api/auth/me {BOARD_FLAG}={me.get(BOARD_FLAG)!r} (wanted {'True' if want else 'not True'}), "
                     f"paid_equiv={me.get('paid_equiv')!r}")
            # A member with a note: Research Home's non-first-run states are where the door lives.
            notes = setup_ctx.request.get(base + "/api/j2/notes?limit=5").json().get("notes") or []
            if not notes:
                r = setup_ctx.request.post(base + "/api/j2/notes", data={
                    "title": "fin-nav walk note",
                    "bodyJson": {"type": "doc", "content": [{"type": "paragraph", "content": [
                        {"type": "text", "text": "A note so Research Home is not the first-run screen."}]}]}})
                if r.status not in (200, 201):
                    raise h.SetupFailed(f"seeding the walk note failed: HTTP {r.status}")
            for width, viewport in WIDTHS.items():
                touch = width == 390
                ctx = br.new_context(viewport=viewport, reduced_motion="reduce", storage_state=state,
                                     has_touch=touch)
                try:
                    if phase == "off":
                        door_absent(w, ctx, base, width)
                        screener_keys(w, ctx, base, width)
                    else:
                        door_present(w, ctx, base, width, touch)
                finally:
                    ctx.close()
        finally:
            br.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8131)
    ap.add_argument("--out", required=True)
    ap.add_argument("--sha", default="")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if args.port != 8131:
        print("REFUSED: this lane's walk uses port 8131 only")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this walk never kills it")
        return 3
    data_dir = Path(args.data_dir)
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    w = Walk(out)
    base = f"http://127.0.0.1:{args.port}"

    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)

    boots, failure, not_run = {}, None, None
    for phase in ("off", "on"):
        # Written for the sandboxed server (Popen inherits it): the gate's one parse lives in
        # the app. OFF is the variable ABSENT, which is what production has today.
        if phase == "on":
            os.environ.update({BOARD_ENV: "1"})   # a write for the child, never a read: the one parse is the app's
        else:
            os.environ.pop(BOARD_ENV, None)
        print(f"== boot {phase.upper()} ({BOARD_ENV}={'1' if phase == 'on' else 'unset'}) ==", flush=True)
        if h.port_busy(args.port):
            failure = f"port {args.port} still had a listener before boot {phase}"
            break
        box = h.Sandbox(str(data_dir), args.port, out / f"sandbox-{phase}.log")
        box.start()
        try:
            if not box.wait_healthy(base, 300):
                failure = f"boot {phase}: the sandbox never answered /api/health"
            else:
                try:
                    run_phase(phase, base, w)
                except h.SetupFailed as e:
                    not_run = f"boot {phase}: {str(e)[:300]}"
                except Exception as e:  # noqa: BLE001 -- recorded; the sandbox is still stopped
                    import traceback
                    failure = f"boot {phase}: the walk raised {type(e).__name__}: {str(e)[:400]}"
                    w.raw[f"{phase}_traceback"] = traceback.format_exc()[-3000:]
                box.wait_checkpoint(h.POST_BOOT, 60)
        finally:
            box.stop()
        integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
        h._keep_integrity_log(integ, out / f"integrity-{phase}.md", own=True)
        print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run), flush=True)
        released = False
        for _ in range(40):
            if not h.port_busy(args.port):
                released = True
                break
            time.sleep(0.5)
        boots[phase] = {"integrity": integ, "stop": box.stop_how, "port_released": released}
        w.record(f"{phase.upper()}_9_sandbox_stopped_and_port_released",
                 released and integ.get("clean") is True,
                 f"stop: {box.stop_how}; port {args.port} listener after stop: {not released}; "
                 f"integrity {integ.get('status')}")
        if failure or not_run:
            break

    api_mods = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    w.record("Z_driver_never_imported_api", not api_mods,
             "no api.* module in the driver's sys.modules" if not api_mods else f"imported: {api_mods[:5]}")
    result = {"tool": "tools/notebook_fin_nav_walk.py", "sha": args.sha, "base": base,
              "data_dir": str(data_dir), "boots": boots, "failure": failure, "not_run": not_run,
              "rows": w.rows, "raw": w.raw}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    if any(r["verdict"] != "PASS" for r in w.rows):
        print("VERDICT: FAIL -- " + ", ".join(r["id"] for r in w.rows if r["verdict"] != "PASS"))
        return 1
    if not all(b["integrity"].get("clean") for b in boots.values()):
        print("VERDICT: INTEGRITY NOT CLEAN")
        return 2
    print(f"VERDICT: PASS -- {len(w.rows)} rows")
    return 0


if __name__ == "__main__":
    sys.exit(main())
