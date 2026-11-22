"""RS screens unit U1, part B: the per-period values behind the 1 to 99 ranks are kept.

``rs_history.compute_ratings`` ranked five component values per stock (1, 3, 6, 9 and 12
months) and threw the values away, so only the integer ranks reached ``rs_rating_history``
and an exact per-period order could not be made (dozens of names share each rank). The
values are now stored beside the ranks as REAL columns ``v1, v3, v6, v9, v12``, by every
writer of a whole session: the nightly, the backfill and both universe-style restates.

What these tests hold:
  * the stored value IS the number the rank was taken over, and is NULL where the rank is;
  * no existing rating, score or bar count moved (a digest taken on the code before this
    unit, over a fixed universe);
  * a table created before this unit is read without the columns and gains them on the
    first write, with nothing rewritten.

Hermetic: a ``screener.db`` in ``tmp_path``, injected bar and split readers, no network.
"""
from __future__ import annotations

import hashlib
import json
import random
import sqlite3

import pytest

from api.services.screener import rs_history as rh
from tests.test_rs_ibd_style_components import END, ETFS, SESSIONS, _names
from tests.test_rs_rating_history import _query, make_reader, tmp_db  # noqa: F401 - fixture by name

VALUES = ("v1", "v3", "v6", "v9", "v12")
RANK_OF = {"v1": "m1", "v3": "m3", "v6": "m6", "v9": "m9", "v12": "m12"}


@pytest.fixture(autouse=True)
def small_floor(monkeypatch):
    """The restate's production floor (3,000 ranked names) is for the real store."""
    monkeypatch.setattr(rh, "UNIVERSE_MIN_RANKED", 5)
    monkeypatch.setattr(rh, "_lock_sleep", lambda s: None)


def _universe():
    """Sixty seeded random walks of eleven lengths, so every component is missing for
    some name: 300 closes reach every window, 30 reach only the 1-month one."""
    rng = random.Random(20261114)
    out = {}
    for i in range(60):
        n = [300, 270, 255, 253, 200, 190, 130, 100, 64, 63, 30][i % 11]
        px = 20.0 + i
        closes = []
        for _ in range(n):
            px *= 1 + rng.uniform(-0.03, 0.032)
            closes.append(round(px, 4))
        out[f"T{i:02d}"] = closes
    return out


GOLDEN_ETFS = {"T03", "T17", "T40"}
GOLDEN_SUSPECTS = {"T05"}
#: sha256 of the ratings ``compute_ratings`` gave this universe on the commit before this
#: unit (1c5f45595a), over the keys that existed then.
GOLDEN_DIGEST = "6780bb5c14f2dcb10a1496f8eed965a56b240f214d33e427cc81f749b672a633"
GOLDEN_KEYS = ("ibd", "m1", "m3", "m6", "m9", "m12", "score", "bars", "reason")


def _digest(ratings):
    slim = {t: {k: r[k] for k in GOLDEN_KEYS if k in r} for t, r in ratings.items()}
    return hashlib.sha256(json.dumps(slim, sort_keys=True).encode()).hexdigest()


# ───────────────────────── the pure function ─────────────────────────

def test_no_existing_rating_score_or_bar_count_moved():
    got = rh.compute_ratings(_universe(), GOLDEN_ETFS, suspects=GOLDEN_SUSPECTS)
    assert _digest(got) == GOLDEN_DIGEST


def test_CONTROL_the_digest_sees_one_rating_moving_by_one_point():
    got = rh.compute_ratings(_universe(), GOLDEN_ETFS, suspects=GOLDEN_SUSPECTS)
    got["T00"]["m6"] += 1
    assert _digest(got) != GOLDEN_DIGEST


def test_each_value_is_the_number_its_rank_was_taken_over():
    uni = _universe()
    got = rh.compute_ratings(uni, GOLDEN_ETFS, suspects=GOLDEN_SUSPECTS)
    seen = dict.fromkeys(VALUES, 0)
    for t, closes in uni.items():
        if t in GOLDEN_SUSPECTS:
            continue
        want = rh.component_values(closes)
        for v, m in RANK_OF.items():
            assert got[t][v] == want[m], (t, v)
            assert (got[t][v] is None) == (got[t][m] is None), (t, v)
            seen[v] += got[t][v] is not None
    # every period is exercised both ways: some names carry it and some do not
    assert all(0 < n < len(uni) for n in seen.values()), seen


