"""Historical sentiment store: forward-fill semantics + the bundled-CSV seeder."""
import os

import pytest


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    monkeypatch.setenv("BREADTH_SENTIMENT_DB", str(tmp_path / "sent.db"))
    from api.services import breadth_sentiment_history as sent
    sent._INIT_DONE = False
    yield sent


def test_weekly_value_forward_fills_but_not_across_a_big_gap(_isolated):
    sent = _isolated
    sent.upsert_many([
        ("2015-06-15", "aaii_bulls", 41.0),   # a Monday survey
        ("2015-07-20", "aaii_bulls", 33.0),   # five weeks later
    ])
    got = sent.values_asof(["2015-06-15", "2015-06-18", "2015-06-25", "2015-06-28", "2015-07-01", "2015-07-20"])
    assert got["2015-06-15"]["aaii_bulls"] == 41.0      # exact
    assert got["2015-06-18"]["aaii_bulls"] == 41.0      # +3d → carried
    assert got["2015-06-25"]["aaii_bulls"] == 41.0      # +10d → still within the 12-day carry
    assert "aaii_bulls" not in got["2015-06-28"]        # +13d, past the 12-day cap
    assert "aaii_bulls" not in got["2015-07-01"]        # deep in the gap → nothing
    assert got["2015-07-20"]["aaii_bulls"] == 33.0      # the next survey lands


def test_a_date_before_all_data_gets_nothing(_isolated):
    sent = _isolated
    sent.upsert_many([("2011-01-03", "cnn_fear_greed", 68)])
    assert sent.values_asof(["2008-01-02"]) == {"2008-01-02": {}}


def test_bundled_seed_csv_loads_and_covers_the_expected_series():
    # Runs against the REAL committed seed file (no isolation) to prove it parses
    # and carries every series. Uses a throwaway DB via the env override.
    import tempfile
    from api.services import breadth_sentiment_history as sent
    with tempfile.TemporaryDirectory() as td:
        os.environ["BREADTH_SENTIMENT_DB"] = os.path.join(td, "seed.db")
        sent._INIT_DONE = False
        res = sent.seed_from_bundled_csv(force=True)
        assert res.get("ok") and res.get("seeded", 0) > 5000, res
        st = sent.stats()
        keys = st["by_key"]
        for k in ("aaii_bulls", "aaii_spread", "cboe_putcall", "cnn_fear_greed"):
            assert k in keys and keys[k]["rows"] > 100, (k, keys.get(k))
        # AAII reaches the 1980s; put/call the early 2000s; F&G ~2011.
        assert keys["aaii_bulls"]["first"] < "1990-01-01"
        assert keys["cboe_putcall"]["first"] < "2004-01-01"
        assert keys["cnn_fear_greed"]["first"] < "2012-01-01"
    os.environ.pop("BREADTH_SENTIMENT_DB", None)
    sent._INIT_DONE = False
