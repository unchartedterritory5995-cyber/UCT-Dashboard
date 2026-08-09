"""USER_FUNCS — the fourth address partition, and the arm-time equality.

⭐ FOURTH, NOT WIDER. `INDICATOR_FUNCS` (28) is the frozen replay grid's
generator: `tools/alert_replay.py::build_alert_grid` iterates it, in order, and
685,193 recorded fires hang off that iteration. `EVENT_FUNCS` (2, Phase C Task 3)
and `PRICE_FUNCS` (1, Phase C Task 10) were each split off rather than folded in,
BOTH times for that same measured reason — *growing that dict destroys the
instrument*. A user address is `u_<12 hex>.<plotKey>` and `build_alert_grid`
never sees one, which is why `--check` and `--diff 31/31` hold through this task,
and why that invariance is this task's headline gate rather than a footnote.

⛔ AND AN ADDRESS HERE IS PER-USER — THE ONE PROPERTY NO OTHER PARTITION HAS.
`rsi` means the same thing for everybody. `u_abc.out` means something only to one
account, so this partition is keyed by a SCOPED key (`<user_id>\\x1f<address>`)
and never by the bare address. Two consequences, both asserted in both
directions:

  * `indicator_alert_evaluator.resolve_address` / `value_function` /
    `all_addresses` / `alert_catalog` cannot reach a user address AT ALL — they
    walk `ADDRESS_PARTITIONS`, which is the three GLOBAL tables and does not
    include this one. A bare `u_abc.out` handed to `value_function` answers
    `None`, exactly as a typo does.
  * a user id is REQUIRED to get a value function, and account B's id cannot
    produce account A's column, because `\\x1f` is a byte no address grammar can
    hold so the keyspaces cannot alias.

⭐ WHAT ADMISSION MEASURES, AND WHY IT IS AT ARM TIME.
A user formula has no committed golden fixture and one cannot be added per user
(`test_every_fixture_file_is_covered_by_a_test` globs the fixture directory and
demands the stem set equal the explicit CASES lists — a per-user fixture is
structurally impossible). So Phase D's 1e-9 contract is carried by the TABLE
(`closedTable.json`, proven 17 asts x 579 bars, 9,843 rows, zero differences),
and this module confirms it ONCE, on THIS user's real bars, for THIS tree, before
the definition may ever produce a notification. Per keystroke it would be a node
process on every character; per cycle it would be a node process every 60
seconds. At arm time it is one process, once, on the thing being armed.

⛔ EVERY REFUSAL IS A RAISE AND NAMES ITS OWN GATE. The defect this branch has
hit FIVE times — twice inside harnesses built to catch it — is *"refused by a
different door"*: a correct answer produced by the wrong mechanism. An admission
path is exactly that shape, because a user alert that never fires because
something upstream refused it is indistinguishable from one correctly admitted
and quiet. So `AdmissionRefused` carries `.gate`, the gates are a closed tuple,
the refusal messages are DISJOINT BY CONSTRUCTION, and the tests assert the gate
NAME rather than the fact of a refusal — which is what makes deleting one gate
fail loudly instead of being covered by the next one down.
"""
from __future__ import annotations

import math
import os
import re
import sys
import threading
from typing import Any, Callable, Mapping, Optional

_logger_name = __name__

#: One user address: `u_` + 12 hex + `.` + a plot key. The id grammar is
#: `user_definitions.DEF_ID_RE`'s, spelled here as a whole-address pattern
#: because this module answers "is this string a user address" for the ledger
#: door, which holds an alert row and not a definition.
USER_ADDRESS_RE = re.compile(r"^u_[0-9a-f]{12}\.[A-Za-z0-9_][A-Za-z0-9_-]*$")

#: ⛔ THE SEPARATOR IS A BYTE NO ADDRESS CAN HOLD. `USER_ADDRESS_RE` admits
#: `[A-Za-z0-9_.-]` and a user id is an opaque account key; a `|` or a `:` could
#: in principle appear in one and make two different (user, address) pairs
#: collapse to one scoped key — which is one account's formula answering for
#: another. `\x1f` (ASCII UNIT SEPARATOR) exists for exactly this and appears in
#: neither grammar.
SCOPE_SEP = "\x1f"

#: The closed set of doors this module may refuse at. A refusal whose gate is not
#: in here is a bug in this file, and `AdmissionRefused` asserts membership so it
#: cannot be introduced quietly.
GATES: tuple[str, ...] = (
    "definition",     # no such definition for this user, or it is a tombstone
    "lane",           # the definition is not a formula (compute.kind != "ast")
    "repaint",        # the badge is a GATE, not a label (spec §1.3)
    "budget",         # the tree is over the budget AT THE VERSION BEING ARMED
    "cross-lane",     # the two lanes do not agree at 1e-9 on THESE bars
    "bars",           # there are no bars to prove anything on
)


class AdmissionRefused(RuntimeError):
    """A user definition was refused, and the refusal NAMES THE DOOR.

    ⛔ IT RAISES; it never returns a falsey value. A boolean refusal is a value a
    caller can ignore, and the caller here is the arm path: a refusal read as
    "no" would arm the alert anyway. Phase C Task 9 wrote the same sentence about
    the ledger door and the reasoning is identical.

    ⚠️ `.gate` IS THE ATTRIBUTION AND THE TESTS ASSERT IT. `pytest.raises` alone
    proves *a* refusal; this branch has now measured five separate occasions
    where the refusal came from a door other than the one under test, twice
    inside a harness written to detect exactly that. Asserting the gate name is
    what makes "delete this gate" fail rather than fall through to the next.
    """

    def __init__(self, gate: str, detail: str):
        if gate not in GATES:
            raise AssertionError(
                f"{gate!r} is not one of this module's declared gates {GATES} — "
                "a refusal that cannot be attributed is the defect, not the fix")
        self.gate = gate
        super().__init__(f"{detail} [gate:{gate}]")


