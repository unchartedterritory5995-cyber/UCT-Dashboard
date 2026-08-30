"""The flow aggregate must be an accelerator, never a dependency.

WHY IT EXISTS, measured on prod 2026-08-29 from the page's own `[perf]` logs:

    Downloaded: 88ms (14324KB)
    CSV parsed: 854ms  (107,346 rows, worker)
    processFlowData:   1,617-3,433 ms for identical input

Every member pays that on every first load, to reduce 107,346 raw prints to
~26,800 trades. This computes it once per data version instead — and measured on
the sample fixture it is also SMALLER on the wire (83,643 gzipped vs 122,093 for
the CSV, 0.69x), because the processed set drops the prints filtering discards.

The dangerous failure here is not slowness, it is a wrong or empty answer served
confidently. So these tests are mostly about what happens when things go wrong.
"""
from __future__ import annotations

import gzip
import json
import os
import pathlib
import threading

import pytest

from api.services import flow_aggregate as fa

REPO = pathlib.Path(__file__).resolve().parents[1]
FIXTURE = REPO / "app" / "src" / "pages" / "optionsFlow" / "__fixtures__" / "flow-sample.csv"


@pytest.fixture(autouse=True)
def _clean_cache():
    fa._CACHE.clear()
    yield
    fa._CACHE.clear()


def _csv() -> str:
    return FIXTURE.read_text(encoding="utf-8")


# ── soft failure: every path degrades to "no aggregate", never to an error ──


def test_a_missing_bundle_is_unavailable_not_an_exception(monkeypatch):
    monkeypatch.setenv("FLOW_FACTS_BUNDLE", str(REPO / "does" / "not" / "exist.cjs"))
    assert fa.available() is False
    assert fa.build(_csv()) is None          # must not raise


def test_a_missing_node_is_unavailable(monkeypatch):
    monkeypatch.setenv("FLOW_NODE_BIN", "definitely-not-a-real-binary-xyz")
    assert fa.available() is False
    assert fa.build(_csv()) is None


def test_the_feature_flag_turns_it_off_without_a_deploy(monkeypatch):
    monkeypatch.setenv("FLOW_AGGREGATE_ENABLED", "0")
    assert fa.available() is False


def test_a_build_failure_returns_none_rather_than_a_partial_answer(monkeypatch):
    # An empty CSV makes the CLI exit 2 with nothing on stdout.
    if not fa.available():
        pytest.skip("node/bundle not present in this environment")
    assert fa.build("") is None


def test_non_json_on_stdout_is_refused(monkeypatch):
    """⛔ THE FAILURE THIS GUARDS, and it already happened once.

    `processFlowData` logs progress notes via console.log — STDOUT in Node — so
    the first CLI run put "[ML/ rescue] …" in front of the JSON. The entry now
    routes console to stderr, but if that ever regresses the service must refuse
    the body rather than hand a caller something unparseable.
    """
    class _Proc:
        returncode = 0
        stdout = b"[ML/ rescue] rescued 2 trades\n{\"ok\":true}"
        stderr = b""

    monkeypatch.setattr(fa.subprocess, "run", lambda *a, **k: _Proc())
    monkeypatch.setattr(fa, "available", lambda: True)
    assert fa.build("x") is None


def test_a_non_zero_exit_is_refused(monkeypatch):
    class _Proc:
        returncode = 2
        stdout = b'{"ok":true,"stats":{},"D":{}}'   # even with a valid-looking body
        stderr = b"boom"

    monkeypatch.setattr(fa.subprocess, "run", lambda *a, **k: _Proc())
    monkeypatch.setattr(fa, "available", lambda: True)
    assert fa.build("x") is None


def test_ok_false_is_refused(monkeypatch):
    class _Proc:
        returncode = 0
        stdout = b'{"ok":false,"error":"nope"}'
        stderr = b""

    monkeypatch.setattr(fa.subprocess, "run", lambda *a, **k: _Proc())
    monkeypatch.setattr(fa, "available", lambda: True)
    assert fa.build("x") is None


# ── the real pipeline ───────────────────────────────────────────────────────


