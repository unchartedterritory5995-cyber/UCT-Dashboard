"""The resident copy of breadth_reconstructed_daily. Session 11, Workstream D.

⛔ THE LOAD-BEARING TEST IS THE STALE READ. A cache whose invalidation is removed still
returns correct-looking rows — the old ones — and every other test here would stay green.
`test_a_write_to_the_table_is_seen_by_the_next_read` is the one that goes red, and it is
mutation-proved by deleting the invalidation.

⛔ AND THE OFF STATE IS ASSERTED BY THE ABSENCE OF THE OBJECT, not by a timing. A flag
that builds the resident copy and then declines to use it would pass a behavioural test
and still pay the memory.
"""
from __future__ import annotations

import json
import sqlite3

import pytest

from api.services import breadth_daily_ohlc as ohlc


@pytest.fixture
def db(tmp_path, monkeypatch):
    p = tmp_path / "ohlc.db"
    monkeypatch.setenv("BREADTH_OHLC_DB", str(p))
    ohlc._INIT_DONE = False
    ohlc._ensure_init()
    # ⛔ the resident copy is module state and MUST be reset between tests, or one
    # test's rows answer another test's assertions
    ohlc._RESIDENT.update({"rows": None, "built_ms": None, "data_version": None})
    ohlc._PROBE.update({"conn": None, "path": None})
    return str(p)


def _dates(n):
    """⛔ REAL calendar dates. A first version wrote f"2026-03-{i+1:02d}" and produced
    "2026-03-100" past day 99 — which sorts before "2026-03-11" and failed the ORDER
    assertion. The defect was in the fixture, and it looked exactly like an ordering bug
    in the code under test."""
    import datetime
    d0 = datetime.date(2026, 3, 1)
    return [(d0 + datetime.timedelta(days=i)).isoformat() for i in range(n)]


def _seed(db_path, n=60, tag="a"):
    ds = _dates(n)
    with sqlite3.connect(db_path) as w:
        for i, d in enumerate(ds):
            w.execute("INSERT OR REPLACE INTO breadth_reconstructed_daily"
                      "(date, metrics, ohlc_watermark, sentiment_watermark) VALUES (?,?,?,?)",
                      (d, json.dumps({"v": i, "tag": tag}),
                       "2026-03-01 00:00:00", "2026-03-01 00:00:00"))
        w.commit()
    return ds


def test_with_the_flag_off_no_resident_object_is_ever_built(db, monkeypatch):
    """⛔ Absence of the OBJECT, not absence of a speedup. A flag that builds the copy
    and then declines to use it pays the memory for nothing and would pass a timing
    test."""
    monkeypatch.delenv("BREADTH_RESIDENT_RECON_ENABLED", raising=False)
    dates = _seed(db)
    got, miss = ohlc.reconstructed_for_dates(dates)
    assert len(got) == len(dates) and miss == 0
    assert ohlc._RESIDENT["rows"] is None, "a resident copy exists with the flag OFF"
    assert ohlc._resident_rows() is None


def test_with_the_flag_on_the_copy_is_built_once_and_reused(db, monkeypatch):
    monkeypatch.setenv("BREADTH_RESIDENT_RECON_ENABLED", "1")
    dates = _seed(db)
    ohlc.reconstructed_for_dates(dates)
    assert ohlc._RESIDENT["rows"] is not None
    first = id(ohlc._RESIDENT["rows"])
    built = ohlc._RESIDENT["built_ms"]
    ohlc.reconstructed_for_dates(dates)
    assert id(ohlc._RESIDENT["rows"]) == first, "rebuilt when nothing changed"
    assert ohlc._RESIDENT["built_ms"] == built


def test_a_write_to_the_table_is_seen_by_the_next_read(db, monkeypatch):
    """⛔⛔ THE STALE-READ CONTROL. Remove the invalidation and this is the only test
    that fails — every other one keeps passing against a cache serving last week's rows.
    """
    monkeypatch.setenv("BREADTH_RESIDENT_RECON_ENABLED", "1")
    dates = _seed(db, tag="before")
    got, _ = ohlc.reconstructed_for_dates(dates)
    assert got[dates[0]]["tag"] == "before"

    _seed(db, tag="after")                      # the real writer shape: INSERT OR REPLACE
    got2, _ = ohlc.reconstructed_for_dates(dates)
    assert got2[dates[0]]["tag"] == "after", (
        "the resident copy served a STALE row after the table changed")