# ─── the refusal vocabulary, DISJOINT BY CONSTRUCTION ────────────────────────
#
# ⛔ WHY THIS IS A TABLE AND NOT SIX STRING LITERALS AT SIX RAISE SITES.
# Phase C Task 9's M1 found TWO gates sharing the phrase "forming-bar fires are
# not ledger-grade", so `pytest.raises(match=…)` STILL MATCHED with the mode lock
# DELETED — the test would have passed on a tree with the safety removed.
# Nineteenth vacuous gate on this branch, and only the mutation found it. Three
# authors being careful is not a mechanism; a table whose pairwise disjointness
# is ASSERTED is. `test_every_admission_refusal_fragment_names_exactly_one_gate`
# drives every gate for real and requires each fragment to appear in exactly one
# of the six messages produced.
REFUSAL_FRAGMENTS: Mapping[str, str] = {
    "definition": "names no stored definition on this account",
    "lane": "is not a formula and cannot be admitted as one",
    "repaint": "a repainting formula cannot arm an alert",
    "budget": "is over its declared budget at the version being armed",
    "cross-lane": "the two lanes disagree at bar",
    "bars": "there are no bars to prove this formula on",
}

#: The SECOND repaint refusal — the acknowledgement half — kept deliberately
#: disjoint from `REFUSAL_FRAGMENTS["repaint"]` even though both are the repaint
#: gate. "a repainting formula cannot arm an alert" is a SUBSTRING of nothing
#: here, and a test that matched on it must not be satisfiable by the
#: preview-repaint path: they refuse different definitions for different reasons
#: and a shared phrase would let one test pass with the other branch deleted.
PREVIEW_ACK_FRAGMENT = "the preview-repaint badge has not been acknowledged"

#: Where an acknowledgement is recorded. It lives in the definition DOCUMENT
#: (which is append-only and versioned in `user_definitions`) rather than in a
#: column, so the acknowledgement is pinned to the exact revision it was given
#: for: edit the formula, and the new version carries no ack until the author
#: gives one again. A mutable per-definition flag would survive a rewrite of the
#: maths it was granted against.
REPAINT_ACK_KEY = "repaintAck"

#: The verdicts `ast_lint` can emit, and what each means to this door.
REPAINT_CLEAN = "non-repainting"
REPAINT_PREVIEW = "preview-repaints"


# ─── THE FOURTH PARTITION ────────────────────────────────────────────────────
#
# ⚠️ IT IS A `dict[str, ValueFn]` LIKE THE OTHER THREE, so every "walk the
# partitions" rail can iterate it the same way — but its KEYS ARE SCOPED, so it
# is not interchangeable with them and the type does not pretend otherwise.
#
# ⛔ IT IS NOT IN `ADDRESS_PARTITIONS`, AND THAT ABSENCE IS THE HEADLINE GATE.
# `indicator_alert_evaluator.ADDRESS_PARTITIONS` is what `all_addresses()`,
# `alert_catalog()`, `value_function()` and `_CANONICAL_ADDRESS` all walk, and
# `build_alert_grid` reads `INDICATOR_FUNCS` directly. Adding this table to
# either is the mutation this whole task is built around: it changes the shape of
# a 685,193-fire frozen log and destroys the instrument every other gate in the
# phase is measured with.
USER_FUNCS: dict[str, Callable[[list, dict], Optional[float]]] = {}

#: ⚠️ THE REGISTRY IS PER-PROCESS AND THAT IS DECLARED, NOT HIDDEN. The web pod
#: is one uvicorn process today (`CLAUDE.md`'s single-process invariant), but a
#: registry that were the AUTHORITY on admission would mean a redeploy silently
#: un-admits every armed user alert — the "quiet is indistinguishable from
#: refused" defect, arriving by restart. So a MISS is not a refusal: it is
#: re-admitted, through the whole chain, by `value_function_for_alert`.
#:
#: ⭐⭐ AND AN ENTRY IN `USER_FUNCS` IS A PROOF RECEIPT, WHICH IS WHY EXACTLY ONE
#: FUNCTION MAY WRITE ONE. `admit_user_definition` is that function, and it only
#: reaches the write after `_gate_cross_lane` has proved THIS tree equal at 1e-9
#: on real bars. So "the key is present" MEANS "the tree behind it was proven in
#: this process", and every other path has to earn one rather than borrow it.
#:
#: ⚰️ `user_value_function` USED TO WRITE HERE TOO, and that made the receipt
#: forgeable: `GET /api/indicator-alerts/current-value` resolves through it, so a
#: PREFILL — a read-only display — could seed the registry with a tree nothing had
#: proven, and the next evaluation cycle would read that entry as an admission and
#: never look again. The rebuild now returns a function WITHOUT registering it.
#: `tests/test_user_definition_reproof.py` walks this module's AST for the
#: subscript-assignment and fails on a second writer by name.
_REGISTRY_LOCK = threading.Lock()


def is_user_address(address: Optional[str]) -> bool:
    """Is this string an address in the user namespace?

    Used by the LEDGER DOOR as well as by this module, which is why it takes a
    plain string and not a definition: `admit_alert_fire` holds an alert row.
    """
    return bool(address) and bool(USER_ADDRESS_RE.match(str(address)))


def split_user_address(address: str) -> tuple[str, str]:
    """`u_abc….out` -> `("u_abc…", "out")`. RAISES on anything else."""
    if not is_user_address(address):
        raise AdmissionRefused(
            "definition",
            f"{address!r} {REFUSAL_FRAGMENTS['definition']} — a user address is "
            "`u_<12 hex>.<plotKey>`")
    def_id, _, plot_key = str(address).partition(".")
    return def_id, plot_key


def scoped_key(user_id: Any, address: str) -> str:
    """The key `USER_FUNCS` is read by. NEVER the bare address."""
    return f"{user_id}{SCOPE_SEP}{address}"


def forget(user_id: Any = None) -> int:
    """Drop registered user series — all of them, or one account's.

    Called when a definition is edited (its maths moved, so its admission was
    granted against a tree that no longer exists) and by tests, which must not
    inherit each other's admissions. Returns how many entries were dropped.

    ⭐ WHAT IT DROPS IS A PROOF RECEIPT, NOT JUST A CACHED CLOSURE. Because
    `admit_user_definition` is the only writer, dropping an entry means the next
    evaluation of an alert on that address MUST re-enter the whole admission
    chain — including the 1e-9 cross-lane equality — on the tree the store now
    holds. That is the mechanism that makes an EDIT re-prove rather than inherit:
    `user_definitions.save` calls this on every append, so the proof and the tree
    can never drift apart without a refusal in between.
    """
    with _REGISTRY_LOCK:
        if user_id is None:
            n = len(USER_FUNCS)
            USER_FUNCS.clear()
            return n
        prefix = f"{user_id}{SCOPE_SEP}"
        doomed = [k for k in USER_FUNCS if k.startswith(prefix)]
        for k in doomed:
            del USER_FUNCS[k]
        return len(doomed)


