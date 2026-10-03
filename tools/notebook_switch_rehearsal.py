"""Rehearse every Notebook switch on a SANDBOX, and print the production window's commands.

Wave 10, lane 10C, ruling R-11: "rehearsal = sandbox mechanism for every switch + production
reach for every per-request switch in ONE batched off-hours window (2 redeploys)". This tool is
the sandbox half, and it PRINTS the production half. ⛔ It never runs `railway` and never
contacts production on its own; `--verify` is the one mode that can reach a non-loopback host,
and only when the controller runs it, only with GET requests, and only as the smoke account.

MODES
  --run                 boot the sandbox once per VALUE (a restart per value) and assert each
                        switch by what renders: the offline layer opens its IndexedDB store or
                        not, the share / publish / onboarding doors answer 404 or 200, the tour
                        shows or not, the editor's "Writing help" entry is there or not. Every
                        boot also reads the auth payload and runs `--verify`'s own check, so the
                        check the controller runs in production is the code this run proved.
  --print-production    the controller's window, step by step (no network).
  --check-record FILE   read a recorded `railway variables --service web --kv` and print the
                        exact OFF command and the exact RESTORE (deletes first, then ONE --set).
  --verify BASE --expect off|on [--recorded FILE] [--set-at ISO]
                        read-only: /api/health (was there a NEW boot since --set-at?), the auth
                        payload's Notebook keys, and the GET doors. Production needs
                        SMOKE_EMAIL / SMOKE_PASSWORD and refuses any other account.
  --self-check          pure: the judge can fail, the derivations are not vacuous.

WHAT IS DERIVED, NEVER TYPED
  * the capability table (env name, default polarity) is read from `api/routers/auth.py`'s
    NOTEBOOK_FLAGS / NOTEBOOK_MODE_FLAGS by AST -- no import of the app;
  * which gates production has ARMED is read from `docs/feature_flags.json` (and, in the
    window, from the RECORD, which outranks the ledger: the ledger is the artifact most likely
    to be stale, CLAUDE.md "`railway variables --set` -- measured BOTH ways");
  * the value parse is `api.services.notebook_flags`' own TRUTHY / FALSY sets.
  * a rehearsed ROUTE gate's polarity (it is not a payload key) comes from the repo's own gate
    index (`api.services.feature_flag_index`), and every other Notebook gate that index finds is
    printed as NOT rehearsed with its reason -- a gate is never dropped silently.
The only typed facts are the rendered probes in SWITCHES (what a switch changes on screen) and
the reasons in NOT_REHEARSED; `tests/test_notebook_switch_rehearsal.py` fails if a name leaves
the table or the index.

SANDBOX: `scripts/hub_sandbox_boot.py` through `tools/notebook_perf_harness.Sandbox` (graceful
CTRL_BREAK stop, its shutdown checkpoint, never C:\\data, never a busy port). Pass the data dir
from PowerShell or single-quoted. Each boot's integrity verdict is the FIRST field of its record
and the run's summary opens with the aggregate verdict. Nothing is written except through the
app's own doors (sign-up, comp, verify-email, one note per boot).

    python tools/notebook_switch_rehearsal.py --run --data-dir 'C:\\data-w10c' --port 8213 \\
        --out docs/notebook/evidence/wave10-10c/switch-rehearsal
    python tools/notebook_switch_rehearsal.py --print-production

Exit: 0 PASS; 1 a switch did not do what its value says (FAIL); 2 INCONCLUSIVE (something could
not be measured, including any boot whose integrity did not close CLEAN); 3 refused.
"""
from __future__ import annotations

import argparse
import ast
import datetime as _dt
import functools
import http.cookiejar
import importlib.util
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
AUTH_PY = REPO / "api" / "routers" / "auth.py"
LEDGER = REPO / "docs" / "feature_flags.json"
PROD = "https://uctintelligence.com"
DATA_DEFAULT = r"C:\data-w10c"
PORT_DEFAULT = 8213
# Cloudflare 1010-blocks a python-urllib User-Agent in front of production (CLAUDE.md).
BROWSER_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
              "(KHTML, like Gecko) Chrome/131.0 Safari/537.36")
MEMBER_PW = "LocalTest2026!"

if str(REPO) not in sys.path:
    sys.path.insert(0, str(REPO))
# ⛔ The census and the tripwire BEFORE any api.* import (tests/test_notebook_bridges_pin_the_root.py):
# run as a script this tool is outside pytest, and an api module that captures a path at import
# would otherwise resolve it against the live C:\data.
import conftest  # noqa: E402,F401
from api.services.notebook_flags import FALSY, TRUTHY  # noqa: E402 -- the ONE parse vocabulary


# ── the derived tables ──────────────────────────────────────────────────────────────────────

def capability_table(path: Path = AUTH_PY) -> tuple[dict[str, bool], list[str]]:
    """NOTEBOOK_FLAGS (env -> default polarity) and NOTEBOOK_MODE_FLAGS' names, by AST."""
    tree = ast.parse(Path(path).read_text(encoding="utf-8"))
    flags: dict[str, bool] = {}
    modes: list[str] = []
    for node in tree.body:
        if not (isinstance(node, ast.Assign) and len(node.targets) == 1
                and isinstance(node.targets[0], ast.Name) and isinstance(node.value, ast.Dict)):
            continue
        name = node.targets[0].id
        if name == "NOTEBOOK_FLAGS":
            for k, v in zip(node.value.keys, node.value.values):
                if isinstance(k, ast.Constant) and isinstance(v, ast.Constant):
                    flags[k.value] = bool(v.value)
        elif name == "NOTEBOOK_MODE_FLAGS":
            modes = [k.value for k in node.value.keys if isinstance(k, ast.Constant)]
    return flags, modes


def payload_key(env: str) -> str:
    """auth._notebook_flag_key's rule (lower-case), railed against the real function."""
    return env.lower()


def ledger_flags(path: Path = LEDGER) -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8")).get("flags", {})


def armed_on_web(table: dict[str, bool], ledger: dict) -> list[str]:
    """Enablement gates the ledger records as armed on web. Kill switches are not listed here:
    they default ON and the ledger's own doctrine gives them no entry."""
    out = []
    for env, default_on in table.items():
        e = ledger.get(env) or {}
        if not default_on and e.get("status") == "armed" and "web" in (e.get("where") or []):
            out.append(env)
    return out


