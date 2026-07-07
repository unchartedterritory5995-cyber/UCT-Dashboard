"""Tests for api/flow_scoreboard.py — pure scoreboard computation over
synthetic Top Flow picks: winners, losers, too-new picks, grade buckets,
OI confirmation, and the honesty rules (losers never excluded)."""
from __future__ import annotations

from datetime import date

from api.flow_scoreboard import (
    clean_grade,
    parse_pick_date,
    pick_stats,
    compute_scoreboard,
)

TODAY = date(2026, 7, 6)


def make_pick(
    sym="AAPL",
    cp="C",
    strike=200.0,
    exp="8/21/2026",
    grade="A",
    entry=1.0,
    date_saved="6/25/2026",
    prices=(1.0, 1.2),
    ois=None,
    dates=None,
):
    """Synthetic pick in the tracker's live shape."""
    if ois is None:
        ois = [1000] * len(prices)
    if dates is None:
        dates = [f"{6}/{25 + i}/2026" for i in range(len(prices))]
    history = [
        {"date": d, "price": p, "oi": o, "spot": 100.0, "volume": 10}
        for d, p, o in zip(dates, prices, ois)
    ]
    return {
        "id": f"{sym}|{cp}|{float(strike)}|{exp}",
        "sym": sym,
        "cp": cp,
        "strike": strike,
        "exp": exp,
        "grade": grade,
        "dir": "BULL",
        "entry": entry,
        "entrySpot": 100.0,
        "prem": 500000,
        "cap": "L",
        "hits": 2,
        "dateSaved": date_saved,
        "history": history,
    }


# ── clean_grade ──────────────────────────────────────────────────────────────

def test_clean_grade_strips_rocket_emoji():
    assert clean_grade("A+ 🚀") == "A+"


def test_clean_grade_attached_emoji():
    assert clean_grade("A+🚀") == "A+"


def test_clean_grade_plain_grades():
    for g in ["A+", "A", "B", "C", "D"]:
        assert clean_grade(g) == g


def test_clean_grade_lowercase_and_junk():
    assert clean_grade("b") == "B"
    assert clean_grade("") == ""
    assert clean_grade(None) == ""
    assert clean_grade("F") == ""
    assert clean_grade("AA") == ""


# ── parse_pick_date ──────────────────────────────────────────────────────────

def test_parse_mdy():
    assert parse_pick_date("6/25/2026") == date(2026, 6, 25)


def test_parse_mdy_two_digit_year():
    assert parse_pick_date("6/25/26") == date(2026, 6, 25)


def test_parse_iso():
    assert parse_pick_date("2026-06-25") == date(2026, 6, 25)


def test_parse_garbage():
    assert parse_pick_date("6/25") is None
    assert parse_pick_date("") is None
    assert parse_pick_date(None) is None


# ── pick_stats ───────────────────────────────────────────────────────────────

def test_winner_stats():
    p = make_pick(entry=1.0, prices=(1.0, 1.3, 1.6, 1.4), ois=(1000, 1000, 1000, 1000),
                  dates=["6/25/2026", "6/26/2026", "6/29/2026", "6/30/2026"])
    s = pick_stats(p)
    assert s is not None
    assert s["max_gain_pct"] == 60.0        # peak 1.6 vs entry 1.0
    assert s["current_gain_pct"] == 40.0    # latest 1.4 vs entry 1.0
    assert s["days_tracked"] == 5           # 6/25 → 6/30
    assert s["grade"] == "A"


def test_loser_stats_negative_gains():
    p = make_pick(entry=2.0, prices=(1.8, 1.5, 1.0))
    s = pick_stats(p)
    assert s is not None
    assert s["max_gain_pct"] == -10.0       # peak 1.8 vs entry 2.0
    assert s["current_gain_pct"] == -50.0


def test_too_new_single_snapshot_returns_none():
    p = make_pick(prices=(1.0,), ois=(1000,), dates=["7/6/2026"])
    assert pick_stats(p) is None


def test_no_history_returns_none():
    p = make_pick()
    p["history"] = []
    assert pick_stats(p) is None


def test_zero_entry_falls_back_to_first_snapshot_price():
    p = make_pick(entry=0, prices=(2.0, 3.0))
    s = pick_stats(p)
    assert s["entry"] == 2.0
    assert s["max_gain_pct"] == 50.0


def test_bad_price_snapshots_skipped():
    p = make_pick(prices=(1.0, 0, 1.5), ois=(1000, 0, 1000),
                  dates=["6/25/2026", "6/26/2026", "6/29/2026"])
    s = pick_stats(p)
    assert s is not None
    assert s["max_gain_pct"] == 50.0        # zero-price snapshot ignored


