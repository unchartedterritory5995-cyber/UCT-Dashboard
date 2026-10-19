"""Notebook P5 (starter packs, the B4 tours, telemetry), Task 10 -- one real-browser walk of a new member's
first meeting with journal styles, read off the RENDERED pages, in the shape of the P3a walk
(tools/notebook_style_library_walk.py).

PRECONDITIONS (the run refuses or records NOT RUN without each; it never assumes one):
  * a sandbox booted from the tip under test, through scripts/hub_sandbox_boot.py (this tool boots its own via
    notebook_perf_harness.Sandbox, on an EMPTY data dir outside C:\\data, on a free port; it refuses a busy port
    and never kills another process). The launcher applies the AST-derived data-path census and hashes the
    shared root before boot, at +15 s, at +120 s and at shutdown; that verdict is the run's first line and is
    kept as integrity.md beside walk.json;
  * `app/dist` rebuilt from that tip (`cd app && npm run build`) -- the sandbox serves the built bundle;
  * the switches the walk needs, ON in the sandbox env (P5_FLAGS below: journal styles, the template gallery,
    the style library, the starter packs, and the Learn menu's onboarding switch), on top of the flags the
    ledger records as armed on web (notebook_fin_walk.flag_sets()["c1"]). With the starter switch at 0 the
    firm style rows are hidden everywhere (P5-AUD-1), so the library tour's Adopt step needs it on too.
    Each name is checked against the ledger's gate list first; an unknown name refuses the run;
  * ONE fresh paid member per viewport (signed up through the app, comped and email-verified by the admin
    through the app's own admin routes; /api/auth/me must say paid-equivalent), so each viewport meets the
    offer the way a new member does: no styles of their own, `notebook_starter_pack` unset;
  * an ADMIN account through ADMIN_EMAILS (notebook_perf_harness.ADMIN_EMAIL), promoted at sign-in, used only
    for the comp/verify routes and the telemetry read.
  The accounts and their password are this tool's SANDBOX SEED; they exist only in the throwaway data dir.

THE STORY, once per viewport (1280, 820, 390):
  1. the member opens New note > From a style and sees How do you trade?;
  2. picks Swing and sees the three Swing styles added;
  3. creates a note from "Swing trade plan"; its blocks and outline headings render;
  4. reloads: the offer is gone, and the Styles manager's Starter packs button opens it again;
  5. runs the Journal styles tour from the Learn menu through every step;
  6. runs the Community library tour, opening the gallery when the card asks;
  7. the admin's telemetry count has style_applied >= 1, and it rose during this viewport's story.

Every step records PASS, FAIL or INCONCLUSIVE with the rendered text it read. PASS needs every check to have
read the product's answer and found it right; FAIL is a product answer that was wrong; INCONCLUSIVE is a step
the driver could not read to its end. A declared step that left no row is a FAIL ("never ran"), never a
silent skip. R-RAW: walk.json is rewritten after every step, before any verdict.

Waiting is always a Playwright call (`wait_for`, `expect_response`, `page.wait_for_timeout`), never
time.sleep: the sync API delivers events only during Playwright calls. The intro overlay that every page load
plays is dismissed with mobile_audit._dismiss_intro (which refuses to go on if it is still up).

Usage (PowerShell, data dir single-quoted):
    python tools/notebook_p5_walk.py --data-dir 'C:\\data-p5walk' --port 8181 `
        --tip <sha> --out docs/notebook/evidence/p5-walk-<run-id>

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

REPO = Path(__file__).resolve().parents[1]
for _p in (REPO / "tools", REPO / "scripts"):
    if str(_p) not in sys.path:
        sys.path.insert(0, str(_p))

import notebook_perf_harness as h  # noqa: E402
import notebook_fin_walk as fw  # noqa: E402  -- flag_sets, settle_first_run, BENIGN, VIEWPORTS
import notebook_w14q2_tours_walk as q2  # noqa: E402  -- the tour card's state probe (STATE_JS)
import mobile_audit as ma  # noqa: E402  -- _dismiss_intro

VIEWPORTS = fw.VIEWPORTS
P5_FLAGS = ["NOTEBOOK_JOURNAL_STYLES_ENABLED", "NOTEBOOK_TEMPLATE_GALLERY_ENABLED", "NOTEBOOK_STYLE_LIBRARY_ENABLED",
            "NOTEBOOK_STARTER_PACKS_ENABLED", "NOTEBOOK_ONBOARDING_ENABLED"]
PW = "LocalTest2026!"   # sandbox seed (throwaway data dir only; the walk tools' shared sandbox password)
T = 30000
PACK = "swing"
STYLE_TO_USE = "Swing trade plan"
TRADE_PLAN_KIND = "trade_plan"

# The declared story. A (viewport, step) with no row at the end is a FAIL, never a skip.
STEPS = (
    (1, "New note > From a style shows How do you trade?"),
    (2, "picking Swing adds the three Swing styles"),
    (3, "a note from Swing trade plan renders its blocks and outline headings"),
    (4, "after a reload the offer is gone; the Styles manager's Starter packs button opens it"),
    (5, "the Journal styles tour runs from the Learn menu through every step"),
    (6, "the Community library tour runs, opening the gallery when asked"),
    (7, "the admin telemetry count has style_applied >= 1, and it rose in this story"),
)

REC: dict = {"tool": "tools/notebook_p5_walk.py", "steps": [], "setup": []}
OUT: Path | None = None


# ── words read from the source, never typed ───────────────────────────────────────────────

def _const(rel: str, name: str) -> str:
    src = (REPO / rel).read_text(encoding="utf-8")
    m = re.search(r"(?:export const|^)\s*" + re.escape(name) + r"\s*=\s*(['\"])(.*?)\1", src, re.M)
    if not m:
        raise SystemExit(f"REFUSED: could not read {name} from {rel}")
    return m.group(2)


J2 = "app/src/pages/journal-2-0"
OFFER_TITLE = _const(f"{J2}/components/notebook/styles/StarterPackOffer.jsx", "OFFER_TITLE")
OFFER_LINE = _const(f"{J2}/components/notebook/styles/StarterPackOffer.jsx", "OFFER_LINE")
PACK_LABELS = re.findall(r"label:'([^']+)'", re.search(r"export const PACKS = Object\.freeze\(\[(.*?)\]\)",
                         (REPO / f"{J2}/lib/starterPacks.js").read_text(encoding="utf-8"), re.S).group(1))
_SEED = json.loads((REPO / "api/services/journal_two/template_gallery_style_seed.json").read_text(encoding="utf-8"))
_SEED_ROWS = _SEED if isinstance(_SEED, list) else (_SEED.get("rows") or _SEED.get("styles") or [])
PACK_TITLES = [r["title"] for r in _SEED_ROWS if r.get("pack") == PACK]
USE_ROW = next(r for r in _SEED_ROWS if r.get("title") == STYLE_TO_USE)
_BLOCKS_JS = (REPO / f"{J2}/lib/journalBlocks.js").read_text(encoding="utf-8")


def block_label(block_id: str) -> str | None:
    m = re.search(r"id: '" + re.escape(block_id) + r"',\s*label: '([^']+)'", _BLOCKS_JS)
    return m.group(1) if m else None


def tour_steps(const: str) -> int:
    """How many steps b4Styles.steps.js declares for one tour (the entries of `const`)."""
    src = (REPO / f"{J2}/components/notebook/onboarding/tours/b4Styles.steps.js").read_text(encoding="utf-8")
    body = re.search(r"export const " + const + r" = Object\.freeze\(\[(.*?)\n\]\)", src, re.S)
    if not body:
        raise SystemExit(f"REFUSED: could not read {const} from b4Styles.steps.js")
    return len(re.findall(r"^\s*(?:step\(|Object\.freeze\(\{ id:)", body.group(1), re.M))


def tour_title(tour_id: str) -> str:
    src = (REPO / f"{J2}/components/notebook/onboarding/tours/b4Styles.js").read_text(encoding="utf-8")
    m = re.search(r"id: '" + re.escape(tour_id) + r"',.*?title: '([^']+)'", src, re.S)
    if not m:
        raise SystemExit(f"REFUSED: could not read the title of {tour_id}")
    return m.group(1)


JS_TOUR, LIB_TOUR = "journal-styles", "style-library"
JS_STEPS, LIB_STEPS = tour_steps("JOURNAL_STYLES_STEPS"), tour_steps("STYLE_LIBRARY_STEPS")


# ── recorder (the P3a walk's, unchanged in shape) ─────────────────────────────────────────

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

    def read(self, what: str, text) -> str:
        text = "" if text is None else str(text)
        self.row["rendered"].append({"what": what, "text": text.strip()[:1500]})
        return text

    def check(self, what: str, ok: bool, read) -> bool:
        self.row["checks"].append({"what": what, "ok": bool(ok), "read": ("" if read is None else str(read))[:600]})
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


def unregistered_rows(viewports: list[str]) -> list[dict]:
    """Every declared (viewport, step) that left no row: each one is a FAIL, never skipped."""
    seen = {(s["viewport"], s["step"]) for s in REC["steps"]}
    out = []
    for vp in viewports:
        for n, title in STEPS:
            if (vp, n) not in seen:
                out.append({"viewport": vp, "step": n, "title": title, "checks": [], "rendered": [],
                            "verdict": "FAIL", "error": "never ran: the step left no row"})
    return out


# ── pages ─────────────────────────────────────────────────────────────────────────────────

def dismiss_intro(pg) -> None:
    """The intro plays on every page load. Wait for it (it mounts a beat after DOMContentLoaded), then
    mobile_audit's recipe, which raises if it is still up rather than measuring the overlay."""
    try:
        pg.locator(ma._INTRO_SEL).first.wait_for(state="visible", timeout=5000)
    except Exception:  # noqa: BLE001 -- it did not play in this tab
        return
    ma._dismiss_intro(pg)


