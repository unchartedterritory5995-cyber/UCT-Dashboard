"""Wave Q1 — ONE COMMAND FOR A WINDOW-WATCH CHECK, INCLUDING A DAILY MINI-CANARY.

    python tools/window_check.py                 # run a check and stamp a row
    python tools/window_check.py --self-check    # prove every refusal fires
    python tools/window_check.py --dry-run       # run, print the row, write nothing
    python tools/window_check.py --park          # spawn the rig, park at /login, LEAVE IT UP
    python tools/window_check.py --label "check 6"
    python tools/window_check.py --no-canary     # reads only

⛔⛔ THERE IS NO CREDENTIALS FILE, AND THIS SCRIPT NEVER SIGNS IN.
The rig runs on a PERSISTENT Chrome profile that the owner signs into by hand,
once. The session cookie is a 30-day cookie, so one sign-in carries the whole
observation window. A script that could sign in would need the password on disk;
this one cannot, so there is nothing on disk to leak.

    .worktrees/canary-chrome-profile-persistent      (gitignored)

⛔ THE PROFILE IS NEVER DELETED. Deleting it would throw away the one thing that
makes unattended runs possible. Teardown kills the rig BROWSER by marker and
then waits for the profile lock to be released, because the next run has to be
able to open it — a run that leaves the profile locked breaks tomorrow silently.

WHAT A RUN DOES, IN ORDER
  0. GET /api/auth/me FIRST. 401 ⇒ no check row is written at all: a
     SIGN-IN REQUIRED row, a log line, a desktop notification, exit 1.
  1. reads     four durable stores · notebook locks · the opt-in key · notes ·
               leftover canary/conflict notes · both telemetry counts
  2. canary    opt in → create → type online → offline → type → reload ONLINE →
               reconnect → cleanup → opt back out
  3. teardown  by marker; profile KEPT; lock release verified
  4. stamp     one UTC-stamped row appended to the resume doc

⛔⛔ THREE REFUSALS, EACH WITH A TEST
  1. auth 401                 ⇒ never a check row.
  2. ANY read or step failed  ⇒ no row at all.
  3. ANY null/'' baseline, or ANY empty document ⇒ the run FAILS LOUDLY, the row
     is headed NEW FINDING, and the canary note is LEFT IN PLACE.
A run that finds something and then deletes the evidence is worse than no run.

⛔ THE FLAG CONSTANT IS NEVER TOUCHED. The canary sets the per-browser
localStorage opt-in inside the rig's own profile and sets it back to '0'.
⚠️ So from the second run onward the key reads '0', not unset — that is the
persistent profile remembering the last opt-out, and it is recorded as '0'.

⛔ THE RELOAD IS PERFORMED WITH THE NETWORK UP. Q1 has no service worker, so an
offline reload cannot fetch index.html: the SPA never loads and storage is not
readable from that context. That step would prove nothing.
"""
from __future__ import annotations

import argparse
import json
import os
import pathlib
import re
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
PROD = "https://uctintelligence.com"
ACCOUNT_ID = "7a6d0299-fd98-4017-b8dc-51b849d1ab1d"

# ⭐ The profile IS the marker: its path is in the spawned browser's command
# line, so teardown can target it without ever guessing at a PID, and it cannot
# match the owner's Chrome.
PROFILE = ROOT / ".worktrees" / "canary-chrome-profile-persistent"
MARKER = "canary-chrome-profile-persistent"
CHROME = pathlib.Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

