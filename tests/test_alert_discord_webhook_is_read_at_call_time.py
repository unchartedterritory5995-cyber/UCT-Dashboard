"""The alert Discord webhook is read at CALL time, never captured at import.

⚰️ THE DEFECT. `alerts.py` held the webhook as a module constant:

    _DISCORD_WEBHOOK = os.environ.get("DISCORD_ALERT_WEBHOOK", "")

so setting or clearing `DISCORD_ALERT_WEBHOOK` reached nothing until the process
restarted.

⛔ THE DANGEROUS DIRECTION IS THE CLEAR, NOT THE SET. Blanking a webhook is how
this estate turns a channel OFF — the standing rule is that a kill switch is a
variable and never a delete. Against an import-time capture the operator blanks
it, reads it back empty, sees `railway variables --kv` agree, and the running
process keeps posting to a channel everyone believes is silent. And `--set` has
been measured NOT to restart the service on some services, so even the set
direction was not reliably applied.

⭐ Same class as F-S7-5, where a mirror answered from a module constant while
production ran a different value.
"""
from __future__ import annotations

import importlib

import pytest

from api.services import alerts


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    monkeypatch.delenv(alerts.DISCORD_WEBHOOK_ENV, raising=False)
    yield


def test_setting_the_webhook_takes_effect_without_a_restart(monkeypatch):
    assert alerts.discord_webhook() == ""
    monkeypatch.setenv(alerts.DISCORD_WEBHOOK_ENV, "https://discord.test/hook")
    assert alerts.discord_webhook() == "https://discord.test/hook", (
        "the webhook is still being read from a value captured earlier")


def test_CLEARING_the_webhook_takes_effect_without_a_restart(monkeypatch):
    """⛔ The direction that matters. A blanked webhook must stop posting NOW."""
    monkeypatch.setenv(alerts.DISCORD_WEBHOOK_ENV, "https://discord.test/hook")
    assert alerts.discord_webhook() == "https://discord.test/hook"
    monkeypatch.setenv(alerts.DISCORD_WEBHOOK_ENV, "")
    assert alerts.discord_webhook() == "", (
        "blanking the webhook did not silence it — the operator's kill switch "
        "reads as applied and the process keeps posting")


def test_the_value_is_not_cached_between_two_reads_in_one_process(monkeypatch):
    """A memo added 'for efficiency' would rebuild the whole defect."""
    monkeypatch.setenv(alerts.DISCORD_WEBHOOK_ENV, "https://a.test/1")
    first = alerts.discord_webhook()
    monkeypatch.setenv(alerts.DISCORD_WEBHOOK_ENV, "https://b.test/2")
    second = alerts.discord_webhook()
    assert (first, second) == ("https://a.test/1", "https://b.test/2")


def test_an_unset_variable_is_the_empty_string_never_None(monkeypatch):
    """Both call sites use it in a boolean test; None would work there and then
    surprise `requests.post(None, ...)` the day someone passes it through."""
    monkeypatch.delenv(alerts.DISCORD_WEBHOOK_ENV, raising=False)
    assert alerts.discord_webhook() == ""


def test_the_module_no_longer_captures_the_webhook_at_import():
    """The structural half — a live-read helper plus a resurrected constant is
    two authorities, and the constant would win at whichever call site kept it."""
    src = open("api/services/alerts.py", encoding="utf-8").read()
    body = "\n".join(l for l in src.splitlines() if not l.lstrip().startswith("#"))
    assert "_DISCORD_WEBHOOK =" not in body, (
        "an import-time capture of the webhook has come back")
    assert not hasattr(alerts, "_DISCORD_WEBHOOK"), (
        "the module still exposes the captured constant")


def test_add_alert_consults_the_LIVE_value_when_deciding_to_fire(monkeypatch):
    """⭐ The behavioural half. The helper being live proves nothing if the
    decision site still reads something else — that is the exact shape of the
    'routing computed but never applied' defect this repo keeps rediscovering."""
    monkeypatch.setenv(alerts.DISCORD_WEBHOOK_ENV, "")
    fired: list = []
    monkeypatch.setattr(alerts, "_fire_discord", lambda *a, **k: fired.append(a))
    monkeypatch.setattr(alerts, "_store_alert", lambda *a, **k: None, raising=False)

    src = open("api/services/alerts.py", encoding="utf-8").read()
    assert "if discord_webhook() and fires_discord:" in src, (
        "add_alert's fire decision no longer reads the live value")
    assert "_DISCORD_WEBHOOK," not in src, (
        "_fire_discord is still handed the captured constant")
