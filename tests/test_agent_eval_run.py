"""NL-1 eval runner (tools/agent_eval_run.py): the free parts, every refusal and every abort rule.

No model call, no network: --run is exercised only up to its refusals; aborts are tested on the Monitor."""
import json
import os

import pytest

from tools import agent_eval_run as r


@pytest.fixture(autouse=True)
def _whole_catalog_limit(monkeypatch):
    # The shipped NL-1 limit is 60 (owner 2026-10-19), which NL-1's whole catalog is over: the runner refuses
    # such a request exactly as the server would. These tests check the runner's OTHER behaviour, so the
    # limit is lifted here only. The real eval needs the owner's limit decision first.
    from api.services.uct_agent import turn
    monkeypatch.setattr(turn, "MAX_CAPABILITIES_NL1", 200)

PRICES = r.load_prices()
GOLDEN = os.path.join(os.path.dirname(__file__), "..", "app", "src", "agent", "contract", "manifest.golden.json")


def _item(mode="nl1", message="switch to weekly", key="x", set_="dev-nl1.json", split="dev"):
    caps = json.load(open(GOLDEN, encoding="utf-8"))["capabilities"]
    body = {"message": message, "context": {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (NVDA)"}]},
            "capabilities": caps if mode == "nl1" else caps[:40], "routing": None, "manifestVersion": 1}
    if mode == "nl1":
        body["interpreter"] = "nl1"
    return {"key": key, "set": set_, "split": split, "mode": mode, "body": body, "history": [], "refMap": {}}


def test_prices_are_the_published_ones():
    m = PRICES["models"]
    assert PRICES["verified"] is True and PRICES["source"].startswith("https://platform.claude.com/")
    assert (m["claude-haiku-5-5"]["input"], m["claude-haiku-5-5"]["output"]) == (0.10, 0.50)
    assert (m["claude-sonnet-5-5"]["input"], m["claude-sonnet-5-5"]["output"], m["claude-sonnet-5-5"]["cache_read"]) == (2.0, 10.0, 0.10)
    assert (m["claude-haiku-4-5"]["input"], m["claude-haiku-4-5"]["output"]) == (1.0, 5.0)
    assert "OUTPUT" in PRICES["thinking_billing"]


def test_haiku_5_5_prompts_over_100k_use_the_higher_tier():
    low = r.usd(PRICES, "claude-haiku-5-5", inp=100_000)
    high = r.usd(PRICES, "claude-haiku-5-5", inp=100_001)
    assert round(low, 4) == 0.01 and high > 4 * low


def test_estimate_is_free_and_nl1_shares_one_cacheable_system_prompt():
    items = [_item(message=m) for m in ("switch to weekly", "add rsi", "what is ADR?")]
    est = r.estimate(items, PRICES, "claude-haiku-4-5")
    assert est["requests"] == 3 and est["distinct_system_prompts"] == 1
    assert est["usd_cached"] < est["usd_uncached"] < est["usd_worst_case"]
    many = r.estimate([_item(message=f"m{i}") for i in range(10)], PRICES, "claude-haiku-5-5")
    assert many["usd_cached"] < many["usd_uncached"]           # the >100K tier is per request, never per run
    assert est["system_tokens_per_request_high"] > 4096          # above Haiku 4.5's cache minimum
    assert est["usd_worst_case"] == pytest.approx(est["usd_worst_per_call"] * 3 * 2, rel=1e-2)   # 2 calls each


class _Args:
    def __init__(self, **kw):
        self.max_usd = kw.get("max_usd", 5.0)
        self.model = kw.get("model", "claude-haiku-5-5")


def test_run_refuses_without_a_ceiling_verified_prices_or_a_separate_key(monkeypatch):
    assert "max-usd" in r.refusal(_Args(max_usd=None), PRICES)
    assert "not verified" in r.refusal(_Args(), {**PRICES, "verified": False})
    assert "no verified price" in r.refusal(_Args(model="claude-unknown"), PRICES)
    monkeypatch.delenv(r.EVAL_KEY_ENV, raising=False)
    assert r.EVAL_KEY_ENV in r.refusal(_Args(), PRICES)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-prod")
    monkeypatch.setenv(r.EVAL_KEY_ENV, "sk-prod")
    assert "production key" in r.refusal(_Args(), PRICES)
    monkeypatch.setenv(r.EVAL_KEY_ENV, "sk-eval")
    assert r.refusal(_Args(), PRICES) is None


def test_trial_is_ten_dev_requests_and_a_key_selection_never_reaches_sealed_cases():
    keys = r.trial_keys()
    assert len(keys) == 10 and all(s == "dev-nl1.json" for _, s in keys)
    items = [_item(key=k, set_=s) for k, s in keys] + [_item(key="other")]
    assert len(r.select(items, "nl1", None, "trial")) == 10
    sealed = [_item(key="s3-x", set_="sealed-v3.json", split="sealed")]
    with pytest.raises(SystemExit, match="DEV cases only"):
        r.select(sealed, "nl1", None, "s3-x")


def test_main_dry_run_makes_no_call_and_run_stops_at_the_first_refusal(tmp_path, capsys, monkeypatch):
    p = tmp_path / "bodies.json"
    p.write_text(json.dumps([_item(), _item(mode="legacy")]), encoding="utf-8")
    assert r.main([str(p), "--model", "claude-haiku-5-5", "--mode", "nl1"]) == 0
    assert "DRY RUN" in capsys.readouterr().out
    monkeypatch.setattr(r, "_run", lambda *a, **k: pytest.fail("a paid run must not start"))
    monkeypatch.delenv(r.EVAL_KEY_ENV, raising=False)
    assert r.main([str(p), "--model", "claude-haiku-5-5", "--mode", "nl1", "--run", "--max-usd", "1"]) == 2
    assert r.EVAL_KEY_ENV in capsys.readouterr().out


def test_abort_rules():
    m = r.Monitor(nl1=True)
    assert m.after_call(worst=0.01, actual=0.002, stop_reason="end_turn", cache_read=0) is None
    assert m.after_call(worst=0.01, actual=0.002, stop_reason="end_turn", cache_read=0) is None
    assert "caching is not working" in m.after_call(worst=0.01, actual=0.002, stop_reason="end_turn", cache_read=0)
    m = r.Monitor(nl1=True)
    assert "estimate is wrong" in m.after_call(worst=0.001, actual=0.002, stop_reason="end_turn", cache_read=0)
    m = r.Monitor(nl1=False)
    assert m.after_call(worst=1, actual=0, stop_reason="max_tokens", cache_read=0) is None
    assert "2 calls ended" in m.after_call(worst=1, actual=0, stop_reason="refusal", cache_read=0)
    m = r.Monitor(nl1=False)
    assert m.after_error() is None and "in a row" in m.after_error()
    m = r.Monitor(nl1=False)
    m.after_error()
    m.after_call(worst=1, actual=0, stop_reason="end_turn", cache_read=0)      # a success resets the streak
    assert m.after_error() is None


# ── NL-1 hybrid action selection (owner 2026-10-20): the runner replays what the panel sends ──────────────────
PARITY = json.load(open(os.path.join(os.path.dirname(__file__), "fixtures", "nl1_assemble_parity.json"), encoding="utf-8"))


def _catalog():
    caps = json.load(open(GOLDEN, encoding="utf-8"))["capabilities"]
    return {"catalog": "cat-1", "manifest": caps, "core": PARITY["core"], "groupOf": PARITY["groupOf"], "groups": PARITY["groups"]}


def _routed_item(extra=(), reroutes=None):
    cat = _catalog()
    manifest, routing = r.assemble_nl1(cat, [*PARITY["core"], *extra])
    selected = routing["selected"] if routing else [g["id"] for g in PARITY["groups"]]
    unselected = [g["id"] for g in PARITY["groups"] if g["id"] not in selected]
    body = {"message": "add a chart", "context": {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (NVDA)"}]},
            "capabilities": manifest, "routing": routing, "manifestVersion": 1, "interpreter": "nl1"}
    return {"key": "x", "set": "dev-nl1.json", "split": "dev", "mode": "nl1", "body": body, "history": [], "refMap": {},
            "catalog": "cat-1", "selection": {"core": PARITY["core"], "selected": selected, "unselected": unselected},
            "reroutes": reroutes or {}}


def test_assemble_nl1_is_the_browsers_assembly_exactly():
    cat = _catalog()
    for case in PARITY["cases"]:
        manifest, routing = r.assemble_nl1(cat, case["selected"])
        assert [c["name"] for c in manifest] == case["names"], case["selected"]
        assert routing == case["routing"], case["selected"]


def test_a_reroute_replays_the_recorded_groups_or_stops_as_the_panel_does():
    cats = {"cat-1": _catalog()}
    item = _routed_item(reroutes={"workspace": {"selected": [*PARITY["core"], "workspace"], "wordsNotSent": []},
                                  "layouts+lists+workspace": None})
    body = r.reroute_request(item, cats, ["workspace"])
    names = [c["name"] for c in body["capabilities"]]
    assert "widget.add" in names and len(names) <= 60 and body["routing"]["stable"] == len(PARITY["cases"][0]["names"])   # the core
    assert body["message"] == item["body"]["message"] and body["context"] == item["body"]["context"]
    assert r.reroute_request(item, cats, ["charts", "workspace"]) == body          # an already-sent group is dropped
    assert r.reroute_request(item, cats, ["workspace", "layouts", "lists"]) is None          # recorded: does not fit
    assert r.reroute_request(item, cats, ["workspace", "layouts", "lists", "alerts"]) is None  # more than MAX_NEED
    assert r.reroute_request(item, cats, ["alerts"]) is None                                # never recorded
    assert r.reroute_request(item, cats, ["charts"]) is None                                # nothing new to ask for
    assert r.catalogs_of([item, cats["cat-1"]]) == cats                                     # turns are never catalogs


def test_the_ceiling_meter_allows_two_calls_and_a_reroute_is_never_repaired(monkeypatch):
    from api.services.uct_agent import turn
    from api.services.uct_agent.budget import BudgetRefused
    from tests.test_uct_agent import _resp, caller_of
    m = r.CeilingMeter()
    assert m.call("turn", lambda **k: 1) == 1 and m.calls_left() == 1
    assert m.call("reroute", lambda **k: 2) == 2 and m.calls_left() == 0
    with pytest.raises(BudgetRefused):
        m.call("repair", lambda **k: 3)
    # the reroute is the request's 2nd call: a plan the server would reject is NOT repaired (no 3rd call)
    monkeypatch.setenv(turn.NL1_ENV, "1")
    monkeypatch.setattr(turn, "MAX_CAPABILITIES_NL1", 60)
    item = _routed_item(["workspace"])
    bad = {"disposition": "apply", "reply": "", "question": None, "unsupported_category": None, "research": None,
           "title": None, "correction": None,
           "ops": [{"action": "chart.setTimeframe", "target": "nope", "args_json": json.dumps({"timeframe": "15"})}]}
    c = caller_of(_resp(bad), _resp(bad))
    meter = r.CeilingMeter()
    meter.calls = 1
    b = item["body"]
    out = turn.run_turn(message=b["message"], context=b["context"], history=[], capabilities=b["capabilities"],
                        routing=b["routing"], caller=c, interpreter="nl1", meter=meter, reroute=True)
    assert len(c.calls) == 1 and meter.calls == 2
    assert out["envelope"]["ops"] == []                                  # an unknown target: nothing planned


def test_the_real_eval_now_fits_the_shipped_60_limit_and_shares_the_cached_core(monkeypatch):
    from api.services.uct_agent import turn
    whole = r.estimate([_item()], PRICES, "claude-haiku-5-5")           # the whole catalog (under the lifted fixture)
    monkeypatch.setattr(turn, "MAX_CAPABILITIES_NL1", 60)               # the shipped limit, not the lifted one
    items = [_routed_item(extra) for extra in ([], ["layouts"], ["lists", "alerts"], ["workspace"])]
    rows = [r.prompt_parts(i) for i in items]
    assert len({x["stable"] for x in rows}) == 1                         # one cached core block for every request
    assert len({x["variable"] for x in rows}) == 4
    est = r.estimate(items, PRICES, "claude-haiku-5-5")
    assert est["requests"] == 4 and est["distinct_system_prompts"] == 4
    assert est["usd_cached"] < est["usd_uncached"] < est["usd_worst_case"]
    assert est["system_tokens_per_request_high"] < whole["system_tokens_per_request_high"]
