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

import contextlib
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
            # ⛔ The three original fields keep their names, positions and meaning so
            # Session 5's samples stay comparable; the phases are appended.
            rsum, rres, rpct = phase_residual(rec, READER_PHASES, reader_ms)
            psum, pres, ppct = phase_residual(rec, POST_PHASES, rec["post_reader_ms"])
            log.info(
                "[breadth-timing] span=%s rows=%s cache=%s coalesced=%s "
                "reader_ms=%.1f post_reader_ms=%.1f total_ms=%.1f wire_bytes=%s "
                "rss_before_mb=%s rss_after_mb=%s | READER %s (sum=%s residual=%s) "
                "| POST %s (sum=%s residual=%s)",
                rec.get("span"), rec.get("rows"), rec.get("cache"), rec.get("coalesced"),
                reader_ms, rec["post_reader_ms"], total_ms, wire_bytes,
                _fmt(rec.get("rss_before_mb")), _fmt(rec.get("rss_after_mb")),
                _phase_str(rec, READER_PHASES), rsum, rres,
                _phase_str(rec, POST_PHASES), psum, pres,
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
        # ⚠️ Absent phases are OMITTED from the header rather than sent as 0 — a
        # Server-Timing entry of `dur=0` is indistinguishable from a free stage.
        for n in READER_PHASES + POST_PHASES:
            v = ((rec or {}).get("phases") or {}).get(n)
            if v is not None:
                parts.append(f"{n};dur={_phase_dur(v)}")
        return ", ".join(parts)
    except Exception:
        return ""




# ── Per-phase timing (Session 6) ──────────────────────────────────────────────

#: Every phase the instrument expects to see on a cache=miss deep read. A phase
#: MISSING from a record is reported as `absent`, never as 0.0 — the difference
#: between "this stage cost nothing" and "this stage never reported" is exactly the
#: difference that made four earlier instruments in this programme report work as
#: free.
READER_PHASES = ("merged_dates", "collector_floor", "anchor", "numeric_fetch",
                 "reconstructed_fetch", "merge_rows", "adv_seed", "derive", "cache_set")

#: ⛔ ONLY the phases that are already KNOWN at `http.response.start`. The header
#: and the main log line are both emitted there, so neither can describe work that
#: happens afterwards — and `gzip_send` was in this tuple until it was measured:
#: the middleware computed it on the body chunks, by which point the header had
#: been sent and the log line printed, so every consumer read `gzip_send=absent`
#: for a stage that had run. A phase reported as absent because its reporter had
#: already finished is the same failure as a phase reported as 0.0.
POST_PHASES = ("route_tail", "encode_render")

#: Everything after the response line exists. Reported on its OWN line, with its
#: own wall total, because the first line is gone by the time this is knowable.
#: ⚠️ It is the TRANSPORT of already-compressed bytes, not the compression:
#: starlette's GZipResponder holds `http.response.start` until it has compressed
#: the body, so on an outermost middleware the compression lands inside
#: `encode_render`. See the local split in `docs/breadth-history-reader/`.
SEND_PHASES = ("gzip_send",)


@contextlib.contextmanager
def phase(name: str):
    """Accumulate elapsed ms under `name` on the current request's record.

    ⛔ IT MUTATES THE RECORD IN PLACE AND NEVER REBINDS THE CONTEXTVAR. The route is
    a plain `def`, so FastAPI runs it in the anyio threadpool and anyio COPIES the
    context into that worker: a `ContextVar.set()` there is invisible to the
    middleware back on the event loop. A copied context still points at the same
    dict, so in-place mutation crosses the boundary and rebinding does not. That is
    the same mechanism `begin()` documents, and it is why phases can be recorded
    from inside the reader at all.
    """
    t0 = time.perf_counter()
    try:
        yield
    finally:
        try:
            rec = _ctx.get()
            if rec is not None:
                ph = rec.setdefault("phases", {})
                ph[name] = ph.get(name, 0.0) + (time.perf_counter() - t0) * 1000.0
        except Exception:
            pass


def mark(name: str) -> None:
    """Record a timestamp (perf_counter) under `name`, for spans the middleware
    closes rather than wraps."""
    try:
        rec = _ctx.get()
        if rec is not None:
            rec.setdefault("marks", {})[name] = time.perf_counter()
    except Exception:
        pass


#: The instrument's own resolution, in ms. Real phases measured on this route sit
#: at 1–17 µs at the small end (`anchor`, `cache_set`), so nothing legitimate lands
#: below this; anything that does is below what the clock can say.
_PHASE_FLOOR_MS = 0.001


def _phase_ms(v: float) -> str:
    """⛔ SUB-MILLISECOND PHASES KEEP THEIR DIGITS. At `.1f` a phase that really cost
    0.02 ms prints `0.0` — the exact string this instrument promises never to emit
    for work that happened, and the owner's control (a) is "every phase reports > 0",
    so the formatter would fail a control the code passes. Above 1 ms one decimal is
    plenty; below it, three.

    ⛔ AND BELOW ITS OWN RESOLUTION IT SAYS SO rather than printing another zero.
    `.3f` merely moved the defect down two decimal places: 0.0004 rendered `0.000`.
    "Smaller than I can measure" is a third fact, distinct from both `absent` and a
    measured value, and it is the honest one to print.
    """
    if abs(v) < _PHASE_FLOOR_MS:
        return f"<{_PHASE_FLOOR_MS:.3f}"
    return format(v, ".3f" if abs(v) < 1.0 else ".1f")


def _phase_dur(v: float) -> str:
    """The same value for `Server-Timing`, which must stay a bare number — a parser
    reading `dur=<0.001` gets nothing at all. Six decimals keeps every phase this
    route actually has (down to ~1 µs) non-zero; the log line above is the authority
    for anything finer.
    """
    return format(v, ".6f" if abs(v) < 1.0 else ".1f")


def _phase_str(rec: dict, names) -> str:
    """`name=12.3` per phase, or `name=absent` when it never reported."""
    ph = (rec or {}).get("phases") or {}
    out = []
    for n in names:
        v = ph.get(n)
        out.append(f"{n}={'absent' if v is None else _phase_ms(v)}")
    return " ".join(out)


def phase_residual(rec: dict, names, total_ms: float):
    """`(sum, residual, pct_of_total)` — what the named phases account for."""
    ph = (rec or {}).get("phases") or {}
    s = sum(v for k, v in ph.items() if k in names)
    return round(s, 1), round(total_ms - s, 1), (round(100 * s / total_ms, 1) if total_ms else None)


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
                    # Everything between the route returning its dict and the response
                    # line existing: FastAPI's jsonable_encoder and JSONResponse.render.
                    # ⭐ Measured as a SPAN between two marks rather than by patching
                    # starlette — the patch approach works locally and is not something
                    # to run on a paid route.
                    _m = (get() or {}).get("marks") or {}
                    if "route_return" in _m:
                        (get() or {}).setdefault("phases", {})["encode_render"] = (
                            (time.perf_counter() - _m["route_return"]) * 1000.0)
                    mark("response_start")
                    total_ms = (time.perf_counter() - t0) * 1000.0
                    rec = finish(total_ms, 0)
                    sent["rec"] = rec
                    st = server_timing(rec)
                    if st:
                        message.setdefault("headers", []).append(
                            (b"server-timing", st.encode("latin-1")))
                elif message.get("type") == "http.response.body":
                    sent["bytes"] += len(message.get("body") or b"")
                    # GZip compresses and the ASGI server sends between the response
                    # line and the final body chunk. Accumulated, not overwritten, so a
                    # chunked response reports the whole span.
                    _m = (get() or {}).get("marks") or {}
                    if "response_start" in _m:
                        ph = (get() or {}).setdefault("phases", {})
                        ph["gzip_send"] = (time.perf_counter() - _m["response_start"]) * 1000.0
            except Exception:
                pass
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            try:
                rec = sent["rec"]
                if rec is not None and sent["bytes"] and enabled():
                    # The header must go out before the body, so neither wire_bytes
                    # nor the send phase can be in it; both are logged here, where
                    # they are finally known. `total_with_send_ms` is the honest wall
                    # figure — `total_ms` on the line above stops at the response
                    # line and therefore prices the send at nothing.
                    log.info("[breadth-timing] span=%s wire_bytes=%s (post-gzip) "
                             "| SEND %s | total_with_send_ms=%.1f",
                             rec.get("span"), sent["bytes"],
                             _phase_str(rec, SEND_PHASES),
                             (time.perf_counter() - t0) * 1000.0)
            except Exception:
                pass
