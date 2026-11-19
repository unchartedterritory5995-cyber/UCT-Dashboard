import importlib

import pytest

import api.services.institutional_holdings as ih_mod


@pytest.fixture(autouse=True)
def _no_vendor_read(monkeypatch):
    """Nothing in this file may reach Yahoo, whatever the code under test does: the shared guard
    answers its default instead of running the read. A test that needs an answer stubs it."""
    from api.services import yf_util
    calls = []
    monkeypatch.setattr(yf_util, "bounded_call", lambda fn, default=None, *a, **k: calls.append(fn) or default)
    return calls


def _mod(monkeypatch):
    importlib.reload(ih_mod)
    return ih_mod


def test_classify_change():
    ih = ih_mod
    assert ih._classify_change(100, 0) == "new"
    assert ih._classify_change(0, 100) == "sold_out"
    assert ih._classify_change(150, 100) == "added"
    assert ih._classify_change(80, 100) == "reduced"
    assert ih._classify_change(100, 100) == "flat"
    assert ih._classify_change(100, None) == "new"


def test_get_ownership_fmp_with_deltas_and_rankings(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [
        {"holder": "Vanguard", "shares": 1.31e9, "prior_shares": 1.29e9, "pct_out": 8.4, "value": 3.2e11, "date": "2026-03-31"},
        {"holder": "BlackRock", "shares": 1.10e9, "prior_shares": 1.20e9, "pct_out": 7.0, "value": 2.7e11, "date": "2026-03-31"},
        {"holder": "NewCo", "shares": 5.0e8, "prior_shares": 0, "pct_out": 3.0, "value": 1.2e11, "date": "2026-03-31"},
    ])
    out = ih.get_ownership("ZZAAPL")
    by = {h["holder"]: h for h in out["top_holders"]}
    assert by["Vanguard"]["change"] == "added" and by["Vanguard"]["change_shares"] == 2.0e7
    assert by["BlackRock"]["change"] == "reduced"
    assert by["NewCo"]["change"] == "new"
    assert out["biggest_buyers"][0]["holder"] == "NewCo"       # +5.0e8 largest add
    assert out["biggest_sellers"][0]["holder"] == "BlackRock"  # -1.0e8
    assert out["as_of"] == "2026-03-31"


def test_get_ownership_yfinance_fallback_no_deltas(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [])
    monkeypatch.setattr(ih, "get_institutional_holders", lambda t, top_n=15: {
        "held_by_institutions_pct": 61.4,
        "top_holders": [{"holder": "Vanguard", "shares": 1.3e9, "pct_out": 8.4, "value_usd": 3.2e11, "date_reported": "2026-03-31"}],
    })
    out = ih.get_ownership("ZZFB")
    assert out["inst_pct"] == 61.4
    assert out["top_holders"][0]["change"] is None       # no deltas on fallback
    assert out["top_holders"][0]["value"] == 3.2e11      # value_usd → value
    assert out["biggest_buyers"] == [] and out["biggest_sellers"] == []


def test_empty_returns_shape(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [])
    monkeypatch.setattr(ih, "get_institutional_holders", lambda t, top_n=15: {"error": "x"})
    out = ih.get_ownership("ZZNADA")
    assert out["top_holders"] == [] and out["inst_pct"] is None


# ── the voice tool reads Form 13F first, the way the Charts ownership panel route does ──

_FMP_ROWS = [
    {"holder": "Vanguard", "shares": 1.31e9, "prior_shares": 1.29e9, "pct_out": 8.4, "value": 3.2e11, "date": "2026-09-30"},
    {"holder": "BlackRock", "shares": 1.10e9, "prior_shares": 1.20e9, "pct_out": 7.0, "value": 2.7e11, "date": "2026-09-30"},
    {"holder": "NewCo", "shares": 5.0e8, "prior_shares": 0, "pct_out": 3.0, "value": 1.2e11, "date": "2026-09-30"},
]


def _never(*a, **k):
    raise AssertionError("the Yahoo holders table was read although FMP answered")


