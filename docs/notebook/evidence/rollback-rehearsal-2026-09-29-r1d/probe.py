"""Rollback rehearsal probe, lane R1d (2026-09-29): lane R1c's probe plus the doors L6 and L7
move.

Everything R1c's probe measures (`../rollback-rehearsal-2026-09-29-r1c/probe.py`: the never-revert
set, the per-landing doors, L4's door and L5's behaviour-preservation check) is measured unchanged,
by importing that file. Added:

  * L6 #253 (archive restores replay deletions, rollback chain covers L4/L5, walk + writing-help
    evidence): NOT a door -- it ships zero `app/` or `api/` files (confirmed by diff-stat: every
    changed path is under `docs/`, `tests/` or `tools/`). Verified instead as a pure
    NON-REGRESSION: the shared checks this probe already runs at every step -- the never-revert
    set (three fixture notes at schema levels 0/1/2) and every earlier landing's door -- must
    still answer identically through `L6` as at the tip. There is no product surface for L6 to
    remove, so there is nothing narrower to check.
  * L7 #254 (three tap floors, clause 6c): a CSS door -- the Find-in-note input
    (`NoteFindBar.jsx`, `input[aria-label="Find in note"]`, opened via the toolbar's
    `button[aria-label="Find in note"]`) gains `min-height: var(--tap-min, 44px)` at the
    touch tier (`@media (max-width: 1024px)`). Measured at 820px viewport width (the same width
    the fix's own commit message measured, "195x18 at 820"): its rendered height must be
    >= 44px at the tip and through `L6` is present too (it also lands through `L6`'s tree, since
    that tree -- s-L6 -- has L7 already reverted, so read it as: present at `s00-tip`, present
    at `s-L7` is WRONG -- s-L7 is the tree with L7 itself reverted, i.e. gone; the door is
    present ONLY at the tip and absent at both `s-L7` and `s-L6`).

    python probe.py --base http://127.0.0.1:8239 --integrity-log <log> --out <dir> \
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
R1C = HERE.parents[1] / "rollback-rehearsal-2026-09-29-r1c" / "probe.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r1c = _load("r1c_probe", R1C)
r1 = r1c.r1


def l7_find_input_floor(ctx, base, perf, nid, out_dir):
    """`input[aria-label="Find in note"]` -- <44px tall at 820px width at the tip and through
    `L7` reverted (i.e. at s-L7 and s-L6), >=44px only at the tip (before L7 is reverted)."""
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    res = {}
    try:
        page.set_viewport_size({"width": 820, "height": 900})
        page.goto(base + f"/journal/notebook?note={nid}", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        try:
            page.wait_for_selector(".ProseMirror", timeout=30000)
            res["editor_mounted"] = True
        except Exception:  # noqa: BLE001
            res["editor_mounted"] = False
        find_btn = page.locator('button[aria-label="Find in note"]')
        res["find_button_count"] = find_btn.count()
        if res["find_button_count"] > 0:
            find_btn.first.click()
            page.wait_for_timeout(500)
            find_input = page.locator('input[aria-label="Find in note"]')
            res["find_input_count"] = find_input.count()
            if res["find_input_count"] > 0:
                box = find_input.first.bounding_box()
                res["find_input_height_px"] = box["height"] if box else None
        page.screenshot(path=str(out_dir / "find-bar.png"))
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    res["page_errors"] = errors
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
            # R1c's own fourth fixture, for the L5 symbol-backlinks shape check (kept unchanged;
            # this lane does not re-verify L5, already covered by R1c's own rehearsal).
            backlink_body = r1._doc(r1._p(f"note about ${r1c.RECALL} and its setup"))
            rb = member.post(base + "/api/j2/notes", data={"title": "r1c backlink source",
                                                            "bodyJson": backlink_body})
            fx["nb"] = r1._note_of(r1._json(rb)).get("id") if rb.status in (200, 201) else None
            res["seed_nb_status"] = rb.status
            fx_path.write_text(json.dumps(fx, indent=2), encoding="utf-8")
        fx = json.loads(fx_path.read_text(encoding="utf-8"))
        res["fixtures"] = fx
        res["landings"] = r1.landing_probes(member, admin, base, fx)
        res["L7_find_input_floor"] = l7_find_input_floor(ctx, base, perf, fx["n0"], out)
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
