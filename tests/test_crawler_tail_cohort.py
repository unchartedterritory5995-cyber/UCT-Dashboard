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


# ── CAPABILITY PREFERENCE (patch 2) ──────────────────────────────────────────
#
# ⭐ MEASURED 2026-09-24, deterministic n=80 spread of the 9,645 tail CANDIDATES:
# **82.5% hold no 5m rows at all** — preferreds (AHLPE/BHRPB), units (ALUB.U), tiny
# ETFs (BRRR/BULZ) — against **0.0%** in cap_universe. So a rank-only tail spends most
# of a fixed 1-fetch-per-3s budget on instruments that never produced an intraday series.
#
# ⚠️ THAT 82.5% IS THE CANDIDATE POOL, NOT THIS COHORT. The cohort is the
# dollar-volume-ranked top slice and is a better-selected subset. The sample is evidence
# that preference is worth trying — never this cohort's no-data rate.
#
# ⛔ POSITIVE EVIDENCE ONLY. `has_5m` means "has previously produced a validated stored
# 5m row" — CAPABILITY, not freshness. Nothing here records failure, so nothing here
# can become a tombstone.

_CAP_OK = {"MU", "SOXL", "KORU", "COPX"}


def _cap(*syms):
    known = set(syms)
    return lambda s: s in known


def test_capability_preference_is_off_by_default_signature():
    """No `has_5m` => byte-identical to the shipped rank-only behaviour."""
    ref = ["AAA", "BBB", "CCC"]
    assert uc.tail_cohort(ref, [], enabled=True, cap=2) == \
           uc.tail_cohort(ref, [], enabled=True, cap=2, has_5m=None)


def test_proven_capable_candidates_are_preferred_within_the_ranking():
    """⭐ Dollar volume still orders WITHIN each group; capability only picks the group.
    SOXL outranks nothing here on dv — it is chosen because it is proven."""
    ref = ["IVV", "IJR", "SOXL", "MU"]
    dv = {"IVV": 9e9, "IJR": 8e9, "SOXL": 1e9, "MU": 5e8}
    got = uc.tail_cohort(ref, [], enabled=True, cap=2, dollar_volume=dv,
                         has_5m=_cap("SOXL", "MU"), discovery_every=99)
    assert got == ["SOXL", "MU"]


def test_dollar_volume_still_orders_inside_the_proven_group():
    ref = ["MU", "SOXL"]
    got = uc.tail_cohort(ref, [], enabled=True, cap=2,
                         dollar_volume={"SOXL": 9e9, "MU": 1e8},
                         has_5m=_cap("MU", "SOXL"), discovery_every=99)
    assert got == ["SOXL", "MU"], "capability must not discard the ranking"


def test_discovery_slots_keep_unproven_candidates_reachable():
    """⛔⛔ ANTI-CIRCULARITY. no rows -> never crawled -> never any rows would lock out
    every new listing and every provider-coverage improvement."""
    ref = [f"P{i}" for i in range(10)] + [f"U{i}" for i in range(10)]
    got = uc.tail_cohort(ref, [], enabled=True, cap=10,
                         dollar_volume={s: 1e9 - i for i, s in enumerate(ref)},
                         has_5m=_cap(*[f"P{i}" for i in range(10)]), discovery_every=5)
    unproven = [t for t in got if t.startswith("U")]
    assert unproven, "discovery was starved — eligibility became a closed loop"
    assert unproven == ["U0", "U1"], "discovery must take the HIGHEST-ranked unknowns"


def test_the_cap_is_still_exactly_respected():
    ref = [f"S{i}" for i in range(500)]
    got = uc.tail_cohort(ref, [], enabled=True, cap=2500,
                         has_5m=_cap(*ref[:100]), discovery_every=5)
    assert len(got) == 500
    assert len(uc.tail_cohort(ref, [], enabled=True, cap=20,
                              has_5m=_cap(*ref[:100]), discovery_every=5)) == 20


def test_selection_stays_deterministic():
    ref = [f"S{i}" for i in range(80)]
    dv = {s: 1e9 - i for i, s in enumerate(ref)}
    a = uc.tail_cohort(ref, [], enabled=True, cap=20, dollar_volume=dv,
                       has_5m=_cap(*ref[:30]), discovery_every=5)
    b = uc.tail_cohort(list(ref), [], enabled=True, cap=20, dollar_volume=dv,
                       has_5m=_cap(*ref[:30]), discovery_every=5)
    assert a == b


def test_no_duplicates_survive_capability_partitioning():
    ref = ["AAA", "AAA", "BBB"]
    got = uc.tail_cohort(ref, [], enabled=True, cap=10, has_5m=_cap("AAA"))
    assert len(got) == len(set(got))


def test_capability_evidence_does_not_require_freshness():
    """⚠️ `has_5m` says CAPABLE, not CURRENT. A symbol whose last 5m row is old is still
    proven-capable; freshness is `_is_cold_stale_intraday`'s job, checked elsewhere."""
    got = uc.tail_cohort(["OLD"], [], enabled=True, cap=1, has_5m=_cap("OLD"))
    assert got == ["OLD"]


def test_an_unreadable_store_keeps_the_rank_only_cohort():
    """⛔ FAIL OPEN. A lookup error must never empty or truncate the cohort."""
    def boom(_s):
        raise RuntimeError("database is locked")
    ref = ["AAA", "BBB", "CCC"]
    got = uc.tail_cohort(ref, [], enabled=True, cap=3, has_5m=boom)
    assert got == ["AAA", "BBB", "CCC"]


def test_the_capability_scan_is_bounded():
    """2,500 slots must not become 9,645 point lookups against a 26 GB store."""
    seen = []
    uc.tail_cohort([f"T{i}" for i in range(50_000)], [], enabled=True, cap=100,
                   has_5m=lambda s: (seen.append(s), False)[1], discovery_every=5)
    assert len(seen) <= 100 * 4 + 1, f"unbounded scan: {len(seen)} lookups"
