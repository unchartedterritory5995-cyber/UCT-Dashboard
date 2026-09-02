# tests/test_buzz_boards.py
"""Buzz boards: people ranking, and the two heat-score traps."""
from __future__ import annotations

import datetime as dt

import pytest

ET = dt.timezone(dt.timedelta(hours=-4))
CH = "CH1"


@pytest.fixture()
def mods(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    monkeypatch.setenv("BUZZ_CHANNELS", CH)
    from api.services import buzz_store, buzz_boards
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store, buzz_boards


def _at(day, hour, minute=0):
    return int(dt.datetime(2026, 9, day, hour, minute, tzinfo=ET).timestamp())


def _put(store, ts, ticker, author, mid):
    store.record_mentions([(str(mid), CH, author, ticker, ts, "exact")])


def test_top_board_ranks_by_people_not_raw_mentions(mods):
    store, boards = mods
    now = _at(1, 15)
    for i in range(30):                        # one loud member, 30 messages
        _put(store, _at(1, 10), "LOUD", "spammer", 1000 + i)
    for i, who in enumerate("abcdefgh"):       # eight members, one each
        _put(store, _at(1, 10), "REAL", who, 2000 + i)
    board = boards.top_board("open", now, limit=2)
    assert board[0]["ticker"] == "REAL", "8 people must outrank 1 person x30"
    assert board[0]["people"] == 8
    assert board[1]["ticker"] == "LOUD"
    assert board[1]["mentions"] == 30


def test_top_board_carries_a_sparkline(mods):
    store, boards = mods
    _put(store, _at(1, 10), "NVDA", "a", 1)
    _put(store, _at(1, 14), "NVDA", "b", 2)
    row = boards.top_board("open", _at(1, 15), limit=1)[0]
    assert isinstance(row["spark"], list) and len(row["spark"]) >= 4
    assert sum(row["spark"]) == 2


# ── heat-score fixtures ──────────────────────────────────────────────────────
#
# ⛔ These seed the WEEKDAYS heat_board actually walks, not calendar days. An
# earlier draft of this plan seeded Sept 1-20 (14 weekdays) against a 30-session
# baseline reaching back to Aug 10, giving base = 14/30 = 0.47 -- below
# MIN_BASELINE -- while today's 4 mentions sat below MIN_CURRENT=5. It failed
# BOTH gates and could never have passed. Compute the arithmetic, don't eyeball it.

def _prior_weekdays(now_dt, n):
    """The same days `_prior_session_days` walks: weekdays only, going back."""
    out, d = [], now_dt
    while len(out) < n:
        d = d - dt.timedelta(days=1)
        if d.weekday() < 5:
            out.append(d)
    return out


def _seed_baseline(store, now_dt, ticker, per_session, sessions=30,
                   at_hour=9, at_min=40, mid=100000):
    """`per_session` mentions just after the open on each of the last
    `sessions` weekdays -> baseline == per_session exactly."""
    for d in _prior_weekdays(now_dt, sessions):
        ts = int(d.replace(hour=at_hour, minute=at_min, second=0,
                           microsecond=0).timestamp())
        for _ in range(per_session):
            _put(store, ts, ticker, f"u{mid}", mid)
            mid += 1
    return mid


def test_heat_uses_a_MATCHED_denominator_not_a_daily_average(mods):
    """THE trap. PLTR normally has 2 mentions by 09:45 and ~32 across a full
    day. Today it has 8 by 09:45.

      matched denominator (correct): 8 / 2   = 4.0x  -> HOT
      daily-average denominator     : 8 / 32  = 0.25x -> reads stone cold

    The afternoon mentions exist purely to make those two answers disagree.
    """
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)   # Monday, 15 min in
    now = int(now_dt.timestamp())

    mid = _seed_baseline(store, now_dt, "PLTR", per_session=2)   # 2 by 09:45
    for d in _prior_weekdays(now_dt, 30):                        # +30 each afternoon
        ts = int(d.replace(hour=14, minute=0, second=0, microsecond=0).timestamp())
        for _ in range(30):
            _put(store, ts, "PLTR", f"v{mid}", mid); mid += 1

    for k in range(8):                                           # today: 8 by 09:45
        _put(store, _at(21, 9, 40), "PLTR", f"t{k}", mid); mid += 1

    rows = {r["ticker"]: r for r in boards.heat_board(now, sessions=30)}
    assert "PLTR" in rows, "a matched denominator must see this as hot"
    assert rows["PLTR"]["ratio"] == 4.0, rows["PLTR"]


