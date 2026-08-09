"""A bar that could not have happened must not be storable.

🔴 THE MEASUREMENT, over all 17,144,361 daily rows in the store on 2026-08-09:

    open outside [low, high]        3,533 rows / 195 tickers
    close outside [low, high]          32
    close NULL                        119   (beside a real o/h/l and real volume)
    o/h/l NULL                          2
    close <= 0                          1
    intraday (1/5/15/30/60)             0   <-- the diagnosis is in this row

`GME 2026-08-03 o=20.46 h=20.45` · `MSC 2026-07-10 o=1.89 h=1.76` (the open 7.39%
ABOVE the high) · `ALX 2026-08-03 o=270.14 h=269.15` · `SBH 2026-08-03 o=14.99
l=15.00`.

⭐ AND THE RULES ALREADY EXISTED. `bar_validation.validate_bar` encoded `H<O`,
`L>O`, `H<C`, `L>C` and `zero or negative price` all along — and its three
callers were the INTRADAY fetch chain, the disk SERVING cache and two read-only
auditors. `bars_sqlite.put_bars`, the one function every application write passes
through, validated nothing. That asymmetry, not a maths error, is why intraday
reads zero and daily reads 3,533.

Four distinct mechanisms sit under those counts and the fix has to answer all
four, which is why the predicate is not just `l <= o <= h`:

  1. an OPEN from a window including the pre-market print with H/L/C from the
     regular session — 214 rows, 173 of them the ticker's newest bar, i.e.
     in-progress daily aggregates frozen where a warm run stopped;
  2. `o == 0.0` as a MISSING-VALUE SENTINEL — 3,317 rows, one closed-end fund
     whose vendor returns no opening price for old history;
  3. a NaN close: `round(float(row["Close"]), 2)` inside a `try/except … continue`
     that only catches a RAISE, and SQLite stores a NaN REAL as **NULL** — after
     which a provider's NaN and a genuinely absent session are indistinguishable
     forever. Every `<` against a NaN is False, so the geometric rules cannot see
     it and finiteness has to be asked separately;
  4. an all-NULL `v=0` placeholder, which is the one honest absence.
"""
from __future__ import annotations

import math
import os
import sqlite3

import pytest

from api.services import bar_validation as bv
from api.services import bars_sqlite


