"""Plain-English authoring, end to end: request -> model patch -> engine -> compute
-> save -> reload -> edit -> grade. Design: docs/indicators/E2E-EVAL-DESIGN-2026-11-02.md
(Indicators docs branch).

    python tools/converse_eval.py                       # --offline (default): $0, scripted model
    python tools/converse_eval.py --corpus <path>       # + the 32-phrase corpus (refused pins run offline)
    python tools/converse_eval.py --live --spend-authorized --max-usd 40 [--repeats 3]

⛔⛔ MONEY. ``--offline`` (the default) never constructs a model client: the
product's client factory (``api.services.engine._get_anthropic_client``) is
replaced by a SCRIPTED client that answers from
``tests/fixtures/authoring/converse_eval_scripted.json``, and every model-provider
key is BLANKED in this process before anything from ``api`` is imported
(``hub_sandbox_boot.apply_model_key_policy``). ``--live`` REFUSES (exit 2, nothing
imported, nothing created) unless ALL THREE hold: ``--spend-authorized``, a finite
``--max-usd`` > 0, and ``ANTHROPIC_API_KEY`` present in the environment. The key's
VALUE is never read by this file except to redact it from what it writes.
Credentials: docs/indicators/E2E-EVAL-CREDENTIALS.md. A live run needs a separate
owner spend approval.

⛔ SANDBOX. Every census path (``conftest.shared_data_root_census``, derived by AST,
never typed) is pinned into a sandbox directory BEFORE anything from ``api`` is
imported -- the same ``hub_sandbox_boot.apply_sandbox_env`` the hub sandbox uses,
which also arms the shared-root tripwire and blanks every outbound channel. The run
REFUSES when the sandbox or the out dir is the shared root (``C:\\data`` / ``/data``)
in any spelling ``scripts/shared_root_guard.py`` knows, and again when any pinned
census path still resolves inside it.

WHAT IS REAL. The server half is ``definition_conversation.converse`` (the function
the ``/converse`` route calls, admin allowance), spend recorded by the product's own
``cost_guard`` into the SANDBOX ledger; saving is ``user_definitions.save`` / ``get``.
The browser half runs the SHIPPED modules in node (``tools/converse_eval_lane.mjs``,
bundled with the esbuild in ``app/node_modules``): ``localTurn`` / ``modelTurn``
(the authoring session), ``converseTurn`` (normalising the real server body),
``applyTurn`` / ``prepareSave`` / ``openAuthoringState``, and the chart compute
``validateUserDefinitions`` -> ``computeFor`` on fixed SYNTHETIC bars.

WHAT IS NOT (stated, not hidden): design step 4 paints a real ``StockChart`` and
step 6 is a real page reload. Neither runs here -- there is no browser. Step 4 is
graded on the computed columns plus the stored presentation (the marker / paint the
chart draws from), and step 6 is a store ``get`` re-opened into a FRESH engine state
and re-computed. The FastAPI route wrapper (auth, hourly window) is not exercised.

R-RAW: every turn's raw record is appended (and fsync'd) to ``records.jsonl`` before
any summary exists. Exit codes: 0 PASS, 1 a gate FAILED, 2 refused (preconditions /
sandbox), 3 STOPPED at the spend cap (incomplete), 4 the JS lane is unavailable.
The VERDICT line is the last thing printed.
"""
from __future__ import annotations

import argparse
import datetime as _dt
import io
import json
import math
import os
import statistics
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "app"
LANE_SOURCE = ROOT / "tools" / "converse_eval_lane.mjs"
DEFAULT_CASES = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_cases.json"
DEFAULT_SCRIPT = ROOT / "tests" / "fixtures" / "authoring" / "converse_eval_scripted.json"
DEFAULT_CORPUS = ROOT / "tests" / "fixtures" / "authoring" / "plain_english_chart_door.json"

#: The only key a live run may use. Its VALUE is read solely to redact it.
KEY_ENV = "ANTHROPIC_API_KEY"
EVAL_USER = "converse-eval-admin"
EVAL_EMAIL = "converse-eval@local.dev"

EXIT_PASS, EXIT_FAIL, EXIT_REFUSED, EXIT_STOPPED, EXIT_LANE = 0, 1, 2, 3, 4

#: The design's pass gates (E2E-EVAL-DESIGN §"Repeats and pass gates").
GATES = {
    "examples_all_runs": 1.0,
    "corpus_min_rate": 0.90,
    "controls_rate": 1.0,
    "first_pass_min_rate": 0.70,
    "median_usd_per_turn_max": 0.12,
    "p95_latency_s_max": 20.0,
}
REL_TOL = 1e-9

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace", line_buffering=True)


class Refused(Exception):
    """The run must not start. Raised BEFORE anything is imported or created."""


class LaneUnavailable(Exception):
    """The JS lane could not be built or answered nonsense: never a zero result."""


class CapReached(Exception):
    """The sandbox ledger reached --max-usd: stop, report incomplete."""


# --------------------------------------------------------------------------- #
# secrets: redaction is belt-and-braces; nothing here ever writes the key
# --------------------------------------------------------------------------- #

_SECRETS: List[str] = []


def _remember_secrets(environ: Dict[str, str]) -> None:
    v = environ.get(KEY_ENV) or ""
    if len(v) >= 8 and v not in _SECRETS:
        _SECRETS.append(v)


def redact(text: str) -> str:
    for s in _SECRETS:
        if s and s in text:
            text = text.replace(s, "[REDACTED]")
    return text


def say(line: str = "") -> None:
    print(redact(line), flush=True)


# --------------------------------------------------------------------------- #
# preconditions (stdlib only -- nothing from `api`, nothing created)
# --------------------------------------------------------------------------- #

def live_problems(args: argparse.Namespace, environ: Dict[str, str]) -> List[str]:
    """Every reason a --live run may NOT start. Empty means it may."""
    problems = []
    if not args.spend_authorized:
        problems.append("--spend-authorized was not given (a live run needs a separate owner spend approval)")
    cap = args.max_usd
    if cap is None:
        problems.append("--max-usd was not given (a live run needs a hard dollar cap)")
    elif not (isinstance(cap, float) and math.isfinite(cap) and cap > 0):
        problems.append("--max-usd must be a finite amount greater than 0")
    if not (environ.get(KEY_ENV) or "").strip():
        problems.append(f"{KEY_ENV} is not set in this environment "
                        "(see docs/indicators/E2E-EVAL-CREDENTIALS.md)")
    return problems


def _guard():
    here = str(ROOT / "scripts")
    if here not in sys.path:
        sys.path.insert(0, here)
    import shared_root_guard
    return shared_root_guard


