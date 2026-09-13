"""D4 CP2 — adopter 1: per-ticker keying for watchlist returns.

GATE-D4 CP2, approval fingerprint `40caca541`:

    CP2 - ADOPTER 1: api/services/watchlist_performance.py, INCLUDING THE
    `wl_perf:` CACHE-KEY FIX. Per-ticker keying so one failed ticker's all-None
    row can NEVER be cached against healthy peers in the same request. The set
    key stays as a fast path. A hit-rate counter, which is observability and
    NEVER a gate on serving. Snapshot-identity on the served values. A test
    using EXACTLY that scenario - a batch where one ticker fails and its peers
    succeed. Mutation: restore the set-hash key -> RED. cache.py UNTOUCHED.

⛔ THE SCENARIO THE SCOPE NAMES IS THE FIRST TEST BELOW, and it is the defect in
its exact form: a batch where ONE ticker's fetch raises and the others succeed.
"""
from __future__ import annotations

import pytest

from api.services import watchlist_performance as wp
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _clean():
    cache.clear() if hasattr(cache, "clear") else None
    wp.reset_counters()
    yield
    wp.reset_counters()


def _row(v):
    return {"1d": v, "1w": v, "1m": v, "3m": v, "ytd": v,
            "5d": v, "30d": v, "60d": v, "90d": v, "refs": {}}


# ─────────────── the scenario the scope names, in its exact form ────────────

def test_ONE_failed_ticker_is_NOT_cached_against_its_healthy_peers(monkeypatch):
    """⛔⛔ THE DEFECT, REPRODUCED THEN FIXED. AAA and BBB succeed, CCC raises.

    Before CP2 the whole batch shared one key and one completeness verdict, so
    CCC's all-None row travelled with AAA and BBB. Now each ticker carries its
    own key and its own verdict."""
    calls = []

    def fake(ticker):
        calls.append(ticker)
        if ticker == "CCC":
            raise RuntimeError("provider said no")
        return _row(1.0)

    monkeypatch.setattr(wp, "_fetch_ticker_returns", fake)
    out = wp.get_batch_returns(["AAA", "BBB", "CCC"])

    assert out["AAA"]["1d"] == 1.0 and out["BBB"]["1d"] == 1.0
    assert out["CCC"]["1d"] is None, "the failed ticker must still appear, as an all-None row"

    as_of = __import__("datetime").date.today().isoformat()
    # ⭐ THE ASSERTION THAT IS THE WHOLE CHECKPOINT: the healthy peers are cached
    # per ticker, and the failed one did NOT poison them.
    assert cache.get(wp._ticker_key("AAA", as_of)) is not None, (
        "AAA was not cached per-ticker — it is still hostage to the batch")
    assert cache.get(wp._ticker_key("BBB", as_of)) is not None


def test_a_SECOND_request_sharing_tickers_reuses_them_and_refetches_only_the_new_one(monkeypatch):
    """⭐ The benefit, measured: two members whose lists overlap now share rows.
    Before CP2 a different ticker SET meant a different key meant a full recompute."""
    calls = []

    def fake(ticker):
        calls.append(ticker)
        return _row(2.0)

    monkeypatch.setattr(wp, "_fetch_ticker_returns", fake)
    wp.get_batch_returns(["AAA", "BBB"])
    first = list(calls)
    calls.clear()

    wp.get_batch_returns(["BBB", "CCC"])       # a DIFFERENT set, one shared name
    assert first == ["AAA", "BBB"]
    assert calls == ["CCC"], (
        f"expected only the new ticker to be fetched, got {calls}. The set key "
        "missed (different set) and the per-ticker tier did not catch BBB.")


def test_the_failed_ticker_is_RETRIED_while_its_peers_are_not(monkeypatch):
    """The per-ticker TTLs differ by design: a failed row expires in 30s, a
    healthy one in 300s. Proving the SHORT ttl was applied to the right row."""
    state = {"fail": True}

    def fake(ticker):
        if ticker == "CCC" and state["fail"]:
            raise RuntimeError("transient")
        return _row(3.0)

    monkeypatch.setattr(wp, "_fetch_ticker_returns", fake)
    wp.get_batch_returns(["AAA", "CCC"])
    as_of = __import__("datetime").date.today().isoformat()
    cache.invalidate(wp._ticker_key("CCC", as_of))      # simulate the 30s expiry
    cache.invalidate("wl_perf:" + __import__("hashlib").md5(b"AAA,CCC").hexdigest())
    state["fail"] = False

    calls = []
    monkeypatch.setattr(wp, "_fetch_ticker_returns",
                        lambda t: (calls.append(t), _row(3.0))[1])
    out = wp.get_batch_returns(["AAA", "CCC"])
    assert calls == ["CCC"], f"only the expired failure should refetch, got {calls}"
    assert out["CCC"]["1d"] == 3.0


