"""RF (2026-10-02) — the runtime pane's own post-flip smoke, read-only.

`tools/hub_nav_smoke.py --auth` proves the app still navigates; it cannot see a
runtime pane at all. This answers the runtime pane's questions against a DEPLOYED
build, as the synthetic smoke account, and changes nothing:

  1. FLAG    the served bundle carries `VITE_PINE_RUNTIME_PANE_ENABLED:"1"` (a
             build-time flag: a Railway variable that never reached a build is
             not a flip). Read off the JS the origin serves, never off `--kv`.
  2. WORKER  the bundle ships a `runtimeWorker-*.js` chunk; its bytes are recorded.
  3. RUN     in a signed-in page on that origin, the REAL worker chunk runs the
             member door's document for `adx-and-di-for-v4` (the one runtime-only
             script graded MATCH on a TradingView capture) over the origin's own
             `/api/bars/RDDT?tf=D` history (RDDT is listed inside that window, so
             the history starts at the listing and the fallback document computes).
             It must answer inside the pane's budget with finite columns, while the
             main thread keeps painting (frame-gap instrument, with a deliberate
             400 ms block as the control that must be SEEN).
  4. KILL    `GET /api/user-definitions/runtime-kill` answers 200 with a list.
  5. STAGE   (GT) the per-member gate as THIS account receives it:
             `/api/auth/me` -> `pine_runtime_pane_enabled` (driven by
             `PINE_RUNTIME_STAGE`), and the starter allowlist (`allow` on the
             kill read) carrying adx-and-di-for-v4's hash. Reported always;
             `--expect-pane on|off` turns a mismatch into FAILED. The smoke
             account is an ADMIN, so `off` is expected at stage off and `on` at
             admins or all; with `on` the allowlist must carry the graded script
             (an empty one would draw nothing).

⛔ READ-ONLY. One POST (the login, as `hub_nav_smoke.py` signs in); no definition is
saved, no preference written. ⛔ The smoke account only (`SMOKE_EMAIL` /
`SMOKE_PASSWORD`), in its own Playwright context — never a member, never the owner.

EXIT CODES (the `hub_nav_smoke.py` convention, and H15 reads them):
    0  PASS          all four measured and good.
    1  FAILED        a break was MEASURED (wrong answer, blank column, main thread
                     blocked, kill endpoint broken). Roll back first (H15).
    2  INCONCLUSIVE  something could not be measured (no credentials, the flag is
                     not in the bundle, the control did not see its own block).
                     ⛔ Not a pass and not a failure; never a rollback trigger.

    python tools/runtime_pane_smoke.py --base https://uctintelligence.com --auth
    python tools/runtime_pane_smoke.py --auth --expect-pane off   # stage off: nothing changed
    python tools/runtime_pane_smoke.py --auth --expect-pane on    # stage admins / all
    python tools/runtime_pane_smoke.py --self-check     # prove the helpers can fail
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import urllib.request
from pathlib import Path

PROD = "https://uctintelligence.com"
ROOT = Path(__file__).resolve().parents[1]
FIXTURE = ROOT / "tests" / "fixtures" / "runtime_documents" / "documents.json"
SMOKE_SLUG = "adx-and-di-for-v4"
FLAG_RE = re.compile(r"""VITE_PINE_RUNTIME_PANE_ENABLED\s*:\s*["']1["']""")
#: `assets/x.js` (index.html, preload maps) or `./x.js` (a chunk importing its sibling)
CHUNK_RE = re.compile(r"""["'(]\.?/?(?:assets/)?([A-Za-z0-9_.\-]+\.js)["')]""")
WORKER_RE = re.compile(r"""runtimeWorker-[A-Za-z0-9_\-]+\.js""")
BUDGET_MS = 1000  # `runtimeColumns.RUNTIME_PANE_TIME_BUDGET_MS`; the answer must come inside it


def flag_on(js: str) -> bool:
    """Does this JS text carry the runtime pane flag switched ON?"""
    return bool(FLAG_RE.search(js or ""))


def chunk_refs(text: str) -> list[str]:
    """Every `assets/*.js` reference in a document or chunk, in order, deduped."""
    seen, out = set(), []
    for m in CHUNK_RE.finditer(text or ""):
        ref = f"assets/{m.group(1)}"
        if ref not in seen:
            seen.add(ref)
            out.append(ref)
    return out


def worker_ref(text: str) -> str | None:
    m = WORKER_RE.search(text or "")
    return f"assets/{m.group(0)}" if m else None


def walk_bundle(fetch, base: str, cap: int = 600) -> dict:
    """Breadth-first over the served JS from `index.html`. ⛔ A cap, not a hope: a
    bundle larger than `cap` chunks reports `truncated` and the caller is
    INCONCLUSIVE rather than reading "flag absent" off a partial walk."""
    index = fetch(f"{base}/")
    queue, seen = chunk_refs(index), set()
    flag, worker, n = False, None, 0
    while queue and n < cap:
        ref = queue.pop(0)
        if ref in seen:
            continue
        seen.add(ref)
        n += 1
        js = fetch(f"{base}/{ref}")
        flag = flag or flag_on(js)
        worker = worker or worker_ref(js)
        queue.extend(r for r in chunk_refs(js) if r not in seen)
    return {"chunks": n, "flag": flag, "worker": worker, "truncated": bool(queue)}


def stage_verdict(expect: str | None, pane, allow, graded_hash: str) -> list[str]:
    """GT: what is BROKEN about the per-member gate as this account sees it.
    `expect` None = report only. ⛔ A non-boolean `pane` is a server that does
    not send the key (an older build) — broken whenever anything is expected."""
    broken = []
    if expect is None:
        return broken
    if not isinstance(pane, bool):
        return [f"/api/auth/me carries no boolean pine_runtime_pane_enabled (got {pane!r})"]
    if pane != (expect == "on"):
        broken.append(f"pine_runtime_pane_enabled is {pane} for this account, expected {expect}")
    if expect == "on" and not any(isinstance(e, str) and graded_hash.startswith(e) for e in (allow or [])):
        broken.append("the starter allowlist does not carry the graded script (the lane would draw nothing)")
    return broken


def _fetch(url: str) -> str:
    # ⚠️ Cloudflare 1010-blocks raw client UAs on this origin (CLAUDE.md); send a browser one.
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (uct runtime_pane_smoke)"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", errors="replace")


