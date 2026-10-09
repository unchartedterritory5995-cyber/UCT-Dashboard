"""Cold-start lane w9-1 (2026-10-09): the terminal reads that measured slowest on the first
request after a web deploy are warmed first, and the chain stops spending its head on a
cache production never reads.

Measured live right after a deploy: /api/screener/meta >60 s, /api/scatter/universes 43 s,
against a terminal panel read deadline of 30 s. The dashboard warm chain is sequential and
used to reach screener-meta only after flow-tape, movers, themes, news, breadth and
breadth-live; in production the first of those warmed web's local flow cache, which every
member read bypasses (FLOW_READS_PROXY_ENABLED routes /api/live/massive to flow-worker).

Scoped run only:
    python -m pytest tests/test_terminal_cold_start_warm.py -q
"""
import inspect
import logging
import time


def _chain_src():
    from api import main as api_main
    return inspect.getsource(api_main._start_dashboard_warm_background)


# ── wiring and order ─────────────────────────────────────────────────────────────

def test_the_terminal_steps_are_in_the_chain():
    src = _chain_src()
    assert '_warm("screener-meta-payload", _screener_meta_payload)' in src
    assert '_warm("scatter-universes", _scatter_universes)' in src
    assert "filters.meta(user_id=None)" in src
    assert "scatter.list_universes(None)" in src


def test_the_terminal_steps_run_right_after_the_tape_and_ahead_of_everything_else():
    src = _chain_src()
    block = src[src.index('with readiness.gate("dashboard")'):]
    order = [line.strip().split('"')[1] for line in block.splitlines()
             if line.strip().startswith('_warm("')]
    assert order[:4] == ["flow-tape", "screener-meta", "screener-meta-payload",
                         "scatter-universes"], order
    # screener-meta runs once, not twice
    assert order.count("screener-meta") == 1
    assert order.index("scatter-universes") < order.index("movers") < order.index("enrichment")


def test_the_flow_steps_use_the_same_rule_as_the_proxy():
    src = _chain_src()
    rule = src[src.index("def _flow_reads_proxied"):src.index("def _flow_tape_critical")]
    assert "flow_proxy.PROXY_ENABLED and flow_proxy.WORKER_INTERNAL_URL" in rule
    for step in ("def _flow_tape_critical", "def _flow_tape_curated"):
        body = src[src.index(step):]
        body = body[:body.index("from api.live_massive_router import")]
        assert "if _flow_reads_proxied():" in body, step


# ── the chain, run with every target stubbed ─────────────────────────────────────

def _run_chain(monkeypatch, *, proxied):
    from api import flow_proxy
    calls = {"recent": 0, "day_stats": 0, "meta": [], "universes": [], "enrichment": 0}
    monkeypatch.setattr(flow_proxy, "PROXY_ENABLED", proxied)
    monkeypatch.setattr(flow_proxy, "WORKER_INTERNAL_URL", "http://flow-worker" if proxied else "")

    def _recent(**kw):
        calls["recent"] += 1

    def _day(**kw):
        calls["day_stats"] += 1

    def _enrich(dates=None):
        calls["enrichment"] += 1
        return {}

    monkeypatch.setattr("api.live_massive_router.warm_recent", _recent)
    monkeypatch.setattr("api.live_massive_router.day_stats", _day)
    monkeypatch.setattr("api.services.screener.distribution.distributions", lambda: {})
    monkeypatch.setattr("api.services.screener.filters.meta",
                        lambda user_id=None: calls["meta"].append(user_id) or {})
    monkeypatch.setattr("api.services.scatter.list_universes",
                        lambda user_id: calls["universes"].append(user_id) or [])
    for target in ("api.services.massive.get_movers", "api.services.engine.get_news",
                   "api.routers.theme_performance.get_theme_performance",
                   "api.services.earnings_preview_warm.warm_week_previews",
                   "api.services.earnings_preview_warm.warm_reported_analyses"):
        monkeypatch.setattr(target, lambda *a, **k: None)
    monkeypatch.setattr("api.routers.breadth_monitor.get_breadth_history", lambda days=90: None)
    monkeypatch.setattr("api.services.breadth_live.warm", lambda: None)
    monkeypatch.setattr("api.routers.calendar.get_calendar", lambda week=None: None)
    monkeypatch.setattr("api.routers.calendar.get_enrichment_batch", _enrich)

    from api.main import _start_dashboard_warm_background
    _start_dashboard_warm_background(delay_seconds=0)
    for _ in range(200):
        if calls["enrichment"]:
            break
        time.sleep(0.05)
    time.sleep(0.2)   # the curated step runs after enrichment
    assert calls["enrichment"], "the chain never reached enrichment"
    return calls


def test_proxied_flow_reads_skip_the_local_flow_warm(monkeypatch):
    calls = _run_chain(monkeypatch, proxied=True)
    assert calls["recent"] == 0 and calls["day_stats"] == 0
    assert calls["meta"] == [None] and calls["universes"] == [None]


def test_local_flow_reads_still_warm_the_local_flow_cache(monkeypatch):
    calls = _run_chain(monkeypatch, proxied=False)
    assert calls["recent"] == 2 and calls["day_stats"] == 1   # tape + curated
    assert calls["meta"] == [None] and calls["universes"] == [None]


# ── a slow build names its parts ─────────────────────────────────────────────────

def test_a_slow_meta_build_names_its_parts_and_a_fast_one_is_silent(caplog):
    from api.services.screener import filters
    with caplog.at_level(logging.WARNING, logger=filters.__name__):
        filters._log_if_slow("screener-meta", filters.SLOW_META_LOG_S - 0.1, {"distribution": 1.0})
        assert not caplog.records
        filters._log_if_slow("screener-meta", 61.0, {"distribution": 0.1, "my_scans": 60.2})
    msg = caplog.records[-1].getMessage()
    assert "slow build 61.0s" in msg and "my_scans=60.2s" in msg


def test_a_slow_universes_build_names_its_parts(monkeypatch, caplog):
    from api.services import scatter
    monkeypatch.setattr(scatter, "SLOW_UNIVERSES_LOG_S", 0.0)
    with caplog.at_level(logging.WARNING, logger=scatter.__name__):
        groups = scatter.list_universes(None)
    assert groups and groups[0]["group"] == "Universe"
    msg = [r.getMessage() for r in caplog.records if "scatter-universes" in r.getMessage()][-1]
    for part in ("themes=", "industries="):
        assert part in msg
