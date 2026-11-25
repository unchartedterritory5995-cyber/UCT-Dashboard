"""The Terminal's UNVOL panel (unusual volume) against the real scan builder.

UNVOL adds no route: it POSTs a fixed spec to ``POST /api/screener/scan`` and reads the
Screener's own volume readings. The panel's bodies live in
``tests/fixtures/terminal_unvol_scan_requests.json``; the panel's own suite
(``app/src/pages/terminal/panels/unusualVolumeModel.test.js``) holds the panel to that file,
and this module runs every body in it through ``query.run_scan`` on a temp database.

Why each rail exists:
  * a body the server refuses (an unknown filter key, an op a key does not take, a column the
    snapshot does not declare) would be a panel that can only ever show an error;
  * "by now" must read the LIVE overlay's ``rvol_live`` and nothing else: with the overlay
    off that scan returns NOTHING, which is the panel's signal to say "no by-now reading" and
    show the last full session. If it ever fell back to last night's number under a "now"
    label the panel would call yesterday's volume today's;
  * the last-session reading is ``vol_ratio`` (a whole session over the 30 before it);
  * the floors keep funds, cheap stocks and thin stocks off the list in both readings;
  * the rows carry what the panel dates the reading by (``live_row``, ``live_asof``).

⛔ Every fixture is built in a tmp database. Nothing reads the real data directory.
"""
from __future__ import annotations

import json
import pathlib
import time

import pytest

from api.services.screener import live_tier, query, snapshot_db

FIXTURE = pathlib.Path(__file__).parent / "fixtures" / "terminal_unvol_scan_requests.json"
REQUESTS = {r["name"]: r for r in json.loads(FIXTURE.read_text(encoding="utf-8"))["requests"]}

_ANCHOR_YMD = "20261117"          # the last completed session the nightly rows were built from
_LIVE_YMD = 20261118              # the session the overlay describes (strictly newer, so it is served)


def _row(ticker, *, vol_ratio, chg, price=40.0, dollar_vol=50_000_000, kind="Stock"):
    return dict(ticker=ticker, company=f"{ticker} Corp", price=price, chg_pct_1d=chg, vol_ratio=vol_ratio,
                avg_volume_30d=1_500_000, dollar_vol_30d=dollar_vol, security_type=kind, industry="Software",
                uct_composite=50, bars_asof=_ANCHOR_YMD, snapshot_date="2026-11-18", built_at=1)


#: Last session: HEAVY 6.2x down, BUSY 3.4x up, CALM 1.1x. Three names fail a floor each.
_NIGHTLY = [
    _row("HEAVY", vol_ratio=6.2, chg=-4.0),
    _row("BUSY", vol_ratio=3.4, chg=2.5),
    _row("CALM", vol_ratio=1.1, chg=0.3),
    _row("FUND", vol_ratio=9.0, chg=1.0, kind="ETF"),
    _row("CHEAP", vol_ratio=9.0, chg=1.0, price=3.0),
    _row("THIN", vol_ratio=9.0, chg=1.0, dollar_vol=2_000_000),
]


def _overlay_row(ticker, **values):
    row = {c: None for c in live_tier.LIVE_COLUMNS}
    row.update(values)
    row.update({"ticker": ticker, "live_session_ymd": _LIVE_YMD, "live_asof": float(time.time()),
                "anchor_bars_asof": _ANCHOR_YMD, "src_price": float(values.get("price") or 1.0),
                "anchor_price": 1.0, "live_cols": len(values)})
    return row


#: Today, by now: CALM is the heavy one (5.5x, up), BUSY 2.4x down, HEAVY quiet (0.7x). The
#: order and the membership are DIFFERENT from last session's, so a scan reading the wrong
#: column cannot pass either test by accident. The three floor-failers are loud today too.
_LIVE = [
    _overlay_row("CALM", price=42.0, chg_pct_1d=5.0, rvol_live=5.5),
    _overlay_row("BUSY", price=39.0, chg_pct_1d=-2.5, rvol_live=2.4),
    _overlay_row("HEAVY", price=40.1, chg_pct_1d=0.2, rvol_live=0.7),
    _overlay_row("FUND", price=40.0, chg_pct_1d=1.0, rvol_live=8.0),
    _overlay_row("CHEAP", price=3.1, chg_pct_1d=3.0, rvol_live=8.0),
    _overlay_row("THIN", price=40.0, chg_pct_1d=1.0, rvol_live=8.0),
]


