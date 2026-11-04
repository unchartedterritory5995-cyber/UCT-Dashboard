"""UCT Agent — MULTI-STEP planner evaluation bridge (prepared 2026-11-04; NOT RUN — the paid path needs the owner).

The capreg / NLM-1 acceptance harness drives the REAL Agent panel over a fixture board and scores the FINAL WORKSPACE
STATE plus grouped Undo. Normally its model is scripted. With AGENT_EVAL_BRIDGE set (app/src/agent/testing/panelHarness.jsx),
the panel's /api/agent/turn and /api/agent/record go to THIS process instead, which serves them the way the production
route does (api/routers/uct_agent.py `_admitted_turn`, without auth, streaming, News or the background naming call):
a conversation store and request ledger in the conftest sandbox (never production data), `budget.open_request` (the
member request = the `turn_request_id`, a reroute continues it), the production `budget.Meter` (2-call ceiling, the
$0.25 per-turn cap) and `turn.run_turn` (v1 planner, NL-1 and planner v2 OFF, research stubbed).

  # 1. DRY RUN (free, zero network): every call is answered by a stub; counts, request bytes and the bound are printed
  python tools/agent_eval_multistep.py run --arm v1 --dry-run --out DIR -- <vitest command>
  # 2. PAID (owner authorisation: the dollar amount and the eval key):
  python tools/agent_eval_multistep.py run --arm v1 --max-usd 5.00 --out DIR -- <vitest command>
  # 3. bound / summary (free)
  python tools/agent_eval_multistep.py bound --requests 71
  python tools/agent_eval_multistep.py summary DIR [DIR …]

⛔ HARD STOP. Before EVERY model call: the request must be <= MAX_REQUEST_BYTES (else the run stops), and this run's
committed dollars (settled actuals + the open reservation) + this call's worst case must be <= --max-usd (else the run
stops: no call is made, every later request is answered 503, the exit code is 3). The call is then RESERVED in the
cumulative eval ledger (tools/agent_eval_ledger.py: the owner's cap file, $21 code cap) and settled from usage after.
Worst case of a call = max(the eval ledger's bound, budget.worst_case_usd): every request byte as a token + 4000
framing, billed as a cache write, + the full max_tokens of output. Calls are strictly sequential (one HTTP thread).

THE KEY is read from UCT_AGENT_EVAL_API_KEY only (never ANTHROPIC_API_KEY; equal keys are refused), only on the paid
path, and never printed, logged or written: rows carry a sha256[:8] fingerprint. The dry run never reads it and never
imports `anthropic`; a socket guard refuses any non-loopback connection in this process.

Records are CONTENT-FREE: case id (the test id's leading token, e.g. P01 — never the test title or the member's words),
arm, turn_request_id, call category, request bytes, tokens, dollars, outcome. DIR/calls.jsonl, DIR/requests.jsonl,
DIR/summary.json.
"""
from __future__ import annotations

import argparse
import hashlib
import http.server
import json
import os
import re
import socket
import subprocess
import sys
import threading
import time
import types

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

import conftest  # noqa: E402,F401 -- every *_DB_PATH → a sandbox, before any api.* import (never production data)
from api.services.uct_agent import budget, store, turn  # noqa: E402
from tools import agent_eval_ledger as ledger  # noqa: E402

TOOL = "agent_eval_multistep"
MODEL = "claude-haiku-4-5"                 # the v1 planner (turn.model() default; UCT_AGENT_MODEL is pinned to it)
#: The largest request (bytes of system + messages + schema) a call may send. Measured: 56-61 KB at the golden
#: manifest (docs/agent/budget/PER-TURN-CAP.md); NLM-1's largest routed request = v1's (MILESTONE-NLM1 D1.3).
MAX_REQUEST_BYTES = 80_000
NO_TITLE_YET = "(no name yet)"             # api/routers/uct_agent.py NO_TITLE_YET (held equal by the test)
#: The production flags this eval pins (the state of production master): v1 planner, no NL-1, no effort.
PINNED_ENV = {"UCT_AGENT_MODEL": MODEL}
CLEARED_ENV = ("UCT_AGENT_PLANNER", "UCT_AGENT_NL1", "UCT_AGENT_EFFORT", "UCT_AGENT_STREAM", "UCT_AGENT_MAX_CALLS_PER_REQUEST",
               "UCT_AGENT_TURN_USD", "UCT_AGENT_BUDGET_USD")