def test_heat_control_a_busy_but_NORMAL_name_is_not_flagged(mods):
    """The control that proves the test above can fail. Same volume as a hot
    name (6 today, clears MIN_CURRENT), but 6 is exactly its normal -> ratio
    1.0, so it must NOT appear. If this ever passes trivially, the heat board
    is measuring volume, not surprise."""
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)
    now = int(now_dt.timestamp())

    mid = _seed_baseline(store, now_dt, "CALM", per_session=6)
    for k in range(6):
        _put(store, _at(21, 9, 40), "CALM", f"t{k}", mid); mid += 1

    assert "CALM" not in {r["ticker"] for r in boards.heat_board(now, sessions=30)}


def test_heat_volume_floor_rejects_a_loud_ratio_on_a_tiny_count(mods):
    """1 mention on each of 30 sessions, then 3 today, is 'below normal' -- but
    even a 10x on 3 mentions is noise. cur < MIN_CURRENT excludes it."""
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)
    now = int(now_dt.timestamp())

    mid = _seed_baseline(store, now_dt, "NOISE", per_session=1)
    for k in range(3):                                   # 3 < MIN_CURRENT (5)
        _put(store, _at(21, 9, 40), "NOISE", f"t{k}", mid); mid += 1

    assert "NOISE" not in {r["ticker"] for r in boards.heat_board(now, sessions=30)}


def test_heat_baseline_floor_rejects_a_name_with_no_real_history(mods):
    """Clears the volume gate (8 today) but has almost no baseline: seen on
    only 6 of the last 30 sessions -> base 0.2, under MIN_BASELINE. '40x normal'
    off a base that thin is an artifact, not a signal.

    ⛔ THE ROOM MUST BE SEEDED ON ALL 30 SESSIONS. This test used to seed THIN
    alone, which made the other 24 sessions completely EMPTY -- and an empty
    session is now dropped from the baseline (a day nobody spoke is not
    evidence about a ticker). The fixture therefore could not tell "THIN
    appeared on 6 of 30 BUSY days" (base 0.2, the case this test is about)
    from "the store only has 6 days of history at all" (base 1.0, a different
    bug, F9). It asserted the first while describing the second.
    """
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)
    now = int(now_dt.timestamp())

    # The room was busy on all 30 prior sessions...
    mid = _seed_baseline(store, now_dt, "ROOM", per_session=4, sessions=30)
    # ...THIN only showed up on 6 of them.
    mid = _seed_baseline(store, now_dt, "THIN", per_session=1, sessions=6, mid=mid)
    for k in range(8):
        _put(store, _at(21, 9, 40), "THIN", f"t{k}", mid); mid += 1

    assert "THIN" not in {r["ticker"] for r in boards.heat_board(now, sessions=30)}


def test_a_session_the_room_never_spoke_in_does_not_dilute_the_baseline(mods):
    """⛔ F9. A market holiday, an outage, and a day before this store existed
    all look identical to a single ticker: zero mentions. Counting them as real
    zeros drags every baseline toward zero and inflates every ratio.

    STEADY says 3 on each of the 20 sessions the room was actually open, and 6
    today. The two answers disagree by design:
        sessions the room spoke in (correct):  6 / (60/20) = 2.0x
        all 30 weekdays (the old behaviour):   6 / (60/30) = 3.0x
    """
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)
    now = int(now_dt.timestamp())

    # Only 20 of the last 30 weekdays have ANY traffic at all.
    mid = _seed_baseline(store, now_dt, "STEADY", per_session=3, sessions=20)
    for k in range(6):
        _put(store, _at(21, 9, 40), "STEADY", f"s{k}", mid); mid += 1

    rows = {r["ticker"]: r for r in boards.heat_board(now, sessions=30)}
    assert "STEADY" in rows
    assert rows["STEADY"]["ratio"] == 2.0


