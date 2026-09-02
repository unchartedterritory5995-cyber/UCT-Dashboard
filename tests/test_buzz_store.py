"""Buzz mention store: schema, idempotency, cursor, board maths."""
from __future__ import annotations

import os
import pytest


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setenv("BUZZ_DB_PATH", str(tmp_path / "buzz.db"))
    from api.services import buzz_store
    buzz_store._reset_for_tests()
    buzz_store.init_db()
    return buzz_store


CH = "1216816863313657886"


def test_snowflake_ts_is_unix_seconds(store):
    # 1544451055910129726 was posted 2026-09-01T20:57:06Z
    assert store.snowflake_ts("1544451055910129726") == 1788296226


def test_record_and_board_counts_people_and_mentions(store):
    rows = [
        ("1", CH, "alice", "NVDA", 100, "cashtag"),
        ("2", CH, "bob",   "NVDA", 101, "exact"),
        ("3", CH, "alice", "NVDA", 102, "exact"),   # alice again -> still 1 person
        ("4", CH, "carol", "SPY",  103, "alias"),
    ]
    assert store.record_mentions(rows) == 4
    board = store.board(0, 999, [CH])
    assert board[0] == {"ticker": "NVDA", "people": 2, "mentions": 3}
    assert board[1] == {"ticker": "SPY", "people": 1, "mentions": 1}


def test_reingesting_the_same_window_changes_nothing(store):
    rows = [("1", CH, "alice", "NVDA", 100, "cashtag")]
    assert store.record_mentions(rows) == 1
    assert store.record_mentions(rows) == 0          # idempotent
    assert store.board(0, 999, [CH])[0]["mentions"] == 1


def test_one_message_naming_two_tickers_is_two_rows(store):
    rows = [
        ("1", CH, "alice", "NVDA", 100, "cashtag"),
        ("1", CH, "alice", "AMD",  100, "cashtag"),
    ]
    assert store.record_mentions(rows) == 2
    assert {r["ticker"] for r in store.board(0, 999, [CH])} == {"NVDA", "AMD"}


def test_window_bounds_are_inclusive_start_exclusive_end(store):
    store.record_mentions([
        ("1", CH, "a", "NVDA", 100, "exact"),
        ("2", CH, "a", "NVDA", 200, "exact"),
    ])
    assert store.count("NVDA", 100, 200, [CH]) == 1
    assert store.count("NVDA", 100, 201, [CH]) == 2


def test_cursor_roundtrip(store):
    assert store.get_cursor(CH) is None
    store.set_cursor(CH, "999")
    assert store.get_cursor(CH) == "999"
    store.set_cursor(CH, "1000")
    assert store.get_cursor(CH) == "1000"


def test_series_buckets_by_time(store):
    store.record_mentions([
        ("1", CH, "a", "NVDA", 0,  "exact"),
        ("2", CH, "b", "NVDA", 0,  "exact"),
        ("3", CH, "c", "NVDA", 90, "exact"),
    ])
    assert store.series("NVDA", 0, 100, buckets=2, channels=[CH]) == [2, 1]


def test_known_tickers_ranks_by_mentions_and_filters_by_prefix(store):
    store.record_mentions([
        ("1", CH, "a", "NVDA", 1, "exact"),
        ("2", CH, "b", "NVDA", 2, "exact"),
        ("3", CH, "c", "NVAX", 3, "exact"),
        ("4", CH, "d", "AMD",  4, "exact"),
    ])
    assert store.known_tickers("NV") == [("NVDA", 2), ("NVAX", 1)]
    assert store.known_tickers("") [0] == ("NVDA", 2)


def test_channel_filter_excludes_other_channels(store):
    store.record_mentions([
        ("1", CH,    "a", "NVDA", 1, "exact"),
        ("2", "9999", "b", "NVDA", 2, "exact"),
    ])
    assert store.count("NVDA", 0, 99, [CH]) == 1


def test_series_bucket_boundaries_are_exact_not_float_rounded(store):
    """buckets=14 over an 18s span: ts=9 must land in bucket 7. Float division
    gives 6.999999999999999 -> bucket 6. Regression guard for a boundary
    mention silently shifting one bucket left in the sparkline."""
    store.record_mentions([("1", CH, "a", "NVDA", 9, "exact")])
    assert store.series("NVDA", 0, 18, buckets=14, channels=[CH])[7] == 1


def test_latest_ts_returns_the_newest_mention(store):
    store.record_mentions([
        ("1", CH, "a", "NVDA", 100, "exact"),
        ("2", CH, "b", "AMD",  300, "exact"),
        ("3", CH, "c", "SPY",  200, "exact"),
    ])
    assert store.latest_ts([CH]) == 300


def test_latest_ts_is_None_on_an_empty_store(store):
    # MAX() over an empty table returns one row containing NULL, not zero rows
    assert store.latest_ts([CH]) is None


def test_latest_ts_respects_the_channel_filter(store):
    store.record_mentions([
        ("1", CH,     "a", "NVDA", 100, "exact"),
        ("2", "OTHER", "b", "NVDA", 999, "exact"),
    ])
    assert store.latest_ts([CH]) == 100
