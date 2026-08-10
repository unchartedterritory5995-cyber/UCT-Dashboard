"""The refetch pass of `tools/bars_integrity_repair.py` must actually refetch.

🔴 WHAT THIS RAIL IS FOR, MEASURED. The pass shipped calling
``bars_fetch.get_bars(ticker, tf, 5000)``. **There is no ``get_bars`` in
``api/services/bars_fetch``** — the serve door is ``_get_bars_inner``. The call
sat inside ``except Exception``, so on 2026-08-09 a real run against a copy of
the live store printed 59 tidy ``AttributeError`` lines, recovered **0** rows,
and the re-scan reported the same count it started with. The very next command
in the runbook is ``--purge --apply``, which deletes what the refetch did not
recover: **932 sessions a provider could still supply** would have gone.

⛔ AND ``_get_bars_inner`` WOULD NOT HAVE SAVED IT EITHER. For a ticker that
already has rows it takes the DELTA branch — fetch only what is newer than
``last_ts`` — so it can never rewrite a settled session in the middle of the
history, which is where every one of these rows lives. "Call the serve path"
is the wrong fix; asking the provider for the affected sessions is the fix.

⭐ SO THE ASSERTION IS AGAINST THE SHIPPED MODULE, NOT A MOCK. A test that
stubbed ``bars_fetch`` would have passed on the broken code, because the stub
would have had whatever attribute the tool asked for. That is the whole defect:
the tool named a function nobody owned and nothing ever resolved the name.
"""
from __future__ import annotations

import importlib
import os
import sqlite3
import sys

import pytest

_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)
sys.path.insert(0, os.path.join(_ROOT, "tools"))

bars_integrity_repair = importlib.import_module("bars_integrity_repair")
from api.services import bars_fetch, bars_sqlite  # noqa: E402


# ── the wire itself ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("tf", ["D", "W", "M", "1", "5", "15", "30", "60"])
def test_every_timeframe_resolves_a_real_provider_entry_point(tf, monkeypatch):
    """Resolve the name the tool will call against the REAL `bars_fetch`."""
    called: dict = {}

    def _spy(name):
        def _f(*a, **k):
            called["name"] = name
            called["args"] = a
            return []
        return _f

    # Replace only what exists. `monkeypatch.setattr` with the default
    # `raising=True` is itself the assertion: a name `bars_fetch` does not own
    # raises AttributeError here, which is exactly how `get_bars` should have
    # been caught.
    for name in ("_fetch_daily", "_fetch_weekly", "_fetch_monthly",
                 "_fetch_intraday"):
        monkeypatch.setattr(bars_fetch, name, _spy(name))

    bars_integrity_repair._provider_bars(bars_fetch, "ZZTEST", tf)
    assert called.get("name"), f"tf={tf} resolved no provider call"
    expected = {"D": "_fetch_daily", "W": "_fetch_weekly",
                "M": "_fetch_monthly"}.get(tf, "_fetch_intraday")
    assert called["name"] == expected


def test_the_name_the_broken_version_called_does_not_exist():
    """The CONTROL. If `bars_fetch` ever grows a `get_bars`, the rail above
    stops being able to fail for the reason it was written, and this line is
    where you find out."""
    assert not hasattr(bars_fetch, "get_bars"), (
        "bars_fetch grew a `get_bars`; re-read this module's docstring before "
        "assuming the refetch pass is safe again")


# ── the pass, end to end, against a real store ───────────────────────────────

_GOOD = {"t": "2026-06-18", "o": 29.08, "h": 29.10, "l": 28.48, "c": 28.62,
         "v": 21172172}
_STILL_BAD = {"t": "2026-06-18", "o": 29.08, "h": 29.01, "l": 28.49,
              "c": None, "v": 20001496}


@pytest.fixture()
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(bars_sqlite, "_DB_PATH", str(tmp_path / "bars.db"))
    bars_sqlite.bump_db_epoch()
    bars_sqlite.init_db()
    c = bars_sqlite._conn()
    # The bad row goes in under the write path's back — put_bars would refuse it,
    # which is the point: these rows predate the guard.
    with bars_sqlite._WRITE_LOCK:
        c.executemany(
            "INSERT OR REPLACE INTO ohlcv(ticker,tf,ts,o,h,l,c,v) VALUES(?,?,?,?,?,?,?,?)",
            [("ZZRF", "D", 20260618, 29.08, 29.01, 28.49, None, 20001496),
             ("ZZRF", "D", 20260617, 29.00, 29.50, 28.90, 29.40, 111),
             ("ZZRF", "D", 20260619, 28.70, 29.00, 28.60, 28.95, 222)])
        c.commit()
    yield tmp_path
    bars_sqlite.bump_db_epoch()


def _run(monkeypatch, tmp_path, argv, answer):
    monkeypatch.setattr(bars_integrity_repair, "_provider_bars",
                        lambda _bf, _t, _tf: list(answer))
    monkeypatch.setattr(sys, "argv", ["bars_integrity_repair.py"] + argv)
    return bars_integrity_repair.main()


def test_refetch_replaces_a_session_the_provider_can_still_supply(
        store, monkeypatch):
    assert len(bars_sqlite.impossible_bars(tf="D")) == 1
    _run(monkeypatch, store, ["--refetch", "--apply", "--tf", "D"], [_GOOD])
    assert bars_sqlite.impossible_bars(tf="D") == [], "refetch recovered nothing"
    row = bars_sqlite._conn().execute(
        "SELECT o,h,l,c,v FROM ohlcv WHERE ticker='ZZRF' AND ts=20260618"
    ).fetchone()
    assert row == (29.08, 29.10, 28.48, 28.62, 21172172)


def test_refetch_rewrites_only_the_sessions_that_carry_a_bad_row(
        store, monkeypatch):
    """⛔ A repair has no business restating rows nobody complained about."""
    neighbour = {"t": "2026-06-17", "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5,
                 "v": 999}
    _run(monkeypatch, store, ["--refetch", "--apply", "--tf", "D"],
         [_GOOD, neighbour])
    kept = bars_sqlite._conn().execute(
        "SELECT o,h,l,c,v FROM ohlcv WHERE ticker='ZZRF' AND ts=20260617"
    ).fetchone()
    assert kept == (29.00, 29.50, 28.90, 29.40, 111), (
        "the refetch overwrote a session that was never impossible")


def test_a_still_impossible_provider_answer_is_refused_not_stored(
        store, monkeypatch):
    """`put_bars` re-asks the rule, so a bad answer cannot be laundered by
    passing through the repair. The row survives to the purge, which is right."""
    _run(monkeypatch, store, ["--refetch", "--apply", "--tf", "D"],
         [_STILL_BAD])
    assert len(bars_sqlite.impossible_bars(tf="D")) == 1
    row = bars_sqlite._conn().execute(
        "SELECT v FROM ohlcv WHERE ticker='ZZRF' AND ts=20260618").fetchone()
    assert row == (20001496,), "an impossible provider answer reached the store"


def test_purge_removes_what_no_source_has_and_the_pass_is_idempotent(
        store, monkeypatch):
    assert _run(monkeypatch, store,
                ["--refetch", "--purge", "--apply", "--tf", "D"],
                [_STILL_BAD]) == 0
    assert bars_sqlite.impossible_bars(tf="D") == []
    left = bars_sqlite._conn().execute(
        "SELECT COUNT(*) FROM ohlcv WHERE ticker='ZZRF'").fetchone()[0]
    assert left == 2, "the purge took rows that were never impossible"
    assert _run(monkeypatch, store,
                ["--refetch", "--purge", "--apply", "--tf", "D"], []) == 0
