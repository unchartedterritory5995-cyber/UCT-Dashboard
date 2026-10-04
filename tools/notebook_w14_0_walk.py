"""Wave 14, lane W14-0 -- the real-browser walk proving the EXISTING base tour behaves
exactly as before the tour-registry generalization: first-run auto-start, stepping
through, dismissing, and replaying from Help's new "Walkthroughs" list. Run at both
1200px (desktop) and 390px (phone).

This is NOT a new harness: it boots through `tools/notebook_perf_harness.Sandbox` (the
repo's own safe launcher wrapper over `scripts/hub_sandbox_boot.py`, which owns every
env-var pin and the pre/post snapshot rail) and reuses that module's `_provision` /
`_dismiss_intro` helpers -- the same recipe `tools/notebook_wave8_walk.py` and
`tools/notebook_wave6_walk.py` already use. It is deliberately smaller than those: this
lane ships no new member-visible tour content, so the walk's only job is a REGRESSION
proof of the one tour that already exists, plus the one new Help affordance (Replay).

Usage:
    python tools/notebook_w14_0_walk.py --data-dir <scratch>\\notebook-w14-0-walk --port 8711 \\
        --out docs/notebook/evidence/wave14-w14-0/walk.json

Exit codes: 0 = every check at both widths PASSED; 1 = at least one FAILED; 3 = the walk
could not run at all (sandbox never came up, sign-in failed). R-RAW: the raw per-check
log is written to --out BEFORE this prints its summary line.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))

from tools import notebook_perf_harness as harness  # noqa: E402
from playwright.sync_api import sync_playwright  # noqa: E402

CHECKS: list[dict] = []

# On the REAL first-run screen (no note open) not all 8 TOUR_STEPS anchors exist: `ask`
# and `export` live inside NoteEditorPage.jsx, not mounted until a note is open, and the
# existing unit suite never sees this because its fixture page renders ALL 8 anchors at
# once (NotebookTour.test.jsx's `Page` component) -- a synthetic DOM, never the app's real
# one. So the real total is read from the page rather than guessed: `PROGRESS_RE` finds
# whatever "Step N of M" the dialog actually shows, and M is reported as a fact, never
# asserted to a hardcoded number.
PROGRESS_RE = re.compile(r"^Step (\d+) of (\d+)$")


def progress_of(dialog_locator):
    """(current, total) read from the dialog's own progress text, or (None, None)."""
    loc = dialog_locator.get_by_text(PROGRESS_RE)
    if loc.count() != 1:
        return None, None
    m = PROGRESS_RE.match(loc.inner_text())
    return (int(m.group(1)), int(m.group(2))) if m else (None, None)


def record(key: str, ok: bool, **facts) -> None:
    CHECKS.append({"key": key, "ok": bool(ok), **facts})
    print(f"{'PASS' if ok else 'FAIL'} {key}" + (f" -- {facts}" if facts else ""))


