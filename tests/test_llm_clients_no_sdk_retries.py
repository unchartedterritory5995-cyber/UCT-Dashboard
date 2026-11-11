"""Every metered client runs with max_retries=0, across the whole of api/.

The SDK retries twice by default. One charged attempt that times out could therefore be
three billed calls, and no ledger or daily count sees the extra two. A lane that keeps a
retry must be named in KEPT_RETRIES with the retry count its worst-case charge multiplies
by (worst case x (retries + 1)). The two options-flow lanes keep the SDK default, and a
failed call charges exactly that: tests/test_flow_lanes_failed_call_charged.py.
"""
from __future__ import annotations

import ast
import pathlib

import anthropic
import httpx
import pytest

from api.services import engine
from api.services.uct_agent import budget

ROOT = pathlib.Path(__file__).resolve().parents[1]
REQUEST = httpx.Request("POST", "https://example.invalid/v1/messages")

#: path -> (retries kept, why). A new entry needs a worst case x (retries + 1) charge.
HANDS_OFF = "options-flow: retries kept; a failed call charges worst case x (retries + 1)"
KEPT_RETRIES: dict[str, tuple[int, str]] = {
    "api/flow_explain.py": (anthropic.DEFAULT_MAX_RETRIES, HANDS_OFF),
    "api/schwab_router.py": (anthropic.DEFAULT_MAX_RETRIES, HANDS_OFF),
}
#: Constants a call may name, each pinned to 0 below.
ZERO_CONSTANTS = {"MAX_HTTP_RETRIES"}


def _sources():
    for path in sorted((ROOT / "api").rglob("*.py")):
        if path.name.startswith("test_"):
            continue
        yield path, path.relative_to(ROOT).as_posix()