def skip_base_tour(pg) -> bool:
    """A new member's notes list starts the base Notebook tour by itself ("Folders and tags", step 1 of 5), and
    its layer takes every click (run 2, evidence p5-walk-20261018T0100Z). A member who came to start a note
    presses Skip tour; so does the walk, and it records that it did."""
    skip = pg.locator("[data-tour-card]").get_by_role("button", name="Skip tour", exact=True)
    try:
        skip.first.wait_for(state="visible", timeout=6000)
    except Exception:  # noqa: BLE001 -- no tour started on this page
        return False
    card = pg.locator("[data-tour-card]").first.inner_text(timeout=3000)
    skip.first.click(timeout=T)
    pg.locator("[data-tour-card]").first.wait_for(state="hidden", timeout=T)
    REC["setup"].append({"what": "skipped the base Notebook tour a new member is shown", "card": card[:200],
                         "url": pg.url, "verdict": "INFO"})
    flush()
    return True


def settle(pg) -> None:
    dismiss_intro(pg)
    fw.settle_first_run(pg)
    skip_base_tour(pg)


def goto(pg, base: str, path: str) -> None:
    pg.goto(base + path, wait_until="domcontentloaded", timeout=60000)
    settle(pg)


def new_ctx(browser, vp: str):
    wd, ht = VIEWPORTS[vp]
    touch = wd <= fw.TOUCH_MAX
    return browser.new_context(viewport={"width": wd, "height": ht}, has_touch=touch, is_mobile=touch,
                               reduced_motion="reduce")


