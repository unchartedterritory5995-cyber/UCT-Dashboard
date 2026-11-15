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
Review of #1144:
  D1  any duplication / permutation of the declared events never rescales a row twice;
  D2  a CORRECTLY adjusted series is never written, whatever its gaps (a real gap the size
      of a small split shows in the daily closes too — `daily_proof`);
  D3  a stamp is voided by a later write that changes held history or prepends rows;
  M   report mode (the default) writes nothing — no rows, no stamps — and logs WOULD-RESCALE;
      a series deeper than the per-transaction cap is refused, never written in one UPDATE.
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
    monkeypatch.setenv("INTRADAY_SPLIT_HEAL_MODE", "write")
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


def _agg(base, tf):
    """Aggregate 5m RTH bars into `tf` buckets anchored at 09:30 (60m: 09:30 ... 15:30)."""
    step = int(tf) * 60
    out = {}
    for b in base:
        d = datetime.fromtimestamp(b["t"], ET).date()
        o930 = _ts(d, 9, 30)
        k = o930 + ((b["t"] - o930) // step) * step
        a = out.get(k)
        if a is None:
            out[k] = dict(b, t=k)
        else:
            a.update(h=max(a["h"], b["h"]), l=min(a["l"], b["l"]), c=b["c"], v=a["v"] + b["v"])
    return [out[k] for k in sorted(out)]


def _put_daily(tk, truth):
    """The stored DAILY bars on the current basis: each session's RTH close of `truth`."""
    last = {}
    for b in truth:
        dt = datetime.fromtimestamp(b["t"], ET)
        if 570 <= dt.hour * 60 + dt.minute < 960:
            last[dt.date().isoformat()] = b["c"]
    bs.put_bars(tk, "D", [{"t": d, "o": c, "h": c, "l": c, "c": c, "v": 1000} for d, c in sorted(last.items())],
                date_tf=True)


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
    base = _truth(rng, _grid("5", days))
    truth = {"5": base, "15": _agg(base, "15"), "60": _agg(base, "60")}
    junction = (_ts(days[j_day], 9, 30) if rng.random() < 0.6
                else _ts(days[j_day], rng.choice((10, 11, 12, 13, 14)), 30))
    for tf in tfs:
        bs.put_bars(tk, tf, [_old_basis(b, r) if b["t"] < junction else b for b in truth[tf]])
    _put_daily(tk, base)
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
    _put_daily("RACE", truth)
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
    _put_daily("CTR", truth)
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


# ── D1: one split listed twice is never applied twice ─────────────────────────

@pytest.mark.parametrize("seed", range(SEEDS))
def test_D1_any_duplication_or_permutation_of_events_never_rescales_a_row_twice(store, seed):
    rng = random.Random(5000 + seed)
    tk = f"DUP{seed}"
    days = _sessions(26)
    r = rng.choice(RATIOS)
    base = _truth(rng, _grid("5", days))
    j = _ts(days[13], 9, 30)
    bs.put_bars(tk, "5", [_old_basis(b, r) if b["t"] < j else b for b in base])
    _put_daily(tk, base)
    listings = [(days[13].isoformat(), r)]
    for _ in range(rng.randint(0, 3)):         # the same split again: another date / source
        k = rng.choice((-3, -2, -1, 0, 1, 2, 3))
        listings.append((days[13 + k].isoformat(), r if rng.random() < 0.8 else r * 1.04))
    rng.shuffle(listings)
    ish.heal_series(tk, "5", splits=listings)
    by_t = {b["t"]: b for b in base}
    distinct = len({(d, f"{x:.6g}") for d, x in listings})
    for ts, o, h, l, c, v in _rows(tk, "5"):
        q = c / by_t[ts]["c"]
        if ts >= j:
            assert abs(q - 1) < 1e-9
        else:
            # unchanged (old basis, q = r) or healed ONCE (q = 1) — never divided twice
            assert abs(q - r) < 1e-9 * r or abs(q - 1) < 1e-9, (seed, listings, q)
            if distinct > 1:
                assert abs(q - r) < 1e-9 * r, (seed, listings)        # refused: untouched


def test_D1_repro_a_split_listed_for_two_dates_is_refused_not_divided_by_r_squared(store):
    days = _sessions(26)
    base = _truth(random.Random(9), _grid("5", days))
    j = _ts(days[13], 9, 30)
    bs.put_bars("TWO", "5", [_old_basis(b, 2.0) if b["t"] < j else b for b in base])
    _put_daily("TWO", base)
    before = _rows("TWO", "5")
    res = ish.heal_series("TWO", "5", splits=[(days[13].isoformat(), 2.0), (days[15].isoformat(), 2.0)])
    assert not res["rescale"] and {x["why"] for x in res["refused"]} == {"step-claimed-twice"}
    assert _rows("TWO", "5") == before and bs.series_meta("TWO", "5")["adj_basis"] is None


# ── D2: a correctly adjusted series is never written ─────────────────────────

@pytest.mark.parametrize("ratio,gap", [(1.2, 0.92), (1.5, 0.70)])
def test_D2_repro_a_real_gap_near_a_small_split_is_never_rescaled(store, ratio, gap):
    """Correctly adjusted 60m rows, a real gap DOWN on the declared date (6:5 with an 8%
    gap; 3:2 with ~30%): the session detector sees a 'cliff' and the bar step is unique —
    but the daily closes show the same gap, so nothing is written."""
    days = _sessions(24)
    base = _truth(random.Random(21), _grid("5", days))
    g = _ts(days[12], 9, 30)
    base = [dict(b, o=b["o"] * gap, h=b["h"] * gap, l=b["l"] * gap, c=b["c"] * gap)
            if b["t"] >= g else b for b in base]
    bs.put_bars("GAP", "60", _agg(base, "60"))
    _put_daily("GAP", base)
    before, h0 = _rows("GAP", "60"), bs.series_meta("GAP", "60")["history_rev"]
    res = ish.heal_series("GAP", "60", splits=[(days[12].isoformat(), ratio)])
    assert res["cliffs"], "the session detector alone would have called this a split"
    assert not res["rescale"] and res["refused"][0]["why"] == "daily-proof-unknown"
    assert _rows("GAP", "60") == before
    assert bs.series_meta("GAP", "60")["history_rev"] == h0


@pytest.mark.parametrize("seed", range(SEEDS))
def test_D2_property_a_correctly_adjusted_series_with_arbitrary_gaps_is_never_written(store, seed):
    rng = random.Random(9000 + seed)
    tk = f"OK{seed}"
    days = _sessions(rng.randint(20, 30))
    base = _truth(rng, _grid("5", days))
    splits = []
    for _ in range(rng.randint(1, 3)):
        k = rng.randint(3, len(days) - 3)
        r = rng.choice(RATIOS)
        g = (1.0 / r) * rng.uniform(0.9, 1.1) if rng.random() < 0.7 else rng.uniform(0.6, 1.4)
        at = _ts(days[k], rng.choice((9, 11, 13)), 30)
        base = [dict(b, o=b["o"] * g, h=b["h"] * g, l=b["l"] * g, c=b["c"] * g)
                if b["t"] >= at else b for b in base]
        splits.append((days[max(0, min(len(days) - 1, k + rng.randint(-3, 3)))].isoformat(), r))
    tf = rng.choice(("5", "15", "60"))
    bs.put_bars(tk, tf, base if tf == "5" else _agg(base, tf))
    _put_daily(tk, base)
    before, h0 = _rows(tk, tf), bs.series_meta(tk, tf)["history_rev"]
    res = ish.heal_series(tk, tf, splits=splits)
    assert not res.get("rescale"), (seed, res.get("refused"))
    assert _rows(tk, tf) == before and bs.series_meta(tk, tf)["history_rev"] == h0


# ── D3: the stamp is bound to the series it was taken on ─────────────────────

def test_D3_a_later_old_basis_write_voids_the_stamp(store):
    days = _sessions(22)
    base = _truth(random.Random(31), _grid("5", days))
    j = _ts(days[12], 9, 30)
    splits = [(days[12].isoformat(), 2.0)]
    target = ab.target_basis_id(splits)
    bs.put_bars("BND", "5", [_old_basis(b, 2.0) if b["t"] < j else b for b in base[300:]])
    _put_daily("BND", base)
    ish.heal_series("BND", "5", splits=splits)
    assert bs.series_meta("BND", "5")["adj_basis"] == target
    # an old-basis fallback PREPENDS deeper rows (history_rev does not move for a prepend)
    bs.put_bars("BND", "5", [_old_basis(b, 2.0) for b in base[:300]])
    assert bs.series_meta("BND", "5")["adj_basis"] is None, "a stamp must not survive rows it never saw"
    # ... and the next check never re-stamps the target over that old-basis span (its step
    # lies far from the declared date: not provable, so unknown — never "applied")
    rows = _rows("BND", "5")
    res = ish.heal_series("BND", "5", splits=splits)
    assert not res["rescale"] and _rows("BND", "5") == rows
    assert bs.series_meta("BND", "5")["adj_basis"] is None
    # a held-history change (an interior row rewritten) voids a stamp too
    bs.put_bars("BND", "5", base[:300])                  # the span rewritten on the new basis
    ish.heal_series("BND", "5", splits=splits)
    assert bs.series_meta("BND", "5")["adj_basis"] == target
    row = _rows("BND", "5")[50]                          # held history rewritten
    bs.put_bars("BND", "5", [{"t": row[0], "o": row[1] * 2, "h": row[2] * 2, "l": row[3] * 2,
                              "c": row[4] * 2, "v": row[5]}])
    assert bs.series_meta("BND", "5")["adj_basis"] is None
    t0 = _rows("BND", "5")[50]
    bs.put_bars("BND", "5", [{"t": t0[0], "o": t0[1] * 2, "h": t0[2] * 2, "l": t0[3] * 2, "c": t0[4] * 2, "v": t0[5]}])
    assert bs.series_meta("BND", "5")["adj_basis"] is None


# ── M: report mode (default) and the per-transaction cap ─────────────────────

def test_M_report_mode_is_the_default_and_writes_nothing(store, monkeypatch, caplog):
    import logging
    monkeypatch.delenv("INTRADAY_SPLIT_HEAL_MODE", raising=False)
    assert ish.mode() == "report"
    days = _sessions(22)
    base = _truth(random.Random(41), _grid("5", days))
    j = _ts(days[12], 9, 30)
    bs.put_bars("REP", "5", [_old_basis(b, 2.0) if b["t"] < j else b for b in base])
    bs.put_bars("FLT", "5", base[:50])
    _put_daily("REP", base)
    before, rev = _rows("REP", "5"), bs.series_meta("REP", "5")["rev"]
    n0 = dict(ish.STATS)
    with caplog.at_level(logging.WARNING, logger=ish._log.name):
        res = ish.heal_series("REP", "5", splits=[(days[12].isoformat(), 2.0)])
        ish.heal_series("FLT", "5", splits=[])
    assert res["status"] == "report" and res["rescale"]
    assert _rows("REP", "5") == before and bs.series_meta("REP", "5")["rev"] == rev
    assert bs.series_meta("REP", "5")["adj_basis"] is None and bs.series_meta("FLT", "5")["adj_basis"] is None
    assert ish.STATS["would_rescale"] == n0["would_rescale"] + 1
    assert ish.STATS["would_stamp"] == n0["would_stamp"] + 1
    line = next(r.getMessage() for r in caplog.records if "WOULD-RESCALE" in r.getMessage())
    assert f"REP tfs=5 boundary={j} ratio=2 rows=" in line
    # the hard off checks nothing at all
    monkeypatch.setenv("INTRADAY_SPLIT_HEAL_ENABLED", "0")
    assert ish.heal_series("REP", "5", splits=[(days[12].isoformat(), 2.0)])["cliffs"] == []


def test_M_a_series_deeper_than_the_transaction_cap_is_refused(store, monkeypatch):
    monkeypatch.setenv("INTRADAY_SPLIT_HEAL_MAX_ROWS", "100")
    days = _sessions(22)
    base = _truth(random.Random(43), _grid("5", days))
    j = _ts(days[12], 9, 30)
    bs.put_bars("CAP", "5", [_old_basis(b, 2.0) if b["t"] < j else b for b in base])
    _put_daily("CAP", base)
    before = _rows("CAP", "5")
    res = ish.heal_series("CAP", "5", splits=[(days[12].isoformat(), 2.0)])
    assert not res["rescale"] and res["refused"][0]["why"] == "too-deep"
    assert _rows("CAP", "5") == before
