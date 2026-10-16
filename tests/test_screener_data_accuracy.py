"""Screener data-accuracy fixes (audit 2026-10-15, #1-#4).

#1  a row whose OWN bars stopped is not scanned (query-time; nothing deleted)
#2  a window statistic needs its window (52w / ATH / ADR / 20d on short history)
#3  security type fails CLOSED and `is_etf` derives from it (one authority)
#4  a plain sort has a deterministic `ticker ASC` tiebreak, so paging is total

Every database here is a tmp file under `SCREENER_DB_PATH`; nothing reads
`C:\\data` and nothing touches a provider.
"""
import datetime as dt

import pytest


# ── helpers ──────────────────────────────────────────────────────────────────

def _db(monkeypatch, tmp_path, rows):
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "s.db"))
    monkeypatch.delenv("SCREENER_STALE_PRICE_SESSIONS", raising=False)
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    from api.services.screener import snapshot_db
    snapshot_db.init_db()
    snapshot_db.upsert_rows(rows)
    return snapshot_db


def _row(ticker, bars_asof, **kw):
    r = {"ticker": ticker, "price": 50.0, "rsi14": 60.0, "uct_composite": 70,
         "snapshot_date": "2026-10-15", "bars_asof": bars_asof}
    r.update(kw)
    return r


def _bars(n, start=dt.date(2024, 1, 2), c=100.0):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append({"t": int(d.strftime("%Y%m%d")), "o": c, "h": c + 1.0,
                        "l": c - 1.0, "c": c, "v": 1000})
        d += dt.timedelta(days=1)
    return out


#: Fresh = the snapshot's newest bar; DEAD = ~5 weeks of weekdays behind it.
FRESH, ONE_BEHIND, DEAD = "20261014", "20261013", "20260901"


# ═══ #1 — stale rows are excluded from scans ═════════════════════════════════

def test_a_row_whose_bars_stopped_is_not_scanned_and_total_agrees(monkeypatch, tmp_path):
    db = _db(monkeypatch, tmp_path, [
        _row("AAA", FRESH), _row("BBB", ONE_BEHIND), _row("DED", DEAD),
        _row("NOB", None, price=None)])                 # never had bars at all
    from api.services.screener import query
    out = query.run_scan({"columns": ["price"]})
    got = {r["ticker"] for r in out["rows"]}
    assert got == {"AAA", "BBB", "NOB"}, got
    assert out["total"] == 3                             # rows and total agree
    assert out["snapshot"]["stale"] == {
        "excluded": 1, "max_sessions": 10,
        "newest_bars_asof": "2026-10-14", "cutoff": out["snapshot"]["stale"]["cutoff"]}
    # ⭐ NOTHING IS DELETED — the record keeps its row and its date.
    assert db.get_row("DED")["bars_asof"] == DEAD


def test_the_count_route_excludes_the_same_rows(monkeypatch, tmp_path):
    _db(monkeypatch, tmp_path, [_row("AAA", FRESH), _row("DED", DEAD)])
    from api.services.screener import query
    spec = {"filters": [{"key": "price", "op": "gte", "min": 1}]}
    assert query.preview_count(spec)["count"] == query.run_scan(spec)["total"] == 1


def test_a_filter_cannot_bring_a_stale_row_back(monkeypatch, tmp_path):
    _db(monkeypatch, tmp_path, [_row("AAA", FRESH, rsi14=40.0), _row("DED", DEAD, rsi14=90.0)])
    from api.services.screener import query
    out = query.run_scan({"filters": [{"key": "rsi14", "op": "gte", "min": 80}]})
    assert out["rows"] == [] and out["total"] == 0
    assert out["snapshot"]["stale"]["excluded"] == 1     # it matched, and was excluded


