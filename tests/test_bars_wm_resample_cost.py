"""W/M serve cost (capacity-500, 2026-11-28). A cold W or M serve resamples the whole served daily history
(`bars_sanitize._built_periods` -> `bars_fetch._resample_*_iso`, ~8k rows) and `datetime.strptime` was ~40% of its
170-300 ms of GIL time; the all-timeframe dwell warm asks W and M for every symbol a member rests on. The resamplers
now parse the canonical `YYYY-MM-DD` key directly (`_iso_day_dt`), and must agree with strptime on every input."""
from datetime import datetime

import pytest

from api.services import bars_fetch as bf

CASES = ["2026-11-20", "2024-02-29", "1999-12-31", "0001-01-01", "9999-12-31",
         "2023-02-29", "2026-13-01", "2026-00-10", "2026-11-31", "2026-1-05", "2026-01-5", " 026-11-20",
         "+026-11-20", "2026-11-2x", "２０２６-11-20", "2026/11/20", "2026-11-20T00:00", "", "20261120",
         None, 20261120, b"2026-11-20"]


def _outcome(fn, t):
    try:
        return ("ok", fn(t))
    except Exception as e:  # noqa: BLE001
        return ("raise", type(e))


@pytest.mark.parametrize("t", CASES)
def test_the_fast_day_parse_is_strptime_for_every_input(t):
    assert _outcome(bf._iso_day_dt, t) == _outcome(lambda x: datetime.strptime(x, "%Y-%m-%d"), t)


def _daily(n=400):
    out, d = [], datetime(2024, 1, 2)
    from datetime import timedelta
    while len(out) < n:
        if d.weekday() < 5:
            out.append({"t": d.strftime("%Y-%m-%d"), "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 10})
        d += timedelta(days=1)
    return out


def test_the_resamplers_do_not_strptime_canonical_rows(monkeypatch):
    calls = []

    class Counting(datetime):
        @classmethod
        def strptime(cls, *a, **k):
            calls.append(a)
            return datetime.strptime(*a, **k)
    rows = _daily()
    want_w = bf._resample_weekly_iso(rows, sessions_only=False)
    want_m = bf._resample_monthly_iso(rows, sessions_only=False)
    assert len(want_w) > 50 and len(want_m) > 10                    # not vacuous
    monkeypatch.setattr(bf, "datetime", Counting)
    assert bf._resample_weekly_iso(rows, sessions_only=False) == want_w
    assert bf._resample_monthly_iso(rows, sessions_only=False) == want_m
    assert calls == []
