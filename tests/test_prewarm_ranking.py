"""Which stocks deserve a fast 5-minute chart must not be decided by spelling.

⛔⛔ `rest = sorted(tickers - priority - fast_path)` is ALPHABETICAL, and
`_FIVEMIN_TICKERS = ticker_list[:PREWARM_5M_CAP]` cuts it at 2,500. So after the
genuinely-relevant priority and breadth lists are placed, a stock's ticker's FIRST
LETTER decided whether its 5m chart was instant. An 'A' shell outranked a heavily
traded 'V' name for no reason anybody chose.

⭐ The replacement costs ZERO provider capacity: average daily dollar volume from
`bars_sqlite.avg_dollar_volume_bulk`, one local window-function pass over daily bars
we already store.
"""
from __future__ import annotations

from api.services import bars_prewarm as bp


def test_dollar_volume_beats_the_alphabet():
    """⭐ THE DEFECT, stated as a case: ZZZZ trades 100x AAAA and must warm first."""
    rest = ["AAAA", "MMMM", "ZZZZ"]
    ranked = bp.rank_intraday_candidates(rest, {"ZZZZ": 1e9, "MMMM": 1e7, "AAAA": 1e6})
    assert ranked == ["ZZZZ", "MMMM", "AAAA"]


def test_symbols_without_a_local_metric_fall_to_the_back_alphabetically():
    """A symbol we hold no daily history for cannot be ranked — it must not
    displace one we can measure, and it must still be DETERMINISTIC."""
    ranked = bp.rank_intraday_candidates(
        ["ZZZZ", "AAAA", "BBBB"], {"ZZZZ": 5e8})
    assert ranked == ["ZZZZ", "AAAA", "BBBB"]


def test_no_metric_at_all_is_exactly_todays_behaviour():
    """⚠️ THE FALLBACK IS THE OLD ORDER, NOT A NEW ONE. If the local metric is
    unavailable the boot pass must behave exactly as it does today, never randomly."""
    rest = ["MMMM", "AAAA", "ZZZZ"]
    assert bp.rank_intraday_candidates(rest, {}) == sorted(rest)
    assert bp.rank_intraday_candidates(rest, None) == sorted(rest)


def test_ties_are_broken_deterministically():
    """Two boots must produce the same 2,500, or coverage churns for free."""
    dv = {"BBBB": 1e8, "AAAA": 1e8}
    a = bp.rank_intraday_candidates(["BBBB", "AAAA"], dv)
    b = bp.rank_intraday_candidates(["AAAA", "BBBB"], dv)
    assert a == b == ["AAAA", "BBBB"]


def test_ranking_never_adds_or_drops_a_candidate():
    """⛔ A REORDER, NOT A FILTER. The cap does the cutting; this must not silently
    change WHICH symbols are eligible."""
    rest = [f"T{i}" for i in range(50)]
    ranked = bp.rank_intraday_candidates(rest, {"T7": 9e9, "T30": 1e9})
    assert sorted(ranked) == sorted(rest) and len(ranked) == len(rest)


def test_case_is_normalised_on_both_sides():
    ranked = bp.rank_intraday_candidates(["aaaa", "ZZZZ"], {"AAAA": 9e9})
    assert ranked == ["aaaa", "ZZZZ"]


def test_a_better_2500_is_NOT_the_bfrg_fix():
    """⚠️⚠️ THE HONEST BOUNDARY. Ranking reorders a 2,500-name cut of a ~26k
    searchable universe. A thin microcap can rank below the cut on dollar volume and
    still be a chart a member legitimately opens, so this must never be reported as
    solving arbitrary-symbol readiness — that is `reference_tail`'s job, and
    correctness on a miss is the cold warming path's."""
    rest = ["BFRG"] + [f"BIG{i}" for i in range(2500)]
    dv = {f"BIG{i}": 1e9 for i in range(2500)}
    dv["BFRG"] = 5e5                      # real, tradable, but thin
    ranked = bp.rank_intraday_candidates(rest, dv)
    assert ranked.index("BFRG") >= 2500, "the cut still excludes it — say so plainly"