def test_a_row_added_after_the_build_is_visible(db, monkeypatch):
    """A pure append — no existing row changes, so only COUNT(*) moves in the signature."""
    monkeypatch.setenv("BREADTH_RESIDENT_RECON_ENABLED", "1")
    dates = _seed(db)
    ohlc.reconstructed_for_dates(dates)
    with sqlite3.connect(db) as w:
        w.execute("INSERT INTO breadth_reconstructed_daily(date, metrics) VALUES (?,?)",
                  ("2027-01-01", json.dumps({"v": 999})))
        w.commit()
    got, _ = ohlc.reconstructed_for_dates(dates + ["2027-01-01"])
    assert got["2027-01-01"]["v"] == 999


def test_a_purge_is_visible(db, monkeypatch):
    """⛔ A DELETE lowers COUNT(*) while MAX(built_at) does not move — which is why the
    signature carries the count and not only the timestamps."""
    monkeypatch.setenv("BREADTH_RESIDENT_RECON_ENABLED", "1")
    dates = _seed(db)
    ohlc.reconstructed_for_dates(dates)
    with sqlite3.connect(db) as w:
        w.execute("DELETE FROM breadth_reconstructed_daily WHERE date = ?", (dates[0],))
        w.commit()
    got, miss = ohlc.reconstructed_for_dates(dates)
    assert dates[0] not in got and miss == 1


def test_the_ON_path_returns_exactly_what_the_OFF_path_returns(db, monkeypatch):
    """⛔ THE ONLY THING THAT MUST NEVER DIFFER: same rows, same ORDER, same values —
    across three spans, mirroring the 90/365/8000 production parity."""
    dates = _seed(db, n=120)
    for span in (10, 45, 120):
        ds = dates[:span]
        monkeypatch.delenv("BREADTH_RESIDENT_RECON_ENABLED", raising=False)
        ohlc._RESIDENT.update({"rows": None, "data_version": None})
        off, off_miss = ohlc.reconstructed_for_dates(ds)
        monkeypatch.setenv("BREADTH_RESIDENT_RECON_ENABLED", "1")
        on, on_miss = ohlc.reconstructed_for_dates(ds)
        assert off_miss == on_miss, span
        assert len(off) == span, f"vacuous at span {span}: {len(off)} rows"
        assert off == on, f"values differ at span {span}"
        assert list(off.keys()) == list(on.keys()), f"ORDER differs at span {span}"


def test_the_instrument_reports_which_path_served_the_request(db, monkeypatch):
    """The sampler pools on flag state, and it reads that state off the REQUEST. If the
    stamp is missing or wrong, samples from two different readers pool together."""
    from api.services import breadth_timing as bt
    dates = _seed(db)
    for val, want in (("", 0), ("1", 1)):
        monkeypatch.setenv("BREADTH_RESIDENT_RECON_ENABLED", val)
        ohlc._RESIDENT.update({"rows": None, "data_version": None})
        bt._ctx.set(None)
        bt.begin(span=len(dates))
        ohlc.reconstructed_for_dates(dates)
        rec = bt.get() or {}
        assert rec.get("rf_resident") == want, (val, rec.get("rf_resident"))


def test_anything_that_is_not_an_affirmative_leaves_it_off(db, monkeypatch):
    for val in ("", "0", "false", "off", "no", "maybe"):
        monkeypatch.setenv("BREADTH_RESIDENT_RECON_ENABLED", val)
        assert ohlc._resident_rows() is None, val


def test_the_resident_form_holds_json_strings_not_parsed_rows(db, monkeypatch):
    """⛔ A MEASURED TRADE, PINNED SO IT CANNOT DRIFT SILENTLY. Parsed rows cost
    22,909,972 B = 5.06x the wire bytes, against 5,214,625 B = 1.15x for strings, and
    the standing bound is 2x. If someone 'optimises' this to hold parsed rows, the
    memory bound breaks without any test noticing — unless this one exists."""
    monkeypatch.setenv("BREADTH_RESIDENT_RECON_ENABLED", "1")
    dates = _seed(db)
    ohlc.reconstructed_for_dates(dates)
    rows = ohlc._RESIDENT["rows"]
    assert rows, "no resident rows"
    sample = next(iter(rows.values()))
    assert isinstance(sample, str), f"resident rows hold {type(sample).__name__}, not str"


def test_the_flag_is_a_gate_the_ledger_can_hold_and_does(db):
    import json as _j
    import pathlib
    from api.services import feature_flag_index as ffi
    name = "BREADTH_RESIDENT_RECON_ENABLED"
    assert ffi.is_gate(name), "the flag would be invisible to the ledger"
    repo = pathlib.Path(__file__).resolve().parents[1]
    led = _j.loads((repo / "docs" / "feature_flags.json").read_text(encoding="utf-8"))
    row = led["flags"].get(name)
    assert row is not None, f"{name} has no ledger row"
    assert row["status"] == "dark", row["status"]
    assert row["where"] == [], f"shipped dark: set on no service, got {row['where']}"
    assert len(row["note"]) > 150, "a dark row must say why it is dark"
