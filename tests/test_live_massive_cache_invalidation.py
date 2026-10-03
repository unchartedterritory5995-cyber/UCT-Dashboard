"""A T+1 heal must drop Live Flow's cached snapshot of the healed day.

10/03/2026: after gap-fill run 352 healed 10/2, Live Flow kept serving the
pre-heal /recent (empty table) and /worker-history ("FEED GAP 9:31 AM–4:00 PM")
from the 6h historical cache, while /day-stats (30s TTL) already showed 9,381
alerts. flow_router.bump_data_version() never reached those caches.
"""
from api import live_massive_router as lmr
from api import flow_gap_autofill as gf


def _seed(monkeypatch):
    caches = {
        "_recent_cache": {("10/2/2026", 500, "D", "recent", None, False): (1, "old"),
                          ("10/1/2026", 500, "D", "recent", None, False): (1, "keep")},
        "_recent_last_good": {("10/2/2026", 500, "D", "recent", None, False): "old"},
        "_day_stats_cache": {("10/2/2026", False, "all"): (1, "old")},
        "_by_contract_cache": {("10/2/2026", "stocks", 2, False): (1, "old")},
        "_diagnostic_cache": {"10/2/2026": (1, "old"), "10/1/2026": (1, "keep")},
        "_cream_cache": {"10/2/2026": (1, "old")},
        "_worker_history_cache": {("10/2/2026", 2): (1, "old"),
                                  ("10/1/2026", 2): (1, "keep")},
        "_symbol_recent_cache": {("NVDA", "10/3/2026", 5): (1, "old")},
        "_multiday_recent_cache": {("10/3/2026", 5): (1, "old")},
    }
    for name, val in caches.items():
        monkeypatch.setattr(lmr, name, val)
    return caches


def test_invalidate_drops_only_the_healed_date(monkeypatch):
    c = _seed(monkeypatch)
    dropped = lmr.invalidate_date_caches("10/2/2026")
    assert dropped == 9
    assert list(c["_recent_cache"].values()) == [(1, "keep")]
    assert c["_recent_last_good"] == {}
    assert c["_day_stats_cache"] == {}
    assert c["_by_contract_cache"] == {}
    assert c["_diagnostic_cache"] == {"10/1/2026": (1, "keep")}
    assert c["_cream_cache"] == {}
    assert c["_worker_history_cache"] == {("10/1/2026", 2): (1, "keep")}
    # multi-day windows span the healed date → cleared whole
    assert c["_symbol_recent_cache"] == {} and c["_multiday_recent_cache"] == {}


def test_invalidate_accepts_iso_dates(monkeypatch):
    c = _seed(monkeypatch)
    lmr.invalidate_date_caches("2026-10-02")
    assert ("10/2/2026", 2) not in c["_worker_history_cache"]


def test_gap_fill_version_bump_invalidates_the_date(monkeypatch):
    c = _seed(monkeypatch)
    gf._bump_version("10/2/2026")
    assert ("10/2/2026", 2) not in c["_worker_history_cache"]
    assert ("10/1/2026", 2) in c["_worker_history_cache"]


def test_bump_without_date_leaves_caches_alone(monkeypatch):
    c = _seed(monkeypatch)
    gf._bump_version()
    assert ("10/2/2026", 2) in c["_worker_history_cache"]
