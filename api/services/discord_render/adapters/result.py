"""The one envelope every provider adapter returns (03 §3.8; step 2.4b P2.1).

A command handler must be able to answer four questions about any payload without knowing which
upstream produced it, or how:

  1. Did it work?                      `ok`
  2. Who answered, and how?            `provider`, `degraded_reasons`
  3. How old is the DATA?              `as_of` / `session` / `stale` — the data's vintage, never the
                                       wall clock, because the same closed-market input must render
                                       the same pixels (§3.10)
  4. Which member's job was this?      `corr_id`

⛔ A FAILURE IS A VALUE, NOT AN EXCEPTION. `fetch()` returns `Result(ok=False, ...)` carrying a
named class; it does not raise. Half of C-08 was a bare `except Exception` turning four distinct
causes — timeout, 5xx, breaker open, empty answer — into one message ("the flow feed is
reconnecting") that was wrong for three of them. A caller cannot tell those apart from a traceback
it never sees, and a member cannot act on a sentence that is true for none of the reasons it
appears.

⛔ `stale=None` IS NOT `stale=False`. Unknown vintage means the badge is ABSENT, not reassuring.
The property below returns `None` rather than defaulting, for the same reason `freshness.Envelope`
does: a caller that renders `None` as "fine" is the bug this exists to prevent.

⭐ `as_of`, `session` and `stale` are DERIVED from `envelope`, never stored beside it. The spec
names them as fields, and it would be easy to copy them in at construction — that is
`lesson_a_second_authority_over_one_value`, and this repo has paid for it three times in a week.
One value, one owner, derive the rest.
"""
from __future__ import annotations

from dataclasses import dataclass, field, replace
from typing import Any

from api.services.discord_render.freshness import Envelope

# ── the failure taxonomy ────────────────────────────────────────────────────
#
# ⛔ EVERY ONE OF THESE IS A DIFFERENT SENTENCE TO A MEMBER AND A DIFFERENT ACTION FOR US.
# They are the `degraded_reasons` vocabulary; §3.5's failure contract maps them to copy. Adding a
# reason means adding the copy in the same commit — an unmapped class renders as a generic apology,
# which is the state C-08 describes.
TIMEOUT = "timeout"                  # we gave up waiting; the upstream may be fine
BREAKER_OPEN = "breaker_open"        # we did not even call it — it is already failing (§3.8)
UNREACHABLE = "unreachable"          # we could not reach it: connect refused, no route, no address
UPSTREAM_ERROR = "upstream_error"    # it ANSWERED, with a failure (a 5xx, or `ok: false`)
EMPTY = "empty"                      # it answered, successfully, with nothing usable
BAD_SHAPE = "bad_shape"              # it answered with something we cannot read
NOT_CARRIED = "not_carried"          # this symbol is not in the dataset (a user error, not ours)
STALE = "stale"                      # served, but the vintage is behind the session (§3.8b)
CACHED = "cached"                    # served from our own last-good copy, not from the upstream
DEADLINE = "deadline"                # the JOB's remaining budget was gone before we could ask

#: ⛔ `UNREACHABLE` AND `UPSTREAM_ERROR` ARE THE C-08 DISTINCTION AND MUST NOT BE MERGED AGAIN.
#: "we could not reach it" and "it answered with an error" are different sentences to a member, a
#: different next action for us, and — in the flow adapter — decide whether the in-process fallback
#: is even attempted. They were one `except` for two weeks, and the reply was wrong for both.
#:
#: The classes that mean "nothing usable came back". `STALE` and `CACHED` are deliberately NOT here:
#: a labelled stand-in is a DELIVERY (S8), and counting it as a failure would hide a renderer outage
#: inside a green success rate — the exact thing `/renderhealth` reports house-quality rate beside.
FATAL_REASONS = frozenset({TIMEOUT, BREAKER_OPEN, UNREACHABLE, UPSTREAM_ERROR, EMPTY, BAD_SHAPE,
                           NOT_CARRIED, DEADLINE})

ALL_REASONS = frozenset(FATAL_REASONS | {STALE, CACHED})


