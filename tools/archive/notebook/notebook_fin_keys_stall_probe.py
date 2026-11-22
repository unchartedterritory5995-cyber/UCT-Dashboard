"""Finish program, lane KEYS round 3: the "Loading..." stall probe.

WHAT IT REPRODUCES. A keyboard member has a note open, presses "g" then "j" (the Journal's own
shortcut to Closed trades), and the Trades page shows "Loading..." and never finishes. Seen three
times in three click-budget runs (docs/notebook/fin-clicks.md, section 12.6).

WHAT IT RECORDS, per run, BEFORE anything is concluded (R-RAW):
  * every request the page made after the two keys: url, status, ms, and the ones never answered
  * console errors and page errors
  * whether the Trades rows arrived, and after how long
  * on a stall: 5 seconds of React commit counts and of document.activeElement, the body text,
    and a screenshot
  * the box's CPU load at the time

It runs the SAME frontend build that app/dist holds, so two builds are compared by running the
tool twice with the dist directory swapped (the caller does that; this tool never builds).

Run:
    python tools/notebook_fin_keys_stall_probe.py --data-dir C:/data-fin-clicks/stall-a \
        --port 8720 --runs 15 --label tip --out docs/notebook/evidence/fin-keys/stall/tip

Exit: 0 = ran and the sandbox integrity is CLEAN (a stall is a finding, not an exit code);
2 = not run or integrity not clean; 3 = refused.
"""
from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import notebook_w13q_clicks as w  # noqa: E402
h = w.h

# Counts React commits without the dev build: React calls this hook's onCommitFiberRoot on
# every commit when the hook exists before React loads.
INIT_JS = """
(() => {
  window.__probe = { commits: 0 };
  window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    supportsFiber: true, renderers: new Map(), isDisabled: false,
    inject() { return 1 }, checkDCE() {},
    onCommitFiberRoot() { window.__probe.commits += 1 },
    onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, onScheduleFiberRoot() {},
  };
})();
"""
ACTIVE_JS = """() => { const e = document.activeElement; if (!e) return 'none';
  return e.tagName + (e.id ? '#' + e.id : '') + (e.getAttribute('data-route-focus') != null ? '[route-focus]' : '')
    + (e.getAttribute('data-route-landing') != null ? '[landing]' : '') }"""


def cpu_load() -> float | None:
    try:
        out = subprocess.run(
            ["powershell", "-NoProfile", "-Command",
             "(Get-CimInstance Win32_Processor | Measure-Object -Property LoadPercentage -Average).Average"],
            capture_output=True, text=True, timeout=20).stdout.strip()
        return float(out)
    except Exception:  # noqa: BLE001
        return None


