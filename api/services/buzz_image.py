"""PNG of the buzz board, via the existing chart-renderer service.

Same contract as discord_chart_house.render_house_chart: POST /render with a
url + selector + ready_js, get PNG bytes back. Never raises -- a failed render
degrades to a text board, it does not cost the member their answer.

⛔ Readiness is not drawn-ness. `ready_js` gates on `window.__buzzReady`, which
BuzzRender.jsx flips true from its `nothingToMeasure` branch too -- i.e. a
board with ZERO rows and ZERO tail chips is "ready" by that flag's own
definition. `probe_js` counts `[data-buzz-row]` elements at capture time; the
renderer echoes it back as the `X-Chart-Probe` header, and a 0 there is
discarded as a failed render rather than delivered as a blank image. This
repo shipped blank chart PNGs twice by trusting a readiness flag instead of
counting the artifact (discord_chart_house.py's PROBE_JS is the same fix,
applied there to /chart).
"""
from __future__ import annotations

import json
import logging
import os
import threading
import time

log = logging.getLogger(__name__)

# These are the renderer's VIEWPORT, not the board. The board is a fixed
# 1000px element (BuzzRender.jsx's EXPORT_STYLE) and the renderer screenshots
# `#buzz-export`'s own box, so the viewport only has to be comfortably wider
# than the board. (It also said "and tall enough not to matter"; see the
# measured note on BOARD_H below -- that half was an assumption, not a fact.)
# ⛔ Do NOT read 1400 as the board's width. It said "1400 wide because the
# board carries EVERY ticker: a ranked column plus the themed tail in three
# sub-columns" -- there are no three sub-columns (the tail is one wrapping
# row), and while a CSS-modules bug was silently dropping the board's own
# `width: 1000px`, the board really did stretch to fill this number. That is
# fixed; this comment is what stops the next reader from re-deriving the
# layout from the viewport.
#
# ⚠️ BOARD_H WAS 1400 AND THAT CLAIM WAS NEVER MEASURED. The comment above
# said "tall enough not to matter -- a day with more tickers simply produces a
# taller PNG", which is a claim about what chart-renderer does with an element
# TALLER than the viewport it was handed, and chart-renderer is another
# service. Measured 2026-09-02: the board grew 1031 -> 1150 -> 1187 -> 1268 ->
# 1303 px across the day's checkpoints and stood at 1412 px by 3:42pm -- past
# 1400, on the first day the feature ran. Whether that would have shipped a
# clipped board or a whole one, nobody knows, which is the problem.
#
# 2400 is not a measurement, it is headroom: ~70% over the tallest board yet
# seen, on a surface whose height is set by how many DISTINCT tickers the room
# named (the tail is one wrapping row of chips, and the owner asked for every
# 1-3 mention name to stay on it). A taller viewport cannot change the layout
# -- the board declares a fixed 1000px width and the stylesheet uses no vh /
# vmin / vmax units -- so this is free insurance, not a tuning knob.
# `_warn_if_capped` below turns the remaining doubt into an OBSERVATION.
BOARD_W, BOARD_H, SCALE = 1400, 2400, 2
RENDER_TIMEOUT_S = 45.0

# ── The valve. Every /chart render passes through discord_interactions'
# RENDER_SLOTS (default 4) with a cache and single-flight in front of it. This
# path had NONE of that while being MEMBER-TRIGGERED: each in-flight /buzz
# pins one anyio worker on the single-process web pod for up to
# RENDER_TIMEOUT_S, and fires an unbounded Playwright render at the one
# chart-renderer the 4-slot valve exists to protect. 25 members running /buzz
# in a minute is the 2026-07-01 threadpool-exhaustion outage, plus /chart --
# which politely waits for a slot -- degrading underneath it.
#
# The board is BYTE-IDENTICAL for every caller inside a poll interval, so the
# cache collapses that burst to one render. Both waits are bounded on purpose:
# a caller that cannot get the image quickly returns None and the member still
# gets the text board, which is the whole degrade-never-apologise contract.
_CACHE_TTL_S = float(os.environ.get("BUZZ_IMAGE_CACHE_TTL_S", "60"))
_FLIGHT_WAIT_S = float(os.environ.get("BUZZ_IMAGE_FLIGHT_WAIT_S", "20"))
_SLOT_WAIT_S = float(os.environ.get("BUZZ_IMAGE_SLOT_WAIT_S", "8"))

_CACHE: dict[str, tuple[float, bytes]] = {}
_CACHE_LOCK = threading.Lock()
_FLIGHT_LOCKS: dict[str, threading.Lock] = {}


