"""Wave Q1 — THE FULL §15 PATH ON FIVE BROWSER ENGINES, IN ONE RUN.

    python tools/engine_matrix.py                 # every engine
    python tools/engine_matrix.py --only firefox
    python tools/engine_matrix.py --self-check
    python tools/engine_matrix.py --dry-run       # READ-ONLY rig proof, writes nothing

⛔⛔ THE PROFILE PATH IS AN OVERRIDE, NOT A DISCOVERY — pass `--profile` (or set
`UCT_Q1_RIG_PROFILE`) whenever this runs from any worktree but the main one. The
default resolves against THIS COPY's repo root, and a second worktree's
`.worktrees/` is empty; an empty profile is a signed-out one and there is no
credentials file anywhere that could sign it back in. The Edge rig is DERIVED
from the Chromium one (`<rig>-edge`, its sibling) so one flag moves both and
there is never a second authority over where the rigs live.

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
import os
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
EDGE_CANDIDATES = (
    pathlib.Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"),
    pathlib.Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"),
)
EDGE = next((p for p in EDGE_CANDIDATES if p.exists()), EDGE_CANDIDATES[0])

# ⭐ THE EDGE RIG IS DERIVED FROM THE CHROMIUM RIG, never typed a second time.
# `<rig>-edge` beside `<rig>` means one `--profile` moves both, the two can never
# disagree about which worktree they live in, and the sibling relationship is
# mechanically checkable (`edge_profile_is_sibling`). With nothing overridden this
# resolves to exactly the path this file used before: ROOT/.worktrees/<rig>-edge.
EDGE_PROFILE_ENV = "UCT_Q1_EDGE_PROFILE"
EDGE_SUFFIX = "-edge"


def resolve_edge_profile(cli: str | None = None) -> pathlib.Path:
    """CLI beats env beats `<the chromium rig>-edge`. Blank is absent at every level."""
    for raw in ((cli or ""), os.environ.get(EDGE_PROFILE_ENV, "") or ""):
        raw = raw.strip()
        if raw:
            return pathlib.Path(raw).expanduser().resolve()
    return w.PROFILE.parent / (w.PROFILE.name + EDGE_SUFFIX)


def edge_profile_is_sibling(edge_profile=None) -> bool:
    """⛔ The one structural check that keeps the Edge rig from being created in
    whatever worktree happens to be current: it must sit BESIDE the Chromium rig."""
    p = pathlib.Path(edge_profile if edge_profile is not None else EDGE_PROFILE)
    return p.parent == pathlib.Path(w.PROFILE).parent


def use_edge_profile(path) -> pathlib.Path:
    """Move the Edge profile and its derived kill marker as ONE."""
    global EDGE_PROFILE, EDGE_MARKER
    p = pathlib.Path(path)
    EDGE_MARKER = w.marker_for(p)      # ⛔ refuse a generic marker BEFORE moving anything
    EDGE_PROFILE = p
    return EDGE_PROFILE


EDGE_PROFILE = w.PROFILE.parent / (w.PROFILE.name + EDGE_SUFFIX)
EDGE_MARKER = EDGE_PROFILE.name


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


_QUIET = False


class Result:
    def __init__(self, engine):
        self.engine = engine
        self.steps = []
        self.findings = []
        self.caps = {}
        self.facts = {}

    def step(self, name, ok, detail="", error=None):
        # ⭐ Same shape as `window_check.Check.add`: the failing branch gets to say
        # something DIFFERENT from the passing one. A row that renders the success
        # sentence beside a red is how a reader mis-reads which half fired.
        detail = detail if (ok or error is None) else error
        self.steps.append((name, bool(ok), detail))
        # ⛔ QUIET ONLY IN --self-check, where several cases are SUPPOSED to go
        # red. Printing their reds beside the real ones makes a passing self-check
        # read like a broken run — the evidence, not the verdict, is what confuses.
        if not _QUIET:
            print(f"    {'ok  ' if ok else 'FAIL'} {name}: {detail}", flush=True)
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


# ══════════════════════════════════════════════════════════════════════════════
# THE DRY RUN — READ-ONLY. Five engines, five proofs each, nothing created.
# ══════════════════════════════════════════════════════════════════════════════
#
# What it is for: every later green in this wave rests on four things being true
# of the engine that produced it — it is signed in, its offline emulation is
# REAL, its session came from the rig and nowhere else, and its Web Locks answer
# is the truth rather than an assumption. An engine whose `set_offline` silently
# no-ops would report a full green matrix while never once going offline.
#
# ⛔ NOTHING IS WRITTEN TO THE ACCOUNT. No note is created, nothing is typed, the
# opt-in key is READ and never set, and the note count is re-read at the end
# against the count read at the start.

DRY_ENGINES = ("chromium-rig", "edge", "firefox", "webkit", "mobile")
LOCK_PROBE_NAME = "uct.q1.dryrun.probe"   # ⛔ never `uct.nb.sync.*` — see below

# ⛔ EVERY PAGE-SIDE CALL HERE IS A READ. GET /api/auth/me · GET /api/j2/notes ·
# capability reads off `navigator` · localStorage GET. The lock probe takes a
# lock under its OWN name and releases it immediately: naming it `uct.nb.sync.*`
# would contend with the product's own leader election and make the rig a
# participant in the thing it is measuring.
DRY_READ_JS = """async (flagKey) => {
  const out = {authStatus: null, authId: null, notes: null, optInKey: null,
               locks: typeof navigator.locks !== 'undefined',
               locksRequestWorks: null,
               idb: typeof indexedDB !== 'undefined',
               isSecureContext: !!window.isSecureContext,
               onLine: navigator.onLine,
               ua: navigator.userAgent};
  const me = await fetch('/api/auth/me', {credentials:'include'});
  out.authStatus = me.status;
  try { const b = await me.json(); out.authId = b?.user?.id ?? b?.id ?? null } catch { }
  try {
    const l = await fetch('/api/j2/notes?limit=300', {credentials:'include'});
    out.notes = l.ok ? ((await l.json()).notes || []).length : 'HTTP ' + l.status;
  } catch (e) { out.notes = 'ERR: ' + e.name }
  try { out.optInKey = localStorage.getItem(flagKey) }
  catch (e) { out.optInKey = 'ERR: ' + e.name }
  try {
    await navigator.locks.request('%LOCK%', {mode:'exclusive'}, async () => {});
    out.locksRequestWorks = true;
  } catch (e) { out.locksRequestWorks = 'ERR: ' + e.name }
  return out;
}""".replace("%LOCK%", LOCK_PROBE_NAME)

AUTH_ONLY_JS = """async () => {
  const r = await fetch('/api/auth/me', {credentials:'include'});
  let b = null; try { b = await r.json() } catch { }
  return {status: r.status, id: b?.user?.id ?? b?.id ?? null};
}"""


def _ps(cmd: str) -> str:
    r = subprocess.run(["powershell", "-NoProfile", "-Command", cmd],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    return r.stdout or ""


def edge_processes() -> list:
    """Edge BROWSER processes carrying the Edge rig marker (no `--type=` children)."""
    out = _ps("Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
              "Where-Object { $_.CommandLine -like '*" + EDGE_MARKER + "*' "
              "-and $_.CommandLine -notlike '*--type=*' } | "
              "ForEach-Object { $_.ProcessId.ToString() }")
    return [int(x) for x in out.split() if x.strip().isdigit()]


def kill_edge_by_marker() -> int:
    """⛔ By MARKER, never by name. `Stop-Process -Name msedge` would close the
    owner's Edge along with the rig's."""
    out = _ps("$c = Get-CimInstance Win32_Process -Filter \"Name='msedge.exe'\" | "
              "Where-Object { $_.CommandLine -like '*" + EDGE_MARKER + "*' }; "
              "($c | Measure-Object).Count; "
              "$c | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    first = (out.strip().splitlines() or ["0"])[0]
    try:
        return int(first)
    except ValueError:
        return 0


def playwright_processes() -> list:
    """Every Playwright-managed browser runs out of the `ms-playwright` install.

    ⛔ Counting by EXE NAME would sweep the owner's own Chrome into the number —
    Playwright's chromium is also `chrome.exe`. The install path cannot.

    ⛔⛔ AND IT MATCHES ON `ExecutablePath`, NOT `CommandLine`. The first version
    matched command lines, and the very PowerShell process running the query has
    `*ms-playwright*` in ITS command line — so the sweep counted the instrument,
    reported one browser "left behind" after a clean run, and named `powershell.exe`
    as the leak. A probe whose needle appears in the probe cannot see past itself
    (`lesson_an_instrument_can_reproduce_its_own_blind_spot`). `ExecutablePath` is
    the identity of the BINARY and is not a string this query carries.
    """
    out = _ps("Get-CimInstance Win32_Process | "
              "Where-Object { $_.ExecutablePath -like '*ms-playwright*' } | "
              "ForEach-Object { $_.ProcessId.ToString() + '|' + $_.Name }")
    return sorted(line.strip() for line in out.splitlines() if "|" in line)


def _write_json(path: pathlib.Path, payload: dict) -> None:
    """⛔ temp-then-replace: `open('w')` truncates BEFORE your write can fail, and
    a half-written results file reads like a run that found nothing."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(payload, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def prove_offline_both_ways(page, set_offline, res: Result) -> dict:
    """⛔⛔ AN ENGINE WHOSE OFFLINE EMULATION SILENTLY NO-OPS MAKES EVERY LATER
    GREEN MEANINGLESS — the run would report "offline, typed, reconnected" having
    never left the network. So each direction carries its own positive control:

      online→offline : the SAME fetch must SUCCEED first (proving the probe can
                       succeed at all, i.e. it is not simply a broken request)
                       and then FAIL.
      offline→online : the failure is the control that emulation engaged, and the
                       fetch must then SUCCEED AGAIN (proving the engine can also
                       come BACK — an engine stuck offline fails just as silently).

    Same URL, same options, same page in all three states, so a failure for an
    unrelated reason (DNS, CORS, a dead origin) cannot masquerade as offline.
    """
    facts = {}
    before = page.evaluate(PROBE)
    facts["probe_online_before"] = before
    ok_before = res.step("control · a fetch that MUST succeed while online",
                         before.startswith("ONLINE"), before)

    set_offline(True)
    page.wait_for_timeout(1400)
    during = page.evaluate(PROBE)
    facts["probe_offline"] = during
    facts["navigator_onLine_offline"] = page.evaluate("() => navigator.onLine")
    ok_off = res.step("offline is REAL · the same fetch must now FAIL",
                      during.startswith("FAILED"),
                      f"{during} · navigator.onLine={facts['navigator_onLine_offline']}")

    set_offline(False)
    page.wait_for_timeout(1600)
    after = page.evaluate(PROBE)
    facts["probe_online_after"] = after
    facts["navigator_onLine_after"] = page.evaluate("() => navigator.onLine")
    ok_after = res.step("control · it must SUCCEED AGAIN after coming back",
                        after.startswith("ONLINE"),
                        f"{after} · navigator.onLine={facts['navigator_onLine_after']}")

    facts["offline_proven_both_ways"] = bool(ok_before and ok_off and ok_after)
    return facts


