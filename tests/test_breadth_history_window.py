"""`get_history(days)` must not let `days` change what a date is worth.

The derivation loop reaches backward past the row it computes — `w10` wants 9
prior rows, `qqq_day_pct` wants 1, the `is_ftd` drawdown window reaches 15 — but
the fetch was `LIMIT days`. So the oldest rows of every request were derived
against a truncated window and the same calendar date came back different
depending on how much history the caller happened to ask for. Measured against
production on 2026-08-08, days=30 vs days=200 across their 30-day overlap:

    ratio_5day       4/30 disagreed   (2026-06-26: 3.77 vs 1.16)
    ratio_10day      9/30
    avg_10d_cpc      8/30             (None vs 0.92)
    adv_decline_cum 30/30             (1538 vs 11640)
    breadth_score    2/30             (89.9 vs 83.5)

`get_latest()` calls `get_history(1)`, which made it the worst caller in the
codebase rather than the safest.
"""
import json
import sqlite3

import pytest

from api.services import breadth_monitor as bm


@pytest.fixture(autouse=True)
def _isolated_db(tmp_path, monkeypatch):
    db = tmp_path / "breadth.db"
    monkeypatch.setattr(bm, "_db_path", lambda: str(db))

    class _NoCache:
        def get(self, *_a, **_k):
            return None

        def set(self, *_a, **_k):
            pass

        def delete_prefix(self, *_a, **_k):
            pass

    import api.services.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _NoCache())
    bm.init_db()
    yield db


def _seed(n=60):
    """n sessions of plausible, VARYING data — constants hide window bugs."""
    with sqlite3.connect(bm._db_path()) as c:
        for i in range(n):
            d = f"2026-{(i // 21) + 1:02d}-{(i % 21) + 1:02d}"
            m = {
                "up_4pct_today": 40 + (i * 7) % 60,
                "down_4pct_today": 20 + (i * 13) % 50,
                "cboe_putcall": round(0.70 + ((i * 3) % 40) / 100, 2),
                "adv_decline": (i * 17) % 400 - 150,
                "qqq_close": 400 + (i * 3) % 40,
                "spy_close": 500 + (i * 2) % 30,
                "new_52w_highs": 30 + i % 25,
                "new_52w_lows": 10 + i % 9,
                "universe_count": 3700,
                "pct_above_50sma": 40 + i % 25,
                "magna_up": 100 + i, "magna_down": 80 + i,
                "aaii_spread": -10 + i % 20,
                "vix": 15 + i % 8,
                "stage2_count": 1000 + i,
                "up_vol_ratio": 1.0 + (i % 9) / 10,
            }
            c.execute("INSERT OR REPLACE INTO breadth_snapshots(date, metrics) "
                      "VALUES (?, ?)", (d, json.dumps(m)))
        c.commit()


DERIVED = ["ratio_5day", "ratio_10day", "avg_10d_cpc", "adv_decline_cum",
           "breadth_score", "hi_ratio", "lo_ratio", "qqq_day_pct", "spy_day_pct",
           "is_ftd"]


def test_a_date_is_worth_the_same_no_matter_how_many_days_you_ask_for():
    _seed(60)
    short = {r["date"]: r for r in bm.get_history(10)}
    long_ = {r["date"]: r for r in bm.get_history(55)}
    assert short, "fixture produced no rows"

    mismatches = []
    for d in short:
        for f in DERIVED:
            a, b = short[d].get(f), long_[d].get(f)
            if a != b:
                mismatches.append(f"{d}.{f}: days=10 -> {a!r}, days=55 -> {b!r}")
    assert not mismatches, "derived values depend on the request:\n" + "\n".join(mismatches)


def test_the_requested_row_count_is_still_honoured():
    _seed(60)
    assert len(bm.get_history(10)) == 10
    assert len(bm.get_history(1)) == 1


def test_get_latest_is_fully_derived_not_a_one_row_window():
    """get_history(1) used to derive the newest row against itself alone."""
    _seed(60)
    latest = bm.get_latest()
    full = bm.get_history(55)[0]
    assert latest["date"] == full["date"]
    for f in DERIVED:
        assert latest.get(f) == full.get(f), (
            f"{f}: get_latest() -> {latest.get(f)!r} but a full read -> {full.get(f)!r}")


def test_day_pct_is_present_on_the_oldest_returned_row():
    """The i==0 branch nulls day_pct. With warm-up, only a row with genuinely
    nothing before it should be null."""
    _seed(60)
    oldest_returned = bm.get_history(10)[-1]
    assert oldest_returned["qqq_day_pct"] is not None
    assert oldest_returned["spy_day_pct"] is not None


def test_the_very_first_stored_session_still_has_no_prior_day():
    _seed(60)
    first = bm.get_history(500)[-1]
    assert first["qqq_day_pct"] is None, "nothing precedes the first snapshot"


def test_cumulative_ad_is_absolute_not_window_relative():
    _seed(60)
    rows = bm.get_history(500)
    asc = list(reversed(rows))
    running = 0
    for r in asc:
        ad = r.get("adv_decline")
        if ad is None:
            continue
        running += ad
        assert r["adv_decline_cum"] == running, (
            f"{r['date']}: cum {r['adv_decline_cum']} != running total {running}")


def test_cumulative_ad_seed_counts_rows_outside_the_fetch():
    _seed(60)
    tail = bm.get_history(5)
    full = bm.get_history(500)
    by_date = {r["date"]: r for r in full}
    for r in tail:
        assert r["adv_decline_cum"] == by_date[r["date"]]["adv_decline_cum"]
    # And it is not accidentally passing because the seed is zero.
    assert tail[-1]["adv_decline_cum"] != tail[-1]["adv_decline"]


def test_warmup_rows_are_never_returned():
    _seed(60)
    rows = bm.get_history(3)
    assert len(rows) == 3
    assert [r["date"] for r in rows] == [r["date"] for r in bm.get_history(500)[:3]]


def test_empty_store_does_not_raise():
    assert bm.get_history(30) == []
    assert bm.get_latest() is None
