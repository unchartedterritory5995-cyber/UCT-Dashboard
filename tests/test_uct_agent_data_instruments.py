"""MD-1 `instrument.resolve` (owner agent-md) — MD-1 v1.5 §4.7, over the REAL ticker_search_index module, seeded with
fixture rows in its own in-memory shape (no Massive build, no provider, no network)."""
from __future__ import annotations

import time

import pytest

from api.services import ticker_search_index as tsi
from api.services.uct_agent.marketdata import envelope as env
from api.services.uct_agent.marketdata import gateway as gw
from api.services.uct_agent.marketdata import instruments as ins

ROWS = [
    ("AAPL", "Apple Inc.", "stock"), ("APLE", "Apple Hospitality REIT, Inc.", "stock"),
    ("NVDA", "NVIDIA Corporation", "stock"), ("MSFT", "Microsoft Corporation", "stock"),
    ("GOLD", "Barrick Gold Corporation", "stock"), ("BTC", "Grayscale Bitcoin Mini Trust", "etf"),
    ("IBIT", "iShares Bitcoin Trust ETF", "etf"), ("SPY", "SPDR S&P 500 ETF Trust", "etf"),
    ("SPX", "S&P 500 Index", "index"), ("AI_INFRA", "AI Infrastructure", "theme"),
    ("BRK-B", "Berkshire Hathaway Inc. Class B", "stock"), ("IT", "Gartner, Inc.", "stock"),
    ("ES", "Eversource Energy", "stock"), ("ZNTH", "Zenith Corp", "stock"), ("ZNTX", "Zenith Holdings", "stock"),
    ("ESGU", "iShares ESG Aware MSCI USA ETF", "etf"),
]


def _seed(monkeypatch, rows=ROWS, built=None):
    idx = [{"sym": s, "name": n, "name_lc": n.lower(), "type": t, "exch": "XNAS", "entity_id": None}
           for s, n, t in sorted(rows)]
    monkeypatch.setattr(tsi, "_INDEX", idx)
    monkeypatch.setattr(tsi, "_BY_SYM", {r["sym"]: r for r in idx})
    monkeypatch.setattr(tsi, "_BUILT_AT", time.time() - 3600 if built is None else built)
    monkeypatch.setattr(tsi, "_LIQ", {})


@pytest.fixture(autouse=True)
def _gateway(monkeypatch):
    monkeypatch.setenv(gw.DATA_ENV, "1")
    monkeypatch.setenv(gw.KINDS_ENV, "instrument.resolve")
    # a resolve must never reach a provider: make any Massive client creation explode
    from api.services import massive
    monkeypatch.setattr(massive, "_get_client", lambda: (_ for _ in ()).throw(AssertionError("provider call")))
    gw._reset_for_test(None)
    yield
    gw._reset_for_test(None)


def _resolve(*entries):
    return gw.read("instrument.resolve", {"symbols": [{"text": t, "form": f} for t, f in entries]},
                   user_id=1, turn_id="t-ins")


def test_registered_with_its_declaration():
    d = {x["kind"]: x for x in gw.describe()}["instrument.resolve"]
    assert d["owner"] == "agent-md" and d["freshness"] == "periodic" and d["max_symbols"] == ins.MAX_TOKENS


