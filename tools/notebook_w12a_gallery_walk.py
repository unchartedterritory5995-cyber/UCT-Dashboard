"""Wave 12 lane 12A live walk -- the community template gallery in a real Chromium, against a
LOCAL sandbox. It writes RAW evidence only: docs/notebook/evidence/wave12-12a/walk-<sha>/walk.json
(+ the launcher's integrity log and screenshots). It is NOT a pytest rail, and it draws no
conclusion: each row records what the browser and the API showed.

⛔ THIS DRIVER NEVER IMPORTS `api.*`. It owns its sandbox through the perf harness's `Sandbox`
(scripts/hub_sandbox_boot.py, own process group, stopped gracefully so the launcher writes its
SHUTDOWN checkpoint), talks to it over HTTP only, and prints the launcher's snapshot verdict
(`SANDBOX INTEGRITY: ...`) as its FIRST output line. No model is called.

Run it from POWERSHELL with the gate in that same shell (ports 8580-8584 only):

    $env:NOTEBOOK_TEMPLATE_GALLERY_ENABLED = '1'
    python tools/notebook_w12a_gallery_walk.py --data-dir '<scratchpad>\\w12a-data' --port 8580 `
        --out docs/notebook/evidence/wave12-12a/walk-<sha>/walk.json --tip <sha> `
        --artifacts docs/notebook/evidence/wave12-12a/walk-<sha>

Preconditions: app/dist built from the tip; the port free (refused, never killed); the data dir
outside the shared root (refused).

Three accounts: the launcher's admin (hubtest@local.dev, ADMIN_EMAILS) and two paid members, an
AUTHOR and a BROWSER, each in its own browser context.

  G0  the gate rides the auth payload ON for both members; the sandbox is who it says it is
  G1  publish (author, mouse, 1200 px): New note -> Templates -> Your templates -> Share ->
      Category -> Submit for review; the stored copy holds none of the private markers
  G2  before review: the browser member's list does not carry it and its full read is a 404
  G3  approve (admin, mouse): community gallery -> Review queue -> Approve
  G4  browse (browser member, 1200 px): door -> UCT picks + Community; search; a category chip;
      preview opens read-only; Use template copies it; Make a note from it makes a note
  G5  report (browser member): Report -> reason -> Send report
  G6  hide (admin): Review queue -> Reported -> Hide template; the browser member's list loses
      it and the row is still there for its author (hidden, not deleted); Unhide restores it
  G7  keyboard (browser member): Tab to the door, Enter; focus lands on the gallery heading;
      Back to templates returns focus to the door
  G8  390 px (browser member, touch): the gallery has no sideways scroll; its buttons are >= 44 px
  G9  no unforced page error across the walk
"""
from __future__ import annotations

import argparse
import json
import os
import secrets
import shutil
import sys
import time
import traceback
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))
from tools import notebook_perf_harness as H  # noqa: E402  (ONE sandbox + integrity reader)
import sandbox_identity  # noqa: E402

REQUIRED = [H.PRE_BOOT, H.POST_BOOT, H.PREWARM, H.SHUTDOWN]
FLAG_KEY = "notebook_template_gallery_enabled"
SECRET_NOTE_TITLE = "W12A secret neighbour note"
PRIVATE_MARKERS = ("w12a-private@example.com", "/journal/notebook?note=", "example.com/w12a.png")

res: dict = {"wave": 12, "lane": "12A", "checks": {}, "errors": [], "requests": []}
LINES: list[str] = []


def record(key, verdict, **facts):
    res["checks"][key] = {"verdict": verdict, **facts}
    line = f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:600]
    LINES.append(line)
    print(line, file=sys.stderr, flush=True)


def guarded(key):
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001 -- one row never stops the rest
                record(key, "INCONCLUSIVE", reason=f"exception: {type(e).__name__}: {e}",
                       traceback=traceback.format_exc()[-1500:])
        return inner
    return wrap


def find_key(obj, key):
    if isinstance(obj, dict):
        if key in obj:
            return obj[key]
        for v in obj.values():
            got = find_key(v, key)
            if got is not None:
                return got
    if isinstance(obj, list):
        for v in obj:
            got = find_key(v, key)
            if got is not None:
                return got
    return None