def test_heat_is_suppressed_until_the_store_covers_enough_sessions(mods):
    """⛔ F9, the cold-start half. Switch ingest on without a backfill (or let a
    429 truncate one) and the board would call the room's most ORDINARY names
    6x anomalies, every day, for six weeks -- MIN_BASELINE cannot catch it
    because a diluted base still clears 1.0. Below MIN_SESSIONS of real
    coverage the board publishes NOTHING rather than a confident wrong number.
    """
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 9, 45, tzinfo=ET)
    now = int(now_dt.timestamp())

    # Three sessions of history: enough for a ratio to LOOK computable.
    mid = _seed_baseline(store, now_dt, "NEW", per_session=4,
                         sessions=boards.MIN_SESSIONS - 2)
    for k in range(40):
        _put(store, _at(21, 9, 40), "NEW", f"n{k}", mid); mid += 1

    assert boards.heat_board(now, sessions=30) == []

    # One more session past the floor and the same name is publishable.
    _seed_baseline(store, now_dt, "NEW", per_session=4,
                   sessions=boards.MIN_SESSIONS, mid=mid + 5000)
    assert "NEW" in {r["ticker"] for r in boards.heat_board(now, sessions=30)}


def test_a_hot_name_outside_the_top_40_is_still_found(mods):
    """⛔ THE REGRESSION THIS BOARD EXISTS TO PREVENT. Candidates must be gated
    by the VOLUME FLOOR, never by today's rank: a name at 20x its normal chatter
    ranked 51st by raw mentions, and the board rendered EMPTY while it happened."""
    store, boards = mods
    now_dt = dt.datetime(2026, 9, 21, 11, 0, tzinfo=ET)
    now = int(now_dt.timestamp())
    open_ts = int(now_dt.replace(hour=9, minute=30).timestamp())
    mid = 1
    for i in range(50):                       # 50 busy-but-normal names
        t = f"BUSY{i:02d}"
        for k in range(8):
            _put(store, open_ts + 60, t, f"p{i}_{k}", mid); mid += 1
        for d in _prior_weekdays(now_dt, 30):
            for k in range(8):
                _put(store, int(d.replace(hour=9, minute=40).timestamp()), t, f"h{i}_{k}", mid); mid += 1
    for k in range(6):                        # one genuine hot move
        _put(store, open_ts + 60, "QUIET", f"q{k}", mid); mid += 1
    # ⛔ DEVIATION FROM THE COORDINATOR'S LITERAL TEST: the reproduction as
    # given seeded QUIET's baseline on only the first 9 of 30 prior weekdays
    # (`_prior_weekdays(now_dt, 30)[:9]`), which computes base = 9/30 = 0.3 --
    # BELOW MIN_BASELINE (1.0) -- so it trips the (correctly working)
    # baseline floor instead of isolating the candidate-cap regression this
    # test exists to catch. Verified independently with a standalone repro
    # before changing it. Seeding all 30 sessions via `_seed_baseline` (the
    # file's own established pattern for CALM/NOISE/THIN) gives base = 1.0
    # exactly -- clears the floor -- while today's 6 mentions still read
    # 6.0x, comfortably hot and comfortably above the 1.5 ratio cutoff.
    _seed_baseline(store, now_dt, "QUIET", per_session=1, mid=mid)

    assert "QUIET" in {r["ticker"] for r in boards.heat_board(now, limit=10)}


def test_window_bounds_open_starts_at_the_market_open(mods):
    _, boards = mods
    start, end = boards.window_bounds("open", _at(1, 15))
    assert dt.datetime.fromtimestamp(start, ET).hour == 9
    assert dt.datetime.fromtimestamp(start, ET).minute == 30
    assert end == _at(1, 15)


