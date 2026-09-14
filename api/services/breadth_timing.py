"""Per-request timing for the breadth history route — the production half of §2.

⭐ WHY THIS EXISTS. Session 1 timed a FUNCTION CALL (`get_history_deep`, 1,860 ms
on production's own bytes, locally). D-042 timed an HTTPS ROUND TRIP (54,923 ms).
Those are not the same measurement, and the difference between them contains the
FastAPI encoder, GZip over a 5 MB payload, the anyio threadpool queue, the pod's
CPU share, and the Cloudflare hop. Locally the whole of that is 561.7 ms on the
8,000-day span (14.3 % of a 3.9 s full-stack request), so it cannot be a 30x on
this box — but "cannot be here" is not "is not there", and the only instrument
that can tell them apart runs on the pod.

⛔ NO MEMBER IDENTIFIERS. This records what the SERVER did — span, row count,
bytes, milliseconds, resident memory. No user id, no email, no session, no IP, no
cookie. A diagnostic that quietly becomes a member-activity log is a different
artifact with different rules, and it is not this one.

⛔ IT CAN NEVER BREAK A REQUEST. Every entry point swallows its own exceptions and
returns. A timing probe that can 500 a paid route has cost more than it measures.

Kill switch: `BREADTH_TIMING_LOG=0` (unset or anything else = ON). It is a
diagnostic, so the default is ON and the switch silences it; the opposite default
would make "nobody set it" indistinguishable from "somebody turned it off".
"""
from __future__ import annotations

import contextvars
import logging
import os
import time

log = logging.getLogger(__name__)

_ROUTE = "/api/breadth-monitor"
_ctx: contextvars.ContextVar[dict | None] = contextvars.ContextVar("breadth_timing", default=None)

_PAGE = 4096
try:  # Linux only; the pod is Linux, this box is not.
    _PAGE = os.sysconf("SC_PAGE_SIZE")
except (AttributeError, ValueError, OSError):  # pragma: no cover
    pass


def enabled() -> bool:
    return os.environ.get("BREADTH_TIMING_LOG", "1").strip().lower() not in ("0", "false", "no", "off")


def rss_mb() -> float | None:
    """Resident set size in MB, or None where it cannot be read.

    ⛔ None is a DIFFERENT FACT from 0.0 and is reported as such. The local
    harness for this programme read RSS through an unchecked ctypes call and got
    0.0 MB for every sample — a number a reader would happily quote as "the read
    costs no memory". An unreadable gauge says so.
    """
    try:
        with open("/proc/self/statm", "r", encoding="ascii") as fh:
            return int(fh.read().split()[1]) * _PAGE / 1048576.0
    except Exception:
        return None


def begin(**fields) -> dict | None:
    """Open a per-request record, or JOIN the one the middleware already opened.

    ⛔ THE MERGE IS THE WHOLE POINT, and the first version got it wrong. The route
    is a plain `def`, so FastAPI runs it in the anyio threadpool; anyio COPIES the
    context into that worker, so a `ContextVar.set()` performed there is invisible
    to the middleware back on the event loop. The probe therefore reported
    `reader_ms=0.0` for a reader that had just run — a stage that did work, priced
    at nothing, which is the single most flattering way an instrument can fail.

    ⭐ A copied context still holds a REFERENCE to the same dict, so mutating the
    record in place crosses the boundary while rebinding the variable does not.
    The middleware creates it on the event loop; the route updates it in the
    worker; both see one object.
    """
    try:
        rec = _ctx.get()
        if rec is None:
            rec = {"t0": time.perf_counter(), "rss_before_mb": rss_mb()}
            _ctx.set(rec)
        rec.update(fields)
        return rec
    except Exception:
        return None


def note(**fields) -> None:
    try:
        rec = _ctx.get()
        if rec is not None:
            rec.update(fields)
    except Exception:
        pass


def get() -> dict | None:
    try:
        return _ctx.get()
    except Exception:
        return None