def test_a_higher_value_never_has_a_lower_rank():
    """The stored value orders the stocks exactly as the rank does, only finer."""
    got = rh.compute_ratings(_universe(), GOLDEN_ETFS, suspects=GOLDEN_SUSPECTS)
    for v, m in RANK_OF.items():
        stocks = sorted((r[v], r[m]) for t, r in got.items()
                        if t not in GOLDEN_ETFS and r.get(v) is not None)
        ranks = [rank for _value, rank in stocks]
        assert len(ranks) > 10 and ranks == sorted(ranks), v


def test_a_split_guarded_name_has_no_value_at_all():
    got = rh.compute_ratings(_universe(), GOLDEN_ETFS, suspects=GOLDEN_SUSPECTS)
    assert got["T05"]["bars"] == 0
    assert all(got["T05"][v] is None for v in VALUES)


def test_an_etf_carries_the_value_behind_its_interpolated_rank():
    uni = _universe()
    got = rh.compute_ratings(uni, GOLDEN_ETFS, suspects=GOLDEN_SUSPECTS)
    assert got["T03"]["m12"] is not None
    assert got["T03"]["v12"] == rh.component_values(uni["T03"])["m12"]


def test_a_fund_with_no_stock_to_rank_against_has_neither_rank_nor_value():
    """An ETF is rated by reading its value on the stocks' distribution. Where no stock
    reaches a window there is no distribution, so no rank, and the value is not kept
    alone: a number with no rank beside it would order a list nobody ranked."""
    uni = {f"S{i}": [100.0 + i + j * 0.1 for j in range(100)] for i in range(6)}   # 100 closes: 1M, 3M
    uni["FUND"] = [50.0 + j * 0.05 for j in range(300)]                             # every window
    got = rh.compute_ratings(uni, {"FUND"})
    assert rh.component_values(uni["FUND"])["m12"] is not None
    assert got["FUND"]["m3"] is not None and got["FUND"]["v3"] is not None
    for v, m in (("v6", "m6"), ("v9", "m9"), ("v12", "m12")):
        assert got["FUND"][m] is None and got["FUND"][v] is None, v


# ───────────────────────── the store ─────────────────────────

def _stored(path, session=None):
    where = "1=1" if session is None else f"session = '{rh.session_key(session)}'"
    return {(r["session"], r["ticker"]): r for r in _query(
        path, f"SELECT * FROM {rh.TABLE} WHERE {where}")}


def _assert_values_match_ranks(rows, series, session):
    """Every stored row of ``session``: value == the component of its own window."""
    reader = make_reader(series, END)
    ymd = rh.session_ymd(session)
    checked = 0
    for (_s, t), row in rows.items():
        ts, closes = rh.closes_from_rows(reader(t, rh.READ_BARS, ymd))
        want = rh.component_values(rh.window_at(ts, closes, ymd))
        for v, m in RANK_OF.items():
            assert row[v] == want[m], (t, v)
            assert (row[v] is None) == (row[m] is None), (t, v)
            checked += row[v] is not None
    assert checked > 100


def test_the_columns_are_real_and_added_to_an_older_table(tmp_db):
    """A table from before this unit has no value columns: it is read as it is (each
    value None, nothing created), and the first write adds them without rewriting a row."""
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"CREATE TABLE {rh.TABLE} (session TEXT NOT NULL, ticker TEXT NOT NULL, "
                 "ibd INTEGER, fast INTEGER, m1 INTEGER, m3 INTEGER, m6 INTEGER, m12 INTEGER, "
                 "score REAL, bars INTEGER, m9 INTEGER, PRIMARY KEY (session, ticker))")
    conn.execute(f"INSERT INTO {rh.TABLE} (session, ticker, ibd, m1, score, bars) "
                 "VALUES ('2026-11-04', 'OLD', 77, 60, 1.25, 260)")
    conn.commit()
    conn.close()
    got = rh.read_fields(["OLD"], session="2026-11-04")["OLD"]
    assert got["ibd"] == 77 and all(got[v] is None for v in VALUES)
    cols = {r["name"]: r["type"] for r in _query(tmp_db, f"PRAGMA table_info({rh.TABLE})")}
    assert not (set(VALUES) & set(cols)), "a read altered the table"

    rh.store_rows("2026-11-05", {"NEW": {"ibd": 50, "m1": 40, "v1": 3.25, "score": 1.1, "bars": 260}})
    cols = {r["name"]: r["type"] for r in _query(tmp_db, f"PRAGMA table_info({rh.TABLE})")}
    assert {cols[v] for v in VALUES} == {"REAL"}
    old = _stored(tmp_db, "2026-11-04")[("2026-11-04", "OLD")]
    assert old["ibd"] == 77 and old["score"] == 1.25 and all(old[v] is None for v in VALUES)


