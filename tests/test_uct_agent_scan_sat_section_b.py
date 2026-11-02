"""SAT-1 section B runner (owner: agent-sc). NO model is ever called here: every caller is a stub, and the dry run is
proven to send nothing and to open no database. The real run's spend goes through budget.Meter (the /turn route's
meter): the Agent's $5 ledger counts it, the shared $15 ledger stops it, the run's own --max-usd caps it."""
from __future__ import annotations

import json
import sqlite3
import types

import pytest

from api.services.uct_agent import budget, store, turn
from api.services.uct_agent.scan.sat import section_b as sb

ZERO_SITE = lambda: (0.0, 15.0)  # noqa: E731
R = sb.load_requests()
CORPUS = sb.load_corpus()


def _resp(env, usage=(1200, 80, 0, 0)):
    u = types.SimpleNamespace(input_tokens=usage[0], output_tokens=usage[1], cache_read_input_tokens=usage[2],
                              cache_creation_input_tokens=usage[3])
    return types.SimpleNamespace(content=[types.SimpleNamespace(type="text", text=json.dumps(env))],
                                 stop_reason="end_turn", usage=u)


def _env(disposition="answer", ops=(), **extra):
    return {"disposition": disposition, "reply": extra.pop("reply", ""), "question": None, "ops": list(ops), "unsupported_category": None,
            "research": None, "title": None, **extra}


def _screen_op(target, filters, compact):
    a = {"filters": filters, "sort_field": None, "sort_dir": None, "mode": "new", "show": None, "as": None, "within": None}
    return {"action": "screener.run", "target": target, **({"args_json": json.dumps(a)} if compact else {"args": a})}


def _screener_ref(body):
    return body["context"]["screener"][0]["ref"]


def _compact(body):
    return turn.compact_ops(turn.validate_manifest(R["manifests"][body["capabilities_ref"]]))