# ─── the value function ──────────────────────────────────────────────────────

def _last_finite(column: list) -> Optional[float]:
    """The newest computable number in an aligned column.

    ⛔ NaN IS NOT A VALUE HERE. `ast_interpret` pads a warmup window with NaN and
    propagates NaN through a comparison against a missing bar; the alert lane's
    `_last_non_none` would hand that NaN straight to `check_condition`, where
    every comparison against it is False — a formula that silently never fires
    rather than one that reports it has no number yet. `None` is the alert lane's
    "no number", and the two must not be conflated at the boundary.
    """
    for v in reversed(column or []):
        if v is None:
            continue
        try:
            f = float(v)
        except (TypeError, ValueError):
            continue
        if math.isfinite(f):
            return f
    return None


def _inputs_for(definition: Mapping[str, Any], params: Optional[Mapping]) -> dict:
    """The instance's inputs: the definition's declared defaults, overridden by
    whatever the alert row stored, filtered to finite numbers.

    ⚠️ FILTERED HERE RATHER THAN TRUSTED. `interpret` raises `ValueError` for an
    input whose name shadows a table name and silently skips a non-number; the
    alert's `params_json` is whatever a client sent and the create path does not
    type it. Passing it through raw would turn a client typo into an exception
    inside the evaluator's per-alert handler — logged, counted as an error, and
    invisible to the person who armed it.

    ⚰️ THIS READ `spec.get("name")`, AND `name` IS NOT IN THE INPUT VOCABULARY AT
    ALL — so `out` was ALWAYS `{}` and the second loop, gated on `if name in out`,
    could never let an alert row's `params_json` reach a formula either. Both
    halves of spec §8's per-instance knobs were structurally inert.
    `defSchema.validateInput` (`app/src/components/chart/engine/defSchema.js`)
    REQUIRES `input.key`; `nativeRegistry.resolveInputs` reads `input.key`; and
    the house's own server-side reader, `signature/registry_defs.resolve_inputs`,
    reads `spec["key"]`. Three components on one vocabulary and this one on
    another is what made the defect survive: every component was individually
    correct and only the SEAM was wrong, which is why the rail on it
    (`test_alert_user_inputs.py`) DERIVES the key both sides read rather than
    retyping it.

    ⛔ AND `name` IS NOT KEPT AS A FALLBACK. A reader that accepted either would
    be a second vocabulary for one field — the twin this phase retires — and it
    would make the divergence unobservable again the moment somebody re-typed the
    wrong one.
    """
    out: dict[str, float] = {}
    for spec in (definition.get("inputs") or []):
        if not isinstance(spec, dict):
            continue
        key, default = spec.get("key"), spec.get("default")
        if isinstance(key, str) and isinstance(default, (int, float)) \
                and not isinstance(default, bool) and math.isfinite(float(default)):
            out[key] = float(default)
    for key, value in (params or {}).items():
        if key in out and isinstance(value, (int, float)) \
                and not isinstance(value, bool) and math.isfinite(float(value)):
            out[key] = float(value)
    return out


def _make_value_fn(def_id: str, plot_key: str,
                   definition: Mapping[str, Any]) -> Callable[[list, dict], Optional[float]]:
    """One admitted (definition, plot) -> "what number is this formula at now".

    The same shape `indicator_alert_evaluator._value_of` produces for a builtin
    address: `(bars, params) -> Optional[float]`. The tree is CAPTURED, so an
    edit to the stored definition cannot change what an already-admitted alert
    computes without going through `forget` + a fresh admission — which is the
    whole point of `compute.rev` and Phase C's force-migration.

    ⭐ AND IT CARRIES ITS OWN COLUMN AS `fn.column`, WHICH IS WHAT SERVES THE
    CLOSED LANE. `_evaluate_one_closed` indexes a FULL column by bar position
    (`series[i]`, `series[i-1]`), while the forming lane reads only its newest
    computable value. The builtin partitions solve that with two parallel tables
    (`alert_series.SERIES_FUNCS` and `INDICATOR_FUNCS` composed onto it); doing
    the same here would mean two resolutions of one definition, i.e. two places
    that could disagree about which tree was admitted. One admission registers
    one object and both lanes read it.

    ⛔ THE LENGTH IS ASSERTED, NOT TRUSTED — verbatim the reasoning
    `alert_series.series_for` states, and it applies harder here because the
    column comes from a formula a USER wrote. A column one element short does not
    raise anywhere downstream: it shifts every bar index by one, so every alert
    reads the previous bar's number forever while every value it reports is a
    real number from a real bar.
    """
    compute = definition.get("compute") or {}
    tree = compute.get("ast")
    budget = compute.get("budget")
    address = f"{def_id}.{plot_key}"

    def column(bars: list, params: dict) -> list:
        from api.services import ast_interpret
        # 🔴 NOT COMPUTABLE IS NOT ZERO, AND THE COMPARISON IS WHERE IT STOPS
        # BEING VISIBLE. `interpret` pads a warmup with NaN and `_cmp` answers 0
        # against a NaN, so a tree the series cannot answer — `close >
        # sma(close, 300)` on 200 bars — returns 200 finite `0.0`s and zero
        # `None`s: a confident, permanent "no" to a question this lane cannot
        # ask. The honest answer is that there is no number yet, and `None` is
        # this lane's word for that (see `_last_finite`). Asked BEFORE evaluating,
        # exactly as `unresolved_scalars` is asked before a scan evaluates.
        short = ast_interpret.unresolved_lookback(tree, bars)
        if short:
            return [None] * len(bars)
        out = ast_interpret.interpret(tree, bars,
                                      inputs=_inputs_for(definition, params),
                                      budget=budget)
        if len(out) != len(bars):
            raise AssertionError(
                f"{address}: series is {len(out)} long for {len(bars)} bars. "
                "A shorter column shifts every bar index silently and the "
                "closed-bar lane would read the wrong bar forever.")
        # ⚠️ NaN -> None AT THE BOUNDARY. `interpret` pads a warmup window with
        # NaN; `_evaluate_one_closed` reads `series[i] is None` as "no number
        # yet" and hands anything else to `check_condition`, where every
        # comparison against NaN is False — a formula that silently never fires
        # instead of one that reports it has no number. The two must not be
        # conflated where the lanes meet.
        return [None if (v is None or (isinstance(v, float) and math.isnan(v)))
                else v for v in out]

    def fn(bars: list, params: dict) -> Optional[float]:
        return _last_finite(column(bars, params))

    column.__name__ = f"_user_column_{def_id}_{plot_key}"
    fn.__name__ = f"_user_value_{def_id}_{plot_key}"
    fn.column = column                                  # type: ignore[attr-defined]
    # ⭐ THE TREE'S OWN DECLARED HISTORY, CARRIED ON THE ADMITTED OBJECT. The
    # evaluator sizes its bar fetch from this BEFORE it fetches, and a second
    # resolution of the definition to answer "how much past does it need" would
    # be a second reading of a stored blob that `forget` + re-admission exists to
    # make singular. Computed once, at admission, off the SAME captured tree the
    # column evaluates.
    try:
        from api.services import ast_interpret
        fn.lookback = ast_interpret.max_lookback(tree)   # type: ignore[attr-defined]
    except Exception:                                    # noqa: BLE001
        fn.lookback = None                               # type: ignore[attr-defined]
    return fn


