"""⭐ Every cash index's DAILY series is kept fresh by a warm loop ON THE STORE MEMBERS READ, and a
refresh that fails is never silent.

⚰️ 2026-11-17 19:30Z, production, smoke@, GET only: before any recent read, the daily answers of
RUT, DJX and XSP ended 2026-10-22 and XND's 2026-10-28, served as `index-disk-stale`. They moved
only because those reads kicked the on-request background refresh.

The warm loop (`index_bars.start_index_warm`) DID include tf=D for all 7 indexes, on the web pod,
whose passes logged `failed: 0` all day. But the Cloudflare Worker sends `/api/bars/<sym>` to the
bars-api tier (edge/bars-edge-router), a separate volume with its own
`<DATA_DIR>/index_bars_cache`, and bars-api's lifespan started no index warm. Its copies moved
only on a read, and the first read after weeks of none served weeks-old rows with nothing in the
answer to say so.

The fix: bars-api runs the same loop over `SERVING_TIER_WARM_TFS` (D/W/M and the 5m series today's
daily bar is built from), with the same vendors and pacing. A refresh that gets nothing is logged
by name and leaves the copy in place, and every index answer carries `refreshed_at` and
`refresh_state` (docs/architecture/bar-contract.md).

⛔ NO CASE READS THE WALL CLOCK OR REACHES A VENDOR. `index_bars.time` is pinned, the disk store is
a tmp sandbox, FMP and yfinance are stubbed where `index_bars` calls them, and the two real vendor
doors (`fmp_client._fetch`, `yf_util.bounded_call`) are tripwires.
"""
from __future__ import annotations

import asyncio
import datetime as _dt
import json
import logging
import os
import threading
import time as _real_time
from types import SimpleNamespace

import orjson
import pytest

from api import index_bars
from api.routers import bars
from api.services import bar_contract, fmp_client, massive, yf_util
from api.services.bars_fetch import get_serve_layer
from api.services.cache import cache

UTC = _dt.timezone.utc
NOW = _dt.datetime(2026, 11, 17, 19, 30, tzinfo=UTC).timestamp()      # when production was read
STALE_SAVED = _dt.datetime(2026, 10, 22, 21, 0, tzinfo=UTC).timestamp()
HISTORY_START = _dt.date(2026, 9, 1)
STALE_TAIL = _dt.date(2026, 10, 22)
FRESH_TAIL = _dt.date(2026, 11, 16)                  # the last settled session before NOW
SEVEN = {"SPX", "NDX", "VIX", "RUT", "DJX", "XSP", "XND"}


def _utc_midnight(d: _dt.date) -> int:
    return int(_dt.datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp())


def _date_of(t: int) -> _dt.date:
    return _dt.datetime.fromtimestamp(t, UTC).date()


def _daily(end: _dt.date) -> list:
    out, d, i = [], HISTORY_START, 0
    while d <= end:
        if d.weekday() < 5:
            out.append({"t": _utc_midnight(d), "o": 100.0 + i, "h": 105.0 + i, "l": 95.0 + i,
                        "c": 101.0 + i, "v": 0})
            i += 1
        d += _dt.timedelta(days=1)
    return out


class _Clock:
    """`index_bars.time`: `time()` pinned, `sleep()` returns at once, the rest is the real module."""
    def time(self) -> float:
        return NOW

    def sleep(self, _s) -> None:
        return None

    def __getattr__(self, name):
        return getattr(_real_time, name)


def _tripwire(name):
    def _f(*_a, **_k):
        raise AssertionError(f"a live vendor call was attempted: {name}")
    return _f


_KEYS = [f"idxbars_{s}_{tf}" for s in SEVEN for tf in index_bars._WARM_TFS]