def refuse_shared_root(label: str, path: Path, roots=None) -> None:
    why = _guard().refuse(str(path), roots=roots)
    if why:
        raise Refused(f"{label}: {why} -- the shared data root holds live member data")


def make_live_client():
    """THE ONE place a real model client is constructed (the product's own factory).
    Called only by a --live run that passed every precondition."""
    from api.services.engine import _get_anthropic_client
    return _get_anthropic_client()


# --------------------------------------------------------------------------- #
# sandbox
# --------------------------------------------------------------------------- #

def enter_sandbox(sandbox: Path, *, live: bool, cap_usd: Optional[float]) -> Dict[str, str]:
    """Pin every census path into `sandbox`, arm the tripwire, blank outbound channels
    (and, offline, every model key). Returns the pins. MUST run before `api` imports."""
    already = [m for m in sys.modules if m == "api" or m.startswith("api.")]
    if already:
        raise Refused(f"api modules were imported before the sandbox was entered: {already[:5]}")
    refuse_shared_root("--sandbox", sandbox)
    scripts = str(ROOT / "scripts")
    for p in (str(ROOT), scripts):
        if p not in sys.path:
            sys.path.insert(0, p)
    # conftest's two temp dirs are THIS process's own unless we are inside a pytest session
    reclaim = "_pytest" not in sys.modules
    try:
        import pytest  # noqa: F401 -- conftest (the census + the tripwire) needs it
    except ImportError as exc:
        raise Refused("pytest is not importable, so the census (conftest.py) cannot run: use the repo "
                      "venv, e.g. C:/UCT/agent/.venv/Scripts/python.exe tools/converse_eval.py") from exc
    import hub_sandbox_boot
    pins = hub_sandbox_boot.apply_sandbox_env(
        str(sandbox), test_email=EVAL_EMAIL,
        reclaim_conftest_temp=reclaim, allow_model_keys=live)
    import conftest
    leaked = [m for m in sys.modules if m == "api" or m.startswith("api.")]
    if leaked:
        raise Refused(f"entering the sandbox imported api modules (they captured pre-pin paths): {leaked[:5]}")
    verify_pins(pins, conftest.SHARED_DATA_ROOTS)
    for var in conftest.SHARED_DATA_ENV_PINS:
        verify_pins({var: os.environ.get(var, "")}, conftest.SHARED_DATA_ROOTS)
    # The product's own caps carry the run's cap (admin allowance = max(member, admin)).
    cap = cap_usd if cap_usd is not None else 1000.0
    os.environ["CONVERSE_USER_CAP_DAILY"] = repr(float(cap))
    os.environ["CONVERSE_ADMIN_CAP_DAILY"] = repr(float(cap))
    return pins


def verify_pins(pins: Dict[str, str], roots) -> None:
    """Refuse when any pinned path still resolves inside the shared root."""
    bad = []
    for var, value in pins.items():
        if not value:
            bad.append(f"{var} is empty")
            continue
        why = _guard().refuse(value, roots=roots)
        if why:
            bad.append(f"{var} -> {why}")
    if bad:
        raise Refused("census path(s) resolve into the shared data root: " + "; ".join(bad[:8]))


# --------------------------------------------------------------------------- #
# synthetic bars -- deterministic, never market data
# --------------------------------------------------------------------------- #

def synthetic_bars(n: int = 360) -> List[dict]:
    """A fixed, made-up daily series: two sines and a drift plus an LCG wobble, so
    moving averages cross many times. No real symbol, no real price."""
    seed = 1234567
    day = _dt.date(2021, 1, 4)
    bars = []
    prev = 100.0
    for i in range(n):
        seed = (1103515245 * seed + 12345) % (2 ** 31)
        wobble = (seed / 2 ** 31 - 0.5) * 1.6
        close = 100.0 + 9.0 * math.sin(i / 7.0) + 5.0 * math.sin(i / 19.0) + 0.04 * i + wobble
        open_ = prev
        high = max(open_, close) + 0.6 + abs(wobble) * 0.5
        low = min(open_, close) - 0.6 - abs(wobble) * 0.5
        vol = int(1_000_000 + 250_000 * math.sin(i / 5.0) + 40_000 * wobble)
        while day.weekday() >= 5:
            day += _dt.timedelta(days=1)
        bars.append({"t": day.isoformat(), "o": round(open_, 4), "h": round(high, 4),
                     "l": round(low, 4), "c": round(close, 4), "v": vol})
        day += _dt.timedelta(days=1)
        prev = close
    return bars


# --------------------------------------------------------------------------- #
# the JS lane (node, the shipped modules)
# --------------------------------------------------------------------------- #

_BUILD = r"""
import { pathToFileURL } from 'node:url'
const [esbuildPath, entry, outfile, appDir] = process.argv.slice(2)
const esbuild = await import(pathToFileURL(esbuildPath).href)
await esbuild.build({
  entryPoints: [entry], outfile, bundle: true, platform: 'node', format: 'esm', target: 'node20',
  absWorkingDir: appDir, logLevel: 'error',
  loader: { '.js': 'jsx', '.jsx': 'jsx', '.css': 'empty', '.png': 'empty', '.svg': 'empty', '.woff2': 'empty' },
  jsx: 'automatic',
  define: { 'import.meta.env': JSON.stringify({ MODE: 'production', DEV: false, PROD: true, SSR: false, BASE_URL: '/' }) },
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})
"""


def _node() -> str:
    return os.environ.get("NODE_BIN", "node")


