"""Post-merge production check for PR #331 (Tier 2 part A): `/plan NVDA` from the slash menu.

Headless Playwright, its OWN context, signed in as the synthetic smoke account through the API
(SMOKE_EMAIL / SMOKE_PASSWORD, never printed). Makes one source note, types "/plan NVDA", presses
Enter, follows the link, checks the plan note holds chart + sizing + checklist with ticker NVDA,
then trashes BOTH notes through the product's own DELETE. Raw record written first and throughout.

Exit 0 PASS, 1 a measured failure, 2 INCONCLUSIVE.
Usage: python plan_prod_walk.py <base> <out-dir>
"""
import json
import os
import pathlib
import re
import sys
import time

BASE, OUT = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
REC = {"base": BASE, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "checks": [],
       "page_errors": [], "notes": [], "cleanup": []}


def write():
    (OUT / "plan-prod-walk.json").write_text(json.dumps(REC, indent=1), encoding="utf-8")


def check(name, ok, detail):
    REC["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + " :: " + str(detail))
    write()
    return bool(ok)


def widget_ids(doc):
    out = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "widgetEmbed":
                out.append((n.get("attrs") or {}).get("widgetId"))
            for c in n.get("content") or []:
                walk(c)
    walk(doc if isinstance(doc, dict) else {})
    return out


email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw and email.endswith("@uctintelligence.internal")):
    print("INCONCLUSIVE: no synthetic credentials in the environment")
    sys.exit(2)

from playwright.sync_api import sync_playwright  # noqa: E402
from mobile_audit import _dismiss_intro  # noqa: E402

failed = False
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(viewport={"width": 1280, "height": 800})
    req = ctx.request
    try:
        r = req.post(BASE + "/api/auth/login", data={"email": email, "password": pw})
        if r.status != 200:
            print(f"INCONCLUSIVE: login {r.status}")
            sys.exit(2)
        me = req.get(BASE + "/api/auth/me").json()
        who = (me.get("user") or me).get("email", "")
        if not who.endswith("@uctintelligence.internal"):
            print("INCONCLUSIVE: signed in as a non-synthetic account; stopping")
            sys.exit(2)
        r = req.post(BASE + "/api/j2/notes", data={"title": "T2A post-merge /plan source",
                     "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
        j = r.json() if r.ok else {}
        src = (j.get("note") or j).get("id") if isinstance(j, dict) else None
        if not src:
            print(f"INCONCLUSIVE: source note not made ({r.status})")
            sys.exit(2)
        REC["notes"].append(src)
        write()

        page = ctx.new_page()
        page.on("pageerror", lambda e: REC["page_errors"].append(str(e)[:300]))
        page.goto(f"{BASE}/journal/notebook?note={src}", wait_until="domcontentloaded")
        _dismiss_intro(page)
        page.wait_for_selector(".ProseMirror", timeout=30000)
        page.locator(".ProseMirror").first.click()
        page.keyboard.press("End")
        page.keyboard.type("/plan NVDA", delay=40)
        opt = page.get_by_role("option", name=re.compile(r"^Trade plan — NVDA"))
        try:
            opt.first.wait_for(state="visible", timeout=10000)
            offered = True
        except Exception:  # noqa: BLE001
            offered = False
        failed |= not check("slash menu offers 'Trade plan — NVDA'", offered, offered)
        if offered:
            page.keyboard.press("Enter")
        toast = False
        if offered:
            try:
                page.get_by_text("Trade plan for NVDA created and linked").first.wait_for(state="visible", timeout=30000)
                toast = True
            except Exception:  # noqa: BLE001
                toast = False
        failed |= not check("toast: plan created and linked", toast, toast)
        opened = None
        link = page.locator("[data-note-link] button")
        if toast:
            try:
                link.first.wait_for(state="visible", timeout=10000)
                link.first.click()
                page.wait_for_function("id => new URL(location.href).searchParams.get('note') !== id", arg=src, timeout=20000)
                opened = page.evaluate("() => new URL(location.href).searchParams.get('note')")
            except Exception as e:  # noqa: BLE001
                REC["link_error"] = f"{type(e).__name__}"
        if opened:
            REC["notes"].append(opened)
            write()
        failed |= not check("the link opens the new plan note", bool(opened), opened)
        got = {}
        if opened:
            g = req.get(f"{BASE}/api/j2/notes/{opened}")
            got = g.json() if g.ok else {}
            got = got.get("note") or got
        doc = got.get("bodyJson") or {}
        if isinstance(doc, str):
            doc = json.loads(doc)
        ids = widget_ids(doc)
        failed |= not check("plan note holds chart, sizing and checklist",
                            {"chart", "positionSizing", "preEntryChecklist"} <= set(ids), ids)
        failed |= not check("plan note ticker is NVDA", (got.get("ticker") or "").upper() == "NVDA", got.get("ticker"))
        page.screenshot(path=str(OUT / "plan-1280.png"), full_page=False)
        failed |= not check("no uncaught page errors", not REC["page_errors"], REC["page_errors"])
    finally:
        for nid in REC["notes"]:
            d = req.delete(f"{BASE}/api/j2/notes/{nid}")
            REC["cleanup"].append({"id": nid, "delete_status": d.status})
        write()
        br.close()

print("VERDICT: " + ("FAIL" if failed else "PASS"))
sys.exit(1 if failed else 0)
