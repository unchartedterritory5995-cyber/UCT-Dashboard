"""Deep-history merge: the Monitor read reaches before the collector floor by
assembling reconstructed rows from `breadth_daily_ohlc` + imported sentiment,
while a window inside the collector range stays byte-identical to `get_history`.
"""
import json
import sqlite3

import pytest


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    # Point every store at a throwaway DB and reset the modules' init latches.
    monkeypatch.setenv("BREADTH_OHLC_DB", str(tmp_path / "ohlc.db"))
    monkeypatch.setenv("BREADTH_SENTIMENT_DB", str(tmp_path / "sent.db"))
    monkeypatch.setenv("BREADTH_DEEP_HISTORY", "1")

    from api.services import breadth_monitor as bm
    from api.services import breadth_daily_ohlc as ohlc
    from api.services import breadth_sentiment_history as sent

    monkeypatch.setattr(bm, "_db_path", lambda: str(tmp_path / "monitor.db"))
    monkeypatch.setattr(bm, "_DEEP_ENABLED", True)
    ohlc._INIT_DONE = False
    sent._INIT_DONE = False

    class _NoCache:
        def get(self, *_a, **_k): return None
        def set(self, *_a, **_k): pass
        def delete_prefix(self, *_a, **_k): pass
    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())

    bm.init_db()
    yield {"bm": bm, "ohlc": ohlc, "sent": sent, "tmp": tmp_path}


# ── seeding helpers ───────────────────────────────────────────────────────────

def _collector_metrics(i):
    return {
        "up_4pct_today": 200 + i, "down_4pct_today": 100 + i,
        "pct_above_50sma": 55 + (i % 10), "adv_decline": (i * 11) % 300 - 100,
        "new_52w_highs": 120 + i, "new_52w_lows": 30 + i, "universe_count": 3700,
        "qqq_close": 400 + i, "sp500_close": 5000 + i, "vix": 15 + (i % 6),
        "up_vol_ratio": 1.1, "uct_exposure": 60,
        "aaii_bulls": 40, "aaii_bears": 30, "cboe_putcall": 0.9, "cnn_fear_greed": 55,
    }


def _seed_collector(bm, dates):
    with sqlite3.connect(bm._db_path()) as c:
        for i, d in enumerate(dates):
            c.execute("INSERT OR REPLACE INTO breadth_snapshots(date, metrics) VALUES (?,?)",
                      (d, json.dumps(_collector_metrics(i))))
        c.commit()


def _seed_recon(ohlc, dates):
    # close_recon bodies for the base metrics a Monitor row needs, per date.
    rows = []
    for i, d in enumerate(dates):
        base = {
            "pct_above_50sma": 40 + (i % 30), "up_4pct_today": 150 + i,
            "down_4pct_today": 80 + i, "adv_decline": (i * 7) % 400 - 150,
            "new_52w_highs": 90 + i, "new_52w_lows": 20 + i, "universe_count": 3200,
            "qqq_close": 100 + i, "sp500_close": 2000 + i, "vix": 18 + (i % 5),
            "up_vol_ratio": 1.0,
        }
        for m, v in base.items():
            rows.append((d, m, v, v, v, v))
    ohlc.write_bulk(rows, source="close_recon")


# 2015 recon dates (contiguous-ish) + a Jan-2026 collector block.
RECON = [f"2015-06-{dd:02d}" for dd in range(1, 26)]           # 2015-06-01..25
COLL = [f"2026-01-{dd:02d}" for dd in range(2, 16)]            # 2026-01-02..15


def test_latest_window_is_identical_to_plain_get_history(_isolated):
    bm, ohlc = _isolated["bm"], _isolated["ohlc"]
    _seed_collector(bm, COLL)
    _seed_recon(ohlc, RECON)
    plain = bm.get_history(10)
    deep = bm.get_history_deep(10)
    assert [r["date"] for r in deep] == [r["date"] for r in plain]
    # And the values match on the settled window (deep delegated).
    assert deep[0]["breadth_score"] == plain[0]["breadth_score"]
    assert all(not r.get("_reconstructed") for r in deep), "collector rows are not reconstructed"


def test_a_deep_window_returns_reconstructed_rows_from_the_ohlc_store(_isolated):
    bm, ohlc = _isolated["bm"], _isolated["ohlc"]
    _seed_collector(bm, COLL)
    _seed_recon(ohlc, RECON)
    deep = bm.get_history_deep(8, end="2015-06-20", anchor="le")
    assert deep, "deep window returned nothing"
    assert deep[0]["date"] == "2015-06-20", "the end date is the top row"
    assert all(r["date"] <= "2015-06-20" for r in deep)
    assert all(r.get("_reconstructed") for r in deep), "pre-collector rows are flagged"
    # Reconstructed percentage metric came through, and a derived metric was computed.
    top = deep[0]
    assert top.get("pct_above_50sma") is not None
    assert top.get("breadth_score") is not None
    assert top.get("ratio_5day") is not None