@pytest.fixture
def served(tmp_path, monkeypatch):
    """A screener.db with last night's rows, an armed live tier in the regular session, and
    this session's overlay rows."""
    monkeypatch.setenv("SCREENER_DB_PATH", str(tmp_path / "unvol.db"))
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "1")
    monkeypatch.setattr(live_tier, "_session", lambda: "regular")
    snapshot_db.init_db()
    snapshot_db.upsert_rows(_NIGHTLY)
    # ⛔ STAMPED NOW, NOT AT IMPORT. `_LIVE` is built when this module is collected, and in the
    # regular session the tier serves an overlay only while it is younger than `max_age_s()`
    # (180 s, the dead-sweeper contract). A suite that reached this file more than three minutes
    # after collection had every overlay row aged out, and each by-now scan came back empty
    # (red on master 2026-11-23, run 45321831045) -- the tier was right, the fixture was stale.
    snapshot_db.upsert_live_rows([{**row, "live_asof": float(time.time())} for row in _LIVE])
    return snapshot_db


def _run(name):
    return query.run_scan(dict(REQUESTS[name]["body"]))


def _tickers(name):
    return [r["ticker"] for r in _run(name)["rows"]]


def test_the_fixture_holds_both_readings_and_the_probe():
    assert {r["mode"] for r in REQUESTS.values()} == {"now", "last"}
    assert REQUESTS["now_probe"]["body"]["page_size"] == 1
    assert len(REQUESTS) >= 6


@pytest.mark.parametrize("name", sorted(REQUESTS))
def test_every_body_the_panel_sends_is_accepted_live_and_nightly(served, monkeypatch, name):
    out = _run(name)                                   # a refusal raises ValueError (a 400 to the panel)
    assert isinstance(out["rows"], list) and isinstance(out["total"], int)
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    out = _run(name)
    assert isinstance(out["rows"], list) and isinstance(out["total"], int)


def test_by_now_reads_the_live_reading_highest_first_and_dates_it(served):
    out = _run("now_base")
    assert [r["ticker"] for r in out["rows"]] == ["CALM", "BUSY"]          # HEAVY is quiet today (0.7x)
    assert [r["rvol_live"] for r in out["rows"]] == [5.5, 2.4]
    assert out["total"] == 2
    for r in out["rows"]:
        assert r["live_row"] == 1 and r["live_asof"] > 0                   # what the panel dates the reading by
        assert r["avg_volume_30d"] == 1_500_000 and r["bars_asof"] == _ANCHOR_YMD
    assert out["rows"][0]["chg_pct_1d"] == 5.0                             # the day change is today's too


def test_the_floors_keep_funds_cheap_and_thin_names_off_both_readings(served):
    for name in ("now_base", "last_base"):
        got = set(_tickers(name))
        assert not got & {"FUND", "CHEAP", "THIN"}, name
    # CONTROL: each of the three really is loud enough to be listed without its floor
    for drop, back in (("security_type", "FUND"), ("price", "CHEAP"), ("dollar_vol_30d", "THIN")):
        body = dict(REQUESTS["now_base"]["body"])
        body["filters"] = [f for f in body["filters"] if f["key"] != drop]
        assert back in [r["ticker"] for r in query.run_scan(body)["rows"]], drop


def test_the_direction_and_the_multiple_are_rules_on_the_server(served):
    assert _tickers("now_up_3") == ["CALM"]                                # 5.5x and up; BUSY is down
    assert _tickers("now_down_5") == []                                    # nothing is down on 5x: "nothing matches"
    assert _tickers("now_probe") == ["CALM"]                               # ...while the one-row probe finds a reading
    # With the overlay serving, the last-session scan filters LAST SESSION'S volume by TODAY'S day
    # change (HEAVY 6.2x is up 0.2% today, BUSY 3.4x is down 2.5% today). The panel says so in words
    # ("The prices and day changes below are today's; the volume is that session's"); with the
    # overlay off both are that session's (the last test in this file).
    assert _tickers("last_down_3") == ["BUSY"]


def test_with_no_live_reading_the_by_now_scan_returns_NOTHING_never_last_nights_number(served, monkeypatch):
    """The panel's whole "no by-now reading" branch rests on this: off the overlay the column is
    NULL for every row, so the scan is empty and the panel says so and shows the last session."""
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    for name in ("now_base", "now_up_3", "now_down_5", "now_probe"):
        assert _run(name)["rows"] == [], name
        assert _run(name)["total"] == 0, name


def test_last_session_reads_vol_ratio_highest_first(served, monkeypatch):
    monkeypatch.setenv("SCREENER_LIVE_TIER_ENABLED", "0")
    out = _run("last_base")
    assert [r["ticker"] for r in out["rows"]] == ["HEAVY", "BUSY"]         # CALM was 1.1x last session
    assert [r["vol_ratio"] for r in out["rows"]] == [6.2, 3.4]
    assert all(r.get("rvol_live") is None for r in out["rows"])            # no by-now number rides along
    assert all(not r.get("live_row") for r in out["rows"])
    assert out["rows"][0]["bars_asof"] == _ANCHOR_YMD                      # the session the panel names
    assert _tickers("last_down_3") == ["HEAVY"]                            # down 4.0% that session, 6.2x