def _cache_get(window: str) -> bytes | None:
    with _CACHE_LOCK:
        hit = _CACHE.get(window)
        if not hit:
            return None
        made, png = hit
        if time.monotonic() - made > _CACHE_TTL_S:
            _CACHE.pop(window, None)
            return None
        return png


def _cache_put(window: str, png: bytes) -> None:
    with _CACHE_LOCK:
        _CACHE[window] = (time.monotonic(), png)


def _flight_lock(window: str) -> threading.Lock:
    with _CACHE_LOCK:
        return _FLIGHT_LOCKS.setdefault(window, threading.Lock())


def _reset_for_tests() -> None:
    """Drop cache + flight state so one test's render cannot answer another's."""
    with _CACHE_LOCK:
        _CACHE.clear()
        _FLIGHT_LOCKS.clear()


READY_JS = "() => window.__buzzReady === true"

# Measure the artifact, do not trust the flag. Comes back as the X-Chart-Probe
# header (see _probe_rows), and the result is a single integer:
#
#     > 0   rows drawn, board at its declared width  -> keep
#     = 0   ready but nothing drawn                  -> discard
#     < 0   rows drawn but the board is the WRONG WIDTH; the magnitude is the
#           width actually measured                  -> discard
#
# ⛔ THE WIDTH ARM EXISTS BECAUSE COUNTING ROWS WAS NOT ENOUGH. A `#buzz-export`
# rule in a CSS *module* is hashed by css-modules and matches nothing, so the
# board silently lost `width: 1000px` and stretched to fill chart-renderer's
# 1400px viewport (measured 1915px, with the row grid's flexible column at
# 1309px instead of 394px). Every row still EXISTED, so this probe returned a
# healthy count and the mislaid-out PNG shipped for two days. A probe built to
# catch an EMPTY artifact says nothing about a WRONG one.
#
# ⛔ The expected width is NOT restated here. BuzzRender.jsx publishes its own
# declared width as `window.__buzzBoardW`, and the probe compares the measured
# box against that — so the number has exactly one authority (the component
# that sets it), and this module cannot drift from it. A page that does not
# publish the value (an older cached bundle) falls through to the plain row
# count, i.e. the behaviour that existed before this check.
#
# Failure direction: if a renderer cannot evaluate this expression the header
# is absent, _probe_rows returns None, and the image is KEPT — the same
# fallback as an older renderer. Tightening the probe can never cost a member
# their board.
_PROBE_W_TOLERANCE_PX = 2
PROBE_JS = (
    "(() => {"
    " const el = document.getElementById('buzz-export');"
    " if (!el) return 0;"
    " const rows = document.querySelectorAll('[data-buzz-row]').length;"
    " const want = window.__buzzBoardW;"
    " if (!want) return rows;"
    " const w = Math.round(el.getBoundingClientRect().width);"
    " return Math.abs(w - want) <= %d ? rows : -w;"
    "})()" % _PROBE_W_TOLERANCE_PX
)


def image_enabled() -> bool:
    if os.environ.get("BUZZ_IMAGE_ENABLED", "1").strip().lower() in ("0", "false", "off", ""):
        return False
    return bool(os.environ.get("CHART_RENDERER_URL", "").strip())


def png_size(png: bytes) -> tuple[int, int] | None:
    """(width, height) in device pixels from a PNG's IHDR, or None.

    The IHDR chunk is fixed-position: an 8-byte signature, a 4-byte length, the
    type "IHDR", then width and height as big-endian uint32. No decoder needed
    and nothing to install.

    Matched on the signature's ASCII run (bytes 1..4 == "PNG") rather than its
    0x89 lead byte: the caller has already checked the full signature, and
    writing that escape here keeps arriving as a literal 0x89 character
    (lesson_a_heredoc_turns_backslash_b_into_a_backspace)."""
    if len(png) < 24 or png[1:4] != b"PNG" or png[12:16] != b"IHDR":
        return None
    return (int.from_bytes(png[16:20], "big"), int.from_bytes(png[20:24], "big"))


