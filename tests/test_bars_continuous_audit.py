import time
import threading
from unittest.mock import patch, MagicMock
from api.services import bars_continuous_audit as bca


def teardown_function(fn):
    """Stop the worker if a test left it running."""
    bca.stop()
    time.sleep(0.05)


def test_start_is_idempotent():
    """Calling start twice doesn't spawn two threads."""
    bca.stop()
    time.sleep(0.05)
    initial_count = threading.active_count()
    bca.start()
    bca.start()  # second call should no-op
    after = threading.active_count()
    # At most 1 new thread
    assert after - initial_count <= 1


def test_stop_halts_loop():
    bca.start()
    time.sleep(0.05)
    bca.stop()
    time.sleep(0.05)
    assert not bca._running.is_set()


def test_run_5min_check_invokes_audit():
    """The 5-min helper logs and runs (placeholder behavior)."""
    # Just verify it doesn't crash
    bca._run_5min_check()


def test_run_priority_sweep_invokes_audit_universe():
    """Priority sweep resolves tickers and calls audit_universe."""
    with patch("api.services.bars_continuous_audit.bars_audit.audit_universe") as mock_audit, \
         patch("api.main._resolve_priority_tickers", return_value=["QQQ", "SPY"]):
        bca._run_priority_sweep()
    mock_audit.assert_called_once()
    args, kwargs = mock_audit.call_args
    assert args[0] == ["QQQ", "SPY"]


def test_run_priority_sweep_skips_when_no_tickers():
    with patch("api.services.bars_continuous_audit.bars_audit.audit_universe") as mock_audit, \
         patch("api.main._resolve_priority_tickers", return_value=[]):
        bca._run_priority_sweep()
    mock_audit.assert_not_called()


def test_run_universe_sweep_handles_missing_file():
    """If cap_universe.json is unreadable, sweep logs and returns cleanly."""
    with patch("builtins.open", side_effect=FileNotFoundError("test")):
        bca._run_universe_sweep()  # should not raise
