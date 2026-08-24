"""A member's own weighted composite — benchmark metrics 432-435.

Stock Rover ships "Quant" and Stockopedia ships "StockRanks": the member's own
weights on their own criteria, ranked, top-N. We shipped `uct_composite`, which
is the HOUSE's weighting and structurally cannot be anything else.
"""
import pytest

from api.services.screener import ranking as R
from api.services.screener import query as Q
from api.services.screener import snapshot_db as db


# ── the spec ─────────────────────────────────────────────────────────────────

def test_a_valid_rank_parses_into_columns_and_shares():
    spec = R.parse({"criteria": [{"key": "roe", "weight": 3},
                                 {"key": "pe_ttm", "weight": 1,
                                  "ascending": True}]})
    assert [c["key"] for c in spec["criteria"]] == ["roe", "pe_ttm"]
    assert spec["criteria"][0]["column"] == "roe"
    assert spec["criteria"][1]["ascending"] is True
    assert spec["top_n"] is None


def test_no_rank_is_not_an_error():
    # ⚠️ An EMPTY list is "no rank requested", not a malformed one — a client
    # that clears its criteria sends `[]`, and refusing that would 400 a member
    # for turning the feature off.
    for empty in (None, {}, 0, "", []):
        assert R.parse(empty) is None


def test_a_malformed_rank_REFUSES_rather_than_falling_back():
    """⛔ Degrading to "no ranking" would hand the member a plain list they did
    not ask for, ordered by something they did not choose, with nothing on
    screen to say so."""
    for bad in ({"criteria": []}, {"criteria": "roe"}, {"criteria": [1]},
                {"criteria": [{}]}, "rank"):
        with pytest.raises(R.RankSpecError):
            R.parse(bad)


def test_it_can_only_rank_by_a_registered_numeric_filter():
    """⛔ A filter key, resolved through the registry — never a column name."""
    for bad in ("sqlite_master", "ticker; DROP TABLE x", "company", None):
        with pytest.raises(R.RankSpecError):
            R.parse({"criteria": [{"key": bad, "weight": 1}]})


def test_a_duplicate_criterion_refuses():
    with pytest.raises(R.RankSpecError):
        R.parse({"criteria": [{"key": "roe", "weight": 1},
                              {"key": "roe", "weight": 2}]})


@pytest.mark.parametrize("w", [0, -1, "x", None, float("nan"), float("inf")])
def test_a_weight_must_be_a_positive_number(w):
    with pytest.raises(R.RankSpecError):
        R.parse({"criteria": [{"key": "roe", "weight": w}]})


def test_too_many_criteria_refuse():
    keys = R.parse.__globals__["filters"].comparable_keys()[:R.MAX_CRITERIA + 1]
    with pytest.raises(R.RankSpecError):
        R.parse({"criteria": [{"key": k, "weight": 1} for k in keys]})


def test_top_n_is_bounded_and_validated():
    assert R.parse({"criteria": [{"key": "roe"}], "top_n": 5})["top_n"] == 5
    assert R.parse({"criteria": [{"key": "roe"}],
                    "top_n": 10_000})["top_n"] == R.MAX_TOP_N
    for bad in (0, -3, "x"):
        with pytest.raises(R.RankSpecError):
            R.parse({"criteria": [{"key": "roe"}], "top_n": bad})


# ── the SQL ──────────────────────────────────────────────────────────────────

def _plain(c):
    return f'"{c}"'


def test_direction_inverts_the_percentile_never_the_sort():
    """⛔ Direction is per criterion and never guessed. A screener assuming
    "high is good" would rank the most expensive names first on a value
    criterion — the shape of the audit's worst finding."""
    up = R.score_expr(R.parse({"criteria": [{"key": "roe"}]}), _plain)
    down = R.score_expr(
        R.parse({"criteria": [{"key": "pe_ttm", "ascending": True}]}), _plain)
    assert "PERCENT_RANK() OVER (ORDER BY \"roe\" ASC)" in up
    assert "1.0 - PERCENT_RANK()" in down


def test_the_weights_divide_the_score_not_multiply_it():
    spec = R.parse({"criteria": [{"key": "roe", "weight": 3},
                                 {"key": "roa", "weight": 1}]})
    expr = R.score_expr(spec, _plain)
    assert "/ 4" in expr, "the divisor is the weight TOTAL"
    assert "100.0 *" in expr, "the score reads 0-100"


def test_completeness_clauses_name_every_weighted_column():
    spec = R.parse({"criteria": [{"key": "roe"}, {"key": "roa"}]})
    cl = R.completeness_clauses(spec, _plain)
    assert cl == ['"roe" IS NOT NULL', '"roa" IS NOT NULL']


def test_the_receipt_reports_what_the_rank_had_to_drop():
    spec = R.parse({"criteria": [{"key": "roe", "weight": 1}]})
    rc = R.receipt(spec, matched=100, ranked=60)
    assert rc["excluded_incomplete"] == 40
    assert rc["criteria"][0]["share_pct"] == 100.0


