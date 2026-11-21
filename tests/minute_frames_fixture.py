"""Builds the cross-language fixtures for universe minute frames (tests/fixtures/minute_frames/).

Everything here is SYNTHETIC (seeded random walks): no vendor data is ever written to the repo.

* `codec_cases.json` + `codec_<name>.bin`: frames written by the Python encoder, with the exact
  values each must decode to. app/src/lib/minuteFrames/codec.test.js decodes the .bin files and
  compares (and edge/bars-edge-router/live1m.test.mjs serves one through the Worker).
* `day_<name>.today.bin` + `day_<name>.json`: a whole session's frames as the REAL publisher
  (`minute_frame_publisher.Publisher`, fake clock and R2) wrote them, and, for every symbol and
  timeframe, the bars the SERVER's own bucketing makes of the minutes those frames carry
  (`bar_rollup.tv_bucket_bounds` + `bar_rollup.aggregate`; D by the documented daily rule).
  app/src/lib/minuteFrames/rollup.test.js replays the frames through the browser's rollup and
  must get exactly these bars.
* `day_daily.today.bin` + `day_daily.json`: a day whose frames carry the DAILY section after the close
  (FLAG_DAILY: a synthetic server daily feed handed to the real Publisher), with a publisher restart
  after the close (a new epoch: every row again), and every DAILY section as Python decodes it. The
  device's consumer and overlay (app/src/lib/minuteFrames/consumer.test.js, deviceStore/live.test.js)
  must end with exactly the newest row per symbol.

Regenerate (only when the format or the rules change on purpose):
    UPDATE_MINUTE_FRAME_FIXTURES=1 python -m pytest tests/test_minute_frames.py -q
"""
from __future__ import annotations

import json
import random
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from api.services import bar_rollup
from api.services import minute_frame_publisher as mfp
from api.services import minute_frames as mf

FIXTURE_DIR = Path(__file__).resolve().parent / "fixtures" / "minute_frames"
ET = ZoneInfo("America/New_York")
ROLLUP_TFS = ("1", "5", "15", "30", "60", "60e", "D")


# ── codec cases ──────────────────────────────────────────────────────────────────

