"""The cross-lane contracts, frozen 2026-09-13 (07-execution-plan §4).

Five boundaries are being built against concurrently by separate lanes. Each one is written and
tested HERE before either side builds, so that "what does the cache hand back?" and "what does the
badge take?" have one answer instead of two that agree until they do not.

⛔⛔ A CHANGE TO ANYTHING IN THIS FILE AFTER THE LANES ARE RUNNING IS A LEDGERED EVENT WITH A REASON.
Not because change is bad, but because a contract that moves silently is worse than no contract: the
lane on the other side is still building against the old shape and will not find out until
integration, which is exactly the time nobody has.

⛔ AND A `Protocol` IS NOT A RAIL. `typing.Protocol` is checked by a type checker this repo does not
run in CI, so on its own it is a comment with syntax. `tests/test_discord_render_contracts.py` is
what makes these load-bearing: it asserts the real modules satisfy the shapes, with a control
proving a wrong shape is rejected. A contract nobody can fail is documentation.
"""
from __future__ import annotations

from typing import Any, Callable, Protocol, runtime_checkable

from api.services.discord_render.adapters.result import ALL_REASONS, Result  # noqa: F401  (re-export)

# ── 1 · the adapter boundary (P2.1, frozen — already shipped at 5ca4d5db2) ──


@runtime_checkable
class Adapter(Protocol):
    """Every provider adapter. `fetch` NEVER raises and NEVER returns a bare `None`.

    A failure is a `Result(ok=False)` carrying a class from `ALL_REASONS`, because a caller cannot
    tell four causes apart from a traceback it never sees (C-08)."""

    NAME: str
    TIMEOUT_S: float

    def fetch(self, request: Any) -> Result: ...


#: The shape a binding hands to `produce_chart`. Kept as a name so a lane can cite it.
BarsFn = Callable[[str, str, int], "list[dict] | None"]
QuoteFn = Callable[[str], "tuple[str, float] | None"]
HouseFn = Callable[..., "bytes | None"]


# ── 2 · the artifact cache boundary (2.5, Lane B) ───────────────────────────


@runtime_checkable
class CacheKey(Protocol):
    """⛔⛔ THE KEY CARRIES THE DATA'S VINTAGE, NEVER THE WALL CLOCK.

    `(command, normalised args, vintage)`. If the third part were "now", the same closed-market
    input would cache under a new key every second: the hit rate would collapse, and §3.10's
    determinism guarantee — the same input renders the same pixels — would be unobservable because
    no two runs would ever share an entry. It is also the only way a STALE payload and a fresh one
    can coexist without one silently serving for the other."""

    command: str
    args: str
    vintage: str | None


@runtime_checkable
class CachedArtifact(Protocol):
    """What comes back out. `stored_at` is when WE cached it; `envelope` is how old the DATA is.

    ⛔ THOSE ARE DIFFERENT NUMBERS AND BOTH ARE NEEDED. `stored_at` decides eviction; the envelope
    decides what the member is told. A cache that kept only `stored_at` would hand back a week-old
    chart labelled "cached 30 seconds ago", which is true and completely misleading."""

    data: Any
    envelope: Any            # freshness.Envelope | None — None means unknown, NOT fresh
    stored_at: float
    provider: str | None


@runtime_checkable
class ArtifactStore(Protocol):
    """The cache Lane B builds and Lane A wires in.

    ⛔ `coalesce` IS PART OF THE CONTRACT, NOT AN OPTIMISATION. Identical work in flight must share
    one production (§3.6): without it, ten members asking for the same chart at the open produce ten
    renders on a pod with four render slots, and nine of them wait for a slot to do work that is
    already being done. The follower waits on the SAME budget it would have spent rendering, so it
    is never worse off than not coalescing.

    ⛔ AND A MISS IS `None`, NEVER AN EXCEPTION AND NEVER A STALE HIT. A store that raises on a miss
    makes every caller wrap it; a store that returns something expired makes every caller check."""

    def get(self, key: CacheKey) -> CachedArtifact | None: ...

    def put(self, key: CacheKey, artifact: CachedArtifact) -> None: ...

    def coalesce(self, key: CacheKey, produce: Callable[[], Any], *, budget_s: float) -> Any: ...


# ── 3 · the member-facing copy boundary (2.7, Lane D) ───────────────────────


@runtime_checkable
class BadgeRenderer(Protocol):
    """The ONE owner of what a member reads about degradation (04-visual-spec).

    ⛔ ONE OWNER, BECAUSE C-06 IS WHAT TWO OWNERS LOOK LIKE: three unlabelled stand-ins, two of which
    never healed, because labelling was something each call site had to remember. `render_badge`
    returns `None` when there is nothing to say — which on a healthy path is every time, and a badge
    that shows when nothing is wrong is not there on the day it matters."""

    def render_badge(self, result: Result) -> str | None: ...

    def render_footer(self, results: "dict[str, Result]", corr_id: str | None) -> str: ...


#: Discord's hard limit, and the rule that goes with it.
#: ⛔ WHEN THE STAMP DOES NOT FIT, THE CONTENT IS TRIMMED AND THE STAMP IS KEPT. The other way round
#: is the S8 violation with extra steps: a full-length reply whose last clause fell off is exactly
#: the unlabelled stand-in C-06 describes, and it happens only on the longest — usually most
#: degraded — replies.
CONTENT_MAX = 2000


# ── 4 · what every lane must be able to say about a payload ─────────────────

#: The keys any cross-lane payload description uses. Named so two lanes cannot invent two spellings.
VINTAGE_KEYS = ("as_of_utc", "as_of_et", "provider", "session_state", "age_s", "budget_s",
                "stale", "rule", "expected_session")


def describes_vintage(obj: Any) -> bool:
    """True when `obj` can answer "how old is this DATA?" in the frozen vocabulary.

    ⛔ THE POINT IS THE THREE-VALUED `stale`. A lane that returns `False` for "we could not tell"
    has laundered an unmeasured payload into a clean one, and every downstream badge decision is
    then wrong in the direction nobody notices."""
    if obj is None:
        return False
    return all(hasattr(obj, k) for k in VINTAGE_KEYS)
