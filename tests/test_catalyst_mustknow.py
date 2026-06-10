"""Tests for must-know catalyst alerts (_fire_mustknow_alerts)."""
import api.services.catalyst.engine as engine
import api.services.watchlist_alert_service as wal


def _row(ticker, grade, ctype="M&A"):
    return {"ticker": ticker, "grade": grade, "catalyst_type": ctype,
            "gap_pct": 5.0, "thesis_text": "thesis", "tag": "Catalyst"}


def test_gated_off_by_default(monkeypatch):
    monkeypatch.delenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", raising=False)
    sent = []
    monkeypatch.setattr(wal, "deliver_alert_payload", lambda **k: sent.append(k))
    assert engine._fire_mustknow_alerts([_row("AAA", "A")], "2026-06-10") == 0
    assert sent == []


def test_fires_AB_to_admins_excludes_C(monkeypatch):
    monkeypatch.setenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", "1")
    monkeypatch.setattr(engine, "_collect_admin_user_ids", lambda: ["admin1"])
    monkeypatch.setattr(engine.store, "try_record_alert", lambda u, t, d: True)
    sent = []
    monkeypatch.setattr(wal, "deliver_alert_payload", lambda **k: sent.append(k["sym"]))
    rows = [_row("AAA", "A"), _row("BBB", "B"), _row("CCC", "C")]
    n = engine._fire_mustknow_alerts(rows, "2026-06-10")
    assert n == 2
    assert set(sent) == {"AAA", "BBB"}  # grade C excluded


def test_dedup_skips_already_fired(monkeypatch):
    monkeypatch.setenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", "1")
    monkeypatch.setattr(engine, "_collect_admin_user_ids", lambda: ["admin1"])
    monkeypatch.setattr(engine.store, "try_record_alert", lambda u, t, d: False)
    sent = []
    monkeypatch.setattr(wal, "deliver_alert_payload", lambda **k: sent.append(k))
    assert engine._fire_mustknow_alerts([_row("AAA", "A")], "2026-06-10") == 0
    assert sent == []


def test_no_admins_no_fire(monkeypatch):
    monkeypatch.setenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", "1")
    monkeypatch.setattr(engine, "_collect_admin_user_ids", lambda: [])
    sent = []
    monkeypatch.setattr(wal, "deliver_alert_payload", lambda **k: sent.append(k))
    assert engine._fire_mustknow_alerts([_row("AAA", "A")], "2026-06-10") == 0
    assert sent == []


def test_custom_grade_threshold(monkeypatch):
    monkeypatch.setenv("CATALYST_MUSTKNOW_ALERTS_ENABLED", "1")
    monkeypatch.setenv("CATALYST_MUSTKNOW_GRADES", "A")  # A only
    monkeypatch.setattr(engine, "_collect_admin_user_ids", lambda: ["admin1"])
    monkeypatch.setattr(engine.store, "try_record_alert", lambda u, t, d: True)
    sent = []
    monkeypatch.setattr(wal, "deliver_alert_payload", lambda **k: sent.append(k["sym"]))
    n = engine._fire_mustknow_alerts([_row("AAA", "A"), _row("BBB", "B")], "2026-06-10")
    assert n == 1 and sent == ["AAA"]
