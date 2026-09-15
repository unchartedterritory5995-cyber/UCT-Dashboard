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


def test_the_warm_loop_is_uct_only_and_that_is_recorded(monkeypatch):
    """⚠️ A KNOWN, STATED GAP — not a silent one.

    `warm_breadth` walks the 44 shipped UCT symbols. A published PIT universe is
    NOT pre-warmed, so its first request per symbol pays a cold build. That is
    acceptable while the library is dark and must be designed deliberately before a
    universe is published — this rail exists so the gap cannot disappear from view.
    """
    seen = []
    monkeypatch.setattr(bs, "_refresh_series",
                        lambda sym, metric, *a, **k: seen.append(sym) or [])
    monkeypatch.setattr(bs, "_WARM_GAP", 0)
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", "*")
    bs.warm_breadth()
    assert seen, "the warm loop did nothing at all"
    assert not any(":" in s for s in seen), (
        "the warm loop began warming namespaced identities — that is a real "
        "improvement, but it needs a per-universe sealed-date probe and a throttle "
        "proven safe across four universes, so update this rail deliberately")
    assert set(seen) <= set(bs.SYMBOLS)
