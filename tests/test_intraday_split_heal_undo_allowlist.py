"""The intraday split heal's go-live guards (2026-11-21): the UNDO table, the ALLOWLIST and the revert.

Synthetic stores only; every price is an invented number from a seeded random walk.

  U  every rescale writes the exact pre-image (and post-image) of each row it touches into
     `split_heal_undo`, IN THE SAME TRANSACTION as the rows (a failed write leaves neither); the
     revert restores the pre-images by compare-and-set: only rows still exactly as the heal wrote
     them, so a row rewritten since is never overwritten. Reverse-split volume rounding is undone
     exactly (the pre-image is the original integer, not an inverse of the rounding).
  A  in WRITE mode a plan is written only when INTRADAY_SPLIT_HEAL_ALLOW lists it: the exact
     (ticker, tf, boundary, ratio), with at most the audited rows before the boundary. Stamp-only
     writes need the (ticker, tf) listed too. Unset or empty = nothing is written (fail closed);
     "*" = every proven plan (the behaviour before this guard).
"""
from __future__ import annotations

import logging
import random

import pytest

from api.services import adjustment_basis as ab
from api.services import bars_sqlite as bs
from api.services import intraday_split_heal as ish
from tests.test_intraday_split_heal_basis import (  # noqa: F401 -- `store` is a fixture used by name
    _grid, _old_basis, _put_daily, _rows, _sessions, _truth, _ts, store)


def _series(tk, r, *, small_volumes=False, seed=61):
    """A 5m series on the old basis before days[12] 09:30, the daily on the new basis."""
    days = _sessions(22)
    truth = _truth(random.Random(seed), _grid("5", days))
    j = _ts(days[12], 9, 30)
    stored = [_old_basis(b, r) if b["t"] < j else b for b in truth]
    if small_volumes:                        # old-basis volumes a 1:4 rounds lossily (3 x 0.25 -> 1)
        rng = random.Random(seed + 1)
        stored = [dict(b, v=rng.randint(1, 9)) if b["t"] < j else b for b in stored]
    bs.put_bars(tk, "5", stored)
    _put_daily(tk, truth)
    return days, truth, j


def _undo_rows(tk, tf):
    c = bs._conn()
    return c.execute("SELECT ts, o, h, l, c, v, o2, h2, l2, c2, v2 FROM split_heal_undo "
                     "WHERE ticker=? AND tf=? ORDER BY ts", (tk, tf)).fetchall()


# ── U: the undo table and the revert ──────────────────────────────────────────

@pytest.mark.parametrize("r", [2.0, 0.25])
def test_U_every_rescaled_row_has_its_exact_pre_image_and_the_revert_restores_it(store, r):
    days, truth, j = _series("UND", r, small_volumes=(r < 1))
    before = _rows("UND", "5")
    h0 = bs.series_meta("UND", "5")["history_rev"]
    res = ish.heal_series("UND", "5", splits=[(days[12].isoformat(), r)])
    assert res["status"] == "applied" and res["written"] > 0
    healed = _rows("UND", "5")
    undo = _undo_rows("UND", "5")
    pre = [row for row in before if row[0] < j]
    assert [u[:6] for u in undo] == pre, "the pre-images are the rows exactly as they were"
    by_ts = {row[0]: row for row in healed}
    assert [u[6:] for u in undo] == [by_ts[u[0]][1:] for u in undo], "the post-images are what the heal wrote"
    if r < 1:
        assert any(by_ts[u[0]][5] / r != u[5] for u in undo), "the fixture must round lossily"
    h1 = bs.series_meta("UND", "5")["history_rev"]
    assert h1 > h0
    out = bs.undo_split_basis("UND", "5")
    assert out["status"] == "reverted" and out["restored"] == len(pre) and out["skipped"] == 0
    assert _rows("UND", "5") == before, "byte-identical to the store before the heal"
    m = bs.series_meta("UND", "5")
    assert m["history_rev"] > h1 and m["adj_basis"] is None
    raw = bs._conn().execute("SELECT adj_basis FROM series_meta WHERE ticker='UND' AND tf='5'").fetchone()
    assert raw[0] is None, "the stored stamp itself is cleared, not only voided by the history_rev bind"
    assert bs.undo_split_basis("UND", "5")["status"] == "nothing-to-undo"


def test_U_the_revert_never_overwrites_a_row_rewritten_since_the_heal(store):
    days, truth, j = _series("CAS", 2.0)
    before = _rows("CAS", "5")
    ish.heal_series("CAS", "5", splits=[(days[12].isoformat(), 2.0)])
    healed = [row for row in _rows("CAS", "5") if row[0] < j]
    t, o, h, l, c, v = healed[40]
    bs.put_bars("CAS", "5", [{"t": t, "o": o + 0.5, "h": h + 0.5, "l": l + 0.5, "c": c + 0.5, "v": v + 7}])
    out = bs.undo_split_basis("CAS", "5")
    assert out["status"] == "reverted" and out["skipped"] == 1 and out["restored"] == len(healed) - 1
    now = {row[0]: row for row in _rows("CAS", "5")}
    assert now[t] == (t, o + 0.5, h + 0.5, l + 0.5, c + 0.5, v + 7), "the later write stands"
    want = {row[0]: row for row in before}
    assert all(now[x] == want[x] for x in want if x != t)


