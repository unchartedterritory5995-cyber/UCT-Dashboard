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
    # The Time Navigator helpers must be just as unbothered by an empty store.
    assert bm.date_bounds() == {"min": None, "max": None}
    assert bm.next_trading_day("2026-01-01") is None


# ── Time Navigator: end/anchor teleport window ────────────────────────────────
# The Monitor's date box moves WHERE a fixed-width window ends. The window is
# still derived backward, so a dated read must agree with the latest read on the
# same date — the whole "a date is worth the same" invariant, now under `end`.


def test_end_puts_the_named_session_at_the_top_row():
    _seed(60)
    full = bm.get_history(60)
    # Pick a real interior session as the target.
    target = full[20]["date"]
    win = bm.get_history(10, end=target)
    assert win[0]["date"] == target, "the end date must be the newest returned row"
    # And nothing newer than the target leaked into the window.
    assert all(r["date"] <= target for r in win)


def test_end_le_snaps_down_to_the_last_session_on_or_before():
    _seed(60)
    full = bm.get_history(60)
    # The fixture jumps 2026-01-21 → 2026-02-01, so 2026-01-25 is a non-session
    # day inside the gap. anchor='le' must land on the last real bar before it.
    assert "2026-01-21" in {r["date"] for r in full}
    assert "2026-01-25" not in {r["date"] for r in full}
    win = bm.get_history(5, end="2026-01-25")
    assert win[0]["date"] == "2026-01-21"
    # A target past the newest data clamps to the latest rather than returning nothing.
    future = bm.get_history(5, end="2099-12-31")
    assert future[0]["date"] == full[0]["date"], "a future end clamps to the latest"
    # A target before the oldest data clamps to the earliest.
    early = bm.get_history(5, end="1990-01-01")
    assert early[0]["date"] == full[-1]["date"], "a pre-history end clamps to the earliest"


def test_end_ge_lands_on_the_first_session_of_a_year():
    """Year jump: anchor='ge', end=YYYY-01-01 → that year's FIRST stored bar."""
    _seed(60)
    # The fixture spans 2026-01-01.. onward; first session is 2026-01-01.
    win = bm.get_history(10, end="2026-01-01", anchor="ge")
    first = bm.get_history(500)[-1]["date"]
    assert win[0]["date"] == first
    # A year with nothing on/after it clamps to the latest rather than emptying.
    latest = bm.get_history(500)[0]["date"]
    clamp = bm.get_history(10, end="2099-01-01", anchor="ge")
    assert clamp[0]["date"] == latest


def test_a_dated_window_agrees_with_the_latest_read_on_shared_dates():
    """The warm-up look-back must reach past `end` too — a value is a property of
    its date, never of where the window happens to stop."""
    _seed(60)
    full = {r["date"]: r for r in bm.get_history(60)}
    target = bm.get_history(60)[18]["date"]
    win = bm.get_history(12, end=target)
    mismatches = []
    for r in win:
        for f in DERIVED:
            if r.get(f) != full[r["date"]].get(f):
                mismatches.append(f"{r['date']}.{f}: end -> {r.get(f)!r}, latest -> {full[r['date']].get(f)!r}")
    assert not mismatches, "a dated window changed a date's worth:\n" + "\n".join(mismatches)


def test_date_bounds_reports_the_first_and_last_session():
    _seed(60)
    rows = bm.get_history(500)
    b = bm.date_bounds()
    assert b["max"] == rows[0]["date"]
    assert b["min"] == rows[-1]["date"]


def test_next_trading_day_walks_forward_and_stops_at_the_top():
    _seed(60)
    rows = bm.get_history(500)          # newest-first
    newest, second = rows[0]["date"], rows[1]["date"]
    assert bm.next_trading_day(second) == newest
    assert bm.next_trading_day(newest) is None
    assert bm.next_trading_day(None) is None
