"""Rollback rehearsal probe, lane R1b (2026-09-29): lane R1's probe plus the doors R1b's steps move.

Everything R1's probe measures (`../rollback-rehearsal-2026-09-28/probe.py`: one door per landing,
the Notebook page's CSS doors, and the never-revert set -- three notes at levels 0/1/2 opened in the
served editor, typed into, read back) is measured unchanged, by importing that file. Added:

  * L2 #242 (frontend only): the editor header's "More note actions" button (NoteMoreMenu, D-3),
    counted on the level-0 note's editor page. Tip: 1. Through L2: 0.
  * the new L1a rule: `POST /api/j2/notes/{id}/writing-help/autofill` with a body that is not a JSON
    object. A mounted route answers 422 with its sentence; through L1a the route is gone.
  * the new wave-7 rules: the same probe on `.../writing-help/stream` (wave 7's door, deleted
    through wave 7), and the kept newer work that imports daily_counters.py: TERM-078's
    `GET /api/ai-search/meters` must answer JSON at EVERY step (it would not if the server could
    not import, or if the store were gone).

    python probe.py --base http://127.0.0.1:8231 --integrity-log <log> --out <dir> \
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
MORE = "More note actions"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r1 = _load("r1_probe", R1)


def post_door(req, base, path):
    """A POST door, sent a JSON LIST (not an object): no model call can follow. Mounted -> the
    route's own 422 sentence; gone -> whatever the app answers an unknown POST with."""
    r = req.post(base + path, data="[1]", headers={"content-type": "application/json"})
    ctype = (r.headers.get("content-type") or "").split(";")[0]
    body = r1._json(r)
    detail = body.get("detail") if isinstance(body, dict) else None
    return {"status": r.status, "content_type": ctype,
            "detail": detail if isinstance(detail, str) else (str(detail)[:120] if detail else None)}


def r1b_doors(member, base, fx):
    out = {}
    nid = fx["n0"]
    out["L1a_writing_help_autofill"] = post_door(member, base, f"/api/j2/notes/{nid}/writing-help/autofill")
    out["w7_writing_help_stream"] = post_door(member, base, f"/api/j2/notes/{nid}/writing-help/stream")
    r = member.get(base + "/api/ai-search/meters")
    ctype = (r.headers.get("content-type") or "").split(";")[0]
    body = r1._json(r)
    out["kept_TERM078_ai_meters"] = {"status": r.status, "json": body is not None and ctype == "application/json",
                                     "keys": sorted(body)[:6] if isinstance(body, dict) else None}
    return out


def l2_door(ctx, base, perf, nid, out_dir):
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
        res["more_note_actions_buttons"] = page.locator(f'button[aria-label="{MORE}"]').count()
        page.screenshot(path=str(out_dir / "editor-header.png"))
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
        res["r1b_doors"] = r1b_doors(member, base, fx)
        res["L2_editor_header"] = l2_door(ctx, base, perf, fx["n0"], out)
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