PAGE_RUN = """async ({workerUrl, def, budget}) => {
  const frames = []; let on = true;
  (function tick(t) { frames.push(t); if (on) requestAnimationFrame(tick) })(performance.now());
  const gap = (t0, t1) => { let a = 0, b = frames.length - 1;
    while (a < frames.length - 1 && frames[a + 1] <= t0) a += 1;
    while (b > 0 && frames[b - 1] >= t1) b -= 1;
    let g = 0; for (let i = a + 1; i <= b; i += 1) g = Math.max(g, frames[i] - frames[i - 1]); return g };
  await new Promise((r) => setTimeout(r, 300));
  const c0 = performance.now(); const s = performance.now(); while (performance.now() - s < 400) {}
  await new Promise((r) => setTimeout(r, 200));
  const control = gap(c0, performance.now());
  const res = await fetch('/api/bars/RDDT?tf=D&bars=5000', {credentials: 'include'});
  const body = await res.json();
  const rows = (Array.isArray(body) ? body : body.bars || []).map((b) => ({t: b.t, o: b.o, h: b.h, l: b.l, c: b.c, v: b.v}));
  await new Promise((r) => setTimeout(r, 300));
  const w = new Worker(workerUrl, {type: 'module'});
  const t0 = performance.now();
  const ans = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve({timeout: true}), 20000);
    w.onmessage = (ev) => { clearTimeout(timer); resolve(ev.data) };
    w.onerror = (e) => { clearTimeout(timer); resolve({error: String(e.message || 'worker error')}) };
    w.postMessage({id: 1, def, rows, ctx: {tf: 'D', newestBarIsForming: false, historyFromListing: true}});
  });
  const t1 = performance.now();
  await new Promise((r) => setTimeout(r, 100));
  on = false; w.terminate();
  const cols = ans && ans.ok ? ans.columns : {};
  const lastFinite = Object.values(cols).map((c) => { for (let i = c.length - 1; i >= 0; i -= 1) if (Number.isFinite(c[i])) return true; return false });
  return {bars: rows.length, firstBar: rows.length ? rows[0].t : null, ms: t1 - t0, control, gap: gap(t0, t1),
    ok: !!(ans && ans.ok), guard: ans && ans.error ? (ans.error.guard || ans.error) : null, timeout: !!(ans && ans.timeout),
    columns: Object.keys(cols).length, finiteColumns: lastFinite.filter(Boolean).length}
}"""