def lookback_for_alert(alert: Mapping[str, Any]) -> Optional[int]:
    """A USER alert's declared lookback, or ``None`` for a builtin address.

    ⛔ NO ADMISSION, NO BARS, NO SUBPROCESS. This is asked BEFORE the cycle
    fetches bars, so it must not be able to reach `value_function_for_alert` —
    whose registry-miss branch calls `arm_for_alert`, which fetches bars. A
    reader that could re-enter the fetch it is sizing is a cycle, not a helper.

    Registered instance → the number `_make_value_fn` computed at admission.
    Registry miss (a fresh process, or right after a save) → the STORED
    definition, read plainly with no gate applied, because this answers "how much
    past does the formula name" and not "may this alert run" — those are
    different questions and only the second one is allowed to refuse.

    ``None`` on anything unreadable: the caller falls back to the floor, which is
    strictly more history than this lane used to read, and
    `ast_interpret.unresolved_lookback` still refuses to invent a number if even
    that is short.
    """
    address = str(alert.get("indicator") or "")
    if not is_user_address(address):
        return None
    fn = USER_FUNCS.get(scoped_key(alert.get("user_id"), address))
    known = getattr(fn, "lookback", None)
    if isinstance(known, int) and not isinstance(known, bool):
        return known
    try:
        from api.services import ast_interpret, user_definitions
        def_id, _plot_key = split_user_address(address)
        row = user_definitions.get(alert.get("user_id"), def_id,
                                   alert.get("def_version"))
        if not row:
            return None
        tree = ((row.get("definition") or {}).get("compute") or {}).get("ast")
        if tree is None:
            return None
        return ast_interpret.max_lookback(tree)
    except Exception:                                    # noqa: BLE001
        return None


# ─── THE THREE GATES ─────────────────────────────────────────────────────────

def _gate_definition(user_id: Any, def_id: str, version: Optional[int]) -> dict:
    """The definition exists, on THIS account, at the version being armed."""
    from api.services import user_definitions
    row = user_definitions.get(user_id, def_id, version)
    if row is None or row.get("deleted_at") is not None:
        raise AdmissionRefused(
            "definition",
            f"{def_id!r} {REFUSAL_FRAGMENTS['definition']}"
            + (f" at version {version}" if version is not None else ""))
    return row


def _gate_lane(row: Mapping[str, Any]) -> dict:
    """It is a FORMULA. `compute.kind` is the lane, and only `ast` is one."""
    definition = row.get("definition") or {}
    compute = definition.get("compute") or {}
    if compute.get("kind") != "ast":
        raise AdmissionRefused(
            "lane",
            f"{row.get('def_id')!r} declares compute.kind "
            f"{compute.get('kind')!r} — it {REFUSAL_FRAGMENTS['lane']}")
    return definition


def _gate_repaint(row: Mapping[str, Any], definition: Mapping[str, Any]) -> None:
    """⭐ THE BADGE IS A GATE, NOT A LABEL (spec §1.3).

    The verdict READ HERE is the one `user_definitions.save` STORED at save time
    from `ast_lint.lint_definition` — the shipped linter's own measurement, per
    PLOT, which is the granularity the owner ruled on. It is not recomputed:
    Phase D Task 10's store pinned that deliberately so a linter change cannot
    re-badge a definition that was already admitted without anybody noticing.

    Three outcomes, and the middle one is the whole reason this is a gate:

      * `non-repainting`      -> admitted.
      * `preview-repaints`    -> admitted ONLY with a recorded acknowledgement.
        The chikou case is the live example: a value that is FINAL the moment bar
        i+k closes but moves until then. An alert on it is defensible if the
        author has been told; it is a support ticket if they have not.
      * `repaints`            -> refused outright. An alert whose own fire may
        stop having happened is not an alert.
    """
    verdicts = row.get("repaint") or {}
    for plot_key in sorted(verdicts):
        mode = verdicts[plot_key]
        if mode == REPAINT_CLEAN:
            continue
        if mode == REPAINT_PREVIEW:
            if _ack_for(definition, plot_key):
                continue
            raise AdmissionRefused(
                "repaint",
                f"{row.get('def_id')}.{plot_key} measures {mode!r} and "
                f"{PREVIEW_ACK_FRAGMENT} — record one in "
                f"meta.{REPAINT_ACK_KEY} for this version to arm it anyway")
        raise AdmissionRefused(
            "repaint",
            f"{REFUSAL_FRAGMENTS['repaint']}: {row.get('def_id')}.{plot_key} "
            f"measures {mode!r}")


def _ack_for(definition: Mapping[str, Any], plot_key: str) -> bool:
    """Has the author acknowledged the preview-repaint badge for this plot?

    Accepts a truthy scalar (the whole definition acknowledged) or a mapping
    keyed by plot — because the verdict is per plot and an acknowledgement that
    could only be given wholesale would be an acknowledgement of things the
    author never read.
    """
    ack = ((definition.get("meta") or {}).get(REPAINT_ACK_KEY))
    if isinstance(ack, Mapping):
        return bool(ack.get(plot_key))
    return bool(ack)


