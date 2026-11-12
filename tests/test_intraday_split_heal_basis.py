"""P4 — server-owned price basis: the intraday split heal + `adj_basis` (bar contract §2).

Synthetic stores only; every price is an invented number from a seeded random walk.

INVARIANTS (property style, seeded):
  H1  after a split event every stored intraday row of the symbol is on the NEW basis, on
      every tf, and each rescaled series' `history_rev` moved exactly once (one
      bump_series_revs per series; a repeated heal writes nothing);
  H2  a series whose old/new junction cannot be PROVEN unique (new-basis rows below
      old-basis ones, a lone split-sized print) is never written: byte-identical, basis
      unknown (None);
  H3  a write that lands between the plan and the transaction voids it ("raced");
  C1  `adj_basis` is on every intraday contract answer, equals the store's stamp, is the
      same for rth / eth / derived answers of one source series, and is stable across
      reads; it is a pure, order-insensitive function of the applied split events.
"""
from __future__ import annotations

import os
import random
import sqlite3
from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from api.services import adjustment_basis as ab
from api.services import bar_contract as bc
from api.services import bars_sqlite as bs
from api.services import intraday_split_heal as ish

ET = ZoneInfo("America/New_York")
SEEDS = int(os.environ.get("SPLIT_HEAL_SEEDS", "24"))   # widen locally
RATIOS = (2.0, 3.0, 4.0, 10.0, 0.5, 0.25, 0.1, 1.5)


@pytest.fixture
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bs, "_DB_PATH", str(tmp_path / "bars.db"))
    bs.bump_db_epoch()
    bs.init_db()
    yield tmp_path
    bs.bump_db_epoch()


def _sessions(n, start=date(2026, 9, 1)):
    out, d = [], start
    while len(out) < n:
        if d.weekday() < 5:
            out.append(d)
        d += timedelta(days=1)
    return out


def _ts(d, hh, mm):
    return int(datetime(d.year, d.month, d.day, hh, mm, tzinfo=ET).timestamp())


def _grid(tf, days):
    """RTH bucket starts of `tf` (60m: TradingView 09:30 ... 15:30)."""
    step = int(tf) * 60
    out = []
    for d in days:
        t, end = _ts(d, 9, 30), _ts(d, 16, 0)
        while t < end:
            out.append(t)
            t += step
    return out


def _truth(rng, ts, step=0.003):
    """New-basis bars: a gentle random walk (no bar step anywhere near split size, and no
    session drifting far enough to hide a split from the session-close detector)."""
    px, out = 40.0 + rng.random() * 60.0, []
    for t in ts:
        o = px
        c = max(1.0, o * (1.0 + rng.uniform(-step, step)))
        h, l = max(o, c) * (1 + rng.uniform(0, 0.004)), min(o, c) * (1 - rng.uniform(0, 0.004))
        out.append({"t": t, "o": o, "h": h, "l": l, "c": c, "v": 1000 * rng.randint(1, 50)})
        px = c
    return out


def _old_basis(b, r):
    return {"t": b["t"], "o": b["o"] * r, "h": b["h"] * r, "l": b["l"] * r, "c": b["c"] * r,
            "v": int(round(b["v"] / r))}


def _rows(tk, tf):
    return bs.get_bars(tk, tf, 10 ** 6)


def _on_basis(rows, truth, r_tol):
    by_t = {b["t"]: b for b in truth}
    for ts, o, h, l, c, v in rows:
        b = by_t[ts]
        for got, want in ((o, b["o"]), (h, b["h"]), (l, b["l"]), (c, b["c"])):
            if abs(got / want - 1.0) > 1e-9:
                return False
        if abs(v - b["v"]) > r_tol:
            return False
    return True


# ── H1: every row of every tf on the new basis, history_rev exactly once ──────

@pytest.mark.parametrize("seed", range(SEEDS))
def test_H1_after_a_split_every_stored_row_is_on_the_new_basis(store, monkeypatch, seed):
    rng = random.Random(seed)
    tk = f"SPL{seed}"
    days = _sessions(rng.randint(18, 30))
    r = rng.choice(RATIOS)
    # the junction: a session boundary, or mid-session (a tail repair rewrote the
    # afternoon of the last pre-split session on the new basis)
    j_day = rng.randint(8, len(days) - 9)
    tfs = ("5", "15", "60")
    truth, junction = {}, {}
    for tf in tfs:
        ts = _grid(tf, days)
        truth[tf] = _truth(rng, ts)
        day_ts = [t for t in ts if datetime.fromtimestamp(t, ET).date() == days[j_day]]
        junction[tf] = rng.choice(day_ts) if rng.random() < 0.4 else day_ts[0]
        stored = [_old_basis(b, r) if b["t"] < junction[tf] else b for b in truth[tf]]
        bs.put_bars(tk, tf, stored)
    declared = days[max(0, min(len(days) - 1, j_day + rng.randint(-3, 3)))].isoformat()
    splits = [(declared, r)]
    h0 = {tf: bs.series_meta(tk, tf)["history_rev"] for tf in tfs}

    bumps = []
    real = bs.bump_series_revs

    def counting(c, keys, **kw):
        bumps.extend(sorted({(str(t).upper(), str(f)) for t, f in keys}))
        return real(c, keys, **kw)
    monkeypatch.setattr(bs, "bump_series_revs", counting)

    res = {p["tf"]: p for p in ish.heal_ticker(tk, splits=splits)}
    target = ab.target_basis_id(splits)
    for tf in tfs:
        assert res[tf]["status"] == "applied", (seed, tf, res[tf])
        assert _on_basis(_rows(tk, tf), truth[tf], r_tol=max(1.0, r)), (seed, tf)
        m = bs.series_meta(tk, tf)
        assert m["history_rev"] > h0[tf] and m["adj_basis"] == target
        assert bumps.count((tk, tf)) == 1, (seed, tf, bumps)   # exactly once
    # Idempotent: the heal finds nothing to do and writes nothing.
    revs = {tf: bs.series_meta(tk, tf)["rev"] for tf in tfs}
    again = ish.heal_ticker(tk, splits=splits)
    assert all(p["status"] == "unchanged" and not p["rescale"] for p in again)
    assert {tf: bs.series_meta(tk, tf)["rev"] for tf in tfs} == revs
    assert bumps.count((tk, "5")) == 1


