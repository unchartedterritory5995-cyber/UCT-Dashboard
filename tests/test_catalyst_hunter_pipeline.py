"""Pipeline integration for hunter-confirmed catalysts: gate + scoring + merge."""
from api.services.catalyst import filters, scoring, sources


# ── Gate: a confirmed catalyst survives even when flat ──
def test_gate_passes_confirmed_flat_catalyst():
    c = {"hunter_confirmed": True, "gap_pct": 0.3, "vol_x": 1.0, "catalyst_type": "Analyst"}
    assert filters.is_real_catalyst(c) == (True, None)


def test_gate_unconfirmed_flat_still_dropped():
    c = {"gap_pct": 0.3, "vol_x": 1.0}
    passed, reason = filters.is_real_catalyst(c)
    assert passed is False and reason


def test_quality_gate_still_drops_confirmed_junk():
    # Confirmed but a $1 stock — quality_gate (price floor) must still reject it.
    c = {"hunter_confirmed": True, "price": 1.0, "quote_type": "EQUITY"}
    passed, _ = filters.quality_gate(c)
    assert passed is False


# ── Scoring: confirmed catalysts get a per-category bonus ──
def test_scoring_flat_mna_outranks_flat_news():
    mna = {"hunter_confirmed": True, "catalyst_type": "M&A", "gap_pct": 0.0, "price": 50.0}
    news = {"hunter_confirmed": True, "catalyst_type": "News", "gap_pct": 0.0, "price": 50.0}
    assert scoring.score(mna) > scoring.score(news)
    assert scoring.score(mna) >= 30.0  # decisive even at 0% move


def test_scoring_mover_outranks_equal_type_flat():
    flat = {"hunter_confirmed": True, "catalyst_type": "Analyst", "gap_pct": 0.0, "price": 50.0}
    mover = {"hunter_confirmed": True, "catalyst_type": "Analyst", "gap_pct": 12.0,
             "vol_x": 5.0, "price": 50.0}
    assert scoring.score(mover) > scoring.score(flat)


# ── Merge: hunter hits fold onto the candidate pool ──
def test_merge_adds_new_and_enriches_existing():
    by_ticker = {"AAPL": {"ticker": "AAPL", "gap_pct": 4.0}}
    hits = [
        {"ticker": "AAPL", "catalyst_type": "Analyst", "headline": "PT up",
         "source_url": "u1", "when": "pre", "moving_yet": True},
        {"ticker": "NEWCO", "catalyst_type": "M&A", "headline": "acquired",
         "source_url": "u2", "when": "overnight", "moving_yet": False},
    ]
    sources._merge_hunter_hits(by_ticker, hits)

    assert by_ticker["AAPL"]["hunter_confirmed"] is True
    assert by_ticker["AAPL"]["catalyst_type"] == "Analyst"
    assert by_ticker["AAPL"]["gap_pct"] == 4.0          # existing field preserved
    assert "NEWCO" in by_ticker
    assert by_ticker["NEWCO"]["hunter_confirmed"] is True
    assert by_ticker["NEWCO"]["hunter_headline"] == "acquired"
    assert by_ticker["NEWCO"]["moving_yet"] is False
