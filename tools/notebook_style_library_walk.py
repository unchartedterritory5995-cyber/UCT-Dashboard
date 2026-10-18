"""Notebook P3a (the community style library), Task 11 -- one real-browser walk of the library's whole
story, the way two members and an admin meet it, read off the RENDERED pages.

PRECONDITIONS (the run refuses or records NOT RUN without each; it never assumes one):
  * a sandbox booted from the tip under test, through scripts/hub_sandbox_boot.py (this tool boots its
    own via notebook_perf_harness.Sandbox, on an EMPTY data dir outside C:\\data, on a free port; it
    refuses a busy port and never kills another process);
  * `app/dist` rebuilt from that tip (`cd app && npm run build`) -- the sandbox serves the built bundle;
  * NOTEBOOK_STYLE_LIBRARY_ENABLED=1 and NOTEBOOK_JOURNAL_STYLES_ENABLED=1 (and the gallery,
    NOTEBOOK_TEMPLATE_GALLERY_ENABLED=1) in the sandbox env, on top of the flags the ledger records as
    armed on web (notebook_fin_walk.flag_sets()["c1"]); this tool sets them in its own environment,
    which the sandbox inherits;
  * TWO paid walk accounts on that data dir (an author and a member), created here: signed up through
    the app, then comped and email-verified by the admin through the app's own admin routes, and
    /api/auth/me must say paid-equivalent;
  * an ADMIN account through ADMIN_EMAILS: the launcher's default (notebook_perf_harness.ADMIN_EMAIL),
    promoted at sign-in.
  The accounts and their password are this tool's SANDBOX SEED (below, as every Notebook walk keeps
  them); they exist only in the throwaway data dir and are never printed.

THE STORY, once per viewport (1280, 820, 390), each with its own uniquely named style:
  1. the author creates a style (the journal styles route, as the editor's Save sends it) and shares it
     from the Styles manager ("Share to community");
  2. the admin approves it in the review queue (Styles manager > Community > Review queue);
  3. the member browses Styles, filters Swing, previews it, adopts it with "Notify me", marks it
     Helpful, opens the author's page and follows;
  4. the author changes the style (a block added, a new outline) and shares it again; the LISTED
     version is unchanged (the member's card still shows the listed title; version 1);
  5. the admin approves the revision (the queue row says it is an update to a listed style);
  6. the member sees the notice, opens Updates, sees "Adds blocks", updates WITHOUT the author's
     outline, and the member's own-words outline is kept;
  7. the author unpublishes; the member's copy remains and the withdraw notice shows.
Before step 4 the member puts their own words into the copy's outline (setup, recorded as INFO), so
step 6 has something to keep.

Every step records PASS, FAIL or INCONCLUSIVE with the rendered text it read. PASS needs every check
to have read the product's answer and found it right; FAIL is a product answer that was wrong;
INCONCLUSIVE is a step the driver could not read to its end (a timeout, an element that never came).
INCONCLUSIVE is never a pass. R-RAW: walk.json is rewritten after every step, before any verdict.

Usage (PowerShell, data dir single-quoted):
    python tools/notebook_style_library_walk.py --data-dir 'C:\\data-p3awalk' --port 8079 `
        --tip <sha> --out docs/notebook/evidence/p3a-walk-<run-id>

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
import notebook_fin_walk as fw  # noqa: E402  -- flag_sets, settle_first_run, BENIGN, VIEWPORTS

VIEWPORTS = fw.VIEWPORTS
LIBRARY_FLAGS = ["NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "NOTEBOOK_JOURNAL_STYLES_ENABLED", "NOTEBOOK_STYLE_LIBRARY_ENABLED"]
# Sandbox seed (throwaway data dir only; the walk tools' shared sandbox password).
AUTHOR = ("p3awalk-author@local.dev", "LocalTest2026!", "P3a Author")
MEMBER = ("p3awalk-member@local.dev", "LocalTest2026!", "P3a Member")
T = 30000

REC: dict = {"tool": "tools/notebook_style_library_walk.py", "steps": [], "setup": []}
OUT: Path | None = None


# ── words read from the source, never typed ───────────────────────────────────────────────

def _const(rel: str, name: str) -> str:
    src = (REPO / rel).read_text(encoding="utf-8")
    m = re.search(r"(?:export const|^)\s*" + re.escape(name) + r"\s*=\s*(['\"])(.*?)\1", src, re.M)
    if not m:
        raise SystemExit(f"REFUSED: could not read {name} from {rel}")
    return m.group(2)


STY = "app/src/pages/journal-2-0/components/notebook/styles"
GAL_PY = "api/services/journal_two/template_gallery.py"
SENT = _const(f"{STY}/ShareStyleForm.jsx", "SENT_SENTENCE")
REVISION_SENT = _const(f"{STY}/ShareStyleForm.jsx", "REVISION_SENT_SENTENCE")
TAKE_OUTLINE = _const(f"{STY}/LibraryUpdateSheet.jsx", "TAKE_OUTLINE_LABEL")
UPDATE_NOTICE = _const(GAL_PY, "UPDATE_NOTICE")
WITHDRAW_NOTICE = _const(GAL_PY, "WITHDRAW_NOTICE")
MY_RULES_LABEL = re.search(r"id: 'myRules',\s*label: '([^']+)'",
                           (REPO / "app/src/pages/journal-2-0/lib/journalBlocks.js").read_text(encoding="utf-8")).group(1)


# ── recorder ──────────────────────────────────────────────────────────────────────────────

def flush() -> None:
    if OUT is not None:
        tmp = OUT / "walk.json.tmp"
        tmp.write_text(json.dumps(REC, indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
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

    def read(self, what: str, text: str) -> str:
        self.row["rendered"].append({"what": what, "text": (text or "").strip()[:1500]})
        return text or ""

    def check(self, what: str, ok: bool, read: str) -> bool:
        self.row["checks"].append({"what": what, "ok": bool(ok), "read": (read or "")[:600]})
        return ok


def run_step(vp: str, n: int, title: str, fn, pages: dict) -> dict:
    st = Step(vp, n, title)
    try:
        fn(st)
        checks = st.row["checks"]
        st.row["verdict"] = "PASS" if checks and all(c["ok"] for c in checks) else "FAIL"
    except Exception as e:  # noqa: BLE001 -- a read the driver could not finish
        failed = [c for c in st.row["checks"] if not c["ok"]]
        st.row["verdict"] = "FAIL" if failed else "INCONCLUSIVE"
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


# ── accounts and pages ────────────────────────────────────────────────────────────────────

def new_ctx(browser, vp: str):
    wd, ht = VIEWPORTS[vp]
    touch = wd <= fw.TOUCH_MAX
    return browser.new_context(viewport={"width": wd, "height": ht}, has_touch=touch, is_mobile=touch,
                               reduced_motion="reduce")


def provision(browser, base: str) -> None:
    """Sign up the admin (promoted from ADMIN_EMAILS) and the two walk accounts; comp and verify them."""
    admin = browser.new_context()
    try:
        h._signup_or_login(admin.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        for email, pw, name in (AUTHOR, MEMBER):
            c = browser.new_context()
            try:
                h._signup_or_login(c.request, base, email, pw, name)
                comp = admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
                ver = admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
                me = c.request.get(base + "/api/auth/me").json()
                REC["setup"].append({"account": name, "comp": comp.status, "verify": ver.status,
                                     "paid_equiv": bool(me.get("paid_equiv")),
                                     "role": me.get("role") or (me.get("user") or {}).get("role")})
                if not me.get("paid_equiv"):
                    raise h.SetupFailed(f"{name} is not paid-equivalent (comp {comp.status}, verify {ver.status})")
            finally:
                c.close()
        me = admin.request.get(base + "/api/auth/me").json()
        role = me.get("role") or (me.get("user") or {}).get("role")
        REC["setup"].append({"account": "admin (ADMIN_EMAILS)", "role": role, "paid_equiv": bool(me.get("paid_equiv"))})
        if role != "admin":
            raise h.SetupFailed("the sandbox admin did not sign in as an admin")
    finally:
        admin.close()
    flush()


def signed_in(browser, base: str, vp: str, who) -> tuple:
    ctx = new_ctx(browser, vp)
    h._signup_or_login(ctx.request, base, who[0], who[1], who[2])
    pg = ctx.new_page()
    watch = Watch(pg)
    pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    fw.settle_first_run(pg)
    return ctx, pg, watch


def open_styles(pg, base: str):
    pg.goto(base + "/journal/notebook?styles=1", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(pg)
    dlg = pg.get_by_role("dialog", name="Journal styles")
    dlg.wait_for(timeout=T)
    return dlg


def open_library(pg, base: str):
    dlg = open_styles(pg, base)
    dlg.get_by_role("button", name="Community", exact=True).click(timeout=T)
    lib = pg.get_by_role("dialog", name="Community styles")
    lib.wait_for(timeout=T)
    lib.get_by_role("heading", name="Community gallery").wait_for(timeout=T)
    return lib


def gallery_message(lib, contains: str) -> str:
    msg = lib.locator("[data-gallery-message]")
    msg.filter(has_text=contains).wait_for(timeout=T)
    return msg.inner_text()


def notices_text(pg, base: str, must: str, tries: int = 6) -> str:
    """Research Home's Notices box, opened; reloaded until `must` shows (the box polls)."""
    text = ""
    for _ in range(tries):
        pg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
        h._dismiss_intro(pg)
        box = pg.locator('details[data-tour="home-notices"]')
        try:
            box.wait_for(timeout=15000)
            box.locator("summary").click(timeout=5000)
            text = box.inner_text(timeout=5000)
            if must in text:
                return text
        except Exception:  # noqa: BLE001
            pass
        time.sleep(5)
    return text