ARMS = ("v1", "nlm1")
CASE_RE = re.compile(r"^\s*([A-Za-z]{1,4}\d{1,3}[a-z]?)\b")
DRY_ENVELOPE = {"disposition": "answer", "reply": "Dry run: no model was called.", "question": None, "ops": [],
                "unsupported_category": None}


class HardStop(Exception):
    """The run must stop: no further model call is made."""


# ── the bound ───────────────────────────────────────────────────────────────────────────────────
def per_call_worst_bound(model: str = MODEL) -> float:
    """The most one admitted call can be charged: MAX_REQUEST_BYTES + framing as a cache write + MAX_TOKENS out."""
    return ledger.cost_usd(model, cache_write=MAX_REQUEST_BYTES + ledger.FRAMING_TOKENS, output=turn.MAX_TOKENS)


def call_bytes(kw: dict) -> int:
    return max(ledger.request_bytes(kw), budget.request_bytes(kw))


def call_worst(kw: dict) -> float:
    return round(max(ledger.worst_case_usd(kw), budget.worst_case_usd(kw)), 6)


def bound(requests: int, calls_per_request: int | None = None, model: str = MODEL) -> dict:
    cpr = int(calls_per_request or budget.max_calls())
    one = per_call_worst_bound(model)
    per_request = min(round(one * cpr, 6), budget.turn_cap_usd()) if cpr > 1 else one
    return {"requests": requests, "calls_per_request": cpr, "max_calls": requests * cpr,
            "per_call_worst_usd": round(one, 6), "per_request_worst_usd": round(per_request, 6),
            "worst_usd": round(per_request * requests, 4), "turn_cap_usd": budget.turn_cap_usd()}


# ── the run-level hard stop ─────────────────────────────────────────────────────────────────────
class RunGuard:
    """This run's ceiling (--max-usd). committed = settled actuals + the open reservation. Sequential calls only."""

    def __init__(self, max_usd: float | None):
        self.max_usd = max_usd
        self.committed = 0.0
        self.calls = 0
        self.aborted: str | None = None
        self.lock = threading.Lock()

    def abort(self, why: str) -> None:
        with self.lock:
            self.aborted = self.aborted or why

    def admit(self, worst: float) -> None:
        with self.lock:
            if self.aborted:
                raise HardStop(self.aborted)
            if self.max_usd is not None and round(self.committed + worst, 6) > round(self.max_usd, 6):
                self.aborted = (f"HARD STOP: ${self.committed:.4f} committed + worst ${worst:.4f} for the next call would pass "
                                f"the authorised ${self.max_usd:.2f}")
                raise HardStop(self.aborted)
            self.committed = round(self.committed + worst, 6)
            self.calls += 1

    def settle(self, reserved: float, charged: float) -> None:
        with self.lock:
            self.committed = round(self.committed - reserved + charged, 6)


class Recorder:
    def __init__(self, out_dir: str, header: dict):
        os.makedirs(out_dir, exist_ok=True)
        self.dir = out_dir
        self.calls_path = os.path.join(out_dir, "calls.jsonl")
        self.req_path = os.path.join(out_dir, "requests.jsonl")
        self.header = header
        self.calls: list[dict] = []
        self.requests: list[dict] = []
        for p in (self.calls_path, self.req_path):
            open(p, "w", encoding="utf-8").close()

    def _append(self, path: str, row: dict) -> None:
        with open(path, "a", encoding="utf-8") as f:
            f.write(json.dumps(row, separators=(",", ":")) + "\n")

    def call(self, row: dict) -> None:
        self.calls.append(row)
        self._append(self.calls_path, row)

    def request(self, row: dict) -> None:
        self.requests.append(row)
        self._append(self.req_path, row)


# ── the caller (the ONE place a model call can happen) ──────────────────────────────────────────
class EvalMeter(budget.Meter):
    """The production meter, remembering the category of the call it is admitting (for the record only)."""

    category = None

    def call(self, category, fn, **kwargs):
        self.category = category
        return super().call(category, fn, **kwargs)