def test_voice_holders_come_from_13f_and_the_yahoo_table_is_not_read(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: list(_FMP_ROWS))
    monkeypatch.setattr(ih, "get_institutional_holders", _never)
    monkeypatch.setattr(ih, "_record_percent_and_float", lambda s: (63.46, 1.48e10))
    monkeypatch.setattr(ih, "_insider_held_pct", lambda s: 0.07)
    out = ih.get_institutional_holders_13f_first("zzvo", top_n=2)
    assert out["ticker"] == "ZZVO"
    assert out["source"] == "Form 13F filings, through FMP"
    assert [h["holder"] for h in out["top_holders"]] == ["Vanguard", "BlackRock"]     # largest first, cut to top_n
    assert out["top_holders_count"] == 2
    assert out["top_holders"][0] == {"holder": "Vanguard", "shares": 1.31e9, "pct_out": 8.4, "value_usd": 3.2e11,
                                     "change": "added", "change_shares": 2.0e7}
    assert out["biggest_buyers"][0]["holder"] == "NewCo" and out["biggest_sellers"][0]["holder"] == "BlackRock"
    assert out["as_of"] == "2026-09-30"
    assert out["held_by_institutions_pct"] == 63.46 and out["float_shares"] == 1.48e10


def test_voice_answer_names_the_source_of_every_figure(monkeypatch):
    """The insider percent has no Form 13F equivalent: it is the one figure still read from
    Yahoo Finance, and the answer says so beside it."""
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: list(_FMP_ROWS))
    monkeypatch.setattr(ih, "get_institutional_holders", _never)
    monkeypatch.setattr(ih, "_record_percent_and_float", lambda s: (63.46, 1.48e10))
    monkeypatch.setattr(ih, "_insider_held_pct", lambda s: 0.07)
    out = ih.get_institutional_holders_13f_first("ZZVS")
    assert out["held_by_insiders_pct"] == 0.07
    assert out["sources"] == {
        "top_holders": "Form 13F filings, through FMP",
        "held_by_institutions_pct": "Form 13F filings, through FMP",
        "float_shares": "FMP shares float",
        "held_by_insiders_pct": "Yahoo Finance (Form 13F covers institutions only)",
    }


def test_voice_figures_that_could_not_be_read_are_none_never_zero(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: list(_FMP_ROWS))
    monkeypatch.setattr(ih, "get_institutional_holders", _never)
    monkeypatch.setattr(ih, "_record_percent_and_float", lambda s: (None, None))
    monkeypatch.setattr(ih, "_insider_held_pct", lambda s: None)
    out = ih.get_institutional_holders_13f_first("ZZVN")
    assert out["held_by_institutions_pct"] is None and out["held_by_insiders_pct"] is None
    assert out["float_shares"] is None and out["top_holders_count"] == 3


def test_voice_falls_back_to_the_yahoo_table_only_when_fmp_holds_no_rows(monkeypatch):
    ih = _mod(monkeypatch)
    calls = []
    yahoo = {"ticker": "ZZVF", "held_by_institutions_pct": 61.4, "held_by_insiders_pct": 0.1, "float_shares": 9e8,
             "top_holders_count": 3, "source": ih.YAHOO_SOURCE,
             "top_holders": [{"holder": f"H{i}", "shares": 10 - i, "pct_out": 1.0, "value_usd": 1.0,
                              "date_reported": "2026-09-30"} for i in range(3)]}
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [])
    monkeypatch.setattr(ih, "get_institutional_holders", lambda t, top_n=15: calls.append(top_n) or dict(yahoo))
    monkeypatch.setattr(ih, "_record_percent_and_float", _never)
    monkeypatch.setattr(ih, "_insider_held_pct", _never)
    out = ih.get_institutional_holders_13f_first("ZZVF", top_n=2)
    assert out["source"] == "yfinance (Yahoo Finance 13F aggregate)"
    assert [h["holder"] for h in out["top_holders"]] == ["H0", "H1"] and out["top_holders_count"] == 2
    assert out["held_by_institutions_pct"] == 61.4 and out["held_by_insiders_pct"] == 0.1
    assert set(calls) == {15}            # one size of read, shared with get_ownership's fallback


