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


def mark_posted(key: str) -> None:
    """Record one slot as posted. `key` is "YYYY-MM-DD HH:MM"."""
    keys = posted_keys()
    keys.add(key)
    cutoff = (dt.date.today() - dt.timedelta(days=_KEEP_DAYS)).isoformat()
    keys = {k for k in keys if k[:10] >= cutoff}
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"posted": sorted(keys)}), encoding="utf-8")
    os.replace(tmp, p)          # never truncate the real file before the write can fail


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
    url = webhook_url()
    if not url:
        # ⛔ WARNING, not debug: armed-but-unconfigured is a MISTAKE, and
        # otherwise indistinguishable from a quiet day for the rest of time --
        # a mistyped BUZZ_DIGEST_WEBHOOK would return this same dict every day,
        # forever, with nothing else to say so.
        log.warning("[buzz] digest is ENABLED but BUZZ_DIGEST_WEBHOOK is unset - nothing will ever post")
        return {"posted": False, "reason": "no webhook"}
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

        poster = post_fn or (lambda **kw: _post(kw["url"], kw["content"], kw["png"]))
        ok = poster(url=url, content=content, png=png)
        if ok:
            mark_posted(key)
        else:
            log.warning("[buzz] digest post_fn reported failure for %s", key)
        return {"posted": bool(ok), "reason": "", "had_image": png is not None, "slot": slot}
    finally:
        _RUN_LOCK.release()