# ── H2: an unprovable junction is never written ───────────────────────────────

@pytest.mark.parametrize("seed", range(SEEDS // 2))
def test_H2_a_mixed_series_is_refused_and_left_byte_identical(store, seed):
    rng = random.Random(1000 + seed)
    tk = f"MIX{seed}"
    days = _sessions(24)
    r = rng.choice(RATIOS)
    truth = _truth(rng, _grid("5", days))
    j = _ts(days[14], 9, 30)
    deep = _ts(days[rng.randint(1, 8)], 9, 30)   # new-basis rows a deep fetch prepended
    stored = [_old_basis(b, r) if deep <= b["t"] < j else b for b in truth]
    if rng.random() < 0.5:                     # ... or instead a lone split-sized print
        stored = [_old_basis(b, r) if b["t"] < j else b for b in truth]
        after = [i for i, b in enumerate(stored) if b["t"] > j][5:-5]
        k = rng.choice(after)
        stored[k] = _old_basis(stored[k], 1.0 / r)
    bs.put_bars(tk, "5", stored)
    before = _rows(tk, "5")
    h0 = bs.series_meta(tk, "5")["history_rev"]
    res = ish.heal_series(tk, "5", splits=[(days[14].isoformat(), r)])
    assert res["cliffs"] and res["refused"] and not res["rescale"]
    assert _rows(tk, "5") == before
    m = bs.series_meta(tk, "5")
    assert m["history_rev"] == h0 and m["adj_basis"] is None


def test_H2_a_bar_step_the_session_closes_hide_is_unknown_never_applied(store):
    """The session-close detector misses a split whose session moved far the other way;
    the bar scan still sees the step: the series is NOT stamped as adjusted (and nothing
    is written) — it stays unknown and is re-checked."""
    rng = random.Random(11)
    days = _sessions(24)
    truth = _truth(rng, _grid("5", days))
    j_day = 14
    # the junction session rallies so its close is back near the old scale
    day_ts = [b["t"] for b in truth if datetime.fromtimestamp(b["t"], ET).date() == days[j_day]]
    base = next(b["c"] for b in truth if b["t"] == day_ts[0])
    for b in truth:
        if b["t"] in day_ts:
            k = day_ts.index(b["t"])
            f = 1.0 + 0.9 * k / (len(day_ts) - 1)          # +90% across the session
            b.update(o=base * f, h=base * f * 1.001, l=base * f * 0.999, c=base * f)
        elif b["t"] > day_ts[-1]:
            b.update(o=b["o"] * 1.9, h=b["h"] * 1.9, l=b["l"] * 1.9, c=b["c"] * 1.9)
    stored = [_old_basis(b, 2.0) if b["t"] < day_ts[0] else b for b in truth]
    bs.put_bars("HID", "5", stored)
    before = _rows("HID", "5")
    res = ish.heal_series("HID", "5", splits=[(days[j_day].isoformat(), 2.0)])
    assert not res["rescale"] and res["refused"] and res["adj_basis"] is None
    assert _rows("HID", "5") == before


# ── H3: a write between the plan and the transaction voids the plan ──────────

def test_H3_a_write_after_the_plan_is_a_race_and_nothing_is_rescaled(store, monkeypatch):
    rng = random.Random(7)
    days = _sessions(20)
    truth = _truth(rng, _grid("5", days))
    j = _ts(days[10], 9, 30)
    bs.put_bars("RACE", "5", [_old_basis(b, 2.0) if b["t"] < j else b for b in truth])
    real_plan = ish.plan_series

    def plan_then_write(tk, tf, events, **kw):
        p = real_plan(tk, tf, events, **kw)
        last = bs.get_bars(tk, tf, 1)[0]
        bs.put_bars(tk, tf, [{"t": last[0] + 300, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0,
                              "v": 1}])
        return p
    monkeypatch.setattr(ish, "plan_series", plan_then_write)
    before = [r for r in _rows("RACE", "5") if r[0] < j]
    res = ish.heal_series("RACE", "5", splits=[(days[10].isoformat(), 2.0)])
    assert res["status"] == "raced"
    assert [r for r in _rows("RACE", "5") if r[0] < j] == before
    assert bs.series_meta("RACE", "5")["adj_basis"] is None
    monkeypatch.setattr(ish, "plan_series", real_plan)
    assert ish.heal_series("RACE", "5", splits=[(days[10].isoformat(), 2.0)])["status"] == "applied"


def test_a_split_the_series_has_not_reached_is_pending_not_applied(store):
    """Rows all written before a split's date are NOT on its basis: the stamp leaves the
    split out (and nothing is rewritten) until the series can show its step."""
    rng = random.Random(3)
    days = _sessions(12)
    bs.put_bars("PEND", "5", _truth(rng, _grid("5", days)))
    future = (days[-1] + timedelta(days=3)).isoformat()
    res = ish.heal_series("PEND", "5", splits=[(future, 2.0)], as_of=days[-1])
    assert res["pending"] == [future] and not res["rescale"]
    # the rows were WRITTEN (rev, wall clock) after that date: they may be on either basis
    assert bs.series_meta("PEND", "5")["adj_basis"] is None


def test_no_split_stamps_the_plain_basis_without_a_scan(store, monkeypatch):
    rng = random.Random(4)
    bs.put_bars("FLAT", "5", _truth(rng, _grid("5", _sessions(5))))
    monkeypatch.setattr(bs, "iter_ts_close", lambda *a, **k: pytest.fail("scanned"))
    assert ish.heal_series("FLAT", "5", splits=[])["status"] == "applied"
    assert bs.series_meta("FLAT", "5")["adj_basis"] == ab.BASIS_NONE == "s0"


# ── C1: the contract field ────────────────────────────────────────────────────

def test_C1_basis_id_is_a_pure_order_insensitive_function_of_the_applied_events():
    a = [("2026-10-08", 2.0), ("2025-01-02", 0.1)]
    assert ab.basis_id(a) == ab.basis_id(list(reversed(a))) == ab.basis_id(a + a[:1])
    assert ab.basis_id([]) == "s0"
    assert ab.basis_id(a[:1]) != ab.basis_id(a) != ab.basis_id([("2026-10-08", 3.0)])
    assert ab.basis_id([("2026-10-08", 2)]) == ab.basis_id([("2026-10-08", 2.0000001)])
    # non-adjudicable (a 3% stock dividend) and far-future events never move the target
    asof = date(2026, 11, 12)
    assert ab.target_basis_id([("2026-10-08", 1.03)], asof) == "s0"
    assert ab.target_basis_id([("2027-06-01", 2.0)], asof) == "s0"
    assert ab.target_basis_id([("2026-11-20", 2.0)], asof) == ab.basis_id([("2026-11-20", 2.0)])
    assert ab.basis_id(a).startswith("s1:") and len(ab.basis_id(a)) == 15


def test_C1_adj_basis_is_on_every_intraday_answer_and_stable(store):
    rng = random.Random(5)
    days = _sessions(20)
    truth = _truth(rng, _grid("15", days))
    j = _ts(days[12], 9, 30)
    bs.put_bars("CTR", "15", [_old_basis(b, 4.0) if b["t"] < j else b for b in truth])
    rows = [{"t": t, "o": o, "h": h, "l": l, "c": c, "v": v} for t, o, h, l, c, v in _rows("CTR", "15")]
    before = bc.compute("CTR", "15", "rth", rows)
    assert "adj_basis" in before and before["adj_basis"] is None      # never checked: unknown
    ish.heal_series("CTR", "15", splits=[(days[12].isoformat(), 4.0)])
    want = ab.basis_id([(days[12].isoformat(), 4.0)])
    outs = [bc.compute("CTR", "15", s, rows) for s in ("rth", "eth", None, "rth")]
    assert {o["adj_basis"] for o in outs} == {want}
    assert outs[0]["history_rev"] > before["history_rev"]
    derived = bc.derive_for_grid("CTR", "60", "eth", [], outs[1], "15")
    assert derived["adj_basis"] == want
    assert bc.compute("CTR", "D", None, [{"t": "2026-10-01", "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])["adj_basis"] is None
    assert bc.compute("CTR", "15", "rth", rows, store_backed=False)["adj_basis"] is None


def test_series_meta_reads_a_store_whose_meta_table_predates_the_column(store):
    bs.put_bars("OLD", "5", [{"t": _ts(date(2026, 10, 1), 10, 0), "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}])
    rev = bs.series_meta("OLD", "5")["rev"]
    c = sqlite3.connect(str(store / "bars.db"))
    c.execute("ALTER TABLE series_meta DROP COLUMN adj_basis")
    c.commit()
    c.close()
    bs.bump_db_epoch()
    m = bs.series_meta("OLD", "5")
    assert m["rev"] == rev and m["adj_basis"] is None
    # the heal's own write self-heals the column
    assert ish.heal_series("OLD", "5", splits=[])["status"] == "applied"
    assert bs.series_meta("OLD", "5")["adj_basis"] == "s0"