def _dry_response(**_kw):
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(DRY_ENVELOPE))],
                                 stop_reason="end_turn",
                                 usage=types.SimpleNamespace(input_tokens=0, output_tokens=0, cache_read_input_tokens=0,
                                                             cache_creation_input_tokens=0))


class Bridge:
    """Serves the panel's turns. `create` is the Messages call (the stub when dry); `led` the cumulative ledger (None dry)."""

    def __init__(self, *, arm: str, guard: RunGuard, rec: Recorder, dry: bool, create=None, led=None, run_id: str = "",
                 key_fp: str | None = None):
        if arm not in ARMS:
            raise ValueError(arm)
        if not dry and (create is None or led is None):
            raise ValueError("a paid bridge needs the client and the cumulative ledger")
        self.arm, self.guard, self.rec, self.dry = arm, guard, rec, dry
        self.create = _dry_response if dry else create
        self.led, self.run_id, self.key_fp = led, run_id, key_fp
        self.stub_calls = 0

    def caller(self, ctx: dict):
        def call(**kw):
            if str(kw.get("model") or "") != MODEL:
                self.guard.abort(f"a call asked for model {kw.get('model')!r}, not {MODEL}")
                raise HardStop(self.guard.aborted)
            if int(kw.get("max_tokens") or 0) > turn.MAX_TOKENS:
                self.guard.abort("a call asked for more output than the bound assumes")
                raise HardStop(self.guard.aborted)
            nbytes = call_bytes(kw)
            if nbytes > MAX_REQUEST_BYTES:
                self.guard.abort(f"a request of {nbytes} bytes is over MAX_REQUEST_BYTES {MAX_REQUEST_BYTES}")
                raise HardStop(self.guard.aborted)
            worst = call_worst(kw)
            self.guard.admit(worst)                                   # ⛔ the run's hard stop, before anything else
            rid = None
            if self.led is not None:
                try:
                    rid = self.led.reserve(self.run_id, worst, tool=TOOL, model=MODEL, key_fp=self.key_fp)
                except ledger.LedgerRefused as e:
                    self.guard.settle(worst, 0.0)
                    self.guard.abort(f"cumulative ledger refused: {e}")
                    raise HardStop(self.guard.aborted) from e
            row = {"run_id": self.run_id, "arm": self.arm, "case": ctx["case"], "turn_request_id": ctx["request_id"],
                   "category": getattr(ctx.get("meter"), "category", None), "reroute": ctx["reroute"],
                   "request_bytes": nbytes, "worst_usd": worst, "dry": self.dry, "t": int(time.time())}
            t0 = time.monotonic()
            try:
                if self.dry:
                    self.stub_calls += 1
                resp = self.create(**kw)
            except Exception as e:
                provider = ledger._is_provider_error_response(e)
                if self.led is not None:
                    (self.led.release(rid) if provider else self.led.settle(rid, None, None, model=MODEL, outcome="worst_case"))
                charged = 0.0 if provider else worst
                self.guard.settle(worst, charged)
                self.rec.call({**row, "ms": int((time.monotonic() - t0) * 1000), "error": type(e).__name__, "actual_usd": charged})
                raise
            usage = ledger.usage_tokens(resp)
            if self.dry:
                actual = worst                       # a dry run counts what a paid run could reserve
            elif usage is None:
                actual = worst
            else:
                actual = ledger.cost_usd(MODEL, **usage)
            if self.led is not None:
                self.led.settle(rid, None if usage is None else actual, usage, model=MODEL)
            self.guard.settle(worst, actual)
            self.rec.call({**row, "ms": int((time.monotonic() - t0) * 1000), "stop": getattr(resp, "stop_reason", None),
                           **({"tokens": usage} if usage else {}), "actual_usd": round(actual, 6)})
            if not self.dry and actual > worst * 1.0001:
                self.guard.abort(f"a call cost ${actual:.5f}, more than its worst case ${worst:.5f}: the bound is wrong")
            return resp
        return call

    # the route, as api/routers/uct_agent.py serves it (auth, limits, streaming, News and naming left out)
    def turn(self, body: dict, case: str) -> tuple[int, dict]:
        if self.guard.aborted:
            self.rec.request({"run_id": self.run_id, "arm": self.arm, "case": case, "turn_request_id": None,
                              "reroute": bool(body.get("reroute")), "result": "stopped"})
            return 503, {"detail": "Evaluation stopped."}
        uid = case_uid(case)
        msg = str(body.get("message") or "")
        reroute = bool(body.get("reroute"))
        repair = body.get("repair")
        request_id = budget.open_request(uid, body.get("conversationId"), msg, reroute=reroute)
        if request_id is None:
            return 400, {"detail": "That follow-up has expired. Ask again."}
        cid = store.ensure_conversation(uid, body.get("conversationId"), msg)
        if cid != body.get("conversationId"):
            budget.attach_conversation(request_id, cid)
        history = store.get_turns(uid, cid) or []
        if reroute and history and history[-1].get("role") == "member" and history[-1].get("text") == msg:
            history = history[:-1]
        elif repair is not None and reroute and any(t.get("role") == "member" and t.get("text") == msg for t in history[-2:]):
            pass
        else:
            store.add_turn(uid, cid, "member", msg, {"voice": False})
        info = store.title_info(uid, cid)
        nameable = None if not info or info.get("source") == "user" else (info["title"] if info.get("source") == "auto" else NO_TITLE_YET)
        meter = EvalMeter(user_id=uid, request_id=request_id, site_reader=lambda: (0.0, 1e9))
        ctx = {"case": case, "request_id": request_id, "reroute": reroute, "meter": meter}
        shown = repair is None
        t0 = time.monotonic()
        req = {"run_id": self.run_id, "arm": self.arm, "case": case, "turn_request_id": request_id, "reroute": reroute,
               "repair": repair is not None}
        try:
            out = turn.run_turn(message=msg, context=body.get("context") or {}, history=history,
                                capabilities=body.get("capabilities") or [], pending=body.get("pending"),
                                recent_outcome=body.get("recentOutcome"), manifest_version=body.get("manifestVersion"),
                                routing=body.get("routing"), conversation_title=nameable, caller=self.caller(ctx),
                                meter=meter, reroute=reroute, interpreter=body.get("interpreter"), repair=repair,
                                reference=body.get("reference"))
        except HardStop:
            self.rec.request({**req, "result": "hard_stop"})
            return 503, {"detail": "Evaluation stopped."}
        except budget.BudgetRefused as e:
            if shown:
                store.add_turn(uid, cid, "outcome", e.sentence, {"kind": "error"})
            self.rec.request({**req, "result": f"budget:{e.reason}"})
            return (400 if e.reason in ("call_limit", "turn_cap") else 429), {"detail": e.sentence}
        except turn.TurnError as e:
            if shown:
                store.add_turn(uid, cid, "outcome", f"Refused: {e}", {"kind": "error"})
            self.rec.request({**req, "result": "turn_error"})
            return 400, {"detail": str(e)}
        except Exception as e:  # noqa: BLE001 -- a provider failure is a sentence (the panel shows it)
            if shown:
                store.add_turn(uid, cid, "outcome", "UCT Agent was unavailable for this message.", {"kind": "error"})
            self.rec.request({**req, "result": f"error:{type(e).__name__}"})
            if self.guard.aborted:
                return 503, {"detail": "Evaluation stopped."}
            return 503, {"detail": "UCT Agent was unavailable for this message."}
        env, usage = out["envelope"], out["usage"]
        if not env.get("need_groups"):
            store.add_turn(uid, cid, "agent", env.get("reply") or (env.get("question") or {}).get("text") or "", {"envelope": env})
        title = out.get("title")
        if title and nameable and title != nameable:
            store.set_auto_title(uid, cid, title)
        self.rec.request({**req, "result": "ok", "disposition": "need_groups" if env.get("need_groups") else env.get("disposition"),
                          "ops": len(env.get("ops") or []), "model_calls": usage.get("model_calls"),
                          "repaired": usage.get("repaired"), "ms": int((time.monotonic() - t0) * 1000)})
        return 200, {"conversationId": cid, "envelope": env,
                     "usage": {"model": usage.get("model"), "research_calls": 0, "citations": [], "model_calls": usage.get("model_calls")}}

    def record(self, body: dict, case: str) -> tuple[int, dict]:
        uid = case_uid(case)
        member, outcome = body.get("member"), body.get("outcome")
        if not (member or outcome):
            return 400, {"detail": "Nothing to record."}
        cid = store.ensure_conversation(uid, body.get("conversationId"), member or outcome or "")
        if member:
            store.add_turn(uid, cid, "member", member, {"local": True})
        if outcome:
            store.add_turn(uid, cid, "outcome", outcome, body.get("outcomeData") or None)
        return 200, {"conversationId": cid}