def kill_switches(table: dict[str, bool]) -> list[str]:
    return [env for env, default_on in table.items() if default_on]


def parse_value(raw: str | None, default: bool) -> bool:
    """`flag_on`'s rule over a GIVEN value instead of the environment (a record, a plan)."""
    if raw is None:
        return bool(default)
    v = str(raw).strip().lower()
    if v in FALSY:
        return False
    if v in TRUTHY:
        return True
    return bool(default)


# ── what each rehearsed switch changes on screen (the only typed facts) ──────────────────────

@dataclass(frozen=True)
class Switch:
    env: str
    rendered: str            # a key of the observation's "rendered" dict
    door: tuple | None       # (method, path, json body or None); path may hold {note}
    door_on: int | None      # the status the door answers while the switch is ON
    what: str
    payload: bool = True     # False: a ROUTE gate, not a key of the auth payload


SWITCHES = (
    Switch("NOTEBOOK_OFFLINE_DEFAULT_ON", "offline_store", None, None,
           "the editor opens the durable IndexedDB store (uct_notebook_<account>) or not"),
    Switch("J2_SHARE_LINKS_ENABLED", "share_heading", ("GET", "/api/j2/share/links", None), 200,
           'the Share sheet carries "Share link"; GET /api/j2/share/links 200 or 404'),
    Switch("NOTEBOOK_PUBLISH_ENABLED", "publish_heading", ("GET", "/api/j2/publish", None), 200,
           'the Share sheet carries "Publish to the web"; GET /api/j2/publish 200 or 404'),
    Switch("NOTEBOOK_ONBOARDING_ENABLED", "tour_dialog",
           ("GET", "/api/j2/onboarding/sample-notebook", None), 200,
           "a new member's first visit shows the tour (Step 1 of N); the sample door 200 or 404"),
    # ⛔ The ON answer is 422 on purpose: an unknown action is refused before any model call,
    # so the door proves the gate opened without spending a writing-help request.
    Switch("NOTEBOOK_WRITING_HELP_ENABLED", "writing_help_button",
           ("POST", "/api/j2/notes/{note}/writing-help/stream", {"action": "__rehearsal__"}), 422,
           'the editor toolbar carries "Writing help"; the stream door 422 (gate open) or 404'),
    # A ROUTE gate (armed on web 2026-09-26 23:11Z, master 6e7785b52): not on the payload, so
    # its reach is the door and the Settings card, which renders nothing at all while dark.
    Switch("NOTEBOOK_PERSONAL_API_ENABLED", "personal_api_card",
           ("GET", "/api/j2/personal/tokens", None), 200,
           'Settings > Connections carries the "Personal API" card; GET /api/j2/personal/tokens 200 or 404',
           payload=False),
)
DOOR_OFF = 404

# Every other Notebook gate the repo's own index finds, and why the window does not switch it.
# A gate missing here is printed as "no rendered probe written" -- never silently dropped.
NOT_REHEARSED = {
    "NOTEBOOK_ASK_INSERT_ON": "payload only: its surface needs an Ask answer (a model call)",
    "NOTEBOOK_IMAGE_DOCX_DOCUMENTS_ENABLED": "no read-only surface: it acts only on an upload",
    "NOTEBOOK_TASK_REMINDERS_ENABLED": "kill switch read per scheduled run: its only evidence is "
                                       "a reminder members would not get",
    "COMPASS_NOTES_TOOL_ENABLED": "no read-only surface: it acts only inside a Compass chat turn",
    "NOTEBOOK_INBOUND_EMAIL_ENABLED": "dark (external blockers: DNS/MX, WAF, wrangler)",
    "NOTEBOOK_SEMANTIC_SEARCH_ENABLED": "dark (waits for OpenAI's written ZDR, R-20)",
    "NOTEBOOK_SEMANTIC_PROVIDER": "a MODE, inert while semantic search is dark",
    "NOTEBOOK_OFFLINE_READ_ON": "dark: the feature is NOT BUILT",
    "NOTEBOOK_CONFLICT_UX_ON": "dark: the feature is NOT BUILT",
    "NOTEBOOK_ATTACHMENTS_ON": "dark: the feature is NOT BUILT",
    "NOTEBOOK_DOOR_GUARD": "a MODE, never switched off; its intended value is the owner's question",
    "NOTEBOOK_TEMPLATE_GALLERY_ENABLED": "dark (wave 12 12A): waits for its real-browser walk and "
                                         "the owner naming who reviews submissions",
    # Wave 11 (#263). Each reason names what the gate protects, from the PR body; a numbered
    # "owner decision" is that body's "Decisions for you" list.
    "NOTEBOOK_VOICE_NOTES_ENABLED": "dark (wave 11 11A): voice and meeting notes -- Whisper "
                                    "transcription against the 60-minute monthly dictation "
                                    "allowance and one summary call on the shared $25/day cap; "
                                    "owner decisions 1-2 open (minute allowance, Desk transcripts)",
    "NOTEBOOK_FORMULAS_ENABLED": "dark (wave 11 11B): formula and rollup properties, computed in "
                                 "memory on read; waits on a quiet-machine 50k re-measure and the "
                                 "owner's go",
    "NOTEBOOK_AI_ACTIONS_ENABLED": "dark (wave 11 11C): Ask Notebook to do something -- one model "
                                   "call per plan on the shared $25/day cap, then reviewed changes "
                                   "written through the member's own write path, undoable; owner "
                                   "decisions 5-6 open (fail-open counter, unsent-words fork)",
    "NOTEBOOK_TRADE_CANVAS_ENABLED": "dark (wave 11 11D): the trade-plan canvas note (schema level 3, "
                                     "NEVER-REVERT); no route of its own, only the doors that make "
                                     "a canvas",
    # Wave 13 lane 13I-1. No member surface yet: 13I-2 builds the panel that reads it.
    "NOTEBOOK_TA_FINGERPRINT_ENABLED": "dark (wave 13 13I-1): the technical fingerprint and "
                                       "chart-block index API; no member surface until 13I-2",
    # Wave 13 lane 13C.
    "NOTEBOOK_EARNINGS_PREP_ENABLED": "dark (wave 13 13C): Reporting soon on Research Home and a "
                                      "one-click earnings prep note; waits for its real-browser walk",
    # Wave 13 lane 13H-1. No member surface yet: 13H-2 builds the plan panel on these routes.
    "NOTEBOOK_CHART_PLAN_ENABLED": "dark (wave 13 13H-1): chart-plan sizing and alerts at drawn "
                                   "levels (API only); no member surface until 13H-2",
}