def finish(total_ms: float, wire_bytes: int) -> dict:
    """Close the record and emit ONE structured line. Returns it for the header."""
    rec = get() or {}
    try:
        reader_ms = float(rec.get("reader_ms") or 0.0)
        rec["total_ms"] = round(total_ms, 1)
        # ⚠️ post_reader_ms is NOT "the encoder". It is everything after the reader
        # returns: jsonable_encoder, JSONResponse.render, GZip, the ASGI send, and
        # any time this request spent waiting for a threadpool worker. Locally that
        # whole bundle is 561.7 ms on an 8,000-day span. It is reported as one
        # number because production cannot separate them without patching starlette,
        # and a bundle honestly named beats four numbers three of which are guesses.
        rec["post_reader_ms"] = round(total_ms - reader_ms, 1)
        rec["wire_bytes"] = wire_bytes
        rec["rss_after_mb"] = rss_mb()
        if enabled():
            log.info(
                "[breadth-timing] span=%s rows=%s cache=%s coalesced=%s "
                "reader_ms=%.1f post_reader_ms=%.1f total_ms=%.1f wire_bytes=%s "
                "rss_before_mb=%s rss_after_mb=%s",
                rec.get("span"), rec.get("rows"), rec.get("cache"), rec.get("coalesced"),
                reader_ms, rec["post_reader_ms"], total_ms, wire_bytes,
                _fmt(rec.get("rss_before_mb")), _fmt(rec.get("rss_after_mb")),
            )
    except Exception:
        pass
    return rec


def _fmt(v):
    return "unreadable" if v is None else round(v, 1)


def server_timing(rec: dict) -> str:
    """`Server-Timing`, so the breakdown is readable from a browser's network tab
    and from a one-line curl — not only from a log nobody can reach in a hurry."""
    try:
        parts = [f"reader;dur={float(rec.get('reader_ms') or 0.0):.1f}",
                 f"post;dur={float(rec.get('post_reader_ms') or 0.0):.1f}",
                 f"total;dur={float(rec.get('total_ms') or 0.0):.1f}"]
        return ", ".join(parts)
    except Exception:
        return ""



def _span_of(scope) -> str:
    """`days` off the query string, for the log line. Never raises, never reads
    anything but that one integer-ish parameter."""
    try:
        qs = (scope.get("query_string") or b"").decode("latin-1")
        for part in qs.split("&"):
            if part.startswith("days="):
                return part[5:][:8]
    except Exception:
        pass
    return "default"


class BreadthTimingMiddleware:
    """Pure-ASGI, OUTERMOST, and scoped to exactly one path.

    Outermost because GZip must be INSIDE the measurement — compressing 5 MB is one
    of the stages this exists to price. Scoped to the exact path because
    `/api/breadth-monitor` has ~30 sibling admin routes and a log line per sweep
    call is noise that gets the useful line muted.
    """

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get("type") != "http" or scope.get("path") != _ROUTE:
            await self.app(scope, receive, send)
            return
        t0 = time.perf_counter()
        # Opened HERE, on the event loop, so the record the threadpool worker
        # mutates is the record this middleware later reads. See begin().
        _ctx.set(None)
        begin(span=_span_of(scope))
        sent = {"bytes": 0, "rec": None}

        async def _send(message):
            try:
                if message.get("type") == "http.response.start":
                    total_ms = (time.perf_counter() - t0) * 1000.0
                    rec = finish(total_ms, 0)
                    sent["rec"] = rec
                    st = server_timing(rec)
                    if st:
                        message.setdefault("headers", []).append(
                            (b"server-timing", st.encode("latin-1")))
                elif message.get("type") == "http.response.body":
                    sent["bytes"] += len(message.get("body") or b"")
            except Exception:
                pass
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            try:
                rec = sent["rec"]
                if rec is not None and sent["bytes"] and enabled():
                    # The header must go out before the body, so wire_bytes cannot
                    # be in it; it is logged here, where it is finally known.
                    log.info("[breadth-timing] span=%s wire_bytes=%s (post-gzip)",
                             rec.get("span"), sent["bytes"])
            except Exception:
                pass