def case_id(raw: str | None) -> str:
    """The test id's leading token (P01, X12, F07…) — never the title. Anything else becomes a hash."""
    last = str(raw or "").split(" > ")[-1]
    m = CASE_RE.match(last)
    return m.group(1) if m else ("h" + hashlib.sha256(last.encode("utf-8")).hexdigest()[:8])


def case_uid(case: str) -> int:
    """One sandbox user per case, so no conversation ever crosses cases."""
    return 900_000_000 + int(hashlib.sha256(case.encode("utf-8")).hexdigest()[:6], 16)


# ── HTTP (loopback, one thread: calls are strictly sequential) ──────────────────────────────────
def make_server(bridge: Bridge, port: int = 0) -> http.server.HTTPServer:
    class H(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_a):           # nothing the member said is ever logged
            pass

        def do_POST(self):  # noqa: N802
            n = int(self.headers.get("content-length") or 0)
            try:
                payload = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                return self._send(400, {"detail": "bad json"})
            case = case_id(payload.get("case"))
            body = payload.get("body") or {}
            if self.path == "/api/agent/turn":
                code, out = bridge.turn(body, case)
            elif self.path == "/api/agent/record":
                code, out = bridge.record(body, case)
            else:
                code, out = 404, {"detail": "not found"}
            self._send(code, out)

        def _send(self, code, obj):
            data = json.dumps(obj).encode("utf-8")
            self.send_response(code)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)

    return http.server.HTTPServer(("127.0.0.1", port), H)


