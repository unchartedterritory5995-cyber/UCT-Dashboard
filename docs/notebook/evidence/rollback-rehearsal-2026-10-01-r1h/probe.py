"""Rollback rehearsal probe, lane R1h (2026-10-01): lane R1g's probe plus the three doors L15
moves that can be checked behaviourally in a real browser against the real served bundle (R1g's
own pattern -- never a grep of a built JS file's text for a BEHAVIOURAL claim), and one door
(the PNG export size guard) checked differently -- see its own function's docstring for why.

Everything R1g's probe measures (`../rollback-rehearsal-2026-10-01-r1g/probe.py`, itself a chain
back through R1f/R1e/R1d/R1c/R1: the never-revert set, every earlier landing's door including
L7's Find-in-note floor, L12's sort door, L10's template door, L13's analyst-consensus-capture
door and L14's two doors) is measured unchanged, by importing that file. Added:

  * A2R-03: `/journal/notebook?view=graph` renders the graph view (`canvas[role="application"]`,
    NoteGraphView.jsx:670) at the tip; reverted, every VIEW_MODES id except `all`/`tasks` fell
    through to `isHome`, so the SAME url rendered Research Home (`<h2>Research home</h2>`,
    NotebookTab.jsx paneHeading) instead -- checked in a real browser against the real served
    bundle, exactly R1g's intro-skip pattern.

  * A2R-04: `useHotkeys` matches a hotkey string against `event.code` (the physical key), not
    `event.key`; `'shift+/'` parses to the literal token `/`, which a real Shift+/ keydown's
    `code:"Slash"` never equals, so the chord was UNREACHABLE from any real keyboard.
    `'shift+slash'` names the physical key the matcher expects. Checked by having Playwright
    synthesize a real `Shift+/` chord (which carries `code:"Slash", key:"?"`, exactly a US
    keyboard's own event) and observing whether the Keyboard Shortcuts dialog
    (`div[role="dialog"]` titled "Keyboard Shortcuts") opens -- a real keystroke against the real
    served bundle, never a grep of the registered string.

  * A2R-05: TickerPopup's trigger used to render `<Tag role="button">` with no `tabIndex` and no
    key handler -- reachable by mouse only on 26 of 37 call sites (every one that does not pass
    `as="button"`). FuturesStrip's index-grid cells (`TickerPopup.jsx:154`, `as="div"`) are one
    such site, mounted unconditionally on `/dashboard` with no live-market-data dependency (the
    symbol grid itself is static; only the price/sparkline numbers are live). Checked in a real
    browser: the tile's `tabindex` DOM attribute, and whether a synthesized Enter actually opens
    the chart dialog (`div[role="dialog"]`) -- not just the attribute's presence.

  * The PNG export size guard (`pickSafeScale`/`HARD_MAX_CANVAS_DIM_PX`/`TOO_LONG_FOR_PNG_MESSAGE`
    in `exportNote.js`) is checked differently -- see `dist/png_guard_dist_check.py` in this same
    evidence directory, run once per extracted tree right after `prepare()`, against the BUILT
    `app/dist/assets/*.js` output (never served over a live canvas-allocation click). Reverting
    L15 removes the guard ENTIRELY (the squash's very first sub-commit is what introduces it), so
    the pre-L15 `exportNoteAsPng` has no size check at all and calls the rasterizer directly --
    on a note tall enough to trip the NEW guard (the fixture this probe seeds for the graph/
    editor doors is not that tall), the OLD code attempts a real, unguarded, multi-hundred-
    megapixel canvas allocation in the browser, which is precisely the failure this landing
    fixes and is deliberately NOT reproduced three times against this box's own memory budget
    (CLAUDE.md's repeated OOM history). A text match against the bytes the build actually
    produced is the stated, narrower claim for this one door; the three doors above are each
    exercised behaviourally end to end.

    python probe.py --base http://127.0.0.1:<port> --integrity-log <log> --out <dir> \
        --mode seed|check --fixtures <fixtures.json> --label <step>
Prints one JSON object and writes <out>/probe.json. Exit 0 always: the caller compares steps.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
REPO = HERE.parents[4]
R1G = HERE.parents[1] / "rollback-rehearsal-2026-10-01-r1g" / "probe.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r1g = _load("r1g_probe", R1G)
r1f = r1g.r1f
r1e = r1g.r1e
r1d = r1g.r1d
r1c = r1g.r1c
r1 = r1g.r1


def a2r03_view_graph_not_home(ctx, base, perf):
    """`/journal/notebook?view=graph`: the graph canvas at the tip, Research Home reverted."""
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    res = {}
    try:
        page.goto(base + "/journal/notebook?view=graph", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        page.wait_for_timeout(2500)
        res["graph_canvas_count"] = page.locator('canvas[role="application"]').count()
        res["research_home_heading_count"] = page.locator('h2:has-text("Research home")').count()
        res["graph_view_active"] = bool(res["graph_canvas_count"] > 0 and res["research_home_heading_count"] == 0)
        res["research_home_shown"] = bool(res["research_home_heading_count"] > 0)
        res["page_errors"] = errors
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        page.close()
    return res


def a2r04_shift_slash_opens_shortcuts(ctx, base, perf):
    """A real Shift+/ chord (code:"Slash") opens Keyboard Shortcuts at the tip, opens nothing
    reverted -- the same dialog's `?`-button click path is untouched either way, so this is
    about the keyboard chord alone."""
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    res = {}
    try:
        page.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        page.wait_for_timeout(1500)
        page.evaluate("document.activeElement && document.activeElement.blur && document.activeElement.blur()")
        page.keyboard.press("Shift+/")
        page.wait_for_timeout(600)
        dlg = page.locator('div[role="dialog"]').filter(has_text="Keyboard Shortcuts")
        res["dialog_opened"] = dlg.count() > 0
        if res["dialog_opened"]:
            close_btn = dlg.first.locator('button[aria-label="Close"]')
            if close_btn.count() > 0:
                close_btn.first.click()
        res["page_errors"] = errors
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        page.close()
    return res


def a2r05_tickerpopup_trigger_keyboard(ctx, base, perf):
    """FuturesStrip's IWM tile (`as="div"`, a static symbol -- no live-data dependency): tabIndex
    0 and Enter opens the chart dialog at the tip; tabIndex absent and Enter opens nothing
    reverted."""
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    res = {}
    try:
        page.goto(base + "/dashboard", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        page.wait_for_timeout(2500)
        sym_label = page.get_by_text("IWM", exact=True)
        res["sym_label_count"] = sym_label.count()
        if res["sym_label_count"] > 0:
            trigger = sym_label.first.locator("xpath=ancestor::*[@role='button'][1]")
            res["trigger_count"] = trigger.count()
            if res["trigger_count"] > 0:
                res["tabindex"] = trigger.first.get_attribute("tabindex")
                res["tabindex_is_0"] = res["tabindex"] == "0"
                trigger.first.focus()
                page.keyboard.press("Enter")
                page.wait_for_timeout(700)
                res["dialog_opened"] = page.locator('div[role="dialog"]').count() > 0
                if res["dialog_opened"]:
                    page.keyboard.press("Escape")
        res["page_errors"] = errors
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    finally:
        page.close()
    return res


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--base", required=True)
    ap.add_argument("--integrity-log", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", choices=("seed", "check"), required=True)
    ap.add_argument("--fixtures", required=True)
    ap.add_argument("--label", required=True)
    a = ap.parse_args()
    base = a.base.rstrip("/")
    out = Path(a.out)
    out.mkdir(parents=True, exist_ok=True)
    sid = _load("sid", REPO / "scripts" / "sandbox_identity.py")
    ver = sid.verify(base, a.integrity_log)
    res: dict = {"label": a.label, "mode": a.mode, "identity": ver.sentence, "proven": ver.ok}
    if not ver.ok:
        print(json.dumps(res, indent=2))
        (out / "probe.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
        return 0
    perf = _load("perf", REPO / "tools" / "notebook_perf_harness.py")
    from playwright.sync_api import sync_playwright
    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        admin = pw.request.new_context()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        perf._provision(admin, ctx.request, base, member=r1.MEMBER)
        member = ctx.request
        fx_path = Path(a.fixtures)
        if a.mode == "seed":
            fx = {}
            for key, (title, body) in r1.FIXTURE_BODIES.items():
                r = member.post(base + "/api/j2/notes", data={"title": title, "bodyJson": body})
                fx[key] = r1._note_of(r1._json(r)).get("id") if r.status in (200, 201) else None
                res[f"seed_{key}_status"] = r.status
            fx_path.write_text(json.dumps(fx, indent=2), encoding="utf-8")
        fx = json.loads(fx_path.read_text(encoding="utf-8"))
        res["fixtures"] = fx
        res["landings"] = r1.landing_probes(member, admin, base, fx)
        res["L7_find_input_floor"] = r1d.l7_find_input_floor(ctx, base, perf, fx["n0"], out)
        res["L12_sort_updated_asc"] = r1e.l12_sort_updated_asc(member, base)
        res["L10_template_gallery"] = r1e.l10_template_gallery_count(ctx, base, perf, out)
        res["L13_analyst_consensus_capture"] = r1f.l13_analyst_consensus_capture(member, base)
        res["L14_locked_append_doors"] = r1g.l14_locked_append_doors(member, base)
        res["L14_intro_skip_public_routes"] = r1g.l14_intro_skip_public_routes(browser, base)
        res["A2R03_view_graph_not_home"] = a2r03_view_graph_not_home(ctx, base, perf)
        res["A2R04_shift_slash_opens_shortcuts"] = a2r04_shift_slash_opens_shortcuts(ctx, base, perf)
        res["A2R05_tickerpopup_trigger_keyboard"] = a2r05_tickerpopup_trigger_keyboard(ctx, base, perf)
        res["dom"] = r1.dom_probes(ctx, base, perf, out)
        res["editor"] = {k: r1.editor_probe(ctx, member, base, perf, k, fx[k], a.label, out)
                         for k in ("n2", "n1", "n0") if fx.get(k)}
        ctx.close()
        admin.dispose()
        browser.close()
    print(json.dumps(res, indent=2))
    (out / "probe.json").write_text(json.dumps(res, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
