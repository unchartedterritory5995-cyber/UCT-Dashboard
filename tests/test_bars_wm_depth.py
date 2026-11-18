"""bars_sanitize step 4: a W/M series is never shallower than the daily series (2026-11-18).

Measured on production: weekly META started 2022-06-10 (the FB->META rename) while daily META started at
the 2012 IPO; XYZ weekly 2025 vs daily 2015; WBD, TFC, ELV monthly the same. The W/M rows carried a gap at
the rename and the reuse cutoff cut every week before it."""
import datetime as dt

import pytest

from api.services import bars_fetch as BF
from api.services import bars_sanitize as S

pytestmark = pytest.mark.skipif(not S._ENABLED, reason="sanitizer disabled")


def daily(start, end, *, base=100.0, skip=()):
    out, d, i = [], dt.date.fromisoformat(start), 0
    while d <= dt.date.fromisoformat(end):
        if d.weekday() < 5 and not any(a <= d.isoformat() <= b for a, b in skip):
            c = round(base + i * 0.05, 2)
            out.append({"t": d.isoformat(), "o": c, "h": c + 1, "l": c - 1, "c": c, "v": 1000})
            i += 1
        d += dt.timedelta(days=1)
    return out


def stored(tf, rows):
    return (BF._resample_weekly_iso if tf == "W" else BF._resample_monthly_iso)(rows, ticker="XYZ")


@pytest.fixture
def store(monkeypatch):
    """XYZ: a daily store from 2019, W/M stores that start at the 2022-06-09 (Thursday) rename."""
    st = {"D": daily("2019-01-02", "2022-12-30")}
    renamed = [b for b in st["D"] if b["t"] >= "2022-06-09"]
    st["W"], st["M"] = stored("W", renamed), stored("M", renamed)
    firsts = {}
    S._BUILT_CACHE.clear()
    monkeypatch.setattr(S, "_meta_cached", lambda t: None)
    monkeypatch.setattr(S, "_identity_source", lambda s, tf: list(st[tf]) if s == "XYZ" else [])
    monkeypatch.setattr(S, "_store_first", lambda s, tf: firsts.get(tf) or (
        dt.date.fromisoformat(st[tf][0]["t"]) if s == "XYZ" and st.get(tf) else None))
    return st, firsts


def test_weekly_reaches_back_as_far_as_the_daily_series(store):
    st, _ = store
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    full = stored("W", st["D"])
    assert out[0]["t"] == full[0]["t"] == "2019-01-04"
    assert out == full                     # every week, the rename week whole (not Thu+Fri only)
    assert st["W"][0]["v"] == 2000 and out[[b["t"] for b in out].index("2022-06-10")]["v"] == 5000


def test_monthly_too(store):
    st, _ = store
    out = S.sanitize_daily_bars("XYZ", st["M"], "M")
    assert out[0]["t"] == "2019-01-01" and out == stored("M", st["D"])


def test_a_slice_of_the_newest_rows_is_never_deepened(store):
    st, firsts = store
    firsts["W"] = dt.date(2020, 1, 3)       # the store reaches further back than these rows
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    assert out == st["W"]


def test_a_daily_series_on_another_basis_is_refused(store):
    st, _ = store
    st["D"] = [dict(b, c=b["c"] * 1.5) for b in st["D"]]
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    assert out == st["W"]


def test_a_hole_at_the_join_is_refused(store):
    st, _ = store
    st["D"] = daily("2019-01-02", "2022-12-30", skip=[("2022-03-01", "2022-06-08")])
    st["W"] = stored("W", [b for b in st["D"] if b["t"] >= "2022-06-09"])
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    assert out == st["W"]


def test_a_daily_series_that_never_meets_the_stored_bars_proves_nothing(store):
    st, _ = store
    st["D"] = [b for b in st["D"] if b["t"] < "2022-06-09"]   # ends at the rename: no week in common
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    assert out == st["W"]


def test_a_daily_series_no_deeper_changes_nothing(store):
    st, _ = store
    st["D"] = [b for b in st["D"] if b["t"] >= "2022-06-01"]
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    assert out == st["W"]


def test_a_failing_daily_read_serves_the_stored_bars(store, monkeypatch):
    st, _ = store

    def boom(s, tf):
        if tf == "D":
            raise RuntimeError("store busy")
        return []
    monkeypatch.setattr(S, "_identity_source", boom)
    assert S.sanitize_daily_bars("XYZ", st["W"], "W") == st["W"]


def test_daily_itself_is_untouched(store):
    st, _ = store
    tail = [b for b in st["D"] if b["t"] >= "2022-06-09"]
    out = S.sanitize_daily_bars("XYZ", tail, "D")
    assert out[0]["t"] == "2022-06-09"


def window_dropped(st, tf, lo="2021-06-30", hi="2022-01-31"):
    """The stored series with META's identity window gone (its source had no W/M rows): a hole. Seven
    months is past the reuse cutoff's 150 days, so step 1 cuts there and the older periods come back
    through the head; a shorter hole stays inside the series and is filled where it is."""
    full = stored(tf, st["D"])
    return full, [b for b in full if not (lo <= b["t"] <= hi)]


