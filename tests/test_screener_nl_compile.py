"""FT-024/030 -- English compiled INTO the where-grammar. Recorded model replies
only (a fake caller); the property under test is that nothing the model says
reaches the screener without passing the member-facing parser."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routers import screener_nl as rx
from api.services import daily_counters
from api.services.screener import logic, nl_compile


def replies(*outs):
    calls = []

    def caller(messages):
        calls.append(messages)
        return outs[len(calls) - 1]
    caller.calls = calls
    return caller


def test_a_valid_reply_becomes_a_runnable_tree_with_its_explanation():
    c = replies({"criteria": "avg_volume_30d >= 1m and rs_rank >= 90 and not sector in [Utilities]",
                 "assumptions": ["'liquid' read as 1M+ average volume"]})
    out = nl_compile.compile_english("liquid leaders, no utilities", caller=c)
    assert len(c.calls) == 1
    assert out["logic"]["all"][0] == {"key": "avg_volume_30d", "op": "gte", "min": 1_000_000}
    assert out["explanation"][0]["text"] == "All of the following:"
    assert out["assumptions"] == ["'liquid' read as 1M+ average volume"]


def test_an_invented_field_gets_one_repair_carrying_the_parser_sentence():
    c = replies({"criteria": "relative_strength > 90", "assumptions": []},
                {"criteria": "rs_rank > 90", "assumptions": []})
    out = nl_compile.compile_english("strong stocks", caller=c)
    assert len(c.calls) == 2
    assert "not a screener field" in c.calls[1][-1]["content"]
    assert out["logic"] == {"key": "rs_rank", "op": "gt", "min": 90}


def test_two_bad_replies_are_a_sentence_never_a_guessed_screen():
    c = replies({"criteria": "price > 5%", "assumptions": []},
                {"criteria": "price > 5% and also", "assumptions": []})
    with pytest.raises(nl_compile.CompileError, match="could not be turned into a screen"):
        nl_compile.compile_english("cheap", caller=c)
    assert len(c.calls) == 2                  # at most two model calls


def test_empty_and_overlong_input_never_call_the_model():
    c = replies()
    with pytest.raises(nl_compile.CompileError):
        nl_compile.compile_english("  ", caller=c)
    with pytest.raises(nl_compile.CompileError, match="under"):
        nl_compile.compile_english("x" * 601, caller=c)
    assert c.calls == []


def test_the_prompt_lists_every_real_field():
    from api.services.screener import filters
    table = nl_compile.field_table()
    for k in filters.FILTERS:
        assert f"\n{k} |" in "\n" + table


# ── route ───────────────────────────────────────────────────────────────────

@pytest.fixture
def client(monkeypatch):
    daily_counters.clear()
    monkeypatch.setattr(nl_compile, "_et_day", lambda: "2026-10-02")
    from api.middleware.auth_middleware import get_current_user_with_plan
    monkeypatch.setattr(rx, "is_paid_user", lambda u: True)
    app = FastAPI()
    app.include_router(rx.router)
    app.dependency_overrides[get_current_user_with_plan] = lambda: {"id": "nl-u1", "plan": "pro"}
    yield TestClient(app)
    daily_counters.clear()


def _arm(monkeypatch, nl=True, lg=True):
    for flag, on in ((nl_compile.FLAG, nl), (logic.FLAG, lg)):
        if on:
            monkeypatch.setenv(flag, "1")
        else:
            monkeypatch.delenv(flag, raising=False)


def test_the_route_needs_both_flags(client, monkeypatch):
    _arm(monkeypatch, nl=True, lg=False)
    assert client.post("/api/screener/compile", json={"text": "x"}).status_code == 404
    _arm(monkeypatch, nl=False, lg=True)
    assert client.post("/api/screener/compile", json={"text": "x"}).status_code == 404


def test_metered_and_a_failure_gives_the_charge_back(client, monkeypatch):
    _arm(monkeypatch)
    monkeypatch.setenv(nl_compile.CAP_ENV, "1")
    monkeypatch.setattr(nl_compile, "_call", replies({"criteria": "nope nope", "assumptions": []},
                                                      {"criteria": "nope nope", "assumptions": []}))
    assert client.post("/api/screener/compile", json={"text": "junk"}).status_code == 400
    assert daily_counters.value("2026-10-02", nl_compile.SCOPE, "nl-u1") == 0
    monkeypatch.setattr(nl_compile, "_call", replies({"criteria": "price > 10", "assumptions": []}))
    r = client.post("/api/screener/compile", json={"text": "over ten dollars"})
    assert r.status_code == 200 and r.json()["criteria"] == "price > 10"
    r2 = client.post("/api/screener/compile", json={"text": "again"})
    assert r2.status_code == 429 and "plain-English" in r2.json()["detail"]


def test_a_provider_failure_is_a_503_sentence(client, monkeypatch):
    _arm(monkeypatch)

    def boom(messages):
        raise TimeoutError("slow")
    monkeypatch.setattr(nl_compile, "_call", boom)
    r = client.post("/api/screener/compile", json={"text": "anything"})
    assert r.status_code == 503 and "unavailable" in r.json()["detail"]
    assert daily_counters.value("2026-10-02", nl_compile.SCOPE, "nl-u1") == 0
