"""analyst_pass store + client: roundtrip, stalest ordering, freshness
window, and fetch_one's four-leg isolation. Every network seam
(earnings_estimates._fmp_get) is monkeypatched — no real FMP calls."""
import datetime
import time

import api.services.screener.analyst_pass as ap


def _use_tmp_db(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH", str(tmp_path / "analyst.db"))
    ap.init_db()


# ── store ────────────────────────────────────────────────────────────────

def test_upsert_then_read_roundtrip(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    now = time.time()
    ap.upsert("aapl", {"consensus": "Buy", "pt_target": 250.0,
                        "upgrades_30d": 2, "downgrades_30d": 1,
                        "eps_next_y_growth": 12.5}, now=now)
    out = ap.read_analyst_fields(["AAPL"])
    assert out == {"AAPL": {"analyst_consensus": "Buy", "pt_target": 250.0,
                            "upgrades_30d": 2, "downgrades_30d": 1,
                            "eps_next_y_growth": 12.5}}


def test_upsert_is_a_replace_not_an_accumulate(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    now = time.time()
    ap.upsert("MSFT", {"consensus": "Hold", "pt_target": 300.0,
                        "upgrades_30d": 0, "downgrades_30d": 0,
                        "eps_next_y_growth": None}, now=now - 100)
    ap.upsert("MSFT", {"consensus": "Buy", "pt_target": 320.0,
                        "upgrades_30d": 1, "downgrades_30d": 0,
                        "eps_next_y_growth": 8.0}, now=now)
    out = ap.read_analyst_fields(["MSFT"])
    assert out["MSFT"]["analyst_consensus"] == "Buy"
    assert out["MSFT"]["pt_target"] == 320.0


def test_stalest_orders_never_fetched_first_then_ascending(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    now = time.time()
    ap.upsert("BBB", {"consensus": None, "pt_target": None, "upgrades_30d": None,
                       "downgrades_30d": None, "eps_next_y_growth": None},
              now=now - 100)      # oldest
    ap.upsert("CCC", {"consensus": None, "pt_target": None, "upgrades_30d": None,
                       "downgrades_30d": None, "eps_next_y_growth": None},
              now=now - 10)       # most recent
    # AAA was never fetched
    ordered = ap.stalest(["CCC", "BBB", "AAA"])
    assert ordered == ["AAA", "BBB", "CCC"]


def test_stalest_respects_the_cap(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    ordered = ap.stalest(["CCC", "BBB", "AAA"], n=2)
    assert len(ordered) == 2


def test_read_analyst_fields_freshness_window(monkeypatch, tmp_path):
    _use_tmp_db(monkeypatch, tmp_path)
    now = time.time()
    row = {"consensus": "Buy", "pt_target": 100.0, "upgrades_30d": 0,
           "downgrades_30d": 0, "eps_next_y_growth": 5.0}
    ap.upsert("FRESH", row, now=now - 7 * 86400)   # within the 8-day window
    ap.upsert("STALE", row, now=now - 9 * 86400)   # older than 8 days
    out = ap.read_analyst_fields(["FRESH", "STALE", "NEVER"])
    assert "FRESH" in out
    assert "STALE" not in out
    assert "NEVER" not in out


def test_read_analyst_fields_reports_a_dead_store(monkeypatch, tmp_path):
    monkeypatch.setenv("SCREENER_ANALYST_DB_PATH",
                       str(tmp_path / "does" / "not" / "exist" / "a.db"))
    fails = {}
    out = ap.read_analyst_fields(["AAPL"], failures=fails)
    assert out == {}
    assert "analyst_pass" in fails


# ── client: fetch_one ───────────────────────────────────────────────────

def _routes(monkeypatch, mapping, raising=None):
    """Dispatch ee._fmp_get by path substring -> fixture payload. `raising`
    is a set of path substrings whose leg should raise instead of return."""
    raising = raising or set()

    def fake(path, params, timeout=10):
        for frag in raising:
            if frag in path:
                raise RuntimeError(f"boom:{frag}")
        for frag, payload in mapping.items():
            if frag in path:
                return payload
        return None
    monkeypatch.setattr(ap.ee, "_fmp_get", fake)


_FROZEN_TODAY = datetime.datetime(2026, 8, 22, tzinfo=ap._ET)


def _freeze_now(monkeypatch, when=_FROZEN_TODAY):
    monkeypatch.setattr(ap, "_now_et", lambda: when)


def test_fetch_one_all_four_legs_answer(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 1, "buy": 2, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Buy"}],
        "price-target-consensus": [{"targetConsensus": 200.0, "targetMedian": 190.0}],
        "grades": [
            {"date": "2026-08-10", "action": "upgrade"},
            {"date": "2026-08-01", "action": "downgrade"},
            {"date": "2026-06-01", "action": "upgrade"},   # outside the 30d window
        ],
        "analyst-estimates": [
            {"date": "2026-12-31", "epsAvg": 2.0},
            {"date": "2027-12-31", "epsAvg": 3.0},
        ],
    })
    out = ap.fetch_one("aapl")
    assert out == {
        "consensus": "Buy",
        "pt_target": 200.0,
        "upgrades_30d": 1,
        "downgrades_30d": 1,
        "eps_next_y_growth": 50.0,
    }


def test_fetch_one_pt_target_falls_back_to_median(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {
        "price-target-consensus": [{"targetConsensus": None, "targetMedian": 150.0}],
    })
    out = ap.fetch_one("MSFT")
    assert out["pt_target"] == 150.0


def test_fetch_one_a_raising_leg_nulls_only_its_slice(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 1, "buy": 0, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Buy"}],
        "grades": [{"date": "2026-08-10", "action": "upgrade"}],
        "analyst-estimates": [{"date": "2026-12-31", "epsAvg": 1.0},
                              {"date": "2027-12-31", "epsAvg": 1.1}],
    }, raising={"price-target-consensus"})
    out = ap.fetch_one("aapl")
    assert out["consensus"] == "Buy"
    assert out["pt_target"] is None          # only this slice nulled
    assert out["upgrades_30d"] == 1
    assert out["eps_next_y_growth"] is not None


def test_fetch_one_zero_total_consensus_is_refused(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 0, "buy": 0, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Hold"}],
    })
    # every other leg also nulls in this fixture -> whole call refuses
    assert ap.fetch_one("aapl") is None


def test_fetch_one_zero_total_consensus_refused_but_other_legs_survive(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 0, "buy": 0, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Hold"}],
        "price-target-consensus": [{"targetConsensus": 42.0}],
    })
    out = ap.fetch_one("aapl")
    assert out["consensus"] is None
    assert out["pt_target"] == 42.0


def test_fetch_one_negative_base_growth_is_refused(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 1, "buy": 0, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Buy"}],
        "analyst-estimates": [{"date": "2026-12-31", "epsAvg": -0.5},
                              {"date": "2027-12-31", "epsAvg": 0.3}],
    })
    out = ap.fetch_one("aapl")
    assert out["eps_next_y_growth"] is None
    assert out["consensus"] == "Buy"


