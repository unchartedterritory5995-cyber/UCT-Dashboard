"""Detect-only Daily reconciliation — visibility without deletion.

The reconciler heals (deletes) drift for intraday TFs, but Daily (the DEFAULT
chart TF) is excluded from healing because a mis-heal there is the worst case.
Daily previously had ZERO drift visibility, though. The detect-only pass audits
Daily vs canonical and RECORDS + ALERTS fail-severity drift while NEVER calling
the delete path — closing the visibility gap with zero mis-heal risk.

The alert is severity `warning`, deliberately: it lands in
chart_health_alerts' queue for the admin Chart Health page, and it does NOT
page Discord — only `critical` does. A detect-only finding is never healed, so
it is re-detected every cycle (48/day, 24/7) under one constant alert_key;
paging it would be routine, not exceptional.

⛔ TWO SEVERITY SCALES MEET IN THIS FILE. `_Diff(t, "warn")` below is
audit.py's per-bar DIFF scale (`ok`/`warn`/`fail`) and is correct; the alert's
severity is `info`/`warning`/`critical`. They share no word, and
test_chart_health_severity_vocabulary derives both sets from their own modules
so neither site can be "fixed" into the other's vocabulary.
"""
from types import SimpleNamespace
from unittest.mock import patch

from api.services import bars_reconciliation as R
from tests.test_chart_health_severity_vocabulary import recognised_severities


class _Diff:
    def __init__(self, ts, sev):
        self.timestamp = ts
        self.severity = sev


def _result(fail_ts=(), warn_ts=(), error=None):
    diffs = [_Diff(t, "fail") for t in fail_ts] + [_Diff(t, "warn") for t in warn_ts]
    return SimpleNamespace(
        error=error,
        fail_count=len(fail_ts),
        warn_count=len(warn_ts),
        diffs=diffs,
    )


def _reset_state():
    R._state["detect_only_drift_count"] = 0
    R._state["last_detect_drift"] = []


def test_daily_is_detect_only_not_in_heal_tfs():
    assert "D" not in R._TFS            # never healed
    assert "D" in R._DETECT_TFS         # but monitored


def test_detect_drift_records_and_alerts_but_never_deletes():
    _reset_state()
    audit = SimpleNamespace(audit_ticker=lambda t, tf, bars: _result(fail_ts=[20260701, 20260702]))
    with patch.object(R, "_detect_only_pairs", return_value=[("AAPL", "D")]), \
         patch.object(R, "_current_session_date_key", return_value=20200101), \
         patch.object(R, "_heal_drift") as heal, \
         patch("api.services.chart_health_alerts.emit") as emit:
        R._run_detect_only(audit)

    # The delete path must NEVER be touched by the detect-only pass.
    heal.assert_not_called()
    # Drift is recorded for ops visibility.
    assert R._state["detect_only_drift_count"] == 1
    assert R._state["last_detect_drift"][-1]["ticker"] == "AAPL"
    assert R._state["last_detect_drift"][-1]["tf"] == "D"
    assert R._state["last_detect_drift"][-1]["fail_count"] == 2
    # And an alert is emitted (key + severity + message).
    assert emit.called
    args = emit.call_args.args
    assert args[0] == "daily_drift_detected"
    assert args[1] == "warning"
    # ...and it must be on the ALERT scale, which is DERIVED from alerts.py's
    # SEVERITY_* constants rather than typed here, so a fourth invented word
    # cannot pass. `warn` — what this call used to send — is audit.py's DIFF
    # scale: a real word on the wrong scale, which emit() accepts, stores, and
    # acts on in no way at all.
    assert args[1] in recognised_severities()


def test_clean_daily_records_nothing():
    _reset_state()
    audit = SimpleNamespace(audit_ticker=lambda t, tf, bars: _result())  # no fails
    with patch.object(R, "_detect_only_pairs", return_value=[("AAPL", "D"), ("MSFT", "D")]), \
         patch.object(R, "_heal_drift") as heal, \
         patch("api.services.chart_health_alerts.emit") as emit:
        R._run_detect_only(audit)
    heal.assert_not_called()
    assert R._state["detect_only_drift_count"] == 0
    assert not emit.called