def test_read_fields_returns_the_values_on_both_of_its_paths(tmp_db):
    rh.store_rows("2026-11-05", {"AAA": {"ibd": 90, "m1": 80, "m3": 81, "m6": 82, "m9": 83, "m12": 84,
                                         "v1": 12.5, "v3": 1.31, "v6": 1.42, "v9": 1.53, "v12": 1.64,
                                         "score": 1.4, "bars": 260}})
    want = {"v1": 12.5, "v3": 1.31, "v6": 1.42, "v9": 1.53, "v12": 1.64}
    named = rh.read_fields(["AAA"], session="2026-11-05")["AAA"]      # the post-pass's ask
    newest = rh.read_fields(["AAA"])["AAA"]                           # a chart's one statement
    wide = rh.read_fields(["AAA"] + [f"Z{i}" for i in range(rh.NARROW_READ_MAX)])["AAA"]   # the build's
    for got in (named, newest, wide):
        assert {v: got[v] for v in VALUES} == want
        assert got["ibd"] == 90 and got["score"] == 1.4


def test_the_nightly_stores_the_values(tmp_db):
    series = _names()
    r = rh.nightly_job(END, universe=list(series), etf_tickers=ETFS, fast_map={},
                       bars_reader=make_reader(series, END), splits_reader=lambda t: [])
    assert r["ok"], r
    rows = _stored(tmp_db, END)
    assert len(rows) == len(series)
    _assert_values_match_ranks(rows, series, END)


def test_the_backfill_stores_the_values(tmp_db):
    series = _names()
    r = rh.backfill(days=3, universe=list(series), etf_tickers=ETFS,
                    bars_reader=make_reader(series, END), splits_reader=lambda t: [],
                    sessions=SESSIONS)
    assert r["ok"], r
    for s in SESSIONS:
        _assert_values_match_ranks(_stored(tmp_db, s), series, s)


def _blank_the_values(tmp_db):
    conn = sqlite3.connect(tmp_db)
    conn.execute(f"UPDATE {rh.TABLE} SET " + ", ".join(f"{v} = NULL" for v in VALUES))
    conn.commit()
    conn.close()


@pytest.mark.parametrize("marker", [None, (rh.LISTING_TABLE, rh.LISTING_METHOD)],
                         ids=["restate-universe", "restate-listing-breaks"])
def test_both_universe_style_restates_store_the_values(tmp_db, marker):
    """A session stored before this unit holds ranks and no values; either restate
    rewrites it with both, and a stored name that can no longer be ranked loses its
    values with its ranks (never a value beside a NULL rank)."""
    series = _names()
    assert rh.backfill(days=3, universe=list(series), etf_tickers=ETFS,
                       bars_reader=make_reader(series, END), splits_reader=lambda t: [],
                       sessions=SESSIONS)["ok"]
    before = {k: {c: r[c] for c in rh.RATING_COLUMNS + ("score", "bars")}
              for k, r in _stored(tmp_db).items()}
    _blank_the_values(tmp_db)
    conn = sqlite3.connect(tmp_db)
    for s in SESSIONS:                                   # a name the bars store no longer holds
        conn.execute(f"INSERT INTO {rh.TABLE} (session, ticker, ibd, m1, v1, score, bars) "
                     "VALUES (?, 'GONE', 50, 50, 9.9, 1.0, 260)", (rh.session_key(s),))
    conn.commit()
    conn.close()

    r = rh.restate_universe(3, universe=list(series), etf_tickers=ETFS, sessions=SESSIONS,
                            bars_reader=make_reader(series, END), splits_reader=lambda t: [],
                            **({"marker": marker} if marker else {}))
    assert r["ok"], r
    for s in SESSIONS:
        rows = _stored(tmp_db, s)
        gone = rows.pop((rh.session_key(s), "GONE"))
        assert gone["ibd"] is None and all(gone[v] is None for v in VALUES)
        _assert_values_match_ranks(rows, series, s)
    after = {k: {c: r[c] for c in rh.RATING_COLUMNS + ("score", "bars")}
             for k, r in _stored(tmp_db).items() if k[1] != "GONE"}
    assert after == before, "the restate moved a rating while adding the values"


def test_the_added_columns_are_declared_once_for_every_reader():
    assert tuple(c for c in rh.ROW_COLUMNS if c in VALUES) == VALUES
    assert {rh.ADDED_COLUMNS[v] for v in VALUES} == {"REAL"}
    assert tuple(v for _label, v in rh.VALUE_COLUMNS) == VALUES