_REAL_CONNECT = socket.socket.connect


def install_loopback_only() -> dict:
    """Dry run: this process may connect to loopback only. Returns the counter of refused attempts."""
    seen = {"refused": 0}

    def connect(self, address):
        host = address[0] if isinstance(address, tuple) else address
        if str(host) not in ("127.0.0.1", "::1", "localhost"):
            seen["refused"] += 1
            raise ConnectionRefusedError(f"dry run: no network ({host})")
        return _REAL_CONNECT(self, address)

    socket.socket.connect = connect
    return seen


def pin_env() -> None:
    for k in CLEARED_ENV:
        os.environ.pop(k, None)
    os.environ.update(PINNED_ENV)


# ── summary ─────────────────────────────────────────────────────────────────────────────────────
def summarize(calls: list[dict], requests: list[dict], guard: RunGuard | None = None) -> dict:
    by_req: dict = {}
    for c in calls:
        by_req.setdefault((c["case"], c["turn_request_id"]), []).append(c)
    cases = sorted({r["case"] for r in requests} | {c["case"] for c in calls})
    member_requests = len({(r["case"], r["turn_request_id"]) for r in requests if r.get("turn_request_id")})
    return {"member_requests": member_requests, "calls": len(calls), "cases": len(cases),
            "max_calls_per_request": max((len(v) for v in by_req.values()), default=0),
            "max_request_bytes": max((c["request_bytes"] for c in calls), default=0),
            "worst_reserved_usd": round(sum(c["worst_usd"] for c in calls), 6),
            "actual_usd": round(sum(c.get("actual_usd", 0) for c in calls if not c.get("dry")), 6),
            "reroutes": sum(1 for r in requests if r.get("reroute")),
            "results": {k: sum(1 for r in requests if r.get("result") == k) for k in sorted({r.get("result") for r in requests})},
            "aborted": guard.aborted if guard else None, "committed_usd": guard.committed if guard else None}