def run(base: str, auth: bool, expect_pane: str | None = None) -> int:
    say = print
    if not auth or not os.environ.get("SMOKE_EMAIL") or not os.environ.get("SMOKE_PASSWORD"):
        say("INCONCLUSIVE: needs --auth with SMOKE_EMAIL / SMOKE_PASSWORD (the bars and the kill list are signed-in reads)")
        return 2
    walk = walk_bundle(_fetch, base)
    say(f"[1] bundle: {walk['chunks']} chunks walked; flag {'ON' if walk['flag'] else 'absent'}; worker {walk['worker']}")
    if walk["truncated"] and not walk["flag"]:
        say("INCONCLUSIVE: the bundle walk hit its cap before finding the flag")
        return 2
    if not walk["flag"]:
        say("INCONCLUSIVE: this build does not carry VITE_PINE_RUNTIME_PANE_ENABLED=1 — nothing to smoke")
        return 2
    if not walk["worker"]:
        say("FAILED: the flag is on but the bundle ships no runtimeWorker chunk")
        return 1
    worker_bytes = len(_fetch(f"{base}/{walk['worker']}").encode("utf-8"))
    say(f"[2] worker chunk {walk['worker']}: {worker_bytes} bytes")
    doc = next(d for d in json.loads(FIXTURE.read_text(encoding="utf-8"))["documents"] if d["slug"] == SMOKE_SLUG)
    d = doc["definition"]
    plain = {"id": d["id"], "compute": d["compute"], "meta": {"runtimeHistory": d["meta"].get("runtimeHistory")}}
    from playwright.sync_api import sync_playwright
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context()
        page = ctx.new_page()
        resp = page.request.post(f"{base}/api/auth/login",
                                 data=json.dumps({"email": os.environ["SMOKE_EMAIL"], "password": os.environ["SMOKE_PASSWORD"]}),
                                 headers={"Content-Type": "application/json"})
        if not resp.ok:
            say(f"INCONCLUSIVE: login HTTP {resp.status}")
            browser.close()
            return 2
        page.goto(f"{base}/", wait_until="domcontentloaded", timeout=45000)
        kill = page.request.get(f"{base}/api/user-definitions/runtime-kill")
        kill_ok = kill.ok and isinstance((kill.json() or {}).get("kill"), list)
        say(f"[4] runtime-kill: HTTP {kill.status}, list {'present' if kill_ok else 'MISSING'}")
        me = page.request.get(f"{base}/api/auth/me")
        pane = (me.json() or {}).get("pine_runtime_pane_enabled") if me.ok else None
        allow = (kill.json() or {}).get("allow") if kill.ok else None
        graded = d["meta"]["runtimeSourceHash"]
        say(f"[5] stage: pine_runtime_pane_enabled={pane!r} for this account; allowlist {allow!r}; "
            f"graded script {'listed' if any(isinstance(e, str) and graded.startswith(e) for e in (allow or [])) else 'NOT listed'}")
        r = page.evaluate(PAGE_RUN, {"workerUrl": f"{base}/{walk['worker']}", "def": plain, "budget": BUDGET_MS})
        browser.close()
    say(f"[3] run: {r['bars']} RDDT daily bars from {r['firstBar']}; worker {r['ms']:.0f} ms; "
        f"{'ok' if r['ok'] else r['guard'] or ('TIMEOUT' if r['timeout'] else 'no answer')}; "
        f"{r['finiteColumns']}/{r['columns']} columns end finite; main frame gap {r['gap']:.0f} ms "
        f"(control {r['control']:.0f} ms)")
    if r["control"] < 350:
        say("INCONCLUSIVE: the frame-gap control did not see its own 400 ms block")
        return 2
    broken = stage_verdict(expect_pane, pane, allow, graded)
    if not kill_ok:
        broken.append("kill endpoint")
    if not r["ok"] or r["columns"] == 0 or r["finiteColumns"] < r["columns"]:
        broken.append("the ADX document did not draw finite columns")
    if r["gap"] >= 100:
        broken.append(f"main thread blocked {r['gap']:.0f} ms during the run")
    if broken:
        say("FAILED: " + "; ".join(broken))
        return 1
    say("PASS")
    return 0


