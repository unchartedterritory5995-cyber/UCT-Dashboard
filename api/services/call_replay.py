"""D-5 (Lane R): tape + transcript replay of one earnings call.

The Research > Depth "Call replay" panel. It puts two things we already hold
side by side and plays them back together:

  transcript  the TIMED transcript (earningscall.biz level-3, the source behind
              the existing playable transcript, `earningscall_timed`): speaker
              turns whose words carry their second-offset into the recording
  tape        1-minute bars for the call window from Massive's aggregates
              endpoint (`massive.get_agg_bars_minute`, extended hours included),
              the same reader the excursion engine and Model Book already use

⛔ ALIGNMENT IS NEVER FAKED. A turn is placed on the tape only through two real
   timestamps: the call's listed start time (`conference_date` on the provider's
   event list) plus the turn's own second-offset in the recording. Then:
     * state 'aligned'   -- both exist; the payload says the basis ("listed
                            start"), and that a late start or hold music before
                            the call shifts every turn by the same amount;
     * state 'unaligned' -- the timed transcript exists but no usable start
                            time does (absent, date-only or without a zone): the
                            turns come back with their recording offsets and NO
                            tape, and the reason is said in words;
     * state 'no_timed_transcript' -- the call has no timed transcript (coverage
                            is the S&P 500 and some others; with no
                            EARNINGS_AUDIO_API_KEY the provider's demo key serves
                            AAPL and MSFT only). Nothing is guessed from the
                            untimed FMP transcript.
⛔ The tape's state is its own: 'ok', 'empty' (Massive answered no bars for the
   window -- which on this reader is also what a failed read looks like, so the
   panel says "could not be read or held none", never "flat"), 'not_read'.

Caching: the timed transcript and the event list are cached by
`earningscall_timed` (30 d hit / 6 h miss). The tape is cached here: 7 days for a
window that closed more than a day ago (published minute bars do not change),
5 minutes otherwise, 10 minutes for an empty answer. Every vendor read carries
the owning client's timeout (earningscall 20 s, Massive read 25 s).

DARK behind CALL_REPLAY_ENABLED (read per call; unset = OFF).
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

_log = logging.getLogger(__name__)

ENABLED_ENV = "CALL_REPLAY_ENABLED"
PRE_MINUTES = 15
POST_MINUTES = 30
TAPE_SOURCE = "Massive 1-minute aggregates (extended hours included)"
TRANSCRIPT_SOURCE = "earningscall.biz timed transcript (word-level timings)"
_TTL_CLOSED = 7 * 86_400
_TTL_OPEN = 300
_TTL_EMPTY = 600

try:
    from zoneinfo import ZoneInfo
    _ET = ZoneInfo("America/New_York")
except Exception:  # pragma: no cover -- tzdata missing
    _ET = timezone(timedelta(hours=-4))


def is_enabled() -> bool:
    """Read PER CALL. Unset means OFF."""
    return os.environ.get(ENABLED_ENV, "").strip() == "1"


def _cache():
    from api.services.cache import cache
    return cache


def parse_start(value: Any) -> Optional[datetime]:
    """The call's listed start as an aware UTC datetime, or None.

    Only a value carrying a TIME and a ZONE is usable: a date-only string or a
    naive datetime would need us to assume a clock or a zone, and an assumed
    zone is exactly a faked alignment."""
    if not isinstance(value, str) or "T" not in value:
        return None
    s = value.strip().replace("Z", "+00:00")
    try:
        dt = datetime.fromisoformat(s)
    except ValueError:
        return None
    if dt.tzinfo is None or dt.utcoffset() is None:
        return None
    return dt.astimezone(timezone.utc)


def _turns(timed: dict) -> list[dict]:
    out = []
    for seg in timed.get("segments") or []:
        starts = seg.get("starts") or []
        words = seg.get("words") or []
        if not starts or not words:
            continue
        out.append({
            "speaker": (seg.get("name") or "").strip() or f"Speaker {seg.get('speaker')}",
            "title": (seg.get("title") or "").strip(),
            "start_s": float(starts[0]),
            "end_s": float(starts[-1]),
            "text": " ".join(str(w) for w in words),
        })
    out.sort(key=lambda t: t["start_s"])
    return out


def tape(sym: str, start: datetime, end: datetime, *, now: Optional[datetime] = None) -> tuple[list[dict], str]:
    """1-minute bars with start <= t <= end, as (bars, state). Cached."""
    now = now or datetime.now(timezone.utc)
    s_ts, e_ts = int(start.timestamp()), int(end.timestamp())
    ck = f"call_replay_tape::{sym}::{s_ts}::{e_ts}"
    hit = _cache().get(ck)
    if hit is not None:
        return ([], "empty") if hit == "__empty__" else (hit, "ok")
    from api.services import massive
    d_from = start.astimezone(_ET).date().isoformat()
    d_to = end.astimezone(_ET).date().isoformat()
    raw = massive.get_agg_bars_minute(sym, 1, d_from, d_to) or []
    bars = []
    for b in raw:
        try:
            t = int(b["t"]) // 1000
        except (KeyError, TypeError, ValueError):
            continue
        if s_ts <= t <= e_ts:
            bars.append({"t": t, "o": b.get("o"), "h": b.get("h"), "l": b.get("l"),
                         "c": b.get("c"), "v": b.get("v")})
    bars.sort(key=lambda b: b["t"])
    if not bars:
        _cache().set(ck, "__empty__", _TTL_EMPTY)
        return [], "empty"
    closed = end < now - timedelta(days=1)
    _cache().set(ck, bars, _TTL_CLOSED if closed else _TTL_OPEN)
    return bars, "ok"


def replay(sym: str, year: Optional[int] = None, quarter: Optional[int] = None,
           *, now: Optional[datetime] = None) -> dict:
    """The replay payload for one call (the newest published one by default)."""
    from api.services import earningscall_timed as ec
    sym = (sym or "").upper().strip()
    base: dict[str, Any] = {"symbol": sym, "transcript_source": TRANSCRIPT_SOURCE,
                            "tape_source": TAPE_SOURCE, "turns": [], "bars": [],
                            "tape_state": "not_read", "alignment": None}
    timed = ec.get_timed_transcript(sym, year=year, quarter=quarter)
    if not timed or not timed.get("segments"):
        return {**base, "state": "no_timed_transcript",
                "reason": "No timed transcript is on file for this call, so there is nothing to replay "
                          "against the tape. The plain transcript is unaffected."}
    turns = _turns(timed)
    base.update(year=timed.get("year"), quarter=timed.get("quarter"), turns=turns)
    duration = max((t["end_s"] for t in turns), default=0.0)
    ev = ec.event_meta(sym, timed.get("year"), timed.get("quarter"))
    start = parse_start((ev or {}).get("conference_date"))
    if start is None:
        return {**base, "state": "unaligned",
                "reason": "No usable start time is on file for this call (none, or a date without a time "
                          "and zone), so the recording's word timings cannot be placed on the tape. "
                          "Turns are shown with their time into the recording only."}
    w_from = start - timedelta(minutes=PRE_MINUTES)
    w_to = start + timedelta(seconds=duration) + timedelta(minutes=POST_MINUTES)
    bars, tape_state = tape(sym, w_from, w_to, now=now)
    s0 = start.timestamp()
    for t in turns:
        t["at"] = int(s0 + t["start_s"])
    return {**base, "state": "aligned", "bars": bars, "tape_state": tape_state,
            "window": {"from": int(w_from.timestamp()), "to": int(w_to.timestamp()),
                       "pre_minutes": PRE_MINUTES, "post_minutes": POST_MINUTES},
            "alignment": {
                "basis": "listed_start",
                "call_start": start.isoformat(),
                "note": "Each turn is placed at the call's listed start time plus its offset into the "
                        "recording. A call that began late, or a recording that opens with hold time, "
                        "shifts every turn by the same amount.",
            }}
