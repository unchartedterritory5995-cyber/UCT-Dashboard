"""The buzz post. Ships DISARMED -- posting into a 750-member room is the
owner's call, not a default.

⛔ _RUN_LOCK plus a persisted per-SLOT record: two overlapping runs would
double-post, which is exactly the failure the index close post hit. The record
used to be a single last-posted DAY, which was correct while there was one post
a day and silently wrong the moment there were seven -- the 10:30 run would
have found the 10:00 day-stamp and skipped every remaining slot forever.
"""
from __future__ import annotations

import datetime as dt
import json
import logging
import os
import pathlib
import threading
from zoneinfo import ZoneInfo

from api.services import buzz_image, buzz_reply, buzz_boards

log = logging.getLogger(__name__)
_ET = ZoneInfo("America/New_York")
_RUN_LOCK = threading.Lock()


def digest_enabled() -> bool:
    return os.environ.get("BUZZ_DIGEST_ENABLED", "0").strip().lower() in ("1", "true", "on")


def webhook_url() -> str:
    return os.environ.get("BUZZ_DIGEST_WEBHOOK", "").strip()


def digest_channel() -> str:
    """Channel id to post into AS THE BOT, instead of via a webhook.

    Exists so activating the digest needs no webhook created by hand: the bot
    already holds SEND_MESSAGES, so a channel id is enough. A webhook can still
    target a channel the bot cannot reach, so both paths stay -- this one wins
    when set, because it is the more specific instruction."""
    return os.environ.get("BUZZ_DIGEST_CHANNEL", "").strip()


# Owner-chosen cadence (2026-09-02): through the session, not once at the close.
DEFAULT_TIMES = "10:00,10:30,11:30,12:30,14:00,16:15,17:30"


def digest_times() -> tuple[tuple[int, int], ...]:
    """Scheduled ET slots as (hour, minute), sorted and deduped.

    ⛔ A malformed BUZZ_DIGEST_TIMES returns EMPTY and warns; it must never
    fall back to DEFAULT_TIMES. Falling back would post at times the owner did
    not ask for and make a typo indistinguishable from the default -- the same
    reasoning as the armed-but-unconfigured warning below."""
    raw = os.environ.get("BUZZ_DIGEST_TIMES", DEFAULT_TIMES).strip()
    out: list[tuple[int, int]] = []
    bad: list[str] = []
    for part in raw.split(","):
        part = part.strip()
        if not part:
            continue
        try:
            h_s, m_s = part.split(":")
            h, m = int(h_s), int(m_s)
        except ValueError:
            bad.append(part)
            continue
        if 0 <= h <= 23 and 0 <= m <= 59:
            out.append((h, m))
        else:
            bad.append(part)
    if bad:
        log.warning("[buzz] BUZZ_DIGEST_TIMES has unusable entries %s -- they are ignored", bad)
    if not out:
        log.warning("[buzz] BUZZ_DIGEST_TIMES parsed to NOTHING (%r) -- no digest will post", raw)
    return tuple(sorted(set(out)))


def slot_label(h: int, m: int) -> str:
    return "%02d:%02d" % (h, m)


def _slot_for(now_dt: dt.datetime) -> str:
    """The scheduled slot a run belongs to. The scheduler passes its own label;
    this is the fallback for a manual call or a misfire, and it maps the run to
    the NEAREST scheduled slot within 30 minutes so a late fire still dedups
    against the slot it was meant to be."""
    best, best_gap = None, None
    mins = now_dt.hour * 60 + now_dt.minute
    for h, m in digest_times():
        gap = abs(mins - (h * 60 + m))
        if best_gap is None or gap < best_gap:
            best, best_gap = slot_label(h, m), gap
    if best is not None and best_gap is not None and best_gap <= 30:
        return best
    return now_dt.strftime("%H:%M")


def _state_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("BUZZ_STATE_PATH", "/data/buzz_state.json"))


# Keys are "YYYY-MM-DD HH:MM". Pruned to a few days so the file cannot grow
# without bound -- 7 slots a day would otherwise accumulate forever.
_KEEP_DAYS = 5


def _read_state() -> dict:
    try:
        d = json.loads(_state_path().read_text(encoding="utf-8"))
        return d if isinstance(d, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def posted_keys() -> set[str]:
    return set(_read_state().get("posted") or [])


def already_posted(key: str) -> bool:
    return key in posted_keys()


def missed_keys() -> set[str]:
    """Slots this process gave up on. Written so a skipped checkpoint leaves a
    trace -- see catch_up()."""
    return set(_read_state().get("missed") or [])


def _write_state(**updates) -> None:
    """Merge into the state file. ⛔ MERGE, never replace: this used to write
    `{"posted": [...]}` wholesale, so the day a second key was added the first
    write of the day would silently delete it
    (lesson_a_projection_drops_what_it_does_not_name). Both sets are pruned
    here, in one place, so no caller can forget."""
    state = _read_state()
    state.update(updates)
    cutoff = (dt.date.today() - dt.timedelta(days=_KEEP_DAYS)).isoformat()
    for k in ("posted", "missed"):
        if k in state:
            state[k] = sorted({v for v in state[k] if str(v)[:10] >= cutoff})
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(state), encoding="utf-8")
    os.replace(tmp, p)          # never truncate the real file before the write can fail