def _gate_budget(definition: Mapping[str, Any], def_id: str) -> None:
    """⭐ AT THE VERSION BEING ARMED, WHICH IS THE ENTIRE POINT.

    `ast_budget` states it in its own docstring: *a definition registered under
    one budget and run under a later, smaller one computes forever at the old
    cost*. Registration happened whenever the author last saved; arming is now.
    Checking here is what makes a budget that TIGHTENED reach the alerts that
    were already armed under the looser one, at the next arm rather than never.

    ⛔ `BudgetExceeded` IS CAUGHT AND RE-RAISED, EVERY OTHER `TableRefusal` IS
    NOT. `check_budget` calls `node_count` and `max_lookback`, which can refuse
    `interpret:node` / `resolve:function` / `resolve:arity` / `resolve:window` —
    those are the TABLE saying no, not the budget, and relabelling one as a
    budget refusal is the wrong-door defect this module's header is about. They
    propagate as themselves.
    """
    from api.services import ast_budget
    compute = definition.get("compute") or {}
    try:
        ast_budget.check_budget(compute.get("ast"), compute.get("budget"))
    except ast_budget.BudgetExceeded as exc:
        raise AdmissionRefused(
            "budget",
            f"{def_id} {REFUSAL_FRAGMENTS['budget']}: {exc}") from exc


# ─── the arm-time cross-lane equality ────────────────────────────────────────

def _conformance():
    """`tools/ast_conformance` — the ONE cross-lane comparator, imported by path.

    ⛔ CALLED, NOT REIMPLEMENTED, AND THE LAYERING VIOLATION IS THE LESSER EVIL.
    That module already owns `run_js` (one node process, argv as a list, payload
    on stdin, `Array.from` so a warmup `null` is not coerced to 0), `run_py`, and
    `compare_lanes` — whose three refusals are precisely the "a zero that means
    nothing" shapes this gate must not produce: an empty lane, mismatched case
    ids, and columns of different lengths. A second comparator here would be a
    second definition of what agreement means, on the one number this phase's
    whole contract rests on.
    """
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    tools = os.path.join(root, "tools")
    if tools not in sys.path:
        sys.path.insert(0, tools)
    import ast_conformance                                    # noqa: PLC0415
    return ast_conformance


#: The case id the arm-time comparison uses. One case, because one definition is
#: being armed; named rather than anonymous so a difference report says what it
#: is about.
ARM_CASE_ID = "arm"


def cross_lane_report(tree: Any, bars: list, inputs: Optional[Mapping] = None) -> dict:
    """Run BOTH lanes over `tree` on `bars`, WITH `inputs`, and return `compare_lanes`' verdict.

    Separated from the gate so a test can read the numbers (`compared`,
    `differences`) rather than only observe a raise — a gate whose measurement
    cannot be printed is a gate nobody can audit.

    ⚰️ THIS TOOK NO `inputs` AND THE HARNESS BEHIND IT HAD NO CONCEPT OF ONE, so
    the 1e-9 equality was established for an EMPTY input map while
    `_make_value_fn` evaluates the same tree with `_inputs_for(definition,
    params)` — the audit's own finding: *"the arm-time 'lanes agree at 1e-9'
    proof runs on an input map neither production lane uses."* And a formula that
    REFERENCED a declared input never got as far as a row: `run_py` raised
    `TableRefusal('resolve:name')`, `_gate_cross_lane` turned it into a
    `cross-lane` refusal, and no member could arm a formula naming their own
    knob. ONE case object carries the map into both lanes (`ast_conformance
    .case_inputs`), so the two can never be handed different ones.
    """
    conf = _conformance()
    cases = [{"id": ARM_CASE_ID, "ast": tree, "inputs": dict(inputs or {})}]
    js = conf.run_js(cases, bars)
    py = conf.run_py(cases, bars)
    return conf.compare_lanes(js, py)


def _gate_cross_lane(definition: Mapping[str, Any], def_id: str,
                     bars: list) -> dict:
    """⭐ D-A2's RUNTIME HALF: THIS tree, THESE bars, BOTH lanes, 1e-9.

    ⚠️ THE MEASUREMENT IS A REFUSAL, NOT A FLAG. Recording a null `admitted_at`
    asserts the bookkeeping; raising asserts the thing the user experiences —
    that no notification left the building. The alert is never created, so there
    is nothing to go quiet.

    ⛔ AND A LANE THAT CANNOT RUN IS A REFUSAL TOO. `run_js` raises
    `LaneUnavailable` rather than returning `{}` when node or the interpreter is
    missing; catching that and admitting would mean a box without node admits
    everything, which is the failure direction that ships a formula that computes
    one number on the server and another on the author's chart, forever, with
    nothing to say so.
    """
    if not bars:
        raise AdmissionRefused(
            "bars", f"{REFUSAL_FRAGMENTS['bars']}: {def_id}")
    compute = definition.get("compute") or {}
    try:
        # ⭐ THE DEFINITION'S OWN DECLARED DEFAULTS, WHICH IS WHAT PRODUCTION
        # EVALUATES. `_inputs_for` is the ONE reader of `inputs[].key` on this
        # lane and `_make_value_fn` calls it on every evaluation; proving the
        # lanes equal with `{}` would be proving it about a formula nobody runs.
        #
        # ⚠️ DEFAULTS, NOT AN ALERT ROW'S `params_json`, AND THAT IS A STATED
        # BOUND rather than an oversight: admission is per (definition, version)
        # and there is no row yet, so a proof taken on one row's knobs would be
        # cited for every other row's. What the knobs move is the VALUE, not
        # which names resolve — but a lane divergence that only appears at some
        # other knob setting is outside what this measurement covers.
        report = cross_lane_report(compute.get("ast"), bars,
                                   _inputs_for(definition, None))
    except AdmissionRefused:
        raise
    except Exception as exc:
        raise AdmissionRefused(
            "cross-lane",
            f"{def_id}: the lanes could not be compared ({type(exc).__name__}: "
            f"{exc}) — a formula this lane cannot prove equal is not admitted"
        ) from exc

    differences = report.get("differences") or []
    if differences:
        first = differences[0]
        raise AdmissionRefused(
            "cross-lane",
            f"{def_id}: {REFUSAL_FRAGMENTS['cross-lane']} "
            f"{first['bar_index']} (js={first['js']!r} py={first['py']!r}, "
            f"rel={first['rel']!r}); {len(differences)} of {report['compared']} "
            f"rows differ at rel-tol {report['rel_tol']}")
    if not report.get("compared"):
        raise AdmissionRefused(
            "cross-lane",
            f"{def_id}: the comparison covered ZERO rows — agreement over "
            "nothing is not agreement")
    return report


