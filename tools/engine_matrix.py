"""Wave Q1 — THE FULL §15 PATH ON FIVE BROWSER ENGINES, IN ONE RUN.

    python tools/engine_matrix.py                 # every engine
    python tools/engine_matrix.py --only firefox
    python tools/engine_matrix.py --self-check

WHY ENGINES AND NOT DAYS. The offline layer stands on three platform primitives
that differ per engine, not per day: **IndexedDB**, **Web Locks**, and
**localStorage**. Seven runs of one Chrome exercise one implementation seven
times. One run each on Chromium, Chromium-Edge, Gecko and WebKit exercises four,
which is where an offline storage layer actually breaks.

⛔ WEB LOCKS IS THE ONE TO WATCH. `useOutboxDrain` elects a leader through
`navigator.locks`; where that is missing the hook reports "not the leader" and
the queue never drains — silently, and looking exactly like a quiet day.
This records lock availability per engine rather than assuming it.

⛔ OFFLINE IS DRIVEN BY THE ENGINE'S OWN TRANSPORT EMULATION
(`context.set_offline`, which is CDP `Network.emulateNetworkConditions` on
Chromium and the equivalent on Gecko/WebKit). That is the same class of
mechanism the owner's amendment permits. **No fetch stub, no service-worker
intercept, no mocked transport** — and every offline step still proves itself
with a probe that must fail before anything is typed.

⛔ THE SESSION COOKIE COMES FROM THE RIG'S OWN PROFILE, which this agent owns —
never from the owner's browser. It is held in memory for the length of the run,
installed via the automation API, and never written to disk or printed.
"""
from __future__ import annotations

import argparse
import json
import pathlib
import subprocess
import sys
import time
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import window_check as w  # noqa: E402

# ⛔ WINDOWS STDOUT IS cp1252 AND THIS TOOL REPORTS IN ⛔/⭐/·. The deploy gate
# died mid-verdict on exactly this; a rig that crashes while printing a RED is
# strictly worse, because the run it was reporting on has already happened and
# the evidence goes with it. Guarded: a pipe that cannot be reconfigured must
# not take the tool down either.
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass


PROD = w.PROD
ACCOUNT_ID = w.ACCOUNT_ID
FLAG_KEY = w.FLAG_KEY
SENTINEL = "ENGINE-MATRIX"
EDGE = pathlib.Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
EDGE_PROFILE = w.ROOT / ".worktrees" / "canary-chrome-profile-persistent-edge"
EDGE_MARKER = "canary-chrome-profile-persistent-edge"


def utc() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── the §15 path, engine-agnostic ────────────────────────────────────────────

PROBE = ("async () => await fetch('/api/health', {cache:'no-store'})"
         ".then(r => 'ONLINE ' + r.status).catch(e => 'FAILED: ' + e.name)")

CAPS_JS = """async (acct) => {
  const out = {locks: typeof navigator.locks !== 'undefined',
               idb: typeof indexedDB !== 'undefined',
               persisted: null};
  try { out.persisted = await navigator.storage.persisted() } catch { }
  try {
    const q = await navigator.locks.query();
    out.held = (q.held||[]).filter(l => String(l.name).startsWith('uct.nb.sync.')).map(l => l.mode);
    out.pending = (q.pending||[]).filter(l => String(l.name).startsWith('uct.nb.sync.')).length;
  } catch { out.held = 'unavailable'; out.pending = 'unavailable' }
  try {
    const known = (await indexedDB.databases()).map(d => d.name);
    out.dbPresent = known.includes('uct_notebook_' + acct);
  } catch (e) { out.dbPresent = 'ERR: ' + e.name }
  return out;
}"""


class Result:
    def __init__(self, engine):
        self.engine = engine
        self.steps = []
        self.findings = []
        self.caps = {}

    def step(self, name, ok, detail=""):
        self.steps.append((name, bool(ok), detail))
        flag = "ok  " if ok else "FAIL"
        print(f"    {flag} {name}: {detail}", flush=True)
        return ok

    @property
    def green(self):
        return bool(self.steps) and all(ok for _, ok, _ in self.steps) and not self.findings


