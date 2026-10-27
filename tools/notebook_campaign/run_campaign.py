"""The 50-member test campaign runner (plan 2026-10-24-notebook-widgets-p2-w11.md, Task 11.21 Step 4).

    # against a sandbox this runner boots and owns (needed for the flag-flip persona P46):
    python tools/notebook_campaign/run_campaign.py --run-id w11-campaign-1 --own-sandbox `
        --data-dir 'C:\\data-nbw-campaign' --port 8131 --app-root C:\\Users\\Patrick\\uct-worktrees\\nbw-p2-impl
    # one persona at one viewport, keyboard only, against a sandbox already running:
    python tools/notebook_campaign/run_campaign.py --run-id dev --persona P09 --viewport 390 --keyboard `
        --base http://127.0.0.1:8131 --data-dir 'C:\\data-nbw-campaign'

PRECONDITIONS (the runner refuses without each, exit 3):
  * --base is localhost or 127.0.0.1. Anything else is a HARD EXIT before a browser starts: production
    stays dark, and only smoke@ and bench@ ever sign in to production; this tool never does.
  * the data dir was seeded by seed_members.py (its campaign-manifest.json holds the members and their
    sandbox sessions) and is not C:\\data or /data.
  * the server at --base proves it is the hub sandbox ON THAT DATA DIR: its identity path
    (scripts/sandbox_identity.py, served by the launcher) names the same data dir. A port is not an
    identity.
  * every expected sentence in personas.json is still in the source file it names (its `fragment`); a
    drifted sentence is never asserted, its steps read INCONCLUSIVE.

Per persona, per viewport (1200, 820, 390), per mode (pointer, keyboard-only), in its OWN browser context
(touch emulation at <= 1024 px), each step records: what it did and read, PASS / FAIL / INCONCLUSIVE, the
console errors and page errors, the failed requests (status >= 400 not expected by the step), the
horizontal overflow, the touch targets under 44 px (only on the touch tier, and only while the context
really is coarse-pointer), axe-core serious and critical findings (WCAG 2.x A/AA tags), the timings
(note first paint, each sheet open, each preview) and a screenshot. Keyboard-only mode never clicks: every
control is reached with Tab (arrow keys inside a radio group or tab list) and pressed with Enter or Space;
a visible control Tab cannot reach is a FAIL.

`needs` (personas.json): `w11` steps run only when the server has the wave 11 routes (probed once:
GET /api/j2/template-gallery/library answers 200), else INCONCLUSIVE; `restart` steps need --own-sandbox;
`clock` steps need --clock-launcher (tools/notebook_campaign/sandbox_clock.py, ruling W11-R49): a persona
whose scripts need `clock` runs against a server booted by that launcher at the persona's `clock` instant
(personas sharing an instant share one boot), with the browser's clock (Playwright context.clock) set to
the same shifted now, so client and server agree; without the launcher those steps stay INCONCLUSIVE. `clock` may
be a LIST of instants (a story across days): the persona joins one boot per instant and each script runs at the
instant its `at` names (default 0). `once` scripts (a per-member budget: the adopt scope, the publish cap, a one-time
line) run in the persona's first run only. Wave 11 steps (`w11_*`, tools/notebook_campaign/w11_steps.py) drive the
real routes over loopback HTTP as the persona's session, each graded PASS / FAIL / INCONCLUSIVE, or EXPECTED-PENDING
when the server answers the interim shape of a pending backend batch (never a pass, never a defect).
`sql_clock` steps (a verdict that rests on a SQLite CURRENT_TIMESTAMP / 'now' default) are always
INCONCLUSIVE: the launcher cannot shift the database's own clock. INCONCLUSIVE is never a pass.

Evidence (R-RAW, written as it happens): <out>/run.json, <out>/results.jsonl (one row per persona x
viewport x mode), <out>/<persona>/<viewport>-<mode>/steps/*.json and shots/*.png, and <out>/defects.jsonl
(the plan's schema; the runner files findings as status "untriaged" -- a person or agent reads the
evidence and sets "open" or "not-a-defect"). --out defaults to docs/notebook/evidence/<run-id>.

This driver never imports api.* in its own process.
"""
from __future__ import annotations

import argparse
import contextlib
import json
import os
import re
import subprocess
import sys
import time
import traceback
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import seed_members as seedmod  # noqa: E402
import w11_steps as w11  # noqa: E402

LOCAL_HOSTS = w11.LOCAL_HOSTS
T = 30000
TOUCH_MAX = 1024
TAP_FLOOR = 44
WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
W8, W9, W10, W11 = (f"NOTEBOOK_WIDGETS_W{n}_ENABLED" for n in (8, 9, 10, 11))
# Requests whose failure is the sandbox's own (vendor keys blanked, no broker, no live feed), never the
# step's: the walk's list (notebook_fin_walk.BENIGN) is used, plus these, each named for why.
EXTRA_BENIGN = (
    "/api/ticker-meta", "/api/bars/", "/api/quote", "/api/market-status",   # market data: keys blanked
)
ZERO_RE = re.compile(r"(?<![\d.,$])\$0(?![\d.,])|(?<![\d.,])0%|\(0\)|\bUsed by 0\b|\bNaN\b|\bundefined\b|"
                     r"\[object Object\]|\bInfinity\b|(?<![\d.,])0 (?:trades|days|of)\b")
SEVERITY = {"pageerror": "major", "http5xx": "major", "http4xx": "major", "console": "minor", "overflow": "major",
            "tap": "minor", "axe:critical": "critical", "axe:serious": "serious", "expectation": "major",
            "keyboard": "serious", "xss": "critical"}


class Inconclusive(Exception):
    """The step could not be driven to its end here (the message says why)."""


class Pending(Exception):
    """The server answered the documented interim shape of a change in a pending backend batch (EXPECTED-PENDING:
    never a pass, never a defect; the message names the batch)."""


class KeyboardUnreachable(Exception):
    """A visible control that Tab (and the arrow keys of its group) could not reach."""


# ── refusals and source checks (pure) ─────────────────────────────────────────────────────

#: THE loopback refusal lives in w11_steps (its HTTP door checks it on every call); one authority.
refuse_non_local = w11.refuse_non_local


def source_text(app_root: Path, source: str) -> str | None:
    """The text of a sentence's source: `path:line` in the app root, or `<ref>:path:line` read with git."""
    m = re.match(r"^(?:(?P<ref>origin/[^:]+):)?(?P<path>[^:]+?)(?::(?P<line>\d+))?$", source)
    if not m:
        return None
    if m["ref"]:
        r = subprocess.run(["git", "show", f"{m['ref']}:{m['path']}"], cwd=str(app_root), capture_output=True,
                           text=True, encoding="utf-8", errors="replace")
        return r.stdout if r.returncode == 0 else None
    p = app_root / m["path"]
    return p.read_text(encoding="utf-8", errors="replace") if p.is_file() else None


def verify_sentences(spec: dict, app_root: Path) -> dict:
    """key -> {ok, why, line_ok}. `ok` = the fragment is in the named file; `line_ok` = also on the named line."""
    out = {}
    for key, s in spec["sentences"].items():
        frag = s.get("fragment") or s["text"]
        txt = source_text(app_root, s["source"])
        if txt is None:
            out[key] = {"ok": False, "why": f"source {s['source']} is unreadable"}
            continue
        if frag not in txt:
            out[key] = {"ok": False, "why": f"fragment not in {s['source']}: {frag!r}"}
            continue
        line = re.search(r":(\d+)$", s["source"])
        lines = txt.splitlines()
        line_ok = bool(line) and 0 < int(line[1]) <= len(lines) and frag[:24] in lines[int(line[1]) - 1]
        out[key] = {"ok": True, "why": "", "line_ok": line_ok}
    return out


# The walk's TAP_JS measures the control's own box. A member taps the control OR its label: a checkbox
# inside a <label>, or one named by <label for>, is hit through the label's box too (the WCAG 2.5.8 /
# platform rule). This variant reports a control as small only when neither box reaches the floor, and
# says what each small one is, so a finding can be triaged from the JSON alone.
TAP_JS = """([sel, floor]) => {
  const root = (sel && document.querySelector(sel)) || document.body;
  const vis = (e) => { const b = e.getBoundingClientRect(); const s = getComputedStyle(e);
                       return b.width > 0 && b.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' };
  const ctl = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=switch], [role=tab], [role=menuitem], [role=option], [role=checkbox]')]
    .filter(vis).filter(e => !e.disabled);
  const boxOf = (e) => { const b = e.getBoundingClientRect(); let w = b.width, h = b.height;
    const labels = [...(e.labels || [])];
    for (const l of labels) { const lb = l.getBoundingClientRect(); w = Math.max(w, lb.width); h = Math.max(h, lb.height) }
    return { w, h, b } };
  const vw = document.documentElement.clientWidth, vh = window.innerHeight;
  const small = [];
  for (const e of ctl) {
    const { w, h, b } = boxOf(e);
    if (w >= floor && h >= floor) continue;
    if (b.width <= 2 || b.height <= 2) continue;          // visually hidden input; its label is the target
    small.push({ label: (e.getAttribute('aria-label') || e.innerText || e.value || e.tagName).trim().replace(/\\s+/g, ' ').slice(0, 40),
                 tag: e.tagName, cls: String(e.className && e.className.baseVal !== undefined ? e.className.baseVal : e.className || '').slice(0, 50),
                 w: Math.round(w), h: Math.round(h), x: Math.round(b.left), y: Math.round(b.top),
                 offscreen: b.right <= 0 || b.left >= vw || b.bottom <= 0 || b.top >= vh,
                 // what a tap at its centre would hit: a control clipped away or covered (an off-canvas panel)
                 // is not a target the member can reach, so it is reported but not a finding
                 covered: (() => { const cx = b.left + b.width / 2, cy = b.top + b.height / 2;
                   if (cx < 0 || cy < 0 || cx >= vw || cy >= vh) return true;
                   const hit = document.elementFromPoint(cx, cy);
                   return !(hit && (hit === e || e.contains(hit) || hit.contains(e) || [...(e.labels || [])].some(l => l.contains(hit)))) })() });
  }
  return { scope: sel && document.querySelector(sel) ? sel : 'body', controls: ctl.length,
           small: small.slice(0, 25), smallCount: small.length };
}"""


# The walk's axe call, plus each violation's first failure summary (the contrast ratio, the size it measured),
# so a finding can be triaged from the evidence without re-running the page.
AXE_RUN_JS = """async ([sel, tags]) => {
  const root = (sel && document.querySelector(sel)) || document.body;
  const r = await window.axe.run(root, { runOnly: { type: 'tag', values: tags }, resultTypes: ['violations'] });
  return { version: window.axe.version, scope: sel && document.querySelector(sel) ? sel : 'body',
           violations: r.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
             targets: v.nodes.slice(0, 4).map(n => n.target.join(' ')),
             summary: (v.nodes[0] && v.nodes[0].failureSummary || '').slice(0, 300),
             html: (v.nodes[0] && v.nodes[0].html || '').slice(0, 200) })) };
}"""


def zeros_in(text: str) -> list[str]:
    return sorted({m.group(0) for m in ZERO_RE.finditer(text or "")})


def defect_signature(d: dict) -> tuple:
    return (d.get("persona"), d.get("viewport"), d.get("keyboard"), d.get("expected"), tuple(d.get("steps") or []))


def defect_key(expected, actual) -> tuple:
    """Two findings are one defect when they differ only in numbers and generated ids (a measured width, a
    React id in aria-controls, a note id in a URL): those are normalised out of the key, never the text."""
    norm = re.sub(r"_r_[a-z0-9]+_", "_r_", str(actual or ""))
    norm = re.sub(r"[0-9a-f]{32}|[0-9a-f-]{36}", "<id>", norm)
    norm = re.sub(r"\d+(?:\.\d+)?", "#", norm)
    return (expected, norm)


def next_defect_ids(existing: list[dict], n: int) -> list[str]:
    nums = [int(m[1]) for d in existing if (m := re.match(r"D-W11-(\d+)$", str(d.get("id", ""))))]
    start = max(nums, default=0) + 1
    return [f"D-W11-{k:03d}" for k in range(start, start + n)]


def run_verdict(steps: list[dict]) -> str:
    if any(s["verdict"] == "FAIL" or s.get("findings") for s in steps):
        return "FAIL"
    if not steps or any(s["verdict"] in ("INCONCLUSIVE", w11.PENDING) for s in steps):
        return "INCONCLUSIVE"
    return "PASS"


def write_json(path: Path, obj) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(obj, indent=1, ensure_ascii=False, default=str), encoding="utf-8", newline="\n")
    os.replace(tmp, path)


def append_jsonl(path: Path, row: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "a", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")


def read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    return [json.loads(x) for x in path.read_text(encoding="utf-8").splitlines() if x.strip()]


# ── the app root's own walk helpers (imported, never copied) ──────────────────────────────

def load_walk_libs(app_root: Path):
    for p in (app_root / "tools", app_root / "scripts"):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))
    import notebook_perf_harness as h  # noqa: E402
    import notebook_fin_walk as fw  # noqa: E402
    import notebook_widgets_p2_walk as walk  # noqa: E402
    import sandbox_identity as sid  # noqa: E402
    return h, fw, walk, sid


# ── the sandbox this runner may own ───────────────────────────────────────────────────────

def campaign_env(fs: dict, overrides: dict | None = None) -> list[str]:
    """The flags a campaign server boots with (production's armed set + W8..W11 = 1, then `overrides`),
    written into this process's environment for the launcher child to inherit. Shared by the owned
    sandbox and the clock sandbox, so the two serve the same product."""
    overrides = overrides or {}
    for name in fs["all_names"]:
        os.environ.pop(name, None)
    for k in [k for k in os.environ if k.startswith("RAILWAY_")]:
        os.environ.pop(k, None)
    on = sorted(set(fs["c1"]) | {W8, W9, W10, W11})
    os.environ.update({n: "1" for n in on})
    os.environ.update(overrides)
    os.environ.update({"FMP_API_KEY": "", "FINNHUB_API_KEY": "", "ALPHAVANTAGE_API_KEY": "", "MASSIVE_API_KEY": ""})
    return on + [f"{k}={v}" for k, v in overrides.items()]


