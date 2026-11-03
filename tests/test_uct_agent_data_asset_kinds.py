"""W1-C C-03 (builder-c) — `index.quote`, `commodity.quote`, `crypto.quote`: dedicated kinds, licence-driven,
an honest decline while no licensed source exists, and the resolver's asset-class ROUTES (parallel to its
§4.7 classes, which do not move). No provider, no model."""
from __future__ import annotations

import time

import pytest

from api.services import provider_licensing_class as plc
from api.services import ticker_search_index as tsi
from api.services.uct_agent.marketdata import asset_classes, asset_quotes, commodity_quote, crypto_quote, index_quote
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import instruments as ins

KINDS = asset_classes.KINDS
ADAPTERS = {"index.quote": index_quote, "commodity.quote": commodity_quote, "crypto.quote": crypto_quote}
ASSET = {"index.quote": "spx", "commodity.quote": "gold", "crypto.quote": "btc"}


@pytest.fixture
def on(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, ",".join(KINDS) + ",instrument.resolve")
    from api.services import massive
    monkeypatch.setattr(massive, "_get_client", lambda: (_ for _ in ()).throw(AssertionError("provider call")))
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def _read(kind, params, turn="t-asset"):
    return gw.read(kind, params, user_id=1, turn_id=turn, purpose="answer")


# ── registration and default state ──────────────────────────────────────────────────────────────────────────────────

def test_three_dedicated_market_kinds_are_registered_default_off(monkeypatch):
    monkeypatch.delenv(gw.KINDS_ENV, raising=False)
    monkeypatch.setenv(gw.DATA_ENV, "1")
    gw._reset_for_test(None)
    d = {k["kind"]: k for k in gw.describe()}
    for kind in KINDS:
        assert d[kind]["category"] == "market" and d[kind]["owner"] == "builder-c" and d[kind]["max_symbols"] == 0
        out = _read(kind, {"asset": ASSET[kind]})
        assert out["status"] == "refused" and gw.KINDS_ENV in out["notes"][0]
    gw._reset_for_test(None)


def test_every_kind_has_a_licensing_row_and_none_is_in_force():
    for kind, mod in ADAPTERS.items():
        assert mod.SOURCES, kind
        for vendor, data_class, _fetch in mod.SOURCES:
            e = plc.entry_for(vendor, data_class)
            assert e.register_row != "n/a", (vendor, data_class, "no explicit licensing row")
            assert e.licensing_class not in asset_quotes.LICENSED, (vendor, data_class, e.licensing_class)
        assert asset_quotes.licensed_source(mod.SOURCES) is None


@pytest.mark.parametrize("kind", KINDS)
def test_an_unknown_asset_is_refused_before_admission_and_spends_nothing(on, kind):
    out = _read(kind, {"asset": "unobtainium"}, turn=f"t-bad-{kind}")
    assert out["status"] == "refused" and "`asset` must be one of" in out["notes"][0]
    assert env.validate_envelope(out) == []
    assert gw._turns.get((1, f"t-bad-{kind}")) is None          # not admitted: no turn row was opened


@pytest.mark.parametrize("kind", KINDS)
def test_without_a_licensed_source_the_read_is_an_honest_decline_never_a_guess(on, kind):
    out = _read(kind, {"asset": ASSET[kind]})
    assert env.validate_envelope(out) == []
    assert out["status"] == "refused" and out["data"] is None and out["provider_calls"] == 0
    assert out["notes"] == [f"I don't have a licensed source for {asset_classes.CLASS_WORDS[kind]}, so no figure is stated"]
    assert out["source"] == "uct-agent-" + kind


def test_a_licensed_source_is_served_as_a_normal_envelope(on, monkeypatch):
    """The served path, proven with a FAKE client once a row is A/LA: the source's own as_of and freshness."""
    calls = []

    def fetch(asset):
        calls.append(asset)
        return {"value": 6812.34, "change": 27.1, "change_pct": 0.4, "previous_close": 6785.24,
                "as_of": "2026-11-02T15:30:00Z", "freshness": "delayed", "delay_s": 900, "provider_calls": 1}
    monkeypatch.setitem(plc._TABLE, ("massive", "indices"), plc.LicensingClassEntry("LA", "test", "T-72"))
    monkeypatch.setattr(index_quote, "SOURCES", [("massive", "indices", fetch)])
    out = _read("index.quote", {"asset": "spx"})
    assert env.validate_envelope(out) == []
    assert out["status"] == "ok" and out["freshness"] == "delayed" and out["delay_s"] == 900
    assert out["as_of"] == "2026-11-02T15:30:00Z" and out["source"] == "massive" and out["provider_calls"] == 1
    assert out["data"]["label"] == "S&P 500" and out["data"]["value"] == 6812.34
    assert calls == ["spx"]
    # a source that fails is an honest unavailable, never a number
    monkeypatch.setattr(index_quote, "SOURCES", [("massive", "indices", lambda a: (_ for _ in ()).throw(RuntimeError("x")))])
    bad = _read("index.quote", {"asset": "spx"}, turn="t-fail")
    assert bad["status"] == "unavailable" and bad["data"] is None and env.validate_envelope(bad) == []