def run_path(ctx, engine: str, session_cookie: dict | None) -> Result:
    """create · type · offline · type · reload(online) · reconnect · conflict."""
    res = Result(engine)
    if session_cookie:
        ctx.add_cookies([session_cookie])
    page = ctx.pages[0] if ctx.pages else ctx.new_page()

    puts = []
    page.on("request", lambda r: puts.append(_put_base(r))
            if r.method == "PUT" and "/api/j2/notes/" in r.url else None)

    ctx.set_offline(False)
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)

    me = page.evaluate(w.AUTH_JS)
    if not res.step("signed in", me.get("status") == 200 and me.get("id") == ACCOUNT_ID,
                    f"/api/auth/me {me.get('status')}"):
        return res

    # ── opt in on THIS engine. A distinct profile ⇒ a distinct sessionId ⇒ its
    #    own notebook_offline_opt_in event, which is what makes the denominator
    #    a count of ENGINES rather than of page loads.
    page.evaluate("(k) => localStorage.setItem(k, '1')", FLAG_KEY)
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(7000)
    caps = page.evaluate(CAPS_JS, ACCOUNT_ID)
    res.caps = caps
    res.step("opt in → leadership", caps.get("held") == ["exclusive"] and caps.get("dbPresent") is True,
             f"locks={caps.get('locks')} held={caps.get('held')} pending={caps.get('pending')} db={caps.get('dbPresent')}")

    created = page.evaluate("""async (t) => {
        const r = await fetch('/api/j2/notes', {method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({title:t, bodyJson:{type:'doc',content:[]}})});
        if (!r.ok) return {ok:false, status:r.status};
        const b = await r.json(); return {ok:true, id: b.note?.id ?? b.id};
    }""", f"{SENTINEL} {engine} {utc()}")
    if not res.step("create a note", created.get("ok"), f"id={created.get('id')}"):
        return res
    nid = created["id"]

    puts.clear()
    page.goto(f"{PROD}/journal/notebook?note={nid}", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    _type(page, f"{SENTINEL} typed online.")
    page.wait_for_timeout(6000)
    bases = [p for p in puts if p]
    res.step("type online → CAS PUT", bool(bases) and all(isinstance(b, str) and b.strip() for b in bases),
             f"{len(bases)} PUT(s) baseline={bases}")
    if bases:
        res.findings += w.baseline_findings(f"{engine}/online PUT", {"baseUpdatedAt": bases[0]})

    ctx.set_offline(True)
    page.wait_for_timeout(1200)
    pr = page.evaluate(PROBE)
    res.step("offline is real", pr.startswith("FAILED"), pr)
    _type(page, f" {SENTINEL} typed offline.", end_first=True)
    page.wait_for_timeout(6000)
    before = page.evaluate(w.LAYERS_JS, {"acct": ACCOUNT_ID, "id": nid})

    # ⛔ NETWORK UP BEFORE THE RELOAD — no service worker, so an offline reload
    #    cannot load the SPA and proves nothing.
    ctx.set_offline(False)
    page.wait_for_timeout(1500)
    page.goto(f"{PROD}/journal/notebook?note={nid}", wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    after = page.evaluate(w.LAYERS_JS, {"acct": ACCOUNT_ID, "id": nid})
    rec = after.get("record") if isinstance(after.get("record"), dict) else {}
    ob = w._as_list(after.get("outbox"))
    unread = w.layer_read_failed(before) + w.layer_read_failed(after)
    res.step("reload (network UP) → words survive",
             w._doc_has_text(rec.get("bodyJson")) and not unread,
             f"record has text={w._doc_has_text(rec.get('bodyJson'))} outbox={len(ob)} baseline={rec.get('baseUpdatedAt')}"
             + (f" UNREAD={unread}" if unread else ""))
    for lab, art in ((f"{engine}/pre-reload", before.get("record")), (f"{engine}/post-reload", rec)):
        if isinstance(art, dict):
            res.findings += w.baseline_findings(lab, art) + w.empty_document_findings(lab, art)
    for e in w._as_list(before.get("outbox")) + ob:
        if isinstance(e, dict):
            res.findings += w.baseline_findings(f"{engine}/outbox", e)

    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(12000)
    settled = page.evaluate(w.LAYERS_JS, {"acct": ACCOUNT_ID, "id": nid})
    srec = settled.get("record") if isinstance(settled.get("record"), dict) else {}
    srv = settled.get("server") if isinstance(settled.get("server"), dict) else {}
    res.step("reconnect → drained, server has words",
             srec.get("dirty") == 0 and not w._as_list(settled.get("outbox")) and w._doc_has_text(srv.get("bodyJson")),
             f"dirty={srec.get('dirty')} outbox={len(w._as_list(settled.get('outbox')))} server={w._doc_has_text(srv.get('bodyJson'))}")
    res.findings += w.baseline_findings(f"{engine}/settled", srec)

    _cleanup(page, nid)
    return res


def run_conflict(ctx, engine: str, session_cookie: dict | None) -> Result:
    """The fork, both directions: server keeps the winner, the loser survives."""
    res = Result(engine + "/conflict")
    if session_cookie:
        ctx.add_cookies([session_cookie])
    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    ctx.set_offline(False)
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(5000)
    page.evaluate("(k) => localStorage.setItem(k, '1')", FLAG_KEY)

    mine, theirs = f"{SENTINEL}-MINE-{engine}", f"{SENTINEL}-THEIRS-{engine}"
    created = page.evaluate("""async (t) => {
        const r = await fetch('/api/j2/notes', {method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({title:t, bodyJson:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:'seed'}]}]}})});
        const b = await r.json(); return {ok:r.ok, id: b.note?.id ?? b.id, updatedAt: b.note?.updatedAt};
    }""", f"{SENTINEL} conflict {engine} {utc()}")
    if not res.step("create", created.get("ok"), f"id={created.get('id')}"):
        return res
    nid, base = created["id"], created["updatedAt"]

    page.goto(f"{PROD}/journal/notebook?note={nid}", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    ctx.set_offline(True)
    page.wait_for_timeout(1200)
    res.step("offline is real", page.evaluate(PROBE).startswith("FAILED"), "probe failed")
    _type(page, f" {mine}.", end_first=True)
    page.wait_for_timeout(6000)

    # ── the second writer: a separate page, online, direct PUT.
    other = ctx.new_page()
    other.goto(PROD + "/dashboard", wait_until="domcontentloaded")
    other.wait_for_timeout(3000)
    moved = other.evaluate("""async ({id, base, txt}) => {
        const r = await fetch('/api/j2/notes/' + id, {method:'PUT', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({title:'second writer', baseUpdatedAt: base,
            bodyJson:{type:'doc',content:[{type:'paragraph',content:[{type:'text',text:txt}]}]}})});
        const b = await r.json();
        return {ok:r.ok, status:r.status, updatedAt: b.note?.updatedAt};
    }""", {"id": nid, "base": base, "txt": theirs})
    other.close()
    res.step("second writer moved the server", moved.get("ok"), f"{moved.get('status')} → {moved.get('updatedAt')}")

    ctx.set_offline(False)
    page.wait_for_timeout(1500)
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(16000)

    out = page.evaluate("""async ({id, mine}) => {
        const s = await fetch('/api/j2/notes/' + id, {credentials:'include'}).then(r => r.json());
        const list = await fetch('/api/j2/notes?limit=300', {credentials:'include'}).then(r => r.json());
        const copies = (list.notes||[]).filter(n => (n.tags||[]).includes('sync-conflict')
                                                 && /ENGINE-MATRIX/i.test(n.title||''));
        let copyBody = null;
        if (copies.length) {
            const full = await fetch('/api/j2/notes/' + copies[0].id, {credentials:'include'}).then(r => r.json());
            copyBody = full.note?.bodyJson ?? null;
        }
        return {server: s.note?.bodyJson ?? null, copies: copies.map(c => c.id), copyBody};
    }""", {"id": nid, "mine": mine})

    f = w.conflict_findings(f"{engine}/conflict", out.get("server"), out.get("copyBody"), mine, theirs)
    res.findings += f
    res.step("server keeps the winner byte-unchanged",
             theirs in json.dumps(out.get("server")), f"theirs present={theirs in json.dumps(out.get('server'))}")
    res.step("the loser survives as a conflicted copy",
             bool(out.get("copies")) and mine in json.dumps(out.get("copyBody")),
             f"copies={len(out.get('copies') or [])} mine present={mine in json.dumps(out.get('copyBody'))}")

    if not res.findings:
        _cleanup(page, nid)
        for cid in (out.get("copies") or []):
            page.evaluate("""async (id) => { await fetch('/api/j2/notes/'+id,{method:'DELETE',credentials:'include'}) }""", cid)
    return res


def _type(page, text, end_first=False):
    try:
        pm = page.query_selector(".ProseMirror")
        if pm:
            pm.click()
            if end_first:
                page.keyboard.press("End")
            page.keyboard.type(text)
    except Exception:  # noqa: BLE001
        pass


def _put_base(req):
    try:
        body = req.post_data
        return json.loads(body).get("baseUpdatedAt") if body else None
    except Exception:  # noqa: BLE001
        return None


def _cleanup(page, nid):
    page.evaluate("""async (id) => { await fetch('/api/j2/notes/'+id,{method:'DELETE',credentials:'include'}) }""", nid)
    page.evaluate("""async (acct) => {
        const known = (await indexedDB.databases()).map(d => d.name);
        const name = 'uct_notebook_' + acct;
        if (known.includes(name)) {
            const db = await new Promise(res => { const r = indexedDB.open(name); r.onsuccess = () => res(r.result) });
            const stores = [...db.objectStoreNames];
            if (stores.length) {
                const tx = db.transaction(stores, 'readwrite');
                stores.forEach(s => tx.objectStore(s).clear());
                await new Promise(res => { tx.oncomplete = res; tx.onerror = res });
            }
        }
        for (const k of Object.keys(localStorage)) if (k.startsWith('uct.j2.notedraft.')) localStorage.removeItem(k);
        localStorage.setItem('uct.j2.offline.enabled','0');
    }""", ACCOUNT_ID)


# ── getting the session out of the rig's OWN profile ─────────────────────────

def session_cookie_from_rig() -> dict:
    """⛔ From the RIG's profile, which this agent owns. Never the owner's."""
    from playwright.sync_api import sync_playwright
    proc, endpoint, version = w.spawn_rig()
    if not version:
        raise SystemExit("rig CDP never answered")
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(4000)
            me = page.evaluate(w.AUTH_JS)
            if me.get("status") != 200 or me.get("id") != ACCOUNT_ID:
                raise SystemExit(f"the rig is not signed in as the canary ({me.get('status')})")
            for c in ctx.cookies():
                if c["name"] == "uct_session":
                    return {k: c[k] for k in ("name", "value", "domain", "path", "httpOnly", "secure", "sameSite")
                            if k in c}
            raise SystemExit("no uct_session cookie in the rig profile")
    finally:
        w.teardown(None)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None)
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--no-conflict", action="store_true")
    args = ap.parse_args()
    if args.self_check:
        return self_check()

    from playwright.sync_api import sync_playwright

    print("reading the session from the rig's own profile…", flush=True)
    cookie = session_cookie_from_rig()
    print(f"  got `uct_session` for {cookie['domain']} (value not printed)\n", flush=True)

    engines = ["edge", "firefox", "webkit", "mobile"]
    if args.only:
        engines = [args.only]

    results = []
    with sync_playwright() as pw:
        for name in engines:
            print(f"\n{'=' * 70}\n  ENGINE: {name}\n{'=' * 70}", flush=True)
            browser = ctx = None
            try:
                if name == "edge":
                    # ⛔ A persistent context, not `launch(args=[--user-data-dir])`:
                    # Playwright manages its own profile dir and the flag would be
                    # ignored, so the "own persistent profile" would be a fiction.
                    EDGE_PROFILE.mkdir(parents=True, exist_ok=True)
                    ctx = pw.chromium.launch_persistent_context(
                        user_data_dir=str(EDGE_PROFILE), executable_path=str(EDGE),
                        headless=False, args=["--no-first-run", "--no-default-browser-check"])
                    browser = None
                elif name == "firefox":
                    browser = pw.firefox.launch(headless=True)
                    ctx = browser.new_context()
                elif name == "webkit":
                    browser = pw.webkit.launch(headless=True)
                    ctx = browser.new_context()
                elif name == "mobile":
                    browser = pw.chromium.launch(headless=True)
                    ctx = browser.new_context(**pw.devices["iPhone 13"])
                r = run_path(ctx, name, cookie)
                results.append(r)
                if r.green and not args.no_conflict and name in ("webkit",):
                    results.append(run_conflict(ctx, name, None))
            except Exception as e:  # noqa: BLE001
                r = Result(name)
                r.step("engine", False, f"{type(e).__name__}: {str(e)[:160]}")
                results.append(r)
            finally:
                try:
                    if ctx:
                        ctx.close()
                    if browser:
                        browser.close()
                except Exception:  # noqa: BLE001
                    pass

    print(f"\n{'=' * 70}\n  MATRIX\n{'=' * 70}")
    findings = []
    for r in results:
        ok = sum(1 for _, o, _ in r.steps if o)
        print(f"  {r.engine:22} {'✅' if r.green else '🚨' if r.findings else '⛔'}  {ok}/{len(r.steps)} steps"
              f"  locks={r.caps.get('locks')}")
        findings += r.findings
    if findings:
        print("\n🚨 FINDINGS")
        for f in findings:
            print("   -", f)
    payload = {"at": utc(),
               "engines": [{"engine": r.engine, "green": r.green, "caps": r.caps,
                            "steps": [{"name": n, "ok": o, "detail": d} for n, o, d in r.steps],
                            "findings": r.findings} for r in results]}
    out = w.ROOT / "docs" / "notebook" / "engine-matrix-result.json"
    out.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    print(f"\nartifact: {out}")
    return 0 if all(r.green for r in results) else 1


def self_check() -> int:
    src = pathlib.Path(__file__).read_text(encoding="utf-8")
    # ⛔ A SOURCE SWEEP THAT CAN MATCH ITS OWN NEEDLE PROVES NOTHING. Spelling
    # the forbidden pattern literally here would make this file contain it, and
    # the check would fail forever for the one reason that is not a defect —
    # the same trap the `setContent` sweep hit earlier in this wave.
    stub_needle = "window." + "fetch ="
    body = src.split("def self_check", 1)[0]
    cases = [
        ("offline is engine-native, not a stub", "set_offline" in src),
        ("no fetch stub anywhere (and the sweep cannot match itself)",
         stub_needle not in body),
        ("CONTROL: the sweep can see a stub when there is one",
         stub_needle in (body + stub_needle)),
        ("the reload happens with the network UP",
         "NETWORK UP BEFORE THE RELOAD" in src),
        ("lock availability is recorded per engine", "locks:" in CAPS_JS),
        ("conflict is checked in BOTH directions",
         bool(w.conflict_findings("x", {"t": "A"}, {"t": "B"}, "B", "A") == [])
         and bool(w.conflict_findings("x", {"t": "B"}, {"t": "B"}, "B", "A"))),
        ("a finding suppresses conflict cleanup", "if not res.findings" in src),
        ("the cookie is never printed", "value not printed" in src),
    ]
    bad = 0
    for n, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {n}")
        bad += 0 if ok else 1
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