# ─── admission ───────────────────────────────────────────────────────────────

def admit_user_definition(user_id: Any, def_id: str,
                          version: Optional[int] = None, *,
                          bars: list) -> dict:
    """Admit a user formula to the alert lane, or RAISE naming the gate.

    Three conditions, all MEASURED, none assumed, in a declared order:

      1. the stored linter verdict is `non-repainting`, or `preview-repaints`
         WITH a recorded acknowledgement — the badge is a gate, not a label;
      2. the JS and Python lanes agree at 1e-9 on THESE bars — D-A2;
      3. the budget holds at the version being armed — a definition admitted
         under an older, larger budget is one running at the old cost forever.

    Two structural doors run first (the definition exists on this account; it is
    a formula at all), because the other three cannot be asked about a document
    that is not there.

    ⚠️ THE ORDER IS PART OF THE ATTRIBUTION. The cheap deterministic gates run
    before the one that spawns a node process, so a definition refused for
    repainting is refused for repainting rather than timing out first — and each
    test drives its gate with an input that passes every OTHER gate, so a kill is
    attributable to the door it names.

    Returns `{def_id, version, rev, ast_hash, addresses, compared, rel_tol}` and
    registers one entry in `USER_FUNCS` per plot.
    """
    row = _gate_definition(user_id, def_id, version)
    definition = _gate_lane(row)
    _gate_repaint(row, definition)
    _gate_budget(definition, def_id)
    report = _gate_cross_lane(definition, def_id, bars)

    plots = definition.get("plots") or []
    keys = [p.get("key") if isinstance(p, dict) else p for p in plots]
    keys = [str(k) for k in keys if k]
    addresses = []
    with _REGISTRY_LOCK:
        for plot_key in keys:
            address = f"{def_id}.{plot_key}"
            USER_FUNCS[scoped_key(user_id, address)] = _make_value_fn(
                def_id, plot_key, definition)
            addresses.append(address)
    return {
        "def_id": def_id,
        "version": row.get("version"),
        "rev": row.get("rev"),
        "ast_hash": row.get("ast_hash"),
        "addresses": addresses,
        "compared": report.get("compared"),
        "rel_tol": report.get("rel_tol"),
    }


def user_value_function(user_id: Any, address: str
                        ) -> Optional[Callable[[list, dict], Optional[float]]]:
    """The value function for ONE account's address, or `None` if not one.

    ⛔ A USER ID IS REQUIRED AND IT IS NOT DECORATIVE. There is no bare-address
    path into `USER_FUNCS` — the keys are scoped — so an address alone cannot
    reach anybody's column, and account B's id cannot reach account A's.

    ⚠️ A REGISTRY MISS REBUILDS FROM THE STORE THROUGH THE FOUR DETERMINISTIC
    GATES AND **DOES NOT REGISTER WHAT IT BUILDS**. All four are pure functions of
    the stored blob and need no subprocess, so this is the right answer for a
    caller that wants a NUMBER — `GET /api/indicator-alerts/current-value`'s
    prefill is the one in the product. It is the wrong answer for the alert lane,
    which needs the 1e-9 cross-lane equality as well, so the alert lane goes
    through `value_function_for_alert` and that function re-admits.

    ⚰️ THIS USED TO CACHE ITS REBUILD INTO `USER_FUNCS`, AND THE PARAGRAPH THAT
    JUSTIFIED IT WAS FALSIFIED BY THE EDIT PATH. It said: *"the cross-lane proof
    is a property of (tree, bars) established at ARM time … A stored definition
    whose maths CHANGES gets a new `ast_hash`, a `compute.rev` bump and a
    `forget`, so the tree this rebuilds is the tree that was proven."* The first
    two clauses are still true and the CONCLUSION was never true: a `forget`
    drops the entry, and what this rebuilt afterwards was the NEW tree — served
    under a proof taken against the OLD one, and then cached so nothing would
    ever look again. Worse, the prefill route reaches this function, so a
    read-only display could mint that receipt for an alert that had never been
    armed at all. The rebuild is now unregistered and the alert seam re-proves.

    RAISES `AdmissionRefused` on a definition that no longer passes — it does not
    return `None`. `None` here means "this is not a user address", which the
    builtin path must be able to read as "keep looking"; a refusal read the same
    way would be an alert that quietly stops.
    """
    if not is_user_address(address):
        return None
    key = scoped_key(user_id, address)
    fn = USER_FUNCS.get(key)
    if fn is not None:
        return fn

    def_id, plot_key = split_user_address(address)
    row = _gate_definition(user_id, def_id, None)
    definition = _gate_lane(row)
    _gate_repaint(row, definition)
    _gate_budget(definition, def_id)
    keys = {str(p.get("key")) if isinstance(p, dict) else str(p)
            for p in (definition.get("plots") or [])}
    if plot_key not in keys:
        raise AdmissionRefused(
            "definition",
            f"{address!r} {REFUSAL_FRAGMENTS['definition']} — "
            f"{def_id} declares plots {sorted(keys)}")
    return _make_value_fn(def_id, plot_key, definition)