def self_check() -> int:
    """Rule 14: the helpers must be able to say NO."""
    bad = []
    if not flag_on('x={VITE_PINE_RUNTIME_PANE_ENABLED:"1",B:2}'):
        bad.append("flag_on missed an ON flag")
    if flag_on('x={VITE_PINE_RUNTIME_PANE_ENABLED:"",B:2}') or flag_on("nothing"):
        bad.append("flag_on accepted an OFF / absent flag")
    if worker_ref('new URL("/assets/runtimeWorker-AbC_1.js",import.meta.url)') != "assets/runtimeWorker-AbC_1.js":
        bad.append("worker_ref missed a worker chunk")
    if worker_ref('"/assets/index-xyz.js"') is not None:
        bad.append("worker_ref matched a non-worker chunk")
    pages = {"https://x/": '<script src="/assets/index-1.js"></script>',
             "https://x/assets/index-1.js": 'import("./lazy-2.js")',
             "https://x/assets/lazy-2.js": 'VITE_PINE_RUNTIME_PANE_ENABLED:"1";new URL("runtimeWorker-9.js",import.meta.url)'}
    w = walk_bundle(lambda u: pages.get(u, ""), "https://x")
    if not (w["flag"] and w["worker"] == "assets/runtimeWorker-9.js" and w["chunks"] == 3):
        bad.append(f"walk_bundle did not follow lazy chunks: {w}")
    g = "d0853c4724651a1d"
    if stage_verdict("on", True, [g[:12]], g) or stage_verdict("off", False, [], g) or stage_verdict(None, None, None, g):
        bad.append("stage_verdict refused a correct answer")
    if not stage_verdict("on", False, [g[:12]], g) or not stage_verdict("off", True, [], g):
        bad.append("stage_verdict accepted the wrong per-member answer")
    if not stage_verdict("on", True, [], g) or not stage_verdict("on", None, [g], g):
        bad.append("stage_verdict accepted an empty allowlist or a missing key")
    w2 = walk_bundle(lambda u: pages.get(u, ""), "https://x", cap=1)
    if not w2["truncated"]:
        bad.append("walk_bundle did not report a capped walk as truncated")
    for b in bad:
        print("SELF-CHECK FAILED:", b)
    print("self-check:", "OK" if not bad else f"{len(bad)} failure(s)")
    return 0 if not bad else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--base", default=PROD)
    ap.add_argument("--auth", action="store_true")
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--expect-pane", choices=("on", "off"), default=None,
                    help="GT: the per-member gate this (admin) account must receive")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    return run(a.base.rstrip("/"), a.auth, a.expect_pane)


if __name__ == "__main__":
    sys.exit(main())
