"""Rollback rehearsal probe, lane R1e (2026-09-30): lane R1d's probe plus the doors L12 and L10
move.

Everything R1d's probe measures (`../rollback-rehearsal-2026-09-29-r1d/probe.py`: the never-revert
set, every earlier landing's door, and L7's Find-in-note touch-tier floor) is measured unchanged, by
importing that file. Added:

  * L9 #256 (rollback-chain tool coverage for L6/L7/L8): NOT a door -- it ships zero `app/` or
    `api/` files (confirmed by diff-stat: every changed path is under `tests/`). Verified instead
    as a pure NON-REGRESSION via the shared checks this probe already runs at every step (the
    never-revert set and every earlier landing's door), same treatment R1d gave L6 and L8.
  * L12 #258 (silent failures, sort, typing, quote-in-list, proof walks, scorecard 40/61): the
    sort-order door -- `GET /api/j2/notes?sort=updated_asc` is accepted and actually reverses
    the list (two notes created seconds apart; the OLDER one must come first). Before L12,
    `sort=updated_asc` is an unrecognized key and silently falls back to `updated_at DESC`
    (api/services/journal_two/notes.py's `.get(sort, ...)` default), so the NEWER note comes
    first instead -- the same member-visible difference the commit's own rail
    (tests/test_journal_two_notes_sort_directions.py) asserts server-side, read here from the
    live HTTP door instead of the source.
  * L10 #257 (template gallery, 9 -> 25 built-ins, design-review close-out): the template-gallery
    door -- the Notebook's "Templates" button opens a Sheet listing `[data-template-card]`
    entries; L10 grows the built-in catalog from 9 to 25 (`notebookTemplates.js`'s own `TEMPLATES`
    array, grep-counted at the tip). A fresh account has zero member templates, so the rendered
    card count equals the built-in count directly.

    python probe.py --base http://127.0.0.1:8241 --integrity-log <log> --out <dir> \
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
R1D = HERE.parents[1] / "rollback-rehearsal-2026-09-29-r1d" / "probe.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r1d = _load("r1d_probe", R1D)
r1c = r1d.r1c
r1 = r1d.r1


def l12_sort_updated_asc(member, base):
    """`sort=updated_asc` on `GET /api/j2/notes`: at the tip the OLDER of two notes created
    seconds apart comes first; reverted, an unrecognized `sort` falls back to `updated_at DESC`
    and the NEWER one comes first instead."""
    res = {}
    try:
        ra = member.post(base + "/api/j2/notes", data={"title": "r1e sort door A (older)"})
        na = r1._note_of(r1d.r1c.r1._json(ra)).get("id") if ra.status in (200, 201) else None
        res["create_a_status"] = ra.status
        import time
        time.sleep(1.2)          # distinct second-resolution updated_at timestamps
        rb = member.post(base + "/api/j2/notes", data={"title": "r1e sort door B (newer)"})
        nb = r1._note_of(r1d.r1c.r1._json(rb)).get("id") if rb.status in (200, 201) else None
        res["create_b_status"] = rb.status
        g = member.get(base + "/api/j2/notes?sort=updated_asc&limit=5")
        res["status"] = g.status
        j = r1._json(g)
        rows = (j or {}).get("notes") if isinstance(j, dict) else None
        ids = [r.get("id") for r in (rows or []) if isinstance(r, dict)]
        res["first_five_ids_newest_created_last_expected"] = ids
        idx_a = ids.index(na) if na in ids else None
        idx_b = ids.index(nb) if nb in ids else None
        res["idx_a_older"] = idx_a
        res["idx_b_newer"] = idx_b
        res["older_comes_first"] = (idx_a is not None and idx_b is not None and idx_a < idx_b)
        r1d.r1c.r1._trash(member, base, na)
        r1d.r1c.r1._trash(member, base, nb)
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    return res


def l10_template_gallery_count(ctx, base, perf, out_dir):
    """The "Templates" button opens a Sheet; count `[data-template-card]` cards rendered. A fresh
    account has zero member templates, so this is the built-in count directly.

    L10 also ships a "CONTINUE WORKING" Research Home landing (ResearchHome.jsx) that the bare
    `/journal/notebook` route lands on when the account has any notes at all -- the Templates
    button lives one click further in, behind the "All notes" (or equivalent list) entry. Before
    L10 that extra screen does not exist and the list view (with the Templates button) is the
    landing itself, so this first tries the Home screen's way in and falls back to being already
    there."""
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    res = {}
    try:
        page.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        page.wait_for_timeout(2500)
        btn = page.locator('button:has-text("Templates")')
        res["templates_button_count_direct"] = btn.count()
        if res["templates_button_count_direct"] == 0:
            all_notes = page.locator('text="All notes"')
            res["all_notes_link_count"] = all_notes.count()
            if all_notes.count() > 0:
                all_notes.first.click()
                page.wait_for_timeout(1200)
                btn = page.locator('button:has-text("Templates")')
        res["templates_button_count"] = btn.count()
        if res["templates_button_count"] > 0:
            btn.first.click()
            page.wait_for_timeout(700)
            cards = page.locator('[data-template-card]')
            res["template_card_count"] = cards.count()
        page.screenshot(path=str(out_dir / "templates.png"))
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
            fx_path.write_text(json.dumps(fx, indent=2), encoding="utf-8")
        fx = json.loads(fx_path.read_text(encoding="utf-8"))
        res["fixtures"] = fx
        res["landings"] = r1.landing_probes(member, admin, base, fx)
        res["L7_find_input_floor"] = r1d.l7_find_input_floor(ctx, base, perf, fx["n0"], out)
        res["L12_sort_updated_asc"] = l12_sort_updated_asc(member, base)
        res["L10_template_gallery"] = l10_template_gallery_count(ctx, base, perf, out)
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