@pytest.fixture
def box(monkeypatch, tmp_path):
    """The index store in a tmp sandbox, the clock pinned, the vendors stubbed."""
    disk = tmp_path / "index_bars_cache"
    monkeypatch.setattr(index_bars, "_DISK_DIR", str(disk))
    monkeypatch.setattr(index_bars, "time", _Clock())
    monkeypatch.setattr(index_bars, "_refresh_failed_at", {})
    monkeypatch.setattr(index_bars, "_WARM_PACE_S", 0)
    monkeypatch.setattr(fmp_client, "_fetch", _tripwire("fmp_client._fetch"))
    monkeypatch.setattr(yf_util, "bounded_call", _tripwire("yf_util.bounded_call"))
    vendor = {"down": False, "fmp": [], "yf": []}

    def fake_fmp(sym, f, t, **_k):
        vendor["fmp"].append(sym)
        if vendor["down"]:
            raise RuntimeError("503 Service Unavailable (stub)")
        lo, hi = _dt.date.fromisoformat(f), _dt.date.fromisoformat(t)
        rows = [{"date": _date_of(b["t"]).isoformat(), "open": b["o"], "high": b["h"], "low": b["l"],
                 "close": b["c"], "volume": 0}
                for b in _daily(FRESH_TAIL) if lo <= _date_of(b["t"]) <= hi]
        return SimpleNamespace(value=list(reversed(rows)))          # newest first, as FMP answers

    def fake_yf(sym, interval, period, divisor):
        vendor["yf"].append((sym, interval))
        if vendor["down"]:
            return []
        if interval in index_bars.INTRADAY_INTERVALS:
            start = int(NOW) - 60 * 300
            return [{"t": start + i * 300, "o": 1.0, "h": 1.0, "l": 1.0, "c": 1.0, "v": 0}
                    for i in range(60)]
        return _daily(FRESH_TAIL)

    monkeypatch.setattr(fmp_client, "get_index_history_eod_full", fake_fmp)
    monkeypatch.setattr(index_bars, "_fetch_yf", fake_yf)
    monkeypatch.setattr(index_bars, "_proxy_ratio", lambda *_a: None)
    for k in _KEYS:
        cache.invalidate(k)

    def seed_stale(sym: str, tf: str = "D") -> str:
        os.makedirs(disk, exist_ok=True)
        path = index_bars._disk_path(sym, tf)
        with open(path, "w", encoding="utf-8") as fh:
            json.dump({"saved_at": STALE_SAVED, "series": _daily(STALE_TAIL)}, fh)
        cache.invalidate(f"idxbars_{sym}_{tf}")
        return path

    def read(sym: str, tf: str = "D") -> dict:
        """A first read on a process whose memory is empty (a tier right after a deploy)."""
        cache.invalidate(f"idxbars_{sym}_{tf}")
        return index_bars.fetch_index_bars(sym, tf, 600)

    yield SimpleNamespace(vendor=vendor, seed_stale=seed_stale, read=read, disk=disk)
    for k in _KEYS:
        cache.invalidate(k)


# ── the loop runs where members read ─────────────────────────────────────────────────────────

def test_the_serving_tier_starts_the_index_warm_loop_over_the_daily_series(monkeypatch):
    """bars-api is where the edge sends `/api/bars/<sym>`; its lifespan must start the loop."""
    import api.bars_api_main as bam
    from api.services import bars_live_store, bars_wal_checkpointer, intraday_grid
    started: list = []
    monkeypatch.delenv("BARSPACK_WEB_INGEST_ENABLED", raising=False)
    monkeypatch.delenv("BARS_API_PUSH_HOTSET", raising=False)
    monkeypatch.setattr(bam, "_ensure_local_db_installed", lambda: started.append("install"))
    monkeypatch.setattr(bam, "_start_periodic_pull", lambda: started.append("pull"))
    monkeypatch.setattr(bam, "_start_hotset_push", lambda: started.append("hotset"))
    monkeypatch.setattr(intraday_grid, "sweep_async", lambda: started.append("sweep"))
    monkeypatch.setattr(bars_wal_checkpointer, "start_bars_wal_checkpointer",
                        lambda: started.append("wal"))
    monkeypatch.setattr(bars_live_store, "start", lambda: started.append("live"))
    warm_calls: list = []
    monkeypatch.setattr(index_bars, "start_index_warm",
                        lambda *a, **k: warm_calls.append((a, k)))

    async def _enter():
        async with bam._lifespan(bam._build_app()):
            pass

    asyncio.run(_enter())
    # the lifespan's own helper threads call the stubs above: done before the stubs are undone
    for t in threading.enumerate():
        if t.name in ("bars-api-boot-install", "bars-api-offgrid-sweep-wait"):
            t.join(timeout=10)
    assert {"install", "sweep", "pull", "wal", "live"} <= set(started), started
    assert len(warm_calls) == 1, f"bars-api lifespan started the index warm {len(warm_calls)} times"
    args, kwargs = warm_calls[0]
    tfs = tuple(kwargs.get("tfs") or (args[1] if len(args) > 1 else ()))
    assert "D" in tfs and index_bars.DEVELOPING_SOURCE_TF in tfs, tfs
    assert "D" in index_bars._WARM_TFS                    # web's set, as before