@pytest.mark.parametrize("text,form,klass,symbol,candidate", [
    ("NVDA", "upper", "symbol", "NVDA", None),
    ("$nvda", "cashtag", "symbol", "NVDA", None),
    ("IT", "upper", "symbol", "IT", None),                                  # an English word, typed as a symbol
    ("BTC", "upper", "symbol", "BTC", None),                                # agent-lead (c): UPPERCASE is explicit
    ("brk.b", "lower", "symbol", "BRK-B", None),                             # share class: dot or hyphen (§4.7.5)
    ("BRK.B", "upper", "symbol", "BRK-B", None),
    ("nvda", "lower", "symbol", "NVDA", None),                               # confirmed by §4.7.5
    ("gold", "lower", "symbol_typed_lowercase", None, "GOLD"),              # Barrick's ticker, never "the price of gold"
    ("btc", "lower", "symbol_typed_lowercase", None, "BTC"),
    ("es", "lower", "symbol_typed_lowercase", None, "ES"),                  # §4.7.5: ESGU shares the root
    ("apple", "lower", "name_match", None, "AAPL"),                         # one stock named exactly that
    ("microsoft", "lower", "name_match", None, "MSFT"),
    ("SPX", "upper", "non_equity", None, None),                             # an index, not tradable here
    ("spx", "lower", "non_equity", None, None),
    ("AI_INFRA", "upper", "unknown", None, None),                           # not a word the client can send (validate)
    ("nvdia", "lower", "unknown", None, None),                              # a misspelling: no guess
    ("bitcoin", "lower", "unknown", None, None),                            # no name is exactly "bitcoin"
    ("zenith", "lower", "unknown", None, None),                             # TWO names normalise to "zenith"
    ("$NVDIA", "cashtag", "unknown", None, None),                           # a named symbol that does not exist
    ("$apple", "cashtag", "unknown", None, None),                           # `$` names a SYMBOL: never a name match
])
def test_each_word_gets_exactly_one_class_from_the_index(monkeypatch, text, form, klass, symbol, candidate):
    _seed(monkeypatch)
    if text == "AI_INFRA":
        assert ins.validate({"symbols": [{"text": text, "form": form}]}) is not None
        return
    out = _resolve((text, form))
    assert env.validate_envelope(out) == [], env.validate_envelope(out)
    assert out["status"] == "ok" and out["freshness"] == "periodic" and out["provider_calls"] == 0
    (r,) = out["data"]["results"]
    assert r["class"] == klass and r["class"] in ins.CLASSES
    assert r["symbol"] == symbol
    assert (r["candidate"] or {}).get("symbol") == candidate
    if klass == "symbol":
        assert r["name"] and r["type"] in ins.EQUITY_TYPES                  # every priced security can be named
    if klass in ("symbol_typed_lowercase", "name_match"):
        assert r["candidate"]["name"]                       # recorded for audit; the member is never shown it (#691)


def test_all_symbols_is_all_or_nothing(monkeypatch):
    _seed(monkeypatch)
    ok = _resolve(("NVDA", "upper"), ("$amd", "cashtag"), ("MSFT", "upper"))
    assert [r["class"] for r in ok["data"]["results"]] == ["symbol", "unknown", "symbol"]   # AMD not in the fixture
    assert ok["data"]["all_symbols"] is False
    both = _resolve(("NVDA", "upper"), ("MSFT", "upper"))
    assert both["data"]["all_symbols"] is True
    mixed = _resolve(("NVDA", "upper"), ("apple", "lower"))
    assert mixed["data"]["all_symbols"] is False


@pytest.mark.parametrize("state", ["empty", "raises"])
def test_a_cold_or_unreadable_index_is_unavailable_never_a_class(monkeypatch, state):
    if state == "empty":
        monkeypatch.setattr(tsi, "_INDEX", [])
        monkeypatch.setattr(tsi, "_BY_SYM", {})
    else:
        monkeypatch.setattr(tsi, "ready", lambda: (_ for _ in ()).throw(RuntimeError("x")))
    out = _resolve(("NVDA", "upper"))
    assert env.validate_envelope(out) == []
    assert out["status"] == "unavailable" and out["data"] is None and out["notes"] == [ins.NOTE_INDEX_NOT_READY]


def test_as_of_is_the_index_build_time_and_an_old_index_is_stale(monkeypatch):
    built = time.time() - ins.INDEX_STALE_S - 60
    _seed(monkeypatch, built=built)
    out = _resolve(("NVDA", "upper"))
    assert out["as_of"] == env.utc_iso(__import__("datetime").datetime.fromtimestamp(built, __import__("datetime").timezone.utc))
    assert out["stale"] is True
    _seed(monkeypatch)
    assert _resolve(("NVDA", "upper"))["stale"] is False


