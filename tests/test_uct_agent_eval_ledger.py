"""Wave 1 A-03 — the CUMULATIVE evaluation ledger (tools/agent_eval_ledger.py) and the owner's six proofs
(2026-11-02): (1) every eval tool uses ONLY the separate eval key; (2) one durable ledger shared by every
process; (3) the $21 cap holds under threads, processes, retries and separate runs; (4) the model is checked
on the eval account before any spend; (5) no paid secondary provider; (6) production is untouched.
Plus A-02: the effort switch is inert when unset. No model call, no network anywhere in this file."""
from __future__ import annotations

import ast
import glob
import importlib.util
import json
import os
import subprocess
import sys
import threading
import types

import pytest

from tools import agent_eval_ledger as L

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PY = sys.executable
TOOLS = sorted(glob.glob(os.path.join(ROOT, "tools", "agent_*.py")))
PAID_TOOLS = ("agent_eval_run.py", "agent_live_batch.py", "agent_latency_probe.py", "agent_live_chain.py", "agent_smoke_context_breadth.py")


# ── fixtures ────────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def led(tmp_path, monkeypatch):
    path = str(tmp_path / "ledger.db")
    monkeypatch.setenv(L.LEDGER_ENV, path)
    (tmp_path / L.CAP_FILE_NAME).write_text(json.dumps({"cap_usd": 21.0}), encoding="utf-8")
    return L.Ledger(path)


def _write_cap(led_, cap):
    with open(L.cap_file_path(led_.path), "w", encoding="utf-8") as f:
        json.dump({"cap_usd": cap}, f)


def _resp(inp=1000, out=50, read=0, write=0):
    return types.SimpleNamespace(usage=types.SimpleNamespace(input_tokens=inp, output_tokens=out, cache_read_input_tokens=read,
                                                             cache_creation_input_tokens=write), content=[], stop_reason="end_turn")


KW = {"model": "claude-haiku-5-5", "max_tokens": 4096, "system": [{"type": "text", "text": "x" * 4000}],
      "messages": [{"role": "user", "content": "hello"}], "output_config": {"format": {"type": "json_schema", "schema": {}}}}


# ── the cap: min(code, the owner's file); the file alone can only lower it ─────────────────────────
def test_cap_is_the_minimum_of_the_code_constant_and_the_owner_file(led):
    assert L.CUMULATIVE_CAP_USD == 21.0
    assert led.cap() == 21.0
    _write_cap(led, 500.0)                        # MUTATION: the file alone cannot raise it
    assert led.cap() == 21.0
    _write_cap(led, 1.5)                          # …but it can lower it, at once
    assert led.cap() == 1.5
    with pytest.raises(L.LedgerRefused) as e:
        led.reserve("r", 2.0)
    assert e.value.reason == "cap"


def test_a_missing_or_broken_cap_file_refuses_every_reservation(led):
    os.remove(L.cap_file_path(led.path))
    with pytest.raises(L.LedgerRefused) as e:
        led.reserve("r", 0.01)
    assert e.value.reason == "cap_file"
    with open(L.cap_file_path(led.path), "w", encoding="utf-8") as f:
        f.write("{not json")
    with pytest.raises(L.LedgerRefused):
        led.reserve("r", 0.01)
    _write_cap(led, 0)
    with pytest.raises(L.LedgerRefused):
        led.reserve("r", 0.01)


def test_no_environment_variable_raises_the_cap(led, monkeypatch):
    src = open(L.__file__, encoding="utf-8").read()
    assert "CUMULATIVE_CAP_USD = 21.0" in src
    for name in ("UCT_AGENT_EVAL_CAP", "UCT_AGENT_EVAL_CAP_USD", "AGENT_EVAL_CAP"):
        assert name not in src
    tree = ast.parse(src)
    reads = [n for n in ast.walk(tree) if isinstance(n, ast.Constant) and isinstance(n.value, str) and n.value.endswith("CAP")]
    assert reads == []


# ── reserve / settle / release ──────────────────────────────────────────────────────────────────
def test_reserve_then_settle_replaces_the_worst_case_with_the_actual(led):
    rid = led.reserve("run-1", 0.5, tool="t", model="claude-haiku-5-5", key_fp="abcd1234")
    assert led.committed() == (0.5, 0.0)
    charged = led.settle(rid, usage={"input": 10_000, "output": 1_000, "cache_read": 0, "cache_write": 0}, model="claude-haiku-5-5")
    assert charged == pytest.approx(10_000 * 0.10 / 1e6 + 1_000 * 0.50 / 1e6)
    assert led.committed() == (0.0, pytest.approx(charged))
    assert led.settle(rid, usage={"input": 1}) == 0.0           # settled once; a second settle changes nothing
    row = led.rows()[0]
    assert (row["status"], row["input_tokens"], row["output_tokens"], row["key_fp"]) == ("settled", 10_000, 1_000, "abcd1234")