def codec_cases() -> list:
    """(name, kwargs for encode_frame). Each one exercises a branch of the format."""
    m = 29_400_000      # an arbitrary unix minute (2025-11-23 ...); the codec does no clock math
    plain = {
        "A": (173.6, 173.6, 173.6, 173.6, 406.0),
        "AA": (35.12, 35.2, 35.01, 35.15, 120034.0),
        "AAPL": (150.2345, 150.5, 150.0, 150.25, 12345.0),
        "BRK-A": (712345.67, 712400.0, 712300.5, 712390.0, 3.0),
        "BRK-B": (412.1, 412.2, 411.9, 412.0, 100.5),            # fractional volume
        "PENNY": (0.00012345, 0.0001235, 0.0001234, 0.00012345, 1e10),   # 8 decimals, huge volume
        "RAWP": (0.1 + 0.2, 1.0, 0.1, 0.5, 7.0),                 # not exact at any scale: float64
        "RAWV": (10.0, 10.5, 9.5, 10.25, 1.0 / 3.0),              # volume raw
        "ODD": (10.0, 10.5, 9.8, 11.0, 50.0),                     # high below close (vendor glitch)
        "ZERO": (5.0, 5.0, 5.0, 5.0, 0.0),
        "ZZZZZZZZZZ": (1.5, 1.75, 1.25, 1.5, 999.0),
    }
    return [
        ("plain", dict(day=20261118, seq=330, prev_seq=329, epoch=1795000000, minute=m,
                       blocks=[(m, mf.KIND_ONTIME, plain)])),
        ("empty_first", dict(day=20261118, seq=0, prev_seq=mf.NO_SEQ, epoch=7, minute=m,
                             blocks=[(m, mf.KIND_ONTIME, {})])),
        ("late_replace_incomplete", dict(
            day=20261118, seq=400, prev_seq=398, epoch=7, minute=m, complete=False,
            blocks=[(m, mf.KIND_ONTIME, {"AAPL": plain["AAPL"]}),
                    (m - 2, mf.KIND_LATE, {"THIN": (3.21, 3.25, 3.2, 3.22, 900.0)}),
                    (m - 1, mf.KIND_REPLACE, {"AAPL": (150.0, 150.1, 149.9, 150.05, 777.0)})])),
        ("with_av", dict(
            day=20261118, seq=331, prev_seq=330, epoch=7, minute=m, with_av=True,
            blocks=[(m, mf.KIND_ONTIME, {"AAPL": plain["AAPL"] + (5_000_000.0,),
                                          "BRK-B": plain["BRK-B"] + (1234.5,),
                                          "NOAV": (2.0, 2.0, 2.0, 2.0, 1.0, None),
                                          "RAWV": plain["RAWV"] + (10.0 / 3.0,)})])),
        # FLAG_DAILY: the server's day rows after the close, symbols that are in no block included
        ("daily", dict(
            day=20261118, seq=720, prev_seq=719, epoch=7, minute=m,
            blocks=[(m, mf.KIND_ONTIME, {"AAPL": plain["AAPL"], "ZERO": plain["ZERO"]})],
            daily={"AAPL": (150.01, 151.25, 149.5, 150.37, 51_234_567.0),
                   "BRK-B": (412.1, 414.0, 411.5, 413.2, 3_000_000.0),
                   "ONLYDAY": (12.5, 12.75, 12.25, 12.5, 8.0),
                   "PENNY": (0.00012345, 0.0001235, 0.0001234, 0.00012345, 1e10),
                   "RAWP": (0.1 + 0.2, 1.0, 0.1, 0.5, 7.0)})),
        ("daily_with_av", dict(
            day=20261118, seq=721, prev_seq=720, epoch=7, minute=m, with_av=True,
            blocks=[(m, mf.KIND_ONTIME, {"AAPL": plain["AAPL"] + (51_240_000.0,)})],
            daily={"AAPL": (150.01, 151.25, 149.5, 150.37, 51_240_000.0)})),
        ("daily_only", dict(
            day=20261118, seq=722, prev_seq=721, epoch=7, minute=m,
            blocks=[(m, mf.KIND_ONTIME, {})],
            daily={"ZZZZZZZZZZ": (1.5, 1.75, 1.25, 1.5, 1000.0)})),
    ]


def _rows_json(rows: dict) -> dict:
    return {s: list(r) for s, r in rows.items()}


def build_codec_fixtures() -> dict:
    """{filename: bytes} for every codec fixture file."""
    out = {}
    cases = []
    for name, kw in codec_cases():
        raw = mf.encode_frame(**kw)
        out[f"codec_{name}.bin"] = raw
        cases.append({
            "name": name, "file": f"codec_{name}.bin",
            "header": {"day": kw["day"], "seq": kw["seq"], "prevSeq": kw["prev_seq"] & 0xFFFFFFFF,
                       "epoch": kw["epoch"], "minute": kw["minute"],
                       "complete": kw.get("complete", True), "withAv": kw.get("with_av", False)},
            "blocks": [{"minute": bm, "kind": k, "rows": _rows_json(rows)} for bm, k, rows in kw["blocks"]],
            **({"daily": _rows_json(kw["daily"])} if kw.get("daily") else {}),
        })
    out["codec_cases.json"] = (json.dumps({"cases": cases}, indent=1, sort_keys=True) + "\n").encode()
    return out


# ── whole days through the real publisher ────────────────────────────────────────

def _unix(day: str, hh: int, mm: int, ss: int = 0) -> int:
    y, mo, d = map(int, day.split("-"))
    return int(datetime(y, mo, d, hh, mm, ss, tzinfo=ET).timestamp())


