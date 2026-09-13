"""D4 CP3 — adopter 2: theme_performance + groups adopt per-entity keys.

GATE-D4 CP3, approval fingerprint `40caca541`. Classification **PRE-DECLARED
BEHAVIOUR-CHANGING**: both modules are inside flow-worker's import closure and
neither is watched, so this merges with a marker bump and both artifacts.

⭐ **THE TWO SITES ARE THE SAME DEFECT IN DIFFERENT CLOTHES.**
`theme_performance` joins every sym into one `TTLCache` key around a per-symbol
loop; `groups` does the same thing in a **bespoke module dict outside `TTLCache`
entirely**, with a hand-checked TTL and hand-rolled eviction at >256 entries.
Both keep their set key as a fast path — §2.4 rule 2 — and gain a per-entity tier
underneath.

⛔ `api/services/cache.py` IS UNTOUCHED (D4-D).
"""
from __future__ import annotations

import pytest

from api.services import groups as gr
from api.services import theme_performance as tp
from api.services.cache import cache


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    tp.d4_reset_counters()
    gr._TODAY_CACHE.clear()
    # ⛔ THE SHARED CACHE OUTLIVES A TEST, and clearing only the set-key dict left
    # per-symbol rows behind — one test's AAA satisfied the next test's request and
    # the "only a real result is cached" assertion failed on POLLUTION, not on the
    # product. Clearing both tiers is the point of having two tiers.
    for _s in ("AAA", "BBB", "CCC", "ZZZ", "GHOST"):
        cache.invalidate(gr._today_sym_key(_s))
        cache.invalidate(tp._ts_extra_key(_s))
    # ⚠️ The RETURN COMPUTATION is not what CP3 changes — the caching around it
    # is. Neutralising it keeps these tests about the cache; a hand-built bar
    # fixture would be testing _compute_returns_with_refs by accident.
    monkeypatch.setattr(tp, "_compute_returns_with_refs",
                        lambda bars: ({"1d": 1.0}, {"1d": 10.0}))
    yield
    tp.d4_reset_counters()
    gr._TODAY_CACHE.clear()


# ─────────────────────── adopter 2a — theme_performance ─────────────────────

def test_a_SECOND_call_sharing_syms_refetches_only_the_new_one(monkeypatch):
    """⭐ The benefit, measured. Before CP3 a different sym SET meant a different
    key meant a full recompute of every sym in it."""
    fetched = []

    def fake_bars(sym, f, t):
        fetched.append(sym)
        return [{"t": 1, "c": 10.0}]

    monkeypatch.setattr("api.services.massive.get_agg_bars", fake_bars)

    tp.live_returns_for_syms(["AAA", "BBB"])
    first = sorted(fetched)
    fetched.clear()

    tp.live_returns_for_syms(["BBB", "CCC"])      # a DIFFERENT set, one shared name
    assert first == ["AAA", "BBB"]
    assert fetched == ["CCC"], (
        f"expected only the new sym to be fetched, got {fetched}. The set key "
        "missed (different set) and the per-symbol tier did not catch BBB.")


def test_the_set_key_is_KEPT_as_a_fast_path(monkeypatch):
    """§2.4 rule 2: a request-set key is fine OVER a per-entity cache."""
    monkeypatch.setattr("api.services.massive.get_agg_bars",
                        lambda s, f, t: [{"t": 1, "c": 10.0}])
    tp.d4_reset_counters()
    tp.live_returns_for_syms(["AAA"])
    tp.live_returns_for_syms(["AAA"])
    assert tp.d4_counters()["set_hit"] >= 1, (
        "the second identical call did not hit the set key — the fast path is gone")


def test_SNAPSHOT_IDENTITY_the_served_shape_is_unchanged(monkeypatch):
    monkeypatch.setattr("api.services.massive.get_agg_bars",
                        lambda s, f, t: [{"t": 1, "c": 10.0}])
    a = tp.live_returns_for_syms(["AAA", "BBB"])
    assert set(a) == {tp._ts_key("AAA"), tp._ts_key("BBB")}
    for row in a.values():
        assert set(row) == {"sym", "name", "returns", "ref_prices", "source"}
        assert row["source"] == "user"
    b = tp.live_returns_for_syms(["AAA", "BBB"])
    assert a == b, "the cached path served a different value from the computed path"


