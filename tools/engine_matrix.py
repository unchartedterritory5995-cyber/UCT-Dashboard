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


# ══════════════════════════════════════════════════════════════════════════════
# ENGINE LABELS — ⛔ A ROW NAME IS A CLAIM ABOUT A PLATFORM.
# ══════════════════════════════════════════════════════════════════════════════
# Owner rulings, 2026-09-10. Three of these five rows would otherwise be read as
# something they are not, and this repo has been bitten specifically by names that
# outlived their wiring ("ON THE TAPE", `upload_unlisted`). The label is what is
# printed AND what goes in the artifact, so a table copied out of either carries
# the caveat with it.
#
#   · `mobile` is Playwright's iPhone 13 DESCRIPTOR on a CHROMIUM engine. The UA
#     string reads "iPhone … Safari" and the engine is not Safari. The lane stays
#     Chromium — it is the Android-shaped answer, a real member configuration
#     nothing else in the matrix covers — but "mobile ✅" beside an iPhone UA is a
#     claim about a platform we did not test.
#   · Edge on this box is Chromium 119, ~2 years behind the Chrome rig's 152.
#     That is the MORE valuable storage lane (a stale corporate Edge is a real
#     member), and it must never read as "current Edge passes".
#   · WebKit is Playwright's build, not Safari on a device. A real-Safari claim is
#     a DEVICE claim and no local suite can make one.
IOS_NOTE = ("the iOS-shaped answer is the `webkit` row; `mobile-chromium` is "
            "Android-shaped and is NOT iOS")


def edge_version() -> str:
    """⛔ MEASURED off the binary, never typed — the whole point of the label."""
    global _EDGE_VER
    if _EDGE_VER is None:
        try:
            _EDGE_VER = (_ps(f"(Get-Item '{EDGE}').VersionInfo.ProductVersion").strip()
                         or "version unreadable")
        except Exception:  # noqa: BLE001
            _EDGE_VER = "version unreadable"
    return _EDGE_VER


_EDGE_VER = None
ENGINE_IDS = ("chromium-rig", "edge", "firefox", "webkit", "mobile-chromium")
# ⭐ `mobile` still resolves, so nothing that typed the old name breaks — but the
# OUTPUT and the artifact always carry the new label.
ENGINE_ALIASES = {"mobile": "mobile-chromium"}


def engine_label(engine_id: str) -> str:
    base = engine_id.split("/", 1)[0]
    suffix = engine_id[len(base):]
    label = {
        "chromium-rig": "chromium-rig (real Chrome, the signed-in rig profile)",
        "edge": f"edge ({edge_version()} — Chromium 119-era; NOT current Edge)",
        "firefox": "firefox (Gecko)",
        "webkit": "webkit (Playwright WebKit — NOT Safari on a real device)",
        "mobile-chromium": "mobile-chromium (Android-shaped; NOT iOS)",
    }.get(base, base)
    return label + suffix


def resolve_engine(name: str) -> str:
    n = (name or "").strip()
    return ENGINE_ALIASES.get(n, n)


_QUIET = False


class Result:
    def __init__(self, engine):
        # ⛔ THE LABEL IS THE NAME EVERYWHERE IT IS READ — printed row, artifact
        # key, any table copied out of either. Keeping a bare `mobile` anywhere a
        # human or a later script can read it is how the caveat gets lost.
        self.id = engine
        self.engine = engine_label(engine)
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

DRY_ENGINES = ENGINE_IDS
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
        print(f"\n{'=' * 70}\n  ENGINE: {engine_label(name)}\n{'=' * 70}", flush=True)
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
                elif name == "mobile-chromium":
                    # ⛔ CHROMIUM wearing an iPhone descriptor. Deliberate (owner,
                    # 2026-09-10): it is the Android-shaped lane and nothing else
                    # in the matrix covers it. The LABEL carries the caveat.
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
        print(f"  {r.engine:58} {'✅' if r.green else '⛔'}  {ok}/{len(r.steps)} steps"
              f"  locks={r.caps.get('locks')}")
    # ⛔ The one sentence that stops the mobile row being read as an iOS result.
    print(f"\n  ⭐ {IOS_NOTE}.")
    green = all(r.green for r in results)
    _write_json(out, dict(header, status="COMPLETE", green=green,
                          reading_note=IOS_NOTE,
                          notes_before=notes_first, notes_after=notes_last,
                          engines=[_row(r) for r in results]))
    print(f"\nartifact: {out}")
    return 0 if green else 1


# ══════════════════════════════════════════════════════════════════════════════
# FORK CAPTURE — READ-ONLY. Preserve an artifact; never touch it.
# ══════════════════════════════════════════════════════════════════════════════
#
# ⛔⛔ THIS NEVER OPENS THE NOTEBOOK. Both browser visits land on `/api/health`,
# a JSON document on the same origin — cookies apply, `fetch` works, and NO app
# code runs at all. Mounting `/journal/notebook` would start the offline layer,
# and the layer is the thing under investigation: a drain that fires while we are
# reading would rewrite the artifact we came to preserve.
#
# ⛔ AND THE READS RUN FROM A FRESH CONTEXT, not the rig. A fresh profile has no
# opt-in key at all, so the layer is off BY CONSTRUCTION rather than by our
# reading a flag correctly. The rig is opened only long enough to lift the
# cookie — which is also the only place the session exists.

_BLOCK_TYPES = {"paragraph", "heading", "blockquote", "listItem", "codeBlock",
                "bulletList", "orderedList", "horizontalRule"}


def doc_text(node) -> str:
    """Every text node, in document order, blocks separated by newlines."""
    parts = []

    def walk(n):
        if isinstance(n, dict):
            if n.get("type") == "text" and isinstance(n.get("text"), str):
                parts.append(n["text"])
                return
            for c in (n.get("content") or []):
                walk(c)
            if n.get("type") in _BLOCK_TYPES:
                parts.append("\n")
        elif isinstance(n, list):
            for c in n:
                walk(c)

    walk(node)
    return "".join(parts).strip()


def compare_bodies(a_text: str, b_text: str) -> dict:
    """⛔ THE QUESTION IS NOT 'DID THEY DIFFER'. It is whether either side is
    MISSING words the other has — "a fork happened" and "a fork happened and the
    member lost words" are different severities, and only the second is a charter
    hard stop. So this reports the diff in BOTH directions and says, separately,
    whether either text is wholly contained in the other."""
    from collections import Counter
    wa, wb = a_text.split(), b_text.split()
    ca, cb = Counter(wa), Counter(wb)
    only_a, only_b = sorted((ca - cb).elements()), sorted((cb - ca).elements())
    return {
        "identical": a_text == b_text,
        "words_only_in_original": only_a,
        "words_only_in_conflicted_copy": only_b,
        "original_text_is_contained_in_copy": bool(a_text) and a_text in b_text,
        "copy_text_is_contained_in_original": bool(b_text) and b_text in a_text,
        "chars": {"original": len(a_text), "conflicted_copy": len(b_text)},
        "words": {"original": len(wa), "conflicted_copy": len(wb)},
        "any_words_lost_either_way": bool(only_a or only_b),
    }


# ⛔ READS ONLY. No POST, no PUT, no DELETE, no localStorage write anywhere here.
#
# ⭐ IT ALSO READS THE TRASH (`?deleted=true`). The run's own cleanup DELETES the
# canary note before the fork detector ever runs, so the ORIGINAL half of the pair
# is not in the live list — asking only the live list would report "the original
# does not exist" and lose the very comparison this capture is for. The delete is
# soft (Wave 0 trash), so the original is still readable.
CAPTURE_JS = """async (prefix) => {
  const out = {total: 0, trashed_total: 0, list_error: null, trash_error: null,
               conflicts: [], sentinels: [], full: []};
  const brief = (n, del) => ({id:n.id, title:n.title, updatedAt:n.updatedAt,
                              createdAt:n.createdAt, tags:n.tags || [], deleted: del});
  const wanted = new Map();
  const sweep = async (url, del) => {
    const r = await fetch(url, {credentials:'include'});
    if (!r.ok) return {error: 'HTTP ' + r.status, count: 0};
    const notes = (await r.json()).notes || [];
    for (const n of notes) {
      const conflict = (n.tags || []).includes('sync-conflict');
      const sentinel = (n.title || '').startsWith(prefix);
      if (conflict) out.conflicts.push(brief(n, del));
      if (sentinel) out.sentinels.push(brief(n, del));
      if (conflict || sentinel) wanted.set(n.id, {row: n, deleted: del});
    }
    return {error: null, count: notes.length};
  };
  const live = await sweep('/api/j2/notes?limit=500', false);
  out.list_error = live.error; out.total = live.count;
  const trash = await sweep('/api/j2/notes?limit=500&deleted=true', true);
  out.trash_error = trash.error; out.trashed_total = trash.count;
  for (const [id, meta] of wanted) {
    const f = await fetch('/api/j2/notes/' + id, {credentials:'include'});
    if (f.ok) { const b = await f.json();
                out.full.push({id, deleted: meta.deleted, note: b.note ?? b}); continue }
    // ⛔ A soft-deleted note may not be fetchable by id. The LIST ROW is then the
    // only copy there is — record it rather than reporting nothing.
    out.full.push({id, deleted: meta.deleted, note: meta.row,
                   note_from: 'list row (direct GET said HTTP ' + f.status + ')'});
  }
  return out;
}"""