# ───────────────────────── snapshot identity ────────────────────────────────

def test_SNAPSHOT_IDENTITY_the_served_value_is_unchanged(monkeypatch):
    """⛔ The scope requires byte-identical served values. The computation did
    not change — only which rows came from cache — so the shape must match
    exactly, keys and all."""
    monkeypatch.setattr(wp, "_fetch_ticker_returns", lambda t: _row(4.0))
    a = wp.get_batch_returns(["AAA", "BBB"])
    expected_keys = {"1d", "1w", "1m", "3m", "ytd", "5d", "30d", "60d", "90d", "refs"}
    assert set(a) == {"AAA", "BBB"}
    for sym, row in a.items():
        assert set(row) == expected_keys, f"{sym} row shape changed: {set(row)}"
    # and a cached second call returns the identical structure
    b = wp.get_batch_returns(["AAA", "BBB"])
    assert a == b, "the cached path served a different value from the computed path"


def test_an_empty_request_still_returns_an_empty_dict(monkeypatch):
    monkeypatch.setattr(wp, "_fetch_ticker_returns", lambda t: _row(5.0))
    assert wp.get_batch_returns([]) == {}


# ──────────────────────── the counter is observability ──────────────────────

def test_the_counter_counts_and_NEVER_gates_serving(monkeypatch):
    """⛔ The scope: 'observability, never a gate on serving; a cache that can
    refuse to serve because its counter is unhappy is a new failure mode.'"""
    monkeypatch.setattr(wp, "_fetch_ticker_returns", lambda t: _row(6.0))
    wp.get_batch_returns(["AAA"])
    assert wp.counters()["miss"] == 1
    wp.get_batch_returns(["AAA"])                 # set-key fast path
    assert wp.counters()["set_hit"] == 1

    # Serving must be unaffected by a broken counter.
    wp._counters.clear()
    out = wp.get_batch_returns(["ZZZ"])
    assert "ZZZ" in out, "a damaged counter changed what was served"


def test_hit_rate_is_None_before_anything_is_observed():
    """⛔ A rate over zero calls is 0.0, which reads as 'the cache never hits'
    rather than 'nobody asked'. Same distinction as UNREADABLE vs zero."""
    wp.reset_counters()
    assert wp.hit_rate() is None
    wp._counters["set_hit"] = 1
    assert wp.hit_rate() == 1.0


# ─────────────────────────── the structural rails ───────────────────────────

def test_the_set_key_is_KEPT_as_a_fast_path_not_deleted():
    """§2.4 rule 2. Deleting it would be as wrong as keeping it as the only cache."""
    src = open("api/services/watchlist_performance.py", encoding="utf-8").read()
    assert 'cache_key = "wl_perf:"' in src, "the fast path was deleted, not demoted"
    assert "_ticker_key(" in src, "the per-entity tier is missing"


def test_cache_py_is_UNTOUCHED_by_this_checkpoint():
    """D4-D: flow-worker runs cache.py and does not redeploy for it."""
    assert "D4" not in open("api/services/cache.py", encoding="utf-8").read()


def test_the_FAILED_row_is_written_with_complete_FALSE_and_its_peers_with_TRUE(monkeypatch):
    """⛔ ADDED AFTER A MUTATION STAYED GREEN. Flipping the per-ticker
    `complete=ok` to `complete=True` passed every other test here — because the
    retry test invalidates the key by hand rather than relying on the TTL. So
    nothing asserted the one thing that makes the short TTL happen.

    ⭐ A mutation that survives is a gap in the tests, not a harmless change:
    with `complete=True` a failed ticker's all-None row would sit at the FULL
    300s TTL, which is the original defect wearing per-ticker keys."""
    seen = []
    real = wp.set_by_completeness

    def spy(key, value, *, complete, ttl_ok, ttl_partial):
        if key.startswith("wl_returns::"):
            seen.append((key.split("::")[1], complete))
        return real(key, value, complete=complete, ttl_ok=ttl_ok, ttl_partial=ttl_partial)

    monkeypatch.setattr(wp, "set_by_completeness", spy)

    def fake(ticker):
        if ticker == "CCC":
            raise RuntimeError("provider said no")
        return _row(7.0)

    monkeypatch.setattr(wp, "_fetch_ticker_returns", fake)
    wp.get_batch_returns(["AAA", "CCC"])

    got = dict(seen)
    assert got.get("AAA") is True, f"a healthy ticker was not written complete: {seen}"
    assert got.get("CCC") is False, (
        f"the FAILED ticker was written complete={got.get('CCC')} — it would hold the "
        f"full TTL and pin an all-None row for 5 minutes: {seen}")
