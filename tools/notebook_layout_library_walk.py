"""Notebook P4b (sharing a page layout through the community library), Task 9 -- one real-browser walk of the
story, the way two members and an admin meet it, read off the RENDERED pages.

PRECONDITIONS (the run refuses or records NOT RUN without each; it never assumes one):
  * a sandbox booted from the tip under test, through scripts/hub_sandbox_boot.py (this tool boots its own via
    notebook_perf_harness.Sandbox, on an EMPTY data dir outside C:\\data, on a free port; it refuses a busy port and
    never kills another process). Step 7 restarts that sandbox ONCE on the same data dir with the sharing switch off;
  * `app/dist` rebuilt from that tip (`cd app && npm run build`) -- the sandbox serves the built bundle;
  * NOTEBOOK_STYLE_LIBRARY_ENABLED=1, JOURNAL_PAGE_LAYOUTS_ENABLED=1 and NOTEBOOK_LAYOUT_SHARING_ENABLED=1 (plus the
    gallery and journal styles switches the library rides on) in the sandbox env, on top of the flags the ledger
    records as armed on web (notebook_fin_walk.flag_sets()["c1"]); this tool sets them in its own environment, which
    the sandbox inherits. ALLOW_LOCAL_VENDOR_SOCKETS is removed, never set;
  * TWO paid walk accounts per viewport (an author and a member), signed up through the app at the app's own 3/minute
    pace, comped and email-verified by the admin through the app's admin routes; /api/auth/me must say
    paid-equivalent. Each has one open position, so Today is not the zero-data experience (which shows no Customize);
  * an ADMIN account through ADMIN_EMAILS: the launcher's default (notebook_perf_harness.ADMIN_EMAIL).
  The accounts and their password are this tool's SANDBOX SEED; they exist only in the throwaway data dir.

THE STORY, once per viewport (1280, 820, 390), each with its own author, member and uniquely titled layout:
  1. the author opens Today, Customize, shows Market regime and My rules, moves Market regime first, saves, and
     shares the layout;
  2. the admin approves it in the review panel (Styles manager > Community > Review queue) and reads the panel list;
  3. the member opens Customize on Today, presses Find shared layouts, filters Page layouts, previews, and confirms
     Use this layout; Today renders Market regime first;
  4. the member presses Undo; Today renders its previous order (and closing the library puts focus on Customize);
  5. the author changes the layout and shares again; the listed version is unchanged until the admin approves it;
  6. the author unpublishes; the member's Today is unchanged;
  7. (after ONE sandbox restart with NOTEBOOK_LAYOUT_SHARING_ENABLED=0) Customize shows no Share door and the
     library shows no Page layouts chip.

Every step records PASS, FAIL or INCONCLUSIVE with the rendered text it read. PASS needs every check to have read the
product's answer and found it right. A TIMEOUT is FAIL (the product never showed what the step waited for); any other
read the driver could not finish is INCONCLUSIVE, never a pass. A declared (viewport, step) that left no row is FAIL.
An ABSENCE is counted only after the product said it decided (the status read or the list read answered).
R-RAW: walk.json is rewritten after every step, before any verdict, through secret_scrub value by value.

Waiting is always a Playwright call (`wait_for`, `expect_response`, `page.wait_for_timeout`), never time.sleep.

Exit code: 4 when either sandbox's integrity verdict is not CLEAN (whatever the steps said), 3 when the walk could not
start, 1 on any FAIL or INCONCLUSIVE or a driver failure, 0 only on all PASS with both sandboxes CLEAN.

Usage (PowerShell, data dir single-quoted):
    python tools/notebook_layout_library_walk.py --data-dir 'C:\\data-p4bwalk' --port 8183 `
        --tip <sha> --out docs/notebook/evidence/p4b-walk-<run-id>

This driver never imports api.* in its own process. Never run on import.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402
import notebook_fin_walk as fw  # noqa: E402  -- flag_sets, settle_first_run, BENIGN, VIEWPORTS, TOUCH_MAX
import notebook_fin_walk_features as fwf  # noqa: E402  -- TODAY_ORDER_JS, today_panel_ids, page_layout_registry
import mobile_audit as ma  # noqa: E402  -- _dismiss_intro, _INTRO_SEL
import secret_scrub  # noqa: E402

VIEWPORTS = fw.VIEWPORTS
# The payload switches (NOTEBOOK_FLAGS gates) and the one server-only switch (template_gallery.LAYOUT_SHARING_FLAG).
PAYLOAD_FLAGS = ["NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "NOTEBOOK_JOURNAL_STYLES_ENABLED", "NOTEBOOK_STYLE_LIBRARY_ENABLED",
                 "JOURNAL_PAGE_LAYOUTS_ENABLED"]
PW = "LocalTest2026!"          # sandbox seed (throwaway data dir only)
T = 30000

STEPS = (
    (1, "author: Today, Customize, Market regime and My rules shown, Market regime first, Save, Share"),
    (2, "admin approves it in the review panel and reads the panel list"),
    (3, "member: Customize, Find shared layouts, Page layouts, Preview, Use this layout; Today renders Market regime first"),
    (4, "member presses Undo; Today renders its previous order"),
    (5, "author changes the layout and shares again; the listed version is unchanged until the admin approves"),
    (6, "author unpublishes; the member's Today is unchanged"),
    (7, "sharing switched off (sandbox restart): Customize shows no Share door; the library shows no Page layouts chip"),
)

REC: dict = {"tool": "tools/notebook_layout_library_walk.py", "steps": [], "setup": []}
OUT: Path | None = None


# ── words read from the source, never typed ───────────────────────────────────────────────

def _src(rel: str) -> str:
    return (REPO / rel).read_text(encoding="utf-8")


def _const(rel: str, name: str) -> str:
    m = re.search(r"(?:export const|^const)\s*" + re.escape(name) + r"\s*=\s*(['\"])(.*?)\1", _src(rel), re.M)
    if not m:
        raise SystemExit(f"REFUSED: could not read {name} from {rel}")
    return m.group(2)


def _literal(rel: str, pattern: str) -> str:
    m = re.search(pattern, _src(rel))
    if not m:
        raise SystemExit(f"REFUSED: could not read {pattern!r} from {rel}")
    return m.group(1)


J2 = "app/src/pages/journal-2-0"
LAYOUT = f"{J2}/components/layout"
SENT = _const(f"{LAYOUT}/ShareLayoutForm.jsx", "LAYOUT_SENT_SENTENCE")
REVISION_SENT = _const(f"{LAYOUT}/ShareLayoutForm.jsx", "LAYOUT_REVISION_SENT_SENTENCE")
LIBRARY_TITLE = _const(f"{LAYOUT}/LayoutLibraryDoor.jsx", "LIBRARY_TITLE")
PENDING_LINE = _literal(f"{LAYOUT}/PageLayoutEditor.jsx", r"status === 'pending'\) return '([^']+)'")
REVISION_PREFIX = _literal("app/src/components/admin/TemplateGalleryReviewPanel.jsx", r"`(Update to a listed layout \(version )\$\{")
SHARING_FLAG = _literal("api/services/journal_two/template_gallery.py", r'LAYOUT_SHARING_FLAG = "([A-Z_]+)"')
PAGE_LAYOUTS_CHIP = _literal(f"{J2}/lib/styleLibrary.js", r"\{ key: 'page_layout', label: '([^']+)' \}")
REG = fwf.page_layout_registry()
LABEL = {pid: lab for pid, lab, _ in REG["today"]}
PHASE_ID = {lab: pid for pid, lab in REG["phases"].items()}


# ── recorder ──────────────────────────────────────────────────────────────────────────────

def flush() -> None:
    """walk.json, through secret_scrub.scrub value by value (a Playwright request error echoes its request headers,
    cookie included; scrubbing the serialized text would eat a string's closing quote -- P5's run 4)."""
    def clean(v):
        if isinstance(v, str):
            return secret_scrub.scrub(v)
        if isinstance(v, dict):
            return {k: clean(x) for k, x in v.items()}
        if isinstance(v, (list, tuple)):
            return [clean(x) for x in v]
        return v
    if OUT is not None:
        tmp = OUT / "walk.json.tmp"
        tmp.write_text(json.dumps(clean(REC), indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
        os.replace(tmp, OUT / "walk.json")


class Watch:
    """Console errors, page errors and every response >= 400 one page saw, per step."""

    def __init__(self, pg):
        self.events: list[dict] = []
        pg.on("console", lambda m: m.type == "error" and self.events.append({"console": m.text[:300]}))
        pg.on("pageerror", lambda e: self.events.append({"pageerror": str(e)[:300]}))
        pg.on("response", lambda r: r.status >= 400 and not any(b in r.url for b in fw.BENIGN)
              and self.events.append({"http": r.status, "url": r.url[:200]}))

    def take(self) -> list[dict]:
        out, self.events = self.events, []
        return out


class Step:
    def __init__(self, vp: str, n: int, title: str):
        self.row = {"viewport": vp, "step": n, "title": title, "checks": [], "rendered": [], "verdict": None}

    def read(self, what: str, text) -> str:
        text = "" if text is None else str(text)
        self.row["rendered"].append({"what": what, "text": text.strip()[:1500]})
        return text

    def check(self, what: str, ok: bool, read) -> bool:
        self.row["checks"].append({"what": what, "ok": bool(ok), "read": ("" if read is None else str(read))[:600]})
        return ok


def verdict_after_error(checks: list[dict], e: BaseException) -> str:
    """A step that raised: FAIL when a check had already failed or the raise is a TIMEOUT (the product never showed
    what the step waited for); INCONCLUSIVE only for any other read the driver could not finish."""
    if any(not c["ok"] for c in checks):
        return "FAIL"
    return "FAIL" if type(e).__name__ == "TimeoutError" else "INCONCLUSIVE"


def run_step(vp: str, n: int, fn, pages: dict) -> dict:
    title = dict(STEPS)[n]
    st = Step(vp, n, title)
    try:
        fn(st)
        checks = st.row["checks"]
        st.row["verdict"] = "PASS" if checks and all(c["ok"] for c in checks) else "FAIL"
    except Exception as e:  # noqa: BLE001 -- a read the driver could not finish
        st.row["verdict"] = verdict_after_error(st.row["checks"], e)
        st.row["error"] = f"{type(e).__name__}: {str(e)[:500]}"
        st.row["traceback"] = traceback.format_exc()[-1500:]
    for role, (pg, watch) in pages.items():
        st.row.setdefault("events", {})[role] = watch.take()
        try:
            shot = OUT / vp / f"step{n}-{role}.jpg"
            shot.parent.mkdir(parents=True, exist_ok=True)
            pg.screenshot(path=str(shot), type="jpeg", quality=55)
        except Exception:  # noqa: BLE001
            pass
        if st.row["verdict"] != "PASS":
            try:
                st.row.setdefault("page_text", {})[role] = pg.locator("body").inner_text(timeout=3000)[:2500]
            except Exception:  # noqa: BLE001
                pass
    REC["steps"].append(st.row)
    flush()
    print(f"[{vp}] step {n} {st.row['verdict']}: {title}", flush=True)
    return st.row


def unregistered_rows(viewports: list[str]) -> list[dict]:
    """Every declared (viewport, step) that left no row: each one is a FAIL, never skipped."""
    seen = {(s["viewport"], s["step"]) for s in REC["steps"]}
    return [{"viewport": vp, "step": n, "title": title, "checks": [], "rendered": [], "verdict": "FAIL",
             "error": "never ran: the step left no row"}
            for vp in viewports for n, title in STEPS if (vp, n) not in seen]


def exit_code(integs: list[dict], not_run: str | None, failure: str | None, counts: dict) -> int:
    """A sandbox that is NOT CLEAN (dirty, incomplete or missing) is 4 whatever the steps said."""
    if not integs or not all(i.get("clean") for i in integs):
        return 4
    if not_run:
        return 3
    return 1 if failure or counts.get("FAIL") or counts.get("INCONCLUSIVE") else 0


# ── pages ─────────────────────────────────────────────────────────────────────────────────

NUDGES = ("Not now", "Got it", "Dismiss tip")


def dismiss_intro(pg) -> None:
    """The intro plays on every page load: wait for it, then mobile_audit's recipe (which refuses to go on if it is
    still up)."""
    try:
        pg.locator(ma._INTRO_SEL).first.wait_for(state="visible", timeout=5000)
    except Exception:  # noqa: BLE001 -- it did not play in this tab
        return
    ma._dismiss_intro(pg)


def skip_base_tour(pg) -> bool:
    """The base Notebook tour a new member is shown takes every click (P5 run 2); a member presses Skip tour, and so
    does the walk, recording that it did."""
    dlg = pg.get_by_role("dialog").filter(has=pg.get_by_role("button", name="Skip tour", exact=True)).first
    try:
        dlg.wait_for(state="visible", timeout=4000)
    except Exception:  # noqa: BLE001 -- no tour on this page
        return False
    card = dlg.inner_text(timeout=3000)
    dlg.get_by_role("button", name="Skip tour", exact=True).click(timeout=T)
    dlg.wait_for(state="hidden", timeout=T)
    REC["setup"].append({"what": "skipped the base Notebook tour", "card": card[:200], "url": pg.url, "verdict": "INFO"})
    flush()
    return True


def nudges(pg) -> None:
    """One press each on a first-visit nudge (the tour offer, a tip), the way a member closes them once."""
    for nm in NUDGES:
        for _ in range(3):
            b = pg.get_by_role("button", name=nm, exact=True).filter(visible=True)
            if not b.count():
                break
            b.first.click(timeout=T)
            pg.wait_for_timeout(300)


def settle(pg) -> None:
    dismiss_intro(pg)
    fw.settle_first_run(pg)
    skip_base_tour(pg)
    nudges(pg)


def goto(pg, base: str, path: str) -> None:
    pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
    settle(pg)


def new_ctx(browser, vp: str, state: dict | None = None, account: str | None = None):
    wd, ht = VIEWPORTS[vp]
    touch = wd <= fw.TOUCH_MAX
    ctx = browser.new_context(viewport={"width": wd, "height": ht}, has_touch=touch, is_mobile=touch,
                              reduced_motion="reduce", storage_state=state)
    if account:
        ctx.add_init_script(f"try {{ localStorage.setItem('{fwf.SELECTED_ACCOUNT_KEY}', '{account}') }} catch (e) {{}}")
    return ctx


def page(ctx):
    pg = ctx.new_page()
    return pg, Watch(pg)


def paced_signup(req, pacer, base: str, email: str, pw: str, name: str) -> None:
    """Sign up through the app, waiting out its 3/minute sign-up limit on a 429 (a Playwright wait, never sleep)."""
    for attempt in range(4):
        r = req.post(base + "/api/auth/signup", data={"email": email, "password": pw, "display_name": name})
        if r.status in (200, 201):
            return
        if r.status != 429:
            break
        REC["setup"].append({"what": f"sign-up limit reached for {name}; waiting 62 s", "attempt": attempt + 1,
                             "verdict": "INFO"})
        flush()
        pacer.wait_for_timeout(62000)
    r = req.post(base + "/api/auth/login", data={"email": email, "password": pw})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"{name} could neither sign up nor sign in (HTTP {r.status})")


def provision(browser, base: str, people: dict) -> dict:
    """Sign up the admin and each viewport's author and member; comp, verify, seed one open position each. Returns each
    account's saved browser state (cookies), so no later context signs in again."""
    states: dict = {}
    admin = browser.new_context()
    pacer = admin.new_page()
    try:
        paced_signup(admin.request, pacer, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        me = admin.request.get(base + "/api/auth/me").json()
        role = me.get("role") or (me.get("user") or {}).get("role")
        REC["setup"].append({"account": "admin (ADMIN_EMAILS)", "role": role})
        if role != "admin":
            raise h.SetupFailed("the sandbox admin did not sign in as an admin")
        states["admin"] = {"state": admin.storage_state(), "account": None}
        for key, (email, name) in people.items():
            c = browser.new_context()
            try:
                paced_signup(c.request, pacer, base, email, PW, name)
                comp = admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
                ver = admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
                me = c.request.get(base + "/api/auth/me").json()
                if not me.get("paid_equiv"):
                    raise h.SetupFailed(f"{name} is not paid-equivalent (comp {comp.status}, verify {ver.status})")
                if me.get("journal_page_layouts_enabled") is not True:
                    raise h.SetupFailed(f"{name}'s auth payload does not carry the page layouts switch on")
                listing = c.request.get(base + "/api/j2/accounts").json()
                accts = (listing.get("accounts") if isinstance(listing, dict) else listing) or []
                acct = next((a["id"] for a in accts if a.get("isDefault")), accts[0]["id"] if accts else None)
                pos = c.request.post(base + "/api/j2/positions", data={
                    "symbol": "IBM", "side": "Long", "shares": 10, "entryPrice": 200.0, "stopPrice": 190.0,
                    "entryDate": datetime.now(timezone.utc).date().isoformat(), "accountId": acct})
                REC["setup"].append({"account": name, "comp": comp.status, "verify": ver.status, "paid_equiv": True,
                                     "account_id": acct, "open_position": pos.status,
                                     "what": "one open position, so Today is not the zero-data experience"})
                if pos.status not in (200, 201) or not acct:
                    raise h.SetupFailed(f"{name}'s open position was refused: HTTP {pos.status}")
                states[key] = {"state": c.storage_state(), "account": acct}
            finally:
                c.close()
    finally:
        admin.close()
    flush()
    return states


def open_today(pg, base: str):
    goto(pg, base, "/journal")
    btn = pg.get_by_role("button", name="Customize", exact=True)
    btn.wait_for(timeout=60000)
    nudges(pg)
    return btn


def today_ids(pg) -> list:
    return fwf.today_panel_ids(pg.evaluate(fwf.TODAY_ORDER_JS))


def open_editor(pg, *, expect_status: bool = False):
    """Customize, and the editor once its rows render. With `expect_status`, also the sharing status read's answer
    (the settled signal for whether Share and Find show at all). Only on a FRESH page load: the app's global SWRConfig
    dedupes a re-read inside 8 s, so a second open on the same page may send no request at all."""
    dlg = pg.get_by_role("dialog", name="Customize Today")
    status = None
    if expect_status:
        with pg.expect_response(lambda r: urlparse(r.url).path == "/api/j2/template-gallery/layouts/status", timeout=T) as rsp:
            pg.get_by_role("button", name="Customize", exact=True).first.click(timeout=T)
        status = rsp.value.status
    else:
        pg.get_by_role("button", name="Customize", exact=True).first.click(timeout=T)
    dlg.get_by_role("checkbox", name=re.compile(r"^Show ")).first.wait_for(timeout=45000)
    return dlg, status


def to_top(pg, label: str) -> int:
    up = pg.get_by_role("button", name=f"Move {label} up", exact=True)
    n = 0
    while n < 20 and up.is_enabled():
        up.click(timeout=T)
        n += 1
        pg.wait_for_timeout(60)
    return n


def save_editor(pg, dlg) -> str:
    dlg.get_by_role("button", name="Save", exact=True).click(timeout=T)
    dlg.wait_for(state="hidden", timeout=20000)
    toast = pg.get_by_text("Layout saved.", exact=True)
    toast.wait_for(timeout=10000)
    return toast.inner_text()


def share(pg, st, title: str, sentence: str, gid_holder: dict) -> None:
    dlg, _ = open_editor(pg)
    dlg.get_by_role("button", name="Share this layout", exact=True).click(timeout=T)
    form = dlg.get_by_role("form", name="Share this layout")
    form.wait_for(timeout=T)
    form.get_by_label("Title in the library").fill(title)
    form.get_by_label("Category").select_option("journal")
    form.get_by_label("Trading style (optional)").select_option("swing")
    with pg.expect_response(lambda r: urlparse(r.url).path == "/api/j2/template-gallery/layouts"
                            and r.request.method == "POST", timeout=T) as rsp:
        form.get_by_role("button", name="Submit", exact=True).click(timeout=T)
    body = rsp.value.json() if rsp.value.ok else {}
    gid_holder["gid"] = (body.get("template") or {}).get("id") or gid_holder.get("gid")
    line = dlg.get_by_text(sentence, exact=False).first
    line.wait_for(timeout=T)
    text = st.read("the sheet's answer", line.inner_text())
    st.check("the share was taken (HTTP 200)", rsp.value.status == 200, f"HTTP {rsp.value.status}")
    st.check("the sheet says what happened, in the product's words", text.startswith(sentence), text)
    dlg.get_by_role("button", name="Cancel", exact=True).click(timeout=T)
    dlg.wait_for(state="hidden", timeout=T)


def open_library_door(pg):
    """Customize > Find shared layouts: the library opened at Page layouts."""
    dlg, _ = open_editor(pg)
    dlg.get_by_role("button", name="Find shared layouts", exact=True).click(timeout=T)
    door = pg.get_by_role("dialog", name=LIBRARY_TITLE)
    door.wait_for(timeout=T)
    door.get_by_role("group", name="Filter by type").wait_for(timeout=45000)
    return door


def open_styles_library(pg, base: str):
    """The Notebook's Styles manager > Community (the admin's review queue, and the library in step 7). Returns the
    library dialog and the list read's answer (the settled signal for which chips show)."""
    goto(pg, base, "/journal/notebook?styles=1")
    dlg = pg.get_by_role("dialog", name="Journal styles")
    dlg.wait_for(timeout=T)
    with pg.expect_response(lambda r: urlparse(r.url).path == "/api/j2/template-gallery"
                            and r.request.method == "GET", timeout=T) as rsp:
        dlg.get_by_role("button", name="Community", exact=True).click(timeout=T)
    lib = pg.get_by_role("dialog", name="Community styles")
    lib.wait_for(timeout=T)
    lib.get_by_role("heading", name="Community gallery").wait_for(timeout=T)
    return lib, rsp.value


def gallery_message(scope, contains: str) -> str:
    msg = scope.locator("[data-gallery-message]").filter(has_text=contains)
    msg.wait_for(timeout=T)
    return msg.inner_text()


def stored_today(req, base: str) -> dict:
    raw = (req.get(base + "/api/auth/preferences").json() or {}).get(REG["pref"])
    try:
        return (json.loads(raw) if isinstance(raw, str) else raw or {}).get("today") or {}
    except ValueError:
        return {}


# ── the story ─────────────────────────────────────────────────────────────────────────────

def story(browser, base: str, vp: str, run: str, states: dict) -> None:
    title = f"P4b walk {vp} {run}"
    S: dict = {"title": title}
    REC.setdefault("stories", {})[vp] = S
    actx = new_ctx(browser, vp, states[f"author-{vp}"]["state"], states[f"author-{vp}"]["account"])
    mctx = new_ctx(browser, vp, states[f"member-{vp}"]["state"], states[f"member-{vp}"]["account"])
    dctx = new_ctx(browser, vp, states["admin"]["state"])
    (apg, aw), (mpg, mw), (dpg, dw) = page(actx), page(mctx), page(dctx)
    pages = {"author": (apg, aw), "member": (mpg, mw), "admin": (dpg, dw)}

    def s1(st):
        open_today(apg, base)
        dlg, status = open_editor(apg, expect_status=True)
        st.check("the sharing status read answers (sharing is on)", status == 200, st.read("status read", f"HTTP {status}"))
        phase_label = dlg.locator("button[aria-pressed='true']").first.inner_text().strip()
        S["phase"], S["phase_label"] = PHASE_ID.get(phase_label), phase_label
        st.read("the editor's phase", phase_label)
        dlg.get_by_role("checkbox", name=f"Show {LABEL['regime']}", exact=True).check(timeout=T)
        dlg.get_by_role("checkbox", name=f"Show {LABEL['myRules']}", exact=True).check(timeout=T)
        moved = to_top(apg, LABEL["regime"])
        first_row = dlg.get_by_role("checkbox").first.get_attribute("aria-label")
        st.check("Market regime is the editor's first row", first_row == f"Show {LABEL['regime']}",
                 st.read("editor first row", f"{first_row} (moved up {moved})"))
        toast = save_editor(apg, dlg)
        st.check("Save says Layout saved.", toast == "Layout saved.", st.read("toast", toast))
        apg.get_by_role("region", name=LABEL["regime"], exact=True).wait_for(timeout=T)
        ids = today_ids(apg)
        S["author_order"] = ids
        st.check("the author's Today renders Market regime first, My rules shown", ids[:1] == ["regime"] and "myRules" in ids,
                 st.read("author Today order", json.dumps(ids)))
        share(apg, st, title, SENT, S)
        st.check("the server gave the share an id", bool(S.get("gid")), str(S.get("gid")))
        dlg, _ = open_editor(apg)
        line = dlg.get_by_text(PENDING_LINE, exact=True)
        line.wait_for(timeout=T)
        st.check("Customize says the layout waits for review", True, st.read("status line", line.inner_text()))
        dlg.get_by_role("button", name="Cancel", exact=True).click(timeout=T)

    def approve(st, revision: bool) -> dict:
        lib, _ = open_styles_library(dpg, base)
        lib.get_by_role("button", name="Review queue", exact=True).click(timeout=T)
        row = lib.locator(f'[data-gallery-pending="{S["gid"]}"]')
        row.wait_for(timeout=T)
        details = row.locator(f'[data-gallery-review-layout="{S["gid"]}"]')
        details.get_by_text("Trading style:", exact=False).wait_for(timeout=T)
        text = st.read("review queue row", row.inner_text())
        st.check("the row says it is a Today layout", "Page: Today" in text, text)
        phase_list = details.get_by_role("list", name=f"{S['phase_label']} panels")
        items = phase_list.get_by_role("listitem").all_inner_texts()
        st.read(f"the {S['phase_label']} panel list", json.dumps(items))
        st.check(f"the {S['phase_label']} list starts with Market regime: Shown and shows My rules",
                 items[:1] == [f"{LABEL['regime']}: Shown"] and f"{LABEL['myRules']}: Shown" in items, json.dumps(items))
        if revision:
            st.check("the row says it is an update to a listed layout", f"{REVISION_PREFIX}" in text, text)
        row.get_by_role("button", name=f"Approve {title}", exact=True).click(timeout=T)
        msg = gallery_message(lib, "Approved")
        st.check("the review panel says it is listed", f"Approved “{title}”. It is listed now." in st.read("message", msg), msg)
        return {"items": items}

    def s2(st):
        approve(st, revision=False)
        item = mctx.request.get(base + f"/api/j2/template-gallery/{S['gid']}").json().get("template") or {}
        st.check("the member's item read says listed, version 1", item.get("version") == 1,
                 st.read("member item read", f"version={item.get('version')} title={item.get('title')}"))

    def s3(st):
        open_today(mpg, base)
        before = today_ids(mpg)
        S["member_before"] = before
        S["member_stored_before"] = stored_today(mctx.request, base)
        st.read("member Today order before", json.dumps(before))
        door = open_library_door(mpg)
        chip = door.get_by_role("group", name="Filter by type").get_by_role("button", name=PAGE_LAYOUTS_CHIP, exact=True)
        if chip.get_attribute("aria-pressed") != "true":
            chip.click(timeout=T)
        st.check("the Page layouts chip is pressed", chip.get_attribute("aria-pressed") == "true",
                 st.read("chip", f"{PAGE_LAYOUTS_CHIP} aria-pressed={chip.get_attribute('aria-pressed')}"))
        card = door.locator(f'[data-library-layout][data-gallery-id="{S["gid"]}"]')
        card.wait_for(timeout=T)
        st.check("the author's layout is a card under Page layouts", title in st.read("card", card.inner_text()), title)
        card.get_by_role("button", name=f"Preview {title}", exact=True).click(timeout=T)
        prev = mpg.get_by_role("dialog", name=f"Preview: {title}")
        prev.wait_for(timeout=T)
        tabs = prev.get_by_role("group", name="Phase")
        tabs.get_by_role("button", name=S["phase_label"], exact=True).click(timeout=T)
        shared = prev.get_by_role("list", name=f"Shared, {S['phase_label']}")
        shared.wait_for(timeout=T)
        rows = shared.get_by_role("listitem").all_inner_texts()
        st.read("preview: shared list", json.dumps(rows))
        st.check("Preview's shared list starts with Market regime", bool(rows) and rows[0].startswith(LABEL["regime"]), json.dumps(rows))
        prev.get_by_role("button", name="Close", exact=True).first.click(timeout=T)
        prev.wait_for(state="hidden", timeout=T)
        card.get_by_role("button", name=f"Use this layout: {title}", exact=True).click(timeout=T)
        confirm = mpg.get_by_role("dialog", name="Use this layout for Today?")
        confirm.wait_for(timeout=T)
        st.read("confirm: what changes", confirm.get_by_role("list", name="What changes").inner_text())
        with mpg.expect_response(lambda r: urlparse(r.url).path.endswith("/adopt-layout"), timeout=T) as rsp:
            confirm.get_by_role("button", name="Use this layout", exact=True).click(timeout=T)
        st.check("the adopt was taken (HTTP 200)", rsp.value.status == 200, f"HTTP {rsp.value.status}")
        msg = gallery_message(door, "now uses")
        st.check("the library says Today now uses the layout", f'Today now uses "{title}".' in st.read("message", msg), msg)
        mpg.get_by_role("region", name=LABEL["regime"], exact=True).wait_for(timeout=T)
        after = today_ids(mpg)
        S["member_adopted"] = after
        st.check("Today renders Market regime first, behind the library", after[:1] == ["regime"] and "myRules" in after,
                 st.read("member Today order after", json.dumps(after)))

    def s4(st):
        door = mpg.get_by_role("dialog", name=LIBRARY_TITLE)
        door.locator("[data-gallery-message]").get_by_role("button", name="Undo", exact=True).click(timeout=T)
        msg = gallery_message(door, "is back")
        st.check("the library says the previous layout is back", "Your previous Today layout is back." in st.read("message", msg), msg)
        mpg.get_by_role("region", name=LABEL["regime"], exact=True).wait_for(state="detached", timeout=T)
        now = today_ids(mpg)
        st.check("Today renders its previous order", now == S["member_before"],
                 st.read("member Today order after Undo", f"{json.dumps(now)} (before: {json.dumps(S['member_before'])})"))
        st.check("the stored Today layout is the one before the adopt", stored_today(mctx.request, base) == S["member_stored_before"],
                 "compared the member's preference read before and after")
        door.get_by_role("button", name="Close", exact=True).first.click(timeout=T)
        door.wait_for(state="hidden", timeout=T)
        try:
            mpg.wait_for_function("() => document.activeElement && document.activeElement.textContent.trim() === 'Customize'",
                                  timeout=5000)
        except Exception:  # noqa: BLE001 -- recorded by the check below, with what did have focus
            pass
        focused = mpg.evaluate("() => document.activeElement ? document.activeElement.textContent.trim() : null")
        st.check("closing the library puts focus on Customize (P4b-T8 m2)", focused == "Customize", st.read("focus", str(focused)))

    def s5(st):
        open_today(apg, base)
        dlg, _ = open_editor(apg)
        dlg.get_by_role("checkbox", name=f"Show {LABEL['todayNote']}", exact=True).check(timeout=T)
        save_editor(apg, dlg)
        share(apg, st, title, REVISION_SENT, S)
        item = mctx.request.get(base + f"/api/j2/template-gallery/{S['gid']}").json().get("template") or {}
        lst = ((item.get("payload") or {}).get("lists") or {}).get(S["phase"]) or []
        note_shown = any(e.get("id") == "todayNote" and e.get("shown") for e in lst)
        st.check("the listed version is still 1, without the change", item.get("version") == 1 and not note_shown,
                 st.read("member item read (held)", f"version={item.get('version')} todayNote shown={note_shown}"))
        dlg, _ = open_editor(apg)
        line = dlg.get_by_text("Listed. Your update is waiting for review.", exact=True)
        line.wait_for(timeout=T)
        st.check("Customize says the update waits for review", True, st.read("status line", line.inner_text()))
        dlg.get_by_role("button", name="Cancel", exact=True).click(timeout=T)
        approve(st, revision=True)
        item = mctx.request.get(base + f"/api/j2/template-gallery/{S['gid']}").json().get("template") or {}
        lst = ((item.get("payload") or {}).get("lists") or {}).get(S["phase"]) or []
        note_shown = any(e.get("id") == "todayNote" and e.get("shown") for e in lst)
        st.check("once approved, the listed version is 2 and carries the change", item.get("version") == 2 and note_shown,
                 st.read("member item read (approved)", f"version={item.get('version')} todayNote shown={note_shown}"))

    def s6(st):
        open_today(mpg, base)
        before = today_ids(mpg)
        stored_before = stored_today(mctx.request, base)
        open_today(apg, base)
        door = open_library_door(apg)
        door.get_by_role("button", name="Your submissions", exact=True).click(timeout=T)
        row = door.locator(f'[data-gallery-row="{S["gid"]}"]')
        row.wait_for(timeout=T)
        row.get_by_role("button", name=f"Unpublish {title}", exact=True).click(timeout=T)
        row.get_by_role("group", name=f"Unpublish {title}?").get_by_role("button", name="Unpublish", exact=True).click(timeout=T)
        msg = gallery_message(door, "Unpublished")
        st.check("the library says it was unpublished", f"Unpublished “{title}”." in st.read("message", msg), msg)
        open_today(mpg, base)
        after = today_ids(mpg)
        st.check("the member's Today is unchanged", after == before,
                 st.read("member Today order", f"after={json.dumps(after)} before={json.dumps(before)}"))
        st.check("the member's stored Today layout is unchanged", stored_today(mctx.request, base) == stored_before,
                 "compared the member's preference read before and after")

    try:
        for n, fn in ((1, s1), (2, s2), (3, s3), (4, s4), (5, s5), (6, s6)):
            if n > 1 and not S.get("gid"):
                break                       # the rest need the share; their rows are FAIL as never-ran
            run_step(vp, n, fn, pages)
    finally:
        for c in (actx, mctx, dctx):
            c.close()
        flush()


def sharing_off(browser, base: str, vp: str, states: dict) -> None:
    """Step 7, on the restarted sandbox (NOTEBOOK_LAYOUT_SHARING_ENABLED=0)."""
    ctx = new_ctx(browser, vp, states[f"author-{vp}"]["state"], states[f"author-{vp}"]["account"])
    pg, w = page(ctx)

    def s7(st):
        open_today(pg, base)
        dlg, status = open_editor(pg, expect_status=True)
        st.check("the sharing status read answers 404 (sharing is off)", status == 404, st.read("status read", f"HTTP {status}"))
        rows = dlg.get_by_role("checkbox", name=re.compile(r"^Show ")).count()
        st.check("control: the editor rendered its rows", rows > 0, f"{rows} rows")
        share_n = dlg.get_by_role("button", name="Share this layout", exact=True).count()
        find_n = dlg.get_by_role("button", name="Find shared layouts", exact=True).count()
        st.check("Customize shows no Share door", share_n == 0, st.read("Share buttons", str(share_n)))
        st.check("Customize shows no Find shared layouts", find_n == 0, st.read("Find buttons", str(find_n)))
        dlg.get_by_role("button", name="Cancel", exact=True).click(timeout=T)
        lib, rsp = open_styles_library(pg, base)
        caps = (rsp.json() or {}).get("capabilities") or {}
        st.read("list read capabilities", json.dumps(caps))
        types = lib.get_by_role("group", name="Filter by type")
        types.wait_for(timeout=T)
        labels = types.get_by_role("button").all_inner_texts()
        st.read("type chips", json.dumps(labels))
        st.check("control: the library's type chips rendered (Styles is one)", "Styles" in labels, json.dumps(labels))
        st.check("the library shows no Page layouts chip", PAGE_LAYOUTS_CHIP not in labels, json.dumps(labels))

    try:
        run_step(vp, 7, s7, {"author": (pg, w)})
    finally:
        ctx.close()
        flush()


# ── boot ──────────────────────────────────────────────────────────────────────────────────

def set_env(fs: dict, sharing: str) -> list[str]:
    unknown = [n for n in PAYLOAD_FLAGS if n not in fs["gates"]]
    if unknown:
        raise SystemExit(f"REFUSED: not a gate the ledger knows: {unknown}")
    on = sorted(set(fs["c1"]) | set(PAYLOAD_FLAGS))
    for name in fs["all_names"]:
        os.environ.pop(name, None)
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    os.environ.pop("ALLOW_LOCAL_VENDOR_SOCKETS", None)
    os.environ.update({name: "1" for name in on})
    os.environ[SHARING_FLAG] = sharing
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    return on + [f"{SHARING_FLAG}={sharing}"]


def boot(data_dir: Path, port: int, base: str, log: Path, label: str) -> tuple:
    sb = h.Sandbox(str(data_dir), port, log)
    sb.start()
    not_run = None
    if not sb.wait_healthy(base, 400):
        not_run = f"the {label} sandbox never answered /api/health"
    else:
        sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
        import sandbox_identity
        v = sandbox_identity.verify(base, sb.integrity_path())
        REC.setdefault("sandbox_identity", {})[label] = {"ok": v.ok, "sentence": v.sentence}
        if not v.ok:
            not_run = v.sentence
    return sb, not_run


def stop_and_read(sb, label: str, tip: str) -> dict:
    sb.wait_checkpoint(h.PREWARM, h.PREWARM_WAIT_S)
    REC.setdefault("stop", {})[label] = sb.stop()
    integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.PREWARM, h.SHUTDOWN])
    ipath = sb.integrity_path()
    if ipath and Path(ipath).is_file():
        kept = OUT / f"integrity-{label}.md"
        kept.write_text(f"tip under test: {tip}\n\n" + Path(ipath).read_text(encoding="utf-8", errors="replace"),
                        encoding="utf-8", newline="\n")
        integ["path"] = str(kept)
    REC.setdefault("integrity", {})[label] = integ
    REC.setdefault("first_line", {})[label] = h.integrity_line(integ, f"stop: {sb.stop_how}")
    print(REC["first_line"][label], flush=True)
    flush()
    return integ


