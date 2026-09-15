"""THE ONE PUBLICATION GATE, and the three collections it must not confuse.

⭐⭐ THE CLAIM UNDER TEST: a breadth identity is public if and only if
`breadth_symbols.is_published(universe, metric)` says so, and EVERY public surface
derives from that one answer. Before BL-013 they did not: `/api/bars` and `resolve()`
asked the registry and the universe flag, while `/api/ticker-search` and the
`symbols` array read a hard-wired list of the 44 shipped UCT records. Publishing a
universe would have made an identity CHARTABLE but not SEARCHABLE — and absent from
the payload the client builds its breadth family map from, which is how a breadth
measure gets classified as an ordinary security and offered candles.

⛔ AND THREE COLLECTIONS THAT ARE NOT THE SAME COLLECTION:
    legacy (44 shipped UCT)  ⊂  published  ⊆  registered
"""
import pytest

from api.services import breadth_daily_ohlc as store
from api.services import breadth_history_recon as recon
from api.services import breadth_metrics as bm
from api.services import breadth_symbols as bs
from api.services import breadth_universes as bu


@pytest.fixture(autouse=True)
def _dark(monkeypatch):
    """Every case starts from the SHIPPED default: UCT only, V1 set."""
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    monkeypatch.delenv("BREADTH_LIBRARY_METRICS", raising=False)
    bs._health_cache.update(at=0.0, value=None)
    bs._avail_cache.update(at=0.0, value=None)


def publish(monkeypatch, universes, metrics=None):
    monkeypatch.setenv("BREADTH_LIBRARY_UNIVERSES", universes)
    if metrics is not None:
        monkeypatch.setenv("BREADTH_LIBRARY_METRICS", metrics)
    bs._avail_cache.update(at=0.0, value=None)


# ── PART B · the accepted V1 invariant ───────────────────────────────────────

def test_the_accepted_v1_invariant_holds_exactly():
    """⛔ 18 metrics · 70 identities · 16 UCT · 54 new. If canonical metadata ever
    stops producing this, the product changed and somebody has to say so out loud."""
    assert len(bm.V1_METRICS) == 18
    rows = bs.v1_identity_rows()
    assert len(rows) == 70
    by_uni = {}
    for r in rows:
        by_uni.setdefault(r["universe"], []).append(r)
    assert len(by_uni["uct"]) == 16
    assert sum(len(v) for k, v in by_uni.items() if k != "uct") == 54
    assert {k: len(v) for k, v in by_uni.items()} == {
        "uct": 16, "us": 18, "nasdaq": 18, "nyse": 18}


def test_uct_contributes_16_because_two_v1_metrics_have_no_uct_symbol():
    """⚠️ An IDENTITY needs a SYMBOL. `net_new_high_low` and `universe_count` have no
    UCT spelling — UCT never published one — so they are applicable under UCT and are
    still not identities there. That is the whole of 18 vs 16, and it is not a bug."""
    missing = [m for m in bm.V1_METRICS if not bs.symbol_for("uct", m)]
    assert missing == ["net_new_high_low", "universe_count"]
    for m in missing:
        assert bm.applies_to(m, "uct")          # applicable…
        assert bs.symbol_for("uct", m) is None  # …but no identity


def test_the_five_levels_are_five_different_questions():
    # registered + applicable + producible + published, each answerable alone
    assert "mcclellan_osc" in bm.METRICS                       # REGISTERED
    assert bm.is_applicable("mcclellan_osc", "us")             # APPLICABLE
    assert not bm.is_producible("mcclellan_osc", "us")         # not PRODUCIBLE
    assert bm.is_producible("magna_up", "us")                  # PRODUCIBLE
    assert not bm.is_published_metric("magna_up", "us")        # not PUBLISHED (V1.1)
    assert bm.is_published_metric("pct_above_50sma", "us")     # PUBLISHED


def test_uct_is_never_gated_by_a_publication_set():
    """⛔ A V1 list drawn up for the NEW universes must not take a shipped symbol off
    the air. UCTHS is not in V1 and must stay public."""
    assert "breadth_score" not in bm.V1_METRICS
    assert bm.is_published_metric("breadth_score", "uct")
    assert bs.is_published("uct", "breadth_score")
    assert bs.is_breadth_symbol("UCTHS")


def test_a_typoed_publication_set_falls_back_to_the_default(monkeypatch):
    monkeypatch.setenv("BREADTH_LIBRARY_METRICS", "v9-does-not-exist")
    assert bm.publication_set_name() == "v1"
    assert len(bm.published_metric_keys()) == 18


def test_the_star_publication_set_opens_everything(monkeypatch):
    monkeypatch.setenv("BREADTH_LIBRARY_METRICS", "*")
    assert bm.published_metric_keys() == list(bm.METRIC_KEYS)