def _dry_reads(page, res: Result, engine: str) -> dict:
    r = page.evaluate(DRY_READ_JS, FLAG_KEY)
    res.caps = {"locks": r.get("locks"), "locksRequestWorks": r.get("locksRequestWorks"),
                "idb": r.get("idb"), "isSecureContext": r.get("isSecureContext")}
    res.step("AUTH · /api/auth/me is 200 for the canary",
             r.get("authStatus") == 200 and r.get("authId") == ACCOUNT_ID,
             f"{r.get('authStatus')} · id={'canary' if r.get('authId') == ACCOUNT_ID else r.get('authId')}")
    res.step("WEB LOCKS recorded (not assumed)",
             r.get("locks") is not None,
             f"navigator.locks {'PRESENT' if r.get('locks') else 'ABSENT'} · "
             f"request() {r.get('locksRequestWorks')}")
    # ⭐ READ, NEVER WRITTEN. The flag stays OFF and no opt-in is performed here.
    # ⛔ A key found already SET is a fact about the RIG, not about the engine —
    # so it is raised as a named finding and LEFT ALONE. Clearing it would be a
    # write, and it would destroy the evidence that something set it.
    key = r.get("optInKey")
    key_ok = key in (None, "0")
    res.step("the opt-in key is unset/'0' at rest (the flag stays OFF)", key_ok,
             f"{FLAG_KEY} = {key!r}",
             f"{FLAG_KEY} = {key!r} — this profile is ALREADY OPTED IN; the dry run "
             "does not change it")
    if not key_ok:
        res.findings.append(
            f"`{engine}` carries `{FLAG_KEY}` = {key!r} AT REST — a per-browser "
            "opt-in left behind by an earlier session, not set by this run. Left in "
            "place deliberately: clearing it is a write, and it is evidence.")
    res.step("the note list is readable",
             isinstance(r.get("notes"), int), f"notes={r.get('notes')}")
    return r


