"""The restate that removes a symbol's EARLIER LIFE from the stored ratings.

Production, 2026-11-12: 8 of the 14 liquid stocks rated 99 were recycled or renamed
symbols (BNY, BSP, SPCX, P, LIFE, MDA, JAN, CBC) whose rating window read across the
break between two securities. ``rs_history._window_bounds`` now stops at such a break;
``--restate-listing-breaks`` re-ranks the stored sessions the old window wrote, under
its OWN marker (the universe restate's marker says those sessions are finished).
"""
from __future__ import annotations

import json
import sqlite3
from datetime import timedelta

import pytest

from api.services import listing_break
from api.services.screener import rs_history as rh
from tests.test_rs_ibd_style_components import END, ETFS, SESSIONS, _names
from tests.test_rs_rating_history import (  # noqa: F401 - fixtures are used by name
    _query, _weekdays_ending, _ymd, make_reader, provider, tmp_db,
)

LISTING = (rh.LISTING_TABLE, rh.LISTING_METHOD)


@pytest.fixture(autouse=True)
def small_floor(monkeypatch):
    monkeypatch.setattr(rh, "UNIVERSE_MIN_RANKED", 5)
    monkeypatch.setattr(rh, "_lock_sleep", lambda s: None)


def _recycled_rows(old_bars=200, new_bars=150, gap_days=104):
    """``RECY``: an earlier security near 10, a 104-day break, then today's stock near
    150 (flat, so its own ratios are all 1.0 and its honest rating is ordinary)."""
    new_days = _weekdays_ending(END, new_bars)
    old_days = _weekdays_ending(new_days[0] - timedelta(days=gap_days), old_bars)
    rows = [(_ymd(d), 10.0, 10.0, 10.0, 10.0, 1000) for d in old_days]
    rows += [(_ymd(d), 150.0, 150.0, 150.0, 150.0, 1000) for d in new_days]
    return rows


def _reader(series):
    base = make_reader(series, END)
    recy = _recycled_rows()

    def reader(ticker, n, to_key):
        if ticker.upper() == "RECY":
            return [r for r in recy if r[0] <= int(to_key)][-int(n):]
        return base(ticker, n, to_key)
    return reader


def _store_as_the_pod_holds_it(tmp_db, monkeypatch, series):
    """Rated BEFORE the guard existed (the break length set out of reach), and already
    marked by the universe restate, as production is."""
    names = [t for t in series if t not in ETFS] + ["RECY"]
    with monkeypatch.context() as m:
        m.setattr(listing_break, "GAP_DAYS", 10 ** 6)
        r = rh.backfill(days=3, universe=names, etf_tickers=ETFS, bars_reader=_reader(series),
                        splits_reader=lambda t: [], sessions=SESSIONS)
        assert r["ok"], r
        u = rh.restate_universe(3, universe=names, etf_tickers=ETFS, bars_reader=_reader(series),
                                splits_reader=lambda t: [], sessions=SESSIONS)
        assert u["ok"], u
    return names


def _row(path, ticker, session="2026-11-05"):
    got = _query(path, f"SELECT ibd, m1, m3, m6, m9, m12, score, bars FROM {rh.TABLE} "
                       "WHERE session = ? AND ticker = ?", (session, ticker))
    return got[0] if got else None


def _run(series, names, **kw):
    return rh.restate_universe(3, universe=names, etf_tickers=ETFS, bars_reader=_reader(series),
                               splits_reader=lambda t: [], sessions=SESSIONS, marker=LISTING, **kw)


def test_the_store_the_pod_holds_rates_the_recycled_symbol_99(tmp_db, monkeypatch):
    series = _names(60)
    _store_as_the_pod_holds_it(tmp_db, monkeypatch, series)
    row = _row(tmp_db, "RECY")
    assert row["bars"] == rh.READ_BARS and row["ibd"] == 99 and row["m12"] == 99
    assert row["score"] > 5.0, "150 / 10 on the long terms"


def test_the_restate_rates_it_on_its_own_listing_and_names_it(tmp_db, monkeypatch):
    series = _names(60)
    names = _store_as_the_pod_holds_it(tmp_db, monkeypatch, series)
    r = _run(series, names)
    assert r["ok"] is True and r["note"]["method"] == rh.LISTING_METHOD
    assert r["note"]["sessions_done"] == 3
    row = _row(tmp_db, "RECY")
    assert row["bars"] == 150 and row["m9"] is None and row["m12"] is None
    assert row["score"] == pytest.approx(1.0) and row["ibd"] < 99
    changed = r["note"]["changed_newest"]
    assert changed["session"] == "2026-11-05" and changed["over"] >= 1
    assert changed["examples"][0]["ticker"] == "RECY" and changed["examples"][0]["was"] == 99
    assert changed["examples"][0]["now"] == row["ibd"]


