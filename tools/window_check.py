"""Wave Q1 — ONE COMMAND FOR A WINDOW-WATCH CHECK, INCLUDING A DAILY MINI-CANARY.

    python tools/window_check.py                 # run a check and stamp a row
    python tools/window_check.py --self-check    # prove every refusal fires
    python tools/window_check.py --dry-run       # run, print the row, write nothing
    python tools/window_check.py --label "check 5"
    python tools/window_check.py --no-canary     # reads only, skip the mini-canary

WHAT A RUN DOES
  reads      four durable stores · notebook locks · the opt-in key · the note
             count · leftover canary/conflict notes · both telemetry counts
  canary     opt in → create → type online → offline → type → reload ONLINE →
             reconnect → cleanup, capturing the artifact at every step
  teardown   by PROFILE MARKER, never by count; the owner's browser is verified
             by COMMAND LINE; the throwaway profile is deleted
  stamp      one UTC-stamped row appended to the resume doc

⛔⛔ THREE REFUSALS, AND EACH ONE HAS A TEST
  1. ANY read failed          ⇒ no row is written at all.
  2. ANY `null`/`''` baseline ⇒ the run FAILS LOUDLY, the row is headed
                                **NEW FINDING**, and the canary note is LEFT IN
                                PLACE for inspection.
  3. ANY empty document       ⇒ the same. That is the 2026-09-09 incident's own
                                shape and it must never be tidied away.
A run that finds something and then deletes the evidence is worse than no run.

⛔ THE FLAG CONSTANT IS NEVER TOUCHED. The canary sets the per-browser
`localStorage` opt-in inside its own throwaway profile — the documented §15
mechanism — and sets it back to `'0'` at cleanup. `OFFLINE_DEFAULT_ON` is not
this script's to change and it does not read as though it were.

⛔ THE RELOAD IS PERFORMED WITH THE NETWORK UP. Wave Q1 has no service worker,
so an offline reload cannot fetch `index.html`: the SPA never loads and storage
is not readable from that context. That step would prove nothing. The amended
§15 ordering is *open → edit offline → reload (network up) → recover*.

⛔ CREDENTIALS: read from `.env` (gitignored), used only to fill the login form,
never printed, stored, or put in a command line. Identity is asserted by ACCOUNT
ID, never by echoing an address.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone

ROOT = pathlib.Path(__file__).resolve().parent.parent
DOC = ROOT / "docs" / "notebook" / "wave-q1-RESUME-HERE.md"
LOG = ROOT / "docs" / "notebook" / "window-check.log"
ENV = ROOT / ".env"
PROD = "https://uctintelligence.com"
ACCOUNT_ID = "7a6d0299-fd98-4017-b8dc-51b849d1ab1d"

# ⭐ The unambiguous teardown marker: it is in the profile path, therefore in the
# spawned browser's command line, and it CANNOT match anyone else's Chrome.
MARKER = "uct-window-check-profile"
CHROME = pathlib.Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

ANCHOR = "## \U0001f4cb THE WINDOW-WATCH LOG"
FLAG_KEY = "uct.j2.offline.enabled"
BLOCKED_EVENT = "j2:notebook_blocked_no_baseline"
OPT_IN_EVENT = "j2:notebook_offline_opt_in"

SENTINEL = "WINDOW-CHECK-SENTINEL"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ══════════════════════════════════════════════════════════════════════════════
# THE TWO FINDING DETECTORS. Pure, so `--self-check` can drive them with
# synthetic artifacts — a detector nobody has watched fire is not a detector.
# ══════════════════════════════════════════════════════════════════════════════

def _walk(obj, path=""):
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from _walk(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            yield from _walk(v, f"{path}[{i}]")
    else:
        yield path, obj


def baseline_findings(label: str, artifact) -> list:
    """Every `baseUpdatedAt` in the artifact must be a non-blank string.

    ⛔ `null` is the 2026-09-09 incident. `''` is the second defect found while
    hunting it (`??` picks it, `if (x)` drops it). They are DIFFERENT findings
    and are reported as different words, because collapsing them answers the
    wrong question.
    """
    out = []
    for path, value in _walk(artifact):
        if not path.split(".")[-1].startswith("baseUpdatedAt"):
            continue
        if value is None:
            out.append(f"`{label}.{path}` is **null** \u2014 a write with NO compare-and-set")
        elif not isinstance(value, str):
            out.append(f"`{label}.{path}` is a **{type(value).__name__}**, not a timestamp")
        elif value.strip() == "":
            out.append(f"`{label}.{path}` is **{'an empty string' if value == '' else 'whitespace'}** \u2014 falsy at the consumer")
    return out


def _doc_has_text(node) -> bool:
    if isinstance(node, dict):
        if node.get("type") == "text" and str(node.get("text", "")).strip():
            return True
        return any(_doc_has_text(c) for c in node.get("content", []) or [])
    if isinstance(node, list):
        return any(_doc_has_text(c) for c in node)
    return False


def empty_document_findings(label: str, artifact, expect_text: bool = True) -> list:
    """A layer that is supposed to be holding the member's words must hold them.

    ⛔ THIS IS THE INCIDENT'S OWN SHAPE: `{title:"", subtitle:"", body:{doc,
    [paragraph]}}` — an empty paragraph reads as a document until you ask
    whether any of it is text. `content: []` and `[{paragraph}]` are both empty.
    """
    if not expect_text:
        return []
    out = []
    body = artifact.get("bodyJson") if isinstance(artifact, dict) else None
    if body is not None and not _doc_has_text(body):
        out.append(f"`{label}.bodyJson` holds **no text** \u2014 the empty-document shape")
    if isinstance(artifact, dict) and "patch" in artifact and isinstance(artifact["patch"], dict):
        pb = artifact["patch"].get("bodyJson")
        if pb is not None and not _doc_has_text(pb):
            out.append(f"`{label}.patch.bodyJson` holds **no text** \u2014 the empty-document shape")
    return out


def should_clean_up(findings: list) -> bool:
    """⛔⛔ A run that finds something and then deletes the evidence is worse
    than no run. The canary note stays exactly where it is."""
    return not findings


# ══════════════════════════════════════════════════════════════════════════════
# result objects
# ══════════════════════════════════════════════════════════════════════════════

@dataclass
class Read:
    name: str
    ok: bool
    value: object = None
    error: str = ""

    def render(self) -> str:
        if not self.ok:
            return f"\u26d4 **FAILED** \u2014 {self.error or 'no reading'}"
        return str(self.value)


@dataclass
class Check:
    label: str
    started: str = field(default_factory=utc_now)
    reads: list = field(default_factory=list)
    canary: list = field(default_factory=list)      # list[Read]
    findings: list = field(default_factory=list)
    canary_ran: bool = False

    def add(self, name, ok, value=None, error=""):
        self.reads.append(Read(name, ok, value, error))
        return self.reads[-1]

    def step(self, name, ok, value=None, error=""):
        self.canary.append(Read(name, ok, value, error))
        return self.canary[-1]

    @property
    def complete(self) -> bool:
        """⛔ THE GATE. One failed read and no row is written."""
        return bool(self.reads) and all(r.ok for r in self.reads) and all(s.ok for s in self.canary)

    @property
    def failures(self) -> list:
        return [r for r in self.reads + self.canary if not r.ok]

    def row(self) -> str:
        head = f"### {self.label} — **{self.started}**"
        lines = []
        if self.findings:
            lines += [
                head,
                "",
                "## \U0001f6a8\U0001f6a8 NEW FINDING — STOP AND READ THIS",
                "",
                "⛔ The daily mini-canary found the shape this whole wave exists to",
                "prevent. **The canary note was deliberately NOT deleted** — the artifact",
                "is on the account for inspection.",
                "",
            ]
            for f in self.findings:
                lines.append(f"- {f}")
            lines.append("")
        else:
            lines += [head, ""]
        lines += ["| | reading |", "|---|---|"]
        for r in self.reads:
            lines.append(f"| {r.name} | {r.render()} |")
        if self.canary_ran:
            lines.append("| **mini-canary** | " + (
                "\U0001f6a8 **NEW FINDING — see above**" if self.findings
                else f"\u2705 **{sum(1 for s in self.canary if s.ok)}/{len(self.canary)}** steps green"
            ) + " |")
            for s in self.canary:
                lines.append(f"| \u2003↳ {s.name} | {s.render()} |")
        else:
            lines.append("| **mini-canary** | \u2014 not run this pass |")
        lines.append("")
        return "\n".join(lines)


# ══════════════════════════════════════════════════════════════════════════════
# rig plumbing
# ══════════════════════════════════════════════════════════════════════════════

def free_port() -> int:
    """⛔ A PORT IS NOT A SERVER IDENTITY — binding proves nothing on Windows.
    An ephemeral port narrows the odds; the caller verifies the endpoint."""
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def port_is_busy(port: int) -> bool:
    s = socket.socket()
    s.settimeout(1.0)
    try:
        s.connect(("127.0.0.1", port))
        return True
    except OSError:
        return False
    finally:
        s.close()


def read_credentials():
    if not ENV.exists():
        raise SystemExit(
            f"STOP: {ENV} is missing. The canary credentials live there as "
            "CANARY_EMAIL / CANARY_PASSWORD. This script does not look anywhere else."
        )
    email = password = None
    for line in ENV.read_text(encoding="utf-8", errors="replace").splitlines():
        line = line.strip()
        if line.startswith("CANARY_EMAIL="):
            email = line.split("=", 1)[1].strip().strip('"').strip("'")
        elif line.startswith("CANARY_PASSWORD="):
            password = line.split("=", 1)[1].strip().strip('"').strip("'")
    if not email or not password:
        raise SystemExit("STOP: .env has no CANARY_EMAIL / CANARY_PASSWORD.")
    return email, password


def browser_processes():
    """⛔ NEVER COUNT `chrome.exe`. Chrome reaps renderer children constantly and
    a count false-alarmed on 2026-09-10. Only BROWSER processes (no `--type=`)."""
    ps = (
        "Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
        "Where-Object { $_.CommandLine -notlike '*--type=*' } | "
        "ForEach-Object { $_.ProcessId.ToString() + '|' + ($_.CommandLine -like '*" + MARKER + "*') }"
    )
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = []
    for line in r.stdout.splitlines():
        line = line.strip()
        if "|" in line:
            pid, mine = line.split("|", 1)
            try:
                out.append((int(pid), mine.strip().lower() == "true"))
            except ValueError:
                pass
    return out


def kill_by_marker() -> int:
    ps = (
        "$c = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
        "Where-Object { $_.CommandLine -like '*" + MARKER + "*' }; "
        "($c | Measure-Object).Count; "
        "$c | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
    )
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    first = (r.stdout.strip().splitlines() or ["0"])[0]
    try:
        return int(first)
    except ValueError:
        return 0


# ══════════════════════════════════════════════════════════════════════════════
# page-side reads
# ══════════════════════════════════════════════════════════════════════════════

STATE_JS = """async (acct) => {
  const out = {};
  try {
    const q = await navigator.locks.query();
    const nb = [...q.held, ...q.pending].filter(l => String(l.name).startsWith('uct.nb.sync.'));
    out.locks = nb.length;
    out.held = (q.held || []).filter(l => String(l.name).startsWith('uct.nb.sync.'))
                             .map(l => l.mode);
    out.pending = (q.pending || []).filter(l => String(l.name).startsWith('uct.nb.sync.')).length;
  } catch { out.locks = 'ERR' }
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('uct_notebook_' + acct);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    out.dbOpened = true;
    out.storeNames = [...db.objectStoreNames];
    const counts = {};
    for (const s of out.storeNames) {
      counts[s] = await new Promise(res => {
        const t = db.transaction(s, 'readonly').objectStore(s).getAll();
        t.onsuccess = () => res((t.result || []).length); t.onerror = () => res('ERR');
      });
    }
    out.stores = counts;
  } catch (e) { out.stores = 'ERR: ' + e.name; out.dbOpened = false }
  out.optInKey = localStorage.getItem('uct.j2.offline.enabled');
  return out;
}"""

LAYERS_JS = """async ({acct, id}) => {
  const out = {noteId: id};
  try {
    out.draft = JSON.parse(localStorage.getItem('uct.j2.notedraft.' + id) || 'null');
  } catch { out.draft = 'ERR' }
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('uct_notebook_' + acct);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    out.record = await new Promise(res => {
      const t = db.transaction('notes','readonly').objectStore('notes').get(id);
      t.onsuccess = () => res(t.result || null); t.onerror = () => res('ERR');
    });
    const all = await new Promise(res => {
      const t = db.transaction('outbox','readonly').objectStore('outbox').getAll();
      t.onsuccess = () => res(t.result || []); t.onerror = () => res([]);
    });
    out.outbox = all.filter(e => e.noteId === id);
  } catch (e) { out.record = 'ERR: ' + e.name; out.outbox = 'ERR' }
  try {
    const r = await fetch('/api/j2/notes/' + id, {credentials:'include'});
    out.server = r.ok ? (await r.json()).note : {status: r.status};
  } catch (e) { out.server = 'OFFLINE' }
  return out;
}"""

NOTES_JS = """async () => {
  const r = await fetch('/api/j2/notes?limit=300', {credentials:'include'});
  if (!r.ok) return {ok:false, status:r.status};
  const list = await r.json();
  const notes = list.notes || [];
  return {ok:true, total: notes.length,
    canary: notes.filter(n => /CANARY|WINDOW-CHECK/i.test(n.title || '')).map(n => n.title),
    conflicts: notes.filter(n => (n.tags || []).includes('sync-conflict')).map(n => n.title)};
}"""

ACTIVITY_JS = """async (names) => {
  const r = await fetch('/api/admin/activity?limit=200', {credentials:'include'});
  if (!r.ok) return {ok:false, status:r.status};
  const rows = await r.json();
  const out = {ok:true};
  for (const n of names) {
    const hits = rows.filter(x => x.action === n);
    out[n] = {count: hits.length, latest: hits.length ? hits[0].created_at : null};
  }
  return out;
}"""


# ══════════════════════════════════════════════════════════════════════════════
# the run
# ══════════════════════════════════════════════════════════════════════════════

def run_check(label: str, with_canary: bool) -> Check:
    from playwright.sync_api import sync_playwright

    chk = Check(label=label)
    email, password = read_credentials()
    if not CHROME.exists():
        raise SystemExit(f"STOP: no Chrome at {CHROME}")

    port = free_port()
    if port_is_busy(port):
        raise SystemExit(f"STOP: something already answers on 127.0.0.1:{port}")

    profile = pathlib.Path(tempfile.mkdtemp(prefix=MARKER + "-"))
    proc = subprocess.Popen([
        str(CHROME), f"--user-data-dir={profile}",
        f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check", "--new-window", "about:blank",
    ])
    note_id = None
    try:
        endpoint = f"http://127.0.0.1:{port}"
        version = None
        for _ in range(30):
            try:
                import urllib.request
                with urllib.request.urlopen(endpoint + "/json/version", timeout=2) as r:
                    version = json.loads(r.read().decode())
                break
            except Exception:  # noqa: BLE001
                time.sleep(1)
        chk.add("rig", bool(version),
                f"PID **{proc.pid}** \u00b7 {version['Browser']} \u00b7 CDP `127.0.0.1:{port}` \u00b7 fresh profile" if version else None,
                "CDP endpoint never answered")
        if not version:
            return chk

        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            cdp = page.context.new_cdp_session(page)
            cdp.send("Network.enable")

            def offline(flag):
                cdp.send("Network.emulateNetworkConditions", {
                    "offline": flag, "latency": 0,
                    "downloadThroughput": 0 if flag else -1,
                    "uploadThroughput": 0 if flag else -1})

            puts = []
            page.on("request", lambda r: puts.append({
                "url": r.url, "baseUpdatedAt": _put_baseline(r),
            }) if r.method == "PUT" and "/api/j2/notes/" in r.url else None)

            probe = ("async () => await fetch('/api/health', {cache:'no-store'})"
                     ".then(r => 'ONLINE ' + r.status).catch(e => 'FAILED: ' + e.name)")

            offline(False)
            page.goto(PROD + "/login", wait_until="domcontentloaded")
            page.wait_for_timeout(3500)

            offline(True); page.wait_for_timeout(800)
            off, off_flag = page.evaluate(probe), page.evaluate("() => navigator.onLine")
            offline(False); page.wait_for_timeout(800)
            on, on_flag = page.evaluate(probe), page.evaluate("() => navigator.onLine")
            chk.add("offline proven both ways",
                    off.startswith("FAILED") and off_flag is False and on.startswith("ONLINE") and on_flag is True,
                    f"offline \u21d2 `{off}`, `onLine={str(off_flag).lower()}` \u00b7 online \u21d2 `{on}`, `{str(on_flag).lower()}`",
                    "CDP offline did not cut the transport")

            signed = False
            try:
                page.fill('input[type="email"], input[name="email"]', email)
                page.fill('input[type="password"], input[name="password"]', password)
                page.click('button[type="submit"]')
                page.wait_for_timeout(6000)
                me = page.evaluate("""async () => {
                    const r = await fetch('/api/auth/me', {credentials:'include'});
                    let b = null; try { b = await r.json() } catch {}
                    return {status: r.status, id: b?.user?.id ?? b?.id ?? null};
                }""")
                signed = me["status"] == 200
            except Exception as e:  # noqa: BLE001
                me = {"status": f"exception:{type(e).__name__}", "id": None}
            del password
            chk.add("signed in", signed and me.get("id") == ACCOUNT_ID,
                    f"`/api/auth/me` **200**, account `{me.get('id')}`" if signed else None,
                    f"/api/auth/me returned {me.get('status')}")
            if not signed:
                return chk

            page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(7000)

            st = page.evaluate(STATE_JS, ACCOUNT_ID)
            stores_ok = isinstance(st.get("stores"), dict)
            chk.add("four durable stores", stores_ok,
                    " \u00b7 ".join(f"`{k}` {v}" for k, v in st["stores"].items()) if stores_ok else str(st.get("stores")),
                    "could not read the per-account database")
            chk.add("notebook locks", st.get("locks") != "ERR",
                    f"**{st.get('locks')}** `uct.nb.sync.*`", "navigator.locks unavailable")
            key = st.get("optInKey")
            chk.add("opt-in key", True,
                    ("**unset**" if key is None else f"**`'{key}'`**")
                    + (" \u2014 the production default \u21d2 layer OFF" if key is None
                       else (" \u21d2 layer OFF" if key == "0" else " \u21d2 **OPTED IN**")))

            nt = page.evaluate(NOTES_JS)
            chk.add("notes", bool(nt.get("ok")),
                    f"**{nt.get('total')}** \u00b7 canary notes {len(nt.get('canary') or [])} \u00b7 `sync-conflict` {len(nt.get('conflicts') or [])}"
                    if nt.get("ok") else None,
                    f"GET /api/j2/notes returned {nt.get('status')}")

            act = page.evaluate(ACTIVITY_JS, [BLOCKED_EVENT, OPT_IN_EVENT])
            if act.get("ok"):
                bl, oi = act[BLOCKED_EVENT], act[OPT_IN_EVENT]
                chk.add("`j2:notebook_blocked_no_baseline`", True,
                        f"count **{bl['count']}** \u00b7 latest {bl['latest'] or '**none**'}")
                chk.add("opted-in browsers (`j2:notebook_offline_opt_in`)", True,
                        f"count **{oi['count']}** \u00b7 latest {oi['latest'] or '**none**'}"
                        + ("  \u26d4\u26d4 **zero events over zero opted-in browsers is not evidence**"
                           if oi["count"] == 0 else ""))
            else:
                for n in ("`j2:notebook_blocked_no_baseline`", "opted-in browsers (`j2:notebook_offline_opt_in`)"):
                    chk.add(n, False, error=f"GET /api/admin/activity returned {act.get('status')} (admin-only)")

            if with_canary:
                note_id = _mini_canary(chk, page, offline, probe, puts)
    finally:
        killed = kill_by_marker()
        time.sleep(2)
        procs = browser_processes()
        mine_left = [p for p, mine in procs if mine]
        others = [p for p, mine in procs if not mine]
        chk.add("teardown", not mine_left,
                f"killed **{killed}** by marker \u00b7 0 left \u00b7 owner's browser {others} untouched",
                f"{len(mine_left)} marked process(es) survived: {mine_left}")
        for _ in range(5):
            try:
                shutil.rmtree(profile)
                break
            except OSError:
                time.sleep(2)
        chk.add("profile deleted", not profile.exists(), f"`{profile.name}`",
                f"`{profile}` still on disk (a handle is held)")
        if chk.findings and note_id:
            chk.add("\U0001f6a8 evidence kept", True,
                    f"canary note **`{note_id}`** was NOT deleted \u2014 inspect it before anything else")
    return chk


def _put_baseline(req):
    try:
        body = req.post_data
        return json.loads(body).get("baseUpdatedAt", "<absent>") if body else "<no body>"
    except Exception:  # noqa: BLE001
        return "<unreadable>"


def _mini_canary(chk: Check, page, offline, probe, puts) -> str | None:
    """The §15 happy path, every day, with the artifact captured at every step."""
    chk.canary_ran = True
    note_id = None

    # 1 ── opt in. ⛔ The per-browser localStorage key inside a throwaway
    #      profile — NOT the flag constant, which this script never touches.
    page.evaluate("(k) => localStorage.setItem(k, '1')", FLAG_KEY)
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(7000)
    st = page.evaluate(STATE_JS, ACCOUNT_ID)
    ok1 = st.get("held") == ["exclusive"] and st.get("pending") == 0 and st.get("dbOpened") is True
    chk.step("1 opt in \u2192 leadership", ok1,
             f"held **{st.get('held')}**, pending **{st.get('pending')}**, DB opened with {len(st.get('storeNames') or [])} stores",
             f"expected exactly one EXCLUSIVE lock and an open DB; got held={st.get('held')} pending={st.get('pending')} dbOpened={st.get('dbOpened')}")

    # 2 ── create, open, type online
    created = page.evaluate("""async (t) => {
        const r = await fetch('/api/j2/notes', {method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({title: t, bodyJson: {type:'doc', content:[]}})});
        if (!r.ok) return {ok:false, status:r.status};
        const b = await r.json();
        return {ok:true, id: b.note?.id ?? b.id, updatedAt: b.note?.updatedAt};
    }""", f"{SENTINEL} {chk.started}")
    if not created.get("ok"):
        chk.step("2 create a note", False, error=f"POST /api/j2/notes returned {created.get('status')}")
        return None
    note_id = created["id"]
    puts.clear()
    page.goto(f"{PROD}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    typed_online = f"{SENTINEL} typed online."
    try:
        pm = page.query_selector(".ProseMirror")
        if pm:
            pm.click(); page.keyboard.type(typed_online)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(6000)
    online_puts = [p for p in puts if note_id in p["url"]]
    bases = [p["baseUpdatedAt"] for p in online_puts]
    ok2 = len(online_puts) >= 1 and all(isinstance(x, str) and x.strip() and x != "<absent>" for x in bases)
    chk.step("2 type online \u2192 one CAS PUT", ok2,
             f"**{len(online_puts)}** PUT(s), baseline(s) `{bases}`",
             f"expected at least one PUT carrying a real baseline; got {bases}")
    chk.findings += baseline_findings("online PUT", {"baseUpdatedAt": bases[0]} if bases else {})

    # 3 ── offline, type, then reload WITH THE NETWORK UP
    offline(True); page.wait_for_timeout(1000)
    pr = page.evaluate(probe)
    chk.step("3 offline is real", pr.startswith("FAILED"), f"`{pr}`", f"probe said `{pr}` \u2014 the transport was not cut")
    typed_offline = f"{SENTINEL} typed offline."
    try:
        pm = page.query_selector(".ProseMirror")
        if pm:
            pm.click(); page.keyboard.press("End"); page.keyboard.type(" " + typed_offline)
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(6000)
    before = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})

    # ⛔ NETWORK UP FIRST. Q1 has no service worker: an offline reload cannot
    #    load the SPA at all, so that ordering would prove nothing.
    offline(False); page.wait_for_timeout(1500)
    page.goto(f"{PROD}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    after = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})

    draft_ok = _doc_has_text((after.get("draft") or {}).get("bodyJson")) if isinstance(after.get("draft"), dict) else False
    rec = after.get("record") if isinstance(after.get("record"), dict) else {}
    rec_ok = _doc_has_text(rec.get("bodyJson"))
    ob = after.get("outbox") if isinstance(after.get("outbox"), list) else []
    ok3 = rec_ok and (draft_ok or bool(ob))
    chk.step("3 reload (network UP) \u2192 the words survive", ok3,
             f"record holds text: **{rec_ok}** \u00b7 draft holds text: **{draft_ok}** \u00b7 outbox entries: **{len(ob)}** \u00b7 baseline `{rec.get('baseUpdatedAt')}`",
             "a local layer came back without the member's words \u2014 THE INCIDENT'S SHAPE")
    for label, art in (("pre-reload record", before.get("record")), ("post-reload record", rec)):
        if isinstance(art, dict):
            chk.findings += baseline_findings(label, art)
            chk.findings += empty_document_findings(label, art)
    for e in (before.get("outbox") or []) + ob:
        if isinstance(e, dict):
            chk.findings += baseline_findings("outbox entry", e)

    # 4 ── reconnect and settle
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(12000)
    settled = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})
    srec = settled.get("record") if isinstance(settled.get("record"), dict) else {}
    srv = settled.get("server") if isinstance(settled.get("server"), dict) else {}
    server_has = _doc_has_text(srv.get("bodyJson"))
    ok4 = srec.get("dirty") == 0 and not (settled.get("outbox") or []) and server_has
    chk.step("4 reconnect \u2192 drained, re-based, server has the words", ok4,
             f"`dirty` **{srec.get('dirty')}** \u00b7 outbox **{len(settled.get('outbox') or [])}** \u00b7 server holds text: **{server_has}** \u00b7 baseline `{srec.get('baseUpdatedAt')}`",
             f"queue did not settle: dirty={srec.get('dirty')} outbox={len(settled.get('outbox') or [])} serverHasText={server_has}")
    chk.findings += baseline_findings("settled record", srec)

    # 5 ── cleanup, UNLESS there is something to look at
    if not should_clean_up(chk.findings):
        chk.step("5 cleanup", True,
                 "\U0001f6a8 **SKIPPED ON PURPOSE** \u2014 a finding is on the account and the evidence stays")
        return note_id
    page.evaluate("""async (id) => {
        await fetch('/api/j2/notes/' + id, {method:'DELETE', credentials:'include'});
    }""", note_id)
    page.evaluate("""async (acct) => {
        const db = await new Promise(res => { const r = indexedDB.open('uct_notebook_'+acct); r.onsuccess = () => res(r.result) });
        const stores = [...db.objectStoreNames];
        const tx = db.transaction(stores, 'readwrite');
        stores.forEach(s => tx.objectStore(s).clear());
        await new Promise(res => { tx.oncomplete = res; tx.onerror = res });
        for (const k of Object.keys(localStorage)) if (k.startsWith('uct.j2.notedraft.')) localStorage.removeItem(k);
        localStorage.setItem('uct.j2.offline.enabled','0');
    }""", ACCOUNT_ID)
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(7000)
    end = page.evaluate(STATE_JS, ACCOUNT_ID)
    end_notes = page.evaluate(NOTES_JS)
    zeroed = isinstance(end.get("stores"), dict) and all(v == 0 for v in end["stores"].values())
    ok5 = zeroed and end.get("locks") == 0 and end.get("optInKey") == "0" and not (end_notes.get("canary") or [])
    chk.step("5 cleanup \u2192 stores 0, locks 0, opted out", ok5,
             f"stores all zero: **{zeroed}** \u00b7 locks **{end.get('locks')}** \u00b7 key **`'{end.get('optInKey')}'`** \u00b7 leftover canary notes **{len(end_notes.get('canary') or [])}**",
             f"cleanup incomplete: zeroed={zeroed} locks={end.get('locks')} key={end.get('optInKey')}")
    return note_id


# ══════════════════════════════════════════════════════════════════════════════
# stamping + logging
# ══════════════════════════════════════════════════════════════════════════════

def log_line(text: str) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8", newline="") as fh:
            fh.write(f"{utc_now()}  {text}\n")
    except OSError:
        pass


def stamp(chk: Check, dry_run: bool = False) -> bool:
    """⛔⛔ A row is written only if EVERY read and EVERY canary step succeeded."""
    if not chk.complete:
        names = ", ".join(r.name for r in chk.failures)
        print(f"\u26d4 REFUSING TO STAMP: {len(chk.failures)} read(s)/step(s) failed \u2014 {names}")
        print("   A check log whose rows might be partial reads as evidence. Nothing was written.")
        # \u26d4 A dry run is a rehearsal, not a check. It must leave no line in the
        # daily log, or `--self-check` noise becomes indistinguishable from a
        # real refusal to whoever reads that file in a week's time.
        if not dry_run:
            log_line(f"{chk.label}: REFUSED \u2014 failed: {names}")
        return False
    if dry_run:
        print("--dry-run: the row below was NOT written\n")
        print(chk.row())
        return True
    text = DOC.read_text(encoding="utf-8")
    if ANCHOR not in text:
        print(f"\u26d4 REFUSING TO STAMP: cannot find the log heading in {DOC}")
        return False
    i = text.index(ANCHOR)
    j = text.find("\n### ", i)
    if j == -1:
        j = len(text)
    out = text[:j] + "\n" + chk.row() + text[j:]
    fd, tmp = tempfile.mkstemp(dir=str(DOC.parent), suffix=".tmp")
    os.close(fd)
    tmp = pathlib.Path(tmp)
    try:
        with tmp.open("w", encoding="utf-8", newline="") as fh:
            fh.write(out)
        os.replace(tmp, DOC)
    except BaseException:
        tmp.unlink(missing_ok=True)
        raise
    verdict = "NEW FINDING" if chk.findings else "green"
    print(f"\u2705 stamped: {chk.label} @ {chk.started} ({verdict})")
    log_line(f"{chk.label}: stamped, {verdict}, {len(chk.reads)} reads, {len(chk.canary)} canary steps")
    return True


def self_check() -> int:
    """Prove every refusal fires. No browser, no network, no document written."""
    cases = []

    bad = Check(label="self-check: a failed read")
    bad.add("rig", True, "fine"); bad.add("notes", False, error="500")
    cases.append(("a failed READ is refused", stamp(bad, dry_run=True) is False))

    badstep = Check(label="self-check: a failed canary step")
    badstep.add("rig", True, "fine")
    badstep.step("4 reconnect", False, error="queue did not settle")
    cases.append(("a failed CANARY STEP is refused", stamp(badstep, dry_run=True) is False))

    cases.append(("a run with NO reads is refused", stamp(Check(label="self-check: empty"), dry_run=True) is False))

    good = Check(label="self-check: every read ok")
    good.add("rig", True, "fine"); good.add("notes", True, "32")
    cases.append(("a complete run stamps", stamp(good, dry_run=True) is True))
    cases.append(("the row carries every reading", "| notes | 32 |" in good.row()))
    cases.append(("a failed read renders as FAILED", "FAILED" in bad.reads[1].render()))

    # ── the two finding detectors, driven with synthetic artifacts ───────────
    nulls = baseline_findings("outbox", {"baseUpdatedAt": None})
    empties = baseline_findings("outbox", {"baseUpdatedAt": ""})
    blanks = baseline_findings("outbox", {"baseUpdatedAt": "   "})
    wrongt = baseline_findings("outbox", {"baseUpdatedAt": 0})
    control = baseline_findings("outbox", {"baseUpdatedAt": "2026-09-10T05:00:00+00:00"})
    cases.append(("a NULL baseline is a finding", bool(nulls) and "null" in nulls[0]))
    cases.append(("an EMPTY-STRING baseline is a finding", bool(empties)))
    cases.append(("a WHITESPACE baseline is a finding", bool(blanks)))
    cases.append(("a NON-STRING baseline is a finding", bool(wrongt)))
    cases.append(("CONTROL: a real baseline is NOT a finding", control == []))
    cases.append(("nested baselines are found too",
                  bool(baseline_findings("layers", {"record": {"baseUpdatedAt": None}}))))

    empty_doc = empty_document_findings("record", {"bodyJson": {"type": "doc", "content": []}})
    empty_para = empty_document_findings("record", {"bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}})
    real_doc = empty_document_findings("record", {"bodyJson": {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "the member's words"}]}]}})
    cases.append(("an EMPTY document is a finding", bool(empty_doc)))
    cases.append(("the INCIDENT'S shape (empty paragraph) is a finding", bool(empty_para)))
    cases.append(("CONTROL: a document with text is NOT a finding", real_doc == []))

    cases.append(("a finding SUPPRESSES cleanup", should_clean_up(["x"]) is False))
    cases.append(("CONTROL: no finding allows cleanup", should_clean_up([]) is True))

    found = Check(label="self-check: a finding")
    found.add("rig", True, "fine")
    found.canary_ran = True
    found.step("3 reload", True, "fine")
    found.findings = nulls + empty_doc
    row = found.row()
    cases.append(("a finding heads the row NEW FINDING", "NEW FINDING" in row))
    cases.append(("the row names the evidence is kept", "NOT deleted" in row))

    bad_ct = 0
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad_ct += 0 if ok else 1
    print("self-check:", "PASS" if not bad_ct else f"FAIL ({bad_ct})")
    return 0 if not bad_ct else 1


def next_check_number() -> int:
    """Derived from the doc, never typed — two runs cannot both be 'check 4'."""
    try:
        text = DOC.read_text(encoding="utf-8")
    except OSError:
        return 1
    nums = [int(m) for m in re.findall(r"^### check (\d+)", text, re.M | re.I)]
    return (max(nums) + 1) if nums else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--label", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-canary", action="store_true", help="reads only")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    label = args.label or f"check {next_check_number()}"
    log_line(f"{label}: starting")
    try:
        chk = run_check(label, with_canary=not args.no_canary)
    except SystemExit as e:
        log_line(f"{label}: STOPPED \u2014 {e}")
        raise
    except BaseException as e:  # noqa: BLE001
        # \u26d4 The log must always close the loop. A run that logged "starting" and
        # then nothing is indistinguishable from a machine that slept through
        # the trigger, and the whole point of a daily log is telling those apart.
        log_line(f"{label}: CRASHED \u2014 {type(e).__name__}: {e}")
        raise
    print()
    for r in chk.reads + chk.canary:
        print(f"  {'ok  ' if r.ok else 'FAIL'} {r.name}: {r.render()}")
    if chk.findings:
        print("\n\U0001f6a8 NEW FINDING")
        for f in chk.findings:
            print("   -", f)
    print()
    ok = stamp(chk, args.dry_run)
    return 0 if (ok and not chk.findings) else 1


if __name__ == "__main__":
    sys.exit(main())
