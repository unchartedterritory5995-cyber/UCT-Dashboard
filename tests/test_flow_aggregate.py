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

    def fake_build(csv):
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
    monkeypatch.setattr(fa, "build", lambda csv: {"json_bytes": b'{"ok":true}', "stats": {}})
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
    monkeypatch.setattr(fa, "build", lambda csv: {"json_bytes": b'{"ok":true}', "stats": {}})
    fa._BUILD_LOCK.acquire()
    try:
        assert fa.get_cached_or_build(("stocks", 1), 1, lambda: "csv") is None
    finally:
        fa._BUILD_LOCK.release()


def test_an_empty_csv_from_the_provider_is_not_cached(monkeypatch):
    monkeypatch.setattr(fa, "build", lambda csv: {"json_bytes": b'{"ok":true}', "stats": {}})
    assert fa.get_cached_or_build(("stocks", 1), 1, lambda: "") is None
    assert not fa._CACHE, "an empty source was cached as though it were an answer"


def test_the_cache_is_bounded(monkeypatch):
    monkeypatch.setattr(fa, "build", lambda csv: {"json_bytes": b'{"ok":true}', "stats": {}})
    for i in range(fa._CACHE_MAX + 4):
        fa.get_cached_or_build(("stocks", i), 1, lambda: "csv")
    assert len(fa._CACHE) <= fa._CACHE_MAX


def test_the_cached_body_is_gzipped(monkeypatch):
    monkeypatch.setattr(fa, "build", lambda csv: {"json_bytes": b'{"ok":true,"D":{}}', "stats": {}})
    _, gz = fa.get_cached_or_build(("stocks", 1), 1, lambda: "csv")
    assert gzip.decompress(gz) == b'{"ok":true,"D":{}}'


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