def paced_signup(req, pacer, base: str, email: str, pw: str, name: str) -> None:
    """Sign up through the app, waiting out its 3/minute sign-up limit (auth.py `signup`) on a 429.
    Run 1 (evidence p5-walk-20261018T0040Z) made four sign-ups in one minute; the fourth answered 429 and the
    walk recorded NOT RUN. The wait is a Playwright call on `pacer` (a page), never time.sleep."""
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
    h._signup_or_login(req, base, email, pw, name)      # an account that already exists signs in


def provision(browser, base: str, members: dict) -> None:
    """Sign up the admin (promoted from ADMIN_EMAILS) and one walk member per viewport; comp and verify them."""
    admin = browser.new_context()
    pacer = admin.new_page()
    try:
        paced_signup(admin.request, pacer, base, h.ADMIN_EMAIL, h.ADMIN_PW, "hubtest")
        for vp, (email, pw, name) in members.items():
            c = browser.new_context()
            try:
                paced_signup(c.request, pacer, base, email, pw, name)
                comp = admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
                ver = admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
                me = c.request.get(base + "/api/auth/me").json()
                REC["setup"].append({"account": name, "viewport": vp, "comp": comp.status, "verify": ver.status,
                                     "paid_equiv": bool(me.get("paid_equiv")),
                                     "starter_packs_key": me.get("notebook_starter_packs_enabled")})
                if not me.get("paid_equiv"):
                    raise h.SetupFailed(f"{name} is not paid-equivalent (comp {comp.status}, verify {ver.status})")
                if me.get("notebook_starter_packs_enabled") is not True:
                    raise h.SetupFailed(f"{name}'s auth payload does not carry the starter-packs switch on")
            finally:
                c.close()
        me = admin.request.get(base + "/api/auth/me").json()
        role = me.get("role") or (me.get("user") or {}).get("role")
        REC["setup"].append({"account": "admin (ADMIN_EMAILS)", "role": role})
        if role != "admin":
            raise h.SetupFailed("the sandbox admin did not sign in as an admin")
    finally:
        admin.close()
    flush()