@pytest.mark.parametrize("params,why", [
    ({}, "list"), ({"symbols": []}, "list"), ({"symbols": "NVDA"}, "list"),
    ({"symbols": [{"text": "NVDA"}]}, "{text, form}"),
    ({"symbols": [{"text": "NVDA", "form": "bold"}]}, "form"),
    ({"symbols": [{"text": "two words", "form": "lower"}]}, "could be a symbol"),
    ({"symbols": [{"text": f"A{i}", "form": "upper"} for i in range(6)]}, "at most"),
])
def test_malformed_requests_are_refused_before_admission_with_no_budget(monkeypatch, params, why):
    _seed(monkeypatch)
    out = gw.read("instrument.resolve", params, user_id=1, turn_id="t-bad")
    assert out["status"] == "refused" and why in out["notes"][0]
    # nothing was spent: 8 good reads still fit in the same turn
    for _ in range(8):
        assert gw.read("instrument.resolve", {"symbols": [{"text": "NVDA", "form": "upper"}]},
                       user_id=1, turn_id="t-bad")["status"] == "ok"


def test_resolve_plus_quote_for_five_symbols_fits_the_turn_budget(monkeypatch):
    # agent-lead: the resolve read counts toward the 8-read limit; one 5-symbol compound costs 2 reads
    _seed(monkeypatch)
    monkeypatch.setenv(gw.KINDS_ENV, "instrument.resolve,quotes")
    from api.services.uct_agent.marketdata import quotes as q
    monkeypatch.setattr(q, "_fetch", lambda syms: ({s: {"lastTrade": {"p": 10.0}, "_observed_at": time.time()} for s in syms}, 1, None))
    five = [("NVDA", "upper"), ("MSFT", "upper"), ("AAPL", "upper"), ("SPY", "upper"), ("GOLD", "upper")]
    for i in range(4):                                    # four such questions = 8 reads, all admitted
        r = gw.read("instrument.resolve", {"symbols": [{"text": t, "form": f} for t, f in five]}, user_id=1, turn_id="t-5")
        assert r["status"] == "ok" and r["data"]["all_symbols"] is True
        p = gw.read("quotes", {"symbols": [t for t, _ in five]}, user_id=1, turn_id="t-5")
        assert p["status"] in ("ok", "partial"), (i, p["notes"])
    assert gw.read("instrument.resolve", {"symbols": [{"text": "NVDA", "form": "upper"}]}, user_id=1,
                   turn_id="t-5")["status"] == "refused"   # the ninth read is over budget


def test_only_the_index_public_read_api_is_used():
    import re
    src = __import__("inspect").getsource(ins)
    # no private attribute of the index (idx._x / ticker_search_index._x), no rebuild, no provider module
    assert not re.search(r"(?<![A-Za-z0-9_])(idx|ticker_search_index)\._", src)
    assert "build_index" not in src and "start_background_build" not in src
    assert not re.search(r"import massive|massive\.", src)


# ── held to the SAME doc and the SAME index as the client (agentDataResolve.test.js) ────────────────────────────────
import json as _json
import pathlib as _pl
import re as _re

_ROOT = _pl.Path(__file__).resolve().parents[1]
_SHARED = _json.loads((_ROOT / "app/src/agent/marketdata/__fixtures__/symbol-index.json").read_text(encoding="utf-8"))
_DOC = (_ROOT / "docs/agent/program/contracts/MD-1-phrasings.md").read_text(encoding="utf-8")


def _doc_rows():
    out = []
    for line in _DOC.splitlines():
        if not _re.match(r"^\| P\d\d \|", line):
            continue
        c = [x.strip() for x in line.split("|")]
        if c[4] == "—":
            continue
        cands = [(t.rsplit(":", 1)[0], t.rsplit(":", 1)[1]) for t in _re.findall(r"`([^`]+)`", c[4])[0].split(" ")]
        out.append((c[1], cands, c[5]))
    return out


def _outcome(results):
    """MD-1 §4.7.3 precedence, from the server's classes alone."""
    for k in ("non_equity", "unknown"):
        if any(r["class"] == k for r in results):
            return "limit"
    for k in ("name_match", "symbol_typed_lowercase"):
        hit = next((r for r in results if r["class"] == k), None)
        if hit:
            return f"ask:{hit['candidate']['symbol']}"
    return "price-or-bars"