@functools.lru_cache(maxsize=1)
def _index() -> tuple[dict, frozenset]:
    """The repo's own gate index, ONCE per process: (the scan, the gate+mode names). Its AST walk
    of api/, scripts/ and tools/ is the slow part, and every caller wants the same answer."""
    import warnings
    from api.services import feature_flag_index as ffi
    roots = ffi.repo_roots(REPO)
    with warnings.catch_warnings():  # the index parses every file; a stray escape is not ours
        warnings.simplefilter("ignore", SyntaxWarning)
        scan = ffi.scan(roots, REPO)
        modes = ffi.mode_flags(roots, REPO)
    # `gates()` is `scan` narrowed by `is_gate`; narrowed here so the scan runs once.
    names = frozenset(k for k in scan if ffi.is_gate(k)) | frozenset(modes)
    return scan, names


def rehearsal_table(payload_table: dict[str, bool]) -> dict[str, bool]:
    """The payload table plus each rehearsed ROUTE gate, whose polarity the repo's gate index
    derives from its read site (feature_flag_index.defaults_on)."""
    from api.services import feature_flag_index as ffi
    scan, _names = _index()
    out = dict(payload_table)
    for s in SWITCHES:
        if s.env not in out:
            out[s.env] = ffi.defaults_on(s.env, (scan.get(s.env) or {}).get("default"))
    return out


def notebook_gates_in_index() -> list[str]:
    """Every Notebook gate and mode the repo's own index finds (name-scoped to this programme).
    Gates and modes only, never the raw scan: that also lists secrets, paths and caps."""
    _scan, names = _index()
    return sorted(k for k in names
                  if k.startswith(("NOTEBOOK_", "COMPASS_NOTES_")) or k == "J2_SHARE_LINKS_ENABLED")


def not_rehearsed(table: dict[str, bool], modes: list[str]) -> dict[str, str]:
    rehearsed = {s.env for s in SWITCHES} | {"NOTEBOOK_OFFLINE_DEFAULT_ON"}
    names = set(notebook_gates_in_index()) | set(table) | set(modes)
    return {n: NOT_REHEARSED.get(n, "no rendered probe written") for n in sorted(names - rehearsed)}


def switch_value(env: str, table: dict[str, bool], on: bool) -> str | None:
    """The sandbox value for ON / OFF. A kill switch's ON is UNSET (production's own state)."""
    if not on:
        return "0"
    return None if table.get(env) else "1"


def boot_plan(table: dict[str, bool], armed: list[str]) -> list[tuple[str, dict[str, str | None]]]:
    """production values -> all off (the window's step 1) -> restored (step 3), then each
    rehearsed switch alone OFF, so every rendered difference is attributable to ONE switch."""
    keys = [s.env for s in SWITCHES] + [a for a in armed if a not in {s.env for s in SWITCHES}]
    on = {k: switch_value(k, table, True) for k in keys}
    off = {k: switch_value(k, table, False) for k in keys}
    plan = [("production-values", on), ("all-off", off), ("restored", dict(on))]
    for s in SWITCHES:
        plan.append((f"only-{s.env}-off", {**on, s.env: "0"}))
    return plan


# ── the judge (pure) ────────────────────────────────────────────────────────────────────────

def judge(env_values: dict[str, str | None], obs: dict, table: dict[str, bool]) -> list[dict]:
    """One row per rehearsed switch and per payload-only key. PASS needs EVERY observation to
    agree with the value; a missing observation is INCONCLUSIVE, never a pass."""
    rows = []
    payload = obs.get("payload") or {}
    for s in SWITCHES:
        want = parse_value(env_values.get(s.env), table[s.env])
        got_payload = payload.get(payload_key(s.env))
        got_rendered = (obs.get("rendered") or {}).get(s.rendered)
        got_door = (obs.get("doors") or {}).get(s.env)
        want_door = (s.door_on if want else DOOR_OFF) if s.door else None
        checks = [("rendered", want, got_rendered)]
        if s.payload:
            checks.insert(0, ("payload", want, got_payload))
        else:
            got_payload = "route gate"
        if s.door:
            checks.append(("door", want_door, got_door))
        missing = [n for n, _w, g in checks if g is None]
        wrong = [f"{n} {g!r} (want {w!r})" for n, w, g in checks if g is not None and g != w]
        verdict = "FAIL" if wrong else ("INCONCLUSIVE" if missing else "PASS")
        rows.append({"switch": s.env, "value": env_values.get(s.env), "want_on": want,
                     "payload": got_payload, "rendered": got_rendered, "door": got_door,
                     "want_door": want_door, "verdict": verdict,
                     "why": "; ".join(wrong) or ("not measured: " + ", ".join(missing) if missing else "")})
    for env, raw in env_values.items():
        if env in {s.env for s in SWITCHES}:
            continue
        want = parse_value(raw, table.get(env, False))
        got = payload.get(payload_key(env))
        verdict = "INCONCLUSIVE" if got is None else ("PASS" if got == want else "FAIL")
        rows.append({"switch": env, "value": raw, "want_on": want, "payload": got,
                     "rendered": "payload only", "door": None, "want_door": None,
                     "verdict": verdict, "why": "" if verdict == "PASS" else f"payload {got!r} (want {want!r})"})
    return rows


def overall(verdicts: list[str]) -> str:
    if "FAIL" in verdicts:
        return "FAIL"
    if not verdicts or "INCONCLUSIVE" in verdicts:
        return "INCONCLUSIVE"
    return "PASS"


# ── the record (production window) ──────────────────────────────────────────────────────────