def one_run(br, state, cx, base: str, i: int, out: Path, start: str, wait_s: float) -> dict:
    ctx = br.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce", storage_state=state)
    ctx.add_init_script(INIT_JS)
    pg = ctx.new_page()
    pg.bring_to_front()
    reqs: dict = {}
    errors: list = []
    armed = {"on": False, "t0": 0.0}

    def on_request(r):
        if armed["on"]:
            reqs[id(r)] = {"url": r.url.replace(base, "")[:160], "t": round(time.time() - armed["t0"], 3),
                           "status": None, "ms": None, "failed": None}

    def on_done(r, failed=None):
        rec = reqs.get(id(r))
        if rec is None:
            return
        rec["ms"] = round((time.time() - armed["t0"] - rec["t"]) * 1000)
        if failed:
            rec["failed"] = failed
        else:
            try:
                resp = r.response()
                rec["status"] = resp.status if resp else None
            except Exception:  # noqa: BLE001
                rec["status"] = "?"

    pg.on("request", on_request)
    pg.on("requestfinished", lambda r: on_done(r))
    pg.on("requestfailed", lambda r: on_done(r, failed=(r.failure or "failed")))
    pg.on("pageerror", lambda e: errors.append({"pageerror": str(e)[:300]}))
    pg.on("console", lambda c: errors.append({"console": c.text[:300]}) if c.type == "error" else None)

    row = {"run": i, "start": start, "cpu_before": cpu_load(), "ok": None, "arrived_s": None}
    try:
        if start == "note":
            nid = w.fresh_note(cx, f"Stall probe {i} {int(time.time())}", "CRWD")
            w.open_note_start(cx, pg, nid)
            pg.evaluate("() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur() }")
        else:
            w.open_start(pg, base, "/journal")
        row["active_before"] = pg.evaluate(ACTIVE_JS)
        # Does the page being LEFT already name the symbol in a control? (the click tool's
        # loose row locator, on the start page)
        row["loose_match_on_start_page"] = pg.locator(
            "a, button, [role=button], [role=row], li", has_text="CRWD").filter(visible=True).count()
        commits0 = pg.evaluate("() => window.__probe ? window.__probe.commits : -1")
        armed["on"], armed["t0"] = True, time.time()
        pg.keyboard.press("g")
        pg.keyboard.press("j")
        try:
            pg.wait_for_url("**/journal/trades?*seg=closed*", timeout=8000)
            row["url_changed"] = True
        except Exception:  # noqa: BLE001
            row["url_changed"] = False
        end = time.time() + wait_s
        rows = pg.locator("tr", has_text="CRWD")
        while time.time() < end:
            if rows.count():
                row["ok"], row["arrived_s"] = True, round(time.time() - armed["t0"], 2)
                break
            pg.wait_for_timeout(200)
        else:
            row["ok"] = False
        row["commits_to_arrival_or_timeout"] = pg.evaluate("() => window.__probe.commits") - commits0
        row["active_after"] = pg.evaluate(ACTIVE_JS)
        if not row["ok"]:
            samples = []
            for _ in range(10):                       # 5 seconds, twice a second
                samples.append({"commits": pg.evaluate("() => window.__probe.commits"),
                                "active": pg.evaluate(ACTIVE_JS)})
                pg.wait_for_timeout(500)
            row["stuck_samples"] = samples
            row["stuck_commits_in_5s"] = samples[-1]["commits"] - samples[0]["commits"]
            row["stuck_active_distinct"] = sorted({s["active"] for s in samples})
            row["stuck_body_text"] = pg.locator("main").first.inner_text()[:300]
            row["stuck_url"] = pg.url.replace(base, "")
            row["stuck_fallback_visible"] = pg.get_by_text("Loading…", exact=True).count()
            pg.screenshot(path=str(out / f"stall-run-{i}.png"))
    except Exception as e:  # noqa: BLE001 -- recorded; the next run still happens
        row["raised"] = f"{type(e).__name__}: {str(e)[:300]}"
    row["cpu_after"] = cpu_load()
    done = list(reqs.values())
    row["requests"] = len(done)
    row["unanswered"] = [r for r in done if r["ms"] is None]
    row["failed"] = [r for r in done if r["failed"]]
    row["not_200"] = [r for r in done if r["status"] not in (None, 200, 201, 204, 304) and not r["failed"]]
    row["slowest"] = sorted((r for r in done if r["ms"] is not None), key=lambda r: -r["ms"])[:5]
    row["errors"] = errors[:20]
    (out / f"requests-run-{i}.json").write_text(json.dumps(done, indent=1), encoding="utf-8")
    ctx.close()
    return row


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--runs", type=int, default=15)
    ap.add_argument("--label", required=True, help="which build app/dist holds (tip, base, ...)")
    ap.add_argument("--start", default="note", choices=["note", "journal"],
                    help="the page the member is on before the two keys")
    ap.add_argument("--wait", type=float, default=25.0, help="seconds to wait for the Trades rows")
    args = ap.parse_args(argv)
    why = h.refuse_shared_root(args.data_dir)
    if why or args.port not in w.PORTS or h.port_busy(args.port):
        print(f"REFUSED: {why or 'port not allowed or busy'}")
        return 3
    data_dir = Path(args.data_dir)
    if data_dir.exists() and any(data_dir.iterdir()):
        print(f"REFUSED: {data_dir} is not empty")
        return 3
    data_dir.mkdir(parents=True, exist_ok=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    dist_index = (w.REPO / "app" / "dist" / "index.html")
    result = {"tool": "tools/notebook_fin_keys_stall_probe.py", "label": args.label, "start": args.start,
              "tree": subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(w.REPO), capture_output=True, text=True).stdout.strip(),
              "dist_index_bytes": dist_index.stat().st_size if dist_index.exists() else None,
              "dist_entry": None, "started": datetime.now(timezone.utc).isoformat(timespec="seconds"),
              "runs": [], "status": "INCOMPLETE (run did not finish)"}
    if dist_index.exists():
        import re
        m = re.search(r"assets/index-[\w-]+\.js", dist_index.read_text(encoding="utf-8"))
        result["dist_entry"] = m.group(0) if m else None
    (out / "probe.json").write_text(json.dumps(result, indent=1), encoding="utf-8")
    cal = w.write_calendar(data_dir)
    w.seed_stores(data_dir, out)
    w.seed_research_stores(data_dir, out)
    for k in ("RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_ENVIRONMENT_ID",
              "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_SERVICE_NAME", "RAILWAY_DEPLOYMENT_ID"):
        os.environ.pop(k, None)
    os.environ.update(w.SANDBOX_FLAGS)
    os.environ["NOTEBOOK_EARNINGS_PREP_SANDBOX_CALENDAR"] = str(cal)
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "",
                       "ALPHA_VANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    box = h.Sandbox(str(data_dir), args.port, out / "sandbox.log")
    base = f"http://127.0.0.1:{args.port}"
    failure = None
    box.start()
    try:
        if not box.wait_healthy(base, 300):
            failure = "the sandbox never answered /api/health"
        else:
            from playwright.sync_api import sync_playwright
            with sync_playwright() as pw:
                br = pw.chromium.launch()
                admin = br.new_context()
                seedctx = br.new_context(viewport={"width": 1280, "height": 900}, reduced_motion="reduce")
                req = seedctx.request
                h._provision(admin.request, req, base, member=w.MEMBER)
                cx = w.Ctx(base=base, req=req, wide="1280")
                w.seed_member(cx, data_dir)
                pg = seedctx.new_page()
                w.open_start(pg, base, "/journal/notebook")
                w.clear_onboarding(pg, base, next(iter(cx.seed["notes"].values()), None))
                pg.close()
                state = seedctx.storage_state()
                for i in range(1, args.runs + 1):
                    row = one_run(br, state, cx, base, i, out, args.start, args.wait)
                    result["runs"].append(row)
                    print(f"  {args.label} run {i:>2}: {'ok ' + str(row['arrived_s']) + 's' if row['ok'] else 'STALL' if row['ok'] is False else 'RAISED'}"
                          f"  cpu={row['cpu_before']}  unanswered={len(row['unanswered'])}  commits={row.get('commits_to_arrival_or_timeout')}"
                          f"  {row.get('raised', '')}", flush=True)
                    (out / "probe.json").write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
                br.close()
            box.wait_checkpoint(h.POST_BOOT, 60)
    except Exception as e:  # noqa: BLE001
        failure = f"{type(e).__name__}: {str(e)[:400]}"
    finally:
        box.stop(grace_s=300)
    integ = h.read_integrity(box.integrity_path(), [h.PRE_BOOT, h.POST_BOOT, h.SHUTDOWN])
    h._keep_integrity_log(integ, out / "integrity.md", own=True)
    print(h.integrity_line(integ, f"stop: {box.stop_how}", not_run=None))
    stalls = [r["run"] for r in result["runs"] if r["ok"] is False]
    result.update({"integrity": integ, "failure": failure, "stalls": stalls,
                   "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                   "status": "COMPLETE" if not failure else "NOT COMPLETE"})
    (out / "probe.json").write_text(json.dumps(result, indent=1, default=str), encoding="utf-8")
    print(f"VERDICT: {args.label}: {len(result['runs'])} runs, {len(stalls)} stalled {stalls}"
          f"{' -- FAILURE: ' + failure if failure else ''}")
    return 0 if integ["clean"] and not failure else 2


if __name__ == "__main__":
    sys.exit(main())