def _ls_on_disk(profile: pathlib.Path, key: str) -> dict:
    """The ON-DISK localStorage value, read with no browser running.

    ⭐ This is the only instrument that can disagree with the browser. An
    in-memory read-back cannot tell you whether the value reached the disk, and
    "written" vs "flushed" is exactly the gap under investigation.
    ⛔ Filesystem READ only — nothing is opened for writing, and Chrome must not
    be running or the answer is whatever leveldb happened to have compacted.
    """
    d = profile / "Default" / "Local Storage" / "leveldb"
    found, scanned = [], []
    if not d.exists():
        return {"dir": str(d), "exists": False, "hits": []}
    needles = {"ascii": key.encode("utf-8"), "utf16le": key.encode("utf-16-le")}
    for f in sorted(d.iterdir()):
        if not f.is_file():
            continue
        try:
            blob = f.read_bytes()
        except OSError as e:
            scanned.append({"file": f.name, "error": str(e)})
            continue
        scanned.append({"file": f.name, "bytes": len(blob)})
        for enc, needle in needles.items():
            start = 0
            while True:
                i = blob.find(needle, start)
                if i < 0:
                    break
                tail = blob[i + len(needle): i + len(needle) + 12]
                found.append({"file": f.name, "encoding": enc, "offset": i,
                              "bytes_after_key": tail.hex(),
                              "printable_after_key":
                                  tail.decode("ascii", "replace").replace("\x00", "."), })
                start = i + 1
    return {"dir": str(d), "exists": True, "files": scanned, "hits": found}


