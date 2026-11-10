"""UCT Agent AUTOTEST: the $8 cap under CONCURRENCY. NO PAID CALL: no SDK, no key, no network, no model.

N separate OS processes race to reserve 40 x $0.25 against an $8 ceiling. At most 32 may be granted, and the
ledger's committed total may never pass the ceiling. Three ceilings are raced:
  ledger   the cumulative ledger's own cap file (agent-eval-cap.json = 8.0)          -> Ledger.reserve
  program  the authorization's max_usd = 8 (stage budget lifted to 8 in the child)  -> gate.reserve_turn
  stage    the canary stage's real $0.50                                             -> gate.reserve_turn (at most 2)
plus a sequential check that a production turn settled over its reservation writes the STOP file and the next reserve
is refused before any further call.

Everything lives in a temp directory. The ledger / authorization / stop overrides are the suite's own test hooks, which
the ledger honours only when PYTEST_CURRENT_TEST is set; when this file is run directly (`python tests/test_agent_autotest_cap_race.py`)
it sets that variable for its CHILD processes only, pointing them at the temp files. The pinned C:/UCT files are never read
or written.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
N, USD, CAP = 40, 0.25, 8.0
PUB = "a" * 64

CHILD = r"""
import json, os, sys, time
sys.path.insert(0, os.environ['RACE_ROOT'])
from tools import agent_eval_ledger as ledger
from tools import agent_autotest_gate as gate
go = os.environ['RACE_GO']
while not os.path.exists(go):
    time.sleep(0.002)
mode = os.environ['RACE_MODE']
try:
    if mode == 'ledger':
        rid = ledger.Ledger().reserve('autotest-race-ledger', float(os.environ['RACE_USD']), tool='race')
    else:
        if mode == 'program':
            gate.STAGES['canary'] = 8.0      # lift the stage budget so the PROGRAM ceiling is the one raced
        # exactly what reserve_turn books, minus its scratch-world refusal (production never books into a scratch ledger)
        c = gate.Ceilings(ledger.Ledger(), max_usd=8.0, stage='canary', turn_cap=0.25, run_id='autotest-canary-production')
        why = c.refuse(float(os.environ['RACE_USD']))
        if why:
            raise gate.Refused(why)
        rid = c.led.reserve(c.run_id, float(os.environ['RACE_USD']), tool='race', limits=c.limits())
    print(json.dumps({'granted': rid}))
except (gate.Refused, ledger.LedgerRefused) as e:
    print(json.dumps({'refused': str(e)[:120]}))
"""


def _setup(d: str, cap_usd: float) -> dict:
    with open(os.path.join(d, "agent-eval-cap.json"), "w") as f:
        json.dump({"cap_usd": cap_usd}, f)
    with open(os.path.join(d, "auth.json"), "w") as f:
        json.dump({"approved_by": "owner", "max_usd": 8, "expires": "2099-01-01", "targets": ["production"], "stages": ["canary"],
                   "public_set_sha256": PUB, "heldout_sha256": None}, f)
    env = dict(os.environ)
    env.update({"PYTEST_CURRENT_TEST": env.get("PYTEST_CURRENT_TEST") or "cap_race (scratch ledger)",
                "UCT_AGENT_EVAL_LEDGER": os.path.join(d, "ledger.db"),
                "UCT_AGENT_AUTOTEST_AUTH": os.path.join(d, "auth.json"),
                "UCT_AGENT_AUTOTEST_STOP": os.path.join(d, "stop.json"),
                "RACE_ROOT": ROOT, "RACE_GO": os.path.join(d, "go"), "RACE_USD": str(USD)})
    return env


def _committed(env: dict) -> float:
    out = subprocess.run([sys.executable, "-c",
                          "import os,sys;sys.path.insert(0,os.environ['RACE_ROOT']);from tools import agent_eval_ledger as l;"
                          "a,b=l.Ledger().committed();print(a+b)"], env=env, capture_output=True, text=True, timeout=120)
    return float(out.stdout.strip())


def race(mode: str, cap_usd: float = 21.0) -> dict:
    with tempfile.TemporaryDirectory() as d:
        env = _setup(d, cap_usd)
        env["RACE_MODE"] = mode
        # create the schema once so every child starts on the same file
        subprocess.run([sys.executable, "-c", "import os,sys;sys.path.insert(0,os.environ['RACE_ROOT']);"
                        "from tools import agent_eval_ledger as l;l.Ledger().committed()"], env=env, check=True, timeout=120)
        procs = [subprocess.Popen([sys.executable, "-c", CHILD], env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
                 for _ in range(N)]
        time.sleep(3.0)                                    # every child imported and is spinning on the start file
        open(env["RACE_GO"], "w").close()
        res = [json.loads((p.communicate(timeout=300)[0].strip().splitlines() or ['{"refused":"no output"}'])[-1]) for p in procs]
        granted = sum(1 for r in res if "granted" in r)
        return {"mode": mode, "granted": granted, "refused": N - granted, "committed_usd": round(_committed(env), 6)}


def overrun_stops() -> dict:
    """Sequential: one production turn settled at $0.30 (over its $0.25 reservation) -> STOP file -> next reserve refused."""
    with tempfile.TemporaryDirectory() as d:
        env = _setup(d, 21.0)
        code = ("import os,sys,json;sys.path.insert(0,os.environ['RACE_ROOT']);from tools import agent_autotest_gate as g;"
                "import io,contextlib\n"
                "def run(a):\n b=io.StringIO()\n with contextlib.redirect_stdout(b): rc=g.main(a)\n return rc,b.getvalue().strip()\n"
                "from tools import agent_eval_ledger as l;rid=l.Ledger().reserve('autotest-canary-production',0.25,tool='race')\n"
                "r2=run(['settle','--id',str(rid),'--usd','0.30'])\n"
                "r3=run(['reserve','--stage','canary','--usd','0.25'])\n"
                "print(json.dumps({'settle_rc':r2[0],'stop_file':os.path.exists(os.environ['UCT_AGENT_AUTOTEST_STOP']),'next_reserve_rc':r3[0],'next':r3[1][:90]}))")
        out = subprocess.run([sys.executable, "-c", code], env=env, capture_output=True, text=True, timeout=120)
        return json.loads(out.stdout.strip().splitlines()[-1])


FAKE_KEY = "sk-ant-api03-" + "x" * 80          # real-looking; never sent anywhere (the fake client only records a call)
BYPASS = r"""
import json, os, sys
sys.path.insert(0, os.environ['RACE_ROOT'])
from tools import agent_eval_ledger as ledger
from tools import agent_autotest_gate as gate
KW = {"model": "claude-haiku-4-5", "max_tokens": 64, "system": "s", "messages": [{"role": "user", "content": "x"}]}
calls = []
def fake(**kw):
    calls.append(1)
    raise RuntimeError("fake client: no network")
