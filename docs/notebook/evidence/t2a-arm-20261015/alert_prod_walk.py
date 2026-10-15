"""Post-arming production check (t2a-arming.md, check 4): the alert chip, as the smoke account.

Own Playwright context; makes one note, types the alert sentence on a new line, waits for the
"Alert suggestion" toolbar, Alt+Enter opens "Set an alert" filled in, Cancel; asserts no alert row
was created (GET /api/indicator-alerts and /api/watchlist-alerts counts unchanged); trashes the note.
Exit 0 PASS, 1 measured failure, 2 INCONCLUSIVE. Usage: python alert_prod_walk.py <base> <out-dir>
"""
import json, os, pathlib, sys, time

BASE, OUT = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
REC = {"base": BASE, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "checks": [], "page_errors": [], "cleanup": None}


def write():
    (OUT / "alert-prod-walk.json").write_text(json.dumps(REC, indent=1), encoding="utf-8")


def check(name, ok, detail):
    REC["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + " :: " + str(detail))
    write()
    return bool(ok)


email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw and email.endswith("@uctintelligence.internal")):
    print("INCONCLUSIVE: no synthetic credentials")
    sys.exit(2)

from playwright.sync_api import sync_playwright  # noqa: E402
from mobile_audit import _dismiss_intro  # noqa: E402

failed = False
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(viewport={"width": 1280, "height": 800})
    req = ctx.request
    nid = None
    try:
        if req.post(BASE + "/api/auth/login", data={"email": email, "password": pw}).status != 200:
            print("INCONCLUSIVE: login"); sys.exit(2)
        me = req.get(BASE + "/api/auth/me").json()
        acc = me.get("access") or {}
        if not (me.get("user") or me).get("email", "").endswith("@uctintelligence.internal"):
            print("INCONCLUSIVE: not synthetic"); sys.exit(2)
        flag = me.get("notebook_smart_chips_enabled", acc.get("notebook_smart_chips_enabled"))
        failed |= not check("auth payload carries smart chips ON", flag is True, flag)

        def counts():
            a = (req.get(BASE + "/api/indicator-alerts").json() or {}).get("alerts") or []
            w = req.get(BASE + "/api/watchlist-alerts")
            wj = w.json() if w.ok else {}
            wl = wj.get("alerts") if isinstance(wj, dict) else wj
            return {"indicator": len(a), "watchlist": len(wl or [])}
        before = counts()
        j = req.post(BASE + "/api/j2/notes", data={"title": "T2A arming alert-chip check",
                     "bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}).json()
        nid = (j.get("note") or j).get("id")
        REC["note_id"] = nid
        page = ctx.new_page()
        page.on("pageerror", lambda e: REC["page_errors"].append(str(e)[:300]))
        page.goto(f"{BASE}/journal/notebook?note={nid}", wait_until="domcontentloaded")
        _dismiss_intro(page)
        page.wait_for_selector(".ProseMirror", timeout=30000)
        page.locator(".ProseMirror > p").first.click()
        page.keyboard.press("End"); page.keyboard.press("Enter")
        page.keyboard.type("alert me if NVDA closes below 120", delay=30)
        bar = page.get_by_role("toolbar", name="Alert suggestion")
        try:
            bar.first.wait_for(state="visible", timeout=20000); shown = True
        except Exception:  # noqa: BLE001
            shown = False
        failed |= not check("the chip is offered", shown, (bar.first.text_content() or "").strip() if shown else None)
        filled = None
        if shown:
            page.keyboard.press("Alt+Enter")
            dlg = page.get_by_role("dialog", name="Set an alert")
            try:
                dlg.wait_for(state="visible", timeout=15000)
                when = dlg.get_by_label("When")
                filled = {"ticker": dlg.get_by_label("Ticker").input_value(), "price": dlg.get_by_label("Price").input_value(),
                          "when": when.evaluate("s => s.options[s.selectedIndex].textContent")}
                page.screenshot(path=str(OUT / "alert-sheet-1280.png"))
                dlg.get_by_role("button", name="Cancel", exact=True).click()
            except Exception as e:  # noqa: BLE001
                REC["sheet_error"] = type(e).__name__
        failed |= not check("Alt+Enter opens the sheet filled in",
                            filled == {"ticker": "NVDA", "price": "120", "when": "Closes below"}, filled)
        page.wait_for_timeout(1500)
        after = counts()
        failed |= not check("Cancel created no alert", before == after, {"before": before, "after": after})
        failed |= not check("no uncaught page errors", not REC["page_errors"], REC["page_errors"])
    finally:
        if nid:
            REC["cleanup"] = {"id": nid, "delete_status": req.delete(f"{BASE}/api/j2/notes/{nid}").status}
        write()
        br.close()
print("VERDICT: " + ("FAIL" if failed else "PASS"))
sys.exit(1 if failed else 0)
