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


# ── /recent historical cache: expiry + RTH-capped snapshots ───────────────────

def _recent(lmr_mod):
    return lmr_mod.recent_massive_alerts(
        limit=500, min_grade="D", target_date="10/2/2026", sort_by="recent",
        tier=None, curated=False, symbol=None, lookback_days=1)


def _wire(monkeypatch, *, market_open):
    calls = []

    def fake_compute(today, *a, **k):
        calls.append(today)
        return {"status": {"scan_capped": market_open}, "alerts": [len(calls)]}

    monkeypatch.setattr(lmr, "_recent_cache", {})
    monkeypatch.setattr(lmr, "_compute_recent", fake_compute)
    monkeypatch.setattr(lmr, "_log_startup_if_new", lambda: None)
    monkeypatch.setattr(lmr, "_today_mdyyyy", lambda: "10/5/2026")
    monkeypatch.setattr(lmr, "_in_market_hours", lambda *a: market_open)
    return calls


def test_historical_recent_entry_expires_after_ttl(monkeypatch):
    calls = _wire(monkeypatch, market_open=False)
    _recent(lmr)
    assert len(calls) == 1
    _recent(lmr)                       # fresh → served from cache
    assert len(calls) == 1
    (ck, (ts, payload)), = lmr._recent_cache.items()
    lmr._recent_cache[ck] = (ts - lmr._HISTORICAL_TTL - 1, payload)
    _recent(lmr)                       # expired → recomputed (was: served forever)
    assert len(calls) == 2


def test_rth_capped_snapshot_recomputes_after_close(monkeypatch):
    calls = _wire(monkeypatch, market_open=True)
    assert _recent(lmr)["status"]["scan_capped"] is True
    _recent(lmr)                       # still RTH → capped entry is fine
    assert len(calls) == 1
    monkeypatch.setattr(lmr, "_in_market_hours", lambda *a: False)
    _recent(lmr)                       # closed → full-day recompute
    assert len(calls) == 2


# ── Past-day scan: one LIMIT per source (healed 10/2) ─────────────────────────

def test_past_closed_scan_limits_each_source(monkeypatch, tmp_path):
    """Healed 10/2: 42.5k stock rows then 69.3k index rows (higher ids). A shared
    LIMIT starved stocks; past-closed must give each source its own LIMIT."""
    import sqlite3
    db = tmp_path / "flow.db"
    c = sqlite3.connect(db)
    c.execute("""CREATE TABLE flow (id INTEGER PRIMARY KEY, source TEXT,
        CreatedDate TEXT, CreatedTime TEXT, Symbol TEXT, Type TEXT, Volume TEXT,
        Price TEXT, Side TEXT, CallPut TEXT, Strike TEXT, Spot TEXT, Premium TEXT,
        ExpirationDate TEXT, Color TEXT, Dte TEXT, ER TEXT, StockEtf TEXT,
        Sector TEXT, Uoa TEXT, Weekly TEXT, MktCap TEXT, OI TEXT)""")
    rows = [("stocks", f"10:{i:02d}:00 AM") for i in range(30)] + \
           [("indexes", f"11:{i:02d}:00 AM") for i in range(50)]   # indexes inserted after
    for src, t in rows:
        c.execute("INSERT INTO flow (source, CreatedDate, CreatedTime, Symbol, Color, "
                  "Premium) VALUES (?, '10/2/2026', ?, 'X', 'YELLOW', '1000')", (src, t))
    c.commit()
    c.close()

    seen = {}

    def fake_row_to_alert(r, **k):
        seen.setdefault(r["source"], 0)
        seen[r["source"]] += 1
        return None

    monkeypatch.setattr(lmr, "DB_PATH", str(db))
    monkeypatch.setattr(lmr, "_today_mdyyyy", lambda: "10/5/2026")
    monkeypatch.setattr(lmr, "_in_market_hours", lambda *a: False)
    monkeypatch.setattr(lmr, "_maybe_refresh_dormant", lambda: None)
    monkeypatch.setattr(lmr, "_row_to_alert", fake_row_to_alert)
    monkeypatch.setattr(lmr, "_load_thresholds", lambda: {
        "etf_enabled": True, "close_detector_enabled": False,
        "alpha_leaps_enabled": False, "ask_accum_enabled": False,
        "incremental_scan": False})
    monkeypatch.setenv("MASSIVE_RECENT_SQL_CAP_WIDE", "40")

    _, meta = lmr._compute_recent_core("10/2/2026", 500, "D", "recent", None, False)
    assert seen == {"stocks": 30, "indexes": 40}   # shared LIMIT 40 would give stocks 0
    assert meta["scan_capped"] is True and meta["scan_capped_rth"] is False
