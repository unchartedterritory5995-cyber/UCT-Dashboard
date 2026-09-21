"""The screener's own (wider) universe — loader precedence, buyout exclusion,
and the Massive-reference generator. No network: massive + cap_universe are
monkeypatched."""
import json
import pytest

from api.services.screener import screener_universe as su


@pytest.fixture(autouse=True)
def _isolate(tmp_path, monkeypatch):
    # Point every path this module can resolve at the sandbox so a test never
    # reads the real /data volume or the committed fallback.
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "data"))
    monkeypatch.delenv("SCREENER_UNIVERSE_PATH", raising=False)
    (tmp_path / "data").mkdir(parents=True, exist_ok=True)
    yield


def test_symbols_reads_the_override_file_first(tmp_path, monkeypatch):
    f = tmp_path / "u.json"
    f.write_text(json.dumps(["nvda", "AAPL", "aapl", "MSFT"]))
    monkeypatch.setenv("SCREENER_UNIVERSE_PATH", str(f))
    # upper-cased, de-duped, sorted
    assert su.symbols() == ["AAPL", "MSFT", "NVDA"]


def test_symbols_falls_back_to_cap_universe_when_no_file(monkeypatch):
    # No screener file anywhere → the app-wide cap universe (== old behaviour).
    monkeypatch.setattr("api.services.cap_universe.symbols",
                        lambda: frozenset({"SPY", "QQQ", "IWM"}))
    assert su.symbols() == ["IWM", "QQQ", "SPY"]


def test_buyout_excludes_ships_seeded_and_nonempty():
    excl = su.buyout_excludes()
    assert "ACA" in excl and "OGN" in excl        # from the seed list
    assert len(excl) >= 10                          # a real list shipped, not empty


def _fake_ref(rows):
    return lambda active=True, market="stocks": rows


