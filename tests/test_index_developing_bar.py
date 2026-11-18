"""⭐ RS RATING L10 — A cash index's daily answer ends at TODAY'S session, under the bar contract.

⚰️ 2026-11-17, production, in session: RS Rating's label and dots were withheld on every chart
(`runtime:request`). The chart's own daily series carries today's forming bar (the equity
serve appends it, `_augment_daily_with_today`), SPX's ended at yesterday, so the run could
not know what `request.security("SP:SPX", "D", close)` reads on the newest bar. Measured the
same afternoon (18:04 UTC, smoke@, GET only): SPX's daily tail 11-16, NDX's an 11-17 row from
an earlier daily refresh, both `developing: null` and `newest_bar_is_forming: false`.

The fix builds today's daily bar for every cash index (`index_bars.INDEX_MAP`: SPX, NDX, VIX,
RUT, DJX, XSP, XND) from the index's OWN 5-minute bars of today's regular session, the series
this module already serves to a 5m index chart: one authority, no new provider call. The
equity serve is untouched.

⛔ EVERY CLOCK HERE IS PINNED (`_pin`): the router's (`bars._time`), the contract's
(`bar_contract._time`) and this module's (`index_bars.time`). No case reads the wall clock,
reads the disk snapshot under DATA_DIR, or reaches a provider (`_kick_bg_refresh` recorded).
"""
from __future__ import annotations

import datetime as _dt
import time as _real_time

import orjson
import pytest
from fastapi.responses import ORJSONResponse

from api import index_bars
from api.routers import bars
from api.services import bar_contract, massive
from api.services.cache import cache

ET = _dt.timezone(_dt.timedelta(hours=-5))          # EST: 2026-11 is after the DST change


def _et(s: str) -> int:
    return int(_dt.datetime.fromisoformat(s).replace(tzinfo=ET).timestamp())


def _utc_midnight(s: str) -> int:
    d = _dt.date.fromisoformat(s)
    return int(_dt.datetime(d.year, d.month, d.day, tzinfo=_dt.timezone.utc).timestamp())


TODAY = "2026-11-17"                                 # a Tuesday, a full session
IN_SESSION = _et(f"{TODAY}T13:04:00")                # 18:04 UTC: when production was measured
TODAY_KEY = _utc_midnight(TODAY)
DAILY = [{"t": _utc_midnight(d), "o": 100.0 + i, "h": 102.0 + i, "l": 99.0 + i, "c": 101.0 + i,
          "v": 1_000_000} for i, d in enumerate(("2026-11-12", "2026-11-13", "2026-11-16"))]


def _fives(day: str, start: str, end: str, base: float = 7400.0) -> list:
    """5m bars of one ET day, bar starts from `start` through `end` inclusive."""
    t, stop, out, i = _et(f"{day}T{start}:00"), _et(f"{day}T{end}:00"), [], 0
    while t <= stop:
        c = base + (i % 7) - 3 + i * 0.5
        out.append({"t": t, "o": c - 1, "h": c + 2 + (i == 5) * 20, "l": c - 2 - (i == 9) * 30,
                    "c": c, "v": 1000 + i})
        t, i = t + 300, i + 1
    return out


YESTERDAY_5M = _fives("2026-11-16", "09:30", "15:55", 7300.0)
TODAY_5M = _fives(TODAY, "09:30", "13:00")           # the newest bar started 13:00, now is 13:04


class _Clock:
    """A `time` module whose `time()` is pinned; everything else is the real module's."""
    def __init__(self, now: float):
        self._now = float(now)

    def time(self) -> float:
        return self._now

    def __getattr__(self, name):
        return getattr(_real_time, name)


@pytest.fixture
def env(monkeypatch):
    """The index cache isolated from the box: no disk snapshot read, no background refresh."""
    kicked: list = []
    monkeypatch.setattr(index_bars, "_load_disk", lambda sym, tf: None)
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda sym, tf: kicked.append((sym, tf)))
    seeded: list = []

    def seed(sym: str, tf: str, series: list, *, saved_at: float, proxy=False, legacy=False):
        entry = {"saved_at": saved_at, "series": series}
        if not legacy:
            entry["proxy"] = proxy
        cache.set(f"idxbars_{sym}_{tf}", entry, ttl=3600)
        seeded.append(f"idxbars_{sym}_{tf}")

    def pin(now: float):
        clk = _Clock(now)
        monkeypatch.setattr(index_bars, "time", clk)
        monkeypatch.setattr(bars, "_time", clk)
        monkeypatch.setattr(bar_contract, "_time", clk)

    def serve(sym: str = "SPX", daily: list | None = None, since: str = ""):
        rows = list(DAILY if daily is None else daily)
        monkeypatch.setattr(bars, "fetch_index_bars",
                            lambda t, tf, n, s: {"ticker": t, "tf": tf, "bars": list(rows)})
        r = bars.serve_bars(sym, tf="D", bars=600, since=since, to="")
        return orjson.loads(r.body)

    yield type("Env", (), {"seed": staticmethod(seed), "pin": staticmethod(pin),
                           "serve": staticmethod(serve), "kicked": kicked})
    for k in seeded:
        cache.set(k, None, ttl=1)