def test_voice_fallback_error_is_passed_through(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: [])
    monkeypatch.setattr(ih, "get_institutional_holders", lambda t, top_n=15: {"error": "x", "ticker": t})
    assert ih.get_institutional_holders_13f_first("ZZVE") == {"error": "x", "ticker": "ZZVE"}
    assert ih.get_institutional_holders_13f_first("") == {"error": "ticker required"}


def test_get_ownership_still_hides_its_source_and_the_panel_route_shape_is_unchanged(monkeypatch):
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: list(_FMP_ROWS))
    monkeypatch.setattr(ih, "get_institutional_holders", _never)
    out = ih.get_ownership("ZZVP")
    assert "_source" not in out
    assert set(out) == {"ticker", "inst_pct", "inst_holders_count", "as_of", "top_holders",
                        "biggest_buyers", "biggest_sellers"}
    assert ih.get_ownership("ZZVP", debug=True)["_source"] == "fmp"
    assert ih._ownership_result("ZZVP")["_source"] == "fmp"          # held in the cache with it
    assert "_source" not in ih.get_ownership("ZZVP")                 # ... and stripped on the way out


def test_the_record_percent_and_float_come_from_the_research_ownership_record(monkeypatch):
    ih = _mod(monkeypatch)
    from api.services.research import ownership as research_own
    monkeypatch.setattr(research_own, "get_ownership", lambda s: {
        "institutional": {"pct_held": 63.46}, "share_counts": {"float_shares": 1.48e10}})
    assert ih._record_percent_and_float("ZZVL") == (63.46, 1.48e10)

    def boom(s):
        raise RuntimeError("down")
    monkeypatch.setattr(research_own, "get_ownership", boom)
    assert ih._record_percent_and_float("ZZVL") == (None, None)


def test_the_voice_tool_calls_the_13f_first_reader(monkeypatch):
    ih = _mod(monkeypatch)
    from api.services import voice_tool_impls as impl
    seen = []
    monkeypatch.setattr(ih, "get_institutional_holders_13f_first",
                        lambda t, top_n=10: seen.append((t, top_n)) or {"ticker": t, "source": ih.FMP_13F_SOURCE})
    monkeypatch.setattr(ih, "get_institutional_holders", _never)
    assert impl._get_institutional_holders(" nvda ", top_n=5) == {"ticker": "nvda", "source": "Form 13F filings, through FMP"}
    assert seen == [("nvda", 5)]
    assert impl._get_institutional_holders("") == {"error": "ticker required"}


def test_the_insider_percent_is_one_guarded_read_cached_and_none_when_absent(monkeypatch):
    """The one figure with no Form 13F equivalent: read on its own through the shared guard."""
    ih = _mod(monkeypatch)
    from api.services import yf_util
    reads = []
    monkeypatch.setattr(yf_util, "bounded_call", lambda fn, default=None, *a, **k: reads.append(1) or 0.0007)
    assert ih._insider_held_pct("ZZVI") == 0.07
    assert ih._insider_held_pct("ZZVI") == 0.07
    assert len(reads) == 1                                  # held for six hours like the rest
    monkeypatch.setattr(yf_util, "bounded_call", lambda fn, default=None, *a, **k: reads.append(1) or default)
    assert ih._insider_held_pct("ZZVJ") is None             # absent or unread: None, never 0
    assert ih._insider_held_pct("ZZVJ") is None
    assert len(reads) == 3                                  # ... and a None is not held


def test_the_13f_path_makes_no_holders_read_at_yahoo(monkeypatch, _no_vendor_read):
    """With FMP answering, the only guarded read is the insider percent: one, not the holders table."""
    ih = _mod(monkeypatch)
    monkeypatch.setattr(ih, "_fmp_ownership", lambda t: list(_FMP_ROWS))
    monkeypatch.setattr(ih, "_record_percent_and_float", lambda s: (63.46, 1.48e10))
    out = ih.get_institutional_holders_13f_first("ZZVK")
    assert out["source"] == "Form 13F filings, through FMP" and out["held_by_insiders_pct"] is None
    assert len(_no_vendor_read) == 1
