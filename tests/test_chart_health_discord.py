"""Critical chart-health alerts now PAGE Discord (instant-origin Phase 0/2).

The in-memory deque was admin-pull-only, so a bars-store problem paged no one —
the gap that let the 2026-08-11 daily freeze run a week. Cover the pure page-gate:
critical-only, config-gated, own cooldown.
"""
from api.services import chart_health_alerts as cha


def setup_function(_):
    cha.clear()


def _gate(key, sev, now, *, webhook=True, enabled=True, cooldown=1800):
    return cha._should_page_discord(key, sev, now, webhook_present=webhook,
                                    enabled=enabled, cooldown=cooldown)


def test_pages_once_then_cools_down():
    assert _gate("bars_daily_store_stale", "critical", 1000) is True
    # within cooldown → suppressed
    assert _gate("bars_daily_store_stale", "critical", 1000 + 900) is False
    # past cooldown → pages again
    assert _gate("bars_daily_store_stale", "critical", 1000 + 1900) is True


def test_only_critical_pages():
    assert _gate("x", "warning", 1000) is False
    assert _gate("x", "info", 1000) is False
    assert _gate("x", "critical", 1000) is True


def test_config_gates():
    assert _gate("a", "critical", 1000, webhook=False) is False   # no webhook
    assert _gate("b", "critical", 1000, enabled=False) is False   # kill-switch off


def test_distinct_keys_have_independent_cooldowns():
    assert _gate("k1", "critical", 1000) is True
    assert _gate("k2", "critical", 1000) is True   # different key not suppressed


def test_emit_still_returns_true_and_queues(monkeypatch):
    # No webhook env → no network, but the alert still queues + throttles as before.
    monkeypatch.delenv("DISCORD_WEBHOOK_URL", raising=False)
    assert cha.emit("some_key", "critical", "msg") is True
    assert cha.list_recent()[0]["alert_key"] == "some_key"
    # same key within the 10-min deque throttle → not re-emitted
    assert cha.emit("some_key", "critical", "msg2") is False
