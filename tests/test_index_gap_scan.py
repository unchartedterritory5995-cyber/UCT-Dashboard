"""tools/index_gap_scan.py -- the standing check for cash-index intraday holes.

Synthetic series only (no network: the reads go through an injected fetcher). Railed:
  G1 an expected-but-absent slot of a settled session is reported;
  G2 a slot the answer already names in `holes` is not re-reported;
  G3 a 13:00 half-day is not flagged for the buckets it does not have (13:30 .. 15:30), and a holiday
     is not a hole;
  G4 depth (before the first row) and an unsettled session are not holes;
  G5 the exit codes: 0 clean, 1 an unnamed hole (listed), 2 a series that could not be checked.
"""
import datetime as dt
from zoneinfo import ZoneInfo

from api.services import intraday_gap_audit as gap
from tools import index_gap_scan as scan

ET = ZoneInfo("America/New_York")
NOW = dt.datetime(2026, 11, 18, 12, 0, tzinfo=ET).timestamp()
JAN30, FEB2 = dt.date(2026, 1, 30), dt.date(2026, 2, 2)
NOV26, NOV27, NOV28, DEC1 = (dt.date(2025, 11, 26), dt.date(2025, 11, 27),
                             dt.date(2025, 11, 28), dt.date(2025, 12, 1))


def _et(d, hm):
    h, m = (int(x) for x in hm.split(":"))
    return int(dt.datetime(d.year, d.month, d.day, h, m, tzinfo=ET).timestamp())


def _hm(t):
    return dt.datetime.fromtimestamp(t, ET).strftime("%H:%M")


def _session(d, tf="60", skip=()):
    return [{"t": t, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 0}
            for t in gap.expected_rth_buckets(tf, d) if _hm(t) not in skip]


def test_an_absent_slot_of_a_settled_session_is_reported():
    bars = _session(JAN30) + _session(FEB2, skip=("09:30", "10:30"))
    res = scan.scan_series(bars, "60", now=NOW)
    assert res["unnamed"] == [_et(FEB2, "09:30"), _et(FEB2, "10:30")]
    assert res["expected"] == 14 and res["off_grid"] == 0


def test_a_hole_the_answer_already_names_is_not_reported_again():
    bars = _session(JAN30) + _session(FEB2, skip=("09:30", "10:30"))
    res = scan.scan_series(bars, "60", named=[_et(FEB2, "10:30")], now=NOW)
    assert res["unnamed"] == [_et(FEB2, "09:30")] and res["named"] == 1


def test_a_half_day_and_a_holiday_are_not_flagged():
    bars = _session(NOV26) + _session(NOV28) + _session(DEC1)          # 11-28: 09:30 .. 12:30 only
    assert sorted(_hm(b["t"]) for b in _session(NOV28)) == ["09:30", "10:30", "11:30", "12:30"]
    res = scan.scan_series(bars, "60", now=NOW)
    assert res["unnamed"] == [] and res["expected"] == 7 + 4 + 7
    half = scan.scan_series(_session(NOV26) + _session(NOV28, skip=("12:30",)) + _session(DEC1), "60", now=NOW)
    assert half["unnamed"] == [_et(NOV28, "12:30")]                     # its own last bucket IS expected


def test_depth_and_an_unsettled_session_are_not_holes():
    bars = _session(FEB2, skip=("09:30",))                              # the first row is 10:30
    assert scan.scan_series(bars, "60", now=NOW)["unnamed"] == []
    in_session = _et(FEB2, "13:00")
    bars = _session(JAN30) + [b for b in _session(FEB2) if b["t"] < _et(FEB2, "11:30")]
    assert scan.scan_series(bars, "60", now=in_session)["unnamed"] == []


def test_the_thirty_minute_grid_is_the_authoritys():
    bars = _session(JAN30, tf="30") + _session(FEB2, tf="30", skip=("10:00",))
    assert scan.scan_series(bars, "30", now=NOW)["unnamed"] == [_et(FEB2, "10:00")]


def test_the_exit_codes_and_the_report():
    answers = {("SPX", "60"): {"bars": _session(JAN30) + _session(FEB2, skip=("09:30",)), "holes": []},
               ("NDX", "60"): {"bars": _session(JAN30) + _session(FEB2, skip=("09:30",)),
                               "holes": [_et(FEB2, "09:30")]}}

    def fetcher(base, sym, tf):
        if (sym, tf) not in answers:
            raise OSError("HTTP 502 (stub)")
        return answers[(sym, tf)]

    code, lines = scan.run("https://example.invalid", ["SPX", "NDX"], ["60"], now=NOW, fetcher=fetcher)
    assert code == 1
    assert lines[0] == "index gap scan: 1 unnamed hole(s), 0 series not checked [SPX 60 1, NDX 60 0]"
    assert lines[1:] == [f"SPX 60 2026-02-02 09:30 ET ({_et(FEB2, '09:30')})"]

    answers[("SPX", "60")]["holes"] = [_et(FEB2, "09:30")]
    assert scan.run("x", ["SPX", "NDX"], ["60"], now=NOW, fetcher=fetcher)[0] == 0

    code, lines = scan.run("x", ["SPX", "RUT"], ["60"], now=NOW, fetcher=fetcher)
    assert code == 2 and lines[-1].startswith("NOT CHECKED RUT 60: OSError")