@pytest.mark.skipif(not FIXTURE.exists(), reason="fixture missing")
def test_it_actually_aggregates_and_reports_its_own_cost():
    if not fa.available():
        pytest.skip("node/bundle not present in this environment")
    out = fa.build(_csv())
    assert out is not None, "the real bundle failed to build from the fixture"
    payload = json.loads(out["json_bytes"])
    assert payload["ok"] is True
    assert payload["D"], "no dataset in the payload"
    s = out["stats"]
    assert s["rawRows"] > 0 and s["totalTrades"] > 0
    # Filtering must actually reduce the set — that reduction is why the
    # aggregate is smaller on the wire than the CSV it replaces.
    assert s["totalTrades"] < s["rawRows"]
    assert s["buildMs"] >= 0 and s["jsonBytes"] > 0


# ── caching: once per version, and honest about which version ───────────────


def test_it_builds_once_per_version(monkeypatch):
    calls = {"n": 0}

    def fake_build(csv, date_filter=None):
        calls["n"] += 1
        return {"json_bytes": b'{"ok":true}', "stats": {}}

    monkeypatch.setattr(fa, "build", fake_build)
    key, provider = ("stocks", 1), lambda: "csv"
    fa.get_cached_or_build(key, 7, provider)
    fa.get_cached_or_build(key, 7, provider)
    fa.get_cached_or_build(key, 7, provider)
    assert calls["n"] == 1, "rebuilt within the same version"

    fa.get_cached_or_build(key, 8, provider)      # version rolled
    assert calls["n"] == 2


def test_the_version_returned_is_the_one_the_body_was_built_from(monkeypatch):
    """⛔ A stale-served body must never claim to be current.

    Same contract as _serve_csv's X-Flow-Version: the client compares it against
    /api/flow/version to know whether what it holds is behind. Stamping the
    CURRENT version onto an older body is exactly the defect that header exists
    to kill.
    """
    monkeypatch.setattr(fa, "build", lambda csv, date_filter=None: {"json_bytes": b'{"ok":true}', "stats": {}})
    key = ("stocks", 1)
    v, _ = fa.get_cached_or_build(key, 5, lambda: "csv")
    assert v == 5

    # A concurrent build is in progress: the caller gets the OLD entry, and it
    # must report version 5, not 6.
    fa._BUILD_LOCK.acquire()
    try:
        got = fa.get_cached_or_build(key, 6, lambda: "csv")
    finally:
        fa._BUILD_LOCK.release()
    assert got is not None and got[0] == 5


def test_a_concurrent_build_with_nothing_cached_declines_rather_than_queues(monkeypatch):
    """Queueing behind a multi-second subprocess is the 524 outage class."""
    monkeypatch.setattr(fa, "build", lambda csv, date_filter=None: {"json_bytes": b'{"ok":true}', "stats": {}})
    fa._BUILD_LOCK.acquire()
    try:
        assert fa.get_cached_or_build(("stocks", 1), 1, lambda: "csv") is None
    finally:
        fa._BUILD_LOCK.release()


def test_an_empty_csv_from_the_provider_is_not_cached(monkeypatch):
    monkeypatch.setattr(fa, "build", lambda csv, date_filter=None: {"json_bytes": b'{"ok":true}', "stats": {}})
    assert fa.get_cached_or_build(("stocks", 1), 1, lambda: "") is None
    assert not fa._CACHE, "an empty source was cached as though it were an answer"


def test_the_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(fa, "build", lambda csv, date_filter=None: {"json_bytes": b'{"ok":true}', "stats": {}})
    for i in range(fa._CACHE_MAX + 4):
        fa.get_cached_or_build(("stocks", i), 1, lambda: "csv")
    assert len(fa._CACHE) <= fa._CACHE_MAX


def test_the_cached_body_is_gzipped(monkeypatch):
    monkeypatch.setattr(fa, "build", lambda csv, date_filter=None: {"json_bytes": b'{"ok":true,"D":{}}', "stats": {}})
    _, gz = fa.get_cached_or_build(("stocks", 1), 1, lambda: "csv")
    assert gzip.decompress(gz) == b'{"ok":true,"D":{}}'


# ── the date selection ──────────────────────────────────────────────────────

_HEADER = ("CreatedDate,CreatedTime,Symbol,Type,Volume,Price,Side,CallPut,Strike,"
           "Spot,Premium,ExpirationDate,Color,ImpliedVolatility,Dte,ER,StockEtf,"
           "Sector,Uoa,Weekly,MktCap,OI")


def _row(date, sym):
    return (f"{date},10:00:00 AM,{sym},SWEEP,500,10.5,,CALL,100,95.0,525000,"
            "7/31/2026,WHITE,0,7,F,STOCK,Information Technology,F,T,5e10,900")