# ── in session: today's bar, under the contract ────────────────────────────────────────────

def test_in_session_the_index_answer_ends_at_today_and_the_contract_says_developing(env):
    env.pin(IN_SESSION)
    env.seed("SPX", "5", YESTERDAY_5M + TODAY_5M, saved_at=IN_SESSION - 60)
    out = env.serve("SPX")
    tail = out["bars"][-1]
    assert [b["t"] for b in out["bars"]] == [b["t"] for b in DAILY] + [TODAY_KEY]
    assert tail == {"t": TODAY_KEY, "o": TODAY_5M[0]["o"], "h": max(b["h"] for b in TODAY_5M),
                    "l": min(b["l"] for b in TODAY_5M), "c": TODAY_5M[-1]["c"],
                    "v": sum(b["v"] for b in TODAY_5M)}
    assert out["developing"] is not None and out["developing"]["t"] == TODAY_KEY
    assert out["developing"]["c"] == TODAY_5M[-1]["c"]
    assert out["newest_bar_is_forming"] is True
    assert env.kicked == []                          # a fresh 5m entry asks nobody


@pytest.mark.parametrize("sym", sorted(index_bars.INDEX_TICKERS))
def test_every_cash_index_the_router_serves_gets_today(env, sym):
    assert set(index_bars.INDEX_TICKERS) == {"SPX", "NDX", "VIX", "RUT", "DJX", "XSP", "XND"}
    env.pin(IN_SESSION)
    env.seed(sym, "5", TODAY_5M, saved_at=IN_SESSION - 60)
    out = env.serve(sym)
    assert out["bars"][-1]["t"] == TODAY_KEY
    assert out["developing"]["t"] == TODAY_KEY


def test_a_stored_today_row_read_mid_session_is_replaced_by_the_5m_build(env):
    """NDX on production: the daily store's 11-17 row was a snapshot from an earlier refresh."""
    env.pin(IN_SESSION)
    stale_today = {"t": TODAY_KEY, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 7}
    env.seed("NDX", "5", TODAY_5M, saved_at=IN_SESSION - 60)
    env.seed("NDX", "D", DAILY + [stale_today], saved_at=_et(f"{TODAY}T10:00:00"))
    out = env.serve("NDX", DAILY + [stale_today])
    assert [b["t"] for b in out["bars"]].count(TODAY_KEY) == 1
    assert out["bars"][-1]["c"] == TODAY_5M[-1]["c"]


def test_a_today_row_the_store_read_after_the_close_is_the_settled_bar_and_stands(env):
    now = _et(f"{TODAY}T17:00:00")
    env.pin(now)
    settled = {"t": TODAY_KEY, "o": 7400.0, "h": 7470.0, "l": 7390.0, "c": 7466.25, "v": 9}
    env.seed("SPX", "5", _fives(TODAY, "09:30", "15:55"), saved_at=now - 60)
    env.seed("SPX", "D", DAILY + [settled], saved_at=_et(f"{TODAY}T16:45:00"))
    out = env.serve("SPX", DAILY + [settled])
    assert out["bars"][-1] == settled


def test_after_the_close_with_no_settled_row_yet_the_full_session_is_built(env):
    now = _et(f"{TODAY}T16:20:00")
    env.pin(now)
    full = _fives(TODAY, "09:30", "15:55")
    env.seed("SPX", "5", full, saved_at=now - 60)
    out = env.serve("SPX")
    assert out["bars"][-1]["t"] == TODAY_KEY and out["bars"][-1]["c"] == full[-1]["c"]


def test_an_empty_since_delta_still_gets_today(env):
    """The delta carries no rows, so the gap is judged on the stored series (fetch_index_bars's read)."""
    env.pin(IN_SESSION)
    env.seed("SPX", "5", TODAY_5M, saved_at=IN_SESSION - 60)
    env.seed("SPX", "D", DAILY, saved_at=IN_SESSION - 600)
    out = env.serve("SPX", daily=[], since=str(DAILY[-1]["t"]))
    assert [b["t"] for b in out["bars"]] == [TODAY_KEY]


# ── never across a gap: the daily series must reach the previous session ──────────────────

STALE = [{"t": _utc_midnight(d), "o": 2780.0, "h": 2790.0, "l": 2760.0, "c": 2784.0, "v": 1}
         for d in ("2026-10-20", "2026-10-21", "2026-10-22")]