def style_applied_count(admin_req, base: str) -> int | None:
    r = admin_req.get(base + "/api/admin/notebook-telemetry")
    if r.status != 200:
        return None
    return int((((r.json().get("windows") or {}).get("7") or {}).get("style_applied") or {}).get("count") or 0)


def open_from_a_style(pg, base: str):
    """The notes list's caret > From a style: the picker sheet with the kinds on top."""
    goto(pg, base, "/journal/notebook?view=all")
    caret = pg.get_by_role("button", name="More ways to start a note", exact=True).first
    caret.wait_for(timeout=T)
    caret.click(timeout=T)
    pg.get_by_role("menuitem", name="From a style").first.click(timeout=T)
    group = pg.get_by_role("group", name="Start from a kind of note")
    group.wait_for(timeout=T)
    return group


def run_tour(pg, st: Step, tour_id: str, declared: int, seen: dict) -> dict:
    """Start `tour_id` from Research Home's Learn menu and walk it to Done. A "do this to continue" step is
    answered the way a member does: a press on the control the card points at."""
    title = tour_title(tour_id)
    learn = pg.get_by_role("button", name="Learn", exact=True).first
    learn.wait_for(timeout=T)
    learn.click(timeout=T)
    item = pg.locator(f'[data-learn-tour="{tour_id}"]').first
    item.wait_for(timeout=T)
    st.read("Learn menu item", item.inner_text())
    item.click(timeout=T)
    out = {"shown": [], "of": None, "pressed": [], "done": False, "notes": [], "cards": []}
    s = q2.wait_state(pg, title, lambda x: x["kind"] == "step" and not x["moving"], 25)
    for _ in range(declared + 6):
        if s["kind"] != "step":
            out["notes"].append(f"no card: {s}")
            break
        n = s["n"]
        out["of"] = s["of"]
        if n not in out["shown"]:
            out["shown"].append(n)
            out["cards"].append({"n": n, "title": s["title"], "waiting": s["waiting"], "active": s["active"]})
        if s["hasDone"]:
            pg.locator("[data-tour-card] button").filter(has_text=re.compile(r"^Done$")).first.click(timeout=T)
            gone = q2.wait_state(pg, title, lambda x: x["kind"] != "step", 8)
            out["done"] = gone["kind"] != "step"
            break
        if s["waiting"]:
            tgt = pg.locator('[data-tour-active="true"]').first
            tgt.scroll_into_view_if_needed(timeout=5000)
            try:
                tgt.click(timeout=8000)
            except Exception as e:  # noqa: BLE001 -- the press may have landed; the card says whether it did
                moved = q2.wait_state(pg, title, lambda x, n0=n: x["kind"] != "step" or x["n"] != n0, 6)
                out["notes"].append(f"step {n}: the click reported {type(e).__name__}; the card then read "
                                    f"{moved.get('kind')} {moved.get('n')}")
                if moved["kind"] == "step" and moved["n"] == n:
                    tgt.click(timeout=8000, force=True)
                    out["notes"].append(f"step {n}: pressed again with force (recorded, not a member's tap)")
            out["pressed"].append(n)
        else:
            pg.locator("[data-tour-card] button").filter(has_text=re.compile(r"^Next$")).first.click(timeout=T)
        s = q2.wait_state(pg, title, lambda x, n0=n: x["kind"] != "step" or (x["n"] != n0 and not x["moving"]), 15)
        for what, sel in seen.items():      # what the pressed controls opened, read once it is on screen
            if seen[what] is not True and pg.locator(sel).count() and pg.locator(sel).first.is_visible():
                seen[what] = True
    st.read("tour", json.dumps({**out, "seen": seen}))
    return out


