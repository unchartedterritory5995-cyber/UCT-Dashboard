from unittest.mock import patch
from api.services import implied_move as im

def test_select_report_expiry_picks_first_on_or_after():
    exps = ["2026-08-07", "2026-08-14", "2026-08-21"]
    assert im.select_report_expiry(exps, "2026-08-12") == "2026-08-14"
    assert im.select_report_expiry(exps, "2026-08-07") == "2026-08-07"
    assert im.select_report_expiry(exps, "2026-09-01") is None  # report beyond listed expiries
    assert im.select_report_expiry([], "2026-08-12") is None
    assert im.select_report_expiry(exps, None) == "2026-08-07"  # no report date → front expiry

def _chain(spot=184.22, strike=185.0, cb=6.1, ca=6.3, pb=6.0, pa=6.2, exp="2026-08-07"):
    return {"ticker": "TST", "expiration": exp, "spot": spot,
            "calls": [{"strike": strike, "bid": cb, "ask": ca, "iv": 0.62, "expiration": exp}],
            "puts":  [{"strike": strike, "bid": pb, "ask": pa, "iv": 0.60, "expiration": exp}],
            "source": "polygon (Massive Advanced)"}

def test_compute_expected_move_straddle_math():
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=_chain()):
        out = im.compute_expected_move("TST", "2026-08-06")
    assert out is not None
    straddle = (6.1 + 6.3) / 2 + (6.0 + 6.2) / 2      # call mid + put mid = 12.30
    assert abs(out["dollar"] - straddle) < 1e-9
    assert abs(out["pct"] - (straddle / 184.22 * 100)) < 1e-6
    assert out["expiry"] == "2026-08-07" and out["horizon"] == "through 2026-08-07"

def test_compute_expected_move_returns_none_on_bad_quotes():
    bad = _chain(cb=0.0, ca=0.0, pb=0.0, pa=0.0)      # no NBBO → unusable
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=bad):
        assert im.compute_expected_move("TST", "2026-08-06") is None

def test_compute_expected_move_returns_none_on_chain_error():
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value={"error": "no chain data"}):
        assert im.compute_expected_move("TST", "2026-08-06") is None

def test_compute_expected_move_none_on_non_numeric_inputs():
    weird = _chain()
    weird["spot"] = "n/a"
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=weird):
        assert im.compute_expected_move("TST", "2026-08-06") is None

def test_compute_expected_move_none_on_mismatched_atm_strikes():
    ch = _chain()
    ch["puts"][0]["strike"] = 190.0
    with patch.object(im.polygon_options, "list_expirations",
                      return_value={"expirations": ["2026-08-07"]}), \
         patch.object(im.polygon_options, "get_chain", return_value=ch):
        assert im.compute_expected_move("TST", "2026-08-06") is None

def test_select_report_expiry_malformed_nonempty_date_returns_none():
    assert im.select_report_expiry(["2026-08-07"], "not-a-date") is None