def test_U_the_undo_rows_are_in_the_same_transaction_as_the_rescale(store, monkeypatch):
    days, truth, j = _series("ATM", 2.0)
    before = _rows("ATM", "5")

    def boom(*a, **k):
        raise RuntimeError("the write fails after the rows were updated")
    monkeypatch.setattr(bs, "bump_series_revs", boom)
    with pytest.raises(RuntimeError):
        ish.heal_series("ATM", "5", splits=[(days[12].isoformat(), 2.0)])
    assert _rows("ATM", "5") == before
    c = bs._conn()
    have = c.execute("SELECT name FROM sqlite_master WHERE name='split_heal_undo'").fetchone()
    assert have is None or not _undo_rows("ATM", "5"), "no pre-image survives a rolled-back heal"


def test_U_a_raced_plan_writes_no_undo_rows(store, monkeypatch):
    days, truth, j = _series("RCE", 2.0)
    real = ish.plan_series

    def plan_then_write(tk, tf, events, **kw):
        p = real(tk, tf, events, **kw)
        last = bs.get_bars(tk, tf, 1)[0]
        bs.put_bars(tk, tf, [{"t": last[0] + 300, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 1}])
        return p
    monkeypatch.setattr(ish, "plan_series", plan_then_write)
    assert ish.heal_series("RCE", "5", splits=[(days[12].isoformat(), 2.0)])["status"] == "raced"
    c = bs._conn()
    if c.execute("SELECT name FROM sqlite_master WHERE name='split_heal_undo'").fetchone():
        assert not _undo_rows("RCE", "5")


def test_U_the_revert_command_line(store):
    days, truth, j = _series("CLI", 2.0)
    before = _rows("CLI", "5")
    ish.heal_series("CLI", "5", splits=[(days[12].isoformat(), 2.0)])
    assert ish._cli(["list", "CLI", "5"]) == 0
    assert ish._cli(["undo", "CLI", "5"]) == 0
    assert _rows("CLI", "5") == before
    assert ish._cli(["undo", "CLI", "5"]) == 1, "nothing left to undo is a non-zero exit"


# ── A: the allowlist ─────────────────────────────────────────────────────────

def _entry(tk, tf, boundary, r, rows):
    return f"{tk}:{tf}:{boundary}:{r:.6g}:{rows}"


@pytest.mark.parametrize("allow", [None, "", "  "])
def test_A_write_mode_without_an_allowlist_writes_nothing(store, monkeypatch, caplog, allow):
    if allow is None:
        monkeypatch.delenv("INTRADAY_SPLIT_HEAL_ALLOW", raising=False)
    else:
        monkeypatch.setenv("INTRADAY_SPLIT_HEAL_ALLOW", allow)
    days, truth, j = _series("NOL", 2.0)
    before = _rows("NOL", "5")
    with caplog.at_level(logging.WARNING, logger=ish._log.name):
        res = ish.heal_series("NOL", "5", splits=[(days[12].isoformat(), 2.0)])
    assert res["status"] == "not-allowlisted" and res["written"] == 0
    assert _rows("NOL", "5") == before and bs.series_meta("NOL", "5")["adj_basis"] is None
    line = next(x.getMessage() for x in caplog.records if "WOULD-RESCALE" in x.getMessage())
    assert f"NOL tfs=5 boundary={j} ratio=2 rows=" in line and "not allowlisted" in line


def test_A_only_the_exact_audited_entry_writes(store, monkeypatch):
    days, truth, j = _series("ALW", 2.0)
    n = sum(1 for row in _rows("ALW", "5") if row[0] < j)
    split = [(days[12].isoformat(), 2.0)]
    before = _rows("ALW", "5")
    for wrong in (_entry("ALW", "5", j + 300, 2.0, n),      # another boundary
                  _entry("ALW", "5", j, 3.0, n),            # another ratio
                  _entry("ALW", "15", j, 2.0, n),           # another tf
                  _entry("OTH", "5", j, 2.0, n),            # another ticker
                  _entry("ALW", "5", j, 2.0, n - 1)):       # more rows than were audited
        monkeypatch.setenv("INTRADAY_SPLIT_HEAL_ALLOW", wrong)
        res = ish.heal_series("ALW", "5", splits=split)
        assert res["status"] == "not-allowlisted", wrong
        assert _rows("ALW", "5") == before, wrong
    monkeypatch.setenv("INTRADAY_SPLIT_HEAL_ALLOW", "BAD, " + _entry("ALW", "5", j, 2.0, n) + " ,X:1")
    res = ish.heal_series("ALW", "5", splits=split)
    assert res["status"] == "applied" and res["written"] == n
    assert bs.series_meta("ALW", "5")["adj_basis"] == ab.target_basis_id(split)


def test_A_a_stamp_only_write_needs_its_series_listed(store, monkeypatch):
    days = _sessions(22)
    truth = _truth(random.Random(71), _grid("5", days))
    bs.put_bars("STP", "5", truth)                      # applied by the vendor: no cliff
    _put_daily("STP", truth)
    split = [(days[6].isoformat(), 2.0)]
    monkeypatch.setenv("INTRADAY_SPLIT_HEAL_ALLOW", "OTHER:5")
    res = ish.heal_series("STP", "5", splits=split)
    assert res["status"] == "not-allowlisted" and bs.series_meta("STP", "5")["adj_basis"] is None
    monkeypatch.setenv("INTRADAY_SPLIT_HEAL_ALLOW", "STP:5")
    assert ish.heal_series("STP", "5", splits=split)["status"] == "applied"
    assert bs.series_meta("STP", "5")["adj_basis"] == ab.target_basis_id(split)


def test_A_star_allows_every_proven_plan(store, monkeypatch):
    monkeypatch.setenv("INTRADAY_SPLIT_HEAL_ALLOW", "*")
    days, truth, j = _series("STR", 2.0)
    assert ish.heal_series("STR", "5", splits=[(days[12].isoformat(), 2.0)])["status"] == "applied"