# ── the story ─────────────────────────────────────────────────────────────────────────────

def story(browser, base: str, vp: str, who, admin_req) -> None:
    S: dict = {"member": who[0]}
    REC.setdefault("stories", {})[vp] = S
    ctx = new_ctx(browser, vp)
    r = ctx.request.post(base + "/api/auth/login", data={"email": who[0], "password": who[1]})
    if r.status not in (200, 201):
        raise h.SetupFailed(f"could not sign in {who[0]}: HTTP {r.status}")
    pg = ctx.new_page()
    watch = Watch(pg)
    pages = {"member": (pg, watch)}
    S["style_applied_before"] = style_applied_count(admin_req, base)
    flush()

    def s1(st):
        mine = [s for s in ctx.request.get(base + "/api/j2/journal-styles").json().get("styles", []) if not s.get("builtin")]
        st.check("the member starts with no styles of their own (the styles list)", not mine, json.dumps([s.get("name") for s in mine]))
        group = open_from_a_style(pg, base)
        st.read("kind picker", group.inner_text())
        offer = pg.get_by_role("region", name=OFFER_TITLE)
        offer.wait_for(timeout=T)
        text = st.read("offer", offer.inner_text())
        st.check("the offer says what it does", OFFER_LINE in text, text)
        labels = [b for b in PACK_LABELS if offer.get_by_role("button", name=b, exact=True).count() == 1]
        st.check("every pack is a button", labels == PACK_LABELS, f"found {labels} of {PACK_LABELS}")
        st.check("Not now is offered", offer.get_by_role("button", name="Not now", exact=True).count() == 1, "Not now")

    def s2(st):
        offer = pg.get_by_role("region", name=OFFER_TITLE)
        with pg.expect_response(lambda r: r.request.method == "POST" and f"/starter-packs/{PACK}" in r.url,
                                timeout=T) as resp:
            offer.get_by_role("button", name="Swing", exact=True).click(timeout=T)
        st.check("the install was accepted (HTTP 200)", resp.value.status == 200, f"HTTP {resp.value.status}")
        added = offer.locator('[role="status"] p').filter(has_text=re.compile(r"^Added: "))
        added.wait_for(timeout=T)
        line = st.read("added line", added.inner_text())
        st.check("the answer names each of the three Swing styles",
                 len(PACK_TITLES) == 3 and all(t in line for t in PACK_TITLES), f"{line} | want {PACK_TITLES}")
        mine = [s.get("name") for s in ctx.request.get(base + "/api/j2/journal-styles").json().get("styles", [])
                if not s.get("builtin")]
        st.check("the member now owns exactly those three styles (the styles list)", sorted(mine) == sorted(PACK_TITLES),
                 json.dumps(mine))
        done = offer.get_by_role("button", name="Done", exact=True)
        st.check("Not now became Done", done.count() == 1, "Done")
        done.click(timeout=T)
        offer.wait_for(state="detached", timeout=T)

    def s3(st):
        listing = ctx.request.get(base + "/api/j2/journal-styles").json()
        kind = next(k["name"] for k in listing["kinds"] if k["id"] == TRADE_PLAN_KIND)
        group = pg.get_by_role("group", name="Start from a kind of note")
        if not group.is_visible():
            group = open_from_a_style(pg, base)
        pg.get_by_role("button", name=f"Choose another style for {kind}", exact=True).click(timeout=T)
        lst = pg.get_by_role("list", name=f"Styles for {kind}")
        lst.wait_for(timeout=T)
        st.read("styles for the kind", lst.inner_text())
        with pg.expect_response(lambda r: r.request.method == "POST" and re.search(r"/api/j2/notes(\?|$)", r.url),
                                timeout=T) as made:
            lst.get_by_role("button", name=f"Use {STYLE_TO_USE}", exact=True).click(timeout=T)
        st.check("the note was created (HTTP 200/201)", made.value.status in (200, 201), f"HTTP {made.value.status}")
        note = (made.value.json() or {}).get("note") or {}
        S["note_id"] = note.get("id")
        ed = pg.locator(".ProseMirror").first
        ed.wait_for(timeout=T)
        heads = [x.strip() for x in ed.locator("h1, h2, h3, h4").all_inner_texts()]
        st.read("editor headings", json.dumps(heads))
        want = USE_ROW["outlineHeadings"]
        st.check("every outline heading renders in the editor", all(w in heads for w in want), f"{heads} | want {want}")
        for b in ("preEntryChecklist", "positionSizing"):
            label = block_label(b)
            grp = pg.get_by_role("group", name=label, exact=True).first if label else None
            vis = False
            if grp is not None:
                try:
                    grp.wait_for(timeout=15000)
                    vis = grp.is_visible()
                except Exception:  # noqa: BLE001
                    vis = False
            st.check(f"the {label or b} block renders", vis, label or f"no label for {b}")
        got = ctx.request.get(base + f"/api/j2/notes/{S['note_id']}").json().get("note") or {}
        ids = [(n.get("attrs") or {}).get("widgetId") for n in (got.get("bodyJson") or {}).get("content", [])
               if n.get("type") == "widgetEmbed"]
        st.read("note body blocks", json.dumps(ids))
        st.check("the saved note carries every block of the style, in order", ids == [b["block"] for b in USE_ROW["blocks"]],
                 f"{ids} | want {[b['block'] for b in USE_ROW['blocks']]}")

    def s4(st):
        pg.reload(wait_until="domcontentloaded", timeout=60000)
        settle(pg)
        group = open_from_a_style(pg, base)
        st.read("kind picker after reload", group.inner_text())
        pg.wait_for_timeout(2500)        # the preference read settles; the offer decision follows it
        n = pg.get_by_role("region", name=OFFER_TITLE).count()
        st.check("the offer is gone from New note > From a style", n == 0, f"{n} offer region(s)")
        pg.keyboard.press("Escape")
        goto(pg, base, "/journal/notebook?styles=1")
        dlg = pg.get_by_role("dialog", name="Journal styles")
        dlg.wait_for(timeout=T)
        pg.wait_for_timeout(1500)        # the list and the preference read settle before the absence is read
        before = dlg.get_by_role("region", name=OFFER_TITLE).count()
        st.check("the Styles manager does not offer it by itself", before == 0, f"{before} offer region(s)")
        btn = dlg.get_by_role("button", name="Starter packs", exact=True)
        btn.click(timeout=T)
        offer = dlg.get_by_role("region", name=OFFER_TITLE)
        offer.wait_for(timeout=T)
        text = st.read("offer from Starter packs", offer.inner_text())
        st.check("Starter packs opens How do you trade?", OFFER_LINE in text, text)
        st.check("the button says it is expanded", btn.get_attribute("aria-expanded") == "true",
                 f"aria-expanded={btn.get_attribute('aria-expanded')}")
        pg.keyboard.press("Escape")

    def s5(st):
        goto(pg, base, "/journal/notebook")
        seen = {"styles_manager": '[role="dialog"] [data-tour="styles-manager"]'}
        out = run_tour(pg, st, JS_TOUR, JS_STEPS, seen)
        st.check(f"every declared step was shown, in order ({JS_STEPS})", out["shown"] == list(range(1, JS_STEPS + 1)),
                 json.dumps(out["shown"]))
        st.check("the card counts the declared steps", out["of"] == JS_STEPS, f"of={out['of']} declared={JS_STEPS}")
        st.check("the first step's control was pressed and opened the Styles manager",
                 out["pressed"] == [1] and seen["styles_manager"] is True, json.dumps({"pressed": out["pressed"], **seen}))
        st.check("Done closed the tour", out["done"], json.dumps(out["notes"]))
        st.check("every control the card asked for took a plain press (no forced press)",
                 not any("with force" in x for x in out["notes"]), json.dumps(out["notes"]))
        pg.keyboard.press("Escape")

    def s6(st):
        goto(pg, base, "/journal/notebook")
        seen = {"picker_door": '[data-tour="template-gallery-door"]', "gallery_types": '[data-tour="library-types"]'}
        out = run_tour(pg, st, LIB_TOUR, LIB_STEPS, seen)
        st.check(f"every declared step was shown, in order ({LIB_STEPS})", out["shown"] == list(range(1, LIB_STEPS + 1)),
                 json.dumps(out["shown"]))
        st.check("the card counts the declared steps", out["of"] == LIB_STEPS, f"of={out['of']} declared={LIB_STEPS}")
        st.check("the two do-this steps were answered by pressing their controls", out["pressed"] == [1, 2],
                 json.dumps(out["pressed"]))
        st.check("the gallery opened when the card asked (the type chips showed)", seen["gallery_types"] is True,
                 json.dumps(seen))
        heading = pg.get_by_role("heading", name="Community gallery").count()
        st.read("gallery heading count", heading)
        st.check("Done closed the tour", out["done"], json.dumps(out["notes"]))
        st.check("every control the card asked for took a plain press (no forced press)",
                 not any("with force" in x for x in out["notes"]), json.dumps(out["notes"]))
        pg.keyboard.press("Escape")

    def s7(st):
        before = S.get("style_applied_before")
        count = None
        for _ in range(10):                 # the event is fire-and-forget; give it a moment to land
            count = style_applied_count(admin_req, base)
            if count is not None and before is not None and count > before:
                break
            pg.wait_for_timeout(1000)
        S["style_applied_after"] = count
        st.read("style_applied (7-day window)", f"before={before} after={count}")
        st.check("the admin can read the telemetry", count is not None, f"count={count}")
        st.check("style_applied >= 1", (count or 0) >= 1, f"count={count}")
        st.check("it rose during this viewport's story", count is not None and before is not None and count > before,
                 f"before={before} after={count}")

    try:
        for n, title in STEPS:
            run_step(vp, n, title, {1: s1, 2: s2, 3: s3, 4: s4, 5: s5, 6: s6, 7: s7}[n], pages)
    finally:
        ctx.close()
        flush()