def _warn_if_capped(png: bytes) -> None:
    """Say so, loudly, if the shot came back exactly viewport-tall.

    ⛔ THIS IS AN OBSERVATION, NOT A GUARD. Whether chart-renderer captures an
    element taller than its viewport, or crops it, is a property of ANOTHER
    service; asserting either way here would just be the old comment's mistake
    with more words. So this measures the artifact that came back and records
    the one shape that is diagnostic -- a height landing exactly on
    BOARD_H * SCALE, which a freely-grown board has no reason to do.

    It never discards. A cropped board is still most of a board, and a member
    losing their image over a heuristic about a sibling service is a worse
    outcome than a slightly short one. The log line is what turns "we think it
    is fine" into something a person can grep for.
    """
    size = png_size(png)
    if size and size[1] >= BOARD_H * SCALE:
        log.warning("[buzz] board PNG is %dx%d -- at or past the %dpx viewport "
                    "(BOARD_H=%d x scale %d). If boards look cut off at the "
                    "bottom, this is why; raise BOARD_H.",
                    size[0], size[1], BOARD_H * SCALE, BOARD_H, SCALE)


def _probe_rows(resp) -> int | None:
    """Rows the page says it drew, or None when the renderer did not say (an
    older renderer/bundle without X-Chart-Probe). Unknown falls through to
    "keep the image" -- exactly the behaviour that existed before the probe."""
    raw = resp.headers.get("X-Chart-Probe")
    if raw is None:
        return None
    try:
        v = json.loads(raw)
    except (TypeError, ValueError):
        return None
    return v if isinstance(v, int) and not isinstance(v, bool) else None


def render_board_png(window: str = "open", *, client=None) -> bytes | None:
    """Cached, single-flighted, slot-limited board render. See the valve note
    above. Returns None on every failure path -- the caller degrades to the
    text board rather than apologising."""
    png = _cache_get(window)
    if png is not None:
        return png

    lock = _flight_lock(window)
    # A bounded wait, not a queue: a caller that cannot get in inside
    # _FLIGHT_WAIT_S releases its anyio worker instead of holding it for the
    # leader's full RENDER_TIMEOUT_S.
    if not lock.acquire(timeout=_FLIGHT_WAIT_S):
        return _cache_get(window)
    try:
        # The leader may have finished while we waited on the lock.
        png = _cache_get(window)
        if png is not None:
            return png
        png = _render_uncached(window, client=client)
        if png:
            _cache_put(window, png)
        return png
    finally:
        lock.release()


def _render_uncached(window: str = "open", *, client=None) -> bytes | None:
    renderer = os.environ.get("CHART_RENDERER_URL", "").strip().rstrip("/")
    if not renderer:
        return None
    base = os.environ.get("CHART_RENDER_BASE_URL", "https://uctintelligence.com")
    token = os.environ.get("CHART_RENDER_TOKEN", "")
    secret = os.environ.get("CHART_RENDERER_SECRET", "")
    url = f"{base}/r/buzz?token={token}&window={window}"

    # Share /chart's bounded valve rather than opening a second, unbounded
    # lane at the same renderer. Imported lazily: discord_interactions is a
    # heavy module and nothing here needs it until a render actually happens.
    from api.services.discord_interactions import RENDER_SLOTS
    if not RENDER_SLOTS.acquire(timeout=_SLOT_WAIT_S):
        log.info("[buzz] no render slot within %.0fs -- text-only board", _SLOT_WAIT_S)
        return None
    try:
        import httpx
        own = client is None
        c = client or httpx.Client(timeout=RENDER_TIMEOUT_S)
        try:
            r = c.post(f"{renderer}/render", headers={"X-Render-Secret": secret}, json={
                "url": url, "selector": "#buzz-export",
                "width": BOARD_W, "height": BOARD_H, "scale": SCALE,
                "settle_ms": 400, "ready_js": READY_JS, "ready_timeout_ms": 15000,
                "probe_js": PROBE_JS,
            })
            if not r.is_success:
                log.warning("[buzz] render HTTP %s: %s", r.status_code, r.text[:160])
                return None
            if not r.content.startswith(b"\x89PNG"):
                log.warning("[buzz] render returned non-PNG")
                return None
            probe = _probe_rows(r)
            if probe == 0:
                log.warning("[buzz] render ready but empty (0 rows) -- discarding")
                return None
            if probe is not None and probe < 0:
                # Rows drew, but not at the declared width — the export
                # container lost its geometry. The PNG would be legible enough
                # to look shippable and wrong enough to be worthless.
                log.warning("[buzz] board rendered %dpx wide, not its declared width "
                            "-- discarding (export container lost its geometry)", -probe)
                return None
            _warn_if_capped(r.content)
            return r.content
        finally:
            if own:
                c.close()
    except Exception as e:  # noqa: BLE001
        log.warning("[buzz] render failed: %s", e)
        return None
    finally:
        RENDER_SLOTS.release()
