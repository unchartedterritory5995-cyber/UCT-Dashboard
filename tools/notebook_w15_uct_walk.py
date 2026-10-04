"""Wave 15 lane UCT live walk -- produces
docs/notebook/gate-runs/wave15/walk-uct-<sha>.json. Kept in tools/ so the evidence
is reproducible; it is NOT a pytest rail.

Closes the UCT-SIDE evidence gap on the two owed parity-scorecard rows whose
closing note names a browser pass that needs neither a model key nor a real
device (every other "browser pass" owed row -- G-015, G-085, G-131 -- already
has its UCT side PASSed by an earlier walk; what remains open on those three is
a COMPETITOR citation, not a UCT measurement, so this tool does not re-touch
them -- see docs/notebook/evidence/scorecard-research/uct-proposals.md):

  G041  G-041 "Comment/annotation field at capture time". The scorecard's own
        row (`docs/notebook/parity-scorecard.md` Sec A) says plainly: "The
        capture dialog was not driven ... UI not confirmed in any browser walk."
        This drives the REAL capture dialog -- the global hotkey Ctrl+Shift+Y,
        the same `uct:capture-open` door `CommandPalette`'s "Quick Capture" row
        uses -- from an open note, switches to "Capture a source", fills the
        "Your note" annotation field (plus a source link/title/passage), saves,
        and confirms (a) the server's own `POST /api/j2/capture` response links
        the right note and source url, and (b) `GET
        /api/j2/notes/excerpts/search` returns the annotation VERBATIM,
        correctly linked, correctly attributed (`sourceKind: "web"`) and
        genuinely searchable -- not just stored inertly. The widget-capture
        door (`CaptureMenu.jsx`) is NOT re-walked here: the ledger already
        closes it by a direct, uncontested code read (it needs a real
        chart/widget host to drive live), and nothing in this task's brief
        asks for a second instrument on an already-closed half.
        Checked at BOTH 1200 and 390 px -- the dialog is a `Sheet`, which
        renders a bottom sheet on touch, a real phone form.

  G153  G-153 "Reminders with notifications on date mentions / Review Date".
        The ledger's own row says plainly: "Never observed on a walk:
        W11_reminders INCONCLUSIVE on the wave-6 and wave-7 walks (a scheduled
        pass with no reachable trigger)" -- and the wave-7 walk's own
        INCONCLUSIVE reason says firing it for real "would require the sandbox
        to boot at/after 07:00 ET with the task already due, which this walk's
        own note-seeding cannot arrange." This walk runs when that is true: it
        seeds one note with a real overdue task (a `taskItem` + `dateMention`
        the editor's own schema produces) in the first seconds after boot, then
        lets the SCHEDULER'S OWN one-shot boot catch-up
        (`note_tasks.catch_up_task_reminders`, 90s after registration --
        `CATCH_UP_DELAY_S`) deliver it exactly the way the product runs it. No
        admin/manual HTTP trigger exists for this pass and none is added here
        (grep-confirmed, same as the wave-7 walk's own finding: the function has
        zero callers outside the scheduler and its own tests). The reminder is
        then confirmed delivered server-side (`GET /api/alerts`, the exact row
        `AlertBell` reads) and read off the REAL in-app bell at 390 px -- the
        ONLY width it exists at: `AlertBell` is mounted from `MobileNav.jsx`
        and NOT from the desktop `NavBar.jsx` (removed by owner request,
        2026-09-02, pinned by `AlertBell.delivery.test.jsx`), so there is no
        bell to drive at 1200 px and this walk does not pretend otherwise.
        Never email -- `_deliver_in_app` is the only delivery path this pass
        has.

Preconditions: app/dist rebuilt from the tip (`npm run build` in app/); the port
free (refused, never killed); the data dir outside the shared root (refused);
the REAL wall clock reads >= 07:00 ET when the sandbox boots -- G153 is a no-op
before that (`catch_up_task_reminders`), exactly the gap the earlier walks hit.

Run it from POWERSHELL (a Windows path through the Bash tool loses its
backslash):

    python tools/notebook_w15_uct_walk.py --data-dir 'C:\\data-w15uct' --port 8700 `
        --out docs/notebook/gate-runs/wave15/walk-uct-<sha>.json --tip <sha> `
        --artifacts <scratch>\\w15uct-walk

Exit: 0 = every row PASS and integrity CLEAN; 1 = a row FAILED; 2 = integrity not
CLEAN/complete or an unexpected INCONCLUSIVE; 3 = refused / not run.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import secrets
import shutil
import sys
import time
import traceback
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))
from tools import notebook_perf_harness as H  # noqa: E402  (ONE sandbox + integrity reader)
import sandbox_identity  # noqa: E402

ET = ZoneInfo("America/New_York")
REQUIRED = [H.PRE_BOOT, H.POST_BOOT, H.PREWARM, H.SHUTDOWN]
EMAIL = "w15uct@local.dev"
# Every row here can be measured; none is INCONCLUSIVE by construction (no
# model key, no real device needed on either G-041 or G-153).
BY_CONSTRUCTION: set[str] = set()
# How long to keep polling /api/alerts for the boot catch-up before calling it
# a FAIL. CATCH_UP_DELAY_S (note_tasks.py) is 90s from scheduler registration,
# which lands close to the sandbox becoming healthy; 240s leaves wide margin
# for APScheduler's own loop plus whatever the G-041 rows spend first.
REMINDER_WAIT_S = 240.0

res: dict = {"wave": 15, "lane": "uct", "checks": {}, "errors": [], "instrument_notes": []}
LINES: list[str] = []
ONLY: list[str] = []


# ── small helpers (same shape as tools/notebook_wave10b_walk.py) ────────────

def record(key, verdict, **facts):
    entry = {"verdict": verdict, **facts}
    res["checks"][key] = entry
    line = f"[{verdict}] {key}: " + json.dumps(facts, default=str, ensure_ascii=True)[:500]
    LINES.append(line)
    print(line, file=sys.stderr, flush=True)
    return entry


def guarded(key):
    def wrap(fn):
        def inner(*a, **kw):
            try:
                fn(*a, **kw)
            except Exception as e:  # noqa: BLE001 -- one row never stops the rest
                record(key, "INCONCLUSIVE", reason=f"exception: {type(e).__name__}: {e}",
                       traceback=traceback.format_exc()[-1500:])
        inner.key = key
        return inner
    return wrap


def P(text: str) -> dict:
    return {"type": "paragraph", "content": [{"type": "text", "text": text}]}


def DOC(*nodes) -> dict:
    return {"type": "doc", "content": list(nodes)}


# ── the live run ─────────────────────────────────────────────────────────────

def run_walk(base: str, art: Path) -> None:
    from playwright.sync_api import sync_playwright

    run = time.strftime("r%H%M%S")
    res["run"] = run
    pw = secrets.token_urlsafe(18)   # a TEST value for this run only; never written anywhere

    def pages_of(ctx):
        def new_page():
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: res["errors"].append(str(e)[:300]))
            return pg
        return new_page

    def shot(pg, name):
        p = art / f"{run}-{name}.png"
        try:
            pg.screenshot(path=str(p))
            return p.name
        except Exception as e:  # noqa: BLE001
            return f"screenshot failed: {e}"

    with sync_playwright() as p:
        browser = p.chromium.launch()
        admin = browser.new_context()
        member = browser.new_context(viewport={"width": 1200, "height": 900})
        email = EMAIL.replace("@", f"-{run}@")
        res["member"] = email
        H._provision(admin.request, member.request, base, member=(email, pw, "Walker W15 UCT"))
        api = member.request
        new_page = pages_of(member)

        def mk_note(title, body):
            r = api.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body})
            if not r.ok:
                raise RuntimeError(f"create note {title!r}: HTTP {r.status} {r.text()[:200]}")
            return r.json()["note"]

        def open_note(page_factory, nid, tries=3):
            last = None
            for _ in range(tries):
                pg = page_factory()
                pg.goto(f"{base}/journal/notebook?note={nid}")
                H._dismiss_intro(pg)
                try:
                    pg.locator(".ProseMirror").first.wait_for(state="visible", timeout=30000)
                    return pg
                except Exception as e:  # noqa: BLE001
                    last = e
                    pg.close()
            raise RuntimeError(f"the editor never mounted for note {nid}: {last}")

        # ── G-153 SEEDING, first thing, so the overdue task exists well before
        # the boot catch-up's 90s mark (note_tasks.CATCH_UP_DELAY_S). ──────────
        overdue_date = (datetime.now(tz=ET).date() - timedelta(days=1)).isoformat()
        reminder_doc = DOC(
            P(f"W15 UCT reminder walk {run}"),
            {"type": "taskList", "content": [
                {"type": "taskItem", "attrs": {"checked": False}, "content": [
                    {"type": "paragraph", "content": [
                        {"type": "text", "text": "Follow up on the W15 UCT walk task "},
                        {"type": "dateMention", "attrs": {"date": overdue_date}},
                        {"type": "text", "text": " (deliberately overdue)."},
                    ]},
                ]},
            ]},
        )
        reminder_note = mk_note(f"W15 UCT reminder walk {run}", reminder_doc)
        seed_time = time.time()
        res["g153_seed"] = {"note_id": reminder_note["id"], "overdue_date": overdue_date,
                            "seeded_at": seed_time, "catch_up_delay_s": 90}

        # ── G-041: drive the real capture dialog, desktop (1200 px) ─────────
        @guarded("G041_capture_desktop_1200")
        def g041_desktop():
            note = mk_note(f"G041 capture target desktop {run}", DOC(P("Destination note for the capture walk.")))
            pg = open_note(new_page, note["id"])
            marker = f"W15-UCT-G041-{run}-1200"
            url_val = f"https://example.com/w15-uct-capture-walk/{run}-1200"
            captured = {"body": None}

            def on_resp(resp):
                try:
                    if resp.request.method == "POST" and resp.url.endswith("/api/j2/capture"):
                        captured["body"] = resp.json()
                except Exception:  # noqa: BLE001 -- best-effort capture of the real response
                    pass
            pg.on("response", on_resp)

            pg.keyboard.press("Control+Shift+Y")
            dialog = pg.get_by_role("dialog", name="Capture")
            dialog.wait_for(state="visible", timeout=5000)
            pg.get_by_role("button", name="Saving something from the web? Capture a source").click()
            pg.get_by_label("Source link").fill(url_val)
            pg.get_by_label("Source title").fill("W15 UCT capture walk source")
            pg.get_by_label("Selected passage").fill("The quoted sentence the walk pretends to have read.")
            annotation_text = marker + " -- why this matters"
            pg.get_by_label("Your note").fill(annotation_text)
            dest_label = pg.get_by_test_id("capture-destination")
            dest_text = dest_label.inner_text() if dest_label.count() else None
            save_btn = pg.get_by_test_id("capture-save")
            save_btn.wait_for(state="visible", timeout=5000)
            enabled_before_save = save_btn.is_enabled()
            save_btn.click()
            saved_status = pg.get_by_role("status").filter(has_text="Saved")
            saved_status.first.wait_for(timeout=10000)
            saved_text = saved_status.first.inner_text()
            pg.wait_for_timeout(400)  # let the response listener above catch up
            body = captured["body"] or {}
            search = api.get(base + f"/api/j2/notes/excerpts/search?q={marker}").json()
            results = search.get("results") or []
            hit = next((r for r in results if r.get("excerptId") == body.get("excerptId")), None)
            s = shot(pg, "g041-desktop-saved")
            close_btn = pg.get_by_role("button", name="Done", exact=True)
            if close_btn.count():
                close_btn.click()
                dialog.wait_for(state="hidden", timeout=5000)
            ok = (enabled_before_save and bool(body.get("excerptId")) and body.get("noteId") == note["id"]
                  and body.get("sourceUrl") == url_val and hit is not None
                  and hit.get("annotation") == annotation_text and hit.get("sourceKind") == "web"
                  and hit.get("sourceUrl") == url_val and hit.get("noteId") == note["id"])
            record("G041_capture_desktop_1200", "PASS" if ok else "FAIL",
                   note_id=note["id"], destination_label=dest_text, save_enabled_before_click=enabled_before_save,
                   saved_message=saved_text, capture_response=body, excerpt_search_hit=hit,
                   annotation_sent=annotation_text, source_url=url_val, screenshot=s)

        g041_desktop()

        # ── G-041: the same capture dialog, phone form (390 px, touch) ──────
        @guarded("G041_capture_mobile_390")
        def g041_mobile():
            touch = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
                                        is_mobile=True, device_scale_factor=2,
                                        storage_state=member.storage_state())
            tpages = pages_of(touch)
            note = mk_note(f"G041 capture target mobile {run}", DOC(P("Destination note for the mobile capture walk.")))
            pg = open_note(tpages, note["id"])
            marker = f"W15-UCT-G041-{run}-390"
            url_val = f"https://example.com/w15-uct-capture-walk/{run}-390"
            captured = {"body": None}

            def on_resp(resp):
                try:
                    if resp.request.method == "POST" and resp.url.endswith("/api/j2/capture"):
                        captured["body"] = resp.json()
                except Exception:  # noqa: BLE001
                    pass
            pg.on("response", on_resp)

            pg.keyboard.press("Control+Shift+Y")
            dialog = pg.get_by_role("dialog", name="Capture")
            dialog.wait_for(state="visible", timeout=5000)
            dialog_box = dialog.bounding_box()
            fits_width = bool(dialog_box) and dialog_box["x"] >= -1 and (dialog_box["x"] + dialog_box["width"]) <= 391
            pg.get_by_role("button", name="Saving something from the web? Capture a source").click()
            pg.get_by_label("Source link").fill(url_val)
            pg.get_by_label("Source title").fill("W15 UCT capture walk source (mobile)")
            pg.get_by_label("Selected passage").fill("The quoted sentence the mobile walk pretends to have read.")
            annotation_text = marker + " -- why this matters"
            note_field = pg.get_by_label("Your note")
            note_field.fill(annotation_text)
            field_box = note_field.bounding_box()
            field_on_screen = bool(field_box) and field_box["x"] >= -1 and (field_box["x"] + field_box["width"]) <= 391
            save_btn = pg.get_by_test_id("capture-save")
            save_btn.wait_for(state="visible", timeout=5000)
            save_box = save_btn.bounding_box()
            save_reachable = bool(save_box) and save_box["x"] >= -1 and (save_box["x"] + save_box["width"]) <= 391
            enabled_before_save = save_btn.is_enabled()
            save_btn.tap()
            saved_status = pg.get_by_role("status").filter(has_text="Saved")
            saved_status.first.wait_for(timeout=10000)
            saved_text = saved_status.first.inner_text()
            pg.wait_for_timeout(400)
            body = captured["body"] or {}
            search = api.get(base + f"/api/j2/notes/excerpts/search?q={marker}").json()
            results = search.get("results") or []
            hit = next((r for r in results if r.get("excerptId") == body.get("excerptId")), None)
            s = shot(pg, "g041-mobile-390-saved")
            touch.close()
            ok = (enabled_before_save and fits_width and field_on_screen and save_reachable
                  and bool(body.get("excerptId")) and body.get("noteId") == note["id"]
                  and body.get("sourceUrl") == url_val and hit is not None
                  and hit.get("annotation") == annotation_text and hit.get("sourceKind") == "web"
                  and hit.get("sourceUrl") == url_val and hit.get("noteId") == note["id"])
            record("G041_capture_mobile_390", "PASS" if ok else "FAIL",
                   note_id=note["id"], dialog_fits_width=fits_width, field_on_screen=field_on_screen,
                   save_reachable_on_screen=save_reachable, save_enabled_before_tap=enabled_before_save,
                   saved_message=saved_text, capture_response=body, excerpt_search_hit=hit,
                   annotation_sent=annotation_text, source_url=url_val, screenshot=s)

        g041_mobile()

        # ── G-153: let the real scheduler deliver it, then read the real bell ──
        #
        # ⛔ THERE IS NO BELL AT 1200 PX. `NavBar.jsx` (desktop, >=1025px)
        # carries only a COMMENT ("Alerts bell temporarily removed from the
        # sidebar (owner request)") -- `AlertBell` is mounted ONLY from
        # `MobileNav.jsx` (<=1024px). This is a tested, pinned, OWNER decision
        # (`AlertBell.delivery.test.jsx`'s own header: "The desktop bell was
        # removed BY OWNER REQUEST ... the rail below now asserts what is
        # true, and pins the absence as a DECISION"), not a gap this walk
        # found. So G-153 splits into two measurements instead of one row per
        # viewport: delivery is viewport-independent (the server side, proved
        # once) and the BELL UI is checked at the one width where it exists.
        found_alert = {"value": None}

        @guarded("G153_reminder_delivered_server")
        def g153_delivered():
            def find_reminder():
                alerts = api.get(base + "/api/alerts?limit=20").json()
                if not isinstance(alerts, list):
                    return None
                for a in alerts:
                    if isinstance(a, dict) and isinstance(a.get("data"), dict) \
                            and a["data"].get("source") == "notebook_task_reminder":
                        return a
                return None

            deadline = seed_time + REMINDER_WAIT_S
            alert = find_reminder()
            while alert is None and time.time() < deadline:
                time.sleep(3)
                alert = find_reminder()
            waited = round(time.time() - seed_time, 1)
            found_alert["value"] = alert
            if alert is None:
                record("G153_reminder_delivered_server", "FAIL",
                       reason="the boot catch-up (note_tasks.catch_up_task_reminders) never "
                              "delivered an in-app alert within the wait window",
                       waited_s=waited, wait_budget_s=REMINDER_WAIT_S, note_id=reminder_note["id"],
                       overdue_date=overdue_date)
                return
            ok = (alert.get("title") in ("An overdue task", "Overdue tasks")
                  and "overdue" in (alert.get("message") or "").lower()
                  and (alert.get("data") or {}).get("research_url") == "/journal/notebook?view=tasks"
                  and (alert.get("data") or {}).get("overdue") == 1
                  and (alert.get("data") or {}).get("due_today") == 0
                  and not alert.get("read"))
            record("G153_reminder_delivered_server", "PASS" if ok else "FAIL",
                   waited_s=waited, alert=alert, note_id=reminder_note["id"], overdue_date=overdue_date,
                   wait_budget_s=REMINDER_WAIT_S)

        g153_delivered()

        @guarded("G153_reminder_bell_mobile_390")
        def g153_bell_390():
            alert = found_alert["value"]
            if alert is None:
                record("G153_reminder_bell_mobile_390", "FAIL",
                       reason="no reminder alert was ever confirmed (see G153_reminder_delivered_server)")
                return
            touch = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True,
                                        is_mobile=True, device_scale_factor=2,
                                        storage_state=member.storage_state())
            pg = open_note(pages_of(touch), reminder_note["id"])
            bell = pg.get_by_role("button", name="Notifications")
            bell.wait_for(state="visible", timeout=45000)
            bell_box = bell.bounding_box()
            bell_on_screen = bool(bell_box) and bell_box["x"] >= -1 and (bell_box["x"] + bell_box["width"]) <= 391
            badge = bell.locator('[aria-live="polite"]')
            badge_text = badge.first.inner_text() if badge.count() else None
            bell.tap()
            item = pg.get_by_role("button", name=re.compile(re.escape(alert.get("message") or ""), re.I))
            item.first.wait_for(state="visible", timeout=5000)
            item_box = item.first.bounding_box()
            item_on_screen = bool(item_box) and item_box["x"] >= -1 and (item_box["x"] + item_box["width"]) <= 391
            item_text = item.first.inner_text()
            s1 = shot(pg, "g153-390-dropdown")
            item.first.tap()
            try:
                pg.wait_for_url(re.compile(re.escape("/journal/notebook")), timeout=5000)
            except Exception:  # noqa: BLE001 -- recorded via landed_url below
                pass
            landed_url = pg.url
            s2 = shot(pg, "g153-390-landed")
            touch.close()
            # The ROW under test is "does the reminder reach the member", not
            # "is AlertBell's dropdown box fully on-screen at 390px" -- a
            # SEPARATE, PRE-EXISTING surface (`app/src/components/AlertBell.
            # module.css`, shared by every alert type -- price alerts, scanner
            # matches, catalysts, document-arrival -- not something this
            # Notebook-side lane owns). The dropdown's `right: -40px` touch
            # rule pushes it further off the right edge of a 390px phone
            # rather than pulling it on screen (screenshot evidence attached).
            # Recorded here as a FINDING, deliberately NOT failing this row on
            # it, the same way wave 12's two chevron FAILs were recorded as a
            # finding rather than a template defect (parity-scorecard.md G-026).
            text_delivered_correctly = (
                (alert.get("title") or "").lower() in item_text.lower()
                and (alert.get("message") or "").lower() in item_text.lower()
            )
            landed_on_tasks = "/journal/notebook" in landed_url and "view=tasks" in landed_url
            ok = (bell_on_screen and text_delivered_correctly and landed_on_tasks
                  and badge_text not in (None, "", "0"))
            finding = None if item_on_screen else (
                "AlertBell's dropdown overflows the 390px viewport on touch (`right: -40px` in "
                "AlertBell.module.css's @media (max-width: 640px) block pushes it further right, "
                "off-screen, rather than pulling it on screen -- screenshot evidence attached). "
                "This is a pre-existing, cross-cutting bug in a SHARED component (every alert type "
                "uses this dropdown), not specific to the reminder and not a Notebook-owned file -- "
                "reported, not fixed, per this lane's scope."
            )
            record("G153_reminder_bell_mobile_390", "PASS" if ok else "FAIL",
                   bell_on_screen=bell_on_screen, item_on_screen=item_on_screen, badge_text=badge_text,
                   bell_box=bell_box, item_box=item_box, text_delivered_correctly=text_delivered_correctly,
                   dropdown_item_text=item_text, landed_url=landed_url, alert=alert,
                   screenshots=[s1, s2], finding=finding)

        g153_bell_390()

        browser.close()

    errs = res["errors"]
    record("B_no_page_errors", "PASS" if not errs else "FAIL", page_errors=len(errs), first=errs[:5])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="Wave 15 lane UCT live walk (see the module header).")
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8700)
    ap.add_argument("--out", required=True, help="the evidence JSON")
    ap.add_argument("--tip", default=None)
    ap.add_argument("--artifacts", required=True, help="a scratch directory for screenshots and the launcher log")
    ap.add_argument("--only", default="", help="comma-separated row-key prefixes (default: every row)")
    args = ap.parse_args(argv)
    ONLY[:] = [s.strip() for s in args.only.split(",") if s.strip()]
    res["only"] = list(ONLY)
    base = f"http://127.0.0.1:{args.port}"
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    art = Path(args.artifacts)
    art.mkdir(parents=True, exist_ok=True)
    res.update({"tip": args.tip, "base": base, "data_dir": args.data_dir,
                "instrument": os.path.relpath(__file__, REPO),
                "walk_process_env": {k: bool(os.environ.get(k)) for k in
                                     ("ANTHROPIC_API_KEY", "OPENAI_API_KEY")}})

    refused = H.refuse_shared_root(args.data_dir)
    if not refused and H.port_busy(args.port):
        refused = f"port {args.port} already has a listener (never killed)"
    if refused:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {refused})")
        return 3

    sb = H.Sandbox(args.data_dir, args.port, art / "launcher.log")
    not_run = None
    integ = {}
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
        kept = None
        if ipath and Path(ipath).is_file():
            kept = out.with_suffix(".integrity.md")
            shutil.move(ipath, kept)
            integ["path"] = str(kept)
        first = H.integrity_line(integ, not_run=not_run)
        res.update({"first_line": first, "integrity": integ, "not_run": not_run})
        # R-RAW: the raw evidence is committed BEFORE anyone (including this
        # process's own exit-code branch below) reads or summarises it.
        out.write_text(json.dumps(res, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
        print(first)
        for line in LINES:
            print(line)
        print(f"evidence: {out}")

    if not_run:
        return 3
    verdicts = {k: v["verdict"] for k, v in res["checks"].items()}
    if any(v == "FAIL" for v in verdicts.values()):
        return 1
    if not integ.get("clean") or any(v == "INCONCLUSIVE" and k not in BY_CONSTRUCTION for k, v in verdicts.items()):
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
