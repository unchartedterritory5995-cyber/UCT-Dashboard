"""UCT Agent AUTOTEST: the gate in front of every REAL-MODEL call. No paid call happens without this file agreeing.

  python tools/agent_autotest_gate.py check --target local --stage canary --public-sha <hash> [--heldout-sha <hash>]
  python tools/agent_autotest_gate.py status
  python tools/agent_autotest_gate.py serve --stage canary --public-sha <hash> --spend-log <file>     # (paid) local target only
  python tools/agent_autotest_gate.py reserve --stage canary --usd 0.25 | settle --id N --usd X | stop --why "..."

⛔ THE OWNER'S FILE. C:/UCT/agent-autotest-authorization.json, written by the OWNER, never by a Claude session, is the only
thing that opens this gate. There is no flag, environment variable or default that does. `max_usd` may not pass $8. The
override below is honoured under pytest only, so a test can use a scratch file and nothing else can.

EVERY CALL GOES THROUGH tools/agent_eval_ledger.py: reserve the worst case before the call, settle the actual after, on the
one cumulative ledger with its hard cap file. On top of the ledger's own cap, four ceilings refuse the call first:
  the authorization's max_usd   (everything this program ever spent)
  the stage's budget            (STAGES below; the same table is in stages.mjs and a test pins them together)
  the per-turn cap              (budget.turn_cap_usd(), the production $0.25: unchanged)
  the two-call request limit    (the production budget.max_calls(): unchanged)

STOPS (sticky: a stop writes STOP_FILE, and nothing runs again until the OWNER deletes it):
  a call that cost more than its own worst case · a turn over ANOMALY_TURN_USD · a mean over ANOMALY_MEAN_USD after 20
  paid turns · a response with no usage · 2 calls ending in refusal or max_tokens · 3 API errors in a row.

Rows and logs are content-free: ids, tokens, dollars. Research stays stubbed (ledger.stub_research). SDK retries are off.
The eval key comes from the environment only and is never printed. The production key is refused by the ledger.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from tools import agent_eval_ledger as ledger  # noqa: E402

MAX_AUTHORIZED_USD = 8.0
AUTH_PATH = r"C:\UCT\agent-autotest-authorization.json"
STOP_FILE = r"C:\UCT\agent-autotest-STOP.json"
AUTH_ENV = "UCT_AGENT_AUTOTEST_AUTH"                  # tests only (ledger.under_pytest)
STOP_ENV = "UCT_AGENT_AUTOTEST_STOP"                  # tests only
RUN_PREFIX = "autotest-"
#: name -> dollars. Sums to $7.00: $1 stays unspent as the margin under the $8 limit. Same table: app/src/testing/agent/autotest/stages.mjs
STAGES = {"canary": 0.50, "sample": 2.00, "broad": 3.00, "heldout": 1.50}
ANOMALY_TURN_USD = 0.10          # two calls at the measured ~$0.016 are about $0.03; this is three times that
ANOMALY_MEAN_USD = 0.05          # after MEAN_AFTER_TURNS paid turns
MEAN_AFTER_TURNS = 20
PRODUCTION_ACK = "I accept that production runs on my account, against a disposable AUTOTEST layout only, and spends my production Agent budget."
TOOL = "agent_autotest"
HEX = "0123456789abcdef"


class Refused(Exception):
    """No paid call. The sentence says why."""


def auth_path() -> str:
    p = os.environ.get(AUTH_ENV, "").strip()
    if p and not ledger.under_pytest():
        raise Refused(f"{AUTH_ENV} is honoured only under pytest; the file is {AUTH_PATH}")
    return p or AUTH_PATH


def stop_path() -> str:
    p = os.environ.get(STOP_ENV, "").strip()
    if p and not ledger.under_pytest():
        raise Refused(f"{STOP_ENV} is honoured only under pytest")
    return p or STOP_FILE


def _is_hash(s) -> bool:
    return isinstance(s, str) and len(s) == 64 and all(c in HEX for c in s)


def read_authorization(*, target: str, stage: str, public_sha: str, heldout_sha: str | None = None, now: float | None = None) -> dict:
    """The owner's file, checked. Raises Refused. The same rules as realGuard.mjs (a test pins the cases)."""
    path = auth_path()
    if os.path.exists(stop_path()):
        raise Refused(f"a stop is in force ({stop_path()}); the owner clears it")
    if not os.path.isfile(path):
        raise Refused(f"no authorization file at {path}")
    try:
        with open(path, encoding="utf-8") as f:
            a = json.load(f)
    except (OSError, ValueError) as e:
        raise Refused(f"the authorization file does not parse ({type(e).__name__})")
    if not isinstance(a, dict):
        raise Refused("the authorization file is not a JSON object")
    if a.get("approved_by") != "owner":
        raise Refused('approved_by is not "owner"')
    m = a.get("max_usd")
    if isinstance(m, bool) or not isinstance(m, (int, float)) or not m > 0:
        raise Refused("max_usd is not a positive number")
    if m > MAX_AUTHORIZED_USD:
        raise Refused(f"max_usd {m} is over the ${MAX_AUTHORIZED_USD:.0f} limit")
    try:
        expires = time.mktime(time.strptime(str(a.get("expires")), "%Y-%m-%d")) + 86400
    except ValueError:
        raise Refused("expires is not a date")
    if (now if now is not None else time.time()) > expires:
        raise Refused(f"the authorization expired on {a.get('expires')}")
    if target not in ("local", "production"):
        raise Refused(f"unknown target {target}")
    if target not in (a.get("targets") or []):
        raise Refused(f"target {target} is not authorized")
    if stage not in (a.get("stages") or []) or stage not in STAGES:
        raise Refused(f"stage {stage or '(none)'} is not authorized")
    if not _is_hash(a.get("public_set_sha256")) or a.get("public_set_sha256") != public_sha:
        raise Refused("the authorization is for a different public request set")
    if a.get("heldout_sha256") is not None and a.get("heldout_sha256") != heldout_sha:
        raise Refused("the authorization is for a different held-out set")
    if target == "production" and a.get("production_ack") != PRODUCTION_ACK:
        raise Refused("production needs the exact production_ack sentence")
    return a