class _Stop(Exception):
    pass


def test_the_loop_warms_the_timeframes_it_was_started_with(monkeypatch):
    """The loop body runs on THIS thread (no daemon is started), and stops at its first
    interval sleep, so no pass can outlive the test's stubs."""
    sleeps: list = []

    class _StopClock(_Clock):
        def sleep(self, s) -> None:
            sleeps.append(s)
            if len(sleeps) > 1:                            # the boot settle, then one pass
                raise _Stop

    built: dict = {}

    class _Thread:
        def __init__(self, target, name, daemon):
            built.update(target=target, name=name, daemon=daemon)

        def start(self):
            built["started"] = True

    monkeypatch.setattr(index_bars, "time", _StopClock())
    monkeypatch.setattr(index_bars, "threading", SimpleNamespace(Thread=_Thread))
    seen: list = []
    monkeypatch.setattr(index_bars, "warm_indices", lambda tfs=None: seen.append(tfs))
    index_bars.start_index_warm(tfs=index_bars.SERVING_TIER_WARM_TFS)
    assert built.get("started") and built["daemon"] and built["name"] == "index-bars-warm"
    with pytest.raises(_Stop):
        built["target"]()
    assert seen == [index_bars.SERVING_TIER_WARM_TFS]


@pytest.mark.parametrize("tfs", [index_bars.SERVING_TIER_WARM_TFS, index_bars._WARM_TFS],
                         ids=["bars-api", "web"])
def test_a_warm_pass_over_a_stale_daily_store_refreshes_every_index(box, tfs):
    assert set(index_bars.INDEX_MAP) == SEVEN
    for sym in SEVEN:
        box.seed_stale(sym)
    stats = index_bars.warm_indices(tfs)
    assert stats["failed"] == 0 and stats["fetched"] == len(SEVEN) * len(tfs)
    for sym in sorted(SEVEN):
        on_disk = index_bars._load_disk(sym, "D")
        assert _date_of(on_disk["series"][-1]["t"]) == FRESH_TAIL, sym
        assert on_disk["saved_at"] == NOW, sym
        out = box.read(sym)
        assert _date_of(out["bars"][-1]["t"]) == FRESH_TAIL, sym
        assert (out["refresh_state"], out["refreshed_at"]) == ("fresh", NOW), sym
    assert set(box.vendor["fmp"]) == {"^GSPC", "^NDX", "^VIX", "^RUT", "^DJI"}


# ── a stale or failed copy says so in the answer ───────────────────────────────────────────

def test_the_first_read_of_a_weeks_old_copy_says_stale_and_kicks_a_refresh(box, monkeypatch):
    kicked: list = []
    monkeypatch.setattr(index_bars, "_kick_bg_refresh", lambda s, tf: kicked.append((s, tf)))
    box.seed_stale("RUT")
    out = box.read("RUT")
    assert _date_of(out["bars"][-1]["t"]) == STALE_TAIL
    assert get_serve_layer() == "index-disk-stale"
    assert (out["refresh_state"], out["refreshed_at"]) == ("stale", STALE_SAVED)
    assert kicked == [("RUT", "D")]


