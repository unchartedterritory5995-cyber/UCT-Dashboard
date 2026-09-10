"""Wave Q1 — ONE COMMAND FOR A WINDOW-WATCH CHECK.

    python tools/window_check.py                 # run a check and stamp a row
    python tools/window_check.py --self-check    # prove it REFUSES to stamp a bad run
    python tools/window_check.py --label "check 4"
    python tools/window_check.py --dry-run       # everything except writing the doc

WHAT IT DOES, IN ORDER
  1. spawns a dedicated Chrome with a FRESH throwaway profile, CDP bound to
     127.0.0.1 only, on a port it has proved is free;
  2. verifies the endpoint's identity before driving it;
  3. proves offline BOTH WAYS through CDP — the probe must fail, then recover;
  4. signs in through the real login form using `.env`;
  5. reads the production state: four durable stores, notebook locks, the opt-in
     key, the note count, leftover canary/conflict notes, and both telemetry
     counts;
  6. tears down by PROFILE MARKER, never by process count, and confirms the
     owner's browser is untouched by its command line;
  7. appends ONE fully-populated row, stamped in UTC, to the resume doc.

⛔⛔ IT REFUSES TO STAMP A ROW IF ANY READ FAILED. A check log whose rows might
be partial is worse than no log: it reads as evidence. Every read carries its
own ok/failed state, and `Check.complete` gates the write. `--self-check` proves
that refusal fires, which is the difference between a gate and a decoration
(`lesson_gate_that_cannot_fail`).

⛔ CREDENTIALS: read from `.env` (gitignored) and used only to fill the login
form. They are never printed, never written to the doc, never put in a command
line, and never stored anywhere by this script. If `.env` is missing, the run
stops before spawning anything.

⛔ IT CREATES NOTHING AND OPTS IN TO NOTHING. Every read is a read. The offline
flag is never written by this script — that is the owner's decision and this is
an instrument, not a switch.
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
ENV = ROOT / ".env"
PROD = "https://uctintelligence.com"
ACCOUNT_ID = "7a6d0299-fd98-4017-b8dc-51b849d1ab1d"

# ⭐ The unambiguous teardown marker. It appears in the profile path, so it is in
# the spawned browser's command line and CANNOT match anyone else's Chrome —
# which is what lets teardown target it without ever guessing at a PID.
MARKER = "uct-window-check-profile"

CHROME = pathlib.Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe")

# Where the row goes. The log lives under this heading in the resume doc.
ANCHOR = "## \U0001f4cb THE WINDOW-WATCH LOG"

BLOCKED_EVENT = "j2:notebook_blocked_no_baseline"
OPT_IN_EVENT = "j2:notebook_offline_opt_in"


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


# ── the result object: every read carries whether it actually happened ───────

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

    def add(self, name, ok, value=None, error=""):
        self.reads.append(Read(name, ok, value, error))
        return self.reads[-1]

    @property
    def complete(self) -> bool:
        """⛔ THE GATE. One failed read and no row is written."""
        return bool(self.reads) and all(r.ok for r in self.reads)

    @property
    def failures(self) -> list:
        return [r for r in self.reads if not r.ok]

    def row(self) -> str:
        lines = [f"### {self.label} — **{self.started}**", "", "| | reading |", "|---|---|"]
        for r in self.reads:
            lines.append(f"| {r.name} | {r.render()} |")
        lines.append("")
        return "\n".join(lines)


# ── the rig ─────────────────────────────────────────────────────────────────

def free_port() -> int:
    """⛔ A PORT IS NOT A SERVER IDENTITY. Binding proves nothing on Windows —
    a second listener on loopback is permitted while another process holds
    0.0.0.0. So this asks the OS for an ephemeral port AND the caller verifies
    the endpoint's identity before driving it."""
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
    """⛔ Reads `.env` and nothing else. Never returns them anywhere they could
    be printed by accident — the caller passes them straight to `fill()`."""
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
    """The BROWSER processes only — the ones with no `--type=`.

    ⛔ NEVER COUNT chrome.exe. Chrome reaps renderer/utility children constantly;
    a count-based check false-alarmed on 2026-09-10 over a child nothing killed.
    """
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
        if not line or "|" not in line:
            continue
        pid, mine = line.split("|", 1)
        out.append((int(pid), mine.strip().lower() == "true"))
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


