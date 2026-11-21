"""Universe minute frames: the codec, the publisher, the flag-off rail and the fixtures the browser
and the edge are pinned to. See api/services/minute_frames.py (format) and
api/services/minute_frame_publisher.py (publisher)."""
from __future__ import annotations

import asyncio
import gzip
import json
import math
import os
import random
import struct
from pathlib import Path

import pytest

from api.services import bars_live_ingest
from api.services import minute_frame_publisher as mfp
from api.services import minute_frames as mf
from tests import minute_frames_fixture as fx

ROOT = Path(__file__).resolve().parent.parent


# ── codec: exact round trip ──────────────────────────────────────────────────────

def _roundtrip(rows, with_av=False, **kw):
    m = kw.pop("minute", 29_000_000)
    raw = mf.encode_frame(day=20261118, seq=10, prev_seq=9, epoch=1, minute=m,
                          blocks=[(m, mf.KIND_ONTIME, rows)], with_av=with_av, **kw)
    return mf.decode_frame(mf.gzip_bytes(raw))["blocks"][0]["rows"]


def _same_bits(a, b):
    return struct.pack("<d", a) == struct.pack("<d", b)


def test_round_trip_is_bit_exact_for_decimal_prices_and_volumes():
    rnd = random.Random(5)
    rows = {}
    for i in range(3000):
        dec = rnd.choice((0, 1, 2, 2, 2, 3, 4, 6))
        base = rnd.choice((0.0001, 0.5, 3, 47, 312, 4100, 712000))
        def p():
            return float(f"{base * (1 + rnd.uniform(-0.02, 0.02)):.{dec}f}") or 0.01
        vol = float(f"{rnd.uniform(0, 5e6):.{rnd.choice((0, 0, 0, 6))}f}")
        rows[f"S{i:05d}"] = (p(), p(), p(), p(), vol)
    back = _roundtrip(rows)
    assert back.keys() == rows.keys()
    for s, r in rows.items():
        assert all(_same_bits(a, b) for a, b in zip(r, back[s])), (s, r, back[s])


def test_values_no_scale_can_hold_travel_as_float64_and_still_round_trip():
    awkward = [0.1 + 0.2, 1.0 / 3.0, math.pi, 1e-12, 123456789.123456789, 2.0 ** 60, -0.5]
    rows = {f"X{i}": (x, x, x, x, abs(x)) for i, x in enumerate(awkward)}
    back = _roundtrip(rows)
    for s, r in rows.items():
        assert all(_same_bits(a, b) for a, b in zip(r, back[s])), (s, r, back[s])
    assert mf.price_scale([0.1 + 0.2]) == mf.RAW_SCALE
    assert mf.price_scale([150.2345]) == 4
    assert mf.price_scale([2.0 ** 60]) == mf.RAW_SCALE          # beyond +-2**50 scaled


def test_av_is_carried_exactly_and_absent_stays_absent():
    rows = {"A": (1.0, 2.0, 0.5, 1.5, 10.0, 12345.0), "B": (3.0, 3.0, 3.0, 3.0, 0.5, None),
            "C": (1.0, 1.0, 1.0, 1.0, 1.0 / 3.0, 2.0 / 3.0)}
    assert _roundtrip(rows, with_av=True) == rows


def test_header_late_replace_and_incomplete_survive():
    m = 29_000_000
    raw = mf.encode_frame(day=20261118, seq=400, prev_seq=398, epoch=99, minute=m, complete=False,
                          blocks=[(m, mf.KIND_ONTIME, {}), (m - 3, mf.KIND_LATE, {"T": (1.0, 1.0, 1.0, 1.0, 1.0)}),
                                  (m - 1, mf.KIND_REPLACE, {"T": (2.0, 2.0, 2.0, 2.0, 2.0)})])
    d = mf.decode_frame(raw)
    assert (d["day"], d["seq"], d["prev_seq"], d["epoch"], d["minute"]) == (20261118, 400, 398, 99, m)
    assert d["flags"] & mf.FLAG_INCOMPLETE
    assert [(b["minute"], b["kind"]) for b in d["blocks"]] == [(m, 0), (m - 3, 1), (m - 1, 2)]


@pytest.mark.parametrize("damage", ["crc", "truncate", "magic", "version"])
def test_a_damaged_frame_is_refused_never_half_read(damage):
    raw = bytearray(mf.encode_frame(day=1, seq=1, prev_seq=0, epoch=1, minute=5,
                                    blocks=[(5, 0, {"AAPL": (1.0, 2.0, 0.5, 1.5, 3.0)})]))
    if damage == "crc":
        raw[40] ^= 0x01
    elif damage == "truncate":
        raw = raw[:-7]
    elif damage == "magic":
        raw[0] = ord("X")
    else:
        raw[4] = 9
    with pytest.raises(mf.FrameError):
        mf.decode_frame(bytes(raw))