def test_the_ranked_path_excludes_them_too(monkeypatch, tmp_path):
    _db(monkeypatch, tmp_path, [_row("AAA", FRESH), _row("DED", DEAD)])
    from api.services.screener import query
    out = query.run_scan({"rank": {"criteria": [{"key": "rsi14", "weight": 1}]}})
    assert [r["ticker"] for r in out["rows"]] == ["AAA"]


def test_behind_is_measured_against_the_SNAPSHOT_not_the_wall_clock(monkeypatch, tmp_path):
    """A nightly build that failed for weeks must not empty every screen: every
    row being equally old is a disclosed outage (the Seal dates it), not a
    reason to exclude them all."""
    _db(monkeypatch, tmp_path, [_row("AAA", "20250103"), _row("BBB", "20250102")])
    from api.services.screener import query
    out = query.run_scan({})
    assert out["total"] == 2
    assert "stale" not in out["snapshot"]


def test_when_nothing_is_behind_the_statement_is_the_ungated_one(monkeypatch, tmp_path):
    _db(monkeypatch, tmp_path, [_row("AAA", FRESH), _row("BBB", ONE_BEHIND)])
    from api.services.screener import query, snapshot_db
    with snapshot_db.connect() as conn:
        plan = query.build_scan_sql({}, query.OFF, conn=conn)
        assert query.stale_gate(conn) is None
    assert "bars_asof" not in plan["sql"]
    assert plan["sql"] == query.build_scan_sql({}, query.OFF)["sql"]


def test_the_threshold_is_the_builders_own(monkeypatch, tmp_path):
    """One authority: widening `SCREENER_STALE_PRICE_SESSIONS` (the builder's
    knob) is what keeps a 30-session-old row in the scan."""
    _db(monkeypatch, tmp_path, [_row("AAA", FRESH), _row("DED", DEAD)])
    monkeypatch.setenv("SCREENER_STALE_PRICE_SESSIONS", "60")
    from api.services.screener import query
    assert query.run_scan({})["total"] == 2


def test_the_cutoff_is_the_predicates_own_boundary(monkeypatch, tmp_path):
    """The oldest kept date is the oldest `price_is_stale` calls fresh, and the
    day before it is stale — found by walking the predicate, never restated."""
    from api.services.screener import query, snapshot_builder
    _db(monkeypatch, tmp_path, [_row("AAA", FRESH), _row("DED", DEAD)])
    from api.services.screener import snapshot_db
    with snapshot_db.connect() as conn:
        gate = query.stale_gate(conn)
    ref = int(FRESH)
    cut = dt.datetime.strptime(str(gate["cutoff"]), "%Y%m%d").date()
    before = int((cut - dt.timedelta(days=1)).strftime("%Y%m%d"))
    assert snapshot_builder.price_is_stale(gate["cutoff"], ref) is False
    assert snapshot_builder.price_is_stale(before, ref) is True


def test_coverage_books_the_excluded_rows_as_DROPPED_and_closes(monkeypatch, tmp_path):
    _db(monkeypatch, tmp_path, [
        _row("AAA", FRESH), _row("GAP", FRESH, rsi14=None), _row("DED", DEAD)])
    from api.services.screener import query
    cov = query.coverage_for({"filters": [{"key": "rsi14", "op": "gte", "min": 50}]})
    assert (cov["evaluated"], cov["answered"], cov["dropped"], cov["not_computable"]) \
        == (3, 1, 1, 1)
    reasons = {e["ticker"]: e["reason"] for e in cov["dropped_symbols"]}
    assert reasons == {"DED": "dropped", "GAP": "not-computable"}
    ded = next(e for e in cov["dropped_symbols"] if e["ticker"] == "DED")
    assert "2026-09-01" in ded["detail"]


# ═══ #4 — the tiebreak ═══════════════════════════════════════════════════════