@pytest.mark.parametrize("rid,cands,want", _doc_rows(), ids=[r[0] for r in _doc_rows()])
def test_the_server_classes_give_the_doc_outcome_for_every_claimed_row(monkeypatch, rid, cands, want):
    _seed(monkeypatch, rows=[tuple(r) for r in _SHARED["rows"]])
    out = _resolve(*cands)
    assert out["status"] == "ok", out["notes"]
    got = _outcome(out["data"]["results"])
    assert got == ("price-or-bars" if want in ("price", "bars") else want), (rid, out["data"]["results"])
    if want in ("price", "bars"):
        assert out["data"]["all_symbols"] is True and all(r["name"] for r in out["data"]["results"])


def test_the_doc_has_every_server_class_in_its_claimed_rows(monkeypatch):
    _seed(monkeypatch, rows=[tuple(r) for r in _SHARED["rows"]])
    seen = set()
    for _rid, cands, _want in _doc_rows():
        # the adapter directly: one gateway turn holds only 8 reads, and this walks every claimed row
        e = ins.read_instruments({"symbols": [{"text": t, "form": f} for t, f in cands]}, {})
        seen |= {r["class"] for r in e["data"]["results"]}
    assert seen == set(ins.CLASSES)


# ── §4.7.5: a LOWERCASE ticker is priced only when the index confirms it ─────────────────────────────────────────────
LROWS = ROWS + [
    ("TSLA", "Tesla, Inc.", "stock"), ("AMD", "Advanced Micro Devices, Inc.", "stock"),
    ("GOOGL", "Alphabet Inc. Class A", "stock"), ("GOOG", "Alphabet Inc. Class C", "stock"),
    ("META", "Meta Platforms, Inc.", "stock"), ("KEY", "KeyCorp", "stock"), ("DOW", "Dow Inc.", "stock"),
    ("GLD", "SPDR Gold Shares", "etf"), ("DIA", "SPDR Dow Jones Industrial Average ETF Trust", "etf"),
    ("FBTC", "Fidelity Wise Origin Bitcoin Fund", "etf"), ("ETH", "Grayscale Ethereum Mini Trust", "etf"),
    ("ETHA", "iShares Ethereum Trust ETF", "etf"), ("SOL", "Emeren Group Ltd", "stock"),
    ("SOLZ", "Volatility Shares Solana ETF", "etf"), ("NVDL", "GraniteShares 2x Long NVDA Daily ETF", "etf"),
    ("NVDAU", "T-Rex 2X Long NVDA Daily Target ETF", "etf"), ("ESGU", "iShares ESG Aware MSCI USA ETF", "etf"),
    ("WDGT", "Widgetco Inc. Class A", "stock"), ("WDGTB", "Widgetco Inc. Class B", "stock"),
]


@pytest.mark.parametrize("token,want_symbol,basis", [
    # confirmed: a stock, its ticker spells its own name, nothing in the index collides
    ("nvda", "NVDA", None),          # NVDL / NVDAU name "NVDA" as a ticker: the same family, not a collision
    ("tsla", "TSLA", None),
    ("aapl", "AAPL", None),          # a doubled letter counts once ("Apple"); APLE is a different symbol, no collision
    ("msft", "MSFT", None),
    ("amd", "AMD", None),
    ("brk.b", "BRK-B", None),        # share class: dot or hyphen
    ("wdgt", "WDGT", None),          # WDGTB contains WDGT but is a share-class sibling (same company name)
    # not confirmed → the neutral ask; `basis` names every failed check
    ("spy", "SPY", ["fund", "not_an_abbreviation"]),
    ("btc", "BTC", ["fund"]),                                   # L1 (FBTC ends with the root: not a prefix)
    ("eth", "ETH", ["fund", "name_word", "symbol_root"]),       # L1; "Ethereum" starts with eth; ETHA
    ("sol", "SOL", ["not_an_abbreviation", "symbol_root"]),     # "Emeren Group Ltd" has no s; SOLZ
    ("gold", "GOLD", ["name_word"]),                            # Barrick Gold, SPDR Gold Shares
    ("dow", "DOW", ["name_word"]),                              # Dow Inc., SPDR Dow Jones
    ("key", "KEY", ["name_word"]),                              # the start of its own name, KeyCorp
    ("meta", "META", ["name_word"]),                            # a whole word of its own name
    ("googl", "GOOGL", ["not_an_abbreviation"]),                # "Alphabet" is not spelled by googl
    ("es", "ES", ["symbol_root"]),                              # ESGU: an unrelated symbol shares the root
])
def test_a_lowercase_ticker_is_priced_only_when_the_index_confirms_it(monkeypatch, token, want_symbol, basis):
    _seed(monkeypatch, rows=LROWS)
    (r,) = _resolve((token, "lower"))["data"]["results"]
    if basis is None:
        assert r["class"] == "symbol" and r["symbol"] == want_symbol and r["name"], r
        assert r["basis"] == [ins.BASIS_CONFIRMED]
        assert r["type"] == "stock"                                          # L1: never a fund
    else:
        assert r["class"] == "symbol_typed_lowercase" and r["symbol"] is None, r
        assert r["candidate"]["symbol"] == want_symbol
        assert r["basis"] == basis
        assert set(r["basis"]) <= set(ins.BASIS_CHECKS)