# ── run ─────────────────────────────────────────────────────────────────────────────────────────
def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--arm", choices=ARMS, required=True)
    r.add_argument("--dry-run", action="store_true")
    r.add_argument("--max-usd", type=float, default=None)
    r.add_argument("--out", required=True)
    r.add_argument("--timeout-s", type=float, default=30.0)
    r.add_argument("command", nargs=argparse.REMAINDER, help="-- the vitest command (run with AGENT_EVAL_BRIDGE set)")
    b = sub.add_parser("bound")
    b.add_argument("--requests", type=int, required=True)
    s = sub.add_parser("summary")
    s.add_argument("dirs", nargs="+")
    a = ap.parse_args(argv)
    if a.cmd == "bound":
        print(json.dumps(bound(a.requests), indent=1))
        return 0
    if a.cmd == "summary":
        for d in a.dirs:
            print(d, json.dumps(json.load(open(os.path.join(d, "summary.json"), encoding="utf-8")), indent=1))
        return 0
    cmd = [c for c in a.command if c != "--"]
    if not cmd:
        print("refused: give the vitest command after --")
        return 2
    pin_env()
    run_id = f"multistep-{a.arm}-{'dry' if a.dry_run else 'paid'}-{int(time.time())}"
    if a.dry_run:
        seen = install_loopback_only()
        ledger.stub_research(turn)
        guard = RunGuard(a.max_usd)
        rec = Recorder(a.out, {})
        bridge = Bridge(arm=a.arm, guard=guard, rec=rec, dry=True, run_id=run_id)
    else:  # pragma: no cover - the paid path: only with the owner's authorisation
        if a.max_usd is None or a.max_usd <= 0:
            print("refused: a paid run needs --max-usd (the owner's authorised amount)")
            return 2
        ledger.stub_research(turn)
        try:
            led, key, key_fp = ledger.preflight(turn, max_usd=a.max_usd)
            import anthropic
            client = anthropic.Anthropic(api_key=key, max_retries=0, timeout=a.timeout_s)
            del key
            ledger.check_model(client, MODEL)
        except ledger.LedgerRefused as e:
            print(f"refused: {e}")
            return 2
        seen = None
        guard = RunGuard(a.max_usd)
        rec = Recorder(a.out, {})
        bridge = Bridge(arm=a.arm, guard=guard, rec=rec, dry=False, create=client.messages.create, led=led,
                        run_id=run_id, key_fp=key_fp)
        print(f"cumulative ledger: ${led.remaining():.4f} left of ${led.cap():.2f}; this run may commit at most ${a.max_usd:.2f}")
    srv = make_server(bridge)
    th = threading.Thread(target=srv.serve_forever, daemon=True)
    th.start()
    url = f"http://127.0.0.1:{srv.server_address[1]}"
    env = {k: v for k, v in os.environ.items() if k not in (ledger.EVAL_KEY_ENV, ledger.PROD_KEY_ENV)}   # vitest never sees a key
    env.update({"AGENT_EVAL_BRIDGE": url, "NLM1_FLAG": "1" if a.arm == "nlm1" else "0"})
    print(f"{run_id}: bridge {url}  model {MODEL}  arm {a.arm}  {'DRY RUN (no network)' if a.dry_run else 'PAID'}"
          f"  max ${a.max_usd if a.max_usd is not None else 'none'}  bound per call ${per_call_worst_bound():.5f}")
    t0 = time.monotonic()
    code = subprocess.call(cmd, env=env, shell=(os.name == "nt"))
    srv.shutdown()
    summ = {"run_id": run_id, "arm": a.arm, "model": MODEL, "dry": a.dry_run, "max_usd": a.max_usd,
            "vitest_exit": code, "seconds": int(time.monotonic() - t0), **summarize(rec.calls, rec.requests, guard),
            "bound_two_calls_each": bound(summarize(rec.calls, rec.requests)["member_requests"])["worst_usd"]}
    if a.dry_run:
        summ.update({"stub_calls": bridge.stub_calls, "network_refused": seen["refused"],
                     "anthropic_imported": "anthropic" in sys.modules})
    with open(os.path.join(a.out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summ, f, indent=1)
    print(json.dumps(summ, indent=1))
    if guard.aborted:
        print(f"ABORTED: {guard.aborted}")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