def _two_day_csv():
    nl = chr(10)   # written as chr(10) so no escape can be mangled in transit
    return nl.join([_HEADER, _row("7/23/2026", "OLDD"),
                    _row("7/24/2026", "NEWW")]) + nl


@pytest.mark.parametrize("raw,expected", [
    ("Last1", "Last1"), ("Last20", "Last20"), ("All", "All"),
    ("last1", None),          # case matters — the page sends the exact token
    ("Last999", None),        # 3 digits is not a selection the page can make
    ("", None), (None, None),
    ("; rm -rf /", None), ("--date-filter=x", None), ("Last1 --inject", None),
])
def test_only_the_pages_own_selections_reach_argv(raw, expected):
    """This is the ONE caller-supplied string that reaches a subprocess argv."""
    assert fa.valid_date_filter(raw) == expected


def test_the_date_filter_actually_changes_the_dataset():
    """⛔ A filter that silently does nothing is the defect worth catching.

    Threading a parameter through four layers and having it land on a no-op
    looks identical to it working — the response is still a valid aggregate.
    So assert the two answers DIFFER, and name which row each kept.
    """
    if not fa.available():
        pytest.skip("node/bundle not present in this environment")
    csv = _two_day_csv()

    everything = fa.build(csv)
    newest_only = fa.build(csv, "Last1")
    assert everything and newest_only

    assert everything["stats"]["selectedRows"] == 2
    assert newest_only["stats"]["selectedRows"] == 1
    assert newest_only["stats"]["rawRows"] == 2, "the filter must select, not re-parse"
    syms = {t["S"] for t in json.loads(newest_only["json_bytes"])["D"]["all_trades"]}
    assert syms == {"NEWW"}, f"Last1 kept the wrong session: {syms}"


def test_a_rejected_filter_falls_back_to_the_whole_csv_not_an_error():
    if not fa.available():
        pytest.skip("node/bundle not present in this environment")
    out = fa.build(_two_day_csv(), "; rm -rf /")
    assert out is not None and out["stats"]["selectedRows"] == 2


def test_two_date_selections_do_not_collide_in_the_cache(monkeypatch):
    """The key carries the filter, so 'Last1' can never be served for 'All'."""
    seen = []

    def fake_build(csv, date_filter=None):
        seen.append(date_filter)
        return {"json_bytes": b'{"ok":true}', "stats": {}}

    monkeypatch.setattr(fa, "build", fake_build)
    fa.get_cached_or_build(("stocks", 1, "Last1"), 9, lambda: "csv", "Last1")
    fa.get_cached_or_build(("stocks", 1, "All"), 9, lambda: "csv", "All")
    assert seen == ["Last1", "All"], "a second selection reused the first answer"


# ── the endpoint ────────────────────────────────────────────────────────────


def test_the_route_is_registered_and_gated():
    from api import flow_router as fr
    from api import auth_surface_check as asc

    route = next((r for r in fr.flow_router.routes
                  if getattr(r, "path", "") == "/api/flow/aggregate"), None)
    assert route is not None, "/api/flow/aggregate is not registered"

    guards = asc._guard_names_for(route)
    # ⛔ ASSERT THE GUARD BY NAME, never merely that the set is non-empty.
    # `_guard_names_for` includes the HANDLER'S OWN NAME — here
    # {'require_flow_user', 'get_aggregate'} — so a truthiness check passes with
    # no gate at all. Mutation-tested: removing `Depends(require_flow_user)`
    # SURVIVED the truthy version of this assertion. A gate that cannot fail is
    # not a gate, and this endpoint serves the firm's processed options tape —
    # the same data `/data` was closed for on 2026-08-09.
    assert "require_flow_user" in guards, (
        f"the aggregate endpoint is UNGATED — guards resolved to {guards}. It "
        "serves the processed options tape; it must carry the same gate as /data."
    )

    # Non-vacuity control: the probe must resolve the SAME guard on a route we
    # know is gated, so a broken probe cannot quietly pass the assertion above.
    data_route = next(r for r in fr.flow_router.routes
                      if getattr(r, "path", "") == "/api/flow/data")
    assert "require_flow_user" in asc._guard_names_for(data_route)


# ── the boot warmer and the endpoint must agree on the key ──────────────────