@pytest.fixture
def ledger(monkeypatch):
    store._reset_for_tests()
    budget._reset_for_test()
    for k in ("UCT_AGENT_BUDGET_USD", "UCT_AGENT_MAX_CALLS_PER_REQUEST", "UCT_AGENT_NL1"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setattr(budget, "site_spend_usd", ZERO_SITE)
    monkeypatch.setattr(turn, "_default_caller", lambda **kw: pytest.fail("the real model client was reached"))
    yield
    budget._reset_for_test()


# ═══ the capture is current and covers the corpus ═══════════════════════════════════════════════
def test_the_capture_covers_every_corpus_question_with_its_own_words():
    assert R["corpus_version"] == CORPUS["version"]
    qs = {q["id"]: q["question"] for q in CORPUS["questions"]}
    assert set(R["requests"]) == set(qs)
    for qid, body in R["requests"].items():
        assert body is not None and body["message"] == qs[qid]
        assert body["capabilities_ref"] in R["manifests"]
        if body.get("reroute_on"):
            rb = body["reroute_on"]["body"]
            assert rb["reroute"] is True and "screener" in rb["routing"]["selected"] and rb["message"] == qs[qid]


def test_after_the_F_SB_1_routing_fix_every_corpus_question_reaches_the_planner_with_the_screener_group():
    """agent-lead's #626 pinned here from the capture: no discovery question needs a need_groups reroute any more,
    and every one is sent the LABELLED catalog (#628). A regression shows up as a reroute in the capture."""
    without = [q for q, b in R["requests"].items() if "screener" not in (b["routing"]["selected"] or [])]
    assert without == []
    assert not [q for q, b in R["requests"].items() if b.get("reroute_on")]
    keys_only = [q for q, b in R["requests"].items() if ";" not in str(b["context"]["screener"][0].get("fields", ""))]
    assert keys_only == []


def _rerouting(qid: str) -> dict:
    """A copy of the capture in which `qid` was routed WITHOUT the screener group, and its reroute is the real captured
    body (the shape the browser sends): the reroute path stays tested now that no corpus question needs it."""
    import copy
    r = copy.deepcopy(R)
    body = r["requests"][qid]
    first = copy.deepcopy(body)
    first["routing"]["selected"] = [g for g in first["routing"]["selected"] if g != "screener"]
    first["reroute_on"] = {"need_groups": ["screener"], "body": {**body, "reroute": True}}
    r["requests"][qid] = first
    return r


# ═══ dry run: priced, nothing sent, nothing opened ══════════════════════════════════════════════
def test_DRY_RUN_prices_every_question_and_sends_nothing_and_opens_no_database(monkeypatch):
    monkeypatch.setattr(turn, "_default_caller", lambda **kw: pytest.fail("the dry run reached the model"))
    opened, real = [], sqlite3.connect
    sqlite3.connect = lambda *a, **k: (opened.append(a), real(*a, **k))[1]
    try:
        p = sb.plan(R)
    finally:
        sqlite3.connect = real
    assert opened == []                                      # no ledger, store or cost row was touched
    assert p["planner_questions"] == len(CORPUS["questions"])
    assert p["model"] == turn.model()
    assert all(r["first"]["worst_usd"] > r["first"]["estimate_usd"] > 0 for r in p["questions"])
    assert p["may_reroute"] == sum(1 for b in R["requests"].values() if b.get("reroute_on"))
    assert p["worst_usd"] == pytest.approx(sum(r["worst_usd"] for r in p["questions"]), abs=1e-5)


def test_DRY_RUN_bound_is_the_ledgers_own_worst_case_for_the_request_run_turn_builds():
    body = R["requests"]["d02"]
    kw = sb.capture_kwargs(sb.body_args(body, R["manifests"]))
    assert kw["model"] == turn.model() and kw["messages"][-1]["role"] == "user"
    assert sb.price_request(kw)["worst_usd"] == round(budget.worst_case_usd(kw), 6)


def test_the_cli_dry_run_is_the_default_and_needs_no_key(monkeypatch, capsys):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.setattr(turn, "_default_caller", lambda **kw: pytest.fail("reached the model"))
    assert sb.main(["--only", "d02,r04"]) == 0
    out = capsys.readouterr().out
    assert "DRY RUN (nothing sent)" in out and "d02" in out and "r04" in out and "d01 " not in out


# ═══ --run is refused without every precondition ═══════════════════════════════════════════════
@pytest.mark.parametrize("argv,env", [
    (["--run", "--data-dir", "{tmp}"], {"ANTHROPIC_API_KEY": "x"}),                                    # no approval
    (["--run", "--i-have-owner-approval", "--data-dir", "{tmp}"], {}),                                  # no key
    (["--run", "--i-have-owner-approval", "--data-dir", "C:\\data"], {"ANTHROPIC_API_KEY": "x"}),       # shared root
    (["--run", "--i-have-owner-approval", "--data-dir", "{tmp}"], {"ANTHROPIC_API_KEY": "x", "RAILWAY_ENVIRONMENT": "production"}),
    (["--run", "--i-have-owner-approval", "--data-dir", "{tmp}", "--max-usd", "6"], {"ANTHROPIC_API_KEY": "x"}),
])
def test_RUN_is_refused_without_approval_a_key_a_sandbox_or_a_cap_inside_the_day(argv, env, tmp_path, monkeypatch, ledger):
    from api.services.uct_agent.scan.sat import seed
    for k in seed.RAILWAY:
        monkeypatch.delenv(k, raising=False)
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(seed, "pin", lambda d: {})
    monkeypatch.setattr(sb, "run", lambda *a, **k: pytest.fail("a refused --run reached the replay"))
    with pytest.raises(SystemExit):
        sb.main([a.replace("{tmp}", str(tmp_path)) for a in argv])


# ═══ the real run, with a stub model ═══════════════════════════════════════════════════════════
def _model_for(answers):
    """A stub model: answers[message] -> the envelopes for that question's calls, in order (first, reroute)."""
    calls, seen = [], {}

    def caller(**kw):
        text = kw["messages"][-1]["content"]
        msg = next(m for m in answers if m in text)
        calls.append(msg)
        i = seen[msg] = seen.get(msg, -1) + 1
        return _resp(answers[msg][min(i, len(answers[msg]) - 1)])
    caller.calls = calls
    return caller


def test_RUN_counts_every_call_in_the_agent_ledger_and_records_raw_evidence_first(ledger, tmp_path):
    b = R["requests"]["d02"]
    op = _screen_op(_screener_ref(b), [{"field": "rs_rank", "op": "gt", "value": 90, "max": None, "values": None}], _compact(b))
    model = _model_for({b["message"]: [_env("apply", [op])]})
    s = sb.run(R, ["d02"], 1.0, tmp_path, caller=model, site_reader=ZERO_SITE)
    assert s["status"] == "COMPLETE" and s["model_calls"] == 1 and model.calls == [b["message"]]
    assert s["spent_usd"] > 0
    assert budget.state()["committed_usd"] == pytest.approx(s["spent_usd"], abs=1e-6)      # in the $5 ledger
    rec = [json.loads(x) for x in (tmp_path / "raw.jsonl").read_text(encoding="utf-8").splitlines()]
    assert len(rec) == 1 and rec[0]["id"] == "d02" and rec[0]["outcome"] == "ok"
    assert rec[0]["candidate"]["logic"] == {"key": "rs_rank", "op": "gt", "min": 90}
    assert json.loads((tmp_path / "summary.json").read_text(encoding="utf-8"))["status"] == "COMPLETE"


def test_RUN_replays_the_captured_reroute_when_the_model_asks_for_the_screener(ledger, tmp_path):
    rr = _rerouting("d06")
    b = rr["requests"]["d06"]
    rb = b["reroute_on"]["body"]
    op = _screen_op(_screener_ref(rb), [{"field": "vol_ratio", "op": "gte", "value": 2, "max": None, "values": None}], _compact(rb))
    model = _model_for({b["message"]: [_env(need_groups=["screener"]), _env("apply", [op])]})
    s = sb.run(rr, ["d06"], 1.0, tmp_path, caller=model, site_reader=ZERO_SITE)
    rec = json.loads((tmp_path / "raw.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert s["model_calls"] == 2 and [c["call"] for c in rec["calls"]] == ["first", "reroute"]
    assert rec["candidate"]["logic"] == {"key": "vol_ratio", "op": "gte", "min": 2}


def test_RUN_never_improvises_a_reroute_that_was_not_captured(ledger, tmp_path):
    rr = _rerouting("d06")
    b = rr["requests"]["d06"]
    model = _model_for({b["message"]: [_env(need_groups=["alerts"])]})
    sb.run(rr, ["d06"], 1.0, tmp_path, caller=model, site_reader=ZERO_SITE)
    rec = json.loads((tmp_path / "raw.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert rec["reroute_not_captured"] == ["alerts"] and len(rec["calls"]) == 1 and rec["candidate"]["refused"]


def test_RUN_stops_before_a_question_whose_worst_case_would_pass_the_runs_cap(ledger, tmp_path):
    bound = sb.plan(R, ["d02"])["worst_usd"]
    heavy = lambda **kw: _resp(_env(reply="ok"), usage=(20000, 200, 0, 0))     # ~$0.021 actual per call  # noqa: E731
    s = sb.run(R, ["d02", "d05"], bound + 0.005, tmp_path, caller=heavy, site_reader=ZERO_SITE)
    assert s["status"] == "STOPPED" and "--max-usd" in s["stopped_because"] and s["questions_run"] == 1
    assert s["not_reached"] == ["d05"] and s["spent_usd"] <= bound + 0.005          # never past the cap
    assert len((tmp_path / "raw.jsonl").read_text(encoding="utf-8").splitlines()) == 1   # d05 made no call


def test_RUN_with_a_cap_below_the_first_questions_worst_case_makes_no_call_at_all(ledger, tmp_path):
    model = _model_for({R["requests"]["d02"]["message"]: [_env()]})
    s = sb.run(R, ["d02"], 0.01, tmp_path, caller=model, site_reader=ZERO_SITE)
    assert model.calls == [] and s["not_reached"] == ["d02"] and s["answered"] == 0 and budget.state()["committed_usd"] == 0


def test_RUN_is_stopped_by_the_shared_15_ledger_and_spends_nothing(ledger, tmp_path):
    model = _model_for({R["requests"]["d02"]["message"]: [_env()]})
    s = sb.run(R, ["d02"], 1.0, tmp_path, caller=model, site_reader=lambda: (15.0, 15.0))
    assert s["status"] == "STOPPED" and model.calls == [] and s["spent_usd"] == 0
    assert budget.state()["committed_usd"] == 0
    rec = json.loads((tmp_path / "raw.jsonl").read_text(encoding="utf-8").splitlines()[0])
    assert rec["outcome"] == "budget_refused:site_cap"


def test_RUN_is_stopped_by_the_agents_own_5_day(ledger, tmp_path, monkeypatch):
    monkeypatch.setenv("UCT_AGENT_BUDGET_USD", "0.01")
    model = _model_for({R["requests"]["d02"]["message"]: [_env()]})
    s = sb.run(R, ["d02"], 1.0, tmp_path, caller=model, site_reader=ZERO_SITE)
    assert s["status"] == "STOPPED" and model.calls == []


# ═══ candidates ════════════════════════════════════════════════════════════════════════════════
def test_candidate_maps_screener_ops_into_the_screeners_own_spec_and_keeps_list_words_as_written():
    a = {"filters": [{"field": "adr_pct", "op": "between", "value": 4, "max": 8, "values": None},
                     {"field": "above_50sma", "op": "eq", "value": 1, "max": None, "values": None},
                     {"field": "industry", "op": "in", "value": None, "max": None, "values": ["chips"]}],
         "sort_field": "rs_rank", "sort_dir": "desc"}
    c = sb.candidate({"ops": [{"action": "screener.run", "target": "s1", "args_json": json.dumps(a)}]})
    assert c["logic"] == {"all": [{"key": "adr_pct", "op": "between", "min": 4, "max": 8},
                                  {"key": "above_50sma", "op": "eq", "value": 1},
                                  {"key": "industry", "op": "in", "values": ["chips"]}]}
    assert c["sort"] == {"key": "rs_rank", "dir": "desc"}
    assert sb.candidate({"disposition": "unsupported", "reply": "no MACD field"})["refused"] is True


def test_the_runner_imports_no_model_client_at_module_level():
    import ast
    import inspect
    top = {getattr(n, "module", None) or "" for n in ast.parse(inspect.getsource(sb)).body if isinstance(n, ast.ImportFrom)}
    top |= {a.name for n in ast.parse(inspect.getsource(sb)).body if isinstance(n, ast.Import) for a in n.names}
    assert not {m for m in top if any(x in m for x in ("anthropic", "openai", "engine", "nl_compile"))}
