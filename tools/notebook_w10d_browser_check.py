"""Wave 10 lane 10D: the sandbox browser check for the Notebook core-action telemetry
(clause 15a, ruling R-16) and the SLO job's alert row (clause 15c, ruling R-15).

In a REAL browser against a SANDBOX (never C:\\data, never production), a paid member
saves a note, accepts a writing-help draft, dictates into it, exports it, shares it,
publishes it, picks it in the switcher, searches and imports a file. An admin then reads `GET /api/admin/notebook-telemetry`, and each
action must be counted ONCE (save: at least once, since every landed autosave is one).
Then the SLO job is forced over a save-success breach (25 given-up saves sent through
the real telemetry door). On a sandbox with no save-success page yet it must write its
page row, `delivered='log'` (the sandbox blanks DISCORD_WEBHOOK_URL), and the launcher's
log must carry the PAGE line. On a sandbox an earlier run already paged, inside the
6-hour re-page window, it must record the breaching evaluation and NOT page again (no
PAGE line) -- which of the two applied is `slo_expect` in the record.

PRECONDITIONS (the wave-8 walk's, kept): app/dist REBUILT from the tree under test; the
sandbox booted through `scripts/hub_sandbox_boot.py` (this tool starts it via the perf
harness's `Sandbox`: the SIGBREAK shim, its own process group, a graceful stop so the
shutdown checkpoint is written); the data dir passed from PowerShell or single-quoted.

Writing help and dictation need a model and a microphone. The sandbox has no model key
(`ANTHROPIC_API_KEY`/`OPENAI_API_KEY` blank), so the browser answers exactly TWO requests
itself, stated in the record under `stubs` with how many times each was served: the
writing-help draft stream and the transcription. Chromium's fake audio device stands in
for the microphone. Everything the telemetry rows measure is real: the rendered control,
the member's Accept / Stop, the client door that emits the event, and the POST to the
sandbox's `/api/j2/telemetry`. What the stubs do NOT exercise is the model call and the
server's writing-help / transcription routes, and the record says so.

R-RAW: the raw record is written to --out before the summary. The FIRST output line after
the per-row progress is the SANDBOX INTEGRITY line (pre-boot, +15 s, +120 s, shutdown).

    python tools/notebook_w10d_browser_check.py --data-dir 'C:\\data-w10d' --port 8214 \\
        --out docs/notebook/evidence/wave10-10d/browser-check-<run>.json --log <scratch>\\launcher.log
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import sys
import tempfile

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:  # noqa: BLE001
        pass

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import notebook_perf_harness as ph  # noqa: E402  -- ONE sandbox recipe, never a copy

MEMBER = ("w10d@local.dev", "LocalTest2026!", "w10d")
NOTE_TITLE = "w10d telemetry check"
SANDBOX_ENV = {
    # the gates the doors under test need, each read per request (notebook_flags.flag_on)
    "J2_SHARE_LINKS_ENABLED": "1",
    "NOTEBOOK_PUBLISH_ENABLED": "1",
    "NOTEBOOK_WRITING_HELP_ENABLED": "1",
    # NO model key, stated: writing help and autofill cannot produce a draft here
    "ANTHROPIC_API_KEY": "",
    "OPENAI_API_KEY": "",
}
EXPECT_ONCE = ("writing_help_used", "dictation_used", "export_used", "share_used",
               "publish_used", "switcher_used", "search_used", "import_used")
PAGE_LINE = "[notebook-slo] PAGE"
# The two model-backed answers the browser supplies itself (see the docstring).
WRITING_HELP_ROUTE = "**/writing-help/stream"
WRITING_HELP_SSE = (
    'data: {"type":"start","model":"stub-no-model-key","action":"summarize","instruction":"Summarize"}\n\n'
    'data: {"type":"final","text":"A stubbed summary for the telemetry check."}\n\n')
TRANSCRIBE_ROUTE = "**/api/voice/transcribe"
TRANSCRIBE_JSON = '{"text": "three stubbed words", "seconds_billed": 1}'


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8214)
    ap.add_argument("--out", required=True)
    ap.add_argument("--log", required=True)
    args = ap.parse_args(argv)
    if args.data_dir.strip().rstrip("\\/").lower() in ph.SHARED_ROOTS:
        print("REFUSED: the data dir is the shared root")
        return 3
    base = f"http://127.0.0.1:{args.port}"
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    rec: dict = {"tool": "notebook_w10d_browser_check", "base": base, "data_dir": args.data_dir,
                 "started_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                 "sandbox_env": {k: ("(blank)" if v == "" else v) for k, v in SANDBOX_ENV.items()},
                 "steps": [], "rows": []}

    def row(name, result, **detail):
        rec["rows"].append({"row": name, "result": result, **detail})
        why = detail.get("why")
        print(f"  [{result}] {name}" + (f" -- {why}" if why else ""), flush=True)

    os.environ.update(SANDBOX_ENV)
    sb = ph.Sandbox(args.data_dir, args.port, pathlib.Path(args.log))
    sb.start()
    try:
        if not sb.wait_healthy(base, 240):
            row("sandbox answers /api/health", "INCONCLUSIVE", why="never healthy")
        else:
            sb.wait_checkpoint(ph.POST_BOOT, ph.POST_BOOT_WAIT_S)
            _drive(base, row, rec)
            # Hold past the launcher's +120 s snapshot, so the verdict covers the prewarms.
            sb.wait_checkpoint(ph.PREWARM, ph.PREWARM_WAIT_S)
    finally:
        rec["stop"] = sb.stop()
        integ = ph.read_integrity(sb.integrity_path(),
                                  [ph.PRE_BOOT, ph.POST_BOOT, ph.PREWARM, ph.SHUTDOWN])
        rec["integrity"] = integ
        rec["integrity_line"] = ph.integrity_line(integ)
        try:
            log_text = pathlib.Path(args.log).read_text(encoding="utf-8", errors="replace")
        except OSError:
            log_text = ""
        rec["launcher_page_lines"] = [ln for ln in log_text.splitlines() if PAGE_LINE in ln]
        rec["finished_utc"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        out.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")   # R-RAW before the summary
        print(rec["integrity_line"], flush=True)
    page_logged = bool(rec["launcher_page_lines"])
    if rec.get("slo_expect") == "repage-suppressed":
        name, good = "the launcher log carries NO PAGE line (the re-page was suppressed)", not page_logged
    else:
        name, good = "the launcher log carries the PAGE line", page_logged
    rec_rows = rec["rows"] + [{"row": name, "result": "PASS" if good else "FAIL"}]
    print(f"  [{'PASS' if good else 'FAIL'}] {name} ({len(rec['launcher_page_lines'])})")
    bad = [r["row"] for r in rec_rows if r["result"] == "FAIL"]
    unrun = [r["row"] for r in rec_rows if r["result"] == "INCONCLUSIVE"]
    print(f"CHECK: FAIL {bad or 'none'}; INCONCLUSIVE {unrun or 'none'}; evidence {out}")
    return 1 if bad or not rec["integrity"]["clean"] else 0


def _drive(base: str, row, rec: dict) -> None:
    from playwright.sync_api import sync_playwright

    page_ref: list = [None]

    def step(name, fn):
        """One action; a step that could not be driven is named, and the rest still run."""
        try:
            fn()
            rec["steps"].append({"step": name, "driven": True})
        except Exception as e:  # noqa: BLE001
            rec["steps"].append({"step": name, "driven": False,
                                 "why": f"{type(e).__name__}: {str(e)[:300]}"})
            print(f"  (step {name} not driven: {type(e).__name__}: {str(e)[:200]})", flush=True)
            # A step that died with a sheet open would sit over every later step (measured on
            # the first run: one stuck sheet cascaded into every step after it).
            try:
                for _ in range(2):
                    page_ref[0].keyboard.press("Escape")
                    page_ref[0].wait_for_timeout(300)
            except Exception:  # noqa: BLE001
                pass

    served = {"writing_help_stream": 0, "transcribe": 0}
    rec["stubs"] = {
        "why": "no model key in the sandbox; the model call and the server's writing-help and "
               "transcription routes are NOT exercised by these two rows",
        "routes": {WRITING_HELP_ROUTE: "writing_help_stream", TRANSCRIBE_ROUTE: "transcribe"},
        "served": served,
    }

    def _serve_wh(route):
        served["writing_help_stream"] += 1
        route.fulfill(status=200, headers={"content-type": "text/event-stream"}, body=WRITING_HELP_SSE)

    def _serve_transcribe(route):
        served["transcribe"] += 1
        route.fulfill(status=200, content_type="application/json", body=TRANSCRIBE_JSON)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True, args=[
            "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"])
        admin = browser.new_context()
        member = browser.new_context(accept_downloads=True, viewport={"width": 1400, "height": 900},
                                     permissions=["microphone"])
        # The one-time dictation tip (VoiceInputButton HINT_KEY) would sit over the toolbar.
        member.add_init_script("try { localStorage.setItem('voice.dictation.hintSeen', '1') } catch (e) {}")
        member.route(WRITING_HELP_ROUTE, _serve_wh)
        member.route(TRANSCRIBE_ROUTE, _serve_transcribe)
        try:
            ph._provision(admin.request, member.request, base, member=MEMBER)
            row("provision: a paid, verified member + the sandbox admin", "PASS")
            me = member.request.get(base + "/api/auth/me").json()
            rec["member_flags"] = {k: me.get(k) for k in (
                "paid_equiv", "j2_share_links_enabled", "notebook_publish_enabled",
                "notebook_writing_help_enabled")}
            # Unique per run: a rerun on the same sandbox must not pick the last run's note in
            # the switcher, nor re-import an identical file (the wizard calls that "unchanged").
            tag = dt.datetime.now().strftime("%H%M%S")
            title = f"{NOTE_TITLE} {tag}"
            rec["run_tag"] = tag
            before = _counts(admin, base)
            rec["counts_before"] = before
            nid = member.request.post(base + "/api/j2/notes", data={
                "title": title, "bodyJson": {"type": "doc", "content": [
                    {"type": "paragraph", "content": [{"type": "text", "text": "Seeded words."}]}]},
            }).json()["note"]["id"]
            page = member.new_page()
            page_ref[0] = page
            page.goto(base + f"/journal/notebook?note={nid}")
            ph._dismiss_intro(page)
            editor = page.locator(".ProseMirror").first
            editor.wait_for(state="visible", timeout=45000)

            def save():
                editor.click()
                page.keyboard.press("Control+End")
                page.keyboard.type(" Typed in the browser.")
                page.wait_for_timeout(5000)   # past the autosave debounce; the landed PUT is the event

            def writing_help():
                page.locator('button[aria-label="Writing help"]').first.click()
                # ⚠️ The panel's Sheet has a TITLE but no ariaLabel, and Sheet names its dialog
                # only through aria-label, so the dialog has NO accessible name (measured on the
                # first run: role=dialog name="Writing help" matched nothing). Its buttons are
                # unique on the page, so they are found by name instead.
                page.get_by_role("button", name="Write it", exact=True).click(timeout=15000)
                accept = page.get_by_role("button", name="Accept", exact=True)
                accept.click(timeout=15000)
                accept.wait_for(state="detached", timeout=15000)
                page.wait_for_timeout(1500)

            def dictation():
                page.locator(".ProseMirror").first.click()
                page.keyboard.press("Control+End")
                page.get_by_role("button", name="Start voice input").first.click()
                page.wait_for_timeout(1500)   # the fake device records a tone
                page.get_by_role("button", name="Stop voice input").first.click()
                page.get_by_text("three stubbed words").first.wait_for(timeout=15000)
                page.wait_for_timeout(1500)

            def export():
                with page.expect_download(timeout=30000):
                    page.locator('button[aria-haspopup="menu"]', has_text="Export").first.click()
                    page.get_by_role("menuitem", name="Markdown", exact=True).click()
                page.wait_for_timeout(800)

            def share_and_publish():
                page.locator('button[aria-haspopup="dialog"]', has_text="Share").first.click()
                dialog = page.get_by_role("dialog", name="Share this note")
                dialog.get_by_role("button", name="Create link", exact=True).click()
                dialog.get_by_text("Share link created").first.wait_for(timeout=15000)
                dialog.get_by_role("button", name="Publish this note", exact=True).click()
                dialog.get_by_text("Published.").first.wait_for(timeout=15000)
                page.keyboard.press("Escape")
                page.wait_for_timeout(500)

            def switcher():
                # Note rows are offered when the query asks for recents (CommandPalette.jsx).
                page.keyboard.press("Control+k")
                page.get_by_role("combobox", name="Search a security, company, or note").fill("recent")
                page.get_by_role("option", name=f"Note: {title}").first.click(timeout=15000)
                page.wait_for_timeout(1500)

            def search():
                page.locator('[aria-label="Search notes"]').first.click()
                page.get_by_label("Search your notes").fill("telemetry")
                page.wait_for_timeout(3000)   # the debounce, then the first settled page

            def import_file():
                with tempfile.TemporaryDirectory() as d:
                    md = pathlib.Path(d) / f"w10d-import-{tag}.md"
                    md.write_text(f"# W10D import {tag}\n\nOne imported note, run {tag}.\n", encoding="utf-8")
                    page.goto(base + "/journal/notebook")
                    ph._dismiss_intro(page)
                    page.get_by_text("All notes", exact=True).first.click(timeout=30000)
                    page.locator('[data-tour="import"]').first.click(timeout=15000)
                    page.get_by_test_id("import-file-input").set_input_files(str(md))
                    page.get_by_text("Detected source").first.wait_for(timeout=30000)
                    page.locator("button.btn-primary", has_text="Import").last.click()
                    page.get_by_text("Imported 1 note.").first.wait_for(timeout=60000)
                page.wait_for_timeout(1500)

            for name, fn in (("save", save), ("writing help", writing_help), ("dictation", dictation),
                             ("export", export), ("share+publish", share_and_publish),
                             ("switcher", switcher), ("search", search), ("import", import_file)):
                step(name, fn)

            after = _counts(admin, base)
            delta = {e: after.get(e, 0) - before.get(e, 0) for e in after}
            rec["counts_after"], rec["delta"] = after, delta
            for e in EXPECT_ONCE:
                row(f"{e} counted once", "PASS" if delta.get(e) == 1 else "FAIL", count=delta.get(e))
            row("save_success counted (every landed autosave is one)",
                "PASS" if delta.get("save_success", 0) >= 1 else "FAIL", count=delta.get("save_success"))
            row("each stubbed model answer was requested exactly once by its door",
                "PASS" if served == {"writing_help_stream": 1, "transcribe": 1} else "FAIL",
                served=dict(served))

            # The SLO job, forced over a save-success breach sent through the real door.
            # What it must do depends on what this data dir already holds (R-15): with no
            # save-success page yet it PAGES (webhook blank -> delivered 'log'); with a page
            # already inside the re-page window (an earlier run on this sandbox) it must NOT
            # page again, and must still record the breaching evaluation.
            prior = admin.request.get(base + "/api/admin/notebook-slo").json().get("events", [])
            prior_pages = [e for e in prior if e.get("kind") == "page" and e.get("slo") == "save_success"]
            rec["slo_expect"] = "repage-suppressed" if prior_pages else "page"
            rec["slo_prior_page_rows"] = prior_pages
            codes = [member.request.post(base + "/api/j2/telemetry", data={
                "event": "save_failed", "props": {"status": 500, "reason": "http", "retrying": False},
            }).status for _ in range(25)]
            rec["save_failed_posts"] = {"n": len(codes), "statuses": sorted(set(codes))}
            run = admin.request.post(base + "/api/admin/notebook-slo/run").json()
            rec["slo_run"] = run
            read = admin.request.get(base + "/api/admin/notebook-slo").json()
            # Only the rows THIS forced run wrote (stamped with its evaluation time): a row
            # left by an earlier run on the same data dir must never read as this run's PASS.
            pages = [e for e in read.get("events", []) if e.get("kind") == "page"
                     and e.get("created_at") == run.get("evaluated_at")]
            rec["slo_page_rows"] = pages
            rec["slo_page_rows_any_run"] = sum(1 for e in read.get("events", []) if e.get("kind") == "page")
            evals = [e for e in read.get("events", []) if e.get("kind") == "evaluation"
                     and e.get("slo") == "save_success" and e.get("created_at") == run.get("evaluated_at")]
            state = (run.get("slos", {}).get("save_success") or {}).get("state")
            if rec["slo_expect"] == "page":
                ok = (len(pages) == 1 and pages[0].get("delivered") == "log"
                      and pages[0].get("slo") == "save_success")
                row("the forced SLO run writes ONE page row, save_success, delivered to the local log",
                    "PASS" if ok else "FAIL", pages=len(pages), state=state)
            else:
                ok = not pages and len(evals) == 1 and evals[0].get("state") == "breach"
                row("a breach already paged inside the re-page window is recorded, NOT paged again",
                    "PASS" if ok else "FAIL", pages=len(pages), evaluations=len(evals), state=state)
            row("no latency SLO reached the pager",
                "PASS" if not [p for p in pages if p.get("slo") != "save_success"] else "FAIL")
        except Exception as e:  # noqa: BLE001 -- setup that could not run is INCONCLUSIVE, named
            row("browser check", "INCONCLUSIVE", why=f"{type(e).__name__}: {str(e)[:300]}")
        finally:
            browser.close()


def _counts(admin, base: str) -> dict:
    body = admin.request.get(base + "/api/admin/notebook-telemetry").json()
    return {e: v.get("count", 0) for e, v in (body.get("windows", {}).get("7") or {}).items()}


if __name__ == "__main__":
    sys.exit(main())