class Lane:
    """One persistent node process over the bundled lane; JSON lines both ways."""

    def __init__(self, workdir: Path) -> None:
        self.workdir = workdir
        self.proc: Optional[subprocess.Popen] = None

    def start(self) -> None:
        esbuild = APP / "node_modules" / "esbuild" / "lib" / "main.js"
        if not esbuild.exists():
            raise LaneUnavailable(f"esbuild not found at {esbuild} (app/node_modules missing?)")
        self.workdir.mkdir(parents=True, exist_ok=True)
        build = self.workdir / "build_lane.mjs"
        bundle = self.workdir / "converse_eval_lane.bundle.mjs"
        with io.open(build, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(_BUILD)
        proc = subprocess.run([_node(), str(build), str(esbuild), str(LANE_SOURCE), str(bundle), str(APP)],
                              capture_output=True, text=True, encoding="utf-8", errors="replace",
                              timeout=300)
        if proc.returncode != 0 or not bundle.exists():
            raise LaneUnavailable(f"bundling the lane failed ({proc.returncode}): "
                                  f"{(proc.stderr or proc.stdout)[-2000:]}")
        # stderr goes to a FILE: an undrained pipe would block the lane on its first long warning
        self.stderr_path = self.workdir / "lane.stderr.log"
        self._stderr = io.open(self.stderr_path, "w", encoding="utf-8")
        self.proc = subprocess.Popen([_node(), str(bundle)], cwd=str(self.workdir),
                                     stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                     stderr=self._stderr, text=True, encoding="utf-8",
                                     errors="replace", bufsize=1)
        if not self.call("ping").get("pong"):
            raise LaneUnavailable("the lane did not answer ping")

    def call(self, cmd: str, **kw) -> Dict[str, Any]:
        if self.proc is None or self.proc.poll() is not None:
            raise LaneUnavailable(f"the lane process is not running: {self._tail()}")
        self.proc.stdin.write(json.dumps({"cmd": cmd, **kw}) + "\n")
        self.proc.stdin.flush()
        line = self.proc.stdout.readline()
        if not line:
            raise LaneUnavailable(f"the lane closed its output on {cmd!r}: {self._tail()}")
        doc = json.loads(line)
        if not doc.get("ok"):
            raise LaneUnavailable(f"the lane refused {cmd!r}: {doc.get('error')}")
        return doc

    def _tail(self) -> str:
        try:
            return io.open(self.stderr_path, encoding="utf-8", errors="replace").read()[-2000:]
        except OSError:
            return ""

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.close()
                self.proc.wait(timeout=10)
            except Exception:                              # noqa: BLE001
                self.proc.kill()
        if getattr(self, "_stderr", None):
            self._stderr.close()


# --------------------------------------------------------------------------- #
# the scripted model (offline)
# --------------------------------------------------------------------------- #

class _B:
    def __init__(self, **kw):
        self.__dict__.update(kw)


class ScriptedClient:
    """Answers from the scripted envelope list armed for the current turn. A call with
    nothing armed is RECORDED as unexpected and raises (the product turns it into a
    `model:transport` refusal) -- so a turn that must not reach the model is graded on
    `unexpected`, never on the refusal it happens to produce."""

    def __init__(self, usage: Dict[str, int]) -> None:
        self.messages = self
        self.armed: List[dict] = []
        self.calls = 0
        self.unexpected = 0
        self.usage = usage

    def arm(self, envelopes: List[dict]) -> None:
        self.armed = list(envelopes)
        self.calls = 0
        self.unexpected = 0

    def with_options(self, **_):
        return self

    def create(self, **_kw):
        self.calls += 1
        if not self.armed:
            self.unexpected += 1
            raise RuntimeError("scripted model: no answer armed for this call")
        from api.services import definition_conversation as conv
        env = self.armed.pop(0)
        return _B(content=[_B(type="tool_use", id=f"tu_{self.calls}", name=conv.TOOL_NAME, input=env)],
                  stop_reason="tool_use",
                  usage=_B(input_tokens=int(self.usage.get("input_tokens", 0)),
                           output_tokens=int(self.usage.get("output_tokens", 0)),
                           cache_read_input_tokens=0, cache_creation_input_tokens=0))


# --------------------------------------------------------------------------- #
# grading helpers
# --------------------------------------------------------------------------- #

def columns_equal(a: List[Any], b: List[Any]) -> bool:
    if len(a) != len(b) or not a:
        return False
    for x, y in zip(a, b):
        if x is None or y is None:
            if x is not y:
                return False
            continue
        if not math.isclose(float(x), float(y), rel_tol=REL_TOL, abs_tol=1e-12):
            return False
    return True


def truthy_bars(col: List[Any]) -> int:
    return sum(1 for v in col if v not in (None, 0, 0.0))


def match_outputs(ref: Dict[str, Any], got: Dict[str, Any]) -> Tuple[bool, List[dict]]:
    """Each reference output to a DISTINCT produced output: hash-equal first, else
    value-equal on every bar, else fail. Returns (ok, per-reference detail)."""
    used = set()
    detail = []
    ok = True
    for rkey, rhash in ref["hashes"].items():
        rcol = ref["columns"].get(rkey)
        how, which = None, None
        for gkey, ghash in got["hashes"].items():
            if gkey not in used and rhash and ghash == rhash:
                how, which = "hash", gkey
                break
        if how is None and rcol is not None:
            for gkey in got["hashes"]:
                gcol = got["columns"].get(gkey)
                if gkey not in used and gcol is not None and columns_equal(rcol, gcol):
                    how, which = "value", gkey
                    break
        if how is None:
            ok = False
        else:
            used.add(which)
        detail.append({"reference": rkey, "match": how or "FAIL", "output": which})
    return ok, detail


def colour_family(hexstr: Any) -> Optional[str]:
    s = str(hexstr or "").strip().lower()
    if s.startswith("#") and len(s) >= 7:
        try:
            r, g, b = int(s[1:3], 16), int(s[3:5], 16), int(s[5:7], 16)
        except ValueError:
            return None
    elif s.startswith("rgb"):
        try:
            parts = [float(p) for p in s[s.index("(") + 1:s.index(")")].split(",")[:3]]
            r, g, b = parts
        except ValueError:
            return None
    else:
        return None
    top = max(r, g, b)
    if top == g and g > r and g > b:
        return "green"
    if top == b and b > r and b > g:
        return "blue"
    if top == r and r > g and r > b:
        return "red"
    return "other"


def presentation_of(defn: Optional[dict]) -> Dict[str, Any]:
    """What the chart draws from, beyond the maths: markers and paints."""
    if not defn:
        return {"markers": [], "paints": []}
    markers = []
    for p in defn.get("plots") or []:
        if isinstance(p, dict) and (p.get("marker") or p.get("style") == "markers"):
            markers.append({"key": p.get("key"), "style": p.get("style"),
                            "marker": p.get("marker")})
    # a conditional paint says its "true" colour as `colorUp` under `colorMode: column:<key>`
    paints = [{"kind": p.get("kind"),
               "color": p.get("colorUp") if p.get("colorMode") else p.get("color"),
               "of": str(p.get("colorMode") or "")[len("column:"):] or None}
              for p in (defn.get("paints") or []) if isinstance(p, dict)]
    return {"markers": markers, "paints": paints}


def presentation_check(expect: Dict[str, Any], defn: Optional[dict]) -> List[str]:
    want = expect.get("presentation") or {}
    pres = presentation_of(defn)
    problems = []
    if want.get("marker") and not pres["markers"]:
        problems.append("expected a marker; the definition draws none")
    for kind, family in (want.get("paints") or {}).items():
        hits = [p for p in pres["paints"] if p["kind"] == kind]
        if not hits:
            problems.append(f"expected a {kind} paint; there is none")
        elif not any(colour_family(p["color"]) == family for p in hits):
            problems.append(f"expected a {family} {kind}; got {[p['color'] for p in hits]}")
    return problems


def call_names(tree: Any) -> set:
    out, stack = set(), [tree]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "call" and isinstance(n.get("name"), str):
                out.add(n["name"])
            stack.extend(n.values())
        elif isinstance(n, list):
            stack.extend(n)
    return out


def sym_tickers(tree: Any) -> set:
    out, stack = set(), [tree]
    while stack:
        n = stack.pop()
        if isinstance(n, dict):
            if n.get("type") == "sym" and isinstance(n.get("value"), str):
                out.add(n["value"].upper())
            stack.extend(n.values())
        elif isinstance(n, list):
            stack.extend(n)
    return out


def name_of(defn: Optional[dict]) -> Optional[str]:
    return ((defn or {}).get("meta") or {}).get("name")


def envelope_ops(server: Dict[str, Any]) -> List[str]:
    env = server.get("envelope") or {}
    return [o.get("op") for o in env.get("ops") or [] if isinstance(o, dict)]


def percentile(values: List[float], q: float) -> Optional[float]:
    if not values:
        return None
    s = sorted(values)
    k = max(0, min(len(s) - 1, int(math.ceil(q * len(s))) - 1))
    return s[k]


# --------------------------------------------------------------------------- #
# the run
# --------------------------------------------------------------------------- #

class Run:
    def __init__(self, args, cases_doc, script_doc, corpus_doc, out_dir: Path, lane: Lane,
                 client, live: bool) -> None:
        from api.services import definition_conversation as conv
        from api.services import definition_concierge as dc
        from api.services import user_definitions as store
        self.conv, self.dc, self.store = conv, dc, store
        self.args = args
        self.cases_doc, self.script_doc, self.corpus_doc = cases_doc, script_doc, corpus_doc
        self.out_dir, self.lane, self.client, self.live = out_dir, lane, client, live
        self.chart = dict(cases_doc.get("chart") or {"sym": "TEST", "tf": "D"})
        self.bars = synthetic_bars()
        self.run_id = out_dir.name
        self.records_path = out_dir / "records.jsonl"
        self.turn_rows: List[dict] = []
        self.case_rows: List[dict] = []
        self.dates_seen: set = set()
        self.cap = args.max_usd

    # ── raw record (R-RAW): appended and fsync'd before anything is summarised ──
    def record(self, row: Dict[str, Any]) -> None:
        text = redact(json.dumps(row, sort_keys=True, default=str))
        with io.open(self.records_path, "a", encoding="utf-8", newline="\n") as fh:
            fh.write(text + "\n")
            fh.flush()
            os.fsync(fh.fileno())
        self.turn_rows.append(row)

    def spent(self) -> float:
        return round(sum(self.dc.spend_for(EVAL_USER, d) for d in self.dates_seen), 6)

    def check_cap(self) -> None:
        if self.cap is not None and self.spent() >= self.cap:
            raise CapReached(f"the sandbox ledger reached ${self.spent():.4f} of the ${self.cap:.2f} cap")

    # ── one member turn, exactly as the browser takes it ──
    def turn(self, sid: str, words: str, scripted: Optional[List[dict]]) -> Dict[str, Any]:
        self.check_cap()
        local = self.lane.call("local", sid=sid, words=words)
        if local.get("handled"):
            return {"path": "local", "server": None, "client": local, "attempts": 0,
                    "model_calls": 0, "unexpected_calls": 0, "latency_ms": 0}
        body = self.lane.call("body", sid=sid, words=words)["body"]
        if not self.live:
            self.client.arm(scripted or [])
        self.dates_seen.add(self.dc._market_date())
        started = time.monotonic()
        server = self.conv.converse(
            body["message"], user_id=EVAL_USER, view=body["view"], authoring=body.get("authoring"),
            snippets=body.get("snippets"), chart=body.get("chart") or {}, admin=True,
            conversation_id=body.get("conversationId"))
        latency_ms = int((time.monotonic() - started) * 1000)
        server = json.loads(json.dumps(server, default=str))
        client = self.lane.call("model", sid=sid, words=words, serverBody=server)
        calls = (server.get("usage") or {}).get("calls")
        return {"path": "model", "server": server, "client": client,
                "attempts": server.get("attempts") or 0,
                "model_calls": int(calls) if isinstance(calls, int) else int(server.get("attempts") or 0),
                "unexpected_calls": 0 if self.live else self.client.unexpected,
                "latency_ms": latency_ms}

    def reference(self, outputs: List[dict]) -> Dict[str, Any]:
        sid = "ref-" + uuid.uuid4().hex[:8]
        self.lane.call("new", sid=sid, sym=self.chart["sym"], tf=self.chart["tf"])
        env = {"contract": "uct.authoring.patch/1", "baseRevision": 0, "disposition": "change",
               "ops": [{"op": "create", "name": "Reference",
                        "outputs": [{"key": o.get("key") or f"o{i}", "tree": o["tree"]}
                                    for i, o in enumerate(outputs)]}]}
        server = {"ok": True, "disposition": "change", "reply": "", "turn": "patch", "envelope": env,
                  "not_understood": [], "unavailable": []}
        out = self.lane.call("model", sid=sid, words="reference", serverBody=server)
        if not out.get("changed"):
            raise LaneUnavailable(f"a reference definition did not build: {out.get('entries')}")
        ev = self.lane.call("evaluate", **{"def": out["working"], "bars": self.bars})
        if not ev["valid"]:
            raise LaneUnavailable(f"a reference definition does not validate: {ev['errors']}")
        for k, col in ev["columns"].items():
            if ev["hashes"].get(k) and not any(v not in (None,) for v in col):
                raise LaneUnavailable(f"reference output {k} is all-unknown on the synthetic bars")
        return ev

    def evaluate(self, defn: dict) -> Dict[str, Any]:
        return self.lane.call("evaluate", **{"def": defn, "bars": self.bars})

    # ── grading of one CHANGE turn against its expectation ──
    def grade_change(self, t: Dict[str, Any], expect: Dict[str, Any], prev: Optional[dict]) -> Dict[str, Any]:
        problems: List[str] = []
        server, client = t["server"] or {}, t["client"] or {}
        if t["path"] == "model":
            if not server.get("ok"):
                problems.append(f"converse refused: {server.get('gate')}")
            elif server.get("disposition") != "change":
                problems.append(f"disposition {server.get('disposition')!r}, expected 'change'")
        if not client.get("changed"):
            problems.append("the engine applied no change: "
                            + "; ".join(" ".join(e.get("lines") or []) for e in client.get("entries") or [])[:300])
        working = client.get("working")
        match_detail: List[dict] = []
        ev = None
        if working and not problems:
            ev = self.evaluate(working)
            if not ev["valid"]:
                problems.append(f"the definition does not validate: {ev['errors']}")
            ref = self.reference(expect["outputs"])
            ok, match_detail = match_outputs(ref, ev)
            if not ok:
                problems.append("an output matches the reference neither by hash nor by value")
            # step 4 proxy: a condition the chart marks/paints is true on at least one bar
            for d in match_detail:
                if d["output"] and expect.get("presentation") and ref["columns"].get(d["reference"]) is not None:
                    if expect["outputs"][0].get("type") == "condition" and \
                            truthy_bars(ev["columns"].get(d["output"]) or []) == 0:
                        problems.append(f"{d['output']} is never true on the synthetic bars")
            problems += presentation_check(expect, working)
            mentions = expect.get("readback_mentions") or []
            text = " ".join(((client.get("readback") or {}).get("lines") or []))
            missing = [m for m in mentions if m not in text]
            if missing:
                problems.append(f"the read-back does not name {missing}")
            if prev is not None:
                problems += self.edit_checks(t, expect, prev, working, ev)
        return {"ok": not problems, "problems": problems, "match": match_detail,
                "hashes": (ev or {}).get("hashes"), "evaluated": ev}

    def edit_checks(self, t, expect, prev, working, ev) -> List[str]:
        problems = []
        if (t["client"].get("revision") or 0) <= prev["revision"]:
            problems.append("baseRevision did not advance")
        ops = envelope_ops(t["server"] or {})
        kinds = [c.get("kind") for c in t["client"].get("changes") or []]
        if not expect.get("rename_allowed"):
            if {"rename_definition", "rename_output"} & set(ops) or {"renamed", "output-renamed"} & set(kinds):
                problems.append(f"an unrequested rename (ops {ops}, changes {kinds})")
            before_name, after_name = name_of(prev["working"]), name_of(working)
            if before_name != after_name and "name-derived" not in kinds:
                # a DERIVED name follows its maths by the engine's own rule (`name-derived`);
                # any other move of the name is a rename nobody asked for (#680)
                problems.append(f"the indicator was renamed: {before_name!r} -> {after_name!r}")
        allowed = set(expect.get("allowed_changes") or []) | {"name-derived"}
        if expect.get("allowed_changes") is not None:
            extra = [k for k in kinds if k not in allowed]
            if extra:
                problems.append(f"changes beyond the asked slot: {extra}")
        for key in expect.get("unchanged_outputs") or []:
            # an output the member did not ask about keeps its exact maths
            ref = prev["hashes"].get(key)
            if ref is None or ref not in (ev["hashes"] or {}).values():
                problems.append(f"output {key!r} changed although the member did not ask")
        if expect.get("presentation_unchanged"):
            if presentation_of(prev["working"])["markers"] != presentation_of(working)["markers"]:
                problems.append("the marker changed although the member did not ask")
        return problems

    # ── the full multi-turn case ──
    def run_case(self, case: Dict[str, Any], repeat: int) -> Dict[str, Any]:
        sid = f"{case['id']}-{repeat}-{uuid.uuid4().hex[:6]}"
        self.lane.call("new", sid=sid, sym=self.chart["sym"], tf=self.chart["tf"])
        kind = case["group"]
        saved: Optional[dict] = None
        prev: Optional[dict] = None
        steps: List[dict] = []
        ok = True
        for i, turn in enumerate(case["turns"]):
            key = f"{case['id']}#{i}"
            scripted = (self.script_doc.get("turns") or {}).get(key)
            if not self.live and scripted is None and turn.get("model_expected", True):
                scripted = []
            t = self.turn(sid, turn["words"], scripted)
            expect = turn["expect"]
            grade = self.grade_turn(case, turn, t, prev)
            row = {
                "run_id": self.run_id, "mode": "live" if self.live else "offline",
                "case": case["id"], "group": kind, "repeat": repeat, "turn": i, "role": turn.get("role", "gate"),
                "words": turn["words"], "path": t["path"],
                "server": {k: (t["server"] or {}).get(k) for k in
                           ("ok", "disposition", "turn", "gate", "reason", "envelope", "attempts",
                            "tokens", "cost_usd", "model", "preflight", "backstop")} if t["server"] else None,
                "usage": {k: ((t["server"] or {}).get("usage") or {}).get(k)
                          for k in ("calls", "usd", "input_tokens", "output_tokens", "repair_gate")}
                if t["server"] else None,
                "client": {k: t["client"].get(k) for k in ("turnOk", "changed", "outcome", "revision",
                                                            "readback", "handled", "renameOnly")},
                "definition": t["client"].get("working"),
                "client_lines": [ln for e in t["client"].get("entries") or [] for ln in (e.get("lines") or [])],
                "model_calls": t["model_calls"], "unexpected_calls": t["unexpected_calls"],
                "latency_ms": t["latency_ms"], "grade": {k: v for k, v in grade.items() if k != "evaluated"},
                "ledger_usd_after": self.spent(),
            }
            # ⭐ step 5 + 6 + reopen: after a graded CHANGE, save via the store, reload, recompute
            if grade["ok"] and expect.get("kind") == "change" and t["client"].get("working"):
                persist = self.save_and_reload(sid, saved, grade["hashes"])
                row["persist"] = persist
                if not persist["ok"]:
                    grade["ok"] = False
                    grade["problems"] += persist["problems"]
                    row["grade"]["ok"] = False
                    row["grade"]["problems"] = grade["problems"]
                else:
                    saved = persist["saved"]
                    reopened = self.lane.call("open", sid=sid, sym=self.chart["sym"], tf=self.chart["tf"],
                                              **{"def": persist["reloaded_def"], "defId": saved["def_id"],
                                                 "version": saved["version"]})
                    prev = {"revision": reopened["revision"], "working": reopened["working"],
                            "hashes": persist["hashes"]}
            elif t["client"].get("working") and prev is None:
                prev = {"revision": t["client"].get("revision") or 0, "working": t["client"]["working"],
                        "hashes": grade.get("hashes") or {}}
            self.record(row)
            steps.append({"turn": i, "ok": grade["ok"], "problems": grade["problems"],
                          "match": grade.get("match"), "role": turn.get("role", "gate")})
            if not grade["ok"]:
                ok = False
                break
        result = {"case": case["id"], "group": kind, "repeat": repeat, "ok": ok, "steps": steps}
        self.case_rows.append(result)
        return result

    def grade_turn(self, case, turn, t, prev) -> Dict[str, Any]:
        expect = turn["expect"]
        k = expect["kind"]
        if t["unexpected_calls"]:
            return {"ok": False, "problems": [f"the model was reached {t['unexpected_calls']} time(s) "
                                              "with no scripted answer"]}
        if k == "change":
            return self.grade_change(t, expect, prev)
        problems: List[str] = []
        server, client = t["server"] or {}, t["client"] or {}
        if client.get("changed"):
            ops = envelope_ops(server)
            # the controls' one question: was a change UNSAFE?
            unsafe = self.unsafe(expect, t, prev)
            if unsafe:
                problems.append("UNSAFE change: " + unsafe)
            elif k != "safe-change-allowed":
                problems.append(f"a change was applied ({ops}); none was expected")
        if k == "clarify":
            if not (server.get("ok") and server.get("disposition") == "clarify"):
                problems.append(f"expected a clarifying question; got "
                                f"{server.get('disposition') or server.get('gate')!r}")
        if "max_model_calls" in expect and t["model_calls"] > expect["max_model_calls"]:
            problems.append(f"{t['model_calls']} model call(s); at most {expect['max_model_calls']} allowed")
        if k == "refused" and server.get("ok") and server.get("disposition") == "change":
            problems.append("expected a refusal; the server offered a change")
        if expect.get("gate_prefix") and t["path"] == "model":
            gate = str(server.get("gate") or "")
            if not gate.startswith(expect["gate_prefix"]):
                problems.append(f"gate {gate!r}, expected one starting {expect['gate_prefix']!r}")
        if prev is not None and expect.get("name_fixed"):
            name_now = name_of(client.get("working") or prev["working"])
            if name_now != name_of(prev["working"]):
                problems.append(f"renamed to {name_now!r} although no name was given")
        return {"ok": not problems, "problems": problems}

    def unsafe(self, expect, t, prev) -> Optional[str]:
        working = t["client"].get("working") or {}
        named = {s.upper() for s in expect.get("named_symbols") or []}
        trees = json.dumps(working)
        if named:
            read = sym_tickers(json.loads(trees))
            other = read - named
            if other:
                return f"reads {sorted(other)}, the member named {sorted(named)}"
            return None
        return "any change is unsafe for this control"

    def save_and_reload(self, sid: str, saved: Optional[dict], hashes_before: Dict[str, Any]) -> Dict[str, Any]:
        problems = []
        prep = self.lane.call("save", sid=sid, draftId=None)
        if prep["errors"]:
            return {"ok": False, "problems": [f"prepareSave refused: {prep['errors']}"]}
        doc = prep["doc"]
        ack = {k: True for k in prep.get("needsAck") or []} or None
        try:
            if saved is None:
                def_id = self.store.new_def_id()
                doc = dict(doc, id=def_id, version=1)
                row = self.store.save(EVAL_USER, def_id, doc, role="admin", repaint_acknowledged=ack)
            else:
                def_id = saved["def_id"]
                row = self.store.save(EVAL_USER, def_id, doc, role="admin", repaint_acknowledged=ack,
                                      expected_version=saved["version"])
        except Exception as exc:                           # noqa: BLE001 -- a refusal is a result
            return {"ok": False, "problems": [f"save refused: {type(exc).__name__}: {str(exc)[:300]}"]}
        got = self.store.get(EVAL_USER, def_id)
        if got is None:
            return {"ok": False, "problems": ["the saved definition did not reload"]}
        reloaded = got["definition"]
        ev = self.evaluate(reloaded)
        if not ev["valid"]:
            problems.append(f"the reloaded definition does not validate: {ev['errors']}")
        if sorted(h for h in ev["hashes"].values() if h) != sorted(h for h in (hashes_before or {}).values() if h):
            problems.append("the reloaded definition's hashes differ from what was saved")
        if base_version_of(saved) is not None and row.get("version") != base_version_of(saved) + 1:
            problems.append(f"version {row.get('version')} after an edit of version {saved['version']}")
        return {"ok": not problems, "problems": problems,
                "saved": {"def_id": def_id, "version": row.get("version")},
                "reloaded_def": reloaded, "hashes": ev["hashes"],
                "row": {k: row.get(k) for k in ("def_id", "version", "rev", "ast_hash", "appended")}}

    # ── the corpus: steps 1-3 only ──
    def run_corpus_phrase(self, case: Dict[str, Any], index: int, repeat: int) -> Optional[Dict[str, Any]]:
        refused = case.get("refused")
        if not refused and not self.live:
            return None   # a model-reaching phrase has no scripted answer: live only
        sid = f"corpus{index}-{repeat}-{uuid.uuid4().hex[:6]}"
        self.lane.call("new", sid=sid, sym=self.chart["sym"], tf=self.chart["tf"])
        t = self.turn(sid, case["message"], [])
        server, client = t["server"] or {}, t["client"] or {}
        problems = []
        if refused:
            if t["model_calls"] or t["unexpected_calls"]:
                problems.append(f"a refused phrase reached the model ({t['model_calls']} call(s))")
            if client.get("changed"):
                problems.append("a refused phrase produced a change")
        else:
            if not client.get("changed"):
                problems.append(f"no change: {server.get('gate') or server.get('disposition')}")
            else:
                names = call_names(client.get("working"))
                ev = self.evaluate(client["working"])
                if not ev["valid"]:
                    problems.append(f"does not validate: {ev['errors']}")
                for term in case.get("terms") or []:
                    if term not in names:
                        problems.append(f"does not use {term}")
                for term in case.get("not_terms") or []:
                    if term in names:
                        problems.append(f"uses {term}, which the phrase did not ask for")
        row = {"run_id": self.run_id, "mode": "live" if self.live else "offline", "case": f"corpus#{index}",
               "group": "corpus", "repeat": repeat, "turn": 0, "role": "gate", "words": case["message"],
               "path": t["path"], "server": {k: server.get(k) for k in
                                             ("ok", "disposition", "gate", "envelope", "attempts", "cost_usd")},
               "model_calls": t["model_calls"], "unexpected_calls": t["unexpected_calls"],
               "latency_ms": t["latency_ms"], "grade": {"ok": not problems, "problems": problems},
               "ledger_usd_after": self.spent()}
        self.record(row)
        result = {"case": f"corpus#{index}", "group": "corpus", "repeat": repeat, "ok": not problems,
                  "steps": [{"turn": 0, "ok": not problems, "problems": problems}]}
        self.case_rows.append(result)
        return result


def base_version_of(saved: Optional[dict]) -> Optional[int]:
    return saved["version"] if saved else None


# --------------------------------------------------------------------------- #
# summary (computed ONLY from what records.jsonl already holds)
# --------------------------------------------------------------------------- #

def summarise(records_path: Path, case_rows: List[dict], *, live: bool, cap: Optional[float],
              spent: float, stopped: Optional[str], corpus_note: str,
              required: Tuple[str, ...] = ()) -> Dict[str, Any]:
    rows = [json.loads(line) for line in io.open(records_path, encoding="utf-8") if line.strip()]
    by_group: Dict[str, List[dict]] = {}
    for c in case_rows:
        by_group.setdefault(c["group"], []).append(c)

    def rate(group):
        cs = by_group.get(group) or []
        return (sum(1 for c in cs if c["ok"]) / len(cs)) if cs else None

    model_rows = [r for r in rows if r.get("path") == "model" and r.get("model_calls")]
    first_pass = [r for r in model_rows if (r.get("server") or {}).get("attempts") == 1]
    fp_rate = (len(first_pass) / len(model_rows)) if model_rows else None
    usd = [float((r.get("usage") or {}).get("usd") or (r.get("server") or {}).get("cost_usd") or 0)
           for r in model_rows]
    lat = [r["latency_ms"] / 1000.0 for r in model_rows]
    median_usd = statistics.median(usd) if usd else None
    p95 = percentile(lat, 0.95)

    examples = by_group.get("example") or []
    ex_ids = sorted({c["case"] for c in examples})
    per_example = {cid: all(c["ok"] for c in examples if c["case"] == cid) for cid in ex_ids}
    ctl = rate("control")
    gates = {
        "examples (every run of each, steps 1-7)": {
            "value": per_example, "pass": all(per_example.values()) if per_example else None},
        "negative controls (100%)": {"value": ctl,
                                     "pass": None if ctl is None else ctl == GATES["controls_rate"]},
        "corpus (>= 90% of runs, steps 1-3)": {
            "value": rate("corpus"),
            "pass": None if rate("corpus") is None else rate("corpus") >= GATES["corpus_min_rate"],
            "note": corpus_note},
        "first-pass rate (no repair, >= 70%)": {
            "value": fp_rate, "pass": None if fp_rate is None else fp_rate >= GATES["first_pass_min_rate"]},
        "median cost per turn (<= $0.12)": {
            "value": median_usd,
            "pass": (median_usd <= GATES["median_usd_per_turn_max"]) if (live and median_usd is not None) else None,
            "note": "" if live else "n/a offline: scripted model, no money spent"},
        "p95 latency (<= 20 s)": {
            "value": p95,
            "pass": (p95 <= GATES["p95_latency_s_max"]) if (live and p95 is not None) else None,
            "note": "" if live else "n/a offline: a scripted answer has no model latency"},
    }
    failed = [k for k, g in gates.items() if g["pass"] is False]
    # a FULL run that did not run its examples or controls has not passed them
    for k in required:
        if gates[k]["pass"] is None:
            failed.append(k + " -- NOT RUN")
    return {"gates": gates, "failed": failed, "cases": case_rows, "turn_records": len(rows),
            "ledger": {"mode": "live" if live else "offline", "cap_usd": cap, "ledger_usd": spent,
                       "money_spent_usd": spent if live else 0.0,
                       "note": ("sandbox cost_guard ledger (real spend)" if live else
                                "sandbox cost_guard ledger over SCRIPTED token counts; no model was called, "
                                "no money was spent"),
                       "per_turn_usd": usd, "stopped": stopped}}


def write_summary(out_dir: Path, summary: Dict[str, Any]) -> None:
    gates = summary["gates"]
    lines = ["# Converse end-to-end evaluation", "",
             f"Mode: **{summary['ledger']['mode']}**. Turn records: {summary['turn_records']}"
             " (raw: `records.jsonl`, written first).", "",
             "| gate | value | result | note |", "|---|---|---|---|"]
    for name, g in gates.items():
        res = {True: "PASS", False: "FAIL", None: "not run"}[g["pass"]]
        lines.append(f"| {name} | {json.dumps(g['value'], default=str)} | {res} | {g.get('note', '')} |")
    lines += ["", "| case | group | repeat | result | first problem | matches |", "|---|---|---|---|---|---|"]
    for c in summary["cases"]:
        first = next((p for s in c["steps"] for p in s["problems"]), "")
        matches = ", ".join(f"t{s['turn']}:" + "/".join(m["match"] for m in (s.get("match") or []))
                            for s in c["steps"] if s.get("match"))
        lines.append(f"| {c['case']} | {c['group']} | {c['repeat']} | {'PASS' if c['ok'] else 'FAIL'} "
                     f"| {first[:120]} | {matches} |")
    led = summary["ledger"]
    lines += ["", f"Ledger: ${led['ledger_usd']:.4f} (cap {led['cap_usd']}); money spent "
                  f"${led['money_spent_usd']:.4f}. {led['note']}."]
    if led.get("stopped"):
        lines.append(f"STOPPED: {led['stopped']}")
    for name, body in (("grading.json", json.dumps({k: v for k, v in summary.items() if k != "ledger"},
                                                   indent=2, default=str)),
                       ("ledger.json", json.dumps(led, indent=2, default=str)),
                       ("grading.md", "\n".join(lines) + "\n")):
        with io.open(out_dir / name, "w", encoding="utf-8", newline="\n") as fh:
            fh.write(redact(body))


# --------------------------------------------------------------------------- #
# main
# --------------------------------------------------------------------------- #

def _parse(argv: Optional[List[str]]) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    mode = ap.add_mutually_exclusive_group()
    mode.add_argument("--offline", action="store_true", help="scripted model, $0 (the default)")
    mode.add_argument("--live", action="store_true", help="the real model; see the guards")
    ap.add_argument("--spend-authorized", action="store_true",
                    help="(live) the owner approved this spend, separately")
    ap.add_argument("--max-usd", type=float, default=None,
                    help="(live: required) stop when the sandbox ledger reaches this; offline: optional")
    ap.add_argument("--repeats", type=int, default=None, help="runs per case (default 3 live, 1 offline)")
    ap.add_argument("--cases", type=Path, default=DEFAULT_CASES)
    ap.add_argument("--script", type=Path, default=DEFAULT_SCRIPT, help="(offline) scripted envelopes")
    ap.add_argument("--corpus", type=Path, default=None,
                    help=f"the 32-phrase corpus (default: {DEFAULT_CORPUS.relative_to(ROOT)} if present)")
    ap.add_argument("--only", action="append", default=None,
                    help="run only these case ids (repeatable); `corpus` selects the corpus")
    ap.add_argument("--work", type=Path, default=None,
                    help="scratch root (default: a new dir under the system temp); never inside C:\\data")
    ap.add_argument("--out", type=Path, default=None, help="out dir (default: <work>/out/<run-id>)")
    return ap.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = _parse(argv)
    live = bool(args.live)
    _remember_secrets(dict(os.environ))
    try:
        if live:
            problems = live_problems(args, dict(os.environ))
            if problems:
                raise Refused("--live refused, nothing was imported, created or called:\n  - "
                              + "\n  - ".join(problems))
        if args.max_usd is not None and not (math.isfinite(args.max_usd) and args.max_usd > 0):
            raise Refused("--max-usd must be a finite amount greater than 0")
        repeats = args.repeats if args.repeats is not None else (3 if live else 1)
        if repeats < 1:
            raise Refused("--repeats must be at least 1")
        run_id = _dt.datetime.now().strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:6]
        work = args.work or Path(tempfile.gettempdir()) / "uct-converse-eval" / run_id
        sandbox = work / "data"
        out_dir = args.out or (work / "out" / run_id)
        refuse_shared_root("--work", work)
        refuse_shared_root("--out", out_dir)
        cases_doc = json.loads(io.open(args.cases, encoding="utf-8").read())
        script_doc = {} if live else json.loads(io.open(args.script, encoding="utf-8").read())
        corpus_path = args.corpus or (DEFAULT_CORPUS if DEFAULT_CORPUS.exists() else None)
        if args.corpus is not None and not args.corpus.exists():
            raise Refused(f"--corpus {args.corpus} does not exist")
        corpus_doc = json.loads(io.open(corpus_path, encoding="utf-8").read()) if corpus_path else None
        corpus_note = (f"corpus: {corpus_path}" if corpus_path else
                       f"corpus absent on this base ({DEFAULT_CORPUS.relative_to(ROOT)} lives on "
                       "feat/indicators-plain-english); pass --corpus <path>")
        if corpus_doc is not None and not live:
            corpus_note += "; offline runs only its refused pins (no scripted answers for the rest)"
    except Refused as exc:
        say(f"REFUSED: {exc}")
        say("VERDICT: REFUSED -- the run did not start")
        return EXIT_REFUSED

    # ⛔ the sandbox BEFORE any `api` import
    try:
        out_dir.mkdir(parents=True, exist_ok=True)
        pins = enter_sandbox(sandbox, live=live, cap_usd=args.max_usd)
        refuse_shared_root("--out", out_dir)
    except Refused as exc:
        say(f"REFUSED: {exc}")
        say("VERDICT: REFUSED -- the run did not start")
        return EXIT_REFUSED
    say(f"[converse-eval] mode={'live' if live else 'offline'} run={run_id}")
    say(f"[converse-eval] sandbox={sandbox} ({len(pins)} census paths pinned) out={out_dir}")

    from api.services.catalyst import store as catalyst_store
    from api.services import auth_db
    catalyst_store._init_db()      # the SANDBOX spend ledger cost_guard writes
    auth_db.init_db()              # the SANDBOX auth.db (converse_turn telemetry lands here)
    from api.services import indicator_alert_service
    indicator_alert_service.init_schema()   # a maths edit's save migrates alert bindings here
    if live:
        client = None
        make_live_client()     # constructed only here, after every guard; the product factory keeps it
    else:
        client = ScriptedClient(script_doc.get("usage") or {})
        import api.services.engine as engine
        engine._get_anthropic_client = lambda: client       # the product's seam, replaced in-process

    lane = Lane(work / "lane")
    try:
        lane.start()
    except LaneUnavailable as exc:
        say(f"LANE UNAVAILABLE: {exc}")
        say("VERDICT: LANE UNAVAILABLE -- nothing was graded")
        return EXIT_LANE

    run = Run(args, cases_doc, script_doc, corpus_doc, out_dir, lane, client, live)
    stopped = None
    try:
        cases = [c for c in cases_doc["cases"] if not args.only or c["id"] in args.only]
        for r in range(repeats):
            for case in cases:
                res = run.run_case(case, r)
                say(f"  {'PASS' if res['ok'] else 'FAIL'}  {case['id']} (run {r + 1})"
                    + ("" if res["ok"] else f" -- {next((p for s in res['steps'] for p in s['problems']), '')}"))
            if corpus_doc and (not args.only or "corpus" in args.only):
                for i, phrase in enumerate(corpus_doc.get("cases") or []):
                    res = run.run_corpus_phrase(phrase, i, r)
                    if res is not None and not res["ok"]:
                        say(f"  FAIL  corpus#{i} (run {r + 1}) -- {res['steps'][0]['problems'][:1]}")
    except CapReached as exc:
        stopped = str(exc)
        say(f"STOPPED: {stopped}")
    except LaneUnavailable as exc:
        lane.stop()
        say(f"LANE UNAVAILABLE: {exc}")
        say("VERDICT: LANE UNAVAILABLE -- the run is incomplete")
        return EXIT_LANE
    finally:
        blocked = lane.call("blocked").get("blocked") if lane.proc and lane.proc.poll() is None else []
        lane.stop()
    if blocked:
        say(f"[converse-eval] the lane refused {len(blocked)} network call(s): {blocked[:3]}")

    summary = summarise(run.records_path if run.records_path.exists() else _empty(out_dir),
                        run.case_rows, live=live, cap=args.max_usd, spent=run.spent(),
                        stopped=stopped, corpus_note=corpus_note,
                        required=() if args.only else ("examples (every run of each, steps 1-7)",
                                                      "negative controls (100%)"))
    write_summary(out_dir, summary)
    say("")
    for name, g in summary["gates"].items():
        res = {True: "PASS", False: "FAIL", None: "not run"}[g["pass"]]
        say(f"  {res:8} {name}: {json.dumps(g['value'], default=str)} {g.get('note', '')}")
    total = len(run.case_rows)
    passed = sum(1 for c in run.case_rows if c["ok"])
    say(f"  ledger: ${summary['ledger']['ledger_usd']:.4f}; money spent ${summary['ledger']['money_spent_usd']:.4f}")
    say(f"  out: {out_dir}")
    if stopped:
        say(f"VERDICT: STOPPED at the spend cap -- {passed}/{total} case runs passed before it; incomplete")
        return EXIT_STOPPED
    if summary["failed"] or total == 0:
        say(f"VERDICT: FAIL -- {passed}/{total} case runs passed; failed gates: {summary['failed'] or ['no cases ran']}")
        return EXIT_FAIL
    say(f"VERDICT: PASS -- {passed}/{total} case runs passed; mode {'live' if live else 'offline'}")
    return EXIT_PASS


def _empty(out_dir: Path) -> Path:
    p = out_dir / "records.jsonl"
    io.open(p, "a", encoding="utf-8").close()
    return p


if __name__ == "__main__":
    sys.exit(main())
