"""Rollback rehearsal probe, lane R1c (2026-09-29): lane R1's probe plus the doors L4 and L5 move.

Everything R1's probe measures (`../rollback-rehearsal-2026-09-28/probe.py`: one door per landing,
the Notebook page's CSS doors, and the never-revert set -- three notes at levels 0/1/2 opened in the
served editor, typed into, read back) is measured unchanged, by importing that file. Added:

  * L4 #251 (D3P, the phone format disclosure): `button[data-format-toggle]` in the level-0 note's
    editor toolbar row. The attribute is a brand-new DOM node -- always mounted (hidden above 640px
    by CSS only, per `app/src/pages/journal-2-0/components/notebook/NoteEditorPage.jsx`'s own
    "the DOM is the same at every width" comment) -- so its PRESENCE is a clean door regardless of
    viewport. Tip: 1. Through L4: 0.
  * L5 #252 (symbol backlinks in one pass): NOT a door -- the endpoint's answer shape is unchanged
    by design (a query optimisation only; `api/services/journal_two/notes.py`'s diff keeps every
    field name). Verified instead as BEHAVIOUR-PRESERVING: a note carrying a `$RECALL` cashtag
    embed is read back through `GET /api/j2/notes/symbol-backlinks?symbol=...` at the tip (L5
    present) and after L4's revert (L5 also reverted, since `--through L4` implies `--through L5`
    first); the two answers must have the identical shape and the identical `count`.

    python probe.py --base http://127.0.0.1:8238 --integrity-log <log> --out <dir> \
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
R1 = HERE.parents[1] / "rollback-rehearsal-2026-09-28" / "probe.py"
RECALL = "R1CBACKLINK"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r1 = _load("r1_probe", R1)


def l4_door(ctx, base, perf, nid, out_dir):
    """`button[data-format-toggle]` -- present at the tip and through L5, gone through L4."""
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)[:300]))
    res = {}
    try:
        page.goto(base + f"/journal/notebook?note={nid}", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        try:
            page.wait_for_selector(".ProseMirror", timeout=30000)
            res["editor_mounted"] = True
        except Exception:  # noqa: BLE001
            res["editor_mounted"] = False
        page.wait_for_timeout(2000)
        res["format_toggle_buttons"] = page.locator("button[data-format-toggle]").count()
        page.screenshot(path=str(out_dir / "editor-toolbar.png"))
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
    res["page_errors"] = errors
    page.close()
    return res


def l5_backlinks(member, base, nid):
    """L5 is not a door -- verify the answer SHAPE is unchanged, not that it disappears.
    Route: GET /api/j2/notes/backlinks?symbol=... (api/routers/journal_two.py,
    note_backlinks_endpoint -> notes_service.get_symbol_backlinks, the function L5 optimised)."""
    r = member.get(base + f"/api/j2/notes/backlinks?symbol={RECALL}")
    body = r1._json(r)
    out = {"status": r.status, "keys": sorted(body) if isinstance(body, dict) else None}
    if isinstance(body, dict):
        out["count"] = body.get("count")
        out["notes_len"] = len(body.get("notes") or []) if isinstance(body.get("notes"), list) else None
        notes = body.get("notes") or []
        out["note_keys"] = sorted(notes[0]) if notes and isinstance(notes[0], dict) else None
    return out


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
            # A fourth fixture, R1c's own: a note carrying a $RECALL cashtag embed, for the L5
            # symbol-backlinks shape check.
            backlink_body = r1._doc(r1._p(f"note about ${RECALL} and its setup"))
            rb = member.post(base + "/api/j2/notes", data={"title": "r1c backlink source",
                                                            "bodyJson": backlink_body})
            fx["nb"] = r1._note_of(r1._json(rb)).get("id") if rb.status in (200, 201) else None
            res["seed_nb_status"] = rb.status
            fx_path.write_text(json.dumps(fx, indent=2), encoding="utf-8")
        fx = json.loads(fx_path.read_text(encoding="utf-8"))
        res["fixtures"] = fx
        res["landings"] = r1.landing_probes(member, admin, base, fx)
        res["L4_format_toggle"] = l4_door(ctx, base, perf, fx["n0"], out)
        res["L5_symbol_backlinks"] = l5_backlinks(member, base, fx.get("nb"))
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
