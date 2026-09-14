"""CONTEXT_SNAPSHOT rails (D11, context-v1; stream S-E).

WHAT THIS FILE HAS TO BE ABLE TO SAY RED FOR
1. a field without its source and retrieval time, or a missing field that is not a named gap.
2. a bar from the statement's own unfinished session (or later) reaching the snapshot.
3. a current-only store read for an old call (a backfill from later data).
4. a regime row written after the statement used as its context.
5. completeness that does not count populated fields.
"""
from __future__ import annotations

import sqlite3
from datetime import date, datetime, timedelta

from api.services.wisdom.core.timeutil import ET
from api.services.wisdom.evals import context
from api.services.wisdom.evals.bars_asof import BarsAsOf, MemoryReader, ymd_int


def _sessions(end: date, n: int) -> list[int]:
    out, cur = [], end
    while len(out) < n:
        if cur.weekday() < 5:
            out.append(ymd_int(cur))
        cur -= timedelta(days=1)
    return sorted(out)


def _bars(end=date(2026, 8, 20), crash_on=None):
    sessions = _sessions(end, 230)
    rows = {}
    for t in context.INDEXES:
        series = []
        for i, s in enumerate(sessions):
            c = 100.0 + i
            if s == crash_on:
                c = 5.0                     # far below every average, still a valid (positive) bar
            series.append((s, c, c + 1, c - 1, c, 1e6))
        rows[(t, "D")] = series
    return BarsAsOf(MemoryReader(rows))


def _call(**over):
    rec = {"record_id": "c1", "ticker": "NVDA", "stated_at_et": "2026-08-20T10:00:00-04:00",
           "stated_at_precision": "minute"}
    rec.update(over)
    return rec


def test_every_field_carries_source_and_time_or_a_named_gap():
    snap = context.compute_snapshot(_call(), context.ContextEnv(bars=_bars(), now=datetime(2026, 8, 20, 18, tzinfo=ET)))
    assert set(snap["fields"]) == set(context.FIELDS)
    for name, f in snap["fields"].items():
        if f["value"] is None:
            assert f["source"] is None and f["retrieved_at"] is None and f["gap"], name
        else:
            assert f["source"] and f["retrieved_at"], name
    populated = sum(1 for f in snap["fields"].values() if f["value"] is not None)
    assert snap["completeness"] == round(populated / len(context.FIELDS), 4) and populated >= 1


def test_the_index_regime_reads_only_sessions_closed_before_the_statement():
    env = context.ContextEnv(bars=_bars(crash_on=20260820), now=datetime(2026, 8, 20, 18, tzinfo=ET))
    regime = context.compute_snapshot(_call(), env)["fields"]["index_regime"]["value"]
    assert regime["SPY"]["session"] == "2026-08-19"
    assert regime["SPY"]["tier"] == "g3"                    # the 08-20 crash would read r3
    # control: an after-close statement may use that day's close, and the crash shows
    after = context.compute_snapshot(_call(stated_at_et="2026-08-20T16:30:00-04:00"), env)
    assert after["fields"]["index_regime"]["value"]["SPY"]["tier"] == "r3"


