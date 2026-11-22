"""P0 rail: the server's intraday bucket grid == the checked-in parity fixture, and
the fixture obeys the bucket contract in GENERAL form.

The client half of this rail is ``app/src/components/chart/rails/bucketGridParity.test.js``
— it reads the SAME fixture and asserts ``chart/barTime`` + ``chart/liveBuckets`` draw
identical buckets. Between the two, the server and the client cannot disagree about a
single bucket of 2026 (incl. the Mar 8 / Nov 1 DST changes and the NYSE half-days)
without one of them going red.

Fixture: ``tests/fixtures/bar_bucket_grid_2026.json`` (generator:
``tests/fixtures/_gen_bucket_grid.py`` — read its header before regenerating).
"""

from __future__ import annotations

import json
import os
from datetime import date, datetime

import pytest

from tests.fixtures import _gen_bucket_grid as gen

FIXTURE = json.loads(open(gen.FIXTURE_PATH, encoding="utf-8").read())
DAYS = FIXTURE["days"]
W0, W1 = FIXTURE["window_min"]
RTH_OPEN = 9 * 60 + 30


def _expand(runs):
    out = []
    for s, ln, n in runs:
        for i in range(n):
            out.append((s + i * ln, s + (i + 1) * ln))
    return out


def test_fixture_covers_the_whole_year_and_every_grid():
    assert FIXTURE["year"] == 2026
    assert len(DAYS) == 365
    assert [d["date"] for d in DAYS] == sorted(d["date"] for d in DAYS)
    for d in DAYS:
        assert set(d["grids"]) == {f"{tf}/{s}" for tf in FIXTURE["tfs"] for s in FIXTURE["sessions"]}


def test_server_still_draws_exactly_the_fixture_grid():
    """Drift detector: tv_bucket_bounds, probed at every bucket boundary of every day,
    reproduces the committed fixture byte for byte."""
    assert gen.build()["days"] == DAYS


@pytest.mark.parametrize("probe", ["start", "mid", "last"])
def test_every_minute_inside_a_bucket_maps_to_that_bucket(probe):
    """Not only the boundaries: a probe at the start / middle / last minute of each
    bucket returns that bucket's bounds (the generator walks by jumping to `end`)."""
    from api.services.bar_rollup import tv_bucket_bounds
    bad = []
    for d in DAYS[::7] + [x for x in DAYS if x["half_day"] or x["date"] in ("2026-03-09", "2026-11-02")]:
        base = d["base"]
        for key, runs in d["grids"].items():
            tf, sess = key.split("/")
            for s, e in _expand(runs):
                m = {"start": s, "mid": (s + e) // 2, "last": e - 1}[probe]
                ms = (base + (m - W0) * 60) * 1000
                got = tv_bucket_bounds(ms + 17_000, tf, sess)   # +17s: sub-minute stays in bucket
                want = ((base + (s - W0) * 60) * 1000, (base + (e - W0) * 60) * 1000)
                if got != want:
                    bad.append((d["date"], key, s, e, probe))
    assert bad == []


def test_grid_contract_general_form():
    """The bucket contract, stated independently of the generator:
    contiguous + gapless over 04:00-20:00; 1/5/15/30 are fixed-period buckets on the
    period grid; 60m `eth` = clock hours; 60m `rth` never spans the 09:30 open or the
    regular close (16:00, 13:00 on a half-day) and is 60 long inside RTH except the
    final half bar (TradingView ruling: 9:30, 10:30 ... 15:30 half bar)."""
    for d in DAYS:
        close = 13 * 60 if d["half_day"] else 16 * 60
        for key, runs in d["grids"].items():
            tf, sess = key.split("/")
            b = _expand(runs)
            assert b[0][0] == W0 and b[-1][1] == W1, (d["date"], key)
            assert all(b[i][1] == b[i + 1][0] for i in range(len(b) - 1)), (d["date"], key, "gap/overlap")
            if tf != "60":
                p = int(tf)
                assert all(e - s == p and s % p == 0 for s, e in b), (d["date"], key)
                continue
            if sess == "eth":
                assert all(e - s == 60 and s % 60 == 0 for s, e in b), (d["date"], key)
                continue
            for s, e in b:
                assert not (s < RTH_OPEN < e), (d["date"], "spans the open", s, e)
                assert not (s < close < e), (d["date"], "spans the close", s, e)
                if RTH_OPEN <= s < close:
                    assert (s - RTH_OPEN) % 60 == 0, (d["date"], "off the 09:30 anchor", s)
                    assert e - s == 60 or e == close, (d["date"], s, e)
            rth = [x for x in b if RTH_OPEN <= x[0] < close]
            assert rth[-1] == (close - 30, close), (d["date"], "last RTH bar must be the half bar")


def test_et_offset_follows_2026_dst():
    """base = 04:00 ET; offset -240 (EDT) from Mar 8 through Oct 31, else -300 (EST)."""
    from zoneinfo import ZoneInfo
    et = ZoneInfo("America/New_York")
    for d in DAYS:
        y, m, dd = map(int, d["date"].split("-"))
        edt = date(2026, 3, 8) <= date(y, m, dd) < date(2026, 11, 1)
        assert d["utc_offset_min"] == (-240 if edt else -300), d["date"]
        assert datetime.fromtimestamp(d["base"], tz=et).strftime("%Y-%m-%d %H:%M") == f"{d['date']} 04:00"


def test_half_days_are_the_nyse_calendar_rows():
    from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
    want = sorted(f"{x // 10000:04d}-{x // 100 % 100:02d}-{x % 100:02d}"
                  for x in NYSE_EARLY_CLOSES_YYYYMMDD if x // 10000 == 2026)
    assert [d["date"] for d in DAYS if d["half_day"]] == want
    assert want, "2026 must carry at least one NYSE half-day or the rail proves nothing about them"


def test_fixture_file_is_the_generator_serialisation():
    """The committed bytes are exactly what the generator writes (no hand edits)."""
    with open(gen.FIXTURE_PATH, encoding="utf-8", newline="") as fh:
        on_disk = fh.read().replace("\r\n", "\n")
    assert on_disk == gen.dumps(FIXTURE)


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(pytest.main([os.path.abspath(__file__), "-q"]))
