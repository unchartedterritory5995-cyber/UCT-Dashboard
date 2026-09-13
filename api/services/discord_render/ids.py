"""Correlation ids.

One id per interaction, derived from Discord's own interaction id so it is the SAME
id however many times the job is resumed, retried or logged, on whichever pod runs it.
It is short because a member reads it back to us: "id 7f3a9c21".
"""
from __future__ import annotations

import contextlib
import hashlib
import re
import threading
import uuid

CORR_ID_LEN = 8
_CORR_RE = re.compile(r"^[0-9a-f]{%d}$" % CORR_ID_LEN)
_local = threading.local()


def corr_id(interaction_id: str | None) -> str:
    """8 hex chars of sha1(interaction id); a random id when Discord sent none."""
    raw = str(interaction_id or "").strip()
    if not raw:
        return uuid.uuid4().hex[:CORR_ID_LEN]
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:CORR_ID_LEN]


def is_corr_id(value: str | None) -> bool:
    return bool(_CORR_RE.match(str(value or "")))


# ── the id and priority of the work on THIS thread ──────────────────────────
# The renderer call sits several layers under the V2 handler (handler → run_chart_job →
# produce_chart → house_fn → render_house_chart). A thread-local binding reaches it without
# changing any of those signatures; `carry` hands it across a thread pool.

def current() -> str | None:
    return getattr(_local, "cid", None)


def is_background() -> bool:
    return getattr(_local, "priority", None) == "background"


@contextlib.contextmanager
def bind(cid: str | None = None, *, background: bool | None = None):
    prev = (getattr(_local, "cid", None), getattr(_local, "priority", None))
    if cid is not None:
        _local.cid = cid
    if background is not None:
        _local.priority = "background" if background else "interactive"
    try:
        yield
    finally:
        _local.cid, _local.priority = prev


def background():
    """Mark the renders made inside as background (the warm cycle): a pooled renderer caps them."""
    return bind(background=True)


def carry(fn):
    """`fn`, re-bound to the caller's id and priority on whichever thread runs it."""
    cid, priority = current(), getattr(_local, "priority", None)

    def run(*args, **kwargs):
        with bind(cid, background=(priority == "background") if priority else None):
            return fn(*args, **kwargs)
    return run


def render_headers() -> dict:
    """Headers for a chart-renderer request: the correlation id when one is bound, and
    `X-Render-Priority: background` under `background()`."""
    headers = {}
    if is_corr_id(current()):
        headers["X-Correlation-Id"] = current()
    if is_background():
        headers["X-Render-Priority"] = "background"
    return headers