def value_function_for_alert(alert: Mapping[str, Any], bars: Optional[list] = None
                             ) -> Optional[Callable[[list, dict], Optional[float]]]:
    """The alert row's user value function, or `None` if it names a builtin.

    The evaluator's seam. It reads `user_id` off the ROW, which is the only place
    a background cycle can learn whose formula this is — and, because it holds the
    row, the only place that knows which SYMBOL and TIMEFRAME the formula is about
    to be judged on. That is what makes it the layer that can re-prove.

    🔴 A REGISTRY MISS RE-ENTERS THE ARM PATH. Not a rebuild — `arm_for_alert`,
    the same function `indicator_alert_service.create` calls, which fetches this
    alert's own bars and runs all five gates including the 1e-9 cross-lane
    equality. The audit's finding, in one sentence: *with `forget()` now firing on
    every edit, the rebuilt tree is the NEW tree, admitted on a cross-lane proof
    taken against the OLD one.* An armed alert is now re-proven on the tree it
    will actually evaluate, or it is refused.

    ⛔ REFUSED, NEVER ADMITTED-BY-DEFAULT. `_gate_cross_lane` turns a lane that
    cannot RUN (`LaneUnavailable` — no node, no interpreter) into a `cross-lane`
    refusal rather than a pass, and an empty bar set into a `bars` refusal. A box
    that cannot prove the equality admits nothing; the alternative is a formula
    computing one number on the server and another on the author's chart with
    nothing to say so. `refusal_for_alert` is the read-out either way.

    ⚠️ WHAT IT COSTS, STATED: one node subprocess PER MISS — not per cycle. A
    miss happens exactly twice: after a process restart, and after the author
    saves (`user_definitions.save` forgets on every append). Everything in
    between is a dict lookup, byte-for-byte what it was before.

    ⭐ `bars` IS THE CYCLE'S OWN FETCH, PASSED DOWN — and passing it is not just a
    saved request. `_evaluate_one` is handed a (sym, tf) group's bars so one fetch
    serves every alert on it; re-fetching here would prove the equality on a
    SECOND read of the tape, which is a different series from the one the value is
    then computed on. Same tree AND same bars is what "proven on what it will
    actually evaluate" means. `None` (or an empty list, which is the same
    absence wearing a different type) falls back to the evaluator's own fetcher,
    which is what `arm_for_alert` does at genuine arm time.
    """
    address = str(alert.get("indicator") or "")
    if not is_user_address(address):
        return None
    user_id = alert.get("user_id")
    fn = USER_FUNCS.get(scoped_key(user_id, address))
    if fn is not None:
        return fn
    arm_for_alert(user_id, address, str(alert.get("sym") or ""),
                  str(alert.get("tf") or ""), bars=bars or None)
    # Re-read rather than trusting the admission's own list: a definition that
    # no longer declares THIS plot admits its other plots fine, and the refusal
    # that names the missing plot is `user_value_function`'s to raise.
    return user_value_function(user_id, address)


def refusal_for_alert(alert: Mapping[str, Any]) -> Optional[AdmissionRefused]:
    """⭐ THE ATTRIBUTION READ-OUT: which gate refuses this alert, if any.

    Returns the refusal instead of raising it, so a surface can say *why* an
    alert is silent instead of showing a user a row that simply never fires.
    `None` means "nothing refuses it" — either it is a builtin, or it is admitted.
    """
    try:
        value_function_for_alert(alert)
    except AdmissionRefused as exc:
        return exc
    return None


# ─── THE PER-USER CATALOG — SCOPED RESOLUTION, NOT A FOURTH GLOBAL ENTRY ─────
#
# ⭐ WHY THIS IS A SECOND FUNCTION AND NOT A FOURTH PARTITION. Everything above
# says it: `ADDRESS_PARTITIONS` is GLOBAL, `build_alert_grid` iterates
# `INDICATOR_FUNCS`, and 685,193 recorded fires plus a 31/31 `--diff` hang off
# those enumerations staying exactly the size they are. So the user namespace is
# reached the only way a per-user namespace CAN be reached — with a user id in
# hand — and the dropdown is assembled from `alert_catalog()` (global, unmoved)
# PLUS this (scoped), at the one layer that holds a signed-in account: the router.
#
# ⛔ AND IT OFFERS ONLY WHAT THE DETERMINISTIC GATES ADMIT. `alert_catalog`'s own
# contract is that the dropdown *"cannot offer an alert that cannot fire"*; a
# definition the repaint or budget gate refuses is exactly such an alert. The
# cross-lane gate is deliberately NOT run here — it spawns a node process per
# definition and this is a dropdown fetch — so this list is a SUPERSET of what
# will arm, and the arm path stays the authority: a POST that gets refused there
# returns the gate's own sentence rather than a silence.


def _definition_label(definition: Mapping[str, Any], def_id: str) -> str:
    """What a user called their formula, or its id when they called it nothing."""
    meta = definition.get("meta") or {}
    for key in ("name", "shortName"):
        value = meta.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return str(def_id)


def _plot_label(definition: Mapping[str, Any], plot: Any, plot_key: str,
                def_id: str) -> str:
    """One plot's label. Qualified by the plot only when there is more than one.

    A single-plot definition is the overwhelming case and "My Average · value"
    reads as a bug next to "RSI"; a two-plot one has to say which line, or the
    dropdown offers the same words twice.
    """
    base = _definition_label(definition, def_id)
    if isinstance(plot, dict):
        for key in ("name", "label", "title"):
            value = plot.get(key)
            if isinstance(value, str) and value.strip():
                return f"{base} · {value.strip()}"
    if len((definition.get("plots") or [])) <= 1:
        return base
    return f"{base} · {plot_key}"


def _instance_label(definition: Mapping[str, Any], def_id: str,
                    params: Optional[Mapping] = None) -> str:
    """`"My Average(20)"` — spec §8's instance naming, for a user formula.

    ⛔ THE KNOBS COME FROM `_inputs_for`, WHICH IS THE FUNCTION THE EVALUATION
    USES. `indicator_alert_evaluator.instance_label` states the same rule for the
    builtins (*"the knobs are DERIVED, never listed"*), and it matters more here:
    a label built from a second reader of `inputs` could name a parameter the
    formula never receives, which is the divergence `_inputs_for`'s own tombstone
    is about.
    """
    base = _definition_label(definition, def_id)
    inputs = _inputs_for(definition, params)
    if not inputs:
        return base
    parts = [str(int(v)) if float(v).is_integer() else str(v)
             for v in inputs.values()]
    return f"{base}({', '.join(parts)})"


def _plots_of(definition: Mapping[str, Any]) -> list[tuple]:
    """`[(plot, key), …]` for every plot that HAS a key.

    ⛔ THE PAIR IS BUILT ONCE, NOT ZIPPED FROM TWO LISTS. A definition carrying a
    keyless plot makes the two lists different lengths, and `zip` would then pair
    every later plot with the PREVIOUS one's key — labelling one line with
    another's name while every address stayed valid, which is a defect nothing
    downstream can detect.
    """
    out = []
    for plot in (definition.get("plots") or []):
        key = plot.get("key") if isinstance(plot, dict) else plot
        if key:
            out.append((plot, str(key)))
    return out


def _plot_keys(definition: Mapping[str, Any]) -> list[str]:
    return [key for _plot, key in _plots_of(definition)]


