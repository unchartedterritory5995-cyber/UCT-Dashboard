"""Model Book and /about failures are not re-billed on the next ask. Models are mocked."""
from __future__ import annotations

from unittest.mock import MagicMock

import anthropic
import httpx
import pytest

from api.routers import modelbook
from api.services import company_about
from api.services.cache import cache

REQUEST = httpx.Request("POST", "https://example.invalid/v1/messages")
TIMEOUT = anthropic.APITimeoutError(REQUEST)
HTTP_ERROR = anthropic.InternalServerError("overloaded", response=httpx.Response(529, request=REQUEST), body=None)
GOOD_DESC = '{"company_desc": "Makes things.", "run_story": "A story.", "sector": "Tech", "industry": "Chips"}'
GOOD_BRIEF = '{"whatTheyDo": "Makes things.", "whatMovesIt": "Demand."}'
SYM = "ZZTEST"


def _msg(text):
    return MagicMock(content=[MagicMock(type="text", text=text)])  # real SDK blocks carry a type


@pytest.fixture
def client(monkeypatch):
    c = MagicMock()
    monkeypatch.setattr("api.services.engine._get_anthropic_client", lambda: c)
    monkeypatch.setattr(modelbook, "_DESC_ENABLED", True)
    monkeypatch.setattr(modelbook._time_mod, "sleep", lambda _s: None)
    cache.invalidate(f"about_brief::{SYM}")
    yield c
    cache.invalidate(f"about_brief::{SYM}")


def _describe():
    return modelbook._generate_descriptions(SYM, "Test Co", 2025, 10)


def test_a_timeout_is_not_re_asked(client):
    client.messages.create.side_effect = TIMEOUT
    assert _describe() is None
    assert client.messages.create.call_count == 1


def test_an_http_error_is_free_so_it_is_still_retried(client):
    client.messages.create.side_effect = [HTTP_ERROR, HTTP_ERROR, _msg(GOOD_DESC)]
    assert _describe()["company_desc"] == "Makes things."
    assert client.messages.create.call_count == 3


def test_a_prose_reply_is_still_re_asked_up_to_the_same_limit(client):
    client.messages.create.side_effect = [_msg("Prose caveat.")] * 3 + [_msg(GOOD_DESC)]
    assert _describe()["company_desc"] == "Makes things."
    client.messages.create.side_effect = [_msg("Prose caveat.")] * 9
    client.messages.create.reset_mock()
    assert _describe() is None
    assert client.messages.create.call_count == 4


def test_a_failed_brief_is_not_re_bought_on_the_next_tab_open(client):
    client.messages.create.return_value = _msg("not json")
    assert company_about.get_brief(SYM, {}) == {}
    assert company_about.get_brief(SYM, {}) == {}
    assert client.messages.create.call_count == 1


def test_a_failed_brief_expires_well_before_a_good_one(client):
    from api.services.cache import cache as c
    client.messages.create.side_effect = TIMEOUT
    company_about.get_brief(SYM, {})
    _, expires = c._store[f"about_brief::{SYM}"]
    import time
    assert expires - time.time() <= company_about._BRIEF_FAIL_TTL
    assert company_about._BRIEF_FAIL_TTL < company_about._BRIEF_TTL


def test_a_good_brief_keeps_its_thirty_days(client):
    client.messages.create.return_value = _msg(GOOD_BRIEF)
    assert company_about.get_brief(SYM, {})["whatTheyDo"] == "Makes things."
    assert company_about.get_brief(SYM, {})["whatTheyDo"] == "Makes things."
    assert client.messages.create.call_count == 1
    assert company_about._BRIEF_TTL == 30 * 86400