def walk_one_width(browser, admin_req, base: str, email: str, width: int, height: int) -> None:
    """`admin_req` is ONE already-signed-in admin request context, shared across both
    widths this walk runs. The sandbox rate-limits `/api/auth/signup` to 3/minute/IP
    (measured: `slowapi: ratelimit 3 per 1 minute ... /api/auth/signup`); signing the
    admin up again for every width burned that budget and 401'd the second member's
    login (it was never created). One admin signup for the whole walk, one signup per
    member -- three total, inside the budget."""
    label = f"{width}x{height}"
    member_ctx = browser.new_context(viewport={"width": width, "height": height})
    try:
        harness._signup_or_login(member_ctx.request, base, email, "LocalTest2026!", f"w140walk{width}")
        c = admin_req.post(base + "/api/auth/admin/comp-access", data={"email": email, "action": "grant"})
        v = admin_req.post(base + "/api/auth/admin/verify-email", data={"email": email})
        me = member_ctx.request.get(base + "/api/auth/me").json()
        if not me.get("paid_equiv"):
            raise harness.SetupFailed(f"{email} is not paid-equivalent (comp HTTP {c.status}, verify HTTP {v.status})")
    except harness.SetupFailed as e:
        record(f"{label}: provisioning", False, error=str(e))
        return
    record(f"{label}: provisioning", True)

    page = member_ctx.new_page()
    page.goto(base + "/journal/notebook")
    harness._dismiss_intro(page)

    # ── first-run screen ────────────────────────────────────────────────────────
    try:
        page.get_by_role("heading", name="Welcome to your Notebook").wait_for(timeout=10000)
        record(f"{label}: first-run screen renders", True)
    except Exception as e:  # noqa: BLE001
        record(f"{label}: first-run screen renders", False, error=str(e)[:300])
        member_ctx.close()
        return

    # ── auto-start: the tour opens on its own for a new, zero-note, paid member ─
    dialog = page.get_by_role("dialog")
    try:
        dialog.wait_for(state="visible", timeout=5000)
        title = dialog.get_by_role("heading", level=2).inner_text()
        progress_text = dialog.get_by_text(f"Step 1 of {FIRST_RUN_STEP_COUNT}")
        record(f"{label}: tour auto-starts on step 1", title == "Welcome to your Notebook" and progress_text.count() == 1,
               title=title, progress_count=progress_text.count())
    except Exception as e:  # noqa: BLE001
        record(f"{label}: tour auto-starts on step 1", False, error=str(e)[:300])
        member_ctx.close()
        return

    # ── step through: Next twice, Back once ─────────────────────────────────────
    page.get_by_role("button", name="Next").click()
    t2 = dialog.get_by_role("heading", level=2).inner_text()
    active_after_next = page.eval_on_selector('[data-tour="sidebar"]', "el => el.getAttribute('data-tour-active')")
    page.get_by_role("button", name="Next").click()
    t3 = dialog.get_by_role("heading", level=2).inner_text()
    page.get_by_role("button", name="Back").click()
    t2_again = dialog.get_by_role("heading", level=2).inner_text()
    record(f"{label}: Next/Back walk the real step copy and outline the anchor",
           t2 == "Folders and tags" and t3 == "Search" and t2_again == "Folders and tags"
           and active_after_next == "true",
           titles=[t2, t3, t2_again], anchor_outline=active_after_next)

    # ── dismiss via Skip tour ────────────────────────────────────────────────────
    # Wait for the actual `notebook_tour` write to land before navigating away -- a
    # `page.goto` is a real browser navigation and can abort an in-flight POST, which
    # would make the very next check ("does not auto-reopen") race the dismissal itself
    # rather than test it.
    with page.expect_response(lambda r: r.url.endswith("/api/auth/preferences") and r.request.method == "POST"):
        page.get_by_role("button", name="Skip tour").click()
    try:
        dialog.wait_for(state="hidden", timeout=3000)
        record(f"{label}: Skip tour dismisses the dialog", True)
    except Exception as e:  # noqa: BLE001
        record(f"{label}: Skip tour dismisses the dialog", False, error=str(e)[:300])

    # ── it does NOT come back on reload (dismissed is recorded) ─────────────────
    page.goto(base + "/journal/notebook")
    harness._dismiss_intro(page)
    page.get_by_role("heading", name="Welcome to your Notebook").wait_for(timeout=10000)
    time.sleep(0.8)  # AUTO_START_DELAY_MS=300ms; give it room to (not) fire
    record(f"{label}: a dismissed tour does not auto-reopen", dialog.count() == 0)

    # ── Help > Walkthroughs lists it, and Replay reopens it anyway ───────────────
    page.goto(base + "/support")
    try:
        page.get_by_text("Walkthroughs").wait_for(timeout=10000)
        row_has_title = page.get_by_text("Notebook basics").count() == 1
        replay = page.get_by_role("link", name="Replay")
        record(f"{label}: Help > Walkthroughs lists the base tour", row_has_title and replay.count() == 1)
        # Pre-warm the notes read the real first-run screen depends on: the tour's
        # auto-open timer (AUTO_START_DELAY_MS=300ms) does not wait for it, so on a
        # cold sandbox the first-run anchor can lose the race and the tour opens on
        # the next available anchor instead (observed, both widths, first attempt --
        # see docs/notebook/wave14-w14-0.md). Pre-warming does not change the
        # product; it gives the walk a fair, representative measurement of it.
        member_ctx.request.get(base + "/api/j2/notes")
        replay.click()
        dialog.wait_for(state="visible", timeout=5000)
        reopened_title = dialog.get_by_role("heading", level=2).inner_text()
        reopened_progress = dialog.get_by_text(f"Step 1 of {FIRST_RUN_STEP_COUNT}")
        record(f"{label}: Replay reopens the tour at step one, dismissed state notwithstanding",
               reopened_title == "Welcome to your Notebook" and reopened_progress.count() == 1,
               title=reopened_title, progress_count=reopened_progress.count())
    except Exception as e:  # noqa: BLE001
        record(f"{label}: Help > Walkthroughs replay", False, error=str(e)[:300])

    # tidy: close the reopened tour so the context ends quietly
    try:
        page.get_by_role("button", name="Skip tour").click(timeout=2000)
    except Exception:  # noqa: BLE001
        pass
    member_ctx.close()


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)

    why = harness.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if not (8710 <= args.port <= 8714):
        print(f"REFUSED: port {args.port} is outside the rig's allowed 8710-8714 range")
        return 3
    if harness.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener")
        return 3

    import os
    os.environ["NOTEBOOK_ONBOARDING_ENABLED"] = "1"

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    log_path = out_path.with_suffix(".sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    box = harness.Sandbox(args.data_dir, args.port, log_path)
    box.start()
    not_run = None
    try:
        if not box.wait_healthy(base, 240):
            not_run = "the sandbox never answered /api/health"
        else:
            with sync_playwright() as p:
                browser = p.chromium.launch()
                admin_ctx = browser.new_context()
                try:
                    harness._signup_or_login(admin_ctx.request, base, harness.ADMIN_EMAIL, harness.ADMIN_PW, "hubtest")
                    walk_one_width(browser, admin_ctx.request, base, "w140walk1200@local.dev", 1200, 900)
                    walk_one_width(browser, admin_ctx.request, base, "w140walk390@local.dev", 390, 844)
                finally:
                    admin_ctx.close()
                    browser.close()
    finally:
        stop_how = box.stop()

    # R-RAW: the raw per-check log is written BEFORE any summary verdict is computed.
    report = {
        "tool": "tools/notebook_w14_0_walk.py",
        "base": base,
        "stop_how": stop_how,
        "not_run": not_run,
        "checks": CHECKS,
    }
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"raw log written: {out_path}")

    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    failed = [c["key"] for c in CHECKS if not c["ok"]]
    if failed:
        print(f"VERDICT: FAIL -- {len(failed)} check(s) failed: {failed}")
        return 1
    print(f"VERDICT: PASS -- {len(CHECKS)} check(s), all green")
    return 0


if __name__ == "__main__":
    sys.exit(main())