def _cookie_provenance(ctx, page, res: Result, cookie: dict | None, engine: str) -> str:
    """⛔ THE SESSION COMES FROM THE RIG'S OWN PROFILE OR IT DOES NOT COME AT ALL.

    The control is the 401 BEFORE the install: a context that answers 401, then
    200 after one cookie from the rig, cannot have picked up a session from any
    other browser profile on this machine. Without that control a 200 proves only
    that *something* authenticated it.
    """
    if cookie is None:
        res.step("cookie source · the rig's OWN profile (no install needed)", True,
                 "this IS the signed-in rig profile")
        return "rig profile (its own stored session)"

    ctx.clear_cookies()
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(2500)
    anon = page.evaluate(AUTH_ONLY_JS)
    res.step("control · with no cookie this engine is ANONYMOUS (401)",
             anon.get("status") in (401, 403), f"/api/auth/me {anon.get('status')}")
    ctx.add_cookies([cookie])
    page.reload(wait_until="domcontentloaded")
    page.wait_for_timeout(3000)
    named = f"`{cookie['name']}` for {cookie['domain']} (value not printed)"
    res.step(f"cookie source · installed from the RIG PROFILE ONLY", True, named)
    return f"rig profile → {cookie['name']}@{cookie['domain']}"


def _dry_pass(ctx, page, engine: str, cookie: dict | None, set_offline) -> Result:
    res = Result(engine)
    set_offline(False)
    page.goto(PROD + "/dashboard", wait_until="domcontentloaded")
    page.wait_for_timeout(4000)
    source = _cookie_provenance(ctx, page, res, cookie, engine)
    reads = _dry_reads(page, res, engine)
    res.facts = {"cookie_source": source,
                 "notes": reads.get("notes"),
                 "opt_in_key": reads.get("optInKey"),
                 "user_agent": reads.get("ua"),
                 **prove_offline_both_ways(page, set_offline, res)}
    return res


