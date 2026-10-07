"""Wave 13 lane 13H-4 -- the bare /charts control the finish line asks for.

13H-4 wires a new `mobileDrawBar` opt-in into StockChart's annotationsEditable
branch (the Notebook chart-embed path) and separately fixes a width-squeeze bug
in MobileDrawBar itself (docs/notebook/wave13-13h4.md). Neither change touches
the showDrawingTools branch's own, PRE-EXISTING MobileDrawBar wiring (wave 8) --
that branch always passes real onUndo/onRedo handlers, so this lane's "only
render Undo/Redo when a handler exists" fix is a no-op there. This script is
the control that PROVES it: the bare /charts page at 390px touch, 3 taps on an
armed Horizontal-tool, 3 lines placed -- unchanged.

Reuses `tools/notebook_w13h3_diag_walk.py`'s `run_bare_charts` (already does
exactly this) and `tools/notebook_perf_harness.py`'s Sandbox, so no new
instrumentation is invented. R-RAW: raw output is committed before being read
for conclusions.

Run from PowerShell, this lane's ports only (8690-8694):

    python tools/notebook_w13h4_charts_control.py --data-dir 'C:\\data-w13h4-charts' `
        --port 8692 --out 'docs\\notebook\\evidence\\wave13-13h4\\charts-control'
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "tools"))
import notebook_perf_harness as h  # noqa: E402
from notebook_w13h2_walk import MEMBER  # noqa: E402
from notebook_w13h3_diag_walk import run_bare_charts  # noqa: E402
from secret_scrub import brief, scrub  # noqa: E402


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8692)
    ap.add_argument("--out", required=True)
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    if not 8690 <= args.port <= 8694:
        print("REFUSED: this lane's walk uses ports 8690-8694 only")
        return 3
    if h.port_busy(args.port):
        print(f"REFUSED: port {args.port} already has a listener -- this walk never kills it")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    w: dict = {}
    failure = not_run = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            try:
                from playwright.sync_api import sync_playwright
                served: list = []
                with sync_playwright() as pw:
                    br = pw.chromium.launch()
                    admin_ctx = br.new_context()
                    ctx = br.new_context(viewport={"width": 1200, "height": 900}, reduced_motion="reduce")
                    req = ctx.request
                    h._provision(admin_ctx.request, req, base, member=MEMBER)
                    state = ctx.storage_state()
                    run_bare_charts(br, state, base, w, 390, served)
                    br.close()
            except h.SetupFailed as e:
                not_run = scrub(str(e))[:300]
            except Exception as e:  # noqa: BLE001
                import traceback
                failure = f"the control raised {brief(e, 400)}"
                w["traceback"] = scrub(traceback.format_exc())[-4000:]
            box.wait_checkpoint(h.POST_BOOT, 60)
    finally:
        box.stop()
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=not_run))
    result = {"tool": "tools/notebook_w13h4_charts_control.py", "base": base, "integrity": integ,
              "failure": failure, "not_run": not_run, "raw": w}
    (out / "walk.json").write_text(json.dumps(result, indent=1, ensure_ascii=False, default=str), encoding="utf-8")
    if not_run:
        print(f"VERDICT: NOT RUN -- {not_run}")
        return 3
    if failure:
        print(f"VERDICT: FAIL -- {failure}")
        return 1
    taps = w.get("bare_V390_taps", [])
    placed = len(taps)
    stored = w.get("bare_V390_drawings_stored")
    if placed == 3 and stored == 3:
        print(f"VERDICT: PASS -- {placed} taps placed, {stored} horizontal drawings stored")
        return 0
    print(f"VERDICT: FAIL -- {placed} taps placed, {stored} horizontal drawings stored (wanted 3/3)")
    return 1


if __name__ == "__main__":
    sys.exit(main())
