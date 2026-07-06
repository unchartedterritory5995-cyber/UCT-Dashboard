import sqlite3
from datetime import datetime, timedelta, timezone

from api.services import compass_health as ch

_TS = "%Y-%m-%d %H:%M:%S"


def _recent(hours=1):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).strftime(_TS)


def _old(days=30):
    return (datetime.now(timezone.utc) - timedelta(days=days)).strftime(_TS)


def _seed_conn():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE j2_chat_messages (user_id TEXT, role TEXT, created_at TEXT)")
    c.execute("CREATE TABLE voice_tool_calls (tool_name TEXT, ok INTEGER, latency_ms INTEGER, created_at TEXT)")
    # recent chat: u1 x2, u2 x1 user turns (+ an assistant turn that must NOT count)
    for _ in range(2):
        c.execute("INSERT INTO j2_chat_messages VALUES ('u1','user',?)", (_recent(),))
    c.execute("INSERT INTO j2_chat_messages VALUES ('u2','user',?)", (_recent(),))
    c.execute("INSERT INTO j2_chat_messages VALUES ('u1','assistant',?)", (_recent(),))
    c.execute("INSERT INTO j2_chat_messages VALUES ('u9','user',?)", (_old(),))  # outside window
    # recent tool calls: 4 ok, 1 fail on get_regime
    for _ in range(4):
        c.execute("INSERT INTO voice_tool_calls VALUES ('get_quote',1,120,?)", (_recent(),))
    c.execute("INSERT INTO voice_tool_calls VALUES ('get_regime',0,90,?)", (_recent(),))
    c.execute("INSERT INTO voice_tool_calls VALUES ('get_quote',0,90,?)", (_old(),))  # outside window
    c.commit()
    return c


def test_compute_health_windows_and_counts():
    m = ch.compute_health(_seed_conn(), days=7)
    assert m["chat_turns"] == 3          # user turns only, assistant + old excluded
    assert m["active_users"] == 2        # u1, u2 (u9 old)
    assert m["tool_calls"] == 5          # old call excluded
    assert m["tool_failures"] == 1
    assert m["tool_failure_rate"] == 0.2
    assert m["top_failing_tools"] == [{"tool": "get_regime", "failures": 1}]


def test_compute_health_empty_is_safe():
    c = sqlite3.connect(":memory:")
    c.row_factory = sqlite3.Row
    c.execute("CREATE TABLE j2_chat_messages (user_id TEXT, role TEXT, created_at TEXT)")
    c.execute("CREATE TABLE voice_tool_calls (tool_name TEXT, ok INTEGER, latency_ms INTEGER, created_at TEXT)")
    m = ch.compute_health(c, days=7)
    assert m["chat_turns"] == 0 and m["tool_failure_rate"] == 0.0 and m["top_failing_tools"] == []


def test_compute_health_never_raises_on_missing_tables():
    c = sqlite3.connect(":memory:")  # no tables at all
    c.row_factory = sqlite3.Row
    m = ch.compute_health(c, days=7)
    assert m["chat_turns"] == 0 and m["tool_calls"] == 0  # queries fail-soft


def test_render_email_has_subject_and_metrics():
    m = ch.compute_health(_seed_conn(), days=7)
    subject, html = ch.render_health_email(m)
    assert "Compass Health" in subject and "20.0%" in subject
    assert "get_regime" in html and "Chat turns" in html


def test_render_email_clean_when_no_failures():
    subject, html = ch.render_health_email(
        {"period_days": 7, "chat_turns": 5, "active_users": 2, "tool_calls": 10,
         "tool_failures": 0, "tool_failure_rate": 0.0, "avg_latency_ms": 100, "top_failing_tools": []})
    assert "No tool failures" in html


def test_send_no_recipients_is_graceful(monkeypatch):
    monkeypatch.delenv("COMPASS_HEALTH_EMAIL_TO", raising=False)
    monkeypatch.delenv("ADMIN_EMAILS", raising=False)
    # avoid touching the real auth.db
    monkeypatch.setattr(ch, "compute_health", lambda conn, days=7: {"period_days": days})
    import api.services.auth_db as adb
    monkeypatch.setattr(adb, "get_connection", lambda: sqlite3.connect(":memory:"))
    out = ch.send_weekly_health_email()
    assert out["sent"] == 0 and "no recipients" in (out["error"] or "")
