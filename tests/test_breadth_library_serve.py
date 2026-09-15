"""A published namespaced identity flows through the CANONICAL serve path.

Not a parallel breadth engine: the same `build_breadth_bars` the 44 shipped UCT
symbols use, reading the same store, keyed by universe. The rails here are about
POPULATION — a US series must never show UCT's numbers, and vice versa.
"""
import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_symbols as bs


@pytest.fixture()
def seeded(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "*")
    store._INIT_DONE = False
    store._ensure_init()
    # Three universes, same date, same metric, three different values.
    rows = {"uct": 41.0, "us": 47.23, "nasdaq": 55.19}
    for uni, v in rows.items():
        store.write_bulk([("2015-03-09", "pct_above_50sma", v - 1, v, v - 2, v - 0.5),
                          ("2015-03-10", "pct_above_50sma", v - 0.5, v + 1, v - 1, v)],
                         universe=uni)
    # a signed metric, US only
    store.write_bulk([("2015-03-09", "net_new_high_low", 0, 13, 0, 13.0),
                      ("2015-03-10", "net_new_high_low", 13, 13, -99, -99.0),
                      ("2015-03-11", "net_new_high_low", -99, 0, -99, 0.0)],
                     universe="us")
    # ⚠️ CLEAR THE BREADTH CACHE, NOT THE SHARED ONE. Breadth now owns a dedicated
    # TTLCache instance, so clearing `api.services.cache.cache` leaves a sealed
    # series behind and the next test in the run serves it — which is how this
    # fixture leaked into `test_breadth_daily_ohlc` the first time.
    _clear()
    yield
    store._INIT_DONE = False
    _clear()


def _clear():
    with bs._breadth_cache._lock:
        bs._breadth_cache._store.clear()


def _closes(sym):
    out = bs.build_breadth_bars(sym, "D", 400)
    return {b["t"]: b["c"] for b in out["bars"]}


def test_each_universe_serves_its_own_numbers(seeded):
    assert _closes("US:A50")["2015-03-10"] == 47.23
    assert _closes("NASDAQ:A50")["2015-03-10"] == 55.19
    assert _closes("UCTA50")["2015-03-10"] == 41.0


def test_an_unpublished_universe_serves_nothing_rather_than_another_universes_rows(
        seeded, monkeypatch):
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us")
    _clear()
    assert bs.build_breadth_bars("US:A50")["bars"], "us is published"
    # ⛔ NASDAQ is dark: empty, never UCT's or US's numbers wearing NASDAQ's name.
    assert bs.build_breadth_bars("NASDAQ:A50")["bars"] == []


def test_an_unregistered_colon_token_serves_an_empty_series(seeded):
    for bad in ("NASDAQ:AAPL", "FOO:BAR", "US:NOPE"):
        assert bs.build_breadth_bars(bad)["bars"] == [], bad


def test_the_uct_alias_serves_the_canonical_uct_series(seeded):
    assert _closes("UCT:A50") == _closes("UCTA50")


# ── the signed metric, end to end ────────────────────────────────────────────

def test_a_signed_series_survives_the_serve_path_intact(seeded):
    got = _closes("US:NETHL")
    # ⛔ positive, zero and negative all survive — no clamp, no 0-100 domain.
    assert got["2015-03-09"] == 13.0
    assert got["2015-03-10"] == -99.0
    assert got["2015-03-11"] == 0.0


def test_the_signed_metrics_candles_keep_their_sign_in_every_field(seeded):
    bars = {b["t"]: b for b in bs.build_breadth_bars("US:NETHL", "D", 400)["bars"]}
    b = bars["2015-03-10"]
    assert b["l"] == -99.0 and b["c"] == -99.0
    assert b["h"] >= b["l"] and b["h"] >= b["o"] and b["l"] <= b["c"]


def test_the_catalogue_carries_the_presentation_metadata_the_chart_needs(seeded):
    row = bs.resolve("US:NETHL")
    # ⛔ A renderer asks the CATALOGUE how to draw this, never the ticker string.
    assert row["domain"] == "signed"
    assert row["presentation"] == "histogram"
    assert row["unit"] == "count"
    a50 = bs.resolve("US:A50")
    assert a50["unit"] == "percent" and a50["domain"] == "pct_0_100"
    assert a50["presentation"] == "line"


# ── population isolation ─────────────────────────────────────────────────────