# ── the reads ───────────────────────────────────────────────────────────────

STATE_JS = """async (acct) => {
  const out = {};
  try {
    const q = await navigator.locks.query();
    out.locks = [...q.held, ...q.pending]
      .filter(l => String(l.name).startsWith('uct.nb.sync.')).length;
  } catch { out.locks = 'ERR' }
  try {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('uct_notebook_' + acct);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
    const counts = {};
    for (const s of [...db.objectStoreNames]) {
      counts[s] = await new Promise(res => {
        const t = db.transaction(s, 'readonly').objectStore(s).getAll();
        t.onsuccess = () => res((t.result || []).length); t.onerror = () => res('ERR');
      });
    }
    out.stores = counts;
  } catch (e) { out.stores = 'ERR: ' + e.name }
  out.optInKey = localStorage.getItem('uct.j2.offline.enabled');
  out.drafts = Object.keys(localStorage).filter(k => k.startsWith('uct.j2.notedraft.')).length;
  return out;
}"""

NOTES_JS = """async () => {
  const r = await fetch('/api/j2/notes?limit=300', {credentials:'include'});
  if (!r.ok) return {ok:false, status:r.status};
  const list = await r.json();
  const notes = list.notes || [];
  return {
    ok: true,
    total: notes.length,
    canary: notes.filter(n => /CANARY/i.test(n.title || '')).map(n => n.title),
    conflicts: notes.filter(n => (n.tags || []).includes('sync-conflict')).map(n => n.title),
  };
}"""

ACTIVITY_JS = """async (names) => {
  const r = await fetch('/api/admin/activity?limit=200', {credentials:'include'});
  if (!r.ok) return {ok:false, status:r.status};
  const rows = await r.json();
  const out = {ok:true, rows: rows.length};
  for (const n of names) {
    const hits = rows.filter(x => x.action === n);
    out[n] = {count: hits.length, latest: hits.length ? hits[0].created_at : null};
  }
  return out;
}"""