def test_settle_without_usage_charges_the_worst_case(led):
    rid = led.reserve("run-1", 0.25)
    assert led.settle(rid, None, None) == 0.25
    assert led.rows()[0]["outcome"] == "no_usage"
    rid = led.reserve("run-1", 0.25)
    assert led.settle(rid, None, None, outcome="worst_case") == 0.25
    assert led.rows()[0]["outcome"] == "worst_case"


def test_actual_cost_prices_input_cache_write_cache_read_and_output_at_the_dearer_table():
    # Haiku 5.5: $0.10 in, cache write 1.25x = $0.125, cache read $0.01, $0.50 out (per MTok); thinking is inside output
    # (10K-token prompts: the per-prompt >100K tier is tested below)
    assert L.cost_usd("claude-haiku-5-5", input=10_000) == pytest.approx(0.10 / 100)
    assert L.cost_usd("claude-haiku-5-5", cache_write=10_000) == pytest.approx(0.125 / 100)
    assert L.cost_usd("claude-haiku-5-5", cache_read=10_000) == pytest.approx(0.01 / 100)
    assert L.cost_usd("claude-haiku-5-5", output=1_000_000) == pytest.approx(0.50)
    # Sonnet 5.5: $2 in, cache write $2.50, cache read $0.10 (0.05x, the published page), $10 out — both tables agree;
    # the DEARER of the two is always charged, so a future disagreement can only over-count
    assert L.cost_usd("claude-sonnet-5-5", input=1_000_000) == pytest.approx(2.0)
    assert L.cost_usd("claude-sonnet-5-5", cache_write=1_000_000) == pytest.approx(2.5)
    assert L.cost_usd("claude-sonnet-5-5", cache_read=1_000_000) == pytest.approx(0.10)
    assert L.cost_usd("claude-sonnet-5-5", output=1_000_000) == pytest.approx(10.0)
    # Haiku 4.5 (production): $1 / $5
    assert L.cost_usd("claude-haiku-4-5", input=1_000_000, output=1_000_000) == pytest.approx(6.0)
    # Haiku 5.5 over 100K prompt tokens: the higher tier
    assert L.cost_usd("claude-haiku-5-5", input=200_000) == pytest.approx(200_000 * 0.50 / 1e6)
    with pytest.raises(L.LedgerRefused):
        L.cost_usd("claude-unknown-9", input=1)


def test_worst_case_is_every_request_byte_as_a_cache_write_plus_framing_plus_full_output():
    kw = dict(KW)
    n = L.request_bytes(kw)
    assert n >= 4000
    expect = L.cost_usd("claude-haiku-5-5", cache_write=n + L.FRAMING_TOKENS, output=4096)
    assert L.worst_case_usd(kw) == pytest.approx(expect)
    assert L.worst_case_usd({**kw, "max_tokens": 8192}) > expect


def test_guarded_call_reserves_before_and_settles_after(led):
    calls = []
    resp, worst = led.guarded_call("run-1", lambda **kw: calls.append(kw) or _resp(), KW, tool="t")
    assert len(calls) == 1 and worst == pytest.approx(L.worst_case_usd(KW))
    reserved, settled = led.committed()
    assert reserved == 0.0 and 0 < settled < worst
    assert led.rows()[0]["status"] == "settled"


def test_release_only_on_a_provider_error_status_a_timeout_settles_at_the_worst_case(led):
    import anthropic
    import httpx

    def status_error(**kw):
        raise anthropic.BadRequestError("bad", response=httpx.Response(400, request=httpx.Request("POST", "http://x")), body=None)

    with pytest.raises(anthropic.BadRequestError):
        led.guarded_call("run-1", status_error, KW, tool="t")
    assert led.rows()[0]["status"] == "released" and led.committed() == (0.0, 0.0)

    def timeout(**kw):
        raise anthropic.APITimeoutError(request=httpx.Request("POST", "http://x"))

    with pytest.raises(anthropic.APITimeoutError):
        led.guarded_call("run-1", timeout, KW, tool="t")
    worst = L.worst_case_usd(KW)
    assert led.rows()[0]["status"] == "settled" and led.rows()[0]["outcome"] == "worst_case"
    assert led.committed()[1] == pytest.approx(worst, abs=1e-6)
    # a RETRY after the timeout is a NEW reservation (the SDK never retries by itself: max_retries=0 everywhere)
    led.guarded_call("run-1", lambda **kw: _resp(), KW, tool="t")
    assert len(led.rows()) == 3 and led.committed()[1] > worst


