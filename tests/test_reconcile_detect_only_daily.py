"""Detect-only Daily reconciliation — visibility without deletion.

The reconciler heals (deletes) drift for intraday TFs, but Daily (the DEFAULT
chart TF) is excluded from healing because a mis-heal there is the worst case.
Daily previously had ZERO drift visibility, though. The detect-only pass audits
Daily vs canonical and RECORDS + ALERTS fail-severity drift while NEVER calling
the delete path — closing the visibility gap with zero mis-heal risk.
"""
from types import SimpleNamespace
from unittest.mock import patch

from api.services import bars_reconciliation as R


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
    assert args[1] == "warn"


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