def test_warn_only_drift_is_ignored():
    # Benign yfinance-tail cent differences classify as 'warn', not 'fail' — the
    # detect-only pass reports only fail-severity, so these stay silent.
    _reset_state()
    audit = SimpleNamespace(audit_ticker=lambda t, tf, bars: _result(warn_ts=[20260701]))
    with patch.object(R, "_detect_only_pairs", return_value=[("AAPL", "D")]), \
         patch.object(R, "_heal_drift") as heal, \
         patch("api.services.chart_health_alerts.emit") as emit:
        R._run_detect_only(audit)
    heal.assert_not_called()
    assert R._state["detect_only_drift_count"] == 0
    assert not emit.called


def test_audit_error_is_skipped_gracefully():
    _reset_state()
    audit = SimpleNamespace(audit_ticker=lambda t, tf, bars: _result(error="polygon 500"))
    with patch.object(R, "_detect_only_pairs", return_value=[("AAPL", "D")]), \
         patch.object(R, "_heal_drift") as heal:
        R._run_detect_only(audit)  # must not raise
    heal.assert_not_called()
    assert R._state["detect_only_drift_count"] == 0


def test_developing_daily_bar_is_excluded():
    # Today's still-forming daily bar is legitimately in flux during RTH; a fail on
    # ONLY today's bar must NOT record drift or alert. This is the false detect-only
    # drift that fired on NVDA/AAPL at the 2026-07-06 open (cold-restart warmup).
    _reset_state()
    audit = SimpleNamespace(audit_ticker=lambda t, tf, bars: _result(fail_ts=[20260706]))
    with patch.object(R, "_detect_only_pairs", return_value=[("NVDA", "D")]), \
         patch.object(R, "_current_session_date_key", return_value=20260706), \
         patch.object(R, "_heal_drift") as heal, \
         patch("api.services.chart_health_alerts.emit") as emit:
        R._run_detect_only(audit)
    heal.assert_not_called()
    assert R._state["detect_only_drift_count"] == 0
    assert not emit.called


def test_closed_bar_drift_still_fires_when_today_also_drifts():
    # A fail on a CLOSED bar is real; today's developing-bar fail is dropped, so
    # fail_count reflects only the closed bar(s) and the alert still fires.
    _reset_state()
    audit = SimpleNamespace(
        audit_ticker=lambda t, tf, bars: _result(fail_ts=[20260706, 20260702, 20260701]))
    with patch.object(R, "_detect_only_pairs", return_value=[("AAPL", "D")]), \
         patch.object(R, "_current_session_date_key", return_value=20260706), \
         patch.object(R, "_heal_drift") as heal, \
         patch("api.services.chart_health_alerts.emit") as emit:
        R._run_detect_only(audit)
    heal.assert_not_called()
    assert R._state["detect_only_drift_count"] == 1
    last = R._state["last_detect_drift"][-1]
    assert last["fail_count"] == 2                 # today excluded, two closed bars remain
    assert 20260706 not in last["sample_ts"]
    assert emit.called


def test_the_warn_count_is_on_the_audit_scale_not_the_alert_scale():
    # `_result(warn_ts=...)` builds diffs carrying audit.py's `warn` severity,
    # which is a DIFFERENT scale from the alert's `warning`. Renaming the module's
    # `d.severity == "warn"` filter to match the alert severity would make it
    # select zero rows — no exception, no red anywhere else in this file, just a
    # count that is always 0. This is the test that would go red.
    _reset_state()
    audit = SimpleNamespace(audit_ticker=lambda t, tf, bars: _result(
        fail_ts=[20260701], warn_ts=[20260702, 20260703]))
    with patch.object(R, "_detect_only_pairs", return_value=[("AAPL", "D")]), \
         patch.object(R, "_current_session_date_key", return_value=20200101), \
         patch.object(R, "_heal_drift"), \
         patch("api.services.chart_health_alerts.emit"):
        R._run_detect_only(audit)
    last = R._state["last_detect_drift"][-1]
    assert last["fail_count"] == 1
    assert last["warn_count"] == 2, "the audit-scale warn filter stopped matching"
