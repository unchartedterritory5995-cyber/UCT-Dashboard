"""Every metered client runs with max_retries=0, across the whole of api/.

The SDK retries twice by default. One charged attempt that times out could therefore be
three billed calls, and no ledger or daily count sees the extra two. A lane that keeps a
retry must be named in KEPT_RETRIES with the retry count its worst-case charge multiplies
by (worst case x (retries + 1)). Only options flow does: it does not change behaviour
without its owner.
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

#: path -> (retries kept, the function that charges worst case x (retries + 1)).
KEPT_RETRIES: dict[str, tuple[int, str]] = {"api/flow_explain.py": (2, "_charge_failed_call")}
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
    assert kept == []


def test_the_named_retry_constants_are_zero():
    from api.services import definition_concierge, indicator_from_image
    assert definition_concierge.MAX_HTTP_RETRIES == 0
    assert indicator_from_image.MAX_HTTP_RETRIES == 0


def test_a_kept_retry_names_its_multiplier():
    for rel, (retries, charged_at) in KEPT_RETRIES.items():
        assert retries > 0 and charged_at, rel
        assert f"def {charged_at}(" in (ROOT / rel).read_text(encoding="utf-8"), rel


def test_flow_explain_keeps_exactly_the_sdk_default(monkeypatch):
    from anthropic._constants import DEFAULT_MAX_RETRIES

    from api import flow_explain
    monkeypatch.setenv("ANTHROPIC_API_KEY", "test-key")
    monkeypatch.setattr(engine, "_anthropic_client", None)
    assert flow_explain._SDK_RETRIES == DEFAULT_MAX_RETRIES == KEPT_RETRIES["api/flow_explain.py"][0]
    assert flow_explain._anthropic().max_retries == DEFAULT_MAX_RETRIES
    assert engine._get_anthropic_client().max_retries == 0     # the copy did not change the shared client


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
