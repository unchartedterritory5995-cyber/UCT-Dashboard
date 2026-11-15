"""The chart monitor sees a tier outage the edge's hedge hides from every other check (2026-11-15).

Since edge/bars-edge-router/worker.js hedges to web after 1.2 s, a down or stalled bars-api still
answers members with 200s and correct bars, ~1.3 s each. The data checks pass and a 3 s p90 budget
never trips. Only the share of answers stamped `X-Bars-Edge: web-hedge | web-fallback` says the
tier is gone, and the p90 budget had to come down to 1 s to see a 1.3 s hedge at all.
"""
from __future__ import annotations

from api.services.chart_monitor import checks as C
from api.services.chart_monitor import runner

from tests.test_chart_monitor_runtime import WED, FakeEdge, _run, at


def test_too_few_stamped_answers_is_a_skip_not_a_pass():
    assert C.check_edge_fallback(["tier"] * 19, 0.2).status == C.SKIP


def test_every_answer_from_the_tier_passes():
    assert C.check_edge_fallback(["tier"] * 40, 0.2).status == C.PASS


def test_a_dead_tier_fails():
    v = C.check_edge_fallback(["web-hedge"] * 30 + ["web-fallback"] * 10, 0.2)
    assert v.status == C.FAIL
    assert "web-hedge=30" in v.detail and "web-fallback=10" in v.detail


def test_the_budget_is_a_share_and_its_edge_passes():
    assert C.check_edge_fallback(["tier"] * 80 + ["web-hedge"] * 20, 0.2).status == C.PASS
    assert C.check_edge_fallback(["tier"] * 79 + ["web-hedge"] * 21, 0.2).status == C.FAIL


def test_unstamped_answers_count_neither_way():
    """Breadth and market-indicator series go straight to web with no stamp."""
    edges = ["tier"] * 20 + [None] * 200
    assert C.check_edge_fallback(edges, 0.2).status == C.PASS
    assert C.check_edge_fallback([None] * 200, 0.2).status == C.SKIP


class StampedEdge(FakeEdge):
    def __init__(self, now, edge, **kw):
        super().__init__(now, **kw)
        self.edge = edge

    def get_json(self, path, max_retries=2, deadline=None):
        r = super().get_json(path, max_retries=max_retries, deadline=deadline)
        r["headers"] = {**r["headers"], "x-bars-edge": self.edge}
        return r


def test_a_cycle_served_by_the_tier_has_no_edge_failure():
    now = at(WED, 11, 3)
    cyc = _run(StampedEdge(now, "tier"), now)
    failing, detail = cyc.observations["edge_fallback|all"]
    assert not failing, detail


def test_a_cycle_served_by_the_hedge_opens_an_edge_failure():
    now = at(WED, 11, 3)
    cyc = _run(StampedEdge(now, "web-hedge"), now)
    failing, detail = cyc.observations["edge_fallback|all"]
    assert failing and "web-hedge" in detail
    others = {k for k, (f, _d) in cyc.observations.items() if f and k != "edge_fallback|all"}
    assert not others, others          # the data itself is fine: only this check can see it


def test_a_hedged_tier_trips_the_default_latency_budget():
    """~1.3 s per answer (1.2 s hedge + web) must fail p90 at the default budget."""
    now = at(WED, 11, 3)
    edge = StampedEdge(now, "web-hedge")
    edge.ms = 1300
    # 6 tickers: check_latency needs >= 5 samples per series or it SKIPs
    cyc = runner.run_cycle(edge, runner.Config(liquid=("A", "B", "C", "D", "E", "F"), thin=(),
                                              stream=False, heartbeat_url="http://test/heartbeat"),
                           C.LabelWindow(), now_fn=lambda: now, sleep=lambda s: None)
    assert any(f for k, (f, _d) in cyc.observations.items() if k.startswith("latency_p90|"))


def test_defaults_and_env_overrides(monkeypatch):
    c = runner.Config()
    assert c.latency_p90_ms == 1000 and c.edge_fallback_budget == 0.2
    monkeypatch.setenv("CHART_MONITOR_EDGE_FALLBACK_BUDGET", "0.5")
    monkeypatch.setenv("CHART_MONITOR_LATENCY_P90_MS", "2500")
    e = runner.Config.from_env()
    assert e.edge_fallback_budget == 0.5 and e.latency_p90_ms == 2500
    monkeypatch.delenv("CHART_MONITOR_EDGE_FALLBACK_BUDGET")
    monkeypatch.delenv("CHART_MONITOR_LATENCY_P90_MS")
    d = runner.Config.from_env()
    assert d.edge_fallback_budget == 0.2 and d.latency_p90_ms == 1000