def test_a_daily_series_that_stopped_weeks_ago_gets_no_today_bar(env):
    """Production 2026-11-17 19:30Z: RUT's daily store ended 10-22 while its 5m series was fresh."""
    env.pin(IN_SESSION)
    env.seed("RUT", "5", TODAY_5M, saved_at=IN_SESSION - 60)
    out = env.serve("RUT", STALE)
    assert out["bars"] == STALE and out["developing"] is None


def test_an_empty_since_delta_over_a_stale_store_gets_no_today_bar(env):
    env.pin(IN_SESSION)
    env.seed("RUT", "5", TODAY_5M, saved_at=IN_SESSION - 60)
    env.seed("RUT", "D", STALE, saved_at=IN_SESSION - 600)
    assert env.serve("RUT", daily=[], since=str(STALE[-1]["t"]))["bars"] == []


def test_a_today_snapshot_over_a_stale_series_is_not_replaced_either(env):
    env.pin(IN_SESSION)
    snap = {"t": TODAY_KEY, "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 7}
    env.seed("RUT", "5", TODAY_5M, saved_at=IN_SESSION - 60)
    env.seed("RUT", "D", STALE + [snap], saved_at=_et(f"{TODAY}T10:00:00"))
    assert env.serve("RUT", STALE + [snap])["bars"] == STALE + [snap]


def test_monday_after_a_weekend_reaches_friday_and_gets_today(env):
    now = _et("2026-11-16T13:04:00")
    env.pin(now)
    friday = [dict(b) for b in DAILY[:2]]               # ends 2026-11-13, a Friday
    env.seed("SPX", "5", _fives("2026-11-16", "09:30", "13:00"), saved_at=now - 60)
    out = env.serve("SPX", friday)
    assert out["bars"][-1]["t"] == _utc_midnight("2026-11-16")


# ── out of session: nothing is built, the contract says null ──────────────────────────────

@pytest.mark.parametrize("when", [f"{TODAY}T00:30:00", f"{TODAY}T08:00:00", f"{TODAY}T09:29:00"])
def test_before_the_open_nothing_is_appended_and_developing_is_null(env, when):
    now = _et(when)
    env.pin(now)
    env.seed("SPX", "5", YESTERDAY_5M, saved_at=now - 60)
    out = env.serve("SPX")
    assert out["bars"] == DAILY
    assert out["developing"] is None


def test_a_weekend_appends_nothing(env):
    now = _et("2026-11-21T12:00:00")                 # Saturday
    env.pin(now)
    env.seed("SPX", "5", YESTERDAY_5M, saved_at=now - 60)
    out = env.serve("SPX")
    assert out["bars"] == DAILY and out["developing"] is None


def test_a_half_day_judges_the_lag_against_its_own_close(env):
    from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
    assert 20261127 in NYSE_EARLY_CLOSES_YYYYMMDD    # the precondition this case stands on
    now = _et("2026-11-27T14:00:00")                 # an hour after the 13:00 close
    env.pin(now)
    half = _fives("2026-11-27", "09:30", "12:55")
    env.seed("SPX", "5", half, saved_at=now - 60)
    # the session before the day after Thanksgiving is Wednesday 11-25 (11-26 is a holiday)
    through_wed = [{"t": _utc_midnight(d), "o": 1.0, "h": 2.0, "l": 0.5, "c": 1.5, "v": 1}
                   for d in ("2026-11-23", "2026-11-24", "2026-11-25")]
    out = env.serve("SPX", through_wed)
    assert out["bars"][-1]["t"] == _utc_midnight("2026-11-27")
    assert out["bars"][-1]["c"] == half[-1]["c"]


# ── refusals: a bar that is not today's index value is never built ────────────────────────

def test_a_stale_5m_series_builds_nothing(env):
    env.pin(IN_SESSION)
    env.seed("SPX", "5", _fives(TODAY, "09:30", "12:30"), saved_at=IN_SESSION - 60)   # 34 min behind
    out = env.serve("SPX")
    assert out["bars"] == DAILY and out["developing"] is None


def test_the_etf_proxy_is_never_today_s_index_value(env):
    env.pin(IN_SESSION)
    env.seed("SPX", "5", TODAY_5M, saved_at=IN_SESSION - 60, proxy=True)
    assert env.serve("SPX")["bars"] == DAILY


def test_an_entry_stored_before_the_proxy_flag_existed_is_not_trusted(env):
    env.pin(IN_SESSION)
    env.seed("SPX", "5", TODAY_5M, saved_at=IN_SESSION - 60, legacy=True)
    assert env.serve("SPX")["bars"] == DAILY


def test_an_uncached_5m_series_is_never_fetched_on_the_request(env, monkeypatch):
    env.pin(IN_SESSION)
    monkeypatch.setattr(index_bars, "_fetch_full_series",
                        lambda *a, **k: (_ for _ in ()).throw(AssertionError("provider call on a request")))
    cache.set("idxbars_SPX_5", None, ttl=1)
    assert env.serve("SPX")["bars"] == DAILY
    assert ("SPX", "5") in env.kicked                # warmed in the background instead


def test_the_refresh_records_whether_the_series_is_the_proxy(monkeypatch):
    saved = {}
    monkeypatch.setattr(index_bars, "_save_disk", lambda s, tf, series, proxy=None: saved.update(proxy=proxy))
    monkeypatch.setattr(index_bars, "_fetch_yf", lambda sym, interval, period, div:
                        [] if sym == "^GSPC" else [{"t": i, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for i in range(20)])
    monkeypatch.setattr(index_bars, "_proxy_ratio", lambda a, b: 10.0)
    index_bars._refresh("SPX", "5")
    assert saved["proxy"] is True
    monkeypatch.setattr(index_bars, "_fetch_yf", lambda sym, interval, period, div:
                        [{"t": i, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1} for i in range(20)])
    index_bars._refresh("SPX", "5")
    assert saved["proxy"] is False
    cache.set("idxbars_SPX_5", None, ttl=1)


# ── the equity serve is untouched ────────────────────────────────────────────────────────

_EQ = [{"t": "2026-11-13", "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 100},
       {"t": "2026-11-16", "o": 10.5, "h": 12.0, "l": 10.0, "c": 11.8, "v": 120}]
_EQ_TODAY = {"t": TODAY, "o": 11.8, "h": 12.5, "l": 11.5, "c": 12.2, "v": 40}


def _equity_body(monkeypatch, sym="AAPL"):
    from fastapi.responses import ORJSONResponse as R
    monkeypatch.setattr(bars, "_get_bars_inner",
                        lambda t, tf, n: R(content={"ticker": t, "tf": tf, "bars": list(_EQ)}))
    monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: dict(_EQ_TODAY))
    monkeypatch.setattr(bar_contract, "compute", lambda *a, **k: {"contract": "pinned"})
    return orjson.loads(bars.serve_bars(sym, tf="D", bars=600, since="", to="").body)


def test_an_equity_daily_answer_never_consults_the_index_build(env, monkeypatch):
    """⛔ RECORDED, NEVER RAISED: the router wraps the index block in `except Exception: pass`,
    so a raising stub would be swallowed and this rail could never fail (mutant M6 proved it)."""
    env.pin(IN_SESSION)
    reference = _equity_body(monkeypatch)
    reached: list = []
    real_block = bars._augment_index_daily_with_today
    monkeypatch.setattr(bars, "_augment_index_daily_with_today",
                        lambda r, t, now=None: (reached.append(("block", t)), real_block(r, t, now))[1])
    real_build = index_bars.with_todays_session
    monkeypatch.setattr(index_bars, "with_todays_session",
                        lambda t, b, now=None: (reached.append(("build", t)), real_build(t, b, now))[1])
    assert _equity_body(monkeypatch) == reference
    assert reached == []
    assert reference["bars"][-1] == _EQ_TODAY and reference["newest_bar_is_forming"] is True


# ── the readers the contract and the close state share ───────────────────────────────────

def test_the_daily_bucket_reads_an_index_key_as_its_session_date():
    want = bar_contract.bucket_bounds("D", TODAY, "rth")
    assert want is not None
    assert bar_contract.bucket_bounds("D", TODAY_KEY, "rth") == want
    assert bar_contract.bucket_bounds("D", 20261117, "rth") == want       # the store's key, as before
    assert bar_contract.bucket_bounds("D", TODAY_KEY + 3600, "rth") is None   # not a whole UTC day
    assert bar_contract.bucket_bounds("W", TODAY_KEY, "rth") is None      # W/M unchanged


def _close_state(t, now):
    import api.routers.bars as rb
    real = rb._time
    try:
        rb._time = _Clock(now)
        r = rb._augment_with_bar_close_state(
            ORJSONResponse(content={"bars": [{"t": t, "o": 1, "h": 1, "l": 1, "c": 1, "v": 1}]}), "D")
    finally:
        rb._time = real
    return orjson.loads(r.body).get("newest_bar_is_forming")


def test_an_index_daily_key_is_forming_in_its_session_and_settled_after_it():
    assert _close_state(TODAY_KEY, IN_SESSION) is True
    assert _close_state(TODAY_KEY, _et(f"{TODAY}T17:00:00")) is False
    assert _close_state(TODAY, IN_SESSION) is True                  # the equity key, unchanged