def test_every_earlier_session_is_restated_too(tmp_db, monkeypatch):
    series = _names(60)
    names = _store_as_the_pod_holds_it(tmp_db, monkeypatch, series)
    assert _row(tmp_db, "RECY", "2026-11-03")["ibd"] == 99
    assert _run(series, names)["ok"]
    for s in ("2026-11-03", "2026-11-04", "2026-11-05"):
        assert _row(tmp_db, "RECY", s)["bars"] < rh.READ_BARS, s
        assert _row(tmp_db, "RECY", s)["m12"] is None, s


def test_a_dry_run_changes_nothing_and_still_names_the_stock(tmp_db, monkeypatch):
    series = _names(60)
    names = _store_as_the_pod_holds_it(tmp_db, monkeypatch, series)
    before = _query(tmp_db, f"SELECT * FROM {rh.TABLE} ORDER BY session, ticker")
    r = _run(series, names, dry_run=True)
    assert r["ok"] is True and r["dry_run"] is True
    assert r["note"]["changed_newest"]["examples"][0]["ticker"] == "RECY"
    assert _query(tmp_db, f"SELECT * FROM {rh.TABLE} ORDER BY session, ticker") == before
    tables = {x["name"] for x in _query(tmp_db, "SELECT name FROM sqlite_master WHERE type = 'table'")}
    assert rh.LISTING_TABLE not in tables, "a dry run creates no marker table"


def test_the_universe_marker_does_not_hide_these_sessions_and_its_own_marker_does(tmp_db, monkeypatch):
    series = _names(60)
    names = _store_as_the_pod_holds_it(tmp_db, monkeypatch, series)
    assert len(_query(tmp_db, f"SELECT session FROM {rh.UNIVERSE_TABLE}")) == 3, "already universe-restated"
    first = _run(series, names, max_sessions=1)
    assert first["note"]["sessions_todo"] == 1 and first["note"]["sessions_done"] == 1
    assert _run(series, names)["note"]["sessions_done"] == 2, "resumes where it stopped"
    done = _run(series, names)
    assert done["ok"] and done["note"]["reason"] == "nothing_to_do"
    marks = _query(tmp_db, f"SELECT session, method FROM {rh.LISTING_TABLE} ORDER BY session")
    assert [m["method"] for m in marks] == [rh.LISTING_METHOD] * 3


def test_other_names_move_by_at_most_a_point(tmp_db, monkeypatch):
    series = _names(60)
    names = _store_as_the_pod_holds_it(tmp_db, monkeypatch, series)
    before = {t: _row(tmp_db, t)["ibd"] for t in names if t != "RECY"}
    assert _run(series, names)["ok"]
    after = {t: _row(tmp_db, t)["ibd"] for t in before}
    assert max(abs(after[t] - before[t]) for t in before) <= 2, "one name left the top of a 61-name ladder"


def test_the_command_line(monkeypatch, capsys):
    seen = {}

    def fake(days, **kw):
        seen.update(days=days, **kw)
        return {"ok": True, "dry_run": kw["dry_run"], "duration_ms": 1.0,
                "note": {"method": rh.LISTING_METHOD, "sessions": 260, "sessions_stored": 254,
                         "sessions_restated_before": 0, "sessions_todo": 254, "sessions_done": 254,
                         "rows_written": 3000000, "rows_inserted": 0, "rows_updated": 3000000,
                         "rows_nulled": 3, "ranked": {"min": 5800, "median": 6400, "max": 6600},
                         "shift": {"mean": -0.1, "big_share": 0.004, "up_share": 0.01},
                         "split_basis": {"declared": 12000, "unknown": 0},
                         "changed_newest": {"session": "2026-11-12", "over": 41,
                                            "examples": [{"ticker": "BNY", "was": 99, "now": 61}]}}}
    monkeypatch.setattr(rh, "restate_universe", fake)
    assert rh.main(["--backfill-days", "260", "--restate-listing-breaks", "--dry-run"]) == 0
    assert seen["marker"] == LISTING and seen["dry_run"] is True and seen["days"] == 260
    out = capsys.readouterr().out
    assert "restate-listing-breaks (dry run)" in out and "would_write=254" in out
    assert "changed_over15=41" in out and "BNY 99->61" in out
    assert json.loads(out.strip().splitlines()[-1].split("receipt ", 1)[1])["ok"] is True
    assert rh.main(["--backfill-days", "260", "--restate-listing-breaks", "--restate-universe"]) == 2
    assert rh.main(["--backfill-days", "260", "--restate-listing-breaks", "--restate-ranks"]) == 2


def test_the_universe_restate_command_is_unchanged(monkeypatch):
    seen = {}

    def fake(days, **kw):
        seen.update(kw)
        return {"ok": True, "dry_run": kw["dry_run"], "duration_ms": 1.0, "note": {}}
    monkeypatch.setattr(rh, "restate_universe", fake)
    assert rh.main(["--backfill-days", "260", "--restate-universe"]) == 0
    assert "marker" not in seen, "the older restate keeps its own marker by default"