def test_an_empty_request_still_returns_empty(monkeypatch):
    assert tp.live_returns_for_syms([]) == {}


def test_the_counter_never_gates_serving(monkeypatch):
    monkeypatch.setattr("api.services.massive.get_agg_bars",
                        lambda s, f, t: [{"t": 1, "c": 10.0}])
    tp._d4_counters.clear()
    out = tp.live_returns_for_syms(["ZZZ"])
    assert tp._ts_key("ZZZ") in out, "a damaged counter changed what was served"


def test_d4_hit_rate_is_None_before_anything_is_observed():
    tp.d4_reset_counters()
    assert tp.d4_hit_rate() is None


# ──────────────────────────── adopter 2b — groups ───────────────────────────

def test_groups_reuses_per_symbol_rows_across_different_sym_sets(monkeypatch):
    calls = []

    def fake_snap(syms):
        calls.append(sorted(syms))
        return {s: {"todaysChangePerc": 1.0} for s in syms}

    monkeypatch.setattr("api.services.massive.get_etf_snapshots", fake_snap)
    gr._today_map(["AAA", "BBB"])
    gr._TODAY_CACHE.clear()                       # only the SET key expires
    gr._today_map(["BBB", "CCC"])
    assert calls == [["AAA", "BBB"], ["CCC"]], (
        f"expected the second call to fetch only CCC, got {calls}. The per-symbol "
        "rows in the shared cache were not reused.")


def test_a_symbol_the_provider_OMITS_keeps_no_row_and_is_retried(monkeypatch):
    """⛔ THE DISTINCTION THAT MATTERS. `get_etf_snapshots` can answer for some
    symbols and silently omit others. Caching a row for an omitted symbol would
    pin a gap; caching nothing means the next call retries it."""
    calls = []

    def fake_snap(syms):
        calls.append(sorted(syms))
        return {s: {"todaysChangePerc": 1.0} for s in syms if s != "GHOST"}

    monkeypatch.setattr("api.services.massive.get_etf_snapshots", fake_snap)
    out = gr._today_map(["AAA", "GHOST"])
    assert "GHOST" not in out
    assert cache.get(gr._today_sym_key("GHOST")) is None, (
        "a symbol the provider never answered for was cached — the gap is now pinned")
    gr._TODAY_CACHE.clear()
    gr._today_map(["AAA", "GHOST"])
    assert calls[-1] == ["GHOST"], f"GHOST was not retried: {calls}"


def test_groups_still_caches_only_a_REAL_result(monkeypatch):
    """The module's own docstring promise: a transient stall self-recovers on the
    next call rather than pinning an RS fallback for the whole TTL."""
    monkeypatch.setattr("api.services.massive.get_etf_snapshots", lambda s: {})
    out = gr._today_map(["AAA"])
    assert out == {}
    assert cache.get(gr._today_sym_key("AAA")) is None
    assert gr._TODAY_CACHE == {}, "an empty result was cached; a stall is now pinned"


def test_groups_bespoke_dict_is_still_the_FAST_PATH_not_the_only_cache():
    src = open("api/services/groups.py", encoding="utf-8").read()
    assert "_TODAY_CACHE[key] = (out, now)" in src, "the fast path was deleted, not demoted"
    assert "_today_sym_key(" in src, "the per-entity tier is missing"


# ───────────────────────────── shared structural ────────────────────────────

def test_cache_py_is_UNTOUCHED_by_this_checkpoint():
    """D4-D: flow-worker runs cache.py and does not redeploy for it."""
    assert "D4" not in open("api/services/cache.py", encoding="utf-8").read()


def test_BOTH_adopters_are_in_flow_workers_closure_which_is_why_this_bumps():
    """⛔ The classification was PRE-DECLARED BEHAVIOUR-CHANGING. This asserts the
    measurement that justified it, so a future reader can see it was not guessed."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "wc", "tools/flow_worker_watch_coverage.py")
    wc = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(wc)
    reach = set(wc.reachable_paths("."))
    for f in ("api/services/theme_performance.py", "api/services/groups.py"):
        assert f in reach, (
            f"{f} is no longer in flow-worker's import closure — the "
            "BEHAVIOUR-CHANGING classification and its marker bump need re-deriving")