def test_a_current_only_store_is_a_gap_for_an_old_call():
    calls = []
    env = context.ContextEnv(bars=_bars(), now=datetime(2026, 9, 20, 18, tzinfo=ET),
                             screener_row=lambda t: calls.append(t) or {"rs_rank": 99, "bars_asof": 20260819,
                                                                         "sector": "Tech"},
                             themes_for_ticker=lambda t: [{"theme_id": 1}])
    fields = context.compute_snapshot(_call(), env)["fields"]
    for name in ("rs_rank", "sector", "themes"):
        assert fields[name]["value"] is None and fields[name]["gap"] == "capture_archive_reader_absent", name
    assert calls == []
    # control: the same readers on the statement's own day are used
    same_day = context.ContextEnv(bars=_bars(), now=datetime(2026, 8, 20, 18, tzinfo=ET),
                                  screener_row=lambda t: {"rs_rank": 99, "bars_asof": 20260819, "sector": "Tech"},
                                  themes_for_ticker=lambda t: [{"theme_id": 1, "theme_name": "AI"}])
    fields = context.compute_snapshot(_call(), same_day)["fields"]
    assert fields["rs_rank"]["value"]["rs_rank"] == 99 and fields["themes"]["value"][0]["theme"] == "AI"
    # a screener row built from bars AFTER the statement is refused even on the same day
    newer = context.ContextEnv(bars=_bars(), now=datetime(2026, 8, 20, 18, tzinfo=ET),
                               screener_row=lambda t: {"rs_rank": 99, "bars_asof": 20260820})
    assert context.compute_snapshot(_call(), newer)["fields"]["rs_rank"]["gap"] == "screener_row_newer_than_statement"


def test_the_archive_answers_for_an_old_call_when_it_holds_that_session():
    archive = {("screener", "2026-08-19"): {"payload": {"rows": [{"ticker": "NVDA", "rs_rank": 88,
                                                                   "sector": "Semis"}]}}}
    env = context.ContextEnv(bars=_bars(), now=datetime(2026, 9, 20, 18, tzinfo=ET),
                             archive=lambda family, day: archive.get((family, day)))
    fields = context.compute_snapshot(_call(), env)["fields"]
    assert fields["rs_rank"]["value"] == {"rs_rank": 88, "bars_asof": None}
    assert fields["rs_rank"]["source"] == "wisdom capture archive: screener family"


def test_a_regime_row_written_after_the_statement_is_not_its_context(tmp_path):
    path = tmp_path / "engine.db"
    conn = sqlite3.connect(path)
    conn.execute("CREATE TABLE market_regimes (regime_date TEXT, phase TEXT, exposure_pct INTEGER, "
                 "distribution_days INTEGER, trend_score REAL, risk_score REAL, created_at TEXT)")
    conn.execute("INSERT INTO market_regimes VALUES ('2026-08-19','Uptrend',80,2,7,3,'2026-08-19 11:35:00')")
    conn.execute("INSERT INTO market_regimes VALUES ('2026-08-20','Downtrend',20,6,2,8,'2026-08-20 15:00:00')")
    conn.commit()
    conn.close()
    env = context.ContextEnv(bars=_bars(), now=datetime(2026, 8, 21, 9, tzinfo=ET), engine_db_path=str(path))
    early = context.compute_snapshot(_call(stated_at_et="2026-08-20T10:00:00-04:00"), env)["fields"]["uct_exposure"]
    assert early["value"]["regime_date"] == "2026-08-19"    # 08-20's row was written at 15:00 UTC = 11:00 ET
    late = context.compute_snapshot(_call(stated_at_et="2026-08-20T12:00:00-04:00"), env)["fields"]["uct_exposure"]
    assert late["value"]["regime_date"] == "2026-08-20"


def test_tweets_outside_the_store_window_are_a_gap_and_inside_carry_ids_only():
    tweets = [{"id": 1, "created_at": int(datetime(2026, 8, 20, 9, tzinfo=ET).timestamp()), "tickers": ["NVDA"]},
              {"id": 2, "created_at": int(datetime(2026, 8, 20, 11, tzinfo=ET).timestamp()), "tickers": []}]

    def window(since, until):
        return [t for t in tweets if since <= t["created_at"] <= until]

    fresh = context.ContextEnv(bars=_bars(), now=datetime(2026, 8, 20, 18, tzinfo=ET), tweets_window=window)
    value = context.compute_snapshot(_call(), fresh)["fields"]["tweets_24h"]["value"]
    assert value == {"count": 1, "mentioning_ticker": 1, "tweet_ids": ["1"]}
    old = context.ContextEnv(bars=_bars(), now=datetime(2026, 9, 20, 18, tzinfo=ET), tweets_window=window)
    assert context.compute_snapshot(_call(), old)["fields"]["tweets_24h"]["gap"] == "tweets_store_retention_7d"