def test_the_per_run_ceiling_is_checked_before_anything_is_reserved(led):
    with pytest.raises(L.LedgerRefused) as e:
        led.guarded_call("run-1", lambda **kw: _resp(), KW, tool="t", per_run_cap=lambda w: "over the run's ceiling")
    assert e.value.reason == "run_cap" and led.rows() == []


def test_a_crashed_run_keeps_counting_until_the_owner_releases_it_by_hand(led, capsys):
    rid = led.reserve("crashed", 3.0)
    assert led.remaining() == pytest.approx(18.0)
    assert L.main(["release", str(rid)]) == 2                    # needs --confirm
    assert "refused" in capsys.readouterr().out
    assert L.main(["release", str(rid), "--confirm", "the run died at 10:41"]) == 0
    assert led.remaining() == pytest.approx(21.0) and led.rows()[0]["outcome"] == "owner_release"
    assert L.main(["release", str(rid), "--confirm", "again"]) == 1


# ── proof 3: the cap holds under concurrency, retries and separate runs ──────────────────────────
def test_separate_runs_share_one_cap(led):
    _write_cap(led, 1.0)
    led.reserve("run-A", 0.6)
    with pytest.raises(L.LedgerRefused):
        led.reserve("run-B", 0.5)
    led.reserve("run-B", 0.4)
    assert led.committed()[0] == pytest.approx(1.0)
    with pytest.raises(L.LedgerRefused):
        led.reserve("run-C", 0.01)


def test_forty_concurrent_reserves_never_pass_the_cap(led):
    _write_cap(led, 10.0)
    ok, refused, errors = [], [], []
    start = threading.Barrier(40)

    def worker(i):
        start.wait()
        try:
            ok.append(L.Ledger(led.path).reserve(f"run-{i % 5}", 0.5))
        except L.LedgerRefused:
            refused.append(i)
        except Exception as e:  # noqa: BLE001
            errors.append(repr(e))

    ts = [threading.Thread(target=worker, args=(i,)) for i in range(40)]
    for t in ts:
        t.start()
    for t in ts:
        t.join(60)
    assert errors == []
    assert len(ok) == 20 and len(refused) == 20
    assert led.committed()[0] == pytest.approx(10.0)


_CHILD = """
import os, sys, json
sys.path.insert(0, %r)
from tools import agent_eval_ledger as L
led = L.Ledger(os.environ["UCT_AGENT_EVAL_LEDGER"])
got = []
for i in range(4):
    try:
        got.append(led.reserve(sys.argv[1], 0.3, tool="child"))
    except L.LedgerRefused:
        got.append(None)
print(json.dumps(got))
"""


def test_two_processes_reserve_against_one_cap_and_the_second_is_refused_at_the_line(led):
    _write_cap(led, 1.0)                                          # three $0.30 reservations fit, a fourth does not
    env = {**os.environ, L.LEDGER_ENV: led.path}
    procs = [subprocess.Popen([PY, "-c", _CHILD % ROOT, f"proc-{i}"], env=env, cwd=ROOT, stdout=subprocess.PIPE, text=True) for i in range(2)]
    outs = [json.loads(p.communicate(timeout=120)[0]) for p in procs]
    wins = [x for o in outs for x in o if x is not None]
    assert len(wins) == 3 and len(set(wins)) == 3
    assert sum(1 for o in outs for x in o if x is None) == 5
    assert led.committed()[0] == pytest.approx(0.9)
    with pytest.raises(L.LedgerRefused):
        led.reserve("parent", 0.3)