def spent(led: ledger.Ledger, prefix: str = RUN_PREFIX) -> float:
    """Everything counted against this program in the shared ledger: settled actuals + open reservations."""
    total = 0.0
    for r in led.rows(100000):
        if str(r["run_id"]).startswith(prefix):
            total += float(r["reserved_usd"]) if r["status"] == "reserved" else float(r["actual_usd"]) if r["status"] == "settled" else 0.0
    return total


class Ceilings:
    """Every ceiling above the ledger's own, one call at a time. Pure over `led`: tested without any API."""

    def __init__(self, led: ledger.Ledger, *, max_usd: float, stage: str, turn_cap: float, run_id: str):
        self.led, self.max_usd, self.stage, self.turn_cap, self.run_id = led, float(max_usd), stage, float(turn_cap), run_id
        self.stage_usd = STAGES[stage]
        self.turn_usd, self.turns_paid, self.total_turn_usd, self.errors, self.bad_stops = 0.0, 0, 0.0, 0, 0
        self.stopped: str | None = None

    def limits(self) -> tuple:
        """The program and stage ceilings, for the ledger to re-check INSIDE its reserve transaction (refuse() alone is a
        read before the write: concurrent processes could all pass it)."""
        return ((RUN_PREFIX, self.max_usd), (f"{RUN_PREFIX}{self.stage}-", self.stage_usd))

    def start_turn(self) -> None:
        self.turn_usd = 0.0

    def refuse(self, worst: float) -> str | None:
        """Why this call may not be made (a ceiling, not an anomaly), or None."""
        if self.stopped:
            return self.stopped
        program = spent(self.led)
        if program + worst > self.max_usd:
            return f"the program's ${self.max_usd:.2f} ceiling: ${program:.4f} committed + worst ${worst:.4f}"
        staged = spent(self.led, f"{RUN_PREFIX}{self.stage}-")
        if staged + worst > self.stage_usd:
            return f"stage {self.stage}'s ${self.stage_usd:.2f}: ${staged:.4f} committed + worst ${worst:.4f}"
        if self.turn_usd + worst > self.turn_cap:
            return f"the ${self.turn_cap:.2f} per-turn cap"
        return None

    def after_call(self, *, worst: float, usage: dict | None, stop_reason: str | None, model: str) -> tuple[float, str | None]:
        """→ (dollars, a stop reason or None)."""
        self.errors = 0
        if usage is None:
            self.turn_usd += worst
            return worst, "a response with no usage"
        actual = ledger.cost_usd(model, **usage)
        self.turn_usd += actual
        if actual > worst * 1.0001:
            return actual, f"a call cost ${actual:.5f}, over its own worst case ${worst:.5f}"
        if stop_reason in ("refusal", "max_tokens"):
            self.bad_stops += 1
            if self.bad_stops >= 2:
                return actual, f"2 calls ended in refusal or max_tokens (last: {stop_reason})"
        if self.turn_usd > ANOMALY_TURN_USD:
            return actual, f"a turn cost ${self.turn_usd:.4f}, over the ${ANOMALY_TURN_USD:.2f} anomaly line"
        return actual, None

    def after_error(self) -> str | None:
        self.errors += 1
        return "3 API errors in a row" if self.errors >= 3 else None

    def end_turn(self) -> str | None:
        if self.turn_usd <= 0:
            return None
        self.turns_paid += 1
        self.total_turn_usd += self.turn_usd
        if self.turns_paid >= MEAN_AFTER_TURNS and self.total_turn_usd / self.turns_paid > ANOMALY_MEAN_USD:
            return f"mean ${self.total_turn_usd / self.turns_paid:.4f} per paid turn after {self.turns_paid}, over ${ANOMALY_MEAN_USD:.2f}"
        return None