def test_the_warmer_fills_the_entry_the_endpoint_reads(monkeypatch):
    """⛔ A WARMER THAT FILLS A DIFFERENT KEY WARMS NOTHING — silently.

    It logs success, costs the full build, and the first real visitor still
    eats a cold one. Nothing in logs or review distinguishes it from a warmer
    that works, which is why both paths go through `flow_router.build_aggregate`
    rather than forming the key twice.
    """
    from api import flow_router as fr

    monkeypatch.setattr(fa, "build", lambda csv, date_filter=None: {
        "json_bytes": b'{"ok":true}', "stats": {}})
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (1, gzip.compress(b"csv")))
    monkeypatch.setattr(fr, "_current_version", lambda: 7)

    # What the WARMER does, for the default view.
    fr.build_aggregate("stocks", 1, "Last1")
    warmed = set(fa._CACHE.keys())
    assert warmed, "the warmer cached nothing at all"

    # What the ENDPOINT would look up for that same view, derived the same way.
    fa._CACHE.clear()
    fr.build_aggregate("stocks", 1, "Last1", 7)
    assert set(fa._CACHE.keys()) == warmed, (
        "the warmer and the endpoint disagree on the cache key — the warm is a "
        f"silent no-op ({warmed} vs {set(fa._CACHE.keys())})")


def test_the_warmer_uses_the_routers_builder_not_its_own_key(monkeypatch):
    """The source-level half: flow-worker must not re-form the key itself."""
    import ast, pathlib as _pl
    src = _pl.Path("api/flow_worker_main.py").read_text(encoding="utf-8")
    tree = ast.parse(src)
    calls = [n for n in ast.walk(tree) if isinstance(n, ast.Call)]
    names = set()
    for c in calls:
        f = c.func
        if isinstance(f, ast.Attribute):
            names.add(f.attr)
    assert "build_aggregate" in names, (
        "flow_worker_main no longer calls build_aggregate — the aggregate warm "
        "is gone, so the first visitor after a restart pays the cold build")
    # ⛔ THE INVARIANT IS ABOUT THE CACHE KEY, NOT THE IMPORT. flow-worker may
    # import the service for read-only diagnostics (health, alerting); what it
    # must never do is call the KEY-FORMING entry point itself, because then
    # the warm and the read can drift apart silently.
    #
    # ⚰️ This previously asserted `"flow_aggregate" not in src`, which went red
    # the moment a health check imported the module — a correct change caught
    # by an assertion that was broader than the rule it stood for.
    assert "get_cached_or_build" not in names, (
        "flow_worker_main calls get_cached_or_build directly — form the key in "
        "ONE place (flow_router.build_aggregate) or the warm will drift from "
        "the read and silently warm nothing")


def test_the_warm_range_filters_mirror_the_pages_range_chips():
    """`Last{days}` is not a guess — OptionsFlow.jsx builds exactly that."""
    import pathlib as _pl
    page = _pl.Path("app/src/pages/OptionsFlow.jsx").read_text(encoding="utf-8")
    assert 'days === 0 ? "All" : "Last" + days' in page, (
        "the page no longer derives its date filter as Last{days} — the "
        "worker's warm keys now describe a view nobody asks for")
    worker = _pl.Path("api/flow_worker_main.py").read_text(encoding="utf-8")
    assert 'f"Last{_d}"' in worker


# ── observability: is the fast path working, and would we KNOW if it stopped ──


@pytest.fixture(autouse=True)
def _clean_stats():
    fa._STATS.pop("_last_alert_bad", None)
    yield
    fa._STATS.pop("_last_alert_bad", None)


def test_warm_means_this_exact_version_not_merely_something_cached(monkeypatch):
    """⛔ THE CASE A STALLED WARMER WOULD HIDE BEHIND.

    An entry for a SUPERSEDED version is not warm — the next caller rebuilds.
    Counting it as warm is how a warmer that stopped running would keep
    reporting healthy: the cache is non-empty forever after one success.
    """
    monkeypatch.setattr(fa, "build", lambda csv, date_filter=None: {
        "json_bytes": b'{"ok":true}', "stats": {}})
    fa.get_cached_or_build(("stocks", 1, "Last1"), 5, lambda: "csv", "Last1")

    assert fa.health(current_version=5)["warm"] is True
    stale = fa.health(current_version=6)
    assert stale["warm"] is False
    assert "stale" in stale["reason"] and "v5" in stale["reason"]


def test_cold_is_reported_but_is_not_a_failure():
    """A pod that just booted has an empty cache BY CONSTRUCTION."""
    h = fa.health(current_version=1)
    assert h["warm"] is False and h["reason"] == "cold"
    # ...and `available` still reflects the machinery, not the cache.
    assert h["available"] is fa.available()