def test_oi_confirmed_when_rising_over_10pct():
    p = make_pick(ois=(1000, 1150), prices=(1.0, 1.1))
    s = pick_stats(p)
    assert s["oi_confirmed"] is True


def test_oi_not_confirmed_when_flat():
    p = make_pick(ois=(1000, 1050), prices=(1.0, 1.1))
    s = pick_stats(p)
    assert s["oi_confirmed"] is False
    assert s["oi_evaluable"] is True


def test_oi_not_evaluable_when_first_oi_zero():
    p = make_pick(ois=(0, 5000), prices=(1.0, 1.1))
    s = pick_stats(p)
    assert s["oi_confirmed"] is False
    assert s["oi_evaluable"] is False


# ── compute_scoreboard: overall ──────────────────────────────────────────────

def test_overall_win_rates_include_losers():
    picks = [
        make_pick(sym="WIN1", entry=1.0, prices=(1.0, 1.6)),    # +60 peak
        make_pick(sym="WIN2", entry=1.0, prices=(1.0, 1.3)),    # +30 peak
        make_pick(sym="MEH", entry=1.0, prices=(1.0, 1.12)),    # +12 peak
        make_pick(sym="LOSE", entry=2.0, prices=(1.8, 1.0)),    # -10 peak
    ]
    board = compute_scoreboard(picks, today=TODAY)
    o = board["overall"]
    assert board["picks_tracked"] == 4
    assert o["picks"] == 4
    assert o["win_rate_10"] == 75.0   # 3 of 4 reached +10
    assert o["win_rate_25"] == 50.0   # 2 of 4 reached +25
    assert o["win_rate_50"] == 25.0   # 1 of 4 reached +50
    assert o["pct_doubled"] == 0.0
    # avg of peaks: (60 + 30 + 12 + -10) / 4 = 23.0
    assert o["avg_max_gain"] == 23.0
    # median of [-10, 12, 30, 60] = 21.0
    assert o["median_max_gain"] == 21.0


def test_pct_doubled():
    picks = [
        make_pick(sym="X", entry=1.0, prices=(1.0, 2.5)),   # +150
        make_pick(sym="Y", entry=1.0, prices=(1.0, 1.5)),   # +50
    ]
    o = compute_scoreboard(picks, today=TODAY)["overall"]
    assert o["pct_doubled"] == 50.0


def test_too_new_reported_separately_and_excluded_from_rates():
    picks = [
        make_pick(sym="OK", entry=1.0, prices=(1.0, 1.5)),
        make_pick(sym="NEW", prices=(1.0,), ois=(1000,), dates=["7/6/2026"]),
    ]
    board = compute_scoreboard(picks, today=TODAY)
    assert board["picks_tracked"] == 1
    assert board["too_new"] == 1
    assert board["overall"]["picks"] == 1


def test_oi_confirmed_rate_over_evaluable_only():
    picks = [
        make_pick(sym="A1", ois=(1000, 1200), prices=(1.0, 1.1)),  # confirmed
        make_pick(sym="A2", ois=(1000, 1010), prices=(1.0, 1.1)),  # not confirmed
        make_pick(sym="A3", ois=(0, 900), prices=(1.0, 1.1)),      # not evaluable
    ]
    o = compute_scoreboard(picks, today=TODAY)["overall"]
    assert o["oi_evaluated"] == 2
    assert o["oi_confirmed_rate"] == 50.0


def test_empty_board_is_well_formed():
    board = compute_scoreboard([], today=TODAY)
    assert board["picks_tracked"] == 0
    assert board["too_new"] == 0
    assert board["overall"]["picks"] == 0
    assert board["overall"]["win_rate_25"] is None
    assert board["recent_winners"] == []
    assert board["recent_picks"] == []
    assert isinstance(board["methodology"], str) and board["methodology"]


# ── compute_scoreboard: grade calibration ────────────────────────────────────

def test_by_grade_buckets_and_emoji_strip():
    picks = [
        make_pick(sym="AP1", grade="A+ 🚀", entry=1.0, prices=(1.0, 1.5)),  # +50
        make_pick(sym="AP2", grade="A+ 🚀", entry=1.0, prices=(1.0, 1.3)),  # +30
        make_pick(sym="B1", grade="B", entry=1.0, prices=(1.0, 1.1)),       # +10
        make_pick(sym="D1", grade="D", entry=2.0, prices=(1.8, 1.0)),       # -10
    ]
    board = compute_scoreboard(picks, today=TODAY)
    by = {row["grade"]: row for row in board["by_grade"]}
    assert list(by.keys()) == ["A+", "A", "B", "C", "D"]
    assert by["A+"]["picks"] == 2
    assert by["A+"]["win_rate_25"] == 100.0
    assert by["A+"]["avg_max_gain"] == 40.0
    assert by["B"]["picks"] == 1
    assert by["B"]["win_rate_25"] == 0.0
    assert by["D"]["picks"] == 1
    assert by["D"]["avg_max_gain"] == -10.0
    assert by["C"]["picks"] == 0
    assert by["C"]["win_rate_25"] is None


