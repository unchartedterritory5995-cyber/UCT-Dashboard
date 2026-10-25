"""Notebook widgets phase 2 -- the combined ship walk for waves 8, 9 and 10 (plan Task 8.19 Step 4,
Task 9.20 Step 4 and Task 10.22 Step 1; every bullet of the three is a walk step), read off the
RENDERED pages of a local sandbox, at 1200, 820 and 390 px.

PRECONDITIONS (the run refuses, or records NOT RUN, without each; it never assumes one):
  * a sandbox booted from the tip under test through scripts/hub_sandbox_boot.py. This tool boots its
    own (notebook_perf_harness.Sandbox), on an EMPTY data dir outside C:\\data, on a free port; it
    refuses a busy port and never kills another process. The launcher's snapshot rail (pre-boot,
    +15 s, +120 s, shutdown) must read CLEAN; its first line is this run's first line.
  * `app/dist` built from that tip (`cd app && npm run build`): the sandbox serves the built bundle.
  * the flags production has armed on web (notebook_fin_walk.flag_sets()["c1"], read from the ledger)
    plus NOTEBOOK_WIDGETS_W8_ENABLED=1, NOTEBOOK_WIDGETS_W9_ENABLED=1 and NOTEBOOK_WIDGETS_W10_ENABLED=1.
    Each is a real NOTEBOOK_FLAGS gate (api/routers/auth.py), checked at run time. The flag-off phases
    restart the SAME data dir with NOTEBOOK_WIDGETS_W9_ENABLED=0, then with W9=1 and
    NOTEBOOK_WIDGETS_W10_ENABLED=0, and read what the steps say.
  * one PAID walk account per viewport on that data dir: signed up through the app, then comped and
    email-verified by the sandbox admin (ADMIN_EMAILS, the launcher's default) through the app's own
    admin routes; /api/auth/me must say paid-equivalent. Trades, accounts and notes are seeded
    through the product's own HTTP doors.
  The accounts and their password are this tool's SANDBOX SEED; they exist only in the throwaway
  data dir.

Every step records PASS, FAIL or INCONCLUSIVE with the rendered text it read, a screenshot, the
console errors and failed requests the page saw, the horizontal overflow, the sub-44 px targets in
the surface (the tap floor binds on the touch tier, <= 1024 px) and the axe findings in it. PASS
needs every check to have read the product's answer and found it right; FAIL is a product answer
that was wrong; INCONCLUSIVE is a step the driver could not read to its end, or one that would need a
real vendor, email or Discord (the sandbox blanks those on purpose). INCONCLUSIVE is never a pass.
R-RAW: walk.json is rewritten after every step, before any verdict.

Usage (PowerShell, data dir single-quoted):
    python tools/notebook_widgets_p2_walk.py --data-dir 'C:\\data-nbw-walk' --port 8093 `
        --tip <sha> --out docs/notebook/evidence/nbw-p2-ship-<shortsha>
    # against a sandbox already running (iterating on this tool only; never evidence):
    python tools/notebook_widgets_p2_walk.py --base http://127.0.0.1:8091 --out <dir> --only W8.1

This driver never imports api.* in its own process. Never run on import.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
import traceback
from datetime import datetime, timezone
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402
import notebook_fin_walk as fw  # noqa: E402  -- flag_sets, settle_first_run, BENIGN

W8, W9, W10 = "NOTEBOOK_WIDGETS_W8_ENABLED", "NOTEBOOK_WIDGETS_W9_ENABLED", "NOTEBOOK_WIDGETS_W10_ENABLED"
VIEWPORTS = {"1200": (1200, 800), "820": (820, 1180), "390": (390, 844)}
TOUCH_MAX = 1024
TAP_FLOOR = 44
PW = "LocalTest2026!"
T = 30000
AXE_PATH = REPO / "app" / "node_modules" / "axe-core" / "axe.min.js"
WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
# Trading sessions the seeded trades close on (the walk's week; today is read from the sandbox clock).
SESSIONS = ["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]

REC: dict = {"tool": "tools/notebook_widgets_p2_walk.py", "steps": [], "setup": [], "phases": []}
OUT: Path | None = None
STATE: dict = {}          # per viewport: account, note ids, widget ids ... (state.json, for phase re-runs)
ONLY: set[str] = set()


# ── words read from the source, never typed ───────────────────────────────────────────────

def _src(rel: str) -> str:
    return (REPO / rel).read_text(encoding="utf-8")


def _const(rel: str, name: str) -> str:
    m = re.search(r"(?:export const|^const|^)\s*" + re.escape(name) + r"\s*=\s*(['\"`])(.*?)\1", _src(rel), re.M)
    if not m:
        raise SystemExit(f"REFUSED: could not read {name} from {rel}")
    return m.group(2)


NB = "app/src/pages/journal-2-0/components/notebook"
SAMPLE_LABEL = _const(f"{NB}/widgetBuilder/PreviewPane.jsx", "SAMPLE_LABEL")


# ── recorder ──────────────────────────────────────────────────────────────────────────────

def flush() -> None:
    if OUT is not None:
        tmp = OUT / "walk.json.tmp"
        tmp.write_text(json.dumps(REC, indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
        os.replace(tmp, OUT / "walk.json")
        tmp = OUT / "state.json.tmp"
        tmp.write_text(json.dumps(STATE, indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
        os.replace(tmp, OUT / "state.json")


class Watch:
    """Console errors, page errors and every response >= 400 one page saw, per step."""

    def __init__(self, pg):
        self.events: list[dict] = []
        self.attach(pg)

    def attach(self, pg):
        pg.on("console", lambda m: m.type == "error" and self.events.append({"console": m.text[:300]}))
        pg.on("pageerror", lambda e: self.events.append({"pageerror": str(e)[:300]}))
        pg.on("response", lambda r: r.status >= 400 and not any(b in r.url for b in fw.BENIGN)
              and self.events.append({"http": r.status, "method": r.request.method, "url": r.url[:200]}))

    def take(self) -> list[dict]:
        out, self.events = self.events, []
        return out


class Inconclusive(Exception):
    """The step cannot be driven to its end here (the reason is the message)."""


class Step:
    def __init__(self, vp: str, sid: str, title: str):
        self.row = {"viewport": vp, "step": sid, "title": title, "checks": [], "rendered": [], "verdict": None}
        self.surface: str | None = None     # a CSS selector for the metrics' scope

    def read(self, what: str, text: str) -> str:
        self.row["rendered"].append({"what": what, "text": (text or "").strip()[:1500]})
        return text or ""

    def check(self, what: str, ok: bool, read: str) -> bool:
        self.row["checks"].append({"what": what, "ok": bool(ok), "read": (read or "")[:600]})
        return ok

    def note(self, what: str, value) -> None:
        self.row.setdefault("notes", []).append({"what": what, "value": value})


# ── per-step metrics: overflow, the tap floor, axe ────────────────────────────────────────

OVERFLOW_JS = """() => {
  const de = document.documentElement, vw = de.clientWidth;
  const scrollers = [...document.querySelectorAll('main, [class*="_content_"], [class*="_main_"]')];
  const inner = scrollers.map(e => [e.scrollWidth, e.clientWidth]).filter(([s, c]) => c > 0);
  const off = [];
  for (const el of document.querySelectorAll('body *')) {
    const b = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || b.width === 0 || b.height === 0) continue;
    if (b.right > vw + 1 && b.left < vw) {
      off.push({ tag: el.tagName, cls: String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || '').slice(0, 60),
                 text: (el.innerText || '').trim().slice(0, 40), right: Math.round(b.right) });
      if (off.length >= 6) break;
    }
  }
  const innerOver = inner.some(([s, c]) => s > c + 1);
  return { vw, docScrollWidth: de.scrollWidth, bodyScrollWidth: document.body.scrollWidth, inner: inner.slice(0, 4),
           horizontal: de.scrollWidth > vw + 1 || document.body.scrollWidth > vw + 1 || innerOver, offenders: off };
}"""

TAP_JS = """(sel) => {
  const root = (sel && document.querySelector(sel)) || document.body;
  const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
                       return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' };
  const ctl = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=tab], [role=menuitem], [role=option]')]
    .filter(vis).filter(e => !e.disabled);
  const small = ctl.map(e => { const b = e.getBoundingClientRect();
      return { label: (e.getAttribute('aria-label') || e.innerText || e.value || e.tagName).trim().replace(/\\s+/g, ' ').slice(0, 40),
               tag: e.tagName, w: Math.round(b.width), h: Math.round(b.height) } })
    .filter(c => c.w < 44 || c.h < 44);
  return { scope: sel && document.querySelector(sel) ? sel : 'body', controls: ctl.length, small: small.slice(0, 25), smallCount: small.length };
}"""

AXE_RUN_JS = """async ([sel, tags]) => {
  const root = (sel && document.querySelector(sel)) || document.body;
  const r = await window.axe.run(root, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
  return { version: window.axe.version, scope: sel && document.querySelector(sel) ? sel : 'body',
           violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
             targets: v.nodes.slice(0, 4).map(n => n.target.join(' ')) })) };
}"""


def surface_of(pg, preferred: str | None) -> str | None:
    """The scope the metrics read: the step's own surface, else the topmost visible dialog, else the
    editor's page."""
    for sel in ([preferred] if preferred else []) + ["[role=dialog][aria-modal=true]", "[role=dialog]"]:
        try:
            if sel and pg.locator(sel).last.is_visible():
                pg.evaluate("(s) => { document.querySelectorAll('[data-nbw-scope]').forEach(e => e.removeAttribute('data-nbw-scope'));"
                            " const els = [...document.querySelectorAll(s)].filter(e => e.getBoundingClientRect().width > 0);"
                            " if (els.length) els[els.length - 1].setAttribute('data-nbw-scope', ''); }", sel)
                return "[data-nbw-scope]"
        except Exception:  # noqa: BLE001
            pass
    return None


def metrics(pg, vp: str, preferred: str | None) -> dict:
    out: dict = {}
    try:
        out["overflow"] = pg.evaluate(OVERFLOW_JS)
    except Exception as e:  # noqa: BLE001
        out["overflow"] = {"error": str(e)[:200]}
    sel = surface_of(pg, preferred)
    try:
        tap = pg.evaluate(TAP_JS, sel)
        tap["binds"] = int(vp) <= TOUCH_MAX
        out["tap"] = tap
    except Exception as e:  # noqa: BLE001
        out["tap"] = {"error": str(e)[:200]}
    try:
        if not pg.evaluate("() => typeof window.axe !== 'undefined'"):
            pg.add_script_tag(path=str(AXE_PATH))
        out["axe"] = pg.evaluate(AXE_RUN_JS, [sel, WCAG_TAGS])
    except Exception as e:  # noqa: BLE001
        out["axe"] = {"error": str(e)[:200]}
    return out


