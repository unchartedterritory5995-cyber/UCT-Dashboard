import pytest
from api.services.catalyst.selection import select_top_12


def _c(ticker, tag, score):
    return {"ticker": ticker, "tag": tag, "score": score}


def test_fills_quotas_exactly():
    scored = (
        [_c(f"CAT{i}", "Catalyst", 100 - i) for i in range(20)]
        + [_c(f"ERN{i}", "Earnings", 90 - i) for i in range(10)]
        + [_c(f"GAP{i}", "Gapper", 80 - i) for i in range(10)]
        + [_c(f"NEW{i}", "News", 70 - i) for i in range(5)]
    )
    top = select_top_12(scored)
    assert len(top) == 20
    tag_counts = {}
    for c in top:
        tag_counts[c["tag"]] = tag_counts.get(c["tag"], 0) + 1
    assert tag_counts["Catalyst"] == 10
    assert tag_counts["Earnings"] == 5
    assert tag_counts["Gapper"] == 3
    assert tag_counts["News"] == 2


def test_picks_highest_score_per_bucket():
    scored = [
        _c("A_HIGH", "Catalyst", 100),
        _c("A_LOW", "Catalyst", 1),
        _c("B_HIGH", "Earnings", 90),
    ]
    top = select_top_12(scored)
    tickers = {c["ticker"] for c in top}
    assert "A_HIGH" in tickers
    assert "B_HIGH" in tickers


def test_redistributes_when_bucket_empty():
    scored = (
        [_c(f"CAT{i}", "Catalyst", 100 - i) for i in range(20)]
        + [_c(f"GAP{i}", "Gapper", 50 - i) for i in range(5)]
        + [_c(f"NEW{i}", "News", 40 - i) for i in range(5)]
    )
    top = select_top_12(scored)
    assert len(top) == 20
    cat_count = sum(1 for c in top if c["tag"] == "Catalyst")
    # 10 from Catalyst quota + 5 redistributed from empty Earnings bucket
    assert cat_count >= 10


def test_returns_sorted_by_score_desc():
    scored = [
        _c("LOW", "Catalyst", 10),
        _c("HIGH", "Earnings", 100),
        _c("MID", "Gapper", 50),
    ]
    top = select_top_12(scored)
    scores = [c["score"] for c in top]
    assert scores == sorted(scores, reverse=True)


def test_handles_fewer_than_12_candidates():
    scored = [
        _c("A", "Catalyst", 10),
        _c("B", "Earnings", 5),
    ]
    top = select_top_12(scored)
    assert len(top) == 2


def test_ignores_unknown_tags():
    scored = [
        _c("BAD", "WeirdTag", 999),
        _c("GOOD", "Catalyst", 1),
    ]
    top = select_top_12(scored)
    assert "BAD" not in {c["ticker"] for c in top}
    assert "GOOD" in {c["ticker"] for c in top}