def capture_fork(out_path: pathlib.Path | None = None,
                 prefix: str = "WINDOW-CHECK-SENTINEL") -> int:
    from playwright.sync_api import sync_playwright

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_path or (w.ROOT / ".worktrees" / "q1-dry-run" / f"fork-capture-{stamp}.json")
    rec = {"at": utc(), "mode": "fork-capture", "read_only": True, "writes": "none",
           "origin": PROD, "profile": str(w.PROFILE), "title_prefix": prefix,
           "status": "INCOMPLETE — the capture did not finish"}
    _write_json(out, rec)
    print(f"artifact claimed: {out}\n", flush=True)

    # ── 0. THE DISK, BEFORE ANY BROWSER OPENS IT.
    rec["localstorage_on_disk_before"] = _ls_on_disk(w.PROFILE, FLAG_KEY)
    hits = len(rec["localstorage_on_disk_before"].get("hits") or [])
    print(f"on-disk localStorage scan: {hits} hit(s) for {FLAG_KEY}", flush=True)

    # ── 1. THE RIG, JUST LONG ENOUGH TO LIFT THE COOKIE. `/api/health` — a JSON
    #      document, no app code, no notebook, nothing that can drain.
    cookie = None
    try:
        proc, endpoint, version = w.spawn_rig()
    except SystemExit as e:
        _write_json(out, dict(rec, status=f"REFUSED — {e}"))
        print(f"⛔ {e}", flush=True)
        return 1
    try:
        if not version:
            _write_json(out, dict(rec, status="STOPPED — the CDP endpoint never answered"))
            return 1
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(PROD + "/api/health", wait_until="domcontentloaded")
            page.wait_for_timeout(2500)
            rec["rig_flag_key_in_browser"] = page.evaluate(
                "(k) => { try { return localStorage.getItem(k) } catch (e) { return 'ERR: ' + e.name } }",
                FLAG_KEY)
            print(f"rig, in-browser: {FLAG_KEY} = {rec['rig_flag_key_in_browser']!r}", flush=True)
            for c in ctx.cookies():
                if c["name"] == "uct_session":
                    cookie = {k: c[k] for k in ("name", "value", "domain", "path",
                                                "httpOnly", "secure", "sameSite") if k in c}
                    break
    finally:
        killed, left, others, released, held = w.teardown(None)
        rec["rig_teardown"] = {"killed": killed, "survivors": left,
                               "untouched_browsers": others, "lock_released": released}
        print(f"rig closed: killed {killed} · {len(left)} left · lock released={released}", flush=True)

    if cookie is None:
        _write_json(out, dict(rec, status="STOPPED — no session cookie in the rig profile"))
        return 1

    # ── 2. THE CAPTURE, from a FRESH context. No opt-in key exists there, so the
    #      offline layer is off by construction, not by our reading a flag right.
    with sync_playwright() as pw:
        br = pw.chromium.launch(headless=True)
        c = br.new_context()
        c.add_cookies([cookie])
        p = c.new_page()
        p.goto(PROD + "/api/health", wait_until="domcontentloaded")
        p.wait_for_timeout(1500)
        cap = p.evaluate(CAPTURE_JS, prefix)
        c.close()
        br.close()

    rec["notes_total"] = cap.get("total")
    rec["trashed_total"] = cap.get("trashed_total")
    rec["list_error"] = cap.get("list_error")
    rec["trash_error"] = cap.get("trash_error")
    rec["sync_conflict_notes"] = cap.get("conflicts")
    rec["sentinel_notes"] = cap.get("sentinels")

    notes = {}
    for row in cap.get("full") or []:
        n = row.get("note")
        if not isinstance(n, dict):
            notes[row.get("id")] = {"error": row.get("error")}
            continue
        body = n.get("bodyJson")
        text = doc_text(body)
        # ⭐ `bodyPlain` is the server's own flattening. When bodyJson is absent
        # (a list row rather than a full fetch) it is the only text there is —
        # and when both exist, a disagreement between them is itself worth seeing.
        plain = n.get("bodyPlain") if isinstance(n.get("bodyPlain"), str) else None
        notes[n.get("id")] = {
            "id": n.get("id"), "title": n.get("title"), "deleted": row.get("deleted"),
            "deletedAt": n.get("deletedAt"), "note_from": row.get("note_from", "full GET"),
            "updatedAt": n.get("updatedAt"), "createdAt": n.get("createdAt"),
            "baseUpdatedAt": n.get("baseUpdatedAt"), "tags": n.get("tags") or [],
            "other_fields": sorted(k for k in n.keys() if k not in ("bodyJson",)),
            "body_text": text or (plain or ""),
            "body_text_source": "bodyJson" if text else ("bodyPlain" if plain else "empty"),
            "bodyPlain": plain, "bodyJson": body,
        }
    rec["notes"] = notes

    # ── 3. THE PAIRS, and the question that matters.
    #
    # ⛔ PAIRED BY EXACT TITLE, never by the shared prefix. Every canary run ever
    # made a note with this prefix and the trash holds them all, so "the one that
    # is not the conflicted copy" picks an unrelated run's note and then diffs two
    # texts that were never related — a comparison that would have read as a
    # catastrophic word-loss finding. The copy's own title names its original.
    SUFFIX = " (conflicted copy)"
    by_title = {}
    for n in notes.values():
        by_title.setdefault(n.get("title") or "", []).append(n)

    pairs = []
    for n in notes.values():
        t = n.get("title") or ""
        if not t.endswith(SUFFIX):
            continue
        base = t[: -len(SUFFIX)]
        originals = by_title.get(base) or []
        entry = {"base_title": base,
                 "conflicted_copy": {k: v for k, v in n.items() if k != "bodyJson"},
                 "original": ({k: v for k, v in originals[0].items() if k != "bodyJson"}
                              if originals else None),
                 "originals_found": len(originals)}
        if originals:
            a, b2 = originals[0]["body_text"], n["body_text"]
            cmp = compare_bodies(a, b2)
            cmp["sentinel_in_original"] = prefix in a
            cmp["sentinel_in_conflicted_copy"] = prefix in b2
            cmp["original_is_in_trash"] = bool(originals[0].get("deleted"))
            entry["comparison"] = cmp
            entry["verdict"] = ("NO WORDS LOST — both sides hold the same words"
                                if not cmp["any_words_lost_either_way"]
                                else "⛔ THE TWO SIDES DIFFER — see both word lists")
        else:
            entry["comparison"] = None
            entry["verdict"] = ("⛔ the original is not on the account at all, not "
                                "even in the trash — nothing to compare against")
        pairs.append(entry)

    rec["pairs"] = pairs
    rec["verdict"] = ("; ".join(f"{p['base_title']}: {p['verdict']}" for p in pairs)
                      if pairs else "no conflicted copy found")
    verdict = rec["verdict"]
    # ⛔⛔ THE SEVERITY, IN THE OWNER'S WORDS (ruling, 2026-09-10). Recorded beside
    # the evidence so the next reader gets the classification WITH it, not a
    # retelling of it — and specifically so "no data loss" cannot soften into
    # "harmless" on the way through.
    rec["severity"] = {
        "classification": "duplicate note, no data loss",
        "not_a_data_integrity_emergency": (
            "Nothing a member wrote was lost, in either direction, across three "
            "separate forks. No urgency, no rollback pressure; deploy #4 stays live."),
        "still_flip_blocking": (
            "A spurious `(conflicted copy)` with no other device involved IS the "
            "member-visible symptom this wave exists to remove, and deploy #4's "
            "approved member-impact paragraph promises members exactly this fix. "
            "Shipping the flag on top of a defect we just told members was fixed is "
            "not available to us."),
        "do_not_restate_as": "harmless",
    }
    # ⛔ RECOMMENDATION ONLY — NOT IMPLEMENTED, deliberately, mid-investigation.
    # `tools/window_check.py` appends its rows INTO docs/notebook/wave-q1-RESUME-HERE.md,
    # which the docs stream owns and rewrites. Two writers, one file: an agent editing
    # prose and a TOOL appending measurements. The ownership split was drawn around who
    # EDITS, and a tool is not a who. The near-miss cost was real — the rows sat
    # uncommitted while a docs merge could have eaten them.
    rec["recommendation_not_implemented"] = {
        "problem": "window_check.py writes measurements into a prose file another stream owns",
        "shape": ("give the tool a file it SOLELY owns — an append-only rows artifact "
                  "beside window-check.log — and have the resume doc POINT at it rather "
                  "than contain it. The doc keeps the narrative; the tool keeps the rows."),
        "why_it_is_clean": ("the tool already owns window-check.log in that directory, so "
                            "the precedent and the path exist; and `next_check_number()` "
                            "already parses rows back out of the doc, which is the only "
                            "read coupling to sever."),
        "why_not_now": "changing where evidence lands mid-investigation loses comparability",
    }
    # ⛔ THE HONEST UNKNOWN. Runs 2 and 3 reading the opt-in key as '1' AT REST is
    # NOT explained by anything measured here, and the flush fix is not evidence
    # about it. Written into the artifact rather than left to a summary, because an
    # explanation that fits the mechanism but not the data is how this wave got a
    # "fix" that reproduced three runs later.
    rec["unexplained"] = {
        "observation": "runs 2 and 3 (16:53:34Z, 16:54:50Z) read uct.j2.offline.enabled = '1' at rest",
        "ruled_out_1": ("an unflushed opt-out from the previous run — the profile's "
                        "leveldb holds 32 appends of that key in perfect 1/0 alternation "
                        "with NO unmatched '1', final value '0'"),
        "ruled_out_2": ("the app writing '1' on notebook mount — measured on deploy #4 "
                        "from both unset and '0', in throwaway contexts: the key does not "
                        "change and no IndexedDB is created"),
        # ⛔ CORRECTED 2026-09-10. This slot previously read "no stamped row exists;
        # the readings exist only in grep-filtered terminal output". THAT WAS MY
        # INSTRUMENT, NOT THE FILE. The rows were on disk in the very file I read;
        # my listing regex was `^### check ` and a `--label`led row is headed
        # `### deploy #4 live — run 2 of 7 — …`, which that pattern cannot match.
        # I reported an absence my own filter manufactured — the same defect class
        # this investigation is chasing, committed by the instrument reporting it.
        "how_the_error_happened_verbatim": (
            "I searched for the shape of a row I expected instead of the shape of a "
            "row, got silence, and wrote the silence down as a fact."),
        "the_fourth_self_blind_instrument_today": [
            "the process sweep that counted itself (matched `ms-playwright` in its own "
            "PowerShell command line)",
            "the source sweeps that matched their own needles (three of them)",
            "a rail set derived on DIRECTORY MEMBERSHIP instead of the property it stood for",
            "this one: a heading regex that could not match the heading it was looking for",
        ],
        "corroborated": {
            "source": "docs/notebook/wave-q1-RESUME-HERE.md, committed a73feec6a",
            "run_1": ("### deploy #4 live — run 1 of 7 — 2026-09-10T16:50:13Z · "
                      "opt-in key **'0'** at rest · notebook locks **0** · notes 32 · "
                      "sync-conflict 2 · no fork · cleanup key '0' · opted back out '0'"),
            "run_2": ("### deploy #4 live — run 2 of 7 — 2026-09-10T16:53:34Z · "
                      "opt-in key **'1'** ⇒ OPTED IN, \"unexpected at rest; a previous "
                      "run did not opt back out\" · notebook locks **1** `uct.nb.sync.*` · "
                      "notes 32 · sync-conflict 2 · no fork · cleanup key '0' · "
                      "opted back out '0'"),
            "run_3": "NO ROW BY DESIGN — it refused to stamp. The absence is the record.",
        },
        "window_narrowed_by_the_rows": (
            "run 1's cleanup AND its opt-out both read back '0', and run 2 began at "
            "'1'. So the '1' arrived between run 1's cleanup (~16:51) and run 2's "
            "start (16:53:34) — corroborated on disk, not from a lost buffer."),
        "two_further_facts_the_rows_carry": [
            "run 2 read notebook locks = 1 `uct.nb.sync.*` AT REST; run 1 read 0. The "
            "offline layer was ENGAGED at run 2's read.",
            "the opt-in telemetry went 14 -> 15 with latest 2026-09-10 16:50:37 — that "
            "is run 1's OWN opt-in, so run 1 registered as a new distinct opt-in event.",
        ],
        "untested_variable_NOT_an_explanation": (
            "The mount probe refuted 'mount writes the key' in a THROWAWAY context, "
            "which by construction had NO `uct_notebook_<acct>` IndexedDB (db_after=[]). "
            "The rig HAS one, with 4 stores. Whether an existing local database changes "
            "that answer is UNTESTED. Recording it as the next probe to run, NOT as a "
            "cause — a story that fits the mechanism but not the data is the defect this "
            "wave already shipped once."),
        "status": ("UNEXPLAINED — both hypotheses remain refuted by measurement, and the "
                   "flush fix is real, located, and NOT evidence about this"),
    }

    _write_json(out, dict(rec, status="COMPLETE"))
    print(f"\nnotes on the account: {rec['notes_total']} · "
          f"sync-conflict: {len(rec['sync_conflict_notes'] or [])} · "
          f"sentinel-titled: {len(rec['sentinel_notes'] or [])}")
    print(f"VERDICT: {verdict}")
    print(f"artifact: {out}")
    return 0


# ═══ END OF THE READ-ONLY DRY RUN ════════════════════════════════════════════
# ⛔ `--self-check`'s read-only sweep is bounded HERE, by name, not by "whatever
# comes before `def main`". Everything ABOVE this line must contain no write of
# any kind. `rig_opt_out` below is the ONE deliberate write this tool makes to
# the rig profile, it is railed separately, and it only ever runs when asked.
# ⭐ The boundary is a sentinel rather than the next `def` so that reordering the
# file cannot silently move it — the first version of this sweep swallowed
# `rig_opt_out` the moment it was added, which is the rail working.


PROBE_KEY = "uct.q1.rigprobe.flush"

MOUNT_READ_JS = """async (k) => {
  const out = {key: null, db: null, locks: typeof navigator.locks !== 'undefined'};
  try { out.key = localStorage.getItem(k) } catch (e) { out.key = 'ERR: ' + e.name }
  try { out.db = (await indexedDB.databases()).map(d => d.name).filter(n => /uct_notebook_/.test(n)) }
  catch (e) { out.db = 'ERR: ' + e.name }
  return out;
}"""


