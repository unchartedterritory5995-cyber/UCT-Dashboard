"""The options Sizzle ranking is warmed after boot.

Measured 2026-10-09: /api/options-screener/sizzle took 42.6 s on its first read after a web
deploy (an in-memory ranking, research/options_screener.cached) and 1.3 s warm. The terminal
panel's read deadline is 30 s, so the first member after every deploy got an error.

A source check, like tests/test_breadth_series_boot_warm.py: the chain runs on a daemon thread
against live stores, and what matters here is that the step is wired and gated.

Scoped run only:
    python -m pytest tests/test_options_sizzle_boot_warm.py -q
"""
import inspect


def _chain_src():
    from api import main as api_main
    return inspect.getsource(api_main._start_dashboard_warm_background)


def test_the_sizzle_ranking_is_a_step_in_the_dashboard_warm_chain():
    src = _chain_src()
    assert '_warm("options-sizzle", _options_sizzle)' in src
    assert "sizzle.get()" in src


def test_the_sizzle_warm_is_gated_on_the_routes_own_switch():
    src = _chain_src()
    step = src[src.index("def _options_sizzle"):src.index('_warm("flow-tape"')]
    assert 'is_on("OPTIONS_SIZZLE_ENABLED")' in step
    # the switch is checked BEFORE the ranking is computed
    assert step.index('is_on("OPTIONS_SIZZLE_ENABLED")') < step.index("sizzle.get()")


def test_the_switch_name_is_a_real_options_analytics_switch():
    from api.services.options_analytics import flags
    assert "OPTIONS_SIZZLE_ENABLED" in flags.OPTIONS_ANALYTICS_FLAGS
