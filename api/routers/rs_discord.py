"""The admin door and the status readback of the nightly UCT RS Discord post
(engineering map docs/superpowers/plans/2026-11-06-uct-rs-phase2-engineering-map.md,
unit 2b-08; the poster is `api.services.rs_discord_post`, unit 2b-07; the two
cron jobs, the readers and the boot line are in `api.main`).

    POST /api/admin/rs-discord/post?target=test|live&force=0|1&dry_run=0|1[&session=YYYY-MM-DD]
    GET  /api/admin/rs-discord/status

THE GATE is `require_admin_or_push_secret` (api/routers/patterns.py): an admin
session cookie OR `Authorization: Bearer <PUSH_SECRET>`. The bearer is the
index-close door's own gate (`/api/discord/index-close/run` checks the same
secret inline) and is what a curl from the owner's box carries; the cookie is
what every other `/api/admin/*` door here means. No credential or a wrong one
is 401, a non-admin session 403, and `auth_surface_check.GUARD_NAMES` knows the
name, so the boot audit reports both routes gated.

TARGET. `test` posts to `DISCORD_RS_TEST_WEBHOOK_URL` (a row in the channel
registry, purpose `rs_leaders_test`) through a dedup that NEVER marks: a test
post that recorded the session would make the 04:45 member post skip it as
already posted. Unset, the door answers 409 and posts nothing (never a fallback
room); a dry run needs no webhook and is not refused. `live` posts to the
member webhook through the module's own marker, exactly as the scheduled job.

`force` and `dry_run` pass straight through to `post_rs_summary`: force skips
the flag, the marker and the floor (never the webhook or the validator);
dry_run builds and validates, posts nothing and returns the content. While
the flag is dark, a test or a dry run needs `force=1`, because the flag is the
first gate the module applies.

THE READERS ARE INJECTED (`configure`), by `api.main` beside the mount: the
door posts through the same `leaders_fn`, `evidence_fn` and session resolver
the scheduled job uses, so a hand-fired post cannot differ from the 04:45 one.
Unconfigured, the door answers 503 rather than inventing a reader.

THE DOOR IS SYNCHRONOUS on purpose. The post is one HTTP call plus at most one
5 s retry, not the minute of chart renders that made the index-close door go
asynchronous, so the caller gets the receipt in the response.

THE RECEIPT STATE. The scheduled passes in `api.main` and this door record
every receipt here, by source, so the status readback shows the last run from
any caller and the retry pass can read the first pass's reason. Per process,
like `discord_interactions._LAST_INDEX_CLOSE`.
"""
from __future__ import annotations

import os
import re
import threading
import time
from typing import Callable, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from api.routers.patterns import require_admin_or_push_secret

router = APIRouter(prefix="/api/admin/rs-discord", tags=["admin-rs-discord"])

#: The test room's webhook, read per call. A `channels.LEGACY_WEBHOOKS` row
#: (purpose `rs_leaders_test`) so the census rail sees it. Blank is 409.
TEST_WEBHOOK_ENV = "DISCORD_RS_TEST_WEBHOOK_URL"
#: The job ids `api.main` registers, in fire order (`RS_DISCORD_POST_JOBS` there;
#: a test pins the two tuples equal). The status readback lists them.
JOB_IDS = ("rs_discord_post", "rs_discord_post_retry")

_SESSION_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_LOCK = threading.Lock()
_LAST: dict = {}                    # source -> stamped receipt; "any" -> the latest of all
_SEAMS: dict = {"leaders_fn": None, "evidence_fn": None, "session_fn": None}


# ── the seams ─────────────────────────────────────────────────────────────────

def configure(*, leaders_fn: Callable, evidence_fn: Optional[Callable], session_fn: Callable) -> None:
    """Install the readers the door posts through (`api.main` calls this beside
    the mount with the scheduled job's own readers)."""
    _SEAMS.update(leaders_fn=leaders_fn, evidence_fn=evidence_fn, session_fn=session_fn)


def seams() -> dict:
    return dict(_SEAMS)


def test_webhook() -> str:
    """`DISCORD_RS_TEST_WEBHOOK_URL`, read now; blank when unset."""
    return (os.environ.get(TEST_WEBHOOK_ENV, "") or "").strip()


# ── the receipt state ─────────────────────────────────────────────────────────

def record_receipt(receipt: dict, source: str) -> dict:
    """Remember `receipt` under `source` ("scheduled", "retry", "door:test",
    "door:live") and as the latest of all; the stamped copy is returned."""
    stamped = {**(receipt or {}), "source": source, "at": time.time()}
    with _LOCK:
        _LAST[source] = stamped
        _LAST["any"] = stamped
    return dict(stamped)


def last_receipt(source: Optional[str] = None) -> Optional[dict]:
    """The last receipt recorded under `source`, or the latest of all when None."""
    with _LOCK:
        r = _LAST.get(source or "any")
    return dict(r) if r else None


class _NoMark:
    """The dedup seam for a TEST post: never says posted, never marks, so the
    member post for the same session is not skipped afterwards."""

    def posted(self, session) -> bool:
        return False

    def mark(self, session) -> None:
        return None


# ── the doors ─────────────────────────────────────────────────────────────────

@router.post("/post")
def post_rs_discord(target: Literal["test", "live"] = Query(...),
                    force: bool = Query(False),
                    dry_run: bool = Query(False),
                    session: Optional[str] = Query(None),
                    user=Depends(require_admin_or_push_secret)):
    """Fire (or dry-run) the RS leaders post by hand. Returns the poster's receipt
    plus `target` and `webhook` ("set"/"unset", never the URL). `session`
    overrides the settled session (YYYY-MM-DD) for a post about another day."""
    if session is not None and not _SESSION_RE.match(session):
        raise HTTPException(status_code=422, detail="session must be YYYY-MM-DD")
    leaders_fn, evidence_fn, session_fn = (_SEAMS["leaders_fn"], _SEAMS["evidence_fn"],
                                           _SEAMS["session_fn"])
    if leaders_fn is None or session_fn is None:
        raise HTTPException(status_code=503, detail="the RS post readers are not configured on this app")
    from api.services import rs_discord_post as rp
    if target == "test":
        url = test_webhook()
        if not url and not dry_run:
            raise HTTPException(
                status_code=409,
                detail=f"{TEST_WEBHOOK_ENV} is not set; set it to the test room's webhook "
                       "before a test post (a dry run needs no webhook).")
        dedup = _NoMark()
        webhook_set = bool(url)
    else:
        url = None                              # the module reads the member webhook itself
        dedup = None                            # and uses its own marker
        webhook_set = bool(rp.configured_webhook())
    key = session or session_fn()
    receipt = rp.post_rs_summary(key, leaders_fn=leaders_fn, evidence_fn=evidence_fn,
                                 webhook_url=url, dedup=dedup, force=bool(force), dry_run=bool(dry_run))
    stamped = record_receipt(receipt, f"door:{target}")
    return {**stamped, "target": target, "webhook": "set" if webhook_set else "unset"}


@router.get("/status")
def rs_discord_status(user=Depends(require_admin_or_push_secret)):
    """`{enabled, webhook, test_webhook, last_posted, last_receipt, jobs}`. The
    webhooks are reported "set"/"unset", never the URL."""
    from api.services import rs_discord_post as rp
    return {"enabled": rp.enabled(),
            "webhook": "set" if rp.configured_webhook() else "unset",
            "test_webhook": "set" if test_webhook() else "unset",
            "last_posted": rp.last_posted() or None,
            "last_receipt": last_receipt(),
            "jobs": list(JOB_IDS)}