@pytest.fixture
def fresh_db(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    yield
    bars_sqlite.bump_db_epoch()


def _bar(**kw):
    b = {"t": 20260803, "o": 10.0, "h": 11.0, "l": 9.0, "c": 10.5, "v": 1000}
    b.update(kw)
    return b


#: The rows as they actually sit in the store, by ticker and session.
MEASURED = {
    "GME 2026-08-03": _bar(t=20260803, o=20.46, h=20.45, l=18.55, c=19.06),
    "MSC 2026-07-10": _bar(t=20260710, o=1.89, h=1.76, l=1.73, c=1.76),
    "ALX 2026-08-03": _bar(t=20260803, o=270.14, h=269.15, l=259.00, c=261.77),
    "SBH 2026-08-03": _bar(t=20260803, o=14.99, h=17.20, l=15.00, c=16.13),
    "NQP o=0.0 sentinel": _bar(t=20030821, o=0.0, h=14.48, l=14.37, c=14.34),
    "UPS 2026-06-18 close under low": _bar(t=20260618, o=105.0, h=105.5,
                                           l=104.87, c=104.86),
    "NaN close (stored as NULL)": _bar(t=20260618, c=float("nan")),
    "NULL close": _bar(t=20260618, c=None),
    "all-NULL placeholder": _bar(t=20130909, o=None, h=None, l=None, c=None, v=0),
}


class TestThePredicate:
    @pytest.mark.parametrize("label", sorted(MEASURED))
    def test_every_measured_shape_is_named_impossible(self, label):
        reasons = bv.possible_bar_reasons(MEASURED[label])
        assert reasons, f"{label} was accepted as a possible bar"
        assert bv.describes_a_possible_bar(MEASURED[label]) is False

    def test_an_ordinary_bar_is_possible(self):
        assert bv.possible_bar_reasons(_bar()) == []

    def test_a_violent_session_is_still_possible(self):
        """⛔ GEOMETRY, NOT PLAUSIBILITY. `validate_bar`'s wide-bar gate refuses a
        range over 30% of the close — correct at a cache boundary, and wrong at a
        store write, where it would drop a real halt-and-reopen session."""
        wild = _bar(o=10.0, h=30.0, l=8.0, c=25.0)
        assert bv.possible_bar_reasons(wild) == []
        ok, reasons = bv.validate_bar(wild)
        assert ok is False and any("wide-bar" in r for r in reasons)

    def test_a_nan_is_not_reported_as_a_geometry_failure(self):
        """The NaN has to be caught by name. `h < l` is False for a NaN, so
        without the finiteness question it passes every rule below it."""
        reasons = bv.possible_bar_reasons(_bar(c=float("nan")))
        assert reasons == ["non-finite price: c"]

    def test_validate_bar_still_reports_the_geometry_it_always_did(self):
        """One authority: `validate_bar` consults the predicate rather than
        keeping a second copy of `h < l`."""
        ok, reasons = bv.validate_bar(MEASURED["GME 2026-08-03"])
        assert ok is False and "H<O" in reasons


class TestPutBarsRefuses:
    def test_the_store_will_not_take_an_impossible_bar(self, fresh_db):
        written = bars_sqlite.put_bars("GME", "D",
                                       [MEASURED["GME 2026-08-03"]], date_tf=False)
        assert written == 0
        assert bars_sqlite.get_bars("GME", "D", 10) == []

    def test_the_good_bars_in_a_mixed_batch_still_land(self, fresh_db):
        batch = [_bar(t=20260801), MEASURED["MSC 2026-07-10"], _bar(t=20260804)]
        written = bars_sqlite.put_bars("MIX", "D", batch, date_tf=False)
        assert written == 2
        assert [r[0] for r in bars_sqlite.get_bars("MIX", "D", 10)] == [20260801, 20260804]

    def test_the_return_value_is_the_accepted_count(self, fresh_db):
        """⚠️ `alert_bars_freshness` reads this as `if not rows: status = 'empty'`.
        Returning `len(bars)` after refusing all of them reports success on a
        batch that stored nothing."""
        assert bars_sqlite.put_bars("X", "D", [MEASURED["NQP o=0.0 sentinel"]],
                                    date_tf=False) == 0

    def test_a_refused_bar_is_dropped_and_never_coerced(self, fresh_db):
        """⛔ Clamping `o` into `[l, h]`, or widening `h` to admit it, fabricates
        a print that did not happen. No row, not a repaired row."""
        bars_sqlite.put_bars("GME", "D", [MEASURED["GME 2026-08-03"]], date_tf=False)
        rows = bars_sqlite.get_bars("GME", "D", 10)
        assert rows == []

    def test_a_refusal_never_disturbs_a_row_already_stored(self, fresh_db):
        bars_sqlite.put_bars("KEEP", "D", [_bar(t=20260803)], date_tf=False)
        before = bars_sqlite.get_bars("KEEP", "D", 10)
        bars_sqlite.put_bars("KEEP", "D",
                             [_bar(t=20260803, o=99.0, h=1.0, l=0.5, c=0.9)],
                             date_tf=False)
        assert bars_sqlite.get_bars("KEEP", "D", 10) == before

    def test_zero_volume_is_legitimate_and_kept(self, fresh_db):
        """An illiquid or extended-hours session really does print zero volume;
        refusing it would delete real sessions to fix a different defect."""
        assert bars_sqlite.put_bars("THIN", "D", [_bar(v=0)], date_tf=False) == 1

    def test_the_kill_switch_lets_an_impossible_bar_through(self, fresh_db, monkeypatch):
        """A guard nobody has seen fail is not a guard. This drives the OTHER
        branch so the refusal above cannot be passing for an unrelated reason."""
        monkeypatch.setenv("BARS_WRITE_VALIDATION", "0")
        assert bars_sqlite.put_bars("GME", "D", [MEASURED["GME 2026-08-03"]],
                                    date_tf=False) == 1

    def test_intraday_is_gated_by_the_same_door(self, fresh_db):
        """The store had zero intraday violations because the intraday FETCH
        chain validated; the STORE did not. A daily-only gate would leave the
        asymmetry in place, one layer down."""
        assert bars_sqlite.put_bars(
            "GME", "5", [_bar(t=1_750_000_000, o=20.46, h=20.45, l=18.55, c=19.06)],
            date_tf=False) == 0


class TestTheSnapshotMergeIsGatedToo:
    """🔴 THE SECOND WRITE DOOR. `data_sync._merge_ohlcv_from` writes `ohlcv`
    with raw SQL and never touches `put_bars`. Gating only `put_bars` would hold
    the invariant going forward and have it undone by the next R2 restore."""

    def _db(self, path, rows):
        con = sqlite3.connect(path)
        con.execute("""CREATE TABLE ohlcv (ticker TEXT NOT NULL, tf TEXT NOT NULL,
            ts INTEGER NOT NULL, o REAL, h REAL, l REAL, c REAL, v INTEGER,
            PRIMARY KEY (ticker, tf, ts))""")
        con.executemany("INSERT INTO ohlcv VALUES (?,?,?,?,?,?,?,?)", rows)
        con.commit()
        con.close()

    def test_a_snapshot_cannot_reimport_an_impossible_bar(self, tmp_path):
        from api.services import data_sync
        snap, local = str(tmp_path / "snap.db"), str(tmp_path / "bars.db")
        self._db(snap, [
            ("GME", "D", 20260803, 20.46, 20.45, 18.55, 19.06, 1),   # o > h
            ("GME", "D", 20260804, 19.0, 19.5, 18.5, 19.2, 2),       # fine
            ("NQP", "D", 20030821, 0.0, 14.48, 14.37, 14.34, 3),     # sentinel
            ("RF", "D", 20260618, 29.08, 29.10, 28.49, None, 4),     # NaN -> NULL
        ])
        self._db(local, [("GME", "D", 20260701, 20.0, 21.0, 19.0, 20.5, 9)])
        adopted = data_sync._merge_ohlcv_from(snap, local_db=local)
        con = sqlite3.connect(local)
        got = con.execute("SELECT ticker, ts FROM ohlcv ORDER BY ticker, ts").fetchall()
        con.close()
        assert got == [("GME", 20260701), ("GME", 20260804)]
        assert adopted == 1


class TestTheDeepfillWriterCannotRunUnderPytest:
    """🔴 THE WRITER THAT PUT 16,500 FIXTURE BARS IN THE LIVE STORE. `C:\\data\\
    bars.db` holds 16,500 MSTR tf=5 rows reading `o=10.00 h=10.50 l=9.50 c=10.20
    v=100` across weekends — the values come from a test's mocked
    `_fetch_intraday`, the WRITE comes from `_maybe_kick_deepfill`'s daemon
    thread, which outlives the test and reconnects against the RESTORED
    `_DB_PATH`. The repo-root conftest redirect is the right control and it is a
    file in the tree: 50 of 54 worktrees on this box do not have it, and 40 of
    those ship the test. This guard travels with the code instead."""

    def test_no_thread_is_spawned_while_pytest_is_running(self, monkeypatch):
        import threading
        from api.services import bars_fetch
        spawned = []
        monkeypatch.setattr(bars_fetch._threading, "Thread",
                            lambda *a, **kw: spawned.append(kw.get("name")) or
                            _NeverStarts())
        bars_fetch._maybe_kick_deepfill("MSTR", "5", 5000)
        assert spawned == []
        assert not [t for t in threading.enumerate()
                    if (t.name or "").startswith("deepfill-")]

    def test_the_guard_is_the_pytest_marker_and_nothing_else(self, monkeypatch):
        """The control: with the marker cleared the writer DOES fire, so the test
        above cannot be green because deepfill is disabled for another reason."""
        from api.services import bars_fetch
        monkeypatch.delenv("PYTEST_CURRENT_TEST", raising=False)
        monkeypatch.setattr(bars_fetch, "_DEEPFILL_ENABLED", True)
        monkeypatch.setattr(bars_fetch.cache, "get", lambda *a, **k: None)
        monkeypatch.setattr(bars_fetch.cache, "set", lambda *a, **k: None)
        spawned = []
        monkeypatch.setattr(bars_fetch._threading, "Thread",
                            lambda *a, **kw: spawned.append(kw.get("name")) or
                            _NeverStarts())
        bars_fetch._maybe_kick_deepfill("MSTR", "5", 5000)
        assert spawned == ["deepfill-MSTR-5"]


class _NeverStarts:
    def start(self):
        pass


# ── stored price precision ──────────────────────────────────────────────────
class TestStoredPricePrecision:
    """🔴 EVERY STORED PRICE WAS ROUNDED TO 2 DECIMALS at seven provider
    boundaries — confirmed: 0 of 17,144,361 daily bars carried more than two
    places. Against Yahoo on the same sessions: CAN 2026-06-16 ours `0.34` vs
    `0.345` = **1.449%**; DEFT 0.49/0.485; GETY 0.61/0.605. It feeds `adr_pct`,
    and `adr_pct < 4%` is a HARD screener gate applied to exactly these names, so
    the rounding changed which stocks a member is shown."""

    def test_a_half_cent_on_a_sub_dollar_name_survives_the_round_trip(self):
        """⛔ THE ERROR IS DERIVED, NOT RETYPED. Writing `0.485 -> 0.49` here would
        be a second authority over what Python's rounding does — and it is wrong
        (`round(0.485, 2)` is `0.48`). What the fix has to deliver is that the
        stored price no longer moves at all."""
        from api.services.bars_fetch import _px
        for vendor in (0.345, 0.485, 0.605):
            old_error = abs(round(vendor, 2) - vendor) / vendor
            assert old_error > 0.008, f"{vendor} was not a sub-cent casualty"
            assert _px(vendor) == vendor
            assert abs(_px(vendor) - vendor) == 0.0

    def test_the_precision_matches_the_split_healer(self):
        """⛔ ONE GRAIN FOR THE WHOLE STORE. `bars_sanitize.scale_bar` has always
        written split-adjusted prices at 4 places; a fetch at 2 and a heal at 4
        is the same split-brain one decimal down."""
        import inspect
        from api.services import bars_fetch, bars_sanitize
        assert bars_fetch.PRICE_DP == 4
        src = inspect.getsource(bars_sanitize.scale_bar)
        assert f"round(v / f, {bars_fetch.PRICE_DP})" in src

    def test_no_price_is_still_rounded_to_two_places(self):
        """⛔ SEVEN SITES, NOT SIX. A precision applied at six of seven boundaries
        makes the store's grain depend on WHICH provider answered. Read with an
        AST, never a grep."""
        import ast as _ast
        import inspect
        from api.services import bars_fetch
        tree = _ast.parse(inspect.getsource(bars_fetch))
        offenders = []
        for node in _ast.walk(tree):
            if (isinstance(node, _ast.Call)
                    and getattr(node.func, "id", "") == "round"
                    and len(node.args) == 2
                    and isinstance(node.args[1], _ast.Constant)
                    and node.args[1].value == 2):
                offenders.append(node.lineno)
        assert offenders == []

    def test_every_price_field_goes_through_the_one_helper(self):
        """The count the audit measured: seven provider boundaries, four price
        fields each. Derived from the AST so it cannot be satisfied by prose."""
        import ast as _ast
        import inspect
        from api.services import bars_fetch
        tree = _ast.parse(inspect.getsource(bars_fetch))
        calls = [n for n in _ast.walk(tree)
                 if isinstance(n, _ast.Call) and getattr(n.func, "id", "") == "_px"]
        assert len(calls) == 28, f"expected 7 boundaries x 4 fields, found {len(calls)}"