# ── boot ──────────────────────────────────────────────────────────────────────────────────

def set_env(fs: dict) -> list[str]:
    unknown = [n for n in P5_FLAGS if n not in fs["gates"]]
    if unknown:
        raise SystemExit(f"REFUSED: not a gate the ledger knows: {unknown}")
    on = sorted(set(fs["c1"]) | set(P5_FLAGS))
    for name in fs["all_names"]:
        os.environ.pop(name, None)
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    os.environ.pop("ALLOW_LOCAL_VENDOR_SOCKETS", None)
    os.environ.update({name: "1" for name in on})
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    return on


def main(argv=None) -> int:
    global OUT
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8181)
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
    on = set_env(fs)
    base = f"http://127.0.0.1:{args.port}"
    run = datetime.now(timezone.utc).strftime("%H%M%S")
    members = {vp: (f"p5walk-{vp}-{run}@local.dev", PW, f"P5 Walk {vp}") for vp in viewports}
    REC.update({"tip": args.tip, "tool_tree": tree, "base": base, "data_dir": str(data_dir), "flags_on": on,
                "viewports": viewports, "declared_steps": [list(s) for s in STEPS],
                "source_words": {"offer_title": OFFER_TITLE, "offer_line": OFFER_LINE, "packs": PACK_LABELS,
                                 "swing_titles": PACK_TITLES, "journal_styles_steps": JS_STEPS,
                                 "style_library_steps": LIB_STEPS},
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
                browser = p.chromium.launch()      # Playwright's own headless Chromium, never the owner's Chrome
                admin = browser.new_context()
                try:
                    provision(browser, base, members)
                    r = admin.request.post(base + "/api/auth/login", data={"email": h.ADMIN_EMAIL, "password": h.ADMIN_PW})
                    if r.status not in (200, 201):
                        raise h.SetupFailed(f"the admin could not sign in for the telemetry read: HTTP {r.status}")
                    for vp in viewports:
                        story(browser, base, vp, members[vp], admin.request)
                except h.SetupFailed as e:
                    not_run = str(e)[:400]
                except Exception as e:  # noqa: BLE001
                    failure = f"{type(e).__name__}: {str(e)[:400]}"
                    REC["traceback"] = traceback.format_exc()[-3000:]
                finally:
                    admin.close()
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
    if not not_run:
        REC["steps"].extend(unregistered_rows(viewports))
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