def run_check(label: str, dry_run: bool) -> Check:
    from playwright.sync_api import sync_playwright   # imported late: --self-check needs no browser

    chk = Check(label=label)
    email, password = read_credentials()

    if not CHROME.exists():
        raise SystemExit(f"STOP: no Chrome at {CHROME}")

    port = free_port()
    if port_is_busy(port):
        raise SystemExit(f"STOP: something already answers on 127.0.0.1:{port}")

    profile = pathlib.Path(tempfile.mkdtemp(prefix=MARKER + "-"))
    proc = subprocess.Popen([
        str(CHROME),
        f"--user-data-dir={profile}",
        f"--remote-debugging-port={port}",
        "--remote-debugging-address=127.0.0.1",
        "--no-first-run", "--no-default-browser-check", "--new-window", "about:blank",
    ])
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
                f"PID **{proc.pid}** \u00b7 {version['Browser']} \u00b7 CDP `127.0.0.1:{port}` (loopback only) \u00b7 fresh profile" if version else None,
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

            probe = ("async () => await fetch('/api/health', {cache:'no-store'})"
                     ".then(r => 'ONLINE ' + r.status).catch(e => 'FAILED: ' + e.name)")

            offline(False)
            page.goto(PROD + "/login", wait_until="domcontentloaded")
            page.wait_for_timeout(3500)

            # ⛔ Offline proven BOTH WAYS before anything is measured through it.
            offline(True)
            page.wait_for_timeout(800)
            off, off_flag = page.evaluate(probe), page.evaluate("() => navigator.onLine")
            offline(False)
            page.wait_for_timeout(800)
            on, on_flag = page.evaluate(probe), page.evaluate("() => navigator.onLine")
            good = off.startswith("FAILED") and off_flag is False and on.startswith("ONLINE") and on_flag is True
            chk.add("offline proven both ways", good,
                    f"offline \u21d2 `{off}`, `navigator.onLine={str(off_flag).lower()}` \u00b7 online \u21d2 `{on}`, `{str(on_flag).lower()}`",
                    "CDP offline did not cut the transport")

            # ── sign in through the real form. Credentials never leave this scope.
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
                me = {"status": "exception", "id": None, "error": type(e).__name__}
            del password
            # ⭐ Identity is asserted by ACCOUNT ID, never by echoing the address.
            chk.add("signed in", signed and me.get("id") == ACCOUNT_ID,
                    f"`/api/auth/me` **200**, account `{me.get('id')}` \u2014 the canary account" if signed else None,
                    f"/api/auth/me returned {me.get('status')}"
                    + ("" if signed else " (login form did not authenticate)"))
            if not signed:
                return chk

            page.goto(PROD + "/journal/notebook", wait_until="domcontentloaded")
            page.wait_for_timeout(7000)

            st = page.evaluate(STATE_JS, ACCOUNT_ID)
            stores_ok = isinstance(st.get("stores"), dict)
            store_txt = (" \u00b7 ".join(f"`{k}` {v}" for k, v in st["stores"].items())
                         if stores_ok else str(st.get("stores")))
            chk.add("four durable stores", stores_ok, store_txt, "could not read the per-account database")
            chk.add("notebook locks", st.get("locks") != "ERR",
                    f"**{st.get('locks')}** `uct.nb.sync.*`", "navigator.locks unavailable")

            # ⛔ Name the reading, never call it "off": `unset` and `'0'` are
            #    different facts that happen to have the same effect.
            key = st.get("optInKey")
            key_txt = "**unset**" if key is None else f"**`'{key}'`**"
            chk.add("opt-in key", True,
                    f"{key_txt} \u2014 {'the production default' if key is None else 'explicitly set'}"
                    + (" \u21d2 offline layer OFF" if key in (None, "0") else " \u21d2 **OPTED IN**"))

            nt = page.evaluate(NOTES_JS)
            chk.add("notes", bool(nt.get("ok")),
                    f"**{nt.get('total')}** \u00b7 canary notes {len(nt.get('canary') or [])} \u00b7 `sync-conflict` {len(nt.get('conflicts') or [])}"
                    if nt.get("ok") else None,
                    f"GET /api/j2/notes returned {nt.get('status')}")

            act = page.evaluate(ACTIVITY_JS, [BLOCKED_EVENT, OPT_IN_EVENT])
            if act.get("ok"):
                blocked = act[BLOCKED_EVENT]
                optin = act[OPT_IN_EVENT]
                chk.add("`j2:notebook_blocked_no_baseline`", True,
                        f"count **{blocked['count']}** \u00b7 latest {blocked['latest'] or '**none**'}")
                chk.add("opted-in browsers (`j2:notebook_offline_opt_in`)", True,
                        f"count **{optin['count']}** \u00b7 latest {optin['latest'] or '**none**'}"
                        + ("  \u26d4\u26d4 **zero events over zero opted-in browsers is not evidence**"
                           if optin["count"] == 0 else ""))
            else:
                # ⚠️ 403 here is a real answer, not a crash: the canary account is
                # not an admin. Recorded as a FAILED read so the row is refused,
                # because a check that silently drops the instrument count is the
                # thing this script exists to prevent.
                chk.add("`j2:notebook_blocked_no_baseline`", False,
                        error=f"GET /api/admin/activity returned {act.get('status')} (admin-only)")
                chk.add("opted-in browsers (`j2:notebook_offline_opt_in`)", False,
                        error=f"GET /api/admin/activity returned {act.get('status')} (admin-only)")
    finally:
        killed = kill_by_marker()
        time.sleep(2)
        procs = browser_processes()
        mine_left = [p for p, mine in procs if mine]
        others = [p for p, mine in procs if not mine]
        chk.add("teardown", not mine_left,
                f"killed **{killed}** by marker \u00b7 0 left \u00b7 owner's browser process(es) {others} untouched",
                f"{len(mine_left)} marked process(es) survived: {mine_left}")
        for _ in range(5):
            try:
                shutil.rmtree(profile, ignore_errors=False)
                break
            except OSError:
                time.sleep(2)
        chk.add("profile deleted", not profile.exists(),
                f"`{profile.name}`", f"`{profile}` still on disk (a handle is held)")
    return chk


