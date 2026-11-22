"""Universe minute frames, PUBLISHER side (stream-ingest): one frame a minute to R2.

The goal (owner's #1 priority): any stock, any timeframe, opened at random, draws from the
member's DEVICE in under 20 ms. A first-frame seed covers everything up to the last close; this
keeps every device current to the minute DURING the session, for EVERY symbol, not only the ones
on screen. stream-ingest already receives the whole market's minute bars (`AM.*`, the universe
feed `bars_live_ingest` forwards to bars-api); this module packs each minute's bars into one
compact frame (`minute_frames`, the format) and puts it in R2, where the edge Worker serves it
to entitled members (`edge/bars-edge-router/live1m.js`). Browsers poll it once a minute
(`app/src/lib/minuteFrames/`). Why R2 + the edge rather than a broadcast channel on
stream-edge: `docs/plans/2026-11-20-universe-minute-frames.md`.

OFF unless `MINUTE_FRAMES_ENABLED=1` (and it only ever runs where the universe feed runs:
`BARS_UNIVERSE_STREAM_ENABLED=1`). Off, `bars_live_ingest.universe_am_handler()` hands
bar_stream the very same `on_am` it always had and nothing here is ever called.

R2 OBJECTS (prefix `MINUTE_FRAMES_PREFIX`, default `live1m/`; bucket `MINUTE_FRAMES_BUCKET`,
default `DATA_SYNC_BUCKET`; the DATA_SYNC_* credentials every other R2 write uses):
    live1m/<YYYY-MM-DD>/<HHMM>.bin   one frame, gzip, written ONCE (immutable)
    live1m/<YYYY-MM-DD>/today.bin    every frame of the day so far, gzip, rewritten every
                                     `MINUTE_FRAMES_ROLL_EVERY` frames (default 5)
    live1m/<YYYY-MM-DD>/head.json    {"day", "seq", "hhmm", "today_seq", "epoch", "at_ms"},
                                     rewritten after each frame (written AFTER the frame, so it
                                     never names a frame that is not there)

WHEN A FRAME IS PUBLISHED. Massive sends minute M's AM bar just after M closes. The frame for
M is built `MINUTE_FRAMES_GRACE_S` (default 5 s) after M's end, then every minute after it in
the 04:00-20:00 ET session is published, EMPTY when nothing traded: an empty frame is the
statement "nothing arrived in this minute", which is what makes a missing one detectable.

LATE AND CORRECTED BARS. An AM bar for a minute whose frame is already out rides in the NEXT
frame: as a LATE block if that (symbol, minute) was never published, or a REPLACE block if it
was and the values differ (an identical repeat is dropped). Published minutes are remembered
for `MINUTE_FRAMES_LATE_KEEP_MIN` (default 10: a full-market minute is ~8,500 rows, so ten of
them are ~20 MB; Massive's late bars are seconds late, not minutes); older is counted and dropped.

HONESTY ABOUT GAPS. A frame is flagged INCOMPLETE when the vendor socket was not live at some
point between the minute's end and the build (`bar_stream._running`, sampled every tick, plus
every gap connect bar_stream reports): AM bars emitted while no socket was live are gone, so
that frame cannot claim a symbol did not trade. A publisher restart (deploy) continues the
day's `today.bin` (read back from R2 at start) and links its first frame to the last frame
there through `prev_seq`; minutes it was not alive for are simply missing, and every reader
sees the hole the same way.

THE DAY'S DAILY BAR AFTER THE CLOSE (MINUTE_FRAMES_WITH_DAILY=1, default off). From the regular
close (16:00 ET, 13:00 on a half day) to 20:00, every frame carries a DAILY section (minute_frames
FLAG_DAILY): each symbol's daily bar for the day exactly as the server holds it, i.e. the row bars-api
writes from the whole-market snapshot's `day` object (`bars_live_store.daily_rows_from_snapshot`, the
one parser, so the same symbols, prices and whole-share volume) and /api/bars?tf=D serves: the
official close (closing auction) and the consolidated day volume, which no sum of minute bars gives.
The first frame of an epoch after the close carries every symbol, later frames only the symbols whose
row changed. The snapshot is read in a CHILD process every `MINUTE_FRAMES_DAILY_POLL_S` (default 30)
during that window only: parsing ~13k tickers holds the GIL 150-230 ms (measured on bars-api), which
the reader's loop must never pay.

COST ON THE READER'S LOOP. `on_am` is a dict write per event. The encode (~10-40 ms for a busy
full-market minute) and the gzip run on a worker thread; uploads run on a worker thread.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import time
from typing import Callable, Optional

from api.services import minute_frames as mf
from api.services.vendor_symbols import app_symbol as _vendor_app_symbol

_log = logging.getLogger(__name__)


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.environ.get(name, default))
    except ValueError:
        return default


def enabled() -> bool:
    return os.environ.get("MINUTE_FRAMES_ENABLED", "0").strip().lower() in ("1", "true", "yes", "on")


def _with_av() -> bool:
    return os.environ.get("MINUTE_FRAMES_WITH_AV", "0").strip().lower() in ("1", "true", "yes", "on")


def _with_daily() -> bool:
    return os.environ.get("MINUTE_FRAMES_WITH_DAILY", "0").strip().lower() in ("1", "true", "yes", "on")


def regular_close_seq(day: int) -> int:
    """The seq of `day`'s regular close minute (16:00 ET, 13:00 on an NYSE early close)."""
    try:
        from api.services.nyse_calendar import NYSE_EARLY_CLOSES_YYYYMMDD
        close = 13 * 60 if int(day) in NYSE_EARLY_CLOSES_YYYYMMDD else 16 * 60
    except Exception:  # noqa: BLE001 - unreadable calendar: a full day
        close = 16 * 60
    return close - mf.SESSION_START_MIN