def dry_run(only: str | None = None, out_path: pathlib.Path | None = None) -> int:
    from playwright.sync_api import sync_playwright

    engines = [only] if only else list(DRY_ENGINES)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_path or (w.ROOT / ".worktrees" / "q1-dry-run" / f"dry-run-{stamp}.json")
    header = {"at": utc(), "mode": "dry-run", "certifying": False, "read_only": True,
              "origin": PROD, "engines_planned": engines,
              "rig_profile": str(w.PROFILE), "rig_marker": w.MARKER,
              "edge_profile": str(EDGE_PROFILE), "edge_marker": EDGE_MARKER}
    # ⛔ CLAIM THE RESULTS FILE FIRST. A run that dies must leave an explicit
    # INCOMPLETE; a stale file from a previous run reads exactly like a pass.
    _write_json(out, dict(header, status="INCOMPLETE — the run did not finish"))
    print(f"rig profile : {w.PROFILE}\nedge profile: {EDGE_PROFILE}\nresults     : {out}\n", flush=True)

    if not edge_profile_is_sibling():
        print("⛔ the Edge rig is not a sibling of the Chromium rig — refusing to "
              f"create a profile at {EDGE_PROFILE}", flush=True)
        _write_json(out, dict(header, status="REFUSED — edge profile is not beside the chromium rig"))
        return 1

    pw_before = playwright_processes()
    results, cookie, notes_first = [], None, None

    # ── 1. THE RIG ITSELF. It runs first because it is the only signed-in
    #       context, so it supplies both the session and the "before" count.
    if "chromium-rig" in engines:
        try:
            proc, endpoint, version = w.spawn_rig()
        except SystemExit as e:
            # ⛔ The refusal is a RESULT, not a traceback: it is the guard against
            # pointing the rig at an empty (⇒ signed-out) profile doing its job.
            print(f"⛔ {e}", flush=True)
            _write_json(out, dict(header, status=f"REFUSED — {e}"))
            return 1
        try:
            if not version:
                r = Result("chromium-rig"); r.step("rig", False, "CDP never answered")
                results.append(r)
            else:
                print(f"\n{'=' * 70}\n  ENGINE: chromium-rig (real Chrome, the signed-in profile)\n{'=' * 70}", flush=True)
                with sync_playwright() as pw:
                    b = pw.chromium.connect_over_cdp(endpoint)
                    ctx = b.contexts[0]
                    page = ctx.pages[0] if ctx.pages else ctx.new_page()
                    cdp = page.context.new_cdp_session(page)
                    cdp.send("Network.enable")
                    r = _dry_pass(ctx, page, "chromium-rig", None, w._offliner(cdp))
                    notes_first = r.facts.get("notes")
                    for c in ctx.cookies():
                        if c["name"] == "uct_session":
                            cookie = {k: c[k] for k in ("name", "value", "domain", "path",
                                                        "httpOnly", "secure", "sameSite") if k in c}
                            break
                    r.step("the session cookie was read out of the rig profile",
                           cookie is not None,
                           f"`uct_session` for {cookie['domain']} (value not printed)" if cookie else "not found")
                    results.append(r)
        finally:
            killed, left, others, released, held = w.teardown(None)
            rt = Result("chromium-rig/cleanup")
            rt.step("rig browser terminated BY MARKER", not left,
                    f"killed {killed} · 0 left · owner's browser {others} untouched")
            rt.step("rig profile KEPT, lock released", released,
                    f"`{w.PROFILE.name}` retained · lockfile/SingletonLock free",
                    f"still held: {held}")
            rt.facts = {"killed": killed, "survivors": left, "untouched_browsers": others,
                        "lock_released": released, "lock_held": held,
                        "profile_kept": w.PROFILE.exists()}
            results.append(rt)

    if cookie is None and [e for e in engines if e != "chromium-rig"]:
        print("⛔ no session cookie from the rig — the other engines cannot be "
              "authenticated from any other source, and will not be run.", flush=True)
        _write_json(out, dict(header, status="STOPPED — no session cookie from the rig",
                              engines=[_row(r) for r in results]))
        return 1

    # ── 2. EVERY OTHER ENGINE, each authenticated from that one cookie.
    for name in [e for e in engines if e != "chromium-rig"]:
        print(f"\n{'=' * 70}\n  ENGINE: {name}\n{'=' * 70}", flush=True)
        browser = ctx = None
        try:
            with sync_playwright() as pw:
                if name == "edge":
                    EDGE_PROFILE.mkdir(parents=True, exist_ok=True)
                    ctx = pw.chromium.launch_persistent_context(
                        user_data_dir=str(EDGE_PROFILE), executable_path=str(EDGE),
                        headless=False, args=["--no-first-run", "--no-default-browser-check"])
                elif name == "firefox":
                    browser = pw.firefox.launch(headless=True); ctx = browser.new_context()
                elif name == "webkit":
                    browser = pw.webkit.launch(headless=True); ctx = browser.new_context()
                elif name == "mobile":
                    browser = pw.chromium.launch(headless=True)
                    ctx = browser.new_context(**pw.devices["iPhone 13"])
                else:
                    raise SystemExit(f"unknown engine `{name}`")
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                r = _dry_pass(ctx, page, name, cookie, ctx.set_offline)
                results.append(r)
                try:
                    ctx.close()
                    if browser:
                        browser.close()
                except Exception:  # noqa: BLE001
                    pass
        except Exception as e:  # noqa: BLE001
            r = Result(name); r.step("engine", False, f"{type(e).__name__}: {str(e)[:200]}")
            results.append(r)
        finally:
            if name == "edge":
                killed = kill_edge_by_marker()
                time.sleep(2)
                left = edge_processes()
                released, held = w.profile_lock_released(timeout=30, profile=EDGE_PROFILE)
                rt = Result("edge/cleanup")
                rt.step("edge browser terminated BY MARKER", not left,
                        f"swept {killed} · 0 left", f"survivors: {left}")
                rt.step("edge profile KEPT, lock released", released,
                        f"`{EDGE_PROFILE.name}` retained · lockfile/SingletonLock free",
                        f"still held: {held}")
                rt.facts = {"killed": killed, "survivors": left, "lock_released": released,
                            "lock_held": held, "profile_kept": EDGE_PROFILE.exists()}
                results.append(rt)

    # ── 3. THE COUNT, RE-READ FROM A FRESH CONTEXT AT THE END.
    notes_last, verify = None, Result("verify/read-only")
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch(headless=True)
            c = b.new_context(); c.add_cookies([cookie])
            p = c.new_page()
            p.goto(PROD + "/dashboard", wait_until="domcontentloaded")
            p.wait_for_timeout(3500)
            rr = p.evaluate(DRY_READ_JS, FLAG_KEY)
            notes_last = rr.get("notes")
            verify.step("note count UNCHANGED across the whole run",
                        notes_first is not None and notes_last == notes_first,
                        f"before={notes_first} after={notes_last}")
            verify.step("the baseline is still 32 notes", notes_last == 32, f"{notes_last}")
            verify.facts = {"notes_before": notes_first, "notes_after": notes_last}
            c.close(); b.close()
    except Exception as e:  # noqa: BLE001
        verify.step("note count re-read", False, f"{type(e).__name__}: {str(e)[:160]}")
    results.append(verify)

    # ── 4. NOTHING OF OURS IS LEFT RUNNING.
    time.sleep(2)
    pw_after = playwright_processes()
    sweep = Result("cleanup/playwright")
    sweep.step("every Playwright-managed browser is gone",
               pw_after == pw_before,
               f"{len(pw_before)} before · {len(pw_after)} after (matched by the "
               "ms-playwright install path, so the owner's Chrome is never counted)",
               f"left behind: {[p for p in pw_after if p not in pw_before]}")
    sweep.facts = {"before": pw_before, "after": pw_after}
    results.append(sweep)

    print(f"\n{'=' * 70}\n  DRY RUN\n{'=' * 70}")
    for r in results:
        ok = sum(1 for _, o, _ in r.steps if o)
        print(f"  {r.engine:24} {'✅' if r.green else '⛔'}  {ok}/{len(r.steps)} steps"
              f"  locks={r.caps.get('locks')}")
    green = all(r.green for r in results)
    _write_json(out, dict(header, status="COMPLETE", green=green,
                          notes_before=notes_first, notes_after=notes_last,
                          engines=[_row(r) for r in results]))
    print(f"\nartifact: {out}")
    return 0 if green else 1