def read_record(text: str) -> dict[str, str]:
    """`railway variables --kv` output: KEY=VALUE per line. Everything else is ignored."""
    out = {}
    for line in text.splitlines():
        line = line.strip()
        if "=" in line and not line.startswith("#"):
            k, v = line.split("=", 1)
            if k.strip().isidentifier():
                out[k.strip()] = v
    return out


def off_set(table: dict[str, bool], record: dict[str, str] | None, armed: list[str]) -> list[str]:
    """The keys the window turns OFF: every enablement gate that is ON (the RECORD decides when
    there is one; the ledger otherwise) and every kill switch."""
    keys = []
    for env, default_on in table.items():
        if default_on:
            keys.append(env)
        elif record is not None:
            if parse_value(record.get(env), default_on):
                keys.append(env)
        elif env in armed:
            keys.append(env)
    return keys


def off_command(keys: list[str]) -> str:
    sets = " ".join(f'--set "{k}=0"' for k in keys)
    return f"railway variables --service web {sets}"


def restore_steps(keys: list[str], record: dict[str, str]) -> list[str]:
    """Deletes FIRST (a delete stages and does NOT redeploy), then ONE --set whose redeploy
    boots with both. With nothing to --set, an explicit redeploy is the step that applies it."""
    deletes = [f"railway variable delete {k} --service web" for k in keys if k not in record]
    pairs = [f'--set "{k}={record[k]}"' for k in keys if k in record]
    steps = list(deletes)
    if pairs:
        steps.append("railway variables --service web " + " ".join(pairs))
    else:
        steps.append("railway redeploy --service web --yes")
    return steps


def expected_state(expect: str, table: dict[str, bool], keys: list[str],
                   record: dict[str, str] | None) -> dict[str, bool]:
    """env -> ON?  `off`: every key off. `on`: the RECORD's value (unset = the default), or ON
    when there is no record."""
    if expect == "off":
        return {k: False for k in keys}
    return {k: parse_value((record or {}).get(k), table[k]) if record is not None else True
            for k in keys}


def verify_verdict(expect: str, want_on: dict[str, bool], payload_envs: set[str], me: dict | None,
                   doors: dict[str, int | None], uptime: int | None, set_at: str | None,
                   now: float | None = None) -> tuple[str, list[str]]:
    """Pure: the smoke account's reading -> (verdict, lines). Payload lines for the payload's own
    keys; a door line for every door read (route gates have no payload key)."""
    lines, bad, unknown = [], [], []
    if set_at:
        when = _dt.datetime.fromisoformat(set_at.replace("Z", "+00:00"))
        if when.tzinfo is None:  # a bare stamp is UTC, as the window's steps say to note it
            when = when.replace(tzinfo=_dt.timezone.utc)
        t = when.timestamp()
        age = (now if now is not None else time.time()) - t
        if uptime is None:
            unknown.append("no uptime")
        elif uptime < age:
            lines.append(f"NEW BOOT: uptime {uptime}s < {int(age)}s since --set-at")
        else:
            bad.append(f"NO NEW BOOT: uptime {uptime}s >= {int(age)}s since --set-at "
                       "(if ~3 min have passed: railway redeploy --service web --yes)")
    for env, w in want_on.items():
        if env not in payload_envs:
            continue
        k = payload_key(env)
        g = (me or {}).get(k)
        (unknown if g is None else (bad if g != w else lines)).append(f"payload {k} = {g!r} (want {w!r})")
    for env, status in doors.items():
        on = want_on.get(env)
        sw = next((s for s in SWITCHES if s.env == env), None)
        if sw is None or on is None:
            continue
        w = sw.door_on if on else DOOR_OFF
        (unknown if status is None else (bad if status != w else lines)).append(
            f"door {sw.door[1]} = {status} (want {w})")
    verdict = "FAIL" if bad else ("INCONCLUSIVE" if unknown else "PASS")
    return verdict, [f"VERIFY {expect.upper()}: {verdict}"] + bad + unknown + lines


# ── the read-only check (the controller's; the sandbox run exercises the same code) ──────────

class _Client:
    def __init__(self, base: str):
        self.base = base.rstrip("/")
        self.jar = http.cookiejar.CookieJar()
        self.op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))

    def call(self, method: str, path: str, body: dict | None = None) -> tuple[int | None, dict | None]:
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method=method,
                                     headers={"User-Agent": BROWSER_UA, "Content-Type": "application/json"})
        try:
            with self.op.open(req, timeout=20) as r:
                raw = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            return e.code, None
        except Exception:  # noqa: BLE001 -- unreachable is "not measured", never a status
            return None, None
        try:
            return status, json.loads(raw or b"null")
        except ValueError:
            return status, None


def _is_loopback(base: str) -> bool:
    host = base.split("//", 1)[-1].split("/", 1)[0].split(":", 1)[0]
    return host in ("127.0.0.1", "localhost", "::1")


def verify_run(base: str, expect: str, email: str, pw: str, table: dict[str, bool],
               keys: list[str], record: dict[str, str] | None, set_at: str | None,
               payload_envs: set[str] | None = None) -> tuple[str, list[str]]:
    """GET-only after the sign-in. The same function the sandbox run calls on every boot.
    `payload_envs`: the keys the auth payload carries (default: auth.NOTEBOOK_FLAGS by AST)."""
    if payload_envs is None:
        payload_envs = set(capability_table()[0])
    c = _Client(base)
    s, _ = c.call("POST", "/api/auth/login", {"email": email, "password": pw})
    if s != 200:
        return "INCONCLUSIVE", [f"VERIFY {expect.upper()}: INCONCLUSIVE -- sign-in answered {s}"]
    _s, health = c.call("GET", "/api/health")
    _s, me = c.call("GET", "/api/auth/me")
    doors = {}
    for sw in SWITCHES:
        if sw.door and sw.door[0] == "GET" and sw.env in keys:
            doors[sw.env], _ = c.call("GET", sw.door[1])
    uptime = (health or {}).get("uptime_seconds")
    return verify_verdict(expect, expected_state(expect, table, keys, record), payload_envs, me,
                          doors, uptime if isinstance(uptime, int) else None, set_at)


# ── the sandbox run ─────────────────────────────────────────────────────────────────────────