def doc(*paras: str) -> dict:
    return {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": p}]} for p in paras]}


def doc_text(d) -> str:
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "text":
                out.append(n.get("text", ""))
            for c in n.get("content") or []:
                walk(c)
    walk(d or {})
    return " ".join(out)


# ── the story ─────────────────────────────────────────────────────────────────────────────

def story(browser, base: str, vp: str, run: str) -> None:
    name = f"P3a walk {vp} {run}"
    v2 = f"{name} v2"
    own_words = f"My own words for {vp}: wait for the base to tighten."
    S: dict = {"name": name, "v2": v2}
    REC.setdefault("stories", {})[vp] = S
    actx, apg, aw = signed_in(browser, base, vp, AUTHOR)
    mctx, mpg, mw = signed_in(browser, base, vp, MEMBER)
    dctx = new_ctx(browser, vp)
    h._signup_or_login(dctx.request, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
    dpg = dctx.new_page()
    dw = Watch(dpg)
    dpg.goto(base + "/journal/notebook", wait_until="domcontentloaded", timeout=60000)
    h._dismiss_intro(dpg)
    fw.settle_first_run(dpg)
    pages = {"author": (apg, aw), "member": (mpg, mw), "admin": (dpg, dw)}

    def share(st, title_text: str, sentence: str) -> None:
        dlg = open_styles(apg, base)
        dlg.get_by_role("button", name=f"Share {name} to community").click(timeout=T)
        form = apg.get_by_role("form", name=f"Share {name} to community")
        form.wait_for(timeout=T)
        form.get_by_label("Title in the library").fill(title_text)
        form.get_by_label("Category").select_option("trade_plan")
        form.get_by_label("Trading style (optional)").select_option("swing")
        with apg.expect_response(lambda r: r.url.endswith("/api/j2/template-gallery/styles") and r.request.method == "POST",
                                 timeout=T) as resp:
            form.get_by_role("button", name="Submit").click(timeout=T)
        body = resp.value.json()
        S["gid"] = (body.get("template") or {}).get("id") or S.get("gid")
        status = dlg.get_by_text(sentence, exact=True)
        status.wait_for(timeout=T)
        st.check("the Styles manager says what happened", True, st.read("status line", status.inner_text()))
        st.check("the share was recorded (HTTP 200)", resp.value.status == 200, f"HTTP {resp.value.status}")

    def s1(st):
        r = actx.request.post(base + "/api/j2/journal-styles", data={
            "name": name, "kindId": "trade_plan",
            "blocks": [{"block": "positionSizing", "enabled": True, "settings": {}}],
            "outlineBodyJson": doc("Author outline, version one."), "properties": {}})
        st.check("the style was created (HTTP 200)", r.status == 200, f"HTTP {r.status} {r.text()[:200]}")
        S["style_id"] = r.json()["style"]["id"]
        dlg = open_styles(apg, base)
        row = dlg.locator("li").filter(has_text=name).first
        row.wait_for(timeout=T)
        st.check("the new style is a row in the Styles manager", name in st.read("style row", row.inner_text()), name)
        share(st, name, SENT)

    def approve(st, title: str, revision: bool) -> None:
        lib = open_library(dpg, base)
        lib.get_by_role("button", name="Review queue").click(timeout=T)
        row = lib.locator(f'[data-gallery-pending="{S["gid"]}"]')
        row.wait_for(timeout=T)
        row.get_by_text(re.compile(r"^Blocks: ")).wait_for(timeout=T)
        text = st.read("review queue row", row.inner_text())
        if revision:
            st.check("the row says it is an update to a listed style", "Update to a listed style (version 1)" in text, text)
            st.check("the row shows the update's own title", f"Title in this update: {v2}" in text, text)
            st.check("the row shows the update's added block", MY_RULES_LABEL in text, text)
        else:
            st.check("the row is the author's style, with its kind and trading style",
                     name in text and "Trading style: Swing" in text, text)
        row.get_by_role("button", name=f"Approve {title}").click(timeout=T)
        msg = gallery_message(lib, "Approved")
        st.check("the gallery says it is listed", f"Approved “{title}”. It is listed now." in st.read("message", msg), msg)

    def s2(st):
        approve(st, name, revision=False)

    def s3(st):
        lib = open_library(mpg, base)
        ts = lib.get_by_role("group", name="Filter by trading style")
        ts.get_by_role("button", name="Swing").click(timeout=T)
        card = lib.locator(f'[data-library-style][data-gallery-id="{S["gid"]}"]')
        card.wait_for(timeout=T)
        st.check("the style is listed under Styles, filtered Swing", name in st.read("card", card.inner_text()), name)
        card.get_by_role("button", name=f"Preview {name}").click(timeout=T)
        prev = mpg.get_by_role("dialog", name=name)
        prev.get_by_text("Author outline, version one.").wait_for(timeout=T)
        st.check("Preview shows the style's outline", True, st.read("preview", prev.inner_text()))
        prev.get_by_role("button", name="Close").first.click(timeout=T)
        prev.wait_for(state="hidden", timeout=T)
        card.get_by_role("button", name=f"Adopt {name}").click(timeout=T)
        confirm = card.get_by_role("group", name=f"Adopt {name}?")
        box = confirm.get_by_role("checkbox", name="Notify me when the author updates")
        st.check("Notify me starts unticked", not box.is_checked(), "unchecked" if not box.is_checked() else "checked")
        box.check(timeout=T)
        confirm.get_by_role("button", name="Adopt", exact=True).click(timeout=T)
        msg = gallery_message(lib, "to your styles")
        st.check("the gallery says the style was added", f'Added "{name}" to your styles.' in st.read("message", msg), msg)
        helpful = card.get_by_role("button", name=f"Helpful: {name}")
        helpful.click(timeout=T)
        card.locator('[data-helpful-count]').filter(has_text="1 found this helpful").wait_for(timeout=T)
        st.check("Helpful is pressed and counted", helpful.get_attribute("aria-pressed") == "true",
                 st.read("helpful", f"aria-pressed={helpful.get_attribute('aria-pressed')}; "
                         f"{card.locator('[data-helpful-count]').inner_text()}"))
        door = card.locator("[data-author-door]")
        S["handle"] = door.get_attribute("data-author-door")
        door.click(timeout=T)
        follow = lib.get_by_role("button", name=re.compile(r"^Follow "))
        follow.wait_for(timeout=T)
        st.read("author page", lib.inner_text()[:800])
        follow.click(timeout=T)
        following = lib.get_by_role("button", name=re.compile(r"^Following "))
        following.wait_for(timeout=T)
        st.check("Follow became Following", following.get_attribute("aria-pressed") == "true",
                 st.read("follow toggle", f"{following.inner_text()} aria-pressed={following.get_attribute('aria-pressed')}"))

    def own_words_setup() -> None:
        lst = mctx.request.get(base + "/api/j2/journal-styles").json()
        copy = next((s for s in lst.get("styles", []) if s.get("sourceGalleryId") == S.get("gid")), None)
        S["copy_id"], S["copy_name"] = (copy or {}).get("id"), (copy or {}).get("name")
        r = mctx.request.put(base + f"/api/j2/journal-styles/{S['copy_id']}", data={"outlineBodyJson": doc(own_words)}) \
            if copy else None
        REC["setup"].append({"viewport": vp, "what": "the member writes their own words into the copy's outline",
                             "copy_found": bool(copy), "status": r.status if r else None, "verdict": "INFO"})
        flush()

    def s4(st):
        r = actx.request.put(base + f"/api/j2/journal-styles/{S['style_id']}", data={
            "blocks": [{"block": "positionSizing", "enabled": True, "settings": {}},
                       {"block": "myRules", "enabled": True, "settings": {}}],
            "outlineBodyJson": doc("Author outline, version two.")})
        st.check("the author's change was saved (HTTP 200)", r.status == 200, f"HTTP {r.status} {r.text()[:200]}")
        share(st, v2, REVISION_SENT)
        lib = open_library(mpg, base)
        card = lib.locator(f'[data-library-style][data-gallery-id="{S["gid"]}"]')
        card.wait_for(timeout=T)
        title = st.read("the member's card title", card.locator("h4").inner_text())
        st.check("the member still sees the LISTED title, not the held update", title == name and title != v2, title)
        item = mctx.request.get(base + f"/api/j2/template-gallery/{S['gid']}").json().get("template") or {}
        st.check("the listed version is still 1 (the item read)", item.get("version") == 1 and item.get("title") == name,
                 f"version={item.get('version')} title={item.get('title')}")

    def s5(st):
        approve(st, name, revision=True)

    def s6(st):
        want = UPDATE_NOTICE.format(title=v2)
        text = notices_text(mpg, base, want)
        st.check("the update notice shows in Notices", want in st.read("notices", text), want)
        dlg = open_styles(mpg, base)
        upd = dlg.get_by_role("button", name=re.compile(r"^Updates \(\d+\)$"))
        upd.click(timeout=T)
        st.read("updates button", upd.inner_text())
        dlg.get_by_role("button", name=f"Review the update to {S['copy_name']}").click(timeout=T)
        sheet = mpg.get_by_role("dialog", name=f"Update {S['copy_name']}")
        adds = sheet.get_by_text(re.compile(r"^Adds blocks: "))
        adds.wait_for(timeout=T)
        line = st.read("adds blocks", adds.inner_text())
        st.check('the sheet says "Adds blocks" with the new block', line == f"Adds blocks: {MY_RULES_LABEL}", line)
        box = sheet.get_by_role("checkbox", name=TAKE_OUTLINE)
        st.check("the author's outline box starts unticked", not box.is_checked(),
                 "unchecked" if not box.is_checked() else "checked")
        sheet.get_by_role("button", name="Update my copy").click(timeout=T)
        status = dlg.get_by_text(re.compile(r"^Updated .* to the author's version 2\.$"))
        status.wait_for(timeout=T)
        st.check("the Styles manager says the copy was updated", True, st.read("status line", status.inner_text()))
        mine = mctx.request.get(base + f"/api/j2/journal-styles/{S['copy_id']}").json().get("style") or {}
        kept = doc_text(mine.get("outlineBodyJson"))
        st.check("the own-words outline is kept (the copy read)", own_words in kept and "version two" not in kept, kept)
        st.check("the copy gained the block", any(b.get("block") == "myRules" for b in mine.get("blocks") or []),
                 json.dumps([b.get("block") for b in mine.get("blocks") or []]))

    def s7(st):
        lib = open_library(apg, base)
        lib.get_by_role("button", name="Your submissions").click(timeout=T)
        row = lib.locator(f'[data-gallery-row="{S["gid"]}"]')
        row.wait_for(timeout=T)
        title = row.locator("h4").inner_text()
        row.get_by_role("button", name=f"Unpublish {title}").click(timeout=T)
        row.get_by_role("group", name=f"Unpublish {title}?").get_by_role("button", name="Unpublish", exact=True).click(timeout=T)
        msg = gallery_message(lib, "Unpublished")
        st.check("the gallery says it was unpublished and copies stay", f"Unpublished “{title}”." in st.read("message", msg), msg)
        want = WITHDRAW_NOTICE.format(title=title)
        text = notices_text(mpg, base, want)
        st.check("the withdraw notice shows in the member's Notices", want in st.read("notices", text), want)
        dlg = open_styles(mpg, base)
        row = dlg.locator("li").filter(has_text=S["copy_name"]).first
        row.wait_for(timeout=T)
        st.check("the member's copy is still in their styles", S["copy_name"] in st.read("copy row", row.inner_text()),
                 S["copy_name"])

    try:
        for n, title, fn in ((1, "author creates a style and shares it", s1),
                             (2, "admin approves it in the review panel", s2),
                             (3, "member browses Styles, Swing, previews, adopts with notify, Helpful, author page, follows", s3)):
            run_step(vp, n, title, fn, pages)
        if S.get("gid"):
            own_words_setup()
        for n, title, fn in ((4, "author updates and shares again; the listed version is unchanged", s4),
                             (5, "admin approves the revision", s5),
                             (6, "member sees the notice, opens Updates, Adds blocks, updates without the outline, own words kept", s6),
                             (7, "author unpublishes; the member's copy remains and the withdraw notice shows", s7)):
            run_step(vp, n, title, fn, pages)
    finally:
        # Housekeeping for the next viewport's story (a fresh follow): recorded, never a verdict.
        if S.get("handle"):
            r = mctx.request.delete(base + f"/api/j2/template-gallery/authors/{S['handle']}/follow")
            REC["setup"].append({"viewport": vp, "what": "unfollow after the story", "status": r.status, "verdict": "INFO"})
        for c in (actx, mctx, dctx):
            c.close()
        flush()


# ── boot ──────────────────────────────────────────────────────────────────────────────────

def set_env(fs: dict) -> list[str]:
    on = sorted(set(fs["c1"]) | set(LIBRARY_FLAGS))
    for name in fs["all_names"]:
        os.environ.pop(name, None)
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    os.environ.update({name: "1" for name in on})
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    return on


def main(argv=None) -> int:
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8079)
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
    data_dir.mkdir(parents=True, exist_ok=True)
    OUT = Path(args.out)
    OUT.mkdir(parents=True, exist_ok=True)
    tree = subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip()
    fs = fw.flag_sets()
    on = set_env(fs)
    base = f"http://127.0.0.1:{args.port}"
    REC.update({"tip": args.tip, "tool_tree": tree, "base": base, "data_dir": str(data_dir), "flags_on": on,
                "started": datetime.now(timezone.utc).isoformat(timespec="seconds"), "status": "INCOMPLETE (run did not finish)"})
    flush()
    sb = h.Sandbox(str(data_dir), args.port, OUT / "sandbox.log")
    sb.start()
    not_run, failure = None, None
    try:
        if not sb.wait_healthy(base, 400):
            not_run = "the sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(h.POST_BOOT, h.POST_BOOT_WAIT_S)
            import sandbox_identity
            v = sandbox_identity.verify(base, sb.integrity_path())
            REC["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
        if not not_run:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as p:
                browser = p.chromium.launch()
                try:
                    provision(browser, base)
                    run = datetime.now(timezone.utc).strftime("%H%M%S")
                    for vp in [x.strip() for x in args.viewports.split(",") if x.strip()]:
                        story(browser, base, vp, run)
                except h.SetupFailed as e:
                    not_run = str(e)[:400]
                except Exception as e:  # noqa: BLE001
                    failure = f"{type(e).__name__}: {str(e)[:400]}"
                    REC["traceback"] = traceback.format_exc()[-3000:]
                finally:
                    browser.close()
        sb.wait_checkpoint(h.PREWARM, h.PREWARM_WAIT_S)
    finally:
        REC["stop"] = sb.stop()
    integ = h.read_integrity(sb.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.PREWARM, h.SHUTDOWN])
    ipath = sb.integrity_path()
    if ipath and Path(ipath).is_file():
        kept = OUT / "integrity.md"
        kept.write_text(f"tip under test: {args.tip}\n\n" + Path(ipath).read_text(encoding="utf-8", errors="replace"),
                        encoding="utf-8", newline="\n")
        integ["path"] = str(kept)
    REC["integrity"] = integ
    REC["first_line"] = h.integrity_line(integ, f"stop: {sb.stop_how}", not_run=not_run)
    print(REC["first_line"])
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