def test_fetch_one_growth_needs_two_distinct_fiscal_years(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 1, "buy": 0, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Buy"}],
        "analyst-estimates": [{"date": "2026-12-31", "epsAvg": 2.0}],   # only one FY
    })
    out = ap.fetch_one("aapl")
    assert out["eps_next_y_growth"] is None


def test_fetch_one_returns_none_when_every_leg_nulls(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {})   # nothing resolves for any leg
    assert ap.fetch_one("aapl") is None


def test_fetch_one_30day_window_is_boundary_inclusive(monkeypatch):
    frozen = _FROZEN_TODAY
    _freeze_now(monkeypatch, frozen)
    on_boundary = (frozen.date() - datetime.timedelta(days=30)).isoformat()
    just_outside = (frozen.date() - datetime.timedelta(days=31)).isoformat()
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 1, "buy": 0, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Buy"}],
        "grades": [
            {"date": on_boundary, "action": "upgrade"},
            {"date": just_outside, "action": "upgrade"},
        ],
    })
    out = ap.fetch_one("aapl")
    assert out["upgrades_30d"] == 1
    assert out["downgrades_30d"] == 0


def test_fetch_one_30day_window_only_counts_upgrade_downgrade_actions(monkeypatch):
    _freeze_now(monkeypatch)
    _routes(monkeypatch, {
        "grades-consensus": [{"strongBuy": 1, "buy": 0, "hold": 0, "sell": 0,
                              "strongSell": 0, "consensus": "Buy"}],
        "grades": [
            {"date": "2026-08-15", "action": "maintain"},
            {"date": "2026-08-15", "action": "initiate"},
            {"date": "2026-08-15", "action": "upgrade"},
        ],
    })
    out = ap.fetch_one("aapl")
    assert out["upgrades_30d"] == 1
    assert out["downgrades_30d"] == 0


def test_fetch_one_upper_cases_and_blanks_a_missing_ticker(monkeypatch):
    _freeze_now(monkeypatch)
    assert ap.fetch_one("") is None
    assert ap.fetch_one(None) is None
