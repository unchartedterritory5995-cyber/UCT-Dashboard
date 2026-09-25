"""Deep 5m slots must go to symbols we can actually make ready — without exile.

⛔⛔ THE DEFECT, MEASURED ON PRODUCTION 2026-09-24. `rank_intraday_candidates` orders
by 20-session average dollar volume — the right question, "who would we most like
ready?" — but only that one. **IVV ranked TOP-5** and the store holds NO 5m rows for
it at all; likewise IJR / EWJ / AVUV / AVEM / BIV / CGGR, all of which have DAILY
data. MU / INTC / SNDK are current. So scarce deep slots were spent repeatedly
re-proving that a high-volume symbol cannot produce a usable 5m series.

⭐ THE EVIDENCE WAS ALREADY THERE AND FREE. A 5m row only reaches `ohlcv` after
passing `fetch_with_validation`, so stored 5m bars ARE proof of capability — durable
across restarts, readable with an INDEXED point lookup. No new table, no registry,
no blacklist, no hardcoded ticker.

⛔ AND THE OBVIOUS FILTER IS A TRAP: admit only proven symbols and you get
never fetched -> never proven -> never eligible -> never fetched. A new listing could
never enter. So this is NOT a filter: every Nth slot is RESERVED for the
highest-ranked UNKNOWN.
"""
from __future__ import annotations

from api.services.bars_prewarm import select_5m_deep_cohort as select


def _has(*syms):
    known = set(syms)
    return lambda s: s in known


RANKED = [f"S{i}" for i in range(60)]


def test_proven_capable_symbols_take_most_of_the_cohort():
    out = select(RANKED, 10, has_5m=_has(*RANKED[:20]), discovery_every=5)
    assert len(out) == 10
    assert sum(1 for t in out if t in set(RANKED[:20])) == 8


def test_a_discovery_slot_is_reserved_so_unknowns_can_ever_be_proven():
    """⛔⛔ THE ANTI-CIRCULARITY RAIL. Without this, a symbol with no rows can never
    get rows, and a newly listed security is locked out permanently."""
    out = select(RANKED, 10, has_5m=_has(*RANKED[:20]), discovery_every=5)
    unknown = [t for t in out if t not in set(RANKED[:20])]
    assert unknown, "no discovery slot: eligibility became a closed loop"
    assert unknown == ["S20", "S21"], "discovery must take the HIGHEST-ranked unknowns"


def test_a_symbol_with_daily_but_no_5m_is_not_assumed_capable():
    """IVV's exact shape: highly ranked, daily present, zero 5m rows."""
    out = select(["IVV"] + RANKED[:20], 5, has_5m=_has(*RANKED[:20]), discovery_every=99)
    assert "IVV" not in out


def test_an_ETF_with_valid_5m_stays_eligible():
    """⚠️ NO CATEGORY BLACKLIST. SOXL/KORU/COPX have real 5m; instrument type is never
    the rule — stored evidence is."""
    out = select(["SOXL", "IVV", "MU"], 2, has_5m=_has("SOXL", "MU"), discovery_every=99)
    assert out == ["SOXL", "MU"]


def test_a_common_stock_without_5m_is_not_automatically_eligible():
    out = select(["NODATA", "MU"], 1, has_5m=_has("MU"), discovery_every=99)
    assert out == ["MU"]


def test_eligibility_is_recoverable_the_moment_rows_appear():
    """⭐ NOTHING IS PERMANENT. The only negative signal is "no rows yet", which any
    successful crawl erases — so the paced crawler promotes symbols automatically."""
    before = select(["IVV", "MU"], 1, has_5m=_has("MU"), discovery_every=99)
    after = select(["IVV", "MU"], 1, has_5m=_has("MU", "IVV"), discovery_every=99)
    assert before == ["MU"] and after == ["IVV"]


def test_one_transient_failure_cannot_exclude_anything():
    """There is no failure counter here at all: a symbol that still HAS rows stays
    capable no matter how many recent fetches failed."""
    out = select(["FLAKY"], 1, has_5m=_has("FLAKY"), discovery_every=99)
    assert out == ["FLAKY"]


def test_the_cohort_never_exceeds_the_cap():
    assert len(select(RANKED, 600, has_5m=_has(*RANKED), discovery_every=7)) == len(RANKED)
    assert len(select(RANKED, 5, has_5m=_has(*RANKED), discovery_every=7)) == 5


def test_slots_are_never_left_empty_when_candidates_remain():
    """If one queue runs dry the other fills the cohort — a half-empty deep cohort
    would be a silent capacity regression."""
    out = select(RANKED[:12], 10, has_5m=_has("S0"), discovery_every=5)
    assert len(out) == 10


def test_all_unknown_still_fills_the_cohort():
    out = select(RANKED[:12], 10, has_5m=_has(), discovery_every=5)
    assert len(out) == 10


def test_the_cohort_is_deterministic_across_boots():
    a = select(RANKED, 20, has_5m=_has(*RANKED[:30]), discovery_every=7)
    b = select(RANKED, 20, has_5m=_has(*RANKED[:30]), discovery_every=7)
    assert a == b, "a churning cohort re-buys itself every boot"


def test_an_unreadable_store_keeps_the_rank_only_cut_rather_than_emptying_it():
    """⛔ FAIL OPEN. If the capability lookup throws, the old dollar-volume behaviour
    must survive — never an empty or truncated deep cohort."""
    def boom(_s):
        raise RuntimeError("database is locked")
    out = select(RANKED, 10, has_5m=boom, discovery_every=7)
    assert out == RANKED[:10]


def test_the_scan_is_bounded_and_does_not_walk_the_whole_universe():
    """600 slots must not cost 9,433 point lookups against a 26 GB store."""
    seen = []
    def counting(s):
        seen.append(s)
        return False
    select([f"T{i}" for i in range(50_000)], 100, has_5m=counting, discovery_every=7)
    assert len(seen) <= 100 * 4 + 1, f"unbounded scan: {len(seen)} lookups for 100 slots"


def test_a_zero_or_negative_cap_yields_nothing():
    assert select(RANKED, 0, has_5m=_has(*RANKED)) == []
    assert select(RANKED, -1, has_5m=_has(*RANKED)) == []
