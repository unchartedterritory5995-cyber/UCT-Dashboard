"""Wave 12 lane 12B: the real-browser walk for the deeper built-in template library.

In a REAL browser (Playwright Chromium) against a LOCAL SANDBOX (never C:\\data, never
production), a paid member:

  G  (1200 px, fresh account) the empty notebook shows the template gallery inline. The
     key list for the rest of the walk is READ FROM THE GALLERY (`[data-template-key]`),
     never typed here, and no card's preview shows the walkthrough ("How to use this
     template").
  N  for every template at 1200 px, and for the wave-12 new and deepened templates at
     390 px (touch): `/journal/notebook?new=<key>` (the stable deep link, the product's
     own create door) creates the note and the editor opens it:
       - the editor is editable and shows no schema refusal or unreadable-note sentence;
       - the tables, toggles and callouts the STORED body holds are all in the editor DOM
         (a node the editor could not build would be missing here);
       - the stored body ENDS in the walkthrough toggle, collapsed;
       - the walkthrough opens BY KEYBOARD: Tab from where the create put focus until the
         walkthrough's own chevron has focus, then Enter. The Tab trail is recorded. If
         Tab never reaches it, that is recorded as a FAIL (a finding), and the toggle is
         then opened with Enter after a programmatic focus, labelled "fallback" -- never
         claimed as the keyboard path;
       - after opening, the first step is visible and the stored body says open.
  E  no uncaught page error anywhere in the walk.

⛔ THE DRIVER NEVER IMPORTS api.*: it talks to the sandbox over HTTP only, through the perf
harness's one Sandbox recipe (scripts/hub_sandbox_boot.py: env pins, the shared-root
tripwire, the integrity snapshots).

PRECONDITIONS: app/dist REBUILT from the tree under test; a port in 8585-8589 that is free
(refused, never killed); the data dir passed from PowerShell or quoted, outside C:\\data.

R-RAW: the raw record (and the screenshots) are written to --out before any summary.

    python tools/notebook_w12b_templates_walk.py --data-dir '<scratch>\\w12b-walk1' --port 8586 `
        --out docs/notebook/evidence/wave12-12b/walk-<run>.json --log '<scratch>\\w12b-walk1.log'
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import pathlib
import re
import sys
import time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
    except Exception:  # noqa: BLE001
        pass

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import notebook_perf_harness as ph  # noqa: E402  -- ONE sandbox recipe, never a copy

MEMBER = ("w12b@local.dev", "LocalTest2026!", "w12b")
SANDBOX_ENV = {"ANTHROPIC_API_KEY": "", "OPENAI_API_KEY": ""}
PORTS = range(8585, 8590)
WALKTHROUGH_TITLE = "How to use this template"
# The sentences an editor shows when it cannot open a body (lib/notebookSchema.js
# SCHEMA_REFUSAL_DETAIL; notes.py UNBUILDABLE_BODY_DETAIL). Either on screen is a refusal.
REFUSALS = (
    "This note has content from a newer version of the app",
    "a piece of text the editor can't open",
)
# The wave-12 templates walked again at 390 px: new (7) and deepened (3). The 1200 px pass
# walks EVERY key the gallery renders.
PHONE_KEYS = (
    "breakout-plan", "pullback-plan", "episodic-pivot-plan", "undercut-rally-plan",
    "parabolic-short-plan", "earnings-prep", "sector-note",
    "trade-review", "weekly-review", "monthly-review",
)
MAX_TABS = 30
# Enter is probed on its own extra note, once per viewport (run 4: Enter changed the body).
ENTER_PROBE_KEYS = ("trade-review",)

# The walkthrough toggle (found by its title, wherever it is), open.
OPEN_JS = r"""
() => [...document.querySelectorAll('.ProseMirror [data-type="toggle"]')].some((t) =>
  t.querySelector('summary')?.textContent.trim() === 'How to use this template'
  && t.getAttribute('data-open') === 'true')