def test_symbols_must_be_ascii_and_the_table_front_codes():
    with pytest.raises(ValueError):
        mf.encode_frame(day=1, seq=1, prev_seq=0, epoch=1, minute=5, blocks=[(5, 0, {"É": (1.0,) * 5})])
    rows = {s: (1.0, 1.0, 1.0, 1.0, 1.0) for s in ("A", "AA", "AAL", "AAPL", "BRK-B", "BRK-A")}
    assert set(_roundtrip(rows)) == set(rows)


def test_today_writer_is_byte_identical_to_one_shot_encode_and_decodes():
    frames = [mf.encode_frame(day=20261118, seq=s, prev_seq=s - 1 if s else mf.NO_SEQ, epoch=3, minute=100 + s,
                              blocks=[(100 + s, 0, {"A": (float(s + 1),) * 4 + (1.0,)})]) for s in range(7)]
    w = mf.TodayWriter(day=20261118, epoch=3)
    for s, f in enumerate(frames):
        w.add(f, s)
        snap = w.snapshot()
        assert gzip.decompress(snap) == mf.encode_today(day=20261118, seq=s, epoch=3, frames=frames[:s + 1])
    t = mf.decode_today(w.snapshot())
    assert t["seq"] == 6 and [f["seq"] for f in t["frames"]] == list(range(7))


def test_seq_clock_is_wall_clock_minutes_from_0400_et_across_dst():
    for day in (20260306, 20260309, 20261030, 20261102, 20261118):     # both sides of both 2026 switches
        for seq in (0, 330, 959):
            m = mf.minute_of_seq(day, seq)
            assert mf.seq_of_minute(m) == (day, seq)
    assert mf.hhmm_of_seq(0) == "0400" and mf.hhmm_of_seq(330) == "0930" and mf.hhmm_of_seq(959) == "1959"
    assert mf.seq_of_minute(mf.minute_of_seq(20261118, 0) - 1)[1] == -1       # 03:59 is outside


# ── the publisher ────────────────────────────────────────────────────────────────

class R2:
    def __init__(self, fail=0):
        self.objects, self.order, self.log, self.fail = {}, [], [], fail

    def put(self, key, body, ctype):
        if self.fail:
            self.fail -= 1
            return False
        self.objects[key] = bytes(body)
        self.order.append(key)
        self.log.append((key, bytes(body)))
        return True

    def get(self, key):
        return self.objects.get(key)


DAY = "2026-11-18"


def _pub(r2, clock, live=lambda: True, **kw):
    return mfp.Publisher(put=r2.put, get=r2.get, live=live, grace_s=5, roll_every=5, epoch=42,
                         now_ms=lambda: clock["ms"], prefix="live1m/", **kw)


def _am(m, c=10.0, v=100.0):
    return {"t": m * 60000, "o": c, "h": c + 0.05, "l": c - 0.05, "c": c, "v": v}


def _run_to(pub, clock, s):
    clock["ms"] = s * 1000
    d = pub.day_needed()
    if d is not None:
        pub.start_day(pub.load_day(d))
    built = pub.tick()
    if built:
        pub.encode_pending()
    pub.flush_uploads()
    return built


def test_one_frame_per_minute_empty_ones_included_frame_before_head():
    r2, clock = R2(), {"ms": 0}
    m0 = fx._unix(DAY, 9, 30) // 60
    pub = _pub(r2, clock)
    clock["ms"] = (m0 + 1) * 60000 + 1000
    pub.on_am("AAPL", _am(m0))
    pub.on_am("BRK.B", _am(m0, 400.0))                 # vendor dot form -> app hyphen form
    pub.on_am("BCpC", _am(m0))                         # lowercase-marked: no app symbol
    assert _run_to(pub, clock, (m0 + 1) * 60 + 4) == []          # inside the grace: nothing yet
    built = _run_to(pub, clock, (m0 + 1) * 60 + 5)
    assert [f["seq"] for f in built] == [330]
    _run_to(pub, clock, (m0 + 4) * 60 + 5)                       # three quiet minutes
    frames = {k: mf.decode_frame(v) for k, v in r2.objects.items() if k.endswith(".bin") and "today" not in k}
    assert sorted(k[-8:] for k in frames) == ["0930.bin", "0931.bin", "0932.bin", "0933.bin"]
    first = frames[f"live1m/{DAY}/0930.bin"]
    assert set(first["blocks"][0]["rows"]) == {"AAPL", "BRK-B"} and first["prev_seq"] == mf.NO_SEQ
    assert frames[f"live1m/{DAY}/0931.bin"]["blocks"][0]["rows"] == {}
    assert frames[f"live1m/{DAY}/0933.bin"]["prev_seq"] == 332
    for i, (key, body) in enumerate(r2.log):              # every head written names a frame already there
        if key.endswith("head.json"):
            want = f"live1m/{DAY}/{json.loads(body)['hhmm']}.bin"
            assert want in [k for k, _ in r2.log[:i]], (i, want)
    head = json.loads(r2.objects[f"live1m/{DAY}/head.json"])
    assert head["seq"] == 333 and head["hhmm"] == "0933"
    assert pub.stats["unmapped"] == 1


