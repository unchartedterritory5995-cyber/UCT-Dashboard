"""TERM-018: the wire coverage monitor's two guards, observed TWO-SIDED.

G-16 / G-17 were "PROVEN, one-sided": `tests/test_wire_coverage_monitor.py` drives
both emits but asserts neither severity, so nothing showed either guard could say
the OTHER thing. These rails pin what each guard decides and its control:

  * `_alert_incomplete` - a gap that SURVIVES the heal is a PAGE (`critical`), and
    the names are in the message.
  * `_alert_unmeasured` - both provider legs failing is a `warning`, NEVER a page:
    "unknown" is not "broken", and paging on it is how a monitor gets muted.

Driven through the real `run_check`, with only the inputs and the sink replaced.
"""
from __future__ import annotations

from api.services.wire import coverage_monitor as mon

MD = "2026-08-11"


def _cov(missing=(), pending=(), measured=True):
    return {"market_date": MD, "measured": measured, "reported": 10,
            "on_feed_with_numbers": 10 - len(missing),
            "missing_from_feed": list(missing), "missing_not_on_roster": [],
            "missing_on_roster": list(missing), "numbers_pending_on_feed": list(pending),
            "ok": not missing and not pending}


def _drive(monkeypatch, results):
    seq = iter(results)
    monkeypatch.setattr(mon, "market_session_date", lambda: MD)
    monkeypatch.setattr(mon.coverage, "build_coverage", lambda md: next(seq))
    monkeypatch.setattr(mon, "_heal", lambda: None)
    sent = []
    monkeypatch.setattr("api.services.chart_health_alerts.emit",
                        lambda key, sev, msg, meta=None: sent.append((key, sev, msg)) or True)
    monkeypatch.setattr("api.services.discord_notify._send_webhook", lambda e: None)
    out = mon.run_check()
    return out, sent


def test_a_gap_that_survives_the_heal_pages_critical(monkeypatch):
    out, sent = _drive(monkeypatch, [_cov(missing=["SLAB"]), _cov(missing=["SLAB"])])
    assert out["alerted"] is True
    assert [(k, s) for k, s, _ in sent] == [("wire_coverage_incomplete", "critical")]
    assert "SLAB" in sent[0][2]


def test_unmeasured_is_a_warning_and_never_a_page(monkeypatch):
    out, sent = _drive(monkeypatch, [_cov(measured=False)])
    assert out["measured"] is False and out["alerted"] is True
    assert [(k, s) for k, s, _ in sent] == [("wire_coverage_unmeasured", "warning")]


def test_CONTROL_a_complete_feed_emits_nothing(monkeypatch):
    out, sent = _drive(monkeypatch, [_cov()])
    assert out["ok"] is True and sent == []


def test_the_two_guards_never_share_a_severity(monkeypatch):
    """The discriminator: if either severity is moved onto the other's, this fails."""
    _, a = _drive(monkeypatch, [_cov(missing=["X"]), _cov(missing=["X"])])
    _, b = _drive(monkeypatch, [_cov(measured=False)])
    assert a[0][1] != b[0][1]
