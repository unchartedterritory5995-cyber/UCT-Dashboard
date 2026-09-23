"""The reference-tail pilot cohort: bounded, ranked, deterministic, fail-safe.

⛔⛔ WHY THE TAIL EXISTS AS A PROBLEM. `load_universe()` reads cap_universe.json
(3,640 symbols). The ~22k active reference symbols outside it get D/W/M warming only
— "instant every symbol" made DAILY universe-wide and left intraday inside
cap_universe. That is why a member can search BFRG, open its 1D chart, and find no
5m. Measured 2026-09-23: BFRG / SNGX / GRRR / CNEY / VRME are all absent from
cap_universe.json.

⛔ WHY IT LIVES IN THE CRAWLER AND NOT THE BOOT PASS. v1 pushed ~3,200 shallow jobs
through the worker's FOUR-thread boot pass and on 2026-08-19 thrashed the bars.db
write-lock and saturated the provider. The crawler is single-in-flight and paced, so
widening WHAT it walks never widens the RATE.
"""
from __future__ import annotations

from api.services import bars_universe_crawler as uc


BASE = ["AAPL", "MSFT", "NVDA"]
REF = ["AAPL", "MSFT", "NVDA", "BFRG", "SNGX", "GRRR", "CNEY", "VRME", "ZZZZ"]


def test_disabled_yields_nothing():
    assert uc.tail_cohort(REF, BASE, enabled=False, cap=2500) == []


def test_only_symbols_outside_the_base_universe_are_candidates():
    """⛔ Never re-queue a symbol the crawler already walks — that is a wasted call
    on the one axis this design is bounded by."""
    got = uc.tail_cohort(REF, BASE, enabled=True, cap=100)
    assert not (set(got) & set(BASE))
    assert set(got) == {"BFRG", "SNGX", "GRRR", "CNEY", "VRME", "ZZZZ"}


def test_the_cohort_is_ranked_by_dollar_volume_not_the_alphabet():
    got = uc.tail_cohort(REF, BASE, enabled=True, cap=3,
                         dollar_volume={"VRME": 9e8, "SNGX": 5e8, "BFRG": 1e8})
    assert got == ["VRME", "SNGX", "BFRG"]


def test_the_cap_bounds_the_cohort():
    assert len(uc.tail_cohort(REF, BASE, enabled=True, cap=2)) == 2


def test_a_missing_or_garbage_cap_yields_ZERO_not_the_whole_tail():
    """⚠️⚠️ THE SAFETY REQUIREMENT. A configuration slip must not become ~22,000
    unplanned provider calls. Fail safe, never fail open."""
    for bad in (None, "", "abc", "2500x", [], {}):
        assert uc.tail_cohort(REF, BASE, enabled=True, cap=bad) == [], f"cap={bad!r} opened the gate"


def test_a_zero_or_negative_cap_yields_nothing():
    assert uc.tail_cohort(REF, BASE, enabled=True, cap=0) == []
    assert uc.tail_cohort(REF, BASE, enabled=True, cap=-5) == []


def test_the_cohort_is_deterministic_across_restarts():
    """A cohort that churns re-buys itself every boot."""
    dv = {"BFRG": 1e8, "SNGX": 1e8}
    a = uc.tail_cohort(REF, BASE, enabled=True, cap=4, dollar_volume=dv)
    b = uc.tail_cohort(list(reversed(REF)), BASE, enabled=True, cap=4, dollar_volume=dv)
    assert a == b


def test_unmeasurable_symbols_still_sort_deterministically():
    got = uc.tail_cohort(REF, BASE, enabled=True, cap=6, dollar_volume={"ZZZZ": 1e9})
    assert got[0] == "ZZZZ"
    assert got[1:] == sorted(["BFRG", "SNGX", "GRRR", "CNEY", "VRME"])


def test_index_rows_and_blanks_never_enter():
    got = uc.tail_cohort(["I:SPX", "", None, "BFRG"], BASE, enabled=True, cap=10)
    assert got == ["BFRG"], got


def test_the_known_examples_are_reachable_but_NOT_guaranteed():
    """⚠️ HONEST BOUNDARY. This is a capacity pilot, not a golden-symbol whitelist.
    A named symbol enters only if it ranks inside the cap — nothing is hardcoded, and
    a thin name can legitimately fall outside a 2,500 cohort. Whether the five
    actually make it is an OBSERVATION to report, not a property to assert."""
    crowded = [f"BIG{i}" for i in range(2500)]
    dv = {f"BIG{i}": 1e9 for i in range(2500)}
    dv["BFRG"] = 1e5
    got = uc.tail_cohort(crowded + ["BFRG"], [], enabled=True, cap=2500, dollar_volume=dv)
    assert "BFRG" not in got, "a thin name outranking 2,500 liquid ones would be a bug"
    # ...and with room, it is reachable without any special-casing.
    assert "BFRG" in uc.tail_cohort(crowded + ["BFRG"], [], enabled=True,
                                    cap=2501, dollar_volume=dv)
