"""NL-1 eval runner (tools/agent_eval_run.py): the free parts and every refusal before a paid call.

No model call, no network: --run is only exercised up to its refusals."""
import json
import os

import pytest

from tools import agent_eval_run as r

PRICES = r.load_prices()


def _item(mode="nl1", message="switch to weekly"):
    caps = json.load(open(os.path.join(os.path.dirname(__file__), "..", "app", "src", "agent", "contract", "manifest.golden.json"),
                          encoding="utf-8"))["capabilities"]
    body = {"message": message, "context": {"surface": "charts", "charts": [{"ref": "c1", "label": "Chart (NVDA)"}]},
            "capabilities": caps if mode == "nl1" else caps[:40], "routing": None, "manifestVersion": 1}
    if mode == "nl1":
        body["interpreter"] = "nl1"
    return {"key": "x", "set": "dev-nl1.json", "mode": mode, "body": body, "history": [], "refMap": {}}


def test_prices_start_unverified_and_every_candidate_is_priced():
    assert PRICES["verified"] is False                     # verified only after a live check (owner decision 3)
    for m in ("claude-haiku-4-5", "claude-haiku-5-5", "claude-sonnet-5-5"):
        assert {"input", "output", "cache_read"} <= set(PRICES["models"][m])


def test_estimate_is_free_and_nl1_shares_one_cacheable_system_prompt():
    items = [_item(message=m) for m in ("switch to weekly", "add rsi", "what is ADR?")]
    est = r.estimate(items, PRICES, "claude-haiku-4-5")
    assert est["requests"] == 3 and est["distinct_system_prompts"] == 1
    assert est["usd_cached"] < est["usd_uncached"] < est["usd_worst_case"]
    assert est["system_tokens_per_request_high"] > 4096          # above Haiku 4.5's cache minimum, so it caches


class _Args:
    def __init__(self, **kw):
        self.max_usd = kw.get("max_usd", 5.0)
        self.model = kw.get("model", "claude-haiku-5-5")


def test_run_refuses_without_a_ceiling_verified_prices_or_a_separate_key(monkeypatch):
    verified = {**PRICES, "verified": True}
    assert "max-usd" in r.refusal(_Args(max_usd=None), verified)
    assert "not verified" in r.refusal(_Args(), PRICES)
    assert "no verified price" in r.refusal(_Args(model="claude-unknown"), verified)
    monkeypatch.delenv(r.EVAL_KEY_ENV, raising=False)
    assert r.EVAL_KEY_ENV in r.refusal(_Args(), verified)
    monkeypatch.setenv("ANTHROPIC_API_KEY", "sk-prod")
    monkeypatch.setenv(r.EVAL_KEY_ENV, "sk-prod")
    assert "production key" in r.refusal(_Args(), verified)
    monkeypatch.setenv(r.EVAL_KEY_ENV, "sk-eval")
    assert r.refusal(_Args(), verified) is None


def test_main_dry_run_makes_no_call_and_run_stops_at_the_first_refusal(tmp_path, capsys, monkeypatch):
    p = tmp_path / "bodies.json"
    p.write_text(json.dumps([_item(), _item(mode="legacy")]), encoding="utf-8")
    assert r.main([str(p), "--model", "claude-haiku-5-5", "--mode", "nl1"]) == 0
    assert "DRY RUN" in capsys.readouterr().out
    monkeypatch.setattr(r, "_run", lambda *a, **k: pytest.fail("a paid run must not start"))
    assert r.main([str(p), "--model", "claude-haiku-5-5", "--mode", "nl1", "--run", "--max-usd", "1"]) == 2
    assert "not verified" in capsys.readouterr().out
