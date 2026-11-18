"""RS Rating, added from "Your indicators": what the chart does on a real load, measured. A MEASURE-ONLY tool, never a gate.

WHY (RS Rating L10, 2026-11-17). RS Rating added from the library stayed refused (`runtime:request`) on some loads in
session. Two causes were found and fixed: SPX's daily answer had no bar for today (#1687) and the binder's recompute
key missed the run half's own reads (#1715). A transient refusal "flash" was then seen once, in the restart window of
22:44Z, and not in two later instrumented windows (docs/pine/evidence/2026-11-17-rs-library-load/EVIDENCE.md). This tool
is that instrument, kept so any later restart (or any doubt) can be probed in one command.

What it records, per fresh load (`--loads`, default 3), in the member's own path:
  * every read of the RS Rating store keys in the chart's other-symbol cache (`SPX`, the seed): status, bar count,
    retryAt (a wrapped `Map.prototype.get`, in this test browser only);
  * every run refusal as it is created (`err.guard` / `err.message`: a `guard` setter on `Error.prototype`), every
    run-half state (`__runHalf`) and every withheld payload's reason (a wrapped `Object.defineProperty`);
  * every /api/bars request, response status and `requestfailed`;
  * whether the rating label is drawn at +15 / +45 / +90 s (a `fillText` hook) and whether a refusal note shows.

WRITES, and only these (every other non-GET to /api/ is ABORTED and logged): POST /api/user-definitions (the one
library row the first step creates through the member door), POST /api/user-definitions/runtime-admission (stores
nothing), and DELETE /api/user-definitions/<that row's id> at the end. The account must be smoke@ (the rig's admin
automation account); anything else stops the run.

Usage (the rig profile is passed, never discovered: a wrong default is a signed-out profile):
    python tools/rs_library_load_probe.py --profile <rig profile dir> [--loads 3] [--out <dir>]
    UCT_Q1_RIG_PROFILE=<dir> python tools/rs_library_load_probe.py
    python tools/rs_library_load_probe.py --self-check      # the write gate, no browser
Exit: 0 measured (whatever it measured), 2 could not measure (no profile, not smoke@, the door did not open).
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import pathlib
import sys
import time

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROD = "https://uctintelligence.com"
SRC = ROOT / "docs" / "pine" / "rs-rating" / "rs-rating-fred6724__pziQwiT2.pine"
SMOKE = "smoke@uctintelligence.internal"
PROFILE_ENV = "UCT_Q1_RIG_PROFILE"
STORE_KEYS = ("SEED_FRED6725_RS_RATING:RSRATING", "SPX")
ALLOWED_WRITES = {("POST", "/api/user-definitions"), ("POST", "/api/user-definitions/runtime-admission")}


def write_allowed(method: str, path: str, delete_id: str | None) -> bool:
    """THE WRITE GATE: a non-GET to /api/ passes only if it is one of the three this tool makes."""
    if method == "GET" or not path.startswith("/api/"):
        return True
    if (method, path) in ALLOWED_WRITES:
        return True
    return bool(delete_id) and method == "DELETE" and path == f"/api/user-definitions/{delete_id}"


HOOKS = r"""(() => {
  const KEYS = new Set(%KEYS%); window.__rsReads = []; window.__rsRun = []; let last = {};
  const og = Map.prototype.get;
  Map.prototype.get = function (k) { const v = og.call(this, k);
    if (typeof k === 'string' && KEYS.has(k) && v && typeof v === 'object' && 'status' in v) { try {
      const sig = `${v.status}|${Array.isArray(v.bars) ? v.bars.length : 'nobars'}|${v.retryAt || ''}`;
      if (last[k] !== sig) { last[k] = sig; window.__rsReads.push([Math.round(performance.now()), k, sig]) } } catch (e) {} }
    return v };
  const push = (r) => { try { if (window.__rsRun.length < 400) window.__rsRun.push([Math.round(performance.now()), ...r]) } catch (e) {} };
  Object.defineProperty(Error.prototype, 'guard', { configurable: true,
    set(v) { push(['ERR', String(v), String(this.message || '').slice(0, 300)]);
             Object.defineProperty(this, 'guard', { value: v, writable: true, configurable: true, enumerable: true }) },
    get() { return undefined } });
  const odp = Object.defineProperty;
  Object.defineProperty = function (o, p, d) {
    try { if (p === '__runHalf' && d && d.value) push(['RUNHALF', d.value.state, d.value.code]);
          else if (p === '__runtimeObjects' && d && d.value && d.value.status === 'WITHHELD') push(['WITHHELD', d.value.guard, String(d.value.reason || '').slice(0, 300), d.value.pending === true]) } catch (e) {}
    return odp.call(this, o, p, d) };
  const P = CanvasRenderingContext2D.prototype; const ft = P.fillText; window.__rsDrawn = new Set();
  P.fillText = function (t, ...r) { try { const s = String(t); if (/RS Rating|^\s+\d{1,3}$/.test(s)) window.__rsDrawn.add(s.trim()) } catch (e) {}
    return ft.call(this, t, ...r) };
})()""".replace("%KEYS%", json.dumps(list(STORE_KEYS)))

NOTE = """() => { const t = document.body.innerText; const i = t.indexOf("The complete set of this script's drawings");
  return i >= 0 ? t.slice(i, i + 200) : null }"""
ME = """async () => { const r = await fetch('/api/auth/me', {credentials: 'include', cache: 'no-store'}); const b = await r.json();
  const u = b.user && typeof b.user === 'object' ? b.user : b; return String(u.email || '').toLowerCase() }"""
DEFS = """async () => { const b = await (await fetch('/api/user-definitions', {credentials: 'include', cache: 'no-store'})).json();
  return (b.definitions || []).map((d) => ({ id: d.def_id || d.id })) }"""
_BY = """const by = (re) => [...document.querySelectorAll('button,[role="tab"]')].find(b => re.test((b.getAttribute('aria-label') || b.textContent || '').trim()));
  const step = (ms, f) => new Promise((r) => setTimeout(() => r(f()), ms));"""
DOOR = "() => { " + _BY + """
  return (async () => {
    by(/^Chart settings$/).click()
    await step(1100, () => by(/^Indicators$/).click())
    await step(1100, () => by(/^Add indicator$/).click())
    await step(1400, () => by(/Create indicator$/).click())
    const paste = await step(1600, () => { const p = [...document.querySelectorAll('button,[role="button"],a')].find(b => /^Paste a script/.test((b.textContent || '').trim())); if (p) p.click(); return !!p })
    return { paste, textarea: await step(1400, () => !!document.querySelector('[data-testid="pine-box"] textarea')) }
  })() }"""
LIBRARY = "() => { " + _BY + """
  return (async () => {
    by(/^Chart settings$/).click()
    await step(1100, () => by(/^Indicators$/).click())
    await step(1100, () => by(/^Add indicator$/).click())
    await step(1400, () => { const y = by(/^Your indicators$/); if (y) y.click() })
    return await step(1400, () => { const p = [...document.querySelectorAll('button,[role="button"],[role="option"],li')].filter(b => /^RS Rating/.test((b.textContent || '').trim())).pop(); if (p) p.click(); return !!p })
  })() }"""


class NotSmoke(Exception):
    pass


BEACON_PATHS = ("/api/pine-runtime-telemetry/run-half",)


class Session:
    def __init__(self, pw, profile, flow, log, beacons, delete_id=None, instrument=False):
        self.t0, self.flow, self.log, self.bars, self.created = time.time(), flow, log, [], None
        self.ctx = pw.chromium.launch_persistent_context(str(profile), headless=True, channel="chrome",
                                                         viewport={"width": 1440, "height": 900}, service_workers="block")

        def on_route(route):
            r = route.request
            path = r.url[len(PROD):].split("?")[0] if r.url.startswith(PROD) else ""
            ok = write_allowed(r.method, path, delete_id)
            if r.method != "GET" and path.startswith("/api/"):
                log.append((flow, "ALLOWED" if ok else "ABORTED", r.method, path))
                if path in BEACON_PATHS or path.endswith("/status-headline"):
                    # the product's own refusal/headline beacons: ABORTED (a write), their payload kept as evidence
                    beacons.append((flow, round(time.time() - self.t0, 1), path, (r.post_data or "")[:600]))
            return route.continue_() if ok else route.abort()

        self.ctx.route("**/*", on_route)
        if instrument:
            self.ctx.add_init_script(HOOKS)
        self.page = self.ctx.pages[0] if self.ctx.pages else self.ctx.new_page()

        def stamp():
            return round(time.time() - self.t0, 1)

        def on_req(r):
            if "/api/bars/" in r.url:
                self.bars.append((stamp(), "REQ", r.url[len(PROD):][:90]))

        def on_failed(r):
            if "/api/bars/" in r.url:
                self.bars.append((stamp(), "FAILED", r.url[len(PROD):][:90], str(r.failure)[:80]))

        def on_resp(r):
            if "/api/bars/" in r.url:
                self.bars.append((stamp(), r.status, r.url[len(PROD):][:90]))
            if r.url == PROD + "/api/user-definitions" and r.request.method == "POST":
                try:
                    b = r.json()
                    self.created = b.get("def_id") or b.get("id") or (b.get("definition") or {}).get("id")
                except Exception:  # noqa: BLE001
                    pass

        self.page.on("request", on_req)
        self.page.on("requestfailed", on_failed)
        self.page.on("response", on_resp)
        self.page.goto(PROD + "/charts", wait_until="domcontentloaded")
        self.page.wait_for_timeout(9000)
        who = self.page.evaluate(ME)
        if who != SMOKE:  # every session, not only the first: the profile is the only thing that decides who acts
            self.ctx.close()
            raise NotSmoke(who.split("@")[-1] or "signed out")

    def close(self):
        self.ctx.close()


def measure(profile: pathlib.Path, loads: int, out: pathlib.Path) -> int:
    from playwright.sync_api import sync_playwright
    src = SRC.read_text(encoding="utf-8")
    want = hashlib.sha256(src.encode("utf-8")).hexdigest()
    log, beacons, report = [], [], {"loads": []}
    with sync_playwright() as pw:
        try:
            s = Session(pw, profile, "door", log, beacons)
        except NotSmoke as e:
            print(f"STOP: the profile is not signed in as smoke@ ({e})")
            return 2
        report["libraryBefore"] = s.page.evaluate(DEFS)
        door = s.page.evaluate(DOOR)
        if not door.get("textarea"):
            print("STOP: the member door did not open", door)
            s.close()
            return 2
        got = s.page.evaluate("""async (src) => { const ta = document.querySelector('[data-testid="pine-box"] textarea');
          Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(ta, src);
          ta.dispatchEvent(new Event('input', { bubbles: true }));
          const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ta.value));
          return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('') }""", src)
        s.page.wait_for_selector('[data-testid="pine-member-pane-attach"]', timeout=45000)
        s.page.wait_for_timeout(4000)
        s.page.evaluate("""() => { const b = document.querySelector('[data-testid="pine-member-pane-attach"] button'); if (b) b.click() }""")
        s.page.wait_for_timeout(6000)
        created = s.created
        report["door"] = {"sourceShaMatches": got == want, "created": created}
        s.close()
        try:
            for k in range(1, loads + 1):
                s = Session(pw, profile, f"load{k}", log, beacons, instrument=True)
                picked = s.page.evaluate(LIBRARY)
                s.page.keyboard.press("Escape")
                samples = []
                for wait_s in (15, 45, 90):
                    while time.time() - s.t0 < 14 + wait_s:
                        s.page.wait_for_timeout(1000)
                    samples.append({"t": wait_s, "refusalNote": s.page.evaluate(NOTE),
                                    "drawn": sorted(s.page.evaluate("() => [...(window.__rsDrawn || [])]"))})
                report["loads"].append({"load": k, "picked": picked, "samples": samples, "bars": s.bars,
                                        "storeReads": s.page.evaluate("() => window.__rsReads || []"),
                                        "runEvents": s.page.evaluate("() => window.__rsRun || []")})
                s.close()
        finally:
            if created:
                s = Session(pw, profile, "cleanup", log, beacons, delete_id=created)
                st = s.page.evaluate("async (id) => (await fetch('/api/user-definitions/' + id, {method: 'DELETE', credentials: 'include'})).status", created)
                report["cleanup"] = {"deleted": created, "status": st, "libraryAfter": s.page.evaluate(DEFS)}
                s.close()
    time.sleep(1)
    report["singletonLockAfterClose"] = (pathlib.Path(profile) / "SingletonLock").exists()
    report["writes"], report["beacons"] = log, beacons
    out.mkdir(parents=True, exist_ok=True)
    (out / "rs-library-load.json").write_text(json.dumps(report, indent=1), encoding="utf-8")
    for ld in report["loads"]:
        last = ld["samples"][-1]
        print(f"load {ld['load']}: picked={ld['picked']} drawn@90s={last['drawn']} refusal@90s={bool(last['refusalNote'])} "
              f"refusals={[e for e in ld['runEvents'] if e[1] == 'RUNHALF' and e[2] == 'refused']}")
    print(f"beacons: {len(beacons)}  {[b[2] for b in beacons]}")
    print(f"report: {out / 'rs-library-load.json'}  cleanup: {report.get('cleanup')}  "
          f"SingletonLock after close: {report['singletonLockAfterClose']}")
    return 0


def self_check() -> int:
    cases = [(("GET", "/api/bars/SPX", None), True), (("POST", "/api/user-definitions", None), True),
             (("POST", "/api/user-definitions/runtime-admission", None), True), (("POST", "/api/auth/preferences", None), False),
             (("DELETE", "/api/user-definitions/u_x", None), False), (("DELETE", "/api/user-definitions/u_x", "u_x"), True),
             (("DELETE", "/api/user-definitions/u_y", "u_x"), False), (("PUT", "/api/user-definitions/u_x", "u_x"), False)]
    def misses(gate):
        return [c for c, want in cases if gate(*c) is not want]

    bad = misses(write_allowed)
    # the control: a gate that lets every write through, and one that blocks every write, must each FAIL this table
    blind = [name for name, gate in (("allow-all", lambda *_: True), ("deny-all", lambda m, *_: m == "GET")) if not misses(gate)]
    ok = not bad and not blind
    print("self-check: PASS" if ok else f"self-check: FAIL gate={bad} table-cannot-see={blind}")
    return 0 if ok else 1


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--profile", default=os.environ.get(PROFILE_ENV))
    ap.add_argument("--loads", type=int, default=3)
    ap.add_argument("--out", default=None)
    ap.add_argument("--self-check", action="store_true")
    a = ap.parse_args(argv)
    if a.self_check:
        return self_check()
    if not a.profile:
        print(f"STOP: pass --profile or set {PROFILE_ENV} to the rig profile (it is never discovered)")
        return 2
    out = pathlib.Path(a.out) if a.out else pathlib.Path.cwd() / f"rs-library-load-{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}"
    try:
        return measure(pathlib.Path(a.profile), max(1, a.loads), out)
    except NotSmoke as e:
        print(f"STOP: a session was not signed in as smoke@ ({e})")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
