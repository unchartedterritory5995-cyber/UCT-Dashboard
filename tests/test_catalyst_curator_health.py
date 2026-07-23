"""Curator guardrail — a silent fallback must be LOUD (log + deduped Discord)."""
import pytest

from api.services.catalyst import curator, curator_health


MD = "2026-07-23"


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    curator._RAN_BY_DATE.clear()
    curator._LAST_FALLBACK_REASON.clear()
    curator_health._ALERTED_DATES.clear()
    yield


def _capture_discord(monkeypatch):
    sent = []
    monkeypatch.setattr(curator_health, "_send_discord",
                        lambda md, reason: sent.append((md, reason)))
    return sent


def test_alerts_when_enabled_and_fell_back(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    sent = _capture_discord(monkeypatch)
    curator._RAN_BY_DATE[MD] = False
    curator._LAST_FALLBACK_REASON[MD] = "LLM response hit max_tokens"
    curator_health.check_and_alert(MD)
    assert len(sent) == 1
    assert "max_tokens" in sent[0][1]


def test_no_alert_when_curator_ran(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    sent = _capture_discord(monkeypatch)
    curator._RAN_BY_DATE[MD] = True          # it ran — all good
    curator_health.check_and_alert(MD)
    assert sent == []


def test_no_alert_when_flag_off(monkeypatch):
    monkeypatch.delenv("CATALYST_CURATOR_ENABLED", raising=False)
    sent = _capture_discord(monkeypatch)
    curator._RAN_BY_DATE[MD] = False          # fell back, but curator is OFF by design
    curator_health.check_and_alert(MD)
    assert sent == []


def test_deduped_once_per_day(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    sent = _capture_discord(monkeypatch)
    curator._RAN_BY_DATE[MD] = False
    curator._LAST_FALLBACK_REASON[MD] = "exception: RuntimeError"
    curator_health.check_and_alert(MD)
    curator_health.check_and_alert(MD)        # every 5-min refresh keeps falling back
    curator_health.check_and_alert(MD)
    assert len(sent) == 1                      # only one Discord ping for the day


def test_alert_can_be_disabled(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")
    monkeypatch.setenv("CATALYST_CURATOR_ALERT_ENABLED", "0")
    sent = _capture_discord(monkeypatch)
    curator._RAN_BY_DATE[MD] = False
    curator_health.check_and_alert(MD)
    assert sent == []


def test_never_raises(monkeypatch):
    monkeypatch.setenv("CATALYST_CURATOR_ENABLED", "1")

    def boom(md, reason):
        raise RuntimeError("discord down")
    monkeypatch.setattr(curator_health, "_send_discord", boom)
    curator._RAN_BY_DATE[MD] = False
    curator._LAST_FALLBACK_REASON[MD] = "x"
    curator_health.check_and_alert(MD)         # must not raise