def test_typed_forms_never_carry_a_lowercase_basis(monkeypatch):
    _seed(monkeypatch, rows=LROWS)
    for t, f in (("NVDA", "upper"), ("$GOLD", "cashtag"), ("BTC", "upper"), ("$BTC", "cashtag")):
        (r,) = _resolve((t, f))["data"]["results"]
        assert r["class"] == "symbol" and r["basis"] is None


@pytest.mark.parametrize("text,klass,basis", [
    ("$nvda", "symbol", ["lowercase_confirmed"]),                      # confirmed like the bare word
    ("$sol", "symbol_typed_lowercase", ["not_an_abbreviation", "symbol_root"]),
    ("$btc", "symbol_typed_lowercase", ["fund"]),
    ("$eth", "symbol_typed_lowercase", ["fund", "name_word", "symbol_root"]),
    ("$Gold", "symbol_typed_lowercase", ["name_word"]),                  # mixed case is not "in capitals"
    ("$SOL", "symbol", None),                                            # all capitals: the member's explicit choice
])
def test_a_lowercase_cashtag_takes_the_same_checks_as_the_bare_word(monkeypatch, text, klass, basis):
    _seed(monkeypatch, rows=LROWS)
    (r,) = _resolve((text, "cashtag"))["data"]["results"]
    assert (r["class"], r["basis"]) == (klass, basis), r


def test_consistency_controls_each_check_can_fire(monkeypatch):
    # the same rows that let nvda / wdgt resolve, made UNRELATED, must block them (non-vacuity of _consistent)
    rows = [r for r in LROWS if r[0] not in ("NVDAU", "WDGTB")]
    _seed(monkeypatch, rows=rows + [("NVDAU", "Unrelated Acquisition Corp", "stock"),
                                    ("WDGTB", "Other Thing Corp", "stock")])
    (n,) = _resolve(("nvda", "lower"))["data"]["results"]
    assert n["class"] == "symbol_typed_lowercase" and n["basis"] == ["symbol_root"]
    (w,) = _resolve(("wdgt", "lower"))["data"]["results"]
    assert w["class"] == "symbol_typed_lowercase" and w["basis"] == ["symbol_root"]


def test_capitals_in_an_all_caps_name_are_not_a_ticker_reference(monkeypatch):
    base = [("PLRX", "Polarex Inc.", "stock")]
    _seed(monkeypatch, rows=base + [("ZZY", "Income Fund for PLRX Holders", "etf")])
    (ok,) = _resolve(("plrx", "lower"))["data"]["results"]
    assert ok["class"] == "symbol"                                      # mixed-case name: PLRX is a ticker reference
    _seed(monkeypatch, rows=base + [("ZZY", "PLRX MINING ACQUISITION CORP", "stock")])
    (no,) = _resolve(("plrx", "lower"))["data"]["results"]
    assert no["class"] == "symbol_typed_lowercase" and no["basis"] == ["name_word"]


def test_a_capped_scan_is_never_read_as_no_collision(monkeypatch):
    _seed(monkeypatch, rows=LROWS)
    monkeypatch.setattr(ins, "SCAN_LIMIT", 2)
    (r,) = _resolve(("nvda", "lower"))["data"]["results"]           # NVDA + NVDL + NVDAU fill the cap
    assert r["class"] == "symbol_typed_lowercase" and r["basis"] == ["scan_incomplete"]


