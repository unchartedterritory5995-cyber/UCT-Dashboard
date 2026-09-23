"""D2 top-level CP3, LINE 5 (approval sha `d1da6f5b7`) -- the scheduled warm
reader that supplies real read traffic to `ticker_returns.py`'s DARK
dual-compute rail. Packet:
`docs/terminal-research/12-decisions/gates/d2-canonical-data-model-pre-implementation-gate.md`,
section "APPROVAL -- LINE 5 (top-level CP3)".

⛔ THE BLOCKER THIS ANSWERS. `ticker_returns._close()` is the ONE migrated D2
reader, and it only fires when a member opens a Desk video that has real
ticker moments recorded -- `D2_DUAL_COMPUTE_SAMPLE_PCT` is unset on `web`
(confirmed live), so the sampler is already at its 100% default; the shortfall
was never the sample RATE, it was call VOLUME. A read-only dry run (one pass
through every published Desk video via the smoke account's real session)
measured 328 total videos, 278 with real ticker moments + resolvable bars,
2,109 distinct symbol observations, and an estimated ~8,026 `_close()` calls
in that single pass -- roughly 40x the gate's >=200-agreed-rows bar. The
remaining blocker is the SESSION-SPAN requirement (first sample <=09:45 ET,
last sample >=15:45 ET, same session_date) -- a bigger single pass does not
help; the schedule has to straddle the session.

⭐ DESIGN DECISION -- IN-PROCESS, NOT HTTP-THROUGH-THE-SMOKE-ACCOUNT. Read this
before changing it.

The packet's proposed mechanism was: call `GET /api/education/videos/{id}/
ticker-returns` through the smoke account's genuine `require_paid` session --
"the exact route a member's browser calls." Read against the route it names
(`api/routers/education.py::get_video_ticker_returns`), the whole handler is:

    @router.get("/videos/{video_id}/ticker-returns")
    def get_video_ticker_returns(video_id: int, _user: dict = Depends(require_paid)):
        from api.services import ticker_returns
        return ticker_returns.returns_for_video(int(video_id))

An auth check, then a bare pass-through to `returns_for_video()` -- the exact
function this module calls. The dual-compute observation the packet exists to
feed lives entirely inside `ticker_returns._close()` -> `dual_read.observe()`
-> `dual_sample_store.record()`, and none of those three functions read the
caller's identity, session, or transport -- they only see the `(reader, key,
legacy, book)` values `_close()` hands them. An HTTP round trip through a
minted smoke-account cookie jar would write the byte-identical row to
`d2_dual_samples.db` as this in-process call does, at the cost of: a stored
password this scheduled job would have to read on every tick (new
credential-handling surface INSIDE the application -- today only the manual
operator script `tools/smoke_login_link.py` ever touches those creds, and it
mints a link for a human, it does not run unattended on a cron), a
self-directed HTTP round trip this single-process app has no existing pattern
for outside the partner-owned worker proxy, and a new dependency on the smoke
account's session/subscription state never lapsing -- none of which the
dual-compute mechanism needs in order to see a disagreement.

The packet draws its precedent from A9, where a hand-inserted row was rejected
in favor of a real subscribe call -- because A9's HTTP path does real work an
in-process call would skip (genuine Stripe-adjacent subscription state).
`ticker_returns`'s HTTP path does no such work; it is the identical function
call sitting under an auth decorator. Calling `ticker_returns.returns_for_video()`
directly is therefore not "a hand-inserted row" in the sense A9 was avoiding --
it is the SAME production code the route calls, with the same 600s cache, the
same `_close()`, the same `_dual.observe()`. It satisfies the packet's own
stated goal verbatim: *"generating dual-compute samples through the
already-built, already-tested `_dual.observe()` path. Nothing new is wired;
this only supplies the traffic the existing mechanism has been waiting on."*

⛔ FLAGGED FOR THE OWNER / INTEGRATING SESSION, RATHER THAN GUESSED PAST
SILENTLY. The packet's own "Scope, if signed" clause literally names the HTTP
route + the smoke account, not "a call to `returns_for_video()`". If the
intent behind that specific wording was ALSO to exercise the `require_paid`
auth boundary itself as a standing health check, or to leave a visible
smoke-account access-log trail as corroborating evidence, this module does
not deliver either of those -- only the dual-compute traffic. Nothing here
forecloses adding the HTTP variant later; `run_warm_pass()` below is the
single seam a future HTTP-based implementation would need to preserve
(iterate videos with ticker moments, call the ticker-returns path once per
video, tolerate one video's failure without losing the tick).

⛔ CACHE-AWARENESS -- the packet's explicit precondition, or this does
nothing. `returns_for_video()` caches its payload for `ticker_returns._TTL_SECS`
(600s) and returns the cached copy WITHOUT calling `_close()` again on a hit --
a repeat hit on the same video inside that window produces ZERO new samples.
This module always walks the FULL set of videos carrying ticker moments on
every tick (round-robin, the packet's own named remedy, chosen over
per-video timestamp bookkeeping as the simpler of the two options it offers),
so as long as the scheduler's cadence between ticks exceeds 600s -- it is
hourly, see `api/main.py`'s `d2_dual_compute_warm_reader` registration -- every
video is guaranteed cold by the time its next tick arrives.
"""
from __future__ import annotations

import logging

from api.services import education_service as edu
from api.services import ticker_returns

_logger = logging.getLogger(__name__)


def run_warm_pass() -> dict:
    """One tick: call `ticker_returns.returns_for_video()` for every Desk video
    that carries at least one real ticker moment.

    Never raises. A scheduler job that raises loses the whole tick, and one bad
    video (a deleted symbol, a corrupt insights blob, a momentary bars-store
    hiccup) must not silence every video queued behind it in the same pass --
    the whole point of this module is supplying traffic, and traffic that stops
    at the first failure is not what the gate is waiting on.
    """
    try:
        videos = edu.videos_with_ticker_moments()
    except Exception as e:                                  # noqa: BLE001
        _logger.exception("[d2-warm-reader] could not list videos with ticker moments")
        return {"videos_total": 0, "videos_ok": 0, "symbols_returned": 0,
                "errors": [], "list_error": str(e)}

    ok = 0
    symbols_returned = 0
    errors: list = []
    for v in videos:
        vid = v.get("id")
        try:
            payload = ticker_returns.returns_for_video(int(vid))
            ok += 1
            symbols_returned += len(payload.get("returns") or {})
        except Exception as e:                              # noqa: BLE001
            errors.append({"video_id": vid, "error": str(e)})
            _logger.warning("[d2-warm-reader] video %s failed: %s", vid, e)

    return {
        "videos_total": len(videos),
        "videos_ok": ok,
        "symbols_returned": symbols_returned,
        "errors": errors,
    }
