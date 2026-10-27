"""Shared helpers for the 11.20 hand-driven walk (session-local, scratchpad only)."""
import json, os, re, sys, time, contextlib
from pathlib import Path

IMPL = Path(r"C:\Users\Patrick\uct-worktrees\nbw-p2-impl")
SCR = Path(r"C:\Users\Patrick\AppData\Local\Temp\claude\C--Users-Patrick\5effcdc4-7e7d-42f4-a3df-67b99c63791b\scratchpad")
SBX = SCR / "sbx"
WALK = Path(os.environ.get("WALK_DATA", str(SBX / "walk")))
sys.path[:0] = [str(IMPL / "tools" / "notebook_campaign"), str(IMPL / "tools"), str(IMPL / "scripts")]
import run_campaign as rc  # noqa: E402
h, fw, walk, sid = rc.load_walk_libs(IMPL)
AXE_SRC = (IMPL / "app" / "node_modules" / "axe-core" / "axe.min.js").read_text(encoding="utf-8")
SIZES = {"1200": (1200, 900), "820": (820, 1180), "390": (390, 844)}
BENIGN = tuple(fw.BENIGN) + rc.EXTRA_BENIGN
T = 30000


def manifest():
    return json.loads((WALK / "campaign-manifest.json").read_text(encoding="utf-8"))


def session_of(pid, clock=False):
    if clock:
        cs = json.loads((WALK / "clock-sessions.json").read_text(encoding="utf-8"))
        v = cs["members"][pid]
        return v if isinstance(v, str) else v.get("session")
    return manifest()["members"][pid]["session"]


class Ctx:
    def __init__(self, browser, base, vp, pid=None, *, clock=None, theme=None, motion="reduce", clock_session=False):
        w, hgt = SIZES[vp]
        self.vp, self.base, self.pid = vp, base, pid
        self.touch = w <= 1024
        self.ctx = browser.new_context(viewport={"width": w, "height": hgt}, screen={"width": w, "height": hgt},
                                       has_touch=self.touch, is_mobile=self.touch, reduced_motion=motion)
        if clock:
            self.ctx.clock.install(time=clock)
        if pid:
            self.ctx.add_cookies([{"name": "uct_session", "value": session_of(pid, clock_session), "domain": "127.0.0.1",
                                   "path": "/", "httpOnly": True, "secure": False, "sameSite": "Lax"}])
        self.events = []
        self.requests = []
        self.page = self.ctx.new_page()
        pg = self.page

        def on_resp(r):
            self.requests.append({"m": r.request.method, "u": r.url[:200], "s": r.status})
            if r.status >= 400 and not any(b in r.url for b in BENIGN):
                self.events.append({"http": r.status, "method": r.request.method, "url": r.url[:240]})
        pg.on("console", lambda m: m.type == "error" and not m.text.startswith("Failed to load resource")
              and self.events.append({"console": m.text[:400]}))
        pg.on("pageerror", lambda e: self.events.append({"pageerror": str(e)[:400]}))
        pg.on("response", on_resp)
        pg.on("requestfailed", lambda r: (not any(b in r.url for b in BENIGN)) and self.events.append(
            {"requestfailed": r.url[:200], "why": (r.failure or "")[:120]}))

    def goto(self, path):
        pg = self.page
        pg.goto(self.base + path, wait_until="domcontentloaded", timeout=60000)
        pg.wait_for_function("() => { const r = document.getElementById('root'); return r && r.childElementCount > 0 }", timeout=T)
        h._dismiss_intro(pg)
        with contextlib.suppress(Exception):
            fw.settle_first_run(pg)
        skip_tour(pg)
        with contextlib.suppress(Exception):
            g = pg.get_by_role("button", name="Got it", exact=True)
            if g.count() and g.first.is_visible():
                g.first.click()

    def close(self):
        with contextlib.suppress(Exception):
            self.ctx.close()


def axe(pg, scope=None):
    if not pg.evaluate("() => typeof window.axe !== 'undefined'"):
        pg.add_script_tag(content=AXE_SRC)
    return pg.evaluate(rc.AXE_RUN_JS, [scope, rc.WCAG_TAGS])


def tap(pg, scope=None):
    return pg.evaluate(rc.TAP_JS, [scope, rc.TAP_FLOOR])


def overflow(pg):
    return pg.evaluate(walk.OVERFLOW_JS)


def skip_tour(pg, wait=2500):
    st = pg.get_by_role("button", name="Skip tour")
    try:
        st.first.wait_for(state="visible", timeout=wait)
        st.first.click()
        pg.wait_for_timeout(400)
        return True
    except Exception:
        return False