TOUCH_PROBE = r"""
(root) => {
  const el = document.querySelector(root)
  if (!el) return null
  const small = []
  for (const b of el.querySelectorAll('button, select, input, textarea')) {
    const r = b.getBoundingClientRect()
    if (r.width === 0 && r.height === 0) continue
    if (r.height < 44) small.push({ text: (b.getAttribute('aria-label') || b.textContent || '').trim().slice(0, 40), h: Math.round(r.height) })
  }
  return { scrollW: document.documentElement.scrollWidth, clientW: document.documentElement.clientWidth, small }
}
"""


def run_walk(base: str, art: Path) -> None:
    from playwright.sync_api import sync_playwright

    run = time.strftime("r%H%M%S")
    res["run"] = run
    pw = secrets.token_urlsafe(18)   # a TEST value for this run only; never written anywhere

    def shot(pg, name):
        p = art / f"{name}.jpg"
        try:
            pg.screenshot(path=str(p), type="jpeg", quality=55, full_page=False)
            return p.name
        except Exception as e:  # noqa: BLE001
            return f"screenshot failed: {e}"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context(viewport={"width": 1280, "height": 900})
        author = browser.new_context(viewport={"width": 1280, "height": 900})
        member = browser.new_context(viewport={"width": 1280, "height": 900})
        a_email = f"w12a-author-{run}@local.dev"
        b_email = f"w12a-member-{run}@local.dev"
        res["accounts"] = {"author": a_email, "member": b_email, "admin": H.ADMIN_EMAIL}
        # The admin signs up ONCE: signup is 3/minute per client IP, and H._provision signs the
        # admin up again per member (walk run 1, e5c86829db: the fourth signup was refused and
        # the member's fallback login answered 401). A refused signup waits out the minute.
        H._signup_or_login(admin.request, base, H.ADMIN_EMAIL, H.ADMIN_PW, "hubtest")
        for ctx, email, name in ((author, a_email, "Walker Author"), (member, b_email, "Walker Member")):
            for _attempt in range(3):
                r = ctx.request.post(base + "/api/auth/signup",
                                     data={"email": email, "password": pw, "display_name": name})
                if r.status != 429:
                    break
                time.sleep(62)
            if r.status not in (200, 201):
                raise H.SetupFailed(f"could not sign up {email}: HTTP {r.status}")
            admin.request.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
            admin.request.post(base + "/api/auth/admin/verify-email", data={"email": email})
            if not ctx.request.get(base + "/api/auth/me").json().get("paid_equiv"):
                raise H.SetupFailed(f"{email} is not paid-equivalent")
        A, B, ADM = author.request, member.request, admin.request

        for ctx in (admin, author, member):
            ctx.on("request", lambda req: res["requests"].append(
                f"{req.method} {req.url.split(base, 1)[-1]}") if "/api/j2/template-gallery" in req.url else None)

        def new_page(ctx):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg

        def open_picker(pg):
            pg.goto(base + "/journal/notebook?view=all")
            H._dismiss_intro(pg)
            pg.get_by_role("button", name="Templates", exact=True).click()
            sheet = pg.get_by_role("dialog", name="New note")
            sheet.wait_for(state="visible", timeout=15000)
            return sheet

        def open_gallery(pg):
            sheet = open_picker(pg)
            sheet.get_by_role("button", name="Browse the community gallery").click()
            sheet.get_by_role("heading", name="Community gallery").wait_for(timeout=15000)
            return sheet

        state: dict = {}

        @guarded("G0_gate_and_identity")
        def g0():
            flags = {who: find_key(req.get(base + "/api/auth/me").json(), FLAG_KEY) for who, req in
                     (("author", A), ("member", B), ("admin", ADM))}
            firm = B.get(base + "/api/j2/template-gallery?section=picks").json()
            record("G0_gate_and_identity", "PASS" if all(v is True for v in flags.values()) else "FAIL",
                   payload_flag=flags, firm_picks=[t["title"] for t in firm.get("templates", [])],
                   member_is_admin=firm.get("viewer"))
        g0()

        @guarded("G1_publish_by_mouse")
        def g1():
            neighbour = A.post(base + "/api/j2/notes", data={"title": SECRET_NOTE_TITLE, "bodyJson": {
                "type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "private"}]}]}}).json()["note"]["id"]
            body = {"type": "doc", "content": [
                {"type": "heading", "attrs": {"level": 2}, "content": [{"type": "text", "text": "Entry rules"}]},
                {"type": "paragraph", "content": [{"type": "text", "text": "Ask w12a-private@example.com first"}]},
                {"type": "paragraph", "content": [{"type": "text", "text": "see "}, {"type": "noteLink", "attrs": {"noteId": neighbour}}]},
                {"type": "paragraph", "content": [{"type": "text", "text": f"pasted {base}/journal/notebook?note={neighbour}"}]},
                {"type": "image", "attrs": {"src": "https://example.com/w12a.png", "alt": "chart"}},
                {"type": "taskList", "content": [{"type": "taskItem", "attrs": {"checked": True},
                    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Size it"}]}]}]},
            ]}
            nid = A.post(base + "/api/j2/notes", data={"title": f"W12A source {run}", "bodyJson": body}).json()["note"]["id"]
            tpl = A.post(base + "/api/j2/note-templates", data={"noteId": nid, "name": f"W12A plan {run}"}).json()["template"]
            state["tpl_name"] = tpl["name"]
            pg = new_page(author)
            sheet = open_picker(pg)
            sheet.get_by_role("button", name=f"Share {tpl['name']} to the community gallery").click()
            form = sheet.get_by_role("form", name=f"Share {tpl['name']} to the community gallery")
            form.get_by_label("What it's for (optional)").fill("A walk-made plan.")
            form.get_by_label("Category").select_option("trade_plan")
            form.get_by_role("button", name="Submit for review").click()
            msg = sheet.get_by_text("for review. You'll see it under Your submissions").first
            msg.wait_for(timeout=15000)
            s = shot(pg, "g1-submitted")
            mine = A.get(base + "/api/j2/template-gallery?section=mine").json()["templates"]
            gid = mine[0]["id"]
            state["gid"] = gid
            full = A.get(base + f"/api/j2/template-gallery/{gid}").json()["template"]
            dumped = json.dumps(full)
            leaks = [m for m in PRIVATE_MARKERS if m in dumped] + ([neighbour] if neighbour in dumped else [])
            tasks = [n for n in full["bodyJson"]["content"] if n["type"] == "taskList"]
            record("G1_publish_by_mouse", "PASS" if mine[0]["status"] == "pending" and not leaks else "FAIL",
                   message=msg.inner_text(), status=mine[0]["status"], leaks=leaks,
                   kept_heading="Entry rules" in dumped, has_image=any(n["type"] == "image" for n in full["bodyJson"]["content"]),
                   task_checked=[i["attrs"].get("checked") for t in tasks for i in t["content"]],
                   texts=[c.get("text") for n in full["bodyJson"]["content"] for c in (n.get("content") or []) if c.get("type") == "text"],
                   screenshot=s)
            pg.close()
        g1()

        @guarded("G2_invisible_before_review")
        def g2():
            gid = state["gid"]
            listed = [t["id"] for t in B.get(base + "/api/j2/template-gallery").json()["templates"]]
            read = B.get(base + f"/api/j2/template-gallery/{gid}")
            record("G2_invisible_before_review", "PASS" if gid not in listed and read.status == 404 else "FAIL",
                   in_member_list=gid in listed, member_read_status=read.status)
        g2()

        @guarded("G3_admin_approves_by_mouse")
        def g3():
            pg = new_page(admin)
            sheet = open_gallery(pg)
            sheet.get_by_role("button", name="Review queue").click()
            title = f"W12A plan {run}"
            sheet.get_by_role("button", name=f"Approve {title}").click()
            ok = sheet.get_by_text(f"Approved “{title}”. It is listed now.")
            ok.wait_for(timeout=15000)
            s = shot(pg, "g3-approved")
            listed = [t["id"] for t in B.get(base + "/api/j2/template-gallery").json()["templates"]]
            record("G3_admin_approves_by_mouse", "PASS" if state["gid"] in listed else "FAIL",
                   message=ok.inner_text(), in_member_list=state["gid"] in listed, screenshot=s)
            pg.close()
        g3()

        @guarded("G4_browse_preview_use")
        def g4():
            title = f"W12A plan {run}"
            pg = new_page(member)
            sheet = open_gallery(pg)
            picks = sheet.get_by_role("region", name="UCT picks")
            picks.wait_for(timeout=15000)
            pick_titles = picks.get_by_role("heading", level=4).all_inner_texts()
            sheet.get_by_role("searchbox", name="Search the community gallery").fill("W12A plan")
            card_heading = sheet.get_by_role("region", name="Community").get_by_role("heading", name=title)
            card_heading.wait_for(timeout=15000)
            sheet.get_by_role("group", name="Filter by category").get_by_role("button", name="Trade plan").click()
            card_heading.wait_for(timeout=15000)
            s1 = shot(pg, "g4-browse")
            sheet.get_by_role("button", name=f"Preview {title}").click()
            dlg = pg.get_by_role("dialog", name=title)
            dlg.wait_for(timeout=15000)
            dlg.get_by_text("Entry rules").wait_for(timeout=15000)
            preview_text = dlg.inner_text()[:600]
            s2 = shot(pg, "g4-preview")
            dlg.get_by_role("button", name="Use this template").click()
            added = sheet.get_by_text(f"Added “{title}” to Your templates.")
            added.wait_for(timeout=15000)
            copies = [t["name"] for t in B.get(base + "/api/j2/note-templates").json()["templates"]]
            before = {n["id"] for n in B.get(base + "/api/j2/notes?limit=200").json().get("notes", [])}
            sheet.get_by_role("button", name="Make a note from it").click()
            made = None
            end = time.time() + 20
            while time.time() < end and not made:
                now = B.get(base + "/api/j2/notes?limit=200").json().get("notes", [])
                fresh = [n for n in now if n["id"] not in before]
                made = fresh[0] if fresh else None
                if not made:
                    time.sleep(0.5)
            s3 = shot(pg, "g4-note-made")
            record("G4_browse_preview_use",
                   "PASS" if title in copies and made and made.get("title") == title else "FAIL",
                   picks=pick_titles, preview_excerpt=preview_text, use_message=added.inner_text(),
                   member_templates=copies, note_made={"id": (made or {}).get("id"), "title": (made or {}).get("title")},
                   url_after=pg.url.split(base, 1)[-1], screenshots=[s1, s2, s3])
            pg.close()
        g4()

        @guarded("G5_report")
        def g5():
            title = f"W12A plan {run}"
            pg = new_page(member)
            sheet = open_gallery(pg)
            sheet.get_by_role("searchbox", name="Search the community gallery").fill("W12A plan")
            sheet.get_by_role("button", name=f"Report {title}").click()
            form = sheet.get_by_role("form", name=f"Report {title}")
            form.get_by_label("Why are you reporting it?").select_option("spam")
            form.get_by_label("Anything a moderator should know (optional)").fill("walk report")
            form.get_by_role("button", name="Send report").click()
            thanks = sheet.get_by_text(f"Thanks. A moderator will review “{title}”.")
            thanks.wait_for(timeout=15000)
            s = shot(pg, "g5-reported")
            q = ADM.get(base + "/api/j2/template-gallery/admin/queue").json()
            rep = [r for r in q["reported"] if r["id"] == state["gid"]]
            record("G5_report", "PASS" if rep and rep[0]["reports"][0]["reason"] == "spam" else "FAIL",
                   message=thanks.inner_text(), queue_reports=rep[0]["reports"] if rep else None,
                   reporter_named=b_email in json.dumps(q), screenshot=s)
            pg.close()
        g5()

        @guarded("G6_hide_then_unhide")
        def g6():
            title = f"W12A plan {run}"
            pg = new_page(admin)
            sheet = open_gallery(pg)
            sheet.get_by_role("button", name="Review queue").click()
            sheet.get_by_role("button", name="Hide template").first.click()
            sheet.get_by_text(f"Hid “{title}”.").wait_for(timeout=15000)
            s1 = shot(pg, "g6-hidden")
            member_after_hide = state["gid"] in [t["id"] for t in B.get(base + "/api/j2/template-gallery").json()["templates"]]
            mine = A.get(base + "/api/j2/template-gallery?section=mine").json()["templates"]
            author_row = [{"status": t["status"], "hidden": t["hidden"]} for t in mine if t["id"] == state["gid"]]
            sheet.get_by_role("button", name=f"Unhide {title}").click()
            sheet.get_by_text(f"“{title}” is visible again.").wait_for(timeout=15000)
            s2 = shot(pg, "g6-unhidden")
            member_after_unhide = state["gid"] in [t["id"] for t in B.get(base + "/api/j2/template-gallery").json()["templates"]]
            record("G6_hide_then_unhide",
                   "PASS" if not member_after_hide and author_row and author_row[0]["hidden"] and member_after_unhide else "FAIL",
                   member_sees_after_hide=member_after_hide, author_row_after_hide=author_row,
                   member_sees_after_unhide=member_after_unhide, screenshots=[s1, s2])
            pg.close()
        g6()

        @guarded("G7_keyboard")
        def g7():
            pg = new_page(member)
            sheet = open_picker(pg)
            door = sheet.get_by_role("button", name="Browse the community gallery")
            door.focus()
            focused_door = pg.evaluate("() => document.activeElement?.getAttribute('data-community-gallery-door') !== null")
            pg.keyboard.press("Enter")
            sheet.get_by_role("heading", name="Community gallery").wait_for(timeout=15000)
            on_heading = pg.evaluate("() => document.activeElement?.textContent")
            steps = []
            for _ in range(4):
                pg.keyboard.press("Tab")
                steps.append(pg.evaluate("() => (document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent || document.activeElement?.tagName || '').trim().slice(0, 50)"))
            pg.keyboard.press("Shift+Tab")
            for _ in range(10):
                if pg.evaluate("() => document.activeElement?.textContent?.trim()") == "Back to templates":
                    break
                pg.keyboard.press("Shift+Tab")
            pg.keyboard.press("Enter")
            time.sleep(0.4)
            back_on_door = pg.evaluate("() => document.activeElement?.hasAttribute('data-community-gallery-door') || false")
            body_focus = pg.evaluate("() => document.activeElement === document.body")
            record("G7_keyboard", "PASS" if focused_door and on_heading == "Community gallery" and back_on_door else "FAIL",
                   door_focused=focused_door, focus_after_enter=on_heading, tab_order=steps,
                   focus_back_on_door=back_on_door, focus_on_body=body_focus)
            pg.close()
        g7()

        @guarded("G8_phone_390")
        def g8():
            phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                        storage_state=member.storage_state())
            pg = new_page(phone)
            sheet = open_gallery(pg)
            sheet.get_by_role("region", name="UCT picks").wait_for(timeout=15000)
            probe = pg.evaluate(TOUCH_PROBE, "[data-template-community-gallery]")
            s = shot(pg, "g8-phone-390")
            ok = probe and probe["scrollW"] <= probe["clientW"] and not probe["small"]
            record("G8_phone_390", "PASS" if ok else "FAIL", probe=probe, screenshot=s)
            phone.close()
        g8()

        record("G9_no_page_errors", "PASS" if not res["errors"] else "FAIL", errors=res["errors"][:20])
        browser.close()


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 12 lane 12A live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8580)
    ap.add_argument("--out", required=True)
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True)
    args = ap.parse_args(argv)
    if not 8580 <= args.port <= 8584:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: port {args.port} is outside 8580-8584)")
        return 3
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir,
                "instrument": os.path.relpath(__file__, REPO),
                "gate_source": "the sandbox's auth payload (row G0 payload_flag)"})
    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3
    sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
    not_run = None
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "the sandbox never answered /api/health"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            v = sandbox_identity.verify(base, sb.integrity_path())
            res["sandbox_identity"] = {"ok": v.ok, "sentence": v.sentence}
            if not v.ok:
                not_run = v.sentence
            else:
                try:
                    run_walk(base, art)
                except Exception as e:  # noqa: BLE001 -- setup failed; the sandbox still owes its verdict
                    not_run = f"{type(e).__name__}: {e}"
                    res["traceback"] = traceback.format_exc()[-2000:]
                res["prewarm_checkpoint_reached"] = sb.wait_checkpoint(H.PREWARM, H.PREWARM_WAIT_S)
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, REQUIRED)
        if ipath and Path(ipath).is_file():
            kept = out.with_suffix(".integrity.md")
            shutil.move(ipath, kept)
            integ["path"] = str(kept)
        first = H.integrity_line(integ, not_run=not_run)
        res.update({"first_line": first, "integrity": integ, "not_run": not_run})
        out.write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        print(first)
        for line in LINES:
            print(line)
        print(f"evidence: {out}")
    if not_run:
        return 3
    verdicts = [v["verdict"] for v in res["checks"].values()]
    return 0 if verdicts and all(v == "PASS" for v in verdicts) else 1


if __name__ == "__main__":
    sys.exit(main())