def write_stop(reason: str) -> None:
    """Sticky. Content-free: why, and when."""
    with open(stop_path(), "w", encoding="utf-8") as f:
        json.dump({"reason": reason[:300], "at": int(time.time()), "clear": "the owner deletes this file after reading why"}, f)


class Session:
    """One real run: the conversation memory the server's store would hold, and the metered caller. `client_create` is the
    SDK's messages.create; `turn_mod` is api.services.uct_agent.turn. Both are parameters, so a test never needs a key."""

    def __init__(self, *, ceilings: Ceilings, client_create, turn_mod, key_fp: str | None, meter_cls, spend_log: str | None = None):
        self.c, self.create, self.turn, self.key_fp, self.meter_cls, self.spend_log = ceilings, client_create, turn_mod, key_fp, meter_cls, spend_log
        self.history: dict[str, list] = {}
        self.seq = 0

    def caller(self, **kw):
        worst_box: dict = {}

        def run_cap(worst: float) -> str | None:
            worst_box["worst"] = worst
            return self.c.refuse(worst)
        try:
            resp, worst = self.c.led.guarded_call(self.c.run_id, self.create, kw, tool=TOOL, key_fp=self.key_fp, per_run_cap=run_cap, limits=self.c.limits())
        except ledger.LedgerRefused as e:
            self._stop(str(e))
            raise
        except Exception:  # noqa: BLE001 -- the ledger settled or released it; the turn reports the failure
            why = self.c.after_error()
            if why:
                self._stop(why)
            raise
        usage = ledger.usage_tokens(resp)
        usd, why = self.c.after_call(worst=worst, usage=usage, stop_reason=getattr(resp, "stop_reason", None), model=str(kw.get("model") or ""))
        self._log({"calls": 1, "usd": round(usd, 6), **(usage or {})})
        if why:
            self._stop(why)
        return resp

    def _stop(self, why: str) -> None:
        if not self.c.stopped:
            self.c.stopped = why
            write_stop(why)

    def _log(self, row: dict) -> None:
        if self.spend_log:
            with open(self.spend_log, "a", encoding="utf-8") as f:
                f.write(json.dumps({"at": int(time.time()), **row}) + "\n")

    def turn_request(self, b: dict) -> tuple[int, dict]:
        """One POST /api/agent/turn. → (status, the route's JSON). Reroute and history follow the route."""
        if self.c.stopped:
            return 503, {"detail": f"stopped: {self.c.stopped}", "stopped": self.c.stopped}
        cid = b.get("conversationId") or f"ac_autotest_{self.seq}"
        self.seq += 1
        hist = self.history.setdefault(cid, [])
        if not b.get("reroute"):
            self.c.start_turn()
        prior = list(hist)
        if b.get("reroute") and hist and hist[-1].get("role") == "member" and hist[-1].get("text") == b.get("message"):
            prior = hist[:-1]
        elif not b.get("reroute"):
            hist.append({"role": "member", "text": b.get("message") or ""})
        try:
            out = self.turn.run_turn(message=b.get("message") or "", context=b.get("context") or {}, history=prior, capabilities=b.get("capabilities") or [],
                                     pending=b.get("pending"), recent_outcome=b.get("recentOutcome"), manifest_version=b.get("manifestVersion"), routing=b.get("routing"),
                                     caller=self.caller, meter=self.meter_cls(), reroute=bool(b.get("reroute")), interpreter=b.get("interpreter"), repair=b.get("repair"), reference=b.get("reference"))
        except ledger.LedgerRefused as e:
            return 503, {"detail": str(e), "stopped": self.c.stopped}
        except self.turn.TurnError as e:
            reason = str(getattr(e, "reason", "") or "")
            return 400, {"detail": str(e), "unreadable": reason.startswith("unreadable")}
        except Exception as e:  # noqa: BLE001 -- a provider failure is a sentence
            return 503, {"detail": f"provider failure {type(e).__name__}", "stopped": self.c.stopped}
        env, usage = out["envelope"], out["usage"]
        if not env.get("need_groups"):
            hist.append({"role": "agent", "text": env.get("reply") or (env.get("question") or {}).get("text") or ""})
        why = self.c.end_turn() if not env.get("need_groups") else None
        if why:
            self._stop(why)
        return 200, {"conversationId": cid, "turnId": self.seq, "envelope": env, "usage": {**{k: usage.get(k) for k in ("model", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "model_calls")}, "turn_usd": round(self.c.turn_usd, 6), "citations": []}, "stopped": self.c.stopped}

    def record(self, b: dict) -> tuple[int, dict]:
        cid = b.get("conversationId") or f"ac_autotest_{self.seq}"
        hist = self.history.setdefault(cid, [])
        if b.get("member"):
            hist.append({"role": "member", "text": b["member"]})
        if b.get("outcome"):
            hist.append({"role": "outcome", "text": b["outcome"], "data": b.get("outcomeData")})
        return 200, {"conversationId": cid}