SHORT = ("2021-09-01", "2021-12-31")


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_hole_inside_the_series_is_filled_from_the_daily_series(store, tf):
    st, _ = store
    full, holed = window_dropped(st, tf)
    st[tf] = holed
    out = S.sanitize_daily_bars("XYZ", holed, tf)
    assert out == full


def test_a_hole_the_daily_series_also_has_stays(store):
    st, _ = store
    st["D"] = daily("2019-01-02", "2022-12-30", skip=[("2021-06-30", "2021-09-30")])   # a halt
    st["W"] = stored("W", st["D"])
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    assert out == st["W"]


@pytest.mark.parametrize("tf", ["W", "M"])
def test_a_short_hole_is_filled_where_it_is(store, tf):
    st, _ = store
    full, holed = window_dropped(st, tf, *SHORT)
    st[tf] = holed
    out = S.sanitize_daily_bars("XYZ", holed, tf)
    assert out == full


def test_a_hole_whose_edges_disagree_stays(store):
    st, _ = store
    full, holed = window_dropped(st, "W", *SHORT)
    i = next(k for k, b in enumerate(holed) if b["t"] > SHORT[1])
    holed[i] = dict(holed[i], c=holed[i]["c"] * 1.5)      # the bar after the hole: another basis
    st["W"] = holed
    out = S.sanitize_daily_bars("XYZ", holed, "W")
    assert out == holed


def test_a_hole_in_a_slice_is_filled_too(store):
    st, firsts = store
    full, holed = window_dropped(st, "W", *SHORT)
    firsts["W"] = dt.date(2015, 1, 2)       # a slice: no older periods, the hole still filled
    st["W"] = holed
    out = S.sanitize_daily_bars("XYZ", holed, "W")
    assert out == full


def test_a_fill_that_would_leave_part_of_the_hole_open_stays(store):
    st, _ = store
    full, holed = window_dropped(st, "W", *SHORT)
    st["D"] = [b for b in st["D"] if not ("2021-09-01" <= b["t"] <= "2021-10-31")]   # half the hole
    st["W"] = holed
    out = S.sanitize_daily_bars("XYZ", holed, "W")
    assert out == holed


def test_a_partial_period_after_a_hole_becomes_the_whole_one(store):
    st, _ = store
    full, holed = window_dropped(st, "W", *SHORT)
    i = next(k for k, b in enumerate(holed) if b["t"] > SHORT[1])
    days = [b for b in st["D"] if b["t"] <= holed[i]["t"]][-2:]         # its Thursday and Friday only
    holed[i] = stored("W", days)[0]
    assert holed[i]["v"] == 2000
    st["W"] = holed
    out = S.sanitize_daily_bars("XYZ", holed, "W")
    assert out == full


def test_a_whole_stored_period_at_a_fill_edge_is_kept(store):
    st, _ = store
    head = dict(st["W"][0], h=st["W"][0]["h"] + 5, v=5000)    # a whole week, the store's own high
    st["W"] = [head] + st["W"][1:]
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    assert out[0]["t"] == "2019-01-04"
    assert out[[b["t"] for b in out].index(head["t"])] == head


def test_a_partial_period_whose_close_disagrees_is_kept_as_stored(store):
    st, _ = store
    head = dict(st["W"][0], c=st["W"][0]["c"] * 1.1)          # partial (v=2000), another close
    st["W"] = [head] + st["W"][1:]
    out = S.sanitize_daily_bars("XYZ", st["W"], "W")
    assert out[0]["t"] == "2019-01-04"
    assert out[[b["t"] for b in out].index(head["t"])] == head


def test_the_daily_store_is_read_once_per_ttl_and_the_cached_bars_are_never_shared(store, monkeypatch):
    st, _ = store
    reads = []
    real = S._identity_source
    monkeypatch.setattr(S, "_identity_source", lambda s, tf: reads.append(tf) or real(s, tf))
    first = S.sanitize_daily_bars("XYZ", list(st["W"]), "W")
    first[0]["c"] = -1                                   # a consumer changing a bar it was served
    again = S.sanitize_daily_bars("XYZ", list(st["W"]), "W")
    assert reads.count("D") == 1
    assert again == stored("W", st["D"])


def test_the_newest_bar_after_a_hole_is_never_replaced(store):
    st, _ = store
    full = stored("W", st["D"])
    live = dict(full[-1], v=1000, h=full[-1]["h"] + 0.5)      # the developing week, as served live
    holed = full[:-4] + [live]                                # three closed weeks missing before it
    st["W"] = holed
    out = S.sanitize_daily_bars("XYZ", holed, "W")
    assert out[-1] == live
    assert out[:-1] == full[:-1]


def test_the_store_head_is_read_from_the_store(monkeypatch):
    monkeypatch.setattr(BF._sqlite, "get_first_ts", lambda s, tf: 20220610 if (s, tf) == ("XYZ", "W") else None)
    assert S._store_first("XYZ", "W") == dt.date(2022, 6, 10)
    assert S._store_first("XYZ", "M") is None