def test_window_bounds_noon(mods):
    _, boards = mods
    start, _ = boards.window_bounds("noon", _at(1, 15))
    assert dt.datetime.fromtimestamp(start, ET).hour == 12


def test_coverage_says_how_fresh_the_count_is(mods):
    store, boards = mods
    _put(store, _at(1, 14, 58), "NVDA", "a", 1)
    assert "2:58" in boards.coverage(_at(1, 15)) or "14:58" in boards.coverage(_at(1, 15))


def test_full_board_returns_EVERY_ticker_not_just_the_top(mods):
    """The owner asked for every ticker. `top_board` caps; `full_board` must not."""
    store, boards = mods
    now = _at(1, 15)
    for i in range(40):
        _put(store, _at(1, 10), f"T{i:03d}", f"u{i}", 1000 + i)
    assert len(boards.top_board("open", now, limit=5)) == 5
    assert len(boards.full_board("open", now)) == 40


def test_full_board_sparklines_only_the_head(mods):
    """A sparkline the tail never draws is a wasted scan per ticker."""
    store, boards = mods
    now = _at(1, 15)
    for i in range(20):
        for k in range(20 - i):                      # descending, so rank is stable
            _put(store, _at(1, 10), f"T{i:03d}", f"u{i}{k}", 5000 + i * 100 + k)
    rows = boards.full_board("open", now, spark_top=3)
    assert all("spark" in r for r in rows[:3])
    assert all("spark" not in r for r in rows[3:])


def test_split_tail_separates_the_once_mentioned(mods):
    _, boards = mods
    rows = [{"ticker": "AAA", "mentions": 5}, {"ticker": "BBB", "mentions": 2},
            {"ticker": "CCC", "mentions": 1}, {"ticker": "DDD", "mentions": 1}]
    multi, singles = boards.split_tail(rows)
    assert [r["ticker"] for r in multi] == ["AAA", "BBB"]
    assert singles == ["CCC", "DDD"]


def test_totals_counts_messages_members_and_tickers(mods):
    store, boards = mods
    now = _at(1, 15)
    store.record_mentions([
        ("1", CH, "alice", "NVDA", _at(1, 10), "exact"),
        ("1", CH, "alice", "AMD",  _at(1, 10), "exact"),   # same message, 2 tickers
        ("2", CH, "bob",   "NVDA", _at(1, 11), "exact"),
    ])
    assert boards.totals("open", now) == {"messages": 2, "members": 2, "tickers": 2}


def test_totals_messages_counts_TICKER_BEARING_messages_only(mods):
    """⛔ The store holds only ticker-bearing rows, so a channel-wide message
    total is not derivable from it. This pins what the number actually means so
    the board can label it honestly rather than implying it counted the room."""
    store, boards = mods
    now = _at(1, 15)
    store.record_mentions([("1", CH, "alice", "NVDA", _at(1, 10), "exact")])
    assert boards.totals("open", now)["messages"] == 1


def test_ticker_detail_reports_people_mentions_and_a_link(mods):
    store, boards = mods
    _put(store, _at(1, 10), "NVDA", "a", 1544451055910129726)
    d = boards.ticker_detail("NVDA", "open", _at(1, 15))
    assert d["mentions"] == 1 and d["people"] == 1
    assert "discord.com/channels/" in d["link"]


def test_ticker_detail_is_consistent_for_a_name_outside_the_top_200(mods):
    """mentions/people came from a 200-row board scan while spark and link were
    uncapped -- so a name ranked 210th reported 0 mentions beside a real
    sparkline and a working link."""
    store, boards = mods
    now = _at(1, 15)
    mid = 1
    for i in range(210):                      # 210 louder names
        for k in range(3):
            _put(store, _at(1, 10), f"T{i:03d}", f"u{i}_{k}", mid); mid += 1
    _put(store, _at(1, 10), "RARE1", "alice", 900001)
    _put(store, _at(1, 11), "RARE1", "bob", 900002)

    d = boards.ticker_detail("RARE1", "open", now)
    assert d["mentions"] == 2 and d["people"] == 2
    assert sum(d["spark"]) == d["mentions"]   # the payload must agree with itself