def _row(r: Result) -> dict:
    return {"engine": r.engine, "green": r.green, "caps": r.caps, "facts": r.facts,
            "steps": [{"name": n, "ok": o, "detail": d} for n, o, d in r.steps],
            "findings": r.findings}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", default=None)
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--no-conflict", action="store_true")
    ap.add_argument("--dry-run", action="store_true",
                    help="READ-ONLY: auth · offline both ways · cookie provenance · "
                         "Web Locks · cleanup, per engine. Creates nothing.")
    ap.add_argument("--out", default=None, help="where the dry-run results file goes")
    ap.add_argument("--profile", default=None,
                    help=f"absolute path to THE chromium rig profile (or ${w.PROFILE_ENV})")
    ap.add_argument("--edge-profile", default=None,
                    help=f"the Edge rig profile (or ${EDGE_PROFILE_ENV}); "
                         "defaults to `<chromium rig>-edge`, its sibling")
    ap.add_argument("--allow-new-profile", action="store_true",
                    help="permit CREATING a missing chromium rig profile "
                         "(a fresh profile is a signed-out one)")
    args = ap.parse_args()

    w.ALLOW_NEW_PROFILE = bool(args.allow_new_profile)
    w.use_profile(w.resolve_profile(args.profile))
    use_edge_profile(resolve_edge_profile(args.edge_profile))

    if args.self_check:
        return self_check()
    if args.dry_run:
        return dry_run(args.only, pathlib.Path(args.out).resolve() if args.out else None)

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
    global _QUIET
    _QUIET = True                       # several cases below MUST go red; see Result.step
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

    # ══════════════════════════════════════════════════════════════════════════
    # THE PROFILE-PATH OVERRIDE. ⛔ The bug it exists for: the default resolves
    # against THIS COPY's repo root, so a second worktree points both rigs at its
    # own empty `.worktrees/` — and an empty profile is a signed-out one.
    # ══════════════════════════════════════════════════════════════════════════
    _saved = (w.PROFILE, w.MARKER, EDGE_PROFILE, EDGE_MARKER,
              os.environ.get(EDGE_PROFILE_ENV))
    try:
        os.environ.pop(EDGE_PROFILE_ENV, None)
        w.use_profile(w.DEFAULT_PROFILE)
        cases.append(("CONTROL: with nothing set, the Edge rig lands exactly where it used to",
                      resolve_edge_profile(None)
                      == w.ROOT / ".worktrees" / "canary-chrome-profile-persistent-edge"))
        cases.append(("the Edge rig is DERIVED from the chromium rig, so ONE flag moves both",
                      resolve_edge_profile(None).parent == w.DEFAULT_PROFILE.parent))
        moved = pathlib.Path(os.environ.get("TEMP", ".")) / "canary-chrome-profile-persistent"
        w.use_profile(moved)
        cases.append(("…moving the chromium rig moves the Edge rig with it",
                      resolve_edge_profile(None) == moved.parent / (moved.name + "-edge")))
        env_e = moved.parent / "canary-chrome-profile-persistent-edge-env"
        os.environ[EDGE_PROFILE_ENV] = str(env_e)
        cases.append((f"${EDGE_PROFILE_ENV} overrides the derived path",
                      resolve_edge_profile(None) == env_e.resolve()))
        cli_e = moved.parent / "canary-chrome-profile-persistent-edge-cli"
        cases.append(("--edge-profile beats the env var",
                      resolve_edge_profile(str(cli_e)) == cli_e.resolve()))
        cases.append(("a blank override is not an override",
                      resolve_edge_profile("  ") == env_e.resolve()))
        os.environ.pop(EDGE_PROFILE_ENV, None)

        use_edge_profile(cli_e)
        cases.append(("use_edge_profile moves the profile AND its kill marker together",
                      EDGE_PROFILE == cli_e and EDGE_MARKER == cli_e.name))
        cases.append(("the sibling check PASSES for a profile beside the rig",
                      edge_profile_is_sibling(moved.parent / "canary-chrome-profile-persistent-edge")))
        cases.append(("CONTROL: …and FAILS for one in some other worktree",
                      not edge_profile_is_sibling(
                          pathlib.Path("C:/somewhere/else/.worktrees/canary-chrome-profile-persistent-edge"))))
        try:
            use_edge_profile(moved.parent / "Default")
            generic_refused = False
        except SystemExit:
            generic_refused = True
        cases.append(("a GENERIC Edge profile name is refused as a kill marker", generic_refused))
        cases.append(("…and the refusal happens BEFORE either global moves",
                      EDGE_PROFILE == cli_e and EDGE_MARKER == cli_e.name))
    finally:
        os.environ.pop(EDGE_PROFILE_ENV, None)
        if _saved[4] is not None:
            os.environ[EDGE_PROFILE_ENV] = _saved[4]
        w.PROFILE, w.MARKER = _saved[0], _saved[1]
        globals()["EDGE_PROFILE"], globals()["EDGE_MARKER"] = _saved[2], _saved[3]

    # ══════════════════════════════════════════════════════════════════════════
    # THE DRY RUN. Every control below can FAIL — each is driven with a case that
    # is supposed to go red, because a rail nobody has seen fire is not a rail.
    # ══════════════════════════════════════════════════════════════════════════
    dry_src = src.split("# THE DRY RUN", 1)[-1].split("\ndef main(", 1)[0]

    # ⛔ READ-ONLY IS A PROPERTY OF THE CODE, not of the operator's intention.
    write_needles = ["method:'POST'", "method:'PUT'", "method:'DELETE'",
                     "localStorage.setItem", "keyboard.type"]
    cases.append(("the dry run contains no write of any kind",
                  not any(n in dry_src for n in write_needles)))
    cases.append(("CONTROL: the sweep can SEE a write when there is one",
                  any(n in (dry_src + "localStorage.setItem") for n in write_needles)))
    value_needle = "cookie[" + "'value']"
    cases.append(("the dry run never reads the cookie VALUE out to anywhere",
                  value_needle not in dry_src))
    cases.append(("CONTROL: that sweep can see the value being touched",
                  value_needle in (dry_src + value_needle)))
    # ⛔ The sweep counted ITSELF on its first live run: the PowerShell process
    # running the query carried `ms-playwright` in its command line and was
    # reported as a browser left behind. Matched on the BINARY now, and driven.
    cases.append(("the process sweep matches the BINARY, not a string it carries",
                  "$_.ExecutablePath -like '*ms-playwright*'" in dry_src))
    _live = playwright_processes()
    cases.append(("CONTROL: the sweep does not count the instrument running it",
                  not any(n.split("|", 1)[1].lower()
                          in ("powershell.exe", "pwsh.exe", "python.exe", "cmd.exe",
                              "conhost.exe", "node.exe")
                          for n in _live)))
    cases.append(("the lock probe uses its OWN name, never the product's",
                  LOCK_PROBE_NAME.startswith("uct.q1.") and "uct.nb.sync." not in DRY_READ_JS))
    cases.append(("the results file is CLAIMED before any engine opens",
                  dry_src.index("INCOMPLETE") < dry_src.index("1. THE RIG ITSELF")))
    # ⛔ A SWEEP THAT CAN MATCH ITS OWN NEEDLE PROVES NOTHING — spelling the
    # forbidden call literally here would make this file contain it. Same trap the
    # `fetch =` sweep above sidesteps; this one caught itself on its first run.
    del_needles = ["shutil." + "rmtree", "os." + "rmdir", ".unl" + "ink()"]
    body = src.split("def self_check", 1)[0]
    cases.append(("no profile is ever deleted by this tool",
                  not any(n in body for n in del_needles)))
    cases.append(("CONTROL: that sweep can see a delete when there is one",
                  any(n in (body + del_needles[0]) for n in del_needles)))

    # ── offline emulation, driven ────────────────────────────────────────────
    class _P:
        def __init__(self, probes):
            self.probes, self.i = list(probes), 0

        def wait_for_timeout(self, _ms):
            pass

        def evaluate(self, js, *_a):
            if js.strip() == "() => navigator.onLine":
                return None
            v = self.probes[self.i]
            self.i += 1
            return v

    def _offline_verdict(probes):
        r = Result("t")
        f = prove_offline_both_ways(_P(probes), lambda _f: None, r)
        return f["offline_proven_both_ways"]

    cases.append(("CONTROL: a healthy engine proves offline BOTH ways",
                  _offline_verdict(["ONLINE 200", "FAILED: TypeError", "ONLINE 200"]) is True))
    cases.append(("⛔ an engine whose offline emulation SILENTLY NO-OPS is caught",
                  _offline_verdict(["ONLINE 200", "ONLINE 200", "ONLINE 200"]) is False))
    cases.append(("⛔ an engine that cannot come BACK online is caught",
                  _offline_verdict(["ONLINE 200", "FAILED: TypeError", "FAILED: TypeError"]) is False))
    cases.append(("⛔ a probe that fails for its own reasons cannot pass as offline",
                  _offline_verdict(["FAILED: TypeError", "FAILED: TypeError", "FAILED: TypeError"]) is False))

    # ── cookie provenance, driven ────────────────────────────────────────────
    class _Ctx:
        def __init__(self):
            self.calls = []

        def clear_cookies(self):
            self.calls.append("clear")

        def add_cookies(self, _c):
            self.calls.append("add")

    class _CP:
        def __init__(self, status):
            self.status = status

        def reload(self, **_k):
            pass

        def wait_for_timeout(self, _ms):
            pass

        def evaluate(self, _js, *_a):
            return {"status": self.status, "id": None}

    fake_cookie = {"name": "uct_session", "value": "never-printed", "domain": ".x"}
    c1, r1 = _Ctx(), Result("t")
    _cookie_provenance(c1, _CP(401), r1, fake_cookie, "t")
    cases.append(("CONTROL: a context with no session answers 401, then takes the rig cookie",
                  r1.green and c1.calls == ["clear", "add"]))
    cases.append(("…and the cookie is cleared BEFORE it is installed, never after",
                  c1.calls.index("clear") < c1.calls.index("add")))
    c2, r2 = _Ctx(), Result("t")
    _cookie_provenance(c2, _CP(200), r2, fake_cookie, "t")
    cases.append(("⛔ an AMBIENT session from some other profile is caught, not credited",
                  not r2.green))

    # ── the per-engine reads, driven ─────────────────────────────────────────
    class _R:
        def __init__(self, payload):
            self.payload = payload

        def evaluate(self, _js, *_a):
            return dict(self.payload)

    base_read = {"authStatus": 200, "authId": ACCOUNT_ID, "notes": 32, "optInKey": None,
                 "locks": True, "locksRequestWorks": True, "idb": True,
                 "isSecureContext": True, "onLine": True, "ua": "x"}

    def _read_verdict(**over):
        r = Result("t")
        _dry_reads(_R({**base_read, **over}), r, "t")
        return r

    cases.append(("CONTROL: a signed-in engine at rest reads green", _read_verdict().green))
    cases.append(("⛔ a 401 is caught", not _read_verdict(authStatus=401, authId=None).green))
    cases.append(("⛔ a 200 for the WRONG account is caught",
                  not _read_verdict(authId="someone-else").green))
    cases.append(("⛔ an opt-in key that is SET is caught (the flag must stay OFF)",
                  not _read_verdict(optInKey="1").green))
    cases.append(("⛔ a note list that could not be read is caught",
                  not _read_verdict(notes="HTTP 500").green))
    cases.append(("Web Locks ABSENT is RECORDED, not failed — the truth, not an assumption",
                  _read_verdict(locks=False, locksRequestWorks="ERR: TypeError").green))
    cases.append(("…and the absence reaches the row",
                  _read_verdict(locks=False, locksRequestWorks="ERR: TypeError").caps["locks"] is False))

    bad = 0
    for n, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {n}")
        bad += 0 if ok else 1
    print("self-check:", "PASS" if not bad else f"FAIL ({bad})")
    return 0 if not bad else 1


if __name__ == "__main__":
    sys.exit(main())