def mark_posted(key: str) -> None:
    """Record one slot as posted. `key` is "YYYY-MM-DD HH:MM"."""
    _write_state(posted=sorted(posted_keys() | {key}))


def mark_missed(key: str) -> None:
    """Record one slot as given up on, so the warning fires once and the state
    file shows which checkpoints the room never got."""
    _write_state(missed=sorted(missed_keys() | {key}))


# ── Catch-up. The cron job is the ONLY thing that fires a checkpoint, and
# APScheduler here uses an in-memory job store: a pod that restarts across
# 16:15 does not "miss" that fire, it never schedules it, so misfire_grace_time
# cannot help and the slot is dropped in total silence. This pod redeploys
# several times a day and there are seven slots, so that is not a rare corner.
#
# ⛔ Silence is the actual defect. "No 16:15 board" and "not 16:15 yet" look
# identical from the outside, which is the same trap that let a truncated
# backfill read as a finished one on this branch.
#
# 20 minutes is the honesty limit, not a retry budget. The board is captioned
# "since the open" and carries its own "counted through H:MMp" line, so a
# modestly late post is still a true board; an hour-late one would be a
# different board wearing an old slot's label. Past the window the slot is
# recorded as MISSED and warned about ONCE -- a skipped checkpoint should cost
# a log line, never a lie.
_CATCHUP_GRACE_MIN = 20


def _alert_missed(label: str, late: int) -> None:
    """Tell a HUMAN a checkpoint was dropped.

    ⛔ A log line is not a notification. Railway's log stream on this pod is
    flooded by yfinance and theme chatter, nobody tails it, and it is batched on
    ingest -- so the warning above closes the "it vanished silently" hole in the
    CODE while leaving it wide open in PRACTICE. That is the same mistake one
    level up: I would have shipped a miss-detector nobody ever reads.

    `severity="critical"` is not drama, it is the ONLY severity
    chart_health_alerts pages Discord on; anything less lands in an in-memory
    deque that dies with the pod. The key carries the slot so two missed
    checkpoints are two pages rather than one swallowed by the 30-minute
    per-key cooldown.

    Never raises: this runs inside the 60s poll, and an alerting failure must
    not cost the room its INGEST.
    """
    try:
        from api.services import chart_health_alerts
        chart_health_alerts.emit(
            f"buzz_slot_missed:{label}", "critical",
            f"Buzz board for the {label} ET checkpoint was never posted "
            f"({late}m late, past the {_CATCHUP_GRACE_MIN}m catch-up window). "
            f"The room is missing that slot today.",
            {"slot": label, "minutes_late": late},
        )
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] could not raise a missed-slot alert for %s: %s", label, e)


def due_unposted_slots(now_dt: dt.datetime) -> list[tuple[str, int]]:
    """(slot label, minutes late) for today's slots that have already passed
    and carry no posted record. Oldest first.

    Weekends are empty by construction: the scheduler is mon-fri, so a Saturday
    catch-up would post a board no cron would ever have produced."""
    if now_dt.weekday() > 4:
        return []
    day = now_dt.date().isoformat()
    mins = now_dt.hour * 60 + now_dt.minute
    done = posted_keys() | missed_keys()
    out = []
    for h, m in digest_times():
        late = mins - (h * 60 + m)
        if late <= 0:
            continue
        if f"{day} {slot_label(h, m)}" in done:
            continue
        out.append((slot_label(h, m), late))
    return out


def catch_up(*, now: int | None = None, **kw) -> dict:
    """Post one checkpoint the scheduler never fired, or record why not.

    Safe to call every minute: `_RUN_LOCK` makes a race with the cron job a
    no-op for whichever arrives second, and the persisted per-slot record makes
    a double-post impossible even across processes.
    """
    import time
    now = now or int(time.time())
    if not digest_enabled():
        return {"posted": False, "reason": "disarmed"}
    now_dt = dt.datetime.fromtimestamp(now, _ET)
    due = due_unposted_slots(now_dt)
    if not due:
        return {"posted": False, "reason": "nothing due"}
    day = now_dt.date().isoformat()
    for label, late in due:                       # oldest first
        if late <= _CATCHUP_GRACE_MIN:
            log.warning("[buzz] %s never fired (%dm ago) -- catching it up now", label, late)
            return run_digest(now=now, slot=label, **kw)
        mark_missed(f"{day} {label}")
        log.warning("[buzz] MISSED the %s board -- %dm late, past the %dm catch-up "
                    "window, so it will not be posted. The room got six of seven "
                    "checkpoints today, not seven.", label, late, _CATCHUP_GRACE_MIN)
        _alert_missed(label, late)
    return {"posted": False, "reason": "all due slots are past the catch-up window"}