def mount_probe(out_path: pathlib.Path | None = None) -> int:
    """Does MOUNTING the notebook write the opt-in key to '1'?

    ⛔⛔ WHY THIS IS THE RIGHT QUESTION. window_check's "opt-in key at rest" read
    is a plain `localStorage.getItem`, and it runs while the page is sitting at
    `/journal/notebook` — AFTER the notebook has mounted. So "at rest" is a
    misnomer: it is a POST-MOUNT read. If the app writes '1' on mount, the run
    reports "a previous run did not opt back out" about a value the run itself
    just caused, and the on-disk history still alternates perfectly because a
    second write of the same value is a no-op that leveldb never appends.

    ⛔ IT NEVER TOUCHES THE RIG PROFILE. Every trial runs in a FRESH throwaway
    context holding only the session cookie. That context's outbox is empty BY
    CONSTRUCTION, not by measurement, so a drain there has nothing it could send
    — which is what makes mounting the notebook safe to do at all while three
    forked notes sit on the account. No note is opened, nothing is typed.
    """
    from playwright.sync_api import sync_playwright

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_path or (w.ROOT / ".worktrees" / "q1-dry-run" / f"mount-probe-{stamp}.json")
    rec = {"at": utc(), "mode": "mount-probe",
           "question": "does mounting /journal/notebook write the opt-in key to '1'?",
           "rig_profile_touched": False, "notes_opened": 0, "trials": [],
           "status": "INCOMPLETE — the probe did not finish"}
    _write_json(out, rec)

    cookie = None
    try:
        proc, endpoint, version = w.spawn_rig()
    except SystemExit as e:
        _write_json(out, dict(rec, status=f"REFUSED — {e}"))
        return 1
    try:
        if not version:
            _write_json(out, dict(rec, status="STOPPED — CDP never answered"))
            return 1
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(PROD + "/api/health", wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            for c in ctx.cookies():
                if c["name"] == "uct_session":
                    cookie = {k: c[k] for k in ("name", "value", "domain", "path",
                                                "httpOnly", "secure", "sameSite") if k in c}
                    break
    finally:
        w.teardown(None)
    if cookie is None:
        _write_json(out, dict(rec, status="STOPPED — no session cookie in the rig"))
        return 1

    for label, preset in (("key UNSET before the mount", None),
                          ("key explicitly '0' before the mount", "0")):
        with sync_playwright() as pw:
            br = pw.chromium.launch(headless=True)
            c = br.new_context()
            c.add_cookies([cookie])
            p = c.new_page()
            p.goto(PROD + "/api/health", wait_until="domcontentloaded")
            p.wait_for_timeout(1200)
            if preset is not None:
                p.evaluate("([k, v]) => localStorage.setItem(k, v)", [FLAG_KEY, preset])
            before = p.evaluate(MOUNT_READ_JS, FLAG_KEY)
            # ⛔ The notebook LIST only. No `?note=`, nothing opened, nothing typed.
            p.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
            p.wait_for_timeout(12000)
            after = p.evaluate(MOUNT_READ_JS, FLAG_KEY)
            c.close()
            br.close()
        trial = {"trial": label, "preset": preset,
                 "key_before_mount": before.get("key"), "key_after_mount": after.get("key"),
                 "db_before": before.get("db"), "db_after": after.get("db"),
                 "mount_wrote_1": after.get("key") == "1" and before.get("key") != "1"}
        rec["trials"].append(trial)
        _write_json(out, rec)
        print(f"{label}\n    before={before.get('key')!r} after={after.get('key')!r} "
              f"db_after={after.get('db')}  MOUNT_WROTE_1={trial['mount_wrote_1']}", flush=True)

    wrote = any(t["mount_wrote_1"] for t in rec["trials"])
    rec["verdict"] = (
        "⛔ MOUNTING THE NOTEBOOK WRITES THE OPT-IN KEY TO '1' — window_check's "
        "'at rest' reading is a POST-MOUNT read, so a run reports an opt-in the run "
        "itself caused, and the on-disk history still alternates because the "
        "canary's own '1' is then a no-op write"
        if wrote else
        "mounting the notebook does NOT write the opt-in key — this hypothesis is "
        "REFUTED, and runs 2 and 3 reading '1' remains UNEXPLAINED")
    _write_json(out, dict(rec, status="COMPLETE"))
    print(f"\nVERDICT: {rec['verdict']}\nartifact: {out}")
    return 0


def flush_probe(out_path: pathlib.Path | None = None) -> int:
    """Does `kill by marker` lose a localStorage value Chrome has not flushed yet?

    ⛔⛔ IT NEVER TOUCHES `uct.j2.offline.enabled`. The question is about the
    MECHANISM — whether a write survives a hard kill — and the mechanism can be
    asked with a key this rig owns. Testing it on the product's flag would mean
    flipping the very state under investigation to measure it.

    ⭐ AND IT ASKS THE DISK, NOT THE BROWSER. An in-memory read-back is exactly
    the instrument that cannot distinguish "written" from "flushed"; that is the
    whole hypothesis. Each trial reads the leveldb file with Chrome not running.

    Two trials, because "does a delay save it" is the actionable half:
      A · write, then kill IMMEDIATELY (no wait, no navigation)
      B · write, wait, navigate, then kill — what a real run does
    """
    from playwright.sync_api import sync_playwright

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_path or (w.ROOT / ".worktrees" / "q1-dry-run" / f"flush-probe-{stamp}.json")
    rec = {"at": utc(), "mode": "flush-probe", "profile": str(w.PROFILE),
           "probe_key": PROBE_KEY,
           "never_touched": FLAG_KEY,
           "status": "INCOMPLETE — the probe did not finish", "trials": []}
    _write_json(out, rec)

    def _visit(fn):
        proc, endpoint, version = w.spawn_rig()
        try:
            if not version:
                return None
            with sync_playwright() as pw:
                b = pw.chromium.connect_over_cdp(endpoint)
                ctx = b.contexts[0]
                page = ctx.pages[0] if ctx.pages else ctx.new_page()
                page.goto(PROD + "/api/health", wait_until="domcontentloaded")
                page.wait_for_timeout(1200)
                return fn(page)
        finally:
            w.teardown(None)

    for name, settle in (("A · killed IMMEDIATELY after the write", 0),
                         ("B · killed after a settle + a navigation", 4000)):
        nonce = f"n{datetime.now(timezone.utc).strftime('%H%M%S%f')}"

        def _write(page, _n=nonce, _s=settle):
            got = page.evaluate(
                "([k, v]) => { try { localStorage.setItem(k, v); return localStorage.getItem(k) }"
                "              catch (e) { return 'ERR: ' + e.name } }", [PROBE_KEY, _n])
            if _s:
                page.wait_for_timeout(_s)
                page.goto(PROD + "/api/health", wait_until="domcontentloaded")
                page.wait_for_timeout(1200)
            return got

        in_memory = _visit(_write)
        on_disk = _ls_on_disk(w.PROFILE, PROBE_KEY)
        try:
            d = w.PROFILE / "Default" / "Local Storage" / "leveldb"
            blob = b"".join(f.read_bytes() for f in sorted(d.iterdir())
                            if f.is_file() and f.suffix in ("", ".log", ".ldb")
                            and f.name not in ("LOCK", "CURRENT"))
            disk_has_nonce = nonce.encode() in blob
        except OSError:
            disk_has_nonce = None
        after_reopen = _visit(lambda p: p.evaluate(
            "(k) => { try { return localStorage.getItem(k) } catch (e) { return 'ERR: ' + e.name } }",
            PROBE_KEY))
        trial = {"trial": name, "settle_ms": settle, "nonce": nonce,
                 "read_back_in_memory": in_memory,
                 "found_on_disk_after_kill": disk_has_nonce,
                 "read_after_reopen": after_reopen,
                 "survived": after_reopen == nonce,
                 "key_hits_on_disk": len(on_disk.get("hits") or [])}
        rec["trials"].append(trial)
        _write_json(out, rec)
        print(f"{name}\n    in-memory={in_memory!r}  on-disk={disk_has_nonce}  "
              f"after-reopen={after_reopen!r}  SURVIVED={trial['survived']}", flush=True)

    survived = [t["survived"] for t in rec["trials"]]
    rec["verdict"] = (
        "kill-by-marker does NOT lose a localStorage write — it survived even an "
        "immediate kill, so an unflushed '0' cannot explain a run starting at '1'"
        if all(survived) else
        "⛔ kill-by-marker CAN lose a localStorage write — see which trial failed")
    _write_json(out, dict(rec, status="COMPLETE"))
    print(f"\nVERDICT: {rec['verdict']}\nartifact: {out}")
    return 0


LOCKS_JS = """async () => {
  try {
    const q = await navigator.locks.query();
    return {held: (q.held || []).map(l => ({name: l.name, mode: l.mode, clientId: l.clientId})),
            pending: (q.pending || []).map(l => ({name: l.name, mode: l.mode}))};
  } catch (e) { return 'ERR: ' + e.name }
}"""


# ⛔ THE SAME REQUEST SHAPE THE EDITOR ISSUES: PUT the note endpoint with a
# `baseUpdatedAt` CAS and a real `bodyJson`. A GET or an /api/health ping measures
# the edge, not the write path, and the write path is what the drain waits on.
# ⭐ Timed with `performance.now()` INSIDE the page, so no CDP round-trip is in
# the number. Paced, so the samples are a latency distribution and not a burst.
PUT_LATENCY_JS = """async ({id, base, text, reps, n, gap, title}) => {
  const para = (t) => ({type:'paragraph', content:[{type:'text', text:t}]});
  const body = {type:'doc', content: Array.from({length: reps}, () => para(text))};
  const payload = JSON.stringify({title, baseUpdatedAt: base, bodyJson: body});
  const bytes = new TextEncoder().encode(payload).length;
  const out = {bytes, samples: [], base};
  for (let i = 0; i < n; i++) {
    const p = JSON.stringify({title, baseUpdatedAt: out.base, bodyJson: body});
    const t0 = performance.now();
    let status = 0, updatedAt = null, err = null;
    try {
      const r = await fetch('/api/j2/notes/' + id, {method:'PUT', credentials:'include',
        headers:{'Content-Type':'application/json'}, body: p});
      status = r.status;
      const j = await r.json().catch(() => null);
      updatedAt = j?.note?.updatedAt ?? null;
    } catch (e) { err = String(e && e.name || e); }
    const ms = performance.now() - t0;
    out.samples.push({ms: Math.round(ms * 100) / 100, status, err});
    // ⛔ CHAIN THE CAS. A stale baseUpdatedAt 409s and the next sample would be
    // measuring a rejection, not a write.
    if (updatedAt) out.base = updatedAt;
    await new Promise(res => setTimeout(res, gap));
  }
  return out;
}"""

GET_LATENCY_JS = """async ({id, n, gap}) => {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t0 = performance.now();
    let status = 0, bytes = null;
    try {
      const r = await fetch('/api/j2/notes/' + id, {credentials:'include'});
      status = r.status;
      const t = await r.text();
      bytes = new TextEncoder().encode(t).length;
    } catch (e) { status = -1; }
    out.push({ms: Math.round((performance.now() - t0) * 100) / 100, status, bytes});
    await new Promise(res => setTimeout(res, gap));
  }
  return out;
}"""


def _pct(values: list, q: float) -> float:
    """Nearest-rank percentile, stated so the method is not a guess either."""
    if not values:
        return float("nan")
    s = sorted(values)
    import math
    k = max(1, math.ceil(q * len(s)))
    return s[k - 1]


def _summarise(ms: list) -> dict:
    ok = [m for m in ms if isinstance(m, (int, float))]
    return {"n": len(ok), "p50": _pct(ok, 0.50), "p95": _pct(ok, 0.95),
            "max": max(ok) if ok else None, "min": min(ok) if ok else None,
            "method": "nearest-rank percentile over the raw list"}


def put_latency(out_path: pathlib.Path | None = None) -> int:
    """Measure REAL note-update PUT latency against production, from the rig.

    ⛔ NO OPT-IN AND NO NOTEBOOK. Every request is issued by `fetch` from
    `/api/health` — a JSON document on the origin where no app code runs — so the
    offline layer is never mounted and the drain is never engaged. The number
    wanted is the write path's, and the write path does not need the editor.

    ⛔ ONE scratch note, reused for every sample, deleted at the end. It is titled
    `LATENCY-PROBE …` and carries no tags, so it cannot be mistaken for the
    preserved artifacts. NOTHING tagged `sync-conflict`, no forked note and no
    trashed original is read, written, restored or deleted.
    """
    from playwright.sync_api import sync_playwright

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_path or (w.ROOT / ".worktrees" / "q1-dry-run" / f"put-latency-{stamp}.json")
    rec = {"at": utc(), "mode": "put-latency", "origin": PROD, "profile": str(w.PROFILE),
           "method": ("PUT /api/j2/notes/{id} with a baseUpdatedAt CAS and a real bodyJson, "
                      "issued by fetch from /api/health (no app code, no opt-in, no notebook)"),
           "timing": "performance.now() inside the page, around the fetch only",
           "status": "INCOMPLETE — the probe did not finish"}
    _write_json(out, rec)
    print(f"artifact claimed: {out}\n", flush=True)

    try:
        proc, endpoint, version = w.spawn_rig()
    except SystemExit as e:
        _write_json(out, dict(rec, status=f"REFUSED — {e}"))
        return 1
    note_id = None
    try:
        if not version:
            _write_json(out, dict(rec, status="STOPPED — CDP never answered"))
            return 1
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.set_default_timeout(180000)
            page.goto(PROD + "/api/health", wait_until="domcontentloaded")
            page.wait_for_timeout(2500)

            me = page.evaluate(AUTH_ONLY_JS)
            rec["auth"] = me
            if me.get("status") != 200 or me.get("id") != ACCOUNT_ID:
                _write_json(out, dict(rec, status=f"STOPPED — auth {me.get('status')}"))
                return 1
            before = page.evaluate(w.NOTES_JS)
            rec["notes_before"] = before.get("total")
            print(f"signed in as the canary · notes before: {rec['notes_before']}", flush=True)

            title = f"LATENCY-PROBE {utc()}"
            created = page.evaluate("""async (t) => {
                const t0 = performance.now();
                const r = await fetch('/api/j2/notes', {method:'POST', credentials:'include',
                  headers:{'Content-Type':'application/json'},
                  body: JSON.stringify({title:t, bodyJson:{type:'doc',content:[]}})});
                const j = await r.json();
                return {ok:r.ok, id: j.note?.id ?? j.id, updatedAt: j.note?.updatedAt,
                        ms: Math.round((performance.now() - t0) * 100) / 100};
            }""", title)
            if not created.get("ok"):
                _write_json(out, dict(rec, status=f"STOPPED — could not create the scratch note"))
                return 1
            note_id, base = created["id"], created["updatedAt"]
            rec["scratch_note"] = {"id": note_id, "title": title, "create_ms": created.get("ms")}
            print(f"scratch note {note_id} created in {created.get('ms')}ms\n", flush=True)

            # ── the three payload tiers. Size is part of latency, so an empty body
            #    alone would understate the drain's real cost.
            tiers = [
                ("small  (~1 short paragraph)", "The quick brown fox jumps over the lazy dog.", 1, 10),
                ("medium (~a real note)", "A realistic notebook paragraph of prose. " * 12, 6, 10),
                ("large  (~a long note)", "A realistic notebook paragraph of prose. " * 12, 40, 10),
            ]
            rec["tiers"] = []
            for label, text, reps, n in tiers:
                res = page.evaluate(PUT_LATENCY_JS, {"id": note_id, "base": base, "text": text,
                                                     "reps": reps, "n": n, "gap": 300,
                                                     "title": title})
                base = res.get("base") or base
                ms = [s["ms"] for s in res["samples"] if s.get("status") == 200]
                bad = [s for s in res["samples"] if s.get("status") != 200]
                tier = {"tier": label, "payload_bytes": res["bytes"], "raw_ms": [s["ms"] for s in res["samples"]],
                        "non_200": bad, "summary": _summarise(ms)}
                rec["tiers"].append(tier)
                _write_json(out, rec)
                s = tier["summary"]
                print(f"{label:30} {res['bytes']:>7}B  n={s['n']:>2}  p50={s['p50']:>7.1f}  "
                      f"p95={s['p95']:>7.1f}  max={s['max']:>7.1f}"
                      + (f"  ⛔ {len(bad)} non-200" if bad else ""), flush=True)

            # ── the GET guard 2 pays on EVERY 409.
            gets = page.evaluate(GET_LATENCY_JS, {"id": note_id, "n": 30, "gap": 250})
            gms = [g["ms"] for g in gets if g.get("status") == 200]
            rec["get_one_note"] = {"raw_ms": [g["ms"] for g in gets],
                                   "bytes": (gets[-1] or {}).get("bytes") if gets else None,
                                   "non_200": [g for g in gets if g.get("status") != 200],
                                   "summary": _summarise(gms)}
            gs = rec["get_one_note"]["summary"]
            print(f"{'GET one note (the 409 path)':30} {rec['get_one_note']['bytes'] or 0:>7}B  "
                  f"n={gs['n']:>2}  p50={gs['p50']:>7.1f}  p95={gs['p95']:>7.1f}  max={gs['max']:>7.1f}",
                  flush=True)

            # ── ORDINARY cleanup: the scratch note only, by id.
            page.evaluate("""async (id) => { await fetch('/api/j2/notes/' + id,
                             {method:'DELETE', credentials:'include'}) }""", note_id)
            page.wait_for_timeout(1500)
            after = page.evaluate(w.NOTES_JS)
            rec["notes_after"] = after.get("total")
            rec["scratch_note_removed"] = rec["notes_after"] == rec["notes_before"]
    finally:
        killed, left, others, released, held = w.teardown(None)
        rec["teardown"] = {"killed": killed, "survivors": left, "lock_released": released}

    all_put = [m for t in rec.get("tiers", []) for m in t["raw_ms"]]
    rec["put_overall"] = _summarise(all_put)
    o = rec["put_overall"]
    rec["threshold_options"] = {
        "p95_x10_ms": round((o["p95"] or 0) * 10),
        "max_x10_ms": round((o["max"] or 0) * 10),
        "note": ("a p95 over a few dozen samples IS a handful of samples; the max is the "
                 "worst thing actually observed on this path"),
    }
    _write_json(out, dict(rec, status="COMPLETE"))
    print(f"\nPUT overall: n={o['n']} p50={o['p50']:.1f} p95={o['p95']:.1f} max={o['max']:.1f} ms")
    print(f"  p95 x10 = {rec['threshold_options']['p95_x10_ms']} ms · "
          f"max x10 = {rec['threshold_options']['max_x10_ms']} ms")
    print(f"notes {rec.get('notes_before')} -> {rec.get('notes_after')} "
          f"(scratch removed: {rec.get('scratch_note_removed')})")
    print(f"artifact: {out}")
    return 0


def live_stores_probe(out_path: pathlib.Path | None = None) -> int:
    """Does mounting the notebook on a profile WITH LIVE STORES change the key —
    and does it take a `uct.nb.sync.*` LOCK?

    ⛔⛔ WHY THIS RUNS ON THE RIG AND NOT A FIXTURE. The earlier mount probe
    refuted the claim in throwaway contexts that, BY CONSTRUCTION, had no
    `uct_notebook_<acct>` database at all — so it refuted a NARROWER claim than the
    one on the table. The rig has the real thing: the database, its four stores,
    and whatever state three runs left in them. Fabricating that in a throwaway
    context would mean an instrument CREATING the database, which this codebase
    has a standing prohibition against — an open-with-no-version conjures a
    zero-store phantom and permanently breaks the layer.

    ⛔ ZERO WRITES. The rig's key is already `'0'` at rest, which is the transition
    actually on the table (run 1 read `'0'`, run 2 read `'1'`). Nothing is set,
    removed, opted in, deleted or trashed. The `unset` case is NOT tested here: it
    would need a removal plus a restore on the rig, and removals were just measured
    to be flush-fragile. That is a different experiment.

    ⭐ AND IT CHASES THE LOCK. A held lock at rest means the DRAIN WAS ALIVE, which
    is closer to the mechanism than the key: the key says the layer was enabled, the
    lock says it was running. Locks are sampled before the mount, repeatedly during
    it, and after navigating away — so "taken" and "released" are separate answers.
    """
    from playwright.sync_api import sync_playwright

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_path or (w.ROOT / ".worktrees" / "q1-dry-run" / f"live-stores-probe-{stamp}.json")
    rec = {
        "at": utc(), "mode": "live-stores-probe", "profile": str(w.PROFILE),
        "question": ("does mounting /journal/notebook on a profile WITH LIVE STORES "
                     "write or change uct.j2.offline.enabled, and is a uct.nb.sync.* "
                     "lock taken (and released)?"),
        "writes": "none — no set, no remove, no opt-in, no delete, no trash",
        "unset_case": "NOT TESTED — would need a removal+restore on the rig; different experiment",
        "status": "INCOMPLETE — the probe did not finish",
    }
    _write_json(out, rec)
    print(f"artifact claimed: {out}\n", flush=True)

    # ── 0. THE DISK, BEFORE. Chrome is not running.
    before_disk = w.localstorage_on_disk(FLAG_KEY)
    rec["key_on_disk_before"] = {"value": before_disk.get("value"),
                                 "appends": before_disk.get("appends"),
                                 "tail": (before_disk.get("sequence") or "")[-12:]}
    print(f"on disk BEFORE (Chrome dead): {rec['key_on_disk_before']}", flush=True)

    try:
        proc, endpoint, version = w.spawn_rig()
    except SystemExit as e:
        _write_json(out, dict(rec, status=f"REFUSED — {e}"))
        return 1
    try:
        if not version:
            _write_json(out, dict(rec, status="STOPPED — CDP never answered"))
            return 1
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()

            # ── 1. AT REST. `/api/health` runs NO app code, so this is the profile
            #       as it sits, not the profile plus a notebook.
            page.goto(PROD + "/api/health", wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            rec["at_rest"] = {"state": page.evaluate(w.STATE_JS, ACCOUNT_ID),
                              "locks": page.evaluate(LOCKS_JS),
                              "notes": page.evaluate(w.NOTES_JS)}
            st = rec["at_rest"]["state"]
            print(f"AT REST   key={st.get('optInKey')!r} locks={st.get('locks')} "
                  f"stores={st.get('stores')} db={'present' if st.get('dbOpened') else 'MISSING'}",
                  flush=True)
            if st.get("optInKey") == "1":
                # ⛔ Refuse rather than measure a transition that has already happened.
                _write_json(out, dict(rec, status="STOPPED — the key is ALREADY '1' at rest; "
                                                  "this probe measures the 0->1 transition"))
                print("⛔ the key is already '1' at rest — that is a different question", flush=True)
                return 1

            # ── 2. THE MOUNT. The notebook LIST only — no `?note=`, nothing opened,
            #       nothing typed, no opt-in. Locks sampled throughout: a lock that
            #       is taken and dropped inside a second is invisible to one read.
            page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
            samples = []
            for ms in (1000, 2000, 3000, 4000, 5000):
                page.wait_for_timeout(ms)
                samples.append({"t_ms": sum(s["t_ms"] for s in samples) + ms if samples else ms,
                                "key": page.evaluate(
                                    "(k) => { try { return localStorage.getItem(k) } "
                                    "catch (e) { return 'ERR: ' + e.name } }", FLAG_KEY),
                                "locks": page.evaluate(LOCKS_JS)})
            rec["during_mount_samples"] = samples
            rec["after_mount"] = {"state": page.evaluate(w.STATE_JS, ACCOUNT_ID),
                                  "locks": page.evaluate(LOCKS_JS)}
            am = rec["after_mount"]["state"]
            print(f"AFTER MOUNT key={am.get('optInKey')!r} locks={am.get('locks')} "
                  f"held={am.get('held')} stores={am.get('stores')}", flush=True)

            # ── 3. NAVIGATE AWAY. Was any lock RELEASED?
            page.goto(PROD + "/api/health", wait_until="domcontentloaded")
            page.wait_for_timeout(4000)
            rec["after_leaving"] = {"state": page.evaluate(w.STATE_JS, ACCOUNT_ID),
                                    "locks": page.evaluate(LOCKS_JS),
                                    "notes": page.evaluate(w.NOTES_JS)}
            al = rec["after_leaving"]["state"]
            print(f"AFTER AWAY key={al.get('optInKey')!r} locks={al.get('locks')}", flush=True)
    finally:
        killed, left, others, released, held = w.teardown(None)
        rec["teardown"] = {"killed": killed, "survivors": left, "lock_released": released}

    # ── 4. THE DISK, AFTER. Chrome is dead again.
    after_disk = w.localstorage_on_disk(FLAG_KEY)
    rec["key_on_disk_after"] = {"value": after_disk.get("value"),
                                "appends": after_disk.get("appends"),
                                "tail": (after_disk.get("sequence") or "")[-12:]}

    a, z = rec.get("at_rest", {}), rec.get("after_leaving", {})
    key_before = (a.get("state") or {}).get("optInKey")
    key_after = (z.get("state") or {}).get("optInKey")
    any_sample_flipped = any(s.get("key") != key_before for s in rec.get("during_mount_samples") or [])
    lock_taken = any((s.get("locks") or {}).get("held")
                     for s in rec.get("during_mount_samples") or []
                     if isinstance(s.get("locks"), dict))
    lock_after = (z.get("locks") or {}).get("held") if isinstance(z.get("locks"), dict) else "ERR"

    notes_before = (a.get("notes") or {}).get("total")
    notes_after = (z.get("notes") or {}).get("total")
    rec["answer"] = {
        "key_changed_by_the_mount": key_after != key_before or any_sample_flipped,
        "key_before": key_before, "key_after": key_after,
        "key_on_disk_unchanged": rec["key_on_disk_before"] == rec["key_on_disk_after"],
        "a_sync_lock_was_taken_during_mount": bool(lock_taken),
        "locks_held_after_leaving": lock_after,
        "notes_before": notes_before, "notes_after": notes_after,
        "notes_unchanged": notes_before == notes_after,
    }
    # ⛔ STATED AS NARROWLY AS IT WAS MEASURED. This is one profile, one starting
    # value, one bundle. It is not "the app never writes the key".
    scope = ("with live stores present, starting from '0', on the rig profile, "
             "notebook LIST only, no opt-in")
    rec["verdict"] = (
        f"⛔ MOUNTING CHANGED THE KEY ({scope})" if rec["answer"]["key_changed_by_the_mount"]
        else f"mounting did NOT change the key — {scope}. This refutes THAT claim and no wider one.")
    _write_json(out, dict(rec, status="COMPLETE"))
    print(f"\nVERDICT: {rec['verdict']}")
    print(f"lock taken during mount: {rec['answer']['a_sync_lock_was_taken_during_mount']} · "
          f"held after leaving: {lock_after}")
    print(f"notes {notes_before} -> {notes_after} · disk {rec['key_on_disk_before']['value']!r} "
          f"-> {rec['key_on_disk_after']['value']!r}")
    print(f"artifact: {out}")
    return 0


def clear_probe_key(out_path: pathlib.Path | None = None) -> int:
    """RECORD the probe key's value with a timestamp, THEN remove it.

    ⛔ Recorded first, and the removal is refused if the record did not write.
    A stray key on the rig is exactly the class of unexplained state that just
    cost three runs of diagnosis; leaving one behind because it is "inert" is how
    the next investigation starts from a profile nobody can account for.
    ⭐ It only ever touches `uct.q1.rigprobe.*` — the product's flag is not read,
    not written, and not in scope here.
    """
    from playwright.sync_api import sync_playwright

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_path or (w.ROOT / ".worktrees" / "q1-dry-run" / f"probe-key-cleared-{stamp}.json")
    rec = {"at": utc(), "mode": "clear-probe-key", "profile": str(w.PROFILE),
           "key": PROBE_KEY, "never_touched": FLAG_KEY,
           "status": "INCOMPLETE — the run did not finish"}
    _write_json(out, rec)

    try:
        proc, endpoint, version = w.spawn_rig()
    except SystemExit as e:
        _write_json(out, dict(rec, status=f"REFUSED — {e}"))
        return 1
    try:
        if not version:
            _write_json(out, dict(rec, status="STOPPED — CDP never answered"))
            return 1
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            page.goto(PROD + "/api/health", wait_until="domcontentloaded")
            page.wait_for_timeout(2000)
            # ── 1. RECORD, and prove the record landed before removing anything.
            found = page.evaluate(
                "(k) => { try { const all = Object.keys(localStorage).filter(x => x.startsWith('uct.q1.rigprobe'));"
                "               return all.map(x => [x, localStorage.getItem(x)]) }"
                "         catch (e) { return 'ERR: ' + e.name } }", PROBE_KEY)
            rec["recorded_before_removal"] = found
            rec["recorded_at"] = utc()
            _write_json(out, dict(rec, status="RECORDED — before the removal"))
            if not (out.exists() and "recorded_before_removal" in out.read_text(encoding="utf-8")):
                _write_json(out, dict(rec, status="REFUSED — the record did not land; nothing removed"))
                return 1
            print(f"recorded: {found}", flush=True)

            # ── 2. REMOVE, then settle+navigate so the delete reaches disk.
            # ⛔ A REMOVAL FLUSHES NO FASTER THAN A WRITE. Measured 2026-09-10: a
            # remove + 1.5s + navigate + 1.5s + kill-by-marker read back as gone
            # IN MEMORY and the key was still there on the next open — twice. The
            # in-memory read is the instrument that cannot see this, which is the
            # whole finding. Settle long, navigate twice, and verify by REOPENING.
            page.evaluate(
                "() => { try { Object.keys(localStorage)"
                "          .filter(x => x.startsWith('uct.q1.rigprobe'))"
                "          .forEach(x => localStorage.removeItem(x)) } catch (e) {} }")
            page.wait_for_timeout(6000)
            page.goto(PROD + "/api/health", wait_until="domcontentloaded")
            page.wait_for_timeout(4000)
            page.goto(PROD + "/api/health", wait_until="domcontentloaded")
            page.wait_for_timeout(4000)
            after = page.evaluate(
                "() => { try { return Object.keys(localStorage).filter(x => x.startsWith('uct.q1.rigprobe')) }"
                "        catch (e) { return 'ERR: ' + e.name } }")
            rec["remaining_after_removal"] = after
            print(f"remaining: {after}", flush=True)
    finally:
        killed, left, others, released, held = w.teardown(None)
        rec["teardown"] = {"killed": killed, "survivors": left, "lock_released": released}

    # ⛔ Confirmed with Chrome DEAD — an in-memory removal is not a removed key.
    disk = w.localstorage_on_disk(PROBE_KEY)
    rec["on_disk_after"] = {"appends": disk.get("appends"), "value": disk.get("value")}
    ok = rec.get("remaining_after_removal") == []
    _write_json(out, dict(rec, status="COMPLETE" if ok else "COMPLETE — the key did not clear"))
    print(f"\non-disk after (Chrome dead): {rec['on_disk_after']}\nartifact: {out}")
    return 0 if ok else 1


def rig_opt_out(out_path: pathlib.Path | None = None) -> int:
    """⛔⛔ THE ONLY WRITE THIS TOOL EVER MAKES TO THE RIG PROFILE, on request only.

    It sets ONE localStorage key back to `'0'`. Nothing else on that profile is
    touched and the profile is never recreated.

    ⭐ IT RECORDS THE BEFORE-VALUE FIRST, with a timestamp, so Phase 2 starts from
    a DOCUMENTED state rather than a tidy one — tidying without recording destroys
    the evidence that something set it.

    ⛔ And it measures whether the value STICKS across a notebook mount. If the
    app writes the key back, the rig can never opt out by localStorage alone and
    that is a product finding, not a rig one. Those two look identical from the
    outside, which is why this asks instead of assuming.
    """
    from playwright.sync_api import sync_playwright

    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = out_path or (w.ROOT / ".worktrees" / "q1-dry-run" / f"rig-opt-in-key-{stamp}.json")
    rec = {"at": utc(), "action": "restore the rig profile's opt-in key to '0'",
           "profile": str(w.PROFILE), "key": FLAG_KEY,
           "status": "INCOMPLETE — the run did not finish"}
    _write_json(out, rec)

    try:
        proc, endpoint, version = w.spawn_rig()
    except SystemExit as e:
        _write_json(out, dict(rec, status=f"REFUSED — {e}"))
        print(f"⛔ {e}", flush=True)
        return 1
    try:
        if not version:
            _write_json(out, dict(rec, status="STOPPED — the CDP endpoint never answered"))
            return 1
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()

            # ── 1. READ AND RECORD, before touching anything. /dashboard, not the
            #       notebook: mounting the notebook is what could change the value.
            page.goto(PROD + "/dashboard", wait_until="domcontentloaded")
            page.wait_for_timeout(4000)
            first = page.evaluate(DRY_READ_JS, FLAG_KEY)
            rec.update(observed_at_rest=first.get("optInKey"),
                       observed_at=utc(), notes_before=first.get("notes"),
                       auth_status=first.get("authStatus"))
            _write_json(out, dict(rec, status="RECORDED — before the write"))
            print(f"observed at rest: {FLAG_KEY} = {first.get('optInKey')!r} "
                  f"(notes={first.get('notes')})", flush=True)

            # ── 2. THE WRITE, read back immediately.
            wrote = page.evaluate(
                "(k) => { try { localStorage.setItem(k, '0'); return localStorage.getItem(k) }"
                "        catch (e) { return 'ERR: ' + e.name } }", FLAG_KEY)
            rec["after_write"] = wrote
            print(f"after the write:  {FLAG_KEY} = {wrote!r}", flush=True)

            # ── 3. DOES IT STICK? Mount the very page that could rewrite it. With
            #      the key at '0' and OFFLINE_DEFAULT_ON false the layer stays
            #      inert, so this is the safest state to ask the question in.
            page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(9000)
            after = page.evaluate(DRY_READ_JS, FLAG_KEY)
            rec.update(after_notebook_mount=after.get("optInKey"),
                       notes_after=after.get("notes"))
            print(f"after a notebook mount: {FLAG_KEY} = {after.get('optInKey')!r}", flush=True)

            rewritten = after.get("optInKey") == "1"
            if rewritten:
                rec["finding"] = (
                    "THE APP REWROTE THE OPT-IN KEY. It was set to '0' and read back "
                    "'1' after mounting /journal/notebook — the rig cannot opt out by "
                    "localStorage alone, and this is a PRODUCT finding, not a rig one.")
                print("\n\U0001f6a8 " + rec["finding"], flush=True)

            # ── 4. Leave it at rest, off the notebook, and prove the final state.
            page.goto(PROD + "/dashboard", wait_until="domcontentloaded")
            page.wait_for_timeout(3000)
            page.evaluate("(k) => { try { localStorage.setItem(k, '0') } catch (e) {} }", FLAG_KEY)
            final = page.evaluate(DRY_READ_JS, FLAG_KEY)
            rec.update(final_at_rest=final.get("optInKey"), notes_final=final.get("notes"))
            ok = (final.get("optInKey") == "0"
                  and final.get("notes") == first.get("notes")
                  and not rewritten)
            _write_json(out, dict(rec, status="COMPLETE" if ok else "COMPLETE WITH A FINDING",
                                  restored=final.get("optInKey") == "0"))
            print(f"\nfinal at rest:    {FLAG_KEY} = {final.get('optInKey')!r} · "
                  f"notes {first.get('notes')} → {final.get('notes')}")
            print(f"artifact: {out}")
            return 0 if ok else 1
    finally:
        killed, left, others, released, held = w.teardown(None)
        print(f"teardown: killed {killed} by marker · {len(left)} left · "
              f"owner's browser {others} untouched · lock released={released}", flush=True)


def _row(r: Result) -> dict:
    # ⛔ `engine` carries the LABEL. `engine_id` is beside it for machines; a
    # reader who copies one row out of this file gets the caveat with it.
    return {"engine": r.engine, "engine_id": r.id,
            "green": r.green, "caps": r.caps, "facts": r.facts,
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
    ap.add_argument("--put-latency", action="store_true",
                    help="measure REAL note-update PUT latency (and the 409 path's GET) "
                         "against production from the rig. One scratch note, cleaned up.")
    ap.add_argument("--live-stores-probe", action="store_true",
                    help="does mounting the notebook on the RIG (live stores present) "
                         "change the opt-in key, and is a uct.nb.sync.* lock taken and "
                         "released? Zero writes; nothing is deleted or trashed.")
    ap.add_argument("--clear-probe-key", action="store_true",
                    help="RECORD then REMOVE the rig-owned probe key. A profile with "
                         "unexplained keys on it is the thing we cannot reason about.")
    ap.add_argument("--mount-probe", action="store_true",
                    help="does mounting /journal/notebook write the opt-in key? "
                         "Runs in throwaway contexts; never touches the rig profile.")
    ap.add_argument("--flush-probe", action="store_true",
                    help="does kill-by-marker lose an unflushed localStorage write? "
                         "Uses a rig-owned probe key; never touches the offline flag.")
    ap.add_argument("--capture-fork", action="store_true",
                    help="READ-ONLY: preserve the forked pair + every sync-conflict "
                         "note, and answer whether any words were lost. Never opens "
                         "the notebook, never writes.")
    ap.add_argument("--rig-opt-out", action="store_true",
                    help="record the rig profile's opt-in key, then restore it to '0' "
                         "(the only write this tool makes to that profile)")
    ap.add_argument("--out", default=None, help="where the results file goes")
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
    _out = pathlib.Path(args.out).resolve() if args.out else None
    if args.capture_fork:
        return capture_fork(_out)
    if args.flush_probe:
        return flush_probe(_out)
    if args.mount_probe:
        return mount_probe(_out)
    if args.put_latency:
        return put_latency(_out)
    if args.live_stores_probe:
        return live_stores_probe(_out)
    if args.clear_probe_key:
        return clear_probe_key(_out)
    if args.rig_opt_out:
        return rig_opt_out(_out)
    if args.dry_run:
        return dry_run(resolve_engine(args.only) if args.only else None, _out)

    from playwright.sync_api import sync_playwright

    print("reading the session from the rig's own profile…", flush=True)
    cookie = session_cookie_from_rig()
    print(f"  got `uct_session` for {cookie['domain']} (value not printed)\n", flush=True)

    engines = [e for e in ENGINE_IDS if e != "chromium-rig"]
    if args.only:
        engines = [resolve_engine(args.only)]

    results = []
    with sync_playwright() as pw:
        for name in engines:
            print(f"\n{'=' * 70}\n  ENGINE: {engine_label(name)}\n{'=' * 70}", flush=True)
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
                elif name == "mobile-chromium":
                    # ⛔ CHROMIUM under an iPhone descriptor — the Android-shaped
                    # lane, deliberately (owner, 2026-09-10). NOT iOS; the label
                    # says so wherever this row is read.
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
        print(f"  {r.engine:58} {'✅' if r.green else '🚨' if r.findings else '⛔'}  {ok}/{len(r.steps)} steps"
              f"  locks={r.caps.get('locks')}")
        findings += r.findings
    print(f"\n  ⭐ {IOS_NOTE}.")
    if findings:
        print("\n🚨 FINDINGS")
        for f in findings:
            print("   -", f)
    payload = {"at": utc(), "reading_note": IOS_NOTE,
               "engines": [_row(r) for r in results]}
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
    dry_src = src.split("# THE DRY RUN", 1)[-1].split("END OF THE READ-ONLY DRY RUN", 1)[0]

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
    # ⛔ The sweep's boundary is a NAMED sentinel — an implicit one ("everything
    # before `def main`") swallowed `rig_opt_out` the moment it was written.
    cases.append(("the read-only region is bounded by a named sentinel",
                  "END OF THE READ-ONLY DRY RUN" in src and "def rig_opt_out" not in dry_src))
    opt_src = src.split("def rig_opt_out", 1)[1].split("\ndef _row", 1)[0]
    cases.append(("the ONE deliberate write is the flag key, and nothing else",
                  opt_src.count("localStorage.setItem") == opt_src.count("(k, '0')")))
    cases.append(("…and it records the BEFORE value before it writes",
                  opt_src.index("observed_at_rest") < opt_src.index("2. THE WRITE")))
    cases.append(("…and it asks whether the app writes the key back",
                  "after_notebook_mount" in opt_src and "PRODUCT finding" in opt_src))
    # ⛔ A SWEEP THAT CAN MATCH ITS OWN NEEDLE PROVES NOTHING — spelling the
    # forbidden call literally here would make this file contain it. Same trap the
    # `fetch =` sweep above sidesteps; this one caught itself on its first run.
    del_needles = ["shutil." + "rmtree", "os." + "rmdir", ".unl" + "ink()"]
    body = src.split("def self_check", 1)[0]
    cases.append(("no profile is ever deleted by this tool",
                  not any(n in body for n in del_needles)))
    cases.append(("CONTROL: that sweep can see a delete when there is one",
                  any(n in (body + del_needles[0]) for n in del_needles)))

    # ══════════════════════════════════════════════════════════════════════════
    # THE LABELS. ⛔ A row name is a claim about a platform, and three of these
    # five would otherwise be read as something we did not test. Owner rulings,
    # 2026-09-10. These are STRUCTURAL — the label is the artifact key — so they
    # are railed here rather than left to a reviewer's eye.
    # ══════════════════════════════════════════════════════════════════════════
    cases.append(("every engine id has a label",
                  all(engine_label(e) != e for e in ENGINE_IDS)))
    cases.append(("⛔ the mobile lane cannot be read as iOS",
                  "NOT iOS" in engine_label("mobile-chromium")
                  and "mobile-chromium" in engine_label("mobile-chromium")))
    cases.append(("…and the bare name `mobile` is gone from the id set",
                  "mobile" not in ENGINE_IDS and "mobile-chromium" in ENGINE_IDS))
    cases.append(("…but `--only mobile` still resolves, so nothing breaks",
                  resolve_engine("mobile") == "mobile-chromium"
                  and resolve_engine("webkit") == "webkit"))
    cases.append(("⛔ webkit cannot be read as Safari on a device",
                  "NOT Safari on a real device" in engine_label("webkit")))
    cases.append(("⛔ edge cannot be read as current Edge",
                  "NOT current Edge" in engine_label("edge")))
    cases.append(("…and edge's version is MEASURED off the binary, never typed",
                  "VersionInfo.ProductVersion" in src and "119.0" not in body))
    cases.append(("the label reaches the ARTIFACT key, not just the screen",
                  _row(Result("mobile-chromium"))["engine"] == engine_label("mobile-chromium")
                  and _row(Result("mobile-chromium"))["engine_id"] == "mobile-chromium"))
    cases.append(("a sub-row keeps its suffix AND its label",
                  engine_label("mobile-chromium/cleanup").endswith("/cleanup")
                  and "NOT iOS" in engine_label("mobile-chromium/cleanup")))
    cases.append(("the iOS-shaped answer is named, in one sentence",
                  "webkit" in IOS_NOTE and "NOT iOS" in IOS_NOTE))
    cases.append(("…and that sentence is printed AND stored, not just defined",
                  src.count("IOS_NOTE") >= 4))

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
