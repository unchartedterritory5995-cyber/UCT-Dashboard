"""The wire coverage MONITOR — heal first, alert second, never cry wolf.

The observe-only shape was rejected on purpose: the wire has two NORMAL lag
windows (the 10-min calendar TTL, the hourly off-window tick), and an alert
that fires inside them gets muted inside a week. So the job rebuilds the
calendar + runs a tick BEFORE judging, and only what survives that heal is a
defect worth waking anyone for.
"""
import ast
from unittest import mock

from fastapi.testclient import TestClient

from api.main import app
from api.services.wire import coverage_monitor as mon

client = TestClient(app)

MD = "2026-08-11"


def _cov(missing=(), pending=(), measured=True, not_on_roster=()):
    return {"market_date": MD, "measured": measured,
            "reported": 10, "on_feed_with_numbers": 10 - len(missing),
            "missing_from_feed": list(missing),
            "missing_not_on_roster": list(not_on_roster),
            "missing_on_roster": [s for s in missing if s not in not_on_roster],
            "numbers_pending_on_feed": list(pending),
            "ok": not missing and not pending}


def _patch(monkeypatch, results, heal=None):
    """coverage.build_coverage returns `results` in order; heal fns recorded."""
    seq = iter(results)
    monkeypatch.setattr(mon, "market_session_date", lambda: MD)
    monkeypatch.setattr(mon.coverage, "build_coverage", lambda md: next(seq))
    calls = []
    monkeypatch.setattr(mon, "_heal",
                        heal if heal is not None else (lambda: calls.append("heal")))
    return calls


# ── behavior ──────────────────────────────────────────────────────────────────

def test_a_complete_feed_neither_heals_nor_alerts(monkeypatch):
    calls = _patch(monkeypatch, [_cov()])
    with mock.patch.object(mon, "_alert_incomplete") as a, \
         mock.patch.object(mon, "_alert_unmeasured") as u:
        out = mon.run_check()
    assert out["ok"] is True and out["healed"] is False and out["alerted"] is False
    assert calls == []
    a.assert_not_called()
    u.assert_not_called()


def test_a_gap_that_the_heal_fixes_stays_silent(monkeypatch):
    """The whole point: transient lag is HEALED, not reported."""
    calls = _patch(monkeypatch, [_cov(missing=["SLAB"]), _cov()])
    with mock.patch.object(mon, "_alert_incomplete") as a:
        out = mon.run_check()
    assert calls == ["heal"]
    assert out["healed"] is True and out["ok"] is True and out["alerted"] is False
    a.assert_not_called()


def test_a_gap_that_survives_the_heal_alerts_with_the_names(monkeypatch):
    _patch(monkeypatch, [_cov(missing=["SLAB", "BGS"]),
                         _cov(missing=["SLAB"], pending=["CAH"])])
    sent = {}
    monkeypatch.setattr("api.services.chart_health_alerts.emit",
                        lambda key, sev, msg, meta=None: sent.update(
                            {"key": key, "sev": sev, "msg": msg}) or True)
    embeds = []
    monkeypatch.setattr("api.services.discord_notify._send_webhook",
                        lambda e: embeds.append(e))
    out = mon.run_check()
    assert out["alerted"] is True and out["ok"] is False
    # Names in the MESSAGE, never just a count.
    assert "SLAB" in sent["msg"] and "CAH" in sent["msg"]
    assert embeds and "SLAB" in embeds[0]["description"]


def test_unmeasured_is_a_warning_not_a_clean_bill_and_never_heals(monkeypatch):
    calls = _patch(monkeypatch, [_cov(measured=False)])
    with mock.patch.object(mon, "_alert_unmeasured") as u, \
         mock.patch.object(mon, "_alert_incomplete") as a:
        out = mon.run_check()
    assert out["measured"] is False and out["ok"] is None and out["alerted"] is True
    assert calls == []          # no truth to heal toward
    u.assert_called_once()
    a.assert_not_called()


def test_run_check_never_raises_and_records_the_failure(monkeypatch):
    monkeypatch.setattr(mon, "market_session_date", lambda: MD)
    monkeypatch.setattr(mon.coverage, "build_coverage",
                        mock.Mock(side_effect=RuntimeError("boom")))
    out = mon.run_check()
    assert out["error"] == "boom"
    assert mon.LAST_RUN["result"]["error"] == "boom"


def test_alert_names_are_capped_for_display_but_counted_in_full():
    syms = [f"S{i:03d}" for i in range(40)]
    text = mon._fmt_names(syms)
    assert "S000" in text and "S024" in text
    assert "S025" not in text and "+15 more" in text


# ── the wires ─────────────────────────────────────────────────────────────────

def test_main_py_registers_the_monitor_job_inside_the_wire_block():
    """AST over main.py: an add_job with id='wire_coverage_monitor' exists.
    Control: the same probe sees the sibling detector job — so an empty result
    means the job is GONE, not that the probe went blind."""
    import api.main as main_mod
    src = open(main_mod.__file__, encoding="utf-8").read()
    tree = ast.parse(src)
    ids = set()
    for node in ast.walk(tree):
        if (isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "add_job"):
            for kw in node.keywords:
                if kw.arg == "id" and isinstance(kw.value, ast.Constant):
                    ids.add(kw.value.value)
    assert "wire_detector" in ids            # non-vacuity control
    assert "wire_coverage_monitor" in ids


def test_run_endpoint_requires_the_push_secret(monkeypatch):
    monkeypatch.setenv("PUSH_SECRET", "s3cret")
    ran = mock.Mock(return_value={"ok": True})
    monkeypatch.setattr(mon, "run_check", ran)
    assert client.post("/api/calendar/wire-coverage/run").status_code == 401
    assert client.post("/api/calendar/wire-coverage/run",
                       headers={"Authorization": "Bearer wrong"}).status_code == 401
    ran.assert_not_called()
    r = client.post("/api/calendar/wire-coverage/run",
                    headers={"Authorization": "Bearer s3cret"})
    assert r.status_code == 200 and r.json() == {"ok": True}
    ran.assert_called_once()


def test_run_endpoint_refuses_when_no_secret_is_configured(monkeypatch):
    monkeypatch.delenv("PUSH_SECRET", raising=False)
    r = client.post("/api/calendar/wire-coverage/run",
                    headers={"Authorization": "Bearer "})
    assert r.status_code == 401


def test_the_flag_defaults_on_and_the_env_var_turns_it_off(monkeypatch):
    monkeypatch.delenv("WIRE_COVERAGE_MONITOR_ENABLED", raising=False)
    assert mon.enabled() is True
    monkeypatch.setenv("WIRE_COVERAGE_MONITOR_ENABLED", "0")
    assert mon.enabled() is False


def test_the_heal_actually_forces_a_build_and_a_tick(monkeypatch):
    built, ticked = mock.Mock(), mock.Mock()
    import api.routers.calendar as cal
    monkeypatch.setattr(cal, "_build_current_week", built)
    monkeypatch.setattr("api.services.wire.detector.run_wire_tick", ticked)
    mon._heal()
    built.assert_called_once()
    ticked.assert_called_once()