def _post_as_bot(channel_id: str, content: str, png: bytes | None) -> bool:
    """Same contract as _post: True on success, never raises. Uses the bot
    token the poller already needs, so no extra credential is involved."""
    try:
        import requests
        token = os.environ.get("DISCORD_BOT_TOKEN", "").strip()
        if not token:
            # The poller names this too; say it here as well because the
            # digest can be armed independently of a working ingest.
            log.warning("[buzz] BUZZ_DIGEST_CHANNEL is set but DISCORD_BOT_TOKEN is not "
                        "-- cannot post as the bot")
            return False
        files = {"files[0]": ("buzz.png", png, "image/png")} if png else None
        r = requests.post(
            f"https://discord.com/api/v10/channels/{channel_id}/messages",
            headers={"Authorization": f"Bot {token}"},
            data={"payload_json": json.dumps({"content": content})},
            files=files, timeout=60,
        )
        if r.status_code not in (200, 201, 204):
            log.warning("[buzz] digest bot-post HTTP %s: %s", r.status_code, r.text[:160])
            return False
        return True
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] digest bot-post failed: %s", e)
        return False


def _post(url: str, content: str, png: bytes | None) -> bool:
    # The one call in this module most exposed to a real network hiccup
    # (DNS, timeout, connection reset) -- every other failure path here is
    # caught and normalised to a dict; this one must not raise out of
    # run_digest's `-> dict` contract. Not a double-post risk either way:
    # mark_posted only runs when this returns True.
    try:
        import requests
        files = {"files[0]": ("buzz.png", png, "image/png")} if png else None
        payload = {"content": content}
        r = requests.post(url, data={"payload_json": json.dumps(payload)}, files=files, timeout=60)
        return r.status_code in (200, 204)
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] digest post failed: %s", e)
        return False


def run_digest(*, now: int | None = None, slot: str | None = None,
               render_fn=None, post_fn=None) -> dict:
    """Post one slot's board. `slot` is the scheduler's own "HH:MM" label; when
    omitted it is derived from `now` (manual runs, misfires)."""
    import time
    now = now or int(time.time())
    if not digest_enabled():
        # debug, not warning: this is the shipped default and expected.
        log.debug("[buzz] digest disarmed (BUZZ_DIGEST_ENABLED unset)")
        return {"posted": False, "reason": "disarmed"}
    channel, url = digest_channel(), webhook_url()
    if not channel and not url:
        # ⛔ WARNING, not debug: armed-but-unconfigured is a MISTAKE, and
        # otherwise indistinguishable from a quiet day for the rest of time --
        # a mistyped destination would return this same dict every slot,
        # forever, with nothing else to say so. Name BOTH ways to fix it.
        log.warning("[buzz] digest is ENABLED but neither BUZZ_DIGEST_CHANNEL nor "
                    "BUZZ_DIGEST_WEBHOOK is set - nothing will ever post")
        return {"posted": False, "reason": "no destination"}
    now_dt = dt.datetime.fromtimestamp(now, _ET)
    day = now_dt.strftime("%Y-%m-%d")
    slot = slot or _slot_for(now_dt)
    key = f"{day} {slot}"
    # ⛔ Per SLOT, not per day. A day-level stamp let the 10:00 post silently
    # cancel every later slot.
    if already_posted(key):
        log.info("[buzz] digest already posted for %s", key)
        return {"posted": False, "reason": "already posted", "slot": slot}
    if not _RUN_LOCK.acquire(blocking=False):
        # Slots are >= 30 min apart, so an overlap means a run is wedged; loud.
        log.warning("[buzz] digest already running -- overlapping call for %s skipped", key)
        return {"posted": False, "reason": "already running", "slot": slot}
    try:
        rows = buzz_boards.top_board("open", now, limit=5)
        if not rows:
            # NOT marked posted: an empty 10:00 must not cancel 10:30.
            log.info("[buzz] digest: nothing to say for %s -- skipping", key)
            return {"posted": False, "reason": "nothing to say", "slot": slot}
        content = buzz_reply.build_board_text(now, "open")

        render = render_fn or (buzz_image.render_board_png if buzz_image.image_enabled() else None)
        png = render("open") if render else None

        if post_fn is not None:
            poster = post_fn
        elif channel:
            poster = lambda **kw: _post_as_bot(channel, kw["content"], kw["png"])  # noqa: E731
        else:
            poster = lambda **kw: _post(kw["url"], kw["content"], kw["png"])       # noqa: E731
        ok = poster(url=url, content=content, png=png)
        if ok:
            mark_posted(key)
        else:
            log.warning("[buzz] digest post_fn reported failure for %s", key)
        return {"posted": bool(ok), "reason": "", "had_image": png is not None, "slot": slot}
    finally:
        _RUN_LOCK.release()