ANCHOR = "## \U0001f4cb THE WINDOW-WATCH LOG"
SIGNIN_HEAD = "### \u26d4 SIGN-IN REQUIRED"
FLAG_KEY = "uct.j2.offline.enabled"
BLOCKED_EVENT = "j2:notebook_blocked_no_baseline"
OPT_IN_EVENT = "j2:notebook_offline_opt_in"
SENTINEL = "WINDOW-CHECK-SENTINEL"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ══════════════════════════════════════════════════════════════════════════════
# THE TWO FINDING DETECTORS — pure, so `--self-check` can drive them.
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
    """Every `baseUpdatedAt` must be a non-blank string.

    ⛔ `null` is the 2026-09-09 incident; `''` is the second defect found while
    hunting it. DIFFERENT findings, reported in different words.
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
    """⛔ THE INCIDENT'S OWN SHAPE: an empty paragraph reads as a document until
    you ask whether any of it is text."""
    if not expect_text:
        return []
    out = []
    body = artifact.get("bodyJson") if isinstance(artifact, dict) else None
    if body is not None and not _doc_has_text(body):
        out.append(f"`{label}.bodyJson` holds **no text** \u2014 the empty-document shape")
    if isinstance(artifact, dict) and isinstance(artifact.get("patch"), dict):
        pb = artifact["patch"].get("bodyJson")
        if pb is not None and not _doc_has_text(pb):
            out.append(f"`{label}.patch.bodyJson` holds **no text** \u2014 the empty-document shape")
    return out


def conflict_findings(label: str, server_body, copy_body, mine: str, theirs: str) -> list:
    """Words must survive in BOTH directions when two writers meet.

    ⛔ The wave's whole invariant: the server keeps whoever arrived first,
    byte-unchanged, and the loser's work survives beside it as a real
    `(conflicted copy)`. A run that only checked one direction would pass while
    half the member's work vanished — and "the server still has *a* version" is
    exactly the reassurance that hides a clobber.
    """
    out = []
    server_txt = json.dumps(server_body) if server_body is not None else ""
    copy_txt = json.dumps(copy_body) if copy_body is not None else ""
    if theirs and theirs not in server_txt:
        out.append(f"`{label}` — the SERVER lost the other writer's words (**{theirs}** is gone): a clobber")
    if mine and mine not in copy_txt:
        out.append(f"`{label}` — the conflicted copy lost MY words (**{mine}** is gone): work destroyed on fork")
    return out


def should_clean_up(findings: list) -> bool:
    """⛔⛔ A run that finds something and then deletes the evidence is worse
    than no run."""
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
    canary: list = field(default_factory=list)
    findings: list = field(default_factory=list)
    canary_ran: bool = False
    needs_signin: bool = False

    def add(self, name, ok, value=None, error=""):
        self.reads.append(Read(name, ok, value, error))
        return self.reads[-1]

    def step(self, name, ok, value=None, error=""):
        self.canary.append(Read(name, ok, value, error))
        return self.canary[-1]

    @property
    def complete(self) -> bool:
        """⛔ THE GATE. Auth 401, one failed read, or one failed step ⇒ no row."""
        if self.needs_signin:
            return False
        return bool(self.reads) and all(r.ok for r in self.reads) and all(s.ok for s in self.canary)

    @property
    def failures(self) -> list:
        return [r for r in self.reads + self.canary if not r.ok]

    def row(self) -> str:
        head = f"### {self.label} — **{self.started}**"
        lines = []
        if self.findings:
            lines += [head, "",
                      "## \U0001f6a8\U0001f6a8 NEW FINDING — STOP AND READ THIS", "",
                      "⛔ The daily mini-canary found the shape this whole wave exists to",
                      "prevent. **The canary note was deliberately NOT deleted** — the artifact",
                      "is on the account for inspection.", ""]
            lines += [f"- {f}" for f in self.findings]
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
    """⛔ A PORT IS NOT A SERVER IDENTITY. An ephemeral port narrows the odds;
    the caller verifies the endpoint before driving it."""
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


def profile_lock_released(timeout: int = 30) -> tuple:
    """Can the NEXT run open this profile?

    ⛔ Chrome keeps `lockfile` (and `SingletonLock`) inside the user-data dir and
    holds it open for the life of the browser. A teardown that returns while the
    lock is still held means tomorrow's 09:00 run finds the profile busy and
    fails for a reason that has nothing to do with the product. So this waits and
    REPORTS, rather than assuming the kill was instantaneous.
    """
    locks = [PROFILE / "lockfile", PROFILE / "SingletonLock"]
    deadline = time.time() + timeout
    while True:
        held = []
        for p in locks:
            if not p.exists():
                continue
            try:
                with p.open("r+b"):
                    pass
            except OSError:
                held.append(p.name)
        if not held or time.time() > deadline:
            return (not held), held
        time.sleep(1)


def browser_processes():
    """⛔ NEVER COUNT `chrome.exe` — Chrome reaps children constantly and a count
    false-alarmed on 2026-09-10. BROWSER processes only (no `--type=`)."""
    ps = ("Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          "Where-Object { $_.CommandLine -notlike '*--type=*' } | "
          "ForEach-Object { $_.ProcessId.ToString() + '|' + ($_.CommandLine -like '*" + MARKER + "*') }")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    out = []
    for line in r.stdout.splitlines():
        if "|" in line:
            pid, mine = line.strip().split("|", 1)
            try:
                out.append((int(pid), mine.strip().lower() == "true"))
            except ValueError:
                pass
    return out


def kill_by_marker() -> int:
    ps = ("$c = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          "Where-Object { $_.CommandLine -like '*" + MARKER + "*' }; "
          "($c | Measure-Object).Count; "
          "$c | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    first = (r.stdout.strip().splitlines() or ["0"])[0]
    try:
        return int(first)
    except ValueError:
        return 0


def notify(title: str, text: str) -> bool:
    """A desktop balloon, so a signed-out rig is visible without opening a log.

    ⛔ Non-blocking by construction: a `MessageBox` would hang a scheduled task
    until someone clicked it, which is a worse failure than the one it reports.
    ⚠️ `msg.exe` does not exist on this edition of Windows — measured — so the
    NotifyIcon balloon is the path, and it was proved to fire before anything
    depended on it.
    """
    ps = (
        "Add-Type -AssemblyName System.Windows.Forms;"
        "$n = New-Object System.Windows.Forms.NotifyIcon;"
        "$n.Icon = [System.Drawing.SystemIcons]::Warning;"
        "$n.Visible = $true;"
        f"$n.ShowBalloonTip(15000, '{title}', '{text}', [System.Windows.Forms.ToolTipIcon]::Warning);"
        "Start-Sleep -Seconds 8; $n.Dispose()"
    )
    try:
        subprocess.run(["powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps],
                       capture_output=True, timeout=40)
        return True
    except Exception:  # noqa: BLE001
        return False


def bring_to_front():
    ps = ("$p = Get-CimInstance Win32_Process -Filter \"Name='chrome.exe'\" | "
          "Where-Object { $_.CommandLine -like '*" + MARKER + "*' -and $_.CommandLine -notlike '*--type=*' } | "
          "Select-Object -First 1; if ($p) { "
          "Add-Type -AssemblyName Microsoft.VisualBasic; "
          "[Microsoft.VisualBasic.Interaction]::AppActivate($p.ProcessId) }")
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True)


# ══════════════════════════════════════════════════════════════════════════════
# page-side reads
# ══════════════════════════════════════════════════════════════════════════════

AUTH_JS = """async () => {
  const r = await fetch('/api/auth/me', {credentials:'include'});
  let b = null; try { b = await r.json() } catch {}
  return {status: r.status, id: b?.user?.id ?? b?.id ?? null};
}"""


# ══════════════════════════════════════════════════════════════════════════════
# SELF-HEALING AUTH — the one thing that can break an unattended run.
# ══════════════════════════════════════════════════════════════════════════════

class ReauthUnavailable(Exception):
    """No configured way to re-issue a session without a human."""


def mint_session_token() -> str:
    """Issue a fresh 30-day session for the canary account, server-side.

    ⛔⛔ NOT IMPLEMENTED, AND DELIBERATELY NOT FAKED. Here is exactly what it
    would take, so the next session does not have to re-derive it:

    A session in this app is NOT signed — `auth_service.create_session` mints
    `secrets.token_urlsafe(48)` and INSERTS it into the `sessions` table
    (`SESSION_TTL_DAYS = 30`), and `validate_session` is a plain token lookup.
    So there is no signer and no secret to borrow: **minting means writing a row
    into production's `auth.db`**, which needs a shell on the production pod.

        railway ssh --service web
        /opt/venv/bin/python -c "from api.services.auth_service import create_session; \
                                 print(create_session('<canary user id>'))"

    then install the value as the `uct_session` cookie on `.uctintelligence.com`
    (httpOnly, secure, SameSite=Lax, path=/) via CDP `Network.setCookie`.

    ⛔ This session could not reach that shell: every probe toward the Railway
    CLI was refused by the environment's command classifier. That is a guardrail
    around production access, and routing around it — a different shell, a
    wrapper script — would be defeating it rather than satisfying it.

    ⛔ AND IT WRITES TO THE 1 GB `auth.db` THAT HOLDS ~20,640 REAL MEMBERS. That
    is a different risk class from everything else this rig does, all of which
    is confined to one canary account through the app's own HTTP surface.
    """
    raise ReauthUnavailable(
        "minting a session needs a production shell (railway ssh); "
        "this environment refuses that, and it must not be worked around"
    )


def reauthenticate(page, mint=mint_session_token) -> tuple:
    """⭐ Called on a 401 BEFORE giving up. Returns (ok, detail).

    ⛔ It installs a cookie the server issued. It never types a password, never
    reads one from disk, and never touches an account other than the canary.
    """
    try:
        token = mint()
    except ReauthUnavailable as e:
        return False, str(e)
    except Exception as e:  # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"
    if not token or not isinstance(token, str):
        return False, "the minter returned nothing usable"
    cdp = page.context.new_cdp_session(page)
    cdp.send("Network.enable")
    cdp.send("Network.setCookie", {
        "name": "uct_session", "value": token, "domain": ".uctintelligence.com",
        "path": "/", "httpOnly": True, "secure": True, "sameSite": "Lax",
    })
    return True, "session re-issued server-side and installed via CDP"

STATE_JS = """async (acct) => {
  const out = {};
  try {
    const q = await navigator.locks.query();
    out.locks = [...q.held, ...q.pending].filter(l => String(l.name).startsWith('uct.nb.sync.')).length;
    out.held = (q.held || []).filter(l => String(l.name).startsWith('uct.nb.sync.')).map(l => l.mode);
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
  try { out.draft = JSON.parse(localStorage.getItem('uct.j2.notedraft.' + id) || 'null') } catch { out.draft = 'ERR' }
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
  } catch { out.server = 'OFFLINE' }
  return out;
}"""

NOTES_JS = """async () => {
  const r = await fetch('/api/j2/notes?limit=300', {credentials:'include'});
  if (!r.ok) return {ok:false, status:r.status};
  const notes = (await r.json()).notes || [];
  return {ok:true, total: notes.length,
    canary: notes.filter(n => /CANARY|WINDOW-CHECK/i.test(n.title || '')).map(n => n.title),
    conflicts: notes.filter(n => (n.tags || []).includes('sync-conflict')).map(n => n.title)};
}"""

ACTIVITY_JS = """async (names) => {
  // ⭐ TWO SOURCES, AND THEY ANSWER DIFFERENT QUESTIONS.
  //
  // /api/admin/activity is population-wide but admin-gated (ADMIN_EMAILS).
  // /api/auth/export-data is THIS ACCOUNT'S OWN activity_log, gated only by
  // get_current_user — so it always works for the rig, admin or not.
  //
  // ⛔ The scope is REPORTED, never silently swapped: "zero events across every
  // member" and "zero events on the rig's own account" are different facts, and
  // reading one as the other is how a gate gets satisfied by the wrong evidence.
  const count = (rows, n) => {
    const hits = rows.filter(x => x.action === n);
    return {count: hits.length, latest: hits.length ? hits[0].created_at : null};
  };
  const admin = await fetch('/api/admin/activity?limit=200', {credentials:'include'});
  if (admin.ok) {
    const rows = await admin.json();
    const out = {ok:true, scope:'population-wide (admin)', adminStatus:200};
    for (const n of names) out[n] = count(rows, n);
    return out;
  }
  const mine = await fetch('/api/auth/export-data', {credentials:'include'});
  if (!mine.ok) return {ok:false, status:mine.status, adminStatus:admin.status};
  const rows = (await mine.json()).activity || [];
  const out = {ok:true, scope:'this account only (export-data)',
               adminStatus:admin.status, rowCap: rows.length >= 100};
  for (const n of names) out[n] = count(rows, n);
  return out;
}"""


# ══════════════════════════════════════════════════════════════════════════════
# the run
# ══════════════════════════════════════════════════════════════════════════════

def spawn_rig():
    """Launch Chrome on the PERSISTENT profile and return (proc, endpoint)."""
    if not CHROME.exists():
        raise SystemExit(f"STOP: no Chrome at {CHROME}")
    PROFILE.mkdir(parents=True, exist_ok=True)
    released, held = profile_lock_released(timeout=5)
    if not released:
        raise SystemExit(
            f"STOP: the rig profile is locked by a running Chrome ({', '.join(held)}). "
            "Close it, or kill by marker, before starting a run."
        )
    port = free_port()
    if port_is_busy(port):
        raise SystemExit(f"STOP: something already answers on 127.0.0.1:{port}")
    proc = subprocess.Popen([
        str(CHROME), f"--user-data-dir={PROFILE}",
        f"--remote-debugging-port={port}", "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check", "--new-window", "about:blank",
    ])
    endpoint = f"http://127.0.0.1:{port}"
    for _ in range(30):
        try:
            import urllib.request
            with urllib.request.urlopen(endpoint + "/json/version", timeout=2) as r:
                return proc, endpoint, json.loads(r.read().decode())
        except Exception:  # noqa: BLE001
            time.sleep(1)
    return proc, endpoint, None


def _offliner(cdp):
    def offline(flag):
        cdp.send("Network.emulateNetworkConditions", {
            "offline": flag, "latency": 0,
            "downloadThroughput": 0 if flag else -1,
            "uploadThroughput": 0 if flag else -1})
    return offline


PROBE = ("async () => await fetch('/api/health', {cache:'no-store'})"
         ".then(r => 'ONLINE ' + r.status).catch(e => 'FAILED: ' + e.name)")


def teardown(chk: Check | None = None):
    """⛔ Kills the BROWSER by marker and KEEPS THE PROFILE. The profile is the
    signed-in session; deleting it would make every future run need a human."""
    killed = kill_by_marker()
    time.sleep(2)
    procs = browser_processes()
    mine_left = [p for p, mine in procs if mine]
    others = [p for p, mine in procs if not mine]
    released, held = profile_lock_released(timeout=30)
    if chk is not None:
        chk.add("teardown", not mine_left,
                f"killed **{killed}** by marker \u00b7 0 left \u00b7 owner's browser {others} untouched",
                f"{len(mine_left)} marked process(es) survived: {mine_left}")
        chk.add("profile KEPT, lock released", released,
                f"`{PROFILE.name}` retained \u00b7 lock free \u21d2 the next run can open it",
                f"lock still held: {held} \u2014 tomorrow's run would find the profile busy")
    return killed, mine_left, others, released, held


def run_check(label: str, with_canary: bool) -> Check:
    from playwright.sync_api import sync_playwright

    chk = Check(label=label)
    proc, endpoint, version = spawn_rig()
    chk.add("rig", bool(version),
            f"PID **{proc.pid}** \u00b7 {version['Browser']} \u00b7 CDP `{endpoint.split('//')[1]}` \u00b7 **persistent profile**" if version else None,
            "CDP endpoint never answered")
    if not version:
        teardown(chk)
        return chk

    note_id = None
    try:
        with sync_playwright() as pw:
            b = pw.chromium.connect_over_cdp(endpoint)
            ctx = b.contexts[0]
            page = ctx.pages[0] if ctx.pages else ctx.new_page()
            cdp = page.context.new_cdp_session(page)
            cdp.send("Network.enable")
            offline = _offliner(cdp)
            offline(False)

            # ── 0. AUTH FIRST. Everything else is meaningless without it. ────
            page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(6000)
            me = page.evaluate(AUTH_JS)
            healed = ""
            if me.get("status") != 200 or me.get("id") != ACCOUNT_ID:
                # ⭐ SELF-HEAL FIRST. A signed-out rig is the one thing that can
                # break an unattended run, so try to fix it before reporting it.
                ok, detail = reauthenticate(page)
                if ok:
                    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
                    page.wait_for_timeout(5000)
                    me = page.evaluate(AUTH_JS)
                    healed = f" · ⭐ **self-healed**: {detail}"
                else:
                    healed = f" · re-auth unavailable: {detail}"
            if me.get("status") != 200 or me.get("id") != ACCOUNT_ID:
                chk.needs_signin = True
                chk.add("signed in", False,
                        error=f"/api/auth/me returned {me.get('status')}{healed}")
                return chk
            chk.add("signed in", True, f"`/api/auth/me` **200**, account `{me.get('id')}`{healed}")

            puts = []
            page.on("request", lambda r: puts.append({
                "url": r.url, "baseUpdatedAt": _put_baseline(r)})
                if r.method == "PUT" and "/api/j2/notes/" in r.url else None)

            offline(True); page.wait_for_timeout(800)
            off, off_flag = page.evaluate(PROBE), page.evaluate("() => navigator.onLine")
            offline(False); page.wait_for_timeout(800)
            on, on_flag = page.evaluate(PROBE), page.evaluate("() => navigator.onLine")
            chk.add("offline proven both ways",
                    off.startswith("FAILED") and off_flag is False and on.startswith("ONLINE") and on_flag is True,
                    f"offline \u21d2 `{off}`, `onLine={str(off_flag).lower()}` \u00b7 online \u21d2 `{on}`, `{str(on_flag).lower()}`",
                    "CDP offline did not cut the transport")

            st = page.evaluate(STATE_JS, ACCOUNT_ID)
            stores_ok = isinstance(st.get("stores"), dict)
            chk.add("four durable stores", stores_ok,
                    " \u00b7 ".join(f"`{k}` {v}" for k, v in st["stores"].items()) if stores_ok else str(st.get("stores")),
                    "could not read the per-account database")
            chk.add("notebook locks", st.get("locks") != "ERR",
                    f"**{st.get('locks')}** `uct.nb.sync.*`", "navigator.locks unavailable")
            key = st.get("optInKey")
            chk.add("opt-in key", True, _render_key(key))

            nt = page.evaluate(NOTES_JS)
            chk.add("notes", bool(nt.get("ok")),
                    f"**{nt.get('total')}** \u00b7 canary notes {len(nt.get('canary') or [])} \u00b7 `sync-conflict` {len(nt.get('conflicts') or [])}"
                    if nt.get("ok") else None,
                    f"GET /api/j2/notes returned {nt.get('status')}")

            act = page.evaluate(ACTIVITY_JS, [BLOCKED_EVENT, OPT_IN_EVENT])
            if act.get("ok"):
                scope = act.get("scope", "?")
                bl, oi = act[BLOCKED_EVENT], act[OPT_IN_EVENT]
                cap = ("  \u26a0\ufe0f the export caps at 100 rows and returned a full page \u2014 "
                       "an older event may have fallen off" if act.get("rowCap") else "")
                chk.add("telemetry scope", True,
                        f"**{scope}**" + ("" if act.get("adminStatus") == 200 else
                                          f" \u2014 `/api/admin/activity` said **{act.get('adminStatus')}**, so this account is not in `ADMIN_EMAILS`"))
                chk.add("`j2:notebook_blocked_no_baseline`", True,
                        f"count **{bl['count']}** \u00b7 latest {bl['latest'] or '**none**'} \u00b7 scope: {scope}{cap}")
                chk.add("opted-in browsers (`j2:notebook_offline_opt_in`)", True,
                        f"count **{oi['count']}** \u00b7 latest {oi['latest'] or '**none**'} \u00b7 scope: {scope}"
                        + ("  \u26d4\u26d4 **zero events over zero opted-in browsers is not evidence**"
                           if oi["count"] == 0 else ""))
            else:
                for n in ("`j2:notebook_blocked_no_baseline`", "opted-in browsers (`j2:notebook_offline_opt_in`)"):
                    chk.add(n, False,
                            error=f"admin said {act.get('adminStatus')} and `/api/auth/export-data` said {act.get('status')}")

            if with_canary:
                note_id = _mini_canary(chk, page, offline, puts)
    finally:
        teardown(chk)
        if chk.findings and note_id:
            chk.add("\U0001f6a8 evidence kept", True,
                    f"canary note **`{note_id}`** was NOT deleted \u2014 inspect it before anything else")
    return chk


def _render_key(key) -> str:
    if key is None:
        return "**unset** \u2014 a profile that has never opted in"
    if key == "0":
        return "**`'0'`** \u2014 the rig's own last opt-out. \u26a0\ufe0f On a PERSISTENT profile this is the expected reading from run 2 onward; `unset` only ever appears on run 1."
    return f"**`'{key}'`** \u21d2 **OPTED IN** \u2014 unexpected at rest; a previous run did not opt back out"


def _put_baseline(req):
    try:
        body = req.post_data
        return json.loads(body).get("baseUpdatedAt", "<absent>") if body else "<no body>"
    except Exception:  # noqa: BLE001
        return "<unreadable>"


def _mini_canary(chk: Check, page, offline, puts) -> str | None:
    """The §15 happy path, every day, artifact captured at every step."""
    chk.canary_ran = True
    note_id = None

    page.evaluate("(k) => localStorage.setItem(k, '1')", FLAG_KEY)
    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(7000)
    st = page.evaluate(STATE_JS, ACCOUNT_ID)
    ok1 = st.get("held") == ["exclusive"] and st.get("pending") == 0 and st.get("dbOpened") is True
    chk.step("1 opt in \u2192 leadership", ok1,
             f"held **{st.get('held')}**, pending **{st.get('pending')}**, DB opened with {len(st.get('storeNames') or [])} stores",
             f"expected one EXCLUSIVE lock and an open DB; got held={st.get('held')} pending={st.get('pending')} dbOpened={st.get('dbOpened')}")

    created = page.evaluate("""async (t) => {
        const r = await fetch('/api/j2/notes', {method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({title: t, bodyJson: {type:'doc', content:[]}})});
        if (!r.ok) return {ok:false, status:r.status};
        const b = await r.json();
        return {ok:true, id: b.note?.id ?? b.id};
    }""", f"{SENTINEL} {chk.started}")
    if not created.get("ok"):
        chk.step("2 create a note", False, error=f"POST /api/j2/notes returned {created.get('status')}")
        return None
    note_id = created["id"]
    puts.clear()
    page.goto(f"{PROD}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(6000)
    try:
        pm = page.query_selector(".ProseMirror")
        if pm:
            pm.click(); page.keyboard.type(f"{SENTINEL} typed online.")
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(6000)
    online_puts = [p for p in puts if note_id in p["url"]]
    bases = [p["baseUpdatedAt"] for p in online_puts]
    ok2 = len(online_puts) >= 1 and all(isinstance(x, str) and x.strip() and x != "<absent>" for x in bases)
    chk.step("2 type online \u2192 one CAS PUT", ok2,
             f"**{len(online_puts)}** PUT(s), baseline(s) `{bases}`",
             f"expected at least one PUT carrying a real baseline; got {bases}")
    if bases:
        chk.findings += baseline_findings("online PUT", {"baseUpdatedAt": bases[0]})

    offline(True); page.wait_for_timeout(1000)
    pr = page.evaluate(PROBE)
    chk.step("3 offline is real", pr.startswith("FAILED"), f"`{pr}`", f"probe said `{pr}` \u2014 the transport was not cut")
    try:
        pm = page.query_selector(".ProseMirror")
        if pm:
            pm.click(); page.keyboard.press("End"); page.keyboard.type(f" {SENTINEL} typed offline.")
    except Exception:  # noqa: BLE001
        pass
    page.wait_for_timeout(6000)
    before = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})

    # ⛔ NETWORK UP FIRST — no service worker, so an offline reload proves nothing.
    offline(False); page.wait_for_timeout(1500)
    page.goto(f"{PROD}/journal/notebook?note={note_id}", wait_until="domcontentloaded")
    page.wait_for_timeout(8000)
    after = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})
    rec = after.get("record") if isinstance(after.get("record"), dict) else {}
    draft_ok = _doc_has_text((after.get("draft") or {}).get("bodyJson")) if isinstance(after.get("draft"), dict) else False
    rec_ok = _doc_has_text(rec.get("bodyJson"))
    ob = after.get("outbox") if isinstance(after.get("outbox"), list) else []
    chk.step("3 reload (network UP) \u2192 the words survive", rec_ok and (draft_ok or bool(ob)),
             f"record holds text: **{rec_ok}** \u00b7 draft holds text: **{draft_ok}** \u00b7 outbox entries: **{len(ob)}** \u00b7 baseline `{rec.get('baseUpdatedAt')}`",
             "a local layer came back without the member's words \u2014 THE INCIDENT'S SHAPE")
    for lab, art in (("pre-reload record", before.get("record")), ("post-reload record", rec)):
        if isinstance(art, dict):
            chk.findings += baseline_findings(lab, art) + empty_document_findings(lab, art)
    for e in (before.get("outbox") or []) + ob:
        if isinstance(e, dict):
            chk.findings += baseline_findings("outbox entry", e)

    page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
    page.wait_for_timeout(12000)
    settled = page.evaluate(LAYERS_JS, {"acct": ACCOUNT_ID, "id": note_id})
    srec = settled.get("record") if isinstance(settled.get("record"), dict) else {}
    srv = settled.get("server") if isinstance(settled.get("server"), dict) else {}
    server_has = _doc_has_text(srv.get("bodyJson"))
    chk.step("4 reconnect \u2192 drained, re-based, server has the words",
             srec.get("dirty") == 0 and not (settled.get("outbox") or []) and server_has,
             f"`dirty` **{srec.get('dirty')}** \u00b7 outbox **{len(settled.get('outbox') or [])}** \u00b7 server holds text: **{server_has}** \u00b7 baseline `{srec.get('baseUpdatedAt')}`",
             f"queue did not settle: dirty={srec.get('dirty')} outbox={len(settled.get('outbox') or [])} serverHasText={server_has}")
    chk.findings += baseline_findings("settled record", srec)

    if not should_clean_up(chk.findings):
        chk.step("5 cleanup", True,
                 "\U0001f6a8 **SKIPPED ON PURPOSE** \u2014 a finding is on the account and the evidence stays")
        return note_id

    page.evaluate("""async (id) => { await fetch('/api/j2/notes/' + id, {method:'DELETE', credentials:'include'}) }""", note_id)
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
    chk.step("5 cleanup \u2192 stores 0, locks 0, opted out",
             zeroed and end.get("locks") == 0 and end.get("optInKey") == "0" and not (end_notes.get("canary") or []),
             f"stores all zero: **{zeroed}** \u00b7 locks **{end.get('locks')}** \u00b7 key **`'{end.get('optInKey')}'`** \u00b7 leftover canary notes **{len(end_notes.get('canary') or [])}**",
             f"cleanup incomplete: zeroed={zeroed} locks={end.get('locks')} key={end.get('optInKey')}")
    return note_id


# ══════════════════════════════════════════════════════════════════════════════
# stamping + logging
# ══════════════════════════════════════════════════════════════════════════════

# ══════════════════════════════════════════════════════════════════════════════
# THE 9/17 DECISION PACKET — regenerated on every run, so it is never stale.
# ══════════════════════════════════════════════════════════════════════════════

DECISION_BEGIN = "<!-- WINDOW-CHECK:DECISION:BEGIN -->"
DECISION_END = "<!-- WINDOW-CHECK:DECISION:END -->"

GO_MIN_GREEN_RUNS = 7
GO_MIN_OPT_INS = 5


def recommend(events, optins, green_runs, findings_seen) -> tuple:
    """⛔ PURE, so the recommendation can be railed rather than trusted.

    It NEVER flips the flag. It writes a sentence for a person, and it names
    which condition decided it — a verdict without its reason is an opinion.
    """
    blockers, met = [], []
    if findings_seen:
        blockers.append("a 🚨 NEW FINDING has fired — that is a NO-GO on its own")
    if events is None:
        blockers.append("the blocked-baseline event count is **UNREAD**")
    elif events > 0:
        blockers.append(f"**{events}** blocked-baseline event(s) fired — investigate before anything else")
    else:
        met.append("zero blocked-baseline events")
    if optins is None:
        blockers.append("the opt-in count is **UNREAD**")
    elif optins < GO_MIN_OPT_INS:
        blockers.append(f"only **{optins}** opted-in browser(s), need ≥ {GO_MIN_OPT_INS} — "
                        "zero events over a tiny population is not evidence")
    else:
        met.append(f"{optins} opted-in browsers")
    if green_runs < GO_MIN_GREEN_RUNS:
        blockers.append(f"only **{green_runs}** green daily run(s), need {GO_MIN_GREEN_RUNS}")
    else:
        met.append(f"{green_runs} consecutive green runs")
    return ("GO" if not blockers else "NO-GO"), blockers, met


def count_green_checks(text: str) -> int:
    return len(re.findall(r"\| \*\*mini-canary\*\* \| ✅", text))


def findings_ever(text: str) -> bool:
    return "NEW FINDING — STOP AND READ THIS" in text


def _num(read: Read | None):
    if read is None or not read.ok:
        return None
    m = re.search(r"count \*\*(\d+)\*\*", str(read.value))
    return int(m.group(1)) if m else None


def decision_block(chk: Check | None, text: str) -> str:
    events = optins = None
    if chk is not None:
        by = {r.name: r for r in chk.reads}
        events = _num(by.get("`j2:notebook_blocked_no_baseline`"))
        optins = _num(by.get("opted-in browsers (`j2:notebook_offline_opt_in`)"))
    green = count_green_checks(text)
    seen = findings_ever(text)
    verdict, blockers, met = recommend(events, optins, green, seen)
    stamp_as = f"{chk.label} — {chk.started}" if chk else "no run yet"

    fmt = lambda v: "⛔ **UNREAD**" if v is None else f"**{v}**"
    lines = [
        DECISION_BEGIN,
        "",
        f"⛔ **REGENERATED BY `tools/window_check.py` ON EVERY RUN — as of {stamp_as}.**",
        "It is never hand-edited: a decision table maintained by hand is one that",
        "goes stale exactly when it matters. Rows 4–9 below it are static and",
        "checked by eye on the day.",
        "",
        "| # | condition | latest reading |",
        "|---|---|---|",
        f"| 1 | Zero `notebook_blocked_no_baseline` across the instrument clock | {fmt(events)} |",
        f"| 2 | Opted-in browsers (the denominator) | {fmt(optins)} — need ≥ **{GO_MIN_OPT_INS}** |",
        f"| 3 | Consecutive green daily runs, mini-canary all steps | **{green}** — need **{GO_MIN_GREEN_RUNS}** |",
        f"| — | Has a 🚨 NEW FINDING ever fired? | **{'YES — NO-GO' if seen else 'no'}** |",
        "",
        f"## {'✅' if verdict == 'GO' else '⛔'} RECOMMENDATION: **{verdict}**",
        "",
    ]
    if met:
        lines += ["**Met:** " + " · ".join(met), ""]
    if blockers:
        lines += ["**What is holding it:**", ""] + [f"- {b}" for b in blockers] + [""]
    lines += [
        "⚠️ **The 36-minute gap stands.** The denominator starts 2026-09-10T05:42:53Z,",
        "the numerator 05:06:56Z. A browser that opted in inside that window is",
        "counted by neither, and that does not shrink with time.",
        "",
        "⚠️ **What no amount of green buys.** Every opted-in browser in that count is",
        "a *canary profile on the owner's machine driving the owner's own account*.",
        "It is not five members on five devices. The flip is still a step from \"it",
        "works when we drive it\" to \"it works for people\", and no amount of green",
        "here closes that distance — only the flip does, which is why the rollback",
        "is one line.",
        "",
        "⛔ **This script never flips the flag.** It writes a recommendation for the",
        "owner and nothing else.",
        "",
        DECISION_END,
    ]
    return "\n".join(lines)


def update_decision_packet(chk: Check | None, dry_run: bool = False) -> bool:
    try:
        text = DOC.read_text(encoding="utf-8")
    except OSError:
        return False
    if DECISION_BEGIN not in text or DECISION_END not in text:
        return False
    i = text.index(DECISION_BEGIN)
    j = text.index(DECISION_END) + len(DECISION_END)
    out = text[:i] + decision_block(chk, text) + text[j:]
    if dry_run:
        return True
    _write_doc(out)
    return True


def log_line(text: str) -> None:
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8", newline="") as fh:
            fh.write(f"{utc_now()}  {text}\n")
    except OSError:
        pass


def _write_doc(out: str) -> None:
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


def signin_required_row(first_seen: str, last_seen: str, runs: int) -> str:
    return "\n".join([
        f"{SIGNIN_HEAD} — the rig profile is signed out",
        "",
        "⛔ **No check row was written, and none will be until this clears.** A",
        "signed-out rig can read nothing, and a row assembled from nothing reads as",
        "evidence. The daily task keeps running and keeps landing here.",
        "",
        "| | |",
        "|---|---|",
        f"| first seen | **{first_seen}** |",
        f"| last seen | **{last_seen}** |",
        f"| consecutive runs blocked | **{runs}** |",
        "| notification | a desktop balloon fires on every occurrence |",
        "",
        "**⭐ THE FIX IS ONE THING AND NOTHING ELSE: sign in once, in the rig window.**",
        "",
        "```",
        "python tools/window_check.py --park      # opens the rig at /login and leaves it up",
        "```",
        "",
        "Sign in there by hand, close nothing, and the next scheduled run picks the",
        "session up. ⛔ Do not add a credentials file, do not script the login form,",
        "do not copy cookies from another profile. The session cookie is a 30-day",
        "cookie, so one sign-in covers the whole observation window.",
        "",
    ])


def stamp_signin_required(chk: Check, dry_run: bool = False) -> None:
    """Idempotent: repeated signed-out runs UPDATE the standing row rather than
    appending a new one every morning. ⛔ Seven identical rows would bury the
    check rows this document exists for."""
    if dry_run:
        print(signin_required_row(chk.started, chk.started, 1))
        return
    text = DOC.read_text(encoding="utf-8")
    if ANCHOR not in text:
        return
    i = text.index(ANCHOR)
    j = text.find("\n### ", i)
    if j == -1:
        j = len(text)
    tail = text[j:]
    first, runs = chk.started, 1
    if tail.lstrip("\n").startswith(SIGNIN_HEAD):
        m = re.search(r"\| first seen \| \*\*(.+?)\*\* \|", tail)
        c = re.search(r"\| consecutive runs blocked \| \*\*(\d+)\*\* \|", tail)
        if m:
            first = m.group(1)
        if c:
            runs = int(c.group(1)) + 1
        end = tail.find("\n### ", 1)
        tail = tail[end:] if end != -1 else "\n"
    _write_doc(text[:j] + "\n" + signin_required_row(first, chk.started, runs) + tail)


def stamp(chk: Check, dry_run: bool = False) -> bool:
    """⛔⛔ A row is written only if auth held AND every read and step succeeded."""
    if chk.needs_signin:
        print("\u26d4 SIGN-IN REQUIRED: the rig profile is signed out. No check row written.")
        print("   Fix: `python tools/window_check.py --park`, sign in by hand, done.")
        if not dry_run:
            log_line(f"{chk.label}: SIGN-IN REQUIRED \u2014 /api/auth/me not 200")
            notify("UCT Wave Q1 - sign-in required",
                   "The window-check rig is signed out. Run: python tools/window_check.py --park")
        stamp_signin_required(chk, dry_run)
        return False
    if not chk.complete:
        names = ", ".join(r.name for r in chk.failures)
        print(f"\u26d4 REFUSING TO STAMP: {len(chk.failures)} read(s)/step(s) failed \u2014 {names}")
        print("   A check log whose rows might be partial reads as evidence. Nothing was written.")
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
    tail = text[j:]
    # A successful check clears any standing SIGN-IN REQUIRED row: the condition
    # it describes is over, and leaving it would contradict the row above it.
    if tail.lstrip("\n").startswith(SIGNIN_HEAD):
        end = tail.find("\n### ", 1)
        tail = tail[end:] if end != -1 else "\n"
    _write_doc(text[:j] + "\n" + chk.row() + tail)
    verdict = "NEW FINDING" if chk.findings else "green"
    print(f"\u2705 stamped: {chk.label} @ {chk.started} ({verdict})")
    log_line(f"{chk.label}: stamped, {verdict}, {len(chk.reads)} reads, {len(chk.canary)} canary steps")
    # \u2b50 And refresh the 9/17 packet from this run, so it is current on the day
    # rather than something someone has to remember to update.
    if update_decision_packet(chk):
        log_line(f"{chk.label}: decision packet refreshed")
    return True


def park() -> int:
    """Spawn the rig on the persistent profile, prove it, park at /login, LEAVE IT."""
    from playwright.sync_api import sync_playwright
    proc, endpoint, version = spawn_rig()
    if not version:
        print("\u26d4 the CDP endpoint never answered")
        return 1
    with sync_playwright() as pw:
        b = pw.chromium.connect_over_cdp(endpoint)
        ctx = b.contexts[0]
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        cdp = page.context.new_cdp_session(page)
        cdp.send("Network.enable")
        offline = _offliner(cdp)
        offline(False)
        page.goto(PROD + "/login", wait_until="domcontentloaded")
        page.wait_for_timeout(3500)
        offline(True); page.wait_for_timeout(800)
        off, off_flag = page.evaluate(PROBE), page.evaluate("() => navigator.onLine")
        offline(False); page.wait_for_timeout(800)
        on, on_flag = page.evaluate(PROBE), page.evaluate("() => navigator.onLine")
        me = page.evaluate(AUTH_JS)
        print(json.dumps({
            "pid": proc.pid, "chrome": version["Browser"], "cdp": endpoint,
            "profile": str(PROFILE),
            "offline_probe": off, "navigator.onLine(offline)": off_flag,
            "online_probe": on, "navigator.onLine(online)": on_flag,
            "auth_me": me, "url": page.url,
        }, indent=1))
    bring_to_front()
    print("\nPARKED at /login. Sign in by hand in that window; leave it open or close it —")
    print("the profile keeps the session either way. This process now exits; the rig stays up.")
    log_line(f"parked for sign-in: pid {proc.pid}, profile {PROFILE.name}")
    return 0


def self_check() -> int:
    cases = []

    signed_out = Check(label="self-check: auth 401")
    signed_out.add("rig", True, "fine")
    signed_out.needs_signin = True
    signed_out.add("signed in", False, error="/api/auth/me returned 401")
    cases.append(("AUTH 401 is refused", stamp(signed_out, dry_run=True) is False))
    cases.append(("AUTH 401 makes the run incomplete", signed_out.complete is False))

    # ── the two re-auth branches ────────────────────────────────────────────
    class _Page:
        class _Ctx:
            def new_cdp_session(self, _):
                class _S:
                    sent = []

                    def send(self, m, p=None):
                        _S.sent.append(m)
                return _S()
        context = _Ctx()

    ok_h, detail_h = reauthenticate(_Page(), mint=lambda: "a-freshly-minted-token")
    cases.append(("re-auth SUCCEEDS ⇒ the run proceeds", ok_h is True))
    cases.append(("re-auth installs a cookie, never types a password",
                  "installed via CDP" in detail_h))
    ok_u, detail_u = reauthenticate(_Page(), mint=mint_session_token)
    cases.append(("re-auth UNAVAILABLE ⇒ falls back to SIGN-IN REQUIRED", ok_u is False))
    cases.append(("…and says why, in one line", "production shell" in detail_u))
    ok_b, detail_b = reauthenticate(_Page(), mint=lambda: "")
    cases.append(("a minter returning nothing is not treated as success", ok_b is False))

    # ── conflict: words must survive in BOTH directions ─────────────────────
    srv = {"c": [{"text": "THEIRS"}]}
    cpy = {"c": [{"text": "MINE"}]}
    cases.append(("CONTROL: both sides intact is NOT a finding",
                  conflict_findings("x", srv, cpy, "MINE", "THEIRS") == []))
    cases.append(("a CLOBBERED server is a finding",
                  bool(conflict_findings("x", {"c": [{"text": "MINE"}]}, cpy, "MINE", "THEIRS"))))
    cases.append(("a conflicted copy that lost MY words is a finding",
                  bool(conflict_findings("x", srv, {"c": []}, "MINE", "THEIRS"))))
    cases.append(("the SIGN-IN row names the one fix",
                  "sign in once, in the rig window" in signin_required_row("a", "b", 1).lower()))
    cases.append(("the SIGN-IN row forbids a credentials file",
                  "Do not add a credentials file" in signin_required_row("a", "b", 1)))

    bad = Check(label="self-check: a failed read")
    bad.add("rig", True, "fine"); bad.add("notes", False, error="500")
    cases.append(("a failed READ is refused", stamp(bad, dry_run=True) is False))

    badstep = Check(label="self-check: a failed canary step")
    badstep.add("rig", True, "fine"); badstep.step("4 reconnect", False, error="did not settle")
    cases.append(("a failed CANARY STEP is refused", stamp(badstep, dry_run=True) is False))

    cases.append(("a run with NO reads is refused", stamp(Check(label="empty"), dry_run=True) is False))

    good = Check(label="self-check: every read ok")
    good.add("rig", True, "fine"); good.add("notes", True, "32")
    cases.append(("a complete run stamps", stamp(good, dry_run=True) is True))
    cases.append(("the row carries every reading", "| notes | 32 |" in good.row()))
    cases.append(("a failed read renders as FAILED", "FAILED" in bad.reads[1].render()))

    cases.append(("a NULL baseline is a finding", bool(baseline_findings("o", {"baseUpdatedAt": None}))))
    cases.append(("an EMPTY-STRING baseline is a finding", bool(baseline_findings("o", {"baseUpdatedAt": ""}))))
    cases.append(("a WHITESPACE baseline is a finding", bool(baseline_findings("o", {"baseUpdatedAt": "  "}))))
    cases.append(("a NON-STRING baseline is a finding", bool(baseline_findings("o", {"baseUpdatedAt": 0}))))
    cases.append(("CONTROL: a real baseline is NOT a finding",
                  baseline_findings("o", {"baseUpdatedAt": "2026-09-10T05:00:00+00:00"}) == []))
    cases.append(("nested baselines are found too",
                  bool(baseline_findings("l", {"record": {"baseUpdatedAt": None}}))))
    cases.append(("an EMPTY document is a finding",
                  bool(empty_document_findings("r", {"bodyJson": {"type": "doc", "content": []}}))))
    cases.append(("the INCIDENT'S shape (empty paragraph) is a finding",
                  bool(empty_document_findings("r", {"bodyJson": {"type": "doc", "content": [{"type": "paragraph"}]}}))))
    cases.append(("CONTROL: a document with text is NOT a finding",
                  empty_document_findings("r", {"bodyJson": {"type": "doc", "content": [
                      {"type": "paragraph", "content": [{"type": "text", "text": "words"}]}]}}) == []))
    cases.append(("a finding SUPPRESSES cleanup", should_clean_up(["x"]) is False))
    cases.append(("CONTROL: no finding allows cleanup", should_clean_up([]) is True))

    found = Check(label="self-check: a finding")
    found.add("rig", True, "fine"); found.canary_ran = True; found.step("3 reload", True, "fine")
    found.findings = baseline_findings("o", {"baseUpdatedAt": None})
    cases.append(("a finding heads the row NEW FINDING", "NEW FINDING" in found.row()))
    cases.append(("the row names the evidence is kept", "NOT deleted" in found.row()))

    # ⭐ '0' is the EXPECTED reading on a persistent profile, and the row says so
    #    rather than leaving a reader to wonder why it is not `unset`.
    cases.append(("the key reading explains '0' on a persistent profile",
                  "run 2 onward" in _render_key("0")))
    cases.append(("an unexpected '1' at rest is called out", "unexpected" in _render_key("1")))

    # ── the recommendation: pure, railed, and it names its own reason ────────
    v, bl, _ = recommend(None, None, 0, False)
    cases.append(("UNREAD counts ⇒ NO-GO", v == "NO-GO"))
    cases.append(("…and says the counts are unread", any("UNREAD" in b for b in bl)))
    v, bl, _ = recommend(0, 5, 7, False)
    cases.append(("every condition met ⇒ GO", v == "GO" and bl == []))
    v, bl, _ = recommend(1, 5, 7, False)
    cases.append(("one blocked-baseline event ⇒ NO-GO", v == "NO-GO"))
    v, bl, _ = recommend(0, 4, 7, False)
    cases.append(("too few opted-in browsers ⇒ NO-GO", v == "NO-GO"))
    v, bl, _ = recommend(0, 5, 6, False)
    cases.append(("six green runs ⇒ NO-GO", v == "NO-GO"))
    v, bl, _ = recommend(0, 9, 9, True)
    cases.append(("a past NEW FINDING ⇒ NO-GO even with everything else green", v == "NO-GO"))
    cases.append(("…and it says which condition decided it",
                  any("NEW FINDING" in b for b in bl)))
    # ── the telemetry read must never need admin, and must say its scope ────
    cases.append(("the counts do NOT depend on admin — export-data is the fallback",
                  "/api/auth/export-data" in ACTIVITY_JS))
    cases.append(("the scope is reported, not silently swapped",
                  "population-wide (admin)" in ACTIVITY_JS and "this account only" in ACTIVITY_JS))
    cases.append(("a full 100-row export is flagged as a possible truncation",
                  "rowCap" in ACTIVITY_JS))

    blk = decision_block(None, "")
    cases.append(("the packet keeps the 36-minute gap", "36-minute gap" in blk))
    cases.append(("the packet keeps the 'what green cannot buy' caveat verbatim",
                  "not five members on five devices" in blk))
    cases.append(("the packet states it never flips the flag", "never flips the flag" in blk))
    cases.append(("green runs are counted from the doc, not from memory",
                  count_green_checks("| **mini-canary** | ✅ **6/6** |\n| **mini-canary** | ✅ **6/6** |") == 2))

    bad_ct = 0
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad_ct += 0 if ok else 1
    print("self-check:", "PASS" if not bad_ct else f"FAIL ({bad_ct})")
    return 0 if not bad_ct else 1


def next_check_number() -> int:
    try:
        text = DOC.read_text(encoding="utf-8")
    except OSError:
        return 1
    nums = [int(m) for m in re.findall(r"^### check (\d+)", text, re.M | re.I)]
    return (max(nums) + 1) if nums else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-check", action="store_true")
    ap.add_argument("--park", action="store_true", help="spawn the rig at /login and leave it up for a hand sign-in")
    ap.add_argument("--label", default=None)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--no-canary", action="store_true")
    args = ap.parse_args()

    if args.self_check:
        return self_check()
    if args.park:
        return park()

    label = args.label or f"check {next_check_number()}"
    log_line(f"{label}: starting")
    try:
        chk = run_check(label, with_canary=not args.no_canary)
    except SystemExit as e:
        log_line(f"{label}: STOPPED — {e}")
        raise
    except BaseException as e:  # noqa: BLE001
        # ⛔ The log always closes the loop: "started and then nothing" is
        # indistinguishable from a machine that slept through the trigger.
        log_line(f"{label}: CRASHED — {type(e).__name__}: {e}")
        teardown(None)
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