def test_the_ledger_path_is_shared_and_resolved_the_same_way_everywhere(monkeypatch, tmp_path):
    monkeypatch.setenv(L.LEDGER_ENV, str(tmp_path / "x.db"))
    assert L.ledger_path() == str(tmp_path / "x.db")                 # under pytest: a scratch ledger (its cap file beside it)
    assert L.cap_file_path() == str(tmp_path / L.CAP_FILE_NAME)
    monkeypatch.delenv(L.LEDGER_ENV)
    # the pinned location per platform — the RESOLVER's answer (the real directory is never created by a test)
    monkeypatch.setattr(L.os, "name", "nt")
    assert L.pinned_ledger() == L.WINDOWS_LEDGER == r"C:\UCT\agent-eval-ledger.db"
    monkeypatch.setattr(L.os, "name", "posix")
    assert L.pinned_ledger() == L.POSIX_LEDGER == "/var/lib/uct-agent-eval/agent-eval-ledger.db"
    assert str(L._pure(L.POSIX_LEDGER).parent) == "/var/lib/uct-agent-eval"          # never an empty dirname
    assert L.cap_file_path(L.POSIX_LEDGER) == "/var/lib/uct-agent-eval/agent-eval-cap.json"
    monkeypatch.setattr(L.os, "name", "nt")
    assert L.cap_file_path(L.WINDOWS_LEDGER) == r"C:\UCT\agent-eval-cap.json"
    monkeypatch.undo()
    assert L.pinned_ledger() == (L.WINDOWS_LEDGER if os.name == "nt" else L.POSIX_LEDGER)
    with open(L.__file__, encoding="utf-8") as f:
        src = f.read()
    assert "PRAGMA journal_mode=WAL" in src and 'environ.get("HOME' not in src and "expanduser" not in src and "USERPROFILE" not in src
    for t in PAID_TOOLS:                                          # every tool resolves the path through the ONE module
        src = open(os.path.join(ROOT, "tools", t), encoding="utf-8").read()
        assert "from tools import agent_eval_ledger as ledger" in src


def test_the_override_is_refused_outside_pytest_and_there_is_no_fallback_ledger(monkeypatch, tmp_path):
    src = open(L.__file__, encoding="utf-8").read()
    assert not hasattr(L, "FALLBACK_LEDGER") and "HERE, \".agent" not in src and ".agent-eval-ledger" not in src
    monkeypatch.setenv(L.LEDGER_ENV, str(tmp_path / "elsewhere.db"))
    (tmp_path / L.CAP_FILE_NAME).write_text('{"cap_usd": 21.0}', encoding="utf-8")
    monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)         # a worker outside the test suite
    with pytest.raises(L.LedgerRefused) as e:
        L.ledger_path()
    assert "only under pytest" in str(e.value)
    with pytest.raises(L.LedgerRefused):
        L.Ledger(str(tmp_path / "elsewhere.db"))                     # an explicit path is no way around it either
    with pytest.raises(L.LedgerRefused):
        L.Ledger()                                                   # (the override is still set: refused, not fallen back on)
    ro = L.Ledger(str(tmp_path / "elsewhere.db"), readonly=True)     # the report may READ any file…
    with pytest.raises(L.LedgerRefused):
        ro.reserve("r", 0.01)                                        # …never reserve against it
    monkeypatch.delenv(L.LEDGER_ENV)
    # outside pytest, without the override: the pinned file of THIS platform — asserted through the resolver with the
    # directory step stubbed (a test never creates the real pinned directory; CI cannot)
    made = []
    monkeypatch.setattr(L.os, "makedirs", lambda d, exist_ok=False: made.append(d))
    monkeypatch.setattr(L.os, "access", lambda p, m: True)
    for name, pinned, parent in (("nt", L.WINDOWS_LEDGER, r"C:\UCT"), ("posix", L.POSIX_LEDGER, "/var/lib/uct-agent-eval")):
        monkeypatch.setattr(L.os, "name", name)
        assert L.ledger_path() == pinned
        assert made[-1] == parent                                    # a real directory name on both platforms, never ''
    # the pinned directory cannot be created → refused, never a fallback (the POSIX branch is still patched in)
    monkeypatch.setattr(L.os, "makedirs", lambda d, exist_ok=False: (_ for _ in ()).throw(OSError("read-only")))
    with pytest.raises(L.LedgerRefused) as e:
        L.ledger_path()
    assert "cannot be created" in str(e.value) and "/var/lib/uct-agent-eval" in str(e.value)
    # …or exists but is not writable → refused too
    monkeypatch.setattr(L.os, "makedirs", lambda d, exist_ok=False: None)
    monkeypatch.setattr(L.os, "access", lambda p, m: False)
    with pytest.raises(L.LedgerRefused) as e:
        L.ledger_path()
    assert "not writable" in str(e.value)