def test_ties_page_through_every_row_exactly_once(monkeypatch, tmp_path):
    tickers = ["MMM", "AAA", "ZZZ", "KKK", "BBB", "QQQ", "CCC"]
    _db(monkeypatch, tmp_path, [_row(t, FRESH, rsi14=50.0) for t in tickers])
    from api.services.screener import query
    seen = []
    for page in range(1, len(tickers) + 1):
        out = query.run_scan({"columns": ["rsi14"], "sort": {"key": "rsi14", "dir": "desc"},
                              "page": page, "page_size": 1})
        seen += [r["ticker"] for r in out["rows"]]
    assert seen == sorted(tickers)


def test_the_tiebreak_is_rendered_through_col_expr_with_the_overlay_on():
    from api.services.screener import query
    on = query._Overlay(on=True, columns={"price"}, table="screener_live",
                        predicate="1=1")
    sql = query.build_scan_sql({"sort": {"key": "price"}}, on)["sql"]
    assert sql.endswith('NULLS LAST, screener_rows."ticker" ASC LIMIT ? OFFSET ?')
    # sorting BY ticker needs no second key
    assert ", " not in query.build_scan_sql(
        {"sort": {"key": "ticker"}}, query.OFF)["sql"].split("ORDER BY")[1]


# ═══ #2 — short histories ════════════════════════════════════════════════════

def test_a_fortnight_of_bars_publishes_no_year_statistics():
    from api.services.screener import technicals
    bars = _bars(15)
    out = technicals.compute_technicals(bars)
    assert out["price"] == 100.0                         # the bar facts still land
    for col in ("dist_52w_high_pct", "dist_52w_low_pct", "adr_pct",
                "dist_20d_high_pct", "dist_20d_low_pct"):
        assert out[col] is None, col
    assert out["new_52w_high"] is None                   # not False: unknown
    ath = technicals.ath_fields(bars)
    assert ath == {"dist_ath_pct": None, "new_ath": None}


def test_each_window_lights_up_exactly_at_its_length():
    from api.services.screener import technicals
    assert technicals.compute_technicals(_bars(20))["adr_pct"] is None
    assert technicals.compute_technicals(_bars(21))["adr_pct"] is not None
    assert technicals.compute_technicals(_bars(19))["dist_20d_high_pct"] is None
    assert technicals.compute_technicals(_bars(20))["dist_20d_high_pct"] is not None
    assert technicals.compute_technicals(_bars(251))["dist_52w_high_pct"] is None
    full = technicals.compute_technicals(_bars(252))
    assert full["dist_52w_high_pct"] is not None and full["new_52w_high"] is not None
    assert technicals.ath_fields(_bars(251))["dist_ath_pct"] is None
    assert technicals.ath_fields(_bars(252))["dist_ath_pct"] is not None


def test_a_genuine_recent_listing_keeps_its_whole_life_as_the_window():
    from api.services.screener import technicals
    bars = _bars(100, start=dt.date(2026, 5, 4))
    out = technicals.compute_technicals(bars, ipo_date="2026-05-01")
    assert out["dist_52w_high_pct"] is not None and out["new_52w_high"] is not None
    assert technicals.ath_fields(bars, ipo_date="2026-05-01")["dist_ath_pct"] is not None


def test_a_short_series_of_an_OLD_listing_is_a_hole_not_a_life():
    """TSLA's shape: listed in 2010, 15 bars held. The listing date proves the
    short series is OUR gap, so nothing is published."""
    from api.services.screener import technicals
    bars = _bars(15, start=dt.date(2026, 9, 21))
    for ipo in ("2010-06-29", None, "", "not-a-date"):
        out = technicals.compute_technicals(bars, ipo_date=ipo)
        assert out["dist_52w_high_pct"] is None, ipo
        assert technicals.ath_fields(bars, ipo_date=ipo)["dist_ath_pct"] is None, ipo