"""

ACTIVE_JS = r"""
() => {
  const a = document.activeElement
  const chevs = [...document.querySelectorAll('.ProseMirror [data-type="toggle"] button.uctToggleChevron')]
  const walk = chevs.filter((c) => {
    const s = c.closest('[data-type="toggle"]')?.querySelector('summary')
    return s && s.textContent.trim() === 'How to use this template'
  })
  return {
    tag: a ? a.tagName.toLowerCase() : null,
    cls: a && typeof a.className === 'string' ? a.className.slice(0, 60) : null,
    label: a ? (a.getAttribute('aria-label') || '').slice(0, 60) : null,
    inEditor: Boolean(a && a.closest && a.closest('.ProseMirror')),
    isWalkthroughChevron: Boolean(a && walk.includes(a)),
  }
}
"""


def _count(body: dict, types: set[str]) -> dict[str, int]:
    out = {t: 0 for t in types}
    stack = [body]
    while stack:
        n = stack.pop()
        if not isinstance(n, dict):
            continue
        if n.get("type") in out:
            out[n["type"]] += 1
        stack.extend(n.get("content") or [])
    return out


def _text(n) -> str:
    if not isinstance(n, dict):
        return ""
    if n.get("type") == "text":
        return n.get("text") or ""
    return "".join(_text(c) for c in n.get("content") or [])


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8586)
    ap.add_argument("--out", required=True)
    ap.add_argument("--log", required=True)
    args = ap.parse_args(argv)
    if args.port not in PORTS:
        print(f"REFUSED: port {args.port} is outside the 12B sandbox range 8585-8589")
        return 3
    why = ph.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if ph.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener (never killed)")
        return 3
    base = f"http://127.0.0.1:{args.port}"
    out = pathlib.Path(args.out)
    shots = out.with_suffix("")
    shots.mkdir(parents=True, exist_ok=True)
    rec: dict = {"tool": "notebook_w12b_templates_walk", "base": base, "data_dir": args.data_dir,
                 "started_utc": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
                 "sandbox_env": {k: ("(blank)" if v == "" else v) for k, v in SANDBOX_ENV.items()},
                 "rows": [], "notes": [], "screenshots": [], "page_errors": []}

    def row(name, result, **detail):
        rec["rows"].append({"row": name, "result": result, **detail})
        why_ = detail.get("why") or detail.get("saw")
        print(f"  [{result}] {name}" + (f" -- {str(why_)[:200]}" if why_ else ""), flush=True)

    os.environ.update(SANDBOX_ENV)
    sb = ph.Sandbox(args.data_dir, args.port, pathlib.Path(args.log))
    sb.start()
    try:
        if not sb.wait_healthy(base, 240):
            row("sandbox answers /api/health", "INCONCLUSIVE", why="never healthy")
        else:
            sb.wait_checkpoint(ph.POST_BOOT, ph.POST_BOOT_WAIT_S)
            try:
                _drive(base, row, rec, shots)
            except Exception as e:  # noqa: BLE001 -- recorded, never swallowed silently
                row("the walk ran to the end", "FAIL", why=f"{type(e).__name__}: {str(e)[:400]}")
            sb.wait_checkpoint(ph.PREWARM, ph.PREWARM_WAIT_S)
    finally:
        rec["stop"] = sb.stop()
        integ = ph.read_integrity(sb.integrity_path(), [ph.PRE_BOOT, ph.POST_BOOT, ph.PREWARM, ph.SHUTDOWN])
        rec["integrity"] = integ
        rec["integrity_line"] = ph.integrity_line(integ)
        rec["finished_utc"] = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
        out.write_text(json.dumps(rec, indent=2) + "\n", encoding="utf-8")   # R-RAW before the summary
        print(rec["integrity_line"], flush=True)
    bad = [r["row"] for r in rec["rows"] if r["result"] == "FAIL"]
    unrun = [r["row"] for r in rec["rows"] if r["result"] == "INCONCLUSIVE"]
    print(f"WALK: {len(rec['rows'])} rows; FAIL {bad or 'none'}; INCONCLUSIVE {unrun or 'none'}; evidence {out}")
    return 1 if bad or unrun or not rec["integrity"].get("clean") else 0


def _drive(base: str, row, rec: dict, shots: pathlib.Path) -> None:
    from playwright.sync_api import sync_playwright

    def shot(pg, name):
        p = shots / f"{len(rec['screenshots']) + 1:02d}-{name}.png"
        pg.screenshot(path=str(p), full_page=False)
        rec["screenshots"].append(p.name)

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        admin = browser.new_context()
        wide = browser.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
        req = wide.request
        ph._provision(admin.request, req, base, member=MEMBER)
        row("provision: a paid, verified member", "PASS")

        def page_for(ctx, label):
            pg = ctx.new_page()
            pg.on("pageerror", lambda e: rec["page_errors"].append({"viewport": label, "error": str(e)[:400]}))
            pg.on("dialog", lambda d: d.accept())
            return pg

        # ── G: the gallery, on a fresh account (the empty notebook renders it inline) ──
        pg = page_for(wide, "1200")
        # Run 3 showed bare /journal/notebook lands on "Research home" (no gallery, no
        # Templates button); the notes view ("All notes") is where the gallery lives.
        pg.goto(f"{base}/journal/notebook?view=all", wait_until="domcontentloaded", timeout=60000)
        ph._dismiss_intro(pg)
        try:
            pg.get_by_role("button", name="Got it", exact=True).first.click(timeout=4000)
        except Exception:  # noqa: BLE001 -- the Compass hint did not show in this tab
            pass
        # Run 1 waited only for the INLINE gallery (the empty-notebook state) and timed out
        # with nothing on disk to say why. The gallery has two doors: inline on an empty
        # notebook, and the toolbar's "Templates" sheet. Use whichever this page offers,
        # say which, and keep a screenshot of what the page showed first.
        try:
            pg.wait_for_selector(".ProseMirror, [data-template-key], button:has-text('Templates')",
                                 state="visible", timeout=60000)
        finally:
            # Runs 1 and 2 stopped here with nothing on disk to say what the page showed.
            shot(pg, "notebook-landing-1200")
            rec["landing"] = {"url": pg.url, "text": pg.locator("body").inner_text()[:1500]}
        door = "inline (empty notebook)"
        if pg.locator("[data-template-key]").count() == 0:
            door = "toolbar Templates sheet"
            pg.get_by_role("button", name="Templates", exact=True).filter(visible=True).first.click()
        rec["gallery_door"] = door
        pg.wait_for_selector("[data-template-key]", state="visible", timeout=45000)
        cards = pg.eval_on_selector_all(
            "[data-template-key]",
            "els => els.map(e => ({key: e.getAttribute('data-template-key'),"
            " preview: (e.querySelector('[data-template-preview]')?.textContent || '')}))")
        # Run 4 read 64 cards for 32 templates (the gallery is in the DOM twice); the
        # walk covers each template once, in page order.
        keys = list(dict.fromkeys(c["key"] for c in cards))
        rec["gallery_card_count"] = len(cards)
        rec["gallery_keys"] = keys
        row("the gallery renders the catalog (keys read from the page)", "PASS" if len(keys) >= 30 else "FAIL",
            saw=len(keys))
        leaks = [c["key"] for c in cards if WALKTHROUGH_TITLE in c["preview"]]
        no_preview = [c["key"] for c in cards if not c["preview"].strip()]
        row("no gallery card previews the walkthrough", "PASS" if not leaks else "FAIL", saw=leaks or None)
        row("every gallery card previews its own lines", "PASS" if not no_preview else "FAIL", saw=no_preview or None)
        missing_phone = [k for k in PHONE_KEYS if k not in keys]
        row("every wave-12 new or deepened template is in the gallery", "PASS" if not missing_phone else "FAIL",
            saw=missing_phone or None)
        shot(pg, "gallery-1200")
        # The full Preview dialog (lane 12A's file, rendered leniently): recorded, not judged.
        try:
            pg.get_by_role("button", name="Preview Base Breakout Plan").filter(visible=True).first.click()
            dlg = pg.get_by_role("dialog", name="Base Breakout Plan")
            dlg.wait_for(state="visible", timeout=10000)
            txt = dlg.inner_text()
            rec["preview_dialog_breakout"] = {"has_walkthrough_title": WALKTHROUGH_TITLE in txt, "chars": len(txt)}
            shot(pg, "preview-dialog-breakout")
            pg.keyboard.press("Escape")
            dlg.wait_for(state="hidden", timeout=10000)
        except Exception as e:  # noqa: BLE001 -- informational only
            rec["preview_dialog_breakout"] = {"error": f"{type(e).__name__}: {str(e)[:200]}"}
            shot(pg, "preview-dialog-error")
        pg.close()

        # ── N: create a note from each template, open the walkthrough by keyboard ──
        def walk_one(ctx, label, key, probe_enter=False):
            pg = page_for(ctx, label)
            note = {"viewport": label, "key": key, "probe_enter": probe_enter}
            rec["notes"].append(note)
            t0 = time.time()
            pg.goto(f"{base}/journal/notebook?new={key}", wait_until="domcontentloaded", timeout=60000)
            ph._dismiss_intro(pg)
            pg.wait_for_url(re.compile(r"[?&]note="), timeout=45000)
            note_id = re.search(r"[?&]note=([^&#]+)", pg.url).group(1)
            note["note_id"] = note_id
            pg.wait_for_selector(".ProseMirror", state="visible", timeout=45000)
            toggles = pg.locator('.ProseMirror [data-type="toggle"]')
            toggles.last.wait_for(state="attached", timeout=20000)
            note["open_ms"] = round((time.time() - t0) * 1000)
            body = req.get(f"{base}/api/j2/notes/{note_id}").json()["note"]["bodyJson"]
            stored = _count(body, {"table", "toggle", "callout"})
            dom = {
                "table": pg.locator(".ProseMirror table").count(),
                "toggle": toggles.count(),
                "callout": pg.locator('.ProseMirror [data-type="callout"]').count(),
            }
            note["stored_counts"], note["dom_counts"] = stored, dom
            text = pg.locator("body").inner_text()
            refused = [r for r in REFUSALS if r in text]
            editable = pg.locator(".ProseMirror").first.get_attribute("contenteditable")
            last = (body.get("content") or [{}])[-1]
            ends_in_walkthrough = (last.get("type") == "toggle" and _text((last.get("content") or [{}])[0]) == WALKTHROUGH_TITLE)
            collapsed = (last.get("attrs") or {}).get("open") is False
            ok_open = not refused and editable == "true" and stored == dom
            row(f"[{label}] {key}: the editor opens it (editable, no refusal, every table/toggle/callout built)",
                "PASS" if ok_open else "FAIL", saw={"refused": refused, "editable": editable, "stored": stored, "dom": dom})
            row(f"[{label}] {key}: the stored body ends in the collapsed walkthrough",
                "PASS" if ends_in_walkthrough and collapsed else "FAIL",
                saw={"last_type": last.get("type"), "open": (last.get("attrs") or {}).get("open")})

            chev = toggles.last.locator("button.uctToggleChevron")
            note["aria_expanded_before"] = chev.get_attribute("aria-expanded")
            trail, reached = [], False
            for _ in range(MAX_TABS):
                pg.keyboard.press("Tab")
                info = pg.evaluate(ACTIVE_JS)
                trail.append(info)
                if info["isWalkthroughChevron"]:
                    reached = True
                    break
            note["tab_trail"] = trail
            # Run 4 pressed Enter first: Enter on the chevron did NOT open the toggle and
            # changed the document instead (the stored body no longer ended in the
            # walkthrough). Space is the button's activation key, so it is the path walked
            # here; Enter is probed separately (ENTER_PROBE_KEYS) and recorded as a finding.
            key_name = "Enter" if probe_enter else "Space"
            how = f"keyboard: Tab x{len(trail)} then {key_name}" if reached else None
            if not reached:
                chev.focus()
                how = f"fallback: programmatic focus, then {key_name}"
            body_before = req.get(f"{base}/api/j2/notes/{note_id}").json()["note"]["bodyJson"]
            pg.keyboard.press("Enter" if key_name == "Enter" else " ")
            try:
                pg.wait_for_function(OPEN_JS, timeout=5000)
                opened_by = key_name
            except Exception:  # noqa: BLE001
                opened_by = None
            if key_name == "Enter":
                pg.wait_for_timeout(2500)
                b_after = req.get(f"{base}/api/j2/notes/{note_id}").json()["note"]["bodyJson"]
                note["enter_probe"] = {
                    "opened": opened_by == "Enter",
                    "top_types_before": [n.get("type") for n in body_before.get("content") or []][-4:],
                    "top_types_after": [n.get("type") for n in b_after.get("content") or []][-4:],
                    "body_changed": b_after != body_before,
                }
                row(f"[{label}] {key}: FINDING PROBE -- Enter on the chevron opens the toggle and leaves the body alone",
                    "PASS" if opened_by == "Enter" and b_after == body_before else "FAIL", saw=note["enter_probe"])
                pg.close()
                return
            note["how"], note["opened_by"] = how, opened_by
            try:   # toggle > toggleContent > orderedList > first listItem
                step1 = _text(last["content"][1]["content"][0]["content"][0])
            except (KeyError, IndexError, TypeError):
                step1 = ""
            note["first_step"] = step1
            step_visible = False
            if opened_by and step1:
                step_visible = toggles.last.get_by_text(step1, exact=True).first.is_visible()
            row(f"[{label}] {key}: Tab reaches the walkthrough's chevron", "PASS" if reached else "FAIL",
                saw={"tabs": len(trail), "last_focus": trail[-1] if trail else None})
            row(f"[{label}] {key}: the walkthrough opens by keyboard and shows its first step",
                "PASS" if opened_by and step_visible else "FAIL",
                saw={"how": how, "opened_by": opened_by, "first_step_visible": step_visible})
            # the open state is a real editor transaction: it lands in the stored body
            stored_open = None
            for _ in range(20):
                pg.wait_for_timeout(500)
                b2 = req.get(f"{base}/api/j2/notes/{note_id}").json()["note"]["bodyJson"]
                wt = [n for n in b2.get("content") or []
                      if n.get("type") == "toggle" and _text((n.get("content") or [{}])[0]) == WALKTHROUGH_TITLE]
                stored_open = (wt[-1].get("attrs") or {}).get("open") if wt else None
                if stored_open is True:
                    break
            note["body_unchanged_but_open"] = (
                [n.get("type") for n in b2.get("content") or []] == [n.get("type") for n in body.get("content") or []])
            note["stored_open_after"] = stored_open
            if opened_by:
                row(f"[{label}] {key}: opening it is saved like any other edit", "PASS" if stored_open is True else "FAIL",
                    saw=stored_open)
            if key in ("breakout-plan", "earnings-prep", "trade-review", "sector-note") or label == "390":
                shot(pg, f"{label}-{key}")
            pg.close()

        def guarded_walk(ctx, label, key, probe_enter=False):
            # One template's failure is a row, never the end of the walk.
            try:
                walk_one(ctx, label, key, probe_enter)
            except Exception as e:  # noqa: BLE001 -- recorded with a screenshot
                row(f"[{label}] {key}: walked to the end", "FAIL", why=f"{type(e).__name__}: {str(e)[:300]}")
                for p in ctx.pages:
                    try:
                        shot(p, f"{label}-{key}-error")
                        p.close()
                    except Exception:  # noqa: BLE001
                        pass

        for key in keys:
            guarded_walk(wide, "1200", key)
        for key in ENTER_PROBE_KEYS:
            guarded_walk(wide, "1200", key, probe_enter=True)
        phone = browser.new_context(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True,
                                    reduced_motion="reduce")
        ph._signup_or_login(phone.request, base, MEMBER[0], MEMBER[1], MEMBER[2])
        for key in PHONE_KEYS:
            guarded_walk(phone, "390", key)
        for key in ENTER_PROBE_KEYS:
            guarded_walk(phone, "390", key, probe_enter=True)
        errs = rec["page_errors"]
        row("no uncaught page error during the walk", "PASS" if not errs else "FAIL", saw=errs[:5] or None)
        browser.close()


if __name__ == "__main__":
    sys.exit(main())