def test_live_chain_settles_each_turn_request_at_the_worst_case_without_usage_or_a_non_200():
    chain = _load("agent_live_chain.py")
    usage = {"model": "claude-haiku-4-5", "input_tokens": 10_000, "output_tokens": 200, "cache_read_tokens": 0, "cache_write_tokens": 0}
    actual = chain.chain_charge(200, usage)
    assert actual == pytest.approx(chain.NAMING_ALLOWANCE_USD + L.cost_usd("claude-haiku-4-5", input=10_000, output=200))
    assert actual < chain.WORST_TURN_USD
    assert chain.chain_charge(503, usage) == chain.WORST_TURN_USD            # not a 200: the backend may have charged the worst case
    assert chain.chain_charge(200, None) == chain.WORST_TURN_USD             # no usage at all
    assert chain.chain_charge(200, {}) == chain.WORST_TURN_USD               # usage without token counts
    assert chain.chain_charge(None, usage) == chain.WORST_TURN_USD           # no response (a failed fetch)
    src = open(os.path.join(ROOT, "tools", "agent_live_chain.py"), encoding="utf-8").read()
    on_turn = src[src.index("def on_turn(route):"):src.index("c.route(")]
    assert "led.reserve(run_id, WORST_TURN_USD" in on_turn and "route.fetch()" in on_turn   # reserved per request, before the fetch
    assert 'led.settle(rid, None, outcome="worst_case")' in on_turn                        # a failed fetch: the full worst case
    assert "turn_actual_usd" not in src


# ── proof 1: only the eval key, in every tool, before any client ────────────────────────────────
def _load(name):
    spec = importlib.util.spec_from_file_location(name.replace(".py", "_t"), os.path.join(ROOT, "tools", name))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


@pytest.fixture
def no_client(monkeypatch):
    import anthropic
    built = []
    monkeypatch.setattr(anthropic, "Anthropic", lambda *a, **k: built.append(k) or (_ for _ in ()).throw(AssertionError("a client was built")))
    return built


@pytest.mark.parametrize("prod,evalk", [("sk-prod", None), ("sk-prod", "sk-prod"), ("sk-prod", "")])
def test_every_paid_tool_refuses_without_the_separate_eval_key_before_any_client(led, no_client, monkeypatch, tmp_path, capsys, prod, evalk):
    monkeypatch.setenv("ANTHROPIC_API_KEY", prod)
    if evalk is None:
        monkeypatch.delenv(L.EVAL_KEY_ENV, raising=False)
    else:
        monkeypatch.setenv(L.EVAL_KEY_ENV, evalk)
    bodies = tmp_path / "b.json"
    bodies.write_text("[]", encoding="utf-8")
    run = _load("agent_eval_run.py")
    assert L.EVAL_KEY_ENV in (run.refusal(types.SimpleNamespace(max_usd=1.0, model="claude-haiku-5-5"), run.load_prices()) or "")
    monkeypatch.setattr("sys.argv", ["x", str(bodies), "--model", "claude-haiku-5-5", "--mode", "legacy", "--run", "--max-usd", "1"])
    assert run.main() == 2
    batch = _load("agent_live_batch.py")
    monkeypatch.setattr("sys.argv", ["x", str(bodies), "--run", "--max-usd", "1"])
    assert batch.main() == 2
    probe = _load("agent_latency_probe.py")
    monkeypatch.setattr("sys.argv", ["x", str(bodies), "--run", "--max-usd", "0.5"])
    assert probe.main() == 2
    chain = _load("agent_live_chain.py")
    with pytest.raises(L.LedgerRefused) as e:
        chain.live_preflight(1.0)
    assert e.value.reason == "key"
    assert chain.run("live", 1.0, None) == 2
    smoke = _load("agent_smoke_context_breadth.py")
    monkeypatch.setattr("sys.argv", ["x", str(bodies), "--run", "--max-usd", "0.2"])
    assert smoke.main() == 2
    out = capsys.readouterr().out
    assert out.count(L.EVAL_KEY_ENV) >= 5
    assert no_client == []                                        # refused BEFORE constructing any client


def _env_reads(tree):
    """os.environ.get(X) / os.environ[X] / os.getenv(X): the X nodes."""
    out = []
    for n in ast.walk(tree):
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr in ("get", "getenv") and n.args:
            if ast.unparse(n.func.value) in ("os.environ", "os"):
                out.append(n.args[0])
        if isinstance(n, ast.Subscript) and ast.unparse(n.value) == "os.environ":
            out.append(n.slice)
    return out


def test_RAIL_no_eval_tool_reads_the_production_key_except_the_ledgers_one_refusal_site():
    for path in TOOLS:
        name = os.path.basename(path)
        tree = ast.parse(open(path, encoding="utf-8").read())
        reads = [ast.unparse(x) for x in _env_reads(tree)]
        if name == "agent_eval_ledger.py":
            assert reads.count("PROD_KEY_ENV") == 1 and '"ANTHROPIC_API_KEY"' not in reads
            continue
        assert not any("ANTHROPIC_API_KEY" in r or "PROD_KEY_ENV" in r for r in reads), (name, reads)
        # nor through the production engine's client (which reads the production key)
        assert "_get_anthropic_client" not in open(path, encoding="utf-8").read(), name