def _prefix() -> str:
    p = os.environ.get("MINUTE_FRAMES_PREFIX", "live1m/").strip()
    return p if p.endswith("/") else p + "/"


def _iso(day: int) -> str:
    return f"{day // 10000:04d}-{day // 100 % 100:02d}-{day % 100:02d}"


def frame_key(day: int, seq: int, prefix: Optional[str] = None) -> str:
    return f"{prefix or _prefix()}{_iso(day)}/{mf.hhmm_of_seq(seq)}.bin"


def today_key(day: int, prefix: Optional[str] = None) -> str:
    return f"{prefix or _prefix()}{_iso(day)}/today.bin"


def head_key(day: int, prefix: Optional[str] = None) -> str:
    return f"{prefix or _prefix()}{_iso(day)}/head.json"


class Publisher:
    """All state for one process. Pure apart from the injected `put`/`get` (R2) and `live`
    (is a vendor socket live) callables, so the tests drive it with a fake clock."""

    def __init__(self, *, put: Callable[[str, bytes, str], bool],
                 get: Optional[Callable[[str], Optional[bytes]]] = None,
                 live: Optional[Callable[[], bool]] = None,
                 grace_s: Optional[float] = None, roll_every: Optional[int] = None,
                 late_keep_min: Optional[int] = None, with_av: Optional[bool] = None,
                 prefix: Optional[str] = None, epoch: Optional[int] = None,
                 now_ms: Optional[Callable[[], int]] = None,
                 daily: Optional[Callable[[int], Optional[dict]]] = None):
        self.put = put
        self.get = get
        self.live = live or (lambda: True)
        self.grace_ms = int(1000 * (_env_float("MINUTE_FRAMES_GRACE_S", 5.0) if grace_s is None else grace_s))
        self.roll_every = max(1, int(_env_float("MINUTE_FRAMES_ROLL_EVERY", 5) if roll_every is None else roll_every))
        self.late_keep = int(_env_float("MINUTE_FRAMES_LATE_KEEP_MIN", 10) if late_keep_min is None else late_keep_min)
        self.with_av = _with_av() if with_av is None else bool(with_av)
        self.prefix = prefix or _prefix()
        self._now = now_ms or (lambda: int(time.time() * 1000))
        self.epoch = int(epoch if epoch is not None else self._now() // 1000) & 0xFFFFFFFF
        self.started_ms = self._now()
        # day -> {sym: (o, h, l, c, v)} of the newest server daily rows (None: off / none yet)
        self.daily = daily
        self.daily_sent: dict = {}                 # what this epoch's frames carried, per symbol
        # minute -> {sym: row}: bars for minutes whose frame is not out yet
        self.pending: dict = {}
        # minute -> {sym: row}: what each recent published minute carried (late/replace test)
        self.published: dict = {}
        self.late: dict = {}
        self.replace: dict = {}
        self.day: Optional[int] = None
        self.last_minute: Optional[int] = None     # newest minute whose frame was BUILT
        self.last_seq: int = mf.NO_SEQ             # its seq (the next frame's prev_seq)
        self.floor_seq: int = -1                   # seqs already published today by an earlier epoch
        self.today: Optional[mf.TodayWriter] = None
        self.today_seq: int = mf.NO_SEQ            # newest seq inside the last uploaded today.bin
        self.last_not_live_ms = 0
        self.last_connect_ms = self.started_ms
        self.uploads: list = []                    # [(key, bytes, content_type)] not yet written
        self._enc: list = []                       # frames built, not yet encoded
        self.stats = {"events": 0, "frames": 0, "empty_frames": 0, "incomplete_frames": 0,
                      "late": 0, "replaced": 0, "repeats": 0, "too_late": 0, "outside_session": 0,
                      "future": 0, "unmapped": 0, "upload_ok": 0, "upload_errors": 0,
                      "uploads_dropped": 0, "today_rolls": 0, "resumed_frames": 0,
                      "last_frame_bytes": 0, "last_encode_ms": 0.0, "last_frame_at_ms": None}

    # ── ingest (the reader's loop; must stay O(1)) ────────────────────────────────

    def on_am(self, sym: str, bar: dict) -> None:
        s = _vendor_app_symbol(sym)
        if s is None:
            self.stats["unmapped"] += 1
            return
        try:
            minute = int(bar["t"]) // 60000
            row = (float(bar["o"]), float(bar["h"]), float(bar["l"]), float(bar["c"]), float(bar["v"] or 0))
            if self.with_av:
                av = bar.get("av")
                row = row + ((float(av) if av is not None else None),)
        except Exception:
            return
        self.stats["events"] += 1
        pub = self.published.get(minute)
        if pub is not None:
            old = pub.get(s)
            if old is None:
                self.late.setdefault(minute, {})[s] = row
                self.stats["late"] += 1
            elif old != row:
                self.replace.setdefault(minute, {})[s] = row
                self.stats["replaced"] += 1
            else:
                self.stats["repeats"] += 1
                return
            pub[s] = row
            return
        if self.last_minute is not None and minute <= self.last_minute:
            self.stats["too_late"] += 1
            return
        if minute > self._now() // 60000 + 2:
            self.stats["future"] += 1
            return
        self.pending.setdefault(minute, {})[s] = row       # a repeated minute replaces itself

    def note_connected(self, now_ms: Optional[int] = None) -> None:
        """bar_stream: a socket connected while none was live (a GAP). AM bars emitted before
        this moment were never received."""
        self.last_connect_ms = int(now_ms if now_ms is not None else self._now())

    # ── a new day, or a restart mid-day ──────────────────────────────────────────

    def load_day(self, day: int) -> dict:
        """WORKER THREAD (an R2 read and a re-compress of the morning). Continue `day`'s
        today.bin if an earlier epoch wrote one: its frames go into the new writer as they were,
        so a member opening the app after a deploy still gets the whole morning, and no seq that
        is already out is published twice."""
        import struct
        writer = mf.TodayWriter(day=day, epoch=self.epoch)
        prepared = {"day": day, "today": writer, "floor": -1, "resumed": 0}
        if self.get is None:
            return prepared
        try:
            blob = self.get(today_key(day, self.prefix))
        except Exception as e:  # noqa: BLE001
            _log.warning("[minute-frames] could not read today.bin to resume: %s", e)
            blob = None
        if not blob:
            return prepared
        try:
            buf = mf.maybe_gunzip(blob)
            old = mf.decode_today(buf)
        except (mf.FrameError, OSError, EOFError) as e:
            _log.warning("[minute-frames] today.bin unreadable (%s); starting the day fresh", e)
            return prepared
        if old["day"] != day or not old["frames"]:
            return prepared
        pos, end = 16, len(buf) - 12            # header, trailer + CRC (decode_today proved both)
        while pos < end:
            (ln,) = struct.unpack_from("<I", buf, pos)
            frame = bytes(buf[pos + 4:pos + 4 + ln])
            writer.add(frame, struct.unpack_from("<I", frame, 12)[0])
            pos += 4 + ln
        floor, resumed = old["seq"], len(old["frames"])
        # Frames published after the last roll are in R2 as minute files but not in today.bin:
        # head.json names the newest, so carry those in too (at most roll_every - 1 of them).
        try:
            head = json.loads(self.get(head_key(day, self.prefix)) or b"null") or {}
        except (ValueError, TypeError, Exception):  # noqa: BLE001 - no head: today.bin is all there is
            head = {}
        newest = head.get("seq") if isinstance(head, dict) and head.get("day") == day else None
        if isinstance(newest, int) and newest > floor:
            for seq in range(floor + 1, min(newest, floor + 4 * self.roll_every) + 1):
                try:
                    gz = self.get(frame_key(day, seq, self.prefix))
                    frame = mf.maybe_gunzip(gz) if gz else None
                    if frame is not None:
                        mf.decode_frame(frame)             # whole, or not carried
                except (mf.FrameError, OSError, EOFError):
                    frame = None
                if frame is not None:
                    writer.add(frame, seq)
                    floor, resumed = seq, resumed + 1
        prepared.update(floor=floor, resumed=resumed)
        _log.info("[minute-frames] resuming %s: %d frame(s) through seq %d", _iso(day), resumed, floor)
        return prepared

    def start_day(self, prepared: dict) -> None:
        """LOOP THREAD: swap the prepared day in (cheap)."""
        self.day = prepared["day"]
        self.today = prepared["today"]
        self.floor_seq = prepared["floor"]
        self.last_seq = prepared["floor"] if prepared["floor"] >= 0 else mf.NO_SEQ
        self.today_seq = self.last_seq
        self.stats["resumed_frames"] += prepared["resumed"]
        self.published.clear()
        self.late.clear()
        self.replace.clear()
        self.daily_sent = {}

    def _first_minute(self, now: int) -> Optional[int]:
        if self.last_minute is not None:
            return self.last_minute + 1
        if not self.pending:
            return None
        # Start at the minute that closed as this process came up, never earlier: a stray old AM
        # bar must not open a run of empty frames for minutes nobody here was listening to.
        return max(min(self.pending), self.started_ms // 60000 - 1)

    def day_needed(self, now_ms: Optional[int] = None) -> Optional[int]:
        """The ET day the next due frame belongs to, when it is not the day held (so the loop
        can `load_day` it on a worker thread before `tick` reaches it)."""
        now = int(now_ms if now_ms is not None else self._now())
        m = self._first_minute(now)
        if m is None:
            return None
        due_through = (now - self.grace_ms) // 60000 - 1
        for mm in range(m, min(due_through, m + 1440) + 1):
            day, seq = mf.seq_of_minute(mm)
            if seq >= 0:
                return day if day != self.day else None
        return None

    # ── the clock ────────────────────────────────────────────────────────────────

    def tick(self, now_ms: Optional[int] = None) -> list:
        """Build every frame that is due. Returns the frames built, as dicts for the tests and
        the status page; the bytes to upload are queued on `self.uploads`."""
        now = int(now_ms if now_ms is not None else self._now())
        if not self.live():
            self.last_not_live_ms = now
        due_through = (now - self.grace_ms) // 60000 - 1     # newest minute whose end + grace passed
        start = self._first_minute(now)
        if start is None:
            return []
        for old in [k for k in self.pending if k < start]:      # a stray old bar never waits forever
            self.stats["too_late"] += len(self.pending.pop(old))
        built = []
        m = start
        while m <= due_through and len(built) < 60:
            frame = self._build(m, now)
            if frame is not None:
                built.append(frame)
            m += 1
        if built or m > start:
            self.last_minute = m - 1
        return built

    def _build(self, minute: int, now: int) -> Optional[dict]:
        day, seq = mf.seq_of_minute(minute)
        rows = self.pending.pop(minute, {})
        if seq < 0:
            if rows:
                self.stats["outside_session"] += len(rows)
            return None
        if self.day != day:
            self.start_day(self.load_day(day))     # production pre-loads it off the loop (_run)
        if seq <= self.floor_seq:
            # An earlier epoch already published this seq today: anything this one got for it
            # can only be late news.
            if rows:
                self.late.setdefault(minute, {}).update(rows)
            self.published[minute] = dict(rows)
            return None
        blocks = [(minute, mf.KIND_ONTIME, rows)]
        for lm in sorted(self.late):
            blocks.append((lm, mf.KIND_LATE, self.late[lm]))
        for rm in sorted(self.replace):
            blocks.append((rm, mf.KIND_REPLACE, self.replace[rm]))
        self.late, self.replace = {}, {}
        self.published[minute] = dict(rows)
        for old in [k for k in self.published if k < minute - self.late_keep]:
            del self.published[old]
        end_ms = (minute + 1) * 60000
        complete = max(self.last_not_live_ms, self.last_connect_ms) < end_ms
        frame = {"day": day, "seq": seq, "prev_seq": self.last_seq, "minute": minute,
                 "blocks": blocks, "complete": complete}
        self.last_seq = seq
        self.stats["frames"] += 1
        if not rows:
            self.stats["empty_frames"] += 1
        if not complete:
            self.stats["incomplete_frames"] += 1
        self._enc.append(frame)
        return frame

    def _daily_rows(self, day: int, seq: int) -> Optional[dict]:
        """The DAILY section for this frame: from the regular close on, the server's daily rows that
        changed since this epoch last carried them (all of them the first time). None before the
        close, when off, or when there is nothing new. Runs in `encode_pending` (a worker thread):
        comparing ~15k rows is a few ms the reader's loop never pays."""
        if self.daily is None or seq < regular_close_seq(day):
            return None
        try:
            rows = self.daily(day)
        except Exception:  # noqa: BLE001 - a missing daily feed costs the section, never the frame
            rows = None
        if not rows:
            return None
        changed = {sym: tuple(r) for sym, r in rows.items() if self.daily_sent.get(sym) != tuple(r)}
        self.daily_sent.update(changed)
        if changed:
            self.stats["daily_rows"] = self.stats.get("daily_rows", 0) + len(changed)
        return changed or None

    # ── encode + upload (worker threads) ─────────────────────────────────────────

    def encode_pending(self) -> int:
        """Encode every built frame, add it to today, queue its uploads. Runs on a worker thread
        in production (the tests call it inline). Returns how many frames it encoded."""
        frames, self._enc = self._enc, []
        for fr in frames:
            t0 = time.perf_counter()
            fr["daily"] = self._daily_rows(fr["day"], fr["seq"])
            raw = mf.encode_frame(day=fr["day"], seq=fr["seq"], prev_seq=fr["prev_seq"],
                                  epoch=self.epoch, minute=fr["minute"], blocks=fr["blocks"],
                                  with_av=self.with_av, complete=fr["complete"], daily=fr.get("daily"))
            gz = mf.gzip_bytes(raw)
            self.stats["last_encode_ms"] = round((time.perf_counter() - t0) * 1000, 1)
            self.stats["last_frame_bytes"] = len(gz)
            if self.today is None or self.today.day != fr["day"]:
                self.today = mf.TodayWriter(day=fr["day"], epoch=self.epoch)
            self.today.add(raw, fr["seq"])
            self.uploads.append((frame_key(fr["day"], fr["seq"], self.prefix), gz, "application/octet-stream"))
            rolled = False
            if fr["seq"] % self.roll_every == self.roll_every - 1 or fr["seq"] == mf.SESSION_MINUTES - 1:
                self.uploads.append((today_key(fr["day"], self.prefix), self.today.snapshot(),
                                     "application/octet-stream"))
                self.today_seq = fr["seq"]
                self.stats["today_rolls"] += 1
                rolled = True
            head = {"day": fr["day"], "seq": fr["seq"], "hhmm": mf.hhmm_of_seq(fr["seq"]),
                    "today_seq": None if self.today_seq == mf.NO_SEQ else self.today_seq,
                    "epoch": self.epoch, "at_ms": self._now(), "complete": fr["complete"],
                    "rolled": rolled}
            self.uploads.append((head_key(fr["day"], self.prefix),
                                 json.dumps(head, separators=(",", ":")).encode(), "application/json"))
            self.stats["last_frame_at_ms"] = self._now()
        return len(frames)

    def flush_uploads(self, max_queue: int = 120) -> int:
        """Write queued objects in order; stop at the first failure (the rest retry next time,
        so a head never lands before its frame). Returns how many were written."""
        done = 0
        while self.uploads:
            key, body, ctype = self.uploads[0]
            ok = False
            try:
                ok = bool(self.put(key, body, ctype))
            except Exception as e:  # noqa: BLE001
                if self.stats["upload_errors"] % 20 == 0:
                    _log.warning("[minute-frames] upload %s failed: %s", key, e)
            if not ok:
                self.stats["upload_errors"] += 1
                break
            self.uploads.pop(0)
            self.stats["upload_ok"] += 1
            done += 1
        # A long outage must not grow without bound: keep the newest, drop the oldest (readers
        # see the dropped frames as missing, the hole is in today.bin's links either way).
        while len(self.uploads) > max_queue:
            self.uploads.pop(0)
            self.stats["uploads_dropped"] += 1
        return done

    def status(self) -> dict:
        return {"enabled": True, "epoch": self.epoch, "day": self.day,
                "last_seq": None if self.last_seq == mf.NO_SEQ else self.last_seq,
                "today_seq": None if self.today_seq == mf.NO_SEQ else self.today_seq,
                "today_bytes": self.today.compressed_bytes if self.today else 0,
                "pending_minutes": len(self.pending), "uploads_queued": len(self.uploads),
                "with_av": self.with_av, "with_daily": self.daily is not None,
                "daily_feed": getattr(self.daily, "counts", None),
                "grace_s": self.grace_ms / 1000, **self.stats}


# ── the process's one publisher + its loop task ───────────────────────────────────

_publisher: Optional[Publisher] = None
_task: Optional[asyncio.Task] = None


_r2 = {"client": None}


def _r2_client():
    """The R2 client: the same DATA_SYNC_* credentials as every other R2 write, built HERE rather
    than through data_sync so stream-ingest's import closure (and its watch list) stays its own.
    Short timeouts: a frame is ~40-90 KB and a stuck upload must not hold the next minute."""
    if _r2["client"] is None:
        endpoint = os.environ.get("DATA_SYNC_ENDPOINT_URL")
        access = os.environ.get("DATA_SYNC_ACCESS_KEY")
        secret = os.environ.get("DATA_SYNC_SECRET_KEY")
        if not (endpoint and access and secret):
            return None
        import boto3
        from botocore.config import Config
        _r2["client"] = boto3.client(
            "s3", endpoint_url=endpoint, aws_access_key_id=access, aws_secret_access_key=secret,
            region_name=os.environ.get("DATA_SYNC_REGION", "auto"),
            config=Config(connect_timeout=5, read_timeout=20, retries={"max_attempts": 3, "mode": "standard"}))
    return _r2["client"]


def _bucket() -> Optional[str]:
    return os.environ.get("MINUTE_FRAMES_BUCKET") or os.environ.get("DATA_SYNC_BUCKET")


def _default_put(key: str, body: bytes, ctype: str) -> bool:
    cl, bucket = _r2_client(), _bucket()
    if cl is None or not bucket:
        return False
    extra = {"CacheControl": "no-store"} if key.endswith(".json") else {}
    cl.put_object(Bucket=bucket, Key=key, Body=body, ContentType=ctype, **extra)
    return True


def _default_get(key: str) -> Optional[bytes]:
    cl, bucket = _r2_client(), _bucket()
    if cl is None or not bucket:
        return None
    try:
        return cl.get_object(Bucket=bucket, Key=key)["Body"].read()
    except Exception:  # noqa: BLE001 - a missing object is the normal first-boot case
        return None


def _socket_live() -> bool:
    from api.services import bar_stream
    return bool(bar_stream._running)


# ── the server's daily rows, read in a child process after the close ─────────────

SNAPSHOT_PATH = "/v2/snapshot/locale/us/markets/stocks/tickers"


def _daily_poll_s() -> float:
    return max(5.0, _env_float("MINUTE_FRAMES_DAILY_POLL_S", 30.0))


def snapshot_daily_rows(snapshot: dict, day: int) -> dict:
    """{sym: (o, h, l, c, v)} for `day` from a whole-market snapshot: bars-api's own parser
    (`bars_live_store.daily_rows_from_snapshot`), so these are the rows /api/bars?tf=D serves."""
    from api.services.bars_live_store import daily_rows_from_snapshot
    return {r[0]: tuple(r[2:7]) for r in daily_rows_from_snapshot(snapshot.get("tickers") or [], int(day))}


def poll_daily_once(now_s: Optional[float] = None) -> Optional[tuple]:
    """One snapshot read -> (day, {sym: row}) for TODAY (ET), or None outside [close, 20:00) or
    when today's regular session has not opened. ⛔ A holiday's (or a pre-open) snapshot `day` is
    the PRIOR session: dated today it would draw yesterday's candle twice (2026-09-04, 2026-09-11).
    The one rule is bars-api's (`massive._regular_session_has_opened_today`), asked, not restated."""
    day, seq = mf.seq_of_minute(int(time.time() if now_s is None else now_s) // 60)
    if seq < regular_close_seq(day):                # before the close, or outside 04:00-20:00 (seq -1)
        return None
    from api.services import massive
    if not massive._regular_session_has_opened_today():
        return None
    from api.services import massive_adapter
    data = massive_adapter.get(SNAPSHOT_PATH, data_class="bars",
                               activity="minute_frame_publisher.daily").value or {}
    rows = snapshot_daily_rows(data, day)
    return (day, rows) if rows else None


def daily_changes(state: dict, got: Optional[tuple]) -> Optional[tuple]:
    """CHILD: (day, rows) -> (day, only the rows not yet handed over for that day), or None. Keeps
    the pipe (and the parent's unpickle, which holds ITS GIL) to the few hundred rows that move after
    hours instead of ~15k every poll; the first report of a day is every row."""
    if not got:
        return None
    day, rows = got
    if state.get("day") != day:
        state.clear()
        state.update(day=day, sent={})
    sent = state["sent"]
    changed = {sym: r for sym, r in rows.items() if sent.get(sym) != r}
    sent.update(changed)
    return (day, changed) if changed else None


def _daily_child(q, poll_s: float) -> None:
    """CHILD PROCESS: poll the snapshot during [close, 20:00) ET and hand (day, changed rows) to the parent."""
    state: dict = {}
    while True:
        try:
            msg = daily_changes(state, poll_daily_once())
            if msg:
                q.put(msg)
        except Exception as e:  # noqa: BLE001
            try:
                q.put(("err", str(e)[:200]))
            except Exception:  # noqa: BLE001
                pass
        time.sleep(poll_s)


class DailyFeed:
    """Today's server daily rows as the child process reports them (changes merged into the day's
    rows); `feed(day)` -> {sym: row} for that day, or None."""

    def __init__(self, start_child: bool = True, poll_s: Optional[float] = None):
        self._latest: Optional[tuple] = None
        self.counts = {"reports": 0, "errors": 0}
        if start_child:
            import multiprocessing as mp
            import threading
            ctx = mp.get_context("spawn")
            self._q = ctx.Queue()
            ctx.Process(target=_daily_child, args=(self._q, poll_s or _daily_poll_s()), daemon=True,
                        name="minute-frames-daily").start()
            threading.Thread(target=self._listen, daemon=True, name="minute-frames-daily-listener").start()

    def _listen(self) -> None:
        while True:
            try:
                self.report(self._q.get())
            except Exception:  # noqa: BLE001
                time.sleep(1)

    def report(self, msg) -> None:
        if isinstance(msg, tuple) and len(msg) == 2 and msg[0] != "err" and isinstance(msg[1], dict):
            day, latest = int(msg[0]), self._latest
            # copy, then swap: the encode thread may be iterating the dict it was handed
            rows = dict(latest[1]) if latest is not None and latest[0] == day else {}
            rows.update(msg[1])
            self._latest = (day, rows)
            self.counts["reports"] += 1
        else:
            self.counts["errors"] += 1

    def __call__(self, day: int) -> Optional[dict]:
        latest = self._latest
        return latest[1] if latest is not None and latest[0] == int(day) else None


def publisher() -> Publisher:
    global _publisher
    if _publisher is None:
        daily = None
        if _with_daily():
            try:
                daily = DailyFeed()
            except Exception as e:  # noqa: BLE001 - no daily section, the frames go on
                _log.warning("[minute-frames] daily feed did not start: %s", e)
        _publisher = Publisher(put=_default_put, get=_default_get, live=_socket_live, daily=daily)
    return _publisher


def on_am(sym: str, bar: dict) -> None:
    p = _publisher
    if p is not None:
        p.on_am(sym, bar)


def note_connected() -> None:
    if _publisher is not None:
        _publisher.note_connected()


async def _run(p: Publisher) -> None:
    while True:
        await asyncio.sleep(1.0)
        try:
            day = p.day_needed()
            if day is not None:
                p.start_day(await asyncio.to_thread(p.load_day, day))
            built = p.tick()
            if built or p._enc:
                await asyncio.to_thread(p.encode_pending)
            if p.uploads:
                await asyncio.to_thread(p.flush_uploads)
        except asyncio.CancelledError:
            raise
        except Exception as e:  # noqa: BLE001 - the publisher must never take the reader down
            _log.warning("[minute-frames] tick failed: %s", e)


def start(loop: asyncio.AbstractEventLoop) -> bool:
    """Start the publisher on the reader's loop (idempotent; a no-op while the flag is off)."""
    global _task
    if not enabled():
        return False
    p = publisher()
    if _task is None or _task.done():
        _task = loop.create_task(_run(p))
        _log.info("[minute-frames] publisher started (epoch %d, prefix %s)", p.epoch, p.prefix)
    return True


def status() -> dict:
    if _publisher is None:
        return {"enabled": enabled(), "running": False}
    return {**_publisher.status(), "running": _task is not None and not _task.done()}


def _reset_for_tests() -> None:
    global _publisher, _task
    _publisher = None
    _task = None
    _r2["client"] = None
