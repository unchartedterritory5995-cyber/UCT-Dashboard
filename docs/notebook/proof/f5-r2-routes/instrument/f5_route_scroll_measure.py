"""Lane F5 fix round 2 -- which pages does a pending "Meet Compass" card push into a scroll
or below the fold?

For every route in NavBar's NAV_ITEMS (READ from `node tools/nav_manifest.mjs --json`, never
typed) plus /settings, at 1200x800 (desktop, scrollbars SHOWN: `--hide-scrollbars` dropped), a
fresh paid member with the card pending vs already dismissed, each in a NEW context. Sampled
twice, 2 s apart, after the orb cluster attaches + 3 s:
  - <main>'s vertical scroll range (scrollHeight - clientHeight) and the document's;
  - the first-run slot's height, the card (present / displayed / box) and whether a point
    hit at the centre of its "Got it" lands INSIDE the card (displayed is not visible);
  - the routed page's root (the slot's next element sibling): position, top, bottom;
  - the orb cluster's display.

Classification (the controller's ruling, fix round 2): a route is VIEWPORT-LOCKED when the
pending card
  (a) creates a scroll the dismissed state does not have: dismissed range 0 in both samples
      and pending range > 0 in both samples; or
  (b) pushes the page's root below the fold with no scroll to reach it: pending root bottom
      > viewport height in both samples, dismissed root bottom <= viewport height in both,
      and pending range 0.
An ordinary scrolling page (dismissed range > 0) grows by the card's height and is reported,
not flagged. A pending row whose card is not displayed cannot be classified: INCONCLUSIVE.

CONTROLS (the run is INVALID unless both hold):
  - positive: /charts is known (fix round 1) to be pushed 78 px at 1200 -> must read LOCKED;
  - negative: /settings is a page that scrolls on its own -> must read ordinary.

NAV CHECK (`--nav-check`): one context, card pending: land on /charts, read the card, then
click the sidebar's Morning Wire link (a client-side navigation, the orb stays mounted) and
read it again; then click the Charts link and read it a third time; the key is read after
each step (waiting is not dismissing).

    python f5_route_scroll_measure.py --data-dir 'C:\\data-w10f5' --port 8220 --out <json> --art <dir> --tip <sha> [--nav-check]
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
REPO = Path(os.environ["PROOF_REPO"])
sys.path.insert(0, str(REPO))
sys.path.insert(0, str(REPO / "scripts"))

import notebook_proof_walk as PW  # noqa: E402

KEY = "voice.orb.coachmarkSeen"
POSITIVE, NEGATIVE = "/charts", "/settings"
SAMPLE_JS = r"""() => {
  const vis = (el) => { if (!el) return false; const cs = getComputedStyle(el);
    return el.getClientRects().length > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const box = (el) => { if (!el) return null; const r = el.getBoundingClientRect();
    return {top: Math.round(r.top), bottom: Math.round(r.bottom), height: Math.round(r.height),
            left: Math.round(r.left), right: Math.round(r.right)}; };
  const main = document.querySelector('main');
  const slot = document.querySelector('[data-first-run-slot]');
  const card = document.querySelector('[data-orb-coachmark]');
  const cluster = document.querySelector('div[class*="orbCluster"]');
  const root = slot ? slot.nextElementSibling : null;
  let got_it_hit = null;
  if (card && vis(card)) {
    const btn = Array.from(card.querySelectorAll('button')).find(b => /got it/i.test(b.textContent || ''));
    if (btn) { const r = btn.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      got_it_hit = {in_viewport: r.top >= 0 && r.bottom <= innerHeight, inside_card: !!(hit && card.contains(hit))}; }
  }
  const se = document.scrollingElement;
  return {
    path: location.pathname + location.search, vh: innerHeight, vw: innerWidth,
    main: main ? {scrollHeight: main.scrollHeight, clientHeight: main.clientHeight,
                  range: main.scrollHeight - main.clientHeight} : null,
    doc_range: se ? se.scrollHeight - se.clientHeight : null,
    slot: slot ? {display: getComputedStyle(slot).display, height: Math.round(slot.getBoundingClientRect().height)} : null,
    card_present: !!card, card_displayed: vis(card), card_box: box(card), got_it_hit,
    cluster_displayed: vis(cluster),
    root: root ? {tag: root.tagName, cls: String(root.className || '').slice(0, 80),
                  position: getComputedStyle(root).position, ...box(root)} : null,
    key: (() => { try { return localStorage.getItem('voice.orb.coachmarkSeen'); } catch (e) { return 'ERR'; } })(),
  };
}"""


def nav_routes() -> list[str]:
    out = subprocess.run(["node", "tools/nav_manifest.mjs", "--json"], cwd=REPO, capture_output=True,
                         text=True, encoding="utf-8", errors="replace", check=True).stdout
    items = json.loads(out)["nav"]["items"]
    routes = [i["to"] for i in items]
    if not routes:
        raise RuntimeError("nav manifest returned no routes")
    return routes + [NEGATIVE]


def new_page(W, seen: bool | None):
    ctx = W.browser.new_context(viewport={"width": 1200, "height": 800}, storage_state=W.states["fresh1"])
    init = "try { localStorage.removeItem('voice.orb.minimized'); "
    if seen is True:
        init += f"localStorage.setItem('{KEY}', '1'); "
    elif seen is False:
        init += f"localStorage.removeItem('{KEY}'); "
    ctx.add_init_script(init + "} catch (e) {}")
    pg = ctx.new_page()
    errors: list[str] = []
    pg.on("pageerror", lambda e: errors.append(str(e)[:200]))
    return ctx, pg, errors


def settle(pg) -> None:
    try:
        pg.wait_for_selector('div[class*="orbCluster"]', state="attached", timeout=20000)
    except Exception:  # noqa: BLE001 -- recorded as absent by the sample
        pass
    pg.wait_for_timeout(3000)


def measure(W, path: str, seen: bool, art: Path, tag: str) -> dict:
    ctx, pg, errors = new_page(W, seen)
    try:
        PW.goto(W, pg, path)
        settle(pg)
        a = pg.evaluate(SAMPLE_JS)
        pg.wait_for_timeout(2000)
        b = pg.evaluate(SAMPLE_JS)
        shot = art / f"{tag}.png"
        pg.screenshot(path=str(shot))
        return {"first": a, "second": b, "page_errors": errors[:5], "screenshot": shot.name}
    finally:
        ctx.close()


def classify(pend: dict, seen: dict) -> dict:
    samples = [pend.get("first"), pend.get("second"), seen.get("first"), seen.get("second")]
    if any(s is None or s.get("main") is None or s.get("root") is None for s in samples):
        return {"verdict": "INCONCLUSIVE", "why": "no <main> or page-root reading"}
    p1, p2, s1, s2 = samples
    pr, sr = [p1["main"]["range"], p2["main"]["range"]], [s1["main"]["range"], s2["main"]["range"]]
    pb, sb = [p1["root"]["bottom"], p2["root"]["bottom"]], [s1["root"]["bottom"], s2["root"]["bottom"]]
    vh = p1["vh"]
    shown = bool(p1["card_displayed"] and p2["card_displayed"])
    base = {"pending_range": pr, "seen_range": sr, "growth": pr[1] - sr[1], "stable": pr[0] == pr[1] and sr[0] == sr[1],
            "pending_root_bottom": pb, "seen_root_bottom": sb, "vh": vh, "card_displayed": shown,
            "card_height": (p2.get("card_box") or {}).get("height"), "got_it_hit": p2.get("got_it_hit"),
            "seen_card_displayed": bool(s1["card_displayed"] or s2["card_displayed"])}
    if not shown:
        return {"verdict": "INCONCLUSIVE", "why": "the card is not displayed with it pending", **base}
    if base["seen_card_displayed"]:
        return {"verdict": "INCONCLUSIVE", "why": "the card is displayed with it dismissed", **base}
    by_scroll = all(x == 0 for x in sr) and all(x > 0 for x in pr)
    by_fold = (all(x > vh for x in pb) and all(x <= vh for x in sb) and all(x == 0 for x in pr))
    return {"verdict": "LOCKED" if (by_scroll or by_fold) else "ordinary",
            "why": "scroll" if by_scroll else ("below-the-fold" if by_fold else None), **base}


def nav_check(W, art: Path) -> dict:
    """/charts -> sidebar Morning Wire -> sidebar Charts, one context, card pending."""
    ctx, pg, errors = new_page(W, False)
    steps = []
    try:
        PW.goto(W, pg, "/charts")
        settle(pg)
        steps.append({"step": "land /charts", **pg.evaluate(SAMPLE_JS)})
        pg.screenshot(path=str(art / "navcheck-1-charts.png"))
        for label, href in (("click sidebar -> /morning-wire", "/morning-wire"), ("click sidebar -> /charts", "/charts")):
            how = "click"
            try:
                pg.locator(f'nav a[href="{href}"]').first.click(timeout=8000)
            except Exception as e:  # noqa: BLE001 -- recorded; the reading still says where we are
                how = f"click failed: {type(e).__name__}"
            pg.wait_for_timeout(4000)
            steps.append({"step": label, "how": how, **pg.evaluate(SAMPLE_JS)})
            pg.screenshot(path=str(art / f"navcheck-{len(steps)}-{href.strip('/')}.png"))
        return {"steps": steps, "page_errors": errors[:5]}
    finally:
        ctx.close()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, default=8220)
    ap.add_argument("--out", required=True)
    ap.add_argument("--art", required=True)
    ap.add_argument("--tip", required=True)
    ap.add_argument("--routes", nargs="*")
    ap.add_argument("--nav-check", action="store_true")
    a = ap.parse_args()
    from tools import notebook_perf_harness as H
    import sandbox_identity  # noqa: E402
    from playwright.sync_api import sync_playwright
    art = Path(a.art)
    art.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{a.port}"
    routes = a.routes or nav_routes()
    res = {"tip": a.tip, "instrument": "f5_route_scroll_measure.py", "viewport": "1200x800",
           "scrollbars": "shown", "routes": routes, "rows": [], "control": None, "locked": None}
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
                    W.fresh_account()
                    for route in routes:
                        slug = route.strip("/").replace("/", "_") or "root"
                        row = {"route": route}
                        try:
                            row["pending"] = measure(W, route, False, art, f"{slug}-pending")
                            row["seen"] = measure(W, route, True, art, f"{slug}-seen")
                            row["class"] = classify(row["pending"], row["seen"])
                        except Exception as e:  # noqa: BLE001
                            row["error"] = f"{type(e).__name__}: {e}"[:300]
                            row["class"] = {"verdict": "INCONCLUSIVE", "why": row["error"]}
                        res["rows"].append(row)
                        print(json.dumps({"route": route, **row["class"]}), flush=True)
                    if a.nav_check:
                        res["nav_check"] = nav_check(W, art)
                        for s in res["nav_check"]["steps"]:
                            print(json.dumps({k: s.get(k) for k in ("step", "how", "path", "card_displayed",
                                                                  "cluster_displayed", "key")}), flush=True)
                        for s in res["nav_check"]["steps"]:
                            print("   main range", (s.get("main") or {}).get("range"), "slot", s.get("slot"), flush=True)
                    browser.close()
                verdict = {r["route"]: r["class"].get("verdict") for r in res["rows"]}
                res["control"] = {"charts_classified_locked": verdict.get(POSITIVE) == "LOCKED",
                                  "settings_classified_ordinary": verdict.get(NEGATIVE) == "ordinary"}
                res["inconclusive"] = [r for r, v in verdict.items() if v not in ("LOCKED", "ordinary")]
                res["locked"] = [r for r, v in verdict.items() if v == "LOCKED"]
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
        print("control:", res.get("control"), "locked:", res.get("locked"), "inconclusive:", res.get("inconclusive"))
    return 3 if not_run else 0


if __name__ == "__main__":
    for s in (sys.stdout, sys.stderr):
        try:
            s.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)
        except Exception:  # noqa: BLE001
            pass
    sys.exit(main())