def test_head_never_lands_before_its_frame_even_when_uploads_fail():
    r2, clock = R2(fail=1), {"ms": 0}
    m0 = fx._unix(DAY, 9, 30) // 60
    pub = _pub(r2, clock)
    clock["ms"] = (m0 + 1) * 60000
    pub.on_am("AAPL", _am(m0))
    _run_to(pub, clock, (m0 + 1) * 60 + 6)
    assert r2.order == []                                         # the frame failed: nothing after it went
    _run_to(pub, clock, (m0 + 1) * 60 + 7)
    assert r2.order[0].endswith("0930.bin") and r2.order[1].endswith("head.json")


def test_late_new_bars_and_corrections_ride_the_next_frame_repeats_are_dropped():
    r2, clock = R2(), {"ms": 0}
    m0 = fx._unix(DAY, 10, 0) // 60
    pub = _pub(r2, clock)
    clock["ms"] = (m0 + 1) * 60000
    pub.on_am("AAPL", _am(m0, 10.0))
    _run_to(pub, clock, (m0 + 1) * 60 + 5)
    pub.on_am("AAPL", _am(m0, 10.0))                   # identical repeat
    pub.on_am("AAPL", _am(m0, 10.01))                  # a correction
    pub.on_am("MSFT", _am(m0, 400.0))                  # late, never published
    pub.on_am("OLD", _am(m0 - 120, 1.0))               # older than anything remembered
    clock["ms"] = (m0 + 2) * 60000
    pub.on_am("AAPL", _am(m0 + 1, 10.02))
    _run_to(pub, clock, (m0 + 2) * 60 + 5)
    f = mf.decode_frame(r2.objects[f"live1m/{DAY}/1001.bin"])
    kinds = {(b["minute"], b["kind"]): b["rows"] for b in f["blocks"]}
    assert set(kinds[(m0 + 1, mf.KIND_ONTIME)]) == {"AAPL"}
    assert set(kinds[(m0, mf.KIND_LATE)]) == {"MSFT"}
    assert kinds[(m0, mf.KIND_REPLACE)]["AAPL"][3] == 10.01
    assert pub.stats["repeats"] == 1 and pub.stats["too_late"] == 1