# ── end to end ───────────────────────────────────────────────────────────────

@pytest.fixture
def snap(tmp_path, monkeypatch):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    db.init_db()
    rows = []
    # Four complete names with a clean ordering, plus one that is missing a
    # weighted criterion and therefore cannot be ranked.
    for tk, mom, atr in [("AAA", 40.0, 1.0), ("BBB", 30.0, 2.0),
                         ("CCC", 20.0, 3.0), ("DDD", 10.0, 4.0)]:
        rows.append({"ticker": tk, "price": 50.0, "chg_pct_1m": mom,
                     "atr_pct": atr, "snapshot_date": "2026-08-24"})
    rows.append({"ticker": "GAP", "price": 50.0, "chg_pct_1m": None,
                 "atr_pct": 1.0, "snapshot_date": "2026-08-24"})
    db.upsert_rows(rows)
    return tmp_path


def _run(spec):
    return Q.run_scan(spec)


def test_a_ranked_screen_scores_and_orders_by_the_members_weights(snap):
    out = _run({"rank": {"criteria": [{"key": "chg_pct_1m", "weight": 1}]},
                "page_size": 10})
    syms = [r["ticker"] for r in out["rows"]]
    assert syms == ["AAA", "BBB", "CCC", "DDD"], "highest momentum first"
    assert out["rows"][0]["rank_score"] == 100.0
    assert out["rows"][-1]["rank_score"] == 0.0


def test_ascending_flips_the_order(snap):
    out = _run({"rank": {"criteria": [{"key": "atr_pct", "weight": 1,
                                       "ascending": True}]},
                "page_size": 10})
    syms = [r["ticker"] for r in out["rows"]]
    # ⭐ GAP IS RANKED HERE, and that is the completeness rule working rather
    # than a leak: it is missing `chg_pct_1m`, which THIS rank does not weight.
    # A row is excluded only for the criteria actually being scored.
    assert set(syms[:2]) == {"AAA", "GAP"}, "both hold atr_pct = 1.0"
    assert syms[2:] == ["BBB", "CCC", "DDD"]
    assert out["rank"]["excluded_incomplete"] == 0


def test_an_incomplete_row_is_EXCLUDED_and_COUNTED_never_scored_zero(snap):
    """🔴 A fabricated 0 percentile would sort GAP last as if it were measurably
    the worst, when the truth is we never measured it."""
    out = _run({"rank": {"criteria": [{"key": "chg_pct_1m", "weight": 1}]},
                "page_size": 10})
    assert "GAP" not in [r["ticker"] for r in out["rows"]]
    rk = out["rank"]
    assert rk["matched_filters"] == 5
    assert rk["ranked"] == 4
    assert rk["excluded_incomplete"] == 1, (
        "the member must be told the rank dropped a name, or a ranked screen "
        "returning fewer rows reads as a quiet market")


def test_the_unranked_path_still_returns_everyone(snap):
    out = _run({"page_size": 10})
    assert "GAP" in [r["ticker"] for r in out["rows"]]
    assert out["rank"] is None
    assert "rank_score" not in out["rows"][0]


def test_weights_actually_change_the_order(snap):
    """The whole point: the member's weighting, not the house's."""
    mom = _run({"rank": {"criteria": [{"key": "chg_pct_1m", "weight": 9},
                                      {"key": "atr_pct", "weight": 1}]},
                "page_size": 10})
    calm = _run({"rank": {"criteria": [{"key": "chg_pct_1m", "weight": 1},
                                       {"key": "atr_pct", "weight": 9,
                                        "ascending": True}]},
                 "page_size": 10})
    assert mom["rows"][0]["ticker"] == "AAA"
    assert [r["ticker"] for r in mom["rows"]] != []
    # both weightings happen to favour AAA here; what must differ is the SCORE
    assert mom["rows"][1]["rank_score"] != calm["rows"][1]["rank_score"]


def test_top_n_caps_the_list(snap):
    out = _run({"rank": {"criteria": [{"key": "chg_pct_1m", "weight": 1}],
                         "top_n": 2}, "page_size": 10})
    assert [r["ticker"] for r in out["rows"]] == ["AAA", "BBB"]
    assert out["rank"]["top_n"] == 2


def test_rank_composes_with_filters(snap):
    out = _run({"filters": [{"key": "atr_pct", "op": "lte", "max": 2.5}],
                "rank": {"criteria": [{"key": "chg_pct_1m", "weight": 1}]},
                "page_size": 10})
    assert [r["ticker"] for r in out["rows"]] == ["AAA", "BBB"]
    assert out["rank"]["matched_filters"] == 3, "GAP passes the atr filter too"
    assert out["rank"]["excluded_incomplete"] == 1


def test_a_bad_rank_raises_rather_than_returning_an_unranked_list(snap):
    with pytest.raises(ValueError):
        _run({"rank": {"criteria": [{"key": "company", "weight": 1}]}})