def _load(name: str, rel: str):
    spec = importlib.util.spec_from_file_location(name, REPO / rel)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


_DOC = {"type": "doc", "content": [{"type": "paragraph",
                                    "content": [{"type": "text", "text": "switch rehearsal"}]}]}


def observe(pw, base: str, email: str, out: Path, tag: str) -> dict:
    """Everything a member would see, measured the same way whatever the expected value."""
    perf = _load("perf", "tools/notebook_perf_harness.py")
    obs: dict = {"payload": {}, "doors": {}, "rendered": {}, "notes": [], "page_errors": []}
    browser = pw.chromium.launch(headless=True)
    try:
        admin = pw.request.new_context()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        perf._provision(admin, ctx.request, base, member=(email, MEMBER_PW, "w10c rehearsal"))
        me = ctx.request.get(base + "/api/auth/me").json()
        obs["payload"] = {k: v for k, v in me.items() if k.startswith(("notebook_", "j2_share"))}
        page = ctx.new_page()
        page.on("pageerror", lambda e: obs["page_errors"].append(str(e)[:200]))
        # 1. The tour, FIRST: it is for a member with no notes.
        page.goto(base + "/journal/notebook", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        try:
            page.wait_for_function("""() => [...document.querySelectorAll('button,[role=button],a')]
                .some(x => /new note|start a note|create note/i.test((x.innerText||'') + ' ' +
                (x.getAttribute('aria-label')||'')))""", timeout=30000)
            rendered_home = True
        except Exception:  # noqa: BLE001
            rendered_home = False
            obs["notes"].append("the Notebook home never rendered a new-note control")
        tour = None
        if rendered_home:
            try:
                page.wait_for_selector('[role=dialog][aria-modal=true]:has-text("Step 1 of")', timeout=15000)
                tour = True
            except Exception:  # noqa: BLE001 -- waited the same 15 s whatever was expected
                tour = False
        obs["rendered"]["tour_dialog"] = tour
        page.screenshot(path=str(out / f"{tag}-home.png"))
        if tour:
            try:
                page.get_by_role("button", name="Skip tour").click(timeout=5000)
            except Exception:  # noqa: BLE001
                page.keyboard.press("Escape")
        # 2. A note, through the app's own door; then the doors.
        r = ctx.request.post(base + "/api/j2/notes", data={"title": f"rehearsal {tag}", "bodyJson": _DOC})
        note_id = r.json()["note"]["id"] if r.status in (200, 201) else None
        if note_id is None:
            obs["notes"].append(f"creating the note answered {r.status}")
        for sw in SWITCHES:
            if not sw.door or (note_id is None and "{note}" in sw.door[1]):
                continue
            method, path, body = sw.door
            path = path.replace("{note}", note_id or "")
            resp = (ctx.request.get(base + path) if method == "GET"
                    else ctx.request.post(base + path, data=body))
            obs["doors"][sw.env] = resp.status
        # 3. The editor: writing help, the Share sheet, the offline store.
        if note_id:
            page.goto(base + f"/journal/notebook?note={note_id}", wait_until="domcontentloaded")
            perf._dismiss_intro(page)
            try:
                page.wait_for_selector(".ProseMirror", timeout=30000)
                page.wait_for_selector('button[aria-label="Version history"]', timeout=15000)
                editor_up = True
            except Exception:  # noqa: BLE001
                editor_up = False
                obs["notes"].append("the editor never mounted")
            if editor_up:
                page.wait_for_timeout(1500)
                obs["rendered"]["writing_help_button"] = page.locator(
                    'button[aria-label="Writing help"]').count() > 0
                share_btn = page.locator('button[aria-haspopup="dialog"]', has_text="Share")
                if share_btn.count() == 0:
                    obs["rendered"]["share_heading"] = False
                    obs["rendered"]["publish_heading"] = False
                else:
                    share_btn.first.click()
                    try:
                        page.wait_for_selector('[role=dialog][aria-label="Share this note"]', timeout=10000)
                        page.wait_for_function("""() => !document.querySelector(
                            '[role=dialog][aria-label="Share this note"] [role=status]')
                            || !/Loading/.test(document.querySelector(
                            '[role=dialog][aria-label="Share this note"] [role=status]').innerText)""",
                                               timeout=15000)
                        sheet = page.locator('[role=dialog][aria-label="Share this note"]')
                        obs["rendered"]["share_heading"] = sheet.locator("h3", has_text="Share link").count() > 0
                        obs["rendered"]["publish_heading"] = sheet.locator(
                            "h3", has_text="Publish to the web").count() > 0
                        page.screenshot(path=str(out / f"{tag}-share.png"))
                    except Exception:  # noqa: BLE001
                        obs["notes"].append("the Share sheet did not open or never finished loading")
                    page.keyboard.press("Escape")
                    page.wait_for_timeout(500)
                pm = page.locator(".ProseMirror").first
                pm.click()
                page.keyboard.press("Control+End")
                page.keyboard.type(" typed")
                page.wait_for_timeout(4000)
                names = page.evaluate("async () => (await indexedDB.databases()).map(d => d.name)")
                obs["idb"] = names
                obs["rendered"]["offline_store"] = any(str(n).startswith("uct_notebook_") for n in names)
                page.screenshot(path=str(out / f"{tag}-editor.png"))
        # 4. Settings > Connections: the Personal API card, a ROUTE gate's surface. It renders
        #    nothing while dark, so a sibling card is the control that the section rendered.
        page.goto(base + "/settings?section=connections", wait_until="domcontentloaded")
        perf._dismiss_intro(page)
        try:
            page.wait_for_selector('[role=region][aria-label="Brokerage Connections"]', timeout=30000)
            try:
                page.wait_for_selector('[role=region][aria-label="Personal API"]', timeout=10000)
                obs["rendered"]["personal_api_card"] = True
            except Exception:  # noqa: BLE001 -- waited the same 10 s whatever was expected
                obs["rendered"]["personal_api_card"] = False
            page.screenshot(path=str(out / f"{tag}-settings.png"))
        except Exception:  # noqa: BLE001
            obs["notes"].append("Settings > Connections never rendered")
        ctx.close()
        admin.dispose()
    finally:
        browser.close()
    return obs


LAUNCHER = REPO / "scripts" / "hub_sandbox_boot.py"


def launcher_source(values: dict[str, str | None], real: Path = LAUNCHER) -> str:
    """A boot's own launcher: set the switch values in THIS process (the sandbox child),
    then run the real launcher unchanged. Pure, so a rail reads exactly what a boot runs."""
    set_ = {k: v for k, v in values.items() if v is not None}
    unset = sorted(k for k, v in values.items() if v is None)
    return (
        '"""Generated by tools/notebook_switch_rehearsal.py: one boot\'s switch values, then the\n'
        'real sandbox launcher, unchanged."""\n'
        "import os\nimport runpy\nimport sys\n\n"
        f"SET = {json.dumps(set_, sort_keys=True)}\n"
        f"UNSET = {json.dumps(unset)}\n"
        f"REAL = {json.dumps(str(real))}\n"
        "for _k, _v in SET.items():\n    os.environ[_k] = _v\n"
        "for _k in UNSET:\n    os.environ.pop(_k, None)\n"
        "sys.argv[0] = REAL\n"
        "runpy.run_path(REAL, run_name='__main__')\n")


def boot_launcher(out: Path, name: str, values: dict[str, str | None]) -> Path:
    p = out / f"{name}.launcher.py"
    p.write_text(launcher_source(values), encoding="utf-8")
    return p


def run(data_dir: str, port: int, out: Path, only: list[str] | None = None) -> int:
    perf = _load("perf", "tools/notebook_perf_harness.py")
    sys.path.insert(0, str(REPO / "scripts"))
    import sandbox_identity as sid
    why = perf.refuse_shared_root(data_dir)
    if why:
        print(f"SANDBOX INTEGRITY: NOT RUN (refused: {why})")
        return 3
    if perf.port_busy(port):
        print(f"SANDBOX INTEGRITY: NOT RUN (port {port} is busy; nothing was killed)")
        return 3
    from playwright.sync_api import sync_playwright
    payload_table, _modes = capability_table()
    table = rehearsal_table(payload_table)
    armed = armed_on_web(table, ledger_flags())
    plan = [b for b in boot_plan(table, armed) if not only or b[0] in only]
    out.mkdir(parents=True, exist_ok=True)
    base = f"http://127.0.0.1:{port}"
    stamp = time.strftime("%Y%m%dT%H%M%S")
    boots = []
    raw_path = out / "switch-rehearsal-raw.json"
    for i, (name, values) in enumerate(plan, 1):
        print(f"[boot {i}/{len(plan)}] {name}: " + ", ".join(f"{k}={v if v is not None else '(unset)'}"
                                                         for k, v in values.items()), flush=True)
        # The switch values are set IN THE CHILD, by this boot's own launcher, never in this
        # process's environment (tests/test_notebook_bridges_pin_the_root.py: a tool that imports
        # api writes no environment of its own). perf.BOOT_SCRIPT is read at call time for this.
        perf.BOOT_SCRIPT = boot_launcher(out, name, values)
        sb = perf.Sandbox(data_dir, port, out / f"{name}.console.log")
        sb.start()
        rec: dict = {"boot": name, "values": values, "started": time.strftime("%Y-%m-%dT%H:%M:%S")}
        try:
            if not sb.wait_healthy(base, 240):
                rec["not_run"] = "the sandbox never answered /api/health"
            else:
                ver = sid.verify(base, sb.integrity_path() or "")
                rec["identity"] = ver.sentence
                if not ver.ok:
                    rec["not_run"] = "sandbox identity NOT PROVEN -- nothing was written"
                else:
                    sb.wait_checkpoint(perf.POST_BOOT, perf.POST_BOOT_WAIT_S)
                    email = f"w10c-rh-{i}-{stamp.lower()}@local.dev"
                    with sync_playwright() as pw:
                        rec["obs"] = observe(pw, base, email, out, name)
                    keys = [k for k in values]
                    expect = "off" if name == "all-off" else "on"
                    record = {k: v for k, v in values.items() if v is not None}
                    rec["verify"] = verify_run(base, expect, email, MEMBER_PW, table, keys, record, None,
                                               payload_envs=set(payload_table))
                    rec["rows"] = judge(values, rec["obs"], table)
            sb.wait_checkpoint(perf.PREWARM, perf.PREWARM_WAIT_S)
        except Exception as e:  # noqa: BLE001 -- recorded, and the sandbox is still stopped below
            rec["not_run"] = f"{type(e).__name__}: {e}"[:300]
        finally:
            how = sb.stop()
            integ = perf.read_integrity(sb.integrity_path(),
                                        [perf.PRE_BOOT, perf.POST_BOOT, perf.PREWARM, perf.SHUTDOWN])
            log = sb.integrity_path()
            if log and Path(log).is_file():  # this boot's own log: kept beside its evidence
                dest = out / f"{name}.integrity.md"
                shutil.move(log, dest)
                integ["path"] = str(dest.relative_to(REPO)) if dest.is_relative_to(REPO) else str(dest)
            rec["integrity"] = perf.integrity_line(integ, note=f"stop: {how}", not_run=rec.get("not_run"))
            rec["integrity_clean"] = bool(integ["clean"])
            boots.append({"integrity": rec.pop("integrity"), **rec})
            # R-RAW: the raw record is on disk before any summary is computed.
            raw_path.write_text(json.dumps(boots, indent=2, default=str), encoding="utf-8")
            print("  " + boots[-1]["integrity"], flush=True)
            for row in boots[-1].get("rows", []):
                print(f"  {row['verdict']:<12} {row['switch']:<32} {row['why']}", flush=True)
            if "verify" in boots[-1]:
                print("  " + boots[-1]["verify"][1][0], flush=True)
    summary = summarize(boots)
    (out / "switch-rehearsal-summary.md").write_text(summary, encoding="utf-8")
    print(summary)
    head = summary.splitlines()[1] if len(summary.splitlines()) > 1 else ""
    return {"PASS": 0, "FAIL": 1}.get(head.split(":", 1)[-1].strip().split(" ")[0], 2)


def summarize(boots: list[dict]) -> str:
    clean = all(b.get("integrity_clean") for b in boots) and bool(boots)
    lines = [f"SANDBOX INTEGRITY: {'CLEAN' if clean else 'NOT CLEAN or INCOMPLETE'} across "
             f"{len(boots)} boot(s) -- each boot's line is below"]
    verdicts = []
    for b in boots:
        rows = b.get("rows") or []
        v = overall([r["verdict"] for r in rows]) if rows and not b.get("not_run") else "INCONCLUSIVE"
        if not b.get("integrity_clean"):
            v = "INCONCLUSIVE" if v == "PASS" else v
        vv = (b.get("verify") or ["INCONCLUSIVE"])[0]
        verdicts += [v, vv]
    lines.append(f"REHEARSAL: {overall(verdicts)} ({len(boots)} boots, a restart per value)")
    lines.append("")
    lines.append("| boot | integrity | switches | verify (the controller's check) |")
    lines.append("|---|---|---|---|")
    for b in boots:
        rows = b.get("rows") or []
        cell = ", ".join(f"{r['switch']} {r['verdict']}" for r in rows) or b.get("not_run", "not run")
        integ = "CLEAN" if b.get("integrity_clean") else "NOT CLEAN/INCOMPLETE"
        lines.append(f"| {b['boot']} | {integ} | {cell} | {(b.get('verify') or ['-', ['-']])[1][0]} |")
    return "\n".join(lines) + "\n"


# ── the production window (printed, never run) ──────────────────────────────────────────────

#: Where step 0 writes the record: the operator's TEMP, never the checkout (the review found the
#: old `> notebook-switch-record-<UTC>.txt` wrote EVERY web secret into a public repo's working
#: tree, not gitignored). PowerShell spelling, the shell this window runs in.
RECORD_PATH = r"$env:TEMP\notebook-switch-record-<UTC>.txt"


def save_record(record: dict[str, str], table: dict[str, bool], dest: Path) -> list[str]:
    """Write ONLY the window's Notebook keys to `dest`, which must be outside the repository.
    -> the names written. Raises ValueError for a path inside the repository."""
    target = Path(dest).resolve()
    try:
        target.relative_to(REPO.resolve())
    except ValueError:
        pass
    else:
        raise ValueError(f"{target} is inside the repository -- the record goes outside the checkout")
    names = sorted(k for k in record if k in table)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text("".join(f"{k}={record[k]}\n" for k in names), encoding="utf-8")
    return names


def production_text(table: dict[str, bool], modes: list[str], armed: list[str]) -> str:
    keys = off_set(table, None, armed)
    t = "tools/notebook_switch_rehearsal.py"
    n_keys = len(table)
    skipped = "\n".join(f"  {k}: {why}" for k, why in not_rehearsed(table, modes).items()
                        if k not in keys)
    # the doors --verify reads, from the same table it reads them from (never a typed list)
    get_doors = ", ".join(s.door[1] for s in SWITCHES if s.door and s.door[0] == "GET")
    return f"""PRODUCTION WINDOW -- R-11, the controller's half. ONE off-hours window (weekend), two web
redeploys (82-119 s /api/* blip each, docs/runbooks/deploy-windows.md). Nothing here was run by lane
10C. Each step in its own call; read each result before the next (H15: a failing verify after the
RESTORE is answered by re-running the restore, then reporting -- never by diagnosing first).

0. RECORD (read-only; never restarts). ONLY the Notebook keys reach disk, and OUTSIDE the checkout:
     railway variables --service web --kv | python {t} --check-record - --save-record "{RECORD_PATH}"
   The full --kv output (every secret on web) passes through the pipe into memory and nowhere
   else; the tool keeps the {n_keys} Notebook keys by name ({', '.join(sorted(table))}) and REFUSES a
   --save-record path inside the repository. It prints the exact OFF command and the exact RESTORE
   from what production HOLDS -- the record outranks the ledger. The ledger today predicts this OFF set:
     {', '.join(keys)}
   and NOTEBOOK_DOOR_GUARD (a MODE, never turned off here) is printed for the owner's intent question:
   the ledger measured `unknown-only` on web 2026-09-24 and records no intent (feature_flags.json).

1. OFF -- ONE command (repeated --set; `railway variables --help` first if the CLI version changed):
     {off_command(keys)}
   Note the UTC time as SET_OFF_AT.

2. VERIFY OFF (GET-only as the smoke account; SMOKE_EMAIL / SMOKE_PASSWORD in the environment):
     python {t} --verify {PROD} --expect off --set-at <SET_OFF_AT>
   PASS needs: a NEW BOOT (uptime < time since SET_OFF_AT), every payload key above false, and
   every GET door of a switched gate 404: {get_doors}. No new boot within ~3 min:
     railway redeploy --service web --yes     then re-run step 2.

3. RESTORE -- exactly what `--check-record` printed: deletes FIRST (a delete stages, it does not
   redeploy), then ONE --set (its redeploy boots with both). Note the UTC time as SET_ON_AT.

4. VERIFY RESTORED:
     python {t} --verify {PROD} --expect on --recorded "{RECORD_PATH}" --set-at <SET_ON_AT>

5. LEDGER, same docs push: each key's note in docs/feature_flags.json gets
   "rehearsed OFF <SET_OFF_AT> .. restored <SET_ON_AT> (wave 10, R-11)".

6. DELETE THE RECORD (it names production's Notebook values; nothing else needs it):
     Remove-Item "{RECORD_PATH}"

NOT switched in this window, each with its reason (the repo's gate index, never a typed list):
{skipped}
"""


def check_record_text(record: dict[str, str], table: dict[str, bool], modes: list[str],
                      armed: list[str], ledger: dict) -> str:
    keys = off_set(table, record, armed)
    lines = ["RECORD READ -- Notebook keys as production holds them:"]
    for env in list(table) + modes:
        held = record.get(env, "(unset)")
        note = ""
        if env in table and not table[env]:
            on = parse_value(record.get(env), False)
            status = (ledger.get(env) or {}).get("status")
            if on != (env in armed):
                note = f"  <- the ledger says {status!r}; the RECORD wins, and the ledger note is owed"
        lines.append(f"  {env} = {held}{note}")
    lines += ["", "Not switched by the window (read for the record):"]
    lines += [f"  {k} = {record.get(k, '(unset)')}  -- {why}"
              for k, why in not_rehearsed(table, modes).items()
              if k not in keys and k not in table and k not in modes]
    lines += ["", "OFF (step 1), ONE command:", "  " + off_command(keys), "",
              "RESTORE (step 3), in this order:"]
    lines += ["  " + s for s in restore_steps(keys, record)]
    return "\n".join(lines) + "\n"


# ── self-check ──────────────────────────────────────────────────────────────────────────────

def self_check() -> int:
    table, modes = capability_table()
    ok = True

    def say(cond: bool, what: str) -> None:
        nonlocal ok
        ok = ok and cond
        print(("PASS " if cond else "FAIL ") + what)

    say(len(table) >= 5 and "NOTEBOOK_OFFLINE_DEFAULT_ON" in table, f"the table was read ({len(table)} keys)")
    say(all(s.env in table for s in SWITCHES if s.payload), "every payload switch is a row of NOTEBOOK_FLAGS")
    route = [s.env for s in SWITCHES if not s.payload]
    say(set(route) <= set(notebook_gates_in_index()), f"every route switch is a gate the index finds {route}")
    table = rehearsal_table(table)
    on = {s.env: switch_value(s.env, table, True) for s in SWITCHES}
    good = {"payload": {payload_key(s.env): True for s in SWITCHES},
            "rendered": {s.rendered: True for s in SWITCHES},
            "doors": {s.env: s.door_on for s in SWITCHES if s.door}}
    say(overall([r["verdict"] for r in judge(on, good, table)]) == "PASS", "a truthful observation passes")
    bad = json.loads(json.dumps(good))
    bad["doors"]["J2_SHARE_LINKS_ENABLED"] = 404
    say(overall([r["verdict"] for r in judge(on, bad, table)]) == "FAIL", "a door that disagrees FAILS")
    bad2 = json.loads(json.dumps(good))
    bad2["rendered"]["tour_dialog"] = None
    say(overall([r["verdict"] for r in judge(on, bad2, table)]) == "INCONCLUSIVE",
        "an unmeasured surface is INCONCLUSIVE, never a pass")
    rec = {"J2_SHARE_LINKS_ENABLED": "1", "NOTEBOOK_PUBLISH_ENABLED": "1"}
    steps = restore_steps(["NOTEBOOK_OFFLINE_DEFAULT_ON", "J2_SHARE_LINKS_ENABLED"], rec)
    say(steps[0].startswith("railway variable delete NOTEBOOK_OFFLINE_DEFAULT_ON")
        and '--set "J2_SHARE_LINKS_ENABLED=1"' in steps[-1], "the restore deletes first, then ONE --set")
    print("self-check:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", action="store_true")
    ap.add_argument("--data-dir", default=DATA_DEFAULT)
    ap.add_argument("--port", type=int, default=PORT_DEFAULT)
    ap.add_argument("--out", default="docs/notebook/evidence/wave10-10c/switch-rehearsal")
    ap.add_argument("--only", default="", help="comma-separated boot names (default: every boot)")
    ap.add_argument("--print-production", action="store_true")
    ap.add_argument("--check-record", default="", help="a recorded --kv file, or - for stdin")
    ap.add_argument("--save-record", default="",
                    help="with --check-record: write ONLY the Notebook keys here (outside the repository)")
    ap.add_argument("--verify", default="")
    ap.add_argument("--expect", choices=("off", "on"), default="off")
    ap.add_argument("--recorded", default="")
    ap.add_argument("--set-at", default="")
    ap.add_argument("--self-check", action="store_true")
    args = ap.parse_args(argv)
    payload_table, modes = capability_table()
    table = rehearsal_table(payload_table)
    ledger = ledger_flags()
    armed = armed_on_web(table, ledger)
    if args.self_check:
        return self_check()
    if args.print_production:
        print(production_text(table, modes, armed))
        return 0
    if args.check_record:
        text = (sys.stdin.read() if args.check_record == "-"
                else Path(args.check_record).read_text(encoding="utf-8", errors="replace"))
        record = read_record(text)
        del text  # the full --kv output, every secret on web: held in memory, dropped here
        if not record:
            print("REFUSED: the record holds no KEY=VALUE lines -- an empty read is a failed read")
            return 3
        if args.save_record:
            try:
                names = save_record(record, table, Path(args.save_record))
            except ValueError as e:
                print(f"REFUSED: {e}")
                return 3
            print(f"record saved: {len(names)} Notebook key(s) -> {args.save_record} "
                  "(delete it after step 4)")
        print(check_record_text(record, table, modes, armed, ledger))
        return 0
    if args.verify:
        base = args.verify.rstrip("/")
        if _is_loopback(base):
            email = os.environ.get("W10C_VERIFY_EMAIL") or os.environ.get("SMOKE_EMAIL")
            pw = os.environ.get("W10C_VERIFY_PASSWORD") or os.environ.get("SMOKE_PASSWORD")
        else:
            # ⛔ The ONLY account an automated tool may sign in as on production (CLAUDE.md).
            email, pw = os.environ.get("SMOKE_EMAIL"), os.environ.get("SMOKE_PASSWORD")
            if not (email or "").endswith("@uctintelligence.internal"):
                print("REFUSED: production is verified as the smoke account only "
                      "(SMOKE_EMAIL @uctintelligence.internal)")
                return 3
        if not (email and pw):
            print("REFUSED: no credentials in the environment")
            return 3
        record = (read_record(Path(args.recorded).read_text(encoding="utf-8", errors="replace"))
                  if args.recorded else None)
        keys = off_set(table, record, armed)
        verdict, lines = verify_run(base, args.expect, email, pw, table, keys, record, args.set_at or None,
                                    payload_envs=set(payload_table))
        print("\n".join(lines))
        return {"PASS": 0, "FAIL": 1}.get(verdict, 2)
    if args.run:
        only = [x for x in args.only.split(",") if x]
        return run(args.data_dir, args.port, (REPO / args.out) if not Path(args.out).is_absolute()
                   else Path(args.out), only or None)
    ap.print_help()
    return 3


if __name__ == "__main__":
    sys.exit(main())