def synthetic_minutes(day: str, seed: int) -> dict:
    """{unix_minute: {sym: (o, h, l, c, v)}} for 04:00-19:59 ET. DENSE trades every minute,
    THIN about one minute in four, RTHONLY only 09:30-15:59 (the regular session of a full day)."""
    rnd = random.Random(seed)
    price = {"DENSE": 100.0, "THIN": 7.5, "RTHONLY": 42.0}
    out: dict = {}
    for mod in range(4 * 60, 20 * 60):
        minute = _unix(day, mod // 60, mod % 60) // 60
        rows = {}
        for sym in ("DENSE", "THIN", "RTHONLY"):
            if sym == "THIN" and rnd.random() > 0.25:
                continue
            if sym == "RTHONLY" and not (570 <= mod < 960):
                continue
            o = round(price[sym], 2)
            c = round(max(0.5, o + rnd.choice((-3, -2, -1, 0, 0, 1, 2, 3)) * 0.01), 2)
            h = round(max(o, c) + rnd.choice((0, 0, 1, 2)) * 0.01, 2)
            lo = round(min(o, c) - rnd.choice((0, 0, 1, 2)) * 0.01, 2)
            v = float(rnd.randrange(1, 5000) * 100)
            price[sym] = c
            rows[sym] = (o, h, lo, c, v)
        out[minute] = rows
    return out


class _FakeR2:
    def __init__(self):
        self.objects: dict = {}
        self.order: list = []

    def put(self, key, body, ctype):
        self.objects[key] = bytes(body)
        self.order.append(key)
        return True

    def get(self, key):
        return self.objects.get(key)


def run_publisher_day(day: str, minutes: dict, *, late=(), replace=(), down=(), restart=None,
                      grace_s: float = 5.0, roll_every: int = 5, daily=None) -> tuple:
    """Drive the real Publisher over a session with a fake clock and R2.

    late:    [(sym, minute)]: that bar is held back and delivered 30 s after its frame is out
    replace: [(sym, minute, row)]: a corrected bar delivered 20 s after the minute's frame
    down:    [(from_unix_s, to_unix_s)]: the vendor socket is not live (bars emitted then are lost)
    restart: (from_unix_s, to_unix_s): the publisher process is gone; a new one (new epoch)
             starts at to_unix_s and resumes today.bin from R2
    daily:   (day, now_s) -> {sym: (o, h, l, c, v)} or None: the server's daily rows as of now_s
             (the Publisher's `daily` feed; the publisher itself decides when they ride)
    Returns (r2, delivered) where delivered = {minute: {sym: row}} is what members received."""
    r2 = _FakeR2()
    clock = {"ms": 0}

    def is_live():
        s = clock["ms"] // 1000
        return not any(a <= s < b for a, b in down)

    def make(epoch):
        feed = None if daily is None else (lambda d: daily(d, clock["ms"] // 1000))
        return mfp.Publisher(put=r2.put, get=r2.get, live=is_live, grace_s=grace_s,
                             roll_every=roll_every, epoch=epoch, now_ms=lambda: clock["ms"],
                             prefix="live1m/", daily=feed)

    pub = None
    late_set = set(late)
    held = []        # (deliver_at_s, sym, bar)
    first = min(minutes)
    last = max(minutes)
    start_s = first * 60 - 2
    pub = make(1)
    for s in range(start_s, (last + 1) * 60 + 90):
        clock["ms"] = s * 1000
        if restart and restart[0] <= s < restart[1]:
            pub = None
            held = [h for h in held if h[0] > s]
            continue
        if restart and s == restart[1]:
            pub = make(2)
            pub.note_connected(clock["ms"])
        # AM bars for minute M arrive at M's end + 1 s (unless the socket is down then)
        if s % 60 == 1:
            m = s // 60 - 1
            if m in minutes and is_live():
                for sym, row in minutes[m].items():
                    if (sym, m) in late_set:
                        held.append((s + 35, sym, row, m))
                        continue
                    pub.on_am(sym, {"t": m * 60000, "o": row[0], "h": row[1], "l": row[2], "c": row[3], "v": row[4]})
        for h in [h for h in held if h[0] == s]:
            held.remove(h)
            if pub is not None and is_live():
                _, sym, row, m = h
                pub.on_am(sym, {"t": m * 60000, "o": row[0], "h": row[1], "l": row[2], "c": row[3], "v": row[4]})
        for sym, m, row in replace:
            if s == (m + 1) * 60 + 20 and pub is not None:
                pub.on_am(sym, {"t": m * 60000, "o": row[0], "h": row[1], "l": row[2], "c": row[3], "v": row[4]})
        if pub is not None:
            day_needed = pub.day_needed()
            if day_needed is not None:
                pub.start_day(pub.load_day(day_needed))
            if pub.tick():
                pub.encode_pending()
            pub.flush_uploads()
    # what the frames carried, minute by minute, after late/replace blocks are applied in order
    delivered: dict = {}
    t = r2.objects.get(f"live1m/{day}/today.bin")
    for fr in mf.decode_today(t)["frames"]:
        for blk in fr["blocks"]:
            delivered.setdefault(blk["minute"], {}).update(blk["rows"])
    return r2, delivered


def server_buckets(delivered: dict, day_ymd: int) -> dict:
    """{sym: {tf: [[t, o, h, l, c, v], ...]}} by the SERVER's bucketing: bar_rollup.tv_bucket_bounds
    (rth grid for 1/5/15/30/60, eth grid for 60e) and bar_rollup.aggregate in time order. D: the ET
    date (t = UTC midnight of it), O/H/L/C over regular-session minutes only, V = every minute."""
    close_min = bar_rollup._rth_close_min(day_ymd)
    per: dict = {}
    for minute in sorted(delivered):
        t_ms = minute * 60000
        dt = datetime.fromtimestamp(minute * 60, tz=ET)
        mod = dt.hour * 60 + dt.minute
        rth = 570 <= mod < close_min
        for sym, row in delivered[minute].items():
            o, h, lo, c, v = row[:5]
            bar = {"t": t_ms, "o": o, "h": h, "l": lo, "c": c, "v": v}
            for tf in ROLLUP_TFS:
                if tf == "D":
                    key = int(datetime(dt.year, dt.month, dt.day).replace(tzinfo=ZoneInfo("UTC")).timestamp())
                    d = per.setdefault(sym, {}).setdefault("D", {})
                    cur = d.get(key) or {"t": key, "o": None, "h": None, "l": None, "c": None, "v": 0.0}
                    if rth:
                        if cur["o"] is None:
                            cur.update(o=o, h=h, l=lo)
                        cur["h"] = max(cur["h"], h)
                        cur["l"] = min(cur["l"], lo)
                        cur["c"] = c
                    cur["v"] += v
                    d[key] = cur
                    continue
                rtf, sess = ("60", "eth") if tf == "60e" else (tf, "rth")
                start, _end = bar_rollup.tv_bucket_bounds(t_ms, rtf, sess)
                b = per.setdefault(sym, {}).setdefault(tf, {})
                prev = b.get(start)
                agg = bar_rollup.aggregate(prev, {**bar, "t": start})
                b[start] = agg
    out: dict = {}
    for sym, tfs in per.items():
        for tf, bars in tfs.items():
            rows = []
            for k in sorted(bars):
                b = bars[k]
                if tf == "D":
                    if b["o"] is None:
                        continue
                    rows.append([b["t"], b["o"], b["h"], b["l"], b["c"], b["v"]])
                else:
                    rows.append([b["t"] // 1000, b["o"], b["h"], b["l"], b["c"], b["v"]])
            out.setdefault(sym, {})[tf] = rows
    return out


DAYS = {
    # a regular day, with a late bar and an exact correction riding the frames
    "regular": dict(day="2026-11-18", seed=11),
    # the day after Thanksgiving: a 13:00 close, so the session 60m grid ends 12:30-13:00
    "halfday": dict(day="2026-11-27", seed=27),
}


def _day_events(name: str, minutes: dict, day: str):
    late, replace = (), ()
    if name == "regular":
        m_late = _unix(day, 10, 7) // 60
        m_rep = _unix(day, 11, 31) // 60
        o, h, lo, c, v = minutes[m_rep]["DENSE"]
        late = (("DENSE", m_late),)
        # same extremes, new close inside them and a new volume: an EXACT correction
        replace = (("DENSE", m_rep, (o, h, lo, round((h + lo) / 2, 3), v + 1234.0)),)
    return late, replace


DAILY_DAY = "2026-11-19"
# the restart: the publisher is gone 17:00:00-17:03:00, a new epoch resumes (every DAILY row again)
DAILY_RESTART = (_unix(DAILY_DAY, 17, 0), _unix(DAILY_DAY, 17, 3))


def daily_feed(day: int, now_s: int):
    """A synthetic server daily feed (what bars-api's snapshot `day` rows would be) as of `now_s`: the
    official close differs from the last regular minute's, the volume is the consolidated day's and keeps
    growing after hours, BRK-B has no minute bar at all, LATECOMER's row first appears at 16:30."""
    if day != int(DAILY_DAY.replace("-", "")):
        return None
    after = max(0, now_s - _unix(DAILY_DAY, 16, 0))
    steps = min(after // 300, 24)                    # a new after-hours print every 5 minutes, until 18:00
    rows = {
        "DENSE": (100.0, 101.5, 98.25, 100.37, 1_234_500.0 + 1000.0 * steps),
        "THIN": (7.5, 7.61, 7.42, 7.55, 52_300.0),
        "RTHONLY": (42.0, 42.3, 41.8, 42.11, 880_000.0),
        "BRK-B": (412.1, 414.0, 411.5, 413.2, 3_000_000.0 + 100.0 * (steps // 3)),
        "SUBPENNY": (0.12345678, 0.1235, 0.12341, 0.12345679, 98_765_432.0),
    }
    if now_s >= _unix(DAILY_DAY, 16, 30):
        rows["LATECOMER"] = (3.0, 3.1, 2.9, 3.05, 1000.0)
    return rows


def build_daily_day_fixture() -> dict:
    day = DAILY_DAY
    minutes = synthetic_minutes(day, 19)
    r2, _delivered = run_publisher_day(day, minutes, restart=DAILY_RESTART, daily=daily_feed)
    today = mf.maybe_gunzip(r2.objects[f"live1m/{day}/today.bin"])
    t = mf.decode_today(today)
    sections = [[f["seq"], f["epoch"], f["prev_seq"], _rows_json(f["daily"])] for f in t["frames"] if "daily" in f]
    final: dict = {}
    for _seq, _ep, _prev, rows in sections:
        final.update(rows)
    return {
        "day_daily.today.bin": today,
        "day_daily.json": (json.dumps({"day": day, "frames": len(t["frames"]), "restart": list(DAILY_RESTART),
                                       "daily_sections": sections, "daily_final": final},
                                      sort_keys=True, separators=(",", ":")) + "\n").encode(),
    }


def build_day_fixtures() -> dict:
    out = {}
    for name, cfg in DAYS.items():
        day = cfg["day"]
        minutes = synthetic_minutes(day, cfg["seed"])
        late, replace = _day_events(name, minutes, day)
        r2, delivered = run_publisher_day(day, minutes, late=late, replace=replace)
        ymd = int(day.replace("-", ""))
        expected = server_buckets(delivered, ymd)
        today = mf.maybe_gunzip(r2.objects[f"live1m/{day}/today.bin"])
        out[f"day_{name}.today.bin"] = today
        out[f"day_{name}.json"] = (json.dumps({
            "day": day, "frames": mf.decode_today(today)["seq"] + 1,
            "late": [[s, m] for s, m in late], "replace": [[s, m, list(r)] for s, m, r in replace],
            "expected": expected}, sort_keys=True, separators=(",", ":")) + "\n").encode()
    return out


def build_all() -> dict:
    return {**build_codec_fixtures(), **build_day_fixtures(), **build_daily_day_fixture()}


def write_all() -> list:
    FIXTURE_DIR.mkdir(parents=True, exist_ok=True)
    written = []
    for name, data in build_all().items():
        (FIXTURE_DIR / name).write_bytes(data)
        written.append(name)
    return written
