"""Flag-on browser walk of the market-context "Capture now" (lane B concern 2, P2b).

Headless Playwright, its OWN context, signed in as the synthetic smoke account through the
API (credentials from SMOKE_EMAIL / SMOKE_PASSWORD, never printed). Creates one note holding
an uncaptured budget stamp (the backend's shape), walks it at 1280 and 390, clicks Capture
now, proves the save round trip on the wire and by re-reading the note, then soft-deletes the
note through the product's own DELETE and proves it is gone. Raw record written FIRST.

Exit 0 PASS · 1 a measured failure · 2 INCONCLUSIVE (could not measure).
Usage: python mc_capture_walk.py <base> <out-dir>
"""
import json
import os
import pathlib
import sys
import time

BASE, OUT = sys.argv[1].rstrip("/"), pathlib.Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)
REC = {"base": BASE, "started": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "checks": [],
       "console_errors": [], "page_errors": [], "wire": [], "note_id": None, "cleanup": None}


def write():
    (OUT / "mc-capture-walk.json").write_text(json.dumps(REC, indent=1), encoding="utf-8")


def check(name, ok, detail):
    REC["checks"].append({"name": name, "ok": bool(ok), "detail": detail})
    print(("PASS " if ok else "FAIL ") + name + " :: " + str(detail))
    write()
    return ok


def stamp_node():
    return {"type": "widgetEmbed", "attrs": {
        "v": 1, "widgetId": "marketcontext", "embedId": "mc-walk", "mode": "snapshot",
        "params": {"uncaptured": True, "reason": "budget", "fields": "all"},
        "capturedAt": None, "annotations": [], "caption": None,
        "layout": {"width": "full", "height": None}, "fallback": None}}


def find_mc(body):
    if isinstance(body, str):
        body = json.loads(body)
    for n in (body or {}).get("content", []):
        if n.get("type") == "widgetEmbed" and (n.get("attrs") or {}).get("widgetId") == "marketcontext":
            return n["attrs"]
    return None


email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
if not (email and pw and email.endswith("@uctintelligence.internal")):
    print("INCONCLUSIVE: no synthetic credentials in the environment")
    sys.exit(2)

from playwright.sync_api import sync_playwright  # noqa: E402
sys.path.insert(0, "C:/Users/Patrick/uct-worktrees/notebook-p2b/tools")
from mobile_audit import _dismiss_intro  # noqa: E402  (verifies the overlay is gone, raises if not)

