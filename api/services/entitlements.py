"""Toolkit entitlement — the first entitlement model this codebase has.

⭐ WHAT IT GATES: BREADTH. Symbols, history depth, definition count, refresh
cadence. Spec §1.4, and the machine gate is
`test_the_SAME_definition_on_the_SAME_symbol_is_BIT_IDENTICAL_under_every_toolkit`.
⛔ WHAT IT NEVER GATES: MECHANICS. Nobody is sold a worse RSI.

⛔ AND IT IS APPLIED WHERE BREADTH IS PRODUCED, NEVER WHERE IT IS DISPLAYED. A UI
that hides rows is not entitlement — the rows were computed, they held the GIL
while a universe sweep ran, and a client can ask for them. The cap slices the
sweep's symbol list, and the response says so under `withheld`.

⛔ `withheld` IS NEITHER `dropped` NOR `not_computable`. Dropped means "we tried
and failed, here they are, re-run them"; not-computable means "we ran and the
maths had nothing to say at the last confirmed bar"; withheld means "your plan
stops here". Folding any two makes a capped screen read as a broken one and a
broken one read as a capped one, and a trader acts on the difference (§6.3,
controller resolution 5).

────────────────────────────────────────────────────────────────────────────────
🔴 THE HISTORY AXIS — E-7's ADJUDICATION, AND IT IS A REFUSAL, NEVER A TRIM
────────────────────────────────────────────────────────────────────────────────
E-3 accepted `max_history_bars` and deliberately did NOT apply it, reporting that
*"trimming EMA seeding is mechanics, not breadth"* and handing the call here. The
ruling, and the reasoning, in one paragraph:

**Breadth is how much of the market — and how much of the past — your plan lets
you ASK about. Mechanics is what number comes back for the question you were
allowed to ask.** Trimming the bars an EMA seeds from does not narrow the
question. It answers the SAME question with a WORSE number, and the member cannot
tell. That is "sold a worse RSI" exactly, whatever the axis is called, so §1.4
forbids it and the axis being named "history depth" does not rescue it.

MEASURED on this box, `ema(close, 20)` over 400 synthetic daily bars:

    all 400 bars  ->  15.269399733598789
    last 120 bars ->  15.269384587868412

Two different indicators — and the relative difference is **9.919e-07**, INSIDE
`pytest.approx`'s default `rel=1e-6`. `assert trimmed == pytest.approx(full)`
PASSES. That is a measured false negative, not a close call, and it is why the
gate is `repr()` for `repr()`; `tests/test_entitlements.py` asserts the approx
comparison succeeds so the justification lives in the suite.

⛔ AND `max_lookback` CANNOT RESCUE IT EITHER. `ast_interpret.max_lookback` reports
**20** for that tree — the tree's declared window — while `_ema_col` seeds from bar
zero. A recursive indicator's honest history requirement is "all of it", so there
is no per-tree number a trim could be validated against. That closes the last
version of the trimming design.

So `apply_history_cap` has exactly TWO outcomes and neither of them is a shorter
column: it returns the bars UNCHANGED, or it REFUSES with `ToolkitWithheld`
carrying reason `toolkit:history` — "your plan stops here", which is honest,
attributable and fixed by upgrading. This is the same conclusion E-3 reached and
the axis is KEPT rather than dropped: E-3 said a history axis *"has to produce a
declared outcome … rather than a quietly different value"*, and that is what ships.

⚠️ ITS PRODUCTION CALL SITE IS NOT WIRED YET AND THAT IS STATED, NOT HIDDEN. The
refusal has to become a `withheld` count in the sweep's envelope, which needs
`toolkit:history` added to `scan_evaluator.WITHHELD_REASONS` — a vocabulary E-3
owns. Until the controller lands that one edit, the shipped toolkit's
`max_history_bars` is `None`, this function is the identity, and the rails below
make the WRONG implementation impossible to introduce quietly rather than merely
discouraged.

────────────────────────────────────────────────────────────────────────────────
🔴 THE CADENCE AXIS — BOUNDED BY THE DATA FIRST, BY THE PLAN SECOND
────────────────────────────────────────────────────────────────────────────────
E-3 wired `cadence` into the sweep's envelope, derived from
`ast_freshness.freshness_for(tree)["cadences"]`. Measured over the manifest, all
54 declared scalars are unanimous `cadence: nightly`, so a scan naming ANY scalar
has a nightly ceiling and a bars-only scan has none.

⛔ SO `min_refresh_seconds` IS A FLOOR THAT CAN ONLY GO UP. `refresh_floor_seconds`
takes the MAX of what the data can honestly deliver and what the plan permits. An
entitlement permitting a faster refresh than the table can support would sell a
promise the data cannot keep — and it fails INVISIBLY, because every number on
the screen still looks right; the member just infers that new information arrived
when the same nightly snapshot was re-read.

────────────────────────────────────────────────────────────────────────────────
⚠️ `meta.tier` IS NOT THIS. It is a BADGE — `nativeRegistry.js` says so in its own
words, the vocabulary is `['free','premium']` (`defSchema.js`), and no consumer
anywhere produces a refusal from it. It stays a badge.

⚠️ AND `tier` IS OVERLOADED IN THIS REPO — every `tier` under `api/` is the THEME
taxonomy (`core`/`relevant`/`peripheral`) or a breadth colour tier. A census of
entitlement code keys on `require_paid` / `is_paid_user`, never on the word.
"""