def test_adding_rows_never_turns_an_ask_into_a_price(monkeypatch):
    """§4.7.5 fail-safe direction: from the base fixture, add each extra row alone; no lowercase ask may resolve."""
    tokens = ["nvda", "tsla", "aapl", "msft", "amd", "brk.b", "spy", "btc", "gold", "es", "wdgt"]
    base = [r for r in LROWS if r[0] in {"NVDA", "TSLA", "AAPL", "MSFT", "AMD", "BRK-B", "SPY", "BTC", "GOLD", "ES",
                                         "WDGT"}]
    _seed(monkeypatch, rows=base)
    before = {t: ins.classify(t, "lower", tsi)["class"] for t in tokens}
    flips = 0
    for extra in [r for r in LROWS if r not in base]:
        _seed(monkeypatch, rows=base + [extra])
        for t in tokens:
            now = ins.classify(t, "lower", tsi)["class"]
            assert not (before[t] == "symbol_typed_lowercase" and now == "symbol"), (t, extra)
            flips += before[t] == "symbol" and now == "symbol_typed_lowercase"
    assert flips > 0                                                    # control: some added row DID add a collision


def test_a_token_inside_a_symbol_or_a_same_company_derivative_is_not_a_root(monkeypatch):
    base = [("NVDA", "Nvidia Corp", "stock"), ("AMD", "Advanced Micro Devices", "stock")]
    _seed(monkeypatch, rows=base + [("NVDACW", "Cboe NVIDIA Call Writing Index", "index"),   # names the company
                                    ("BAMD", "Brookstone Dividend Stock ETF", "etf")])        # AMD inside, not a root
    assert [r["class"] for r in _resolve(("nvda", "lower"), ("amd", "lower"))["data"]["results"]] == ["symbol"] * 2
    # control: the same root on an instrument that does not name the company IS a collision
    _seed(monkeypatch, rows=base + [("NVDACW", "Cboe Semiconductor Call Writing Index", "index"),
                                    ("AMDX", "Brookstone Dividend Stock ETF", "etf")])
    got = _resolve(("nvda", "lower"), ("amd", "lower"))["data"]["results"]
    assert [(r["class"], r["basis"]) for r in got] == [("symbol_typed_lowercase", ["symbol_root"])] * 2


# ── the PRODUCTION index, probed read-only by agent-lead through /api/ticker-search (2026-11-02) ─────────────────────
_PROBE = _json.loads((_ROOT / "app/src/agent/marketdata/__fixtures__/prod-index-probe.json").read_text(encoding="utf-8"))
_PROD_PRICED = "nvda tsla aapl msft amd brk.b amzn nflx pltr intc smci crwd xom".split()
_PROD_ASK = "avgo jpm ibm gold dow meta key coin roku snow shop spot uber btc eth spy qqq iwm gld googl".split()


def _probe_rows(token):
    rows = {}
    for q, rs in _PROBE[token].items():
        if isinstance(rs, list):
            for r in rs:
                if r.get("type") in ins.EQUITY_TYPES + ins.NON_EQUITY_TYPES:   # drop the endpoint's non-index sources
                    rows[r["ticker"]] = (r["ticker"], r.get("name") or "", r["type"])
    return sorted(rows.values())


def test_the_probe_covers_every_listed_token():
    assert set(_PROD_PRICED) | set(_PROD_ASK) | {"sol"} == {k for k in _PROBE if k != "_meta"}


@pytest.mark.parametrize("token", _PROD_PRICED + _PROD_ASK + ["sol"])
def test_production_rows_give_the_expected_outcome(monkeypatch, token):
    _seed(monkeypatch, rows=_probe_rows(token))
    (r,) = _resolve((token, "lower"))["data"]["results"]
    if token in _PROD_PRICED:
        assert r["class"] == "symbol" and r["type"] == "stock", r
    elif token == "sol":
        assert r["class"] == "unknown"                                   # production holds no SOL row
    else:
        assert r["class"] == "symbol_typed_lowercase" and r["basis"], r