def _calls(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            f = node.func
            yield node, (f.attr if isinstance(f, ast.Attribute) else getattr(f, "id", ""))


def _retries(node):
    return next((k.value for k in node.keywords if k.arg == "max_retries"), None)


def _is_zero(value) -> bool:
    if isinstance(value, ast.Constant):
        return value.value == 0
    if isinstance(value, ast.Attribute):
        return value.attr in ZERO_CONSTANTS
    return isinstance(value, ast.Name) and value.id in ZERO_CONSTANTS


def test_every_sdk_client_is_built_with_no_retries():
    missing, seen = [], 0
    for path, rel in _sources():
        text = path.read_text(encoding="utf-8")
        if "Anthropic(" not in text:
            continue
        for node, name in _calls(ast.parse(text)):
            if name not in ("Anthropic", "AsyncAnthropic"):
                continue
            seen += 1
            if rel not in KEPT_RETRIES and not (_retries(node) is not None and _is_zero(_retries(node))):
                missing.append(f"{rel}:{node.lineno}")
    assert seen >= 15                               # the walk really found the clients
    assert missing == []


def test_no_per_call_override_turns_retries_back_on():
    kept = []
    for path, rel in _sources():
        text = path.read_text(encoding="utf-8")
        if "with_options" not in text:
            continue
        for node, name in _calls(ast.parse(text)):
            value = _retries(node) if name == "with_options" else None
            if value is not None and not _is_zero(value) and rel not in KEPT_RETRIES:
                kept.append(f"{rel}:{node.lineno}")
    # The one override: the shared client's copy for `_KEEPS_SDK_RETRIES`, pinned below.
    assert [site.split(":")[0] for site in kept] == ["api/services/engine.py"]


def test_the_named_retry_constants_are_zero():
    from api.services import definition_concierge, indicator_from_image
    assert definition_concierge.MAX_HTTP_RETRIES == 0
    assert indicator_from_image.MAX_HTTP_RETRIES == 0


def test_a_kept_retry_names_its_multiplier():
    for rel, (retries, note) in KEPT_RETRIES.items():
        assert retries > 0 and note, rel


def test_flow_explain_effective_retries_are_the_sdk_default(monkeypatch):
    from api import flow_explain
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(engine, "_anthropic_client", None)
    assert flow_explain._anthropic().max_retries == anthropic.DEFAULT_MAX_RETRIES
    assert engine._get_anthropic_client().max_retries == 0     # the copy did not change the shared client


def _overloaded_provider(monkeypatch):
    """The real SDK client on a transport that answers every request with a 529. Counting
    requests measures the retries that really happen, whatever the path to the client."""
    requests = []

    def answer(request):
        requests.append(request)
        return httpx.Response(529, json={"type": "error", "error": {"type": "overloaded_error", "message": "x"}})

    client = anthropic.Anthropic(api_key="test-key", timeout=5.0, max_retries=0,
                                 http_client=anthropic.DefaultHttpxClient(transport=httpx.MockTransport(answer)))
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(engine, "_anthropic_client", client)
    monkeypatch.setattr("anthropic._base_client.time.sleep", lambda _s: None)
    return requests


def test_the_real_flow_explain_path_makes_every_sdk_attempt(tmp_path, monkeypatch):
    """Route -> _call_llm -> _anthropic -> shared client -> SDK, nothing faked above the
    transport. A wrapper added between flow_explain and the engine changes the frame the
    exemption reads, the client comes back with 0 retries, and this count goes to 1."""
    from api import flow_explain
    monkeypatch.setenv("FLOW_EXPLAIN_DB_PATH", str(tmp_path / "flow_explain.db"))
    monkeypatch.setattr(engine, "get_earnings", lambda: {"bmo": [], "amc": [], "amc_tonight": []})
    monkeypatch.setattr(flow_explain, "get_cached_gex", lambda _t: None)
    requests = _overloaded_provider(monkeypatch)
    body = flow_explain.FlowPrint(ticker="NVDA", cp="C", strike=190.0, exp="2026-08-21", dte=46,
                                  premium=525_000.0, volume=3200, oi=1100, side="ASK", spot=178.40)
    out = flow_explain.explain_print(body, user={"id": "retry-pin"})
    assert out.model == flow_explain._FALLBACK_MODEL_NAME
    assert len(requests) == anthropic.DEFAULT_MAX_RETRIES + 1


def test_every_other_caller_makes_one_attempt(monkeypatch):
    requests = _overloaded_provider(monkeypatch)
    with pytest.raises(anthropic.APIStatusError):
        engine._get_anthropic_client().messages.create(
            model="claude-haiku-4-5", max_tokens=1, messages=[{"role": "user", "content": "x"}])
    assert len(requests) == 1


def _client_called_from(module_name, monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(engine, "_anthropic_client", None)
    scope = {"__name__": module_name, "get": engine._get_anthropic_client}
    exec("client = get()", scope)
    return scope["client"]


def test_the_exemption_is_keyed_on_exactly_the_module_name(monkeypatch):
    assert engine._KEEPS_SDK_RETRIES == {"api.flow_explain"}
    assert _client_called_from("api.flow_explain", monkeypatch).max_retries == anthropic.DEFAULT_MAX_RETRIES
    for other in ("flow_explain", "api.flow_explain_helper", "api.services.flow_explain"):
        assert _client_called_from(other, monkeypatch).max_retries == 0


def test_the_exemption_logs_once_when_it_fires(monkeypatch, caplog):
    monkeypatch.setattr(engine, "_keeps_sdk_retries_logged", False)
    with caplog.at_level("INFO", logger=engine._logger.name):
        _client_called_from("api.services.something_else", monkeypatch)
        assert "keeps the SDK default" not in caplog.text    # it has not fired yet
        for _ in range(3):
            _client_called_from("api.flow_explain", monkeypatch)
    assert caplog.text.count("api.flow_explain keeps the SDK default of 2 retries") == 1


def test_schwab_router_builds_its_client_with_the_sdk_default():
    tree = ast.parse((ROOT / "api/schwab_router.py").read_text(encoding="utf-8"))
    clients = [node for node, name in _calls(tree) if name == "Anthropic"]
    assert clients and all(_retries(node) is None for node in clients)


def test_no_other_flow_lane_reaches_the_shared_client():
    lanes = [p for p in (ROOT / "api").glob("*.py")
             if p.name.startswith(("flow_", "massive_")) and p.name != "flow_explain.py"]
    assert lanes
    for path in lanes:
        text = path.read_text(encoding="utf-8")
        assert "_get_anthropic_client" not in text and "Anthropic(" not in text, path.name


def test_the_shared_client_and_its_per_call_copies_do_not_retry(monkeypatch):
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(engine, "_anthropic_client", None)
    client = engine._get_anthropic_client()
    assert client.max_retries == 0
    assert client.with_options(timeout=5).max_retries == 0


@pytest.mark.parametrize("status,free", [(400, True), (429, True), (500, True), (529, True), (200, False)])
def test_only_a_real_http_error_counts_as_free(status, free):
    error = anthropic.APIStatusError("error", response=httpx.Response(status, request=REQUEST), body=None)
    assert budget._is_provider_error_response(error) is free


def test_timeouts_and_dropped_connections_are_not_free():
    assert budget._is_provider_error_response(anthropic.APITimeoutError(REQUEST)) is False
    assert budget._is_provider_error_response(anthropic.APIConnectionError(request=REQUEST)) is False