def test_a_vendor_failure_is_logged_by_name_and_the_answer_says_failed(box, caplog):
    path = box.seed_stale("RUT")
    with open(path, "rb") as fh:
        before = fh.read()
    box.vendor["down"] = True
    with caplog.at_level(logging.INFO, logger="index_bars"):
        stats = index_bars.warm_indices(("D",))
    assert stats["failed"] == len(SEVEN) and stats["fetched"] == 0
    named = [r for r in caplog.records
             if r.levelno >= logging.WARNING and "refresh FAILED RUT D" in r.getMessage()]
    assert named, [r.getMessage() for r in caplog.records]
    assert "2026-10-22" in named[0].getMessage()                   # the age of what stays
    summary = [r for r in caplog.records if "warm pass done" in r.getMessage()]
    assert summary and summary[-1].levelno >= logging.WARNING
    assert "RUT D" in summary[-1].getMessage()
    with open(path, "rb") as fh:
        assert fh.read() == before                                 # the copy stays, untouched
    out = box.read("RUT")
    assert _date_of(out["bars"][-1]["t"]) == STALE_TAIL
    assert (out["refresh_state"], out["refreshed_at"]) == ("failed", STALE_SAVED)
    # the vendor comes back: the next pass refreshes it and the answer is current again
    box.vendor["down"] = False
    assert index_bars.warm_indices(("D",))["failed"] == 0
    out = box.read("RUT")
    assert _date_of(out["bars"][-1]["t"]) == FRESH_TAIL
    assert (out["refresh_state"], out["refreshed_at"]) == ("fresh", NOW)


def test_one_series_that_raises_does_not_stop_the_pass(box, monkeypatch, caplog):
    real = index_bars._fetch_full_series

    def flaky(sym, tf, info=None):
        if sym == "RUT":
            raise RuntimeError("vendor wrapper blew up (stub)")
        return real(sym, tf, info)

    monkeypatch.setattr(index_bars, "_fetch_full_series", flaky)
    for sym in SEVEN:
        box.seed_stale(sym)
    with caplog.at_level(logging.INFO, logger="index_bars"):
        stats = index_bars.warm_indices(("D",))
    assert (stats["fetched"], stats["failed"]) == (len(SEVEN) - 1, 1)
    for sym in sorted(SEVEN - {"RUT"}):
        assert _date_of(index_bars._load_disk(sym, "D")["series"][-1]["t"]) == FRESH_TAIL, sym
    assert any("refresh FAILED RUT D: RuntimeError" in r.getMessage() for r in caplog.records)
    assert box.read("RUT")["refresh_state"] == "failed"


# ── the equity serve is untouched ────────────────────────────────────────────────────────────

_EQ_D = [{"t": "2026-11-13", "o": 10.0, "h": 11.0, "l": 9.5, "c": 10.5, "v": 100},
         {"t": "2026-11-16", "o": 10.5, "h": 12.0, "l": 10.0, "c": 11.8, "v": 120}]
_EQ_5 = [{"t": int(NOW) - 600 + i * 300, "o": 11.0, "h": 11.2, "l": 10.9, "c": 11.1, "v": 10}
         for i in range(2)]


@pytest.mark.parametrize("tf", ["D", "W", "5"])
def test_an_equity_answer_never_reaches_the_index_freshness(monkeypatch, tf):
    """⛔ RECORDED, NEVER RAISED: the router wraps its augment steps in `except Exception`, so a
    raising stub could be swallowed and this rail could never fail."""
    from fastapi.responses import ORJSONResponse as R
    monkeypatch.setattr(bars, "_time", _Clock())
    monkeypatch.setattr(bars, "_get_bars_inner",
                        lambda t, tf_, n: R(content={"ticker": t, "tf": tf_,
                                                     "bars": list(_EQ_5 if tf_ == "5" else _EQ_D)}))
    monkeypatch.setattr(massive, "todays_daily_bar", lambda tk: None)
    monkeypatch.setattr(bar_contract, "compute", lambda *a, **k: {"contract": "pinned"})
    monkeypatch.setattr(bars._bars_fetch, "intraday_tail_status",
                        lambda *a, **k: {"tail_status": "verified", "verified_through": NOW})
    reached: list = []
    real_fetch, real_fresh = bars.fetch_index_bars, index_bars._freshness
    monkeypatch.setattr(bars, "fetch_index_bars",
                        lambda *a, **k: (reached.append("fetch_index_bars"), real_fetch(*a, **k))[1])
    monkeypatch.setattr(index_bars, "_freshness",
                        lambda *a, **k: (reached.append("_freshness"), real_fresh(*a, **k))[1])
    body = orjson.loads(bars.serve_bars("AAPL", tf=tf, bars=600, since="", to="").body)
    assert reached == []
    assert "refresh_state" not in body and "refreshed_at" not in body
    assert [b["t"] for b in body["bars"]] == [b["t"] for b in (_EQ_5 if tf == "5" else _EQ_D)]
