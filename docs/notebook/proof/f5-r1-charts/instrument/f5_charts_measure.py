"""Lane F5 fix round 1 -- /charts with the "Meet Compass" card pending vs seen, measured in a
real Chromium (Playwright), phone (390x844, touch, mobile) and desktop (1200x800).

Owns its sandbox (tools/notebook_perf_harness.Sandbox, the walk's recipe) and reuses 10E-1's
walk (`notebook_proof_walk`, REPO from $PROOF_REPO) for the member and the intro dismissal.
Scrollbars are SHOWN (`--hide-scrollbars` dropped) so a scroll range is a real one.

For each viewport x {card pending, card seen}: whether the chart shell attribute is on <html>,
the orb cluster and the card (present? displayed? box), the first-run slot's height, <main>'s
vertical scroll range, and the chart's box (phone: the shell `mobileWorkspace`; desktop:
`workspaceBody`) against the viewport. CONTROL: on the Notebook list (not a chart) with the
card pending, the card must be FOUND displayed -- a measurement that cannot see the card on a
page where it shows cannot say it is hidden on /charts.

    python f5_charts_measure.py --data-dir 'C:\\data-w10f5' --port 8220 --out <json> --art <dir> --tip <sha>
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
REPO = Path(os.environ["PROOF_REPO"])
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

import notebook_proof_walk as PW  # noqa: E402

KEY = "voice.orb.coachmarkSeen"
MEASURE_JS = r"""() => {
  const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el);
    return el.getClientRects().length > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return {top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height), left: Math.round(r.left), right: Math.round(r.right)}; };
  const main = document.querySelector('main');
  const slot = document.querySelector('[data-first-run-slot]');
  const cardP = Array.from(document.querySelectorAll('p')).find(p => (p.textContent || '').trim() === 'Meet Compass');
  const card = cardP ? cardP.closest('[data-orb-coachmark]') || cardP.parentElement : null;
  const cluster = document.querySelector('div[class*="orbCluster"]');
  const phone = document.querySelector('[class*="mobileWorkspace"]');
  const desk = document.querySelector('[class*="workspaceBody"]');
  const b = main ? main.scrollTop : 0; if (main) main.scrollTop = 100000; const range = main ? main.scrollTop : 0; if (main) main.scrollTop = b;
  return {
    vw: innerWidth, vh: innerHeight,
    chart_shell_attr: document.documentElement.hasAttribute('data-mobile-chart-shell'),
    hub_root: !!document.querySelector('[data-testid="hub-root"]:not([hidden])'),
    cluster: {present: !!cluster, displayed: vis(cluster), box: box(cluster)},
    card: {present: !!card, displayed: vis(card), box: box(card)},
    slot: {present: !!slot, display: slot ? getComputedStyle(slot).display : null, height: slot ? Math.round(slot.getBoundingClientRect().height) : null},
    main: main ? {scrollHeight: main.scrollHeight, clientHeight: main.clientHeight, scroll_range_px: range} : null,
    phone_chart: box(phone), desk_body: box(desk),
  };
}"""


def measure(W, mode: str, path: str, seen: bool, art: Path, tag: str) -> dict:
    vp = PW.VIEWPORTS[mode]
    kw = {"viewport": {"width": vp["width"], "height": vp["height"]}}
    if vp.get("touch"):
        kw.update(has_touch=True, is_mobile=(mode == "phone"))
    kw["storage_state"] = W.states["fresh1"]
    ctx = W.browser.new_context(**kw)
    write = f"localStorage.setItem('{KEY}', '1')" if seen else f"localStorage.removeItem('{KEY}')"
    ctx.add_init_script("try { localStorage.removeItem('voice.orb.minimized'); " + write + " } catch (e) {}")
    pg = ctx.new_page()
    try:
        PW.goto(W, pg, path)
        # the voice layer is a lazy chunk; give the orb time to land, then settle
        try:
            pg.wait_for_selector('div[class*="orbCluster"]', state="attached", timeout=20000)
        except Exception:  # noqa: BLE001 -- recorded as absent below
            pass
        pg.wait_for_timeout(2500)
        out = pg.evaluate(MEASURE_JS)
        shot = art / f"{tag}.png"
        pg.screenshot(path=str(shot))
        out["screenshot"] = shot.name
        return out
    finally:
        ctx.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8220)
    ap.add_argument("--out", required=True)
    ap.add_argument("--art", required=True)
    ap.add_argument("--tip", required=True)
    a = ap.parse_args()
    from tools import notebook_perf_harness as H
    import sandbox_identity  # noqa: E402
    from playwright.sync_api import sync_playwright
    art = Path(a.art); art.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    res = {"tip": a.tip, "instrument": "f5_charts_measure.py", "rows": [], "control": None}
    refused = H.refuse_shared_root(a.data_dir) or (H.port_busy(a.port) and f"port {a.port} busy")
    if refused:
        print(f"NOT RUN: {refused}")
        return 3
    os.environ.update(PW.GATES)
    sb = H.Sandbox(a.data_dir, a.port, art / "launcher.log")
    not_run = None
    try:
        sb.start()
        if not sb.wait_healthy(base, 300):
            not_run = "never healthy"
        else:
            sb.wait_checkpoint(H.POST_BOOT, H.POST_BOOT_WAIT_S)
            v = sandbox_identity.verify(base, sb.integrity_path())
            res["sandbox_identity"] = v.sentence
            if not v.ok:
                not_run = v.sentence
            else:
                with sync_playwright() as p:
                    browser = p.chromium.launch(ignore_default_args=["--hide-scrollbars"])
                    W = PW.World(browser, base, art)
                    W.admin_login()
                    W.fresh_account()          # fresh1: a paid member who has seen nothing
                    # CONTROL: the Dashboard (no tour holds the first-run stage there), card pending,
                    # desktop -> the card is found displayed. (Run 1 used the Notebook list, where the
                    # Notebook tour holds the stage for a fresh member BY DESIGN, so the card is
                    # correctly absent there -- a control that could not see the card.)
                    ctl = measure(W, "desktop", "/dashboard", False, art, "control-dashboard-1200-pending")
                    res["control"] = {"reading": ctl, "ok": bool(ctl["card"]["displayed"])}
                    # informational: the Notebook list, where the tour holds the stage
                    nb = measure(W, "desktop", "/journal/notebook?view=all", False, art, "notebook-1200-pending-tour-holds-stage")
                    res["notebook_tour_holds_stage"] = {"reading": nb, "card_absent": not nb["card"]["present"]}
                    for mode in ("phone", "desktop"):
                        for seen in (False, True):
                            tag = f"charts-{PW.VIEWPORTS[mode]['width']}-{'seen' if seen else 'pending'}"
                            try:
                                row = measure(W, mode, "/charts", seen, art, tag)
                            except Exception as e:  # noqa: BLE001
                                row = {"error": f"{type(e).__name__}: {e}"[:300]}
                            row.update(mode=mode, card_state="seen" if seen else "pending")
                            res["rows"].append(row)
                            print(json.dumps(row)[:600], flush=True)
                    browser.close()
    except Exception as e:  # noqa: BLE001
        not_run = f"{type(e).__name__}: {e}"
        res["traceback"] = traceback.format_exc()[-2000:]
    finally:
        res["stop"] = sb.stop()
        ipath = sb.integrity_path()
        integ = H.read_integrity(ipath, [H.PRE_BOOT, H.POST_BOOT, H.SHUTDOWN])
        first = H.integrity_line(integ, not_run=not_run)
        res.update(first_line=first, integrity=integ, not_run=not_run)
        Path(a.out).write_text(json.dumps(res, indent=1, default=str) + "\n", encoding="utf-8", newline="\n")
        if ipath and Path(ipath).is_file():
            import shutil
            shutil.move(ipath, str(Path(a.out).with_suffix(".integrity.md")))
        print(first)
        print("control:", res.get("control", {}) and res["control"].get("ok"))
    return 3 if not_run else 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