# ── PART C · dark-default parity ─────────────────────────────────────────────

def test_the_dark_payload_is_byte_identical_to_the_legacy_projection():
    """⛔ THE BACKWARD-COMPATIBILITY GUARANTEE. With no flags, the public projection
    IS the 44 shipped rows — same rows, same order, same keys."""
    assert bs.published_symbol_rows() == bs.legacy_symbol_rows()
    assert bs.list_breadth_symbols() == bs.legacy_symbol_rows()
    assert len(bs.legacy_symbol_rows()) == 44


def test_dark_means_dark_at_every_surface():
    for sym in ("US:A50", "NASDAQ:A50", "NYSE:A50", "US:NETHL"):
        assert bs.resolve(sym) is None, sym
        assert not bs.is_breadth_symbol(sym), sym
        assert bs.build_breadth_bars(sym)["bars"] == [], sym
    assert not any(":" in r["symbol"] for r in bs.list_breadth_symbols())
    assert not any(":" in r["ticker"] for r in bs.search("A50", 40))
    assert {r["universe"] for r in bs.library_catalog()["rows"]} == {"uct"}


def test_every_shipped_uct_symbol_still_answers_identically():
    rows = {r["symbol"]: r for r in bs.list_breadth_symbols()}
    assert set(rows) == set(bs.SYMBOLS)
    for sym, rec in bs.SYMBOLS.items():
        assert rows[sym]["name"] == rec["name"]
        assert rows[sym]["metric"] == rec["metric"]
        assert rows[sym]["group"] == rec["group"]
        assert bs.is_breadth_symbol(sym)
        assert "universe" not in rows[sym]      # legacy rows carry no universe key


# ── PART A · one gate, every consumer ────────────────────────────────────────

def test_publishing_a_universe_turns_every_surface_on_together(monkeypatch):
    publish(monkeypatch, "us")
    rows = bs.list_breadth_symbols()
    us = [r for r in rows if r.get("universe") == "us"]
    assert len(us) == 18
    assert rows[:44] == bs.legacy_symbol_rows()          # legacy first, untouched

    # …and the SAME identities answer at every other surface
    for r in us:
        sym = r["symbol"]
        assert bs.resolve(sym) is not None, sym
        assert bs.is_breadth_symbol(sym), sym
    cat = {r["symbol"] for r in bs.library_catalog()["rows"]}
    assert {r["symbol"] for r in us} <= cat
    assert any(r["ticker"] == "US:A50" for r in bs.search("US:A50", 40))


def test_a_published_universe_does_NOT_publish_its_v1_1_metrics(monkeypatch):
    publish(monkeypatch, "us")
    for sym in ("US:MU", "US:U25M", "US:S2", "US:NH20", "US:HVC"):
        assert bs.resolve(sym) is None, sym
        assert not bs.is_breadth_symbol(sym), sym
        assert bs.build_breadth_bars(sym)["bars"] == [], sym
    assert not any(r["symbol"] == "US:MU" for r in bs.library_catalog()["rows"])


def test_a_published_universe_never_publishes_an_unproducible_metric(monkeypatch):
    publish(monkeypatch, "*", "*")
    for metric in bm.PIT_UNPRODUCIBLE:
        for uni in ("us", "nasdaq", "nyse"):
            assert not bs.is_published(uni, metric), (uni, metric)
        sym = bs.symbol_for("us", metric)
        assert sym is None or bs.resolve(sym) is None


def test_the_catalogue_and_bars_always_agree(monkeypatch):
    """⛔ THE BL-013 INVARIANT ITSELF: nothing may be discoverable-but-unservable or
    servable-but-undiscoverable, at any flag setting."""
    for unis, metrics in (("us", None), ("us,nasdaq", None), ("*", None), ("*", "*")):
        publish(monkeypatch, unis, metrics)
        discoverable = {r["symbol"] for r in bs.library_catalog()["rows"]}
        servable = {r["symbol"] for r in bs.list_breadth_symbols()}
        assert discoverable == servable, (unis, metrics,
                                          discoverable ^ servable)
        for sym in discoverable:
            assert bs.is_breadth_symbol(sym), sym


def test_an_unregistered_colon_token_is_never_published(monkeypatch):
    publish(monkeypatch, "*", "*")
    for bad in ("NASDAQ:AAPL", "FOO:BAR", "US:NOPE", "US:", ":A50"):
        assert bs.resolve(bad) is None, bad
        assert not bs.is_breadth_symbol(bad), bad


# ── the blast-radius rule: legacy stays legacy ───────────────────────────────