def test_RAIL_every_eval_client_is_built_with_max_retries_0_on_the_eval_key():
    seen = 0
    for path in TOOLS:
        tree = ast.parse(open(path, encoding="utf-8").read())
        for n in ast.walk(tree):
            if isinstance(n, ast.Call) and ast.unparse(n.func) in ("anthropic.Anthropic", "Anthropic"):
                kws = {k.arg: ast.unparse(k.value) for k in n.keywords}
                assert kws.get("max_retries") == "0", (path, kws)
                assert kws.get("api_key") in ("key", "os.environ[EVAL_KEY_ENV]"), (path, kws)
                seen += 1
    assert seen >= 5


# ── proof 4: the model on the eval account, checked (free) before any spend ──────────────────────
def test_check_model_prints_the_lookup_and_refuses_a_failing_one(capsys):
    ok = types.SimpleNamespace(max_retries=0, models=types.SimpleNamespace(retrieve=lambda m: types.SimpleNamespace(id=m, display_name="Claude Haiku 5.5")))
    assert L.check_model(ok, "claude-haiku-5-5") == "Claude Haiku 5.5"
    assert "claude-haiku-5-5 available (Claude Haiku 5.5)" in capsys.readouterr().out

    def boom(m):
        raise RuntimeError("no such model")
    with pytest.raises(L.LedgerRefused) as e:
        L.check_model(types.SimpleNamespace(max_retries=0, models=types.SimpleNamespace(retrieve=boom)), "claude-x")
    assert "not available on the eval account" in str(e.value)
    with pytest.raises(L.LedgerRefused):
        L.check_model(types.SimpleNamespace(max_retries=2, models=ok.models), "claude-haiku-5-5")


def test_preflight_refuses_a_run_ceiling_over_the_cap_or_over_what_is_left(led, monkeypatch):
    from api.services.uct_agent import turn
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-prod")
    monkeypatch.setenv(L.EVAL_KEY_ENV, "sk-eval")
    L.stub_research(turn)
    with pytest.raises(L.LedgerRefused) as e:
        L.preflight(turn, max_usd=25.0)
    assert "over the cumulative cap" in str(e.value)
    led.reserve("earlier", 20.5)
    with pytest.raises(L.LedgerRefused) as e:
        L.preflight(turn, max_usd=1.0)
    assert e.value.reason == "cap"
    l2, key, fp = L.preflight(turn, max_usd=0.25)
    assert key == "sk-eval" and fp == L.key_fingerprint("sk-eval") and len(fp) == 8 and fp != "sk-eval"
    with pytest.raises(L.LedgerRefused):
        L.preflight(turn, max_usd=None)


# ── proof 5: no paid secondary provider ─────────────────────────────────────────────────────────
def test_research_is_stubbed_in_every_eval_process_and_the_stub_never_reaches_perplexity(monkeypatch):
    from api.services.uct_agent import turn
    import api.services.perplexity_search as pplx

    def never(**kw):
        raise AssertionError("web_search was called")
    monkeypatch.setattr(pplx, "web_search", never)
    monkeypatch.setattr(turn, "_research", turn._research.__wrapped__ if hasattr(turn._research, "__wrapped__") else turn._research)
    if getattr(turn._research, "_eval_stub", False):
        monkeypatch.setattr(turn, "_research", lambda q, r: turn._web_search(q, r))
    with pytest.raises(L.LedgerRefused) as e:
        L.require_research_stubbed(turn)
    assert e.value.reason == "research"
    L.stub_research(turn)
    L.require_research_stubbed(turn)
    assert turn._research("anything", "week")["citations"] == []
    assert turn._record_cost(None) == 0.0
    for t in PAID_TOOLS:
        src = open(os.path.join(ROOT, "tools", t), encoding="utf-8").read()
        assert "ledger.stub_research(turn)" in src or "_research._eval_stub = True" in src or t == "agent_live_chain.py"
    # the chain's launched backend gets an explicit environment with no Perplexity key
    chain = open(os.path.join(ROOT, "tools", "agent_live_chain.py"), encoding="utf-8").read()
    assert "PERPLEXITY" not in chain


