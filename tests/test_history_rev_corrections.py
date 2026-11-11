"""`history_rev` announces EVERY change a polling client would otherwise miss (2026-11-11).

Bar contract §2 (docs/architecture/bar-contract.md): a client holding a series re-reads
only `since = held tail - mutable window` (8 h; D/W/M: the tail period) while
`history_rev` is unchanged, and does a full read when it moves. Before this rule the store
bumped `history_rev` only for rows inside `sealed_through` — and most series are unsealed
(live-store 5m names, 60m, D/W/M, cold series) — so a split re-adjust, an R2 merge filling
a hole, a rebuild or a deep write that changed rows OLDER than the window never reached a
client holding the series until a full reload.

Invariants railed here:
  H1 (property) For ANY sequence of writes, a client following the documented poll rule
     (full read on a history_rev change, else `since = tail - window` deltas) holds rows
     byte-identical to the store after every poll. Intraday (5m, 60m) and D/W/M.
  H2 Tail repairs inside the window (rewrites, hole fills, growth) never move history_rev.
  H3 Prepending history older than the series' oldest stored row is not a change to any
     held row and does not move history_rev; a hole fill INSIDE the stored span does.
  H4 The data_sync R2 merge is judged by the same store rule.
"""
from __future__ import annotations

import random
import re
import sqlite3
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services import bars_fetch as bf
from api.services import bars_sqlite as bs
from api.services import data_sync

ET = ZoneInfo("America/New_York")
W = 8 * 3600                     # the client's MUTABLE_WINDOW_S (app/src/data/barStore/network.js)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, "_DB_PATH", str(tmp_path / "bars.db"))
    bs.bump_db_epoch()
    bs.reset_meta_state_for_tests()
    bs.init_db()
    yield tmp_path
    bs.reset_meta_state_for_tests()
    bs.bump_db_epoch()


def et(y, mo, d, h=0, mi=0):
    return int(datetime(y, mo, d, h, mi, tzinfo=ET).timestamp())


def bar(t, c=10.0, v=100):
    return {"t": t, "o": c, "h": c + 1, "l": c - 1, "c": c, "v": v}


def hrev(t="AAA", tf="5"):
    return bs.series_meta(t, tf)["history_rev"]


def test_the_window_has_one_owner():
    assert bs.MUTABLE_WINDOW_S == W
    assert bf._DELTA_HEAL_WINDOW_SECONDS == bs.MUTABLE_WINDOW_S   # the repair rewrites exactly it


# ── a model client (the documented poll rule, written independently of the store) ──

class Client:
    def __init__(self, ticker, tf):
        self.t, self.tf = ticker, tf
        self.rows, self.hist = [], None
        self.full_reads = 0

    def _since(self):
        tail = self.rows[-1][0]
        return tail - W if self.tf not in ("D", "W", "M") else tail - 1   # D/W/M: the tail period

    def poll(self):
        h = hrev(self.t, self.tf)
        if not self.rows or h != self.hist:
            self.rows = list(bs.get_bars(self.t, self.tf, 10 ** 6))
            self.full_reads += 1
        else:
            since = self._since()
            delta = bs.get_bars_since(self.t, self.tf, since)
            self.rows = [r for r in self.rows if r[0] <= since] + list(delta)
        self.hist = h


