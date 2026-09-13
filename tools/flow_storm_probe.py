"""TOP 10 / request-storm diagnosis. INSTRUMENTED, not guessed.

Path B (in-app navigation) reproduced two shapes on a quiet tape: a CLEAN one
(7 flow requests, ~2.1 MB, picks late or never) and a STORM one (bootstrap x3,
TOP_PICKS x3, a stray tape fetch, ~3.4 MB, picks 15-30 s). This decides between
remount / render-gate / version race / data shape with evidence.

NO FILE IS EDITED FOR THE DIAGNOSIS. Everything is injected at runtime: a fetch
wrapper recording each request initiator stack and the version dispatched at vs
returned, and a MutationObserver counting mounts/unmounts of the page root and the
picks table at DOM level.

THE DISCRIMINATOR: a render gate does not re-issue network calls; a remount does.
Mount counts and repeated first-paint fetches, read together, separate them.
"""
import argparse, importlib.util, json, os, sys, time

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(errors="backslashreplace")
    except Exception:
        pass

BASE = "https://uctintelligence.com"
UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/128.0 Safari/537.36")

INSTRUMENT = """
(() => {
  const S = {fetches: [], mounts: [], t0: performance.now()};
  window.__storm = S;
  const orig = window.fetch;
  window.fetch = function (input, init) {
    const url = (typeof input === 'string') ? input : (input && input.url) || '';
    const rec = {url: String(url), t: performance.now() - S.t0,
                 stack: (new Error()).stack || '', status: null,
                 respVersion: null, part: null, done: null};
    const isFlow = rec.url.indexOf('/api/flow/') !== -1;
    if (isFlow) S.fetches.push(rec);
    return orig.apply(this, arguments).then(r => {
      if (isFlow) {
        rec.status = r.status;
        rec.done = performance.now() - S.t0;
        try {
          rec.respVersion = r.headers.get('x-flow-version');
          rec.part = r.headers.get('x-flow-part');
        } catch (e) {}
      }
      return r;
    });
  };
  const track = {'.of-mroot': 'root', '.of-picks': 'picks', '.of-tabs': 'tabs'};
  const present = {};
  const sample = () => {
    for (const sel in track) {
      const now = !!document.querySelector(sel);
      if (present[sel] === undefined) present[sel] = false;
      if (now !== present[sel]) {
        S.mounts.push({name: track[sel], event: now ? 'mount' : 'unmount',
                       t: performance.now() - S.t0});
        present[sel] = now;
      }
    }
  };
  // add_init_script runs at document-start, BEFORE documentElement exists. An
  // unguarded observe() throws there, and because the throw escapes the IIFE the
  // rAF tick below never starts -- while the fetch wrapper installed ABOVE it
  // survives. That asymmetry is exactly what was observed: fetches captured,
  // mounts always empty. Attach when there is something to attach to, and keep
  // the tick alive even if a sample throws.
  const attach = () => {
    const root = document.documentElement || document.body;
    if (!root) { requestAnimationFrame(attach); return; }
    try {
      new MutationObserver(sample).observe(root, {childList: true, subtree: true});
      S.observerAttached = true;
    } catch (e) { S.observerAttached = String(e).slice(0, 80); }
  };
  attach();
  (function tick() {
    try { sample(); } catch (e) { S.sampleError = String(e).slice(0, 80); }
    requestAnimationFrame(tick);
  })();
  return true;
})();
"""