from __future__ import annotations

import dataclasses
from types import MappingProxyType
from typing import Any, Mapping, Optional, Sequence

from fastapi import Depends

from api.middleware.auth_middleware import get_current_user_with_plan
from api.services import user_definitions


# ─── the vocabulary ──────────────────────────────────────────────────────────

#: Why a symbol was never looked at. ⛔ E-3 OWNS THE WORD `toolkit:symbols` — see
#: `scan_evaluator.WITHHELD_REASONS`. It is spelled here rather than imported
#: because importing the sweep from a module that a ROUTER imports would put
#: `scan_evaluator` in the request path's namespace, which
#: `test_the_evaluator_module_is_not_imported_by_any_ROUTER_at_all` exists to
#: forbid. The two spellings are PINNED EQUAL by a test instead — the same idiom
#: `user_definitions.FIRST_REV` uses against `alert_rev_migration.DEFAULT_REV`,
#: and for the same reason: importing would make a divergence invisible.
SYMBOLS_WITHHELD = "toolkit:symbols"
HISTORY_WITHHELD = "toolkit:history"
WITHHELD_REASONS = (SYMBOLS_WITHHELD, HISTORY_WITHHELD)

#: How often the DATA behind a cadence can honestly say something new, in
#: seconds. ⛔ NOT AN ENTITLEMENT NUMBER — a property of the store the scalars
#: are read from, which is why it is not one of the four axes and why entitlement
#: may only ever raise it. ⛔ AND THE KEY SET IS RAILED AGAINST THE MANIFEST'S OWN
#: DECLARATIONS, never hand-kept: a fifty-fifth scalar declaring `intraday` fails
#: BY NAME in `test_every_cadence_the_MANIFEST_declares_has_a_floor` rather than
#: silently getting no floor at all.
CADENCE_FLOOR_SECONDS: Mapping[str, int] = MappingProxyType({
    "nightly": 86_400,
})


class ToolkitWithheld(Exception):
    """A breadth axis stopped here. ⛔ NOT a failure and NOT a not-computable.

    The message leads with the reason token so a caller binds to the REASON
    rather than to the prose — the shape `scan_evaluator.ScanRunRefused` already
    uses, because two refusal vocabularies for one lane is how a caller ends up
    pattern-matching sentences.
    """

    def __init__(self, reason: str, detail: str) -> None:
        if reason not in WITHHELD_REASONS:
            raise ValueError(
                f"{reason!r} is not one of the withheld reasons {WITHHELD_REASONS}. "
                "The set is closed on purpose: a coverage line branches on it.")
        self.reason = reason
        self.detail = detail
        super().__init__(f"[{reason}] {detail}")