def test_the_fetchers_are_never_called_while_their_rows_are_out_of_force(on, monkeypatch):
    def boom(_asset):
        raise AssertionError("a fetch ran without a licensed row")
    for kind, mod in ADAPTERS.items():
        monkeypatch.setattr(mod, "SOURCES", [(v, c, boom) for v, c, _f in mod.SOURCES])
        assert _read(kind, {"asset": ASSET[kind]}, turn=f"t-nf-{kind}")["status"] == "refused"


# ── the resolver's routes (MD-1 §4.7 classes untouched) ─────────────────────────────────────────────────────────────

ROWS = [("NVDA", "NVIDIA Corporation", "stock"), ("GOLD", "Barrick Mining Corporation", "stock"),
        ("BTC", "Grayscale Bitcoin Mini Trust ETF", "etf"), ("DOW", "Dow Inc.", "stock"), ("ETH", "Grayscale Ethereum Mini Trust", "etf"),
        ("SPX", "S&P 500 Index", "index"), ("BTCO", "Invesco Galaxy Bitcoin ETF", "etf")]


def _seed(monkeypatch, rows=ROWS):
    idx = [{"sym": s, "name": n, "name_lc": n.lower(), "type": t, "exch": "XNAS", "entity_id": None} for s, n, t in sorted(rows)]
    monkeypatch.setattr(tsi, "_INDEX", idx)
    monkeypatch.setattr(tsi, "_BY_SYM", {r["sym"]: r for r in idx})
    monkeypatch.setattr(tsi, "_BUILT_AT", time.time() - 3600)
    monkeypatch.setattr(tsi, "_LIQ", {})


def _resolve(*entries):
    return gw.read("instrument.resolve", {"symbols": [{"text": t, "form": f} for t, f in entries]}, user_id=1, turn_id="t-route")


@pytest.mark.parametrize("text,form,klass,route", [
    ("gold", "lower", "symbol_typed_lowercase", ("commodity.quote", "gold", "gold")),     # §4.7.5 L3: still the ask; plus the route
    ("$gold", "cashtag", "symbol_typed_lowercase", ("commodity.quote", "gold", "gold")),
    ("GOLD", "upper", "symbol", None),                                                     # explicit capitals: the member's ticker, no route
    ("$BTC", "cashtag", "symbol", None),
    ("btc", "lower", "symbol_typed_lowercase", ("crypto.quote", "btc", "Bitcoin")),
    ("bitcoin", "lower", "unknown", ("crypto.quote", "btc", "Bitcoin")),                   # not a symbol at all: unknown + the route
    ("eth", "lower", "symbol_typed_lowercase", ("crypto.quote", "eth", "Ether")),
    ("dow", "lower", "symbol_typed_lowercase", ("index.quote", "dji", "Dow Jones Industrial Average")),
    ("spx", "lower", "non_equity", ("index.quote", "spx", "S&P 500")),
    ("SPX", "upper", "non_equity", ("index.quote", "spx", "S&P 500")),                     # an index however typed
    ("s&p", "lower", "unknown", ("index.quote", "spx", "S&P 500")),
    ("nasdaq", "lower", "unknown", ("index.quote", "ixic", "Nasdaq Composite")),
    ("oil", "lower", "unknown", ("commodity.quote", "crude", "crude oil")),
    ("crude", "lower", "unknown", ("commodity.quote", "crude", "crude oil")),
    ("nvda", "lower", "symbol", None),
    ("NVDA", "upper", "symbol", None),
])
def test_the_resolver_routes_asset_words_without_moving_their_class(on, monkeypatch, text, form, klass, route):
    _seed(monkeypatch)
    out = _resolve((text, form))
    assert out["status"] == "ok", out["notes"]
    (r,) = out["data"]["results"]
    (rt,) = out["data"]["routes"]
    assert r["class"] == klass, r
    assert "route" not in r                                    # the per-result shape (and the client fixture) is unchanged
    assert rt == ({"kind": route[0], "asset": route[1], "label": route[2]} if route else None)


def test_routes_are_parallel_to_results_and_never_make_all_symbols_true(on, monkeypatch):
    _seed(monkeypatch)
    out = _resolve(("NVDA", "upper"), ("gold", "lower"), ("bitcoin", "lower"))
    d = out["data"]
    assert len(d["routes"]) == len(d["results"]) == 3
    assert d["routes"][0] is None and d["routes"][1]["kind"] == "commodity.quote" and d["routes"][2]["kind"] == "crypto.quote"
    assert d["all_symbols"] is False                              # a routed word is still not a priced symbol


def test_an_ampersand_word_passes_validation_only_as_an_asset_word(on, monkeypatch):
    _seed(monkeypatch)
    assert ins.validate({"symbols": [{"text": "s&p", "form": "lower"}]}) is None
    assert ins.validate({"symbols": [{"text": "at&t", "form": "lower"}]}) is not None    # not an asset word: refused as before


def test_the_vocabulary_names_every_word_the_board_row_lists():
    for w in ("gold", "oil", "crude", "s&p", "spx", "nasdaq", "dow", "btc", "bitcoin", "eth"):
        assert asset_classes.lookup(w) is not None, w
    assert asset_classes.lookup("$Gold")["kind"] == "commodity.quote"
    assert asset_classes.lookup("nvda") is None
    for kind in KINDS:
        assert asset_classes.assets_of(kind)