def test_catalysts_listed_after_the_statement_do_not_count_as_listed():
    later = int(datetime(2026, 8, 20, 15, tzinfo=ET).timestamp())
    env = context.ContextEnv(bars=_bars(), now=datetime(2026, 8, 20, 18, tzinfo=ET),
                             catalyst_rows=lambda d: [{"ticker": "NVDA", "rank": 2, "thesis_at": later}])
    value = context.compute_snapshot(_call(), env)["fields"]["catalysts"]["value"]
    assert value == {"listed": False, "listed_later_same_session": True}
    empty = context.ContextEnv(bars=_bars(), now=datetime(2026, 8, 20, 18, tzinfo=ET), catalyst_rows=lambda d: [])
    assert context.compute_snapshot(_call(), empty)["fields"]["catalysts"]["gap"] == "catalysts_no_rows_for_session"


def test_a_catalyst_row_with_no_write_time_is_a_gap_never_listed_true():
    """🔴 LOOKAHEAD: `thesis_at or refreshed_at` being absent was read as "known before".

    thesis_at and refreshed_at are both nullable in catalysts.db, so this row is reachable.
    With no write time the snapshot cannot say the ticker was on the list AT stated_at, and
    asserting `listed: True` with a rank is a claim with no evidence behind it."""
    now = datetime(2026, 8, 27, 18, tzinfo=ET)          # a week AFTER the statement
    bare = {"ticker": "NVDA", "rank": 3, "tag": "earnings", "thesis_at": None, "refreshed_at": None}
    env = context.ContextEnv(bars=_bars(), now=now, catalyst_rows=lambda d: [bare])
    field = context.compute_snapshot(_call(), env)["fields"]["catalysts"]
    assert field["value"] is None and field["gap"] == "catalyst_row_has_no_write_time"
    # CONTROL 1: the same row WITH a write time before the statement still answers listed.
    before = int(datetime(2026, 8, 20, 6, tzinfo=ET).timestamp())
    stamped = context.ContextEnv(bars=_bars(), now=now,
                                 catalyst_rows=lambda d: [dict(bare, thesis_at=before)])
    assert context.compute_snapshot(_call(), stamped)["fields"]["catalysts"]["value"]["listed"] is True
    # CONTROL 2: refreshed_at alone is a write time too — the gap is ABSENCE, not thesis_at.
    only_refreshed = context.ContextEnv(bars=_bars(), now=now,
                                        catalyst_rows=lambda d: [dict(bare, refreshed_at=before)])
    assert context.compute_snapshot(_call(), only_refreshed)["fields"]["catalysts"]["value"]["listed"] is True


def test_a_reader_that_raises_is_a_named_gap_not_a_crash():
    def boom(_):
        raise RuntimeError("store locked")

    env = context.ContextEnv(bars=_bars(), now=datetime(2026, 8, 20, 18, tzinfo=ET), breadth_row=boom)
    assert context.compute_snapshot(_call(), env)["fields"]["breadth"]["gap"] == "reader_error:RuntimeError"


def test_the_ma_stack_tier_follows_the_desk_shading():
    t = context.ma_stack_tier
    assert t({10: 1, 20: 1, 50: 1, 200: 1}) == "g3"
    assert t({10: 1, 20: 0, 50: 1, 200: 1}) == "g2"
    assert t({10: 0, 20: 0, 50: 1, 200: 1}) == "g1"
    assert t({10: 1, 20: 1, 50: 1, 200: 0}) == "amber"
    assert t({10: 0, 20: 0, 50: 0, 200: 1}) == "r1"
    assert t({10: 1, 20: 0, 50: 0, 200: 0}) == "r2"
    assert t({10: 0, 20: 0, 50: 0, 200: 0}) == "r3"