out = {}
try:
    ledger.Ledger().guarded_call("autotest-bypass", fake, KW, tool="bypass")
    out["guarded_call"] = "ALLOWED"
except ledger.LedgerRefused as e:
    out["guarded_call"] = "refused" if "override" in str(e) else "refused-other: " + str(e)[:80]
except RuntimeError:
    out["guarded_call"] = "ALLOWED"
try:
    gate.reserve_turn(ledger.Ledger(), stage="canary", usd=0.25, max_usd=8.0)
    out["reserve_turn"] = "ALLOWED"
except (gate.Refused, ledger.LedgerRefused) as e:
    out["reserve_turn"] = "refused" if "override" in str(e) else "refused-other: " + str(e)[:80]
out["fake_client_calls"] = len(calls)
print(json.dumps(out))
"""


def bypass(key: bool) -> dict:
    """AUDIT F1 rail, OUTSIDE pytest: a plain process FAKES PYTEST_CURRENT_TEST and points the ledger, the authorization
    and the STOP file at a fresh temp dir (= a fresh cap). With a real-looking key every paid path must refuse before the
    client; the production reserve must refuse with or without a key. The no-key control shows the fake client IS
    reachable there, so the refusal comes from the rail and nothing else."""
    with tempfile.TemporaryDirectory() as d:
        env = _setup(d, 21.0)
        env["PYTEST_CURRENT_TEST"] = "faked by a plain process"
        for k in ("UCT_AGENT_EVAL_API_KEY", "ANTHROPIC_API_KEY"):
            env.pop(k, None)
        if key:
            env["UCT_AGENT_EVAL_API_KEY"] = FAKE_KEY
        out = subprocess.run([sys.executable, "-c", BYPASS], env=env, capture_output=True, text=True, timeout=120)
        return json.loads(out.stdout.strip().splitlines()[-1])


def bypass_ok(with_key: dict, no_key: dict) -> bool:
    return (with_key == {"guarded_call": "refused", "reserve_turn": "refused", "fake_client_calls": 0}
            and no_key["reserve_turn"] == "refused" and no_key["fake_client_calls"] == 1)


def test_RAIL_scratch_override_refuses_every_paid_path_outside_pytest():
    w, n = bypass(True), bypass(False)
    assert bypass_ok(w, n), (w, n)


def test_ledger_cap_holds_across_processes():
    r = race("ledger", cap_usd=CAP)
    assert r["granted"] <= 32 and r["committed_usd"] <= CAP + 1e-9, r


def test_program_cap_holds_across_processes():
    r = race("program")
    assert r["granted"] <= 32 and r["committed_usd"] <= CAP + 1e-9, r


def test_stage_cap_holds_across_processes():
    r = race("stage")
    assert r["granted"] <= 2 and r["committed_usd"] <= 0.5 + 1e-9, r


def test_turn_over_reservation_stops_before_next_call():
    r = overrun_stops()
    assert r["settle_rc"] == 2 and r["stop_file"] and r["next_reserve_rc"] == 2 and "stop is in force" in r["next"], r


if __name__ == "__main__":
    rows = [race("ledger", cap_usd=CAP), race("program"), race("stage")]
    ok = rows[0]["granted"] <= 32 and rows[0]["committed_usd"] <= CAP and rows[1]["granted"] <= 32 and rows[1]["committed_usd"] <= CAP \
        and rows[2]["granted"] <= 2 and rows[2]["committed_usd"] <= 0.5
    o = overrun_stops()
    ok = ok and o["settle_rc"] == 2 and o["stop_file"] and o["next_reserve_rc"] == 2 and "stop is in force" in o["next"]
    bw, bn = bypass(True), bypass(False)
    ok = ok and bypass_ok(bw, bn)
    print(json.dumps({"bypass_with_key": bw, "bypass_no_key": bn}))
    for r in rows:
        print(json.dumps(r))
    print(json.dumps({"overrun": o}))
    print("PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)