def _rig():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), "flow_cold_paint_rig.py")
    spec = importlib.util.spec_from_file_location("rig", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def settle(page, timeout=45000):
    try:
        page.wait_for_function(
            "(() => { const t=(document.body&&document.body.innerText||'');"
            " return t.length > 800 && t.indexOf('CHARTING THE MARKET') === -1; })()",
            timeout=timeout)
    except Exception:
        pass


def part_of(u):
    i = u.find("part=")
    if i != -1:
        return u[i + 5:].split("&")[0]
    return "data" if "data?" in u else "other"


def one_run(pw, rig, email, password, idx, start="/dashboard"):
    from playwright.sync_api import TimeoutError as PWTimeout
    b = pw.chromium.launch(headless=True)
    ctx = b.new_context(user_agent=UA, viewport={"width": 1600, "height": 1200})
    try:
        up0 = rig._uptime()
        t_run = time.monotonic()
        rig._pace_login()
        r = ctx.request.post(BASE + "/api/auth/login",
                             data={"email": email, "password": password})
        if r.status != 200:
            sw, why = rig._swap_verdict(up0, rig._uptime(), time.monotonic() - t_run)
            if r.status == 429:
                sw, why = True, "login RATE-LIMITED - nothing measured"
            return {"run": idx, "error": "login http %s" % r.status,
                    "deploy_swapped": sw, "swap_reason": why}
        page = ctx.new_page()
        page.add_init_script(INSTRUMENT)
        page.goto(BASE + start, wait_until="commit", timeout=60000)
        settle(page)
        page.wait_for_timeout(1500)
        link = page.locator('a[href="/options-flow"]').first
        if link.count() == 0:
            return {"run": idx, "error": "no nav link (viewport below 1025px?)"}
        page.evaluate("window.__storm.fetches.length = 0;"
                      "window.__storm.mounts.length = 0;"
                      "window.__storm.t0 = performance.now();")
        link.click()
        try:
            page.wait_for_function("document.querySelector('.of-picks') !== null",
                                   timeout=40000)
        except PWTimeout:
            pass
        page.wait_for_timeout(9000)
        data = page.evaluate("({fetches: window.__storm.fetches,"
                             " mounts: window.__storm.mounts,"
                             " picksNow: !!document.querySelector('.of-picks')})")
        up1 = rig._uptime()
        sw, why = rig._swap_verdict(up0, up1, time.monotonic() - t_run)
        data.update({"run": idx, "deploy_swapped": sw, "swap_reason": why,
                     "uptime_before": up0, "uptime_after": up1})
        return data
    finally:
        ctx.close()
        b.close()


def summarise(row):
    fs = [f for f in row.get("fetches", []) if "/api/flow/" in f["url"]]
    parts = [part_of(f["url"]) for f in fs]
    firstpaint = [p for p in parts if p in ("bootstrap", "TOP_PICKS")]
    dupes = dict((p, firstpaint.count(p)) for p in set(firstpaint)
                 if firstpaint.count(p) > 1)
    mounts = row.get("mounts", [])

    def count(name, ev):
        return sum(1 for m in mounts if m["name"] == name and m["event"] == ev)

    picks_t = next((m["t"] for m in mounts
                    if m["name"] == "picks" and m["event"] == "mount"), None)
    tp_t = next((f["done"] for f in fs
                 if part_of(f["url"]) == "TOP_PICKS" and f["done"]), None)
    return {
        "run": row.get("run"),
        "shape": "STORM" if dupes else "clean",
        "dupes": dupes,
        "n_flow_fetches": len(fs),
        "stray_tape": sum(1 for p in parts if p == "data"),
        "root_mounts": count("root", "mount"),
        "root_unmounts": count("root", "unmount"),
        "picks_mounts": count("picks", "mount"),
        "picks_unmounts": count("picks", "unmount"),
        "picks_rendered": row.get("picksNow"),
        "picks_mount_ms": round(picks_t) if picks_t else None,
        "top_picks_arrival_ms": round(tp_t) if tp_t else None,
        "picks_lag_ms": (round(picks_t - tp_t) if (picks_t and tp_t) else None),
        "versions": sorted(set(f["respVersion"] for f in fs if f["respVersion"])),
    }


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--runs", type=int, default=8)
    ap.add_argument("--out", default=None)
    ap.add_argument("--label", default="STORM DIAGNOSIS (quiet tape)")
    a = ap.parse_args(argv)
    rig = _rig()
    up = rig._uptime()
    print("=" * 76)
    print("%s | pod %ss (floor %s)" % (a.label, up, rig.MIN_POD_AGE_S))
    if up is None or up < rig.MIN_POD_AGE_S:
        print("  INCONCLUSIVE: pod below floor. Nothing measured.")
        return 2
    from playwright.sync_api import sync_playwright
    rows, accepted = [], []
    with sync_playwright() as pw:
        for i in range(1, a.runs + 1):
            row = one_run(pw, rig, os.environ["MEMBER_SMOKE_EMAIL"],
                          os.environ["MEMBER_SMOKE_PASSWORD"], i)
            rows.append(row)
            if row.get("error"):
                print("  run %d: ERROR %s%s" % (i, row["error"],
                      "  -> INCONCLUSIVE" if row.get("deploy_swapped") else ""))
                continue
            if row.get("deploy_swapped"):
                print("  run %d: INCONCLUSIVE (%s) - DISCARDED"
                      % (i, row.get("swap_reason")))
                continue
            s = summarise(row)
            accepted.append(s)
            print("  run %-2d %-5s fetches=%-2d dupes=%-20s tape=%d | root %d/%d "
                  "picks %d/%d | picks@%sms TP@%sms lag=%sms rendered=%s"
                  % (i, s["shape"], s["n_flow_fetches"], json.dumps(s["dupes"]),
                     s["stray_tape"], s["root_mounts"], s["root_unmounts"],
                     s["picks_mounts"], s["picks_unmounts"], s["picks_mount_ms"],
                     s["top_picks_arrival_ms"], s["picks_lag_ms"],
                     s["picks_rendered"]))
    print("-" * 76)
    if accepted:
        storms = [s for s in accepted if s["shape"] == "STORM"]
        print("  accepted=%d  STORM=%d  clean=%d  picks rendered=%d/%d"
              % (len(accepted), len(storms), len(accepted) - len(storms),
                 sum(1 for s in accepted if s["picks_rendered"]), len(accepted)))
        print("  runs with root mounted MORE THAN ONCE (remount signature): %d"
              % len([s for s in accepted if s["root_mounts"] > 1]))
    else:
        print("  NOTHING MEASURED - every run discarded or errored")
    if a.out:
        json.dump({"label": a.label, "accepted": accepted, "raw": rows},
                  open(a.out, "w"), indent=1)
        print("  saved: %s" % a.out)
    return 0 if accepted else 1


if __name__ == "__main__":
    raise SystemExit(main())

