"""Lane AX (wave 10) -- the Templates gallery's axe reading at 2fb102c74, by lane D2's OWN instruments.

Composition only; neither D2 file is changed:
  1. boot the census-pinned sandbox through the perf harness's `Sandbox` (as D2 did);
  2. provision D2's member through `H._provision` (as both D2 instruments do);
  3. seed D2's four notes with `d2_phone_measure.seed` -- the precondition D2's gallery run met
     because d2_phone_measure had run first on its data dir (attempt 1 without it: every viewport
     timed out waiting for a note card, INCONCLUSIVE, committed as gallery-axe-attempt1-unseeded/);
  4. run `d2_gallery_capture.run_viewport` at D2's three viewports (1200x800, 820x1180 touch,
     390x844 touch+mobile) -- axe-core from app/node_modules on the open dialog, the 40-Tab trap,
     arrows/Home/End, Escape.

ADDED (D2's capture has none): a CONTROL. At 1200x800, with the gallery open, a nameless <button>
is planted inside the dialog and axe is run on the dialog the same way; it must report
`button-name`, or every axe row here is labelled CONTROL-FAILED. The plant is removed after.

    python ax_gallery_axe.py --data-dir 'C:\\data-w10ax' --port 8235 --out <json> --art <dir> --tip <sha>
"""
from __future__ import annotations

import argparse
import json
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
D2 = HERE.parents[1] / "d2-instrument"
REPO = HERE.parents[4]
sys.path.insert(0, str(D2))
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

from tools import notebook_perf_harness as H  # noqa: E402
import d2_gallery_capture as G  # noqa: E402
import d2_phone_measure as P  # noqa: E402

assert G.MEMBER == P.MEMBER, "the two D2 instruments must share one member"

CONTROL_JS = """async () => {
  const dlg = Array.from(document.querySelectorAll('[role="dialog"]')).find(d => d.querySelector('[data-template-gallery]'));
  if (!dlg) return {error: 'no dialog'};
  const b = document.createElement('button'); b.setAttribute('data-ax-plant', '1'); dlg.appendChild(b);
  const r = await axe.run(dlg, {resultTypes: ['violations']});
  b.remove();
  return {ids: r.violations.map(v => v.id)};
}"""


def control(br, base, storage, art) -> dict:
    ctx = br.new_context(viewport={"width": 1200, "height": 800}, reduced_motion="reduce", storage_state=storage)
    ctx.add_init_script("try { localStorage.setItem('voice.orb.coachmarkSeen', '1'); } catch (e) {}")
    pg = ctx.new_page()
    out: dict = {}
    try:
        pg.goto(base + "/journal/notebook?view=all")
        H._dismiss_intro(pg)
        pg.wait_for_selector("[data-note-card-id]", state="attached", timeout=30000)
        pg.wait_for_timeout(1500)
        G.open_gallery(pg)
        pg.add_script_tag(path=str(G.AXE))
        res = pg.evaluate(CONTROL_JS)
        out = {"planted": "nameless <button> inside the gallery dialog", "reported": res,
               "valid": "button-name" in (res.get("ids") or [])}
    except Exception as e:  # noqa: BLE001
        out = {"valid": False, "error": f"{type(e).__name__}: {e}", "trace": traceback.format_exc()[-600:]}
    finally:
        ctx.close()
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--art", required=True)
    ap.add_argument("--tip", required=True)
    a = ap.parse_args()
    if H.refuse_shared_root(a.data_dir):
        print(H.refuse_shared_root(a.data_dir))
        return 3
    art = Path(a.art)
    art.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    res: dict = {"tip": a.tip, "instrument": "ax_gallery_axe.py = d2_phone_measure.seed + d2_gallery_capture.run_viewport (+ AX control)",
                 "data_dir": a.data_dir, "started": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "rows": []}
    sb = H.Sandbox(a.data_dir, a.port, art / "sandbox-boot.log")
    sb.start()
    try:
        if not sb.wait_healthy(base, 240):
            res["error"] = "sandbox never became healthy"
            return 3
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            br = p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
            admin_ctx = br.new_context()
            member_ctx = br.new_context()
            H._provision(admin_ctx.request, member_ctx.request, base, member=G.MEMBER)
            res["seeded"] = P.seed(member_ctx.request, base)
            storage = member_ctx.storage_state()
            res["control"] = control(br, base, storage, art)
            print(json.dumps({"control": res["control"].get("valid"), "reported": res["control"].get("reported")}), flush=True)
            for vw, vh, touch, mobile in G.VIEWPORTS:
                row = G.run_viewport(br, base, vw, vh, touch, mobile, art, storage, do_create=(vw == 1200))
                res["rows"].append(row)
                print(json.dumps({"viewport": row["viewport"], "axe": row.get("axe_violations"), "error": row.get("error")}), flush=True)
            br.close()
        sb.wait_checkpoint("post-prewarm (+120s)", 200)
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        res["integrity_log"] = ipath
        res["integrity"] = H.read_integrity(ipath, []) if ipath else None
        Path(a.out).write_text(json.dumps(res, indent=1, default=str), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
