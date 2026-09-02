"""The daily buzz post. Ships DISARMED -- posting into a 750-member room is the
owner's call, not a default.

⛔ _RUN_LOCK plus a persisted last-posted day: two overlapping runs would
double-post, which is exactly the failure the index close post hit.
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


def _state_path() -> pathlib.Path:
    return pathlib.Path(os.environ.get("BUZZ_STATE_PATH", "/data/buzz_state.json"))


def last_posted() -> str:
    try:
        return json.loads(_state_path().read_text(encoding="utf-8")).get("last_posted", "")
    except Exception:  # noqa: BLE001
        return ""


def mark_posted(day: str) -> None:
    p = _state_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps({"last_posted": day}), encoding="utf-8")
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


def run_digest(*, now: int | None = None, render_fn=None, post_fn=None) -> dict:
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
    day = dt.datetime.fromtimestamp(now, _ET).strftime("%Y-%m-%d")
    if last_posted() == day:
        log.info("[buzz] digest already posted today (%s)", day)
        return {"posted": False, "reason": "already posted today"}
    if not _RUN_LOCK.acquire(blocking=False):
        # Overlap should not happen at daily cadence; loud if it ever does.
        log.warning("[buzz] digest already running -- overlapping call skipped")
        return {"posted": False, "reason": "already running"}
    try:
        rows = buzz_boards.top_board("open", now, limit=5)
        if not rows:
            log.info("[buzz] digest: nothing to say for %s -- skipping", day)
            return {"posted": False, "reason": "nothing to say"}
        content = buzz_reply.build_board_text(now, "open")

        render = render_fn or (buzz_image.render_board_png if buzz_image.image_enabled() else None)
        png = render("open") if render else None

        poster = post_fn or (lambda **kw: _post(kw["url"], kw["content"], kw["png"]))
        ok = poster(url=url, content=content, png=png)
        if ok:
            mark_posted(day)
        else:
            log.warning("[buzz] digest post_fn reported failure for %s", day)
        return {"posted": bool(ok), "reason": "", "had_image": png is not None}
    finally:
        _RUN_LOCK.release()