def test_RAIL_no_eval_tool_imports_perplexity_or_calls_web_search():
    for path in TOOLS:
        tree = ast.parse(open(path, encoding="utf-8").read())
        for n in ast.walk(tree):
            if isinstance(n, (ast.Import, ast.ImportFrom)):
                names = [a.name for a in n.names] + [getattr(n, "module", "") or ""]
                assert not any("perplexity" in x for x in names), (path, names)
            if isinstance(n, ast.Call) and ast.unparse(n.func).endswith("web_search"):
                raise AssertionError(f"{path} calls web_search")


# ── proof 6: production never loads the ledger ──────────────────────────────────────────────────
def test_RAIL_nothing_under_api_imports_the_eval_ledger_or_report():
    hits = []
    for path in glob.glob(os.path.join(ROOT, "api", "**", "*.py"), recursive=True):
        src = open(path, encoding="utf-8", errors="replace").read()
        if "agent_eval_ledger" in src or "agent_eval_report" in src:
            hits.append(path)
    assert hits == []
    import api.services.uct_agent.budget as b
    import api.services.uct_agent.limits as lim
    for mod in (b, lim):
        assert "agent_eval" not in open(mod.__file__, encoding="utf-8").read()


# ── status / report ─────────────────────────────────────────────────────────────────────────────
def test_status_prints_cumulative_reserved_settled_remaining_and_per_run_rows(led, capsys):
    rid = led.reserve("run-1", 0.5, tool="agent_eval_run", model="claude-haiku-5-5", key_fp="deadbeef")
    led.settle(rid, 0.1)
    led.reserve("run-2", 2.0, tool="agent_live_batch", model="claude-haiku-4-5", key_fp="deadbeef")
    assert L.main(["status"]) == 0
    out = capsys.readouterr().out
    assert "settled $0.1000   reserved (open) $2.0000   committed $2.1000   remaining $18.9000" in out
    assert "run-1 | agent_eval_run | deadbeef | claude-haiku-5-5 | 1 | 0 | 0.0000 | 0.1000" in out
    assert "run-2 | agent_live_batch | deadbeef | claude-haiku-4-5 | 1 | 1 | 2.0000 | 0.0000" in out
    assert "cap     $21.00 (code 21.00)" in out


def test_report_prints_daily_dollars_and_counts_from_the_ledger_and_the_production_tables(led, tmp_path, capsys):
    import sqlite3
    from tools import agent_eval_report as R
    rid = led.reserve("run-1", 0.5, tool="agent_eval_run")
    led.settle(rid, 0.123)
    agent_db = str(tmp_path / "uct_agent.db")
    with sqlite3.connect(agent_db) as c:
        c.executescript("""
        CREATE TABLE agent_spend (id INTEGER PRIMARY KEY, et_day TEXT, status TEXT, reserved_usd REAL, actual_usd REAL);
        INSERT INTO agent_spend (et_day, status, reserved_usd, actual_usd) VALUES ('2026-11-01','settled',0.05,0.02), ('2026-11-01','reserved',0.04,0);
        CREATE TABLE agent_telemetry (id INTEGER PRIMARY KEY, created_at INTEGER, cost_usd REAL, path TEXT, user_id TEXT);
        INSERT INTO agent_telemetry (created_at, cost_usd, path, user_id) VALUES (1793534400, 0.015, 'model', 'u1'), (1793534500, 0, 'fast', 'u1');
        """)
    cat_db = str(tmp_path / "catalysts.db")
    with sqlite3.connect(cat_db) as c:
        c.executescript("""
        CREATE TABLE catalyst_cost_log (ts INTEGER, market_date TEXT, ticker TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL, was_cached INTEGER);
        INSERT INTO catalyst_cost_log VALUES (1, '2026-11-01', 'XYZ', 'm', 1, 1, 0.3, 0), (2, '2026-11-01', 'XYZ', 'm', 1, 1, 0.0, 1);
        """)
    auth_db = str(tmp_path / "auth.db")
    with sqlite3.connect(auth_db) as c:
        c.executescript("""
        CREATE TABLE llm_route_cost_log (id INTEGER PRIMARY KEY, surface TEXT, model TEXT, cost_usd REAL, at TEXT);
        INSERT INTO llm_route_cost_log (surface, model, cost_usd, at) VALUES ('uct_agent', 'm', 0.2, '2026-11-01 14:00:00');
        """)
    assert R.main(["--ledger", led.path, "--agent-db", agent_db, "--catalyst-db", cat_db, "--auth-db", auth_db]) == 0
    out = capsys.readouterr().out
    assert "settled $0.1230 + open $0.0000 = $0.1230 of cap $21.00" in out
    assert "2026-11-01 | 1 | 1 | 0 | $0.0200 | $0.0400" in out           # agent_spend
    assert "2026-11-01 | 2 | 1 | $0.0150" in out                         # telemetry: 2 turns, 1 model turn
    assert "2026-11-01 | 2 | 1 | $0.3000" in out                         # catalyst: 2 calls, 1 cached
    assert "2026-11-01 | uct_agent | 1 | $0.2000" in out
    assert "u1" not in out and "XYZ" not in out                          # value-free: no ids, no tickers
    assert R.main(["--ledger", led.path]) == 0
    assert "(not given)" in capsys.readouterr().out