def test_year_jump_lands_on_the_first_reconstructed_session_of_that_year(_isolated):
    bm, ohlc = _isolated["bm"], _isolated["ohlc"]
    _seed_collector(bm, COLL)
    _seed_recon(ohlc, RECON)
    deep = bm.get_history_deep(5, end="2015-01-01", anchor="ge")
    assert deep[0]["date"] == "2015-06-01", "ge snaps up to the first 2015 session we hold"


def test_sentiment_is_overlaid_onto_reconstructed_rows(_isolated):
    bm, ohlc, sent = _isolated["bm"], _isolated["ohlc"], _isolated["sent"]
    _seed_collector(bm, COLL)
    _seed_recon(ohlc, RECON)
    # A weekly AAII survey dated the 15th should forward-fill to the 18th; a daily
    # put/call dated the 18th lands exactly.
    sent.upsert_many([
        ("2015-06-15", "aaii_bulls", 41.0),
        ("2015-06-15", "aaii_bears", 29.0),
        ("2015-06-15", "aaii_spread", 12.0),
        # daily put/call across several sessions so the 10-day average (which
        # needs ≥3 readings) can be derived
        ("2015-06-16", "cboe_putcall", 0.81),
        ("2015-06-17", "cboe_putcall", 0.85),
        ("2015-06-18", "cboe_putcall", 0.77),
        ("2015-06-18", "cnn_fear_greed", 62.0),
    ])
    row = next(r for r in bm.get_history_deep(10, end="2015-06-18", anchor="le")
               if r["date"] == "2015-06-18")
    assert row["aaii_bulls"] == 41.0          # forward-filled from the 15th
    assert row["cboe_putcall"] == 0.77        # exact same-day
    assert row["cnn_fear_greed"] == 62.0
    # And the 10-day put/call average (derived) picked the imported value up.
    assert row.get("avg_10d_cpc") is not None


def test_bounds_and_next_day_span_the_merged_history(_isolated):
    bm, ohlc = _isolated["bm"], _isolated["ohlc"]
    _seed_collector(bm, COLL)
    _seed_recon(ohlc, RECON)
    b = bm.date_bounds()
    assert b["min"] == "2015-06-01", "the calendar floor reaches the reconstructed history"
    assert b["max"] == "2026-01-15", "the ceiling stays the latest collected day"
    # ▶ step forward walks the merged set.
    assert bm.next_trading_day("2015-06-10") == "2015-06-11"
    assert bm.next_trading_day("2015-06-25") == "2026-01-02", "steps across the gap to the collector era"


def test_a_developing_ohlc_bar_above_the_collector_max_never_leaks_into_the_index(_isolated):
    """Regression (2026-09-01): the breadth CHART store (`breadth_daily_ohlc`) carries
    a DEVELOPING bar for TODAY, one session past the last collected day. Unioning it
    into the timeline index put a `today` slot into `/dates` + pushed `date_bounds.max`
    to today, but `get_history` (breadth_snapshots) has no row for it — so the Monitor
    rendered a permanent all-dashes top row whenever the client's live row was withheld
    (superseded / a slow /live fetch). The reconstructed store must supply ONLY the deep
    past (below the collector floor); today's row is owned solely by the live row.
    """
    bm, ohlc = _isolated["bm"], _isolated["ohlc"]
    _seed_collector(bm, COLL)                       # ...through 2026-01-15
    _seed_recon(ohlc, RECON)                        # 2015 deep history
    # A single developing chart bar for "today" = one day past the collector max.
    ohlc.write_bulk([("2026-01-16", "pct_above_50sma", 50, 50, 50, 50)],
                    source="close_recon")

    assert "2026-01-16" not in bm.merged_dates(), "a developing today-bar must not enter the index"
    assert bm.date_bounds()["max"] == "2026-01-15", "the ceiling stays the last COLLECTED day"
    assert bm.next_trading_day("2026-01-15") is None, "no ▶ step onto the developing bar"
    # The deep floor is still reached (recon below the collector floor is untouched).
    assert bm.date_bounds()["min"] == "2015-06-01"
    # The latest Monitor window still tops at the last collected day, unchanged.
    assert bm.get_history_deep(10)[0]["date"] == "2026-01-15"


def test_deep_flag_off_falls_back_to_collector_only(_isolated, monkeypatch):
    bm, ohlc = _isolated["bm"], _isolated["ohlc"]
    _seed_collector(bm, COLL)
    _seed_recon(ohlc, RECON)
    monkeypatch.setattr(bm, "_DEEP_ENABLED", False)
    deep = bm.get_history_deep(8, end="2015-06-20", anchor="le")
    # With deep off, it delegates to get_history, which only knows collector dates,
    # so an end far before the collector floor clamps to the earliest collected day.
    assert all(r["date"] >= "2026-01-02" for r in deep)
    assert bm.date_bounds()["min"] == "2026-01-02"