def test_a_minute_the_socket_was_down_for_is_flagged_incomplete():
    """Minute M's AM bars are emitted after M ends: a socket down at any point between M's end
    and M's frame build may have lost them. Down 11:01:30-11:02:30 (ticks every second, as in
    production) spans 11:01's delivery window only."""
    r2, clock = R2(), {"ms": 0}
    m0 = fx._unix(DAY, 11, 0) // 60
    pub = _pub(r2, clock, live=lambda: not (m0 * 60 + 90 <= clock["ms"] // 1000 < m0 * 60 + 150))
    clock["ms"] = (m0 + 1) * 60000
    pub.on_am("AAPL", _am(m0))
    for s in range((m0 + 1) * 60, (m0 + 3) * 60 + 6):
        _run_to(pub, clock, s)
    flags = {k[-8:-4]: mf.decode_frame(v)["flags"] & mf.FLAG_INCOMPLETE
             for k, v in r2.objects.items() if k.endswith(".bin") and "today" not in k}
    assert flags == {"1100": 0, "1101": mf.FLAG_INCOMPLETE, "1102": 0}
    pub.note_connected((m0 + 3) * 60000 + 20000)        # a gap connect after 11:03 ended? no: inside 11:03
    _run_to(pub, clock, (m0 + 4) * 60 + 5)
    assert mf.decode_frame(r2.objects[f"live1m/{DAY}/1103.bin"])["flags"] & mf.FLAG_INCOMPLETE == 0
    pub.note_connected((m0 + 5) * 60000 + 2000)         # 2 s after 11:04 ended: its bars may be lost
    _run_to(pub, clock, (m0 + 5) * 60 + 5)
    assert mf.decode_frame(r2.objects[f"live1m/{DAY}/1104.bin"])["flags"] & mf.FLAG_INCOMPLETE


def test_a_restart_resumes_today_links_prev_seq_and_never_republishes_a_seq():
    r2, clock = R2(), {"ms": 0}
    m0 = fx._unix(DAY, 12, 0) // 60
    a = _pub(r2, clock)
    for k in range(6):
        clock["ms"] = (m0 + k + 1) * 60000
        a.on_am("AAPL", _am(m0 + k))
        _run_to(a, clock, (m0 + k + 1) * 60 + 5)
    assert json.loads(r2.objects[f"live1m/{DAY}/head.json"])["today_seq"] == 484   # 12:04 rolled
    published_1205 = r2.objects[f"live1m/{DAY}/1205.bin"]
    # a deploy: a new process, a new epoch, 12:06-12:08 never seen; it also hears 12:05 again
    b = mfp.Publisher(put=r2.put, get=r2.get, live=lambda: True, grace_s=5, roll_every=5, epoch=43,
                      now_ms=lambda: clock["ms"], prefix="live1m/")
    clock["ms"] = (m0 + 9) * 60000 + 1000
    b.on_am("AAPL", _am(m0 + 8))
    _run_to(b, clock, (m0 + 9) * 60 + 5)
    f = mf.decode_frame(r2.objects[f"live1m/{DAY}/1208.bin"])
    assert f["prev_seq"] == 485 and f["epoch"] == 43            # 12:05 was out (head named it): linked
    assert r2.objects[f"live1m/{DAY}/1205.bin"] == published_1205
    _run_to(b, clock, (m0 + 10) * 60 + 5)                       # 12:09 rolls today.bin again
    t = mf.decode_today(r2.objects[f"live1m/{DAY}/today.bin"])
    assert [fr["seq"] for fr in t["frames"]] == [480, 481, 482, 483, 484, 485, 488, 489]
    assert b.stats["resumed_frames"] == 6


def test_bars_outside_the_0400_2000_session_are_counted_not_published():
    r2, clock = R2(), {"ms": 0}
    m = fx._unix(DAY, 20, 15) // 60
    pub = _pub(r2, clock)
    clock["ms"] = (m + 1) * 60000
    pub.on_am("AAPL", _am(m))
    _run_to(pub, clock, (m + 1) * 60 + 5)
    assert r2.order == [] and pub.stats["outside_session"] == 1


def test_the_reader_loop_never_runs_the_r2_read_or_the_encode():
    """day_needed + start_day are what the loop does; load_day (the R2 read, the re-compress)
    and encode_pending are handed to asyncio.to_thread in _run."""
    import inspect
    src = inspect.getsource(mfp._run)
    assert "to_thread(p.load_day" in src and "to_thread(p.encode_pending" in src and "to_thread(p.flush_uploads" in src


# ── OFF means off: the universe feed is unchanged ────────────────────────────────

def test_flag_off_hands_bar_stream_the_very_same_on_am(monkeypatch):
    monkeypatch.delenv("MINUTE_FRAMES_ENABLED", raising=False)
    assert bars_live_ingest.universe_am_handler() is bars_live_ingest.on_am
    mfp._reset_for_tests()

    async def go():
        return bars_live_ingest.start_minute_frames(asyncio.get_running_loop())
    assert asyncio.run(go()) is False and mfp._task is None
    bars_live_ingest.note_gap_connect()
    assert mfp._publisher is None


def test_flag_on_feeds_both_and_the_publisher_cannot_break_the_forwarder(monkeypatch):
    monkeypatch.setenv("MINUTE_FRAMES_ENABLED", "1")
    seen = []
    monkeypatch.setattr(bars_live_ingest, "on_am", lambda s, b: seen.append(("ingest", s)))

    def boom(s, b):
        raise RuntimeError("publisher broke")
    monkeypatch.setattr(mfp, "on_am", boom)
    h = bars_live_ingest.universe_am_handler()
    assert h is not bars_live_ingest.on_am
    h("AAPL", {"t": 0})
    assert seen == [("ingest", "AAPL")]


def test_bar_stream_wires_the_handler_and_the_hooks():
    src = (ROOT / "api" / "services" / "bar_stream.py").read_text(encoding="utf-8")
    assert "on_universe_am=(bars_live_ingest.universe_am_handler() if universe else None)" in src
    assert "bars_live_ingest.start_minute_frames(asyncio.get_running_loop())" in src
    assert "bars_live_ingest.note_gap_connect()" in src


# ── the edge path sits inside the member cookie's scope ──────────────────────────

def test_live1m_edge_prefix_is_inside_the_hist_cookie_path():
    from api import chart_edge_token as cet
    js = (ROOT / "edge" / "bars-edge-router" / "live1m.js").read_text(encoding="utf-8")
    prefix = js.split('export const LIVE1M_PREFIX = "', 1)[1].split('"', 1)[0]
    assert prefix.startswith(cet.HIST_COOKIE_PATH + "/"), prefix
    consumer = (ROOT / "app" / "src" / "lib" / "minuteFrames" / "consumer.js").read_text(encoding="utf-8")
    assert f"export const DEFAULT_BASE = '{prefix}v1'" in consumer


# ── fixtures: the browser and the edge are pinned to THESE bytes ─────────────────

def test_fixtures_are_what_the_encoder_and_the_publisher_write_today():
    built = fx.build_all()
    if os.environ.get("UPDATE_MINUTE_FRAME_FIXTURES") == "1":
        fx.write_all()
    def on_disk(n):
        b = (fx.FIXTURE_DIR / n).read_bytes()
        return b.replace(b"\r\n", b"\n") if n.endswith(".json") else b      # .bin is binary (.gitattributes)

    stale = [n for n, data in built.items() if not (fx.FIXTURE_DIR / n).exists() or on_disk(n) != data]
    assert not stale, f"fixtures out of date (UPDATE_MINUTE_FRAME_FIXTURES=1 regenerates): {stale}"


def test_day_fixture_frames_carry_the_late_bar_and_the_exact_correction():
    raw = (fx.FIXTURE_DIR / "day_regular.today.bin").read_bytes()
    t = mf.decode_today(raw)
    kinds = [b["kind"] for f in t["frames"] for b in f["blocks"] if b["kind"]]
    assert sorted(kinds) == [mf.KIND_LATE, mf.KIND_REPLACE]
    assert [f["seq"] for f in t["frames"]] == list(range(960))
    assert all(f["prev_seq"] == (f["seq"] - 1 if f["seq"] else mf.NO_SEQ) for f in t["frames"])


def test_daily_day_fixture_each_epochs_first_post_close_frame_carries_every_row():
    """What the device's trust rule (app/src/lib/minuteFrames/consumer.js, DAILY) stands on, read from frames the
    real Publisher wrote: no section before the close; an epoch's FIRST section holds every row the feed has; every
    later one only rows that changed; the restart is a new epoch whose first frame links to the last published one
    (a hole the publisher has, which loses no row) and carries every row again."""
    t = mf.decode_today((fx.FIXTURE_DIR / "day_daily.today.bin").read_bytes())
    close = mfp.regular_close_seq(20261119)
    frames = t["frames"]
    assert all("daily" not in f for f in frames if f["seq"] < close)
    with_daily = [f for f in frames if "daily" in f]
    assert with_daily[0]["seq"] == close
    epochs = sorted({f["epoch"] for f in with_daily})
    assert len(epochs) == 2
    for ep in epochs:
        mine = [f for f in with_daily if f["epoch"] == ep]
        first = mine[0]
        held = dict(first["daily"])
        assert set(first["daily"]) >= {"DENSE", "THIN", "RTHONLY", "BRK-B", "SUBPENNY"}
        for f in mine[1:]:
            assert all(held.get(s) != r for s, r in f["daily"].items()), f["seq"]   # only changes ride
            held.update(f["daily"])
    second = next(f for f in frames if f["epoch"] == epochs[1])
    before = [f for f in frames if f["seq"] < second["seq"]][-1]
    assert second["prev_seq"] == before["seq"] and second["seq"] > before["seq"] + 1
    assert set(next(f for f in with_daily if f["epoch"] == epochs[1])["daily"]) == set(fx.daily_feed(20261119, fx.DAILY_RESTART[1]))


def test_status_carries_the_publisher_only_when_on(monkeypatch):
    monkeypatch.delenv("MINUTE_FRAMES_ENABLED", raising=False)
    assert "minute_frames" not in bars_live_ingest.status()
    monkeypatch.setenv("MINUTE_FRAMES_ENABLED", "1")
    mfp._reset_for_tests()
    assert bars_live_ingest.status()["minute_frames"] == {"enabled": True, "running": False}


def test_a_stray_old_bar_at_startup_never_waits_in_memory_forever():
    r2, clock = R2(), {"ms": 0}
    m0 = fx._unix(DAY, 10, 0) // 60
    clock["ms"] = (m0 + 1) * 60000                  # the process comes up at 10:01
    pub = _pub(r2, clock)
    pub.on_am("OLD", _am(m0 - 10))                  # ten minutes old: never published, never held
    pub.on_am("AAPL", _am(m0))
    _run_to(pub, clock, (m0 + 1) * 60 + 5)
    assert pub.pending == {} and pub.stats["too_late"] == 1
    assert sorted(k[-8:] for k in r2.objects if k.endswith(".bin") and "today" not in k) == ["1000.bin"]


# ── the DAILY section after the close (MINUTE_FRAMES_WITH_DAILY) ────────────────────

def test_the_daily_section_round_trips_exactly_and_is_absent_unless_given():
    m = 29_000_000
    daily = {"AAPL": (342.865, 344.34, 340.24, 342.845, 77589154.0),
             "ONLYDAILY": (1.0 / 3.0, 0.5, 0.25, 0.4, 12.0),              # no exact scale: float64
             "BRK-B": (570.0, 571.25, 568.5, 570.0, 6608999.0)}
    raw = mf.encode_frame(day=20261120, seq=720, prev_seq=719, epoch=1, minute=m,
                          blocks=[(m, mf.KIND_ONTIME, {"AAPL": (342.9, 343.0, 342.8, 342.95, 1000.0)})],
                          daily=daily)
    fr = mf.decode_frame(mf.gzip_bytes(raw))
    assert fr["flags"] & mf.FLAG_DAILY
    assert set(fr["daily"]) == set(daily)
    for sym, row in daily.items():
        assert all(_same_bits(a, b) for a, b in zip(fr["daily"][sym], row)), sym
    assert fr["blocks"][0]["rows"]["AAPL"][3] == 342.95                     # the minute block is untouched
    for none in (None, {}):
        plain = mf.decode_frame(mf.encode_frame(day=20261120, seq=720, prev_seq=719, epoch=1, minute=m,
                                                blocks=[(m, mf.KIND_ONTIME, {})], daily=none))
        assert "daily" not in plain and not plain["flags"] & mf.FLAG_DAILY


def test_a_reader_that_ignores_the_daily_flag_refuses_the_frame_never_misreads_it():
    m = 29_000_000
    raw = bytearray(mf.encode_frame(day=20261120, seq=720, prev_seq=719, epoch=1, minute=m,
                                    blocks=[(m, mf.KIND_ONTIME, {"A": (1.0, 1.0, 1.0, 1.0, 1.0)})],
                                    daily={"A": (1.0, 2.0, 0.5, 1.5, 9.0)}))
    raw[5] &= ~mf.FLAG_DAILY & 0xFF                                     # a reader blind to the flag
    raw[-4:] = struct.pack("<I", __import__("zlib").crc32(bytes(raw[:-4])) & 0xFFFFFFFF)
    with pytest.raises(mf.FrameError, match="trailing"):
        mf.decode_frame(bytes(raw))


class _Daily:
    def __init__(self, rows=None, day=None):
        self.rows, self.day, self.asked = rows or {}, day, []

    def __call__(self, day):
        self.asked.append(day)
        return dict(self.rows) if self.day in (None, day) else None


def test_frames_carry_the_server_daily_rows_from_the_close_all_first_then_changes():
    r2, clock = R2(), {"ms": 0}
    feed = _Daily({"AAPL": (1.0, 2.0, 0.5, 1.5, 100.0), "MSFT": (3.0, 4.0, 2.5, 3.5, 200.0)})
    pub = _pub(r2, clock, daily=feed)
    m0 = fx._unix(DAY, 15, 58) // 60
    clock["ms"] = (m0 + 1) * 60000
    pub.on_am("AAPL", _am(m0))
    _run_to(pub, clock, (m0 + 2) * 60 + 5)                         # 15:58 and 15:59: before the close
    _run_to(pub, clock, (m0 + 3) * 60 + 5)                         # 16:00: every symbol
    _run_to(pub, clock, (m0 + 4) * 60 + 5)                         # 16:01: nothing changed
    feed.rows["MSFT"] = (3.0, 4.5, 2.5, 4.25, 260.0)
    _run_to(pub, clock, (m0 + 5) * 60 + 5)                         # 16:02: only MSFT
    got = {k[-8:-4]: mf.decode_frame(v).get("daily") for k, v in r2.objects.items()
           if k.endswith(".bin") and "today" not in k}
    assert got["1558"] is None and got["1559"] is None
    assert got["1600"] == {"AAPL": (1.0, 2.0, 0.5, 1.5, 100.0), "MSFT": (3.0, 4.0, 2.5, 3.5, 200.0)}
    assert got["1601"] is None
    assert got["1602"] == {"MSFT": (3.0, 4.5, 2.5, 4.25, 260.0)}
    # replaying today.bin in order gives the newest row per symbol
    today = mf.decode_today(pub.today.snapshot())                   # every frame of the day so far
    newest = {}
    for f in today["frames"]:
        newest.update(f.get("daily") or {})
    assert newest["MSFT"][3] == 4.25 and newest["AAPL"][3] == 1.5


def test_a_half_day_closes_at_1300_and_a_restart_sends_every_row_again():
    assert mfp.regular_close_seq(20261127) == 13 * 60 - 240 and mfp.regular_close_seq(20261120) == 16 * 60 - 240
    r2, clock = R2(), {"ms": 0}
    feed = _Daily({"AAPL": (1.0, 2.0, 0.5, 1.5, 100.0)})
    pub = _pub(r2, clock, daily=feed)
    m0 = fx._unix("2026-11-27", 12, 59) // 60
    clock["ms"] = (m0 + 1) * 60000
    pub.on_am("AAPL", _am(m0))
    built = _run_to(pub, clock, (m0 + 2) * 60 + 5)
    assert [f["daily"] for f in built] == [None, {"AAPL": (1.0, 2.0, 0.5, 1.5, 100.0)}]   # 12:59, 13:00
    assert pub.status()["daily_feed"] is None and pub.status()["with_daily"] is True
    pub.start_day(pub.load_day(20261127))                           # a new epoch's start forgets what was sent
    assert pub._daily_rows(20261127, mfp.regular_close_seq(20261127) + 5) == {"AAPL": (1.0, 2.0, 0.5, 1.5, 100.0)}


def test_without_the_feed_or_its_rows_a_frame_has_no_daily_section():
    assert _pub(R2(), {"ms": 0})._daily_rows(20261120, 800) is None
    pub = _pub(R2(), {"ms": 0}, daily=_Daily({"A": (1.0, 1.0, 1.0, 1.0, 1.0)}, day=20261119))
    assert pub._daily_rows(20261120, 800) is None                    # rows for another day are never used
    boom = _pub(R2(), {"ms": 0}, daily=lambda day: (_ for _ in ()).throw(RuntimeError("down")))
    assert boom._daily_rows(20261120, 800) is None


def test_the_daily_rows_are_bars_apis_own_parse_of_the_snapshot():
    snap = {"tickers": [{"ticker": "BRK.B", "day": {"o": 570, "h": 571.25, "l": 568.5, "c": 570, "v": 6608999.7}},
                        {"ticker": "PRE", "day": {"o": 0, "h": 0, "l": 0, "c": 0, "v": 0}},
                        {"ticker": "BCpC", "day": {"o": 20.5, "h": 21, "l": 20, "c": 20.55, "v": 10}}]}
    assert mfp.snapshot_daily_rows(snap, 20261120) == {"BRK-B": (570.0, 571.25, 568.5, 570.0, 6608999)}
    import inspect
    assert "daily_rows_from_snapshot" in inspect.getsource(mfp.snapshot_daily_rows)


def test_the_child_hands_over_every_row_once_then_only_changes_and_starts_over_each_day():
    state, a, b = {}, (1.0, 2.0, 0.5, 1.5, 100), (3.0, 4.0, 2.5, 3.5, 200)
    assert mfp.daily_changes(state, None) is None
    assert mfp.daily_changes(state, (20261120, {"A": a, "B": b})) == (20261120, {"A": a, "B": b})
    assert mfp.daily_changes(state, (20261120, {"A": a, "B": b})) is None
    assert mfp.daily_changes(state, (20261120, {"A": a, "B": b[:4] + (260,)})) == (20261120, {"B": b[:4] + (260,)})
    assert mfp.daily_changes(state, (20261123, {"A": a})) == (20261123, {"A": a})


def test_the_daily_feed_merges_the_changes_into_its_day_and_never_mutates_a_handed_out_dict():
    feed = mfp.DailyFeed(start_child=False)
    assert feed(20261120) is None
    feed.report((20261120, {"A": (1.0, 1.0, 1.0, 1.0, 1.0), "B": (2.0, 2.0, 2.0, 2.0, 2.0)}))
    held = feed(20261120)
    feed.report((20261120, {"B": (2.0, 2.5, 2.0, 2.5, 9.0)}))
    feed.report(("err", "provider down"))
    assert feed(20261120) == {"A": (1.0, 1.0, 1.0, 1.0, 1.0), "B": (2.0, 2.5, 2.0, 2.5, 9.0)}
    assert held["B"] == (2.0, 2.0, 2.0, 2.0, 2.0)                    # the dict an encode was iterating is untouched
    assert feed(20261121) is None and feed.counts == {"reports": 2, "errors": 1}
    feed.report((20261123, {"C": (5.0, 5.0, 5.0, 5.0, 5.0)}))      # a new day starts empty
    assert feed(20261123) == {"C": (5.0, 5.0, 5.0, 5.0, 5.0)} and feed(20261120) is None


def test_the_daily_feed_starts_only_with_its_flag(monkeypatch):
    started = []

    class _Fake:
        def __init__(self, *a, **k):
            started.append(1)

        def __call__(self, day):
            return None
    monkeypatch.setattr(mfp, "DailyFeed", _Fake)
    monkeypatch.delenv("MINUTE_FRAMES_WITH_DAILY", raising=False)
    mfp._reset_for_tests()
    assert mfp.publisher().daily is None and started == []
    monkeypatch.setenv("MINUTE_FRAMES_WITH_DAILY", "1")
    mfp._reset_for_tests()
    assert isinstance(mfp.publisher().daily, _Fake) and started == [1]
    mfp._reset_for_tests()


def test_the_poll_reads_today_only_after_the_close_and_only_once_the_session_opened(monkeypatch):
    from api.services import massive, massive_adapter
    calls, opened = [], {"v": True}
    snap = {"tickers": [{"ticker": "AAPL", "day": {"o": 1, "h": 2, "l": 0.5, "c": 1.5, "v": 100}}]}

    class _R:
        value = snap
    monkeypatch.setattr(massive_adapter, "get", lambda path, **k: calls.append(path) or _R())
    monkeypatch.setattr(massive, "_regular_session_has_opened_today", lambda: opened["v"])
    at = lambda h, m: fx._unix("2026-11-20", h, m)                          # noqa: E731
    assert mfp.poll_daily_once(at(15, 59)) is None and calls == []          # before the close: no read
    assert mfp.poll_daily_once(at(16, 0)) == (20261120, {"AAPL": (1.0, 2.0, 0.5, 1.5, 100)})
    assert mfp.poll_daily_once(at(20, 0)) is None and len(calls) == 1       # 20:00 is outside the session
    opened["v"] = False                                                     # a holiday: the snapshot is the prior session
    assert mfp.poll_daily_once(at(17, 0)) is None and len(calls) == 1
    assert mfp.poll_daily_once(fx._unix("2026-11-27", 13, 0)) is None       # half day, but not opened (stub)
    opened["v"] = True
    assert mfp.poll_daily_once(fx._unix("2026-11-27", 13, 0))[0] == 20261127
    assert mfp.poll_daily_once(fx._unix("2026-11-27", 12, 59)) is None


def test_the_browser_decoder_knows_every_flag_the_encoder_can_set():
    """ONE FACT IN TWO FILES: a flag bit the publisher can set and codec.js does not know is a frame every device
    refuses (consumer.js applies it as a gap). So a new FLAG_* here goes red until the browser decoder reads it,
    BEFORE anything arms it on stream-ingest. Parsed from codec.js, never restated."""
    import re
    js = (ROOT / "app" / "src" / "lib" / "minuteFrames" / "codec.js").read_text(encoding="utf-8")
    js_flags = {m[1]: int(m[2], 16) for m in re.finditer(r"export const (FLAG_[A-Z_]+) = 0x([0-9A-Fa-f]+)", js)}
    py_flags = {k: v for k, v in vars(mf).items() if k.startswith("FLAG_") and isinstance(v, int)}
    assert py_flags and js_flags == py_flags, (js_flags, py_flags)
    known = re.search(r"export const KNOWN_FLAGS = ([A-Z_ |]+)\n", js)[1]
    assert {s.strip() for s in known.split("|")} == set(py_flags), known


def test_the_monday_check_reads_the_newest_daily_row_per_symbol_from_the_frames():
    from tools import forming_daily_check as chk
    assert chk.FLAG_DAILY == mf.FLAG_DAILY
    m = fx._unix("2026-11-20", 16, 0) // 60

    def frame(minute, daily):
        return mf.decode_frame(mf.encode_frame(day=20261120, seq=720, prev_seq=719, epoch=1, minute=minute,
                                               blocks=[(minute, mf.KIND_ONTIME, {})], daily=daily))
    frames = [frame(m - 1, None), frame(m, {"AAPL": (1.0, 2.0, 0.5, 1.5, 100.0), "MSFT": (3.0, 3.0, 3.0, 3.0, 1.0)}),
              frame(m + 1, None), frame(m + 2, {"AAPL": (1.0, 2.0, 0.5, 1.75, 140.0)})]
    got = chk.daily_rows(frames, {"AAPL"})
    assert got == {"AAPL": ((1.0, 2.0, 0.5, 1.75, 140.0), 16 * 60 + 2)}


def test_the_daily_rows_are_read_on_the_encode_thread_never_in_tick():
    r2, clock = R2(), {"ms": 0}
    feed = _Daily({"AAPL": (1.0, 2.0, 0.5, 1.5, 100.0)})
    pub = _pub(r2, clock, daily=feed)
    m0 = fx._unix(DAY, 16, 0) // 60
    clock["ms"] = (m0 + 1) * 60000
    pub.on_am("AAPL", _am(m0))
    clock["ms"] = (m0 + 1) * 60000 + 5000
    pub.start_day(pub.load_day(pub.day_needed()))
    assert len(pub.tick()) == 1 and feed.asked == []                 # the loop thread built the frame alone
    pub.encode_pending()
    assert feed.asked == [20261118]