def test_build_keeps_only_common_and_adr_drops_etf_pfd_etc(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_UNIVERSE_PATH", str(tmp_path / "out.json"))
    monkeypatch.setattr("api.services.massive.list_reference_tickers", _fake_ref([
        {"ticker": "AAA", "type": "CS"},        # common → keep
        {"ticker": "BBB", "type": "ADRC"},      # ADR → keep
        {"ticker": "CCC", "type": "ETF"},       # ETF → drop
        {"ticker": "DDD", "type": "PFD"},       # preferred → drop
        {"ticker": "EEE", "type": "WARRANT"},   # warrant → drop
    ]))
    # Everything traded heavily, no buyouts among them, empty core.
    monkeypatch.setattr("api.services.massive.get_grouped_daily_ohlcv",
                        lambda day, adjusted=False: {"AAA": {"v": 1e6}, "BBB": {"v": 1e6},
                                                     "CCC": {"v": 1e6}, "DDD": {"v": 1e6},
                                                     "EEE": {"v": 1e6}})
    monkeypatch.setattr("api.services.cap_universe.symbols", lambda: frozenset())
    monkeypatch.setattr(su, "buyout_excludes", lambda: frozenset())

    out = su.build_and_save(min_shares=1000, sessions=1)
    assert out["ok"] is True
    assert out["reference_cs_adr"] == 2
    assert su.symbols() == ["AAA", "BBB"]        # ETF/PFD/WARRANT gone


def test_build_keeps_curated_core_names_the_reference_ENUMERATION_MISSED(tmp_path, monkeypatch):
    # Regression: `list_reference_tickers` is incomplete (real names like AL/AMWD
    # are absent from it), so a cap_universe common stock the reference omits must
    # still be kept — the reference alone is NOT the universe.
    monkeypatch.setenv("SCREENER_UNIVERSE_PATH", str(tmp_path / "out.json"))
    monkeypatch.setattr("api.services.massive.list_reference_tickers", _fake_ref([
        {"ticker": "NEWADR", "type": "ADRC"},   # in ref → keep (traded)
    ]))
    monkeypatch.setattr("api.services.massive.get_grouped_daily_ohlcv",
                        lambda day, adjusted=False: {"NEWADR": {"v": 1e6}})
    # AL is NOT in the reference at all, but IS a curated core equity.
    monkeypatch.setattr("api.services.cap_universe.symbols", lambda: frozenset({"AL"}))
    monkeypatch.setattr("api.services.cap_universe.etf_symbols", lambda: frozenset())
    monkeypatch.setattr(su, "buyout_excludes", lambda: frozenset())

    out = su.build_and_save(min_shares=1000, sessions=1)
    assert out["core_added"] == 1
    assert su.symbols() == ["AL", "NEWADR"]      # the reference-missing core name survived


def test_build_excludes_etfs_and_funds_even_from_core(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_UNIVERSE_PATH", str(tmp_path / "out.json"))
    monkeypatch.setattr("api.services.massive.list_reference_tickers", _fake_ref([
        {"ticker": "REALCS", "type": "CS"},
        {"ticker": "ARKK", "type": "ETF"},      # reference says ETF → drop
    ]))
    monkeypatch.setattr("api.services.massive.get_grouped_daily_ohlcv",
                        lambda day, adjusted=False: {"REALCS": {"v": 1e6}, "ARKK": {"v": 1e6}, "SPY": {"v": 1e6}})
    # SPY sits in cap_universe core AND the prebuilt-ETF list → must be dropped.
    monkeypatch.setattr("api.services.cap_universe.symbols", lambda: frozenset({"REALCS", "SPY", "ARKK"}))
    monkeypatch.setattr("api.services.cap_universe.etf_symbols", lambda: frozenset({"SPY"}))
    monkeypatch.setattr(su, "buyout_excludes", lambda: frozenset())

    su.build_and_save(min_shares=1000, sessions=1)
    assert su.symbols() == ["REALCS"]            # ARKK (ref ETF) + SPY (etf list) gone


def test_build_drops_dead_shells_but_keeps_curated_core(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_UNIVERSE_PATH", str(tmp_path / "out.json"))
    monkeypatch.setattr("api.services.massive.list_reference_tickers", _fake_ref([
        {"ticker": "LIVE", "type": "CS"},      # trades → keep
        {"ticker": "DEAD", "type": "CS"},      # never trades → drop
        {"ticker": "CORE", "type": "CS"},      # never trades BUT in cap universe → keep
    ]))
    monkeypatch.setattr("api.services.massive.get_grouped_daily_ohlcv",
                        lambda day, adjusted=False: {"LIVE": {"v": 500_000}, "DEAD": {"v": 0}})
    monkeypatch.setattr("api.services.cap_universe.symbols", lambda: frozenset({"CORE"}))
    monkeypatch.setattr(su, "buyout_excludes", lambda: frozenset())

    su.build_and_save(min_shares=1000, sessions=1)
    assert su.symbols() == ["CORE", "LIVE"]     # DEAD dropped, CORE survived on the core rule


def test_build_subtracts_buyouts(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_UNIVERSE_PATH", str(tmp_path / "out.json"))
    monkeypatch.setattr("api.services.massive.list_reference_tickers", _fake_ref([
        {"ticker": "KEEP", "type": "CS"},
        {"ticker": "BOUGHT", "type": "CS"},
    ]))
    monkeypatch.setattr("api.services.massive.get_grouped_daily_ohlcv",
                        lambda day, adjusted=False: {"KEEP": {"v": 1e6}, "BOUGHT": {"v": 1e6}})
    monkeypatch.setattr("api.services.cap_universe.symbols", lambda: frozenset())
    monkeypatch.setattr(su, "buyout_excludes", lambda: frozenset({"BOUGHT"}))

    out = su.build_and_save(min_shares=1000, sessions=1)
    assert out["excluded_buyouts"] == 1
    assert su.symbols() == ["KEEP"]


def test_build_writes_nothing_when_reference_is_empty(tmp_path, monkeypatch):
    dest = tmp_path / "out.json"
    monkeypatch.setenv("SCREENER_UNIVERSE_PATH", str(dest))
    monkeypatch.setattr("api.services.massive.list_reference_tickers", _fake_ref([]))
    monkeypatch.setattr("api.services.cap_universe.symbols", lambda: frozenset({"SPY"}))

    out = su.build_and_save(sessions=1)
    assert out["ok"] is False and out["final"] == 0
    assert not dest.exists()                     # a provider miss must not blank the file
    # loader still answers from the cap-universe fallback
    assert su.symbols() == ["SPY"]