def run_step(vp: str, sid: str, title: str, fn, pages: dict) -> dict | None:
    if ONLY and sid not in ONLY and sid.split(".")[0] not in ONLY:
        return None
    st = Step(vp, sid, title)
    print(f"[{vp}] {sid} ...: {title}", flush=True)
    try:
        fn(st)
        checks = st.row["checks"]
        st.row["verdict"] = "PASS" if checks and all(c["ok"] for c in checks) else "FAIL"
        if not checks:
            st.row["verdict"] = "INCONCLUSIVE"
            st.row["error"] = "the step read nothing"
    except Inconclusive as e:
        failed = [c for c in st.row["checks"] if not c["ok"]]
        st.row["verdict"] = "FAIL" if failed else "INCONCLUSIVE"
        st.row["error"] = f"INCONCLUSIVE: {e}"
    except Exception as e:  # noqa: BLE001 -- a read the driver could not finish
        failed = [c for c in st.row["checks"] if not c["ok"]]
        st.row["verdict"] = "FAIL" if failed else "INCONCLUSIVE"
        st.row["error"] = f"{type(e).__name__}: {str(e)[:500]}"
        st.row["traceback"] = traceback.format_exc()[-1500:]
    for role, (pg, watch) in pages.items():
        if pg is None or pg.is_closed():
            continue
        st.row.setdefault("events", {})[role] = watch.take()
        if role == "main":
            st.row["metrics"] = metrics(pg, vp, st.surface)
        try:
            shot = OUT / vp / f"{sid.replace('.', '_')}-{role}.png"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(shot))
            st.row.setdefault("screenshots", []).append(str(shot.relative_to(OUT)).replace("\\", "/"))
        except Exception:  # noqa: BLE001
            pass
        if st.row["verdict"] != "PASS":
            try:
                st.row.setdefault("page_text", {})[role] = pg.locator("body").inner_text(timeout=3000)[:3000]
            except Exception:  # noqa: BLE001
                pass
    old = [r for r in REC["steps"] if r.get("viewport") == vp and r.get("step") == sid]
    if old:                                   # a --resume pass re-ran this step: the earlier row is kept, marked
        REC.setdefault("superseded", []).extend(old)
        REC["steps"] = [r for r in REC["steps"] if not (r.get("viewport") == vp and r.get("step") == sid)]
        st.row["supersedes_an_earlier_row"] = True
    REC["steps"].append(st.row)
    one = OUT / "steps" / f"{vp}-{sid.replace('.', '_')}.json"
    one.parent.mkdir(parents=True, exist_ok=True)
    tmp = one.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(st.row, indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
    os.replace(tmp, one)
    flush()
    print(f"[{vp}] {sid} {st.row['verdict']}: {title}" + (f"  ({st.row.get('error')})" if st.row.get("error") else ""),
          flush=True)
    return st.row


# ── accounts, pages, notes ────────────────────────────────────────────────────────────────

def who(vp: str) -> tuple[str, str, str]:
    return (STATE[vp]["email"], PW, f"Widgets walk {vp}")


SESS: dict[str, dict] = {}   # signed-in storage per account, in memory only (never written to the evidence)


def _auth(browser, base: str, email: str, pw: str, name: str, signup: bool = False) -> dict:
    """One sign-in, kept as storage state: the sandbox limits sign-ups to 3 and sign-ins to 5 a minute per
    address, so every page of an account reuses this one session. A 429 waits out the minute."""
    c = browser.new_context()
    try:
        for attempt in range(4):
            r = None
            if signup:
                r = c.request.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": name})
            if r is None or r.status not in (200, 201):
                r = c.request.post(base + "/api/auth/login", data={"email": email, "password": pw})
            if r.status in (200, 201):
                return c.storage_state()
            if r.status == 429:
                time.sleep(62)
                signup = False
                continue
            raise h.SetupFailed(f"could not sign in {email}: HTTP {r.status}")
        raise h.SetupFailed(f"could not sign in {email}: still rate limited")
    finally:
        c.close()


def session(browser, base: str, vp: str) -> dict:
    if vp not in SESS:
        SESS[vp] = _auth(browser, base, STATE[vp]["email"], PW, f"Widgets walk {vp}")
    return SESS[vp]


def new_ctx(browser, vp: str, ht: int | None = None, storage: dict | None = None):
    wd, hh = VIEWPORTS[vp]
    touch = wd <= TOUCH_MAX
    return browser.new_context(viewport={"width": wd, "height": ht or hh}, screen={"width": wd, "height": hh},
                               has_touch=touch, is_mobile=touch, reduced_motion="reduce",
                               **({"storage_state": storage} if storage else {}))


def provision(browser, base: str, vp: str, run: str) -> None:
    st = STATE.setdefault(vp, {})
    if st.get("email"):
        return
    st["email"] = f"nbw-walk-{vp}-{run}@local.dev"
    if "admin" not in SESS:
        SESS["admin"] = _auth(browser, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest", signup=True)
    SESS[vp] = _auth(browser, base, st["email"], PW, f"Widgets walk {vp}", signup=True)
    admin = browser.new_context(storage_state=SESS["admin"])
    c = browser.new_context(storage_state=SESS[vp])
    try:
        comp = admin.request.post(base + "/api/auth/admin/comp-access", data={"email": st["email"], "action": "grant"})
        ver = admin.request.post(base + "/api/auth/admin/verify-email", data={"email": st["email"]})
        me = c.request.get(base + "/api/auth/me").json()
        flags = {k: me.get(k) for k in ("notebook_widgets_w8_enabled", "notebook_widgets_w9_enabled",
                                         "notebook_widgets_w10_enabled")}
        REC["setup"].append({"viewport": vp, "account": st["email"], "comp": comp.status, "verify": ver.status,
                             "paid_equiv": bool(me.get("paid_equiv")), "flags_on_me": flags})
        if not me.get("paid_equiv"):
            raise h.SetupFailed(f"{st['email']} is not paid-equivalent (comp {comp.status}, verify {ver.status})")
        # A second account for "Change the range and account" (the accounts door the Settings page uses).
        r = c.request.post(base + "/api/j2/accounts", data={"name": "Swing book", "color": "teal", "startingBalance": 25000})
        body = r.json() if r.ok else {}
        st["swing_account"] = (body.get("account") or body).get("id")
        accts = c.request.get(base + "/api/j2/accounts").json()
        accts = accts.get("accounts", accts) if isinstance(accts, dict) else accts
        st["default_account"] = next((a.get("id") for a in accts if a.get("id") != st["swing_account"]), None)
        if not st["default_account"]:
            # a brand-new member has no account until one is made: make the main one too, so every seed trade names
            # its own account (a trade with none lands in whichever account the Journal has selected)
            r2 = c.request.post(base + "/api/j2/accounts", data={"name": "Main book", "color": "blue", "startingBalance": 100000})
            st["default_account"] = ((r2.json() if r2.ok else {}).get("account") or (r2.json() if r2.ok else {})).get("id")
            REC["setup"].append({"viewport": vp, "what": "main account 'Main book'", "status": r2.status,
                                 "id": st["default_account"], "verdict": "INFO"})
        REC["setup"].append({"viewport": vp, "what": "second account 'Swing book'", "status": r.status,
                             "id": st["swing_account"], "verdict": "INFO"})
    finally:
        admin.close()
        c.close()
    flush()


def signed_in(browser, base: str, vp: str, ht: int | None = None):
    return new_ctx(browser, vp, ht, storage=session(browser, base, vp))


def open_page(ctx, base: str, path: str, watch: Watch | None = None):
    pg = ctx.new_page()
    w = watch or Watch(pg)
    if watch:
        watch.attach(pg)
    pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    fw.settle_first_run(pg)
    return pg, w


def make_note(ctx, base: str, title: str, paras=("",)) -> str:
    body = {"type": "doc", "content": [{"type": "paragraph", "content": ([{"type": "text", "text": p}] if p else [])}
                                       for p in paras]}
    r = ctx.request.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"note create refused: HTTP {r.status}")
    return r.json()["note"]["id"]


def get_note(ctx, base: str, nid: str) -> dict:
    return ctx.request.get(base + f"/api/j2/notes/{nid}").json().get("note") or {}


def embeds(note: dict, widget_id: str | None = None) -> list[dict]:
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "widgetEmbed" and (widget_id is None or (n.get("attrs") or {}).get("widgetId") == widget_id):
                out.append(n.get("attrs") or {})
            for c in n.get("content") or []:
                walk(c)
    walk(note.get("bodyJson") or {})
    return out


def goto_note(pg, base: str, nid: str):
    pg.goto(base + f"/journal/notebook?note={nid}", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    ed = pg.locator(".ProseMirror").first
    ed.wait_for(state="visible", timeout=T)
    return ed


def slash(pg, ed, text: str, pick: str | None = None) -> None:
    """Type a slash command on a fresh line at the end of the note, and pick its row (Enter, or the row whose text
    matches `pick`). One retry when the menu does not open (the caret did not land in the text)."""
    menu = pg.get_by_role("listbox", name="Insert block").last
    for attempt in range(2):
        # a click on the note's last paragraph puts the caret in its text (a click on the middle of the editor can
        # land on a widget frame, and the typing then goes nowhere)
        paras = ed.locator(":scope > p")
        target = paras.last if paras.count() else ed
        target.scroll_into_view_if_needed()
        target.click()
        pg.keyboard.press("Control+End")
        pg.keyboard.press("Enter")
        pg.keyboard.type(text, delay=25)
        try:
            menu.wait_for(timeout=8000 if attempt == 0 else T)
            break
        except Exception:  # noqa: BLE001
            if attempt:
                raise
            for _ in text:
                pg.keyboard.press("Backspace")
    if pick:
        menu.get_by_role("option").filter(has_text=re.compile(pick)).first.click(timeout=T)
    else:
        pg.wait_for_timeout(400)
        pg.keyboard.press("Enter")


def builder(pg):
    dlg = pg.get_by_role("dialog").filter(has_text=re.compile(r"Build a widget|Edit widget|Edit a copy")).last
    dlg.wait_for(timeout=T)
    return dlg


def live_text(pg) -> str:
    return pg.locator("[data-testid=builder-live]").last.text_content() or ""


def wait_live(pg, pred_js: str = "t => t.length > 0", timeout: int = T) -> str:
    pg.wait_for_function("(p) => { const e = [...document.querySelectorAll('[data-testid=builder-live]')].pop();"
                         " const t = e ? (e.textContent || '') : ''; return (new Function('t', 'return (' + p + ')(t)'))(t) }",
                         arg=pred_js, timeout=timeout)
    return live_text(pg)


def close_sheet(pg, dlg) -> None:
    dlg.get_by_role("button", name="Close", exact=True).first.click(timeout=T)
    dlg.wait_for(state="hidden", timeout=T)


def pick_menu(pg, label: str) -> None:
    """A ContextPopover row: a menuitem in a `role=menu` on desktop, a button in a sheet (a dialog) on touch. Waits
    for whichever appears (a count() alone does not wait, and read the menu before it had opened)."""
    item = pg.locator("[role=menu] [role=menuitem]").filter(has_text=re.compile("^" + re.escape(label) + "$"))
    sheet_btn = pg.locator("[role=dialog]").last.get_by_role("button", name=label, exact=True)
    t0 = time.time()
    while time.time() - t0 < T / 1000:
        if item.count() and item.first.is_visible():
            item.first.click(timeout=T)
            return
        if sheet_btn.count() and sheet_btn.first.is_visible():
            sheet_btn.first.click(timeout=T)
            return
        time.sleep(0.2)
    raise Inconclusive(f"the menu row '{label}' never appeared")


def log_trades(ctx, base: str, rows: list[dict]) -> list[str]:
    ids = []
    for r in rows:
        resp = ctx.request.post(base + "/api/j2/trades", data=r)
        if resp.status not in (200, 201):
            raise Inconclusive(f"the trades door refused a seed trade: HTTP {resp.status} {resp.text()[:200]}")
        body = resp.json()
        ids.append((body.get("trade") or body).get("id"))
    return ids


def embed_in(pg, title: str):
    """The placed built widget whose header reads `title`."""
    return pg.locator("[data-snapshot-frame]").filter(has=pg.locator("span", has_text=re.compile("^" + re.escape(title) + "$"))).first


def wait_msg(pg, rx: str, timeout: int = T) -> str:
    pg.wait_for_function("(rx) => { const m = document.querySelector('[data-testid=my-tools-message]');"
                         " return m && new RegExp(rx).test(m.textContent) }", arg=rx, timeout=timeout)
    return pg.locator("[data-testid=my-tools-message]").inner_text()


def poll(fn, tries: int = 30, every_s: float = 0.5):
    got = None
    for _ in range(tries):
        got = fn()
        if got:
            return got
        time.sleep(every_s)
    return got


def def_of(ctx, base: str, def_id: str) -> dict:
    d = ctx.request.get(base + f"/api/j2/widget-definitions/{def_id}").json()
    return d.get("definition") or d


def placed_def(ctx, base: str, nid: str) -> str | None:
    got = embeds(get_note(ctx, base, nid), "builtWidget")
    return (got[0].get("params") or {}).get("defId") if got else None


DEDICATED_IDS = ("myTiltCheck", "myRevengeClean", "myPlanVsActual", "myRiskLeftToday", "myPropFirm", "myGamePlan",
                 "myAlertsFired", "sizeCalc")
ACCOUNT_KINDS_PUBLIC = ("routine", "tracker", "builtWidget") + DEDICATED_IDS


def private_runs(note: dict) -> int:
    """How many account lines a public page should show for this note: one per run of ADJACENT top-level private
    items (routine, tracker, a ready-made widget, the calculator, an unshared built widget): the reducer collapses a
    neutral line into the SAME line right before it (`_reduce_children`), so any other node, an empty paragraph
    included, starts a new run. A shared built widget shows its archived image instead."""
    runs, in_run = 0, False
    for n in ((note.get("bodyJson") or {}).get("content") or []):
        a = n.get("attrs") or {}
        if n.get("type") == "widgetEmbed":
            wid = a.get("widgetId")
            private = wid in ACCOUNT_KINDS_PUBLIC and not (wid == "builtWidget" and (a.get("params") or {}).get("share") is True)
            if private and not in_run:
                runs += 1
            in_run = private
        else:
            in_run = False
    return runs


def confirm_archive(sheet) -> None:
    """A tool or widget used in a note asks before it is archived (its panel's own Archive button)."""
    panel = sheet.locator("[data-testid=my-tools-archive]")
    try:
        panel.wait_for(timeout=4000)
    except Exception:  # noqa: BLE001 -- an unused one archives at once
        return
    panel.get_by_role("button", name=re.compile(r"^Archive( routine| tracker)?$")).last.click(timeout=T)


def preview_text(pg, dlg) -> str:
    """The builder's preview, read as the member sees it: the pane on a wide screen; on a phone, the summary bar
    opened first (its body is not drawn while it is closed)."""
    bar = dlg.locator("[data-testid=builder-summary-bar]")
    if bar.count() and bar.first.is_visible():
        if bar.first.get_attribute("aria-expanded") != "true":
            bar.first.click(timeout=T)
            pg.wait_for_timeout(500)
        return dlg.locator("[data-testid=builder-phone-preview]").first.inner_text()
    return dlg.locator("[data-testid=builder-preview]").first.inner_text()


def render_all(pg) -> None:
    """Scroll every top-level node of the note into view in turn: an embed below the fold draws only a placeholder
    until it has been on screen (the member scrolling past it does the same)."""
    n = pg.evaluate("() => document.querySelector('.ProseMirror') ? document.querySelector('.ProseMirror').children.length : 0")
    for i in range(n):
        pg.evaluate("(i) => { const c = document.querySelector('.ProseMirror').children[i]; if (c) c.scrollIntoView({block: 'center'}) }", i)
        pg.wait_for_timeout(350)
    pg.wait_for_timeout(1200)


# ── wave 8 (Task 8.19 Step 4) ─────────────────────────────────────────────────────────────

def wave8(browser, base: str, vp: str) -> None:
    S = STATE[vp]
    ctx = signed_in(browser, base, vp)
    if not S.get("n1"):
        S["n1"] = make_note(ctx, base, f"Widgets walk {vp}", ("My week in numbers.",))
    pg, w = open_page(ctx, base, f"/journal/notebook?note={S['n1']}")
    pages = {"main": (pg, w)}
    holder: dict = {}

    def s1(st):
        e = goto_note(pg, base, S["n1"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        banner = dlg.get_by_text(re.compile(r"^These use sample trades\."))
        banner.wait_for(timeout=T)
        st.check("the gallery says it uses sample trades on a fresh account", True, st.read("gallery banner", banner.inner_text()))
        dlg.locator('[data-testid="example-card-shelf:daily-pnl-bars"]').click(timeout=T)
        said = wait_live(pg)
        st.read("preview summary (live region)", said)
        st.check("the preview says it is sample data", said.startswith(SAMPLE_LABEL + " · "), said)
        if int(vp) > 640:
            txt = st.read("preview pane", dlg.locator("[data-testid=builder-preview]").inner_text())
            st.check("the preview pane wears the Sample data ribbon", SAMPLE_LABEL in txt.splitlines()[:4], txt[:200])
        else:
            txt = st.read("phone summary bar", dlg.locator("[data-testid=builder-summary-bar]").inner_text())
            st.check("the phone summary bar starts with Sample data", txt.startswith(SAMPLE_LABEL), txt)
        close_sheet(pg, dlg)

    def s2(st):
        rows = []
        for i, d in enumerate(SESSIONS):
            win = i % 2 == 0
            row = {"symbol": ["AAPL", "MSFT", "NVDA", "AMD", "TSLA"][i], "side": "Long", "shares": 100,
                   "entryPrice": 100, "entryDate": d, "exitPrice": 103 if win else 98, "exitDate": d, "originalStop": 98}
            # every seed trade names its account: a new account becomes the one the Journal has selected
            row["accountId"] = S["swing_account"] if i == 3 else S.get("default_account")
            rows.append(row)
        S["trade_ids"] = log_trades(ctx, base, rows)
        st.note("trades logged through POST /api/j2/trades (the Trades page's door)", S["trade_ids"])
        e = goto_note(pg, base, S["n1"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        card = dlg.locator('[data-testid="example-card-shelf:daily-pnl-bars"]')
        card.wait_for(timeout=T)
        banner = dlg.get_by_text(re.compile(r"^These use sample trades\."))
        st.check("the sample-trades banner is gone once 5 trades are logged", banner.count() == 0, f"banner count {banner.count()}")
        card.click(timeout=T)
        said = wait_live(pg)
        st.read("preview summary (live region)", said)
        st.check("the preview no longer says sample data", not said.startswith(SAMPLE_LABEL), said)
        st.check("the preview counts the member's 5 trades", "5 trades" in said, said)

    def s3(st):
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/widget-definitions") and r.request.method == "POST",
                                timeout=T) as resp:
            dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the widget was saved (HTTP 200/201)", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
        dlg.wait_for(state="hidden", timeout=T)
        emb = embed_in(pg, "Daily P&L bars")
        emb.wait_for(timeout=T)
        st.surface = "[data-snapshot-frame]"
        txt = st.read("placed widget", emb.inner_text())
        st.check("the widget is in the note with its 5 days", all(d in txt for d in SESSIONS), txt[:300])
        S["def1"] = poll(lambda: placed_def(ctx, base, S["n1"]), 30, 0.5)
        st.check("the saved note carries the built widget", bool(S["def1"]), f"defId={S['def1']}")

    def s4(st):
        goto_note(pg, base, S["n1"])
        emb = embed_in(pg, "Daily P&L bars")
        emb.wait_for(timeout=T)
        st.surface = "[data-snapshot-frame]"
        st.read("as of, before", emb.locator("[class*=asOf]").first.inner_text())
        with pg.expect_response(lambda r: "/api/j2/widget-definitions/run" in r.url, timeout=T) as resp:
            emb.get_by_role("button", name="See it now").click(timeout=T)
        st.check("See it now re-ran the widget (HTTP 200)", resp.value.status == 200, f"HTTP {resp.value.status}")
        pg.wait_for_timeout(800)
        after = st.read("as of, after", emb.locator("[class*=asOf]").first.inner_text())
        st.check("the frame shows an as-of time", after.startswith("as of ") and "unrecorded" not in after, after)
        txt = st.read("placed widget", emb.inner_text())
        st.check("it still draws the 5 days", all(d in txt for d in SESSIONS), txt[:300])

    def change(emb, rng_label=None, acc_label=None, rng_index=None, acc_index=None):
        emb.get_by_role("button", name="Change").click(timeout=T)
        form = emb.get_by_role("form", name="Change this widget")
        form.wait_for(timeout=T)
        pg.wait_for_function("() => { const f = document.querySelector('form[aria-label=\"Change this widget\"]');"
                             " return f && [...f.querySelectorAll('select:not([multiple])')].every(x => x.options.length > 1) }",
                             timeout=T)
        rng, acc = form.get_by_label("Date range"), form.get_by_label("Accounts")
        choices = (rng.locator("option").all_inner_texts(), acc.locator("option").all_inner_texts())
        if rng_label:
            rng.select_option(label=rng_label)
        if rng_index is not None:
            rng.select_option(index=rng_index)
        if acc_label:
            acc.select_option(label=acc_label)
        if acc_index is not None:
            acc.select_option(index=acc_index)
        with pg.expect_response(lambda r: "/api/j2/widget-definitions/run" in r.url, timeout=T) as resp:
            form.get_by_role("button", name="Show these").click(timeout=T)
        form.wait_for(state="hidden", timeout=T)
        pg.wait_for_timeout(600)
        return resp.value.status, choices

    def s5(st):
        emb = embed_in(pg, "Daily P&L bars")
        st.surface = "[data-snapshot-frame]"
        code, (rc, ac) = change(emb, rng_label="Last 7 days", acc_label="Swing book")
        st.read("range choices", " | ".join(rc))
        st.read("account choices", " | ".join(ac))
        st.check("the changed widget re-ran (HTTP 200)", code == 200, f"HTTP {code}")
        txt = st.read("placed widget after Change", emb.inner_text())
        st.check("it now reads the Swing book account over the last 7 days", "Swing book" in txt and "Last 7 days" in txt, txt[:300])
        st.check("only the Swing book trade's day is drawn", SESSIONS[3] in txt and SESSIONS[0] not in txt, txt[:300])
        code, _ = change(emb, rng_index=0, acc_index=0)
        st.read("placed widget after Change back", emb.inner_text())
        st.check("back to the widget's own range and all accounts (HTTP 200)", code == 200, f"HTTP {code}")

    def s6(st):
        emb = embed_in(pg, "Daily P&L bars")
        cell = emb.locator("[data-built-cell]").first
        cell.wait_for(timeout=T)
        st.read("first bar's name", cell.get_attribute("aria-label") or "")
        cell.click(timeout=T)
        rows = pg.locator("[data-testid=built-drill-rows]").last
        rows.wait_for(timeout=T)
        panel = pg.locator("[role=dialog]").filter(has=rows).last
        st.surface = "[role=dialog]"
        txt = st.read("drill rows", panel.inner_text())
        st.check("the drill lists the trade behind the bar", "AAPL" in txt, txt[:300])
        link = rows.locator("a").first
        st.read("row link", link.get_attribute("href") or "")
        link.click(timeout=T)
        pg.wait_for_url(re.compile(r"/journal-2-0/trade/"), timeout=T)
        pg.get_by_text("AAPL").first.wait_for(timeout=T)
        st.check("the trade opens on its own page", "/journal-2-0/trade/" in pg.url, pg.url)
        st.read("trade page", pg.locator("body").inner_text()[:600])

    def s7(st):
        goto_note(pg, base, S["n1"])
        emb = embed_in(pg, "Daily P&L bars")
        emb.wait_for(timeout=T)
        sw = emb.get_by_role("switch")
        if sw.get_attribute("aria-checked") != "true":
            sw.click(timeout=T)
        st.check("Show on shared pages is on", sw.get_attribute("aria-checked") == "true", sw.get_attribute("aria-checked") or "")

        def archived():
            got = embeds(get_note(ctx, base, S["n1"]), "builtWidget")
            return got[0].get("fallback") if got and (got[0].get("params") or {}).get("share") is True else None
        fb = poll(archived, 40, 1.0)
        st.check("the shared widget's image was archived into the note", bool(fb), json.dumps(fb)[:200])
        pg.wait_for_timeout(1500)
        scan = pg.get_by_text(re.compile(r"looks like a scan"))
        st.note("a 'looks like a scan' notice in the note after the archive (observation)",
                scan.first.inner_text() if scan.count() else None)
        pg.get_by_role("button", name="Share", exact=True).click(timeout=T)
        sh = pg.get_by_role("dialog", name="Share this note")
        sh.get_by_role("button", name="Create link", exact=True).click(timeout=T)
        url = sh.get_by_label("Share link address").input_value(timeout=T)
        S["share_url_n1"] = url
        st.read("share link", url)
        pg.keyboard.press("Escape")
        pub = browser.new_context(viewport={"width": VIEWPORTS[vp][0], "height": VIEWPORTS[vp][1]})
        try:
            pp = pub.new_page()
            pw = Watch(pp)
            pp.goto(url, wait_until="domcontentloaded", timeout=60000)
            img = pp.get_by_role("img", name=re.compile("Daily P&L bars"))
            img.first.wait_for(timeout=T)
            ptxt = st.read("public page", pp.locator("body").inner_text())
            html = pp.content()
            st.check("the private window shows the widget's result (its archived image)", img.count() >= 1,
                     img.first.get_attribute("alt") or "")
            st.check("no summary sentence on the public page", "split by day" not in ptxt and "split by day" not in html, ptxt[:300])
            api = pub.request.get(url.replace("/share/n/", "/api/j2/shared/")).text()
            leaks = [k for k in ('"summary"', '"def"', '"defId"', '"scopeLabel"', '"accountId"') if k in api]
            st.check("the shared payload carries no definition, summary or account", not leaks, f"keys seen: {leaks}")
            shot = OUT / vp / "W8_7-public.png"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pp.screenshot(path=str(shot), full_page=True)
            st.row.setdefault("screenshots", []).append(str(shot.relative_to(OUT)).replace("\\", "/"))
            st.note("public page events", pw.take())
        finally:
            pub.close()

    def edit_from(st, nid, title, rename_to, answer):
        goto_note(pg, base, nid)
        emb = embed_in(pg, title)
        emb.wait_for(timeout=T)
        emb.get_by_role("button", name="More for this widget").click(timeout=T)
        pg.locator("[data-testid=built-menu]").get_by_role("button", name="How this is made").click(timeout=T)
        how = pg.get_by_role("dialog", name="How this is made")
        how.get_by_role("button", name="Edit widget").click(timeout=T)
        dlg = builder(pg)
        nm = dlg.get_by_label("Name", exact=True)
        nm.wait_for(timeout=T)
        nm.fill(rename_to)
        pg.wait_for_timeout(1200)
        dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
        dlg.get_by_text("This widget is in 2 notes.").wait_for(timeout=T)
        st.read(f"save question (answering {answer})", dlg.inner_text()[-500:])
        dlg.locator("label").filter(has_text=answer).first.click(timeout=T)
        with pg.expect_response(lambda r: "/api/j2/widget-definitions" in r.url and r.request.method in ("PUT", "POST")
                                and not any(x in r.url for x in ("/run", "/preview", "/examples")), timeout=T) as resp:
            dlg.locator("[data-save-confirm]").click(timeout=T)
        dlg.wait_for(state="hidden", timeout=T)
        return resp.value.status

    def s8(st):
        if not S.get("n2"):
            S["n2"] = make_note(ctx, base, f"Widgets walk {vp} (second note)", ("The same widget, elsewhere.",))
        e2 = goto_note(pg, base, S["n2"])
        # the member's own widget (its row reads its summary), not the firm's example of the same name
        slash(pg, e2, "/Daily P&L", pick=r"split by day")
        embed_in(pg, "Daily P&L bars").wait_for(timeout=T)
        d2 = poll(lambda: placed_def(ctx, base, S["n2"]), 30, 0.5)
        st.check("the same widget is placed in a second note", d2 == S.get("def1"), f"n2={d2} def1={S.get('def1')}")
        # edited from the second note (the first one's copy is shared now, and a shared copy offers no menu)
        code = edit_from(st, S["n2"], "Daily P&L bars", "Daily P&L bars (walk)", "Update all 2 notes")
        st.check("Update all 2 notes was saved", code in (200, 201), f"HTTP {code}")
        dd = def_of(ctx, base, S["def1"])
        st.read("definition after Update all", json.dumps({k: dd.get(k) for k in ("name", "rev", "usedIn")}))
        st.check("the one widget took the new name", dd.get("name") == "Daily P&L bars (walk)", str(dd.get("name")))
        n1d, n2d = placed_def(ctx, base, S["n1"]), placed_def(ctx, base, S["n2"])
        st.check("both notes still point at the one widget", n1d == n2d == S["def1"], f"n1={n1d} n2={n2d}")
        code = edit_from(st, S["n2"], "Daily P&L bars", "Daily P&L bars (this note)", "Save as a new widget")
        st.check("Save as a new widget was saved", code in (200, 201), f"HTTP {code}")
        n2d = poll(lambda: (lambda d: d if d and d != S["def1"] else None)(placed_def(ctx, base, S["n2"])), 30, 0.5)
        n1d = placed_def(ctx, base, S["n1"])
        st.check("this note now uses a new widget; the other note keeps the old one",
                 bool(n2d) and n2d != S["def1"] and n1d == S["def1"], f"n2={n2d} n1={n1d} def1={S['def1']}")
        S["def1b"] = n2d

    def s9(st):
        goto_note(pg, base, S["n2"])
        emb = pg.locator("[data-snapshot-frame]").first
        emb.wait_for(timeout=T)
        emb.get_by_role("button", name="More for this widget").click(timeout=T)
        pg.locator("[data-testid=built-menu]").get_by_role("button", name="Manage…").click(timeout=T)
        sheet = pg.get_by_role("dialog", name="My tools")
        sheet.wait_for(timeout=T)
        st.surface = "[role=dialog]"
        tab = sheet.locator("[data-testid=my-tools-widgets]")
        tab.wait_for(timeout=T)
        cur = def_of(ctx, base, S["def1"]).get("name") or "Daily P&L bars (walk)"
        row = tab.locator("li").filter(has_text=cur).first
        row.wait_for(timeout=T)
        st.read("widgets list", tab.inner_text()[:800])
        row.get_by_role("button", name=f"Actions for {cur}").click(timeout=T)
        pick_menu(pg, "Rename")
        rn = sheet.locator("[data-testid=my-tools-rename]")
        rn.wait_for(timeout=T)
        rn.get_by_label("Name", exact=True).fill("Daily P&L (renamed)")
        rn.get_by_role("button", name="Save name").click(timeout=T)
        st.check("rename says what happened", True, st.read("message after rename", wait_msg(pg, ".")))
        tab.locator("li").filter(has_text="Daily P&L (renamed)").first.wait_for(timeout=T)
        st.check("the row shows the new name", def_of(ctx, base, S["def1"]).get("name") == "Daily P&L (renamed)",
                 str(def_of(ctx, base, S["def1"]).get("name")))
        row = tab.locator("li").filter(has_text="Daily P&L (renamed)").first
        row.get_by_role("button", name="Actions for Daily P&L (renamed)").click(timeout=T)
        pick_menu(pg, "Version history")
        sheet.get_by_role("heading", name=re.compile(r"^Version history: ")).wait_for(timeout=T)
        sheet.get_by_role("button", name=re.compile(r"^Restore the version from ")).first.wait_for(timeout=T)
        st.read("version history", sheet.inner_text()[:1500])
        rev_before = def_of(ctx, base, S["def1"]).get("rev")
        sheet.get_by_role("button", name=re.compile(r"^Restore the version from ")).last.click(timeout=T)
        conf = sheet.locator("[data-testid=restore-confirm]")
        conf.wait_for(timeout=T)
        st.read("restore question", conf.inner_text())
        with pg.expect_response(lambda r: "/api/j2/widget-definitions/" in r.url and r.request.method in ("POST", "PUT"),
                                timeout=T) as resp:
            conf.locator("[data-confirm-restore]").click(timeout=T)
        st.check("the older version was restored (HTTP 200)", resp.value.status == 200, f"HTTP {resp.value.status}")
        pg.wait_for_timeout(1200)
        dd = def_of(ctx, base, S["def1"])
        st.read("message after restore", sheet.locator("[data-testid=my-tools-message]").inner_text())
        # a restore saves the old revision's PLAN as a new revision; the widget keeps its current name
        st.check("restoring saved the oldest version's plan as a NEW version",
                 (dd.get("rev") or 0) > (rev_before or 0),
                 json.dumps({"before": rev_before, "rev": dd.get("rev"), "name": dd.get("name")}))
        sheet.get_by_role("button", name="Back to your widgets").first.click(timeout=T)
        tab.locator("[data-list-heading]").wait_for(timeout=T)
        cur = dd.get("name") or "Daily P&L (renamed)"
        row = tab.locator("li").filter(has_text=re.compile("^" + re.escape(cur))).first
        row.wait_for(timeout=T)
        row.get_by_role("button", name=f"Actions for {cur}").click(timeout=T)
        pick_menu(pg, "Archive")
        arch = sheet.locator("[data-testid=my-tools-archive]")
        try:
            arch.wait_for(timeout=4000)
            st.read("archive question", arch.inner_text())
            arch.get_by_role("button", name="Archive", exact=True).click(timeout=T)
        except Exception:  # noqa: BLE001 -- an unused widget archives without a question
            pass
        st.check("archive says what happened", True, st.read("message after archive", wait_msg(pg, "rchiv")))
        tab.get_by_role("button", name="Archived", exact=True).click(timeout=T)
        arow = tab.locator("li").filter(has_text=cur).first
        arow.wait_for(timeout=T)
        st.check("the widget is listed under Archived", def_of(ctx, base, S["def1"]).get("archived") is True,
                 str(def_of(ctx, base, S["def1"]).get("archived")))
        prim = arow.get_by_role("button", name=f"Restore {cur}")
        if prim.count() and prim.first.is_visible():
            prim.first.click(timeout=T)
        else:                                   # the phone row keeps its actions in the menu
            arow.get_by_role("button", name=f"Actions for {cur}").click(timeout=T)
            pick_menu(pg, "Restore")
        st.check("restore from Archived says what happened", True, st.read("message after unarchive", wait_msg(pg, "estor")))
        tab.get_by_role("button", name="Active", exact=True).click(timeout=T)
        tab.locator("li").filter(has_text=cur).first.wait_for(timeout=T)
        st.check("the widget is back in the Active list", def_of(ctx, base, S["def1"]).get("archived") is not True, cur)
        close_sheet(pg, sheet)

    def s10(st):
        e = goto_note(pg, base, S["n1"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        dlg.locator('[data-testid="example-card-shelf:win-rate"]').click(timeout=T)
        wait_live(pg)
        nm = dlg.get_by_label("Name", exact=True)
        nm.scroll_into_view_if_needed()
        nm.click()
        wd, hh = VIEWPORTS[vp]
        pg.set_viewport_size({"width": wd, "height": int(hh * 0.55)})     # the soft keyboard takes the lower screen
        try:
            pg.wait_for_timeout(700)
            pg.keyboard.type(" (mine)", delay=30)
            pg.wait_for_timeout(400)
            box = nm.bounding_box()
            vh = pg.evaluate("() => window.visualViewport ? window.visualViewport.height : window.innerHeight")
            st.read("name field box / visual viewport", json.dumps({"box": box, "visualViewport": vh}))
            st.check("the name field stays on screen above the keyboard",
                     bool(box) and box["y"] >= 0 and box["y"] + box["height"] <= vh + 1, json.dumps(box))
            pp = dlg.locator("[data-testid=builder-phone-preview]")
            hidden = pp.evaluate("e => e.hidden") if pp.count() else None
            st.check("the sticky preview summary hides while the keyboard is open", hidden is True, f"hidden={hidden}")
            st.check("what was typed is in the field", nm.input_value().endswith("(mine)"), nm.input_value())
            ov = pg.evaluate(OVERFLOW_JS)
            st.check("no horizontal page scroll with the keyboard open", not ov.get("horizontal"), json.dumps(ov)[:300])
            st.row["metrics_keyboard_open"] = metrics(pg, vp, "[role=dialog]")
            shot = OUT / vp / "W8_10-keyboard.png"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(shot))
            st.row.setdefault("screenshots", []).append(str(shot.relative_to(OUT)).replace("\\", "/"))
        finally:
            pg.set_viewport_size({"width": wd, "height": hh})
        dlg.get_by_role("button", name="Close", exact=True).first.click(timeout=T)

    steps = [("W8.1", "build from an example on sample data (a fresh account)", s1),
             ("W8.2", "log 5 trades and watch the preview switch to real data", s2),
             ("W8.3", "save and insert", s3),
             ("W8.4", "See it now", s4),
             ("W8.5", "Change the range and account", s5),
             ("W8.6", "drill a bar into a trade drawer", s6),
             ("W8.7", "share on, then open the share link in a private window (result only, no summary)", s7),
             ("W8.8", "edit a widget used in two notes and answer both ways", s8),
             ("W8.9", "My tools: rename, history restore, archive and restore", s9)]
    if vp == "390":
        steps.append(("W8.10", "at 390 px also with the keyboard open in the name field", s10))
    try:
        for sid, title, fn in steps:
            run_step(vp, sid, title, fn, pages)
    finally:
        ctx.close()
        flush()


# ── wave 9 (Task 9.20 Step 4) ─────────────────────────────────────────────────────────────

ACCOUNT_LINE = "A private account item is not shown on public pages."
FLAG_OFF_LINE = "Not available right now."
CALENDAR_WHY = ("the walk runs on {today} ET, which is not a market session, and a routine created today has no "
                "scheduled day on or before today, so the server has nothing to count")


def today_et() -> str:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).date().isoformat()


def is_weekend_et() -> bool:
    from zoneinfo import ZoneInfo
    return datetime.now(ZoneInfo("America/New_York")).weekday() >= 5


def note_writes(watch_list: list, nid: str) -> list[str]:
    return [u for u in watch_list if f"/api/j2/notes/{nid}" in u and not u.endswith("/opened")]


def picker(pg, kind: str):
    title = "Add a routine" if kind == "routine" else "Add a tracker"
    dlg = pg.get_by_role("dialog").filter(has_text=title).last
    dlg.wait_for(timeout=T)
    return dlg


def wave9(browser, base: str, vp: str) -> None:
    S = STATE[vp]
    ctx = signed_in(browser, base, vp)
    if not S.get("n3"):
        S["n3"] = make_note(ctx, base, f"Routine walk {vp}", ("Pre-market, then the open.",))
    pg, w = open_page(ctx, base, f"/journal/notebook?note={S['n3']}")
    pages = {"main": (pg, w)}
    writes: list[str] = []
    ctx.on("request", lambda r: r.method in ("PUT", "PATCH", "POST") and "/api/j2/notes/" in r.url
           and writes.append(f"{r.method} {r.url}"))
    holder: dict = {}

    def settle_note(nid: str, quiet_s: float = 3.0, cap_s: float = 25.0) -> str:
        """The note's updatedAt once it has stopped moving (the insert's own autosave landed)."""
        last, since, t0 = None, time.time(), time.time()
        while time.time() - t0 < cap_s:
            cur = get_note(ctx, base, nid).get("updatedAt")
            if cur != last:
                last, since = cur, time.time()
            elif time.time() - since >= quiet_s:
                return cur
            time.sleep(0.5)
        return last

    def boxes(p):
        return p.locator("[data-routine-block] [role=checkbox]")

    def s1(st):
        e = goto_note(pg, base, S["n3"])
        slash(pg, e, "/routine", pick=r"^Routine \(remembered daily\)")
        pk = picker(pg, "routine")
        st.surface = "[role=dialog]"
        st.read("picker", pk.inner_text())
        pk.get_by_role("button", name="New routine").click(timeout=T)
        ed = pg.get_by_role("dialog").filter(has_text="New routine").last
        ed.wait_for(timeout=T)
        ed.get_by_role("button", name="Pre-market routine").click(timeout=T)
        items = [i.input_value() for i in ed.locator("input[aria-label^='Item ']").all()]
        st.read("starter items", " | ".join(items))
        st.check("the Pre-market starter fills the items", len(items) >= 3, " | ".join(items))
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/routines") and r.request.method == "POST", timeout=T) as resp:
            ed.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the routine was saved (HTTP 200/201)", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
        S["routine_id"] = resp.value.json().get("id") or (resp.value.json().get("routine") or {}).get("id")
        boxes(pg).first.wait_for(timeout=T)
        st.surface = "[data-routine-block]"
        settled = settle_note(S["n3"])
        writes.clear()
        boxes(pg).nth(0).click(timeout=T)
        pg.wait_for_function("() => document.querySelectorAll('[data-routine-block] [role=checkbox][aria-checked=true]').length >= 1", timeout=T)
        boxes(pg).nth(1).click(timeout=T)
        pg.wait_for_function("() => document.querySelectorAll('[data-routine-block] [role=checkbox][aria-checked=true]').length >= 2", timeout=T)
        pg.wait_for_timeout(2500)
        st.read("block after two ticks", pg.locator("[data-routine-block]").inner_text())
        st.check("the ticks wrote nothing to the note", not note_writes(writes, S["n3"]), json.dumps(writes[:5]))
        st.check("the note's saved time did not move", get_note(ctx, base, S["n3"]).get("updatedAt") == settled,
                 f"{settled} -> {get_note(ctx, base, S['n3']).get('updatedAt')}")
        pg.reload(wait_until="domcontentloaded")
        h._dismiss_intro(pg)
        boxes(pg).first.wait_for(timeout=T)
        pg.wait_for_timeout(1500)
        on = [b.get_attribute("aria-checked") for b in boxes(pg).all()]
        st.read("ticks after reload", json.dumps(on))
        st.check("both ticks are there after a reload", on[:2] == ["true", "true"], json.dumps(on))
        unsaved = pg.get_by_text(re.compile(r"Unsaved changes"))
        st.check("the note shows no unsaved change after the reload", unsaved.count() == 0,
                 unsaved.first.inner_text() if unsaved.count() else "none")

    def s2(st):
        pg2 = ctx.new_page()
        w2 = Watch(pg2)
        pages["second-tab"] = (pg2, w2)
        pg2.goto(base + f"/journal/notebook?note={S['n3']}", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg2)
        boxes(pg2).first.wait_for(timeout=T)
        boxes(pg).first.wait_for(timeout=T)
        boxes(pg2).nth(2).click(timeout=T)
        pg2.wait_for_function("() => document.querySelectorAll('[data-routine-block] [role=checkbox][aria-checked=true]').length >= 3", timeout=T)
        try:
            pg.wait_for_function("() => document.querySelectorAll('[data-routine-block] [role=checkbox][aria-checked=true]').length >= 3",
                                 timeout=20000)
        except Exception:  # noqa: BLE001
            pass
        a = [b.get_attribute("aria-checked") for b in boxes(pg).all()]
        b2 = [b.get_attribute("aria-checked") for b in boxes(pg2).all()]
        st.read("first tab", json.dumps(a))
        st.read("second tab", json.dumps(b2))
        st.check("the second tab shows all three", b2[:3] == ["true"] * 3, json.dumps(b2))
        st.check("the first tab shows all three, without a reload", a[:3] == ["true"] * 3, json.dumps(a))

    def s3(st):
        blk = pg.locator("[data-routine-block]")
        st.surface = "[data-routine-block]"
        pg.locator("[data-routine-block] [data-skip]").click(timeout=T)
        pg.wait_for_function("() => { const b = document.querySelector('[data-routine-block] [data-skip]'); return b && b.getAttribute('aria-pressed') === 'true' }", timeout=T)
        txt = st.read("block, day skipped", blk.inner_text())
        st.check("Skip this day turns into Skipped", "Skipped" in txt, txt[:300])
        cons = [ln for ln in txt.splitlines() if re.search(r"consisten|of the last|days? done|scheduled day", ln, re.I)]
        st.read("consistency sentence", " | ".join(cons))
        pg.locator("[data-routine-block] [data-skip]").click(timeout=T)
        pg.wait_for_function("() => { const b = document.querySelector('[data-routine-block] [data-skip]'); return b && b.getAttribute('aria-pressed') === 'false' }", timeout=T)
        if not cons:
            raise Inconclusive("no consistency sentence was drawn: " + CALENDAR_WHY.format(today=today_et())
                               + " (the block reads 'Off day'); the skip itself was written and undone")
        st.check("the consistency sentence reads", True, " | ".join(cons))

    def s4(st):
        st.surface = "[data-routine-block]"
        ctx.set_offline(True)
        try:
            live = pg.locator("[data-routine-live]")
            pg.wait_for_function("() => { const l = document.querySelector('[data-routine-live]'); return l && /offline/i.test(l.textContent) }", timeout=T)
            said = st.read("offline sentence", live.inner_text())
            dis = [b.get_attribute("aria-disabled") for b in boxes(pg).all()]
            skip = pg.locator("[data-routine-block] [data-skip]").get_attribute("aria-disabled")
            st.read("controls", json.dumps({"items": dis, "skip": skip}))
            st.check("every control is disabled offline", all(x == "true" for x in dis) and skip == "true", json.dumps(dis))
            st.check("the offline sentence is said", "offline" in said.lower(), said)
            before = [b.get_attribute("aria-checked") for b in boxes(pg).all()]
            boxes(pg).nth(3).click(timeout=T, force=True)
            pg.wait_for_timeout(800)
            after = [b.get_attribute("aria-checked") for b in boxes(pg).all()]
            st.check("a press while offline changes nothing", before == after, f"{before} -> {after}")
        finally:
            ctx.set_offline(False)
        pg.wait_for_timeout(1500)

    def s5(st):
        e = goto_note(pg, base, S["n3"])
        slash(pg, e, "/track", pick=r"^Tracker \(one value a day\)")
        pk = picker(pg, "tracker")
        st.surface = "[role=dialog]"
        st.read("tracker picker", pk.inner_text())
        pk.get_by_role("button", name="New tracker").click(timeout=T)
        te = pg.get_by_role("dialog").filter(has_text="New tracker").last
        te.wait_for(timeout=T)
        te.get_by_label("Name", exact=True).fill("Sleep")
        te.get_by_label("Duration").check()
        if is_weekend_et():
            # A Sleep tracker logs every night; "Trading days" (the default) would refuse a weekend note's day.
            te.get_by_label("Any day").check()
            st.note("days it logs", "Any day (the walk runs on a weekend; the default Trading days refuses its day)")
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/trackers") and r.request.method == "POST", timeout=T) as resp:
            te.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the tracker was saved (HTTP 200/201)", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
        S["tracker_id"] = resp.value.json().get("id")
        inp = pg.get_by_label("Sleep (hours:minutes)", exact=True).last     # this tracker's own input
        blk = pg.locator("[data-tracker-block]").filter(has=inp).last
        inp.wait_for(timeout=T)
        st.surface = "[data-tracker-block]"
        st.read("input name", inp.get_attribute("aria-label") or "")
        inp.fill("7:30")
        with pg.expect_response(lambda r: "/api/j2/trackers/" in r.url and r.request.method in ("PUT", "POST"), timeout=T) as resp:
            inp.press("Enter")
        st.check("the value was logged (HTTP 200)", resp.value.status == 200, f"HTTP {resp.value.status}")
        blk.locator("[data-day-value]").wait_for(timeout=T)
        txt = st.read("tracker block", blk.inner_text())
        st.check("the block shows 7h 30m for the day", "7h 30m" in txt, txt[:300])
        slash(pg, e, "/track", pick=r"^Tracker \(one value a day\)")
        pk = picker(pg, "tracker")
        pk.get_by_role("button").filter(has_text="Check-in mood").first.click(timeout=T)
        ck = pg.locator("[data-tracker-block]").filter(has_text="come from your check-ins").first
        ck.wait_for(timeout=T)
        ctxt = st.read("check-in tracker", ck.inner_text())
        st.check("the check-in tracker is read-only (its line, no input)",
                 "Mood and focus come from your check-ins." in ctxt and ck.locator("[data-value-input], [data-value]").count() == 0, ctxt[:300])

    def s6(st):
        blk = pg.locator("[data-routine-block]")
        st.surface = "[data-routine-block]"
        settled = settle_note(S["n3"])          # the tracker inserts' own autosave lands first
        n_writes = len(note_writes(writes, S["n3"]))
        with pg.expect_response(lambda r: "/vs-pnl" in r.url, timeout=T) as resp:
            blk.locator("[data-pnl-flip]").click(timeout=T)
        st.check("the comparison was read (HTTP 200)", resp.value.status == 200, f"HTTP {resp.value.status}")
        pg.wait_for_timeout(800)
        txt = st.read("block, P&L side", blk.inner_text())
        st.check("it ends with the caveat", "A comparison, not proof." in txt, txt[:400])
        pg.wait_for_timeout(2500)
        st.check("the flip wrote nothing to the note", len(note_writes(writes, S["n3"])) == n_writes
                 and get_note(ctx, base, S["n3"]).get("updatedAt") == settled, json.dumps(writes[-3:]))
        blk.locator("[data-pnl-flip]").click(timeout=T)

    def s7(st):
        from zoneinfo import ZoneInfo
        blk = pg.locator("[data-routine-block]")
        blk.get_by_role("button", name="Routine options").click(timeout=T)
        pick_menu(pg, "Edit routine")
        ed = pg.get_by_role("dialog").filter(has_text="Remind me").last
        ed.wait_for(timeout=T)
        st.surface = "[role=dialog]"
        ed.locator("[data-field=reminder]").click(timeout=T)
        now = datetime.now(ZoneInfo("America/New_York"))
        mins = (now.hour * 60 + now.minute) // 5 * 5 + 5
        slot = f"{(mins // 60) % 24:02d}:{mins % 60:02d}"
        ed.get_by_label("Reminder time (ET)").select_option(value=slot)
        st.read("reminder lines", ed.locator("[data-field-box]").filter(has_text="Remind me").inner_text())
        with pg.expect_response(lambda r: "/api/j2/routines/" in r.url and r.request.method in ("PUT", "PATCH"), timeout=T) as resp:
            ed.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the reminder was saved (HTTP 200)", resp.value.status == 200, f"HTTP {resp.value.status} slot {slot}")
        S["reminder_slot"] = slot
        if is_weekend_et():
            alerts = ctx.request.get(base + "/api/alerts").json()
            st.read("bell items now", json.dumps(alerts)[:400])
            raise Inconclusive(f"a reminder has no slot on a non-session day (routine_reminders.slot_for), and today ({today_et()}) "
                               "is not a session: the bell item cannot fire here. The reminder was turned on for "
                               f"{slot} ET and saved; one bell item, then none, needs a weekday run")
        raise Inconclusive("waiting 5-10 minutes for the scheduler slot is not driven by this tool")

    def s8(st):
        e = goto_note(pg, base, S["n3"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        dlg.get_by_role("button", name="Start blank").click(timeout=T)
        dlg.get_by_role("radio", name="Routine history").click(timeout=T)
        said = wait_live(pg, "t => /routine history/i.test(t)")
        st.read("routine history preview", said)
        st.check("the preview reads routine history", "routine history" in said.lower(), said)
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/widget-definitions") and r.request.method == "POST", timeout=T) as resp:
            dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the routine history widget was saved", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
        dlg.wait_for(state="hidden", timeout=T)
        slash(pg, e, "/build")
        dlg = builder(pg)
        dlg.get_by_role("button", name="Start blank").click(timeout=T)
        dlg.get_by_role("radio", name="Trading days").click(timeout=T)
        wait_live(pg, "t => /trading days/i.test(t)")
        dlg.get_by_role("button", name=re.compile(r"split", re.I)).first.click(timeout=T)
        dlg.get_by_role("button", name="Routine done").click(timeout=T)
        dlg.get_by_role("button", name=re.compile(r"Pre-market routine")).first.click(timeout=T)
        said = wait_live(pg, "t => /routine/i.test(t)")
        st.read("trading days split by routine done", said)
        st.check("the preview splits trading days by the routine", "routine" in said.lower(), said)
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/widget-definitions") and r.request.method == "POST", timeout=T) as resp:
            dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the trading days widget was saved", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
        dlg.wait_for(state="hidden", timeout=T)
        pg.wait_for_timeout(1500)
        frames = pg.locator("[data-snapshot-frame]")
        st.read("placed widgets", " || ".join(frames.all_inner_texts())[:1500])
        st.check("both widgets are placed in the note", frames.count() >= 2, f"{frames.count()} frames")

    def tools_tab(kind: str):
        blk = pg.locator(f"[data-{kind}-block]").first
        blk.get_by_role("button", name=f"{kind.title()} options").click(timeout=T)
        pick_menu(pg, "Manage…")
        sheet = pg.get_by_role("dialog", name="My tools")
        sheet.wait_for(timeout=T)
        tab = sheet.locator(f"[data-testid=my-tools-{kind}s]")
        tab.wait_for(timeout=T)
        return sheet, tab

    def tool_row(tab, name):
        return tab.locator("[data-testid=my-tools-tool-row]").filter(has_text=name).first

    def s9(st):
        e = goto_note(pg, base, S["n3"])
        # a second tracker, made through the trackers door, to be deleted for good (the note keeps its own)
        r = ctx.request.post(base + "/api/j2/trackers", data={"name": "Walk scratch", "kind": "yesno", "settings": {"days": "any"}})
        st.note("scratch tracker (POST /api/j2/trackers)", r.status)
        sheet, tab = tools_tab("routine")
        st.surface = "[role=dialog]"
        st.read("Routines tab", tab.inner_text()[:600])
        row = tool_row(tab, "Pre-market routine")
        row.wait_for(timeout=T)
        row.get_by_role("button", name="Actions for Pre-market routine").click(timeout=T)
        pick_menu(pg, "Rename")
        rn = sheet.locator("[data-testid=my-tools-rename]")
        rn.get_by_label("Name", exact=True).fill("Pre-market (walk)")
        rn.get_by_role("button", name="Save name").click(timeout=T)
        st.check("the routine was renamed", True, st.read("message", wait_msg(pg, "Renamed|renamed")))
        row = tool_row(tab, "Pre-market (walk)")
        row.wait_for(timeout=T)
        row.get_by_role("button", name="Actions for Pre-market (walk)").click(timeout=T)
        pick_menu(pg, "Archive")
        confirm_archive(sheet)
        st.check("the routine was archived", True, st.read("message", wait_msg(pg, "rchiv")))
        tab.get_by_role("button", name="Archived", exact=True).click(timeout=T)
        row = tool_row(tab, "Pre-market (walk)")
        row.wait_for(timeout=T)
        prim = row.get_by_role("button", name="Restore Pre-market (walk)")
        if prim.count() and prim.first.is_visible():
            prim.first.click(timeout=T)
        else:
            row.get_by_role("button", name="Actions for Pre-market (walk)").click(timeout=T)
            pick_menu(pg, "Restore")
        st.check("the routine was restored", True, st.read("message", wait_msg(pg, "estor")))
        sheet.get_by_role("tab", name="Trackers").click(timeout=T)
        tab = sheet.locator("[data-testid=my-tools-trackers]")
        tab.wait_for(timeout=T)
        st.read("Trackers tab", tab.inner_text()[:600])
        row = tool_row(tab, "Sleep")
        row.wait_for(timeout=T)
        row.get_by_role("button", name="Actions for Sleep").click(timeout=T)
        pick_menu(pg, "Rename")
        rn = sheet.locator("[data-testid=my-tools-rename]")
        rn.get_by_label("Name", exact=True).fill("Sleep hours")
        rn.get_by_role("button", name="Save name").click(timeout=T)
        st.check("the tracker was renamed", True, st.read("message", wait_msg(pg, "Renamed|renamed")))
        row = tool_row(tab, "Walk scratch")
        row.wait_for(timeout=T)
        row.get_by_role("button", name="Actions for Walk scratch").click(timeout=T)
        pick_menu(pg, "Archive")
        confirm_archive(sheet)
        wait_msg(pg, "rchiv")
        tab.get_by_role("button", name="Archived", exact=True).click(timeout=T)
        row = tool_row(tab, "Walk scratch")
        row.wait_for(timeout=T)
        row.get_by_role("button", name="Actions for Walk scratch").click(timeout=T)
        pick_menu(pg, "Delete permanently")
        dp = sheet.locator("[data-testid=my-tools-delete]")
        dp.wait_for(timeout=T)
        st.read("delete question", dp.inner_text())
        dp.locator("[data-testid=delete-typed-name]").fill("Walk scratch")
        dp.get_by_role("button", name="Delete permanently").click(timeout=T)
        st.check("the archived tracker was deleted permanently (to Recently deleted)", True,
                 st.read("message", wait_msg(pg, "Recently deleted")))
        tab.get_by_role("button", name="Recently deleted", exact=True).click(timeout=T)
        tool_row(tab, "Walk scratch").wait_for(timeout=T)
        st.check("it is listed under Recently deleted", True, "Walk scratch")
        close_sheet(pg, sheet)

    def s10(st):
        goto_note(pg, base, S["n3"])
        n_blocks = pg.locator("[data-routine-block], [data-tracker-block]").count()
        st.read("blocks in the note", str(n_blocks))
        pg.get_by_role("button", name="Share", exact=True).click(timeout=T)
        sh = pg.get_by_role("dialog", name="Share this note")
        sh.get_by_role("button", name="Create link", exact=True).click(timeout=T)
        url = sh.get_by_label("Share link address").input_value(timeout=T)
        S["share_url_n3"] = url
        pg.keyboard.press("Escape")
        pub = browser.new_context(viewport={"width": VIEWPORTS[vp][0], "height": VIEWPORTS[vp][1]})
        try:
            pp = pub.new_page()
            pw = Watch(pp)
            pp.goto(url, wait_until="domcontentloaded", timeout=60000)
            pp.get_by_text(ACCOUNT_LINE).first.wait_for(timeout=T)
            ptxt = st.read("public page", pp.locator("body").inner_text())
            k = ptxt.count(ACCOUNT_LINE)
            runs = private_runs(get_note(ctx, base, S["n3"]))
            api = pub.request.get(url.replace("/share/n/", "/api/j2/shared/")).json()
            left = [x.get("widgetId") for x in embeds(api.get("note") or {}) if x.get("widgetId") in ("routine", "tracker")]
            st.read("public payload", json.dumps([n.get("type") for n in ((api.get("note") or {}).get("bodyJson") or {}).get("content", [])]))
            st.check("no routine or tracker block reaches the public page", not left and n_blocks >= 3, json.dumps(left))
            st.check("the account line stands in for them (adjacent private items share one line, by design)",
                     k == runs and k >= 1, f"{k} account lines for {runs} run(s) of adjacent private items ({n_blocks} blocks)")
            leaks = [x for x in ("Pre-market routine", "Sleep", "7h 30m", "Read the morning wire") if x in ptxt]
            st.check("no routine or tracker name, item or value on the public page", not leaks, json.dumps(leaks))
            shot = OUT / vp / "W9_10-public.png"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pp.screenshot(path=str(shot), full_page=True)
            st.row.setdefault("screenshots", []).append(str(shot.relative_to(OUT)).replace("\\", "/"))
            st.note("public page events", pw.take())
        finally:
            pub.close()

    def s11(st):
        e = goto_note(pg, base, S["n3"])
        slash(pg, e, "/track", pick=r"^Tracker \(one value a day\)")
        pk = picker(pg, "tracker")
        pk.get_by_role("button", name="New tracker").click(timeout=T)
        te = pg.get_by_role("dialog").filter(has_text="New tracker").last
        te.get_by_label("Name", exact=True).fill("Screen time")
        te.get_by_label("Number").check()
        te.get_by_label("Unit").fill("min")
        if is_weekend_et():
            te.get_by_label("Any day").check()
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/trackers") and r.request.method == "POST", timeout=T):
            te.get_by_role("button", name="Save", exact=True).click(timeout=T)
        blk = pg.locator("[data-tracker-block]").filter(has_text="min").filter(has=pg.locator("[data-value-input]")).last
        inp = blk.locator("[data-value-input]")
        inp.wait_for(timeout=T)
        inp.scroll_into_view_if_needed()
        inp.click()
        wd, hh = VIEWPORTS[vp]
        pg.set_viewport_size({"width": wd, "height": int(hh * 0.55)})
        try:
            pg.wait_for_timeout(700)
            inp.scroll_into_view_if_needed()
            pg.keyboard.type("45", delay=40)
            box = inp.bounding_box()
            vh = pg.evaluate("() => window.visualViewport ? window.visualViewport.height : window.innerHeight")
            st.read("input box / visual viewport", json.dumps({"box": box, "visualViewport": vh}))
            st.check("the number input is on screen with the keyboard open",
                     bool(box) and box["y"] >= 0 and box["y"] + box["height"] <= vh + 1, json.dumps(box))
            st.check("what was typed is in the input", inp.input_value() == "45", inp.input_value())
            ov = pg.evaluate(OVERFLOW_JS)
            st.check("no horizontal page scroll with the keyboard open", not ov.get("horizontal"), json.dumps(ov)[:300])
            st.row["metrics_keyboard_open"] = metrics(pg, vp, "[data-tracker-block]")
            shot = OUT / vp / "W9_11-keyboard.png"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(shot))
            st.row.setdefault("screenshots", []).append(str(shot.relative_to(OUT)).replace("\\", "/"))
            with pg.expect_response(lambda r: "/api/j2/trackers/" in r.url and r.request.method in ("PUT", "POST"), timeout=T) as resp:
                inp.press("Enter")
            st.check("Enter logs the value", resp.value.status == 200, f"HTTP {resp.value.status}")
        finally:
            pg.set_viewport_size({"width": wd, "height": hh})

    steps = [("W9.1", "/routine: New routine from the Pre-market starter, tick two items, reload: no unsaved change, both ticks there", s1),
             ("W9.2", "the same note in a second tab, tick a third item: both tabs show all three", s2),
             ("W9.3", "skip a day and read the consistency sentence", s3),
             ("W9.4", "go offline: controls disabled with the offline sentence", s4),
             ("W9.5", "/track: Sleep (duration), log 7:30; open a check-in tracker read-only", s5),
             ("W9.6", "flip 'P&L on days you finished it' on a member with trades", s6),
             ("W9.7", "reminder on for the next 5-minute slot: one bell item, then none at the next slot", s7),
             ("W9.8", "build a widget over Routine history and over Trading days split by 'routine done'", s8),
             ("W9.9", "My tools: Routines and Trackers tabs, rename, archive, restore, delete permanently", s9),
             ("W9.10", "share the note, open the link in a private window: the account line in place of each block", s10)]
    if vp == "390":
        steps.append(("W9.11", "at 390 px also with the keyboard open in a number tracker's input", s11))
    try:
        for sid, title, fn in steps:
            run_step(vp, sid, title, fn, pages)
        S["n3_body"] = json.dumps(get_note(ctx, base, S["n3"]).get("bodyJson"), sort_keys=True)
        S["n3_updated"] = get_note(ctx, base, S["n3"]).get("updatedAt")
    finally:
        ctx.close()
        flush()


def wave9_off(browser, base: str, vp: str) -> None:
    S = STATE[vp]
    ctx = signed_in(browser, base, vp)
    pg, w = open_page(ctx, base, "/journal/notebook")
    writes: list[str] = []
    ctx.on("request", lambda r: r.method in ("PUT", "PATCH", "POST") and "/api/j2/notes/" in r.url
           and writes.append(f"{r.method} {r.url}"))

    def s(st):
        me = ctx.request.get(base + "/api/auth/me").json()
        st.read("wave 9 on /api/auth/me", str(me.get("notebook_widgets_w9_enabled")))
        st.check("the sandbox serves wave 9 off", me.get("notebook_widgets_w9_enabled") is False,
                 str(me.get("notebook_widgets_w9_enabled")))
        goto_note(pg, base, S["n3"])
        blocks = pg.locator("[data-widget-embed-view], [role=group]").filter(has_text=re.compile(r"^(Routine|Tracker)"))
        pg.get_by_text(FLAG_OFF_LINE).first.wait_for(timeout=T)
        render_all(pg)
        txt = st.read("note body", pg.locator(".ProseMirror").first.inner_text())
        n_off = txt.count(FLAG_OFF_LINE)
        st.check("each routine and tracker block says 'Not available right now.'", n_off >= 3, f"{n_off} blocks say it")
        st.check("no tick, value or skip control is drawn", pg.locator("[data-routine-block] [role=checkbox], [data-value-input]").count() == 0,
                 str(pg.locator("[data-routine-block] [role=checkbox], [data-value-input]").count()))
        st.check("the opening wrote nothing to the note", not note_writes(writes, S["n3"]), json.dumps(writes[:5]))
        body = json.dumps(get_note(ctx, base, S["n3"]).get("bodyJson"), sort_keys=True)
        st.check("nothing else in the note changed (its body is byte-identical)", body == S.get("n3_body"),
                 f"same={body == S.get('n3_body')}")
        st.check("the widgets placed beside the blocks still draw", pg.locator("[data-snapshot-frame]").count() >= 2,
                 str(pg.locator("[data-snapshot-frame]").count()))

    try:
        run_step(vp, "W9.12", "set NOTEBOOK_WIDGETS_W9_ENABLED=0, reload: each block says 'Not available right now.', nothing else changes",
                 s, {"main": (pg, w)})
    finally:
        ctx.close()
        flush()


# ── wave 10 (Task 10.22 Step 1) ───────────────────────────────────────────────────────────

DEDICATED = ["Tilt check", "Revenge trades", "Risk left today", "Prop-firm rules", "Pre-market game plan",
             "Alerts that fired", "Plan vs actual"]
SIZE_DESC = "Shares for your entry, stop and risk"
EQUITY_R1_DESC = "Net P&L day by day over the last 90 days."
EQUITY_R2_DESC = "Your running net P&L over the last 90 days, with each drawdown shaded."


def older_note(ctx, base: str, vp: str) -> None:
    """The "older note": a note holding the firm's Equity curve as a wave 8 note held it -- a shelf placement
    with NO `defRev` (wave 8 had only revision 1, so ruling W10-R5 reads it as revision 1). No member door
    places a shelf example while wave 10 is dark, so the note is written through the product's own doors:
    revision 1's payload from POST /widget-definitions/run (`defRev: 1`), placed in a widgetEmbed shaped
    like the member's own placement in their first note, with `defRev` removed, through POST /notes.
    Setup, recorded INFO, never a verdict."""
    S = STATE[vp]
    if S.get("n_old"):
        return
    rec = {"viewport": vp, "what": "older note: Equity curve as a wave 8 placement (no defRev), via /run defRev 1 + POST /notes"}
    try:
        r = ctx.request.post(base + "/api/j2/widget-definitions/run", data={"defId": "shelf:equity-curve", "defRev": 1})
        payload = r.json() if r.ok else {}
        payload = payload.get("payload", payload)
        params = {k: v for k, v in payload.items() if k not in ("defRev", "latestRev")}
        params["share"] = False
        tmpl = next(iter(embeds(get_note(ctx, base, S["n1"]), "builtWidget")), None) if S.get("n1") else None
        attrs = {k: v for k, v in (tmpl or {}).items() if k not in ("params", "fallback")}
        attrs.update({"widgetId": "builtWidget", "mode": "snapshot", "fallback": None, "params": params,
                      "capturedAt": attrs.get("capturedAt") or datetime.now(timezone.utc).isoformat()})
        body = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "Placed before wave 10."}]},
            {"type": "widgetEmbed", "attrs": attrs}, {"type": "paragraph"}]}
        n = ctx.request.post(base + "/api/j2/notes", data={"title": f"Older note {vp}", "bodyJson": body})
        nid = (n.json().get("note") or {}).get("id") if n.ok else None
        rec.update({"run": r.status, "run_defRev": payload.get("defRev"), "latestRev": payload.get("latestRev"),
                    "note": n.status, "summary": params.get("summary"),
                    "verdict": "INFO" if nid and payload.get("defRev") == 1 else "SETUP FAILED"})
        if nid and payload.get("defRev") == 1:
            S["n_old"] = nid
    except Exception as e:  # noqa: BLE001
        rec.update({"verdict": "SETUP FAILED", "error": f"{type(e).__name__}: {str(e)[:300]}"})
    finally:
        REC["setup"].append(rec)
        flush()


def wave10(browser, base: str, vp: str) -> None:
    S = STATE[vp]
    ctx = signed_in(browser, base, vp)
    if not S.get("n4"):
        S["n4"] = make_note(ctx, base, f"Formulas and ready-made widgets {vp}", ("This week's review.",))
    pg, w = open_page(ctx, base, f"/journal/notebook?note={S['n4']}")
    pages = {"main": (pg, w)}
    writes: list[str] = []
    ctx.on("request", lambda r: r.method in ("PUT", "PATCH", "POST") and "/api/j2/notes/" in r.url
           and writes.append(f"{r.method} {r.url}"))

    # Seeds for this wave, through the product's own doors (recorded INFO).
    older_note(ctx, base, vp)
    if not S.get("w10_seeded"):
        seed: dict = {"viewport": vp, "what": "wave 10 seeds", "verdict": "INFO"}
        r = ctx.request.post(base + "/api/j2/trades", data={
            "symbol": "META", "side": "Long", "shares": 50, "entryPrice": 200, "entryDate": SESSIONS[2],
            "exitPrice": 204, "exitDate": SESSIONS[2], "accountId": S.get("default_account")})
        seed["trade_without_stop"] = r.status
        legs = []
        for i, (typ, d, ct, ep, xp, und) in enumerate([("long_call", "bullish", "call", 2.0, 3.5, "SPY"),
                                                       ("long_call", "bullish", "call", 1.5, 1.0, "QQQ"),
                                                       ("long_put", "bearish", "put", 2.2, 3.0, "IWM")]):
            r = ctx.request.post(base + "/api/j2/options", data={
                "underlying": und, "strategy_type": typ, "direction": d, "entry_date": SESSIONS[1],
                "accountId": S.get("default_account"),
                "legs": [{"side": "buy", "contract_type": ct, "strike": 500, "expiration": "2026-12-18", "qty": 1,
                          "entry_price": ep}]})
            sid = r.json().get("id") if r.ok else None
            r2 = ctx.request.post(base + f"/api/j2/options/{sid}/close", data={"exitPrices": {"0": xp}, "exitDate": SESSIONS[3]})
            legs.append((r.status, r2.status))
        seed["options"] = legs
        r = ctx.request.post(base + "/api/j2/property-defs", data={"name": "Conviction", "type": "number"})
        pid = (r.json().get("propertyDef") or {}).get("id") if r.ok else None
        S["conviction"] = pid
        ideas = []
        for i, v in enumerate([3, 5, 8]):
            nid = make_note(ctx, base, f"Idea {i + 1} ({vp})", ("A trade idea.",))
            r = ctx.request.put(base + f"/api/j2/notes/{nid}", data={"properties": {pid: v}})
            ideas.append(r.status)
        seed["conviction_notes"] = ideas
        plan = ctx.request.post(base + "/api/j2/notes", data={"title": f"TSLA plan ({vp})", "ticker": "TSLA", "bodyJson": {
            "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": t}]}
                                       for t in ("Entry: 100", "Stop: 98", "Target: 106", "Shares: 100")]}}).json()["note"]
        tsla = S["trade_ids"][4] if S.get("trade_ids") else None
        r = ctx.request.post(base + f"/api/j2/plan-grades/trades/{tsla}/relink", data={"noteId": plan["id"]})
        seed["tsla_linked_to_plan"] = r.status
        REC["setup"].append(seed)
        S["w10_seeded"] = True
        flush()

    def formula_field(dlg, n: int = 0):
        return dlg.locator("[data-testid=formula-field]").nth(n)

    def s1(st):
        e = goto_note(pg, base, S["n4"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        dlg.get_by_role("button", name="Start blank").click(timeout=T)
        dlg.get_by_role("radio", name="Closed trades").click(timeout=T)
        dlg.get_by_role("button", name="Add your own field").click(timeout=T)
        f = formula_field(dlg)
        f.wait_for(timeout=T)
        f.get_by_label("Name", exact=True).fill("Return on risk")
        box = f.get_by_label("Formula", exact=True)
        box.click()
        pg.keyboard.type("[Net", delay=50)
        sug = dlg.get_by_role("listbox", name="Suggestions")
        sug.wait_for(timeout=T)
        st.read("autocomplete after [Net", sug.inner_text())
        st.check("autocomplete offers Net P&L", "Net P&L" in sug.inner_text(), sug.inner_text())
        pg.keyboard.press("Enter")
        pg.keyboard.type(" / [Risk", delay=50)
        sug.wait_for(timeout=T)
        st.read("autocomplete after [Risk", sug.inner_text())
        pg.keyboard.press("Enter")
        st.check("the box reads the label syntax", box.input_value() == "[Net P&L] / [Risk $]", box.input_value())
        first = f.get_by_text(re.compile(r"^First trade: "))
        first.wait_for(timeout=T)
        st.read("first-row line", first.inner_text())
        st.check("the first-row line shows", True, first.inner_text())
        notice = f.locator("[class*=coverage]")
        ntxt = notice.first.inner_text() if notice.count() else ""
        st.read("skip notice", ntxt)
        st.check("the skip notice names the trade left out (no Risk $)", bool(ntxt) and re.search(r"\d", ntxt) is not None, ntxt)
        f.get_by_role("button", name="Average", exact=True).click(timeout=T)
        said = wait_live(pg, "t => /Return on risk/.test(t)")
        st.read("summary", said)
        st.check("the widget measures Return on risk as an average", "Return on risk (average)" in said, said)
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/widget-definitions") and r.request.method == "POST", timeout=T) as resp:
            dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the widget was saved", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
        body = resp.value.json()
        d = body.get("definition") or body
        S["formula_def"] = d.get("id")
        st.read("saved plan", json.dumps((d.get("plan") or {}).get("formulas"))[:300])
        dlg.wait_for(state="hidden", timeout=T)
        frame = pg.locator("[data-snapshot-frame]").filter(has_text="Return on risk").first
        frame.wait_for(timeout=T)
        st.check("the formula widget is placed in the note", True, frame.inner_text()[:200])

    def s2(st):
        e = goto_note(pg, base, S["n4"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        dlg.get_by_role("button", name="Start blank").click(timeout=T)
        dlg.get_by_role("button", name="Add your own field").click(timeout=T)
        f = formula_field(dlg)
        f.get_by_label("Name", exact=True).fill("Winner")
        box = f.get_by_label("Formula", exact=True)
        box.click()
        pg.keyboard.type("If([net] > 0, 1", delay=40)
        err = f.locator("[class*=error]")
        err.first.wait_for(timeout=T)
        s1_ = st.read("inline sentence", err.first.inner_text())
        st.check("an inline sentence says what is wrong, without a request", "missing" in s1_.lower() or ")" in s1_, s1_)
        pg.keyboard.press("End")
        pg.keyboard.type(", 0)", delay=40)
        f.get_by_text(re.compile(r"^First trade: ")).wait_for(timeout=T)
        st.check("fixed with the keyboard only, the formula is valid", box.input_value() == "If([net] > 0, 1, 0)"
                 and f.locator("[class*=error]").count() == 0, box.input_value())
        st.check("focus stayed in the Formula box throughout",
                 pg.evaluate("() => document.activeElement && document.activeElement.tagName") == "TEXTAREA", "")
        dlg.get_by_role("button", name="Close", exact=True).first.click(timeout=T)
        for lbl in ("Discard", "Discard changes", "Close without saving", "Don't save"):
            b = pg.get_by_role("button", name=lbl, exact=True)
            if b.count():
                b.first.click()
                break

    def s3(st):
        e = goto_note(pg, base, S["n4"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        dlg.get_by_role("button", name="Start blank").click(timeout=T)
        dlg.get_by_role("radio", name="Options strategies").click(timeout=T)
        wait_live(pg, "t => /options strateg/i.test(t)")
        dlg.get_by_role("button", name=re.compile(r"split", re.I)).first.click(timeout=T)
        dlg.get_by_role("button", name="Strategy", exact=True).click(timeout=T)
        said = wait_live(pg, "t => /strategy/i.test(t)")
        st.read("options preview summary", said)
        prev = preview_text(pg, dlg)
        st.read("options preview", prev)
        st.check("options strategies split by Strategy", "split by strategy" in said.lower(), said)
        st.check("the preview counts the 3 strategies", "3 strateg" in said.lower(), said)
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/widget-definitions") and r.request.method == "POST", timeout=T) as resp:
            dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the options widget was saved", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
        dlg.wait_for(state="hidden", timeout=T)
        slash(pg, e, "/build")
        dlg = builder(pg)
        dlg.get_by_role("button", name="Start blank").click(timeout=T)
        dlg.get_by_role("radio", name="Notes").click(timeout=T)
        wait_live(pg, "t => /notes/i.test(t)")
        st.read("notes source, the coverage switch", dlg.get_by_text(re.compile(r"^Show how many")).first.inner_text())
        dlg.get_by_role("button", name="Filter", exact=True).click(timeout=T)
        dlg.get_by_role("button", name="Property", exact=True).click(timeout=T)
        dlg.get_by_role("button", name=re.compile(r"^Conviction")).first.click(timeout=T)
        dlg.get_by_label("Comparison", exact=True).select_option(label="Conviction is at least")
        dlg.get_by_label("Value", exact=True).fill("5")
        dlg.get_by_role("button", name="Add filter").click(timeout=T)
        said = wait_live(pg, "t => /property/i.test(t)")
        st.read("notes filtered", said)
        dlg.get_by_role("button", name=re.compile(r"Change measures")).click(timeout=T)
        dlg.get_by_role("button", name="Sum of a property").click(timeout=T)
        dlg.get_by_role("button", name=re.compile(r"^Conviction")).first.click(timeout=T)
        done = dlg.get_by_role("button", name="Done", exact=True)
        if done.count() and done.first.is_visible():
            done.first.click(timeout=T)
        said = wait_live(pg, "t => /Sum of/.test(t)")
        st.read("notes summed", said)
        prev = preview_text(pg, dlg)
        st.read("notes preview", prev)
        st.check("notes filtered by the property, the property summed", "filtered by property" in said and "Sum of" in said
                 and "2 notes" in said, said)
        st.note("the summed measure's label (does it name the property?)", said)
        st.check("the sum is 13 (5 + 8)", "13" in prev, prev[:300])
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/widget-definitions") and r.request.method == "POST", timeout=T) as resp:
            dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
        st.check("the notes widget was saved", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
        dlg.wait_for(state="hidden", timeout=T)

    def s4(st):
        if not S.get("n_old"):
            raise Inconclusive("the older note could not be written (see setup)")
        goto_note(pg, base, S["n_old"])
        emb = embed_in(pg, "Equity curve")
        emb.wait_for(timeout=T)
        before = st.read("Equity curve r1, as placed", emb.inner_text())
        p0 = (embeds(get_note(ctx, base, S["n_old"]), "builtWidget") or [{}])[0].get("params") or {}
        st.read("placement", json.dumps({k: p0.get(k) for k in ("defId", "defRev", "latestRev")}))
        emb.get_by_role("button", name="More for this widget").click(timeout=T)
        menu = pg.locator("[data-testid=built-menu]")
        upd = menu.get_by_role("button", name="Updated version available")
        upd.wait_for(timeout=T)
        st.check("the menu says an updated version is available", True, menu.inner_text())
        upd.click(timeout=T)
        how = pg.get_by_role("dialog", name="How this is made")
        how.wait_for(timeout=T)
        st.surface = "[role=dialog]"
        cmp_ = how.get_by_role("region", name="Updated version available")
        txt = st.read("compare", how.inner_text())
        st.check("it compares this note's version with the update", "In this note" in txt and "Updated" in txt, txt[:400])
        with pg.expect_response(lambda r: "/api/j2/widget-definitions/run" in r.url, timeout=T) as resp:
            how.get_by_role("button", name="Use the updated version").click(timeout=T)
        st.check("the update re-ran the widget (HTTP 200)", resp.value.status == 200, f"HTTP {resp.value.status}")
        how.wait_for(state="hidden", timeout=T)
        pg.wait_for_timeout(1500)
        after = st.read("Equity curve after the update", emb.inner_text())
        p1 = poll(lambda: (lambda p: p if p.get("defRev") and p.get("defRev") != p0.get("defRev") else None)(
            (embeds(get_note(ctx, base, S["n_old"]), "builtWidget") or [{}])[0].get("params") or {}), 30, 0.5) or {}
        st.read("placement after", json.dumps({k: p1.get(k) for k in ("defId", "defRev", "drawdown")})[:400])
        st.check("the placement moved to the newer revision", (p1.get("defRev") or 0) >= 2, str(p1.get("defRev")))
        band = emb.locator("[data-testid*=drawdown], [class*=drawdown], pattern")
        st.check("the curve is a running total with the drawdown band (its legend or band is drawn)",
                 band.count() > 0 or "drawdown" in after.lower(), f"band elements {band.count()}; text: {after[:200]}")

    def s5(st):
        e = goto_note(pg, base, S["n4"])
        for name in DEDICATED:
            slash(pg, e, "/" + name)
            if name == "Plan vs actual":
                lb = pg.get_by_role("listbox", name="Insert block").last
                lb.get_by_role("option").filter(has_text="TSLA").first.click(timeout=T)
            pg.wait_for_timeout(1500)
        for name in DEDICATED:
            embed_in(pg, name).wait_for(timeout=T)
        st.check("the seven ready-made widgets are placed", all(embed_in(pg, n).count() for n in DEDICATED),
                 json.dumps({n: embed_in(pg, n).count() for n in DEDICATED}))
        for name in DEDICATED:
            st.read(name, embed_in(pg, name).inner_text()[:600])
        # Prop-firm limits in Change
        pf = embed_in(pg, "Prop-firm rules")
        pf.get_by_role("button", name="Change").click(timeout=T)
        form = pf.get_by_role("form", name="Change this widget")
        form.wait_for(timeout=T)
        form.get_by_label("Daily loss limit ($)").fill("500")
        form.get_by_label("Max drawdown ($)").fill("2000")
        form.get_by_label("Challenge started").fill("2026-10-01")
        with pg.expect_response(lambda r: "/notebook-shelf-widgets/myPropFirm" in r.url, timeout=T) as resp:
            form.get_by_role("button", name="Show these").click(timeout=T)
        st.check("prop-firm limits re-ran it in the request body (HTTP 200)", resp.value.status == 200
                 and "dailyLoss" not in resp.value.url, f"HTTP {resp.value.status} {resp.value.url[-60:]}")
        pg.wait_for_timeout(1000)
        ptxt = st.read("prop-firm after Change", pf.inner_text())
        st.check("the prop-firm widget reads room left under the limits", "Enter your daily loss limit" not in ptxt, ptxt[:300])
        pva = embed_in(pg, "Plan vs actual")
        ltxt = st.read("plan vs actual, linked (TSLA)", pva.inner_text())
        st.check("Plan vs actual on the linked trade reads planned vs filled", "Planned" in ltxt and "TSLA" in ltxt, ltxt[:300])
        slash(pg, e, "/Plan vs actual")
        lb = pg.get_by_role("listbox", name="Insert block").last
        lb.get_by_role("option").filter(has_text="AAPL").first.click(timeout=T)
        pg.wait_for_timeout(2000)
        un = pg.locator("[data-snapshot-frame]").filter(has_text="AAPL").filter(has_text="Plan vs actual").first
        un.wait_for(timeout=T)
        utxt = st.read("plan vs actual, unlinked (AAPL)", un.inner_text())
        st.check("Plan vs actual on an unlinked trade says it is not linked", "isn't linked to a plan" in utxt, utxt[:300])
        left = pg.locator(".ProseMirror").first.inner_text()
        st.check("no slash text is left behind in the note", "/actual" not in left and "/Plan" not in left, "")

    def s6(st):
        e = goto_note(pg, base, S["n4"])
        slash(pg, e, "/size", pick=re.escape(SIZE_DESC))
        blk = pg.locator("[role=group]").filter(has=pg.get_by_label("Risk per trade (%)")).last
        blk.get_by_label("Entry", exact=True).wait_for(timeout=T)
        st.surface = None
        blk.get_by_label("Symbol", exact=True).fill("NVDA")
        blk.get_by_label("Entry", exact=True).fill("50")
        blk.get_by_label("Stop", exact=True).fill("48")
        blk.get_by_label("Risk per trade (%)").fill("1")
        pg.wait_for_timeout(1200)
        t0 = st.read("before an account size", blk.inner_text())
        acct = blk.get_by_label("Account size for this note")
        if "Set your account size, or enter one for this note." in t0:
            st.check("an unset account size is said, and the note's own size is offered",
                     acct.count() == 1, t0[:300])
        else:
            st.note("the account carries its own size", t0[:200])
        if acct.count():
            acct.fill("10000")
        pg.wait_for_timeout(1000)
        t1 = st.read("long", blk.inner_text())
        st.check("a long: 50 shares, $100 at risk", "50 shares of NVDA, $100 at risk" in t1, t1[:300])
        blk.get_by_label("Entry", exact=True).fill("48")
        blk.get_by_label("Stop", exact=True).fill("50")
        pg.wait_for_timeout(1000)
        t2 = st.read("short", blk.inner_text())
        st.check("a short (stop above entry) sizes too", "50 shares of NVDA" in t2, t2[:300])
        blk.get_by_label("Stop", exact=True).fill("48")
        pg.wait_for_timeout(1000)
        t3 = st.read("stop equal to entry", blk.inner_text())
        st.check("a stop equal to entry is refused in words", "Entry and stop can't be the same." in t3, t3[:300])
        blk.get_by_label("Stop", exact=True).fill("49")
        pg.wait_for_timeout(800)

    def s7(st):
        e = goto_note(pg, base, S["n4"])
        # a notes list widget, shared
        slash(pg, e, "/build")
        dlg = builder(pg)
        dlg.get_by_role("button", name="Start blank").click(timeout=T)
        dlg.get_by_role("radio", name="Notes").click(timeout=T)
        dlg.get_by_role("radio", name="List").check(timeout=T, force=True)
        nm = dlg.get_by_label("Name", exact=True)
        nm.fill("My notes list")
        wait_live(pg, "t => /notes/i.test(t)")
        with pg.expect_response(lambda r: r.url.endswith("/api/j2/widget-definitions") and r.request.method == "POST", timeout=T):
            dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
        dlg.wait_for(state="hidden", timeout=T)
        lst = embed_in(pg, "My notes list")
        lst.wait_for(timeout=T)
        lst.get_by_role("switch").click(timeout=T)
        pg.wait_for_timeout(1500)
        in_editor = st.read("the shared notes list, in the editor (what the archive image is drawn from)", lst.inner_text())
        fb = poll(lambda: next((x.get("fallback") for x in embeds(get_note(ctx, base, S["n4"]), "builtWidget")
                                if (x.get("params") or {}).get("title") == "My notes list" and x.get("fallback")), None), 40, 1.0)
        st.note("archive of the shared notes list", fb)
        pg.get_by_role("button", name="Share", exact=True).click(timeout=T)
        sh = pg.get_by_role("dialog", name="Share this note")
        sh.get_by_role("button", name="Create link", exact=True).click(timeout=T)
        url = sh.get_by_label("Share link address").input_value(timeout=T)
        S["share_url_n4"] = url
        pg.keyboard.press("Escape")
        pub = browser.new_context(viewport={"width": VIEWPORTS[vp][0], "height": VIEWPORTS[vp][1]})
        try:
            pp = pub.new_page()
            pw = Watch(pp)
            pp.goto(url, wait_until="domcontentloaded", timeout=60000)
            pp.get_by_text(ACCOUNT_LINE).first.wait_for(timeout=T)
            ptxt = st.read("public page", pp.locator("body").inner_text())
            k = ptxt.count(ACCOUNT_LINE)
            api = pub.request.get(url.replace("/share/n/", "/api/j2/shared/")).json()
            runs = private_runs(get_note(ctx, base, S["n4"]))
            left = [x.get("widgetId") for x in embeds(api.get("note") or {}) if x.get("widgetId") in DEDICATED_IDS]
            st.read("public payload", json.dumps([n.get("type") for n in ((api.get("note") or {}).get("bodyJson") or {}).get("content", [])]))
            st.check("no ready-made widget or calculator reaches the public page", not left, json.dumps(left))
            st.check("the account line stands in for them (adjacent private items share one line, by design)",
                     k == runs and k >= 1, f"{k} account lines for {runs} run(s) of adjacent private items")
            lists = [x for x in embeds(api.get("note") or {}, "builtWidget") if (x.get("params") or {}).get("title") == "My notes list"]
            rows = ((lists[0].get("params") or {}).get("rows") or []) if lists else []
            labels = [r.get("label") for r in rows]
            st.read("shared notes list rows (public payload)", json.dumps(labels))
            st.check("the shared notes list reads 'Note 1…' in the public payload", bool(labels) and labels[0] == "Note 1", json.dumps(labels[:4]))
            titles_in_editor = [t for t in ("Idea 1", "Idea 2", "Idea 3", "Widgets walk") if t in in_editor]
            st.check("the shared notes list in the editor (the archive image's source) reads 'Note 1…', not titles",
                     "Note 1" in in_editor and not titles_in_editor, f"titles drawn: {titles_in_editor}")
            imgs = pp.get_by_role("img").all()
            st.read("public images", json.dumps([i.get_attribute("alt") for i in imgs]))
            if fb and fb.get("url"):
                got = ctx.request.get(base + fb["url"])
                if got.ok:
                    dest = OUT / vp / "W10_7-notes-list-archive.png"
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_bytes(got.body())
                    st.row.setdefault("screenshots", []).append(str(dest.relative_to(OUT)).replace("\\", "/"))
            shot = OUT / vp / "W10_7-public.png"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pp.screenshot(path=str(shot), full_page=True)
            st.row.setdefault("screenshots", []).append(str(shot.relative_to(OUT)).replace("\\", "/"))
            st.note("public page events", pw.take())
        finally:
            pub.close()

    def s8(st):
        e = goto_note(pg, base, S["n4"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        st.surface = "[role=dialog]"
        dlg.get_by_role("button", name="Start blank").click(timeout=T)
        dlg.get_by_role("button", name="Add your own field").click(timeout=T)
        f = formula_field(dlg)
        box = f.get_by_label("Formula", exact=True)
        box.scroll_into_view_if_needed()
        box.click()
        wd, hh = VIEWPORTS[vp]
        pg.set_viewport_size({"width": wd, "height": int(hh * 0.55)})
        try:
            pg.wait_for_timeout(700)
            pg.keyboard.type("[Net", delay=50)
            sug = dlg.get_by_role("listbox", name="Suggestions")
            sug.wait_for(timeout=T)
            vh = pg.evaluate("() => window.visualViewport ? window.visualViewport.height : window.innerHeight")
            sb, bb = sug.bounding_box(), box.bounding_box()
            st.read("suggestions / box / visual viewport", json.dumps({"suggestions": sb, "box": bb, "visualViewport": vh}))
            st.check("autocomplete stays above the keyboard (inside the visual viewport)",
                     bool(sb) and sb["y"] >= 0 and sb["y"] + sb["height"] <= vh + 1, json.dumps(sb))
            pp_ = dlg.locator("[data-testid=builder-phone-preview]")
            hidden = pp_.evaluate("e => e.hidden") if pp_.count() else None
            st.check("the sticky summary hides while the keyboard is open", hidden is True, f"hidden={hidden}")
            ov = pg.evaluate(OVERFLOW_JS)
            st.check("no horizontal page scroll with the keyboard open", not ov.get("horizontal"), json.dumps(ov)[:300])
            st.row["metrics_keyboard_open"] = metrics(pg, vp, "[role=dialog]")
            shot = OUT / vp / "W10_8-keyboard.png"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(shot))
            st.row.setdefault("screenshots", []).append(str(shot.relative_to(OUT)).replace("\\", "/"))
        finally:
            pg.set_viewport_size({"width": wd, "height": hh})
        pg.keyboard.press("Escape")
        dlg.get_by_role("button", name="Close", exact=True).first.click(timeout=T)
        for lbl in ("Discard", "Discard changes", "Close without saving", "Don't save"):
            b = pg.get_by_role("button", name=lbl, exact=True)
            if b.count():
                b.first.click()
                break

    steps = [("W10.1", "/build: Closed trades, 'Add your own field', [Net P&L] / [Risk $] with autocomplete, first-row line and skip notice, Average, save, insert", s1),
             ("W10.2", "type a broken formula (If([net] > 0, 1), read the inline sentence, fix it with the keyboard only", s2),
             ("W10.3", "build over Options strategies split by Strategy, and over Notes filtered by a number property, summed", s3),
             ("W10.4", "Equity curve r1 from an older note: Updated version available, compare, use it; a running total with the drawdown band", s4),
             ("W10.5", "insert each of the seven dedicated widgets; prop-firm limits in Change; Plan vs actual on a linked and an unlinked trade", s5),
             ("W10.6", "/size: a long and a short, an unset account size, a stop equal to entry", s6),
             ("W10.7", "share, private window: the account line for every dedicated widget and the calculator; a shared notes list reads 'Note 1…'", s7)]
    if vp == "390":
        steps.append(("W10.8", "at 390 px with the keyboard open in the Formula box (sticky summary hides, autocomplete above the keyboard)", s8))
    try:
        for sid, title, fn in steps:
            run_step(vp, sid, title, fn, pages)
        S["n4_body"] = json.dumps(get_note(ctx, base, S["n4"]).get("bodyJson"), sort_keys=True)
        S["n_old_body"] = json.dumps(get_note(ctx, base, S["n_old"]).get("bodyJson"), sort_keys=True) if S.get("n_old") else None
    finally:
        ctx.close()
        flush()


def wave10_off(browser, base: str, vp: str) -> None:
    S = STATE[vp]
    ctx = signed_in(browser, base, vp)
    pg, w = open_page(ctx, base, "/journal/notebook")
    writes: list[str] = []
    ctx.on("request", lambda r: r.method in ("PUT", "PATCH", "POST") and "/api/j2/notes/" in r.url
           and writes.append(f"{r.method} {r.url}"))

    def s(st):
        me = ctx.request.get(base + "/api/auth/me").json()
        st.check("the sandbox serves wave 10 off", me.get("notebook_widgets_w10_enabled") is False,
                 str(me.get("notebook_widgets_w10_enabled")))
        goto_note(pg, base, S["n4"])
        pg.locator("[data-snapshot-frame]").first.wait_for(timeout=T)
        render_all(pg)
        frames = pg.locator("[data-snapshot-frame]")
        st.read("placed widgets", " || ".join(t[:160] for t in frames.all_inner_texts()))
        st.check("the placed wave 10 widgets keep their snapshots (still drawn)",
                 all(embed_in(pg, n).count() for n in ("Tilt check", "Prop-firm rules")) and frames.count() >= 8,
                 f"{frames.count()} frames")
        for title in ("Tilt check", "Return on risk"):
            fr = pg.locator("[data-snapshot-frame]").filter(has_text=title).first
            if not fr.count():
                st.check(f"{title} is placed", False, "not found")
                continue
            fr.scroll_into_view_if_needed()
            fr.get_by_role("button", name="See it now").click(timeout=T)
            fr.get_by_text(FLAG_OFF_LINE).wait_for(timeout=T)
            st.check(f"See it now on {title} says 'Not available right now.'", True, fr.inner_text()[:200])
        calc = pg.get_by_text(FLAG_OFF_LINE)
        txt = st.read("note body", pg.locator(".ProseMirror").first.inner_text())
        st.check("the calculator says 'Not available right now.' (no inputs)",
                 pg.get_by_label("Risk per trade (%)").count() == 0 and calc.count() >= 1, f"{calc.count()} sentences")
        body = json.dumps(get_note(ctx, base, S["n4"]).get("bodyJson"), sort_keys=True)
        st.check("nothing else in the note changed (its body is byte-identical)", body == S.get("n4_body"),
                 f"same={body == S.get('n4_body')}")
        st.check("the visit wrote nothing to the note", not note_writes(writes, S["n4"]), json.dumps(writes[:5]))
        e = goto_note(pg, base, S["n4"])
        slash(pg, e, "/build")
        dlg = builder(pg)
        card = dlg.locator('[data-testid="example-card-shelf:equity-curve"]')
        card.wait_for(timeout=T)
        ctxt = st.read("Equity curve card", card.inner_text())
        st.check("/shelf cards show revision 1 (the Equity curve card's r1 words)", EQUITY_R1_DESC in ctxt and EQUITY_R2_DESC not in ctxt, ctxt[:200])
        dlg.get_by_role("button", name="Close", exact=True).first.click(timeout=T)

    try:
        run_step(vp, "W10.9", "set NOTEBOOK_WIDGETS_W10_ENABLED=0, reload: snapshots kept, See it now and the calculator say "
                 "'Not available right now.', /shelf cards revision 1, nothing else changes", s, {"main": (pg, w)})
    finally:
        ctx.close()
        flush()


# ── boot, phases ──────────────────────────────────────────────────────────────────────────

PHASES = {
    # phase -> (the widget flags' values, the step functions run per viewport). Every walk step runs in `on` (all
    # three waves on, as the brief sets them); the two flag-off phases restart the SAME data dir.
    "on": ({W8: "1", W9: "1", W10: "1"}, ("wave8", "wave9", "wave10")),
    "w9off": ({W8: "1", W9: "0", W10: "1"}, ("wave9_off",)),
    "w10off": ({W8: "1", W9: "1", W10: "0"}, ("wave10_off",)),
}


def set_env(fs: dict, widget: dict) -> list[str]:
    for name in fs["all_names"]:
        os.environ.pop(name, None)
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    on = sorted(set(fs["c1"]))
    os.environ.update({name: "1" for name in on})
    os.environ.update(widget)
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    return on + [f"{k}={v}" for k, v in widget.items()]


def run_phase(browser, base: str, phase: str, vps: list[str], run: str) -> None:
    fns = PHASES[phase][1]
    for vp in vps:
        if phase == "on":
            provision(browser, base, vp, run)
        elif vp not in STATE:
            REC["setup"].append({"viewport": vp, "phase": phase, "what": "no state from the flag-on phase", "verdict": "SKIP"})
            continue
        for fn in fns:
            try:
                globals()[fn](browser, base, vp)
            except h.SetupFailed:
                raise
            except Exception as e:  # noqa: BLE001 -- one wave's setup failing never hides the next wave's steps
                REC["setup"].append({"viewport": vp, "phase": phase, "what": f"{fn} stopped outside a step",
                                     "verdict": "TOOL ERROR", "error": f"{type(e).__name__}: {str(e)[:400]}",
                                     "traceback": traceback.format_exc()[-1500:]})
                flush()


def main(argv=None) -> int:
    global OUT, ONLY
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir")
    ap.add_argument("--port", type=int, default=8093)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--out", required=True)
    ap.add_argument("--viewports", default="1200,820,390")
    ap.add_argument("--phases", default="on,w9off,w10off")
    ap.add_argument("--base", default=None, help="a sandbox already running (tool iteration only; never evidence)")
    ap.add_argument("--only", default="", help="comma-separated step ids or wave prefixes (W8, W9.3 ...)")
    ap.add_argument("--run", default=None, help="the account suffix (default: the start time)")
    ap.add_argument("--resume", action="store_true",
                    help="a supplementary pass on the SAME data dir and evidence dir (its state.json), recorded as such")
    args = ap.parse_args(argv)
    ONLY = {x.strip() for x in args.only.split(",") if x.strip()}
    OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    st_path = OUT / "state.json"
    if st_path.is_file():
        STATE.update(json.loads(st_path.read_text(encoding="utf-8")))
    if (OUT / "walk.json").is_file() and args.base:
        REC.update(json.loads((OUT / "walk.json").read_text(encoding="utf-8")))
    vps = [x.strip() for x in args.viewports.split(",") if x.strip()]
    phases = [x.strip() for x in args.phases.split(",") if x.strip()]
    run = args.run or datetime.now(timezone.utc).strftime("%H%M%S")
    tree = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    fs = fw.flag_sets()
    for g in (W8, W9, W10):
        if g not in fs["gates"]:
            print(f"REFUSED: {g} is not a NOTEBOOK_FLAGS gate")
            return 3
    REC.update({"tip": args.tip, "tool_tree": tree, "viewports": vps, "phases_asked": phases,
                "started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": "INCOMPLETE (run did not finish)"})
    from playwright.sync_api import sync_playwright

    if args.base:
        REC["mode"] = "against a running sandbox (tool iteration; NOT evidence)"
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                for ph in phases:
                    run_phase(browser, args.base, ph, vps, run)
            finally:
                browser.close()
        REC["status"] = "COMPLETE (iteration)"
        flush()
        return 0

    if not args.data_dir:
        print("REFUSED: --data-dir is required unless --base names a running sandbox")
        return 3
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener (never killed)")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()) and not (args.resume and st_path.is_file()):
        print(f"REFUSED: {data_dir} is not empty (--resume continues a run whose state.json is in --out)")
        return 3
    if args.resume:
        REC.update(json.loads((OUT / "walk.json").read_text(encoding="utf-8")))
        REC.setdefault("resumes", []).append({"only": sorted(ONLY), "viewports": vps, "phases": phases,
                                             "at": datetime.now(timezone.utc).isoformat(timespec="seconds")})
    data_dir.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{args.port}"
    REC.update({"mode": "own sandbox (scripts/hub_sandbox_boot.py)", "base": base, "data_dir": str(data_dir)})
    flush()
    not_run, failure = None, None
    lines: list[str] = []
    for ph in phases:
        flags = set_env(fs, PHASES[ph][0])
        if h.port_busy(args.port):
            not_run = f"port {args.port} still busy before phase {ph}"
            break
        tag = f"{ph}-resume{len(REC.get('resumes', []))}" if args.resume else ph
        sb = h.Sandbox(str(data_dir), args.port, OUT / f"sandbox-{tag}.log")
        phase_rec = {"phase": ph, "flags": flags, "started": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        REC["phases"].append(phase_rec)
        flush()
        sb.start()
        try:
            if not sb.wait_healthy(base, 400):
                not_run = f"the sandbox never answered /api/health (phase {ph})"
            else:
                sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
                import sandbox_identity
                v = sandbox_identity.verify(base, sb.integrity_path())
                phase_rec["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
                if not v.ok:
                    not_run = v.sentence
            if not not_run:
                with sync_playwright() as p:
                    browser = p.chromium.launch()
                    try:
                        run_phase(browser, base, ph, vps, run)
                    except h.SetupFailed as e:
                        not_run = str(e)[:400]
                    except Exception as e:  # noqa: BLE001
                        failure = f"{type(e).__name__}: {str(e)[:400]}"
                        REC["traceback"] = traceback.format_exc()[-3000:]
                    finally:
                        browser.close()
            sb.wait_checkpoint(h.PREWARM, h.PREWARM_WAIT_S)
        finally:
            phase_rec["stop"] = sb.stop()
        integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.PREWARM, h.SHUTDOWN])
        ipath = sb.integrity_path()
        if ipath and Path(ipath).is_file():
            kept = OUT / f"integrity-{tag}.md"
            kept.write_text(f"tip under test: {args.tip}\nphase: {ph}\n\n"
                            + Path(ipath).read_text(encoding="utf-8", errors="replace"), encoding="utf-8", newline="\n")
            integ["path"] = str(kept)
        phase_rec["integrity"] = integ
        phase_rec["first_line"] = h.integrity_line(integ, f"phase {ph}; stop: {sb.stop_how}", not_run=not_run)
        lines.append(phase_rec["first_line"])
        print(phase_rec["first_line"], flush=True)
        flush()
        if not_run or failure or not integ.get("clean"):
            break
    if args.resume:
        REC["resumes"][-1].update({"first_line": lines[0] if lines else None, "last_line": lines[-1] if lines else None})
    else:
        REC["first_line"] = lines[0] if lines else None
    REC["last_line"] = lines[-1] if lines else None
    REC["driver_imported_api"] = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    counts = {v: sum(1 for s in REC["steps"] if s["verdict"] == v) for v in ("PASS", "FAIL", "INCONCLUSIVE")}
    REC.update({"not_run": not_run, "failure": failure, "counts": counts, "port_free_after": not h.port_busy(args.port),
                "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": "COMPLETE" if not (not_run or failure) else "NOT COMPLETE"})
    flush()
    print(f"VERDICT: {counts} not_run={not_run} failure={failure}; raw log: {OUT / 'walk.json'}")
    if not_run:
        return 3
    return 1 if failure or counts["FAIL"] or counts["INCONCLUSIVE"] else 0


if __name__ == "__main__":
    sys.exit(main())