@pytest.mark.parametrize("env,expected", [
    ({"FLOW_AGGREGATE_ENABLED": "0"}, "disabled"),
    ({"FLOW_FACTS_BUNDLE": "/nope/missing.cjs"}, "bundle_missing"),
    ({"FLOW_NODE_BIN": "definitely-not-a-real-binary-xyz"}, "node_missing"),
])
def test_each_way_it_can_break_names_itself(monkeypatch, env, expected):
    """The reason string is the whole point — 'unhealthy' with no cause sends
    someone reading code at 7am."""
    for k, v in env.items():
        monkeypatch.setenv(k, v)
    h = fa.health(current_version=1)
    assert h["available"] is False
    assert h["reason"] == expected


def test_it_alerts_on_TRANSITION_only(monkeypatch):
    """⛔ A check that posts every cycle while broken gets muted inside a week,
    and a muted alert is worse than none because it reads as coverage."""
    posts = []
    monkeypatch.setattr(fa, "available", lambda: True)
    fa.alert_if_unavailable(post=posts.append)          # first observation: arm only
    assert posts == []

    monkeypatch.setattr(fa, "available", lambda: False)
    monkeypatch.setenv("FLOW_AGGREGATE_ENABLED", "0")
    fa.alert_if_unavailable(post=posts.append)          # healthy -> broken
    assert len(posts) == 1 and "UNAVAILABLE" in posts[0]

    fa.alert_if_unavailable(post=posts.append)          # still broken
    fa.alert_if_unavailable(post=posts.append)
    assert len(posts) == 1, "it re-alerted while the state was unchanged"


def test_recovery_is_announced_too(monkeypatch):
    """Without this nobody knows whether this morning's alert still stands."""
    posts = []
    monkeypatch.setenv("FLOW_AGGREGATE_ENABLED", "0")
    fa.alert_if_unavailable(post=posts.append)          # arm as broken
    monkeypatch.setenv("FLOW_AGGREGATE_ENABLED", "1")
    monkeypatch.setattr(fa, "available", lambda: True)
    fa.alert_if_unavailable(post=posts.append)
    assert len(posts) == 1 and "again" in posts[0]


def test_a_merely_COLD_cache_never_wakes_anyone(monkeypatch):
    """Cold is normal after every restart. Alerting on it trains people to
    ignore the channel."""
    posts = []
    monkeypatch.setattr(fa, "available", lambda: True)
    fa.alert_if_unavailable(post=posts.append)
    fa._CACHE.clear()
    fa.alert_if_unavailable(current_version=99, post=posts.append)
    assert posts == []


def test_the_health_route_is_registered_and_open():
    """Unauthenticated on purpose: a health check nobody can reach is one
    nobody runs. It must return no tape data — booleans and counts only."""
    from api import flow_router as fr
    route = next((r for r in fr.flow_router.routes
                  if getattr(r, "path", "") == "/api/flow/aggregate-health"), None)
    assert route is not None, "/api/flow/aggregate-health is not registered"
    body = fa.health(current_version=1)
    assert set(body) >= {"enabled", "available", "warm", "reason", "entries"}
    assert "json_bytes" not in body and "D" not in body


def test_member_traffic_is_counted_apart_from_the_warmers_own_calls(monkeypatch):
    """⛔ THE WARMER USES THE SAME BUILDER, so one tally cannot answer "are
    members reaching the fast path?" — the warmer alone keeps it non-zero
    forever, even if every browser stopped asking. That is a signal which
    cannot distinguish the thing measured from the thing measuring it.
    """
    from api import flow_router as fr
    monkeypatch.setattr(fa, "build", lambda csv, date_filter=None: {
        "json_bytes": b'{"ok":true}', "stats": {}})
    monkeypatch.setattr(fr, "_get_cached_or_build",
                        lambda source, days: (1, gzip.compress(b"csv")))
    before = fa._STATS["endpoint_requests"]

    # What the WARMER does — must not look like member traffic.
    fr.build_aggregate("stocks", 1, "Last1", 7)
    fr.build_aggregate("stocks", 5, "Last5", 7)
    assert fa._STATS["endpoint_requests"] == before, (
        "the warmer's own calls are being counted as members reaching the "
        "endpoint — the 'is anyone served?' signal is then always positive")
    assert fa._STATS["requests"] >= before + 2, "the cache-level tally still moves"