def handler_for(session: Session):
    class H(BaseHTTPRequestHandler):
        def log_message(self, *_a):      # content-free: nothing a member typed reaches a log
            return

        def do_POST(self):               # noqa: N802
            n = int(self.headers.get("content-length") or 0)
            try:
                body = json.loads(self.rfile.read(n) or b"{}")
            except ValueError:
                body = {}
            status, out = session.turn_request(body) if self.path == "/turn" else session.record(body)
            raw = json.dumps(out).encode("utf-8")
            self.send_response(status)
            self.send_header("content-type", "application/json")
            self.send_header("content-length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
    return H


def reserve_turn(led: ledger.Ledger, *, stage: str, usd: float, max_usd: float) -> int:
    """Production target: the server spends from its own key and budget, so the ledger holds one turn's cap against this program,
    settled from the server's own /api/agent/budget delta. `key_fp` names no key: production's stays on the server."""
    if os.path.exists(stop_path()):
        raise Refused(f"a stop is in force ({stop_path()})")
    try:
        ledger.refuse_paid_in_scratch(led.path, production=True)    # AUDIT F1: production never books into a scratch ledger
    except ledger.LedgerRefused as e:
        raise Refused(str(e))
    c = Ceilings(led, max_usd=max_usd, stage=stage, turn_cap=usd, run_id=f"{RUN_PREFIX}{stage}-production")
    why = c.refuse(usd)
    if why:
        raise Refused(why)
    try:
        return led.reserve(c.run_id, usd, tool=TOOL, model="claude-haiku-4-5", key_fp="production-session", limits=c.limits())
    except ledger.LedgerRefused as e:
        raise Refused(str(e))


def serve(a) -> int:  # pragma: no cover -- the paid path: exercised only with the owner's file
    auth = read_authorization(target="local", stage=a.stage, public_sha=a.public_sha, heldout_sha=a.heldout_sha)
    import anthropic
    import conftest  # noqa: F401 -- the census and the tripwire, before any api.* import (every *_DB_PATH -> a sandbox)
    from api.services.uct_agent import budget, turn
    from tools.agent_eval_run import CeilingMeter
    model = str(auth.get("model") or "claude-haiku-4-5")
    os.environ["UCT_AGENT_MODEL"] = model
    ledger.stub_research(turn)
    led, key, key_fp = ledger.preflight(turn, max_usd=min(float(auth["max_usd"]), ledger.read_cap()))
    client = anthropic.Anthropic(api_key=key, max_retries=0, timeout=30.0)
    ledger.check_model(client, model)
    ceil = Ceilings(led, max_usd=float(auth["max_usd"]), stage=a.stage, turn_cap=budget.turn_cap_usd(), run_id=f"{RUN_PREFIX}{a.stage}-{int(time.time())}")
    sess = Session(ceilings=ceil, client_create=client.messages.create, turn_mod=turn, key_fp=key_fp, meter_cls=lambda: CeilingMeter(budget.max_calls()), spend_log=a.spend_log)
    srv = ThreadingHTTPServer(("127.0.0.1", 0), handler_for(sess))
    print(f"READY {srv.server_address[1]} {spent(led):.4f}", flush=True)
    srv.serve_forever()
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("check", "serve"):
        p = sub.add_parser(name)
        p.add_argument("--target", default="local")
        p.add_argument("--stage", default="")
        p.add_argument("--public-sha", default="")
        p.add_argument("--heldout-sha", default=None)
        p.add_argument("--spend-log", default=None)
    sub.add_parser("status")
    p = sub.add_parser("reserve")
    p.add_argument("--stage", required=True)
    p.add_argument("--usd", type=float, required=True)
    p = sub.add_parser("settle")
    p.add_argument("--id", type=int, required=True)
    p.add_argument("--usd", type=float, default=None)
    p = sub.add_parser("stop")
    p.add_argument("--why", required=True)
    a = ap.parse_args(argv)
    if a.cmd == "status":
        led = ledger.Ledger(readonly=True)
        print(json.dumps({"program_committed_usd": round(spent(led), 6), "remaining_cumulative_usd": led.remaining(), "stages": STAGES, "stop_in_force": os.path.exists(stop_path())}, indent=1))
        return 0
    try:
        if a.cmd == "stop":
            write_stop(a.why)
            print("stopped")
            return 0
        if a.cmd == "reserve":
            with open(auth_path(), encoding="utf-8") as f:
                au = json.load(f)
            # re-checked on EVERY reservation, so a run cannot outlive its authorization (the hashes were checked at start)
            if au.get("approved_by") != "owner" or "production" not in (au.get("targets") or []) or a.stage not in (au.get("stages") or []):
                raise Refused(f"the authorization does not cover production stage {a.stage}")
            if time.time() > time.mktime(time.strptime(str(au.get("expires")), "%Y-%m-%d")) + 86400:
                raise Refused(f"the authorization expired on {au.get('expires')}")
            max_usd = float(au["max_usd"])
            print(json.dumps({"id": reserve_turn(ledger.Ledger(), stage=a.stage, usd=a.usd, max_usd=min(max_usd, MAX_AUTHORIZED_USD))}))
            return 0
        if a.cmd == "settle":
            charged = ledger.Ledger().settle(a.id, a.usd, None, outcome="ok" if a.usd is not None else "worst_case")
            if charged > ANOMALY_TURN_USD:
                write_stop(f"a production turn cost ${charged:.4f}, over the ${ANOMALY_TURN_USD:.2f} anomaly line")
                print(f"refused: a production turn cost ${charged:.4f}")
                return 2
            print(json.dumps({"usd": charged}))
            return 0
        if a.cmd == "check":
            auth = read_authorization(target=a.target, stage=a.stage, public_sha=a.public_sha, heldout_sha=a.heldout_sha)
            led = ledger.Ledger()
            cap = led.cap()
            left = led.remaining()
            if a.target == "local":
                ledger.eval_key()
            print(json.dumps({"ok": True, "max_usd": auth["max_usd"], "ledger_cap_usd": cap, "ledger_left_usd": left, "program_committed_usd": round(spent(led), 6)}))
            return 0
        return serve(a)
    except (Refused, ledger.LedgerRefused) as e:
        print(f"refused: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