def test_build_row_hands_the_rows_listing_date_to_the_window_rule():
    from api.services.screener import snapshot_builder
    bars = _bars(100, start=dt.date(2026, 5, 4))
    listed = snapshot_builder.build_row("NEWCO", bars, None, None,
                                        bulk_row={"ipo_date": "2026-05-01"})
    unlisted = snapshot_builder.build_row("OLDCO", bars, None, None)
    assert listed["dist_52w_high_pct"] is not None and listed["dist_ath_pct"] is not None
    assert unlisted["dist_52w_high_pct"] is None and unlisted["dist_ath_pct"] is None


# ═══ #3 — security type fails closed; is_etf has one authority ═══════════════

@pytest.fixture
def _types(monkeypatch):
    from api.services.screener import snapshot_builder

    def set_map(m):
        monkeypatch.setattr(snapshot_builder, "_SECURITY_TYPES_CACHE", dict(m))
    return set_map


def test_an_unmapped_ticker_is_NULL_not_Stock(_types):
    from api.services.screener import snapshot_builder
    _types({})
    row = snapshot_builder.build_row("SPY", _bars(30), None, None)
    assert row["security_type"] is None and row["is_etf"] is None


def test_is_etf_is_derived_from_security_type_and_nothing_overrides_it(_types):
    from api.services.screener import snapshot_builder
    _types({"SPY": "ETF", "AAPL": "Stock", "TSM": "ADR"})
    got = {t: snapshot_builder.build_row(
               t, _bars(30), None, None, context_row={"is_etf": t == "AAPL"})
           for t in ("SPY", "AAPL", "TSM")}
    assert {t: (r["security_type"], r["is_etf"]) for t, r in got.items()} == {
        "SPY": ("ETF", True), "AAPL": ("Stock", False), "TSM": ("ADR", False)}


def test_coarse_type_returns_None_for_a_name_nobody_typed():
    from api.services.screener import screener_universe as su
    assert su._coarse_type("XYZ", {}, set()) is None
    assert su._coarse_type("SPY", {}, {"SPY"}) == "ETF"
    assert su._coarse_type("AAA", {"AAA": "CS"}, set()) == "Stock"


def test_the_written_type_map_omits_unknowns_and_types_drops_non_buckets(tmp_path, monkeypatch):
    import json
    from api.services.screener import screener_universe as su
    p = tmp_path / "types.json"
    p.write_text(json.dumps({"AAA": "Stock", "BBB": None, "CCC": "ETF", "DDD": "Fund"}))
    monkeypatch.setenv("SCREENER_TYPES_PATH", str(p))
    assert su.types() == {"AAA": "Stock", "CCC": "ETF"}


def test_build_and_save_never_writes_an_untyped_name_as_a_bucket(tmp_path, monkeypatch):
    import json
    from api.services.screener import screener_universe as su
    monkeypatch.setenv("SCREENER_UNIVERSE_PATH", str(tmp_path / "u.json"))
    monkeypatch.setenv("SCREENER_TYPES_PATH", str(tmp_path / "t.json"))
    monkeypatch.setattr("api.services.massive.list_reference_tickers",
                        lambda active=True, market="stocks": [{"ticker": "AAA", "type": "CS"}])
    monkeypatch.setattr("api.services.massive.get_grouped_daily_ohlcv",
                        lambda day, adjusted=False: {"AAA": {"v": 1e6}})
    # QQQ is in the curated cap universe — which really does hold ETFs — and
    # nothing typed it: it must NOT come out "Stock".
    monkeypatch.setattr("api.services.cap_universe.symbols", lambda: frozenset({"QQQ"}))
    monkeypatch.setattr("api.services.cap_universe.etf_symbols", lambda: frozenset())
    monkeypatch.setattr(su, "buyout_excludes", lambda: frozenset())
    out = su.build_and_save(min_shares=1000, sessions=1)
    written = json.loads((tmp_path / "t.json").read_text())
    assert written == {"AAA": "Stock"} and out["untyped"] == 1
    assert "QQQ" in su.symbols()                          # still in the universe