def test_a_pit_universe_never_merges_the_collectors_uct_snapshot(seeded, monkeypatch):
    """⛔ `breadth_monitor` stores what the collector measured over the UCT
    universe. Splicing it into a US series would join two populations into one line."""
    called = {"n": 0}
    from api.services import breadth_monitor

    def _spy(*a, **k):
        called["n"] += 1
        return []

    monkeypatch.setattr(breadth_monitor, "get_history", _spy)
    bs._build_breadth_series("US:A50", "pct_above_50sma", "us")
    assert called["n"] == 0
    bs._build_breadth_series("UCTA50", "pct_above_50sma", "uct")
    assert called["n"] == 1


def test_a_pit_universe_never_appends_the_uct_live_candle(seeded, monkeypatch):
    """⛔ `breadth_live` measures the collector's universe; its intraday value on a
    US chart would be one universe's number painted on another's series."""
    monkeypatch.setattr(bs, "_live_map", lambda: {"pct_above_50sma": 99.9})
    _clear()
    assert 99.9 not in set(_closes("US:A50").values())


# ── cache isolation (§15) ────────────────────────────────────────────────────

def test_breadth_holds_its_series_in_its_OWN_cache_not_the_shared_one(seeded):
    """⛔ The shared singleton is bounded at 1,000 entries and is hammered by bars,
    news and snapshot keys. A sealed breadth series is a LARGE value held for HOURS,
    and the library projects 156 identities — so sharing would have them evicting
    each other, each looking like the other's performance problem."""
    from api.services.cache import cache as shared
    with shared._lock:
        shared._store.clear()

    bs.build_breadth_bars("US:A50", "D", 400)

    assert any(k.startswith("breadthdaily_") for k in bs._breadth_cache._store), \
        "the sealed series did not land in the dedicated instance"
    assert not any(k.startswith("breadthdaily_") for k in shared._store), \
        "a breadth series leaked into the shared cache"


def test_the_dedicated_instance_states_its_own_bound(seeded):
    # `cache.py`'s rule: an instance whose working set is a known, derivable
    # quantity states its OWN bound rather than inheriting the module default.
    from api.services.cache import _MAX_SIZE as shared_default
    assert bs._breadth_cache.max_size == bs._BREADTH_CACHE_MAX
    assert bs._BREADTH_CACHE_MAX != shared_default
    # and it comfortably holds the whole projected catalogue
    assert bs._BREADTH_CACHE_MAX >= len(bs.library_rows())


def test_the_warm_loop_warms_uct_plus_the_participation_family(monkeypatch):
    """⭐ THE DELIBERATE WIDENING the previous rail asked for, and its new bound.

    That rail said the warm loop was UCT-only and that widening it "needs a
    per-universe sealed-date probe and a throttle proven safe across four universes,
    so update this rail deliberately". This is that update: a published PIT universe
    is warmed for the PARTICIPATION FAMILY ONLY — seven series, the ones a member
    opens a new universe to look at — and everything else stays lazy.

    ⛔ THE BOUND IS THIS LOOP'S OWN HISTORY. Warming the whole V1 catalogue across
    three universes would be 54 cold builds per pass on the single web pod, which is
    the shape of the churn that starved it once already.
    """
    seen = []
    monkeypatch.setattr(bs, "_refresh_series",
                        lambda sym, metric, *a, **k: seen.append(sym) or [])
    monkeypatch.setattr(bs, "_WARM_GAP", 0)
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "*")
    bs.warm_breadth()
    assert seen, "the warm loop did nothing at all"

    legacy = [x for x in seen if ":" not in x]
    namespaced = [x for x in seen if ":" in x]
    # UCT is untouched: the same 44, exactly as before
    assert set(legacy) == set(bs.SYMBOLS)
    # and every namespaced series is participation, for a published universe
    assert namespaced, "a published PIT universe was not warmed at all"
    assert len(namespaced) == 21, namespaced          # 3 universes x 7 participation
    codes = {x.split(":", 1)[1] for x in namespaced}
    assert codes == {"A5", "A10", "A20", "A40", "A50", "A100", "A200"}, codes


def test_the_warm_loop_is_INERT_while_the_library_is_dark(monkeypatch):
    """⛔ The default deploy must warm exactly what it warms today — nothing new."""
    seen = []
    monkeypatch.setattr(bs, "_refresh_series",
                        lambda sym, metric, *a, **k: seen.append(sym) or [])
    monkeypatch.setattr(bs, "_WARM_GAP", 0)
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    bs.warm_breadth()
    assert set(seen) == set(bs.SYMBOLS)
    assert not any(":" in x for x in seen)


def test_warming_never_exceeds_its_ceiling_or_leaves_its_families(monkeypatch):
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "*")
    monkeypatch.setenv("BREADTH_LIBRARY_METRICS", "*")   # publish EVERYTHING
    want = bs.warm_symbols_for_pit()
    assert len(want) <= bs.WARM_PIT_MAX
    from api.services import breadth_metrics as bm
    for _sym, metric, _uni in want:
        assert bm.METRICS[metric]["group"] in bs.WARM_FAMILIES