# ── compute_scoreboard: recent winners + honest tape ─────────────────────────

def test_recent_winners_window_and_ordering():
    picks = [
        make_pick(sym="NEWWIN", date_saved="6/25/2026", entry=1.0, prices=(1.0, 1.8)),   # +80, in window
        make_pick(sym="OLDWIN", date_saved="1/5/2026", entry=1.0, prices=(1.0, 3.0),
                  dates=["1/5/2026", "1/8/2026"]),                                        # +200 but old
        make_pick(sym="SMALL", date_saved="7/1/2026", entry=1.0, prices=(1.0, 1.2),
                  dates=["7/1/2026", "7/2/2026"]),                                        # +20, in window
        make_pick(sym="RECLOSE", date_saved="7/1/2026", entry=2.0, prices=(1.8, 1.0),
                  dates=["7/1/2026", "7/2/2026"]),                                        # loser — not a "winner"
    ]
    board = compute_scoreboard(picks, today=TODAY)
    syms = [w["sym"] for w in board["recent_winners"]]
    assert syms == ["NEWWIN", "SMALL"]           # sorted by peak gain, window applied
    assert "OLDWIN" not in syms                  # outside 45 days
    assert "RECLOSE" not in syms                 # negative peak is not a standout
    w = board["recent_winners"][0]
    for field in ("sym", "cp", "strike", "exp", "grade", "dateSaved",
                  "entry", "peak_price", "max_gain_pct", "oi_confirmed", "days_tracked"):
        assert field in w


def test_honest_tape_includes_losers_sorted_by_date():
    picks = [
        make_pick(sym="OLD", date_saved="6/1/2026", entry=1.0, prices=(1.0, 1.4),
                  dates=["6/1/2026", "6/2/2026"]),
        make_pick(sym="LOSER", date_saved="7/2/2026", entry=2.0, prices=(1.8, 1.0),
                  dates=["7/2/2026", "7/3/2026"]),
        make_pick(sym="MID", date_saved="6/20/2026", entry=1.0, prices=(1.0, 1.1),
                  dates=["6/20/2026", "6/21/2026"]),
    ]
    board = compute_scoreboard(picks, today=TODAY)
    tape = board["recent_picks"]
    assert [t["sym"] for t in tape] == ["LOSER", "MID", "OLD"]   # newest first
    loser = tape[0]
    assert loser["current_gain_pct"] == -50.0                     # loser shown, not hidden
    assert "latest_price" in loser


def test_honest_tape_capped_at_15():
    picks = [
        make_pick(sym=f"S{i:02d}", date_saved=f"6/{i + 1}/2026", entry=1.0,
                  prices=(1.0, 1.1), dates=[f"6/{i + 1}/2026", f"6/{i + 2}/2026"])
        for i in range(20)
    ]
    board = compute_scoreboard(picks, today=TODAY)
    assert len(board["recent_picks"]) == 15
    assert board["recent_picks"][0]["sym"] == "S19"


# ── router-level cache ───────────────────────────────────────────────────────

def test_get_payload_caches_for_ttl(monkeypatch):
    import api.flow_scoreboard as fs
    import api.top_flow_tracker as tracker

    calls = {"n": 0}

    def fake_get_all():
        calls["n"] += 1
        return {"active": [make_pick(sym="CACHED", entry=1.0, prices=(1.0, 1.5))],
                "archived": []}

    monkeypatch.setattr(tracker, "get_all", fake_get_all)
    fs._invalidate_cache()
    try:
        p1 = fs._get_payload()
        p2 = fs._get_payload()
        assert calls["n"] == 1                # second hit served from cache
        assert p1 is p2
        assert p1["picks_tracked"] == 1
    finally:
        fs._invalidate_cache()


def test_get_payload_survives_tracker_error(monkeypatch):
    import api.flow_scoreboard as fs
    import api.top_flow_tracker as tracker

    def boom():
        raise RuntimeError("disk gone")

    monkeypatch.setattr(tracker, "get_all", boom)
    fs._invalidate_cache()
    try:
        payload = fs._get_payload()
        assert payload["picks_tracked"] == 0
    finally:
        fs._invalidate_cache()