class OwnedSandbox:
    """The app's launcher on the seeded data dir, started with the flags production has armed plus
    W8..W11 = 1, and restarted with overrides for a flag-flip step. Stopped gracefully; each boot's
    integrity log is moved into the evidence folder and its first line recorded."""

    def __init__(self, h, fw, data_dir: Path, port: int, out: Path):
        self.h, self.fw, self.data_dir, self.port, self.out = h, fw, data_dir, port, out
        self.sb = None
        self.boots: list[dict] = []
        self.fs = fw.flag_sets()
        self.overrides: dict = {}

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def env(self) -> list[str]:
        return campaign_env(self.fs, self.overrides)

    def start(self) -> None:
        if self.h.port_busy(self.port):
            raise SystemExit(f"REFUSED: port {self.port} already has a listener (never killed)")
        flags = self.env()
        n = len(self.boots) + 1
        self.sb = self.h.Sandbox(str(self.data_dir), self.port, self.out / f"sandbox-boot{n}.log")
        self.sb.start()
        rec = {"boot": n, "flags_overridden": dict(self.overrides), "flags_on": flags, "pid": self.sb.proc.pid,
               "started": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        self.boots.append(rec)
        if not self.sb.wait_healthy(self.base, 400):
            self.stop()
            raise SystemExit(f"REFUSED: the sandbox never answered /api/health (boot {n})")
        self.sb.wait_checkpoint(self.h.POST_BOOT, self.h.POST_BOOT_WAIT_S)

    def stop(self) -> None:
        if not self.sb:
            return
        rec = self.boots[-1]
        rec["stop"] = self.sb.stop()
        ipath = self.sb.integrity_path()
        kept = self.out / f"integrity-boot{rec['boot']}.md"
        if ipath and Path(ipath).is_file():
            kept.write_text(Path(ipath).read_text(encoding="utf-8", errors="replace"), encoding="utf-8", newline="\n")
            Path(ipath).unlink()
        integ = self.h.read_integrity(kept, [self.h.PRE_BOOT, self.h.POST_BOOT, self.h.SHUTDOWN])
        rec["first_line"] = self.h.integrity_line(integ, f"boot {rec['boot']}; stop: {rec['stop']}")
        rec["clean"] = bool(integ.get("clean"))
        print(rec["first_line"], flush=True)
        self.sb = None

    def restart(self, overrides: dict) -> None:
        self.stop()
        self.overrides = dict(overrides)
        self.start()


# ── the clock-shifted sandbox (ruling W11-R49) ───────────────────────────────────────────

def persona_needs_clock(p: dict) -> bool:
    """True when any of the persona's scripts or steps declares `needs: clock`."""
    for sc in p.get("scripts") or []:
        if "clock" in (sc.get("needs") or []) or any("clock" in (s.get("needs") or []) for s in sc.get("steps") or []):
            return True
    return False


def clock_instants(p: dict) -> list[str]:
    """The persona's clock instants, in its own order: `clock` is one ISO instant or a LIST of them (a persona whose
    story crosses days, e.g. P41's three ET days). A script names the instant it runs at with `at` (an index, default
    0). Each instant must carry a UTC offset; a script's `at` must name one of them."""
    raw = p.get("clock")
    out = raw if isinstance(raw, list) else ([raw] if raw else [])
    if not out or not all(isinstance(x, str) and x for x in out):
        raise ValueError(f"{p.get('id')} needs the clock but declares no `clock` instant in personas.json")
    for x in out:
        if datetime.fromisoformat(x).tzinfo is None:
            raise ValueError(f"{p.get('id')}'s clock {x!r} has no UTC offset")
    for sc in p.get("scripts") or []:
        at = sc.get("at", 0)
        if not isinstance(at, int) or isinstance(at, bool) or not 0 <= at < len(out):
            raise ValueError(f"{p.get('id')} script {sc.get('id')} runs `at` {at!r}, not one of its {len(out)} instants")
    return out


def clock_groups(people: list[dict]) -> list[tuple[str, list[dict]]]:
    """Clock personas grouped by instant (one launcher boot per instant), in time order. A persona with several
    instants appears in several groups, each time as a copy carrying `_at` (the index of that instant), so the run
    at that boot drives only the scripts whose `at` is that index. A persona that needs the clock but declares none
    is its own refusal: `(None, [p])` is never returned, it raises."""
    groups: dict[float, tuple[str, list[dict]]] = {}
    for p in people:
        if not persona_needs_clock(p):
            continue
        instants = clock_instants(p)
        for i, inst in enumerate(instants):
            at = datetime.fromisoformat(inst)
            entry = {**p, "_at": i} if len(instants) > 1 else p
            groups.setdefault(at.timestamp(), (at.isoformat(), []))[1].append(entry)    # one instant, any spelling
    return [groups[k] for k in sorted(groups)]


def once_gate(ran: dict, persona: dict, sc: dict, run: str) -> str | None:
    """A `once` script spends a per-member budget (the adopt scope's 30/hour, the publish 10/day, a one-time line):
    it runs in the persona's FIRST run (per clock instant) only. None = run it now (and remember this run); else the
    run it already ran in, which the skipping run records."""
    if not sc.get("once"):
        return None
    key = (persona["id"], sc["id"], persona.get("_at"))
    if key in ran:
        return ran[key]
    ran[key] = run
    return None


def scripts_at(persona: dict) -> list[dict]:
    """The scripts a run drives: all of them, or (under a clock group of a multi-instant persona) those `at` it."""
    if "_at" not in persona:
        return list(persona.get("scripts") or [])
    return [sc for sc in persona.get("scripts") or [] if sc.get("at", 0) == persona["_at"]]


class ClockSandbox:
    """`sandbox_clock.py` on the seeded data dir at one instant, in its own process group, on loopback.
    Stopped by the signal uvicorn handles, then by PID if it does not exit. The launcher hashes nothing
    under the shared data root (its shared-root guard is the census tripwire, and it says so at boot)."""

    def __init__(self, h, fw, launcher: Path, app_root: Path, data_dir: Path, port: int, out: Path):
        self.h, self.launcher, self.app_root, self.data_dir, self.port, self.out = h, launcher, app_root, data_dir, port, out
        self.fs = fw.flag_sets()
        self.proc = None
        self.boots: list[dict] = []

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.port}"

    def start(self, instant: str, personas: list[str] | None = None) -> dict:
        if self.h.port_busy(self.port):
            raise SystemExit(f"REFUSED: port {self.port} already has a listener (never killed); pass --clock-port")
        flags = campaign_env(self.fs)
        n = len(self.boots) + 1
        log = self.out / f"clock-boot{n}.log"
        cmd = [sys.executable, "-u", "-c", self.h._SHIM, str(self.launcher), "--clock", instant,
               "--data-dir", str(self.data_dir), "--port", str(self.port), "--host", "127.0.0.1",
               "--app-root", str(self.app_root), "--personas", ",".join(personas or [])]
        kw = ({"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True})
        with open(log, "w", encoding="utf-8") as fh:
            self.proc = subprocess.Popen(cmd, cwd=str(self.app_root), stdout=fh, stderr=subprocess.STDOUT, **kw)
        rec = {"boot": n, "clock": instant, "pid": self.proc.pid, "log": str(log), "flags_on": flags,
               "started": datetime.now(timezone.utc).isoformat(timespec="seconds")}
        self.boots.append(rec)
        import urllib.request
        end = time.time() + 400
        while time.time() < end and self.proc.poll() is None:
            try:
                with urllib.request.urlopen(self.base + "/api/health", timeout=3) as r:
                    if r.status == 200:
                        return rec
            except Exception:  # noqa: BLE001 -- not up yet
                pass
            time.sleep(0.5)
        self.stop()
        raise SystemExit(f"REFUSED: the clock sandbox never answered /api/health (boot {n}; log {log})")

    def stop(self) -> None:
        if self.proc is None:
            return
        rec = self.boots[-1]
        how = "exited on its own"
        if self.proc.poll() is None:
            import signal
            try:
                self.proc.send_signal(signal.CTRL_BREAK_EVENT if os.name == "nt" else signal.SIGINT)
                self.proc.wait(timeout=60)
                how = f"graceful (rc {self.proc.returncode})"
            except Exception:  # noqa: BLE001 -- no console, or it did not exit: by PID
                self.proc.kill()
                self.proc.wait()
                how = f"killed by PID {self.proc.pid}"
        rec["stop"] = how
        print(f"clock sandbox boot {rec['boot']} ({rec['clock']}) stopped: {how}", flush=True)
        self.proc = None


def verify_clock_server(ident: dict | None, instant: str) -> str | None:
    """Why the served identity does not prove a clock shift to `instant`, or None."""
    shift = (ident or {}).get("clock_shift") or {}
    if not shift:
        return "the server's identity carries no clock_shift (not sandbox_clock.py)"
    try:
        want = datetime.fromisoformat(instant)
        got = datetime.fromisoformat(shift["instant"])
    except (KeyError, ValueError) as e:
        return f"the server's clock_shift is unreadable ({e})"
    if got != want:
        return f"the server was shifted to {shift.get('instant')}, not {instant}"
    return None


# ── one run: a persona at a viewport in a mode ────────────────────────────────────────────

class Run:
    def __init__(self, g: "Campaign", persona: dict, vp: str, mode: str):
        self.g, self.p, self.vp, self.mode = g, persona, vp, mode
        self.keyboard = mode == "keyboard"
        self.size = tuple(g.spec["viewport_sizes"][vp])
        self.touch = self.size[0] <= TOUCH_MAX
        self.member = g.manifest["members"].get(persona["id"], {})
        self.dir = g.out / persona["id"] / (f"{vp}-{mode}" + (f"-at{persona['_at']}" if "_at" in persona else ""))
        self.contexts: dict = {}
        self.pages: dict = {}          # name -> (page, events list)
        self.alias: dict = {}
        self.remembered: dict = {}
        self.tag = f"{g.run_id}-{vp}-{mode}"
        self.steps: list[dict] = []

    # contexts and pages
    def new_context(self, name: str):
        ctx = self.g.browser.new_context(viewport={"width": self.size[0], "height": self.size[1]},
                                         screen={"width": self.size[0], "height": self.size[1]},
                                         has_touch=self.touch, is_mobile=self.touch, reduced_motion="reduce")
        if self.g.clock_server is not None:
            # The browser's clock agrees with the server's: the same shifted now, ticking.
            ctx.clock.install(time=shifted_now())
        session = (self.g.session_override or {}).get(self.p["id"]) or self.member.get("session")
        if session:
            host = urlparse(self.g.base).hostname
            ctx.add_cookies([{"name": "uct_session", "value": session, "domain": host, "path": "/",
                              "httpOnly": True, "secure": False, "sameSite": "Lax"}])
        self.contexts[name] = ctx
        return ctx

    def new_page(self, name: str, ctx_name: str = "main"):
        ctx = self.contexts.get(ctx_name) or self.new_context(ctx_name)
        pg = ctx.new_page()
        ev: list = []
        g = self.g

        def on_resp(r):
            if r.status >= 400 and not any(b in r.url for b in g.benign):
                ev.append({"http": r.status, "method": r.request.method, "url": r.url[:240]})
        pg.on("console", lambda m: m.type == "error" and not m.text.startswith("Failed to load resource")
              and ev.append({"console": m.text[:400]}))
        pg.on("pageerror", lambda e: ev.append({"pageerror": str(e)[:400]}))
        pg.on("response", on_resp)
        pg.on("dialog", lambda d: (ev.append({"xss": f"a {d.type} dialog opened: {d.message[:120]}"}), d.dismiss()))
        self.pages[name] = (pg, ev)
        return pg

    def page(self, name: str = "main"):
        if name not in self.pages:
            self.new_page(name)
        return self.pages[name][0]

    def close(self):
        for c in self.contexts.values():
            with contextlib.suppress(Exception):
                c.close()

    def url(self, path: str) -> str:
        return self.g.base + self.fmt(path)

    def fmt(self, s):
        if isinstance(s, str):
            return s.replace("{run}", self.tag)
        if isinstance(s, list):
            return [self.fmt(x) for x in s]
        if isinstance(s, dict):
            return {self.fmt(k): self.fmt(v) for k, v in s.items()}
        return s

    def resolve(self, s):
        """`@routine:<name>`, `@tracker:<name>`, `@item:<routine>:<n>`, `@today`, `@session-N` and saved
        aliases, in a path, a body or a check path."""
        if isinstance(s, list):
            return [self.resolve(x) for x in s]
        if isinstance(s, dict):
            return {self.resolve(k): self.resolve(v) for k, v in s.items()}
        if not isinstance(s, str):
            return s
        s = self.fmt(s)

        def tool(kind, name):
            for t in self.member.get(kind, []) or []:
                if t["name"] == name:
                    return t
            for k, v in self.alias.items():
                if isinstance(v, dict) and v.get("name") == name:
                    return v
            raise Inconclusive(f"no seeded {kind[:-1]} named {name!r}")

        def sub(m):
            word = m.group(1)
            if word.startswith("routine:"):
                return tool("routines", word[8:])["id"]
            if word.startswith("tracker:"):
                return tool("trackers", word[8:])["id"]
            if word.startswith("item:"):
                rname, k = word[5:].rsplit(":", 1)
                return tool("routines", rname)["items"][int(k)]
            if word == "today":
                return today_et().isoformat()
            if word.startswith("session-"):
                return weekdays_back(today_et(), int(word[8:])).isoformat()
            if word in self.alias:
                v = self.alias[word]
                return v["id"] if isinstance(v, dict) else str(v)
            return m.group(0)
        return re.sub(r"@([A-Za-z][\w\- ]*(?::[\w\- ]+)*(?::\d+)?)", sub, s)


# Seconds the server under test is ahead of the wall clock (sandbox_clock's offset); 0 for a real-time server.
CLOCK_OFFSET_S = 0.0


def shifted_now() -> datetime:
    return datetime.fromtimestamp(time.time() + CLOCK_OFFSET_S, timezone.utc)


def today_et() -> date:
    from zoneinfo import ZoneInfo
    return shifted_now().astimezone(ZoneInfo("America/New_York")).date()


def weekdays_back(d: date, n: int) -> date:
    """n weekdays before d (exchange holidays are not known here; the step that uses it says so)."""
    while n:
        d -= timedelta(days=1)
        if d.weekday() < 5:
            n -= 1
    return d


# ── input: pointer or keyboard-only ───────────────────────────────────────────────────────

FOCUS_IN_JS = "el => el === document.activeElement || el.contains(document.activeElement)"
ROVING_JS = """(el) => {
  // The arrow key that moves focus from the focused element toward `el` inside ONE roving group (a radio
  // group, a tab list, a listbox, or a useRovingTabIndex toolbar / nav: one Tab stop, arrows inside), or ''.
  const a = document.activeElement; if (!a || a === el) return '';
  const role = (x) => x.getAttribute('role') || (x.type === 'radio' ? 'radio' : '');
  const groupOf = (x) => x.closest('[role=radiogroup],[role=tablist],[role=listbox],[role=menu],[role=toolbar],nav');
  const both = (sel) => el.matches(sel) && a.matches(sel);
  let same = false;
  if (el.type === 'radio' && a.type === 'radio' && el.name && el.name === a.name) same = true;
  else if (role(el) && role(el) === role(a) && ['radio', 'tab', 'option', 'menuitem'].includes(role(el))) same = groupOf(el) && groupOf(el) === groupOf(a);
  else if (both('[data-roving-item]')) same = groupOf(el) && groupOf(el) === groupOf(a);
  if (!same) return '';
  const g = groupOf(el);
  const vertical = (g && g.getAttribute('aria-orientation') === 'vertical') || role(el) === 'option' || role(el) === 'menuitem';
  const before = !!(a.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING);
  return vertical ? (before ? 'ArrowDown' : 'ArrowUp') : (before ? 'ArrowRight' : 'ArrowLeft');
}"""


FOCUS_EXACT_JS = "el => el === document.activeElement"


def tab_to(pg, loc, limit: int = 160, exact: bool = False) -> int:
    """Tab until `loc` holds focus. `exact`: the element itself, not a control inside it (the note's
    editor holds placed widgets whose buttons are focusable; typing there would go nowhere)."""
    loc.wait_for(state="visible", timeout=T)
    h = loc.element_handle(timeout=T)
    for i in range(limit):
        if h.evaluate(FOCUS_EXACT_JS if exact else FOCUS_IN_JS):
            return i
        key = h.evaluate(ROVING_JS)
        if key:
            for _ in range(24):
                pg.keyboard.press(key)
                if h.evaluate(FOCUS_IN_JS):
                    return i
            raise KeyboardUnreachable(f"{key} never reached {describe(loc)} inside its group")
        pg.keyboard.press("Tab")
    raise KeyboardUnreachable(f"{limit} Tab presses never reached {describe(loc)}")


def describe(loc) -> str:
    try:
        return loc.evaluate("e => (e.getAttribute('aria-label') || e.innerText || e.value || e.tagName).trim().slice(0, 60)")
    except Exception:  # noqa: BLE001
        return str(loc)[:80]


def act(R: Run, pg, loc, key: str | None = None) -> None:
    """Press a control: keyboard-only (Tab to it, then Enter or Space) or the pointer (a tap on the touch tier)."""
    loc.wait_for(state="visible", timeout=T)
    if R.keyboard:
        tab_to(pg, loc)
        role = (loc.get_attribute("role") or "").lower()
        typ = (loc.get_attribute("type") or "").lower()
        if key is None:
            key = "Space" if role in ("checkbox", "switch", "radio") or typ in ("checkbox", "radio") else "Enter"
        pg.keyboard.press(key)
    elif R.touch:
        loc.scroll_into_view_if_needed(timeout=T)
        loc.tap(timeout=T)
    else:
        loc.click(timeout=T)


def fill(R: Run, pg, loc, value: str) -> None:
    loc.wait_for(state="visible", timeout=T)
    if R.keyboard:
        tab_to(pg, loc)
        pg.keyboard.press("Control+A")
        pg.keyboard.type(value, delay=15)
    else:
        loc.fill(value)


def top_dialog(pg):
    d = pg.locator("[role=dialog]:visible")
    return d.last if d.count() else None


def surface(pg, within: str | None):
    if within in (None, "dialog"):
        d = top_dialog(pg)
        if d is not None:
            return d
        if within == "dialog":
            raise Inconclusive("no dialog is open")
        return pg.locator("body")
    if within == "page":
        return pg.locator("body")
    loc = pg.locator(within)
    return loc.first if loc.count() else pg.locator("body")


def editor(pg):
    ed = pg.locator(".ProseMirror").first
    ed.wait_for(state="visible", timeout=T)
    return ed


def caret_to_end(R: Run, pg) -> None:
    ed = editor(pg)
    if R.keyboard:
        tab_to(pg, ed, exact=True)
    else:
        paras = ed.locator(":scope > p")
        target = paras.last if paras.count() else ed
        target.scroll_into_view_if_needed()
        target.click()
    pg.keyboard.press("Control+End")


def live_text(pg) -> str:
    return pg.locator("[data-testid=builder-live]").last.text_content() or ""


def wait_live(pg, pred_js: str = "t => t.length > 0", timeout: int = T) -> str:
    pg.wait_for_function("(p) => { const e = [...document.querySelectorAll('[data-testid=builder-live]')].pop();"
                         " const t = e ? (e.textContent || '') : ''; return (new Function('t', 'return (' + p + ')(t)'))(t) }",
                         arg=pred_js, timeout=timeout)
    return live_text(pg)


def js_regex_test(rx: str) -> str:
    """A JS predicate for a Python regex: a leading (?i) becomes the `i` flag (JS has no inline flags)."""
    flags = ""
    if rx.startswith("(?i)"):
        rx, flags = rx[4:], "i"
    return f"t => new RegExp({json.dumps(rx)}, {json.dumps(flags)}).test(t)"


def builder(pg):
    dlg = pg.get_by_role("dialog").filter(has_text=re.compile(r"Build a widget|Edit widget|Edit a copy")).last
    dlg.wait_for(timeout=T)
    return dlg


def goto(R: Run, pg, path: str) -> float:
    t0 = time.perf_counter()
    pg.goto(R.url(path), wait_until="domcontentloaded", timeout=60000)
    pg.wait_for_function("() => { const r = document.getElementById('root'); return r && r.childElementCount > 0 }",
                         timeout=T)
    ms = (time.perf_counter() - t0) * 1000
    R.g.h._dismiss_intro(pg)
    R.g.fw.settle_first_run(pg)
    return ms


# ── the actions personas.json names ───────────────────────────────────────────────────────

def a_seed_note(R, s, row):
    pg = R.page()
    body = {"type": "doc", "content": [{"type": "paragraph", "content": ([{"type": "text", "text": t}] if t else [])}
                                       for t in (s.get("paras") or [""])]}
    r = pg.request.post(R.g.base + "/api/j2/notes", data={"title": R.fmt(s["title"]), "bodyJson": body})
    row["read"].append({"what": "POST /api/j2/notes", "text": f"HTTP {r.status}"})
    if r.status not in (200, 201):
        raise Inconclusive(f"the notes door refused the seed note: HTTP {r.status} {r.text()[:200]}")
    R.alias[s.get("save_as", "n1")] = r.json()["note"]["id"]


def a_open(R, s, row):
    pg = R.page()
    ms = goto(R, pg, s["path"])
    row["timings"][s.get("timing") or "page_first_paint"] = round(ms)


def a_open_note(R, s, row):
    pg = R.page()
    nid = R.alias.get(s["note"])
    if not nid:
        raise Inconclusive(f"no note {s['note']!r} was made earlier in this run")
    t0 = time.perf_counter()
    pg.goto(R.url(f"/journal/notebook?note={nid}"), wait_until="domcontentloaded", timeout=60000)
    # The clock stops when the editor is drawn, BEFORE the intro is dismissed: the intro's own wait is
    # not the note's paint (the tooling dry run's timings still included it; see the campaign report).
    pg.locator(".ProseMirror").first.wait_for(state="attached", timeout=T)
    row["timings"][s.get("timing") or "note_first_paint"] = round((time.perf_counter() - t0) * 1000)
    R.g.h._dismiss_intro(pg)
    editor(pg)
    if "expect_frames" in s or "expect_routine_boxes" in s:
        render_all(pg)
    if "expect_frames" in s:
        n = pg.locator("[data-snapshot-frame]").count()
        check(row, f"at least {s['expect_frames']} placed widget(s) draw", n >= s["expect_frames"], f"{n} frames")
    if "expect_routine_boxes" in s:
        if s["expect_routine_boxes"]:
            with contextlib.suppress(Exception):
                pg.locator("[data-routine-block] [role=checkbox]").first.wait_for(timeout=15000)
        n = pg.locator("[data-routine-block] [role=checkbox]").count()
        check(row, "the routine block draws its ticks" if s["expect_routine_boxes"] else "no tick control is drawn",
              (n > 0) == bool(s["expect_routine_boxes"]), f"{n} checkboxes")


def render_all(pg) -> None:
    n = pg.evaluate("() => document.querySelector('.ProseMirror') ? document.querySelector('.ProseMirror').children.length : 0")
    for i in range(min(n, 40)):
        pg.evaluate("(i) => { const c = document.querySelector('.ProseMirror').children[i]; if (c) c.scrollIntoView({block: 'center'}) }", i)
        pg.wait_for_timeout(250)
    pg.wait_for_timeout(1000)


def slash(R, pg, text: str, pick: str | None):
    menu = pg.get_by_role("listbox", name="Insert block").last
    for attempt in range(2):
        caret_to_end(R, pg)
        pg.keyboard.press("Enter")
        pg.keyboard.type(text, delay=25)
        try:
            menu.wait_for(timeout=8000 if attempt == 0 else T)
            break
        except Exception:  # noqa: BLE001
            if attempt:
                raise Inconclusive(f"the / menu never opened for {text!r}")
            for _ in text:
                pg.keyboard.press("Backspace")
    pg.wait_for_timeout(400)
    if pick:
        opts = menu.get_by_role("option")
        texts = opts.all_inner_texts()
        idx = next((i for i, t in enumerate(texts) if re.search(pick, t)), None)
        if idx is None:
            raise Inconclusive(f"no / menu row matches {pick!r}: {texts[:8]}")
        sel = next((i for i in range(len(texts)) if opts.nth(i).get_attribute("aria-selected") == "true"), 0)
        for _ in range(max(0, idx - sel)):
            pg.keyboard.press("ArrowDown")
    pg.keyboard.press("Enter")


def a_slash(R, s, row):
    pg = R.page()
    slash(R, pg, s["text"], s.get("pick"))
    pg.wait_for_timeout(1500)


def a_open_builder(R, s, row):
    pg = R.page()
    t0 = time.perf_counter()
    slash(R, pg, "/build", None)
    builder(pg)
    row["timings"][s.get("timing") or "sheet_open"] = round((time.perf_counter() - t0) * 1000)
    row["surface"] = "dialog"


def a_builder_example(R, s, row):
    pg = R.page()
    dlg = builder(pg)
    card = dlg.locator(f'[data-testid="example-card-{s["card"]}"]')
    t0 = time.perf_counter()
    act(R, pg, card)
    said = wait_live(pg)
    row["timings"][s.get("timing") or "preview"] = round((time.perf_counter() - t0) * 1000)
    row["read"].append({"what": "builder live region", "text": said})
    sent_check(R, row, "live_startswith", s, said, lambda txt, t: t.startswith(txt + " ") or t.startswith(txt + " \u00b7"))
    sent_check(R, row, "live_not_startswith", s, said, lambda txt, t: not t.startswith(txt))


def a_builder_blank(R, s, row):
    pg = R.page()
    dlg = builder(pg)
    act(R, pg, dlg.get_by_role("button", name="Start blank"))
    t0 = time.perf_counter()
    act(R, pg, dlg.get_by_role("radio", name=s["source"]))
    said = wait_live(pg)
    row["timings"][s.get("timing") or "preview"] = round((time.perf_counter() - t0) * 1000)
    row["read"].append({"what": "builder live region", "text": said})


def a_builder_split(R, s, row):
    pg = R.page()
    dlg = builder(pg)
    act(R, pg, dlg.get_by_role("button", name=re.compile(r"split", re.I)).first)
    act(R, pg, dlg.get_by_role("button", name=s["by"], exact=True))
    rx = s.get("live_re")
    try:
        said = wait_live(pg, js_regex_test(rx or "."))
    except Exception:  # noqa: BLE001
        said = live_text(pg)
    row["read"].append({"what": "builder live region", "text": said})
    if rx:
        check(row, f"the live summary matches {rx}", re.search(rx, said) is not None, said)


def a_builder_name(R, s, row):
    pg = R.page()
    fill(R, pg, builder(pg).get_by_label("Name", exact=True), R.fmt(s["value"]))
    pg.wait_for_timeout(600)


def a_builder_save(R, s, row):
    pg = R.page()
    dlg = builder(pg)
    with pg.expect_response(lambda r: r.url.endswith("/api/j2/widget-definitions") and r.request.method == "POST",
                            timeout=T) as resp:
        act(R, pg, dlg.get_by_role("button", name="Save", exact=True))
    check(row, "the widget was saved (HTTP 200/201)", resp.value.status in (200, 201), f"HTTP {resp.value.status}")
    dlg.wait_for(state="hidden", timeout=T)
    if s.get("expect_frame"):
        fr = R.g.walk.embed_in(pg, R.fmt(s["expect_frame"]))
        fr.wait_for(timeout=T)
        check(row, f"the widget {s['expect_frame']!r} is placed in the note", True, fr.inner_text()[:200])


def a_builder_save_expect_refusal(R, s, row):
    pg = R.page()
    dlg = builder(pg)
    act(R, pg, dlg.get_by_role("button", name="Save", exact=True))
    pg.wait_for_timeout(1500)


def a_builder_summary_visible(R, s, row):
    """Wide: the preview pane beside the steps. Phone: the summary bar is drawn and sits inside the viewport
    -- unless `keyboard_open`, when the product hides it on purpose (PreviewPane.jsx: the phone preview is
    `hidden={keyboardOpen}`) and the live region must still be there to announce."""
    pg = R.page()
    dlg = builder(pg)
    bar = dlg.locator("[data-testid=builder-summary-bar]")
    if R.size[0] > 640:
        pane = dlg.locator("[data-testid=builder-preview]")
        check(row, "the preview pane is drawn beside the steps", pane.count() > 0 and pane.first.is_visible(), str(pane.count()))
        return
    live = pg.locator("[data-testid=builder-live]")
    if s.get("keyboard_open"):
        check(row, "with the keyboard open the summary bar steps aside", not (bar.count() and bar.first.is_visible()),
              str(bar.count()))
        check(row, "the live region is still there to announce", live.count() > 0, str(live.count()))
        return
    check(row, "the phone summary bar is drawn", bar.count() > 0 and bar.first.is_visible(), str(bar.count()))
    box = bar.first.bounding_box() if bar.count() else None
    vh = pg.viewport_size["height"]
    check(row, "the summary bar sits inside the visible viewport (sticky)",
          bool(box) and box["y"] >= 0 and box["y"] + box["height"] <= vh + 1, json.dumps(box))


def a_builder_formula(R, s, row):
    pg = R.page()
    dlg = builder(pg)
    act(R, pg, dlg.get_by_role("button", name="Add your own field"))
    f = dlg.locator("[data-testid=formula-field]").first
    f.wait_for(timeout=T)
    fill(R, pg, f.get_by_label("Name", exact=True), s["name"])
    box = f.get_by_label("Formula", exact=True)
    if R.keyboard:
        tab_to(pg, box)
    else:
        box.click()
    pg.keyboard.type(s["formula"], delay=40)
    if s.get("expect_error"):
        err = f.locator("[class*=error]")
        try:
            err.first.wait_for(timeout=T)
            check(row, "an inline sentence says what is wrong", True, err.first.inner_text())
        except Exception:  # noqa: BLE001
            check(row, "an inline sentence says what is wrong", False, f.inner_text()[:300])


def a_builder_formula_append(R, s, row):
    pg = R.page()
    dlg = builder(pg)
    f = dlg.locator("[data-testid=formula-field]").first
    box = f.get_by_label("Formula", exact=True)
    pg.keyboard.press("End")
    pg.keyboard.type(s["text"], delay=40)
    if s.get("expect_valid"):
        try:
            f.get_by_text(re.compile(r"^First trade: ")).wait_for(timeout=T)
            ok = True
        except Exception:  # noqa: BLE001
            ok = False
        check(row, "fixed by keyboard, the formula is valid (the first-row line shows)", ok
              and f.locator("[class*=error]").count() == 0, f.inner_text()[:300])
    if s.get("expect_value"):
        check(row, "the box reads the fixed formula", box.input_value() == s["expect_value"], box.input_value())
    check(row, "focus stayed in the Formula box", box.evaluate(FOCUS_IN_JS), "")


def a_close_dialog(R, s, row):
    """Close the top sheet the member's way: Escape (keyboard; the builder steps back one level per
    Escape) or its Close button (pointer). "Keep your changes?" is answered "Discard them" when the step
    says `discard`, and the loop goes on until no sheet is open (at most 8 rounds)."""
    pg = R.page()
    for _ in range(8):
        dlg = top_dialog(pg)
        if dlg is None:
            return
        if pg.get_by_text("Keep your changes?").count() and pg.get_by_text("Keep your changes?").first.is_visible():
            if not s.get("discard"):
                raise Inconclusive("the builder asks to keep changes and the step does not say discard")
            act(R, pg, pg.get_by_role("button", name="Discard them", exact=True).first)
        elif R.keyboard:
            pg.keyboard.press("Escape")
        else:
            btn = dlg.get_by_role("button", name="Close", exact=True)
            act(R, pg, btn.first) if btn.count() else pg.keyboard.press("Escape")
        pg.wait_for_timeout(500)
    if top_dialog(pg) is not None:
        check(row, "the sheet closes", False, (top_dialog(pg).inner_text() or "")[:300])


def a_focus_returned(R, s, row):
    pg = R.page()
    where = pg.evaluate("() => { const a = document.activeElement; return a ? (a.closest('.ProseMirror') ? 'editor' : "
                        "(a.tagName + ' ' + (a.getAttribute('aria-label') || a.innerText || '').slice(0, 40))) : 'none' }")
    check(row, "focus returned to the note after the builder closed", where == "editor", where)


def a_resize(R, s, row):
    pg = R.page()
    pg.set_viewport_size({"width": R.size[0], "height": s.get("height") or R.size[1]})
    pg.wait_for_timeout(400)


def my_tools_sheet(pg):
    sh = pg.get_by_role("dialog", name="My tools")
    sh.wait_for(timeout=T)
    return sh


def a_my_tools(R, s, row):
    pg = R.page()
    t0 = time.perf_counter()
    act(R, pg, pg.get_by_role("button", name="My tools"))
    sh = my_tools_sheet(pg)
    row["timings"][s.get("timing") or "sheet_open"] = round((time.perf_counter() - t0) * 1000)
    row["surface"] = "dialog"
    if s.get("tab") and s["tab"] != "Widgets":
        a_my_tools_tab(R, s, row)
    else:
        pg.wait_for_timeout(1200)


def a_my_tools_tab(R, s, row):
    pg = R.page()
    sh = my_tools_sheet(pg)
    tab = sh.get_by_role("tab", name=s["tab"])
    if not tab.count():
        tab = sh.get_by_role("button", name=s["tab"], exact=True)
    act(R, pg, tab.first)
    pg.wait_for_timeout(1500)
    row["surface"] = "dialog"


def a_my_tools_filter(R, s, row):
    pg = R.page()
    sh = my_tools_sheet(pg)
    act(R, pg, sh.get_by_role("button", name=s["label"], exact=True).first)
    pg.wait_for_timeout(1500)


def a_insert_routine(R, s, row):
    pg = R.page()
    t0 = time.perf_counter()
    slash(R, pg, "/routine", r"^Routine \(remembered daily\)")
    pk = pg.get_by_role("dialog").filter(has_text="Add a routine").last
    pk.wait_for(timeout=T)
    row["timings"][s.get("timing") or "sheet_open"] = round((time.perf_counter() - t0) * 1000)
    name = R.fmt(s["existing"])
    act(R, pg, pk.get_by_role("button", name=name, exact=True))
    pg.locator("[data-routine-block] [role=checkbox]").first.wait_for(timeout=T)
    row["surface"] = "[data-routine-block]"
    pg.wait_for_timeout(2500)          # the insert's own autosave lands before anything is remembered


def boxes(pg):
    return pg.locator("[data-routine-block] [role=checkbox]")


def a_tick(R, s, row):
    pg = R.page()
    act(R, pg, boxes(pg).nth(s["index"]))
    pg.wait_for_timeout(1500)


def a_new_context(R, s, row):
    R.new_context(s["name"])
    pg = R.new_page(s["name"], s["name"])
    if s.get("open_note"):
        pg.goto(R.url(f"/journal/notebook?note={R.alias[s['open_note']]}"), wait_until="domcontentloaded", timeout=60000)
        R.g.h._dismiss_intro(pg)
        boxes(pg).first.wait_for(timeout=T)


def a_new_page(R, s, row):
    pg = R.new_page(s["name"], s.get("context", "main"))
    if s.get("open_note"):
        pg.goto(R.url(f"/journal/notebook?note={R.alias[s['open_note']]}"), wait_until="domcontentloaded", timeout=60000)
        R.g.h._dismiss_intro(pg)
        boxes(pg).first.wait_for(timeout=T)


def a_concurrent_ticks(R, s, row):
    """Each page ticks its own item with no wait between them, so the writes are in flight together."""
    for name, idx in s["ticks"]:
        pg = R.page(name)
        b = boxes(pg).nth(idx)
        if R.keyboard:
            b.focus()           # setup of the race, not a navigation claim: Tab order is railed elsewhere
            pg.keyboard.press("Space")
        else:
            (b.tap if R.touch else b.click)(no_wait_after=True, timeout=T)
    pg0 = R.page("main")
    pg0.wait_for_timeout(3000)


def a_reload_all(R, s, row):
    for name, (pg, _) in R.pages.items():
        pg.reload(wait_until="domcontentloaded")
        R.g.h._dismiss_intro(pg)
        boxes(pg).first.wait_for(timeout=T)
        pg.wait_for_timeout(1500)
        got = [boxes(pg).nth(i).get_attribute("aria-checked") for i in range(boxes(pg).count())]
        ok = all(got[i] == "true" for i in s["expect_checked"] if i < len(got)) and len(got) > max(s["expect_checked"])
        check(row, f"every tick survived, read on {name}", ok, json.dumps(got))


def note_of(R, nid: str) -> dict:
    r = R.page().request.get(R.g.base + f"/api/j2/notes/{nid}")
    return (r.json() if r.ok else {}).get("note") or {}


def a_remember_note(R, s, row):
    n = note_of(R, R.alias[s["note"]])
    R.remembered[s["note"]] = {"updatedAt": n.get("updatedAt"), "body": json.dumps(n.get("bodyJson"), sort_keys=True)}
    row["read"].append({"what": "note updatedAt", "text": str(n.get("updatedAt"))})


def a_note_unchanged(R, s, row):
    was = R.remembered.get(s["note"])
    if not was:
        raise Inconclusive("the note was never remembered")
    n = note_of(R, R.alias[s["note"]])
    check(row, "the note's saved time did not move (no note write)", n.get("updatedAt") == was["updatedAt"],
          f"{was['updatedAt']} -> {n.get('updatedAt')}")
    check(row, "the note's body is byte-identical (nothing forked)", json.dumps(n.get("bodyJson"), sort_keys=True) == was["body"], "")


def a_offline(R, s, row):
    for c in R.contexts.values():
        c.set_offline(bool(s["on"]))


def a_wait(R, s, row):
    R.page().wait_for_timeout(int(s.get("ms", 1000)))


def get_path(obj, path: str):
    cur = obj
    for part in path.split("."):
        if isinstance(cur, dict) and part in cur:
            cur = cur[part]
        else:
            return None
    return cur


def a_api(R, s, row):
    pg = R.page()
    path = R.resolve(s["path"])
    kw = {"method": s.get("method", "GET")}
    if "body" in s:
        kw["data"] = R.resolve(s["body"])
    r = pg.request.fetch(R.g.base + path, **kw)
    text = r.text()
    row["read"].append({"what": f"{kw['method']} {path}", "text": f"HTTP {r.status} {text[:600]}"})
    row.setdefault("expect_status", []).extend(s.get("expect_status") or [])
    if s.get("expect_status"):
        check(row, f"answers {s['expect_status']}", r.status in s["expect_status"], f"HTTP {r.status}")
    try:
        body = r.json()
    except Exception:  # noqa: BLE001
        body = {}
    if s.get("save_as"):
        R.alias[s["save_as"]] = {"id": (body.get("routine") or body.get("tracker") or body).get("id") if isinstance(body, dict) else None,
                                 "name": R.fmt((s.get("body") or {}).get("name", ""))}
    for c in s.get("checks") or []:
        if "any_text_forbid" in c:
            bad = re.findall(c["any_text_forbid"], text)
            check(row, f"no {c['any_text_forbid']} anywhere in the answer", not bad, ", ".join(bad[:5]))
            continue
        v = get_path(body, R.resolve(c["path"]))
        if "equals" in c:
            check(row, f"{c['path']} == {c['equals']!r}", v == c["equals"], repr(v))
        if "in" in c:
            check(row, f"{c['path']} in {c['in']!r}", v in c["in"], repr(v))
        if "nonempty" in c:
            check(row, f"{c['path']} is a sentence", isinstance(v, str) and bool(v.strip()), repr(v))
        if "sentence" in c:
            want = R.g.sentence(c["sentence"])
            check(row, f"{c['path']} reads {want!r}", v == want, repr(v))


def a_api_burst(R, s, row):
    pg = R.page()
    path = R.resolve(s["path"])
    statuses, msgs = [], []
    for i in range(int(s["count"])):
        r = pg.request.fetch(R.g.base + path, method=s.get("method", "PUT"), data=s["bodies"][i % len(s["bodies"])])
        statuses.append(r.status)
        if r.status == 429:
            with contextlib.suppress(Exception):
                msgs.append(((r.json().get("detail") or {}).get("message")))
    row["expect_status"] = [429]
    row["read"].append({"what": "statuses", "text": json.dumps({k: statuses.count(k) for k in set(statuses)})})
    check(row, "the burst is refused with 429 past the rate", s["expect_any_status"] in statuses, "")
    if s.get("expect_message_sentence"):
        want = R.g.sentence(s["expect_message_sentence"])
        check(row, f"the 429 says {want!r}", bool(msgs) and all(m == want for m in msgs), json.dumps(msgs[:3]))


def a_flag_restart(R, s, row):
    sb = R.g.sandbox
    if sb is None:
        raise Inconclusive("a flag flip restarts the server: run with --own-sandbox")
    over = {} if s.get("rearm") else {**sb.overrides, **s["set"]}
    t0 = time.perf_counter()
    sb.restart(over)
    row["read"].append({"what": "sandbox restarted with", "text": json.dumps(over)})
    row["timings"]["restart"] = round((time.perf_counter() - t0) * 1000)
    me = R.page().request.get(R.g.base + "/api/auth/me").json()
    for k, v in over.items():
        key = k.lower()
        if key.startswith("notebook_widgets_w"):
            check(row, f"/api/auth/me says {key} = {v == '1'}", me.get(key) is (v == "1"), str(me.get(key)))
    if s.get("rearm"):
        check(row, "/api/auth/me says every wave is on again",
              all(me.get(k.lower()) is True for k in (W8, W9, W10, W11)), json.dumps({k.lower(): me.get(k.lower()) for k in (W8, W9, W10, W11)}))


def a_widget_share_on(R, s, row):
    pg = R.page()
    fr = R.g.walk.embed_in(pg, R.fmt(s["frame"]))
    fr.wait_for(timeout=T)
    sw = fr.get_by_role("switch")
    sw.scroll_into_view_if_needed()
    if sw.get_attribute("aria-checked") != "true":
        act(R, pg, sw)
    pg.wait_for_timeout(1500)
    check(row, "the widget's Show on shared pages switch is on", sw.get_attribute("aria-checked") == "true", "")


def a_share_public(R, s, row):
    pg = R.page()
    act(R, pg, pg.get_by_role("button", name="Share", exact=True))
    sh = pg.get_by_role("dialog", name="Share this note")
    sh.wait_for(timeout=T)
    addr = sh.get_by_label("Share link address")
    if not (addr.count() and addr.first.is_visible()):
        act(R, pg, sh.get_by_role("button", name="Create link", exact=True))
    url = addr.input_value(timeout=T)
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    pub = R.g.walk.open_public(R.g.browser, R.vp if R.vp in R.g.walk.VIEWPORTS else "1200", url)
    try:
        dom = pub["dom"]
        text = dom.get("text") or ""
        row["read"].append({"what": "public page text", "text": text[:1500]})
        for key in s.get("expect_public") or []:
            want = R.g.sentence(key)
            check(row, f"the public page says {want!r}", want in text, text[:300])
        leaks = R.g.walk.leaks_in(pub, [R.fmt(w) for w in s.get("forbid_public") or []])
        check(row, "no account name reaches the public page (text, attributes, payload)", not leaks, json.dumps(leaks))
        shot = R.dir / "shots" / f"{row['step']}-public.png"
        shot.parent.mkdir(parents=True, exist_ok=True)
        pub["page"].screenshot(path=str(shot), full_page=True)
        row["screenshots"].append(str(shot.relative_to(R.g.out)).replace("\\", "/"))
        for e in pub["watch"].take():
            if e.get("http") == 401 and "/api/auth/me" in (e.get("url") or ""):
                continue        # a stranger's page asks who is signed in; 401 is the answer, not a failure
            if (e.get("console") or "").startswith("Failed to load resource"):
                continue        # the same request, already read above as an HTTP event
            kind = ("http5xx" if e["http"] >= 500 else "http4xx") if "http" in e else "console" if "console" in e else "pageerror"
            row.setdefault("findings_raw", []).append({"kind": kind, "page": "public",
                                                       "detail": e.get("console") or e.get("pageerror") or
                                                       f"{e.get('method')} {e.get('url')} -> {e.get('http')}"})
    finally:
        pub["ctx"].close()


def a_admin_login(R, s, row):
    pg = R.page()
    r = pg.request.post(R.g.base + "/api/auth/login", data={"email": R.member.get("email"), "password": R.member.get("password")})
    check(row, "the admin signs in (ADMIN_EMAILS promotes at login)", r.status == 200, f"HTTP {r.status}")


def a_throttle(R, s, row):
    pg = R.page()
    cdp = R.contexts["main"].new_cdp_session(pg)
    kbps = s.get("kbps", 400)
    cdp.send("Network.emulateNetworkConditions", {"offline": False, "latency": s.get("latency_ms", 300),
                                                  "downloadThroughput": kbps * 128, "uploadThroughput": kbps * 128})


def a_check_text(R, s, row):
    pass       # the expectations below do the reading


def a_noop(R, s, row):
    raise Inconclusive("not scripted yet: the persona's script needs a server or a seam this run does not have")


# ── wave 11 steps (Task 11.21 Step 4): the real route shapes, driven over loopback HTTP ─────────
#
# Each action builds its requests with w11_steps' builders, sends them through w11_steps' ONE loopback door as the
# persona's own session, and grades them with w11_steps' judges. A judge that says INCONCLUSIVE raises Inconclusive
# (never a pass); EXPECTED-PENDING raises Pending. Every request and answer is in the step's `read`.

def cookie_of(R: Run) -> str | None:
    """The persona's session. Under a clock group ONLY the one the launcher vouched for at this instant (review I7,
    the N7 rule the probe already keeps): a seeded cookie the shifted server reads as expired would be DELETED by
    its own `validate_session` on that very request, so with no vouched session the step refuses (INCONCLUSIVE)
    and sends nothing. On a real-clock server, the seeded session."""
    vouched = (R.g.session_override or {}).get(R.p["id"])
    if getattr(R.g, "clock_server", None) is not None:
        if not vouched:
            raise Inconclusive("no session the clock launcher vouched for at this instant (clock-sessions.json); a "
                               "seeded cookie could be read as expired and its row deleted, so nothing was sent")
        return vouched
    return vouched or R.member.get("session")


def w11_send(R: Run, row: dict, spec: dict, what: str | None = None):
    resp = w11.http_call(R.g.base, spec, cookie_of(R))
    row["read"].append({"what": what or f"{spec['method']} {spec['path']}",
                        "text": f"HTTP {resp.status} {resp['text'][:600]}"})
    return resp


def w11_race(R: Run, row: dict, specs: list[dict], what: str):
    resps = w11.race(R.g.base, specs, cookie_of(R))
    row["read"].append({"what": what, "text": json.dumps([[r.status, r["text"][:160]] for r in resps])})
    return resps


def w11_apply(row: dict, judged: dict) -> dict:
    """A judge's checks into the row; INCONCLUSIVE / EXPECTED-PENDING end the step with their reason."""
    row["checks"].extend(judged["checks"])
    if judged["verdict"] == w11.INCONCLUSIVE:
        raise Inconclusive(judged["why"])
    if judged["verdict"] == w11.PENDING:
        raise Pending(judged["why"])
    return judged


def w11_template(R: Run, row: dict, title: str) -> str:
    """The official template titled `title`, read from the library (cached per run)."""
    k = f"tpl:{title}"
    if k in R.alias:
        return R.alias[k]["id"]
    resp = w11_send(R, row, w11.b_library(), f"GET library (for {title!r})")
    if resp.status != 200:
        check(row, "the library answers 200", False, f"HTTP {resp.status}")
        raise Inconclusive(f"the library did not answer, so {title!r} has no id")
    card = w11.library_template(resp.body, title)
    if card is None or not isinstance(card.get("id"), str):
        raise Inconclusive(f"the seeded library has no official template titled {title!r}")
    R.alias[k] = {"id": card["id"], "name": title}
    return card["id"]


def w11_style(R: Run, row: dict, name: str, view: str = "live") -> dict | None:
    resp = w11_send(R, row, w11.b_templates(view), f"GET templates view={view}")
    return w11.find_by(w11.get_path(resp.body, "styles"), "name", name) if resp.status == 200 else None


def a_w11_browse(R, s, row):
    resp = w11_send(R, row, w11.b_library(s.get("group", "")))
    w11_apply(row, w11.judge_status(resp, [200], "the template library"))
    cards, groups = w11.get_path(resp.body, "templates"), w11.get_path(resp.body, "groups")
    check(row, "the library lists official templates", isinstance(cards, list) and bool(cards), str(type(cards)))
    keys = [g.get("key") for g in groups] if isinstance(groups, list) else []
    check(row, "the library names its groups", bool(keys), json.dumps(keys))
    cards = cards if isinstance(cards, list) else []
    check(row, "every card is UCT's (firm)", all(c.get("firm") is True for c in cards), "")
    check(row, "every card sits in a named group", all(c.get("group") in keys for c in cards),
          json.dumps(sorted({str(c.get('group')) for c in cards})))
    check(row, "every card says what it contains (a list)", all(isinstance(c.get("contains"), list) for c in cards), "")
    if s.get("template"):
        card = w11.library_template(resp.body, s["template"])
        if not check(row, f"the library lists {s['template']!r}", card is not None, ""):
            return
        R.alias[f"tpl:{s['template']}"] = {"id": card["id"], "name": s["template"]}


def a_w11_preview(R, s, row):
    title = s["template"]
    gid = w11_template(R, row, title)
    t0 = time.perf_counter()
    resp = w11_send(R, row, w11.b_preview_mine(gid, s.get("answers")), f"POST preview-mine {title!r}")
    row["timings"][s.get("timing") or "preview"] = round((time.perf_counter() - t0) * 1000)
    w11_apply(row, w11.judge_status(resp, [200], "preview with my data"))
    body = resp.body if isinstance(resp.body, dict) else {}
    for k in ("slots", "cards", "tools", "questions"):
        check(row, f"the preview carries `{k}` (a list)", isinstance(body.get(k), list), repr(type(body.get(k))))
    R.remembered[f"preview:{title}"] = body
    cards = body.get("cards") or []
    ran = [c for c in cards if isinstance(c, dict) and "payload" in c]
    if s.get("expect_sample"):
        check(row, "the widgets ran on the Sample data book (under 5 closed trades)",
              bool(ran) and all(c.get("sample") is True for c in ran), json.dumps([c.get("sample") for c in ran]))
    if s.get("expect_own_data"):
        check(row, "the widgets ran on the member's own trades", bool(ran) and not any(c.get("sample") for c in ran),
              json.dumps([c.get("sample") for c in ran]))
    if s.get("expect_card_sentence"):
        want = R.g.sentence(s["expect_card_sentence"])
        check(row, f"a card says {want!r}", any(isinstance(c, dict) and c.get("sentence") == want for c in cards),
              json.dumps([c.get("sentence") for c in cards if isinstance(c, dict)])[:400])
    if s.get("expect_question_use"):
        qs = [q for q in body.get("questions") or [] if isinstance(q, dict)]
        name = s["expect_question_use"]
        check(row, f"a reuse question suggests the member's own {name!r}",
              any(w11.get_path(q, "use.name") == name for q in qs), json.dumps(qs)[:400])
    for want in s.get("expect_tools") or []:
        tool = w11.find_by(body.get("tools"), "slot", want["slot"])
        check(row, f"slot {want['slot']} binds {want['bind']!r} and reads {want['forDayLabel']!r}",
              bool(tool) and tool.get("bind") == want["bind"] and tool.get("forDayLabel") == want["forDayLabel"],
              json.dumps(tool))
    for bad in R.fmt(s.get("forbid_text") or []):
        check(row, f"{bad!r} is nowhere in the preview", bad not in resp["text"], "")


def a_w11_share_preview(R, s, row):
    kind, name = s["kind"], R.fmt(s["name"])
    if kind == "template":
        st = w11_style(R, row, name)
        if st is None:
            raise Inconclusive(f"the member has no live template named {name!r}")
        tid = st["id"]
    else:
        tid = R.resolve(f"@{kind}:{name}")
    resp = w11_send(R, row, w11.b_share_preview(kind, tid), f"POST share/preview {kind} {name!r}")
    w11_apply(row, w11.judge_status(resp, [200], "the share preview"))
    body = resp.body if isinstance(resp.body, dict) else {}
    check(row, "the answer says what travels and what does not", "travels" in body and "notShared" in body,
          json.dumps(sorted(body))[:300])
    if body.get("travels") is None:
        raise Inconclusive("the first ask answered the author's prefill only (`travels: null`): this reducer needs "
                           "the author's typed words as `edits`, which this step does not type")
    travels = json.dumps(body["travels"], ensure_ascii=False)
    for bad in R.fmt(s.get("forbid_text") or []):
        check(row, f"{bad!r} does not travel", bad not in travels, "")
    R.remembered["share"] = {"kind": kind, "id": tid, "name": name}


def a_w11_publish(R, s, row):
    sh = R.remembered.get("share")
    if not sh:
        raise Inconclusive("nothing was share-previewed earlier in this run")
    title = R.fmt(s["title"])
    if sh["kind"] == "template":
        spec = w11.b_publish_style(sh["id"], title=title, category=s.get("category", "journal"))
    else:
        spec = w11.b_publish_tool(sh["kind"], sh["id"], title=title)
    resp = w11_send(R, row, spec, f"publish {sh['kind']} {sh['name']!r}")
    w11_apply(row, w11.judge_status(resp, [200], "publishing"))
    item = w11.get_path(resp.body, "template")
    check(row, "the answer is the listing (a template with an id)", isinstance(w11.get_path(item, "id"), str), "")
    for bad in R.fmt(s.get("forbid_text") or []):
        check(row, f"{bad!r} is not on the listing", bad not in resp["text"], "")
    R.alias[s.get("save_as", "listing")] = {"id": w11.get_path(item, "id"), "name": title}


def a_w11_adopt(R, s, row):
    """Adopt (the copy only, W11-R25b) with an Idempotency-Key, then the same key again: one copy, replayed."""
    gid = w11_template(R, row, s["template"])
    k = w11.new_key()
    first = w11_send(R, row, w11.b_adopt_style(gid, key=k), "adopt (key K)")
    second = w11_send(R, row, w11.b_adopt_style(gid, key=k), "adopt again (key K, a deliberate replay)")
    w11_apply(row, w11.judge_replay(first, second, "style.id"))
    if s.get("new_key_makes_another"):
        third = w11_send(R, row, w11.b_adopt_style(gid, key=w11.new_key()), "adopt (a new key)")
        a, c = w11.get_path(first.body, "style.id"), w11.get_path(third.body, "style.id")
        check(row, "a NEW key makes another copy (the member's choice)", third.status == 200 and bool(c) and c != a,
              f"HTTP {third.status} {a!r} / {c!r}")
    style = w11.get_path(first.body, "style") or {}
    R.alias[s.get("save_as", "adopted")] = {"id": style.get("id"), "name": style.get("name")}


def choices_from_preview(preview: dict | None, title: str, *, strict: bool) -> dict | None:
    """The member's own suggested tool for each reuse question (`questions[].use`, AdoptSheet's pre-selection), as
    a Use's `choices` (`{slot: {"use": id}}`). `strict` (pick: "suggested", the persona IS the suggestion): no preview
    or no suggestion is INCONCLUSIVE. Otherwise (pick: "auto") the Use goes without choices."""
    if preview is None:
        if strict:
            raise Inconclusive(f"no preview of {title!r} was read earlier in this run")
        return None
    picks = {q["slot"]: {"use": w11.get_path(q, "use.id")} for q in preview.get("questions") or []
             if isinstance(q, dict) and isinstance(q.get("slot"), str) and isinstance(w11.get_path(q, "use.id"), str)}
    if not picks and strict:
        raise Inconclusive(f"the preview of {title!r} suggested no tool of the member's own to pick")
    return picks or None


def use_answers(preview: dict | None, title: str, *, required: bool) -> dict | None:
    """A Use's `answers` from the preview's `slots[]` (`w11.answers_from_preview`: each slot's `value`, never
    `sampleValue`), as the member's client sends them. Review C2: a template that declares a choice is refused
    `unresolved` without it, so a declared slot with no value of the member's own, or (`required`) no preview read
    at all, is INCONCLUSIVE and nothing is sent."""
    if preview is None:
        if required:
            raise Inconclusive(f"no preview of {title!r} was read earlier in this run, so its choices are unknown")
        return None
    answers, missing = w11.answers_from_preview(preview)
    if missing:
        raise Inconclusive(f"the preview of {title!r} has no value of the member's own for {missing}")
    return answers or None


def _embeds_of(R, row, note: dict) -> list[dict]:
    doc = w11.note_body(note)
    if doc is None and isinstance(note.get("id"), str):
        resp = w11_send(R, row, w11.b_note(note["id"]), "GET the note")
        doc = w11.note_body(w11.get_path(resp.body, "note"))
    return w11.tool_embeds(doc)


def a_w11_use(R, s, row):
    """Use (make a note) with an Idempotency-Key, then the same key again: the FIRST note, `replayed: true`."""
    title = s["template"]
    gid = w11_template(R, row, title)
    preview = R.remembered.get(f"preview:{title}")
    choices = (choices_from_preview(preview, title, strict=s["pick"] == "suggested")
               if s.get("pick") in ("suggested", "auto") else None)
    answers = use_answers(preview, title, required=s.get("answers") == "preview")
    k = w11.new_key()
    t0 = time.perf_counter()
    first = w11_send(R, row, w11.b_use_template(gid, key=k, answers=answers, choices=choices), "use-template (key K)")
    row["timings"][s.get("timing") or "use"] = round((time.perf_counter() - t0) * 1000)
    second = w11_send(R, row, w11.b_use_template(gid, key=k, answers=answers, choices=choices),
                      "use-template again (key K, a replay)")
    w11_apply(row, w11.judge_replay(first, second, "note.id"))
    made = w11.get_path(second.body, "created")
    check(row, "the replay made nothing (`created` present, every list empty)",
          isinstance(made, dict) and all(isinstance(made.get(f), list) and not made[f]
                                         for f in ("widgets", "routines", "trackers")), json.dumps(made))
    body = first.body if isinstance(first.body, dict) else {}
    if s.get("expect_credit"):
        check(row, f"the credit reads {s['expect_credit']!r}", s["expect_credit"] in str(body.get("credit")),
              repr(body.get("credit")))
    if "expect_new_routines" in s:
        got = w11.get_path(body, "created.routines")
        check(row, f"the Use made {s['expect_new_routines']} new routine(s)",
              isinstance(got, list) and len(got) == s["expect_new_routines"], json.dumps(got))
    if s.get("expect_reused"):
        rid = R.resolve(f"@routine:{s['expect_reused']}")
        got = w11.get_path(body, "reused.routines") or []
        check(row, f"the Use reused the member's own {s['expect_reused']!r}", any(x.get("id") == rid for x in got),
              json.dumps(got))
    if s.get("expect_embed") or s.get("expect_embed_routine"):
        embeds = _embeds_of(R, row, body.get("note") or {})
        if s.get("expect_embed"):
            want = s["expect_embed"]
            check(row, f"a {want['family']} block binds to {want['day']} and is labelled {want['label']!r}",
                  any(e["family"] == want["family"] and e["day"] == want["day"]
                      and want["label"] in (e["searchText"] or "") for e in embeds), json.dumps(embeds))
        if s.get("expect_embed_routine"):
            rid = R.resolve(f"@routine:{s['expect_embed_routine']}")
            check(row, f"the note's routine block is the member's own {s['expect_embed_routine']!r}",
                  any(e["family"] == "routine" and e["id"] == rid for e in embeds), json.dumps(embeds))
    note = body.get("note") or {}
    R.alias[s.get("note_as", "used")] = note.get("id")
    style = body.get("style") or {}
    R.alias[s.get("copy_as", "copy")] = {"id": style.get("id"), "name": style.get("name")}
    tools = (w11.get_path(body, "created.routines") or []) + (w11.get_path(body, "reused.routines") or [])
    if tools:
        R.alias["use_routine"] = {"id": tools[0].get("id"), "name": tools[0].get("name")}


def a_w11_unkeyed(R, s, row):
    """No Idempotency-Key where none is required (W11-R34: the key is optional on every wave 11 door): never 428."""
    gid = w11_template(R, row, s["template"])
    first = w11_send(R, row, w11.b_use_template(gid, key=None), "use-template (no key)")
    second = w11_send(R, row, w11.b_use_template(gid, key=None), "use-template again (no key)")
    w11_apply(row, w11.judge_unkeyed(first, second, "note.id"))


def a_w11_in_flight(R, s, row):
    """K presses with one key at once: one note, the rest replayed or 409 `conflict` S_KEY_IN_FLIGHT."""
    gid = w11_template(R, row, s["template"])
    k = w11.new_key()
    n = int(s.get("presses", 4))
    resps = w11_race(R, row, [w11.b_use_template(gid, key=k) for _ in range(n)], f"{n} x use-template, one key, at once")
    moved = R.g.sentence("listing_moved")
    for r in resps:
        if r.status == 409 and w11.detail_of(r.body)[1] == moved:
            row["read"].append({"what": "a listing moved during the race", "text": r["text"][:300]})
    w11_apply(row, w11.judge_in_flight(resps, "note.id", R.g.sentence("key_in_flight"), listing_moved=moved))


def a_w11_key_reused(R, s, row):
    """One key on two doors (Use, then Adopt of the same template): 409 `key_reused` (A9; interim `conflict`)."""
    gid = w11_template(R, row, s["template"])
    k = w11.new_key()
    first = w11_send(R, row, w11.b_use_template(gid, key=k), "use-template (key K)")
    check(row, "the first press answers 200", first.status == 200, f"HTTP {first.status}")
    if s.get("other_template"):
        other = w11_template(R, row, s["other_template"])
        second = w11_send(R, row, w11.b_use_template(other, key=k), "use-template on ANOTHER template (key K)")
    else:
        second = w11_send(R, row, w11.b_adopt_style(gid, key=k), "adopt the same template (key K, another door)")
    w11_apply(row, w11.judge_key_reused(second, R.g.sentence("key_reused")))


def a_w11_listing_moved(R, s, row):
    raise Inconclusive(
        "not forceable from a client: `listing_moved` (409, W11-R59/R60) needs the listed payload to change between "
        "the clean outside the lock and the compare inside it, TWICE in one request -- an admin approving a revision "
        "inside that window. The race steps grade it (judge_listing_moved) whenever it does happen.")


def a_w11_restore(R, s, row):
    """The Templates tab's own doors: archive, Restore from Archived, Delete permanently, Restore from Recently
    deleted (it lands back in Archived, W11-R36 / F-FE-1 F4), then back to live."""
    copy = R.alias.get(s.get("copy", "copy"))
    if not isinstance(copy, dict) or not copy.get("id") or not copy.get("name"):
        raise Inconclusive("no template copy (id and name) was made earlier in this run")
    sid, name = copy["id"], copy["name"]

    def listed(view):
        resp = w11_send(R, row, w11.b_templates(view), f"GET templates view={view}")
        return resp.status == 200 and w11.find_by(w11.get_path(resp.body, "styles"), "id", sid) is not None

    def act_(action, **kw):
        resp = w11_send(R, row, w11.b_style_action(sid, action, **kw), f"POST {action}")
        check(row, f"{action} answers 200", resp.status == 200, f"HTTP {resp.status} {resp['text'][:200]}")
        return resp
    check(row, "the copy is in the live list", listed("live"), "")
    r = act_("archive")
    check(row, "archived: archivedAt is set", bool(w11.get_path(r.body, "style.archivedAt")), r["text"][:200])
    check(row, "the copy is in Archived", listed("archived"), "")
    act_("unarchive")
    check(row, "Restore from Archived puts it back in the live list", listed("live"), "")
    act_("archive")
    act_("delete", typed_name=name)
    check(row, "Delete permanently lists it in Recently deleted", listed("deleted"), "")
    r = act_("restore")
    check(row, "restored from Recently deleted, it lands in Archived (archivedAt kept)",
          bool(w11.get_path(r.body, "style.archivedAt")), r["text"][:200])
    check(row, "it is in Archived again", listed("archived"), "")
    check(row, "it is no longer in Recently deleted", not listed("deleted"), "")
    act_("unarchive")
    check(row, "and back in the live list", listed("live"), "")


def a_w11_routine(R, s, row):
    """The routine a Use made or reused: read it, tick its first item today."""
    rid = R.resolve(s.get("routine", "@use_routine"))
    resp = w11_send(R, row, w11.b_routine_get(rid), "GET the routine")
    w11_apply(row, w11.judge_status(resp, [200], "the routine"))
    items = w11.get_path(resp.body, "items") or w11.get_path(resp.body, "routine.items") or []
    if not check(row, "the routine has items today", isinstance(items, list) and bool(items), json.dumps(items)[:200]):
        return
    item, day = items[0]["id"], today_et().isoformat()

    def day_entry(what):
        r = w11_send(R, row, w11.b_routine_days([rid], [day]), what)
        if r.status != 200:
            check(row, f"{what}: the day read answers 200", False, f"HTTP {r.status} {r['text'][:200]}")
            raise Inconclusive(f"the day read answered HTTP {r.status}")
        return w11.get_path(r.body, f"routines.{rid}.days.{day}") or {}
    before = day_entry("read the day before the tick")
    row["read"].append({"what": "state before", "text": json.dumps({"state": before.get("state"),
                                                                     "ticked": before.get("ticked")})})
    check(row, "before: the item is not ticked today", (before.get("ticked") or {}).get(item) is False,
          json.dumps(before.get("ticked")))
    tick = w11_send(R, row, w11.b_routine_tick(rid, day, item, True), "tick item 1 today")
    check(row, "the tick answers 200", tick.status == 200, f"HTTP {tick.status} {tick['text'][:200]}")
    check(row, "the answer says the item is ticked (ticked map: true)",
          w11.get_path(tick.body, f"ticked.{item}") is True, json.dumps(w11.get_path(tick.body, "ticked")))
    after = day_entry("read the day after the tick")
    row["read"].append({"what": "state after", "text": json.dumps({"state": after.get("state"),
                                                                    "ticked": after.get("ticked")})})
    check(row, "after: a fresh read has it ticked", (after.get("ticked") or {}).get(item) is True,
          json.dumps(after.get("ticked")))
    check(row, "the day's state was read before and after", isinstance(before.get("state"), str)
          and isinstance(after.get("state"), str), f"{before.get('state')!r} -> {after.get('state')!r}")


def a_w11_if_match_missing(R, s, row):
    """PUT a routine with no If-Match, where it IS required (R-27): 428 `conflict` with its sentence."""
    rid = R.resolve(s.get("routine", "@use_routine"))
    got = w11_send(R, row, w11.b_routine_get(rid), "GET the routine")
    name = w11.get_path(got.body, "name") or w11.get_path(got.body, "routine.name") or "Campaign routine"
    resp = w11_send(R, row, w11.b_routine_put(rid, {"name": name}), "PUT the routine with no If-Match")
    w11_apply(row, w11.judge_refusal(resp, 428, "conflict", R.g.sentence("need_if_match")))


def a_w11_too_large(R, s, row):
    """A body one byte over the wave 11 cap (W11_MAX_BODY_BYTES), counted while it arrives: 413."""
    resp = w11_send(R, row, w11.b_oversized(f"{w11.GALLERY}/share/preview"), "POST share/preview, 16 KiB + 1")
    # Review C1: the wave 11 reader (`widget_request_body.read_json_object`) re-raises the cap as 413 `invalid`
    # "That is too much to send at once." -- not the old router reader's "Request too large".
    w11_apply(row, w11.judge_refusal(resp, 413, "invalid", R.g.sentence("body_too_large")))


def a_w11_title_too_long(R, s, row):
    """A Use whose title is one character over notes.MAX_TITLE_CHARS: 400 `invalid`, before any charge (I-1)."""
    gid = w11_template(R, row, s["template"])
    resp = w11_send(R, row, w11.b_use_template(gid, key=None, title="t" * (w11.MAX_TITLE_CHARS + 1)),
                    f"use-template with a {w11.MAX_TITLE_CHARS + 1}-character title")
    w11_apply(row, w11.judge_refusal(resp, 400, "invalid", R.g.sentence("title_too_long")))


def a_w11_busy(R, s, row):
    """Previews of several templates from one member at once: the engine's gates answer 503 `busy`, nothing queues."""
    gids = [w11_template(R, row, t) for t in s["templates"]]
    resps = w11_race(R, row, [w11.b_preview_mine(g) for g in gids], f"{len(gids)} previews at once")
    w11_apply(row, w11.judge_busy(resps, R.g.sentence("busy_srv")))


def a_w11_engine_too_long(R, s, row):
    gid = w11_template(R, row, s["template"])
    resp = w11_send(R, row, w11.b_preview_mine(gid), f"POST preview-mine {s['template']!r}")
    w11_apply(row, w11.judge_too_long_engine(resp, R.g.sentence("too_long_srv")))


def a_w11_helpful(R, s, row):
    gid = w11_template(R, row, s["template"])
    if s["outcome"] == "unmarked":
        resp = w11_send(R, row, w11.b_helpful(gid, on=False), "DELETE helpful")
        w11_apply(row, w11.judge_status(resp, [200], "un-marking Helpful"))
        return
    resp = w11_send(R, row, w11.b_helpful(gid), "POST helpful")
    if s["outcome"] == "refused":
        w11_apply(row, w11.judge_refusal(resp, 409, "helpful_days", R.g.sentence("helpful_days")))
    else:
        w11_apply(row, w11.judge_status(resp, [200], "marking Helpful on the 3rd use day"))
        check(row, "the answer says it is marked (helpful: true)", w11.get_path(resp.body, "helpful") is True,
              resp["text"][:200])


def a_w11_helpful_prompt(R, s, row):
    note = R.alias.get(s.get("note", "used"))
    if not isinstance(note, str):
        raise Inconclusive("no note was made from the template earlier in this run")
    gid = w11_template(R, row, s["template"])
    resp = w11_send(R, row, w11.b_helpful_prompt(note), "GET the 3rd-day line")
    w11_apply(row, w11.judge_status(resp, [200], "the 3rd-day line"))
    show = w11.get_path(resp.body, "show")
    check(row, f"the line {'shows' if s['show'] else 'does not show'}", show is bool(s["show"]), repr(show))
    if s["show"]:
        check(row, "the line names the template", w11.get_path(resp.body, "itemId") == gid
              and w11.get_path(resp.body, "line") == f"Was {s['template']} helpful?", resp["text"][:200])


def a_w11_helpful_answer(R, s, row):
    gid = w11_template(R, row, s["template"])
    resp = w11_send(R, row, w11.b_helpful_answer(gid, s["answer"]), f"POST the answer {s['answer']!r}")
    w11_apply(row, w11.judge_status(resp, [200], "answering the 3rd-day line"))
    check(row, f"the stored answer is {s['answer']!r}", w11.get_path(resp.body, "answer") == s["answer"],
          resp["text"][:200])
    if s["answer"] == "yes":
        check(row, "yes also marks Helpful", w11.get_path(resp.body, "helpful") is True, resp["text"][:200])


def _et_now():
    from zoneinfo import ZoneInfo
    return shifted_now().astimezone(ZoneInfo("America/New_York"))


def a_w11_bell(R, s, row):
    """The bell's routine reminders for one routine (wave 9, Task 9.9), read until the shifted ET time `until_et`.
    The reminder job is APScheduler's */5 ET cron, which fires on the REAL clock (unshiftable): a reminder that never
    shows is INCONCLUSIVE (the job may not be registered in this sandbox), and "none late" is only gradeable after a
    reminder WAS seen at an earlier instant (otherwise it would pass on a job that never runs)."""
    rid = R.resolve(f"@routine:{s['routine']}")
    day = R.resolve(s.get("day", "@today"))
    want = int(s["count"])
    fact = (R.p["id"], f"bell_seen:{rid}")
    if s.get("needs_seen") and not R.g.facts.get(fact):
        raise Inconclusive("no reminder was seen at an earlier instant, so a count read now could not tell 'none "
                           "late' from 'the job never runs here'")
    deadline = None
    if s.get("until_et"):
        hh, mm = (int(x) for x in s["until_et"].split(":"))
        now = _et_now()
        target = now.replace(hour=hh, minute=mm, second=0, microsecond=0)
        deadline = time.time() + max(0.0, (target - now).total_seconds())
    while True:
        resp = w11_send(R, row, w11.b_alerts(), "GET the bell")
        if resp.status != 200:
            # Review I3: a bell that did not answer is not an empty bell ("exactly 0" must never pass on a 401/500).
            raise Inconclusive(f"the bell answered HTTP {resp.status}, so its reminders were not read")
        got = w11.reminders_for(resp.body, rid, day)
        if deadline is None or time.time() >= deadline or (want and len(got) > want):
            break
        time.sleep(min(15.0, max(0.5, deadline - time.time())))
    row["read"].append({"what": "routine reminders in the bell", "text": json.dumps(got)[:600]})
    if want and not got:
        raise Inconclusive(f"no routine reminder reached the bell by {s.get('until_et')} ET (shifted): the */5 ET "
                           "reminder job fires on the REAL clock and may not be registered in this sandbox")
    check(row, f"the bell holds exactly {want} reminder(s) for {s['routine']!r} on {day}", len(got) == want,
          json.dumps([a.get("timestamp") for a in got]))
    if got:
        R.g.facts[fact] = True


ACTIONS = {
    "seed_note": a_seed_note, "open": a_open, "open_note": a_open_note, "slash": a_slash,
    "open_builder": a_open_builder, "builder_example": a_builder_example, "builder_blank": a_builder_blank,
    "builder_split": a_builder_split, "builder_name": a_builder_name, "builder_save": a_builder_save,
    "builder_save_expect_refusal": a_builder_save_expect_refusal, "builder_summary_visible": a_builder_summary_visible,
    "builder_formula": a_builder_formula, "builder_formula_append": a_builder_formula_append,
    "close_dialog": a_close_dialog, "focus_returned": a_focus_returned, "resize": a_resize,
    "my_tools": a_my_tools, "my_tools_tab": a_my_tools_tab, "my_tools_filter": a_my_tools_filter,
    "insert_routine": a_insert_routine, "tick": a_tick, "new_context": a_new_context, "new_page": a_new_page,
    "concurrent_ticks": a_concurrent_ticks, "reload_all": a_reload_all, "remember_note": a_remember_note,
    "note_unchanged": a_note_unchanged, "offline": a_offline, "wait": a_wait, "api": a_api, "api_burst": a_api_burst,
    "flag_restart": a_flag_restart, "widget_share_on": a_widget_share_on,
    "share_public": a_share_public, "admin_login": a_admin_login, "throttle": a_throttle, "check_text": a_check_text,
    "noop": a_noop,
    # wave 11 (real route shapes, w11_steps)
    "w11_browse": a_w11_browse, "w11_preview": a_w11_preview, "w11_share_preview": a_w11_share_preview,
    "w11_publish": a_w11_publish, "w11_adopt": a_w11_adopt, "w11_use": a_w11_use, "w11_unkeyed": a_w11_unkeyed,
    "w11_in_flight": a_w11_in_flight, "w11_key_reused": a_w11_key_reused, "w11_listing_moved": a_w11_listing_moved,
    "w11_restore": a_w11_restore, "w11_routine": a_w11_routine, "w11_if_match_missing": a_w11_if_match_missing,
    "w11_too_large": a_w11_too_large, "w11_title_too_long": a_w11_title_too_long, "w11_busy": a_w11_busy,
    "w11_engine_too_long": a_w11_engine_too_long, "w11_helpful": a_w11_helpful,
    "w11_helpful_prompt": a_w11_helpful_prompt, "w11_helpful_answer": a_w11_helpful_answer, "w11_bell": a_w11_bell,
}
#: Every wave 11 step talks to the server over HTTP only: a step that does not drive the browser page.
W11_ACTIONS = frozenset(k for k in ACTIONS if k.startswith("w11_"))


# ── checks, expectations, metrics ─────────────────────────────────────────────────────────

def check(row: dict, what: str, ok: bool, read: str) -> bool:
    row["checks"].append({"what": what, "ok": bool(ok), "read": (read or "")[:600]})
    return bool(ok)


def sent_check(R, row, key, s, said, pred):
    if key in s:
        want = R.g.sentence(s[key])
        check(row, f"{key.replace('_', ' ')} {want!r}", pred(want, said), said)


def expectations(R: Run, s: dict, row: dict) -> None:
    keys = list(s.get("expect") or []) + list(s.get("expect_absent") or [])
    if not keys and not s.get("expect_re") and not s.get("forbid_re") and not s.get("forbid"):
        return
    pg = R.page()
    sur = surface(pg, s.get("within") or row.get("surface"))
    for key in s.get("expect") or []:
        want = R.g.sentence(key)
        try:
            sur.get_by_text(want, exact=False).first.wait_for(timeout=12000)
            ok = True
        except Exception:  # noqa: BLE001
            ok = False
        check(row, f"says {want!r}", ok, "" if ok else (sur.inner_text(timeout=3000) or "")[:400])
    text = sur.inner_text(timeout=5000) or ""
    row["read"].append({"what": f"surface text ({s.get('within') or row.get('surface') or 'page'})", "text": text[:1500]})
    for key in s.get("expect_absent") or []:
        want = R.g.sentence(key)
        check(row, f"does not say {want!r}", want not in text, "")
    for rx in s.get("expect_re") or []:
        check(row, f"matches {rx}", re.search(rx, text) is not None, text[:300])
    for rx in s.get("forbid_re") or []:
        check(row, f"never matches {rx}", re.search(rx, text) is None, ", ".join(re.findall(rx, text)[:4]))
    if "zeros" in (s.get("forbid") or []):
        z = zeros_in(text)
        check(row, "no zero, NaN, undefined or [object Object] is shown", not z, ", ".join(z))
    if "raw" in (s.get("forbid") or []):
        raw = pg.evaluate("() => ({imgx: document.querySelectorAll('img[src=\"x\"]').length,"
                          " scripts: [...document.scripts].filter(s => (s.textContent || '').includes(\"alert('x')\")).length})")
        check(row, "no member text rendered as markup", raw["imgx"] == 0 and raw["scripts"] == 0, json.dumps(raw))


def metrics(R: Run, row: dict) -> dict:
    pg = R.page()
    out: dict = {}
    walk = R.g.walk
    try:
        out["overflow"] = pg.evaluate(walk.OVERFLOW_JS)
    except Exception as e:  # noqa: BLE001
        out["overflow"] = {"error": str(e)[:200]}
    sel = walk.surface_of(pg, None if row.get("surface") in (None, "dialog", "page") else row["surface"])
    try:
        tap = pg.evaluate(TAP_JS, [sel, TAP_FLOOR])
        tap["binds"] = R.touch
        tap["pointerCoarse"] = pg.evaluate("() => matchMedia('(pointer: coarse)').matches")
        out["tap"] = tap
    except Exception as e:  # noqa: BLE001
        out["tap"] = {"error": str(e)[:200]}
    if R.g.axe_src:
        try:
            if not pg.evaluate("() => typeof window.axe !== 'undefined'"):
                pg.add_script_tag(content=R.g.axe_src)
            out["axe"] = pg.evaluate(AXE_RUN_JS, [sel, WCAG_TAGS])
        except Exception as e:  # noqa: BLE001
            out["axe"] = {"error": str(e)[:200]}
    else:
        out["axe"] = {"error": "axe-core unavailable (pass --axe)"}
    return out


def findings_of(R: Run, row: dict) -> list[dict]:
    out = []
    expected = set(row.get("expect_status") or [])
    for page, evs in row.get("events", {}).items():
        for e in evs:
            if "http" in e:
                if e["http"] in expected:
                    continue
                out.append({"kind": "http5xx" if e["http"] >= 500 else "http4xx", "page": page,
                            "detail": f"{e['method']} {e['url']} -> {e['http']}"})
            elif "console" in e:
                out.append({"kind": "console", "page": page, "detail": e["console"]})
            elif "pageerror" in e:
                out.append({"kind": "pageerror", "page": page, "detail": e["pageerror"]})
            elif "xss" in e:
                out.append({"kind": "xss", "page": page, "detail": e["xss"]})
    m = row.get("metrics") or {}
    ov = m.get("overflow") or {}
    if ov.get("horizontal"):
        out.append({"kind": "overflow", "page": "main",
                    "detail": f"scrollWidth {ov.get('docScrollWidth')} > {ov.get('vw')}: " +
                              json.dumps(ov.get("offenders", [])[:3], ensure_ascii=False)})
    tap = m.get("tap") or {}
    # A 1x1 control is a visually hidden input whose LABEL is the target (the segmented radios): not a tap
    # target, so not a finding. TAP_JS lists at most 25; the count is re-derived from what is kept.
    small = [{k: t[k] for k in ("label", "tag", "cls", "w", "h")} for t in tap.get("small") or []
             if not t.get("offscreen") and not t.get("covered")]
    small = list({json.dumps(t, sort_keys=True): t for t in small}.values())
    if tap.get("binds") and tap.get("pointerCoarse"):
        for t in small:                       # one finding per control, so the same control dedupes across runs
            out.append({"kind": "tap", "page": "main", "detail": f"under {TAP_FLOOR} px: " + json.dumps(t, ensure_ascii=False)})
    for v in (m.get("axe") or {}).get("violations") or []:
        if v.get("impact") in ("serious", "critical"):
            out.append({"kind": f"axe:{v['impact']}", "page": "main",
                        "detail": f"{v['id']}: {v['help']} ({v['nodes']} nodes) {v['targets'][:2]} -- "
                                  f"{v.get('summary', '')} {v.get('html', '')}"})
    return out


# ── the campaign ──────────────────────────────────────────────────────────────────────────

class Campaign:
    def __init__(self, args, spec, manifest, libs, out: Path):
        self.args, self.spec, self.manifest = args, spec, manifest
        self.h, self.fw, self.walk, self.sid = libs
        self.out = out
        self.run_id = args.run_id
        self.base = None
        self.browser = None
        self.sandbox: OwnedSandbox | None = None
        self.benign = tuple(self.fw.BENIGN) + EXTRA_BENIGN
        self.sentences = {}
        self.axe_src = None
        self.caps = {"w11": False, "restart": False, "clock": False, "sql_clock": False}
        self.clock_server = None          # the ClockSandbox serving this group, if any
        self.session_override: dict = {}  # persona id -> a session the clock launcher re-minted
        self.once_ran: dict = {}          # (persona, script, instant) -> the run a `once` script ran in
        self.facts: dict = {}             # (persona, fact) -> value, kept across runs and clock boots

    def sentence(self, key: str) -> str:
        v = self.sentences.get(key)
        if not v or not v["ok"]:
            raise Inconclusive(f"the sentence {key!r} is not verified against its source: {v and v['why']}")
        return self.spec["sentences"][key]["text"]

    def probe_w11(self) -> dict:
        # Under a clock group, a session the launcher vouched for at the shifted now: a seeded one the
        # server reads as expired would be DELETED by its own validate_session on this very request
        # (found in the fix-round dry run: the probe, not the launcher, removed P13's seeded row).
        vouched = next(iter(v for v in (self.session_override or {}).values() if v), None)
        if getattr(self, "clock_server", None) is not None:
            any_session = vouched                    # review N7: never a seeded cookie under a clock group
        else:
            any_session = vouched or next((m["session"] for m in self.manifest["members"].values()
                                           if m.get("session")), None)
        import urllib.request
        req = urllib.request.Request(self.base + "/api/j2/template-gallery/library",
                                     headers={"Cookie": f"uct_session={any_session}"} if any_session else {})
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                return {"status": r.status, "available": r.status == 200}
        except Exception as e:  # noqa: BLE001
            return {"status": getattr(e, "code", None), "available": False, "why": str(e)[:200]}

    def run_one(self, persona: dict, vp: str, mode: str) -> dict:
        R = Run(self, persona, vp, mode)
        R.dir.mkdir(parents=True, exist_ok=True)
        pg0 = R.new_page("main")
        clock_read = None
        if self.clock_server is not None:
            # Evidence that the browser and the server agree: the page's own Date against the shifted now.
            with contextlib.suppress(Exception):
                ms = pg0.evaluate("() => Date.now()")
                clock_read = {"browser_now": datetime.fromtimestamp(ms / 1000, timezone.utc).isoformat(timespec="seconds"),
                              "server_now": shifted_now().isoformat(timespec="seconds"),
                              "skew_s": round(ms / 1000 - shifted_now().timestamp(), 1)}
        started = datetime.now(timezone.utc).isoformat(timespec="seconds")
        once_skipped: list[str] = []
        try:
            for sc in scripts_at(persona):
                ran_in = once_gate(self.once_ran, persona, sc, f"{vp}-{mode}")
                if ran_in:
                    once_skipped.append(f"{sc['id']} (ran in {ran_in})")
                    continue
                skip_rest = None
                for i, s in enumerate(sc["steps"]):
                    sid_ = f"{sc['id']}.{i + 1:02d}"
                    row = self.step(R, sc, s, sid_, skip_rest)
                    R.steps.append(row)
                    if row["verdict"] != "PASS" and row.get("blocking"):
                        skip_rest = f"an earlier step ({sid_}) did not pass: {row.get('error') or 'a check failed'}"
        finally:
            R.close()
        verdict = run_verdict(R.steps)
        counts = {v: sum(1 for s in R.steps if s["verdict"] == v) for v in w11.VERDICTS}
        res = {"run_id": self.run_id, "persona": persona["id"], "viewport": vp, "mode": mode, "verdict": verdict,
               "counts": counts, "findings": sum(len(s.get("findings") or []) for s in R.steps),
               "started": started, "finished": datetime.now(timezone.utc).isoformat(timespec="seconds"),
               "evidence": str(R.dir.relative_to(self.out)).replace("\\", "/")}
        if "_at" in persona:
            res["at"] = {"index": persona["_at"], "instant": clock_instants(persona)[persona["_at"]]}
        if once_skipped:
            res["once_skipped"] = once_skipped
        if clock_read:
            res["clock"] = clock_read
        append_jsonl(self.out / "results.jsonl", res)
        self.file_defects(R)
        print(f"[{persona['id']} {vp} {mode}] {verdict} {counts} findings={res['findings']}", flush=True)
        return res

    def step(self, R: Run, sc: dict, s: dict, sid_: str, skip_rest: str | None) -> dict:
        row = {"step": sid_, "do": s["do"], "title": s.get("title") or sc["title"], "persona": R.p["id"],
               "viewport": R.vp, "mode": R.mode, "checks": [], "read": [], "timings": {}, "screenshots": [],
               "verdict": None, "blocking": s["do"] in BLOCKING, "expect_status": list(s.get("expect_status") or [])}
        needs = set(sc.get("needs") or []) | set(s.get("needs") or [])
        unmet = sorted(n for n in needs if not self.caps.get(n))
        for _, (_, ev) in R.pages.items():
            ev.clear()
        t0 = time.perf_counter()
        if unmet:
            row["verdict"] = "INCONCLUSIVE"
            row["error"] = "needs " + ", ".join(unmet) + ": " + "; ".join(NEED_WHY[n] for n in unmet)
        elif skip_rest:
            row["verdict"] = "INCONCLUSIVE"
            row["error"] = skip_rest
        else:
            try:
                ACTIONS[s["do"]](R, s, row)
                expectations(R, s, row)
                if s["do"] in W11_ACTIONS and not row["checks"]:
                    raise Inconclusive("the step read nothing (no check), so it proved nothing")
                row["verdict"] = "PASS" if all(c["ok"] for c in row["checks"]) else "FAIL"
            except KeyboardUnreachable as e:
                row["verdict"] = "FAIL"
                row["error"] = f"keyboard: {e}"
                row.setdefault("findings_raw", []).append({"kind": "keyboard", "page": "main", "detail": str(e)})
            except Inconclusive as e:
                row["verdict"] = "FAIL" if any(not c["ok"] for c in row["checks"]) else "INCONCLUSIVE"
                row["error"] = f"INCONCLUSIVE: {e}"
            except Pending as e:
                row["verdict"] = "FAIL" if any(not c["ok"] for c in row["checks"]) else w11.PENDING
                row["error"] = f"{w11.PENDING}: {e}"
            except Exception as e:  # noqa: BLE001 -- a read the driver could not finish
                row["verdict"] = "FAIL" if any(not c["ok"] for c in row["checks"]) else "INCONCLUSIVE"
                row["error"] = f"{type(e).__name__}: {str(e)[:500]}"
                row["traceback"] = traceback.format_exc()[-1500:]
        row["ms"] = round((time.perf_counter() - t0) * 1000)
        ran = not (unmet or skip_rest)
        row["events"] = {name: list(ev) for name, (_, ev) in R.pages.items() if ev}
        if ran:
            # A wave 11 step reads the server over HTTP and never touches the page: no screenshot or axe pass of a
            # page it did not change (the findings below still read every page's events).
            pg = R.page() if s["do"] not in W11_ACTIONS else None
            if pg is not None and not pg.is_closed():
                row["metrics"] = metrics(R, row)
                try:
                    shot = R.dir / "shots" / f"{sid_.replace('.', '_')}.png"
                    shot.parent.mkdir(parents=True, exist_ok=True)
                    pg.screenshot(path=str(shot))
                    row["screenshots"].append(str(shot.relative_to(self.out)).replace("\\", "/"))
                except Exception:  # noqa: BLE001
                    pass
                if row["verdict"] != "PASS":
                    with contextlib.suppress(Exception):
                        row["page_text"] = pg.locator("body").inner_text(timeout=3000)[:3000]
            row["findings"] = findings_of(R, row) + list(row.pop("findings_raw", []))
        write_json(R.dir / "steps" / f"{sid_.replace('.', '_')}.json", row)
        return row

    def file_defects(self, R: Run) -> None:
        """One line per distinct finding (its `expected` + `actual`) in this evidence folder: the first
        persona, viewport and mode that met it are the line's own fields, and every later meeting is
        added to its `seenIn` (so one product defect seen in 300 runs is one line to triage, not 300)."""
        path = self.out / "defects.jsonl"
        existing = read_jsonl(path)
        by_key = {defect_key(d.get("expected"), d.get("actual")): d for d in existing}
        new = []
        for row in R.steps:
            step_json = str((R.dir / "steps" / (row["step"].replace(".", "_") + ".json")).relative_to(self.out)).replace("\\", "/")
            shot = row["screenshots"][0] if row.get("screenshots") else "-"
            items = []
            if row["verdict"] == "FAIL":
                for c in row["checks"]:
                    if not c["ok"]:
                        items.append(("expectation", f"{row['do']}: {c['what']}", c["read"] or row.get("error") or ""))
            for f in row.get("findings") or []:
                items.append((f["kind"], f"{FINDING_RULE.get(f['kind'], 'no serious or critical axe finding')}",
                              f"[{f['page']}] {f['detail']}"))
            for kind, expected, actual in items:
                key = defect_key(expected, actual[:900])
                seen = {"persona": R.p["id"], "viewport": R.vp, "keyboard": R.keyboard, "step": row["step"],
                        "run": self.run_id}
                if key in by_key:
                    d = by_key[key]
                    if seen not in d.setdefault("seenIn", []):
                        d["seenIn"].append(seen)
                    continue
                d = {"persona": R.p["id"], "viewport": R.vp, "keyboard": R.keyboard, "steps": [row["step"]],
                     "expected": expected, "actual": actual[:900], "evidence": f"{shot}; {step_json}",
                     "severity": SEVERITY.get(kind, "minor"), "status": "untriaged", "fixSha": None, "retest": None,
                     "seenIn": [seen]}
                by_key[key] = d
                new.append(d)
        for d, nid in zip(new, next_defect_ids(existing, len(new))):
            existing.append({"id": nid, **d})
        tmp = path.with_suffix(".jsonl.tmp")
        tmp.write_text("".join(json.dumps(d, ensure_ascii=False, default=str) + "\n" for d in existing),
                       encoding="utf-8", newline="\n")
        os.replace(tmp, path)


FINDING_RULE = {"console": "no console error", "pageerror": "no page error",
                "http4xx": "no failed request the step did not expect", "http5xx": "no server error",
                "overflow": "no horizontal overflow", "tap": f"every touch target at least {TAP_FLOOR} px",
                "keyboard": "every control reachable by keyboard", "xss": "member text never runs as markup",
                "axe:serious": "no serious axe finding", "axe:critical": "no critical axe finding"}
BLOCKING = {"seed_note", "open_note", "open_builder", "builder_blank", "builder_save", "insert_routine", "my_tools",
            "new_context", "open"}
NEED_WHY = {"w11": "the server at --base has no wave 11 routes (GET /api/j2/template-gallery/library is not 200)",
            "restart": "a flag flip restarts the server; only --own-sandbox can",
            "clock": ("the server runs on the real clock: pass --clock-launcher tools/notebook_campaign/sandbox_clock.py "
                      "(ruling W11-R49) to boot it at the persona's instant"),
            "sql_clock": ("the verdict rests on SQLite's own clock (a CURRENT_TIMESTAMP / 'now' default), which the "
                          "launcher-only clock shift cannot move (sandbox_clock lists the tables at boot)")}


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--run-id", required=True)
    ap.add_argument("--persona", action="append", default=[], help="Pnn (repeatable or comma-separated)")
    ap.add_argument("--viewport", action="append", default=[], choices=["1200", "820", "390"])
    ap.add_argument("--keyboard", action="store_true", help="keyboard-only runs only")
    ap.add_argument("--pointer", action="store_true", help="pointer runs only")
    ap.add_argument("--base", default=None, help="a sandbox already running on --data-dir (localhost only)")
    ap.add_argument("--own-sandbox", action="store_true", help="boot (and restart for flag flips) the sandbox here")
    ap.add_argument("--port", type=int, default=8131)
    ap.add_argument("--data-dir", required=True, help="the dir seed_members.py seeded")
    ap.add_argument("--app-root", default=str(REPO))
    ap.add_argument("--personas", default=str(seedmod.PERSONAS))
    ap.add_argument("--out", default=None, help="evidence folder (default docs/notebook/evidence/<run-id>)")
    ap.add_argument("--axe", default=None, help="axe.min.js (default: <app-root>/app/node_modules/axe-core/axe.min.js)")
    ap.add_argument("--headed", action="store_true")
    ap.add_argument("--no-heavy-lock", action="store_true")
    ap.add_argument("--clock-launcher", default=None,
                    help="tools/notebook_campaign/sandbox_clock.py: boots the server at each clock persona's instant")
    ap.add_argument("--clock-port", type=int, default=8141, help="the clock sandbox's port (loopback)")
    args = ap.parse_args(argv)

    if args.base:
        why = refuse_non_local(args.base)
        if why:
            print(f"REFUSED: {why}")
            return 3
    elif not args.own_sandbox and not args.clock_launcher:
        print("REFUSED: pass --base <local sandbox>, --own-sandbox, or --clock-launcher (clock personas only)")
        return 3
    why = seedmod.refuse_shared_root(args.data_dir)
    if why:
        print(f"REFUSED: {why}")
        return 3
    data_dir = Path(os.path.abspath(args.data_dir))
    mpath = data_dir / seedmod.MANIFEST_NAME
    if not mpath.is_file():
        print(f"REFUSED: {mpath} is missing: seed the data dir with seed_members.py first")
        return 3
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    app_root = Path(args.app_root).resolve()
    spec = seedmod.load_personas(args.personas)
    out = Path(args.out) if args.out else REPO / "docs" / "notebook" / "evidence" / args.run_id
    why = seedmod.refuse_shared_root(str(out))          # review m3: every data path, the evidence folder too
    if why:
        print(f"REFUSED: --out {why}")
        return 3
    out.mkdir(parents=True, exist_ok=True)
    libs = load_walk_libs(app_root)
    g = Campaign(args, spec, manifest, libs, out)
    g.sentences = verify_sentences(spec, app_root)
    axe = Path(args.axe) if args.axe else app_root / "app" / "node_modules" / "axe-core" / "axe.min.js"
    g.axe_src = axe.read_text(encoding="utf-8") if axe.is_file() else None

    want = {x.strip() for p in args.persona for x in p.split(",") if x.strip()}
    people = [p for p in spec["personas"] if not want or p["id"] in want]
    missing = [p["id"] for p in people if p["id"] not in manifest["members"]]
    if missing:
        print(f"REFUSED: not seeded in {mpath}: {missing}")
        return 3
    modes = ["keyboard"] if args.keyboard else ["pointer"] if args.pointer else ["pointer", "keyboard"]

    meta = {"run_id": args.run_id, "tool": "tools/notebook_campaign/run_campaign.py",
            "tool_tree": subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(REPO), capture_output=True, text=True).stdout.strip(),
            "app_root": str(app_root),
            "app_tree": subprocess.run(["git", "rev-parse", "HEAD"], cwd=str(app_root), capture_output=True, text=True).stdout.strip(),
            "data_dir": str(data_dir), "personas": [p["id"] for p in people], "modes": modes,
            "viewports": args.viewport or "per persona", "axe": {"path": str(axe), "present": bool(g.axe_src)},
            "sentences": g.sentences, "started": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    write_json(out / "run.json", meta)
    drifted = [k for k, v in g.sentences.items() if not v["ok"]]
    if drifted:
        print(f"NOTE: {len(drifted)} sentences did not verify against their sources (their steps read INCONCLUSIVE): {drifted}")

    clocked = [p for p in people if persona_needs_clock(p)]
    plain = [p for p in people if not persona_needs_clock(p)]
    groups: list = []
    launcher = Path(args.clock_launcher).resolve() if args.clock_launcher else None
    if launcher:
        if not launcher.is_file():
            print(f"REFUSED: --clock-launcher {launcher} does not exist")
            return 3
        if args.base and clocked:
            print("REFUSED: --clock-launcher boots its own server on the data dir; stop the --base server and use "
                  "--own-sandbox (or neither, to run only the clock personas)")
            return 3
        try:
            groups = clock_groups(clocked)
        except ValueError as e:
            print(f"REFUSED: {e}")
            return 3
        meta["clock_groups"] = [{"clock": at, "personas": [p["id"] for p in ps]} for at, ps in groups]
    else:
        plain = people                       # clock steps read INCONCLUSIVE (NEED_WHY["clock"])
    if not (args.base or args.own_sandbox) and plain:
        print(f"NOTE: no --base / --own-sandbox: {[p['id'] for p in plain]} are not run (only clock personas are)")
        plain = []

    def verify_identity(label: str) -> dict | None:
        ident, why = g.sid.fetch_identity(g.base)
        served = os.path.normcase(os.path.abspath(str((ident or {}).get("data_dir") or "")))
        meta.setdefault("identity", {})[label] = {"served": ident, "why": why}
        if not ident or served != os.path.normcase(str(data_dir)):
            print(f"REFUSED: {g.base} did not prove it is the sandbox on {data_dir} (it answered "
                  f"{(ident or {}).get('data_dir')!r}; {why}). Nothing was driven.")
            return None
        return ident

    def run_people(ps: list[dict], results: list) -> None:
        for p in ps:
            vps = args.viewport or p.get("viewports") or spec["defaults"]["viewports"]
            pmodes = [m for m in modes if m in p.get("modes", modes)]
            for vp in vps:
                for mode in pmodes:
                    try:
                        results.append(g.run_one(p, vp, mode))
                    except Exception as e:  # noqa: BLE001 -- one run's crash never hides the next
                        print(f"[{p['id']} {vp} {mode}] TOOL ERROR {type(e).__name__}: {e}", flush=True)
                        append_jsonl(out / "results.jsonl", {"run_id": args.run_id, "persona": p["id"], "viewport": vp,
                                                             "mode": mode, "verdict": "INCONCLUSIVE",
                                                             "tool_error": f"{type(e).__name__}: {str(e)[:400]}"})
                    if g.sandbox and g.sandbox.overrides:
                        g.sandbox.restart({})           # a flag persona never leaves the next one flipped

    global CLOCK_OFFSET_S
    lock = seedmod.heavy_lock(f"notebook-campaign {args.run_id}", enabled=not args.no_heavy_lock)
    from playwright.sync_api import sync_playwright
    clock_sb = None
    with lock, sync_playwright() as pw:
        try:
            results: list = []
            if plain:
                if args.own_sandbox:
                    g.sandbox = OwnedSandbox(g.h, g.fw, data_dir, args.port, out)
                    g.sandbox.start()
                    g.base = g.sandbox.base
                    g.caps["restart"] = True
                else:
                    g.base = args.base.rstrip("/")
                if not verify_identity("main"):
                    return 3
                meta["w11_probe"] = g.probe_w11()
                g.caps["w11"] = bool(meta["w11_probe"]["available"])
                write_json(out / "run.json", meta)
                print(f"sandbox {g.base} on {data_dir}; wave 11 routes: "
                      f"{'present' if g.caps['w11'] else 'ABSENT (w11 steps INCONCLUSIVE)'}", flush=True)
                g.browser = g.browser or pw.chromium.launch(headless=not args.headed)
                run_people(plain, results)
                if g.sandbox:
                    g.sandbox.stop()           # the clock groups boot their own server on this data dir
                    meta["boots"] = g.sandbox.boots
                    g.sandbox = None
                    g.caps["restart"] = False
            if groups:
                clock_sb = ClockSandbox(g.h, g.fw, launcher, app_root, data_dir, args.clock_port, out)
            for at, ps in groups:
                clock_sb.start(at, [p["id"] for p in ps])
                try:
                    g.base = clock_sb.base
                    ident = verify_identity(f"clock {at}")
                    if not ident:
                        return 3
                    why = verify_clock_server(ident, at)
                    if why:
                        print(f"REFUSED: {why}. Nothing was driven.")
                        return 3
                    CLOCK_OFFSET_S = float(ident["clock_shift"]["offset_s"])
                    g.clock_server = clock_sb
                    g.caps["clock"] = True
                    sess = data_dir / "clock-sessions.json"
                    g.session_override = {}
                    if sess.is_file():
                        body = json.loads(sess.read_text(encoding="utf-8"))
                        if body.get("clock") and datetime.fromisoformat(body["clock"]) == datetime.fromisoformat(at):
                            g.session_override = body.get("members") or {}
                    meta["w11_probe"] = g.probe_w11()
                    g.caps["w11"] = bool(meta["w11_probe"]["available"])
                    meta.setdefault("clock_servers", []).append({"clock": at, "clock_shift": ident["clock_shift"],
                                                                 "sessions_from_launcher": len(g.session_override)})
                    write_json(out / "run.json", meta)
                    print(f"clock sandbox {g.base} on {data_dir} at {at} (server now "
                          f"{ident['clock_shift'].get('now_et_words')}); wave 11 routes: "
                          f"{'present' if g.caps['w11'] else 'ABSENT (w11 steps INCONCLUSIVE)'}", flush=True)
                    g.browser = g.browser or pw.chromium.launch(headless=not args.headed)
                    run_people(ps, results)
                finally:
                    clock_sb.stop()
                    g.clock_server, g.caps["clock"], g.session_override = None, False, {}
                    CLOCK_OFFSET_S = 0.0
        finally:
            if g.browser:
                with contextlib.suppress(Exception):
                    g.browser.close()
            if g.sandbox:
                g.sandbox.stop()
                meta["boots"] = g.sandbox.boots
            if clock_sb:
                clock_sb.stop()
                meta["clock_boots"] = clock_sb.boots
            meta["finished"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            write_json(out / "run.json", meta)
    rows = read_jsonl(out / "results.jsonl")
    tally = {v: sum(1 for r in rows if r.get("run_id") == args.run_id and r["verdict"] == v) for v in ("PASS", "FAIL", "INCONCLUSIVE")}
    print(f"CAMPAIGN {args.run_id}: {tally} runs; results {out / 'results.jsonl'}; defects {out / 'defects.jsonl'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