def test_a_failing_pit_warm_cannot_break_the_pass(monkeypatch):
    """⛔ Warming is an OPTIMISATION. One that can break serving is not one."""
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "us")
    monkeypatch.setattr(bs, "_WARM_GAP", 0)

    def _boom(sym, metric, *a, **k):
        if ":" in sym:
            raise RuntimeError("the store is on fire")
        return []
    monkeypatch.setattr(bs, "_refresh_series", _boom)
    stats = bs.warm_breadth()                      # must NOT raise
    assert stats["refreshed"] == len(bs.SYMBOLS)   # UCT still warmed
    assert stats["pit"]["failed"] == 7 and stats["pit"]["refreshed"] == 0


# ── BL-033 · an empty build must not PIN ──────────────────────────────────────

def test_an_empty_series_is_retried_in_minutes_while_a_real_one_is_kept_for_hours(
        tmp_path, monkeypatch):
    """⛔ THE SIX-HOUR BLACK HOLE. `_refresh_series` caches whatever it built, and the
    web pod pulls the breadth database from R2 at boot while `start_breadth_warm`
    waits only 20 s before walking all 44 shipped symbols. A slow pull therefore hands
    it 44 EMPTY builds.

    ⭐ THAT USED TO SELF-HEAL BY ACCIDENT. In the shared 1,000-key cache `/api/bars`
    traffic evicted the empty entries within minutes. Breadth's own 512-entry instance
    (BL-010) holds ~156 identities and evicts NOTHING — and `warm_breadth` skips a
    symbol whose cache is still fresh, so an empty entry suppresses its own repair.

    This pins the distinction the fix rests on: the TTL is a claim about how much we
    trust the answer, so a real series keeps six hours and an empty one gets five
    minutes. Asserting the TTL rather than the value is deliberate — the bug was never
    a wrong number, it was a right number kept too long.
    """
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "empty.db"))
    store._INIT_DONE = False
    store._ensure_init()
    bs._breadth_cache.delete_prefix("breadthdaily_")

    def ttl_of(sym):
        for k, _v, exp in bs._breadth_cache.items_with_expiry():
            if k == f"breadthdaily_{sym}":
                return exp
        return None

    import time as _t

    monkeypatch.setattr(bs, "_build_breadth_series", lambda *a, **k: [])
    assert bs._refresh_series("UCTA50", "pct_above_50sma") == []
    empty_ttl = ttl_of("UCTA50") - _t.time()
    assert 0 < empty_ttl <= bs._EMPTY_SERIES_TTL + 5, (
        "an empty build was cached for %.0fs — it must be retried in minutes, not "
        "held for the sealed-history TTL" % empty_ttl)

    real = [{"t": "2020-03-10", "o": 45, "h": 70, "l": 30, "c": 55, "v": 0}]
    monkeypatch.setattr(bs, "_build_breadth_series", lambda *a, **k: list(real))
    assert bs._refresh_series("UCTA50", "pct_above_50sma") == real
    real_ttl = ttl_of("UCTA50") - _t.time()
    assert real_ttl > bs._EMPTY_SERIES_TTL * 2, (
        "a REAL series must still get the long sealed TTL (%.0fs) — the fix must not "
        "turn every breadth request back into a rebuild" % real_ttl)

    bs._breadth_cache.delete_prefix("breadthdaily_")


def test_the_empty_entry_does_not_suppress_its_own_repair(tmp_path, monkeypatch):
    """⚠️ THE SECOND HALF, AND THE ONE THAT MADE IT A BLACK HOLE. It is not enough
    that the entry expires — `warm_breadth` must actually rebuild it afterwards. A
    fresh-looking empty entry is skipped by the warm loop, so a TTL that outlives the
    loop's own cadence means the repair never runs.
    """
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "empty2.db"))
    store._INIT_DONE = False
    store._ensure_init()
    assert bs._EMPTY_SERIES_TTL < bs._SEALED_TTL, "an empty build must expire sooner"
    # the warm loop's own cadence — the empty TTL has to be survivable by it, i.e. the
    # loop must come round again while the entry is still worth rebuilding.
    import inspect
    src = inspect.getsource(bs.start_breadth_warm)
    assert "interval_seconds" in src
    default = inspect.signature(bs.start_breadth_warm).parameters["interval_seconds"].default
    assert bs._EMPTY_SERIES_TTL >= default, (
        "the empty TTL (%ss) is shorter than the warm loop's interval (%ss), which "
        "would rebuild every cycle rather than converge" % (bs._EMPTY_SERIES_TTL, default))