def _days(n, start=date(2026, 10, 1)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _grid(tf, days):
    if tf == "D":
        return [int(d.strftime("%Y%m%d")) for d in days]
    if tf == "W":                       # the ISO-week Friday
        return sorted({int((d + timedelta(days=4 - d.weekday())).strftime("%Y%m%d")) for d in days})
    if tf == "M":                       # the 1st
        return sorted({int(d.replace(day=1).strftime("%Y%m%d")) for d in days})
    step = {"5": 5, "60": 60}[tf]
    out = []
    for d in days:
        if tf == "60":      # the stored TradingView RTH grid: 09:30, 10:30 ... 15:30
            out += [et(d.year, d.month, d.day, h, 30) for h in range(9, 16)]
        else:
            m = 9 * 60 + 30
            while m < 16 * 60:
                out.append(et(d.year, d.month, d.day, m // 60, m % 60))
                m += step
    return out


def _write_ops(rng, tf, keys, ticker="AAA"):
    """One random write the production writers do: a tail repair (window rewrite + growth),
    a correction older than the window (split re-adjust / merge / rebuild), a hole fill, a
    gap-fill/deep write with a prepend, an add-only ingest, the universe live batch, a seal."""
    stored = [r[0] for r in bs.get_bars(ticker, tf, 10 ** 6)]
    tail = stored[-1] if stored else None
    pos = keys.index(tail) if tail in keys else 0
    px = lambda: round(rng.uniform(5, 50), 2)   # noqa: E731
    op = rng.choice(["tail", "tail", "tail", "correct", "hole", "prepend", "ignore", "many",
                     "split", "seal", "identical"])
    if op == "tail":            # the mutable window only + growth
        lo = max(0, pos - rng.randint(0, 6))
        hi = min(len(keys), pos + rng.randint(1, 4))
        win = [k for k in keys[lo:hi] if tail is None or k > bs.history_floor(tf, tail)]
        bs.put_bars(ticker, tf, [bar(k, px(), rng.randint(1, 900)) for k in win])
    elif op == "correct" and stored:
        k = rng.choice(stored)
        bs.put_bars(ticker, tf, [bar(k, px(), rng.randint(1, 900))])
    elif op == "hole" and stored:
        k = rng.choice(keys[:pos + 1])
        bs.put_bars(ticker, tf, [bar(k, px(), rng.randint(1, 900))])
    elif op == "prepend":
        older = keys[:keys.index(stored[0])] if stored else keys[:3]
        if older:
            take = older[-rng.randint(1, min(4, len(older))):]
            bs.put_bars(ticker, tf, [bar(k, px()) for k in take] +
                        ([bar(stored[0])] if stored else []), on_conflict="ignore")
    elif op == "ignore" and stored:
        bs.put_bars(ticker, tf, [bar(k, px()) for k in rng.sample(keys[:pos + 1], 3)],
                    on_conflict="ignore")
    elif op == "many":
        nxt = keys[min(len(keys) - 1, pos + 1)]
        bs.put_bars_many(tf, {ticker: [bar(nxt, px())]})
    elif op == "split" and stored:      # bars_split_repair: every row before a boundary rescaled
        cut = rng.choice(stored)
        old = [r for r in bs.get_bars(ticker, tf, 10 ** 6) if r[0] < cut]
        bs.put_bars(ticker, tf, [{"t": r[0], "o": r[1] / 2, "h": r[2] / 2, "l": r[3] / 2,
                                  "c": r[4] / 2, "v": r[5] * 2} for r in old])
    elif op == "seal" and tail is not None and tf not in ("D", "W", "M"):
        bs.record_sealed(ticker, tf, float(tail), float(tail - W), float(tail + 50))
        if rng.random() < 0.5:
            bs.flush_meta()
    elif op == "identical" and stored:
        r = bs.get_bars(ticker, tf, 10 ** 6)[rng.randrange(len(stored))]
        bs.put_bars(ticker, tf, [{"t": r[0], "o": r[1], "h": r[2], "l": r[3], "c": r[4], "v": r[5]}])
    return op


_H1_DAYS = {"5": 4, "60": 4, "D": 25, "W": 150, "M": 420}


@pytest.mark.parametrize("tf", ["5", "60", "D", "W", "M"])
@pytest.mark.parametrize("seed", range(12))
def test_H1_a_client_following_the_poll_rule_stays_identical_to_the_store(store, tf, seed):
    rng = random.Random(seed * 101 + len(tf))
    keys = _grid(tf, _days(_H1_DAYS[tf], **({"start": date(2025, 9, 1)} if tf in ("W", "M") else {})))
    # A seeded series with holes in it (thin names have them; so do failed fetches).
    start = len(keys) // 3
    first = [k for k in keys[start:start + len(keys) // 3] if rng.random() > 0.15]
    bs.put_bars("AAA", tf, [bar(k, 20.0) for k in first], date_tf=False)
    c = Client("AAA", tf)
    c.poll()
    for step in range(60):
        op = _write_ops(rng, tf, keys)
        c.poll()
        # The held span: from the client's oldest row on. A prepend below it is not held
        # (the client reaches it by scrolling back, which reads the store) — H3.
        store_rows = [r for r in bs.get_bars("AAA", tf, 10 ** 6) if r[0] >= c.rows[0][0]]
        assert c.rows == store_rows, (seed, step, op)
        if rng.random() < 0.1:              # scroll-back: older rows straight from the store
            c.rows = [r for r in bs.get_bars("AAA", tf, 10 ** 6) if r[0] < c.rows[0][0]] + c.rows


def test_H1_old_rule_would_diverge(store):
    """The defect, concretely: an unsealed 5m series, a correction 2 sessions back."""
    keys = _grid("5", _days(3))
    bs.put_bars("AAA", "5", [bar(k) for k in keys])
    c = Client("AAA", "5")
    c.poll()
    h0 = c.hist
    bs.put_bars("AAA", "5", [bar(keys[3], c=5.0)])        # split re-adjust of one old row
    assert hrev() > h0
    c.poll()
    assert c.rows == list(bs.get_bars("AAA", "5", 10 ** 6))


# ── H2: the window never churns history_rev ──────────────────────────────────────

@pytest.mark.parametrize("tf", ["5", "60", "D", "W", "M"])
@pytest.mark.parametrize("seed", range(8))
def test_H2_tail_repairs_inside_the_window_never_move_history_rev(store, tf, seed):
    rng = random.Random(seed)
    if tf in ("W", "M"):
        keys = _grid(tf, _days(130))
    else:
        keys = _grid(tf, _days(25 if tf == "D" else 4))
    n0 = len(keys) // 2
    bs.put_bars("AAA", tf, [bar(k, 20.0) for k in keys[:n0]])
    h0 = hrev("AAA", tf)
    pos = n0 - 1
    for _ in range(40):
        tail = keys[pos]
        floor = bs.history_floor(tf, tail)
        win = [k for k in keys[:pos + 1] if k > floor]
        # rewrite a random subset of the window (incl. new rows in holes), then grow
        rows = [bar(k, round(rng.uniform(5, 50), 2), rng.randint(1, 900))
                for k in win if rng.random() < 0.6]
        grow = rng.randint(0, 2)
        rows += [bar(k, round(rng.uniform(5, 50), 2)) for k in keys[pos + 1:pos + 1 + grow]]
        if rng.random() < 0.3:
            bs.put_bars_many(tf, {"AAA": rows})
        else:
            bs.put_bars("AAA", tf, rows)
        pos = min(len(keys) - 1, pos + grow)
    assert hrev("AAA", tf) == h0


def test_H2_an_intraday_window_hole_fill_does_not_bump_but_an_older_one_does(store):
    keys = _grid("5", _days(3))
    have = [k for i, k in enumerate(keys) if i % 7]          # holes every 7th bucket
    bs.put_bars("AAA", "5", [bar(k) for k in have])
    tail = have[-1]
    h0 = hrev()
    inside = [k for k in keys if k not in have and tail - W < k < tail]
    bs.put_bars("AAA", "5", [bar(inside[0])])
    assert hrev() == h0
    older = [k for k in keys if k not in have and have[0] < k <= tail - W]
    bs.put_bars("AAA", "5", [bar(older[0])])
    assert hrev() > h0


def test_H2_the_window_boundary_row_is_history(store):
    """The server answers `ts > since`: the row AT tail - window is not re-read."""
    tail = et(2026, 11, 10, 19, 55)                # an extended-hours tail
    keys = list(range(tail - W - 3000, tail + 1, 300))
    bs.put_bars("AAA", "5", [bar(k) for k in keys])
    h0 = hrev()
    bs.put_bars("AAA", "5", [bar(tail - W + 300, c=3.0)])
    assert hrev() == h0
    bs.put_bars("AAA", "5", [bar(tail - W, c=3.0)])
    assert hrev() > h0


# ── H3: prepends ─────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("tf", ["5", "D"])
def test_H3_prepending_older_history_does_not_move_history_rev(store, tf):
    """#1116 deep / `to=` window writes and the deep fetch PREPEND history: no client can
    hold a bucket older than the store's oldest row (every row a client holds came from the
    store, and a delete moves history_rev), so nothing held changed. Its overlap with
    stored rows is still judged row by row."""
    keys = _grid(tf, _days(20 if tf == "D" else 4))
    mid = len(keys) // 2
    bs.put_bars("AAA", tf, [bar(k) for k in keys[mid:]])
    h0 = hrev("AAA", tf)
    bs.put_bars("AAA", tf, [bar(k, c=7.0) for k in keys[:mid]] + [bar(keys[mid])])
    assert hrev("AAA", tf) == h0
    bs.put_bars("AAA", tf, [bar(k, c=7.0) for k in keys[2:mid + 2]])   # overlaps a held row
    assert hrev("AAA", tf) > h0


def test_H3_dwm_correction_of_a_closed_period_bumps(store):
    for tf, ks in (("D", [20261102, 20261103, 20261104]),
                   ("W", [20261023, 20261030, 20261106]),
                   ("M", [20260801, 20260901, 20261001])):
        bs.put_bars("AAA", tf, [bar(k) for k in ks])
        h0 = hrev("AAA", tf)
        bs.put_bars("AAA", tf, [bar(ks[-1], c=12.0)])          # the forming period: a delta
        assert hrev("AAA", tf) == h0, tf
        bs.put_bars("AAA", tf, [bar(ks[-2], c=12.0)])          # a closed period: history
        assert hrev("AAA", tf) > h0, tf


def test_split_repair_older_than_the_window_bumps_an_unsealed_series(store):
    keys = _grid("5", _days(3))
    bs.put_bars("AAA", "5", [bar(k) for k in keys])
    assert bs.series_meta("AAA", "5")["sealed_through"] is None
    h0 = hrev()
    plan_rows = [{"t": k, "o": 5.0, "h": 5.5, "l": 4.5, "c": 5.0, "v": 200} for k in keys[:40]]
    bs.put_bars("AAA", "5", plan_rows, date_tf=False)      # what repair_ticker_tf writes
    assert hrev() > h0


# ── H4: the R2 merge uses the same rule ─────────────────────────────────────────

def _snap(path, rows):
    c = sqlite3.connect(path)
    c.execute(bs.ohlcv_ddl())
    c.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
    c.commit()
    c.close()


def test_H4_merge_hole_fill_older_than_the_window_bumps_inside_it_does_not(store, tmp_path,
                                                                           monkeypatch):
    monkeypatch.setattr(data_sync, "_merge_split_near", lambda *a, **k: False)
    keys = _grid("5", _days(3))
    tail = keys[-1]
    old_hole = next(k for k in keys[10:] if k <= tail - W - 600)
    new_hole = next(k for k in keys if tail - W < k < tail - 600)
    local = [k for k in keys if k not in (old_hole, new_hole)]
    bs.put_bars("AAA", "5", [bar(k) for k in local])
    row = lambda k, v=100: ("AAA", "5", k, 10.0, 11.0, 9.0, 10.0, v)   # noqa: E731

    snap1 = str(tmp_path / "s1.db")
    _snap(snap1, [row(k) for k in local] + [row(new_hole)])
    h0 = hrev()
    assert data_sync._merge_ohlcv_from(snap1, local_db=bs._DB_PATH) >= 1
    bs.bump_db_epoch()
    assert hrev() == h0                              # inside the window: a delta carries it

    snap2 = str(tmp_path / "s2.db")
    _snap(snap2, [row(k) for k in local] + [row(old_hole)])
    assert data_sync._merge_ohlcv_from(snap2, local_db=bs._DB_PATH) >= 1
    bs.bump_db_epoch()
    assert hrev() > h0                               # older than the window: history


def test_H4_merge_history_probe_is_a_seek():
    c = sqlite3.connect(":memory:")
    c.execute("ATTACH ':memory:' AS snap")
    for db in ("main", "snap"):
        c.execute(f"CREATE TABLE {db}.ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL, "
                  "ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER, "
                  "PRIMARY KEY (ticker, tf, ts))")
    sql = data_sync._MERGE_HISTORY_SQL
    plan = [r[3] for r in c.execute("EXPLAIN QUERY PLAN " + sql, ("A", "5", 0, 1) * 2)]
    assert not any(re.match(r"SCAN\b", p) for p in plan), plan


def test_history_probe_reads_only_the_written_series(store):
    """Write-lock cost (§7): the tail probe is one PK seek per written series."""
    c = sqlite3.connect(bs._DB_PATH)
    plan = [r[3] for r in c.execute(
        "EXPLAIN QUERY PLAN WITH w(t) AS (VALUES (?),(?)) SELECT w.t, (SELECT ts FROM ohlcv "
        "WHERE ticker=w.t AND tf=? ORDER BY ts DESC LIMIT 1) FROM w", ("A", "B", "5"))]
    assert not any(re.match(r"SCAN (ohlcv)\b", p) for p in plan), plan


# ── review #1125 F2: one boundary for the repair and the history rule ───────────

def test_the_repair_never_rewrites_the_boundary_row():
    """`_delta_keep_bar` keeps exactly the rows that are NOT held history (one definition,
    `bars_sqlite.is_held_history`), so a repair can never change a row without a bump."""
    tail = et(2026, 11, 10, 15, 55)
    floor = bs.history_floor("5", tail)
    stored = {floor, floor + 300}
    assert bs.is_held_history(floor, floor) and not bs.is_held_history(floor + 300, floor)
    for ts in range(floor - 900, tail + 301, 300):
        kept = bf._delta_keep_bar(ts, floor, stored)
        assert kept == (not bs.is_held_history(ts, floor) or ts not in stored), ts
    assert not bf._delta_keep_bar(floor, floor, stored)          # the boundary row
    assert bf._delta_keep_bar(floor + 300, floor, stored)


class _FakeClient:
    _api_key = "test"


def test_a_repair_whose_provider_changed_only_the_boundary_row_does_not_bump(store):
    from unittest.mock import patch
    tail = et(2026, 11, 10, 19, 55)
    keys = list(range(tail - W - 1500, tail + 1, 300))
    bs.put_bars("AAA", "5", [bar(k) for k in keys])
    h0 = hrev()
    # The provider answers the whole window with the boundary row CHANGED.
    raw = [{"t": k * 1000, "o": 10, "h": 11, "l": 9, "c": (3.0 if k == tail - W else 10.0),
            "v": 100} for k in keys]
    with patch.object(bf, "_get_client", return_value=_FakeClient()), \
         patch.object(bf, "_paginate_massive_aggs", return_value=raw):
        out = bf._delta_intraday("AAA", "5", tail)
    assert tail - W not in {b["t"] for b in out}
    bs.put_bars("AAA", "5", out)
    assert hrev() == h0


def test_the_client_delta_covers_every_row_the_repair_can_rewrite(store):
    """`since = tail - W` and the server answers `ts > since`: every row the repair keeps
    (not held history) is in the client's delta."""
    tail = et(2026, 11, 10, 15, 55)
    floor = bs.history_floor("5", tail)
    since = tail - W                                    # the client's rule
    for ts in range(floor - 900, tail + 301, 300):
        if bf._delta_keep_bar(ts, floor, None):
            assert ts > since, ts


# ── review #1125 F5: the server window never exceeds the client's ───────────────

def test_the_env_window_is_clamped_to_the_client_contract(caplog):
    assert bs.CLIENT_MUTABLE_WINDOW_S == W
    with caplog.at_level("WARNING"):
        assert bs._mutable_window_from_env(str(12 * 3600)) == W
    assert "clamped" in caplog.text
    assert bs._mutable_window_from_env(str(4 * 3600)) == 4 * 3600     # narrower is safe
    assert bs._mutable_window_from_env(None) == W
    assert bs._mutable_window_from_env("junk") == W
