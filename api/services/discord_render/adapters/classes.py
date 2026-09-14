"""One mapping from what an ADAPTER saw to what a MEMBER reads (OI-23; §3.5, §3.8c).

Three vocabularies met on this path and none of them knew about the others:

  * `contract.FAILURE_CLASSES` — the member-facing copy, one table, owner decision D-05;
  * `adapters.result` — what an adapter observed (`timeout`, `breaker_open`, `empty`, …);
  * `flow_timeout` / `flow_unavailable` / `flow_error` — emitted inline by the `/flow` router.

⛔ THE SAME OBSERVATION MEANS DIFFERENT THINGS FROM DIFFERENT UPSTREAMS, WHICH IS WHY THIS IS A
PAIR AND NOT A LOOKUP ON THE REASON ALONE. `empty` from bars is "there are no bars for this symbol
and timeframe" — the member's input, excluded from the success-rate SLO. `empty` from the renderer
is "the chart renderer is unavailable" — ours, and it pages. Collapsing them would either blame a
member for our outage or hide our outage inside a user-error bucket.

⛔ AND AN UNMAPPED PAIR MUST NOT SILENTLY BECOME "internal". `normalize_class` already does that for
anything it does not recognise, which is the right runtime behaviour and the wrong development
behaviour: a new reason would render as "something went wrong on our side" forever and nobody would
learn. `for_reason` raises on an unknown pair, and a rail walks the whole cross-product — so adding
a reason to the taxonomy fails the suite until its copy exists, which is the contract §3.5 asks for.
"""
from __future__ import annotations

from api.services.discord_render import contract
from api.services.discord_render.adapters import result as R

#: The five upstreams an adapter can speak to. Kept here rather than derived from the module list so
#: a new adapter has to make a deliberate decision about its copy.
UPSTREAMS = ("bars", "quote", "flow", "renderer", "entity")

#: `(upstream, reason) -> contract class`. Every fatal reason, for every upstream.
CLASS_OF: dict[tuple[str, str], str] = {
    # bars — a data problem reads as a data problem, and "no bars" is the member's input
    ("bars", R.TIMEOUT): "data_unavailable",
    ("bars", R.BREAKER_OPEN): "data_unavailable",
    ("bars", R.UNREACHABLE): "data_unavailable",
    ("bars", R.UPSTREAM_ERROR): "data_unavailable",
    ("bars", R.EMPTY): "no_bars",
    ("bars", R.BAD_SHAPE): "internal",
    ("bars", R.NOT_CARRIED): "symbol_not_found",
    ("bars", R.DEADLINE): "deadline",

    # quote — the extended-hours chip. ⚠️ It is DECORATION: a failure here must never become the
    # member's failure, so these classes exist for the LOG and the caller drops the chip instead of
    # failing the render. A quote outage that killed a chart would be worse than no chip.
    ("quote", R.TIMEOUT): "data_unavailable",
    ("quote", R.BREAKER_OPEN): "data_unavailable",
    ("quote", R.UNREACHABLE): "data_unavailable",
    ("quote", R.UPSTREAM_ERROR): "data_unavailable",
    ("quote", R.EMPTY): "data_unavailable",
    ("quote", R.BAD_SHAPE): "internal",
    ("quote", R.NOT_CARRIED): "symbol_not_found",
    ("quote", R.DEADLINE): "deadline",

    # flow — the three the router already emitted, kept verbatim so the copy does not move
    ("flow", R.TIMEOUT): "flow_timeout",
    ("flow", R.BREAKER_OPEN): "flow_unavailable",
    ("flow", R.UNREACHABLE): "flow_unavailable",
    ("flow", R.UPSTREAM_ERROR): "flow_error",
    # ⚠️ `("flow", EMPTY)` is a row the adapter never produces: an empty tape comes back as a
    # SUCCESS with `contract_count == 0`, because a quiet session is a true answer and the router
    # has its own sentence for it. The row exists so the cross-product is total.
    ("flow", R.EMPTY): "flow_error",
    ("flow", R.BAD_SHAPE): "flow_error",
    ("flow", R.NOT_CARRIED): "symbol_not_found",
    ("flow", R.DEADLINE): "deadline",

    # renderer — every way the house path can fail to produce a picture
    ("renderer", R.TIMEOUT): "deadline",
    ("renderer", R.BREAKER_OPEN): "renderer_unavailable",
    ("renderer", R.UNREACHABLE): "renderer_unavailable",
    ("renderer", R.UPSTREAM_ERROR): "renderer_unavailable",
    ("renderer", R.EMPTY): "renderer_unavailable",
    ("renderer", R.BAD_SHAPE): "renderer_unavailable",
    ("renderer", R.NOT_CARRIED): "symbol_not_found",
    ("renderer", R.DEADLINE): "deadline",

    # entity — the symbol check. It fails OPEN, so only NOT_CARRIED ever reaches a member.
    ("entity", R.TIMEOUT): "internal",
    ("entity", R.BREAKER_OPEN): "internal",
    ("entity", R.UNREACHABLE): "internal",
    ("entity", R.UPSTREAM_ERROR): "internal",
    ("entity", R.EMPTY): "symbol_not_found",
    ("entity", R.BAD_SHAPE): "internal",
    ("entity", R.NOT_CARRIED): "symbol_not_found",
    ("entity", R.DEADLINE): "internal",
}


def for_reason(upstream: str, reason: str | None) -> str:
    """The member-facing class for what this adapter saw. Raises on an unmapped pair — see above."""
    if reason is None:
        return "internal"
    key = (upstream, reason)
    if key not in CLASS_OF:
        raise KeyError(
            f"no member-facing class for {key}. Add it to CLASS_OF beside its copy in "
            "contract.FAILURE_CLASSES — an unmapped pair would render as 'something went wrong on "
            "our side' forever and nobody would learn which cause it was (§3.5, C-08).")
    return CLASS_OF[key]


def for_result(upstream: str, result: R.Result) -> str:
    return for_reason(upstream, result.reason())


def flow_empty_is_not_a_failure() -> str:
    """⚠️ `/flow` answering with zero contracts is a real, correct, NON-failure answer, and the
    router already has copy for it — "no significant options flow {window}". The `("flow", EMPTY)`
    row above exists only so the cross-product is total; a caller must check for the empty case
    BEFORE asking for a class, exactly as `run_flow_card_job` does today.

    Written as a function rather than a comment because a comment claiming a rule is not a rule
    (`lesson_a_comment_claiming_agreement_is_not_agreement`) — the rail calls this and asserts the
    router still carries that sentence."""
    return "no significant options flow"