def test_the_prebuilt_watchlists_never_gain_a_namespaced_identity(monkeypatch):
    """⛔⛔ A member's 'UCT Breadth' prebuilt list means the 44 shipped measures.
    Publishing a universe must not push 54 further identities into it."""
    publish(monkeypatch, "*", "*")
    by_group = bs.symbols_by_group()
    flat = [s for syms in by_group.values() for s in syms]
    assert len(flat) == 44
    assert not any(":" in s for s in flat)
    assert set(flat) == set(bs.SYMBOLS)

    from api.services import watchlist_prebuilt as wp
    lists = wp._breadth_lists()
    assert lists
    for lst in lists:
        assert not any(":" in t for t in lst["tickers"]), lst["name"]


def test_legacy_symbol_rows_is_immune_to_every_flag(monkeypatch):
    baseline = bs.legacy_symbol_rows()
    for unis, metrics in (("us", "*"), ("*", "*"), ("nasdaq,nyse", "v1")):
        publish(monkeypatch, unis, metrics)
        assert bs.legacy_symbol_rows() == baseline, (unis, metrics)


# ── PART J · rollback ────────────────────────────────────────────────────────

def test_enable_then_disable_leaves_no_trace_in_discovery(monkeypatch):
    before = bs.list_breadth_symbols()
    publish(monkeypatch, "us")
    assert len(bs.list_breadth_symbols()) == 62
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    bs._avail_cache.update(at=0.0, value=None)
    after = bs.list_breadth_symbols()
    assert after == before
    assert bs.resolve("US:A50") is None
    # and a saved chart pointing at the disabled identity gets the established
    # unavailable answer — empty series, never another universe's numbers
    assert bs.build_breadth_bars("US:A50") == {"ticker": "US:A50", "tf": "D", "bars": []}


def test_a_disabled_identity_never_falls_back_to_uct(monkeypatch):
    publish(monkeypatch, "us")
    served = bs.build_breadth_bars("US:A50")["bars"]
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    assert bs.build_breadth_bars("US:A50")["bars"] == []
    # UCT's own series is unaffected either way
    assert bs.build_breadth_bars("UCTA50")["ticker"] == "UCTA50"
    assert served is not None


# ── PART L · storage may be AHEAD of publication ─────────────────────────────

def test_rows_can_exist_while_the_universe_is_dark_and_become_servable_on_a_flip(
        monkeypatch, tmp_path):
    """⭐ THE LAUNCH STRATEGY IN ONE TEST: grind first, publish later, roll back
    without touching a row."""
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "pubgate.db"))
    store._INIT_DONE = False
    rows = [("2015-03-10", "pct_above_50sma", 57.0, 57.0, 57.0, 57.0)]
    assert store.write_bulk(rows, source="close_recon", universe="us") == 1

    # dark: the rows exist and NOTHING can see them
    assert (store.stats("us") or {}).get("rows") == 1
    assert bs.resolve("US:A50") is None
    assert not any(r.get("universe") == "us" for r in bs.list_breadth_symbols())

    # published: the SAME rows, now reachable, with no DB rewrite
    publish(monkeypatch, "us")
    assert bs.resolve("US:A50") is not None
    assert any(r["symbol"] == "US:A50" for r in bs.list_breadth_symbols())
    assert (store.stats("us") or {}).get("rows") == 1

    # rolled back: the rows are still there, untouched
    monkeypatch.delenv("BREADTH_LIBRARY_UNIVERSES", raising=False)
    assert bs.resolve("US:A50") is None
    assert (store.stats("us") or {}).get("rows") == 1
    store._INIT_DONE = False


# ── PART H · health ──────────────────────────────────────────────────────────

def test_health_reports_a_dark_universe_as_healthy_not_broken():
    """⚠️ A dark universe with no rows is the SHIPPED state. Calling that unhealthy
    would make the signal useless on the day it matters."""
    h = bs.library_health(force=True)
    assert h["ok"] is True
    assert h["publication_set"] == "v1"
    for uid in ("us", "nasdaq", "nyse"):
        row = h["universes"][uid]
        assert row["published"] is False
        assert row["state"] == "not_populated"
        assert row["metrics_published"] == 0
        assert "healthy" not in row        # no claim is made about a dark universe


def test_health_reports_a_published_but_empty_universe_as_UNHEALTHY(monkeypatch, tmp_path):
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "health.db"))
    store._INIT_DONE = False
    publish(monkeypatch, "us")
    bs._health_cache.update(at=0.0, value=None)
    h = bs.library_health(force=True)
    assert h["universes"]["us"]["published"] is True
    assert h["universes"]["us"]["healthy"] is False
    assert h["ok"] is False
    assert h["universes"]["us"]["metrics_published"] == 18
    store._INIT_DONE = False


def test_health_is_not_on_the_serve_path():
    """⛔ `build_breadth_bars` must never call it."""
    import inspect
    src = inspect.getsource(bs.build_breadth_bars)
    assert "library_health" not in src
    assert "_expected_session_gap" not in src