# ── stamping ────────────────────────────────────────────────────────────────

def stamp(chk: Check, dry_run: bool = False) -> bool:
    """⛔⛔ THE REFUSAL. A row is written only if EVERY read succeeded."""
    if not chk.complete:
        names = ", ".join(r.name for r in chk.failures)
        print(f"\u26d4 REFUSING TO STAMP: {len(chk.failures)} read(s) failed \u2014 {names}")
        print("   A check log whose rows might be partial reads as evidence. Nothing was written.")
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
    print(f"\u2705 stamped: {chk.label} @ {chk.started}")
    return True


def self_check() -> int:
    """Prove the refusal fires, and prove a healthy run still stamps.

    ⛔ Touches no browser, no network and no document. It exercises the one
    decision that makes this script trustworthy: `Check.complete`.
    """
    cases = []

    bad = Check(label="self-check: a failed read")
    bad.add("rig", True, "fine")
    bad.add("notes", False, error="GET /api/j2/notes returned 500")
    cases.append(("a failed read is refused", stamp(bad, dry_run=True) is False))

    empty = Check(label="self-check: no reads at all")
    cases.append(("a run with NO reads is refused", stamp(empty, dry_run=True) is False))

    good = Check(label="self-check: every read ok")
    good.add("rig", True, "fine")
    good.add("notes", True, "32")
    cases.append(("a complete run stamps", stamp(good, dry_run=True) is True))

    # And the row it would write actually carries the readings, rather than
    # rendering an empty table that looks complete.
    row = good.row()
    cases.append(("the row carries every reading", "| notes | 32 |" in row and good.started in row))

    # ⛔ A failed read must be VISIBLE in the rendering too, not silently blank —
    # otherwise a future edit that bypasses `complete` would print a clean row.
    cases.append(("a failed read renders as FAILED", "FAILED" in bad.reads[1].render()))

    bad_ct = 0
    for name, ok in cases:
        print(f"  {'ok  ' if ok else 'FAIL'} {name}")
        bad_ct += 0 if ok else 1
    print("self-check:", "PASS" if not bad_ct else f"FAIL ({bad_ct})")
    return 0 if not bad_ct else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--self-check", action="store_true", help="prove the refusal fires; runs nothing else")
    ap.add_argument("--label", default=None, help='row label, e.g. "check 4"')
    ap.add_argument("--dry-run", action="store_true", help="run the check but do not write the doc")
    args = ap.parse_args()

    if args.self_check:
        return self_check()

    label = args.label or f"check {next_check_number()}"
    chk = run_check(label, args.dry_run)
    print()
    for r in chk.reads:
        print(f"  {'ok  ' if r.ok else 'FAIL'} {r.name}: {r.render()}")
    print()
    return 0 if stamp(chk, args.dry_run) else 1


def next_check_number() -> int:
    """Derived from the doc, never typed — so two runs cannot both be 'check 3'."""
    try:
        text = DOC.read_text(encoding="utf-8")
    except OSError:
        return 1
    nums = [int(m) for m in re.findall(r"^### check (\d+)", text, re.M | re.I)]
    return (max(nums) + 1) if nums else 1


if __name__ == "__main__":
    sys.exit(main())