class ToolkitLimitExceeded(ValueError):
    """A COUNT axis refused a write.

    ⚠️ IT IS A `ValueError` ON PURPOSE. `user_definitions.save` raises `ValueError`
    for every store refusal and `api/routers/user_definitions.py::_save_or_400`
    turns exactly that into a 400 carrying the store's own sentence. A new
    exception type would need a second handler, and a refusal that escaped as a
    500 would read to the member as an outage rather than as their plan.
    """

    def __init__(self, limits: "Limits", count: int) -> None:
        self.limits = limits
        self.count = count
        super().__init__(
            f"definition count exceeds {limits.max_definitions} per user on the "
            f"{limits.toolkit!r} toolkit (you have {count}) — delete one before "
            "creating another")


# ─── the shape ───────────────────────────────────────────────────────────────

@dataclasses.dataclass(frozen=True)
class Limits:
    """One toolkit's four breadth bounds.

    ⛔ EVERY FIELD IS REQUIRED. A default here would be a fifth place a cap number
    could live — invisible, unreviewed, and applied to every toolkit that forgot
    to name it. `TOOLKITS` is the one place a number lives, so a `Limits` must
    say all four out loud.

    ⛔ `None` MEANS UNGATED ON THAT AXIS, NOT ZERO. `max_definitions` has no
    ungated spelling because a count axis with no bound is an unbounded store,
    and that is the one thing this repo already knows it cannot afford.
    """

    toolkit: str
    max_symbols: Optional[int]
    max_history_bars: Optional[int]
    max_definitions: int
    min_refresh_seconds: Optional[int]

    def __post_init__(self) -> None:
        if not isinstance(self.toolkit, str) or not self.toolkit.strip():
            raise ValueError(f"toolkit must be a non-empty name, got {self.toolkit!r}")
        for field in ("max_symbols", "max_history_bars", "min_refresh_seconds"):
            _check_optional_count(field, getattr(self, field))
        _check_count("max_definitions", self.max_definitions)