# ── A-02: the effort switch is inert when unset; the price rows ─────────────────────────────────
def _kwargs_of_one_turn(monkeypatch, model_id):
    from api.services.uct_agent import turn
    monkeypatch.setenv("UCT_AGENT_MODEL", model_id)
    seen = []

    def caller(**kw):
        seen.append(kw)
        env = {"disposition": "answer", "reply": "hi", "question": None, "ops": [], "unsupported_category": None, "research": None, "title": None}
        return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env))], stop_reason="end_turn",
                                     usage=types.SimpleNamespace(input_tokens=1, output_tokens=1))
    monkeypatch.setattr(turn, "_record_cost", lambda r: 0.0)
    turn.run_turn(message="hello", context={"surface": "charts"}, history=[], capabilities=[], caller=caller)
    return seen[0]


def test_A02_effort_unset_is_byte_identical_and_set_adds_effort_with_a_4096_ceiling_except_on_haiku_4_5(monkeypatch):
    from api.services.uct_agent import turn
    monkeypatch.delenv(turn.EFFORT_ENV, raising=False)
    base = _kwargs_of_one_turn(monkeypatch, "claude-haiku-4-5")
    assert base["max_tokens"] == 2048 and set(base["output_config"]) == {"format"}
    monkeypatch.setenv(turn.EFFORT_ENV, "high")
    same = _kwargs_of_one_turn(monkeypatch, "claude-haiku-4-5")
    assert json.dumps(same, default=str) == json.dumps(base, default=str)          # the production model: unchanged
    on = _kwargs_of_one_turn(monkeypatch, "claude-sonnet-5-5")
    assert on["max_tokens"] == 4096 and on["output_config"]["effort"] == "high" and on["output_config"]["format"] == base["output_config"]["format"]
    monkeypatch.setenv(turn.EFFORT_ENV, "nonsense")
    assert turn.effort() is None and turn.output_ceiling("claude-sonnet-5-5") == 2048
    monkeypatch.setenv(turn.EFFORT_ENV, "low")
    assert turn.output_config_for("claude-haiku-5-5", {})["effort"] == "low" and "effort" not in turn.output_config_for("claude-haiku-4-5", {})


def test_A02_the_cost_guard_prices_haiku_5_5_and_sonnet_5_5_at_the_verified_rates():
    from api.services import narrative_cost_guard as g
    assert g._PRICES["claude-haiku-5-5"] == (0.10, 0.50) and g._PRICES["claude-sonnet-5-5"] == (2.0, 10.0) and g._PRICES["claude-haiku-4-5"] == (1.0, 5.0)
    assert g.estimate_cost("claude-haiku-5-5", 0, 0, cache_creation_tokens=10_000) == pytest.approx(0.125 / 100)   # (10K: under the 100K tier)
    assert g.estimate_cost("claude-haiku-5-5", 0, 0, cache_read_tokens=10_000) == pytest.approx(0.01 / 100)
    assert g.estimate_cost("claude-sonnet-5-5", 0, 0, cache_creation_tokens=1_000_000) == pytest.approx(2.5)
    assert g.estimate_cost("claude-sonnet-5-5", 0, 0, cache_read_tokens=1_000_000) == pytest.approx(0.10)     # 0.05x (published), not the family's 0.1x
    assert g.estimate_cost("claude-sonnet-5", 0, 0, cache_read_tokens=1_000_000) == pytest.approx(0.20)       # the family rule elsewhere
    assert g.estimate_cost("claude-haiku-5-5", 100_000, 0) == pytest.approx(0.01)                                # up to 100K: $0.10/MTok
    assert g.estimate_cost("claude-haiku-5-5", 100_001, 0) == pytest.approx(100_001 * 0.50 / 1e6)              # over 100K: the higher tier
    assert g.estimate_cost("claude-haiku-5-5", 0, 1_000, cache_read_tokens=150_000) == pytest.approx(150_000 * 0.05 / 1e6 + 1_000 * 2.5 / 1e6)
