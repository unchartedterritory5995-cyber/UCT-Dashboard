from unittest.mock import patch, MagicMock

from api import main as api_main


def test_priority_audit_runs_audit_universe():
    """The helper resolves priority tickers and calls audit_universe."""
    with patch.object(api_main, "_resolve_priority_tickers", return_value=["QQQ", "AAPL"]), \
         patch("api.services.bars_audit.audit_universe") as mock_audit:
        api_main._run_priority_audit_now()  # synchronous version for tests
        mock_audit.assert_called_once()
        args, kwargs = mock_audit.call_args
        assert args[0] == ["QQQ", "AAPL"]
        # scope should be priority
        assert (kwargs.get("scope") == "priority") or ("priority" in args)


def test_priority_audit_skips_when_no_tickers():
    """If priority resolver returns empty list, don't run audit."""
    with patch.object(api_main, "_resolve_priority_tickers", return_value=[]), \
         patch("api.services.bars_audit.audit_universe") as mock_audit:
        api_main._run_priority_audit_now()
        mock_audit.assert_not_called()


def test_priority_audit_handles_resolver_exception():
    """If priority resolver raises, function logs and exits cleanly."""
    with patch.object(api_main, "_resolve_priority_tickers", side_effect=RuntimeError("oops")), \
         patch("api.services.bars_audit.audit_universe") as mock_audit:
        # Should not raise
        api_main._run_priority_audit_now()
        mock_audit.assert_not_called()


def test_resolve_priority_tickers_returns_list():
    """The resolver returns a list of strings, even if subsystems are unavailable."""
    tickers = api_main._resolve_priority_tickers()
    assert isinstance(tickers, list)
    # On a real local run, we may have nothing — that's ok
    for t in tickers:
        assert isinstance(t, str)
        assert t == t.upper()


def test_deploy_smoke_runs_audit():
    with patch("api.services.bars_audit.audit_universe") as mock_audit:
        api_main._run_deploy_smoke_now()
    mock_audit.assert_called_once()
    args, kwargs = mock_audit.call_args
    assert kwargs.get("scope") == "deploy-smoke"


def test_deploy_smoke_handles_audit_exception():
    with patch("api.services.bars_audit.audit_universe", side_effect=RuntimeError("boom")):
        # Should not raise
        api_main._run_deploy_smoke_now()