failed = False
with sync_playwright() as p:
    br = p.chromium.launch(headless=True)
    ctx = br.new_context(viewport={"width": 1280, "height": 800})
    req = ctx.request
    nid = None
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
        flag = me.get("notebook_journal_styles_enabled")
        if flag is None:
            flag = (me.get("access") or {}).get("notebook_journal_styles_enabled")
        check("auth payload carries the flag ON", flag is True, f"notebook_journal_styles_enabled={flag!r}")

        body = {"type": "doc", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "P2b flag-on walk: market context Capture now."}]},
            stamp_node()]}
        r = req.post(BASE + "/api/j2/notes", data={"title": "P2b MC capture walk", "bodyJson": body})
        j = r.json() if r.ok else {}
        nid = (j.get("note") or j).get("id") if isinstance(j, dict) else None
        REC["note_id"] = nid
        write()
        if not nid:
            print(f"INCONCLUSIVE: note not made ({r.status})")
            sys.exit(2)

        page = ctx.new_page()
        page.on("console", lambda m: m.type == "error" and REC["console_errors"].append(m.text[:300]))
        page.on("pageerror", lambda e: REC["page_errors"].append(str(e)[:300]))

        def on_resp(resp):
            u = resp.url
            if "/api/j2/" in u and resp.request.method in ("PUT", "PATCH", "POST"):
                REC["wire"].append({"method": resp.request.method, "url": u.split(BASE)[-1], "status": resp.status})
            elif "market" in u and "/api/" in u:
                REC["wire"].append({"method": resp.request.method, "url": u.split(BASE)[-1][:160], "status": resp.status})
        page.on("response", on_resp)

        # ── 390 (touch tier): the button is there, big enough, and not covered ──
        page.set_viewport_size({"width": 390, "height": 844})
        page.goto(f"{BASE}/journal/notebook?note={nid}", wait_until="domcontentloaded")
        _dismiss_intro(page)
        btn = page.get_by_role("button", name="Capture now")
        try:
            btn.first.wait_for(state="visible", timeout=30000)
        except Exception as e:  # noqa: BLE001
            page.screenshot(path=str(OUT / "mc-390-nobutton.png"), full_page=True)
            check("390: Capture now rendered", False, f"{type(e).__name__}")
            raise SystemExit(1)
        btn.first.scroll_into_view_if_needed()
        bb = btn.first.bounding_box()
        hit = page.evaluate("""() => { const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Capture now');
            const r=b.getBoundingClientRect(); const el=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
            return {self: el===b || b.contains(el), hitTag: el && el.tagName, hitText: el && (el.textContent||'').trim().slice(0,40)} }""")
        page.screenshot(path=str(OUT / "mc-390.png"), full_page=False)
        failed |= not check("390: tap target >= 44 px tall", bb and bb["height"] >= 44, bb)
        failed |= not check("390: nothing covers the button", hit["self"], hit)
        failed |= not check("390: button inside the viewport width", bb and bb["x"] >= 0 and bb["x"] + bb["width"] <= 390, bb)

        # ── 1280: layout, focus into the node view, the real save ──
        page.set_viewport_size({"width": 1280, "height": 800})
        page.goto(f"{BASE}/journal/notebook?note={nid}", wait_until="domcontentloaded")
        _dismiss_intro(page)
        btn = page.get_by_role("button", name="Capture now")
        btn.first.wait_for(state="visible", timeout=30000)
        btn.first.scroll_into_view_if_needed()
        bb = btn.first.bounding_box()
        page.screenshot(path=str(OUT / "mc-1280-before.png"), full_page=False)
        failed |= not check("1280: button laid out with a real box", bb and bb["width"] > 20 and bb["height"] > 20, bb)
        btn.first.focus()
        foc = page.evaluate("() => { const a=document.activeElement; return {tag:a&&a.tagName, text:a&&(a.textContent||'').trim().slice(0,30)} }")
        failed |= not check("1280: the button takes keyboard focus inside the node view",
                            foc["tag"] == "BUTTON" and foc["text"] == "Capture now", foc)
        sentence = page.get_by_text("The market could not be read in time when this stamp was added.")
        failed |= not check("1280: the budget sentence is shown before capture", sentence.count() >= 1, sentence.count())

        n_puts = len([w for w in REC["wire"] if w["method"] in ("PUT", "PATCH", "POST")])
        btn.first.click()
        gone = False
        for _ in range(40):
            page.wait_for_timeout(500)  # pumps Playwright events; time.sleep does not
            if page.get_by_role("button", name="Capture now").count() == 0:
                gone = True
                break
        page.screenshot(path=str(OUT / "mc-1280-after.png"), full_page=False)
        mk = [w for w in REC["wire"] if "market" in w["url"]]
        if not gone and any(w["status"] == 409 for w in mk):
            check("capture: market read in time", False, "409 budget: the market could not be read; INCONCLUSIVE for the save")
            write()
            raise SystemExit(2)
        failed |= not check("capture: the button goes away once captured", gone, mk[-3:])
        saved = False
        for _ in range(30):
            puts = [w for w in REC["wire"] if w["method"] in ("PUT", "PATCH", "POST")][n_puts:]
            if any(w["status"] == 200 for w in puts):
                saved = True
                break
            page.wait_for_timeout(500)  # pumps Playwright events; time.sleep does not
        failed |= not check("capture: the note write landed on the wire (200)", saved,
                            [w for w in REC["wire"] if w["method"] in ("PUT", "PATCH", "POST")][n_puts:])

        page.wait_for_timeout(2000)
        g = req.get(f"{BASE}/api/j2/notes/{nid}")
        gj = g.json() if g.ok else {}
        node = (gj.get("note") or gj) if isinstance(gj, dict) else {}
        mc = find_mc(node.get("bodyJson") or node.get("body_json"))
        REC["server_stamp"] = mc
        write()
        params = (mc or {}).get("params") or {}
        failed |= not check("round trip: the server copy is captured",
                            mc is not None and not params.get("uncaptured") and "reason" not in params and mc.get("capturedAt"),
                            {"params_keys": sorted(params), "capturedAt": (mc or {}).get("capturedAt")})

        page.reload(wait_until="domcontentloaded")
        _dismiss_intro(page)
        page.wait_for_timeout(6000)
        failed |= not check("reload: no Capture now, no budget sentence",
                            page.get_by_role("button", name="Capture now").count() == 0
                            and page.get_by_text("The market could not be read in time when this stamp was added.").count() == 0,
                            "after reload")
        page.screenshot(path=str(OUT / "mc-1280-reloaded.png"), full_page=False)
        app_errs = [e for e in REC["page_errors"]]
        failed |= not check("no uncaught page errors", not app_errs, app_errs[:3])
    finally:
        if nid:
            d = req.delete(f"{BASE}/api/j2/notes/{nid}")
            lst = req.get(f"{BASE}/api/j2/notes")
            ids = []
            try:
                lj = lst.json()
                items = lj.get("notes", lj) if isinstance(lj, dict) else lj
                ids = [n.get("id") for n in items if isinstance(n, dict)]
            except Exception:  # noqa: BLE001
                pass
            REC["cleanup"] = {"delete_status": d.status, "still_listed": nid in ids}
            print("cleanup:", REC["cleanup"])
            write()
        br.close()

REC["verdict"] = "FAIL" if failed else "PASS"
write()
print("VERDICT:", REC["verdict"])
sys.exit(1 if failed else 0)
