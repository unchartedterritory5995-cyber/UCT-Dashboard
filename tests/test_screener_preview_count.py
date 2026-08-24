"""How many rows this spec WOULD return — benchmark metric 450.

Zacks disables its Run button at zero; Trade Ideas shows a per-filter histogram
before you apply it; thinkorswim shows pre-scan match counts. Our member had to
RUN a screen to discover it was empty, which is the difference between tuning a
threshold and guessing at one.
"""
import pytest

from api.services.screener import query as Q
from api.services.screener import snapshot_db as db


@pytest.fixture
def snap(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    db.init_db()
    db.upsert_rows([
        {"ticker": "AAA", "price": 100.0, "rsi14": 20.0, "atr_pct": 1.0,
         "snapshot_date": "2026-08-24"},
        {"ticker": "BBB", "price": 50.0, "rsi14": 80.0, "atr_pct": 2.0,
         "snapshot_date": "2026-08-24"},
        {"ticker": "GAP", "price": 10.0, "rsi14": None, "atr_pct": 3.0,
         "snapshot_date": "2026-08-24"},
    ])
    return tmp_path


def test_it_counts_without_returning_rows(snap):
    out = Q.preview_count({})
    assert out["count"] == 3
    assert "rows" not in out


def test_the_count_matches_what_the_screen_actually_returns(snap):
    """⛔ THE ONE PROPERTY THAT MATTERS. A preview that can disagree with the
    screen it previews is worse than no preview — the member tunes against a
    number that never arrives."""
    spec = {"filters": [{"key": "price", "op": "gte", "min": 20}]}
    assert Q.preview_count(spec)["count"] == len(Q.run_scan(spec)["rows"])


def test_zero_is_NAMED_not_left_to_be_inferred(snap):
    out = Q.preview_count({"filters": [{"key": "price", "op": "gte",
                                        "min": 1_000_000}]})
    assert out["count"] == 0
    assert out["empty"] is True


def test_a_nonzero_count_is_not_empty(snap):
    assert Q.preview_count({})["empty"] is False


def test_it_honours_the_ranks_completeness_exclusion(snap):
    """A ranked screen drops rows missing a weighted criterion, so the preview
    must drop them too or it promises names the run will not show."""
    spec = {"rank": {"criteria": [{"key": "rsi14", "weight": 1}]}}
    out = Q.preview_count(spec)
    assert out["count"] == 2, "GAP has no rsi14 and cannot be ranked"
    assert out["count"] == len(Q.run_scan(spec)["rows"])


def test_top_n_is_REPORTED_not_applied(snap):
    """A member tuning filters wants both facts: the screen matches N names,
    and they asked to see only the first few."""
    out = Q.preview_count({"rank": {"criteria": [{"key": "rsi14"}], "top_n": 1}})
    assert out["top_n"] == 1
    assert out["count"] == 2, "the cap does not change how many MATCH"


def test_a_bad_spec_refuses_here_too(snap):
    """The preview must fail the same way the scan would, or a member tunes a
    spec the run will reject."""
    with pytest.raises(ValueError):
        Q.preview_count({"filters": [{"key": "not_a_filter", "op": "gte",
                                      "min": 1}]})
    with pytest.raises(ValueError):
        Q.preview_count({"rank": {"criteria": [{"key": "company"}]}})


def test_it_carries_the_same_join_receipts_as_a_run(snap):
    out = Q.preview_count({})
    assert out["scan_joins"] == [] and out["list_joins"] == []