@dataclass(frozen=True)
class Result:
    """What every adapter's `fetch(request)` returns. Frozen: a Result is a record of what happened,
    and a caller that can edit it can make the record disagree with the event."""

    ok: bool
    data: Any = None
    #: Which serve layer actually answered — `"bars_store"`, `"massive"`, `"cache"`, `"renderer"`…
    #: Not the vendor: the layer, because that is what changes the latency and what an operator acts on.
    provider: str | None = None
    #: The data's vintage stamp. `None` when we could not establish one, which is NOT "fresh".
    envelope: Envelope | None = None
    #: Named classes from the taxonomy above, in the order they occurred. Never free text.
    degraded_reasons: tuple[str, ...] = ()
    corr_id: str | None = None
    #: Wall-clock milliseconds this adapter spent, for the latency budget in §2. Measured, not guessed.
    elapsed_ms: float | None = None
    #: Anything the adapter wants to log that is not part of the contract (attempt counts, the URL
    #: path — never a token, never a query string; `observe.scrub` owns that).
    meta: dict = field(default_factory=dict)

    # ── derived, never stored (see the module docstring) ────────────────────
    @property
    def as_of(self) -> str | None:
        """The newest datum's timestamp, ISO-8601 UTC. `None` when the vintage is unknown."""
        return self.envelope.as_of_utc if self.envelope else None

    @property
    def as_of_et(self) -> str | None:
        return self.envelope.as_of_et if self.envelope else None

    @property
    def session(self) -> str | None:
        """`holiday | weekend | pre | rth | post | overnight` at the time of the fetch."""
        return self.envelope.session_state if self.envelope else None

    @property
    def vintage(self) -> dict | None:
        """The whole stamp, for logging and for the footer. `Envelope.as_dict()`."""
        return self.envelope.as_dict() if self.envelope else None

    @property
    def stale(self) -> bool | None:
        """⛔ Three-valued on purpose: True · False · None (unknown, and unknown is NOT fresh)."""
        return self.envelope.stale if self.envelope else None

    @property
    def degraded(self) -> bool:
        """Served, but not at house quality. A successful fetch with a reason is still degraded."""
        return bool(self.degraded_reasons)

    @property
    def badge(self) -> str | None:
        """What the member is told about the vintage, or None when there is nothing to warn about."""
        return self.envelope.badge if self.envelope else None

    def reason(self) -> str | None:
        """The FIRST class, which is the one that caused everything after it. §3.5 keys its copy off
        this: a member gets one honest sentence, not a list of everything that went wrong."""
        return self.degraded_reasons[0] if self.degraded_reasons else None

    def with_reason(self, *reasons: str) -> "Result":
        """A copy carrying additional classes, de-duplicated, order preserved. Used by a caller that
        learns something the adapter could not know — a cache hit is `CACHED` at the layer that
        chose the cache, not inside the adapter that failed."""
        for r in reasons:
            if r not in ALL_REASONS:
                raise ValueError(f"{r!r} is not in the failure taxonomy; add it beside its §3.5 copy")
        merged = list(self.degraded_reasons)
        merged += [r for r in reasons if r not in merged]
        return replace(self, degraded_reasons=tuple(merged))

    def as_event(self) -> dict:
        """The flat shape `observe.event` logs. ⛔ `data` is NEVER included — it is bars, a PNG or a
        flow card, and a log line is not where any of those belong."""
        out = {
            "ok": self.ok,
            "provider": self.provider,
            "degraded": ",".join(self.degraded_reasons) or None,
            "corr_id": self.corr_id,
            "elapsed_ms": round(self.elapsed_ms, 1) if self.elapsed_ms is not None else None,
            "as_of": self.as_of,
            "session": self.session,
            # ⛔ "unknown", not omitted. The `is not None` filter below would drop a three-valued
            # None, and an ABSENT field reads to an operator as "nothing to report" — which is the
            # opposite of what an unestablished vintage means (§3.8b).
            "stale": "unknown" if (self.envelope is not None and self.stale is None) else self.stale,
        }
        out.update({k: v for k, v in self.meta.items() if k not in out})
        return {k: v for k, v in out.items() if v is not None}


def ok(data, *, provider: str, envelope: Envelope | None = None, corr_id: str | None = None,
       elapsed_ms: float | None = None, reasons: tuple[str, ...] = (), **meta) -> Result:
    """A successful fetch. It may still carry reasons — `STALE` and `CACHED` are served, labelled.

    ⛔ `STALE` IS DERIVED FROM THE ENVELOPE, NEVER PASSED IN. The first version let a caller hand it
    over, and the first smoke test produced a log line reading `degraded=stale` beside `stale=False`
    — two authorities over one value, contradicting each other inside a single event. The envelope
    decides; passing a `STALE` that disagrees with it is refused rather than reconciled, because a
    caller who believes the data is stale when the clock says otherwise has a bug worth seeing."""
    bad = [r for r in reasons if r in FATAL_REASONS]
    if bad:
        raise ValueError(f"ok() cannot carry a fatal class {bad}; that is a failure, use fail()")
    verdict = envelope.stale if envelope else None
    out = [r for r in reasons if r != STALE]
    if STALE in reasons and verdict is not True:
        raise ValueError(
            f"STALE was passed but the envelope says stale={verdict!r}. The envelope is the single "
            "authority (§3.8b) — do not label a payload stale beside a stamp that says it is not.")
    if verdict is True:
        out.append(STALE)
    return Result(True, data, provider, envelope, tuple(out), corr_id, elapsed_ms, dict(meta))


def fail(reason: str, *, provider: str | None = None, corr_id: str | None = None,
         elapsed_ms: float | None = None, envelope: Envelope | None = None, **meta) -> Result:
    """A failed fetch, named. ⛔ There is no unnamed failure: `reason` must be in the taxonomy, so a
    caller can always map it to a sentence and an operator can always count it."""
    if reason not in ALL_REASONS:
        raise ValueError(f"{reason!r} is not in the failure taxonomy; add it beside its §3.5 copy")
    return Result(False, None, provider, envelope, (reason,), corr_id, elapsed_ms, dict(meta))