def instance_label_for(user_id: Any, address: str,
                       params: Optional[Mapping] = None) -> Optional[str]:
    """The INSTANCE label for one account's user address, or `None` if not one.

    The user-lane counterpart of `indicator_alert_evaluator.instance_label`, and
    the reason it takes a user id: a bare address names nobody's formula.
    """
    if not is_user_address(address):
        return None
    from api.services import user_definitions
    def_id, plot_key = split_user_address(address)
    row = user_definitions.get(user_id, def_id, None)
    if row is None:
        return None
    definition = row.get("definition") or {}
    label = _instance_label(definition, def_id, params)
    if len(_plot_keys(definition)) <= 1:
        return label
    return f"{label} · {plot_key}"


def user_catalog(user_id: Any) -> list[dict]:
    """This ACCOUNT's own formulas, in `alert_catalog()`'s entry shape.

    `[]` for an account with none, and `[]` for no account at all — the second is
    what makes `alert_catalog()` with no user id byte-identical to what it always
    returned, and it reaches no store, so the frozen instruments cannot move.

    Every entry carries `source: "user"` so a surface can tell one apart; the
    GLOBAL entries are deliberately left alone rather than gaining a matching
    `"builtin"`, because that would edit the shape 31 addresses and a 685,193-fire
    log are enumerated with, to say something a client can already infer.
    """
    if not user_id:
        return []
    from api.services import indicator_alert_evaluator as ev
    from api.services import user_definitions

    # ⛔ DERIVED FROM THE PRICE ADDRESS'S OWN ROW, NEVER RETYPED. A user formula
    # is a LEVEL — one number per bar, no declared `THRESHOLD_OPERAND` — and
    # `close` is the one address in the table with exactly that shape, so its
    # condition list IS the answer to "what can you ask of a bare level".
    # Retyping the four here is the twin `IndicatorAlertPopover` already had.
    conditions = [dict(c) for c in ev.ALERT_CONDITIONS["close"]]

    entries: list[dict] = []
    for row in user_definitions.list_for_user(user_id):
        def_id = str(row.get("def_id"))
        try:
            definition = _gate_lane(row)
            _gate_repaint(row, definition)
            _gate_budget(definition, def_id)
        except AdmissionRefused:
            continue
        except Exception:  # noqa: BLE001 — a TableRefusal out of `check_budget`
            # The TABLE refusing a tree is not this function's to relabel (see
            # `_gate_budget`), and a formula the table refuses cannot fire, so it
            # is not offered. It stays visible where a user manages it —
            # `GET /api/user-definitions` — and `refusal_for_alert` is the
            # attribution read-out for anything already armed on it.
            continue
        pairs = _plots_of(definition)
        if not pairs:
            continue
        plots = [
            {
                "value": f"{def_id}.{plot_key}",
                "label": _plot_label(definition, plot, plot_key, def_id),
                "conditions": [dict(c) for c in conditions],
                # ⛔ NO DEFAULT THRESHOLD, EVER. `_DEFAULT_THRESHOLDS` only ever
                # holds the bounded oscillators; a user formula's scale is
                # unknowable from here and a guessed number in the box is wrong
                # for every formula but the one it was guessed from.
                "default_threshold": None,
                "inputs": _inputs_for(definition, None),
                "instance_label": _instance_label(definition, def_id),
            }
            for plot, plot_key in pairs
        ]
        entries.append({
            "indicator": def_id,
            "label": _definition_label(definition, def_id),
            "source": "user",
            "conditions": [dict(c) for c in plots[0]["conditions"]],
            "default_threshold": None,
            "plots": plots,
        })
    return entries


def arm_for_alert(user_id: Any, indicator: str, sym: str, tf: str,
                  *, bars: Optional[list] = None) -> Optional[dict]:
    """⭐ THE ARM-TIME CALL SITE. Returns `None` for a builtin address.

    ⛔ THIS IS WHY THE EQUALITY IS NOT A FUNCTION NOBODY CALLS. It is invoked from
    `indicator_alert_service.create`, which is the real arm path — and as of this
    commit it is also the path the router posts to.

    ⚰️ THAT SECOND CLAUSE SAID *"the real arm path, the one the router posts to"*
    AND THE SECOND HALF WAS FALSE FOR THE WHOLE OF ITS LIFE. `ias.create` really
    was the invoker; what nothing checked was whether anything could REACH it.
    `api/routers/indicator_alerts.py::create_alert` refused every address that
    `indicator_alert_evaluator.value_function()` misses, two statements before it
    could call `create` — and `value_function` walks the three GLOBAL partitions,
    from which `USER_FUNCS` is deliberately absent. So `POST /api/indicator-alerts
    {"indicator": "u_….value"}` was a 400 *"not an indicator this chart can
    evaluate"*, this entire admission chain sat BELOW that refusal, and both sides
    were individually correct and individually tested: the seam was dead. The
    router now resolves a user address in the account's own scope and lets the
    refusal come from the gate that means it — and the rail on that is a POST
    through the router (`test_alert_user_router.py`), not a call to this function,
    because a call to this function is exactly what stayed green while the door
    was shut.

    Fetches the alert's own bars through the evaluator's own fetcher, so the
    formula is proven equal on the series it will actually be evaluated against
    rather than on a fixture.

    ⭐ AND IT IS NOW ALSO THE RE-ARM PATH. `value_function_for_alert` calls this
    on a registry miss, so "armed once" and "re-proven after an edit" are the
    SAME code — a second re-proof routine would be a second definition of what
    admission means, on the one number this phase's contract rests on.
    """
    if not is_user_address(indicator):
        return None
    def_id, _plot = split_user_address(indicator)
    if bars is None:
        from api.services import indicator_alert_evaluator as ev
        # ⛔ THE ADMISSION MUST SEE THE WINDOW THE EVALUATION WILL SEE. The
        # cross-lane 1e-9 proof is taken on these bars; proving equality over 200
        # while the cycle then computes over 700 proves it for a series the alert
        # never evaluates. The tree's own `max_lookback` sizes both.
        bars = ev._fetch_bars_for_alert(
            sym, tf, ev.bars_wanted(lookback_for_alert(
                {"indicator": indicator, "user_id": user_id}) or 0))
    return admit_user_definition(user_id, def_id, None, bars=bars)
