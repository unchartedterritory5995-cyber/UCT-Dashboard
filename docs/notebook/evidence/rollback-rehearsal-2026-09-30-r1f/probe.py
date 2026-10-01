"""Rollback rehearsal probe, lane R1f (2026-09-30): lane R1e's probe plus the door L13 moves.

Everything R1e's probe measures (`../rollback-rehearsal-2026-09-30-r1e/probe.py`: the never-revert
set, every earlier landing's door including L7's Find-in-note floor, L12's sort door and L10's
template-gallery door) is measured unchanged, by importing that file. Added:

  * L13 #259 (G-062 analyst-consensus capture, smoke + master-red fixes, rollback chain through
    L12): the fact-capture door -- `POST /api/j2/notes/{id}/facts` with
    `factType=analyst_price_target_consensus` (the SlashMenu `/consensus` and TickerPopup "Save
    analyst consensus to Notebook" doors both call this same router, api/routers/journal_two.py ->
    api/services/journal_two/note_facts.py, with an explicit `value` -- the walk's own G1 shape,
    tools/notebook_g62_consensus_walk.py). At the tip `analyst_price_target_consensus` is
    `active=True` in `fact_registry.FACT_TYPES` (the owner's 2026-09-25 FMP approval, G-062): the
    call returns 200 with `rightsClass=conditional`, `temporalMode=snapshot`, `source=fmp`.
    Reverted (through `L13`, i.e. at L12's own tip and below), the type is not yet registered as
    active and the router's own activation gate (note_facts.create_fact_observation) refuses it
    with 400 -- the same shape `test_creating_an_inactive_fact_type_400s_at_the_router` pins
    server-side, read here from the live HTTP door instead of the source.

    python probe.py --base http://127.0.0.1:8167 --integrity-log <log> --out <dir> \
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
R1E = HERE.parents[1] / "rollback-rehearsal-2026-09-30-r1e" / "probe.py"


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


r1e = _load("r1e_probe", R1E)
r1d = r1e.r1d
r1c = r1d.r1c
r1 = r1e.r1


def l13_analyst_consensus_capture(member, base):
    """`POST /api/j2/notes/{id}/facts` with `factType=analyst_price_target_consensus`, an
    explicit value (the walk's G1 shape, bypassing only the FMP HTTP fetch): 200 with
    rightsClass=conditional/temporalMode=snapshot/source=fmp at the tip; 400 (the pre-G-062
    inactive-type refusal) once L13 is reverted."""
    res = {}
    try:
        rn = member.post(base + "/api/j2/notes", data={"title": "r1f G-062 consensus door"})
        res["create_note_status"] = rn.status
        note = r1._note_of(r1._json(rn)) if rn.status in (200, 201) else {}
        nid = note.get("id")
        res["note_id"] = nid
        rf = member.post(base + f"/api/j2/notes/{nid}/facts", data={
            "ticker": "NVDA", "factType": "analyst_price_target_consensus", "value": 195.0,
        })
        res["status"] = rf.status
        j = r1._json(rf)
        fact = (j or {}).get("fact") if isinstance(j, dict) else None
        res["fact"] = fact
        res["active_at_this_step"] = rf.status == 200
        if rf.status == 200 and isinstance(fact, dict):
            res["rights_class_ok"] = fact.get("rightsClass") == "conditional"
            res["temporal_mode_ok"] = fact.get("temporalMode") == "snapshot"
            res["source_ok"] = fact.get("source") == "fmp"
        if nid:
            r1._trash(member, base, nid)
    except Exception as e:  # noqa: BLE001
        res["error"] = f"{type(e).__name__}: {e}"[:300]
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
        res["L13_analyst_consensus_capture"] = l13_analyst_consensus_capture(member, base)
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