def _check_count(field: str, value: Any) -> None:
    """⚠️ `isinstance(True, int)` IS TRUE. A bool sails through every obvious
    numeric guard, and `max_symbols=True` would silently cap a universe sweep at
    ONE symbol while reading as "enabled" — so the bool branch comes first."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise ValueError(
            f"{field} must be a non-negative int, got {value!r}")


def _check_optional_count(field: str, value: Any) -> None:
    if value is None:
        return
    _check_count(field, value)


# ─── THE ONE PLACE THE NUMBERS LIVE ──────────────────────────────────────────

#: The toolkit a caller gets when nothing says otherwise. Spelled once.
DEFAULT_TOOLKIT = "all"

#: 🟡 THE NUMBERS ARE THE OWNER'S — design §8.4 is OPEN and this table is the one
#: place a number may live. `docs/decisions/2026-08-08-toolkit-gating-axes.md`.
#:
#: ⛔ `None` means UNGATED on that axis, not zero. Today exactly one toolkit ships
#: and it changes nothing for anybody, which is what lets the mechanism land
#: before the pricing question is answered.
#:
#: ⛔ `max_definitions` REFERENCES `user_definitions.MAX_DEFINITIONS_PER_USER`
#: RATHER THAN RESTATING 50, and that reference is asserted BY AST. Turning a
#: capacity bound into an entitlement bound is a CATEGORY CHANGE — capacity may be
#: tuned by ops, entitlement is a billing contract — and the honest way to make it
#: today is to point at the capacity bound so the two cannot drift while they are
#: still the same number. The day the owner sets a real entitlement number here,
#: the two separate on purpose and the reference is what makes that a deliberate
#: edit rather than a silent one.
TOOLKITS: Mapping[str, Limits] = MappingProxyType({
    "all": Limits(
        toolkit="all",
        max_symbols=None,          # OWNER: §8.4
        max_history_bars=None,     # OWNER: §8.4 — and see the header's ruling
        max_definitions=user_definitions.MAX_DEFINITIONS_PER_USER,
        min_refresh_seconds=None,  # OWNER: §8.5 — cadence is unanswered
    ),
})


# ─── who gets what ───────────────────────────────────────────────────────────

def toolkit_for(user: Optional[Mapping[str, Any]]) -> str:
    """The toolkit NAME for a caller.

    ⛔ ONE TOOLKIT SHIPS, AND THE LOOKUP IS STILL REAL. Returning
    `DEFAULT_TOOLKIT` unconditionally would be indistinguishable from a lookup
    that had been deleted; this reads whatever the account carries and falls back,
    so the day a second toolkit is sold the wiring is already load-bearing and the
    only edit is in `TOOLKITS`.

    ⚠️ PER-USER SCOPING HAS EXACTLY ONE PRECEDENT and this follows it rather than
    inventing a second: `alert_user_series.scoped_key(user_id, address)` keys the
    fourth partition by ``<user_id>\\x1f<address>``. Nothing here stores per-user
    state yet, so no key is minted; when one is, it goes through that function.
    """
    name = None
    if isinstance(user, Mapping):
        raw = user.get("toolkit")
        if isinstance(raw, str) and raw.strip():
            name = raw.strip()
    if name in TOOLKITS:
        return name
    return DEFAULT_TOOLKIT


def limits_for(user: Optional[Mapping[str, Any]]) -> Limits:
    """The caller's toolkit.

    ⛔ THE PAID GATE STILL RUNS FIRST AND SEPARATELY. `Depends(require_paid)` is
    per handler and it decides WHETHER; this decides HOW MUCH. Collapsing the two
    would make one 402 mean two things, and `4e2563bd`'s distinct per-router
    sentence exists precisely so "which surface refused me" is answerable.

    ⛔ SO THIS FUNCTION NEVER RAISES AND NEVER LOOKS AT `is_paid_user`. An
    anonymous or unknown caller gets the default toolkit's bounds; whether they
    are allowed through the door at all is somebody else's sentence.
    """
    return TOOLKITS[toolkit_for(user)]


def limits_dependency(user: dict = Depends(get_current_user_with_plan)) -> Limits:
    """FastAPI's door onto `limits_for`.

    ⛔ IT IS A SECOND DEPENDENCY BESIDE `require_paid`, NEVER A REPLACEMENT FOR IT.
    A route that serves definition results carries BOTH: one answers "may you be
    here at all" with a 402, the other answers "how much of it do you get" with a
    `withheld` count. One dependency answering both would make a single 402 mean
    two different things.
    """
    return limits_for(user)


# ─── the axes ────────────────────────────────────────────────────────────────

def apply_symbol_cap(syms: Sequence[str],
                     limits: Optional[Limits]) -> tuple[list, list]:
    """``(kept, withheld)`` — and BOTH are lists, because the withheld ones have
    names.

    ⭐ THIS IS THE DEFINITION OF THE SLICE, and `scan_evaluator._apply_limits`
    computes the same one against a duck-typed `limits` (it shipped before this
    module existed and could not import it). Two implementations of "which symbols
    does your plan let you see" is a second authority over a billing contract, so
    `test_the_SWEEPs_slice_and_apply_symbol_cap_AGREE` drives both over a matrix
    and fails on any disagreement.

    ⛔ THE ORDER IS THE CALLER'S. A cap that sorted, sampled or shuffled would make
    "which 500 symbols" a property of this function rather than of the universe the
    sweep was handed, and two runs of the same plan would answer differently.
    """
    kept = list(syms)
    if limits is None or limits.max_symbols is None:
        return kept, []
    cap = limits.max_symbols
    if cap >= len(kept):
        return kept, []
    return kept[:cap], kept[cap:]


def apply_history_cap(bars: Sequence[Any], limits: Optional[Limits]) -> list:
    """The bars a toolkit permits — UNCHANGED, or a refusal. ⛔ NEVER SHORTER.

    See the module header for the ruling and the measurement. The two outcomes:

      * the plan admits this much history  -> the SAME bars, so every toolkit
        computes a bit-identical column;
      * it does not                        -> `ToolkitWithheld('toolkit:history')`,
        i.e. "your plan stops here", which is honest and fixed by upgrading.

    ⛔ THERE IS NO THIRD OUTCOME, AND THAT IS THE WHOLE POINT. A trim is the
    plausible implementation, it is what the brief's own signature invites, and it
    is a different indicator — `ema(close,20)` over 400 bars is 15.269399733598789
    and over the last 120 is 15.269384587868412. A member on a smaller plan would
    be shown a number nobody can reproduce, under the same name — and one that
    `pytest.approx` would have called equal.
    """
    kept = list(bars)
    if limits is None or limits.max_history_bars is None:
        return kept
    if len(kept) <= limits.max_history_bars:
        return kept
    raise ToolkitWithheld(
        HISTORY_WITHHELD,
        f"this definition reads {len(kept)} bars and the {limits.toolkit!r} "
        f"toolkit allows {limits.max_history_bars}. The bars are NOT trimmed to "
        "fit: a shorter window seeds a recursive average differently and would "
        "return a quietly different number under the same indicator's name.")


def check_definition_count(count: int, limits: Optional[Limits]) -> None:
    """RAISES when one more definition would break the plan. Returns ``None``.

    ⛔ IT TAKES THE COUNT, NOT THE USER. The count is a fact about the store and
    the store already knows how to compute it under its own lock
    (`user_definitions._live_def_count`); re-deriving it here would be a second
    authority over "how many do you have", read outside the transaction that is
    about to append.
    """
    if limits is None:
        limits = TOOLKITS[DEFAULT_TOOLKIT]
    if not isinstance(count, int) or isinstance(count, bool) or count < 0:
        raise ValueError(f"count must be a non-negative int, got {count!r}")
    if count >= limits.max_definitions:
        raise ToolkitLimitExceeded(limits, count)


def refresh_floor_seconds(cadence: Optional[str],
                          limits: Optional[Limits]) -> Optional[int]:
    """The soonest a re-run can HONESTLY say something new.

    🔴 BOUNDED BY THE DATA FIRST, BY ENTITLEMENT SECOND, AND THE ANSWER IS THE MAX.
    `cadence` is what the tree's own scalars declare (E-3's
    `scan_evaluator.cadence_ceiling`, derived from the manifest); `None` means the
    tree names no scalar, so the bars' own cadence applies and there is no data
    floor at all.

    ⛔ AN ENTITLEMENT MAY ONLY EVER RAISE THE FLOOR. Letting a plan buy a refresh
    faster than the nightly snapshot rebuilds sells a promise the table cannot
    keep, and it fails invisibly: every number still looks right, and the member
    infers new information arrived when the same 03:00 rows were re-read.

    ⚠️ A JOINED CADENCE (`"a/b"`) IS THE COARSEST OF ITS PARTS. E-3 reports two
    disagreeing cadences as BOTH rather than collapsing them, because ranking them
    needs an order the manifest does not declare. Ranking them HERE is legitimate
    and different: this is not choosing which one to report, it is refusing to
    promise faster than the slowest thing the answer depends on.
    """
    floors = []
    if cadence:
        for part in str(cadence).split("/"):
            part = part.strip()
            if not part:
                continue
            if part not in CADENCE_FLOOR_SECONDS:
                raise ValueError(
                    f"cadence {part!r} has no declared floor. Every cadence the "
                    f"manifest declares must appear in CADENCE_FLOOR_SECONDS "
                    f"({sorted(CADENCE_FLOOR_SECONDS)}) — a cadence with no floor "
                    "would let a scan promise a refresh the store cannot deliver.")
            floors.append(CADENCE_FLOOR_SECONDS[part])
    if limits is not None and limits.min_refresh_seconds is not None:
        floors.append(limits.min_refresh_seconds)
    return max(floors) if floors else None