def main(argv=None) -> int:
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8183)
    ap.add_argument("--tip", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--viewports", default="1280,820,390")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener (never killed)")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    viewports = [x.strip() for x in args.viewports.split(",") if x.strip()]
    bad = [v for v in viewports if v not in VIEWPORTS]
    if bad:
        print(f"REFUSED: unknown viewport(s) {bad}")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    tree = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    fs = fw.flag_sets()
    on = set_env(fs, "1")
    base = f"http://127.0.0.1:{args.port}"
    run = datetime.now(timezone.utc).strftime("%H%M%S")
    people = {}
    for vp in viewports:
        people[f"author-{vp}"] = (f"p4bwalk-author-{vp}-{run}@local.dev", f"P4b Author {vp}")
        people[f"member-{vp}"] = (f"p4bwalk-member-{vp}-{run}@local.dev", f"P4b Member {vp}")
    REC.update({"tip": args.tip, "tool_tree": tree, "base": base, "data_dir": str(data_dir), "flags_on": on,
                "viewports": viewports, "declared_steps": [list(s) for s in STEPS],
                "source_words": {"sent": SENT, "revision_sent": REVISION_SENT, "library_title": LIBRARY_TITLE,
                                 "pending_line": PENDING_LINE, "revision_prefix": REVISION_PREFIX,
                                 "page_layouts_chip": PAGE_LAYOUTS_CHIP, "sharing_flag": SHARING_FLAG,
                                 "labels": {k: LABEL[k] for k in ("regime", "myRules", "todayNote")}},
                "started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": "INCOMPLETE (run did not finish)"})
    flush()
    not_run, failure, integs = None, None, []
    states: dict = {}
    from playwright.sync_api import sync_playwright
    sb, not_run = boot(data_dir, args.port, base, OUT / "sandbox-on.log", "sharing-on")
    try:
        if not not_run:
            with sync_playwright() as p:
                browser = p.chromium.launch()      # Playwright's own headless Chromium, never the owner's Chrome
                try:
                    states = provision(browser, base, people)
                    for vp in viewports:
                        story(browser, base, vp, run, states)
                except h.SetupFailed as e:
                    not_run = str(e)[:400]
                except Exception as e:  # noqa: BLE001
                    failure = f"{type(e).__name__}: {str(e)[:400]}"
                    REC["traceback"] = traceback.format_exc()[-3000:]
                finally:
                    browser.close()
    finally:
        integs.append(stop_and_read(sb, "sharing-on", args.tip))
    if not not_run and not failure and states:
        REC["flags_on_restart"] = set_env(fs, "0")
        sb2, nr2 = boot(data_dir, args.port, base, OUT / "sandbox-off.log", "sharing-off")
        try:
            if nr2:
                failure = f"the restart could not start: {nr2}"
            else:
                with sync_playwright() as p:
                    browser = p.chromium.launch()
                    try:
                        for vp in viewports:
                            sharing_off(browser, base, vp, states)
                    except Exception as e:  # noqa: BLE001
                        failure = f"{type(e).__name__}: {str(e)[:400]}"
                        REC["traceback_off"] = traceback.format_exc()[-3000:]
                    finally:
                        browser.close()
        finally:
            integs.append(stop_and_read(sb2, "sharing-off", args.tip))
    REC["driver_imported_api"] = sorted(m for m in sys.modules if m == "api" or m.startswith("api."))
    if not not_run:
        REC["steps"].extend(unregistered_rows(viewports))
    counts = {v: sum(1 for s in REC["steps"] if s["verdict"] == v) for v in ("PASS", "FAIL", "INCONCLUSIVE")}
    REC.update({"not_run": not_run, "failure": failure, "counts": counts, "port_free_after": not h.port_busy(args.port),
                "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                "status": "COMPLETE" if not (not_run or failure) else "NOT COMPLETE"})
    flush()
    code = exit_code(integs, not_run, failure, counts)
    print(f"VERDICT: {counts} not_run={not_run} failure={failure} sandboxes={[i.get('status') for i in integs]} "
          f"exit={code}; raw log: {OUT / 'walk.json'}")
    return code


if __name__ == "__main__":
    sys.exit(main())
